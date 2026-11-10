# Designer 1 on Designer 2, round 3: Kitchen Press

I read `concept.md` and the mockup source, and I rendered the mockup in headless Chromium to look at the art. Every
contrast number below I computed again myself, from the hex values in the CSS.

## Verdict

This is the most finished system in the workshop. The interface around the art is now very good: calm, honest, and
tight. One shape means "press". Text never sits on art. Gold has left the interface. Every chip on art is one family.
The steps are quieter. The dark desktop grid really does look like a shelf of prints, and that is exciting. I want to open it.

Two problems remain, and both are in the art system, not in the interface:

1. **The colour fights the food.** The motifs are figurative, but the hash gives them colours that are not the food's
   colour. On screen that gives blue pork, green pancakes, pink chicken, a magenta tomato, and red pancakes that read
   as bacon.
2. **The print is not stable.** The neighbour rule picks a recipe's colours from its position in the grid. Sorting,
   filtering, a wider window or another device then gives the same recipe a different print.

We can fix both without losing the idea. The rest is polish.

## Strongest ideas worth keeping

- **Overlaps as named tokens** (aubergine, umber, garnet, petrol, indigo, moss). Each one is a real colour in the
  4.61 to 6.93:1 band in light, and none is black. This answers round 2's worst flaw, and it is the best idea in the
  workshop. It is flat paths, so native can draw it exactly.
- **Collections as overprints.** The "Soups for a cold night" cover is the one image in the deck that only this
  product can make.
- **The chip rule: "a chip's fill is never a ground token."** All chips on art are `sheet` with one 14% / 16% `ink`
  ring. The Draft chip on gold used to vanish (1.00:1), and this rule fixes that whole class of problem, not just one
  case.
- **The dashed edge means "not finished".** Draft is dashed. The empty "Resume cooking" ghost is dashed. Nobody has to
  learn that, and it makes no noise.
- **Step numerals with no ring at rest.** The 390 px reading column lost five pewter circles. The current step (an
  `ink` disc, a `sheet` ground and a 3 px `action` rule) is now the only loud thing in it. This is the right
  hierarchy for a cook with wet hands.
- **Bricolage narrow on card titles.** "Miso-Glazed Salmon with Sesame Greens" at 19 px wdth 88 sits on the shelf with
  the same voice as the 56 px "Recipes" title. Inter 15/600 was the most default-looking thing in round 2. This
  change does a lot for very little.
- **The frozen print**, and **the scrim measured over a white plate** (I get 4.99:1, white on 65% `ink` over white).
  These are both good, honest pieces of engineering.

## Contrast check

I computed the doubtful pairs again. D2's numbers are right to within 0.01.

| Pair                                               | Mine         | Note                                                                                                                                                     |
| -------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge` on `well`, light / dark                     | 3.04 / 3.10  | Passes 3:1, with no margin. This is the switch thumb on its track. Pinning it with a test is right                                                       |
| `ink-muted` on `well`, light                       | 4.78         | The "Soon" tag. Passes                                                                                                                                   |
| Inactive tab on glass at worst case, light / dark  | 4.58 / 4.69  | Passes. The concept says 4.59 for light. That is a rounding difference, but please use one rounding rule everywhere                                      |
| `action` ring on `action-tint`                     | 5.05         | Selected filter chip. Passes                                                                                                                             |
| `action-tint` fill against `sheet`, light / dark   | 1.20 / 1.18  | Fine, because the check, the ring and bold text carry the state. Do not let anyone remove the ring later. It is the only edge                            |
| Glass disc against the cream hero ground, light    | 1.03         | The disc's shape is shown only by its shadow. The glyph is 13.0:1, so it passes 1.4.11. But the disc looks pale and soft on a light print. See problem 6 |
| `ink` status bar text on gold, light / dark        | 10.43 / 7.68 | Passes                                                                                                                                                   |
| Dark "cream" ground `#3A3C14` against dark `paper` | 1.53         | OK as a tile edge. The problem with this ground is its hue, not its contrast (problem 3)                                                                 |

No text fails. All of the risk is in the art, as the concept itself says.

## Problems to fix, most important first

### 1. The colour fights the food (aesthetic and appetite)

The concept says that "prints are not literal colour, as in real two-colour printing." That is true for Riso
posters. But those posters use abstract or very stylised forms. These motifs are **figurative**: a tied joint, a
scored fillet, a stack of pancakes, a halved tomato. When a figurative food comes in the wrong colour, the brain does
not read it as "a print". It reads it as "something is wrong with this food". In the mockup:

- **Slow-Roasted Pork Shoulder**: a sea-blue joint on olive.
- **Lemon Ricotta Pancakes** (desktop): a stack of herb-green pancakes. **Lemon ricotta pancakes** (Home): tomato-red
  slabs that read as bacon.
- **Weeknight Chicken Cacciatore**: beet-pink thighs.
- **Roast tomato soup** and **Roasted Tomato Basil Soup**: magenta tomatoes. The palette _has_ a tomato ink, but the
  hash did not pick it for the one food it is named after.
- **Sunday rosemary focaccia**: a blue loaf.

Blue and green on meat and bread work against appetite. That is the exact opposite of "excited to open the app".
The hero is better only because the bird happened to get tomato.

**The fix.** Let **plate A's ink come from the food's category**, from a short list of plausible inks. Let the hash
pick only **plate B's ink and the ground**:

| Category                            | Allowed inks for plate A                          |
| ----------------------------------- | ------------------------------------------------- |
| meat, poultry, fruiting veg, tomato | tomato, beet                                      |
| grain, bread, pancake, tuber, dairy | tomato (as crust) or a new ochre ink, see below   |
| leafy greens, herbs, allium         | herb                                              |
| fish                                | tomato (salmon) or sea (white fish, read as cold) |
| citrus                              | herb or ochre                                     |

Four inks are not quite enough for bread and dairy. I recommend **one warm ochre ink**, roughly `#C98A2E`. Keep it in the 2.4
to 4.1:1 band on the light grounds. Derive its four new overlaps by the same rules. The variety still comes
from plate B (three choices) × ground (five) × rotation and crop. That is 15 combinations for each plate A ink,
before geometry. The "red library" worry also gets smaller. The spread now comes from plate B and the ground (see problem 2), and
the eye sees those across a row.

The other way is to **abstract the motif** at card size, so that it no longer reads as a specific food. The owner
can choose this path to avoid a fifth ink. But it throws away the best part ("my food, printed"), so I do not
recommend it.

### 2. The print changes with layout, which breaks "the picture they remember"

Rule 4 says: "On a clash, the hash steps to the next free pair." So a recipe's ink pair depends on **which cards sit
next to it**. Rule 5 then promises the print is "frozen at first publish". These two rules contradict each other, and
the mockup shows it:

- At 1280 px with the sidebar open, the content area is 960 px. `minmax(15rem, 1fr)` with a 24 px gap gives **3
  columns**, and the rule holds. I checked all nine cards.
- Any window from about 1,350 px wide, or 1280 px with the sidebar collapsed, gives **4 columns**. The same order
  then puts Pad Thai (tomato × beet) diagonally against Cacciatore (tomato × beet), and Sourdough (tomato × herb)
  directly under Salmon (tomato × herb). When the cook collapses the sidebar, two prints change colour, or the rule silently
  fails.
- The phone shows 2 columns, so the same recipe has a different print on the phone and on the laptop.
- The **"Recently edited" sort and the filter chips** change who is next to whom on every tap. A neighbour rule
  that runs at layout time recolours the shelf whenever the cook filters by "Italian".

The colour bar on the detail page then has to pick one of these colours, and it will not match what the cook just
tapped.

**The fix.** Decide the print **once, at first publish, against the cook's library**: store `press.plateB`,
`press.ground` and the seed on the recipe. Choose the values that are least used in that cook's last N recipes, so a
library spreads out over time. Drop the layout-time neighbour rule. Two neighbours will sometimes match, and that is acceptable. Real
shelves do that, and with plate A now by category (problem 1) and 15+ combinations, it will be rare. Stability is
the whole point of a recognisable image, and right now it loses to an even spread.

### 3. Dark mode: the hero ground is drab, and PRO is the brightest thing on the card

- **The dark "cream" ground `#3A3C14` reads as army olive.** It is the ground of the recipe-page hero, the largest
  piece of art in the dark theme. Salmon and periwinkle on khaki looks muddy, not "card stock under a lamp". The other
  four night grounds (brick rose, bottle, ink blue, amber) are lovely. Move cream-at-night to a **warm parchment
  brown**, around `#3A2F22` (hue about 70°, chroma about 0.04). Keep the 0.07 ΔE gap from amber by making amber
  redder. Then check the ink band again.
- **The PRO chip in dark is an `ink` (cream `#EFE8DA`) slab.** On "Overnight Sourdough Boule" it is the brightest
  object in the whole card, brighter than the photo. That breaks "night inks are mid-tones, so nothing glows". Give
  PRO the same grammar as Draft: a `sheet` chip with a **solid 1.5 px `ink` ring** and bold tracked text. Dashed means
  unfinished, and solid means premium. It is one family, and it stays calm in both themes.
- **Not drawn:** Home in dark (the 2 × 2 grid is the first screen most cooks see at night) and the dark collection
  covers in place on the Collections screen.

### 4. The hero print is the busiest object in the app

The roast-bird hero (330 px) holds the bird, about fourteen scattered sea pebbles across the full width, the lemon
wheel, and a halftone field. On the light frame the pebbles read as confetti. On the dark frame they look like spots
on the lens. The concept's own test is "calm, never overwhelming", and this is the one place it slips.

Add composition rules to the renderer:

- Plate B is at most **three clusters**.
- At least **35% of the ground stays empty**, and the top 56 px stays empty too (you already do this).
- The halftone is clipped to the **shadow side of plate A only**, not spread across the frame.

The card-size prints already obey something like this, and they are the calmer for it.

### 5. The colour bar is too small for its job

It is three 10 × 6 px swatches (30 × 6 overall). On a photo recipe it is the _only_ trace of the print identity.
At that size it reads as a decoration or a status dot, not as "this is my pancakes print". In the 1280 card footer it
is almost invisible. Make it **14 × 8 px per swatch**, and on the detail page draw it as a **registration mark**: two
overlapping 12 px discs (plate A and plate B, offset 2.5 px), with the overlap lens in its overlap ink. That is the
brand mark at 12 px. It tells the cook "this is your print" in the product's own grammar. It costs no space.

### 6. Smaller fixes

- **The glass disc on a light print (1.03:1 against cream).** It passes on the glyph alone, but the disc looks
  washed out on the lightest grounds. Raise the light glass to 96% `sheet` (not `paper`), and add the 14% `ink`
  ring the chips already use. Then the hero discs and the cover chips are one family.
- **Mockup grain inconsistency.** The Home pad thai card stacks `.pgrain` _and_ `.grain` (about 0.37 effective). The
  desktop photos get only `.pgrain` (0.16). The spec says photos get 60%. Fix the Home card, because it makes the one
  photo on Home look dirtier than the prints.
- **The photo stand-ins are blurred ellipses.** Next to crisp prints they look like out-of-focus photos. This makes
  the mixed grid look worse than it will. It also hides a real question: at night, real food photos will be the
  brightest tiles on the shelf. State the treatment (my advice: leave photos alone and accept it), but show one real
  photo before anyone signs off.
- **Discover, the Collections screen, the editor, and 320 px are not drawn.** Discover matters most. Whose library
  does a stranger's print come from? Does Discover use the same seed? (It must, or the same recipe has two prints.)
  The editor matters because it is where the publish stamp is triggered.
- **Two rounding answers for the same pair** (light tab 4.58 vs 4.59). Use one rounding rule in the generator, so
  the token test and the document cannot disagree.

## Did it keep the layouts?

Yes. Home, the detail page and the Recipes grid keep their order and placement. The ticket, the stepper, the grouped
ingredients, the step list, the segmented control, the search row, the chips, the count row and the view switch are
all where they are today. The only addition is the colour bar, a decoration beside the overline and in the card
footer, and it takes no layout space. Phone and desktop both work. The 30-character greeting at 30 px wraps cleanly
in two lines.

## Two bold suggestions

1. **"Pull another proof."** Add one item to the detail page's existing ⋯ menu: _Pull another proof_. It re-rolls
   plate B, the ground and the crop, shows the new print in place, and offers _Keep_ or _Back_. Then it freezes
   again. This turns the hash from something done _to_ the cook into something the cook _chose_. That is the
   strongest kind of attachment a library can have, and it also closes problem 2: the print is a stored fact the cook
   owns, not a layout result. It is one menu item and no new screen, but it is still a new action, so it needs the
   owner's yes.
2. **Mine versus theirs, carried by the paper.** On Discover, print every stranger's recipe on **one shared ground**
   (cream in light, parchment at night), and keep the five grounds for the cook's own library. When a cook clones a
   recipe, its print "moves onto their paper" (one stamp, the same curve as the publish stamp). The cook can then
   tell at a glance what is theirs, with no badge and no extra text, and Discover becomes calmer than the library,
   which is right for a place you browse.

## Summary for the owner

- The interface layer is ready. Keep the chip rule, the dashed "unfinished" edge, the calm step numerals, Bricolage
  narrow card titles and the overlap tokens.
- Two art fixes must land before build. The food's category picks plate A's ink, so there is no blue pork. And the
  print is stored at publish, not computed from the grid, so it stays the same everywhere.
- Fix the dark parchment ground and the dark PRO chip, calm the hero composition, and enlarge the colour bar. Draw
  Discover and dark Home before sign-off.
