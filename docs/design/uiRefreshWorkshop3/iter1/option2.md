# Option 2: Fresh Cut (iteration 1)

Mockup: [`option2.html`](option2.html). It is one file of about 46 KB. I rendered it with Playwright at 390 px: the
page is 390 px wide with no horizontal scroll, and there are no script errors.

## The idea

Every recipe wears a flat picture of its own ingredients, laid out as on a chopping board. Produce is **cut open**:
a lemon wheel, a tomato slice, carrot coins, onion rings. Prepared food (a drumstick, a pancake stack, a cookie) is a
flat silhouette. So even a recipe with no photo looks good to eat.

All the colour comes from the food. The app itself is black type on pure white, like a printed poster, with the
lists, tabs and buttons you already know. If the cook adds a photo, the photo takes the picture's place.

## Changes this iteration

| Feedback                                                                                              | What I did                                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingredient check-off was missing (critiques 1 and 3)                                                  | **Accepted.** Every ingredient row has a 24 px checkbox in a 44 px target. A ticked row turns muted, with **no strikethrough**.                                                                                                                                                                                                                                                                                | Designer 1 cites strikethrough as hard to re-read at a distance. Apple asks for 44 × 44 pt hit regions [1].                                                                                                          |
| Step numbers did not look pressable (1)                                                               | **Accepted.** Each number is a 44 px disc with a Rind outline (4.4:1).                                                                                                                                                                                                                                                                                                                                         | Weak signifiers cost 22% more time and 25% more fixations [2].                                                                                                                                                       |
| The current step was hard to see from the stove: a 1.13:1 tint and body-size text (3)                 | **Accepted.** The current step is a lemon block with a 5 px ink edge, an ink number disc and "Current step" in words. Its text grows to **22 px**.                                                                                                                                                                                                                                                             | WCAG 1.4.11 asks 3:1 of the visual that shows a state [3]. The ink edge and disc give 14.9:1 (light) and 10.3:1 (dark). 22 px is about a 1.8 mm x-height on a phone, inside the fluent range out to about 0.5 m [4]. |
| Step 4 had one timer for two phases (3)                                                               | **Accepted.** Two timers: "20 min" and "Then 1 h 10 min".                                                                                                                                                                                                                                                                                                                                                      | The step has two phases. The cook must know the time to lower the oven.                                                                                                                                              |
| The Home picture had no affordance (3)                                                                | **Accepted.** The title row under the picture has a chevron, like every other row.                                                                                                                                                                                                                                                                                                                             | Same NN/g finding [2].                                                                                                                                                                                               |
| Clip-art risk: the prawn read as a "C", the berries as badges, two recipes had the same tomato (1, 3) | **Accepted, and it changed the idea.** Produce is now drawn as cut faces (wheels, slices, rings), and prepared food as plain silhouettes. The prawn and the starred berries are gone. Each thumbnail shows **two** shapes, lead plus second. So Soup (tomato + basil on Lemon) and Cacciatore (drumstick + olive on Persimmon) no longer match. Cookies pair a cookie with a chocolate chunk.                  | Google's research found that unlabelled images were not recognised, so the art never stands alone: a title always sits under or beside it [5].                                                                       |
| Tomato (primary) was ΔE 5.6 from Pilot Light's Ember, and Persimmon art competed with it (1, 3)       | **Accepted, fixed at the root.** The primary button is now **ink** (Peppercorn) in light and warm white in dark. No produce colour is near black or white, so no picture can compete with the button.                                                                                                                                                                                                          | Apple: a primary button draws attention by contrast, and you keep prominent buttons to one or two per view [1].                                                                                                      |
| Wine danger was a hue-only split from Tomato (1)                                                      | **Fixed by removing the conflict.** With an ink primary, danger can be a plain red (**Paprika**). Red means delete, as on every platform.                                                                                                                                                                                                                                                                      | Apple: "a destructive button uses the system red color" and must never take the primary role [1].                                                                                                                    |
| Dark muted text was only Lc −58.6 in APCA (1)                                                         | **Accepted, and applied to every text colour.** Dark Clove is now `#D2CDD6` (Lc 77 on the ground) and dark Blueberry `#C4CBFF` (Lc 76). These can be body-size text, so they meet Lc 75. Dark Paprika is `#FF9A8C` (Lc 62): it is only ever a short label with an icon, so the Lc 60 bar for non-body text applies.                                                                                            | APCA: Lc 75 for body text, lower for short spot text [6].                                                                                                                                                            |
| Options 2 and 3 shared Bricolage Grotesque and Figtree (1)                                            | **Accepted. I moved.** Fresh Cut is now set in **Archivo** alone: wide and heavy (width 116, weight 800) for titles, normal width for reading. Wide type is what a poster headline uses, so the letters match the art. Pilot Light and Enamelware can keep their faces.                                                                                                                                        | Archivo has a width axis from 62 to 125 on Google Fonts (checked in the CSS API).                                                                                                                                    |
| Bold push: make the ground true white and let the art be the only colour (3)                          | **Accepted.** The ground is `#FFFFFF`. Lists are plain rows with dividers, not boxes. White is ΔE 5.0 from Pilot Light's Fog and 7.8 from Enamelware's ground.                                                                                                                                                                                                                                                 |                                                                                                                                                                                                                      |
| Purple and blue grounds behind food can hurt appetite (3)                                             | **Partly pushed back.** Plum is gone, because chicken on purple looked wrong. But Damson blue stays under the pancakes. In a controlled study, coloured backgrounds (red, blue, grey) **did not change** how much people wanted the food [7]. Designer 3 also called this point an inference.                                                                                                                  | [7]                                                                                                                                                                                                                  |
| "Flat full-chroma vector produce is 2017–2020 style" (3)                                              | **Pushed back in part.** The fix is the drawing, not flatness: cut faces instead of whole stock objects, two shapes per tile, fixed grounds, and no outlines, stars or faces. In Google's tests, the more expressive designs won **about twice the preference** and up to 170% more on looks [8]. Bold colour is current, not dated. The real risk, a shape set that does not scale, stays an open risk below. | [8]                                                                                                                                                                                                                  |

## Why it is simple

Every control is one people already know: a large title, plain rows with chevrons, a segmented control, a search
field, chips, a stepper, checkboxes, a switch, and one black pill. The tab bar has five tabs: Home, Recipes, Discover,
Plan and Shop.

- **Home.** The date, the greeting and the avatar. Then "Recent recipes" with "See all", the newest recipe as a
  picture with its title row and chevron, and three plain rows. "Coming soon" keeps its real line and three rows
  tagged "Soon". The primary action is **New recipe**, docked above the tabs. The list is padded by the button height
  plus 16 px, so it never covers a row.
- **Recipe detail.** The picture fills the top, and Back and More sit on solid circles. A sheet slides up with the
  cuisine and visibility, the title, the rating, three facts (Total, Prep, Difficulty), a full-width **Edit recipe**
  button and the "Keep screen awake" switch. Then the description, Nutrition, Ingredients with Servings and
  checkboxes, and the numbered steps, with the current one large and lemon.
- **My recipes.** The "My recipes / Collections" switch, search, filter chips, then "9 recipes", Sort and View on one
  line, then the list. The selected chip is shown by a 2 px ink edge and a tick, not by a second black fill. The
  primary action is **New recipe**.
- **Discover, Collections and the editor** use the same parts. A collection's cover is its first four pictures in
  quarters. In the editor the picture redraws as ingredients are added. That is a small delight, and you need to know
  nothing about it.

**Four rules keep it calm.**

1. Text never sits on a picture.
2. Produce colours never carry meaning, and never touch a control.
3. Only one thing on a screen is a filled black pill.
4. In the controls, red only ever means delete.

**How it differs.** Pilot Light is a cool room lit by one warm light. Enamelware is cobalt plates on a blue table.
Fresh Cut has no light, no plates and no table: it is a poster on white, black type and food in six market
colours. Its button is black, not red or blue, and its type is a wide grotesque that neither of the others uses.

## Palette: Market White

**Logic.** The interface is black and white. The black is the button you press. The only bright colours on a screen
are the pictures of food, plus one lemon block for "you are here" while cooking.

Ratios are WCAG 2.x, computed from the hex values. Lc is APCA 0.0.98G. Light · dark.

### UI colours

| Name       | Role                                                               | Light     | Dark      | Contrast (light · dark)                                                                     |
| ---------- | ------------------------------------------------------------------ | --------- | --------- | ------------------------------------------------------------------------------------------- |
| Board      | Ground                                                             | `#FFFFFF` | `#121114` | n/a                                                                                         |
| Sheet      | Detail sheet, dialogs, tab bar                                     | `#FFFFFF` | `#1B1A1E` | On Board 1.00 · 1.09: set apart by its radius and the picture above, never by contrast      |
| Shell      | Fills: search, segment track, tab pill, loading tiles              | `#F0F1EE` | `#27252B` | Never the only edge of a control                                                            |
| Hair       | Dividers (decorative)                                              | `#E2E4E0` | `#322F37` | No contrast duty                                                                            |
| Peppercorn | Text **and** the primary button fill                               | `#141317` | `#F5F3EF` | Board 18.5 (Lc 105) · 17.0 (Lc 100). Shell 16.3 · 13.7. Zest 14.9 · 10.3                    |
| On primary | Label on the primary button                                        | `#FFFFFF` | `#141317` | 18.5 · 16.7                                                                                 |
| Clove      | Muted text                                                         | `#55535C` | `#D2CDD6` | Board 7.6 (Lc 86) · 12.1 (Lc 77). Shell 6.7 · 9.7. Dark Sheet 11.1 (Lc 76). Zest 6.1 · 7.3  |
| Rind       | Control edges: field, chip, checkbox, step number, switch, stepper | `#767A75` | `#8A8592` | Board 4.4 · 5.2. Shell 3.9 · 4.2. Zest 3.5 · 3.2 (3:1 needed)                               |
| Blueberry  | Links (always underlined) and the focus ring                       | `#3442C2` | `#C4CBFF` | Board 7.8 (Lc 86) · 12.0 (Lc 76). Shell 6.9 · 9.6. Zest 6.2 · 7.2                           |
| Zest       | Current-step fill, always with a Peppercorn edge                   | `#FFE680` | `#45390F` | Text on it 14.9 · 10.3. Ink edge and disc 14.9 · 10.3                                       |
| Basil      | Success                                                            | `#1C6A45` | `#62D49C` | Board 6.6 · 10.2. Shell 5.8 · 8.2                                                           |
| Turmeric   | Warning, rating star                                               | `#875200` | `#F2B54A` | Board 6.5 · 10.3. Shell 5.7 · 8.3                                                           |
| Paprika    | Danger: delete, erase. Never primary                               | `#C0261A` | `#FF9A8C` | Board 5.9 (Lc 78) · 9.2 (Lc 62). Shell 5.2 · 7.4. Label on fill: white 5.9 · Peppercorn 9.0 |

Other pairs:

- **Detail wash.** The sheet starts in 8% (light) or 16% (dark) of the picture's ground and fades to Sheet. Over all
  six grounds the worst cases are Clove 6.6, Blueberry 6.8 and Peppercorn 16.2 in light, and Clove 8.3, Blueberry
  8.2 and Peppercorn 11.6 in dark. Everything passes AA.
- **Status bar over a picture.** Peppercorn on Lemon, Persimmon, Pea and Carrot in light (5.3 to 12.8). The detail page's Persimmon gives 5.3. White on Beet
  and Damson (6.5, 6.6). In dark: Peppercorn on Lemon (8.4) and Carrot (5.5). White on the rest (5.1 to 9.5).
- **Checkbox.** Unticked: a Rind edge, 4.4 · 5.2. Ticked: a Peppercorn fill with an On-primary tick, 18.5 · 16.7.
- **Selected chip.** A 2 px Peppercorn edge on Shell (16.3 · 13.7) plus a tick icon, so state is never colour alone.
- **Danger never meets primary.** Paprika is a red and the primary is black. Their contrast is 3.1:1 in light but only
  1.85:1 in dark, where both are light. So the word and the bin icon carry the difference: danger always has both,
  and it appears only in delete and erase dialogs and menus, never beside the primary.

### Produce colours (picture grounds only)

Each lead shape has one fixed ground, the colour it reads best on. A recipe takes the ground of its lead
ingredient's shape, so the drumstick is on Persimmon in both the Cacciatore row and the roast-chicken page. The colour
belongs to a shape, never to a dish type, a category or a status.

| Name      | Light     | Dark      | Ground for these lead shapes (in the mockup) |
| --------- | --------- | --------- | -------------------------------------------- |
| Lemon     | `#FFD23F` | `#D9A814` | Tomato slice                                 |
| Persimmon | `#F0532F` | `#C93A1E` | Drumstick                                    |
| Pea       | `#2F9E5E` | `#237A48` | Salmon fillet                                |
| Carrot    | `#FF8C2E` | `#D96E14` | Lime wheel                                   |
| Beet      | `#B0215F` | `#8A1A4B` | Bread slab, pork slice                       |
| Damson    | `#3D4BD6` | `#2C37A6` | Pancake stack, cookie                        |

Beet is back, because danger is no longer a magenta that looks like it. In dark mode each ground is one shade deeper.
The picture also dims to 92% brightness. So it glows without glare in a dark kitchen.

## Type: Archivo, one family

- **Titles:** Archivo 800 at width 116. Large title 30/32, detail title 31/33, section 20/24 at width 112. Facts 19
  at width 108, tabular figures.
- **Reading:** Archivo 400 at normal width. Body 17/27. The **current step is 22/31**. Amounts are 700 with tabular
  figures.
- Nothing is smaller than 12 px. One family means one set of metrics on web and native.
- **Native needs static files.** The web loads one variable font. React Native cannot drive the width axis, and
  `@expo-google-fonts/archivo` ships normal width only (weights 100 to 900, checked on npm). So we cut static
  instances at widths 116, 112 and 108 with the fontTools instancer. The open font licence allows this. The app
  ships them as assets.

## Motion

Calm technology asks for "the smallest possible amount of attention" [9]. So motion happens once, at the arrival of something new:

- When a picture first appears, its slices settle into place: 0.6 s, each 70 ms after the last. Nothing loops.
- A tick fills in 150 ms. The "Keep screen awake" switch slides in 200 ms.
- While loading, tiles wait as plain Shell, with no shimmer. The picture then fades in once.
- With `prefers-reduced-motion`, all of it is off.

## Copy

- "Screen on" becomes **"Keep screen awake"**. This is a proposed string change. It needs a localisation key update
  on web and mobile together.
- Timer chips read "20 min" and "Then 1 h 10 min". These are new strings and need keys.
- Every other string is the app's real copy, including "Your recipe box is empty" and "Add your first recipe".

## Open risks

- **The shape set is the real cost.** About 40 cut shapes cover most ingredients. Before committing, draw them for 20
  real recipes, and check that no two thumbnails match and each reads at 64 px. Some foods have no clean cut face
  (a whole chicken, pasta), so a few shapes will be whole objects.
- **Unknown ingredients** fall back to a shape from the food family, never to a blank tile.
- **Mixed lists.** A list with some photos and some pictures must still look calm. This is untested.
- **Fresh Cut owns black.** Black is the poster's ink, so the idea depends on it. Designer 3 suggested an ink primary
  for Pilot Light too. In that case the two buttons are only ΔE 7.8 apart. My white is also
  only ΔE 5.0 from its Fog. So the difference then rests on type, art and light alone. I ask Pilot Light to keep its Ember or another accent.
- **The 22 px current step is for arm's length,** not across the room. A later step: the current
  step fills the screen while "Keep screen awake" is on.

## Sources

1. Apple, Human Interface Guidelines, Buttons:
   https://developer.apple.com/design/human-interface-guidelines/buttons. Changed: the black primary, as the one
   prominent button per view. Also red for danger only: "a destructive button uses the system red color". Also 44 pt
   targets for checkboxes, step numbers and timers.
2. Nielsen Norman Group, "Flat UI Elements Attract Less Attention and Cause Uncertainty":
   https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/. Changed: outlined step numbers, the
   chevron under the Home picture, and underlined links.
3. W3C, Understanding 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html.
   Changed: the current step needs a 3:1 cue (the ink edge and disc), not only a pale tint.
4. Legge and Bigelow (2011), "Does print size matter for reading?": https://pmc.ncbi.nlm.nih.gov/articles/PMC3428264.
   The fluent range starts at about 0.2° of x-height. Changed: the 22 px current step.
5. Google Design, Material 3 Expressive research:
   https://design.google/library/expressive-material-design-google-research. Unlabelled images in a test design were not recognised. Changed: a title always sits with a picture, so the art never has to explain itself.
6. APCA introduction (Myndex): https://github.com/Myndex/apca-introduction. Lc 75 is the body-text minimum. Changed:
   dark Clove lifted to Lc 77.
7. Schlintl and Schienle (2020), Frontiers in Psychology, "Effects of Coloring Food Images on the Propensity to Eat":
   https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full. "Colored backgrounds did not influence food
   wanting." Changed: I kept the blue ground and pushed back on the appetite point.
8. Android Developers, "Benefits of expressive design":
   https://developer.android.com/design/ui/wear/guides/get-started/benefits. Expressive variants beat the baseline on
   preference (about 100%) and aesthetics (up to 170%). Changed: I kept the bold colour, and fixed the drawing instead.
9. Amber Case, Principles of Calm Technology: https://calmtech.com/. Changed: motion only on arrival, never looping,
   with no loading shimmer.
