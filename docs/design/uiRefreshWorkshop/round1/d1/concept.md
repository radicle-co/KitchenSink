# Still Life (Round 1, Designer 1)

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** The mockup is `mockup.html` in this folder. It has five parts:

- Home at 390 px, light.
- Recipe detail at 390 px, light, the whole page.
- Recipe detail at 390 px, dark, scrolled to Ingredients.
- Home at 1280 px, light.
- A token strip.

All copy comes from the current boards.

## The idea

A good kitchen is a quiet room with good food in it. Commise can feel the same way. The chrome is a calm
gallery wall: warm plaster, paper cards, one deep green. **The colour comes from the food.** A recipe with no
photo no longer gets one of six flat tints. It gets an **overhead still life**, a flat-lay picture drawn from its
own ingredients: a roasting tin with lemon halves and thyme, a bowl of tomato soup with a cream swirl, a stack of
pancakes with a lemon slice. Each cover sits in a thin paper mat inside its card, like a print. The type moves
from Playfair, which reads as a 2015 food blog, to **Fraunces** with its soft axis on full. That gives a round,
inky, friendly serif that sounds like a cook's handwritten card, not a magazine. Inter carries every number.
The screens look different on first sight, and the layouts do not move.

**What is new compared with what came before:**

- **modernizeA and modernizeB** took things away: no glass on cards, flat buttons, warm greys. I keep all of that.
  Still Life adds the parts they did not touch:
    - a new cover system
    - a new display face
    - concentric mat shapes
    - a "kitchen light" highlight for the current step
- **The shipped dark theme** keeps the action fill at `#31807A` with a white label in dark. Still Life lifts the
  dark action to a light bay fill `#6CC0B3` with a near-black label. It glows softly on a dark counter, it does
  not punch a hole in it, and it reaches 7.97:1.

## Palette

The hues stay in the family: sand, warm greys, one teal-green, honey. Two values move. The action deepens one step
to **bay** `#1F6B63`, the same hue as seafoam and darker (white on it is 6.28:1, against 4.67:1 today). The page and
card take a slightly warmer plaster and paper. One new role is added: **kitchen light**, used only behind the
current step.

### Light

| Role                        | Hex                               | Job                                                                                  |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `canvas` plaster            | `#F6F1E9`                         | the page, under the wash                                                             |
| wash                        | `#FBF2E0` → `#F6F1E9` → `#EDF0E8` | "window light": warm in the top-left corner, faint sage at the bottom                |
| `paper`                     | `#FFFCF7`                         | cards, the nutrition row, steppers, inputs                                           |
| `surfaceMuted` linen        | `#EEE7DC`                         | the time strip, the "Coming soon" cards, quiet fills                                 |
| `ink`                       | `#24201C`                         | text and icons                                                                       |
| `inkMuted` stone            | `#6B645C` (D11, unchanged)        | secondary text, inactive tabs                                                        |
| `lineControl` pewter        | `#8A847C` (D11, unchanged)        | edges of checkboxes, chips, steppers, the toggle                                     |
| `lineDivider`               | `#E4DCCF`                         | hairlines, decorative only                                                           |
| `action` bay                | `#1F6B63`                         | the one primary fill, the New recipe button, a checked box, the current step numeral |
| `actionText`                | `#1F6B63`                         | links, the selected tab, step numerals                                               |
| `selectedFill`              | `#E1ECE8`                         | the selected tab and chip, numeral discs                                             |
| `rating` honey              | `#A86A12` (unchanged)             | stars only, never text                                                               |
| `now` kitchen light **NEW** | `#F7E9BF`                         | behind the current step, with a 3 px honey rail                                      |
| `dangerText`                | `#B1442B` (unchanged)             | error text                                                                           |

### Dark ("after hours")

| Role           | Hex                                   |
| -------------- | ------------------------------------- |
| `canvas`       | `#151311`                             |
| wash           | `#1D1914` → `#151311` → `#121614`     |
| `paper`        | `#1F1C19`                             |
| `paperRaised`  | `#27231F`                             |
| `surfaceMuted` | `#2A2622`                             |
| `ink`          | `#F2ECE2`                             |
| `inkMuted`     | `#B3A99C`                             |
| `lineControl`  | `#80786E`                             |
| `lineDivider`  | `#38322C`                             |
| `action`       | `#6CC0B3`, label `#0F1F1C`            |
| `actionText`   | `#7DCBBE`                             |
| `selectedFill` | `#1E302D`                             |
| `rating`       | `#E0A84A`                             |
| `now`          | `#322B1D` with a honey rail `#E0A84A` |
| `dangerText`   | `#F0907A`                             |

Dark covers keep their ingredient colours, with one overlay of `rgba(14,11,8,0.26)` on top, so a bright lemon
does not glare on a dark screen.

### Contrast, every pair the mockup uses (WCAG 2.2: text 4.5, controls and graphics 3)

Glass is measured at its **worst case**: the bar's fill composited over the darkest cover colour (`#2F4844`, the
pad thai bowl), with no blur.

| Pair                                                     | Light              | Dark                            |
| -------------------------------------------------------- | ------------------ | ------------------------------- |
| `ink` on wash, warm stop / cool stop                     | 14.54 / 14.04      | 14.88 (warm stop)               |
| `inkMuted` on wash, warm / cool                          | 5.24 / 5.06        | 8.01 (canvas) / 7.88 (cool)     |
| `actionText` on the cool wash stop                       | 5.46               | 9.85 (canvas)                   |
| `inkMuted` on linen (strip labels, "Soon")               | 4.75               | 6.49                            |
| `ink` on linen                                           | 13.17              | not used                        |
| Label on `action` (New recipe, Edit recipe, checked box) | white 6.28         | `#0F1F1C` 7.97                  |
| Selected tab or chip label on `selectedFill`             | 5.20               | 7.36                            |
| `ink` on kitchen light (current step)                    | 13.37              | 11.92                           |
| Honey rail on kitchen light (graphic)                    | 3.67               | 6.58                            |
| Honey star on plaster (graphic)                          | 3.94               | not used                        |
| Bay difficulty pip on linen (graphic)                    | 5.12               | not used                        |
| `lineControl` on paper / on linen / on cool wash         | 3.62 / 3.01 / 3.21 | 3.90 / not used / 4.26 (canvas) |
| Checked box fill on paper (graphic)                      | not used           | 7.94                            |
| `ink` on the glass bar, worst case                       | 12.81              | 10.08                           |
| `inkMuted` (inactive tab) on the glass bar, worst case   | 4.62               | 5.12                            |
| `ink` on a time chip over a cover, worst case            | 13.90              | 10.85                           |

Two pairs are close and stated, not hidden:

- `lineControl` on linen is 3.01. Only the difficulty pip's empty outline sits there, and it is not the only cue:
  the word "Medium" is beside it.
- The light glass needs **90% opacity** for inactive tabs to pass over the darkest cover. Over plaster, which is
  what is under the bar most of the time, the same label is 5.36.

## Type

| Role                                                  | Face                                                           | Size / line height             | Why                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| Large title (greeting)                                | Fraunces 470, `SOFT 100`, `opsz` auto. The name is italic 380. | 34/1.06 phone, 50/1.02 desktop | Soft terminals feel hand-made and warm. The italic name feels personal, not decorative. |
| Recipe title                                          | Fraunces 460                                                   | 35/1.05                        | One serif voice for everything a cook wrote.                                            |
| Section title                                         | Fraunces 480                                                   | 23–27/1.1                      |                                                                                         |
| Card title                                            | Fraunces 520                                                   | 16.5/1.2 compact, 20/1.18 full | Slightly heavier at small sizes, so it holds up at 16 px.                               |
| Ingredient group label                                | Fraunces italic 450, `inkMuted`, with a hairline after it      | 18/1                           | It reads like a note in the margin of a recipe card.                                    |
| Body and reading body                                 | Inter 420                                                      | 16/1.6                         |                                                                                         |
| Labels, buttons, tabs                                 | Inter 600                                                      | 15.5/1                         |                                                                                         |
| Every number (amounts, times, ratings, step numerals) | Inter 620–650, tabular figures                                 | not used                       | Keeps the owner's ruling. Numbers are data, so they stay in the data face.              |
| Overline (cuisine, "Community rating")                | Inter 650, +0.13 em, caps                                      | 11.5                           |                                                                                         |

Why Fraunces: it is an open-source variable face on Google Fonts and Expo Google Fonts, so it ships on both
platforms. Its optical-size axis keeps titles crisp and small sizes sturdy without a second family. Its `SOFT`
axis takes the sharpness out of a classic serif, and that sharpness is what makes Playfair feel loud. Native loads
fixed instances (for example `Fraunces_500Medium`, `Fraunces_400Regular_Italic`). The SOFT 100 cut must be checked
in the native package. If it is missing, we subset our own static files from the variable font. (This needs
checking before round 3.)

## Surfaces, shape, elevation

- **Three levels, one meaning each.**
    - Level 0 is plaster under the wash.
    - Level 1 is paper. In light, cards have a warm contact shadow (`0 1px 2px` at 5% and `0 10px 24px −18px` at
      30%, brown not black). In dark they have no shadow and a 1 px hairline instead.
    - Level 2 is the glass layer: only the tab bar, the condensed title bar with the jump tabs, and the hero's
      back and ⋯ discs (D12). The web sidebar is solid, because D12 limits blur to small bars.
- **The mat.** A recipe card is paper with 6 px padding. The cover sits inside at radius 16, and the card is 22.
  The radii are concentric (outer = inner + padding). It reads as a print in a mat, and that is the one shape
  everyone will notice.
- **Pills only on pressable controls** (owner ruling): buttons, the stepper, timers, chips, tabs and the toggle.
  Inputs are rectangles with radius 10. The time strip and the nutrition row are 20. Sheets are 28, and the
  detail page's content sheet overlaps the hero by 28 px at that radius.
- **The tab bar floats.** It is a 64 px capsule, inset 16 px from the sides and 26 px from the bottom. The active
  tab is a bay-tint pill with a lightly filled icon. This follows D14: our own bar, with real glass behind it on
  iOS 26 and solid `paperRaised` on Android.
- **Icons** stay Lucide at 1.75 stroke with round caps. Only the active tab's icon gets a 22% fill.

## Imagery: still-life covers for recipes without photos

- **What it is.** A cover is drawn overhead, at 4:3, from three layers:
    1. a **ground**: a tablecloth tint, with an optional tea-towel stripe
    2. a **vessel**: a plate, a bowl, a roasting tin or a board
    3. **three to six ingredient marks**: simple shapes (slices, leaves, sprigs, dots)
- **Where the colours come from.** They come from the recipe's matched catalog foods. Each food maps to one of
  about 40 **ingredient swatches**: lemon, tomato, herb, root, grain, dairy, and so on. The vessel comes from a
  few keywords in the title or tags (soup → bowl, roast → tin, bread → board), and otherwise a plate. The layout
  comes from a hash of the recipe id, so a cover never changes between visits. If no ingredient is matched, the
  cover falls back to the vessel on its ground, which still looks finished.
- **Texture.** A 9% paper grain sits over every cover. This is the only texture in the product.
- **Text on covers.** There is none, except time and PRO chips on a 92% paper chip (13.90:1 worst case).
- **Native path.** `react-native-svg`, one `RecipeCover` component that both platforms render from the same shape
  data (a pure function `recipe → CoverSpec`). The grain is one small tiling noise PNG on native. Web uses an
  SVG `feTurbulence` filter or the same PNG. No blend modes and no filters beyond that are needed.
- **The covers are not glass and not photos.** They are content, so they are allowed colour (WWDC: "put colour in
  the content layer"). When a cook adds a photo, the photo wins.
- **Accessibility.** A cover is decorative (`aria-hidden`) on cards, because the title is next to it. On the
  detail hero it is a labelled image ("Cover for Lemon and thyme roast chicken").

## Motion

- **Kept:** the one signature motion, the overshoot on the check toggle (owner ruling).
- **Quiet transitions only, nothing new as a "signature":**
    - Content settles in: opacity 0 → 1 and 6 px upward over 220 ms, ease-out. Lists stagger by 30 ms, up to 6
      items.
    - A cover "develops" the first time it shows: grain and marks fade in over 300 ms, like a print in a tray.
      This is a fade, not movement.
    - The current step's kitchen light cross-fades over 200 ms when the step changes.
    - The tab pill slides between tabs with a critically damped spring.
- **Reduced motion:** every one of these becomes an instant change, and the check keeps its state change without
  the overshoot.
- Nothing loops, nothing is tied to scrolling, and there is no parallax.

## What makes it exciting

- Every recipe gets its own picture on day one, before the cook adds a photo. A library of 40 recipes becomes a
  wall of small, warm paintings, not 40 coloured squares. This is the "I want to open it" moment.
- The serif feels new and human: soft, a little round, with the italic name in the greeting.
- The mat gives every card a crafted, printed feel that UI kits do not have.
- The current step glows like a kitchen lamp. You can find your place from across the counter.

## What keeps it calm

- The chrome uses one colour. Bay green is the only colour on any control. Coral is used only inside covers,
  never on a control (owner ruling).
- Covers are flat, overhead and soft-edged, with muted ingredient colours and a gentle grain. Nothing in them is
  shiny, saturated or animated.
- There is lots of room: 22 px card radius, 40 px between sections on the detail page, a 16/1.6 reading body.
- There are no new pieces of UI, no badges added and no layout changes. Glass stays on the four places D12 allows.
- Dark mode is warm brown-black, not blue-black, so it looks like an evening kitchen and not a code editor.

## Rulings: how this sits with `ownerDecisions.md`

| Ruling                                                                                       | Status                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D11 warm greys                                                                               | Kept exactly (stone, pewter). Plaster and paper move a few steps warmer.                                                                     |
| D12 glass only on the navigation layer                                                       | Kept. Glass is on the tab bar, the condensed bar with the jump tabs, and the hero discs only.                                                |
| D13 New recipe button is solid seafoam                                                       | Kept in spirit. **Proposed value change:** seafoam → bay `#1F6B63`, the same hue one step darker, for a stronger label (6.28:1). Owner call. |
| D15 roles only                                                                               | Kept. The dark frame is the same markup with the roles redefined.                                                                            |
| Coral leaves every control                                                                   | Kept.                                                                                                                                        |
| Numbers in Inter with tabular digits                                                         | Kept, including step numerals.                                                                                                               |
| One signature motion                                                                         | Kept. The other motions are quiet transitions.                                                                                               |
| The canvas wash stays (#145)                                                                 | Kept, re-tuned from warm → green → blue to "window light", warm → plaster → sage.                                                            |
| Home: recent recipes first, 2 × 2 on phones, 4 full cards at ≥960, placeholders after        | Kept.                                                                                                                                        |
| Selected chip = tint plus a check. Inputs are rectangles. Only pressable controls are pills. | Kept (token strip).                                                                                                                          |
| Shipped dark `action` `#31807A` with a white label                                           | **Changed** to a light bay fill with a dark label. This needs the owner's agreement and an update to `darkTheme.md`.                         |
| Cover tints (`covers.ts`, 6 tints)                                                           | **Replaced** by still-life covers. The six tints stay as the fallback ground colours.                                                        |

## Residual risks

- The ingredient-to-swatch mapping is new data work: about 40 swatches, and a rule for each catalog food. It is a
  modest table, but someone must own it. Without it, covers fall back to vessel-only, which is fine but plainer.
- The covers in the mockup are drawn by hand. A generator will be plainer than hand drawing. Round 2 will show
  one generated cover for a messy real recipe, not only these five.
- The light glass at 90% opacity is close to solid. That is what AA needs over a dark cover. Blur will soften it,
  but the 90% figure is the floor.
- None of this is user evidence. It is design judgement, untested.

## What changed since last round

Round 1: nothing yet.
