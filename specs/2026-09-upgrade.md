# Spec: upgrading a project that adopted an earlier version

- **Feature list entry**: #16 — "`npx anhile-harness upgrade [--into <dir>] [--yes]` writes this version's harness files into a project init wrote earlier — the manifest's scripts, agents, skills, workflow, templates, and verify.sh above the step block with the project's steps kept and their commands from this version's table — reports the packages and optional config keys it lacks without editing them, leaves the project's own files alone, and is a plan without --yes"
- **Author / session date**: 2026-09-16
- **Status**: approved — the last of the three fast-lane debts left after 0.2.0

---

## Problem

`init` writes a snapshot, and a project keeps the harness it was born with.
`bin/harness.mjs` said so out loud, and the CHANGELOG carried, per version,
the list of files to copy by hand and the `run_step` line to rewrite. Three
versions in, that list is the upgrade path, and a path made of prose is
followed once and then not.

## In scope

- `scripts/harness-upgrade.mjs`, and `upgrade` in `bin/harness.mjs`:
  `answersOf(into)` reads what the project is from `harness.config.json`
  (`database.required`) and its directories (`apps/api`, `apps/web`, `e2e`);
  `planUpgrade(into)` lists every file `copiedFiles` names for those answers
  as `same`, `update` or `new` against this version, the gate as the same
  three, the packages `dependenciesFor` names that the project's
  `package.json` lacks or has at another version, and the optional
  configuration keys the project's `harness.config.json` lacks with the
  value `configFor` would write; `applyUpgrade(plan)` writes the files and
  the gate that are not `same`; `renderPlan` prints it.
- `upgradedVerify(projectGate, source)`: this version's `verify.sh` above
  the step block, the project's `run_step` lines kept by number and name,
  each command from this version's `STEPS` where the name is known and as it
  was otherwise; the renamed ones reported.
- Refusals: a directory without `harness.config.json`; a project gate with
  no `run_step` block.
- The manifest lists the script under `core`; the bin's usage names the
  command and no longer says upgrading is not here.

## Out of scope

- Editing `package.json`, the lockfile, `harness.config.json`, or any seeded
  or product file. Reported, with the line to run or the value to write.
- Recording the harness version in the project. The files say what version
  they are by being it; `upgrade` without `--yes` says whether they are.
- Downgrading, or upgrading from a directory that is not the package's root.

## Acceptance criteria (EARS)

- **AC1** (event) — When `upgrade` is run on a directory without
  `harness.config.json`, it shall refuse naming the file, exit 1 and write
  nothing.
- **AC2** (event) — When `upgrade` is run without `--yes` on a project this
  version just wrote, it shall report every file `same`, the gate `same`, no
  package to add and no key lacking, say there is nothing to write, and
  write nothing.
- **AC3** (event) — When `upgrade` is run without `--yes` on a project that
  lacks a file, has another version's copy of one, has an older `run_step 03`
  line, lacks a package and lacks an optional key, it shall name the file as
  `new`, the other as `update`, the gate as to update with `03 unit →
  unit_suites`, the package with the `pnpm add -D` line, and the key with the
  generator's value; and it shall write nothing.
- **AC4** (event) — When the same is run with `--yes`, the named files and
  the gate shall be written byte for byte from this version — the gate's
  text above the block, the project's step lines with this version's
  commands — and `AGENTS.md`, `feature_list.json`, `harness.config.json` and
  `package.json` shall be as they were; a second run shall find every file
  `same`.
- **AC5** (ubiquitous) — `upgradedVerify` shall keep a step whose name the
  table does not know with its command as it was, keep a deferred step the
  table knows with the table's command, and refuse a gate with no
  `run_step` line.
- **AC6** (ubiquitous) — The script shall be in the manifest's `core`, the
  bin's usage shall name `upgrade`, and neither the bin nor the README shall
  say any longer that upgrading is not here.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `harness-upgrade.spec.ts` "refuses a directory that is not a project this harness wrote" | the case passes | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `harness-upgrade.spec.ts` "finds nothing to write on a project this version just wrote" (a `--web` scaffold and a `--database --api` one, the project line naming each answer, the counts non-empty) | the case passes | same |
| AC3 | Jest — `harness-upgrade.spec.ts` "plans what an older project lacks, and writes nothing without --yes" (a `--web` scaffold aged by hand: an agent removed, a script rewritten, the old `run_step 03` line, a line above the block removed, `tailwind-merge` dropped, `ui` dropped) | the case passes | same |
| AC4 | Jest — `harness-upgrade.spec.ts` "--yes writes the harness files and the gate, and leaves the project's own files alone" | the case passes | same |
| AC5 | Jest — `harness-upgrade.spec.ts` "keeps a step the table does not know, re-renders a deferred one it does, and refuses a gate with no steps" | the case passes | same |
| AC6 | Jest — `harness-upgrade.spec.ts` "travels in the manifest's core, and the bin names the command" | the case passes | same |

## Affected modules

- new: `scripts/harness-upgrade.mjs`, `scripts/__tests__/harness-upgrade.spec.ts`
- `scripts/__tests__/harness-package.spec.ts`: its README case pinned "upgrade" under what the package does not do; it pins the section's other lines now
- `bin/harness.mjs` (the command, the usage), `harness.manifest.json` (core scripts, the suites tier)
- docs: `README.md`, `CHANGELOG.md`

## Definition of done

Entry #16 closes on AC1 to AC6 together, in one commit, with the entry in
`feature_list.json`, this contract, the run's record, the READY audit under
`audit-log/` and the journal entry naming both.
