# Option 3: Food Edge, round 1

Designer 3. Mockup: [`option3.html`](option3.html), one file of 68.0 KB.

- It shows no script errors.
- The page does not scroll sideways at 1400, 390 or 320 px, or at 200% text (the root font size set to 200%).
- Lexend loads from Google Fonts.
- I rendered every frame with Playwright in four rounds and fixed what each round showed.

Heuristic judgement, untested with users.

## The idea in two sentences

In Commise the food sits against the edge of the screen, like the plate in a field guide. The words face it on a clean
strip. You choose dinner by looking, then confirm by reading.

**Palette: Stainless & Yolk.** The cool grey of a kitchen sink lets the food be the warmest thing on screen. The yellow
of an egg yolk marks the one thing to press.

## Changes this round

| Critique point                                                                                              | Verdict                                                                | What changed, or why not                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 and D2: Persimmon twins Carton. The dark actions are ΔE00 9.6 apart, and Persimmon is 8.2 from M3 error. | **Accepted.** I promised this move in my own critique.                 | Persimmon is gone, and so are the blue ground and Glacier. The new palette is Stainless & Yolk (below). Saffron and Yolk are 39.8 / 36.7 from Carton's Tomato, which round 1 keeps, and at least 28.4 from every earlier-round action.                                                                                                                                                  |
| D1 offered Roast `#7A3B12`. D2 offered Steel & Carrot `#B34500`.                                            | **Pushed back on both hues. Took D2's idea of a fridge-steel ground.** | Both are orange-brown. Option 2 is being steered to Pimentón `#94400A` or Bresaola `#6E2C2C`, and Carton measured Roast at 10.3 from Tomato in dark. I swept hue, L and C against every action in play. Only two bands were free in both themes: violet, which is banned and sits 8 to 10 from M3 primary, and yellow. Yolk is the yellow.                                              |
| D1: clip-art round plates break my own "no circles" refusal.                                                | **Accepted.**                                                          | The plates are gone. Each image is a tight, soft-focus crop of the food surface with no rim, drawn for this mockup. See "Imagery".                                                                                                                                                                                                                                                      |
| D2: photos 3 px apart and titles 13 px away, so the photos fuse into a column (proximity).                  | **Accepted.**                                                          | Each photo and its caption now share one white strip, a common region. Strips sit 16 px apart on the grey ground, twice the largest gap inside a caption (8 px).                                                                                                                                                                                                                        |
| D1: "no gaps, one strip of food".                                                                           | **Pushed back.**                                                       | No gaps is the proximity breach that D2 measured (canon §1.2). The column now reads as a column of plates, not one ribbon.                                                                                                                                                                                                                                                              |
| D1 and D2: Plan and Shop tabs go nowhere.                                                                   | **Accepted.**                                                          | There are three tabs: Home, Recipes and Discover (`TAB_ROUTES`, `mobile/src/navigation/routes.ts:46`).                                                                                                                                                                                                                                                                                  |
| D2: My recipes is too loose (136 px rows).                                                                  | **Accepted.**                                                          | Rows are 88 px with an 88 px square flush left. Five recipes show above the docked button at 390 px, up from 3.5.                                                                                                                                                                                                                                                                       |
| D2: the 200% pass was staged with an `.x2` class, and it hid "Picked from…".                                | **Accepted.**                                                          | Each phone frame is now a CSS container, and the layout adapts with `@container (max-width: 17em)`. The em is the frame's own, so a real 200% root size triggers it. Nothing is hidden at large text. The "Picked from" lede is gone at every size, because each pick now states its own reason.                                                                                        |
| D1: at 320 px and 200%, the recipe facts overlap the title.                                                 | **Accepted.**                                                          | At large text the photo stacks above the facts. Measured at 320 and 390 px with a 200% root: no overlap and no sideways scroll.                                                                                                                                                                                                                                                         |
| D1: a 44 px timer pill inside a sentence opens 38 px line gaps.                                             | **Accepted.**                                                          | The duration stays bold inside the step. A 44 px "Start 8 min timer" button sits on its own line below it, in neutral colours, not the action colour.                                                                                                                                                                                                                                   |
| D1: "Others" with a shuffle icon has weak scent.                                                            | **Accepted.**                                                          | The control is now "Show 3 more", an underlined Saffron link.                                                                                                                                                                                                                                                                                                                           |
| D1 and D2: the current-tab label is the action colour at 12 px.                                             | **Accepted.**                                                          | Labels are Ink at a fixed 12 px. The current tab gets a Yolk pill behind its icon.                                                                                                                                                                                                                                                                                                      |
| D2: the zero is slashed ("2Ø min").                                                                         | **Accepted.**                                                          | Atkinson is replaced by Lexend. I rendered "20 min · 220 °C · 800 g". The zero is plain.                                                                                                                                                                                                                                                                                                |
| D2: "Good evening, Eliza" is the median greeting.                                                           | **Accepted.**                                                          | The large title is "Home", which names the place. It does not change with state, the same rule I applied to Option 2.                                                                                                                                                                                                                                                                   |
| D2: the recipe hero shrinks to 42%. Make it full width.                                                     | **Pushed back, in part.**                                              | The hero is now 62% wide and 288 px tall (round 0: 226 × 318), and it is the largest, most colourful thing on the page. Full width is the tasteful default (canon §2.3 and §6.1). A full-width hero also pushes Ingredients below the docked button, which is the false floor that D2 itself measured in Carton. At 390 px the Ingredients heading and its stepper show above the dock. |
| D2: "Original: partly. The column is a thumbnail enlarged, which is subtraction."                           | **Partly accepted.**                                                   | I took D2's field-guide push: a plate and a facing caption on Home's three picks, with clear gaps. The dense library gets a quieter 88 px version. The look also gains a palette that no recipe app ships (see prior art). The risk is real and is in the pre-mortem.                                                                                                                   |
| My own critique of Option 1: at 320 px and 200%, the food and the button left the first screen.             | **Applied to myself.**                                                 | My round-0 file failed the same test. Home's lead line "30 min · Serves 2 · Easy" is gone at every size. The cooking card now puts Back to step 4 straight under the dish, with the timer strip below it. All three Home states now hold their primary at 200%, measured.                                                                                                               |
| My own critique of Option 2: Warning and Danger merge for colour-blind users.                               | **Applied to myself.**                                                 | I ran the same filters on my palette. Saffron and Paprika collapse (1.7). Shapes carry the difference. See "Colour-blind check".                                                                                                                                                                                                                                                        |
| D2: Steel ground plus a violet action is the banned combination.                                            | Noted and avoided.                                                     | No violet anywhere.                                                                                                                                                                                                                                                                                                                                                                     |

## Step 0: point of view, refreshed

- **Habits.**
    - Type: a neutral grotesk.
    - Food: plated, seen from above.
    - Composition: a large title, then a hero, then a list.
    - Colour: one saturated accent on near-white.
    - Round 0 added a cold blue ground, and it twinned a sibling.
    - This round the colour has to stand on its own, and the photo plays no role in it.
- **Mood.** It is 6 pm on a Tuesday. The cook stands at the open fridge, tired, while someone asks "what's for dinner?".
  They want to be shown three answers, each with a reason, and to press one button.
- **Reference 1: Roger Tory Peterson, _A Field Guide to the Birds_ (1934).**
    - You identify by the plate, then confirm with short text on the facing page.
    - It is a naturalist's tool, and it appears on no UI moodboard.
    - It feeds the composition only.
- **Reference 2: Laura Letinsky, _Hardly More Than Ever_ (1997 to 2004).**
    - The series shows the remains of meals on pale, cool grey tables. Colour comes only from the food: a yolk, a cherry, a rind.
    - Photographers know it. Interface designers rarely do.
    - It feeds the light and palette only: a cool, quiet ground, with the food as the only warmth.
    - It replaces round 0's Kawauchi, whose blue-white light went with the blue ground.
- **Refusal.** No circles, rims or plates as a motif. No glow. No colour on a photo.

**The medians, struck.**

1. **Category median:** a white ground and a grid of rounded cards, with an orange or green accent and "What's cooking?".
2. **House answer:** a near-neutral ground, a large grotesk title and a full-bleed photo hero, then a strict list of small
   rounded thumbnails, with one deep warm accent. I rendered it in scratch for the contact sheet.
3. **Inversions:** the same two on a dark, moody ground.
4. **Peer predictions:**
    - a time question on Home
    - a wash taken from the dish colour
    - big time numerals
    - an editorial photo with type cropped at the edge
    - a pack or label ornament

    Carton turned out to be the label.

## Diverge (kept from round 0, re-struck)

Round 0 listed 14 concepts across seven needs. I kept the edge column (the dish). I struck these again:

- chord swatches (they encode colour)
- cut-out dishes (grocery apps)
- crinkle crops (M3 "cookie" shapes)
- margin numerals (a peer prediction)
- a "Tonight" board (no data)
- a diptych (2017)
- frost panels (they copy the leader)

New this round, on palette alone:

| Concept               | Need, and source                             | Verdict                                                                |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Roast brown           | D1's offer                                   | Struck: Option 2 sits in that band, and it is 10.3 from Tomato in dark |
| Carrot on steel       | D2's offer                                   | Struck: orange, the same band                                          |
| Aubergine on steel    | The dish, open hue band                      | Struck: violet on cool grey (canon §3.2), and 9.8 from M3 primary      |
| Olive                 | The shop, open hue band                      | Struck: 12 to 15 from Mise's Leaf, so it reads as the reference        |
| **Yolk on stainless** | The dish (egg, saffron, butter) and the sink | **Kept**                                                               |

Food Edge differs from the house answer on two axes:

- **Composition:** plates flush to the screen edge, each with a facing caption on its own strip, instead of a top hero
  band over a list of small inset thumbnails.
- **Palette and ground:** a mid-grey stainless ground, white strips and a yellow action, instead of near-white and a
  deep warm accent.

## Taste argument

**Visual thesis (the first 50 ms).** A stranger sees a cool grey screen with blocks of food down its left edge. Each
block faces a white strip of words, and there is one egg-yolk button. Only Commise looks like this because the plate-and-caption pair is how a cook
chooses: by the look of the food first, then by reading.

**Trajectory step.** Three recent designs push content to the edge and let imagery carry the identity:

- iOS 26 (2025): content edge to edge, with controls in their own layer
- Material 3 Expressive (2025): more colour in containers, and emphasised type
- Airbnb's 2025 redesign: tactile, image-led cards

Food Edge takes one step past them. The content reaches the screen edge **inside an ordinary list row**, and the
action colour is a food colour that no shipping recipe app uses. No control changes. Before 2022 the grey "grouped"
ground meant settings screens. Using it as a counter that food sits on is new.

**Mood test.** A steel sink, a white plate, a yolk. Nothing glows and nothing moves at rest. It reads as a weeknight
kitchen, not a night out.

**Signature: the food edge.**

- **Where it is placed:**
    - Home's three picks: plates 40% wide and 112 to 208 px tall, flush left, each facing a caption on a white strip.
    - The cooking card on Home.
    - The recipe hero: 62% wide, flush left, facing the facts.
    - The library, in a quieter 88 px form.
- **Where it is banned:** cook mode, the ingredient and step lists, every control, the tab bar, sheets and the palette.
- **It encodes nothing.** The plate is each recipe's own photo. The title, time and reason are all in words beside it.
- **Survival test, rendered:**
    - At 320 px with the longest title, "Green curry with chicken and Thai basil", the plates hold at 40%.
    - At 200% text the plate stacks above its caption and stays flush left at 72% width. On the recipe page it is 84%.
      It never becomes a centred or rounded thumbnail.

## Prior-art search

I ran three searches with the WebSearch tool:

1. Recipe app lists with photo thumbnails flush to the screen edge, square corners, in a large left column.
2. A recipe app with a yellow yolk primary button on a white ground, 2025.
3. The accent colours of Crouton and Kitchen Stories.

Results:

- Neither a flush square column nor a yolk action came back from any recipe app. The galleries returned rounded grid
  cards (kombai, screensdesign).
- Crouton lets users pick the app colour, so a yellow theme is possible there by user choice. It is not a default, and
  it has no edge plates.
- **Closest app:** NYT Cooking's recipe list. Its nearest feature is the row thumbnail, which is small (about 80 px),
  inset, rounded and on a white page. Food Edge's plate is 40% of the width, square, at the screen edge, on its own
  strip, on a grey ground. On the contact sheet the difference shows at thumbnail size.
- **What a viewer screenshots:** Home, with three blocks of food down the edge and one yolk button.
- **Weak, flagged:** the searches return text, not screenshots. I did not open the app stores app by app.

## Frame cards and data audit

**Data audit.** Sources:

- `recipe-service/src/database/schema/recipes.ts`
- `ratings.ts`
- `recipes.schema.ts` (`listRecipesQuerySchema`)
- the cook-marks backends

What Commise stores:

- **Per recipe:**
    - total, prep and cook time
    - servings, difficulty, cuisine and dietary flags
    - average rating and rating count
    - photos, ingredients, and steps with `timerSeconds`
    - `updatedAt`
- **Per cook:** your own stars and your collections.
- **Not stored:** view history and cooked history.
- **Cook marks and the current step** live only in the device session. So "Cooking now" shows only while the device
  holds a session.

Every reason on Home is a stored fact:

| Reason on Home        | Stored fact                      |
| --------------------- | -------------------------------- |
| "You gave it 5 stars" | `ratings.stars`                  |
| "In your Weeknights"  | collection membership            |
| "4.9 from 112 cooks"  | average rating and count         |
| "Ready by 6:45 pm"    | total time plus the device clock |

**API gap, stated.** `listRecipesQuerySchema` sorts only by `updatedAt`, `createdAt` and `title`, so "picked by time"
cannot come from the list endpoint today. The picks need one of two things:

- a pick made on the device over the library already cached by the offline port, or
- a new `totalTime` sort.

Until then, Home is a design over data the client holds, not over an endpoint.

| Screen            | Job, in the cook's words      | Mode     | One primary                                                                                                  |
| ----------------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Home, deciding    | "Help me pick dinner."        | Planning | **Start cooking**, below the first pick. It opens cook mode at "Gather ingredients" with the screen kept on. |
| Home, cooking     | "Get me back to where I was." | Cooking  | **Back to step 4**, straight under the dish, with the named timer strip below                                |
| Home, nothing yet | "Where do I start?"           | Planning | **Add a recipe**                                                                                             |
| Recipe            | "Cook this."                  | Both     | **Start cooking**, docked above the tabs                                                                     |
| My recipes        | "Find or add one of mine."    | Planning | **New recipe**, docked above the tabs                                                                        |

A first-time user needs to learn nothing. The screens use rows with chevrons, tabs, a segmented control, search, chips,
a stepper, checkboxes, a switch and buttons.

**Signs.**

- **Success:** the cook says "that one" from the picture within seconds.
- **Mere prettiness:** they admire the plates but still read every title to decide.

**List ledger.**

| List                         | Direction                                      | Why                                   |
| ---------------------------- | ---------------------------------------------- | ------------------------------------- |
| Three for tonight            | Vertical, with "Show 3 more"                   | A short decision set that you compare |
| My recipes                   | Vertical, with "Show 12 more · 12 of 24 shown" | A collection that you scan            |
| Ingredients and steps        | Vertical                                       | Sequences that you go through fully   |
| Filter chips                 | Horizontal, with the next chip peeking         | Optional peers                        |
| Discover shelves (not drawn) | Horizontal rows, stacked                       | Sampling within a category            |

## Palette: Stainless & Yolk

**Idea.** The brushed grey of a home kitchen sink and the yellow of an egg yolk. The grey ground keeps every dish the
warmest thing on screen. Yolk is the colour of food at its most appetising, and here it marks only what you press.

| Role        | Name      | Use                                                                              | Light     | Dark      |
| ----------- | --------- | -------------------------------------------------------------------------------- | --------- | --------- |
| Ground      | Stainless | The page                                                                         | `#E4E7EA` | `#101214` |
| Surface     | Porcelain | Caption strips, lists, sheets, tab bar, fields                                   | `#FFFFFF` | `#1A1D21` |
| Sunken      | Sink      | Segmented track, avatar, the empty plate                                         | `#D6DADE` | `#252A2F` |
| Edge        | Handle    | Control outlines, unticked boxes                                                 | `#69717A` | `#858D96` |
| Ink         | Cast iron | All text and titles                                                              | `#121518` | `#EEF1F3` |
| Muted       | Pewter    | Secondary text, 16 px and up                                                     | `#454C54` | `#B5BCC3` |
| Action      | Saffron   | Links, ticks and the focus ring in light. In dark it is the same colour as Yolk. | `#6B5600` | `#F7D84E` |
| Action fill | Yolk      | The one filled button, the current-tab pill, a ticked box                        | `#F3C324` | `#F7D84E` |
| On action   | On yolk   | Label on a Yolk fill                                                             | `#121518` | `#1B1600` |
| Action wash | Custard   | Current step, selected chip (decoration)                                         | `#FBEEC0` | `#2F2A14` |
| Warning     | Paprika   | Short labels with an icon                                                        | `#A34500` | `#FFAD78` |
| Danger      | Radish    | Text rows with an icon only, never a fill                                        | `#B0123F` | `#FF9DB4` |
| Hairline    | Brushed   | Dividers (no contrast duty)                                                      | `#D0D5DA` | `#2C3237` |

**Why two tones of one hue for the action.** A yellow fill with a dark label is what makes the light theme fresh. A
yellow text link on a light ground cannot reach Lc 60.

- So in light, Yolk carries the fill and Saffron (the same hue, h 92) carries text, ticks and focus. Both mean "you can
  press this, or you did".
- In dark they are one colour.
- This is the canon's "tone sets every colour", applied inside one meaning. It is not a second accent.
- Yolk is not text, so its 1.6:1 against the ground carries no text duty. The button is identified by its Ink label at
  11.0:1, and a ticked box by its Ink tick.

**Script output.** The script is `pal.mjs`. It uses culori 4 and my APCA 0.0.98G code, tested against the canon's
"On leaf on Leaf" figure (6.77:1, Lc 88.0). It exits non-zero on any failure, and the final run printed `ALL PASS`. The
page computes the same WCAG and Lc figures live from the hex values.

| Check                                                            | Light                      | Dark                      |
| ---------------------------------------------------------------- | -------------------------- | ------------------------- |
| Ink on Ground, Surface, Sunken and Wash                          | 13.0 to 18.3, Lc 83 to 105 | 12.7 to 16.5, Lc 95 to 98 |
| Muted on Ground, Surface, Sunken and Wash                        | 6.2 to 8.7, Lc 68 to 90    | 7.5 to 9.8, Lc 62 to 65   |
| Action as text on Ground, Surface and Sunken                     | 5.05 to 7.10, Lc 62 to 84  | 10.3 to 13.3, Lc 80 to 83 |
| On action on its fill                                            | 11.0, Lc 74                | 12.8, Lc 83               |
| Warning on Ground and Surface                                    | 5.0 to 6.2, Lc 66 to 80    | 9.3 to 10.3, Lc 67 to 68  |
| Danger on Ground and Surface                                     | 5.6 to 7.0, Lc 68 to 82    | 8.6 to 9.6, Lc 63 to 64   |
| Edge on Ground, Surface and Sunken                               | 3.5 to 5.0                 | 4.3 to 5.6                |
| Ink to Muted                                                     | 2.11                       | 1.69                      |
| ΔE00 Saffron and Paprika, Saffron and Radish, Paprika and Radish | 22.1, 41.7, 24.4           | 24.4, 48.6, 25.3          |
| ΔE00 Yolk and Paprika, Yolk and Radish                           | 42.0, 61.3                 | 24.4, 48.6                |
| Action against the five earlier-round actions (minimum)          | 28.4 (Yolk 34.3)           | 31.1                      |
| Ground OKLCH                                                     | L 0.927, C 0.005           | L 0.181                   |

There is no content hue: the food is the colour. Two notes on the figures:

- **On yolk on Yolk in light (Lc 74).** It is a 17 px semibold button label, a short label, so the Lc 60 minimum
  applies.
- **Not Mise.** The ground sits 4.5 below Mise's Counter in OKLCH L×100, which meets canon §3.2 test 1. The action hue
  also differs from Leaf by 22.7 / 18.3.

**Colour-blind check.** I ran the same test I ran on Option 2: culori's Machado filters at full severity, ΔE00 after
simulation.

| Pair                        | Normal | Deuteranopia | Protanopia |
| --------------------------- | ------ | ------------ | ---------- |
| Saffron and Paprika (light) | 22.1   | **1.7**      | **2.8**    |
| Yolk and Paprika (light)    | 42.0   | 37.3         | 43.7       |
| Paprika and Radish (light)  | 24.4   | 23.8         | 37.2       |
| Yolk and Paprika (dark)     | 24.4   | **10.8**     | **13.9**   |
| Yolk and Radish (dark)      | 48.6   | 25.9         | 34.5       |
| Paprika and Radish (dark)   | 25.3   | 17.7         | 25.1       |

Saffron and Paprika collapse for colour-blind users, so colour never carries the difference:

- a link is always underlined and has no icon
- a warning always has a triangle with "!"
- danger always has a trash or a circled cross, as a text row

Warning and Danger stay apart under both filters (17.7 or more).

**Against siblings.** Option 1's round-1 file landed while I worked. It keeps Tomato `#C41E3A` / `#FFA294`.

| Action                           | Light ΔE00 | Dark ΔE00             |
| -------------------------------- | ---------- | --------------------- |
| Carton Tomato                    | 39.8       | 36.7                  |
| Delft (Option 2, round 0)        | 45.7       | (no dark value given) |
| Pimentón (proposed for Option 2) | 21.2       | 17.1                  |
| Bresaola (proposed for Option 2) | 30.8       | 44.4                  |
| M3 primary                       | 53.2       | 55.5                  |

Option 2's round-1 file landed at the end of my work. Its action is Prosciutto `#620914` / `#FFD7CF`: Saffron is 34.7 from it in light, Yolk 72.1 in light and 29.5 in dark.

**Swatch test.** Carton reads as "white, sky and tomato". Deli Counter reads as "pistachio and a red-brown". This strip
reads as "steel grey and egg yolk".

**Imagery.** The brief allows CSS, inline SVG or canvas imagery, with no external assets.

- I read a `data:` WebP set as a CSS `background-image` as CSS imagery. That is the owner's call, and I flag it.
- The photos in `docs/mockups/_assets` are restaurant plating: a chef, a wine glass, a tweezered garnish. They fail the
  weeknight mood, and Option 2 already uses them.
- So the five dishes are soft-focus food-surface crops that I generated in Python: shakshuka, dal, green curry, chili
  and tomato soup. They are about 5 to 6 KB each.
- They are stand-ins, not photographs. The page says so.

## Self-review (canon §5), from the renders

**A. Fresh, not dated.**

- **Pass. Year read:**
    - The grey grouped ground used as a counter, with white strips, reads as 2025 to 26 (iOS 26 grouping).
    - Lexend as the only voice reads as 2023 to 26.
    - The yolk action is not dated to any year. No recipe app was found using it.
- **Pass.** The house answer is written, and the option differs from it on two named axes.
- **Pass.** The closest app is named, with its nearest feature and the visible difference.
- **Pass.** The trajectory step is named.
- **Pass.** Food is the largest and most colourful thing on Home and the recipe page.
- **Pass.** One signature, with its ban list written down.
- **Pass.** The thesis is written. The references are Peterson and Letinsky.
- **Pass.** The signature survives the longest title at 320 px and at 200% text, rendered.
- **Weak.** The excitement test ran from search text, not from screenshots.

**B. Distinct.**

- **Pass.** On the contact sheet (house answer, Carton r1, Deli Counter r0, Food Edge), the hero forms differ: a top
  photo band, a blue box, full-width slices, a left-edge plate column.
- **Pass.** The palette has a name, every role, both themes and measured figures.
- **Pass.** Action distances are above 15 against every sibling action, Option 2's Prosciutto included (29.5 or more).

**C. Simple.**

- **Pass.** The list of new interactions is empty.
- **Pass.** One Yolk fill per screen, low and labelled.
- **Pass.** Each pick strip is one link. "Start cooking" sits outside it, on the ground.
- **Pass.** No gesture-only action.

**D. Psychology.**

- **Pass.** The ledger is written.
- **Pass.** Load more comes with a count.
- **Pass.** Strips sit 16 px apart, at least 2× the gap inside a caption, and the common region binds plate to caption.
- **Pass.** Quantities sit inside the steps, and the current step is marked by a wash, a filled number and words.
- **Pass at 100%, in light and dark.** The first screen shows its main action:
    - Home: all three picks and Start cooking (ending at y 380) show above the tabs (at y 761).
    - Recipe: Ingredients and the stepper show above the dock.
- **Pass at 200% text, measured with a 200% root size at 320 and 390 px.** The first screen holds its primary:
    - Home deciding: Start cooking ends at y 758, above the tabs at y 761.
    - Home cooking: Back to step 4 ends at y 496 to 703.
    - First run: Add a recipe ends at y 645 to 746.
    - The first 200% render failed: the button started at y 856, below the tabs.
    - To fix it, I removed the lead's "30 min · Serves 2 · Easy" line **at every size**, because "Ready by" already gives
      the time and the recipe page gives the rest. I also cut the large-text plate to 80 px and shortened the first-run
      copy. Nothing is hidden only at large text, so WCAG F69 is not triggered.
    - The button clears the tabs by 3 px, so it has almost no margin. A longer title at 200% pushes it under the tabs.
- **Pass.** Delete is a text row in Radish, at the foot, apart from everything else.

**E. Calm.**

- **Pass.** Yolk and Saffron appear only on the primary, the current-tab pill, links, ticks and focus. Timer buttons
  are neutral.
- **Pass.** Nothing moves at rest. The only motion is a press state, and it is off under reduced motion.
- **Pass.** One type family.

**F. Cooking.**

- **Pass.** The opening screen is shown in the cooking, deciding and nothing-yet states.
- **Pass.** Keep screen on is a switch the cook turns on.
- **Not drawn this round:** cook mode itself. Its 30 px step type is shown in the type samples.

**G. Accessibility.**

- **Pass.** All figures are above.
- **Pass.** A ticked line has a tick, a strike-through and muted text.
- **Pass.** Targets are 44 px or more. Type-sample captions on the page are 16 px, so no Muted text is below 16 px.
- **Pass.** No sideways scroll at 320 px and 200% text.
- **Fixed size by design.** Tab labels and the status bar stay at 12 and 15 px, as the iOS large-content viewer does.
- **States not drawn:** loading, error, offline and success.

**Nielsen's 10 heuristics.**

- **H1, visibility of system status.** "Show 3 more" gives no total. Fix: "Show 3 more · 3 of 9".
- **H5, error prevention.** Start cooking on the wrong pick costs one Back.
- **H4, consistency.** Saffron as the link colour in light and Yolk in dark can read as two colours to someone who
  switches themes. The meaning is the same.

No other violations found.

**Contact sheet: four answers.**

- **Stranger:** the house answer is a top photo band. Carton is a blue box. Deli Counter is full-width slices. Food Edge
  is a column of plates down the left edge.
- **Year:** 2026.
- **Family:** no pile shared with the house answer or a sibling.
- **Mood:** a weeknight kitchen.

## Owner pre-mortem

| Reaction                    | Observed cause                                          | Response                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Boring, just a list"       | The structure is a list. That is deliberate (canon §0). | The freshness is in the edge plates, the steel-and-yolk palette and the type. At thumbnail size it does not match the house answer. The risk remains that this is "correct and calm" more than "exciting". |
| "Yellow buttons look cheap" | A loud yellow can read as discount retail.              | The yellow is a warm yolk, not a lemon. It appears once per screen and carries an Ink label.                                                                                                               |
| "Grey is dull"              | A grey ground can read as a settings screen.            | White strips and food carry the screen. The grey is 0.927 L and cool, never warm.                                                                                                                          |
| "Ignores scrolling"         | None                                                    | The ledger is followed.                                                                                                                                                                                    |
| "No palette"                | None                                                    | Full table, both themes, measured.                                                                                                                                                                         |
| "The food looks drawn"      | It is drawn.                                            | It is a stand-in, and it is labelled. Real photos are the first thing to add.                                                                                                                              |

## Delivery gate

| Frame card | Data audit           | Ledger | Strikes | Taste | Signature tests             | Prior art          | Palette + script | Swatch strip | States | Screenshots                                            | Self-review | Pre-mortem |
| ---------- | -------------------- | ------ | ------- | ----- | --------------------------- | ------------------ | ---------------- | ------------ | ------ | ------------------------------------------------------ | ----------- | ---------- |
| Done       | Done, API gap stated | Done   | Done    | Done  | Rendered at 320 px and 200% | Run, weak, flagged | `ALL PASS`       | Rendered     | 3 of 7 | 1400, 390 and 320 px, at 100% and 200%, light and dark | Done        | Done       |

**Not run:**

- Cook mode, web width, and the loading, error, offline and success states.
- A live app-store check of screenshots.
- Real photographs.
- Increased-contrast mode.
- Device tests at 60 and 90 cm.
- Text size set in the OS. I emulated 200% with the root font size.

Sources for the search: [kombai gallery](https://kombai.com/gallery/inspirations/card-ios-37/),
[screensdesign](https://screensdesign.com/articles/recipe-app-design-examples/),
[Crouton on the App Store](https://apps.apple.com/app/id1461650987).
