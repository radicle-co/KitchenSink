# Kitchen Press — Designer 2, round 1

Mockup: [`mockup.html`](mockup.html). It has Home and Recipe detail at 390 px in light, Recipe detail again in dark,
Home at 1280 px, and a token strip. It is a sample, not the full set.

## The idea

Commise looks "meh" for two reasons. The colours are polite, and most recipes have no photo, so the library is a grid
of pale tints with one letter on each. Kitchen Press treats every recipe as a small print from a two-ink press. The
paper is warm. The main ink is a deep basil green. The second ink is tomato, saffron or sea blue. Where two inks
overlap they multiply, the second plate sits 2 px out of register, and there is real grain. A recipe with no photo
gets a small still life made from simple ingredient shapes: discs for a pancake stack, waves for noodles, a sun over
a bowl for soup, a dimpled slab and a sprig for focaccia. Over time the library looks like a shelf of prints the cook
made, not like a database. Everything else stays quiet. There is one action colour and no drop shadows on content,
and a short list of type roles does all the talking. The screens, flows and layouts are unchanged. Only the
material is new.

This is not the move from the earlier proposals. `modernizeA.md` and `modernizeB.md` both said: keep the palette,
warm the greys, flatten the content and put glass on the navigation. That fixed what was wrong but gave the app no
character. Kitchen Press keeps their fixes (D11 warm greys and D12 glass on the navigation layer only) and adds
character in two places: the imagery and the type.

## Palette

All ratios are WCAG 2.x relative-luminance ratios, measured on the exact hexes in `mockup.html`.

### Light — paper

| Role          | Hex                                                                    | Use                                                     |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `paper`       | `#F5F0E6`                                                              | Page canvas.                                            |
| `sheet`       | `#FFFCF6`                                                              | Cards, sheets, chips placed on covers.                  |
| `well`        | `#EDE6D8`                                                              | Muted surface: timer pill, placeholders, resting input. |
| `ink`         | `#1C2422`                                                              | Text. Green-black, not neutral black.                   |
| `ink-muted`   | `#5C574E`                                                              | Secondary text (D11 warm family).                       |
| `line`        | `#E3DACB`                                                              | Decorative hairline only. Never a control edge.         |
| `edge`        | `#86806F`                                                              | Control edges: checkbox, stepper, switch, outlines.     |
| `basil`       | `#1D5E4F`                                                              | The one action colour: filled buttons and action text.  |
| `tomato`      | `#E4543A`                                                              | Ink for graphics only. Never a text fill.               |
| `tomato-text` | `#A93A23`                                                              | Red as text: errors, destructive labels.                |
| `saffron`     | `#F3B23A`                                                              | Ink, and a fill under an `ink` label.                   |
| `sea`         | `#3C68A8`                                                              | Third ink, for covers.                                  |
| `honey`       | `#9A6A12`                                                              | Filled stars. Graphic only.                             |
| Cover grounds | `#DCEBE3` basil · `#F9DDD2` tomato · `#FBEBC4` saffron · `#DCE5F2` sea |                                                         |

### Dark — night press

| Role          | Hex                                           | Note                                        |
| ------------- | --------------------------------------------- | ------------------------------------------- |
| `paper`       | `#151B1A`                                     | Green-black, so it never reads as grey.     |
| `sheet`       | `#1D2423`                                     | Cards, and the opaque tab-bar fallback.     |
| `well`        | `#262E2D`                                     |                                             |
| `ink`         | `#EFE8DA`                                     | Paper colour, so text stays warm.           |
| `ink-muted`   | `#A8A193`                                     |                                             |
| `line`        | `#2E3736`                                     | Decorative.                                 |
| `edge`        | `#6E7A72`                                     | Control edges.                              |
| `basil`       | `#7FD1B6`                                     | Fill with label `#0F1A17`, and action text. |
| `tomato`      | `#FF8C6E`                                     | Ink, and safe as text here.                 |
| `saffron`     | `#F2C15C`                                     |                                             |
| `sea`         | `#8FB2E8`                                     |                                             |
| `honey`       | `#E2B04A`                                     | Stars.                                      |
| Cover grounds | `#20362F` · `#3A2620` · `#3A3220` · `#1F2A3A` |                                             |

In dark mode the inks blend with `screen` instead of `multiply`, so overlaps get lighter, the way light ink looks on
black stock. The grain drops from 22% to 16%.

### Key pairs (text needs 4.5:1, graphics and control edges need 3:1)

| Pair                                                    | Light              | Dark               |
| ------------------------------------------------------- | ------------------ | ------------------ |
| `ink` on `paper`                                        | 13.96              | 14.31              |
| `ink` on `sheet`                                        | 15.48              | 12.96              |
| `ink-muted` on `paper` (inactive tab on glass fallback) | 6.31               | 6.80               |
| `ink-muted` on `sheet`                                  | 7.00               | 6.16               |
| `ink-muted` on `well`                                   | 5.77               | 5.42               |
| `basil` action text on `paper`                          | 6.68               | 9.72               |
| `basil` action text on `sheet`                          | 7.41               | 8.80               |
| Label on `basil` fill (New recipe, Edit recipe)         | 7.59 (white)       | 9.91 (`#0F1A17`)   |
| `edge` on `paper` / `sheet` / `well` (controls)         | 3.47 / 3.85 / 3.17 | 3.90 / 3.53 / 3.10 |
| Focus ring (`basil`) on `paper`                         | 6.68               | 9.72               |
| `tomato-text` on `paper` / `sheet`                      | 5.57 / 6.18        | 7.67 / 6.94        |
| `tomato` as a graphic on `paper`                        | 3.29               | 7.67               |
| `honey` stars on `sheet` / `paper`                      | 4.61 / 4.16        | 8.76 on `paper`    |
| Draft: `ink` on saffron ground                          | 13.42              | 10.40              |
| PRO: saffron on `ink` / `#0F1A17` on saffron            | 8.48               | 10.64              |
| Public: `ink` on basil ground                           | 12.86              | 10.57              |
| Timer label on `well`                                   | 12.76              | 11.40              |

Rules that follow from these numbers:

- **Tomato is never a fill under text.** Ink on tomato is 4.25:1 and white is worse. It is an ink only. Where red has to
  be read, use `tomato-text`.
- **Text never sits on cover art.** The time and the Private, Draft and PRO badges sit on solid chips (`sheet`,
  saffron ground or `ink`). So the ratios above hold whatever the art underneath is.
- **The glass bars are measured on their opaque fallback** (`paper` in light, `sheet` in dark). Their translucency
  is 86% and 84%, so the blurred result is never less legible than the fallback.
- The active tab is shown by a 3 px basil bar, a bold label, a tomato dot inside the glyph and `aria-current`. Colour
  is never the only signal.

## Type

- **Display: Bricolage Grotesque** (variable: optical size 12–96, width 75–100). Used only for the large greeting,
  the recipe title, section headings and desktop card titles, at width 86–92 and weight 650–700. It is warm and a
  little odd, like a hand-set grotesque. It has the character Playfair was trying for, but without the 2010s
  editorial-template feel or old-style figures.
- **Body: Figtree** 400–700. A friendly geometric sans with open forms that reads well at 13–18 px. It replaces
  Inter, which is the default of every UI kit.
- **Measure: DM Mono** 400–500, with `tnum` and `lnum`. Used for every quantity, time, calorie count, date overline
  and tag list. It reads like a stamped kitchen ticket. Because it is monospaced, "1 h 50 min", "800 g" and "3 tbsp"
  line up in columns, which fixes the old-style numeral problem modernizeA raised.

| Role             | Spec                                                    |
| ---------------- | ------------------------------------------------------- |
| Display XL (web) | Bricolage 64 / 1.0, −0.022 em, wdth 86                  |
| Display (phone)  | Bricolage 40 / 1.0 (greeting), 34 / 1.04 (recipe title) |
| Section          | Bricolage 21 (phone) / 24 (web), 650                    |
| Card title       | Figtree 15 600 (compact), Bricolage 20 650 (full card)  |
| Body             | Figtree 16–18 / 1.5–1.6                                 |
| Step text        | Figtree 17 / 1.55                                       |
| Measure          | DM Mono 13–17, 500, tnum                                |
| Overline / label | DM Mono 11, caps, +0.12 em                              |

Three families sounds like a lot, but each has exactly one job. Nothing is set in a family it does not own.

## Surfaces, shape and elevation

- **Flat paper, no content shadows.** A print has no drop shadow. Cards are `sheet` on `paper` with a 1 px `line`
  inset. Depth comes from the difference in tone, not from blur.
- **Only floating things have a shadow:** the New recipe button, the tab bar and the hero's discs. They are also the
  only glass, which follows D12.
- **The ticket.** The facts strip (Total, Prep, Difficulty), the nutrition row and the servings stepper are sheets
  divided by dashed rules. They look like a kitchen order ticket.
- **Radius:** covers 14, cards and widgets 20, tickets 16, buttons 14, chips 8, checkboxes 6. There are no pills on
  controls (modernizeA §1.4), except the carousel dots and the tab indicator.
- **Difficulty** is drawn as three small saffron bars, not a coloured pill, and its word is always next to it.
- **Icons:** 1.75 px rounded strokes. The active tab and the active sidebar row add one small tomato "ink spot" inside
  the glyph. That is the only decoration on the icons.

## Imagery for recipes without photos — press prints

- Each cover is a tinted ground plus two ink layers built from a small set of shapes: disc, slab, wave, half-moon
  bowl, leaf, sprig, dot and rule. The second layer is offset by (2, 1) px. A 7 px halftone at 6–7% and a
  fractal-noise grain sit on top.
- **Deterministic.** The shape set comes from the recipe's cuisine and tags (noodles → waves, soup → bowl,
  bread → slab). The ink pair and ground come from the recipe-id hash that `RecipeCover` already uses. The same recipe
  looks the same everywhere, on every device.
- **Theme-aware.** The art only uses role tokens, so dark mode re-inks it (lighter inks, `screen` blending, dark
  grounds). No second asset is needed.
- **Decorative only.** `aria-hidden`, as today. The title is what names the card.
- **Photos stay photos.** A real photo (the roast chicken hero) gets the same light grain, so photos and prints feel
  like one set.
- **Placeholders are not grey.** The "Soon" widgets are drawn as quiet outlines in the same set: a dotted ring, a
  seven-day row with today in basil, and a print thumbnail outline.

## Motion

- **Registration settle.** The second ink layer of a cover moves 4 px into register on first appearance, and both
  layers fade in (360 ms, ease-out `cubic-bezier(.2,.8,.2,1)`). It runs once per cover per session, never on scroll-back.
- **Stamp tick.** Checking an ingredient fills the box with basil, scaling 0.85 → 1, in 140 ms. The strikethrough
  is drawn left to right in tomato over 180 ms.
- **Current step.** The tomato left rule grows from the top over 220 ms. The numeral disc fills with ink.
- **Large title condense.** This is a cross-fade, not a slide. The glass bar's opacity follows the scroll position.
- **Reduced motion:** every motion above becomes an instant state change. The grain never moves.

## What makes it exciting

- The library becomes a collection of art that is the cook's own. Each new recipe adds a new print, so there is a
  small reward for writing one.
- The type has a voice. A big, slightly quirky grotesque greets the cook by name, and the stamped mono numbers make
  the recipe feel handled and real.
- The colour is real colour: tomato, saffron, basil and sea are food colours. They are confident, but they stay inside
  the art.

## What keeps it calm

- Interactive colour is basil and nothing else. The other inks never mark a control, so the cook never has to ask
  what is clickable.
- Two inks per cover at most, and one cover per card. Content has no shadows and no gradients.
- Warm paper in light and green-black in dark. There is no pure white or pure black glare, which suits a kitchen at
  6 am or 10 pm.
- Spacing is generous and unchanged from the current layouts: 28 px between sections on phones, and 36 px on desktop.
- The motion is slow, happens once, and is gone under reduced motion.

## Conflicts with owner rulings (proposed amendments, not silent changes)

- **Palette change.** The owner said they "like the color palette we have, mostly." This concept replaces seafoam
  with basil, which keeps the ocean-dark lineage at `#1D5E4F` against today's `#2A6B65`. It also replaces coral with
  tomato, and premium and warning with saffron. That is a proposed amendment to the palette in `colors.ts`, not a
  tweak. A cautious fallback keeps this concept's imagery, type and surfaces on today's hues. In it, seafoam is the action
  colour and coral is the second ink. The idea survives that, but at lower volume.
- **D13.** D13 says the New recipe button is "seafoam-tinted". Here it is basil. On iOS 26 it is basil-tinted real
  Liquid Glass. The rest of D13 is unchanged.
- **D11** (warm greys) and **D12** (glass on navigation only) are kept as they are.

## What I changed since last round, and why

Round 1: no prior round.
