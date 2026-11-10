# Option 1: Pilot Light (iteration 1)

**Designer 1.** Mockup: [`option1.html`](option1.html) (one file, about 43 KB). Previous version: `../final/option1.md`.
Feedback answered: the "Option 1" sections of `critique_by2.md` and `critique_by3.md` in this folder.

## The idea

Every screen is a calm, cool room in ink and fog, with one warm light on what is happening now: the recipe you
opened last, or the step you are cooking. Everything else is the plain lists, buttons and tabs you already know.

A pilot light is the small flame that is always on in a stove. It is quiet until you need it. This iteration takes
the idea literally: **the lamp is now the only warm thing in the interface.** The one button is ink, not red. Every
other colour comes from the food.

## Changes this iteration

| Feedback                                                                               | What I did                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ember red is ΔE 5.6 from Fresh Cut's Tomato, so the two options look alike (D3)        | **Accepted.** Ember is gone. The one button is **Iron ink** (white label, 17.79:1). Links and the selected tab are ink too. The three options now have three primaries: ink, tomato and cobalt.                                                                                                                                              | Von Restorff: emphasis that competes weakens itself. Do not let colour alone carry it [3]. An ink pill on fog stands out by lightness, which works in greyscale and for colour-blind users.                                                                                                                                                                                                                                                                                                                           |
| "See all", "Version history" and the selected tab were also ember (D3)                 | All are ink now. Links are underlined. The selected tab has a stone pill behind a heavier icon and a bold label, so it does not rely on colour.                                                                                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| On My recipes the selected "All" chip is a second ink fill                             | It is now stone with a 2 px ink edge and a tick. New recipe is the only filled ink shape on each screen.                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The lit state carries almost no signal: glow is 1.00–1.12:1 on the ground (D2, D3)     | **Accepted in practice, with one pushback.** The lit row and the current step now have a 2 px **Wick** edge: 5.34:1 outside and 4.60:1 inside in light, and 14.90 / 10.59 in dark. The glow is now **Honey** `#FFDE96`.                                                                                                                      | **Pushback:** WCAG 1.4.11 asks 3:1 of "visual information necessary to indicate state" [1]. Here the state is also carried by a text pill ("Last opened", "Current step") at 9.65:1 and above. My reading is that the glow is not the required indicator. That is an inference: the Understanding page does not say it outright [1]. I made the edge pass 3:1 anyway, because "visible at a glance" is the point of the idea.                                                                                         |
| The glow surface `#FFF1D6` is cream, which the owner rejected (D3)                     | **Accepted.** Honey `#FFDE96` is clearly gold, not cream, and it appears only under the one lit thing.                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Blurred dish art reads as an image still loading (D2, D3)                              | **Accepted.** The art is now **dish strata**: 4 crisp bands of the dish's own colours, at the lamp's angle, light to dark away from the lamp. No blur anywhere. The hero uses the same 4 bands as the tile, at a flatter angle (170°) and 206 px tall. It reads as layers of the dish, and it is quieter than the lit row.                   | BlurHash's own README says a blur "shows while the real image is loading" [4].                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Red and orange blobs are hard to tell apart at 52 px (D2)                              | Each dish now has a different band order and band widths, and one dark band (thyme, chocolate, blueberry, basil) for shape. I checked the area-weighted mean colour of all 9 tiles: the closest pair is now ΔE 11.7 apart (it was 7.3). The two red dishes, soup and cacciatore, are ΔE 15.7 apart and have different band patterns.         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The lamp is not alone: four warm thumbnails compete with the lit row (D3)              | The lamp's sheen is now **only** on the lit row's art. Other thumbnails lose the sheen, shrink to 48 px and drop to 82% saturation. The lit row is bigger (84 px art, 21 px title), on honey, with a wick edge and a word.                                                                                                                   | Von Restorff [3]: make the key item distinct in more than one way, and use emphasis with restraint.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The whole lit row fades in, so at first paint it is invisible (D2)                     | **Fixed.** Only the soft pool behind it fades in. The row and its words are there from the first frame. Checked in headless Chrome: no element inside `.lit` or `.st.cur` has an animation or opacity below 1.                                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The floating New recipe covers rows (D2, D3)                                           | **Docked.** New recipe is a full-width ink button that sits on the tab bar's surface, above the tabs. Content scrolls under the dock like it scrolls under any tab bar. It never floats over a row.                                                                                                                                          | Google's Material 3 Expressive research: a larger Send button, "placed just above the keyboard", was found up to 4× faster than a small one in a top toolbar [5]. Fluent 2: an extended FAB "floats above all other layout elements" and collapses on scroll [6]. A docked button needs neither trick.                                                                                                                                                                                                                |
| "Seen from across the kitchen" was not true at 23 px (D2)                              | **Accepted. I removed the claim.** The current step is now **28 px**. I measured Funnel Sans in Chrome: x-height 14 px at 28 px (ratio 0.50). On a 390 pt phone (about 0.166 mm per point) that is a 2.3 mm x-height. At the 0.2° critical print size [2] it is readable to about **0.65 m**. Body text (16 px) is readable to about 0.38 m. | Legge and Bigelow: reading speed "begins to decline sharply" below the critical print size, about 0.2° of x-height [2]. I now split **findable** from **readable**. The honey block is about 360 px wide, which is about 60 mm on the phone, or about 1.1° at 3 m. In dark mode its edge is 14.90:1, so you can _find_ it from across a room. In light mode it relies on colour (ΔE 39.7) and a 2 px edge. Honey is only 1.16:1 on fog, so it is harder to find far away. You can _read_ it only within arm's length. |
| Bold push: the light grows while cooking, and the room dims (D2, D3)                   | **Adopted, in calm form.** With Screen on, the current step is the only lit thing: 28 px type, a lamplight number, "Current step", and one timer per phase ("Timer · 20 min", "Timer · 1 h 10 min"). Other steps use muted text. That is still 7.55:1 (light) and 11.37:1 (dark), because dimming is a colour token, not opacity.            | Calm Technology: "Require the smallest possible amount of attention" and "Make use of the periphery" [7].                                                                                                                                                                                                                                                                                                                                                                                                             |
| The dark wash (1.08:1) cannot be seen (D2)                                             | **Removed.** It carried nothing. The lit step itself is the signal.                                                                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dark muted text: I asked option 2 for APCA Lc 75 or more, so I hold myself to the same | Ash is lighter: `#C2CCC7`, Lc −73.6 on cast iron (it was −57). Slate is darker in light: `#42504B`.                                                                                                                                                                                                                                          | APCA readability guidance (see my own critique, `critique_by1.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Two warm colours can be confused: warning amber and the new wick                       | Warning is now **Rust** `#9E3A0A`. It is ΔE 35.7 from Wick and has a different form: text with an icon, never an edge.                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**What I kept, because it was praised:** one light, only for "now", always with a word (both). The current-step
treatment and its step buttons ("best stove screen of the three", D3). Plum for danger. Colour from the food (D2,
citing Spence [8]).

**Why it stays distinct.** Fresh Cut is a poster: cut-out produce shapes and a tomato button. Enamelware is an
object: plates, rims and cobalt. Pilot Light is **light in a room**: a monochrome ink-and-fog UI, one honey-lit
thing, and food colour as abstract strata with no shapes and no circles.

## Why it is simple

Nothing is new to operate. Every screen uses a large-title header and plain lists with chevrons. It also uses a search field, filter chips,
a segmented control, plain buttons, a switch, a stepper and checkboxes. There are five tabs: Home, Recipes,
Discover, Plan and Shop. The light is never a control. It only says, with a word beside it, "this one".

**The one rule a designer needs:** at most one light per screen, only on what is happening now, always with a word.
At most one filled ink button per screen. If a screen has no "now", it has no light.

### Home

- The greeting and date.
- **The light:** the recipe you opened last, in one honey row with a wick edge: art, a "Last opened" pill, the
  title, time and cuisine, and a chevron. Tap it to open it.
- Recent recipes as a plain list, with "See all".
- Coming soon as one quiet row: "Meal plans, a grocery list and daily nutrition are on the way.", with a "Soon" tag.
- **Primary action:** New recipe, docked above the tabs.

### Recipe detail

- The dish strata fill the top as 4 flat layers, the same bands as the dish's tile. Back and More are plain discs. A
  plain sheet rises over it.
- Cuisine, title, Public, source, Version history, then Total, Prep and Difficulty in one strip, then the rating
  (ink stars).
- **Primary action:** Edit recipe (ink), beside the Screen on switch.
- Ingredients with a servings stepper (− 4 +) and checkboxes. A ticked line turns muted with a green tick.
- **Steps:** each step's number is a 44 px button, "Mark step N as current", and tapping the row does the same.
  The current step is lit as described above. Done steps show a green tick. No light on this screen until a step
  is current.

### My recipes

- "Recipes" title, My recipes / Collections, search, filter chips with counts, then the sort.
- A plain list: strata, title, time and cuisine, and Private or a Draft tag where true.
- **No light here.** **Primary action:** New recipe, docked.

## The palette: Pilot Light

**Logic.** A cool, still room (fog by day, cast iron by night), with ink for everything you act on. So the one warm
light always means something. Lamplight marks what is happening now. Food brings every other colour. Status colours
are words with icons, never fills.

| Name                | Role                                                            | Light     | Dark      |
| ------------------- | --------------------------------------------------------------- | --------- | --------- |
| Fog / Cast iron     | Ground: the room                                                | `#EEF3F1` | `#0F1311` |
| Porcelain / Skillet | Surface: lists, fields, tab bar, dock                           | `#FFFFFF` | `#1A201D` |
| Stone               | Sunk: segment track, selected chip, active tab                  | `#E1E8E5` | `#242C28` |
| Iron ink / Steam    | Text, **the one button**, links, stars, focus ring              | `#0F1A17` | `#ECF2EE` |
| On ink              | Label on the ink button                                         | `#FFFFFF` | `#0F1311` |
| Slate / Ash         | Muted text, chevrons, tab labels, dimmed steps                  | `#42504B` | `#C2CCC7` |
| Lamplight           | Signature: the light. "Now" only. Never text                    | `#F4AE2A` | `#FFE39A` |
| On lamplight        | Text on the lamplight pill and step number                      | `#1A1205` | `#1A1205` |
| Honey               | Surface under the light                                         | `#FFDE96` | `#3A2E10` |
| Wick                | The 2 px edge of the lit thing (in dark it is lamplight itself) | `#7D5F00` | `#FFE39A` |
| Pewter              | Control edge: fields, boxes, chips, switch, tags                | `#6B7873` | `#75837C` |
| Leek                | Success: ticks, done steps, Screen on                           | `#2C6A3B` | `#7CCB8C` |
| Rust                | Warning: text with an icon, never a fill                        | `#9E3A0A` | `#FF8F5A` |
| Plum                | Danger: Delete, errors, with the word and an icon               | `#8E1F63` | `#F08CCB` |
| Divider             | Hairlines only, decorative                                      | `#C3CFCA` | `#3A4540` |

**Dish strata** are not palette colours. Each recipe takes 4 colours from its main ingredients, ordered light to dark
away from the lamp. They are decoration, never carry text, and always sit beside a title on a solid surface.

### Contrast (WCAG 2.2, computed from the hex values above)

One script computed every number below, and the same script wrote the table and the CSS tokens in the mockup.
APCA Lc is given for the text pairs where it differs most.

| Pair                                   | Light | Dark  | Needs |
| -------------------------------------- | ----- | ----- | ----- |
| Text on ground                         | 15.86 | 16.50 | 4.5   |
| Text on surface                        | 17.79 | 14.59 | 4.5   |
| Text on stone (segment, selected chip) | 14.30 | 12.62 | 4.5   |
| Text on honey (lit row, current step)  | 13.67 | 11.72 | 4.5   |
| Muted on ground (dimmed steps)         | 7.55  | 11.37 | 4.5   |
| Muted on surface (meta, tab labels)    | 8.47  | 10.06 | 4.5   |
| Muted on stone                         | 6.80  | 8.70  | 4.5   |
| Muted on honey                         | 6.51  | 8.08  | 4.5   |
| Label on ink button                    | 17.79 | 16.50 | 4.5   |
| Ink button on ground (shape)           | 15.86 | 16.50 | 3     |
| Ink button on surface (shape)          | 17.79 | 14.59 | 3     |
| Label on lamplight (pill, step number) | 9.65  | 14.75 | 4.5   |
| Wick edge on honey (inside)            | 4.60  | 10.59 | 3     |
| Wick edge on ground (outside)          | 5.34  | 14.90 | 3     |
| Wick edge on surface                   | 5.98  | 13.17 | 3     |
| Leek on surface (success text)         | 6.50  | 8.50  | 4.5   |
| Leek on ground                         | 5.79  | 9.61  | 4.5   |
| Tick on leek (checkbox)                | 6.50  | 8.50  | 3     |
| Rust on surface (warning text)         | 6.86  | 7.36  | 4.5   |
| Rust on ground                         | 6.11  | 8.32  | 4.5   |
| Plum on surface (danger text)          | 8.31  | 7.35  | 4.5   |
| Plum on ground                         | 7.41  | 8.31  | 4.5   |
| Pewter edge on surface                 | 4.61  | 4.17  | 3     |
| Pewter edge on ground                  | 4.11  | 4.72  | 3     |
| Pewter edge on honey                   | 3.54  | 3.35  | 3     |
| Pewter edge on stone                   | 3.70  | 3.61  | 3     |
| Focus ring (ink, 2 px) on ground       | 15.86 | 16.50 | 3     |
| Focus ring (ink) on honey              | 13.67 | 11.72 | 3     |

Every pair passes AA. APCA: muted text is Lc 81.3 (light) and −73.6 (dark) on the ground. Muted on honey is the
lowest text pair, at Lc 71.9 / −69.2. It is used for only one meta line (14 px) in the lit row.

### Pairing rules

- **Lamplight is light, never text.** It is 1.71:1 on fog. It is a fill under a word, or the dark-mode wick.
- **Honey is never found by itself.** It is only 1.16:1 (light) and 1.41:1 (dark) on the ground. The lit thing is
  found by its wick edge, its size and its word.
- **One filled ink shape per screen.** Selected chips and tabs use stone with an ink edge or a heavier icon.
- **Warm colours never share a form.** Lamplight is a fill, Wick is an edge, Rust is text with an icon.
- **Plum and Rust** are 1.21:1 (light) and 1.00:1 (dark) apart in lightness, but ΔE 60 and 63 apart in colour. Each
  always carries its word and icon, and Delete lives in the More menu.
- **Dividers are decorative.** Every control has a pewter edge.
- **No text on dish strata.**

## Type

- **Funnel Display** (700 to 800) for titles, the hero and the current step's number.
- **Funnel Sans** (400 to 700) for everything you read, with tabular numbers for amounts and times.
- Sizes: display 44, title 29, **current step 28** (was 23), body 16, meta 14, label 12.
- Measured: Funnel Sans x-height is 0.50 of the font size.

## Motion

- When a screen with a light opens, the soft pool behind the lit thing fades on once (about 1 s). The content does
  not move or fade. Nothing loops.
- When a step becomes current, the honey block and its pool fade in (250 ms). The type grows to 28 px at once, with
  no animated reflow.
- Under `prefers-reduced-motion`, nothing moves and the lit state shows at once (checked in headless Chrome).

## Verified in the mockup

Rendered in headless Chrome at 390 px and 1280 px:

- The page is 390 px wide, with no horizontal scroll.
- No list row sits under a floating button, because none floats. Long lists continue under the docked tab bar,
  as any scrolling list does.
- At first paint, the lit row and current step have no animation and full opacity.
- Under reduced motion, the pool shows at opacity 1 at once.
- The file is about 43 KB.

## Open risks

- **Strata need a written rule** from ingredients to 4 colours and band widths. A recipe with no match gets stone
  and pewter bands. Two recipes with the same lead ingredients will look alike. The titles carry identity.
- **A recipe photo replaces the strata.** The honey under a lit photo row stays the token, not sampled from the
  photo, so its contrast is fixed. (Last round's photo-sampled glow is dropped. It made contrast impossible to prove.)
- **Readable distance is about 0.65 m,** not across the kitchen. A true distance mode (larger than 28 px, one step
  per screen) is a new screen. It is out of scope for this refresh.
- The dark cooking screen still needs a test on a real phone in a real kitchen.

## Sources

1. W3C, Understanding WCAG 2.2 SC 1.4.11 Non-text Contrast:
   https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html. It requires 3:1 for "visual information
   necessary to indicate state". **Changes:** I gave the lit thing a 3:1 edge. I still read the text pill as the
   required indicator, and I say that is my inference.
2. Legge and Bigelow (2011), "Does print size matter for reading?", _Journal of Vision_:
   https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. Critical print size is about 0.2° of x-height. **Changes:** the
   current step went from 23 px to 28 px, and I replaced "across the kitchen" with measured distances.
3. Laws of UX, Von Restorff effect: https://lawsofux.com/von-restorff-effect/. It says to use emphasis with restraint, and
   not to rely on colour alone. **Changes:** ink as the one button, sheen only on the lit item, quieter thumbnails.
4. Wolt, BlurHash README: https://github.com/woltapp/blurhash. A blur "shows while the real image is loading".
   **Changes:** the blurred art became crisp strata.
5. Google Design, "Expressive Material Design: Google research":
   https://design.google/library/expressive-material-design-google-research. Key elements were found up to 4× faster
   when they were larger and "placed just above the keyboard". Unlabelled images were not recognised as a playlist.
   **Changes:** a full-width docked primary button at the bottom, and art that is always beside a title.
6. Microsoft Fluent 2, Button usage (Android): https://fluent2.microsoft.design/components/android/core/button/usage.
   An extended FAB "floats above all other layout elements" and collapses on scroll. **Changes:** I docked the button
   instead of floating it.
7. Calm Tech Institute, principles: https://calmtech.institute/calm-tech-principles. "Require the smallest possible
   amount of attention" and "Make use of the periphery". **Changes:** while cooking, one lit step and a muted room,
   with no loops and no wash.
8. Spence (2015), "On the psychological impact of food colour", _Flavour_:
   https://flavourjournal.biomedcentral.com/articles/10.1186/s13411-015-0031-3. I cite it through Designer 2's
   critique, because the publisher's page needs a login. I was not able to open it. It supports colour from the food.
