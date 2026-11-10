# Critique: Designer 3 on Designer 1, "Still Life, Lit" (Round 2)

I read `concept.md` and the full source of `mockup.html`, and I recomputed the contrast pairs that looked doubtful.
Every number below is computed from the hex values in the file (WCAG 2.x relative luminance). ΔE is CIE76 in Lab.
This is design judgement, not user evidence.

## The verdict in short

This is the most disciplined proposal in the workshop. Round 1's rule breaks are fixed, and the fixes are real in the
markup, not only in the prose. The parts library is a genuine proof: every cover is `<use>` of shared vessels, forms
and marks. The contrast table is honest, and nearly all of it checks out.

But the round's new headline idea, **"the food also lights the room"**, does not show on screen. The terracotta wash
is ΔE 4.2 from plaster. The tomato wash is ΔE 2.8, which is about one just-noticeable step. Both are **weaker than the
global warm corner they replace** (ΔE 4.9). So the one idea meant to make photo recipes feel new is invisible. And the
chrome is still cream, cream paper and a soft serif: calm, well made, and still a known look. The excitement still
rests almost entirely on the covers. The covers now carry it better, but three of the data rules under them are not
yet sound (problems 2 to 4).

Round 3 is the last round. Anything owed must arrive then or not at all.

## The strongest ideas, worth keeping

- **The parts library, proven in markup.** Vessels, forms and marks, coloured through custom properties and composed
  with `<use>`. This is the right way to specify a generator. It also makes the dark theme a token swap, not a redraw.
- **Concentric radii, exactly.** Card 18 = cover 12 + mat 6. Full card 24 = 18 + 6. This is the kind of detail that
  makes a UI feel crafted without anyone knowing why.
- **"Pewter never sits on linen."** A rule derived from a number (2.93 fails), then applied everywhere: every outlined
  control gets its own paper fill. I checked: the stepper, switch track, chips, search and Filters button all comply.
- **`actionText` split from `action`.** Seafoam `#31807A` stays the fill (white label 4.67). `#2A6B65` carries text
  and the focus ring (5.28 on canvas, 5.05 on tint). Correct and clean.
- **`CoverSpec.statusBar`.** The status bar style comes from the cover's top band. Right layer, right owner.
- **"The cover draws itself"** in the existing editor slot. It rewards ingredient matching, which also feeds
  nutrition. It adds no control. This is the best single idea in the round, from any of us.
- **Line sketches for Coming soon.** Pewter line studies replace grey bars. They give the placeholders dignity.
- **Develop-fade only on the first render per id per session.** This fixes the recycle flicker properly.
- **Numbers always in Inter, tabular.** Including step numerals. Good.
- **The residual-risk list.** Plain and honest, especially "the marks were placed by hand".

## Problems, most important first

### 1. The recipe's own light cannot be seen

The math, at t = 0.25 over plaster `#F3ECE1`:

| Ground                        | Wash      | ΔE to plaster | `inkMuted` on wash |
| ----------------------------- | --------- | ------------- | ------------------ |
| terra (the chicken)           | `#F0E3D4` | 4.2           | 4.62               |
| blush (the tomato soup)       | `#F1E5DA` | **2.8**       | 4.71               |
| ink (the ramen)               | `#C2C0BA` | 19            | **3.20, fails**    |
| global warm corner (replaced) | `#FAF0DC` | 4.9           | 5.15               |

Three things follow.

- On the light grounds, the wash is too faint to notice. It also fades out by 420 px, and most of that height is
  covered by the paper strip and the paper accordion. The "warm-red dawn" on a tomato soup page will not be seen.
- On the dark ground (ink, the ramen), the raw mix is a **grey** cast, and it fails contrast. Your guard lowers t until
  `inkMuted` reaches 4.6. That happens near t = 0.05, which is grey again but barely visible. So a dark-ground recipe
  gets a dirty, faint wash. That is the worst of both outcomes.
- The table says the worst ground is the tomato at 4.60. It is not. On the chosen grounds the worst is the ink
  ground, unguarded at 3.20. Terra is 4.62 and blush is 4.71.

**The fix:** do not mix the ground's raw colour. Build the wash in OKLCH. Take the ground's **hue** only. Fix the
lightness (about L 0.93, the same as plaster) and fix the chroma (about 0.03 to 0.04). Then:

- every recipe gets the same, clearly visible strength of light (aim for ΔE 6 to 8, not 3).
- contrast holds by construction, because lightness never moves, so the guard is no longer needed.
- the ink ground gives a cool blue-grey dawn instead of a dirty grey.

Then show it working: three detail pages side by side (terra, blush, ink) on one board. That is the only proof this
idea has.

The dark value is also off. `#281E18` is stated as t = 0.25 of terra over `#151311`. The true t = 0.25 mix is
`#221B16`. The dark recipe page is never drawn, so this was never seen.

### 2. "Rarest in this cook's library" makes covers change, and differ between people

The hero is "the food rarest in this cook's library". That breaks the promise that "a cover never changes between
visits":

- When the cook adds three more lemon recipes, lemon stops being rare, and **every old lemon cover changes its
  hero.** The layout hash is stable, but the picture is not.
- On Discover, whose library counts: the author's or the viewer's? If it is the viewer's, the same recipe looks
  different to different people. A saved copy changes its picture the moment it is saved.

**The fix:** at save time, decide the hero once and store it in the `CoverSpec`. Use catalog frequency
(global, stable) as the rule. Use the cook's library only to break ties at save time, then freeze it. Change it only
after a change to the recipe's own ingredients.

### 3. The taxonomy on the sheet does not match the taxonomy in the concept

The concept lists 8 dish forms: noodles, swirl, stack, rice, pieces, folded, scatter and bird. It says "eggs are a
mark, not a form". The sheet's captions then use forms that are not on the list: `skillet · eggs`, `bowl · sauce`,
`bowl · broth`, `jar · oats`. A builder reading both will not know what to build.

Four of the forms are also not parts in the generator sense. `d-stack`, `d-bird`, `d-cookies` and `d-taco` have
hard-coded fills (`#dca55a`, `#c98b4a`, `#c98d4f`, `#e3b867`). So they cannot take a swatch. In dark they rely on
the `brightness(.92)` stand-in. `d-bird` fits only a whole bird. `d-taco` ("folded") fits tacos, not an omelette, a
dumpling or a crêpe. `d-cookies` ("scatter") draws cookies, not a scatter.

**The fix:** one table, used by both the concept and the captions. Every form takes its fill from a swatch variable.
And name the honest count: how many forms are generic, and how many are one dish.

### 4. The fallback will be the most common cover, and it is the least designed

Many real recipes will have few or no matched ingredients at first, especially imported and pasted ones. Those get
"vessel on ground", and the sheet shows it as bibimbap: a bowl on plaster. On a real day-one library that is a wall of
empty bowls on beige. That is the exact "25 plates on beige" failure we named in round 1, moved one step later.

Also, the concept says an unmatched recipe takes its ground from the **cuisine** table, with plaster as the last
resort. Bibimbap's cuisine is plainly Korean, yet it is shown on plaster.

See bold suggestion B for a way to turn this state into a strength.

### 5. The current step is now the loudest thing on the recipe page

It carries five signals at once: a saturated butter fill (`#F5E2A8`), a 4 px honey rail, a warm drop shadow, a solid
seafoam numeral, and a new "Now" tag. Round 1's was too weak. This one overshoots. Against plaster it reads as a
highlighter mark or a sticky note, which is the opposite of calm.

Two rendering defects as well:

- **The rail will curve.** `inset 4px 0 0` on an element with an 18 px radius draws a crescent that follows the
  corner, not a straight bar. Draw the rail as its own element, clipped by the card.
- **The text jumps on a step change.** `.step` has `padding: 14px 12px 14px 0`. `.step.now` has
  `padding: 16px 14px` and `margin: 8px -6px`. So the numeral moves 8 px right, the text column narrows, and the
  lines reflow. Your 200 ms "light moves" transition will animate a reflow. Give every step the same box and change
  only the fill.

The numeral is also the control: today's board marks it `role="button"`, "Mark step 2 as current". At 32 px it is
under your own 44 px target rule. Its tint disc is 1.05:1 against canvas. So nothing shows it can be pressed.

**The fix:** keep the fill (softer, about `#F7EAC4`) and the solid numeral. Drop the shadow and the "Now" tag. If the
tag stays, it is new copy and needs a localisation key. Make the numeral's hit area 44 px, and give the resting
numeral a pewter ring on paper (3.62), so it reads as a control.

### 6. Dark mode: the plates are bright discs on a dark counter

The dark plate is `#D9D0C3` on paper `#25211D`. That is **10.47:1**. On the dark Home, three of four covers show a
plate filling about 60% of the cover's width. At night that is a grid of near-white circles, the brightest things on
the screen, brighter than the food. "Food keeps its chroma" is right. The plate must not out-shine it.

**The fix:** step the dark plate down to about `#9C9488` and the rim to match. Let the food be the brightest thing in
the frame. Show it on the dark sheet next to the light one.

Also, the key dark frames are missing. There is no dark recipe page. So nobody has seen the dark wash, the dark
kitchen light (`#362D1C`) or the dark checkbox in context. The dark Home also drops the "Coming soon" heading and its
intro line, so its structure no longer matches light Home.

### 7. Photos and still lifes: the stand-ins prove less than they claim

Two concerns.

- **The value range differs.** The photo stand-ins are dark, vignetted and blurred. The covers are pale, flat
  pastels. On Discover they alternate in a checkerboard of dark and light. A 6% warm grade and shared grain cannot
  close a value gap. And the stand-ins were drawn by the same hand as the covers, so they are a best case, not
  evidence. Show one real, bright, top-down photo (a white plate on marble) next to the covers.
- **Do not alter a cook's photo.** Grain at 9% and a warm grade on someone's own photo makes it muddier than the one
  they took, and they will notice. Give photos the mat and the inner ring only. Keep grain for generated covers. If
  the vignette (`#vig`) is part of the photo treatment, drop it. If it is only part of the stand-in, say so.

### 8. The photo scrim fails on bright photos

The 96 px top scrim (0 to 30% ink) with light status text is quoted as 5.98 "over a mid-tone photo". Over a white
plate it is **1.85**. Over cream it is 2.11. You plan to sample the photo's colours for the wash anyway. Reuse that
sample to pick `statusBar` for photos too, the same way covers do, and keep the scrim as a fallback only.

### 9. Smaller accuracy points

- **Discover card feet will not line up.** Titles wrap to one or two lines ("Shakshuka with feta" against "Red lentil
  dal with crispy shallots"), and `.foot` is not pinned to the bottom of the card. So bylines and copy buttons step up
  and down across a row. Clamp titles to two lines and put `margin-top: auto` on the foot.
- **The selected tab** is marked by tint (`#DDEBE7`, 1.05:1 against canvas, about 1.1:1 on the glass), the text
  colour, a weight step from 500 to 600, and a 22% icon fill. That is mostly hue. The pills are fine, because they
  carry a check. For the tab, make the icon fill stronger (about 40%) or add a 2 px `actionText` indicator, so the
  state survives greyscale.
- **"One solid primary per screen"** is how the calm section reads. In light, the recipe page has three solid seafoam
  shapes: Edit recipe, every checked box, and the current numeral. The colour rule holds. The "one solid" rule does
  not. Reword it, or treat checked boxes in light the way you treat them in dark.

## Phone against desktop, and the layouts

The layouts are kept. Home is 2 × 2 with three stacked Coming soon cards. Discover at 960 px is three columns, as
today's `minmax(240px, 1fr)` produces. The recipe page order matches the board. Good.

The coverage is thin for a final round, though:

- **Desktop:** only Discover. No desktop recipe page. That is where the wash spreads across a 12-column layout,
  and where it is most likely to look like a stain or vanish.
- **Phone:** no Discover at 390. That was asked for in round 1, and it is where other cooks' photos meet our covers
  at the smallest size.
- **Missing screens:** the Recipes list (the "wall of your own food", which is your main excitement claim), Collections
  and the editor. The editor was declined again and marked "owed in round 3". Round 3 is the last round, so it must
  arrive then.

## Two bold suggestions to push it further

**A. One transition that carries the whole idea.** A cook taps a card. The matted print lifts and grows into the
recipe hero. The mat dissolves into the sheet's top edge. As it lands, the recipe's light (fixed as in problem 1)
blooms down the sheet in 240 ms. It is one shared-element motion, it plays once per open, and nothing loops. It turns
"each recipe is its own room" from a static tint into a moment: you walk into the room. Under reduced motion it is a
cross-fade. On native it is a React Navigation shared transition. On Android, fall back to a plain cross-fade where the
shared transition proves fragile.

**B. Make the fallback the "unfinished study", and let the library ripen.** Take your own Coming-soon sketch
language. Use it for any cover with fewer than two matched foods. Draw the vessel as a pewter line study on paper, with the cuisine's
hue as a faint wash. Each matched ingredient then fills in, exactly as "draws itself" does in the editor. Now the
weakest state becomes a feature: a new cook's library looks like a sketchbook that fills with colour as they use the
app. The sketches, the covers and the editor become one visual language, not three. It also answers problem 4 at its
root, because the empty state is designed rather than merely survived.

## What I want to see in round 3

1. The recipe's light rebuilt in OKLCH, with three detail pages (terra, blush, ink), light and dark.
2. The hero rule frozen at save time, and one form table that matches the captions.
3. The fallback cover designed (suggestion B, or your own answer), shown as a day-one library of 8 to 12 recipes.
4. The current step quieted, with the reflow and rail defects fixed.
5. The dark plate stepped down, and a dark recipe page.
6. The Recipes list at 390 px, Discover at 390 px, the editor at 390 px, and a desktop recipe page. This is the last
   chance to show them.
