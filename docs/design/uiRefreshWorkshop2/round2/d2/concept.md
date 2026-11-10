# Induction II: Live Hob (Designer 2, round 2)

## The idea

The screen is the hob, and every recipe is a burner. Each recipe is a ring of heat. Each arc is
one step, as long as it takes, on one cool-to-hot scale. The dish sits inside the ring like a pan. That same ring is the
knob you turn to cook. The phone behaves like the appliance it sits next to. Zones are sized by cooking time.
What you made last night shows residual heat. What is coming stays unlit. While you cook, the screen warms
with the step on the stove.

## What I kept (praised in round 1)

- **Unlit burners for "Coming soon."** Both critics called this the best idea of the round, so it stays as it was.
- **Light coming up through dark glass**, with one light source per screen and the 6 s simmer breath.
- **Each step carries its own arc of the ring**, so the list and the ring are one object read two ways.

## What I fixed

1. **"It reads as a fitness ring, not dinner."** A ring of light around nothing looks like a tracker. A ring of
   light escaping from under a pan looks like a hob. The dish now sits _inside_ its burner, and the glow spills
   past its edge. This is where the cook's own photo lives (painted here, since the mockup has no photos). A
   recipe without a photo shows its total time in the pan's place, so a typed recipe still has an honest face.
2. **Five hues plus violet was too many.** There is now **one continuous scale, cool to hot**, named once on
   screen ("Cool, Hot, Off"). Resting is no longer a colour. It is **heat off**: a dim arc. The roast arc fades
   from hot to warm because the oven really is turned down at 20 minutes. The scale tells the truth inside a step.
3. **Light mode lost the idea.** Light mode now has its own material: **white ceramic**. Heat does not glow. It
   soaks up under the frosted surface as a tint (a multiply blend, wider and lower) and falls as a warm shadow
   below the pan. Dark is light through glass. Light is warmth through ceramic. Same scale, two kitchen materials.
4. **Home fell back to a row list.** Home is now a **hob plan**. Each recent recipe gets a zone sized by its
   total time, the way a real hob has a big zone and small ones. "Quick" and "slow" read before any text.
5. **The ingredient list gave up.** Each ingredient wears the heat of the step that uses it. The step-number
   pip is also the check target ("Clear checks" already exists in the recipe's menu). The list reads at 16 px
   and joins the idea.

## What is new and bolder

- **The ring is the control.** The hero has a knurled bezel and a notch: it is a knob. Turn it to move through
  steps (Start cooking stays as a button for anyone who will not turn things). While you cook, the used part
  of the arc is cool and the rest is the timer. So the knob, the progress and the countdown are one
  object. On screen it is a `slider` role with real values, so it works with assistive tech and keyboard
  arrows.
- **Residual heat.** A real hob shows an **H** on a zone that is still warm. Commise does the same: a recipe
  you cooked last night still shows H, and it cools over days. Recency becomes a felt thing, not a date label
  (the label is still there, for clarity and for screen readers).
- **The room warms.** While a step is on the heat, the lower part of the screen takes a faint wash of that
  step's heat. During a rest it cools. You can tell what the stove is doing from across the kitchen.

## Why it is different from D1 and D3

D1 moves to food photos and time as a river. D3 moves to mise-en-place bowls. I keep the ring, and push it
from a picture into an **instrument**: it is the dish's frame, the timer and the control. No other direction
gives the cook something to turn.

## Why it stays calm

One light source per screen. Colour exists only where heat exists, and never carries text. The one moving
thing is the simmer breath (plus one small nudge of the notch on Recipe detail to show it turns). Both stop
under `prefers-reduced-motion`.

## Palette and type

- **Dark glass:** ground `#0A0C10`, ink `#ECEFF4`, muted `#A3ACBB` (about 8:1), action ember `#FF8A50` with a
  near-black label.
- **Light ceramic (cool white, not cream):** ground `#EDF0F4`, ink `#10131A`, muted `#4B5463` (about 7:1),
  action `#C2410C` with a white label (about 5:1).
- **Heat scale (graphics only):** cool `#5B8CFF` / `#2F63E0`, warm `#FFB547` / `#B86E00`, sear `#FF8A3D` /
  `#D2541A`, hot `#FF5A3C` / `#C8321E`, off is a dim neutral. Light values are one step deeper so arcs hold 3:1.
- **Type:** Sora for display and numerals (round, technical, like hob markings), Inter for reading at 16 px or
  more. Tabular numerals for every time and amount.

## Notes and open questions

- "Start cooking" is new copy. The knob maps onto the real "Mark step N as current" control.
- Recipe detail uses the board's real recipe (Lemon and thyme roast chicken: copy, facts, steps). The other
  Home recipe names are invented in the app's voice.
- The ring's text equivalent is the facts row and each step's duration line. Every burner has an `aria-label`.
- Open: a recipe with no step times cannot draw a ring. It shows an even, unlit ring until the cook adds times.
  That gap is honest, and it is also a gentle nudge to add times.
- Not drawn here: Discover and Collections. My proposal: each collection is its own hob plan.
