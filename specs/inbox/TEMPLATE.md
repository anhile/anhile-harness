---
name: <the feature, as a noun phrase>
status: Draft
owner: <who answers the open questions>
supersedes: <row or file, and which criteria — or none>
depends_on: <row or file — or none>
updated: YYYY-MM-DD
---

# <the feature>

## Problem

What is broken or missing, and for whom. Two or three sentences. The
situation, not the solution.

## In scope

- <something a reviewer can point at when it is done>

## Out of scope

- <what a reader would assume is included, and is not; name the follow-up>

## Design source

None. — Or: the file URL, every frame with its node id, what the frames
govern by default stated positively, and where they are reference only.

## Acceptance criteria

One per line, EARS, exactly one of the five patterns, at least one `unwanted`.

- **AC-1** (ubiquitous) — The <system> shall <response>.
- **AC-2** (event-driven) — When <trigger>, the <system> shall <response>.
- **AC-3** (state-driven) — While <state>, the <system> shall <response>.
- **AC-4** (unwanted) — If <condition>, then the <system> shall <response>.
- **AC-5** (optional) — Where <feature is present>, the <system> shall <response>.

## Copy

None. — Or a table of every user-visible string; the table is the instruction.

## Open questions

- **Q1**: <question> — *asked of: <owner> — blocks: AC-n — proposed: <answer, or none>*
