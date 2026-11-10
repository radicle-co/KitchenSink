# Critique: Designer 3 on Designer 1, "Still Life" (Round 1)

**What I read:** `round1/d1/concept.md` and the whole of `round1/d1/mockup.html`. I checked them against the
current boards (`HomeMobile`, `Home`, `RecipeDetailMobile`), `ownerDecisions.md`, `buildSpec.md` and both
modernize answers. I recomputed every contrast pair below with the WCAG 2.2 formula. This is design judgement.
None of it is user evidence.

## The verdict in short

This is the most _authored_ direction I expect to see this round. "The chrome is a gallery wall, and the colour
comes from the food" is a real idea, not a style. The still-life covers are the one thing on these boards that
can make a cook smile on first open. The restraint everywhere else is mostly right.

But the proposal has two weak spots:

1. **The excitement is carried by one idea, and that idea is shown at its best case only.** The covers are
   hand-drawn dishes. The spec describes a generator that places ingredient marks around a vessel. Those are not
   the same picture.
2. **The chrome around the covers is three creams at about 1.1:1 to each other.** A cook who adds photos sees
   very little of the new language. That is the "meh" risk the brief asks us to remove.

Fix the rule breaks listed below, and make round 2 prove the generator. If the generator holds up, I think this is the
direction.

## What is strongest, and worth keeping

- **The cover system as a concept.** Every recipe gets its own picture on day one. The dead monogram square
  and the "broken image" grey that modernizeA #6 complained about are gone. A pure `recipe → CoverSpec` function,
  rendered by one `react-native-svg` component on both platforms, with a stable hash for layout, is the right
  architecture. Keep it.
- **"The colour comes from the food."** One action colour on the chrome, and saturated colour only in content.
  This follows the WWDC "colour in the content layer" rule and the owner's coral ruling. It is calm by
  construction.
- **The print-in-a-mat card.** The 6 px paper mat around a 16 radius cover inside a 22 radius card is the one
  shape a person will remember. It makes the card feel made, not drawn by a kit. Concentric radii are not new
  (problem 9). The mat as a _print frame_ is new.
- **Kitchen light for the current step.** A warm fill plus a honey rail is a lovely cooking metaphor. It needs
  more strength (problem 7), but keep the idea.
- **Numbers stay in Inter with tabular figures, even step numerals.** Correct, and well done in the time strip.
- **Dark mode as "an evening kitchen".** Warm brown-black, no shadow, a 1 px hairline instead. The direction is
  right.
- **Honest numbers.** I checked D1's table. I **verified** these to two decimals:
    - white on bay 6.28, and `inkMuted` on linen 4.75
    - `lineControl` on paper and on linen, 3.62 and 3.01
    - bay on tint 5.20, and ink on kitchen light 13.37 and 11.92
    - the honey rail, 3.67 and 6.58
    - dark label on mint 7.97, and dark `actionText` on tint 7.36
    - light glass worst case 4.62, and cover chip worst case 13.90

    That honesty is rare. Keep doing it.

## Problems, most important first

### 1. The mockup shows illustrated dishes. The spec describes ingredient confetti.

Look at the five covers:

- the pad thai is a bowl of _noodles_
- the soup has a cream _swirl_
- the focaccia has _dimples_
- the chicken is a _roast bird_ in a tin

None of these comes from "a vessel plus three to six ingredient marks from about 40 swatches". A generator with
those inputs makes a bowl with dots and leaves around it. The concept says this itself ("a generator will be
plainer"), but the board sells the hand-drawn version. That is the part a cook will fall in love with.

There is a second risk, and it is worse. Most recipes share the same top ingredients: onion, garlic, oil,
butter, salt, flour. If the marks come from the first matched foods, a library of 40 becomes 40 beige plates
with the same yellow and green dots. That is the six-tint problem again, only nicer.

**Change:**

- Choose marks by **salience**: the ingredients that are rare in this cook's library or across the catalog, not
  common ones like onion or salt. Pick one "hero" ingredient per cover and draw it largest.
- Add about 12 **dish forms** to the vessel step (noodles, broth, loaf, roast, salad, stack, bake, skewer, and
  so on), keyed from the title and tags, the same way bowl and tin already are.
- In round 2, show **12 generated covers** from a real-looking library, side by side in the 2 × 2 phone grid and
  the 4-up desktop row. Include one 3-ingredient recipe, one with no matches, two recipes with nearly the same
  ingredients, and a dessert. If they read as a family of _different_ pictures, the idea is proven.

### 2. Covers at the size they really appear

The phone cover is about 159 × 131 px. At that size, the thyme leaves (3 × 1.6 units in a 400-wide drawing)
are under 1.5 px, and the herb confetti becomes noise.

**Change:** add a **small level of detail**. Below about 200 px wide, drop marks under 8 rendered px, keep the
hero ingredient and the vessel, and raise the minimum mark size.

### 3. The serif has spread past its job, and this repeats a failure we already ruled on

`buildSpec.md` §1 says the display face sets **names only**: the greeting, large titles, the recipe title and
a collection name. modernizeA #5 and modernizeB both flagged a display serif at 16–18 px in cards as decoration.

D1 sets Fraunces on:

- app-written labels: "Recent recipes", "Coming soon", "Ingredients", "Steps", "Nutrition"
- the "Coming soon" card titles
- the ingredient group label (italic 18)
- card titles at 16.5 px

D1's own rationale is "one serif voice for everything a cook _wrote_". "Ingredients" and "Nutrition" were not
written by the cook. The rulings table does not list this as a change.

Fraunces at a small optical size is a much better text face than Playfair, so the card-title case can be
argued. But it must be **argued and listed**, not slipped in.

**Change:**

- Put section titles and accordion titles back in Inter. Bolder and left-aligned, as WWDC25 356 says.
- Keep Fraunces for names: the greeting, the recipe title, card titles, collection names, and the group labels
  the cook typed. Group labels are cook-written, so the margin-note italic there is a good use.
- Add a row to the rulings table for card titles in a serif.

### 4. The pill rule is marked "Kept" but it is broken in four places

The ruling is that only pressable controls are pills. `buildSpec.md` line 247 lists the cover chips, PRO, the
status badge and the detail timer chip as **not pressable**, with radius `sm` (6). D1 makes all four pills:

- `.full .chip`, radius 14 on a 28 px chip
- `.chip.pro`
- `.badge-soon`, radius 999
- `.timer`, radius 18

**Change:** either use radius 6 on all four, or propose the change to the owner as a ruling change. Do not mark
the rule "Kept" while it is broken.

### 5. Desktop Home falls out of full-card mode

D8 says Home shows 4 **full** cards from a **960 px content width**. The current board gives 1280 − 256 sidebar
− 2 × 32 padding = **960**. D1's `.dmain` uses 56 px padding: 1280 − 256 − 112 = **912**. If the product switches
on content width, this padding pushes 1280 back to compact cards.

**Change:** keep 32 px main padding at 1280, or get room some other way (for example a 240 px sidebar), and
show the arithmetic.

### 6. The phone "Coming soon" layout changed, and one card is missing

The current `HomeMobile` stacks **three** full-width cards: "Today's nutrition", "Resume cooking" and "This
week's meals". D1 shows **two**, side by side in `.grid2`, with grey ghost bars. That is a layout change
(the brief forbids it) and an IA change (an element is dropped). The ghost bars are also the "dead grey
placeholder" look modernizeA #6 warned against.

**Change:** three stacked cards, as today. For the empty state, use a _line-only_ still life drawn in pewter on
linen, like an unfinished sketch. See bold idea B.

### 7. The surfaces are three creams at about 1.1:1, so the chrome alone does not excite

| Pair                              | Ratio    |
| --------------------------------- | -------- |
| paper (card and mat) on plaster   | **1.10** |
| linen (time strip) on plaster     | **1.09** |
| kitchen light on plaster          | **1.08** |
| dark paper on dark canvas         | **1.09** |
| dark kitchen light on dark canvas | **1.32** |

None of these is a WCAG failure, since they are surfaces and not text or controls. But they show the design
problem:

- **The mat relies only on a 5 % shadow.** In dark mode there is no shadow, so the mat is a 1 px hairline at
  1.47 against canvas. Also, `--mat: #26221e` is defined in `.dark` but **never used**: `.card` reads `--paper`.
- **Kitchen light is claimed to be findable "from across the counter".** Its fill is invisible in luminance.
  Only the 3 px rail (3.67) and the filled numeral disc carry it. On a bright counter, the yellow on cream will
  wash out.
- **With photos, little changes.** A photo library keeps almost nothing new: a soft serif, a floating tab
  bar, and a darker green. That is too close to today's sand and seafoam to feel like a new app.

**Change:**

- Separate the levels by about one more step: plaster around `#F1EADF`, or paper kept as is with a visible
  linen mat.
- Use the unused dark `--mat` so the print frame exists in dark too.
- Give the current step **elevation as well as colour**. In a list of flat steps, make it the one paper
  card with a warm shadow, plus the rail and filled disc. Elevation shows at any distance. A 1.08 tint does not.
- Show at least one card with a **real photo** on Home (bold idea A).

### 8. Dark mode: the action colour gets louder, not softer

The concept says the mint fill "glows softly and does not punch a hole". The numbers say otherwise. Mint
`#6CC0B3` on dark canvas is **8.67:1**. Light bay on plaster is 5.59. So in dark, the New recipe button and
every checked box are the brightest things on the screen.

The scrolled dark frame proves it: two checked ingredients are already two bright mint squares (7.94 on
paper). On a 12-line list mid-cook, that is a column of lights.

Also:

- the one dark frame shows **no cover**, so the 26 % dim is never seen
- a global black dim greys the lemons and tomatoes that carry the whole concept

**Change:**

- In dark, give a **checked box** the tint fill (`#1E302D`) with a mint tick and a mint edge, not a solid mint
  fill.
- Keep solid mint only on the single primary action per screen.
- Do not use a global dim on covers. Give each cover a **dark ground**: swap the tablecloth tint for a dark
  linen, and keep the ingredient colours at full chroma, lowered about 8 % in lightness. The food stays
  appetising and the frame stays calm.
- Show dark Home with covers in round 2.

One method note: the dark glass worst case was measured over the _darkest_ cover. For light text on dark glass,
the worst case is the _lightest_ cover. I checked it, and it passes: inactive tab `#B3A99C` on 88 % glass over
the lemon is 5.29, and over the chicken ground it is 5.32. So this is not a blocker. Just measure the right
direction next time.

### 9. Small accuracy and disclosure gaps

- **The "Screen on" switch's off knob** is pewter on linen: **3.01**. The concept says only the difficulty pip
  sits at that pair. It passes by 0.01. A paper track raises it to 3.62. Please disclose it or fix it.
- **The concentric radii are inconsistent.** The full card has 8 px padding and a 15 radius cover in a 22 card,
  so 15 + 8 = 23, not 22. Use a 14 radius cover. Also, "concentric mat shapes" is listed as new compared with
  modernizeA and modernizeB. modernizeB §6 already proposed concentric radii. The mat as a print is the new
  part, so claim that.
- **The web sidebar is described as solid**, as D12 requires. But the CSS is
  `color-mix(var(--raised) 60%, transparent)`, which is translucent. Make it solid.
- **D13.** The New recipe button on iOS 26 is seafoam-tinted real glass by ruling. No glass button is shown.
  Seafoam with white already passes (4.67), so the move to bay is a **taste** change, not an accessibility fix.
  Present it to the owner that way. I also think bay `#1F6B63` reads _deeper and more serious_ than seafoam,
  which works against "fresh". Test a bay button next to a seafoam button on the same Home before
  deciding.
- **Target size.** The current boards give "See all", "Version history" and "8 comments" a 44–48 px min-height.
  D1's `.link` has none, and the jump tabs and timer chips are 36 px. These pass SC 2.5.8 (24 px), but they lose
  the 44 px the app has today. Keep the existing min-heights.
- **No focus, hover or pressed states are shown.** Name the focus ring (bay on plaster is 5.59, mint on dark
  canvas is 8.67, so either works) before round 3.

### 10. Native type: the soft axis and the in-between weights

- **The soft axis.** The whole type voice depends on `SOFT 100`. As far as I know, the Expo Google Fonts static
  instances are the default `SOFT 0` cut. The concept parks this until round 3. It needs checking **before
  round 2**. If native ends up on SOFT 0, web and mobile will sound different, which breaks §14 parity of
  quality.
- **The in-between weights.** The mockup uses Inter 420 / 450 / 620 / 650 and Fraunces 460 / 470 / 480 / 520.
  Native static instances come in 100 steps, so these snap to 400 / 500 / 600 / 700 on a phone. Specify the
  weights that both platforms can actually render.

### 11. Motion: one detail that will flicker

"A cover develops the first time it shows" needs a definition of "first time". In a recycled list (FlashList on
native, a virtualised grid on web), a naive version re-fades every time a cell scrolls back into view.

**Change:** key it to the first render of that recipe id in the session. Never fade on recycle. Also: the
`feTurbulence` grain on every web card is expensive on a long grid. Use the tiled PNG on web too, as on native.
The rest of the motion plan is calm and right.

### 12. Token sprawl

The mockup uses:

- about 13 radii: 8, 10, 12, 14, 15, 16, 18, 20, 22, 24, 26, 28 and 32
- half-pixel type sizes: 11.5, 12.5, 13.5, 15.5 and 16.5
- spacing values with no scale

That is fine for a round-1 board. In round 2, collapse them to named scales: a 4 pt spacing scale, about 5
radii, and a type ramp. Without that, the build will drift.

## The localisation note

The italic name is a styled part of a translated sentence. Build it with rich-text message formatting, for
example `Good morning, <name>{name}</name>`. Some languages put the name first. The forced `<br/>` after
"Good morning," on the phone must also go. Let the line wrap, and check a 30-character name at 34 px.

## Two bold ideas to push it further

**A. Let the recipe's own light fill its page.** The cover already knows a ground colour and a hero
ingredient. Use that ground, at very low chroma, as the **wash at the top of the recipe detail sheet**. Then a
tomato soup page has a faint warm-red dawn, and a pad thai page a faint lime one. The controls stay bay, the text
stays on near-plaster, and the contrast is checked per ground. Do the same for photo recipes, sampling one
muted colour from the photo. This gives every page its own mood while the chrome stays one colour. It is also
the answer to problem 7: a photo library stops looking like the old app. The rule that keeps it calm: one hue,
at most about 6 % chroma, and only above the fold.

**B. Make the mat the system, not just the card.** Treat every image in the app as a print in a mat:

- **Photos** get the same 6 px paper mat and the same 9 % grain as the covers. A mixed library of photos and
  still lifes then reads as one collection on one wall. This is the real risk on Discover, and the mat solves it.
- **Collections** become a small stack of three matted prints, slightly offset. This shows the collection's
  own recipes, with no new layout.
- **Empty and "Coming soon" states** become line-only sketches in pewter on linen. They read as an unfinished
  drawing, not a grey box.

One visual idea, used everywhere, is what makes a language feel designed rather than decorated.

## What I want to see in round 2

1. Twelve generated covers (problem 1), at phone and desktop sizes, light and dark.
2. A Home that mixes real photos and still lifes, in both themes.
3. Discover at 390 px, where other cooks' photos meet our covers.
4. One editor frame at 390 px. It is the densest form surface and the place "boring" bites hardest. Inputs,
   the ingredient row and the section index in the new language.
5. The fixes for problems 3 to 6. Each is small, and each is a rule we already agreed.
