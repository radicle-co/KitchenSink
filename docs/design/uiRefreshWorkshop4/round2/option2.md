# Option 2: Deli Counter (round 2, final)

Designer 2. Mockup: [`option2.html`](option2.html). It is one self-contained file of 72.2 KB (72,244 bytes), with four real home-cooked
photos embedded as small WebP data URIs in the CSS. It is about 2 KB over the 70 KB guide. The photos are 22.5 KB of it.

- **How I checked it.** I rendered it with Playwright at 1400, 390 and 320 px, light and dark, at 100% and 200% text, and
  looked at every frame. No render scrolls sideways. None logs a script error.
- **Why the page and this spec agree.** The palette table in the page is built from the same token list that the palette
  script checks. The build checks two things and fails on a hit: nothing sits on the Pistachio shelf, and Pistachio is not a
  fill anywhere else.
- **What my review is.** Heuristic judgement, untested with users.

## Pick, and why

Deli Counter stays my one option. Both critics found the same fault: the round-1 signature was a card laid over a photo,
with a big price-like time on it. A card over a photo reads as 2016 to 2020, and the time read as money. They were
right, so that signature is gone. What is left is the idea that both critiques asked to keep: real food, stacked in
tiers, on pale pistachio glass.

**The new signature is the shelf.** Each dinner is a tray of food standing on a pistachio shelf edge. The shelf runs the
full width of the screen, past the tray on both sides. The name tag hangs **below** the shelf, so nothing covers the
food. Several shelves are visible at once, and they make the screen look like a deli case, not like a list of cards.

## The idea in two sentences

Your dinners stand in tiers, like trays in a deli case: real home cooking, cropped into the pan, on a pistachio shelf
with its name tag hanging below. Everything you press is the plain tab bar, list, stepper and one prosciutto-red button
you already know.

**Visual thesis (50 ms).** A stranger sees bright food on pale green glass. Thin green shelf lines run edge to edge
and cut it into tiers. Each tier has a white tag below with a wide-set name. Only Commise looks like this. A cook's own
library needs its dinners shown like a counter: the dish, and the time it is ready, read from a step away.

## Changes this round

D1 is Designer 1's critique (`round2/critique_by1.md`). D3 is Designer 3's (`round2/critique_by3.md`).

| Point                                                                                        | Who                         | Answer                                                                | Evidence and change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The time reads as a price: 36 px, raised "pm", bigger than the name                          | D1, D3                      | **Accepted**                                                          | The time is now a 16 px fact line, "Ready by 6:35 pm", with a clock glyph and a full-size "pm". It is smaller than the 22 px name. The big numerals are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A card over a photo band is the 2016 to 2020 overlap card. A coloured top border dates it    | D1, D3                      | **Accepted**                                                          | Nothing overlaps the food. The tray sits on a full-width shelf, and the tag hangs under it. The colour moved from a card border to the shelf, which runs past the tray on both sides. That makes it read as shelving, not as a card stripe. See the prior-art section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Let the food win: taller 16:9 trays, tight crops, the card covers at most 30%                | D1, D3                      | **Accepted, beyond the ask**                                          | The trays are 16:9 (183 px tall at 390, measured), and the card covers 0% of the food. The photos are cropped into the pan, with no plate rim and no table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The photos are restaurant plates with edible flowers, a night out                            | D3 (and me, round 1)        | **Accepted**                                                          | Four new photos from Wikimedia Commons, all home cooking in a home pan or pot: green curry, shakshuka, beef stew and a pea risotto. The dishes are renamed to match the photos. I left out frames with packaging, a floral crock pot, or flash glare. Credits are in the page and below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The primary has no clear owner (14 px above, 20 px below)                                    | D1                          | **Accepted**                                                          | 8 px above and 28 px below, measured in the render at 390 px and again at 320 px with 200% text. The label names the dish: "Cook the green curry".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Olive oil is in step 1 but not in the ingredient list                                        | D1                          | **Accepted**                                                          | The recipe is new to match the photo, and every quantity in the steps adds up to the list. Butter is 15 + 15 = 30 g. Olive oil (2 tbsp), rice (300 g), stock (1.2 litres), peas (200 g), broad beans (200 g) and parmesan (40 g) each appear once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The current step is pink, and pink means error                                               | D1                          | **Accepted**                                                          | The current step uses a Shell ground with a 4 px Prosciutto rule on its left edge. The rule is 10.23:1 on Shell in light and 3.14:1 in dark (it is a non-text mark, so it needs 3:1). Rose is no longer in the palette.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The no-photo field is the loudest colour                                                     | D1, D3                      | **Accepted**                                                          | An empty tray is Shell, with a small Pistachio fork mark. It is quieter than any of the photos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| At 200% text the food shrinks to a strip                                                     | D1, D3                      | **Accepted**                                                          | At 320 px with 200% text the tray keeps 120 px. The tag grows under it. The button is still on the first screen, and 18 px of the next tray shows above the tab bar (measured).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| At 200%, the step column is about 9 characters a line                                        | D3                          | **Accepted, partly fixed**                                            | At large text the step number moves above its text (a container query), so the text has the full width. At 320 px with 200% text that gives about 14 characters a line, up from 9. That is the most a 320 px screen at 34 px type can hold. It is still below 45, and I say so in the self-review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| "Your place is not saved after you close the app" exposes a system gap                       | D1 (D3 praised its honesty) | **Accepted both ways**                                                | The copy now says what the cook gets: "Your place is kept on this phone until you finish." The system must store the place. I record that as a requirement in the data audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| In dark, the pale `#FBD7D7` fill reads as a secondary button                                 | D3 (D1 said keep it)        | **Accepted in direction, with my own value. One premise pushed back** | The dark fill is now `#B84A5A`, a cured red, with a white label (5.04:1, Lc 80). I did not use D3's `#B8364A`. It is only 2.76:1 on Shell, so it fails there as a tick and as the step rule. It is also ΔE00 15.0 from Netflix red, which is the night-out reading. **Pushback on the evidence:** M3's FilledTonalButton uses `secondaryContainer` ([Compose docs](https://kotlinlang.org/api/compose-multiplatform/material3/androidx.compose.material3/-button-defaults/filled-tonal-button-colors.html)). In M3's dark scheme that is a dark tone. The pale fill is M3's dark-mode _primary_, at tone 80. The tone numbers are from recall, not checked. So a pale fill does not mean "secondary" in dark. I still changed the colour, for two other reasons. At chroma 0.040 it read as near-white in my own render. And a red fill makes the button the same object in both themes. Pale rose stays as **Prosciutto text**, for links and timer labels, because text needs the contrast. |
| Two of the three options use a heavy condensed grotesk                                       | D3                          | **Accepted**                                                          | Names and titles are now Archivo **wide** (width 112, weight 720), like the lettering on a shop front. It is now the opposite width from Carton's condensed Bricolage. Rendered with the longest title, "Broad bean and pea risotto with lemon and parmesan", at 320 px and 200% text. The tag name size is capped at 28 px, like the platform caps a large title.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Two of the three actions are red                                                             | D1, D3                      | **Measured, kept**                                                    | Light `#620914` is 19.8 from Carton's `#C41E3A`. Dark: the fill `#B84A5A` is 26.4 from Carton's `#FFA294`, and the text tone is 15.65 from it. In dark, the move to a fill widened the gap from 15.7. Neither critic asked me to leave red (both said keep `#620914`). Red in the set is now two very different reds: near-black ham against bright tomato.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| All three Homes share an outline: title, three dinners with reasons, primary under the first | D1                          | **Kept, with a reason**                                               | That outline is what canon §4 asks for: the deciding state helps choose, gives reasons from stored facts, and has one primary. To break it only to look different is to break the canon for the set's sake. The options differ in what a stranger sees: tiers of food on shelves here, one carton in Option 1, plates flush to an edge in Option 3. The contact sheet below shows this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Original? "No, the composition is the category median"                                       | D3                          | **Answered by the shelf**                                             | The overlapping card is gone. Food tiers, full-width shelf edges and a hanging tag are not the median composition. See the closest-app and prior-art sections, and their limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Not taken:** D1's suggestion to keep the pale pill in dark (reasons above).

## Step 0: point of view, medians and peers

- **My habits, struck at the start:** a regular-width grotesk, one full-bleed hero, a large title then a list, a
  near-white ground with one deep warm accent. Round 1 added one more habit: a card over a photo. That is struck too.
- **Mood.** 6:10 pm, someone asks "what's for dinner?". The cook wants an answer at a glance and a small lift, like a
  well-lit deli case on the way home. A deli is an errand, not a night out. The home-pan photos keep it a weeknight.
- **References.**
    - **The tiered refrigerated cases in a depachika food hall, such as Isetan Shinjuku's B1.** Few designers pick it,
      because it is a shop fixture, not a design object.
    - **Shelf-edge ticket channels:** the coloured strip along the front of a supermarket shelf, with tags clipped below.
      Nobody puts it on a moodboard. That is why it works here.
- **Refusal.** No expressive element in a control, in cook mode, or over food.
- **Category median.** A cream or white ground, a soft serif, a 2×2 card grid with square thumbnails, an orange or
  green accent.
- **House answer (2026).** A near-white ground, one grotesk, a large title, one full-bleed photo, a strict list, one
  deep warm accent.
- **Inversions.** The house answer on dark chrome. The median on a cool white ground.
- **Peer prediction.** A carton or panel object (it came: Carton). Plates against an edge (it came: Food Edge). A big
  "ready by" clock (all three of us did this in round 0).

**Two axes away from the house answer:**

1. **Composition and hero form.** Food trays stacked in tiers on full-width shelf edges, with tags hanging below.
2. **Type genre.** A wide grotesk, like shop-front lettering, for names.

The ground and palette are extra: pistachio glass, not near-white.

## The signature: the shelf

- **What it is.** An 8 px Pistachio band that runs the full width of the screen under each tray of food. The tray, which
  is inset 16 px with 10 px top corners, stands on it. The white name tag, which is inset 16 px, hangs below it.
- **Where it comes from.** The dish and distance. A deli case shows food on shelves, and the name and price are on a
  strip below the food, never on top of it. You read them from a step away.
- **What it encodes.** Nothing. Every shelf is the same colour and size, whatever the dish. Take it away and the tray and
  tag still give the dish, its facts and its time.
- **Where it appears.** Home's tiers, the recipe page's hero, the empty state.
- **Where it is banned.** List rows (My recipes is for comparing, so it stays quiet), every control, cook mode, and
  anything behind text. The build checks that nothing is placed on the shelf.
- **False floor (canon §1.3).** A full-width line can look like the end of the page. Here every shelf has its tag
  directly under it, so content always goes on past the line. No first screen ends on a shelf. At 390 px, Home's first
  screen ends 230 px into the second tray. At 320 px with 200% text it ends 18 px into the second tray (measured). On the
  recipe page the first shelf sits under the hero, with the title tag below it.
- **Real content.** It holds with "Broad bean and pea risotto with lemon and parmesan" at 320 px and 200% text, in
  light and dark. The shelf has a fixed height, so it cannot fall back to a system style.
- **Prior art (searched this round, three web searches).**
    - "Shelf edge label strip under food photo" in recipe UI found nothing. The nearest results were photo-above-title
      recipe cards (Tubik, Motiff).
    - A shelf metaphor in apps found **ShelfLife**, a pantry tracker drawn with skeuomorphic wooden shelves. It is no
      longer on the US App Store. Before that there was iBooks' 2010 wooden bookshelf. **Visible difference:** those draw
      the shelf as a 3D wooden object, with depth and shadow, behind items. Mine is a flat 8 px colour band with no
      texture and no shadow, and the tag hangs below it. The risk is that someone reads "shelf" as 2010 skeuomorphism. The
      flat band and the absence of wood are how I keep that away. Heuristic judgement.
    - **Closest shipping app:** NYT Cooking. **Its nearest feature:** a large photo card with the title beneath.
      **Visible difference:** a full-width colour shelf that crosses the screen under every tray. Several tiers show at
      once, and the name is in a wide face.
    - **Limit:** web searches only, not app-by-app screenshots.
- **Excitement test.** What a viewer screenshots is a Home of home-cooked food in tiers, cut by green shelf lines like a
  deli case. My searches found no shipping app that does this. The search was limited.
- **Trajectory step.** iOS 26 (September 2025) and its redesigned Photos and Camera apps put content first, move
  controls into their own layer, and describe the result as "subtly tactile" (searched:
  [PetaPixel](https://petapixel.com/2025/06/09/apple-redesigns-its-camera-app-with-new-liguid-glass-aesthetic)).
  Airbnb's May 2025 redesign brought back dimensional icons (from recall, not searched). Both move toward food- or
  photo-led screens with physical cues in the look. **One step past:** the physical cue is a piece of shop fixture (the
  shelf), as a flat colour, with no glass and no 3D. It changes no control. It did not ship before 2022, because
  flat-era design removed every hint of a physical setting.

## Frame card

| Screen            | Job, in the cook's words             | Mode                | One primary                                  |
| ----------------- | ------------------------------------ | ------------------- | -------------------------------------------- |
| Home, deciding    | "Help me pick dinner and get going." | planning            | **Cook the green curry**, under the top pick |
| Home, cooking     | "Take me back to where I was."       | cooking             | **Back to step 3**                           |
| Home, nothing yet | "How do I start?"                    | planning            | **Add a recipe**                             |
| Recipe            | "Show me how, then let me cook."     | planning to cooking | **Start cooking** (docked low)               |
| My recipes        | "Find or add one of my recipes."     | planning            | **New recipe** (docked). Search is a field.  |
| Cook mode         | "Next step, hands busy."             | cooking             | **Next step**                                |

- **What a first-time user must understand without learning:** a picture of food with its name is a recipe, and the
  one red button does what it says.
- **Sign of success:** they tap a dish or the button within seconds.
- **Sign of mere prettiness:** they admire the shelves but cannot tell which dinner the button cooks. The button names
  the dish and sits 8 px under its tag.

**Data audit.** It is unchanged from round 1. Sources: `recipe-service/src/recipes/recipes.schema.ts`, `database/schema/*.ts`,
identity's `settings/settings.schema.ts`.

- **Stored on the recipe:** title, cuisine, difficulty, mealType, servings, prep, cook and total minutes, dietary flags,
  ingredients and steps (with `timerSeconds`), the rating aggregate, status, visibility.
- **Not stored:** a cook's own rating (`CANNOT_RATE_OWN_RECIPE`), any "cooked" event, household size.
- **The three reasons** use stored facts only: total time (Quickest), ingredient count (Fewest ingredients) and servings
  (Biggest batch). "Ready by" is the stored total time added to the device clock.
- **Requirement 1:** the cook's place in a recipe (recipe id, step, timers) must be **stored on the device** while
  cooking. The Home cooking state and its copy depend on it. A device draft already exists for the editor (ADR-0057), so
  that is the model to follow.
- **Requirement 2:** the list API sorts only by `updatedAt`, `createdAt` or `title`, and has no `mealType` filter. Home
  needs a dinner filter and three server-side picks. The fallback is to compute the picks over one bounded page.

## List ledger

| List                            | Direction                                                                        | Why                             |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Tonight's three dinners (Home)  | vertical                                                                         | You compare them                |
| Ingredients                     | vertical, with ticks                                                             | A sequence you go through fully |
| Steps                           | vertical                                                                         | A sequence                      |
| My recipes                      | vertical, "Load more · 19 more", with a count                                    | A large collection you scan     |
| Filter chips                    | horizontal, next chip peeking. At large text they collapse to one "Filters" chip | An optional set of peers        |
| Facts (total, prep, difficulty) | one row that stacks at 200%                                                      | Three facts, not a list         |

## Palette: Prosciutto & Pistachio

**The idea.** An Italian deli case: cured ham behind pale green glass, on pistachio shelves. The ground is the glass.
What you press is prosciutto red: near-black in light, a lighter cured red at night. Pistachio is the shelf. The pale
green flatters greens and herbs without tinting them. The red is darker than any dish in light, so it reads as the
button, not as food.

| Name            | Role                                                                                                     | Light     | Dark      |
| --------------- | -------------------------------------------------------------------------------------------------------- | --------- | --------- |
| Case glass      | Ground                                                                                                   | `#E8F0DF` | `#0B110A` |
| Card            | Surface: name tags, lists, sheets, tab bar                                                               | `#FFFFFF` | `#141B12` |
| Shell           | Sunken: segmented track, avatar, skeleton, empty tray                                                    | `#D9E5CE` | `#1C2519` |
| Rail            | Edge: control outlines, unticked boxes                                                                   | `#667A5C` | `#7E8E76` |
| Peppercorn      | Ink                                                                                                      | `#111A0F` | `#EDF3E8` |
| Sage            | Muted, 16 px and up                                                                                      | `#46553F` | `#B3C1AB` |
| Prosciutto      | Action fill and marks: the filled button, ticks, current-tab icon and bar, focus ring, current-step rule | `#620914` | `#B84A5A` |
| Prosciutto text | Action as text: links, timer labels and outlines                                                         | `#620914` | `#FBD7D7` |
| On prosciutto   | Label and tick glyph on the fill                                                                         | `#FFFFFF` | `#FFFFFF` |
| Shell (as wash) | Action wash: selected chip and current step ground. The marker is the Prosciutto rule                    | `#D9E5CE` | `#1C2519` |
| Mustard         | Warning, with a triangle                                                                                 | `#7A5200` | `#EAC15A` |
| Chilli          | Danger, with an octagon. Delete is a text row                                                            | `#B42318` | `#FFA287` |
| Seam            | Hairline                                                                                                 | `#D0DDC5` | `#26311F` |
| Pistachio       | Content hue: the shelf and the empty-tray mark only                                                      | `#9CC45B` | `#7FA046` |

**Why the dark action has two tones.** One role, one meaning ("you can press this"), in two tones. The fill must hold
3:1 against every dark surface and carry a white label. Text needs 4.5:1, which a mid red cannot give on a near-black
ground. M3 makes the same split between its primary and its container colours.

**Script output.** The script uses culori 4 and APCA 0.0.98G, implemented from the constants. It checks itself first
against the canon's On leaf figure (Lc 88, 6.77:1). It exits non-zero on any fail. Final run: **`ALL PASS` (120
checks)**. Text is measured on Case glass, Card and Shell.

| Check                                                       | Light                          | Dark                               |
| ----------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| Ground OKLCH L                                              | 0.94                           | 0.17                               |
| Peppercorn                                                  | 13.62 to 17.82:1, Lc 87 to 105 | 14.0 to 16.92:1, Lc 96 to 98       |
| Sage                                                        | 6.1 to 7.98:1, Lc 70 to 88     | 8.38 to 10.13:1, Lc 64 to 66       |
| Prosciutto text                                             | 10.23 to 13.39:1, Lc 81 to 98  | 11.9 to 14.38:1, Lc 85 to 87       |
| Prosciutto as a mark (ground, card, Shell)                  | 10.23 to 13.39:1               | 3.14 to 3.79:1                     |
| On prosciutto                                               | 13.39:1, Lc 102                | 5.04:1, Lc 80                      |
| Mustard                                                     | 5.29 to 6.92:1, Lc 66 to 84    | 9.24 to 11.17:1, Lc 70 to 72       |
| Chilli                                                      | 5.02 to 6.57:1, Lc 63 to 81    | 8.11 to 9.8:1, Lc 63 to 65         |
| Rail (edges)                                                | 3.56 to 4.66:1                 | 4.53 to 5.48:1                     |
| Peppercorn to Sage                                          | 2.23:1                         | 1.67:1                             |
| ΔE00 Prosciutto to Pistachio / Mustard / Chilli             | 73.7 / 30.1 / 18.3             | 56.1 / 48.5 / 27.9                 |
| ΔE00 Prosciutto text to Pistachio / Mustard / Chilli (dark) |                                | 40.7 / 28.8 / 17.3                 |
| ΔE00 Pistachio to Mustard / Chilli, Mustard to Chilli       | 42.3 / 63.5, 26.1              | 24.0 / 43.5, 26.3                  |
| Prosciutto to Chilli under deuteranopia / protanopia        | 17.5 / 16.5                    | fill 28.8 / 35.1, text 16.0 / 17.5 |
| Both tones vs the five earlier-round actions, minimum       | 47.8                           | 39.2                               |
| vs Carton round 1                                           | 19.8                           | fill 26.4, text 15.65              |
| vs probe v4 Beetroot                                        | 16.4                           | fill 28.3, text 15.8               |
| vs Duck Yolk `#DE9410` (D1's proposal for Food Edge)        | 53.0                           | fill 40.6, text 32.2               |

**Yardsticks (not canon rules):** Netflix red 16.6 (dark fill), Old Glory 17.1, M3 error 17.9, Slack 22.6.

**Difference from the reference Mise.** The light ground moves ΔC 0.02 and is visibly green. The content hue shows at
swatch size. The action is ΔE00 56.8 from Leaf in light and 66.2 in dark.

**Swatch test.** Light reads as "pistachio glass with a near-black red". Dark reads as "forest night with a cured-red
button and a pale rose". They are not "white with one dark accent".

## Type

- **One family:** Archivo, variable width.
- **Wide (112%, weight 720):** large title (30 px, capped at 44), tag names (22 px, capped at 28), recipe title (26 px,
  capped at 32), section heads (22 px). The cap works like the platform's large title, which stops growing at large
  Dynamic Type.
- **Normal width:** sentences, lists, list-row names (17 px, weight 700, kept dense for scanning), facts (16 px).
- **Ready time:** 16 px in the facts line, with a clock glyph. Never bigger than the name.
- **Cook step:** 28/36 at weight 560, with quantities at 800.
- **Tab labels:** 12 to 13 px in Ink, capped like the platform tab bar.
- **Icons in text** are sized in `em`, so they grow with the text.

## Motion

A press scales a button to 98% in 100 ms. A tick fills in 180 ms. Both run only under
`prefers-reduced-motion: no-preference`. Nothing moves at rest.

## Self-review (canon §5), from the renders

- **A. Fresh.**
    - **Year:** wide grotesk names read as 2025 to 26. Flat shelf bands on a pistachio glass ground read as 2026. Home-pan
      photography reads as now (phone photos). Nothing reads as 2015 to 2019, and nothing as a recipe blog.
    - **House answer:** differs on composition (tiers on shelves) and type (wide).
    - **Closest app:** NYT Cooking, with the visible difference above.
    - **Food:** the trays are the largest and most colourful things on Home and the recipe page. Pass.
    - **Signature:** holds at 320 px and 200% text. Pass.
- **B. Distinct.** Contact sheet against the round-1 siblings at thumbnail size (round 2 is blind): one blue carton,
  tiers on shelves, plates flush to an edge. A stranger can tell them apart in 5 seconds by structure. The type is now
  wide against condensed. The palettes pass the swatch test. The action figures are above.
- **C. Simple.**
    - No new interaction in navigation or controls.
    - Every screen answers "where am I" and "how do I get out", through the tab bar or Back.
    - Exactly one filled primary per screen, with a text label, in thumb reach.
    - Each tier is one link. The button sits outside it. Nothing on a tier looks separately tappable.
    - There are no gesture-only actions.
- **D. Psychology.**
    - Lists follow the ledger. "Load more" with a count.
    - Gaps: 28 px between groups, 8 px or less within them (the button to its tier: 8 px).
    - The first screen shows the title, the top dinner, its button and the next tray, at 390 px and at 320 px with 200%
      text (18 px of the next tray shows).
    - A press responds within 100 ms. Delete gives Undo.
- **E. Calm.**
    - **Prosciutto per screen.** Home: the button and the current tab. Recipe: the button, the tab, two ticks, the step
      rule, five timer outlines and one link.
    - One type family. Nothing moves at rest. The weeknight test passes on judgement.
- **F. Cooking.** Cook mode keeps one 28 px step, quantities inline, a timer, a running-timer strip, and labelled 68 px
  Next and Previous. The screen-on chip comes from the cook's tap. Neutral, opaque, no shelf, no photo.
- **G. Accessibility.**
    - The contrast figures are above.
    - Targets are 44 px or more.
    - No sideways scroll at 320 or 390 px, at 100% or 200% text.
    - **States drawn:** deciding, cooking, nothing yet, no photo, loading, offline, error, success.
    - **Fail, recorded:** step text runs about 30 to 36 characters a line at 390 px and about 14 at 320 px with 200%. That
      is below 45. The step number already moves above the text at large text. The rest is the screen's width.
    - **Not done:** copy at its longest localised length.
- **Nielsen.**
    - H1: the cooking state needs the stored place (requirement 1).
    - H4: Edit sits at the top while Start cooking sits low. I accept this, because Edit is rarer.
    - H9: the import-failure screen is not drawn.
- **Contact sheet: four answers.**
    - **Stranger:** three structures (one object, tiers, an edge column).
    - **Year:** 2026.
    - **Family:** not sorted with the house answer, because the shelf lines show at thumbnail size.
    - **Mood:** a weeknight errand, with home pans, not plated food.

## Owner pre-mortem

| Reaction                      | Answer                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Dated."                      | No cream, no overlapping card, no shadow grid. The flat shelf band, wide type and phone photos of home pans read as now. Risk: "shelf" can recall 2010 skeuomorphism. The band is flat and 8 px, with no wood and no shadow. |
| "Twins."                      | Tiers on shelves are unique in the set. The type is now wide against Carton's condensed. The reds are far apart (19.8 light, 26.4 dark).                                                                                     |
| "Too clever."                 | A tray, a line and a tag. Nothing to learn, nothing extra to tap.                                                                                                                                                            |
| "No palette."                 | Full role table, both themes, 120 checks, a swatch strip.                                                                                                                                                                    |
| "Ignores how people scroll."  | Everything is vertical except the chips, which peek and collapse at large text.                                                                                                                                              |
| "Red and green is Christmas." | The light red is near-black (L 0.32) on a pale ground (C 0.020). The dark fill is a muted cured red (C 0.14), not a festive scarlet. Heuristic judgement, untested.                                                          |
| "The photos look amateur."    | They are real phone photos of home cooking, on purpose. At thumbnail size they still read as appetising. A product shoot can do better.                                                                                      |

## Delivery gate

| Cell                                | Deli Counter                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Frame card, data audit, list ledger | Done. Two system requirements named.                                         |
| Sources and strikes                 | Round-0 list, two round-1 strikes, plus the overlap card struck this round   |
| Taste argument, signature tests     | Done at 320 px and 200% text, light and dark                                 |
| Prior-art search                    | Three prior-art searches and one trajectory search this round, limited scope |
| Palette and script output           | `ALL PASS` (120 checks)                                                      |
| Swatch strip                        | Rendered in the page                                                         |
| States                              | Done, except copy at its longest localised length                            |
| Screenshots                         | 1400, 390 light and dark, 320 at 200% light and dark                         |
| Self-review, pre-mortem             | Done, with one recorded fail (line length)                                   |
| Medians, contact sheet              | Written, and made against the round-1 siblings                               |

## Not run, and why

- **Web width layout:** not drawn, to stay near 70 KB.
- **Increase Contrast variants:** not computed.
- **Distance test at 60 and 90 cm:** no device.
- **The siblings' round-2 palettes:** not visible, because the round is blind. I measured against round 1, Carton's
  colours as D3 kept them, and D1's proposed Duck Yolk for Food Edge. My critique (`critique_by2.md`) proposed no new
  action colours.
- **M3 tone numbers:** from recall. The Compose docs confirm only that the tonal button uses `secondaryContainer`.
- **Prior art:** web search only. I did not check app screenshots one by one.
- **Dark cook mode:** drawn in round 1, cut from this file for size. It is the same neutral layout.

## Photo credits

Wikimedia Commons, cropped and compressed: green curry, "Making green curry with shrimp" by Roozitaa (CC BY-SA 4.0).
Shakshuka, "Liat Portal for Foodie Disorder - Shakshuka with Mozzarella" by HaJunkiyada (CC BY-SA 4.0). Beef stew,
"Veal or beef stew" by E4024 (CC BY-SA 4.0). Risotto, "Broad bean and pea risotto" by Blue moon in her eyes (CC BY
2.0).
