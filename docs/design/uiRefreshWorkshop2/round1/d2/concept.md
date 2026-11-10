# Induction: a recipe is a heat signature

## The idea

The screen is a sheet of induction-hob glass, and every recipe is drawn as its own **heat signature**: a ring
whose arcs are the recipe's steps, each arc as long as that step takes and coloured by how hot it is (cool blue
for prep, ember for the sear, deep red for the roast, violet for the rest). Light comes up _through_ the glass
from the rings, the way a hob lights under a pan. There are no photos and no cards. A recipe's identity is the
shape of its time and heat.

- **Home** is the hob. Recent recipes are lit rings you can read at a glance: a long braise is a long red sweep;
  a salad is a short blue tick. "Coming soon" (meal plans, grocery list, today's nutrition) are **unlit
  burners**: same shape, no glow, labelled Soon. The metaphor explains the roadmap without a sentence of UI.
- **Recipe detail** opens on the full-size ring as the hero. Its centre holds total time and servings. Below,
  each step carries a short arc in its colour, so the list and the ring are the same object read two ways.
  Ingredients are a plain, quiet list, because that is what you read with flour on your hands.

## Why it is new

Recipe apps lead with a food photo and a card. This leads with **time and heat**, the two things a cook is
actually managing, and makes them the visual identity of each recipe. Nobody has drawn a recipe as a
generated glyph of its own process. It also removes the dependency on photography: a recipe with no photo
still has a beautiful, unique, honest face, generated from its own data (step durations and temperatures).

## Why it fits cooking

- **Glanceable from across the counter.** A ring reads at two metres; a paragraph does not. In cooking mode
  the current arc can simply brighten as the step's timer runs.
- **Heat is the language of the kitchen.** Cool to hot is a scale every cook already feels.
- **Memory.** "The one with the long red sweep" is how people will remember a recipe, like a face.

## Why it stays calm

One light source per screen, everything else dark glass and quiet type. Colour exists only where heat
exists. The one motion is a slow simmer breath of the glow (6 s cycle), off under `prefers-reduced-motion`.
No gradients on text, no glass blur stacks, no badges.

## Palette (in brief)

- **Dark (default, "hob glass")**: ground `#0B0D12`, raised `#141821`, ink `#ECEFF4`, muted `#A3ACBB`
  (7.9:1 on ground), hairline `#262C38`.
- **Light ("white ceramic hob", cool, not cream)**: ground `#F3F5F8`, raised `#FFFFFF`, ink `#11141B`, muted
  `#4D5666` (7.2:1).
- **Heat scale** (graphics only, never body text): prep `#5B8CFF`, warm `#FFB547`, sear `#FF7A45`,
  roast `#E5484D`, rest `#A77BFF`. The primary action is ember `#FF8A50` with near-black label (8.6:1).
  On light the arcs shift one step deeper so they hold 3:1 as graphics, and ember deepens to `#C2410C` with a white label (5.2:1). Heat colour never carries text; step durations are ink with a heat dot.

## Type

**Sora** for display and numerals (round, technical, like hob markings), **Inter** for reading text at
16/1.5 minimum. Tabular numerals for every time and quantity.
