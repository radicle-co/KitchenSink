# Still Life, Lit (Round 3, Designer 1)

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** The mockup is `mockup.html` in this folder. It has these parts:

- Home at 390 px, light, the whole page.
- Recipe detail at 390 px, light, the whole page.
- **Recipe detail at 390 px, dark, the whole page.**
- **The recipe's own light, four recipes**: the tops of four detail pages.
    - terra (roast chicken)
    - blush (tomato soup)
    - ink (ramen, with a light status bar)
    - a photo recipe, with its hue and status bar sampled from the photo
- **Recipe detail at 1280 px**, light. This is today's 12-column layout.
- The generator sheet, light and dark. It shows covers in all five composition families, two studies and a bright
  photo. Below them, one study ripens into a cover.
- A token strip.

All copy comes from the current boards. The role and recipe-light hex values on the page are generated from one
Python table, and every ratio below was computed from that same table. The food fills inside the covers are set by
hand. This is design
judgement. None of it is user evidence.

## The idea

A good kitchen is a quiet room with good food in it. The chrome is a calm wall of plaster, paper and one seafoam
green. **The colour comes from the food.** A recipe with no photo gets an overhead still life. It is built from its
own ingredients and set in a paper mat like a print. **The food also lights the room.** Each recipe page takes a
light in the hue of its own cover. The light sits at the top of the page and again at the step being cooked. A
tomato soup page is faintly rosy, and a ramen page is faintly cool. A recipe the cook has not matched yet is not a
blank. It is an **unfinished study**: a line drawing of its dish in the recipe's light, and it fills with colour as
the cook matches ingredients. Over the first weeks, a library looks like a sketchbook ripening into a wall of
pictures of the cook's own food.

## Palette

The chrome family has not changed since round 2. It is plaster, warm greys, seafoam and honey. What is new is how
the recipe's light is built.

### Light

| Role                       | Hex                               | Job                                                                                     |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `canvas` plaster           | `#F3ECE1`                         | the page                                                                                |
| global wash                | `#FAF0DC` → `#F3ECE1` → `#EBEEE5` | one warm corner, only on global screens (Home, Recipes, Discover)                       |
| `paper`                    | `#FFFCF7`                         | cards, mats, the strip, inputs, every outlined control's fill                           |
| `surfaceMuted` linen       | `#ECE4D7`                         | Soon badge and timer chip. It never holds a control edge                                |
| `ink`                      | `#24201C`                         | text, icons, **the filled difficulty pips**                                             |
| `inkMuted` stone (D11)     | `#6B645C`                         | secondary text, inactive tabs, **the cuisine overline**                                 |
| `lineControl` pewter (D11) | `#8A847C`                         | control edges, always on paper. Also study lines                                        |
| `lineDivider`              | `#E2D9CB`                         | decorative hairlines only                                                               |
| `action` seafoam (D13)     | `#31807A`                         | **the one solid button per screen**, and the current-step numeral                       |
| `actionText`               | `#2A6B65`                         | links, the selected-state edge, checked-box edge and tick, focus ring                   |
| `selectedFill`             | `#DDEBE7`                         | selected tab, chip, nav row and checked box. **Always with a 1.5 px `actionText` edge** |
| `rating` honey             | `#A86A12`                         | stars only. Never text                                                                  |
| `dangerText`               | `#B1442B`                         | error text                                                                              |

### Dark ("after hours")

| Role                                | Hex                        | Note                                                                       |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `canvas`                            | `#151311`                  | warm brown-black                                                           |
| `paper` / `paperRaised`             | `#25211D` / `#2E2924`      | cards have a 10% warm edge. Covers have a 16% warm inner ring              |
| `ink` / `inkMuted`                  | `#F2ECE2` / `#B3A99C`      |                                                                            |
| `lineControl` / `lineDivider`       | `#857D72` / `#3A342E`      |                                                                            |
| `action` (one token: fill and text) | `#6CC0B3`, label `#0F1F1C` | solid only on the one primary button and the current numeral               |
| `selectedFill`                      | `#1E302D`                  | with a mint edge. This is also the checked box, the same as in light       |
| `rating` / `dangerText`             | `#E0A84A` / `#F0907A`      |                                                                            |
| cover plate / rim                   | **`#9C9488` / `#877F74`**  | stepped down from `#D9D0C3`, so the food is the brightest thing in a cover |

### The recipe's own light (the one new system)

It is built in **OKLCH, at a fixed lightness**. The hue comes from the cover's ground. A study takes its hue from
the cuisine table. A photo takes the dominant hue of the photo, sampled once at upload.

| Strength     | Light                                                                                           | Dark             | Where                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `recipeWash` | L 0.944, with the chroma solved so the wash lands about ΔE 8 from plaster (range 0.008 to 0.05) | L 0.215, C 0.022 | the top of the detail sheet: solid to 140 px, gone by 560 px. On desktop: the whole main column, gone by 680 px |
| `recipeGlow` | L 0.930, with the chroma solved for about ΔE 11 (range 0.008 to 0.07)                           | L 0.26, C 0.03   | the current step's fill. It is also the pool behind a study                                                     |

| Hue        | Wash / glow (light)   | Wash / glow (dark)    | ΔE wash to plaster |
| ---------- | --------------------- | --------------------- | ------------------ |
| terra 58°  | `#FFE8D7` / `#FEE2CD` | `#21170F` / `#2F2015` | 6.8                |
| blush 35°  | `#FFE6E0` / `#FFE0D8` | `#231613` / `#311F1A` | 7.1                |
| sage 112°  | `#ECEFD6` / `#E8EBCB` | `#1A1B0F` / `#242614` | 8.0                |
| butter 88° | `#F7ECD1` / `#F4E7C7` | `#1E190D` / `#2A2313` | 8.3                |
| ink 240°   | `#E8EDF1` / `#E0E9F1` | `#101B23` / `#162631` | 8.8                |
| Korean 20° | `#FDE6E6` / `#FEDFDE` | `#231515` / `#311E1E` | 8.1                |

Over all 12 table hues, the wash sits between **ΔE 6.1 and 9.1** from plaster. In round 2 the terra wash was 4.2, the
tomato soup was 2.8, and the ink ground was a failing grey. The chroma floor holds cool hues (sky, lilac, ink) at
0.008, so the ink ground gives a cool dawn, not a dirty one. The warm-hue cap (0.05) keeps terracotta from turning
pink. Because lightness never moves, **contrast holds by construction**. No guard is needed:

- `inkMuted` on any wash: 4.90 to 4.98
- `actionText` on any wash: 5.20 to 5.30
- honey stars on any wash: 3.72 to 3.79
- `ink` on any glow: 12.96 or more
- the solid numeral on any glow: 3.74 or more

### Contrast (WCAG 2.2: text 4.5, controls and graphics 3)

| Pair                                               | Light                                                                        | Dark                |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `ink` on canvas / paper                            | 13.78 / 15.80                                                                | 15.77 / 13.60       |
| `inkMuted` on canvas / paper / linen               | 4.97 / 5.70 / 4.62                                                           | 8.01 / 6.90 / 6.38  |
| `inkMuted` on any recipe wash                      | 4.90 to 4.98                                                                 | 7.50 or more        |
| `actionText` on canvas / paper / tint              | 5.28 / 6.05 / 5.05                                                           | 8.67 / 7.48 / 6.48  |
| `actionText` on any recipe wash                    | 5.20 to 5.30                                                                 | 8.13 or more        |
| Label on `action` (the one solid button)           | 4.67                                                                         | 7.97                |
| Focus ring (`actionText`, 2 px gap) on canvas      | 5.28                                                                         | 8.67                |
| Selected edge (`actionText`) on canvas             | 5.28                                                                         | 8.67                |
| Checked box: edge and tick on tint                 | 5.05                                                                         | 6.48                |
| `lineControl` on paper (every outlined control)    | 3.62                                                                         | 3.94                |
| `lineControl` on a recipe wash                     | 3.11 to 3.16, **never used**                                                 |                     |
| Resting numeral ring (pewter on paper)             | 3.62                                                                         | 3.94                |
| Current numeral (`action`) on any glow / its label | 3.74 or more / 4.67                                                          | 7.17 or more / 7.97 |
| `ink` on any glow                                  | 12.96 or more                                                                | 13.03 or more       |
| Honey star on paper / canvas / wash                | 4.33 / 3.78 / 3.72 or more                                                   | 7.51 / 8.71         |
| `dangerText` on paper                              | 5.50                                                                         | 6.83                |
| Study line on paper                                | 3.62 (pewter)                                                                | 6.90 (`inkMuted`)   |
| Dark plate on dark paper                           |                                                                              | 5.33 (was 10.47)    |
| Status bar over a cover                            | ink on the terra band 10.32. `#FFFCF7` on the ink ground 10.81               |                     |
| Status bar over a photo (sampled)                  | ink on the focaccia's top band: 7.0 on the crust, 5.53 on the darkest dimple |                     |

### Rules that follow from the numbers

- **Every outlined control keeps its own paper fill.** Pewter is 2.93 on linen and 3.11 to 3.16 on a wash. That is
  a bare pass at best, so a bare control edge never sits on either.
- **Only `ink` and the solid numeral sit on the glow.** `inkMuted` on a glow is about 4.7, and that is too close to
  4.5 to rely on.
- **The photo scrim is only a fallback.** A photo with no stored sample gets it. Light text needs 4.5:1
  even over a white plate, so the scrim is **62% ink at the top**, fading to 0 by 112 px. Round 2's 30% scrim gave
  1.85:1. In normal use the sample sets `statusBar` and there is no scrim at all.

## Type

The type is unchanged from round 2, and both critics asked to keep it.

| Role                              | Face                                                            | Size / line                      |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| `largeTitle` (greeting, Discover) | Fraunces 500, SOFT 100, opsz 36. The name is italic 400         | 34/1.08 phone, 44–48 desktop     |
| Recipe title                      | Fraunces 500, opsz 36                                           | 34/1.08 phone, 44/1.06 desktop   |
| `cardTitle`                       | Fraunces 600, opsz 18. Clamped to 2 lines                       | 16/1.25 compact, 19/1.22 full    |
| `groupLabel` (cook-written)       | Fraunces italic 400, opsz 18, `inkMuted`, with a hairline after | 17/1.2                           |
| Wordmark                          | Fraunces italic 500, WONK 1 (shipped as a fixed SVG)            | 26                               |
| `sectionTitle`                    | Inter 600                                                       | 18 (20 on the recipe page)       |
| `body`, step text                 | Inter 400                                                       | 16/1.6                           |
| `label`, buttons, tabs            | Inter 600 / 500                                                 | 14–16                            |
| `figure`                          | Inter 600, tabular lining                                       | 18–20 in the strip and nutrition |
| `overline`                        | Inter 600, +0.08 em, caps, `inkMuted`                           | 11                               |

The serif carries names only: the title of a recipe and a cook's own words. Everything the app says is set in
Inter. Weights use 100 steps only. Native ships four static Fraunces cuts made with `fontTools.varLib.instancer`
(SOFT 100, opsz pinned), about 140 KB. Fraunces is tight between words at display sizes, so names get +0.05 to
0.06 em of word spacing.

## Surfaces, shape and elevation

- **Three levels, one meaning each.**
    - Level 0 is plaster, under one light: the global corner, or the recipe's own light.
    - Level 1 is paper. In light it has a brown contact shadow. In dark it has a 10% warm edge.
    - Level 2 is glass, only where D12 allows: the tab bar, the hero discs and the condensed bar. The web sidebar is
      solid.
- **The mat** is 6 px, with concentric radii: compact card 18 = cover 12 + 6, and full card 24 = 18 + 6. Every cover
  and photo has an inner ring (8% ink in light, 16% warm white in dark).
- **Radius scale:**
    - 6: non-pressable chips (time, PRO, Draft, Private, Soon, timer)
    - 12: compact cover, inputs
    - 18: card, strip, accordion, step
    - 24: full card
    - 28: sheet top
    - full: pressable controls only
- **Spacing:** 4, 8, 12, 16, 20, 24, 32, 40. Grid gaps are 12 on phones and 24 on desktop. Sections are 32 apart.
- **Selected state** is tint plus a 1.5 px `actionText` edge on tabs, chips, nav rows and checked boxes. The tab icon
  also gets a 40% fill. So the selected item is now the _most_ defined shape in its row, and it survives greyscale.
- **The checked box is the same in both themes:** tint, an `actionText` edge and a tick. So in light the only solid
  seafoam shapes on the recipe page are Edit recipe and the current numeral. "One solid button per screen" is now
  literally true.
- **The current step has two signals:** the recipe's glow and the solid numeral (plus `aria-current="step"`).
    - The shadow, the honey rail and the "Now" tag are gone, so there is no new string.
    - Every step has the same box (`padding 10 14 12 4`, `margin 4 -8 0`), and only the fill changes. Nothing reflows
      when the light moves.
    - The numeral sits in a 44 px hit area. At rest it has a pewter ring on paper (3.62), so it reads as pressable.
- **Targets:** See all, the comment and version links, the jump tabs and the steppers are all at least 44 px.
- **Focus:** a 2 px `actionText` ring with a 2 px canvas gap.

## Imagery: the cover generator

`coverSpecFor(recipe) → CoverSpec` is one pure function. `RecipeCover` renders a spec with `react-native-svg` on
native and inline SVG on web.

### The spec is computed once and stored

- **When:** on save. A change to that recipe's own ingredients or title computes it again. Nothing else does.
- **What is stored:** `{ specVersion, seed, family, vessel, form, ground, hero, accents, focus, statusBar }`.
- **Who sees it:** every viewer, the author and anyone on Discover, sees the stored spec. A saved copy carries it
  too. Nothing about the viewer or the cook's other recipes changes a cover, so "I saw the one with the lemon"
  stays true.
- **The hero rule is stable.**
    - Skip about 30 staples (onion, garlic, oil, butter, salt, pepper, flour, sugar, water, stock).
    - Rank the rest by the food's **share of the recipe's mass**, weighted by a fixed catalog-distinctiveness
      factor. The food the dish is mostly made of wins, not the garnish.
    - Round 2's "rarest in this cook's library" is withdrawn. It changed old covers whenever the cook saved
      something else, and it picked the sumac over the lamb.
- **When the form is a surface** (soup, curry, dal, sauce), the hero _is_ the surface colour. Its mark then appears
  once, large, on the rim.

### One table of forms (the captions on the sheet use it)

| Form      | Kind                  | Dishes                                                                         |
| --------- | --------------------- | ------------------------------------------------------------------------------ |
| `surface` | generic               | soups, curries, dal, sauces, broths. The vessel's fill, plus an optional swirl |
| `noodles` | generic               | pasta, ramen, pad thai                                                         |
| `grains`  | generic               | rice, risotto, oats, couscous                                                  |
| `stack`   | generic               | pancakes, layers, toast                                                        |
| `pieces`  | generic               | sheet-pan, roast vegetables, stir-fry                                          |
| `folded`  | generic               | tacos, dumplings, omelettes. One half-moon drawing                             |
| `pattern` | generic               | no form drawing. The hero mark repeats (cookies, biscuits, snacks)             |
| `whole`   | **one-dish drawings** | today only a whole bird. A fish and a loaf are still to draw                   |

That is seven generic forms and one form drawn for a single dish. Eggs are a mark, not a form. There are nine
vessels: plate, bowl, deep bowl, skillet, tray, jar, board, tin and none. **Every form reads swatch variables**, and
the dark column is generated as OKLCH L − 0.08. The build asserts that no form carries a hard-coded fill.

### Five composition families (the fix for "25 bowls with a lemon in the corner")

The seed picks one of these families:

- **centred**: the vessel in the middle.
- **cropped**: the vessel at 130–155%, running off two edges.
- **close-up**: no rim. The form fills the frame.
- **pair**: two vessels.
- **pattern**: no vessel. The hero repeats.

The seed also picks one of four hero slots: in the dish, upper left, on the rim, or lower left. **The hero is drawn
in the dish** wherever the form allows. There are four distinct leaves now (basil, spinach, cilantro and parsley),
plus the thyme sprig.

On the sheet, no cover has a garnish mark in its top-right corner. Where anything sits there, it is a vessel, the
close-up form or a pattern. In round 2, eight of twelve covers had a garnish there. Tomato soup is a centred bowl with basil in it and a
tomato on the rim. Gazpacho is a cropped bowl with cucumber in the soup. Side by side, they are now different
pictures.

### Small level of detail

The generator computes each mark's rendered radius (mark radius × scale × card width ÷ 400). It drops any mark under
4 px radius (8 px across) from a render under 200 px wide. The hero and the vessel always stay. On this board the
`.sm` tags were set by hand to match that rule at 172 px. The real generator applies the rule itself.

### The unfinished study (the fallback, designed)

A recipe with **fewer than two matched foods** is a study:

- paper ground
- the vessel (from the title) as a line drawing (pewter in light, `inkMuted` in dark)
- a pool of the recipe's glow behind it, in the cuisine's hue (bibimbap is Korean red, not plaster)
- each matched food in full colour

It looks intended, never empty. It turns the most common day-one cover into the start of the "draws itself" story.

### "Draws itself", with motion rules

The editor's existing Photos slot already says "No photo? This cover is used instead." That slot shows the
study-to-cover sequence (the sheet's ripening strip):

1. Title only: a study.
2. Each match adds its mark. **A mark never moves once it is placed.** The seed picks the family and the slots
   once, at the first vessel. Editing never picks them again.
3. At the second match, the ground cross-fades from paper to its swatch over 240 ms.
4. On save, the spec is frozen.

No editor frame is drawn this round. See the dispositions.

### Photos

**A cook's photo gets the mat and the inner ring only: no grain, no warm grade and no vignette.**

- D2 asked for no vignette. D3 asked for no alteration at all, and D3 is right: it is their picture, and making it
  muddier than the one they took is the one thing a cook will notice.
- The family resemblance comes from the mat, not from altering the photo.
- The detail hero for a photo recipe takes its hue and its `statusBar` from a sample stored at upload.

## Motion

- **Kept:** the one signature motion, the overshoot on the check toggle (owner ruling).
- **Opening a recipe:**
    - The tapped print grows into the detail hero. Its crop eases from the card's framing to the close-up (one spec,
      two crops).
    - The recipe's light then blooms down the sheet over 240 ms, once per open.
    - On native this is a shared-element transition. Android falls back to a cross-fade wherever that proves
      fragile.
    - Under reduced motion it is a plain cross-fade.
- **Quiet transitions:**
    - Content settles in: opacity and 6 px over 220 ms, ease-out, with a 30 ms stagger for up to 6 items.
    - A cover develops (a 300 ms fade) only on the first render of a recipe id per session. It never plays on a
      recycled cell.
    - The glow moves to a new step in 200 ms. It is a background-colour change only, and nothing reflows.
    - The tab pill slides with a critically damped spring.
    - In the editor, a new mark fades and scales from 0.9 to 1 over 180 ms, and the ground cross-fades over 240 ms.
- **Reduced motion:** every one of these becomes an instant change. Nothing loops, nothing is tied to scrolling, and
  there is no parallax.

## What makes it exciting

- **A wall of pictures of your own food,** and the wall does not repeat. Five families, four hero slots and real
  leaves make every card a different picture, even at 160 px.
- **Every recipe is its own room.** Open a tomato soup and the page is rosy. Open a ramen and it is cool. Photo
  recipes get this too, from the photo.
- **The step you are cooking glows in the dish's own colour,** on the phone and deep down the desktop page, where
  your eyes are.
- **The library ripens.** A new cook's empty-looking recipes are sketches that fill with colour as they match
  ingredients. Matching also feeds nutrition (D20), so the reward sits right where writing is dullest.
- Opening a recipe feels like stepping up to the table: the print grows, the light comes on.

## What keeps it calm

- One control colour, and one solid button per screen. Food colour lives only in covers and in the light, never on a
  control.
- The light is one hue at fixed lightness, about ΔE 8 at the top. It is a mood, not a colour block. The glow is
  softer than round 2's kitchen light (ΔE 8.9 to 11.5, against 25).
- The current step went from five signals to two.
- Flat, overhead, soft-edged art with a gentle grain. Nothing shiny, and nothing moves after it settles.
- Warm brown-black at night. The dark plate is stepped down, so no bright discs.
- No layout, flow or IA changes.

## Rulings

| Ruling                                | Status                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D8 Home cards                         | **Kept.** 2 × 2 compact on phones                                                                      |
| D11 warm greys                        | **Kept** exactly                                                                                       |
| D12 glass on navigation only          | **Kept.** The sidebar is solid                                                                         |
| D13 New recipe is seafoam             | **Kept**                                                                                               |
| D15 roles only, dark built in         | **Kept.** Dark is the same markup. The recipe-light classes switch per theme                           |
| Only pressable controls are pills     | **Kept**                                                                                               |
| Display face for names only           | **Amended, owner call (as in round 2):** card titles and cook-written group labels use the serif       |
| Canvas wash (#145)                    | **Amended, owner call:** global screens keep one warm corner. A recipe page uses its own light instead |
| Cover tints (`covers.ts`)             | **Replaced** by the generator. The six tints survive in the ground table                               |
| Shipped dark action `#31807A` + white | **Changed, owner call:** a mint fill with a dark label, one token                                      |
| No new localisation keys              | **Kept.** Round 2's "Now" tag is gone                                                                  |

## What changed, round by round

- **Round 1, "Still Life".** The calm plaster-and-seafoam chrome, and covers as overhead still lifes of the
  recipe's own ingredients. Each cover was painted by hand.
- **Round 2, "Still Life, Lit".** The covers became a generator: a parts library, `CoverSpec` and the small level of
  detail. The recipe's own light, sketch empty states, and "draws itself" arrived. The chrome rules were fixed
  (pills, pewter on paper, the dark mat, the native type).
- **Round 3, this round.** It closes every point from both critiques. The table below gives each one.

### Dispositions: D2's critique

| #     | Point                                                                                                   | Disposition                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Salience by library rarity changes covers, and Discover differs per viewer                              | **Fixed.** The spec is stored on save, ranked by mass share × catalog distinctiveness, and is the same for every viewer. The draws-itself motion rule is added                                                                                                                      |
| 2     | Twelve covers share one composition                                                                     | **Fixed.** Five families, four hero slots, the hero in the dish, four leaves. No garnish mark in the top-right corner (8 of 12 before). Soup and gazpacho are shown side by side                                                                                                    |
| 3     | The recipe's light is barely proven, the guard is too narrow, the dark rule is inconsistent             | **Fixed.** OKLCH at fixed L, so every token passes on every hue (listed). Shown on four detail tops, a dark detail page and the 1280 desktop. The dark rule is stated (L 0.215, C 0.022)                                                                                            |
| 4     | The photo wall is proven by construction. The vignette                                                  | **Vignette dropped. Photos are not graded.** The residual is **recorded honestly below**: the board allows no real photographs                                                                                                                                                      |
| 5     | The dark Home drops part of the layout                                                                  | **Fixed by substitution.** The dark frame is now the full recipe page, which shows the dark wash, glow, checkbox and plate nobody had seen                                                                                                                                          |
| 6     | Control colour on non-controls                                                                          | **Fixed.** The cuisine overline is `inkMuted`, the pips are `ink`                                                                                                                                                                                                                   |
| 7     | The selected chip is the weakest shape                                                                  | **Fixed.** A 1.5 px `actionText` edge on chips, tabs and nav rows                                                                                                                                                                                                                   |
| 8     | "Now" is a new string, a fifth signal                                                                   | **Fixed.** Removed. The current step has two signals                                                                                                                                                                                                                                |
| 9     | LOD by hand, form colours hard-coded, board unused                                                      | **Fixed in the spec** (LOD is now a computed rule, and the board's tags approximate it). **Fixed in the markup:** forms read variables, and the build asserts it. The board vessel is still in the library but not on the sheet: **declined**, as twelve slots went to the families |
| Extra | Owed: Discover 390, desktop Home, Recipes, Collections, editor, dark detail, photo detail, error states | **Partly shown:** dark detail, photo detail and desktop detail. **Declined:** the rest. The brief caps the output at a representative sample, and these screens add no new rule beyond what is shown                                                                                |
| B1    | Close-up crop for the detail hero                                                                       | **Adopted.** One spec, two crops                                                                                                                                                                                                                                                    |
| B2    | Carry the light to the current step                                                                     | **Adopted.** It is now the glow                                                                                                                                                                                                                                                     |
| R2    | Round 2's own promise: Collections as a stack of three matted prints                                    | **Declined.** Collections is not in this sample, so the idea is not shown and is not claimed                                                                                                                                                                                        |

### Dispositions: D3's critique

| #     | Point                                                                    | Disposition                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | The recipe's light cannot be seen. The ink ground fails                  | **Fixed.** ΔE 6.1–9.1 (it was 2.8–4.2), with every pair passing by construction. The ink ground is a cool dawn                                                                                                                                              |
| 2     | Rarity changes covers and differs between people                         | **Fixed** (as D2 #1)                                                                                                                                                                                                                                        |
| 3     | The form taxonomy does not match the captions                            | **Fixed.** One table. 7 generic forms and 1 one-dish form, named honestly                                                                                                                                                                                   |
| 4     | The fallback is the least designed state. Bibimbap is on plaster         | **Fixed.** The unfinished study, with the cuisine hue (Korean)                                                                                                                                                                                              |
| 5     | The current step is the loudest thing. The rail curves. The text reflows | **Fixed.** The glow is softer (ΔE 8.9–11.5). The shadow, rail and tag are gone. Every step has the same box. The numeral has a 44 px hit area and a pewter ring at rest                                                                                     |
| 6     | Dark plates are bright discs. There is no dark recipe page               | **Fixed.** Plate `#9C9488` (5.33, was 10.47). The full dark detail page is shown                                                                                                                                                                            |
| 7     | Photos and stand-ins. Do not alter a cook's photo                        | **Fixed:** mat and ring only. A bright white-plate-on-marble stand-in sits on both sheets. **Residual:** still a stand-in                                                                                                                                   |
| 8     | The photo scrim fails on bright photos                                   | **Fixed.** `statusBar` is sampled at upload. The fallback scrim is 62% (4.5 over pure white)                                                                                                                                                                |
| 9     | Discover feet, tab state, "one solid primary"                            | **Fixed:** titles clamp to 2 lines, and the meta sits at the card foot. The tab has the edge and a 40% fill. Checked boxes are tint, so there is one solid button                                                                                           |
| Extra | Coverage: Recipes 390, Discover 390, editor 390, desktop detail          | **Desktop detail shown.** **Declined:** Recipes, Discover and the editor at 390. The brief asks for a sample. The editor's one new idea (the ripening cover) is shown on the sheet instead. Round 2's promise of an editor frame is withdrawn, not deferred |
| A     | One open transition                                                      | **Adopted** (see Motion)                                                                                                                                                                                                                                    |
| B     | The fallback as an unfinished study that ripens                          | **Adopted.** It is the centre of this round                                                                                                                                                                                                                 |

## Residual risks

- **The photo wall is still unproven.** Real phone photos have cool casts, busy counters and flash. Every photo on
  this board is a stand-in drawn in SVG, because the board allows no images. It needs a test with real, ordinary
  photos before launch.
- **The generator is data work.** It needs:
    - about 35 marks
    - a swatch table with a dark column
    - a staples list
    - a mass estimate per ingredient line (unit to grams)
    - the cuisine hue table

    Without the mass data, the hero falls back to catalog distinctiveness alone.

- **The marks on this board were placed by hand from shared parts.** A real seed layout needs a slot grid with a
  collision rule, plus a visual review of about 200 real recipes.
- **Photo sampling** (hue and top-band luminance) runs at upload. It is unbuilt.
- **The shared-element open transition** is fragile on Android. The cross-fade fallback is the honest default there.
- **Fraunces static cuts** add about 140 KB to the native bundle.
- **None of this is user evidence.**
