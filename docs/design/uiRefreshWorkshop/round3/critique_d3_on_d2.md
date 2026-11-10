# Critique: Designer 3 on Designer 2, "Kitchen Press" (round 3)

Reviewed: `round3/d2/concept.md` and `round3/d2/mockup.html`. This round I rendered the page in headless Chromium
(Playwright, 1× scale) as well as reading the source. The frames are: Home at 390 px light, Recipe detail at 390 px
light and dark, Recipes at 1280 px dark, and the token strip. I checked the layouts against the current boards
(`HomeMobile`, `RecipeDetailMobile`, `Recipes`). Ratios are WCAG 2.x relative luminance, which I computed from the
hexes in the file. Where I quote a number from the concept, I re-checked it. Every one I checked matched.

I have my own concept in this workshop. I judged this one against the problem, not against mine.

## Verdict

This is the most finished system in the workshop, and it does the main job. The library stops being a row of pale
tints and becomes a shelf of small, made things. On the 1280 px dark grid, the five prints and four photos sit
together as one set, and that was the hardest thing to prove. The chrome around the art is calm, warm and clearly
ruled. One colour and one shape mean "press".

Three things stand between this and a build spec:

1. A spec contradiction. The neighbour rule and the "frozen at first publish" rule cannot both hold.
2. An appetite problem. Because the hash picks the ink and never the food, the shelf shows blue bread, blue pork
   and a blue lemon. For a food app that matters more than any ratio in the tables.
3. The hero is now the busiest surface in the system, and it sits on the screen where cooks spend the most time.

Each one has a small fix. None of them needs a new idea.

The layouts are kept. Home keeps the greeting, the 2 × 2 grid of recent recipes and the three Coming soon widgets.
Detail runs from Community rating to Steps in the board's order, with Servings, Screen on, Version history and both
step timers. Recipes keeps the segments, the search row, the filter chips, "9 recipes" and "Recently edited". It
also keeps the view switch, the `auto-fill, minmax(15rem, 1fr)` grid and the card footer ("v3 · Edited 2d ago"). The steps keep the
board's "Mark step N as current" buttons.

## Strongest ideas, keep these

1. **Chromatic overlaps.** Round 2's near-black overlaps are gone. Aubergine `#853C70`, umber `#7D4F12` and petrol
   `#205185` are deep colours with real chroma, at 4.61 to 6.93:1 on the light grounds. Each one is at least
   1.96:1 from `ink`, so none of them reads as a burn. Naming them is a good touch. A cook can learn "plum".
2. **Four inks, six pairs.** The fourth ink (beet) is what makes the neighbour idea possible at all. Herb moving
   from mint to basil (hue 135°) keeps the art away from `action`. That was my round-2 complaint, and it is fixed.
3. **Dark grounds with real hue.** Olive, brick rose, bottle, ink blue and amber read as five different card stocks
   in the desktop frame. In round 2 they read as four browns. The salmon print (tomato and herb on ink blue) is the
   best single tile in the workshop.
4. **"A chip's fill is never a ground."** It is one sentence, and it removes a whole class of bugs: the Draft chip
   that vanished on gold. Every chip on art is now `sheet` with one ring. Draft as a dashed edge ("not finished") is
   a meaning the system can keep.
5. **Measuring at the worst case.** The scrim is now measured over pure white (4.98:1), not over the drawn photo.
   Glass is measured over the darkest thing that can scroll under it. That is the right habit, and it is why I
   trust the tables.
6. **Calmer steps.** No rings at rest, one `ink` disc and a 3 px `action` rule on the current step. The reading
   column is much quieter than in round 2. (There is one cost, see problem 4.)
7. **The print is frozen at first publish.** Recognition over liveliness is the right call. Swapping butter for oil
   never changes the picture.
8. **Gold left the interface.** Gold is art only now. PRO is an `ink` chip at 13.96:1 in light and 14.31:1 in dark.

## Problems, most important first

### 1. The neighbour rule and the freeze contradict each other

The concept says the print is frozen at first publish (rule 5). It also says that on a clash "the hash steps to the
next free pair" (rule 4). The aim is that two touching cards never share a pair or a ground. But what touches what depends on
the view, not on the recipe:

- On a phone the grid has 2 columns, and on desktop it has 3. At 1440 px or wider, `auto-fill, minmax(15rem, 1fr)`
  gives 4. At 1024 px it gives fewer.
- "Recently edited" re-sorts on every save. Each filter chip and each search re-flows the grid.
- Home shows four recent recipes, and Recipes shows all of them. A collection shows a different subset again.

So there are two options. If the pair is computed per view, the same recipe changes colour between Home, Recipes and
a collection, and "the picture they remember" is gone. If the pair is frozen, then neighbours will sometimes clash,
and the "never" in rule 4 is false. The desktop frame proves the rule for one sort, one filter and one column count,
which is the only case where it is easy.

**Fix:** freeze the pair and the ground with the print, and give up the guarantee. At publish, choose the pair and
the ground that are least used among the cook's last eight recipes. The default sort is recency, so the new card
lands next to exactly those recipes. That keeps the default view varied without anything changing later. Then state
the residual clash rate in other sorts plainly. With 6 pairs, two neighbours share a pair about 1 time in 6 by chance.
Also say which pair the recipe page's colour bar shows. The answer has to be "the frozen one".

### 2. The ink ignores the food, and some foods turn unappetising

Rule 3 lets the hash choose the ink pair, "never the food", to avoid a red library. That reason is good. But the
result in the frames is:

- **Sunday rosemary focaccia** (Home): a sea-blue dimpled slab on gold. That is blue bread.
- **Slow-Roasted Pork Shoulder** (desktop): a sea-blue tied joint on olive. That is blue meat.
- **Lemon and thyme roast chicken** (the hero): the lemon is a sea-blue wheel. On Home's pancakes the citrus wheel
  is tomato red. On desktop's pancakes it is herb green.
- **Lemon ricotta pancakes** (Home): tomato-red slabs that read as bacon or lasagne at 171 px wide.
- **Breakfast for guests** (collection cover, one recipe): five blue bars on gold. That reads as a flag.

Two-colour printing is not literal, that is true. But blue is the colour food art avoids on things you eat, and here
the silhouette has to carry recognition by itself at card size. Some silhouettes can do that, like the bird, the
fillet and the halved tomato. Slabs and stripes cannot.

**Fix, and keep the hash:** add one constraint. For meat, poultry, bread, grain and dairy, **plate A is never sea**. Sea stays free as plate B, for fish, for rings and dollops, and in the overlaps. That still leaves
three inks for plate A and keeps all six pairs available, so the red-library problem does not come back. Then
re-check the slab motif ("stacked slabs" for grain and flour) at 171 px. If it still reads as bacon, give pancakes
their own motif, a short stack seen from the side with one dollop. Pancakes are too common a recipe to fall back to
slabs.

### 3. The hero is the busiest surface in the system

The print hero stacks five things at once: two inks and their overlap, wobbled edges, halftone dots, grain, and
about fifteen sea "potato" pebbles that bleed off every edge. The hero path is 48 KB with about 4,000 points and 272
sub-paths, and most of those are halftone dots. At 390 px it reads as energetic. But the brief says "calm, never
busy", and this is the screen a cook keeps open while they cook. The card prints (8 to 23 KB, 13 to 50 sub-paths)
are about the right density. The hero is not.

**Fix:** cut it to two textures, not three. Keep the halftone only where it crosses plate A (the juices under the
bird). Halve plate B's pebble count, and keep the pebbles inside a calm margin of about 24 px. Keep the grain, because it
is what makes photos and prints one set. The hero needs to feel like one good print, not a sample sheet of every
technique.

### 4. Bare step numerals break "shape means press"

At rest, each step numeral is a `<button>` ("Mark step 2 as current") drawn as plain `ink-muted` text with no
shape. The system's core rule is "only things you can press are pills or circles". This numeral is pressable and has
no shape, so the cook cannot see it is a control. I asked for the rings to go in round 2, so I own this tension.

**A fix that stays calm:** give the resting numeral a `well` disc with no ring (`ink-muted` on `well` is 4.78:1). That
is a quiet shape that says "press" without five pewter circles. Or make the whole step row the target, since
tapping the step you are on is the natural gesture, and say that in the rule. Either way, write down the honest
exceptions to the shape rule: text links, tabs, sidebar rows, checkboxes and step numerals. A rule with known
exceptions is still a rule. A rule with hidden exceptions will be "fixed" by someone later.

### 5. In dark, the overlap glows

Dark overlaps are lighter than both parents by design. Aubergine `#E29AC4` is 1.71:1 above tomato and 1.64:1 above
sea. On the hero, that turns the chicken's knees bubblegum pink where they cross the potatoes. It reads as a
highlight, not as two inks crossing, and pink is a poor colour for cooked chicken. The concept says "nothing glows",
and this is the one place something does.

**Fix:** keep "lighter than both parents", because a darker overlap vanishes into the dark grounds. But take
about 25% of the chroma out of aubergine and garnet in dark, so they read as a mixed tone, not a candy one. Re-check
the ≥ 1.5:1 parent rule after the change. There is room, since both are about 1.6 to 1.7 now.

### 6. One claim was measured against the wrong neighbour

The concept says dark grounds sit at 1.32 to 1.86:1 against dark `paper`, "so a tile's edge no longer disappears".
That is true on Home. On desktop, though, the cover sits inside a `sheet` card. Bottle `#06372A` is 1.19:1 against
`sheet` `#1D2423`, and ink blue `#1A314E` is 1.20:1. The edge holds in the render because of hue, not luminance.
This is decorative art, so it is **not** a WCAG failure. But it is the same kind of error the scrim fix corrected, so
state the `sheet` figures too. The same applies to chips on dark art: the chip is 1.19 to 1.38:1 against the ground,
and only its 16% ring outlines it. The text inside is 12.96:1, so this is not a 1.4.11 issue. Just make sure the ring
survives on native.

### 7. Native cost, and a cheaper way to ship the art

A library of 50 recipes is about 0.5 to 1 MB of path data and roughly 50,000 points in a scrolling list. I have not
measured `react-native-svg` on a low-end Android phone, and neither has the concept (its residual-risks list says
so). Treat this as a check that must run before the build spec is locked, not as a known failure. Two smaller native
checks belong in the same pass. First, the Draft chip's dashed outline with a radius has a history of drawing badly
on Android, so check it. Second, the inactive tab's 4.59:1 depends on a 94% glass that Android cannot blur the same
way.

### 8. Thin passes need pinned tests

`edge` on `well` (3.04 light, 3.10 dark) already gets a pinned token test. Treat these the same way:

- moss against `ink` at 1.96, against a 1.95 floor
- the off-state switch thumb (`edge` on `well`, 3.04). It is the only thing that shows the switch's state.
- the inactive tab on glass (4.59 light, 4.67 dark), against 4.5

### 9. The colour bar is weak on print recipes

On a recipe with a print hero, the bar beside "BRITISH" repeats the hero 300 px below it, so it is noise. In the
desktop card footer, three 10 × 6 px swatches look like a status indicator, not like a print. The idea is good, but
only where the print is hidden. **Fix:** show the bar only on photo recipes, and see bold suggestion 1.

### 10. Small things

- **The sidebar's active "Recipes" glyph** (`filled-soft`) fills the book's first path, so it renders as a solid
  pale square, not a book. Use a real filled book glyph.
- **The FAB sits over Today** in the week widget at the shown scroll position. The only `action` mark in the
  widget collides with the `action` FAB. This is probably just the scroll position. Still, check that the last widget
  clears the FAB at the bottom of the scroll (the padding is 128 px).
- **Display type is heavy for "calm".** Bricolage at wdth 84, 700, −0.024 em makes "Lemon and thyme roast chicken"
  a dense black block in light, and a bright one in dark. It is distinctive, and I keep the family. Before you lock
  it, try 650 and −0.018 em on the phone title.
- **Light grounds: gold `#F7CC6E` is the loudest tile** in the Home 2 × 2. Next to mist and cream it pulls the eye
  first, every time. Take about 10% of the chroma out of it.

## Accessibility summary (re-checked)

| Pair                                                 | Ratio       | Needs | Status                                         |
| ---------------------------------------------------- | ----------- | ----- | ---------------------------------------------- |
| White on `action` `#2A6B65` (light buttons, FAB)     | 6.20        | 4.5   | pass                                           |
| `#0F1A17` on `action` `#7CC8BE` (dark)               | 9.20        | 4.5   | pass                                           |
| `ink-muted` on wash bottom (light)                   | 5.07        | 4.5   | pass                                           |
| `ink-muted` on `well` (Soon, light)                  | 4.78        | 4.5   | pass                                           |
| `edge` on `well` (control edges, switch thumb)       | 3.04 / 3.10 | 3.0   | thin pass, pinned                              |
| Today ring (`action` on `well`)                      | 5.09 / 7.19 | 3.0   | pass                                           |
| Status bar on print hero, dark worst (amber)         | 7.68        | 4.5   | pass                                           |
| Status bar on print hero, dark olive                 | 9.38        | 4.5   | pass                                           |
| `honey` stars on dark `sheet`                        | 7.93        | 3.0   | pass                                           |
| Sea ink on cream (art)                               | 4.04        | none  | decorative                                     |
| Dark grounds against dark `sheet` (bottle, ink blue) | 1.19 / 1.20 | none  | decorative, but the claim is wrong (problem 6) |

Every text and control pair I checked passes AA. The only open accessibility item is problem 4, a control with no
visible affordance. That is a 2.4.7 and 1.4.11 question, not a contrast one, because the focus ring exists.

## Motion

One stamp, on one screen, after the cook acts, with reduced motion as an instant change. That is the right size,
and cutting the add-to-collection stamp that played under a sheet was honest. The check overshoot
(0.85 → 1.06 → 1, 220 ms) is fine. Specify one more thing. Tie the stamp to the publish event, not to page entry. Then a later
visit to the recipe page never replays it.

## Missing frames, and whether they block

- **Light desktop.** Not drawn. Light is the default theme, and the mixed grid of photos and prints has only been
  seen in dark. **This blocks.** Light is where the gold and blush grounds sit next to real photos.
- **Collections at its real layout.** Only covers in the token strip. The cover idea is proven, so this does not
  block. But draw "Weeknight dinners" with three plates at desktop width once, because at 1280 px three crossing
  plates is the busiest art in the system.
- **Discover.** Not drawn. It is mostly photos, so the print system barely touches it. This does not block.
- **A print hero at desktop width.** Not drawn. It needs a crop rule (does the 4:3 art crop, or tile?). **This
  blocks** the web build of the detail page.

## Still open for the owner

Two amendments still need a ruling, and the concept says so honestly. **D13:** `action` `#2A6B65` instead of seafoam
(white is 6.20:1 against 4.67:1). **The palette:** coral, sky and warning become print inks in a closed `press.*`
family, and herb and beet are new. I support both. The `press.*` fence plus the role guard is the right way to add
colour without letting it leak into controls.

## Bold suggestions

1. **Show the hidden print as the last slide of a photo recipe's carousel.** The colour bar is too small to carry
   identity alone. The print already exists, and the carousel and its dots already exist. One more slide makes the
   cook's print visible on every recipe, and it costs no layout change. Then the colour bar only has to say "there
   is a print", not be one.
2. **Render the prints to images at publish, not to SVG on the device.** The geometry step already runs on the
   server (the concept uses Shapely). Let it also write two WebP sizes (card and hero) per theme, with the grain
   baked in, and cache them like photos. That removes the native path-count risk, removes the separate grain layer,
   and makes print and photo cards the same component. It suits the frozen print well: a print that never changes
   is exactly the kind of thing to render once.
