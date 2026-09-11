# @anhile/harness

A gate that refuses a commit whose claims are not earned, and a generator that
puts it in a new project.

```bash
npx @anhile/harness init
```

Installed, the command is `anhile-harness` — named after the scope on purpose.
A package name is namespaced and cannot collide; a `bin` is not, and lands in
every consumer's `node_modules/.bin` where a second package claiming `harness`
would win or lose unpredictably.

It asks for a name, then gives you two numbered lists — what is in the project,
and which MCP servers it should declare — and each line says what choosing it
puts in the repository. Then it writes the project, and the project passes its
own `./verify.sh` on the first run. That is the bar it is built to: a scaffold
that leaves you with a red gate has taught its first lesson backwards.

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
beside the line that exists because of it.

Take nothing, and you get the gate around an empty repository, which is a
perfectly good place to start.

## What you get

A gate of six steps — lint, typecheck, unit, feature-list, verify-log,
coverage — and the mechanisms behind them:

| | |
|---|---|
| `verify.sh` | the gate, with the steps your answers allow |
| a receipt | a hash of the tree the gate passed, checked at commit time |
| `feature_list.json` | the guarantees, append-only, one closed per commit |
| `verify-log.jsonl` | every run, append-only, recomputable from a clean clone |
| `PROGRESS.md` | the journal, and a hook that will not let a session skip it |
| skills and hooks | for Claude Code, ignored by anything else |

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

## Steps that are not there yet

Answer yes to a database or a browser UI and the generator writes what it can —
a `docker-compose.yml`, a migrations directory, the configuration — but does
**not** add the gate steps that would test them, because nothing it generated
can pass those steps yet. It says so, and your project's `AGENTS.md` carries
the exact line to add for each one when the thing it checks exists.

A gate with a step that cannot pass is a gate people learn to run with
`|| true`.

## What this does not do

**Upgrade a project that already adopted it.** A generated project keeps the
snapshot it was given. Improvements here do not reach it.

**Guard its own scripts once they are in your project.** The scripts are
copied, not linked, and the suites that fire at them stay in this package's
repository. If you edit a copied guard, nothing in your project notices.

Both are consequences of copying rather than depending, and both are the next
thing to fix.

## Configuration

One file, `harness.config.json`, written for you and edited rather than the
scripts. It carries the coverage sources, the migrations directory, the gate's
ports, the attack surface a security review is triggered by, and the suffix
that decides when a migration may run unattended.

That last one is refused if it does not read as deliberate — an underscore and
at least three characters — because it is the whole of what keeps an unattended
migration off a real database.

## What the package carries

`npm pack --dry-run` is the answer, and `harness-package.spec.ts` holds it
to the manifest on every run: the scripts, the skills and the agent, the
specs templates, `verify.sh`, the CI workflow, the pre-push hook, and the two
files the generator reads — `harness.manifest.json` for what travels and
`harness.versions.json` for what the scaffolds were written against. Not the
guard suites, which assert this repository; not the workflows that gate this
repository's own generator and publish it; not any session state.

## How this repository checks itself

Every push runs the gate from a clean clone, recomputes the attestation of
each commit, and scaffolds five variants of a new project — nothing, a
database, an API, a page, all three — installing and gating each. A version is
published only from a tag, only if the tag names the version in
`package.json` and `CHANGELOG.md` has an entry for it, and only after the
attestation and the gate pass again on the runner. `CHANGELOG.md` says what
changed for a consumer; `PROGRESS.md` says why.

## Licence

MIT. The text ships with the package, in `LICENSE`.
