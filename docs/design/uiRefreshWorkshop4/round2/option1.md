# Option 1: Carton (round 2, final)

Designer 1. Mockup: [`option1.html`](option1.html), one file of 66.9 KB with one Google Font. Food is painted at
run time on `<canvas>`: one 960 × 600 master per dish, reused by every frame and every crop.

Heuristic judgement, untested with users. Every number below comes from a script run on this round's file or
from its rendered pixels. "390 px" and "320 px" mean the **phone frame** is that wide: I rendered at 422 and 352 px
viewports so the frame is exactly 390 and 320. Round 1 measured at a 390 px viewport, which gave a 358 px phone. Those
numbers were wrong, and none is copied here.

## The idea

Each recipe is packed like good groceries. Its name is printed big on a sky-blue carton. You see the food through
a die-cut window below the name. The facts sit on a dark band at the carton's foot. Around that one carton is the
plainest app you know, so the food and one tomato-red button are the only loud things on the screen.

- **Visual thesis (50 ms).** A white screen crossed edge to edge by one sky-blue pack. It has a heavy printed name,
  a keylined window of food and a near-black band. Under it sits one red button.
- **Why only Commise.** The recipe's content is food, and the name must be big without touching the photo (canon
  §3.4 rule 4). Packaging solved this long ago: the name goes on the box and the food shows through a window.
- **Reference.** The die-cut window on a Barilla blue pasta box, with the cooking time on the front. I took its lesson,
  not its surface: no logo, no oval, no texture. Few designers pick it because it is a supermarket shelf object, not a
  design-history piece.

## Changes this round

### Accepted

| From                                | Point                                                                                                                                                                                                                       | What changed                                                                                                                                                                                                                                                                                                                 | Measured result                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 §1, D3 §3                        | The carton and **Cook this tonight** both opened the recipe, and the play icon promised cook mode.                                                                                                                          | The carton opens the recipe. Its signifier is a chevron at the end of the band. The one primary is now **Start cooking** (pan icon). It opens cook mode at a new **Gather** screen, with the screen kept on. The Gather screen is rendered. It carries the servings stepper, so this path does not skip the scaling control. | Two targets, two destinations, and labels that match them. At 320 px and 200%, the first Gather item starts at y 521, above the buttons at y 723.                                                                                                                           |
| D2 §2, D3 §2                        | In dark mode the facts band (`#EEF2F5`) was the brightest shape on Home.                                                                                                                                                    | The band is its own role, **Nori**: `#11161C` light, `#06090C` dark, with Shelf text. Both themes keep it near-black.                                                                                                                                                                                                        | Dark Home, mean relative luminance from pixels: band **0.052** (round 1 about 0.88), window 0.268 (top decile 0.572), button 0.468. The food has the brightest pixels. The pastel button is still brighter on average, as every dark filled primary is. Stated, not hidden. |
| D3 §4                               | "Tonight" (34/700) competed with the carton name.                                                                                                                                                                           | Home uses an inline nav-bar title: "Tonight" at 20/750 with the date in Muted. The carton name is the one loud line.                                                                                                                                                                                                         | The nav bar is 48 px tall.                                                                                                                                                                                                                                                  |
| D3 push                             | Make the carton edge to edge.                                                                                                                                                                                               | Done on Home, and the recipe page already was. Contact sheet below.                                                                                                                                                                                                                                                          | Window 68,906 px² against blue 55,440 px² (ratio **1.24**) at 390.                                                                                                                                                                                                          |
| D3 set ruling                       | Options 1 and 2 both set the dish name in a heavy condensed grotesk.                                                                                                                                                        | The carton name is now **normal width**, Bricolage at 800 and opsz 96. I rendered 78% and 100% beside Option 2's round-1 Home (Archivo at 75%). 78% sorted with Option 2, and 100% did not.                                                                                                                                  | See the contact sheet.                                                                                                                                                                                                                                                      |
| D3 §5                               | At 200%, My recipes showed no recipe.                                                                                                                                                                                       | Inside the existing container query (phone under 15 em), the switch and chips fold into one **Filter** button. The search label shortens to "Search". Rows wrap so the title gets the full width.                                                                                                                            | 320 px at 200%: the first row starts at y 360, above the dock at y 673. Its title and photo are on the first screen.                                                                                                                                                        |
| D2 §3                               | My recipes was the platform default, and the draft's empty window read as a disabled text field.                                                                                                                            | The large title takes the printed voice, the one screen with no carton. Thumbnails are 80 × 60 tight crops with 4 px corners. The no-photo window is now a die-cut **hole**: a deeper sky with an inner shadow, the Ink keyline, and a faint place setting inside. It is not a white field.                                  |                                                                                                                                                                                                                                                                             |
| D2 §4, D3 §1                        | The food was clip art, and round plates in 76 px rows read as circle crops.                                                                                                                                                 | Six dishes are painted on canvas with layered noise, soft shadows, specular highlights, grain and one top-left light. Rows crop 1.6 to 1.9× into the food, so no rim reads as a circle crop.                                                                                                                                 | See the pushback on real photos.                                                                                                                                                                                                                                            |
| D2 §5                               | The cooking-state footnote ("kept on this phone") raised a worry mid-cook.                                                                                                                                                  | Removed. The limit stays in the data audit. If the place is actually lost, the copy says so then. This is the H2 point I raised against Option 2 in round 1.                                                                                                                                                                 |                                                                                                                                                                                                                                                                             |
| Self                                | At 320 px and 200%, cook mode stacked Previous and Next, which hid the step.                                                                                                                                                | At large text the two buttons stay side by side, labels cap at 24 px, and the chevron icon drops. The labels stay.                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                             |
| D2 §6                               | "Why one layer?" had no signifier.                                                                                                                                                                                          | The summary has a chevron, and the chevron turns on open. The row is 52 px tall.                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                             |
| Self (fault nobody flagged)         | The recipe page showed "You rated it 5" beside **Edit** on the cook's own recipe. The service refuses that (`CANNOT_RATE_OWN_RECIPE`, `recipe-service/src/ratings/ratings.service.ts`). It is the fault I cut Option 3 for. | It now shows "★ 4.8 from 12 cooks · Public recipe" (`averageRating`, `ratingCount`, `visibility`).                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                             |
| Self (round-1 critique of Option 2) | My current step used a pink Tomato wash, and pink rows read as errors.                                                                                                                                                      | The current step now has a Tray ground, a 4 px Tomato rule and "You are here". The selected chip is an Ink fill. Tomato wash is left only as the pressed state.                                                                                                                                                              |                                                                                                                                                                                                                                                                             |

### Pushed back, with evidence

1. **Real photos (D3 §1).** The brief allows CSS, inline SVG or canvas imagery only, so I did not embed photos. Option 2
   embeds WebP through CSS data URIs. I read that as outside the brief. I raised the drawn food to painted canvas
   instead. **Residual:** next to Option 2's real photos, mine still read as rendered. The product shows the cook's own
   photos, so this is a mockup limit, not a design choice.
2. **A Collections shelf of cartons (D2's push).** Not built. The rule that makes Carton calm is **one carton per
   screen** (canon §2.2 rule 1, von Restorff). A two-column grid of same-blue boxes multiplies the signature until it
   is wallpaper. A grid of equal coloured boxes is also the §6.1 card-grid sign. Collections stays a vertical list
   with a count. I gave My recipes its identity through the printed title and the die-cut draft hole instead.
3. **Keep Tomato (D3 set ruling on the shared red).** The critics computed their sibling actions against Tomato's
   hex. D3's proposed Option 2 dark fill `#B8364A` is ΔE00 **30.0** from my dark. Prosciutto `#620914` is 19.8 in
   light. A move now voids both checks. The two reds also read differently: a bright tomato against a deep
   cured oxblood.
4. **The shared Home outline (D1, D3).** "A title, a choice with reasons, one primary under the first dish" is what
   canon §4 asks of every deciding Home. The difference has to live in the hero form. Mine is now an edge-to-edge
   printed pack, against Option 2's photo slices and Option 3's flush plates. The title change also removes the
   large-title convergence.
5. **The flag reading.** Sky `#B9D8F2` is ΔE00 63.6 from flag navy, and the Nori band sits between the blue and the
   red. **Residual:** Tomato is 5.8 from Old Glory Red. It is a taste risk, and I accept it.

### Contact sheet (rendered at 110 px wide, from the final build)

There are six variants, left to right:

1. Edge to edge (shipped).
2. 16 px margins.
3. A plain photo-top card with the same content.
4. A 78% condensed name.
5. Option 2, round 1.
6. Option 3, round 1.

- **Stranger.** Edge to edge reads as one printed wrap across the phone. The margin version reads as a blue card,
  D3's complaint. The plain card is a different pile.
- **Family.** The 78% name sorts with Option 2's Archivo. The 100% name does not.
- **Year.** Each main choice reads as 2025 to 2026.
- **Mood.** A weeknight kitchen.

## Step 0, medians and strikes

This is carried from round 0 and unchanged in substance. The 17 concepts and 16 strikes are in
[`../round0/option1.md`](../round0/option1.md).

- **House answer.** Near-white, one big grotesk title, a full-bleed photo hero, a strict list and one deep warm accent.
- **Inversion.** The same on dark with a glowing accent.
- **Axes Carton moves.**
    1. Where colour lives: a pack of content hue, not the button alone.
    2. Hero form: a name printed on colour above a keylined window with a reversed band, never a bleed photo with a
       title.

## Frame cards

| Screen            | Job (user's words)         | Mode     | One primary                                     |
| ----------------- | -------------------------- | -------- | ----------------------------------------------- |
| Home, deciding    | "What do I make tonight?"  | Planning | **Start cooking** (the carton opens the recipe) |
| Home, cooking     | "Where was I?"             | Cooking  | **Back to step 4**                              |
| Home, nothing yet | "How do I start?"          | Planning | **New recipe**                                  |
| Recipe page       | "Show me how to make this" | Planning | **Start cooking**, docked                       |
| My recipes        | "Find one of mine"         | Planning | **New recipe**, docked                          |
| Cook mode, gather | "Have I got everything?"   | Cooking  | **Next: step 1**                                |
| Cook mode, step   | "What do I do now?"        | Cooking  | **Next step**                                   |

- **Success.** A tap within 5 s, and the cook never scrolls back to the ingredients while cooking.
- **Mere prettiness.** People screenshot the carton but hunt for search.

## Data audit (re-checked this round)

- **A list item carries** (`recipe-core/src/recipe.types.ts`):
    - `totalTimeMinutes`, `servings`, `difficulty`, `mealType`, `cuisine`
    - `dietaryFlags`, `tags`
    - `averageRating`, `ratingCount`
    - `visibility`, `status`, `sourceAttribution`
- **On detail reads only:** `viewerRating`. It is never present on your own recipe.
- **Not stored:** cook or view history, pantry, plan, shopping list and household. The cook's place in a recipe lives
  on the device.
- **Sort:** `RECIPE_LIST_SORT_BY` is `updatedAt`, `createdAt` and `title` only. So "your quickest" and "your biggest"
  are computed by the client over the pages it holds. Beyond one page, this is a recipe-service contract change.
- **Home says only:**
    - "Your quickest dinner"
    - "Serves 6 · your biggest"
    - "Easy · vegetarian"
    - "Cooking now · Step 4 of 7".

## List ledger

| List                           | Direction                              | Reason                                                         |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| Home choices (carton + 2 rows) | Vertical                               | A short choice. All three are above the tabs at 390 and at 320 |
| Ingredients, Gather            | Vertical, ticks                        | A sequence you go through fully                                |
| Steps                          | Vertical, current step marked          | A sequence, with quantities inline                             |
| Nutrition                      | Vertical                               | Read fully                                                     |
| My recipes, Collections        | Vertical, count, sort, **Show 4 more** | Large, scanned and compared                                    |
| Filter chips                   | Horizontal, next chip peeks            | Optional peers. At large text they fold into Filter            |
| Cook mode                      | One step, Previous and Next            | Not a list                                                     |

## Signature

- **What it is.** The die-cut window: the food seen through a keylined window in the carton, with the name printed on
  the carton.
- **Where it appears.** The Home carton, the recipe page header, first run, loading, and the no-photo hole.
- **Where it is banned.** Cook mode, every control, list rows except the empty hole, and behind body text.
- **What it encodes.** Nothing. The carton is always the same blue, and every fact on the band also appears on the
  recipe page in words. The window moves first at large text, and that carries no meaning.
- **Survival.** I tested the longest title, "Miso-glazed salmon with sesame greens", at 320 px and 200%. The window
  stays keylined and the name stays on colour, in three lines at 36 px or less.
- **Prior art.** Run this round with WebSearch. No source describes a name on a solid panel above a framed photo
  window. The closest is a hero card with the name overlaid on the photo
  ([Motiff](https://motiff.com/use-cases/427165792765831/gourmet-recipe-studio-mobile-app),
  [Kombai](https://kombai.com/gallery/app-pages/recipe-detail-ios-24/)). Carton never puts text on the image. Round
  1's closest shipping feature still stands: the Apple Music track list, with colour taken from the art. Its colour
  changes and its title sits beside the art. Searches return text, not screenshots, so this is partly verified.
- **Trajectory.** Content becomes an object while controls step back (Airbnb 2025, Liquid Glass, M3 Expressive). The
  step past them: the object is an honest flat printed pack, not glass or 3D. No control changes.

## Palette: "Carton"

**Idea.** A white shelf, one sky-blue carton with a nori-black band, and one tomato. Blue sits opposite the browns,
reds and golds of cooked food, so the dish reads warmer. Tomato is the only colour you can press.

| Role        | Name        | Use                                                                        | Light     | Dark      |
| ----------- | ----------- | -------------------------------------------------------------------------- | --------- | --------- |
| Ground      | Shelf       | Page                                                                       | `#FFFFFF` | `#0E1216` |
| Surface     | Board       | Tab bar, dock, sheets                                                      | `#FFFFFF` | `#161B21` |
| Sunken      | Tray        | Search, segment track, timer strip, current step                           | `#EDF1F4` | `#1F262D` |
| Edge        | Rule        | Control outlines, unticked boxes                                           | `#6E7A86` | `#7D8893` |
| Ink         | Squid ink   | All text, the keyline, the selected chip fill                              | `#11161C` | `#EEF2F5` |
| Muted       | Pepper      | Secondary text, 16 px and up                                               | `#4A5560` | `#AEB8C2` |
| Action      | Tomato      | The one filled button, links, ticks, current tab icon, step rule, focus    | `#C41E3A` | `#FFA294` |
| On action   | On tomato   | Label on Tomato                                                            | `#FFFFFF` | `#2A0606` |
| Action wash | Tomato wash | Pressed state only (decoration)                                            | `#FCE6E8` | `#33181A` |
| Warning     | Mustard     | Short labels with an icon                                                  | `#855400` | `#F2C14E` |
| Danger      | Radicchio   | Delete, text with an icon, never a fill                                    | `#8F1D63` | `#F2A6F0` |
| Hairline    | Seam        | Dividers only                                                              | `#DDE3E8` | `#2A3239` |
| Content hue | Sky carton  | The carton only. Its deep tint `#86AED2` / `#132A40` fills an empty window | `#B9D8F2` | `#21405E` |
| Band (new)  | Nori        | The facts band, near-black in both themes                                  | `#11161C` | `#06090C` |

**Check script.** `scratchpad/f2/check2.mjs` uses culori with my APCA 0.0.98G. It fails loudly on any miss.
**Output: 0 fails, exit 0.** The page's palette sheet recomputes the same numbers from its CSS tokens.

| Pair                      | Light                  | Dark                       |
| ------------------------- | ---------------------- | -------------------------- |
| Ink on Shelf, Board, Tray | 16.0–18.2:1, Lc 96–105 | 13.6–16.7:1, Lc 96–98      |
| Muted                     | 6.7–7.6:1, Lc 78–87    | 7.6–9.3:1, Lc 60.3–62.7    |
| Ink to Muted              | **2.39**               | **1.79**                   |
| Tomato as text            | 5.1–5.8:1, Lc 69–77    | 7.9–9.7:1, Lc 63–65        |
| On tomato                 | 5.84:1, Lc 83          | 9.62:1, Lc 66              |
| Mustard                   | 5.7–6.4:1, Lc 73–82    | 9.1–11.2:1, Lc 70–73       |
| Radicchio                 | 7.3–8.3:1, Lc 79–87    | 8.4–10.3:1, Lc 66–68       |
| Ink on carton             | 12.3:1, Lc 80          | 9.5:1, Lc 90               |
| Band text on Nori         | 18.2:1, Lc 107         | 17.7:1, Lc 99              |
| Nori against carton       | 12.3:1                 | 1.86:1 (a separate region) |
| Rule on Shelf / Tray      | 4.38 / 3.86:1          | 5.21 / 4.23:1              |

**Roles inside the palette (ΔE00), light then dark.**

- Action to carton: 54.3 / 59.9
- Action to warning: 31.3 / 30.2
- Action to danger: 20.7 / 25.6
- Carton to warning: 52.7 / 67.2
- Carton to danger: 56.8 / 56.2
- Warning to danger: 44.3 / 54.6

**Action against earlier-round actions.** From 44.8 to 68.1 against all five, in both themes.

**Action against this round's siblings.**

| Sibling action                     | ΔE00                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Prosciutto `#620914` (light)       | 19.8                                                                                |
| Duck Yolk `#DE9410` (light / dark) | 42.3 / 27.0                                                                         |
| Option 2 dark fill `#B8364A`       | 30.0                                                                                |
| Prosciutto dark `#FBD7D7`          | 15.7, a pass by a hair. With `#B8364A` as Option 2's dark fill, the figure is 30.0. |

**Grounds.** Light L 1.000. Dark L 0.180, C 0.010. The ground is plain white on purpose, so the palette is not Mise
with a new accent: the content hue is visible at swatch size.

## Type

There is one family, Bricolage Grotesque, in two voices.

| Style     | Size                      | Weight                            | Use                           |
| --------- | ------------------------- | --------------------------------- | ----------------------------- |
| Printed   | 33 Home, 37 recipe, ×0.98 | 800, opsz 96, normal width, −2.5% | Carton name, My recipes title |
| Nav title | 20                        | 750                               | Tonight                       |
| Section   | 22                        | 750                               | Ingredients, Steps            |
| Cook step | 28 / 1.3                  | 600, quantities 800               | Cook mode                     |
| Gather    | 22 / 1.3                  | 600, quantities 800               | Cook mode, gather             |
| Body      | 17 / 1.45                 | 400                               | Everything read               |
| Secondary | 16                        | 400, Muted                        | Meta                          |
| Label     | 13                        | 750, Ink only                     | Group labels, tags            |

- **Scaling.** Display sizes grow at half rate and cap at 42 and 48 px.
- **Radii.** Carton 0, window 18, controls 14, thumbnails 4.

## Motion

- Nothing moves at rest.
- A press scales to 98% in 100 ms.
- A tick fills in 180 ms.
- The "Why" chevron turns in 200 ms.
- **Specified, not built:** the carton grows into the recipe page's carton as a shared element, on a 300 ms spring
  at 100% damping. It becomes a cross-fade under Reduce Motion.
- Every transition is off under `prefers-reduced-motion`.

## Self-review (canon §5, from this round's renders)

- **A. Fresh: pass.**
    - The year for each main choice is 2025 to 2026.
    - The two axes are named, and so are the closest app and the trajectory.
    - Food is the largest area at 390: ratio 1.24.
    - **Limit:** at 320 px, window and blue are about equal (44,100 against 45,406 px²).
    - The signature survives 320 px at 200%.
- **B. Distinct: pass.**
    - Structure separates on the contact sheet.
    - The type now separates from Option 2.
    - Every ΔE00 figure is above.
- **C. Simple: pass.**
    - The list of new interactions is empty.
    - There is one filled primary per screen, low, with a label.
    - The carton and the button now go to different places, and each target does one thing. The band chevron is part
      of the carton's single link.
- **D. Psychology: pass.**
    - At 390, row 2 ends at y 757, above the tabs at y 762. At 320, it ends at y 756.
    - Recipe page: Ingredients ends at y 726, above the dock at y 768 (390). At 320, it ends at y 817, under the dock.
      **Limit:** the stepper wraps.
    - Proximity: the button sits 10 px under the carton and 24 px above the next group (2.4×).
    - Show 4 more, with a count. Undo on delete.
- **E. Calm: pass.**
    - Tomato appears only on the primary, links, ticks, the current-tab icon, the timers and the current-step rule.
    - Nothing idles.
    - One family.
- **F. Cooking: pass.**
    - The step is 28 px with inline quantities, and the timers are buttons.
    - Previous and Next are 72 px, fixed and labelled.
    - Screen-on is shown in words and switched on by the cook's tap.
    - Cook mode has no glass and no photo.
    - Home is shown deciding, cooking and empty, with stored facts only.
- **G. Accessibility: pass.**
    - Every pair is measured.
    - Colour is never the only cue: ticks also strike through, and the current step has words.
    - A Playwright scan found no target under 44 px. The one exception is the inline "Try again" link in a sentence,
      which WCAG 2.5.8 exempts.
    - `scrollWidth` equals the viewport at 1400, 390, 320, and 390 and 320 at 200%.
    - The states are drawn.

### Nielsen's 10

- **H4, fixed.** Two targets with one destination.
- **H8, fixed.** Two headlines.
- **H2, fixed.** System-limit copy mid-cook.
- **H1, fixed.** A rating that cannot exist.
- **Residual H6:** the pressed state uses Tomato wash, which is pink. It shows for 100 ms only.

## Owner pre-mortem

- **"Dated."** There is no paper, serif, shadowed card grid or clip art.
    - **Residual:** the painted food is not a photo.
- **"Twins."** Edge-to-edge pack, normal-width type and a near-black band separate it from Option 2.
- **"Too clever."** Nothing to learn.
- **"No palette."** A full table and script.
- **"Ignores scrolling."** See the ledger.
- **"A coloured header, like Apple Music."**
    - **Cause:** full-width colour.
    - **Fix:** the keylined window and the band are packaging grammar, and the colour never changes per dish.
    - **Residual:** a taste call.

## Delivery gate

| Option | Frame card | Data audit | Ledger | Sources and strikes | Taste | Signature tests | Prior art               | Palette script | Swatch strip             | States            | Screenshots                | Self-review    | Pre-mortem |
| ------ | ---------- | ---------- | ------ | ------------------- | ----- | --------------- | ----------------------- | -------------- | ------------------------ | ----------------- | -------------------------- | -------------- | ---------- |
| Carton | Done       | Re-checked | Done   | 17 / 16 (round 0)   | Done  | 320 px, 200%    | 1 new search, text only | 0 fails        | In the page, both themes | 6 + gather + step | 1400, 390, 320, 200%, dark | Done, 3 limits | Done       |

## Not run, and why

- **Real photography.** Outside the brief's imagery rule.
- **Device text settings.** 200% was emulated with the root font size.
- **Distance tests at 60 and 90 cm, Increase Contrast and colour-blind simulation.**
- **Siblings' round-2 files.** They did not exist while I worked. I report against their stated and proposed actions.
- **Web width, Discover and the editor.** Outside the sample.
- **User evidence.** This review is inspection only.
