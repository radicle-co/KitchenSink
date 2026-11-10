# Option 1: Pilot Light (iteration 2, final)

**Designer 1.** Mockup: [`option1.html`](option1.html) (one file, about 52 KB). Previous version: `../iter1/option1.md`.
Feedback answered: the "Option 1" sections of `critique_by2.md` and `critique_by3.md` in this folder.

## The idea

Every screen is a calm, cool room with one warm light on what is happening now: the recipe you opened last, or the
step you are cooking. Everything else is the plain lists, buttons and tabs you already know.

A pilot light is the small flame that is always on in a stove. It is quiet until you need it. So the lamp is the
only warm thing in the interface. The thing you press is **Spruce**, a deep green taken from the fog. Every other
colour comes from the food.

## Why it is simple

Nothing is new to operate. Every screen uses a large-title header and plain lists with chevrons. It also uses a
search field, filter chips, a segmented control, plain buttons, a switch, a stepper and checkboxes. There are five
tabs: Home, Recipes, Discover, Plan and Shop. The light is never a control. It only says "this one", and a word
beside it says the same thing.

**The rules a designer needs:**

1. At most one light per screen, only on what is happening now, always with a word. If nothing is happening now,
   nothing is lit.
2. One filled spruce button per screen.
3. Spruce means "you can press this" or "you ticked this". Nothing else is spruce.

### Home

- The greeting and date.
- **The light:** the recipe you opened last, in one honey row with a 2 px wick edge. It has the dish art, a small
  lamp and the plain words "Last opened", then the title, time and cuisine, and a chevron. Tap it to open it.
- Recent recipes as a plain list, with "See all".
- Coming soon as one quiet row: "Meal plans, a grocery list and daily nutrition are on the way.", with a "Soon" tag.
- **Primary action:** New recipe, docked above the tabs.

### Recipe detail

- A **120 px** band of the dish's layers (was 206 px). Back and More are plain discs. A plain sheet rises over it.
- Cuisine, title, Public, source, Version history, then Total, Prep and Difficulty in one strip, then the rating.
- **Primary action:** Edit recipe, beside the Screen on switch.
- Ingredients with a servings stepper (− 4 +) and checkboxes. A ticked line gets a spruce tick, muted text and a
  strike-through, so it reads as done in three ways.
- Nothing is lit until you cook.

### Cooking (the same recipe page, scrolled to Steps)

- **Turning on Screen on makes step 1 current.** A step that was current before comes back. The cook never
  has to find a hidden gesture to light the page.
- The current step is the only lit thing: honey, a **3 px** wick edge, a 48 px lamplight number disc with a wick
  ring, "Current step" and "2 of 5", the step in 28 px type, one timer per phase, and a full-width **Next step**
  button. Next step is the screen's one filled button.
- Every step number is also a button, "Mark step N as current", for cooks who jump around.
- Done steps get a spruce tick. Other steps are a muted colour (7.55:1 or more), never faded.

### My recipes

- "Recipes" title, My recipes / Collections, search, filter chips with counts (All 7, Italian 2, American 2,
  British 1, Thai 1), then the sort.
- A plain list of the same seven recipes, with the same titles, times and cuisines as on Home.
- **No light here.** **Primary action:** New recipe, docked.

## Changes this iteration

| Feedback                                                                                            | What I did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Options 1 and 2 converged: both use a black pill on a pale room with a yellow current step (D2, D3) | **Accepted. Black now belongs to Fresh Cut.** My button, links, tab, ticks and switch are now **Spruce** `#0B4F3E` / `#8EDBBF`. D3 proposed `#1F4A3D`. I made it greener, so it is further from my muted Slate (ΔE00 13.0, was 10.2). Spruce is ΔE00 27.7 from Fresh Cut's Peppercorn and 37.3 from Enamelware's Cobalt. Designer 2 is taking yellow off Fresh Cut's step, so honey is now only mine.                                                                                                                                                                                                                    | Computed CIEDE2000 from the hex values in each option's file.                                                                                                                                             |
| A spruce button beside my old success green, Leek, gives two greens on one screen                   | **Leek is gone.** Ticks, done steps and the Screen on switch are Spruce. One green means "press or ticked". A platform tint works the same way: one colour for controls and their selected state.                                                                                                                                                                                                                                                                                                                                                                                                                        | Apple HIG, Color [1].                                                                                                                                                                                     |
| The light depends on a hidden gesture (D2, D3)                                                      | **Fixed.** Screen on makes step 1 current, and **Next step** moves the light forward. The step-number buttons stay for jumping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | NN/g heuristic 6, recognition over recall [6].                                                                                                                                                            |
| A yellow box with a badge reads as a warning (D2, D3)                                               | **Accepted for the form, not the hue.** The lamplight capsule with a status dot is gone. "Last opened" and "Current step" are now plain ink words beside a small lamp glyph (or, on a step, the numbered lamp disc). Honey moved a little warmer, from `#FFDE96` to `#FFD69C`, so it is apricot-gold, not signal yellow. It stays: the warm light is this option's idea.                                                                                                                                                                                                                                                 | Carbon calls yellow "a regular warning", and asks yellow indicators to carry "outlines and text" [2]. Its warnings use an exclamation icon. A row with dish art, a title and a chevron has none of those. |
| Draw the light cooking screen and prove the lit step can be found without the tint (D2, D3)         | **Drawn.** In light, you find the step by four things. They are its 3 px wick edge (6.67:1 outside, 5.47:1 inside), its numbered disc (9.65:1), its 28 px type and its button. Honey alone is only 1.22:1, and the page says so. **Findability arithmetic:** on a 390 pt phone about 65 mm wide, 1 pt ≈ 0.166 mm. The 3 px edge is about 0.5 mm, which is about 1.1 arcminutes at 1.5 m. Normal acuity resolves 1 arcminute, so the edge can be _seen_ to about 1.7 m. The whole block is about 59 mm wide. You can _read_ the 28 px step to about 0.65 m (x-height 0.50, critical print size 0.2°) [5].                 | W3C 1.4.11: state indicators need 3:1 [3]. Legge and Bigelow [5].                                                                                                                                         |
| Bold push from D2: force the cooking view dark, even in light mode                                  | **Declined, with evidence.** Cooking follows the phone's setting. D3 also withdrew this push. Light mode reads better for most people, and in bright light the difference is gone. Kitchens are bright. Apple says not to offer an app-only appearance. The light cooking frame above is what makes this safe.                                                                                                                                                                                                                                                                                                           | NN/g: "light mode leads to better performance most of the time", and bright light leaves "zero difference" [4]. Apple HIG, Dark Mode [7].                                                                 |
| The strata read as paint chips at 48 px and as a desert at 206 px. Some bands are cream (D2, D3)    | **Accepted.** (1) Bands are now in the order the food sits in the dish, from the top: glaze or garnish, then the main, then the base. They are not light-to-dark like a sky. (2) Band edges are soft waves, not straight diagonals. Flecks of herb or seed sit on them: thyme on the chicken, blueberry on the pancakes, basil on the soup. (3) Two shapes, one thin-topped and one even, so pattern also tells dishes apart. (4) No band is lighter than L\* 79.7: no cream. (5) The detail band is 120 px. Nearest pair of tiles by mean colour: ΔE00 9.1 (pancakes and focaccia), and those two use different shapes. | Critiques D2, D3.                                                                                                                                                                                         |
| Photos (D3's bold push: the photo is the light)                                                     | **Adopted as the rule.** A recipe photo replaces the strata. The lit row is then the photo on honey with the wick edge. The honey stays a fixed token, so its contrast stays proven. The mockup shows only strata, because the brief allows no images.                                                                                                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                           |
| Increase Contrast tokens are owed (D2, D3)                                                          | **Added** for muted, pewter, wick, divider, spruce and dark honey, with ratios. The lit step's edge also grows from 3 px to 4 px. The mockup swaps them in under `prefers-contrast: more`.                                                                                                                                                                                                                                                                                                                                                                                                                               | Apple: supply "an increased contrast option for each variant" [1].                                                                                                                                        |
| The page said 1.27 and 4.20, the spec said 1.16 and 4.60. Recipe data changed between screens (D3)  | **Fixed at the source.** One script (`gen.py`, kept outside the repo) holds the tokens. It writes the CSS, the swatches, both contrast tables and the figures in the captions. It stops at the first pair that fails. The tables below are copied from its output. One record per recipe is used on every screen.                                                                                                                                                                                                                                                                                                        |                                                                                                                                                                                                           |
| Dark muted text: I hold myself to APCA Lc 75                                                        | Ash is `#CBD4CF` (was `#C2CCC7`). It is Lc 75 to 79 on every dark surface. Dark Rust and Plum are brighter too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | APCA readability guidance (my `critique_by1.md`).                                                                                                                                                         |

**What I kept, because it was praised:** one light, only for "now", always with a word. The 28 px current step with
one timer per phase ("best stove screen of the three"). Dimming by colour token, not by opacity. The docked
primary button. Plum for danger. Colour from the food.

**Why it stays distinct.** Fresh Cut is a poster: black ink, a white board and cut-out produce. Enamelware is an
object: plates, rims and cobalt. Pilot Light is **light in a room**: a cool fog-and-spruce interface, one
apricot-gold light on "now", and food as soft layered strata, with no outlines and no circles.

## The palette: Pilot Light

**Logic.** A cool, still room: fog by day, cast iron by night. Spruce is everything you press or tick.
Lamplight on honey marks what is happening now, and nothing else is warm. Food brings every other colour. Status
colours are words with icons, never fills.

| Name                | Role                                                         | Light     | Dark      |
| ------------------- | ------------------------------------------------------------ | --------- | --------- |
| Fog / Cast iron     | Ground: the room                                             | `#EEF3F1` | `#0F1311` |
| Porcelain / Skillet | Surface: lists, fields, tab bar, dock                        | `#FFFFFF` | `#1A201D` |
| Stone               | Sunk: segment track, selected chip, tab pill                 | `#E1E8E5` | `#242C28` |
| Iron ink / Steam    | All text and stars. Never a button                           | `#0F1A17` | `#ECF2EE` |
| **Spruce**          | The tint: the one button, links, selected tab, ticks, switch | `#0B4F3E` | `#8EDBBF` |
| On spruce           | Label and tick on spruce                                     | `#FFFFFF` | `#0F1311` |
| Slate / Ash         | Muted text, chevrons, other steps                            | `#42504B` | `#CBD4CF` |
| **Lamplight**       | The light: the lamp glyph and step disc. Never text          | `#F4AE2A` | `#FFE39A` |
| On lamplight        | The number on the lamp disc                                  | `#1A1205` | `#1A1205` |
| **Honey**           | Surface under the one lit thing                              | `#FFD69C` | `#3B2A12` |
| Wick                | Edge of the lit thing: 2 px row, 3 px step, ring on the disc | `#7A4A00` | `#FFE39A` |
| Pewter              | Control edge: fields, boxes, chips, switch                   | `#6B7873` | `#75837C` |
| Rust                | Warning: text with an icon, never a fill                     | `#9E3A0A` | `#FFA27A` |
| Plum                | Danger: Delete, errors, with the word and an icon            | `#8E1F63` | `#F7A6DA` |
| Divider             | Hairlines only, decorative                                   | `#C3CFCA` | `#3A4540` |

**Increase Contrast.** With the system setting on, these values replace the usual token:

| Token                     | Light     | Dark      |
| ------------------------- | --------- | --------- |
| Slate / Ash               | `#2B3632` | `#DDE5E1` |
| Pewter                    | `#46524D` | `#A2B0A9` |
| Wick (and step edge 4 px) | `#5C3700` | `#FFE39A` |
| Divider                   | `#7E8C86` | `#6B7872` |
| Spruce                    | `#063A2D` | `#B4F0D9` |
| Honey                     | `#FFD69C` | `#4A3516` |

**Dish strata** are not palette colours. Each recipe takes 4 colours and one fleck colour from its main
ingredients, in the order they sit in the dish. No band is lighter than L\* 80. They never carry text, and always
sit beside a title on a solid surface.

### Contrast (WCAG 2.2 ratio, plus APCA Lc for text; written by the script)

| Pair                                                   | Light          | Dark          | Needs      |
| ------------------------------------------------------ | -------------- | ------------- | ---------- |
| Text on ground                                         | 15.86 · Lc 97  | 16.50 · Lc 98 | 4.5        |
| Text on surface                                        | 17.79 · Lc 105 | 14.59 · Lc 96 | 4.5        |
| Text on stone                                          | 14.30 · Lc 90  | 12.62 · Lc 94 | 4.5        |
| Text on honey (lit row, current step)                  | 13.00 · Lc 84  | 12.13 · Lc 94 | 4.5        |
| Muted on ground (other steps)                          | 7.55 · Lc 81   | 12.36 · Lc 79 | 4.5        |
| Muted on surface (meta, tab labels)                    | 8.47 · Lc 89   | 10.93 · Lc 77 | 4.5        |
| Muted on stone                                         | 6.80 · Lc 75   | 9.45 · Lc 75  | 4.5        |
| Muted on honey (lit row meta)                          | 6.19 · Lc 69   | 9.08 · Lc 75  | 4.5        |
| Label on spruce button                                 | 9.54 · Lc 96   | 11.62 · Lc 76 | 4.5        |
| Spruce link on surface                                 | 9.54 · Lc 92   | 10.28 · Lc 74 | 4.5        |
| Spruce link on ground                                  | 8.50 · Lc 84   | 11.62 · Lc 75 | 4.5        |
| Spruce button on ground (shape)                        | 8.50           | 11.62         | 3          |
| Number on lamplight disc                               | 9.65 · Lc 67   | 14.75 · Lc 90 | 4.5        |
| Lamplight disc fill on honey (its edge is a wick ring) | 1.40           | 10.95         | decorative |
| Wick edge on honey (inside)                            | 5.47           | 10.95         | 3          |
| Wick edge on ground (outside)                          | 6.67           | 14.90         | 3          |
| Wick edge on surface                                   | 7.48           | 13.17         | 3          |
| Rust on surface (warning text)                         | 6.86 · Lc 83   | 8.44 · Lc 63  | 4.5        |
| Plum on surface (danger text)                          | 8.31 · Lc 87   | 9.01 · Lc 66  | 4.5        |
| Pewter edge on surface                                 | 4.61           | 4.17          | 3          |
| Pewter edge on ground                                  | 4.11           | 4.72          | 3          |
| Pewter edge on honey (timer button)                    | 3.37           | 3.47          | 3          |
| Pewter edge on stone                                   | 3.70           | 3.61          | 3          |
| Honey on ground (tint only)                            | 1.22           | 1.36          | decorative |
| Focus ring (ink 2 px) on honey                         | 13.00          | 12.13         | 3          |

**Increase Contrast pairs**

| Pair                   | Light | Dark  | Needs |
| ---------------------- | ----- | ----- | ----- |
| Muted on ground        | 11.17 | 14.60 | 4.5   |
| Muted on honey         | 9.16  | 9.03  | 4.5   |
| Pewter edge on surface | 8.16  | 7.35  | 3     |
| Pewter edge on honey   | 5.96  | 5.14  | 3     |
| Wick edge on honey     | 7.67  | 9.22  | 3     |
| Wick edge on ground    | 9.36  | 14.90 | 3     |
| Label on spruce        | 12.72 | 14.63 | 4.5   |
| Divider on surface     | 3.51  | 3.59  | 3     |
| Text on honey          | 13.00 | 10.21 | 4.5   |

Every pair passes AA. Lowest text pairs, honestly: the 22 px bold number on the light lamp disc is Lc 67 (fine for
large bold text). Dark Rust and Plum are Lc 63 and 66. They are short words with an icon, at 15 px or more. Muted
text on light honey is Lc 69, used for one 14 px meta line.

### Pairing rules

- **Lamplight is light, never text.** It is 1.71:1 on fog. It is a lamp glyph, the step disc, or the dark wick.
- **Honey is never found by itself** (1.22:1 light, 1.36:1 dark on the ground). The lit thing is found by its wick
  edge, its size, its word and, on a step, its numbered disc and its button.
- **One filled spruce button per screen.** Selected chips and tabs use stone with a spruce edge or a spruce icon.
- **Spruce is never decoration.** A spruce thing is pressable or ticked.
- **Warm colours never share a form.** Lamplight is a light, Wick is an edge, Rust is text with an icon.
- **Plum and Rust** each carry their word and icon. Delete lives in the More menu.
- **Dividers are decorative.** Every control has a pewter edge.
- **No text on dish strata.**

## Type

- **Funnel Display** (700 to 800) for titles, the hero and the step number.
- **Funnel Sans** (400 to 700) for everything you read, with tabular numbers for amounts and times.
- Sizes: display 44, title 29, current step 28, body 16, meta 14, label 13.
- Measured last round: Funnel Sans x-height is 0.50 of the font size.

## Motion

- When a screen with a light opens, the soft pool behind the lit thing fades on once (about 1 s). The content does
  not move or fade. Nothing loops.
- When Screen on turns on, or Next step is pressed, the light cross-fades to the new step in 250 ms. Nothing slides,
  and the type changes size at once.
- Under `prefers-reduced-motion`, nothing moves and the light shows at once.

## Verified in the mockup

Rendered with Playwright (Chromium) at 390 px and 1400 px, and at 390 px with reduced motion:

- The page is 390 px wide at 390 px, with no horizontal scroll. No script errors.
- No element inside the lit row or the current step has an animation or less than full opacity at first paint.
- Under reduced motion, the pool shows at full opacity at once.
- Every contrast figure on the page and in this document comes from the same script run, which fails on any AA miss.
- The file is about 52 KB.

## Open risks

- **Strata need a written rule** from ingredients to 4 colours, a fleck and a shape. Two recipes with the same lead
  ingredients will look alike. The titles carry identity.
- **Honey is still a yellow family.** I changed the form so it does not read as an alert, but this is my
  judgement. It is not tested with users.
- **Readable distance is about 0.65 m.** The edge can be seen to about 1.7 m, but you can read the step only near
  the phone. A true distance mode is a new screen and out of scope.
- **Spruce for ticks and the button** is one meaning ("press or ticked"). If research finds people want a separate
  success colour, it must not be another green.
- The cooking screen still needs a test on a real phone in a real kitchen, in both modes.

## Sources

1. Apple Human Interface Guidelines, Color: https://developer.apple.com/design/human-interface-guidelines/color.
   Colours must "work well in light, dark, and increased contrast contexts". A custom colour needs "an
   increased contrast option for each variant". **Changes:** I added Increase Contrast tokens,
   and I use one tint for controls and their ticked state.
2. IBM Carbon, Status indicator pattern: https://carbondesignsystem.com/patterns/status-indicator-pattern/. "Yellow
   represents a regular warning", and yellow indicators need "outlines and text". **Changes:** I removed the badge
   form from the lit row and moved honey warmer. I kept the warm light, because it carries a word and no warning icon.
3. W3C, Understanding WCAG 2.2 SC 1.4.11 Non-text Contrast:
   https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html. 3:1 for visual information that shows state.
   **Changes:** the step edge is now 3 px at 6.67:1. The lamp disc has a wick ring, because its fill is only
   1.40:1 on honey.
4. Nielsen Norman Group, "Dark Mode vs. Light Mode": https://www.nngroup.com/articles/dark-mode/. "In users with
   normal vision, light mode leads to better performance most of the time", and bright light leaves "zero
   difference". **Changes:** I declined the forced-dark cooking screen and drew the light one.
5. Legge and Bigelow (2011), "Does print size matter for reading?", _Journal of Vision_:
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. Critical print size is about 0.2° of x-height. **Changes:** it
   sets the 0.65 m reading distance. I now give a separate, larger "can be seen" distance for the edge.
6. Nielsen Norman Group, "10 Usability Heuristics": https://www.nngroup.com/articles/ten-usability-heuristics/.
   Recognition rather than recall, and visibility of system status. **Changes:** Screen on lights step 1, and Next
   step is a visible button, not a gesture.
7. Apple Human Interface Guidelines, Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode.
   "Avoid offering an app-specific appearance setting." **Changes:** cooking follows the system appearance.
8. Calm Tech Institute, principles: https://calmtech.institute/calm-tech-principles. "Require the smallest possible
   amount of attention" and "make use of the periphery". **Changes:** while cooking, one lit step, a muted room, no
   loops.
9. Laws of UX, Von Restorff effect: https://lawsofux.com/von-restorff-effect/. Use emphasis with restraint and do
   not rely on colour alone. **Changes:** one light, one filled button, and every state carried by a word or shape
   as well as colour.
