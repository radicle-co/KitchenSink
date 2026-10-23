# Redesign canvas: system spec

This spec applies the round 9 pilot design (`../pilot/round9/`) to every board on the Commise screens canvas. The
builder applies it as written. Every decision is made here. It is a design artifact, not app code.

The redesign canvas is the built project (`packages/tools/designArtifact/dist/canvas/project`) with these layers
swapped in:

| Layer | File               | What it does                                                                                                                                                                      |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)   | `tokens.css`       | Replaces `ds/commise/tokens.css`. It has the same variable names and every one of the 74 light and 37 dark variables. Only the values change.                                     |
| (b)   | `redesign.css`     | Is loaded after `bundle.css` and after each board's own `<style>`. It maps the web component theme onto the tokens, sets the type ramp, and maps inline board type onto the ramp. |
| (c)   | `boards/*.dc.html` | Redesigned copies of boards whose layout changes. The file names are the same as the originals.                                                                                   |
| (d)   | Native theme patch | **Needed, and not one of (a) to (c).** See "Native layer" below.                                                                                                                  |

`heights.json` gives the measured height of each redesigned board, for `canvas.json`'s `h`. The widths do not
change.

## Native layer: read this first

The `Commise.Native.*` components (every `…Mobile` board) do not read CSS variables. They read the JS objects
`palette`, `role`, `roleDark`, `coverTint` and `gradient` inside `bundle.js`, so (a) and (b) leave them teal. There are
two copies, one for web and one for native. Fix it in one of two ways:

1. **Preferred.** Build a redesign copy of `bundle.js` with the literals below replaced. It is a build artifact, so
   no app code changes.
2. Give every native board a redesigned copy under (c). This costs about 200 boards.

| Object.key                                                                    | Old                                            | New                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `palette.seafoam`                                                             | `#31807A`                                      | `#325C7F`                                                        |
| `palette["seafoam-light"]`                                                    | `#5BA8A0`                                      | `#96BCDE`                                                        |
| `palette["ocean-dark"]`                                                       | `#2A6B65`                                      | `#264A68`                                                        |
| `palette.sand`                                                                | `#FAF6F0`                                      | `#EFF3F6`                                                        |
| `palette.charcoal`                                                            | `#2D3436`                                      | `#171B20`                                                        |
| `palette.slate`                                                               | `#6B645C`                                      | `#5C646E`                                                        |
| `palette.mist`                                                                | `#C9C1B6`                                      | `#DFE3E8`                                                        |
| `palette.pearl`                                                               | `#F3EEE6`                                      | `#E9EDF2`                                                        |
| `palette.pewter`                                                              | `#8A847C`                                      | `#80878F`                                                        |
| `palette.honey`                                                               | `#A86A12`                                      | `#171B20`                                                        |
| `palette.premium`                                                             | `#D4A574`                                      | `#5C646E`                                                        |
| `palette.white`                                                               | `#FFFFFF`                                      | `#FCFDFF`                                                        |
| `role.selectedFill`                                                           | `#E2EDEC`                                      | `#E4EEF7`                                                        |
| `roleDark.canvas` / `paper` / `paperRaised` / `paperOverlay` / `surfaceMuted` | warm darks                                     | `#0E161E` / `#172029` / `#212B36` / `#26313D` / `#212B36`        |
| `roleDark.ink` / `inkMuted` / `lineControl` / `lineDivider`                   |                                                | `#EBEFF2` / `#A3ACB6` / `#7D8792` / `#262F38`                    |
| `roleDark.action` / `actionText` / `selectedEdge` / `hereBar` / `focusRing`   |                                                | `#96BCDE`                                                        |
| `roleDark.onAction` / `actionPressed`                                         | white / ocean-dark                             | `#0E161E` / `#B4CFE8`                                            |
| `roleDark.selectedFill`                                                       | `#243935`                                      | `#1F3548`                                                        |
| `roleDark.rating`                                                             | `#EAA950`                                      | `#EBEFF2`                                                        |
| `roleDark.inverse` / `inverseInk` / `inverseAction`                           |                                                | `#EBEFF2` / `#171B20` / `#325C7F`                                |
| `roleDark.photoChip`                                                          | `tint("#302C28", 0.92)`                        | `tint("#172029", 0.86)`                                          |
| `coverTint` (light)                                                           | seafoam, coral, sky, premium, success, warning | `#E1EDFA`, `#F7E9D7`, `#DDEEFC`, `#F5E9DF`, `#E4EDF2`, `#F7E9D7` |
| `gradient.hero.stops`                                                         | sand, `#F0F7F4`, `#E8F4F8`                     | all three `#EFF3F6` (flat)                                       |
| Native type sizes                                                             | 12 / 14 / 16 / 18 / 20                         | 13 / 15 / 17 / 17 / 17. Title 28 at 600. Weight 700 → 600.       |

The dark cover tints are the `--cover-*` values in the `[data-theme="dark"]` block of `tokens.css`.

## Tokens

Every value is in `tokens.css`. The roles are listed below.

| Role                                                             | Light                                  | Dark                  | Use                                                                       |
| ---------------------------------------------------------------- | -------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `--canvas`                                                       | `#EFF3F6`                              | `#0E161E`             | The page: a cool mist base, and the sea at dusk.                          |
| `--paper`                                                        | `#FCFDFF`                              | `#172029`             | Cards and sheets                                                          |
| `--paper-raised` / `--paper-overlay`                             | `#FFFFFF`                              | `#212B36` / `#26313D` | Raised controls, sheets and dialogs                                       |
| `--surface-muted`                                                | `#E9EDF2`                              | `#212B36`             | Chips, fact tiles, segment tracks, the Pro chip, the difficulty chip      |
| `--ink` / `--ink-muted`                                          | `#171B20` / `#5C646E`                  | `#EBEFF2` / `#A3ACB6` | Text                                                                      |
| `--line-control` / `--line-divider`                              | `#80878F` / `#DFE3E8`                  | `#7D8792` / `#262F38` | Control edges (3:1) and hairlines                                         |
| `--action` + `--on-action`                                       | steel `#325C7F` + white                | `#96BCDE` + `#0E161E` | **Filled actions only**                                                   |
| `--action-text`, `--selected-edge`, `--here-bar`, `--focus-ring` | `#325C7F`                              | `#96BCDE`             | Steel as text or as an edge                                               |
| `--selected-fill`                                                | `#E4EEF7`                              | `#1F3548`             | The current step, and selected rows                                       |
| `--action-pressed`                                               | `#264A68`                              | `#B4CFE8`             | A pressed filled action                                                   |
| `--rating`                                                       | ink                                    | ink                   | Stars are ink, never honey.                                               |
| `--cover-*`                                                      | mist, sand, sky, driftwood, foam, sand | dusk versions         | No-photo covers and soft tile tints. They never mean anything.            |
| `--pro-fill` / `--pro-ink`                                       | `#E9EDF2` / ink                        | `#212B36` / ink       | Pro is a neutral chip.                                                    |
| `--radius-sm/md/lg/xl`                                           | 8 / 12 / 18 / 24                       | same                  |                                                                           |
| `--shadow-*`                                                     | cool, soft                             | same                  | `--shadow-lg` is the floating-card shadow (the ingredients bar, the FAB). |
| `--font-display`                                                 | Manrope 600, with an Inter fallback    | same                  | Dish names and the one page title only.                                   |

Measured contrast (WCAG 2.x):

| Theme | Pair                         | Ratio |
| ----- | ---------------------------- | ----- |
| Light | white on steel               | 7.06  |
| Light | ink-muted on canvas          | 5.37  |
| Light | ink-muted on surface         | 5.10  |
| Light | action-text on selected-fill | 6.01  |
| Light | attention on canvas          | 5.26  |
| Light | danger-text on canvas        | 5.04  |
| Light | line-control on paper        | 3.57  |
| Dark  | label on steel               | 9.15  |
| Dark  | action-text on selected-fill | 6.35  |
| Dark  | ink-muted on overlay         | 5.75  |
| Dark  | danger-text on paper         | 6.82  |
| Dark  | attention on paper           | 9.32  |
| Dark  | line-control on paper        | 4.51  |

## Type ramp

| Size                | Weight                 | Use                                                                                                                                               |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 28, line 1.15       | 600 Manrope, -0.02em   | The one page title: a recipe name on Recipe detail, or the screen title on My recipes, Collections, Profile and Sign in. Home has no large title. |
| 17, line 1.4 to 1.5 | 400 body, 600 headings | Body, ingredients, steps, section headings, sheet and dialog titles, fact and nutrition values                                                    |
| 15, line 1.4        | 400, 500 or 600        | Secondary lines, buttons, links, list rows, tile and card names (Manrope 600 for dish names)                                                      |
| 13, line 1.35       | 400, 500 or 600        | Labels, chips, badges, timers, tab labels, overlines (uppercase, +0.06em)                                                                         |

The maximum weight is 600. There are never more than three sizes plus the title on a board. `redesign.css` maps the
old sizes onto this ramp:

- 11, 12 and 13 become 13.
- 14 and 15 become 15.
- 16, 17, 18, 20 and 22 become 17.
- A 28 or 40 display becomes the 28 title.
- 24 and 20 display become 17 at 600.

## Surfaces and the steel rule

- **Steel is an accent, never an area.** Steel fills appear only on these:
    - a primary button and the FAB,
    - the selected segment,
    - a checked box,
    - the current step's number,
    - a running timer pill,
    - the ingredients bar's chevron circle.
- Selected rows and the current step use `--selected-fill` with a 1.5 px steel edge.
- Links and active tab labels are steel text.
- Nothing else is steel: no headers, bars, banners or big cards.
- **Grouping.** Sections are cards (`--paper`, `--radius-lg`, `--shadow-md`) on `--canvas`. Lists inside a card use
  hairlines that start after the leading control. There are no boxes inside boxes.
- **Status.** Draft, Private, Public and Pro are neutral chips with an icon. Difficulty is a neutral chip.
  `attention` and `danger` are kept for real warnings and errors only.
- **Covers.** A no-photo cover is a `--cover-sky` to `--cover-coral` gradient with a photo icon in a paper disc and
  "Waiting for its photo". It never uses a letter tile.
- **Photos** are real food photos, with one crop and one grade. A Pro chip sits top right, and a status chip top
  left.

## Patterns

- **Ingredients bar (phone, R1 and P4).** It is a floating card inset 12 px, with radius 18, `--paper`, a 1 px
  `--line-divider` edge and `--shadow-lg`. It shows "Ingredients for 4" at 17/600 with "11 items · 1 ticked" at
  15/400 ink-muted under it. On the right are the word Show or Hide at 15/600 in steel and a 36 px steel circle with a
  chevron.
    - Pressed: `#F6F8FA` (dark `#283440`), a 1.5 px `--line-control` edge and a 1 px drop.
    - The whole bar is one button, named "Ingredients for 4, 11 items, 1 ticked. Show list."
- **Ingredients sheet.** It is a card inset 12 px below the bar, over a `--scrim`. Servings and the stepper sit at its
  top. The list fades out under a soft bottom edge.
- **Docked timer (P2).** It is a paper card with `--shadow-lg`, above the tab bar (phone and tablet) or at the bottom
  right of the steps column (web). It shows the time left at 17/600, what is happening at 13 and a pause button.
- **Before you start (P3).** It is a card with a three-part bar (hands-on, oven, rest), a legend in words, the real
  total, and "Do first" lines. It has `Hide`.
- **Sheets and dialogs.** Phone sheets are bottom sheets with a grab handle, a radius of 24 at the top and
  `--paper-overlay`. Web dialogs are centred, 448 px maximum, with radius 24. The title is 17/600 Manrope, the body 15. Actions sit in one row of equal buttons: secondary first, primary last. A destructive action uses `--danger`
  with white and is never the default.
- **Empty, loading and error states.**
    - Empty: a card with one plain sentence, one primary action and at most one secondary action.
    - Loading: neutral skeleton blocks in the real layout, with no shimmer.
    - Error: an `attention` icon, one sentence saying what failed, and "Try again" as a secondary button.
    - Inline notes that explain a board to the reader are dashed-edge captions at 13 ink-muted.
- **Tab bar (native) and bottom tabs (web at 390).** `--paper` with a top hairline. Icons are 24 px, labels 13. The
  active item is steel.
- **Sidebar (web).** It is 232 px at 1024 and up, and a 72 px icon rail at 768. The active item is `--surface-muted`
  with a steel icon.

## Wide-screen rule (P5)

- **Phone 390:** one column, a tab bar, and the FAB above the tab bar.
- **Web 390:** like the phone, with bottom tabs.
- **Web 768:** a 72 px rail and two columns.
- **Web 1024 and 1280:** the sidebar. Content is in a 4-column grid, and reading columns stop at 640 px.
- **Tablet 834 and 1194 (native):** a tab bar and a 4-column grid. Recipe detail uses two columns: the ingredients
  are pinned beside the steps, and the photo, rating and nutrition are in the right column of the top block.
- **Recipe detail at 768 web:** phone pattern (pinned ingredients bar), because a second column squeezes the steps.
- Every control keeps a 44 pt target, and nothing depends on hover.

## Per-row notes

"Tokens only" means (a), (b) and (d) are enough, and the board keeps its shape. Decisions are listed by ID from
`../ownerFeedback.md`. Need IDs come from `docs/research/userNeeds/`.

| #   | Row                             | Beyond tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Decisions                      | Keep                                               |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------- |
| 1   | Home                            | **Redesigned copies (done, `boards/`).** The greeting is 17/500, not a large title. Recent recipes are photo tiles with a no-photo tile. Wide tiles add one meta line (time · difficulty · rating · calories). The Coming next rows have icon tiles. The FAB is "New recipe". The loading, first-run, load-error and Pro offer boards follow the state patterns.                                                                                                                                                                                                                                                                           | N1, N3, P5                     | Section order, all four states, the Pro sheet      |
| 2   | Home: breakpoints               | **Redesigned copies (done).** Uses the wide-screen rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | N3, P5                         | Widths                                             |
| 3   | Discover                        | Search on top, then one pill group beside Filters: Trending (selected), New, Quick and the cuisines. Results are a vertical list of photo tiles: 2 columns on phone, 3 to 4 on wide. The selected pill is `--selected-fill` with a steel edge, never a steel fill. Filters is a sheet (phone) or popover (web). Diet and allergy filters show the active count on the Filters chip, and are never hidden in a menu (FR-009). The ingredient filter shows chosen ingredients as removable chips (FR-015).                                                                                                                                   | N4, N5, FR-006, FR-007, FR-009 | Rail states, recent searches, no match             |
| 4   | Discover: breakpoints           | Wide-screen rule. On web the search stops at 560 px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | N2, N4                         |                                                    |
| 5   | My recipes                      | The title is 28. The search row has "New recipe" as a primary button 32 px from the field. List cards show a photo or cover, the name, and time · status. Sort is a menu. Load more is a secondary button. Empty: "Your recipes will show up here." with New recipe, Paste ingredients and Discover.                                                                                                                                                                                                                                                                                                                                       | N1, N2, FR-004, FR-016         | All states                                         |
| 6   | My recipes: breakpoints         | Wide-screen rule. On web the field stops at 560 px and New recipe sits at the far right.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | N2                             |                                                    |
| 7   | Collections                     | The title is 28. "New collection" is a primary button on the search row. A collection card shows a 2×2 photo mosaic (covers for missing photos), the name and the count. New collection is a sheet with one field. Errors appear inline under the field.                                                                                                                                                                                                                                                                                                                                                                                   | N1, FR-004, FR-016             | All states, the sheets                             |
| 8   | Collections: breakpoints        | Wide-screen rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | N2                             |                                                    |
| 9   | Collection detail               | The collection name is 28. Recipes are in the same tile grid as Home. "Make public" is a dialog with plain consequences ("Anyone with the link can see these recipes"). The upsell sheet follows the Pro sheet pattern. The recipe picker is a sheet with checkboxes and a sticky Add button. A checked box is steel. Pull updates states use the state patterns.                                                                                                                                                                                                                                                                          | FR-018, R12                    | All states                                         |
| 10  | Collection detail: breakpoints  | Wide-screen rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P5                             |                                                    |
| 11  | Recipe detail                   | **Needs redesigned copies.** Build from `../pilot/round9/mockup.html` (phone) and `mockupWide.html` (wide), with `RecipeDetailIngredientsOpenMobile` = the open sheet. Nutrition open is the accordion expanded into the four tinted tiles. The menu is an action sheet: Version history, Make private, Clear checks, then Delete recipe set apart in `--danger-text`. The reader view puts the cook's name in the eyebrow, Save a copy in place of Edit recipe, and active stars. Rating is a sheet with five 44 px stars and an optional comment (counter "0 / 1000"). In comments, your own has Edit and Delete, and Delete asks first. | R1–R12, P1–P4                  | Every state board                                  |
| 12  | Recipe detail: breakpoints      | 1280 and 1024: the pilot desktop layout. 768: phone pattern with a pinned bar. 834 and 1194: the pilot tablet layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | R2, P5                         |                                                    |
| 13  | Recipe versions                 | A list of versions as cards: number, date, who, and a one-line summary of what changed. The current version has a steel "Current" label. Restore is a dialog with a plain consequence ("Your current version stays in the history"). Preview is read-only, using the Recipe detail look with a neutral banner "Version 3, from 12 October". Compare strikes through removed text on a danger-tint background. Added text sits on a `--selected-fill` background. Both carry a word (Removed and Added), never color alone.                                                                                                                 | N6, CK-006, FR-017             | All states                                         |
| 14  | Recipe versions: breakpoints    | Wide: the list in a left column, the preview on the right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | N6                             |                                                    |
| 15  | Recipe editor                   | One-page editor in cards: Title (28 Manrope as you type), photo, facts, Ingredients, Steps. Field labels are 13/600 above inputs, inputs are 17, and errors are inline in `danger-text` with an icon. The phone has no permanent scrollbar. Fix to publish lists each blocker as a tappable row. Preview uses the Recipe detail look.                                                                                                                                                                                                                                                                                                      | N7, E1, FR-004, FR-011, CK-006 | All states                                         |
| 16  | Recipe editor: breakpoints      | Wide: the editor stays a single column (max 720 px), with a sticky save bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P5                             |                                                    |
| 17  | Recipe editor: saving           | The save status is a quiet line in the header ("Saved on this device", "Saved"). A failed save is an attention notice with Try again. Discard dialogs name what is lost ("Your changes since 3:40 pm"). Discard uses danger and is never the default.                                                                                                                                                                                                                                                                                                                                                                                      | CK-006, FR-010                 |                                                    |
| 18  | Recipe editor: conflicts        | A conflict dialog in plain words: what changed elsewhere, and two choices (Keep mine and Use theirs) plus "Compare". Merge uses the Compare styling from row 13.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | CK-006, FR-017                 |                                                    |
| 19  | Food search: typing and results | The field is in the ingredient row's sheet. Too short: a 13 hint under the field. Searching: a skeleton list. Results: rows with name 15/600, source 13 ink-muted, and a "Your food" neutral chip. More sources is a secondary button at the end of the list.                                                                                                                                                                                                                                                                                                                                                                              | E1, CK-006, FR-011             | Every case                                         |
| 20  | Food search: picking            | The picked row shows an inline spinner. A failed pick is an inline attention line with Try again. "Needs a choice" is a short row list of portions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | E1                             |                                                    |
| 21  | Food search: problems           | Each unavailable or offline case is one attention notice above the results, saying what still works ("Your own foods still work"). Never a blank list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | E1                             |                                                    |
| 22  | Food search: editing a recipe   | Change food uses the same sheet. "Refused" says why in one sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | E1                             |                                                    |
| 23  | Ingredient rows                 | Rows match the Recipe detail ingredient list: amount 600 and name 400. State is shown with an icon and a word, never color alone. The row editor is a sheet with amount, unit and food fields. The nutrition total uses the four tinted tiles.                                                                                                                                                                                                                                                                                                                                                                                             | CK-006, CK-012, CK-001         |                                                    |
| 24  | Ingredient panels               | Choose match, needs review, no match, lookup failed and food removed each use the notice pattern inside the row's sheet, with one primary action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | E1, FR-011                     |                                                    |
| 25  | Create my own food              | A form card: name, then the macros as 2-column inputs with units on the right. Errors appear inline. A duplicate shows `You already have Rolled oats` with Use it (primary) and Create anyway (secondary).                                                                                                                                                                                                                                                                                                                                                                                                                                 | FR-011                         |                                                    |
| 26  | Food details                    | A details card with the four macro tiles, then a portions list. Search inside it uses the search pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | FR-002                         |                                                    |
| 27  | Paste a list                    | A sheet with a tall text area, then a reading state (a skeleton of rows) and then "Needs you" (rows with the review pattern). Refused, stalled and offline use the notice pattern, and say the pasted text is kept.                                                                                                                                                                                                                                                                                                                                                                                                                        | FR-004, FR-005, FR-012, CK-006 |                                                    |
| 28  | Profile                         | The title is 28. Cards: you (avatar, display name), settings, data (Export my recipes, a primary-style row: FR-010) and the danger zone (Close and Erase, set apart, `danger-text`). Close and Erase dialogs state plainly what happens and what is kept. Erase asks the person to type a word first. The blocked state is a notice.                                                                                                                                                                                                                                                                                                       | FR-010, FR-019, N3             | All dialogs and states                             |
| 29  | Profile: breakpoints            | Wide: one centred column, 640 px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P5                             |                                                    |
| 30  | Sign in                         | It is the front door (no welcome screen). Over the canvas is a centred card (max 400): the Commise wordmark in Manrope, the title "Sign in" 28, social buttons as secondary, email, Continue as primary, then the sign-up link. A food photo is shown only on web 1024 and up, as a side panel. The code screen has six 44 px boxes. Errors appear inline.                                                                                                                                                                                                                                                                                 | FR-045a                        | The sign-up link, which is the only way to sign up |
| 31  | Sign in: breakpoints            | 1024 and up: the photo panel at left 50%, with the card on the right. Narrower widths show the card only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | P5                             |                                                    |
| 32  | Sign up                         | The same card pattern. Finish asks only for a display name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |                                |                                                    |
| 33  | Sign up: breakpoints            | As row 31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |                                |                                                    |
| 34  | App-wide                        | Snackbars are inverse cards (`--inverse` with `--inverse-ink` and a `--inverse-action` button), 13 to 15 text, at the bottom above the tab bar. Route loading uses skeletons. Errors use the notice pattern with Try again. Not found says `We couldn't find that page` and links to Home. Offline read is a neutral banner `You're offline. Recipes you've opened still work.` Sync states are a quiet line, with no spinner over content. Unreadable work says what was kept.                                                                                                                                                            | CK-005, FR-010                 | All states                                         |
| 35  | Data sources                    | One reading column (max 640). Each source is a card with its name, licence and link. The states use the patterns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | FR-002, FR-013                 |                                                    |
| 36  | Data sources: breakpoints       | Wide-screen rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P5                             |                                                    |

## Builder checklist for each board

1. Does the board render with `tokens.css` + `redesign.css` + the native patch? If its shape matches its row note,
   leave it.
2. If not, copy it into `boards/` and rebuild the markup with the patterns above. Keep the file name, the title, the
   width and every string. Change copy only where this spec says so.
3. Check that it uses three sizes plus at most one 28 title, weights 400 to 600, and steel only on the listed fills.
4. Check that it has no horizontal overflow and that every control has a 44 pt target.

## Unsure, flagged

- **Manrope.** `tokens.css` loads it from Google Fonts with `@import`. If the artifact sandbox blocks the request,
  every title falls back to Inter 600. The fix is to bundle the font file beside the Inter files.
- **The native layer (d)** is required for every `…Mobile` board, and it needs the coordinator's decision.
- **`--brand-coral`, `--brand-premium` and `--brand-honey`** were remapped to sand, ink-muted and ink. These are raw
  palette names, and a board that used them as a meaningful color can shift.
- **The `redesign.css` attribute selectors** catch inline `font:` shorthand and `font-size:`. A board that sets type
  in its own `<style>` class is not caught and needs a check. I verified them only on the static Home boards, because
  the canvas runtime (`support.js`) is not in `dist`.
- **Home on web has a FAB.** The current web Home board has "New recipe", so the redesign keeps it. This corrects the
  round 9 spec, which said the desktop Home has none.
