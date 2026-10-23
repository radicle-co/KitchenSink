# Pilot brief: Home and Recipe detail

This pilot tests whether the new brief and the user-needs database produce better work than the current UI. It is
one designer and two screens. The owner judges the result.

## Read first, in this order

1. `docs/design/uiRefreshWorkshop5/brief.md`: the whole brief. It is the standard for this work.
2. `docs/research/userNeeds/synthesis.md`, then the records it names for these two screens. Home touches
   `FR-006`, `FR-007`, `MP-003`, `MP-022` and `MP-017`. Recipe detail touches `CK-001`, `CK-003`, `CK-007`, `CK-013`,
   `CK-021`, `CK-022`, `CK-012` and `FR-001`.
3. The current screens, rendered at 390 px: `pilot/current/HomeMobile_light.png`, `HomeMobile_dark.png`,
   `RecipeDetail390_light.png`, `RecipeDetail390_dark.png`. The tab bar in the middle of the Recipe detail render is a
   capture artifact. It is fixed to the bottom in the app.
4. The reference apps' App Store screenshots, as one sheet each, in
   `/tmp/claude-1000/-home-brandon-Development-KitchenSink/7091c8e5-d5b1-4d19-bb4d-8da0ff6bbb8c/scratchpad/refs/`:
   `airbnb_sheet.jpg`, `mela_recipe_manager_sheet.jpg`, `things_3_sheet.jpg`. These are
   for looking at only. Do not copy them into the repo.

Do not read `docs/design/uiRefreshWorkshop`, `uiRefreshWorkshop2`, `uiRefreshWorkshop3` or `uiRefreshWorkshop4`. They
are superseded, and their rules caused the failures the brief describes.

## The job

Refine the look of the current Home and Recipe detail. The owner rates the current flows and layouts as good, so:

- **Keep the content and the layout.** Same sections, same data, same actions, in the same order. The "Coming soon"
  block on Home stays and is restyled, not removed.
- **Change how it looks.** Type scale and weights, spacing, color, surfaces, imagery, icons and small details.
- **Content ideas go in a separate note**, not in the mockup. If the research shows a section or action is wrong,
  write it in `proposals.md` with the record IDs. For example, the amount shown inside the step (`CK-001`).

## Rules that are easy to break

- Body text at the platform default: 17 px on these mockups. Secondary text 13 to 15 px, regular weight, softer color.
  At most three text sizes on a screen, plus the one title that earns a large size. Mark that title with
  `data-title`.
- Weights 400 to 600. Heavy weights are rare.
- A calm base and one bold signature color with a job (brief §3, Color). Personality comes through voice and short
  motion first (brief §3). Illustration only where the brief fences it, and never on these two screens.
- Space instead of boxes and borders. Fewer, smaller icons.
- **Real food photos** for recipes, never letters or drawn food. Use photos from Wikimedia Commons with a free
  license. Embed each one small (WebP or JPEG data, about 20 KB or less) and credit it in `proposals.md`.
- **Show the no-photo state on the same screen.** Many real recipes have no photo. At least one Home card uses it.
  Design it to look intended, not empty.
- No visual metaphor as styling. No kitchen objects, cartons, cards made to look like paper, or textures.

## Deliverables

Write everything to `docs/design/uiRefreshWorkshop5/pilot/round1/`:

1. `mockup.html`: one self-contained file, under 150 KB. Each phone screen is an element with
   `data-screen="<name>"` and is exactly 390 px wide. Show four screens: `homeLight`, `homeDark`, `recipeLight`,
   `recipeDark`. Show each screen at full length, with the tab bar at its end. Use Inter from Google Fonts, the app's
   current face, unless you have a reason in the brief to change it.
2. `spec.md`: the palette as a role table (light and dark hex, contrast ratio of each text pair), the type scale, the
   spacing scale, and a short "why" for each change from the current UI. For each section of each screen, name the
   need records it serves.
3. `proposals.md`: content ideas with record IDs, and the photo credits.

Before you finish:

1. Render the mockup with Playwright at the size it is drawn, and look at every screen next to the current UI and
   the reference sheets.
2. Ask the brief's question: is this clearly better than the current UI, and does it stand beside Airbnb, Mela and
   Things 3? Fix what does not, then render again.

Return a three-line summary only.
