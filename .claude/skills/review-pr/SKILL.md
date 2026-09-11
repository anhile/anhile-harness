---
name: review-pr
description: Review the current branch or a pull request with several reviewers working from one brief, and report only findings that name a file, a line and a consequence. Use after a pull request is open and CI is green.
argument-hint: [pr-number]
allowed-tools: Bash(node scripts/pr-review-brief.mjs:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git merge-base:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh pr comment:*), Read, Grep, Glob, Task, Agent
---

Review the change on this branch, or the pull request given as `$1`.

The shared brief every reviewer gets:

!`node scripts/pr-review-brief.mjs`

## What a review here is for

Five mechanisms ran before this. ESLint, the type check, the unit suites, the
e2e suites, the coverage floor, the append-only guards, the mutation score,
and the attestation all had their say, and CI recorded it. **A reviewer who
re-checks what they checked is spending attention on the cheapest part of the
change.**

What no mechanism judges:

- whether the contract was the right contract
- whether a criterion was met in letter and missed in spirit
- whether a claim in the journal or the pull request body is larger than the
  evidence under it

The third is this repository's actual failure mode. Eleven recorded cases of a
check that passed while proving nothing; on 2026-09-11, five audits of a single
entry, every one finding prose that had outrun its tests, and two green runs
that proved nothing about the thing they were run to prove. Weight the review
accordingly.

## Rule 0 — a finding names a file, a line, and a consequence

Several reviewers produce a lot of confident nonsense. The filter is not
politeness, it is form: **a finding that cannot name the file, the line, and
what goes wrong as a result is not a finding.** Drop it. Do not soften it into
a "consideration" or a "nit" and report it anyway — that is the same noise with
an apology attached.

Two things that look like findings and are not:

- *"This could be clearer."* No consequence. Drop it.
- *"Consider extracting a helper."* No consequence, and the reviewers cannot
  see how often the code changes. Drop it.

Two things that are:

- *"`stats.service.ts:41` returns before the ownership check when `userId` is
  undefined rather than null, so an owned link answers a stranger."*
- *"The journal says the refusal carries no counts; `ownership.e2e-spec.ts:218`
  asserts the absence of the field names only, so a count under another key
  passes."*

## The reviewers

Four, not five, and each has a question the others do not:

| Reviewer | Question | When |
|---|---|---|
| `spec-auditor` | do the entries this claims hold up against their contract and the invariants | any change that opens, closes or retracts an entry |
| `security-check` | is there a path from attacker-controlled input to a consequence | only when the brief says the attack surface moved |
| the claim reader | is anything asserted in `PROGRESS.md` or the pull request body larger than the evidence under it | always |
| `/code-review` | correctness, reuse, simplification | always |

There is no fifth for the sake of a fifth. A reviewer without a question of its
own returns the same findings as its neighbour and makes the reader arbitrate
duplicates.

Give each the **same brief above and the same diff**, and nothing else — not
your summary, not what the author meant, not whether you think it is correct.
The auditors' value comes from not knowing what was intended.

## Steps

1. **Read the brief.** If it says `no recorded run on this branch`, stop: there
   is nothing to review yet.
2. **Get the diff.** `gh pr diff <n>` for a pull request, `git diff <range>`
   from the brief otherwise.
3. **Dispatch the reviewers that apply**, per the table. Skip `security-check`
   when the brief says the surface is unchanged, and say that you skipped it
   and why.
4. **Filter by Rule 0.** Report how many findings each reviewer produced and
   how many survived. That ratio is worth watching over time.
5. **Verify what survives.** A finding is a claim; check it against the code
   before repeating it. A reviewer that named the wrong line is still telling
   you something, but not what it thinks.
6. **Report**, findings first, most serious first. Then one line on what was
   checked and found nothing, so a reader knows the silence was earned.

## Posting

Post as **one** comment, with `gh pr comment <n> --body-file <file>`, and only
when the user asks for it. Several inline comments from a machine read as a
swarm and get dismissed as one.

Never approve, never merge, never resolve a human's comment. A review from a
session is an argument put to a person, and the person decides.
