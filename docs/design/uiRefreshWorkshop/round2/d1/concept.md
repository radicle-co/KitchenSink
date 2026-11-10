# Still Life, Lit (Round 2, Designer 1)

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** The mockup is `mockup.html` in this folder. It has these parts.

- Home at 390 px, light, the whole page.
- Recipe detail at 390 px, light, the whole page.
- Home at 390 px, **dark**.
- **Discover at 1280 px**, light. Half the results have photos (stand-ins) and half are still lifes.
- **The generator sheet:** 12 covers for real Discover titles at the phone size. It is shown in light and again in dark.
- "The cover draws itself": four steps of one cover being built.
- A token strip.

All copy comes from the current boards. This is design judgement. None of it is user evidence.

## The idea

A good kitchen is a quiet room with good food in it. The chrome is a calm wall of plaster, paper and one seafoam
green. **The colour comes from the food.** A recipe with no photo gets an overhead still life. It is built from its
own matched ingredients and set in a paper mat like a print.

Round 2 adds the second half of the idea. **The food also lights the room.** A recipe page's sheet takes a
faint wash of its cover's ground colour. A tomato soup page has a faint warm-red dawn. A
risotto page has a faint sage one, and a roast chicken page a faint terracotta one. For a photo recipe, the colour is
sampled from the photo. So a cook who adds real photos still opens a new app, and every recipe feels like its own
room. Controls never take that colour. They stay seafoam.

Round 2 also proves the hard part. Every cover on the board is built with `<use>` from **one parts library**: 9
vessels, 8 dish forms and about 30 ingredient marks, coloured from a swatch table. The 12-cover sheet uses no
drawing made for one recipe.

## Palette

The family is unchanged: plaster, warm greys, seafoam, honey. Three things moved since round 1:

- **The action is seafoam again** (`#31807A`, D13 kept). Round 1's bay `#1F6B63` was a taste change, not an
  accessibility fix (white on seafoam already passes at 4.67), and D3 was right that it read heavier than "fresh".
- **The plaster is one step deeper** (`#F3ECE1`), so paper cards separate from it.
- **The kitchen light is more saturated** (`#F5E2A8`).

### Light

| Role                          | Hex                                                          | Job                                                                                              |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `canvas` plaster              | `#F3ECE1`                                                    | the page                                                                                         |
| wash (global screens)         | `#FAF0DC` → `#F3ECE1` → `#EBEEE5`                            | "window light". One warm corner per screen                                                       |
| **recipe wash** (detail only) | cover ground at t = 0.25 over plaster, for example `#F0E3D4` | the top of the detail sheet. Fades to plaster by 420 px. Replaces the warm corner on that screen |
| `paper`                       | `#FFFCF7`                                                    | cards, mats, strip, stepper, inputs, checkboxes, switch track                                    |
| `surfaceMuted` linen          | `#ECE4D7`                                                    | Soon badge, timer chip. **Never under a pewter edge**                                            |
| `ink`                         | `#24201C`                                                    | text, icons                                                                                      |
| `inkMuted` stone              | `#6B645C` (D11)                                              | secondary text, inactive tabs                                                                    |
| `lineControl` pewter          | `#8A847C` (D11)                                              | control edges, always on paper                                                                   |
| `lineDivider`                 | `#E2D9CB`                                                    | decorative hairlines                                                                             |
| `action` seafoam              | `#31807A`                                                    | the one solid fill: New recipe, Edit recipe, a checked box, the current-step numeral             |
| `actionText` ocean-dark       | `#2A6B65`                                                    | links, selected tab, selected chip label, **focus ring**                                         |
| `selectedFill`                | `#DDEBE7`                                                    | selected tab, chip and nav row                                                                   |
| `rating` honey                | `#A86A12`                                                    | stars and the kitchen-light rail. Never text                                                     |
| `now` kitchen light           | `#F5E2A8`                                                    | the current step                                                                                 |
| `dangerText`                  | `#B1442B`                                                    | error text                                                                                       |

Two values here look alike on purpose and do different jobs. `actionText` is darker than `action` because text must
clear 4.5 on every surface it sits on, including the recipe wash and linen. Seafoam as text on plaster is only 3.98.

### Dark ("after hours")

| Role                                    | Hex                                              | Note                                                           |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `canvas`                                | `#151311`                                        | warm brown-black                                               |
| `paper`                                 | `#25211D`                                        | raised from `#1F1C19`. Cards also get a 10% warm edge          |
| `paperRaised`                           | `#2E2924`                                        | sidebar, sheets                                                |
| `surfaceMuted`                          | `#2C2723`                                        |                                                                |
| `ink` / `inkMuted`                      | `#F2ECE2` / `#B3A99C`                            |                                                                |
| `lineControl` / `lineDivider`           | `#857D72` / `#3A342E`                            |                                                                |
| `action` (one token: fill **and** text) | `#6CC0B3`, label `#0F1F1C`                       | solid only on the one primary per screen                       |
| `selectedFill`                          | `#1E302D`                                        | also the fill of a **checked box** (with a mint edge and tick) |
| `rating`                                | `#E0A84A`                                        |                                                                |
| `now`                                   | `#362D1C` with a honey rail and a 25% honey edge |                                                                |
| `dangerText`                            | `#F0907A`                                        |                                                                |
| mat ring                                | `rgba(255,240,220,0.16)`                         | an inner ring on every cover and photo                         |

### Cover grounds (swatch table, light / dark)

| Ground                 | Light     | Dark      |
| ---------------------- | --------- | --------- |
| butter                 | `#F0DDB0` | `#4A3E22` |
| oat                    | `#EADFCB` | `#3A3228` |
| sage                   | `#D9DCC0` | `#2F3426` |
| blush                  | `#EBCFC4` | `#43302A` |
| sky                    | `#D6DEE0` | `#27313A` |
| terra                  | `#E8C9AE` | `#4A3326` |
| lilac                  | `#DCD3DE` | `#352F3C` |
| mint                   | `#D3E3DA` | `#25352E` |
| ink                    | `#2F3E46` | `#1C262B` |
| plaster (the fallback) | `#E9E1D4` | `#2C2723` |

In dark, a cover **swaps its ground** for the dark linen and steps the plates down (`#FBF7EF` → `#D9D0C3`). The food
keeps its chroma at about 8% less lightness. There is **no global dim**. (The mockup uses `brightness(.92)` on the
food layer as a stand-in for the dark swatch column. The generator reads the table, and `react-native-svg` needs no
filter.)

### Contrast (WCAG 2.2: text 4.5, controls and graphics 3). Computed from the hex values above.

| Pair                                                                                                       | Light                                                                     | Dark                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| `ink` on canvas / paper                                                                                    | 13.78 / 15.80                                                             | 15.77 / 13.60                      |
| `ink` on the recipe wash (terracotta, t 0.25)                                                              | 12.82                                                                     | 13.86                              |
| `inkMuted` on canvas / paper / linen                                                                       | 4.97 / 5.70 / 4.62                                                        | 8.01 / 6.90 / 6.38                 |
| `inkMuted` on the warm / cool wash stops                                                                   | 5.15 / 4.97                                                               | 8.01                               |
| `inkMuted` on the recipe wash (worst ground, tomato)                                                       | 4.60                                                                      | 7.04                               |
| `actionText` on canvas / paper / tint / linen                                                              | 5.28 / 6.05 / 5.05 / 4.91                                                 | 8.67 / 7.48 / 6.48 / not used      |
| `actionText` on the recipe wash                                                                            | 4.91                                                                      | 7.62                               |
| Label on `action` (white / `#0F1F1C`)                                                                      | 4.67                                                                      | 7.97                               |
| Focus ring (`actionText`) on canvas                                                                        | 5.28                                                                      | 8.67                               |
| `lineControl` on paper                                                                                     | 3.62                                                                      | 3.94                               |
| `lineControl` on canvas (bare)                                                                             | 3.16                                                                      | 4.57                               |
| Checked box, light: seafoam on paper                                                                       | 4.56                                                                      | not used                           |
| Checked box, dark: mint edge and tick on tint                                                              | not used                                                                  | 6.48                               |
| `ink` on kitchen light                                                                                     | 12.57                                                                     | 11.54                              |
| Honey rail on kitchen light                                                                                | 3.45                                                                      | 6.37                               |
| Honey star on canvas / recipe wash                                                                         | 3.78 / 3.43                                                               | 7.51 (paper)                       |
| `inkMuted` (inactive tab) on 92% glass over the darkest cover colour (iron `#3B3733`, ramen ink `#2F3E46`) | 4.77                                                                      | 5.16 (88% over the lightest cover) |
| `ink` on a cover chip (92% paper), worst cover                                                             | 13.73                                                                     | 10.01                              |
| Status bar over a cover                                                                                    | ink on the terracotta band 10.32. `#FFFCF7` on the ramen ink ground 10.81 |                                    |
| Pewter sketch lines on paper (decorative)                                                                  | 3.62                                                                      |                                    |

**Rules that follow from the numbers:**

- **Pewter on linen is 2.93 and fails**, and pewter on the recipe wash is also 2.93. So **every outlined control has
  its own paper fill**: the checkbox, the stepper, the switch track, the Screen-on button, chips, the search field and
  the Filters button. Linen never holds a control edge. That retires round 1's 3.01 switch.
- **The recipe wash has a guard.** The generator starts at t = 0.25 and lowers t until `inkMuted` on the top stop is
  at least 4.6. It is one hue, under about 6% chroma, and only above the fold.
- **The status bar comes from the cover.** `CoverSpec.statusBar` is `'dark' | 'light'`, picked by the top band's
  luminance (on the board: dark on the chicken, light on the ramen's ink ground). For a photo we cannot know the
  colours, so a 96 px top scrim (0 → 30% ink) goes on, with light text. That is 5.98 over a mid-tone photo.

## Type

There are two families, and each now has a strict job.

| Role                                                     | Face                                                        | Size / line                    | Notes                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `largeTitle` (greeting, Discover, …)                     | Fraunces 500, SOFT 100, **opsz 36**. The name is italic 400 | 34/1.08 phone, 48/1.04 desktop | One translated sentence. The name is a rich-text span (`Good morning, <name>{name}</name>`). No forced break |
| Recipe title                                             | Fraunces 500, opsz 36                                       | 34/1.08                        |                                                                                                              |
| **`cardTitle`**                                          | Fraunces 600, **opsz 18**                                   | 16/1.25 compact, 19/1.22 full  | **Ruling change, listed:** a recipe name is a name                                                           |
| **`groupLabel`** (cook-written: "Chicken", "Vegetables") | Fraunces italic 400, opsz 18, `inkMuted`, hairline after    | 17/1.2                         | **Ruling change, listed:** cook-written text                                                                 |
| Wordmark                                                 | Fraunces italic 500, WONK 1                                 | 26                             | the one playful moment                                                                                       |
| `sectionTitle`                                           | **Inter 600**                                               | 18 (20 on the recipe page)     | back from the serif: Recent recipes, Coming soon, Ingredients, Steps, Nutrition                              |
| `body` / step text                                       | Inter 400                                                   | 16/1.6                         |                                                                                                              |
| `label`, buttons, tabs                                   | Inter 600 / 500                                             | 14–16                          |                                                                                                              |
| `figure`                                                 | Inter 600, tabular, lining                                  | inline, 18–20 for stats        | every number, step numerals included                                                                         |
| `overline`                                               | Inter 600, +0.08 em, caps                                   | 11                             |                                                                                                              |
| `meta` / `caption`                                       | Inter 400–500                                               | 14 / 12                        |                                                                                                              |

**Weights use 100 steps only:** Fraunces 400, 500, 600 and italic 400. Inter 400, 500, 600 and 700. Both platforms
can render exactly these.

**Native ships the same voice.** We do not rely on the Expo Google Fonts statics, which are SOFT 0. We cut four static
files from the variable font with `fontTools.varLib.instancer`, pinning SOFT 100, WONK 0 and one optical size each:

- `frauncesSoftDisplayMedium.ttf` (opsz 36, wght 500)
- `frauncesSoftDisplayItalic.ttf` (opsz 36, wght 400, italic)
- `frauncesSoftTextSemiBold.ttf` (opsz 18, wght 600)
- `frauncesSoftTextItalic.ttf` (opsz 18, wght 400, italic)

The wordmark is a fixed SVG drawn from Fraunces italic WONK 1. So it needs no fifth file. The mockup sets it as
live text only for convenience. Web pins the same `opsz` values through `font-variation-settings`,
so web and native set the same shapes. The latin subset is about 4 × 35 KB.

## Surfaces, shape and elevation

- **Three levels, one meaning each.** Level 0 is plaster under one wash. Level 1 is paper: a brown contact shadow in
  light, and in dark a 10% warm edge. Level 2 is glass, only where D12 allows: the tab bar, the condensed bar with
  jump tabs, and the hero discs. **The web sidebar is solid** `paperRaised`.
- **The mat.** It is 6 px everywhere, and the radii are exactly concentric: compact card 18 = cover 12 + 6, full card
  24 = cover 18 + 6. Every cover and every photo also has an inner ring (8% ink in light, 16% warm white in dark).
  That is what keeps the print visible on a dark counter.
- **Radius scale, six tokens:** 6 (non-pressable chips: time, PRO, Draft, Private, Soon, the timer chip), 12 (cover
  in a compact card, inputs), 18 (compact card, full cover, strip, accordion, current step), 24 (full card), 28 (sheet
  top), full (pressable controls only).
- **Spacing:** a 4 pt ramp: 4, 8, 12, 16, 20, 24, 32, 40. Grid gaps are 12 on phones and 24 on desktop. Sections are
  32 apart.
- **The current step** is now the one raised card in the list. It has the kitchen-light fill, a 4 px honey rail, a
  warm shadow, the filled seafoam numeral and a small "Now" tag. Elevation shows at any distance. A tint alone did
  not.
- **Targets:** See all, 8 comments, Version history, More and the jump tabs keep 44 px min-height. The save-a-copy
  icon button is 44.
- **Focus:** a 2 px `actionText` ring with a 2 px canvas gap (5.28 light, 8.67 dark).
- **Icons:** Lucide at 1.75 stroke with round caps. Only the active tab and nav row get a 22% fill.

## Imagery: the cover generator

`coverSpecFor(recipe) → CoverSpec` is one pure function. The `RecipeCover` component renders it with
`react-native-svg` on native and with inline SVG on web.

- **Ground** comes from the hero ingredient's swatch family. With no matches, it comes from the cuisine table, and
  plaster is the last resort.
- **Vessel and dish form** come from the title and tags. There are 9 vessels: plate, bowl, deep bowl, skillet, tray,
  jar, board, tin, and none. There are 8 dish forms: noodles, swirl, stack, rice, pieces, folded, scatter
  and bird. Eggs are a mark, not a form. If no keyword matches, the plate is used. Round 2 adds forms and so answers "25 plates on beige".
- **The hero** is the most **salient** matched food. First, skip about 30 staples, such as onion, garlic, oil,
  butter, salt, pepper, flour, sugar, water and stock. Then take the food that is **rarest in this cook's
  library**. Catalog frequency breaks ties. The hero is drawn largest.
- **Accents:** one to three more of the next most salient foods.
- **Layout** comes from a hash of the recipe id: the vessel offset, the mark slots and the rotations. A cover never
  changes between visits.
- **Small level of detail:** under 200 px wide, marks under 8 rendered px are dropped (`.sm` in the mockup), and the
  hero and the vessel stay. The 12-cover sheet is shown with this on.
- **Edge cases on the sheet:**
    - **Near-twins.** Chickpea and spinach curry and red lentil dal share cuisine, tags and a cook. Salience gives
      one spinach and the other crispy shallots, and the hash moves the bowl. They read as different pictures.
    - **Three ingredients.** Overnight oats is a jar and plums, and it still looks full.
    - **Dessert.** Cookies are a scatter on parchment, with no vessel.
    - **Dark top band.** Ramen sits on the ink ground, so its status bar is light.
    - **No matched foods.** Bibimbap is a bowl on plaster. It looks plain but finished.
- **Text on covers:** only the chips (92% paper, radius 6).
- **Grain:** 9%, as **one tiled PNG on both platforms** (the `feTurbulence` in the mockup is only for the mockup).
- **Accessibility:** decorative (`aria-hidden`) on cards. A labelled image on the detail hero.
- **Photos join the set.** A real photo gets the same mat, ring and grain plus a 6% warm grade. On Discover, half
  photos and half still lifes read as one wall. (The mockup's photos are blurred-shape stand-ins.)
- **The cover draws itself.** In the editor's existing "Photos & publish" slot, the cover builds up as ingredients are
  matched. Title only gives the vessel. Matching chickpeas adds the ground and the fill. Spinach becomes the hero.
  Chili becomes an accent. There is no new control. It rewards matching, which also feeds nutrition (D20).

**Generator, not painter.** Every cover is assembled from shared parts. The mockup proves this in its own markup.
The ingredient marks are flat and simple on purpose. The craft is in the swatch colours and the composition rules,
not in drawing each dish by hand.

## Motion

- **Kept:** the one signature motion, the overshoot on the check toggle (owner ruling).
- **Quiet transitions:**
    - Content settles in: opacity and 6 px over 220 ms, ease-out. A list staggers by 30 ms, up to 6 items.
    - A cover "develops" (a 300 ms fade) **only on the first render of that recipe id in the session**. It never
      plays on a recycled cell (FlashList, a virtualised grid).
    - The recipe wash cross-fades in over 240 ms with the hero.
    - The kitchen light moves to the new step in 200 ms. The honey rail grows from the top.
    - The tab pill slides with a critically damped spring.
    - In the editor, each new cover mark fades and scales from 0.9 to 1 in 180 ms.
- **Reduced motion:** every one of these becomes an instant change, and the check keeps its state change without the
  overshoot. Nothing loops, nothing is tied to scrolling, and there is no parallax.

## What makes it exciting

- On day one, a library is a wall of small, different, appetising pictures of the cook's own food.
- Each recipe page has its own light, so photo recipes feel new too.
- A soft serif that sounds like a handwritten card, used only for names, so each name carries weight.
- The cover building itself while you match ingredients: a small reward right where writing is dullest.
- The current step glows, raised like a card under a lamp.

## What keeps it calm

- One control colour. Food colour lives in covers and in a 25% wash, never on a control.
- One solid primary per screen. In dark, checked boxes are tint, not lit squares.
- Flat, overhead, soft-edged art with a gentle grain. Nothing shiny and nothing animated after it settles.
- No layout, flow or IA changes. Glass only in D12's places. One warm wash per screen.
- Warm brown-black at night, not blue-black.

## Rulings

| Ruling                                            | Status                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D8 Home cards, 2 × 2 phone, 4 full from 960       | **Kept.** Desktop main padding is back to 32, so 1280 − 256 − 64 = 960                                                                          |
| D11 warm greys                                    | **Kept** exactly. Pewter now always sits on paper (see rules)                                                                                   |
| D12 glass on navigation only                      | **Kept.** The sidebar is solid now (round 1's was translucent, which was a break)                                                               |
| D13 New recipe is seafoam                         | **Kept.** Round 1's bay is withdrawn                                                                                                            |
| D15 roles only                                    | **Kept.** Dark is the same markup                                                                                                               |
| Only pressable controls are pills                 | **Kept, now actually true.** Round 1 broke it in four places (time and PRO chips, the Soon badge, the timer). All four are radius 6, height 24  |
| Display face sets names only (buildSpec §1.5)     | **Amended, owner call:** card titles (recipe names) and cook-written group labels use the serif. Section and accordion titles are back in Inter |
| Numbers in Inter, tabular                         | **Kept**, step numerals included                                                                                                                |
| One signature motion                              | **Kept**                                                                                                                                        |
| The canvas wash stays (#145)                      | **Amended, owner call:** global screens keep one warm corner. The recipe page replaces it with the recipe's own wash                            |
| Home: recent recipes first, then the placeholders | **Kept.** Three stacked "Coming soon" cards, as today                                                                                           |
| Shipped dark action `#31807A` + white             | **Changed, owner call:** a light mint fill with a dark label, one token, and solid only on the primary                                          |
| Cover tints (`covers.ts`)                         | **Replaced** by the generator. The six tints survive as part of the ground table                                                                |

## What changed since round 1, and why

Each critic's numbered points, with what I did.

**From D2:**

1. **The excitement lives in one unproven component.** _Fixed._ There is a parts library, a 12-cover sheet in both
   themes, edge cases, salience, more dish forms and the small level of detail. I also added excitement that does not
   depend on covers: the recipe wash, line sketches and "draws itself".
2. **The mat disappears in dark.** _Fixed._ Paper is `#25211D`, cards have a warm edge, covers have a 16% ring, and
   dark Home is shown.
3. **Hard-coded status bar.** _Fixed._ `CoverSpec.statusBar`, plus a scrim for photos.
4. **Native type.** _Fixed._ 100-step weights only, and four self-cut SOFT 100 files are named.
5. **The switch off state at 3.01.** _Fixed._ Paper track, 3.62. Linen never holds a pewter edge.
6. **The Home layout changed.** _Fixed._ Three stacked cards, "This week's meals" restored, and covers are exactly
   4:3.
7. **The dark action case.** _Fixed._ One token. Checked boxes use tint. Solid mint is only on the primary.
8. **Covers next to photos.** _Fixed._ The shared mat, grain and warm grade, shown on Discover at 1280.
9. **Kitchen light is weak.** _Fixed._ `#F5E2A8`, a 4 px rail, elevation and a "Now" tag.
10. **Trend risk.** _Addressed._ The personality now also lives in the chrome: per-recipe light, sketch empty
    states, the wordmark's WONK italic. _Residual:_ cream and a soft serif are still a known look. The covers and
    the recipe light are what keep it from being a template.

- **Bold idea: the cover draws itself in the editor.** _Adopted._
- **Bold idea: the recipe palette reaches the page.** _Adopted_, with the contrast guard.
- **Other notes.** The second wash in the sheet is gone: one wash per screen. Glass at 92% (raised from 90%) is the web figure only,
  and iOS 26 uses real glass.

**From D3:**

1. **Hand-drawn dishes versus a confetti spec.** _Fixed._ Dish forms plus a salient hero. Every cover is
   assembled.
2. **Covers at the real size.** _Fixed._ The small level of detail is on, and the sheet is at the real size.
3. **The serif spread past its job.** _Fixed_, with two listed exceptions.
4. **The pill rule broken in four places.** _Fixed._
5. **Desktop padding broke D8.** _Fixed._
6. **The Coming soon layout.** _Fixed_, with line sketches as D3 suggested.
7. **Three creams at about 1.1:1.** _Partly fixed._ The plaster is one step deeper, the shadow is a little stronger,
   the current step is raised, and the dark mat ring is used. _Residual:_ paper on plaster is 1.15. Shadow carries
   the separation in light, and that is deliberate (it is calm). A photo library now changes through the recipe
   wash.
8. **Dark action gets louder.** _Fixed._ Checked boxes use tint, covers swap ground, and the dark cover sheet is
   shown.
9. **Accuracy gaps.** _Fixed:_ the switch, concentric radii (exact now), the solid sidebar, D13 presented as taste
   (and reverted), 44 px targets, and a named focus ring.
10. **Native type.** _Fixed_ (see Type).
11. **The develop fade on recycle.** _Fixed._ It plays on the first render per id per session, and the grain is a
    PNG.
12. **Token sprawl.** _Fixed._ Six radii, a 4 pt ramp and a named type ramp.

- **Localisation of the greeting.** _Fixed._ Rich-text name, no forced break.
- **Bold idea A: the recipe's own light.** _Adopted._
- **Bold idea B: the mat is the system.** _Adopted_ for photos and empty states. Collections as a stack of three
  matted prints is _deferred_ to round 3, because Collections is not shown here.

**Declined:** an editor frame at 390 px. It was asked for, but it is not required, and showing "draws itself" in the
existing slot covered its one new idea. It is owed in round 3.

## Residual risks

- **The swatch table and the salience rule are data work.** That means about 30 marks, a dark column for each
  swatch, a staples list, and a frequency source per cook. Without the data, covers fall back to vessel on ground,
  which looks finished but plain.
- **The marks on the board were placed by hand, using shared parts.** A real hash layout will produce some awkward
  overlaps. The generator needs a collision rule (a slot grid around the vessel) and a visual test on about 200 real
  recipes before launch.
- **Photo colour sampling for the recipe wash** is unbuilt. Until it exists, photo recipes use the plaster wash.
- **The light glass at 92%** is close to solid. That is what AA needs over the darkest cover colours (4.77). Round 1's 90% fails at 4.60 over round 2's iron and ink grounds. On iOS 26 real glass handles legibility itself.
- **Fraunces static cuts** add about 140 KB to the native bundle.
- **None of this is user evidence.**
