---
name: setup-repo
description: Bring a fresh clone of this repository to a green gate, and prove it with a run rather than a claim. Use on a new machine, in a new worktree, or when the gate will not start.
allowed-tools: Bash(./verify.sh), Bash(node scripts/check-environment.mjs:*), Bash(pnpm install:*), Bash(docker compose:*), Bash(node scripts/migrate.mjs --status:*), Bash(git worktree list), Bash(node -v), Bash(pnpm -v), Read, Grep, Glob
---

Bring this clone to a green gate.

What this machine is missing:

!`node scripts/check-environment.mjs || true`

## Rule 0 — the setup is finished when `./verify.sh` is green, and not before

A setup that ends with "that should work now" has proved nothing. The check
above states what is missing; it does not establish that anything works. The
gate's steps passing is what establishes that, and it is the only thing that
does.

This is not a slogan here. The check exists because a fresh clone once could
not run the gate at all: a suite built a client for a third-party service
while the file was being collected, so a step threw for anyone without
credentials. Nobody had noticed because CI appended the secrets before running
the gate — the one environment that could have proved a clone works was the
one environment that always had credentials.

## Steps

### 1. Read the check, fix what it names

Every finding carries its own remedy. Two are worth expanding:

- **Docker** — asked for only when `harness.config.json` says the project has
  a database. Then the daemon has to be *running*, not merely present: the
  database steps start Postgres from `docker-compose.yml` themselves.
- **`.env`** — never required. The gate sources it when present and falls
  back to the configured values otherwise; the check says which of the two a
  run will use.

`gh` is reported and never counted against the machine: nothing in the gate
needs it, and `/open-pr`, `/review-pr` and `/address-comments` do.

### 2. Install the dependencies

```
pnpm install
```

Or skip it: the gate does this on its first run, because it checks for
`node_modules` before anything else.

### 3. Run the gate

```
./verify.sh
```

The steps are the `run_step` lines at the bottom of the gate; a project's
`AGENTS.md` says which are deferred and what has to exist first. The first
run is the slow one, and in a project with a database it pulls the Postgres
image, creates the test database and applies the migrations.

If a step fails, **read its log under `.generated/runs/<timestamp>/` before
changing anything.** `CONTRIBUTING.md` pairs each failure with the right
response.

### 4. Only if the work touches the UI

Start the application the way the project's `package.json` says — `pnpm
dev:web`, `pnpm dev:api` — and use it once through the browser. A UI
criterion is verified as a user would, and `curl` does not count.

When [agent-browser](https://agent-browser.dev) is on PATH, walk it with
that: `agent-browser open <url>`, `snapshot -i` for the page as a tree with
`@e1`-style references, `click @eN`, `fill @eN <text>`, `screenshot <file>`.
File the snapshots and screenshots under `.generated/ui/<yyyymmdd>T<hhmmss>Z/`
and name that folder in the pull request under **UI work**, so "tried in the
browser" is a folder a reviewer opens rather than a sentence. It is a walk,
not a suite: step 05 stays Playwright, and a walk does not close a criterion.

### 5. Report

The gate's result, and the run folder it wrote. If a step failed, the step,
the first real error in its log, and what you propose — not a fix already
applied.

## A second worktree

`git worktree add ../<name> -b <branch>`. The gate gives a linked worktree its
own ports and its own test database, derived from its path, so two can run at
once; every run records which it used in its summary.

That is the gate's half. For the dev servers a person opens in a browser,
[portless](https://portless.sh) names each worktree's server after its branch
(`fix-ui.myapp.localhost`) so nobody remembers a port; it is a choice for the
machine, not a prerequisite, and the gate neither uses it nor moves its ports
for it.

## What this skill does not do

It does not set up Docker, Node or pnpm. Those are decisions about the
machine, and a session that changes a toolchain unasked is a session that has
changed something nobody can see in the diff. It names what is missing and how
to get it; the person runs it.
