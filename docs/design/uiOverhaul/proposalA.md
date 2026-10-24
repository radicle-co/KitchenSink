# UI overhaul, Proposal A: one product, two postures, no blank boxes

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** It proposes the whole interface: visual language, navigation, every
screen and flow, every state, 320 px to 1920 px and native phone and tablet. Where it keeps a rule from the first
audit it cites it in one line. It spends its words where it differs.

- **Mode:** DESIGN, converged. I compared directions (§1.3) and then committed to one, so an engineer can build from
  this. Where a call is mine and not yet the owner's, it is marked ⚠️ **OWNER**.
- **Fidelity:** grey-box layouts with real content (ASCII) plus exact tokens and sizes. The question each layout asks
  is _"is the priority and placement right?"_. It is not a rendered visual comp.
- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`. **Accessibility level claimed:** WCAG 2.2 AA. Touch targets:
  Apple HIG 44 × 44 pt on iOS, Material 48 × 48 dp on Android, 44 × 44 CSS px on coarse-pointer web, 24 × 24 CSS px
  (SC 2.5.8) on a fine pointer. The strictest applies per surface (`device-ergonomics.md`).
- **Standing.** I authored none of the screens, and none of the first audit's files. I did not read `proposalB.md`.
- **Seen rendered:** yes. I read the web captures at 320, 390, 768, 1280 and 1920 (cut into viewport tiles) for Home,
  Recipes, Discover, filters, Collections, detail, every wizard step, the ingredient row states, paste, versions,
  profile, sign-in and the empty library. I rendered `docs/mockups/screens/*.html` myself at 390 and 1280 with the
  brand fonts loaded. I read the five distinct Pixel 6 captures. Native screens I did not see on a device are marked
  **(source)**.
- **Not user evidence.** Everything here is inspection plus published research. No user was observed. Behaviour
  predictions are labelled _informed prior_ (a named published mechanism) or _judgement_.

### The five ideas that matter most

1. **Two postures, designed separately.** A cook _reads_ a recipe at arm's length with wet hands, and _enters_ a
   recipe sitting down. Today both use the same dense, boxed, pill-heavy style. Reading gets big type, one column, a
   sticky jump bar, tap-to-check rows and a "keep screen on" switch. Entry gets labelled fields, one open row at a
   time, and a single page with a section index (§4.7).
2. **Navigation that only shows what exists.** Three destinations today (Home · Recipes · Discover), with Profile as the
   avatar. No drawer, no disabled "Soon" items, no dead top-bar buttons. Discover is its own destination, not a tab
   inside "my" recipes, so the scope of every search is obvious (§3).
3. **No blank boxes, anywhere.** A recipe without a photo gets a _typographic cover_ (its title set in Playfair on a
   tint). Empty states always carry a next action. Placeholders never pulse. Today about 190 px of grey sits on every
   photo-less card on a phone (§2.9).
4. **Colour has jobs.** Seafoam means _do this_, ocean-dark means _this is selected / you are here_, neutral means
   everything else. Coral leaves the controls. Today coral outline pills are on Back, More, Prev, Save, Clone and
   Cancel, so every screen shouts and nothing leads (§2.5).
5. **Paste is part of creating, not a separate place.** "Paste a list" opens inside the editor's Ingredients section,
   and the lines land as rows. This removes the paste flow's dead end by construction, rather than by adding a hand-off
   button (§4.7.6).

---

## Governing decisions checked (quoted before I go near them)

| Decision (where)                                                                          | Quote                                                                                                                         | What this proposal does                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mockups are the floor, not the ceiling (owner, memory `001-mockup-parity-reconciliation`) | "Use the mockups as a base and improve upon them" (owner, this brief)                                                         | Keeps their palette, Playfair/Inter pairing, sand canvas, white cards, sidebar, FAB, card anatomy and the detail page's order. Departs where a rendered mockup itself fails (below).                                                                                                  |
| Owner UX directive 2026-07-18, via `specSharedSystem.md` header                           | "Desktop gets a left sidebar. Tablet and phone get a bottom tab bar."                                                         | **Kept** (Situation C). My preference is Material's navigation rail at `medium` (M3: the bar is for "compact and medium", the rail for "medium" and up. Secondary source: SAP Fiori's M3 summary). Both are allowed at `medium`, so the directive is not wrong. Conceded, no residue. |
| FAB is the only create affordance (`recipe-list.md`, "Create affordance (canonical)")     | "The FAB is the only way to create a recipe on both platforms"                                                                | Kept on the library. Empty states also carry create buttons, which the wireframe already allows.                                                                                                                                                                                      |
| CR-002 merged card (`recipe-list.md`, "Merged recipe card")                               | "Every recipe card shows the full CR-002 field set"                                                                           | Kept on the grid card. The phone list row defers two fields (Q9, Situation B).                                                                                                                                                                                                        |
| FR-046 / CR-001 (`spec.md:179`, `:483`)                                                   | unbuilt widgets "render as skeleton placeholders (the real widget's shape …)"                                                 | Kept: real shape, no fake data. They move below the live content (Q5).                                                                                                                                                                                                                |
| FR-045a (`spec.md:194`)                                                                   | "The signed-out front door MUST be the sign-in surface itself"                                                                | Kept. No welcome screen. The brand line goes on the sign-in card (Q7).                                                                                                                                                                                                                |
| Figma brief 1 (`docs/mockups/briefs/recipeIngredientEntryFigmaMakePrompt.md`)             | "A cook never types a free-form ingredient line … the food itself is always chosen from a searchable list rather than typed." | Kept: the food is always picked. §4.7.3 lets the amount be typed _in front of_ the food search. The line is never stored as free text. That is a reading of the brief, so it is ⚠️ **OWNER** (A6).                                                                                    |
| Recipe-edit wireframe (`recipe-edit.md`)                                                  | "Recipe Edit (Web, Multi-Step Editor)", 4 steps                                                                               | **Challenged** (A5): one page with a section index. The premise and cost are in §4.7.1. The cheaper 70% path is given.                                                                                                                                                                |
| 008 Cooking Mode (`specs/008-cooking-mode/spec.md`, Status **Draft**)                     | FR-035: "System MUST keep the device screen active while Cooking Mode is engaged."                                            | Cook mode is not built. §4.6 draws only what detail can do now. "Keep screen on" is offered as an early slice of FR-035 (A4), so it is ⚠️ **OWNER**.                                                                                                                                  |
| Nothing is live (memory `notLiveNoData`)                                                  | n/a                                                                                                                           | Every one-way door here (URLs, terms, IA) costs **code only** today. That is the argument for deciding Q1, Q2, Q4 and O5 **now**, before any URL or word is learned.                                                                                                                  |

### Where the mockups themselves fail (do not copy)

Rendered at 390 px with fonts loaded:

- `screenHome.html` lays out at **792 px** wide.
- `screenRecipes.html` lays out at **482 px**.
- Both scroll sideways, which is a WCAG 1.4.10 failure.
- "Add to Meal Plan" wraps to three lines inside a pill on the detail mockup.

The mockups are the base for structure, palette and type, not for sizing.

---

## 1. Design direction

### 1.1 The direction in one page

**"A cookbook on the counter."** Commise feels like a well-set cookbook: warm paper (the `sand` canvas), black
ink (`charcoal`), one green (`seafoam`) for the thing to do next, photographs that carry the appetite, and a serif
(Playfair Display) only where a cookbook uses one: page titles, recipe titles and the greeting. Everything
else is quiet Inter.

The interface has **two postures**:

|         | Reading and cooking                                                                    | Entering and managing                                                       |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Where   | Recipe detail, Discover, Home                                                          | Editor, Collections, Profile, the library's management                      |
| Context | Phone at arm's length, one hand often wet. Interrupted.                                | Seated. Phone or laptop. Focused.                                           |
| Type    | Larger. Body 17 on phones for steps and ingredients. Amounts semibold and tabular.     | Standard 16. Labels above fields.                                           |
| Density | One column on phones. Generous 12 px row padding. Large hit areas (whole row toggles). | Compact read rows. One expanded editor at a time.                           |
| Chrome  | Collapses away. A sticky jump bar appears once you scroll past the title.              | A sticky action bar with Save and Publish. A section index on wide screens. |

**Six rules hold everything together:**

1. **One bar per edge.** A screen has at most one bar at the top and one at the bottom. Today a phone wizard has
   four stacked bands of chrome (shell top bar, a white band holding only a back arrow, "Step N of 4", a two-line
   rail) before any content (W2).
2. **Content first on the first screen.** Every screen's first viewport at 390 × 844 shows what the screen is, its
   primary action or a route to it, and real content (`cross-platform-translation.md`, scroll budget).
3. **Every text element has a stated overflow behaviour** (§2.2). Controls get room. They never get `nowrap`.
4. **Colour has jobs** (§2.5). Nothing decorative is coloured.
5. **Never a blank box** (§2.9). A missing photo, an empty list or an unbuilt feature always says something useful.
6. **Translate the job, not the layout** (§3.6). Each platform gets its own position for the primary action, decided
   by reach.

### 1.2 What the owner will notice first (the visible delta)

- Pages start with their content, not a glass card holding one word.
- No coral outlines. One green button per screen.
- Cards in a row line up. No card has an empty grey box.
- Nothing wraps inside a button, chip, tab or tab-bar label at 320 px, in English or at +35% length.
- The recipe page reads like a cookbook page. The editor shows one ingredient per line.

### 1.3 Directions I compared before converging

| Direction                                                                                                   | Optimises                                                | Sacrifices                                                                                                                                                                                         | Verdict                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **A. Polish in place** (the first audit's path): keep the IA and the wizard, fix primitives and layouts     | Low build cost. Low risk.                                | Keeps "Discover" as a tab inside "my" recipes. Keeps the wizard's step-hopping for a one-amount edit. Keeps disabled "Soon" nav items.                                                             | The right _primitives_. The wrong _structure_ in three places.                                       |
| **B. Cookbook (this proposal)**: same primitives, a clearer IA, posture-specific layouts, a one-page editor | The cook's two real jobs: read while cooking, enter once | More build than A: a new editor frame and a native tab-bar move.                                                                                                                                   | **Chosen.** §6 gives its cost and the 70% path.                                                      |
| **C. Feed-first** (Instagram/ReciMe-style): Home is a visual feed of Discover, the library is secondary     | Browsing and appetite                                    | A cook who wants _their_ recipe has to dig for it. ReciMe deliberately has "no discovery or feed tab" (`docs/competitive/01RecimeTeardown.md:270`) because its value is the user's own collection. | Rejected. Commise's live data is the user's own library. A feed with few public recipes looks empty. |

**Flip condition for B → A:** if the owner rules that the 4-step wizard stays, §4.7 falls back to the wizard with
my row and section changes, which is the first audit's S1 frame plus §4.7.2–§4.7.6 here.

---

## 2. Shared system (`packages/apps/commise/ui`)

### 2.1 Kept from the first audit, as written

Cite these. Do not re-spec them.

| Rule                                                                                                                                                                                     | Where                      | Note                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| Viewport classes `compact` < 640 · `medium` 640–1023 · `expanded` ≥ 1024. Container classes on `<main>`: `@narrow` < 600 · `@regular` 600–959 · `@wide` ≥ 960. Native uses window width. | `specSharedSystem.md` §2.1 | Kept.                                                                                        |
| Spacing roles: `gap-inline` 4 · `gap-within` 8 · `gap-group` 16 · `gap-section` 32. Card padding 16.                                                                                     | §5                         | Kept. Reading posture adds `gap-row` 12 (vertical padding of a tap-to-check row).            |
| `pewter` `#858F93` as `border-control`: 3.31:1 on white, 3.07:1 on sand (recomputed today)                                                                                               | §4                         | Kept.                                                                                        |
| Difficulty as a tint plus a three-dot meter. Status badges neutral with an icon. `error` only for failure.                                                                               | §4                         | Kept.                                                                                        |
| `PageHeader`, `Chip`/`ChipRow`, `SearchField`, `UndoSnackbar` contracts                                                                                                                  | §6, §7, §9, §12a           | Kept, with the changes in §2.11.                                                             |
| Inter registered on native. The Android elevation map by level (`sm` 1, `md` 2, `lg` 3, `xl` 6)                                                                                          | §3, §11                    | Kept. These are the cheapest large wins on device.                                           |
| `FieldLabel`, `DurationField`, `Stepper`, `formatDuration`                                                                                                                               | §13.2                      | Kept. `formatDuration` is a precondition for every time on every screen (F1 "16200s timer"). |
| Action menus through `@commise/ui/action-menu`: a popover on web that flips above, a titled sheet on native                                                                              | §13.4                      | Kept.                                                                                        |

**Two layers of thresholds, on purpose.** Page layout uses the three `<main>` classes above. A few components also
query **their own** container, because their content decides the break, not the page. Each is named where it is
used:

| Component query                 | Threshold                      | Why this number                                                       |
| ------------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Detail stat strip (§4.6.1)      | 2 × 2 below a 360 px strip     | four cells need about 4 × 84 px for "5 h 30 min" at `stat` 20         |
| Detail two columns (§4.6.2)     | two columns from a 720 px body | a 280 px ingredients column plus a 400 px method column at about 50ch |
| Confirm dialog buttons (§4.6.3) | stacked below a 400 px dialog  | "Delete recipe" and "Keep recipe" side by side need about 2 × 180 px  |

### 2.2 The wrap rule, corrected

**Disagreement.** `specSharedSystem.md` §1 says wrap is "never inside a control or a short label". That is the
universal form. The owner explicitly corrected it, on 2026-09-17, to a test with three conditions (memory
`wrappingInControlElements`):

> "wrapping is undesirable in control elements or other elements where the text is already short and wrapping would
> break the layout or widen the gulf of evaluation and execution."

**The rule, as built into every primitive:**

The owner's brief for this task also says wrapping is "the second to last resort to fit stuff". So **every** text
element, content included, climbs the same ladder. The three-condition test decides only whether the wrap rung is
open to it.

1. **Re-lay out first.** Give the element more room: move actions below a title, stack a row, drop a column. (This
   is what fixes E3. The collection title is content. It wrapped into a mid-word column. Moving its buttons below
   it gives it room.)
2. **Shorten the visible label.** The accessible name must still contain it (WCAG 2.5.3).
3. **Wrap, to a stated line count.** This rung is **closed** when all three conditions hold:
    - it is a control, or its text is already short.
    - A wrap breaks the layout.
    - A wrap widens the gulf of evaluation (for example, a two-line button reads as two items).
4. **Truncate last**, and only where the full text is one step away.
5. ⛔ Never `white-space: nowrap` on a container. It converts a wrap into a WCAG 1.4.10 reflow failure.
6. The one standing exception: at 200% text size and Dynamic Type XXL, a control can wrap to two balanced lines.
   That is the fallback `Button` already has (`specSharedSystem.md` §10.4). It beats clipping.

Why this matters in practice:

- A **recipe title on a card** has already had its room (the card width is fixed by the grid), so it wraps to two
  lines, then truncates. It is content.
- A **step's text** is long prose. Re-layout cannot shorten prose, so it wraps freely.
- **"Meal Plan" in a tab bar** meets all three conditions, so the wrap rung is closed and it must get room or a
  shorter label. HIG's own rule is "Use single words whenever possible" (Apple HIG, Tab bars, fetched today). So the
  label becomes "Plan" when it ships.

**Every element in this proposal states its rule as one of:** `wrap:N`, `truncate:N`, `relayout@<container>`, or
`room` (a control that is given space).

### 2.3 Layout widths

| Token             | Value            | Changes from the audit                                                                                                                                                                              | For                                                        |
| ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `content-reading` | 40 rem (640 px)  | Kept as the audit has it. Prose inside it is capped separately at `max-width: 65ch` (Bringhurst's 45–75 range, `visual-design.md`), so the measure never depends on the font's average glyph width. | Profile, legal, 404, collection forms, the editor's column |
| `content-detail`  | 72 rem (1152 px) | **new**                                                                                                                                                                                             | Recipe detail: a two-column reading layout                 |
| `content-wide`    | 90 rem (1440 px) | 80 → 90 rem                                                                                                                                                                                         | Grids: library, Discover, Collections, Home                |

**Alignment:** left-aligned to the page gutter, as the audit says (§2.2 there). Centring is only for terminal
moments: sign-in, empty states, the 404.

**Why widen grids to 1440:** the argument is **more recipes per screen**, not filling space. Empty space beside a
readable measure is correct (`device-ergonomics.md`), and reading pages keep their narrow widths.

- At 1920, the 256 px sidebar leaves `<main>` 1664 px wide, and 1600 px inside the 32 px gutters.
- With `repeat(auto-fill, minmax(15rem, 1fr))` and a 24 px gap, a 1280 cap gives 4 columns of 302 px.
- A 1440 cap gives **5 columns of 269 px** (computed: (1440 − 4 × 24) ÷ 5).
- So a 1920 screen shows a fifth recipe per row. Each card is still wider than the 240 px minimum.

### 2.4 Type

The audit's role scale (`specSharedSystem.md` §3) is kept, with four changes:

| Role                       | Change                                                                                                                                                                       | Why                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pageTitle` (Playfair 700) | **Visible on every page** as the large title, at `clamp(1.5rem, 1.2rem + 1.2vw, 1.75rem)`. The audit hid it (`titleVisibility: 'chrome'`) and kept "Recipes" in the top bar. | The top bar on phones goes (§3.4). The serif page title is the one brand moment on a list page, and the mockup's greeting is set exactly that way.                                         |
| `stepBody` (**new**)       | Inter 400, **17 px** / 1.55 on phones, 18 / 1.6 at `@wide`, measure ≤ 65ch                                                                                                   | Reading posture. Read at arm's length. Leading rises with measure (`visual-design.md`, line height).                                                                                       |
| `amount` (**new**)         | Inter 600, tabular numerals, same size as the line it sits in                                                                                                                | The amount is what the eye hunts for while cooking. Weight separates it, and tabular figures align "1½" over "12".                                                                         |
| `stat` (**new**)           | Inter 600 20 px, tabular, with a `caption` label under it                                                                                                                    | For the detail stat strip and the nutrition cells. Replaces Playfair numerals, which are proportional and old-style ("300 min" in the captures). Old-style figures do not align in a grid. |

**Unchanged:** Playfair appears only in `greeting`, `pageTitle`, `heroTitle`, the typographic cover (§2.9) and the
wordmark. Card titles and section titles are Inter 600, as in the mockups' cards. Body never goes below 16 px for
inputs, so iOS does not zoom.

### 2.5 Colour roles (the biggest visual change)

The palette does not change. The **jobs** do.

| Role                       | Token(s)                                                                                                        | Used for                                                                                           | Never used for                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Action**                 | `seafoam` → `ocean-dark` gradient (the existing `Button` primary surface). White label 4.67:1 at the light end. | The **one** primary button per view. The FAB.                                                      | Selection, links, tabs, decoration                          |
| **State: selected / here** | `ocean-dark` `#2A6B65`. White on it 6.20:1. On sand 5.75:1.                                                     | Selected chip (fill + check), active tab text + 3 px bar, active nav item, links, the current step | Primary buttons                                             |
| **Neutral**                | `white` surface, `pewter` 1 px border, `charcoal` label (12.68:1)                                               | **Secondary buttons** (Cancel, Previous, Save draft, More, Edit details)                           | n/a                                                         |
| **Text**                   | `charcoal` primary. `slate` secondary (5.24:1 on white, 4.87:1 on sand).                                        | n/a                                                                                                | `mist` is never text                                        |
| **Attention**              | `warning-dark` text (5.10:1 on white, 4.68:1 on pearl), `warning` 20% tint                                      | "Needs a match", unsaved changes                                                                   | Difficulty                                                  |
| **Danger**                 | `error-dark` text (5.63:1), `error` filled confirm button                                                       | Delete, erase, failures                                                                            | Difficulty "Hard" (it becomes a coral tint plus three dots) |
| **Brand warmth**           | `coral`, `sky`, `premium`, `success` as **tints only**                                                          | Typographic covers (§2.9), illustrations, the PRO badge (`premium`)                                | **Any control outline or label**                            |

**Why coral leaves the controls (judgement, with a principle):**

- Today about ten different controls are coral-outlined pills: Back, More, Prev, Save, Cancel, Clone, Add photo,
  "None of these", Start over and Change Password.
- Coral is a warm, saturated hue. On sand it reads as an accent, so each of those competes with the seafoam
  primary.
- The result is that no screen has a single focal point. The Von Restorff effect works only if one thing differs
  (`human-factors.md`).
- Coral's outline is also only 2.40:1 on white, below the 3:1 a boundary needs where the outline is the only cue. A
  labelled button does not strictly need it, which the first audit correctly noted, but the outline carries no
  meaning either.
- Neutral secondaries (white, `pewter` border, `charcoal` text) are the convention in Material 3's outlined button
  and in iOS's grey bordered button. They let the green be the only call to action.

**Selected vs primary** use different colours on purpose. Today the selected library chip and the primary button are
the same seafoam fill, so "on" and "do this" look alike. Ocean-dark plus a check glyph means _state_. The seafoam
gradient means _action_.

**Contrast pairs introduced** (computed today with the WCAG 2.x formula): `charcoal`/`white` 12.68 · white on
`ocean-dark` 6.20 · `ocean-dark`/`sand` 5.75 · `ocean-dark`/`pearl` 5.68 · `pewter`/`white` 3.31 (boundary) ·
`warning-dark`/`pearl` 4.68 · `charcoal` on each cover tint ≥ 10.77 (§2.9). ⛔ `slate` on the cover tints is
4.46–4.63, so it is **not** used there.

### 2.6 Surfaces and elevation

The audit fixed Android's elevation values. These are the _meanings_. Each level is one token, used for one job:

| Level | Surface                                                                                             | Shadow                                | Job                                                    |
| ----- | --------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| 0     | `sand` canvas. The `beach-glow` gradient only behind sign-in and the 404.                           | none                                  | the page                                               |
| 1     | `white` + 1 px `mist` at 60%                                                                        | `shadow-sm`                           | a card or a group of rows. Content that is _together_. |
| 2     | `white` at 92% + `backdrop-filter: blur(12px)` (web) / iOS material, + a hairline on its inner edge | `shadow-md`                           | sticky bars: tab bar, action bar, jump bar             |
| 3     | `white`                                                                                             | `shadow-xl` + `charcoal` scrim at 40% | sheets, dialogs, menus                                 |

**Removed:** the gradient "glass" cards behind page titles (Recipes, Home greeting, the detail title block). They
are a box with no job (Nielsen #8), a faint box inside a faint box. The mockups have no H1 card
(`screenRecipes.html`). A card exists only when it groups (the common-region principle, `human-factors.md`).

**Dark mode:** out of scope, as in the audit. The level table is written as _surface_ tokens (`surface-0` …
`surface-3`) and not as raw `white`, so dark mode can later map elevation to lightness without touching screens
(`visual-systems.md`).

### 2.7 Iconography

- **One set:** Lucide, at 24 px on a 24 grid with a 2 px stroke and round caps.
    - Web: `lucide-react`. Native: `lucide-react-native` (needs `react-native-svg`).
    - Library-first: native uses `@expo/vector-icons`' **Feather** today (62 usages, measured by `rg`). The web
      hand-draws SVGs (`web/src/components/home/chrome/icons.tsx`, `wizard/icons.tsx`, `auth/icons.tsx`).
    - Lucide is the maintained fork of Feather, so native glyphs do not change shape.
    - `staff-architect` confirms the native dependency. If refused, keep Feather on native and use `lucide-react` on
      web: same geometry.
- **Sizes:**
    - 20 px inside 14–16 px text rows. The stroke stays 2 px, which keeps it optically equal to 600-weight text.
    - 24 px for standalone icon buttons.
- **Filled vs outlined is not a state channel.** Active nav is shown by colour plus a bar, never by fill alone
  (`visual-systems.md`).
- **The glyph list**, so screens do not each pick their own: `clock` (time) · `users` (serves) · `flame` (kcal) ·
  `signal`-style three dots (difficulty, drawn in the `Difficulty` component, not an icon) · `star` · `lock` /
  `globe` (visibility) · `pencil-line` (draft) · `book-open` (Recipes) · `compass` (Discover) · `house` (Home) ·
  `plus` · `clipboard-paste` · `more-horizontal` (⋯ everywhere. ⋮ is retired.) · `chevron-left` (back, mirrors in RTL)
  · `timer` (step timer, does not mirror) · `sun` (keep screen on) · `check`.

### 2.8 Spacing and grid

The 4 px ramp stays. Two additions:

- **Phone row rhythm.** Tap-to-check rows are 12 px top and bottom, with a 24 px glyph or checkbox. A one-line row
  is therefore 48 px, which meets Material's 48 dp in the same box with no extra hit padding.
- **Grid gaps** are 16 at `@narrow`, 24 above. Card rows share heights through `subgrid` (audit §12).

### 2.9 Imagery and the typographic cover

**`RecipeCover` (new, `ui/src/recipeCover/RecipeCover.tsx` + `.native.tsx`).** It renders the photo when one exists.
When none exists, it renders a cover made from the recipe's own words, like a cookbook with no photography:

```
┌──────────────────────────┐  aspect from the caller (4:3 card, 1:1 thumb)
│                          │  ground: a tint picked by a pure hash of the recipe id
│   Wild Mushroom and      │  title: Playfair 700, charcoal, 3 lines max, left-aligned
│   Roasted Butternut…     │  inset 12 % of the width
│                          │
│   MOROCCAN               │  cuisine: overline role, charcoal (omitted if none)
└──────────────────────────┘
```

| Tint (token mix on white) | Hex       | `charcoal` on it |
| ------------------------- | --------- | ---------------- |
| `seafoam` 12%             | `#E6F0EF` | 10.91:1          |
| `coral` 20%               | `#FAE9E4` | 10.77:1          |
| `sky` 28%                 | `#DFF0F8` | 10.84:1          |
| `premium` 22%             | `#F6EBE0` | 10.80:1          |
| `success` 16%             | `#E2F2EA` | 10.94:1          |
| `warning` 20%             | `#FDEFD9` | 11.19:1          |

**Rules for the cover:**

- **The tint is chosen by `hash(recipeId) % 6`, never by cuisine.** A cuisine→colour mapping is a second
  meaning carried by colour, and it makes all Italian recipes one block.
- **The cover is `aria-hidden`**, because the title is already the link's name.
- **Font size scales with the cover width:** `clamp(14px, 9cqi, 28px)` via a container query on web. Native computes
  it from `onLayout` width.
- **Thumbnail size (< 96 px):** the cover shows only the title's first letter, at 50% of the box height.

**Why this is "the one thing" for lists:**

- The captures show about 190 px of grey on every photo-less card at 320 (E35), and an empty 4:3 box on device.
- A cook's own recipes often have no photo. That is an assumption, not data (nothing is live). The capture fixture
  includes photo-less recipes on purpose.
- A typographic cover turns that from "missing" into "designed". The recipe stays recognisable in a grid because
  each has its own colour and words.
- Judgement, no study. The principle is "never a blank box": an empty image slot signals failure (Nielsen #1).

**Photos:**

- Every image slot declares its aspect ratio, so nothing shifts on load (CLS).
- `object-position: center 40%`, because food is usually shot slightly from above and the subject sits low.
- Text never sits on a photo except the detail hero's back and more buttons, which sit on 44 px white discs at 90%
  (a guaranteed contrast strategy, not "works on this photo").

### 2.10 Motion

| Moment                         | Web                                                      | Native (Reanimated springs)                             | Reduced motion |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------- | -------------- |
| Press                          | 100 ms scale 0.98 (`pressScale`, exists)                 | spring, stiffness 400, damping ratio 1.0                | opacity 0.85   |
| Row editor opens (wide)        | 180 ms ease-out, height + opacity                        | n/a                                                     | instant        |
| Sheet in / out                 | 240 ms ease-out / 200 ms ease-in, translate Y            | spring, stiffness 280, damping ratio 1.0 (no overshoot) | fade 150 ms    |
| Jump bar appears               | 150 ms fade + 4 px slide                                 | same, spring 400 / 1.0                                  | fade           |
| Check an ingredient            | strike-through draws 150 ms. The checkbox fills at once. | same                                                    | instant        |
| Large title condenses (native) | n/a                                                      | scroll-linked, no spring                                | instant        |

The damping ratio is 1.0 everywhere: critically damped, no bounce. This is utility motion (Material 3's _Standard_
scheme, not _Expressive_, `interaction-motion.md`). Nothing animates on load except skeleton→content
cross-fades (150 ms).

### 2.11 Primitives: changes and additions

| Primitive                                                                     | Change                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (exists)                                                             | **`secondary` becomes neutral** (§2.5). Add `ghost` and `size: 'sm'` (as the audit says). `destructive` is filled `error` only inside a confirm dialog, and `error-dark` text elsewhere.                                                                              | One visual voice for "not the main thing"                                                                                                                                                                                             |
| `Chip`                                                                        | Selected = `ocean-dark` fill + white label + check (not seafoam)                                                                                                                                                                                                      | §2.5: state vs action                                                                                                                                                                                                                 |
| `Tabs` → **`SegmentedControl`** (rename of the audit's §8)                    | Same contract. Visual: a `pearl` track, the selected segment `white` with `shadow-sm` and `charcoal` 600 text. Each segment is a route on web (`aria-current="page"`).                                                                                                | Used only for 2–3 _views of the same thing_ (My recipes · Collections). An underlined tab strip looks like navigation. A segmented control looks like a view switch, which is what this is. Matches iOS's `UISegmentedControl` usage. |
| `PageHeader`                                                                  | Drop `titleVisibility: 'chrome'`. The title is always visible (§2.4). Add `trailing` (the avatar on top-level pages on phones).                                                                                                                                       | §3.4 removes the top bar on phones.                                                                                                                                                                                                   |
| **`RecipeCover`** (new)                                                       | §2.9                                                                                                                                                                                                                                                                  | No blank boxes                                                                                                                                                                                                                        |
| **`JumpBar`** (new, web + native)                                             | A sticky, scroll-spy anchor bar: 3–4 text targets ("Ingredients · Method · Nutrition") plus one optional trailing toggle. Appears after the page title scrolls out. `nav` with `aria-label`, links are anchors, and `aria-current="location"` on the section in view. | One-tap travel on a long reading page without hiding content in tabs. Find-in-page and screen readers still see one document.                                                                                                         |
| **`ActionBar`** (new, composes the existing `pinnedFooter`/`usePinnedFooter`) | A sticky bottom bar with 1 primary, ≤ 1 secondary and ≤ 1 icon button. Level-2 surface. Respects the safe area and the keyboard (A1 unpin rule from `compactHeightLayout.md`).                                                                                        | One rule for every "commit" bar: the editor, the collection picker, the filter sheet                                                                                                                                                  |
| **`LargeTitleHeader`** (native, new)                                          | iOS large-title behaviour: a 34 pt Playfair title in content that condenses into a 44 pt bar on scroll. Android: the same title, scrolling away, with a Material top app bar appearing on scroll.                                                                     | §3.4. Platform idiom on each.                                                                                                                                                                                                         |
| **`KeepAwakeToggle`** (new, ⚠️ A4)                                            | Web: `navigator.wakeLock.request('screen')`, re-acquired on `visibilitychange`. Native: `expo-keep-awake` (to add). A switch labelled "Screen on".                                                                                                                    | §4.6                                                                                                                                                                                                                                  |
| `ActionMenu`                                                                  | ⋯ glyph everywhere. Destructive last after a divider (audit §13.4).                                                                                                                                                                                                   | n/a                                                                                                                                                                                                                                   |

---

## 3. Navigation and information architecture

### 3.1 Destinations (⚠️ one-way door, cheap today because nothing is live)

| Level 1           | Contains                                                     | Web URL                                                          | Native root id                     |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------- |
| **Home**          | greeting, recent recipes, quick starts, coming-soon previews | `/{locale}`                                                      | `home`                             |
| **Recipes**       | segmented: **My recipes** · **Collections**                  | `/recipes`, `/collections`                                       | `recipes` (stack)                  |
| **Discover**      | the public catalogue: rails, search, filters                 | `/discover`                                                      | `discover` (stack)                 |
| Profile (utility) | profile, preferences, session, danger zone                   | `/profile` (and `/settings`, `/account` redirect to its anchors) | `profile` (pushed from the avatar) |

**Future, when built:** **Plan** (meal plan) and **Shop** (grocery) join the bar, giving five destinations, the
ceiling HIG and Material state. Nutrition is a view inside Plan and a Home widget, not a sixth tab. That future
order is a ⚠️ one-way door for later, and it is recorded here so nobody spends the fifth slot on something else.

**Why Discover is level 1 and not a tab beside "My recipes"** (this differs from the audit's IA.1):

- **Scope.** "My recipes" and "Discover" are different _scopes_. Users routinely search inside a section believing
  it is global, or the reverse (`information-architecture.md`, "Scope must be visible and changeable").
    - Today, the search field on Recipes searches mine, while the top-bar magnifier goes to the public catalogue.
    - The audit's IA.1 keeps them as sibling tabs, so the same word "Recipes" holds both scopes.
- **Different jobs.** Retrieve one you know (a list plus a search) is not browse for ideas (rails, filters,
  imagery). Each deserves its own layout (`information-architecture.md`, task scheme).
- **Collections belong to _mine_.** Collections group recipes in the user's own library: the picker searches "your
  recipes". So they sit beside My recipes, as two views of one library.
- **Cost:** move one tab to the nav. The URLs do not change.

**Why Profile is the avatar and not a tab:**

- Account, settings and sign-out are _utility_ navigation. Utility must be visually separate from content
  navigation, or it competes (`information-architecture.md`).
- It frees the fourth and fifth tab slots for Plan and Shop, so the final structure never needs a sixth tab, a
  "More" tab, or a drawer.
- **Placement:** the avatar is at the trailing end of the large title on every top-level phone page, and at the foot
  of the desktop sidebar (avatar, name, chevron).
- **Cost of being wrong:** a user looking for "Profile" in the tab bar does not find it. The avatar is the convention
  for this in Gmail, YouTube and the App Store, which is Jakob's Law in our favour (judgement).

### 3.2 Unbuilt destinations: none in navigation

**Answers Q3, and goes further than the audit.** Meal Plan, Grocery and Nutrition leave the tab bar, the sidebar and
the drawer. They exist only as previews on Home (FR-046 already requires those).

**Evidence:**

- Apple HIG, Tab bars (fetched today from `developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json`):
  "Don't disable or hide tab bar buttons, even when their content is unavailable. Having tab bar buttons available in
  some cases but not others makes your app's interface appear unstable and unpredictable."
- **Read the scope of that rule.** It is about a tab whose _content_ is temporarily unavailable. It is not about a
  section that does not exist yet.
- Its _reason_ is stability: a tab that appears and disappears. So the rule for Commise is: **a destination enters
  the bar when it ships, and never leaves.**
- The audit's sidebar "Soon" items have the opposite cost:
    - they are three dead targets on every page (Fitts: they sit between live items).
    - they are noise (Nielsen #8).
    - on touch, their only disabled cue was hover (E31).
- Home's previews say the same thing ("coming") at the place a user looks for news, and with the real
  widget's shape.

### 3.3 The navigation shell per platform and size

|                                                    | Phone web `compact` (< 640)                                               | Tablet web `medium` (640–1023)                            | Desktop `expanded` (≥ 1024)                                                       | Native phone                                                                                                               | Native tablet                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primary nav                                        | bottom tab bar, 3 items                                                   | bottom tab bar, 3 items, centred cluster, max 480 px wide | left sidebar 256 px, collapsible to 80 (unchanged, `HomeSidebar.tsx`)             | bottom tab bar                                                                                                             | bottom tab bar < 1024 dp (owner directive). Sidebar ≥ 1024 dp in landscape (same as web). |
| Top bar                                            | **none** on top-level pages. Large title in content + avatar.             | none. Large title + avatar.                               | **none**. The page title is the H1 in content. The avatar is in the sidebar foot. | `LargeTitleHeader`                                                                                                         | same as phone, title at 34 pt                                                             |
| Back (level 3+)                                    | a 44 px ‹ button above the title, as the page's eyebrow ("‹ Collections") | same                                                      | the eyebrow link                                                                  | header ‹ + system Back / edge swipe                                                                                        | same                                                                                      |
| Tab bar on pushed screens                          | visible                                                                   | visible                                                   | n/a                                                                               | **visible** (HIG: "If you hide the tab bar, people can forget which area of the app they're in". The exception is modals.) | visible                                                                                   |
| Tab bar during modal tasks (editor, picker, forms) | hidden                                                                    | hidden                                                    | n/a                                                                               | hidden                                                                                                                     | hidden                                                                                    |
| Drawer / hamburger                                 | **removed**                                                               | removed                                                   | n/a                                                                               | none                                                                                                                       | none                                                                                      |
| FAB                                                | My recipes only, 16 px above the tab bar, inline-end                      | same                                                      | My recipes only, anchored to the content column's inline-end edge (audit S.4)     | same as phone                                                                                                              | lower **side** edge (tablet reach is at the sides, `device-ergonomics.md`), 24 px in      |

**Decisions that differ from the audit:**

1. **The desktop top bar is deleted.**
    - At `expanded` it held a duplicate page title, a dead bell, a magnifier that left the page, and the avatar. That
      is 56–64 px of chrome with no unique job.
    - The sidebar already shows "you are here". The H1 shows the page. The avatar moves to the sidebar foot.
    - The sidebar header is the wordmark only, 64 px.
2. **The phone top bar is replaced by the large-title pattern.**
    - The audit keeps the glass bar with "Recipes" and hides the H1. I keep the H1 and drop the bar.
    - Same height: a 56 px bar vs a ~52 px title row.
    - But the serif title carries the brand, the avatar has a home, and nothing duplicates.
    - On scroll (native only) the title condenses, which is the iOS idiom. On phone web the title simply scrolls
      away. The tab bar shows where you are.
3. **The hamburger drawer goes on phone web.**
    - With three (later five) visible tabs, a drawer only duplicates them.
    - NN/g's hidden-navigation study (179 participants) found menus hidden behind an icon decreased
      discoverability on both desktop and mobile (nngroup.com/articles/find-navigation-mobile-even-hamburger/, fetched today).
4. **The top-bar magnifier goes.**
    - Search is a field on the page whose scope it searches: "Search your recipes" on Recipes, "Search recipes" on
      Discover.
    - The audit routed the magnifier to Discover, which on the My recipes page takes the user _out of_ their library
      to search someone else's. That is a scope trap.
5. **Native tab bar on pushed screens stays visible.**
    - The audit hid it on detail and collection detail. HIG keeps it, except for modal views.
    - Our editor and picker are modal, so they hide it.

**Native structure (source: `mobile/src/screens/AppRoot.tsx:46-49`, `RecipesScreen.tsx:40-63`).**

- Today: `AppRoot` switches among `home | recipes | profile | account`, and `RecipesScreen` owns one hand-rolled stack
  with three top tabs.
- Proposed:
    - `AppRoot` owns the tab bar and **one stack per tab** (`home`, `recipes`, `discover`). Switching tabs keeps
      each stack, which is the iOS and Material convention.
    - Profile is pushed onto the current stack from the avatar.
    - Android system Back pops the current stack. At a stack root other than Home it goes to Home. On Home it
      leaves the app.
- This is architecture: `staff-architect` blueprints it (§6, slice 2).

### 3.4 Sitemap and entry points

```
Sign in ──► Home ─┬─ Recent recipe ─────────────► Recipe detail ─┬─ Edit ──► Editor (modal)
(only door)       ├─ (empty) Add your first recipe ► Editor       ├─ ⋯ Version history ► Versions
                  ├─ (empty) Paste ingredients ──► Editor+paste   ├─ ⋯ Make private / Delete
                  └─ (empty) Find one in Discover ► Discover      └─ Save a copy (others') ► Editor
Recipes ─┬─ My recipes (list/grid, search, chips, FAB ► menu: Write · Paste)
         └─ Collections ─► Collection detail ─┬─ Add recipes ► Picker (modal)
                                              └─ ⋯ Rename · Make private · Save a copy · Delete
Discover ─ rails ─► See all / search ─► results ─► Recipe detail
Avatar ─► Profile (one page: Profile · Preferences · Session · Danger zone)
Any unknown URL ─► branded 404 inside the shell (signed in) / on the sign-in canvas (signed out)
```

### 3.5 Glossary (one word per concept. ⚠️ One-way door, cheap now.)

| Concept                                | Word                                                             | Not                                | Note                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The user's own recipes                 | **My recipes**                                                   | library, cookbook, box             |                                                                                                                                                                                 |
| A group of recipes                     | **Collection**                                                   | cookbook, list, folder             |                                                                                                                                                                                 |
| The public catalogue                   | **Discover**                                                     | Community, explore, public recipes |                                                                                                                                                                                 |
| Copying someone's recipe or collection | **Save a copy** (action) · **Copied from @handle** (attribution) | clone, fork, duplicate             | Answers O5 for recipes **and** collections. The audit's §Copy glossary keeps "clone" and "Clone collection" while its O5 renames "Clone" for recipes. One word must cover both. |
| An unpublished recipe                  | **Draft**                                                        | unsaved                            |                                                                                                                                                                                 |
| Matching a line to a food              | **Match** ("Choose a match", "No match found")                   | resolve, bind                      |                                                                                                                                                                                 |
| The method                             | **Method** (section title) · **Step** (one item)                 | Instructions, directions           | "Method" is the cookbook word in en-GB, and the seed data's voice is British ("Yoghurt"). ⚠️ Locale-specific: en-US may keep "Steps". Judgement.                                |

### 3.6 Platform translation register (shell)

| Element          | Web                                                                            | Native                                         | Disposition          | Why                                        |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------- | ------------------------------------------ |
| Primary nav      | sidebar ≥ 1024, tab bar below                                                  | tab bar, sidebar on tablet ≥ 1024 dp landscape | kept (moved at 1024) | owner directive, reach                     |
| Page title       | H1 in content (Playfair)                                                       | `LargeTitleHeader`                             | translated           | platform idiom                             |
| Profile entry    | sidebar foot (desktop), avatar beside the title (phone)                        | avatar beside the large title                  | kept                 | utility nav                                |
| Unbuilt features | Home previews only                                                             | Home previews only                             | dropped from nav     | §3.2                                       |
| Drawer           | removed                                                                        | none                                           | dropped              | duplicated the tabs                        |
| Hover            | enhances only (row hover tint, rail arrows on a fine pointer)                  | pressed state                                  | translated           | no hover on touch                          |
| Keyboard         | ⌘/Ctrl-K is **not** added (YAGNI). `/` focuses the page's search field on web. | n/a                                            | added (web only)     | flexibility (Nielsen #7) at near-zero cost |

---

## 4. Screens and flows

Each screen lists: its one-sentence purpose · layout per size · what is new vs the audit · states. A rule the audit
already states is cited, not repeated.

### 4.0 How to read the layouts

- Widths are CSS px (web) or pt/dp (native).
- "Phone" means `compact` web plus native phone. "Tablet" means `medium` web plus native tablet portrait. "Desktop"
  means `expanded`.
- Where the native layout differs, it is called out.
- All layouts were checked against: 320 px, the longest seed title ("Slow-Roasted Lamb Shoulder with Preserved Lemon,
  Chickpeas and Herb Yoghurt", 75 characters), and +35% label length.

---

### 4.1 Sign in and sign up

**Purpose:** get a returning cook in, or a new one started, with the least typing.

```
phone 320–639                         tablet/desktop
┌────────────────────────────┐        ┌───────────── sand + beach-glow ──────────────┐
│ (full-bleed white, no card)│        │            ┌──────── card 400 ────────┐       │
│        🍴 Commise          │ mark   │            │      🍴 Commise           │       │
│ Sign in to Commise         │ H1     │            │ Sign in to Commise        │       │
│ Your recipes, in one place.│ brand  │            │ Your recipes, in one place│       │
│ [ G  Continue with Google ]│        │            │ [ G Continue with Google ]│       │
│ ─────────── or ─────────── │        │            │ ────────── or ─────────── │       │
│ Email                      │        │            │ Email                     │       │
│ [                        ] │        │            │ [                       ] │       │
│ [        Continue        ] │ primary│            │ [       Continue        ] │       │
│ New to Commise? Create an  │        │            │ New to Commise?           │       │
│ account                    │        │            │ Create an account         │       │
└────────────────────────────┘        └──────────────────────────────────────────────┘
```

- **Kept from the audit (§A):**
    - the card is full-bleed below 480 px, with padding 24 (fixes "Continue with Go…" and the clipped placeholder).
    - native forms use `@commise/ui/input` with correct `autoComplete`/`textContentType` (SC 3.3.8 allows paste and
      password managers).
- **Brand line (Q7): "Your recipes, in one place."**
    - Not the mockup's "Cook with confidence. Plan with ease." "Plan" promises meal planning, which does not exist.
      A promise the product cannot keep on day one costs trust (Nielsen #2, judgement).
    - When Plan ships, the mockup's line returns.
- **Sign-up fields (Q6):** email and password (plus Google). Username and first/last name are **off** in the Clerk
  dashboard.
    - The display name is asked _after_ sign-up, as an optional field on Profile ("What should we call you?"). Home's
      greeting falls back to "Good evening" until it is set. It is not a Home card, because FR-046 allows only one
      live widget there.
    - Show value before asking for commitment (`interface-patterns.md`, onboarding).
- **Footer link:** the link text is "Create an account", 17 characters. It is `room`, not `nowrap`: at 320 the whole
  sentence can wrap, but the link starts its own line if it does not fit, via `display: inline-block`.
- **States:** wrong password, unknown email, network error, too many attempts, and email verification code are
  Clerk's (themed only). A signed-out deep link returns to its destination after sign-in (Clerk's redirect URL).

### 4.2 First run (the moment a new cook decides whether this is for them)

There is no onboarding carousel (the paradox of the active user, `human-factors.md`). The empty states _are_ the
onboarding. They share one design:

```
Home, 0 recipes (phone)
┌────────────────────────────────────┐
│ Good evening                    (E)│ greeting + avatar
│ Thursday 8 October                 │
│ Recent recipes                     │ H2 (the recent-recipes widget's own heading)
│ Your recipe box is empty.          │ the widget's EMPTY STATE (FR-046 keeps one live widget)
│ ┌──────────────────────────────┐   │
│ │ ✎ Add your first recipe      │   │ primary (gradient), 56 px, full width
│ └──────────────────────────────┘   │
│ [ 📋 Paste ingredients         ]   │ secondary, full width
│ [ 🧭 Find one in Discover      ]   │ secondary, full width
│ Coming to Commise                  │ H2
│ ┌ Today's nutrition ┐ (shape)      │ FR-046 previews, static, below
└────────────────────────────────────┘
```

- **Why "Add your first recipe" leads, and paste is second:**
    - Paste fills only the Ingredients section in v1 (§4.7.6). A label like "Paste a recipe" promises a whole recipe.
      That is the same over-promise I reject for the sign-in tagline (Q7).
    - "Add your first recipe" opens the editor. The editor's Ingredients section offers **Paste a list** at the point
      of need.
    - "Paste ingredients" stays as a shortcut: it opens the editor with the paste sheet already open.
    - **Flip:** when the parse pipeline can read a title and a method too, "Paste a recipe" leads. Capture where the
      recipe already is is ReciMe's central IA decision (`docs/competitive/01RecimeTeardown.md:271-272`), and Tesler's
      law favours the system doing the work.
- **FR-046 compliance.** FR-046 says the recent-recipes widget "MUST be the only widget with a live implementation"
  (`spec.md:179`). So these actions are **the recent-recipes widget's empty state**, not a new widget. Home has no
  separate quick-actions block.
- **Display name.** "What should we call you?" is **not** a Home card (that would be a second live widget). It is a
  field on Profile (§4.10), and the greeting falls back to "Good evening" until it is set.
- **The library's empty state** uses the same three buttons, centred, with the line "Your recipe box is empty. Add
  one you love." The FAB is hidden while it shows (wireframe rule).
- **Collections empty:** "Group recipes for weeknights, parties or anything else." plus **New collection**. If the
  user has 0 recipes, add the line "Add a few recipes first", and the button becomes **Add a recipe**.

### 4.3 Home

**Purpose:** pick up where you left off.

```
phone 390                               desktop (main 1024–1664, content-wide)
┌────────────────────────────────────┐  ┌────────────────────────────────────────────────────────────────┐
│ Good afternoon, Emma            (E)│  │ Good afternoon, Emma                                           │
│ Sunday 31 May                      │  │ Sunday 31 May                                                  │
│ Recent recipes          See all ›  │  │ Recent recipes                                       See all › │
│ ┌──┐ Slow-Roasted Lamb Shoulder…   │  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   (4 grid cards, subgrid)  │
│ │  │ ⏱ 5 h 30 · 8 · 612 kcal       │  │ │      │ │      │ │      │ │      │                            │
│ └──┘ ●●○ Medium  ★ 4.8 (12)        │  │ └──────┘ └──────┘ └──────┘ └──────┘                            │
│ ┌──┐ Pasta  …                      │  │ Coming to Commise                                              │
│ ┌──┐ Wild Mushroom and Roasted…    │  │ ┌ Today's nutrition ──┐ ┌ Resume cooking ────────────────────┐ │
│ ┌──┐ Charred Summer Corn…          │  │ └─────────────────────┘ └────────────────────────────────────┘ │
│ Coming to Commise                  │  │ ┌ This week's meals ────────────────────────────────────────┐ │
│ ┌ Today's nutrition ─ Coming ┐ …   │  │ └───────────────────────────────────────────────────────────┘ │
├────────────────────────────────────┤  └────────────────────────────────────────────────────────────────┘
│  ⌂ Home     📖 Recipes   🧭 Discover│
└────────────────────────────────────┘
```

- **Live content first (Q5, agreed).** The greeting is `greeting` role 28 → 36, **no card**, on the canvas (mockup).
- **Recent recipes:** row cards at `@narrow` (4 × 96 px, all on the first screen at 390 × 844) and grid cards above.
- **No extra blocks.** FR-046 makes recent recipes the only live widget (`spec.md:179`), so Home adds nothing between
  it and the placeholders. Create actions appear only in the widget's empty state (§4.2). The FAB on Recipes covers
  the populated case.
- **Coming to Commise:** the FR-046 placeholders keep their shape.
    - Static `pearl` blocks with no pulse, so they do not read as loading.
    - The "Coming soon" badge sits beside each title in `caption` 600.
    - The week strip uses seven equal columns with narrow day labels below `@regular` (audit §H.2).
    - Sentence case titles: "Today's nutrition", "Resume cooking", "This week's meals".
- **States:**
    - first run (§4.2).
    - loading: 4 row skeletons under the real H2.
    - error: "We couldn't load your recent recipes." + **Try again**.
    - offline: cached recipes plus the shell's offline strip (audit §S.5).
    - no name: "Good afternoon".

### 4.4 Recipes (My recipes · Collections)

**Purpose:** find a recipe you own, fast.

```
phone 320                                   desktop (main ≥ 960)
┌──────────────────────────────────┐        ┌───────────────────────────────────────────────────────────────┐
│ Recipes                       (E)│ H1     │ Recipes                                                       │
│ ┌ My recipes ┬ Collections ┐     │ seg.   │ ┌ My recipes ┬ Collections ┐                                  │
│ ( 🔍 Search your recipes      ) │        │ ( 🔍 Search your recipes                     )  12 recipes ☷ ▦ │
│ [All][Quick][British][Dairy-f…]→│ chips  │ [All] [Under 30 min] [British] [Dairy-free] [Gluten-free] …   │
│ 12 recipes · Recent ▾      ☷ ▦  │        │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   (auto-fill, 5 at 1920) │
│ ┌──┐ Slow-Roasted Lamb Shoulder…│ rows   │ │    │ │    │ │    │ │    │ │    │                        │
│ │  │ ⏱ 5 h 30 · 8 · 612 kcal    │ 96px   │ └────┘ └────┘ └────┘ └────┘ └────┘                        (+)│
│ └──┘ ●●○ Medium ★ 4.8 (12) · 🔒 │        │                                                               │
│ ┌W ┐ Wild Mushroom and Roasted…  │cover   │                                                               │
│ └──┘ …                       (+)│ FAB    │                                                               │
├──────────────────────────────────┤        └───────────────────────────────────────────────────────────────┘
│  ⌂ Home   📖 Recipes   🧭 Discover│
└──────────────────────────────────┘
```

- **Segmented control** (§2.11): My recipes · Collections, as routes `/recipes` and `/collections`. 44 px. Each
  segment is `room`, which fits at 320 with German +35% ("Meine Rezepte" · "Sammlungen" ≈ 2 × 136 px in 288).
- **Search:** `SearchField` (audit §9). "Search your recipes". `/` focuses it on web.
- **Chips:** `ChipRow overflow="scroll"` at `@narrow`, `wrap` (two lines max) from `@regular` (audit §7). Labels are
  sentence case. "Quick (<30m)" becomes "Under 30 min".
- **Result bar:**
    - count (`meta`).
    - **sort** as a ghost button "Recent ▾" (Recent · A–Z · Quickest), opening an `ActionMenu`.
    - the list/grid switch (☷ ▦) as a two-segment icon `SegmentedControl` with names "List view" / "Grid view".
    - the default is list at `@narrow`, grid above, persisted per device (audit §R.1).
- **Row card (list view),** 96 px min-height (`min-height`, never `height`, for SC 1.4.12):
    - **Thumb:** 80 × 80 `RecipeCover`, radius `md`.
    - **Title:** Inter 600 16, `wrap:2`, then ellipsis.
    - **Meta line:** ⏱ `formatDuration(total)` · 👥 servings · 🔥 kcal per serving, in `meta` 14, `slate`. One line.
      items drop from the end (kcal first) rather than wrap.
    - **Third line:** difficulty (dots + word) · ★ average (count) or "No ratings yet" · the visibility _icon only_
      (🔒 or 🌐, with the accessible name "Private" / "Public") · "Draft" as a neutral badge when it applies.
    - **PRO:** the existing badge on the thumb's top corner (`caption`, `premium` fill), as on the grid card.
    - **Cuisine:** the meta line's first item when present ("Moroccan · ⏱ 5 h 30 · 8"). It drops before kcal when the
      line runs out of room.
    - **Relative time:** in the third line's trailing slot, "Edited 2d ago", `caption`. It drops first.
    - **Deferred to detail** (Q9): tags and version. These are the only two fields the row omits. Every other CR-002
      field is on the row, with the drop order stated above.
- **Grid card:** the CR-002 field set with subgrid rows (audit §12). Changes:
    - the cover is `RecipeCover`.
    - the Clone button is **not** on the card (§4.5).
- **FAB → `ActionMenu`:** **Write a recipe** (pencil, hint "Start with a blank page") · **Paste ingredients**
  (clipboard glyph, hint "Paste a list, one ingredient per line"). Write is first, for the reason in §4.2. Native: a
  titled bottom sheet "New recipe" (audit §R.2).
- **Collections segment:** the audit's §C.1 cards (cover mosaic from member photos, falling back to `RecipeCover` for
  photo-less members, the name, "12 recipes · 🔒 Private"). **New collection** is a secondary button in the result
  bar's inline-end slot, never beside the H1.
- **States:** first run (§4.2) · loading (6 skeletons of the active variant) · no match ("Nothing matches 'lamb'." +
  **Clear search** / "No recipes match these filters." + **Clear filters**) · load error + **Try again** · refresh
  failed (`refresh-notice`) · offline (cached + strip) · 500+ (`load-more`).
- **Scroll budget, 390 × 844:** title row 52 + segment 44 + 12 + search 48 + 12 + chips 36 + 12 + result bar 32 + 8 =
  256 px of header, then the 64 px tab bar. That leaves 524 px: **5 full rows** on the first screen (today: none).

### 4.5 Discover

**Purpose:** find something new to cook.

The audit's §D (filter sheet below `@wide`, a sticky filter panel at `@wide`, one "Total time" group plus a "More time
filters" disclosure, sort as a menu, the rail skeleton containment fix E1) is **kept**. Changes:

| Element            | Change                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position in IA     | Level-1 destination (§3.1). H1 "Discover".                                                                                                         | scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Clone on cards     | **Removed from cards.** "Save a copy" lives on the recipe page (§4.6).                                                                             | A per-card button adds a row to every card and a second target competing with "open" (Hick, Fitts). Browsing is choose → open → decide. ⚠️ This departs from a wireframe: `recipe-search.md:74` says "Clone button: Available on all public recipe cards (FR-005)". FR-005 itself (`spec.md:123`) requires only that a user can "copy/clone a public recipe". It says nothing about placement. FR-005b also says a copy cannot be published until it carries a substantive edit, so the copy opens in the editor, which fits a detail-page action better than a one-tap card action. Owner decision A9. |
| Author on cards    | "by @handle" on the card's last line (`caption`, `truncate:1`)                                                                                     | FR-005 attribution, audit E17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rails at `compact` | Cards 72% of the container width (≈ 260 px at 390), so the next card **peeks** by about 90 px                                                      | The peek is the scroll signifier on touch. No arrows on touch. Arrows on a fine pointer (audit §D.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Browse-by-cuisine  | Kept as a chip row. **If there are fewer than 3 cuisines with ≥ 3 recipes, the rail is hidden** (a thin catalogue must not advertise its thinness) | judgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| No results         | Audit §D.5's three variants, plus one line of **"Try one of these"**: the three most-used tags as chips                                            | `information-architecture.md`: zero results is a design surface, offer relaxed queries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Layouts:**

- `@narrow`: search → [Filters · n] + Sort → applied chips → rails.
- `@regular`: the same, with 2-up result grids.
- `@wide`: a 256 px sticky panel plus results, 3–5 columns at 1280–1920.

### 4.6 Recipe detail: the reading and cooking posture

**Purpose:** cook this recipe, from a phone propped on the counter.

#### 4.6.1 Phone (320–639, native phone)

```
┌────────────────────────────────────┐
│ (‹)                           (⋯)  │ hero 4:3 full-bleed, max 45% of the window,
│          [ photo / cover ]          │ white 44 px discs at 90% for ‹ and ⋯
│                              1 / 3 │ swipe for the other photos, counter chip
├────────────────────────────────────┤
│ MOROCCAN · by @braise.club         │ overline + byline (caption, slate)
│ Slow-Roasted Lamb Shoulder with    │ heroTitle 28, wrap (content)
│ Preserved Lemon, Chickpeas and     │
│ Herb Yoghurt                       │
│ ★ 4.8 (12) · Public                │ meta
│ ┌──────┬──────┬──────┬──────┐      │ stat strip (level-1 card)
│ │5 h 30│ 30 m │ 5 h  │ ●●○  │      │ value: stat 20/600 tabular
│ │Total │ Prep │ Cook │Medium│      │ label: caption slate
│ └──────┴──────┴──────┴──────┘      │ relayout@<360: 2 × 2
│ [      Edit recipe      ] [⋯]      │ own: primary fill + ⋯
│ A whole lamb shoulder rubbed with… │ description, stepBody, 4 lines + "More"
│ [gluten-free][dairy-free][slow-c…]→│ tags, ChipRow scroll
├─ Ingredients · Method · Nutrition ☀ ┤ JumpBar: appears after the title scrolls away
│ Ingredients        Serves [−] 8 [+]│ the stepper sits WITH what it scales
│ For the lamb                       │ group: overline, slate
│ ☐ 2–2.5 kg  lamb shoulder, bone-in │ tap the whole row to check (48 px min)
│             trimmed of excess fat  │ prep: slate, same size
│ ☑ 2  preserved lemons  ̶r̶i̶n̶d̶ ̶o̶n̶l̶y̶   │ checked: slate + strike-through
│ …                                  │
│ Method                             │
│ ① The night before, score the lamb │ step: 28 px numeral (ocean-dark) + stepBody
│   all over in a criss-cross…       │
│ ③ Sit the lamb on top …            │
│   [⏱ 4 h 30 min]                   │ timer chip: text now, a control when 008 ships
│ Nutrition · per serving            │ 2 × 2 stat cells, then one footnote block
│ Ratings                            │
└────────────────────────────────────┘
```

- **Order** follows the mockup (`screenRecipeDetail.html`): hero → author → title → tags → description → actions →
  stats → ingredients → method → nutrition. Two changes:
    - **Stats come before the description.** "How long will this take?" is the decision a cook makes before reading
      prose.
    - **The duplicate carousel is gone** (F2). The hero _is_ the carousel.
- **No page Back pill.** The ‹ is on the hero (mockup). With no photo, the hero is a 16:9 `RecipeCover` and the ‹ sits
  on it the same way.
- **The serves stepper moves into the Ingredients heading.** It changes the amounts, so it sits next to them.
    - Natural mapping (Norman, `human-factors.md`): the control is next to its effect.
    - The amounts re-render at once, announced politely ("Amounts for 6 servings").
    - Today the stepper is in a stats card, with "8" overlapping "30 min" at 320 (D5).
- **Tap-to-check ingredients:**
    - The whole row is the checkbox (`role="checkbox"`, name "2 to 2.5 kg lamb shoulder, bone-in, trimmed of excess
      fat").
    - The check state is kept per recipe for the session (web: `sessionStorage`, native: in memory per stack entry).
    - ⋯ → **Clear checks** resets it.
    - Prior art: Paprika's Cook feature lets you "cross off ingredients, and highlight your current step" (App Store
      listing, via search today).
- **Tap a step to make it current:**
    - The current step gets a 3 px `ocean-dark` bar on its inline-start edge and its numeral fills.
    - One current step at a time. It is a _place marker_, not a completion record.
    - Same prior art.
- **Keep screen on ☀** (⚠️ A4: an early slice of 008 FR-035):
    - A toggle at the trailing end of the JumpBar, labelled "Screen on" (visible label at `@regular`+. At `@narrow`
      icon-only with that name, plus a one-time hint "Keeps the screen awake while you cook").
    - On while the page is visible. Released on leave.
    - Web: Screen Wake Lock API. MDN names "following a recipe" as a use case. Baseline since March 2025. Secure
      context only (MDN, fetched today).
    - Native: `expo-keep-awake`.
    - ReciMe users rank "cook mode keeps the screen awake" as a small, universally appreciated feature
      (`01RecimeTeardown.md:339`).
    - **Hidden** if the API is unavailable. Never shown disabled.
- **JumpBar** (§2.11) on phones: Ingredients · Method · Nutrition, plus ☀. A level-2 surface, 48 px, sticky at the
  top once the H1 is out of view.
- **Actions:**
    - Own recipe: **Edit recipe** (primary, `width="fill"`) + ⋯ (44 px): Version history · Make private / Make public
      · Clear checks · ─ · Delete recipe.
    - Someone else's: **Save a copy** (primary) + ⋯ (Version history if allowed · Clear checks).
    - No new pinned bottom bar. The page's task is reading, and the tab bar already owns the bottom edge (one bar per
      edge).
- **Edit goes straight to the section** (with §4.7): ⋯ on the Ingredients heading (own recipe) has **Edit
  ingredients**, which opens the editor scrolled to that section.
- **Description:** clamped to 4 lines with a "More" text button (`aria-expanded`) at `@narrow`. Full above. Today it
  runs 13 lines at 320 in a tinted card (D6).
- **Times:** `formatDuration` everywhere ("5 h 30 min", never "330 min" or "16200s").

#### 4.6.2 Tablet (640–1023) and desktop (≥ 1024)

```
desktop (content-detail 1152)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ‹ My recipes                                                                     │ eyebrow
│ MOROCCAN · by you · 🌐 Public            ┌──────────────────────────────────┐    │
│ Slow-Roasted Lamb Shoulder with          │                                  │    │ magazine split:
│ Preserved Lemon, Chickpeas and Herb      │         hero 4:3 (≈ 540 w)       │    │ text 5/12 · photo 7/12
│ Yoghurt                       heroTitle  │                                  │    │
│ ★ 4.8 (12)                               │                            1/3   │    │
│ A whole lamb shoulder rubbed with …      └──────────────────────────────────┘    │
│ [ Edit recipe ] [⋯]                                                              │
│ ┌ 5 h 30 Total │ 30 min Prep │ 5 h Cook │ ●●○ Medium │ 612 kcal/serving ┐        │ one stat row
├─ Ingredients · Method · Nutrition · Ratings                         ☀ Screen on ─┤ JumpBar (sticky)
│ ┌ Ingredients  Serves [−] 8 [+] ┐   Method                                     │
│ │ (sticky, own scroll ≤ 100dvh) │   ① The night before …            (65ch)      │
│ │ ☐ 2–2.5 kg lamb shoulder …    │   ② Heat the oven to 160°C …                  │
│ │ …                             │   ③ … [⏱ 4 h 30 min]                          │
│ └───────────────────────────────┘                                                │
│ Nutrition (4 across)                    Ratings                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **The magazine split is the one thing that makes desktop detail better than the mockup.**
    - At 1280 the captures spend the whole first screen on the photo, and the title wraps to four lines in 473 px
      beside two buttons (D1).
    - Title left and photo right puts the title, rating, time and the primary action **in the first viewport**, with
      the photo still dominant. This is the layout of a printed cookbook spread.
    - It applies at `content-detail` ≥ 960. Below that the phone order holds.
    - Judgement. I recall NYT Cooking's desktop recipe page placing the photo beside the title block, but I did not
      verify it today. Treat that as unverified prior art.
- **Two columns from container ≥ 720** (tablet portrait included, so 768 is not a stretched phone): ingredients 5/12,
  sticky with its own scroll, and method 7/12 (audit §S2.1, kept).
- **Native tablet** follows the same breakpoints by window width.

#### 4.6.3 Other detail surfaces

- **⋯ menu** (`ActionMenu`): web popover flips above, native sheet (audit §13.4).
    - "Make private" for a free-tier viewer opens the upsell sheet ("Private recipes are part of Premium." · **See
      Premium** · **Not now**, equal clarity: the DSA Art. 25 test passes).
    - F8 (premium viewer shown the upsell) is checked before building.
- **Delete:** `ConfirmDialog`, centred. "Delete this recipe?" / "'{title}' and its version history will be deleted.
  You can't undo this." / **Delete recipe** (filled `error`) + **Keep recipe** (neutral). Not "Cancel"
  (`content-design.md`: use the verb). Focus opens on Keep. Stacked full width below 400.
- **States:**
    - loading: hero at its real ratio + title + stat skeletons.
    - not found or private: "This recipe isn't available." + **Back to My recipes**.
    - load error + **Try again**.
    - no steps: "No method yet." + (own) **Add steps**.
    - no ingredients: the same pattern.
    - nutrition partial: figures + "Estimated from 7 of 9 ingredients.".
    - nutrition unavailable: the cells show "—" and one line.
    - offline: the cached recipe stays fully readable and checkable (reading must survive a kitchen's Wi-Fi), and
      edit actions say "Needs a connection" on press.
    - draft (own): a neutral "Draft" badge in the meta line.

### 4.7 Create and edit: the entry posture

#### 4.7.1 The editor model (⚠️ A5: departs from the 4-step wizard)

**Proposal:** one editor page, four sections (**Details · Ingredients · Method · Photos**), for create _and_ edit.

- On `@wide` a sticky **section index** sits on the inline start.
- On phones a **JumpBar** of the four sections sits at the top.
- A sticky **ActionBar** sits at the bottom: **Save draft** (neutral) and **Publish** / **Save changes** (primary).

```
phone                                       desktop (@wide)
┌──────────────────────────────────────┐    ┌──────────────┬──────────────────────────────────────┐
│ ✕  New recipe              Saved ✓   │    │ New recipe   │ Details                              │
├ Details · Ingredients · Method · Pho…┤    │ ● Details    │ Title                                │
│ Details                              │    │ ◐ Ingredients│ [ Slow-Roasted Lamb Shoulder …     ] │
│ Title                                │    │   3 need a   │ …                                    │
│ [ Slow-Roasted Lamb Shoulder with  ] │    │   match      │ Ingredients                          │
│ [ Preserved Lemon…                 ] │    │ ○ Method     │ …                                    │
│ …                                    │    │ ○ Photos     │                                      │
├──────────────────────────────────────┤    │              │                                      │
│ [ Save draft ]  [      Publish     ] │    │              ├──────────────────────────────────────┤
└──────────────────────────────────────┘    └──────────────┴ [Save draft]            [Publish ›] ┘
```

- **Header:**
    - ✕ = leave (runs the discard guard if dirty), with the name "Close editor".
    - Title: "New recipe" / "Edit recipe", `truncate:1`. Not the recipe's own title, which is already in the field
      (N4).
    - Save status in `caption`: "Saved ✓" / "Saving…" / "Not saved".
    - The tab bar is hidden (modal task). The app top bar does not exist (§3.3), so there is one header.
- **Section index** (`@wide`): each item shows a status dot.
    - ● complete · ◐ needs attention, with a one-line reason ("3 need a match") · ○ empty.
    - Clicking scrolls to the section and moves focus to its H2.
- **Validation runs on Publish.**
    - Errors appear at the field (SC 3.3.1, 3.3.3).
    - The ActionBar shows "Fix 2 things to publish" (polite live region) and **Publish** scrolls to the first.
    - Save draft never validates beyond what the API requires.
- **Autosave:** drafts save on blur and every 10 s while dirty (preserve work across interruption,
  `interface-patterns.md`). "Saved ✓" confirms it.

**Why one page instead of the wizard:**

| Argument                                  | Wizard (today, wireframe)                                              | One page (proposed)                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Editing one amount                        | Open editor → Next → step 2 → edit → Next → Next → Save. Or the rail.  | Edit ingredients → lands in the section → edit → Save.                               |
| Seeing the whole recipe before publishing | Needs a separate Review step, which today shows the wrong amounts (F3) | The page _is_ the whole recipe. "Preview" opens the real detail view in a sheet.     |
| Chunking for a new cook                   | Steps chunk it                                                         | Sections and the index chunk it. The status dots give the same goal-gradient signal. |
| Chrome on a phone                         | ~230 px before content today (W2)                                      | header 56 + JumpBar 44 + ActionBar 72                                                |
| Prior art                                 | n/a                                                                    | Paprika's editor is one form (judgement from recall, not verified today)             |
| Build                                     | exists                                                                 | a new frame. The step bodies are reused as sections.                                 |

- **The 70% path, if the owner keeps the wizard:**
    - keep it for **create**.
    - make **edit** open the step that holds what the user tapped (deep-link `?step=ingredients`).
    - apply §4.7.2–§4.7.6 inside the steps.
    - take the audit's S1 frame for the chrome.
- **Flip condition:** a 5-person think-aloud ("enter this 8-line recipe from a card") showing more errors or more time
  on the one-page form than on the wizard.

#### 4.7.2 Details section

Groups with headings, no card per group (one form does not need boxes, common region is not needed when proximity
does it):

1. **Title** (auto-growing, ≤ 3 lines, `wrap:3`, soft limit 120 with a counter at 100+, never cut, O1).
   **Description** (≥ 3 rows, counter at 230/256).
2. **Servings** (`Stepper`). **Prep** and **Cook** (`DurationField`). "Total: 5 h 30 min" is computed text, hidden
   while both are empty. Never "0".
3. **Cuisine** (combobox) · **Meal type** (`Chip kind="choice"`, `ChipRow scroll` at `@narrow`) · **Difficulty**
   (three `choice` chips plus a clear ×, not a "Not stated" chip. "Not stated" is the empty state.).
4. **Tags and diets** (chip input).
5. **Visibility** (Public / Private radio cards).
    - Visibility belongs with the recipe's metadata, not with photos. That differs from the audit's O3 placement.
    - Free tier: Private shows a `premium` "Premium" badge and opens the upsell.

`@regular`+: Servings, Prep and Cook sit on one row. Cuisine and Meal type are side by side.

#### 4.7.3 Ingredients section: the add loop (⚠️ A6)

The trailing **add field** is the heart of the editor.

```
Ingredients                                           [📋 Paste a list] [⋯]
For the lamb                                                          ⋯
  2–2.5 kg   Lamb shoulder, bone-in · trimmed of excess fat           ⋯
  2          Preserved lemons · rind only, finely chopped             ⋯
  3 tbsp     Rose harissa paste                                       ⋯
  500 g      Chicken thighs, boneless skinless · roasted              ⋯
             ⚠ Choose a match                                          (warning-dark, row tap opens the picker)
Add an ingredient
( 2 tbsp olive oil                                           )   ← the add field
   ┌──────────────────────────────────────────────┐
   │ 2 tbsp  ·  olive oil                          │  ← the reading of what was typed (caption)
   │ Olive oil                         From USDA   │  ← food options, searched with "olive oil"
   │ Olive oil, extra virgin           From USDA   │
   │ Search for another food                       │
   └──────────────────────────────────────────────┘
```

**The quantity-first add field:**

- The cook types the line the way they say it: "2 tbsp olive oil".
- A **pure leading-measure reader** splits off "2 tbsp" (amount + known unit). The **rest** is the food search.
- The cook **picks a food** from the list, as today. The food is never stored as typed text (brief 1 holds).
- The new row appears with its amount and unit already set. Focus returns to the empty add field. The loop is
  **type → pick → type → pick**: no tab-through three fields per line.
- Prep words after a comma ("…, finely chopped") go to Preparation.
- If no measure is found ("salt"), the whole text is the search, and the row has no amount. **No invented "1"** (F5).

**Mechanism and its risk** (for `staff-architect`):

- The full parser (`recipe-import-core/src/ingredientLine.ts`, over `parse-ingredient`) is deliberately **outside**
  the Expo bundle (its own header says so).
- The reader proposed here is only "leading number, fraction or range, plus a unit that `normalizeUnit` already
  knows". `normalizeUnit` and the quantity schema already live in `@kitchensink/recipe-core`, which ships to both
  apps.
- Whether that reader belongs in recipe-core is the architect's call.
- **Fallback if refused:** the audit's field-first model (§S4.3 there) with labelled Amount/Unit/Preparation fields,
  which this layout also supports.

**Why ⚠️ OWNER:** brief 1 says "a cook never types a free-form ingredient line". I read its intent as "the food is
always picked" (stated in its next sentence). The amount prefix is a typed _structured_ value, not a free-form line.
If the owner reads it more strictly, the fallback applies.

**The read row** (the audit's S4.2, adopted with three changes):

- **Resolved rows show no status glyph.**
    - The audit puts an ⓘ on every resolved row. A glyph repeated on every row is noise (Nielsen #8), and it dilutes
      the glyph that matters.
    - **Only rows that need action carry a mark:** a `warning-dark` ⚠ plus the state word under the name ("Choose a
      match", "No match found", "Couldn't look up", "Food no longer listed").
    - Isolation makes them findable at a glance (Von Restorff).
    - The section index counts them.
- **Tap the row** to open its editor.
    - `@regular`+: inline, one open at a time (the audit's model).
    - **Phones: a bottom sheet** (`Sheet size="content"`).
    - Inline expansion on a phone shifts the rows under the cook's thumb and fights the keyboard. A sheet keeps the
      list still, puts the fields above the keyboard (the sheet primitive already handles `visualViewport` and
      `KeyboardAvoider`), and has one clear **Done**.
    - It is the translation-table pattern "inline editing → a focused edit screen" (`cross-platform-translation.md`).
- **The row editor** shows the food as a line with its facts and a **Change** button: "Lamb shoulder, raw · 282
  kcal/100 g · USDA [Change]".
    - The details panel the ⓘ used to open (nutrition, variants, candidates) is here.
    - Fields with visible labels: **Amount** (and "+ Add a range" → **to**), **Unit**, **Preparation**.
    - No per-row group field (R3).
- **⋯ per row:** Edit · Change food · Move to group… · Move up · Move down · ─ · Remove.
    - Drag handles appear on a fine pointer only, as an enhancement. Move up/down satisfies SC 2.5.7.
- **Groups:** set at the section level (the audit's S4.4, kept). An ungrouped recipe shows no group chrome.

**Nutrition total:** the ActionBar's leading slot shows "612 kcal / serving · 7 of 9 counted" (`caption`, tabular).
It is always visible while entering, never "0 cal" when nothing is counted ("Match ingredients to see nutrition").

#### 4.7.4 Method section

- One block per step:
    - an ocean-dark numeral.
    - an auto-growing textarea (≥ 2 lines, `stepBody`, full width at every size. It fixes I1, the 12 px field at 320).
    - under it, an optional **Timer** (`DurationField`).
- ⋯ per step: Move up · Move down · ─ · Remove step.
- **+ Add step** (neutral) at the end. Enter at the end of a step's text does _not_ create a step (steps contain line
  breaks). Ctrl/Cmd-Enter does, on web.
- **Paste several steps:** pasting text with blank lines between paragraphs into an empty step offers "Split into 4
  steps?" (inline, **Split** / **Keep as one**). Postel's law: accept what the cook has.

#### 4.7.5 Photos section

- A grid of 1:1 tiles, the first labelled **Cover**.
- **Add photos** (neutral, camera/image glyph), with multi-select. Native: the image picker plus camera.
- Each tile's ⋯: Make cover · Move earlier · Move later · ─ · Remove.
- Empty: a `RecipeCover` preview of _this_ recipe, with "No photo? This cover is used instead. Add a photo any time."
  It shows the cook what the fallback looks like, so a missing photo is a choice, not a failure.

#### 4.7.6 Paste, inside the editor (answers O4)

- **"Paste a list"** in the Ingredients heading opens a sheet: a textarea ("One ingredient per line") with a live
  count ("9 lines").
- **Add 9 ingredients** sends the lines to the existing parse job.
- The rows appear at once in a pending state ("Reading…"), then settle into read rows. Those needing a food show
  "Choose a match".
- The FAB's **Paste ingredients** opens a new editor with this sheet already open.
- Title and method detection are out of scope until the parse pipeline offers them. So v1 takes ingredient lines
  only, and the sheet says so: "Paste the ingredient list. You can add the method next."
- **The standalone `/parse` pages retire.** The dead end (F6) cannot exist, because the flow ends inside the recipe.
- **Mechanism** (parse job → editor rows, with R19: a parse binds nothing) is `staff-architect`'s.

#### 4.7.7 Editor states

| State                               | Shown                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| New, empty                          | Title field focused on desktop only. All sections visible and empty, each with one line of help. No "0" anywhere.                 |
| Loading (edit)                      | Section skeletons at real heights                                                                                                 |
| Dirty                               | "Not saved" in the header. The discard guard on ✕, browser Back, Android Back and the iOS edge swipe.                             |
| Saving / saved / save failed        | "Saving…" / "Saved ✓" / an inline alert above the ActionBar: "We couldn't save. Your changes are kept on this device. Try again." |
| Publish blocked                     | Errors at fields + "Fix 2 things to publish"                                                                                      |
| Publishing                          | Primary busy, the bar locked                                                                                                      |
| Conflict (409)                      | The existing conflict view                                                                                                        |
| Offline                             | Edits queue through the offline write port. Banner: "You're offline. We'll save when you're back." Publish waits.                 |
| Line pending / needs match / failed | Per the read-row states above                                                                                                     |

### 4.8 Collections

The audit's §C is **kept** (cards with a cover mosaic, a detail page with one primary plus an overflow, remove with
undo, the delete confirm, a wide-screen right rail). Changes:

| Element                | Change                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility at `@wide`  | A two-option `SegmentedControl` (Public / Private), saved on press with undo                                                                                                                                                                                                                                         | same as the audit, with my segmented control                                                                                                                                                                                                               |
| "Clone collection"     | **"Save a copy"**                                                                                                                                                                                                                                                                                                    | glossary §3.5                                                                                                                                                                                                                                              |
| **Add recipes picker** | **Multi-select checklist**, not per-row **Add** buttons. Each row is a checkbox row (thumb + title + meta). Rows already in the collection start checked. The ActionBar shows **Done · 3 added** (or "· 3 added, 1 removed"). Unchecking a member removes it on Done, with an undo snackbar back on the detail page. | One gesture per row and one commit, instead of per-row buttons that change label. A standard multi-select pattern (bulk selection needs a visible count, `interface-patterns.md`). It fixes "In this / collection" wrapping by removing the status column. |
| Picker header          | "Add to {collection}" in `pageTitle`, `wrap:2`, then truncate                                                                                                                                                                                                                                                        | E8                                                                                                                                                                                                                                                         |

### 4.9 Version history

- **Header:** `PageHeader`, eyebrow "‹ {recipe title}" (`truncate:1`), H1 "Version history".
- **Rows:**
    - "Version 12 · Edited 2 days ago" (`body` 600).
    - "Changed: ingredients, method" (`meta`, slate).
    - ⋯: Preview · Restore this version · Compare with current.
- **Compare** is one action per row, against the current version. The audit's "check two rows" model needs a hidden
  mode and a sticky bar for a rare task. Comparing two old versions to each other is rare enough to defer
  (disposition: deferred).
- **Empty:** a 48 px clock glyph, "No earlier versions yet", "Each time you save changes, the version before is kept
  here." + **Back to recipe** (audit V2).
- **States:** loading (3 skeleton rows) · error + **Try again** · restoring (busy row) · restored ("Restored version
  9." with **Undo**).

### 4.10 Profile (one page, answers Q4)

The audit's §P is **kept** (one destination with sections, redirects from `/settings` and `/account`, a danger zone
with confirms). Changes:

- **Reached from the avatar** (§3.1), not a tab.
- **"What should we call you?"** lives here as the optional display-name field (§4.1). It is the only place the
  name is asked.
- **No mockup controls without features.** The mockup's units, default servings, dietary preferences, two-factor and
  public-profile switches have no backend. They are not drawn, which keeps Nielsen #1 and avoids dead controls.
- **Sign out** is a neutral button labelled "Sign out" (8 characters, `room`).
- **The danger zone** uses `error-dark` text buttons. The confirms use filled `error` plus a verb.

### 4.11 404, errors, offline

- **404:** the audit's §N (branded, inside the shell when signed in, H1 "We can't find that page", **Go to Home** +
  **Search Discover**), with a `RecipeCover`-style illustration: an empty plate on a tint. Mechanism for
  `staff-architect`.
- **Route-level crash** (root error boundary): "Something broke on this page." + **Try again** + **Go to Home**, plus
  a reference code in `caption` for support. Never only "Something went wrong" (`content-design.md`).
- **Offline:** the audit's §S.5 strip. On native it sits under the large title, not over it.

### 4.12 Platform translation register (screens)

| Element                | Web                                               | Native                                                                                                                 | Disposition      | Why                                           |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- |
| Detail ⋯ menu          | popover, flips above                              | titled sheet                                                                                                           | translated       | reach, no anchored popovers near screen edges |
| Ingredient row editor  | inline at `@regular`+, sheet at `@narrow`         | sheet (phone), inline (tablet)                                                                                         | translated       | keyboard + thumb stability                    |
| Section index (editor) | sticky side list at `@wide`, JumpBar below        | JumpBar                                                                                                                | collapsed        | needs 200 px                                  |
| Paste                  | sheet in the editor                               | the same sheet, native also offers **Paste from clipboard** as one tap when the clipboard holds text (with OS consent) | kept             | same job                                      |
| Keep screen on         | Wake Lock API                                     | `expo-keep-awake`                                                                                                      | kept             | same job                                      |
| Drag reorder           | fine pointer only, as an enhancement              | none (⋯ Move up/down)                                                                                                  | dropped on touch | SC 2.5.7, drag lists are fiddly one-handed    |
| Rail arrows            | fine pointer only                                 | none (peek)                                                                                                            | translated       | no hover/precision on touch                   |
| Picker Done            | ActionBar on phones, header button at `@regular`+ | ActionBar above the keyboard                                                                                           | moved            | thumb zone                                    |
| Detail stats           | 4–5 cells in one row                              | 2 × 2 below 360 pt                                                                                                     | collapsed        | 320 width                                     |
| Hover row tint         | yes                                               | pressed state                                                                                                          | translated       | n/a                                           |

**Checks run for every screen above:**

- **Primary action position:** bottom ActionBar on phones for tasks (editor, picker, filters). In flow under the
  title for reading pages, since the tab bar owns the bottom edge.
- **Longest strings:**
    - "Slow-Roasted Lamb Shoulder with Preserved Lemon, Chickpeas and Herb Yoghurt" wraps in titles (content) and
      truncates at 2 lines on cards.
    - "Food no longer listed" (21 characters) is text, not a control.
    - "Fix 2 things to publish" is the live line, not a button.
    - The largest button label is "Save a copy" (11 characters).
    - At +35% German, "Kopie speichern" is 15 characters, which fits a `fill` button.
- **320 px:**
    - the stat strip relayouts to 2 × 2.
    - the add field is full width.
    - the row amount column is 88 px ("12–14 tbsp" in 14 px semibold ≈ 80 px).
    - no page scrolls sideways (rails and chip rows scroll inside themselves).
- **Keyboard open:**
    - the editor's ActionBar unpins past half the frame (`compactHeightLayout.md` A1).
    - the row sheet lifts above the keyboard.
    - the add field scrolls to `block: nearest`.
    - sign-in's primary stays above the keyboard on native (`KeyboardAvoider`).

---

## 5. The 14 owner decisions

The 14 are `specShellAndLists.md` §Q (Q1–Q9) and `specRecipeAndWizard.md` §S11 (O1–O5). Verdict first, reasoning
after. "Cheap now" means it costs code only, because nothing is live.

| #   | Decision                                             | My verdict                                                                                                                                                                                                   | vs audit                                                         |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Q1  | Where Collections lives on web                       | **Inside Recipes, as the second segment ("My recipes · Collections")**, `/collections` unchanged.                                                                                                            | Same home, different structure: Discover leaves this group (A1). |
| Q2  | Rename "Community" to "Discover"                     | **Yes, and make Discover a level-1 destination.**                                                                                                                                                            | Further                                                          |
| Q3  | Hide unbuilt destinations from the phone tab bar     | **Yes, and from the sidebar and drawer too.** They appear only as Home previews, and join the bar permanently when they ship.                                                                                | Further                                                          |
| Q4  | Merge Profile, Settings and Account                  | **Yes.** One page, `/settings` → `/profile#preferences`, `/account` → `/profile#danger-zone`. Do it now.                                                                                                     | Same                                                             |
| Q5  | Home: live widget first                              | **Yes.** Recent recipes → Coming to Commise. Create actions live in the recent-recipes widget's empty state, so FR-046's one-live-widget rule holds.                                                         | Same                                                             |
| Q6  | Clerk sign-up fields                                 | **Email + password (+ Google) only.** Username off, names off. The display name is asked after sign-up, skippable.                                                                                           | Stricter (audit: names optional)                                 |
| Q7  | Brand line on sign-in                                | **Yes, but "Your recipes, in one place."** Not "…Plan with ease" until Plan exists.                                                                                                                          | Different copy                                                   |
| Q8  | Remove the bell                                      | **Yes.** And the magnifier, and on desktop the whole top bar.                                                                                                                                                | Further                                                          |
| Q9  | The phone row card defers tags and version           | **Yes**, for the list view only, and only those two. Cuisine, kcal and relative time stay on the row but may drop off its end when space runs out (drop order in §4.4). The grid keeps CR-002 in full.       | Same, with a stated drop order                                   |
| O1  | Title cap                                            | **120, a soft limit** with a counter from 100, never a silent cut.                                                                                                                                           | Same                                                             |
| O2  | Replace the wrapping row with read rows + one editor | **Yes**, with three changes: no glyph on resolved rows, a sheet editor on phones, the quantity-first add field.                                                                                              | Modified                                                         |
| O3  | Step 4 = "Photos & review"                           | **Superseded by A5:** Photos is its own section, visibility moves to Details, "Review" becomes **Preview** (the real detail view in a sheet). If the wizard stays: approve O3, but put visibility in step 1. | Different                                                        |
| O4  | Paste → "Start a recipe with these"                  | **Yes, by moving paste into the editor** (§4.7.6), so there is no hand-off page to end on.                                                                                                                   | Different mechanism                                              |
| O5  | "Clone" → "Save a copy"                              | **Yes, for recipes and collections alike.** Attribution: "Copied from @handle".                                                                                                                              | Fixes the audit's internal inconsistency                         |

**Reasoning, where the verdict is not self-explanatory:**

- **Q1/Q2.**
    - "My recipes", "Collections" and "Discover" as three sibling tabs mix two scopes (mine vs everyone's) under one
      label. The search field's scope then changes silently with the tab.
    - Splitting by scope at level 1 and by view at level 2 gives each search one clear scope
      (`information-architecture.md`).
    - The term "Discover" already matches the URL and the native tab, so only the web label moves.
- **Q3.**
    - Apple's rule against hiding tabs protects _stability_ (quoted in §3.2). A destination that does not exist yet
      cannot be unstable if it is absent until it ships, and then stays.
    - Disabled "Soon" items cost a target slot and attention on every page for zero function.
- **Q6.**
    - Each optional field still costs completion (`interface-patterns.md`: "Every optional field measurably costs
      completion").
    - The app's handle is `profiles.displayName`, not Clerk's username, so the username field serves nobody.
- **Q7.**
    - A tagline that names an unbuilt feature sets an expectation the first session breaks (judgement. Nielsen #2,
      match with the real world).
- **O2 changes.**
    - An ⓘ on every resolved row makes the warning glyph one of many.
    - Inline expansion on a phone fights the keyboard.
    - Typing "2 tbsp olive oil" is how a cook already says the line, and the food is still picked.
- **O5.**
    - "Clone" is developer vocabulary (Nielsen #2).
    - One concept, one word (`content-design.md`, terminology governance).
    - Renaming later means keys in every locale, docs and support macros. Today it is one change.

### Additional decisions this proposal raises (⚠️ OWNER, each with a recommendation)

| #   | Decision                                                                                                | Recommendation                                                                                    | Door                                  |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| A1  | Discover as a level-1 destination, tab bar = Home · Recipes · Discover                                  | Approve                                                                                           | one-way (IA, cheap now)               |
| A2  | Profile reached from the avatar, not a tab, future bar = Home · Recipes · Discover · Plan · Shop        | Approve                                                                                           | one-way (IA)                          |
| A3  | No top bar on desktop, large titles on phone, no drawer                                                 | Approve                                                                                           | two-way                               |
| A4  | "Screen on" toggle + tap-to-check ingredients + current step on detail, as an early slice of 008 FR-035 | Approve as a slice of 008, not as 001 scope creep. It is small and the highest-value kitchen aid. | two-way                               |
| A5  | One-page editor for create and edit, replacing the 4-step wizard                                        | Approve. The 70% path is in §4.7.1.                                                               | two-way (no URLs learned)             |
| A6  | Quantity-first add field (amount typed, food picked)                                                    | Approve, subject to `staff-architect` on the reader's home. The fallback is field-first.          | two-way                               |
| A7  | Coral out of controls, neutral secondary buttons, ocean-dark for selection                              | Approve                                                                                           | two-way (token values, not semantics) |
| A8  | `RecipeCover` typographic covers for photo-less recipes                                                 | Approve                                                                                           | two-way                               |
| A9  | Clone/Save-a-copy off Discover cards, onto the recipe page                                              | Approve                                                                                           | two-way                               |

---

## 6. Build order (each slice ships web and native together, test-first, with Playwright + Maestro on the slice)

Ordered by **owner-visible defects removed per unit of work**, with primitives before the screens that use them.

| #   | Slice                               | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Fixes                                           | Size |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- |
| 0   | **Stop the bleeding** (days)        | E1 rail skeleton containment · `formatDuration` everywhere (F1, D8) · no invented "1" (F5) · review ranges (F3) · title soft limit (F4) · remove the bell and magnifier (E13) · native avatar glyph (M8) · **the three severity-4 blockers, each with a minimal fix that needs no decision:** I1 (step 3's text field gets the full row at 320, the timer moves under it) · M1 (native Recipes gets a way back to Home: the existing tab bar rendered under Recipes too, before the per-tab stacks of slice 2) · E3 (the collection header's actions move below the title at `@narrow`, and `break-words` comes off the flex item) | the worst wrong-data and reflow defects         | S    |
| 1   | **Tokens and type**                 | colour roles §2.5 (secondary neutral, selection ocean-dark) · `pewter` · difficulty tints · surface levels §2.6 · native Inter registration + the Android elevation map · role scale + `stat`/`amount`/`stepBody`                                                                                                                                                                                                                                                                                                                                                                                                                  | the "looks cheap" class on every screen at once | M    |
| 2   | **Shell + IA**                      | tab bar = Home · Recipes · Discover on web and native (native: `AppRoot`-owned per-tab stacks, `staff-architect`) · sidebar without "Soon" items, avatar at the foot · no desktop top bar · large titles · no drawer · 404                                                                                                                                                                                                                                                                                                                                                                                                         | E2, E4, E7 (tab labels), E16, E31, E32, M1      | M–L  |
| 3   | **List primitives**                 | `Chip`/`ChipRow`, `SegmentedControl`, `SearchField`, `Button` adoption (29 bespoke buttons), `RecipeCover`, card + row card with subgrid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | E5, E6, E10, E11, E19, E29, E30, E35            | M    |
| 4   | **Recipes, Home, Discover screens** | §4.3–§4.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | E9, E14, E17, E20–E22, E27, M2                  | M    |
| 5   | **Recipe detail**                   | §4.6: hero = carousel, magazine split, stat strip, serves-with-ingredients, `JumpBar`, tap-to-check, current step, `ActionMenu`, delete confirm · (A4) Screen on                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | F2, D1–D12                                      | M    |
| 6   | **Editor**                          | §4.7: one-page frame (A5) or the 70% path · `FieldLabel`/`DurationField`/`Stepper` · read rows + editor (sheet on phones) · quantity-first add (A6) · groups · method · photos · `ActionBar`                                                                                                                                                                                                                                                                                                                                                                                                                                       | R1–R13, W1–W5, I1–I4, S1–S2, RV1–RV3            | L    |
| 7   | **Paste in the editor**             | §4.7.6, retire `/parse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | F6, P1–P3                                       | M    |
| 8   | **Collections + picker + versions** | §4.8, §4.9, `UndoSnackbar`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | E3, E8, E24–E26, M7, V1–V3                      | M    |
| 9   | **Profile + auth**                  | §4.10, §4.1, Clerk dashboard fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | E15, E23, E33                                   | S    |

**Cheaper path, if the budget is tight:** slices 0, 1, 3 and 5 alone remove most of what the owner described ("looks
like shit", wrapping, unreadable, misaligned) on the surfaces seen most. They need no IA decision and no new editor,
and slice 0 already clears every severity-4 blocker (I1, M1, E1, E3). Slice 2 is the next most valuable, because it
gives the IA its final shape.

**How we will know it worked** (falsifiable, automated where possible):

1. **No sideways scroll.** Playwright at 320/390/768/1280/1920 on every route, loading and loaded:
   `scrollWidth === innerWidth`.
2. **No wrapped controls.** Every `button`, `[role=tab]`, chip, segment and tab-bar label renders as one line
   (`getClientRects().length === 1` on its text) at 320 with pseudo-localised +35% strings.
3. **Content on the first screen.** At 390 × 844:
    - the first recipe card is fully visible on Home and Recipes.
    - on detail, the title, rating and total time are visible.
    - in the editor, five ingredient rows are visible.
4. **No blank boxes.** No `img` slot without a `RecipeCover` fallback (a component test over the card, row,
   thumbnail and hero).
5. **Maestro screenshots** of every top-level screen on a Pixel 6 and an iPhone simulator, re-read by
   `staff-ux-engineer` EVALUATE against this file.
6. **After release** (signal, read by the owner):
    - drafts started → published (primary).
    - time from editor open to first ingredient matched.
    - guardrail: recipes created per active user must not fall after the paste-first ordering.
    - First sign of trouble: more drafts abandoned at Ingredients than before.

---

## 7. Where I disagree with the first audit (summary)

1. **IA.** Discover is a level-1 destination, not a tab inside Recipes. Profile is the avatar. Unbuilt destinations
   are absent from all navigation, not shown disabled with "Soon" (§3.1, §3.2).
2. **Chrome.** The audit hides the H1 and keeps the top bar. I keep the H1 and delete the top bar: on desktop
   entirely, on phones in favour of large titles. I also remove the drawer and the search shortcut, which the audit
   kept (§3.3).
3. **Native tab bar on pushed screens** stays visible (HIG). The audit hid it.
4. **The wrap rule** must be the owner's three-condition test, not "never inside a short label" (§2.2).
5. **Colour jobs.** Selection uses ocean-dark, not the primary seafoam. Secondary buttons are neutral, not coral
   (§2.5).
6. **The editor** is one page, not a 4-step wizard (§4.7.1). Paste lives inside it (§4.7.6), not as a page with a
   hand-off button.
7. **Ingredient rows.** No ⓘ on resolved rows, a sheet editor on phones, and quantity-first add (§4.7.3).
8. **Detail.** The serves stepper moves into the Ingredients heading. Stats come before the description. The desktop
   uses a magazine split. Tap-to-check, current step and "Screen on" are added (§4.6).
9. **Discover cards** lose the Clone button (§4.5).
10. **Collection picker** becomes a multi-select checklist (§4.8). **Versions** compare against current, not
    pick-two (§4.9).
11. **O5 consistency.** "Save a copy" for collections too. The audit's glossary still says "clone".
12. **Widths.** `content-wide` 1440, not 1280, so 1920 shows five columns instead of a dead right margin (§2.3).

**Where the audit is right and I kept it:**

- the token fixes (`pewter`, difficulty, Android elevation, native Inter).
- the container-query model.
- `PageHeader`'s anti-collapse flex basis.
- `Chip`/`ChipRow`/`SearchField`/`UndoSnackbar`.
- the filter sheet/panel split and single "Total time" group.
- collection detail's single primary plus overflow.
- undo-not-confirm for removals.
- the 404 outcome.
- `formatDuration`, `FieldLabel`, `DurationField`, `Stepper`.
- groups at the section level.
- the detail page's sticky ingredients column on wide screens.

These are good, and most of my proposal builds on them.

---

## Advocacy

| Where the brief and the end user diverged                                            | Situation | What I recommended                                          |
| ------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------- |
| "Make it perfect … the best UI possible" vs a fixed 4-step wizard in the wireframe   | B         | A one-page editor with the 70% path offered (§4.7.1)        |
| The mockup's "Plan with ease" line vs a product with no planning                     | B         | Honest copy until Plan ships (Q7)                           |
| Owner directive: bottom tab bar on tablets vs Material's rail-at-medium              | C         | Conceded. Both are allowed.                                 |
| CR-002 "every card shows the full field set" vs a phone row that must stay scannable | B         | Full set on grid cards, the list row defers two fields (Q9) |
| FR-046 placeholders vs a first screen without content                                | B         | Shapes kept, ordered after live content (Q5)                |
| 008 cooking mode not built vs a cook needing the screen to stay on                   | B         | An early, small slice, owner's call (A4)                    |

## Evidence: verified · assumed · judgement

- **Verified (rendered or computed today):**
    - every defect cited from the web captures I viewed (Home, Recipes, detail, step 2, step 3, review, parse,
      versions, profile, collections, picker, filter sheet at 320/390/768/1280/1920).
    - the mockups' own reflow failures (792 px and 482 px at 390).
    - all contrast ratios in §2.5 and §2.9.
    - the native nav structure (`AppRoot.tsx:46-49`, `RecipesScreen.tsx:40-63`).
    - Feather as native's icon family (62 usages).
    - 008's Draft status and FR-035.
    - the parser's bundle boundary (`ingredientLine.ts` header).
    - Apple HIG tab-bar quotes (primary JSON).
    - MDN Wake Lock.
    - NN/g's 179-participant hidden-navigation study (primary page).
- **Secondary / recalled:**
    - Material 3 bar vs rail counts (via SAP Fiori's M3 pages, not m3.material.io, which did not render).
    - Paprika's Cook feature (App Store listing, via search).
    - NYT Cooking's desktop layout and Paprika's one-form editor (recall, **not verified**).
- **Assumed:**
    - home cooks' recipes are often photo-less (no data exists yet).
    - paste is the faster first recipe (informed prior: Tesler's law and ReciMe's capture-first IA).
- **Judgement:**
    - the typographic cover.
    - coral leaving the controls.
    - the magazine split.
    - "Method" as a section name.
    - the large-title pattern on web phones.

## References consulted

- **Corpus** (`ux-design-corpus`): `design-process.md`, `human-factors.md`, `visual-design.md`, `visual-systems.md`,
  `cross-platform-translation.md`, `device-ergonomics.md`, `information-architecture.md`, `interaction-motion.md`,
  `interface-patterns.md`, `content-design.md`, `accessibility.md` and `internationalisation.md` (sections for SC 2.4.11,
  2.5.7, 2.5.8 and +35%). Playbook: `ux-mode-playbooks` DESIGN.
- **Live, fetched 2026-10-08:**
    - [Apple HIG, Tab bars (JSON)](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json):
      "Don't disable or hide tab bar buttons…", "If you hide the tab bar, people can forget which area of the app
      they're in", "Use single words whenever possible".
    - [MDN, Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
    - [NN/g, Mobile navigation: even hamburger…](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/)
      and [desktop counterpart](https://www.nngroup.com/articles/find-navigation-desktop-not-hamburger/)
    - [SAP Fiori for Android, M3 navigation bar](https://www.sap.com/design-system/fiori-design-android/v25-8/components/m3-standard-components/navigation-bar/usage)
      and [navigation rail](https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-rail/usage)
      (secondary source for Material 3)
    - [Paprika Recipe Manager 3, App Store](https://apple.co/2yjB8Oh) (via search)
- **Repo:**
    - `docs/design/uiOverhaul/{evaluateShellAndLists,evaluateRecipeAndWizard,specShellAndLists,specRecipeAndWizard,specSharedSystem}.md`
    - `docs/mockups/README.md`, `docs/mockups/screens/*.html` (rendered), `docs/mockups/briefs/recipeIngredientEntryFigmaMakePrompt.md`
    - `specs/001-commise-recipe-app/spec.md` (FR-044, FR-045a, FR-046), `product-spec/wireframes/recipe-edit.md`
    - `specs/008-cooking-mode/spec.md`
    - `docs/competitive/01RecimeTeardown.md`
    - `packages/apps/commise/ui/src/*` (inventory, `tokens/scale.ts`, `layout/pinnedFooter.ts`, `sheet/`)
    - `mobile/src/screens/AppRoot.tsx`, `RecipesScreen.tsx`
    - `shared/recipe-import-core/src/ingredientLine.ts`

## Validation run (§6c)

1. **Against publication:** HIG tab bars (primary), MDN Wake Lock (primary), NN/g hidden navigation (primary). This
   _changed_ my Q3 reasoning: I first read HIG's rule as forbidding removal. Its scope is temporarily empty content,
   so I argue from its stated reason (stability) instead.
2. **Against prior art:**
    - Paprika: cross-off ingredients, highlight the current step, keep the screen on. I follow it.
    - ReciMe: capture where the recipe is, and no feed tab. I follow the first and depart from the second (Discover
      stays, but not as Home).
3. **Against a second expert** (the questions for `staff-architect`):
    - per-tab native stacks in `AppRoot`.
    - the home of the leading-measure reader.
    - parse job → editor rows.
    - the 404 routing.
    - the one-page editor reusing the step bodies.
    - Assumed in their absence: all feasible without API changes.
4. **Against myself:** the strongest case against A5 (one page) is that new cooks benefit from the wizard's one-thing-
   at-a-time focus, and the wizard is already built. Answer: the sections give the same chunking, and edit (the
   common case after creation) suffers most from steps. But it is the costliest change here, so I offer the 70% path
   and a falsifying test. The case against A2 (Profile in the avatar) is that the mockup and today's users have it as
   a tab. Answer: nothing is live, so there are no users to relearn, and five future destinations cannot fit six
   tabs.

## Artefacts written

- `docs/design/uiOverhaul/proposalA.md`: a design proposal (§9 category: design spec). Nothing else was written. The
  local mockup server I started (port 8765) was stopped.

## Questions blocking this

None block the build. A1–A9 and the 14 decisions each carry a recommendation.

## Hand-off

1. **Owner:** rule on Q1–Q9, O1–O5 and A1–A9 (this file §5).
2. **`staff-architect`** (PLANNING):
    - native per-tab stacks.
    - the leading-measure reader's home (A6).
    - parse → editor (O4/§4.7.6).
    - the one-page editor frame (A5).
    - the 404 mechanism.
    - `lucide-react-native` and `expo-keep-awake` dependencies.
3. **`staff-ux-engineer` SPECIFY:** convert this proposal plus the audit's specs into one committed spec per slice
   (§6), starting with slices 0–1, which need no decision.
4. **`fe-1`:** builds slice by slice. Its accessibility floor must be WCAG 2.2 AA.

**State to carry forward:**

- Context: a home cook, phone-first, reading at the counter and entering seated.
- Direction: "a cookbook on the counter", with two postures.
- Flip conditions:
    - A5 flips on a think-aloud showing the one-page editor is slower.
    - A6 flips if the architect refuses the reader.
    - Q1/A1 flip if the owner wants Collections or Discover placed differently, which must be decided before any URL
      is shared.
