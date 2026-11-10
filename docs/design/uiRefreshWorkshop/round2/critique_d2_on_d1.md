# Critique: Designer 2 on Designer 1, "Still Life, Lit" (Round 2)

Reviewed: `round2/d1/concept.md` and `round2/d1/mockup.html` (source read in full, including every cover's
`<defs>`). I computed the contrast figures myself with the WCAG 2.x relative-luminance formula, from the hex values
in the mockup's CSS. Where my number matches D1's, I say so. This is design judgement, not user evidence.

## Verdict in one paragraph

This is a much stronger round. D1 took every one of my ten round-1 points seriously. Most are really fixed, not
just answered: the dark mat, the status bar, native type, the switch, the Home layout, the single dark-action token
and the kitchen light. The parts library is real. Every cover on the board uses shared vessels, forms and
marks. That turns the generator from a promise into a system. The chrome is now disciplined
enough to sign. What still stops this from being exciting is **composition, not colour**. The twelve covers share
one layout: a round vessel in the centre and a small mark in the top-right corner. And two of the claims in the
round-2 story are proven by construction, not by test: the recipe's own light and the mixed photo wall. The idea is
right. The next round has to make the covers vary and has to show the hard cases.

## Strongest ideas, keep these

1. **The parts library and the `CoverSpec` pipeline.** Ground, vessel, form, hero, accents and grain, assembled
   from shared parts and coloured by role tokens. Because the parts read inherited CSS variables through `<use>`,
   one drawing serves both themes. That is exactly the right architecture, and it maps cleanly onto
   `react-native-svg`.
2. **The dark mat now survives.** Paper `#25211D` on canvas is still only 1.16:1, but the 10% warm edge and the 16%
   cover ring carry the print shape, and grounds swap instead of dimming. The dark generator sheet is the best
   thing on the board. The food stays appetising at night, which most dark modes fail.
3. **"Every outlined control has its own paper fill."** This rule follows from the numbers (pewter on linen 2.93)
   and it is the kind of rule that keeps a system honest for years. It retires the 3.01 switch for good.
4. **The kitchen light, fixed.** `#F5E2A8`, a 4 px honey rail, real elevation and a filled numeral. It now reads
   from across the room. In dark, `#362D1C` with a honey rail is warm and calm.
5. **Type discipline.** Only 100-step weights, four named SOFT 100 static cuts, opsz pinned on both platforms,
   Inter back on section titles. The two listed exceptions (card titles, cook-written group labels) are the right
   ones. The italic group label with a hairline ("Chicken", "Vegetables") is a lovely, quiet detail.
6. **The sketch empty states.** Pewter line studies on the three "Coming soon" cards give the chrome its own
   personality without covers. This is what I asked for in round 1, problem 10.
7. **An honest contrast table.** My numbers match D1's on these pairs:
    - `inkMuted` on linen 4.62, and `actionText` on tint 5.05 and on the wash 4.91
    - white on seafoam 4.67, seafoam on paper 4.56, and honey on kitchen light 3.45
    - light glass over iron 4.77, dark tint 6.48, the dark label on mint 7.97, and dark pewter on paper 3.94

    There are two small differences:
    honey on the recipe wash is 3.51 (D1 says 3.43, still a pass), and dark glass over the lightest dark cover is
    4.80, not 5.16. That is still a pass, but it is the closer figure to quote.

## Problems to fix, most important first

### 1. The salience rule makes covers change, which breaks "a cover never changes"

- The hero is "the food rarest in this cook's library". Rarity changes every time the cook adds a recipe. So an
  old recipe's hero can change after an unrelated save, and its ground can change with it, because the ground
  comes from the hero's swatch family. The hash keeps the layout stable, but the picture in that layout does not
  stay the same.
- On Discover it is not defined whose library counts. If it is the viewer's library, the same public recipe shows
  a different cover to each person. Then "I saw that one with the lemon" stops being true.
- "Rarest" also picks garnishes over the dish. The board shows it: the harissa sheet-pan chicken's hero is a
  lemon, the pad thai's is a lime, and the gazpacho's is a cucumber rather than the tomato. Rarest-in-library
  will often pick the sumac, not the lamb.
- **Fix:** compute the `CoverSpec` once, on save, against a **stable** source. That means catalog frequency plus
  the ingredient's mass share of the recipe, so the food there is most of becomes the hero. Then **store** the
  spec, or a spec version plus seed, with the recipe. On an edit of the recipe itself, re-rank. At all other times, keep it. Every viewer
  sees the stored spec.
- The "draws itself" sequence has the same gap. When spinach takes the hero slot from chickpeas, does the ground
  jump and the layout re-flow? Give it a motion rule: the ground cross-fades over 240 ms and marks never change
  position after they first appear.

### 2. The twelve covers share one composition

I read every `translate()` in the cover defs:

- **8 of 12** put the hero or first accent in the **top-right corner**, at x ≈ 310–336 and y ≈ 64–92: pancakes,
  pad thai, tomato soup, carbonara, curry, gazpacho, tacos and oats. Most mirror it with an accent at the
  **bottom-left**, at x ≈ 66–76 and y ≈ 226–248.
- **9 of 12** vessels are a centred circle (plate, bowl, deep bowl, skillet, jar).
- The "hero is drawn largest" rule is not true on the board. The hero mark is about r = 36 in a 400-wide frame,
  and the vessel is r = 112. The hero reads as a corner garnish.
- `m-leaf` stands for spinach, basil and cilantro. So the curry's "salient hero" is the same mark as the tomato
  soup's garnish.
- The result at 160 px is a near-twin the sheet does not flag: **Roast tomato soup** (Home) and **Chilled tomato
  gazpacho** (sheet). Both are a red bowl on a pale warm ground, with a tomato top-right and another bottom-left.
  Three of the twelve are also noodles in a round vessel.

In round 1 I warned of "25 plates on beige". This is the same risk one level up: "25 bowls with a lemon in the
corner". The hash moves the vessel by a few pixels. It does not move the slots.

- **Fix:** add **composition families** and let the hash pick one. For example:
    - **centred**: today's layout.
    - **cropped**: the vessel runs off one or two edges at 130–150% scale.
    - **close-up**: no vessel rim. The dish form fills the frame.
    - **pair**: two small vessels.
    - **scatter**: the hero repeats as a pattern on the ground.

    Choose the hero slot from at least four positions. Draw the hero _in_ the dish (wedges on the tray,
    leaves on the curry surface), not beside it. Add three or four distinct leafy marks (spinach, basil, cilantro,
    parsley). Then put the twelve on the sheet again, plus the tomato soup and gazpacho side by side.

### 3. The recipe's own light is the round's headline, and it is barely proven

- The wash against plaster is **1.08:1**, and it fades to plaster by 420 px. Below the strip, every recipe page is
  the same plaster again.
- It is shown **once**: the chicken, in light. These are not shown: a dark detail page (the `.dark .sheet.chicken`
  rule exists but nothing renders it), a photo recipe with its scrim, and a dark-ground cover.
- **The ink ground is the hard case.** Ramen's `#2F3E46` at t = 0.25 over plaster gives `#C2C0BA`. On it
  `inkMuted` is 3.20, `actionText` 3.41, pewter 2.03 and honey 2.44. The guard checks only `inkMuted`. It must
  check the **minimum over every token that sits on the wash**:
    - `inkMuted`
    - `actionText` (the "British" overline, "8 comments", "Version history")
    - the honey stars
    - pewter, for any outlined control in the top 420 px

    Even
    then, a grey dawn is not a ramen dawn. For a dark ground, take the wash from the hero food's hue, not the ground.

- The dark chicken value `#281E18` does not follow the stated formula. Terra dark `#4A3326` at 0.25 over
  `#151311` is `#221B16`. Pick one, and state the dark rule.
- Photo recipes, the group this idea is for, get plain plaster until photo sampling is built. So today the claim
  "a cook who adds real photos still opens a new app" is not yet true.
- **Fix:** show the detail page in dark, the ramen detail (dark ground), and a photo detail. Widen the guard as
  above.

### 4. The mixed photo wall is proven by construction, not by test

- The four "photos" are blurred SVG shapes, drawn in the same palette as the covers. Of course they sit together.
- Real phone photos have cool fluorescent casts, busy counters, JPEG noise and flash. The open risk from round 1,
  two different apps side by side, is still open. List it as a residual risk. Do not mark it _Fixed_.
- The photo stand-ins also carry a **45% vignette** (`#vig`) that the concept does not mention. A vignette on a
  cook's own photo is a dated, 2012-era filter, and it changes their picture. Drop it. Keep the mat, ring, grain
  and the 6% warm grade, and say whether the grade is applied at render or stored.
- **Fix:** run the round-3 Discover wall with four real, ordinary phone photos (licensed or our own), not stand-ins.

### 5. The dark Home frame drops part of the layout

- Dark Home shows one "Coming soon" card and no "Coming soon" heading or subtitle. Light Home has the heading, the
  subtitle and three cards. This is the same kind of drift as round 1, problem 6. A crop for height is fine, but
  the dark board must show the same page, at least down to the second card.

### 6. Two uses of the control colour on things that are not controls

- **The "British" cuisine overline** uses `actionText`, the link colour. It sits in the same row of colour as
  "8 comments" and "Version history", which are links. A cook will try to tap it. Use `inkMuted` (4.62 on the wash)
  or `ink`.
- **The difficulty pips** are filled with `action` seafoam. It is a reading, not a control. The concept's own rule
  is "food colour never on a control, control colour only on controls". Use `ink` for the filled pips.

### 7. The selected chip is the weakest shape in the row

- An unselected pill is paper with a pewter edge (3.62 on paper, 3.16 to canvas). The selected pill is tint with
  `box-shadow: none`, and tint on canvas is **1.05:1**. The check icon (5.05 on tint) carries the state, so
  SC 1.4.11 passes. But the selected pill looks _less_ defined than its neighbours. That is the wrong way round.
  The same happens to the selected tab on glass.
- **Fix:** give selected chips and the selected tab a 1.5 px `actionText` inner edge, or make the selected chip a
  solid seafoam with a white label (4.67). The edge is calmer.

### 8. "Now" is a new string and a fifth signal

- The current board has no visible "Now" label. So it is new copy and needs a localisation key in both locales.
- The current step now has five signals: fill, rail, shadow, filled numeral and the tag. Four is plenty. Drop the
  tag before the shadow. If you keep it, add the key and check that the German string ("Jetzt") and longer
  ones fit beside the step text.

### 9. Smaller accuracy points

- **Small level of detail.** Only marks wrapped in `.sm` drop out. The carbonara's peppercorns (r ≈ 3, about 2 px
  at 160 px) and the scallion rings stay, as noise. Make the 8 px rule automatic from the rendered size, not a
  hand-placed class.
- **Dish-form colours are hard-coded** (`#dca55a` stack, `#c98b4a` bird, the cookie browns). They rely on the
  `brightness(.92)` stand-in in dark. Move them into the swatch table so the dark column is real data.
- **The board vessel is never used**, and the "9 vessels" count includes "none". That is fine. Still, show the board
  once on the sheet.

## Not shown yet (owed in round 3)

- Discover at **390 px**. Round 1 asked for both widths. Only 1280 is here.
- Desktop Home, so D8's four full cards at 960 px are shown, not only asserted.
- Recipes list, Collections, and the editor at 390 px (D1 declined it this round and says it is owed).
- Recipe detail in dark, and a detail page with a photo hero and its scrim.
- Any error or offline state. The sketch style suits them well.

## Two bold suggestions to push it further

1. **Composition families, plus a "close-up" for the detail hero.** Beyond the fix in problem 2, let the detail
   page's hero use a different crop of the _same_ `CoverSpec` from the card: a close-up at about 160% around the
   hero food, with the vessel rim running off the frame. The card is the print. The page is stepping up to the
   table. One spec, two crops. It costs no new art, and it makes opening a recipe feel like moving closer, which
   is the moment of delight this app is missing.
2. **Carry the recipe's light below the fold, through the kitchen light.** This is the half of my round-1
   suggestion that was not adopted. Mix the current step's fill from the cover's ground. For example, use 70% `now`
   and 30% ground. Guard it so `ink` stays above 11:1 and the honey rail stays above 3:1. The wash then lives at the
   top _and_ at the step you are cooking. Your eyes are there for most of your time on this page. A tomato recipe
   glows faintly red at step 4. A risotto glows sage. It costs one token and no layout, and it answers problem 3's
   "below 420 px every page is the same".
