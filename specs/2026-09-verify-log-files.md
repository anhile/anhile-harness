# Spec: the record of runs is a file per run

- **Feature list entries**: #5 retracted, #7 appended under this contract; #7's `spec` is this file
- **Author / session date**: 2026-09-12
- **Status**: approved — the person chose this debt first from the review of 0.1.0

---

## Problem

The record of gate runs was one append-only file, `verify-log.jsonl`, and
every run appended a line: 45 lines in the first four hours. Two branches
that both ran the gate both appended at its end, so every merge of two
working branches conflicted in that file, and the rule that resolved it —
rerun the gate before every merge, so the branch's newest run is newer than
main's — taxed parallel work for nothing the record needed. GitHub ignores
`merge=union` for pull requests, so the file could not stay one file.

## In scope

- `verify-log/`, one file per run, named after the run's evidence folder;
  `verify-log.mjs append` writes it, `check` refuses an edited, removed or
  stray file, `tail` and `flakes` read the directory.
- Every reader of the old file — attestation, the pull-request readiness
  check, the review brief, evidence pruning, the witness — reads the
  directory.
- The readiness check drops its order rule, with the reason.
- The existing 60-odd lines migrated to files; `verify-log.jsonl` removed.
- Entry #5, which names the old file, retracted with its guarantee moved to
  #7, worded for the directory.

## Out of scope

- A log of audit receipts. Still a debt; a spec of its own.
- Rotating old run files into a history directory. The volume is one small
  file per run and a merge never touches an old one; revisit at a thousand.

## Design source

None.

## Acceptance criteria

- **AC1** (ubiquitous) — Each `./verify.sh` run shall record one file under
  `verify-log/`, named after its evidence folder, carrying the verdict, the
  steps, the tree hash and the commit it was based on.
- **AC2** (unwanted) — If a recorded run's file is edited, removed, or a file
  under `verify-log/` is not named as a run, then step 07 and the commit
  gate shall refuse.
- **AC3** (ubiquitous) — Two branches that each recorded runs shall merge
  without a conflict under `verify-log/`, and the merged record shall pass
  the guard against either parent.

## Verification plan

| Criterion | Verification mechanism | Pass condition | Evidence output |
|---|---|---|---|
| AC1 | Jest — `generated-project.spec.ts` "records the run in its own record, so its first commit can be attested"; `attestation.spec.ts`, every case, which reads runs as files | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `verify-log.spec.ts` "what the record refuses", five cases; `commit-gate.spec.ts` "refuses a commit when a recorded run has been rewritten" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC3 | Jest — `verify-log.spec.ts` "two branches that both ran the gate": a real `git merge --no-ff` of two branches that each recorded a run, then the guard against `HEAD^` and `HEAD^2` | the case passes | `.generated/runs/<ts>/03-unit.log` |

Entry #7 closes on AC1 to AC3 together: one entry, one commit, one audit.

## Affected modules

- `verify-log/` — new; `verify-log.jsonl` — removed
- `scripts/verify-log.mjs`, `scripts/check-attestation.mjs`, `scripts/check-pr-ready.mjs`, `scripts/pr-review-brief.mjs`, `scripts/prune-evidence.mjs`, `scripts/check-verify.mjs`, `scripts/progress.mjs`, `scripts/harness-init.mjs`
- `scripts/verify-receipt.mjs`, `scripts/check-commit-gate.mjs`, `verify.sh` — protected; the prefix the tree hash leaves out, one message, one comment; applied by a person
- `harness.manifest.json`, `feature_list.json`, `PROGRESS.md`, `CHANGELOG.md`, `docs/INVARIANTS.md`, `CONTRIBUTING.md`, `README.md`, `AGENTS.md`, `.github/pull_request_template.md`, `.claude/skills/open-pr/SKILL.md`, `.claude/skills/setup-repo/SKILL.md`, `.claude/agents/spec-auditor.md`
- tests: `verify-log.spec.ts` rewritten for the directory; `attestation.spec.ts`, `commit-gate.spec.ts`, `pr-ready.spec.ts`, `generated-project.spec.ts` moved to files. `pr-ready.spec.ts` loses the five cases of the order rule and gains one saying the rule is gone. No other case weakened.

## Invariants

| Invariant | Relevance | How this task preserves it |
|---|---|---|
| I12 | the mechanism itself changes shape | rewritten in `docs/INVARIANTS.md`; the property — recorded durably, never edited or removed — is the same, checked per file |
| I15 | #5 retracted, #7 appended, then closed | retraction names this contract and `supersededBy: 7`; #7 appended `passes: false` in the same commit; closed in its own commit on a READY audit |
| I11 | every commit follows a green gate | the tree hash excludes `verify-log/` as it excluded the file, by the protected patch |

Domain rules: R5 (nothing here names a product), R7 (the tarball changes by nothing; `verify-log/` is seeded, not shipped).

## Open questions

None.
