# Spec: the quick run

- **Feature list entry**: #14 — "`./verify.sh --quick [--base <ref>]` runs lint, types, the suites affected since the base and the guards, leaves api-e2e, browser-e2e and coverage to the full gate, and is recorded as quick; the commit gate takes it for a commit that closes nothing, and a closure, the audit and CI's walk ask the full gate"
- **Author / session date**: 2026-09-16
- **Status**: approved — the first of the three fast-lane debts left after 0.2.0

---

## Problem

The full gate is the only gate. In this repository it is 37 seconds, 34 of
them the unit step, and in a generated project with an API and a page it
brings up Postgres and a browser for every run. A session iterating on one
module runs it after every edit because the commit gate accepts nothing
else, and the record shows the cost: about eight runs per closure. The
0.2.0 fast lane took two of the three commits out of a closure and left the
runs as they were.

## In scope

- `./verify.sh --quick [--base <ref>]`: steps 01, 02, 06, 07 and 09 as they
  are; step 03 as `unit_suites`, a function above the step block that under
  `--quick` runs jest with `--changedSince <base>` and `--coverage=false`
  and otherwise the whole suite; steps 04, 05 and 08 skipped by name, each
  logged `SKIP … (quick: left to the full gate)` in the summary and absent
  from `steps.jsonl`. The base is `main` unless `--base` names another, and
  a base that is not a commit refuses the run. An unknown argument refuses
  the run. The summary carries a `mode:` line.
- The receipt carries `mode` (`full` or `quick`, nothing else) and
  `quickBase`; `isQuick(run)` in `verify-receipt.mjs` reads either a receipt
  or a recorded run, and a record with no `mode` is full. The run's file
  under `verify-log/` carries `mode` and `since`; `tail` shows a quick run
  as one.
- The commit gate takes a quick receipt for a commit that closes nothing
  and says so on stderr; a closing commit on a quick receipt is refused
  before the audit is asked, naming the entry, the base and the two commands.
- `audit-receipt.mjs write` refuses on a quick receipt, whatever the verdict.
- `check-attestation.mjs` notes a quick run; `check-feature-list.mjs --at`
  refuses a committed closure whose tree has passing runs on record and
  every one of them is quick (`quickClosureProblems`).
- The generator's step table names `unit_suites` for step 03; the seed
  `AGENTS.md` names the quick run in rule 1 and the refusal in its table.

## Out of scope

- The `progress.mjs cost` metric and the upgrade command: the other two
  debts, next.
- A quick run in CI. CI runs the full gate; that is what makes the quick run
  affordable on the machine.
- Affected-suite selection that follows anything but imports. Jest's
  `--changedSince` follows the module graph; a suite that reads a file
  without importing it is not rerun, and I11 says so.

## Acceptance criteria (EARS)

- **AC1** (event) — When `./verify.sh --quick` runs, steps 04, 05 and 08
  shall be skipped by name and logged as such, step 03 shall call
  `unit_suites` with `--changedSince` and `--coverage=false`, and the
  summary shall say `mode: quick` with the base; without `--quick` the
  summary shall say `mode: full` and step 03 shall run the whole suite.
- **AC2** (ubiquitous) — The receipt shall record `mode` and `quickBase`,
  refuse a mode that is neither `full` nor `quick`, and default to `full`;
  the recorded run shall carry `mode` and `since` from the receipt.
- **AC3** (event) — When the receipt is quick and the index closes nothing,
  the commit gate shall let the commit through and say on stderr that the
  run was quick; when the index closes an entry, it shall refuse, naming the
  entry and `./verify.sh`.
- **AC4** (event) — When the receipt is quick, `audit-receipt.mjs write`
  shall refuse with a message naming `--quick` and the full gate, and write
  neither the receipt nor a log file.
- **AC5** (event) — When a committed closure's tree has passing runs on
  record at that commit and all are quick, `check-feature-list.mjs --at`
  shall refuse naming the run; when one of them is full, or none is on
  record, it shall say nothing about it.
- **AC6** (ubiquitous) — The generator shall write `run_step 03 unit
  unit_suites`, and `unit_suites` shall be above the step block of the gate
  it copies; the seed `AGENTS.md` shall name `--quick`.
- **AC7** (event) — When the last recorded passing run of the tree is quick,
  `check-attestation.mjs` shall accept it and note that it was quick, with
  its base; when it is full, it shall say nothing about a mode.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `quick-gate.spec.ts` "the gate under --quick": runs a copy of `verify.sh` in a throwaway repository with `pnpm` and `node` shimmed on PATH, once with `--quick` and once without, and reads the summary, `steps.jsonl` and the shim's log of what jest was asked; plus "refuses an unknown argument" and "refuses a base that is not a commit" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `quick-gate.spec.ts` "the receipt and the record" (write with `--mode quick --base x`, without, with `--mode other`; `verify-log.mjs append` on each) | the cases pass | same |
| AC3 | Jest — `commit-gate.spec.ts` "a quick run is taken for a commit that closes nothing, and refused for a closure (I11)" | the cases pass | same |
| AC4 | Jest — `audit-receipt.spec.ts` "refuses to write on a quick receipt: an audit is about the full gate" | the case passes | same |
| AC5 | Jest — `feature-list.spec.ts` "refuses a committed closure whose only passing run on record is quick, and takes one with a full run beside it (I11)": no run on record, a quick run only, a full run beside it | the case passes | same |
| AC6 | Jest — `harness-init.spec.ts` "writes step 03 as unit_suites, defined above the block, and names --quick in the seed" | the case passes | same |
| AC7 | Jest — `attestation.spec.ts` "notes a quick run and accepts it, and says nothing of the kind about a full one" | the case passes | same |
| all | by hand, before the audit, on the tree the audit is about: `./verify.sh --quick` (the record says quick; `03-unit.log` names the suites jest selected), then the commit gate fired on that receipt with the closure of #14 staged (refused, naming the full gate), then `./verify.sh` on the same tree; the run ids and the selected suites named in the journal entry | the quick run and the full run record the same tree; the gate refused the closure on the quick receipt | the journal |

## Affected modules

- `verify.sh`, `scripts/verify-receipt.mjs`, `scripts/check-commit-gate.mjs`, `scripts/audit-receipt.mjs` — protected; patched under `.generated/scratch/quick/` and applied by a person
- `scripts/verify-log.mjs`, `scripts/check-attestation.mjs`, `scripts/check-feature-list.mjs` (`quickClosureProblems`), `scripts/harness-init.mjs` (`STEPS`, the seed)
- new: `scripts/__tests__/quick-gate.spec.ts`, listed in the manifest's suites tier; cases in `commit-gate.spec.ts`, `audit-receipt.spec.ts`, `feature-list.spec.ts`, `harness-init.spec.ts`, `attestation.spec.ts`; `feature-list.spec.ts` and `audit-log.spec.ts` copy `verify-log.mjs` into their fixtures, since `check-feature-list.mjs` now imports it
- docs: `docs/INVARIANTS.md` I11, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `CHANGELOG.md`

## Definition of done

Entry #14 closes on AC1 to AC6 together, in one commit, with the entry in
`feature_list.json`, this contract, the run's record, the READY audit under
`audit-log/` and the journal entry naming both.
