# Critique: Designer 2 on Designer 1, "Still Life" (Round 1)

Reviewed: `round1/d1/concept.md` and `round1/d1/mockup.html` (source read line by line). Contrast figures below
are my own, computed with the WCAG 2.x relative-luminance formula from the hex values in the mockup's CSS. Where my
number matches D1's, I say so. This is design judgement, not user evidence.

## Verdict in one paragraph

This is a real idea, not a reskin. "The colour comes from the food" is the right answer to "dated and meh": it
puts the delight in the content and keeps the chrome calm, which is exactly the brief. The still-life cover, the
concentric mat and the kitchen-light step are three things I have not seen in a recipe app. But almost all of the
excitement lives in **one unproven component**, the cover generator. Take the covers away, and what is left is cream
plaster, a soft serif and one green. That is close to what modernizeA and modernizeB already gave us. It is also
close to the generic "wellness brand" look of the last few years. The idea is strong. The proposal needs to show that it
holds up on the screens with no covers, in dark mode, and with real photos mixed in.

## Strongest ideas, keep these

1. **Still-life covers built from the recipe's own matched foods.** A day-one library becomes a wall of small,
   warm pictures instead of six flat tints. Three parts are sound engineering: the pure function `recipe → CoverSpec`,
   the fixed layout from a hash of the id, and the vessel-only fallback. They make the idea buildable on both
   platforms with `react-native-svg`. The pancake and tomato soup covers are lovely.
2. **The concentric mat** (card 22 = cover 16 + mat 6). It is a small, exact detail that gives the card a printed,
   made-by-hand feel. UI kits do not do this. It is the shape people will remember.
3. **Kitchen light for the current step.** A warm fill plus a honey rail plus a filled bay numeral is a lovely
   cooking-specific cue, and it is calm. It is exactly the kind of flourish the brief asks for.
4. **Fraunces with SOFT on, numbers in Inter.** Moving off Playfair is right. The soft terminals are warm without
   the sharp fashion contrast of Playfair. The italic name in the greeting is personal without being cute. Keeping
   every number in Inter with tabular figures respects the owner's ruling and reads well.
5. **Discipline.** One colour on controls, no coral on controls, glass only where D12 allows, one signature motion,
   no loops, no scroll effects, a clear reduced-motion plan. The motion section is the best-judged part of the doc.
6. **Honest contrast table.** Most of D1's numbers check out. I got the same values for these pairs:
    - white on bay 6.28, and `inkMuted` on linen 4.75
    - `ink` on kitchen light 13.37, and the honey rail on kitchen light 3.67
    - the inactive tab on light glass over the pad thai bowl 4.60 (D1 says 4.62, which is a rounding gap)
    - the dark label on the dark action 7.97, and the dark selected tab 7.36

## Problems to fix, most important first

### 1. The excitement is in one component, and that component is not proven yet

- Every screen in the mockup that looks new looks new because of a cover. The screens with no covers (the editor,
  Profile, sign-in, the lower half of the recipe page, Collections without photos) get only a font change and a
  slightly warmer cream. That is the "took things away" result of modernizeA/B again.
- The five covers are drawn by hand. D1 says so honestly. But a generator working from about 40 swatches and a few
  vessel keywords will produce many near-identical "round plate with three dots" covers. A library of 40 recipes
  where 25 are "plate on beige" is not a wall of paintings. It is a wall of the same picture.
- The keyword rule (soup → bowl, roast → tin, bread → board) fails on real titles: "Grandma's Sunday dish",
  "Weeknight stir-fry", "Tray bake no. 3". The fallback plate will be the most common cover.
- **Fix for round 2:** show 12 generated covers for real, messy recipes from the library, side by side, at the
  2 × 2 phone size. Also show the same 12 in dark. They must look different from each other at 160 px. If they
  do not, add a second axis of variety before round 3 (a ground pattern, a vessel angle, a hand-drawn crop).

### 2. The mat and the cards disappear in dark mode

- Dark `paper` `#1F1C19` on dark `canvas` `#151311` is **1.09:1**. The 1 px hairline `#38322C` on paper is
  **1.34:1**. In light, the warm shadow saves the mat. In dark, the shadow is `none`. So the signature shape
  of the whole proposal, the print in its mat, is close to invisible in the theme many cooks use at night.
- The mockup defines a `--mat: #26221E` token and never uses it. I think D1 meant to solve this and did not.
- The dark frame in the mockup shows no card at all (only the Nutrition accordion), so this is not visible in the
  board. It needs a dark Home.
- **Fix:** raise dark `paper` to about `#25211D` and give the mat a lighter inner ring (the unused `--mat` value,
  or a 1 px `rgba(255,240,220,0.06)` inset on the cover edge). Show dark Home with the 2 × 2 grid.

### 3. The status bar over the cover is hard-coded to dark ink

- `.on-hero .status { color: #24201c; }`. Over the chicken cover's ground that is 11.52:1 and fine. Over the pad
  thai bowl's top band (`#2F4844`) it is **1.64:1**, and over the tomato soup red it is 3.44:1. A full-bleed cover
  is content, so the system clock and battery must stay readable over any cover.
- The fix is cheap because the covers are generated: `CoverSpec` already knows the colour of its top band. Add
  `statusBarStyle: 'dark' | 'light'` to the spec, and pick the side with more than 4.5:1. For real photos we
  cannot know the colours, so add a short top scrim (for example 0 → 18% ink over the top 96 px). Do the same check
  for the glass back and ⋯ discs, and show it on a dark cover and in dark mode.

### 4. The type plan will not ship the same way on native

- The mockup uses weights 460, 470, 480, 520 for Fraunces and 420, 620, 650 for Inter. Native loads static
  instances in steps of 100 (`Fraunces_500Medium`, `Inter_600SemiBold`). So web and native will not match: 460 and
  470 round to 400 or 500 on the phone, and 420 body becomes 400.
- More important: the whole voice of the type comes from `SOFT 100`. D1 rightly flags that the Expo static files
  possibly do not carry it. If they do not, native ships the sharper default Fraunces, which feels like a different
  typeface.
  This is not a "check before round 3" item. It decides whether the idea works at all on mobile.
- **Fix:** state every weight as a 100-step value that exists on both platforms (Fraunces 400/500/600, Inter
  400/500/600). Commit now to subsetting our own static SOFT 100 instances from the variable font, and name the
  files.

### 5. The "Screen on" switch's off state sits at the contrast floor, and the doc misplaces it

- The concept says `lineControl` on linen (3.01:1) is used only by the empty difficulty pip. In the mockup the
  **switch track is linen and its thumb and edge are pewter** (`.switch` uses `var(--sunken)` with `var(--control)`).
  So the toggle's off state, a real control, is at **3.01:1**. That passes SC 1.4.11 by one hundredth. It will fail
  with any rounding in the native colour pipeline or any change to linen.
- **Fix:** put the off track on `paper` (pewter on paper is 3.62:1), or darken the thumb to stone `#6B645C`
  (4.75:1 on linen).

### 6. Two small layout changes slipped in on phone Home

- The current phone board stacks three "Coming soon" cards full width (Today's nutrition, Resume cooking, This
  week's meals). The mockup puts two of them in a two-column grid and drops "This week's meals". The brief says the
  layout does not move. Please restore the stacked list of three, and keep the new styling.
- The compact cover uses `aspect-ratio: 4 / 3.3`, not the 4:3 the concept states. Pick one and say which.

### 7. The dark action colour needs a firmer case

- I do not object to a light action fill with a dark label in dark mode. Material 3 does the same. But two things:
    - There are two near-identical action values, `#6CC0B3` (fill) and `#7DCBBE` (text). One of them is enough.
      Two tokens that look the same will drift apart.
    - A light mint fill is the brightest thing on a dark screen after the text. The claim "it glows softly, it does
      not punch a hole" is the opposite of what happens: it is 8.67:1 against the canvas. The dark frame shows two
      checked boxes. With eight ticked ingredients you get a column of bright mint squares. Show that state and the
      dark FAB before the owner rules on it.
- Also: moving light action from seafoam `#31807A` to bay `#1F6B63` is a good change for the label (6.28 vs 4.67).
  It needs an owner ruling under D13, as D1 says.

### 8. Covers and real photos will look like two different apps side by side

- "When a cook adds a photo, the photo wins" is right, but Discover and a growing library will mix flat
  illustration and phone photos in the same grid. A soft drawn plate next to a dim, yellow-lit phone photo of
  lasagne will make both look worse.
- The mockup shows no mixed grid. Round 2 needs one: Discover at 390 and 1280, half photos, half covers.

### 9. The kitchen light is weaker than the doc says in light mode

- Kitchen light `#F7E9BF` on plaster `#F6F1E9` is **1.08:1** in luminance. The warm hue does show, and the state is
  carried by the honey rail (3.67:1 on the fill) and the filled numeral, so it passes. But "find your place from
  across the counter" rests on a 3 px rail. Make the rail 4 px and let the fill run a little more saturated (about
  `#F5E2A8`. Ink on it stays well above 12:1). In dark it is 1.32:1 against the canvas, which reads better.

### 10. Trend risk

- Cream background, soft variable serif, sage-teal accent, warm brown shadows: this is the look of many
  direct-to-consumer and wellness brands from 2021 to 2024. On its own, the chrome will not feel fresh for long.
  The covers are what lifts it out of that template, which is one more reason problem 1 matters most.
- One place to push the chrome itself: the wordmark's WONK italic with the bay dot is the only moment the type gets
  a little playful. That is good. Use that same voice in one more place, for example the empty states, so the
  personality is not only in the pictures.

## Other notes

- **Layout kept:** the recipe page order is exactly the current one (hero, rating, title, facts, time strip,
  actions, description, nutrition, ingredients, steps), and desktop Home matches (sidebar with New recipe first,
  greeting, four full cards, placeholders, avatar top right). The floating tab bar and the sheet that overlaps the
  hero by 28 px are shape changes, not layout changes, and I'm fine with both. The floating bar and the FAB together
  take about 170 px at the bottom of an 844 px screen. Check that against owner decision 9 (the compact bar for a sideways phone,
  48 dp).
- **Glass at 90% is in effect a solid bar.** That is the honest result of AA over a dark cover, and D1 says so. On
  iOS 26 the real glass view handles legibility itself. Use the 90% figure on web only.
- **The detail sheet repeats the wash** (a second radial gradient inside `.sheet`). One warm corner per screen is
  enough. Two make the top of the sheet look stained.
- **Not yet shown:** Recipes list, Discover, Collections, the editor, any desktop recipe page, dark Home, any error
  or empty state. In round 2, show at least Discover and the editor. Those are the screens where the cover idea is
  most and least present.

## Two bold suggestions to push it further

1. **Let the cover draw itself in the editor.** In the editor's existing "Photos & publish" section, where a recipe
   with no photo already shows a placeholder, show the still life building up as the cook matches ingredients. When
   lemon is matched, the lemon appears. When thyme is matched, the thyme appears. It uses the same slot and the same
   layout, with no new control. It turns the generator into a small reward at the moment of writing. It gives the
   editor (today the least exciting screen) its own moment of delight. It also quietly teaches cooks that matching
   ingredients matters. Under reduced motion,
   each mark just appears.
2. **Let the recipe's palette reach past the thumbnail, but never onto a control.** The `CoverSpec` already holds
   three or four food colours. Use the cover's ground colour, at about 4 to 6 percent, as the recipe page's wash.
   It replaces the global warm corner, and it also becomes the warm stop of the kitchen light. A tomato soup page
   is then faintly warm red, and a pad thai page faintly sage. Each recipe feels like its own room. The colour still
   comes from the food, and controls stay bay only. At that strength, `ink` stays above 13:1 and `inkMuted` above
   4.5:1. Even so, the generator must check both pairs against the tinted wash for every swatch.

Also worth a small trial: give real photos the same mat, the same 9 percent grain and a very light warm grade.
Then photos and covers sit together as one collection. This also helps with problem 8.
