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

## ⛔ The styling, and what NOT to copy from it

The archived `.tsx` carries Tailwind CLASS NAMES (`bg-seafoam`, `text-charcoal`) but not the values behind
them. Those live in the project's `src/styles/theme.css`, read 2026-08-25 and compared against the shipped
`packages/apps/commise/ui/src/tokens/colors.ts`.

**Most of the palette matches exactly** — `coral #E8917A`, `sky #8ECAE6`, `sand #FAF6F0`, `charcoal
#2D3436`, `slate #636E72`, `mist #B2BEC3`, `pearl #F5F5F5`, `ocean-dark #2A6B65`, `success #4CAF7C`,
`warning #F5B041`, `premium #D4A574`. The typography scale, the 8px spacing system, the radii and the
shadow ramp all match too. **Four things do not.**

| token                                  | Figma Make     | shipped       | what it is                           |
| -------------------------------------- | -------------- | ------------- | ------------------------------------ |
| `seafoam`                              | `#3D8B85`      | **`#31807A`** | shipped is one step FURTHER darkened |
| `error`                                | `#E17055`      | **`#C05238`** | same                                 |
| `--primary` / `--ring`                 | `#5BA8A0`      | —             | Figma's own FAILING colour, unfixed  |
| `--chart-calories` / `--chart-protein` | both `#5BA8A0` | distinct      | two series rendering as one          |

⚠️ **These are not two teams answering the same question differently — it is a SEQUENCE, and I first
recorded it wrongly.** Figma sits at the pre-#113 state; the shipped tokens took Figma's own values and
darkened them again under issue #113, because `seafoam` measured 4.02:1 under white and `error` 3.16:1 —
"two fills with NO legible label, so no call site could be correct". Each moved in **OKLCH lightness only,
at constant hue and chroma** (ΔL 0.036 and 0.096), so the hue family is unchanged and the mockup still
reads as the same design. **Use the shipped token. The mockup's hex is the same colour one step lighter,
not a different intent.**

⛔ **The last two rows are defects still live at the source**, and a fresh export would reintroduce both:

- Figma's `--primary` and `--ring` still point at `#5BA8A0`, the very colour its own comment says was
  darkened away for failing AA — so the token file fixed `--color-seafoam` and left the semantic mappings
  behind. Shipped `seafoam-light` is deliberately an ACCENT ONLY, never a fill under white text, because
  the lightness needed to carry white (ΔL 0.125) "would collapse it into `seafoam`".
- `--chart-calories` and `--chart-protein` are the SAME hex. [`../README.md`](../README.md) records fixing
  exactly this in the HTML archive — "two series rendering as one" — so the archive was corrected and the
  source never was.

⚠️ There is a known third failure mode to avoid while implementing: `colors.ts` records that this repo
already shipped **six `rgba(...)` literals frozen at the pre-#113 seafoam**, plus a teal that was never in
the palette at all, because React Native has no alpha-suffix syntax. Spell a tint through `tint(...)`, not
in decimal.

## ⛔ Also unresolved: a bulk-paste button that contradicts the brief

`RECIPE_CREATION_FLOWS.md` (June 2026) still describes the OLD ingredients tab — a "three-column layout:
Quantity | Unit | Ingredient Name" with a **"Parse from Text" button for bulk paste**. That predates these
briefs and contradicts them: bulk paste is a free-text ingredient line by another name,
`recipeIngredientInputSchema` cannot accept one, and an interactive parser is what this plan's scope
boundary explicitly excludes. `IngredientsStep.tsx` does not implement it — but the design doc still
prescribes it.

## Retrieving more

The whole Make project is readable through the MCP server — screens, `DESIGN_SYSTEM.md`, the token file,
and the `ui/` primitives. `get_metadata` and `get_screenshot` do **not** work on Make files; only
`get_design_context` with `nodeId: 0:1`, which returns resource links to every source file.
