# Still Life — Designer 3, Round 1

Mockup: [`mockup.html`](mockup.html). It has four frames: Home at 390 px (light), Recipe detail at 390 px (light and
dark), Home at 1280 px (light), and a token strip.

## The idea

**The interface is the white plate, and the food brings the colour.** Today, every surface in Commise competes a little:
sand wash, seafoam, coral, glass, Playfair. In Still Life the chrome goes quiet. It is oat paper, green-black ink and one
basil action. The colour moves into the one place a cook wants it, the recipe. Most recipes have no photo, so each one
gets a **plate**: a flat, cut-paper still life of its lead ingredients on a coloured ground, with a faint risograph grain.
The pancakes sit on butter yellow with a lemon wheel and three blueberries. The pad thai is a noodle swirl and a lime
wedge on chili. The roast chicken sits in its tin on terracotta. A library of plates looks like a gallery wall of small
prints, not a list of grey placeholders. That is the excitement, and it belongs to the cook's own food. The rest of the
screen is calm because it has nothing to prove.

This is deliberately not what `modernizeA.md` and `modernizeB.md` did. Both kept the palette and made glass the news.
Here glass stays where D12 puts it and is not the idea. The idea is a new imagery system, and a palette and type
built to frame it.

## Palette

Roles keep their current names (`canvas`, `paper`, `ink`, `action`, …), so a re-theme is a value change. Every ratio
below was measured with the WCAG 2.x relative-luminance formula. **T** marks a text pair, which needs 4.5:1 (3:1 for large
text). **N** marks a non-text pair (control edge, glyph or focus), which needs 3:1.

### Light

| Role           | Hex       | Use                                                                                  |
| -------------- | --------- | ------------------------------------------------------------------------------------ |
| canvas         | `#F6F2EA` | oat page. The sand wash (issue #145) becomes a flat oat, and plates carry the warmth |
| paper          | `#FFFDF8` | cards, strips, sheets                                                                |
| surface-muted  | `#ECE6D9` | timers, Soon skeletons, the off segment                                              |
| ink            | `#1F2A22` | green-black text                                                                     |
| ink-muted      | `#5E6259` | secondary text                                                                       |
| line-divider   | `#E3DCCD` | hairlines only, never text or a control edge                                         |
| line-control   | `#8C8578` | checkbox and input edges                                                             |
| action (basil) | `#2E6B47` | the one filled CTA, the checked box, the current step                                |
| action-pressed | `#24573A` | the pressed fill                                                                     |
| action-text    | `#2A6342` | links, active tab                                                                    |
| action-tint    | `#DDEBDF` | tonal button, selected nav, active tab pip                                           |
| saffron        | `#A36A00` | star glyphs only                                                                     |
| saffron-text   | `#8A5800` | the text sibling, for a coloured rating word                                         |
| danger         | `#B23F28` | destructive text and fill                                                            |

| Pair                                          | Ratio              | Kind                                   |
| --------------------------------------------- | ------------------ | -------------------------------------- |
| ink on canvas / paper                         | 13.31 / 14.62      | T                                      |
| ink-muted on canvas / paper / surface-muted   | 5.59 / 6.13 / 5.02 | T                                      |
| white on action                               | 6.34               | T                                      |
| white on action-pressed                       | 8.40               | T                                      |
| action-text on canvas / paper / surface-muted | 6.35 / 6.97 / 5.70 | T                                      |
| action-text on action-tint (tonal button)     | 5.75               | T                                      |
| ink on action-tint                            | 12.05              | T                                      |
| danger on canvas / paper                      | 5.17 / 5.68        | T                                      |
| saffron-text on canvas                        | 5.41               | T                                      |
| saffron star on canvas / paper                | 4.07 / 4.47        | N (fails as text, so it is never text) |
| line-control on canvas / paper                | 3.28 / 3.60        | N                                      |
| focus ring (`#2E6B47`) on canvas / paper      | 5.68 / 6.24        | N                                      |
| action fill against canvas                    | 5.68               | N                                      |

### Dark ("night kitchen": warm green-black, never blue)

| Role                | Hex                                    |
| ------------------- | -------------------------------------- |
| canvas              | `#131512`                              |
| paper               | `#1C1F1A`                              |
| paper-raised        | `#252923`                              |
| surface-muted       | `#262A24`                              |
| ink                 | `#EEEBE3`                              |
| ink-muted           | `#ABA89F`                              |
| line-divider        | `#30342D`                              |
| line-control        | `#7A7E73`                              |
| action              | `#86C99F`, with a dark label `#0F1A12` |
| action-pressed      | `#6FB88B`                              |
| action-text / focus | `#93D3AA`                              |
| action-tint         | `#22362A`                              |
| saffron             | `#E8B54A`                              |
| danger              | `#F08C74`                              |

| Pair                                                 | Ratio                      | Kind |
| ---------------------------------------------------- | -------------------------- | ---- |
| ink on canvas / paper                                | 15.41 / 13.99              | T    |
| ink-muted on canvas / paper / surface-muted          | 7.72 / 7.01 / 6.14         | T    |
| label `#0F1A12` on action / pressed                  | 9.24 / 7.57                | T    |
| action-text on canvas / paper / surface-muted / tint | 10.61 / 9.63 / 8.44 / 7.45 | T    |
| ink on action-tint                                   | 10.82                      | T    |
| danger on canvas / paper                             | 7.61 / 6.91                | T    |
| saffron on canvas                                    | 9.74                       | T    |
| line-control on canvas / paper                       | 4.42 / 4.01                | N    |
| focus on canvas / paper                              | 10.61 / 9.63               | N    |
| action fill against canvas                           | 9.50                       | N    |

In dark mode the action becomes a light fill with a dark label. This matches the current "light fills take charcoal"
family. That keeps the CTA the brightest thing on a dark screen, at 9.2:1.

### Plate grounds

| Ground     | Light     | Dark      |
| ---------- | --------- | --------- |
| butter     | `#F3D67F` | `#C9A54C` |
| chili      | `#EBA37E` | `#B86E4C` |
| tomato     | `#E5624A` | `#B4442F` |
| olive      | `#C5CC94` | `#8D965E` |
| terracotta | `#E9B48C` | `#B5805B` |

At night the whole plate also takes `brightness(.8) saturate(.92)`, so it never glares out of a dark screen. **No text is
ever set on a ground.** Status badges on a plate (Private, Draft, Premium) sit on a solid `paper` chip in either theme:
ink on chip is 14.62:1 (light) and 13.99:1 (dark), whatever the ground. This removes the need to measure every badge
against every ground. The cuisine and the title live below the plate, on canvas.

### Collisions settled

- **Basil and success share a hue family.** Success never relies on colour alone. A checked ingredient has a filled box,
  a check and a strike-through. "Back online" keeps its icon and words. The success tone keeps its own role, and the
  rule is the same as today: colour is never the only signal.
- **Coral leaves every control** (already ruled). In Still Life, coral, tomato and chili exist only inside plates.
- **⚠️ This amends D13.** The New recipe button becomes basil, not seafoam (on iOS 26: basil-tinted glass). The
  owner has to call this. If the owner keeps seafoam, the concept still works: swap `action` and `action-text` and
  re-measure. The plates carry the identity, and the action hue does not.

## Type

- **Display: Fraunces** (Google Fonts, variable). Optical size 96 to 144, `SOFT` 100, weight 540, tracking −1.5%. It is
  used only for screen titles, recipe titles and section heads (Ingredients, Steps, Coming soon), at 22 px and up. The
  soft axis rounds the serifs, so it reads like a well-set cookbook, not a wedding invitation. Playfair's needle
  contrast is the single biggest reason the app reads "dated food blog".
- **UI and reading: Inter**, kept, with the optical-size axis (14 to 32). This honours the ruling that numbers use Inter
  with tabular digits. Every time, quantity, calorie count, step number and rating is Inter tabular. Step numbers sit in
  quiet paper discs, not decorative serif numerals.
- **Scale (phone):** large title 32/1.08, recipe title 34/1.06, section head 26/1.15, list head 19/1.25 Inter 600,
  body 17/1.6, row 16/1.45, meta 13–14, overline 12 at +8% caps. On desktop the large title steps to 46 and the card
  titles to 22.
- **Why:** two families, with a clear split. The serif speaks for the food, and the sans does the work. The
  Fraunces/Inter pairing is warmer than Playfair/Inter and less formal.

## Surfaces, shape, elevation

- **Flat by default.** There are no boxes on boxes. Cards are `paper`, with a 1 px inset hairline and no drop shadow. Only
  the plates cast a soft warm contact shadow, so the food is the one object that sits "on" the page.
- **Radius:** plates 22 (phone) and 24 (desktop), cards and strips 20, the recipe sheet's top 28, inputs stay rectangles
  (6), and only pressable controls are pills.
- **Recipe detail:** the content sheet slides 28 px up over the hero plate with a rounded top, like a card set on a
  board. The layout and order are unchanged.
- **Glass (D12):** only on the tab bar (a floating pill), the hero's back and ⋯ discs, menus and sheets. The solid
  fallback is `paper` (`#FFFDF8` and `#1C1F1A`). Tab labels on it are ink-muted 6.13 / 7.01 and active action-text
  6.97 / 9.63, so the bar stays readable with blur off.
- **Texture:** the risograph grain lives inside plates only. It is never under text or controls.
- **Ingredients** read as a ruled list (hairline per row), not stacked boxes. The current step is the only step on paper.

## Iconography

A custom 24 px set with a 1.75 stroke and round caps and joins. Round shapes (clock, compass) are drawn as **open
arcs**, a small hand-drawn quirk that matches the cut-paper plates without becoming cute. Icons are filled only for
stars.

## Imagery for recipes without photos: the plate system

- **Grammar:** one ground colour and three to five flat shapes, plus one off-axis accent (a sprig, a berry, a lemon
  wheel). Large, soft, slightly irregular forms, with no outlines and no gradients.
- **Generation (to build):** a pure function `plateFor(recipe)` reads the first matched ingredients (catalog food ids,
  already resolved) and maps each to a motif from a curated library of about 120 shapes (lemon, sprig, noodle, bowl,
  bread, bird, root, leaf, berry…). The ground comes from the dominant motif's family. A seeded layout keyed on the
  recipe id makes it deterministic, so a recipe always looks the same. The fallback is the cuisine's ground with one
  utensil motif. A real photo always wins.
- **Accessibility:** a plate is decorative (`alt=""` / `accessible={false}`). The title already names the dish.

## Motion

- **Kept, as the one signature:** the overshoot on the check toggle. In Still Life the box fills basil and the
  ingredient's strike-through draws left to right in 180 ms.
- **Quiet transitions around it:** plates fade up 8 px at 240 ms, staggered by 40 ms, on first paint only. The recipe
  sheet settles over the hero with a 280 ms ease-out on open. The New recipe button shrinks to its icon on scroll (D4)
  at 200 ms. Nothing loops, nothing parallaxes, and nothing bounces except the check.
- **Reduced motion:** every transition becomes an instant cross-fade. The check toggle shows its end state.

## What makes it exciting

The library becomes a wall of small, joyful prints of the cook's own food. Each recipe gets a face the first time it is
saved, without a camera. The Fraunces titles give each recipe a cookbook's dignity. Basil green and oat read
"fresh kitchen", not "SaaS teal".

## What keeps it calm

- One accent and one filled button per view.
- Colour is fenced into plates, so the chrome never shouts.
- There are no borders on borders, no shadows except under food, and generous rhythm (sections 36–40 px apart).
- Textures and motion are rare and slow.
- Dark mode is a warm night kitchen, and plates dim instead of glowing.

## Owner rulings touched

- **D13:** amended (basil, not seafoam). This needs an owner call.
- **Canvas wash (#145):** the wash becomes flat oat, and the warmth moves into the plates. This also needs an owner call.
- **Honoured:** numbers in Inter tabular, pills only for pressables, chips as tint with a check, coral off controls, one
  signature motion, glass on the nav and control layer only, no Soon items in navigation, no version number on the
  recipe page.

## Changes since last round

This is round 1. There is no earlier round.

## Open risks

- The plate library is real illustration work (about 120 motifs). Until it exists, the cuisine-ground fallback must look
  good on its own.
- Fraunces adds about 90 KB (one variable file, latin subset) on web and two static faces on native.
- Ratios were measured on flat colours. Glass over a moving plate was checked only against its solid fallback.
