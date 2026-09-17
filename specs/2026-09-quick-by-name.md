# Spec: the quick run selects suites by name as well as by import

- **Feature list entry**: #17 — "`./verify.sh --quick` runs the suites jest relates to what changed by import, the suites that changed themselves, and the suites whose text names a changed path or its basename, chosen by `scripts/quick-suites.mjs` and said in the step's log; with nothing selected, step 03 runs nothing and says so"
- **Author / session date**: 2026-09-17
- **Status**: approved — from the first observation the day of the fast lane left

---

## Problem

The quick run (#14) asks jest for the suites related to what changed, and
jest answers from the import graph. In this repository no guard suite
imports the script it fires at — every one copies it into a throwaway
repository, spawns it, or reads it from disk — so the graph relates nothing
to a changed script. Measured on 2026-09-17: `jest --findRelatedTests` names
no suite for `scripts/spike.mjs` or `scripts/verify-receipt.mjs`; six and
fourteen suites name them in their source. Every quick run on 2026-09-16
selected exactly the spec files the session had edited, and each of the
three closures after #14 had a quick run pass a tree the full gate then
failed. I11 named the limit; this narrows it.

## In scope

- `scripts/quick-suites.mjs`: `changedSince(base)` — committed since the
  merge base, staged, unstaged, untracked; `allSuites()` — what jest lists
  (`--listTests`), since `jest.config.cjs` decides what a suite is, and when
  jest lists nothing, every `*.spec.*` file, tracked or not;
  `relatedByImport(base)` — jest's `--listTests --changedSince`, empty when
  jest refuses or lists nothing; `selectSuites()` —
  pure: by import, the suite itself among the changed paths, by name (the
  suite's text contains a changed path or its basename), the union sorted;
  `describe()` — one line of counts and one per suite selected by name with
  what it named. The CLI prints the selected paths to stdout, the why to
  stderr, and exits 0 either way.
- `verify.sh`, `unit_suites` under `--quick`: the list from the script; with
  none, a line saying so and step 03 passing having run nothing; otherwise
  jest with `--runTestsByPath` on the list and coverage off. Patched under
  `.generated/scratch/quick-by-name/` and applied by a person.
- The script travels: the manifest's `core`.
- I11's paragraph on the quick run says what selects a suite now, and what
  still does not: a suite that reads a file it neither imports nor names.

## Out of scope

- Reading which files a suite opens at run time. The source is the
  declaration; a suite that reaches a file by a path it computes is not
  found, and the full gate is still asked where a claim is made.
- The V8 crash under the jest workers: the second observation, its own
  change.

## Acceptance criteria (EARS)

- **AC1** (ubiquitous) — `selectSuites` shall select a suite jest related,
  a suite among the changed paths, and a suite whose text names a changed
  path or its basename, and no other; the map of what each suite named
  shall be returned, and `describe` shall print the three counts and one
  line per suite selected by name.
- **AC2** (ubiquitous) — `changedSince(base)` shall list a path committed
  since the merge base with the base, a staged one, an unstaged one and an
  untracked one, once each; `allSuites()` shall list what jest lists when
  jest lists anything, and otherwise every `.spec.ts` file tracked or
  untracked and nothing else; `relatedByImport(base)` shall be empty when
  jest exits non-zero.
- **AC3** (event) — When the CLI runs in a repository where a script
  changed that a suite names but none imports, it shall print that suite
  and say on stderr it was selected by name and what it named; when nothing
  changed, it shall print nothing and say so.
- **AC4** (event) — When `./verify.sh --quick` runs and the script selects
  suites, step 03 shall run jest with `--runTestsByPath` on exactly those,
  coverage off; when it selects none, step 03 shall pass having run no jest
  and its log shall say nothing was related.
- **AC5** (ubiquitous) — The script shall be in the manifest's `core`, and
  I11 shall say the three grounds and the remaining limit.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `quick-suites.spec.ts` "selectSuites › takes a suite by import, a suite that changed itself, a suite that names a changed path, one that names its basename, and leaves the rest" and "describe › says the counts and what each suite named" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `quick-suites.spec.ts` "in a repository › changedSince lists the four kinds of change once each", "allSuites lists the spec files, tracked or not, and nothing else, when jest answers nothing", and "allSuites takes jest's list when it gives one, and relatedByImport is empty when jest refuses" (the `pnpm` shim answers `--listTests` from `JEST_LIST` and exits 1 under `JEST_FAIL`) | the cases pass | same |
| AC3 | Jest — `quick-suites.spec.ts` "in a repository › the command prints the suite that names the changed script and says why, and nothing when nothing changed" (jest shimmed on PATH to answer nothing) | the case passes | same |
| AC4 | Jest — `quick-gate.spec.ts`, the three quick cases reworked: step 03 asked with `--runTestsByPath` on the selected suite, `--base` passed through to the script, and a case "runs nothing in step 03 when no suite is related, and says so" | the cases pass | same |
| AC5 | Jest — `harness-boundary.spec.ts` on the manifest (existing); `quick-suites.spec.ts` "travels in the manifest's core, and I11 names the three grounds" | the cases pass | same |
| all | by hand, on this branch: `./verify.sh --quick` with `scripts/quick-suites.mjs` new and `verify.sh` changed; the step log names the suites selected and why; then the full gate on the same tree | the log shows suites selected by name for `verify.sh`; the full run passes | the journal |

## Affected modules

- new: `scripts/quick-suites.mjs`, `scripts/__tests__/quick-suites.spec.ts`
- `verify.sh` — protected; patched under `.generated/scratch/quick-by-name/`
- `scripts/__tests__/quick-gate.spec.ts` (the unit-step assertions, the fixture gains two suites and copies the script), `scripts/__tests__/harness-init.spec.ts` (the generated gate's step 03 pins the script instead of `--changedSince`, and the script's presence in the project), `harness.manifest.json` (core, the suites tier)
- docs: `docs/INVARIANTS.md` I11, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `CHANGELOG.md`

## Definition of done

Entry #17 closes on AC1 to AC5 together, in one commit, with the entry in
`feature_list.json`, this contract, the run's record, the READY audit under
`audit-log/` and the journal entry naming both.
