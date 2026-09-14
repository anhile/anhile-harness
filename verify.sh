#!/usr/bin/env bash
#
# The verification gate. Up to nine steps, in order:
#
#   1. eslint                 (layer boundaries + code rules)
#   2. tsc -b                 (all packages, via project references)
#   3. jest unit              (every package's unit suites, plus the guards)
#   4. jest API e2e           (supertest against a booted app + test DB)
#   5. playwright browser e2e (real browser against the real stack)
#   6. feature-list guard     (feature_list.json is append-only)
#   7. verify-log guard       (a recorded run under verify-log/ is never edited or removed)
#   8. coverage guard         (the floors were not lowered, no file is unseen)
#   9. migrations guard       (a committed migration is never edited)
#
# Which of them run is the `run_step` block at the bottom, and nothing else:
# the generator copies everything above that block byte for byte and writes
# the block from what a project said it has. Steps 4, 5 and 9 wait for a
# suite, a page and a migration respectively; the functions they call are
# below, ready, and a project's AGENTS.md carries the line to add.
#
# Every step's stdout and stderr is written to .generated/runs/<timestamp>/.
# No failure is swallowed: each step's exit code is recorded and the script
# exits non-zero if any step failed.
#
# By default every step runs even after a failure, so the evidence folder is
# complete. Set VERIFY_FAIL_FAST=1 to stop at the first failing step.
#
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="$ROOT/.generated/runs/$TIMESTAMP"
mkdir -p "$EVIDENCE_DIR"
export EVIDENCE_DIR

# The tree as it stands before any step runs. Compared with the tree at the end
# so a run whose sources moved underneath it is recorded as `stale` rather than
# as a verdict: steps that saw different code have not agreed about anything.
TREE_BEFORE="$(node scripts/verify-receipt.mjs hash)"

# Pairs the verdict with the tree it is about. scripts/check-commit-gate.mjs
# reads this, and refuses a commit unless it says `pass` about this exact tree.
write_receipt() {
  node scripts/verify-receipt.mjs write \
    --status "$1" \
    --evidence "$EVIDENCE_DIR" \
    --tree-before "$TREE_BEFORE" \
    --failed "$2" >/dev/null
  # The durable half. .generated/runs/ is machine-local and grows by the run;
  # one small file per run under verify-log/ is what survives in git. Failing
  # runs are recorded too -- a record that keeps only the green runs is not a
  # record.
  node scripts/verify-log.mjs append --evidence "$EVIDENCE_DIR" >/dev/null
  # Keep the newest ten runs and every red one; drop the rest. The record is
  # the file above, not the folder, and the folders reached 102 MB once.
  node scripts/prune-evidence.mjs >/dev/null 2>&1 || true
}

SUMMARY="$EVIDENCE_DIR/summary.txt"
FAILED_STEPS=()
STEPS_RUN=0

log_summary() { printf '%s\n' "$1" | tee -a "$SUMMARY"; }

log_summary "verify.sh run $TIMESTAMP"
log_summary "repo:   $ROOT"
# `git rev-parse` writes to stdout AND fails before the first commit, so both
# would land in the summary. `git branch --show-current` is quiet and exits 0.
log_summary "commit: $(git rev-parse --short HEAD 2>/dev/null || true)"
log_summary "branch: $(git branch --show-current 2>/dev/null || true)"
log_summary "node:   $(node -v)"

# --- what the harness knows about this project ----------------------------
# harness.config.json is edited rather than this file. The database is named
# after the project, as docker-compose.yml names its user, password and
# database; the disposable test database is that name plus the configured
# suffix, and the suffix is the whole of what keeps `migrate.mjs --yes` off a
# real one. Read once, here, so no name below is a literal.
read -r PROJECT TEST_DB TEST_SUFFIX CFG_API_PORT CFG_WEB_PORT <<<"$(node -e '
  const c = JSON.parse(require("fs").readFileSync("harness.config.json", "utf8"));
  const suffix = c.database.testSuffix;
  const test = c.database.exampleName;
  const name = test.endsWith(suffix) ? test.slice(0, -suffix.length) : test;
  process.stdout.write([name, test, suffix, c.ports.api, c.ports.web].join(" "));
')"

# --- environment ----------------------------------------------------------
# What the caller set, remembered before `.env` is read. `source .env` runs
# under `set -a`, so it *overwrites* the environment rather than filling gaps:
# `TEST_DATABASE_URL=... ./verify.sh` was silently ignored, and a second
# worktree told to use its own database quietly shared the first one's. The
# caller's value is put back afterwards, which is the precedence everyone
# already assumes.
_caller_api_port="${VERIFY_API_PORT-}"
_caller_web_port="${VERIFY_WEB_PORT-}"
_caller_test_db="${TEST_DATABASE_URL-}"

if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi

[[ -n "$_caller_api_port" ]] && VERIFY_API_PORT="$_caller_api_port"
[[ -n "$_caller_web_port" ]] && VERIFY_WEB_PORT="$_caller_web_port"
[[ -n "$_caller_test_db"  ]] && TEST_DATABASE_URL="$_caller_test_db"

# Two worktrees, two gates, one machine. A *linked* worktree takes its own
# ports and its own test database, derived from its path so they are stable
# across runs and need no coordination. The primary worktree keeps the
# configured numbers, so nothing anybody has memorised moves.
#
# `git-dir` and `git-common-dir` are the same path in the primary worktree and
# different in a linked one. That is the whole test.
if [[ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ]]; then
  _slot=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 40 + 1 ))
  # The derived values beat `.env` and lose to the caller, and the order here
  # is the whole of that rule. Written first as `${VAR:-derived}`, which reads
  # right and does nothing: a `.env` copied from an example always sets
  # TEST_DATABASE_URL, so the variable was never empty and the derivation
  # never fired. The gate then went green against the shared database while
  # appearing to prove isolation — twice, the second time in the fix for the
  # first.
  VERIFY_API_PORT="${_caller_api_port:-$(( CFG_API_PORT + _slot ))}"
  VERIFY_WEB_PORT="${_caller_web_port:-$(( CFG_WEB_PORT + _slot ))}"
  # The suffix goes at the end, where migrate.mjs looks for it: it honours
  # --yes only for a name ending in the configured suffix (I8), so
  # `<name>_test_w7` would lose the protection the whole scheme depends on.
  TEST_DATABASE_URL="${_caller_test_db:-postgres://${PROJECT}:${PROJECT}@localhost:5433/${PROJECT}_w${_slot}${TEST_SUFFIX}}"
  unset _slot
fi
unset _caller_api_port _caller_web_port _caller_test_db

# Every worktree shares the one Postgres container. docker-compose.yml pins
# `container_name`, which is global, while Compose derives the project name
# from the directory — so a second worktree tried to create its own stack,
# collided on the container name, and then could not find the container it had
# failed to create. The error it produced was "Postgres did not become ready".
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$PROJECT}"

export API_PORT="${API_PORT:-3000}"
export WEB_PORT="${WEB_PORT:-5173}"
export DATABASE_URL="${DATABASE_URL:-postgres://${PROJECT}:${PROJECT}@localhost:5433/${PROJECT}}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://${PROJECT}:${PROJECT}@localhost:5433/${TEST_DB}}"
export VERIFY_API_PORT="${VERIFY_API_PORT:-$CFG_API_PORT}"
export VERIFY_WEB_PORT="${VERIFY_WEB_PORT:-$CFG_WEB_PORT}"

# In the summary, because "did these two runs use different databases?" is a
# question about evidence and had to be answered by listing databases in psql
# afterwards. Twice that answer was no while both runs were green. A run now
# says what it used, and two summaries settle it.
log_summary "ports:  api $VERIFY_API_PORT, web $VERIFY_WEB_PORT"
log_summary "testdb: ${TEST_DATABASE_URL##*/}"
log_summary ""

if [[ ! -d node_modules ]]; then
  printf '%s==>%s Installing dependencies\n' "$GREEN" "$RESET"
  pnpm install 2>&1 | tee "$EVIDENCE_DIR/00-install.log"
fi

# Steps 4 and 5 need a database. Bring it up if it is not already running.
ensure_database() {
  if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
    return 0
  fi
  printf '%s==>%s Starting Postgres for e2e steps\n' "$GREEN" "$RESET"
  docker compose up -d postgres >>"$EVIDENCE_DIR/00-database.log" 2>&1
  for _ in $(seq 1 60); do
    # -h forces TCP. Without it pg_isready uses the unix socket, which the
    # bootstrap server the postgres entrypoint runs for initdb also listens on
    # — so the check goes green, initdb finishes, that server shuts down, and
    # the next psql gets "the database system is shutting down". The real server
    # is the only one that binds TCP. CI hit this on its first run.
    docker compose exec -T postgres pg_isready -h 127.0.0.1 -U "$PROJECT" -d "$PROJECT" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# --- step runner ----------------------------------------------------------
# Runs a command, tees its combined output to an evidence file, records the
# exit status, and never lets a failure escape unnoticed.
run_step() {
  local number="$1" name="$2"; shift 2
  local logfile="$EVIDENCE_DIR/${number}-${name}.log"
  local status=0
  local started ended

  if [[ ${#FAILED_STEPS[@]} -gt 0 && "${VERIFY_FAIL_FAST:-0}" == "1" ]]; then
    log_summary "SKIP  ${number} ${name}  (fail-fast: an earlier step failed)"
    return 0
  fi

  printf '%s==>%s %sStep %s: %s%s\n' "$GREEN" "$RESET" "$BOLD" "$number" "$name" "$RESET"
  STEPS_RUN=$(( STEPS_RUN + 1 ))
  started=$(date -u +%s)

  # `set +e` around the call so a non-zero exit is captured, not fatal.
  set +e
  { "$@"; } >"$logfile" 2>&1
  status=$?
  set -e

  ended=$(date -u +%s)
  local duration=$(( ended - started ))

  if [[ $status -eq 0 ]]; then
    log_summary "PASS  ${number} ${name}  (${duration}s)  -> ${number}-${name}.log"
  else
    FAILED_STEPS+=("${number}-${name}")
    log_summary "FAIL  ${number} ${name}  (${duration}s, exit ${status})  -> ${number}-${name}.log"
    printf '%s[fail]%s step %s exited %s. Last 25 lines:\n' "$RED" "$RESET" "$name" "$status" >&2
    tail -n 25 "$logfile" >&2
  fi

  printf '%s\n' "$status" > "$EVIDENCE_DIR/${number}-${name}.exit"
  # A machine-readable sibling of the .exit files. New file, not a change to
  # them: scripts/check-verify.mjs and the spec-auditor read the existing shapes.
  printf '{"step":"%s-%s","exit":%s,"seconds":%s}\n' \
    "$number" "$name" "$status" "$duration" >> "$EVIDENCE_DIR/steps.jsonl"
  return 0
}

# --- step 4 needs a migrated test database --------------------------------
prepare_test_database() {
  ensure_database || { echo "Postgres did not become ready"; return 1; }
  # The name comes from the URL that is about to be migrated, not from a
  # literal. Those two disagreed once: the literal created the configured test
  # database while the migration ran against whatever the URL said, so a
  # worktree pointed at its own database got a migration against one that had
  # never been created.
  local db="${TEST_DATABASE_URL##*/}"; db="${db%%\?*}"
  case "$db" in
    *"$TEST_SUFFIX") ;;
    *) echo "refusing: TEST_DATABASE_URL names '$db', which does not end in $TEST_SUFFIX"; return 1 ;;
  esac
  docker compose exec -T postgres psql -U "$PROJECT" -d "$PROJECT" -tc \
    "select 1 from pg_database where datname = '$db'" | grep -q 1 \
    || docker compose exec -T postgres createdb -U "$PROJECT" "$db"
  # --yes is safe here and only here: a test database is disposable, and the
  # guard above is what keeps that sentence true.
  node scripts/migrate.mjs --yes --database-url="$TEST_DATABASE_URL"
}

api_e2e() {
  prepare_test_database || return 1
  DATABASE_URL="$TEST_DATABASE_URL" \
    pnpm exec jest --config apps/api/test/jest-e2e.config.cjs --runInBand
}

browser_e2e() {
  # Against the disposable test database, not the dev one. The gate once
  # leaned on the dev database being migrated, which was the dev setup's
  # doing -- so it passed on a machine that had run the setup and failed on
  # a clean checkout. CI found that on its first run. Reusing the test
  # database keeps the gate self-contained and out of the developer's data
  # entirely; it is still the only database --yes is ever passed for, so I8
  # is unchanged.
  prepare_test_database || return 1

  # Dedicated ports, and this is not cosmetic. Playwright reuses a server that
  # is already listening (`reuseExistingServer`, so a dev server and the gate
  # do not fight over the dev port). On the default ports that means a dev API
  # pointed at the developer's own database gets handed the tests -- while a
  # helper writes to the test database through DATABASE_URL. Two databases,
  # and only the tests that touch one directly notice.
  local api_port="$VERIFY_API_PORT" web_port="$VERIFY_WEB_PORT"

  # Playwright's webServer boots the API and the Vite dev server itself.
  API_PORT="$api_port" \
  WEB_PORT="$web_port" \
  PUBLIC_BASE_URL="http://localhost:$api_port" \
  VITE_API_BASE_URL="http://localhost:$api_port" \
  DATABASE_URL="$TEST_DATABASE_URL" \
    pnpm exec playwright test
}

# --- the steps ------------------------------------------------------------
run_step 01 eslint       pnpm exec eslint .
run_step 02 typecheck    pnpm exec tsc -b --force tsconfig.build.json
run_step 03 unit         pnpm exec jest --config jest.config.cjs
run_step 06 feature-list node scripts/check-feature-list.mjs
run_step 07 verify-log   node scripts/verify-log.mjs check
run_step 08 coverage     node scripts/check-coverage.mjs

# --- verdict --------------------------------------------------------------
log_summary ""
if [[ ${#FAILED_STEPS[@]} -eq 0 ]]; then
  log_summary "RESULT: PASS (${STEPS_RUN}/${STEPS_RUN} steps)"
  write_receipt pass ""
  printf '\n%s%sverify: PASS%s  evidence: %s\n' "$BOLD" "$GREEN" "$RESET" "$EVIDENCE_DIR"
  exit 0
fi

log_summary "RESULT: FAIL (${#FAILED_STEPS[@]} step(s) failed: ${FAILED_STEPS[*]})"
write_receipt fail "$(IFS=,; printf '%s' "${FAILED_STEPS[*]}")"
printf '\n%s%sverify: FAIL%s  %s step(s) failed: %s\n' "$BOLD" "$RED" "$RESET" \
  "${#FAILED_STEPS[@]}" "${FAILED_STEPS[*]}" >&2
printf '%sevidence:%s %s\n' "$YELLOW" "$RESET" "$EVIDENCE_DIR" >&2
exit 1
