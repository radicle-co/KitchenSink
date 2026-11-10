# Option 2: Deli Counter (round 1)

Designer 2. Mockup: [`option2.html`](option2.html). It is one file of 71.0 KB, with four real dish photos embedded as
small WebP data URIs in the CSS.

- **How I checked it.** I rendered it with Playwright at 1400, 390 and 320 px, in light and dark, and at 200% text,
  and looked at every frame. No render scrolls sideways, and none logs a script error.
- **Why the page and this spec agree.** The palette table in the page is generated from the token list that the
  palette script checks. The build checks that no text sits on Pistachio, and fails on a hit.
- **What my review is.** Heuristic judgement, untested with users.

## Pick, and why

Deli Counter is the one option I keep. The structure from round 0 stays: stacked, wide food slices, each with a white
card in front. Three things changed:

- **The signature** is now the card itself, set like a deli price card: a pistachio rail across the top, and the
  ready time set big at the right, like a price. The pick and its dot are gone.
- **The palette** is now **Prosciutto & Pistachio**. Delft blue read as Microsoft Word.
- **Home** now offers three dinners for three different stored reasons, not one sorted list.

## The idea in two sentences

Your dinners sit like dishes in a deli case. Each is a wide slice of real food, with a price card in front that gives
its ready time. You press only the plain tab bar, list, stepper and one deep-red button you already know.

**Visual thesis (50 ms).** A stranger sees tiers of real food on pale green glass. Each has a white card with a green
rail and a big "6:35 pm". Only Commise looks like this, because only a cook's own library needs its
dinners read like a counter: name and readiness at a glance, from a step away.

## Changes this round

Each critique point, my answer and the evidence. D1 is Designer 1's critique. D3 is Designer 3's critique.

| Point                                                                          | Who         | Answer                                          | Evidence and change                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delft reads as an office suite                                                 | D1, D3      | **Accepted**                                    | `#204A80` is ΔE00 5.1 from Word's `#2B579A`. Blue is gone.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The pick's dot reads as a shoppable hotspot                                    | D1, D3      | **Accepted**                                    | The stem and dot are removed. Nothing on the card looks tappable.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Without the dot, a card over a photo is common                                 | D3          | **Accepted**                                    | The signature is now the price-card setting: the pistachio rail and the big ready time. See the prior-art section.                                                                                                                                                                                                                                                                                                                                                                   |
| Home re-sorts the library and gives one reason                                 | D1          | **Accepted**                                    | Three picks with three stored reasons: Quickest (total time), Fewest ingredients (ingredient count) and Biggest batch (servings). The reason is the first word of each card's facts line. I avoided Food Edge's set (stars, collection, time).                                                                                                                                                                                                                                       |
| At 320 px and 200% text, Start cooking falls below the fold                    | D1          | **Accepted**                                    | The slice height is `max(60px, calc(236px − 5rem))`, so it shrinks as text grows. The price drops to its own row in a narrow card (a container query). The large title is capped at 48 px, like the iOS large title. The date line is gone from Home. Rendered at 320 px and 200% text, the button is fully on the first screen in light and dark.                                                                                                                                   |
| My recipes uses 84 × 60 rounded thumbnails, and the signature is missing there | D1          | **Partly accepted, partly pushed back**         | The row thumbnails are now 104 × 72 px wide slices with 4 px corners. The names are in narrow type, and the time is set like a price. I did **not** use full-width slices. The library is a large list that people scan and compare (canon §1.3, and §4: planning wants density). In the 390 px renders, Home shows about 2.5 tiers per screen, and a library of tiers shows the same. The library rows show 3 full recipes and part of a fourth, under the search, chips and count. |
| Current-tab label in the action colour at 12 px                                | D1          | **Accepted**                                    | The label is Ink at weight 750. The action colour is on the icon and a 3 px bar only.                                                                                                                                                                                                                                                                                                                                                                                                |
| The gate passed Ink at Lc 64 on Pistachio                                      | D1          | **Accepted. My round-0 "ALL PASS" missed this** | No text sits on Pistachio now. The build checks this and fails on a hit. Every text surface is checked against Lc 75 for Ink.                                                                                                                                                                                                                                                                                                                                                        |
| Green food on a green page                                                     | D3          | **Partly accepted**                             | The ground is lighter and less green: `#E2EDDA` (C 0.028) is now `#E8F0DF` (L 0.94, C 0.020). I kept a visible tint, because D1 called the pistachio ground "right" and it carries the palette's swatch test. In the renders, the risotto and asparagus edges now separate from the ground.                                                                                                                                                                                          |
| Warning and Danger merge for colour-blind users                                | D3          | **Accepted**                                    | Warning has a triangle icon and Danger an octagon icon (drawn in the states frame). The rating star is Ink, not Warning. Under deuteranopia, Warning to Danger is 7.8 light and 10.6 dark. Shape, not colour, separates them.                                                                                                                                                                                                                                                        |
| The Home title changes with state                                              | D3          | **Accepted**                                    | Home's title is "Tonight" in every state.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Home's Start cooking has no stated target                                      | D3          | **Accepted**                                    | It opens cook mode at "Before you start: gather 7 ingredients", with the screen kept on.                                                                                                                                                                                                                                                                                                                                                                                             |
| D1's direction "Pistachio & Bresaola" `#6E2C2C`                                | D1          | **Accepted in family, with my own values**      | Light: a deep cured red, `#620914` (6.98 from Bresaola). Dark: the pale rose of the fat, `#FBD7D7`. I did not take D1's dark `#F0A8B8`: it is ΔE00 5.7 from probe v4's Beetroot dark and 11.8 from round-0 Tomato dark. Measured, it does sit apart from my dark Danger (25.6).                                                                                                                                                                                                      |
| D3's direction "Pimentón & Pistachio" `#94400A` on `#F1F5EE`                   | D3          | **Pushed back**                                 | 1. It is the house answer I struck in round 0: a near-white ground with one deep warm accent. 2. A smoked-paprika action leaves no room for Mustard and a red Danger in dark. My three-colour search (action 40 to 70°, warning 85 to 110°, danger 10 to 30°) found **no** dark triple that passes.                                                                                                                                                                                  |
| Photos are WebP, not CSS, SVG or canvas                                        | D3          | **Kept, and named**                             | The photos are CSS `background-image` data URIs, so they are imagery as CSS with no external asset. The canon asks for real photos (§2.2 rule 8). If the owner reads the brief more strictly, swap each one for a no-photo Pistachio slice.                                                                                                                                                                                                                                          |
| The photos are restaurant food                                                 | me, round 0 | **Still open**                                  | Real home-cooked photography is needed.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**The palette search.** I write it down so the next designer does not repeat it. I swept the whole hue wheel in both
themes. I checked against the five earlier-round actions, my own roles, Danger under deuteranopia, and contrast on
every text surface. I also checked these brand colours: Slack, Word, Facebook, LinkedIn, Teams, Discord, Stripe, IBM, Twitch, Cadbury and M3 error. The
results:

- **Aubergine,** my first pick, was ΔE00 5.4 from Slack's "Aubergine" `#4A154B`, so it fails the same way Delft did.
  The purples far enough from every brand are greyed mauves (C ≤ 0.06), which have no confident accent.
- **Raspberry** is Beetroot again (3.4 to 5.6).
- **Dark petrol and teal** sit 10 to 13 from the earlier-round mints, and from Tiffany.
- **Dark warm accents** crowd Danger. A dark Danger must pass Lc 60, so it is light. Most warm actions then sit under 15 from it or from a round-0 sibling.

One family passed in both themes. It is a deep cured red in light, and a very pale rose with a coral Danger in dark. That dark pair clears every round-0 sibling by 15 or more.

## Step 0: point of view, medians and peers

- **My habits, struck at the start:** a regular-width grotesk, one full-bleed hero, a large title then a list, and a
  near-white ground with one deep warm accent.
- **Mood.** It is 6:10 pm and someone asks "what's for dinner?". The cook wants an answer at a glance and a small
  lift, like a well-lit deli case on the way home. A deli is an errand, not a night out.
- **References.**
    - **The tiered refrigerated cases in a depachika food hall, such as Isetan Shinjuku's B1.** Few designers pick
      it, because it is a shop fixture, not a design object.
    - **Printed deli price cards:** a white card with a coloured top band, narrow bold type, and the price set big.
      They are too ordinary for anyone's reference list.
- **Refusal.** No expressive element in a control, in cook mode, or behind body text.
- **Category median.** A cream or white ground, a soft serif, a 2×2 card grid with square thumbnails, and an orange
  or green accent.
- **House answer (2026).** A near-white ground, one grotesk, a large title, one full-bleed photo, a strict list, and
  one deep warm accent. My instinct matched it, and I struck it.
- **Inversions.** The house answer on dark chrome. The median on a cool white ground.
- **Peer prediction.**
    1. Near-white, a grotesk, a full-bleed photo and a deep warm accent, with "Ready by".
    2. A strongly coloured panel or chrome.
    3. A cool "fridge light" ground with an orange-red accent.

    Round 0 showed 3 (Food Edge) and partly 1 (all three Homes said "ready by").

**Two axes away from the house answer:**

1. **Composition and hero form.** Stacked, full-width slices, each with an opaque card overlapping its lower edge.
2. **Type genre.** Names and prices in Archivo at 75% width, like a deli card.

The ground and palette are extra: a tinted glass ground, not near-white.

## Divergence (round 0 list, still valid)

I wrote 15 concepts across 8 needs and struck 13 (round-0 spec). The two I kept, merged, are the deli case (the
dish, distance) and "ready by" as content (timing). This round I struck two more ideas:

- **The pick on a stem.** It is a false signifier.
- **Full slices in the library.** They cost density (§1.3).

## Frame card

| Screen            | Job, in the cook's words             | Mode                | One primary                                 |
| ----------------- | ------------------------------------ | ------------------- | ------------------------------------------- |
| Home, deciding    | "Help me pick dinner and get going." | planning            | **Start cooking**, under the top pick       |
| Home, cooking     | "Take me back to where I was."       | cooking             | **Back to step 3**                          |
| Home, nothing yet | "How do I start?"                    | planning            | **Add a recipe**                            |
| Recipe            | "Show me how, then let me cook."     | planning to cooking | **Start cooking** (docked low)              |
| My recipes        | "Find or add one of my recipes."     | planning            | **New recipe** (docked). Search is a field. |
| Cook mode         | "Next step, hands busy."             | cooking             | **Next step**                               |

- **What a first-time user must understand without learning:** a picture of food with its name is a recipe, and the
  one red button does the obvious thing.
- **Sign of success:** they tap a dish or Start cooking within seconds.
- **Sign of mere prettiness:** they admire the cards but cannot tell which dinner the button starts. The button sits
  directly under the top card.

**Data audit.** Sources: `recipe-service/src/recipes/recipes.schema.ts`, `database/schema/*.ts`, and identity's
`settings/settings.schema.ts`.

- **Stored on the recipe:** title, cuisine, difficulty, mealType, servings, prep, cook and total minutes, dietary
  flags, ingredients and steps (with `timerSeconds`), the rating aggregate, status and visibility.
- **Stored elsewhere:** collections, and per-user ratings. A cook **cannot rate their own recipe**
  (`CANNOT_RATE_OWN_RECIPE`), so "your stars" does not exist for the cook's own library.
- **Analytics:** `recipe_saved` and `recipe_viewed` exist. There is no `recipe_cooked` event.
- **Settings** (`SETTINGS_DEFAULTS`): only `searchShortcut` and `recipeViewMode`. **Household size is not stored.**
  So the third reason is "Biggest batch · Serves 6", a stored fact. "Makes leftovers" needs a household size that we
  do not store.
- **The cook's place in a recipe is not stored.** The Home cooking state is session-only, and its copy says so.
- **The list API cannot serve Home yet.** `listRecipesQuerySchema` sorts only by `updatedAt`, `createdAt` or
  `title`, and has no `mealType` filter. My recommendation is a dinner filter and three server-side picks. The
  fallback is to compute the picks over one bounded page and say "from your 50 most recently edited".

## List ledger

| List                            | Direction                                     | Why                             |
| ------------------------------- | --------------------------------------------- | ------------------------------- |
| Tonight's three picks (Home)    | vertical                                      | You compare them                |
| Ingredients                     | vertical, with ticks                          | A sequence you go through fully |
| Steps                           | vertical                                      | A sequence                      |
| My recipes                      | vertical, "Load more · 19 more", with a count | A large collection you scan     |
| Filter chips                    | horizontal, next chip peeking                 | An optional set of peers        |
| Facts (total, prep, difficulty) | one row that wraps to a column at 200%        | Three facts, not a list         |

## The signature: the deli price card

- **What it is.** An opaque white card that stands in front of the food slice. It has a 6 px pistachio rail across
  its top and a narrow bold name. On Home, it also has "Ready by" and the clock time. The time is set at 36 px
  in narrow, tabular figures with a small "pm", where a deli card puts the price. In the library, the same price setting
  carries the total time.
- **Where it comes from.** The dish photo, and distance: a label in front of food, read from a step away.
- **What it encodes.** Nothing. The rail is the same on every card. The ready time is live data, and its normal form
  is also shown: the total time in the facts line, and on the recipe page. A user who ignores the card's styling
  still has a title and a time.
- **Where it is banned.** Cook mode, every control, and behind body text. It never sits on a raw photo.
- **Real content.** "Charred asparagus with lemon ricotta" and "Green pea and barley risotto with feta" at 320 px
  and 200% text: the card grows, the price wraps to its own row at 36 × 2 px, and the rail stays. Seen in the
  renders. It does not fall back to a system style.
- **Prior art (searched this round).**
    - "Ready by" on recipe suggestions: FixDinner (iOS) ranks dinners "by how ready you are", with no clock time. A
      Home Assistant + Mealie carousel picks a meal by time of day. Neither shows a ready-by price.
    - A deli price-card style over food photos: none found. Food-delivery kits pair a photo with a small price beside
      an add button.
    - **Closest shipping app:** NYT Cooking. Its nearest feature is a large image card with the title beneath.
    - **Visible difference:** an opaque card stands in front of a wide slice, with a coloured rail and the ready time
      set like a price.
    - **Limit:** these are web searches, not app-by-app screenshots.
- **Excitement test.** What a viewer screenshots is a Home of stacked food slices with deli cards reading "Ready by
  6:35 pm". I found no shipping app that does this. The search is limited.

## Palette: Prosciutto & Pistachio

**The idea.** An Italian deli case: prosciutto and pistachio mortadella behind pale green glass.

- The ground is the glass, faintly green.
- What you press is the deep red of cured ham in light, and the pale rose of its fat in dark.
- Pistachio is the content hue. It appears as the card rail and the no-photo field, and never on text or a control.
- The red is darker than any dish (L 0.32), so it reads as the button, not as food. The pale green flatters herbs
  and greens without tinting them.

| Name          | Role                                                                     | Light     | Dark      |
| ------------- | ------------------------------------------------------------------------ | --------- | --------- |
| Case glass    | Ground                                                                   | `#E8F0DF` | `#0B110A` |
| Card          | Surface: price cards, lists, tab bar                                     | `#FFFFFF` | `#141B12` |
| Shell         | Sunken: segmented track, avatar, skeleton                                | `#D9E5CE` | `#1C2519` |
| Rail          | Edge: control outlines, unticked boxes                                   | `#667A5C` | `#7E8E76` |
| Peppercorn    | Ink: text, tab labels, rating star                                       | `#111A0F` | `#EDF3E8` |
| Sage          | Muted, 16 px and up                                                      | `#46553F` | `#B3C1AB` |
| Prosciutto    | Action: the filled button, links, current-tab icon, ticks, timers, focus | `#620914` | `#FBD7D7` |
| On prosciutto | Label on the action                                                      | `#FFFFFF` | `#3A0A0C` |
| Rose          | Action wash: selected chip, current step                                 | `#F8E9E7` | `#2C1C1A` |
| Mustard       | Warning, with a triangle                                                 | `#7A5200` | `#EAC15A` |
| Chilli        | Danger, with an octagon. Delete is a text row                            | `#B42318` | `#FFA287` |
| Seam          | Hairline                                                                 | `#D0DDC5` | `#26311F` |
| Pistachio     | Content hue: rail and no-photo field only                                | `#9CC45B` | `#A9CC6A` |

**Script output.** The script uses culori 4 and APCA 0.0.98G, implemented from the constants. Before it measures
anything, it checks itself against the canon's On leaf figure (Lc 88, 6.77:1). It exits non-zero on any fail. The
final run reports **`ALL PASS` (88 checks)**. Text is measured on Case glass, Card, Shell and Rose.

| Check                                                    | Light                          | Dark                         |
| -------------------------------------------------------- | ------------------------------ | ---------------------------- |
| Ground OKLCH L                                           | 0.94                           | 0.17                         |
| Peppercorn                                               | 13.62 to 17.82:1, Lc 87 to 105 | 14.0 to 16.92:1, Lc 96 to 98 |
| Sage                                                     | 6.1 to 7.98:1, Lc 70 to 88     | 8.38 to 10.13:1, Lc 64 to 66 |
| Prosciutto as text                                       | 10.23 to 13.39:1, Lc 81 to 98  | 11.9 to 14.38:1, Lc 85 to 87 |
| On prosciutto                                            | 13.39:1, Lc 102                | 12.86:1, Lc 85               |
| Mustard                                                  | 5.29 to 6.92:1, Lc 66 to 84    | 9.24 to 11.17:1, Lc 70 to 72 |
| Chilli                                                   | 5.02 to 6.57:1, Lc 63 to 81    | 8.11 to 9.8:1, Lc 63 to 65   |
| Rail (edges)                                             | 3.56 to 4.66:1                 | 4.53 to 5.48:1               |
| Peppercorn to Sage                                       | 2.23:1                         | 1.67:1                       |
| ΔE00 Prosciutto to Pistachio / to Mustard / to Chilli    | 73.7 / 30.1 / 18.3             | 36.9 / 28.8 / 17.3           |
| ΔE00 Pistachio to Mustard / to Chilli, Mustard to Chilli | 42.3 / 63.5, 26.1              | 19.9 / 42.9, 26.3            |
| Prosciutto to Chilli under deuteranopia / protanopia     | 17.5 / 16.5                    | 16.0 / 17.5                  |
| Prosciutto vs the five earlier-round actions, minimum    | 47.8                           | 39.2                         |
| Prosciutto vs probe v4 Beetroot                          | 16.4                           | 15.8                         |

**Siblings (information only).** Both critics said they will move their own actions out of the warm family this
round. Against the round-0 values:

- Tomato: 19.8 light, 15.7 dark.
- Persimmon: 22.6 light, 19.6 dark.
- D1's suggested Roast for Option 3: 17.3 light, 16.6 dark.

All clear 15, so no current figure depends on the siblings' moves. The
yardsticks (not canon rules): Slack 22.6, Old Glory 17.1, M3 error 17.9, Word 38.8.

**Difference from the reference Mise.**

- The light ground moves ΔC 0.02 and is visibly green.
- The content hue is visible at swatch size.
- The action is 56.8 ΔE00 from Leaf.

**Swatch test.**

- **Light** reads as "pistachio glass with a cured-red button".
- **Dark** reads as "forest night with a pale rose button".
- **Risk:** round-0 Carton and Food Edge were also red on a light ground. Their actions are 19.8 and 22.6 away, and their grounds are white or blue, not green.

## Type

- **One family:** Archivo, variable width.
- **Narrow (75% width):** names, large title (34 px, capped at 48), card names (24 px, or 30 on a recipe), section
  heads (24 px), and the price (36 px, weight 800, tabular figures).
- **Normal width:** sentences. Body is 17/25. Meta is 16 px in Sage.
- **Cook step:** 28/36 at weight 560, with quantities at 800.
- **Tab labels:** 12 to 13 px in Ink. They are capped like the platform tab bar.
- **Everything else** is in rem, so it reflows at 200%.

## Motion

- A press scales a button to 98% in 100 ms. A tick fills in 180 ms.
- Both run only under `prefers-reduced-motion: no-preference`.
- Nothing moves at rest.

## Self-review (canon §5), from the renders

- **A. Fresh.**
    - **Year:** the glass ground and narrow price type read as 2025 to 26. The deli card in front of a slice reads as 2026.
    - **House answer:** it differs on composition and on type.
    - **Closest app:** NYT Cooking, with the visible difference named above.
    - **Food:** it is the largest and most colourful thing on Home and on the recipe page.
    - **Signature:** it holds at 320 px and 200% text.
    - **Pass**, with the photo weakness open.
- **B. Distinct.** On the contact sheet (round-0 siblings, since the round is blind), the structures differ: one
  carton, stacked slices with cards, and an edge column. The palettes pass the swatch test, and the actions are 15.7 or more apart in both themes.
- **C. Simple.**
    - No new interaction in navigation or controls.
    - Every screen answers "where am I" and "how do I get out", through the tab bar or Back.
    - Every screen has exactly one filled primary.
    - Nothing on a card looks tappable apart from the card itself. Start cooking sits outside the card link.
    - There are no gesture-only actions.
- **D. Psychology.**
    - Lists follow the ledger. Large lists use "Load more" with a count.
    - Gaps are 20 to 28 px between groups and 4 to 12 px within them.
    - A press responds in under 100 ms, and Delete offers Undo.
    - At 320 px and 200% text, the first screen shows the title, the top pick, the primary, and the next slice
      peeking.
- **E. Calm.**
    - **Prosciutto per screen:**
        - Home: the primary and the current-tab icon and bar.
        - Recipe: the primary, the tab, one tick, five outlined timers and one link.
    - One type family. Nothing moves at rest. The weeknight test passes on judgement.
- **F. Cooking.**
    - One 28 px step, quantities inline, a tappable timer, and a running-timer strip.
    - Next and Previous are 68 px, labelled and low.
    - The screen-on chip shows, switched on by the cook's tap.
    - Light and dark are both drawn. No glass and no photo.
- **G. Accessibility.**
    - The contrast figures are above.
    - Targets are 44 px or more.
    - No sideways scroll at 320 or 390 px, at 100% or 200% text.
    - **States drawn:** deciding, cooking, nothing yet, no photo, loading, offline, error and success.
    - **Not done:** copy at its longest localised length.
- **Nielsen.**
    - H1: the cook's place is not stored. The fix is to store it.
    - H4: Edit sits at the top while New recipe sits low. I accept this, because Edit is rarer.
    - H9: the import-failure screen is not drawn.
- **Contact sheet: four answers.**
    - **Stranger:** three structures.
    - **Year:** 2026.
    - **Family:** not sorted with the house answer, because the slices and cards show at thumbnail size.
    - **Mood:** a weeknight errand.

## Owner pre-mortem

| Reaction                      | Answer                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Dated."                      | No cream, no shadow grid. Narrow price type and a card standing in front of food read as current.                                                                                           |
| "Twins."                      | The structure is unique in the set. The actions clear the round-0 siblings by 15.7 or more. A shared red family is still a risk at thumbnail size, and the critics' stated moves remove it. |
| "Too clever."                 | The card holds a title and a time. Nothing has to be learned, and nothing extra is tappable.                                                                                                |
| "No palette."                 | Full role table, measured, with the search that led to it.                                                                                                                                  |
| "Ignores how people scroll."  | Everything is vertical except the chips, which peek. The library stays dense for scanning.                                                                                                  |
| "Red and green is Christmas." | The ground is pale (L 0.94, C 0.020) and the red is near-black (L 0.32). Seen in the render, it reads as a deli, not a festive card. Heuristic judgement, untested.                         |

## Delivery gate

| Cell                                | Deli Counter                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Frame card, data audit, list ledger | Done. Gaps named: the list API, household size, the cook's place.         |
| Sources and strikes                 | Done: round-0 list plus two strikes this round                            |
| Taste argument, signature tests     | Done at 320 px and 200% text                                              |
| Prior-art search                    | Done: three web searches this round, a limited scope                      |
| Palette and script output           | `ALL PASS` (88 checks), with a full-wheel sweep and a brand sweep         |
| Swatch strip                        | Rendered in the page                                                      |
| States                              | Done, except copy at its longest localised length                         |
| Screenshots                         | 1400 px, 390 px light and dark, and 320 px at 200% text in light and dark |
| Self-review, pre-mortem             | Done                                                                      |
| Medians, contact sheet              | Medians written. Contact sheet made against the round-0 siblings.         |

## Not run, and why

- **Web width layout:** not drawn, to stay near 70 KB. The file is 71.0 KB, about 70.
- **Increase Contrast variants:** not computed.
- **Distance test at 60 and 90 cm:** no device.
- **The siblings' round-1 palettes:** not visible, because the round is blind. I measured against round 0 only.
- **Brand hexes:** from secondary sources. Slack `#4A154B` is one of them.
- **Prior art:** web search only. I did not check app screenshots one by one.
