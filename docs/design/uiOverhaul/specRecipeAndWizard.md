# UI overhaul spec: recipe detail, versions, wizard, ingredient rows, paste flow

⛔ **DESIGN SPEC. NOT PRODUCTION CODE.** `fe-1` builds from it. The findings it fixes are in
`evaluateRecipeAndWizard.md` (IDs F*, R*, D*, V*, W*, S*, I*, RV*, P*, N*).

- **Mode:** SPECIFY. **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`. One design per screen and state.
- **Purpose.** A home cook reads a recipe at the counter, often on a phone held in one hand. Separately, they enter
  or fix a recipe across four steps, on a phone or a laptop. Every screen must answer its question at a glance, fit
  without wrapping a control, and look like the mockups' calm, editorial product. If anything here is unclear,
  choose the reading that lets the cook do the task with fewer lines and fewer taps.
- **Accessibility level:** WCAG 2.2 AA (the repo's floor, CLAUDE.md). Touch targets: 44 × 44 pt on iOS (HIG),
  48 × 48 dp on Android (Material), 44 × 44 CSS px on touch web. The strictest applies per platform
  (`device-ergonomics.md`). The `Button` primitive already holds 44 px (`ui/src/button/surfaceClass.ts`).

## Governing decisions: built on, or overturned

| Decision                                                                                                          | Here                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingredientStatusExplanation.md` rev 6: "The row is a WRAPPING row"                                               | **Overturned** (§S4). The read row is one line. The fields live in a single expanded editor. Cause: R1. ⚠️ Owner confirmation asked (O2).                                                                                                                                                          |
| Same file, §3a: the column is always exactly two slots, `[state] [actions]`                                       | **Built on and enforced** (§S4.2). Remove moves into ⋮ for every state.                                                                                                                                                                                                                            |
| Same file, V3 amendment: the name takes the row's first full line                                                 | **Built on.** The name leads the read row.                                                                                                                                                                                                                                                         |
| §2a: the name field is the picker. U28 (a resolved name is read-only)                                             | **Built on, unchanged.**                                                                                                                                                                                                                                                                           |
| `ingredientStatusExplanation.md` §2d: after a pick, focus returns to the re-emptied trailing combobox (F1's loop) | **Amended, the loop kept** (§S4.1). After a pick the new row's editor opens with Amount focused. Enter in Amount, Unit or Preparation, or `Done`, closes the editor and puts focus back in the trailing combobox. Escape does the same. So the keyboard loop is pick → amount → Enter → next food. |
| U32 and the `Wizard.tsx` module doc: at `lg` the bar sits in the sticky header band                               | **Overturned** (§S1.1). The bar is a sticky footer at every width. Cause: W3 (navigation before content). Cost: `rowEditorOpenDecisions.md` V3-1's chrome insets were scoped "below `lg`" and now apply at `expanded` too (§S4.5, shared §13.5).                                                   |
| `rowEditorOpenDecisions.md` V3-1 to V3-4 (popup side, insets, floor, active ring)                                 | **Built on.** Still owed. Slice 1 carries them.                                                                                                                                                                                                                                                    |
| `rowEditorOpenDecisions.md` P1 to P12 (list order, states, copy)                                                  | **Built on, unchanged.**                                                                                                                                                                                                                                                                           |
| `compactHeightLayout.md` A1 (bar unpins past half the frame), A5 (`mediaBoxHeight`), A7                           | **Built on.** §S1 and §S2 reuse the rules.                                                                                                                                                                                                                                                         |
| `ingredientSpecialization.md` S8 (details dialog)                                                                 | **Built on.** One change: the Sheet is `size="content"` on phones (§S4.7).                                                                                                                                                                                                                         |
| Figma briefs 1 and 2 (`docs/mockups/briefs/`)                                                                     | **Built on:** compact rows with one row mid-edit, range behind a toggle, groups set at the section level.                                                                                                                                                                                          |
| Wireframe `recipe-detail.md`: one "Hero photo carousel"                                                           | **Built on.** It fixes F2.                                                                                                                                                                                                                                                                         |
| Wireframe `recipe-edit.md`: step 4 = "Photos + Save"                                                              | **Built on in part:** step 4 becomes "Photos & review" (§S6). Owner confirmation asked (O3).                                                                                                                                                                                                       |
| Mockup `screenRecipeDetail.html`: Cook, Add to Meal Plan, grocery icon                                            | **Out of scope.** No feature exists. Not drawn as dead buttons.                                                                                                                                                                                                                                    |
| `form/limits.ts`: title cap 64 ("an open question")                                                               | **Recommend 120** (O1).                                                                                                                                                                                                                                                                            |

## Build order (slices, after the shared primitives)

Each slice ships web and native together (CODING_STANDARDS §14) and ends with Playwright + Maestro on that slice.

0. **Shared primitives** (§S0, owned with the other UX agent): duration formatter, `FieldLabel`, wrap/truncate
   rules, `Stepper`, typography tokens on native, V3-1 to V3-4 in `@commise/ui/combobox`.
1. **Functional fixes** that need no layout: F1 (durations), F3 (review ranges), F5 (no default quantity), F4 (title
   cap and soft limit), and the display rule for an empty nutrition total (F7).
2. **Wizard frame** (§S1): header, progress, sticky footer bar, inline errors.
3. **Ingredient row** (§S4). The largest slice.
4. **Steps 1, 3 and 4** (§S1.2, §S5, §S6).
5. **Recipe detail** (§S2), then **versions** (§S3).
6. **Paste flow** (§S7), after owner decision O4.

---

## S0. Shared rules these screens use

`specSharedSystem.md` (§1–§12, the shell-and-lists pass) is the authority for every shared rule. This spec cites
it and adds only what my surfaces need, in that file's §13. Where my first draft differed, I adopted theirs.

### S0.1 Type: the shared role scale (`specSharedSystem.md` §3)

| My element                                                      | Role                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Recipe title on detail                                          | **`heroTitle`**, new, requested in §13: Playfair 28 → 36 (`displayMd` → `displayLg`), 700, wrap (no clamp) |
| Wizard step title, "Version history", paste heading             | `pageTitle` (Playfair 24 → 28)                                                                             |
| Wizard header title (< expanded)                                | `chromeTitle` (truncate:1)                                                                                 |
| Ingredients, Instructions, Nutrition, card titles in the wizard | `sectionTitle` (Inter 18, 600). This matches the mockup (`mockup-fidelity/report.json`: sans 18 px)        |
| Group heading (For the filling)                                 | `label`, `text-slate`                                                                                      |
| Ingredient name, step text, description                         | `body`                                                                                                     |
| Amounts, durations, counts                                      | `meta` (tabular numerals)                                                                                  |
| Field labels, status words                                      | `label`                                                                                                    |
| Counters, footnotes, the parse source line                      | `caption`                                                                                                  |

⛔ No other size on these screens. Native's raw 13, 15 and 11 (N1) map to `meta`, `label` and `caption`.

### S0.2 Spacing and widths (`specSharedSystem.md` §2, §5)

`gap-within` 8 · `gap-group` 16 · `gap-section` 32 · card padding 16 on both platforms. Widths: the wizard,
versions and paste use `content-reading` (640). Recipe detail uses `content-wide` (1280). Content is
left-aligned to the page gutter (their §2.2), not centred. Breakpoint words below are their viewport classes:
`compact` < 640, `medium` 640–1023, `expanded` ≥ 1024.

### S0.3 Wrap and truncate (`specSharedSystem.md` §1)

Every text element below carries one of their rules, `relayout@<width>`, `wrap:N` or `truncate:N`:

| Element                                   | Rule                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Button, chip, tab, menu item, step marker | never wraps (control). Room comes from a shorter label or a full-width slot. Their §10 wrap fallback stays for 200% text only. |
| Wizard header title                       | `truncate:1` (`chromeTitle`). The full title is in the field below.                                                            |
| Recipe title (detail)                     | `wrap` (content).                                                                                                              |
| Recipe title (wizard field)               | an auto-growing field, up to 3 lines, Enter blocked. It never scrolls sideways (F10).                                          |
| Ingredient name (read row)                | `wrap:2`, then truncate. The full name is in the open editor and the accessible name (`ingredientStatusExplanation.md` §3e).   |
| Prep text (read row)                      | `truncate:1`.                                                                                                                  |
| Step text, description                    | `wrap`, measure `max-w-[65ch]` (`visual-design.md`, 45–75 characters).                                                         |
| Tag chips (detail)                        | `ChipRow` (their §7): `overflow: 'scroll'` at `compact`, `'wrap'` (2 lines max) from `medium`.                                 |
| Ingredient amount (read row)              | never wraps (`meta`). Its column is sized to the longest realistic amount, "12–14 tbsp" (≈ 96 px).                             |

Buttons use their §10 variants: `ghost` for Done, Add a range and Cancel; `destructive` items live only in
`ActionMenu`; `size: 'sm'` for in-card actions.

### S0.4 New or changed primitives (also recorded in `specSharedSystem.md` §13)

| Primitive                                                                             | Path                                                 | Contract                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NEW** `formatDuration(seconds, messages)`                                           | `packages/shared/recipe-core/src/duration.ts` (pure) | Rounds to the minute. `< 60 min` → `{minutes} min`. Whole hours → `{hours} h`. Else `{hours} h {minutes} min`. 0 or absent → `undefined` (the caller shows nothing). Library first: use `Intl.DurationFormat` where the runtime has it (check Hermes before relying on it), with the three message keys as the fallback. |
| **NEW** `FieldLabel`                                                                  | `ui/src/input/` (web + native)                       | A visible label above a field. `label` role, `text-slate`. Optional `hint` in `caption`. It owns `htmlFor`/`aria-labelledby`. Fixes R2 and I3 across forms.                                                                                                                                                              |
| **NEW** `DurationField`                                                               | `ui/src/input/`                                      | Two number fields, `h` and `min`, with one `FieldLabel`. Value in seconds. Empty = absent (never shows "0"). 48 px tall.                                                                                                                                                                                                 |
| **NEW** `Stepper`                                                                     | `ui/src/input/`                                      | `[−] value [+]`. Each button 44 px (web/iOS) or 48 dp (Android). Value in `sectionTitle` size, tabular. Min 1. Used by Serves (detail and step 1).                                                                                                                                                                       |
| CHANGED `Combobox`                                                                    | `ui/src/combobox/`                                   | Build V3-1 to V3-4 (`rowEditorOpenDecisions.md`). It fixes R7.                                                                                                                                                                                                                                                           |
| CHANGED native `Input`                                                                | `ui/src/input/Input.native.tsx`                      | Shared §13.2 geometry: radius `full` single-line, `md` multi-line, `border-control`, 48 px (N1).                                                                                                                                                                                                                         |
| Reused `ActionMenu`, `ConfirmDialog`, `Sheet`, `DialogFrame`, `Button`, `StatusBadge` | `ui/src/*`                                           | As they are, with `Button width="fill"` (R9 in `rowEditorOpenDecisions.md`).                                                                                                                                                                                                                                             |

### S0.5 Requests to the shell owner (not mine to define)

1. On the wizard routes below `expanded`, hide the app top bar. The wizard header (§S1.1) replaces it. That saves 56 px
   and removes the doubled title (W2).
2. The app-bar title is 1 line with an ellipsis at every width (W1, V1, P3: it wraps today at 320).
3. Recipe detail: the shell top bar keeps its title "Recipe". The page's own Back pill goes (§S2.1).

---

## S1. Wizard frame (`features/recipes/src/wizard/Wizard.tsx`, `.native.tsx`)

### S1.1 Layout

```
below `expanded` (phone, small tablet)                         `expanded` (desktop)
┌───────────────────────────────────────┐         shell sidebar │ ┌─ content column, max-w 880 ───────────────┐
│ ←  New recipe                       ⋮ │ 56      (shell top bar │ │ Edit recipe              Step 2 of 4    ⋮ │
│ Step 2 of 4 · Ingredients             │         stays)         │ │ ①Details ─ ②Ingredients ─ ③… ─ ④…        │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░ │ 4       (rail, 1 line) │ │                                           │
│                                       │                        │ │  step body                                │
│  step body                            │                        │ │                                           │
│                                       │                        │ │───────────────────────────────────────────│
├───────────────────────────────────────┤                        │ │ ‹ Previous     Save draft   [ Next: … › ] │ sticky
│ [‹]  [Save draft]   [  Next  ›      ] │ 72 pinned              │ └───────────────────────────────────────────┘
└───────────────────────────────────────┘
```

- **Header (below `expanded`).** Back (44 px icon button, name "Leave the editor"), then the title, then ⋮. Title: "New
  recipe" on create. On edit, "Edit recipe". Not the recipe's own title (N4: it is already in the field). 1 line.
  Background `bg-card`, bottom border `border-border`. Sticky top.
- **Progress (`compact`).** One text line, "Step 2 of 4 · Ingredients", `meta`, `text-slate`, then a 4-segment bar,
  4 px high, `bg-seafoam` filled / `bg-pearl` empty, a 2 px gap between segments. It never wraps (W1). The
  segments are not buttons. Step jumps live in the ⋮ menu ("Go to step…") at `compact`.
- **Progress (`medium`+).** The existing 4-step rail, on one line. Each step is a 44 px button, marker 24 px. A 24 px
  hairline joins the markers. In the 640 px `content-reading` column about 592 px is usable after padding. The rail needs about 520 px. It fits.
- **Content column.** `content-reading` (640), left-aligned to the gutter (§S0.2). The step body is cards. At `expanded` the step title is a `PageHeader` (`specSharedSystem.md` §6) with `pageTitle`.
- **Controls bar, all widths: sticky at the BOTTOM of the content column.** One rule for every width (W3). At
  `lg` it is `sticky bottom-0` inside the column, not the viewport. Below `expanded` it is `fixed inset-x-0 bottom-0`,
  as today, with `env(safe-area-inset-bottom)`. The `compactHeightLayout.md` A1 unpin rule applies unchanged.
    - **`compact`:** `[‹]` Previous as a 48 px icon-only secondary (name "Previous: {step}"), `[Save draft]` secondary,
      then `Next` primary with `width="fill"`. The labels are "Save draft" and "Next". No step name at `compact`, so
      no wrap.
    - **`medium`+:** "Previous" text secondary at the left. "Save draft" and "Next: {step}" at the right, 12 px apart.
      The primary always sits at the bottom right, where the thumb or the reading eye ends (thumb zone, and
      reading order).
    - The last step's primary is "Publish" (create) or "Save changes" (edit of a published recipe).
- The ⋮ menu (`ActionMenu`): "Go to step…" (`compact` only), "Discard changes" (destructive). Its trigger name is "More
  editor actions".

### S1.2 Step 1 Details (`form/RecipeBasicsFields.tsx`, `.native.tsx`)

Three cards, in this order. Labels use `FieldLabel` (S0.4).

1. **Basics:** Title (auto-growing, up to 3 lines, S0.3), counter `{n}/{max}` right-aligned under it in
   `caption`. Description (textarea, 4 rows min, counter).
2. **About this dish:** Cuisine (select), Meal type (chips), Difficulty (chips), Dietary flags (chip input), Tags
   (chip input). Chips are 44 px tall. `medium`+: Cuisine and Meal type side by side, the rest full width.
3. **Time and servings:** Servings (`Stepper`), Prep (`DurationField`), Cook (`DurationField`), then "Total
   {duration}" as text, computed (hidden while both are empty). `medium`+: three columns. `compact`: Servings on its own row,
   then Prep and Cook side by side (each about 140 px at 320: 2 fields of 60 px fit).

Photos and visibility move to step 4 (§S6, O3).

**Soft title limit (F4).** No `maxLength`. Past the cap the counter turns `text-error-dark`, the field gets
`aria-invalid`, and the error shows under it. Nothing is cut silently.

### S1.3 Errors (W4)

A refused Next shows each error **under its field** (`label` role, `text-error-dark`, an error glyph, linked by
`aria-describedby`). The field border turns `border-error`. Focus moves to the first invalid field. The bar keeps
one short live line: "Fix 1 thing to continue" / "Fix {count} things to continue" (polite). The rail marks the
step "needs attention", as it does today.

### S1.4 States

Empty (create): the fields are empty, there is no "0" anywhere, and Next is enabled (validation runs on press).
Loading (edit): skeleton cards with the real card heights. Saving draft: "Save draft" is busy. On success a
polite "Draft saved" status. Save failed: an inline alert above the bar, "We couldn't save your draft. Try again."
Offline: the existing offline notice (`ui/src/offlineNotice`). Discard: `ConfirmDialog` (§S2.4 style). First run
(create, both platforms): native's "Let's build your recipe" card (N5) shows on web too, above Basics, and is
dismissible.

---

## S2. Recipe detail (`detail/RecipeDetailBody.tsx`, `.native.tsx`, `RecipeHero*`, `PhotoCarousel*`)

### S2.1 Layout

```
phone (`compact`)                               desktop (`expanded`, `content-wide`)
┌──────────────────────────┐              ┌──────────────────────────────────────────────────────────┐
│ [←]   hero carousel  1/3  │ 4:3, ≤0.4vh  │ [←]        hero carousel 16:9, max-h 480           1/3    │
├──────────────────────────┤              ├──────────────────────────────────────────────────────────┤
│ by @braise.club · Moroccan│ meta         │ by @braise.club · Moroccan · Public                      │
│ Slow-Roasted Lamb Shoulder│ title        │ Slow-Roasted Lamb Shoulder with Preserved Lemon, …       │
│ with Preserved Lemon …    │              │ description (65ch)                                        │
│ description (65ch)        │              │ [gluten-free] [dairy-free] [slow-cooked] [+3]            │
│ [gluten-free][dairy-…][+5]│              │ [ Edit recipe ] [⋯]                                      │
│ [   Edit recipe    ] [⋯] │ 48           │ ┌ Serves [−]8[+] │ Prep 30 min │ Cook 5 h │ Total 5 h 30 ┐ │
│ Serves      [−] 8 [+]     │              │ ┌─ Ingredients (5 cols, sticky) ─┐ ┌─ Instructions (7) ─┐ │
│ Prep 30 min│Cook 5 h│Total│              │ │ ☐ 2–2.5 kg Lamb shoulder …    │ │ ① The night before…│ │
│ Ingredients               │              │ │ ☐ …                           │ │ ③ … ⏱ 4 h 30 min   │ │
│ Instructions              │              │ └───────────────────────────────┘ └────────────────────┘ │
│ Nutrition                 │              │ Nutrition (4 across)                Rating                 │
│ Rating                    │              └──────────────────────────────────────────────────────────┘
└──────────────────────────┘
```

- **Hero = the carousel (F2, D4).** One surface. Slide 1 is the cover. Phone: 4:3, height capped by
  `mediaBoxHeight` (`ui/src/layout/mediaBox.ts`, 0.4 × window). `medium`+: 16:9, `max-h-[480px]`, radius `radius.lg` at
  `medium`+ and 0 (full bleed) at `compact`. A "1/3" counter chip at the bottom right, and dots below on phones. The separate
  carousel section is deleted. No photo: the existing 96 px placeholder.
- **Back (D7).** A 44 px round button on the hero, top left, `bg-white/90` with `shadow-sm`, glyph `charcoal`. Name
  "Back". The page's Back pill row is deleted. With no hero, it sits at the top left of the meta line.
- **Meta line.** "by @{handle}" (other people's recipes), then the cuisine, then (own recipes only) "Public" or
  "Private" as a `StatusBadge`. `meta`, `text-slate`, separated by " · ". It wraps as text if it has to.
- **Title (D1).** Full column width. `heroTitle` (§S0.1). No tinted card behind it (preference,
  labelled in the evaluation).
- **Description.** `body`, `text-slate`, `max-w-[65ch]`. No clamp.
- **Tags (D6).** A `ChipRow` (S0.3). Dietary flags and tags are `Chip kind="tag"`. The cuisine is in the meta line, not a chip.
- **Actions.** Own recipe: `Edit recipe` (primary) and `⋯` (44 px icon button, name "More actions for {title}").
  Someone else's: `Save a copy` (primary, today's "Clone", O5) and `⋯` (Version history only if allowed, else
  hidden). `compact`: the primary is `width="fill"` and ⋯ sits to its right. `medium`+: content width, left aligned.
- **Stats (D5, D8).** Phone: `Stepper` "Serves" on its own row, then a 3-column row Prep · Cook · Total. Values
  `sectionTitle`, tabular, via `formatDuration`. Labels `caption`, `text-slate`. `medium`+: one row of four cells
  in a `bg-card` card. A missing time hides its cell. It never shows "0 min".
- **Ingredients and instructions.** `expanded`: two columns, ingredients 5/12 and **sticky** (`top-[spacing[4]]`),
  capped at `max-height: calc(100dvh - top offset)` with its own `overflow-y: auto`, so a 20-line list stays reachable,
  they stay in view while the cook reads the steps. **This is the one thing that makes the page better than the
  mockup:** a cook working through step 5 still sees the amounts without scrolling back up. below `expanded`: one column,
  ingredients first.
    - Ingredient row: 44 px checkbox, then `{amount unit}` in `font-semibold`, then the name, then the prep in
      `text-slate`. It wraps as text (content, not a control). "Your own food" badge for a custom food (today's
      "Custom").
    - Step: a 32 px seafoam numeral, then the text (`body`, 65ch), then the timer as a 44 px chip
      `⏱ 4 h 30 min` (`bg-pearl`, `text-ocean-dark`). The chip is text now. It becomes the cook-mode start
      control when cook mode exists.
- **Nutrition (D12).** Four cells (calories, protein, carbs, fat), 2 × 2 at `compact`, 4 across from `medium`. Then one
  footnote block in `caption`: the estimate note (only when partial), and "From public food databases · Data
  sources". The custom-food note joins it only when a custom food is present.
- **Rating.** As today, with 44 px stars. Own recipe: the read-only average and "You can't rate your own recipe."

### S2.2 States

Loading: hero skeleton at the real ratio, plus title and stats skeletons (no layout shift). Error (load failed):
"We couldn't load this recipe." + `Try again`. Not found / private: "This recipe isn't available." + `Back to
recipes`. No photos: placeholder. No steps: "No steps yet." (own: + `Add steps` to the editor's step 3). No
ingredients: likewise. Nutrition unavailable: the existing slot states (`nutrition/`). Partial nutrition: the
figures + the estimate note. Draft (own): a `StatusBadge` "Draft" in the meta line replaces Public/Private.

### S2.3 More actions (D2, D3, N2)

`@commise/ui/actionMenu` on both platforms (web: a menu anchored to ⋯, flipping above when there is no room;
native: its sheet). Items, in order:

1. `Version history`
2. `Make private` or `Make public` (one item, the opposite of the current state). For a free-tier viewer:
   `Make private` opens an upsell sheet ("Private recipes are part of Premium.", `See Premium` / `Not now`). It is
   not a disabled item with a paragraph (F8 must be checked first).
3. Divider, then `Delete recipe` (`tone: 'destructive'`).

The menu never renders under the bottom navigation bar: the web leaf flips above the trigger, and the native leaf
is a sheet above it.

### S2.4 Delete confirmation (D11)

`ConfirmDialog` in `DialogFrame`, centred in the viewport. Title "Delete this recipe?" (`sectionTitle`). Body:
"“{title}” and its version history will be deleted. You can't undo this." The title in the body is clamped to 2
lines. Buttons: `Delete recipe` (destructive, **filled** `bg-error`, white text) and `Cancel` (secondary). `medium`+:
side by side, Cancel left, Delete right. `compact`: stacked full width, Delete on top. Busy: Delete shows its spinner and
both are locked. Failure: "We couldn't delete this recipe. Try again." inside the dialog. Focus opens on Cancel.

---

## S3. Version history (`versions/RecipeVersionList*`, `VersionCompareView*`, `VersionPreviewModal*`)

- **Header.** `PageHeader` (`specSharedSystem.md` §6): title "Version history" (`pageTitle`), `meta` = the recipe title
  (`truncate:1`). Back to the recipe is the shell's Back below `expanded` and a `secondary` Button "Back to recipe" (icon ←)
  at `expanded`. Not a Title Case link beside the H1 (V1).
- **Empty (V2).** A centred block, `max-w-[40ch]`: a 48 px clock glyph in `text-mist`, "No earlier versions yet"
  (`sectionTitle`), then "Each time you save changes, the version before is kept here. You can look at it or bring it
  back." Then `Back to recipe`.
- **Populated (not seen rendered. Check it).** One row per version, newest first: "Version {n}" + the relative time
  in `body`, then "by @{handle} · {device}" and the changed-fields summary in `meta`, `text-slate`, 1 line
  each with ellipsis. Actions per row: `Preview` (secondary) and the row checkbox for compare (44 px). Two checked
  ⇒ a sticky `Compare 2 versions` bar at the bottom (phone) or the top of the list (`expanded`).
- Loading: three skeleton rows. Error: "We couldn't load the history." + `Try again`.

---

## S4. Ingredient rows (step 2) (`form/RecipeIngredientsFields.tsx`, `.native.tsx`, `formSectionStyles*`)

### S4.1 The model: a read row, and one open editor

Every committed line shows as a **read row**. A tap (or Enter) on the row opens **its editor** in place. Only one
editor is open at a time: opening another closes the first, keeping its values (they are already in the draft).
Escape or `Done` closes it. A new line, just picked from the trailing list, opens its editor with the amount field
focused. Enter in any editor field, or `Done`, closes it and returns focus to the trailing combobox, so the add
loop needs no pointer (§2d, amended). This is Figma brief 1's "one row focused or expanded while the others stay compact".

### S4.2 Read row (every width)

```
[glyph]  2–3   Leeks, white and pale green parts only,     sliced into 1 cm…   [⋮]
               washed very thoroughly
```

- Grid, `min-h-14` (56 px), `items-start`, `gap-3`, vertical padding 8 px, a hairline divider between rows.
- **Slot 1, the state (44 px, the F2 panel trigger).** One glyph, coloured by state: resolved `text-ocean-dark`
  info glyph. Needs a choice / not resolved / failed `text-warning-dark` alert glyph. "as written" `text-slate`
  pencil glyph. Pending a spinner. It is the only state control (the separate status chip goes, R4, R10). Its name
  is "{state}, {food}: show details".
- **Amount.** `{low}–{high} {unit}`, `meta` at 16 px semibold, 1 line, column ≈ 96 px (S0.3). Absent amount: nothing (no "1",
  F5).
- **Name.** `body`, `text-charcoal`, 2 lines + ellipsis (S0.3). The variant ("roasted") follows on the same
  line after a comma, `text-slate`, inside the clamp.
- **Prep.** `medium`+: a column on the right, 1 line, `text-slate`. `compact`: it joins the name's second line after " · ".
- **State word, below the name, only for states that need action:** "Choose a match" (needs a choice), "No match
  found" (not resolved), "Couldn't look up" (failed), each `label`, `text-warning-dark`. It replaces "Needs a
  pick", "Not resolved" and "Resolution failed" (R10). It is text, not a chip.
- **Slot 2, ⋮ (44 px).** `ActionMenu` with: `Edit`, `Change food` (where `ingredientStatusExplanation.md` §2c
  allows it), `Add details` / `Edit details` (variant roots), `Move to group…`, `Move up`, `Move down` (2.5.7: a
  non-drag reorder), divider, `Remove` (destructive). **Remove is never a row button** (R4).
- Height budget: a typical line takes 1 line at `medium`+ and 2 lines at 320. Six ingredients fit one phone screen
  (≈ 6 × 64 px), against 2.5 screens today (R1).

### S4.3 Open editor

```
┌────────────────────────────────────────────────────────────┐  bg-pearl/60, radius md, padding 16
│ Leeks, white and pale green parts only, washed very…  [⋮] │  name, full text wraps here
│ Amount            Unit             Preparation             │  FieldLabel × 3
│ [ 2 ] – [ 3 ]     [ —        ▾]    [ sliced into 1 cm…   ] │
│ + Add a range                                     [ Done ] │
└────────────────────────────────────────────────────────────┘
```

- **Fields, with visible labels (R2):** Amount (60 px number), and when a range exists, "to" + High (60 px);
  Unit (combobox, 112 px). Preparation (fills the rest, ≥ 160 px). No group field (R3, §S4.4). `medium`+: one line.
  `compact`: Amount and Unit on line 1, Preparation full width on line 2.
- **Range (R5).** Hidden until `+ Add a range` (a text button, 44 px). With a range, it becomes `Remove range`.
- The name shows in full here (the place §3e guarantees).
- The state panel (nutrition, candidates, shortlist) opens from the glyph, as today, from the read row and the
  editor alike.
- `Done` (secondary, 44 px) closes the editor. Focus returns to the row.

### S4.4 Groups (R3)

- Ungrouped recipe: a flat list, with no group chrome (brief 2).
- Grouped: a heading row per group, `label`, `text-slate`, with its own ⋮: `Rename group`,
  `Add ingredient to this group`, `Remove group (keep its ingredients)`. Each group ends with its own trailing
  add row.
- Make a group: the step's footer has `+ Add a group` (text button). It asks for a name in an inline field and
  creates an empty group with its own add row.
- Move a row: ⋮ → `Move to group…` → a list of groups plus "No group".
- ⛔ The data model is unchanged (each line keeps its own `section` value). The section-level controls write the
  same field. This needs no API change. `staff-architect` confirms (hand-off).

### S4.5 Trailing add row and the open list

Unchanged in behaviour (P1 to P12). Visual changes: the field is a 48 px pill with a `FieldLabel` "Add an
ingredient" above it (not a placeholder only). The list is the `Combobox` popup with V3-1 to V3-4 (R7). "None of
these — search for a different food" becomes a single-line option row ("Search for another food"), last in the
list, `text-ocean-dark` (R8). Its full meaning is in its accessible name.

### S4.6 Nutrition total (F7)

The total is a card like the detail page's nutrition (§S2.1), smaller: four figures in `sectionTitle`, tabular, with labels in
`caption`. With no counted line it shows "—" in each cell and "Nutrition appears as you match ingredients."
Partial: the figures, then "{n} of {total} ingredients counted". Loading: the skeleton cells. Failed: "We couldn't
load nutrition." + `Try again`. ⛔ It never prints "0 cal" for "nothing counted".

### S4.7 Variant details dialog

Unchanged except on phones: `Sheet` with `size="content"` (`ui/src/sheet/props.ts:41`), so two options show a
short sheet, not a full-height one.

### S4.8 States, as the read row shows them (the panel contents stay as `ingredientStatusExplanation.md` §SPECIFY.1)

| State                        | Glyph (slot 1)                                                          | State word              | ⋮ items beyond Edit / Move / Remove |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| Resolved                     | info, `ocean-dark`                                                      | —                       | Change food · Add/Edit details      |
| Resolved, no figures         | info, `ocean-dark`                                                      | —                       | Change food                         |
| Pending                      | spinner                                                                 | "Looking it up…"        | —                                   |
| Needs a choice (`AMBIGUOUS`) | alert, `warning-dark`                                                   | "Choose a match"        | —                                   |
| Not resolved (`UNRESOLVED`)  | alert, `warning-dark`                                                   | "No match found"        | Change food                         |
| Failed (`NOT_FOUND`)         | alert, `warning-dark`                                                   | "Couldn't look up"      | Change food                         |
| As written (user-entered)    | pencil, `slate`                                                         | "No nutrition"          | Find a food                         |
| Food removed                 | alert, `warning-dark`                                                   | "Food no longer listed" | Change food                         |
| Busy (a commit in flight)    | spinner                                                                 | (unchanged)             | trigger `aria-disabled`             |
| Change food (entry)          | the editor opens in entry mode, the name is the combobox, with `Cancel` |                         |

---

## S5. Step 3 Instructions (`form/RecipeInstructionsFields.tsx`, `.native.tsx`)

- One card per step, in a list. Each card has a visible `FieldLabel` "Step {n}" with the 32 px seafoam numeral
  beside it, then **an auto-growing textarea** (min 2 lines, `body`). Fixes I1 and I2.
- Under the text: `DurationField` labelled "Timer (optional)" (I3). It stores seconds, as today.
- ⋮ per step: `Move up`, `Move down`, divider, `Remove step` (I4).
- At 320 the card is the full column. The textarea is the full card width (≥ 240 px). Nothing shares its row.
- `+ Add step` (secondary) at the end. A new step focuses its textarea.
- Empty: "No steps yet. Add the first one." + `Add step`. Error (none): "Add at least one step." under the
  heading, linked to the first field.

## S6. Step 4 "Photos & review" (`form/RecipeReviewFields.tsx`, `photos/RecipePhotoManager*`)

1. **Photos card.** The existing `RecipePhotoManager`. "Add photo" is a `Button` with an icon (S1). The first photo
   is labelled "Cover". Empty: "Add a photo. Recipes with a photo are easier to find." It is a hint, not a block.
2. **Checklist card ("Before you publish").** One row per issue, each a link to its step and row: "{n} ingredients
   need a match", "No photo yet", "No steps yet". All clear: "Everything is ready." with a success glyph. Issues do
   not block Publish unless the validator blocks it today.
3. **Visibility.** Public / Private as a 2-option radio group (cards, 56 px). Free tier: Private shows "Premium"
   and selects the upsell (§S2.3).
4. **Preview.** The real `RecipeDetailBody`, forced to its single-column layout (the frame is 640 px wide, so the
   viewport-keyed two-column rule must not apply), in a read-only preview frame, `bg-card`, with a caption "This is how it
   will look." It shows ranges correctly, which fixes F3 by construction (the review label function goes).

Publish (create) / Save changes (edit) is the bar's primary (§S1.1). Publish busy: spinner, bar locked. Publish
failed: inline alert above the bar. Conflict (409): the existing conflict view (`versions/RecipeConflictView*`).

## S7. Paste and parse (`parse/ParsePasteForm*`, `parse/ParseJobReview*`)

- **Paste.** `PageHeader` title "Paste your ingredients" (`pageTitle`, P2). Intro `body`, `text-slate`,
  65ch. `FieldLabel` "Ingredient lines", then a textarea, `font-mono` (as today), min 10 rows, `max-w-[72ch]`.
  The live count "{n} lines ready" sits under it, at the right. Buttons: `Read my ingredients` (primary) and `Back
to recipes` (secondary). `compact`: stacked full width, primary on top, in flow under the count (not pinned: the shell's tab bar is
  on this route, and a second pinned bar would sit on it).
  `medium`+: inline, primary on the right.
- **Review.** H1 "Check your ingredients" and a progress line "{read} of {total} lines read". One row per line, as
  the read row (§S4.2): glyph, `{amount unit}`, the food name in `text-charcoal` (not seafoam: it is not a link,
  P1), prep, then the source line in `caption` `text-slate`: "From: 2 cups plain flour". A row that needs a look
  shows its state word. ⋮: `Edit line`. Running: rows show a spinner glyph and "Reading…". Stalled, expired, failed
  and partial keep today's copy and actions, as DS Buttons.
- **The dead end (F6).** The page ends with `Start a recipe with these` (primary) when O4 is approved. It opens the
  create wizard at step 2 with the lines as entry rows, which still need a food each (R19: a parse binds nothing).
  Until approved, the page keeps `Start over` and `Back to recipes` as DS secondary Buttons.

---

## S8. Web ↔ mobile translation (§3.6)

| Element               | Web                                                                        | Native (iOS / Android)                                                                                     | Disposition | Why                                               |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------- |
| Wizard header         | below `expanded`: header replaces the app bar. `expanded`: in-column title | Stack header: ← · title · ⋮                                                                                | kept        | Same job, platform header idiom.                  |
| Step progress         | `compact` text + bar, `medium`+ rail                                       | text + bar always (phone), rail on tablet ≥ 640 dp                                                         | collapsed   | The rail wraps at 412 dp (W1, N3).                |
| Controls bar          | sticky bottom of column / fixed below lg                                   | pinned in `KeyboardAvoidingView`, A1 unpin rule                                                            | kept        | Thumb zone. One rule.                             |
| More actions (detail) | `ActionMenu` popover                                                       | `ActionMenu` sheet                                                                                         | moved       | A panel pushing content is not a menu (N2).       |
| Delete confirm        | `ConfirmDialog` centred                                                    | `ConfirmDialog` in `DialogFrame`, buttons stacked < 400 dp                                                 | kept        | One shape for both buttons (W6).                  |
| Row ⋮ and state glyph | always visible, no hover                                                   | same                                                                                                       | kept        | Hover does not exist on touch.                    |
| Row reorder           | ⋮ Move up/down (no drag)                                                   | same                                                                                                       | kept        | WCAG 2.5.7. Drag can come later as an addition.   |
| Open food list        | overlay popup (V3-1)                                                       | in flow below the field (item 7)                                                                           | kept        | Decided in `rowEditorOpenDecisions.md`.           |
| Variant dialog        | `Sheet` content-sized at `compact`, dialog above                           | `Sheet` content-sized                                                                                      | kept        | Two options should not take a full screen.        |
| Detail two columns    | `expanded` ingredients sticky beside steps                                 | one column on phone. Tablet ≥ 1024 dp: two columns like web                                                | collapsed   | A phone has no room for two columns.              |
| Hero back             | on-hero button                                                             | the app's own screen header ← (the mobile stack is hand-rolled, no react-navigation), shown above the hero | kept        | Platform back idiom, with the header that exists. |
| Serves stepper        | 44 px buttons                                                              | 44 pt iOS / 48 dp Android                                                                                  | kept        | Platform minimums.                                |
| Title field           | auto-growing textarea                                                      | multiline `TextInput`, `blurOnSubmit`, 3 lines max height                                                  | kept        | Fixes F10 (end of title shown).                   |

- **Primary action position.** Wizard: bottom right below `expanded` and in the sticky footer at `expanded` (reach, reading
  order). Detail: the `Edit recipe` / `Save a copy` button under the title, full width on phones (no new pinned bar:
  the detail page is for reading, and its task is not a single action).
- **Hover, right-click, drag:** none are needed. Every action is a visible control or an ⋮ item.
- **Longest strings checked:** "Next: Instructions" (`medium`+ only), "Previous" ("Previous: Ingredients" is the name
  only), "Couldn't look up", "Food no longer listed", "Make private", "Search for another food", a 120-character
  ingredient name (2 lines + ellipsis at 240 px), a 120-character title (3 lines in the field), German +35%
  ("Weiter: Anleitung" ≈ 17 characters in the `medium`+ slot). None wraps a control.
- **320 CSS px:** the row's amount (60 px) + unit (112 px) + gap fits in 240 px. Step 3's textarea is full width.
  Stats: Stepper row, then 3 × 80 px cells. Nothing shares a row it cannot fit.
- **Scroll budget, phone:** wizard: header 56 + progress 32 + bar 72, so ≥ 540 px of 844 for content. Six read
  rows fit without scrolling. Detail: the hero (≤ 0.4 window) and the title are on the first screen. The
  ingredients start on screen 2 (today: about screen 2.7).
- **Keyboard open:** the wizard follows A1 (the bar unpins past half the frame). In the row editor, the field being
  typed into scrolls above the keyboard (`KeyboardAvoidingView`, web `scrollIntoView({block:'nearest'})`). Paste:
  the buttons sit above the keyboard on native.
- **Back:** Android system back on the wizard runs the discard guard (`backIntercept`). On iOS the edge swipe does
  the same. On the web, browser Back is guarded by `useUnloadGuard`.
- **Rule placement:** S0.3 (wrap rules), `FieldLabel`, `DurationField`, `Stepper` and the native `Input` radius go
  into `packages/apps/commise/ui`. They are classes, not instances.

## S9. Accessibility contract (WCAG 2.2 AA)

- **Headings:** the page H1 (recipe title / step heading / "Version history" / paste heading). Sections H2.
  Groups in step 2 H3. The wizard's step heading is the H1 below `expanded`. The shell's H1 is hidden on wizard routes.
- **Labels (1.3.1, 3.3.2):** every field has a visible `FieldLabel`. Placeholders are examples only.
- **Read row:** `role="listitem"` in a `list` named "Ingredients". The row's open target is a button named "Edit
  {amount} {food}". Slot 1's name is the state sentence. Slot 2's name is "Actions for {food}".
- **Focus order:** row → state glyph → ⋮. Opening an editor moves focus to Amount. `Done` returns it to the row
  button. A removed row passes focus to the next row (as today, `removalFocusTarget.ts`).
- **Errors (3.3.1, 3.3.3):** at the field, linked, with the fix stated. Focus to the first invalid field.
- **Live regions (4.1.3):** "Draft saved", "{n} things to fix", the list count (P7), "Recipe deleted".
- **Menus:** `ActionMenu` (APG menu button). The destructive item is last, after a divider.
- **Dialogs:** focus trapped, Escape closes, focus returns to the trigger (`dialogFocus`).
- **Targets (2.5.8 + platform):** all controls ≥ 44 px web/iOS, 48 dp Android.
- **Reflow (1.4.10):** no horizontal page scroll at 320, and nothing clipped (I1, D5, R6 fixed).
- **Text spacing and 200% (1.4.4, 1.4.12):** the read row grows in height. The S0.3 last-resort wrap applies to
  controls only at 200%.
- **Motion:** the editor opens with a 150 ms height + opacity transition. With reduced motion it opens with no
  animation.

## S10. Copy (`en`). New or changed keys

| Key                                                                    | String                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `recipeMessages.detail.stepTimer` (CHANGED)                            | `{duration}` (rendered with the ⏱ glyph). Was `{seconds}s timer`.                                                               |
| `recipeMessages.duration.minutes` (NEW)                                | `{minutes} min`                                                                                                                 |
| `recipeMessages.duration.hours` (NEW)                                  | `{hours} h`                                                                                                                     |
| `recipeMessages.duration.hoursMinutes` (NEW)                           | `{hours} h {minutes} min`                                                                                                       |
| `recipeMessages.detail.byAuthor` (NEW)                                 | `by @{handle}`                                                                                                                  |
| `recipeMessages.detail.saveCopy` (CHANGED from Clone, O5)              | `Save a copy`                                                                                                                   |
| `recipeActionMessages.moreMenu.trigger` (CHANGED)                      | `More actions for {title}`                                                                                                      |
| `recipeActionMessages.makePrivate` / `.makePublic` (NEW)               | `Make private` / `Make public`                                                                                                  |
| `recipeActionMessages.delete.title` (CHANGED)                          | `Delete this recipe?`                                                                                                           |
| `recipeActionMessages.delete.body` (CHANGED)                           | `“{title}” and its version history will be deleted. You can't undo this.`                                                       |
| `recipeActionMessages.delete.confirm` (CHANGED)                        | `Delete recipe`                                                                                                                 |
| `wizardMessages.prevLabelShort` (CHANGED)                              | `Previous` (`medium`+). At `compact` it is icon-only.                                                                           |
| `wizardMessages.saveDraft` (CHANGED) / `saveDraftShort` (DELETED)      | `Save draft`                                                                                                                    |
| `wizardMessages.progressCompact` (NEW)                                 | `Step {current} of {total} · {name}`                                                                                            |
| `wizardMessages.back` (CHANGED)                                        | `Leave the editor`                                                                                                              |
| `wizardMessages.titleCreate` / `titleEdit` (NEW)                       | `New recipe` / `Edit recipe`                                                                                                    |
| `wizardMessages.fixCountOne` / `fixCountOther` (NEW)                   | `Fix 1 thing to continue` / `Fix {count} things to continue`                                                                    |
| `wizardMessages.saveChanges` (NEW)                                     | `Save changes`                                                                                                                  |
| `recipeFormMessages.rowState.chooseMatch` (NEW)                        | `Choose a match`                                                                                                                |
| `recipeFormMessages.rowState.noMatch` (NEW)                            | `No match found`                                                                                                                |
| `recipeFormMessages.rowState.lookupFailed` (NEW)                       | `Couldn't look up`                                                                                                              |
| `recipeFormMessages.rowState.asWritten` (NEW)                          | `No nutrition`                                                                                                                  |
| `recipeFormMessages.rowState.foodRemoved` (NEW)                        | `Food no longer listed`                                                                                                         |
| `recipeFormMessages.row.amountLabel` / `unitLabel` / `prepLabel` (NEW) | `Amount` / `Unit` / `Preparation`                                                                                               |
| `recipeFormMessages.row.addRange` / `removeRange` / `done` (NEW)       | `Add a range` / `Remove range` / `Done`                                                                                         |
| `recipeFormMessages.row.moveToGroup` / `moveUp` / `moveDown` (NEW)     | `Move to group…` / `Move up` / `Move down`                                                                                      |
| `recipeFormMessages.group.add` / `rename` / `remove` (NEW)             | `Add a group` / `Rename group` / `Remove group (keep its ingredients)`                                                          |
| `recipeFormMessages.statusActionNoneOfThese` (CHANGED)                 | `Search for another food`                                                                                                       |
| `recipeFormMessages.nutritionEmpty` (NEW)                              | `Nutrition appears as you match ingredients.`                                                                                   |
| `recipeFormMessages.nutritionCounted` (NEW)                            | `{counted} of {total} ingredients counted`                                                                                      |
| `recipeFormMessages.timerLabel` (CHANGED)                              | `Timer (optional)`                                                                                                              |
| `recipeFormMessages.stepLabel` (CHANGED)                               | `Step {number}`                                                                                                                 |
| `recipeFormMessages.review.checklistHeading` / `allClear` (NEW)        | `Before you publish` / `Everything is ready.`                                                                                   |
| `recipeFormMessages.review.previewCaption` (NEW)                       | `This is how it will look.`                                                                                                     |
| `recipeVersionMessages.emptyTitle` / `emptyBody` (CHANGED)             | `No earlier versions yet` / `Each time you save changes, the version before is kept here. You can look at it or bring it back.` |
| `recipeVersionMessages.back` (CHANGED)                                 | `Back to recipe`                                                                                                                |
| `recipeParseMessages.reviewHeading` (CHANGED)                          | `Check your ingredients`                                                                                                        |
| `recipeParseMessages.lineSource` (NEW)                                 | `From: {line}`                                                                                                                  |
| `recipeParseMessages.startRecipe` (NEW, after O4)                      | `Start a recipe with these`                                                                                                     |

The key paths name the existing message modules (`features/recipes/src/messages.ts`, `wizard/messages.ts`,
`form/messages.ts`, `actions/messages.ts`, `versions/messages.ts`, `parse/messages.ts`). `fe-1` places each NEW key
in the module that owns its surface. Every layout above was checked against +35% string length. In RTL, ← and ‹ ›
mirror, and the ⏱ glyph and numerals do not.

## S11. Owner decisions (each with my recommendation)

| #   | Decision                                                                     | Recommendation                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | The editor's title cap: 64 (today) vs the wire's 200                         | **120**, with a soft limit (no silent cut). 64 already cuts titles in the data. 120 fits 3 lines in the field and 2 lines on a card. Two-way door.                             |
| O2  | Reverse the "wrapping row" (rev 6) for a one-line read row + one open editor | **Approve.** It is the single largest fix to the owner's complaint (R1). Nothing is live (memory `notLiveNoData`), so the cost is code only.                                   |
| O3  | Step 4 = "Photos & review" (photos leave step 1)                             | **Approve.** It matches the wireframe's step 4 and makes step 1 shorter. Two-way door.                                                                                         |
| O4  | Paste review gets `Start a recipe with these`                                | **Approve.** The flow ends where the task starts (F6). Needs `staff-architect` for the hand-off into the wizard.                                                               |
| O5  | Rename "Clone" to "Save a copy"                                              | **Approve.** "Clone" is developer vocabulary (Nielsen #2). ⚠️ If "Clone" is localised and shipped anywhere, this is a terminology change. Nothing is live, so it is cheap now. |

## Validation run (§6c)

1. **Against publication:** WCAG 2.2 criteria and target sizes from `accessibility.md` and `device-ergonomics.md`;
   the 45–75 measure from `visual-design.md` (Bringhurst). The handoff checklist from `critique-handoff.md`. Changed:
   I made placeholder contrast secondary to the missing label, because WCAG's coverage of placeholders is debated.
2. **Against the field's prior art** (from knowledge, not re-fetched today): Paprika and NYT Cooking show
   ingredients as one-line read rows with editing behind a tap. NYT Cooking keeps ingredients visible beside the
   steps on desktop. I follow both. I depart from Paprika's single free-text box, because the product requires a
   picked food per line.
3. **Against myself:** the strongest case against S4 is that a tap-to-edit row hides the fields and adds a tap for a
   cook who wants to change every amount. Answer: a cook adds once and reads many times. The editor opens on the new
   row automatically, so the add loop costs no extra tap. And the 2.5-screen list costs more scrolling than one tap.
   It flips if a usability test (5 participants, think-aloud, task "enter this 8-line recipe") shows more time on
   task than today.

## References consulted

Corpus: `critique-handoff.md`, `accessibility.md`, `cross-platform-translation.md`, `visual-design.md`,
`device-ergonomics.md` (figures quoted from them). Repo: the decision docs in the table above, the 001 wireframes,
`web/mockup-fidelity/report.json`, `ui/src/tokens/scale.ts`, `button/surfaceClass.ts`, `actionMenu/props.ts`,
`sheet/props.ts`. No live web source fetched this pass.

## Success measure

- **Primary:** a phone screen (390 × 844) shows six ingredient read rows and the bar, with no scroll. A
  Playwright geometry test asserts it, and a Maestro screenshot checks it.
- **Guardrail:** no control wraps at 320 CSS px or at 412 dp (a Playwright check of `getClientRects().length === 1`
  on every button, chip, tab and menu item in these surfaces).
- **Signal after release:** wizard completion rate (draft started → published) and time on step 2, from the
  existing analytics emitter (`analytics/useAnalyticsEmitter.ts`). Read by the owner. First sign of trouble: more
  drafts abandoned at step 2 than before.

## Hand-off

1. `staff-architect` BLUEPRINT: S0.4 primitives (one new input family in `@commise/ui`), the section-level group
   controls (§S4.4, no API change claimed), V3-1's mechanism, and O4's paste → wizard hand-off.
2. `fe-1` builds slice by slice in the order above, test first. Its accessibility floor must be WCAG 2.2 AA.
3. Then `staff-ux-engineer` EVALUATE on each slice: web at all five widths, native on a device (VoiceOver,
   TalkBack), including the states not captured this time (versions populated, conflict, paste partial/expired).
