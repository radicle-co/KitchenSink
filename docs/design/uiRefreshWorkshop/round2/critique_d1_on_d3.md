# Critique: Designer 1 on Designer 3, "Mise en Place" (Round 2)

Reviewed: `round2/d3/concept.md` and `round2/d3/mockup.html`. I read the source. I also rendered every frame in headless Chromium, with the real Fraunces and Inter, to judge the plates as drawn. I measured contrast with the
WCAG 2.x relative-luminance formula. Round 3 is the last round, so every request below is "show this in round 3".

## Verdict

This is a real step forward. You took almost every round 1 point and fixed it properly. You did not just patch it:

- The active tab now has a filled `action` pip, a filled glyph and weight 750. The sidebar row has a 4 px bar. The
  state no longer depends on hue alone.
- Inactive tab labels are `ink` on glass at 0.84 / 0.80.
- Dark mode has one mechanism, deep grounds and a lamp. There is no filter.
- Basil is off the squiggle and the difficulty pips.
- Fraunces uses `font-optical-sizing: auto` with one 22 px floor.
- D11 slate and pewter are used as specified.
- The seed is stored.
- The recipe detail order matches the board again. I checked it against `RecipeDetailMobile.dc.html`: rating, title,
  facts, strip, Edit recipe, Screen on, Nutrition.

"Mise en place, not the finished dish" is the decision that makes the idea buildable. It is honest, and it means a
function can draw a plate. Light Home and the recipe page are warm, calm and clearly nicer than today. The 1280
Collections wall is the most exciting frame anyone has shown in this workshop.

The risks are now in a different place. The chrome is fine now. What is weak is the **system** behind the plates: when the plate gets
fixed, which ingredient becomes its face, and whether six grounds are really six. These matter more than any colour,
because the whole concept rests on the plates.

## Must fix (most important first)

### 1. The stored seed freezes the plate before any ingredient exists

The plate is "created and stored at first save". Your own editor frame shows "Saved" on Details, the first section,
before a single ingredient line exists. Matching to catalog foods (D20) also happens later and in the background. So a
recipe written in the app gets saved with no matches and gets the **fallback** plate. The plate never changes after that, so the fallback stays forever. In practice, almost every recipe a cook types keeps the fork-and-cloth fallback. The ingredient plate, which is the whole point, appears only for imports.

The once-in-a-lifetime assembly also plays "at first save", and that happens inside the editor, which you made
plate-free on purpose. So nobody sees it.

Fix (a suggestion): freeze the plate at the first moment it has real input. That is either the first save that has at
least one matched line, or the first publish. The app already records that fact as `recipes.first_published_at`
(ADR-0058). Until then the plate stays live, and the fallback is honestly temporary. Play the assembly the first time the
cook opens the recipe page after the plate is frozen. Then the moment happens where the plate is.

### 2. "Hero = the first matched ingredient" picks the least distinctive food

Recipe ingredient lists start with the base: onion, flour, olive oil, chicken, butter. Your Collections render already
shows the result. The same whole-chicken hero appears in three covers. The same tomato appears in two. An egg is in
seven cells, and the onion ring is in four. On a real library of 200 recipes, a third of the plates will be "onion on
terracotta". That breaks your own promise that "a cook can still find a recipe by sight", because many recipes will have
the same face.

Fix: in round 3, pick the hero by **distinctiveness**, not by list position. See bold suggestion A.

### 3. The flagship plate fails your own contrast rule

Your open risks set a rule: each motif needs a value gap of at least 1.3:1 from its ground, or a forced edge. The recipe
page hero breaks it:

- chicken `m-skin` `#F1CFAE` on terracotta `#E9B48C`: **1.26:1**
- the shaded side `m-skin-lo` `#DDA97E` on the same ground: **1.13:1**

On screen the bird reads as a pale balloon with a stick in it, not as a chicken. Two more problems in the same frame:

- The butter block (`#F8E08E` on terracotta, 1.41:1), with its tab and its rounded corner, reads as a **file-folder
  icon**.
- On the wide hero (viewBox 114.71 × 100, `slice`) the side motifs are cut off at both edges.

Fix:

- Make the rule a generator check, not a note. When a hero and its ground fail 1.3:1, move to the next ground in the
  family, or draw a 1.5 px `m-edge` outline.
- Redraw butter as a wrapped block with a folded paper end, so it cannot be read as a UI icon.
- Give wide heroes a safe area, the middle 80% of the width, and keep every motif inside it.

### 4. The six grounds behave like four in light and about two in dark

| Pair                                              | Ratio     |
| ------------------------------------------------- | --------- |
| chili `#EBA37E` vs terracotta `#E9B48C`, light    | **1.13**  |
| butter `#F3D67F` vs olive `#C5CC94`, light        | 1.18      |
| chili vs terracotta, dark (`#3D2A20` / `#3B2C23`) | **1.01**  |
| every dark ground vs canvas `#131512`             | 1.30–1.43 |
| dark paper vs dark grounds                        | 1.18–1.30 |

The hues also bunch together. Chili, terracotta and tomato are all orange-red, and butter is next to them. Sea is the
only cool ground. In light, the Collections wall looks mostly orange. In the dark Home render, butter, terracotta and
olive all read as the same brown. The plates almost merge into the page, and the lamp pool is hard to see. With grounds this close, the per-recipe key loses its point.

Fix: merge chili and terracotta into one ground. Add a second cool ground (a dusty plum or a cold blue-grey) so the
wall has balance. In dark, raise the grounds a step, to about 1.8:1 against canvas, and keep them low in chroma. Then
check that the six dark grounds are clearly different hues, not one brown family. Show both theme walls side by side in
round 3.

### 5. The Collections wall is lively, but it is not calm

At 1280 px there are six covers with four cells each. That makes 24 grounds and about 90 objects on one screen, plus
the photo with its own mat inside a cell. It is the most attractive frame in the file. It is also the one frame that
goes against "never busy". A cook looking for "Soups for a cold night" has to read a quilt.

Fix: give each mosaic **one shared ground**, the ground of the first plate. Put only the **hero motif** of each recipe in
each cell, with no supports and no accents. That is four objects per cover, and the cover reads as one tile. It is
still a portrait of what the collection holds. Inside a mosaic, drop the photo mat and let the photo fill its cell.

### 6. The day-one fallbacks are one picture in four colours

All four fallbacks put the same striped cloth in the bottom-left corner at the same angle, with a utensil on the same
diagonal. Side by side they read as one rubber stamp, and this is a new cook's whole first library. Two smaller issues:

- **The seed does not look random.** The concept says the seed picks the ground, "so a tomato soup does not get a
  tomato ground by design". But three of the four day-one cases get the ground from their family table: bean chili on chili, cacciatore on terracotta, sourdough on olive. Either the seed is not really random, or these
  were picked by hand. Say which, and show one case where the ground does not match the dish.
- **The pad thai photo mat reads as a selection.** A 6 px coloured ring around a tile is how most apps show a
  selected item. Thin the mat to 4 px and darken it 8%. Then it reads as a board and not as a state.

Fix: let the seed vary four things. Vary the cloth corner and the cloth pattern (stripe, check, plain linen). Vary the utensil scale, and whether there is a cloth at all. Show eight fallbacks in round 3, not four.

## Smaller points

- **Crumbs are food.** Rule 4 says the accent "is never food", but crumbs are on the list. Swap them for a pinch bowl or
  a twine knot.
- **Raw hex outside the closed family.** The avatars use `#F3D67F` and `#A8C6C4`, and `#star80` hard-codes
  `#A36A00` / `#E3DCCD`. Your own guard ("a `plate.*` read outside `Plate` fails") fails on the avatar. The star gradient breaks in dark. Give the avatar its own role, and build the star from `--saffron` / `--star-off`.
- **The 80% star cannot be seen.** `star-off` `#E3DCCD` on canvas is **1.22:1**, so the fifth star looks full. The
  number "4.8" carries the meaning, so this does not fail AA. But the honest fraction you added is not visible. Use a
  pewter outline for the empty part (3.32:1).
- **Basil on decoration came back.** The editor's section bar has four `action` dots for "4 of 4 done" (6.24:1 on
  paper). They are progress, not something you press. Draw them in `ink-muted`.
- **The doc and the mockup disagree on the dark wash.** The concept says the wash is 12% of the ground. The dark CSS
  uses **60%** (Home) and **55%** (the sheet). Your ratios use the real values: `ink-muted` on the dark butter wash is
  6.35:1, and the key on the dark terracotta sheet is 8.49:1. I re-measured both. Fix the prose so the build does not
  ship 12%. At 12% the dark wash is invisible.
- **"No key is red" is only half true.** The chili key `#9A4A22` (hue 20°) and the terracotta key `#9A4E2A` (19°) sit
  about 10° from danger `#B23F28` (10°), and the luminance gap is 1.08:1. A rust "Chicken" group label next to a rust
  "Delete" can still blur. Push the two keys toward brown (about 28°), or move danger to a cooler crimson.
- **The heading order is upside down on Home.** "Coming soon" is now 26 px Fraunces. "Recent recipes", the real content,
  is 19 px Inter. In `HomeMobile.dc.html` both are 18 px body headings at the same level. The placeholder section now
  shouts louder than the cook's recipes. Use Fraunces for both, or for neither.
- **Fallback chips in dark.** Status chips sit on `paper` `#1C1F1A`, and that is only 1.25:1 against the dark terracotta
  ground. The text inside is fine (13.99:1), but the chip's shape melts into the plate. Add a 1 px `glass-edge` ring in
  dark.
- **Still not shown:** Discover at 390 px with mostly photos, and the motif coverage audit. Both were on your own round 3
  list. Discover is where "a photo on its ground" either holds or fails, so it matters more than any new frame.

## What to keep

- **Mise en place as the rule.** It draws only what is true, so the generator can never be wrong about a dish.
- **The plate rule proof panel**, with the slots drawn over a real plate. This is the right way to sell a system.
  Keep it in round 3 with the hero-ranking change.
- **Status chips on solid `paper`, and no text ever on a ground.** It is a rule a build can enforce.
- **The active-state fixes.** A filled pip, a filled glyph, weight 750 and the 4 px sidebar bar. Textbook.
- **The lamp as the only dark mechanism.** Keep it. Just lift the grounds (point 4).
- **The plate-free editor.** It is right that the place where cooks work hardest has no food on it. The paper fields
  with pewter edges (3.64:1) and the ring offset from the field are a quiet, clear upgrade.
- **The sheet over the hero, with a grab line in the key.** It is small and physical, and it makes each page belong to
  its recipe.
- **Tomato borrowing chili's key.** It is the right instinct. It does not go far enough yet (see above).

## Two bold suggestions

### A. Choose the face by what is special, not by what comes first

Rank each matched ingredient by how rare it is across the catalog's recipes (inverse frequency). Use the rarest one as the hero. Onion, salt, oil, flour and butter
then become supports or drop out. Saffron, miso, rhubarb or a whole fish become the face. Add one rule for the wall:
two neighbouring tiles in a grid never share a hero motif. The seed breaks ties. The plate then shows what makes
_this_ recipe this recipe, and "find it by sight" becomes true. It is the same data and a better question.

### B. Let the key own the title

At the moment the key colours a 12 px overline, two group labels and a 4 px grab line.
Nobody will notice that, so each recipe does not yet feel like its own book. Set the 34 px Fraunces recipe title in the
key. The light keys are 5.38–6.04:1 on canvas and at least 4.92:1 on the wash. The dark keys are at least 8.28:1. So the title passes AA as large text by a wide margin. The title is a word you read, not a control, so it stays inside your rule
that "the key never marks what you press". Everything else on the page stays `ink`. This concept still lacks a moment of identity. One coloured title under a coloured plate gives it one. It stays calm, because it is one element.
