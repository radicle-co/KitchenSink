# Proposal B, "Kitchen Press": the spec as built

⛔ **Design proposal. Not production code.** This spec goes with the mockup
[`proposalB.html`](proposalB.html). It follows the Proposal B section of [`brief.md`](brief.md). Where the build
had to decide something the brief leaves open, this file says so under "Decisions the brief left open".

- **Lead:** Designer 2.
- **Not user evidence.** Everything here is design judgement. No cook has seen it.

## The idea

Most recipes in Commise have no photo. In Kitchen Press, every recipe owns a small print of its own foods. The print
is pulled in two inks on coloured paper. The second plate sits 2.5 px out of register. Where the two inks cross, a
third colour appears, and that colour has a name.

Everything around the prints stays flat, warm and quiet. One green means "press". Colour never leaves the picture.
The screens, flows and layouts are today's. Only the material changes.

## What the mockup shows

| Frame                | Size and theme         | Why this frame                                                                                      |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Home                 | 390 px, light and dark | Shows the shelf of prints. **Home in dark was a frame the brief still owed.**                       |
| Discover             | 390 px, light          | Shows strangers' prints at card size. **This was a frame the brief still owed.**                    |
| Recipe detail        | 390 px, light and dark | The print hero, the reading column, the check and the current step                                  |
| Recipes (My recipes) | 1280 px, light         | Photos and prints in one grid. **This frame blocked the web build in the brief.**                   |
| Token strip          | Not a screen           | Colours with hex, contrast, type, shapes, the registration mark, a collection overprint, and motion |

The copy, the order and the placement on every screen come from the current boards in
`packages/tools/designArtifact/content/canvas/boards/`. In detail:

- **Home** (`HomeMobile`): the greeting, then the date, then the avatar. Next come Recent recipes in a 2 × 2 grid,
  Coming soon with three Soon cards and the M to S week, the New recipe button, and three tabs.
- **Recipe detail** (`RecipeDetailMobile`): the hero, then **Community rating before the title**. Then the
  overline, the title, the facts, the ticket, Edit recipe, Screen on, the description, More, the tags, Nutrition,
  Ingredients (butter checked) and Steps.
- **Discover** (`DiscoverMobile`): Filters and the pills share one wrapping row. Under them is a 2-column grid with
  the board's six recipes and usernames.
- **Recipes at 1280** (`Recipes`): the sidebar, the title, My recipes and Collections, the search and New recipe,
  the filters with their counts, "9 recipes", the sort and view, and nine cards.

## Colour

### Interface roles

| Role         | Light                           | Dark                            | Job                                                                                                   |
| ------------ | ------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `paper`      | `#F5F0E6`                       | `#151B1A`                       | the page, under the wash                                                                              |
| wash         | `#F8F1E2` → `paper` → `#EEF0E8` | `#1A201E` → `paper` → `#121816` | window light at the top, a trace of sage at the foot                                                  |
| `sheet`      | `#FFFCF6`                       | `#1D2423`                       | cards, the ticket, the current step, every chip on art, the sidebar                                   |
| `well`       | `#EFE8DB`                       | `#262E2D`                       | the timer, the switch track, "for 4", Soon, the resting step disc                                     |
| `ink`        | `#1C2422`                       | `#EFE8DA`                       | text, active glyphs, the current step disc                                                            |
| `inkMuted`   | `#6B645C`                       | `#A8A193`                       | secondary text, inactive tabs, resting numerals                                                       |
| `edge`       | `#8A847C`                       | `#6E7A72`                       | every control edge (the switch track's 1.5 px ring too), the ticket's dashes, the Draft chip's dashes |
| `line`       | `#E3DACB`                       | `#2E3736`                       | decorative hairlines only                                                                             |
| `action`     | `#2A6B65`                       | `#7CC8BE`                       | the one colour that means "press". Label `#FFFFFF` in light, `#0F1A17` in dark                        |
| `actionTint` | `#DDEBE6`                       | `#1F3330`                       | the selected pill and segment (always with a check and a 1.5 px `action` ring), the avatar            |
| `danger`     | `#B1442B`                       | `#FF8C6E`                       | destructive text (not on these screens)                                                               |
| `honey`      | `#A86A12`                       | `#E2B04A`                       | stars and difficulty bars. Graphics only                                                              |
| glass        | `sheet` at 96%                  | `sheet` at 94%                  | the tab bar and the hero's two discs, with a 1 px ring at 14% `ink` (16% in dark)                     |

### The press

Only the print renderer reads these. They live in a closed `press.*` family.

| Kind    | Name                          | Light     | Dark      |
| ------- | ----------------------------- | --------- | --------- |
| ground  | cream / parchment             | `#FCEBC7` | `#4D3D21` |
| ground  | blush / brick rose            | `#FBD3CE` | `#4D2525` |
| ground  | sage / bottle                 | `#CDEFCE` | `#06372A` |
| ground  | mist / ink blue               | `#CCE3F8` | `#1A314E` |
| ground  | gold / sienna                 | `#F3CD7A` | `#7E2B16` |
| ink     | tomato                        | `#E4543A` | `#D0654D` |
| ink     | sea                           | `#4A74B0` | `#6389C1` |
| ink     | herb                          | `#57873A` | `#67934D` |
| ink     | beet                          | `#AF5B8D` | `#B86D98` |
| ink     | ochre                         | `#BF801E` | `#A77112` |
| overlap | aubergine (tomato × sea)      | `#853C70` | `#E29AC4` |
| overlap | umber (tomato × herb)         | `#7D4F12` | `#DBA76F` |
| overlap | garnet (tomato × beet)        | `#7F3A3E` | `#DF918E` |
| overlap | petrol (sea × herb)           | `#205185` | `#81ACE5` |
| overlap | indigo (sea × beet)           | `#614C87` | `#B9A2E3` |
| overlap | moss (herb × beet)            | `#4A5507` | `#A1AF68` |
| overlap | rust / crust (ochre × tomato) | `#AB2B08` | `#CE9E12` |

The build script refuses two kinds of print: ochre (as either plate) on gold, and ochre with any partner but
tomato.

### Contrast

The page's generator computed every ratio below from the hex above, with the WCAG 2.x formula. They match the brief
to two places. Text needs 4.5:1. Controls and meaningful graphics need 3:1.

| Pair                                                       | Light            | Dark             | Kind    |
| ---------------------------------------------------------- | ---------------- | ---------------- | ------- |
| `ink` on `paper`                                           | 13.96            | 14.31            | text    |
| `ink` on `sheet`                                           | 15.48            | 12.96            | text    |
| `inkMuted` on `paper`                                      | 5.13             | 6.80             | text    |
| `inkMuted` on `sheet`                                      | 5.69             | 6.16             | text    |
| `inkMuted` on `well` (Soon, resting numerals)              | 4.78             | 5.42             | text    |
| `inkMuted` on the wash top                                 | 5.18             | 6.45             | text    |
| Label on `action` (buttons, the FAB, a checked box)        | 6.20             | 9.20             | text    |
| `action` on `paper` (See all, links)                       | 5.45             | 9.03             | text    |
| `action` on the wash top                                   | 5.51             | 8.56             | text    |
| `action` ring on `actionTint` (selected pill)              | 5.05             | 6.90             | control |
| `ink` on `actionTint`                                      | 12.91            | 10.94            | text    |
| `edge` on `paper` (search field, pills, switch track ring) | 3.26             | 3.90             | control |
| `edge` on `sheet` (stepper, Draft chip)                    | 3.62             | 3.53             | control |
| `edge` on `well` (switch thumb at rest)                    | **3.04, pin it** | **3.10, pin it** | control |
| Inactive tab on glass, with `ink` under it                 | 5.27             | 5.24             | text    |
| `danger` on `paper`                                        | 4.96             | 7.67             | text    |
| `honey` on `sheet`                                         | 4.33             | 7.93             | graphic |
| Status-bar text on the worst print ground (gold)           | 10.43            | 7.68             | text    |

Text never sits on art. Every chip on a print is a `sheet` chip with a ring, so its text is `ink` on `sheet`.

## Type

| Role                              | Face                                                                      | Size                          |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| Greeting, page title              | Bricolage Grotesque, width 84, weight 650, −0.018 em, balanced wrap       | 36/1.02 phone, 56/1.0 desktop |
| Recipe title                      | Bricolage, width 86, 650                                                  | 32/1.05                       |
| Section heading                   | Bricolage, width 90, 650                                                  | 21/1.2                        |
| Card title                        | Bricolage, width 88, 650, two lines at most                               | 16/1.25 phone, 19/1.2 desktop |
| Reading body (steps, description) | Inter 400, `cv11`                                                         | 17/1.55                       |
| Ingredient line                   | Inter 16: amount 600 tabular, food 400, preparation on its own muted line | 16/1.5                        |
| Meta                              | Inter 500                                                                 | 14/1.4                        |
| Overline, group names             | Inter 600, caps, +0.08 em                                                 | 12/1.2                        |
| Figures (the ticket)              | Inter 600, tabular lining                                                 | 18/1.2                        |

## Surfaces and shape

- **Flat paper.** Content has no shadows. Cards are `sheet` with a 1 px `line` inset.
- **A print sits in a mat.** A card has 6 px of `sheet` around its cover, like the border of a print. Covers are
  radius 14. Cards are radius 20.
- **Only floating things have a shadow and glass:** the New recipe button, the tab bar and the hero's back and ⋯
  discs.
- **Shape means press.** Every pressable control is a pill or a circle. Statuses are 6 px chips: time, Private,
  Draft (dashed `edge`, "not finished") and PRO (a solid 1.5 px `ink` ring and tracked caps).
- **One active grammar.** The active tab, the sidebar row, the selected segment and the selected pill all use
  `action` as a mark (a 3 px bar or a 1.5 px ring), bold `ink` text, and a filled glyph or a check.
- **Steps.** A resting numeral is `inkMuted` on a 32 px `well` disc. The current step is a `paper` numeral on an
  `ink` disc, on a `sheet` card with a 3 px `action` rule.
- **Today** in the week is a `sheet` cell with a 1.5 px `action` ring.
- **Icons** are Lucide at 2 px. Active tabs use a true filled glyph: a filled house, a closed book with a spine,
  and a filled compass.

## The prints

### What each print in the mockup draws

The hero ladder chooses plate A: the last food the title names, then produce, then herbs, then the main foods.
Plate A's ink comes from its food. Plate B is the next food from a different kind.

| Recipe                               | Plate A                                        | Plate B                                                     | Ground                                | Overlap                                   |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| Lemon and thyme roast chicken (hero) | the bird, tomato                               | lemons and halftone juices, ochre                           | cream                                 | rust                                      |
| Lemon ricotta pancakes               | the stack, ochre                               | lemon, tomato                                               | mist                                  | rust                                      |
| Weeknight pad thai                   | rice noodles, tomato                           | coriander, herb                                             | cream                                 | umber                                     |
| Roast tomato soup (Draft)            | halved tomatoes, tomato                        | onion rings, sea                                            | sage                                  | aubergine                                 |
| Spaghetti alla carbonara             | spaghetti, ochre                               | guanciale, tomato                                           | blush                                 | rust                                      |
| Shakshuka with feta                  | feta, ochre                                    | tomatoes, tomato                                            | sage                                  | rust                                      |
| Chickpea and spinach curry           | spinach, herb                                  | chickpeas, beet                                             | gold                                  | moss                                      |
| Miso butter mushroom ramen           | wheat noodles, ochre                           | mushrooms, tomato                                           | mist                                  | rust                                      |
| Red lentil dal with crispy shallots  | red lentils, tomato                            | shallot rings, herb                                         | cream                                 | umber                                     |
| Brown butter chocolate chip cookies  | cookies, ochre                                 | chips, tomato (they print as rust, the colour of chocolate) | blush                                 | rust                                      |
| Sam's six print cards at 1280        | cookies, salmon, pork, shrimp, pancakes, chili | chips, greens, rosemary, spring onion, lemon, black beans   | sage, gold, cream, mist, blush, cream | rust, umber, moss, umber, rust, aubergine |

### Craft

- **Hand-cut edges.** Each plate outline is pushed along its normal by a seeded wobble of about 1.2 rendered px.
- **Registration.** Plate B sits 2.5 px across and 1.25 px down, in rendered pixels, at every size.
- **Overlaps are their own flat shapes.** The overlap is plate B clipped to plate A and filled with the overlap ink.
  There are no blend modes and no filters on any print.
- **Halftone** is on the hero only. The dots sit on the shadow side of the bird. Where they cross the bird, they
  take the overlap colour.
- **Calm rules.** Plate B has at most three clusters. At least 35% of the ground stays empty. The top 56 px of the
  phone hero stays clear for the status bar.
- **Grain** is one 128 px PNG per theme. Light is sparse dark tooth at 26%. Dark is bipolar at 20%. Photo cards get
  it at 60%. It is never under text, and the recipe page shows a photo with no grain.
- **Prints are decorative.** Every print is `aria-hidden`. The title names the recipe.

### Photo recipes

A photo recipe still owns a print, hidden behind the photo. It shows in two places:

- **The registration mark** beside the overline on the recipe page: two 12 px discs in plate A and plate B, 2.5 px
  apart, with the overlap lens between them. The mockup shows it for the focaccia. It is also the brand mark in the
  desktop sidebar.
- **Collection covers.** The token strip shows "Weeknight dinners". It overprints plate A of its first three
  recipes: Chicken Cacciatore (beet, a photo recipe), Miso-Glazed Salmon (tomato) and Tomato Basil Soup (herb, a
  photo recipe). Garnet, moss and umber appear where they cross.

## Motion

| Motion                    | Spec                                                                                                                           | When                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| The check (the signature) | 220 ms, `cubic-bezier(.34,1.56,.64,1)`, scale 0.85 → 1.06 → 1. The box fills with `action`, and the strike draws in `inkMuted` | on tap                                 |
| The stamp (an owner call) | Plate B starts 6 px out and lands at 2.5 px, on the same curve                                                                 | once, on the page the publish lands on |
| Everything else           | instant                                                                                                                        |                                        |

Nothing moves on first view, on scroll or on refresh. The mockup does not play the stamp on load. The token strip
has a check you can tap and a "Replay the publish stamp" button. Under reduced motion, both show their end state at
once.

## Decisions the brief left open

These are choices the build had to make. The owner or the build plan must accept or change each one.

1. **The hero contradicts the ink table.** The brief's hero is "a roast bird in tomato, its lemon in ochre, rust
   where they cross". But the table row for poultry gives plate B "any other ink except ochre". Both cannot
   hold. **The mockup follows the hero.** Ochre's pairing rule is "ochre's only partner is tomato", and the pairing
   works in both directions. The proposed fix to the table: when plate A is tomato and plate B's food sits in the
   ochre row (bread, grain, dairy, eggs, yellow citrus), plate B can be ochre.
2. **Noodles have no ink row.** The mockup puts wheat and egg noodles and pasta (ramen, spaghetti) in the ochre
   row, as grain. It puts rice noodles (pad thai) in the "no category" row, where the seed picks tomato, herb or
   beet.
3. **Legumes have no ink row.** Red lentils use the "no category" row (tomato). As plate B, chickpeas print in beet
   and black beans in sea.
4. **Shellfish has no row.** Shrimp go with salmon (tomato).
5. **"X with Y" titles.** The ladder says the last food the title names wins. In "Shakshuka with feta" and "Pad Thai
   with Shrimp", the dish word is not a food. The mockup takes the named food after "with". The ladder needs a line
   that says this.
6. **The ground rule.** The brief bans only ochre on gold. The mockup also keeps herb off sage and sea off mist.
   That is the same rule ("a ground never matches its ink's family"), applied to every ground.
7. **The tab on the recipe page.** The board does not say which tab is active. The mockup marks Recipes, because the
   page opens from My recipes.

## What the mockup shows honestly

- **The weak case is on screen.** Four of Discover's six prints are ochre and tomato. That is what the pairing rule
  gives for pasta, feta, ramen and cookies. Variety comes only from the ground, the motif and the crop. The brief
  names this risk ("a baker's library is all ochre and tomato"). The Discover frame shows how it looks.
- **The photos are painted stand-ins.** The focaccia, the cacciatore, the tomato soup and the sourdough are drawn
  with gradients and blur. No real phone photo is on the page, so Gate 3 is still owed.
- **The prints are drawn by a script for this mockup.** The geometry step (wobble, overlaps, halftone) ran once in
  Python and is written into the page as flat paths. The real build runs it on the server at first publish, as the
  brief says.
- **Checked in one browser only.** The page was checked in headless Chromium at 1440, 390 and 360 px wide, with
  the page's own light and dark schemes. It has no
  sideways scroll at any of them. It was not checked in Safari or Firefox, or on a device.
- **The desktop frame scales down** on narrow windows. A small inline script sets CSS `zoom` on each frame. Without
  the script, the frames keep their full size.

## Gates

**Paid by this mockup** (from Gate 5 in the brief):

- Recipes at 1280 px in light, with photos and prints mixed. This blocked the web build.
- Discover at 390 px.
- Home in dark.

**Still owed:**

- The desktop recipe page with a print hero. This blocks the web build.
- Collections at 1280 px with three crossing plates. The token strip has only a small sample.
- Home at 320 px.
- Gates 1 to 4 and Gate 6 in the brief: the coverage audit, the review of 200 real recipes, real photos, devices,
  and the `staff-ux-engineer` and `staff-architect` passes.
- A pinned token test for each thin pass: `edge` on `well` (3.04 and 3.10), and the inactive tab on glass.

## Owner calls (unchanged from the brief)

1. D13: `action` is `#2A6B65` instead of seafoam.
2. A new `press.*` palette, with herb, beet and ochre added.
3. Display type for page titles, section headings and card titles.
4. The stamp as a second motion.
5. Grain on photo cards (cards only).
6. Prints replace `covers.ts`.
7. **New from this build:** the ink-table fix in "Decisions the brief left open", item 1.
