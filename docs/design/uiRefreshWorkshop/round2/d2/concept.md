# Kitchen Press: Designer 2, round 2

The mockup is [`mockup.html`](mockup.html). It contains:

- Home at 390 px in light.
- Recipe detail at 390 px in light.
- **Home at 390 px in dark, with all four prints.**
- Collections at 1280 px. Each cover is an overprint.
- The token strip.
- A stress test: six chicken recipes, in both themes.
- The fallback palette, so the owner can see it, not just read about it.

Every hex and every ratio below comes from one table. The same table generates the mockup's CSS. So the
document and the page cannot disagree.

## The idea

Commise looks "meh" because most recipes have no photo. Today that leaves a library of pale tints, each with one
letter. In Kitchen Press, each of those recipes gets a **small two-ink print of what is in it**. The prints are made
from the recipe's own main foods, in tomato, sea and leaf inks on warm grounds. The second plate sits 2.5 px out of
register, and where two inks cross, a third colour appears. Over time the library looks like a shelf of prints the
cook made. A collection looks like what it is: its recipes printed over each other.

Everything around the prints stays quiet. The paper is warm, there is one green, and it means "you can press this".
Only pressable things are pills, and there are no shadows on content. The type is two families with clear jobs. The
screens, flows and layouts do not change. Only the material does.

The family name for the whole language is **printed matter from a working kitchen**. That covers the print shop
(covers, grain, registration) and the order ticket (the facts strip). A third metaphor is one too many.

## Palette

### Interface roles

| Role                                 | Light                            | Dark                            | Job                                                                                  |
| ------------------------------------ | -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `paper`                              | `#F5F0E6`                        | `#151B1A`                       | canvas, under the wash                                                               |
| wash (issue #145, kept)              | `#F8F1E2` → `paper` → `#EEF0E8`  | `#1A201E` → `paper` → `#121816` | "window light": warm at the top, a trace of sage at the foot                         |
| `sheet`                              | `#FFFCF6`                        | `#1D2423`                       | cards, ticket, steppers, the current step                                            |
| `well`                               | `#EFE8DB`                        | `#262E2D`                       | timer, the off state of the switch, placeholders                                     |
| `ink`                                | `#1C2422`                        | `#EFE8DA`                       | text, and the filled glyph of the active tab                                         |
| `ink-muted` = **slate (D11, exact)** | `#6B645C`                        | `#A8A193`                       | secondary text, inactive tabs                                                        |
| `edge` = **pewter (D11, exact)**     | `#8A847C`                        | `#6E7A72`                       | every control edge, and the dashed rules on the ticket                               |
| `line`                               | `#E3DACB`                        | `#2E3736`                       | decorative hairlines only, never a control edge                                      |
| `action`                             | `#2A6B65` (today's `ocean-dark`) | `#7CC8BE`                       | the one colour that means "press". The label is white in light and `#0F1A17` in dark |
| `action-tint`                        | `#DDEBE6`                        | `#1F3330`                       | selected segment (with a check), Public badge, avatar                                |
| `danger`                             | `#B1442B` (today's `error-dark`) | `#FF8C6E`                       | destructive text                                                                     |
| `honey`                              | `#A86A12` (today's)              | `#E2B04A`                       | stars and difficulty bars. These are graphics, never text                            |

`well` moved from round 1's `#EDE6D8` to `#EFE8DB`. That move is what lets D11's exact pewter pass 3:1 on it. The
alternative was a rule that no control edge ever sits on `well`, and that rule is easy to break later.

### Key pairs (text needs 4.5:1, and controls and graphics need 3:1)

| Pair                                                                                      | Light |       | Dark  |       |
| ----------------------------------------------------------------------------------------- | ----- | ----- | ----- | ----- |
| `ink` on `paper` / `sheet`                                                                | 13.96 | 15.48 | 14.31 | 12.96 |
| `ink` on wash top / bottom stop                                                           | 14.09 | 13.79 | 13.57 | 14.75 |
| `ink-muted` on `paper` / `sheet`                                                          | 5.13  | 5.69  | 6.80  | 6.16  |
| `ink-muted` on wash top / bottom                                                          | 5.18  | 5.07  | 6.45  | 7.01  |
| `ink-muted` on `well`                                                                     | 4.78  |       | 5.42  |       |
| `edge` on `paper` / `sheet` (control edge)                                                | 3.26  | 3.62  | 3.90  | 3.53  |
| `edge` on `well` / wash bottom                                                            | 3.04  | 3.22  | 3.10  | 4.02  |
| label on `action` (pill buttons, FAB)                                                     | 6.20  |       | 9.20  |       |
| `action` text / focus ring on `paper` / `sheet`                                           | 5.45  | 6.05  | 9.03  | 8.17  |
| `action` on wash bottom                                                                   | 5.39  |       | 9.30  |       |
| `ink` on `action-tint` (selected segment, Public)                                         | 12.91 |       | 10.94 |       |
| `danger` text on `paper` / `sheet`                                                        | 4.96  | 5.50  | 7.67  | 6.94  |
| `honey` stars, difficulty bars on `paper` / `sheet`                                       | 3.90  | 4.33  | 8.76  | 7.93  |
| Draft: `ink` on gold ground                                                               | 10.43 |       | 8.78  |       |
| PRO: gold on `ink` chip                                                                   | 10.43 |       | 8.78  |       |
| inactive tab `ink-muted` on glass, worst case (light 94% over `ink`, dark 90% over `ink`) | 4.59  |       | 4.67  |       |

Rules:

- **Glass is measured at its worst case**, not on its opaque fallback. The worst case is the darkest thing that can
  scroll under the bar. In round 1 the glass was 86% opaque, and that let a label fall to 3.9:1 over a dark cover
  overlap. It is now 94% in light and 90% in dark.
- **Text never sits on art.** The time, Private, Draft and PRO all sit on solid chips. So their ratios hold whatever
  print is underneath. This rule is kept from round 1 unchanged.
- **The status bar on a photo** sits on a top scrim: 55% `ink` fading to 0 over 110 px. White on the brightest
  photo tone is now 5.19:1. In round 1 it was 1.65:1, because the scrim existed but had 0 opacity.

### Press inks and grounds

There are three inks: **tomato, sea and leaf**. There are five grounds: **cream, blush, sage, mist and gold**.
Saffron is no longer an ink. Saffron ink on a light ground can never pass 1.7:1, which was the "yellow smudge"
both critics found. Saffron's joy now lives in the **gold ground** instead.

Prints are not literal colour. A pancake stack can be sea blue. That is true of real two-colour printing, and it
is what lets every ink sit in a contrast band.

**Light** (ink against ground. These are graphics, `aria-hidden`)

| Ink              | cream `#FBEBC8` | blush `#F8DED2` | sage `#DCEADF` | mist `#DDE6F2` | gold `#F7CC6E` |
| ---------------- | --------------- | --------------- | -------------- | -------------- | -------------- |
| tomato `#E4543A` | 3.17            | 2.91            | 3.00           | 2.96           | 2.46           |
| sea `#4A74B0`    | 4.03            | 3.71            | 3.82           | 3.78           | 3.13           |
| leaf `#3F8C6B`   | 3.44            | 3.16            | 3.26           | 3.22           | 2.67           |

**Dark** (ink against ground. These are graphics, `aria-hidden`)

| Ink              | cream `#3A3220` | blush `#3A2620` | sage `#20362F` | mist `#1F2A3A` | gold `#4E3B16` |
| ---------------- | --------------- | --------------- | -------------- | -------------- | -------------- |
| tomato `#C65A43` | 2.98            | 3.35            | 3.03           | 3.41           | 2.52           |
| sea `#5A7FB8`    | 3.12            | 3.49            | 3.17           | 3.56           | 2.63           |
| leaf `#3F8A6C`   | 3.06            | 3.43            | 3.11           | 3.49           | 2.58           |

**The band.** Every ink sits between 2.46 and 4.03:1 against every light ground, and between 2.52 and 3.56:1
against every dark ground. In round 1 the light covers ran from 1.58 to 6.2:1, and the dark ones reached 8:1.
**Now day and night sit in the same band.** A library in dark does not glow. A library in light does not wash out. The night inks are mid-tones (`#C65A43`, `#5A7FB8`, `#3F8A6C`), not the bright pastels of round 1. Gold
is the low end of the band in both themes. Gold is the loudest ground by hue, so it carries less contrast by design.

**Overlaps are tokens, not blend modes.** Each ink pair has one precomputed overlap colour per theme:

- **Light:** the overlap is the multiply of the two inks. It is the darkest note on the paper, as with real ink.
- **Dark:** the overlap is the screen of the two inks, moved 20% toward `sheet`. It is the lightest note, lifted
  but not glowing.

Each overlap is drawn as a third flat shape, the B plate clipped to the A plate. There is no `mix-blend-mode`, no
`feTurbulence` per cover and no halftone mask. So web, iOS and Android render it identically, and the overlap can
be tested for contrast. ΔE below is the OKLab distance to each parent ink. Every overlap is at least 0.11 from both of its parents. So
it reads as its own colour, not as a smudge of one ink.

| Overlap       | Light     | ΔE to parents | Dark      | ΔE to parents | Dark ratio range on grounds |
| ------------- | --------- | ------------- | --------- | ------------- | --------------------------- |
| tomato × sea  | `#422628` | 0.36 / 0.28   | `#B491A9` | 0.16 / 0.14   | 3.86 to 5.21                |
| tomato × leaf | `#382E18` | 0.37 / 0.29   | `#AF967D` | 0.14 / 0.15   | 3.81 to 5.16                |
| sea × leaf    | `#12404A` | 0.22 / 0.25   | `#6FA4B2` | 0.11 / 0.13   | 3.89 to 5.26                |

**Neighbour rule.** Two cards next to each other in a grid never share a ground. On a clash, the hash steps past the neighbour's ground to the next one. On Home the four grounds are cream, blush,
sage and gold. Every Collections row is distinct too.

### Owner rulings, one by one

| Ruling                                                     | Round 2                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Only pressable controls are pills."                       | **Complied.** Buttons, the FAB, the segmented control, stepper buttons and step numerals are pills or circles. Badges, the time chip, the timer and the "for 4" tag are 6–8 px rectangles. The search field is a rectangle. The shape now says "press" as clearly as the colour does.                                   |
| "Numbers use Inter with tabular digits."                   | **Complied.** DM Mono and Figtree are gone, and every number is Inter with `tnum lnum`.                                                                                                                                                                                                                                 |
| "The canvas wash stays (issue #145)."                      | **Complied.** The window-light wash is shown, and every text pair is measured on both of its stops.                                                                                                                                                                                                                     |
| D11 slate `#6B645C`, pewter `#8A847C`                      | **Complied, exact values.** `well` moved instead.                                                                                                                                                                                                                                                                       |
| "Coral leaves every control."                              | **Complied, and extended to tomato.** Tomato appears only in prints and in the brand mark. The tab "ink spot", the tomato strike and the tomato step rule are gone. The avatar is `action-tint`, not a warm tint.                                                                                                       |
| "One signature motion: the overshoot on the check toggle." | **Complied** for the core. One extension is listed under amendments.                                                                                                                                                                                                                                                    |
| D12 glass on navigation only                               | **Complied.** Glass is used only on the tab bar, the photo's back and ⋯ discs, and the carousel indicator.                                                                                                                                                                                                              |
| D13 "seafoam-tinted" New recipe button                     | **Proposed amendment (small).** The action is today's `ocean-dark` `#2A6B65`. It is a token already in the palette, one step darker than seafoam. White on it is 6.20:1, against 4.67:1 on seafoam. On iOS 26 the glass is tinted with it. The fallback strip shows both greens side by side.                           |
| Palette "mostly" kept                                      | **Proposed amendment.** Coral, sky and warning become the print inks tomato, sea and leaf, plus the gold ground. These are art, not interface. The fallback strip renders the same prints in today's coral and seafoam on sand. The cost is visible: coral on sand is 2.23:1, so the prints get quieter but still work. |

## Type: two families

- **Display: Bricolage Grotesque**, held narrow (wdth 80–90, opsz 36–96, weight 650–750). It is used only for the
  greeting, the recipe title, the large page title, section headings and desktop card titles. Both critics flagged
  it as a 2024 trend. I kept it. At default width it is a trend. At wdth 84 it is a warm, hand-set wood-type
  grotesque that suits a print shop. I took its trendy partner, the mono for everything, away instead.
- **Everything else: Inter** with `cv11` (single-storey a). That covers the body, labels, overlines and every
  number. This follows the owner's numbers ruling and halves the font payload. Load order: Inter first (the UI is
  usable in it alone), then Bricolage. On native, ship **static instances** of the two Bricolage settings in use: 84/700
  display and 90/650 section. Then React Native never falls back to the default width.

| Role                    | Spec                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large title (web)       | Bricolage 56/1.0, wdth 84, 700, −0.026 em                                                                                                                |
| Greeting (phone)        | Bricolage 36/1.02, wdth 84, 700, `text-wrap: balance`. For a display name over 18 characters, it steps down to 30 px. It is then never more than 3 lines |
| Recipe title (phone)    | Bricolage 32/1.05, wdth 86, 700                                                                                                                          |
| Section                 | Bricolage 21 (phone) / 24 (web), wdth 90, 650                                                                                                            |
| Card title              | Inter 15/600 (compact), Bricolage 20/650 (desktop card)                                                                                                  |
| Body, description, step | Inter 16/1.5, 17/1.6 and 17/1.55                                                                                                                         |
| Ticket value            | Inter 16/600, tabular. Wraps under the number at narrow widths                                                                                           |
| Ingredient line         | Inter 16. The amount and unit are 600 tabular, the food is 400, and the preparation is muted (D21's one-line order)                                      |
| Overline                | Inter 12/600, caps, +0.08 em                                                                                                                             |

## Surfaces, shape and elevation

- **Flat paper. Content has no shadows.** Cards are `sheet` on the washed `paper` with a 1 px `line` inset. Only
  floating things have a shadow and glass: the FAB, the tab bar and the photo discs.
- **The ticket.** Total, Prep and Difficulty sit on a `sheet` with **pewter** dashed rules, so the dashes are real
  3:1 graphics, not decoration that disappears. The columns are 1.2 : 1 : 1.15, and values can wrap. I rendered it
  at 390 px and at 320 px: "1 h 50 min" fits on one line at 390 px, wraps cleanly at 320 px, and nothing
  overflows.
- **Radius:** covers 14, cards and widgets 20, ticket and accordions 16, inputs 12, badges 6. Every control is a
  pill.
- **Active state is the same on both platforms:** a 3 px `action` bar plus bold text plus a filled glyph plus
  `aria-current`. On the phone the bar is at the top of the tab. On desktop it is at the left of the sidebar row.
- **Difficulty** is three honey bars (3.90:1 light, 8.76:1 dark), with the word next to them.
- **Today in the week widget** is a `sheet` cell with a 1.5 px `action` ring and a filled dot. Round 1's tint was
  1.01:1 against its neighbours.
- **A checked ingredient** gets an `action` box, and its strike is in `ink-muted`. A red strike reads as "wrong",
  and this row is "done".
- **The current step** has a 3 px `action` rule, a `sheet` ground and an `ink` numeral disc. The numeral is the
  control ("Mark step 3 as current"), so the action colour is earned here.

## Imagery: prints from the recipe's own foods

1. **The motif comes from the food, not the tags.** Take the recipe's top two catalog foods by weight. Map each
   food category to a motif:
    - grain: stacked slabs
    - noodle: loops
    - poultry: a roast shape
    - dairy: a pat
    - citrus: a wheel
    - fruiting veg: a disc
    - leafy or herb: a sprig or leaves
    - rice and small grains: scattered grains
    - tuber: pebbles
    - fungus: caps
    - chili: a pod

    The heavier food is plate A and the lighter one is plate B. When a
    cook edits the recipe, the print changes. Fallback: a recipe with no matched food yet, which is most new drafts,
    gets a print from its cuisine. If it has no cuisine either, it gets a disc-and-rule print keyed only to the
    hash.

2. **The hash drives composition, not identity.** The recipe-id hash that `RecipeCover` already uses picks the ink
   pair, the ground (under the neighbour rule), the rotation (±16°), the scale (0.5–1.3), the crop, and which food
   is on top. The stress test shows six chicken recipes. Each one differs by its second food (lemon, tomatoes,
   butter, mushrooms, rice, chili and lime) and by its composition. No two look alike, and every one still says
   "chicken".
3. **Registration is set in rendered pixels.** Plate B is offset by **2.5 CSS px** across and 1.25 down, whatever
   the size: offset = 2.5 × viewBox width / rendered width. That is 5.8 units on a 173 px phone card and 2.6 units
   on a 304 px collection tile. Round 1's offset was 0.86 px and was too small to see.
4. **Grain is one tile per theme.** The light theme uses a 128 px dark-noise PNG at 45%. The dark theme uses
   light noise at 42%, because round 1's dark grain was black noise in `screen` mode, which cannot be seen. The
   grain is fixed in screen pixels, so it looks the same on a thumbnail and on a hero. It costs one decoded bitmap,
   not 60 live filters.
5. **Collections are overprints.** A collection's cover is the A plates of its first three recipes, fanned out
   over each other, each in its own ink, with all three pairwise overlaps. "Breakfast for guests" holds one recipe,
   so it shows one plate. The cover tells you, without words, how full the collection is.
6. **Discover:** another cook's recipe uses the same print grammar. It is their food in our inks, so Discover
   reads as a public library of prints, not as a separate visual world.
7. **Photos stay photos.** They get the same grain tile at 60% of its strength, so photos and prints feel like
   one set.
8. **Decorative only.** Prints are `aria-hidden`. The title is what names the card.

## Motion

- **The one signature motion is kept:** the check toggle overshoots (scale 0.85 → 1.06 → 1, 220 ms,
  `cubic-bezier(.34,1.56,.64,1)`). The box fills with `action` and the strike draws in `ink-muted`.
- **Proposed amendment: the same curve, in exactly two other places, and only after the cook does something.**
    1. On a successful **publish**, the recipe's print stamps once. Plate B starts 6 px out and lands at its
       2.5 px rest offset, with the overshoot curve.
    2. When a recipe is **added to a collection**, its plate lands on the collection cover the same way.

    These are the same motion as the check, with the same meaning: "you did that, and it took". There is no motion
    on first view, on scroll or on refresh. I dropped round 1's "registration settle on every cover". If the owner
    says no, only the check moves, and nothing else in this concept depends on it.

- The title condense is the platform cross-fade, not an invented motion.
- **Reduced motion:** every change becomes an instant state change. The grain never moves.

## What makes it exciting

- The library is art, and the art is the cook's own food. Each new recipe adds a new print. When the cook edits a
  recipe, its print changes too.
- The colour is real colour: tomato, sea, leaf and gold. It is confident because it is contained.
- The display type has a voice, and the type is narrow, which is the opposite of the default grotesques of every
  UI kit.
- Collections are the surprise. They are the one screen where the press idea goes further than a nice thumbnail,
  and no other recipe app has them.

## What keeps it calm

- One colour means "press", and one shape (the pill) means "press". The cook never has to ask what is clickable.
- Each print has two inks and stays inside its band. Night inks are mid-tones, so a dark library does not glow.
- There are no shadows on content, no gradients on content, and no blend modes. The paper is warm and the night
  is green-black, with no white or black glare.
- Two type families, each with one job.
- There is one motion, and it only happens after the cook acts.

## What changed since round 1, and why

**Kept, because both critics named it:**

- prints for recipes with no photo
- text never on art
- one action colour
- the ticket
- drawn placeholders
- warm paper and a green-black night

**Fixed, from the critiques:**

1. **Dark covers are shown and balanced.** Home appears in dark with all four prints. The night inks and the
   overlaps are tokens with stated ratios, and day and night now sit in the same band (d1 #4, d3 #1).
2. **The grain is visible in dark:** a light-noise tile (d1 #3, d3 #1).
3. **Registration is in rendered px:** 2.5 px at every size (d1 #3).
4. **The covers build on native:** precomputed overlaps, flat fills, one grain bitmap and static font instances
   (d1 #5, d3 #7).
5. **Tomato is limited to art and the brand mark.** The tab spot, the strike and the step rule went to `action`
   or `ink-muted` (d1 #2, d3 #2).
6. **The name is in `ink`** (d1 #2, d3 #3).
7. **Every owner ruling is listed**, with five now complied with and two amendments framed with their real size
   (d1 #1, d3 #10).
8. **The fallback palette is shown as a frame** (d1 #1, d3 #10).
9. **Overflow:** the ticket wraps and was verified at 320 px. The fixed 76 px amount column is gone, because D21's
   one-line order needs no column (d1 #6, d3 #4).
10. **The status-bar scrim is finished:** 5.19:1 (d1 #7).
11. **Saffron is out of the inks and onto a ground:** there is no more yellow on yellow (d1 #4, d3 #5).
12. **The desktop and phone active states match** (d1, d3 small items).
13. **Today is a ring, not a tint.**
14. **"Version history" is 44 px tall.**
15. **Covers come from foods, and Collections are overprints.** These were the bold suggestions from both
    critics, and both are adopted. The overprint tile is the desktop frame, so desktop earns its width with art,
    as d3 asked.

**Changed direction on type.** I moved from three families to two. DM Mono was the part that read as a "developer
tool", and it crossed the owner's numbers ruling. Figtree only existed to avoid Inter. Once the prints carry the
character, the body face does not need to.

**Declined, with reasons:**

- **Misregistration as pull-to-refresh** (d3 bold suggestion 2). It is a lovely idea, but it is a third use
  of the motion, and the owner ruled one signature motion. I kept the two uses that mark something the cook did.
- **Making the first desktop card span two columns** (d3). On Home it changes D8's "one row of exactly 4 full
  cards". That is a layout change, and layouts are out of scope. I gave desktop its moment on Collections instead.
- **A tomato current-step rule** (d3 said keep it). d1 argued for the action colour, and the numeral is a control,
  so the action colour is the honest signal.

**Residual risks, stated plainly:**

- The motif table needs a category on every catalog food. I have not checked how complete food categories are in
  the curated catalog.
- I have not verified the cover pipeline in `react-native-svg` on device. The design only uses paths, masks or
  clips, and flat fills, which `react-native-svg` supports. But "supports" is not the same as "rendered and looked
  at".
- The 2.2–4 band is a craft target for decorative art, not a WCAG requirement. Gold at the low end (2.46 in light)
  is a deliberate choice.
- The long-name greeting step-down (18 characters → 30 px) is a rule I set, not a rule I rendered with a
  30-character name.
