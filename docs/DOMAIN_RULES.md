# Domain rules

The constraints a spec for this repository is checked against, at intake gate
5, by number. A rule here says what the harness promises a project that adopts
it; an invariant in `docs/INVARIANTS.md` says what must never change in the
repository. A spec that contradicts a rule is bounced, and a finding that
cites no rule is not a finding.

| # | Rule | Checked by |
|---|---|---|
| R1 | A generated project passes its own `./verify.sh` on the first run | `generate.yml`, five variants on every push |
| R2 | The manifest records packages, never versions | `harness-boundary.spec.ts`, `harness-package.spec.ts` |
| R3 | One place per version: `package.json`, or `harness.versions.json` for what this repository does not use | the resolver refuses a name in both; `harness-package.spec.ts` |
| R4 | A step nothing can pass yet is deferred and named, never shipped red | `harness-init.spec.ts` |
| R5 | A file that travels names no product | `harness-boundary.spec.ts` for the scripts; review for the rest |
| R6 | A protected file is copied into a new project, never imported from this package | `harness-boundary.spec.ts` |
| R7 | The tarball carries what the manifest says travels, and nothing this repository alone needs | `harness-package.spec.ts` |

## R1 — A generated project passes its own gate on the first run

A scaffold that leaves somebody with a red gate has taught its first lesson
backwards. Every answer the generator accepts — nothing, a database, an API, a
page, all three — is scaffolded, installed and gated in CI on every push. A
change to a template or a version that turns one of them red is refused there.

## R2 — Packages, never versions

`harness.manifest.json` names what a copied script imports and what a
scaffold needs, by package name. A version there would be a second copy of
what `package.json` says, and two copies drift: the first generator hardcoded
one major of a library while the repository ran another.

## R3 — One place per version

`harness.versions.json` exists because this repository is the harness alone
and has no API or page to take versions from. It may name only what no
`package.json` here resolves; a name in both is refused by the resolver and by
the package suite.

## R4 — A step nothing can pass is deferred

`--database`, `--api` and `--web` shape the configuration and the files, and
the gate steps they imply are named in the new project's `AGENTS.md` with the
line to add and what has to exist first. A gate with a step that cannot pass
is a gate people learn to run with `|| true`.

## R5 — What travels names no product

The scripts the generator copies are checked word by word against a list of
identifiers that belonged to the product the harness was written in. The
skills, the templates and the two protected files are not mechanically
checked and are the places a product word survives longest; a spec that adds
one to a travelling file is asking for a review to catch it.

## R6 — Copied, not imported

The commit gate hashes `verify.sh` and the scripts in its trusted computing
base, and the witness job runs them in place. A project that imported them
from this package would have a gate whose rules change on `pnpm update`, with
nothing in the project to notice. Copying costs the upgrade path, which the
README says is not there yet.

## R7 — The tarball is the manifest

`npm pack --dry-run` is asked, not `files`: every script and file the manifest
says travels is in the tarball, the guard suites are not, the workflows that
gate and publish this repository are not, and nothing git ignores is.
