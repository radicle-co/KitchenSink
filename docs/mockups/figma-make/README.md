# Figma Make source — recipe creation, ingredient entry

Pulled 2026-08-25 from the Figma Make project `aXgLTTRikrX1uC3EbeYJoP` ("V1 Sous Chef UI (Copy)") via the
Figma MCP server. It is the design contract for units U10–U14 of
[`docs/plans/2026-08-23-002-feat-ingredient-parse-pipeline-plan.md`](../../plans/2026-08-23-002-feat-ingredient-parse-pipeline-plan.md).

⚠️ **This is generated design output, not our source.** It is React + Tailwind emitted by Figma Make from
the briefs in [`../briefs/`](../briefs/), archived so the plan can be written against something concrete.
Do not import it, extend it, or treat it as a component to port line by line — `@commise/ui` and the
existing form components are the target, and the cross-platform rule means every control ships to mobile
too, which this single web file does not address.

## Provenance

|           |                                                                                          |
| --------- | ---------------------------------------------------------------------------------------- |
| Project   | `https://www.figma.com/make/aXgLTTRikrX1uC3EbeYJoP/V1-Sous-Chef-UI--Copy-`               |
| Retrieved | 2026-08-25, via `get_design_context` (Make files expose source, not nodes)               |
| Briefs    | `../briefs/recipe-ingredient-entry-figma-make-prompt.md` (v1) and `-2.md` (the revision) |

⚠️ Only brief v1 is stored inside the Make project (`src/imports/pasted_text/recipe-creation-ingredients.md`),
because the revision was given as a chat message rather than a pasted file. **Both were applied** — the
component has no `size` field and no dry/wet control, and it does have groups, which is v2's shape and not
v1's. Read the two briefs together; the stored one alone is misleading.

## What the mockup implements

Verified by reading the file, not by assuming:

- **Structured row** — `IngredientRow` is `{ food, quantity, quantityHigh, showRange, unit, preparation }`.
  No free-text ingredient line anywhere.
- **Groups** — `ListEntry` is a `group | row` union, so sections are modelled in the list itself rather
  than as a per-row string. `COMMON_GROUP_LABELS` carries twelve suggestions, including "Dry ingredients"
  and "Wet ingredients" — which is exactly the ruling: dry/wet survive as **labels**, not as a control.
- **Informal units** — `RECOGNIZED_UNITS` (23 entries) plus `unitIsRecognized`, so an unknown unit renders
  differently rather than being rejected.
- **Unsubmittable rows** — `hasIncompleteRows` gates the wizard's advance, so a row without a food cannot
  be silently dropped.
- **Picker** — `FoodSource` is `'mine' | 'catalog' | 'custom'`, with a USDA badge, an on-demand
  "Search USDA" affordance, a custom-ingredient fallback that reads as "no nutrition data", and a
  disambiguation panel carrying "Remember my choice".

## ⛔ Two things to settle BEFORE implementing from this

1. **The palette has drifted, and copying it 1:1 would introduce a third seafoam.** The Make project's own
   `RECIPE_CREATION_FLOWS.md` records fixing seafoam `#5BA8A0` (3.4:1, fails AA) to **`#3D8B85`** (4.7:1).
   The shipped `@commise/ui` token fixed the _same_ failure to **`#31807A`** (4.67:1) — see
   [`../README.md`](../README.md), where a test holds the archive to the shipped values. Same intent, two
   independent answers. **Use the shipped token; treat the mockup's hex as a rendering of it.**
2. **`RECIPE_CREATION_FLOWS.md` (dated June 2026) still describes the OLD ingredients tab** — a
   "three-column layout: Quantity | Unit | Ingredient Name" with a **"Parse from Text" button for bulk
   paste**. That predates these briefs and contradicts them: bulk paste is a free-text ingredient line by
   another name, and `recipeIngredientInputSchema` cannot accept one. If that button survives into the
   design, it is the interactive parser this plan's scope boundary explicitly excludes.

## Retrieving more

The whole Make project is readable through the MCP server — screens, `DESIGN_SYSTEM.md`, the token file,
and the `ui/` primitives. `get_metadata` and `get_screenshot` do **not** work on Make files; only
`get_design_context` with `nodeId: 0:1`, which returns resource links to every source file.
