# Spec: the record of audits is kept

- **Feature list entry**: #8 — "Every audit verdict is kept under audit-log/, one tracked file per audit, never edited or removed; a commit that closes an entry carries a READY audit of its own tree under that entry's contract, and CI refuses one that does not"
- **Author / session date**: 2026-09-14
- **Status**: approved — the person chose this debt next from the review of 0.1.0, after the record of runs

---

## Problem

A closing commit passes the gate on `.generated/audit.json`: the spec-auditor's
verdict about this tree, under this contract, saying READY. The file is
git-ignored and overwritten by the next audit. So the moment the commit lands,
nothing on record says an auditor ever looked; the READY that let the flip
through survives only in a session's transcript, and CI, which recomputes
every other claim from a clean clone, has nothing to recompute this one from.
The review of 0.1.0 wrote it down as "audit receipts that no log keeps".

## In scope

- `audit-log/`, one file per audit, named after the moment it was written,
  carrying the receipt's fields; `audit-receipt.mjs write` appends it beside
  writing the receipt, whatever the verdict.
- `audit-log.mjs check`: no file edited, removed or misnamed, every file
  parsing with its fields, none dated before its name; run by the commit
  gate before every commit, as verify-log's guard is.
- `audit-log.mjs closures --at --base`, and the same inside
  `check-feature-list.mjs --at`, which CI already runs per pushed commit: a
  commit that flips an entry to passing must carry, under `audit-log/`, a
  READY audit of its own tree under that entry's contract. The tree hash is
  recomputed from the commit the way the receipt computed it from the
  working tree.
- The directory outside the tree hash, beside `verify-log/`, by the
  protected patch; the commit gate's guard for it, by the protected patch.
- The invariants, the contributing table, the README, the pull-request
  template and the two skills that name the receipt say where the record is.

## Out of scope

- Reading the auditor's *report*. The log keeps the verdict line and what it
  was about; whether READY was earned stays with review, as I15 says.
- A log of security-check findings beyond the one line the receipt carries.
- Migrating anything: the receipt had no history to migrate. Entries #0–#7
  were closed before the log existed, and their audits are in `PROGRESS.md`
  and the pull requests only.
- The pre-push hook asking the closure question; it attests the tip, and CI
  walks the commits.

## Design source

None.

## Acceptance criteria

- **AC1** (event-driven) — When `audit-receipt.mjs write` records a verdict,
  the harness shall append one file under `audit-log/`, named
  `<yyyymmdd>T<hhmmss>.<ms>Z.json` after the receipt's `at`, carrying the
  receipt's fields, for every verdict and not only READY.
- **AC2** (unwanted) — If a file under `audit-log/` is edited, removed, not
  named as an audit, not JSON, missing `spec`, `verdict`, `at` or
  `treeHash`, or dated before its name, then `audit-log.mjs check` and the
  commit gate shall refuse, naming the file.
- **AC3** (unwanted) — If a commit flips an entry's `passes` to true and its
  own `audit-log/` holds no audit of the commit's tree under the entry's
  contract with the verdict READY, then `check-feature-list.mjs --at <that
  commit> --base <its parent>` shall refuse, naming the entry and what the
  audits it did find said.
- **AC4** (ubiquitous) — `audit-log.mjs tree <ref>` shall equal
  `verify-receipt.mjs hash` for a checkout of `<ref>` with no untracked
  files, leaving out `verify-log/` and `audit-log/` and nothing else.
- **AC5** (ubiquitous) — Recording an audit shall not change the tree hash
  the audit names.

## Verification plan

| Criterion | Verification mechanism | Pass condition | Evidence output |
|---|---|---|---|
| AC1 | Jest — `audit-receipt.spec.ts` "write › appends the verdict to audit-log/, whatever it is" (READY and NOT_READY, the name from `at`, the fields); `audit-log.spec.ts` "append: what the log keeps" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `audit-log.spec.ts` "what the log refuses" (rewritten, removed, stray, not JSON, missing fields, dated before its name); `commit-gate.spec.ts` "refuses a commit when a recorded audit has been rewritten", "…removed" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC3 | Jest — `audit-log.spec.ts` "a committed closure carries its audit": no audit, a READY audit of this tree, NOT_READY, another tree, another contract, each through `check-feature-list.mjs --at --base` on a real commit; `ci-workflow.spec.ts` still walks a two-commit sequence | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC4 | Jest — `audit-log.spec.ts` "the tree of a commit hashes as the receipt hashed it", with an executable file and a symlink in the commit | the case passes | `.generated/runs/<ts>/03-unit.log` |
| AC5 | Jest — `attestation.spec.ts` "what the tree hash leaves out › is verify-log/ and audit-log/, and nothing else" | the case passes | `.generated/runs/<ts>/03-unit.log` |

Entry #8 closes on AC1 to AC5 together: one entry, one commit, one audit —
and that audit is the first file under `audit-log/` in this repository,
carried by the commit it lets through.

## Affected modules

- `scripts/audit-log.mjs` — new
- `scripts/check-feature-list.mjs`, `scripts/harness-init.mjs` (one line of the AGENTS seed)
- `scripts/verify-receipt.mjs`, `scripts/audit-receipt.mjs`, `scripts/check-commit-gate.mjs` — protected; the prefix the hash leaves out, the append beside the receipt, the gate's second guard; written under `.generated/scratch/audit-log/` and applied by a person
- `harness.manifest.json`, `feature_list.json`, `PROGRESS.md`, `CHANGELOG.md`, `docs/INVARIANTS.md`, `CONTRIBUTING.md`, `README.md`, `.github/pull_request_template.md`, `.claude/skills/open-pr/SKILL.md`, `.claude/skills/verify-task/SKILL.md`
- `specs/2026-09-audit-log.md` — this file
- tests: `scripts/__tests__/audit-log.spec.ts`, added; `audit-receipt.spec.ts`, `commit-gate.spec.ts`, `attestation.spec.ts`, `ci-workflow.spec.ts`, `feature-list.spec.ts` — fixtures gain the module the patched scripts import, and the cases named above. No case weakened.

## Invariants

| Invariant | Relevance | How this task preserves it |
|---|---|---|
| I11 | the hash leaves out a second prefix | `audit-log/` only, by the protected patch; the gate runs the directory's own guard where the hash cannot see |
| I12 | a second record beside the first | the same properties, checked the same way, per file |
| I13 | a claim checkable off the author's machine | a committed closure's audit is recomputed from the commit by CI |
| I15 | #8 appended, then closed; the audit before a closing commit is now kept after it | appended `passes: false` in the first commit; closed in its own commit on a READY audit that the commit carries |

Domain rules: R5 (nothing here names a product), R7 (the tarball gains one
script, listed in the manifest, and the package suite holds it there).
`audit-log/` is neither shipped nor seeded: git keeps no empty directory,
and the first audit creates it.

## Open questions

None.
