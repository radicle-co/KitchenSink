# Plate Signatures (Designer 3, round 1)

## The idea

Every recipe draws its own plate. Commise has almost no photos, so instead of an empty card or a stock gradient, each
recipe gets a **signature**: a round mark generated from its real data and seen from above, like a plate on a table.

- **Outer ring = time.** Prep, cook and rest arcs sized to the real minutes. A ragù is a long red sweep; a salad is a
  short one.
- **Middle ring = steps.** One tick per step.
- **Centre = ingredients.** A seed per ingredient, coloured by food family (citrus, herb, protein, root, aromatic, fat,
  spice) and sized by how much of the dish it is.

On Home, signatures are the identity of each recipe, and their **size is total time**, so the rack is not a uniform
grid: a cook sees "quick" and "slow" before reading. On Recipe detail the signature is the hero, and its legend
replaces the old facts strip. While cooking it becomes the instrument: the current step's tick lights up on the
ring, done steps go quiet, and the plain step text beside it is large and straight.

## Why it is new

Recipe apps borrow from magazines (photo + serif) or from productivity apps (cards + chips). This borrows from
neither. The visual identity of a dish is computed from the dish, so the picture is information, not decoration. No
two recipes look alike, and similar dishes look related. It is closer to a data glyph or a watch face than to a
cookbook page.

## Why it fits cooking

- Cooking is time and parts. The mark shows both at a glance from arm's length, with wet hands.
- "Where am I?" is the one question a cook asks mid-recipe. The lit tick answers it without scrolling.
- Food-family colours tie each ingredient line to its seed, so the list and the mark read as one thing.
- Hands-busy controls stay big: 48 px pills for Servings, Timer and Screen on, and 44 px step buttons.

## Why it stays calm

- One cool, neutral ground per theme. Colour lives only inside the signatures and on one action colour.
- All reading text is solid, linear and left-aligned. Nothing is set on a curve, and nothing glows.
- Motion is two things only: the ring draws once on load, and the current step's tick breathes slowly. Both are off
  under `prefers-reduced-motion`.

## Palette and type

- **Light:** ground #F4F6F8 (cool, not cream), surface #FFFFFF, ink #11161D (16.8:1), muted #4A5563 (7.0:1),
  action tomato #B42D18 (5.8:1 on ground; white on it 6.3:1).
- **Dark:** matte #0F1318 (not glass), surface #181D24, ink #ECEFF3 (16.2:1), muted #A3ADBA (8.2:1),
  action #FF8A70 (8.1:1).
- **Food families:** about 9 saturated hues, retuned per theme. Each one is paired with a text label and never carries
  meaning alone.
- **Type:** Bricolage Grotesque 600/700 for display (a grotesque with some character, and no serif). Inter 400/500/600
  for reading and tabular numbers.

## Notes

- The Home recent-recipe names other than the roast chicken, and the chicken's ingredients and steps, are invented in
  the app's voice. The board did not carry them.
- The mark has a text equivalent: each signature has an `aria-label` that states its data, and Recipe detail has a
  visible legend.
- Open question for round 2: Discover and Collections. A collection could be a "table" of overlapping signatures.
