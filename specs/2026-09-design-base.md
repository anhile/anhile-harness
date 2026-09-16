# Spec: a web project starts from a design base

- **Feature list entry**: #12 — "A generated web project starts from a design base: tokens in index.css, a catalog of primitives under components/ui, a brief in apps/web/DESIGN.md, and a lint rule that refuses inline styles, arbitrary class values and Radix imports outside the catalog"
- **Author / session date**: 2026-09-16
- **Status**: approved — the first of the design items the person asked for after 0.2.0

---

## Problem

The web template was Vite and React and nothing else: a heading and a line,
no tokens, no type scale, no component. Every screen a session wrote after
that started from zero, and screens started from zero look generated for
reasons that can be named — a colour picked per element, a size off any
scale, a button drawn each time, a layout that centres everything. A brief
that is only prose is a preference; the harness holds a page to it the way
it holds code to the gate, with a rule that refuses.

## In scope

- `templates/web` ships Tailwind 4 through `@tailwindcss/vite`, tokens in
  `apps/web/src/index.css` under `@theme` with a dark set and a base layer
  (`body` on the tokens, a visible focus ring), `cn()` in
  `src/lib/cn.ts`, and a catalog under `src/components/ui/`: `Button` (cva
  variants and sizes, `asChild` through Radix Slot), `Card` and its parts,
  `Input`, `Label`, each rendered in `ui.spec.tsx`, so coverage counts them.
- `apps/web/DESIGN.md`: the brief — catalog, tokens, type, space, surfaces,
  states, what is refused on sight, how to add a primitive.
- `Home.tsx` composes from the catalog and keeps its two sentences; the two
  Home cases still hold.
- `WEB_CATALOG_RULE` in `harness-templates.mjs`: one object the generator
  writes into a `--web` project's `eslint.config.mjs` — under `apps/web/src`
  outside `components/ui`, no inline `style`, no arbitrary Tailwind value in
  a string or template literal, no `@radix-ui/*` import — and that
  `catalog-lint.spec.ts` fires at with this repository's eslint.
- The seed `AGENTS.md` of a web project names the rule in its table and the
  brief under what to fill in.
- The seven packages in `harness.manifest.json` under `dependencies.apps.web` and
  their versions in `harness.versions.json`.

## Out of scope

- A design reviewer in `/review-pr`, and the Figma intake path. Next.
- json-render. A runtime for generative UI in a product; an optional variant
  if a product ever needs one, not the base.
- Icons beyond naming the set (`lucide-react` is installed, the brief names
  it, no primitive wraps it yet).
- Projects generated before this: the CHANGELOG's entry says what to copy and where the catalog block comes from.

## Acceptance criteria (EARS)

- **AC1** (ubiquitous) — A `--web` project shall receive `DESIGN.md`, the
  tokens, `cn`, the four primitives with their suite, and a `Home.tsx` that
  composes from the catalog; a project without `--web` shall receive none of
  it.
- **AC2** (ubiquitous) — A `--web` project's `eslint.config.mjs` shall carry
  the catalog rule, and one without `--web` shall not.
- **AC3** (ubiquitous) — Under the rule, a page under `apps/web/src` with an
  inline style, an arbitrary class value (string or template), or a Radix
  import shall be refused with a message naming DESIGN.md; the same inside
  `components/ui` shall pass; the template's own `Home.tsx` and primitives
  shall pass; a class of plain tokens shall pass.
- **AC4** (ubiquitous) — The seed `AGENTS.md` of a `--web` project shall name
  the catalog rule and the brief.
- **AC5** (ubiquitous) — A generated `--web` project shall pass its own gate:
  lint with the rule, typecheck, the Home and ui suites, coverage with the
  primitives counted.
- **AC6** (ubiquitous) — Every file under `templates/web` shall be one the
  module writes, and the packages the template imports shall be in the
  manifest with a version on record.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `harness-init.spec.ts` "the design base a web project starts with › names the brief and the catalog in AGENTS.md, and ships DESIGN.md, the tokens and the primitives": `DESIGN.md`, `@theme` in `index.css`, the four primitives, `cn.ts`, `ui.spec.tsx`, the import in `Home.tsx`; and without `--web` no `apps/web` at all and no line about it in `AGENTS.md` | the case passes | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `harness-init.spec.ts` "writes the catalog rule into eslint.config.mjs, for --web only" | the case passes | same |
| AC3 | Jest — `catalog-lint.spec.ts`: three refusals (inline style; arbitrary value in string and template, three files; Radix import), each asserting its message and `DESIGN.md` in it, and four allowances (inside components/ui; the template's Home.tsx; the four primitives; plain tokens with a bracket that is not a value) | the cases pass | same |
| AC4 | Jest — the AC1 case asserts the table row and the DESIGN.md line, and their absence without `--web` | the case passes | same |
| AC5 | CI — `generate` job, `init --web → ./verify.sh` and `init --database --api --web → ./verify.sh`, on this pull request, not evidence at audit time; before it, the same run by hand on a scaffold under the session's scratchpad, its result named in the journal entry that follows the audit | the hand run was 6/6; the jobs are green | the journal; the pull request |
| AC6 | Jest — `harness-templates.spec.ts` "every file on disk is one the module writes…", "every entry the module reads from disk is there", and "what the web template imports › is in the manifest under dependencies.apps.web, every bare package" (reads the template sources' imports, `@import` included, and asks the manifest); `harness-package.spec.ts` on the manifest and the versions file | the cases pass | same |

## Affected modules

- `templates/web/apps/web/` — new: `DESIGN.md`, `src/index.css`, `src/lib/cn.ts`, `src/components/ui/{button,card,input,label}.tsx`, `src/components/ui/ui.spec.tsx`; changed: `src/Home.tsx`, `src/main.tsx`, `vite.config.ts`
- `scripts/harness-templates.mjs` (the WEB map, `WEB_CATALOG_RULE`), `scripts/harness-init.mjs` (the eslint entry takes the answers; the seed's table row and fill-in line)
- `harness.manifest.json` (`dependencies.apps.web`, the suites tier), `harness.versions.json`
- tests: new `catalog-lint.spec.ts`; `harness-init.spec.ts` gains a describe; `harness-templates.spec.ts` gains "what the web template imports", and its "is carried by the files that show the name, and by no other" pins the list of files carrying the name token, and `DESIGN.md` joins it (its title names the project); nothing else changed
- docs: `README.md`, `CHANGELOG.md`

## Definition of done

Entry #12 closes on AC1 to AC6 together, in one commit, with the generated
project's gate run by hand before it and by CI after.
