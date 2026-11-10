# Kitchen Press: Designer 2, round 3

The mockup is [`mockup.html`](mockup.html). It contains:

- Home at 390 px, light. It shows three prints and one photo.
- Recipe detail at 390 px, light. The recipe has no photo, so the hero is its print. This is the most common case,
  and round 2 did not draw it.
- The same recipe detail at 390 px, dark.
- Recipes (My recipes) at 1280 px, dark. It shows five prints and four photos in one grid.
- The token strip. It holds:
    - every interface role in both themes
    - both press tables (five grounds, four inks and six overlaps)
    - the collection overprints in both themes
    - the type scale and a rendered 30-character name
    - every shape that means "press", and every shape that does not
    - a recipe with a photo, showing its colour bar and the scrim

One script generates the page from one palette table. It checks every rule below as a hard assert before it writes a
file. Every hex and ratio in this document comes from that table. The art is real geometry: plate A, plate B and
their intersection are three flat paths, cut by hand and computed ahead of time. The page has no masks, no blend
modes and no filters on the art. The grain is a real 128 px PNG for each theme, inlined. The mockup now draws exactly
what native ships.

## The idea

Most recipes in Commise have no photo. Today that gives a library of pale tints, each with one letter. In Kitchen
Press **every recipe owns a small two-ink print of its two heaviest foods**. The prints use four inks on five
paper grounds. The second plate sits 2.5 px out of register, and where two inks cross, a **third colour** appears.
That third colour is a real colour with a name: aubergine, umber, garnet, petrol, indigo or moss. A library looks
like a shelf of prints the cook made. A collection looks like its recipes printed over each other. A recipe with a
photo keeps its print too. The print stays behind the photo, and it shows as a **printer's colour bar** beside the
overline.

Everything around the prints stays quiet. The paper is warm. One green means "you can press this", and only things
you can press are pills. Content has no shadows. Two type families each have one job. The screens, flows and
layouts do not change. Only the material does.

## Palette

### Interface roles (unchanged from round 2 except where noted)

| Role                           | Light                           | Dark                            | Job                                                                                                     |
| ------------------------------ | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `paper`                        | `#F5F0E6`                       | `#151B1A`                       | canvas, under the wash                                                                                  |
| wash (issue #145, kept)        | `#F8F1E2` → `paper` → `#EEF0E8` | `#1A201E` → `paper` → `#121816` | window light: warm at the top, a trace of sage at the foot                                              |
| `sheet`                        | `#FFFCF6`                       | `#1D2423`                       | cards, the ticket, the current step, **every chip that sits on art**, the sidebar, the selected segment |
| `well`                         | `#EFE8DB`                       | `#262E2D`                       | timer, switch track, the "for 4" chip, the Soon tag                                                     |
| `ink`                          | `#1C2422`                       | `#EFE8DA`                       | text, the active tab glyph, the **PRO chip fill**                                                       |
| `ink-muted` (D11 slate, exact) | `#6B645C`                       | `#A8A193`                       | secondary text, inactive tabs, **step numerals at rest**                                                |
| `edge` (D11 pewter, exact)     | `#8A847C`                       | `#6E7A72`                       | every control edge, ticket dashes, **the Draft chip's dashed edge**                                     |
| `line`                         | `#E3DACB`                       | `#2E3736`                       | decorative hairlines only                                                                               |
| `action`                       | `#2A6B65`                       | `#7CC8BE`                       | the one colour that means "press". The label is white in light and `#0F1A17` in dark                    |
| `action-tint`                  | `#DDEBE6`                       | `#1F3330`                       | selected filter chip (always with a check and a 1.5 px ring), Public badge, avatar                      |
| `danger`                       | `#B1442B`                       | `#FF8C6E`                       | destructive text                                                                                        |
| `honey`                        | `#A86A12`                       | `#E2B04A`                       | stars and difficulty bars. Graphics only, never text                                                    |

**Gold has left the interface.** In round 2, gold had four jobs. It was a print ground, the Draft badge, the "for 4"
tag and the PRO text. A Draft recipe on a gold print made its chip vanish (1.00:1 as a shape). Now:

- Draft is a `sheet` chip with a 1.5 px dashed `edge`. In this language a dashed edge means "not finished".
- "for 4" is a `well` chip.
- PRO is an `ink` chip with `paper` text.
- **New rule: a chip's fill is never a ground token.** Every chip on art is `sheet` with one ring (14% `ink` in
  light, 16% `ink` in dark). That is one family, as d1 asked.

### Key interface pairs (text needs 4.5:1, and controls and graphics need 3:1)

| Pair                                                                                       | Light                  | Dark                   |
| ------------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| `ink` on `paper` / `sheet`                                                                 | 13.96 / 15.48          | 14.31 / 12.96          |
| `ink` on wash top / bottom                                                                 | 14.09 / 13.79          | 13.57 / 14.75          |
| `ink-muted` on `paper` / `sheet` / `well`                                                  | 5.13 / 5.69 / 4.78     | 6.80 / 6.16 / 5.42     |
| `ink-muted` on wash top / bottom                                                           | 5.18 / 5.07            | 6.45 / 7.01            |
| `edge` on `paper` / `sheet` / `well` (control edges)                                       | 3.26 / 3.62 / **3.04** | 3.90 / 3.53 / **3.10** |
| label on `action` (buttons, the FAB, a checked box)                                        | 6.20                   | 9.20                   |
| `action` text or ring on `paper` / `sheet` / `well`                                        | 5.45 / 6.05 / 5.09     | 9.03 / 8.17 / 7.19     |
| `action` ring on `action-tint` (selected filter chip)                                      | 5.05                   | 6.90                   |
| `ink` on `action-tint` / `well`                                                            | 12.91 / 13.01          | 10.94 / 11.40          |
| PRO: `paper` on `ink`                                                                      | 13.96                  | 14.31                  |
| Chips on art: `ink` on `sheet`                                                             | 15.48                  | 12.96                  |
| `danger` on `paper` / `sheet`                                                              | 4.96 / 5.50            | 7.67 / 6.94            |
| `honey` stars and bars on `paper` / `sheet`                                                | 3.90 / 4.33            | 8.76 / 7.93            |
| Inactive tab, worst case: `ink-muted` on glass (light 94% over `ink`, dark 90% over `ink`) | 4.59                   | 4.67                   |
| Status bar on a **print** hero: `ink` on the worst ground                                  | 10.43 (gold)           | 7.68 (gold)            |
| Status bar on a **photo** hero: white on 65% `ink` over a pure-white plate                 | 4.98                   | 4.98                   |

Rules:

- **`edge` on `well` is the thinnest pass in the system** (3.04 and 3.10). It gets a token test that pins the pair.
  Then a later nudge to `well` fails the build and never ships.
- **Glass is measured at its worst case**: the darkest thing that can scroll under it. In light that is still `ink`
  text, because the new overlaps are lighter than round 2's. Over the darkest art (petrol `#205185`) the inactive tab
  is 4.67.
- **Text never sits on art.** The time, Private, Draft and PRO sit on solid `sheet` or `ink` chips.
- **The photo scrim is measured over white, not over the drawn photo.** It is 65% `ink`, flat over the top 64 px,
  and then fades to 0 by 128 px. White status text is 4.98:1 at the height of the text, even over a white plate.
  Round 2 measured its scrim on the drawn roast, which hid a 2.8:1 case.
- **The print hero keeps a clear sky band.** Plates stay out of the top 56 px, under the status bar. In light `ink`
  sits on the ground at no less than 10.43:1, and in dark at no less than 7.68:1.

### Press inks, grounds and overlaps

There are **four inks**: tomato, sea, herb and beet. There are **five grounds**: cream, blush, sage, mist and gold.
There are **six overlaps**, one for each pair of inks. Prints are not literal colour, as in real two-colour printing.
These are all graphics, and they are `aria-hidden`.

**Light**

|                                   | cream `#FCEBC7` | blush `#FBD3CE` | sage `#CDEFCE` | mist `#CCE3F8` | gold `#F7CC6E` |
| --------------------------------- | --------------- | --------------- | -------------- | -------------- | -------------- |
| tomato `#E4543A`                  | 3.17            | 2.72            | 2.99           | 2.83           | 2.46           |
| sea `#4A74B0`                     | 4.04            | 3.47            | 3.81           | 3.60           | 3.13           |
| herb `#57873A` (was leaf)         | 3.62            | 3.10            | 3.41           | 3.23           | 2.80           |
| beet `#AF5B8D` (new)              | 3.79            | 3.25            | 3.58           | 3.38           | 2.94           |
| aubergine, tomato × sea `#853C70` | 6.20            | 5.32            | 5.85           | 5.53           | 4.80           |
| umber, tomato × herb `#7D4F12`    | 5.95            | 5.11            | 5.61           | 5.31           | 4.61           |
| garnet, tomato × beet `#7F3A3E`   | 6.93            | 5.94            | 6.53           | 6.17           | 5.36           |
| petrol, sea × herb `#205185`      | 6.93            | 5.94            | 6.53           | 6.17           | 5.36           |
| indigo, sea × beet `#614C87`      | 6.17            | 5.29            | 5.82           | 5.50           | 4.78           |
| moss, herb × beet `#4A5507`       | 6.88            | 5.90            | 6.49           | 6.13           | 5.33           |

**Dark** (five card stocks under a lamp)

|                     | olive `#3A3C14` | brick rose `#4D2525` | bottle `#06372A` | ink blue `#1A314E` | amber `#623F18` |
| ------------------- | --------------- | -------------------- | ---------------- | ------------------ | --------------- |
| tomato `#D0654D`    | 3.08            | 3.52                 | 3.56             | 3.55               | 2.52            |
| sea `#6389C1`       | 3.20            | 3.66                 | 3.70             | 3.69               | 2.62            |
| herb `#67934D`      | 3.19            | 3.65                 | 3.69             | 3.68               | 2.61            |
| beet `#B86D98`      | 3.09            | 3.53                 | 3.58             | 3.56               | 2.53            |
| aubergine `#E29AC4` | 5.26            | 6.01                 | 6.08             | 6.06               | 4.30            |
| umber `#DBA76F`     | 5.32            | 6.08                 | 6.15             | 6.13               | 4.35            |
| garnet `#DF918E`    | 4.67            | 5.34                 | 5.40             | 5.38               | 3.82            |
| petrol `#81ACE5`    | 4.88            | 5.58                 | 5.65             | 5.63               | 4.00            |
| indigo `#B9A2E3`    | 5.09            | 5.81                 | 5.88             | 5.86               | 4.16            |
| moss `#A1AF68`      | 4.82            | 5.51                 | 5.57             | 5.55               | 3.94            |

The ground names stay the same in both themes, so code says `ground.cream` everywhere. The dark column header gives
what each one looks like at night.

**The bands.** The script asserts each rule below.

- **Inks** sit at 2.46 to 4.04:1 on every light ground, and at 2.52 to 3.70:1 on every dark ground. Gold is the low
  end in both themes on purpose, because it is the loudest ground by hue.
- **Overlaps** sit at 4.61 to 6.93:1 in light and at 3.82 to 6.15:1 in dark. Round 2's light overlaps were 7.4 to
  11.6:1 and almost black. That critique was right, and the table now includes the overlap range.
- **Every overlap is clearly its own colour.** It is at least 0.11 ΔE (OKLab) from each parent, and at least 1.5:1
  in luminance from each parent. In light it is at least 1.95:1 against `ink`, so it never reads as a black blot.
  Light overlaps are darker than both parents, and dark overlaps are lighter than both. Each overlap keeps real
  chroma, as both critics asked: a plum, an umber, a petrol blue.
- **Grounds are told apart by hue.** Light grounds are at least 0.059 ΔE apart. Sage moved toward herb, and mist moved
  toward sea, so sage and mist are now 0.073 apart (round 2: 0.031). Dark grounds have chroma 0.055 to 0.072, and every
  pair is at least 0.07 apart (round 2: 0.04). Against dark `paper` they sit at 1.32 to 1.86:1 (round 2's mist was
  1.21), so a tile's edge no longer disappears.
- **"One green means press" is held in the art too.** Herb ink moved from mint (hue 163°) to a basil green (hue
  135°). Every ink is at least 0.126 ΔE from `action` in light and 0.186 in dark (round 2's leaf: 0.106). The two
  green-ish overlaps, petrol and moss, are 0.11 from `action` in both themes. They are small areas inside a boxed
  cover, so I accept that. I state it rather than hide it.
- **The six overlaps are at least 0.073 ΔE apart from each other**, so a cook can learn them.

### Owner rulings, one by one

| Ruling                                   | Round 3                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only pressable controls are pills        | **Complied.** Buttons, the FAB, the filter chips, the segmented controls, stepper buttons and the current-step disc are pills or circles. Badges, the time chip, the timer, "for 4" and Soon are 6 to 8 px rectangles.                                                                                                           |
| A selected chip uses a tint with a check | **Complied.** The selected filter chip is `action-tint` with a check, bold text and a 1.5 px `action` ring. The tint never carries the state alone.                                                                                                                                                                              |
| Numbers use Inter with tabular digits    | **Complied**, including step numerals and card meta.                                                                                                                                                                                                                                                                             |
| The canvas wash stays (#145)             | **Complied.** It is measured on both stops.                                                                                                                                                                                                                                                                                      |
| D11 slate and pewter                     | **Complied, exact values.**                                                                                                                                                                                                                                                                                                      |
| Coral leaves every control               | **Complied.** Tomato is only in prints and in the brand mark.                                                                                                                                                                                                                                                                    |
| One signature motion                     | **Complied** for the core. One narrow amendment is below. Round 2 asked for two, and this round asks for one.                                                                                                                                                                                                                    |
| D12 glass on navigation only             | **Complied, and the list is now honest.** Glass is used on the tab bar and the photo's back and ⋯ discs. Round 2 also put it on the carousel indicator, which D12 does not name. The indicator is now solid `sheet`.                                                                                                             |
| D13 seafoam New recipe button            | **Proposed amendment (unchanged from round 2).** `action` is today's `ocean-dark` `#2A6B65`. White on it is 6.20:1, against 4.67:1 on seafoam, and it is one token instead of a fill plus a darker text green. If the owner says no, the cost is two tokens: seafoam `#31807A` for fills, and `#2A6B65` kept for text and rings. |
| Palette "mostly" kept                    | **Proposed amendment.** Coral, sky and warning become the print inks. Herb and beet are new. These are art tokens, kept in a closed `press.*` family that only the print renderer reads. The role guard gets that one rule.                                                                                                      |
| D8 Home cards                            | **Unchanged.** A 2 × 2 grid on phones.                                                                                                                                                                                                                                                                                           |

## Type: two families

- **Display: Bricolage Grotesque, held narrow** (wdth 84 to 90, weight 650 to 700). It sets the greeting, recipe
  titles, page titles, section headings and **now card titles too**, at 16 px on phones and 19 px on desktop
  (d3's suggestion). Inter at 15/600 was the most default-looking thing on Home. Now the shelf speaks in the same
  voice as its headings. At wdth 84 it reads as hand-set wood type, not as a 2024 landing page.
- **Everything else: Inter** with `cv11`. That covers body text, labels, overlines and every number.
- **Native:** ship three static instances of Bricolage (84/700 display, 90/650 section, 90/650 card at opsz 18),
  so React Native never falls back to the default width.

| Role                 | Spec                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large title (web)    | Bricolage 56/1.0, wdth 84, 700, −0.026 em                                                                                                                                                 |
| Greeting (phone)     | Bricolage 36/1.02, wdth 84, 700, balanced wrap. **Above 18 characters of name it steps to 30 px.** The mockup renders a 30-character name, "Anastasia Alexandrovna Petrova", in two lines |
| Recipe title (phone) | Bricolage 32/1.05, wdth 86, 700                                                                                                                                                           |
| Section              | Bricolage 21 (phone) / 24 (web), wdth 90, 650                                                                                                                                             |
| Card title           | Bricolage 16/1.25 (compact), 19/1.2 (desktop), wdth 88 to 90, 650                                                                                                                         |
| Body, step           | Inter 17/1.6 and 17/1.55                                                                                                                                                                  |
| Ingredient line      | Inter 16. The amount is 600 tabular, the food is 400, and the preparation is muted (D21)                                                                                                  |
| Step numeral         | Inter 600 17, tabular. At rest it is `ink-muted`. The current one is `paper` on an `ink` disc                                                                                             |
| Overline, group name | Inter 12/600, caps, +0.08 em                                                                                                                                                              |

## Surfaces, shape and elevation

- **Flat paper. Content has no shadows.** Cards are `sheet` on the washed `paper` with a 1 px `line` inset. Only
  floating things get a shadow and glass: the FAB, the tab bar and the hero discs.
- **The ticket.** Total, Prep and Difficulty sit on `sheet`, split by pewter dashed rules (3:1 graphics). It wraps at
  320 px.
- **Radius:** covers 14, cards and widgets 20, ticket and accordions 16, inputs 12, chips 6. Every control is a pill.
- **Active states, one grammar.** The tab, the sidebar row, the selected segment and the selected filter chip all use
  `action` as a mark (a 3 px bar or a 1.5 px ring), bold `ink` text, and a filled glyph or a check. The selected
  segment now sits on its own `sheet` fill. Round 2 used a tint that was 1.01:1 against its track, so a 1 px ring
  carried the state on its own.
- **The steps are calmer.** A numeral at rest is a plain `ink-muted` number inside its 44 px target, with no ring. The
  current step keeps its `ink` disc, its `sheet` ground and its 3 px `action` rule. A focused numeral shows the
  2 px `action` focus ring. The reading column lost five 44 px pewter circles, as d3 asked. The ingredient boxes keep
  their rings, because they are checkboxes.
- **Today** in the week widget is a `sheet` cell with a 1.5 px `action` ring (5.09:1 against `well`).

## Imagery: the print

1. **What is drawn.** Plate A is the heaviest food in the recipe. Plate B is the second heaviest. Staples are skipped:
   water, salt, pepper, oil, sugar, baking powder and yeast. Flour counts, because it is what a bread or a pancake is.
   One **title accent** can join plate B: a food that the title names and that is not already drawn. Examples are the
   lemon in "Lemon and thyme roast chicken" and the basil in "Roasted Tomato Basil Soup". It is drawn small. That is
   the whole rule, and every print in the mockup follows it. Eliza's "Roast tomato soup" names no basil, so it gets
   none.
2. **The motif comes from the food's category.**

    | Category        | Motif                                      |
    | --------------- | ------------------------------------------ |
    | grain and flour | stacked slabs, or a dimpled slab for bread |
    | dairy (soft)    | dollops                                    |
    | poultry, whole  | a roast bird                               |
    | poultry, pieces | thighs                                     |
    | meat, roast     | a tied joint                               |
    | fish            | a scored fillet                            |
    | citrus          | a wheel                                    |
    | fruiting veg    | a halved fruit with its seeds              |
    | allium          | rings                                      |
    | leafy greens    | broad leaves                               |
    | herbs           | a sprig or leaves                          |
    | tuber           | pebbles                                    |
    | noodles         | loops                                      |

    **Fallbacks:** first a cuisine print. Then, for soups and stews with no food match, a **bowl**. The bowl is a
    vessel, not a food, and it is named here so the rule and the art agree. The last fallback is a disc-and-rule print
    keyed only to the hash.

3. **The hash chooses the ink pair, never the food.** So a cook who cooks a lot of chicken does not get a red
   library. Four inks give six pairs. The hash also picks the ground, the rotation (±16°), the scale, the crop and
   the paint order.
4. **The neighbour rule now covers the ink pair as well as the ground.** Two cards that touch never share a pair or a
   ground, and that includes the diagonal. In a 2 × 2 grid all four cards touch, so it needs four different pairs.
   Three inks cannot do that, and four can. On a clash, the hash steps to the next free pair. A photo card
   counts too, because its hidden print shows as a colour bar. The desktop frame shows the rule's result. The script
   checks all nine cards: no two touching cards share a pair, and no two touching prints share a ground.
5. **The print is frozen at first publish.** Only a change of the heaviest food re-cuts it. Swapping butter for
   oil changes nothing, so the cook can still find a recipe by the picture they remember. It never animates while the
   cook types. _This reverses round 2_, where the print changed on every edit. d3 was right that recognition matters
   more.
6. **Hand-cut edges.** Every plate outline is moved along its normal by a seeded wobble of about 1.2 rendered px.
   This is computed into the path, so native still draws flat fills. The edges read as a linocut, not as clip art.
7. **A second level of detail at large sizes.** On the hero and on collection covers, plate B carries a coarse
   halftone shade (dots about 10 px apart): the pan juices under the bird. The dots are real geometry, so where they
   cross plate A they take the overlap colour. At card size the dots are dropped.
8. **Registration is set in rendered pixels.** Plate B is offset by 2.5 px across and 1.25 px down at every size.
9. **Grain is one PNG tile per theme.** Light is sparse dark tooth at 26%. Dark is **bipolar** tooth at 20%: as many
   specks darker than the ground as lighter. The average stays on the ground, so on an OLED screen it reads as paper,
   not as dust. That answers d3's worry about pale specks on near-black. Photos get the same tile at 60% strength, so
   photos and prints read as one set. The desktop frame shows this: four photos in a grid of prints, at night.
10. **The printer's colour bar** (d1's bold suggestion, adopted). It is three 10 × 6 px swatches, for plate A, plate
    B and the overlap. It sits beside the overline on the recipe page and in the footer of the desktop card. **A
    recipe with a photo still owns a print.** It is hidden behind the photo, and its colour bar shows. So the
    identity survives on the screen where cooks spend the most time.
11. **Collections are overprints.** The cover is the A plates of the first three recipes, each in its own ink, with
    every pairwise overlap. **A photo recipe gives its hidden print**, so every collection has a cover. **Where three
    plates cross, the paint order decides:** plates in recipe order, then the overlaps in the order A×B, A×C, B×C.
    The last pair painted wins. There is never a three-ink token. **I softened the claim:** one plate means one
    recipe, and three plates mean three or more. A cover does not tell 3 from 14.
12. **Decorative only.** Prints and colour bars are `aria-hidden`. The title names the card.

## Motion

- **The signature motion stays:** the check toggle overshoots (scale 0.85 → 1.06 → 1, 220 ms,
  `cubic-bezier(.34,1.56,.64,1)`). The box fills with `action`, and the strike draws in `ink-muted`.
- **Proposed amendment, now smaller: one stamp, on one screen.** After a publish, the editor lands on the recipe
  page. There, the hero print stamps once: plate B starts 6 px out and lands at its 2.5 px rest offset on the
  same curve. On a photo recipe the colour bar stamps instead, beside the overline. It means the same as the check:
  "you did that, and it took". **I cut the add-to-collection stamp.** It played on a cover hidden under the picker
  sheet, so nobody saw it. If the owner says no, only the check moves, and nothing else depends on the stamp.
- The title condense is the platform cross-fade. Nothing moves on first view, on scroll or on refresh.
- **Reduced motion:** every change becomes an instant state change. The grain never moves.

## What makes it exciting

- The library is art, and the art is the cook's own food. Every new recipe adds a print nobody else has.
- The recipe page now opens on a big hand-cut print: a roast bird with its potatoes and its lemon, and halftone
  juices underneath. It looks like a made thing, not a placeholder.
- Six named overlap colours. A cook starts to know them. Plum is the tomato-and-sea one. Petrol is the green-and-blue
  one.
- At night the shelf is five colours of card stock under a lamp: olive, brick rose, bottle green, ink blue and amber.
  It is not a row of browns.
- Collections are the surprise: their recipes printed over each other.

## What keeps it calm

- One colour and one shape mean "press". The cook never has to ask what is clickable.
- Each print has two inks inside a fixed band. Overlaps are deep, not black. Night inks are mid-tones, so nothing
  glows.
- Colour is fenced. It lives inside covers and one small colour bar, never on a control, a chip or a status.
- Content has no shadows, no gradients and no blend modes. The paper is warm, and the night is green-black.
- The reading column is quieter: step numerals have no rings, and chips are one family.
- There is one motion, and it plays only after the cook acts.

## What changed since round 2, and why

**From Designer 1:**

1. **Light overlaps were near black (7.4 to 11.6:1).** _Fixed._ Six chromatic overlaps at 4.61 to 6.93:1, at least
   1.95:1 from `ink`, and every one in the table.
2. **Ink pairs repeat, and tomato is in almost every print.** _Fixed._ There is a fourth ink (beet), which gives six
   pairs. The hash picks the pair and never the food. The neighbour rule covers pairs, diagonals included.
3. **The identity disappears on the recipe page, and the no-photo hero is not drawn.** _Fixed._ The hero print is
   drawn in both themes, with hand-cut edges and halftone at large size. The colour bar carries the identity on
   photo recipes. A mixed grid of photos and prints is drawn at 1280.
4. **Dark: show more, give the grounds hue.** _Fixed._ The recipe page and the desktop are now in dark. The grounds
   are five hues at chroma 0.055 to 0.072.
5. **Gold does four jobs.** _Fixed_, with d1's preferred option: Draft is a dashed `sheet` chip, "for 4" is `well`,
   and gold is art only. PRO is `ink`.
6. **The glass compliance claim.** _Fixed._ The carousel indicator is solid `sheet`.
7. **The selected segment rests on a 1 px line.** _Fixed._ It is now a `sheet` fill, a 1.5 px ring, bold text and a
   check.
8. **Smaller points.**
    - Pewter on `well` gets a pinned token test.
    - Chips on art share one ring.
    - The bowl is named as a fallback.
    - Soon is 12 px.
    - The long-name greeting is rendered.
9. **Bold suggestion 1, the colour bar.** _Adopted._ **Bold suggestion 2, hand-cut plates and halftone.** _Adopted._

**From Designer 3:**

1. **The overlap breaks the band in light.** _Fixed_ (same as d1 #1).
2. **The dark grounds are almost the same colour.** _Fixed._ Every pair is at least 0.07 apart. In light, sage and
   mist are pulled apart.
3. **The green that means press leaks into the art.** _Fixed for inks_ (herb is 0.128 from `action`). _Partly fixed
   for overlaps:_ petrol and moss are 0.11. That is stated above.
4. **Gold is both a ground and an interface colour.** _Fixed_, plus the rule "a chip's fill is never a ground".
5. **The selected segment.** _Fixed_ (same as d1 #7).
6. **Too many rings on the detail page.** _Fixed._ Numerals have no ring at rest.
7. **The scrim was measured on the drawn photo.** _Fixed._ 65% flat over 64 px gives 4.98:1 over white.
8. **Gaps in the spec.**
    - The triple-overlap paint order is written down.
    - Photo recipes give their hidden print to collection covers.
    - The "how full" claim is softened.
    - The print is frozen at first publish.
    - The stamp now names its screen, and the off-screen stamp is cut.
    - Dark grain is bipolar, and the mockup grain is now the PNG that ships.
9. **Missing frames.** _Fixed:_ a Recipes grid in dark, a mixed grid of photos and prints, and a dark recipe page.
   **Card titles** are in Bricolage 16.

- **Bold suggestion 1, a preferred ink pair per cuisine or season.** _Declined._ A cook who mostly cooks Italian
  gets one pair across most of the library. That is the "red library" problem again, by a different road. The overlaps
  now have names, so a cook can learn them without a cuisine mapping.
- **Bold suggestion 2, a collection spine on recipe cards.** _Declined._ A recipe can be in many collections, so the
  card has to choose one spine or show several. Either way it adds a second colour signal to every card, and
  the colour bar already gives the card its print identity.

**Kept, because both critics named it:**

- prints from the recipe's own foods
- collections as overprints
- overlaps as tokens, not blend modes
- text never on art
- shape means press
- two type families
- glass measured at its worst case
- motion only after the cook acts

## Residual risks, stated plainly

- **The motif table needs a category on every catalog food, and the weight rule needs weights.** I have not measured
  how many curated foods have a category, or how often a line's weight can be computed. Where either is missing, the
  print falls back to cuisine, then to the bowl, then to the hash. A fallback looks finished, but it is plainer.
- **Nobody has seen the art on a device.** It is flat paths, the same kind `react-native-svg` draws, but I have only
  seen it in Chrome. The wobble and the overlaps are computed ahead of time, so the build needs a geometry step
  (the mockup used Shapely). That step runs on the server or at build time, not on the phone.
- **The ink band (2.4 to 4.1:1) and the overlap band are my craft targets for decorative art**, not WCAG rules.
- **Petrol and moss are 0.11 ΔE from `action`.** That is better than round 2's leaf (0.106), but only a little. If the
  owner sees green as "press" inside a cover, moss is the first token to move.
- **The photos in the mockup are blurred stand-ins.** A mixed grid with real food photos still needs one look with
  real images.
- **None of this is user evidence.** It is design judgement.
