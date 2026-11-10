# Proposal A, "The Now Line": assessment

**Verdict: do not ship it.** The look has energy. The line under it makes the cook learn a rule.

Rendered with Playwright at 390 and 320 px, with 200% text simulated. A and B are distinct options.

## What must survive

- Funnel Display: the 48 px title and the 68 px "1:24:36" timer.
- The one tomato "Start cooking", full width.
- Cook mode's dock: two labelled 64 px buttons, fixed low.

## What fails, as rendered

1. **Size must be decoded.** Off the line, items shrink to 60–78% and go muted.
2. **Home is wrong.** "Now" labels yesterday's roast. Newest is at the bottom. No primary. Three "Coming soon" rows. Deciding is recall: four recent dishes, no reasons.
3. **Controls hide on scroll.** "Next step" appears only in the steps, and covers step 4's text.
4. **Cook mode breaks at 200% text.** Blocks sit at fixed positions. Steps 3, 4 and 5 print over each other.
5. **The wash makes cook mode beige**, a parchment ground. It also means "timer running": a signature carrying meaning in cook mode.
6. **It always moves:** a 16 s gradient loop and a 5 s pulse.
7. **Tomato means two things:** the button and every quantity.
8. **The photo is a 200 px circle crop**, smaller than the title.

## What I would do instead: "Pilot Light"

**Controls, calmer:** standard tab bar and back. Vertical lists, newest first, one size. The current step gets a tick and a wash. Nothing appears on scroll. Home cooking state: "Back to step 4" and a timer strip. Home deciding state: three dinners with reasons ("35 min · uses the spinach · not cooked since August"). Coming soon is one line. Cook mode: opaque, neutral, 28 pt steps, "Previous step" and "Next step".

**Look, bolder:** planning screens get a deep cast-iron chrome (`#141210`). Each screen has one light: a warm pool behind the dish. The photo is the lamp. It is the largest thing on screen, and uncropped. Funnel Display stays. The line goes.

- **Reference:** Ólafur Elíasson, _The weather project_ (Tate, 2003), one light in a dark hall. Few pick it: a room gives a rule for light, not a layout to copy.
- **Trajectory:** Apple Weather, Flighty and Airbnb (2025) light surfaces from state. The step past them: the content is the light.
- **Closest app:** Apple TV. The difference: one lit dish in an unlit room, not rows of posters.
- **Why not 2022:** dark planning chrome read as "night mode" until OLED and P3 photos made a lit dish look physical.

**House answer:** near-white ground, a grotesque, a full-bleed dish cut at the edge, a strict list. Pilot Light differs on the ground and the hero form. Danger becomes a text row with an icon.

Heuristic judgement, untested with users. Not run: contrast numbers for the new chrome, real OS text scaling, wet-hand tests.
