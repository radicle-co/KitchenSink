# UI overhaul: specification for the shell, Home, lists, Discover, Collections, account and auth

⛔ **DESIGN SPECIFICATION. NOT PRODUCTION CODE.** One committed design per screen. Build it from this file plus
`specSharedSystem.md`, which owns every shared rule this file cites as "shared §N". Findings it fixes are in
`evaluateShellAndLists.md` (IDs E1–E35, M1–M8).

- **Mode:** SPECIFY. **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`.
- **Accessibility contract level:** WCAG 2.2 AA. Native targets meet Apple HIG 44 pt and Material 48 dp.
- **Implementer:** `fe-1` builds features from this spec (per `CLAUDE.md`). Before starting, confirm `fe-1`'s stated
  accessibility floor is WCAG **2.2** AA. A 2.1 AA implementer misses SC 2.4.11 and 2.5.8 silently.
- **Calls I made that need the owner's confirmation** are marked ⚠️ **OWNER**. Each one has my recommendation, so
  the build is not blocked. The list is in §Q.

## Build order (slices)

Shared primitives come first (shared §0, slices S0–S8). Then these screen slices, each shippable alone:

| Slice | Screens                                             | Depends on         | Fixes                       |
| ----- | --------------------------------------------------- | ------------------ | --------------------------- |
| P1    | Shell: sidebar, top bar, tab bar, FAB (§S)          | S0, S1             | E13, E16, E28, E31, E34, M1 |
| P2    | 404 (§N)                                            | S2                 | E2                          |
| P3    | Recipes library: populated, empty, create menu (§R) | S2, S3, S4, S5, S8 | E5, E9, E14, E22, E29       |
| P4    | Discover, Community, filters, no results (§D)       | S3, S5, S8         | E1, E9, E10, E20, E21       |
| P5    | Collections: list, new, detail, add (§C)            | S2, S6             | E3, E4, E8, E24, E25, E26   |
| P6    | Home (§H)                                           | S8                 | E27, M2                     |
| P7    | Profile, Settings, Account, Legal (§P, §L)          | S2, S6             | E15, E33                    |
| P8    | Sign in, sign up (§A)                               | `clerk.ts` change  | E23                         |

**E1 (the sideways scroll) is a one-line fix and ships first, before any slice.** See §D.4.

## Purpose

A home cook keeps their own recipes, finds other people's, and groups recipes into collections. They do it on a
phone, often one-handed in a kitchen, and on a laptop for longer sessions. Everything below serves one test:
**the first screen of every page shows what the page is, its main action, and real content.** Where this spec is
silent, resolve it in favour of that test and of `specSharedSystem.md` §1 (the overflow rule).

---

## §IA. Information architecture (decide first, it is the one-way door)

### IA.1 Destinations

⚠️ **OWNER · ONE-WAY DOOR.** Recommended structure, the same on both platforms (FR-044 functional parity):

| Level 1 (nav) | Level 2 (tabs inside it)                | Web URL                                 |
| ------------- | --------------------------------------- | --------------------------------------- |
| Home          | —                                       | `/{locale}`                             |
| Recipes       | **My recipes · Discover · Collections** | `/recipes`, `/discover`, `/collections` |
| Meal Plan     | (coming soon)                           | —                                       |
| Grocery       | (coming soon)                           | —                                       |
| Nutrition     | (coming soon)                           | —                                       |
| Profile       | —                                       | `/profile`                              |

- **Collections becomes the third tab under Recipes on web**, as it already is on mobile
  (`RecipesScreen.tsx:60`). This is the smallest change that gives Collections a door (E4). Add `'collections'`
  to `RECIPE_SOURCE_TABS` (`features/recipes/src/list/model.ts:300`) with `href` → `/{locale}/collections`.
  The URLs do not change, so no redirects are needed. That is why I recommend this over a top-level nav item.
- **"Community" is renamed "Discover"** in the tab label, so the tab, the top-bar title and the URL agree (E32).
  The page H1 becomes "Discover" (not "Discover recipes"). The mobile tab is already called "Discover". Cost: one
  label key (`recipeMessages.list.tabs.community` or equivalent, value → "Discover") plus its translations. No URL
  moves.
- **Flip condition:** if the owner wants Collections as a top-level destination, add it to `resolveHomeNav` as the
  second item and drop it from the tabs. Do it before any external link to `/collections` exists, because the nav
  model is learned.

### IA.2 Unreachable destinations

⚠️ **OWNER.** Meal Plan, Grocery and Nutrition are not built. Today they take three of six tab-bar slots on a
phone and force "Meal Plan" to wrap at 320 (E7, E31).

- **Recommendation:** on `compact` and `medium`, the tab bar shows only reachable destinations (Home, Recipes,
  Profile). The unbuilt ones stay in the sidebar (`expanded`) and in the nav drawer, styled as disabled with a
  visible "Soon" badge (§S.3). FR-046 governs Home widgets, not navigation, so this does not conflict with it.
  Capability gating (`resolveHomeNav`'s `reachable`) already holds the data.
- **If the owner wants all six tabs kept:** the tab labels must still fit. Use the short label "Plan" for Meal
  Plan on the tab bar only. The accessible name stays "Meal Plan, coming soon", and SC 2.5.3 holds because "Plan" is
  contained in it, and size the tab bar's labels to `caption` (12 px).

### IA.3 Profile, Settings and Account

⚠️ **OWNER · ONE-WAY DOOR (URLs).** Three pages become one "Profile" destination with sections (mockup
`screenProfile.html`). `/settings` and `/account` redirect to `/profile#settings` and `/profile#account`. Detail
in §P. **Flip condition:** if the owner wants the three URLs kept, keep them, but give all three the shared
`content-reading` column and the same section-nav (§P.1) so they read as one surface.

---

## §S. App shell (web: `web/src/components/home/chrome/*`; native: `mobile/src/components/home/chrome/*`)

### S.1 Sidebar (web, `expanded` only)

- **Sticky.** `position: sticky; top: 0; height: 100dvh` on the sidebar (`HomeSidebar.tsx:74`). The nav never
  scrolls away (E16). The nav list scrolls inside the sidebar if it is ever taller than the window.
- Width 256 px expanded, 80 px collapsed (unchanged).
- Wordmark block 64 px tall, matching the top bar's height so their bottom edges align (today 56 vs about 80).
- Nav items: 44 px tall, 12 px horizontal padding, icon 24 + `gap-within` + label in `label` role. Active:
  `seafoam` at 10% fill, `ocean-dark` icon and label, and a 3 px `seafoam` bar on the inline-start edge (mockup).
- **Disabled destinations** (§S.3) use `slate` text plus a "Soon" badge (`status-neutral`, `caption`).
- **Collapse control** moves to the foot, on a 1 px `border-control`-at-40% divider, as a full-width 44 px row:
  "«" icon plus the label "Collapse" (visible when expanded; when collapsed, the icon alone with the accessible
  name "Expand sidebar"). Its `aria-expanded` reflects the state (E34).

### S.2 Top bar (web and native)

- Height 56 px (`compact`) / 64 px (`medium`+). Sticky. Glass fill unchanged.
- **Title:** `chromeTitle` role (Playfair 18/600, shared §3), on both platforms (native already does this). Rule:
  truncate:1. It never wraps (E7). It has room because the controls beside it shrink to two (below).
- **Controls, right to left:** avatar, then at most one icon button.
    - **Search** (magnifier) is shown only where it does something. ⚠️ Decision: it navigates to `/discover` with
      the search field focused. That is the one search the app has. On the Discover page itself it is hidden,
      because the field is already on screen.
    - **Notifications** (bell) is **removed** until a notifications service exists. A control that does nothing
      breaks Nielsen #1 and 4.1.2 (E13). Re-add it with the service.
- **Avatar:** 32 px disc in a 44 × 44 hit area. Initials from `initialsFor(displayName)` in `label` role, white
  on `seafoam` (4.67:1). While the profile loads: the disc shows a `pearl` skeleton (no glyph). When there is no
  name: a 20 px person glyph, **on both platforms**. Native must stop rendering `'·'`
  (`mobile/src/components/home/chrome/HomeTopBar.tsx:85`) (E28, M8). Accessible name: `chrome.account`
  ("Account, {name}") or `chrome.accountNoName`.
- **Back (detail pages, `compact`/`medium`):** a 44 px "‹" button at the inline start replaces the menu button on
  any page below level 2 (collection detail, add recipes, new collection, legal). Its accessible name names the
  parent ("Back to Collections"). On `expanded`, the PageHeader's eyebrow link does this job (§C.3).
- **Menu button:** stays on level-1 and level-2 pages on `compact`/`medium` and opens the nav drawer
  (`HomeMobileNav.tsx`, unchanged except for §S.3).

### S.3 Bottom tab bar (web `compact`/`medium`; native always)

- Height 64 px plus the safe-area inset (unchanged). Labels in `caption` (12/500). **Labels never wrap.** With
  the recommended three reachable destinations (IA.2), each tab is at least 106 px wide at 320, so even a +35%
  translation fits on one line.
- Active: `ocean-dark` icon and label, label weight 600, and a 32 × 3 px `seafoam` bar above the icon. Inactive:
  `slate`. Do not use filled vs outlined icons as the only active cue.
- **Native gets the tab bar on every top-level screen** (M1). Move `HomeTabBar` up from `HomeWidgetSurface` to
  `AppRoot`, rendered under Home, Recipes (all three top tabs) and Profile. It hides only on pushed detail and
  task screens (recipe detail, editor, collection detail, add recipes, account hub), which carry a header back
  button instead. Android system Back on a top-level screen other than Home goes to Home. On Home it leaves the
  app. Mechanism: `AppRoot` registers a root back intercept through `@commise/ui/back-intercept`.
- `<main>` reserves the bar's height plus 16 px at its foot (unchanged), and sets `scroll-padding-bottom` to the
  same value so a keyboard-focused item is never hidden under the bar (SC 2.4.11).

### S.4 FAB (create recipe)

- The FAB stays the only way to create a recipe on both platforms (`recipe-list.md`, canonical).
- 56 px disc, `seafoam` → `ocean-dark` gradient (`Button`'s primary surface), white 24 px "+" glyph, `shadow-lg`
  (web) / Android elevation `lg` (3, shared §11). Accessible name `list.createCta` ("New recipe").
- **Position:**
    - Phone and tablet: 16 px from the inline-end edge and 16 px above the tab bar. That is the thumb zone (a
      reachable lower corner for the right thumb; `device-ergonomics.md`).
    - Desktop (`expanded`): anchored to the **content column's** inline-end edge, not the viewport, 24 px above
      the window foot. At 1920 today it floats 230 px right of the grid (E22). Use `position: sticky` in a
      zero-height row after the grid, aligned to the end of `content-wide`.
- It appears on My recipes only (unchanged). Discover and Collections have their own actions.
- It must never cover the last card. The grid gets 88 px of bottom padding on phones (56 + 16 + 16).

### S.5 Shell states

| State           | Behaviour                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile loading | Avatar skeleton (S.2). Nothing else waits on the profile.                                                                                                                                                                                                                                                                                                                        |
| Profile failed  | Avatar person glyph. No error in the chrome. The Profile page reports it (§P.4).                                                                                                                                                                                                                                                                                                 |
| Offline         | `@commise/ui/offline-notice` (exists) as a 40 px strip under the top bar on every page: "You're offline. Changes will sync when you're back." It reuses the existing offline copy key. It is announced once, politely.                                                                                                                                                           |
| Focused task    | Tab bar hidden, task's own footer owns the foot (unchanged, `HomeChrome.tsx` `focusedTask`). Below `expanded`, a task may also supply its own header, which then **replaces** the top bar, so there is one title and one Back (the wizard does this; `specSharedSystem.md` §13.6). Collection new, rename and add-recipes use the shell top bar with a back button (§C.2, §C.4). |

### S.6 Platform translation (shell)

| Element              | Web                                   | Native                                          | Disposition            | Why                                                   |
| -------------------- | ------------------------------------- | ----------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| Primary nav          | Sidebar ≥ 1024, tab bar below         | Tab bar always                                  | kept (moved at 1024)   | owner directive, reach                                |
| Unbuilt destinations | Sidebar + drawer, "Soon" badge        | Not in tab bar. In no drawer (native has none). | dropped from phone bar | three dead slots cost the live ones their label width |
| Nav drawer           | Menu button opens it                  | None                                            | dropped                | native has three tabs, all visible                    |
| Search shortcut      | Top bar, goes to Discover             | Top bar, goes to the Discover tab               | kept                   | same job                                              |
| Back                 | Browser Back + header back on level 3 | Header back + Android system Back               | translated             | platform convention                                   |
| Hover states         | Fine pointer only                     | None, pressed state instead                     | translated             | no hover on touch                                     |

---

## §H. Home (web `web/src/components/home/*`; native `mobile/src/components/home/*`)

### H.1 Governing requirement and the call I made

FR-046 (CR-001 amendment) requires the unbuilt widgets (nutrition, resume cooking, week's meals) to render as
placeholders with the real widget's shape and no fake data. That stays. FR-046 also says Home **order** is
per-user personalization, whose consumption is deferred in Home v1. So the host's default order is a design
choice, not a requirement. This is a Situation B trade-off (requirement vs a first screen with no content):

- **Decision:** the live widget (Recent recipes) comes **first**. The placeholders follow it, in one group headed
  "Coming soon to Commise". The first screen then always shows the cook's own recipes (E9, M2).
- What the requirement keeps: every placeholder, its shape, its exposure to assistive tech
  (`PlaceholderWidgetCard.tsx` rules unchanged).
- What it gives up: nothing FR-046 states. If the owner reads "order" as fixed, flip it back by changing the
  registry order. It is one line in the curation default.

### H.2 Layout

Content width `content-wide`, left-aligned (shared §2.2).

```
compact (390)                       expanded (main ≥ 960)
┌──────────────────────────┐        ┌──────────────────────────────────────────────┬────────────────────┐
│ Good afternoon, Chef!    │ H1     │ Good afternoon, Chef!                        │ (nothing: the      │
│ Sunday, May 31           │        │ Sunday, May 31                               │  greeting row ends)│
│ Recent recipes   See all │ H2     │ Recent recipes                     See all → │                    │
│ ┌──┐ Slow-Roasted Lamb…  │ row    │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    grid cards, 4-up │
│ ┌──┐ Pasta               │ cards  │ └────┘ └────┘ └────┘ └────┘                                     │
│ ┌──┐ Wild Mushroom…      │ (4)    │ Coming soon to Commise                                          │
│ ┌──┐ Charred Summer…     │        │ ┌ Today's nutrition ┐ ┌ Resume cooking ───────────────────────┐ │
│ Coming soon to Commise   │ H2     │ └───────────────────┘ └───────────────────────────────────────┘ │
│ ┌ Today's nutrition ───┐ │        │ ┌ This week's meals ─────────────────────────────────────────┐ │
│ ...                      │        │ └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┘        └──────────────────────────────────────────────────────────────┘
```

- **Greeting:** no card, no gradient box (it sits on the canvas, as in the mockup). `greeting` role, wrap:2.
  The date is `body`, `slate`, below it with `gap-within`. Native uses the same role; the Android face defect
  (shared §3) is fixed there.
- **Recent recipes:** H2 `sectionTitle` + "See all" (`home.seeAllRecipes`, shortened to "See all" with the
  accessible name "See all recipes", SC 2.5.3) at the **inline end of the heading row**, as in the mockup
  (today it sits alone at the foot). Up to 4 recipes (FR-046).
    - `@narrow`: **row cards** (shared §12), stacked, 4 × 112 px. All four fit on one phone screen.
    - `@regular`: grid cards, 2-up. `@wide`: grid cards, 4-up, with subgrid rows.
- **Coming soon group:** H2 `sectionTitle` "Coming soon to Commise" (new key `home.comingSoonHeading`). Below it
  the three placeholders:
    - Each keeps its shape, but its "Coming soon" badge moves next to its title as a `status-neutral` badge in
      `caption` 600, so the message is read before the grey shapes (E27).
    - The grey blocks are static: no pulse, so they do not read as loading. They use `pearl` on `white`, which is
      already non-informative and `aria-hidden` per the existing rule.
    - `@wide`: nutrition and resume side by side (1 : 2), the week strip full width below (mockup layout).
      `@narrow`: stacked.
    - **The week strip never clips.** Seven equal columns (`grid-template-columns: repeat(7, 1fr)`) with a minimum
      tile of 36 px. At 320 the content is 288 px, so 7 × 36 + 6 × 4 = 276 fits. Day labels are the locale's
      narrow form ("M", "T") below `@regular`, short form ("Mon") above. The accessible name is always the full
      weekday.
- **Subscription nudge** (exists): unchanged position and behaviour.

### H.3 States

| State                      | Shown                                                                                                                                                            | Copy (key)                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Loading recent recipes     | 4 row/grid skeletons matching the variant, under the real H2                                                                                                     | `recentRecipes.loadingLabel` (exists), announced politely                                                |
| No recipes yet (first run) | `RecipeWidgetEmptyState` becomes a two-action card: "Your recipes will show up here." with **New recipe** (primary) and **Paste an ingredient list** (secondary) | new keys `home.recentEmptyBody`, reuse `list.createFromScratch`/`createFromPaste` (sentence case, §Copy) |
| Load error                 | Under the H2: `HomeWidgetErrorNotice` (exists) "We couldn't load your recent recipes." + **Try again**                                                           | exists                                                                                                   |
| Offline                    | Cached recipes shown. Shell offline strip (§S.5).                                                                                                                | exists                                                                                                   |
| Profile name unknown       | "Good afternoon!" (no ", Chef")                                                                                                                                  | existing greeting fallback                                                                               |

### H.4 Accessibility

- H1 is the greeting (`HomeGreeting.tsx`). Route-change focus goes to it.
- H2s: "Recent recipes", "Coming soon to Commise". Placeholder titles are H3.
- Tab order: greeting (not focusable), See all, each recipe card (one tab stop per card, the card link), then
  the placeholders' nothing (they hold no controls), then the nudge if shown.

---

## §R. Recipes library: My recipes (web `features/recipes/src/list/*`; native `RecipeListScreen.tsx` + `*.native.tsx`)

### R.1 Layout

```
compact 320                                expanded (main ≈ 1024, content-wide)
┌ ☰  Recipes                 🔍  (E) ┐     ┌──────────────────────────────────────────────────────┐
│ My recipes  Discover  Collections  │tabs │ My recipes   Discover   Collections                    │
│ ( 🔍 Search your recipes      ×  ) │     │ ( 🔍 Search your recipes                        )      │
│ [All][Quick][British][dairy-f…] →  │chips│ [All] [Quick (<30 min)] [British] [Dairy-free] …       │
│ 12 recipes              ☷ ▦        │     │ 12 recipes                                    ☷  ▦     │
│ ┌──┐ Slow-Roasted Lamb Shoulder…   │rows │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │
│ │  │ 330 min · 8 · ~612 cal        │     │ │    │ │    │ │    │ │    │  grid cards, auto-fill     │
│ └──┘ ●●○ Medium  ★★★★★ 4.8 (12)    │     │ └────┘ └────┘ └────┘ └────┘                     (+)    │
│ ┌──┐ Pasta …                       │     │                                                         │
│                               (+)  │FAB  └──────────────────────────────────────────────────────┘
└ ⌂ Home   📖 Recipes   👤 Profile   ┘
```

- **No visible H1 card.** `PageHeader titleVisibility="chrome"` (shared §6). The top bar reads "Recipes". The
  `GradientSurface` wrapper at `RecipeListFrame.tsx:35-37` is removed.
- **Tabs** (shared §8), directly under the top bar, 0 px top margin, 16 px below.
- **Search** (`SearchField`, shared §9), full width of the column, placeholder "Search your recipes" (new value
  for `list.searchPlaceholder`; drop the "...", it is not a sentence). Label "Search your recipes", visually
  hidden.
- **Facet chips** (`ChipRow`, shared §7): `overflow="scroll"` at `@narrow`, `"wrap"` (two lines at most) from
  `@regular`. Kind `filter` (multi-select) except "All", which clears the others. Labels are sentence case and
  capitalised the same way ("Dairy-free option", "Gluten-free"): display labels come from the facet value with
  only the first letter raised, applied in the view model, never in the stored tag.
- **Result bar:** one row. Count on the inline start (`meta`, `slate`), "12 recipes" (ICU plural, existing key).
  On the inline end a two-option **view switch** (list ☷ / grid ▦) from the mockup: a `Chip kind="choice"` pair
  with icon-only visuals, accessible names "List view" / "Grid view". Default: list at `@narrow`, grid above.
  The choice persists per device (local storage / AsyncStorage key `recipes.viewMode`).
- **Results:** list view = row cards, `gap-within` (8) between them. Grid view = grid cards,
  `grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr))`, `gap-grid`, subgrid rows (shared §12).
- **Scroll budget, 320 × 640:** top bar 56 + tabs 44 + 16 + search 48 + 12 + chips 44 + 12 + result bar 24 + 8
  = 264 px of chrome, plus the 64 px tab bar. That leaves 312 px: two full row cards and the top of a third are on
  the first screen (today: none). At 390 × 844, four full rows (516 px ÷ 120 px per row).

### R.2 Create menu (FAB menu)

- Web: the FAB opens `@commise/ui/action-menu` anchored above the FAB, aligned to its inline-end edge, never
  covering the FAB. Native: the same component's native leaf presents a **bottom action sheet** with a title
  (`actionMenu/props.ts` already supports `title`), because a popover near the screen's corner is hard to reach
  and covers content (M6).
- Two items, each 56 px tall, icon 24 + two lines:

| Item         | Title (key, new value)                              | Description (new key)                                                           |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| ✎ pencil     | "Write a recipe" (`list.createFromScratch`)         | "Start from a blank recipe." (`list.createFromScratchHint`)                     |
| 📋 clipboard | "Paste an ingredient list" (`list.createFromPaste`) | "Paste a list and we'll sort out the ingredients." (`list.createFromPasteHint`) |

- Title in `label` role, wrap: never (the menu is 288 px wide minimum, and both titles fit at +35%). Description
  in `caption`, `slate`, wrap:2.
- Menu title (native sheet and the web menu's accessible name): "New recipe".
- Focus: opening moves focus to the first item. Escape, outside click, and Back close it and return focus to the
  FAB (the action-menu primitive already does this).

### R.3 States

| State                      | Shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Copy                                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run (no recipes)     | Tabs stay. Search and chips **hidden** (nothing to search). A centred block, max 28 rem: a 96 px line illustration of a recipe card and a pan (one stroke weight, `seafoam` + `slate`), H2 `sectionTitle`, body, then two buttons stacked (`@narrow`, `width="fill"`) or side by side: **Write a recipe** (primary), **Paste an ingredient list** (secondary). The FAB is hidden while this block shows (the wireframe's rule: the empty state shows its own create button). | H2 "Your recipe box is empty" (`list.emptyTitle`, new value). Body "Add a recipe you love, or paste an ingredient list and we'll set it up." (`list.emptyBody`, new value)                                                                                         |
| No match (search or chips) | Results area only: H2 "No recipes match" + body naming the query and active chips + **Clear search** / **Clear filters** (whichever applies; both if both)                                                                                                                                                                                                                                                                                                                   | `list.noMatchTitle` (new value "No recipes match"); body `list.noMatchBody` becomes "Nothing matches “{query}”." when only a query is set, and "No recipes match these filters." when only chips are set (two new keys `list.noMatchQuery`, `list.noMatchFilters`) |
| Loading                    | Tabs, search stay. Results show 6 skeletons of the active view's variant. No chips, no FAB (wireframe rule, unchanged).                                                                                                                                                                                                                                                                                                                                                      | `list.loadingLabel` (exists)                                                                                                                                                                                                                                       |
| Load error                 | Results area: "We couldn't load your recipes." + **Try again**. FAB still shows (wireframe rule).                                                                                                                                                                                                                                                                                                                                                                            | existing                                                                                                                                                                                                                                                           |
| Refresh failed             | Inline notice above results (`@commise/ui/refresh-notice`, exists).                                                                                                                                                                                                                                                                                                                                                                                                          | existing                                                                                                                                                                                                                                                           |
| Offline                    | Cached list shown, shell strip. Creating still works (offline write port).                                                                                                                                                                                                                                                                                                                                                                                                   | existing                                                                                                                                                                                                                                                           |
| Overflow                   | 500+ recipes: "Load more" button after the list (existing `@commise/ui/load-more`).                                                                                                                                                                                                                                                                                                                                                                                          | existing                                                                                                                                                                                                                                                           |

### R.4 Accessibility

- H1 "Recipes" visually hidden, route-change focus target.
- Tab order: tabs → search → clear (when shown) → chips (one tab stop per chip; `filter` chips are toggle
  buttons) → view switch (one stop, arrow keys) → cards → load more → FAB. The FAB is last in DOM order and
  visually pinned, which matches reading order for a "create" action.
- Result count changes are announced politely (existing live region).

---

## §D. Discover (web `features/recipes/src/discovery/*`, `filters/*`; native `RecipeDiscoveryScreen.tsx` + `*.native.tsx`)

### D.1 Layout

```
compact / medium                              expanded with main ≥ 960 (wireframe recipe-search.md)
┌ My recipes  Discover  Collections ┐         ┌ tabs ─────────────────────────────────────────────────┐
│ ( 🔍 Search public recipes     × )│         │ ┌ Filters ──────┐  ( 🔍 Search public recipes      ) │
│ [⚙ Filters · 2]  Sort: Relevance ▾│         │ │ Clear all     │  12 recipes for “lamb”  Sort ▾     │
│ [gluten-free ×] [Under 30 min ×]  │applied  │ │ Dietary       │  ┌────┐ ┌────┐ ┌────┐              │
│ Trending                  See all │         │ │ ☐ Gluten-free │  │    │ │    │ │    │  grid        │
│ ┌────┐ ┌────┐ ┌──             ‹ › │rail     │ │ Cuisine …     │  └────┘ └────┘ └────┘              │
│ New                       See all │         │ │ Total time    │                                    │
│ ...                               │         │ │ (•) Any …     │                                    │
└───────────────────────────────────┘         └─┴───────────────┴────────────────────────────────────┘
```

- `PageHeader titleVisibility="chrome"`. The top bar says "Discover" (IA.1). The visible "Discover recipes" H1
  goes.
- **Below `@wide`:** the filter groups never show inline. One row under the search: a **Filters** button
  (`Button variant="secondary" size="sm"`, icon ⚙, label "Filters", and when filters are active a count badge
  "· 2" whose accessible name is "Filters, 2 active"), then **Sort** (D.3) on the inline end. Under them, the
  **applied filters** as removable chips in a `ChipRow overflow="scroll"` (each chip's name: "Remove gluten-free
  filter"), followed by "Clear all" as a ghost button when two or more are applied. This keeps the content on the
  first screen at 768 and 1280 (E9).
- **At `@wide`:** the wireframe's **sticky left filter panel**, 256 px wide, `position: sticky; top: 64px`
  (below the top bar), scrolling inside itself. Results take the rest. "Clear all" sits at the panel's top. No
  Filters button, no applied-chip row (the panel shows the state).
- The current inline breakpoint (`useFilterBarLayout.ts`, `(min-width: 40rem) and (min-height: 30rem)`) is
  replaced by the container rule: panel at `@wide` (main ≥ 960 px **and** window height ≥ 480 px), sheet
  otherwise. One copy of the facets renders at a time (keep the existing mount rule).

### D.2 Filter sheet (below `@wide`) and panel (at `@wide`): content

The same groups, in this order, in both containers. Each group is a `fieldset` with a `legend` in `overline`
role.

| Group             | Control                                                           | Options                                               | Rule                                                                                        |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Dietary           | `Chip kind="filter"` (multi) with counts                          | from facets                                           | wrap:3 lines in the sheet, then "Show all (n)"                                              |
| Cuisine           | `Chip kind="filter"` with counts                                  | from facets                                           | as above                                                                                    |
| Total time        | `Chip kind="choice"` (single, radio semantics)                    | Any · Under 15 min · Under 30 min · Under 60 min      | `ChipRow overflow="scroll"` at `@narrow` (the four chips need about 380 px), `"wrap"` above |
| More time filters | disclosure (`details`/`summary`), closed by default               | Prep time, Cook time, each with the same four choices | as above                                                                                    |
| Tags              | `Chip kind="filter"` with counts                                  | from facets, top 12 by count, then "Show all (n)"     | wrap:3                                                                                      |
| Ingredients       | `SearchField`, label "Has ingredient", placeholder "e.g. chicken" | free text                                             | n/a                                                                                         |

- **Time filters.** One visible "Total time" group plus a closed "More time filters" disclosure replaces three
  identical groups (nine chips) (E9). The wireframe's single-select-with-Any model is restored (`recipe-search.md`
  Filter Options). This also closes the "ambiguous in spec" row in the evaluation: Total time is kept because it
  ships today, and it becomes the primary one.
- **Sheet** (`@commise/ui/sheet`, exists): title "Filters" (`chromeTitle`), close × (44 px) at the inline end,
  body scrolls, footer pinned with two buttons side by side, each half width: **Clear all** (secondary) and
  **Show 12 recipes** (primary, the live result count; "Show recipes" while counting). The primary label is
  "Show {count} recipes" (ICU plural, new key `filters.showResults`). It is the most useful sentence in the
  sheet: it says what applying will do. At 320 each button is 136 px; "Show 12 recipes" is about 115 px in
  `label` role, and the +35% string wraps, so at `@narrow` the two buttons stack (primary on top, both full
  width) instead.
- Filters apply live in the panel. In the sheet they apply live underneath too (existing behaviour), and the
  primary button just closes the sheet.

### D.3 Sort

- A select-style button: "Sort: Relevance ▾" (`Button variant="ghost" size="sm"`). It opens
  `@commise/ui/action-menu` (web menu, native sheet) with four radio items: Relevance, Newest, Most cloned,
  Quickest. The chosen one shows a check. This replaces the four sort chips that wrapped at 320 and 390 (E7) and
  matches the wireframe's dropdown.
- It appears only while searching or after a rail's "See all" (existing rule).

### D.4 Browse rails

- **E1 fix (ship first).** `RecipeBrowseRailLoading.tsx:21` uses the same container as the loaded rail:
  `flex snap-x gap-4 overflow-x-auto pb-2`, with `w-64 shrink-0` tiles. Better: render both through one
  `RailTrack` element so they cannot diverge again. Add a Playwright check at 320 that
  `document.documentElement.scrollWidth === 320` while the rails are pending (route the browse request to hang).
- Rail heading row: H2 `sectionTitle` (no teal bar), "See all" ghost link at the inline end (accessible name
  `seeAllLabel`, "See all Trending").
- Rail track: grid cards at a fixed 256 px width (unchanged), `scroll-snap-type: x mandatory`,
  `scroll-padding-inline` equal to the page gutter so the first card lines up with the heading.
- **Previous / next buttons** (fine pointer only, `@media (hover: hover) and (pointer: fine)`): two 36 px round
  ghost buttons at the heading row's inline end, before "See all". They scroll by one viewport of cards minus one
  card. Disabled at the ends. On touch they are not shown, because swiping is the native gesture and the next
  card peeks 40 px past the edge as the cue (E20). Keyboard: the track itself is focusable (`tabindex="0"`,
  `role="region"`, name "Trending recipes") and arrow keys scroll it. Each card inside is also a tab stop.
- Rail cards are the grid card with **community footer** (shared §12 row 6): "by @handle" and **Clone**.
- "Browse by cuisine" becomes a `ChipRow overflow="scroll"` of `Chip kind="filter"`. Pressing one applies that
  cuisine filter and shows results (existing).

### D.5 States

| State                       | Shown                                                                                                                                                                                                            | Copy (key)                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Browse loading              | Rails' headings + skeleton tracks (D.4, contained)                                                                                                                                                               | `discovery.loadingLabel` (exists), once for the block                |
| One rail failed             | That rail: "Couldn't load this row." + **Try again** (exists)                                                                                                                                                    | exists                                                               |
| Search loading / updating   | Previous results stay, the pending bar after 500 ms (exists, unchanged)                                                                                                                                          | exists                                                               |
| Results                     | "12 recipes for “lamb”" (`meta`, live region), grid                                                                                                                                                              | `resultsForQuery` (exists)                                           |
| No results, query only      | H2 "No recipes for “zzzzzz”" + body "Check the spelling, or try a shorter search." + **Clear search**. Time groups are not shown in the panel or sheet when no facet has a count, except groups already applied. | new keys `discovery.noMatchQueryTitle`, `discovery.noMatchQueryBody` |
| No results, filters applied | H2 "No recipes match these filters" + body "Remove a filter to see more." + **Clear filters**, and the applied chips stay visible above so each can be removed one by one                                        | `noMatchTitle`/`noMatchBody` (new values)                            |
| No results, query + filters | H2 "No recipes for “x” with these filters" + **Clear filters** (primary) + **Clear search** (secondary)                                                                                                          | new key `discovery.noMatchBothTitle`                                 |
| Empty catalogue             | "No public recipes yet." (exists as `emptyTitle`, value changes)                                                                                                                                                 | `emptyTitle`                                                         |
| Offline                     | Last results stay. Searching shows "Search needs a connection." inline under the field                                                                                                                           | new key `discovery.offlineSearch`                                    |

Every no-results block is a `role="status"` region. Its H2 receives no focus (focus stays in the search field).
At 320 the block clears the tab bar (S.3 scroll padding).

### D.6 Accessibility

- Visually hidden H1 "Discover". H2 per rail or "Results".
- Tab order: tabs → search → clear → Filters (or the panel's controls at `@wide`) → applied chips → Clear all →
  sort → results or rails (track, then its cards) → load more.
- Opening the sheet moves focus to its title. Closing returns focus to the Filters button (existing rule).

### D.7 Platform translation (Discover)

| Element         | Web `@wide`             | Web below `@wide` and native     | Disposition | Why                                                                  |
| --------------- | ----------------------- | -------------------------------- | ----------- | -------------------------------------------------------------------- |
| Filter groups   | Sticky side panel       | Bottom sheet behind "Filters"    | moved       | the panel needs 256 px. On a phone the sheet keeps content on screen |
| Applied filters | Visible in the panel    | Removable chips under the search | collapsed   | state stays visible without the sheet open                           |
| Sort            | Menu                    | Native: action sheet             | translated  | platform picker convention                                           |
| Rail prev/next  | Buttons on fine pointer | Swipe, peeking card              | translated  | no hover/precise pointer on touch                                    |
| Clone on card   | Footer button           | Footer button (44 pt hit)        | kept        | FR-005, same job                                                     |
| "See all"       | Link in heading row     | Same                             | kept        |                                                                      |

---

## §C. Collections (web `features/recipes/src/collections/*`, `web/src/components/recipes/Collection*`; native `Collection*Screen.tsx` + `*.native.tsx`)

### C.1 Collections list

- Reached from the third Recipes tab (IA.1). `PageHeader titleVisibility="chrome"`, top bar "Recipes" on the
  tab, tabs as on §R.
- Header action row (`@narrow`: below the tabs, full width; `@regular`+: inline end of the result bar):
  **New collection** (`Button variant="primary" size="md"`, icon +). Its label is 14 characters, so it fits on
  one line in any layout that gives it 160 px. It never sits beside an H1 at `@narrow` again (E7).
- Result bar: "8 collections" (`meta`, new ICU key `collections.list.count`).
- **Collection card** (fixes E26, closes the "missing from spec" parity row). A grid of
  `repeat(auto-fill, minmax(16rem, 1fr))`, subgrid rows:

| Row | Content                                                                                                                                                                                          | Rule       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Cover mosaic, 16:9: the first 4 member photos as a 2 × 2 grid, 2 px gaps, radius `lg` on the outer corners. 1–3 photos: the first fills the cover. No photos: `pearl` with a 32 px folder glyph. | n/a        |
| 2   | Name, `cardTitle`                                                                                                                                                                                | truncate:2 |
| 3   | "12 recipes · Private" (`meta`), with the lock/globe icon before the visibility word                                                                                                             | one line   |
| 4   | Description, `body` 14 px `slate`, only when present                                                                                                                                             | truncate:2 |
| 5   | When cloned: "From @clara's Keto Staples" (`caption`)                                                                                                                                            | truncate:1 |

The card is one link (accessible name: the name, then the meta line).

- **States:**

| State        | Shown                                                                                             | Copy                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First run    | Centred block (as §R.3): 96 px illustration (stacked cards), H2, body, **New collection** primary | H2 "Group recipes your way" (`collections.list.emptyTitle`, new value). Body "Make a collection for weeknights, holidays or anything else." (`emptyBody`, new value) |
| Loading      | Header and **New collection** stay. 3 skeleton cards (wireframe rule, existing)                   | `loadingLabel` (exists)                                                                                                                                              |
| Load error   | Header stays. Error + **Try again** (existing)                                                    | exists                                                                                                                                                               |
| Refresh fail | Refresh notice (exists)                                                                           | exists                                                                                                                                                               |

### C.2 New collection, and rename

- A **focused task** page (`focusedTask` shell mode: no tab bar). Top bar: back button "‹" (name "Back to
  Collections") and the title "New collection" (`chromeTitle`, truncate:1, so it never wraps; E7).
- Content `content-reading`, left-aligned. No card around the form (one form on a page does not need a box).
- Fields, top to bottom, `gap-group` between them:
    1. **Name** (`@commise/ui/input`), label "Name", required, max 80 characters, a counter "34/80" shown at 60+.
       Autofocus on web desktop only (not on phones, where it would open the keyboard over the explanation).
    2. **Description**, optional, multi-line, max 280, label "Description (optional)". ⚠️ Decision: shown on create.
       The detail page already displays a description (`CollectionHeader.tsx:111`), but there is no place to
       write one at creation. If the API create contract has no description, ship the field on rename only and
       flag it to `staff-architect`.
- **Footer:** at `@narrow`, a pinned footer (`@commise/ui/pinned-footer`, exists) with **Create collection**
  (primary, `width="fill"`). The keyboard pushes the footer up (`KeyboardAvoider` on native, `visualViewport`
  on web via the sheet's existing hook), so the button stays above the keyboard. At `@regular`+, the buttons sit
  under the form, left-aligned: **Create collection** then **Cancel** (ghost).
- Rename uses the same page with the title "Rename collection" and the button "Save name".
- **Errors:** empty name on submit: "Give your collection a name." under the field, linked by
  `aria-describedby`, focus moves to the field (SC 3.3.1). Server failure: an alert above the footer "We couldn't
  create the collection. Try again." with the button still enabled, input kept.

### C.3 Collection detail

```
compact 320                                   expanded (main ≥ 960) — wireframe collection-view.md
┌ ‹  Weeknight Dinners the Whole F…   ⋯ ┐     ┌ ← Collections ─────────────────────────────────────────────┐
│ Weeknight Dinners the Whole Family    │ H1  │ Weeknight Dinners the Whole Family Will Actually Eat   ┌ rail ┐│
│ Will Actually Eat                     │     │ 🔒 Private · 6 recipes · From @clara's Keto Staples   │ Add  ││
│ 🔒 Private · 6 recipes                │     │ Description …                                          │ Pull ││
│ [ + Add recipes          ] [ ⋯ ]      │     │ Recipes                                                │ Clone││
│ Recipes                               │ H2  │ ┌──┐ Slow-Roasted Lamb …              Added by you  ⋯   │ Vis. ││
│ ┌──┐ Slow-Roasted Lamb Shoulder…   ⋯  │     │ ┌──┐ Pasta                     From source          ⋯   └──────┘│
└───────────────────────────────────────┘     └──────────────────────────────────────────────────────────────┘
```

- **Header** (`PageHeader`, `titleVisibility="visible"`): the collection name is the H1 (`pageTitle` role,
  wrap:3, then truncate with the full name in the accessible name and on the detail top bar's `title`). The
  name never shares a row with buttons at `@narrow` (E3).
    - Eyebrow at `@regular`+: "← Collections" ghost link. At `@narrow` the top bar's back button does this.
    - Meta line: visibility (icon + word), "6 recipes" (existing ICU key), and the source attribution when cloned.
      One line, wraps by item group (each item is a `nowrap` _inline group_ of icon + short text, and the row is
      `flex-wrap`). That is re-layout, not wrapping inside a control.
    - Description below the meta, `body`, wrap (it is prose).
- **Actions.** One primary, everything else in an overflow menu (Hick; one emphasis):
    - Primary: **Add recipes** (`Button` primary, icon +). The second add button above the list ("Add a recipe",
      `CollectionDetail.tsx:59-64`) is **removed** (E24).
    - Overflow "⋯" (`@commise/ui/action-menu`, accessible name "More actions for {name}"): **Rename**, **Pull
      updates from source** (cloned only), **Clone collection**, **Make private / Make public**, then a separator
      and **Delete collection** (destructive styling, last, away from frequent items; Fitts).
    - `@narrow`: the action row is under the meta: **Add recipes** (fills the row minus 52 px) + "⋯" (44 × 44).
    - `@wide`: the wireframe's right rail, 288 px, `position: sticky; top: 80px`: **Add recipes** (primary, fill),
      **Pull updates** and **Clone collection** (secondary, fill), then the **Visibility** control: a two-option
      `Chip kind="choice"` pair "Public / Private". For a free-tier user "Private" is disabled and the line under it
      reads "Private collections are a Premium feature." with an "Upgrade" link. **"Save changes" is removed:**
      the choice saves on press with an optimistic update and an undo snackbar (shared §12a) ("Collection is now private. Undo").
      The clone-info panel (exists) sits under it. The overflow menu then holds only Rename and Delete.
- **Member list** (H2 "Recipes", `sectionTitle`):
    - Each member is a row card (shared §12, row variant) plus, on its trailing edge, a "⋯" button (44 × 44,
      "More actions for {recipe}") with **Open recipe** and **Remove from collection**. The red "Remove" text beside
      the title goes (E25).
    - The source label ("Added by you" / "From source collection", existing keys) moves into the row's last line,
      `caption`, with a person or link icon.
    - **Remove is undoable:** the row leaves at once (optimistic), and a snackbar (`UndoSnackbar`, shared §12a, new) "Removed Pasta from Weeknight
      Dinners. Undo" stays for 6 s, then commits. No confirm dialog: removal does not delete the recipe
      (FR-012), so undo is the right safety (`interaction-motion.md`, undo beats confirm). Focus moves to the next
      row's link, or to the H2 if it was the last.
    - Paginated with "Load more (4 more)" (existing).
- **Delete collection** keeps its confirm dialog (it is irreversible): "Delete Weeknight Dinners? The 6 recipes
  stay in your library." with **Delete collection** (destructive) and **Keep collection**.
- **States:** member list empty: "No recipes here yet" + **Add recipes** (existing keys `detail.emptyTitle`,
  `emptyBody`). Not found: the 404 body (§N) inside the shell, with "Back to Collections". Load error: existing.
  Refresh fail: existing notice in the header. Pull-preview dialog: existing, out of scope here.

### C.4 Add recipes to a collection (picker)

- Focused task. Top bar: back "‹" ("Back to {collection}") and title "Add recipes" (truncate:1).
- **The collection name leaves the H1** (E8). H1 "Add recipes" (`pageTitle`). Under it, `meta`: "To Weeknight
  Dinners the Whole Family Will Actually Eat" (truncate:2, full name in the accessible name).
- `SearchField` "Search your recipes", sticky under the top bar while the list scrolls.
- **Rows** (`content-list`): 64 px thumbnail, title (`cardTitle` 16 px, truncate:2), meta line, and a trailing
  control in a fixed 96 px column so every title gets the same width:
    - Not in the collection: **Add** (`Button size="sm" variant="secondary"`, icon +).
    - In the collection: a `status-neutral` badge "✓ Added" in one line. Pressing the row's trailing area does
      nothing (it is status). To remove, use the detail page. The words "In this collection" (two lines today) are
      replaced by "Added" (`picker.alreadyAdded`, new value). 5 characters fit in 96 px at +35%.
    - After **Add**: the button turns into "✓ Added" with a polite announcement "Added Pasta".
- **Done** is a pinned footer button at `@narrow` ("Done · 3 added", new ICU key `picker.doneWithCount`), and a
  header-row button at `@regular`+. Both return to the detail page.
- **States:** no recipes at all (existing `emptyTitle`/`emptyBody` + **Write a recipe**); no matches (existing
  `noMatchesTitle` + **Clear search**); loading (existing); error (existing alert).

### C.5 Platform translation (Collections)

| Element                 | Web                                                | Native                                                                                                                         | Disposition | Why                            |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------ |
| Entry                   | Third Recipes tab                                  | Third Recipes tab (exists)                                                                                                     | kept        | IA.1                           |
| Detail actions          | Right rail at `@wide`, overflow below              | **Add recipes** + overflow sheet                                                                                               | collapsed   | rail needs 288 px              |
| Visibility choice       | In the rail                                        | In the overflow sheet as "Make private"                                                                                        | moved       | it is a rare action on a phone |
| Remove member           | Row "⋯" menu + undo snackbar                       | Row "⋯" sheet + undo snackbar; swipe-to-remove **not** added (it would be the only swipe in the app, and it is undiscoverable) | translated  | parity of job                  |
| Rename / Delete buttons | In the overflow menu                               | In the overflow sheet (fixes M7's 30 pt targets)                                                                               | moved       | targets and Fitts              |
| Picker Done             | Header button `@regular`+, pinned footer `@narrow` | Pinned footer, above the keyboard                                                                                              | moved       | thumb zone                     |

---

## §P. Profile, settings and account (web `web/src/app/[locale]/{profile,settings,account}/*`, `features/account/src/*`; native `profile.tsx`, `AccountSettings.tsx`)

The populated Profile and Account states were **not captured** (the identity read is server-side). This section
is specified from source (`ProfileContent.tsx:86-97`, `AccountContent.tsx:73-90`) and the mockup.

### P.1 Structure (IA.3)

One "Profile" destination, `content-reading`, left-aligned. Sections in this order, each an H2 `sectionTitle`
with a 20 px icon, inside one `white` card per section (radius `lg`, padding 16 at `@narrow`, 24 above):

1. **Profile card** (top, no H2): 72 px avatar (initials), display name (`pageTitle`, wrap:2), email (`meta`,
   `slate`, `overflow-wrap: anywhere` because it is an unbroken string), and **Edit profile** (secondary).
2. **Preferences**: today only "Food data sources" → `/legal/sources` as a 56 px link row with a chevron.
3. **Session**: **Sign out** (`Button variant="secondary"`). Label "Sign out", 8 characters. The old label "Sign out
   of your account" wrapped at 320 (E7). The accessible name stays "Sign out" (no hidden extra words).
4. **Danger zone** (H2 "Danger zone", sentence case): two 56 px rows, each with a title, one line of plain
   consequence text and a trailing destructive-ghost button: **Close account** ("Signs you out and deactivates your account. Support can restore it." New key
   `danger.close.rowHint`, condensed from the existing `danger.close.description`) and **Erase my
   data** ("Permanently deletes your account and personal data." New key `danger.erase.rowHint`). The card has a 1 px
   `error-dark`-at-40% border. Both keep their existing confirm dialogs (`ConfirmDialog`, CR-002 / U4b).

- `@wide` adds the mockup's section nav: a 200 px sticky list of anchor links (Profile, Preferences, Session,
  Danger zone) on the inline start. Below `@wide` there is no section nav. The page is short enough to scroll.
- Native: the same four sections on one screen. `AccountSettingsScreen` becomes a section of Profile, not a
  separate destination (`AppRoot.tsx` `'account'` id is removed). Edit profile pushes the existing edit form.

### P.2 Platform translation

| Element       | Web                     | Native                 | Disposition           | Why                         |
| ------------- | ----------------------- | ---------------------- | --------------------- | --------------------------- |
| Section nav   | `@wide` only            | none                   | dropped below `@wide` | page fits in ~2 screens     |
| Edit profile  | Inline form in the card | Pushed screen (exists) | translated            | keyboard space on phones    |
| Avatar upload | (not built on web)      | `AvatarField` (exists) | n/a, out of scope     | existing gap, not this pass |

### P.3 Copy

All headings sentence case: "Edit profile", "Danger zone", "Account settings" (E12). Values in
`webMessages.profile.*`, `webMessages.account.*`, `webMessages.settings.*` and their `mobileMessages` mirrors.

### P.4 States

| State                      | Shown                                                                                                                                                                                               | Copy                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Loading                    | Profile card skeleton (avatar disc, two text bars). Other sections render (they do not need the read).                                                                                              | `profile.loadingLabel` (new)                                      |
| Profile read failed        | Profile card shows: "We couldn't load your profile." + **Try again** (primary). Session and Danger zone still render, so the user can still sign out. Sign out is **not** the error's action (E15). | `profile.loadError` (existing value, kept), `profile.retry` (new) |
| Saved                      | Inline "Saved" next to the card's title for 3 s, announced politely                                                                                                                                 | `profile.saved` (new)                                             |
| Suspended / closed account | Existing `AccountStateNotice` at the top of the page                                                                                                                                                | exists                                                            |

## §L. Legal sources (`web/src/app/[locale]/legal/sources/SourcesContent.tsx`)

- `content-reading`. Top bar title "Data sources" (truncate:1, so no wrap at 320, E33), back button to Profile.
- Each source card: H2 publisher ("USDA"), dataset name as body 600, then a `dl`. At `@narrow` the `dt` stacks
  above its `dd`. At `@regular`+ a two-column `dl` (`dt` 120 px). Links show "↗" and carry the visually hidden
  text "(opens in a new tab)" (E33), and they do open in a new tab.

## §A. Sign in and sign up (`web/src/app/[locale]/sign-{in,up}/*`, `ui/src/clerk.ts`; native `login.tsx`, `signup.tsx`)

- **Web, one change in the design system, not per page:** `clerkAppearance.elements.card.padding` becomes
  responsive: `1.5rem` below 480 px, `2.5rem` above. The page wrapper's horizontal padding goes from `px-4` to
  `px-0` below 480 px, and the card becomes full-bleed (radius 0, no shadow) there. At 320 the column grows from
  about 200 px to 272 px, so "Continue with Google" and the placeholders fit (E23). Mechanism: Clerk's
  `appearance.elements` takes "additional classes and styles" (clerk.com/docs/customization/overview, checked
  2026-10-08), so pass a class string for the responsive part (`ui/src` is already scanned by Tailwind,
  `globals.css` `@source`). Verify in a real `next build` at 320 before closing E23.
- Header: keep the fork-and-whisk mark. The title stays "Sign in to Commise" (Clerk's localisation key
  `signIn.start.title`), in the `pageTitle` role, wrap:2. ⚠️ **OWNER (copy only, optional):** the subtitle "Welcome back! Please sign in to
  continue" could carry the brand line from the deleted welcome hero, "Cook with confidence. Plan with ease."
  This is the only place a signed-out visitor learns what the product is (an accepted consequence of FR-045a).
- The footer link "Don't have an account? Sign up" is a sentence. It may wrap, but the link text "Sign up" must
  not break across lines (`white-space: nowrap` on the link **only**, which is safe because the link is 7
  characters and cannot cause a reflow failure).
- **Sign-up fields** ⚠️ **OWNER.** First name, last name, username, email, password: five fields before any value
  (`interface-patterns.md`). The app's handle is `profiles.displayName` (owner ruling, memory
  `001-mockup-parity-reconciliation`), so Clerk's username is not used by the app. Recommendation: in the Clerk
  dashboard, make username off and first/last name optional or off. That is an instance setting. No code change.
- **Native** (`login.tsx`, `signup.tsx`, custom forms): same order and copy. Fields use `@commise/ui/input`.
  The primary button is pinned above the keyboard (`KeyboardAvoider`, exists). Email uses
  `keyboardType="email-address"`, `autoComplete="email"`, `textContentType="username"`. Password uses
  `textContentType="password"` (sign in) or `"newPassword"` (sign up), so password managers work (SC 3.3.8:
  allowing paste and managers is what satisfies Accessible Authentication).

## §N. Not found (404)

- **Outcome required:** any unknown path, signed in or out, shows a branded page:
    - Signed in: inside the app shell (sidebar or tab bar visible), so the user is never stranded.
    - Signed out: on the sign-in canvas (gradient, no shell).
- **Mechanism:** for `staff-architect` (E2). Either middleware that redirects an unknown first segment to
  `/{defaultLocale}/{path}` so `[locale]/not-found.tsx` handles it, or a root `app/not-found.tsx` with a minimal
  root layout that loads `globals.css`. I do not choose between them.
- **Body** (`RouteNotFoundState.tsx`, restyled): `content-reading`, centred block (a terminal moment), 96 px line
  illustration (an empty plate), H1 "We can't find that page" (`pageTitle`), body "The link may be old, or the
  page may have moved.", then **Go to Home** (primary) and, signed in, **Search recipes** (secondary, to
  Discover). Signed out: **Sign in** (primary). Keys: `boundary.notFound.title` and `.description` (new
  values), `boundary.notFound.home` (new), `boundary.notFound.search` (new).
- `role="alert"` is removed from this block (`RouteNotFoundState.tsx:23`). A 404 is a page, not an interruption.
  Focus goes to the H1 on load, and the document title is "Page not found · Commise".

---

## §Copy. Content rules for these screens

- **Sentence case everywhere** (`content-design.md`). This changes, at least: "Today's Nutrition" → "Today's
  nutrition", "This Week's Meals" → "This week's meals", "Create from Scratch" → "Write a recipe", "Paste an
  Ingredient List" → "Paste an ingredient list", "Add Recipes" → "Add recipes", "Clone Collection" → "Clone
  collection", "Account Settings" → "Account settings", "Edit Profile" → "Edit profile", "Danger Zone" → "Danger
  zone", "My Recipes" → "My recipes", "Quick (<30m)" → "Quick (under 30 min)".
- **No "..." in placeholders.** A placeholder is a hint, not a trailing sentence.
- **Every string goes through the existing message objects** (`recipeMessages`, `discoveryMessages`,
  `collectionMessages`, `webMessages`, `mobileMessages`). New keys are named above where they appear. Counts use
  ICU plurals (`formatPlural`, existing).
- **Glossary** (one word per concept): _recipe_ (not "dish"), _collection_ (not "list" or "folder"), _Discover_
  (the public catalogue, replaces "Community"), _clone_ (copy someone's recipe), _draft_ (not saved as a
  finished recipe).

## §X. Accessibility contract (all screens in this file)

| Topic              | Rule                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headings           | One H1 per page (visible or visually hidden, per §S/PageHeader). H2 for sections and rails. H3 for card titles inside a sectioned page. No skipped levels.                                     |
| Landmarks          | `nav` (sidebar, tab bar: two different accessible names, existing), `main`, `header` (top bar). The filter panel is an `aside` named "Filters".                                                |
| Route change       | Focus moves to the page H1 (existing `headingRef` pattern). The document title is "{page} · Commise".                                                                                          |
| Dialogs and sheets | Focus moves in, is trapped, Escape and Back close, focus returns to the trigger (existing `@commise/ui` rules).                                                                                |
| Live regions       | Result counts (polite), add/remove/undo (polite), errors (`role="alert"`). Nothing announces while typing.                                                                                     |
| Targets            | 44 px on coarse pointers and native (48 dp on Android for tab bar items), 24 px minimum on fine pointers (SC 2.5.8).                                                                           |
| Contrast           | Text ≥ 4.5:1, large text and UI boundaries ≥ 3:1. Every new pair is listed in shared §4.                                                                                                       |
| Colour alone       | Never. Selected = fill + check. Difficulty = tint + meter. Status = icon + word.                                                                                                               |
| Reflow             | No horizontal page scroll at 320 CSS px on any screen. Rails and chip rows scroll inside themselves.                                                                                           |
| Text spacing       | Every layout survives SC 1.4.12 overrides (line height 1.5, letter 0.12em, word 0.16em) with no clipping: no fixed heights on text containers. Row cards use `min-height`, not `height`.       |
| Zoom               | Usable at 200% (SC 1.4.4). At 200% on a 1280 window, `<main>` is about 512 px, so every page takes its `@narrow` layout. That is the container rule doing its job.                             |
| Reduced motion     | All entrance animations and the rail's smooth scroll are disabled under `prefers-reduced-motion: reduce` (existing `motion-safe:` pattern).                                                    |
| Native             | `accessibilityRole` per control as listed in shared §7–§9. Dynamic Type / font scale up to 200% reflows the same way as web zoom: row cards grow in height, labels never truncate in controls. |

## §M. Motion

| Moment                   | Duration / easing                           | Reduced motion       |
| ------------------------ | ------------------------------------------- | -------------------- |
| Sheet open / close       | existing `@commise/ui/sheet`                | existing             |
| Undo snackbar in / out   | 200 ms ease-out / 150 ms ease-in, rise 8 px | fade only, 0 ms rise |
| Row removed (collection) | height collapse 200 ms ease-out             | instant              |
| Rail prev/next           | `scroll-behavior: smooth`                   | `auto`               |
| Section enter (existing) | 400 ms ease-out (globals.css)               | none (existing)      |

No other motion is added.

## §E. Edge cases

| Case                                             | Rule                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Longest recipe title (120 characters)            | truncate:2 on cards, full text in the accessible name and on the detail page                                                                                                            |
| Longest collection name (80 characters)          | H1 wrap:3, then truncate. Top bar truncate:1.                                                                                                                                           |
| Unbroken string (an emoji run, a URL in a title) | `overflow-wrap: anywhere` on the title **block** (not a flex item, shared §1)                                                                                                           |
| 0 recipes / 0 collections                        | first-run states (§R.3, §C.1)                                                                                                                                                           |
| 1 recipe                                         | grid keeps column widths (auto-fill, not auto-fit), so one card is not stretched to 1000 px                                                                                             |
| 2,000 recipes                                    | paginated load-more (existing), count shows "2,000 recipes" via `Intl.NumberFormat`                                                                                                     |
| 40 tags on one recipe                            | card shows what fits on one line, then "+N" (shared §12, row 5)                                                                                                                         |
| Calories unavailable                             | the calorie item and its separator are removed from row 3, nothing else moves                                                                                                           |
| German / Finnish (+35%)                          | every control in this file has a stated room that fits at 320 at +35%; if a translation still does not fit, the control's row re-lays out (stacks), it does not wrap inside the control |
| Right-to-left                                    | all layout uses logical properties (`inline-start/end`). The FAB moves to the inline-end corner, which is the left in RTL. Back chevrons mirror. Clock and play glyphs do not.          |
| Slow network (> 1 s)                             | skeletons as specified per state, the pending bar on search (existing, 500 ms)                                                                                                          |
| Offline                                          | §S.5 strip, cached content, writes queue (existing offline port)                                                                                                                        |

## §O. Out of scope

- Recipe detail, versions, the create/edit wizard, ingredient rows, the paste and parse flow
  (`specRecipeAndWizard.md`).
- Building Meal Plan, Grocery, Nutrition or notifications.
- Dark mode. The token system has no dark surfaces today. Doing it properly is a second design
  (`visual-systems.md`), not part of this pass.
- Avatar upload on web.
- The pull-updates preview dialog (unchanged).

## §Q. Decisions that need the owner (each has a recommendation, none blocks the build)

| #   | Decision                                                                                                                  | My recommendation                                                                                                                                                                            | Door           |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Q1  | Where Collections lives on web                                                                                            | Third tab under Recipes, as on mobile (IA.1)                                                                                                                                                 | one-way        |
| Q2  | Rename "Community" to "Discover"                                                                                          | Yes, label only, no URL change (IA.1)                                                                                                                                                        | one-way (term) |
| Q3  | Hide unbuilt destinations from the phone tab bar                                                                          | Yes. Keep them in the sidebar and drawer with "Soon" (IA.2)                                                                                                                                  | two-way        |
| Q4  | Merge Profile, Settings and Account                                                                                       | Yes, one Profile page, old URLs redirect (IA.3, §P)                                                                                                                                          | one-way (URLs) |
| Q5  | Home order: live widget first, placeholders after                                                                         | Yes (§H.1). Flip by registry order.                                                                                                                                                          | two-way        |
| Q6  | Clerk sign-up fields                                                                                                      | Username off, names optional (§A)                                                                                                                                                            | two-way        |
| Q7  | Brand line on the sign-in card                                                                                            | Optional copy change (§A)                                                                                                                                                                    | two-way        |
| Q8  | Remove the notifications bell until a service exists                                                                      | Yes (§S.2)                                                                                                                                                                                   | two-way        |
| Q9  | The phone **row card** (list view) defers tags and version to the detail page. CR-002 says every card shows the full set. | Allow it for the list view only. The grid view keeps all CR-002 fields, and the user can switch (§R.1). If refused, the row card adds a one-line "v12 · 3 tags" caption and grows to 132 px. | two-way        |

## §Z. Success measure and hand-off

- **Falsifiable signals:**
    1. A Playwright check at 320, 390, 768, 1280 and 1920 on every route in this file asserts
       `scrollWidth === innerWidth` (no sideways scroll) in the loading **and** loaded states.
    2. A visual check asserts no control label renders on more than one line (measure each `button`, `[role=tab]`,
       chip and tab-bar label: `getClientRects().length === 1` on its text node) at 320 with pseudo-localised
       strings (+35%).
    3. On a 390 × 844 viewport, the first recipe card on Recipes and Home is fully inside the first screen.
    4. Re-shoot the full capture set (`.local-sandbox/uiAudit…`) and the Pixel 6 set (with real Discover,
       Collections and Profile shots this time) and re-run this evaluation. Target: no severity 3 or 4 left.
- **Guardrail:** recipe-creation starts from the library (FAB menu opens per session) must not fall after the
  empty-state and menu changes. If analytics exists for it, watch it for two weeks after release.
- **Next actors:**
    - `staff-architect`: the 404 routing mechanism (§N), moving the native tab bar to `AppRoot` and the root back
      intercept (§S.3), the Profile/Account URL merge and redirects (IA.3), and whether the collection create
      contract carries a description (§C.2).
    - Design-system work in `packages/apps/commise/ui` (shared §0, S0–S7): this agent owns it, and can make it on
      request.
    - `fe-1`: screen slices P1–P8 in order, after the shared slices they depend on.
- **State to carry forward:** context = home cook, phone-first, one hand. Direction = this file plus the shared
  file. Flip conditions: Q1 (if Collections must be top level), Q5 (if Home order is fixed by the owner).
