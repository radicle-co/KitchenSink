# Proposal A: "Still Life, Lit" — as built

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** This file describes `proposalA.html`, the mockup shown to the owner.
The full spec is the Proposal A section of `brief.md`. Where the two differ, this file says so.

## The idea

The app becomes a calm room of plaster, paper and one seafoam green. All the colour comes from the food.

- A recipe with no photo gets an overhead still life of its own ingredients, set in a paper mat.
- The food also lights the room. Each recipe page has a soft light in its cover's hue, at the top and on the step
  being cooked.
- Home takes the light of its first recent recipe.
- A recipe with few matched foods is an unfinished study. It is a line drawing in the recipe's hue, and it fills in
  as the cook matches ingredients.

Layouts, flows, order and copy stay as they are. Only the material changes.

## What the page shows

1. **Hero.** It gives the name and the idea in two sentences.
2. **Three phones at 390 px, light.**
    - Home. Its corner is lit by Lemon ricotta pancakes, so it shows the butter wash `#F8ECCE`.
    - My recipes, in list view, with all nine rows.
    - Recipe detail for Lemon and thyme roast chicken, as a whole page. It uses the terra light.
3. **Two phones at 390 px, dark.** Home and Recipe detail.
4. **Recipe detail at 1280 px, light.** It uses today's 12-column layout and the full sidebar.
5. **Token strip.** It shows the light and dark roles with hex values and ratios, four recipe lights, type samples,
   and one motion note with a check you can tap.

You can tap the ingredient boxes and the steps on the phones. The check overshoots, and the glow moves.

## Copy and data

- All copy comes from the current boards: `HomeMobile`, `RecipesMobile` and `RecipeDetailMobile`.
- The Recipes board uses the avatar SR (Sam Rivera). The mockup uses **one cook, Eliza Ramirez (ER)**, on every
  screen.
- The list is sorted by "Recently edited". That is the label the board shows. The board itself does not sort the
  rows.
- Card lines follow the real component. If an item does not fit, it drops off the line. It is never cut in half. So
  some rows hide the "Edited …" time, exactly as the shipped card does.

## Colour, key pairs

Every figure below is from the brief. Text needs 4.5:1. Edges, glyphs and focus rings need 3:1.

| Pair                                                         | Light          | Dark             |
| ------------------------------------------------------------ | -------------- | ---------------- |
| `ink` on canvas / paper                                      | 13.78 / 15.80  | 15.77 / 13.60    |
| `inkMuted` on canvas / paper                                 | 4.97 / 5.70    | 8.01 / 6.90      |
| `actionText` on canvas / paper                               | 5.28 / 6.05    | 8.67 / 7.48      |
| Label on the solid action                                    | 4.67 (white)   | 7.97 (`#0F1F1C`) |
| `lineControl` on paper (every outlined control)              | 3.62           | 3.94             |
| Selected edge on `selectedFill`                              | 5.05           | 6.48             |
| `inkMuted` on any recipe wash                                | 4.90 to 4.98   | 7.50 to 7.63     |
| `ink` on any step glow                                       | 12.96 to 13.34 | 13.03 to 13.39   |
| Current step circle (`action` fill) on any glow              | 3.74 to 3.85   | 7.17 to 7.36     |
| Number inside that circle (`on-action` on `action`)          | 4.67           | 7.97             |
| Inactive tab on glass at 92% (worst case: ink text under it) | 4.86           | 4.94             |
| Same, over pure black / pure white (harsher bound, QA pass)  | 4.76           | 4.85             |
| Avatar: `ink` on `#E8DCC4` / `#3A3428`                       | 11.91          | 10.50            |
| Status bar on the terra ground                               | `ink` 10.32    | `#F2ECE2` 9.97   |

Pairs measured for this build with the brief's method (WCAG relative luminance):

| Pair                                                                     | Ratio |
| ------------------------------------------------------------------------ | ----- |
| `inkMuted` on Home's butter corner `#F8ECCE`                             | 4.96  |
| `inkMuted` on the dark butter corner `#1E190D`                           | 7.56  |
| Butter study line `#6F6242` on its pool `#F6E7C1` (Coming soon sketches) | 4.89  |
| Dark butter study line `#CBBD9A` on `#2A2313`                            | 8.37  |
| Dark `inkMuted` on the dark Soon badge (`paperRaised`)                   | 6.22  |

## Accessibility QA pass

Every text node on the page was measured in headless Chromium: text colour against the worst pixel actually
rendered under its glyph box, with text hidden so gradients, glass and washes are included. 556 visible text runs,
light and dark, at 320, 360, 390, 1280 and 1400 px. Result: none below AA.

- Lowest light text pair: `inkMuted` on the linen Soon badge, 4.62. Lowest dark: `inkMuted` on `paperRaised`, 6.22.
- Control edges and graphics: `lineControl` is 3.62 on paper and 3.16 on canvas in light, never below 3.11 on any
  wash, and 3.94 or more in dark. `action` is 3.92 or more on any wash. The honey star is 3.52 or more.
- Every ratio in the tables above was recomputed from the hex values in the page and matches.
- No horizontal scroll at 320, 360, 390, 1280 or 1400 px.
- Two things a tool will flag that are not failures: the status-bar line box touches the tin rim on the dark recipe
  page by one pixel row (the glyphs do not, `ink` on the terra ground is 9.97), and the New recipe button floats over
  the last row of My recipes, as it does in the app.
- Not changed, for the owner: filter chips are 36 px tall, under the 44 px target in the brief. Add hit padding when
  built.

## What was fixed from round 3

The final brief asked for these, and the mockup shows them:

- **Glass** is 92% in both themes: `paper` in light and `paperRaised` in dark.
- **No CSS filter on any cover.** (The only filters on the page are the glass blur, the paper grain, and the blur on the two drawn photo stand-ins.) Every food fill is a swatch key with a light value and a dark value at OKLCH
  L − 0.08. The page makes 88 of these. The pad thai's dish surface is one of them. Photos are never changed.
- **The status bar** comes from the ground of the active theme. On the dark recipe page it is light text on
  `#4A3326`, at 9.97:1.
- **Butter and oat washes** use the new values.
- **Home's corner** takes the first recent recipe's wash.
- **The timer chip** is `paper` in light and `paperRaised` in dark. It has a thin ring and is never linen.
- **Chips on art** are paper with a 14% ink ring. Draft has a dashed pewter edge. PRO has an ink edge and tracked
  caps.
- **The wordmark dot** is ink. The sidebar's New recipe has no shadow.
- **The avatar** uses its own colour pair.
- **The chevron** is back on "8 comments", and **the globe** is back on "Public".
- **4.8 stars** show a fifth star clipped to 80%, over a pewter outline.
- **Studies and Soon sketches** are drawn in the recipe's own hue. The pool is r 110 in a 400 × 300 frame.
- **A selected chip** has a tick.
- **The desktop sidebar** matches the HomeSidebar component. It shows the wordmark, New recipe, the destinations,
  a divider, the profile row and the collapse control.

## Two cover changes forced by the brief's own checks

The brief says every object in a cover must reach 1.3:1 against what it sits on. Two round 3 covers failed this.

- **Lemon ricotta pancakes.** The cream plate on the butter ground was 1.25:1. The plate becomes its second
  material, a blue-grey enamel `#6E8A90`. It is 2.75:1 on the ground. The pancake is 1.68:1 on the plate.
- **Miso-glazed salmon** (new in this build). The cream plate on the sky ground was 1.28:1. The salmon moved to the
  ink ground, where the plate is 10.35:1.

The new covers are Chicken cacciatore (in a skillet on oat), Miso-glazed salmon, the Pork shoulder study and the
Black bean chili study. The cacciatore sauce is 4.26:1 on its ground in light and 1.59:1 in dark.

## Materials in dark

The food swatches use the generated L − 0.08 dark value. The **vessel materials** (plate, tin, iron, wood, glass)
keep hand-set dark values, stepped down like `coverPlate`. This keeps the food the brightest thing in the frame. This
is a small departure from "every fill is generated". Decide it before the swatch table is built.

## Type

- Fraunces is used for names only: greeting, page titles, recipe titles, card titles and the cook's group labels.
- Inter is used for everything the app says.
- Sizes follow the brief's table: 34 for large titles on phones, 44 to 46 on desktop, 16 for compact card titles,
  and 16/1.6 for reading text.

## Motion in the mockup

- **Screens settle in.** Items fade up 6 px over 220 ms, 30 ms apart, with at most six items.
- **The recipe's light blooms.** It takes 200 ms and starts at 180 ms.
- **The check toggle** is the one signature motion: 220 ms, scale 0.85 → 1.06 → 1.
- **The step glow** moves with a 200 ms colour change. Nothing reflows.
- Nothing loops. With `prefers-reduced-motion`, every animation and transition is off.

The open transition (the card's picture grows into the hero) is described, but not animated, in the mockup.

## Phone width

- The page uses 16 px gutters and does not scroll sideways.
- A short script scales each phone frame and the 1280 frame to fit the width.
- This was checked in headless Chromium. `scrollWidth` equals the viewport at both 390 px and 1280 px.

## What the sample does not show

- Discover, Collections and the editor, including the cover drawing itself as the cook types.
- The open transition between a card and the recipe page.
- Real phone photos. The two photos are drawn stand-ins.
- More than four recipe lights.
- Any real cook seeing it. All of this is design judgement, not user evidence.

The gates in section 4 of the brief still apply before build. They are the coverage audit, the review of 200 real
recipes, real photos, device checks and the frames still owed.

## Owner calls

1. Home's corner is lit by the first recent recipe. This amends issue #145 a second time.
2. Card titles and the cook's group labels are set in the serif. This amends "display face for names only" in the
   build spec.
3. The dark action is a mint fill with a dark label, using one token.
4. The open transition and the light bloom are added next to the one signature motion.
5. The generator replaces `covers.ts`. The six tints survive in the ground table.
