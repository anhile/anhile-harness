---
name: draft-feature
description: Draft a product spec as a new row in the Notion Features database, or as a file in specs/inbox/ when the user asks for a local one or has no Notion. Use when the user describes a feature idea and asks to write it up, draft a spec, or prepare product documentation for it. Produces a Draft that task-intake can later consume, and does not invent answers to open questions.
argument-hint: [feature idea, or a link to notes]
---

# Draft Feature

Turns a feature idea into a product spec a later intake session can execute
against.

This is the mirror image of `task-intake`. Intake reads a Notion row and produces
a task contract in `specs/`; this produces the row. The two meet at the Features
database, and most of this file exists so that the meeting works.

Two rules override everything else here:

1. You produce a spec, not code, and not a task contract. `specs/` is intake's
   output, never yours.
2. "There is not enough here to write a spec" is a valid and expected outcome. A
   spec that is nine parts invention is worse than no spec, because it reads like
   a decision somebody made.

## Input

Whatever the user brings: a paragraph in the conversation, meeting notes, a
support thread, a design link, or "the thing we just discussed". None of it is a
spec yet and none of it is authoritative.

If nothing was given, ask what the feature is. Do not pick an entry out of
`feature_list.json` and write it up — that file lists guarantees the product
already makes, not a backlog of things it might.

## Output

### Where it goes

One of the two places intake reads from, and the user says which:

- **A row in the Features database in Notion**, the reference integration.
  The default when the user has Notion and does not say otherwise.
- **A file in `specs/inbox/`**, from `specs/inbox/TEMPLATE.md`, when the user
  asks for a local spec, has no Notion, or the feature is the harness's own.
  Its rules are `specs/inbox/README.md`. Before reporting, run
  `node scripts/inbox.mjs check specs/inbox/<slug>.md --any-status`: it holds
  the file to the same shape intake will, minus the status a person sets. A
  file this skill writes always says `status: Draft`.

For Notion:
Its database, data source and view ids are at the top of
`.claude/skills/task-intake/SKILL.md` and are deliberately not copied here: an id
that lives in two files is an id that gets updated in one of them.

A loose Notion page is not an acceptable output, however good it is. Intake
rejects any page that is not a row of that data source, so a spec written
anywhere else is unreachable work.

Page bodies are Notion-flavoured Markdown, where tables are
`<table header-row="true">` with `<tr>` and `<td>`, not pipe tables. The
create-pages tool description points at the full specification; read it rather
than guessing, because a table that fails to parse comes back as a wall of
literal tags.

### What Status it gets

`Draft`. Always.

`Ready for intake` is the human's signal that the spec has been read and its open
questions answered. Setting it yourself forges the approval that intake's gate 0b
exists to check, and turns a two-person handoff into a loop with one participant.

### Who owns it

The `Owner` person property is who intake will address open questions to. Set it
to whoever can answer them — usually the person asking for the spec. If you
cannot tell who that is, ask. An unowned spec is a spec whose questions have no
route to an answer.

## Before writing: ground the spec

Five passes, cheapest first. None is optional, and the fourth is what separates a
spec from a wish.

**1. The template.** Fetch the `Feature template` page in the database and take
your section list from it. Not from memory, and not from this file — which is why
this file does not carry one. The template is where the sections are defined; a
copy here would drift from it, and this repository has already paid for that kind
of copy once.

**2. The neighbours.** Fetch one or two existing rows. They carry the house
format: a header table of Status / Owner / Supersedes / Depends on / Last
updated, tables rather than prose for anything enumerable, criteria numbered
`AC-1`. Match them.

**3. The constitution.** `AGENTS.md`, `docs/INVARIANTS.md`,
`docs/DOMAIN_RULES.md`, and `docs/ARCHITECTURE.md` where the project has one. The spec will be judged against
these at intake gate 5. Reading them afterwards means rewriting.

**4. The code the feature touches.** Actually open it.

This is where the constraints that make a spec worth reading come from, and none
of them is written in any document. Two from the session that produced this
skill: a page component said in a comment that its call to action was inert on
purpose and that the handler was absent rather than a no-op — which told the
spec it was superseding an existing criterion rather than adding one. And the
routing file sent every path of one shape to a single handler, which
constrained every route name the product would ever add. A spec written from
the idea alone would have carried neither, and would have been wrong in a way nobody
caught until implementation.

**5. What already exists.** Search the database for the same feature before
adding a second row for it. Read `specs/` and `feature_list.json`: the idea may
contradict a guarantee the product already makes, or supersede a criterion in a
row that has already been through intake.

## Acceptance criteria

EARS, numbered `AC-1`, `AC-2`. The five patterns are stated in the template's own
toggle; use them from there.

What intake will check, so check it first:

- **One criterion, one behaviour.** If it needs "and" between two outcomes, split
  it. At most one trigger, exactly one system name.
- **At least one unwanted-behaviour criterion.** A list with no `If … then …` has
  no failure paths described and comes back from intake. Write the real ones.
- **Every criterion verifiable by something.** You do not assign the mechanism —
  that is intake's job — but if you cannot imagine one, what you have is a wish,
  and it belongs in open questions or nowhere.
- **UI criteria are verified in a browser, as a user would.** A criterion whose
  only possible check is someone squinting at a screen is a problem to name, not
  to hide behind behavioural phrasing.

Where copy is part of the feature, put the strings in a table and say the table is
the instruction. Strings scattered through criteria get implemented three ways.

## The trap: do not write to pass the gates

This skill and `task-intake` come from the same understanding of the project.
That is convenient and it is dangerous. If specs are shaped to satisfy intake's
checks, every spec passes and intake stops being a gate — the disease its own
opening names: *a run that always produces a spec is a generator, not a gate.*

Concretely forbidden:

- Inventing an answer to something underspecified so the document looks
  finished. `CLAUDE.md`: anything underspecified is a question for the human, not
  a guess.
- Adding an unwanted-behaviour criterion you do not believe in, to clear the
  gate-2 check.
- Writing an open question you intend to answer yourself in the same document.
- Narrowing scope quietly to avoid a hard question. Name the question and keep
  the scope.

The measure of a drafted spec is whether its open questions are real, not whether
intake said yes.

## Open questions

Every spec has them. Address each to a person or a role, and say what it blocks.

Give your proposed answer where you have one — a question with no proposal moves
nothing — but a proposal is never quietly promoted into the body of the spec. If a
criterion depends on the answer, the criterion says so.

The questions worth the most are where two rules the project already holds
collide. In one spec it was this: a public identifier had to resolve forever,
by invariant, so deleting an account could not delete what it owned — which
made account deletion a product decision about a public promise rather than an
implementation detail. That question came from reading `docs/INVARIANTS.md`
against the idea, which is what pass 3 is for.

## Traps in this repository

Pointers, not restatements — read the rule at its id before relying on it. Most
specs touch two or three of these.

| Check | Where |
|---|---|
| A contracts change needs explicit human sign-off | `I4` |
| A migration needs human confirmation to apply, and an applied one is never edited | `I8` |
| A commit needs a green gate over exactly its tree | `I11` |
| `feature_list.json` is append-only; a guarantee is withdrawn in the open | `I15` |
| A step nothing can pass yet is deferred, not shipped | `AGENTS.md`, the deferred steps |
| The layer rules, once the project has written them | `eslint.config.mjs` |

The project's own rules go above these, in `docs/DOMAIN_RULES.md`, by number.

## Superseding an existing spec

A new feature often contradicts a criterion in a row that is already written and
sometimes already built. Say so in the header table — *Supersedes: `<row name>`,
`AC-n` only* — and be that precise. "Supersedes the home page spec" throws away
sixteen criteria that are still in force.

Do not edit the old row to resolve the contradiction. Rows that have been through
intake have a contract in `specs/` pointing back at them, and intake's own rule is
that a later change in Notion is a new input, not an edit.

## Design

If the feature has a design, the template's Design source section asks for three
parts. The second — what the design governs by default, stated positively — is the
one that gets skipped, and skipping it cost this project a rebuild: every
criterion passed and the result looked wrong. Where the design does not cover a
screen the feature needs, that is an exception with a reason, and usually an open
question for design.

## Procedure

**Plan first, then write.** Never create the row in the same turn as the plan.

Output, and stop:

- the proposed title
- the scope boundary, in scope and out of scope, in a few lines
- one line per acceptance criterion, in final EARS form
- the open questions, each with its owner
- the decisions you made where the input was ambiguous, so they can be challenged
- anything you would supersede, by row and criterion id

Then wait. A row in a shared database is visible to other people and to intake:
creating one is cheap, un-creating one is a conversation.

If the user corrects a criterion or a boundary, show the revised plan and wait
again. A correction is not an approval.

## After the row exists

Report the URL, `Status: Draft`, the open questions with their owners, and the
plain sentence that intake will refuse the row until a human flips the status.

Do not run `task-intake` in the same session, and do not offer it as the next step
in the same breath. The gap between drafting and intake is where a person reads
the thing.

This skill writes nothing in the repository, so there is no `verify.sh` run to
make and nothing to commit. `CLAUDE.md`'s end-of-session rules still apply to
whatever else the session did.

## Calibration

When intake bounces a spec this skill produced, the miss is here, not there: add
the check that would have caught it to this file. When a spec passes intake and
then falls apart in implementation, the miss is usually pass 4 — the code was not
read — and the fix is a line in the traps table.

This file came out of one such session on 2026-09-02: a spec for accounts on a
third-party sign-in service, drafted by hand with none of the above written down.
