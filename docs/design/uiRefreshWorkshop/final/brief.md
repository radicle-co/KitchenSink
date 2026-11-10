> SUPERSEDED (2026-10-22). Do not use this for design work. The current design brief is docs/design/uiRefreshWorkshop5/brief.md, and the user needs are in docs/research/userNeeds/.

# UI refresh workshop: final brief

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** This is the closing session of a three-round workshop. Round 3 was the
last round. Anything still owed is written below as a **gate before build**, never as a "round 4".

- **Who:** Designer 1 (d1), Designer 2 (d2) and Designer 3 (d3), with a session lead.
- **Read:** every `concept.md`, `mockup.html` and critique file in `round1/` to `round3/`. Round 3 and its six
  critiques carry the most weight.
- **Also read:** the current tokens (`packages/apps/commise/ui/src/tokens/`), the built design system, the owner's
  rulings (`docs/design/uiOverhaul/ownerDecisions.md`) and the build spec.
- **Not user evidence.** Everything here is design judgement. No cook has seen any of it.

## How the numbers in this brief were made

The session lead recomputed **every hex and every ratio** in this brief with one script. Nothing is copied from a
concept without a re-check.

- **Contrast:** WCAG 2.x relative luminance. Text needs 4.5:1. Controls, focus rings and meaningful graphics need
  3:1.
- **Glass and scrims:** alpha-composited in sRGB, as a browser does. Each one is measured over the darkest thing that
  can sit under it.
- **Colour difference:** OKLab distance for art tokens (as d2 used). CIE76 and CIEDE2000 for the recipe light (as d1
  and d2 argued about).
- **Where a figure differs from a designer's,** the brief uses the session lead's figure and says so.

## What the problem is, and what stays fixed

Commise works well. The flows and layouts are good. It **looks** dated: pale tinted covers with one letter on them, a
cream page, and nothing that makes a cook want to open it. The goal is a new visual language that is fresh and
attractive, and still calm and easy.

Both proposals change only the material: colour, type, surfaces, shape, icons, imagery, texture, spacing and motion.
Both keep every screen, flow, the order of things and their placement. Both were checked against the current boards
(`HomeMobile`, `RecipeDetailMobile`, `Recipes`, `Discover`, `Collections`) by at least two critics.

---

## 1. The session

The three designers met with the round 3 critiques in front of them. This is a summary of what they said, in their
own voices, and what they decided.

### Where all three already agree

**d3:** "Look at what happened over three rounds. We started with three different ideas. By round 2 we all had the
same answer to the hard part: a recipe with no photo gets a **picture generated from its own ingredients**. We only
disagree about what kind of picture."

**d1:** "And that is the right answer. Most recipes in this app have no photo. Today they get a pale tint and a
letter. Every proposal that fixed that made the library exciting. Every proposal that only changed the chrome stayed
'meh'. The two modernize proposals from before this workshop proved it."

**d2:** "Agreed. And we agree on the chrome rules too. One colour means 'press'. Only things you can press are pills.
Text never sits on art. Colour lives in pictures, not on controls. Selected states never rely on hue alone. Nobody
argued with any of that in three rounds."

The group listed the rules that every round 3 critique supported. They hold in **both** proposals:

1. A recipe with no photo gets a generated picture from its own foods. It is decorative (`aria-hidden`). The title
   names the dish.
2. The picture is stored, and it is **the same for every viewer**. Discover shows the author's picture. Nothing about
   the viewer or the cook's other recipes changes it.
3. **The picture's life** (d3's rule, which both critics of d3 called the clearest product thinking in the
   workshop). The seed is stored at first save. While the recipe is a draft, the picture follows the ingredient
   lines. At first publish (`recipes.first_published_at`, ADR-0058) it **freezes**. After that, only one event changes it:
   a drawn food leaves the recipe. Round 2 froze at first save, which froze almost every typed recipe as a blank.
4. A cook's photo is never recoloured, graded or vignetted.
5. A chip's fill is never an art colour. A chip on art is a paper chip with a thin ink ring (d2's rule).
6. A dashed edge means "not finished": the Draft chip (d2).
7. Only the check toggle overshoots. It is still the one signature motion.
8. Every motion becomes an instant change under reduced motion. Nothing loops, nothing is tied to scroll, and there is
   no parallax.

### Where they split, and why it matters

**d1:** "The real split is where the colour goes. In mine, the colour is the **food's own colour**, and it leaves the
picture. It lights the room. A tomato soup page is faintly rosy. A ramen page is cool. That light works for photo
recipes too, and a long-time cook has mostly photos."

**d2:** "In mine, the colour stays **fenced inside the art**. The art is a **print**, not a picture: two inks, a
third where they cross, and paper you can feel. Everything around it is flat and quiet. That is the fresher look. Nobody
ships a recipe app that looks like a shelf of small prints. Plenty ship cream, a soft serif and one green."

**d3:** "Mine sat between yours, and the critiques showed it. My cut-paper plates use the food's real colour on a
complement board. d1 told me the motifs read as a stock icon set and the plates were not yet exciting. d2 told me
plum was going to be most of the wall. Both fixes they offered pull my plate toward one of yours: d1 said 'make it a print',
d2 said 'give yellow a blue board'. So my plate is not a third proposal. Its best parts
go into both of yours."

**d2:** "Then the two finals must not blur. If both proposals tint the recipe page in the recipe's colour, we have
one idea in two styles."

**d1:** "So the line is: **A lets colour out of the picture. B keeps it in.** A is figurative, lit, warm and serif.
B is graphic, printed, flat and grotesque. Every borrowed idea has to respect that line."

They agreed. d3's key-coloured title was the hardest call: it is lovely, but it makes B a second 'room in the
recipe's colour'. So **the key title goes into neither**. A already colours the room with light. B keeps the page
neutral on purpose.

### What died in the session, and why

| Idea                                                                   | From     | Why it was dropped                                                                                                                          |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout-time neighbour rule for print colours                           | d2 r3    | It contradicts the freeze. Sort, filter, a collapsed sidebar or a phone all give the same recipe a new colour (d1, d3)                      |
| "Rarest in this cook's library" as the hero rule                       | d1 r2    | It changed old covers whenever the cook saved something else (withdrawn by d1 in round 3)                                                   |
| The hash picks the print's inks with no regard to the food             | d2 r3    | Blue pork, blue bread, pink chicken, magenta tomatoes. A food app cannot work against appetite (d1, d3)                                     |
| The ground as a pure function of the hero's colour                     | d3 r3    | Every lemon recipe got the same plum board, and so did the logo (d1)                                                                        |
| "Plate A is never sea" as the whole appetite fix                       | d3 on d2 | It still leaves red pancakes that read as bacon and green bread (the session lead, from the critics' own examples)                          |
| -25% chroma on the night aubergine and garnet overlaps                 | d3 on d2 | Measured: it pulls them to 0.065 OKLab apart, below the 0.073 that keeps the six overlaps learnable. Kept as a device check instead (see B) |
| Lifting A's wash to L 0.965                                            | d2 on d1 | Paper cards lose their edge on a lighter wash, and the warm-hue problem has a cheaper fix (see A)                                           |
| d3's drawn-food glyph at the end of an ingredient line                 | d3 r3    | It adds a new element to the row. It collides with the notice badges ("Needs review", "Choose a match"). At 1.39:1, nobody sees it (d1, d2) |
| "Pull another proof" menu item                                         | d1 on d2 | A new action. The brief keeps the flows. Recorded for the owner, not built                                                                  |
| "Your plate is set" line after publish                                 | d2 on d3 | A new string and a new moment. Same reason                                                                                                  |
| Collection spine on cards, cuisine ink pairs, a shared Discover ground | various  | Each adds a second colour signal or a second look for the same recipe                                                                       |
| The d3 logo drawn as a lemon plate                                     | d3 r3    | A brand mark made of one recipe's face (d1)                                                                                                 |

### What became the two proposals

- **Proposal A, "Still Life, Lit", led by d1.** The food's own colour, drawn as an overhead still life, and the food
  lights the room.
- **Proposal B, "Kitchen Press", led by d2.** The food as a small two-ink print. Colour stays inside the print.
  Everything else is flat paper and wood type.

Both take d3's plate-life rule. d3 also gave A its contrast checks on every object, its colouring-in study and its
illustration style sheet. d3 gave B its hero ladder and its "ground never matches the food" rule.

---

## 2. Proposal A: "Still Life, Lit"

**Lead designer: d1.** It builds on d1's round 3 almost whole, and closes every defect that d2 and d3 found in it.

### What A takes from each designer

| From          | What A takes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **d1** (lead) | The chrome: plaster, paper, warm greys and one seafoam. The cover generator: a stored `CoverSpec`, five composition families, four hero slots, the hero chosen by mass share. The unfinished study that ripens, and "draws itself" in the editor. The recipe's own light, built in OKLCH at a fixed lightness. The matted print with concentric radii. Fraunces for names, Inter for everything else. The current step's glow. The open transition. Photos left untouched, with their hue sampled at upload. The illustration style sheet that d1 wrote in the critique of d3 |
| **d2**        | The chip rule (a chip on art is paper with a ring) and the dashed Draft chip. A **confidence result** from the generator, with the study as the fallback. A warm-hue floor measured in CIEDE2000. The form-by-family eligibility table, and renaming the second "pattern". "One solid action per region". Keeping the chevron on "8 comments" and the globe on "Public". A motion budget under 450 ms. Real dark swatches with no CSS filter. **Home lit by its first recent recipe** (d2 and d3 both proposed it. d3's version needs no new stored state)                    |
| **d3**        | The picture's life (seed at first save, follows the draft, freezes at first publish). Contrast checks on **every** object in a cover, accents included. Studies that use the five families, a smaller pool and a line drawn in the recipe's own hue. **The study as a colouring-in page.** The rule that the wash ends above the first step. Paper fill for controls in the wash band. The partial star over a pewter outline. A separate avatar role. Ink, not seafoam, for the wordmark dot                                                                                 |

### The concept

A good kitchen is a quiet room with good food in it. The chrome is a calm wall: plaster, paper, warm greys and one
seafoam green. **The colour comes from the food.**

That idea has four parts:

- A recipe with no photo gets an **overhead still life** of its own main foods, set in a paper mat like a print.
- **The food also lights the room.** Each recipe page takes a soft light in the hue of its own cover. The light sits
  at the top of the page and again on the step being cooked. A tomato soup page is faintly rosy. A ramen page is
  faintly cool. A photo recipe gets its light from its photo.
- **Home is lit by its first recent recipe.** The corner of Home takes the light of the first card in "Recent
  recipes". The morning after the tomato soup, Home has a rosy dawn. After the ramen, it is cool.
- A recipe the cook has not matched yet is an **unfinished study**: a line drawing in the recipe's hue. It fills in
  with colour as the cook matches ingredients. A new library looks like a sketchbook. Over the first weeks, it ripens
  into a wall of pictures of the cook's own food.

### Palette, light

| Role                          | Hex                               | Job                                                                                                                     |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `canvas` (plaster)            | `#F3ECE1`                         | the page                                                                                                                |
| `canvasWash` (global screens) | `#FAF0DC` → `#F3ECE1` → `#EBEEE5` | one warm corner on Recipes and Discover. On Home, the warm corner takes the wash of the first recent recipe (see below) |
| `paper`                       | `#FFFCF7`                         | cards, mats, the strip, inputs, chips on art, the timer chip, every outlined control's fill                             |
| `surfaceMuted` (linen)        | `#ECE4D7`                         | the Soon badge. It never holds a control edge                                                                           |
| `ink`                         | `#24201C`                         | text, icons, filled difficulty pips, the wordmark dot                                                                   |
| `inkMuted` (D11 slate)        | `#6B645C`                         | secondary text, inactive tabs, the cuisine overline                                                                     |
| `lineControl` (D11 pewter)    | `#8A847C`                         | every control edge, always on paper. The resting step-numeral ring. The empty part of a star                            |
| `lineDivider`                 | `#E2D9CB`                         | decorative hairlines only                                                                                               |
| `action` (seafoam, D13)       | `#31807A`                         | the one solid action per region, and the current step's numeral. Label `#FFFFFF`                                        |
| `actionText`                  | `#2A6B65`                         | links, the selected edge, the checked box's edge and tick, the focus ring                                               |
| `selectedFill`                | `#DDEBE7`                         | selected tab, chip, nav row, checked box, the switch's on track. Always with a 1.5 px `actionText` edge                 |
| `rating` (honey)              | `#A86A12`                         | star glyphs only. Never text                                                                                            |
| `dangerText`                  | `#B1442B`                         | error and destructive text                                                                                              |
| `glass`                       | `paper` at 92%                    | D12 surfaces only: the tab bar, the condensed bar, the hero discs                                                       |

### Palette, dark ("after hours")

| Role                                | Hex                   | Job                                                                     |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `canvas`                            | `#151311`             | warm brown-black page                                                   |
| `paper` / `paperRaised`             | `#25211D` / `#2E2924` | cards (with a 10% warm edge) / the timer chip and menus                 |
| `ink` / `inkMuted`                  | `#F2ECE2` / `#B3A99C` | text / secondary text                                                   |
| `lineControl` / `lineDivider`       | `#857D72` / `#3A342E` | control edges / hairlines                                               |
| `action` (one token, fill and text) | `#6CC0B3`             | the solid action and the current numeral. Label `#0F1F1C`               |
| `selectedFill`                      | `#1E302D`             | selected states and the checked box, with an `action` edge              |
| `rating` / `dangerText`             | `#E0A84A` / `#F0907A` |                                                                         |
| `coverPlate`                        | `#9C9488`             | the plate inside a dark cover, stepped down so the food stays brightest |
| `glass`                             | `paperRaised` at 92%  |                                                                         |

### Contrast, key pairs

Text needs 4.5:1. Edges, glyphs, focus rings and state shapes need 3:1.

| Pair                                                                      | Light                | Dark                           | Kind          |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------ | ------------- |
| `ink` on canvas / paper                                                   | 13.78 / 15.80        | 15.77 / 13.60                  | text          |
| `ink` on linen / selectedFill                                             | 12.82 / 13.18        | 12.25 (on raised) / 11.79      | text          |
| `inkMuted` on canvas / paper / linen                                      | 4.97 / 5.70 / 4.62   | 8.01 / 6.90 / 6.22 (on raised) | text          |
| `inkMuted` on the global warm corner `#FAF0DC` / cool foot `#EBEEE5`      | 5.15 / 4.97          |                                | text          |
| `actionText` on canvas / paper / selectedFill                             | 5.28 / 6.05 / 5.05   | 8.67 / 7.48 / 6.48             | text and edge |
| Label on `action` (the solid button)                                      | 4.67 (white)         | 7.97                           | text          |
| Focus ring (`actionText`, 2 px, 2 px canvas gap)                          | 5.28                 | 8.67                           | focus         |
| Selected edge on selectedFill (checked box edge and tick)                 | 5.05                 | 6.48                           | control       |
| `lineControl` on paper (every outlined control)                           | 3.62                 | 3.94                           | control       |
| `lineControl` on canvas                                                   | 3.16                 | 4.57                           | control       |
| `lineControl` on linen                                                    | **2.93, never used** |                                |               |
| Resting numeral ring (pewter on paper)                                    | 3.62                 | 3.94                           | control       |
| Current numeral (`action`) on canvas / paper                              | 3.98 / 4.56          | 8.67 / 7.48                    | graphic       |
| Honey star on paper / canvas                                              | 4.33 / 3.78          | 7.51 / 8.71                    | graphic       |
| `dangerText` on paper / canvas                                            | 5.50 / 4.80          | 6.83 / 7.92                    | text          |
| Inactive tab (`inkMuted`) on glass at 92%, worst case (ink text under it) | 4.86                 | 4.94                           | text          |
| Dark `coverPlate` on dark paper                                           |                      | 5.33                           | art           |
| Photo fallback scrim: `paper` text on 64% `ink` over pure white           | 4.80                 |                                | text          |

**Corrections to round 3.** d1's fallback scrim was 62%. Over pure white that gives 4.49 with `paper` text, which
misses 4.5 by a hair. A uses **64%** (4.80). The glass opacity was not stated in round 3. At 88% the inactive tab
falls to 4.51 in light and 4.41 in dark, so A fixes glass at **92%**.

### The recipe's own light

One hue per recipe, at a fixed OKLCH lightness. The hue comes from the cover's ground. A study takes its cuisine's
hue. A photo takes the dominant hue sampled at upload. Because the lightness never moves, every token keeps its
contrast on every hue. No per-hue guard is needed.

- **`recipeWash`:** L 0.944 in light, L 0.215 (C 0.022) in dark. It sits at the top of the recipe sheet: solid to
  140 px, gone by 560 px. On desktop it covers the whole main column and is gone by 680 px.
- **`recipeGlow`:** L 0.930 in light, L 0.26 (C 0.03) in dark. It is the fill of the current step, and the pool
  behind a study.
- **Chroma rule:** solve the chroma so that the wash sits about ΔE76 8 from plaster. Floor 0.008, cap 0.05. **New in
  the final:** the wash must also sit at least **CIEDE2000 6.4** from plaster. d2 showed that CIE76 flatters warm
  hues. The new floor lifts butter and oat, the two warm hues that fell short (5.86 and 5.59).

| Hue           | Light wash / glow         | Dark wash / glow      | Wash to plaster, ΔE76 / ΔE2000 |
| ------------- | ------------------------- | --------------------- | ------------------------------ |
| terra 59°     | `#FFE8D7` / `#FEE2CD`     | `#21170F` / `#2F2015` | 6.79 / 6.46                    |
| blush 34°     | `#FFE6E0` / `#FFE0D8`     | `#231613` / `#311F1A` | 7.09 / 8.86                    |
| butter 88°    | **`#F8ECCE` / `#F6E7C1`** | `#1E190D` / `#2A2313` | 9.93 / 6.77                    |
| oat 83°       | **`#FAEBCE` / `#F9E5C0`** | `#1E190E` / `#2B2313` | 9.75 / 6.53                    |
| sage 113°     | `#ECEFD6` / `#E8EBCB`     | `#1A1B0F` / `#242614` | 8.02 / 7.91                    |
| mint 161°     | `#E1F1E8` / `#D7EFE1`     | `#101D16` / `#16291F` | 8.24 / 9.90                    |
| sky 217°      | `#E7EEF0` / `#DBEBEF`     | `#0D1C20` / `#11282D` | 8.30 / 7.87                    |
| ink 242°      | `#E8EDF1` / `#E0E9F1`     | `#101B23` / `#162631` | 8.79 / 8.13                    |
| Japanese 254° | `#E9EDF2` / `#E1E9F1`     | `#121A23` / `#192532` | 9.09 / 8.39                    |
| lilac 319°    | `#EFEBF0` / `#EDE4EF`     | `#1E1620` / `#2B1F2D` | 8.29 / 7.92                    |
| Korean 18°    | `#FDE6E6` / `#FEDFDE`     | `#231515` / `#311E1E` | 8.08 / 9.95                    |
| Mexican 40°   | `#FEE7DF` / `#FEE0D6`     | `#221612` / `#311F19` | 6.09 / 7.66                    |

Terra stays at 6.46 ΔE2000: it is at the edge of the sRGB gamut at this lightness, so no more chroma is available.

| Pair, over all 12 hues                 | Light                        | Dark                    |
| -------------------------------------- | ---------------------------- | ----------------------- |
| `inkMuted` on any wash                 | 4.90 to 4.98                 | 7.50 to 7.63            |
| `actionText` on any wash               | 5.20 to 5.30                 | 8.13 to 8.26 (`action`) |
| Honey star on any wash                 | 3.72 to 3.79                 | 8.16 to 8.30            |
| `ink` on any glow                      | 12.96 to 13.34               | 13.03 to 13.39          |
| Current numeral (`action`) on any glow | 3.74 to 3.85                 | 7.17 to 7.36            |
| `inkMuted` on any glow                 | 4.67 to 4.81, **never used** |                         |
| `lineControl` on any wash              | 3.11 to 3.16, **never used** |                         |
| Glow against its own wash, ΔE2000      | 2.13 to 3.88                 |                         |

Rules that follow from these numbers:

- **Every outlined control keeps its own paper fill** inside the wash band (the top 360 px of a page).
- **Only `ink` and the solid numeral sit on the glow.** `inkMuted` measures 4.67 there, which is too thin.
- **The wash ends above the first step.** The glow sits only 2 to 4 ΔE2000 from the wash, so a current step inside
  the wash band loses its fill. A short recipe pushes the wash end up, not the step down.
- **The timer chip is paper,** even on the glow. Linen on the terra glow was 1.02:1, so the chip had no shape. In
  dark it is `paperRaised`.
- **Home's warm corner** takes the wash of the first card in "Recent recipes", at the same L 0.944. Home already
  has that card, so this needs no new stored state and no device storage. Every Home ratio above still holds. Home
  sets the hue once per render and never animates it. With no recent recipe, Home uses the global `#FAF0DC`. Recipes and Discover keep the global corner. **This amends issue #145 a second time, so it
  is an owner call.**

### Cover grounds and the status bar

A generated cover's ground swaps with the theme. So **the status bar is not stored**. The renderer derives it from
the ground of the active theme. If `ink` is at least 5:1 on the ground, the text is `ink`. If not, the text is light. Only
a photo stores its status bar, sampled at upload, because a photo does not change with the theme. This fixes the
1.38:1 status bar on round 3's dark recipe page (found by d2 and d3).

| Ground  | Light hex | Status text, light | Dark hex  | Status text, dark |
| ------- | --------- | ------------------ | --------- | ----------------- |
| terra   | `#E8C9AE` | `ink` 10.32        | `#4A3326` | `#F2ECE2` 9.97    |
| blush   | `#EBCFC4` | `ink` 10.98        | `#43302A` | `#F2ECE2` 10.54   |
| butter  | `#F0DDB0` | `ink` 12.07        | `#4A3E22` | `#F2ECE2` 8.92    |
| oat     | `#EADFCB` | `ink` 12.26        | `#3A3228` | `#F2ECE2` 10.72   |
| plaster | `#E9E1D4` | `ink` 12.47        | `#2C2723` | `#F2ECE2` 12.57   |
| sage    | `#D9DCC0` | `ink` 11.51        | `#2F3426` | `#F2ECE2` 10.90   |
| mint    | `#D3E3DA` | `ink` 12.15        | `#25352E` | `#F2ECE2` 10.98   |
| sky     | `#D6DEE0` | `ink` 11.85        | `#27313A` | `#F2ECE2` 11.26   |
| lilac   | `#DCD3DE` | `ink` 11.10        | `#352F3C` | `#F2ECE2` 11.01   |
| ink     | `#2F3E46` | `paper` 10.81      | `#1C262B` | `#F2ECE2` 13.13   |

### Type

Two families. The serif carries **names**: the title of a recipe, a collection, the greeting and a cook's own group
labels. Everything the app says is set in Inter.

| Role (today's name)                            | Face                                                           | Phone                          | Desktop      |
| ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------ | ------------ |
| `largeTitle` (greeting, Recipes, Discover)     | Fraunces 500, SOFT 100, opsz 36. The cook's name in italic 400 | 34/1.08                        | 46/1.06      |
| Recipe title (`largeTitle` on the recipe page) | Fraunces 500, opsz 36, word spacing +0.05 em                   | 34/1.08                        | 44/1.06      |
| `barTitle` (condensed bar)                     | Inter 600                                                      | 17/1.3                         | 17/1.3       |
| `sectionTitle`                                 | Inter 600                                                      | 18/1.3 (20 on the recipe page) | 20/1.3       |
| `cardTitle`                                    | Fraunces 600, opsz 18, clamped to 2 lines                      | 16/1.25 compact                | 19/1.22 full |
| Group label (cook-written)                     | Fraunces italic 400, opsz 18, `inkMuted`, hairline after       | 17/1.2                         | 17/1.2       |
| `body`                                         | Inter 400                                                      | 16/1.5                         | 16/1.5       |
| `readingBody` (steps, description)             | Inter 400                                                      | 16/1.6                         | 17/1.6       |
| `meta`                                         | Inter 500                                                      | 14/1.4                         | 14/1.4       |
| `label` (buttons, tabs, chips)                 | Inter 600 (tabs 500)                                           | 15/1.2                         | 15/1.2       |
| `caption`                                      | Inter 400                                                      | 13/1.4                         | 13/1.4       |
| `overline`                                     | Inter 600, caps, +0.08 em, `inkMuted`                          | 11/1.2                         | 12/1.2       |
| `figureInline`                                 | Inter 600, tabular lining                                      | 16                             | 16           |
| `figureStat` (strip, nutrition)                | Inter 600, tabular lining                                      | 18/1.2                         | 20/1.2       |
| Wordmark                                       | Fraunces italic 500, WONK 1, shipped as one fixed SVG          | 26                             | 26           |

- Weights move in steps of 100 only.
- Fraunces replaces today's Playfair Display.
- Native ships four static Fraunces cuts made with `fontTools.varLib.instancer` (SOFT 100, opsz pinned), about
  140 KB. Web loads one variable latin file.
- **This amends the build spec's "display face for names only"** to include card titles and cook-written group labels.
  It is an owner call.

### Surfaces, shape and elevation

- **Three levels, one meaning each.**
    - Level 0 is the canvas, under one light: the global corner, Home's recent-recipe corner, or the recipe's own light.
    - Level 1 is paper. In light it has a brown contact shadow: `0 1px 1px rgba(64,44,24,.06), 0 6px 14px -8px
rgba(64,44,24,.20)`. In dark it has no shadow and a 1 px inner edge at `rgba(255,236,210,.10)`.
    - Level 2 is glass, only where D12 allows it. The web sidebar is solid paper.
- **The mat** is 6 px of paper around every cover and photo, with concentric radii: compact card 18 = cover 12 + 6,
  and full card 24 = cover 18 + 6. Every cover and photo has a 1 px inner ring: 8% `ink` in light, 16% warm white in
  dark.
- **Radius:** 6 for chips that are not pressable (time, PRO, Draft, Private, Soon, timer). 12 for compact covers and
  inputs. 18 for cards, the strip, accordions and steps. 24 for full cards. 28 for the top of a sheet. Full (pill)
  for pressable controls only.
- **Spacing:** 4, 8, 12, 16, 20, 24, 32, 40. Grid gaps are 12 on phones and 24 on desktop. Sections are 32 apart on
  phones and 40 on desktop.
- **Chips on art** are `paper` with a 1 px ring at 14% `ink` (16% warm white in dark). **Draft** has a 1.5 px dashed
  `lineControl` edge. **PRO** has a solid 1.5 px `ink` edge and tracked caps. No chip is ever filled with an art
  colour.
- **Selected state:** `selectedFill` plus a 1.5 px `actionText` edge on tabs, chips, nav rows and checked boxes. A
  selected chip also shows a check glyph in `actionText`, as the owner ruled. The tab glyph also takes a 40% fill. The selected item is the most defined shape in its row, and it survives greyscale.
- **Checked box:** the same in both themes: `selectedFill`, an `actionText` edge and a tick.
- **Switch** ("Screen on"): off is a `paper` track with a 1.5 px pewter edge (3.62 on paper, 3.16 on canvas) and a
  pewter thumb. On is a `selectedFill` track with a 1.5 px `actionText` edge and an `actionText` thumb (5.05). It
  never becomes a solid seafoam shape.
- **One solid action per region.** A region is navigation or content. On the 1280 recipe page that is the sidebar's
  New recipe (D13) and Edit recipe. The current-step numeral is a state marker, not an action. The sidebar button
  has **no** floating shadow, because it does not float.
- **The current step has two signals:** the recipe's glow and the solid numeral, plus `aria-current="step"`. Every
  step has the same box (`padding 10 14 12 4`, `margin 4 -8 0`). Only the fill changes, so nothing reflows. The
  numeral sits in a 44 px hit area with a pewter ring at rest.
- **Stars:** a partial star is the honey glyph clipped to its fraction, over a pewter outline of the whole star. The
  number ("4.8") always sits next to the stars.
- **Avatar** has its own role pair: `#E8DCC4` with `ink` (11.91:1) in light, `#3A3428` with `ink` (10.50:1) in dark.
- **Targets:** every pressable thing is at least 44 px (iOS, web) or 48 dp (Android).
- **Focus:** a 2 px `actionText` ring with a 2 px canvas gap.
- **Kept affordances:** the chevron on "8 comments" and the globe on "Public" stay. Round 3 had dropped them.

### Iconography

- **Library:** Lucide, as today. The `Icon` component keeps its closed list of meanings.
- **Stroke:** 1.75 px at 24 px (it scales with size), round caps and round joins, on Lucide's 24 grid with 2 px
  padding. The softer stroke matches Fraunces SOFT and the overhead art.
- **Colour:** `ink` at rest. `inkMuted` for inactive tabs. `actionText` only inside a control that is already an
  action.
- **Active state:** the glyph keeps its outline and gains a fill at 40% of its stroke colour. This is d1's "filled
  glyph" and it reads in greyscale. Each tab glyph (Home, Recipes, Discover) needs a closed fill path, drawn once.
- **Study line art** (vessels in a study) uses the same 1.75 px round stroke, so icons and studies are one hand.

### Imagery: the cover generator

`coverSpecFor(recipe) → { spec, confidence }` is one pure function. `RecipeCover` renders a spec with
`react-native-svg` on native and inline SVG on web.

**The picture's life (from d3).**

| Moment                                 | What happens                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First save                             | The seed is stored: family, mirror and slot order. It never changes                                                                                                                     |
| While a draft                          | The foods follow the ingredient lines. "A mark never moves once it is placed." The editor's Photos slot shows the cover drawing itself                                                  |
| First publish, or the end of an import | The spec is **frozen**: `{ specVersion, seed, family, vessel, form, ground, hero, accents, focus }`. A private recipe freezes too                                                       |
| A drawn food leaves the recipe         | Only then does the cover change. The next candidate takes the empty slot in a 400 ms cross-fade. The ground stays frozen. A new hero that fails on the frozen ground goes into a vessel |

**The hero.** Skip about 30 staples (onion, garlic, oil, butter, salt, pepper, flour, sugar, water, stock). Rank the
rest by **share of the recipe's mass**, weighted by a fixed catalog-distinctiveness factor. Without mass data, rank by
distinctiveness alone. When the form is a surface (soup, curry, dal, sauce), the hero colours the surface, and its
mark appears once, large, on the rim.

**Forms and families.** Seven generic forms and one single-dish form. The family "pattern" is renamed **scatter**, so
it no longer shares a name with the form "pattern". The seed picks a family from the ones the form allows:

| Form      | Dishes                                     | Allowed families (weight)                |
| --------- | ------------------------------------------ | ---------------------------------------- |
| `surface` | soups, curries, dal, sauces                | centred 3, cropped 3, pair 2, close-up 2 |
| `noodles` | pasta, ramen, pad thai                     | centred 2, cropped 3, close-up 3, pair 2 |
| `grains`  | rice, risotto, oats                        | centred 3, cropped 3, close-up 2         |
| `stack`   | pancakes, layers, toast                    | centred 3, cropped 3, pair 2             |
| `pieces`  | sheet-pan, roast veg, stir-fry             | centred 2, cropped 3, close-up 3, pair 2 |
| `folded`  | tacos, dumplings, omelettes                | centred 3, cropped 2, pair 3             |
| `pattern` | cookies, biscuits, snacks                  | scatter only                             |
| `whole`   | a whole bird (fish and loaf still to draw) | centred 4, cropped 6                     |

Centred is no longer the default by accident: no form gives it more than 40% of its weight. Nine vessels: plate,
bowl, deep bowl, skillet, tray, jar, board, tin and none. Four hero slots: in the dish, upper left, on the rim, lower
left.

**The checks (from d3), run on every render:**

- The hero against its ground: at least **1.5:1**. Below that, the generator tries the other allowed ground for the
  hue, then a vessel.
- Every other object, **accents and tools included**, against what it sits on: at least **1.3:1**. A failing object
  is swapped for its second material (steel or enamel, beech or walnut), or skipped.
- **Confidence (from d2).** The generator returns `low` in three cases: the hero has no mark, two marks overlap by
  more than 15% of the smaller one's area, or fewer than two marks survive the small level of detail. A `low` result
  renders as a **study**. A weak still life never ships. The study is designed to look intended.

**Small level of detail.** A mark under 4 px radius at its rendered size is dropped below 200 px of cover width. The
hero and the vessel always stay.

**Dark covers.** Every fill is a **swatch key** (`tomato`, `turmeric`, `lentil`), never a hex in the cover. The swatch
table has a light column and a dark column, generated as OKLCH L − 0.08. No CSS `filter` anywhere. The build asserts
that no form **and no cover** carries a literal fill. This fixes round 3's bright pad thai tile (5.7:1 against dark
paper).

**Illustration style sheet** (d1's critique of d3, applied to A's own marks):

- Slightly irregular contours. No perfect circles and no radial symmetry: a lemon slice has uneven segments and a pith
  wider on one side.
- A two-tone shadow under each mark: a tight dark one and a soft wide one.
- A paper grain visible at 160 px, never under text.
- Every mark is judged at the 160 px card, not at the 390 px hero.

**The unfinished study** (a recipe with fewer than two matched foods, or a `low` result):

- A paper ground. The vessel, chosen from the title by a dish lexicon ("bibimbap" → bowl), drawn as a line.
- The same five families as covers, so a day-one library is not a row of centred bowls.
- A glow pool of the recipe's hue at r 110 in a 400 × 300 frame, so most of the ground stays paper.
- **The line is drawn in the recipe's own hue,** at OKLCH L 0.50, C 0.05 in light and L 0.80, C 0.05 in dark, at
  least 1.75 px at any size (`vector-effect: non-scaling-stroke`). In light it measures 4.78 to 4.97 on the pool and
  5.72 to 6.02 on paper. In dark it measures 8.22 to 8.37 on the pool.
- **A colouring-in page (from d3).** Every parsed ingredient that has a mark, matched or not, is drawn as an outline
  in its final slot. Matching a line fills it in. "A mark never moves" holds, because the outline is already in place.
  If the mark lookup cannot work from a parsed name alone, only matched foods are drawn.

| Study line                          | Light                                         | Dark                                          |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------- |
| terra / blush / butter / oat        | `#795D47` / `#7D5951` / `#6F6242` / `#716142` | `#D7B79E` / `#DCB3A9` / `#CBBD9A` / `#CEBB9A` |
| sage / mint / sky / ink             | `#636645` / `#496C5A` / `#416B76` / `#49677E` | `#BEC29D` / `#A2C8B4` / `#9AC6D3` / `#A2C2DC` |
| Japanese / lilac / Korean / Mexican | `#4F6580` / `#705A75` / `#7D5859` / `#7D5A4E` | `#A8C0DE` / `#CCB4D2` / `#DCB1B2` / `#DBB4A6` |

**Coming soon on Home.** The three Soon widgets keep their layout. Their sketches use the study language: a hue line
on a small pool, not a grey wireframe.

**Photos.** A cook's photo gets the mat and the inner ring only. No grain, no grade, no vignette. At upload the app
samples the photo once: its dominant hue sets the recipe's light, and the luminance of its top 96 px sets the status
bar. The 64% scrim is only the fallback for a photo with no sample.

### Motion

| Motion                                                                                                          | Duration and curve                                                 | Plays                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Check toggle (the signature)                                                                                    | 220 ms, `cubic-bezier(.34,1.56,.64,1)`, scale 0.85 → 1.06 → 1      | on tap                                                            |
| Open a recipe: the tapped print grows into the hero, its crop eases from card to close-up (one spec, two crops) | 280 ms, ease-out                                                   | once per open                                                     |
| The recipe's light blooms down the sheet                                                                        | 200 ms, ease-out, starting at 180 ms of the grow                   | once per open. The whole open ends by 380 ms                      |
| Content settles in                                                                                              | opacity and 6 px, 220 ms, ease-out, 30 ms stagger, at most 6 items | first paint of a screen                                           |
| A cover develops                                                                                                | 300 ms fade                                                        | first render of a recipe id per session, never on a recycled cell |
| The glow moves to a new step                                                                                    | 200 ms background colour change. Nothing reflows                   | on tap                                                            |
| Tab pill slides                                                                                                 | critically damped spring (stiffness 400, damping 40)               | on tab change                                                     |
| A new mark in the editor                                                                                        | fade and scale 0.9 → 1, 180 ms                                     | on match                                                          |
| The study's ground fills from paper to its swatch                                                               | 240 ms cross-fade                                                  | at the second match                                               |
| A drawn food leaves a published cover                                                                           | 400 ms cross-fade                                                  | on save                                                           |

- The open is a shared-element transition on native. Android falls back to a 200 ms cross-fade wherever the shared
  element proves fragile.
- **Reduced motion:** every row above becomes an instant change. The open becomes a plain cross-fade.
- The open transition and the bloom are new motions next to the one signature motion. **Owner call.**

### Desktop at 1280 px

- The 12-column recipe page stays: title, facts and actions in columns 1 to 5. The cover or photo card and the panels
  in columns 6 to 12. Then ingredients beside steps.
- The recipe's light spreads across the whole main column, gone by 680 px. Cards and panels stay paper on top of it.
- The cover in the 16:9 photo slot uses the **close-up crop** of the same spec, at radius 18, in its mat.
- The current step's glow works the same far down the page, where the cook's eyes are.
- The sidebar is solid paper (D12). New recipe is solid seafoam with no shadow.

### What makes it exciting

- **A wall of pictures of your own food,** and the wall does not repeat. Five families, four hero slots and real
  leaves make every card a different picture, even at 160 px.
- **Every recipe is its own room.** Open the tomato soup and the page is rosy. Open the ramen and it is cool. Photo
  recipes get this too.
- **The front door changes with the cook's life.** Home's corner takes the light of the first recent recipe. It
  never gets louder.
- **The library ripens.** A new cook's recipes are coloured line drawings that fill in as they match ingredients.
  Matching also feeds nutrition (D20), so the reward sits where writing is dullest.
- **Opening a recipe feels like stepping up to the table:** the print grows, the light comes on.

### What keeps it calm

- One control colour, and one solid action per region. Food colour never touches a control.
- The light is one hue at a fixed lightness, 6.5 to 10 ΔE2000 from plaster. It is a mood, not a colour block.
- The current step has two signals, not five. Nothing reflows as the glow moves.
- Flat, overhead, soft-edged art with a gentle grain. Nothing shiny. Nothing moves after it settles.
- Warm brown-black at night. The dark plate is stepped down, so no bright discs.
- No layout, flow or IA changes.

### Risks, and how A answers them

| Risk                                                                                          | Answer                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The chrome alone is a known look** (cream, a soft serif, one green). d2 and d3 both said it | The freshness moves out of the chrome into two places that are A's own: the light (now on Home too) and the covers. Measured honestly, A depends on the generator. The confidence fallback makes sure its floor is the designed study, never a bad still life |
| **The generator half-works** and makes clip art                                               | Confidence result, study fallback, the illustration style sheet, and the shared gate (section 4): a review of 200 real recipes and a mark-coverage audit                                                                                                      |
| **The mass data is missing**                                                                  | The hero falls back to catalog distinctiveness. Lamb against sumac can then go wrong. The coverage audit measures how often                                                                                                                                   |
| **Real phone photos** (cool casts, flash, busy counters) never appeared on a board            | Photos are not altered, and the mat ties them to the covers. The gate requires one test with real, ordinary photos                                                                                                                                            |
| **The glow is faint on cool hues on a dimmed phone**                                          | The solid numeral carries the state on its own. The gate includes a check at arm's length on a dimmed device                                                                                                                                                  |
| **Shared-element transition on Android**                                                      | The cross-fade is the honest default there                                                                                                                                                                                                                    |
| **Native bundle**                                                                             | Fraunces static cuts add about 140 KB                                                                                                                                                                                                                         |

### Owner calls in A

1. Home's corner lit by the first recent recipe (amends #145 a second time).
2. Card titles and group labels in the serif (amends the build spec's "display face for names only").
3. The dark action as a mint fill with a dark label, one token (round 3 already asked).
4. The open transition and the bloom, next to the one signature motion.
5. `covers.ts` (the six typographic tints) replaced by the generator. The six tints survive in the ground table.

D8, D11, D12, D13 and D15 are kept exactly. A adds no localisation keys.

---

## 3. Proposal B: "Kitchen Press"

**Lead designer: d2.** It builds on d2's round 3 interface layer almost unchanged, and rebuilds the rules that
choose a print's colours, which both critics rejected.

### What B takes from each designer

| From          | What B takes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **d2** (lead) | The idea: every recipe owns a small two-ink print. Four inks, five paper grounds, a 2.5 px registration offset, and **named overlap colours** (aubergine, umber, garnet, petrol, indigo, moss). Collections as overprints. Hand-cut plate edges. The interface: warm paper, flat cards with no shadows, one green that means "press", only pressable things as pills. Text never on art. Gold out of the interface. Bricolage Grotesque held narrow, with Inter. The publish stamp. Bipolar dark grain              |
| **d1**        | **Plate A's ink comes from the food**, and a fifth ink, ochre, for bread, grain and dairy. The print is decided once and stored, never by the layout. Calmer hero rules (at most 3 clusters, 35% empty, halftone on plate A only). A warm parchment night ground instead of olive. PRO as an outlined chip. Glass at 96% `sheet` with the chip ring. The **registration mark** as a print's identity on a photo recipe                                                                                              |
| **d3**        | The picture's life (seed at first save, follows the draft, freezes at first publish). **The hero ladder**: a food the title names comes first, so it needs no weight data. The rule that a ground never matches its food's ink family. Prints **rendered to images at publish** for lists. A `well` disc for the resting step numeral. The stamp tied to the publish event, not to page entry. Stating ground contrast against `sheet` as well as `paper`. Gold at 10% less chroma. Pinned tests on every thin pass |

**What B deliberately does not take:** d3's key-coloured title, and A's recipe light. B keeps every page neutral.
That is the line between the two proposals.

### The concept

Most recipes in Commise have no photo. In Kitchen Press **every recipe owns a small print of its own foods**, pulled
in two inks on a coloured paper. The second plate sits 2.5 px out of register. Where the inks cross, a **third
colour** appears, and it has a name: plum, umber, garnet, petrol, indigo, moss, or rust.

- A library looks like a shelf of prints the cook made.
- A collection looks like its recipes printed over each other.
- A recipe with a photo keeps its print too. The print sits behind the photo. A small registration mark beside the
  overline says "this one has a print".

Everything around the prints is quiet. Flat paper. No shadows on content. One green that means "you can press this".
Wood-type headings. The screens, flows and layouts do not change. Only the material does.

### Palette: interface roles

| Role                    | Light                           | Dark                            | Job                                                                                         |
| ----------------------- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `paper`                 | `#F5F0E6`                       | `#151B1A`                       | the canvas, under the wash                                                                  |
| wash (issue #145, kept) | `#F8F1E2` → `paper` → `#EEF0E8` | `#1A201E` → `paper` → `#121816` | window light: warm at the top, a trace of sage at the foot                                  |
| `sheet`                 | `#FFFCF6`                       | `#1D2423`                       | cards, the ticket, the current step, every chip on art, the sidebar, the selected segment   |
| `well`                  | `#EFE8DB`                       | `#262E2D`                       | the timer, the switch track, the "for 4" chip, the Soon tag, the resting step-numeral disc  |
| `ink`                   | `#1C2422`                       | `#EFE8DA`                       | text, the active tab glyph, the current step-numeral disc                                   |
| `inkMuted` (D11 slate)  | `#6B645C`                       | `#A8A193`                       | secondary text, inactive tabs, resting numerals                                             |
| `edge` (D11 pewter)     | `#8A847C`                       | `#6E7A72`                       | every control edge, the ticket's dashed rules, the Draft chip's dashed edge                 |
| `line`                  | `#E3DACB`                       | `#2E3736`                       | decorative hairlines only                                                                   |
| `action`                | `#2A6B65`                       | `#7CC8BE`                       | the one colour that means "press". Label `#FFFFFF` in light, `#0F1A17` in dark              |
| `actionTint`            | `#DDEBE6`                       | `#1F3330`                       | the selected filter chip (always with a check and a 1.5 px `action` ring), the Public badge |
| `danger`                | `#B1442B`                       | `#FF8C6E`                       | destructive text                                                                            |
| `honey`                 | `#A86A12`                       | `#E2B04A`                       | stars and difficulty bars. Graphics only, never text                                        |
| `glass`                 | `sheet` at 96%                  | `sheet` at 94%                  | D12 surfaces, with a 1 px ring at 14% `ink` (16% in dark)                                   |

### Contrast, interface pairs

| Pair                                                                                                | Light                 | Dark                  | Kind             |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------- | ---------------- |
| `ink` on `paper` / `sheet` / `well`                                                                 | 13.96 / 15.48 / 13.01 | 14.31 / 12.96 / 11.40 | text             |
| `ink` on wash top / foot                                                                            | 14.09 / 13.79         | 13.57 / 14.75         | text             |
| `inkMuted` on `paper` / `sheet` / `well`                                                            | 5.13 / 5.69 / 4.78    | 6.80 / 6.16 / 5.42    | text             |
| `inkMuted` on wash top / foot                                                                       | 5.18 / 5.07           | 6.45 / 7.01           | text             |
| `edge` on `paper` / `sheet`                                                                         | 3.26 / 3.62           | 3.90 / 3.53           | control          |
| `edge` on `well` (switch thumb at rest)                                                             | **3.04, pinned**      | **3.10, pinned**      | control          |
| Label on `action` (buttons, the FAB, a checked box)                                                 | 6.20                  | 9.20                  | text             |
| `action` text or ring on `paper` / `sheet` / `well`                                                 | 5.45 / 6.05 / 5.09    | 9.03 / 8.17 / 7.19    | text and control |
| `action` ring on `actionTint`                                                                       | 5.05                  | 6.90                  | control          |
| `sheet` thumb on the `action` track (switch on)                                                     | 6.05                  | 8.17                  | control          |
| `ink` on `actionTint`                                                                               | 12.91                 | 10.94                 | text             |
| Current numeral: `paper` on the `ink` disc                                                          | 13.96                 | 14.31                 | text             |
| PRO: `ink` text and 1.5 px `ink` ring on `sheet`                                                    | 15.48                 | 12.96                 | text and edge    |
| `danger` on `paper` / `sheet`                                                                       | 4.96 / 5.50           | 7.67 / 6.94           | text             |
| `honey` on `paper` / `sheet`                                                                        | 3.90 / 4.33           | 8.76 / 7.93           | graphic          |
| Inactive tab on glass, worst case (`ink` under it)                                                  | 5.27 (96%)            | 5.24 (94%)            | text             |
| Status bar on a print hero, worst ground                                                            | `ink` 10.43 (gold)    | `#EFE8DA` 7.68 (gold) | text             |
| Status bar on a photo hero: white on the scrim (65% `ink`, flat over 64 px) over a pure-white plate | 4.98                  | 4.98                  | text             |

- **The thin passes get pinned token tests:** `edge` on `well` (3.04 and 3.10), moss against `ink` (1.96 against a
  1.95 floor), and the inactive tab on glass.
- **The glass figure differs from d2's.** d2 quoted 4.59 for light glass at 94%. Composited in sRGB over `ink`, the
  session measures 5.07 at 94% and 5.27 at 96%. Both pass. B uses 96% (d1's suggestion), which also makes the hero
  discs read on the palest grounds.
- **One rounding rule.** Every ratio is rounded half-up to two places by the generator. The document and the token
  test then cannot disagree (d1 found 4.58 and 4.59 for one pair).

### Palette: the press

All press tokens live in a closed `press.*` family. Only the print renderer reads it. The role guard fails any other
read. Prints are `aria-hidden`.

**Five inks.** Tomato, sea, herb and beet are d2's. **Ochre is new.**

**Two pairing rules.** They make ochre possible:

- **Ochre's only partner is tomato.** Their overlap is **rust**: the crust on bread, the char on a pancake. Ochre
  cannot cross sea, herb or beet. The session searched for those three overlaps under all of d2's rules. Ochre × sea
  had no solution at all: every candidate fell on the green that means "press" or on petrol and moss. Ochre × beet
  and ochre × herb passed only as a pure crimson and a pure green, which read as candy, not as print.
- **A ground never matches its ink's family** (from d3): ochre never prints on gold, in either theme. Ochre on gold
  measures 2.19, below the ink band.

**Light** (grounds: cream `#FCEBC7`, blush `#FBD3CE`, sage `#CDEFCE`, mist `#CCE3F8`, gold `#F3CD7A`)

| Token                     | Hex           | on cream | blush | sage | mist | gold  |
| ------------------------- | ------------- | -------- | ----- | ---- | ---- | ----- |
| ink: tomato               | `#E4543A`     | 3.17     | 2.72  | 2.99 | 2.83 | 2.46  |
| ink: sea                  | `#4A74B0`     | 4.04     | 3.47  | 3.81 | 3.60 | 3.13  |
| ink: herb                 | `#57873A`     | 3.62     | 3.10  | 3.41 | 3.23 | 2.80  |
| ink: beet                 | `#AF5B8D`     | 3.79     | 3.25  | 3.58 | 3.38 | 2.94  |
| **ink: ochre**            | **`#BF801E`** | 2.82     | 2.42  | 2.66 | 2.52 | never |
| aubergine (tomato × sea)  | `#853C70`     | 6.20     | 5.32  | 5.85 | 5.53 | 4.80  |
| umber (tomato × herb)     | `#7D4F12`     | 5.95     | 5.11  | 5.61 | 5.31 | 4.61  |
| garnet (tomato × beet)    | `#7F3A3E`     | 6.93     | 5.94  | 6.53 | 6.17 | 5.36  |
| petrol (sea × herb)       | `#205185`     | 6.93     | 5.94  | 6.53 | 6.17 | 5.36  |
| indigo (sea × beet)       | `#614C87`     | 6.17     | 5.29  | 5.82 | 5.50 | 4.78  |
| moss (herb × beet)        | `#4A5507`     | 6.88     | 5.90  | 6.49 | 6.13 | 5.33  |
| **rust (ochre × tomato)** | **`#AB2B08`** | 5.79     | 4.97  | 5.46 | 5.16 | never |

**Dark** (five card stocks under a lamp). Two grounds change, as d1 asked:

- cream at night is now **parchment `#4D3D21`** (OKLCH 0.37, 0.048, 80°), not army olive.
- gold at night is now **sienna `#7E2B16`** (OKLCH 0.41, 0.12, 35°). It had to move redder, or parchment and the
  old amber read as one colour.

| Token                      | Hex           | on parchment `#4D3D21` | brick rose `#4D2525` | bottle `#06372A` | ink blue `#1A314E` | sienna `#7E2B16` |
| -------------------------- | ------------- | ---------------------- | -------------------- | ---------------- | ------------------ | ---------------- |
| ink: tomato                | `#D0654D`     | 2.82                   | 3.52                 | 3.56             | 3.55               | 2.52             |
| ink: sea                   | `#6389C1`     | 2.93                   | 3.66                 | 3.70             | 3.69               | 2.62             |
| ink: herb                  | `#67934D`     | 2.92                   | 3.65                 | 3.69             | 3.68               | 2.61             |
| ink: beet                  | `#B86D98`     | 2.83                   | 3.53                 | 3.58             | 3.56               | 2.53             |
| **ink: ochre**             | **`#A77112`** | 2.50                   | 3.12                 | 3.16             | 3.15               | never            |
| aubergine                  | `#E29AC4`     | 4.81                   | 6.01                 | 6.08             | 6.06               | 4.30             |
| umber                      | `#DBA76F`     | 4.87                   | 6.08                 | 6.15             | 6.13               | 4.35             |
| garnet                     | `#DF918E`     | 4.28                   | 5.34                 | 5.40             | 5.38               | 3.82             |
| petrol                     | `#81ACE5`     | 4.47                   | 5.58                 | 5.65             | 5.63               | 4.00             |
| indigo                     | `#B9A2E3`     | 4.66                   | 5.81                 | 5.88             | 5.86               | 4.16             |
| moss                       | `#A1AF68`     | 4.41                   | 5.51                 | 5.57             | 5.55               | 3.94             |
| **crust (ochre × tomato)** | **`#CE9E12`** | 4.25                   | 5.30                 | 5.37             | 5.35               | never            |

The session re-checked every band.

- Inks sit at 2.42 to 4.04:1 on the light grounds they print on, and 2.50 to 3.70:1 on the dark ones.
- Overlaps sit at 4.61 to 6.93:1 in light and 3.82 to 6.15:1 in dark.
- Every light overlap is darker than both its parents, and every dark one is lighter. Each is at least 1.5:1 from
  each parent in luminance and 0.11 from each parent in OKLab. Rust is 2.05 and 1.83 from ochre and tomato. Night crust
  is 1.70 and 1.51.
- No overlap reads as black: every light overlap is at least 1.95:1 against `ink`. Rust is 2.33.
- The seven overlaps stay learnable: at least 0.073 OKLab apart in dark, 0.078 in light. Rust is 0.095 from its
  nearest neighbour.
- Every ink is at least 0.126 OKLab from `action`. Ochre is 0.24 (light) and 0.25 (dark). Petrol and moss are still
  0.11 from `action`. That is stated, not hidden. If a cook reads "press" inside a cover, moss is the first token
  to move.
- **Three near-collisions with interface colours,** all inside the `press.*` fence, so none blocks. Rust is 0.05
  OKLab from `danger`. Night crust is 0.06 from dark `honey`. Light ochre is 0.07 from `honey`. Danger and honey
  never appear inside a print, and prints never appear on a control.
- Dark grounds against dark `paper`: 1.32 to 1.86. **Against `sheet`** (the desktop card), they are only 1.19 to
  1.69, so the tile edge there holds by hue, not by value. This is decorative and not a WCAG failure, but it is now
  stated.
- Ground against ground: at least 0.07 OKLab apart in dark (parchment against brick rose is the closest pair).

**Two critic requests on the press colours, each decided by a measurement:**

- **Night aubergine and garnet at 25% less chroma** (d3): **not taken.** It pulls them to 0.065 apart, under the
  0.073 that keeps overlaps learnable. Even 15% less fails. So they stay as d2 set them. The worry ("bubblegum
  chicken knees") is real. It is a device check in Gate 4. If the night aubergine reads as candy on a bird, sea
  leaves poultry's allowed plate B inks.
- **Gold at 10% less chroma** (d3): **taken.** Gold moves from `#F7CC6E` to `#F3CD7A` at the same OKLCH lightness.
  Every ink and overlap ratio on gold is unchanged to two places (tomato 2.46, umber 4.61). The `ink` status
  text stays 10.43. Gold is still 0.10 from cream. It no longer pulls the eye first in the Home grid.

### Type

| Role (today's name)                  | Face                                                                 | Phone                                    | Desktop |
| ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------- | ------- |
| `largeTitle`                         | Bricolage Grotesque, wdth 84, 650, −0.018 em, balanced wrap          | 36/1.02. Above 18 characters of name: 30 | 56/1.0  |
| Recipe title                         | Bricolage, wdth 86, 650, −0.018 em                                   | 32/1.05                                  | 44/1.04 |
| `barTitle`                           | Bricolage, wdth 90, 650                                              | 17/1.2                                   | 17/1.2  |
| `sectionTitle`                       | Bricolage, wdth 90, 650                                              | 21/1.2                                   | 24/1.2  |
| `cardTitle`                          | Bricolage, wdth 88, 650, clamped to 2 lines                          | 16/1.25                                  | 19/1.2  |
| `body`                               | Inter 400, `cv11`                                                    | 16/1.5                                   | 16/1.5  |
| `readingBody` (steps, description)   | Inter 400                                                            | 17/1.55                                  | 17/1.6  |
| Ingredient line                      | Inter 16. Amount 600 tabular, food 400, preparation `inkMuted` (D21) | 16/1.5                                   | 16/1.5  |
| `meta`                               | Inter 500                                                            | 14/1.4                                   | 14/1.4  |
| `label`                              | Inter 600                                                            | 15/1.2                                   | 15/1.2  |
| `caption`                            | Inter 400                                                            | 13/1.4                                   | 13/1.4  |
| `overline`, group names              | Inter 600, caps, +0.08 em                                            | 12/1.2                                   | 12/1.2  |
| `figureInline`                       | Inter 600, tabular lining                                            | 16                                       | 16      |
| `figureStat` (the ticket, nutrition) | Inter 600, tabular lining                                            | 18/1.2                                   | 20/1.2  |
| Step numeral                         | Inter 600, tabular                                                   | 17                                       | 17      |

- **Weight 650, not 700,** and tracking −0.018 em, not −0.026 (d3's note). At 700 the 32 px title became a dense
  black block in light and a bright slab in dark.
- Bricolage replaces today's Playfair Display.
- **Native:** three static Bricolage instances (84/650 display, 90/650 section, 88/650 card), so React Native never
  falls back to the default width.
- The 30-character name ("Anastasia Alexandrovna Petrova") wraps cleanly in two lines at 30 px.
- **This amends the build spec's "display face for names only"** much further than A: section headings and page
  titles become display type. It is an owner call.

### Surfaces, shape and elevation

- **Flat paper. Content has no shadows.** Cards are `sheet` on the washed `paper` with a 1 px `line` inset. Only
  floating things get a shadow and glass: the FAB, the tab bar and the hero discs. Shadow: `0 2px 4px
rgba(28,36,34,.10), 0 10px 24px -10px rgba(28,36,34,.28)`.
- **Radius:** covers 14, cards and widgets 20, the ticket and accordions 16, inputs 12, chips 6. Every pressable
  control is a pill or a circle.
- **Spacing:** 4, 8, 12, 16, 24, 32, 48. Grid gaps are 12 on phones and 24 on desktop. Sections are 32 apart on
  phones and 40 on desktop.
- **The ticket.** Total, Prep and Difficulty sit on `sheet`, split by pewter dashed rules. It wraps at 320 px.
- **Chips.** A chip's fill is never a ground token. Every chip on art is `sheet` with a 14% `ink` ring (16% in
  dark). Draft is a `sheet` chip with a 1.5 px **dashed** `edge` ("not finished"). PRO is a `sheet` chip with a
  1.5 px **solid** `ink` ring and tracked caps ("premium"). "for 4" is a `well` chip. In dark, PRO is no longer the
  brightest thing on the card.
- **Active states, one grammar.** The tab, the sidebar row, the selected segment and the selected filter chip all use
  `action` as a mark (a 3 px bar or a 1.5 px ring), bold `ink` text, and a filled glyph or a check.
- **Step numerals.** At rest: an `inkMuted` numeral on a 32 px `well` disc, inside a 44 px target, with no ring.
  The numeral text (4.78) identifies the control, and the disc tells the cook it can be pressed. The current step: a
  `paper` numeral on an `ink` disc, a `sheet` ground and a 3 px `action` rule. The honest exceptions to "only
  pressable things are pills" are written down: text links, tabs, sidebar rows and checkboxes.
- **Today** in the week widget is a `sheet` cell with a 1.5 px `action` ring (5.09 against `well`).
- **Focus:** a 2 px `action` ring with a 2 px gap.

### Iconography

- **Library:** Lucide, at its native 2 px stroke on the 24 grid, round caps and joins. The press language lives in
  the art, so icons stay plain and sturdy next to wood type.
- **Active state is a true filled glyph,** drawn once per meaning: Home, Recipes (a closed book with a spine, not a
  filled first path that renders as a square), Discover (a filled compass), Collections. d2 and d3 both shipped a
  broken or missing filled glyph.
- **Colour:** `ink` at rest, `inkMuted` inactive, `action` only inside an action.

### Imagery: the print

**1. What is drawn: the hero ladder (from d3, with d1's amendment).**

- First, a food the title names. Among several, **the last one wins**, unless it is a staple: English titles put the
  dish noun last ("Lemon and thyme roast **chicken**"). So the chicken is plate A and the lemon is a small title
  accent.
- Then produce, citrus and spice. Then herbs. Then proteins and the main carb. Staples last (flour, butter, oil,
  onion, garlic), unless the title names them ("French onion soup").
- Plate B is the next food on the ladder from a different motif category.
- The ladder needs no weight data. That removes the riskiest data dependency in round 3.

**2. The motif comes from the food's category** (d2's table).

| Category             | Motif                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| grain and flour      | stacked slabs, or a dimpled slab for bread                                       |
| pancakes (new)       | a short stack seen from the side, with one dollop. Slabs read as bacon at 171 px |
| soft dairy           | dollops                                                                          |
| poultry              | a roast bird, or thighs                                                          |
| meat                 | a tied joint                                                                     |
| fish                 | a scored fillet                                                                  |
| citrus               | a wheel                                                                          |
| fruiting veg         | a halved fruit with its seeds                                                    |
| alliums              | rings                                                                            |
| leafy greens / herbs | broad leaves / a sprig                                                           |
| tubers               | pebbles                                                                          |
| noodles              | loops                                                                            |

**3. Plate A's ink comes from the food (from d1).**

| Plate A category                                                                | Allowed plate A inks              | Plate B                    |
| ------------------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| meat, poultry, fruiting veg, tomato, berries                                    | tomato, beet                      | any other ink except ochre |
| salmon, trout                                                                   | tomato                            | sea, herb or beet          |
| white fish, blue foods                                                          | sea                               | tomato, herb or beet       |
| leafy greens, herbs, green veg, alliums                                         | herb                              | tomato, sea or beet        |
| bread, grain, flour, pancakes, pastry, tubers, dairy, eggs, corn, yellow citrus | **ochre**                         | **tomato only** (rust)     |
| no category                                                                     | tomato, herb or beet, by the seed | any other ink except ochre |

Sea is never plate A for meat, bread, grain or dairy. There is no blue pork and no blue bread.

**4. The seed picks the rest, once, at first publish.** Among the allowed choices, the seed picks plate A's ink,
plate B's ink and the ground. It prefers the pair and the ground **least used in the cook's last eight published
recipes**. The default sort is recency, so a new card lands next to exactly those recipes. **There is no layout-time
neighbour rule.** Two neighbours share a pair about one time in six in other sorts. That is accepted. A recipe's
print is one stored fact, the same on Home, Recipes, a collection, Discover, the phone and the laptop.

**5. The picture's life.** The seed is stored at first save. While a draft, the plates follow the ladder quietly, with
no motion. At first publish the print is frozen: inks, ground, rotation (±16°), scale, crop and paint order. After
that, only plate A's food leaving the recipe re-cuts the print. Swapping butter for oil changes nothing.

**6. The craft.**

- **Hand-cut edges:** every plate outline is moved along its normal by a seeded wobble of about 1.2 rendered px.
- **Registration:** plate B is offset 2.5 px across and 1.25 px down, in rendered pixels, at every size.
- **Grain:** one PNG tile per theme. Light: sparse dark tooth at 26%. Dark: bipolar tooth at 20%, as many specks
  darker than the ground as lighter, so it reads as paper on OLED. Never under text.
- **Halftone:** on the hero and collection covers only. Dots about 10 px apart, **clipped to the shadow side of plate
  A**. Where dots cross plate A they take the overlap colour.

**7. Calm composition rules (from d1 and d3).** Plate B is at most **three clusters**. At least **35% of the ground
stays empty**. The top 56 px of a phone hero stays empty, under the status bar. The card prints already obey this.
The round 3 hero, with fifteen pebbles across the whole frame, did not.

**8. How prints ship (from d3).** The geometry step (wobble, overlaps, halftone) runs on the server at first publish.

- **In lists,** each print is a pre-rendered WebP at card size, per theme, with the grain baked in. A print card and
  a photo card are then the same component. This removes the native risk of about 50,000 path points in a scrolling
  list.
- **On the recipe page,** the hero is the stored vector, so the publish stamp can move plate B and the desktop crop
  can be cut freshly.

**9. Desktop at 1280 px.** The print fills the 16:9 photo card in columns 6 to 12, at radius 20. The generator cuts a
third crop for 16:9: plate A in the middle 60% of the width, plate B's clusters inside the middle 80%. No sky band is
needed (there is no status bar). The hero discs are glass, as on the phone.

**10. Photo recipes.** A recipe with a photo still owns a frozen print. Its identity shows in two places:

- **The registration mark** (from d1) beside the overline: two overlapping 12 px discs in plate A and plate B, offset
  2.5 px, with the overlap lens in its overlap ink. It is the brand mark at 12 px. It shows **only on photo recipes**.
  On a print recipe it repeats the hero 300 px below, so it is not drawn there (d3).
- **Collection covers:** a photo recipe gives its hidden print to the overprint.

**11. Photos themselves** are never recoloured. They get the 14 px radius and the 1 px `line` inset. At card size
only, they carry the grain tile at 60% of print strength, so prints and photos read as one set. The recipe page and
the full-size viewer show the photo with no grain. The owner can switch the card grain off with no other change.

**12. Collections are overprints.** The cover is plate A of the first three recipes, each in its own ink, with every
pairwise overlap. Paint order: plates in recipe order, then overlaps A × B, A × C, B × C, last painted wins. There is
never a three-ink token. Where ochre crosses a plate other than tomato, the later plate **knocks out** the earlier
one: no overlap colour is drawn. One plate means one recipe. Three plates mean three or more.

**13. Fallbacks.** No category on the hero: a cuisine print. Soups and stews with no match: a bowl, named as a vessel.
Last: a disc-and-rule print keyed only to the seed. Each fallback is temporary until the recipe has a hero.

### Motion

| Motion                       | Duration and curve                                                                                                          | Plays                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Check toggle (the signature) | 220 ms, `cubic-bezier(.34,1.56,.64,1)`, scale 0.85 → 1.06 → 1. The box fills with `action`, the strike draws in `inkMuted`  | on tap                                                                               |
| **The stamp**                | Plate B starts 6 px out and lands at 2.5 px, 220 ms, the same curve. On a photo recipe the registration mark stamps instead | **once**, on the recipe page that the publish event lands on. Never on a later visit |
| Title condense               | the platform cross-fade, 200 ms                                                                                             | on scroll                                                                            |
| Everything else              | instant                                                                                                                     |                                                                                      |

- Nothing moves on first view, on scroll or on refresh.
- **Reduced motion:** the stamp and the check show their end state at once. The grain never moves.
- The stamp is a second motion next to the one signature motion. **Owner call.** With a 'no', only the check moves.
  Nothing else depends on the stamp.

### What makes it exciting

- **The library is art, and the art is the cook's own food.** Every new recipe adds a print nobody else has.
- **The recipe page opens on a big hand-cut print:** a roast bird in tomato on cream, its lemon in ochre, rust where
  they cross, juices in halftone under the bird.
- **Seven named overlap colours.** A cook starts to know them: plum is tomato and sea, rust is the crust.
- **At night the shelf is five card stocks under a lamp:** parchment, brick rose, bottle green, ink blue and sienna.
- **Collections are the surprise:** their recipes printed over each other. No other recipe app can make that image.

### What keeps it calm

- One colour and one shape mean "press". The cook never has to ask what is clickable.
- Colour is fenced inside the prints and one 12 px mark. It never touches a control, a chip or a status. The page
  itself never changes colour.
- Each print has two inks, within a fixed band, with at least 35% empty paper. Overlaps are deep, not black. Night
  inks are mid-tones.
- Content has no shadows, no gradients and no blend modes.
- The reading column is quiet: grey numerals on soft discs, and one dark disc for the step being cooked.
- There is one signature motion and one stamp, and the stamp plays only after the cook acts.

### Risks, and how B answers them

| Risk                                                                                                                              | Answer                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Colour against appetite** (the worst round 3 defect)                                                                            | Plate A's ink by food category, with ochre for bread, grain and dairy. The gate checks 200 real recipes for any print a cook reads as the wrong food    |
| **A baker's library is all ochre and tomato**                                                                                     | It is the cost of the pairing rule. Variety comes from four grounds, rotation, crop and the motif. Stated, not hidden                                   |
| **The print ignores the layout, so neighbours sometimes match**                                                                   | Accepted. A stable picture beats an even spread. The least-used choice at publish keeps the default view varied                                         |
| **Photo recipes lose most of the identity**                                                                                       | The registration mark and the collection overprint carry it. This is the weakest point of B, and the clearest reason to prefer A for a photo-heavy cook |
| **Petrol and moss sit 0.11 from `action`**                                                                                        | Small areas inside a boxed cover. Moss is the first token to move                                                                                       |
| **Night overlaps glow** (aubergine on a bird)                                                                                     | Category rules keep sea off poultry's plate A. A device check at low brightness is in the gate                                                          |
| **Native performance**                                                                                                            | Lists show pre-rendered images. Only the hero is vector                                                                                                 |
| **Missing frames:** light desktop with mixed photos and prints, a desktop print hero, Discover, Collections at 1280, Home in dark | All are frames in the gate (section 4). Light desktop and the desktop hero block the web build                                                          |
| **Data:** a category on every catalog food                                                                                        | Fallback chain: cuisine print, bowl, seeded disc. The coverage audit measures how often it fires                                                        |
| **Bricolage on native**                                                                                                           | Three static instances, measured in the gate                                                                                                            |

### Owner calls in B

1. **D13:** `action` is `#2A6B65` (white label 6.20:1) instead of seafoam `#31807A` (4.67:1). If the answer is no,
   the cost is two tokens: seafoam for fills, `#2A6B65` kept for text and rings.
2. **The palette:** coral, sky and warning become press inks in a closed `press.*` family. Herb, beet and ochre are
   new.
3. **Display type** for page titles, section headings and card titles (amends the build spec).
4. **The stamp** as a second motion.
5. **Grain on photo cards** (cards only, never the recipe page).
6. `covers.ts` replaced by prints.

D8, D11, D12 and D15 are kept. Issue #145 (the canvas wash) is kept unchanged. B adds no localisation keys.

---

## 4. Gates before build (both proposals)

The workshop ends here. These are not a fourth round. Each one is a check the build plan must pass **before** the
chosen proposal's slices start. Each gate names who runs it and what passes.

### Gate 1: the coverage audit (shared, and it decides most of the risk)

Take the top 300 matched catalog foods by recipe count, and the 1919 cookbook corpus already in the repo. Run the
chosen generator's hero rule over every recipe. Report:

| Measure                                                                         | Pass                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Share of published recipes that get a hero with a mark or motif                 | at least 80%                                            |
| Distinct heroes per 100 recipes                                                 | report it. Below 10 is a fail                           |
| Share of the most common hero                                                   | at most 8%                                              |
| Share of each ground (A: cover ground. B: print ground)                         | no ground above 25%                                     |
| Share that falls back (A: study by confidence. B: cuisine, bowl or seeded disc) | report it. Above 30% means the library work comes first |

The beige everyday foods (lentils, chickpeas, rice, noodles) go first in the mark library. They are the faces of many
dishes and the hardest to draw.

### Gate 2: a review of 200 real recipes

Render 200 real recipes at card size, in both themes. Three people look at the wall.

- **A:** no cover reads as clip art. Low-confidence covers become studies. Count how many.
- **B:** no print reads as the wrong food (blue meat, bacon pancakes, pink chicken). Count every case.

### Gate 3: real photos

Build one mixed grid with **real, ordinary phone photos** (cool casts, flash, busy counters) next to generated
pictures, in light and dark. No board in three rounds had a real photo on it.

### Gate 4: devices

- A dimmed phone at arm's length, in a kitchen: A's glow on a cool hue, and B's night overlaps.
- A low-end Android phone scrolling a 50-recipe library: A's SVG covers, B's pre-rendered cards.
- The native fonts in place: Fraunces static cuts (A) or Bricolage static instances (B).
- A's shared-element open on Android. B's dashed Draft chip on Android.

### Gate 5: frames owed

| A                                                                  | B                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Recipes at 390 px, a day-one library: eight studies and two covers | Recipes at 1280 px **in light**, with mixed photos and prints (blocks the web build) |
| Discover at 390 px with strangers' covers at small size            | The desktop recipe page with a print hero (blocks the web build)                     |
| The editor's Photos slot with the cover drawing itself             | Discover at 390 px                                                                   |
| Two warm-hue recipe pages: focaccia and a curry                    | Collections at 1280 px with three crossing plates                                    |
| Home in dark                                                       | Home in dark, and 320 px                                                             |

### Gate 6: process (from the repo's rules)

- `staff-ux-engineer` SPECIFY on the chosen proposal, with every state (empty, loading, error, offline, first-run),
  then EVALUATE with a WCAG 2.2 AA audit and a design-to-build parity check.
- `staff-architect` on the generator's boundary: where the spec is computed, stored and frozen.
- Every thin pass in this brief becomes a pinned token test.

---

## 5. Comparison

|                         | **A: Still Life, Lit** (lead d1)                                                        | **B: Kitchen Press** (lead d2)                                          |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The idea in one line    | The food's own colour, drawn as a still life, lights the room                           | The food as a small two-ink print on coloured paper                     |
| Where colour lives      | In covers **and** in a soft light on the page, on Home and in the current step          | Only inside prints, and one 12 px mark on photo recipes                 |
| Imagery                 | Overhead still life of real-coloured foods in a paper mat                               | Two plates, a named third colour where they cross, hand-cut edges       |
| Day one, no matches yet | A coloured line study that fills in like a colouring book                               | A cuisine print, a bowl, or a seeded disc                               |
| Photo recipes           | Full benefit: the light comes from the photo                                            | Weak: a small mark and the collection cover                             |
| Collections             | Covers in mats                                                                          | Overprints, the strongest single image in the workshop                  |
| Type                    | Fraunces (names, card titles) and Inter                                                 | Bricolage Grotesque narrow (all display type) and Inter                 |
| Chrome                  | Plaster, paper, soft contact shadow, seafoam                                            | Flat warm paper, no content shadows, deep green                         |
| Night                   | Warm brown-black, lit by the recipe's dark hue                                          | Green-black, five coloured card stocks                                  |
| Freshness               | Comes from the light and the covers. The chrome alone is a familiar look                | Fresh at first sight. Nothing else looks like it                        |
| Calm                    | Calm by construction: fixed lightness, every pair passes on every hue                   | Calm by fencing: two inks, 35% empty paper, flat everything             |
| Appetite                | Safe: foods are their own colour                                                        | Managed: category rules and a fifth ink                                 |
| Data needs              | Mass per line (falls back to distinctiveness), a dish lexicon, a photo sample at upload | A category per food. The ladder needs no weights                        |
| Art pipeline            | About 35 marks, a swatch table with a dark column, SVG on device                        | Motif library, a server geometry step, raster cards plus a vector hero  |
| Owner calls             | 5. One touches D13, in dark only. None touches the palette                              | 6, including D13 and a new `press.*` palette                            |
| Biggest risk            | The generator half-works, and the familiar chrome is what is left                       | A wrong-colour food on the shelf, and a photo-heavy cook loses the idea |

---

## 6. The designers' joint recommendation

**Choose A, "Still Life, Lit".** All three designers sign it. d2 adds a note below.

**Why A.**

1. **It works for every cook.** A cook who photographs everything still gets the idea in full, because the light
   comes from the photo. In B, that cook keeps only a 12 px mark. A long-time cook's library is mostly photos.
2. **It cannot make food look wrong.** The colours in A are the food's own colours. B needs a category table, a fifth
   ink and two pairing rules to stop blue pork, and Gate 2 still has to prove it worked.
3. **Its worst case is designed.** An unsure generator gives the cook a coloured line study. It looks intended,
   and it fills in as they cook. B's fallbacks look finished, but they say nothing about the food.
4. **It is calm by construction.** The light sits at one fixed lightness, so every text and control pair passes on
   every hue without a guard. That is the strongest colour engineering in the workshop, and two critics re-derived it.
5. **It asks less of the owner.** It keeps the palette, and D13 in light. It changes only the dark action. Its owner calls are small and each one can be
   declined on its own.

**What A must not lose in the build.** The freshness of A lives in the covers and the light. If either is cut for
schedule, what remains is a well-made cream app with a soft serif: the "meh" this workshop exists to fix. So the
generator, the study, the recipe's light and Home's recent-recipe corner ship together, or A is not shipped.

**When to switch to B.** Gates 1 and 2 can show that A's still lifes fall below the bar: more than 30% of
recipes become studies, or the wall reads as clip art. In that case, choose B. A print's abstraction forgives simple
marks. A still life does not hide them.

**d2's note, recorded as written:** "B is the fresher answer, and I stand by it as the one people will remember. Some
owners want, above all, to look like nothing else on the shelf. Some libraries are mostly recipes with no photo. For
that owner and those cooks, B is the better bet. A is the safer and more complete system. That is why I sign the recommendation."

**d3's note:** "My plate is not a proposal on its own any more, and that is right. Its best rules are in the
finals. The picture's life is in both. The contrast checks on every object are in A. The ground that never matches
its food is in B. Whichever the owner picks, some of my plate goes with it."
