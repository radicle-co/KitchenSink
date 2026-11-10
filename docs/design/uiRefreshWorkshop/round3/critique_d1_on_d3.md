# Critique: Designer 1 on Designer 3, "Mise en Place, Set" (Round 3, final)

Reviewed: `round3/d3/concept.md` and `round3/d3/mockup.html`. I read the source. I also rendered the whole file in
headless Chromium with the real Fraunces and Inter, and looked at every frame. I measured contrast with the WCAG 2.x
relative-luminance formula, and ground differences in OKLab. This is design judgement. None of it is user evidence.

There is no round 4. So each "must fix" below is written as something the build spec has to carry, or as a decision
for the owner. Nothing here asks for another mockup.

## Verdict

The system is now sound. Every one of my six round 2 must-fixes was taken, and each one is drawn, not just promised:

- **The freeze rule.** The seed is stored at first save, and the foods freeze at first publish. The four-step "plate's
  life" panel is the clearest piece of product thinking in this workshop. It shows the chicken leading while the
  recipe is a draft. It also shows that a freeze at that point keeps the wrong face.
- **The flagship passes its own rule.** The chicken's skin on plum is 2.24:1. In round 2 it was 1.26 on terracotta.
- **Six grounds that behave like six.** I re-ran OKLab on the dark set. Your table is right: sage against sea at
  ΔE 5.9 is the closest pair, and sea against slate is 7.4. The dark grounds sit 1.70 to 2.05:1 off the canvas, and
  the dark wall reads as six colours, not one brown.
- **Calm covers.** Each mosaic has one shared ground and heroes only.
- **Eight fallbacks from consecutive seeds.** They vary in cloth, corner, tool and angle. The ground ignores the dish.
- Crumbs, the folder-butter, the avatar role, the pewter star outline, the `ink-muted` editor dots, and Home's matched
  section heads are all fixed.

The chrome is the best in the workshop: oat paper, green-black ink, one basil and flat cards. The 34 px Fraunces
title in the plum key makes each recipe page calm and clearly its own. Light and dark both hold.

On taste, my honest call is this. The pages are attractive and calm. The plates are **not yet exciting**, and at
library scale they will not feel fresh. The structure is right. Two things hold it back: how the face and the board
are chosen, and how the motifs are drawn. Both are fixable in the build. Neither is fixed by this mockup.

## Must fix (most important first)

### 1. Lemon recipes all get one face, and the logo now has it too

Look at Home at 390. "Lemon ricotta pancakes" is a big lemon slice on plum with a pale round support. Then open the
flagship, "Lemon and thyme roast chicken". It is also a big lemon slice on plum with a pale round support. The cook
sees two different dishes with the same picture, one tap apart. In the Collections wall, "Weeknight dinners" and
"Breakfast for guests" are both plum with a lemon, and "Holiday baking" has a lemon too. The 1280 sidebar mark is a
lemon on plum as well.

This is not bad luck in the sample. It comes from two rules working together:

- **The ground is a pure function of the hero.** Yellow always goes on plum. So the board adds no information that the
  hero did not already give. Two recipes with the same hero always have the same plate colour.
- **The ladder ranks title-named foods first, in title order.** English recipe titles put the flavouring first and
  the dish last ("Lemon … chicken", "Lemon … pancakes", "Lemon asparagus risotto"). So the flavouring wins the face.
  Lemon, garlic and chili are the most common flavourings there are. They are the opposite of distinctive.

"No hero more than three times" is measured on 22 recipes you chose. A real library has many lemon, garlic, tomato and
chicken titles. Plum and slate will also take most of the wall. The reason: yellow and pale foods are most of what
people cook (lemon, corn, egg, cheese, pasta, rice, potato, chicken).

I accept your answer on my neighbour-tile rule. A repeat is better than a plate that changes on each sort or filter.
The fixes below are all stable under sorting, because each one depends only on the recipe.

- **Two grounds per family, picked by the seed.** Give each colour family two passing grounds, for example yellow on
  plum or on slate, and red on sea or on sage. The stored seed picks one. The face is still frozen and still the
  recipe's own. But two lemon recipes now have a 50% chance of different boards. This also cuts the number of bowls
  (see point 3).
- **Among title-named foods, prefer the last one, unless it is a staple.** The dish noun comes last in English
  titles. So the roast chicken gets the chicken on slate (6.33:1), with the lemon as a support (lemon on slate is
  6.58:1). If no pancake motif exists, the pancakes keep the lemon. Keep your ladder below that. This is one
  change in the generator.
- **The logo must not be a plate.** A brand mark made from one recipe's face turns lemon-on-plum into the app's
  identity. That makes it worse every time a lemon recipe repeats it. Draw the mark from the chrome instead (ink,
  basil and the paper edge), or from the cut-paper language with no food in it.
- **Add a distribution check to the motif audit you already owe.** Run the audit over the top 300 foods. Report how
  many heroes are found, and also the share of plates on each ground and the share of the top five heroes. Pass bar
  (my proposal): no ground over 25% of plates, and no single hero over 8%.

### 2. The motifs read as an icon set, not as crafted print

Look at the Collections wall at 1280 and the light wall panel. The plates are tomato, chili, corn, broccoli,
mushroom, carrot and a lemon slice with eight spokes. These are the standard flat food icons that every stock icon library
ships. The "cut paper" edge is there in the source. At tile size it reads as a drop shadow, and the grain does not
show. Inside bowls, every cell becomes a circle in a circle, so "Weeknight dinners" reads as a row of buttons.

The concept stands or falls on this. A wall of stock-looking icons will feel like a template. That is the one thing
the brief rules out. The motif library is "real illustration work", as you say. The build spec has to set its bar,
not just its count. Give the illustrator a style sheet with these rules:

- **Hand-cut edges.** Slightly irregular contours, no perfect circles, no radial symmetry. Give the lemon slice uneven
  segments and a pith that is wider on one side.
- **Paper you can see.** A two-tone shadow (a tight dark one and a soft wide one) and a fibre texture visible at
  160 px. Today's grain is too faint to read. Keep it out from under text, as now.
- **Slight misregistration.** The colour fill sits 0.5 to 1 px off its shape, the way screen-printed or cut-paper work
  does. This is cheap, and it is what moves a picture from "icon" to "print".
- **A test at the real size.** Each motif is judged at the 160 px tile, not at the 390 px hero.

### 3. Bowls show the finished dish, which the concept said it never does

The light vessel rule puts a failing hero in a ceramic or glaze bowl. In the file that is tomato on plum, broccoli on
slate, rice on slate, lime on clay and lemon on butter (Holiday baking). A food in a bowl reads as a served dish, not
as a station. It is also the most repeated shape on the wall.

Fix: make the bowl the last resort, not the first. With two grounds per family (point 1), try the second ground
first. When both grounds fail, use the bowl. I expect bowls to drop from about one in four cells to
almost none.

### 4. The desktop recipe page needs its own translation, and it is not stated

Only Collections is shown at 1280. Dark mode is shown only on the phone recipe page. The two ideas that give a recipe
its identity are phone ideas:

- the full-bleed plate with the sheet overlapping it by 28 px and a grab line in the key.
- the 34 px key title on the wash band.

The desktop board (`RecipeDetail.dc.html`) is a different layout. At 60 rem and up, the title, facts and actions sit
in columns 1 to 5. The photo is a 16:9 card with a 16 px radius in columns 6 to 12. There is no full-bleed hero and no
sheet. As written, the build must invent all of this. Add one paragraph to the build spec:

- The plate fills the 16:9 card, at radius 24 (your desktop plate radius). The safe area is the middle 70% of the
  card. The hero controls are glass, as on the phone.
- There is no sheet and no grab line on desktop. The key colours the title, the overline and the group labels, as on
  the phone.
- The wash band runs across the top of the content area, behind both columns, and stops at 360 px. Controls inside it
  keep the paper fill.
- In dark, the card takes the per-ground lamp and the 1 px inner rim.

### 5. In dark, the food outshines the page

The dark grounds were lifted, but the motifs "keep almost their daytime values". The dark lemon `#E9D24A` is 7.11:1 on
the dark plum and **12.05:1 against the canvas**. That is brighter than the title (dark plum key `#D8AFD0` on its
wash, 7.47:1). On the dark recipe page the lemon is the loudest object on screen. That is a glare spot at night, and
it works against "night kitchen" and "calm".

Fix: give motifs a dark value one step down, as you did for the creams. A target of roughly 5 to 7:1 against the
dark canvas for the main fill keeps the complement pop. Keep the warm hotspot, because it is what sells the lamp.

### 6. The drawn-food glyph cannot be seen, so it cannot do its job

The proposal sells the line-end glyph as "that's my lemon". The lemon glyph on paper is **1.39:1**. In the light render
I found the chicken glyph and the thyme glyph only by searching for them. Pick one of two options:

- **It carries meaning.** Draw it on a 22 px disc of the recipe's ground, with the motif inside. Plum against paper is
  about 2.95:1 for the disc edge. Add a 1 px `line-control` ring to clear 3:1. The cook then sees a small piece of the
  plate on the line, which is the point.
- **It is decorative.** Then say so, mark it `aria-hidden`, and accept that most cooks will never notice it. In that
  case I recommend you drop it. It adds an element to the board and gives almost nothing back.

I recommend the first option. It is also the strongest link between the plate and the recipe in the whole concept.

## Smaller points

- **The Discover photo mats still read as a selection ring.** At 390, the 4 px plum mat around the carbonara photo and
  the sea mat around the shakshuka look like a selected state. A coloured stroke round a photo also fights the photo.
  Drop the mat at grid size. Keep it only on the recipe page hero, where nothing can be selected.
- **The status bar over plum is on the edge.** Ink on the plum hero is 4.52:1. Plum will be the most common ground
  (point 1), so the most common hero sits 0.02 above the line. Change the generator's rule. Today it is "whichever is
  higher". Make it "ink at 5:1 or more, else paper". That leaves room for the grain and for the photo case.
- **Saffron stars on the plum wash are 3.66:1.** This passes 3:1 for a glyph. Keep the "4.8" number next to them, as
  now, because the number carries the meaning.
- **The Collections mosaic still has 4 px paper gutters.** They cut the shared ground into four tiles again. Drop the
  gutters and lay the four heroes on one continuous ground, in your "row" or "station" archetype. Then the cover truly
  is one tile. The pad thai photo cell in "Weeknight dinners" also breaks the shared ground. When a collection's first
  item is a photo, either use the photo as the whole cover, or skip photos in the mosaic.
- **The red onion face for "Red lentil dal with crispy shallots".** The shallot-to-onion synonym makes a raw red
  onion ring the face of a dal. The shallots are a garnish here, and they are fried. This is the motif coverage gap
  showing itself. Lentils, chickpeas, rice and noodles are the faces of many everyday dishes. They are beige and hard
  to draw, so put them first in the library work.
- **Write the per-ground status-bar choice and the 55% dark wash into the token table** as values, not prose. These
  were the two places where round 2's prose and code disagreed.

## What to keep

- **The plate's life**, split into the seed and the content. It is correct and buildable, and it ties to a fact the
  app already records (`recipes.first_published_at`).
- **The key title.** One coloured Fraunces title under a coloured plate is the moment of identity this concept needed.
  It costs nothing in calm.
- **The complement idea**, with the checks run inside the generator: the 1.5 floor for heroes, the 1.3 skip for
  supports, and the dark rim. Keep it as a rule over a _set_ of grounds, not as one ground per family.
- **Status chips on solid paper with a ring in dark, and no text ever on a ground.** A build can enforce this.
- **The chrome: flat paper cards, one basil, pewter edges, and the filled tab pip.** These are quietly excellent.
- **The plate-free editor**, and progress dots in `ink-muted`.
- **The shared-ground cover.** It is right. Finish it by removing the gutters.
- **The fallback panel.** It now varies like a real seed, and it is honest that a fallback is temporary.

## Two bold suggestions

### A. Make the plate a print, not a picture

Treat the plate as a two- or three-colour cut-paper print. Every motif on one plate is drawn from the same three inks:
the ground, one deep shade of it, and one accent from the complement family. The lemon is not "lemon yellow" any more.
It is the plate's accent ink, laid over plum with a visible paper edge and a little misregistration. Two lemon plates
on different grounds then look like two prints from one series, not one icon pasted twice.

This does three things at once. It kills the stock-icon look (point 2), because no icon set is drawn this way. It
makes the dark-mode fix trivial (point 5), because the dark plate is the same print in dark inks. It also makes the
wall feel like a curated set of posters. That is the "fresh and exciting" the brief asks for. It stays calm, because
each plate holds only three colours.

### B. Let the plate carry the dish, not only the ingredient

A single raw ingredient tells a cook little about the dish. A lemon does not say "roast chicken". Without drawing the
finished dish, the archetype can still hint at the method. Your seed already stores an accent. Choose it from the
recipe's steps instead of at random: a roasting tin edge for "roast", a ladle for soups, a rolling pin for pastry, a
wok for stir-fries, and twine for anything trussed. The step text already exists, so this is one more lookup in the
generator. The plate then reads as "lemon, thyme, chicken, roasting tin". That is very close to the dish, and it
still never draws food that is not on the list.
