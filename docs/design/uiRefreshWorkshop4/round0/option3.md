# Option 3: Food Edge

Designer 3. Mockup: [`option3.html`](option3.html), one file of about 46 KB. It has no script errors and no sideways
scroll at 1400, 390 and 320 px, or at 200% text. Fonts load, checked in `document.fonts`. I rendered it with
Playwright in four rounds and fixed what each round showed. The renders described here are the ones made after the
fixes.

## The idea in two sentences

Every list in Commise starts with a column of food down the edge of the screen. You choose dinner by looking, then
check by reading. The rest is the cold, clean light of an open fridge: an icy ground and deep blue-black
ink, so warm food is the warmest thing you see, and one colour, Persimmon, marks the thing to press.

## Step 0: my point of view and the medians

| Item        | What I wrote down before designing                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| My habits   | **Type:** a neutral grotesk. **Food:** plated, from above. **Composition:** large title, then a hero, then a list. **Colour:** one saturated accent on near-white. In round 3 I made Enamelware: cobalt, a round plate and a rim. That habit is the "kitchenware object" metaphor with circles, so this option has no circles, no rims and no objects. |
| Mood        | It is 6 pm on a Tuesday. The cook stands at the open fridge, tired, while someone asks "what's for dinner?". They want to be shown the answer, not asked to think.                                                                                                                                                                                     |
| Reference 1 | **Roger Tory Peterson, _A Field Guide to the Birds_ (1934).** You identify by picture first, then check with short text on the facing page. Few designers pick it because it is a naturalist's tool, not a design artefact, and it appears on no UI moodboard. It feeds the composition only: picture column first, words beside it.                   |
| Reference 2 | **Rinko Kawauchi, _Utatane_ (2001).** High-key, cool, luminous photos of ordinary things, eggs and watermelon among them. Few designers pick it because photographers know it and interface designers mostly do not. It feeds the light only: cool, clean and calm, with warm subjects.                                                                |
| Refusal     | No circles, rims or plates as a motif, and no glow or "line of light". Rounds 2 and 3 used both.                                                                                                                                                                                                                                                       |

**The medians, struck:**

1. **Category median:** a white ground and a grid of rounded cards with shadows. It has an orange or green accent, a friendly sans and a "What's cooking?" hero.
2. **House answer:** a near-neutral ground, a large grotesk title and a full-bleed photo hero. Below it is a strict list of small rounded thumbnails, with one deep warm accent on the button. My instinct sits close to this, so I built it in scratch and kept it on my contact sheet.
3. **Inversions:** the house answer on a dark, moody ground with a cinema mood, and the category median on a dark ground. Both are struck.
4. **Peer predictions:**
    - The house answer with one ornament: a label, tape or badge.
    - A Home that asks "How long have you got?" as a one-tap filter.
    - A tonal wash taken from the dish colour, which the canon permits.
    - An editorial layout: big type over a full-bleed photo cropped at the edge.
    - Big total-time numerals.

## Diverge: concepts, sources and strikes

| #   | Concept                                                      | Need, and what it borrows                                 | Verdict                                                     |
| --- | ------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | A gapless food column flush to the screen edge in every list | The dish: choose by sight. Borrows the field-guide plate. | **Kept**                                                    |
| 2   | Cold Light palette: an icy ground, blue-black ink, warm food | Deciding at the open fridge. Borrows Kawauchi's light.    | **Kept** (palette)                                          |
| 3   | A hyperlegible face as the only voice                        | Distance: reading through steam at arm's length           | **Kept** (type)                                             |
| 4   | Ingredient-colour chord swatches per recipe                  | The dish                                                  | Struck: encodes colour, and close to Fresh Cut              |
| 5   | Cut-out dishes standing on a "shelf"                         | The dish, the fridge                                      | Struck: grocery apps show cut-out products on white         |
| 6   | Crinkle-cut photo crops, like a pastry cutter                | The dish                                                  | Struck: Material 3 Expressive ships "cookie" shapes         |
| 7   | Big margin numerals for time and quantity                    | Timing, distance                                          | Struck: a peer prediction and the "big type" lever          |
| 8   | A "Tonight" board readable across the room                   | The household                                             | Struck: no tonight-meal data is stored                      |
| 9   | A diptych of photo and colour field                          | The dish                                                  | Struck: reads as the 2017 split-screen web, so dated        |
| 10  | Frost or steam panels                                        | Heat                                                      | Struck: glass copies the leader, and is banned in cook mode |
| 11  | Fridge-shelf glass dividers                                  | The fridge                                                | Struck: invisible at thumbnail size, an ornament            |
| 12  | Numbered pull-tab steps, from onigiri wrappers               | Hands, sequence                                           | Struck: round numbered discs are close to Enamelware        |
| 13  | Ground tint changing per tab                                 | The week                                                  | Struck: encodes location with colour                        |
| 14  | A one-tap time question on Home                              | Timing                                                    | Struck: a peer prediction, and the remedy named last round  |

Food Edge differs from the house answer on two named axes:

- **Composition:** an asymmetric edge column of food instead of a top hero band with a list of thumbnails.
- **Type genre:** a humanist face built for low vision instead of a neutral grotesk.

Palette structure is a third difference, counted as one axis with ground and mood: a tinted cool ground with coloured
ink, not a neutral ground with one warm accent.

## Taste argument

**Visual thesis (the first 50 ms):** a pale ice-blue screen with a column of warm food down its left edge. Bold,
friendly titles sit beside it, with one persimmon button. Only Commise looks like this because the column is how a cook
chooses: by the look of the food. Words then check it.

**Trajectory step:** iOS 26 (content edge to edge, controls in their own layer), Material 3 Expressive (2025: emphasised
type, more colour in containers) and Airbnb's 2025 redesign (warmer, more tactile imagery) all push content to the
edge and make imagery carry identity. Food Edge takes one step past them. The content touches the screen edge **inside
an ordinary list**, not only in a hero, so the list itself becomes the image. No control changes. This look did not
ship before 2022 because edge-to-edge lists only became the platform norm with iOS 26 and Android 15.

**Mood test:** cool, bright and ordinary, like an open fridge at six. Nothing glows and nothing moves at rest. It reads
as a weeknight kitchen, not a night out.

**Signature: the food edge.**

- It is placed in every list (Home, My recipes, Discover, collections, search results) and in the recipe hero, where
  the photo sits flush left beside a column of facts.
- It is banned from cook mode, the ingredient and step lists, every control, the tab bar and sheets.
- It encodes nothing. The column is each row's own picture, made larger and set flush. The title, time and reason are
  all in words beside it, so a user who ignores it loses nothing.
- **Survival test, rendered:**
    - At 320 px with the longest real title, "Miso-glazed salmon with sesame greens", it stays a column of 42 to 46% of the
      width.
    - At 200% text it narrows to a third of the width and is still a flush food column. It never falls back to a small
      rounded thumbnail.

## Prior-art search (closest app and excitement test)

- I ran one web search for a list with full-bleed thumbnails flush to the screen edge and no gaps. It found only
  platform edge-to-edge guidance (Android 15) and 500px's edge-to-edge photo feed. That feed is a gallery, not a list
  with text.
- From the apps I know, Spotify, Apple Music, NYT Cooking, Paprika and Mela all use inset, rounded thumbnails with gaps
  in their lists.
- **Closest app:** NYT Cooking's recipe list, whose nearest feature is the row thumbnail. The visible difference is
  that its thumbnail is small, inset and rounded, while Food Edge's is 42% of the width, square, flush and stacked
  into one continuous column.
- **What a viewer screenshots:** the Home with its column of food down the edge. I found no shipping app that does
  this.
- **Not checked:** the search was a single, weak query, and I looked at the app stores from memory, not live.

## Frame cards and data audit

**Data audit.** Sources: `recipe-service/src/database/schema/recipes.ts`, `ratings.ts`, `analyticsEvents.ts`, and
`features/recipes/src/detail/cookMarksBackend*.ts`.

- **Stored per recipe:**
    - Total, prep and cook time, and servings.
    - Difficulty, meal type and cuisine.
    - Dietary flags and tags.
    - Average rating and rating count.
    - Visibility, and draft or published.
    - Source, photos, `updatedAt`, ingredients, and steps with `timerSeconds`.
- **Stored per cook:** your own star rating (`ratings.user_id` and `stars`), and your collections.
- **Not readable per cook:**
    - View history. `recipe_viewed` exists only as aggregated counts.
    - Cooked history. `recipe_cooked` is unwritten.
- **Cook marks and the current step** are held in memory on native and in `sessionStorage` on web. So "Cooking now"
  shows only while that session holds them.
- **Every reason on Home is a stored fact:**
    - "Ready by 6:45 pm" is total time plus the device clock.
    - "You gave it 5 stars" is your own rating.
    - "In your Weeknights" is collection membership.
    - Servings and difficulty come from the recipe.
- There is no "not opened lately" and no invented history.

| Screen            | Job, in the cook's words      | Mode     | One primary                           | Must be understood without learning                                    |
| ----------------- | ----------------------------- | -------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Home, deciding    | "Help me pick dinner."        | Planning | **Start cooking** on the lead pick    | Three dishes, each with a plain reason, and "Others" to see three more |
| Home, cooking     | "Get me back to where I was." | Cooking  | **Back to step 4**                    | The step, its text and the named running timer                         |
| Home, nothing yet | "Where do I start?"           | Planning | **Add your first recipe**             | Your recipes will live here                                            |
| Recipe detail     | "Cook this."                  | Both     | **Start cooking**, docked low         | Facts, servings, ingredients and steps. Edit is in the footer          |
| My recipes        | "Find or add one of mine."    | Planning | **New recipe**, docked above the tabs | Search, chips, a count, Load more                                      |

**Signs.** Success: a cook says "that one" within seconds, from the picture. Mere prettiness: they admire the column
but still scroll to read every title.

**List ledger:**

| List                            | Direction                                      | Why                                   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Three for tonight               | Vertical                                       | A short decision set that you compare |
| Recently edited, and My recipes | Vertical, with "Show 12 more · 12 of 24 shown" | A collection you scan and compare     |
| Ingredients                     | Vertical                                       | A sequence you go through fully       |
| Steps                           | Vertical                                       | A sequence you go through fully       |
| Filter chips                    | Horizontal row with the next chip peeking      | Optional peers                        |
| Discover shelves (not drawn)    | Horizontal rows stacked vertically             | Sampling within a category            |

## Palette: Cold Light

**The idea:** the cool, clean light of an open fridge door at six in the evening. In it, roast skin, salmon and tomato
look warm and good to eat.

**Where colour lives:**

- The icy ground.
- The blue-black ink.
- Glacier, behind food and empty dishes.
- Persimmon, on the one thing to press.

This is not "a neutral ground plus one accent".

| Role        | Name         | Use                                                     | Light     | Dark      |
| ----------- | ------------ | ------------------------------------------------------- | --------- | --------- |
| Ground      | Frost        | The page                                                | `#E3EEF7` | `#0A121A` |
| Surface     | Shelf        | Tab bar, fields, sheets, switch row                     | `#FFFFFF` | `#121C26` |
| Sunken      | Crisper      | Segmented track, avatar                                 | `#D6E3EE` | `#1A2733` |
| Edge        | Rail         | Control outlines, unticked boxes                        | `#5F7183` | `#8193A5` |
| Ink         | Nightshade   | All text and titles                                     | `#0C1824` | `#EEF4F9` |
| Muted       | Slate        | Secondary text, 16 px and up                            | `#425468` | `#B3C2D0` |
| Action      | Persimmon    | The one filled button, links, current tab, ticks, focus | `#B33A06` | `#FFA478` |
| On action   | On persimmon | Label on a fill                                         | `#FFFFFF` | `#1F0B02` |
| Action wash | Peach        | Current step, selected chip                             | `#FBE3D4` | `#3A2418` |
| Warning     | Mustard      | Short labels with an icon                               | `#735500` | `#EBC660` |
| Danger      | Raspberry    | Short labels with an icon, and text rows only           | `#AD1048` | `#FFA3C0` |
| Content hue | Glacier      | Behind food and empty dishes only                       | `#9DC4E0` | `#355C7A` |
| Hairline    | Seam         | Dividers                                                | `#CBDAE6` | `#25323F` |

**Script output.** A culori script tested every pair with APCA 0.0.98G, which exits non-zero on any fail. The final
run exited 0 with "ALL PASS". The page computes the same WCAG and Lc figures live from the hex values.

| Check                                                            | Light                      | Dark                      |
| ---------------------------------------------------------------- | -------------------------- | ------------------------- |
| Ink on Ground, Surface, Sunken and Wash                          | 13.9 to 17.8, Lc 88 to 104 | 13.1 to 17.2, Lc 95 to 99 |
| Muted on Ground, Surface, Sunken and Wash                        | 5.9 to 7.8, Lc 69 to 87    | 7.5 to 10.4, Lc 60 to 68  |
| Action as text on Ground, Surface and Sunken                     | 4.56 to 5.96, Lc 61 to 79  | 7.8 to 9.7, Lc 62 to 65   |
| On action on Action                                              | 5.96, Lc 84                | 9.79, Lc 66               |
| Warning and Danger on Ground and Surface                         | 5.5 to 7.1, Lc 72 to 83    | 8.7 to 10.5, Lc 64 to 73  |
| Edge on Ground, Surface and Sunken                               | 3.5 to 4.8                 | 4.6 to 6.0                |
| Ink to Muted                                                     | 2.30                       | 1.64                      |
| ΔE00 Action and Warning, Action and Danger, Action and Content   | 24.2, 23.4, 52.7           | 22.8, 24.1, 51.7          |
| ΔE00 Warning and Danger, Content and Warning, Content and Danger | 41.3, 53.1, 56.1           | 43.9, 59.0, 50.1          |
| Action vs the nearest earlier-round action                       | 46.0                       | 41.9                      |
| Ground OKLCH                                                     | L 0.943, C 0.017, hue 242  | L 0.178                   |

**Difference from Mise.** The ground is blue (hue 242), and Mise is green. Glacier is also visible at swatch
size, so the palette passes the "content hue" test. The ground's own shift (ΔL 2.8, ΔC 0.014) is below the other two
thresholds, and I say so.

**Swatch strip.** The strips render on the palette sheet. They read as "ice blue and blue-black with one hot
orange-red", which no earlier round used.

**Not checked:** ΔE00 against Designers 1 and 2. I had not seen their files.

## Type

- **One family: Atkinson Hyperlegible Next** (Braille Institute, 2025), at weights 400, 600 and 800.
- **Why:** it was drawn for low-vision reading, and a cook reads through steam at 60 to 90 cm.
- **Ramp:**

    | Use                   | Size / line height | Weight |
    | --------------------- | ------------------ | ------ |
    | Large title           | 34/37              | 800    |
    | Recipe title          | 30/33              | 800    |
    | Section               | 21/25              | 800    |
    | Row title             | 19/22              | 800    |
    | Body                  | 17/25              | 400    |
    | Secondary (Slate)     | 16/22              | 400    |
    | Label (Ink only)      | 13/19              | 600    |
    | Cook-mode step (spec) | 30/38              | 600    |

- **Sizing:** every text size is in rem, so 200% text reflows.
- **Spacing:** the scale is 4, 8, 12, 16, 24, 32, 48. Gaps between groups are 24 or more. Gaps inside a group are
  4 to 12.
- **Risk:** the face's dotted zero has no plain alternative. I tested `zero`, `ss01` to `ss05`, `salt` and `cv01`, and
  none of them changes it. It helps legibility, but some readers will find "800 g" slightly technical.

## Motion

Motion happens only after an action, 120 to 200 ms, and nothing moves at rest:

- A tick fills the box and strikes the line.
- A pressed button scales to 0.98.
- The switch slides.
- Tapping a step number moves "You are here".
- The servings stepper rescales every quantity in both ingredients and steps.

`prefers-reduced-motion` turns every transition off.

## Self-review (canon §5), from the renders

**A. Fresh, not dated**

| Check                                     | Result      | Evidence                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Year of each choice                       | Pass        | Ice ground: 2025 to 26. Hyperlegible voice: 2025. Flush food column: unshipped. Persimmon: current. None reads as 2015 to 19.                                                                                                                                                                             |
| House answer, two axes                    | Pass        | It sits beside the house frame on my contact sheet (a local render, not a delivered file: `/tmp/claude-1000/-home-brandon-Development-KitchenSink/7091c8e5-d5b1-4d19-bb4d-8da0ff6bbb8c/scratchpad/d3/contact.png`) and does not sort with it: an edge column vs a top hero, and an ice ground vs neutral. |
| Closest app and difference                | Pass        | NYT Cooking's list: an inset rounded thumbnail vs a flush continuous column.                                                                                                                                                                                                                              |
| Food is the largest, most colourful thing | Pass        | True on Home and on the recipe page.                                                                                                                                                                                                                                                                      |
| One signature, banned places written      | Pass        | See the taste argument.                                                                                                                                                                                                                                                                                   |
| Survives 320 px and 200% text             | Pass        | Rendered.                                                                                                                                                                                                                                                                                                 |
| Excitement test                           | Not checked | The search was weak, so this is not a full pass.                                                                                                                                                                                                                                                          |

**B. Distinct options**

| Check                                                     | Result  | Evidence                                                |
| --------------------------------------------------------- | ------- | ------------------------------------------------------- |
| Palette complete in both themes, with every ΔE00 reported | Pass    | Tables above.                                           |
| Distinct from Designers 1 and 2                           | Not run | I had not seen their work.                              |
| Distinct from my own Enamelware                           | Pass    | It is on the contact sheet. No circles, rims or cobalt. |

**C. Simple**

- No novel interaction anywhere. The parts are tabs, large titles, rows with chevrons, a segmented control, search,
  chips, a stepper, checkboxes, a switch and timer buttons. **Pass.**
- One filled primary on every screen, low and labelled. **Pass.**
- Every target does one thing. **Pass.** The lead pick is not a card: its picture opens the recipe, and its two buttons
  sit in their own row below it.
- No gesture-only actions. **Pass.**

**D. Psychology**

- The list ledger is written, above. **Pass.**
- Load more comes with a count. **Pass.**
- Gaps between groups are at least twice the gaps within them. **Pass.**
- Quantities sit inside the steps, and the current step is marked with a wash, a filled number and words. **Pass.**
- The first screen shows the main action. **Pass**, at 100% and at 200%. The first 200% render failed: the header
  filled the screen. At 200% the date and the "Picked from" line now hide, and the large title is capped at 40 px
  (measured in Playwright). The lead pick now starts at 315 px, above the tab bar at 760 px.

**E. Calm**

- Persimmon appears only on the primary, links, the current tab, ticks, the timer buttons and the selected chip
  outline. **Pass.**
- Nothing moves at rest. **Pass.**
- One type family. **Pass.**
- Weeknight mood. **Pass.**

**F. Cooking**

- The opening screen in both the cooking and the deciding state: **Pass.** It is rendered, and the cooking state is
  limited to a live session.
- **Not rendered:** cook mode itself, meaning one step at 30 pt, fixed Next and Previous, the screen-awake strip and
  the timer strip. It is specified in the ramp and in canon §4 only.

**G. Accessibility and states**

| Check                     | Result | Note                                                                                                                                |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Contrast                  | Pass   | All figures above. The first render had Slate text below 16 px (fact labels, chip counts, tab labels). Those are now 16 px, or Ink. |
| Colour never the only cue | Pass   | A ticked line has a tick, a strike-through and muted text.                                                                          |
| Targets of 44 px or more  | Pass   | The first render failed: timer buttons were 32 px, and chips, step numbers and segments were 40 px. All are now 44 px, measured.    |
| 320 px and 200% text      | Pass   | Tab labels keep a fixed size, matching iOS, which uses the large-content viewer for them.                                           |
| States                    | Partly | Deciding, cooking and first-run are rendered. Loading, error, offline and success are not drawn.                                    |

**Nielsen's 10 heuristics.** Two violations:

- **H1, visibility of system status.** "Others" gives no hint of how many sets exist. Fix: an announced "Showing 4 to 6
  of 9".
- **H5, error prevention.** A cook can tap "Start cooking" on the wrong lead pick. It is cheap to leave, since Back
  returns to Home with no state lost.

No other violations found. This is heuristic judgement, untested.

**Contact sheet: four answers**

- **Stranger:** the house answer is a top photo band and a list. Food Edge is a food column down the left edge.
- **Year:** 2026.
- **Family:** it does not pile with the house answer or with Enamelware.
- **Mood:** a weeknight kitchen.

## Owner pre-mortem

| Reaction                    | Observed cause                                                                                      | Response                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Dated"                     | Some viewers will read the pale blue as clinical or fintech.                                        | Persimmon and the food keep it warm, and Kawauchi's light is the intent. I accept the risk.                                      |
| "Boring, just a list"       | The structure is a plain list.                                                                      | That is deliberate: the canon wants a familiar structure. The freshness is the flush column, which is visible at thumbnail size. |
| "Too clever"                | None                                                                                                | Nothing to learn.                                                                                                                |
| "No palette"                | None                                                                                                | Full table, both themes, measured.                                                                                               |
| "Ignores how people scroll" | None                                                                                                | The ledger is followed. The only sideways row is the chips.                                                                      |
| Round-1 fault: 320 px       | The lead's button wrapped to "Start / cooking" inside a narrow column.                              | Moved to a full-width action row. Re-rendered.                                                                                   |
| Round-1 fault: 200% text    | `.cap p` pinned paragraphs at 16 px, the stepper overflowed, and the stepper and "Others" collided. | Fixed and re-rendered.                                                                                                           |
| Round-1 fault: imagery      | The food art was dark and muddy.                                                                    | Brighter tables and plates, less blur.                                                                                           |

## Delivery gate

| Frame card | Data audit | Ledger | Strikes | Taste | Signature tests | Prior art     | Palette + script | Swatch strip | States | Screenshots                          | Self-review | Pre-mortem |
| ---------- | ---------- | ------ | ------- | ----- | --------------- | ------------- | ---------------- | ------------ | ------ | ------------------------------------ | ----------- | ---------- |
| Done       | Done       | Done   | Done    | Done  | Rendered        | Weak, flagged | Exit 0           | Rendered     | 3 of 7 | 1400, 390, 320, 200%, light and dark | Done        | Done       |

**Not run:**

- ΔE00 against the sibling options.
- Cook mode, web width, and the loading, error, offline and success states.
- A live app-store check for the excitement test.
- Real photos. The imagery is drawn SVG stand-ins, because the brief allows no external assets.
- Device testing at 60 and 90 cm.

All my judgement here is heuristic. No user tested this design.
