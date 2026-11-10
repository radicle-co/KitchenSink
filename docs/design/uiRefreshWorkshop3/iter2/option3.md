# Option 3: Enamelware (iteration 2, final)

Designer 3. Mockup: [`option3.html`](option3.html), one file of about 60 KB. I rendered it in Chromium at 390 px and
1400 px. There is no horizontal scroll and no script error, and both fonts load. I also clicked through it: tapping a
step moves both rims and both labels, the pinned plate shows only while Screen on is on and the hero has scrolled away,
and reduced motion turns every transition off. One script holds the token list. It writes the page's colours, the
swatch sheet and every table below, so the spec and the page cannot disagree. Before using that script I checked it
against two iteration 1 figures: ink on the old ground gives 14.81 and Lc 93, and dark Slate on Well gives Lc −70.9,
the number critique 1 flagged.

## The idea

The recipe you are cooking sits on one glossy enamel plate, and the plate's rim counts your steps, one segment per
step. Everything else is a calm, ordinary app with soft, enamel-rounded edges. Cobalt means what you press, and the steps you
have set by pressing.

## Why it is simple

- **Nothing new to learn.** There are five tabs with icons and words. Each screen is one column that scrolls. Lists
  are lists, the stepper says − and +, the switch is a switch, and step numbers are round buttons.
- **One obvious action per screen.** It is the single glossy cobalt pill: **New recipe** on Home and My recipes, and
  **Edit recipe** on a recipe. Nothing else in the app is glossy.
- **The one new picture says itself in words.** The rim is a row of page dots bent into a ring, and it always comes
  with "Step 2 of 5" in its gap. You never have to read the ring.
- **Cobalt means what you press, and the steps you have set by pressing.** It fills the button, and colours links,
  the current tab, the step numbers and the rim segments, rule and mini ring for the steps you set. Words are never
  cobalt unless you can press them; words about progress are Ink. The pale cobalt wash is the one decorative use,
  and it never carries meaning alone.
- **A thumbnail is a dish.** It is the cook's photo on a plate or, with no photo, an empty glazed dish. There are no
  letters in circles, so a recipe never looks like a person.
- **Status is always a word.** Private and Draft are outlined tags with an icon, and Soon is the same tag.

### Screen by screen

- **Home.** "Good morning, Eliza Ramirez", "Friday, October 16, 2026" and the ER avatar. Under "Recent recipes" and
  "See all", the latest recipe (Lemon ricotta pancakes, American · 35 min) sits on a 226 px plate cut by the screen
  edge. Three rows follow, each with an empty glazed dish (Weeknight pad thai, Private; Roast tomato soup, Draft;
  Sunday rosemary focaccia). "Coming soon" has its line and three rows tagged Soon. New recipe sits in its own band
  above the tabs, so it never covers a row.
- **My recipes.** "Recipes", the My recipes / Collections segment, "Search your recipes", the quick filters (All,
  Under 30 min 2, American 3, French 1), "9 recipes · Recently edited" and the list/grid toggle. Two rows have photos,
  five have glazed dishes, and long names wrap to two lines.
- **Recipe detail.** The cook's photo sits in the plate, the step rim around it, "Step 2 of 5" in the rim's gap, and
  Back. The white sheet keeps the app's order: British, the title, Public, `Source: Family recipe card`, Version
  history; Community rating, `4.8 · 12 ratings`, `You can't rate your own recipe.`, 8 comments; Total, Prep,
  Difficulty; **Edit recipe**; Screen on with "Keeps the screen awake while you cook."; the description, More, the
  tags and `Nutrition · 612 cal per serving`; Ingredients with `− for 4 +` and Edit, in two groups; Steps with Edit,
  numbered buttons and timers. Step 4 has **two** timers, 20 min and 1 h 10 min.
- **Cooking (Screen on).** When the plate scrolls out of view, a pinned bar slides down under the status bar: a 48 px
  plate with its rim, "Step 2 of 5", the recipe name, and a "Go to step" link that scrolls to the current step.
- **Discover, Collections and the editor** use the same parts: dishes as thumbnails, plain rows, and a white sheet
  for the editor with the photo slot at the top.

### The rim, in every state

| State                | What the rim shows                                                              | What the gap says |
| -------------------- | ------------------------------------------------------------------------------- | ----------------- |
| No step set          | All segments are thin Edge lines. Nothing is cobalt.                            | "5 steps"         |
| Step k of n (n ≤ 10) | n separate arcs with 6° gaps. Arcs 1 to k are thick cobalt, the rest thin Edge. | "Step k of n"     |
| More than 10 steps   | n short radial ticks instead of arcs. Ticks 1 to k are cobalt.                  | "Step k of n"     |
| Last step            | Every arc cobalt, still separate pieces.                                        | "Step n of n"     |

The mockup draws three of these by day and two by night, because the dark recipe frame opens scrolled to Steps.
The ring never animates by itself. It changes only when the cook taps a step number, and then one segment fills in
0.3 s. The words are in a polite live region.

## The palette: Enamelware

**The logic.** One enamel plate on a cool white table. Cobalt is the glaze on what you press, and on the steps you
have set. Everything else is white enamel, slate and ink. The food in the photos and the six dish glazes bring the
warm colours.

| Name        | Role                                                                 | Light     | Dark      |
| ----------- | -------------------------------------------------------------------- | --------- | --------- |
| Table       | Table: the ground                                                    | `#EDF0F5` | `#131720` |
| Plate       | Plate: lists, sheet, tab bar                                         | `#FFFFFF` | `#1C212B` |
| Seam        | Hairlines, plate rim (decoration)                                    | `#D8DDE6` | `#323947` |
| Well        | Inset: fact strip, Screen on row                                     | `#F4F6F9` | `#262C38` |
| Ink         | Text, progress words, selected fill, focus ring                      | `#14181F` | `#F0F2F6` |
| Slate       | Muted text, ticked box                                               | `#454C59` | `#D3D8E0` |
| Edge        | Control outlines, steps to come on the rim                           | `#737A87` | `#7F8796` |
| Cobalt      | What you press: the one button, links, current tab, the step you set | `#0B4DBE` | `#9EC3FF` |
| On cobalt   | Label on cobalt                                                      | `#FFFFFF` | `#131720` |
| Cobalt wash | Current-step ground (decoration)                                     | `#E5EDFC` | `#1F2C47` |
| Yolk        | Star and avatar fill only                                            | `#F2B233` | `#FFD34E` |
| Yolk deep   | Star and avatar outline (light)                                      | `#7A4E00` | `#FFD34E` |
| On yolk     | Avatar initials                                                      | `#1B1405` | `#1B1405` |
| Herb        | Success, with an icon                                                | `#1B6E41` | `#6BD89F` |
| Amber       | Warning, with an icon                                                | `#8F4A00` | `#FFB474` |
| Tomato      | Danger, with an icon                                                 | `#B3261E` | `#FFA3AA` |
| Plate art   | Hero plate body                                                      | `#FFFFFF` | `#2A303C` |

The glossy pill adds a white highlight at the top. At the lightest point behind the label, the light pill is
`#1957C2` with white text at **6.60 : 1**, and the dark pill is `#A6C8FF` with `#131720` text at **10.53 : 1**.

**Glazes** are for empty dishes only and never carry meaning. Each is given as body / rim line.

| Glaze   | Light                 | Dark                  |
| ------- | --------------------- | --------------------- |
| Delft   | `#D9E2F2` / `#2A4A85` | `#2A3B5E` / `#9DB6E6` |
| Celadon | `#CFE3D3` / `#2D5B3A` | `#26402E` / `#97C9A3` |
| Paprika | `#F6D2C4` / `#8E2F17` | `#4D2A1F` / `#E8A88F` |
| Mustard | `#F5E1A6` / `#6E4D00` | `#433716` / `#DCC071` |
| Heather | `#E2D5EE` / `#5B3A7A` | `#3A2C4B` / `#C3A9E0` |
| Lagoon  | `#CDE7EA` / `#1F5C66` | `#1D3E44` / `#8FCBD3` |

### Contrast (WCAG 2.2 ratio, with APCA Lc as a magnitude)

| Pair                                          | Light          | Dark          | Needs |
| --------------------------------------------- | -------------- | ------------- | ----- |
| Ink on table                                  | 15.58 · Lc 96  | 16.00 · Lc 98 | 4.5   |
| Ink on plate                                  | 17.79 · Lc 105 | 14.39 · Lc 97 | 4.5   |
| Ink on well                                   | 16.44 · Lc 99  | 12.49 · Lc 95 | 4.5   |
| Ink on wash (current step)                    | 15.13 · Lc 94  | 12.41 · Lc 95 | 4.5   |
| Slate on table                                | 7.56 · Lc 81   | 12.53 · Lc 82 | 4.5   |
| Slate on plate                                | 8.64 · Lc 90   | 11.27 · Lc 80 | 4.5   |
| Slate on well (Screen on hint)                | 7.98 · Lc 84   | 9.78 · Lc 78  | 4.5   |
| Slate on wash                                 | 7.34 · Lc 79   | 9.72 · Lc 78  | 4.5   |
| Label on cobalt (button, step number)         | 7.45 · Lc 90   | 9.99 · Lc 69  | 4.5   |
| Label on ink (selected chip, segment)         | 17.79 · Lc 107 | 14.39 · Lc 95 | 4.5   |
| Cobalt link on table                          | 6.52 · Lc 76   | 9.99 · Lc 68  | 4.5   |
| Cobalt link on plate                          | 7.45 · Lc 85   | 8.99 · Lc 67  | 4.5   |
| Cobalt link on well                           | 6.88 · Lc 80   | 7.80 · Lc 65  | 4.5   |
| Cobalt rule and number on wash (non-text)     | 6.33 · Lc 74   | 7.75 · Lc 65  | 3     |
| Cobalt ring segment on table (non-text)       | 6.52 · Lc 76   | 9.99 · Lc 68  | 3     |
| Cobalt button on table (non-text)             | 6.52 · Lc 76   | 9.99 · Lc 68  | 3     |
| Cobalt mini ring on plate (non-text)          | 7.45 · Lc 85   | 8.99 · Lc 67  | 3     |
| Cobalt ring segment on hero plate (non-text)  | 7.45 · Lc 85   | 7.38 · Lc 64  | 3     |
| Edge: steps to come, on hero plate (non-text) | 4.32 · Lc 70   | 3.66 · Lc 33  | 3     |
| Initials on yolk                              | 9.74 · Lc 67   | 12.78 · Lc 82 | 4.5   |
| Star outline on table (non-text)              | 6.30 · Lc 76   | 12.53 · Lc 82 | 3     |
| Star outline on plate (non-text)              | 7.20 · Lc 85   | 11.28 · Lc 81 | 3     |
| Herb on plate                                 | 6.26 · Lc 81   | 9.18 · Lc 69  | 4.5   |
| Amber on plate                                | 6.67 · Lc 82   | 9.24 · Lc 69  | 4.5   |
| Tomato on plate                               | 6.54 · Lc 81   | 8.50 · Lc 64  | 4.5   |
| Herb on table                                 | 5.48 · Lc 72   | 10.20 · Lc 70 | 4.5   |
| Amber on table                                | 5.84 · Lc 73   | 10.27 · Lc 70 | 4.5   |
| Tomato on table                               | 5.72 · Lc 72   | 9.45 · Lc 66  | 4.5   |
| Edge on table (non-text)                      | 3.78 · Lc 61   | 4.96 · Lc 37  | 3     |
| Edge on plate (non-text)                      | 4.32 · Lc 70   | 4.46 · Lc 36  | 3     |
| Edge on well, switch off (non-text)           | 3.99 · Lc 64   | 3.87 · Lc 34  | 3     |
| Edge on wash (non-text)                       | 3.67 · Lc 59   | 3.85 · Lc 34  | 3     |
| Ticked box: slate on plate (non-text)         | 8.64 · Lc 90   | 11.27 · Lc 80 | 3     |
| Focus ring: ink on table (non-text)           | 15.58 · Lc 96  | 16.00 · Lc 98 | 3     |

Every text pair passes 4.5 : 1 and every state mark or control edge passes 3 : 1, in both modes. All muted text
(Slate) is now Lc 78 or more on every ground, which answers critique 1's dark Slate on Well (it was Lc 70.9).
Dark Cobalt links sit at Lc 65 to 68. Under APCA that is fine for short links and labels, and Cobalt never sets running
text: in a paragraph, a link would be underlined Ink.

Decoration, which never carries meaning alone:

- Plate on table is 1.14 in light and 1.11 in dark, so lists and the sheet always carry a Seam line too.
- Seam on plate is 1.36 and 1.39. It draws hairlines and the plate rim only.
- Cobalt wash on plate is 1.18 and 1.16. The current step is carried by the 4 px cobalt rule, the filled number,
  the words "Current step" and 26 px type.

### Increase Contrast

Apple asks for a variant of every custom colour for the Increase Contrast setting (critique 2). These five tokens
change; the rest already pass by a wide margin.

| Increase Contrast token                                   | Light         | Dark          | Check              |
| --------------------------------------------------------- | ------------- | ------------- | ------------------ |
| Slate: `#2E343E` / `#E6E9EE`                              | 11.57 · Lc 93 | 11.50 · Lc 89 | on well ≥ 4.5      |
| Edge: `#4F5562` / `#A3ABB9`                               | 6.55 · Lc 77  | 7.76 · Lc 55  | on table ≥ 3       |
| Seam (hairlines become real lines): `#7F8796` / `#737B8C` | 3.62 · Lc 64  | 3.80 · Lc 30  | on plate ≥ 3       |
| Cobalt: `#0A3F9E` / `#BBD4FF`                             | 8.05 · Lc 80  | 9.26 · Lc 75  | on wash ≥ 4.5      |
| On cobalt: `#FFFFFF` / `#131720`                          | 9.47 · Lc 95  | 11.93 · Lc 79 | on IC cobalt ≥ 4.5 |

### Must not be confused

| Must not be confused | Light | Dark | What tells them apart                                                                                                 |
| -------------------- | ----- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| Cobalt vs Tomato     | 1.14  | 1.06 | Blue vs red; danger always carries the word Delete and an icon.                                                       |
| Amber vs Tomato      | 1.02  | 1.09 | Hue, plus a warning or error icon and a word.                                                                         |
| Yolk vs Amber        | 3.56  | 1.22 | Yolk is only a fill (avatar, star), never a status.                                                                   |
| Slate vs Cobalt      | 1.16  | 1.25 | A ticked box is a square with a tick; the current step number is a round cobalt button beside the words Current step. |
| Herb vs Cobalt       | 1.19  | 1.02 | Herb only appears in a success message with an icon; it never fills a control.                                        |
| Slate vs Ink         | 2.06  | 1.28 | Muted text is also smaller (14 to 15 px vs 17 px). A selected chip is an ink pill with a word.                        |

## How it stays distinct

All three options now sit on a near-white table, and I measured how close they are. My light table `#EDF0F5` is
ΔE00 4.0 from Pilot Light's Fog and 4.0 from Fresh Cut's white. That is close, and it is honest to say so: modern apps
share pale grounds. The table is not where the options differ. They differ in four things:

|                | Pilot Light (1)     | Fresh Cut (2)      | Enamelware (3)                 |
| -------------- | ------------------- | ------------------ | ------------------------------ |
| The one button | Spruce green pill   | Black ink pill     | Glossy cobalt pill             |
| The big idea   | A lamp lights "now" | Poster produce art | A plate whose rim counts steps |
| Image shape    | Rounded squares     | Tiles              | Circles with a rim             |
| Type           | Funnel              | Archivo            | Nunito and Andika              |

Cobalt `#0B4DBE` is ΔE00 33.5 from Fresh Cut's Peppercorn and 37.3 from Pilot Light's Spruce `#0B4F3E`. One near-collision is
left: Fresh Cut's Blueberry **link** `#3442C2` is ΔE00 5.4 from my Cobalt. It is a link colour there and the main fill
here, so the screens still look different, but if Fresh Cut keeps it, the two link colours will look alike.

## Type

- **Nunito** 800 for titles: screens and recipes at 29 px, sections at 21 px. Its strokes end round, like an edge
  dipped in enamel. That is the material, and it is also the reply to "geometric sans, fintech". In Velasco and
  others (2015, n = 200), rounder typefaces were matched with "sweet", liked more, and judged easier to read. That is
  a better voice for food than a crisp geometric face. I do not claim it makes food taste better.
- **Andika** 400 and 700 for reading: body 17 px, the current step 26 px, meta 15 px, tags 13 px. SIL designed it as
  a literacy face whose letters are "not readily confused with one another". I, l and 1 all differ, and its zero is a
  plain narrow oval, so "800 g", "220°C" and "2026" no longer look like code. All its digits are one width, so
  amounts line up without a feature.
- **Why I left Atkinson.** I opened the Google Fonts file for Atkinson Hyperlegible Next. Its only OpenType features
  are `ccmp`, `frac`, `locl`, `pnum` and `tnum`. It has a slashed `zero` and a `zero.tf`, and no open-zero alternate.
  So the slashed zero could not be turned off, and the fix was a different face.
- **Size at the stove.** The current step is 26 px. Andika's x-height is 0.508 em, so on a phone at 3× the x-height
  is about 2.2 mm. That meets Legge and Bigelow's 0.2° critical print size out to about **0.63 m**, which is counter
  distance. At 21 px it was 0.50 m. I do not claim "across the kitchen".

## Motion

- On load, the hero plate settles once: 0.7 s, from 6 px above and 2 % larger. It moves by transform only, so the
  first frame is complete.
- When you set a step, one rim segment fills in 0.3 s. The ring never moves by itself and never spins, so it cannot
  look like loading.
- The pinned plate slides down in 0.25 s when the hero scrolls away, and slides back when it returns.
- A tick draws in 0.15 s, and the switch slides in 0.2 s.
- Nothing loops. Under `prefers-reduced-motion`, every transition and animation is off, and "Go to step" jumps
  instead of scrolling smoothly.

## Changes this iteration

| Feedback                                                                                            | Verdict                              | What I did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The rim reads as loading: a circular stroke that grows is the platform's loading sign (critique 1)  | **Accept**                           | The rim is now one separate arc per step, with 6° gaps and a 64° opening at the bottom. "Step 2 of 5" sits in that opening. Apple's page control is "a row of indicator images, each of which represents a page", with "a solid dot" for the current page. The rim is that row, bent around the plate. A loading ring is one smooth stroke that spins, and this one is in pieces and never moves by itself.                                                                                                                                                  |
| What happens past 10 steps? (my own check)                                                          | **Fix**                              | Apple says more than about 10 dots "are hard to count at a glance". Past 10 steps, the arcs become short ticks and the words carry the count.                                                                                                                                                                                                                                                                                                                                                                                                                |
| The ring's words are hidden until a step is set (critique 2)                                        | **Accept**                           | With no step set, the gap says "5 steps". The words are always there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The ring scrolls away before you reach the steps; pin the plate (critique 2, bold push)             | **Accept, without the Next button**  | With Screen on, a pinned bar appears once the plate scrolls away: a 48 px plate with its rim, "Step 2 of 5" and a "Go to step" link. I left out a Next step button for two reasons. A second filled button in view with Edit recipe would break the one-glossy-action rule. And Pilot Light's iteration 2 makes Next step its one filled button, so leaving it out keeps the two options apart. Setting a step is still done by tapping its number. The pinned bar and its "Go to step" link are additions to the screen, so they need the owner's approval. |
| Step 4 has one 1 h 30 min timer for a two-part step (both)                                          | **Accept, it was a correctness bug** | Step 4 now has two timers, **20 min** and **1 h 10 min**. A cook who starts the first is reminded to lower the oven.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Round letter plates read as people next to the avatar (critique 2, Primer)                          | **Accept**                           | Primer: "Circle Avatars represent individual people". The letters are gone. With no photo, a recipe shows an empty glazed dish: a rim line, a sunken well and one highlight. I kept the circle, because round is this option's shape, and made it a dish. The ER avatar is now the only circle with letters.                                                                                                                                                                                                                                                 |
| "Step 2 of 5" and "Current step" are cobalt but cannot be pressed (critique 2, Apple HIG)           | **Accept**                           | Both are Ink now. Apple: using the brand colour on "noninteractive text is confusing". Cobalt stays only on things you press (button, links, tabs, step numbers, timers) and on the steps you have set with those numbers.                                                                                                                                                                                                                                                                                                                                   |
| Current step should be 26 px or more (critique 2)                                                   | **Accept**                           | 26 px Andika, with a 4 px cobalt rule (was 3 px), a filled number and "Current step" in 15 px Ink.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Slashed zeros in "8Ø0 g" and "22Ø°C" (both)                                                         | **Accept**                           | I checked the font file: Atkinson Next has no open-zero alternate. The body face is now Andika, which has a plain zero and still tells I, l and 1 apart.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Dark Slate on Well is Lc 70.9, below the Lc 75 body minimum (critique 1)                            | **Accept**                           | Dark Slate is now `#D3D8E0`: Lc 78 on Well and 78 to 82 everywhere. Light Slate is Lc 79 to 90.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Dark Cobalt link is Lc 64.5 (critique 1)                                                            | **Accept in part**                   | Dark Cobalt went from `#97BEFF` to `#9EC3FF`, so links are Lc 65 to 68. It is never used for running text, which is the case critique 1 worried about.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Blue-grey ground, navy dark mode, cobalt and geometric sans look like fintech (both)                | **Accept, while keeping cobalt**     | I took most of the blue out of the table: chroma 4.5 → 2.8 in light, and navy `#0C1424` (chroma 12.2) → blue-black `#131720` (chroma 7.0) in dark. Slate, Ink and Edge are now near-neutral. Titles moved from geometric Lexend to rounded Nunito. The warm notes come from the photo and the glazes. I kept some blue in the table on purpose, to stay apart from Fresh Cut's pure white.                                                                                                                                                                   |
| Increase Contrast tokens are owed (critique 2, Apple HIG)                                           | **Accept**                           | Five tokens have Increase Contrast variants: Slate, Edge, Seam, Cobalt and On cobalt. In that mode, Seam hairlines become real 3 : 1 lines.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Update "How it stays distinct" (critique 1)                                                         | **Accept**                           | Rewritten above, with measured distances, including the one near-collision left (Fresh Cut's link blue).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Keep the one glossy pill, quiet "Edit" links, fading ticked rows and Ink for selected states (both) | **Kept**                             | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Blue is cold for food (earlier rounds)                                                              | **Still push back**                  | Schlintl and Schienle (2020) found that coloured backgrounds, blue among them, did not change food wanting. Critique 3 retracted the same point about Fresh Cut. Taking chroma out of the table is about the fintech look, not about appetite.                                                                                                                                                                                                                                                                                                               |

## Open risks

- **Andika can read as schoolbook.** Its single-storey "a" is friendly but less sleek than Atkinson. I judged it at
  17 px and 26 px on a real ingredient list and step 4, and it reads calmly. A test with cooks should confirm it.
- **Empty dishes repeat.** A library with few photos is a column of coloured dishes, so the title does all the work
  of naming. That is fine, since titles are always shown, but it is less rich than photos. Asking for a photo in the
  editor is the real fix.
- **Photo crop.** A round crop loses the corners of a wide photo. It needs a focus point, centred by default and
  movable in the editor.
- **The rim depends on the cook setting a step.** It never suggests progress the cook did not set. With no step set
  it shows "5 steps" and no cobalt.
- **The pinned bar is new.** It and "Go to step" are additions to a screen whose contents are fixed. They only show
  state the cook already set, but the owner should approve them.
- **Pinned bar on the web.** On a wide screen the same pinned bar can sit at the top of the steps column. I have drawn
  only the phone.
- **Retro risk.** Cobalt and white can drift toward heritage enamel. The guard is still: no speckles, chips, stripes
  or Delft patterns.

## Sources and what each changed

- Critique 1 (Designer 1) and critique 2 (Designer 2), `iter2/critique_by1.md` and `iter2/critique_by2.md`. Every row
  in the changes table answers one of their points.
- Android Developers, Progress indicators, https://developer.android.com/develop/ui/compose/components/progress. A
  circular indicator is "a circle whose stroke grows", and an indeterminate one "uses motion to indicate … that
  processing is ongoing". This confirmed critique 1's finding, and it is why the rim is in pieces and never moves by
  itself.
- Apple HIG, Progress indicators, https://developer.apple.com/design/human-interface-guidelines/progress-indicators.
  A determinate indicator fills "a linear or circular track as the task completes". So a smooth ring is the system's
  "task" picture, which is what the segments avoid.
- Apple HIG, Page controls, https://developer.apple.com/design/human-interface-guidelines/page-controls. "A solid dot
  denotes the current page", and "more than about 10 dots are hard to count at a glance". This is the model for the
  segmented rim and the reason it switches to ticks past 10 steps.
- Apple HIG, Color, https://developer.apple.com/design/human-interface-guidelines/color. The brand colour on
  "noninteractive text is confusing", and colours must "work well in light, dark, and increased contrast contexts".
  This moved the progress words to Ink and added the Increase Contrast table.
- GitHub Primer, Avatar, https://primer.style/product/components/avatar. "Circle Avatars represent individual people."
  This is why the letters left the round thumbnails.
- Velasco, Woods, Hyndman and Spence (2015), "The Taste of Typeface", _i-Perception_,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4934647. Rounder typefaces were matched with "sweet" and were "liked more
  and … judged easier to read". This supports Nunito's rounded ends for a food app.
- SIL International, Andika, https://software.sil.org/andika/. A literacy face whose letters are "clear,
  easy-to-perceive" and "not readily confused with one another". This made it the reading face. I also opened its font
  file: the digits are all one width, and the zero is unslashed.
- Google Fonts file for Atkinson Hyperlegible Next (fetched from the `css2` API and inspected with fontTools). It has
  no open-zero alternate, so the slashed zero could not be switched off.
- Legge and Bigelow (2011), _Journal of Vision_, https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. The critical print
  size is about 0.2°. With Andika's x-height, 26 px reaches it at about 0.63 m.
- APCA introduction (Myndex), https://github.com/Myndex/apca-introduction. Lc 75 is the body-text minimum. This is
  why Slate is Lc 78 or more everywhere.
- W3C, Understanding SC 1.4.11 Non-text Contrast, https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html.
  A state mark needs 3 : 1. This is why the steps still to come are drawn in Edge, not Seam: the number of steps can
  be seen.
- Google Design, "Expressive Design: Google's UX Research",
  https://design.google/library/expressive-material-design-google-research. Bigger, contained key actions were found
  faster, and unlabelled images were not recognised. This is why there is one big glossy action and why the rim always
  has words.
- Schlintl and Schienle (2020), _Frontiers in Psychology_,
  https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full. Coloured backgrounds, blue among them, did not
  change food wanting. This is the basis for my pushback on "blue is cold".
