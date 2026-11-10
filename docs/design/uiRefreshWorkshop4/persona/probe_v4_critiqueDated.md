# Proposal A, "Still Life, Lit": critique

**Verdict: do not ship.** It reads as dated on sight.

## Render

I rendered `proposalA.html` with Playwright at 1400 and 320 px (light) and 390 px (dark). There is no sideways
scroll at 320 px.

## The set

`proposalA.html` and `proposalB.html` are **twins**. Structure: both have the same 2×2 recent grid, three "Soon"
cards on Home and the same recipe-page order. Surface: both have a cream ground, drawn covers in place of photos
and a teal action. They differ only in drawing style and typeface.

## What must survive

- Real copy, and quantities in bold in the ingredient rows.
- One filled primary on the recipe page.
- The marked current step.
- The contrast pass.
- The idea that a recipe with no photo still looks finished.

## What fails

- **Cream ground.** Canvas `#F3ECE1` (OKLCH 0.946, C 0.016, h 79) has paper grain on it. This surface is worn
  out.
- **Soft serif.** Fraunces on the greeting and on every card title gives a cookbook mood that reads as 2018–2020.
- **Drawings in place of food.** Flat vector plates in rounded cards look like 2017–2019 onboarding art. The food
  stops looking real.
- **A re-run palette.** Dark action `#6CC0B3` is an earlier round's action colour (ΔE00 0). Light `#31807A` is
  ΔE00 7.6 from `#2A6B65`.
- **The signature is not invented.** The dish-hue wash and step glow are an idea the canon already names. The check
  overshoots (0.85 → 1.06), which is a bounce.
- **Home is recall plus unbuilt rows.** Four recent cards and three placeholder "Soon" cards fill two screens.
  Nothing helps the cook choose dinner.
- **Small chips.** Chips are 36 px, under 44 pt.

## The direction

**"Scale Room."** Use real photos, full-bleed, on a neutral steel-white ground (`#F3F5F4`, C 0.002) with no
grain. Use one grotesk with tabular figures. The reference is the price chart on a 1950s Toledo computing scale. As a utility
object, it is rarely on a moodboard.

- **Signature:** the total time, set very large in hairline-ruled figures beside the photo, on planning screens
  only. It also stays in the stats row, so it encodes nothing. It is banned in cook mode.
- **Palette "Copper":** the action is `#A2461A` in light and `#F2A06C` in dark, like a pan, not a brand. The food
  stays the warmest thing on the cool steel ground.
- **Contrast I computed:** the action is 5.60:1 on the ground in light and 8.98:1 in dark. Ink to Muted is 2.29
  and 1.78. Raspberry danger `#A3133F` is ΔE00 21.8 from the action. The action is ΔE00 40 or more from every
  earlier action colour.
- **Home** leads with one dinner choice and its reasons. "Soon" becomes one line below the fold.

## Not run

- I did not build or render the direction.
- No APCA Lc. No 200% text check.
- No prior-art search for the signature, so the closest-app and excitement tests did not run.
- No data audit of the facts Home can show.

This is heuristic judgement, untested.
