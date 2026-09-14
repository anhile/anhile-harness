---
name: verify-task
description: Run the verification pipeline for a task contract and get an independent audit of the result.
argument-hint: [spec-file]
allowed-tools: Bash(./verify.sh), Bash(git diff:*), Bash(git status), Bash(git branch:*), Bash(git rev-list:*), Bash(git merge-base:*), Bash(git log:*), Bash(ls:*), Bash(node scripts/audit-receipt.mjs:*), Read, Grep, Glob, Task, Agent
---

<!--
Model-invocable since 2026-09-08. It was disable-model-invocation, so it ran
when a person remembered to type it, and across ninety feature entries nobody
did. The commit gate now refuses a closing commit without the receipt this
skill writes, so a session has to be able to run it. A person can still type
it at any time.
-->

Verification run for the task contract at `$1`.

Branch and diff summary:

!`git branch --show-current; git diff main...HEAD --stat | tail -5; git status --short`

## Step 0 - resolve the diff range

`main...HEAD` is empty when the work was committed directly onto `main`, which
this repository permits. Resolve the range before anything else:

- If `git rev-list --count main..HEAD` is greater than zero, the range is
  `main...HEAD`.
- Otherwise the work is on `main` itself. The range is the commits made for this
  task — identify them from `git log --oneline -10` and the contract's date, and
  use `<first-task-commit>~1..HEAD`.
- In both cases also run `git status --short`. Uncommitted files are part of what
  is being verified; if any exist, say so in the report, because `verify.sh`
  measured the working tree while the diff may not include them. When the
  audit is for a closing commit the flip is usually still uncommitted: append
  `git diff HEAD` to the range's diff so the auditor sees the tree the receipt
  will describe.

State the resolved range in the report. If you cannot resolve it unambiguously,
that is a **CANNOT VERIFY** outcome, not a guess.

## Step 1 - collect evidence

Run `./verify.sh`. Do not fix anything. Do not touch the code in this session.
If it exits non-zero, that is a result, not a problem to solve.

Note the path of the evidence folder it created under `.generated/runs/`.

`verify.sh` needs Docker running and will start Postgres if it is not up. If it
cannot, the step fails and that failure is part of the evidence — do not work
around it.

## Step 2 - independent audit

Delegate to the `spec-auditor` subagent.

Pass exactly these four things and nothing else:

1. The full diff for the range resolved in step 0
2. The contract file `$1`
3. The contents of the evidence folder from step 1
4. `docs/INVARIANTS.md`

Do NOT pass any of the following: your summary of what was implemented, the
conversation history, your assessment of whether the work is correct, or any
statement that the feature is finished. The auditor's value comes from not
knowing what was intended.

Phrase the delegation neutrally. Ask which acceptance criteria are not
supported by the evidence, and whether any invariant is violated. Do not ask
it to confirm that the implementation is correct.

## Step 2b - the attack surface, when it moved

If the diff touches any path listed under `attackSurface.paths` in
`harness.config.json` — the generator seeds it with the controllers, the
migrations and the routing files a project has, and a project extends it —
delegate to the `security-check` subagent with the same diff. Pass nothing else. Its report
opens with a verdict line — `no findings`, or a count by severity — and that
line is what goes into the receipt. If the diff touches none of those paths,
record `not run: surface unchanged`.

## Step 3 - report

Produce a verdict table, one row per acceptance criterion:

| Criterion | Mechanism | Evidence | Verdict |

Verdict is one of: confirmed, not confirmed, no mechanism.

Then list, separately:

- invariant violations found by the auditor
- files in the diff that are outside the affected modules listed in `$1`
- tests that were modified in this diff, with the reason if stated

Two checks specific to this repository belong in that second list:

- any change to `feature_list.json` other than a `passes` field flipping from
  `false` to `true`, or an entry appended with its `id` and this contract as
  its `spec` (`docs/INVARIANTS.md` I15)
- any change to a file under `migrations/` that the contract did not list, and
  any migration applied outside `verify.sh` (`docs/INVARIANTS.md` I8)

End with one of three lines and nothing more:

- READY FOR HUMAN REVIEW - every criterion confirmed, no violations
- NOT READY - listing exactly what is unconfirmed
- CANNOT VERIFY - a criterion has no mechanism, or evidence is missing

Do not recommend a merge. That decision belongs to the human.

## Step 4 - the receipt

Write what was concluded, about this tree, so the commit gate can read it:

```
node scripts/audit-receipt.mjs write --spec $1 --verdict <READY|NOT_READY|CANNOT_VERIFY> --security "<the security-check verdict line, or: not run: surface unchanged>"
```

It writes two things: the receipt at `.generated/audit.json`, which the commit
gate reads, and a file under `audit-log/`, which is tracked and append-only
and goes into the closing commit with everything else (`git add -A`). CI asks
of every commit that flips an entry whether it carries a READY audit of its
own tree; the log file is how it does.

The verdict is the line above, and nothing softer: READY only for READY FOR
HUMAN REVIEW. A closing commit — one that flips an entry's `passes` — goes
through the gate only on a READY receipt about the exact tree `./verify.sh`
passed; any edit after this step invalidates it, and the audit runs again. A
NOT READY receipt is a result to act on. Writing READY over a NOT READY report
is the forgery the receipt exists to make deliberate.
