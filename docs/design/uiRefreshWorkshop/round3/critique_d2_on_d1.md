# Critique: Designer 2 on Designer 1, "Still Life, Lit" (Round 3)

Reviewed: `round3/d1/concept.md` and `round3/d1/mockup.html`. I read the source in full, including every cover in
`<defs>`. I computed the contrast figures myself with the WCAG 2.x relative-luminance formula, from the hex values in
the mockup's CSS. I also computed OKLCH and CIE76 ΔE myself. Where my number matches D1's, I say so. This is design
judgement, not user evidence.

## Verdict

This is the most complete and most honest proposal in the workshop. D1 closed almost every point from round 2, and
the fixes are real, not just answered.

- The recipe's light is now a system with contrast by construction. I checked all 12 hues and the numbers hold.
- The covers now vary.
- The unfinished study turns the worst state in the app, a recipe with no picture, into its best story.

It is calm. Nothing on these screens stresses a cook.

My worry is the other half of the brief: **"immediately attractive and fresh."** Almost all of the freshness lives in
one place, the cover generator. That is the part with the most data work, the most art and the least proof. The chrome
around it has not changed since round 2: plaster, a warm serif and seafoam. On its own, that is a well-made version of a
warm, beige, serif look that many apps already use. The build has to protect the generator's quality floor. It also needs to give the chrome one fresh idea of its own (see Bold suggestion 1). If it does not, a cook who uses photos, or who
gets mediocre covers, opens a calm app that feels "meh" again.

## Strongest ideas, keep these

1. **The unfinished study that ripens.** It is the best idea in the workshop.
    - It is a paper ground, a line drawing of the vessel, and a pool of the recipe's own glow.
    - It looks intended on day one.
    - It rewards matching ingredients right where writing a recipe is dullest. Matching also feeds nutrition (D20).
    - "A mark never moves once placed" is the right motion rule. Bibimbap in Korean red, not plaster, shows that the
      cuisine hue table pays off.
2. **The recipe's light, at fixed OKLCH lightness.** I checked every wash and glow in the CSS. They really are fixed:
   wash L 0.943 to 0.945, glow L 0.929 to 0.931, dark wash L 0.215 to 0.217, dark glow L 0.26. My ratios match D1's:
    - `inkMuted` on any wash: 4.90 to 4.98
    - `actionText` on any wash: 5.20 to 5.30
    - honey on any wash: 3.72 to 3.79
    - the solid numeral on any glow: 3.74 to 3.85

    I also checked the rule that keeps `inkMuted` off the glow: it measures 4.67 to 4.81 there, too thin to rely on.
    This is the right way to build a colour system: one rule, no per-hue guards.

3. **The `CoverSpec` is stored on save and ranked by mass share.** This fixes my round-2 point 1 the right way. Every
   viewer sees the same cover, and the roast lamb beats the sumac.
4. **A cook's photo is never altered.** It gets the mat and the ring only. The photo hue and `statusBar` are sampled
   at upload. My numbers match: ink on the focaccia crust is 7.0, and on the darkest dimple it is 5.53.
5. **Selected and checked states.** A tint plus a 1.5 px `actionText` edge (5.05 on tint), and the same checked box in
   both themes. The selected item is now the most defined shape in its row. The 40% icon fill means it survives
   greyscale.
6. **The current step is quieter.** It has two signals. Every step has the same box, so nothing reflows when the
   light moves.
7. **The dark plate is stepped down** to `#9C9488`, 5.33 on dark paper. I get the same figure. The food is now the
   brightest thing in the frame.
8. **The layouts are kept.** I compared the 390 detail with `RecipeDetailMobile.dc.html`. The order is the same:
   rating, cuisine and title, facts, strip, actions, description, tags, Nutrition, Ingredients, Steps. Home and the
   desktop 5/7 grid also match. Real copy throughout.

## Problems to fix, most important first

### 1. The freshness depends on the riskiest part, and there is no quality floor for a bad cover

- D1's residual-risk list is honest: about 35 marks, a swatch table with a dark column, unit-to-grams mass data, and a
  collision rule for slots. None of it exists yet. The marks on the board were placed by hand.
- The real risk is not that the generator fails. It is that the generator **half-works**: marks that collide, a hero it
  cannot draw, or a leaf that stands for the wrong herb. A bad still life is worse than no picture. It looks like
  clip-art, and it is on the card the cook sees most.
- The study is already the right fallback, but today it triggers only on "fewer than two matched foods."
- **Fix:** give `coverSpecFor` a **confidence result**, not only a spec. Fall back to the study when:
    - the hero has no mark,
    - two marks overlap by more than about 15% of the smaller one's area, or
    - fewer than two marks survive the small level-of-detail rule at card size.

    The study is attractive, so a low-confidence recipe still looks designed. Put this in the build spec as a hard
    rule, next to the 200-recipe visual review D1 already lists.

### 2. The dark recipe page has a failing status bar, and `statusBar` cannot be stored once

- The dark detail frame (mockup line 617) uses `status sb-dark`, which is ink `#24201C`, over the dark terra ground
  `#4A3326`. That is **1.38:1**, or 1.58 on the stripe. The time and the battery are close to invisible.
- The cause is in the data model, not the markup. The concept stores `statusBar` in the `CoverSpec`, but cover grounds
  **swap per theme**. Terra needs dark text in light and light text in dark. Ramen happens to need light text in both.
- **Fix:** do not store `statusBar` for generated covers. Compute it at render from the theme's ground luminance.
  Below a relative luminance of about 0.18, use light text. Store it only for photos, which do not change
  per theme. Then fix the dark frame. Light text `#FFFCF7` on dark terra is 11.45:1.

### 3. Warm recipes get the weakest light, and the "light" is really a tint

- The wash's lightness (L 0.944) equals plaster's (L 0.946). Only chroma and hue change. So it is not light falling on
  the page. It is the page slightly stained.
- Plaster's own hue is about 79°. Butter (88°), oat (83°) and terra (59°) sit close to it. On those pages the wash reads
  as "plaster, a little more saturated." Roasts, bakes, breads and curries are most of a real library, so most pages get
  the least visible light. Cool hues (ink, sky) read clearly because they are opposite plaster.
- The ΔE figures are CIE76. I reproduce them exactly (butter 8.3, terra 6.8, ink 8.8). But CIE76 overstates
  differences in saturated yellows. A ΔE2000 check gives the warm hues less, which is the opposite of what they need.
- **Fix:**
    - Solve the chroma against **ΔE2000**, not CIE76.
    - Consider lifting the wash's solid band to about **L 0.965**, between plaster and paper, so it reads as real
      light. `inkMuted` and `actionText` rise with it. The trade-off: paper cards on a lighter wash lose a little
      separation. In light theme the contact shadow carries them, but show it.
    - Prove it on the **focaccia** and a **curry**, not on the tomato soup and the ramen, which are the easy cases.

### 4. The composition families need an eligibility table, and the dark column is not real in the markup

- **Eligibility.** "The seed picks one of these families" with no rule for which dish can take which family. A curry
  in the `pattern` family is a field of spinach leaves, and it no longer reads as a curry. `pattern` is also listed as
  a **form** (cookies), so the taxonomy repeats the collision D3 flagged in round 2. Give a form × family table. For
  example, `surface` allows centred, cropped and pair, and `pattern` is a form-only family. Rename one of the two
  "pattern"s.
- **Weights.** Centred is still 4 of the 9 generated covers on the sheet, and 2 of the 3 generated covers on Home. If
  centred is meant to be the default, say so and give the weights. If the weights are uniform, the board
  over-represents it.
- **Dark.** The concept says "every form reads swatch variables … the build asserts that no form carries a hard-coded
  fill." The markup does not do that:
    - every vessel's `--fill` is an inline literal (`--fill:#C94A32` on the tomato soup),
    - the pad thai ground is a hard-coded `#D49E5A` inside `.food`,
    - and the only dark treatment is the old `brightness(.92)` filter that this round claimed to retire.

    The result is the close-up family's dark failure. A close-up has no ground or vessel to swap, so the whole tile stays
    food-bright. The pad thai is about **5.7:1 against dark paper**, the brightest tile on the dark sheet by far. It is
    round 2's "bright disc" back as a bright tile.

- **Fix:** make the dark column real for every `--fill`, `--noodle`, `--rice` and close-up ground (OKLCH L − 0.08, as
  stated). Show the dark sheet again with no `filter` anywhere.

### 5. "One solid button per screen" is not true on desktop

- The 1280 detail has two solid seafoam pills: the sidebar **New recipe** (with the floating `--shadow-fab`) and **Edit
  recipe**. Add the solid current numeral, and the claim fails twice on the screen it was made for.
- D13 rules that New recipe is solid on web, so the sidebar button must stay.
- **Fix:** restate the rule as "one solid action per region (navigation, content)." Then drop `--shadow-fab` from the
  sidebar button. It does not float, and a shadow makes it compete with Edit recipe. Also show the **Screen on switch
  in its on state**. If its track goes solid seafoam, it becomes a third solid shape next to Edit recipe. A tint track
  with an `actionText` thumb keeps the rule.

### 6. D1 declined the screens that prove the system

The brief asks for a sample, and the dispositions are honest. But two screens are not "no new rule". They are where the
new rules are tested:

- **Discover at 390.** This is where 10 or more covers from strangers sit together, at the sizes where the
  small level of detail cuts in. It is the real test of "the wall does not repeat," and the photo-wall risk lives
  here too.
- **The editor's Photos slot.** D1 calls the ripening study "the centre of this round," but it is shown only as a
  strip on the sheet, not in the screen where a cook watches it happen.

Round 3 is the last round, so make these two the first frames the build spec asks for. They are not optional.

### 7. Smaller points

- **The timer chip disappears on the glow.** On desktop step 4, linen `#ECE4D7` on the terra glow `#FEE2CD` is
  1.02:1. The text is fine (12.8), but the chip's shape is gone. Use paper for a chip that sits on the glow.
- **The glow on cool hues is the faintest current-step cue.** The sky, lilac and Japanese glows have chroma 0.014 to
  0.018, and every glow is about 1.05:1 to canvas in luminance. The solid numeral carries the state, which is fine. But
  check the glow on a dimmed phone at arm's length, because that is the real kitchen case.
- **Lost affordances.** The current board puts a chevron on "8 comments" and a globe icon on "Public." The mockup
  drops both. The chevron tells the cook the link opens a new page. Keep it.
- **Motion budget.** The print grows into the hero, then the light blooms over 240 ms. Start the bloom during the last
  third of the grow, not after it, and keep the whole open under about 450 ms. A cook opening a recipe with wet hands
  wants the ingredients, not a show.
- **Board only:** the `.fam` captions use `actionText`, the link colour, for labels that are not links. It is harmless
  on a spec sheet, but it is the same mistake as round 2's "British" overline.

## Two bold suggestions to push it further

### 1. Let Home be lit by the last thing the cook made

The chrome needs one fresh idea that does not wait for the generator, and the OKLCH machinery is already there.

- Today Home's warm corner is a fixed `#FAF0DC`. Replace it with the **wash of the most recently opened or cooked
  recipe**, at the same fixed lightness and contrast.
- On Monday, after the tomato soup, Home has a faint rosy dawn in the corner. On Wednesday, after the ramen, it is cool.
- It costs one token lookup and no layout. It works for photo recipes too, through the sampled hue.
- Most importantly, the app's front door changes with the cook's own life, without ever getting louder. That is the
  "excited to open the app" moment the brief asks for, and a beige app cannot have it.

Keep it to Home. Recipes and Discover stay neutral, so there is still one place where the light means "this recipe."

### 2. Give the covers a printmaker's hand, not a vector kit's

At 160 px the covers are charming. Up close, the marks are the familiar flat-vector vocabulary: a lemon of concentric
circles and spokes, ellipse leaves, and circles for chickpeas. That is the one place this proposal can still look like
a default kit.

- Render every cover as a **two- or three-ink print**:
    - limit each cover to the ground plus at most three spot inks taken from its swatches,
    - print the darkest ink layer with a fixed 1 to 1.5 px **misregistration** offset taken from the seed,
    - let the paper grain show through the ink (multiply, not the current 9% overlay on top).
- It is a render-time treatment of the same parts library, so it needs no new art.
- It gives Commise a signature hand that nobody else has: a library that looks like a shelf of small kitchen prints.
  It also hides the weakness of simple marks, because imperfect registration makes a simple shape look made, not
  generated.
- Keep it off photos. The mat already ties the two together.
