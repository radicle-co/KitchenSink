# UI overhaul: the build spec

⛔ **DESIGN SPECIFICATION. NOT PRODUCTION CODE.** This is the one file an engineer builds the overhaul from. It
consolidates eleven earlier files. Where this file and an earlier one disagree, **this file wins**. The only thing
above it is `ownerDecisions.md`, and this file follows that.

- **Mode:** SPECIFY (consolidation). **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`. Implementer: `fe-1`
  for feature code. Design-system work in `packages/apps/commise/ui` belongs to `staff-ux-engineer`, which can make
  it on request.
- **Order of authority used:** `ownerDecisions.md` → `editorNavA/B.md` → `createEntryC/D.md` → the points
  `resolutionA.md` and `resolutionB.md` agree on → `proposalA/B.md` → `specSharedSystem.md`,
  `specShellAndLists.md`, `specRecipeAndWizard.md` → `evaluate*.md`. Where two sources of equal rank disagree, I
  settled it. Each of those calls is listed in §11, "Settled here".
- **Accessibility floor:** WCAG 2.2 AA. Touch targets: 44 × 44 pt on iOS (Apple HIG), 48 × 48 dp on Android
  (Material), 44 × 44 CSS px on a coarse pointer on web, and 24 × 24 CSS px on a fine pointer (SC 2.5.8). The
  strictest rule for the surface applies. `fe-1` must work to WCAG **2.2** AA. A 2.1 AA implementer misses
  SC 2.4.11 and 2.5.8 without knowing it.
- **Not user evidence.** Everything here comes from inspection, published guidance and the owner's rulings. Nobody
  observed a user. Behaviour claims cite a mechanism or are labelled judgement.
- **Finding IDs** (E·, M·, F·, R·, D·, W·, S·, I·, RV·, P·, N·, V·) refer to `evaluateShellAndLists.md` and
  `evaluateRecipeAndWizard.md`.

**How to read the element tables.** Every text element has an overflow rule:

- `room`: a control that is given enough space. It never wraps and never truncates.
- `relayout@X`: the layout changes at container X so the element fits.
- `wrap:N`: wraps to N lines, then truncates.
- `truncate:N`: truncates at N lines. The full text must be reachable one step away (an accessible name, `title`,
  or the detail page).

---

## 0. Superseded: do not build these from the earlier files

| Earlier rule (file)                                                                                       | Replaced by                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Four-step wizard with Prev / **Save draft** / Next (`specRecipeAndWizard` §S1)                            | One-page editor, autosave, no Save draft button (§7)                                              |
| "Photos & review" step, visibility in Details (`specRecipeAndWizard` §S6, `proposalA`, `editorNavB`)      | Last section "Photos & publish", which holds visibility and Preview (§7.7)                        |
| "Instructions" / "Method"                                                                                 | "Steps" (en-US)                                                                                   |
| Always-visible step timer field (`specRecipeAndWizard` §S5)                                               | "+ Add a timer" disclosure (§7.6)                                                                 |
| Native "Let's build your recipe" intro card                                                               | Removed on both platforms                                                                         |
| Monospace paste textarea                                                                                  | Inter (§7.5.4)                                                                                    |
| Standalone `/parse` paste and review pages, "Start a recipe with these"                                   | "Paste a list" inside the Ingredients section (§7.5.4)                                            |
| FAB opening a two-item create menu (`specShellAndLists` §R.2)                                             | One tap opens the editor while two methods exist (§3.4)                                           |
| FAB on desktop, FAB last in DOM order (`specShellAndLists` §S.4, R.4)                                     | "New recipe" first in the sidebar at 840 px and wider. FAB right after the H1 in DOM order (§3.4) |
| Coral-outlined secondary button (`button/surfaceClass.ts` docblock)                                       | Neutral secondary: paper, `lineControl` edge, `ink` label (§1.4)                                  |
| Solid seafoam (or ocean-dark) fill for a selected chip                                                    | Seafoam tint with a seafoam edge and a check (§1.4)                                               |
| Pill-shaped text inputs (`specSharedSystem` §13.2)                                                        | 12 px rectangles. Only the search field is a pill (§1.6)                                          |
| "Community" tab inside Recipes. Discover as a Recipes tab                                                 | Discover is a top-level destination (§3.1)                                                        |
| "Soon" items in sidebar and drawer. Phone hamburger drawer                                                | No unbuilt destination in any navigation. No drawer (§3.1)                                        |
| Desktop top bar. Hidden H1 with the title in the top bar (`PageHeader titleVisibility='chrome'`)          | No top bar at 840+. Visible large title everywhere (§3.3)                                         |
| `/settings` and `/account` redirect to `/profile` anchors                                                 | Both routes deleted, no redirects (§9)                                                            |
| Profile section nav at `@wide`                                                                            | None (§9)                                                                                         |
| Viewport classes 640 / 1024 (`specSharedSystem` §2.1)                                                     | 600 / 840 (§1.2)                                                                                  |
| `content-wide` 1280                                                                                       | 1440 (§1.3)                                                                                       |
| Universal "never wrap inside a control or short label" (`specSharedSystem` §1)                            | The owner's three-condition ladder (§1.1)                                                         |
| Ⓘ status glyph on every resolved ingredient row (`ingredientStatusExplanation.md` §3a "always two slots") | Healthy rows are quiet (§7.5.1)                                                                   |
| Pick-two version compare (`specRecipeAndWizard` §S3)                                                      | Each row compares with the current version (§6.6)                                                 |
| Delete dialog "Cancel", focus on Cancel                                                                   | "Keep recipe", focus on Keep recipe (§6.5)                                                        |
| Collection right rail at `@wide`, visibility chips, "Save changes"                                        | One header at every width: Add recipes + ⋯ (§5.2)                                                 |
| New collection as a page                                                                                  | A sheet. A 480 px dialog at 840+ (§5.1)                                                           |
| Picker "Add" button column                                                                                | Whole-row toggles (§5.3)                                                                          |
| "Clone", "Clone collection"                                                                               | "Save a copy" for recipes and collections                                                         |
| "Cook with confidence. Plan with ease."                                                                   | "Your recipes, in one place." until Plan ships (§8)                                               |
| Glance line on detail (`proposalB`)                                                                       | Stat strip (§6.1)                                                                                 |
| "Search needs a connection." on Discover                                                                  | The ordinary search error (§4.6), per the owner's offline directive                               |

---

## 1. Shared system (`packages/apps/commise/ui`)

Every rule in this section is built **once, in the primitive**. A screen never re-decides it. These defects recur as
a class (`cross-platform-translation.md`, "Where these decisions belong").

### 1.1 The overflow ladder (the owner's rule)

The owner corrected the wrap rule on 2026-09-17 (memory `wrappingInControlElements`). Wrapping is unwanted in a
control or in short text, where a wrap breaks the layout or widens the gulf of evaluation and execution. The owner's
brief also calls wrapping "the second to last resort". This ladder replaces the universal wording in
`specSharedSystem.md` §1. Every text element climbs it. It stops at the first rung that works **at 320 CSS px with
the string 35% longer** (`internationalisation.md`):

1. **Re-lay out.** Give the element room: move actions below a title, stack a row, drop a column.
2. **Shorten the visible label.** The accessible name must still contain it (SC 2.5.3).
3. **Wrap** to a stated line count. Three conditions close this rung, and all three must hold: the text is a
   control or already short, a wrap breaks the layout, and a wrap widens the gulf (a two-line button reads as two
   things).
4. **Truncate**, last, and only where the full text is one step away.

⛔ Never `white-space: nowrap` on a container: it turns a wrap into a horizontal page scroll (SC 1.4.10). The one
permitted `nowrap` is on a short inline link inside a sentence (for example "Sign up"), which cannot cause reflow.
⛔ Never `overflow-wrap: break-word` (Tailwind `break-words`) on a flex item. It lets min-content shrink to one
character, which is the cause of E3. Use `overflow-wrap: anywhere` only on an unbroken user string (URL, email) in a
block that is not a flex item.
**Standing exception:** at 200% text size or iOS accessibility text sizes, `Button` can wrap its label to two
balanced lines. That beats clipping.

### 1.2 Breakpoints

**Viewport classes (the shell only).** The owner set the sidebar breakpoint at 840 (D5). These match Android's
window size classes (compact < 600, medium 600–839, expanded ≥ 840).

| Viewport class | Width      | Web navigation                                                                   | Page gutter |
| -------------- | ---------- | -------------------------------------------------------------------------------- | ----------- |
| `compact`      | < 600 px   | bottom tab bar                                                                   | 16 px       |
| `medium`       | 600–839 px | bottom tab bar                                                                   | 24 px       |
| `expanded`     | ≥ 840 px   | sidebar, 256 px, expanded by default. The user can collapse it to the 80 px rail | 32 px       |

- Emit one new breakpoint in the Tailwind v4 theme (`ui/src/tokens/themeCss.ts`): `--breakpoint-nav: 52.5rem`
  (840). Cover it in `tailwindTheme.integration.test.ts`. The shell
  stops switching at `lg` (`web/src/components/home/chrome/HomeTabBar.tsx`, `lg:hidden`) and switches at `nav`.
- The user's sidebar choice (collapsed or expanded) persists per device. Content keys off `<main>`, so a narrow
  `<main>` at 840 simply takes the `@narrow` or `@regular` layout.
- **Native** never shows a sidebar. Phones and tablets, iPad in both orientations, keep the bottom tab bar (D6 and
  the owner directive of 2026-07-18). The 840 rule is web only.

**Container classes (everything inside `<main>`).** Content responds to `<main>`, never to the viewport. `<main>`
is `container-type: inline-size` with the name `main`. The page gutters are padding on `<main>`. A size query reads
the content box, so the class is the width content actually gets. Native measures the window width minus its
gutters.

| Container class | `<main>` content width | Used for                                            |
| --------------- | ---------------------- | --------------------------------------------------- |
| `@narrow`       | < 600 px               | one column. Actions below titles                    |
| `@regular`      | 600–959 px             | two-up layouts. Header rows on one line             |
| `@wide`         | ≥ 960 px               | side rails (SectionIndex, filter panel), 3+ columns |

What each capture width gets:

| Viewport      | Shell       | `<main>` content width | Class              |
| ------------- | ----------- | ---------------------- | ------------------ |
| 320           | tab bar     | 288                    | `@narrow`          |
| 390           | tab bar     | 358                    | `@narrow`          |
| 768           | tab bar     | 720                    | `@regular`         |
| 1024          | sidebar 256 | 704                    | `@regular`         |
| 1280          | sidebar 256 | 960                    | `@wide`            |
| 1920          | sidebar 256 | 1600, capped at 1440   | `@wide`            |
| native phone  | tab bar     | 358–398                | `@narrow`          |
| native tablet | tab bar     | 696–1318               | `@regular`/`@wide` |

So "960 px and wider" in D2 means `<main>` content width, which a 1280 window reaches.

**Component queries** (the component's own box decides, named where used): detail stat strip 2 × 2 below a 360 px
strip. Detail two columns from a 720 px body. Confirm-dialog buttons stack below a 400 px dialog.

### 1.3 Content widths (new tokens, `ui/src/tokens/scale.ts` → `nativeTokens.layout`)

Emit as `--container-reading`, `--container-list`, `--container-detail`, `--container-wide` (Tailwind v4's
`max-w-*` namespace). All content is **left-aligned to the gutter**. Centring is only for terminal moments (sign-in,
an empty state's inner block, the 404).

| Token             | Value            | For                                                               |
| ----------------- | ---------------- | ----------------------------------------------------------------- |
| `content-reading` | 40 rem (640 px)  | Profile, legal, the 404, collection sheets' body                  |
| `content-list`    | 48 rem (768 px)  | the editor's form column, the add-recipes picker                  |
| `content-detail`  | 72 rem (1152 px) | recipe detail                                                     |
| `content-wide`    | 90 rem (1440 px) | grids: Home, My recipes, Collections, Discover, collection detail |

Prose inside any width is capped at `max-width: 62ch` (reading body) or `65ch` (forms and help text).

### 1.4 Colour roles

The palette stays (`ui/src/tokens/colors.ts`, `palette`). Two primitives are added, and screens use **roles**, never
palette names. Add the roles to `colors.ts` as a new `role` export emitted in `themeCss.ts` and
`nativeTokens.colors`. ⚠️ **Do not repurpose `semantic.secondary` (coral) or `semantic.ring` (seafoam-light)**:
changing what a token means breaks consumers silently. Move consumers onto the new roles, then delete the old
semantic keys once nothing reads them.

| Role (new)     | Value                                                                                      | Used for                                                                       | Contrast (WCAG 2.x, computed 2026-10-08 in the source files)        |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `canvas`       | `sand`, plus the existing beach-glow wash on `body` (issue #145, kept)                     | the page                                                                       | n/a                                                                 |
| `paper`        | `white`                                                                                    | cards, sheets, inputs, menus, sticky bars                                      | n/a                                                                 |
| `ink`          | `charcoal`                                                                                 | all main text and icons                                                        | 12.68:1 on white, 11.78:1 on sand                                   |
| `inkMuted`     | `slate`                                                                                    | secondary text, meta, inactive tabs                                            | 5.24:1 on white, 4.87:1 on sand                                     |
| `lineControl`  | **new primitive `pewter` `#858F93`**                                                       | edges of inputs, unselected chips, checkboxes, secondary buttons               | 3.31:1 on white, 3.07:1 on sand (SC 1.4.11)                         |
| `lineDivider`  | `mist`                                                                                     | dividers only, never a component edge                                          | decorative                                                          |
| `action`       | `seafoam` fill, white label (the existing primary gradient `seafoam` → `ocean-dark` stays) | **the one primary action per view**, the FAB, a checked checkbox               | white on seafoam 4.67:1                                             |
| `actionText`   | `ocean-dark`                                                                               | text buttons, links                                                            | 6.20:1 on white, 5.75:1 on sand                                     |
| `selectedFill` | `seafoam` at 14% over white (`#E2EDEC`)                                                    | selected chip and segment fill                                                 | `actionText` label on it 5.18:1                                     |
| `selectedEdge` | `seafoam`, 1.5 px                                                                          | selected chip edge                                                             | 4.67:1 on white                                                     |
| `hereBar`      | `seafoam`, 3 px                                                                            | "you are here": active tab, active sidebar item, current section, current step | 4.67:1 on white, 4.34:1 on sand                                     |
| `focusRing`    | `ocean-dark`, 2 px, 2 px offset                                                            | every focusable element                                                        | 5.75:1 on sand                                                      |
| `rating`       | **new primitive `honey` `#A86A12`**                                                        | filled stars only. **Never text.** The number beside stars is `ink`.           | 4.43:1 on white (passes 1.4.11, not 1.4.3). Today's amber is 1.88:1 |
| `attention`    | `warning-dark` text, `warning` 20% tint                                                    | "Choose a match", needs-attention states                                       | 5.10:1 on white                                                     |
| `danger`       | `error` fill (confirm button only), `error-dark` text                                      | destructive actions and failures                                               | 4.66:1 / 5.63:1                                                     |
| `brand`        | `coral`, `sky`, `premium`, `success` as **tints only**                                     | covers, illustrations, the PRO badge (`premium` with `ink`, 5.70:1)            | **never a control edge, label or state**                            |

**Coral leaves every control** (owner). Today's coral-outlined secondary is 2.23:1 on sand.

**Difficulty** (kept from `specSharedSystem` §4): Easy `success` 15% tint + `actionText`. Medium `warning` 15% +
`warning-dark`. Hard `coral` 15% + `ink`. Always with the three-dot meter (●○○ ●●○ ●●●), so it never relies on colour
(SC 1.4.1). `error` is never used for difficulty.

**Status** (Draft, Private, Public): `pearl` fill, `ink` text, an icon (pencil-line, lock, globe). Neutral, never
amber.

### 1.5 Type roles (`ui/src/tokens/typography.ts`, native faces in `scale.ts`)

A screen names a role, never a size. The ramp in `scale.ts` (`fontSize`) stays.

| Role           | Face                                                                                     | Size                                                                                                                                         | Weight  | Line height       | Default rule                                                      |
| -------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- | ----------------------------------------------------------------- |
| `largeTitle`   | Playfair Display                                                                         | 28 at `@narrow`, 34 at `@regular`, 40 at `@wide`. Web: bounded `clamp()` in `cqi` (container units, never `vw`). Native: one size per class. | 700     | 1.15              | wrap:2 on top-level pages. wrap:3 on recipe and collection titles |
| `barTitle`     | Inter                                                                                    | 17                                                                                                                                           | 600     | 1.2               | truncate:1                                                        |
| `sectionTitle` | Inter                                                                                    | 18                                                                                                                                           | 600     | 1.25              | wrap:2                                                            |
| `cardTitle`    | Inter                                                                                    | 16                                                                                                                                           | 600     | 1.3               | truncate:2                                                        |
| `body`         | Inter                                                                                    | 16                                                                                                                                           | 400     | 1.5               | wrap                                                              |
| `readingBody`  | Inter                                                                                    | 18                                                                                                                                           | 400     | 1.6, measure 62ch | wrap                                                              |
| `meta`         | Inter                                                                                    | 14                                                                                                                                           | 400/500 | 1.4               | per element                                                       |
| `label`        | Inter                                                                                    | 14                                                                                                                                           | 600     | 1.2               | `room`                                                            |
| `caption`      | Inter                                                                                    | 12                                                                                                                                           | 500     | 1.4               | truncate:1                                                        |
| `overline`     | Inter, uppercase, +0.06em                                                                | 11                                                                                                                                           | 600     | 1.4               | `room`                                                            |
| `figure`       | Inter, `tabular-nums lining-nums` (native `fontVariant: ['tabular-nums','lining-nums']`) | `figure-inline` = the size of its line. `figure-stat` = 20                                                                                   | 600     | as its line       | never wraps                                                       |

- **Playfair sets names only:** the greeting, large titles, the recipe title, a collection name, the monogram cover,
  the wordmark. **It never sets a number.** Every amount, time, count, kcal and serving uses `figure`.
- Inputs never go below 16 px, so iOS Safari does not zoom.
- **Native must register Inter** 400/500/600/700 (`@expo-google-fonts/inter`, a new dependency) in
  `mobile/App.tsx` beside the two Playfair faces, with a `bodyFontFace` map beside `displayFontFace` in `scale.ts`,
  guarded by `nativeFontFace.test.ts`. A native role selects a **face per weight**, never `fontFamily` plus
  `fontWeight` together. That removes one candidate cause of the Android greeting falling back to a system bold
  (`specSharedSystem` §3). The implementer still confirms the cause on device.

### 1.6 Spacing, shape and elevation

**Spacing roles** (the 4 px ramp, `scale.spacing`). Space between groups is always larger than space within them.

| Role              | Value                     | Use                                                           |
| ----------------- | ------------------------- | ------------------------------------------------------------- |
| `gapInline`       | 4                         | icon to its label                                             |
| `gapWithin`       | 8                         | items inside one group                                        |
| `gapGroup`        | 16                        | between groups. Also card padding, both platforms             |
| `gapSection`      | 32                        | between page sections                                         |
| `gapGrid`         | 16 at `@narrow`, 24 above | between grid cards                                            |
| header-to-content | 24                        | under a large title block                                     |
| `gapRow`          | 12 top and bottom         | a tap-to-check row (with a 24 px glyph, a one-line row is 48) |

**Shape rule (owner): only pressable controls are pills.** Every 44 in this file is 48 dp on Android: Button `md`
and `sm` hit areas, chips, row ⋯, the hero discs, the Stepper and the tab items.

| Element                                                                                 | Radius (`radius` token)     | Height                                                |
| --------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| Button, every variant                                                                   | `full`                      | `lg` 52 · `md` 44 · `sm` 36 visual with a 44 hit area |
| Chip (pressable)                                                                        | `full`                      | 36 visual, 44 hit on coarse pointers and native       |
| Search field                                                                            | `full` (the one pill input) | 48                                                    |
| Text input, select, textarea                                                            | `md` (12)                   | 48 for one line                                       |
| Status badge, PRO, cover chips, difficulty badge, detail timer chip (none is pressable) | `sm` (6)                    | 24                                                    |
| Card                                                                                    | `md`                        | content                                               |
| Sheet                                                                                   | `xl`, top corners           | content by default                                    |
| Dialog                                                                                  | `lg`                        | content                                               |

**Surfaces and elevation** (one meaning per level):

| Level | Meaning                                                             | Web                                                                              | iOS             | Android (by level, `tokens/native.ts`)             |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------- | -------------------------------------------------- |
| 0     | canvas                                                              | no shadow                                                                        | none            | 0                                                  |
| 1     | a card                                                              | `paper`, 1 px `lineDivider`, `shadow-sm`                                         | same            | 1                                                  |
| 2     | sticky bar (tab bar, action bar, condensed title bar, section bars) | `paper` at 92% + `backdrop-filter: blur(12px)`, hairline inner edge, `shadow-md` | system material | solid `paper`, elevation 2 (Material uses no blur) |
| 3     | overlay (menu, sheet, dialog, snackbar, FAB)                        | `paper`, `shadow-lg`, scrim `ink` 40% for modal ones                             | same            | 3                                                  |

- **Android elevation by level**, not by shadow offset: `sm` 1, `md` 2, `lg` 3, `xl` 6, `glow` 0 (`tokens/native.ts`
  today sets `elevation: spec.offsetY`). Wide blast radius on purpose: re-shoot the Pixel captures after it lands.
- **No box in a box.** The glass H1 card on Recipes, the greeting card on Home, and the title and description cards
  on detail are deleted. A card exists only to group.
- Name surfaces `surface0`-`surface3` so dark mode can map them later. Dark mode itself is out of scope.

### 1.7 Icons

- **Lucide on both platforms:** `lucide-react` (web) and `lucide-react-native` with `react-native-svg` (native). All
  three are new dependencies (§12). Native's Feather glyphs (`@expo/vector-icons`) and web's hand-drawn SVGs
  (`web/src/components/home/chrome/icons.tsx`, `features/recipes/src/actions/icons.tsx`) go.
- 24 px grid, Lucide's default 2 px stroke, round caps. 20 px inline beside 14–16 px text. 24 px for icon buttons.
- **Outline by default.** Filled only on the active tab, always with the label weight and the `hereBar`, never alone.
- **One glyph list.** No screen picks its own glyph.

| Meaning                              | Lucide name       | Meaning                | Lucide name      |
| ------------------------------------ | ----------------- | ---------------------- | ---------------- |
| Home                                 | `house`           | time                   | `clock`          |
| Recipes                              | `book-open`       | serves                 | `users`          |
| Discover                             | `compass`         | kcal                   | `flame`          |
| new                                  | `plus`            | rating                 | `star`           |
| paste                                | `clipboard-paste` | visibility             | `lock` / `globe` |
| **every** "more" menu (⋮ is retired) | `ellipsis` (⋯)    | draft, edit            | `pencil-line`    |
| back (mirrors in RTL)                | `chevron-left`    | step timer (no mirror) | `timer`          |
| close                                | `x`               | screen on              | `sun`            |
| search                               | `search`          | check                  | `check`          |
| save a copy                          | `copy-plus`       | back to top            | `arrow-up`       |
| delete                               | `trash-2`         | add photo              | `image-plus`     |
| paste steps                          | `list-plus`       | add a timer            | `timer`          |

### 1.8 Imagery: `RecipeCover` and photos

**`RecipeCover`** (new, `ui/src/recipeCover/RecipeCover.tsx` + `.native.tsx`, export `./recipe-cover`). With a photo, it
renders the photo. With no photo, it renders a **monogram cover**:

- ground: one of six tints chosen by `hash(recipeId) % 6`, never by cuisine:

| Tint (on white) | Hex       | `ink` on it |
| --------------- | --------- | ----------- |
| `seafoam` 12%   | `#E6F0EF` | 10.91:1     |
| `coral` 20%     | `#FAE9E4` | 10.77:1     |
| `sky` 28%       | `#DFF0F8` | 10.84:1     |
| `premium` 22%   | `#F6EBE0` | 10.80:1     |
| `success` 16%   | `#E2F2EA` | 10.94:1     |
| `warning` 20%   | `#FDEFD9` | 11.19:1     |

- the title's first letter, Playfair 700, `ink`, 40% of the cover height, centred.
- the cuisine in `overline`, `ink`, under the letter. No cuisine, or a cover under 96 px: no overline.
- the caller's aspect ratio (4:3 cards, 1:1 thumbs, the 96 px band on the phone detail hero).
- `aria-hidden`, because the title is the link's name. `inkMuted` is never used on a tint (4.46–4.63:1).

**Photos:** every image slot declares its aspect ratio (no layout shift). `object-position: center 40%`. Text never
sits on a photo except on **solid** chips or discs: cover chips are `paper` at 92% with `ink` (≥ 10.6:1 over pure
black). Back and ⋯ on the hero are 44 px `paper` discs at 90%.

**Illustrations** (empty states, 404): one line style, 2 px stroke, `seafoam` and `ink`, one `coral` accent, 96 px.
Four drawings only: empty recipe box, stacked cards, empty plate, magnifier over a bowl.

### 1.9 Motion

| Moment                                      | Web                                                            | Native (Reanimated `withSpring`)              | Reduced motion                |
| ------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- | ----------------------------- |
| Press                                       | 100 ms scale 0.98 (`pressScale`, exists)                       | stiffness 400, damping ratio 1.0              | opacity 0.85                  |
| Sheet in / out                              | 240 ms ease-out / 200 ms ease-in                               | stiffness 400, damping 40, mass 1 (ratio 1.0) | 150 ms fade                   |
| Row editor opens inline                     | 150 ms height + opacity                                        | stiffness 500, damping 45                     | instant                       |
| **Check toggle (the one signature motion)** | 120 ms scale 0.9 → 1 with a small overshoot on the check glyph | stiffness 600, damping 28 (ratio ≈ 0.57)      | instant, no scale             |
| Large title condenses                       | scroll-linked, no timer                                        | scroll-linked                                 | instant swap at the threshold |
| FAB shrink / grow                           | 150 ms width                                                   | stiffness 500, damping 45                     | instant                       |
| Undo snackbar                               | 200 ms in (rise 8 px), 150 ms out                              | stiffness 400, damping 40                     | fade, no rise                 |
| SectionIndex / SectionSwitch jump           | `behavior: 'smooth'`                                           | animated `scrollTo`                           | instant (owner, D2)           |
| Skeleton → content                          | 150 ms cross-fade                                              | same                                          | instant                       |

Nothing else animates. Skeletons never pulse after 1 s: a still shape reads as "waiting".

### 1.10 One state matrix for every control

| State                     | Primary button                                      | Secondary button                         | Ghost button                | Chip (filter / choice)                                                                  | Tab, segment, nav item                   | List row                    |
| ------------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| default                   | `action` fill, white label                          | `paper`, `lineControl` edge, `ink` label | `actionText` label, no fill | `paper`, `lineControl` edge, `ink` label                                                | `inkMuted` label, outline glyph          | `paper`                     |
| hover (fine pointer only) | `ocean-dark` fill                                   | `pearl` fill                             | `pearl` fill                | `pearl` fill                                                                            | `ink` label                              | `pearl` fill                |
| pressed                   | scale 0.98, `ocean-dark`                            | `pearl`                                  | `pearl`                     | `pearl`                                                                                 | n/a                                      | `pearl`                     |
| selected                  | n/a                                                 | n/a                                      | n/a                         | `selectedFill`, 1.5 px `selectedEdge`, `actionText` label, 16 px check before the label | `ink` label 600, filled glyph, `hereBar` | `hereBar` at the start edge |
| focus-visible             | `focusRing`                                         | same                                     | same                        | same                                                                                    | same                                     | same, drawn inside          |
| disabled                  | 40% opacity                                         | same                                     | same                        | same                                                                                    | same                                     | same                        |
| busy                      | spinner replaces the icon, label stays, `aria-busy` | same                                     | same                        | n/a                                                                                     | n/a                                      | n/a                         |

Selection never relies on colour alone: chips have the check. Tabs have weight, fill and the bar.

### 1.11 Primitives: add or change (all in `packages/apps/commise/ui/src`)

File and folder names are camelCase. Export keys stay kebab-case like today's (`./action-menu`).

| Primitive           | Path (export)                                                                     | Status                                  | Contract and rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`            | `button/` (`./button`)                                                            | CHANGE                                  | Variants `primary` · `secondary` (neutral, §1.10) · `ghost` (new) · `destructive` (`danger` text, and a **filled** `error` surface only inside a confirm dialog, through `tone: 'confirm'`). `size: 'lg' \| 'md' \| 'sm'` (new). `width: 'fill'` exists. **`icon` stays required for `primary`, `secondary` and `destructive`. It is optional for `ghost`** (make the prop type a discriminated union on `variant`). Rewrite the `surfaceClass.ts` secondary docblock and its test pin to `glass.subtle`: the owner overruled coral. Focus ring moves to `focusRing`. Adopt everywhere: the 29 hand-built buttons in 27 files (E30) move onto it.                                                                                                                                                                                                                        |
| `Chip`, `ChipRow`   | `chip/` (`./chip`)                                                                | NEW                                     | `kind: 'filter' \| 'choice' \| 'input'`. `input` is a removable value (applied filters, an entered tag): a `button` named "Remove {label}" with a trailing `x`, no `aria-pressed`. (No `tag` kind: a non-pressable tag is text, by the shape rule.) `label` ≤ 24 visible characters, longer truncates with the full text in the name. `selected`, `count?` (in `figure-inline`, `inkMuted`), `onPress`. `ChipRow`: `label` (group name), `overflow: 'scroll' \| 'wrap'`. Scroll: one line, `overflow-x: auto` inside the row, `scroll-snap-type: x proximity`, 16 px trailing padding, a 24 px fade at the trailing edge while more exists. Wrap: at most 2 lines (3 in a form). Semantics: filter = `button` with `aria-pressed`. Choice = `radiogroup` of `radio`, arrow keys move. Native `accessibilityRole` `checkbox` / `radio` with `accessibilityState.checked`. |
| `SegmentedControl`  | `segmentedControl/` (`./segmented-control`)                                       | NEW                                     | 2–3 views of one thing. `pearl` track, selected segment `paper` with `shadow-sm` and `ink` 600 label. 44 px tall. Two forms. Route segments (My recipes · Collections) are a `nav` with `aria-current="page"`. A view switch (list or grid) is a `radiogroup`. Segments are `room`. At 320 two segments get 136 px each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SearchField`       | `searchField/` (`./search-field`)                                                 | NEW                                     | 48 px pill, 1 px `lineControl`, `paper`. Leading 20 px `search` glyph (`inkMuted`, hidden). A non-empty field shows a trailing clear `x` (44 × 44, name "Clear search"). It returns focus to the input. `label` required (visually hidden allowed, never placeholder-only). Web `type="search"`, `enterKeyHint="search"`, `autocomplete="off"`. Native `returnKeyType="search"`, `clearButtonMode="never"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Input`, `TextArea` | `input/`, `textInput/`                                                            | CHANGE                                  | 12 px radius, 1 px `lineControl`, 48 px, `body` 16, padding 16. Native `Input.native.tsx` adopts it. `formSectionStyles.native.ts` raw sizes go (N1). Auto-growing textarea variant with `minRows` / `maxRows`. Error: `danger` border + message under it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `FieldLabel`        | `input/FieldLabel.tsx` (+ `.native`)                                              | NEW                                     | Visible label above every field, `label` role, `inkMuted`. Optional `hint` in `caption`. Owns `htmlFor` / `aria-labelledby`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `DurationField`     | `input/DurationField.tsx` (+ `.native`)                                           | NEW                                     | `h` and `min` number fields under one `FieldLabel`. Value in seconds. Empty = absent. Never shows "0".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Stepper`           | `input/Stepper.tsx` (+ `.native`)                                                 | NEW                                     | `[−] value [+]`, buttons 44 px web/iOS, 48 dp Android, value in `figure`. `min` 1. Announces the new value politely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `StatusBadge`       | `statusBadge/`                                                                    | CHANGE                                  | Radius `sm` (not a pill: it is not pressable). Neutral tone + icon per §1.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `UndoSnackbar`      | `undoSnackbar/` (`./undo-snackbar`)                                               | NEW                                     | `message`, `actionLabel`, `onAction`, `onTimeout`, `durationMs` default 6000, paused on hover or focus (SC 2.2.1). `ink` fill, white text (12.68:1), action in `seafoam-light` (4.56:1 on ink), 44 px hit. Bottom centre, 16 px above the tab bar or window foot, max 36 rem. One at a time. A new one commits the old. `role="status"`. Never steals focus. Message wrap:2, action `room`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RecipeCover`       | `recipeCover/` (`./recipe-cover`)                                                 | NEW                                     | §1.8. Props: `photoUrl?`, `recipeId`, `title`, `cuisine?`, `aspect: '4:3' \| '1:1' \| 'band'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ActionMenu`        | `actionMenu/`                                                                     | CHANGE                                  | Trigger is always ⋯ (`ellipsis`). Web: anchored to the trigger. With no room below, it flips above. It never sits under the tab bar (fixes D2). Native: the titled sheet (exists). Destructive item last, after a divider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ConfirmDialog`     | `confirmDialog/`                                                                  | CHANGE                                  | Verb buttons only ("Delete recipe" / "Keep recipe"). Focus opens on the non-destructive button. Buttons stack full width below a 400 px dialog, destructive on top.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `LargeTitleHeader`  | `layout/LargeTitleHeader.tsx` (+ `.native`) (`./layout`)                          | NEW (replaces the audit's `PageHeader`) | §3.3. Props: `title`, `subtitle?`, `back?: { label, onPress }`, `action?` (at most one button plus one ⋯), `segments?` (a `SegmentedControl`, sticky at the top edge), `headingRef`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ActionBar`         | `layout/ActionBar.tsx` (+ `.native`), composes `pinnedFooter` / `usePinnedFooter` | NEW                                     | Sticky bottom bar, level 2, safe-area aware. ≤ 1 primary, ≤ 1 secondary, ≤ 1 icon button. Follows `compactHeightLayout.md` A1: unpins past half the frame and while the keyboard is open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CreateFab`         | `createFab/` (`./create-fab`)                                                     | NEW                                     | §3.4. Props: `label`, `icon`, `onPress`, `collapsed` (derived from scroll), `hidden`. It owns five rules: the shrink to icon on scroll, icon only for a label over 50% of the window, the bottom padding it reserves in the list, hiding while the keyboard is open, and the RTL corner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `BackToTop`         | `backToTop/` (`./back-to-top`, web only)                                          | NEW                                     | §3.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SectionIndex`      | `sectionIndex/` (`./section-index`)                                               | NEW                                     | §7.2. One component, three presentations by width.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SectionSwitch`     | `sectionSwitch/` (`./section-switch`)                                             | NEW                                     | §6.2. Sticky jump bar for reading pages, with an optional trailing toggle slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `KeepAwakeToggle`   | `keepAwake/` (`./keep-awake`)                                                     | NEW                                     | §6.3. Web Screen Wake Lock, native `expo-keep-awake`. No API, no toggle: it is never shown disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Sheet`             | `sheet/`                                                                          | KEEP                                    | `size="content"` for short tasks (`sheet/props.ts`). It already handles `visualViewport` and `KeyboardAvoider`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `formatDuration`    | `packages/shared/recipe-core/src/duration.ts`                                     | NEW (pure)                              | Rounds to the minute. < 60 min → `{minutes} min`. Whole hours → `{hours} h`. Else `{hours} h {minutes} min`. 0 or absent → `undefined` (the caller shows nothing). Use `Intl.DurationFormat` where the runtime has it (check Hermes), with the message keys as fallback. `style: 'long'` (default) as above. `style: 'short'` gives "5 h 30" for mixed values (the minutes unit dropped) and is used only in cover time chips and row meta, where width is tight. Keys: `duration.minutes`, `.hours`, `.hoursMinutes`, `.hoursMinutesShort` "{hours} h {minutes}".                                                                                                                                                                                                                                                                                                       |

Also in `features/recipes/src/card` (shared feature code, not `ui`): `RecipeCard` with `grid`, `row` and `compact`
variants (§4.1).

---

## 2. Words and localisation

### 2.1 Glossary (one word per idea, en-US base locale)

Nothing is live, so each term is cheap to set now. Each one becomes a one-way door as soon as people learn it.

| Use                                                                     | Never                                         |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| My recipes, Recipes                                                     | Library, My Recipes (title case)              |
| Collection                                                              | list, folder, cookbook                        |
| Discover                                                                | Community, Discover recipes, explore          |
| Save a copy (action), Copied from @handle (attribution)                 | Clone, Clone collection, fork                 |
| Steps (section), Step (one item)                                        | Instructions, Method, directions              |
| Draft, Public, Private                                                  | Unpublished, Shared                           |
| Choose a match, No match found, Couldn't look up, Food no longer listed | Needs a pick, Not resolved, Resolution failed |
| New recipe, New collection                                              | Create from scratch, Add Recipe               |
| Photos & publish                                                        | Photos & review, Review                       |

### 2.2 Copy rules

- Sentence case everywhere: "My recipes", "Danger zone", "Today's nutrition".
- No "..." in a placeholder. A placeholder is an example, never a label.
- Every string goes through a message object. The existing ones are `features/recipes/src/messages.ts`
  (`recipeMessages`), `form/messages.ts`, `collections/messages.ts`, `discovery/messages.ts`, `actions/messages.ts`,
  `versions/messages.ts`, `web/src/i18n/messages.ts` (`webMessages`) and `mobile/src/i18n/messages.ts`
  (`mobileMessages`). Shell keys go into **both** app message objects with the same path (CODING_STANDARDS §14).
- `wizard/messages.ts` retires with the wizard. Its surviving strings move to a new `features/recipes/src/editor/messages.ts`
  (`editorMessages`). `parse/messages.ts` retires with the `/parse` pages. Its surviving strings move to `form/messages.ts`.
- Counts use ICU plurals (`formatPlural`, exists). Large numbers use `Intl.NumberFormat`.
- In this file, a key marked **NEW** does not exist yet. The named module owns it. Keys not marked NEW were found in the
  repo by grep.
- Every layout here was checked at +35% string length. In RTL, `chevron-left` and the FAB corner mirror. The timer
  glyph, the clock and numerals do not.

### 2.3 Keys for strings not keyed in their own sections

All NEW unless marked. Shell keys live in both `webMessages` and `mobileMessages`.

| Key                                                                                                                            | String                                                                                           | Where                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `shell.tabs.home` / `.recipes` / `.discover`                                                                                   | Home / Recipes / Discover                                                                        | tab bar, sidebar                              |
| `shell.newRecipe` / `shell.newCollection`                                                                                      | New recipe / New collection                                                                      | FAB, sidebar                                  |
| `shell.collapse` / `shell.expand`                                                                                              | Collapse / Expand sidebar                                                                        | sidebar foot                                  |
| `shell.backTo`                                                                                                                 | Back to {parent}                                                                                 | every back control                            |
| `shell.backToTop`                                                                                                              | Back to top                                                                                      | §3.6                                          |
| `shell.profileButton` / `.profileButtonNoName`                                                                                 | Profile, {name} / Profile                                                                        | avatar                                        |
| `list.tabCollections` (`features/recipes/src/messages.ts`)                                                                     | Collections                                                                                      | segments. `tabMine` (existing) → "My recipes" |
| `list.viewList` / `list.viewGrid`                                                                                              | List view / Grid view                                                                            | view switch                                   |
| `list.clearSearch` / `list.clearFilters`                                                                                       | Clear search / Clear filters                                                                     | no-match states                               |
| `discovery.filters` / `.filtersActive`                                                                                         | Filters / Filters, {count} active                                                                | Discover                                      |
| `discovery.clearAll`                                                                                                           | Clear all                                                                                        | Discover                                      |
| `discovery.removeFilter`                                                                                                       | Remove {filter} filter                                                                           | applied chips                                 |
| `discovery.sortLabel`                                                                                                          | Sort: {choice}                                                                                   | Discover                                      |
| `discovery.sort.relevance` / `.newest` / `.mostSaved` / `.quickest`                                                            | Relevance / Newest / Most saved / Quickest                                                       | sort menu                                     |
| `filters.totalTime` / `.moreTime` / `.prepTime` / `.cookTime`                                                                  | Total time / More time filters / Prep time / Cook time                                           | filter groups                                 |
| `filters.any` / `.under15` / `.under30` / `.under60`                                                                           | Any / Under 15 min / Under 30 min / Under 60 min                                                 | time choices                                  |
| `filters.dietary` / `.cuisine` / `.tags` / `.hasIngredient` / `.showAll`                                                       | Dietary / Cuisine / Tags / Has ingredient / Show all ({n})                                       | filter groups                                 |
| `filters.showResults`                                                                                                          | Show {count, plural, one {# recipe} other {# recipes}}                                           | sheet primary                                 |
| `discovery.browseByCuisine`                                                                                                    | Browse by cuisine                                                                                | Discover                                      |
| `discovery.previous` / `.next`                                                                                                 | Previous / Next                                                                                  | rail buttons                                  |
| `collections.menu.rename` / `.makePrivate` (existing `makePrivate`) / `.makePublic` / `.saveCopy` / `.pullUpdates` / `.delete` | Rename / Make private / Make public / Save a copy / Pull updates / Delete collection             | collection ⋯                                  |
| `collections.member.open` / `.remove` / `.removed`                                                                             | Open recipe / Remove from collection / Removed {recipe} from {collection}.                       | member ⋯, snackbar                            |
| `collections.visibilityChanged`                                                                                                | Collection is now {visibility}.                                                                  | snackbar                                      |
| `collections.delete.title` / `.body` / `.confirm` / `.keep`                                                                    | Delete {name}? / The {count} recipes stay in your library. / Delete collection / Keep collection | dialog                                        |
| `picker.title` / `picker.added` / `picker.removed` / `picker.failed`                                                           | Add to {collection} / Added {title} / Removed {title} / Couldn't add {title}. Try again.         | picker                                        |
| `actions.menu.versionHistory` / `.makePrivate` / `.makePublic` / `.clearChecks` / `.delete`                                    | Version history / Make private / Make public / Clear checks / Delete recipe                      | detail ⋯                                      |
| `detail.moreActions`                                                                                                           | More actions for {title}                                                                         | detail ⋯ name                                 |
| `detail.ingredientsFor` / `detail.steps` / `detail.nutrition`                                                                  | Ingredients for {n} / Steps / Nutrition                                                          | detail headings                               |
| `detail.sections`                                                                                                              | Recipe sections                                                                                  | `SectionSwitch` name                          |
| `detail.markCurrentStep`                                                                                                       | Mark step {n} as current                                                                         | current-step toggle                           |
| `detail.rateThis` / `detail.cannotRateOwn`                                                                                     | Rate this recipe / You can't rate your own recipe.                                               | rating                                        |
| `detail.more` / `detail.less`                                                                                                  | More / Less                                                                                      | description clamp                             |
| `versions.compare` / `.preview` / `.restore` / `.restored` / `.undo`                                                           | Compare with current / Preview / Restore this version / Restored version {n}. / Undo             | version history                               |
| `boundary.crash.*`                                                                                                             | §3.8                                                                                             | crash page                                    |

---

## 3. Navigation shell

### 3.1 Destinations

The tabs are Home, Recipes and Discover (owner). Profile opens from the avatar. Meal Plan and Shopping become tabs 4
and 5 when they ship, labelled "Plan" and "Shop". Nutrition sits inside Plan, never as a sixth tab. No navigation shows
an unbuilt destination, a "Soon" item, a bell or a search button.

| Destination       | Holds                                             | Web URL (`/{locale}`…)     | Native root                                   |
| ----------------- | ------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Home              | greeting, recent recipes, the FR-046 placeholders | `/`                        | `home` stack                                  |
| Recipes           | two segments: My recipes · Collections            | `/recipes`, `/collections` | `recipes` stack                               |
| Discover          | the public catalogue: search, filters, rails      | `/discover`                | `discover` stack                              |
| Profile (utility) | profile, preferences, session, danger zone        | `/profile`                 | pushed onto the current stack from the avatar |

**Pushed screens:** recipe detail `/recipes/{id}`, version history `/recipes/{id}/versions`, collection detail
`/collections/{id}`, legal sources `/legal/sources`.
**Focused tasks** (no tab bar): the editor `/recipes/new` and `/recipes/{id}/edit`, the add-recipes picker, the
collection sheets, the cook view later.
**Deleted routes** (no redirects, nothing is live): `/settings`, `/account`, `/recipes/parse`, `/recipes/parse/{jobId}`,
`/collections/new`, `/collections/{id}/rename`, `/collections/{id}/add`. The last three become sheets over their
parent screen.

### 3.2 Web shell by viewport

```
compact / medium (< 840)                         expanded, collapsed by the user  expanded (≥ 840, default)
┌──────────────────────────────────┐            ┌────┬─────────────────────┐      ┌ sidebar 256 ─┬ main ──────────┐
│ (no top bar)                     │            │ ⊕  │ Recipes        H1   │      │ Commise      │ Recipes   H1   │
│ Recipes                     (E)  │ H1+avatar  │ ⌂  │ …                   │      │[+ New recipe]│ …              │
│ …content…                        │            │ ▤▌ │                     │      │ ⌂ Home       │                │
│                         (+ New…) │ FAB        │ ◎  │                     │      │ ▤ Recipes  ▌ │                │
├──────────────────────────────────┤            │ ── │                     │      │ ◎ Discover   │                │
│ ⌂ Home    ▤ Recipes   ◎ Discover │ 64+safe    │ (E)│                     │      │ ──────────── │                │
└──────────────────────────────────┘            │ »  │                     │      │ (E) Eliza M. │                │
                                                └────┴─────────────────────┘      │ « Collapse   │                │
                                                                                   └──────────────┴────────────────┘
```

**Bottom tab bar** (web below 840, native always). Files: `web/src/components/home/chrome/HomeTabBar.tsx`,
`mobile/src/components/home/chrome/HomeTabBar.tsx`.

- 64 px plus the safe-area inset. Level 2 surface (§1.6). Three items, each at least 96 × 56 at 320.
- Item: 24 px glyph over a 12 px `caption` label at weight 500. Labels are `room`. They never wrap and never truncate.
  "Discover" is the longest English label. At +35% it still fits in 96 px.
- Active: filled glyph in `ink`, label in `ink` at 600, and a 32 × 3 px `hereBar` above the glyph. Inactive: outline
  glyph and label in `inkMuted`. `aria-current="page"` on web, `accessibilityState.selected` on native.
- Targets: 48 dp on Android, 44 pt on iOS and web.
- **Second tap on the active tab:** on a pushed screen it pops to the tab's root. At the root it scrolls to the top.
  This works the same on web and native (§3.6).
- `<main>` reserves the bar's height plus 16 px at its foot, and sets `scroll-padding-bottom` to the same value
  (SC 2.4.11).

**Sidebar** (web at 840 and wider). File: `web/src/components/home/chrome/HomeSidebar.tsx`.

- Sticky, full height (`position: sticky; top: 0; height: 100dvh`), so it never scrolls away (E16). The list scrolls
  inside it if it is ever taller than the window.
- Width 256 expanded (the default), 80 collapsed. The user's choice persists per device.
- Order, top to bottom:
    1. Wordmark, 64 px.
    2. **New recipe** (§3.4): a full-width `Button variant="primary" size="md"` with the `plus` glyph. Collapsed: a 56
       px round icon button named "New recipe", with a tooltip on hover and on focus. The tooltip can be dismissed with
       Escape and stays while hovered (SC 1.4.13).
    3. Home, Recipes, Discover: 44 px rows, 24 px glyph, `label` text. Active: a `seafoam` 10% fill,
       `ink` label at 600, a 3 px `hereBar` on the start edge, `aria-current="page"`.
    4. A divider (`lineDivider`), then the **profile row**: 32 px avatar, display name (`truncate:1`), linking to
       `/profile`. Collapsed: the avatar alone, named "Profile, {name}".
    5. The collapse control on the foot, a 44 px row: `chevrons-left` plus "Collapse". Collapsed: the glyph alone,
       named "Expand sidebar". `aria-expanded` reflects the state (E34).
- There is **no top bar** at 840 and wider. The page's large title is the H1 at the top of `<main>`.
- The hamburger drawer (`HomeMobileNav.tsx`) is deleted. The top-bar bell and search buttons are deleted (E13).

### 3.3 `LargeTitleHeader` (every screen with a title)

```
phone, top of page               phone, scrolled (pushed screen only)      840+ (no bar ever)
┌─────────────────────────┐      ┌──────────────────────────────┐          ‹ Collections            (eyebrow link)
│ (‹)                 (⋯) │ 44   │ ‹  Weeknight Dinners…    ⋯  │ 56       Weeknight Dinners the Whole  [+ Add recipes] [⋯]
│ Weeknight Dinners the   │ H1   ├──────────────────────────────┤          Family Will Actually Eat
│ Whole Family Will…      │      │ …content…                    │
```

- **Phone and tablet (web below 840, native every size):** a transparent 44 px row holds `back` (start) and `action`
  (end). The H1 sits under it in `largeTitle`.
    - **Top-level pages on web** (Home, Recipes, Discover): the title and the avatar scroll away with the content.
      No bar appears. The tab bar already says where you are.
    - **Pushed screens on web, and every screen on native:** once the H1 scrolls under the 44 px row, the row turns
      into a 56 px level-2 bar showing the title in `barTitle`, `truncate:1`. Back stays one tap away (Nielsen #3).
      This is the iOS large-title and Material collapsing-bar idiom.
    - `segments` (My recipes · Collections) stick under the bar while the list scrolls.
- **840 and wider:** no bar. The H1 sits at the top of `<main>`. `action` sits on the same row at the end edge,
  aligned to the title's first baseline. `back` becomes an eyebrow link above the H1: "‹ {Parent}". The title block is
  `flex: 1 1 18rem; min-width: 0`. The action is `flex: 0 0 auto`. Without room, the row moves the action **as a
  group** below the title (re-layout, never a wrap inside a button).
- **Top-level `action`** is the avatar (32 px disc in a 44 × 44 target, initials in `label` on `action` fill, 4.67:1).
  It loads as a `pearl` disc. With no name it shows a 20 px `user` glyph, on both platforms (native's `'·'` at
  `mobile/src/components/home/chrome/HomeTopBar.tsx:85` goes, M8). Name: "Profile, {name}" or "Profile" (NEW
  `shell.profileButton` / `shell.profileButtonNoName`).
- **Collapse mechanism:** web uses an `IntersectionObserver` on the H1. Native uses `onScroll` with
  `scrollEventThrottle={16}` and the H1's `onLayout` height. No scroll listeners on web.
- **Accessibility:** the H1 is the only level-1 heading and the route-change focus target (`headingRef`). The bar
  title is `aria-hidden` because it repeats the H1. The document title is "{page} · Commise".
- File: `ui/src/layout/LargeTitleHeader.tsx` and `.native.tsx`. It replaces every hand-built page header, including
  the glass H1 card at `RecipeListFrame.tsx` and the squeezed `CollectionHeader.tsx`.

### 3.4 Create entry (D4)

| Surface                                    | Where                                                                                              | Form                                                                                                                                                     | A tap or click does    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Phone (web < 600, iPhone, Android compact) | floating, bottom trailing corner, 16 px from the side, 16 px above the tab bar, plus the safe area | `CreateFab`, 56 tall, `plus` + "New recipe". It shrinks to a 56 px icon button while scrolling down and grows back on scroll up, at the top, or on focus | opens the empty editor |
| Tablet (web 600–839, iPad, Android tablet) | the same corner, 24 px in from the side edge                                                       | always extended                                                                                                                                          | opens the empty editor |
| Web 840 and wider                          | first item in the sidebar (§3.2), on **every** screen                                              | primary button                                                                                                                                           | opens the empty editor |

**Where the floating button shows (phone and tablet):**

| Screen                                                | Floating button                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Home                                                  | "New recipe"                                                                                                   |
| Recipes › My recipes                                  | "New recipe"                                                                                                   |
| Recipes › Collections                                 | **"New collection"**, which opens the new-collection sheet (§5.1). The label and name change with the segment. |
| Discover, recipe detail, editor, Profile, every sheet | none                                                                                                           |
| Home or My recipes while their first-run state shows  | none. The empty state's own start buttons take its place.                                                      |
| Any screen while the on-screen keyboard is open       | hidden                                                                                                         |

**At 840 and wider** there is no floating button. Collections gets a **New collection** secondary button
(`plus`) as its header `action` (§5.1). The sidebar keeps "New recipe". The two are never shown for the same job.

**Rules the primitive owns** (`ui/src/createFab/`):

- **DOM order:** right after the page H1, not at the end of the list, so a screen reader meets it early. It is
  positioned visually at the bottom. Native sets the same accessibility order (SC 1.3.2, 2.4.3).
- **Name:** always the label, "New recipe" or "New collection", including in the icon-only form (SC 2.5.3). Never
  "plus" or "add".
- **Label overflow:** if the label is wider than 50% of the window (a long translation, 200% text, iOS accessibility
  sizes), the button stays icon-only and keeps its name. The label never wraps or truncates.
- **Padding:** the list it floats over gets bottom padding of button height + 32. `scroll-padding-bottom` matches, so
  a focused last card is never hidden (SC 2.4.11).
- **Contrast:** solid `action` fill at level 3. It never becomes see-through over a photo (SC 1.4.11).
- **Motion:** between two screens that both show "New recipe" it does not animate. Otherwise it fades out and in.
  Reduced motion swaps it at once.
- **RTL:** the trailing corner is bottom-left.

**Methods today and later:**

- **Today (two methods: write, paste ingredients):** one tap opens the empty editor. Focus goes to the title field on
  web at 840 and wider. On phones nothing is focused, so the keyboard does not cover the section index. Paste lives in
  the Ingredients section (§7.5.4). No chooser and no menu.
- **After link or photo import ships:** the same control opens a chooser, a `role="dialog"` titled "Add a recipe"
  (a bottom sheet on phones, an anchored dialog on tablets and wide web). It leads with one paste box ("Paste a link or
  text", hint "A recipe link, a video link, or an ingredient list"), then "From a photo or screenshot" (when that
  ships), then "Start from scratch", always last. Never more than three choices, never a greyed "coming soon" row. The
  trigger then gets `aria-haspopup="dialog"` and `aria-expanded`. That chooser gets its own SPECIFY pass when import
  is scheduled. It is out of scope here.

### 3.5 Back and dismissal

| Level           | Examples                                                   | Phone back (web and native)                                                                                                                                    | Web 840+             | Android system Back                                              | iOS                               |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- | --------------------------------- |
| 1, destination  | Home, Recipes, Discover                                    | none                                                                                                                                                           | none                 | from Recipes or Discover: to Home. From Home: leave the app      | n/a                               |
| 2, segment      | My recipes, Collections                                    | none. Segments are routes, so browser Back works                                                                                                               | none                 | as level 1                                                       | n/a                               |
| 3, pushed       | recipe detail, collection detail, versions, Profile, legal | 44 px ‹ named "Back to {parent}"                                                                                                                               | "‹ {Parent}" eyebrow | pops the stack                                                   | header ‹ **and edge swipe**       |
| 4, focused task | editor, picker, collection sheets                          | × in the task's header. The editor and the picker leave at once, because nothing is ever unsaved (§7.3, §5.3). A collection sheet with a typed name asks first | the same             | the same as ×. A guarded sheet uses `@commise/ui/back-intercept` | the edge swipe does the same as × |

### 3.6 Back to top (D3)

- **Editor:** none. The section index does that job (§7.2).
- **Native:** no button. A second tap on the active tab scrolls to the top (§3.2). On iOS the status-bar tap does
  too. Only one scroll view per screen keeps `scrollsToTop`. Every inner scroll view (rails, chip rows, the section
  strip, sheets) sets `scrollsToTop={false}`, or the gesture silently stops working.
- **Web, long lists only** (My recipes, Discover results, collection detail members): `BackToTop` (`ui/src/backToTop/`).
    - It appears once the page is taller than 4 viewports, the reader is more than 4 viewports down, **and** the last
      scroll was upward (NN/g, "Back-to-Top Button Design Guidelines", 2017). It never moves once shown.
    - `Button variant="secondary" size="sm"`, `arrow-up` glyph, label "Back to top" (NEW `shell.backToTop`). Bottom
      trailing, 16 px in. Where a FAB shows, it sits 16 px above the FAB. Hidden while the keyboard is open.
    - Press: scroll to the top (instant under reduced motion) and move focus to the page H1 (SC 2.4.3).
    - Last in DOM order. `scroll-padding-bottom` counts its height too (SC 2.4.11).

### 3.7 Native structure

- `AppRoot` (`mobile/src/screens/AppRoot.tsx`, a `useState` destination union today) owns the tab bar and **one stack
  per tab** (home, recipes, discover). Switching tabs keeps each stack. Profile is pushed onto the current stack.
- The tab bar shows on every level-1, 2 and 3 screen, including recipe and collection detail. It hides only for
  focused tasks.
- iOS edge swipe pops a pushed screen. On a focused task it does what × does (§3.5).
- `RecipesScreen` (`mobile/src/screens/RecipesScreen.tsx`) loses its own top tabs. "Discover" leaves it and becomes
  a root. `AccountSettings.tsx` stops being a destination and becomes the Profile page's sections.
- The mechanism is the architect's (§12).

### 3.8 Shell states

| State           | Behaviour                                                                                                                                                                                                                                                            | Copy                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Profile loading | the avatar is a `pearl` disc. Nothing else waits for it                                                                                                                                                                                                              | none                                                                             |
| Profile failed  | the avatar shows the `user` glyph. The chrome shows no error. Profile reports it (§9.1)                                                                                                                                                                              | none                                                                             |
| Offline         | the existing `@commise/ui/offline-notice` strip, unchanged: under the 44 px row below 840, sticky at the top of `<main>` at 840+. Announced once, politely. Screens never change their behaviour for being offline (owner). Writes go through the offline write port | existing key                                                                     |
| Route crash     | a root error boundary: "Something broke on this page." with **Try again** (primary, `rotate-ccw`) and **Go to Home** (secondary, `house`), and a reference code in `caption`                                                                                         | NEW `boundary.crash.title`, `.retry`, `.home`, `.reference` ("Reference {code}") |

---

## 4. Cards, Home, My recipes and Discover

### 4.1 `RecipeCard` (`features/recipes/src/card/`)

Three variants. The **space the card gets** picks the variant, never the device.

```
GRID (column ≥ 240)                       ROW (list view)                                    COMPACT (Home, Discover results < 600)
┌──────────────────────────────┐          ┌──────┬──────────────────────────────────┐       ┌────────────────┐
│[✎ Draft]               [PRO] │ 4:3      │ 80×80│ Slow-Roasted Lamb Shoulder with  │       │[PRO]   cover   │ 4:3
│                              │          │ cover│ Preserved Lemon, Chickpeas…      │ wrap:2│[⏱ 5 h 30]      │
│[⏱ 5 h 30]                    │          │      │ Moroccan · ⏱ 5 h 30 · 👥 8 · 612 cal│       ├────────────────┤
├──────────────────────────────┤          │      │ ●●○ Medium · ★ 4.8 (12) · 🔒  2 d │       │ Lamb Shoulder  │ truncate:2
│ Slow-Roasted Lamb Shoulder   │          └──────┴──────────────────────────────────┘       │ with Preserv…  │
│ with Preserved Lemon, Chi…   │                    min-height 96, padding 12               │ @braise  [⊕]   │ Discover only
│ ●●○ Medium · ★ 4.8 (12)      │                                                             └────────────────┘
│ Moroccan · 612 cal · Serves 8│
│ gluten-free · slow-cooked +3 │
│ v12 · Edited 2 d ago         │  own   |   (E) @braise.club   [⊕]   Discover
└──────────────────────────────┘
```

**Grid** (columns `repeat(auto-fill, minmax(15rem, 1fr))`, `gapGrid`). Rows align across a grid row through CSS
`grid-template-rows: subgrid`. An empty row keeps its track.

| Row | Content                                                                                                                                                                                                             | Rule                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `RecipeCover` 4:3. Solid overlay chips (`paper` 92%, `ink`, radius `sm`): status top-start (own recipes only: "✎ Draft" or "🔒 Private"), PRO top-end (`premium`), total time bottom-start ("⏱ 5 h 30" in `figure`) | chips `room`                                                                            |
| 2   | title, `cardTitle`                                                                                                                                                                                                  | truncate:2, full title in the link name                                                 |
| 3   | difficulty (tint, meter, word) · rating: `honey` stars + "4.8 (12)" in `ink` `figure`, or "No ratings yet" in `inkMuted`                                                                                            | one line. Rating drops before difficulty                                                |
| 4   | cuisine · calories ("612 cal", "~612 cal" when estimated) · "Serves 8"                                                                                                                                              | one line. Items drop from the end. A failed calorie read removes its item and separator |
| 5   | tags as **text**, not chips: "gluten-free · slow-cooked · +3" in `caption`, `inkMuted`                                                                                                                              | truncate:1 with "+N"                                                                    |
| 6   | own: "v12 · Edited 2 d ago" in `caption` (version only when > 1). Discover: 20 px avatar, "@handle" (truncate:1), and at the end a 44 px **Save a copy** icon button (`copy-plus`)                                  | handle truncate:1                                                                       |

**Row** (list view, the default for My recipes and collection members at `@narrow`). `min-height` 96 (never
`height`, so text spacing overrides survive, SC 1.4.12), padding 12.

- Thumb: 80 × 80 `RecipeCover`, radius `md`, with the PRO chip.
- Title: `cardTitle`, wrap:2, then truncate.
- Line 2 (`meta`, `inkMuted`, one line): cuisine · ⏱ total · 👥 servings · calories. Drop order when it runs out of
  room: calories first, then cuisine.
- Line 3 (one line): difficulty · rating · visibility **icon only** (`lock` or `globe`, named "Private" or "Public"),
  or the neutral "Draft" badge. "Edited 2 d ago" sits at the trailing end in `caption` and drops first.
- Tags and version are deferred to the detail page (owner ruling on Q9). This is the only variant that drops fields.
  The grid keeps the full CR-002 set.

**Compact** (Home at every width. Discover results below a 600 container). Cover 4:3 with the time chip and the PRO
chip, then the title (truncate:2). Discover adds one footer line: "@handle" (truncate:1) and the 44 px Save a copy
icon button.

**Shared rules:**

- The whole card is one link named by the title. Inner buttons (Save a copy) sit above the stretched link, never
  nested inside it. Card title is H3 on a sectioned page.
- Skeleton: the same rows at the same sizes in `pearl`. It stops pulsing after 1 s.
- Hover (fine pointer): `shadow-md`. Pressed: `pressScale`.

**Save a copy from a card:** press → the copy is created (optimistic) and the icon fills. A snackbar says "Saved a
copy to My recipes." with **Edit** (opens the copy in the editor, because a copy needs a real edit before it can be
published, FR-005b). A second press does nothing new: the icon stays filled and its name becomes "Saved a copy".
Failure: the icon unfills and an inline alert says "Couldn't save a copy. Try again." Keys (NEW, `actions/messages.ts`):
`saveCopy.button` "Save a copy of {title}", `saveCopy.done` "Saved a copy", `saveCopy.snackbar`, `saveCopy.edit`,
`saveCopy.failed`.

### 4.2 Home

**Purpose:** pick up where you left off.

```
phone 390                                 840+ (main ≥ 960)
┌────────────────────────────────┐        ┌───────────────────────────────────────────────────────────┐
│ Good afternoon, Eliza      (E) │ H1     │ Good afternoon, Eliza                                       │
│ Sunday 31 May                  │ sub    │ Sunday 31 May                                               │
│ Recent recipes         See all │ H2     │ Recent recipes                                     See all  │
│ ┌────────────┐ ┌────────────┐  │ 2 × 2  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   compact, 4 columns    │
│ │ cover 4:3  │ │ cover      │  │        │ └──────┘ └──────┘ └──────┘ └──────┘                         │
│ │ Lamb Shou… │ │ Pasta      │  │        │ Coming soon                                                 │
│ └────────────┘ └────────────┘  │        │ ┌ Today's nutrition ┐ ┌ Resume cooking ──────────────────┐  │
│ ┌────────────┐ ┌────────────┐  │        │ └───────────────────┘ └──────────────────────────────────┘  │
│ Coming soon                    │ H2     │ ┌ This week's meals ───────────────────────────────────────┐ │
│ Meal plans, a grocery list…    │        │ └──────────────────────────────────────────────────────────┘ │
│ ┌ Today's nutrition   Soon ┐   │        └───────────────────────────────────────────────────────────┘
│                 (+ New recipe) │
└ ⌂ Home   ▤ Recipes  ◎ Discover ┘
```

| Element        | Spec                                                                                                                                                                                                                                                                                                                                                | Rule               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| H1             | the greeting in `largeTitle` via `LargeTitleHeader`. No card, no gradient box. With no display name: "Good afternoon"                                                                                                                                                                                                                               | wrap:2             |
| Subtitle       | the date, `meta`, `inkMuted`                                                                                                                                                                                                                                                                                                                        | truncate:1         |
| Action         | the avatar (§3.3). Not at 840+ (the sidebar has it)                                                                                                                                                                                                                                                                                                 | `room`             |
| Recent recipes | H2 `sectionTitle`, "See all" ghost link at the end of the heading row (visible "See all", name "See all recipes", SC 2.5.3), to My recipes. Up to 4 recipes (FR-046). **Compact** cards: 2 columns below a 600 container (2 × 2), 4 columns from 600                                                                                                | title truncate:2   |
| Coming soon    | H2 "Coming soon", one line of `body`: "Meal plans, a grocery list and daily nutrition are on the way." Then the three FR-046 placeholders in their real shape, **static** `pearl`, no pulse. A neutral "Soon" badge sits next to each title. `@wide`: nutrition and resume side by side 1 : 2, the week strip full width under them. Below: stacked | body wrap          |
| Week strip     | `repeat(7, 1fr)`, minimum tile 36 px. Narrow day names ("M") below `@regular`, short ("Mon") above. Accessible name is the full weekday                                                                                                                                                                                                             | never clips at 320 |
| FAB            | "New recipe" (§3.4). The grid gets the FAB's bottom padding                                                                                                                                                                                                                                                                                         | n/a                |

**States:**

| State                  | Shown                                                                                                                                                                                                                                                                                                                                                                           | Copy (key)                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run (no recipes) | Inside the Recent recipes widget (FR-046 allows one live widget): `body` line, then **Add your first recipe** (primary, `lg`, fill, `pencil-line`) → empty editor, **Paste ingredients** (secondary, fill, `clipboard-paste`) → empty editor scrolled to Ingredients with the paste sheet open, then a ghost link **Or find one on Discover** (`compass`). No "See all". No FAB | NEW `home.recentEmptyBody` "Your recipes will show up here.", NEW `home.firstRecipe` "Add your first recipe", NEW `home.pasteIngredients` "Paste ingredients", NEW `home.findOnDiscover` "Or find one on Discover" |
| Loading                | 4 compact skeletons under the real H2                                                                                                                                                                                                                                                                                                                                           | `loadingLabel` (existing, `web/src/i18n/messages.ts` and mobile), announced politely                                                                                                                               |
| Load error             | under the H2: "We couldn't load your recent recipes." + **Try again** (secondary, `rotate-ccw`). The rest of Home still renders                                                                                                                                                                                                                                                 | existing `HomeWidgetErrorNotice` copy                                                                                                                                                                              |
| Fewer than 4           | only the cards that exist. Column width stays                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                               |
| Coming soon heading    |                                                                                                                                                                                                                                                                                                                                                                                 | NEW `home.comingSoonHeading` "Coming soon", NEW `home.comingSoonBody`                                                                                                                                              |

**Focus order:** H1 (not focusable, route focus target) → avatar → FAB (DOM right after H1) → See all → each card →
nothing in the placeholders (no controls) → subscription nudge if shown.

### 4.3 Recipes › My recipes

**Purpose:** find a recipe you own, fast.

```
phone 320                                    840+ (main 960), grid view
┌──────────────────────────────────┐         ┌────────────────────────────────────────────────────────┐
│ Recipes                     (E)  │ H1      │ Recipes                                                │
│ [ My recipes | Collections ]     │ segm.   │ [ My recipes | Collections ]                           │
│ ( 🔍 Search your recipes      )  │ sticky  │ ( 🔍 Search your recipes                     )         │
│ [All][Under 30 min][British]…  → │ scroll  │ [All] [Under 30 min] [British] [Dairy-free] …          │
│ 12 recipes               ☰  ▦    │         │ 12 recipes                                       ☰  ▦  │
│ ┌──┐ Slow-Roasted Lamb Shoulder… │ rows    │ ┌────┐ ┌────┐ ┌────┐                                   │
│ └──┘ …                (+ New re…)│         │ └────┘ └────┘ └────┘   auto-fill (3 at 960, 5 at 1440)│
└ ⌂ Home   ▤ Recipes   ◎ Discover  ┘         └────────────────────────────────────────────────────────┘
```

| Element     | Spec                                                                                                                                                                                                                                                                          | Rule                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| H1          | "Recipes" (`largeTitle`), avatar as `action` below 840                                                                                                                                                                                                                        | wrap:2                                                                             |
| Segments    | `SegmentedControl` route form: My recipes (`/recipes`) · Collections (`/collections`). Labels: existing `tabMine` and NEW `list.tabCollections` "Collections" in `features/recipes/src/messages.ts`. `tabCommunity` is deleted                                                | `room`. At 320 each segment is 136 px. German "Meine Rezepte" and "Sammlungen" fit |
| Search      | `SearchField`, label "Search your recipes" (visually hidden), `searchPlaceholder` (existing) becomes "Search your recipes". Sticky at the top edge on phones while the list scrolls. `/` focuses it on web (§10)                                                              | placeholder truncate:1                                                             |
| Facet chips | `ChipRow overflow="scroll"` below a 600 container, `wrap` (2 lines) from 600. `Chip kind="filter"`, with counts. "All" clears the others. Labels sentence case from the facet value ("Under 30 min", not "Quick (<30m)")                                                      | chip label `room`, max 24 visible characters                                       |
| Result bar  | count "12 recipes" (`figure`, ICU plural, existing) at the start. At the end, the list/grid switch: `SegmentedControl` radiogroup with icon-only segments named "List view" and "Grid view". Default: list below 600, grid from 600. Persists per device (`recipes.viewMode`) | one line                                                                           |
| **No Sort** | until the list API takes a sort parameter (§12). A sort on one page of a paged list misreports the rest                                                                                                                                                                       | n/a                                                                                |
| Results     | list = row cards, 8 px apart. Grid = grid cards                                                                                                                                                                                                                               | §4.1                                                                               |
| FAB         | "New recipe"                                                                                                                                                                                                                                                                  | §3.4                                                                               |
| Back to top | web, §3.6                                                                                                                                                                                                                                                                     | n/a                                                                                |

**Scroll budget at 390 × 844:** title row 44 + title 40 + segments 44 + 12 + search 48 + 12 + chips 44 + 8 + result
bar 32 = 284 px, plus the 64 px tab bar. That leaves about 496 px: four full row cards and part of a fifth. At
320 × 568 it holds two. Today it holds none.

**States:**

| State           | Shown                                                                                                                                                                                                                                                                 | Copy (key)                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run       | Segments stay. Search, chips and result bar hide. A centred block (max 28 rem): the empty-recipe-box drawing, H2, body, then **Add your first recipe** (primary, fill below 600) and **Paste ingredients** (secondary), stacked below 600, side by side above. No FAB | `emptyTitle` (existing) → "Your recipe box is empty", `emptyBody` (existing) → "Add a recipe you love, or paste an ingredient list and we'll set it up." |
| No match, query | results area: H2 "No recipes match" + "Nothing matches “{query}”." + **Clear search**                                                                                                                                                                                 | `noMatchTitle` (existing) → "No recipes match". NEW `list.noMatchQuery`, NEW `list.clearSearch`                                                          |
| No match, chips | "No recipes match these filters." + **Clear filters**. Both buttons if both apply                                                                                                                                                                                     | NEW `list.noMatchFilters`, NEW `list.clearFilters`                                                                                                       |
| Loading         | segments and search stay. 6 skeletons of the active variant. No chips, no FAB                                                                                                                                                                                         | `loadingLabel` (existing)                                                                                                                                |
| Load error      | "We couldn't load your recipes." + **Try again**. FAB stays                                                                                                                                                                                                           | existing                                                                                                                                                 |
| Refresh failed  | `@commise/ui/refresh-notice` above the results                                                                                                                                                                                                                        | existing                                                                                                                                                 |
| 500+ recipes    | `@commise/ui/load-more` after the list                                                                                                                                                                                                                                | existing                                                                                                                                                 |

**Focus order:** H1 → avatar → FAB → segments → search → clear → chips (one stop each) → view switch (one stop, arrow
keys) → cards → load more → back to top.

### 4.4 Discover: browse and filters

**Purpose:** find something new to cook.

```
phone 390                                    840+ (main 960)
┌──────────────────────────────────┐         ┌ Filters 256, sticky ┬ results ─────────────────────────┐
│ Discover                    (E)  │ H1      │ Discover                                               │
│ ( 🔍 Search recipes           )  │         │ ┌ Filters ──────┐  ( 🔍 Search recipes             )  │
│ [⚙ Filters · 2]   Sort: Relevance▾│         │ │ Clear all     │  12 recipes for “lamb”  Sort ▾     │
│ [Gluten-free ×] [Under 30 min ×] │ applied │ │ Total time    │  ┌────┐ ┌────┐ ┌────┐              │
│ Trending this week       See all │ H2      │ │ (•) Any       │  └────┘ └────┘ └────┘              │
│ ┌──────────┐ ┌──────────┐ ┌─     │ rail    │ │ Dietary …     │                                    │
│ Browse by cuisine                │ chips   │ └───────────────┘                                    │
└──────────────────────────────────┘         └──────────────────────────────────────────────────────┘
```

- **H1** "Discover" via `LargeTitleHeader`, avatar as `action` below 840. No segments.
- **Search:** `SearchField`, label "Search recipes" (existing `searchPlaceholder` in `discovery/messages.ts` → "Search
  recipes"). `/` focuses it on web.
- **Below a 960 container:** one row under the search with **Filters** (`Button secondary sm`, `sliders-horizontal`;
  with active filters it reads "Filters · 2", named "Filters, 2 active") and, at the end, **Sort** (§4.5). Under
  them, applied filters as removable `Chip kind="input"` in a scrolling `ChipRow` (each named "Remove {filter}
  filter"), then **Clear all** (ghost) when two or more apply.
- **At a 960+ container and a window at least 480 px tall:** a sticky 256 px filter panel on the start side (`aside`
  named "Filters"), scrolling inside itself, with **Clear all** at its top. No Filters button, no applied-chip row.
  Otherwise the sheet. Only one copy of the facets renders at a time. This replaces the
  `useFilterBarLayout.ts` media query.
- **Filter content** (sheet and panel, same groups, each a `fieldset` with an `overline` legend):

| Group             | Control                                                                          | Rule                                |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| Total time        | `Chip kind="choice"`: Any · Under 15 min · Under 30 min · Under 60 min           | scroll row below 600, wrap above    |
| More time filters | a closed `details` disclosure holding Prep time and Cook time, same four choices | same                                |
| Dietary           | `Chip kind="filter"` with counts                                                 | wrap:3 lines, then "Show all ({n})" |
| Cuisine           | same                                                                             | same                                |
| Tags              | same, top 12 by count, then "Show all ({n})"                                     | wrap:3                              |
| Ingredients       | `SearchField`, label "Has ingredient", placeholder "chicken"                     | n/a                                 |

- **Filter sheet** (`@commise/ui/sheet`): title "Filters" (`barTitle`), close × at the end. The body scrolls. Footer
  pinned: **Clear all** (secondary) and **Show {count} recipes** (primary, live ICU count, NEW
  `filters.showResults`). Below a 600 container they stack full width, primary on top. Filters apply live
  underneath. The primary only closes the sheet. Focus moves to the sheet title on open and back to Filters on close.
- **Browse view** (no query, no filters): the existing rails ("Trending", "New", their existing keys), then "Browse by
  cuisine" as a scrolling `ChipRow` of cuisine chips. **Hide the cuisine row** while fewer than 3 cuisines have 3 or
  more recipes each.
- **Rails:** H2 `sectionTitle` (the teal underline bar goes), "See all" ghost link at the end (existing `seeAllLabel`,
  name "See all {rail}"). Track: grid cards at `width: clamp(240px, 78%, 256px)`, `scroll-snap-type: x mandatory`,
  `scroll-padding-inline` equal to the gutter. At 320 the next card peeks about 32 px. At 390 it peeks about 86 px.
  The peek is the swipe cue on touch.
    - Fine pointer only (`(hover: hover) and (pointer: fine)`): two 36 px round ghost buttons, previous and next, at
      the end of the heading row before "See all". They scroll by one view minus one card and disable at the ends.
    - Keyboard: the track is a focusable `region` named "{rail} recipes", arrow keys scroll it, each card is a stop.
    - **The skeleton uses the same track element as the loaded rail** (one `RailTrack`), so it cannot overflow the
      page again (E1, fixed in slice 0).

### 4.5 Discover: results and sort

- **Results:** "12 recipes for “lamb”" (`resultsForQuery`, existing, `meta`, polite live region). Compact cards 2-up
  below a 600 container. Grid cards with the Discover footer from 600 (auto-fill, 5 columns at the 1440 cap).
- **Sort:** shown only while a query or filter is active, or after "See all". A ghost `sm` button "Sort: {choice}"
  with `chevron-down` opens an `ActionMenu` (web menu, native sheet) of four radio items: Relevance, Newest, Most
  saved, Quickest. The chosen item shows a check. "Most cloned" becomes "Most saved" (glossary).

### 4.6 Discover: states

| State                                       | Shown                                                                                                                                           | Copy (key)                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Browse loading                              | rail headings + contained skeleton tracks                                                                                                       | `loadingLabel` (existing), once                                  |
| One rail failed                             | that rail: "Couldn't load this row." + **Try again**                                                                                            | existing                                                         |
| Search updating                             | previous results stay. The pending bar after 500 ms (existing)                                                                                  | existing                                                         |
| No results, query                           | H2 "No recipes for “{query}”" + "Check the spelling, or try a shorter search." + **Clear search**                                               | NEW `discovery.noMatchQueryTitle`, `.noMatchQueryBody`           |
| No results, filters                         | H2 "No recipes match these filters" + "Remove a filter to see more." + **Clear filters**. The applied chips stay above                          | `noMatchTitle` (existing) and NEW `discovery.noMatchFiltersBody` |
| No results, both                            | H2 "No recipes for “{query}” with these filters" + **Clear filters** (primary) + **Clear search** (secondary)                                   | NEW `discovery.noMatchBothTitle`                                 |
| Every no-result state, then                 | "Try one of these": the three most-used tags as `filter` chips (hidden if fewer than 3), then the "Trending" rail. The page is never a dead end | NEW `discovery.tryThese`                                         |
| Search failed (any cause, offline included) | under the field: "We couldn't search right now." + **Try again**. Previous results stay. No connectivity branch                                 | NEW `discovery.searchFailed`                                     |
| Empty catalogue                             | "No public recipes yet."                                                                                                                        | `emptyTitle` (existing, new value)                               |

Every no-result block is a `role="status"` region. Its H2 takes no focus: focus stays in the search field.

---

## 5. Collections

### 5.1 Collections list, and the new and rename sheet

- **Header:** H1 "Recipes" with Collections selected in the segments. At 840+ the header `action` is **New
  collection** (`Button secondary md`, `plus`). Below 840 the floating button reads "New collection" (§3.4), and the
  header has no second copy. Existing key: `createCta` in `collections/messages.ts`, value "New collection".
- **Search** ("Search your collections") shows only from 6 collections.
- **Result bar:** "8 collections" (NEW ICU `collections.list.count`).
- **Card:** a **1:1** album mosaic of the first four member photos (2 × 2, 2 px gaps, radius `md` on the outer
  corners). One to three photos: the first fills the box. No photos: a `RecipeCover`-style tint (hash of the
  collection id) with the stacked-cards drawing. Then the name (`cardTitle`, truncate:2), then "12 recipes · 🔒 Private"
  (`meta`, icon + word), then, for a copy, "Copied from @clara" (`caption`, truncate:1). The card is one link named
  "{name}, {count}, {visibility}". Grid: 2 fixed columns below a 600 container, `minmax(15rem, 1fr)` from 600.
- **States:** first run: the stacked-cards drawing, H2 "Group recipes your way", body "Make a collection for
  weeknights, holidays or anything else.", and **New collection** (primary) (existing `emptyTitle` and `emptyBody` in
  `collections/messages.ts`, new values). With 0 recipes, add the line "Add a few recipes first." and the button
  becomes **Add a recipe**, which opens the editor. The FAB hides while this block shows. Loading: 4 skeleton cards,
  header stays. Load error: **Try again**. Refresh failed: the refresh notice.

**New collection sheet.** A content-height sheet below 840, a 480 px dialog at 840+. No route (§3.1).

| Part                    | Spec                                                                                                                            | Rule       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Header                  | × (name "Close"), title "New collection" (`barTitle`)                                                                           | truncate:1 |
| Name                    | `FieldLabel` "Name", `Input`, required, 80 characters, counter "34/80" from 60. Autofocus at 840+ only                          | n/a        |
| Description             | `FieldLabel` "Description (optional)", auto-growing `TextArea`, 280 characters                                                  | n/a        |
| Primary                 | **Create collection** (`plus`), `lg`, fill, pinned above the keyboard below 840. At 840+ under the form with a ghost **Cancel** | `room`     |
| Empty name on submit    | "Give your collection a name." under the field (`aria-describedby`), focus moves to it (SC 3.3.1)                               | wrap:2     |
| Server failure          | an inline alert above the button: "We couldn't create the collection. Try again." The input is kept                             | wrap:2     |
| After create            | the sheet closes and the new collection's detail page opens. Its empty state offers **Add recipes**                             | n/a        |
| Close with a typed name | a `ConfirmDialog`: "Discard this collection?" with **Discard** (filled `error`) and **Keep editing** (focus)                    | n/a        |

Rename uses the same sheet: title "Rename collection", primary **Save name** (`check`). Keys: NEW
`collections.sheet.newTitle`, `.renameTitle`, `.nameLabel`, `.descriptionLabel`, `.create`, `.saveName`,
`.nameRequired`, `.createFailed`.

### 5.2 Collection detail

```
phone 390                                   840+
┌──────────────────────────────────┐        ‹ Collections
│ (‹)                          (⋯) │        Weeknight Dinners the Whole Family Will Actually Eat   [+ Add recipes] [⋯]
│ Weeknight Dinners the Whole      │ H1     🔒 Private · 6 recipes · Copied from @clara
│ Family Will Actually Eat         │ wrap:3 Thirty-to-forty-minute dinners for school nights…
│ 🔒 Private · 6 recipes           │        6 recipes                                       ☰  ▦
│ Thirty-to-forty-minute dinners…  │        ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ [ + Add recipes            ] [⋯] │        └────┘ └────┘ └────┘ └────┘
│ ┌──┐ Slow-Roasted Lamb…       ⋯  │
└──────────────────────────────────┘
```

- **H1:** the collection name, `largeTitle`, wrap:3, then truncate with the full name in the bar title's `title`. It
  never shares a row with buttons below a 600 container. That fixes E3 by layout.
- **Meta line:** visibility (icon + word) · "6 recipes" · "Copied from @clara". Each item is an inline group that
  never breaks inside. The row wraps between groups (re-layout, not a wrap inside a control).
- **Description:** `body`, wrap (prose).
- **Actions, the same model at every width:** one primary **Add recipes** (`plus`) and one ⋯ named "More actions for
  {name}". `LargeTitleHeader`'s `action` slot takes this pair (§1.11: at most one button plus one ⋯).
    - Below 600: the action row sits under the description. Add recipes fills the row minus 52 px. ⋯ is 44 × 44.
    - 600 and wider: the pair sits at the end of the title row.
    - ⋯ menu, in order: Rename · Make private / Make public · Save a copy · Pull updates (copies only) · divider ·
      Delete collection.
- **Visibility** changes at once from the menu with an undo snackbar ("Collection is now private." **Undo**). A
  free-tier user choosing Make private gets the upsell sheet: "Private collections are part of Premium." with **See
  Premium** and **Not now**, both secondary `md` buttons of equal size side by side (both resolutions agreed on
  equal weight). Nothing is pre-selected. This passes the DSA Art. 25
  test: it is true and does not distort the choice.
- **Members:** the same list or grid as My recipes, with the same view switch. Each member row has a trailing ⋯ (44 ×
  44, "More actions for {recipe}"): Open recipe · Remove from collection. The source label ("Added by you" or "From
  the original collection", existing keys) moves into the row's last line in `caption`.
- **Remove** is optimistic with an undo snackbar: "Removed Pasta from Weeknight Dinners." **Undo**, 6 s. No dialog,
  because removing does not delete the recipe (FR-012). Focus moves to the next row's link, or to the H1 after the
  last row.
- **Delete collection** keeps a dialog (it cannot be undone): "Delete Weeknight Dinners?" / "The 6 recipes stay in
  your library." / **Delete collection** (filled `error`, `trash-2`) and **Keep collection** (secondary, `x`). Focus
  opens on Keep collection.
- **States:** no members: "No recipes here yet" + **Add recipes** (existing `detail.emptyTitle`, `emptyBody`). Not
  found: the 404 body inside the shell with "Back to Collections". Load error: existing. Refresh failed: the notice.
  Load more: "Load more" (existing).

### 5.3 Add recipes picker

```
┌──────────────────────────────────┐
│ ×   Add to Weeknight Dinners…    │ 56, truncate:1
│ ( 🔍 Search your recipes       ) │ sticky
│ ┌──┐ Slow-Roasted Lamb…       (✓)│ 64, the whole row toggles
│ ┌──┐ Pasta                    ( )│
├──────────────────────────────────┤
│ [    Done · 2 added, 1 removed  ]│ ActionBar
└──────────────────────────────────┘
```

- A full-height sheet below 840. A 640 px dialog, 80% of the window tall, at 840+. Native: full-height sheet on phone,
  a 640 form sheet on tablet.
- Each row is one control: `role="checkbox"` with `aria-checked`, named by the recipe title. Rows: 48 px thumbnail,
  title (truncate:2), one meta line, and a trailing 28 px circle (off: `lineControl` outline. On: `action` fill with a
  white check). Members of the collection start checked.
- **Each toggle saves at once** (optimistic) and announces "Added {title}" or "Removed {title}" politely. A failed
  toggle flips back, and an inline alert says "Couldn't add {title}. Try again."
- **Done** (`check`, primary, `lg`, fill) in the `ActionBar`: "Done", or "Done · {added} added, {removed} removed"
  with the zero parts left out (NEW ICU `picker.doneWithCount`). × does the same as Done, because nothing is unsaved.
- **States:** no recipes at all: "You have no recipes yet." + **Add a recipe** (opens the editor). No match: **Clear
  search**. Loading: 6 skeleton rows.

---

## 6. Recipe detail (with the first slice of 008 FR-035) and versions

**Purpose:** decide whether to cook it, then cook from it at arm's length, often one-handed.

### 6.1 Layout

```
phone 390                              800 (body ≥ 720): two columns          840+ in content-detail (1152), body ≥ 960
┌──────────────────────────────┐       under the same top                     ┌──────────────────────────────────────────────┐
│(‹)                       (⋯) │ hero  ┌ Ingredients ─┐┌ Steps ────┐          │ ‹ My recipes                                  │
│        cover 4:3, ≤ 40% h    │       │ sticky 5/12  ││ 7/12       │          │ MOROCCAN · by @braise      ┌───────────────┐ │
│                        1/3   │       └──────────────┘└────────────┘          │ Slow-Roasted Lamb Shoulder │ hero 4:3      │ │
├──────────────────────────────┤                                              │ with Preserved Lemon…  H1  │ (7/12, end)   │ │
│ MOROCCAN · by @braise.club   │ meta                                         │ ★ 4.8 (12) · 🌐 Public     └───────────────┘ │
│ Slow-Roasted Lamb Shoulder   │ H1                                           │ ┌ 5 h 30 │ 30 min │ 5 h │ ●●○ Medium ┐       │
│ with Preserved Lemon, …      │ wrap:3                                       │ [Edit recipe] [⋯] [☀ Screen on]            │
│ ★ 4.8 (12) · 🌐 Public       │                                              │ description (62ch)                          │
│ ┌─────────────┬────────────┐ │ stats                                         ├──────────────────┬───────────────────────────┤
│ │5 h 30 min   │30 min      │ │ 2 × 2                                         │ Ingredients  for │ Steps                      │
│ │Total        │Prep        │ │                                               │ 8 [−][+] sticky  │ ① The night before…       │
│ │5 h          │●●○ Medium  │ │                                               └──────────────────┴───────────────────────────┘
│ │Cook         │Difficulty  │ │
│ └─────────────┴────────────┘ │ (one row of 4 from a 360 strip)
│ [      Edit recipe     ] [⋯] │                                              Nutrition · Rating · Version under the steps
│ Description, 4 lines…  More  │
│ gluten-free · dairy-free · … │ tags (text)
├ Ingredients · Steps · Nutrition ☀ ┤ SectionSwitch (sticky)
│ Ingredients for 8   [−] 8 [+]│
│ ☐ 2–2.5 kg  Lamb shoulder,…  │
└──────────────────────────────┘
```

**Top (every width), in DOM and reading order:**

| Element     | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                              | Rule                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hero        | the photo carousel **is** the hero, so the cover shows once (F2, fixed in slice 0). Phone: full-bleed 4:3, height ≤ 40% of the window (`ui/src/layout/mediaBox.ts`). Tablet: 16:9 in the gutters, radius `lg`. 840+ with a body ≥ 960: 4:3 at the **end** 7/12 beside the title block. Counter chip "1/3" bottom-end, dots under it on phones. No photo: the 96 px band (`mediaHeight.heroPlaceholder`) as a `RecipeCover` tint with the monogram | n/a                                                   |
| Back and ⋯  | 44 px `paper` discs at 90% on the hero, top-start and top-end (`chevron-left` "Back to {parent}", `ellipsis` "More actions for {title}"). At 840+ back is the eyebrow link and ⋯ moves into the action row. Native: on the hero too, inside the safe area. The page's old Back pill row is deleted                                                                                                                                                | n/a                                                   |
| Meta        | `overline` cuisine · "by @handle" (others) in `caption`, `inkMuted`                                                                                                                                                                                                                                                                                                                                                                               | wrap by item group                                    |
| H1          | the title, `largeTitle`, no tinted card                                                                                                                                                                                                                                                                                                                                                                                                           | wrap:3, then truncate with the full title in the name |
| Rating line | `honey` stars + "4.8 (12)" in `ink` · visibility (own: "🌐 Public", "🔒 Private", or the "Draft" badge)                                                                                                                                                                                                                                                                                                                                           | one line, items drop from the end                     |
| Stat strip  | four cells: Total, Prep, Cook, Difficulty. Values in `figure-stat` (20/600) through `formatDuration`. Labels in `caption`, `inkMuted`. One row of cells in a level-1 card. Below a 360 px strip: 2 × 2. A missing time hides its cell. Never "0 min"                                                                                                                                                                                              | value `room`                                          |
| Actions     | own: **Edit recipe** (primary, `pencil-line`) + ⋯. Others': **Save a copy** (primary, `copy-plus`) + ⋯. Below 600 the primary fills the row and ⋯ is 44 px at its end. From 600: content width, start-aligned. From a 720 body, the **Screen on** toggle joins the end of this row (§6.3)                                                                                                                                                         | `room`                                                |
| Description | `readingBody`. Below 600: clamped to 4 lines with a "More" text button (`aria-expanded`) that expands in place. No clamp from 600                                                                                                                                                                                                                                                                                                                 | wrap                                                  |
| Tags        | **text**, not chips (they are not pressable): "gluten-free · dairy-free · slow-cooked" in `meta`, `inkMuted`                                                                                                                                                                                                                                                                                                                                      | wrap                                                  |

**Body:**

- **Body below 720:** one column. `SectionSwitch` (§6.2) sticks under the condensed bar.
- **Body 720 and wider:** two columns, ingredients 5/12 and **sticky** (`top` = the sticky chrome + 16), capped at
  `max-height: calc(100dvh - top)` with its own scroll. Steps 7/12. `SectionSwitch` does not render. Nutrition, rating
  and the footer facts follow under the steps. At 768 this gives about 280 and 410 px.
- **No third column** at 1920: the page stays in `content-detail` (1152). Empty space beside a readable measure is
  correct (`device-ergonomics.md`).

**Ingredients section:**

- Heading row: H2 "Ingredients" with "for {n}" and the `Stepper` at the end edge (serves sits next to the amounts it
  scales). After scaling, a note shows: "Amounts scaled from {original} servings." with **Reset** (ghost).
  Announced politely: "Amounts for {n} servings."
- Rows: **tap-to-check** (§6.3). A group gets an `overline` heading ("FOR THE LAMB").
- Each row: a 24 px checkbox in a row at least 48 px tall (`gapRow`), the amount in `figure-inline` 600, the name in
  `ink`, the prep in `inkMuted`. Rows wrap as text (content). "Your own food" badge for a custom food (existing).
- Own recipe: the section heading has a ghost **Edit** link that opens the editor at `#ingredients`.

**Steps section** (H2 "Steps"):

- Each step: a 32 px numeral in a `selectedFill` circle (`ink`), then `readingBody` text (62ch), then its timer as a
  text chip "⏱ 4 h 30 min" (`formatDuration`). The chip is not pressable until the cook view ships.
- Steps are not cards. 24 px between steps, 8 px inside one.
- **Tap a step to make it current** (§6.3).
- Own recipe: a ghost **Edit** link on the heading opens the editor at `#steps`.

**Nutrition:** four figures per serving (calories, protein, carbs, fat), `figure-stat` (20) over `caption` labels. 2 × 2
below a 560 px column, 4 across above. Then one grouped footnote in `caption`: the estimate note (only when partial),
"From public food databases · Data sources", and the custom-food note only when one is present.
**Rating:** others' recipe: "Rate this recipe" with 44 px stars. Own: the average and count, and "You can't rate your
own recipe."
**Footer facts:** source link, "Version 12 · Edited 2 d ago", and **Version history** (ghost).

### 6.2 `SectionSwitch` (`ui/src/sectionSwitch/`)

- A sticky 48 px level-2 bar under the condensed header: "Ingredients · Steps · Nutrition". Shown only while the
  body is narrower than 720.
- A `nav` named "Recipe sections" with three links. The active one carries `aria-current="location"` and the tab
  selected style (§1.10). The active part follows the scroll position (scroll-spy, the same mechanism as §7.2).
- Press: scroll the section H2 under the sticky chrome (`scroll-margin-top`), instant under reduced motion, then move
  focus to the H2 (`tabindex="-1"`).
- An optional trailing slot holds one toggle. The detail page puts **Screen on** there.
- Labels are `room`. At 320 at +35% the three labels still fit, because the toggle shows icon-only there.

### 6.3 The first slice of 008 FR-035: Screen on, tap-to-check, current step

These ship now with detail (owner). The full cook view (008 FR-032 to FR-035) follows the overhaul.

**Screen on** (`KeepAwakeToggle`, `ui/src/keepAwake/`):

- A switch. Visible label "Screen on" from a 720 body (end of the action row). Below 720: icon-only `sun` in the
  `SectionSwitch` trailing slot, named "Screen on", with `role="switch"` and `aria-checked`. The first time it is
  shown, a one-time hint under the switch bar says "Keeps the screen awake while you cook." (`caption`, dismissed on
  the first scroll or tap).
- On: web `navigator.wakeLock.request('screen')`, re-acquired on `visibilitychange`. Native `expo-keep-awake`. It is
  released when the cook leaves the page. It defaults to off on each visit.
- No API (an older browser, an insecure context): the control does not render. It is never shown disabled.
- Keys: NEW `recipeMessages.detail.screenOn` "Screen on", `.screenOnHint`.

**Tap-to-check ingredients:**

- The whole row is the target: `role="checkbox"`, `aria-checked`, named with the full line ("2 to 2.5 kg lamb
  shoulder, bone-in, trimmed of excess fat"). Native `accessibilityRole="checkbox"`.
- Checked: the checkbox fills (`action`) with the signature check overshoot (§1.9), and the text dims to `inkMuted`.
  **No strike-through:** a cook re-reads a checked amount, and a strike-through damages the word shape.
- Checks persist per recipe for the session: web `sessionStorage`, native in memory per stack entry. ⋯ → **Clear
  checks** resets them (shown only while any check is set).

**Current step:**

- A tap on a step (outside its timer chip) makes it current: a 3 px `hereBar` on its start edge, its numeral circle
  fills `action` with a white numeral. One current step at a time. A second tap clears it.
- It is a place marker, not a completion record. It persists like the checks.
- Semantics: the step text stays plain content. Each step also carries its own 44 px toggle at the start edge (the
  numeral circle), a `button` named "Mark step {n} as current" with `aria-pressed` (native `accessibilityState.selected`).
  A tap anywhere on the step activates that toggle for pointer users.

### 6.4 Other detail surfaces

- **⋯ menu** (`ActionMenu`): own: Version history · Make private / Make public · Clear checks (when set) · divider ·
  Delete recipe. Others': Version history (when allowed) · Clear checks (when set). A free-tier owner choosing Make
  private gets the upsell sheet: "Private recipes are part of Premium." · **See Premium** · **Not now**, at equal
  weight as in §5.2. Check F8 first (a premium viewer was shown the upsell). Keys (NEW, `actions/messages.ts`):
  `upsell.privateRecipe`, `upsell.seePremium` "See Premium", `upsell.notNow` "Not now". Collections use
  `collections/messages.ts` `upsell.privateCollection` with the same two buttons.
- **After a recipe's first publish:** the detail page opens with a snackbar "Recipe published." and **Add to a
  collection**. It opens the **collection chooser sheet**: the picker of §5.3 turned around. Title "Add to a
  collection". Rows are the cook's collections (48 px mosaic, name truncate:2, "{n} recipes") as whole-row
  checkboxes that save at once, with a **New collection** row first that opens §5.1's sheet and returns with the new
  collection checked. **Done** closes it. No collections: only the New collection row and the line "You have no
  collections yet." Keys NEW in `collections/messages.ts`: `chooser.title`, `chooser.newRow`, `chooser.empty`. After Save a copy from detail: the copy opens in the editor, because it needs an
  edit before it can be published (FR-005b).

### 6.5 Delete confirmation

`ConfirmDialog`, centred in the viewport. Title "Delete this recipe?" (`sectionTitle`). Body: "“{title}” and its
version history will be deleted. You can't undo this." (the title clamped to 2 lines). Buttons: **Delete recipe**
(filled `error`, `trash-2`) and **Keep recipe** (secondary, `x`). Side by side from a 400 px dialog, Keep left.
Stacked full width below, Delete on top. **Focus opens on Keep recipe.** Busy: Delete shows its spinner and both lock.
Failure: "We couldn't delete this recipe. Try again." inside the dialog. Keys (`actions/messages.ts`): `delete.title`,
`delete.body`, `delete.confirm` change values. NEW `delete.keep` "Keep recipe".

### 6.6 Version history

- `LargeTitleHeader`: back "Back to recipe", H1 "Version history", subtitle the recipe title (truncate:1).
- Rows, newest first: "Version 12 · Edited 2 days ago" (`body` 600), "Changed: ingredients, steps" (`meta`,
  `inkMuted`, truncate:1), and ⋯: Preview · Restore this version · Compare with current. **Compare is per row, against
  the current version.** Comparing two old versions is deferred.
- Preview opens a sheet with the version's detail page and **Restore this version** as its primary. Restore makes a
  new version, so it needs no dialog: a snackbar says "Restored version 9." with **Undo**.
- **Empty:** a 48 px `clock` glyph in `inkMuted`, "No earlier versions yet", "Each time you save changes, the version
  before is kept here." and **Back to recipe** (existing `recipeVersionMessages` keys, new values).
- Loading: 3 skeleton rows. Error: "We couldn't load the history." + **Try again**. Restoring: the row is busy.

### 6.7 States

| State                 | Shown                                                                                       | Copy                                                |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Loading               | hero at its real ratio, title, stat and row skeletons. No layout shift                      | `loadingLabel` (existing)                           |
| Load error            | "We couldn't load this recipe." + **Try again**                                             | existing                                            |
| Not found or private  | "This recipe isn't available." + **Back to My recipes**                                     | existing, new value                                 |
| No photo              | the 96 px monogram band                                                                     | none                                                |
| No steps              | "No steps yet." Own: + **Add steps** → editor `#steps`                                      | NEW `detail.noSteps`, `detail.addSteps`             |
| No ingredients        | "No ingredients yet." Own: + **Add ingredients** → editor `#ingredients`                    | NEW `detail.noIngredients`, `detail.addIngredients` |
| Nutrition partial     | figures + "Estimated from {counted} of {total} ingredients."                                | existing slot states                                |
| Nutrition unavailable | "—" in each cell and one line                                                               | existing                                            |
| Scaled                | the note + **Reset**                                                                        | NEW `detail.scaledFrom`, `detail.resetScale`        |
| Draft (own)           | the neutral Draft badge in the rating line                                                  | existing                                            |
| Offline               | the cached recipe stays fully readable and checkable. Every action behaves the same (owner) | none                                                |

**Key changes:** `stepTimer` (`features/recipes/src/messages.ts:843`, today `'{seconds}s timer'`) becomes
`'{duration}'`, rendered after the `timer` glyph. NEW `recipeMessages.duration.minutes` "{minutes} min",
`.hours` "{hours} h", `.hoursMinutes` "{hours} h {minutes} min". NEW `detail.byAuthor` "by @{handle}".

---

## 7. The editor: one page for create and edit (D1, D2)

**Purpose:** a cook enters a recipe once, usually seated, often interrupted, and fixes it later in one place. The
four-step wizard is retired for create **and** edit in the same slice. One page holds four sections: **Details ·
Ingredients · Steps · Photos & publish**. Routes: `/recipes/new` and `/recipes/{id}/edit`, with a section hash
(`#details`, `#ingredients`, `#steps`, `#photos`). Native: `RecipeCreateScreen`, `RecipeEditScreen` and
`RecipeEditor` (`mobile/src/screens/`) become one editor screen.

### 7.1 Frame

```
phone 390                                        768 (@regular)                         1280 (@wide)
┌──────────────────────────────────────┐         ┌──────────────────────────────────┐   ┌ sidebar ┬──────────────────────────────────────────┐
│ ×  New recipe        Saved       (⋯) │ 56      │ ×  Edit recipe   Changes saved…(⋯)│   │         │ ×  New recipe                Saved   (⋯) │
├──────────────────────────────────────┤         ├──────────────────────────────────┤   │         ├──────────────┬───────────────────────────┤
│ Ingredients        ⚠ 2            ⌄  │ 44 bar  │ ✓ Details ⚠ Ingredients 2 Steps … │48 │         │ ✓ Details    │ Details             (H2) │
│ ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░ │ 4       ├──────────────────────────────────┤   │         │▌Ingredients  │ …                         │
│ Ingredients                     (H2) │         │ Ingredients                 (H2) │   │         │  ⚠ 2 need a  │ Ingredients         (H2) │
│ …                                    │         │ …                                │   │         │    match     │ …                         │
├──────────────────────────────────────┤         ├──────────────────────────────────┤   │         │ Steps        │                           │
│ [ Preview ]        [   Publish     ] │ 72      │            [Preview]  [Publish]  │   │         │  Not started │                           │
└──────────────────────────────────────┘         └──────────────────────────────────┘   │         │ Photos &     │                           │
                                                                                         │         │ publish      │                           │
                                                                                         │         │  Optional    │                           │
                                                                                         │         │ ──────────── │                           │
                                                                                         │         │ 612 cal/serv │                           │
                                                                                         │         │ 7 of 9 count.├───────────────────────────┤
                                                                                         │         │              │      [Preview] [Publish]  │
                                                                                         └─────────┴──────────────┴───────────────────────────┘
```

- **Chrome.** The editor is a focused task: the tab bar hides and the editor's own header replaces any top bar. At
  840+ the sidebar stays. Leaving through it loses nothing, because the editor saves by itself (§7.3).
- **Header** (56, sticky, level 2):
    - × named "Close editor". It never asks a question, because nothing is ever lost (§7.3).
    - Title "New recipe" or "Edit recipe" in `barTitle`, truncate:1. Never the recipe's own title (N4).
    - Save status in `caption` (§7.3).
    - ⋯ "More editor actions": **Discard draft** (new or draft) or **Discard changes** (published), destructive.
- **Section index** under the header (§7.2): a 44 px bar below a 600 container, a 48 px strip at 600–959, a 240 px
  rail at 960+.
- **Form column:** `content-list` (768) at most. At `@wide` the rail (240) + 32 + the form fill the container.
  Sections are separated by `gapSection`, each with an H2 (`sectionTitle`). One form needs no cards.
- **`ActionBar`** (sticky bottom at every width, inside the form column at 840+): **Preview** (secondary, `eye`) and
  the primary at the end: **Publish** (`check`) for a new recipe or a draft, **Save changes** (`check`) for a published
  recipe. Save changes is disabled while there is nothing to save.
- **Scroll budget at 390 × 844:** header 56 + section bar 48 + `ActionBar` 72 leaves about 668 px. One-line ingredient
  rows are 48 px, so about ten fit on one screen. Today six ingredients take two and a half screens.
- **Keyboard open (phones):** the section bar hides and the `ActionBar` unpins (`compactHeightLayout.md` A1: bars
  unpin past half the frame). The header stays, so one bar holds the top edge. Both return when the keyboard closes.
  The focused field scrolls to `block: 'nearest'` above the keyboard (`KeyboardAvoider` on native).

### 7.2 `SectionIndex` (`ui/src/sectionIndex/`)

One component, one data model, three presentations. The caller passes `{ id, label, shortLabel, status, reason,
hint }[]` and the current id. The statuses come **from the publish validator**, so the index and Publish can never
disagree (one source of truth).

**Presentations:**

| Container            | Form                                | Spec                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@wide` (≥ 960)      | **rail**, 240 px, inline start      | sticky under the header (`top` = header + 16), scrolls inside itself if taller than the window. Rows ≥ 48 px: the label, then the status line in `caption`. The rail foot shows the nutrition total (§7.5.6) and, for a first recipe, "{done} of 4 done"                                                                                                                         |
| `@regular` (600–959) | **strip**, 48 px, full column width | four items in one row, each 44 px tall. Visible label is `shortLabel` ("Photos" for "Photos & publish", SC 2.5.3 holds). A status shows as a glyph plus a count. Labels `room`                                                                                                                                                                                                   |
| `@narrow` (< 600)    | **bar**, 44 px, one button          | start: the current section's label (truncate:1). End: "⚠ {n}" when anything needs attention, then `chevron-down`. Under it, a 4 px four-segment progress line (`aria-hidden`): complete `action`, needs attention `warning` with a 1 px `warning-dark` top edge, empty `pearl`. A tap opens a content-height sheet titled "Sections" with four 56 px rows (glyph, label, reason) |

**Statuses** (one per section, in this precedence). Never colour alone: each has a glyph and words (SC 1.4.1).

| Status                | When                                                                                                                                                        | Rail and sheet                                                                                                                                                   | Strip     | Bar                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ |
| Fix before publishing | after a refused Publish, the section has a blocking error                                                                                                   | `danger` ⚠ + "Fix {n} thing(s)"                                                                                                                                  | ⚠ + count | counted in "⚠ {n}" |
| Needs attention       | something that will block Publish, shown before the cook presses it, for example an ingredient with no food (the validator refuses an unresolved line, U28) | `attention` ⚠ + the reason ("2 need a match"), wrap:2                                                                                                            | ⚠ + count | counted            |
| In progress           | something entered, but a field needed to publish is empty                                                                                                   | `inkMuted` + the reason ("Title needed", "Add at least one step")                                                                                                | nothing   | nothing            |
| Not started           | the section is empty                                                                                                                                        | `inkMuted` "Not started"                                                                                                                                         | nothing   | nothing            |
| Optional              | Photos & publish while Details, Ingredients or Steps is not complete                                                                                        | `inkMuted` "Optional"                                                                                                                                            | nothing   | nothing            |
| Complete              | the section has what it needs. Photos & publish is complete once the other three are                                                                        | `ink` ✓, **no colour and no word** (GOV.UK task list: done is quiet, so the rows that need action stand out). Photos & publish shows "Ready to publish" in `ink` | ✓         | nothing            |

What "complete" means: Details has a title within its limit. Ingredients has at least one line, and every line has a
food. Steps has at least one step with text. These are the validator's own rules, read, not restated.

**Current section** is a position, not a status, so it stacks with any status: a 3 px `hereBar` on the row's start
edge (rail, sheet) or under the label (strip), the label in `ink` at 600, and `aria-current="location"` (not `step`:
the cook is not forced through an order).

**Guided progress** (the account has never published a recipe, owner D1):

- Each rail and sheet row shows a one-line hint under its label: "Name it and say how long it takes" · "Add what
  goes in" · "Say how to make it" · "Add a photo, then publish".
- Details shows "Start here" as its status until something is typed.
- The rail foot shows "{done} of 4 done", counting only real Complete statuses. The bar adds " · {done} of 4 done"
  after the section label.
- Order is a suggestion, never a gate: every section is reachable at any time. After the first publish, the hints
  and the count never show again.

**Tracking the current section while scrolling:**

- The activation line sits at the bottom of the sticky chrome plus 25% of the remaining viewport height. The current
  section is the last one whose H2 is above that line. At the end of the page, the last section is current.
- Web: one `IntersectionObserver` over the four H2s, `rootMargin` from the measured chrome. No scroll listener.
- Native: each section reports its top through `onLayout`. The scroll view's `onScroll` (`scrollEventThrottle={16}`)
  compares. State changes only when the computed section changes.
- The strip and the bar keep the current item in view inside their own row. They never scroll the page sideways.
- **No announcement while scrolling.** Only a status change caused by the cook's own action is announced, politely:
  "Ingredients complete", "Photos and publish ready".

**Activating a section** (click, tap, Enter):

1. The phone sheet closes first.
2. The page scrolls so the H2 sits under the sticky chrome (`scroll-margin-top` = chrome + 16 on each H2; native
   `scrollTo({ y: offset - chrome - 16 })`). Smooth by default. **Instant under reduced motion** (D2): web
   `prefers-reduced-motion: reduce`, native `AccessibilityInfo.isReduceMotionEnabled()`.
3. Focus moves to the H2 (`tabindex="-1"`, `focus({ preventScroll: true })`). Native:
   `AccessibilityInfo.setAccessibilityFocus` on the heading.
4. Web: `history.replaceState` writes the hash, so a reload keeps the place and browser Back still leaves the editor.

**Semantics:** `nav` named "Recipe sections" holding an ordered list of links (`href="#ingredients"`). A link's
name is its label, which is the exact H2 text. The status and reason are linked with `aria-describedby`. The phone
bar is one `button` with `aria-expanded` and `aria-haspopup="dialog"`, named "Sections. Current: Ingredients. 2 need
attention." The sheet uses `@commise/ui/sheet` (focus moves in, is trapped, Escape and Back close it).
`scrollsToTop={false}` on the strip and the sheet (§3.6).

**Keys** (NEW, `editor/messages.ts`): `index.label` "Recipe sections", `index.sheetTitle` "Sections",
`index.sections.details` "Details", `.ingredients` "Ingredients", `.steps` "Steps", `.photos` "Photos & publish",
`.photosShort` "Photos", `index.status.fix` "Fix {count, plural, one {# thing} other {# things}}", `.attention`,
`.inProgress`, `.notStarted` "Not started", `.optional` "Optional", `.ready` "Ready to publish", `.startHere` "Start
here", `index.done` "{done} of 4 done", `index.hint.details` … `index.hint.photos`, `index.barName`.

### 7.3 Saving: autosave, drafts and versions (D1)

- **No stored recipe before the first input.** Opening "New recipe" and leaving creates nothing, so no empty drafts
  pile up in My recipes.
- **New recipe or draft (never published):** saves itself 1 s after typing stops, when a field loses focus, when the
  current section changes, and when the app goes to the background or the tab hides. Every write goes through the
  offline write port.
- **Published recipe:** edits save **to the device only**, at the same moments. **Save changes** writes one new
  version. A cook who leaves keeps the device changes. Reopening Edit restores them with an inline notice: "You have
  changes from {time} that aren't saved to your recipe." with **Save changes** and **Discard** (a confirm dialog).
- **Save status** (header, `caption`, never wraps, truncate:1):

| Status                         | When                                       | Announced           |
| ------------------------------ | ------------------------------------------ | ------------------- |
| (nothing)                      | new recipe, nothing typed                  | no                  |
| "Saving…"                      | a write is in flight                       | no                  |
| "Saved"                        | the draft reached the server               | no                  |
| "Saved on this device"         | the draft is queued in the write port      | no                  |
| "Changes saved on this device" | a published recipe has device-only changes | no                  |
| "Couldn't save. Retrying."     | a write failed and is retrying             | yes, politely, once |

- **Discard draft / Discard changes** (⋯): a `ConfirmDialog`. "Discard this draft?" / "Discard your changes?" with
  **Discard** (filled `error`) and **Keep editing** (secondary). Focus opens on Keep editing.
- Keys (NEW, `editor/messages.ts`): `status.saving`, `.saved`, `.savedOnDevice`, `.changesOnDevice`, `.saveFailed`,
  `resume.body`, `resume.save`, `resume.discard`, `discard.draftTitle`, `.changesTitle`, `.confirm`, `.keep`.

### 7.4 Details section

| Group (H3, `label`, `inkMuted`) | Field               | Spec                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| About the recipe                | Title               | auto-growing `TextArea`, up to 3 lines, Enter blocked. **Soft limit 120:** no `maxLength`. A counter "{n}/120" in `caption` shows from 100. Past 120 the counter turns `danger`, the field gets `aria-invalid`, and "Shorten the title to 120 characters or fewer." shows under it. It blocks Publish, never typing. Nothing is cut silently (fixes F4) |
|                                 | Description         | auto-growing `TextArea`, 4 rows minimum, counter from 80% of its existing cap                                                                                                                                                                                                                                                                           |
| Time and servings               | Servings            | `Stepper`, min 1                                                                                                                                                                                                                                                                                                                                        |
|                                 | Prep, Cook          | `DurationField` each, empty by default, never "0"                                                                                                                                                                                                                                                                                                       |
|                                 | Total               | computed text "Total 5 h 30 min" in `meta`, hidden while both are empty                                                                                                                                                                                                                                                                                 |
| Kind of dish                    | Cuisine             | `Combobox` (existing, `ui/src/combobox/`)                                                                                                                                                                                                                                                                                                               |
|                                 | Meal type           | `Chip kind="filter"`, `ChipRow overflow="wrap"` up to 3 lines (every option stays visible in a form)                                                                                                                                                                                                                                                    |
|                                 | Difficulty          | Easy · Medium · Hard as `Chip kind="choice"` toggles with `aria-pressed`. Nothing pressed means "not stated". Pressing the pressed one clears it. No "Not stated" chip                                                                                                                                                                                  |
| Diet and tags                   | Dietary flags, Tags | chip input. "Add a tag" with Enter or comma. Each added tag is a `Chip kind="input"` named "Remove {tag}"                                                                                                                                                                                                                                               |

- Layout: below 600, Prep and Cook sit side by side (about 136 px each at 320). Everything else is full width. From
  600, Servings, Prep and Cook share one row, and Cuisine and Meal type sit side by side.
- Every field has a visible `FieldLabel`. Placeholders are examples only (SC 3.3.2).
- No intro card on either platform.

### 7.5 Ingredients section

#### 7.5.1 The read row

```
 2–2.5 kg   Lamb shoulder, bone-in · trimmed of excess fat                       ⋯
 2          Preserved lemons · rind only, finely chopped                         ⋯
 500 g      Chicken thighs, boneless skinless · roasted                          ⋯
            ⚠ Choose a match
```

- **Amount first, in a fixed column:** 72 px below a 600 container, 96 px from 600, in `figure-inline` 600. "12–14 tbsp"
  fits 96. No amount: the column is empty (never an invented "1", F5).
- **Name and prep** together: the name in `ink`, then " · " and the prep in `inkMuted`, clamped to 2 lines, then
  truncate. The full text is in the open editor and in the row's name.
- **A healthy row is quiet:** no status glyph (owner, overturning `ingredientStatusExplanation.md` §3a). A row that
  needs action adds a second line in `attention` with ⚠ and the state word. That line is a button that opens the
  existing shortlist or panel.
- **⋯** (44 × 44, "Actions for {food}"): Edit · Food details · Change food · Move to group… · Move up · Move down ·
  divider · Remove. Remove is never a row button.
- Row: min-height 48 for one line, 64 for two. Hairline `lineDivider` between rows.
- Semantics: a `list` named "Ingredients". The row's open target is a button named "Edit {amount} {food}". Removing a
  row moves focus to the next row (existing `removalFocusTarget.ts`).

**Row states** (the panel contents stay as `ingredientStatusExplanation.md` §SPECIFY.1):

| State                     | Second line                | ⋯ beyond the base items    |
| ------------------------- | -------------------------- | -------------------------- |
| Resolved                  | none (quiet)               | Food details · Change food |
| Resolved, no figures      | none                       | Change food                |
| Reading (just pasted)     | spinner + "Reading…"       | none                       |
| Looking it up             | spinner + "Looking it up…" | none                       |
| Needs a choice            | ⚠ "Choose a match"         | none                       |
| Not resolved              | ⚠ "No match found"         | Change food                |
| Lookup failed             | ⚠ "Couldn't look up"       | Change food                |
| Food removed              | ⚠ "Food no longer listed"  | Change food                |
| Busy (a commit in flight) | unchanged                  | ⋯ `aria-disabled`          |

#### 7.5.2 The row editor

- **Below a 600 container:** a content-height bottom sheet (`Sheet size="content"`). The list stays still, and the
  sheet lifts the fields above the keyboard. **Done** (primary, `check`, fill) is pinned above the keyboard.
- **From 600:** inline under the row, `pearl` at 60%, radius `md`, padding 16. One editor open at a time: opening
  another closes the first and keeps its values. **Done** is a secondary button.
- Content, top to bottom:
    - the food as one line with **Change** (ghost): "Lamb shoulder, raw · 282 cal per 100 g · USDA".
    - `FieldLabel` "Amount": a 64 px number field. "+ Add a range" (ghost) reveals "to" and a second field. With a
      range it becomes "Remove range".
    - "Unit": a `Combobox`, 112 px.
    - "Preparation": fills the rest, at least 160 px.
    - "Food details" (ghost) opens the existing details panel (nutrition, variants, candidates).
- Layout from 600: Amount, Unit and Preparation on one line. Below 600 (the sheet): Amount and Unit on line 1,
  Preparation full width on line 2.
- Escape or Done closes it. Focus returns to the row. No group field (groups are set at the section level).

#### 7.5.3 The add field (quantity first, food always picked)

```
Add an ingredient
[ 2 tbsp olive oil, for frying                                   ]
  2 tbsp · olive oil · for frying                                      ← the live reading (caption)
  ┌──────────────────────────────────────────────┐
  │ Olive oil                          USDA      │                      ← foods searched with "olive oil" only
  │ Olive oil, extra virgin            USDA      │
  │ Search for another food                      │
  └──────────────────────────────────────────────┘
```

- `FieldLabel` "Add an ingredient", hint "Type the amount first, then pick the food. For example: 2 tbsp olive oil."
- As the cook types, a **leading-measure reader** splits off the amount (a number, fraction, unicode fraction or range)
  and a **known unit**. Text after the first comma is the preparation. The rest is the food search. The reader's home
  is the architect's call (§12).
- The live reading shows under the field as one `caption` line ("2 tbsp · olive oil · for frying"). Its accessible
  text names the parts: "Amount 2, unit tablespoons, food olive oil, preparation for frying." It updates politely after
  a 500 ms pause, never per keystroke.
- **The food is always picked from the list** (owner). The list is the existing `Combobox` popup with
  `rowEditorOpenDecisions.md` V3-1 to V3-4 (popup side, chrome insets, a 3-option floor, the active-option ring). Its
  last option is "Search for another food" (`ocean-dark` text, one line).
- Picking (tap, or arrow keys and Enter) commits the row with its amount, unit and preparation already set. Focus
  returns to the empty add field. The loop is type → pick → type → pick.
- Enter with no option active does nothing but show "Pick a food from the list." under the field. No line is ever
  stored as free text.
- No measure ("salt"): the whole text is the search, and the row has no amount.
- The amount and unit the cook typed are the cook's own statement. Nothing later overwrites them (§12 confirms).
- Each group ends with its own add field, labelled "Add to {group}".

#### 7.5.4 Paste a list

- A ghost **Paste a list** (`clipboard-paste`) in the section heading row. In the empty section it is a secondary
  button beside the add field.
- It opens a sheet (a 640 px dialog at 840+): title "Paste a list". `FieldLabel` "Ingredient lines", hint "One
  ingredient per line. You can add the steps next." A `TextArea` in Inter (not monospace), 10 rows minimum, 72ch
  maximum. Under it a live count "9 lines" (`figure`).
- Primary **Add {n} ingredients** (ICU). Disabled while there are 0 lines.
- On press, the sheet closes, the lines go to the existing parse job, and each line appears at once as a row in the
  "Reading…" state. Each then settles into a read row state. A line that needs a food shows "Choose a match" or "No
  match found". A parse binds nothing by itself (R19).
- Home's first-run **Paste ingredients** opens a new editor scrolled to Ingredients with this sheet open.
- The `/recipes/parse` pages retire in the same slice (§13). The dead end (F6) cannot exist, because the flow ends
  inside the recipe.

#### 7.5.5 Groups

- An ungrouped recipe shows no group chrome.
- "+ Add a group" (ghost) at the section foot asks for a name in an inline field and creates an empty group with its own
  add field.
- A group heading is an H3 in `label`, `inkMuted`, with its own ⋯: Rename group · Add ingredient to this group · Remove
  group (keep its ingredients).
- Move a row: ⋯ → Move to group… → a sheet listing the groups and "No group".
- The data model is unchanged: each line keeps its own `section` value.

#### 7.5.6 Nutrition total

- At the foot of the section at every width, and also at the rail foot at `@wide`: "612 cal per serving · 7 of 9
  counted" (`figure` for numbers).
- Nothing counted: "Nutrition appears as you match ingredients." **Never "0 cal"** (F7).
- Loading: skeleton text. Failed: "We couldn't load nutrition." + **Try again**.

### 7.6 Steps section

- A numbered list, not cards. Each step: the 32 px numeral (`selectedFill` circle, `ink`), the visible label "Step
  {n}", then an auto-growing `TextArea`, 2 lines minimum, `body`, the **full column width** at every size (I1, I2).
- "+ Add a timer" (ghost, `timer`) reveals a `DurationField` labelled "Timer". With a timer set, "Remove timer" (ghost)
  sits beside it.
- ⋯ per step: Move up · Move down · divider · Remove step (SC 2.5.7: moving without drag).
- **+ Add step** (secondary, `plus`) at the end. The new step's field takes focus. Enter inserts a line break. On web,
  Ctrl or Cmd + Enter adds a step.
- **Paste steps** (ghost, `list-plus`) in the heading opens a sheet like Paste a list. It splits at blank lines and at
  leading numbers ("1.", "2)") with a pure function. Primary **Add {n} steps**.
- Empty: "No steps yet." + **Add step**. Publish refused: "Add at least one step." under the H2, linked to the first
  field.

### 7.7 Photos & publish section

1. **Photos:** a grid of 1:1 tiles, 3 columns below 600, 4 above. The first tile is labelled "Cover". Each tile's ⋯:
   Set as cover · Move earlier · Move later · divider · Remove. **Add photos** (secondary, `image-plus`): native opens
   a sheet with "Take photo" and "Choose from library". Web opens a multi-select file input. Drag and drop is an extra
   on a fine pointer, never the only way (SC 2.5.7). Empty: a `RecipeCover` preview of this recipe and "No photo? This
   cover is used instead. Add one any time."
2. **Who can see it:** a radio group of two 56 px cards, **Public** ("Anyone can find it in Discover") and
   **Private** ("Only you can see it"). The default stays as it ships today. For a free-tier cook, Private shows a
   `premium` "Premium" badge, and choosing it opens the upsell sheet (§6.4 pattern). Nothing is pre-selected by the
   upsell.
3. **Ready line:** "Ready to publish." or "Fix {n} things to publish." (`meta`). The second is a link that activates
   the first section that needs it.
4. **Preview** lives in the `ActionBar`. It opens the real detail page in a full-height sheet with the banner
   "Preview. This is how it looks to others." It shows ranges correctly by construction (F3).

### 7.8 Publish, save changes and errors

- **Publish** runs the validator. Refused: each error shows at its field (`danger` border, the message under it in
  `label`, linked by `aria-describedby`). The section index switches those sections to "Fix before publishing". Focus
  moves to the first invalid field, scrolled under the chrome. A polite line in the `ActionBar` says "Fix {n} things
  to publish" (SC 3.3.1, 3.3.3).
- **Publishing:** the primary shows its spinner and the bar locks.
- **Published:** the detail page opens. After a recipe's first publish, the snackbar says "Recipe published." with
  **Add to a collection** (§6.4). After a later publish, "Recipe published." alone.
- **Save changes:** writes one version, then the detail page opens with "Changes saved."
- **Failure:** an inline alert above the `ActionBar`: "We couldn't publish. Your recipe is kept on this device. Try
  again." The device copy stays.
- **Conflict (409):** the existing conflict view (`features/recipes/src/versions/`).

### 7.9 Editor states

| State                              | Shown                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| New, empty                         | every section visible and empty, each with one line of help. No "0" anywhere. Guided progress if it is the first recipe |
| Loading (edit)                     | section skeletons at their real heights                                                                                 |
| Device changes waiting (published) | the resume notice (§7.3)                                                                                                |
| Saving, saved, save failed         | the save status (§7.3)                                                                                                  |
| Publish refused                    | field errors + index statuses + the bar line (§7.8)                                                                     |
| Publishing                         | primary busy, bar locked                                                                                                |
| Conflict                           | the existing conflict view                                                                                              |
| Offline                            | identical behaviour. The save status reads "Saved on this device" until the write port drains                           |
| Ingredient line states             | §7.5.1                                                                                                                  |

### 7.10 Editor accessibility contract

- **Headings:** the header title ("New recipe" or "Edit recipe", styled `barTitle`) is the visible H1. H2 per
  section. H3 per Details group and per ingredient group.
- **Tab order** (DOM = visual): header (× · ⋯) → section index (one stop per section from 600, one stop for the bar
  below 600) → the form, section by section → `ActionBar` (Preview, primary).
- **Focus not obscured (SC 2.4.11):** `scroll-padding-top` = the header + section bar height. `scroll-padding-bottom`
  = the `ActionBar` height + 16 (W3C technique C43). Native: `KeyboardAvoider` plus `scrollIntoView` with `block:
'nearest'` on focus.
- **Targets:** rail rows ≥ 48, sheet rows 56, strip items 44 tall, the bar 44, every row ⋯ 44.
- **Live regions:** save failures, section status changes caused by the cook, "Fix {n} things to publish", the paste
  count after a pause, "Added {n} ingredients".
- **Dialogs and sheets:** focus moves in and is trapped. Escape and Back close. Focus returns to the trigger, except
  after a section jump, where it moves to the H2.

### 7.11 Editor keys

All NEW in `editor/messages.ts` unless named:

| Key                                                                                                                     | String                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `titleCreate` / `titleEdit`                                                                                             | New recipe / Edit recipe                                                                                                                |
| `close`                                                                                                                 | Close editor                                                                                                                            |
| `more`                                                                                                                  | More editor actions                                                                                                                     |
| `preview` / `previewBanner`                                                                                             | Preview / Preview. This is how it looks to others.                                                                                      |
| `publish` / `saveChanges`                                                                                               | Publish / Save changes                                                                                                                  |
| `fixCount`                                                                                                              | Fix {count, plural, one {# thing} other {# things}} to publish                                                                          |
| `ready`                                                                                                                 | Ready to publish.                                                                                                                       |
| `published` / `addToCollection` / `changesSaved`                                                                        | Recipe published. / Add to a collection / Changes saved.                                                                                |
| `publishFailed`                                                                                                         | We couldn't publish. Your recipe is kept on this device. Try again.                                                                     |
| `details.titleLimit`                                                                                                    | Shorten the title to 120 characters or fewer.                                                                                           |
| `ingredients.addLabel` / `.addHint`                                                                                     | Add an ingredient / Type the amount first, then pick the food. For example: 2 tbsp olive oil.                                           |
| `ingredients.pickFood`                                                                                                  | Pick a food from the list.                                                                                                              |
| `ingredients.reading`                                                                                                   | Amount {amount}, unit {unit}, food {food}, preparation {prep}                                                                           |
| `ingredients.pasteList` / `.pasteTitle` / `.pasteLabel` / `.pasteHint` / `.pasteCount` / `.pasteAdd`                    | Paste a list / Paste a list / Ingredient lines / One ingredient per line. You can add the steps next. / {n} lines / Add {n} ingredients |
| `ingredients.addToGroup`                                                                                                | Add to {group}                                                                                                                          |
| `steps.label` / `.addTimer` / `.removeTimer` / `.timerLabel` / `.add` / `.paste` / `.pasteAdd` / `.empty` / `.required` | Step {n} / Add a timer / Remove timer / Timer / Add step / Paste steps / Add {n} steps / No steps yet. / Add at least one step.         |
| `photos.add` / `.cover` / `.empty`                                                                                      | Add photos / Cover / No photo? This cover is used instead. Add one any time.                                                            |
| `visibility.legend` / `.public` / `.publicHint` / `.private` / `.privateHint`                                           | Who can see it / Public / Anyone can find it in Discover / Private / Only you can see it                                                |

Row keys, in `form/messages.ts` (NEW unless named): `rowState.chooseMatch` "Choose a match", `.noMatch` "No match
found", `.lookupFailed` "Couldn't look up", `.foodRemoved` "Food no longer listed", `.reading` "Reading…",
`.lookingUp` "Looking it up…". `row.amountLabel` "Amount", `.unitLabel` "Unit", `.prepLabel` "Preparation",
`.addRange` "Add a range", `.removeRange` "Remove range", `.done` "Done", `.change` "Change", `.foodDetails` "Food
details", `.moveToGroup` "Move to group…", `.moveUp` "Move up", `.moveDown` "Move down". `group.add` "Add a group",
`.rename` "Rename group", `.remove` "Remove group (keep its ingredients)". `statusActionNoneOfThese` → "Search for
another food". `nutritionEmpty` "Nutrition appears as you match ingredients.", `nutritionCounted` "{cal} cal per
serving · {counted} of {total} counted". `stepTimerLabel` (`form/messages.ts:686`, today "Step {number} timer
(seconds)") is replaced by `editorMessages.steps.timerLabel`.

### 7.12 Editor: web and native translation

| Element                  | Web                                                           | Native                                                      | Disposition        | Why                                                                        |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| Section index            | rail ≥ 960 container, strip 600–959, bar + sheet < 600        | the same by window width (rail on a wide tablet)            | collapsed by width | a rail starves a narrow form, and a strip cannot show four sections at 320 |
| Current-section tracking | `IntersectionObserver`                                        | `onLayout` + throttled `onScroll`                           | translated         | platform APIs                                                              |
| Section jump             | `scroll-margin-top`, focus to the H2                          | `scrollTo`, accessibility focus to the H2                   | translated         | same job                                                                   |
| Row editor               | inline from 600, sheet below                                  | sheet on phone, inline on tablet                            | translated         | the keyboard and the thumb                                                 |
| Row reorder              | ⋯ Move up / down. No drag                                     | the same                                                    | kept               | SC 2.5.7                                                                   |
| Paste                    | sheet                                                         | sheet, the system paste menu in the field                   | kept               | same job                                                                   |
| Add photos               | file input, drag and drop on a fine pointer                   | "Take photo" / "Choose from library"                        | translated         | the camera                                                                 |
| Add step shortcut        | Ctrl/Cmd + Enter                                              | none                                                        | dropped on native  | no hardware keyboard by default                                            |
| Hover                    | `pearl` tint on rows                                          | pressed state                                               | translated         | no hover on touch                                                          |
| Back                     | browser Back leaves the editor (the hash uses `replaceState`) | Android Back and iOS edge swipe leave it. Nothing is lost   | kept               | §7.3                                                                       |
| Primary action           | `ActionBar`, bottom end                                       | `ActionBar`, bottom end, above the keyboard until it unpins | kept               | thumb zone, reading order                                                  |

---

## 8. Sign in and sign up

FR-045a holds: sign-in **is** the front door. Nothing stands in front of it. Files: `web/src/app/[locale]/sign-in/`,
`sign-up/`, `ui/src/clerk.ts`. Native: `mobile/src/screens/login.tsx`, `signup.tsx`.

```
phone (< 480 viewport)              480–1023: card                   ≥ 1024 viewport: split
┌──────────────────────────┐        ┌──── canvas wash ────┐          ┌───────────────────┬─────────────────────┐
│ [mark] Commise           │        │ ┌── 440 card ─────┐ │          │ food photograph   │ [mark] Commise      │
│ Sign in to Commise   H1  │        │ │ same form       │ │          │ (decorative,      │ Sign in to Commise  │
│ Your recipes, in one     │        │ └─────────────────┘ │          │  object-fit cover)│ Your recipes, in…   │
│ place.                   │        └─────────────────────┘          │                   │ [G Continue with…]  │
│ [ G  Continue with Google ]│                                        │                   │ ── or ──            │
│ ─────────── or ───────── │                                        │                   │ Email [          ]  │
│ Email                    │                                        │                   │ [    Continue    ]  │
│ [                      ] │                                        │                   │ New to Commise?     │
│ [        Continue      ] │                                        │                   │ Create an account   │
│ New to Commise? Create an│                                        └───────────────────┴─────────────────────┘
│ account                  │
└──────────────────────────┘
```

- **Below 480 viewport:** no card. The form sits full-bleed on the canvas with 24 px side padding (a 272 px column at
  320). One change in `clerkAppearance` (`ui/src/clerk.ts`): responsive card padding and a full-bleed card below 480,
  passed as class strings through Clerk's `appearance.elements` (fixes E23). Verify in a real `next build` at 320.
- **480–1023:** a 440 px `paper` card centred on the canvas wash.
- **1024 and wider (viewport):** a 50/50 split. The start half is a food photograph from `docs/mockups/_assets/`
  (`aria-hidden`, `object-fit: cover`). The end half holds the form, 400 px max, centred in its half. This is the
  sign-in surface itself, not a welcome screen.
- **Order:** mark → H1 "Sign in to Commise" (`largeTitle` 28, wrap:2, Clerk's `signIn.start.title`) → the brand line
  "Your recipes, in one place." (`body`, `inkMuted`, NEW `auth.brandLine` in `webMessages` and `mobileMessages`) →
  **Continue with Google** (secondary, Google mark) → "or" divider → Email → **Continue** (primary, `lg`, fill) →
  "New to Commise? Create an account". The link text never breaks across lines (the one permitted inline `nowrap`).
  It is the only way to sign up, so it must stay (FR-045a).
- **Inside Clerk's form:** inputs 48 px with 12 px radius, the primary in `action`, the focus ring in `focusRing`.
- **Sign-up** asks for email and password, plus Google. Username off, first and last name off (Clerk dashboard
  settings, no code).
- **Verification code:** one 6-digit field with `autocomplete="one-time-code"` and `inputmode="numeric"`, not six boxes
  (SC 3.3.8 favours letting the OS fill it).
- **Native:** the same order and copy on `@commise/ui/input`. The primary is pinned above the keyboard
  (`KeyboardAvoider`). Email: `autoComplete="email"`, `textContentType="username"`. Password: `"password"` on sign-in,
  `"newPassword"` on sign-up. Code: `textContentType="oneTimeCode"`. Password managers and paste work (SC 3.3.8).
- **States:** wrong password (Clerk's inline error under the field, focus moves to it) · network error: an alert
  above the button, "We couldn't reach the sign-in service. Check your connection and try again." (NEW
  `auth.networkError`) · busy (the button's spinner, the form locked) · too many attempts (Clerk's) · a signed-out
  deep link returns to its destination after sign-in.
- When Plan ships, the brand line becomes the mockup's "Cook with confidence. Plan with ease."

---

## 9. Profile, legal sources and the 404

### 9.1 Profile (one page, from the avatar)

```
phone 390, and 840+ in content-reading (640), left-aligned
┌──────────────────────────────────┐
│ (‹) Profile                  H1  │
│ (EM) Eliza Moreno                │ 72 avatar, name, email
│      eliza@example.com           │
│ ┌──────────────────────────────┐ │
│ │ Display name      Eliza    › │ │ grouped rows, 56 px
│ │ Email             eliza@…    │ │
│ └──────────────────────────────┘ │
│ Preferences                      │
│ ┌──────────────────────────────┐ │
│ │ Food data sources          › │ │
│ │ Keyboard shortcuts      [on] │ │ web only
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Sign out                     │ │ ink, not red
│ └──────────────────────────────┘ │
│ Danger zone                      │
│ ┌──────────────────────────────┐ │
│ │ Close account              › │ │ danger text + hint
│ │ Erase my data              › │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

- One page, one column at every width, `content-reading`. No section nav. `/settings` and `/account` are deleted
  (§3.1). Native: `AccountSettings.tsx` becomes these sections, and `AppRoot`'s `'account'` destination goes.
- Header: back "Back to {parent}" on phones (Profile is pushed). H1 "Profile". Then a 72 px avatar (initials, or the
  native `AvatarField` photo, which stays native-only), the display name (`sectionTitle`, wrap:2) and the email
  (`meta`, `overflow-wrap: anywhere`, because it is one unbroken string).
- **Grouped rows** (56 px, label, value truncate:1, chevron), the settings-list pattern both platforms use:
    - **Display name** opens a sheet titled "What should we call you?" with one field, prefilled from the Google given
      name when Clerk has it, and **Save** (primary). It saves only on Save, because the name can show publicly as an
      author handle. This is the only place the app asks for it. Until it is set, the Home greeting has no name.
    - **Email**: read-only value.
    - **Preferences:** "Food data sources" → `/legal/sources`. **Keyboard shortcuts** (web only): a switch, on by
      default. Off, `/` types a slash like any other key (SC 2.1.4).
    - **Sign out**: a row button in `ink`, not red (it is not destructive). It issues `useSignOutAndLeave()` exactly as
      today (ADR-0009).
    - **Danger zone** (H2): **Close account** and **Erase my data** in `danger` text, each with a hint in `caption`
      ("Signs you out and deactivates your account. Support can restore it." · "Permanently deletes your account and
      personal data."). They keep their existing dialogs and flows (CR-002, U4b).
- **States:** loading: the header skeleton, and the groups still render. Read failed: "We couldn't load your profile."
    - **Try again** in the header area. Sign out and the danger zone still work (E15). Saved: a snackbar "Saved." Suspended
      or closed account: the existing `AccountStateNotice` at the top.
- Keys (NEW in `webMessages` and `mobileMessages` unless noted): `profile.title`, `.displayName`, `.namePrompt` "What
  should we call you?", `.save`, `.saved`, `.email`, `.preferences`, `.dataSources`, `.shortcuts` "Keyboard
  shortcuts", `.signOut` "Sign out", `.dangerZone` "Danger zone", `danger.close.rowHint`, `danger.erase.rowHint`,
  `profile.retry`. `loadError` (existing) keeps its value.

### 9.2 Legal sources

`content-reading`, back to Profile, H1 "Data sources" (`largeTitle`, wrap:2). Each source card: H2 publisher, the
dataset name in `body` 600, then a `dl`. Below 600 each `dt` stacks above its `dd`. From 600, two columns (`dt` 120 px).
External links show "↗" and carry the visually hidden text "(opens in a new tab)", and they open in a new tab (E33).

### 9.3 The 404 and the crash page

The branded 404 ships in slice 0, so this file does not re-spec it. Later slices only move it onto the new tokens,
type roles and the empty-plate drawing. The crash page is §3.8.

---

## 10. Accessibility contract, every screen (WCAG 2.2 AA)

| Topic                             | Rule                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headings                          | One H1 per page, always visible (the editor's is its header title). H2 for sections and rails. H3 for card titles inside a sectioned page and for groups. No skipped level            |
| Landmarks                         | `main`. Sidebar and tab bar are `nav` with different names ("Main", "Tabs"). The filter panel is an `aside` named "Filters". Reading-page section bars are `nav`s named for their job |
| Route change                      | focus moves to the page H1 (`headingRef`). Document title "{page} · Commise"                                                                                                          |
| Dialogs and sheets                | focus moves in and is trapped. Escape and Back close. Focus returns to the trigger. Swipe-to-dismiss always has a Close button and a scrim tap too (SC 2.5.7)                         |
| Live regions                      | polite: result counts, add / remove / undo, save failures, scaled amounts, section status changes. `role="alert"` only for errors. Nothing speaks while the cook types or scrolls     |
| Targets                           | 44 × 44 pt iOS, 48 × 48 dp Android, 44 × 44 CSS px on a coarse pointer, 24 × 24 CSS px minimum on a fine pointer (SC 2.5.8)                                                           |
| Contrast                          | text ≥ 4.5:1, large text and UI boundaries ≥ 3:1. Every new pair is in §1.4 and §1.8. Disabled controls are exempt (SC 1.4.11)                                                        |
| Colour alone                      | never. Selected = tint + edge + check. Difficulty = tint + meter + word. Status = icon + word. Current = bar + weight                                                                 |
| Focus visible                     | the 2 px `focusRing` with a 2 px offset on every focusable element, drawn inside list rows                                                                                            |
| Focus not obscured (2.4.11)       | every page with sticky chrome sets `scroll-padding-top` and `scroll-padding-bottom` to the chrome heights (C43). The tab bar, the `ActionBar`, the FAB and `BackToTop` all count      |
| Reflow (1.4.10)                   | no horizontal page scroll at 320 CSS px on any screen, loading or loaded. Rails and chip rows scroll inside themselves                                                                |
| Text spacing (1.4.12)             | no fixed heights on text containers. Rows and cards use `min-height`                                                                                                                  |
| Zoom (1.4.4)                      | usable at 200%. At 200% on a 1280 window, `<main>` falls to `@narrow` and the page takes its phone layout. Native Dynamic Type and font scale to 200% reflow the same way             |
| Orientation (1.3.4)               | every screen works in both orientations                                                                                                                                               |
| Character shortcuts (2.1.4)       | `/` focuses the page's search field on web (My recipes, Discover, Collections from 6). Profile › Keyboard shortcuts turns it off. It never fires inside a text field                  |
| Dragging (2.5.7)                  | no task needs a drag. Reorder by Move up / Move down                                                                                                                                  |
| Accessible authentication (3.3.8) | paste, password managers and the one-time-code autofill work                                                                                                                          |
| Reduced motion                    | §1.9 lists the reduced path for every moment. Section jumps are instant                                                                                                               |
| Hover and focus content (1.4.13)  | tooltips (collapsed sidebar) show on hover and focus, dismiss with Escape, and stay while hovered                                                                                     |

---

## 11. Settled here

These are calls the earlier files left open or got wrong. Each was settled by me, with the reason.

1. **Viewport classes 600 / 840 (Android's window size classes), the sidebar expanded by default.** At 840 the
   sidebar leaves `<main>` 584 px, and the container rules give it the `@narrow` layout. A collapsed default would
   make "New recipe" icon-only, against the labelled-entry rule.
2. **Lucide's default 2 px stroke, and ⋯ for every "more" menu.** The default needs no per-call prop and keeps native's
   Feather geometry. One glyph for one meaning (Nielsen #4).
3. **No-photo cover = a monogram on six hash-chosen tints.** The card title sits right under the cover, so a full-title
   cover says it twice. The tints keep photo-less recipes apart.
4. **A checked ingredient dims, with no strike-through.** A cook re-reads a checked amount mid-recipe. Strike-through
   damages the word shape.
5. **Rail cards `clamp(240px, 78%, 256px)`.** Fixed 256 peeks only 16 px at 320. The floor keeps the card at the grid
   variant's 240 minimum, and the cap keeps cards equal from 390 up.
6. **Recipe detail stays two columns in `content-detail` (1152) at every wide width.** A third column is one more layout
   to build and test for no task gain. Empty space beside a readable measure is correct.
7. **On phone web, top-level large titles scroll away. Pushed screens and all native screens condense into a bar.**
   The tab bar already orients a top-level page. A pushed screen needs Back in reach.
8. **First run: one primary ("Add your first recipe"), "Paste ingredients" secondary, a Discover link. The name prompt
   lives only on Profile.** Paste fills only ingredients today, so it cannot lead. A card on Home makes a second live
   widget (FR-046).
9. **The FAB hides while a first-run block shows.** The wireframe rule (`recipe-list.md`): the empty state carries its
   own create buttons. Two identical controls on one screen is noise.
10. **Discover no-results shows tag chips, then the Trending rail.** Both are the corpus's zero-results answers. Chips
    hide below 3 tags.
11. **The card's Save a copy snackbar offers Edit, not View.** A copy needs a real edit before it can be published
    (FR-005b), so Edit is the next useful step.
12. **SectionIndex statuses:** GOV.UK's quiet complete (owner D2's basis), A's "Fix before publishing" plus B's "In
    progress". Guided progress uses hints and a done count, not numbered items. The phone bar is 44 px (HIG), not 40.
13. **One "you are here" marker: the 3 px seafoam `hereBar`** on the tab bar, sidebar, section index and current step.
    One cue for one meaning.
14. **Back to top:** a page taller than 4 viewports, scrolled past 4, last scroll upward, on web at every width. That is
    D3 read against NN/g's own rule.
15. **The editor form is `content-list` (768) wide.** It holds the ingredient row's amount, name and prep on one line.
16. **"Paste steps" is a visible button**, not an offer that appears on paste. A signifier beats a hidden behaviour,
    and it handles numbered lists.
17. **The editor's nutrition total sits at the Ingredients foot and the rail foot, not in the `ActionBar`.** At 320 the
    bar cannot hold two buttons and the total without a wrap.
18. **No separate "Before you publish" checklist.** The section index already is that checklist, from the same
    validator. Two lists of one fact drift.
19. **Home uses compact cards at every width** (2 columns below 600, 4 from 600). A full grid card needs 240 px, and
    four of them do not fit at 720. Home is for recognition. The library keeps the full field set. ⚠️ The owner
    ruled the compact grid for phones only. Using it at every width departs further from CR-002, so it needs the
    owner's confirmation. The fallback is full grid cards from a 960 container.
20. **Discover results use compact cards 2-up below 600**, with the author and the Save a copy icon.
21. **Tags on cards and on detail are text, `Chip` has no tag kind, and status badges are radius `sm`.** The owner's
    shape rule: only pressable things are pills.
22. **Detail uses the stat strip, not the glance line.** The mockup draws stat cells, and the mockups are the floor.
23. **Discover offline shows the ordinary search error.** "Search needs a connection" is a connectivity branch, which
    the owner's offline directive forbids.
24. **× in the editor never asks.** Drafts save themselves and a published recipe's changes stay on the device, so
    nothing is ever lost. Discard is an explicit ⋯ action with a confirm.
25. **In the add field, text after the first comma is the preparation, and Enter without a pick commits nothing.** The
    owner's ruling says the food is always picked.
26. **Own recipe: "Edit recipe" is the primary on detail** until the cook view ships and "Start cooking" takes it.
27. **`Button.icon` is optional only for `ghost`.** Text buttons ("Add a range", "More") gain nothing from a glyph.
    The other variants keep the existing invariant.
28. **`LargeTitleHeader.action` takes one button plus one ⋯.** Collection detail needs Add recipes and its menu on the
    title row.
29. **Screen on lives in the `SectionSwitch` below a 720 body and in the action row from 720.** The switch does not
    render where two columns show both sections.
30. **"Most cloned" becomes "Most saved".** The glossary retires "clone".
31. **At 840+ the sidebar stays visible in the editor.** Leaving loses nothing, so there is no reason to trap the cook.
32. **After a recipe's first publish, "Add to a collection" opens a chooser sheet** built from the picker's row
    control. Both resolutions adopted the offer, and nothing specified its target.
33. **The current step has its own 44 px toggle.** A whole-step button would hide the step text from screen readers
    (button children are presentational).
34. **No native "Paste from clipboard" button.** The text field's system paste menu does the same job, and a
    programmatic clipboard read raises an iOS prompt.
35. **An unmatched ingredient shows "Needs attention" before Publish and "Fix before publishing" after.** The validator
    already refuses an unresolved line (U28), so it always blocks.

---

## 12. For staff-architect

Each item names what this spec assumes until the architect rules.

| #   | Question                                                                                                                                                                                                                                                                                                                                      | Assumed here                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A1  | **Leading-measure reader outside `recipe-import-core`.** `ingredientLine.ts:25-26` keeps that package out of the Expo bundle (asserted by `corpusPipeline.integration.test.ts`). Options: a small shared adapter over `parse-ingredient` (library first), or a minimal reader in `@kitchensink/recipe-core` over its existing `normalizeUnit` | a pure function both apps can import                                             |
| A2  | **What a typed line stores, and the consistency rule.** The cook's typed amount and unit are their own statement. Does the committed row also keep the raw typed text, and does it go through the parse pipeline at all? The owner protects the correction → cache → engines order (memory `parser-accuracy-bar`)                             | nothing later overwrites a field the cook typed                                  |
| A3  | **Autosave against versioning and the offline write port.** Drafts write to the server through the write port. A published recipe's edits stay device-only until Save changes makes one version. Where do device-only changes live, how are they keyed (UUIDv7 client ids), and how does a second device behave?                              | a device store keyed by recipe id                                                |
| A4  | **No stored draft before the first input**, and idempotent draft creation under retry                                                                                                                                                                                                                                                         | a client id is minted at first input                                             |
| A5  | **Paste into the editor:** parse job → rows in the "Reading…" state, R19 (a parse binds nothing), and retiring `/recipes/parse` plus native `ParseIngredientsScreen` and `ParseJobReviewScreen`                                                                                                                                               | the existing parse job, new consumer                                             |
| A6  | **Native root tab bar and per-tab stacks** in `AppRoot` (a `useState` union today), iOS edge-swipe back, Android Back to Home, the second-tap-pops-or-scrolls rule, and one `scrollsToTop` scroll view per screen. A small stack primitive or a navigation library                                                                            | the architect picks                                                              |
| A7  | **Scroll tracking and its ref:** `SectionIndex`, `SectionSwitch` and `LargeTitleHeader` all need to scroll a native scroll view to an offset and read its position. Is a scroll-view ref the permitted "external, non-declarative system" ref (CLAUDE.md), and does one hook serve all three?                                                 | one shared hook with one ref                                                     |
| A8  | **The 840 breakpoint and container queries** in Tailwind v4 (`--breakpoint-*`, `@container/main`, `--container-*` names), emitted from `themeCss.ts`                                                                                                                                                                                          | they compile, tested in `tailwindTheme.integration.test.ts`                      |
| A9  | **New dependencies:** `lucide-react`, `lucide-react-native`, `react-native-svg`, `expo-keep-awake`, `@expo-google-fonts/inter`. None is in the repo today                                                                                                                                                                                     | all approved. If Lucide is refused on native, keep Feather there (same geometry) |
| A10 | **Deleted routes:** `/settings`, `/account`, `/collections/new`, `/collections/{id}/rename`, `/collections/{id}/add`, `/recipes/parse*`, and the e2e specs that open them                                                                                                                                                                     | sheets need no URL                                                               |
| A11 | **Library sort** needs a sort parameter on the list API. Until then there is no Sort on My recipes                                                                                                                                                                                                                                            | deferred                                                                         |
| A12 | **Collection create contract:** does it take a description? If not, the field ships on rename only                                                                                                                                                                                                                                            | it does                                                                          |
| A13 | **Session state for checks and the current step** (web `sessionStorage`, native memory per stack entry)                                                                                                                                                                                                                                       | per recipe id                                                                    |
| A14 | **Save a copy from a card:** optimistic create, a second press is a no-op, and rollback on failure                                                                                                                                                                                                                                            | as §4.1                                                                          |
| A15 | **Picker toggles** write one by one, optimistically, with rollback                                                                                                                                                                                                                                                                            | as §5.3                                                                          |
| A16 | **The editor section hash** as a deep link from detail ("Edit ingredients"), and `replaceState` on jumps                                                                                                                                                                                                                                      | as §7.2                                                                          |
| A17 | **Google given name** as a prefill (not a save) for the display name                                                                                                                                                                                                                                                                          | Clerk exposes it on the session user                                             |
| A18 | **Keyboard shortcuts preference:** stored per device or per account                                                                                                                                                                                                                                                                           | per device                                                                       |
| A19 | **`ui` token roles:** add `role` without repurposing `semantic.secondary` / `semantic.ring`, then delete those keys once unused                                                                                                                                                                                                               | as §1.4                                                                          |
| A20 | **Web Wake Lock** needs a secure context. Sandbox previews are HTTPS. Local dev on `localhost` counts as secure                                                                                                                                                                                                                               | the control hides where it is unavailable                                        |
| A21 | **Future:** the import chooser's clipboard detection (`UIPasteboard.detectPatterns` has no known Expo binding) and an iOS share extension / Android share target                                                                                                                                                                              | out of scope until import is scheduled                                           |

---

## 13. Build slices

Every slice ships **web and native together** (CODING_STANDARDS §14), test first. Each one ends with:

- vitest component tests for **every** state of every changed component.
- Playwright at 320, 390, 768, 1280 and 1920 on its screens, loading and loaded, asserting
  `document.documentElement.scrollWidth === innerWidth` and that every control label renders on one line
  (`getClientRects().length === 1`) with +35% pseudo-localised strings.
- Maestro on the Android emulator and the iOS Simulator, run locally.
- a written web/mobile parity audit, and a `staff-ux-engineer` EVALUATE pass against this file.

Where a slice makes an existing spec obsolete, its coverage moves to the named new spec in the same commit.

### Slice 0: severity-4 hotfixes (being built now, not re-specified)

- Discover and Community scroll sideways while the rails load (E1).
- The branded 404 page (E2).
- The collection title breaks mid-word (E3).
- The crushed step-3 field at 320 (I1).
- Timers in raw seconds (F1).
- The duplicated cover photo on detail (F2).
- The native Recipes screen has no way back (M1). Slice 3 replaces its minimal fix.

### Slice 1: tokens, type and layout foundation

- **Changes:** colour roles with `pewter` and `honey` (§1.4), difficulty and status tones, type roles with `figure`,
  `largeTitle`, `barTitle`, `readingBody` (§1.5), Inter on native, spacing roles, the radius rule, surfaces and the
  Android elevation map (§1.6), removal of the second gradients (glass H1 card, greeting card, detail title cards), the
  content widths (§1.3), the 840 breakpoint and `@container/main` (§1.2). `formatDuration` everywhere a time
  shows, if slice 0 did not add it.
- **Screens:** every screen, visually. No layout or behaviour moves.
- **Playwright:** new `layoutContainers.spec.ts` (container class per width). Existing `mockupFidelity.spec.ts` and
  `recipeHomeResponsive.spec.ts` snapshots are re-baselined with the reason in the commit.
- **Maestro:** re-shoot `.maestro/visual/uiAuditCapture.yaml` on Pixel and iPhone. The Android cards lose their dark
  halo and every body string renders in Inter.

### Slice 2: primitives

- **Changes:** `Button` (neutral secondary, `ghost`, sizes, focus ring, and adoption of the 29 hand-built buttons),
  `Chip` / `ChipRow`, `SegmentedControl`, `SearchField`, `Input` / `TextArea` geometry, `FieldLabel`,
  `DurationField`, `Stepper`, `StatusBadge`, `UndoSnackbar`, `RecipeCover`, `ActionMenu` (⋯, flips above),
  `ConfirmDialog` (verb buttons, focus on the safe one), Lucide icons on both platforms.
- **Screens:** every screen that renders these. The detail ⋯ menu stops opening under the tab bar (D2).
- **Playwright:** new `controlLabels.spec.ts` (one line at 320 with +35% strings). Existing `recipeOwnerActions.spec.ts`
  updated for the menu and "Keep recipe".
- **Maestro:** the existing flows re-run green. A new `.maestro/visual/primitives.yaml` shoots each primitive state.

### Slice 3: shell and information architecture

- **Changes:** the three-tab bar on web and native, the sidebar at 840 with **New recipe**, the profile row and the
  collapse control, no top bar and no drawer, `LargeTitleHeader` on every top-level screen, the avatar, Discover as a
  root on native, Profile pushed from the avatar, `AppRoot` per-tab stacks with iOS edge swipe and Android Back,
  second tap on a tab, `CreateFab` on Home and My recipes (and "New collection" on Collections), `BackToTop`.
- **Interim entries, on purpose** (each switches in the slice named):
    - The FAB and the sidebar **New recipe** open today's two-item create menu (Write → today's wizard, Paste →
      `/recipes/parse`) until slice 8. Otherwise paste becomes unreachable for anyone who already has recipes.
    - Home and My recipes first run: **Add your first recipe** opens today's wizard until slice 7. **Paste
      ingredients** opens `/recipes/parse` until slice 8.
    - The Collections **New collection** FAB opens today's `/collections/new` page until slice 4.
- **Screens:** shell on every route, Home header, My recipes header, Discover header.
- **Playwright:** new `shellNavigation.spec.ts` (tab bar below 840, sidebar at 840, 1024 and 1280, collapse persists, no top bar, FAB
  DOM order after the H1, FAB hidden with the keyboard, tab re-tap to top, back to top). `homeTopBarGeometry.spec.ts` is
  deleted, its coverage moves to `shellNavigation.spec.ts`. `homeNavCutover.spec.ts` updated.
- **Maestro:** new `.maestro/shell/tabBar.yaml` (each tab, Recipes → Home and back, avatar → Profile, Android Back to
  Home) and `.maestro/shell/iosSwipeBack.yaml`.

### Slice 4: cards and lists

- **Changes:** `RecipeCard` grid, row and compact. Home (2 × 2, first run, static placeholders, week strip). My recipes
  (segments, sticky search, chips, view switch, no sort, every state). Collections list and the new-collection sheet.
  `/collections/new` is deleted. The rename sheet and the deletion of `/collections/{id}/rename` wait for slice 5,
  because today's collection detail navigates to that route (`CollectionDetailContainer.tsx:276`).
- **Screens:** Home, My recipes, Collections.
- **Playwright:** new `cardGridAlignment.spec.ts` (rows align across a grid row, no blank cover, first card fully
  visible at 390 × 844). `homeRecentRecipes.spec.ts`, `recipeListChips.spec.ts`, `recipeListEmptyStates.spec.ts`,
  `collections.spec.ts` updated. `recipeSourceTabs.spec.ts` (the Community tab) is deleted, its coverage moves to new
  `recipeListSegments.spec.ts`.
- **Maestro:** `.maestro/home.yaml` and `.maestro/homeRecentRecipeTap.yaml` updated. New
  `.maestro/recipes/newCollectionSheet.yaml`.

### Slice 5: Discover, collection detail and the picker

- **Changes:** Discover layout, filter sheet and panel, rails, compact results, Save a copy on cards with its snackbar,
  the sort menu, the no-result states, the cuisine-row threshold. Collection detail (one header, ⋯ menu, remove with
  undo, delete dialog, the rename sheet). The picker sheet with toggle rows. `/collections/{id}/rename` and
  `/collections/{id}/add` are deleted.
- **Screens:** Discover (browse, results, filters, no results), collection detail, add recipes.
- **Playwright:** `recipeFilterSheet.spec.ts` updated. `cloneVisibility.spec.ts` becomes `saveACopy.spec.ts`. New
  `discoverNoResults.spec.ts` and `collectionPicker.spec.ts` (toggle saves at once, rollback, Done summary).
- **Maestro:** new `.maestro/recipes/discoverSaveCopy.yaml` and `.maestro/recipes/collectionAddRemoveUndo.yaml`.

### Slice 6: recipe detail, the first slice of 008 FR-035, and versions

- **Changes:** the detail top (hero, meta, H1, rating line, stat strip, actions, description clamp, tags as text), the
  body (`SectionSwitch`, two columns from a 720 body, ingredients with serves in the heading, steps, nutrition,
  rating, footer facts), **Screen on, tap-to-check and the current step**, the ⋯ menu, the delete dialog, version
  history.
- **Screens:** recipe detail (own and others'), versions, delete confirm.
- **Playwright:** `recipeDetailHero.spec.ts`, `recipeDetailNutrition.spec.ts`, `recipeSourceAndScale.spec.ts` updated.
  New `recipeDetailCooking.spec.ts` (checks persist for the session, one current step, Screen on calls a stubbed
  `navigator.wakeLock` and hides without it, the switch's jump focuses the H2) and `recipeVersions.spec.ts`.
- **Maestro:** new `.maestro/recipes/detailCooking.yaml` (check a row, mark a step, toggle Screen on).

### Slice 7: the editor frame (the wizard retires for create and edit)

- **Changes:** one page for `/recipes/new` and `/recipes/{id}/edit` and the native editor screen. `SectionIndex` in
  all three forms with guided progress. Autosave and device-only edits for published recipes (§7.3). Details, Steps
  (timer disclosure, Paste steps), Photos & publish (visibility, ready line), Preview, Publish and Save changes. The
  Ingredients section hosts **today's** row model, so this slice can ship alone. It gains one fix: a row added from
  the list no longer gets an invented quantity of 1 (F5).
- **Screens:** the editor (new, edit draft, edit published), preview sheet, discard confirm.
- **Playwright:** `recipeEditWizard.spec.ts` and `recipeWizardActionBar.spec.ts` are deleted, their coverage moves to
  new `recipeEditor.spec.ts` (index jump puts the H2 under the chrome and focuses it at 320, 768 and 1280, instant
  under reduced motion, a focused field is never under the header or the `ActionBar`, autosave status, Save changes
  makes exactly one version, a refused Publish focuses the first error). `recipeUnsavedChangesGuard.spec.ts` is
  rewritten for the resume notice. `recipeMealTypeAndReview.spec.ts` and `recipeCrud.spec.ts` updated.
- **Maestro:** new `.maestro/recipes/editorSections.yaml` (bar → sheet → section, create and publish, edit a published
  recipe then Save changes) and `.maestro/recipes/editorStatusBarTap.yaml` (iOS).

### Slice 8: the Ingredients section and the one-tap create entry

- **Changes:** quiet read rows, the row ⋯ menu, the row editor (sheet below 600, inline from 600), the quantity-first
  add field with the live reading (after A1 and A2), Paste a list, groups, the nutrition total. The FAB and the sidebar
  button switch to **one tap opens the editor**. Home's first-run Paste ingredients opens the editor with the paste
  sheet open. `/recipes/parse*` and the native parse screens retire.
- **Screens:** the Ingredients section in every state, the create entry, Home first run.
- **Playwright:** `parseIngredients.spec.ts` is deleted, its coverage moves to new `ingredientPasteList.spec.ts`.
  `recipeCreateDial.spec.ts` is deleted, its coverage moves to new `createEntry.spec.ts`.
  `ingredientRowEditor.spec.ts`, `addIngredientLoop.spec.ts`, `ingredientShortlistRow.spec.ts`,
  `recipeQuantityRange.spec.ts`, `namelessLines.spec.ts` and `ingredientListGeometry.spec.ts` updated. The geometry
  spec asserts ten one-line rows on a 390 × 844 screen.
- **Maestro:** new `.maestro/recipes/addIngredientLine.yaml` (type, pick, loop) and
  `.maestro/recipes/pasteList.yaml`.

### Slice 9: Profile, sign-in and the `/` shortcut

- **Changes:** the one Profile page and the display-name sheet. `/settings`, `/account` and native `'account'` are
  deleted. The Keyboard shortcuts switch and the `/` shortcut. Sign-in and sign-up layout, the brand line, the Clerk
  appearance change, the sign-up fields (dashboard), the one-time-code field. Legal sources.
- **Screens:** Profile, sign-in, sign-up, legal sources.
- **Playwright:** `accountShell.spec.ts` and `accountDangerZone.spec.ts` move to new `profile.spec.ts` (the danger
  zone flows unchanged). `authPages.spec.ts` updated (split at 1024, full-bleed at 320). `routeProtection.spec.ts`
  keeps asserting the sign-up link. New `searchShortcut.spec.ts` (`/` focuses search, off when the switch is off, never
  inside a field).
- **Maestro:** `.maestro/accountDangerZone.yaml` and `.maestro/auth/loginFlow.yaml` updated.

### After the overhaul

The full cook view (008 FR-032 to FR-035: one step per screen, timers, keep-awake) is the next feature. It is not a
slice here.

---

## 14. Out of scope, success measure, evidence

**Out of scope:** dark mode. A tablet navigation rail (D6 keeps the tab bar). The import chooser's own spec. The share
extension. The cook view. Avatar upload on web. Notifications. Meal Plan, Shopping and Nutrition. The pull-updates
preview dialog (unchanged).

**Success measure:**

- Falsifiable now, automated: no sideways scroll on any route at five widths. No control label on two lines at 320
  with +35% strings. At 390 × 844: four library rows, all four Home cards, and detail's title, stat strip and primary
  action on the first screen. Ten one-line ingredient rows in the editor. One H1 per screen.
- After release (the owner reads these, from `analytics/useAnalyticsEmitter.ts`): time from sign-up to the first
  published recipe (primary). Guardrail: the share of drafts abandoned in Ingredients. The first sign of trouble is
  that share rising after slice 8.

**Evidence: verified, assumed, judgement.**

- Verified in the repo today: the message keys marked existing (by grep), `stepTimer` at
  `features/recipes/src/messages.ts:843`, `tabCommunity` at `:782`, `stepTimerLabel` at `form/messages.ts:686`, the
  `ui/src` folders and export names, the token ramps in `tokens/scale.ts` and `tokens/colors.ts`, `semantic.secondary`
  = coral and `semantic.ring` = seafoam-light, `Button`'s required `icon`, the web routes under `web/src/app/[locale]`,
  the native screens under `mobile/src/screens`, 008 FR-032 to FR-035, and the absence of the five new dependencies.
- Taken from the earlier files without re-computing: every contrast ratio (computed there on 2026-10-08 and re-checked
  in `resolutionA.md`), and the screen observations behind each finding ID.
- Judgement, labelled where used: the settled calls in §11, and the scroll budgets, which are arithmetic from the
  layouts, not measured on a render.
- Not seen rendered by me: I built this from the earlier files' captures and reads. Native tablet, native Discover,
  Collections and Profile have still never been seen on a device.

**References consulted:** `ux-mode-playbooks` (SPECIFY). `ux-design-corpus`: `critique-handoff.md` (handoff
checklist), `accessibility.md` (2.2 criteria, target size, exemptions), `cross-platform-translation.md` (the ten-point
pass), `internationalisation.md` (+35%), `device-ergonomics.md` (targets). External sources are the ones the earlier
files fetched on 2026-10-08 (NN/g back-to-top and breadcrumbs, GOV.UK task list, W3C SC 2.4.11 and C43, SC 2.3.3, MDN
`aria-current` and Wake Lock, Apple HIG tab bars and `scrollsToTop`, Android window size classes). I fetched none again.
