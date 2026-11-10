# Iteration 2 critique by Designer 3 (Enamelware)

I rendered both iteration-1 mockups with Playwright at 1400 px, in light and dark. Neither had script errors. I
recomputed every number below from the hex values in each file's CSS: contrast as WCAG 2.x, Lc as APCA 0.0.98G, and
colour distance as CIEDE2000. Numbers in brackets point to the sources at the end.

## First: who owns black

Designer 2 is right: options 1 and 2 now look alike, and I caused part of it. Last round I told Pilot Light to
use an ink button and told Fresh Cut to use a white ground. Each fix was right alone, but together they produced two
pale rooms with one black pill. Iron ink `#0F1A17` and Peppercorn `#141317` are ΔE00 9.4 apart, and both read as
black.

**My ruling: Fresh Cut owns black.** Its whole idea is a printed poster, so black is its ink. Pilot Light's idea is
the lamp. Its button can be any colour from its own room, so long as it is not warm. I propose **Spruce**, a dark
green-slate taken from the fog:

| Spruce                                          | Light `#1F4A3D`     | Dark `#A9D6C4`  |
| ----------------------------------------------- | ------------------- | --------------- |
| Label on it                                     | white 9.98 (Lc −97) | cast iron 11.68 |
| Distance from Peppercorn / Fresh Cut's dark ink | ΔE00 24.6           | 19.1            |
| Distance from my Cobalt                         | ΔE00 35.4           | 28.1            |

## Option 1: Pilot Light

**Fresh?** The idea is still the freshest of the three. The art has
gone too far the other way. Crisp diagonal strata no longer read as loading, but they no longer read as food either.
Some bands are also cream (`#F5E6CF`, `#FFF2C9`), so the colour the owner rejected comes back through the art.

**Simple?** Mostly. I agree with Designer 2 on the hidden step tap. Also, a gold box with a dark-gold
border and a badge is a warning form ("yellow represents a regular warning" [1]). "Last opened" saves the meaning,
but at first glance it says "alert".

**Palette.** It passes AA. I confirmed honey on fog at 1.16, wick on honey at 4.60 and pewter on honey at 3.54.
**But the rendered page says 1.27 and 4.20.** A stale footnote undercuts the spec's "one script" proof. The data also changes between screens: "Roast tomato soup · 1 h 10 · Italian" on Home becomes
"Roasted Tomato Basil Soup · 50 min · Mediterranean" on My recipes.

**At the stove.** It is still the best. But forcing the cooking screen dark (Designer 2's push, and my own last
round) is a mood choice, not a reading gain. NN/g found that light mode reads better for normal vision, and that
bright light leaves "zero difference" [2]. Kitchens are bright. Apple says to "avoid offering an app-specific
appearance setting" [3]. So the light cooking screen must work by itself, and at 1.16:1 it does not yet.

**Keep:** one light, only for "now", always with a word. Keep the 28 px current step with one timer per phase.

**Fixes, in order**

1. Make the lit step findable in light mode without the tint. Use a 3 px wick edge, a lamplight number disc at
   9.65:1, and the step at 28 px. Then draw it.
2. Move the button to Spruce, so black belongs to Fresh Cut.
3. Keep cream out of the strata. Below 85% lightness, use the dish's own saturated colours.
4. Regenerate the page's footnotes from the script, and use one set of recipe data on every screen.

**Bold push:** the lamp can light a real photo. If the cook adds a photo, the photo is the light. The honey row becomes the photo
with a wick edge, so "now" glows with real food and not with paint chips.

## Option 2: Fresh Cut

**Fresh?** It is joyful, and the white ground is clean. The risk is the drawing, not the flatness. A flat style
can date into "sterile" (by analogy, [4]). Two shapes still misread at 60 px:

- The tomato slice (a red disc with pale seeds) reads as a **pepperoni pizza**.
- The pink onion rings in the hero read as a **target**.

The roast chicken is drawn as a drumstick.

**Simple?** Yes. The tick boxes, step discs and two timers are all fixed. Two problems:

- "New recipe" floats at the bottom right, but the spec says it is docked.
- Ticked ingredients turn Clove, which is only 2.45:1 from Peppercorn. At the stove, ticked and unticked rows look
  the same, so only the 24 px box shows the difference.

**Palette.** It is AA-clean. Zest on white is 1.24, so the 5 px ink edge carries the state, and that is correct.
Dark Rind on Zest is 3.17, which passes, but only just. One clash breaks rule 2: the Damson art ground
`#3D4BD6` is **ΔE00 3.8** from Blueberry `#3442C2`, the link colour. So the pancake art wears a control's blue. **I retract my appetite point from last round.** The study I relied on found that "colored backgrounds did
not influence food wanting" [5]. Only recoloured food lowered appetite, and Fresh Cut's food keeps its natural colours.

**At the stove.** The 22 px lemon step with an ink edge works in both modes. Source and Version history moved to
the foot, out of the app's order. The avatar is "SR" on My recipes and "ER" on Home, and the pancakes
take 25 min here but 35 min in the other options.

**Keep:** "Text never sits on art", the wide Archivo titles, and the ink-edged current step.

**Fixes, in order**

1. Move links off Damson's hue, or move Damson off the links' hue.
2. Redraw the tomato and the onion so neither reads as another object. Draw roast chicken as a whole bird.
3. Make ticked rows clearly quieter. A Clove label alone is not enough, so also make the amount lighter and smaller.
4. Dock New recipe as the spec says.

**Bold push:** put the ingredient shapes to work. Each one in the hero is a tick target, so ticking "lemon"
dims the lemon wheel. The picture becomes the cook's mise en place.

## Sources

1. IBM Carbon, Status indicator pattern: https://carbondesignsystem.com/patterns/status-indicator-pattern/. "Yellow
   represents a regular warning", and colour alone is "insufficient". **Changes:** I flag the honey row as reading
   like a warning at first glance.
2. Nielsen Norman Group, "Dark Mode vs. Light Mode": https://www.nngroup.com/articles/dark-mode/. "In users with
   normal vision, light mode leads to better performance most of the time." Bright light leaves "zero difference".
   **Changes:** I withdraw my own push for a forced-dark cooking screen. The light cooking screen becomes Pilot
   Light's first fix.
3. Apple HIG, Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode. "Avoid offering an
   app-specific appearance setting." Dark-only is "rare", for immersive media. Apple HIG, Color:
   https://developer.apple.com/design/human-interface-guidelines/color. Colours must "work well in light, dark, and
   increased contrast contexts". **Changes:** cooking follows the system appearance. I agree with Designer 2 that
   Increase Contrast tokens are owed.
4. AIGA Eye on Design, "The Internet Is Turning on Big Tech's Colorful Corporate Mascots" (2021):
   https://eyeondesign.aiga.org/the-internet-is-turning-on-big-techs-colorful-corporate-mascots/. Flat interfaces
   "today register as sterile". **Changes:** the dating risk for Fresh Cut is in how generic the shapes are, not in
   flat colour. This is an analogy, because the piece is about figures.
5. Schlintl and Schienle (2020), _Frontiers in Psychology_:
   https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full. "Colored backgrounds did not influence food
   wanting." Recoloured food lowered the propensity to eat. **Changes:** I retract my appetite objection to Damson.
6. Legge and Bigelow (2011), "Does print size matter for reading?": https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264.
   Critical print size is about 0.2° of x-height. **Changes:** I accept the measured reading distances in both
   options. I judge the current step by whether a cook can find it from the hob, not read it.
