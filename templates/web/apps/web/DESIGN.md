# DESIGN.md — the brief for __PROJECT_NAME__

The page is held to this file the way the code is held to the gate. A screen
that looks generated looks that way for reasons that can be named, and each
one is refused here: a colour that is not a token, a size off the scale, a
button that is not in the catalog, a layout that centres everything because
nothing decided where it goes.

## The catalog

`apps/web/src/components/ui/` is the whole set of primitives a page composes
from: `Button`, `Card` and its parts, `Input`, `Label`. Radix primitives,
`class-variance-authority` and raw class strings live only there. Step 01
refuses, anywhere else under `apps/web/src/`:

- an inline `style` attribute — a token in `index.css`, or a class from the
  catalog;
- an arbitrary Tailwind value such as `w-[13px]` or `bg-[#123456]` — the
  scale and the palette are in `index.css`, and a value that is not there is
  a decision to record there, not on one element;
- an import from `@radix-ui/*` — a new primitive is written in the catalog,
  with a test in `ui.spec.tsx`, and named in this file.

## Tokens

All in `apps/web/src/index.css`, under `@theme`, with a dark set under
`prefers-color-scheme`. Roles, not colours: `bg`, `fg`, `muted`, `surface`,
`border`, `accent`, `accent-fg`, `danger`. One accent per screen; `danger`
only for a destructive action or an invalid field.

## Type

Four sizes on a page: `text-sm` for labels, descriptions and metadata,
`text-base` for body, `text-lg` for a card or section title, `text-2xl` for
the page's one heading. `font-semibold` on headings, `font-medium` on labels
and buttons, nothing bolder. `tracking-tight` on headings only.

## Space

The scale is Tailwind's, and a page uses `2 4 6 8 12 16` of it: gaps of 2 or
4 inside a component, 6 or 8 between components, 12 or 16 between sections.
Content is left-aligned in a column no wider than `max-w-2xl` for reading and
`max-w-5xl` for a working screen; a centred column is a choice for a landing
page, not a default.

## Surfaces and edges

`rounded-md` on controls, `rounded-lg` on cards, nothing rounder. One shadow,
`shadow-card`, on cards only. Borders are `border-border`; a line divides, a
shadow lifts, and a surface does not need both.

## States

Every screen that loads data has four: empty, loading, error, and content.
The empty state says what would be here and how to make it; the error state
says what failed and what to do. A field that is invalid says so beside the
field (`aria-invalid`), not in a toast.

## What is refused on sight

Gradients as decoration. Emoji as icons (`lucide-react` is the icon set).
Three identical cards in a row as a way to fill a page. A hero with a slogan
above a product that has one screen. Placeholder text as a label. Text on an
image. More than one accent. A screen that centres everything.

## Adding to the catalog

A new primitive goes in `components/ui/`, with variants as `cva` options, a
test in `ui.spec.tsx` that renders each variant, and a line in the catalog
section above. The first screen that needs it is where it is written; the
second screen is where its variants get their names.
