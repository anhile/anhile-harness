# Spec: a design reviewer, on the walk

- **Feature list entry**: #13 — "The review brief says whether the UI changed and whether a walk is on this machine; review-pr dispatches design-review, an agent that holds a screen to apps/web/DESIGN.md on the walk's screenshots and reports NO WALK when there is none; a --web project points the brief at apps/web/src"
- **Author / session date**: 2026-09-16
- **Status**: approved — the second of the design items, after the design base (#12)

---

## Problem

The design base (#12) gave a page tokens, a catalog and a brief, and a lint
rule for the three lines of the brief a machine can hold. The rest of the
brief — hierarchy, the scale, the four states, contrast, copy, the list of
what is refused on sight — is judged by looking at the screen, and nothing
in `/review-pr` looked. The walk a session files under `.generated/ui/<ts>/`
with agent-browser was evidence for a person and for nobody else.

## In scope

- `ui.paths`, an optional key in `harness.config.json`, validated when
  present: the prefixes under which a change is a UI change. The generator
  writes `apps/web/src/` for `--web` and an empty list otherwise; this
  repository names `templates/web/`.
- The review brief gains two lines: `UI: unchanged…` or `UI touched: <prefix>
  (<n> file(s))`, and, when touched, `Walk: .generated/ui/<id>/ (<n>
  file(s))` or `Walk: none under .generated/ui/ on this machine — …`. The
  walk is the newest folder named as a run id; it is not in the repository,
  and the reviewer runs where the walk is.
- `.claude/agents/design-review.md`: read-only tools; given the brief, the
  diff, `apps/web/DESIGN.md` and the walk; no walk, no review, and it does
  not review a screen from its code; a finding names a screenshot, a file
  and line, the rule it breaks and the consequence; ends HOLDS, FINDINGS or
  NO WALK.
- `/review-pr`: a fifth reviewer, one of five in the table, dispatched when the brief
  says the UI changed, skipped and said so when it did not; dispatched with
  no walk too, since NO WALK is the finding.
- The agent travels: `harness.manifest.json` core, and the package's paths.

## Out of scope

- Running the walk itself. That is the session's, with agent-browser, before
  the pull request; the `setup-repo` and `open-pr` skills say how and where.
- Committing the walk. Screenshots are evidence on a machine, named in the
  pull request; the record's shape does not change here.
- The Figma intake path. Next.
- Firing at the reviewer's judgement. It is a brief to a model; what a test
  can hold is the brief's lines, the dispatch rule and the agent's text.

## Acceptance criteria (EARS)

- **AC1** (ubiquitous) — `harness.config.json` shall accept `ui.paths` absent
  or as a list of non-empty prefixes, and refuse an empty prefix, naming the
  key.
- **AC2** (ubiquitous) — A `--web` project's configuration shall name
  `apps/web/src/` under `ui.paths`, and one without `--web` an empty list.
- **AC3** (ubiquitous) — The brief shall say the UI is unchanged when no
  file under a prefix changed, and otherwise name each touched prefix with
  its file count and the newest walk, or that there is none on this machine.
- **AC4** (ubiquitous) — `newestWalk` shall pick the newest folder named as a
  run id under `.generated/ui/`, count its files and not its folders, and
  return null when there is none.
- **AC5** (ubiquitous) — The agent shall carry the rule no walk, no review,
  the four fields of a finding, and the three verdicts; `/review-pr` shall
  list it as one of five reviewers with its condition, and say to skip it when
  the UI is unchanged and to dispatch it without a walk.
- **AC6** (ubiquitous) — The agent shall travel with the package and be
  listed in the manifest's core.

## Verification plan

| AC | Mechanism | Pass condition | Evidence |
|---|---|---|---|
| AC1 | Jest — `harness-config.spec.ts` "allows ui.paths to be absent, and refuses an empty prefix in it" | the case passes | `.generated/runs/<ts>/03-unit.log` |
| AC2 | Jest — `harness-init.spec.ts` "points the review brief at apps/web/src as the UI, for a project that has a page" | the case passes | same |
| AC3 | Jest — `design-review.spec.ts` "the brief, on the UI": "counts the files under each configured UI prefix…", "says the UI is unchanged…", "names the touched prefixes and the newest walk…", "says there is no walk to look at…", and "this repository names its UI: the web template" (the configured prefix pinned, `uiTouched` under it, the real brief's line in one of its two shapes) | the cases pass | same |
| AC4 | Jest — `design-review.spec.ts` "finds the newest walk folder by its id, counting what it holds" (two walks, a nested file, a folder that is not a walk, an absent directory) | the case passes | same |
| AC5 | Jest — `design-review.spec.ts` "the reviewer and the skill that dispatches it": the front matter; the rule and the three verdicts; the four fields; the table's "Five…" line, its five rows with `design-review` among them, and the two dispatch sentences | the cases pass | same |
| AC6 | Jest — `harness-package.spec.ts` "the skills and both agents…" asserts `.claude/agents/design-review.md` in the tarball; the manifest's core lists it, held by the same suite's "under .claude, .github and specs, only what the manifest says travels" | the cases pass | same |

## Affected modules

- `scripts/harness-config.mjs` (the optional key and its type), `harness.config.json`, `scripts/harness-init.mjs` (`configFor`)
- `scripts/pr-review-brief.mjs` (`UI`, `WALK_DIR`, `uiTouched`, `newestWalk`, the two lines in `render`)
- new: `.claude/agents/design-review.md`, `scripts/__tests__/design-review.spec.ts`
- `.claude/skills/review-pr/SKILL.md`, `harness.manifest.json` (core, the suites tier)
- tests: `harness-config.spec.ts`, `harness-init.spec.ts`, `harness-package.spec.ts` gain a case or an assertion; nothing changed
- docs: `README.md`, `CHANGELOG.md`

## Definition of done

Entry #13 closes on AC1 to AC6 together, in one commit, with the entry in
`feature_list.json`, this contract, the run's record, the READY audit under
`audit-log/` and the journal entry naming both, as the shape requires.
