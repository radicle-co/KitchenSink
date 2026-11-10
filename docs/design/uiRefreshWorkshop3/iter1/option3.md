# Option 3: Enamelware (iteration 1)

Designer 3. Mockup: [`option3.html`](option3.html). It is one file of about 54 KB. I rendered it in Chromium at
390 px: no horizontal scroll, no script errors, and both fonts load. Every contrast figure below was computed from the
same token list that writes the mockup's CSS, so the spec and the page cannot disagree.

## The idea

The recipe you are looking at sits on one glossy enamel plate, and its rim is a ring that fills as you cook. The rest
is a calm, ordinary app on a pale enamel table. Cobalt marks only two things: what you can press, and how far you have
cooked.

How the app works does not change. What is new is one real object, an enamel plate, which does a real job. Its rim
shows your progress, and it says the progress in words too ("Step 2 of 5").

## Changes this iteration

| Feedback                                                                                                                 | Verdict                                         | What I did                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Options 2 and 3 share the same type, Bricolage and Figtree (critique 1)                                                  | **Accept**                                      | I moved both families. Titles are **Lexend** and reading is **Atkinson Hyperlegible Next**. Option 1 uses Funnel and option 2 has moved to Archivo, so all three now differ.                                                                                                                                                     |
| The page shows illustrated dishes, which contradicts "no cut-outs" and blurs into option 2 (critique 2, biggest finding) | **Accept**                                      | Every drawn dish is gone. A recipe with no photo gets a glazed letter, and on My recipes that is five of the seven rows. The two recipes with photos use drawn stand-ins with photo cues: light from the top left, a specular highlight, a vignette, grain and a sharp subject. The footer says they are stand-ins.              |
| Show a real angled photo (critique 1)                                                                                    | **Push back, partly**                           | The brief allows no outside images, so a real photo cannot ship in this file. The stand-in shows a roasting tin from an angle, with a crisp subject. So it tests the round crop on the shape of a real phone photo. It is sharp on purpose, because a blurred field is option 1's look and also reads as an image still loading. |
| Rings everywhere, "an icon set, not a material", and ten cobalt rings dilute the button (both)                           | **Accept**                                      | Cobalt is now on **one** plate per screen, and there it is the progress ring, not decoration. Row plates keep their round shape but have a neutral Seam edge, no cobalt, no gloss and no shadow. Coming soon icons lose their circles.                                                                                           |
| Make thumbnails plain squares (critique 1)                                                                               | **Push back**                                   | Round is what keeps this option apart: option 1 uses rounded squares and option 2 uses tiles. So the circle stays, and the colour and gloss leave it. Critique 2 asked for the same compromise.                                                                                                                                  |
| Gloss only on the one cobalt button (critique 1, bold push)                                                              | **Accept**                                      | The primary pill is the one glossy object: a soft top highlight and a 1 px specular edge, like enamel dipped in glaze. The label sits below the gloss. At the lightest point behind the label, white on the glossed cobalt is 6.52 : 1.                                                                                          |
| The plate as the progress object (critique 2, bold push)                                                                 | **Accept**                                      | On the recipe, the hero rim fills to the current step: 2 of 5 is 40 %. Under it, "**Step 2** of 5" says the same thing in words. When you tap a step number, it moves for 0.6 s. It never moves by itself or loops.                                                                                                              |
| A primary colour that is also decoration costs findability (critique 2, NN/g)                                            | **Accept, and go further**                      | Selected chips, the segment and the view toggle are now filled with **Ink**, not Cobalt. So on My recipes the only cobalt fill is New recipe. The current tab stays cobalt, as on iOS and Android.                                                                                                                               |
| The floating New recipe button covers Coming soon and the last row (both)                                                | **Accept**                                      | The button sits in its own band above the tabs, and the list ends above that band. It can never cover a row, and it stays in thumb reach.                                                                                                                                                                                        |
| Home's single plate floats in empty space (critique 1)                                                                   | **Accept**                                      | The latest recipe's plate is 226 px, cut by the right edge of the screen. Its name sits beside it. There is one confident object and no empty field.                                                                                                                                                                             |
| The current step is too small for distance, and the wash is 1.19 : 1, so it is decoration (both)                         | **Accept**                                      | The current step is **21 px** at weight 500, against 17 px for other steps. It has a **3 px Cobalt left rule** (6.26 : 1 on the wash), a filled number, and "Current step" in 14 px sentence case. The wash is listed as decoration. The rule, the number and the words carry the state.                                         |
| Body at 16 px is small for distance (critique 1)                                                                         | **Accept**                                      | Body is 17 px, meta is 15 px and tags are 13 px.                                                                                                                                                                                                                                                                                 |
| Ticked ingredients struck through are hard to re-read (both)                                                             | **Accept**                                      | There is no line through. A ticked line turns Slate, its amount drops to regular weight, and the box fills Slate with a tick. Done things go quiet.                                                                                                                                                                              |
| Herb tick vs Cobalt selected is 1.19, hue only (critique 2)                                                              | **Accept**                                      | Herb no longer fills any control. The ticked box is Slate. Herb is kept for success messages, with an icon.                                                                                                                                                                                                                      |
| Icon-only pencils beside Ingredients and Steps (critique 1)                                                              | **Push back on removing them, accept on words** | The app has these doors (`RecipeDetailBody.tsx`, messages `editSection: 'Edit'`, `editIngredientsLabel`, `editStepsLabel`). The screen's contents are fixed, so I kept them as quiet text links that read "Edit", with a pencil and the full accessible name. The one filled button is still Edit recipe.                        |
| Light Slate sits at the APCA body minimum (Lc 75.7), and dark Slate is Lc 58.7 (critique 1)                              | **Accept**                                      | Light Slate `#475468` became `#3E4A5E` (Lc 80 on ground, 91 on surface). Dark Slate `#A8B3CA` became `#C3CCDD` (Lc 73 to 75).                                                                                                                                                                                                    |
| Dark Cobalt label at Lc 59.9 (my own check)                                                                              | **Fix**                                         | Dark Cobalt `#80B0FF` became `#97BEFF`. The label on it is now Lc 67 (9.75 : 1). Dark Tomato and Amber are also lighter (Lc 63 to 69).                                                                                                                                                                                           |
| Blue is cold and unappetising (draft critiques)                                                                          | **Push back with evidence**                     | In Schlintl and Schienle (2020), coloured backgrounds, blue included, did not change food wanting. The cool ground is a mood choice. The food in the photo brings the warmth.                                                                                                                                                    |
| Plate settles in from transparent, so first paint is incomplete (critique 2 on option 1, and my own build)               | **Fix**                                         | The settle is transform only (6 px and 2 %). The plate is fully visible from the first frame.                                                                                                                                                                                                                                    |

## Why it is simple

- **Nothing new to learn.** There are five tabs with icons and words. Each screen is one column that scrolls. Lists
  are lists, the stepper says − and +, the switch is a switch, and step numbers are round buttons.
- **One obvious action per screen.** It is the single glossy cobalt pill: **New recipe** on Home and My recipes, and
  **Edit recipe** on a recipe.
- **The only new picture is a familiar one.** A ring that fills is how phones show progress, and it always comes with
  the words "Step 2 of 5". You never have to read the ring.
- **Status is always a word.** Private and Draft are outlined tags with an icon, and Soon is the same tag. Public is a
  meta line with a globe.
- Google's M3 Expressive research is why the one action is big, bright and contained. It is also why every picture
  here has a label: unlabelled images were not recognised, and "no amount of expressive design will beat basic
  functionality".

### Screen by screen

- **Home.** It shows "Good morning, Eliza Ramirez", "Friday, October 16, 2026" and the avatar. Under "Recent recipes"
  and "See all", the latest recipe's plate (Lemon ricotta pancakes, American · 35 min) is cut by the screen edge. Three
  list rows follow, each with a glazed letter, and one of them is a Draft. "Coming soon" has its line and three rows,
  each tagged Soon. New recipe sits in the band above the tabs.
- **My recipes.** It has "Recipes", the My recipes / Collections segment, "Search your recipes", and the quick filters
  (All, Under 30 min 2, American 3, French 1). Then "9 recipes · Recently edited" and the list/grid toggle. The list
  has two photo rows and five letter rows, and long names wrap to two lines.
- **Recipe detail.** The cook's photo sits in the plate, the progress ring around it, "Step 2 of 5" under it, and Back.
  The white sheet holds, in the app's order:
    - British, the title, Public, `Source: Family recipe card` and Version history
    - Community rating, `4.8 · 12 ratings`, `You can't rate your own recipe.` and 8 comments
    - Total, Prep and Difficulty
    - **Edit recipe**, then Screen on with "Keeps the screen awake while you cook." (the app's own hint)
    - the description, More, the tags, and `Nutrition · 612 cal per serving`
    - Ingredients, with `− for 4 +` and Edit, in two groups
    - Steps, with Edit, numbered buttons and timers
- **Discover, Collections and the editor** use the same parts: round plates as thumbnails, plain rows, and a white
  sheet for the editor with the photo slot at the top.

## The palette: Enamelware

**The logic.** One enamel plate on its table. Cobalt is the glaze on the one thing you press and on the rim that shows
how far you are in the recipe. Everything else is white enamel, slate and ink. The food brings the warm colours.

| Name                 | Role                                                           | Light     | Dark      |
| -------------------- | -------------------------------------------------------------- | --------- | --------- |
| Enamel / Graniteware | ground                                                         | `#E8EDF5` | `#0C1424` |
| Plate / Stoneware    | surface: lists, sheet, tab bar                                 | `#FFFFFF` | `#172037` |
| Seam                 | hairlines, row-plate edge, progress track (decoration)         | `#D3DBE8` | `#2A3550` |
| Well                 | inset: fact strip, Screen on row                               | `#F1F4F9` | `#222C46` |
| Ink                  | text, focus ring, selected chip and segment fill               | `#0E1A2E` | `#EEF2FA` |
| Slate                | muted text, ticked box                                         | `#3E4A5E` | `#C3CCDD` |
| Cobalt               | the one action, links, current tab, current step, progress rim | `#0B4DBE` | `#97BEFF` |
| On cobalt            | label on cobalt                                                | `#FFFFFF` | `#0C1424` |
| Cobalt wash          | current step ground (decoration)                               | `#E3ECFB` | `#1D2B4D` |
| Yolk                 | avatar and star fill only                                      | `#F2B233` | `#FFD34E` |
| Yolk deep            | light star and avatar outline                                  | `#7A4E00` | `#FFD34E` |
| On yolk              | avatar initials                                                | `#1B1405` | `#1B1405` |
| Herb                 | success messages                                               | `#1B6E41` | `#66D69A` |
| Amber                | warning text with an icon                                      | `#8F4A00` | `#FFB070` |
| Tomato               | danger text with an icon                                       | `#B3261E` | `#FFA0A8` |
| Edge                 | control outlines                                               | `#6E7A90` | `#7C8AAA` |
| Plate art            | hero plate body                                                | `#FFFFFF` | `#2C3754` |

**Glazes** are for letter plates only and never carry meaning. Each is given as fill / letter.

| Glaze   | Light                 | Dark                  |
| ------- | --------------------- | --------------------- |
| Delft   | `#D9E2F2` / `#2A4A85` | `#24375C` / `#C8D7F4` |
| Celadon | `#CFE3D3` / `#2D5B3A` | `#223F2B` / `#BFE0C7` |
| Paprika | `#F6D2C4` / `#8E2F17` | `#4A2318` / `#F6C9B6` |
| Mustard | `#F5E1A6` / `#6E4D00` | `#3D3110` / `#F2DB98` |
| Heather | `#E2D5EE` / `#5B3A7A` | `#352646` / `#DCCBEE` |
| Lagoon  | `#CDE7EA` / `#1F5C66` | `#183B41` / `#BCE3E8` |

The letter on its glaze is 5.81 to 6.67 : 1 in light and 8.11 to 9.34 : 1 in dark. New this iteration: deep glazes for
dark mode, so letter plates no longer glow at night.

### Contrast (WCAG 2.2 ratio, with APCA Lc for reference)

| Pair                                                 | Light          | Dark             | Needs |
| ---------------------------------------------------- | -------------- | ---------------- | ----- |
| Ink on ground                                        | 14.81 (Lc 93)  | 16.40 (Lc 98)    | 4.5   |
| Ink on surface                                       | 17.41 (Lc 104) | 14.42 (Lc 97)    | 4.5   |
| Ink on well                                          | 15.80 (Lc 97)  | 12.34 (Lc 95)    | 4.5   |
| Ink on wash (current step)                           | 14.64 (Lc 92)  | 12.44 (Lc 95)    | 4.5   |
| Slate on ground                                      | 7.61 (Lc 80)   | 11.39 (Lc 75)    | 4.5   |
| Slate on surface                                     | 8.95 (Lc 91)   | 10.02 (Lc 73)    | 4.5   |
| Slate on well                                        | 8.12 (Lc 84)   | 8.57 (Lc 71)     | 4.5   |
| Slate on wash                                        | 7.53 (Lc 79)   | 8.64 (Lc 71)     | 4.5   |
| Label on cobalt (button, current step number)        | 7.45 (Lc 90)   | 9.75 (Lc 67)     | 4.5   |
| Label on glossed cobalt, lightest point behind label | 6.52           | higher than flat | 4.5   |
| Label on ink (selected chip, segment)                | 17.41 (Lc 106) | 14.42 (Lc 95)    | 4.5   |
| Cobalt link on ground                                | 6.34 (Lc 74)   | 9.75 (Lc 66)     | 4.5   |
| Cobalt link on surface                               | 7.45 (Lc 85)   | 8.57 (Lc 64)     | 4.5   |
| Cobalt "Current step" label on wash                  | 6.26 (Lc 73)   | 7.39 (Lc 62)     | 4.5   |
| Cobalt left rule on wash (non-text)                  | 6.26           | 7.39             | 3     |
| Cobalt progress arc on plate (non-text)              | 7.45           | 6.24             | 3     |
| Cobalt button on ground (non-text)                   | 6.34           | 9.75             | 3     |
| Initials on yolk                                     | 9.74 (Lc 67)   | 12.78 (Lc 82)    | 4.5   |
| Star / avatar outline on ground                      | 6.12           | 12.86            | 3     |
| Star / avatar outline on surface                     | 7.20           | 11.31            | 3     |
| Herb on ground / surface                             | 5.33 / 6.26    | 10.21 / 8.97     | 4.5   |
| Amber on ground / surface                            | 5.68 / 6.67    | 10.25 / 9.01     | 4.5   |
| Tomato on ground / surface                           | 5.56 / 6.54    | 9.50 / 8.35      | 4.5   |
| Edge on ground / surface (non-text)                  | 3.68 / 4.33    | 5.32 / 4.68      | 3     |
| Edge on well, switch off (non-text)                  | 3.93           | 4.00             | 3     |
| Edge on wash (non-text)                              | 3.64           | 4.04             | 3     |
| Ticked box: Slate fill on surface (non-text)         | 8.95           | 10.02            | 3     |
| Focus ring: Ink on ground, 2 px offset (non-text)    | 14.81          | 16.40            | 3     |

There are three pairs of decoration, and none of them carries meaning on its own:

- Surface on ground is 1.18 in light and 1.14 in dark, so lists and the sheet always carry a Seam line too.
- The wash and the Seam track are decoration. The cobalt rule, the arc, the filled number and the words carry the
  state.
- The row-plate Seam edge is decoration.

Edge in dark is Lc 35 to 39 in APCA. That is acceptable for a non-text outline at 1.5 to 2 px, and it passes WCAG
3 : 1 everywhere.

### Must not be confused

| Pair             | Light | Dark | What tells them apart                                                                                                                          |
| ---------------- | ----- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cobalt vs Tomato | 1.14  | 1.03 | Blue vs red. Danger always carries the word Delete and an icon.                                                                                |
| Amber vs Tomato  | 1.02  | 1.08 | Hue, plus a warning or error icon and a word.                                                                                                  |
| Yolk vs Amber    | 3.56  | 1.26 | Yolk is only a fill (avatar, star) and never a status.                                                                                         |
| Slate vs Cobalt  | 1.20  | 1.17 | A ticked box is a square with a tick. The current step number is a cobalt circle beside the words "Current step".                              |
| Herb vs Cobalt   | 1.19  | 1.05 | Herb only appears in a success message with an icon. It never fills a control.                                                                 |
| Slate vs Ink     | 1.95  | 1.44 | Muted text is also smaller (14 to 15 px vs 17 px). A selected chip is an Ink pill with a word, and a ticked box is a small square with a tick. |

The last row is a deliberate choice. Dark Slate at `#C3CCDD` buys APCA legibility, and it costs distance from Ink.
Size, weight and position carry the hierarchy, not lightness alone.

## Type

- **Lexend** 600 for titles: screens and recipes at 29 px, sections at 20 px. It is round, open and calm, so it
  carries the shape of the plate into the letters. It is a wide face, and the longest real title ("Miso-Glazed
  Salmon with Sesame Greens") takes two lines at 390 px. Lexend's own reading-fluency claims come from its makers'
  studies, so I lean on its shape, not on those claims.
- **Atkinson Hyperlegible Next** 400 to 700 for reading: body 17 px, the current step 21 px at weight 500, meta 15 px
  and tags 13 px. The Braille Institute designed it "to differentiate characters" for low-vision readers. In a recipe
  that matters: 1 l and I, and 0 and O, are amounts and units (`1 tsp`, `1 l`, `10 g`). Amounts and times use tabular
  figures. Its zero is slashed, so it never looks like O.

## Motion

- On load, the hero plate settles once: 0.7 s, from 6 px above and 2 % larger. It moves transform only, so the first
  frame is complete.
- When you choose a step, the progress ring moves for 0.6 s. At other times it is still.
- A tick draws in 0.15 s, and the switch slides in 0.2 s.
- Nothing loops, and nothing moves while you read. This is the calm-technology idea: the ring sits at the edge of
  attention. If the state changes, it comes forward.
- Under `prefers-reduced-motion`, every transition and animation is off. Nothing depends on motion.

## How it stays distinct

- **Option 1** is a warm lamp in a cool room, with blurred colour fields in rounded squares and Plum for danger.
- **Option 2** has flat cut-out produce in tiles, a Tomato primary, Zest for the current step, and Archivo type.
- **Option 3** has round enamel plates, glazed letters, Cobalt as the action and the progress rim, Ink for what is
  selected, and Lexend with Atkinson type.

## Open risks

- **Photo crop.** A round crop loses the corners of a wide photo. The crop needs a focus point, centred by default and
  movable in the editor.
- **The progress ring is new in this place, though not new in kind.** It depends on "mark step as current", which
  already exists. If the cook never sets a step, the ring stays as a plain Seam track and the words are hidden. It must
  never suggest progress that the cook did not set.
- **The Seam track is decoration.** At 1.39 : 1, the empty part of the ring is not a signal. The words "Step 2 of 5"
  are the accessible statement. If they change, the screen reader announces them politely.
- **Retro risk.** Cobalt and white can drift toward heritage enamel. The guard is still never to add speckles, chips,
  stripes or Delft patterns.
- **"Screen on".** I kept the app's label and its own hint. A rename is the owner's copy decision.

## Sources and what each changed

- Critique 1 (Designer 1) and critique 2 (Designer 2), `iter1/critique_by1.md` and `iter1/critique_by2.md`. Every row
  in the changes table answers one of their points.
- Google Design, "Expressive Design: Google's UX Research",
  https://design.google/library/expressive-material-design-google-research. It covers 46 studies and more than 18,000
  people. Bigger, contained key elements were found up to 4× faster. Unlabelled images were not recognised,
  and "no amount of expressive design will beat basic functionality". This is why there is one big glossy action, why
  every image has a label, and why the ring always comes with words.
- Apple Newsroom, "Apple introduces a delightful and elegant new software design" (June 2025),
  https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/. Its material
  "dynamically reacts … with specular highlights", and its controls "give way to content". This grounds gloss as one
  specular edge on the one control, while everything else stays matte and gives way to the photo.
- Schlintl and Schienle (2020), _Frontiers in Psychology_,
  https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full. With n = 231, blue, red, grey and white
  backgrounds did not change food wanting. This is the evidence behind my pushback on "blue is cold for food".
- Braille Institute, Atkinson Hyperlegible, https://www.brailleinstitute.org/freefont/. The Next version (2025) is
  "designed to improve legibility and readability for individuals with low vision" by differentiating characters.
  This is why it is the reading face. I checked it on Google Fonts by fetching the `css2` URL, which returns live
  `@font-face` rules.
- APCA introduction (Myndex), https://github.com/Myndex/apca-introduction. It gives Lc 75 as the common minimum for
  body text and Lc 60 for other readable text. This is why I lifted Slate in both modes and lightened dark Cobalt,
  Tomato and Amber.
- W3C, Understanding WCAG 2.2 SC 1.4.11 Non-text Contrast,
  https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html. A state mark needs 3 : 1. This is why the
  current step is carried by a 6.26 : 1 rule, not the 1.19 : 1 wash, and why the wash and track are listed as
  decoration.
- W3C, Understanding SC 1.4.1 Use of Color, https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html. This is
  the basis of the "must not be confused" table: every hue-only pair is also told apart by a word, an icon or a shape.
- NN/g, "Flat UI Elements Attract Less Attention and Cause Uncertainty",
  https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/. Weak signifiers cost 22 % more time.
  Together with critique 2, this moved selected states to Ink, so cobalt is never decoration.
- Legge and Bigelow (2011), "Does print size matter for reading?", _Journal of Vision_,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264. The critical print size is about 0.2°, which is why the current
  step went from 16 px to 21 px. I did not claim "across the kitchen": by critique 2's arithmetic, 21 px reads at
  about half a metre, which is counter distance.
- Setproduct, on strikethrough legibility (cited by critique 1),
  https://setproduct.com/blog/strikethrough-text-deserves-more-love-in-ui. This is why ticked lines fade and are not
  struck through.
- Lexend, https://lexend.com/, and Google Design, "Clean and clear: making reading easier with Lexend",
  https://design.google/library/lexend-readability. I read these. Its fluency claims come from its makers, so I do not
  use them as evidence. I chose Lexend for its round form.
