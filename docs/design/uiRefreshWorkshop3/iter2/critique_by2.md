# Iteration 2 critique by Designer 2 (Fresh Cut)

I rendered all three iteration-1 mockups with Playwright at 390 px, in light and dark. None had horizontal scroll or
script errors. I recomputed every doubtful contrast figure from the hex values (WCAG 2.x) and every colour distance
as CIEDE2000. Numbers in brackets point to the sources at the end.

## First: options 1 and 2 have converged, and that is half my fault

This round, Pilot Light and Fresh Cut both moved to an ink button. Pilot Light's document still says the three
primaries are "ink, tomato and cobalt", but Fresh Cut is no longer tomato. So the two options now share:

- **One black pill as the only button.** Iron ink `#0F1A17` vs my Peppercorn `#141317`: both read as black.
- **A near-white ground.** Fog `#EEF3F1` vs my Board `#FFFFFF`: ΔE00 3.9, which most people will not notice.
- **A yellow current-step block with a dark edge.** Honey `#FFDE96` vs my Zest `#FFE680`: ΔE00 **6.0** in light and
  **4.7** in dark.

Side by side, the recipe pages differ mainly in their art. One of us must move. The lit "now" is Pilot Light's whole
idea and only a detail in mine, so **I will take the yellow off Fresh Cut's current step.** That still leaves the
shared black pill and white room. Pilot Light should claim more ground too (see its bold push).

## Option 1: Pilot Light

**Fresh?** Yes: no cream, no serif, and honey reads as gold. But the strata slide toward abstraction. At
48 px the thumbnails are diagonal stripes that look like paint chips. The 206 px detail hero is flat brown and
orange bands, which reads as a desert landscape, not a roast chicken. It is crisp, but no longer food.

**Simple?** Mostly, with two snags:

- **A yellow card with a badge reads as a notice.** In Carbon, "yellow represents a regular warning" [3]. The words
  "Last opened" save it, but the first glance says "alert". My own lemon step had the same problem.
- **The light depends on a hidden gesture.** On a recipe, nothing is lit until the cook taps a step number. A
  first-time cook will not know to do that.

**Palette.** It is calm and accessible. I confirmed honey on fog at 1.16:1, wick on honey at 4.60:1 and muted text on
honey at 6.51:1. Every pair passes AA. One gap: Apple asks for an Increase Contrast variant of every custom colour
[2]. No option has one, mine included.

**At the stove.** Still the best of the three: 28 px current step, a timer per phase, and dimmed steps done with a
colour token, not opacity. But only the dark cooking screen is drawn. In light, the honey block is 1.16:1, so from
the hob you find it by its 2 px edge alone.

**Keep:** one light, only for "now", always with a word. Keep the current-step treatment.

**Fixes, in order**

1. Turning on Screen on makes step 1 current, so the light appears without a hidden gesture.
2. Cut the detail hero to about 120 px when there is no photo. Order the bands to read as food (glaze over meat over
   roots), not as a horizon.
3. Draw the light-mode cooking screen and prove the lit step can be found at counter distance.
4. Add Increase Contrast tokens [2].

**Bold push:** make the room dim for real. Under Screen on, the cooking view is always cast iron, even in light mode.
The lamp is 14.9:1 there and only 1.16:1 on fog. That would also make Pilot Light clearly different from white Fresh
Cut, and it matches the calm-tech idea that the needed thing comes forward [6]. Risk: glare in a bright kitchen, and
it overrides the system appearance. Test it first.

## Option 3: Enamelware

**Fresh?** The plate and its ring are fresh and ownable. The rest (pale blue-grey, cobalt, geometric sans) is the
stock look of fintech and health apps.

**Simple?** No, because of one real problem: **round letter plates read as people.** In GitHub's Primer, "Circle
Avatars represent individual people", and squares are for non-human things [1]. On Home, the real "ER" avatar is a
yellow circle with initials, the same shape as the W, R and S recipe circles below it. On first use, the recent
recipes look like contacts. The ring's words also stay hidden until a step is set, as in option 1.

**Palette.** Accessible: cobalt on ground 6.34:1; the wash (1.19:1) and Seam track (1.39:1) are honestly listed
as decoration. But cobalt is not "only what you can press". "Step 2 of
5" and "Current step" are cobalt text, and you cannot press either. Apple: if a brand colour signals interactivity,
"using the same or similar color to stylize noninteractive text is confusing" [2]. Atkinson's slashed zero also turns
"220°C" and "800 g" into something that looks like code.

**At the stove.** Still the weakest:

- **Step 4 has one "1 h 30 min" timer.** The step says roast for 20 minutes, then lower the oven. A cook who starts
  it never lowers the oven. That is a correctness bug; options 1 and 2 already split it.
- At 21 px the current step reads to about half a metre [4].
- The ring sits at the top of the page, so it has scrolled away by the time you reach the steps.

**Keep:** the ring with words, the one glossy button, and ink for selected states.

**Fixes, in order**

1. Two timers on step 4: "20 min", then "1 h 10 min".
2. Remove the letters. A recipe with no photo gets an empty glazed plate with a rim highlight: a dish, not a
   person. Keep the circle shape.
3. Set the progress words in ink, so cobalt means "press".
4. Make the current step 26 px or more.
5. Check for an open-zero alternate in Atkinson for amounts and temperatures.

**Bold push:** pin the plate. Under Screen on, the ring shrinks to a small plate stuck to the top, with "Step 2 of
5" and a Next step button. Then progress stays in view the whole time you cook.

## Sources

1. GitHub Primer, Avatar: https://primer.style/product/components/avatar. "Circle Avatars represent individual
   people", and "Square Avatars represent non-human entities". **Changes:** I now count Enamelware's letter circles
   as a first-use problem, not a style choice.
2. Apple HIG, Color: https://developer.apple.com/design/human-interface-guidelines/color. "Avoid using the same color
   to mean different things", the interactivity line quoted above, and a request for Increase Contrast variants.
   **Changes:** cobalt on progress words counts against option 3's own rule, and all three options owe
   high-contrast tokens.
3. Carbon, Status indicator pattern: https://carbondesignsystem.com/patterns/status-indicator-pattern. "Yellow
   represents a regular warning." **Changes:** a yellow badged card risks reading as a notice. I am moving Fresh Cut
   off yellow.
4. Legge and Bigelow (2011), _Journal of Vision_: https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. The critical
   print size is about 0.2° of x-height. **Changes:** it sets the distances quoted above.
5. W3C, Understanding SC 1.4.11: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html. A visual that
   shows state needs 3:1. **Changes:** I checked that honey, wash and track are backed by an edge, rule or words.
   They are.
6. Calm Tech Institute: https://calmtech.institute/calm-tech-principles. Things should move from the periphery to
   the centre only when needed. **Changes:** it backs a cooking view that dims everything but the step.
