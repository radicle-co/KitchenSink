# Pilot round 2: visual spec for Home and Recipe detail

This is a design artifact for the owner to judge. It is not a build spec yet. The mockup is `mockup.html` in this
folder. It shows four screens at 390 px: `homeLight`, `homeDark`, `recipeLight` and `recipeDark`.

**Scope.** The content, sections, actions and their order are the same as the current UI. Only the look changed.
Content ideas are in `proposals.md`. Round 1 is in `../round1/`, and this file replaces its spec.

## What round 2 changed, in the order of the art direction

| #   | Note                  | What changed                                                                                                                                                                                                                                                                                                                                                                      | Why it is better                                                                                                                                                 |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Identity through type | Recipe names use **Newsreader 500** (optical sizing on). This covers the Recipe title at 30 px and the Home tile names at 17 px. Everything else stays Inter.                                                                                                                                                                                                                     | See "The serif test" below.                                                                                                                                      |
| 2   | Photography           | There are four new Commons photos. Each is cropped so the food fills the frame, with little or no plate edge or table. All four have one grade: exposure set from the median luminance, a slight warm balance, saturation brought to one target, and +5% contrast.                                                                                                                | The round-1 set was four different shoots: a grey plate, a busy table, and an over-saturated close-up. The new set reads as one shoot.                           |
| 3   | Hero controls         | Back and More are 32 px discs of translucent material (blur plus saturate), with a 44 px tap area. The previous and next photo arrows are smaller: 28 px dark translucent discs at the very edges, with a 16 px white chevron. The dots sit in a small dark pill. The photo runs edge to edge under the status bar (380 px), with a faint top shade so the controls stay legible. | All four actions remain. The arrows are visible but recede, and only Back and More read as buttons.                                                              |
| 4   | Coming soon           | Each row now shows one 20 px line icon (pie, play, calendar), its label, and "Soon". The ring, bar and circle drawings are gone.                                                                                                                                                                                                                                                  | Nothing on the row is fake data, so it no longer looks unfinished.                                                                                               |
| 5   | Warmth                | Light ground `#FCFBF8` with a warm `#F3F0EB` surface. Dark ground `#181614`, with a single surface step at `#23201D`. All ink and line values are warmed to match.                                                                                                                                                                                                                | Round 1's pure white and pure near-black slabs read cold. All text contrast still passes (table below).                                                          |
| 6   | Home greeting         | The greeting is now 17/500 on one line, with the date under it and the avatar beside it. The photo grid is now the large element on Home.                                                                                                                                                                                                                                         | A 28 px greeting outranked the food. The `data-title` mark stays on the greeting, but no text on Home is set large. The recipe screen keeps the one large title. |

## Two reversals, made on direction

- **Warm ground.** In round 1, an A/B test chose pure white over warm `#FAF8F5`. Round 2 reverses that on the
  coordinator's note. The new ground is warmer than white but lighter than the round-1 warm option.
- **Avatar beside the greeting.** This is a small layout change. The avatar is still at the top right, but it now
  shares a row with the greeting instead of sitting on its own row above it.

## The serif test

I rendered the recipe title and two tile names in five versions, side by side at true size. The faces were Inter
only, Playfair Display 600, Fraunces 500 (opsz 72, SOFT 0, WONK 0), Newsreader 500 and Source Serif 4 600.

- **Playfair** (the current face) has very high stroke contrast. It reads as a wedding or a magazine cover, and its
  thin strokes break up at 17 px on a tile.
- **Fraunces**, even at SOFT 0, has heavy, rounded joins. It reads friendly and a little quirky, which is the
  "cartoony" direction the owner rejected.
- **Source Serif 4** is solid but plain. Next to Inter it reads as a second sans-serif and adds little.
- **Newsreader** has moderate contrast and an even colour. It holds at 17 px and is calm at 30. It is the closest in
  spirit to Mela's dish names, and Mela is a reference the owner named.
- **Inter only** is clean, but a stranger cannot tell it from any template.

The winner is **Newsreader**. It gives Commise one recognisable voice in one place, the name of the dish, which is
the content. The controls stay quiet in Inter (brief §1a.7: "keep the controls quiet and put personality in the
content"). This is a **deliberate exception to brief §3** ("one family"), made on the round-2 art direction and limited
to dish names. A Home tile name is the label of a link, so the serif does sit on a control there. It never appears
on buttons, navigation, body text or data.

## Palette

The frame is neutral and warm, with one accent (teal). Contrast is WCAG 2.x, measured with the relative-luminance
formula. The thresholds come from the corpus (`accessibility.md`): 4.5:1 for text (SC 1.4.3) and 3:1 for control
boundaries (SC 1.4.11).

| Role                 | Use                                           | Light                  | Dark                   | Pair and ratio (light / dark)                         |
| -------------------- | --------------------------------------------- | ---------------------- | ---------------------- | ----------------------------------------------------- |
| `canvas`             | Page                                          | `#FCFBF8`              | `#181614`              | n/a                                                   |
| `surface`            | Edit button, Coming soon group, step numbers  | `#F3F0EB`              | `#23201D`              | ink on it 15.12 / 14.26                               |
| `ink`                | Titles, body, amounts                         | `#1D1B18`              | `#F3F0EB`              | on canvas 16.60 / 15.88                               |
| `ink2`               | Secondary text, labels, prep notes, row icons | `#69645D`              | `#A9A39A`              | on canvas 5.67 / 7.21. On surface 5.16 / 6.48         |
| `line`               | Hairlines only (exempt from 1.4.11)           | `#E8E4DE`              | `#322E2A`              | n/a                                                   |
| `control`            | Checkbox, stepper and keep-awake outlines     | `#8A847C`              | `#878078`              | non-text on canvas 3.58 / 4.63                        |
| `accent`             | Links, active tab, current step bar           | `#26746D`              | `#6CBDB3`              | on canvas 5.34 / 8.22                                 |
| `accentFill` + white | FAB, avatar, checked box, current step number | `#26746D`              | `#2A7E76`              | white on fill 5.52 / 4.83                             |
| `accentSoft`         | Timer chip                                    | `#E5F0EC`              | `#1D302C`              | accent on it 4.74 / 6.33                              |
| `material`           | Back and More discs on the photo              | canvas 72%             | canvas 55%             | over a photo, so the ratio varies. See "Not checked". |
| `noPhoto`            | Tile with no photo                            | `#F3F0EB` to `#ECE8E1` | `#26231F` to `#1E1C19` | ink2 on it 4.80 / 6.25                                |

Notes:

- Dark mode has its own fill, because the light teal cannot carry a white label. `colors.ts` already records this for
  `seafoam-light`.
- The accent is `#26746D`, one step darker than `seafoam #31807A` in the same hue, so that teal text has more contrast.
  Only the value changes. The token still means the same thing.
- **Removed colors:** honey stars, the amber Medium chip, the tan PRO badge and the pastel letter tiles. Brief §3
  allows one accent, and `tones.ts` already makes status neutral.

## Type

| Size                | Face                                 | Weights               | Used for                                                                                                                       |
| ------------------- | ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **30** `data-title` | Newsreader                           | 500                   | Recipe title only. Lines are balanced, tracking -0.018em.                                                                      |
| **17**              | Inter, and Newsreader for tile names | 400, 500 (serif), 600 | Body, ingredients, steps, section headings (600), the Home greeting (500), fact and nutrition values (600), tile names (serif) |
| **15**              | Inter                                | 400, 500, 600         | Secondary lines, links, Coming soon labels, section-switch tabs, FAB                                                           |
| **13**              | Inter                                | 400, 500, 600         | Labels under values, badges, eyebrow and group labels (uppercase, +0.06em), timers, tab-bar labels, "Soon"                     |

A Playwright script checked every screen. Home uses 13, 15 and 17 and nothing larger. Recipe uses 13, 15 and 17 plus
the one 30 px title. Weights are 400 to 600 only, and no screen scrolls sideways. Every number uses tabular figures.

## Spacing, shape and icons

- **Spacing:** a 4-point base. The page margin is 20. Gaps inside a group are 4 to 10, and gaps between groups are 20
  to 40.
- **Corners:** 14 on photo tiles, 16 on the Coming soon group, 12 on buttons, 8 on chips and 44 on the phone.
- **Filled surfaces:** the Coming soon group, the Edit button, the timer chips, the step-number discs and the
  no-photo tile. Hairlines appear only on the facts row, between the Coming soon rows, under the section switch and
  above the tab bar.
- **Icons:** 1.5 to 2.0 stroke, at 16 px inline, 20 px in the Coming soon rows and 24 px in the tab bar. Some visible
  controls are 32 px. Every tap target is 44 px.

## Photo treatment (one shoot)

Each photo goes through the same steps:

1. Crop so the food fills the frame. Tiles are 34:30, and the hero is 390:360.
2. Set a gamma so the median luminance reaches 0.50, clamped to 0.85 to 1.15.
3. Warm the balance: R ×1.03, B ×0.97.
4. Scale saturation to one mean, clamped to ±15%.
5. Add +5% contrast.
6. Save as WebP at 20 KB or less.

The script is in the designer's scratch folder, and the build will need a production equivalent. Real user photos
will vary much more than this set, so the build needs a rule for them. That rule is a proposal (see `proposals.md`),
not part of this round.

## Need records by section

| Screen | Section                              | Records                                                                                            |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Home   | Greeting and date                    | none directly. This is orientation only.                                                           |
| Home   | Recent recipes                       | FR-006, MP-003, MP-022. The times serve FR-007.                                                    |
| Home   | No-photo tile                        | FR-004 (recipes from cards and books often have no photo)                                          |
| Home   | Coming soon                          | MP-017 and MP-027 (week), CK-008 (resume cooking: keep my place)                                   |
| Home   | New recipe                           | FR-004                                                                                             |
| Recipe | Hero, title, facts                   | FR-001, FR-007, CK-007, CK-013                                                                     |
| Recipe | Source and version history           | FR-002, CK-006                                                                                     |
| Recipe | Description, tags, rating, nutrition | FR-002, FR-013. Nutrition serves no listed record and sits before the ingredients (see proposals). |
| Recipe | Section switch and keep awake        | FR-001, CK-002, CK-008                                                                             |
| Recipe | Servings stepper                     | CK-012                                                                                             |
| Recipe | Ingredient groups and checkboxes     | CK-022, CK-001                                                                                     |
| Recipe | Steps, current step and timers       | CK-003, CK-007, CK-021                                                                             |

## Large text and narrow screens

I re-ran the stress pass on this round. All type was scaled to 1.4× and 2×, the width set to 320 px, and the recipe
and tile names made long. This is what happened, and the rule the build needs for each case:

- **Home does not overflow at either scale.** The recipe screen overflows because of the section switch. Rule: the
  tabs scroll sideways inside their own bar and never widen the page (SC 1.4.10).
- **Greeting row:** at 2× the greeting wraps to three lines, with the avatar beside it, and it still fits. Rule: at
  2× the avatar moves above the greeting, where it was in the current UI. The mockup does not do this yet.
- **Serif tile names:** they clamp at two lines with an ellipsis ("Lemon ricotta…" at 1.4×). At 2× a single long word
  ("Weeknight") is wider than its tile. Rule: at 1.4× and above, the tile grid goes to one column and the names are
  never clamped.
- **No-photo tile:** at 1.4× the Draft badge overlaps the photo disc. Rule: the disc and its label hide when the
  tile is too short for both.
- **Facts row (3 across):** at 1.4× and above, stack the facts as label-value lines.
- **Nutrition (4 across):** at 1.4× and above, use 2×2. At 2×, use one per line.

## Checked, and not checked

**Checked:**

- The mockup was rendered with Playwright at 2× after `document.fonts.ready`. `document.fonts.check` confirms that
  Inter and Newsreader both loaded, so the serif in the renders is Newsreader and not a fallback.
- Each screen is 390 px wide with no overflow.
- Type sizes and weights were checked by script.
- Contrast was computed for every pair in the table. The white photo arrows sit on a dark disc at 46% opacity. On the
  white plate, the lightest disc pixel gives 3.4:1, which passes SC 1.4.11.
- Round 1 and round 2 were compared side by side, in light and dark.
- Round 2 was compared side by side with Airbnb and Mela at the same phone width.

**Not checked:**

- The Back and More icons over a busy photo. They need a contrast check on real user photos. The top shade can
  need more strength there.
- Real Dynamic Type sizes.
- A real device.
