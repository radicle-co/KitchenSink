# Option 1: Carton (round 1)

Designer 1. Mockup: [`option1.html`](option1.html). It is one file of 61.7 KB, using one Google Font. The food is drawn
in inline SVG, with grain and one soft light, and stands in for the cook's own photos.

Heuristic judgement, untested with users. Every number below comes from a script run on the file or from the
rendered page. None is estimated.

## The idea

Each recipe is packed like good groceries. Its name is printed big on a sky-blue carton, and you see the food through
a die-cut window below the name. Around that one carton is the plainest app you know. The food and the one Tomato
button are the only loud things on the screen.

**Visual thesis (what a stranger sees in 50 ms).** A white screen with one sky-blue pack on it:

- a heavy condensed dish name printed at the top of the pack
- the food in a rounded window with a thin printed keyline
- a reversed ink band of facts at its foot.

Below the pack is one red button. Nothing else on the screen has colour.

**Why only Commise looks like this.** A recipe app is the one product whose content really is a food pack. The name
must be big, and the photo must stay untouched: canon §3.4 rule 4 says text never sits on a raw photo. Packaging
solved this problem long ago. The name goes on the box, and the food shows through a window.

**Outside reference.** The die-cut window on a Barilla blue pasta box, with the cooking time printed on the front. I
took its lesson, not its surface: a name on colour, the food through a window, and facts on the front. I took no logo,
no oval and no texture. A secondary reference for the type is the condensed product names on Japanese
convenience-store onigiri wrappers, read in half a second. Neither appears in design-history surveys or on app
moodboards.

## Changes this round

Each critique point is listed with what I did. Where I disagreed, the evidence is given.

### Accepted

| From                                           | Point                                                                                                                                                 | What changed                                                                                                                                                                                                                                                                                                                                                         | Measured result (390 px unless stated)                                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 §1                                          | Home offers one dish, not a choice: the carton was 458 px, and both rows sat under the tabs.                                                          | The carton is now 329 px tall: crisp padding, a 16:10 window, and a name that sets in two lines at 390 px. The lede is cut, and the reason moved above the carton.                                                                                                                                                                                                   | Row 1 ends at y 660 and row 2 at y 743. The tab bar starts at y 762, so all three dinners show on the first screen. The top of "All your recipes" peeks: its row starts at y 743, and 7 px of its text shows.                                                  |
| D2 §2                                          | Recipe page false floor: Ingredients sat at y 783, under the dock.                                                                                    | The carton is shorter, and the facts band is one row.                                                                                                                                                                                                                                                                                                                | The Ingredients heading and the stepper end at y 708. The dock starts at y 768.                                                                                                                                                                                |
| D2 §3, D3 §4                                   | At 200% text, no food and no primary on the first screen.                                                                                             | When the phone is under 15 em wide, a container query switches the layout. That is 320 px from about 125% text, or 390 px from about 155%. **The window moves to the top of the carton.** The name caps at 36 px, and the redundant icons drop. The primary sticks above the tabs. Only rem, em and container units respond. Nothing is driven by a hash or a class. | At 320 px and a real 200% root size: the photo spans y 278 to 389, and the primary ends at y 738, above the tabs at y 762. At 390 px and 200%: the photo spans y 251 to 397, and the primary ends at y 712. `scrollWidth` equals the viewport in every render. |
| D2 §4                                          | At thumbnail size the carton reads as a card (28 px corners).                                                                                         | Carton corners are now a crisp 8 px. The window keeps soft 16 px corners and has a 1.5 px Ink keyline 4 px outside it, like a printed die-cut. I rejected a drawn fold, because it is ornament with no job.                                                                                                                                                          | I rendered the contact sheet in scratch. It is described below.                                                                                                                                                                                                |
| D2 §5, D3 §3                                   | A Profile tab that does not exist.                                                                                                                    | Three tabs, per `TAB_ROUTES` (`mobile/src/navigation/routes.ts:46`). The avatar is the one door to the account.                                                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                |
| D3 §2                                          | Home promised facts the API cannot serve.                                                                                                             | See the data audit. I also found a second gap that no critic raised: `viewerRating` is returned on detail reads only. So "You rated it 5 stars" left Home.                                                                                                                                                                                                           |                                                                                                                                                                                                                                                                |
| D3 §5                                          | The food claim was unproven: blue 67k px² against window 69k px².                                                                                     | The window grew to 16:10, and the blue around it shrank.                                                                                                                                                                                                                                                                                                             | Window 53,290 px² against blue 37,845 px² (band excluded), a ratio of 1.41.                                                                                                                                                                                    |
| D3 taste                                       | Two condensed 800 lines (the title and the name) are two shouts.                                                                                      | Large titles and section heads are now 700 at normal width. The carton name is the only condensed shout on a screen.                                                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                |
| D3 §6                                          | Dark Tomato `#FFA294` and dark Radicchio `#F59AC9` are both pastel pink.                                                                              | Dark Danger is now orchid Radicchio `#F2A6F0`.                                                                                                                                                                                                                                                                                                                       | ΔE00 to dark Tomato went from 19.1 to 25.6. It reads at Lc 65.6 to 68.0 on the dark grounds.                                                                                                                                                                   |
| Canon §3.4 rule 7, and my critique of Option 2 | The current-tab label was Tomato at 12 px. Canon §3.4 rule 7 says text under 16 px uses Ink. This is the same fault I raised against Option 2.        | All tab labels are now Ink. The current tab is marked by a Tomato-filled icon and an 800 weight. I grepped the file for other text under 16 px: the date, tags, labels and the awake chip are all Ink. The state labels were Muted and are now Ink.                                                                                                                  |                                                                                                                                                                                                                                                                |
| Self                                           | Round 0 claimed "200% pass", but a real 200% root size gave `scrollWidth` 323 at 320 px. The round-0 test used a `#x2` hash. **That pass was wrong.** | The hash is gone. The 200% test injects `html{font-size:200%}`. "Medium" was breaking mid-word through `overflow-wrap:anywhere`, so it now uses `break-word`. The Collections segment stacks at large text. Toasts wrap.                                                                                                                                             | I scanned every element in every frame at 390, 320 and 200%. No element overflows. The one exception is the ellipsised title in the scrolled nav bar, which is intended.                                                                                       |

### Pushed back, with evidence

1. **"Window at the top, name under it" (D3).** I rendered three variants on one contact sheet, together with the
   round-0 siblings:
    - window first
    - name first
    - a plain photo-top card with the same content.

    At thumbnail size, window first reads in the same structure as the plain card: photo, then title. The blue frame
    is what keeps them apart. Name first reads as a pack, with the name on the box and the food through it, which is
    D2's point 4. So I kept D3's **goal** (food on the first screen at every text size) but not the **means** at
    default size. At default text the name comes first. At large text the container query puts the window first. Both
    orders are the same object, and no control moves.

2. **"Red, white and blue reads as a flag" (D3, a taste risk).** A flag reading needs flag blue. Sky carton `#B9D8F2`
   is ΔE00 **63.6** from Old Glory Blue `#0A3161`, a pale sky beside a navy. The Ink band also sits between the blue
   and the red. **Residual risk:** Tomato `#C41E3A` is 5.8 from Old Glory Red `#B31942`. I kept it for the reason in
   point 3.
3. **Keeping Tomato, which reverses my own round-1 critique.** My critique said that I will move Carton off the warm
   family. Both other critics ruled the other way: Carton keeps Sky and Tomato, and they move. Option 3's designer has
   said they will leave blue and orange. Both critics computed their new actions against my exact Tomato hexes, so
   a move now voids their checks. I also searched the dark warm space (OKLCH L 0.68 to 0.80, hue 10 to 40, every
   chroma). No dark red reaches 15 from every proposed sibling dark. The best reached 11.5. So the set has room for one
   warm-red dark action, and Tomato keeps it.

    The table shows Tomato against every action the critiques proposed for the siblings:

    | Proposed action                                           | Light ΔE00 | Dark ΔE00       |
    | --------------------------------------------------------- | ---------- | --------------- |
    | Pimentón `#94400A` / `#F5B97A` (D3, for Option 2)         | 19.8       | 18.9            |
    | Carrot `#B34500` / `#FFAE66` (D2, for Option 3)           | 19.1       | 17.8            |
    | Bresaola `#6E2C2C` / `#F0A8B8` (my proposal for Option 2) | 16.7       | **11.8, fails** |
    | Roast `#7A3B12` / `#F5B08A` (my proposal for Option 3)    | 21.7       | **10.3, fails** |

    **I withdraw Bresaola and Roast.** I made both on the assumption that Carton moves. If Option 2 or Option 3 takes a
    warm action, its dark value must be at least 15 from `#FFA294`.

4. **"Show the API gap" (D3).** Accepted in substance. I did not invent an endpoint: the gap is stated below as a
   dependency, and Home's reasons are limited to fields that a list item already carries.

### Contact sheet

Six phones at thumbnail size: round-0 Carton, round-1 name first, round-1 window first, a plain photo-top card,
round-0 Option 2, and round-0 Option 3. I worked before the siblings' round-1 files existed. So the set check is
against their round-0 work and their stated directions.

- **Stranger:** Carton is the only one with one coloured pack, stacked condensed type and a reversed band.
- **Family:** the plain card and the window-first variant sort into one pile. Name first does not, which is why it is
  the default.
- **Year:** 2025 to 2026.
- **Mood:** a weeknight kitchen.

## Step 0: point of view, medians and strikes

This is carried from round 0 and unchanged in substance.

- **My habits.** A neutral grotesk, a full-bleed photo, a large title, a hero and a list, and near-white with one deep
  accent. Each is the house answer, so each was a default to beat.
- **Mood.** It is 17:50 on a Tuesday. The cook is tired, someone asks "what's for dinner?", and they want one answer
  they trust within seconds.
- **Refusal.** No text on a photo, and no tint over food.
- **Category median.** White or cream, rounded shadowed photo cards, a green or orange accent, carousels, and "Good
  evening, Eliza".
- **House answer.** Near-white (L 0.97), one big grotesk title, a full-bleed photo hero, a strict list and one deep
  warm accent.
- **Inversions.** The house answer on dark with a glowing accent. The median on paper with a serif.
- **Peer prediction.** A near-neutral page with a sticker signature, a one-tap time question, and a dish-colour wash
  or a huge time number.
- **Two axes Carton moves from the house answer:**
    1. Where colour lives: a large content-hue pack, not the button alone.
    2. Hero form: a name printed on colour above a framed window, with a reversed band, instead of a bleed photo with a
       title.

Seventeen concepts were written across hands, distance, heat, timing, the dish, the shop and the household. Sixteen
were struck. The table is in [`../round0/option1.md`](../round0/option1.md#diverge-concepts-sources-and-strikes). This
round adds no concept and strikes none.

## Frame cards

| Screen            | Job (the user's words)     | Mode                   | One primary                        | Must be clear without learning           |
| ----------------- | -------------------------- | ---------------------- | ---------------------------------- | ---------------------------------------- |
| Home, deciding    | "What do I make tonight?"  | Planning               | **Cook this tonight** (top choice) | Three dinners, a reason each, one button |
| Home, cooking     | "Where was I?"             | Cooking                | **Back to step 4**                 | You are mid-recipe, and a timer runs     |
| Home, nothing yet | "How do I start?"          | Planning               | **New recipe**                     | The box is empty, so add one             |
| Recipe page       | "Show me how to make this" | Planning, then cooking | **Start cooking** (docked)         | Name, food, facts, then the list         |
| My recipes        | "Find one of mine"         | Planning               | **New recipe** (docked)            | A searchable list with a count           |
| Cook mode         | "What do I do now?"        | Cooking                | **Next step**                      | One step, big                            |

- **Sign of success:** the cook taps the button or a row within 5 s, and never scrolls back to the ingredients while
  cooking.
- **Sign of mere prettiness:** people screenshot the carton but still hunt for search.

## Data audit (what Home can say)

**What a list item carries.** `GET /api/v1/recipes` returns `recipeSchema` (recipe-core `recipe.types`):

- `totalTimeMinutes`, `prepTimeMinutes` and `cookTimeMinutes`
- `servings`, `difficulty`, `mealType` and `cuisine`
- `dietaryFlags` and `tags`
- `averageRating` and `ratingCount`
- `status` and `visibility`
- `coverPhotoUrl`.

**What is stored but not on a list item.** `viewerRating` holds the cook's own stars. Only **detail reads** fill it
(`recipes.service.ts:918`, `recipeResponse.ts:64`). Collection membership is also not on a list item.

**What is not stored at all:** per-user cook or view history, pantry, plan, shopping list and household. Cook marks
(the current step) live in session storage on web and in memory on native. They are not on the account.

**The API gap, stated as a dependency.** `listRecipesQuerySchema` takes only `page`, `pageSize` and `sortBy`, and
`RECIPE_LIST_SORT_BY` is `updatedAt`, `createdAt` or `title`. There is no time sort and no `mealType` filter. So
"your quickest dinner" can be built today only by the client, over the cook's own fetched pages. That is fine for a
first page of a personal library. Beyond one page it is a contract change owned by recipe-service: add
`sortBy: totalTimeMinutes`, `sortBy: servings` and a `mealType` filter. The same gap covers both superlatives,
"quickest" and "biggest". Until then, each reason applies only over what was read.

**So Home says only:**

- "Your quickest dinner" (`totalTimeMinutes` + `mealType`)
- "Serves 6 · your biggest" (`servings`)
- "Easy · vegetarian" (`difficulty` + `dietaryFlags`)
- "Cooking now · Step 4 of 7", labelled honestly as kept on this phone.

There is no "you rated it" on Home, no "not opened lately", and no time question. Unbuilt features get one line below
the first screen.

## Contract and list ledger

The bindings are canon §1.1 to §1.4, §2.1 to §2.3, §3.2 to §3.4, §4, §4.1 and §5.

| List                           | Direction                                          | Reason                                                          |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------- |
| Home choices (carton + 2 rows) | Vertical                                           | A short choice to compare. Three items, all on the first screen |
| Ingredients                    | Vertical, ticks                                    | A sequence you go through fully                                 |
| Steps                          | Vertical, current step marked                      | A sequence. Quantities are inline                               |
| Nutrition                      | Vertical                                           | Read fully                                                      |
| My recipes                     | Vertical, with a count, a sort and **Show 4 more** | A large collection you scan. No infinite scroll                 |
| Filter chips                   | **Horizontal**, the next chip peeks                | Optional peers. The first few carry the value                   |
| Cook mode                      | One step at a time, with Next and Previous         | Not a list                                                      |

## Taste argument and signature

- **Trajectory.** Three 2025 redesigns moved the same way: Airbnb's dimensional relaunch, iOS 26 Liquid Glass (controls
  in their own layer over content) and Material 3 Expressive (more colour and shape). Content becomes an _object_, and
  controls step back.
- **My one step past them.** The content object is a real food pack in honest flat colour, not glass and not 3D. It
  changes no control. It did not ship before 2022, because flat-colour UI then meant small cards and coloured headers,
  not a pack-scale name over a window.
- **Mood test.** A pasta box is the most weeknight object in the kitchen. Nothing moves at rest.
- **Signature.** The die-cut window, meaning the food seen through a keylined window in the carton, with the name
  printed on the carton.
    - **Where it appears:** Home (one carton), the recipe page header, the first-run and loading states, and the
      no-photo thumbnail (an empty window).
    - **Where it is banned:** cook mode, every control, list rows other than the empty-window placeholder, and behind
      body text.
    - **What it encodes:** nothing. The carton is always the same blue, and every fact on it also appears in words.
      The window order switches with text size and carries no meaning.
- **Signature tests (rendered).** The longest real title, "Miso-glazed salmon with sesame greens", at 320 px and at a
  real 200%:
    - the carton stays a carton
    - the name is on colour, at most three lines at 36 px
    - the window and keyline are intact.

    The name grows at half rate (`min(calc(1rem + 16px), 40px)`), so it never becomes a wall of type.

### Prior-art search (WebSearch, run this round)

- **Closest shipping feature: the iOS 26.4 Apple Music track list,** which takes a background colour that complements
  the artwork ([9to5Mac](https://9to5mac.com/?p=1039505)). **The visible difference:** Music's colour changes with the
  art, and its title sits beside the art. Carton's colour never changes, and it prints a condensed name on the colour
  above a keylined window, with a reversed facts band. That is packaging grammar.
- **App Store Today**, from round 0, prints the title over the art on a scrim. Carton never puts text on the image.
- **The nearest non-shipping concept** is a "trading-card recipes" portfolio piece
  ([Shawn Van Daele](https://shawnvandaele.lovable.app/work/shawns-recipe-box-product-design)). A trading card frames
  art with a name. It is a collectible, not a pack, and it has no reversed band. I note it as a risk to watch.
- **A recipe-card search** found no shipping recipe app with a name on solid colour above a framed photo
  ([Tubik](https://tubikstudio.com/blog/wp-json/wp/v2/posts/4261),
  [Galley](https://support.galleysolutions.com/product-release-note-recipe-card)).
- **Limits:** the searches return text, not screenshots, so the result is partly verified.
- **Closest-app test:** pass. The difference is neither the content nor the colour.
- **Excitement test:** what a viewer screenshots is the recipe that looks like a box you buy, with its name stacked big
  above the food. The searches found no app that does this.

## Screens

- **Home, deciding.**
    - The date, then **Tonight** (700, normal width), then the avatar.
    - "Your quickest dinner" with an icon.
    - The carton: the name, the window, and a band reading 25 min · Serves 2 · Easy.
    - **Cook this tonight** sits below the carton, never inside it, and opens the recipe at the ingredients.
    - "Or one of these": two 76 px rows with 76 × 57 photos.
    - "All your recipes 24 ›", then one Coming soon line.
    - Three tabs.
- **Recipe page.**
    - A full-width carton. Back, Edit and More sit on solid discs printed on the carton, never on the photo.
    - Then the meta line, the name (37 px), the window, and the band (Total, Prep, Serves, Difficulty).
    - Then the rating ("You rated it 5", from `viewerRating` on the detail read), the description, and Ingredients with
      the servings stepper above the dock.
    - Steps: numbered, with inline bold quantities. The current step has a wash and a label, and durations are timer
      buttons.
    - Then Nutrition, Version history, and Delete as a Radicchio text row with an icon.
    - When scrolled, a solid bar shows Back, the title and Edit.
- **My recipes.**
    - The large title, a My recipes | Collections switch, search, and chips with counts.
    - "24 recipes" with a sort.
    - Rows with 76 × 57 photos and 6 px corners. Draft and Private are tags with words. A draft with no photo shows an
      empty carton window.
    - "Showing 20 of 24", **Show 4 more**, and a docked **New recipe**.
- **Cook mode.**
    - Neutral and opaque, with no carton.
    - Close, then "Screen on", switched on by the Start cooking tap.
    - Step 3 of 7 with a segmented bar.
    - The step at 28 px with inline quantities, and a folded "Why one layer?" note.
    - A fixed timer strip with Pause.
    - Previous and **Next step** at 72 px. Voice "Next" and "Back" also work.
- **States.**
    - Home cooking: a brown chili in the window, which is the warmth test D3 asked for.
    - Home nothing yet: an empty plate.
    - A skeleton carton after 1 s.
    - Offline, an error with Try again, saved, and deleted with Undo.

## Palette: "Carton"

**Idea.** A white shelf, one sky-blue carton with a squid-ink band, and one tomato. Blue sits opposite the browns,
golds and reds of cooked food, so the dish in the window reads warmer. The chili render shows this, by inspection
only. Tomato is the only colour you can press.

**Structure.** A large content hue sits around the food, the action has its own warm hue, and the band is always
reversed: Shelf text on Squid ink, in both themes. It is not Mise with a new accent: a content hue is visible at
swatch size (canon §3.2 test 3). The ground is plain white on purpose (ΔL×100 from Mise 2.8).

| Role        | Name        | Use                                                              | Light     | Dark                      |
| ----------- | ----------- | ---------------------------------------------------------------- | --------- | ------------------------- |
| Ground      | Shelf       | The page                                                         | `#FFFFFF` | `#0E1216`                 |
| Surface     | Board       | Sheets, tab bar, docked bar                                      | `#FFFFFF` | `#161B21`                 |
| Sunken      | Tray        | Search, segmented track, cook timer strip                        | `#EDF1F4` | `#1F262D`                 |
| Edge        | Rule        | Control outlines, unticked boxes                                 | `#6E7A86` | `#7D8893`                 |
| Ink         | Squid ink   | All text, the window keyline, the band                           | `#11161C` | `#EEF2F5`                 |
| Muted       | Pepper      | Secondary text, 16 px and up                                     | `#4A5560` | `#AEB8C2`                 |
| Action      | Tomato      | The one filled button, links, ticks, the current-tab icon, focus | `#C41E3A` | `#FFA294`                 |
| On action   | On tomato   | The label on a Tomato fill                                       | `#FFFFFF` | `#2A0606`                 |
| Action wash | Tomato wash | Selected chip, current-step ground                               | `#FCE6E8` | `#33181A`                 |
| Warning     | Mustard     | Short labels with an icon                                        | `#855400` | `#F2C14E`                 |
| Danger      | Radicchio   | Delete: text with an icon, never a fill                          | `#8F1D63` | `#F2A6F0` (was `#F59AC9`) |
| Hairline    | Seam        | Dividers only                                                    | `#DDE3E8` | `#2A3239`                 |
| Content hue | Sky carton  | The carton only, never a control or text                         | `#B9D8F2` | `#21405E`                 |

**Check script.** `scratchpad/r1d1/check1.mjs` uses culori 4 and my APCA 0.0.98G. I checked the APCA against the
canon in round 0: white on Leaf gives Lc 88, and Beetroot gives 8.00:1 at Lc 82.6. **Result: 0 fails, exit 0.**

**Contrast, light then dark.** Grounds are Shelf, Board, Tray and Wash.

| Pair                          | Light                        | Dark                        |
| ----------------------------- | ---------------------------- | --------------------------- |
| Ink                           | 15.3 to 18.2:1, Lc 93 to 105 | 13.6 to 16.7:1, Lc 96 to 98 |
| Ink on the carton             | 12.3:1, Lc 80                | 9.5:1, Lc 90                |
| Muted                         | 6.4 to 7.6:1, Lc 75 to 87    | 7.6 to 9.3:1, Lc 60 to 63   |
| Ink to Muted                  | **2.39**                     | **1.79**                    |
| Tomato as text                | 4.9 to 5.8:1, Lc 66 to 77    | 7.9 to 9.7:1, Lc 63 to 65   |
| On tomato                     | 5.84:1, Lc 83                | 9.62:1, Lc 66               |
| Mustard                       | 5.4 to 6.4:1, Lc 70 to 82    | 9.1 to 11.2:1, Lc 70 to 73  |
| Radicchio                     | 7.0 to 8.3:1, Lc 76 to 87    | 8.4 to 10.3:1, Lc 66 to 68  |
| Rule on Shelf, Board and Tray | 3.9 to 4.4:1                 | 4.2 to 5.2:1                |
| Band (Shelf on Squid ink)     | 18.2:1                       | 16.7:1                      |

**Roles inside the palette (ΔE00).**

| Pair               | Light | Dark     |
| ------------------ | ----- | -------- |
| Action and carton  | 54.3  | 59.9     |
| Action and warning | 31.3  | 30.2     |
| Action and danger  | 20.7  | **25.6** |
| Carton and warning | 52.7  | 67.2     |
| Carton and danger  | 56.8  | 56.2     |
| Warning and danger | 44.3  | 54.6     |

**Action against earlier-round actions (ΔE00).**

| Theme | `#2A6B65` | `#6CC0B3` | `#7CC8BE` | `#0B4F3E` | `#8EDBBF` |
| ----- | --------- | --------- | --------- | --------- | --------- |
| Light | 52.3      | 63.3      | 62.5      | 56.7      | 68.1      |
| Dark  | 53.0      | 46.3      | 44.8      | 63.6      | 47.4      |

**Siblings.** See the table under "Pushed back". The round-0 Option 3 Persimmon dark `#FFA478` is 9.6 from Tomato. Its
designer has said that option is moving.

**Grounds (OKLCH).** Light L 1.000. Dark L 0.180, C 0.010. The carton is L 0.868 in light and L 0.363 in dark.

## Type

Bricolage Grotesque is the only family.

| Style       | Size / line                   | Weight, width       | Use                         |
| ----------- | ----------------------------- | ------------------- | --------------------------- |
| Carton name | 32 (Home), 37 (recipe) / 0.95 | 800, width 78%      | The name on the carton only |
| Large title | 34 / 1.05                     | 700, normal         | Tonight, Recipes            |
| Section     | 22                            | 700                 | Ingredients, Steps          |
| Cook step   | 28 / 1.3                      | 600, quantities 800 | Cook mode                   |
| Body        | 17 / 1.45                     | 400                 | Everything you read         |
| Secondary   | 16                            | 400, Muted          | Meta lines                  |
| Label       | 13                            | 750, Ink only       | Group labels, tags          |

- **Scaling.** Display sizes grow at half rate and cap at 40, 44 and 48 px. Body text scales fully.
- **Spacing.** 4, 8, 12, 16, 24, 32. Groups are at least twice as far apart as items within them.
- **Radii.** Carton 8, window 16, controls 14, thumbnails 6.

## Motion

- **Nothing moves at rest.**
- **Press.** Scales to 98% within 100 ms.
- **Tick.** Fills in 180 ms.
- **Specified, not built:** the Home carton grows into the recipe page's carton. This is a shared element on a 300 ms
  spring at 100% damping. It is interruptible and becomes a cross-fade under Reduce Motion.
- Every transition is off under `prefers-reduced-motion`.

## Self-review (canon §5, from the renders)

### A. Fresh

- **Pass.** Each choice reads as 2024 to 2026: the white ground, the condensed grotesk name, the pack and the keyline
  window.
- **Pass.** The option differs from the house answer on two axes.
- **Pass.** The closest app is named, and so is its nearest feature.
- **Pass.** The trajectory step is named.
- **Pass.** The food is the largest and most colourful thing (window to blue 1.41).
- **Pass.** The signature is one sentence, with its bans stated.
- **Pass.** The need is the dish name and an untouched photo.
- **Pass.** The thesis and reference are stated.
- **Pass, partly verified.** The excitement and closest-app tests.
- **Pass with a limit.** The signature at 320 px and 200%. At large text the carton uses the window-first order,
  which reads closer to a photo card. The crisp corners, the keyline and the reversed band keep it apart. I judged
  this from the 200% render, not from a thumbnail beside the plain card.

### B. Distinct

- **Pass.** Structure differs on the contact sheet.
- **Pass.** The palette is named and complete.
- **Pass, against earlier rounds.** Action ΔE00 is at least 44.8 from every earlier-round action.
- **Conditional, against this round's siblings.** Their round-1 files are not visible to me. The dark constraint is
  stated above.
- **Pass.** Roles are at least 20.7 apart in light and 25.6 apart in dark.

### C. Simple

- **Pass.** The list of new interactions is empty.
- **Pass.** Every screen shows where you are, where you can go and how to get out.
- **Pass.** One filled primary per screen, low, with a label.
- **Pass.** The signature encodes nothing.
- **Pass.** Every target looks tappable.
- **Pass.** Each target does one thing. The carton link and the button are separate.

### D. Psychology

- **Pass.** The list ledger is complete.
- **Pass.** Show 4 more, with a count.
- **Pass.** Group gaps are at least 2×.
- **Pass.** Quantities sit in the steps, and the current step is marked.
- **Pass, narrowly.** First screen: at 390 px, all three dinners are above the tabs with 19 px to spare, and only
  the top of "All your recipes" peeks. At 200%, the food and the primary are on
  the first screen.
- **Pass.** Feedback and Undo.

### E. Calm

- **Pass.** Tomato appears only on the primary, links, ticks, the current-tab icon and timers.
- **Pass.** No idle motion.
- **Pass.** Each ornament has a job:
    - the keyline marks the die-cut and separates a pale photo edge from the carton
    - the photo grain and light make the stand-ins read as photographs
    - the cook-mode fade signals more text.
- **Pass.** One family.
- **Pass.** Weeknight test.

### F. Cooking

- **Pass.** 28 px, inline quantities, timers.
- **Pass.** Next and Previous at 72 px, fixed and labelled.
- **Pass.** Screen on, switched on by the cook's tap.
- **Pass.** No glass and no photo in cook mode.
- **Pass.** The opening screen is shown in the cooking, deciding and empty states, using list fields only.

### G. Accessibility

- **Pass.** Every pair is measured and passes.
- **Pass.** Colour is never the only cue. Danger is text with an icon.
- **Pass.** Targets: a Playwright scan of every link, button, tab and chip at 390, 320 and 200% found **none under
  44 px**.
- **Pass.** Reflow: `scrollWidth` equals the viewport at 1400, 390, 320 and 320 at 200%.
- **Pass.** The states are drawn.

**Known limits:**

- At 320 px and default text, the second Home row sits under the tabs (it ends at y 812). The rule of three dinners
  above the tabs holds at 390 px only.
- At 320 px, the recipe page's Ingredients heading ends at y 800, under the dock at y 768, because the stepper wraps.

### Nielsen's 10

- **H4, fixed.** Two account doors (the Profile tab and the avatar).
- **H8, fixed.** The title and the name were both condensed shouts.
- **H1, fixed.** The cooking state says "kept on this phone".
- **H4, residual.** The current step and a selected chip share Tomato wash. Both mean "this one", so I kept it.

## Owner pre-mortem

- **"Dated?"** No paper, serif, texture or shadowed card grid.
- **"Twins?"** Structure is distinct. The palette twin with Option 3 is that designer's stated move, and the dark
  constraint is published here.
- **"Too clever?"** Nothing to learn.
- **"No palette?"** A full table, measured.
- **"Ignores scrolling?"** See the ledger.
- **"It is a blue card like the App Store."**
    - **Cause:** coloured containers are common.
    - **Fix applied:** crisp corners, a printed keyline window and a reversed band. Name-first won on the contact sheet.
- **"The drawn food looks cheap."**
    - **Fix applied:** grain, one light and soft shadows replace round 0's flat clip-art.
    - **Residual:** it is still a drawing. The product shows the cook's own photos.
- **"Red, white and blue."**
    - **Evidence:** the sky is 63.6 from flag navy.
    - **Residual:** a taste risk on the red.

## Delivery gate

| Option | Frame card | Data audit               | List ledger | Sources and strikes              | Taste argument | Signature tests          | Prior-art search               | Palette and script | Swatch strip             | States               | Screenshots                | Self-review            | Pre-mortem |
| ------ | ---------- | ------------------------ | ----------- | -------------------------------- | -------------- | ------------------------ | ------------------------------ | ------------------ | ------------------------ | -------------------- | -------------------------- | ---------------------- | ---------- |
| Carton | Done       | Done, two API gaps named | Done        | 17 concepts, 16 struck (round 0) | Done           | Rendered at 320 and 200% | Run: 2 new searches, text only | 0 fails, exit 0    | In the page, both themes | 6 states + cook mode | 1400, 390, 320, 200%, dark | Done, two known limits | Done       |

## Not run, and why

- **The siblings' round-1 palettes.** Their files did not exist while I worked. I published the constraint instead.
- **Prior art.** The searches return text, not screenshots. I did not open each app.
- **Real photos.** The brief allows CSS, SVG or canvas imagery only.
- **Device text settings.** 200% was emulated with the root font size.
- **Distance at 60 and 90 cm.** No device.
- **Increased-contrast variants.**
- **Web width, Discover, the editor and Collections.** These are outside the sample.
- **User evidence.** This review is inspection only.
- **Type risk.** Bricolage Grotesque was common on 2024 landing pages. The condensed display cut is the less common
  use, but it can still read as trend-adjacent. Nothing this round changed that.
