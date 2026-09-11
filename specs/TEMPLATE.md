# Spec: <feature name>

> Copy to `specs/YYYY-MM-<short-slug>.md` and fill in every section. A section that does
> not apply says "None" — it is never deleted, because an empty section and a
> missing section mean different things to whoever reads this next.

- **Feature list entry**: <the exact `description` from `feature_list.json`; the entry's `spec` is this file's path, and its `id` is its position>
- **Author / session date**: <YYYY-MM-DD>
- **Status**: draft | approved | implemented

---

## Problem

What is broken or missing, and for whom. Two or three sentences. Describe the
situation, not the solution — if this section names a function or a table, it
has drifted into design.

## In scope

Bullet list of what this task delivers. Each bullet is something a reviewer can
point at when it is done.

## Out of scope

Bullet list of what this task deliberately does not do, including anything a
reader would reasonably assume was included. Name the follow-up if there is one.

## Design source

Delete this section if the feature has no design. If it has one, all three parts
are required — the second especially.

- **Where.** File URL, and every frame with its node id.
- **What it governs by default.** State it positively, in one sentence. "The
  frames are the instruction for layout, spacing, hierarchy and copy; behaviour
  comes from the acceptance criteria." A contract that lists only the exceptions
  reads as though the design were reference throughout.
- **Where it is reference only.** The exceptions, each with its reason.

Open the frames before writing UI code. Acceptance criteria are phrased
behaviourally because that is what can be verified mechanically; it does not
make the design optional. Reading only the exceptions once cost a rebuild in
this project — the criteria were all satisfied and the result looked wrong.

## Acceptance criteria

EARS notation. Every criterion gets an ID (`AC1`, `AC2`, …) and uses exactly one
of the five patterns below. One criterion, one behaviour — if a criterion needs
"and" between two outcomes, split it.

**Ubiquitous** — always true, no trigger.
> The `<system>` shall `<response>`.

**Event-driven** — a trigger occurs.
> When `<trigger>`, the `<system>` shall `<response>`.

**State-driven** — true for as long as a state holds.
> While `<state>`, the `<system>` shall `<response>`.

**Unwanted behaviour** — an error, an invalid input, a failure.
> If `<unwanted trigger>`, then the `<system>` shall `<response>`.

**Optional feature** — only when a capability is present or configured.
> Where `<feature is included>`, the `<system>` shall `<response>`.

Example:

- **AC1** (ubiquitous) — The API shall return short codes of exactly 7 characters
  from the alphabet `A-Za-z0-9_-`.
- **AC2** (event-driven) — When a valid `http(s)` URL is posted to `/links`, the
  API shall respond 201 with a code, a short URL, and a QR image.
- **AC3** (state-driven) — While a link's `expires_at` is in the past, the API
  shall respond 410 to `GET /{code}`.
- **AC4** (unwanted) — If the posted URL does not parse as an absolute `http(s)`
  URL, then the API shall respond 400 with `errorCode: INVALID_URL` and shall not
  create a link row.
- **AC5** (optional) — Where `expiresInDays` is supplied, the API shall set
  `expires_at` to that many days after creation.

## Verification plan

One row per acceptance criterion. Every criterion must appear; a criterion with
no verification mechanism is not an acceptance criterion, it is a wish.

| Criterion | Verification mechanism | Pass condition | Evidence output |
|---|---|---|---|
| AC1 | Jest unit — `apps/api/src/service/*.spec.ts` | 1000 generated codes all match `SHORT_CODE_PATTERN`, no duplicates | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest API e2e — supertest `POST /links` | 201; body matches `CreateLinkResponse`; `qrDataUrl` starts with `data:image/png;base64,` | `.generated/runs/<ts>/04-api-e2e.log` |
| AC3 | Jest API e2e — insert a link with a past `expires_at`, then `GET /{code}` | 410 with `errorCode: CODE_EXPIRED`; no click event written | `.generated/runs/<ts>/04-api-e2e.log` |
| AC4 | Jest API e2e — post `javascript:alert(1)` | 400 with `errorCode: INVALID_URL`; `select count(*) from links` unchanged | `.generated/runs/<ts>/04-api-e2e.log` |
| AC5 | Playwright — pick "90 days" in the UI, submit, read the returned expiry | Rendered expiry is 90 days after today | `.generated/runs/<ts>/05-browser-e2e.log`, `playwright-report/` |

Rules for this table:

- UI criteria are verified by Playwright, in a browser, through the actions a
  user would take. `curl` and unit tests do not verify a UI criterion.
- "Pass condition" is a concrete, observable assertion. "Works correctly" is not
  a pass condition.
- "Evidence output" names the file under `.generated/runs/<timestamp>/` where a
  reviewer will find the proof.

## Affected modules

Exhaustive list of paths this task may touch. Anything not listed here is out of
bounds — reaching outside this list means **stopping and asking the human**.
This contract is the only place that rule lives: CLAUDE.md carried a copy of it
until 2026-09-01, and a rule stated in two places is a rule that will eventually
be stated two ways.

- `apps/api/src/<layer>/<file>`
- `apps/web/src/<layer>/<file>`
- `packages/contracts/src/index.ts` — *requires explicit human sign-off (I4)*
- `migrations/<NNN>_<name>.sql` — *requires explicit human confirmation to apply (I8)*
- tests: `...`

## Invariants

Which entries in `docs/INVARIANTS.md` this task touches or comes near, and how
each is preserved. Reference by ID.

| Invariant | Relevance | How this task preserves it |
|---|---|---|
| I1 | <e.g. writes the `links` row> | <e.g. `url` is written once at insert; no update path added> |
| I3 | <e.g. adds a route> | <e.g. route paths taken from `ROUTES`; signatures unchanged> |

Also list the `docs/DOMAIN_RULES.md` rules this spec depends on, and confirm none
is contradicted.

## Open questions

Anything underspecified. Each question gets an owner and blocks the parts of the
work that depend on it. Guessing is not an option — see CLAUDE.md.

- **Q1**: <question> — *blocks: AC_ — asked of: human — status: open | answered: <answer>*

If this section is non-empty and any question blocks an acceptance criterion,
the spec is not `approved` and implementation does not start.
