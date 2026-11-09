# Plan: pinned ingredients bar (R1) and the phone page gutter

Author: UI Designer, 2026-11-08. Branch `feat/im-pinnedingredientsbar` from `main` at `586788b94`.

## Why

The owner reported both defects from an iPhone 14 Pro Max in Chrome, on the recipe page:

1. When the cook scrolls into the steps, nothing keeps the ingredients in reach. Owner ruling R1
   (`docs/design/uiRefreshWorkshop5/ownerFeedback.md`, binding) requires a pinned ingredients bar on mobile. It was
   never built: no component, no copy keys. Ruling R3 removed the old Ingredients · Steps · Nutrition switch, so the
   phone has no way back to the list. The owner says the bar must ship.
2. The page's right padding is very thin. Content almost touches the screen edge.

## Sources (read these first)

- `ownerFeedback.md` rows R1 (the bar), R2 (the desktop sticky column), R3 (no switch). Read the full R1 row,
  including its rule and its user needs.
- Boards: `docs/design/uiRefreshWorkshop5/redesignCanvas/boards/RecipeDetailScrolledMobile.dc.html` (bar closed)
  and `RecipeDetailIngredientsOpenMobile.dc.html` (list open). Their CSS (`.pinBtn`, `.ingSheet`, `.vscrim`,
  `.sheetServe`, `.stepper`) is the visual spec.
- `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`: type roles and the 2x cap (2026-11-01), chrome
  text never larger than the page title (2026-11-07), wrapping rules (no `nowrap`), fractions and " · " (2026-11-06).
- `docs/design/uiOverhaul/buildSpec.md` §6.1 (body below 720 is one column, from 720 two columns with R2).
- Reuse existing code. Do not duplicate it:
    - `@commise/ui/pushed-page` `pinnedBarSlot.ts` and `PinnedBarSlotContext`, the web slot for fixed bars;
    - `detail/RecipeDetailBody.tsx` and `detailLayoutClasses.ts` on web;
    - `detail/DetailIngredientsSection.native.tsx` and `IngredientCheckRow.native.tsx` on native;
    - the servings stepper that is already on the ingredients card;
    - the shared design-system `Text` on native.

## What to build

### The bar (closed)

- Shows only below a 720 px body (the one-column layout). From 720 the sticky column (R2) does the job, and the bar
  never renders. Native phones always use the one-column layout.
- If the ingredients card is fully above the bottom of the sticky chrome, the bar shows. If any part of the card is
  back in view, the bar hides. Web uses one `IntersectionObserver` on the card, with `rootMargin` from the
  measured chrome (no scroll listener). Native uses the card's `onLayout` and the scroll view's `onScroll`, the same
  way the editor's section index tracks sections.
- Placement: pinned under the page's sticky top chrome, 12 px from each side, 64 px tall at 1x, `paper` with the
  `line-divider` inner edge and `shadow-md`, `radius-lg` (board `.pinBtn`). It never covers the tab bar.
- Content, start to end: line 1 "Ingredients" in the 16 px body role at 600 plus " for {n}" in the 14 px `meta` role at 400, `inkMuted`. Line 2
  "{items} items · {ticked} ticked" in `meta` `inkMuted`, tabular figures. If none are
  ticked, leave out " · {ticked} ticked". Then the cue "Show" (the 16 px body role at 600, `actionText`). All of it grows with the system text size up to 1.5x (`chromeCap`). Then a 36 px `action` circle with `chevron-down`.
- The whole bar is ONE button: `aria-expanded`, `aria-haspopup="dialog"`. Its name is "Ingredients for 4, 13 items,
  1 ticked. Show list." While the list is open, it ends "Hide list." The visible parts are `aria-hidden`. The name contains the
  visible words (WCAG 2.5.3).
- Text sizes: bar text is chrome. It grows to 1.5x at most (`chromeCap`) and never draws larger than the page title.
  The board's `white-space: nowrap` on line 1 is NOT used: at the cap, the label wraps and the bar grows. The cue and
  the circle keep their place at the end.
- The bar has no servings stepper (R1 as amended 2026-10-23). A mistap must never change servings.

### The list (open)

- Opens over the content as a panel directly under the bar: 12 px side insets, `radius-lg`, `shadow-xl`, `paper`
  (board `.ingSheet`). A scrim (`scrim` token) covers the content below the top chrome (board `.vscrim`). The bar
  stays visible above the panel and now reads "Hide" with `chevron-up`.
- Top row: "Servings" in `meta` `inkMuted` and the existing servings stepper at the end (board `.sheetServe`). It is
  the same stepper and the same state as the card, so a change shows in both places.
- Then the full ingredient list, the same rows as the card: group headings, tap-to-check, amount in bold, " · "
  before a preparation. Ticks are the same state as the card.
- A list taller than the space scrolls inside the panel. The panel never runs under the tab bar or the bottom safe
  area.
- `role="dialog"`, named "Ingredients for {n}". Focus moves into the panel on open and goes back to the bar on close.
  Focus stays in the panel while it is open (web: `inert` on the rest of the page, or the existing dialog focus
  helper, `@commise/ui/dialog-focus`).
- Close by: the bar again, the scrim, Escape (web), the Android back button (native, through the existing back
  intercept, ADR-0056), and scrolling is blocked behind the scrim while open.
- Motion: the panel fades and slides 8 px. It is instant under reduced motion.

### States

- No ingredients: no bar at all.
- None ticked / some ticked / all ticked: line 2 per the rule above. All ticked reads "13 items · 13 ticked".
- Groups: headings in the list as on the card.
- Stand-in (private) ingredients: the same row as the card (amount above the chip, designAnswers #144 item 7).
- Offline: works fully, because it reads the page's own data.

### Copy (i18n, both platforms)

Add new keys under the recipe detail messages, with ICU plurals:

- the bar label "Ingredients" and "for {count}";
- "{count, plural, one {# item} other {# items}}" and "{count} ticked";
- the cues "Show" and "Hide", and the button name template;
- the dialog name "Ingredients for {count}", and "Servings".

Every locale file the repo checks gets the keys.

## The gutter defect

- First, reproduce at 430 and 375 CSS px on the recipe page. Measure: the document `scrollWidth` against
  `clientWidth`, and each card's distance from the right edge of the viewport against the left one.
- The spec gutter is 16 px on both sides on phones (`main` `px-4`). Find the root cause. Likely causes:
    - an element wider than the viewport, which pushes the page sideways and eats the right gutter;
    - a negative margin;
    - a full-bleed element that does not pay the gutter back.
- Fix the cause. Never hide it with `overflow-x: hidden` on the
  page.
- Check the native recipe page too. Its side gutter is 16 pt on both sides.

## Tests (write each one first and watch it fail)

- Web component tests (`RecipeDetailBody` or the new bar component):
    - hidden while the card is visible, and shown after it scrolls away;
    - the name text, and the plurals (1 item, 13 items, and no "ticked" clause at 0);
    - no bar with no ingredients;
    - open and close by the bar, the scrim and Escape, with focus moving in and back;
    - the stepper changes the same servings as the card, and a tick in the panel ticks the card row.
- Native component tests: the same cases, plus Android back closes the panel, and the bar text caps at 1.5x (render
  at system scale 3.1 and read the drawn size).
- Playwright at 430 and 375: scroll past the card, the bar shows as one button, open, the stepper is at the panel
  top, close by scrim and by Escape. At 1280 the bar never renders. Gutter: `scrollWidth == clientWidth`, and every
  card's right gap equals its left gap (16).
- Maestro (Android and iOS): scroll to the steps, tap the bar, see "Servings" at the top, tick a row, close, see the
  tick on the card.
- Do not run full suites. Run the impacted tests only, with the repo's impacted-test scripts.

## Done when

- All the new tests pass, and each one failed first.
- Shots under `~/.local/state/kitchensink/shots/pinnedIngredientsBar/`: web at 430 and 375, Android and iOS, at 1x and
  the text cap, light and dark, for bar closed, list open, and the page top (gutter). Each with a `manifest.md`.
- The UI Designer passes the shots against the two boards. Then Nova Squad (the lead) runs GATE, opens the PR and
  merges. The builder does not push, open a PR or run GATE.

## Rules for the builder

- Test first, in every tier above. Web and native ship together.
- Use the shared design-system `Text` and existing tokens. No raw React Native `Text`, no new colors.
- Style native UI with Tamagui only (ADR-0080). No `StyleSheet` and no inline React Native style objects.
- Ask Thing 1 before you change any `@commise/ui` `.native.tsx` file. If no Thing 1 session runs, keep the change as
  small as possible, say so in the commit body, and report it.
- The local stack and devices are shared. Take `~/.local/state/kitchensink/locks/localStack.lock` before you use them,
  and release it after.
- Commit by explicit path, with hooks on. Conventional Commits. Clean up your shots copies, renders and build
  products after the work.
