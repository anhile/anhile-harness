# anhile-harness

[![npm](https://img.shields.io/npm/v/anhile-harness?logo=npm&label=npm)](https://www.npmjs.com/package/anhile-harness)
[![verify](https://github.com/anhile/anhile-harness/actions/workflows/verify.yml/badge.svg)](https://github.com/anhile/anhile-harness/actions/workflows/verify.yml)
[![generate](https://github.com/anhile/anhile-harness/actions/workflows/generate.yml/badge.svg)](https://github.com/anhile/anhile-harness/actions/workflows/generate.yml)
[![node](https://img.shields.io/node/v/anhile-harness?logo=node.js&logoColor=white)](https://nodejs.org)
[![licence: MIT](https://img.shields.io/npm/l/anhile-harness)](LICENSE)

A gate that refuses a commit whose claims are not earned, and a generator that
puts it in a new project.

```bash
npx anhile-harness init
```

It asks for a name, then gives you two numbered lists — what is in the project,
and which MCP servers it should declare — and each line says what choosing it
puts in the repository. Then it writes the project, and the project passes its
own `./verify.sh` on the first run. That is the bar it is built to: a scaffold
that leaves you with a red gate has taught its first lesson backwards.

## Contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [What it writes](#what-it-writes)
- [The gate](#the-gate)
- [The idea](#the-idea)
- [Working with Claude Code](#working-with-claude-code)
- [Configuration](#configuration)
- [What this does not do](#what-this-does-not-do)
- [What the package carries](#what-the-package-carries)
- [How this repository checks itself](#how-this-repository-checks-itself)
- [Licence](#licence)

## Prerequisites

| | Needed for | Version |
|---|---|---|
| **Node** | everything | 24 or later; a generated project pins the patch in `.nvmrc` |
| **pnpm** | installing, and every gate step runs through `pnpm exec` | 10; `corepack enable` gives you the one `package.json` names |
| **git** | the commit gate, the attestation, the hooks | any recent |
| **bash** | `verify.sh` and the pre-push hook are shell scripts | macOS and Linux as they come; Windows only through WSL, which is untested |
| **Docker** | only if you answer yes to a database: the gate starts Postgres from `docker-compose.yml` | any recent |
| **gh** | only `/open-pr`, `/review-pr` and `/address-comments` | any recent, authenticated |
| **Claude Code** | optional: the skills, hooks and agents are for it and ignored by anything else | current |
| **agent-browser** | optional: a session walking the UI as a user would, with snapshots filed as evidence; step 05 does not use it | `npm install -g agent-browser`, then `agent-browser install` |

A generated project can tell you which of these it is missing:

```bash
node scripts/check-environment.mjs
```

It states what is absent and what fixes it, and then `./verify.sh` is the
proof; a setup that ends with "it should work now" has proved nothing.

## Quick start

Interactive, which is the way to do it the first time:

```bash
npx anhile-harness init
```

Non-interactive, for CI and for scripts. Every flag is one of the answers the
prompt would have asked for:

```bash
npx anhile-harness init --yes --name my-thing --into ../my-thing --api --web --database --mcp context7,vercel
```

Then, in the new project:

```bash
cd ../my-thing && ./verify.sh
```

The first run installs dependencies and passes. `npx anhile-harness files`
lists what the package carries, which is what a new project gets; `--help`
prints the rest.

The package, the command it installs and the repository share one name,
`anhile-harness`, and the command is not `harness` on purpose: a `bin` is not
namespaced, and lands in every consumer's `node_modules/.bin` where a second
package claiming `harness` would win or lose unpredictably. Unscoped, because
the scope that matched the name belongs to somebody else on npm.

## What it writes

```
What is in it?
  1  a database, with migrations
  2  an HTTP API on NestJS, deployed as one serverless function
  3  a browser UI on React, built by Vite
```

Take the API and you get `apps/api`, `api/index.ts` and a `vercel.json` that
routes every path through one function; take the page and you get `apps/web`
with a component and a test. Neither is a placeholder: the API ships with four
tests around the serverless handler, and each of the three files that carries a
scar from this harness's own production failures says which one, in a comment
beside the line that exists because of it. The sources are real files under
`templates/`, at the path they take in your project, so what you read there is
what you get.

Take a database and you get `docker-compose.yml`, a `migrations/` directory
with a README that says when a migration may run unattended, and `migrate.mjs`.

Take nothing, and you get the gate around an empty repository, which is a
perfectly good place to start.

The second list is MCP servers — `context7`, `notion`, `vercel` — each declared
in `.mcp.json` and connected by a person later, so until then its tools are
absent rather than broken.

## The gate

`./verify.sh` runs six steps, in order, and stops at the first red one. Each
step writes its log into an evidence folder under `.generated/runs/`, and a
green run writes a receipt: a hash of the tree it passed.

| Step | What it refuses |
|---|---|
| 01 `eslint` | code the lint rules refuse |
| 02 `typecheck` | code that does not compile, in every workspace project |
| 03 `unit` | a failing case, with every case named in the log |
| 06 `feature-list` | any change to `feature_list.json` other than appending, one flip to `true` per commit, or a retraction under a contract |
| 07 `verify-log` | a recorded run edited or removed |
| 08 `coverage` | a lowered floor, or a source file nothing counted |

Steps 04 (`api-e2e`), 05 (`browser-e2e`) and 09 (`migrations`) are not
written into a new project even when you answer yes to the thing they test,
because nothing the generator wrote can pass them yet. It says so, and your
project's `AGENTS.md` carries the exact line to add for each one when the thing
it checks exists. A gate with a step that cannot pass is a gate people learn to
run with `|| true`.

Around the steps, the mechanisms:

| | |
|---|---|
| a receipt | the hash of the tree the gate passed, checked at commit time; an edit after the run invalidates it |
| `feature_list.json` | the guarantees, append-only, one closed per commit, each closure audited |
| `verify-log/` | every run, one file each, red runs included, never edited or removed, recomputable from a clean clone |
| `audit-log/` | every audit verdict, one file each, NOT READY included; a commit that closes an entry carries the READY audit of its own tree, and CI checks that it does |
| `PROGRESS.md` | the journal, and a hook that will not let a session end without writing it; an entry's Evidence names a run and an audit by id, and CI follows the pointer |
| CI `attest` | every pushed commit checked for a recorded passing run that covers its exact tree |
| protected files | the gate and the guards, hashed; a session may not change them without a person |

Two worktrees, two gates, one machine: a linked worktree takes its own ports
and its own test database, derived from its path, so two gates run at once
without coordination, and every run records which it used in its summary.
That covers the gate. For the dev servers a person opens in a browser,
[portless](https://portless.sh) gives each worktree a named URL
(`fix-ui.myapp.localhost`) instead of a port to remember; the gate does not
use it and nothing here depends on it.

## The idea

Most projects can tell you whether the tests passed. Few can tell you whether
the claim that a feature works was *earned*. This is a set of mechanisms for
the second question.

An entry in `feature_list.json` flips from `false` to `true` only on evidence,
one per commit, and only when an independent audit of that exact tree says
READY. The tree is hashed, so an edit after a green run invalidates the run. CI
recomputes the hash from a clean clone, which turns a session's report about
itself into a claim that can fail.

None of it is clever. All of it exists because something once passed while
proving nothing.

## Working with Claude Code

The skills, hooks and agents under `.claude/` are for Claude Code, and nothing
else reads them. A project without it keeps the gate and loses the ceremony.

| Skill | What it does |
|---|---|
| `/setup-repo` | brings a fresh clone to a green gate, and proves it with a run |
| `/draft-feature` | writes a feature idea up as a spec, in Notion or in `specs/inbox/` |
| `/task-intake` | turns a spec into a task contract in `specs/`, with acceptance criteria in EARS notation |
| `/verify-task` | runs the gate for a contract and hands the result to an auditor that was told nothing about the intent |
| `/open-pr` | opens a pull request with the evidence already in the body |
| `/review-pr` | several reviewers from one brief; only findings that name a file, a line and a consequence |
| `/address-comments` | gives every review comment an outcome, and drops none silently |

Two agents: `spec-auditor`, which audits a closing change from the diff, the
contract and the evidence alone, and `security-check`, which reviews a change
against the attack surface the configuration declares.

A session that touches the UI walks it once as a user would before it claims
anything about it. With [agent-browser](https://agent-browser.dev) on the
machine that walk is cheap — a page as a tree of `@e1` references rather than
a screenshot per step — and what it saw is filed under `.generated/ui/` and
named in the pull request. A walk is not a suite: step 05 stays Playwright.

The hooks stop a session where a person would: the commit gate refuses a
commit whose tree no green run covers, the work budget asks after a configured
number of tool calls whether to continue, the protected-file check notices the
gate itself being edited, and the stop hook refuses to end a session whose work
is not in the journal.

## Configuration

One file, `harness.config.json`, written for you and edited rather than the
scripts. It carries the coverage sources, the migrations directory, the gate's
ports, the attack surface a security review is triggered by, the work budget,
where `/task-intake` reads specs from, and the suffix that decides when a
migration may run unattended.

That last one is refused if it does not read as deliberate — an underscore and
at least three characters — because it is the whole of what keeps an unattended
migration off a real database.

## What this does not do

**Upgrade a project that already adopted it.** A generated project keeps the
snapshot it was given. Improvements here do not reach it; `CHANGELOG.md` says
what changed, and moving a change over is by hand.

**Guard its own scripts once they are in your project.** The scripts are
copied, not linked, and the suites that fire at them stay in this package's
repository. If you edit a copied guard, nothing in your project notices.

**Run on Windows without WSL.** The gate is a bash script and so is the
pre-push hook.

The first two are consequences of copying rather than depending, and both are
the next thing to fix.

## What the package carries

`npm pack --dry-run` is the answer, and `harness-package.spec.ts` holds it to
the manifest on every run: the scripts, the templates, the skills and the
agents, the specs template, `verify.sh`, the CI workflow, the pre-push hook,
and the two files the generator reads — `harness.manifest.json` for what
travels and `harness.versions.json` for what the scaffolds were written
against. Not the guard suites, which assert this repository; not the workflows
that gate this repository's own generator and publish it; not any session
state.

## How this repository checks itself

Every push runs the gate from a clean clone, recomputes the attestation of
each commit, and scaffolds five variants of a new project — nothing, a
database, an API, a page, all three — installing and gating each. A version is
published only from a tag, only if the tag names the version in
`package.json` and `CHANGELOG.md` has an entry for it, and only after the
attestation and the gate pass again on the runner, with provenance from the
workflow rather than from a token. `CHANGELOG.md` says what changed for a
consumer; `PROGRESS.md` says why. [CONTRIBUTING.md](CONTRIBUTING.md) is the
path through the rules for a person.

## Licence

MIT. The text ships with the package, in `LICENSE`.
