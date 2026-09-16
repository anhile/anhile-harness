# Contributing

[AGENTS.md](AGENTS.md) holds the rules; this file is the path through them for
a person.

## The loop

1. Branch from `main`. Work reaches `main` through a pull request, never
   directly.
2. Pick one entry in `feature_list.json` that is not done, or write the
   contract in `specs/` for a new one. Underspecified is a question, not a
   guess.
3. Make the change, and run `./verify.sh`. The gate is the only thing that
   establishes the code works; a red gate is fixed, never worked around.
4. Write the `PROGRESS.md` entry — `node scripts/progress.mjs template` prints
   the shape; Evidence names the `verify-log/<id>` of the run(s) you made, and
   the `audit-log/<id>` that said READY if an entry closed — and commit. For
   a small feature that is one commit: the contract, the entry in
   `feature_list.json` born passing, the change, the run, the READY audit,
   and the journal entry naming both. The journal is outside the tree hash so
   the entry can name the audit; in exchange the commit gate reads it. The
   gate refuses a tree no green run covers, a closure without its audit, and
   an entry whose Evidence a reader cannot follow; the stop hook and CI ask
   the same of the journal.
5. `/open-pr`, then `/review-pr`, then `/address-comments`.

## A spike

Not every branch is a claim. `git checkout -b spike/<anything>` and the
rituals stand down: no receipt at commit time, no journal entry at session
end, no contract, no audit. The protected files stay protected, and
`./verify.sh` still runs when you want to know. A spike cannot become a pull
request — `check-pr-ready.mjs` refuses it and CI's `attest` job repeats the
refusal — so what survives is rebuilt on a branch of its own and closed the
usual way, and the spike is deleted. `docs/INVARIANTS.md` I16.

## What the gate refuses, and why

| Step | Refuses |
|---|---|
| 06 `feature-list` | any change to `feature_list.json` other than appending an entry (with `passes: false`, or already `true` as the commit's one closure), flipping one entry `false → true`, retracting entries under one contract, or recording a `spec` where there was none; two closures in one commit; a retraction edited, undone, or sharing a commit with a closure |
| 07 `verify-log` | a recorded run under `verify-log/` edited or removed; the commit gate asks the same of the audits under `audit-log/` |
| 08 `coverage` | a lowered floor, or a source file nothing counted |

The reasons are in [docs/INVARIANTS.md](docs/INVARIANTS.md), by number.

## Withdrawing a guarantee

An entry in `feature_list.json` is never deleted. To withdraw it, mark it
`retracted` with the contract that withdraws it, a reason, and either the entry
it moved to (`supersededBy`) or `null`. That is I15, and `check-feature-list.mjs`
holds every shape of it.

## Protected files

`verify.sh`, `.github/workflows/verify.yml` and `.claude/settings.json` are not
edited by a session. Write the patch under `.generated/scratch/` and a person
applies it.
