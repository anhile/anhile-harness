# Claude Code in this repository

**Read [AGENTS.md](AGENTS.md) first.** It holds what this project is and the
rules, for any agent. This file carries only what is specific to Claude Code.

## Session-start ritual

1. `git log --oneline -20`, and read the newest entries of `PROGRESS.md`.
2. Read `feature_list.json` and pick **one** entry that is not done.

## Hooks

Configured in `.claude/settings.json`: the commit gate and the work budget
before a tool call, the protected-file comparison after one, and a check at
the end of a session that the journal was written and nothing is invisible to CI.

## Skills

`/setup-repo`, `/task-intake`, `/verify-task`, `/open-pr`, `/review-pr`,
`/address-comments`. Each says what it refuses and why.

## Definition of done in anhile-harness

A contract in `specs/`, `./verify.sh` green, `passes` flipped, an entry in
`PROGRESS.md`, a commit, and a merged pull request.
