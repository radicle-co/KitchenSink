# Critique: Designer 2 on Designer 3, "Still Life" (Round 1)

Files read: `round1/d3/concept.md` and `round1/d3/mockup.html` (full source). I checked them against the current boards
(`HomeMobile`, `Home`, `RecipeDetailMobile`), `ownerDecisions.md`, and the tokens in `colors.ts`. Every ratio below is
mine. I measured each one with the WCAG 2.x relative-luminance formula.

## Verdict

This is the strongest single idea I have seen for this problem. The plate system turns the app's weakest moment, a
recipe with no photo, into its most joyful one. It does this without adding noise to the chrome. "The interface is the
white plate, the food brings the colour" is a real design principle, not a mood. It also answers the brief directly:
the excitement comes from the cook's own food, and the calm comes from everything else.

But the mockup shows only the best case. Every recipe has a hand-drawn, hand-composed plate. The fallback, real
photos next to plates, and dark Home are all missing. Two layout elements the owner already ruled on are also missing
from the recipe page. So the bet is promising but not yet proven. Round 2 needs to prove it.

## Strongest ideas to keep

1. **Colour is fenced into the plates.** Coral, tomato and chili live only inside imagery. The chrome has one hue,
   basil. This is the right way to make the app exciting and still calm. It is also why the 2×2 grid on Home
   (`.grid2`) reads like a gallery wall and not a list.
2. **Status chips sit on solid `paper`, never on the ground** (`.chip-on-plate`). Ink on the chip is 14.62:1 in light
   and 13.99:1 in dark, on any ground. So nobody needs a badge-by-ground contrast table. This is a system decision, not
   a one-off. Keep it exactly.
3. **In dark mode, the action becomes a light fill with a dark label.** `#0F1A12` on `#86C99F` is 9.24:1. This keeps
   the New recipe button the brightest thing on a dark screen. It fits the current "light fills take charcoal"
   family.
4. **Fraunces replaces Playfair.** Playfair's needle contrast is a big part of why the app reads as a dated food
   blog. A soft, cookbook-like serif only for titles and section heads, with Inter doing all the work, is the right
   split. Tabular Inter for every number honours the ruling.
5. **The shadow budget.** Cards are flat with a 1 px inset hairline. Only the plates cast a warm contact shadow
   (`--shadow-plate`). Food is the one object that sits "on" the page. This is disciplined and calm.
6. **The recipe sheet overlaps the hero by 28 px with a rounded top** (`.rd`). It is a small change and it costs
   nothing in layout. The page feels like a card set down on a board.

## Problems to fix, most important first

### 1. The recipe page drops elements and moves one. This breaks the "keep the layout" rule.

I compared `mockup.html` against `RecipeDetailMobile.dc.html`.

- **"Screen on" is gone.** The current page has `KeepAwakeToggle` ("Screen on") under Edit recipe. The owner adopted it
  as part of the first slice of 008 FR-035. Put it back, under the Edit recipe button, as it is today.
- **The servings stepper is gone.** The current Ingredients header has a `Stepper` (Servings, "Fewer servings" and
  "More servings"). The mockup has static text: "Ingredients _for 4_". This removes a feature. Bring back the stepper.
  Style it in the new language: pill buttons with `action-tint`, and a tabular Inter value.
- **The community rating moved.** On the current board, the rating section comes right after the hero, before the
  overline and title. The mockup puts it at the bottom of the page (`.rate`). Move it back. If you think it belongs at
  the bottom, raise that as a UX proposal on its own. Do not change it inside a visual refresh.
- **Edit recipe changed from primary to tonal.** The current board uses `variant="primary"`. The tonal button
  (`action-text` on `action-tint`, 5.75:1) looks calmer, and I like it. But it changes the hierarchy on the page, so say
  so in the concept and ask the owner.
- **Small copy changes.** "Source: Family recipe card" lost its "Source:" label. Without it, "Family recipe card" reads
  like a type of recipe. The tags gained a `#` prefix (`.tags span::before`). That makes them look like tappable social
  hashtags, and they are not. Remove the `#`, or use a middle dot as the current board does.

### 2. The sample shows only the best case

I am not asking for every screen. But a representative sample has to include what most cooks will actually see:

- **The cuisine fallback plate.** Until about 120 motifs exist, and for every recipe whose ingredients are unmatched
  (D20 allows this), the fallback is what ships: "the cuisine's ground with one utensil motif". It is not drawn
  anywhere. Show four of these side by side on Home. If four "terracotta plus a spoon" tiles look like generic
  placeholders, the idea fails exactly where it matters most.
- **A real photo next to plates.** "A real photo always wins". So on Home and Discover, a photo tile will sit beside
  three flat cut-paper tiles. Photos and illustrations are two visual languages. Mixing them in one grid is the hardest
  test of this concept. Show it, and give a rule that ties them together. For example: the same radius and contact
  shadow, and a 4 px `paper` mat inside every tile, so a photo looks "framed" like a print.
- **Dark Home.** Dark mode is shown only on the recipe page, where there is one plate. Home has four plates in a dense
  grid. That is where muddiness or glare shows first.
- **The generator, not the illustrator.** The four plates were composed by hand. The concept describes a seeded layout
  that places motifs automatically. Automatic layouts of flat motifs often look like clip art. Show two or three plates
  made by following the stated rules literally, with no hand fixes.
- **Plates must not add ingredients.** The pancakes plate shows three blueberries. The name "Lemon ricotta pancakes" does not
  say blueberries. A plate that shows food the recipe does not use is a small lie. State the rule: motifs come only from
  matched ingredients, and the accent comes from a neutral set (a sprig, a utensil, a cloth).

### 3. The glass tab bar was measured only in its solid fallback

The concept says: "Ratios were measured on flat colours." But the translucent state is what ships on iOS 26 and on
web. The tab labels are 11 px `ink-muted`, so they need 4.5:1. Using the mockup's own glass alpha (light 0.72, dark
0.66), here are flat-blend estimates over plate colours that will scroll under the bar:

| Label               | Glass over                           | Ratio |
| ------------------- | ------------------------------------ | ----- |
| ink-muted `#5E6259` | tomato ground `#E5624A` (light)      | 4.45  |
| ink-muted `#5E6259` | roasting tin `#3D403A` (light)       | 3.72  |
| ink-muted `#ABA89F` | cream motif `#E9DCC6`, dimmed (dark) | 3.39  |
| ink-muted `#ABA89F` | lemon motif `#F7E36A`, dimmed (dark) | 3.33  |

Blur averages what is behind the glass, so the real values will sit between these and the solid fallback. Treat them
as plausible failures, not proven ones. They are close enough that the risk is real, and the grain overlay only makes
them darker. **Fix:** raise the glass to about 0.85 opacity. Ink-muted over the tin then reaches 4.75. Or set the
inactive labels in `ink` and let the pip carry the active state. The hero discs are fine: the dark glyph `#EEEBE3` over
the cream motif is 6.77:1.

### 4. In dark mode the plates are dimmed twice and will look muddy

The dark grounds are already darker values (`--g-tomato: #B4442F`). Then `--plate-filter: brightness(.8)
saturate(.92)` dims them again. Tomato ends at about `#903626`, which is 2.40:1 against the dark canvas. Chili ends at
about `#93583D` (3.24:1). This is not a contrast failure, because no text sits on a ground. It is a taste problem:
brick-brown plates on a green-black page will read as dirty, not as a "night kitchen".

**Fix:** dim once, not twice. Either keep the light grounds and apply the filter, or use the dark grounds with no
filter. I recommend dark grounds tuned by eye, with no brightness filter, and only lower the chroma a little. Also, the
cream and lemon motifs stay almost full brightness in dark (`--g-cream: #E9DCC6`). On a dimmed ground they will glow.
Bring the cream down to about `#CFC3AE` in dark.

### 5. Two owner rulings are amended. That needs the owner, and the fallback is not free.

- **D13 (seafoam to basil).** The concept says: "If the owner keeps seafoam, swap action and action-text and
  re-measure." I measured it. The current seafoam `#31807A` takes white at 4.67:1, so the button passes. But as link
  text on the new oat canvas it is only 4.18:1, and on `surface-muted` it is 3.75:1. Both fail. So a seafoam variant
  needs its own darker `action-text`, about `#286C67` (5.48:1 on oat, 4.92:1 on `surface-muted`). Show both variants side by side in round 2, so the owner can
  choose from two finished options.
- **#145 (the canvas wash stays).** Removing the wash goes against an adopted ruling. There is a way to keep it and
  make it part of the idea. Put a very faint wash at the top of Home and of the recipe page. Take its colour from the
  ground of the first plate below it, mixed at about 6 % into oat. The wash then comes from the cook's own food. That honours
  #145 and strengthens the concept.

### 6. Smaller things

- **The squiggle under Ingredients and Steps** (`.squig`) is drawn in `--action`. That spends the one action hue on
  decoration, which weakens "basil means you can press this". It also feels a little twee next to otherwise grown-up
  chrome. Remove it, or draw it in `line-control`.
- **Fraunces optical size.** `.display` fixes `opsz` at 96 for every size, including 22 px card titles and the 32 px
  greeting. At small sizes, a display optical size thins the strokes and tightens the spacing. Use
  `font-optical-sizing: auto`, or map `opsz` to the real pixel size. Also choose one floor: the concept says "22 px
  and up", but the token strip says "≥ 24 px". Choose one weight too: 540 in the concept, 560 in the token strip.
- **The trend risk.** Oat, sage-basil and a soft-axis Fraunces is a well-worn look in 2024 to 2026 food and wellness
  branding. The plates save the concept from looking generic. But if the plates are weak (see problem 2), what is left
  is a familiar template. One more reason to prove the plates first.
- **Desktop at 1280.** The colour sits in one band of four 4:3 plates, about 250 px tall, and the rest is oat. It is
  calm. But it is the least exciting frame, because the desktop shows the fewest plates for its size. The Coming soon
  grid (1 + 2 + full-width spans) also looks unbalanced next to the even four-up row above it. Use three equal columns.
- **Plates and D15.** D15 says components read colour only from roles, and a guard enforces it. The plate symbols use
  raw hex values (`#E3A24E`, `#5A5CA8`, `#3D403A`). Decide now whether plates are assets that the guard exempts, or
  whether every motif colour becomes a role. Do not leave it for the build.
- **No interaction states.** The sample has no focus, pressed or hover states. The concept states the focus ring
  ratios, but no frame shows the ring. One row of button and chip states is enough.

## Bold suggestions to push it further

1. **Give each recipe page its own key colour, taken from its plate.** On Recipe detail only, use the plate's ground
   (a darker, measured variant of it) for three quiet details: the current-step disc, the timer pill's icon, and the
   ingredient checkbox fill. Basil stays the colour of the one CTA. Apple Music tints each album page from its artwork
   in the same way. Every recipe then feels like its own small printed page, and the chrome stays quiet.
   For each ground, make a light and a dark variant that is safe for text (4.5:1 on canvas and paper). Then this
   stays a token rule, not a judgement call per recipe.
2. **Make collection covers a mosaic of their recipes' plates.** The Collections cover slot already exists. Fill it
   with the first three or four plates of the collection, cropped into a single tile with 2 px `paper` gutters. A
   shelf of collections then looks like a wall of small framed sets of prints. This needs no new layout and no new
   motion, so it keeps the one-signature-motion ruling. It is also the cheapest way to show that the plate system scales
   beyond a single card.
