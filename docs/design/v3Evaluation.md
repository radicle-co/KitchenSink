# V3: the full-scope UX review (plan 002 V3, and the curated plan's end-of-plan review)

⛔ **DESIGN EVALUATION. NOT PRODUCTION CODE.** This file reports findings and records decisions. It changes no code.

- **Mode:** EVALUATE. **Date:** 2026-10-03. **Agent:** `staff-ux-engineer`.
- **Scope:** the row editor and its food list in every picker (the create form's add row, inline Change food, row 6's
  candidates panel, row 7's shortlist, the recipe page's `AmbiguityReview`), on web and native. Also the curated plan's
  variant line, details dialog and Data sources page.
- **Standing:** I wrote the specs under test (`rowEditorOpenDecisions.md` S7 P1 to P12, `ingredientStatusExplanation.md`,
  `ingredientSpecialization.md`). I did not write the code. So the criteria are external where they can be: WCAG 2.2
  AA by number, the spec's own text, and the house's existing components.
- **Seen rendered:** web, yes. I drove the real web app through Playwright with the repo's own mocks
  (`web/tests/e2e/utils/foodApi.ts`, `recipeApi.ts`), from a scratch spec outside the tree, and measured with
  `getBoundingClientRect` and `elementFromPoint`. Native: no. Native findings are from source and are marked.
- ⛔ **Inspection, not user evidence.** Every "the cook" sentence below is heuristic judgement, untested with users.
- **Severity:** blocker = 4 (must fix before release), major = 3, minor = 2 or less (`critique-handoff.md`). No finding
  is a blocker.

## Verdict

- **Plan 002 V3 does not pass yet.** It passes once V3-1, V3-3 and V3-4 (`rowEditorOpenDecisions.md`) and the
  name-width ruling (`ingredientStatusExplanation.md`, V3 amendment) are built. Each is a committed rule that fixes a
  measured defect.
- **The curated surfaces pass** (curated U15's verification line, for the read surfaces, the dialog and Data sources),
  with D10 still open as a minor finding. The variant line on the editor row holds. The name above it is V3-M3.

## Measurements (web, rendered)

| Case                        | What was measured                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 1280 × 800, Change food  | Change food field 86 px wide. The same row's record name, before Change food: 112 px. Popup 320 × 320 at the field's x.                                              |
| B. 390 × 844, trailing row  | Popup bottom 836. The controls bar spans 782 to 844. `elementFromPoint` on the last option returns the option: the **popup paints over the bar**. Record name 86 px. |
| C. 390 × 844, response held | Loader-only popup 45 px tall, placed below. Released: it stays below and grows to 212 px, down to the bar, while 510 px stood free above the field.                  |
| D. 640 × 360, 200% text     | Catalog unavailable plus the cook's limit. Popup 128 px, **listbox 0 px**, content 324 px inside a 128 px box, so the status text spills past the card.              |
| E. 320 × 640, trailing row  | No horizontal page scroll. Popup 248 px wide (the floor shrank to the space at the field's right).                                                                   |
| F. 1280, ArrowDown twice    | Active option background `rgb(245,245,245)` on white, no ring: 1.09:1 against its neighbours.                                                                        |

## Findings, most severe first

### V3-M1 · 3 · The open list covers the wizard's controls, and its side is chosen on the wrong size (web, below `lg`) — rendered

- **Where:** `UI/combobox/Combobox.tsx:80-92` (no chrome insets in `flip` or `size`), `:89` and `:252` (the side is chosen
  once, by `flip`, on the popup's current rect), `:400` (`z-50` at the root's stacking level). `FR/wizard/Wizard.tsx:463`
  (the band is `sticky z-20`, which makes a stacking context) and `:546` (the bar's `z-60` lives inside it).
- **Criterion:** P9's decision (system change 12), not built. Nielsen #3 and #5. Not a 2.4.11 failure: _Understanding
  2.4.11_ (fetched 2026-10-03) exempts user-opened content the user can dismiss, and says nothing of an active descendant.
- **Observed:** B and C. The popup hides Previous, Save Draft and Next. At 390 px the last option, `Create my own food`,
  sits exactly where Next was.
- **Interpretation:** a cook reaching for Next with the list open presses an option instead. P1 put remote foods last to
  stop exactly that kind of mis-press. `flip` (floating-ui 1.8.0 core, read in `node_modules`) judges overflow from the
  popup's current rect. A popup that holds only the loader fits below almost everywhere. So P9's insets alone do not
  help: the side is still wrong.
- **Why 3, not 4.** The list is open only while text is pending, and R5 and R6 refuse Next and Save Draft then anyway.
  Previous is back once the list closes. A mis-tap commits a food that Change food undoes, or opens a form that
  Cancel closes. Frequent and persistent, but recoverable.
- **P9's own text was wrong.** It said the bar paints over the popup. The render shows the reverse. Fixed in the spec.
- **Fix, primitive:** V3-1 in `rowEditorOpenDecisions.md`: choose the side against the full height, and keep the popup
  out of the chrome's space. The mechanism (a design-system context the wizard provides) is a proposal. It adds a
  cross-package seam, so `staff-architect` BLUEPRINT signs it off before it is built.

### V3-M2 · 3 · Status lines squeeze the list to nothing (web) — rendered

- **Where:** `Combobox.tsx:95-96, 126, 135, 336, 400`. The lines are `shrink-0` in a height-capped column with no
  overflow rule. The listbox is `min-h-0`.
- **Criterion:** WCAG 1.4.4 (no loss of content at 200% text): fails in case D, which is the plan's own `text200`
  condition. Nielsen #1.
- **Fix, primitive:** V3-3: a floor of up to three option rows on the listbox, and `overflow-y-auto` on the popup.
- **Residual, not the primitive's:** at 640 × 360 and 200% text the wizard's band (137 px) and bar (121 px) left 102 px
  of 360. Lead ruling (2026-10-03): A1's unpin rule reaches the web bar (`compactHeightLayout.md` §4.4), and the bar
  now unpins in case D.
- **Ruled (2026-10-03):** unpinned, the popup gets about 130 px, and the line above the list filled it. Now the foods
  come first, as long as the list holds foods. See V3-M2a.

#### V3-M2a. Foods before the note (ruling, SPECIFY)

- **What was in the way.** One line only: the `status` line, the database line. The trailing lines already sit after
  the listbox. So that one line moves, and no other.
- **The rule.** The database line has two places, and what the database part found picks one. With no food found, the
  line leads. With at least one food found, it is the first trailing line, before each source's note and the loader.
  The choice is made once, at the database part's settle, so the line never changes place for a text (P2).
    - It leads for `tooShort`, `ingredientNoSuggestions`, `ingredientDatabaseUnavailable` and
      `ingredientPickerSearch.failed`. It also leads for a one-group sentence whose other group found nothing. Each of
      these explains an empty list or an error. There is no food to show first. The next control is `Find nutrition`,
      which the no-match line names (R1). And an error goes where the cook is looking (`content-design.md`).
    - It trails for `ingredientCatalogUnavailable` or `ingredientAuthoredUnavailable` whose other group shows foods. It
      qualifies a list the cook can already use.
- **At every size, not only in a short popup.** A size switch needs a measurement in the leaf. A popup that grows then
  moves the line under the cook (P2). CSS `order` splits the DOM order from the visual order (1.3.2, failure F1). One
  order also matches what is spoken: the polite string says the count first, then the unavailable sentence
  (`FR/form/entryCombobox.ts:238`).
- **No collapse, no disclosure.** A button in the popup cannot be reached. Focus stays in the field (APG), arrows move
  only among options, and Tab closes the list. So a disclosure fails 2.1.1. A clamp hides text at 200% (1.4.4).
- **Case D, computed from the tokens, not rendered** (root 32 px). The card is about 130 px. The `Your foods` heading
  takes about 50 px and the first option 88 px. So a whole row still does not fit at rest. But the cook now sees the
  heading and the first food's name (about 80 to 128 px down), not a note. Scrolling the card still brings a whole
  row into view (V3-3).
- **Cost, accepted.** In a short popup, and on native with the keyboard up, the catalog sentence is below the fold. A
  cook can choose `Use as written` before reading it. Their own foods are the task. The polite string says the
  sentence. And in a tall popup it sits right under `Not listed?`.
- **Native.** The same, with no leaf change: both leaves render `entryComboboxOf`. There the leading line broke item
  7's budget (the field and three options above the keyboard). One model means the platforms cannot differ (P10).
- **Where it lives.** Code: `entryComboboxOf` only (`servedSpeechOf`, `FR/form/entryCombobox.ts:242`). The primitive
  cannot own the rule in code. It cannot tell a food from `Find nutrition`. Its two slots already exist, so a new prop
  only repeats them. The rule goes in the primitive's contract instead, in `UI/combobox/props.ts`. On `status` it
  says: a line the cook must read before any option. On `trailingStatus` it says: a line about results the list
  shows. Every later host then meets the rule.
- **Copy.** No new string, no new key.
- **Accessibility.** 1.3.2: reading order is visual order in both places, because the host moves the line between
  slots in the DOM. 2.4.3: focus stays in the field, and no line takes focus. 4.1.3: no line becomes live, and the
  polite and assertive strings do not change. 1.4.4: still passes (V3-3).
- **Built with it (2026-10-03).** In case D the listbox scrolls inside a card that also scrolls. downshift scrolled only
  the listbox, so ArrowDown could make an option active below the card's edge. Its `scrollIntoView` now takes the card
  as its boundary, and a Playwright case-D test proves the third option ends whole inside the card.
- **Tests, red first.**
    - Unit, `FR/form/__tests__/entryCombobox.test.ts`: rewrite the "failed alone" `it.each` as two cases, and say so in
      its doc comment. Case one: the other group has foods, the sentence is `trailingStatus[0]`, and `status` is
      undefined. Case two: the other group is empty, and the sentence is `status`. `databaseFrame()` defaults to empty
      groups, so only case one starts red. Add one more case: a later source note lands after the sentence.
    - Component, both platforms, `RecipeIngredientsFields.rowEditor.test.tsx` and `.native.test.tsx`. Catalog
      unavailable with own foods: the first option comes before the sentence. With no own food: the sentence comes
      first.
    - Playwright, case D in `web/tests/e2e/ingredientListGeometry.spec.ts`. At rest the first option's top is inside the
      card, and no status line sits between the card's top and it. The catalog line follows the listbox and comes
      before the limit note. Keep the whole-row-on-scroll check. Do not assert that the label fits whole: its margin is
      about 2 px.
- **Amendments owed (the lead).** R1 and P1 item 1: the line leads only with no food found. Also P6's "One database
  group fails alone" row, P11's 1.3.2 line and the `entryCombobox.ts` module doc (lines 6 to 8). Also `props.ts`
  (`status`, `trailingStatus`) and the "Open" line in `compactHeightLayout.md` §4.4.

### V3-M3 · 3 · The food name gets whatever width is left (web) — rendered

- **Where:** `FR/form/RecipeIngredientsFields.tsx:394` (entry: `basis-full sm:basis-0`), `:444-456` (record: a read-only
  input on `rowField`, which is `flex-1`, so basis 0). `formSectionStyles.ts:23`.
- **Criterion:** parity. W-1's ruling, "The name keeps a full line below `sm`" (`ingredientStatusExplanation.md`, Web
  measurements), is not built. §3b (record mode is wrapping text) is not built, so H9 is still open. Nielsen #4: entering
  Change food reflows the row.
- **Observed:** A and B. A record name at 390 px shows about ten characters. USDA names keep their distinguishing words
  at the end (§3a), so two similar foods look the same.
- **Fix, feature:** the name takes the row's first full line at every width, in both modes. U26 and U27 added two fields, so
  §3c's premise that wide rows "have room" no longer holds. Recorded in `ingredientStatusExplanation.md`. The width floor in
  the primitive then only backs this up. Native already gives the name its own line (`formSectionStyles.native.ts:87`).

### V3-M4 · 3 · The active option is nearly invisible (web) — rendered

- **Where:** `Combobox.tsx:348`, `aria-selected:bg-pearl` only.
- **Criterion:** Nielsen #1 and #4. Not a 1.4.11 failure: _Understanding 1.4.11_ (fetched 2026-10-03) sets no contrast for
  a state shown only by a background change. The details dialog already shows the house answer: pearl plus a 2 px inset
  seafoam ring (`FR/details/VariantOption.tsx:67-69`).
- **Fix, primitive:** V3-4.

### Minor (2 or less)

| #     | Where                                                                                | Finding and fix                                                                                                                                                                                                                                                               | Belongs in  |
| ----- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| V3-m1 | `Combobox.tsx:74, 84`                                                                | The floor is `320` px, documented as 20rem, so the two part at a larger browser text size. Near the right edge it shrinks (E: 248 px) instead of sliding. Fix: V3-2.                                                                                                          | primitive   |
| V3-m2 | `UI/combobox/props.ts:21`, `Combobox.tsx:356`, `Combobox.native.tsx:143, 277`        | `tag` has no caller since S7.9, and P5 and L4 forbid a visible tag. Delete it from the contract, both leaves and their tests.                                                                                                                                                 | primitive   |
| V3-m3 | `FR/detail/AmbiguityReview.tsx:133-210`, `.native.tsx`                               | A remote pick on a review row shows no `Adding from {source}`, though P12 applies P8. The chips only dim. Fix: V3-9.                                                                                                                                                          | feature     |
| V3-m4 | `AmbiguityReview.native.tsx:283-289`, its toggle                                     | Native review chips are about 28 dp, with a raw `rgba` fill and `fontSize: 13`, not tokens. They now carry remote groups too. The toggle exposes no expanded state (4.1.2), while web has `aria-expanded`. Fix: `minHeight: 48`, tokens, `accessibilityState={{ expanded }}`. | feature     |
| V3-m5 | `FR/analytics/queryOutcome.model.ts:29-31`, `FR/hooks/useIngredientEntry.ts:347-349` | A remote pick is logged as a no-pick. The cook never sees it. Accepted: V3-7.                                                                                                                                                                                                 | wire, later |
| V3-m6 | `FR/hooks/useLineCommit.ts:193`                                                      | An adopt made offline is held in memory only. Accepted: V3-8.                                                                                                                                                                                                                 | none        |
| V3-m7 | `FR/components/FullScreenSheet.native.tsx:70`                                        | D10 from the read-surfaces pass is still open: the Data sources sheet slides with reduce motion on (2.3.3 is AAA).                                                                                                                                                            | primitive   |

## Passes run

- **Heuristic (Nielsen's 10):** findings above. P1's order, P2's "nothing moves" and P8's failure copy hold in source.
- **WCAG 2.2 AA, by number:** 1.3.1 pass (groups labelled, headings `role="presentation"`, native headers). 1.3.2 pass.
  1.4.3 pass (slate on white 5.24:1, charcoal on pearl 11.63:1, computed). 1.4.4 **fail** in case D (V3-M2). 1.4.10 pass
  at 320 px (E). 1.4.11 no failure (V3-M4). 2.1.1 and 2.1.2 pass. 2.2.2 pass (the loader never moves). 2.4.3 pass (focus
  stays in the field). 2.4.11 not applicable (V3-M1). 2.5.3 pass (`{name}, from {source}` and `Create my own food, opens
a form`). 2.5.8 pass (options 44 px web, 48 dp native). 3.2.2 pass. 3.3.1 pass. 4.1.2 pass on web, minor gap on native
  (V3-m4). 4.1.3 pass: one polite and one assertive region. The 1 s guard is wired (`useIngredientEntry.ts:70, 175`)
  and so is the 10 s budget (`ingredientSuggestionSource.ts:48`).
- **States:** every row of P6 is in `entryComboboxOf` (`FR/form/entryCombobox.ts:173-318`). P8's states are in
  `progressiveNotes.ts:151-179` and `rowCommitMessage.ts:242`. P12 defect (b) is fixed (`detail/model.ts`,
  `reviewShortlistStatus`).
- **Cross-platform (§3.6, ten points):** (1) Web desktop and phone browser, native iOS and Android. (2) Dispositions as
  P10 states, all kept. (3) First food right under the field on both. Web below `lg` fails: V3-M1. Native cannot, because
  the bar sits outside the scroller. (4) No hover, right-click or drag. (5) Labels and headings wrap. At 200% text the
  lines squeeze the list (V3-M2). (6) 320 px: no horizontal scroll (E). (7) Scroll budget as P10. (8) Keyboard open:
  item 7, unchanged, not checked on a device. (9) Escape on web, Cancel and back on native. (10) Rule placement: the
  placement, width, squeeze and highlight rules go in the primitive. The name width goes in the row.
- **Content:** copy matches P1 to P12 except the two deliberate changes below.
- **Deceptive-pattern screen:** run, none found.
- **Curated surfaces:** the read-surfaces pass's D1 to D9 and D11 are fixed in source: D1 `RecipeDetailBody.tsx:338`,
  D2 `VariantDetailsDialog.tsx:240, 244`, D3 `DataSourcesScreen.tsx`, D4 `useVariantDetailsDialog.ts:157`, D5
  `VariantDetailsDialog.tsx:256`, D6 `:325`, D7 `VariantOption.native.tsx:64`, D8 `VersionPreviewModal.tsx`, D11
  `legal/sources/page.tsx`. D10 is open (V3-m7). Not re-rendered this pass.

## Parity: changes made in the code that the spec must now follow

| Spec                                                   | Built                                                       | Cause                | Disposition                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| P6/P8: `sourceLimitedLater`, `sourceLimitReachedLater` | Dropped. `retryAt` is required (`foodSuggestions.model.ts`) | deliberately changed | Accept. Spec amended.                                             |
| P12: a row speaks "P7, per row"                        | A row speaks only what the list did not show                | ambiguous in spec    | Accept: N rows that open at once must not give N counts. Amended. |
| P9: "the bar paints over the popup"                    | The popup paints over the bar                               | wrong in spec        | Spec corrected. V3-1.                                             |
| P10: "the popup is as wide as its field"               | A 20rem floor                                               | deliberately changed | Accept, with V3-2.                                                |

## Owed by the lead (outside my four files)

The lead applied these on 2026-10-03: the tag clause left `rowEditorBlueprint.md` decision 1; plan 002's S7 row and
its pattern register record V3-1 and V3-2; curated U15's verification line carries the verdict; the pattern register
names the web `Wizard`'s ref sites and `@commise/ui/popup-insets`. Still owed: restoring `web/next-env.d.ts`, in the
final sweep.

## Hand-off

`staff-architect` BLUEPRINT for V3-1's mechanism first. Then the frontend implementer builds, test first. V3-1 to V3-5 go in
`@commise/ui/combobox`. V3-9 and V3-m4 go in `AmbiguityReview`. The name-width ruling goes in both row leaves.
Then a native pass on a device: render the list in flow, and run VoiceOver and TalkBack over P7's two announcements.

## What I did not check

- Native: nothing rendered, no VoiceOver or TalkBack. P7's two-announcement edge is still owed on a device.
- The details dialog hosted from the row editor (focus back to `⋮`) is covered by its component tests, not rendered here.
- My probe ran `next dev`, which rewrote `web/next-env.d.ts` to the dev type paths. I did not restore it.

## References consulted

Corpus: `critique-handoff.md`, `accessibility.md`, `cross-platform-translation.md`, `visual-systems.md` (iconography),
`interaction-motion.md`. Live: _Understanding SC 2.4.11_ and _Understanding SC 1.4.11_, both fetched 2026-10-03.
V3-M2a: `accessibility.md`, `content-design.md`, and _Understanding SC 1.3.2_, fetched 2026-10-03. It says more than
one order can be correct, and it names F1 and C27 (DOM order matches visual order).
Libraries read in `node_modules`: `@floating-ui/core` 1.8.0 (`flip`, `size`), `downshift` 9.4.0 (`scrollIntoView`).
