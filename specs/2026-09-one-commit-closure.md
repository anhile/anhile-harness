# Spec: a feature closes in one commit

- **Feature list entry**: #11 — "A feature closes in one commit: an entry may be appended already passing as that commit's one closure, asked for its READY audit by the gate and by CI's walk; PROGRESS.md is outside the tree hash, and the gate reads the journal itself before a commit"
- **Author / session date**: 2026-09-16
- **Status**: approved — the second half of the fast lane the person asked for, after spike branches (#10)

---

## Problem

A closed feature took three commits: the entry appended with `passes: false`,
the flip with its READY audit, and the journal entry naming that audit. Two
rules forced the shape. A new entry had to start `false` (I15), so opening
and closing were two commits. And the journal was under the tree hash, while
the audit is written after the run and the entry naming the audit after
that; so the entry could never be in the tree the audit described, and
took a commit of its own. Measured on 2026-09-16: about three commits and
eight gate runs per feature, for a gate that takes twenty seconds.

## In scope

- An entry may be appended with `passes: true`. Step 06 counts it as the
  commit's one closure, with the flips: two closures of any kind in one
  commit are refused as before. Step 06 does not ask the audit; it runs
  before the audit exists.
- The commit gate asks a born-passing entry for its audit exactly as it asks
  a flip: `closingEntries()` in the protected `audit-receipt.mjs` sees both.
- CI's walk asks the commit to carry the READY audit of its own tree for a
  born-passing entry as for a flip: `closedBetween()` in `audit-log.mjs`.
- `PROGRESS.md` is outside the tree hash: `UNHASHED` in the protected
  `verify-receipt.mjs` gains it, with `unhashed(rel)` as the one predicate,
  which `treeHashAt()` in `audit-log.mjs` now uses too, so a commit's tree
  hashes as the receipt hashed it.
- In exchange the commit gate runs `progress.mjs check --base HEAD` before a
  commit, after the append-only guards and after a spike has been let go
  (I16): an entry new since HEAD must be in the template's shape and name a
  run, and the READY audit when it closed something. By the protected patch
  to `check-commit-gate.mjs`.
- And `progress.mjs check` against a base asks that the journal be
  append-only, as the hash used to: every entry the base had is still there
  as it was, or under `docs/history/` where `rotate` moved it. The hash said
  so before; the check says so now, in the gate and in CI's walk.
- This entry, #11, closes in one commit, as the first of its kind.

## Out of scope

- The quick gate (`./verify.sh --quick`) and the cost metric. Separate work.
- Closing two entries in one commit. One closure per commit stands: one run,
  one audit, one thing the evidence is about.
- The rules on spike branches. A spike is asked nothing, including the
  journal; the check sits after the spike's return in the gate.

## Acceptance criteria (EARS)

- **AC1** (ubiquitous) — Step 06 shall accept a new entry with `passes:
  true` as the commit's one closure, and shall refuse it beside a flip or
  beside another born-passing entry.
- **AC2** (ubiquitous) — The commit gate shall refuse a born-passing entry
  with no READY audit of this tree under its contract, naming the entry, and
  shall let it through with one.
- **AC3** (ubiquitous) — CI's walk shall refuse a commit whose born-passing
  entry has no READY audit of the commit's own tree in the commit's
  `audit-log/`, and accept one that carries it.
- **AC4** (ubiquitous) — An edit to `PROGRESS.md` after a run shall leave
  the receipt's tree hash unchanged, and a commit's tree shall hash as the
  receipt hashed it with the journal left out.
- **AC5** (ubiquitous) — The commit gate shall refuse a commit whose journal
  has an entry new since HEAD that a reader cannot follow, citing I12 and
  the entry, and shall ask nothing of a spike's journal.
- **AC6** (ubiquitous) — A commit that opens, closes, audits and journals an
  entry at once shall pass every guard of CI's walk against its parent.
- **AC7** (ubiquitous) — `progress.mjs check` against a base shall refuse an
  entry the base had that is now edited or gone, or moved to `docs/history/`
  and edited there, and accept one that `rotate` moved unchanged; the gate
  shall refuse such a commit.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `feature-list.spec.ts` "accepts a new entry born passing, as the commit's one closure (since 2026-09-16)", "refuses a born-passing entry beside a flip: two closures in one commit", "refuses two entries born passing together" | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `commit-gate.spec.ts` "asks the audit of an entry born passing, as of a flip: one commit opens and closes it" (refused without, let through with the audit and the journal entry naming it, in one commit) | the case passes | same |
| AC3 | Jest — `audit-log.spec.ts` "asks the audit of an entry born passing, as of a flip: the same commit opens and closes it" (the walk's command on a real commit, without and with the audit) | the case passes | same |
| AC4 | Jest — `commit-gate.spec.ts` "an edit to PROGRESS.md after the run does not invalidate the receipt"; `audit-log.spec.ts` "is the two records and the journal, and nothing else, pinned on tree itself" | the cases pass | same |
| AC5 | Jest — `commit-gate.spec.ts` "refuses an entry new since HEAD whose Evidence points nowhere, naming the entry" (asserts `entry 2 (2026-09-16 — the work): Evidence names no run` and `I12`), "asks nothing of a spike's journal (I16)" | the cases pass | same |
| AC6 | Jest — `ci-workflow.spec.ts` "accepts the commit that opened, closed, audited and journaled #3 at once, under every guard of the walk": the four lines the workflow runs per commit (`check-feature-list.mjs`, `verify-log.mjs check`, `check-migrations.mjs`, `progress.mjs check`, each `--at --base`) on that commit. The walk on GitHub is the same four lines on this entry's own commit; its log is the pull request's `attest` job, named in the pull request body, and not evidence at audit time | the case passes | same |
| AC7 | Jest — `progress.spec.ts` "the journal is append-only against the base": edited, gone, moved by `rotate`, and moved then edited under `docs/history/`; `commit-gate.spec.ts` "refuses a journal entry reworded after the run: what the hash no longer sees, the check does" (and shows the receipt's hash unchanged by that edit) | the cases pass | same |

## Affected modules

- `scripts/check-feature-list.mjs`, `scripts/audit-log.mjs`, `scripts/progress.mjs` (`keptSince`, `archivedEntries`: an entry the base had is still in the journal with the same text, or under `docs/history/` with the same text)
- protected, by patches under `.generated/scratch/one-commit/` a person applies: `scripts/verify-receipt.mjs`, `scripts/audit-receipt.mjs`, `scripts/check-commit-gate.mjs`
- tests: `feature-list.spec.ts` (one case renamed and inverted: "refuses a new entry born passing" is now the acceptance, with the reason in its comment; the two-flips case reads the new message, exact with its ids), `audit-log.spec.ts` (the repository case names the last commit whose runs hashed the journal, `029366a`; at a HEAD at or before it the case asserts that no run matches, so the exemption is shown to be needed; from the next commit on, the original assertion runs — the shape of `PRE_RULE_COMMITS`), `commit-gate.spec.ts` (the fixture gains a journal and the config, since the gate reads the journal), `pr-ready.spec.ts` ("refuses when the tree moved after the run" moves a source file instead of the journal, and a new case says the journal does not move the tree), `ci-workflow.spec.ts`, `progress.spec.ts` ("the journal is append-only against the base": edited, gone, moved, and moved-then-edited)
- docs: `docs/INVARIANTS.md` (I11, I12, I13, I15), `AGENTS.md` and its seed in `harness-init.mjs`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/pull_request_template.md`, `.claude/skills/task-intake/SKILL.md`

## Definition of done

Entry #11 closes on AC1 to AC7 together, in one commit: this contract, the
entry born passing, the change, the run, the READY audit of that tree, and
the journal entry naming the run and the audit.
