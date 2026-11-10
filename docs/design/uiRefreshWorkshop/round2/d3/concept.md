# Mise en Place — Designer 3, Round 2

Mockup: [`mockup.html`](mockup.html). It contains:

- Home at 390 px, light.
- Recipe detail at 390 px, light, the full page.
- Home at 390 px, dark.
- Collections at 1280 px, light.
- The editor's first fold at 390 px, with no plate.
- A proof strip: four fallbacks, the plate rule with its slots drawn on, interaction states, and the two D13 options.
- A token strip.

The copy and the order of elements come from the current boards.

## The idea

A commis sets out the station before service: the lemon, the butter and the herbs, each in its place. Commise does
the same for a recipe that has no photo. The recipe gets a **plate**. A plate shows the first three matched ingredients
on a coloured ground. It adds one neutral object: a whisk, a spoon, a cloth, a fork or some crumbs. The plate
shows what goes **into** the dish, never the finished dish. That one change makes the idea honest:

- A function can build the plate from data the app already has (the matched catalog foods).
- It can never invent food, and it can never draw a bad picture of a pancake.
- The name of the product finally means something you can see.

The chrome stays quiet: oat paper, green-black ink, and one basil colour for everything you press. Two things are
new and go further than round 1:

- Each plate's ground gives its recipe page a **key**. The key is a tone for words you read. It is never used for
  things you press.
- At night the grounds turn deep and the food sits under a warm **lamp**.

Last round, Designer 1 and I both brought a concept called "Still Life". This round is a different proposal. d1 draws
the **dish** (a tin, a bowl, a stack) and frames it in a paper mat. Mise en Place draws the **ingredients**. A stated rule
makes every plate. Every recipe page takes its key from its ground. Collection covers are mosaics.
Credit for borrowed ideas:

- the lamplit dark: d1's bold suggestion A.
- the per-recipe key and the ground-coloured chrome: d1's suggestion B and d2's suggestion 1.
- the mosaic covers: d2's suggestion 2.
- the wash taken from the food: d2.

## Palette

The role names match today's tokens, so a re-theme changes values only. I measured every ratio with the WCAG 2.x
relative-luminance formula. **T** marks a text pair, which needs 4.5:1. **N** marks a non-text pair (an edge, a glyph,
a state fill or a focus ring), which needs 3:1.

### Light

| Role                | Hex       | Use                                                                                     |
| ------------------- | --------- | --------------------------------------------------------------------------------------- |
| canvas              | `#F6F2EA` | the page, under the wash                                                                |
| paper               | `#FFFDF8` | cards, the strip, fields, chips on plates                                               |
| surface-muted       | `#ECE6D9` | the segmented track, the "Soon" skeletons                                               |
| ink                 | `#1F2A22` | text, inactive tab labels and glyphs                                                    |
| ink-muted           | `#6B645C` | **D11 slate, now honoured**                                                             |
| line-divider        | `#E3DCCD` | hairlines only                                                                          |
| line-control        | `#8A847C` | **D11 pewter, now honoured**: edges of checkboxes, steppers, fields, timers, step discs |
| action (basil)      | `#2E6B47` | filled buttons, a checked box, the current step, the active tab pip                     |
| action-pressed      | `#24573A` | the pressed fill                                                                        |
| action-text / focus | `#2A6342` | links, icon buttons, the 2 px focus ring                                                |
| action-tint         | `#DDEBDF` | the tonal button, the selected chip, the selected sidebar row                           |
| saffron             | `#A36A00` | star glyphs only                                                                        |
| danger              | `#B23F28` | destructive text                                                                        |

| Pair                                                                    | Ratio                     | Kind           |
| ----------------------------------------------------------------------- | ------------------------- | -------------- |
| ink on canvas / paper                                                   | 13.31 / 14.62             | T              |
| ink-muted on canvas / paper / surface-muted                             | 5.22 / 5.73 / 4.69        | T              |
| ink-muted on the tinted wash (worst ground, tomato)                     | 4.61                      | T              |
| white on action / pressed                                               | 6.34 / 8.40               | T              |
| action-text on canvas / paper / muted / tint                            | 6.35 / 6.97 / 5.70 / 5.75 | T              |
| danger on canvas                                                        | 5.17                      | T              |
| line-control on canvas / paper                                          | 3.32 / 3.64               | N              |
| focus ring on canvas                                                    | 6.35                      | N              |
| active tab pip (action) on glass, worst case over the roasting-tin grey | 4.75                      | N              |
| ink tab label on glass (0.84), worst case over tomato / the tin         | 12.20 / 11.14             | T              |
| saffron star on canvas / on the wash                                    | 4.07 / 3.80               | N (never text) |

### Dark ("night kitchen")

| Role                                | Hex                                                      |
| ----------------------------------- | -------------------------------------------------------- |
| canvas / paper / surface-muted      | `#131512` / `#1C1F1A` / `#262A24`                        |
| skeleton                            | `#353A31` (lifted, so the "Soon" cards no longer vanish) |
| ink / ink-muted                     | `#EEEBE3` / `#ABA89F`                                    |
| line-control                        | `#7A7E73`                                                |
| action, with a dark label `#0F1A12` | `#86C99F`                                                |
| action-text / focus                 | `#93D3AA`                                                |
| action-tint                         | `#22362A`                                                |
| saffron / danger                    | `#E8B54A` / `#F08C74`                                    |

| Pair                                                   | Ratio              | Kind |
| ------------------------------------------------------ | ------------------ | ---- |
| ink on canvas / paper                                  | 15.41 / 13.99      | T    |
| ink-muted on canvas / paper / surface-muted            | 7.72 / 7.01 / 5.66 | T    |
| ink-muted on the tinted wash (butter, the darkest top) | 6.35               | T    |
| label on action / pressed                              | 9.24 / 7.57        | T    |
| action-text on canvas / paper                          | 10.61 / 9.63       | T    |
| line-control on canvas / paper                         | 4.42 / 4.01        | N    |
| active pip on glass (0.80) over the lemon motif        | 5.07               | N    |
| ink tab label on glass over the lemon motif            | 8.22               | T    |
| status-bar text on the lamplit hero ground             | 11.22              | T    |

### Plate tokens: `plate.ground`, `plate.key`, `plate.motif`

| Ground     | Light     | Dark (lamplit) | Key, light  | Key, dark   |
| ---------- | --------- | -------------- | ----------- | ----------- |
| butter     | `#F3D67F` | `#3A3120`      | `#7A5A00`   | `#E8C766`   |
| chili      | `#EBA37E` | `#3D2A20`      | `#9A4A22`   | `#EFA680`   |
| tomato     | `#E5624A` | `#42231C`      | chili's key | chili's key |
| olive      | `#C5CC94` | `#2D3121`      | `#5B6328`   | `#BFC98A`   |
| terracotta | `#E9B48C` | `#3B2C23`      | `#9A4E2A`   | `#E9B48C`   |
| sea        | `#A8C6C4` | `#1F2E2E`      | `#2F6461`   | `#9CCBC7`   |

- **Key ratios.** In light, each key is 5.38 to 6.04 on canvas and up to 6.28 on paper. On the 12% wash it is at
  least 4.92 (the worst case is the tomato wash). In dark, each key is 8.28 to 10.15 on paper and 8.49 on its wash.
- **No key is red.** The round 1 tomato key `#B0361F` was almost the same colour as danger. A red "Chicken" label can
  look like an error. Tomato now borrows chili's key, and red stays the colour of danger.
- **Motifs** are about 45 roles, for example `m-lemon`, `m-skin` and `m-steel`. Each role has a light and a dark
  value. The plates no longer use raw hex. **D15 decision:** `plate.*` is a closed token family. Only the Plate
  renderer reads it. The role guard gets one rule: a `plate.*` read outside `Plate` fails. Grounds never carry text. A
  status chip on a plate sits on solid `paper` (ink on it: 14.62 / 13.99), whatever the ground.

## Type

- **Display: Fraunces**, weight 560, `SOFT` 100, `WONK` 0, with **`font-optical-sizing: auto`**. Round 1 pinned
  opsz 96 and brought back the thin hairlines. This is used at **22 px and up only**: screen titles (32 / 48 desktop),
  the recipe title (34), section heads (26–28), collection titles (23).
- **Inter** does all the work, with tabular lining figures for every number: times, servings, ratings, counts,
  calories. Reading text is 16.5–17 / 1.6. Overlines and group labels are 12 px caps at +9% tracking. They are the
  only words that take the recipe's key.
- **Why.** The serif speaks for the food and the sans does the work. Weight 650 on Inter heads replaces 600 so the
  sans holds its own beside Fraunces.

## Surfaces, shape, elevation

- **Flat by default.** Cards are `paper` with a 1 px inset hairline and no shadow. Only plates (and the floating tab
  bar and button) cast a shadow, so food is the one thing that sits "on" the page.
- **Radius:** plates 22 (phone) and 24 (desktop and mosaic), cards 20, the recipe sheet's top 28, fields 12. Pills
  are used only for pressable controls.
- **The recipe sheet** still overlaps the hero by 28 px. Its grab line is drawn in the recipe's key at 55%. Its top
  300 px takes a 12% wash of the ground.
- **The wash (#145, kept).** Every screen's top wash is the canvas mixed with 12% of the first image's ground, fading
  to plain canvas by 360 px. The wash still exists. It now comes from the cook's own food.
- **Glass (D12)** is used only on the tab bar, the hero discs, menus and sheets: light at 0.84, dark at 0.80.
  Inactive tab labels and glyphs are `ink`. The active tab has a filled `action` pip, a filled glyph and weight 750.
  It never depends on hue alone (SC 1.4.1). The active row in the desktop sidebar gets the same
  signals, plus a tint and a 4 px basil bar.
- **Decoration no longer spends basil.** The round 1 squiggle is gone. The difficulty pips are `ink-muted`, with the
  off pip drawn as a pewter outline. The word "Medium" always stays.

## Imagery: the plate system

1. **Inputs.** The rule reads the ingredient lines in order, and the matched catalog food of each line. D20 allows a
   line with no match.
2. **Hero** is the first matched ingredient that has a motif, centred at 60% scale (66% on a wide hero).
3. **2nd and 3rd** are the next two such ingredients, at 33% scale. The seed sets their corners and their rotation
   (at most 15° either way).
4. **Accent** is one neutral object (whisk, spoon, cloth, fork or crumbs), chosen by the seed. It is never food, so a
   plate never shows an ingredient the recipe does not use. (Round 1 drew blueberries in the pancakes. They are gone.)
5. **Ground** comes from the hero's family:
    - dairy, egg, citrus and corn: butter.
    - poultry, meat and roots (potato, onion, carrot, garlic): terracotta.
    - tomato: tomato.
    - grain, herbs, greens, oil and mushrooms: olive. Grain sits here, not on butter, so a bread and a breakfast do
      not share one yellow.
    - chili, spice, chocolate and noodles: chili.
    - rice, fish and seaweed: sea.

    The generator holds this table once and derives every ground from it. No plate sets its ground by hand.

6. **Fallback.** A recipe with no match gets a ground, a cloth across one corner and one large utensil. The stored seed
   chooses all three, so a tomato soup does not get a tomato ground by design. The fallback does not use a cuisine colour. A colour for each of 100+ cuisines is a stereotype,
   and we cannot defend it. "Day one" in the proof strip shows four fallbacks side by side. They read as a set of kitchen prints, not
   as grey placeholders.
7. **Stability.** The seed is created and **stored at first save**. Later edits never change the plate, so a cook can
   still find a recipe by sight. _Proposal, not drawn:_ a "New plate" item in the ⋯ menu. This item adds an action
   to a menu that the board defines, so the owner must approve it.
8. **Photos.** A real photo always wins. It sits **on its ground**, with the ground showing as a 6 px mat inside the
   same 22 px tile and the same contact shadow. The ground comes from the same family rule. A photo and a plate are
   then the same object, a coloured board, holding different things. The pad thai tile on Home and the
   Weeknight dinners mosaic show a photo next to plates. The wall stays whole.
9. **Build quality.** Each motif is cut paper: flat shapes, no outlines, and a 1.3 px offset shadow edge so that
   layers read as paper. The risograph grain is a multiply grain in light and a light speck in dark. It is never under
   text.
10. **Proof.** Every recipe plate in the mockup was placed by this rule, from a generator script, with no hand fixes.
    The ground, the accent and the caption of each plate come from the same functions. The rule panel draws the slots
    over one plate. The sidebar brand mark (a lemon on butter) is a fixed brand asset, not a plate.
11. **Accessibility.** A plate is decorative (`alt=""` / `accessible={false}`). The title already names the dish.

**Collection covers** are a 2×2 mosaic of the collection's first four plates or photos, with 3 px paper gutters. A
collection with one recipe shows its single plate. The cover slot and the layout do not change.

## Dark: the lamp

Round 1 dimmed each plate twice: a darker ground, then a brightness filter. That made the food muddy. Now there is
one mechanism, with no filter. The grounds are deep and low in chroma (`#3B2C23` terracotta). A warm radial pool
(`#FFD9A0`, 30% → 0) sits behind the food. The motifs keep almost their daytime value. Only the cream and paper
colours drop, so that they do not glow (cream becomes `#E6DBC8`). The food looks lit on a dark table. Dark mode becomes the more
atmospheric theme, not the dimmer one.

## Motion

- **The one signature (kept):** the checkbox overshoot. The box fills basil, and the strike-through draws left to
  right in 180 ms.
- **Once in a recipe's life:** at first save the plate assembles. The ground, then the hero, then the two supports,
  then the accent drop 6 px into place, 70 ms apart, in about 400 ms in all. It never replays.
- **Quiet:** tiles fade up 8 px at 240 ms on first paint. The sheet settles over the hero at 280 ms ease-out. A change of
  the first tile cross-fades the wash over 400 ms. New recipe shrinks to its icon on scroll (D4). Nothing loops
  or parallaxes.
- **Reduced motion:** everything becomes an instant cross-fade. The plate appears finished, and the checkbox shows its
  end state.

## What makes it exciting

- The library, Discover and collections become walls of small, bright prints made from the cook's own ingredients.
  Every recipe has a face from its first save, with no camera.
- Each recipe page has its own colour in its wash, its overline and its group labels. It looks like a page in a
  printed book.
- At night the food glows under a lamp.

## What keeps it calm

- One action hue, and it only means "you can press this". The key colour only means "read this".
- Colour is fenced into plates, the wash and a few labels. Cards have no borders on borders and no shadows.
- Sections sit 36–40 px apart. There is one signature motion, and the plate assembly happens once per recipe.
- The editor, where cooks spend the most time, is plate-free on purpose. Four details carry it:
    - the Fraunces section title.
    - warm paper fields with pewter edges (3.64:1).
    - a basil focus ring, 2 px out from the field.
    - a drawn check on "Saved".

## Owner rulings touched

| Ruling                                              | Status                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D13** (seafoam to basil)                          | **Amended, owner call.** The plates carry the identity, so the action hue is free to change. A "no" costs two tokens. The proof strip shows both: basil (white 6.34, link 6.35 on oat) and seafoam `#31807A` (white 4.67). Seafoam needs its own link tone, `#286C67` (5.48 on oat, 4.92 on surface-muted). |
| **#145** (canvas wash)                              | **Kept.** It is tinted from the first image's ground at 12%.                                                                                                                                                                                                                                                |
| **D11** (warm greys)                                | **Honoured**, using slate `#6B645C` and pewter `#8A847C` as specified. This removes a round 1 amendment.                                                                                                                                                                                                    |
| **Covers** (`covers.ts`, the six typographic tints) | **Replaced** by plates. This is bigger than a re-theme, so it is listed for the owner.                                                                                                                                                                                                                      |
| **D15** (roles only)                                | Kept, through the closed `plate.*` family described above.                                                                                                                                                                                                                                                  |
| **D12** (glass on navigation only)                  | Honoured, and readable with the blur on and off.                                                                                                                                                                                                                                                            |

Also honoured:

- Numbers use Inter tabular.
- Pills are only for things you press.
- A selected chip is a tint plus a check.
- Coral is off all controls.
- There is one signature motion.
- There are no Soon items in navigation.

## What changed since round 1, and why

1. **Recipe detail matches the board again.** Both critics flagged that it did not:
    - The Community rating is back right after the hero.
    - "Source: Family recipe card" has its label.
    - Edit recipe is **primary** again. The page has no FAB, so it is still the one filled button.
    - **Screen on** is restored.
    - The full description is back, with a "More".
    - The tags use middle dots, with no `#`.
    - Nutrition is an accordion with a chevron.
    - The **Servings stepper** is restored ("Fewer servings" / "More servings"), together with the pencil icon
      buttons. The Ingredients header wraps to two lines to fit 358 px.
2. **The plate became mise en place.** A literal generator cannot draw a pancake stack. Showing ingredients makes
   the rule honest, and the proof shows it applied with no hand fixes.
3. **The missing cases are now shown:** fallbacks (Home and Day one), photos next to plates (Home and the mosaic), dark
   Home, a plate-free editor, and a row of interaction states.
4. **Dark mode now uses one mechanism.** The double dimming is gone. Every motif colour is a token. The grain is
   inverted.
5. **Accessibility.** Active tabs and nav rows are no longer shown by hue alone. Glass is 0.84 / 0.80 with `ink`
   labels. The rating shows 4.8 as a real 80% star. The dark skeletons are lifted.
6. **Basil only marks what you press.** The squiggle is gone, and the difficulty pips are ink.
7. **Fraunces** uses optical size auto, a single 22 px floor and a single weight (560).
8. **New this round:** the per-recipe key, the lamp, the mosaic covers, the photo on its ground, the stored seed,
   and the first-save assembly.
9. **Desktop.** I swapped Home for Collections. Round 1's desktop Home was the least exciting frame. Collections
   shows that the plates scale.

**For round 3:**

- An audit of the motif library: how many of the top 300 catalog foods have a motif on day one.
- Plates on Discover at 390 px.
- The owner's answers on D13 and covers.

## Open risks

- **The motif library is real illustration work.** About 120 motifs cover most matched lines. Until they exist, more
  recipes get the fallback. So the fallback must look good on its own. In my judgement it now does. It is not
  yet tested with cooks.
- **Two motifs with similar values on one ground blend together.** For example, the raw chicken skin on terracotta is
  readable only because of the cut-paper edge. The library needs one contrast check per motif and ground pair: a
  value gap of at least 1.3:1, or a forced edge.
- **The glass ratios are flat-blend estimates over the worst motif, with no blur.** The real result sits between those
  numbers and the solid fallback.
- **Fraunces adds about 90 KB** (one variable latin file) on web, and two static faces on native.
