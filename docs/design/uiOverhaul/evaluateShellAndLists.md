# UI overhaul: evaluation of the shell, Home, lists, Discover, Collections, account and auth

⛔ **DESIGN EVALUATION. NOT PRODUCTION CODE.** It reports findings and changes no code. The design that fixes them
is `specShellAndLists.md`. The shared rules both halves use are in `specSharedSystem.md`.

- **Mode:** EVALUATE. **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`.
- **Brief (owner, verbatim):** "Every where on all devices. Things are misaligned, don't even look close to the
  mockups, incorrect sizes, unreadable, wraps when it shouldn't and incorrectly (remember, wrapping is the second
  to last resort to fit stuff)… It looks like shit."
- **Standing.** I did not author these screens or an earlier spec for them. I authored nothing evaluated here.
- **Seen rendered:** yes for web, partly for native.
    - Web: all 105 production-build captures in my scope (21 states × 320/390/768/1280/1920), from
      `.local-sandbox/uiAudit2026-10-08/`. I cut tall captures into viewport-height tiles and read every tile.
    - Mockups: I rendered `docs/mockups/screens/screenHome.html`, `screenRecipes.html`, `screenProfile.html` and
      `screenAuth.html` at 390 and 1280 myself. Google Fonts did not load in my capture, so the mockups' serif shows
      as a fallback face. I judged their structure, not their type.
    - Native: 5 distinct Pixel 6 captures in my scope (Home top, Home scrolled, library, create menu). By md5,
      `uiAudit_discover.png`, `uiAudit_profile.png` and both `recipeDetail` shots are the same file, the discard
      dialog. So Discover, Collections, Profile and account were not seen on device. Findings about them come from
      source and are marked **(source)**.
- **Not user evidence.** Everything here is inspection. No user was observed. Where a finding predicts behaviour,
  it is heuristic judgement, untested.
- **Severity** (`critique-handoff.md`): 4 must fix before release · 3 major · 2 minor · 1 cosmetic.
- **Excluded as capture artifacts:** fixed bars that appear mid-page in stitched full-page shots, and "Development
  mode" on the Clerk card (a property of the dev Clerk instance). The seed title `local-88630-caafcb80` on device
  is test data.

## Criteria

**User:** a home cook. **Tasks:** find a recipe they own, browse others' recipes, group recipes into
collections, sign in, manage their account. **Context:** a phone in one hand, often in a kitchen. A laptop for
longer sessions.

Measured against:

- WCAG 2.2 AA, by success-criterion number.
- Nielsen's 10 heuristics.
- The mockups (`docs/mockups/screens/*.html`). The owner ruled they are the floor.
- The 001 wireframes (`specs/001-commise-recipe-app/product-spec/wireframes/recipe-list.md`, `recipe-search.md`,
  `collection-view.md`).
- The owner's wrap rule (memory `wrappingInControlElements`). Wrapping is the second-to-last resort, and it is
  never acceptable inside a control or a short label.
- `@commise/ui` tokens (`packages/apps/commise/ui/src/tokens/`).

## Coverage (every state × width inspected)

| State                      | 320                                            | 390 | 768 | 1280 | 1920 | Native   |
| -------------------------- | ---------------------------------------------- | --- | --- | ---- | ---- | -------- |
| Sign in                    | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Sign up                    | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| 404 signed out / signed in | ✓ (byte-identical pair at every width, by md5) | ✓   | ✓   | ✓    | ✓    | —        |
| Home                       | ✓                                              | ✓   | ✓   | ✓    | ✓    | ✓ device |
| My Recipes, populated      | ✓                                              | ✓   | ✓   | ✓    | ✓    | ✓ device |
| My Recipes, empty          | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Create menu open           | ✓                                              | ✓   | ✓   | ✓    | ✓    | ✓ device |
| Community tab              | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Discover browse            | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Discover search            | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Discover no results        | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Filter sheet / inline bar  | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Collections list           | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| New collection             | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Collection detail          | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Add recipes to collection  | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Profile (error state only) | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Settings                   | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Account (error state only) | ✓                                              | ✓   | ✓   | ✓    | ✓    | source   |
| Legal sources              | ✓                                              | ✓   | ✓   | ✓    | ✓    | —        |

**Not seen in any capture:** Profile and Account populated (the capture cannot stub the server-side identity
read), every loading state except the Discover rails, every load-error and refresh-error state, offline, the
collection list empty state, the Collections and Discover screens on device, and the mobile nav drawer. Those are
specified from source and the wireframes, not judged here.

---

## Findings, severity 4 → 1

Each finding keeps observation, interpretation and recommendation apart. **Fix** points to the spec section.
"Class" means the same defect appears on more than one screen, so the fix belongs in a shared primitive.

### Severity 4

**E1 · Discover and Community scroll sideways at 320, 390 and 768 · WCAG 1.4.10 Reflow (fail)**

- _Observed._ While the rails load, the page is 832 px wide at 320 and 390, and 840 px at 768 (capture
  dimensions: `discover/320.png`, `discover/390.png`, `recipesCommunity/320.png` are 832 px wide). The top bar
  stays 320 wide. The loading skeleton tiles run off the right edge.
- _Cause._ `RecipeBrowseRailLoading.tsx:21` lays the skeleton tiles out with `flex gap-4` and no overflow rule.
  The loaded rail (`RecipeBrowseRailResults.tsx:31`) has `overflow-x-auto`, so the defect exists only while
  loading. That is why it survived review.
- _Interpretation._ Every phone user meets this on their first visit, because the first visit always loads.
- **Fix:** `specShellAndLists.md` §D.4. The skeleton uses the same scroll container as the loaded rail.

**E2 · Unknown URLs show Next.js's bare default 404 · Nielsen #9, #3**

- _Observed._ `/this-page-does-not-exist` renders "404 | This page could not be found." in a system face on
  white, with no app CSS, no brand, no navigation and no way home, signed in or out, at every width.
- _Cause (likely, for the implementer to confirm)._ The path is captured by the `[locale]` segment.
  `[locale]/not-found.tsx` exists and renders `RouteNotFoundState`, but an invalid locale seems to fall past it,
  and there is no root `not-found.tsx` or root layout to catch it. Next then renders its own built-in page.
- _Interpretation._ A dead end with no route back is the worst exit a product can give (peak–end: an experience
  is judged by its worst moment and its ending).
- **Fix:** `specShellAndLists.md` §N. The required outcome is a branded page, inside the shell when signed in,
  with a route home. The routing mechanism (middleware redirect or a root `not-found`) is for `staff-architect`.

**E3 · The collection title breaks mid-word into a 3-letter column at 320 and 390 · Nielsen #8, WCAG 1.4.10
(content becomes unreadable at the reflow width)**

- _Observed._ At 320, "Weeknight Dinners the Whole Family Will Actually Eat" renders as a column of fragments
  ("Wee / knig / ht / Dinn / ers …"), nine-plus lines tall, beside "Rename" and "Delete". At 390 it still breaks
  as "Weeknigh / t". The recipes start almost two screens down.
- _Cause._ `CollectionHeader.tsx:74-86`: the H1 is a flex item with `min-w-0 break-words`, and the actions are
  `shrink-0`. `break-words` lets the H1's min-content width shrink to a single character. The native header has
  the same row (`CollectionHeader.native.tsx:120-127`) **(source)**, so the device will show the same defect.
- **Fix:** `specSharedSystem.md` §1 and §6 (`PageHeader`). Class.

**E4 · Collections has no way in on the web · Nielsen #6, #4 · wireframe parity**

- _Observed._ No sidebar item, tab-bar item, source tab or Home link leads to `/collections`. The sidebar and tab
  bar list Home, Recipes, Meal Plan, Grocery, Nutrition and Profile (`resolveHomeNav`). The source tabs are only
  `['mine', 'community']` (`features/recipes/src/list/model.ts:300`). The route works only if you type its URL.
  Mobile reaches Collections through a third top tab (`mobile/src/screens/RecipesScreen.tsx:60`).
- _Interpretation._ A shipped feature (FR-008 to FR-011) that a web user cannot find does not exist for them. The
  two platforms also have different structures for the same destinations (FR-044 is functional parity, and this
  breaks it).
- _Wireframe._ `recipe-list.md` puts Collections in the bottom nav.
- **Fix:** `specShellAndLists.md` §IA. ⚠️ One-way door.

### Severity 3

**E5 · Library facet chips wrap to five lines at 320 · owner wrap rule · Nielsen #8 · wireframe parity**

- _Observed._ "All, Quick (<30m), British, dairy-free option, gluten-free, Moroccan, vegan, vegetarian" wraps to
  5 lines at 320, 3 at 390 and 2 at 768. With the glass H1 card and the tabs above it, the first recipe starts
  below the first screen at 320 and 390. The FAB overlaps the chip rows.
- _Wireframe._ `recipe-list.md`: "Filter chips: Horizontal scroll; active = filled". The built row wraps instead.
  Cause: not built as specified.
- **Fix:** `specSharedSystem.md` §7 (`ChipRow overflow="scroll"`). Class.

**E6 · Card grids are ragged and the card's hierarchy is flat · Nielsen #8 · Gestalt proximity · CR-002 parity**

- _Observed._
    - In one grid row, cards range from 270 px to 520 px tall (1280: "Slow-Roasted Lamb" 460, "Pasta" 320).
    - Tags stack one per line even when the card has room for three across (Home 1280, lamb card).
    - The calorie placeholder (an empty grey pill on every card) drops onto its own line in narrow cards.
    - At 320 on Home, the two-column card puts each badge on its own line. One card reaches 470 px for a 136 px-wide
      column.
    - Status, difficulty, cuisine, visibility and timestamps share one visual weight, so nothing leads.
    - On device, the native card has a huge blank grey cover with no glyph, and meta shows "15 min 2" with no
      icons (`RecipeCard.native.tsx:105-107` renders text only).
- _Parity._ CR-002 requires "★ rating (average + count)". The built card shows stars only. The mockup's card shows
  title, one meta line and stars. The merged card is required, so fields stay, but their layout must change.
- **Fix:** `specSharedSystem.md` §12 (grid card with subgrid rows, row card for phones). Class.

**E7 · Labels wrap inside controls and short text · owner wrap rule**

All observed at 320 unless noted:

| Where                        | Observed                                                          | Anchor                                       |
| ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| Collections header button    | "New / collection" in two lines                                   | `CollectionListFrame.tsx:26-33`              |
| Settings                     | "Sign out of your / account" in two lines                         | Settings capture 320                         |
| Bottom tab bar               | "Meal / Plan" in two lines (six tabs in 320 px)                   | `HomeTabBar.tsx:74`, `:93`                   |
| Discover sort                | "Quickest" drops to a second row at 390. Two rows at 320.         | discoverSearch 320/390                       |
| Top-bar title                | "New collection", "Add recipes", "Data sources" wrap to two lines | `HomeTopBar.tsx:108`                         |
| Sign-up footer               | "Already have an / account?" + "Sign / in"                        | signUp/320                                   |
| Collection picker status     | "In this / collection" in two lines, at every width               | `CollectionRecipePickerCandidates.tsx:81-95` |
| Discover filter, time groups | "Under 60 min" alone on a second row at 320 and 390               | filter sheet                                 |

- _Interpretation._ Each one widens the gulf of evaluation: a two-line button reads as two items, and a two-line
  tab label pushes its icon out of line with its neighbours.
- **Fix:** `specSharedSystem.md` §1, then each element's rule in `specShellAndLists.md`. Class.

**E8 · The "Add recipes" picker is unusable at 320 · Nielsen #8 · scroll budget**

- _Observed._ The H1 "Add recipes to Weeknight Dinners the Whole Family Will Actually Eat" takes 7 lines in 28 px
  Playfair. "Done" floats beside the middle of it. Each row gives the title what is left after the Add button
  and a "In this collection" status column, so titles wrap to as many as 10 lines. Row heights run from 70 px to
  360 px.
- **Fix:** `specShellAndLists.md` §C.4.

**E9 · Scroll budget: the first screen holds no content on four surfaces · Nielsen #8 ·
`cross-platform-translation.md` scroll budget**

| Surface              | Width(s) | First content starts at | What sits above it                                     |
| -------------------- | -------- | ----------------------- | ------------------------------------------------------ |
| Discover / Community | 768–1920 | y ≈ 885                 | all seven filter groups, open, about 520 px            |
| Home                 | 320, 390 | below the first screen  | the greeting card and three "Coming soon" placeholders |
| My Recipes           | 320, 390 | at or below the fold    | glass H1 card, tabs, search, 3–5 rows of chips         |
| Collection detail    | 320      | about 2 screens down    | the broken title (E3) and the actions card             |

- Also: three time groups (prep, cook, total) repeat the same three choices, giving nine chips for one idea
  (Hick). The wireframe uses single-select radios with "Any" (`recipe-search.md`, Filter Options).
- **Fix:** `specShellAndLists.md` §D (filters move to a sidebar at `@wide` and to a sheet below it), §H (Home
  order), §R (library header).

**E10 · Three different "selected" treatments · Nielsen #4 · WCAG 1.4.1 (at risk)**

- _Observed._ Library facets show selected as a seafoam fill. Discover filters show it as a seafoam outline only.
  Sort shows it as a charcoal fill. The difficulty picker (other half) uses a dark teal fill.
- _Measured._ Seafoam on white is 4.67:1, so the outline passes 1.4.11. This is not a contrast failure. The
  defect is inconsistency, and the outline-only state relies on colour and stroke weight alone (1.4.1 at risk).
- **Fix:** `specSharedSystem.md` §4 and §7. Class.

**E11 · Search fields and chips have no visible edge · WCAG 1.4.11 (probable fail)**

- _Measured._ The input border is `border-border`, `rgba(178,190,195,0.3)`: 1.19:1 against white. The white fill
  is 1.08:1 against the sand canvas. Unselected chips are pearl on sand, about 1.0:1.
- _Interpretation._ The placeholder text is the only cue that a field is there. Whether that meets "visual
  information required to identify" is a judgement under the W3C Understanding document. I rate it a probable
  failure and a certain usability defect.
- **Fix:** `specSharedSystem.md` §4 (`border-control`, 3.31:1), §9 (`SearchField`). Class.

**E12 · Page titles, headings and type faces change from page to page · Nielsen #4**

- _Observed._
    - The page title is a 28 px Playfair H1 in a gradient card on Recipes, a plain 28 px H1 on Discover and
      Collections, and an 18 px Inter `<p>` in the top bar on every page. On Recipes at 320, the word "Recipes"
      appears twice within 160 px.
    - Home's widget titles ("Today's Nutrition") are Inter semibold. "Recent recipes" beside them is Playfair.
      Discover's rail titles are Playfair with a teal underline bar.
    - Card titles are Playfair on web, system sans on Android.
    - Casing changes: "Today's Nutrition", "This Week's Meals", "Create from Scratch", "Paste an Ingredient List",
      "Account Settings", "Edit Profile", "Danger Zone" are Title Case. "Resume cooking", "Recent recipes", "Food
      data" are sentence case (`content-design.md`: pick one).
    - Content left edges move: six different max-widths (448 to 1120 px) across nine files. Home is centred at 1920
      while the top-bar title is left-aligned.
- **Fix:** `specSharedSystem.md` §2.2 and §3, `specShellAndLists.md` §Copy.

**E13 · Top-bar Search and Notifications are dead buttons · Nielsen #1, #4 · WCAG 4.1.2 (name and role promise
an action that does not exist)**

- _Observed._ `HomeTopBar.tsx:112-131`: both `<button>`s have an accessible name and no `onClick`. On a phone they
  take the space that makes the page title wrap (E7).
- _Interpretation._ A control that does nothing is a broken promise. A screen-reader user hears "Search, button"
  and gets nothing.
- **Fix:** `specShellAndLists.md` §S.2.

**E14 · Empty library is a missed first run · cognitive walkthrough Q1 and Q2 fail · Nielsen #10**

- _Observed._ "No recipes yet" is a body-weight line, not a heading. One sentence and "Create your first recipe".
  No picture, no value statement. The search field above it has nothing to search. The only path offered is
  "from scratch", although the FAB menu also offers "Paste an ingredient list", which is the faster start.
- _Walkthrough._ Q1 (will the user try the right thing?): weak, because nothing says what the library is for.
  Q2 (will they see the action?): yes, but only one of the two real starts.
- **Fix:** `specShellAndLists.md` §R.3.

**E15 · Profile, Settings and Account are three thin pages · Nielsen #4, #6 · mockup parity**

- _Observed._ Settings holds a "Session" card with one button and a "Food data" link. Profile and Account
  (captured only in their error state) each print one error sentence. Profile's only action on error is "Sign out
  of your account", which is the wrong emphasis for a temporary read failure, and there is no "Try again".
  `screenProfile.html` shows one "Profile & Account" surface with a section nav.
- **Fix:** `specShellAndLists.md` §P. ⚠️ One-way door (URLs).

**E16 · The sidebar scrolls away with the page · Nielsen #3**

- _Source._ `HomeSidebar.tsx:74`: the sidebar is `h-screen` inside a `min-h-screen` flex row, with no `sticky`.
  On a page longer than the window, the navigation and the collapse control scroll off the top.
- **Fix:** `specShellAndLists.md` §S.1.

**E17 · Discover cards cannot be cloned or attributed the way the wireframe says · FR-005 parity**

- _Observed._ Community and Discover cards show no author ("by @handle"). `recipe-search.md` puts the author on
  every result card (FR-005 attribution). The Clone button is a coral-outlined pill of intrinsic width, left-aligned
  under the rating, which adds a whole row to every card.
- **Fix:** `specSharedSystem.md` §12, row 6.

### Severity 2

| ID  | Where                   | Criterion                       | Observed                                                                                                                                                                                                                                 | Fix                       |
| --- | ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| E18 | Card badges             | Nielsen #4, 1.4.1               | "Hard" uses the `error` fill, so difficulty reads as a fault. "Draft" and "Medium" share solid amber.                                                                                                                                    | Shared §4                 |
| E19 | Source tabs             | Nielsen #4                      | The selected tab is a white card with a 2 px underline. The unselected tab is a pearl card with a 1 px slate rule. They look like two components (`RecipeSourceTabs.tsx`).                                                               | Shared §8                 |
| E20 | Discover rails at ≥ 768 | Nielsen #6                      | The fourth card is cut at the container edge. No previous/next buttons, no visible scrollbar. A mouse user has no cue that the rail scrolls.                                                                                             | Spec §D.4                 |
| E21 | Discover no results     | Nielsen #9, `content-design.md` | Copy says "Try adjusting [filters]" when none are applied. No "Clear filters" or "Clear search". Prep/cook/total time groups still show, though they cannot help. At 320 the copy runs under the tab bar.                                | Spec §D.5                 |
| E22 | Create menu             | Nielsen #6                      | Two Title Case text items with no description of how they differ. The menu covers the first card. At 1920 the FAB and menu float in the right gutter, 230 px from the grid.                                                              | Spec §R.2                 |
| E23 | Sign in / up at 320     | owner wrap rule, Nielsen #8     | Card padding 40 px plus a 20 px margin leaves a 200 px column. "Continue with Go…" truncates. Placeholders clip ("Enter email or usernam"). Cause: `clerk.ts`, `elements.card.padding: '2.5rem'`.                                        | Spec §A                   |
| E24 | Collection detail       | Nielsen #8, #4                  | Two add actions ("Add Recipes" in the rail and "Add a recipe" above the list). "Save changes" is styled as plain text. At 1920, Rename and Delete sit about 900 px from the title.                                                       | Spec §C.3                 |
| E25 | Collection member row   | Nielsen #3, #5                  | "Remove" is red text right beside the title link. It removes at once (`CollectionDetailContainer.tsx:328`), with no confirm and no undo. No thumbnail.                                                                                   | Spec §C.3                 |
| E26 | Collections list        | Nielsen #6                      | Cards show name and description only. No recipe count, visibility or cover, so the user cannot tell an empty collection from a full one. Card heights vary from 70 to 150 px in a row.                                                   | Spec §C.1                 |
| E27 | Home placeholders       | Nielsen #1                      | The three "Coming soon" widgets are grey skeletons. Grey skeletons mean "loading" everywhere else in the app, and "Coming soon" is 12 px. The week strip clips its last day at 320 and 768.                                              | Spec §H                   |
| E28 | Avatar                  | Nielsen #4                      | Web shows a person glyph on some pages and "E" on others. Device shows a dot (`mobile/.../HomeTopBar.tsx:85` renders `'·'`).                                                                                                             | Spec §S.2                 |
| E29 | Grid width              | Nielsen #8                      | Card grids key off the viewport (`xl:grid-cols-4`), so a 1920 screen still shows four 266 px cards and cuts titles at two lines.                                                                                                         | Shared §2.1, §12          |
| E30 | Bespoke buttons         | system                          | 29 primary buttons in 27 files are hand-built (`rounded-full bg-seafoam px-…`) instead of `@commise/ui/button`. They miss its focus token and touch minimum.                                                                             | Shared §10                |
| E31 | Disabled destinations   | Nielsen #1, #4                  | Meal Plan, Grocery and Nutrition are not reachable but look exactly like reachable items. Only `cursor-not-allowed` (hover only, absent on touch) and the accessible name tell them apart. At 320 they also cost three of six tab slots. | Spec §S.3, owner decision |
| E32 | Discover naming         | Nielsen #4                      | One place has four names: nav item "Recipes", tab "Community", top bar "Discover", H1 "Discover recipes".                                                                                                                                | Spec §IA, owner decision  |

### Severity 1

| ID  | Where         | Observed                                                                                                            |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| E33 | Legal sources | The top-bar title wraps at 320. The "↗" glyph after links has no accessible text saying "opens in a new tab".       |
| E34 | Sidebar       | The collapse "«" button sits alone 300 px below the nav with no label. The mockup puts it on a divider at the foot. |
| E35 | Card cover    | Recipes with no photo get a full 4:3 grey box with a 40 px glyph: about 190 px of nothing on a phone.               |

## Native findings (device or source)

| ID  | Sev | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | 4   | **No way back from Recipes (device + source).** The Pixel 6 library shot has no bottom tab bar. `AppRoot.tsx` renders the tab bar only on Home, and `RecipesScreen.tsx` has no Home control. Its back handler returns `false` at the root of its stack (`RecipesScreen.tsx:177-187`), so Android's system Back leaves the app's frame, and iOS has no system Back at all. That last part is from source. A cook on iOS who opens Recipes is stuck there. |
| M2  | 3   | **Home's first screen is three placeholders (device).** Nutrition, Resume cooking and This Week's Meals fill the whole first screen. "Recent recipes" starts at the fold.                                                                                                                                                                                                                                                                                |
| M3  | 3   | **Body text is not the brand face (device + source).** Only two Playfair faces are loaded (`App.tsx:66`). All body and card text renders in Roboto. The greeting renders in a system bold, not Playfair (cause open, see shared §3).                                                                                                                                                                                                                     |
| M4  | 2   | **Heavy card shadow (device).** Android elevation equals the shadow's y-offset (`tokens/native.ts`), so cards carry a dark halo the web does not.                                                                                                                                                                                                                                                                                                        |
| M5  | 2   | **Top tabs look like browser tabs (device).** "My recipes · Discover · Collections" are filled rounded tabs with a grey resting fill and an underline under all three. Same cause as E19.                                                                                                                                                                                                                                                                |
| M6  | 2   | **Create menu (device).** It opens as a popover over the card, not as a bottom action sheet, and its items are Title Case with no icons.                                                                                                                                                                                                                                                                                                                 |
| M7  | 2   | **Collection header buttons are small (source).** Rename and Delete are text buttons with `paddingVertical: 6` (`CollectionHeader.native.tsx:119`), about 30 pt tall, below Apple HIG's 44 pt.                                                                                                                                                                                                                                                           |
| M8  | 2   | **Avatar dot (device).** See E28.                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Passes run

- **Heuristic (Nielsen 10):** above. The most frequent are #8 (aesthetic and minimalist), #4 (consistency) and #6
  (recognition).
- **Cognitive walkthrough:** run on first run (empty library, E14) and sign-up (E23). The sign-up form asks for
  first name, last name, username, email and password before any value is shown (`interface-patterns.md`,
  "show value before asking for commitment"). The fields are a Clerk instance setting, so that is an owner
  decision, not a defect here.
- **WCAG 2.2 AA, by number:**
    - **1.4.10 Reflow: fails** (E1).
    - **1.4.11 Non-text contrast: probable fail** for input boundaries (E11). Seafoam outlines pass at 4.67:1. The
      disabled "Private" segment on collection detail is exempt (disabled controls are excluded from 1.4.11), so it
      is not reported.
    - **1.4.1 Use of colour: at risk** (E10, E18).
    - **1.4.3 Contrast (text): passes** for the pairs checked. Slate on white 5.24:1, slate on sand 4.87:1, slate on
      pearl 4.81:1, white on seafoam 4.67:1, charcoal on warning 6.74:1, white on error 4.66:1 (all computed).
    - **2.4.3 Focus order:** not checkable from captures. The FAB comes after the grid in the DOM, which is right.
    - **2.4.11 Focus not obscured:** the fixed tab bar can cover a focused card's lower edge on phones. `<main>`
      reserves `5rem` of bottom padding (`HomeChrome.tsx`), so the last item clears, but a focused item mid-scroll
      can sit under the bar. Spec §S.3 adds `scroll-padding-bottom`.
    - **2.5.3 Label in name:** passes where checked. The tab bar's disabled items add ", coming soon" after the
      visible label, which is allowed.
    - **2.5.8 Target size:** passes on web (44 px on coarse pointers). Native M7 fails HIG, though it passes
      WCAG's 24 px.
    - **4.1.2 Name, role, value:** dead buttons (E13).
- **States:** see Coverage. The empty and no-results states exist but are weak (E14, E21). Loading exists only as
  skeletons, and the rail skeleton causes E1.
- **Cross-platform (ten points):**
    1. Platforms: web phone/tablet/desktop, iOS, Android.
    2. Dispositions: none recorded anywhere.
    3. Primary action: FAB bottom-right on both, good. Collection actions sit top-right on phones.
    4. Hover: the disabled nav cue is hover-only (E31).
    5. Longest string: fails (E7).
    6. 320 px: fails (E1, E3).
    7. Scroll budget: fails (E9).
    8. Keyboard open: not checkable from captures.
    9. Back: broken on iOS (M1).
    10. Rule placement: E3, E5, E7, E10, E11, E19 and E30 are primitive defects.
- **Content:** casing drift (E12), copy that claims filters are applied when none are (E21), "Coming soon" too
  small to read as the message (E27).
- **Deceptive-pattern screen:** run. The PRO badge and the "Upgrade to premium" note on collection visibility are
  informative, not pre-selected, and declinable. They pass the DSA Article 25 test. None found.

## Parity with the mockups and wireframes

| Specified                                                                              | Built                                        | Sev | Cause                                                                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------- | --- | --------------------------------------------------------------------------------------------------- |
| Filter chips scroll horizontally (`recipe-list.md`)                                    | Chips wrap to 5 lines                        | 3   | not built                                                                                           |
| Collections in the primary nav (`recipe-list.md`, bottom nav)                          | No web entry point                           | 4   | not built                                                                                           |
| Rating shows average + count (`recipe-list.md`, CR-002)                                | Stars only                                   | 2   | not built                                                                                           |
| Author handle on search cards (`recipe-search.md`)                                     | None                                         | 2   | not built                                                                                           |
| Filters in a sticky left sidebar with "Clear all" (`recipe-search.md`)                 | Seven open groups stacked above results      | 3   | deliberately changed (U7), wrong cost at ≥ 768                                                      |
| Time filters are single-select radios with "Any" (`recipe-search.md`)                  | Three groups of three chips                  | 2   | **ambiguous in spec**: "Total time" is not in the wireframe                                         |
| Sort is a dropdown (`recipe-search.md`)                                                | A row of four chips that wraps               | 2   | deliberately changed                                                                                |
| Collection header shows "Public · 8 recipes" (`collection-view.md`)                    | Shown on detail. Not on list cards.          | 2   | **missing from spec**: no list wireframe                                                            |
| Page title only in the top bar (`screenRecipes.html`)                                  | Top-bar title plus a glass H1 card           | 3   | not built                                                                                           |
| Lean card: title, one meta line, stars (`screenHome.html`)                             | CR-002 merged card                           | —   | **deliberately changed by owner ruling** (merged card). Not a drift. Layout is still a defect (E6). |
| Recipes grid/list toggle (`screenRecipes.html`)                                        | None                                         | 2   | not built                                                                                           |
| Home: greeting and Nutrition side by side, Resume as a slim banner (`screenHome.html`) | Stacked full-width cards in front of recipes | 2   | not built                                                                                           |
| One "Profile & Account" surface with section nav (`screenProfile.html`)                | Three pages                                  | 3   | not built                                                                                           |
| The mockup's own chips wrap inside the pill at 390 ("My / Recipes", "45 / min")        | —                                            | —   | **the mockup is wrong here.** Do not copy it.                                                       |

The two "ambiguous / missing in spec" rows are feedback about the wireframes. `specShellAndLists.md` closes them
(§D.2 time filters, §C.1 list cards).

## Preferences (non-binding)

- I would drop the gradient wash inside Home's greeting card. The canvas already carries the same gradient
  (`globals.css`), so the card reads as a faint box inside a faint box.
- I would retire the teal underline bar under section titles. It is a decoration that competes with the selected
  tab's underline, which carries meaning.
