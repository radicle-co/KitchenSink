# Option 2: Deli Counter

Designer 2. Mockup: [`option2.html`](option2.html). It is one file of 69.9 KB, with four real dish photos embedded as
small WebP data.

- **How I checked it.** I rendered it with Playwright at 1400, 390 and 320 px, in light and dark, and at 200% text.
  No render scrolls sideways, and none shows a script error.
- **Why the page and this spec agree.** The palette sheet in the page is generated from the token list that the
  palette script checks.
- **What my review is.** Heuristic judgement. It is not tested with users.

## Pick, and why

I pick Deli Counter, the one option I kept. It moves freshness into the system:

- the composition: stacked, wide food slices
- the type: narrow, deli-card names
- where colour lives: pistachio glass in the ground, Delft blue only on what you press.

The controls stay plain. It also gives Home a real decision aid from stored facts: the time each dinner is ready.

## The idea in two sentences

Your recipes are laid out like the glass case at a good deli. Each dish is a wide slice of real food with a clean
name card on a pick in front of it. On Home, the card shows the dish's "price": the clock time it is ready, for a
start now. Everything you press is the plain tab bar, list, stepper and one blue button you already know.

**Visual thesis (50 ms).** A stranger sees tiers of real food, each with a small white card on a pick, on a
pistachio-green ground. Only Commise looks like this, because only a cook's own library needs its dinners read like
a counter: name and readiness at a glance, from a step away.

**Palette: Delft & Pistachio.** The pistachio-green of the deli case glass is behind everything. The deep blue of the
Delft tiles behind the counter marks the one thing you press.

## Step 0: point of view, medians and peers

- **My habits, struck at the start.**
    - Type: a regular-width grotesk. I chose one family at two widths instead.
    - Food: one full-bleed hero photo.
    - Composition: a large title, a hero, then a list.
    - Colour: near-white with one deep warm accent.
- **Mood.** It is 6:10 pm and someone asks "what's for dinner?". The cook wants an answer at a glance and a small
  lift, the way a well-lit deli case gives you one after work. A deli counter is an errand, not a night out.
- **References.**
    - **The tiered refrigerated cases of a Japanese depachika food hall, such as Isetan Shinjuku's B1.** These are
      long, low shelves of food with a crisp white name card on a stand in front of each dish. Few designers pick it.
      It is a shop fixture, not a design object, and it is not on moodboards.
    - **The plastic price-card picks that delis push into a tray of food.** A white card with bold, narrow type, the
      name on the left and the price set big on the right. It is too ordinary for anyone's reference list.
- **Refusal.** I will not put any expressive element in a control, in cook mode, or behind body text.
- **Category median.** A cream or white ground, a soft serif, a 2×2 card grid with square thumbnails, and an orange
  or green accent.
- **House answer (2026).** A near-neutral white ground, one grotesk, a large title, one full-bleed photo and a
  strict list of 72 px rows. It has one deep warm accent (beetroot, copper or paprika) on the button. My instinct
  matched this, and I struck it.
- **Inversions.** The house answer on a dark or deep-coloured chrome. The median on a cool white ground.
- **Peer prediction.**
    1. The v4 convergence: near-white, a grotesk, a full-bleed photo, a list and a deep warm accent, with "How long
       have you got tonight?".
    2. The over-correction to judge v4: a strongly coloured panel or chrome to show "energy".
    3. A cool "fridge light" ground with blue-black ink and a warm orange-red accent, so that warm food reads warmest.

**What happened with my own palette.** I changed it three times, each time from a measurement. Prediction 3 came
true twice.

1. My first palette, "Ice & Pimento", was prediction 3 exactly. Option 3 (Food Edge) then landed in `round0/`. The
   grounds were ΔE00 1.5 apart and the actions 8.1 apart, so the two were one palette.
2. "Mortadella" (raspberry on pistachio) was 11.7 ΔE00 from Option 1's crimson. After I moved it toward plum, it
   was 3.7 from the Beetroot of probe v4, the family the judge flagged.
3. So I left the red and purple family completely. Delft blue is 41.3 / 36.3 ΔE00 from Option 1, 44.2 / 37.4 from
   Option 3, and 33.4 / 30.2 from Beetroot.

## Divergence: concepts, sources and strikes

| #   | Concept                                                      | Need, and source   | Verdict                                                                 |
| --- | ------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| 1   | Giant numerals you can read from the stove                   | distance           | Struck: the canon names big type as a lever, and it is peer 3           |
| 2   | Section headings as signage panels                           | distance           | Struck: the label/eyebrow family (probe v4)                             |
| 3   | Chunky silicone-material controls                            | hands              | Struck: novelty in controls, and it reads as neumorphism                |
| 4   | Food above, every action in a counter slab below             | hands, reach       | Struck: a shipping pattern (map sheet, Invites)                         |
| 5   | Hob glow on what is happening now                            | heat               | Struck: round 3 Pilot Light                                             |
| 6   | Cast-iron dark chrome                                        | heat               | Struck: v3 went dark, and it reads as a night out                       |
| 7   | Plates sized by time                                         | timing             | Struck: round 2, too clever                                             |
| 8   | "Ready by 6:55" clock time as the deciding reason            | timing             | Kept as content. Prior art exists, and Food Edge reached it too (below) |
| 9   | Dish-colour wash                                             | the dish           | Struck: a canon permission                                              |
| 10  | Cut-out food on coloured fields                              | the dish           | Struck: shipping (Sweetgreen)                                           |
| 11  | Produce PLU-sticker badges                                   | the shop           | Struck: the sticker/tape family                                         |
| 12  | A week strip on Home                                         | the week           | Struck: not built                                                       |
| 13  | Place settings for the household                             | household          | Struck: round 2 Table                                                   |
| 14  | Tall portrait photo column                                   | the dish           | Struck: probe v4 B                                                      |
| 15  | Deli case: wide food slices, each with a name card on a pick | the dish, distance | **Kept**                                                                |

Option 15 differs from the house answer on two named axes:

1. **Composition and hero form.** Food is shown as stacked wide slices, 168 px tall and full width. Each has an
   opaque card overlapping its lower edge. The house answer has one full-bleed hero followed by thumbnail rows.
2. **Type genre.** The names are set narrow (Archivo at 75% width), like a deli card. Sentences use normal width.

The palette is a third difference: tinted green glass and a cool blue action, not neutral and copper.

**Taste argument.**

- **What the stranger sees.** A counter of food, each dish labelled like something you point at and buy.
- **The trajectory step.**
    - Liquid Glass (2025-06), Material 3 Expressive (2025-05) and Airbnb's 2025 relaunch all show layering with
      containment and depth.
    - My step past them: the layer is a real, opaque object standing in front of the food, not glass, and it changes
      no control.
    - It did not ship before 2022 because flat-era cards sat beside photos, not in front of them.
- **Mood test.** It is a counter you visit on the way home, not a restaurant.
- **The boldest version, and the edits.** The boldest version had tiers butting with no gap and a tilted card. I
  kept the tiers big and full width. I dropped the tilt: it read as a sticker, and the sticker family is already
  struck.

## Frame card

| Screen            | Job, in the cook's words                      | Mode                | One primary                                                                             |
| ----------------- | --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| Home, deciding    | "Help me pick dinner and get going."          | planning            | **Start cooking** on the top pick                                                       |
| Home, cooking     | "Take me back to where I was."                | cooking             | **Back to step 3**                                                                      |
| Home, nothing yet | "How do I start?"                             | planning            | **Add a recipe**                                                                        |
| Recipe            | "Show me how to make this, then let me cook." | planning to cooking | **Start cooking** (docked low)                                                          |
| My recipes        | "Find or add one of my recipes."              | planning            | **New recipe** (docked). Finding uses the search field, which is a field, not a button. |
| Cook mode         | "Next step, hands busy."                      | cooking             | **Next step**                                                                           |

- **What a first-time user must understand without learning:** a picture of food with its name is a recipe, and the
  one blue button does the obvious thing.
- **Sign of success:** they tap a dish or Start cooking within seconds.
- **Sign of mere prettiness:** they admire the slices but cannot tell which button starts.

**Data audit.** From `recipe-service/src/recipes/recipes.schema.ts` and `database/schema/recipes.ts`.

- **Stored:**
    - Title, description, cuisine, difficulty, mealType and servings.
    - Prep, cook and total minutes.
    - Tags and dietary flags.
    - Ingredients: quantity (which can be a range), unit and notes.
    - Steps: instruction and `timerSeconds`.
    - The rating aggregate, status (draft), visibility, and created and updated time.
- **Not stored:** a per-user cook history, or the cook's place in a recipe. Cook marks live only in memory.
- **The list API cannot serve Home as drawn.** `listRecipesQuerySchema` takes only page, pageSize (with the
  `MAX_RECIPE_LIST_PAGE_SIZE` bound) and `sortBy` (`updatedAt`, `createdAt` or `title`). It has no `mealType` filter
  and no time sort.
- **Two ways to build Home:**
    - Add a `mealType` filter and a `totalTimeMinutes` sort to the API. This is my recommendation.
    - Or sort on the client over one bounded page. Then Home must say "from your 50 most recently edited recipes",
      with the size taken from the page limit.

Home uses only stored values and arithmetic:

- `mealType = dinner`
- order by `totalTimeMinutes`
- "Ready by" = the current clock time + `totalTimeMinutes`
- servings.

The cooking state is drawn as session-only, and its copy says so. There is no "you cooked this", no "not opened
lately", and nothing about unbuilt features beyond one line.

## List ledger

| List                            | Direction                                     | Why                             |
| ------------------------------- | --------------------------------------------- | ------------------------------- |
| Tonight's dinners (Home)        | vertical                                      | You compare them                |
| Ingredients                     | vertical, with ticks                          | A sequence you go through fully |
| Steps                           | vertical                                      | A sequence                      |
| My recipes                      | vertical, "Load more · 18 more", with a count | A large collection you scan     |
| Filter chips                    | horizontal, with the next chip peeking        | An optional set of peers        |
| Facts (total, prep, difficulty) | one row, which wraps to a column at 200%      | Three short facts, not a list   |

## Why it is simple, screen by screen

- **Home.**
    - The date and the account button.
    - The large title "Dinner tonight", with one line: "Your dinners, quickest first. Ready times assume you start
      now."
    - The slices, each one tap to its recipe.
    - The top dish has the one filled button, Start cooking. It sits outside the card, so each target does one thing.
    - Then "All your recipes 24 ›" and one line: "Coming soon: meal plans and a shopping list."
    - The tab bar holds Home, Recipes and Discover, the app's real three tabs.
- **Recipe.**
    - The top area:
        - A 228 px slice of the dish, with a dark scrim under the status bar. It is not a full screen, so there is no
          false floor.
        - Back, Edit and More on solid discs.
        - The name card carries the title at 30 px.
    - Then:
        - Cuisine, diet, meal, and the rating with a star.
        - Total, Prep and Difficulty.
        - Ingredients with a Serves − 4 + stepper and checkboxes. A ticked line gets a filled tick, grey text and a
          strike-through.
        - Steps with quantities in bold inside the text. Every duration is a labelled timer button.
        - The current step has a pale blue wash and the words "You are here".
        - Source, Version history, and calories per serving.
    - Start cooking is docked low, above the tab bar.
- **My recipes.**
    - The large title, a My recipes / Collections segmented control, search, and filter chips that peek.
    - "24 recipes" and "Recently edited ⌄".
    - Rows with a wide slice, the name, the cuisine, and the time set like a price on the right, then a chevron.
    - Draft and Private are outlined tags with an icon.
    - A recipe with no photo gets a pistachio slice with a fork mark, never initials.
- **States.** These are drawn in one frame:
    - offline, as a calm line
    - loading, as a skeleton card
    - error, with "Try again"
    - success, as a "Recipe deleted" snackbar with Undo.
- **Cook mode.** White, opaque and neutral, with no slice, card or pick.
    - "Step 3 of 5", with progress segments.
    - 28 px step text with bold quantities, and "Start 30 min timer".
    - A running-timer strip above Previous and Next step, which are 68 px tall at the bottom.
    - A visible "Screen stays on", switched on by the cook's own Start cooking tap.

## The signature: the name card on its pick

- **What it is.** A white, opaque card with bold, narrow type. A thin dark stem with a pistachio head rises from the
  card into the food, like the price-card picks in a deli tray. On Home, the card shows "Ready by 6:55" set big at
  the right, where a deli card puts the price. The library rows carry the same price setting for the time.
- **Where it comes from.** The dish photo, and distance. A name card in front of food is the label a hungry person
  reads from a step away.
- **What it encodes.** Nothing. The card holds the title and facts, which are content. The pick and the card shape
  carry no data. Without them nothing is lost, because the title and times then sit in a plain row.
- **Where it is banned.** In cook mode, in every control, and behind body text. It never sits on a raw photo: the
  card is opaque, and the stem is decoration.
- **Real content.** "Green pea and barley risotto with feta" at 320 px and at 200% text:
    - the card grows to five lines
    - "Ready by" wraps under the title
    - the pick stays.

    The signature stays visible and does not fall back to a system style.

- **Prior art (searched).**
    - Searches for a food list with deli price-tag cards on picks found no shipping app. The closest are generic
      photo-card recipe lists, such as Tubik's recipe-card study and Motiff's concept, with a photo and the title
      below.
    - **Closest shipping app:** NYT Cooking. Its nearest feature is a large image card with the title beneath.
    - **Visible difference:** the name is on an opaque card standing in front of a wide slice, on a pick, with the
      ready time set like a price.
    - **The "ready by" content is not new.** The _Easy Cooking Timer_ iOS app shows the ready time for a start now.
      _Dinner Ninja_ works backward from a finish time. Option 3 also shows "Ready by 6:45 pm". So the clock time is
      shared, useful content, not the signature.
- **Excitement test.** What a viewer screenshots is a Home of stacked food slices with little deli cards reading
  "Ready by 6:35". The searches found no app that does this. The search is limited, and I name that gap below.

## Palette: Delft & Pistachio

**The idea.**

- Green glass flatters herbs, peas and greens.
- Blue is the one colour no food wears, so the button never competes with the dish and the dish stays the warmest
  thing on screen.
- Delft tiles are a kitchen and shop object, not a tech brand.
- The ground is pistachio green, not cool grey, so the blue does not read as SaaS.

| Name       | Role                                                                | Light     | Dark      |
| ---------- | ------------------------------------------------------------------- | --------- | --------- |
| Case glass | Ground                                                              | `#E2EDDA` | `#0B110A` |
| Tag        | Surface: name cards, lists, tab bar                                 | `#FFFFFF` | `#141B12` |
| Shell      | Sunken: segmented track, avatar, skeleton                           | `#D0E0C5` | `#1C2519` |
| Rail       | Edge: control outlines, unticked boxes                              | `#667A5C` | `#7E8E76` |
| Peppercorn | Ink                                                                 | `#111A0F` | `#EDF3E8` |
| Sage       | Muted, 16 px and up                                                 | `#46553F` | `#B3C1AB` |
| Delft      | Action: the filled button, links, current tab, ticks, timers, focus | `#204A80` | `#A7C6EE` |
| On delft   | Label on the action fill                                            | `#FFFFFF` | `#0A1A30` |
| Glaze      | Action wash: selected chip, current step                            | `#E1EAF5` | `#172537` |
| Mustard    | Warning, with an icon, and the rating star                          | `#6B4C00` | `#F0C24E` |
| Paprika    | Danger, with an icon. Delete is a text row                          | `#A33A00` | `#FFA066` |
| Seam       | Hairline                                                            | `#CADBBE` | `#26311F` |
| Pistachio  | Content hue: the pick's head and the no-photo field only            | `#9CC45B` | `#A9CC6A` |

**Script output.**

- **The script:** culori 4.0.2 plus APCA 0.0.98G. I implemented APCA from its constants because no package was
  installed.
- **Behaviour:** it exits non-zero on any fail. The final run gives `ALL PASS` (80 checks).
- **Where text is measured:** on Case glass, Tag, Shell and Glaze.

| Check                                               | Light                         | Dark                         |
| --------------------------------------------------- | ----------------------------- | ---------------------------- |
| Ground OKLCH L                                      | 0.93                          | 0.17                         |
| Peppercorn                                          | 8.88 to 17.82:1, Lc 64 to 105 | 10.5 to 16.92:1, Lc 69 to 98 |
| Sage                                                | 5.76 to 7.98:1, Lc 67 to 88   | 8.21 to 10.13:1, Lc 64 to 66 |
| Delft as text                                       | 6.44 to 8.93:1, Lc 69 to 90   | 8.82 to 10.88:1, Lc 68 to 70 |
| On delft                                            | 8.93:1, Lc 94.6               | 9.94:1, Lc 69.9              |
| Mustard                                             | 5.7 to 7.9:1, Lc 66 to 87     | 9.44 to 11.41:1, Lc 71 to 73 |
| Paprika                                             | 4.79 to 6.64:1, Lc 61 to 82   | 7.89 to 9.53:1, Lc 61 to 63  |
| Rail (edges)                                        | 3.36 to 4.66:1                | 4.53 to 5.48:1               |
| Ink on Pistachio (no-photo field)                   | 8.88:1, Lc 63.6               | 10.5:1, Lc 69.4 (dark text)  |
| Peppercorn to Sage                                  | 2.23:1                        | 1.67:1                       |
| ΔE00 Delft and Pistachio                            | 66.5                          | 44.4                         |
| ΔE00 Delft and Mustard                              | 43.7                          | 42.6                         |
| ΔE00 Delft and Paprika                              | 43.4                          | 39.1                         |
| ΔE00 Pistachio and Mustard                          | 44.3                          | 21.3                         |
| ΔE00 Pistachio and Paprika                          | 56.2                          | 38.7                         |
| ΔE00 Mustard and Paprika                            | 20.2                          | 20.3                         |
| Delft vs the five earlier-round actions, minimum    | 26.2                          | 21.9                         |
| Delft vs Option 1 (Carton) `#C41E3A` / `#FF968A`    | 41.3                          | 36.3                         |
| Delft vs Option 3 (Food Edge) `#B33A06` / `#FFA478` | 44.2                          | 37.4                         |
| Delft vs probe v4 Beetroot `#8C1D4F` / `#F7A6CA`    | 33.4                          | 30.2                         |

**Difference from the reference "Mise".**

- The light ground moves ΔL×100 −3.9 and ΔC +0.02, which meets the 0.02 C test.
- The content hue is visible at swatch size.
- The action is 48.9 ΔE00 from Leaf.

**Swatch test.** The strips are rendered in the page.

- Light reads as "pistachio and Delft blue".
- Dark reads as "forest night with a sky-blue button".
- Carton's strip is white, sky and tomato. Food Edge's is ice and persimmon. A stranger can tell all three apart.

**Fixes the script caught along the way.**

- Dark muted and dark action were under Lc 60.
- Dark Warning was 5.4 ΔE00 from the content hue.
- Light action and Warning were under Lc 60 on Shell.
- Each action change is described in Step 0 above.

## Type

- **One family:** Archivo (Google Fonts, variable width and weight).
- **Names** (large title, name card, section headings): 75% width, weights 760 to 790.
- **Sentences:** normal width.
- **Sizes:**
    - large title 34 px
    - card 24 px, or 30 px on a recipe
    - section 24 px
    - body 17/25
    - meta 16 px in Sage
    - cook step 28/36 at weight 560, with quantities at 800.
- **Tab labels:** 12 to 13 px in Ink. They are capped like the platform tab bar, which uses the large content
  viewer instead of growing.
- **Scaling:** all other type and spacing is in rem, so 200% text reflows.
- **Spacing scale:** 4, 8, 12, 16, 24, 32.

## Motion

- Only two things move: a press scales a button to 98% in 100 ms, and a tick fills in 180 ms.
- Under Reduce Motion, both are off. The CSS uses `prefers-reduced-motion: no-preference`.
- Nothing moves at rest.

## Canon rules applied (key decisions)

- **§2.1 structure vs look.** Every control is conventional:
    - tab bar, large titles and back
    - segmented control, search and chips
    - stepper, checkboxes, snackbar with Undo
    - one filled pill.

    Freshness lives in the slices, the cards and the narrow type.

- **§2.2 rules 1 to 3.** One signature, the card on its pick. It encodes nothing, and it is banned from cook mode and
  from controls.
- **§1.3 scrolling.** See the ledger. The only horizontal row is the filter chips, with a peek.
- **§1.4 first screen.** Home's first screen says what it is, shows the primary, and shows the next slice starting,
  so there is a reason to scroll.
- **§4 opening screen.** The cooking, deciding and nothing-yet states are drawn. Deciding uses stored values only
  the API gap is named above.
- **§4 cooking.**
    - Quantities sit in the steps, and durations are timers.
    - The current step is marked, and scaling uses a stepper.
    - Cook mode shows one step at 28 px, with fixed, labelled Next and Previous.
- **§3.4 rules.**
    - Delft means "press" or "done", and nothing else.
    - A tick gets a fill, grey text and a strike-through.
    - Danger is a text row.
    - Food is never tinted, and a scrim sits under the status bar on photos.
- **Hick, Fitts and von Restorff.** One filled primary, low and wide, with a word on it.

## Self-review (canon §5), from the renders

**A. Fresh.**

- **Year each choice reads as:**
    - pistachio glass ground: 2025 to 2026
    - narrow display type: 2024 to 2026
    - wide food slices with opaque cards: 2026
    - deep blue action on green: 2025 to 2026.
- **House answer:** it differs on composition and on type genre. Pass.
- **Closest app:** NYT Cooking, with the difference named above. Pass, from search.
- **Food:** the photos are the largest and most colourful thing on Home and on the recipe page. Pass.
- **Signature at 320 px and 200% text:** pass, seen in the render.
- **Data honesty:** pass, with the API gap named.
- **Weakness:** the photos are the repo's restaurant-plated mockup photos (`docs/mockups/_assets`). They are real
  photos, but they are not home cooking.

**B. Distinct.** I made a contact sheet of all three options at thumbnail size, in light.

- **Stranger:**
    - Carton is one big white card with a sky-blue window per screen.
    - Food Edge is a column of food down the left edge with rows beside it.
    - Deli Counter is stacked full-width food slices with small cards.

    These are three structures.

- **Palettes:** they pass the swatch test, and every action is more than 36 ΔE00 from the others.
- **Shared content:** Food Edge also shows "Ready by", which is the same derived value. Here it is a price on a card
  there it is a line in a row.

**C. Simple.**

- New interactions for navigation and controls: none.
- Every screen answers where am I, where can I go and how do I get out (tab bar or back).
- Every screen has exactly one filled primary.
- There are no gesture-only actions and no nested targets. Start cooking sits outside the card link.

**D. Psychology.**

- **Lists:** see the ledger. Large lists use "Load more" with a count.
- **Gaps:** 20 to 32 px between groups, 4 to 12 px within groups.
- **Feedback:** a press state and a tick within 100 ms, and Undo on delete.
- Pass.

**E. Calm.**

- **Delft elements per screen:**
    - Home: the primary and the current tab.
    - Recipe: the primary, the current tab, one tick, five timer buttons and one link.

    The timers are pressable, so they are allowed. They are the busiest part, so they stay outlined, not filled.

- **Type:** one family.
- **Motion:** none at rest.
- **Weeknight test:** a deli counter, not a night out. Pass, on judgement.

**F. Cooking.**

- **Shown:** one step at 28 px, quantities inline, a tappable timer, and labelled Next and Previous, low and fixed.
- **Screen awake:** turned on by the cook's own action.
- **Kept out:** glass, and any photo in cook mode.
- **Result:** pass, drawn in light only.

**G. Accessibility.**

- All contrast figures are listed above.
- Targets are 44 px or more.
- No sideways scroll at 320 or 390 px, at 100% or 200% text.
- **States drawn:** deciding, cooking, nothing yet, no photo, loading, offline, error and success (snackbar).
- **Not done:** I did not write the copy at its longest localised length. Pass, with that note.

**Nielsen's 10, violations and fixes.**

- **H1 Visibility of status:** marks are not stored, so the Home cooking state goes away at app close. The copy says
  so. The fix is to store the cook's place.
- **H4 Consistency:** "Edit" is a top-bar disc on the recipe page, while New recipe is low. I accept this, because
  Edit is the rarer action.
- **H9 Error recovery:** the import-failure screen is not drawn. Its fix is the same as the error card: say what
  happened and give one way out.

No other violations were seen.

**Contact sheet: four answers.**

- **Stranger:** three different structures, as listed under B.
- **Year:** 2026.
- **Family:** I do not sort it with the house answer, because the slices and cards show at thumbnail size. It is
  not a twin of either peer.
- **Mood:** a weeknight kitchen.

## Owner pre-mortem

| Owner's reaction                                                     | Answer                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "Dated."                                                             | The risk is the white cards. An opaque card standing in front of food is the 2025 depth lesson, made real. It has no shadow grid and no cream. |
| "Twins."                                                             | The palette was a twin of Food Edge's, and then sat in the Beetroot family. I measured both and moved twice. The structure was never a twin.   |
| "Too clever."                                                        | The pick is decoration, and the card is only the title. Nothing has to be learned.                                                             |
| "No palette."                                                        | Delft & Pistachio has a full role table with measured figures.                                                                                 |
| "Ignores how people scroll."                                         | Everything is vertical except the chips, which peek.                                                                                           |
| Remaining harshest reaction: "the photos look like restaurant food". | That is true. It needs real home-cooked photography.                                                                                           |

## Delivery gate

| Cell                           | Deli Counter                                              |
| ------------------------------ | --------------------------------------------------------- |
| Frame card                     | Done                                                      |
| Data audit                     | Done. The list-API gap is named.                          |
| List ledger                    | Done                                                      |
| Sources and strikes            | Done: 15 concepts, 13 struck                              |
| Taste argument                 | Done                                                      |
| Signature tests                | Done at 320 px and 200% text                              |
| Prior-art search               | Done: four web searches, which is a limited scope         |
| Palette and script output      | Done: `ALL PASS`                                          |
| Swatch strip                   | Rendered in the page                                      |
| States                         | Done (localised copy at its longest is not done)          |
| Screenshots                    | 390 px, 320 px, both themes, 200% text, 1400 px           |
| Self-review                    | Done                                                      |
| Pre-mortem                     | Done                                                      |
| Four medians and contact sheet | Medians written. Contact sheet of all three options made. |

## Not run, and why

- **Web width, and dark cook mode:** not drawn, to keep the file near 70 KB.
- **Prior-art and excitement search:** web searches only. I did not check top-chart app screenshots one by one.
- **Increase Contrast variants:** not computed.
- **Distance test at 60 and 90 cm:** not done on a device.
- **The medians:** written, not rendered.
