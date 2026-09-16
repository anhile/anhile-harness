# Spec: the journal's evidence is a pointer, not a sentence

- **Feature list entry**: #9 — "A journal entry's Evidence names a run under verify-log/ and, when the entry closed a feature, the READY audit under audit-log/; the stop hook, step 03 and CI's walk refuse an entry a reader cannot follow"
- **Author / session date**: 2026-09-16
- **Status**: approved — the person chose it from the reading of Vercel's harness course, as the one item there that adds a mechanism

---

## Problem

Every session ends with an entry in `PROGRESS.md`, and every entry has an
Evidence field. Until now it was prose: "the run recorded under `verify-log/`
for this tree", "the `verify-log.jsonl` line for this run". It reads like a
pointer and points at nothing a reader can open. The course's rule for an
agent's report — name the exact command and the exact result, never a
sentence that sounds like one — is the rule this repository enforces
everywhere else by mechanism, and the journal was the one place it enforced
by habit.

## In scope

- `progress.mjs check` follows the Evidence field of every entry new since
  `--base` (HEAD) into the record: at least one run id that exists under
  `verify-log/`, every run id named on record, and, when the Feature field
  says `closed #n`, at least one audit id under `audit-log/` whose verdict
  was READY. `--at` reads the journal and the records at a commit.
- `session-stop.mjs` asks the same of the entries the session added, from
  the working tree against the journal at the session's starting commit,
  once, after the reminder that an entry exist.
- CI's per-commit walk runs `progress.mjs check --at --base` beside the
  other append-only guards; by the protected patch.
- The template's Evidence line says the shape; the generated seed entry
  says why it has no id yet.

## Out of scope

- The entries written before this rule. They are old at every baseline a
  walk uses and stay as prose.
- Asking the Verified by field for anything. It is the human summary; the
  Evidence field is the pointer.
- Holding the named run to the commit's own tree. The attestation does that
  for the commit; the entry names the runs made for the work, which may be
  older than the run that covered the final tree.
- Naming the audit in the closing commit itself. The audit describes the
  tree, and the journal is in the tree, so an entry that names the audit's
  id cannot be in the tree the audit describes. The closing commit carries
  the audit; the entry that names it comes in the commit after, which is the
  commit the rule asks. This contract is closed that way.

## Design source

None.

## Acceptance criteria

- **AC1** (unwanted) — If an entry new since the baseline names no run id,
  or names one that is not under `verify-log/`, then `progress.mjs check`
  shall refuse, naming the entry and the id.
- **AC2** (unwanted) — If an entry new since the baseline says `closed #n`
  and names no audit id, or one not under `audit-log/`, or one whose verdict
  was not READY, then `progress.mjs check` shall refuse, naming the entry
  and what the audit said.
- **AC3** (ubiquitous) — Entries present at the baseline shall not be asked;
  `--at <commit> --base <parent>` shall ask only what the commit added, from
  the journal and the records as the commit carries them.
- **AC4** (event-driven) — When a session that committed since it began
  stops with an entry whose Evidence a reader cannot follow, the stop hook
  shall refuse once, listing the problems and the two commands that print
  the ids.
- **AC5** (ubiquitous) — CI's walk shall run the same check on every pushed
  commit against its parent.
- **AC6** (ubiquitous) — A project the generator writes shall pass
  `progress.mjs check` on its seed journal, which names no run because none
  has happened.

## Verification plan

| Criterion | Verification mechanism | Pass condition | Evidence output |
|---|---|---|---|
| AC1 | Jest — `progress.spec.ts` "the Evidence of a new entry points into the record": "refuses a new entry whose Evidence names no run", "refuses a run that is not on record", "accepts a new entry naming a run on record, and leaves the old prose alone" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `progress.spec.ts` "asks a closing entry for the audit that said READY", "does not take "none closed" for a closure" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC3 | Jest — `progress.spec.ts` "asks only the shape when there is no baseline", "reads the journal and the records at a commit with --at, the way CI walks"; "this repository › PROGRESS.md is in the template shape, every entry" passes with the prose entries at HEAD and asserts the pointer branch ran on what the working tree added — which is step 03 asking the entry a session is about to commit | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC4 | Jest — `session-hooks.spec.ts` "blocks once when the entry this session wrote points at nothing on record" (both `tail` commands asserted), "lets the session stop when the entry names a run on record, committed or not" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC5 | Jest — `ci-workflow.spec.ts` "compares a merge commit with the branch it merged…" names `progress.mjs check` among the guards the walk runs, and "runs the journal check on each commit the way the workflow does…" runs that command on a branch of real commits: the entry naming its run passes, the one pointing nowhere is refused, the seed's prose entry is old at every baseline. The walk on GitHub is the same line on the same shape; its log is CI's | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC6 | Jest — `harness-init.spec.ts` "the journal a project starts with › passes progress.mjs check as written, before any run exists to name" | the case passes | `.generated/runs/<ts>/03-unit.log` |

Entry #9 closes on AC1 to AC6 together, and its closing entry in the
journal is the first one the rule applies to: it names the run and the audit
by id, and the stop hook and CI check that it does.

## Affected modules

- `scripts/progress.mjs`, `scripts/session-stop.mjs`, `scripts/harness-init.mjs` (the seed entry's Evidence line)
- `.github/workflows/verify.yml` — protected; one line in the walk, under `.generated/scratch/journal/`, applied by a person
- `specs/2026-09-journal-pointers.md` — this file
- `feature_list.json`, `PROGRESS.md`, `CHANGELOG.md`, `docs/INVARIANTS.md`, `CONTRIBUTING.md`, `README.md`
- `verify-log/` — the run records the gate writes on the way
- tests: `scripts/__tests__/progress.spec.ts`, `session-hooks.spec.ts`, `ci-workflow.spec.ts`, `harness-init.spec.ts`; the fixtures gain the record readers the script now imports, and every fixture entry names a run. The pin on the stop hook's import line moves to the new import line, exact as before. No case weakened.

## Invariants

| Invariant | Relevance | How this task preserves it |
|---|---|---|
| I12 | the journal now points into the record the invariant is about | a new "How it is checked" line; the record itself is untouched |
| I15 | #9 appended, then closed | appended `passes: false` in the first commit; closed in its own commit on a READY audit the commit carries, and the entry names both ids |

Domain rules: R5 (nothing here names a product), R7 (the tarball changes by
nothing new; the scripts it carries change).

## Open questions

None.
