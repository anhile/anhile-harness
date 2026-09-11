# Invariants

Properties of a project that adopts this harness, and of the harness itself,
that must not change. This file travels: the generator copies it into every
new project, and a project appends its own invariants below the harness's. Every entry names a
concrete check — if you cannot state how a violation would be detected, it does
not belong on this list.

"Human decision" means: a person, in the current session, explicitly agrees to
the change. An agent may never satisfy that condition on its own initiative.

## The numbering

The scripts and skills this package ships cite invariants by number — the
commit gate says `I11`, the feature-list guard says `I15`, the migration runner
says `I8` — and those numbers were given in `anhile/link-shortener`, where the
harness was written inside a product. The numbers are kept so that every
citation in a shipped file stays true. The gaps are that product's invariants
(a short code resolves to one URL, click events are append-only, statistics do
not leak) and are listed at the end so nobody reuses a number that a copied
script may still print.

The table is the index; the sections below carry the reasons and the exact
checks.

| # | Must hold | Mechanism | Fired at by |
|---|---|---|---|
| I4 | A project's shared contracts package changes only by explicit human decision | sign-off recorded in `PROGRESS.md`; `contracts.package` in `harness.config.json` | `progress.spec.ts` |
| I8 | Applied migrations are immutable, and none is applied unprompted | `check-migrations.mjs`, step 09 where a project has one; `migrate.mjs` prompts, and `--yes` only for `*_test` | `harness-config.spec.ts` |
| I11 | A commit is only made from a tree `verify.sh` has passed | the commit gate, a `PreToolUse` hook; protected files by shape and by hash | `commit-gate.spec.ts`, `permissions.spec.ts` |
| I12 | What verification concluded is recorded, durably and append-only | `verify-log.mjs check`, step 07, and again in the commit gate | `verify-log.spec.ts` |
| I13 | A commit's claim to be verified is checkable off the author's machine | CI `attest` from a clean clone; `pre-push` | `attestation.spec.ts` |
| I14 | Coverage never falls, and no source file escapes being counted | `check-coverage.mjs`, step 08, against `coverage-floor.json` | `harness-config.spec.ts` |
| I15 | `feature_list.json` is append-only, and a guarantee is withdrawn in the open | `check-feature-list.mjs`, step 06; the audit receipt before a closing commit | `feature-list.spec.ts`, `audit-receipt.spec.ts` |

## I4 — A project's shared contracts package changes only by explicit human decision

A project that has a package of published types and constants — the generator
records it as `contracts.package` in `harness.config.json`, `null` when there
is none — treats every export in it as a contract. Adding an optional field is
still a contract change. An agent proposes; a human decides.

A project without such a package has `null` there and nothing to sign off.
The invariant is here regardless, because `scripts/progress.mjs` asks for the
sign-off by number in the journal template it writes, and a number a script
prints has to resolve to a sentence.

**How it is checked**
- Any diff touching the configured package requires the human's sign-off to be
  recorded in the session's `PROGRESS.md` entry, under **Contract changes**.
- `scripts/__tests__/progress.spec.ts` holds the template to the configuration.

## I8 — Applied migrations are immutable, and none is applied unprompted

A `.sql` file that has been applied anywhere is never edited; schema changes
are new files. `scripts/migrate.mjs` refuses to apply pending migrations
non-interactively without `--yes`, and only `verify.sh` passes `--yes`, only
against a disposable test database.

**`--yes` is honoured only for a database whose name ends in the configured
test suffix.** The name is the only thing about the target the runner can see
before it connects, so the name is what it checks, and it checks it before
connecting. The suffix comes from `harness.config.json` and is refused unless it
reads as deliberate — an underscore and at least three characters — because it
is the whole of what keeps an unattended migration off a real database.

**How it is checked**
- `scripts/check-migrations.mjs`, `verify.sh` step 09 in a project that has a
  database: a committed `.sql` file that is edited or removed fails the gate.
- `scripts/__tests__/harness-config.spec.ts`: the suffix rule, and that
  `migrate.mjs` reads it rather than carrying its own.
- The runner's non-TTY refusal path is exercised by running it with stdin
  closed.

## I11 — A commit is only made from a tree `verify.sh` has passed

An agent session may not create a commit unless the most recent `./verify.sh`
run reported PASS *about the tree being committed*. A green run is evidence
about the exact bytes it ran against and nothing else, so a passing verdict
plus an edited file is not a passing verdict.

The gate binds the agent, not the human. Claude Code hooks fire on the agent's
tool calls; a person committing in their own terminal is untouched. That is
deliberate: when the gate is wrong, the human overrules it, and the session
cannot overrule it on its own initiative.

Its trusted computing base is `verify.sh`, `scripts/verify-receipt.mjs`,
`scripts/audit-receipt.mjs`, `scripts/check-commit-gate.mjs`,
`scripts/check-protected-files.mjs` and `.claude/settings.json`, which also
carries the `permissions` block that denies the session `.env`, force-pushes
and the other irreversible commands. Edits to those are refused by the same
hook, so removing the gate is a visible act that the human has to approve. This
is a speed bump, not a seal: any rule inside the agent's own permission surface
can be lifted by asking the human to lift it. The value is that asking is the
only route.

**How it is checked**
- `scripts/__tests__/commit-gate.spec.ts`, in `verify.sh` step 03: builds a
  throwaway repository, copies the gate into it, and fires at it — no receipt, a
  failed receipt, a receipt for a different tree, a deleted file, each shape of
  `git commit` invocation, and each protected path.
- The same suite fires at `scripts/check-protected-files.mjs`, which baselines
  the protected files when the person speaks and reports drift after a tool
  call; the gate recomputes that comparison at commit time.
- `scripts/__tests__/permissions.spec.ts` pins the `permissions` block.
- **Confirmed by a human, not by a test:** that Claude Code accepts the hook
  schema. Settings are read at session start, so the session that installs a
  hook cannot observe it working.

## I12 — What verification concluded is recorded, durably and append-only

Every `./verify.sh` run writes one file under `verify-log/`, which is
tracked, named after the run's evidence folder: the verdict, every step's
exit code and duration, the hash of the tree it ran against, and the commit
it was based on. A run's file is never edited and never removed.

**Failing runs are recorded too.** A record that keeps only the green runs is
not a record — it is a highlight reel, and it lies by omission.

**One file per run, not one line per run, since 2026-09-12.** For two weeks
the record was a single append-only file, and two branches that both ran the
gate both appended to its end: every merge of two working branches
conflicted there, and the rule that resolved it — rerun the gate before
every merge so the branch's newest run is newer than main's — taxed
parallel work for nothing the record needed. GitHub does not honour a union
merge for pull requests, so the file had to stop being one file. Files with
distinct names never conflict, and the guard accepts a merged record against
either parent.

The raw output under `.generated/runs/` stays git-ignored. The files under
`verify-log/` are what survive a clone. They are deliberately outside the
tree hash of I11 — `verify.sh` records the run at the end of every run, so
hashing them would make each run invalidate its own receipt. The commit gate
closes that window by running this guard itself before allowing a commit.

**How it is checked**
- `scripts/verify-log.mjs check`, `verify.sh` step 07: every file under
  `verify-log/` at `HEAD` must be present and byte-identical in the working
  tree, every file must be named as a run and parse and carry `at`,
  `result`, `tree` and `steps`, and no file may be dated before the run its
  name says it is — what is left of the old rule against backdating, now that
  branches record in their own time.
- `scripts/verify-log.mjs migrate` turns the record's earlier shape, one
  line per run in `verify-log.jsonl`, into files with the same fields, and
  refuses to overwrite a file that differs.
- `scripts/check-commit-gate.mjs` runs the same guard before a commit.
- `scripts/__tests__/verify-log.spec.ts`, step 03: fires removals, rewrites,
  an emptied record, malformed files and stray files at the guard, and merges
  two branches that both recorded runs to show the record never conflicts.
- `scripts/check-verify.mjs`, in CI's witness job: a passing run and a
  deliberately broken run each record exactly one file, and the broken one is
  recorded as `fail` naming the step that failed.

## I13 — A commit's claim to be verified is checkable off the author's machine

Locally the record is a session reporting on itself. Recomputed somewhere else,
by something that did not write it, it is a claim that can fail: CI's `attest`
job hashes the tracked files of a clean checkout and looks for a recorded
passing run about exactly that tree.

**How it is checked**
- `scripts/check-attestation.mjs`, the first step of CI, before any install.
- `.githooks/pre-push` asks the same question of each commit being pushed, in
  a detached worktree of exactly that commit. `git push --no-verify` is the
  overrule, and it is visible.
- `scripts/__tests__/attestation.spec.ts` fires at the script.

## I14 — Coverage never falls, and no source file escapes being counted

`coverage-floor.json` records, per area, the lowest coverage the gate will
accept, and the floor only goes up: `check-coverage.mjs --raise` moves it after
a green run, and a run below it is red. A source file no test imports is
reported rather than silently absent from the summary.

**How it is checked**
- `scripts/check-coverage.mjs`, `verify.sh` step 08, reading the summary jest
  wrote into the run's own evidence folder.
- `scripts/__tests__/harness-config.spec.ts` holds the configured coverage
  sources to the areas the floor names.

## I15 — `feature_list.json` is append-only, and a guarantee is withdrawn in the open

The list of features and whether each passes is the criteria a project is
measured against. Four edits are legal: append an entry with `passes: false`,
its `id` equal to its position and its `spec` naming the contract that
introduces it; flip one entry from `false` to `true`; mark one retracted; or
record a `spec` on an entry whose `spec` was `null`, once. Nothing else — not
reordering, not rewording a description, not editing a step, not changing an
`id` or a recorded `spec`.

The reason is the cheapest way to close a hard task: two deleted words in a
description, after which the tests are green and the report looks honest. No
malice is required, only a gradient. Every mechanism in this repository that
guards a claim exists because of that asymmetry, and this is the one it started
from.

**One entry closes per commit.** Flipping two at once makes one green
`verify.sh` stand for both, and nothing afterwards can say which of them it was
actually about.

**A guarantee is withdrawn in the open, never quietly.** A retraction names the
contract that withdraws it, gives a reason, and says whether the guarantee
moved to another entry (`supersededBy`) or ended (`null`). It is permanent. It
shares a commit only with other withdrawals under the same contract, and never
with a feature being closed. The entry is marked, never deleted: a list that
forgets what it used to promise cannot be audited against what it promised.

**How it is checked**
- `scripts/check-feature-list.mjs`, `verify.sh` step 06: compares the file
  against its parent commit and rejects every edit outside the four legal
  shapes, more than one closure per commit, retractions citing two contracts,
  retractions sharing a commit with a closure, edited or undone retractions, a
  missing or mismatched `id`, a new entry without a contract or naming one that
  does not exist, and a changed `id` or recorded `spec`.
- CI walks the pushed commits one against its parent, because append-only is a
  property of each commit, not of a span.
- `scripts/__tests__/feature-list.spec.ts`: adversarial tests for every shape
  above.
- `scripts/check-commit-gate.mjs`, before any commit that flips an entry to
  `true`: `.generated/audit.json` must name this tree, this entry's `spec` and
  the verdict READY, written by `/verify-task` after the spec-auditor read the
  diff, the contract and the evidence.
- **Review only:** that the auditor's READY was earned. The gate checks that an
  audit of this tree said READY; it cannot read the report.

## Yours to add

A project's own invariants go below this line, numbered from I16, each with a
"How it is checked" that names a mechanism. An entry with no check is a
preference; the table at the top is the index and every entry is in it. The
spec-auditor reads this file and cites by number, so a number that moves is a
citation that lies.

## Numbers not used here

I1, I2, I3, I5, I6, I7, I9 and I10 were link-shortener's: the stability of a
short code, its uniqueness, frozen route signatures, the layer boundaries
between its API and its page, append-only click events, the redirect never
waiting on click recording, statistics scoped to one link. None is a property
of the harness. They are named so the numbers stay retired: a shipped skill may
still list them as examples, and a new invariant here takes I16 or later.
