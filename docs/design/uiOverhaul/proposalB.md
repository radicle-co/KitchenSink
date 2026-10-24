# UI overhaul: proposal B, an independent design for the whole app

⛔ **DESIGN PROPOSAL. NOT PRODUCTION CODE.** Nobody built or tested any of it with a user. It is one
designer's answer to the owner's brief. It competes with the first audit and tries to improve on it
(`evaluateShellAndLists.md`, `evaluateRecipeAndWizard.md`, `specShellAndLists.md`,
`specRecipeAndWizard.md`, `specSharedSystem.md`). Where I agree, I write "keep" and cite the first spec.
Where I disagree, I say so and give the reason.

- **Mode:** DESIGN, converged to one answer per question, because the requester asked for one answer.
  Each section names the main alternative it rejected. **Date:** 2026-10-08. **Agent:**
  `staff-ux-engineer`.
- **Standing.** I wrote none of these screens and none of the first audit's specs. So this is not a
  review of my own work.
- **What I saw rendered.**
    - Web: the 2026-10-08 production captures at 390 and 1280 for every state. Also 768 and 1920 for Home,
      Recipes, recipe detail, step 2, Discover and collection detail.
    - 320: I took the first audit's findings and checked some of them against the captures.
    - Mockups: I rendered `docs/mockups/screens/*.html` myself, at 390 and 1280, from a local server.
    - Android: six different captures (Home, library, the create menu, step 1, the discard dialog).
    - Not seen: native Discover, Collections, Profile and recipe detail. **Nobody has seen native
      tablet.** Claims about those come from source and carry the mark _(source)_.
- **Not user evidence.** Each claim about behaviour is either heuristic judgement (labelled as such) or
  an informed prior with a named, cited mechanism. I observed no user.
- **Accessibility floor:** WCAG 2.2 AA. Native touch targets follow Apple HIG (44 pt) and Material
  (48 dp). On each platform the strictest rule applies.
- **Owner rulings this proposal obeys:**
    - The mockups are the floor, not the ceiling.
    - FR-045a: the signed-out front door is sign-in. No welcome screen stands in front of it.
    - Desktop gets a left sidebar. Tablet and phone get a bottom tab bar (owner UX directive, 2026-07-18).
    - The FAB is the only way to create a recipe.
    - The CR-002 merged card keeps its full field set.
    - FR-046: unbuilt Home widgets show as placeholders in the real widget's shape.
    - Wrapping is the second-to-last resort. It is never acceptable inside a control (memory
      `wrappingInControlElements`).
    - Nothing is live and no database holds user data (memory `notLiveNoData`). So a change to a URL or
      a term costs code only.
- **Register.** In two places I think a ruling costs the product something. There I say so once, as "I
  recommend", and then I design inside the ruling.

**Contents:**

- §1 Design direction
- §2 Shared system
- §3 Navigation and IA
- §4 Screens and flows
- §5 The 14 owner decisions, plus five new ones
- §6 Build order
- §7 Validation, sources and hand-off

---

## §1. Design direction: "the cookbook at the counter"

### 1.1 What is wrong, in one paragraph

The app is not ugly because of one bad value. It is ugly because **nothing has a job**.

- Everything is pale on pale. Gradient cards sit on a gradient canvas. Pearl chips sit on sand at about
  1:1.
- There are five button looks and three "selected" looks. The coral outline buttons measure 2.23:1
  against sand.
- Shape means nothing. Inputs, chips, buttons and badges are all the same pill.
- Playfair sets page titles, card titles, section titles and even numbers. Its old-style figures make
  "30 min" read like "3o min" (detail stats card).
- Layouts are ported between widths, not designed for them. The tablet is a stretched phone. At 1920
  the content is a narrow column in a sea of space. The phone is a squeezed desktop: at 320 the step 3
  field is about 12 px wide.

The result reads as cheap. The reason is a fact about perception, not taste. Hierarchy comes from
contrast in size, weight, colour and space. With none of those contrasts, the eye has nowhere to land
(`visual-design.md`: six hierarchy variables, and the squint test).

### 1.2 The direction

People use a recipe app **at arm's length, one-handed, with wet or floury fingers, while doing
something else**. So the interface must behave like a good cookbook page. The food leads. The words are
calm and clear. The chrome is quiet. Six rules carry the whole design:

1. **Food is the colour. The UI is ink on paper.** Photos give the warmth. The UI uses charcoal ink,
   white paper and one action colour, seafoam. Coral leaves every control.
2. **Every visual property means one thing.**
    - Shape: a pill is something you press (a button, a chip, the search field). A rectangle with 12 px
      corners is something you type into, or a card.
    - Colour: a solid seafoam fill is the one primary action. A seafoam tint with a check means
      "selected". Red means destructive or failed, and nothing else.
3. **Two typefaces, three jobs.**
    - Playfair Display sets **names**: the greeting, the large page title, a recipe title, a collection
      name.
    - Inter sets everything else.
    - **Numbers always use Inter with tabular, lining figures.** That one rule fixes "3o min".
4. **Arm's-length reading on the surfaces you cook from.** On recipe detail, step text is 18 px with a
   1.6 line height. Amounts are semibold. Every target is at least 44 pt.
5. **Space makes the groups. Boxes do not.** One flat canvas. A white card appears only for one tappable
   object or one bounded group. A box never sits inside a box.
6. **Each container width gets its own design. No layout is a port** (agent §3.6 gate).
    - Phone: one column, with the primary action in the thumb zone.
    - Tablet: two panes where the task has two halves (ingredients and steps, filters and results).
    - Desktop: it uses the width it has, up to a 1440 px content cap, left-aligned to one edge.

**The one thing that makes this better than the obvious fix: every screen passes the counter test.** Its
first screen shows three things. What the screen is (one title, never two). The one action you came for.
Real content. For a recipe, the first screen answers "can I make this tonight?" in one **glance line**:
total time · serves · difficulty · rating. And while you cook, a sticky **Ingredients · Steps** switch
means you never scroll back up to find an amount.

### 1.3 Directions considered and rejected

- **"Utility list"**, in the style of Paprika (text lists, no images, tables for editing). It finds an
  owned recipe fastest. But it throws away the image-led brand of the mockups, and the mockups are the
  floor. Rejected.
- **"Magazine"**: a full-bleed photo feed everywhere. Beautiful with photos, broken without them. Three
  of the twelve fixture recipes have no photo, and the editor has none. It also costs the most
  scrolling. Rejected. Its best idea survives as the recipe-detail hero.
- **Chosen: "cookbook at the counter".** Images lead where you _browse_: Discover, cards, the detail
  hero. Text leads where you _find_ (your own library, as a list) and where you _work_ (the editor,
  cooking).

### 1.4 Where this departs from the first audit

The detail is in each section. This is the summary.

**About IDs.** D1 to D14 in this file are **my departures**, listed below. The first audit also uses
"D1" to "D12", for its recipe-detail findings. Where I cite one of those, I write "first audit D6".
The build-order table (§6) uses first-audit IDs only.

| #   | First audit                                                                | This proposal                                                                                                                  | Why                                                                                                                                                             |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Discover is a tab inside Recipes, beside My recipes and Collections.       | **Discover is a top-level destination.** Recipes holds _My recipes · Collections_.                                             | A user's mental model splits first on "mine" against "everyone's". One tab strip that mixes them repeats today's "Community" confusion (§3.2).                  |
| D2  | Keep the hamburger drawer on the phone web, and the avatar in the top bar. | **No drawer. No avatar in the phone top bar.** Four destinations fit in the tab bar, and the Profile tab icon _is_ the avatar. | Hidden navigation cut discoverability "almost in half" (NN/g, 2016, fetched). A drawer with nothing extra in it is pure cost.                                   |
| D3  | `PageHeader` with a hidden H1, and the title in the top bar.               | **Large-title header.** One visible title. It collapses into the bar as you scroll.                                            | One title, not two. It is the platform convention on iOS (large titles) and Android (collapsing app bar). It gives the brand face one strong moment per screen. |
| D4  | Selected chip uses a solid seafoam fill.                                   | **Selected uses a seafoam tint, ocean-dark text and a check.**                                                                 | A solid seafoam fill already means "primary action". Three selected chips in a row then look like three primary actions (Von Restorff).                         |
| D5  | Single-line inputs are pills.                                              | **Inputs are 12 px rectangles. Pills are only for things you press.**                                                          | Shape similarity (Gestalt) says "type here" or "press here". Today a row of pill inputs reads as a row of buttons (step 2).                                     |
| D6  | The Serves stepper sits in the stats block.                                | **Serves sits at the head of the ingredient list:** "Ingredients for 8 [−][+]".                                                | Natural mapping: a control belongs next to the thing it changes (Norman).                                                                                       |
| D7  | The wizard keeps Prev, Save draft and Next.                                | **Drafts save by themselves. The footer is Back and Next. You can visit steps in any order.**                                  | On a phone, interruption is normal, so entered data must never be lost (`cross-platform-translation.md`). A Save button makes the cook protect their own work.  |
| D8  | Step 2: pick a food, then open an editor to type the amount.               | **One-line entry.** Type "2–3 leeks, sliced". The app reads the amount, unit and prep on the device and matches only the food. | Postel's law: accept what people naturally write. It also removes the invented "1" (F5) by design.                                                              |
| D9  | Collection detail gets a 288 px action rail at `@wide`.                    | **One header at every width:** the primary button plus ⋯.                                                                      | Four rare actions do not earn a second column. The meta line shows visibility, and the menu changes it.                                                         |
| D10 | The add-recipes picker has an **Add** button per row, in a 96 px column.   | **Each row is a toggle.** Tap anywhere on the row to add or remove. A check circle sits at the end.                            | The whole row is the target (Fitts). It also lets you remove from the picker.                                                                                   |
| D11 | Unbuilt destinations stay in the sidebar and drawer with a "Soon" badge.   | **They leave all navigation. They live on Home only**, as the FR-046 placeholders.                                             | A nav item that goes nowhere is a dead control. Home already carries their shape by requirement.                                                                |
| D12 | The top-bar title is Playfair (`chromeTitle`).                             | **The collapsed bar title is Inter 17/600.**                                                                                   | Playfair at 17–18 px is thin and weak in chrome. The brand budget goes to the large title instead.                                                              |
| D13 | Step 4 embeds the full recipe preview inline.                              | **Step 4 has a Preview button. It opens the real detail page in a sheet.**                                                     | The publish step stays short (scroll budget), and the preview is the true page.                                                                                 |
| D14 | Keep the gradient canvas, remove the glass cards.                          | **Agree.** Keep the canvas wash (issue #145, a recorded decision). Remove every gradient or glass card on top of it.           | The defect is a box in a box, not the wash. The existing decision is right (Situation C).                                                                       |

**Also differs, in smaller ways:**

- Home's recent recipes are a 2 × 2 grid of photo cards, not row cards (§4.3).
- New collection and rename are a sheet, not a page (§4.6).
- Profile has no section nav on desktop (§4.12).
- The native tab bar stays on recipe and collection detail. It hides only for focused tasks (§3.3).
- Native's "Let's build your recipe" intro card goes, on both platforms (§4.9.2).
- The paste field uses Inter, not monospace (§4.10).
- Healthy ingredient rows show no status glyph. This overturns `ingredientStatusExplanation.md` §3a,
  which the first spec enforced (§4.9.3, N4).
- Q4 deletes `/settings` and `/account` with no redirects (§5.1).
- Q8 removes the top-bar search icon as well as the bell (§5.1).
- `content-wide` is 1440, not 1280 (§4 intro).
- The editor gets an outline column at `@wide` in place of the rail (§4.9.1).
- The library has no Sort until the list API supports one (§4.4).
- Steps hide their timer field behind "+ Add a timer" (§4.9.4).

---

## §2. Shared system (`packages/apps/commise/ui`)

**Keep these parts of `specSharedSystem.md` as written, and build from them:**

- §1 the overflow ladder: re-lay out, then shorten, then wrap to N lines, then truncate. Never put
  `nowrap` on a container. Never put `break-words` on a flex item.
- §2.1 the container classes, measured on `<main>`: `@narrow` below 600, `@regular` 600–959, `@wide` 960
  and up.
    - One correction. The first spec says its viewport classes are "named after Material's". Material's
      real breakpoints are compact below 600 dp, medium 600–840 dp, and expanded 840 dp and up (Android
      Developers, "window size classes", read today).
    - The repo's 640 and 1024 are Tailwind's `sm` and `lg`. Keep them, because the shell already
      switches at `lg`. Just do not call them Material's.
- §4 `pewter` (#858F93) for control edges, and the difficulty tints with a meter glyph.
- §5 the spacing roles: `gap-within` 8, `gap-group` 16, `gap-section` 32, card padding 16.
- §7–§9 `Chip`, `ChipRow`, `Tabs` and `SearchField`. My §2.4 changes only the selected look.
- §10 `Button` adoption. The 29 hand-built buttons move onto the primitive. Add `size: sm`, and the
  ghost and destructive variants.
- §11 Android elevation by level, not by offset.
- §12a `UndoSnackbar`.
- §13.2–§13.5: `FieldLabel`, `DurationField`, `Stepper`, `formatDuration`, the compact wizard progress,
  an `ActionMenu` that flips above its trigger, and `Combobox` V3-1 to V3-4.

The changes follow.

### 2.1 Colour: roles, not only values

I computed every pair with the WCAG 2.x relative-luminance formula on 2026-10-08.

| Role (semantic token)                           | Value                                                         | Use                                                                | Contrast                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface-canvas`                                | sand `#FAF6F0`, plus the existing beach-glow wash (no change) | page background                                                    | n/a                                                                                                                                                                                                                     |
| `surface-paper`                                 | white                                                         | cards, sheets, inputs, menus                                       | n/a                                                                                                                                                                                                                     |
| `ink`                                           | charcoal `#2D3436`                                            | all main text and icons                                            | 11.78:1 on sand. 12.68:1 on white.                                                                                                                                                                                      |
| `ink-muted`                                     | slate `#636E72`                                               | secondary text, meta, unselected tabs                              | 4.87:1 on sand. 5.24:1 on white.                                                                                                                                                                                        |
| `line-control`                                  | pewter `#858F93`                                              | edges of inputs, unselected chips and checkboxes                   | 3.07:1 on sand. 3.31:1 on white (SC 1.4.11).                                                                                                                                                                            |
| `line-divider`                                  | mist `#B2BEC3`                                                | dividers only, never a component edge                              | 1.90:1 (decorative, exempt).                                                                                                                                                                                            |
| `action`                                        | seafoam `#31807A` fill, white label                           | **the one primary button per view**, the FAB, a checked checkbox   | 4.67:1                                                                                                                                                                                                                  |
| `action-text`                                   | ocean-dark `#2A6B65`                                          | text buttons, links, the selected tab label                        | 6.20:1 on white. 5.75:1 on sand.                                                                                                                                                                                        |
| `selected-fill`                                 | seafoam at 14% over white                                     | selected chip and segment fill                                     | Ocean-dark label on it: **5.19:1**. A 1.5 px seafoam edge: 4.67:1 against white.                                                                                                                                        |
| `focus-ring`                                    | ocean-dark, 2 px wide, 2 px offset                            | every focusable element                                            | 5.75:1 against sand. The offset puts the ring on the canvas.                                                                                                                                                            |
| `rating`, a **new primitive `honey` `#A86A12`** | filled stars only                                             | rating stars. The number beside them ("4.8 (12)") is set in `ink`. | 4.43:1 on white. That passes SC 1.4.11 for a graphic, but it is under the 4.5:1 that text needs (SC 1.4.3). So honey never sets text. Today the stars use warning amber `#F5B041` at **1.88:1**, which fails SC 1.4.11. |
| `danger` and `danger-text`                      | error `#C05238` fill, error-dark `#B1442B` text               | the Delete button in a delete dialog, destructive menu items       | 4.66:1 and 5.63:1                                                                                                                                                                                                       |
| `warning-text`                                  | warning-dark `#966400`                                        | "Choose a match" and similar row states                            | 5.10:1 on white                                                                                                                                                                                                         |
| `ink-deep`, **new, cook view only** (§4.8)      | `#1E2427`                                                     | cook view background                                               | White text 15.71:1. Seafoam-light `#5BA8A0` 5.65:1. Mist 8.26:1.                                                                                                                                                        |

**Coral leaves the controls.** As an outline, coral is 2.23:1 against sand. That is why every "More",
"Back", "Save" and "Prev" pill looks washed out in the captures. From now on, coral is a **brand and
illustration** colour only:

- the logo mark
- the strokes of empty-state drawings

The PRO badge keeps its own token, `premium` `#D4A574` (gold), with charcoal text at 5.70:1, as the
mockup README lists. Coral never marks a control or a state. The secondary button becomes white paper, a 1 px `line-control`
edge and `ink` text. It is quiet, but it is clearly a button.

**A recorded decision I keep (Situation C).** `globals.css` paints the beach-glow wash on `body` on
purpose. Issue #145 did it so the app matches all nine wireframes. I keep it. What goes is every
**second** gradient on top of it:

- the glass H1 card on Recipes
- the greeting card on Home
- the title card and the description card on recipe detail

The first audit called these non-binding preferences. I make them rules. A tinted box on a tinted canvas
is a container with nothing to group (Gestalt common region), and that is a defect, not taste.

### 2.2 Type: roles, plus a role for numbers

Keep the role table in `specSharedSystem.md` §3, with these changes:

| Role                                                                            | Change                     | Face, size, weight, line height                                                                                                                                                                                          | Overflow rule                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `largeTitle` (**new**, it replaces `pageTitle` on top-level and detail screens) | new                        | Playfair 700. 28 at compact, 34 at `@regular`, 40 at `@wide`. Web: a bounded `clamp()` in container units (`cqi`, not `vw`), so the size follows `<main>`, not the window. Native: one size per class. Line height 1.15. | wrap:2 on top-level pages. wrap:3 on detail pages (recipe, collection). Never truncated in the body.                                       |
| `barTitle` (it **replaces** `chromeTitle`)                                      | Playfair becomes **Inter** | Inter 600, 17, line height 1.2                                                                                                                                                                                           | truncate:1. It appears only after the large title scrolls away.                                                                            |
| `sectionTitle`                                                                  | no change                  | Inter 600, 18, 1.25                                                                                                                                                                                                      | wrap:2                                                                                                                                     |
| `cardTitle`                                                                     | one size at every width    | Inter 600, 16, 1.3                                                                                                                                                                                                       | truncate:2                                                                                                                                 |
| `readingBody` (**new**, cooking surfaces only)                                  | new                        | Inter 400, 18, 1.6. Measure `max-width: 62ch`.                                                                                                                                                                           | wrap. For steps and descriptions on recipe detail.                                                                                         |
| `figure` (**new**)                                                              | new                        | Inter 600 with `font-variant-numeric: tabular-nums lining-nums`. The context sets the size.                                                                                                                              | never wraps. **Every amount, time, count, calorie and serving number in the app.** Native: `fontVariant: ['tabular-nums', 'lining-nums']`. |
| `body`, `meta`, `label`, `caption`, `overline`                                  | no change                  | as the first spec                                                                                                                                                                                                        | as the first spec                                                                                                                          |

The reasons:

- **Playfair sets names, so it never sets a number.** Playfair's old-style figures sit on the x-height.
  On the detail stats card, "300 min" and "330 min" are hard to read at a glance.
- **One large title per screen, and it is visible.** The first spec hides the H1 and shows the word in the
  top bar. That keeps the title but loses the brand moment. The large-title pattern keeps both.
    - Apple's HIG: a large title "transitions to a standard title as people begin scrolling", and it
      helps people stay oriented. I took this from a search result, not from the full page.
    - Material's top app bar has the same medium and large collapsing forms.
- **Native must register Inter 400, 500, 600 and 700.** Keep the first spec's §3 note as it is. Today
  native renders all body text in Roboto or SF.

**Sizes, phone to desktop:**

- large title 28 → 40
- section 18
- card title 16
- body 16
- reading body 18
- meta 14
- caption 12

Seven sizes are in use. All but 34 and 40 come from the `fontSize` ramp in `tokens/scale.ts`. A
bounded `clamp()` reaches 34 and 40 between the existing 28 and 48 steps.

### 2.3 Shape, space and elevation

| Element                      | Radius                      | Height                                                | Notes                                                                                    |
| ---------------------------- | --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Button, every variant        | `full` (pill)               | lg 52, md 44, sm 36 visual with a 44 hit area         | lg is for the primary action in a sticky footer, and for a phone empty state.            |
| Chip                         | `full`                      | 36 visual. 44 hit area on coarse pointers and native. | none                                                                                     |
| Search field                 | `full`                      | 48                                                    | The one pill-shaped input. Search bars are pill-shaped by convention on iOS and Android. |
| Text input, select, textarea | **`md` (12)**               | 48 for one line                                       | This changes the first spec's §13.2 rule ("radius full for single-line"). See D5.        |
| Card                         | `md` (12)                   | fits its content                                      | White, a 1 px `line-divider` edge, elevation 1.                                          |
| Image in a card              | `md` (12), top corners only | 4:3                                                   | none                                                                                     |
| Sheet                        | `xl` (28), top corners      | fits its content by default                           | none                                                                                     |
| Dialog                       | `lg` (20)                   | fits its content                                      | none                                                                                     |

The elevation ladder has one meaning per level, and one light source, from above:

| Level | Meaning                                                                       | Web                                        | Android (first spec §11) |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------ |
| 0     | the canvas                                                                    | no shadow                                  | 0                        |
| 1     | a card at rest                                                                | `shadow-sm` and a 1 px `line-divider` edge | 1                        |
| 2     | a sticky bar with content scrolling under it: top bar, wizard footer, tab bar | `shadow-md`                                | 2                        |
| 3     | an overlay: menu, sheet, dialog, snackbar, FAB                                | `shadow-lg`                                | 3                        |

At the top of a page, the top bar is level 0: transparent, on the canvas. Once the large title scrolls
away, the bar turns into level 2, with a paper fill and the bar title. That is the platform convention.
It also removes the permanent 56 px glass band that every screen carries today.

### 2.4 One state matrix for every control

| State                     | Primary button                                                            | Secondary button              | Chip (filter or choice)                                                                     | Tab                                                | List row                                              |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| default                   | seafoam fill, white label                                                 | paper, pewter edge, ink label | paper, pewter edge, ink label                                                               | ink-muted label                                    | paper                                                 |
| hover (fine pointer only) | ocean-dark fill                                                           | pearl fill                    | pearl fill                                                                                  | ink label                                          | pearl fill                                            |
| pressed                   | scale to 0.98 (the existing `pressScale`), ocean-dark fill                | pearl fill                    | pearl fill                                                                                  | no change                                          | pearl fill                                            |
| selected                  | not applicable                                                            | not applicable                | **seafoam 14% fill, 1.5 px seafoam edge, ocean-dark label, a 16 px check before the label** | ink label, weight 600, a 3 px seafoam bar under it | a 3 px seafoam bar at the start edge, seafoam 6% fill |
| focus-visible             | 2 px ocean-dark ring, 2 px offset                                         | the same                      | the same                                                                                    | the same                                           | the same, drawn inside                                |
| disabled                  | 40% opacity, no hover                                                     | the same                      | the same                                                                                    | the same                                           | the same                                              |
| busy                      | a spinner replaces the leading icon. The label stays. `aria-busy` is set. | the same                      | not applicable                                                                              | not applicable                                     | not applicable                                        |

Selection never relies on colour alone. A chip has its check. A tab has its bar and its weight. A row
has its bar (SC 1.4.1).

### 2.5 Icons: one set on both platforms

Today web draws its own inline SVGs (`features/recipes/src/actions/icons.tsx`, `rating/StarShape.tsx`),
and native uses `@expo/vector-icons`. So one action can have two different glyphs on two platforms.

**I recommend Lucide on both platforms**: `lucide-react` and `lucide-react-native`. Lucide uses the ISC
licence. The native package needs `react-native-svg` version 12 to 15 (read today). This follows the
library-first rule in CLAUDE.md. The rules for icons:

- A 24 px grid and a 1.75 px stroke at 24 px, so the weight matches Inter 400–500.
- 20 px glyphs inline with 14–16 px text, aligned to the cap height.
- Outline glyphs by default. A filled glyph appears **only** on the active tab, together with the label
  weight change. So it is never the only cue.
- Icon-only controls use only the universal set: back, close, search, more (⋯), add (+), checkbox.
  Every other control has a visible label.

### 2.6 Images

- **Cover crop.** 4:3 on cards and in the phone hero. 3:2 beside the title at `@wide`. The default is
  `object-position: center`. Every image declares its aspect ratio, so nothing shifts on load.
- **No-photo cover: a new primitive, `RecipeCover`, for web and native.** Today a missing photo is a grey
  box with a broken-image glyph. It says "something failed". On a phone it is about 190 px of nothing.
  The new **monogram cover** has four parts:
    - a seafoam 10% fill
    - the first letter of the title, in Playfair 700, ocean-dark, at 40% of the cover height
    - the cuisine word under it, in `overline`
    - the same 4:3 box, so the grid stays aligned

    The art is decorative (`aria-hidden`). The card's accessible name carries the title. One component
    turns a defect into a branded placeholder.

- **Text on a photo** always sits on a **solid** chip or button. This covers the time chip, the PRO
  badge, the status chip, and the hero's back and ⋯ buttons. The chip is white at 92% with ink text,
  which gives 10.6:1 even over pure black. Never put bare text on a photo. Some user photo will always
  break a scrim that "works on this image".
- **Illustration** for empty states and the 404. One line style: a 1.75 px stroke to match the icons,
  seafoam and ink, one coral accent, 96 px. Four drawings only:
    - an empty recipe box (no recipes)
    - stacked cards (no collections)
    - an empty plate (404)
    - a magnifier over a bowl (no results)

### 2.7 Motion

Web uses the durations in `specShellAndLists.md` §M. Native gets **springs, not durations**, because
Reanimated is spring-first (`interaction-motion.md`).

| Moment                             | Web                                           | Native (Reanimated `withSpring`)                                                                 | Reduced motion                   |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| Sheet in and out                   | 250 ms ease-out in, 200 ms ease-in out        | stiffness 400, damping 40, mass 1. Damping ratio 1.0, so no overshoot.                           | a 150 ms fade                    |
| Large title to bar title           | linked to scroll position, with no timer      | the same, linked to scroll                                                                       | an instant swap at the threshold |
| Row editor opens (step 2)          | 150 ms height and opacity                     | stiffness 500, damping 45 (ratio about 1.0)                                                      | instant                          |
| Check toggles (ingredient, picker) | 120 ms scale from 0.9 to 1 on the check glyph | stiffness 600, damping 28 (ratio about 0.57). A small overshoot. This is the one playful moment. | instant, no scale                |
| Undo snackbar                      | as `specShellAndLists.md` §M                  | stiffness 400, damping 40                                                                        | a fade                           |

Damping ratio = damping ÷ (2 × √(stiffness × mass)). These numbers are my design choices, not a cited
standard. Nothing else animates.

---

## §3. Navigation and information architecture

### 3.1 Four destinations, the same on both platforms

| Destination  | What it holds                                                                  | URL                        | Phone and tablet                | Desktop (`expanded`)               |
| ------------ | ------------------------------------------------------------------------------ | -------------------------- | ------------------------------- | ---------------------------------- |
| **Home**     | greeting, your recent recipes, first-run start, the "Coming soon" placeholders | `/{locale}`                | tab 1                           | sidebar item 1                     |
| **Recipes**  | two tabs: **My recipes** and **Collections**                                   | `/recipes`, `/collections` | tab 2                           | sidebar item 2                     |
| **Discover** | everyone's public recipes: search, filters, browse rows                        | `/discover`                | tab 3                           | sidebar item 3                     |
| **Profile**  | profile, preferences, session, danger zone, data sources                       | `/profile`                 | tab 4. Its icon is your avatar. | the avatar row at the sidebar foot |

- **Pushed screens** sit under their destination and keep their routes: recipe detail, version history,
  the editor, paste, collection detail, new collection, add recipes, legal sources.
- **Removed routes:** `/settings` and `/account` merge into `/profile` (Q4). Nothing is live, so they are
  deleted, not redirected (memory `noTemporaryWorkarounds`).
- **Unbuilt features** (Meal plan, Grocery, Nutrition) appear in **no** navigation. Their one place is
  Home's "Coming soon" section, which FR-046 already requires (Q3, D11).

### 3.2 Why Discover leaves Recipes (D1)

Today Recipes holds two sibling tabs, "My Recipes" and "Community", and the same place has four names
(the first audit's E32). The first audit fixes the names and adds Collections as a third tab. I think
that keeps the real fault: **two different scopes share one tab strip.**

- My recipes and Collections are **your** things. You go there to _find_ something you already know.
  The search is recall by name, and the list is title-led.
- Discover is **everyone's** things. You go there to _browse_ something new. The search is
  exploration, and the grid is image-led.
- A search field must show its scope (`information-architecture.md`: people often search a section and
  believe the search is global). With one scope per destination, the place itself is the scope label:
  in Recipes you search your recipes, and in Discover you search everyone's.
- The tab bar holds four destinations. That is under the five a tab bar can carry
  (`information-architecture.md`). At 320 each tab is 80 px wide. The longest label, "Discover",
  is about 52 px at 12 px Inter. Even a translation 35% longer fits on one line.

**Cost:** one more tab-bar item, and one more line in the sidebar's navigation model (`resolveHomeNav`).
No URL changes. **Flip condition:** a closed card sort (15 or more participants) in which most people
put "public recipes" and "my recipes" in the same group.

### 3.3 Global chrome by width

**Phone and tablet, web below `expanded`, and native at every size:**

```
top of page                                  after scrolling
┌───────────────────────────────────┐        ┌───────────────────────────────────┐
│                                [⋯]│ 44     │ Recipes                        [⋯]│ 56, paper, level 2
│ Recipes                           │ large  ├───────────────────────────────────┤
│ My recipes   Collections          │ title  │ ...content...                     │
│ ...content...                     │ 28 px  │                                   │
├───────────────────────────────────┤        ├───────────────────────────────────┤
│  ⌂ Home  ▤ Recipes  ◎ Discover  (E) Profile │ 64 + safe area                   │
└───────────────────────────────────┘        └───────────────────────────────────┘
```

- **Large-title header** (new primitive `LargeTitleHeader`, §4.0). One title per screen. It collapses
  into the 56 px bar as you scroll.
- **The top bar holds at most one action**, at the end edge: the page's ⋯ menu, or nothing.
    - The notification bell goes (Q8).
    - The search icon goes. Search lives in the page that it searches (§3.5).
    - The avatar goes, because Profile is a tab.
    - The hamburger menu goes. The drawer has nothing in it that the tab bar does not show (D2).
- **Tab bar:** four items. Each item has a 24 px icon over a 12/500 label, and is at least 80 × 56 px.
    - Active: ink icon (filled glyph), ink label at weight 600, and a 32 × 3 px seafoam bar above the
      icon.
    - Inactive: ink-muted outline glyph.
    - Profile's icon is your 24 px avatar disc: the initials, or a person glyph.
    - Labels never wrap and never truncate.
- **Native:** the tab bar renders from `AppRoot`, on every top-level screen and on recipe and collection
  detail. It hides only for focused tasks: the editor, paste, the add-recipes picker and the cook view.
  This fixes the first audit's M1 (no way back from Recipes on iOS).
    - This differs from the first audit, which hides the bar on detail screens too.
    - My reason is heuristic judgement. Keeping the bar on read-only detail screens leaves the other
      destinations one tap away. Hiding it only on tasks with unsaved input follows the "focused task"
      split the shell already has.

**Desktop: web at `expanded`, 1024 px and wider**.

```
┌ sidebar 256 ─────┬ main (container) ─────────────────────────────────────────────┐
│ [C] Commise      │  Recipes                                   [+ New collection] │ large title 40
│                  │  My recipes   Collections                                      │
│ ⌂ Home           │  ( 🔍 Search your recipes                                 )   │
│ ▤ Recipes   ▌    │  ...                                                          │
│ ◎ Discover       │                                                               │
│                  │                                                               │
│ ──────────────── │                                                               │
│ (E) Eliza Moreno │                                                               │
│ « Collapse       │                                                               │
└──────────────────┴───────────────────────────────────────────────────────────────┘
```

- **No top bar at `expanded`.** The page's large title and its actions sit at the top of `<main>`, on the
  same left edge as the content. That saves 64 px of height, and it ends the second title.
- **Sidebar:** sticky at full height (keep the first spec's §S.1). Three destinations. Then a divider.
  Then the **profile row** (32 px avatar, display name, truncate:1) linking to `/profile`. Then the
  collapse control.
    - Active item: seafoam 10% fill, ink label at 600, and a 3 px seafoam bar on the start edge.
    - Collapsed: 80 px wide, icons only. Each icon keeps its accessible name, and on a fine pointer a
      tooltip names it.
- **Keyboard:** `/` focuses the page's search field, on the pages that have one. Nielsen #7: a shortcut
  that speeds up experts and does not get in a novice's way.
    - `/` is a single printable character, so WCAG 2.2 SC 2.1.4 (Level A) applies. It needs a way to
      turn it off, a way to remap it, or to work only while its component has focus (W3C Understanding
      document, read today).
    - So Profile › Preferences gets a **Keyboard shortcuts** switch, on by default. With it off, `/`
      types a slash like any other key.

**I recommend (not binding) a navigation rail on a sideways tablet.** The owner directive gives tablet
a bottom tab bar. This proposal designs it that way. Two facts argue for a rail:

- Material's adaptive guidance uses a navigation bar for compact windows and a navigation rail for
  medium and expanded windows (Android Developers, "Build adaptive navigation", read today).
- On a tablet held in two hands, the thumbs reach the lower **side** edges, not the bottom centre
  (`device-ergonomics.md`).

The cost is one more primitive (`NavRail`, web and native), about 2–3 days. **Flip condition:** the owner
keeps the directive. Then the tab bar stays, as designed here.

### 3.4 Hierarchy, back and dismissal

| Level                       | Examples                                         | Back on phone (web and native)                                                         | Back on desktop                          | Android system Back                                                      |
| --------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| 1, destination              | Home, Recipes, Discover, Profile                 | none                                                                                   | none                                     | from Recipes, Discover or Profile: go to Home. From Home: leave the app. |
| 2, tab inside a destination | My recipes, Collections                          | none. Tabs are routes, so browser Back works.                                          | none                                     | as level 1                                                               |
| 3, pushed screen            | recipe detail, collection detail                 | a 44 px "‹" at the start of the header. Its name names the parent ("Back to Recipes"). | a "‹ Recipes" link above the large title | the previous screen                                                      |
| 4, focused task             | editor, paste, picker, new collection, cook view | "‹" or "×" in the task's own header. The guard asks before it discards input.          | the same                                 | runs the discard guard (`@commise/ui/back-intercept`)                    |

- **iOS edge swipe** _(source)_: the native stack is hand-rolled (`AppRoot.tsx` holds a `useState`
  destination union). So the system back swipe is not there by default. Flag this to
  `staff-architect`. It is a platform convention people rely on, not a nicety.

### 3.5 Search: one field per scope, always in the page

| Where                 | Field label (visible or visually hidden) | Searches                                | Notes                                                                      |
| --------------------- | ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Recipes › My recipes  | "Search your recipes"                    | your recipes (title, ingredients, tags) | Filters the list live. Sticky under the header on phones while you scroll. |
| Recipes › Collections | "Search your collections"                | collection names                        | shown once you have 6 or more collections                                  |
| Discover              | "Search recipes"                         | the public catalogue                    | plus Filters and Sort                                                      |
| Add-recipes picker    | "Search your recipes"                    | your recipes                            | inside the sheet                                                           |

There is no global search box. Desktop has the `/` shortcut. Home has none, because Home's job is to
put your recent recipes one tap away.

### 3.6 Creating things

- **New recipe:** the FAB, on **Home and My recipes**, phone and desktop (the only create path, per the
  owner ruling). It opens the create menu (§4.4).
    - The first-run empty states show their own two start buttons. The wireframe rule says an empty
      state carries its own create button, and the FAB hides while that block shows.
- **New collection:** a header button on the Collections tab: "New collection". Collections are not
  recipes, so they never use the FAB. A second FAB with a different meaning on the next tab breaks
  Nielsen #4.
- **Save a copy** of someone's recipe: the primary button on its detail page, and an icon button on
  Discover cards (§4.5).

### 3.7 The flows, end to end

Each flow lists its screens and the taps on the shortest path, from the destination where it starts.

| #   | Flow                          | Path                                                                                                                      | Taps today                            | Taps here                                     |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| F1  | First run                     | sign up → Home (first-run block) → Paste ingredients → review → recipe step 1 → publish                                   | no path from paste into a recipe (F6) | 5 to a published recipe                       |
| F2  | Cook one of your recipes      | Recipes → tap the card → detail. Ingredients and Steps on one screen, with the sticky switch                              | 2                                     | 2                                             |
| F3  | Find a new recipe and keep it | Discover → search or browse → detail → **Save a copy** → lands in My recipes, with a snackbar offer "Add to a collection" | 3 + a hunt for Clone at the page foot | 3                                             |
| F4  | Write a recipe                | FAB → Write a recipe → Details → Ingredients (one-line entry) → Steps → Photos & publish                                  | Prev, Save and Next on every step     | Next on every step. Saving happens by itself. |
| F5  | Group recipes                 | Recipes › Collections → New collection → name → **Add recipes** opens the picker sheet → tap rows → Done                  | web has no way in (E4)                | 4 + one tap per recipe                        |
| F6  | Edit a recipe                 | detail → Edit → the editor opens on the step you came from (an ingredient tap opens step 2)                               | always step 1                         | 2                                             |
| F7  | Manage your account           | Profile tab → one page, every section                                                                                     | three pages                           | 1                                             |
| F8  | Recover from a wrong turn     | an unknown URL → branded 404 inside the shell → Home or Discover                                                          | dead end (E2)                         | 1                                             |

F6's "open the editor on the step you came from" is new. Today Edit always opens step 1. An "Edit" item
on the Ingredients section header and on the Steps section header (own recipes only) takes you straight
to that step. That is recognition over recall (Nielsen #6): the cook was looking at the thing to change.

### 3.8 Glossary: one word per idea

Nothing is live, so each of these terms is cheap to settle now. Each one becomes a one-way door as soon as
real users learn it.

| Use                            | Not                                           | Why                                                                           |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Recipes, My recipes            | Library, My Recipes (title case)              | It matches the URL and the mockup. Sentence case everywhere.                  |
| Collections                    | Lists, cookbooks, folders                     | It is already the word on mobile, in the spec and in the URL.                 |
| Discover                       | Community, Discover recipes                   | One name for the place (E32).                                                 |
| Save a copy                    | Clone                                         | Nielsen #2: plain words (O5).                                                 |
| Steps                          | Instructions, Method                          | Shorter, so the wizard rail fits. Plainer. It is the label a cook says aloud. |
| Draft, Public, Private         | Unpublished, Shared                           | These words already ship in the badges.                                       |
| Choose a match, No match found | Needs a pick, Not resolved, Resolution failed | Plain words in place of system terms (first spec §S4.8, kept).                |

---

## §4. Screens and flows

Widths in this section are **container widths of `<main>`** (§2), unless they say "viewport". The five
capture widths map like this:

| Viewport                    | Shell                     | `<main>` content width   | Container class                        |
| --------------------------- | ------------------------- | ------------------------ | -------------------------------------- |
| 320                         | tab bar                   | 288 (16 px gutters)      | `@narrow`                              |
| 390                         | tab bar                   | 358                      | `@narrow`                              |
| 768                         | tab bar                   | 720 (24 px gutters)      | `@regular`                             |
| 1280                        | sidebar 256               | 960 (32 px gutters)      | `@wide`                                |
| 1920                        | sidebar 256               | 1600, capped at **1440** | `@wide`, plus the "≥ 1280" rules below |
| native phone (390–430 dp)   | tab bar                   | 358–398                  | `@narrow`                              |
| native tablet (744–1024 dp) | tab bar (owner directive) | 696–976                  | `@regular` or `@wide`                  |

**One new content cap: `content-wide` becomes 1440 px** (the first spec says 1280). At 1920 the first
spec's 1280 leaves a 320 px empty band on the right of every grid. At 1440, a five-column grid fills
the space. The reading rules (62ch for step text, 640 for forms) still stop lines from getting too long.

### 4.0 Shared screen parts (all new or changed; each lives in `@commise/ui` or `features/recipes/src/card`)

**`LargeTitleHeader`** (new, web and native). It replaces `PageHeader` with `titleVisibility: 'chrome'`.

```ts
interface LargeTitleHeaderProps {
    readonly title: string; // the H1, plain text
    readonly subtitle?: string; // one line under it, `meta`, ink-muted (the date on Home)
    readonly back?: { label: string; onPress: () => void }; // level 3 and 4 screens
    readonly action?: ReactNode; // at most ONE trailing control (⋯ menu or one Button)
    readonly tabs?: ReactNode; // a `Tabs` strip that sits under the title and stays sticky
    readonly headingRef?: Ref<HTMLHeadingElement>; // the existing route-change focus target
}
```

- **Phone and tablet.** A 44 px top row holds `back` and `action`. The H1 (`largeTitle`) sits under it.
  Once the H1 scrolls under the top row, the row turns into the 56 px level-2 bar, which shows `title` as
  `barTitle`, truncate:1. `tabs` stick under the bar.
- **Desktop (`expanded`).** No bar. The H1 sits at the top of `<main>`. `action` sits on the same row, at
  the end edge, aligned to the title's first baseline. `back` becomes a "‹ Parent" link above the H1.
  The H1 block is `flex: 1 1 18rem; min-width: 0`, and the action is `flex: 0 0 auto`. With too little room, the row moves
  the action **as a group** below the title.
- **Scroll behaviour on web:** the bar fill and the bar title follow an `IntersectionObserver` on the H1.
  No scroll listeners. Native: `onScroll` with `scrollEventThrottle={16}` on the screen's scroll view,
  and a threshold at the H1's measured `onLayout` height.
- **Accessibility:** the H1 is the only heading level 1. The bar title is `aria-hidden`, because it
  repeats the H1. The tabs keep the first spec's `Tabs` semantics.

**`RecipeCard`** (changed, in `features/recipes/src/card`). Three variants, picked by the space the card
gets, never by device:

```
GRID (column ≥ 200 px)                         ROW (lists; the default for your library on phones)
┌──────────────────────────────┐               ┌──────┬───────────────────────────────────┐
│ [✎ Draft]             [PRO] │ cover 4:3     │ thumb│ Slow-Roasted Lamb Shoulder with   │ title, 2 lines
│                              │               │ 72 × │ Preserved Lemon, Chickpeas…       │
│ [⏱ 5 h 30]                   │ time chip     │ 72   │ 5 h 30 min · Serves 8 · 612 cal   │ figures
├──────────────────────────────┤               │      │ ●●○ Medium · ★ 4.8 (12) · 🔒 Private │ status
│ Slow-Roasted Lamb Shoulder   │ title 2 lines └──────┴───────────────────────────────────┘
│ with Preserved Lemon, Chi…   │                       min-height 96, padding 12
│ ●●○ Medium · ★ 4.8 (12)      │ meta
│ Moroccan · 612 cal · Serves 8│ facts
│ gluten-free · slow-cooked +3 │ tags, caption
│ v12 · Edited 2 d ago         │ footer (own)  |  (E) @braise.club   [⊕]  footer (Discover)
└──────────────────────────────┘
RAIL = GRID at a fixed 256 px width, with the Discover footer.
```

- **Grid rows**, aligned across a grid row with CSS `subgrid` (keep the first spec's §12 mechanism):
    1. Cover, 4:3 (`RecipeCover`, §2.6), with solid overlay chips. **Top start:** status, for your own
       recipes only ("✎ Draft" or "🔒 Private"). **Top end:** PRO. **Bottom start:** total time, "⏱ 5 h 30".
    2. Title, `cardTitle`, truncate:2. The full title is in the link's accessible name.
    3. Meta: difficulty pill (tint and meter) · rating, "★ 4.8 (12)" with honey stars. With no
       ratings: "No ratings yet" in ink-muted.
    4. Facts: cuisine · calories ("612 cal", or "~612 cal" for an estimate) · "Serves 8". One line. Items
       drop from the end rather than wrap.
    5. Tags as text, not chips: "gluten-free · slow-cooked · +3". `caption`, ink-muted, truncate:1.
    6. Footer. Own recipe: "v12 · Edited 2 d ago". Discover: a 20 px avatar, "@handle" (truncate:1), and at
       the end a 44 px **Save a copy** icon button (bookmark-plus glyph, name "Save a copy of {title}").
- **Why tags become text.** Chips stacked one per line made cards 270 to 520 px tall (first audit E6).
  A tag on a card is information, not a control, so text is the right form. Chips stay where a tag is a
  filter you can press.
- **Row variant.** CR-002's tags and version are **deferred to the detail page** in this variant (Q9).
  The grid view shows every CR-002 field.
- **Loading skeleton:** the same rows and sizes. Shapes in pearl, no pulse after 1 s (a still shape
  reads as "waiting", a pulsing one for 10 s reads as "broken").

**`GlanceLine`** (new, `features/recipes/src/detail`). One line of icon-and-figure groups: "⏱ 5 h 30 min ·
👥 Serves 8 · ●●○ Medium · ★ 4.8 (12)". Each group is an inline-flex unit that never breaks inside. The
line wraps between groups only (that is re-layout, not text wrapping). A missing value drops its group
and its separator. Times use `formatDuration` (first spec §13.2), so "16200s" and "330 min" never appear.

**`SectionSwitch`** (new, web and native). A sticky two- or three-part segmented bar on recipe detail:
"Ingredients · Steps · Nutrition". Pressing a part scrolls to its section. The active part follows the
scroll position. It sticks under the bar on phones and tablets, and does not render at `@wide`, where
ingredients and steps sit side by side. Semantics: a `nav` named "Recipe sections" with three links
(`aria-current="location"` on the active one). The active part uses the tab selected style (§2.4).

### 4.1 Sign in and sign up

FR-045a holds: sign-in **is** the front door, and nothing stands in front of it.

```
phone 390                         tablet 768                        desktop 1280 / 1920
┌──────────────────────────┐      ┌─────────────────────────┐       ┌──────────────────┬───────────────────┐
│  [mark] Commise          │      │   (canvas wash)         │       │                  │  [mark] Commise   │
│  Sign in                 │      │  ┌───── 440 card ─────┐ │       │  food photograph │  Sign in          │
│  Cook with confidence.   │      │  │ [mark] Commise      │ │       │  (decorative,    │  Cook with        │
│  Plan with ease.         │      │  │ Sign in             │ │       │   object-cover)  │  confidence…      │
│ [G  Continue with Google]│      │  │ …same form…         │ │       │                  │  [G Continue…]    │
│ ───────── or ─────────── │      │  └─────────────────────┘ │       │  "Cook with      │  ── or ──         │
│ Email                    │      │                         │       │   confidence."   │  Email            │
│ [                      ] │      │                         │       │                  │  [ … ] 400 max    │
│ [       Continue       ] │      │                         │       │                  │  [ Continue ]     │
│ New to Commise? Sign up  │      │                         │       │                  │  New? Sign up     │
└──────────────────────────┘      └─────────────────────────┘       └──────────────────┴───────────────────┘
```

- **Phone (below 480 viewport):** no card. The form sits full-bleed on the canvas with 24 px side padding,
  which gives a 342 px column at 390 and 272 at 320. This removes the clipped "Continue with Go…" and
  the cut placeholders (first audit E23). The mechanism is the first spec's §A change to
  `clerkAppearance` (`ui/src/clerk.ts`): responsive card padding, through Clerk's `appearance.elements`.
- **Tablet:** a 440 px white card centred on the canvas wash. A centred card suits a short terminal
  moment (`visual-systems.md`).
- **Desktop (1024 and up):** a 50/50 split. The left half is a food photograph (one of the archive images
  in `docs/mockups/_assets/`, `aria-hidden`, `object-fit: cover`) with the brand line set on a solid
  white panel at its foot. The right half holds the form, at a 400 px max width, centred in its half.
    - This is **not** a welcome screen. It is the sign-in surface itself, so FR-045a holds. It answers the
      accepted gap that a signed-out visitor never learns what the product is (FR-045a notes).
- **Inside the form:** Clerk's elements take the system styles. Inputs are 48 px with 12 px corners. The
  primary button is seafoam, 52 px, full width. "Continue with Google" is a secondary button. The title is
  "Sign in" in `largeTitle`, and the brand line "Cook with confidence. Plan with ease." sits under it in
  `body`, ink-muted (Q7).
- **Footer link:** "New to Commise? Sign up". It is a sentence, so a wrap between its words is allowed. The link
  text "Sign up" never breaks. This link is the only way to sign up, so it must stay (CLAUDE.md, FR-045a).
- **Sign up asks for email and password only, plus Google** (Q6). There is no username and no
  first or last name. The app's handle is `profiles.displayName`, so it asks for a name later, in
  context (§4.2).
- **Native** (`login.tsx`, `signup.tsx`): the same order and copy, on `@commise/ui/input`. The primary
  button pins above the keyboard (`KeyboardAvoider`). Email uses `textContentType="username"` and
  `autoComplete="email"`. Password uses `"password"` on sign-in and `"newPassword"` on sign-up, so
  password managers work (SC 3.3.8).
- **States:** wrong password (Clerk's inline error under the field, focus moves there) · network error
  (an alert above the button with this copy:
  `We couldn't reach the sign-in service. Check your connection and try again.`) · busy (the button's spinner, the form locked) · the verification-code step (one 6-digit field
  with `autocomplete="one-time-code"`, not six boxes).

### 4.2 First run

The paradox of the active user says people start at once and do not read instructions
(`human-factors.md`). So first run is a **working empty state**, not a tour. Show value before asking for
commitment (`interface-patterns.md`).

1. **Sign-up lands on Home** in its first-run form:
    - **The `What should we call you?` card**, at the top. It shows only while `displayName` is empty: one
      text field, prefilled from the Google given name where Clerk has it, a **Save** button, and **Not
      now**. On Save, the greeting updates in place. It never blocks anything.
    - **The start block** replaces "Recent recipes". Heading: "Add your first recipe". Two large tiles:
        - **Paste ingredients**: "Paste a list and we sort it out."
        - **Write a recipe**: "Start from a blank page."
          Under them, a text link: "Or find one on Discover →".
    - The "Coming soon" section stays below (§4.3).
2. **Paste ingredients** is the fastest start, so it sits first and gets the primary style. Paste,
   review, then "Start a recipe with these" lands in the editor (§4.10).
3. **The first published recipe** ends on the recipe detail page with a snackbar: "Recipe published.
   Add it to a collection?" with an action. This is the peak-end moment: end the first task on
   success, with the next useful step (`human-factors.md`, the peak-end rule).

### 4.3 Home

```
phone 390                               desktop 1280 (main 960)
┌────────────────────────────────┐      ┌───────────────────────────────────────────────────────────┐
│ Good afternoon, Eliza           │ H1   │ Good afternoon, Eliza                                      │
│ Sunday 31 May                   │      │ Sunday 31 May                                              │
│ Recent recipes          See all │ H2   │ Recent recipes                                    See all │
│ ┌────────────┐ ┌────────────┐   │ 2×2  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   4 grid cards, one row │
│ │  cover 4:3 │ │  cover     │   │      │ └──────┘ └──────┘ └──────┘ └──────┘                        │
│ │ Lamb Shou… │ │ Pasta      │   │      │ Coming soon                                                │
│ │ ⏱ 5 h 30   │ │ ⏱ 15 min   │   │      │ ┌ Today's nutrition ┐ ┌ Resume cooking ───────────────────┐ │
│ └────────────┘ └────────────┘   │      │ └───────────────────┘ └───────────────────────────────────┘ │
│ ┌────────────┐ ┌────────────┐   │      │ ┌ This week's meals ───────────────────────────────────────┐ │
│ └────────────┘ └────────────┘   │      │ └──────────────────────────────────────────────────────────┘ │
│ Coming soon                     │ H2   │                                                       (+)  │
│ Meal plans, a grocery list and  │      └───────────────────────────────────────────────────────────┘
│ daily nutrition are on the way. │
│ ┌ Today's nutrition   Soon ┐    │ 3 placeholders, compact, static
│                           (+)   │ FAB
└ ⌂ Home ▤ Recipes ◎ Discover (E) ┘
```

- **Large title = the greeting** ("Good afternoon, Eliza"). It collapses to "Home". The date is the
  subtitle. No card and no gradient box behind it. With no display name: "Good afternoon".
- **Recent recipes** (FR-046's one live widget, up to 4 recipes).
    - Phone: a **2 × 2 grid of compact grid cards**: cover, title (2 lines), time. At 390 the four cards
      take about 456 px, so all four sit on the first screen under the greeting. This differs from the
      first spec (row cards). The reason: Home is about recognition. The cook spots a dish by its
      photo faster than by reading four titles. That is heuristic judgement, and the library keeps the
      title-led list for recall (§4.4).
    - `@regular` and up: one row of 4 grid cards.
    - "See all" sits at the end of the heading row and goes to Recipes › My recipes.
- **Coming soon** (FR-046 placeholders, in their real shapes, no fake data).
    - One H2, "Coming soon", and one line of body: "Meal plans, a grocery list and daily nutrition are
      on the way."
    - Three placeholders follow, each with a "Soon" badge next to its title. They are **static** pearl
      shapes with no pulse, so they never read as loading (first audit E27). They are compact: about
      112 px tall each on a phone.
    - `@wide`: nutrition and resume side by side (1 : 2), with the week strip full width under them. That
      is the mockup's layout. Below `@wide`: stacked.
    - The week strip never clips. Use seven equal columns, with narrow day names ("M", "T") below
      `@regular` (keep the first spec's §H.2 rule).
- **FAB** on Home (§3.6). The grid gets 88 px of bottom padding on phones so the FAB never covers a card.
- **States:**

| State                  | Shown                                                                   | Copy                                                  |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| First run (no recipes) | the start block (§4.2), with no "See all"                               | "Add your first recipe" · tile titles and hints above |
| Loading                | 4 compact skeleton cards under the real H2                              | `recentRecipes.loadingLabel` (exists)                 |
| Load error             | under the H2: `We couldn't load your recent recipes.` and **Try again** | exists                                                |
| Offline                | cached cards, plus the shell's offline strip                            | exists                                                |
| Fewer than 4 recipes   | only the cards that exist. The grid keeps its column width.             | none                                                  |

### 4.4 Recipes › My recipes

```
phone 390                                    desktop 1280 (main 960), grid view
┌──────────────────────────────────┐         ┌────────────────────────────────────────────────────────┐
│ Recipes                          │ H1      │ Recipes                                                │
│ My recipes   Collections         │ tabs    │ My recipes   Collections                               │
│ ( 🔍 Search your recipes       ) │ sticky  │ ( 🔍 Search your recipes                     )         │
│ [All] [Quick] [Moroccan] [Veg…] →│ scroll  │ [All] [Under 30 min] [British] [Dairy-free] [Gluten-free] … │
│ 12 recipes               ☰  ▦    │         │ 12 recipes                                          ☰ ▦ │
│ ┌──┐ Slow-Roasted Lamb Shoulder… │ rows    │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │
│ └──┘ 5 h 30 min · Serves 8 · …   │ 96 each │ └────┘ └────┘ └────┘ └────┘  4 columns at 960            │
│ ┌──┐ Pasta                       │         │ ┌────┐ ┌────┐ …                                 (+)     │
│ …                          (+)   │         │                                                        │
└──────────────────────────────────┘         └────────────────────────────────────────────────────────┘
```

- **Header:** large title "Recipes", tabs "My recipes · Collections". No header action on this tab. The
  FAB is the only create control (owner ruling). It is last in DOM order and reachable by keyboard, so
  a second door is not needed.
- **Search:** `SearchField`, full column width, sticky under the bar while the list scrolls (phones).
- **Facet chips:** keep the first spec's §R.1: `ChipRow overflow="scroll"` at `@narrow`, wrap to at most
  2 lines from `@regular`. Labels in sentence case ("Under 30 min", not "Quick (<30m)").
- **Result bar**, on one line, holds two things:
    - the count, "12 recipes", with the number in `figure`
    - the view switch: list ☰ or grid ▦, a two-option choice group named "List view" and "Grid view"
- **No Sort control yet.** Only Discover has sort options in the code today (`discovery/model.ts`). The
  library list is paged, so a sort done on the device sorts one page and lies about the rest. A library
  sort needs a sort parameter on the list API first. That is a question for `staff-architect`, and the
  library has no Sort until then.
- **Default view:** list at `@narrow`, grid from `@regular`. The choice persists per device.
- **Grid columns, by container width:** 2 below 600 (grid view on phones) · 3 at 600–959 · 4 at
  960–1279 · 5 at 1280 and up. Gap 16 below 600, 24 above. At 1280 viewport (main 960) each card is
  222 px. That was too narrow before only because titles were in Playfair at 18 px. In Inter 16, a
  222 px column holds about 26 characters a line (judgement from Inter's average width).
- **Scroll budget at 390 × 844:** header 88 + tabs 44 + 12 + search 48 + 12 + chips 44 + 8 + result
  bar 32 = 288. The tab bar is 64. That leaves 492 px, which holds **four full row cards and part of a
  fifth**. Today it holds none. At 320 × 568 it holds two.
- **Create menu** (FAB). On phones, web and native: a **bottom sheet** titled "New recipe". On desktop:
  an `ActionMenu` anchored above the FAB. Two 64 px items, each with a 24 px icon, a title and one hint
  line:
    - 📋 **Paste ingredients**: "Paste a list and we sort it out."
    - ✎ **Write a recipe**: "Start from a blank page."
      "Paste ingredients" (17 characters) replaces "Paste an ingredient list". Titles never wrap, and hints
      wrap to 2 lines at most.
- **States:** keep the first spec's §R.3 table, with these changes:
    - First run: the same start block as Home (§4.2). Search, chips and result bar hide.
    - Loading: 6 skeletons of the active view's variant.
    - No match: "No recipes match" and the query or filters named, with **Clear search** or **Clear
      filters**.

### 4.5 Discover

```
phone 390                                     desktop 1280 (main 960)
┌──────────────────────────────────┐          ┌──────────────┬───────────────────────────────────────────┐
│ Discover                         │ H1       │ Discover     │                                           │
│ ( 🔍 Search recipes            ) │          │ ┌ Filters ─┐ │ ( 🔍 Search recipes                     ) │
│ [⚙ Filters · 2]   Sort: Best ▾   │          │ │Clear all │ │ 12 recipes for "lamb"      Sort: Best ▾ │
│ [Gluten-free ×] [Under 30 min ×] │ applied  │ │Total time│ │ ┌────┐ ┌────┐ ┌────┐                    │
│ Trending this week      See all  │ H2       │ │(•) Any   │ │ └────┘ └────┘ └────┘  3 columns         │
│ ┌──────────┐ ┌──────────┐ ┌─     │ rail     │ │Dietary … │ │                                           │
│ │cover     │ │          │ │      │ 256 cards│ └──────────┘ │                                           │
│ │title     │ │          │ │      │ peek     │ sticky 256   │                                           │
│ └──────────┘ └──────────┘ └─     │          │              │                                           │
│ Browse by cuisine                │ chips    │              │                                           │
│ [Moroccan] [British] [Italian] → │          │              │                                           │
└──────────────────────────────────┘          └──────────────┴───────────────────────────────────────────┘
```

- **Header:** large title "Discover". No tabs.
- **Below `@wide`:** a Filters button, then Sort (only once a search or filter is active), then the
  applied filters as removable chips, then "Clear all". Keep the first spec's §D.1 and §D.2 for this
  part, and its filter sheet content: one "Total time" single choice with "Any", "More time filters"
  behind a disclosure, then Dietary, Cuisine, Tags and Ingredients.
- **At `@wide`:** the sticky 256 px filter panel on the start side (keep the first spec's §D.1). At
  1920 the panel stays 256, and the results grid takes 5 columns inside the 1440 cap.
- **Browse view (no query, no filters):** rails "Trending this week" and "New this week", then "Browse
  by cuisine" as a scrolling chip row.
    - Rail cards are 256 px wide on every width, so the next card peeks past the edge. That peek is the
      swipe cue on touch.
    - On a fine pointer, previous and next buttons sit at the end of the rail heading (keep the first
      spec's §D.4).
    - **Fix the loading rail first** (first audit E1): the skeleton uses the same scroll container as
      the loaded rail, so the page never scrolls sideways at 320.
- **Results view:** grid cards with the Discover footer (§4.0). 2 columns on phones, which is image-led,
  because Discover is for recognition. Then 3, 4 and 5 columns by container width, the same as §4.4.
- **Save a copy from a card:** the footer icon button. On press, the copy goes to My recipes, the
  icon fills, and a snackbar says "Saved a copy to My recipes" with **View**. Pressing it again does
  nothing new. The icon stays filled and its name becomes "Saved a copy". FR-005 is satisfied, and the
  card has no extra button row (first audit E17).
- **States:** keep the first spec's §D.5 table (query-only, filter-only and both no-result states,
  offline search, an empty catalogue). One addition: the no-results block also offers the "Trending this
  week" rail under the message, so the page is never a dead end (`information-architecture.md`: zero
  results is a design surface).

### 4.6 Recipes › Collections

**Collections tab.**

- Large title "Recipes", tab "Collections" selected. The header action is **New collection**, a
  secondary button with a + icon. Its label is 14 characters, so it fits beside the title at 320. With
  too little room at `@narrow`, it moves under the tabs.
- **Collection cards:** a 2 × 2 photo mosaic in a **1:1** box (like a photo album), the name
  (`cardTitle`, truncate:2), and "12 recipes · 🔒 Private" (`meta`). Cloned collections add "From
  @clara" in `caption`. Columns: 2 below 600, then 3, 4 and 5, the same as recipe grids. An empty
  collection shows the stacked-cards drawing in its mosaic box.
- Search appears once you have 6 or more collections.
- **States:** first run ("Group recipes your way", body "Make a collection for weeknights, holidays or
  anything else.", **New collection**), loading (4 skeleton cards), load error with **Try again**.

**New collection and rename: a sheet, not a page** (this differs from the first spec's §C.2).

- Phone: a content-height bottom sheet titled "New collection". It holds **Name** (required, 80
  characters max, a counter from 60), **Description (optional)**, and **Create collection** (primary,
  full width, pinned above the keyboard).
- Desktop: the same content in a 480 px dialog.
- **Why:** a two-field task does not earn a page, and a sheet keeps you where you started. Platform
  convention on both iOS and Android is a sheet for a short creation task (judgement).
- After Create, the app opens the new collection's detail page. Its empty state offers **Add recipes**.
- Rename uses the same sheet: title "Rename collection", button "Save name".
- Errors: keep the first spec's §C.2 copy and behaviour.

**Collection detail.**

```
phone 390                                   desktop 1280
┌──────────────────────────────────┐        ┌──────────────────────────────────────────────────────┐
│ ‹                             [⋯]│        │ ‹ Collections                                         │
│ Weeknight Dinners the Whole      │ H1     │ Weeknight Dinners the Whole Family Will Actually Eat   │
│ Family Will Actually Eat         │ wrap 3 │ 🔒 Private · 6 recipes · From @clara      [+ Add recipes] [⋯] │
│ 🔒 Private · 6 recipes           │        │ Thirty-to-forty-minute dinners for school nights…     │
│ Thirty-to-forty-minute dinners…  │        │ 6 recipes                                    ☰  ▦      │
│ [ + Add recipes            ] [⋯] │        │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                            │
│ ┌──┐ Slow-Roasted Lamb…       ⋯  │ rows   │ └────┘ └────┘ └────┘ └────┘                            │
└──────────────────────────────────┘        └──────────────────────────────────────────────────────┘
```

- **The name is the large title**, wrap:3, and it never shares a row with buttons at `@narrow`. This
  fixes the 3-letter column (first audit E3) by layout, not by a wrap rule.
- **Actions, the same at every width (D9).** One primary, **Add recipes**. One ⋯ menu with Rename, Make
  private or Make public, Clone collection, Pull updates (cloned only), a divider, then Delete
  collection. Phone: the action row sits under the description. Desktop: at the end of the meta row.
- **Visibility changes from the menu, at once, with undo:** "Collection is now private. Undo" (keep the
  first spec's `UndoSnackbar`). For a free-tier user, "Make private" opens the upsell sheet: "Private
  collections are part of Premium." with **See Premium** and **Not now**. This passes the DSA Art. 25
  test: the sheet tells the truth, nothing is pre-selected, and "Not now" carries the same weight.
- **Members** use the same list or grid as My recipes, with the same view switch. Each member has a ⋯
  menu: Open recipe, Remove from collection. Remove is optimistic, with undo, and has no dialog (keep
  the first spec's §C.3).
- **Delete collection** keeps a dialog, because it cannot be undone: "Delete Weeknight Dinners? The 6
  recipes stay in your library." with **Delete collection** (danger fill) and **Keep collection**.

**Add recipes picker: a sheet with toggle rows (D10).**

```
┌──────────────────────────────────┐
│ ×   Add to Weeknight Dinners…    │ 56, truncate:1
│ ( 🔍 Search your recipes       ) │
│ ┌──┐ Slow-Roasted Lamb…       (✓)│ row 64, whole row toggles
│ ┌──┐ Pasta                    ( )│
│ ┌──┐ Wild Mushroom Risotto…   ( )│
├──────────────────────────────────┤
│ [         Done · 2 added       ] │ pinned, 52
└──────────────────────────────────┘
```

- Phone: a full-height sheet. Desktop: a 640 px dialog, 80% of the window tall.
- **Each row is one control:** `role="checkbox"` with `aria-checked`, named with the recipe title. Tap
  anywhere on the row to add or remove. The trailing 28 px circle shows the state. Off: a pewter outline.
  On: a seafoam fill with a white check. Each toggle saves at once (optimistic) and announces
  "Added Pasta" or "Removed Pasta".
- Rows: a 48 px thumbnail, the title (truncate:2), one meta line.
- **Done** returns to the detail page. The count in its label ("Done · 2 added") is the summary of what
  happened (Nielsen #1).
- States: no recipes at all ("You have no recipes yet." and **Write a recipe**) · no matches (**Clear
  search**) · loading (6 skeleton rows) · a failed toggle (the row flips back, and an inline alert says
  `Couldn't add Pasta. Try again.`).

### 4.7 Recipe detail: reading and cooking

The job: decide whether to cook it, then cook from it at arm's length. So the page has two halves.

- The **top** answers "can I make this tonight?"
- The **body** keeps the amounts in reach while you work.

```
phone 390                              tablet 768 (main 720)                 desktop 1280 (main 960)
┌──────────────────────────────┐       ┌───────────────────────────────┐    ┌─────────────────────────┬──────────────────┐
│(‹)                       (⋯) │ hero  │ ‹ Recipes                 (⋯) │    │ ‹ Recipes               │                  │
│        cover 4:3             │ full  │ ┌ cover 16:9, radius 12 ────┐ │    │ ┌ cover 3:2 ─────────┐  │ (E) @braise.club │
│        full-bleed     1/3 ●○○│ bleed │ └───────────────────────────┘ │    │ │                    │  │ Slow-Roasted     │
├──────────────────────────────┤       │ (E) @braise.club · Moroccan   │    │ │   7/12             │  │ Lamb Shoulder…   │ 5/12
│ (E) @braise.club · Moroccan  │       │ Slow-Roasted Lamb Shoulder…   │    │ └────────────────────┘  │ ⏱ 5 h 30 · 👥 8…│
│ Slow-Roasted Lamb Shoulder   │ H1    │ ⏱ 5 h 30 · 👥 8 · ●●○ · ★ 4.8 │    │                         │ description…     │
│ with Preserved Lemon…        │       │ [Save a copy]  [⋯]            │    │                         │ [Save a copy][⋯] │
│ ⏱ 5 h 30 min · 👥 Serves 8 · │ glance│ ┌ Ingredients ─┐┌ Steps ────┐ │    ├─────────────┬───────────┴──────┬───────────┤
│ ●●○ Medium · ★ 4.8 (12)      │       │ │ sticky 280   ││ 18 px      │ │    │ Ingredients │ Steps            │ Nutrition │
│ [      Save a copy      ] [⋯]│ 52    │ └──────────────┘└────────────┘ │    │ for 8 [−][+]│ ① The night …    │ per serv. │
│ Description, 4 lines…  More  │       └───────────────────────────────┘    │ sticky      │ 62ch             │ Rating    │
│ [gluten-free][slow-cooked] → │                                            │             │                  │ Source    │
│ ┃Ingredients┃ Steps  Nutrition│ sticky switch                             └─────────────┴──────────────────┴───────────┘
│ Ingredients for 8   [−] 8 [+]│                                            1920 (1440 cap): the same 3 columns,
│ ☐ 2–2.5 kg Lamb shoulder,…   │                                            ingredients 360 · steps 62ch · facts 300
└──────────────────────────────┘
```

**Top half (every width).**

- **Hero:** the photo carousel _is_ the hero, so the cover appears once (first audit F2).
    - Phone: full-bleed 4:3, height capped at 40% of the window (`mediaBox.ts`, kept).
    - Tablet: 16:9 inside the gutters, 12 px corners.
    - `@wide`: 3:2 in the start 7/12 of a two-column top, with the title block beside it. At 1280 the
      title, the glance line and the main action sit in the first screen. Today the hero fills the
      first screen and the title starts below it.
    - **Back and ⋯ sit on the photo** as 44 px round white buttons (§2.6). On scroll, the top bar
      fills in with the bar title.
    - With no photo: the monogram cover at a compact 96 px band on phones (the existing
      `heroPlaceholder` height).
- **Byline:** someone else's recipe shows a 24 px avatar, "@handle" and the cuisine. Your own recipe shows
  the cuisine and the status ("🔒 Private", "✎ Draft", or "🌐 Public").
- **Title:** `largeTitle`, wrap:3. Never in a tinted card.
- **Glance line** (§4.0): total time · serves · difficulty · rating. This is the counter test.
- **Actions:**
    - Someone else's recipe: **Save a copy** (primary) and ⋯. The ⋯ holds Version history, for viewers
      the rules allow to see it.
    - Your own recipe: **Edit** (secondary) and ⋯ (Version history, Make private or Make public, a
      divider, Delete recipe).
    - Phone: the main button fills the row, and ⋯ is 44 px at its end. `@regular` and up: content width.
    - When the cook view ships (§4.8), **Start cooking** becomes the primary on every recipe, and Edit
      or Save a copy moves to secondary. Until then, no button promises it.
- **Description:** `readingBody`. On phones it is clamped to 4 lines, with a "More" text button that
  expands it in place. No clamp at `@wide`. This fixes the 13-line description at 320 (first audit D6).
- **Tags:** one `ChipRow` that scrolls (phones) or wraps to 2 lines (`@regular` and up). The tags are
  `Chip kind="tag"`. Pressing a tag is not a feature today, so the chips are not focusable.

**Body.**

- **Phone and tablet portrait:** the `SectionSwitch` (Ingredients · Steps · Nutrition) sticks under the
  bar.
- **Tablet at `@regular` (main 600–959):** two columns. Ingredients are 5/12 and sticky, steps are 7/12.
  At 720 that gives 280 and 410 px. 410 px of 18 px Inter is about 45 characters a line, which is the
  bottom of Bringhurst's 45–75 range (`visual-design.md`). The switch then holds only "Nutrition"
  as a jump, so it does not render. A "Nutrition" link sits at the foot of the steps instead.
- **`@wide` (main 960–1279):** the same two columns. Nutrition, rating, source and version info sit
  under the steps.
- **Main 1280 and up (1920 viewport):** **three columns.** Ingredients (360, sticky) · Steps
  (`readingBody`, 62ch, about 600 px) · Facts (300): nutrition, rating, source, version. Each column
  does one job: what you need, what you do, what it is. This fills the 1920 width without breaking the
  measure.
- **Ingredients section:**
    - Header row: "Ingredients for 8" with the `Stepper` at the end edge. **Serves lives here** (D6),
      because it scales these amounts (`scaleRecipeForServings` already exists in the native detail
      leaf). A note under it shows only after scaling: "Amounts scaled from 8 servings." with **Reset**.
    - Rows: a 24 px checkbox in a 44 px target, then the amount in `figure` 600, the name in ink, and the
      prep in ink-muted. Rows wrap as text (content). Groups get an `overline` heading ("FOR THE LAMB").
      A checked row dims to ink-muted with a check and no strike-through (strike-through hurts
      reading). Checks persist on the device for the session.
    - "Your own food" badge for custom foods (keep).
- **Steps section** ("Steps", glossary §3.8):
    - Each step has a 32 px numeral in a seafoam-tint circle, then `readingBody` text, then its timer
      as a text chip, "⏱ 4 h 30 min" (`formatDuration`). The chip is not pressable until the cook view
      exists.
    - Steps do not sit in a card. Space between steps is 24, and space inside a step is 8.
- **Nutrition:** four figures (calories, protein, carbs, fat) per serving, in `figure` at 24 px over
  `caption` labels. 2 × 2 on phones, 4 across in a column 560 px or wider. Then one grouped footnote in
  `caption` (keep the first spec's §S2.1 rule).
- **Rating:** someone else's recipe gets "Rate this recipe" with 44 px stars. Your own recipe shows
  the average and the count only.
- **Footer facts:** source link, "Version 12 · Edited 2 d ago" and **Version history** (a text button).

**States:** keep the first spec's §S2.2. It covers loading at the real ratio, load error, not found or
private, no photo, no steps, no ingredients, nutrition unavailable or partial, and draft. Two additions:

- A scaled view shows its note and **Reset**.
- A recipe with no steps shows "No steps yet." On your own recipe, an **Add steps** button opens the
  editor at the Steps step (flow F6).

**Delete:** keep the first spec's §S2.4 dialog: a filled danger **Delete recipe**, **Cancel**, focus starts
on Cancel, centred in the viewport.

### 4.8 Cook view (new scope; it needs an owner decision, N2)

The mockups include a cook screen (`screenCooking.html`, dark, one step at a time, a progress ring, and
Previous and Next). ReciMe's users praise its cook mode for one reason: "Cook mode keeps the screen
awake" (in-repo teardown, `docs/competitive/01RecimeTeardown.md` §6B). Nothing here needs a server.
The view only reorders data the detail page already holds. So I propose it as the next feature, not as
a button today.

```
┌──────────────────────────────┐  ink-deep #1E2427, keep-awake on
│ ×                Ingredients │  44 px controls
│ Step 3 of 7                  │  meta, mist
│ ▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░ │
│                              │
│ Sit the lamb on top, pour    │  24 / 1.5, white, 32ch
│ 250 ml of water around it,   │
│ cover tightly with foil and  │
│ roast for 4½ hours.          │
│                              │
│ [ ⏱ Start 4 h 30 min timer ] │  secondary on dark
│                              │
│ [ ‹ Back ]   [   Next  ›   ] │  56, thumb zone
└──────────────────────────────┘
```

- One step per screen. Swipe or Back and Next (both, because a gesture alone is invisible:
  `interaction-motion.md`). The last step's primary button is **Done**. It returns to the detail page
  and offers "How was it?" with stars, which ends the task on its peak (peak-end rule).
- **Ingredients** opens a bottom sheet with the scaled list and its checkboxes. The checks are shared with
  the detail page.
- **Timers** run on the device. Native schedules a local notification, so the timer survives the app in
  the background. Web shows the countdown in the tab title.
- **Keep awake:** `expo-keep-awake` on native. On web, the Screen Wake Lock API, which reached Baseline
  in 2025 (MDN, read today). Safari 16.4–18.4 does not honour it in Home Screen web apps, so the view
  works without it.
- **Accessibility:** step text is a live region only on step change ("Step 3 of 7"). Reduced motion
  turns the slide into a cross-fade. The view meets 4.5:1 on dark: white 15.71:1, mist 8.26:1,
  seafoam-light 5.65:1.
- **Cost:** front-end only, about 1.5–2 weeks for both platforms with its Playwright and Maestro tiers.
  It needs a spec line (an FR in 001 or a small feature). That is decision N2.

### 4.9 The recipe editor

#### 4.9.1 Frame (all steps)

```
phone 390                                      desktop 1280 (main 960)
┌──────────────────────────────────┐           ┌───────────────┬───────────────────────────────────────┐
│ ×  New recipe        Saved  [⋯]  │ 56        │ ‹ Recipes     │                                       │
│ Step 2 of 4 · Ingredients        │ meta      │ New recipe    │  Ingredients                    H1    │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░ │ 4 px      │ Saved         │  …step body, 720 max…                 │
│                                  │           │ ① Details   ✓ │                                       │
│ Ingredients                  H1  │           │ ② Ingredients●│                                       │
│ …step body…                      │           │ ③ Steps       │                                       │
│                                  │           │ ④ Photos &    │                                       │
├──────────────────────────────────┤           │   publish     │                                       │
│ [‹]       [     Next: Steps   ›] │ 72 pinned │ 2 ingredients │ ──────────────────────────────────────│
└──────────────────────────────────┘           │ need a match  │ [‹ Back]               [Next: Steps ›] │
                                               └───────────────┴───────────────────────────────────────┘
```

- **Header, below `expanded`:** the editor's own header replaces the app bar (keep the first spec's
  §13.6 item 1). It holds four things:
    - × to leave, behind the discard guard
    - the title, "New recipe" or "Edit recipe", truncate:1
    - the **save status**
    - ⋯, with Go to step… and Discard draft
- **Save status replaces Save draft (D7).** Drafts save by themselves:
    - after typing stops for 1 second
    - on every step change
    - as the app goes to the background
    - as the tab hides
      The status text says one of: `Saving…` · `Saved` · `Saved on this device` (offline, through the
      existing offline write port) · `Couldn't save. Retrying.` It is a polite live region. Typing does not
      trigger an announcement.
    - **Editing a published recipe** is different, because each server save makes a version. So edits
      to a published recipe autosave **on the device only**, and the last step's primary is **Save
      changes**. That one press makes one version. `staff-architect` must check this split against the
      offline write port.
- **Progress:**
    - Compact: "Step 2 of 4 · Ingredients" and a 4-segment bar (keep the first spec's §13.3).
    - `@regular`: the labelled 4-step rail on one line. With the shorter step names (Details,
      Ingredients, Steps, Photos & publish), it fits in 672 px. Each marker is a button. **Steps can be
      visited in any order.** Validation runs before publish, not between steps.
    - `@wide` (D7): a sticky **outline column**, 240 px, on the start side. It lists the four steps with
      a state each (✓ done, ● current, ⚠ needs attention). Under them it shows the live summary of what
      still needs doing: "2 ingredients need a match", "No photo yet". This replaces the rail at
      `@wide`. Each item is a link to its step or its row.
- **Footer**, pinned at every width (keep the first spec's §S1.1 sticky footer):
    - Compact: a 48 px icon-only **‹** (name "Back: Details") and **Next** filling the rest.
    - `@regular` and up: "‹ Back" at the start, "Next: Steps ›" at the end.
    - On the last step the primary is **Publish** (new or draft) or **Save changes** (published).
    - It keeps the `compactHeightLayout.md` A1 rule: the footer unpins past half the frame on short
      screens and with the keyboard open.
- **Errors:** at the field (keep the first spec's §S1.3). The footer line "Fix 1 thing to publish"
  shows only on the last step, because steps are free to visit.

#### 4.9.2 Step 1 · Details

One column, 640 max. Groups are separated by space and an H2, not by cards (one form needs no boxes).

1. **About the recipe:** Title (auto-growing, up to 3 lines, soft limit 120, O1) · Description (4 rows
   minimum, counter from 80% of the cap).
2. **Kind of dish:** Cuisine (select) · Meal type (filter chips, wrapping up to 3 lines, because in a
   form every option must stay visible) · Difficulty (Easy, Medium, Hard as toggle buttons with
   `aria-pressed`. Nothing pressed means "not stated", and pressing the pressed one clears it. This
   replaces the "Not stated" chip, which looked like a fourth difficulty).
3. **Time and servings:** Servings (`Stepper`) · Prep and Cook (`DurationField`, empty by default,
   never "0") · "Total 5 h 30 min" computed under them, hidden while both are empty.
4. **Diet and tags:** Dietary flags (chip input) · Tags (chip input, "Add a tag" with Enter or comma).

- Compact: Prep and Cook sit side by side (each about 140 px at 320). Everything else is full width.
- `@regular` and up: Cuisine and Meal type side by side. Servings, Prep and Cook in three columns.
- Native: the "Let's build your recipe" intro card goes. The step's own H1 and the visible labels make
  it unneeded, and it costs 100 px above the first field. (The first spec kept it on both platforms. I
  disagree, as a scroll-budget judgement.)

#### 4.9.3 Step 2 · Ingredients: one-line entry (D8)

This is the most-used and worst-rated surface in the app (first audit R1: one ingredient took four to
five stacked lines). The fix has three parts.

**(a) The read row** (keep the first spec's §S4.1 model: one read row per line, and one open editor at a
time). I change the row's order and its quiet state:

```
 2–2.5 kg   Lamb shoulder, bone-in · trimmed of excess fat                 ⋮
 2          Preserved lemons · rind only, finely chopped                   ⋮
 1 tin      Chickpeas                                                      ⋮
            ⚠ Choose a match
            Grandma's spice mix · as written                               ⋮
```

- **The amount comes first, in a fixed column**: 72 px at compact, 96 px from `@regular`, in `figure`.
  This matches the detail page's ingredient list. So the editor reads the way the recipe reads.
- **Name and prep:** the name in ink, then " · " and the prep in ink-muted, together clamped to 2 lines.
- **A healthy row is quiet.** A resolved row shows no status glyph. Only a row that needs you shows a
  second line in `warning-text` with a glyph: "⚠ Choose a match", "No match found" or `Couldn't look up`.
  That line is a button, and it opens the existing shortlist or panel.
    - This departs from `ingredientStatusExplanation.md` §3a ("always exactly two slots"), which the
      first spec enforced. Reason: a glyph on every healthy row is noise. Problems stand out only against
      quiet healthy rows (Von Restorff). The nutrition and food details for a resolved row move to
      ⋮ › "Food details" and into the open editor. Situation B: I recommend this, and the owner or the
      spec's author can keep §3a instead.
- **⋮ (44 px):** Edit · Food details · Change food · Move to group… · Move up · Move down · divider ·
  Remove. Keep the first spec's §S4.2 list otherwise.
- **Tap the row** to open its editor (keep the first spec's §S4.3: labelled Amount, a hidden range behind
  "+ Add a range", Unit, Preparation, Done).

**(b) One-line entry, the new part.** The trailing field accepts a whole ingredient line.

```
Add an ingredient
[ 2–3 leeks, white parts only, sliced                          ]
  Amount 2–3 · Unit none · Food leeks · Prep white parts only, sliced      ← live reading
  ┌──────────────────────────────────────────────┐
  │ Leeks, raw                       USDA        │  ← food suggestions, for "leeks" only
  │ Leeks, cooked, boiled            USDA        │
  │ Search for another food                       │
  └──────────────────────────────────────────────┘
```

- The field label is "Add an ingredient". The hint under it says: "Type it the way a recipe says it, for
  example 2 cups flour, sifted."
- As you type, the app reads the line **on the device** with the repo's existing pure reader
  (`parseIngredientLine` in `@kitchensink/recipe-import-core`, which wraps the `parse-ingredient`
  library and already knows ranges, fractions, number words and historical units). It shows the reading
  as one quiet line of labelled parts under the field. The food suggestions search only the food words.
- Pick a food (arrow keys and Enter, or tap) and the row commits with the amount, unit and prep already
  filled in. No invented "1" (first audit F5): a line with no amount gets no amount.
- Press Enter with no food picked, and the line commits **as written**, with "⚠ Choose a match" on it.
  The cook can keep typing and match the food later. Nothing blocks the flow.
- **The keyboard loop:** type the line, press Enter, and type the next line. The first spec's loop
  (pick, amount, Enter) needed a field change per line. This one needs none.
- **Feasibility check for `staff-architect`:** can the web and native bundles import
  `recipe-import-core`'s reader? It is pure, but the package can carry server-only dependencies. If it
  cannot be imported, the fallback is the same `parse-ingredient` library called from a small shared
  adapter. Library first, so no hand-rolled parser.

**(c) Paste a list, inside the step.** A "Paste a list" text button in the step header opens a sheet
with a textarea. On **Add these**, the lines go through the existing parse job and appear as rows in the
"Reading…" state, then resolve one by one. So the paste flow and the editor share one path (O4).

- **Groups:** keep the first spec's §S4.4 (group headings with their own ⋮, "Move to group…", "+ Add a
  group"). Each group ends with its own one-line entry field, labelled "Add to For the lamb".
- **Nutrition so far:** keep the first spec's §S4.6 (never print "0 cal" for "nothing counted"). It sits
  at the foot of the list. At `@wide` it sits in the outline column, under the step list, so it is
  always in view.
- **Scroll budget at 390 × 844:** header 56 + progress 32 + footer 72 leaves 684 px. Rows are 48 px for
  one line and 64 px for two. About 10 ingredients fit on one screen, against two and a half screens
  for six ingredients today.

#### 4.9.4 Step 3 · Steps

- A numbered list, not cards. Each step: the 32 px numeral, then an auto-growing textarea (2 lines
  minimum, `body`, 12 px corners). It always takes the full column width, which fixes the 12 px field at
  320 (first audit I1).
- **Timer behind a disclosure:** "+ Add a timer" (a text button). It reveals a `DurationField` labelled
  "Timer". Most steps have no timer, so most steps show no empty box (the same progressive disclosure
  as the range toggle).
- ⋮ per step: Move up · Move down · divider · Remove step (WCAG 2.5.7: moving without drag).
- **Paste steps:** a "Paste steps" text button in the step header. It splits pasted text into steps at
  blank lines and at leading numbers ("1.", "2)"). This is a pure function and needs no server. A cook
  who copies a method from anywhere gets numbered steps in one action.
- "+ Add step" at the end. A new step takes focus.

#### 4.9.5 Step 4 · Photos & publish

1. **Photos:** a grid of 3 (compact) or 4 tiles. The first tile is labelled "Cover". Each photo's ⋮ has
   Set as cover · Replace · Remove. **Add photo** opens a sheet on phones ("Take photo", "Choose from
   library") and a file picker on desktop. Empty state: "Add a photo. Recipes with a photo are easier to
   find." It is a hint, not a block.
2. **Before you publish:** a checklist (keep the first spec's §S6 item 2). Each row links to its step and
   row. All clear: "Everything is ready."
3. **Who can see it:** two 56 px radio cards, "Public" and "Private". For a free-tier user, Private shows
   a "Premium" badge, and choosing it opens the upsell sheet (§4.6, same copy pattern).
4. **Preview** (D13): a secondary button. It opens the real detail page in a full-height sheet, with
   the banner "Preview. This is how it looks to others." Today the review step is a label and value
   table that drops range upper bounds (first audit F3). The real page shows ranges right by design.

### 4.10 Paste ingredients (from the create menu)

- **Paste screen**, a focused task:
    - × and "Paste ingredients" in the header.
    - A field labelled "Ingredient lines". It is a textarea in `body` Inter, 12 px corners, 10 rows
      minimum, 72ch maximum. (The first spec keeps it monospace. A monospace face reads as "code" and is
      harder to read for prose lines, so Inter.)
    - The live count under it, "12 lines".
    - **Read ingredients** pinned above the keyboard on phones, and at the foot of the column on desktop.
- **Review screen:**
    - H1 "Check your ingredients" with a **determinate** progress line: "8 of 12 read". A wait over about
      a second needs a progress indicator that shows how far it got (`interaction-motion.md`).
    - Rows use the read-row layout (§4.9.3), with the source line under each in `caption`: "From: 2 cups
      plain flour". The food name is ink, not seafoam, because it is not a link (first audit P1).
    - The footer primary is **Start a recipe with these** (O4). It opens the editor at Details, with the
      lines already in Ingredients. Secondary: **Edit the list**, which goes back to the paste screen
      with the text kept.
- Stalled, expired, failed and partial states: keep today's copy, on DS buttons (first spec §S7).

### 4.11 Version history

Keep the first spec's §S3, with one addition. The version preview (a sheet) has **Restore this version**
as its primary. Restore makes a new version, so it can be undone by restoring again, and it needs no
dialog. A snackbar says "Restored version 9." with **Undo**.

### 4.12 Profile (one page; Q4)

```
phone 390                                  desktop 1280: the same single column, 640 max, left-aligned
┌──────────────────────────────────┐
│ Profile                          │ H1
│ (EM) Eliza Moreno                │ 72 avatar, name, email
│      eliza@example.com           │
│ ┌──────────────────────────────┐ │
│ │ Display name     Eliza     › │ │ grouped rows, 56 px
│ │ Email            eliza@…     │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Food data sources          › │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Sign out                     │ │ ink text, not red
│ └──────────────────────────────┘ │
│ Danger zone                      │
│ ┌──────────────────────────────┐ │
│ │ Close account              › │ │ danger-text
│ │ Erase my data              › │ │
│ └──────────────────────────────┘ │
└ ⌂ Home ▤ Recipes ◎ Discover (E) ┘
```

- **Grouped rows**, the settings-list pattern both platforms use. Each row is 56 px, with a label, the
  current value (truncate:1) and a chevron. Display name opens an edit sheet with one field.
- **Preferences group, web only:** "Food data sources" and a **Keyboard shortcuts** switch (on by
  default), which SC 2.1.4 requires for the `/` shortcut (§3.3). Native has no such switch, because it
  has no `/` shortcut.
- **No section nav on desktop** (it differs from the first spec's §P.1). Four short groups fit in
  about one and a half screens, and a nav for four items adds a second column for nothing.
- **Sign out** is in ink, not red. It is not destructive (judgement, consistent with "red means
  destructive or failed").
- **Close account** and **Erase my data** keep their existing dialogs and flows (CR-002, U4b, ADR-0009's
  sign-out command). Each row's hint sits under its label in `caption` (keep the first spec's copy).
- **States:** keep the first spec's §P.4. A profile read failure shows **Try again** in the header area,
  and the other groups still work.

### 4.13 Not found, offline and errors (every screen)

- **404:** keep the first spec's §N in full: branded, inside the shell for a signed-in user, with **Go to
  Home** and **Search recipes**, and no `role="alert"`. The empty-plate drawing (§2.6) is its picture.
- **Offline:** keep the first spec's §S.5 strip. Below `expanded` it sits under the bar. At `expanded`,
  where there is no top bar, it is sticky at the top of `<main>`, above the large title. Under it, every
  write still works through the offline
  write port. Discover search shows `Search needs a connection.` under its field.
- **Load error pattern, everywhere:** the section's real heading stays, then one sentence that says what
  failed, then **Try again**. One failed section never replaces the whole page. The other sections still show.
- **Refresh failed:** the existing `refresh-notice`, above the content.
- **Permission (Premium) gates:** an upsell sheet with the truth and two equal choices (§4.6). Never a
  disabled control with a paragraph next to it.

### 4.14 Every screen at every width

"Seen" means I read the 2026-10-08 capture of today's screen at that width. The layout given is the
proposed one.

| Screen            | 320 / 390 (phone web)                                  | 768 (tablet web)                               | 1280                                             | 1920                        | Native phone                                 | Native tablet _(source)_              |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------ | --------------------------- | -------------------------------------------- | ------------------------------------- |
| Sign in / up      | full-bleed form, 272 / 342 column (390 seen)           | 440 card centred (seen)                        | 50/50 photo and form (seen)                      | the same, form 400 max      | full-bleed, button pinned above the keyboard | 440 card centred                      |
| Home              | greeting, 2 × 2 recent, Coming soon stacked (390 seen) | 4 recent in one row, placeholders 2 + 1 (seen) | 4 recent, placeholders 1 : 2 then full (seen)    | the same in 1440 cap (seen) | as phone web                                 | as 768                                |
| My recipes        | row list, 4 rows on screen at 390 (seen)               | 3-column grid (seen)                           | 4-column grid (seen)                             | 5-column grid (seen)        | as phone web                                 | 3 or 4 columns by width               |
| Collections       | 2-column album grid                                    | 3 columns                                      | 4                                                | 5                           | as phone web                                 | as 768                                |
| Collection detail | title wrap:3, actions under it (390 seen)              | the same, list or grid (seen)                  | actions on the meta row (seen)                   | the same                    | as phone web                                 | as 768                                |
| Add recipes       | full-height sheet, toggle rows                         | 640 dialog                                     | 640 dialog                                       | 640 dialog                  | full-height sheet                            | form sheet, 640                       |
| Discover          | rails, 2-column results, filter sheet (390 seen)       | the same, 3 columns (seen)                     | sticky filter panel and 3 columns (seen)         | panel and 5 columns (seen)  | as phone web, filter sheet                   | as 768                                |
| Recipe detail     | full-bleed hero, switch, one column (390 seen)         | two columns under the hero (seen)              | photo and title side by side, two columns (seen) | three columns (seen)        | as phone web, back on the hero               | as 768, three columns at 1024 dp wide |
| Cook view (new)   | one step, full screen                                  | the same, text 28                              | the same, 720 text column centred                | the same                    | the same, keep-awake                         | the same                              |
| Editor frame      | header, progress bar, pinned footer (390 seen)         | rail, pinned footer (seen)                     | outline column and body (seen)                   | the same, body 720          | as phone web                                 | as 768                                |
| Step 2 rows       | amount 72 + text + ⋮                                   | amount 96                                      | amount 96, prep inline                           | the same                    | as phone web                                 | as 768                                |
| Paste             | textarea, pinned button                                | 72ch column                                    | 72ch column                                      | the same                    | the same, button above the keyboard          | as 768                                |
| Profile           | grouped rows (390 seen, error state only)              | 640 column (seen)                              | 640 column (seen)                                | the same                    | as phone web                                 | as 768                                |
| 404               | centred block (390 seen)                               | the same                                       | inside the shell                                 | the same                    | not applicable                               | not applicable                        |

### 4.15 Web and native translation (agent §3.6 pass)

| Element              | Web                                        | Native                                      | Disposition                      | Why                                               |
| -------------------- | ------------------------------------------ | ------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| Primary navigation   | sidebar at 1024 and up, tab bar below      | tab bar at every size                       | moved at 1024                    | owner directive, reach                            |
| Drawer               | removed                                    | none                                        | dropped                          | four destinations fit in the tab bar (D2)         |
| Large title          | `IntersectionObserver` collapse            | scroll-linked collapse                      | kept                             | platform convention on both                       |
| Create menu          | menu on desktop, bottom sheet on phone web | bottom sheet                                | kept on phones, moved on desktop | thumb zone, and no popover in a corner            |
| Recipe hero back     | round button on the photo                  | the same, inside the safe area              | kept                             | one back control                                  |
| Section switch       | sticky below `@wide`, absent at `@wide`    | sticky on phone, absent on wide tablet      | collapsed at `@wide`             | two columns already show both                     |
| Row ⋮ menus          | anchored menu                              | `ActionMenu` sheet                          | kept                             | no hover on touch, so every row action is visible |
| Hover states         | fine pointer only                          | pressed states                              | translated                       | touch has no hover                                |
| Drag to reorder      | none, Move up and Move down                | the same                                    | kept                             | WCAG 2.5.7                                        |
| Rail scroll          | prev and next buttons on a fine pointer    | swipe with a peeking card                   | translated                       | no precise pointer on touch                       |
| Keyboard `/`         | focuses search                             | not applicable                              | dropped on native                | no hardware keyboard by default                   |
| Add photo            | file picker                                | "Take photo" or "Choose from library" sheet | translated                       | the camera is native's advantage                  |
| Cook view keep-awake | Screen Wake Lock                           | `expo-keep-awake`                           | kept                             | the same job                                      |

The ten checks:

1. **Platforms:** web phone, tablet and desktop. iOS and Android phones and tablets.
2. **Dispositions:** in the table above, plus Q9 for the row card.
3. **Primary actions:**
    - The FAB sits bottom-end on phones, at the content column's end edge on desktop.
    - The editor's Next sits bottom-end in the pinned footer.
    - Detail's main button fills the row under the title. That is a reading page, so no pinned bar.
    - The picker's Done is pinned at the bottom.
4. **Hover, right-click, drag:** none are needed for any task.
5. **Longest strings:**
    - "Paste ingredients", 17 characters, in a 288 px menu.
    - "Next: Photos & publish", from `@regular` only. Compact shows "Next".
    - "Save a copy" in a full-width button.
    - "New collection" beside the title at 320.
    - "Choose a match".
    - German at +35%: "Zutaten einfügen" in the menu, and "Entdecken" in an 80 px tab.
    - A control that still does not fit moves its row, never wraps inside itself.
6. **320 px:** no sideways page scroll anywhere. Rails and chip rows scroll inside themselves. E1's
   skeleton is fixed first.
7. **Scroll budget:** library 4 rows at 390. Home's 4 recent cards on screen 1. Detail's glance line and
   main action on screen 1. Step 2 holds about 10 ingredients per screen.
8. **Keyboard open:** the editor footer unpins (A1). The one-line entry field scrolls above the
   keyboard, with its suggestions above it on native (V3-1). Sign-in and paste buttons sit above the
   keyboard.
9. **Back:** §3.4, per platform. iOS edge swipe is flagged to `staff-architect`.
10. **Rule placement:** `LargeTitleHeader`, `RecipeCover`, the state matrix, `figure`, the input shape and
    `SectionSwitch` all go in `@commise/ui` or the shared card module. **These are classes, not screens.**

---

## §5. The 14 owner decisions, plus five new ones

Nothing is live (memory `notLiveNoData`). So every "one-way door" below costs code and tests only,
**today**. The cost goes up as soon as real users learn a term or bookmark a URL. That is the reason to
decide all 14 now, not to defer them.

### 5.1 The 14 from the first audit

| #   | Decision                                                  | My answer                                                                                                              | Mechanism                                                                                                                            | Door and cost now                                                                                                       | Flip condition                                                                                                                      | Against the first audit                                                         |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Q1  | Where Collections lives on web                            | **A tab inside Recipes: "My recipes · Collections".** Discover moves out to its own destination.                       | One scope per destination: yours against everyone's (§3.2). Search scope stays visible.                                              | One-way once users learn it. Now: one tab key and one nav item.                                                         | A closed card sort in which most people group public and personal recipes together                                                  | Agree on Collections. **Differ** on Discover (D1).                              |
| Q2  | Rename "Community" to "Discover"                          | **Yes.** It is a destination name, not a tab label.                                                                    | Nielsen #4: one name for one place (E32).                                                                                            | One term, no URL change                                                                                                 | none in sight                                                                                                                       | Agree                                                                           |
| Q3  | Hide unbuilt destinations from the phone tab bar          | **Yes, and from the sidebar too.** Home's "Coming soon" section is their only home.                                    | A nav item that goes nowhere is a dead control (Nielsen #1). Three dead slots cost the live tabs their label width.                  | Two-way                                                                                                                 | The owner wants the roadmap visible in nav. Then use a non-link "Coming soon" text group at the sidebar foot, never in the tab bar. | **Differ** (D11)                                                                |
| Q4  | Merge Profile, Settings and Account                       | **Yes. One Profile page, and delete `/settings` and `/account`.** No redirects, because nothing links to them.         | Nielsen #4 and #6. Three thin pages become one (E15).                                                                                | URLs. Nearly free now, apart from updating the e2e specs that open `/account` (`accountDangerZone.spec.ts` among them). | An external link to either URL starts to exist                                                                                      | Agree on the merge. **Differ** on redirects (none needed).                      |
| Q5  | Home order: live widget first                             | **Yes.** Recent recipes first, as a 2 × 2 grid. Placeholders last and compact.                                         | The counter test: real content on the first screen (M2, E9).                                                                         | Two-way, the registry order                                                                                             | The owner reads FR-046's "order" as fixed                                                                                           | Agree on the order. **Differ** on layout (grid, not rows).                      |
| Q6  | Clerk sign-up fields                                      | **Email and password, plus Google. No username, no first or last name.** Ask for a display name later, inline on Home. | Show value before asking for commitment (`interface-patterns.md`). The app's handle is `displayName`, so Clerk's username is unused. | Two-way, a Clerk dashboard setting                                                                                      | A legal or moderation need for a real name                                                                                          | Agree, and go further (the inline name card).                                   |
| Q7  | A brand line on the sign-in card                          | **Yes**: "Cook with confidence. Plan with ease." Plus a photo panel at 1024 and up.                                    | FR-045a leaves no other place where a visitor learns what the product is.                                                            | Two-way, copy                                                                                                           | The owner reads the photo panel as a welcome screen. Then keep only the line.                                                       | Agree, and go further                                                           |
| Q8  | Remove the notification bell                              | **Yes. Remove the top-bar search icon too.**                                                                           | Dead controls fail Nielsen #1 and WCAG 4.1.2 (E13). Search lives in the page it searches (§3.5).                                     | Two-way                                                                                                                 | Notifications ship. Then re-add the bell with the service.                                                                          | Agree on the bell. **Differ** on search (the first spec routes it to Discover). |
| Q9  | Row card drops tags and version                           | **Yes, in the row (list) variant only.** The grid variant shows every CR-002 field.                                    | Disposition "deferred to detail" (§3.6). The list is for finding by name.                                                            | Two-way                                                                                                                 | The owner says CR-002 binds every variant. Then the row adds one caption line, "v12 · 3 tags", and grows to 112 px.                 | Agree                                                                           |
| O1  | Editor title cap                                          | **120, as a soft limit.** No silent cut. The counter turns red past the cap.                                           | Error prevention (Nielsen #5). 64 already cuts real titles (F4).                                                                     | Two-way                                                                                                                 | Titles in real data cluster above 100                                                                                               | Agree                                                                           |
| O2  | Replace the "wrapping row" with a read row and one editor | **Approve, plus one-line entry** (D8) **and quiet healthy rows** (N4).                                                 | Postel's law. Von Restorff. The scroll budget (R1).                                                                                  | Two-way (code only)                                                                                                     | A 5-person think-aloud on "enter this 8-line recipe" shows more errors with one-line entry than with pick-then-type                 | Agree, and go further                                                           |
| O3  | Step 4 becomes "Photos & publish"                         | **Approve.** The cook often takes the photo after cooking, so photos belong at the end.                                | The task order is the real-world order (Nielsen #2). Step 1 gets shorter.                                                            | Two-way                                                                                                                 | none in sight                                                                                                                       | Agree (renamed from "Photos & review")                                          |
| O4  | The paste review gets "Start a recipe with these"         | **Approve, and put "Paste a list" inside step 2 too**, on the same parse path.                                         | The flow ends where the task begins (F6). One path, two doors.                                                                       | Two-way. `staff-architect` designs the hand-off.                                                                        | none in sight                                                                                                                       | Agree, and go further                                                           |
| O5  | Rename "Clone" to "Save a copy"                           | **Approve.** On cards it is an icon button with the full name "Save a copy of {title}".                                | Nielsen #2: user words, not developer words.                                                                                         | Term, nearly free now                                                                                                   | none in sight                                                                                                                       | Agree                                                                           |

### 5.2 Five new decisions this proposal raises

| #   | Decision                                                              | My recommendation                                                                    | Why                                                                                                                                          | Cost                                                                                         | Flip condition                                                                                                  |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| N1  | Drafts save by themselves, and steps can be visited in any order (D7) | **Approve.** Edits to a published recipe save to the device until **Save changes**.  | Interruption is normal on a phone, so never lose entered data (`cross-platform-translation.md`). Free step order is recognition over recall. | About 3–4 days, plus a `staff-architect` check against the offline write port and versioning | Each server autosave makes a version, and that cannot change. Then autosave stays device-only for every recipe. |
| N2  | Build the cook view (§4.8)                                            | **Approve, as the next feature after this overhaul.**                                | It is in the mockups (`screenCooking.html`). It is the one cook-mode quality ReciMe users praise (in-repo teardown §6B). It needs no server. | About 1.5–2 weeks for both platforms. It needs an FR.                                        | The owner wants cooking features to wait for meal planning (006)                                                |
| N3  | A navigation rail on tablets held sideways (§3.3)                     | **I recommend it.** Not binding, and this proposal designs the tab bar as directed.  | Material's adaptive guidance uses a rail for medium and expanded windows. Tablet thumbs reach the side edges.                                | About 2–3 days for a `NavRail` primitive                                                     | The owner keeps the 2026-07-18 directive                                                                        |
| N4  | Quiet healthy ingredient rows (§4.9.3)                                | **Approve.** It overturns `ingredientStatusExplanation.md` §3a's "always two slots". | Problems stand out only against quiet rows (Von Restorff).                                                                                   | Small. Food details move into ⋮ and the editor.                                              | Users fail to find a resolved row's nutrition in a test                                                         |
| N5  | Rename "Instructions" to "Steps"                                      | **Approve.**                                                                         | Shorter, plainer, and the wizard rail fits on one line at `@regular`.                                                                        | One term, nearly free now                                                                    | The owner prefers "Method" for its cookbook tone. That also fits.                                               |

**One idea I considered and do not recommend now:** a live "Trending" widget on Home. It helps the first
screen of a cook with few recipes. But FR-046 says the recent-recipes widget is the only live widget
in Home v1. Changing that is a spec amendment, and Home's first-run block already links to Discover.

---

## §6. Build order

Each slice ships web and native together (CODING_STANDARDS §14). Each one ends with its Playwright and
Maestro tiers green, and a written web and mobile parity audit (memory `webMobileLockStepAudit`). Sizes are
my rough judgement for one experienced front-end engineer, before tests.

| Slice                                    | What                                                                                                                                                                                                                                                   | Depends on                                               | Fixes (first-audit IDs)                                    | Size        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| **B0 · Hotfixes, no design needed**      | E1: the rail skeleton overflow. F1: `formatDuration`, so no "16200s". F5: no default "1". F3: ranges in review. D2: the ⋯ menu under the tab bar. I1: the 12 px step field. E3: `break-words` on a flex item. Remove the dead bell and search buttons. | nothing                                                  | the severity-4 and worst severity-3 items                  | 2–3 days    |
| **B1 · Tokens**                          | The colour roles (§2.1), with `honey` and `ink-deep`. Coral leaves controls. The `figure`, `largeTitle`, `barTitle` and `readingBody` roles. The input shape. Inter on native. Android elevation by level. Remove the second gradients.                | B0                                                       | the "cheap" look, everywhere at once                       | 3–4 days    |
| **B2 · Primitives**                      | `LargeTitleHeader`. The state matrix in `Button`, `Chip` and `Tabs`. `SearchField`, `FieldLabel`, `DurationField`, `Stepper`. `RecipeCover`. `UndoSnackbar`. An `ActionMenu` that flips. Lucide icons.                                                 | B1                                                       | E5, E7, E10, E11, E19, E30, N1 (first audit's native list) | 1.5–2 weeks |
| **B3 · Shell and IA**                    | Four destinations. The native tab bar in `AppRoot`. No drawer. The desktop sidebar with the profile row. No top bar at `expanded`. `/settings` and `/account` removed.                                                                                 | B2                                                       | E4, E13, E16, E28, E31, E32, M1                            | 4–5 days    |
| **B4 · Cards and lists**                 | `RecipeCard` grid, row and rail · My recipes · Collections tab · Home                                                                                                                                                                                  | B2, B3                                                   | E6, E9, E14, E26, E27, E29, M2                             | 1 week      |
| **B5 · Recipe detail**                   | hero, glance line, `SectionSwitch`, Serves with ingredients, the 2- and 3-column layouts                                                                                                                                                               | B2                                                       | F2, D1, D4–D12                                             | 1 week      |
| **B6 · Editor frame and step 2**         | autosave and status (N1) · progress and outline column · read rows · one-line entry · paste inside step 2 · groups                                                                                                                                     | B2. `staff-architect` on the reader import and autosave. | W1–W5, R1–R13, F5                                          | 2 weeks     |
| **B7 · Steps 1, 3, 4 and paste**         | Details groups · Steps with "Paste steps" · Photos & publish with Preview · the paste review into the editor                                                                                                                                           | B6                                                       | S1, S2, I2–I4, RV1–RV3, P1–P3, F6                          | 1 week      |
| **B8 · Discover and Collections detail** | the filter sheet and panel · rails · Save a copy on cards · collection detail · the picker sheet                                                                                                                                                       | B4                                                       | E8, E17, E20–E25                                           | 1 week      |
| **B9 · Profile, sign-in and 404**        | one Profile page · Clerk appearance and the split layout · the sign-up fields · the 404                                                                                                                                                                | B2, B3                                                   | E2, E15, E23, E33                                          | 3–4 days    |
| **B10 · Cook view**                      | only after N2 is approved                                                                                                                                                                                                                              | B5                                                       | a new feature                                              | 1.5–2 weeks |

**The cheaper path, for most of the value first:** B0 + B1 + B3 + B4, about 3 weeks. It fixes these on
every screen at once, because each one lives in a token, a primitive or the shell:

- the sideways scroll and the dead buttons
- the washed-out colour
- the doubled titles
- the missing Collections door
- the ragged cards
  What it leaves: the editor (B6–B7) still feels like today's, apart from the
  B0 fixes, and recipe detail keeps its long phone scroll.

---

## §7. Validation, evidence and hand-off

### 7.1 Advocacy: where the end user and the brief pulled apart

- **FR-045a, no welcome screen (Situation C, conceded).** I designed inside it. The sign-in surface
  itself carries the brand line and, at 1024 and up, a photo panel. That answers the recorded gap that a
  visitor never learns what the product is, without putting anything in front of sign-in.
- **FR-046, placeholders in the real shape (Situation B, compromise).** They stay, in shape, but last,
  compact, static and under one honest heading. The cook sees their own recipes first.
- **Tablet tab bar (Situation B, recorded once).** I recommend a rail (N3), and I designed the tab bar as
  directed.
- **`ingredientStatusExplanation.md` §3a, two slots (Situation B).** I recommend quiet healthy rows (N4).
- **Deceptive-pattern screen:** run on every upsell (private recipe, private collection). Each one tells
  the truth, pre-selects nothing and offers "Not now" at equal weight. So each passes the DSA Article 25
  test: it does not "distort or impair" a free and informed decision. None found.

### 7.2 Checks run on this proposal (agent §6c, four of four)

1. **Against publication** (read today, 2026-10-08):
    - NN/g, "Hamburger Menus and Hidden Navigation Hurt UX Metrics" (2016): hidden navigation cut
      discoverability "almost in half", and on phones people were 15% slower. **Changed:** the first
      draft kept a drawer for overflow. I removed it.
    - NN/g, Katie Sherwin, "Placeholders in Form Fields Are Harmful" (2014, reviewed 2018): placeholders
      burden memory and block review. **Changed:** every field in this proposal has a visible label.
      The one-line entry field also carries a hint under it, not a placeholder alone.
    - Android Developers, "window size classes": compact below 600 dp, medium 600–840 dp, expanded 840 dp
      and up. **Changed:** I corrected the first spec's "named after Material's" claim (§2).
    - Android Developers, "Build adaptive navigation": a navigation bar for compact windows, a rail for
      medium and expanded. **Used** for N3.
    - MDN, Screen Wake Lock API: Baseline 2025. Safari 16.4–18.4 does not honour it in Home Screen web
      apps. **Used** for §4.8.
    - Lucide: ISC licence. `lucide-react-native` needs `react-native-svg` 12–15. **Used** for §2.5.
    - Apple HIG on large titles: **only from a search result**, not the full page. I paraphrase it and
      do not quote it as a rule.
2. **Against prior art:**
    - The in-repo ReciMe teardown (`docs/competitive/01RecimeTeardown.md` §6A and §6B): users praise cook
      mode for keeping the screen awake. It has tappable ingredient text inside steps, which I list as a
      later idea for the cook view. It has no dark mode, and the cook view's dark surface answers part
      of that.
    - The mockups (rendered today): the image-led cards, the hero with back and ⋯ on the photo, the
      sans card titles, and the cook screen. The mockups also overflow at 390 themselves: Home renders
      792 px wide and Recipes 482 px. Their buttons wrap too ("Add to Meal Plan" on three lines). I did
      not copy those parts.
    - Paprika and NYT Cooking: **from memory, not checked today.** So they are judgement, and nothing
      here depends on them.
3. **Against a second expert** (questions for `staff-architect`, with my assumption in brackets):
    - Can web and native import `recipe-import-core`'s pure line reader? (Assumed yes, or a thin adapter
      over `parse-ingredient`.)
    - Can autosave write drafts without making a version per save? (Assumed: device-only for published
      recipes.)
    - The native stack is a hand-rolled `useState` union. How do we get the iOS edge-swipe back gesture
      and a root tab bar? (Assumed: a small stack primitive, or a navigation library. That is the
      architect's call.)
    - `SectionSwitch` on native needs to scroll to an offset, so it needs a scroll-view ref. Is that the
      allowed "external, non-declarative system" exception? (Assumed yes.)
    - One-line entry reads a typed line on the device with `parse-ingredient`. A pasted line goes
      through the CRF and LLM pipeline, with its cache and its corrections. So the same text can get two
      readings, depending on how it arrived. The owner protects the order correction, then cache, then
      engines (memory `parser-accuracy-bar`). Must a typed line go through the same path once it is
      committed, or is the difference acceptable? (Assumed: the device reading fills the fields at once,
      and the line still goes to the pipeline after commit. The pipeline's answer then wins, with the
      cook's own edits kept.)
4. **Against myself.** The strongest case against D1 (Discover as a top-level destination): it adds a
   fourth tab, and on a phone each new tab costs label width and one more choice (Hick). Many recipe apps
   (ReciMe among them) have no discovery tab at all.
    - My answer: four tabs still fit at 320 with room for German.
    - Mixing scopes in one strip is a known findability failure, and Discover is a shipped feature
      (FR-005) that needs a door.
    - If the owner sees Discover as minor, the flip is cheap: it becomes a link row on Home and the
      Recipes tab strip stays two tabs.

    The strongest case against D8 (one-line entry): a parser that guesses wrong silently puts a wrong
    amount in the recipe.
    - My answer: the live reading shows every part before you commit. Nothing is guessed out of sight.
      And the owner's own bar for the parser is "nonsense words and wrong numbers, not precision"
      (memory `cooking-is-an-art-parse-tolerance`).
    - What can change my mind: the think-aloud in O2's flip condition.

### 7.3 Evidence: checked, assumed, judgement

- **Checked:**
    - Every contrast ratio here (computed today).
    - The token values (`tokens/scale.ts`).
    - The canvas wash is deliberate (`globals.css`, issue #145).
    - Web icons are hand-made and native uses `@expo/vector-icons` (`features/recipes/src/actions/icons.tsx`,
      the package manifests).
    - The native root is a `useState` destination union (`mobile/src/screens/AppRoot.tsx`).
    - `scaleRecipeForServings` exists (`detail/RecipeDetailBody.native.tsx`).
    - `parseIngredientLine` and `readStatedMeasure` exist in `recipe-import-core`.
    - FR-045a and FR-046 wording (`specs/001-commise-recipe-app/spec.md`).
    - The wireframe puts Clone on search cards (`recipe-search.md`).
- **Assumed:** the feasibility points in §7.2 item 3. The 320 behaviour of screens I did not open at
  320 myself, which I took from the first audit.
- **Judgement, labelled where used:**
    - the 2 × 2 Home grid
    - sheets for new collection and the picker
    - keeping the tab bar on detail screens
    - Inter in place of mono for paste
    - Sign out in ink
    - the size estimates
    - every spring constant

### 7.4 References consulted

- **Corpus:** `visual-design.md`, `visual-systems.md`, `device-ergonomics.md`,
  `cross-platform-translation.md`, `design-process.md`, `human-factors.md`, `information-architecture.md`,
  `interaction-motion.md`, `interface-patterns.md`. Not loaded: `accessibility.md` and
  `critique-handoff.md`, because this is DESIGN mode. Every WCAG number here is one the first audit
  already cites, or one stated in a loaded corpus file. The SPECIFY pass that follows must load both.
- **Live sources:** listed in §7.2 item 1, all read 2026-10-08:
    - nngroup.com/articles/hamburger-menus
    - nngroup.com/articles/form-design-placeholders
    - developer.android.com (adaptive navigation, window size classes)
    - developer.mozilla.org/en-US/docs/Web/API/WakeLock
    - npmjs.com/package/lucide-react-native
- **Repo:** the five first-audit files, the 2026-10-08 captures, `docs/mockups/` (rendered),
  `docs/mockups/README.md`, the 001 wireframes named above, `docs/competitive/01RecimeTeardown.md`, and
  the code paths in §7.3.

### 7.5 Success measures

- **Falsifiable now (automated, at 320, 390, 768, 1280 and 1920, loading and loaded):**
    1. `document.documentElement.scrollWidth === innerWidth` on every route (no sideways scroll).
    2. No control label renders on more than one line, with +35% pseudo-localised strings (keep the
       first spec's §Z check).
    3. At 390 × 844: four library rows, all four Home recent cards, and recipe detail's glance line and
       main button sit fully inside the first screen.
    4. At 390 × 844, step 2 shows at least 8 one-line ingredient rows without scrolling.
    5. No two visible titles on any screen: one H1, and the bar title only after it scrolls away.
- **After release (the owner reads these):**
    - **Primary:** time from sign-up to the first published recipe.
    - **Guardrail:** the share of drafts abandoned at step 2. The first sign of trouble is that share
      rising after B6 ships. The existing analytics emitter (`analytics/useAnalyticsEmitter.ts`, first
      spec) carries both.

### 7.6 Artefacts written

- `docs/design/uiOverhaul/proposalB.md`: this file, a design artefact (§9). Nothing else. I wrote no
  app code and edited no other file. My mockup renders went to the session scratchpad, outside the repo.

### 7.7 Questions blocking this

None block the build. These need the owner's answer: the 14 decisions in §5.1 and N1–N5 in
§5.2. The five feasibility questions in §7.2 item 3 need `staff-architect`.

### 7.8 Hand-off

1. **Owner:** pick between this proposal and the other one, decision by decision. §1.4 and its "also
   differs" list, plus §5.1's last column, list every point where this
   one differs from the first audit.
2. **`staff-architect` (PLANNING and BLUEPRINT):** the §7.2 item 3 questions, the native stack and tab
   bar, autosave against versioning, and the paste into the editor hand-off.
3. **`staff-ux-engineer` (SPECIFY):** turn the chosen decisions into the committed spec. Load
   `critique-handoff.md` and `accessibility.md`, and write the full accessibility contract and copy deck.
4. **`fe-1`:** build slice by slice in §6 order, test first. Its accessibility floor must be WCAG
   **2.2** AA.
5. **`staff-ux-engineer` (EVALUATE)** after each slice, including the screens nobody has seen yet:
   native tablet, native Discover, Collections, Profile and recipe detail.

**State to carry forward:**

- **Context:** a home cook, phone first, one hand, at arm's length.
- **Direction:** "cookbook at the counter".
- **Flip conditions:** Q1 (card sort), N1 (versioning), N3 (owner directive), O2 (think-aloud).
