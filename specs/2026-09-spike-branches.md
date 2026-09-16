# Spec: a spike branch proves nothing and cannot reach main

- **Feature list entry**: #10 — "A branch under spike/ is asked for no receipt at commit time and no journal entry at session end, is refused as a pull request by check-pr-ready and by CI's attest job, and keeps the protected files protected; the generator ships the rule"
- **Author / session date**: 2026-09-16
- **Status**: approved — the person asked for a fast lane, spikes first

---

## Problem

The rituals exist so that "done" is a claim a stranger can check: a receipt
at commit time, a journal entry at session end, a contract, an audit. In the
first days of a project nothing is done and nothing is claimed; what happens
is exploration. Measured on 2026-09-16 in this repository: about eight gate
runs and three commits per feature, with the gate itself at twenty seconds.
The cost is the number of steps, and the steps prove things a spike does not
claim.

## In scope

- A branch named `spike/<anything>` is a spike. `scripts/spike.mjs` says so,
  prints the note, and carries the CI form `check --branch`.
- The commit gate asks a spike for no receipt: green, red or absent, the
  commit goes through, and stderr says the branch is a spike. With the
  receipt goes everything the receipt establishes: the tree hash, the
  closing audit, the index against the tree. Two things run on every branch
  as before: the protected-file checks (I11), before that decision, and the
  append-only guards for `audit-log/` and `verify-log/` (I15, I12) — a spike
  claims nothing, and rewrites nothing.
- The stop hook asks a spike for nothing: no journal entry, no push reminder.
- The start ritual prints the note under the branch line.
- `check-pr-ready.mjs` refuses a spike, and CI's attest job refuses a pull
  request from one before it walks anything, with the same sentence; by the
  protected patch to `.github/workflows/verify.yml`.
- The generator ships `scripts/spike.mjs` (manifest core) and the seed
  `AGENTS.md` names the rule; `docs/INVARIANTS.md` gets I16, so a project's
  own invariants start at I17.

## Out of scope

- The work budget. It bounds a turn, it proves nothing, and a spike that
  runs away is still a spike that runs away.
- Branch protection on GitHub. The refusal in `attest` makes a spike pull
  request red; whether red can be merged is the repository's setting, not the
  harness's.
- Moving a spike to `main` by any path but rebuilding it. What survives is
  rebuilt on a branch of its own, with the contract and the closure as usual.
- `./verify.sh` itself: a spike may run it, and the run is recorded like any
  other. The gate is not what a spike is exempt from; the *asking* is.
- The journal entry that names this closure's run and audit. It follows the
  closing commit, as `specs/2026-09-journal-pointers.md` explains; the
  human's application of the two protected patches is recorded there.
- Proving on this machine that GitHub runs the refusal step. The workflow's
  text is pinned; the run is this pull request's `attest` job, and the pull
  request body names it.

## Acceptance criteria (EARS)

- **AC1** (ubiquitous) — On a `spike/*` branch the commit gate shall let a
  commit through with no receipt, or a red one, saying so on stderr; and
  shall still refuse an edit to a protected file, a run removed from
  `verify-log/`, and an audit rewritten under `audit-log/`.
- **AC2** (ubiquitous) — On a `spike/*` branch the stop hook shall not block
  for a missing journal entry nor for unpushed commits.
- **AC3** (ubiquitous) — On a `spike/*` branch the start ritual shall print
  what a spike is, naming I16, under the branch line.
- **AC4** (ubiquitous) — `check-pr-ready` shall refuse a `spike/*` branch,
  and `spike.mjs check --branch <name>` shall exit 3 with the same sentence;
  the attest job shall run it on a pull request's head branch before the
  attestation step.
- **AC5** (ubiquitous) — A branch not under `spike/` (including one named
  `spike-...`) shall be asked everything it was asked before.
- **AC6** (ubiquitous) — A generated project shall receive `scripts/spike.mjs`
  and an `AGENTS.md` that names the rule.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `commit-gate.spec.ts` "a spike branch is asked for no receipt (I16)": no receipt (stderr asserted), red receipt, protected edit, a run removed (I12), an audit rewritten (I15) | the cases pass | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `session-hooks.spec.ts` "session-stop lets a spike stop with commits and no journal entry, and no push reminder": the fixture has an origin, so the push reminder could have fired; the same commits on a non-spike branch block | the case passes | same |
| AC3 | Jest — `session-hooks.spec.ts` "session-start says what a spike is, once, under the branch line" (the note appears exactly once); `spike.spec.ts` pins the note's sentences | the cases pass | same |
| AC4 | Jest — `pr-ready.spec.ts` "refuses a spike branch…"; `spike.spec.ts` "the CI form…" (exit 3, same sentence); `ci-workflow.spec.ts` "the attest job runs spike.mjs check on the head branch of a pull request, first" (the step named, before attestation, on pull_request only). The run on GitHub is this pull request's `attest` job | the cases pass | same |
| AC5 | Jest — `commit-gate.spec.ts` "asks the receipt again the moment the branch is not a spike"; `session-hooks.spec.ts` "asks again on a branch that is not under spike/"; `pr-ready.spec.ts` "does not take a branch merely named spike-… for a spike"; `spike.spec.ts` "is any branch under spike/, and nothing else" and "lets any other branch through" | the cases pass | same |
| AC6 | Jest — `harness-init.spec.ts` "copies the scripts the gate calls…" asserts `scripts/spike.mjs`; "the rules a project starts with › names the spike rule in AGENTS.md, and starts the project's own invariants at I17" reads the generated file | the cases pass | same |

## Affected modules

- new: `scripts/spike.mjs`, `scripts/__tests__/spike.spec.ts`
- `scripts/session-stop.mjs`, `scripts/session-start.mjs`, `scripts/check-pr-ready.mjs`, `scripts/harness-init.mjs` (seed text), `harness.manifest.json`
- protected, by patches under `.generated/scratch/spike/` a person applies: `scripts/check-commit-gate.mjs`, `.github/workflows/verify.yml`
- tests: `commit-gate.spec.ts` (its `runGate` keeps the gate's stderr on the allow path, since a case asserts it), `session-hooks.spec.ts`, `pr-ready.spec.ts`, `ci-workflow.spec.ts`, `harness-init.spec.ts` — fixtures gain `spike.mjs` beside the scripts that import it; no case weakened
- docs: `docs/INVARIANTS.md` (I16; yours from I17), `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.claude/skills/open-pr/SKILL.md`

## Definition of done

Entry #10 closes on AC1 to AC6 together, after the two protected patches are
applied by a person and the gate is green on the tree that carries them.
