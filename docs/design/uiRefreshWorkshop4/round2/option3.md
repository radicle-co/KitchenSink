# Option 3: Food Edge, round 2 (final)

Designer 3. Mockup: [`option3.html`](option3.html), one file of 65.9 KB. I rendered every frame with Playwright at
1400, 390 and 320 px, at 100% and with a real `html{font-size:200%}`, in light and dark. The page shows no script
errors and does not scroll sideways at any of those sizes. A DOM scan at 320 px and 200% found no element wider than
its box.

Heuristic judgement, untested with users.

## The idea in two sentences

Each dish sits square against the edge of the screen, like the plate in a field guide, and its words face it across
clear space. You choose dinner by looking at the food, then confirm by reading one line.

**Palette: Stainless & Duck Yolk.** The cool grey of a kitchen sink makes the food the warmest thing on screen. The
deep orange of a duck-egg yolk marks the one thing to press.

## Changes this round

D1 is Designer 1's critique and D2 is Designer 2's. Every point is listed.

| #            | Critique point                                                                                                                       | Verdict                                                            | What changed, or why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1-1         | "You gave it 5 stars" is impossible, because an owner cannot rate their own recipe (`CANNOT_RATE_OWN_RECIPE`).                       | **Accepted.**                                                      | Removed. Every reason is now a field on the list item, plus the clock and one collection read. See the data audit.                                                                                                                                                                                                                                                                                                                                                                                                 |
| D1-2, D2-2   | The food is drawn, so you cannot choose by looking.                                                                                  | **Accepted. This was the largest fault.**                          | There are five real home-cooked photos from Wikimedia Commons, each showing its vessel: a pan on the hob, a steel bowl, a white bowl. Each is encoded once as a WebP data URI, 3 to 8 KB, and reused by class. The licences are credited on the page and below.                                                                                                                                                                                                                                                    |
| D1-3         | Yolk `#F3C324` is ΔE00 2.5 from Bumble, and grey with yellow is Pantone 2021.                                                        | **Accepted.**                                                      | The action is now Duck yolk `#F8AC5E`: 15.2 from last round's Yolk, 14.1 from Bumble and 21.9 from Illuminating.                                                                                                                                                                                                                                                                                                                                                                                                   |
| D1 direction | Use `#DE9410` as the fill.                                                                                                           | **Pushed back with a number.**                                     | Ink on `#DE9410` measures APCA **Lc 54**, below the canon's Lc 60 for a short label. D1 quoted only the WCAG 7.28:1. A dark label needs a fill at OKLCH L 0.76 or higher. I swept that band: every confident yolk there lies within about 6 to 10 of Amazon's Buy Now `#FFA41C` or iOS orange `#FF9500`. Duck yolk is 6.6 from Amazon. I state this as a residual risk instead of hiding it. The button is a flat 14 px-radius block on steel, not Amazon's full pill, and it carries a play icon and a dish name. |
| D1-4         | The current tab relies on a 1.66:1 pill.                                                                                             | **Accepted.**                                                      | The pill is gone. The current tab has a filled icon in Burnt yolk (7.0:1 light, 8.9:1 dark) and a 600-weight Ink label. The other tabs have outline icons in Pewter. Shape and weight both mark the state.                                                                                                                                                                                                                                                                                                         |
| D1-5, D2-3   | The primary has no clear owner and sits mid-screen.                                                                                  | **Accepted in substance. I chose the dock over the 8/28 spacing.** | The button is docked above the tabs and labelled **"Cook shakshuka"**. The label names its owner, so it no longer depends on proximity. Docking puts it low in reach, and it now sits where Recipe and My recipes put their primaries (H4). It clears the tabs by 12 px at 390 and 320 px, at 100% and 200%, measured.                                                                                                                                                                                             |
| D1-6         | The white strips vanish in dark (1.11:1).                                                                                            | **Accepted, through D2's push.**                                   | Home's picks now sit straight on the ground, with no strips at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D1-7, D2-6   | The first-run "+" tile is a false signifier.                                                                                         | **Accepted.**                                                      | Removed. First run has plain text, a real Discover pick (a link that opens the recipe) and the docked "Add a recipe".                                                                                                                                                                                                                                                                                                                                                                                              |
| D1-8         | "Picks for tonight start at three" can read as 3 o'clock.                                                                            | **Accepted.**                                                      | The copy is now "Add three dinners you cook often. Home will then show which one is ready soonest tonight."                                                                                                                                                                                                                                                                                                                                                                                                        |
| D1-9, D2-7   | Delete sits low, and Edit sits about 1700 px down.                                                                                   | **Accepted.**                                                      | **Edit** is a labelled button in the top bar. Delete, Share and Add to a collection are in the **···** menu at the top. The page foot now holds only provenance.                                                                                                                                                                                                                                                                                                                                                   |
| D2-1         | The "Ready by" maths contradicts the stated times, and two reasons are not on a list read.                                           | **Accepted.**                                                      | At 6:12 the times are 25, 30 and 35 min, giving 6:37, 6:42 and 6:47, sorted in that order under "Tonight, quickest first". The library uses the same minutes. The recipe page at 6:13 says 6:38.                                                                                                                                                                                                                                                                                                                   |
| D2-4         | It fails the closest-app test: Apple Notes (yellow on grouped grey), the M3 pill indicator, and a media row with its margin removed. | **Accepted.**                                                      | No grouped white rows on Home, no yellow, no pill indicator. The plate is now 44% wide and runs the full height of its pair.                                                                                                                                                                                                                                                                                                                                                                                       |
| D2-5         | At 320 px and 200% the plate becomes an 80 px banner and the button touches the tabs.                                                | **Accepted.**                                                      | At large text the plate stacks above its words at 84% width and **200 px** tall. Measured at 320 px and 200%: plate 242 × 200, and the dock's bottom (749) sits 12 px above the tabs (761).                                                                                                                                                                                                                                                                                                                        |
| D2-8         | The cooking state shows "Three for tonight" with only one pick.                                                                      | **Accepted.**                                                      | The cooking state shows only "Cooking now": the dish, the running timer and "Back to step 4".                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D2 push      | Remove the white rows, plates at 50%, full pair height, 12 px gap inside a pair and 28 px between pairs.                             | **Accepted, with one change.**                                     | The plate is 44%, not 50%. At 50%, the caption column at 390 px was too narrow for "Ready by 6:37 pm" (render 1). It now breaks only between "Ready by" and the time. Plate to words is 14 px and pair to pair is 28 px, a 2× ratio.                                                                                                                                                                                                                                                                               |
| D2 note      | My sibling table misquoted Option 2's dark action as `#FFD7CF`.                                                                      | **Accepted.**                                                      | Corrected to `#FBD7D7`. Duck yolk is 24.5 from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D1 direction | Crop real photos close so the food meets the edge.                                                                                   | **Accepted.**                                                      | Each crop is tight on the dish, and the vessel's rim stays in frame so the dish can be named.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Own finding  | Tab labels were Pewter at 12 px in my first render, against canon §3.4 rule 7.                                                       | **Fixed.**                                                         | All tab labels are Ink. The state is shown by a filled Burnt yolk icon against outline Pewter icons, and by weight 600.                                                                                                                                                                                                                                                                                                                                                                                            |
| Own finding  | Cook mode and Home's cooking state, both at 6:31, showed different running timers.                                                   | **Fixed.**                                                         | Both show "Eggs · 5:42 left". Step 4 says its timer is running instead of offering to start it again.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Own finding  | The cook-mode step text sat under its fixed bar at 200%.                                                                             | **Fixed.**                                                         | The cook-mode top bar and the bottom control bar keep fixed sizes (16 to 19 px), as the tab bar does, following iOS's large-content-viewer pattern. The step text scales. At 390 px and 200% the whole step shows. At 320 px and 200% it scrolls between the fixed bars (residual).                                                                                                                                                                                                                                |

## Step 0: point of view

- **Habits.**
    - Type: a neutral grotesk.
    - Food: plated, seen from above.
    - Composition: title, then hero, then list.
    - Colour: one saturated accent on near-white.
    - Round 1 gave in to the last one with a yellow that turned out to be someone else's brand.
- **Mood.** It is 6 pm on a Tuesday. The cook is at the open fridge while someone asks "what's for dinner?". They want
  to see three answers, each with a reason, and press one button.
- **Reference 1: Roger Tory Peterson, _A Field Guide to the Birds_ (1934).**
    - You identify by the plate, then confirm with short facing text.
    - It is a naturalist's tool, and it is absent from UI moodboards.
    - It feeds the composition only.
- **Reference 2: Laura Letinsky, _Hardly More Than Ever_ (1997 to 2004).**
    - Meal remains on cool, pale tables, where the only colour is the food.
    - Photographers know it. Interface designers rarely cite it.
    - It feeds the ground and light only.
- **Refusal.** No circles, rims or plates drawn as a motif, no glow, no colour on a photo. A vessel inside a real photo
  is content, not motif.

**The medians, struck.**

1. **Category median:** a white ground, rounded card grid, an orange or green accent and "What's cooking?".
2. **House answer:** a near-neutral ground, a large grotesk title, a full-bleed photo hero, then a strict list of
   small rounded thumbnails, with one deep warm accent.
3. **Inversions:** both of the above on a dark, moody ground.
4. **Peer predictions:** a time question on Home, a wash taken from the dish, big time numerals, an editorial photo with
   type cropped at the edge, a pack or label ornament. Carton (the label) and Deli Counter (the numerals) both landed.

## Diverge

I kept round 0's 14 concepts and their strikes (chord swatches, cut-out dishes, crinkle crops, margin numerals, a
"Tonight" board, a diptych, frost panels).

This round's new palette concepts:

| Concept                                                     | Need, and source      | Verdict                                                                                                         |
| ----------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| D1's `#DE9410` duck yolk                                    | The dish              | Struck: Lc 54 with an Ink label                                                                                 |
| A bright marigold `#F29B1D`                                 | The dish              | Struck: 2.8 from Amazon Buy Now, 3.8 from iOS orange                                                            |
| A deep amber fill with a white label                        | The dish              | Struck: ΔE00 about 5 from Mise's Amber and from Pimentón. It reads as the canon's warning colour and is earthy. |
| A low-chroma peach `#F7C49B`                                | The dish              | Struck: 15 from every brand, but too timid to mark the one action                                               |
| **Duck yolk `#F8AC5E`, with Burnt yolk `#864A00` for text** | The dish (a duck egg) | **Kept**: Lc 67 with an Ink label, the farthest confident point from Bumble and Notes                           |

Food Edge differs from the house answer on two axes:

- **Composition.** Square plates sit flush to the left edge at 44% width and the full height of their words, with no
  card, strip or inset thumbnail. The house answer is a top hero band over small rounded thumbnails.
- **Palette and ground.** A mid-grey steel ground and an orange-yolk action, against near-white and a deep warm accent.

## Taste argument

**Visual thesis (the first 50 ms).** A stranger sees a cool grey screen. Real food runs down its left edge, the words
face it, and one yolk-orange button sits at the bottom. Only Commise looks like this because the plate-and-caption
pair is how a cook chooses: by the look of the food, then by one line of fact.

**Trajectory step.** Three recent designs push content to the edge and let imagery carry identity:

- iOS 26 (2025): content runs edge to edge, with controls in their own layer.
- Material 3 Expressive (2025): bolder containers and type.
- Airbnb's 2025 redesign: image-led and tactile.

Food Edge goes one step past them. The photo reaches the screen edge inside an ordinary list, with no container at all,
and the controls stay standard.

**Mood test.** A steel sink, a hob, a duck egg. Nothing glows and nothing moves at rest. It reads as a weeknight
kitchen.

**Signature: the food edge.**

- **Placed:**
    - Home picks: plates 44% wide, 184 to 237 px tall.
    - The cooking card.
    - The first-run Discover pick.
    - The recipe hero: 62% wide, 300 px tall, facing the facts.
    - My recipes, as 88 px squares.
- **Banned:** cook mode, the ingredient and step lists, every control, sheets and the palette sheet.
- **Encodes nothing.** Each plate is the recipe's own photo. Name, time and reason are words beside it.
- **Survival, rendered:**
    - At 320 px, the longest title, "Green curry with chicken and Thai basil", gives a 127 × 207 plate.
    - At 200% text the plate stacks at 84% width and 200 px tall, still flush left and square.

## Prior-art search (WebSearch, run this round)

- "recipe app orange primary button grey background 2025": no shipping recipe app pairs an orange action with a steel
  ground. The galleries return rounded card grids ([screensdesign](https://screensdesign.com/articles/recipe-app-design-examples/)).
- "Amazon Buy Now button colour": third-party design-system pages list `#FFA41C` for Buy Now and `#FFD814` for Add to
  Cart ([oppadu](https://www.oppadu.com/tools/design-systems-site/brand/amazon.html),
  [webdesignhot](https://www.webdesignhot.com/design.md/amazon/)). This confirmed the residual risk above.
- "recipe list, large half-width photo, flush left, square": nothing matched. The nearest is a two-column grid of tall
  cards ([kombai](https://ww2.kombai.com/gallery/inspirations/card-ios-37/)).
- **Closest app: NYT Cooking's recipe list.**
    - Its nearest feature is the row thumbnail: about 80 px, inset, rounded, on white.
    - Food Edge's plate is 44% of the width, square, touching the screen edge, the full height of its words, with no row
      chrome, on steel.
    - The difference shows at thumbnail size (contact sheet).
- **What a viewer screenshots:** Home, with three real dishes stacked down the edge and one yolk button.
- **Weak, flagged:** these searches return text, not screenshots. I did not open apps one by one.

## Frame cards and data audit

**Data audit.** Sources:

- `recipe-service/src/recipes/mappers/recipeRowToDomain.ts` and `recipeResponse.ts` (list summary)
- `recipes.schema.ts` (`listRecipesQuerySchema`)
- `collections.controller.ts`
- `ratings.service.ts`

What a list item carries:

- `title`, `totalTimeMinutes`, `prepTimeMinutes`, `servings`, `difficulty`, `mealType`, `cuisine`, `dietaryFlags`
- `averageRating`, `ratingCount`, `sourceType`, `clonedFromId`, `coverPhotoUrl`, `updatedAt`

What is **not** on a list item:

- `viewerRating`, which is on detail reads only
- collection membership, which comes from `GET /collections/:id`, one read per collection, cached

What is not stored at all:

- view history, cooked history, and the cook's available time
- cook marks and the current step, which live in the device session only

| Reason on Home                    | Source                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Ready by 6:37 pm"                | `totalTimeMinutes` plus the device clock                                                                                                                                                                                    |
| "25 min · Serves 2", "Vegetarian" | `totalTimeMinutes`, `servings`, `dietaryFlags`                                                                                                                                                                              |
| "In your Weeknights"              | collection read (one call, not the list endpoint)                                                                                                                                                                           |
| "4.8 from 112 cooks"              | `averageRating` and `ratingCount` on the cook's own **public** curry, rated by other cooks. `GET /api/v1/recipes` is scoped to the owner (`recipes.service.ts` `list(ownerId, …)`), so every pick is the cook's own recipe. |
| Recipe page "★ 4.8 from 23 cooks" | the owner's own **public** recipe, rated by others. The owner cannot rate it.                                                                                                                                               |

**API gap, stated.** The list sorts only by `updatedAt`, `createdAt` and `title`. So the device sorts "Quickest first"
itself. It filters the cached library to `mealType = dinner` and sorts by time. The other option is a new `totalTime`
sort.

| Screen            | Job, in the cook's words      | Mode     | One primary                                                                                     |
| ----------------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Home, deciding    | "Help me pick dinner."        | Planning | **Cook shakshuka**, docked. It opens cook mode at "Gather ingredients" and keeps the screen on. |
| Home, cooking     | "Get me back to where I was." | Cooking  | **Back to step 4**, docked, with the timer strip above it                                       |
| Home, nothing yet | "Where do I start?"           | Planning | **Add a recipe**, docked                                                                        |
| Recipe            | "Cook this."                  | Both     | **Start cooking**, docked                                                                       |
| My recipes        | "Find or add one of mine."    | Planning | **New recipe**, docked                                                                          |
| Cook mode         | "Tell me the next thing."     | Cooking  | **Next step**, 72 px, fixed low                                                                 |

A first-time user learns nothing new. The screens use tabs, a large title, rows with chevrons, a segmented control,
search, chips, a stepper, tick boxes, a switch, a "···" menu and buttons.

- **Success:** the cook says "that one" from the photo, then reads one line.
- **Mere prettiness:** they admire the food but still read every title to decide.

**List ledger.**

| List                         | Direction                                      | Why                                 |
| ---------------------------- | ---------------------------------------------- | ----------------------------------- |
| Tonight's picks              | Vertical, with "Show 3 more · 3 of 9 dinners"  | A short set that you compare        |
| My recipes                   | Vertical, with "Show 12 more · 12 of 24 shown" | A collection that you scan          |
| Ingredients and steps        | Vertical                                       | Sequences that you go through fully |
| Filter chips                 | Horizontal, with the next chip peeking         | Optional peers                      |
| Discover shelves (not drawn) | Horizontal rows, stacked                       | Sampling within a category          |

## Palette: Stainless & Duck Yolk

**Idea.** The brushed grey of a home sink and the deep orange of a duck-egg yolk. The grey keeps every dish the warmest
thing on screen. Duck yolk marks only what you press.

| Role        | Name                                  | Use                                            | Light     | Dark      |
| ----------- | ------------------------------------- | ---------------------------------------------- | --------- | --------- |
| Ground      | Stainless                             | The page, and the ground under every pick      | `#E4E7EA` | `#101214` |
| Surface     | Porcelain                             | Ruled lists, sheets, tab bar, fields           | `#FFFFFF` | `#1A1D21` |
| Sunken      | Sink                                  | Segmented track, avatar, a plate with no photo | `#D6DADE` | `#252A2F` |
| Edge        | Handle                                | Control outlines, unticked boxes               | `#69717A` | `#858D96` |
| Ink         | Cast iron                             | All text and titles                            | `#121518` | `#EEF1F3` |
| Muted       | Pewter                                | Secondary text, 16 px and up                   | `#454C54` | `#B5BCC3` |
| Action      | Burnt yolk (light) / Duck yolk (dark) | Links, focus ring, current-tab icon            | `#864A00` | `#F8AC5E` |
| Action fill | Duck yolk                             | The one filled button, a ticked box            | `#F8AC5E` | `#F8AC5E` |
| On action   | On yolk                               | Label on Duck yolk                             | `#121518` | `#1A1206` |
| Action wash | Yolk wash                             | Current step, selected chip (decoration)       | `#FCE6CC` | `#33261A` |
| Warning     | Mustard                               | Short labels with a triangle icon              | `#5F5A00` | `#D8CC6E` |
| Danger      | Radish                                | Text rows with an icon, never a fill           | `#B0123F` | `#FF9DB4` |
| Hairline    | Brushed                               | Dividers (no contrast duty)                    | `#D0D5DA` | `#2C3237` |

**Two tones, one meaning.**

- A fill that carries a dark label must sit at L 0.76 or higher.
- No text colour that light reaches 4.5:1 on a light ground.
- So in light, Duck yolk fills and Burnt yolk (the same hue family, OKLCH h 65 and 61) carries text and focus. Both mean "you
  can press this, or you did".
- In dark they are one colour.
- This is Mise's own structure: its Leaf is dark in light and pale in dark.

**Script output.** The script `pal.mjs` uses culori 4.0.2 and my APCA 0.0.98G code. I checked the APCA code against the
canon's "On leaf on Leaf" figure and got 6.77:1, Lc 88.0. The script exits non-zero on any failure. The final run
printed **ALL PASS**. The page recomputes the WCAG ratios and Lc live from the hex values.

| Check                                                        | Light                    | Dark                                       |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------------ |
| Ink on Ground, Surface, Sunken and Wash                      | 13.0–18.3, Lc 83–105     | 12.8–16.6, Lc 95–98                        |
| Muted on the same                                            | 6.2–8.7, Lc 68–90        | 7.5–9.8, Lc 62–65                          |
| Action as text on Ground, Surface and Sunken                 | 5.0–7.0, Lc 62–84        | 7.6–9.9, Lc 63–66                          |
| On yolk on Duck yolk                                         | 9.6, Lc 67               | 9.8, Lc 67                                 |
| Warning on Ground and Surface                                | 5.7–7.1, Lc 70–85        | 10.3–11.4, Lc 73–74                        |
| Danger on Ground and Surface                                 | 5.6–7.0, Lc 68–82        | 8.6–9.6, Lc 63–64                          |
| Edge on Ground, Surface and Sunken                           | 3.5–5.0                  | 4.3–5.6                                    |
| Current-tab icon on the tab bar                              | 7.0                      | 8.9                                        |
| Ink to Muted                                                 | 2.11                     | 1.69                                       |
| ΔE00: Action to Warning, Action to Danger, Warning to Danger | 19.7, 29.8, 47.3         | 19.8, 32.1, 45.6                           |
| ΔE00: Fill to Warning, Fill to Danger                        | 40.5, 47.2               | 19.8, 32.1                                 |
| Against the five earlier-round actions (minimum)             | 37.4                     | 38.5                                       |
| Against Carton Tomato, Deli Prosciutto                       | 27.2, 25.3               | 19.6, 24.5 (D3's proposed `#B8364A`: 41.1) |
| Ground OKLCH                                                 | L 0.927, C 0.005         | L 0.181                                    |
| Brands: Bumble, Amazon Buy Now, iOS orange, iOS yellow       | 14.1, **6.6**, 7.9, 17.0 | same                                       |

**Not Mise.** The ground sits 4.5 below Counter in OKLCH L×100, and the action is 37.8 from Leaf.

**Colour-blind check** (culori Machado, full severity):

- Burnt yolk and Mustard merge under deuteranopia (0.4), so colour never carries that difference. A link is always
  underlined and has no icon. A warning always has a triangle.
- Warning and Danger stay 20.7 or more apart under both filters.
- Danger is never a fill.

**Swatch strip.** Steel grey, apricot-orange and a mustard dot. A stranger reads it as "steel and yolk". Carton reads
as "white, sky and tomato", and Deli Counter as "pistachio and cured red".

**Imagery.** Photos from Wikimedia Commons, cropped and compressed:

- shakshuka: Joe Mahoney, CC BY 2.0
- green curry: pelican, CC BY-SA 2.0
- dal tadka: Monali.mishra, CC BY-SA 4.0
- chili: Carstor, CC BY-SA 2.5
- tomato soup: Neil Conway, CC BY 2.0

The share-alike licences carry into any reuse of the file. I read a `data:` URI in CSS as inline imagery under the
brief. That reading is the owner's call.

## Self-review (canon §5), from the renders

**A. Fresh, not dated.**

- **Pass. Year read:**
    - A steel grouped-grey ground with no row chrome reads 2025 to 26.
    - Lexend reads 2023 to 26.
    - The orange-yolk action is not dated.
    - Real home-cooked photos read as now. The 2018 recipe-blog look is overhead styling on wood, which this is not.
- **Pass.** Two axes against the house answer are named.
- **Pass.** The closest app and its nearest feature are named.
- **Pass.** The trajectory step is named.
- **Pass.** Food is the largest and most colourful thing on Home and on the recipe page.
- **Pass.** One signature, with its ban list.
- **Pass.** It survives the longest title at 320 px and 200%.
- **Weak.** The excitement test ran from search text only.

**B. Distinct.**

- **Pass.** On the contact sheet (Carton r1, Deli Counter r1, Food Edge r2, Home and Recipe):
    - Carton is a blue framed pack.
    - Deli Counter is full-width slices with cards and big times.
    - Food Edge is a column of square food down the left edge.
- **Pass.** Palette distances are all at or above 15 against the siblings and earlier rounds, and all reported.

**C. Simple.**

- **Pass.** The list of new interactions is empty.
- **Pass.** One Duck yolk fill per screen, docked low and labelled.
- **Pass.** Each pick is one link. The button sits outside every pick.
- **Pass.** No gesture-only action. Delete sits in a labelled "···" menu.

**D. Psychology.**

- **Pass.** The ledger is written.
- **Pass.** Load more comes with counts.
- **Pass.** Plate to words is 14 px and pair to pair is 28 px (DOM measured).
- **Pass.** Quantities sit inside the steps. The current step has a wash, a filled number and "You are here".
- **Pass.** At 390 px Home shows two full picks and the start of the third above the dock, so it gives a reason to
  scroll. No false floor.
- **Pass, measured.** The dock clears the tabs by 12 px at 390 and 320 px, at 100% and 200%.
- **Pass.** Delete is in a menu, with Undo in the toast (not drawn).

**E. Calm.**

- **Pass.** The accent appears only on the primary, the current-tab icon, links, ticks and focus. Timer buttons are
  neutral.
- **Pass.** Nothing moves at rest. The press state is off under reduced motion.
- **Pass.** One type family.

**F. Cooking.**

- **Pass.** Cook mode is drawn:
    - one step at 28 px
    - quantities inline
    - the step's own timer ("Eggs · 5:42 left") in the fixed strip, matching Home's cooking state at the same 6:31
    - a fixed timer strip
    - labelled 72 px Previous and Next
    - "Screen stays on", switched on by the cook's Start cooking
- **Pass.** The opening screen is drawn in the deciding, cooking and nothing-yet states.

**G. Accessibility.**

- **Pass.** All figures are above.
- **Pass.** Targets are 44 px or more.
- **Pass.** No sideways scroll at 320 px and 200%.
- **Fixed size by design.** The tab bar labels and the cook-mode top and bottom bars keep fixed sizes, as the iOS
  large-content viewer does.
- **Residual.** At 320 px and 200%, the cook-mode step text scrolls between the fixed bars.
- **States not drawn:** loading, error, offline and success.

**Nielsen's 10 heuristics.**

- **H1, visibility of system status.** The cooking state relies on a device session. If that session is lost, Home
  falls back to deciding with no notice. Fix: one line, "Your place in Shakshuka was on another device", shown only
  when that is true.
- **H4, consistency.** Burnt yolk links in light and Duck yolk links in dark look like two colours to someone who
  switches themes. The meaning is the same.
- **H5, error prevention.** A cook who wanted the curry and pressed "Cook shakshuka" loses one Back.

No other violations found.

**Contact sheet: four answers.**

- **Stranger:** Carton is a blue pack. Deli Counter is slices with price-like times. Food Edge is a food column on steel.
- **Year:** 2026.
- **Family:** a shared trait with Deli Counter is a time-based reason ("Ready by"). The structures do not share a pile.
- **Mood:** a weeknight kitchen.

## Owner pre-mortem

| Reaction                          | Observed cause                                | Response                                                                                                                                            |
| --------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "It is just a list"               | The structure is a list, by design (canon §0) | The look is not a list: 44% square plates touching the edge, no row chrome, on steel. Risk: it can read as "calm and correct" more than "exciting". |
| "That orange is Amazon's Buy Now" | ΔE00 6.6 from `#FFA41C`                       | Stated above. The flat block, the steel ground, the dish name and one use per screen separate them. A hue alone cannot in this band.                |
| "Grey is dull"                    | A grey ground can read as settings            | The food carries the screen, and the grouped white rows that made it Notes are gone.                                                                |
| "Ignores scrolling"               | none                                          | Ledger followed.                                                                                                                                    |
| "No palette"                      | none                                          | Full table, measured.                                                                                                                               |

## Delivery gate

| Frame card | Data audit           | Ledger | Strikes | Taste | Signature tests             | Prior art          | Palette + script | Swatch strip | States                                                   | Screenshots                                            | Self-review | Pre-mortem |
| ---------- | -------------------- | ------ | ------- | ----- | --------------------------- | ------------------ | ---------------- | ------------ | -------------------------------------------------------- | ------------------------------------------------------ | ----------- | ---------- |
| Done       | Done, API gap stated | Done   | Done    | Done  | Rendered at 320 px and 200% | Run, weak, flagged | `ALL PASS`       | Rendered     | 5 of 9 (deciding, cooking, first run, cook mode, recipe) | 1400, 390 and 320 px, at 100% and 200%, light and dark | Done        | Done       |

**Not run:**

- Web width; the loading, error, offline and success states.
- App-by-app screenshot checks.
- Increased-contrast mode.
- Distance tests at 60 and 90 cm.
- OS text settings (I emulated them with the root font size).
- Screen-reader passes.
- A colour-blind check of the photos.
