# AGENTS.md

Read this before changing anything in anhile-harness. It is written for any
agent, not one in particular.

## The rules

**1. The gate decides, not you.** `./verify.sh` is 6 steps and the only
thing that establishes the code works. A red gate is fixed, never worked around.

**2. A commit carries a tree the gate has passed.** The receipt records a hash
of the working tree — the journal excepted, which the gate reads on its own —
so any edit after a green run invalidates it.

**3. Claims are earned, not asserted.** `feature_list.json` is a list of
guarantees; an entry's `passes` is `true` only on evidence, one closure per
commit — opened and closed in the same commit when the work is small — and a
closing commit needs an independent audit saying READY.

**4. Work reaches `main` through a pull request.** Branch first, not after.
A branch under `spike/` is exploration: no receipt, no journal, no contract,
no audit — and no pull request. What survives is rebuilt on a branch of its
own (I16).

**5. Anything underspecified is a question, not a guess.**

**6. Measure before you conclude.** Reading a script tells you what it was
meant to do.

**7. Secrets never enter the session.** `.env` is not read, printed or copied.

## What refuses what

| Mechanism | Refuses |
|---|---|
| `./verify.sh` step 06 | two entries closed in one commit, or a rewritten one |
| the commit gate | a commit whose tree no green run covers, a closure without its READY audit, a journal entry a reader cannot follow |
| protected-file guard | a session edit to `verify.sh`, the CI workflow, or `.claude/settings.json` |
| `spike.mjs`, in the gate, the hooks and CI | nothing on a `spike/*` branch; and a pull request from one |
| append-only guards | a run under `verify-log/` edited or removed, or a rewritten line in `feature_list.json` |

Write a patch under `.generated/scratch/` for a protected file and ask a person
to apply it.

## What to fill in

This file was generated. `docs/INVARIANTS.md` holds what must never change
here and how each is checked, under the numbers the shipped scripts cite;
`docs/DOMAIN_RULES.md` holds what the harness promises a project that adopts
it, R1 to R7. One thing is still yours to write:

- the layer rules in `eslint.config.mjs`, and a suite that fires at them

## MCP servers

`.mcp.json` declares these. Declared is not connected: each is authorised
once, by a person, and until then its tools are absent rather than broken.

- **context7** — Current documentation for a library, by name. Read it before writing against an API from memory — that is rule 6 with a tool attached.
- **notion** — Where feature specs live. `/task-intake` reads a row and refuses anything that is not one.

A server whose purpose you cannot state is a tool call you should not make.
Adding one is a change to this list as much as to the JSON.
