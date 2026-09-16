---
name: open-pr
description: Open a pull request for the current branch, with the evidence a reviewer needs already in the body. Use when work on a branch is finished and green.
allowed-tools: Bash(node scripts/check-pr-ready.mjs:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-list:*), Bash(git merge-base:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(node scripts/audit-receipt.mjs:*), Bash(node scripts/verify-receipt.mjs:*), Read, Grep, Glob
---

Open a pull request for the current branch.

Readiness, as the mechanism sees it:

!`node scripts/check-pr-ready.mjs || true`

Branch and range:

!`git branch --show-current; git log --oneline origin/main..HEAD | cat`

## Rule 0

`check-pr-ready.mjs` is the gate, not your judgement of what it said. A refusal
is a stop: report its lines, do what they say, run it again. Do not open the
pull request to "see what CI thinks", and do not argue with a refusal in the
pull request body.

Until 2026-09-12 one refusal needed a paragraph: a branch whose newest gate
run was older than main's, because the record was one append-only file and
two branches appending to it conflicted on every merge. The record is a file
per run now, and that refusal is gone with its reason.

## Steps

### 1. Read the refusals, or proceed

If the check refused, stop here and report. Everything below assumes it said
`ok`.

### 2. Push the branch

```
git push -u origin <branch>
```

### 3. Gather what the body needs

Each of these is a fact somewhere in the repository, never a recollection:

- **the contract** — the `spec` field of any entry this branch opened or
  closed in `feature_list.json`, or "none: harness work"
- **entries opened, closed, retracted** — from `git diff origin/main..HEAD --
  feature_list.json`, reading the `passes` and `retracted` fields, not the
  commit subjects
- **the verify run** — the newest file under `verify-log/` on this branch:
  its `at`, `result`, and `tree`
- **the audit verdict** — the newest file under `audit-log/` on this branch
  (`node scripts/audit-log.mjs tail 1`), if a commit in the range closes an
  entry; otherwise "not a closing change"
- **the journal entry** — the `## <date> — <title>` heading this branch added
  to `PROGRESS.md`
- **UI** — whether any file under `apps/web` or an `e2e` directory changed,
  and if so what was tried in a real browser, and the folder under
  `.generated/ui/` holding the agent-browser snapshots and screenshots of
  that walk, when there is one

A claim you cannot source from one of those does not go in the body.

### 4. Write the body from `.github/pull_request_template.md`

Fill every section of the template. A section that does not apply says "none"
and why, rather than being deleted: the template's shape is what lets a
reviewer see a missing claim.

The last section, *What a reviewer should look at*, is the only one that is
not mechanical, and it is the only one worth their time. Two or three
sentences on the decision that was not obvious, the invariant that came
closest, or the thing no mechanism here can judge. If the honest answer is
"nothing, this is mechanical", write that.

Do not summarise the diff. The reviewer can read it, and a summary that drifts
from it is worse than none.

### 5. Open it

```
gh pr create --base main --head <branch> --title <title> --body-file <file>
```

The title is the same shape as a commit subject: a type, a scope, and what
changed. Not "PR for the accounts work".

### 6. Report

The URL, and what CI will decide:

| Job | On this pull request |
|---|---|
| `attest` | does a recorded passing run cover this exact content, and are the append-only files still append-only |
| `verify` | `./verify.sh` from a clean checkout |
| `mutation` | would the unit suites notice if the mutated code were wrong |
| `witness` | skipped: it runs weekly and on demand |

Say plainly that `attest` fails for any commit made without running the gate —
that is what it is for — and that this is why dependabot's pull requests are
red on it.

## What this skill does not do

It does not merge. It does not approve. It does not run the reviewers: that is
`/verify-task` before the commit, and a human after it. A pull request opened
by a session is a request for a person's attention, and opening one is the
whole of the request.
