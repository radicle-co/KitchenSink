# Proposal A, "Still Life, Lit": assessment

Rendered in Chromium at 1440 and 390 px, light and dark. 320 px and 200% text not tested. Heuristic judgement,
untested with users.

## Verdict: do not ship

It is dated, and from a known year: about 2021. The ground is warm plaster and paper (`#F3ECE1`, `#FFFCF7`). The
voice is Fraunces with its soft italic. The food is flat vector drawings in rounded, shadowed cards. At thumbnail
size it reads as a 2021 wellness app.

## What must survive

- **A cover for a recipe with no photo, made from its own ingredients.** Most cooks' recipes have no photo, so
  this answers a real Commise problem. Keep the idea. Change how it is drawn.
- **Colour comes from the food.** The chrome stays quiet.
- **Conventional structure:** three tabs, a vertical library with a count, a visible Screen on switch, a servings
  stepper, timer chips. The contrast QA is rigorous.

## What fails

1. **No real food.** The roast chicken is a cartoon. The photo must be the largest, most colourful thing on screen.
2. **The "unfinished study" encodes data.** It fills in as ingredients are matched, so its fill shows progress.
3. **Home is recall only.** A 2×2 grid of recent recipes, then three "Coming soon" cards with sketches. Nothing
   helps the cook choose tonight's dinner.
4. **Wrong primary.** The recipe page's one filled button is **Edit recipe**. The page exists to cook.
5. **Steps lack quantities.** "Mash the butter with the lemon zest" gives no amounts.
6. **The check overshoots.** Use a spring at 100% damping.
7. **The action text `#2A6B65` is an earlier round's colour.** White on the fill is 4.67:1, barely AA.

## What I would do instead

**House answer:** near-white ground, neutral grotesk, big bold title, full-bleed photo, strict list, green
accent. My direction must not land there.

**"Prep list."** A deep char ground, the one coloured planning chrome §3.2 allows, with real photos full-bleed.
**Signature:** a recipe with no photo gets a cover set as type. Its ingredients ("chicken, butter, lemon, thyme")
are set huge in a condensed grotesk and cropped at the card edge. It shows content as type, encodes nothing and
stays out of cook mode. At 320 px and 200% text it is still a block of type. **Reference:** Corita Kent's 1960s
screenprints, words as big flat shapes. Few UI designers pick her because she reads as protest art. **Accent:**
saffron, far from every earlier seafoam.

Calmer controls: Home's deciding state shows three dinners with reasons ("35 min, uses the spinach") and
**Cook this** as primary. The recipe page's primary is **Start cooking**. Edit moves to the top bar. Coming soon
becomes one line. The tick does not bounce.

It differs from the house answer in ground and type genre. **Risk:** Spotify sets type on colour for playlist
covers. Ours sets ingredients, not a name. I flag this. I do not claim it passes.

**Not run:** palette script, ΔE00, swatch strips, mockups.
