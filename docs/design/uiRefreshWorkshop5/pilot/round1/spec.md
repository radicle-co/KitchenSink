# Pilot round 1: visual spec for Home and Recipe detail

Design artifact for the owner to judge. It is not a build spec yet. The mockup is `mockup.html` in this folder. It
shows four screens at 390 px: `homeLight`, `homeDark`, `recipeLight` and `recipeDark`.

**Scope.** The content, sections, actions and their order are the same as the current UI. Only the look changed.
Content ideas are in `proposals.md`.

## Palette

The frame is neutral, with one accent color (teal). Contrast is WCAG 2.x, measured with the relative-luminance
formula. Thresholds come from the corpus (`accessibility.md`): 4.5:1 for text (SC 1.4.3) and 3:1 for control
boundaries (SC 1.4.11).

| Role                      | Use                                           | Light                  | Dark                   | Text pair and ratio (light / dark)            |
| ------------------------- | --------------------------------------------- | ---------------------- | ---------------------- | --------------------------------------------- |
| `canvas`                  | Page                                          | `#FFFFFF`              | `#141413`              | n/a                                           |
| `surface`                 | Edit button, Coming soon group, step numbers  | `#F4F3F1`              | `#1F1E1C`              | ink on surface 15.36 / 14.75                  |
| `ink`                     | Titles, body, amounts                         | `#1D1C1A`              | `#F2F1EE`              | ink on canvas 17.03 / 16.32                   |
| `ink2`                    | Secondary text, labels, prep notes            | `#6A6762`              | `#A6A39D`              | on canvas 5.63 / 7.33. On surface 5.08 / 6.62 |
| `line`                    | Hairlines only (exempt from 1.4.11)           | `#E9E7E3`              | `#2D2C29`              | n/a                                           |
| `control`                 | Checkbox, stepper and keep-awake outlines     | `#8A8680`              | `#85827C`              | Non-text on canvas 3.62 / 4.81                |
| `accent`                  | Links, active tab, current step bar           | `#26746D`              | `#6CBDB3`              | On canvas 5.52 / 8.40                         |
| `accentFill` + `onAccent` | FAB, avatar, checked box, current step number | `#26746D` + white      | `#2A7E76` + white      | White on fill 5.52 / 4.83                     |
| `accentSoft`              | Timer chip background                         | `#E7F1EF`              | `#1C2F2D`              | Accent on it 4.79 / 6.40                      |
| `chip`                    | Badges over photos                            | white 94%              | `#141413` 78%          | Ink on chip 15.89 (light)                     |
| `noPhoto`                 | Tile with no photo                            | `#F4F3F1` to `#EDEBE7` | `#22211F` to `#1A1918` | ink2 on it 4.73 / 6.39                        |

Notes:

- Dark mode has its own fill. The light dark-mode teal (`#6CBDB3`) cannot carry a white label. `colors.ts` already
  records this for `seafoam-light`. So filled controls use `#2A7E76`, and text uses `#6CBDB3`.
- The accent moves from `seafoam #31807A` to `#26746D`. This is a small step darker in the same hue, so that teal
  text has more contrast on white. Only the value changes. The token still means the same thing.
- **Removed colors:** honey stars, the amber Medium chip, the tan PRO badge and the pastel letter tiles. Stars are
  now `ink`. Medium is plain text with three neutral dots. Pro is a neutral chip. Brief §3 asks for one accent, and
  `tones.ts` already makes status neutral.

## Type

The only face is Inter, at weights 400, 500 and 600. The serif display title (Playfair) is dropped, because brief §3
asks for one family. Tracking tightens as size grows: -0.011em at body sizes, -0.015em at headings, -0.024em on the
title. Every number uses tabular figures.

| Size                | Line height | Weights       | Used for                                                                                                   |
| ------------------- | ----------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| **28** `data-title` | 1.15        | 600           | The one title: the greeting, or the recipe name. Lines are balanced, so no word sits alone on a line.      |
| **17**              | 1.45 to 1.5 | 400, 600      | Body, ingredients, steps, section headings (600), fact and nutrition values (600)                          |
| **15**              | 1.33 to 1.4 | 400, 500, 600 | Secondary lines, links, tile titles (500), section-switch tabs, FAB label                                  |
| **13**              | 1.35        | 400, 500, 600 | Labels under values, badges, eyebrow and group labels (uppercase, +0.06em), timers, tab-bar labels, "Soon" |

A Playwright script checked this on every screen. Each screen uses exactly 13, 15 and 17 px plus one 28 px title,
and weights 400 to 600 only. No screen scrolls sideways.

## Spacing and shape

- **Spacing:** a 4-point base. Page margin 20. Gaps inside a group are 4 to 10, and gaps between groups are 20 to 40.
  Space separates groups, not boxes.
- **Corners:** 14 on photo tiles, 16 on the Coming soon group, 12 on buttons, 8 on chips. The phone corner is 44.
- **Boxes:** the only filled surfaces are the Coming soon group, the Edit button, the timer chips, the step-number discs
  and the no-photo tile.
  Hairlines appear only on the facts row, between the Coming soon rows, under the section switch and above the tab bar.
- **Icons:** 1.5 to 1.6 stroke, at 16 px inline and 24 px in the tab bar. Some visible controls are 32 px. Every tap
  target is 44 px.

## What changed, and why

| Change                                                                                                                                                                                                                  | Why                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Letter tiles become real photos. Photos are cropped to the tile, with no box around the tile.                                                                                                                           | Brief §3: the food photo is the hero. The letters read as placeholders and pulled the look toward cartoony. Airbnb's photo grid is the model.                          |
| The tile with no photo gets a tonal surface, a small photo glyph in a disc, and "No photo yet". Its corner, size and badge match the other tiles.                                                                       | Many recipes have no photo. This tile is meant to look like a deliberate state of the same tile, not a broken image or a loading skeleton.                             |
| The time moves from a chip on the image to a 13 px line under the title.                                                                                                                                                | One less layer on the photo, and the times line up in a column.                                                                                                        |
| Section headings drop from about 22 px to 17/600. The title drops from serif 40 to Inter 28/600.                                                                                                                        | Fixes "oversized" and "reading glasses". Weight, not size, makes the hierarchy (brief §3).                                                                             |
| Coming soon: three bordered cards with grey skeletons become one quiet group of three rows. Each row has its name, "Soon", and a small outline preview.                                                                 | The grey skeletons looked like a loading state that had broken. Outline drawings say "not built yet" and take half the height. The order and all three items are kept. |
| The canvas is white instead of warm sand with a gradient.                                                                                                                                                               | A/B tested on Home (white vs `#FAF8F5`). White makes the photos look cleaner and matches Airbnb and Mela. The warmth now comes from the food.                          |
| Recipe hero: the image runs full width under the status bar. The controls are 36 px translucent discs, the arrows 32 px, and the dots sit on the photo inside a small dark pill, so they stay visible on a white plate. | The photo leads. The controls step back.                                                                                                                               |
| The facts box with two cells and a badge becomes one row of three columns between two hairlines.                                                                                                                        | Brief §3: space instead of boxes. All three facts are now read in one glance.                                                                                          |
| "Edit recipe" changes from a filled teal bar to a quiet tonal button.                                                                                                                                                   | Editing is not the main job on this screen. The accent is kept for links, the current step and checked states.                                                         |
| Nutrition moves from a 2×2 grid to a single row of four.                                                                                                                                                                | Takes less height, with the same data.                                                                                                                                 |
| Ingredients: amount at 600, name at 400, prep note in `ink2`, all at 17. There are no dividers, and each row is about 44 px tall.                                                                                       | One reading size, with weight and color doing the work. A checked row fades to `ink2`.                                                                                 |
| The PRO badge text is now "Pro" in sentence case. It is a casing change only.                                                                                                                                           | All-caps on a small chip reads loud. The word is the same.                                                                                                             |
| Steps: neutral number discs. The current step has an accent disc and a 3 px bar. Timers are tonal accent chips.                                                                                                         | The current step stands out, and nothing else does.                                                                                                                    |

## Need records by section

| Screen | Section                               | Records                                                                                            |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Home   | Greeting and date                     | none directly. This is orientation only.                                                           |
| Home   | Recent recipes                        | FR-006, MP-003, MP-022 (pick again from what you already cook). Times serve FR-007.                |
| Home   | No-photo tile                         | FR-004 (recipes from cards and books often have no photo)                                          |
| Home   | Coming soon (nutrition, resume, week) | MP-017 and MP-027 for the week preview, CK-008 for resume cooking (keep my place)                  |
| Home   | New recipe                            | FR-004                                                                                             |
| Recipe | Hero, title, facts                    | FR-001 (get to the recipe fast), FR-007, CK-007 and CK-013 (total and prep time)                   |
| Recipe | Source and version history            | FR-002, CK-006 (trust and visible changes)                                                         |
| Recipe | Description, tags, rating, nutrition  | FR-002, FR-013. Nutrition serves no listed record and sits before the ingredients (see proposals). |
| Recipe | Section switch and keep awake         | FR-001, CK-002, CK-008                                                                             |
| Recipe | Servings stepper                      | CK-012                                                                                             |
| Recipe | Ingredient groups and checkboxes      | CK-022, CK-001                                                                                     |
| Recipe | Steps, current step and timers        | CK-003, CK-007, CK-021                                                                             |

## Large text and narrow screens

I ran a stress pass in scratch. All type was scaled to 1.4× and 2×, the width set to 320 px, and the recipe and tile
titles made long. The default screens hold. At large sizes, three rows break. These are the reflow rules for the
build:

- **Facts row (3 across):** at 1.4× or above, stack the three facts as label-value lines, one per line.
- **Nutrition (4 across):** at 1.4× or above, use 2×2. At 2×, use one per line.
- **Section switch:** the tabs scroll sideways inside their own bar and never widen the page (SC 1.4.10). Keep-awake
  stays pinned at the right.
- Checkboxes, step discs, stars and icons scale with the text. In the stress copy they stayed at 1×, and they look
  small next to 2× text.
- The byline wraps to one item per line. Long titles wrap and are never cut off.

## Checked, and not checked

**Checked:**

- The mockup was rendered with Playwright at 2× after `document.fonts.ready`.
- Each screen is exactly 390 px wide and has no horizontal overflow.
- Text sizes and weights were checked by script.
- Contrast was computed for the pairs above.
- I compared side by side with the current renders and with the Airbnb and Mela sheets, at the same phone width.
- I checked that every element of the current screens is still there.

**Not checked:**

- Real Dynamic Type and `sp` sizes. The pass above only scaled the CSS.
- Twenty ingredients, and a recipe with no photo on the detail screen.
- A real device. These are the next round's first job.
