# Round 2 critique by Designer 3: options 1 and 2

Heuristic judgement, untested with users.

## Render

I rendered both files with Playwright (Chromium). The sizes were 1400 px, 390 px in light and dark, and 320 px with a
real `html{font-size:200%}`. I also made a contact sheet of the four Home and recipe frames at 110 px wide. Neither page
scrolls sideways or logs a script error. Colour figures come from culori (CIEDE2000, WCAG 2) and APCA 0.0.98G, run on
the files' own hex values. Sizes marked "measured" come from `getBoundingClientRect`. The others are read from the
render.

## The set

The siblings are `round1/option1.html` (Carton), `round1/option2.html` (Deli Counter) and `round1/option3.html` (Food
Edge, mine), plus the round-0 files and the three earlier workshops.

**Ruling: distinct, but two axes are converging.** The look differs. Option 1 is one blue panel that frames a photo on
white. Option 2 is bled photo slices with cards on pale green. But both set the dish name in a **heavy condensed
grotesk** (Bricolage at 78% width, Archivo at 75%). Both use a **red action**: ΔE00 19.8 in light, only 15.7 in dark. And
both build Home the same way: "Tonight", one featured dish, a full-width red button, then the others. Two of three blind
designers reached the same type and the same button. That is the shared prior that canon §6.1 warns about.

## Option 1: Carton

### What must survive

The name sits on colour, never on the photo, which answers canon §3.4 rule 4. Home shows three
dinners with three stored reasons on one 390 px screen. Cook mode is strong: 28 px text, a fixed timer strip, and
labelled 72 px Next and Previous.

### What fails, most important first

1. **The drawn food loses the 50 ms test.** The SVG dishes read as clip art, and appeal is judged on the food (§5A). The
   brief allows drawn imagery, and my own Option 3 has the same gap. Fix: test the window with real home photos.
2. **In dark, the band is the brightest thing.** It flips to `#EEF2F5` (16.7:1 on the ground), a full-width bar brighter
   than the food. Rule: §5A, food first. Material keeps large dark-theme areas dark
   ([Google Design](https://design.google/library/material-design-dark-theme)). Fix: a deep band, `#0A1622`, with light
   text.
3. **The primary's label is wrong.** "Cook this tonight" opens the recipe page, which has its own "Start cooking". Rule:
   information scent (§1.2). Fix: "See the recipe", or open cook mode.
4. **Two headlines compete.** "Tonight" at 34/700 sits just above the carton name at 32/800 condensed. Rule: von
   Restorff (§1.1). Fix: on Home, use the standard inline nav-bar title. The carton name is then the one loud
   line.
5. **At 200% text, My recipes shows no recipe.** The switch, the three-line search, the chips and the count fill the
   screen. The scrolled title shrinks to "L…". Rule: §4.1 and §1.4. Fix: put the switch and chips behind one Filter
   button at large text.

**Original?** Partly. On the contact sheet the keyline vanishes, and the carton reads as a blue card. **Simple?** Yes.
**Palette?** Right in light. Dark needs fix 2.

### The direction (one push)

Make it read as a pack, not a card. The carton goes edge to edge, with no side margins,
as the one object on the shelf. **Carton** palette, idea unchanged: a sky pack opposite warm food. Action `#C41E3A`
light, `#FFA294` dark.

## Option 2: Deli Counter

### What must survive

Real food at full width, stacked vertically. Three reasons from stored fields. The honest "kept
on this phone" copy. The pistachio-glass ground, which passes the swatch test.

### What fails, most important first

1. **The signature reads as money.** "6:35" is 36 px, where a deli card prints the price, with "pm" raised like cents.
   A stranger can read £6.35. A white card on a food photo with a big number at the right is also a delivery-app dish
   card. Rule: information scent (§1.2) and the closest-app test (§2.3). Fix: no superscript, add a clock glyph.
2. **In dark, the primary looks secondary.** `#FBD7D7` has chroma 0.040. Material 3 uses such a pale fill for its
   lower-emphasis tonal button
   ([Compose](https://developer.android.com/reference/kotlin/androidx/compose/material3/FilledTonalButton.composable)).
   So dark "Next step" reads as the secondary. Rule: von Restorff and signifiers. Fix: below.
3. **The placeholder is the loudest colour.** The no-photo Pistachio field (C 0.141) outshines every photo. Rule: §5A.
   Fix: Shell `#D9E5CE`, with the rail only.
4. **At 200% text the food goes.** Measured at 320 px: the slice is 76 px tall, and the step column is 154 px at 34 px
   type, about 9 characters a line. Rule: §4.1, 45 to 75. Fix: put the step number above the text.
5. **It reads as a night out, and dated.** The photos are soft restaurant plates with edible flowers. A card that
   overlaps a photo's edge with a coloured top border reads as 2016 to 2018. Rule: §0 and §5A.

**Original?** No. The composition is the category median. **Simple?** Yes. **Palette?** The ground is right. The dark
action is not.

### The direction (one push)

Let the food win. The card covers at most 30% of the slice, and sits below it at large
text. The ground carries the freshness. **Prosciutto & Pistachio, cured both ways.** Idea: the red of the ham, not its
fat, so the button is the same thing day and night. Light `#620914` stays. Dark fill `#B8364A` with white label (5.73:1,
Lc 88, and 3.34:1 on the ground), ΔE00 30.0 from Carton's dark. `#FBD7D7` stays for dark links and ticks only. Small light
marks already carry shape (tick, tab bar), so 1.33:1 to Ink is no 1.4.1 failure.

## Not run

- Distance tests at 60 and 90 cm (no device).
- Increase Contrast variants.
- An app-by-app check of delivery-app cards. My search for current Uber Eats item cards returned no layout
  ([Baymard](https://baymard.com/ecommerce-design-examples/food-menu/18374-uber-eats)), so that comparison is
  judgement.
- A free light accent for Option 2. Every red I tested (OKLCH L 0.46 to 0.49) is within 15 of Carton's Tomato, or of
  probe Beetroot `#8C1D4F`.
- Copy at its longest localised length.
