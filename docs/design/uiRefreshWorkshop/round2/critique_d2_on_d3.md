# Critique: Designer 2 on Designer 3, "Mise en Place" (Round 2)

Files read: `round2/d3/concept.md` and `round2/d3/mockup.html` (the full source, including the generated plate markup
inside the long lines). I checked the recipe page against `RecipeDetailMobile.dc.html` and the desktop frame against
`Collections.dc.html`. I measured every ratio below myself with the WCAG 2.x relative-luminance formula.

## Verdict

This is a real step forward. Round 2 answered almost every point from round 1, and it did so in the right way. The
recipe page matches the board again. The fallback, a photo next to plates, dark Home, the editor and the states are
all drawn. The plates came from a generator with no hand fixes, which is the proof I asked for. "Draw the ingredients,
never the dish" is the change that makes the idea honest. A function can now build every plate, and it can never
draw a bad pancake.

The proof is also useful because it shows where the system breaks. A pure rule makes the failures visible, and I can
now see three of them in the mockup itself:

- The rule that picks the ground puts pale food on pale ground.
- A staple as the first ingredient makes the heroes repeat.
- Every plate uses the same five-point layout.

The layouts are kept. I checked the recipe page order against `RecipeDetailMobile.dc.html`: rating, title, facts,
strip, Edit recipe, Screen on, description, tags, Nutrition, Ingredients with the stepper, and Steps. All six
collection names and counts match `Collections.dc.html`. The one change is the Ingredients header, which wraps (see
problem 9).

These problems are in the generator, not in the chrome. The generator is the whole bet, so they come first. The chrome
(oat, ink, basil, Fraunces with Inter) is calm, correct and well measured. It is also still the familiar 2024–26
wellness look. So the plates have to be excellent, not just good.

## Strongest ideas to keep

1. **Ingredients, not the dish.** This is the best decision in the workshop. It makes the generator honest. It
   means the plate can be built from data the app already has. And it gives the product name a meaning you can see.
   Keep the rule that the accent is never food. The blueberries are gone. Keep them gone.
2. **The photo sits on its ground** (`.plate.photo`: a 6 px mat, an inner radius of 16 inside the outer 22, the same
   contact shadow). The pad thai cell in the Weeknight dinners mosaic is the frame that convinced me. A photo and a
   plate are now the same object. The radii nest correctly (22 − 6 = 16), which is a detail most people miss.
3. **The key is for reading only.** `plate.key` is used for the overline, the group labels and the grab line, and
   never for anything you press. I checked every light key on the worst wash: tomato 4.92, terracotta 5.09, butter
   5.57, olive 5.49, sea 5.73. All pass. Giving tomato chili's key, so that "CHICKEN" is never red like an error, is
   good judgement.
4. **`plate.*` is a closed token family. Only `Plate` reads it.** This settles D15 cleanly. One guard rule, no
   exemption list.
5. **Active states use shape as well as hue.** The tab has a filled pip, a filled glyph and weight 750. The sidebar row
   has a tint, a 4 px basil bar and weight 750. Inactive labels are `ink` on glass at 0.84 / 0.80. This fixes my
   round 1 glass finding properly, not by luck.
6. **The editor has no plate, on purpose.** A Fraunces section title, paper fields with pewter edges (3.64 on paper),
   and a ring set 2 px out from the field. It is the calmest screen in the set. That is correct for the screen where cooks spend the most time.
7. **D11 is honoured as specified.** Slate `#6B645C` and pewter `#8A847C` are now used as the owner set them. That
   removes an amendment, which costs the owner nothing to approve.

## Problems to fix, most important first

### 1. The ground rule puts pale food on pale ground, and the forced edge does not save it

The concept sets its own bar: "a value gap of at least 1.3:1, or a forced edge". Its open risks already name the
chicken skin on terracotta, and that is to its credit. But the risk is wider than one pair. I measured the motifs the
generator actually placed against the grounds it chose:

| Plate (where)                      | Motif on ground                          | Ratio    |
| ---------------------------------- | ---------------------------------------- | -------- |
| Roast chicken hero (Recipe detail) | skin `#F1CFAE` on terracotta `#E9B48C`   | **1.26** |
| same                               | skin shadow `#DDA97E` on terracotta      | **1.13** |
| Pancakes (Home)                    | lemon `#F4D93E` on butter `#F3D67F`      | **1.01** |
| same                               | egg `#E9C9A2` on butter                  | **1.10** |
| Focaccia (Home)                    | flour bag `#D9B98A` on olive `#C5CC94`   | **1.10** |
| same                               | oil `#B9C25A` on olive                   | **1.14** |
| Grilled corn (Cookouts mosaic)     | corn `#F2C84B` on butter                 | **1.12** |
| Pork shoulder fallback (Day one)   | steel fork `#8E989A` on tomato `#E5624A` | **1.15** |

The forced edge does not close the gap. `.cut` is `drop-shadow(0 1.3px 0 …)` at 24 % alpha. It offsets down only, so
each shape gets an edge on its bottom and nowhere else. The top and the sides of the chicken, the lemon and the flour
bag melt into the ground.

The cause is in the system, not in any one plate. The family rule puts a food on the ground of **its own colour
family**: egg and citrus on butter, oil and grain on olive. Matching the hue makes the values match too. The six light
grounds also sit in one narrow band of value (relative luminance 0.45 to 0.69, except tomato at 0.26). So for pale
food, which is most food (dairy, egg, flour, chicken, potato, rice, corn), **no** light ground gives a real gap.
Chicken's best option is tomato at 2.31, and lemon's is tomato at 2.40. So a rule that picks the ground by contrast
from this palette does not fix it.

What saves the pancakes plate is the ricotta: a deep teal bowl (`#2F5E63`) at **5.08** on butter. That is the answer,
and it is already in the concept's own vocabulary. Mise en place _means_ little prep bowls.

**Fix:** add one rule to the generator. _A hero below 1.5:1 against its ground sits in a vessel._ The seed picks the vessel from a small neutral set: a deep glazed bowl, a slate board or an enamel tray.
Make
the vessels deep (at the value of `m-bowl`), so a pale hero on one is 4:1 or more. Then the chicken sits on a slate
board, the lemon in a blue bowl and the flour in a dark crock. You keep the family ground, and the food finally reads
at thumbnail size. Apply the same check to the supports, with a lower floor of 1.3. The edge alone is not enough at
24 to 40 px.

### 2. "Stored at first save" freezes the plate before the recipe has ingredients, and it breaks the honesty rule later

The editor saves a draft as you type. ADR-0057 keeps a device draft with server checkpoints, and ADR-0058 saves a
never-published draft in place. So the first save usually holds a title and nothing else, and no ingredient is matched yet. Under the
stated rule (point 7: "the seed is created and stored at first save. Later edits never change the plate"), almost
every recipe freezes as a **fallback** forever. The "Roast tomato soup" draft on Home is exactly that case. The
first-save "plate assembles" motion then has nothing to assemble.

The rule also conflicts with itself. If a cook later swaps the chicken for tofu, the frozen plate shows chicken, a food
the recipe no longer uses. Point 4 says that must never happen.

**Fix:** split the seed from the content.

- Store the **seed** (corners, rotation, accent, vessel) at first save. It never changes.
- Compute the **ingredients** on the plate (hero and supports) and freeze them at the first save that has a matched
  hero, or at first publish (`first_published_at` from ADR-0058, which already exists), whichever comes first.
- After that, the plate changes in one case only: one of its three ingredients leaves the recipe. Cross-fade over
  400 ms, the same motion as the wash.
- Run the assembly motion once, at the moment the plate first gets a hero. Do not run it at first save.

This keeps "a cook can find a recipe by sight" and keeps the plate honest.

### 3. The layout is one template, so a wall of plates reads as a wall of diagrams

Every generated plate uses the same five points. The hero is at the centre (50, 52), and the supports and the accent
fill three of four fixed corners: (17, 20), (83, 20), (17, 82) and (83, 82). Rotation is never more than 15°. Nothing
overlaps, and nothing is cropped. The four Day one fallbacks are even more alike: the cloth is always at (16, 86) at
0.74, and the utensil is always at (56, 46) at 0.78. Only the utensil and the ground change.

One plate looks crafted. A grid of six, or a 2×2 mosaic of four, shows the same quincunx again and again. That is the
"clip art on a coloured square" risk I raised in round 1. The generator now proves the risk is real. Calm is right, but
here the sameness costs you the excitement the brief asks for.

**Fix:** give the seed three to five composition archetypes instead of one. For example:

- centred, with three corners (today's layout).
- a diagonal spill.
- a tight crop.
- a row of three.
- the hero in its vessel, with the supports tucked against it.

Allow up to 20 % overlap between a support and the hero, so the objects touch the way they do on a real counter. Use
the archetypes for the fallback too. A cloth across a corner with a utensil is fine once. Four of them in a row must
not look like one stamp.

### 4. First-matched heroes favour staples, and the mockup already shows the repetition

The hero is "the first matched ingredient that has a motif". Ingredient lists put the bulk first: flour for bakes,
the protein for mains, and onion and garlic for most savoury dishes. Look at the Holiday baking mosaic: the flour bag
appears in **3 of its 4 cells**, butter in 2 and egg in 2. The focaccia hero is a kraft bag, and the bag also sits in
the cinnamon and lemon cells. Across a real library, a cook's bakes will share one face.

There is a second problem. For a main course the first matched ingredient is often **raw meat**. The hero of the
full recipe page is a pale, raw, whole chicken. Cut paper softens it, but raw poultry is the image food photographers avoid, and every
roast, braise and stew will open on one.

**Fix:** pick the hero from tiers, not from line order:

1. Produce, herbs, citrus and spice: what gives the dish its character.
2. Proteins and the dish's main carb.
3. Staples (flour, butter, oil, sugar, salt, stock), which are only ever supports.

The order inside a tier stays the line order, so it is still a stated rule with no judgement per recipe. The roast
chicken then leads with lemon and thyme, which is what its title says. The family rule then gives the ground, with the
vessel rule from problem 1 as the safety net. Also add a **hero diversity check** to the round 3 audit, beside motif
coverage. Run the rule over the 1919 cookbook corpus the repo already has, and report how many distinct heroes come out
per 100 recipes.

### 5. Dark mode: the lamp makes all six grounds the same brown

The single mechanism (deep grounds plus a lamp, no filter) is the right fix for round 1's double dimming. But the lamp
is one fixed colour, `#FFD9A0` at 30 %, over every ground. These are the centres it produces:

| Ground (dark)        | Centre under the lamp          |
| -------------------- | ------------------------------ |
| butter `#3A3120`     | `#756346`                      |
| terracotta `#3B2C23` | `#766048`                      |
| tomato `#42231C`     | `#7B5A44`                      |
| olive `#2D3121`      | `#6C6347`                      |
| sea `#1F2E2E`        | **`#626150`**, khaki, not blue |

At night every plate becomes a warm brown pool. The per-recipe colour, which the key and the wash depend on, is gone,
and sea loses its identity completely. The grounds are also only 1.30 to 1.43 against the dark canvas, and the plate
shadow cannot show on `#131512`. So the tile edges dissolve, and dark Home reads as six brown smudges.

**Fix:**

- Tint the lamp from each ground's **light** value (for example, sea's lamp is `#A8C6C4`) at about 18 %. Keep
  `#FFD9A0` as a small warm hotspot of 8 % on top of it.
- Lift the dark grounds so each one is at least 1.6:1 against the canvas, or give every dark plate a 1 px inner rim at
  `rgba(238,235,227,.08)`, as you already do on the glass edge.

The lamp idea is good. It just needs to keep the ground's hue.

### 6. The concept and the code disagree on the dark wash

The concept says that every wash is "12 % of the first image's ground". The code uses **60 %** for the dark page wash
(`.t-dark .wash`) and **55 %** for the dark recipe sheet (`.t-dark .rd`). The dark ratios in the concept (ink-muted
6.35 on the butter wash) match the 60 % code, not the 12 % text. At 12 % the dark wash is `#181814`, which you cannot
see. So the code is right and the text is wrong. Make the mix ratio a **per-theme token** (`wash.mix`: 12 light,
60 dark) and fix the text. If the build team reads the concept, they will ship an invisible dark wash.

### 7. A rule-level risk: pewter on the tomato wash

This is not a failure in the mockup. It is a gap in the rule. `line-control #8A847C` on the 12 % tomato wash is
**2.93:1**, below 3:1. On terracotta it is 3.14, and on butter 3.23. In the mockup, `.keep`, `.stepper` and `.search` have a
`paper` fill. So their rings sit on paper at 3.64 and pass. The controls with no
fill (`.box`, `.num`, `.timer`) all sit below the wash. But nothing in the rule keeps it that way. An outlined control
with no fill inside the top 360 px of a tomato-ground screen fails SC 1.4.11.

**Fix:** write the rule down. Every control in the wash band gets a `paper` fill. Or add a wash-only edge role at
`#827C74` (3.26 on the tomato wash, 3.70 on canvas). Do not change D11's pewter.

### 8. Type and motion: both hold, with one change each

**Type.** Fraunces 560 with SOFT 100 and optical size auto is now right at every size. The 22 px floor and the single
weight fix my round 1 notes. Inter 650 heads hold their own beside it. The pairing is warm and readable, but it is
also the most common part of the wellness look I named in the verdict. The 12 px caps overline in the key is the one
type detail that feels like this product. Push it. Set the overline and the group labels at +12 % tracking with
tabular figures. Give the Fraunces titles `WONK 1` at 34 px and up only. The recipe title then gets one
hand-cut letter shape at display size, and the small sizes stay plain.

**Motion.** The plan is calm. There is one signature motion: the checkbox. The assembly (about 400 ms) runs once in a
recipe's life. Tiles fade up 8 px at 240 ms, and the wash cross-fades over 400 ms. Nothing loops. The reduced-motion fallback is
correct. The one change is the trigger of the assembly, which problem 2 covers. Also cap the fade-up to the first
paint of a screen, not each scroll into view, so a long Recipes grid does not ripple.

### 9. Smaller things

- **The Ingredients header now wraps to two lines.** The board has one row ("Ingredients · for 4 · stepper", plus the
  pencil). You disclosed it, but it is still a layout change. Set phone section heads to Fraunces 24 instead of 28.
  "Ingredients" then takes about 128 px, and the whole row fits in 358 px. Steps and Coming soon follow the same size.
- **The light skeletons almost vanish.** You lifted the dark skeleton to 1.43 against paper so that the Soon cards "no
  longer vanish". The light skeleton (`#ECE6D9` on paper) is 1.22. Treat both themes the same way.
- **The empty part of the 4.8 star** (`#E3DCCD` on canvas) is 1.22. The number carries the meaning, so this is not a
  failure. But at arm's length the row reads as five full stars. Draw the empty part as a pewter outline.
- **The photo mat uses the family ground.** Coral around pad thai is lovely. A sea mat around a tomato photo clashes.
  For photos only, choose the mat from the photo's main colour (d2's wash rule), or fall back to `paper`.
- **The 80 % star keeps its light colours in dark.** The shared `#star80` gradient sets `#A36A00` and `#E3DCCD` as raw
  hex. The other stars read `var(--saffron)`. So in dark, the fifth star is the wrong colour, and it is a small D15
  leak. Make the gradient stops read the roles.
- **Desktop.** Collections was the right swap, and the mosaics carry the frame. But there is still no desktop recipe
  page. The key and the wash are the round's main new ideas, and they are only shown at 390.

## Bold suggestions to push it further

1. **Bleed and crop: make plates look photographed from above, not arranged as icons.** Let one archetype (problem 3) set the hero at 90–120 % of the tile, so it runs off one or two edges. The frame then cuts the supports in part.
   That is how overhead food photography gets its energy. Large, cropped shapes also survive the 2×2 mosaic, where a
   0.33 support shrinks to about 49 px today. Add one **deep ground** to the light palette for this archetype. A slate
   blue such as `#2F4A5C` puts chicken at 6.33, lemon at 6.58 and flour at 4.99. A wall with one dark tile in five gets
   a rhythm that pastel squares alone never have. The vessel rule keeps the other four calm.
2. **Tie the plate to the ingredient list.** On Recipe detail, give the three ingredients drawn on the plate their
   motif as a 20 px glyph in the checkbox column's gutter, or a small dot in the key. The cook then sees why the plate
   looks the way it does ("that's my lemon"). The plate stops being decoration and becomes part of the recipe. It adds no row and no motion, and it does not change the order. But it does add a visual element to the
   list, so put it to the owner as a proposal.
