# Pilot round 8: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge, and it is not a build spec yet. The mockup is `mockup.html` in this
folder.

**Scope.** Round 8 keeps everything from round 7 (`../round7/spec.md`) and makes three changes:

1. **Steel** is the signature blue, on the cool base (owner's choice, 2026-10-23). The slate and navy blocks are gone,
   and only the steel tokens are in the mockup.
2. The pinned ingredients bar follows the **amended R1**.
3. Version history sits **on one line** with Public and the source, under the name (R6).

## Screens

| Screen                                                               | What it shows                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `homeLight`, `homeDark`                                              | Home, unchanged                                                                             |
| `recipeLight`, `recipeDark`                                          | The full recipe page                                                                        |
| `recipeScrolled`, `recipeScrolledDark`                               | The pinned bar over the steps                                                               |
| `recipeBarPressed`                                                   | The bar with a finger down on it                                                            |
| `recipeIngredientsOpen`, `recipeIngredientsOpenDark`                 | The list open over the steps, with a scrim. The servings stepper is at the top of the list. |
| `proposalBeforeYouStart`, `proposalStepAmounts`, `proposalStepTimer` | Proposals P1 to P3 from round 7, now with the new bar. These are not owner decisions.       |

## The pinned ingredients bar (amended R1)

- **One control.** The whole bar is a single button, 56 px tall and full width. It reads
  `Ingredients for 4 · 11 items · 1 ticked`, with a chevron. Nothing is nested inside it.
- **Accessible name.** `Ingredients for 4, 11 items, 1 ticked. Show list.` With the list open, the name ends in
  `Hide list.` and the button has `aria-expanded="true"`.
- **The cue that it opens.** The bar sits on `surface`, one step darker than the page. It has a soft shadow below it,
  and the chevron sits in a 32 px round well in `card`, drawn in steel (`sigText`). The chevron and the full-width
  surface carry the cue together, so there is no separate Show button.
- **Pressed state.** The bar steps down to `line` and the well to `surface` (`recipeBarPressed`). The label stays
  readable: ink2 on the pressed fill is 4.65:1 in light mode and 5.91:1 in dark mode.
- **Open state.** The bar steps up to `card`, and the chevron points up. The list opens below it, over a scrim.
- **Servings.** The stepper has left the bar. It sits at the top of the open list, labeled `Servings`, next to the
  amounts it changes. A mistap on − or + can no longer rescale every amount mid-cook (CK-012). The ingredients card
  on the full page keeps its own stepper, where servings are usually set before cooking.

## Version history on one line (R6)

Under the name, one line now reads: globe icon, `Public` · `Family recipe card` · history icon, `Version history`.
`Version history` is a steel link, at 6.94:1 on the card. To fit the line at 390 px, "From a" was dropped, so the
source now reads "Family recipe card". That is the one copy change in this round.

## Steel tokens

| Token      | Light          | Dark               |
| ---------- | -------------- | ------------------ |
| `sig`      | `#325C7F`      | `#96BCDE`          |
| `sigLabel` | white (7.06:1) | `#0E161E` (9.15:1) |
| `sigTint`  | `#E4EEF7`      | `#1F3548`          |

All 60 pairs in the round-6 contrast table were recomputed for steel on the cool base and at dusk, and all of them
pass. The table's method and thresholds are in `../round6/spec.md`.

## Owner decisions: the check, R1 to R12 and N1 to N7

| ID           | How round 8 meets it                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 (amended) | Met. The whole bar is one button with a chevron, a pressed state and a single accessible name. The stepper is at the top of the open list, and the scrim is shown. The bar's exit, once the list's end is back in view, is a scroll behaviour. It is described here and not drawn. |
| R2           | Not in scope. Web only.                                                                                                                                                                                                                                                            |
| R3           | Met. There is no section switch, and Nutrition is a collapsed accordion.                                                                                                                                                                                                           |
| R4           | Met. `Screen on` sits beside `Edit recipe`.                                                                                                                                                                                                                                        |
| R5           | Met. Total, Prep and Difficulty are on one line, with no Cook time.                                                                                                                                                                                                                |
| R6           | Met. The rating sits under the photo, then `8 comments` with a chevron, then Nutrition lower down. Public, the source and Version history are on one line under the name.                                                                                                          |
| R7           | Partly met. The owner's view says `Only other cooks can rate your recipe.` The rating dialog and the comments list are not drawn.                                                                                                                                                  |
| R8           | Met. A carousel with dots and edge arrows.                                                                                                                                                                                                                                         |
| R9           | Met. The ingredients card runs to full length, with no inner scroll.                                                                                                                                                                                                               |
| R10          | Met. There is space under the title and 28 px above the ingredients card.                                                                                                                                                                                                          |
| R11          | Not drawn (the reader view).                                                                                                                                                                                                                                                       |
| R12          | Not drawn (the open more menu).                                                                                                                                                                                                                                                    |
| N1           | Met where shown. Home's `Add a recipe` is in the content area, never in the nav bar. My recipes is not in this pilot.                                                                                                                                                              |
| N2           | Not in scope. Wide web only.                                                                                                                                                                                                                                                       |
| N3           | Met. Home's avatar is at the top right.                                                                                                                                                                                                                                            |
| N4           | Not in scope (Discover).                                                                                                                                                                                                                                                           |
| N5           | Not broken. These screens have no horizontal scroller.                                                                                                                                                                                                                             |
| N6           | Met. Every block keeps a 16 or 20 px margin, and nothing touches the screen edge.                                                                                                                                                                                                  |
| N7           | Not in scope (the editor). The mockup draws no scrollbars.                                                                                                                                                                                                                         |

No screen breaks an owner decision. R7, R11 and R12 still need their own screens.

## Checked, and not checked

**Checked:**

- All 12 screens rendered with Playwright at 2×, with Inter and Manrope loaded.
- Each screen is 390 px wide, with no overflow and one title.
- Each screen uses 13, 15 and 17 px plus one title, and weights 400 to 600 only.
- The file is 145 KB. Two tile photos were re-encoded a little smaller to fit.
- The bar's states were compared side by side in light and dark.
- Contrast was computed for the new bar states and for all steel pairs.

**Not checked:**

- A real device, real Dynamic Type, and the bar's motion as it appears and leaves.
- Screen readers on a real build.
