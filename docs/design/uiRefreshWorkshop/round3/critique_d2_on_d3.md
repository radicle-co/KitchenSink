# Critique: Designer 2 on Designer 3, "Mise en Place, Set" (Round 3)

Files read: `round3/d3/concept.md` and `round3/d3/mockup.html`. I read the full source, including the generated plate
markup. I checked the recipe page against `RecipeDetailMobile.dc.html` and `RecipeDetailIngredientNoticesMobile.dc.html`,
Discover against `DiscoverMobile.dc.html`, and the desktop frame against `Collections.dc.html`. I measured every ratio
below myself with the WCAG 2.x relative-luminance formula. One figure is an estimate, and I mark it.

## Verdict

This is the most complete proposal in the workshop, and it is the one I want to build from. Round 3 closed almost
everything from round 2, and it closed each item as a rule, not as a hand fix:

- the vessel rule.
- the split of the seed from the content.
- five archetypes.
- the hero ladder.
- the lamp tinted per ground.
- the wash as a token.
- a paper fill for controls in the wash band.
- 24 px section heads, so the Ingredients row is one line again.
- the lifted skeleton, the star outline, and the 4 px mat.

The flagship plate (lemon, thyme and chicken on plum) now reads as the dish its title names. That is the change that
makes the idea work.

The layouts are kept. The recipe page order matches the board: rating, title, facts, strip, Edit recipe, Screen on,
description, tags, Nutrition, Ingredients with the stepper, and Steps. The Discover pills wrap, and the board wraps them
too. The six collection names and counts match.

The rule now has gaps in only two places, and the numbers below show both. **The objects the rule does not check**
(the accents, the fallback tools, the dark vessel) fail at 1.02 to 1.30. **Some cases are not drawn**: a dark vessel, a non-plum
recipe page and a desktop recipe page. Those are the cases where it fails. Fix those, run the
coverage audit, and this is ready for the owner.

On the brief: yes, it is fresh. A wall of cut-paper boards is something no other recipe app has. It is calm, because
colour lives only in the plates, the wash and one title. It is easy to use, because nothing in the chrome moved. My one
doubt about the excitement is about taste, not rules: see bold suggestion 1, on plum.

## Strongest ideas to keep

1. **The complement board.** Yellow on plum, red on sea, green on clay, pale on slate. This is the right answer to my
   round 2 finding. It fixes the value problem with one table, not with a patch per plate. Chicken on slate is 6.33,
   and lemon on plum is 2.33.
2. **The hero ladder, starting with the title.** "Lemon and thyme roast chicken" leads with lemon, then thyme, then
   chicken. A cook reads the title and sees the same three things on the board. Staples come last unless the title
   names them ("French onion soup"). This is a stated rule with no taste call per recipe, which is what a generator
   needs.
3. **The plate's life.** The seed is stored at first save, and the foods freeze at first publish (`first_published_at`,
   ADR-0058). The assembly plays once, on the recipe page, never in the editor. The proof panel walks one recipe through
   all four moments. It is the right answer, and it is shown.
4. **The title takes the key.** Plum key `#7A4870` on its wash is 5.65, and it passes at body size, not only as large
   text. Fraunces 560, SOFT 100, with `WONK` 1 only at 34 px and up, gives each recipe one hand-cut letter. Of all the
   type details in the workshop, this is the one that looks like a printed cookbook and not like a UI kit.
5. **The shared-ground mosaic.** One ground, heroes only, four objects. Holiday baking on butter (chocolate, a sprig,
   cinnamon, lemon in a glaze bowl) is the calmest collection cover in the workshop.
6. **The lamp per ground.** Sea stays sea and plum stays plum. The dark grounds sit at 1.70 to 2.05 against the canvas
   (I measured: plum 1.70, slate 1.78, clay 1.82, sea 1.93, sage 2.03, butter 2.05), and the 1 px inner rim holds the
   edge. My round 2 complaint about "six brown smudges" is closed.
7. **The honesty.** The motif-coverage audit is listed as not run. The glass ratios are marked as estimates. "Design
   judgement, not user evidence" is stated. Every proposal needs that.

## Problems to fix, most important first

### 1. The dark vessel disappears, and no frame shows it

In light mode the vessel rule picks a dark glaze bowl or a pale ceramic bowl. The concept sets a floor of 1.3 for the
bowl against the ground. But in dark mode the glaze bowl (`--m-glaze` `#2A3B42`) is almost the same value as every dark
ground:

| Dark ground      | Glaze bowl on it | Ceramic bowl on it |
| ---------------- | ---------------- | ------------------ |
| butter `#5A4716` | **1.30**         | 6.13               |
| clay `#62362A`   | **1.15**         | 6.92               |
| sage `#33502B`   | **1.29**         | 6.20               |
| sea `#184D4C`    | **1.22**         | 6.53               |
| plum `#523158`   | **1.08**         | 7.42               |
| slate `#22416A`  | **1.13**         | 7.08               |

So coconut lime rice (lime in the glaze bowl on clay) loses its bowl at night: 1.15. Lemon in the glaze bowl on butter
(the Holiday baking cell) drops to 1.30. Both of the concept's dark examples (chocolate and onion) get a rim, not a
vessel. Every vessel case in the file is drawn in light only, so the gap is hidden.

**Fix:** the generator picks the vessel **per theme**. It runs the same two floors against the dark values (hero against bowl at least 1.5, bowl
against ground at least 1.3), and it swaps glaze for ceramic where the dark pair fails. In
practice that means ceramic on every dark ground. Add one dark vessel plate to the dark wall, so the rule is shown in
both themes.

### 2. Accents and fallback tools are never checked, and some measure close to 1:1

The checks cover the hero and the supports. They do not cover the accent or the fallback tool. These are the light
values:

| Accent on light ground     | butter | clay     | sage     | sea      | plum     | slate |
| -------------------------- | ------ | -------- | -------- | -------- | -------- | ----- |
| steel (fork, whisk, ladle) | 2.02   | **1.26** | 1.59     | **1.15** | **1.11** | 3.15  |
| wood (spoon, pin ends)     | 2.20   | 1.37     | 1.72     | **1.25** | **1.02** | 2.90  |
| wood-hi (board, pin body)  | 1.52   | **1.06** | **1.19** | **1.16** | 1.49     | 4.21  |
| twine                      | 1.55   | **1.03** | **1.22** | **1.13** | 1.45     | 4.11  |

Three places in the mockup land on these numbers:

- **The flagship hero's wooden spoon is wood on plum, 1.02.** It shows only because its hue is different, and hue
  disappears for a deuteranope and at thumbnail size.
- **The day-one fallbacks.** Three of the eight seeds put a steel tool on sea: a fork, a ladle and a ladle, all at
  **1.15**. In a fallback the tool is the only object on the board. Until the coverage audit runs, the fallback is the
  most likely face of a new cook's library. The round 2 critique flagged this exact pair class (a steel fork on tomato,
  1.15), and it is still open.
- The wall's sea tomato plate has a steel whisk at 1.15, and the board under corn on plum is 1.49.

The plate is decorative (`alt=""`), so this is not a WCAG failure. It fails the concept's own rule: "never a food you
cannot see". A tool you cannot see is the same failure.

**Fix:**

- Apply the support floor of 1.3 to the accent. A failing accent is swapped or skipped, the same way a support is.
- Give each tool two materials: a light one (steel, beech) and a dark one (enamel, cast iron, walnut). The generator
  picks the material that passes. Enamel at about `#2B3A40` puts the fork at 3.9 to 8.8 on every light ground except
  slate, and slate already passes with steel.
- For a fallback, also require the cloth to sit **under** the tool. The cloth is 2.3 to 9.2 on every ground except
  butter, so a tool on the cloth always reads.

### 3. The coverage audit is a gate, not an open item

This is round 3 of 3. The concept says the motif-coverage audit "is owed before build", with a pass bar of 80%. That is
the right bar. But today the owner approves an idea whose main claim ("every recipe gets a face") has not been
measured. The only diversity figure (15 heroes across 22 recipes) comes from recipes the designer chose.

**Fix:** make the audit a hard gate before build, and run the hero-diversity check from my round 2 critique with it.
Use the 1919 cookbook corpus the repo already has, plus the top 300 matched catalog foods. Report:

- the share of recipes that get a hero.
- the distinct heroes per 100 recipes.
- the share of each ground.

The ground share matters because of problem 4.

### 4. Every screen in the file is plum, so the system is shown in only one colour

I counted the ground classes in the mockup: plum 30, slate 13, butter 12, sea 12, clay 6, sage 4. The page wash on
**all five screens** (Home, the light and dark recipe page, Collections and Discover) is plum. That is because each first
tile is plum. So "each recipe looks like its own page" is claimed for six grounds and drawn for one. The riskiest case
is never drawn:

- **A slate recipe page.** The light slate ground is `#2F4A5C`. So the 340 px hero becomes a deep navy block at the top
  of a light page. The status bar flips to paper. The glass back and more buttons sit on navy. The light wash is
  capped at 8%, and ink-muted on it is 4.62, the thinnest pass in the light table. It is a completely different mood
  from the plum page. It is the best page in the system or the worst. The file does not show which.
- **A butter page.** The butter ground against the canvas is 1.31, the lowest in the table. The edge between the hero
  and the sheet then rests on the 28 px overlap alone.

**Fix:** add two recipe pages at 390, one slate and one butter, in light. Make at least one Home or Discover frame start
on a non-plum tile.

### 5. Still no desktop recipe page

The round 2 critique asked for one. The key title, the wash and the wide hero are still shown only at 390. At 1280 the
hero is a much wider shape (the board's `RecipeDetail.dc.html`). The `slice` viewBox will crop the plate differently
there, and the safe-area rule (step 7) has only been tested at a ratio of 1.15:1. **Fix:** draw the desktop recipe page,
with the safe area shown as an overlay.

### 6. The status bar sits on the grain

Ink on the plum hero is 4.52 flat, the thinnest text margin in the file. The plate's grain (`::after`, multiply, opacity
0.18) runs under the status bar, against the concept's own rule "never under text". The grain darkens the ground under
the 15 px time. My estimate, which assumes an average noise colour, puts the result at about 3.5. Treat that figure as
an estimate, but the direction is certain: the grain can only lower the ratio. **Fix:** mask the grain out of the top
56 px of a hero, or put an 8% ground-coloured scrim behind the status bar. Note also that on iOS the status bar is
system black or white, not `#1F2A22`. Black on plum is about 5.4.

### 7. The focus ring in the mockup does not render

`.input.focus` and `.focus-ring` use `var(--focus)`, but neither theme block declares `--focus`. I checked: `--focus:`
occurs 0 times. The whole `box-shadow` is then invalid at computed-value time and falls back to none. So the Focus column
of the states panel shows **no ring at all**, and the selected chip also loses its edge. The concept quotes the ring at
6.35:1 on oat. That is correct for `#2A6342`, but the mockup does not draw it. This is a bug in the mockup, not in the
system. Fix it before the owner reads the states panel, because a missing focus state is what a reviewer looks for
first. Add `--focus: var(--action-text)` to both theme blocks.

### 8. Dark mode is louder than light

The light wash against the canvas is 1.11, a hint. The dark wash (55% mix) is 1.28, so the dark plum page has an
aubergine band at the top. Night mode needs to be the quieter of the two themes. The current setting reverses that. The
55% was chosen because 12% is invisible on `#131512`, which is true. At 30 to 35% the wash still shows, and it reads as a
tint, not a theme. Check it on a device at low brightness before you lock the token.

### 9. Smaller things

- **The drawn-food glyphs (my own round 2 idea) do not work as drawn.** They sit directly on the page. Lemon is 1.39 on
  paper, chicken skin 1.45, and lemon pith 1.13, so two of the three glyphs wash out. Only thyme reads (5.09). The
  notices board also puts badges on these same rows ("Needs review", "Choose a match", "Your own food"). A glyph and a
  badge at the end of one 358 px row will collide. **Fix:** put each glyph on a 22 px coin of the plate's own ground.
  That fixes the contrast, because the complement table already did that work. It also ties the line to the board by
  colour as well as by shape. Define the slot order with a badge: the badge goes first. If the row has no room for both,
  drop the coin.
- **The Discover active tab** uses the outline `i-compass`, and the file has no filled version. That breaks "filled
  glyph, never hue alone" on one of five frames. Draw `i-compass-f`.
- **The photo placeholders** have `role="img" aria-label=""`. An image role with an empty name is an error. Use
  `alt=""`, or `aria-hidden`, as the plates do.
- **The ground after a hero swap.** The plate's life table says the next candidate takes a slot when a drawn food
  leaves. If the hero itself leaves, the new hero can be from another family. Then the ground, the wash and the title
  colour all change on a published recipe. That breaks "find it by sight", the same argument you used to turn down
  d1's neighbour rule. **Fix:** freeze the ground at first publish together with the foods. A new hero that fails on
  the frozen ground goes into a vessel.
- **The Ingredients row has no slack.** By my estimate, Fraunces 24 "Ingredients" (about 135 px), "for 4", the 112 px
  stepper and the Edit button come to about 355 to 360 px in a 358 px row. It fits in English. "Ingredientes" does not.
  State the wrap rule: "for 4" moves under the heading first, and the stepper never wraps.

## Bold suggestions to push it further

1. **Give yellow a blue board, and retire plum as the default face.** Yellow is the commonest hero colour (lemon, corn,
   butter, egg yolk), so plum will be the most common board in a real library. The mockup shows this already. `#A9829F`
   is a low-chroma, dusty mauve. Next to bright yellow it looks muddy, and as a page wash it reads more like a beauty
   brand than a kitchen. Food stylists put lemons on cobalt and navy all the time, because blue is yellow's perceptual
   complement. Lemon on the existing slate is **6.58**. Two options:
    - **Yellow goes on slate**, and pale food goes on a new deep ground: a forest or an aubergine at about the same
      value as slate. Plum then becomes a minor board.
    - **Keep plum, but push its chroma** toward a real blueberry or aubergine, so the yellow on it sings rather than
      sits.

    Either way, run the ground-share count from problem 3 and pick the palette that gives no single board more than
    about 25% of a library. A system that is "six boards" in theory and "mostly mauve" in use loses the rhythm that made
    the wall exciting.

2. **Let the assembly happen in the cook's hands, once.** Right now the assembly plays the next time the recipe page
   opens after publish. Make the moment more deliberate: after the first publish, the editor closes onto the recipe page,
   and the plate assembles **there**, as the reward for finishing. The sheet settles first, then the board, the hero,
   the supports and the accent drop in at 70 ms intervals, about 400 ms in all, the same timing you already specified.
   Add one line of copy under the title for that single visit: "Your plate is set." It is one moment of delight per
   recipe, at the moment the cook has earned it. It stays calm because it never repeats. Reduced motion shows the
   finished plate and the same line.
