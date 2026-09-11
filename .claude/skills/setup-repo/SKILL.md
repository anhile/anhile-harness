---
name: setup-repo
description: Bring a fresh clone of this repository to a green gate, and prove it with a run rather than a claim. Use on a new machine, in a new worktree, or when the gate will not start.
allowed-tools: Bash(node scripts/check-environment.mjs:*), Bash(pnpm install:*), Bash(cp .env.example .env), Bash(./verify.sh), Bash(./init.sh), Bash(docker compose:*), Bash(node scripts/migrate.mjs --status:*), Bash(git worktree list), Bash(node -v), Bash(pnpm -v), Read, Grep, Glob
---

Bring this clone to a green gate.

What this machine is missing:

!`node scripts/check-environment.mjs || true`

## Rule 0 — the setup is finished when `./verify.sh` is green, and not before

A setup that ends with "that should work now" has proved nothing. The check
above states what is missing; it does not establish that anything works. Nine
steps passing is what establishes that, and it is the only thing that does.

This is not a slogan here. On 2026-09-11 a fresh clone could not run the gate
at all: two accounts suites built their Stytch client while the file was being
collected, so step 04 threw for anyone without credentials. Nobody had noticed
because CI appends the repository secrets to `.env` before running the gate —
the one environment that could have proved a clone works was the one
environment that always had credentials.

## Steps

### 1. Read the check, fix what it names

Every finding carries its own remedy. Two are worth expanding:

- **`.env`** — `cp .env.example .env` is enough. The gate runs on it. The
  accounts suites skip themselves without real Stytch credentials rather than
  failing, and the nineteen skipped tests in step 04 are that, not a problem.
  Real credentials belong in `.env` only if you intend to run the `@live`
  suites locally, which normally happens in CI's witness job instead.
- **Docker** — the daemon has to be *running*, not merely installed. Steps 04
  and 05 need Postgres, and `./verify.sh` starts the container itself.

`gh` is reported and never counted against the machine: nothing in the gate
needs it, and `/open-pr`, `/review-pr` and `/address-comments` do.

### 2. Install

```
pnpm install
```

Or skip it: `./verify.sh` installs on the first run, because it checks for
`node_modules` before anything else.

### 3. Run the gate

```
./verify.sh
```

Nine steps. The first run is the slow one — it installs, pulls the Postgres
image, creates the test database and applies the migrations. Expect several
minutes, and expect step 04 to report skipped tests.

If a step fails, **read its log under `.generated/runs/<timestamp>/` before
changing anything.** CONTRIBUTING's *When a gate says no* pairs each failure
with the right response and the tempting wrong one.

### 4. Only if the work touches the UI

```
./init.sh
```

Postgres, migrations, the API on 3000, the web app on 5173. Then create one
link through the browser. A UI criterion is verified as a user would, and
`curl` does not count.

### 5. Report

The gate's result, and the run folder it wrote. If a step failed, the step,
the first real error in its log, and what you propose — not a fix already
applied.

## A second worktree

`git worktree add ../<name> -b <branch>`, then `cp .env ../<name>/.env` or
`cp .env.example .env` inside it. The gate gives a linked worktree its own
ports and its own test database, so two can run at once; every run records
which it used in its summary. `docs/PARALLEL_WORK.md` has the rest, including
the one merge rule that cannot be automated away.

## What this skill does not do

It does not install Docker, Node or pnpm. Those are decisions about the
machine, and a session that installs a toolchain unasked is a session that has
changed something nobody can see in the diff. It names what is missing and how
to get it; the person runs it.
