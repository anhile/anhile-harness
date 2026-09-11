# Changelog

What changed for somebody who runs `npx anhile-harness init`, by version. The
reasons behind each change are in `PROGRESS.md`, which is the journal; this is
the summary a consumer reads before upgrading.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [SemVer](https://semver.org/): a change to what the
generated gate refuses is a major, a new thing the generator can write is a
minor, a fix to a copied script is a patch.

## [Unreleased]

### Changed

- The record of gate runs is a directory, `verify-log/`, with one file per
  run, in place of the single append-only `verify-log.jsonl`. Two branches
  that both ran the gate no longer conflict on merge, and the readiness
  check no longer asks a branch to rerun the gate because main ran later.
  A project on an earlier version migrates by writing each line of the old
  file to `verify-log/<evidence folder name>.json` and removing the file;
  `verify-log.mjs` does not read the old file.

## [0.1.1] — 2026-09-12

The first session of a generated project under Claude Code found what the
generate job could not: the hooks. Everything here came out of reading the
published 0.1.0 as a consumer would.

### Fixed

- The work-budget hook kept its state under `.claude/`, which the generated
  `.gitignore` did not name, and the commit gate hashes every unignored file:
  in a consumer's first session every gate run went stale after the next
  tool call. The state is under `.generated/` now, which every project
  ignores.
- The tarball carried this repository's own contract under `specs/`. It
  carries the templates and nothing written under them here.
- `verify-task` and `review-pr` delegated to a `security-check` agent that
  did not travel. It does now, general rather than the product's.
- `task-intake` carried the URL of one product's Notion database. It reads
  `intake.notion` from `harness.config.json`, and stops when it is `null`.

### Changed

- The work budget is `session.workBudget` in `harness.config.json`, thirty
  by default; the environment still overrides it.
- The generator's next steps and the seeded `AGENTS.md` say to raise the
  coverage floor after the first green run, so it starts where the project
  starts and not at zero.
- The workflows pin every action to a commit and the release pipeline pins
  the npm it installs.

## [0.1.0] — 2026-09-11

The first version published from its own repository. Until now the harness
lived inside `anhile/link-shortener` as `packages/harness`, assembled at pack
time; here `scripts/` at the root is what ships.

### Changed before the first publish

Nothing had been published, so these are part of 0.1.0 rather than a
release of their own; they are listed because a reader of the seed commit
would otherwise find a different package than the one on npm.

- Every script under `scripts/` and the `bin` carry `// @ts-check` and JSDoc,
  and `tsconfig.scripts.json` puts them under `tsc -b` — step 02 of the gate —
  here and in every generated project. No build step: the files run as they
  are, and a file without the directive is visibly unchecked.
- The generator seeds `docs/INVARIANTS.md`, `docs/DOMAIN_RULES.md` and
  `CONTRIBUTING.md`; the copied scripts, skills and templates name nothing of
  the product the harness was written in.
- `check-environment.mjs` asks for Docker only when the project has a
  database; `check-feature-list.mjs` reads its exempt commits from
  `harness.config.json` (`featureList.exemptCommits`).

### Added

- `npx anhile-harness init`: asks for a name, what is in the project and
  which MCP servers to declare, then writes a project that passes its own
  `./verify.sh` on the first run. `--yes` for scripts and CI.
- A six-step gate — eslint, typecheck, unit, feature-list, verify-log,
  coverage — and the three steps a project adds when it has a database, an
  API or a page, named in its `AGENTS.md` with the line to add.
- The mechanisms behind the gate: a receipt hashing the tree the gate passed,
  a commit gate that refuses a tree no green run covers, an append-only
  `feature_list.json` and `verify-log.jsonl`, a CI `attest` job that
  recomputes the claim from a clean clone, and a `pre-push` hook that asks
  the same question a few seconds earlier.
- Skills and hooks for Claude Code: `/setup-repo`, `/task-intake`,
  `/verify-task`, `/open-pr`, `/review-pr`, `/address-comments`,
  `/draft-feature`, and the spec-auditor agent.
- Optional scaffolds: a NestJS API deployed as one serverless function, a
  React page built by Vite, a Postgres database with migrations. Versions come
  from `harness.versions.json`.
- `harness.config.json`, edited instead of the scripts.

### Not yet

- Upgrading a project that adopted an earlier version. A generated project
  keeps the snapshot it was given.

[Unreleased]: https://github.com/anhile/anhile-harness/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/anhile/anhile-harness/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/anhile/anhile-harness/releases/tag/v0.1.0
