# Option 2: Fresh Cut (iteration 2, final)

Mockup: [`option2.html`](option2.html). It is one file of about 52 KB. I rendered it with Playwright at 390 px and
1400 px. At 390 px the page is 390 px wide, with no horizontal scroll and no console errors. The page computes every
contrast figure on its swatch sheet **from the hex values** (WCAG 2 and APCA 0.0.98G). So the page and this spec
cannot drift apart.

## The idea

Every recipe wears a bold, flat picture of its own ingredients, so even a recipe with no photo looks good to eat. The
app around it is black type on white, like a printed poster, with the lists, tabs and one black button you already
know.

The picture is quietly alive while you cook. When you tick an ingredient, its shape fades in the recipe's picture,
so the picture ends up showing what is still left to use. The picture only shows this: you never tap it.

## Why it is simple

Every control is one people already know: a large title, plain rows with chevrons, a segmented control, a search
field, chips, a stepper, checkboxes, a switch, section tabs, and one black pill. The tab bar is Home, Recipes,
Discover, Plan and Shop.

- **Home.** The date, the greeting and the avatar. Then "Recent recipes" with "See all", the newest recipe as a
  picture with a title row and chevron, and plain rows. Then "Coming soon". **New recipe is docked**: a full-width
  black pill in the bar above the tabs, with a hairline on top. The list scrolls under that bar.
- **Recipe detail, in the app's own order.** I checked this order against `RecipeDetailBody.tsx`:
    1. The picture, with Back and More on solid circles.
    2. Cuisine and visibility, the title and the rating line.
    3. Total, Prep and Difficulty.
    4. **Edit recipe**, then "Screen on" with "Keeps the screen awake while you cook."
    5. The description with More.
    6. The "Recipe sections" switch: Ingredients, Steps, Nutrition.
    7. Ingredients with Servings, then Steps, then Nutrition.
    8. A footer with Source and Version history.
- **My recipes.** The "My recipes / Collections" switch, search, filter chips, "9 recipes", Sort and View, then the
  list. New recipe is docked, the same as on Home.

**Five rules keep it calm.**

1. Text never sits on a picture. The status bar is the only exception, and it takes ink or white, whichever reads
   better on that ground.
2. Produce colours never carry meaning and never touch a control. Every ground is at least ΔE00 12 from every UI
   colour.
3. Only one thing on a screen is a filled black pill.
4. In the controls, red only ever means delete.
5. The picture is never a button.

**How it differs** (both critics ruled that Fresh Cut owns black). Pilot Light is a room lit by one warm light, and
it is moving its button to Spruce green. Enamelware is cobalt on enamel. Fresh Cut has no light, no plates and no
table: it is a poster on pure white, black type, and food in six market colours. Its button is black, and its type
is a wide grotesque that neither of the others uses.

## Changes this iteration

| Feedback                                                                                                        | What I did                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The drumstick reads as a mushroom or an ice-cream cone (1). Draw roast chicken as a whole bird (3)              | **Accepted.** The roast chicken is now a whole bird **from the side**: a domed body on a tray line, a leg along the flank, and a bone with knuckles. My first front-on draft had two legs on top and a highlight curve, and it read as a frowning face, so I discarded it. Cacciatore uses the same bird with an olive.                                                                                              | FHWA: a silhouette works for things with "a very distinct profile" [1]. A side-on roast bird has one. Two legs on top did not.                           |
| The tomato slice reads as pepperoni, and the onion rings as a target (3)                                        | **Accepted.** The tomato is a cut half with three seed chambers and a **green stem and leaves**: no pepperoni has a calyx. The red onion is a **teardrop with a pointed tip**, with its layers following that shape, not circles.                                                                                                                                                                                    | The calyx and the tip are profile cues. They survive at 64 px and in solid black [1].                                                                    |
| Draw the 20-recipe shape test now (1)                                                                           | **Done, in the mockup.** Twenty recipes at list size, each a lead shape plus a second shape, with no pair repeated. I added a **silhouette test**: each lead shape filled solid black. That gives a new rule: **wheels, coins and rings are discs in silhouette, so they can only be second shapes.** Pad Thai therefore leads with noodles, not a lime wheel. The cookie now has a bite out of it.                  | Google: unlabelled images in a test were not recognised [2]. The silhouette test is how I check a shape without its title.                               |
| The silhouette test then found a defect I had not been told about                                               | **Fixed in part.** In black, the onion, garlic and avocado were three alike teardrops. The garlic now has a three-lobed top and roots, and the avocado is asymmetric. **Still open:** the egg, potato and pork slice are plain blobs in black. Their colour and the second shape carry them for now (see open risks).                                                                                                | [1]                                                                                                                                                      |
| The Damson ground is ΔE00 3.8 from the Blueberry links (3)                                                      | **Accepted. I moved the art, not the links.** Damson is gone. **Mint** `#A8E6C8` takes the pancakes and salmon. I then checked every ground against every UI colour, not just this pair. That found two more near-misses: Lemon vs Zest at 7.8 and dark Lemon vs dark Turmeric at 7.4. I fixed both. Now every ground is at least **ΔE00 12.3** from every UI colour, in both modes.                                 | NN/g: "shades of blue provide the strongest signal for links" [3]. So the links keep their blue. Links also stay underlined, as WCAG 1.4.1 requires.     |
| Ticked rows are too close to unticked rows: Clove is only 2.45 from Peppercorn (1, 3)                           | **Accepted.** A ticked row goes to **Husk**, `#6F6D75` in light: 3.6:1 from Peppercorn, and still 5.1:1 on white (Lc 75). Its amount also drops from 700 to 400 and from 16 to 15 px. In dark, Husk equals Clove (Lc 76), because no grey can be quieter and still meet Lc 75 at body size. So in dark, the weight drop and the filled box carry the change. I chose readability over the extra grey step.           | APCA: Lc 75 is the body-text minimum [4].                                                                                                                |
| Dark Zest `#45390F` is olive mud. Lift it toward `#5A4A10` (1)                                                  | **Accepted the diagnosis, chose a different fix.** At low lightness, any yellow turns olive, and `#5A4A10` is still olive. So in dark, lemon stops being a fill and becomes the light. The current step gets a dark warm wash `#25231A` and a **5 px lemon edge** `#FFE27A` (14.7:1 on Board). Its number disc and "Current step" label are lemon too. Its text stays at 22 px and Peppercorn (14.2:1).              | Material, for dark themes: "use the darker spectrum of colors for large parts of the UI… Reserve lighter colors for accents" [5].                        |
| Dark heroes are too saturated (1)                                                                               | **Accepted.** In dark, each ground loses 20% of its chroma (OKLCH) and about 0.1 of lightness. The shapes get `saturate(.8) brightness(.9)`, so a full-chroma shape no longer sits on a muted ground.                                                                                                                                                                                                                | Material: saturated colours "produce optical vibrations against a dark background, which can cause eye strain… use desaturated colors" [5].              |
| "New recipe" floats bottom right, but the spec says docked (3)                                                  | **Accepted.** It is now really docked: full width, in a bar with a hairline above the tabs. The Home and My recipes frames are a true 844 px screen, so the list visibly scrolls under it.                                                                                                                                                                                                                           | Apple: one or two prominent buttons per view [6].                                                                                                        |
| Avatar is "SR" on one screen and "ER" on another. Pancakes take 25 min here but 35 min in the other options (3) | **Fixed.** It is Eliza Ramirez (ER) everywhere, and the pancakes take 35 min, as in options 1 and 3.                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                          |
| Source and Version history sit at the foot, out of the app's order (3)                                          | **Pushed back.** The app puts them in a `<footer>` after Ingredients, Steps, Nutrition and the rating (`RecipeDetailBody.tsx`). **But the check found my own error:** I had put Nutrition above the Ingredients, and I had left out the "Recipe sections" switch. Both are now as in the app.                                                                                                                        | The app source.                                                                                                                                          |
| (Self-found) A proposed string change, "Keep screen awake"                                                      | **Dropped.** The app already says "Screen on" with the hint "Keeps the screen awake while you cook.", so I use that. No new localisation keys are needed for it.                                                                                                                                                                                                                                                     | `features/recipes/src/messages.ts`                                                                                                                       |
| Bold push: hero shapes as tick targets (3), or shapes settling onto a plate as steps are done (1)               | **Partly accepted: the picture reflects ticks but is never tapped.** Ticking an ingredient fades its shape to 22% over 0.35 s, so the picture becomes your mise en place. I declined tap targets on the picture. They are unlabelled and small. They are also a second way to do one thing, so the cook must learn them. I also declined the plate animation: it adds movement on every step for no new information. | Calm technology: "the smallest possible amount of attention" [7]. Unlabelled images go unrecognised [2], and an unlabelled control has the same problem. |
| Dark Rind on Zest was 3.17, close to the line (3)                                                               | **Removed the pair.** In dark, the current step's number disc is lemon and its edge is lemon, so no Rind edge sits on the wash. Controls in the current step use the Peppercorn edge.                                                                                                                                                                                                                                | WCAG 1.4.11, 3:1 [8].                                                                                                                                    |

## Palette: Market White

**Logic.** The interface is black and white. Black is the button you press. Links are blue and underlined. The only
bright colours on a screen are the pictures of food, plus lemon for "you are here" while you cook.

Ratios are WCAG 2.x. Lc is APCA 0.0.98G. Values are given as light · dark. All figures were computed from the hex
values, and the mockup recomputes them live.

### UI colours

| Name       | Role                                                                                                       | Light     | Dark      | Contrast (light · dark)                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------- |
| Board      | Ground                                                                                                     | `#FFFFFF` | `#121114` | n/a                                                                                           |
| Sheet      | Detail sheet, dialogs, dock bar                                                                            | `#FFFFFF` | `#1B1A1E` | Set apart by its radius and a Hair edge, not by contrast                                      |
| Shell      | Fills: search, segment track, tab pill, nutrition cells                                                    | `#F0F1EE` | `#27252B` | Never the only edge of a control                                                              |
| Hair       | Dividers (decorative)                                                                                      | `#E2E4E0` | `#322F37` | No contrast duty                                                                              |
| Peppercorn | Text **and** the primary button                                                                            | `#141317` | `#F5F3EF` | Board 18.5 (Lc 105) · 17.0 (Lc 100). Shell 16.3 · 13.7. Zest / Wash 16.1 · 14.2               |
| On primary | Label on the button                                                                                        | `#FFFFFF` | `#141317` | 18.5 · 16.7                                                                                   |
| Clove      | Muted text                                                                                                 | `#55535C` | `#D2CDD6` | Board 7.6 (Lc 86) · 12.1 (Lc 77). Sheet 7.6 · 11.1 (Lc 76). Shell 6.7 · 9.7                   |
| Husk       | Ticked ingredient text, with weight 400                                                                    | `#6F6D75` | `#D2CDD6` | Board 5.1 (Lc 75) · 12.1 (Lc 77). 3.6:1 from Peppercorn in light. Only ever on Board or Sheet |
| Rind       | Control edges: field, chip, checkbox, step number, switch, stepper, timer                                  | `#767A75` | `#8A8592` | Board 4.4 · 5.2. Sheet 4.4 · 4.8. Shell 3.9 · 4.2 (3:1 needed)                                |
| Blueberry  | Links (always underlined) and the focus ring                                                               | `#3442C2` | `#C4CBFF` | Board 7.8 (Lc 86) · 12.0 (Lc 76). Shell 6.9 · 9.6                                             |
| Zest       | Light: the current-step fill, with a Peppercorn edge and disc. Dark: the current-step edge, disc and label | `#FFF0A0` | `#FFE27A` | Ink on it 16.1 · 14.5. Dark edge on Board 14.7 (3:1 needed)                                   |
| Zest wash  | Dark current-step fill                                                                                     | (Zest)    | `#25231A` | Peppercorn 14.2 (Lc 98). Clove 10.1                                                           |
| Basil      | Success                                                                                                    | `#1C6A45` | `#62D49C` | Board 6.6 · 10.2. Shell 5.8 · 8.2                                                             |
| Turmeric   | Warning, rating star                                                                                       | `#875200` | `#F2B54A` | Board 6.5 · 10.3. Shell 5.7 · 8.3                                                             |
| Paprika    | Danger: delete and erase. Never primary                                                                    | `#C0261A` | `#FF9A8C` | Board 5.9 (Lc 78) · 9.2 (Lc 62). Label on fill: white 5.9 · Peppercorn 9.0                    |

Other pairs:

- **Checkbox.** Unticked, it has a Rind edge: 4.4 · 5.2. Ticked, it is a Peppercorn fill with an On-primary tick:
  18.5 · 16.7.
- **Selected chip.** It gets a 2 px Peppercorn edge on Shell (16.3 · 13.7) plus a tick icon, so the state is never
  shown by colour alone.
- **Section switch.** The current section has a 3 px Peppercorn underline and Peppercorn text. The others are Clove.
- **Focus ring.** Blueberry, 3 px, offset 2 px, so it sits on Board (7.8 · 12.0) and never on the black button.
- **Danger never meets primary.** In dark, Paprika and the warm-white button are only 1.85:1 apart. So danger always
  carries the word and the bin icon, and appears only in delete and erase dialogs and menus.
- **Dark Paprika at Lc 62** is used only for a short label next to an icon, never for body text. The Lc 60 bar for
  non-body text applies.

### Produce colours (picture grounds only)

Each lead shape has one fixed ground, and a recipe takes the ground of its lead shape. The colour belongs to a shape,
never to a dish type, a category or a status. Dark values have 20% less OKLCH chroma and about 0.1 less lightness.

| Name      | Light     | Dark      | Lead shapes          | Status bar (light · dark) | Nearest UI colour, ΔE00 (light · dark) |
| --------- | --------- | --------- | -------------------- | ------------------------- | -------------------------------------- |
| Lemon     | `#FFCB2E` | `#BFAA3C` | tomato, onion        | ink 12.2 · ink 8.0        | Zest 14.2 · Turmeric 12.3              |
| Persimmon | `#F0532F` | `#BD452A` | egg, garlic, leaf    | ink 5.3 · white 5.2       | Paprika 15.0 · Paprika 25.5            |
| Pea       | `#2F9E5E` | `#297B4A` | roast bird, pork     | ink 5.4 · white 5.2       | Basil 19.2 · Basil 27.4                |
| Carrot    | `#FF8C2E` | `#CE7633` | noodles, avocado     | ink 8.0 · ink 5.5         | Turmeric 29.9 · Turmeric 20.2          |
| Beet      | `#B0215F` | `#821645` | loaf, cookie, potato | white 6.5 · white 9.8     | Paprika 22.0 · Paprika 47.2            |
| Mint      | `#A8E6C8` | `#5C8A75` | pancakes, salmon     | ink 13.1 · ink 4.7        | Basil 22.6 · Basil 22.1                |

The closest pair of grounds is Persimmon and Carrot in light (17.6) and Pea and Mint in dark (12.1). Pea and Mint
never carry the same lead shape.

## Type: Archivo, one family

- **Titles:** Archivo 800 at width 118. The large title is 31/32 and the detail title 32/33, with −0.03 em tracking.
  Section heads are 20/24 at width 112. Facts are 19 at width 108, with tabular figures.
- **Reading:** Archivo 400 at normal width. Body text is 17/27. **The current step is 22/31.** Amounts are 700 with
  tabular figures. A ticked amount drops to 400 at 15 px.
- Nothing is smaller than 12 px.
- **Native needs static files.** React Native cannot drive the width axis, and `@expo-google-fonts/archivo` ships
  normal width only. So we cut static instances at widths 118, 112 and 108 with the fontTools instancer. The OFL allows
  this. Both platforms ship them as assets.

## Motion

- When a picture first appears, its shapes settle once: 0.6 s, each starting 70 ms after the last. Nothing loops.
- When you tick an ingredient, its shape fades to 22% over 0.35 s. The cook's own action is the only thing that moves
  it.
- A tick fills in 150 ms, and the switch slides in 200 ms.
- While loading, tiles wait as plain Shell, with no shimmer.
- `prefers-reduced-motion` turns all of it off. The fade then happens instantly, so the information stays.

## Copy

Every string is the app's real copy: "Screen on", "Keeps the screen awake while you cook.", "Recipe sections",
"Ingredients", "Steps", "Nutrition", "Servings", "More", "Version history". The timer chips "20 min" and
"Then 1 h 10 min" are the only new strings. They need keys on web and mobile together.

## Open risks

- **The shape set is still the real cost.** The 20-recipe test passes on one thing: no two thumbnails match. The
  silhouette test only partly passes. The egg, potato and pork slice are blobs in black. Before build, redraw the
  potato with sliced notches and the pork with a fat-rim profile, then run the test again on 40 real recipes.
- **Ingredient-to-shape mapping.** The fade on tick needs every ingredient line mapped to a shape. When a line has no
  shape, nothing fades, and that is safe. Mapping depends on the parsed ingredient name (ADR-0026), so its quality
  follows the parser's.
- **Mixed lists.** A list with some photos and some pictures must still look calm. This is untested.
- **Increase Contrast tokens** are still owed for both modes. Husk is the first candidate: it becomes Clove.

## Sources

1. U.S. Federal Highway Administration, symbol design styles:
   https://www.fhwa.dot.gov/publications/research/safety/03065/04.cfm. Silhouettes suit symbols that "have a very
   distinct profile". Detailed styles are "less recognizable in the sizes necessary for display". **Changed:** the silhouette test, the disc rule for lead shapes, and the redraws of the bird, tomato,
   onion, garlic and avocado.
2. Google Design, Material 3 Expressive research:
   https://design.google/library/expressive-material-design-google-research. Unlabelled images were not recognised.
   **Changed:** a title always sits with a picture, and the picture is never a control.
3. Nielsen Norman Group, "Guidelines for Visualizing Links":
   https://www.nngroup.com/articles/guidelines-for-visualizing-links/. "Shades of blue provide the strongest signal
   for links", and underlines matter for low-vision users. **Changed:** I moved the art off blue, not the links.
4. APCA introduction (Myndex): https://github.com/Myndex/apca-introduction. Lc 75 is the body-text minimum.
   **Changed:** Husk's light value, and the choice to let weight, not grey, carry the ticked state in dark.
5. Android Developers, Material colour (Wear, M2.5):
   https://developer.android.com/design/ui/wear/guides/m2-5/styles/color. "Saturated colors also produce optical
   vibrations against a dark background… use desaturated colors" and "Reserve lighter colors for accents".
   **Changed:** desaturated dark grounds and shapes, and lemon as a dark-mode accent instead of a muddy fill.
6. Apple, Human Interface Guidelines, Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons.
   One or two prominent buttons per view, and red for destructive actions. **Changed:** the docked black New recipe
   button, and Paprika kept to delete only.
7. Amber Case, Principles of Calm Technology: https://calmtech.com/. **Changed:** the fade on tick is driven only by
   the cook's action. I declined the per-step plate animation.
8. W3C, Understanding 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html.
   **Changed:** the dark current step's state cue is a lemon edge at 14.7:1, and no Rind edge sits on the wash.
9. Schlintl and Schienle (2020), Frontiers in Psychology:
   https://www.frontiersin.org/articles/10.3389/fpsyg.2020.589826/full. "Colored backgrounds did not influence food
   wanting." Designer 3 has withdrawn the appetite objection, and Mint replaces Damson for the link-colour reason only.
10. Commise source, `packages/apps/commise/features/recipes/src/detail/RecipeDetailBody.tsx` and
    `src/messages.ts`. **Changed:** the detail order (Nutrition after Steps, the section switch, the footer), and the
    real "Screen on" copy.
