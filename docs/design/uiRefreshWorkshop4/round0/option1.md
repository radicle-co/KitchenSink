# Option 1: Carton

Designer 1. Mockup: [`option1.html`](option1.html), one file, about 56 KB. It uses one Google Font and no other
external assets. Food is drawn as inline SVG and stands in for the cook's own photos.

## The idea

Each recipe is packed like good groceries. Its name is printed big on a sky-blue carton, and you see the food through a
window cut in the carton. Around that one carton is the plainest app you know, so the food and the one button are the
only loud things on the screen.

**Visual thesis (what a stranger sees in 50 ms).** A white screen with one sky-blue block. A dish name in heavy condensed type runs across the block. The food shows
through a rounded window in it. A black band at its foot gives the time. Below it is one tomato-red button. Nothing else on the screen has colour.

**Why only Commise looks like this.** The carton solves a problem particular to a recipe app. The dish name must be big,
and the photo must stay untouched. Canon §3.4 rule 4 says text never sits on a raw photo. Packaging solved this
long ago: the name goes on the box and the food shows through a window. A recipe app is the one product whose content
really is a food pack.

**Outside reference.** The die-cut window on a Barilla blue pasta box, with the cooking time printed on the front.
Barilla is a known brand. But its carton is not in design-history surveys or on app moodboards. Nobody cites it as an
interface reference. I took its lesson, not its surface. The lesson is a name on colour, the food through
a window, and the time on the front. I took no logo, no oval and no texture.

## Step 0: point of view, medians and strikes

- **My habits.** Type: a neutral grotesk. Food: a full-bleed photo. Composition: large title, hero, list. Colour:
  near-white with one deep accent. All four are the house answer, so I treated each as a default to beat.
- **Mood.** It is 17:50 on a Tuesday. The cook is tired, someone asks "what's for dinner?", and the cook wants one
  answer they trust within seconds. The screen has to give that answer without a lecture and still give a small lift.
- **References.**
    - The Barilla carton above.
    - A secondary reference for the type: the condensed product names on Japanese convenience-store onigiri wrappers,
      which a tired shopper reads in half a second. Few designers know one.
- **Refusal.** I will not put text on a photo or a tint over food.
- **Category median.** A white or cream ground, a grid of rounded photo cards with shadows, a green or orange accent,
  carousels and "Good evening, Eliza".
- **House answer.** A near-white ground (L 0.97, C < 0.004), one big grotesk large title, a full-bleed photo hero, a
  strict list, and one deep warm accent (Beetroot, Copper, Paprika, Aubergine). This is judge v4's measured
  convergence, and it is also my own instinct.
- **Inversions.** The house answer on a dark ground with a glowing accent, which is round 3's drift. And the median on
  warm paper with a serif, which is round 1.
- **Peer prediction.** I expect three things from designers who read the same persona:
    - A near-neutral page with a sticker signature, such as label tape, an eyebrow badge or an enamel rim.
    - A one-tap time question ("How long have you got tonight?").
    - A wash coloured from the dish, or a huge total-time number.
      All four are struck below.

**The two axes Carton moves from the house answer:**

1. **Where colour lives.** It sits in a large content-hue carton, not on a button alone.
2. **Hero form and composition.** The house answer has a full-bleed photo with a title below. Carton has a name printed
   on colour, a window below it and a reversed facts band at the foot.

Type genre stays a grotesk but changes register to condensed 800 at 44 px, which reads as a product name. I count
this as supporting, not as an axis.

## Diverge: concepts, sources and strikes

| #   | Concept                                             | Need, source             | Verdict                                                          |
| --- | --------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| 1   | Controls as soft, pressable keys                    | Hands                    | Struck: novelty in controls                                      |
| 2   | Glance type: everything set at signage size         | Distance                 | Struck: the canon's "big type" lever                             |
| 3   | Wayfinding panels and pictograms                    | Distance, Schiphol signs | Struck: the closest feature is Transit's line panels             |
| 4   | Cool for planning, warm for cooking                 | Heat                     | Struck: colour encodes mode, close to Pilot Light                |
| 5   | Steam fade on photos                                | Heat                     | Struck: motion and drama                                         |
| 6   | A line of light, or plates sized by time            | Timing                   | Struck: round 2, too clever                                      |
| 7   | A dish-colour wash                                  | The dish                 | Struck: canon permission, so the median                          |
| 8   | Flat ingredient art                                 | The dish                 | Struck: round 3 Fresh Cut                                        |
| 9   | A loupe crop of the photo's texture                 | The dish, food magazines | Struck: one ornament on the median                               |
| 10  | A counter band the dish straddles                   | The dish                 | Struck: the Now Line without its meaning, which is a subtraction |
| 11  | **A carton: name on colour, food through a window** | The shop, pasta box      | **Kept**                                                         |
| 12  | Receipt-style lists                                 | The shop                 | Struck: a 2023 web trend                                         |
| 13  | Labelled pantry jars (Cornishware bands)            | The shop                 | Struck: farmhouse mood                                           |
| 14  | A calendar wall                                     | The week                 | Struck: not built                                                |
| 15  | Handwritten notes                                   | The household            | Struck: dated and cute                                           |
| 16  | "Answer card": the dish name you say aloud, huge    | The household            | Struck: big type lever                                           |
| 17  | Photo cut-outs on colour                            | The dish                 | Struck: shipping feature (CapWords stickers)                     |

The task asks for one option, so I kept one. Concept 11 is the cut that survived.

## Frame cards

| Screen            | Job (the user's words)     | Mode                   | One primary                                    | Must be clear without learning             |
| ----------------- | -------------------------- | ---------------------- | ---------------------------------------------- | ------------------------------------------ |
| Home, deciding    | "What do I make tonight?"  | Planning               | **Cook this tonight** (acts on the top choice) | Three dishes, a reason each, one button    |
| Home, cooking     | "Where was I?"             | Cooking                | **Back to step 4**                             | You are mid-recipe, and a timer is running |
| Home, nothing yet | "How do I start?"          | Planning               | **New recipe**                                 | The box is empty, so add one               |
| Recipe page       | "Show me how to make this" | Planning, then cooking | **Start cooking** (docked)                     | Name, food, time, then the list            |
| My recipes        | "Find one of mine"         | Planning               | **New recipe** (docked)                        | A searchable list with a count             |
| Cook mode         | "What do I do now?"        | Cooking                | **Next step**                                  | One step, big                              |

- **Signs of success.** The cook taps the carton or the button within 5 s of opening the app. They never scroll back up
  to the ingredients while cooking.
- **Sign of mere prettiness.** People screenshot the carton but still hunt for search.
- **Recipe page primary.** I chose **Start cooking** over Edit. Cooking is the frequent job on this page, and editing is
  rare, so Edit sits top right as a labelled pill.

## Data audit (what Home is allowed to say)

**Stored per recipe** (`recipe-service/src/recipes/recipes.schema.ts`):

- Title, description, cuisine, difficulty, status and visibility.
- Meal type (`breakfast` … `dinner` … `drink`, from `database/schema/recipes.ts`).
- Ingredients: quantity, unit, name, preparation and group.
- Steps: instruction and `timerSeconds`.
- Servings, and prep, cook and total minutes.
- Tags, dietary flags, created and updated dates, and nutrition per serving.

**Also stored:**

- **The cook's own rating.** Set through the `ratings/` module, one per user per recipe.
- **Collections.** Stored server-side.
- **The editor draft.** Kept on the device (ADR-0057).
- **Cook marks.** Kept in the tab's `sessionStorage` on web and in memory on native (`cookMarksBackend.ts`,
  `cookMarksStore.ts`). They are not on the account.

**Not stored:**

- Per-user view or cook history. `recipe_viewed` is captured, but `readImpactSignals` returns only per-recipe totals.
- Pantry, plan, shopping list and household.

**So Home says only:**

- "Your quickest dinner": the smallest total time among dinners.
- "You rated it 5 stars": the cook's rating.
- "Your biggest dinner · serves 6": servings.
- "Cooking now · Step 4 of 7": the in-session mark, labelled honestly on screen as kept on this phone.

There is no "not opened lately", no "last cooked" and no time question. Unbuilt features get one line below the first
screen.

## Contract and list ledger

The bindings are canon §1.1 to §1.4, §2.1 to §2.3, §3.2 to §3.4, §4, §4.1 and §5.

| List                           | Direction                              | Reason                                                   |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------- |
| Home choices (carton + 2 rows) | Vertical                               | A short choice you compare. Three items, no row of peers |
| Ingredients                    | Vertical, ticks                        | A sequence you go through fully                          |
| Steps                          | Vertical, current marked               | A sequence. Quantities are inline                        |
| Nutrition                      | Vertical                               | Read fully                                               |
| My recipes                     | Vertical, count, sort, **Show 4 more** | A large collection you scan. No infinite scroll          |
| Filter chips                   | **Horizontal**, next chip peeks        | Optional peers. The first few carry the value            |
| Cook mode                      | One step at a time, Next and Previous  | Not a list                                               |

## Taste argument and signature

- **Trajectory.** In 2025, three shipped redesigns moved the same way:
    - Airbnb's relaunch moved "away from generic geometric designs and toward texture and form", with dimensional icons.
    - iOS 26 Liquid Glass puts controls in their own layer over edge-to-edge content.
    - Material 3 Expressive brought more colour and shape.
      The shared direction is that content becomes an _object_ with form, and controls step back.
- **My one step past them.** The content object is a real-world food pack with honest flat colour, not glass and not 3D.
  It changes no control. This look did not ship before 2022, because flat-colour UI then meant small cards and coloured
  headers, not a pack-scale name over a window.
- **Mood test.** A pasta box is the most weeknight object in the kitchen. Nothing here reads as a restaurant, a gallery
  or a poster. Nothing moves at rest.
- **Signature.** The die-cut window, meaning the dish seen through a rounded window in the carton, with the name printed
  on the carton above it.
    - **Where it appears:** Home (one carton), the recipe page header, the first-run and loading states, and the
      no-photo thumbnail (an empty window).
    - **Where it is banned:** cook mode, controls and list rows (other than the empty-window placeholder), and behind body
      text.
    - **What it encodes:** nothing. The carton is always the same blue, and every fact on it also appears in words. Ignore
      the carton and you lose nothing.
- **Signature tests.**
    - **Longest real title at 320 px and at 200% text.** "Miso-glazed salmon with sesame greens" was rendered in both
      cases. The carton stays a carton with the name on colour and the window intact.
    - **Type scaling.** Display sizes scale at half rate (`calc(1.375rem + 22px)`): 44 px becomes 66 px at 200%. A
      full-rate 88 px name turned the first screen into a wall of type in the round-2 render, so I changed it. Body text
      scales fully.
- **Prior-art search (WebSearch, run).**
    - The closest shipping feature is the App Store **Today** card, which has bold headings and edge-to-edge artwork.
    - **The visible difference:** Today prints its title over the artwork on a scrim. Carton never puts text on the
      image. It prints the name on solid colour above a window and ends with a reversed facts band, which is packaging
      grammar.
    - Five web searches covered packaging-window recipe UI, App Store Today cards, HelloFresh, Gousto and Mindful Chef,
      NYT Cooking, Mob and Kitchen Stories. None showed a name on solid colour above a photo window. NYT Cooking is
      photo-led and publication-like. The meal-kit apps carry their box colour into the brand, not into the recipe card.
    - The searches gave text, not screenshots. I did not open each app's screens, so this is partly verified.
- **Closest-app test.** The closest app is the App Store Today tab. The difference is "name on colour, food in a
  window, no text on the image", which is neither the content nor the colour. Pass.
- **Excitement test.** What a viewer screenshots is the recipe that looks like a box you buy in a shop, with "Miso-glazed salmon
  with sesame greens" stacked big over the window. The search found no app that does this.

## Screens

- **Home, deciding.**
    - Header: date, the large title **Tonight** and the avatar.
    - One line: "Three dinners from your recipes, and why."
    - **The carton:**
        - The reason, with an icon.
        - The name, in condensed 800.
        - The window.
        - A black facts band: 25 min · Serves 2 · Easy.
    - **Cook this tonight** sits below the carton, never inside it, so each target does one thing. It opens the recipe
      with the screen kept on, at the ingredients.
    - "Or one of these": two rows, each with its reason.
    - "All your recipes 24 ›".
    - One Coming soon line.
    - Tabs: Home, Recipes, Discover, Profile.
- **Recipe page.**
    - Top: a back circle, the Edit pill and More, all on solid backing.
    - The carton runs full width under them. It holds cuisine · meal · source, the name at 48 px, the window, and a facts
      band (Total, Prep, Serves, Difficulty).
    - Then: the rating, the description, and Ingredients with a servings stepper (groups, ticks, quantity in bold).
    - Steps:
        - Numbered.
        - Quantities in bold inside the text.
        - Step 3 marked with a wash and a "Current step" label.
        - Durations as timer buttons.
    - Then: Nutrition, Version history, and Delete as a Radicchio text button with an icon.
    - **Start cooking** is docked at the bottom. When the page scrolls, a solid nav bar with the title appears.
- **My recipes.**
    - The large title and the My recipes | Collections switch.
    - Search, then filter chips with a count on each.
    - "24 recipes" with a sort control.
    - Rows: a 68 px photo, the title, and meta at 16 px. Draft and Private tags carry their words.
    - A draft with no photo shows an empty carton window.
    - "Showing 20 of 24" and a **Show 4 more** button.
    - **New recipe** is docked.
- **Cook mode.** Neutral and opaque, with no carton.
    - Top: Close and "Screen on". Screen on was switched on by the Start cooking tap.
    - The title, then "Step 3 of 7" with a seven-segment bar.
    - The step at 28 px with inline bold quantities.
    - A folded "Why one layer?" note.
    - A fixed timer strip with Pause.
    - Previous and **Next step** at 72 px. At 200% text they stack, with Next lowest.
    - Voice "Next" and "Back" work too.
- **States.**
    - Home cooking: the carton says "Cooking now · Step 4 of 7" and shows the timer.
    - Home nothing yet: the carton holds an empty plate and "Write down a dish you already love".
    - Loading: a skeleton carton after 1 s.
    - Offline, error with Try again, saved, and deleted with Undo.

## Palette: "Carton"

**Idea.** A white shelf, a sky-blue carton and one tomato. Blue sits opposite the browns, golds and reds of cooked food,
so the dish in the window reads warmer. Tomato is the only colour you can press.

**Structure.** Most palettes put colour on the button and nowhere else. Carton puts a large content hue around the food,
gives the action its own warm hue, and adds an ink band. It is not the reference palette (Mise) with a new accent: a
content hue is visible at swatch size (canon §3.2 test 3). The ground is plain white on purpose (Mise ΔL×100 2.8).

| Role        | Name        | Use                                                     | Light     | Dark      |
| ----------- | ----------- | ------------------------------------------------------- | --------- | --------- |
| Ground      | Shelf       | The page                                                | `#FFFFFF` | `#0E1216` |
| Surface     | Board       | Sheets, tab bar, docked bar                             | `#FFFFFF` | `#161B21` |
| Sunken      | Tray        | Search, segmented track, cook timer strip               | `#EDF1F4` | `#1F262D` |
| Edge        | Rule        | Control outlines, unticked boxes                        | `#6E7A86` | `#7D8893` |
| Ink         | Squid ink   | All titles and body text, and the facts band            | `#11161C` | `#EEF2F5` |
| Muted       | Pepper      | Secondary text, 16 px and up                            | `#4A5560` | `#AEB8C2` |
| Action      | Tomato      | The one filled button, links, ticks, current tab, focus | `#C41E3A` | `#FFA294` |
| On action   | On tomato   | Label on a Tomato fill                                  | `#FFFFFF` | `#2A0606` |
| Action wash | Tomato wash | Selected chip, current-step ground                      | `#FCE6E8` | `#33181A` |
| Warning     | Mustard     | Short labels with an icon                               | `#855400` | `#F2C14E` |
| Danger      | Radicchio   | Delete, text with an icon, never a fill                 | `#8F1D63` | `#F59AC9` |
| Hairline    | Seam        | Dividers only                                           | `#DDE3E8` | `#2A3239` |
| Content hue | Sky carton  | The carton only, never a control or text                | `#B9D8F2` | `#21405E` |

- **Text on the carton** is Ink only.
- **The facts band** is Shelf on Ink.
- **Contrast in the page.** The page computes WCAG and APCA from these same CSS tokens.
- **The check script.** It reads the tokens out of the HTML: `scratchpad/d1/check.mjs` with culori and a hand-written
  APCA 0.0.98G.
    - **Validation first.** I checked the APCA code against the canon before trusting it. White on Leaf gives Lc 88,
      matching the canon's Lc 88. Beetroot on `#F5F5F2` gives 8.00:1 at Lc 82.6, matching the canon's 8.0 at Lc 83.
    - **Result: 0 fails, exit 0.**

**Script output (summary):**

- **Ink:**
    - Light: 15.3 to 18.2:1, Lc 93 to 105.
    - Dark: 13.6 to 16.7:1, Lc 96 to 98.
    - On the carton: 12.3:1, Lc 80 light. 9.5:1, Lc 90 dark.
- **Muted:**
    - Light: 6.4 to 7.6:1, Lc 75 to 87.
    - Dark: 7.6 to 9.3:1, Lc 60 to 63.
    - Ink to Muted: **2.39** light, **1.79** dark.
- **Tomato as a link:**
    - Light: 4.9 to 5.8:1, Lc 66 to 77.
    - Dark: 7.9 to 9.7:1, Lc 63 to 65.
    - On tomato: 5.84:1, Lc 83 light. 9.62:1, Lc 66 dark.
- **Mustard:** 5.4 to 6.4:1, Lc 70 to 82 light. 9.1 to 11.2:1, Lc 70 to 73 dark.
- **Radicchio:** 7.0 to 8.3:1, Lc 76 to 87 light. 7.5 to 9.3:1, Lc 60 to 63 dark.
- **Rule (control edges):** 3.9 to 4.4:1 light. 4.2 to 5.2:1 dark.
- **Facts band:** 18.2:1 light, 16.7:1 dark.
- **Roles inside the palette (ΔE00):**
    - Light: Action-Carton 54.3, Action-Warning 31.3, Action-Danger 20.7, Carton-Warning 52.7, Carton-Danger 56.8,
      Warning-Danger 44.3.
    - Dark: 59.9, 30.2, **19.1**, 67.2, 56.4, 49.3.
- **Action vs earlier-round actions (ΔE00):**
    - Light: 52.3, 63.3, 62.5, 56.7, 68.1.
    - Dark: 53.0, 46.3, 44.8, 63.6, 47.4.
- **Action vs last round's convergence family, light:** Beetroot 17.0, Copper 16.9, Paprika **15.1**, Aubergine 25.1.
  Dark: 32 to 51.
- **Grounds (OKLCH):** light L 1.000. dark L 0.180, C 0.010.

**Not computable.** I cannot measure ΔE00 against the other two options in this round, because I have not seen them.
One near miss: round 3 Fresh Cut's hero colour Persimmon `#C93A1E` is 11.9 from Tomato. It was an image colour, not an
action, so it is not on the canon's list, but the owner has seen it.

## Type

**Family.** Bricolage Grotesque, a variable font with optical size and width axes. It is the only family.

| Style       | Size, line                    | Weight, width        | Use                    |
| ----------- | ----------------------------- | -------------------- | ---------------------- |
| Carton name | 44 (Home), 48 (recipe) / 0.92 | 800, width 78%       | The name on the carton |
| Large title | 34 / 1.05                     | 800, width 78%       | "Tonight", "Recipes"   |
| Section     | 22                            | 800, width 78%       | Ingredients, Steps     |
| Cook step   | 28 / 1.3                      | 600, quantities 800  | Cook mode              |
| Body        | 17 / 1.45                     | 400, optical size 14 | Everything you read    |
| Secondary   | 16                            | 400, Muted           | Meta lines             |
| Label       | 13                            | 750, Ink only        | Group labels           |

- **Scale.** Display styles scale at half rate with text size, and body scales fully.
- **Spacing.** 4, 8, 12, 16, 24, 32, 48. Gaps between groups are at least twice the gaps inside them: 34 between
  sections, 10 to 16 within.
- **Radii.** Carton 28, window 18, controls 16.

## Motion

- **Nothing moves at rest.**
- **Press.** A pressed button scales to 98% at once, and back over 100 ms.
- **Tick.** A ticked box fills in 180 ms.
- **Specified, not built in the static mock.** A tap on the Home carton grows it into the recipe page's carton. This
  shared-element transition lets the cook see the same object open. It uses a 300 ms spring at 100% damping, is
  interruptible, and becomes a cross-fade under Reduce Motion.
- **Reduced motion.** All transitions sit inside `prefers-reduced-motion: no-preference`, so a reduced-motion browser
  shows them at 0 s.

## Self-review from the renders

Renders: Playwright at 1400, 390 and 320 px, at 200% text, in light and dark, with a page-dark capture. There is a
contact sheet of my Home beside the v4 probe's house-answer Home. Files are in `scratchpad/d1/` (`r9_*`, `cmp*.png`,
`contact_house.png`). There is no horizontal scroll at 390 or 320 px, and no console errors. I fixed every fault I found
and re-rendered (loops r1 to r9, then fin, fin2 and fin3).

**Canon §5:**

- **A. Fresh**
    - **Pass. Year:** the ground is timeless white, the type is a 2023 variable grotesk used condensed, the carton reads
      2025, and the band reads as packaging. Nothing reads as 2015 to 2019.
    - **Pass. House answer and two axes:** written above.
    - **Pass, partly verified. Closest app:** App Store Today, with the difference stated above.
    - **Pass. Trajectory:** written above.
    - **Pass, measured. Food is the largest thing.** The first render failed this check, because the blue area was
      larger than the window. So I made the window 4:3, widened it and tightened the carton. Measured with
      `getBoundingClientRect` at 390 px:
        - Home: window 69,312 px², blue 67,143 px².
        - Recipe page: window 84,672 px², blue 82,987 px².
          The food is also the most colourful thing on both screens.
    - **Pass. Signature:** one sentence, a cook need (the shop and the dish), and banned places listed.
    - **Pass. Clearly Commise:** real dishes and honest copy, with no sparkle.
    - **Pass. Survives 320 px and 200%:** seen in the renders.
- **B. Distinct**
    - **Not checkable. Distinct from the other options:** I did not see them.
    - **Pass. Palette:** full, named, measured, in both themes.
    - **Pass. Distance from earlier rounds:** all at least 44.8.
    - **Pass. Swatch test:** the strip reads as "white, sky, tomato, ink". It is not "white with one dark accent".
- **C. Simple**
    - **Pass. Interactions a first-time user has not met:** none in navigation or controls.
    - **Pass. Orientation:** large titles, tabs, back and close are on every screen.
    - **Pass. One filled primary per screen**, matching the job, in thumb reach, with a label.
    - **Pass. The signature encodes nothing.**
    - **Pass. Every target looks tappable.** The carton link and the button are separate elements.
- **D. Psychology**
    - **Pass. Scroll ledger:** above.
    - **Pass. Show more with a count.**
    - **Pass. Group gaps at least 2×.**
    - **Pass. Quantities in steps. the current step is marked.**
    - **Pass. First screen:** it says what the screen is, shows the main action, and the next group's heading is visible
      above the tabs.
    - **Pass. Feedback:** pressed state within 100 ms, and Undo on delete.
    - **Pass. Nielsen:** below.
- **E. Calm**
    - **Pass. Tomato** appears only on the primary, the current tab, links, ticks and timers.
    - **Pass. No idle motion.**
    - **Pass. Every ornament has a job.** The window's inner shadow separates a pale photo edge from the carton. The
      cook-mode fade at the step's edge signals more text.
    - **Pass. One family.**
    - **Pass. Weeknight test.**
- **F. Cooking**
    - **Pass. Step text:** 28 px, inline quantities, timers.
    - **Pass. Next and Previous** are fixed, low and labelled.
    - **Pass. Screen on** is visible and comes from the cook's tap.
    - **Pass. No glass and no photo** in cook mode.
    - **Pass. Opening screen:** deciding and cooking are both shown, using stored facts only.
- **G. Accessibility**
    - **Pass. Contrast:** every pair measured.
    - **Pass. Colour is never the only cue.** A ticked line gets a tick, muted text and a strike-through. Danger is text
      with an icon.
    - **Pass, measured. Targets are 44 px or more.** A Playwright pass over every link, button, tab and chip found 10
      targets under 44 px:
        - Filter chips at 40 px.
        - The segmented tabs at 41 px.
        - "Version history", "Show 4 more" and "Undo" as short inline links.
          I fixed all of them. Chips and tabs are now 44 px. Version history is a 56 px row, Show 4 more is a full-width
          button, and Undo is 44 × 44. The re-run lists none.
    - **Pass. 200% and 320 px reflow.** One known limit: at 200% the cook step text scrolls inside a fixed frame, so the
      controls never move.
    - **Pass. States:** empty, loading, error, offline, first-run and success.

**Nielsen's 10:**

- **Violations found and fixed:**
    - An on-screen label said "Your first carton". That is design jargon the user must learn, so it now says
      "Start here".
    - A row said "Feeds 6", which did not match "Serves" elsewhere. It now says "Your biggest dinner · serves 6".
    - The scrolled recipe page let the floating buttons sit over the list. It now shows a solid nav bar with the title.
- **Residual:**
    - **Heuristic 4 (consistency).** The current step and a selected chip share Tomato wash. Both mean "this one", so I
      kept it.

**Contact sheet answers:**

- **Stranger.** Carton shows a colour block with stacked heavy type and a black band. The house answer shows a photo and
  a list. They sort into different piles.
- **Year.** It reads as 2025 or 2026.
- **Family.** It is not the median's family.
- **Mood.** Weeknight kitchen.

**Owner pre-mortem:**

- **"It is a blue card and a red button, like the App Store."**
    - **Cause:** coloured containers are common.
    - **Fix applied:** I made the pack grammar louder. The name went from 32 to 44 px condensed, and a reversed facts band
      was added. A blue card does not have that grammar.
- **"Red, white and blue looks like a flag."**
    - **Cause:** Tomato next to Sky.
    - **Fix applied:** the black band sits between the two, and the red is crimson, not a primary red.
    - **Residual:** this is a taste risk I cannot close by inspection.
- **"The vector food looks cheap."** True of any mock. The product shows the cook's photos.
- **"Dated?"** No paper, serif, texture or shadowed card grid. **"Too clever?"** Nothing to learn. **"No palette?"** A
  full table. **"Ignores scrolling?"** See the ledger.

## Delivery gate

| Option | Frame card | Data audit       | List ledger | Sources and strikes    | Taste argument | Signature tests       | Prior-art search                                  | Palette and script | Swatch strip             | States               | Screenshots          | Self-review        | Pre-mortem |
| ------ | ---------- | ---------------- | ----------- | ---------------------- | -------------- | --------------------- | ------------------------------------------------- | ------------------ | ------------------------ | -------------------- | -------------------- | ------------------ | ---------- |
| Carton | Done       | Done (repo read) | Done        | 17 concepts, 16 struck | Done           | Rendered 320 and 200% | Run: 5 searches, no collision, screens not opened | 0 fails, exit 0    | In the page, both themes | 6 states + cook mode | 390, 320, 200%, dark | Done, no open fail | Done       |

## Not run, and why

- **Distance from the other two options in this round.** Not run: I cannot see them.
- **Prior art.** The searches returned text, not screenshots. I did not open each competing app's screens.
- **Real photos.** Not run, because the brief bans external assets. The window's look with real, varied user photos is
  untested.
- **Missing screens.** Web width, Discover, the editor and Collections were not drawn. The brief asked for a sample.
- **Increased-contrast variants.** Not designed.
- **User evidence.** This review is inspection only, a heuristic judgement, untested with users.
- **Type risk.** Bricolage Grotesque was common on 2024 landing pages. The condensed display cut is the less common use,
  but it can still read as trend-adjacent.
