# Handover

This repository was seeded on 2026-09-11 from
`anhile/link-shortener`, where the harness was a package inside the
product's monorepo (`packages/harness`). Nothing there was changed or
removed: that repository still builds and publishes the package exactly as it
did, so this split is additive and you can abandon it without losing anything.

Read this before the README. The README describes the package as it is meant to
be; this file describes what is actually here today, and it is written from
measurement rather than from intention.

## How it was made

`scripts/harness-init.mjs`, from the source repository, generated the base:

```
node scripts/harness-init.mjs --yes --name anhile-harness --mcp context7 --into ../anhile-harness
```

The harness's own repository bootstrapped by the harness's own generator, which
is the first thing that had to work if the split was worth making. Then three
overlays: the seventeen guard suites the manifest calls `core.suites`, the
package shell (`bin/`, `LICENSE`, `README.md`, the publishable `package.json`),
and `harness.manifest.json`.

## The decision this shape makes, and the one it leaves you

In `link-shortener` the package was **assembled**: `scripts/` was the source of
truth and `packages/harness/build.mjs` collected the manifest's files into a
`harness/` directory at pack time. That indirection existed to stop a
second, hand-maintained copy from drifting.

Here there is no second copy, so there is no build step. `scripts/` at the root
**is** what ships; `package.json`'s `files` lists the real directories. That is
the point of the split and it is the one structural decision already taken.

`bin/harness.mjs` was pointed at that shape as part of the seeding — it used to
resolve the generator inside the assembled `harness/` directory — and it works:

```
$ node bin/harness.mjs files
41 file(s)
$ node bin/harness.mjs init --yes --name probe --into ../probe
  40 harness files copied, 6 gate steps: eslint, typecheck, unit, feature-list, verify-log, coverage
```

Ask it for an application and it refuses, which is the subject of the next
section:

```
$ node bin/harness.mjs init --yes --name probe --web --into ../probe2
Error: harness.manifest.json names @testing-library/jest-dom, @testing-library/react,
@types/react, … which no package.json here can give a version for.
```

That refusal is the guard working. It would rather stop than write a project
whose `pnpm install` fails.

## What passes today

`node bin/harness.mjs init` writes a working project — generated, installed and
gated by hand, `RESULT: PASS (6/6 steps)` — as long as no application is asked
for.

For the suites, `pnpm install` then `pnpm exec jest --config jest.config.cjs`:

```
Test Suites: 11 passed, 7 failed, 18 total
Tests:      214 passed, 18 failed, 232 total
```

Eleven of the seventeen guard suites pass here unchanged, which is the number
worth knowing: the mechanisms travelled. `./verify.sh` has not been run since
the suites were added — run it before you trust anything above.

## Why the other seven fail — two causes, not seven

Both were found by running the suites, and both are properly yours to decide
rather than mine to have decided.

### 1. The generator cannot resolve versions for what it generates

`versionsAvailable()` reads `package.json`, `apps/api/package.json` and
`apps/web/package.json`, and takes the version of every package the manifest
names from whichever of those has it. In `link-shortener` that works because the
product happens to contain a NestJS API and a React page. **This repository
contains neither**, so a `--web` generation is refused for nine missing
versions and a `--database` one for `pg`.

It is the first real coupling the split exposes, and it was invisible while the
generator lived inside a product that happened to have one of everything.

Two ways out:

- **Carry the versions as devDependencies here.** Honest, and `pnpm install`
  then downloads NestJS and React into a repository that uses neither.
- **A `harness.versions.json`.** A resolved-versions file, which is what
  `build.mjs` already writes into the assembled package today — so this is that
  file promoted from a build artefact to a source file. Cheaper, and it needs
  something to keep it from going stale, which is the argument the manifest's
  own comment makes about why it records packages and never versions.

Most of the failing cases in `harness-init.spec.ts` are this one cause.

### 2. The suites are stricter than the compiler they were written against

`link-shortener`'s `tsconfig.base.json` does not set `noUncheckedIndexedAccess`.
The one this generator writes does. So `list[2].passes = true` in
`feature-list.spec.ts` and the `split()` in `progress.spec.ts` are errors here
and were not there — six suites fail to compile at all, before a single
assertion runs.

Either loosen the generated base, or fix the six suites. The second is more
work and is the better answer: the strict setting is the one the generator hands
every new project, and a harness whose own tests need it turned off is making a
recommendation it does not follow.

## What did not come across

- **`packages/harness/build.mjs`** and **`harness-package.spec.ts`**, which
  assert an assembly step that no longer exists. The spec file is here and
  failing; delete it, or rewrite it against `npm pack` alone — the third of its
  three links (the tarball matches the build) is still worth having.
- **The `configured` suites** — `docs-drift`, `ci-workflow`,
  `pr-review-brief`, `coverage-floor`, `migrations` and the rest. They assert
  documents and a workflow that belong to `link-shortener`. Some are worth
  rewriting here; none would pass unchanged.
- **This project's `PROGRESS.md`, `feature_list.json` and history.** The
  generator seeded empty ones. Its own history stays where it happened.
- **The nine-step `verify.sh`.** What is here is the six-step gate the
  generator writes, because this repository has no database and no browser.
  Steps 04, 05 and 09 were never in it.

## The honest summary

The mechanisms are here and most of them work. What is not here is the part that
only mattered when the harness lived inside a product: a place for it to get
versions from, and a compiler setting it can meet. Both are half a day, and
neither is a surprise about the design — they are the two things the monorepo
was quietly paying for.
