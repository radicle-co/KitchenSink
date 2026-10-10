# UI overhaul: shared design-system decisions (`@commise/ui`)

⛔ **DESIGN SPECIFICATION. NOT PRODUCTION CODE.** It decides the rules both halves of the overhaul build on, so each
rule is made once, in `packages/apps/commise/ui`, and not again per screen.

- **Mode:** SPECIFY. **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`.
- **Authors and sections.** Two agents share this file. §1–§12 come from the shell-and-lists pass
  (`evaluateShellAndLists.md`, `specShellAndLists.md`). §13 is reserved for the recipe-and-wizard pass
  (`evaluateRecipeAndWizard.md`). Append there. Do not edit another author's section. Raise a conflict under §14.
- **Accessibility level claimed:** WCAG 2.2 AA (no other binding level found in `CLAUDE.md` or the 001 spec).
  Touch targets meet Apple HIG 44 pt on iOS and Material 48 dp on Android. Native is the stricter case, so it wins
  there. Web meets 44 CSS px on a coarse pointer and 24 CSS px (SC 2.5.8) on a fine pointer.
- **Governing decisions in force:** the mockups are the floor, not the ceiling (owner ruling, memory
  `001-mockup-parity-reconciliation`). Desktop gets a left sidebar. Tablet and phone get a bottom tab bar (owner UX
  directive, 2026-07-18). The FAB is the only way to create a recipe on both platforms (`recipe-list.md`,
  "Create affordance (canonical)"). Every recipe card shows the full CR-002 field set (`recipe-list.md`,
  "Merged recipe card"). This file obeys all of them.

## 0. Build order

Build in this order. Each slice can ship by itself. Each slice fixes a class of defect on every screen that
uses it.

| Slice | What                                                                                       | Fixes (see `evaluateShellAndLists.md`) |
| ----- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| S0    | Tokens: `pewter` border, difficulty tones, the role type scale, layout widths (§2–§4)      | E11, E12, E18                          |
| S1    | The overflow rule (§1) written into the docs and the `Button`, `Chip`, `PageHeader` leaves | E3, E5, E7, E8                         |
| S2    | `PageHeader` (§6), new, web and native                                                     | E3, E9, E12                            |
| S3    | `Chip` and `ChipRow` (§7), new, web and native                                             | E5, E7, E10                            |
| S4    | `Tabs` (§8), new, web and native                                                           | E19, M5                                |
| S5    | `SearchField` (§9), new, web and native                                                    | E11                                    |
| S6    | `Button` adoption: 29 bespoke buttons across 27 files move onto `@commise/ui/button` (§10) | E7, E30                                |
| S7    | Native type and elevation: register Inter, fix the Android elevation map (§3, §11)         | M3, M4                                 |
| S8    | Card anatomy (§12), changed in `features/recipes/src/card`, not in `ui`                    | E6, E17, E29                           |
| S9    | `UndoSnackbar` (§12a), new, web and native                                                 | E25                                    |

## 1. The overflow rule (one rule, cited by every element)

When text does not fit, try these in order. Stop at the first one that works at **320 CSS px with the string 35%
longer** (German/Finnish expansion, `internationalisation.md`).

1. **Re-lay out.** Give the element more room: move actions below the title, stack a row, or drop a column.
2. **Shorten the label.** The visible label must still be contained in the accessible name (WCAG 2.5.3).
3. **Wrap**, to a stated line count. Allowed only for content: titles, descriptions, body copy. **Never inside a
   control or a short label** (owner rule, memory `wrappingInControlElements`): buttons, chips, tabs, badges,
   meta values, tab-bar labels.
4. **Truncate** with an ellipsis, as a last resort, and only where the full text is reachable one step away (the
   detail page, or an accessible name plus `title`).

⛔ Never fix overflow with `white-space: nowrap` on a container. That turns a wrap into a horizontal page scroll,
which fails WCAG 1.4.10. A single-line _control_ label is guaranteed by giving it room (step 1), never by
`nowrap`.

⛔ Never put `overflow-wrap: break-word` (Tailwind `break-words`) on a **flex item**. It lets the item's
min-content width shrink to one character, so a flex sibling with `shrink-0` squeezes the text into a column
broken mid-word. That is the cause of defect E3 (`CollectionHeader.tsx:82`). Use `overflow-wrap: anywhere` only
on unbroken user strings (URLs, emails, IDs), and only on a block that is not a flex item.

**The test for every text element in a spec:** state its rule as one of `relayout@<width>`, `wrap:N`, or
`truncate:N`. An element with no stated rule is unspecified.

## 2. Breakpoints and layout widths

### 2.1 Two breakpoint systems, each with a different job

**Viewport (shell only).** Three classes, named after Material's window size classes:

| Class      | Viewport width | Navigation                                    | Page gutter       |
| ---------- | -------------- | --------------------------------------------- | ----------------- |
| `compact`  | < 640 px       | top bar plus bottom tab bar                   | 16 px (`space-4`) |
| `medium`   | 640–1023 px    | top bar plus bottom tab bar (owner directive) | 24 px (`space-5`) |
| `expanded` | ≥ 1024 px      | left sidebar plus top bar. No tab bar         | 32 px (`space-6`) |

These map to Tailwind's existing `sm` (640) and `lg` (1024). The shell already switches at `lg`
(`HomeTabBar.tsx:53`, `lg:hidden`). Keep it there. Do not add new shell breakpoints.

**Container (everything inside `<main>`).** Content responds to the width of `<main>`, not the viewport. The
sidebar takes 256 px at `expanded` (`HomeSidebar.tsx:75`, `w-64`), so a 1280 px viewport gives `<main>` only
about 1024 px. Grids that key off the viewport put four 222 px cards in that space (E6). Mark `<main>` as
`@container/main` (`HomeChrome.tsx`, the `<main>` element), and write content rules against these widths:

| Container class | `<main>` width | Used for                                                    |
| --------------- | -------------- | ----------------------------------------------------------- |
| `@narrow`       | < 600 px       | one column. Page actions go below the title                 |
| `@regular`      | 600–959 px     | two-column grids. The page header fits on one row           |
| `@wide`         | ≥ 960 px       | three or more grid columns. Side rails (collection actions) |

Native uses the same three classes against the window width (`useWindowDimensions`), because a native screen
fills its window.

### 2.2 Three content widths (they replace six)

The audit measured six different content widths: 448, 608, 640, 736, 896 and 1120 px
(`max-w-md`, `max-w-lg`, `max-w-2xl`, `max-w-3xl`, `max-w-4xl`, `max-w-6xl` across 9 files). That is why pages
look misaligned with each other: the left edge of the content moves from page to page under a fixed top-bar
title. Replace them with three named widths, all left-aligned to the same gutter:

| Token (new)       | Value            | For                                                                           |
| ----------------- | ---------------- | ----------------------------------------------------------------------------- |
| `content-reading` | 40 rem (640 px)  | forms, settings, profile, account, legal, empty states, the 404               |
| `content-list`    | 48 rem (768 px)  | single-column lists: the collection recipe picker                             |
| `content-wide`    | 80 rem (1280 px) | grids and dashboards: Home, Recipes, Discover, Collections, collection detail |

**Alignment rule.** Content is **left-aligned to the page gutter**, not centred, at every width. Today Home is
centred in 1664 px at 1920 (left gutter of about 380 px, `HomeWidgetSurface.tsx:110`) while the top-bar title
sits at the left edge. Left-aligning puts the H1, the top-bar title and the sidebar's active item on one vertical
line. Centring is reserved for short terminal moments: the sign-in card, an empty state's inner block, the 404.

**Emission.** Emit the three widths as `--container-reading`, `--container-list` and `--container-wide`.
`--container-*` is Tailwind v4's namespace for `max-w-*` sizes. Verify it compiles, as `themeCss.ts`'s header
requires for any new family, and cover it in `tailwindTheme.integration.test.ts`. Native gets the same numbers
in `nativeTokens.layout`.

## 3. Type: one role scale

The size ramp in `tokens/scale.ts` (`fontSize`) stays as it is. The defect is that screens pick sizes and faces
freely: page titles use `display-md` in a glass card on one page and `text-lg` in the top bar on the next, card
titles are Playfair on web and system sans on Android, and widget titles are Inter while their neighbour
"Recent recipes" is Playfair (E12). Add **roles**. A screen names a role, never a size.

| Role (new token) | Face                      | Size (px), compact → ≥600 container | Weight  | Line height | Overflow rule             |
| ---------------- | ------------------------- | ----------------------------------- | ------- | ----------- | ------------------------- |
| `greeting`       | Playfair Display          | 28 → 36 (`displayMd` → `displayLg`) | 700     | 1.2         | wrap:2                    |
| `pageTitle`      | Playfair Display          | 24 → 28 (`headingLg` → `displayMd`) | 700     | 1.2         | wrap:3, then truncate     |
| `sectionTitle`   | Inter                     | 18 (`headingSm`)                    | 600     | 1.25        | wrap:2                    |
| `cardTitle`      | Inter                     | 16 → 18 (`bodyMd` → `headingSm`)    | 600     | 1.3         | truncate:2 (full in name) |
| `chromeTitle`    | Playfair Display          | 18 (`headingSm`)                    | 600     | 1.2         | truncate:1                |
| `body`           | Inter                     | 16 (`bodyMd`)                       | 400     | 1.5         | wrap                      |
| `meta`           | Inter, tabular numerals   | 14 (`bodySm`)                       | 400/500 | 1.4         | never wraps. See §12      |
| `label`          | Inter                     | 14 (`bodySm`)                       | 600     | 1.2         | never wraps (control)     |
| `caption`        | Inter                     | 12 (`caption`)                      | 500     | 1.4         | truncate:1                |
| `overline`       | Inter, uppercase, +0.06em | 11 (`overline`)                     | 600     | 1.4         | never wraps               |

Decisions behind the table:

- **Playfair is kept for three roles only:** the greeting, the page title and the chrome title. That is the
  brand budget (`visual-systems.md`: "one or two moments of distinctiveness"). The mockups agree: their card
  titles and section heads are sans semibold (`screenHome.html`, `screenRecipes.html`). Playfair's wide
  set-width at 18 px is also why web card titles cut after about 20 characters in a 190 px column (E6, E29).
- **Section titles are Inter** everywhere. The discovery rails' Playfair H2 and its 32 px teal underline bar go.
  One heading level, one face.
- **`body` never goes below 16 px for inputs**, so iOS Safari does not zoom on focus.
- **Native must register Inter.** `mobile/App.tsx:66` loads only `PlayfairDisplay_600SemiBold` and
  `PlayfairDisplay_700Bold`, so every native body string renders in Roboto (Android) or SF (iOS), not the brand
  face (M3). Add `@expo-google-fonts/inter` (400, 500, 600, 700) and a `bodyFontFace` map beside `displayFontFace`
  in `scale.ts`, guarded by the same test (`nativeFontFace.test.ts`). Native roles then select a face by weight,
  never `fontFamily` + `fontWeight` together.
- **Android greeting face (observed, cause open).** On the Pixel 6, the Home greeting renders in a system bold
  sans although `HomeGreeting.tsx:44` names `PlayfairDisplay_700Bold`, while the top-bar title, which names
  `PlayfairDisplay_600SemiBold`, renders in Playfair. The difference between the two styles is `fontWeight: '700'`
  next to the face. The implementer must find the cause. Two things to check: whether a numeric `fontWeight`
  beside a single-weight registered face makes Android fall back to the system face, and whether `useFonts`'s
  result gates the first render (`App.tsx:66` does not appear to read it). The role rule above, a face per
  weight and no separate `fontWeight`, removes the first possibility by construction.

## 4. Colour tokens added or re-assigned

All pairs computed with the WCAG 2.x relative-luminance formula on 2026-10-08.

| Token (new)                 | Value / composition                               | Use                                          | Contrast                                    |
| --------------------------- | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `pewter` (primitive)        | `#858F93`                                         | the boundary of any input or unselected chip | 3.31:1 on white, 3.07:1 on sand (SC 1.4.11) |
| `border-control` (semantic) | `pewter`                                          | input, chip and select outlines              | as above                                    |
| `difficulty-easy`           | fill `success` at 15% on white, text `ocean-dark` | difficulty pill                              | 5.40:1                                      |
| `difficulty-medium`         | fill `warning` at 15%, text `warning-dark`        | difficulty pill                              | 4.64:1                                      |
| `difficulty-hard`           | fill `coral` at 15%, text `charcoal`              | difficulty pill                              | 11.21:1                                     |
| `status-neutral`            | fill `pearl`, text `charcoal`, with an icon       | Draft, Private, Public, version badges       | ≥ 11:1                                      |

Why:

- **Input boundaries.** Search fields and chips today sit as white or pearl pills on the sand canvas with a
  `border-border` hairline: `rgba(178,190,195,0.3)`, which is 1.19:1 against white. White on sand is 1.08:1.
  Nothing marks the field's edge (E11). WCAG 1.4.11 asks for 3:1 on the visual information _needed to identify_
  the component. A search field whose only cue is its placeholder text is at risk under that criterion. I call it
  a probable failure, because the W3C Understanding document leaves room for judgement. It is a usability defect
  either way. `mist` (1.90:1) and `coral` (2.40:1) are both too light for this job.
- **Difficulty vs status vs error.** Today "Hard" uses the `error` fill (`RecipeCard.tsx`, `TONE_CLASS.error`),
  so a recipe's difficulty reads as a fault. And "Draft" uses the same solid `warning` amber as "Medium", so the
  two badges look alike in one row (E17. Nielsen #4). Difficulty keeps the mockup's green/amber/red _hue
  family_ (mockups are the floor) but as tints, and it adds a three-step meter glyph (`●○○`, `●●○`, `●●●`), so
  difficulty never depends on colour (SC 1.4.1). Status badges go neutral and carry an icon: pencil for Draft,
  lock for Private, globe for Public. `error` goes back to meaning only "something failed".
- **Selected state.** One treatment for every selectable chip, tab and segment (§7, §8): a `seafoam` fill with
  `white` text (4.67:1) and a leading check glyph. Seafoam on white as an _outline only_ passes 1.4.11 at 4.67:1,
  so the discover filters' outline-only selected state is not a contrast failure. The defect is that the app has
  three different selected treatments (E10): seafoam fill (library facets), seafoam outline (discover filters)
  and charcoal fill (sort).

## 5. Spacing roles

The 4 px ramp (`scale.spacing`) stays. Name its uses, so space _between_ groups is always larger than space
_within_ them (Gestalt proximity):

| Role              | Value               | Note                                                  |
| ----------------- | ------------------- | ----------------------------------------------------- |
| `gap-inline`      | 4 (`space-1`)       | icon to its label                                     |
| `gap-within`      | 8 (`space-2`)       | items inside one group: chips, meta items, badges     |
| `gap-group`       | 16 (`space-4`)      | between groups inside a card or section. Card padding |
| `gap-section`     | 32 (`space-6`)      | between page sections                                 |
| `gap-grid`        | 16 (`@narrow`) → 24 | between grid cards                                    |
| page gutter       | 16 / 24 / 32        | by viewport class (§2.1)                              |
| header-to-content | 24 (`space-5`)      | PageHeader bottom margin                              |

Card padding is 16 everywhere, on both platforms. Today it is 16 on web cards, 20 (`p-5`) on collection cards and
24 (`p-6`) on the collection form.

## 6. `PageHeader` (new, web and native)

**Why new:** every list page hand-builds its header, and three of them break: the glass H1 card on Recipes
(110 px tall for one word at 320, `RecipeListFrame.tsx:35-37`), the collection title squeezed into a mid-word
column (`CollectionHeader.tsx:74-86`), and "New collection" wrapping inside its button
(`CollectionListFrame.tsx:26-33`). Fewer than three instances would not justify a primitive. There are six.

**Path:** `packages/apps/commise/ui/src/layout/PageHeader.tsx` and `PageHeader.native.tsx`, exported from
`@commise/ui/layout`.

**Contract:**

```ts
interface PageHeaderProps {
    readonly title: string; // the visible H1 text, plain string (no nodes)
    readonly titleVisibility: 'visible' | 'chrome'; // 'chrome' = the top bar shows it; H1 is visually hidden
    readonly eyebrow?: ReactNode; // back link ("← Collections"), above the title
    readonly meta?: ReactNode; // one line under the title: counts, badges
    readonly actions?: ReactNode; // 1–2 Buttons; never more (Hick)
    readonly headingRef?: Ref<HTMLHeadingElement>; // route-change focus target
}
```

**Layout:**

- `@narrow`: title row full width. `actions` sit in their own row **below** the title and meta, left-aligned,
  with `gap-within`. Rule for the title: `relayout@narrow`, then `wrap:3`, then truncate with the full text in
  the accessible name.
- `@regular` and up: one row. Title block `flex: 1 1 16rem; min-width: 0` (a real basis, so it can never
  collapse to a column). Actions `flex: 0 0 auto`, aligned to the title's first baseline. If the actions do not
  fit beside a 16 rem title, the row wraps the actions _as a group_ to the next line (flex-wrap on the row,
  never inside a button).
- No card, no gradient surface behind the title. The glass hero card goes on every list page (it adds a box with
  no job, and it is not in the mockups. `screenRecipes.html` shows no H1 card at all).
- `titleVisibility: 'chrome'` is for top-level destinations (Home, Recipes, Discover, Collections), where the
  top bar already shows the same word (`HomeTopBar.tsx:108`). The H1 stays in the DOM, visually hidden but still
  the route-change focus target, so the page outline is intact and "Recipes / Recipes" is not printed twice at 320. This matches the mockups, which show the title only in the top bar.
- Native: same slots. The title is `accessibilityRole="header"`. `actions` go below at `@narrow` as on web.

## 7. `Chip` and `ChipRow` (new, web and native)

**Why new:** filter, facet, sort, difficulty-picker and tag chips are hand-built in at least five places, with
three selected treatments and no wrap rule. At 320 the library facet row wraps to five lines (E5).

**Path:** `ui/src/chip/Chip.tsx`, `Chip.native.tsx`, `ChipRow.tsx`, `ChipRow.native.tsx`, `props.ts`,
exported as `@commise/ui/chip`.

**Contract:**

```ts
type ChipKind = 'filter' | 'choice' | 'tag'; // filter = multi-select, choice = single-select, tag = display only
interface ChipProps {
    readonly kind: ChipKind;
    readonly label: string; // ≤ 24 characters shown; longer truncates with full text in the name
    readonly selected?: boolean; // not allowed for kind 'tag' (make the type forbid it)
    readonly count?: number; // facet count, rendered after the label in `meta`, slate
    readonly onPress?: () => void; // required unless kind is 'tag'
}
interface ChipRowProps {
    readonly label: string; // accessible group name ("Filter recipes")
    readonly overflow: 'scroll' | 'wrap'; // 'scroll' on @narrow, 'wrap' allowed from @regular
    readonly children: ReactNode;
}
```

**Visuals:**

- Height 36 px visual. Hit area 44 px on a coarse pointer and on native (vertical padding grows. The visual pill
  does not). 24 px minimum on a fine pointer (SC 2.5.8). Horizontal padding 12. Radius `full`.
- Default: `white` fill, 1 px `border-control`, `label` text in `charcoal`.
- Selected (`filter`, `choice`): `seafoam` fill, `white` text, a 16 px check glyph before the label. The check is
  what makes selection survive greyscale and colour-blindness (SC 1.4.1).
- Tag: `status-neutral` fill, no border, `caption` text, not focusable.
- Focus: 2 px `ocean-dark` ring with a 2 px offset (`ring-offset`), distinct from hover. Hover (fine pointer
  only): `pearl` fill.
- **The label never wraps** (§1, control). The row gives it room instead:
    - `overflow: 'scroll'`: one line, horizontal scroll _inside the row_ (`overflow-x: auto`,
      `scroll-snap-type: x proximity`), with 16 px of trailing padding so the last chip clears the edge, and a
      24 px fade on the trailing edge while more content exists. This is the wireframe's own rule
      (`recipe-list.md`, Layout Notes: "Filter chips: Horizontal scroll. Active = filled"). The page never scrolls
      sideways (SC 1.4.10).
    - `overflow: 'wrap'`: at most two lines. A third line means the screen has too many chips there. Move the extra
      ones into the filter sheet (§12 of `specShellAndLists.md`).
- **Semantics.** `filter`: a `button` with `aria-pressed`. `choice`: a `radiogroup` of `radio`s, arrow keys move
  the selection, Tab enters and leaves the group once. Native: `accessibilityRole="checkbox"` / `"radio"` with
  `accessibilityState={{ checked }}`.

## 8. `Tabs` (new, web and native)

**Why new:** the web source tabs give the selected tab a white fill, a shadow and a 2 px seafoam underline, and
give unselected tabs a pearl fill and a 1 px slate underline (`RecipeSourceTabs.tsx`, `SELECTED` / `UNSELECTED`).
Two tabs side by side look like two different components (E19). The native top tabs copy it
(`RecipeSourceTab.native.tsx`). The mockup's own tabs are plain text with an underline.

**Path:** `ui/src/tabs/Tabs.tsx`, `Tabs.native.tsx`, exported as `@commise/ui/tabs`. Two forms from one
contract: `role="tablist"` when the tabs switch panels in place, and `nav` + `aria-current="page"` when each tab
is a route (the web source tabs are routes, and they must stay routes so Back works).

**Visuals:** no fill on any tab. Label in `label` role. Unselected: `slate` text (4.87:1 on sand). Selected:
`ocean-dark` text plus a 3 px `seafoam` bar under the label (seafoam on sand is 4.34:1, above the 3:1 non-text
floor). One 1 px `border-control`-at-40% rule runs under the whole strip. Each tab is at least 44 px tall and
as wide as its label plus 16 px each side.

**Overflow:** tabs never wrap and never truncate (§1, control). If the strip is wider than its container (three
tabs at 320 with German labels), it scrolls horizontally inside its own row, and the selected tab is scrolled
into view on mount.

## 9. `SearchField` (new, web and native)

**Path:** `ui/src/searchField/SearchField.tsx`, `.native.tsx`, exported as `@commise/ui/search-field`.
**Why new:** four hand-built search inputs (`RecipeListFrame.tsx:55`, `RecipeDiscoveryFrame.tsx`,
`CollectionRecipePicker.tsx:53`, `RecipeFilterBar.tsx`) with no search icon, no clear button and a 1.19:1 border.

- Height 48 px. Radius `full`. 1 px `border-control`. `white` fill. 16 px text (`body`).
- Leading 20 px search glyph (`slate`, `aria-hidden`). A trailing clear button (`×`, 44 × 44 hit area, accessible
  name "Clear search") appears when the value is not empty and returns focus to the input.
- A visible label is required by the contract (`label: string`). Where the design shows no visible label, the
  label is visually hidden, but it is never placeholder-only.
- `type="search"`, `enterKeyHint="search"`, `autocomplete="off"`. Native: `returnKeyType="search"`,
  `clearButtonMode="never"` (the primitive draws its own, so both platforms match).

## 10. `Button`: adopt it everywhere, add a size, keep the wrap fallback

`@commise/ui/button` exists and is good (`surfaceClass.ts`: 44 px on touch, focus ring, busy state). But 29
primary buttons in 27 files are hand-built from raw classes like `rounded-full bg-seafoam px-5 py-2.5`
(`grep -rn "rounded-full bg-seafoam px-"` over `features/` and `web/src`), so they miss the focus ring token, the
touch minimum and the busy state. The fix is adoption, not a new component.

Changes to the primitive:

1. **Add `size: 'md' | 'sm'`.** `md` is today's button. `sm` is 36 px visual (44 px hit on coarse pointers)
   for in-card actions like Clone and Add. This removes the remaining reasons to hand-build.
2. **Add `variant: 'ghost'`** (text in `ocean-dark`, no fill, `pearl` on hover). It replaces the hand-built
   text buttons: Rename, Cancel, Done, "Save changes" in the collection rail.
3. **`destructive-ghost`** for Remove and Delete in rows and headers, with `error-dark` text.
4. **The wrap fallback stays.** The label may wrap to two lines, balanced, only as the last resort before
   overflow. Screens must never rely on it: every button in `specShellAndLists.md` has a stated label length
   that fits at 320 plus 35%. Do not add `nowrap` (§1).
5. **`width: 'fill'`** (exists) is the default for primary buttons in sticky footers and in `@narrow` empty
   states.

## 11. Elevation on Android

`tokens/native.ts` sets Android `elevation` equal to the shadow's vertical offset (`elevation: spec.offsetY`), so
`md` (offset 4) becomes elevation 4 and `lg` becomes 10. Android draws elevation much darker than the web's
4–8% shadows, so native cards carry a heavy grey halo that the web does not (M4, Pixel 6 library capture). Map
Android elevation by _level_, not offset: `sm` 1, `md` 2, `lg` 3, `xl` 6, `glow` 0. Keep `shadowOffset` and
`shadowRadius` for iOS as they are. This is a value change with a wide blast radius (every native surface that
uses elevation), which is the point. Re-shoot the Pixel captures after it lands.

## 12. Recipe card anatomy (lives in `features/recipes/src/card`, decided here because both halves use it)

The card is shared by Home, My Recipes, Community, Discover rails and results, and the collection picker's
future thumbnails. The field set is fixed by CR-002 (`recipe-list.md`, "Merged recipe card"): photo, title,
cuisine, total time, lead calories, difficulty, rating average and count, tags, version, visibility, relative
time, PRO. **Nothing is removed.** The defect is hierarchy: the same fields are poured into up to nine stacked
rows, chips stack one per line, and card heights in one grid row range from 270 to 520 px (E6).

Two variants, chosen by the **card's own container width**, not by the device:

**Grid card** (container ≥ 240 px). Fixed row order. Every row is one line. Rows align across a grid row through
CSS `grid-template-rows: subgrid` on the card (the grid declares the row tracks), so a row of cards shares one
height and every title, meta line and footer sits on the same baseline across the row.

| Row | Content                                                                                                                                                                                                                                                                                                                                                                                                                             | Rule                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cover, 4:3. PRO badge top-right on the cover (existing).                                                                                                                                                                                                                                                                                                                                                                            | No photo: `pearl` cover with a 32 px dish glyph and the cuisine word under it in `caption`, still 4:3 so the row stays aligned. |
| 2   | Title, `cardTitle`                                                                                                                                                                                                                                                                                                                                                                                                                  | truncate:2. Full title in the link's accessible name                                                                            |
| 3   | Meta: clock + total time · people + servings · calories ("420 cal". "~612 cal" when estimated)                                                                                                                                                                                                                                                                                                                                      | one line. At card content width < 200 px, calories moves to row 4. Never wraps.                                                 |
| 4   | Difficulty pill (tint + meter, §4) · rating: 5 stars at 14 px + "4.2 (18)" in `meta`, or "No ratings yet"                                                                                                                                                                                                                                                                                                                           | one line. CR-002 requires average **and** count. Today only stars show.                                                         |
| 5   | Cuisine chip, then tags as `Chip kind="tag"`, as many as fit on one line, then "+N"                                                                                                                                                                                                                                                                                                                                                 | one line. Overflow collapses into "+N", never a second line                                                                     |
| 6   | Footer, `caption`, `slate`: version (when > 1) · visibility as icon + word (globe "Public", lock "Private") · relative time, e.g. "v12 · 🌐 Public · Edited 2d ago". A draft shows a `status-neutral` "✎ Draft" badge **in place of** the visibility item (draft ruling, `recipe-list.md`). Community cards: "by @handle" first, and the Clone button (`Button size="sm" variant="secondary"`) right-aligned on its own line below. | truncate:1 for the handle. Items drop from the end (time first) rather than wrap.                                               |

Empty rows keep their subgrid track, so a recipe with no tags still aligns with a neighbour that has them.

**Row card** (container < 240 px, and the default list view on phones. See `specShellAndLists.md` §R).
Thumbnail 88 × 88 (radius `md`) on the leading side. Text column: title (truncate:2), row 3 meta, then one line
with difficulty, rating and the status word. Tags and version are deferred to the detail page on this variant,
by stated disposition. The card is 112 px tall, so a 390 × 844 phone shows four whole recipes on the first screen of the library,
instead of less than one.

**Loading skeleton** matches the variant's rows exactly (same subgrid), so nothing shifts on load. **The calorie
placeholder** (the empty grey pill seen on every card) is part of this: it gets a fixed `3.5rem` width inside
row 3 and does not wrap to its own line. If the calorie read fails, the slot collapses and the separator dot
goes with it.

## 12a. `UndoSnackbar` (new, web and native)

**Why new:** no toast or snackbar exists in `@commise/ui` (checked by grep). The shell-and-lists spec needs undo in
two places (remove a recipe from a collection, change a collection's visibility), and undo is the right safety
for reversible actions (`interaction-motion.md`: undo beats confirm). Two instances now, more coming (recipe
delete is a candidate for the other pass).

**Path:** `ui/src/undoSnackbar/UndoSnackbar.tsx`, `.native.tsx`, exported as `@commise/ui/undo-snackbar`.

```ts
interface UndoSnackbarProps {
    readonly message: string; // "Removed Pasta from Weeknight Dinners." Full sentence, one key.
    readonly undoLabel: string; // "Undo"
    readonly onUndo: () => void;
    readonly onTimeout: () => void; // commit
    readonly durationMs?: number; // default 6000. Paused while hovered or focused.
}
```

- Position: bottom centre, 16 px above the tab bar (phones) or the window foot (desktop). Max width 36 rem.
  `charcoal` fill, `white` text (12.68:1). Undo is a text button in `seafoam-light` (4.56:1 on charcoal, the
  existing cook-mode pair in `docs/mockups/README.md`), `label` role, 44 px hit area.
- One at a time. A new one replaces the old one, and the old one commits.
- `role="status"` (polite). Undo is reachable by keyboard: the snackbar does not steal focus, and its timer
  pauses while it has focus or hover, so a keyboard user can reach it in time (SC 2.2.1).
- Message wrap:2. The Undo label never wraps (control).

## 13. Recipe-and-wizard pass (reserved)

Author: the recipe-and-wizard pass (`evaluateRecipeAndWizard.md`, `specRecipeAndWizard.md`), 2026-10-08. It uses
§1–§12 as written. Everything below is additive. Nothing here changes a rule above.

### 13.1 One new type role: `heroTitle`

| Role        | Face             | Size                                | Weight | Line height | Rule |
| ----------- | ---------------- | ----------------------------------- | ------ | ----------- | ---- |
| `heroTitle` | Playfair Display | 28 → 36 (`displayMd` → `displayLg`) | 700    | 1.2         | wrap |

For the recipe title on the detail page only. It is the page's one Playfair moment, inside §3's brand budget
(it replaces `pageTitle` there). Why not `pageTitle` (24 → 28): the recipe title is the subject of the page,
not a label for it, and the mockup sets it at display size (`screenRecipeDetail.html`).

### 13.2 Input geometry, both platforms (fixes N1)

- One field shape: radius `full` for single-line fields, `md` for multi-line, a 1 px `border-control` border (§4),
  48 px tall, `body` 16 px, horizontal padding 16. Native `ui/src/input/Input.native.tsx` adopts it, so native
  fields stop being 10-radius rectangles with a raw `rgba` border (`formSectionStyles.native.ts`).
- **NEW `FieldLabel`** (`ui/src/input/`): the visible label above every field, `label` role in `slate`, optional
  hint in `caption`. It owns `htmlFor` / `aria-labelledby`. A placeholder is an example, never the label
  (WCAG 3.3.2).
- **NEW `DurationField`**: hours and minutes fields under one `FieldLabel`. Value in seconds. Empty means absent,
  so it never shows "0".
- **NEW `Stepper`**: `[−] value [+]`, buttons 44 px (web, iOS) / 48 dp (Android), value tabular, minimum 1.
- **NEW `formatDuration`** (pure, `packages/shared/recipe-core`): `{minutes} min`, `{hours} h`,
  `{hours} h {minutes} min`. Every surface that shows a time uses it. Raw seconds and "300 min" go.

### 13.3 The wizard step rail (fixes W1, N3)

At `compact` the rail is one line of text, "Step {current} of {total} · {name}", plus a 4-segment progress bar
(4 px high). From `medium` it is the labelled rail, on one line. It never wraps. The native rail's deliberate
`flexWrap` (`Wizard.native.tsx:341-346`) goes.

### 13.4 Action-menu presentation (fixes N2)

Every "more actions" control uses `@commise/ui/actionMenu`: a menu anchored to its trigger on web (it flips above
when there is no room below, so it never sits under the tab bar), and the primitive's titled sheet on native. A
destructive item comes last, after a divider. No screen renders its own disclosure panel of buttons as a menu.

### 13.5 Combobox (fixes R7)

`rowEditorOpenDecisions.md` V3-1 to V3-4 (popup side, chrome insets, a 3-option floor, the active-option ring)
are shared-primitive work in `@commise/ui/combobox`, not step-2 work. ⚠️ V3-M1 was scoped "below `lg`". The wizard bar is
now a sticky footer at every width (`specRecipeAndWizard.md` §S1.1), so the chrome insets apply at `expanded` too.

### 13.6 Requests to the shell (§6 and the top bar)

1. Wizard routes below `expanded`: the wizard's own header replaces the app top bar (one title, one Back).
2. The top-bar title is `chromeTitle`, `truncate:1` at every width. It wraps today on Version history, New recipe
   and Paste ingredients at 320.

## 14. Conflicts between the two passes

_None recorded yet. If a rule here contradicts the other pass, record both positions and the reason here rather
than editing the other author's section._

- **2026-10-08, recipe-and-wizard pass: none open.** Its first draft set section titles in Playfair 20 and card
  padding at 24 from 640 px. It adopted §3 (`sectionTitle`, Inter 18) and §5 (card padding 16) instead.
  `specRecipeAndWizard.md` §S0 cites this file.
- **2026-10-08, shell-and-lists pass: §13.6 accepted, both items.** (1) `specShellAndLists.md` §S.5 now lets a
  focused task supply its own header that replaces the top bar below `expanded`. (2) The top-bar title is already
  `chromeTitle`, `truncate:1` at every width (`specShellAndLists.md` §S.2). §13.1 `heroTitle` and §13.2–§13.5
  are compatible with §1–§12. No conflict open.
