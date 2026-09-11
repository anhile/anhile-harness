# Spec: the harness's own guarantees, as entries it is measured against

- **Feature list entries**: #0 to #6, appended under this contract; each entry's `spec` is this file
- **Author / session date**: 2026-09-11
- **Status**: approved — Phase 4 of the plan the person accepted on 2026-09-11, "запиши гарантии харнеса в feature_list.json"

---

## Problem

The harness refuses a claim that is not earned, and until now made none about
itself: `feature_list.json` was empty from the seed through five merged pull
requests. The guarantees a consumer relies on — a generated project's first
gate is green, the tarball is the manifest, a copied script names no product —
were held by suites nobody had to cite. A harness that measures every project
by a list of guarantees and keeps none of its own is asking for a standard it
does not meet.

## In scope

- One entry per guarantee below, appended with `passes: false`, then closed
  one per commit on a READY audit, in the order listed.
- Nothing else: every mechanism named already exists and is green. This
  contract records what is true, under the rules that make recording it mean
  something.

## Out of scope

- New mechanisms. A guarantee with no existing suite is not on this list; it
  is a spec of its own.
- The end-to-end proof that a generated project's first run is green: that is
  the `generate` job in CI, five variants on every push, and it is named in
  the entry's steps rather than counted as this contract's evidence, because
  the auditor reads the local evidence folder and CI is not in it. What step
  03 proves locally is the mechanism that keeps the first run green.
- The upgrade path for a project that adopted an earlier version. README says
  it is not there; it stays not there.

## Design source

None.

## Acceptance criteria

- **AC1** (ubiquitous) — The generator shall write into a new project's
  `verify.sh` only the steps whose requirements exist, and shall name every
  deferred step, with the line to add, in the project's `AGENTS.md`.
- **AC2** (ubiquitous) — The generator shall resolve every package the manifest
  names for a set of answers to a version from `package.json` or
  `harness.versions.json`, and no name shall have a version in both.
- **AC3** (ubiquitous) — The tarball `npm pack` produces shall carry every
  script and file the manifest says travels, and shall carry no guard suite,
  no workflow of this repository alone, and nothing git ignores.
- **AC4** (ubiquitous) — Every script the manifest classifies as `core` shall
  contain none of the identifiers of the product the harness was written in.
- **AC5** (unwanted) — If a commit is attempted on a tree no recorded green run
  covers, or after a session edit to a protected file, then the commit gate
  shall refuse it.
- **AC6** (unwanted) — If `feature_list.json` is edited outside its four legal
  shapes, or two entries close in one commit, or `verify-log.jsonl` loses or
  rewrites a line, then the gate shall refuse the change.
- **AC7** (ubiquitous) — Every script the harness ships shall be type-checked
  as it runs, under `tsc -b`, with no build step, here and in a generated
  project.

## Verification plan

| Criterion | Verification mechanism | Pass condition | Evidence output |
|---|---|---|---|
| AC1 | Jest — `scripts/__tests__/harness-init.spec.ts`, describes "the steps a project gets", "the gate it writes", "the project it writes" | every case passes, including "puts no step in the gate that nothing can pass, whatever was answered" and "tells the new project which steps are missing and the line to add for each" | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `scripts/__tests__/harness-package.spec.ts` describe "the versions it can give a new project"; `harness-init.spec.ts` "refuses to resolve a package this repository does not have" and "takes the app versions from harness.versions.json" | every case passes | `.generated/runs/<ts>/03-unit.log` |
| AC3 | Jest — `scripts/__tests__/harness-package.spec.ts` describe "what the tarball carries", asked of `npm pack --dry-run --json` | every case passes | `.generated/runs/<ts>/03-unit.log` |
| AC4 | Jest — `scripts/__tests__/harness-boundary.spec.ts` describe "core names nothing about this product", proved live against the manifest's prose | every case passes | `.generated/runs/<ts>/03-unit.log` |
| AC5 | Jest — `scripts/__tests__/commit-gate.spec.ts`, firing the gate in a throwaway repository | every case passes | `.generated/runs/<ts>/03-unit.log` |
| AC6 | Jest — `scripts/__tests__/feature-list.spec.ts` and `scripts/__tests__/verify-log.spec.ts`, each handing the guard a tampered file | every case passes | `.generated/runs/<ts>/03-unit.log` |
| AC7 | `tsc -b --force tsconfig.build.json` with `tsconfig.scripts.json` referenced; Jest — `harness-init.spec.ts` "typechecks the copied scripts, so their @ts-check is not decoration" | step 02 exits 0 with every script under `// @ts-check`; the case passes | `.generated/runs/<ts>/02-typecheck.log`, `.generated/runs/<ts>/03-unit.log` |

## Affected modules

- `feature_list.json` — seven entries appended, then one `passes` flip per commit
- `specs/2026-09-harness-guarantees.md` — this file
- `PROGRESS.md` — the journal entry for the session
- tests: none changed. A test modified under this contract is a finding.

## Invariants

| Invariant | Relevance | How this task preserves it |
|---|---|---|
| I15 | appends seven entries and closes each | appended with `passes: false`, `id` equal to position, `spec` this file; one flip per commit, each on a READY audit of that tree; nothing reworded |
| I11 | seven closing commits | each commit follows a green `./verify.sh` over exactly its tree |
| I12 | seven gate runs | each appends a line; none edits one |

Domain rules this spec depends on: R1 (the first run is green — its mechanism
is AC1, its end-to-end witness is CI), R2 and R3 (AC2), R5 (AC4), R7 (AC3).
None is contradicted.

## Open questions

None.
