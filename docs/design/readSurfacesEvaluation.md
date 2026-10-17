# Read surfaces: EVALUATE (curated U14, U15 read surfaces, U25, R9)

⛔ **DESIGN EVALUATION. NOT PRODUCTION CODE.** This file reports findings. It changes no code and no other spec.

- **Mode:** EVALUATE. **Date:** 2026-10-02. **Agent:** `staff-ux-engineer`.
- **Scope:** the details dialog (U14), the read surfaces of U15 (read view, version preview, conflict view, parse
  review), the Data sources page (U25), and R9's filled buttons. The row editor, the ingredient search, the combobox
  and the pickers are out of scope. Other agents are still building them.
- **Standing:** I wrote the specs under test (`ingredientSpecialization.md` §S1 to §S19, R9). I did not write this
  code. So the criteria below are external where they can be: WCAG 2.2 AA by number, the mockup, and the plan's own
  verification lines.
- **Seen rendered:** no. Everything here is read from source. Each visual claim names the browser or device check
  it needs.
- **Inspection, not user evidence.** Every "the cook will" claim below is heuristic judgement, untested with users.

---

## 1. First: the read view does not open the dialog

You asked how the dialog opens from the read view. **It does not, on either platform.** The only host is the row
editor (`FR/form/RecipeIngredientsFields.tsx:784`, `.native.tsx:772`). Nothing in `FR/detail/` or
`web/src/components/recipes/RecipeDetailContainer.tsx` renders it or an `Add details` item.

That matches the UX spec: `ingredientSpecialization.md:326` says "The read view has no row action. The cook
changes details in the editor." Blueprint decision 7 agrees (`rowEditorBlueprint.md:13`).

Three other documents and one hook say the opposite:

- Plan U14, "Decided while building": "the rebind command on the read view" (`plan:1524`).
- Plan U15 took over a test for "the read view's commit port" (`plan:1541-1542`).
- Blueprint build step B7c: "the dialog host in the fields (form route) and the read view (command)"
  (`rowEditorBlueprint.md:17`).
- `FR/hooks/useReadViewLineCommit.ts:43` is built and exported (`FR/hooks/index.ts:81`). Nothing uses it.

**My call: keep §S5.** The read view is where the cook cooks (F3). A row action there adds controls to a reading
surface, and the editor already does the job. This is a two-way door: adding the entry later costs one host.

- Fix the plan text at `plan:1524` and `plan:1541-1542`, and blueprint B7c, to say the read view has no host.
- Send `useReadViewLineCommit` to `staff-code-quality`: delete it, or name the surface that will use it.
- **Flip:** the owner wants a cook to change details while reading. Then §S5 changes first, and the hook gets its
  host.

---

## 2. Verdict per surface

| Surface                            | Verdict                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U14 details dialog, web            | **Passes** U14's verification line: every state renders from the one machine. **One S2 owed:** the footer buttons do not fill below 640 px (D2).                                                                                                                                   |
| U14 details dialog, native         | **Passes.** One S1 (D7).                                                                                                                                                                                                                                                           |
| U15 read view, web and native      | **Does not pass U15's gate yet** ("parity at 320 px", `plan:1628`). The quantity floats away from the name on every variant-bound line (D1). The fix is size S. The gate also covers the editor surfaces, which this pass did not evaluate, so a fix to D1 alone cannot clear U15. |
| U15 version preview                | Passes. One S1 (D8).                                                                                                                                                                                                                                                               |
| U15 conflict view (diff and merge) | Passes. Each side shows its own dotted line, and the radio and group names carry the parts (`diffLabels.ts:183`, `:222`).                                                                                                                                                          |
| U15 parse review                   | Passes. It shows only the cook's parsed words (`FR/parse/ParseJobReview.tsx:91-92`). It owes no parts, because a parse binds nothing (`plan:1631`).                                                                                                                                |
| U25 Data sources, web              | **Passes the owner's rule** (sources in use only). One S2 owed (D3). U25's own verification line cannot pass as written (§4, item 3).                                                                                                                                              |
| U25 Data sources, native           | Passes the same rule. One S2 owed (D3, Android).                                                                                                                                                                                                                                   |
| R9: filter Sheet `Done`            | Passes on both platforms: primary, check icon, `width="fill"` (`FR/filters/RecipeFilterBar.tsx:411`, `.native.tsx:330-337`).                                                                                                                                                       |
| R9: web paste form                 | Passes: both buttons fill below `sm` and share a row from `sm` (`FR/parse/ParsePasteForm.tsx:100-106`). The `sm` row case is now tested (`variantSurfaceReflow.spec.ts:268`).                                                                                                      |

---

## 3. Defects, most severe first

Severity is 0 to 4: 1 cosmetic, 2 minor, 3 major, 4 must fix before release (`critique-handoff.md`). Nothing here
is 3 or 4.

### D1 · S2 · The quantity floats away from the name (read view, both platforms)

- **Where:** web `FR/detail/RecipeDetailBody.tsx:337` (`flex items-center`) and `:376` (the quantity is its own
  flex item, outside the text block). Native `RecipeDetailBody.native.tsx:305`, styles `:598-600`
  (`alignItems: 'center'`) and `:620`.
- **Criterion:** parity with mockup frame 1 (`variantDetailsMockup.html:235-239`, row markup `:1389`): the row is
  top-aligned and the quantity sits inside the name line. Also Gestalt proximity: "2 lb" and "beef brisket" are one
  phrase.
- **Observed:** a variant-bound line is now two lines or more (the name, then the dotted line). The row centres the
  quantity against that whole block. So "2 lb" sits about half a line below "beef brisket". When the parts wrap,
  "2 lb" lines up with the parts instead of the name.
- **Interpretation:** the quantity reads as part of the details. Before U15, most lines were one line, so
  centring did no harm. U15 made it visible on every variant-bound line.
- **Already recommended:** E2's re-check asked for this in U15, size S (`ingredientSpecialization.md:1683`). It was
  not built.
- **Fix:** put the quantity inside the flowing text block, before the name, on both platforms. Top-align the row,
  and give the checkbox a top margin so its box lines up with the first line, as the mockup does.
- **Browser and device check:** on a two-line variant row, measure the quantity's top against the name line's top
  at 320 and 390 px. Expect about half a line today, and 0 after the fix.

### D2 · S2 · `Remove details` does not fill the footer below 640 px (dialog, web)

- **Where:** `FR/details/VariantDetailsDialog.tsx:235-247`. Both footer buttons use the default `width="auto"`.
- **Criterion:** §S8.2 Footer: "Full width below 640 px" (`ingredientSpecialization.md:685`). §S10: the footer is in
  the thumb zone.
- **Observed:** web `auto` wraps the button in an `inline-flex` span. A column parent stretches the span, not the
  button (R9's own measurement, `rowEditorOpenDecisions.md:952-954`). So below 640 px, `Remove details` sits at the
  bottom left at content width. In `detailsNoneLeft`, `Close` and `Remove details` stack as two short buttons at the
  left edge. Native fills, because a native column stretches its children (`.native.tsx:303`).
- **Interpretation:** web and native differ for no stated reason. The web footer looks unfinished.
- **Fix:** add `width="fill"` to both buttons at `:239` and `:243`. From `sm` the parent is a row, so they keep content
  width and stay end-aligned (R9's rule).
- **Class:** this is the second Sheet footer that needed `fill` (the filter `Done` was the first). If a third
  appears, give the Sheet a footer-actions slot that fills by default.
- **Browser check:** at 390 px, open the dialog in `edit` mode and compare the button's width with the footer's.

### D3 · S2 · `Try again` on Data sources loses focus (both platforms)

- **Where:** `FR/dataSources/DataSourcesScreen.tsx:33-35` and `.native.tsx:33-35`. A retry turns the view to
  `loading` (`FR/hooks/queryReadState.ts`, "a fetch in flight is `loading`"), so the error view and its button
  unmount.
- **Criterion:** SC 2.4.3 Focus Order (web). SC 4.1.3 Status Messages (native).
- **Observed, web:** the pressed button unmounts. Focus drops to `<body>`, the start of the page. A second failure
  is announced (`role="alert"`), but the keyboard user must find the button again.
- **Observed, native:** the reading cursor is lost with the button. The new error message mounts with its text
  already inside a `LiveRegion` (`DataSourcesLoadError.native.tsx:30`). `LiveRegion`'s own contract says such a
  region "is not reliably spoken" on Android (`UI/liveRegion/LiveRegion.native.tsx`, module doc). iOS announces it.
- **Interpretation:** on Android, TalkBack can stay silent after a failed read.
- **Requirement for the fix:** two things, both platforms. Focus (web) and the reading cursor (native) stay on Try
  again, or come back to it. And **every failed attempt is announced, the second one too.** Today the second failure
  is heard on web only because the alert node mounts again. A fix that keeps the error view mounted removes that.
- **Fix, in the screen only, one of two ways:**
    1. Keep the error view mounted with `Try again` `busy` (the house `busyControlProps` rule). Then announce each
       settled failure again: give the alert a new key per attempt on web, and advance a cursor signal per attempt
       on native (design decision V48).
    2. Keep today's unmount. Recover focus as the dialog does: while it loads, hold focus on a stable element. On the
       error's return, move focus to Try again with `focusOnArrival`. On native, move the cursor to the message
       per V48 on each entry to `error`.
- ⛔ Do not change `queryReadState`. The dialog depends on its order, and `focusOnArrival` already recovers focus
  there.
- **Device check:** TalkBack on Android 15 and VoiceOver on iOS. Fail the read and hear the message. Press Try
  again. Fail again and hear the second failure. Find the cursor on Try again.

### D4 · S1 · The search-result announcement repeats on every key press (dialog, both)

- **Where:** `FR/details/detailsText.ts:202`. `noMatches` is not debounced, and its text holds the query.
- **Criterion:** §S8.5 (the count waits 500 ms after the last key press). Nielsen #8.
- **Observed:** while nothing matches, each key press changes the polite region's text, so a screen reader starts
  "Nothing matches …" again on each letter.
- **Fix:** debounce `noMatches` with the count, through the same `useDebouncedValue` in `useVariantDetailsDialog.ts`.

### D5 · S1 · The loading text is read twice (dialog, both)

- **Where:** web `VariantDetailsDialog.tsx:254` and `:370`. Native `.native.tsx:143` and `:246`.
- **Observed:** "Loading details…" is a visible paragraph and also the text of the hidden status region. A
  screen-reader user who reads the dialog line by line meets it twice. On Android the hidden node is a swipe stop
  (`LiveRegion`'s documented cost).
- **Fix:** hide the visible paragraph from assistive technology, or drop it and let the status region show
  (§S12 row 17 asks for the text "in a `role="status"` region", not twice).

### D6 · S1 · Group headers are paragraphs inside the listbox (dialog, web)

- **Where:** `VariantDetailsDialog.tsx:317-323`. The header is a `<p>` inside each `role="group"`.
- **Criterion:** SC 1.3.1. The W3C APG grouped listbox example gives the header `role="presentation"`.
- **Observed:** a `<p>` is a paragraph in the accessibility tree, inside a listbox. A listbox holds only groups and
  options. Some screen readers can read the header as an extra item, or count it in "1 of 40".
- **Fix:** `role="presentation"` on the header. Its `aria-labelledby` reference still names the group.
- **Check:** the NVDA and VoiceOver pass that U14 already owes (`plan:1556-1557`).

### D7 · S1 · The native row's parts basis does not grow with text (dialog, native)

- **Where:** `FR/details/VariantOption.native.tsx:33` and `:85`. `PARTS_BASIS` is a fixed 192 dp.
- **Criterion:** §S8.2 Row: "The basis is in rem, so it follows text size with no breakpoint."
- **Observed:** at a large font scale, the calorie text stays beside the parts longer than on web. The parts then get
  a narrow column of large text.
- **Fix:** multiply by the font scale (`useWindowDimensions().fontScale`).

### D8 · S1 · The version preview orders a line differently from the read view

- **Where:** `FR/versions/preview.ts:117` puts the preparation inside the line text. `VersionPreviewModal.tsx:161-175`
  then shows the `cannotRestore` marker, then the dotted line. Native `.native.tsx:154-160` is the same.
- **Criterion:** Nielsen #4, consistency. The read view puts the dotted line before the cook's words (§S5,
  `ingredientSpecialization.md:322-323`).
- **Observed:** the read view says name, details, preparation. The preview says name, preparation, the marker, then
  details. The marker that refers to the whole line sits between the line and its details.
- **Fix:** render the dotted line straight after the name text, and the marker last.

### D9 · S1 · The native recipe note is smaller than web's

- **Where:** `RecipeDetailBody.native.tsx:543` and `:547-548` use `fontSize.overline` (11). Web uses `text-caption`
  (12, `RecipeDetailBody.tsx:572`).
- **Criterion:** §S15's web form, and one type scale on both platforms.
- **Fix:** `fontSize.caption` on both native styles.

### D10 · S1 · The Data sources sheet slides even with reduce motion on (native)

- **Where:** `FR/components/FullScreenSheet.native.tsx:70`, `animationType="slide"` with no reduce-motion check.
- **Criterion:** the house rule in §S8.1 Motion (`useReduceMotion`). SC 2.3.3 is AAA, so this is not an AA failure.
- **Fix:** in the primitive, not the page. `FullScreenSheet` has three other consumers.

### D11 · S1 · The page title and description are not localised (web)

- **Where:** `web/src/app/[locale]/legal/sources/page.tsx:9-10`. It also spells "licences", where the page says
  "License" (§S19 chose US English).
- **Criterion:** CLAUDE.md "Localize user-facing strings". The browser tab and a shared link show this text.
- **Class:** every `page.tsx` here hard-codes its metadata (for example `settings/page.tsx`). The fix is one
  `generateMetadata` helper that reads the message catalogue, not a change to this page alone.

---

## 4. Specs that are wrong or contradict each other

Each item names the text that wins.

1. **The read view host** (§1 above). §S5 and blueprint decision 7 win. Fix `plan:1524`, `plan:1541-1542` and
   blueprint B7c.
2. **The import review shows parts.** `ingredientSpecialization.md:235` (§S1), `:259` (§S3), `:926-927` (§S12 rows 5
   and 6), `:797` (§S8.9), and the plan's statechart note (`plan:604`) all say it does, or that it hosts the dialog.
   U15 decided otherwise: a parse binds nothing (`plan:1631`), and blueprint decision 7 says import review has no
   host. U15's decision wins until the owner reopens U28. Mark those spec lines as "on the recipe view once the line
   binds".
3. **U25 lists "every register entry".** `plan:1750` and `plan:1759`. The owner ruled on 2026-10-01 that the page
   lists only the sources in use. The wire says so (`FS/src/foods/dataSources.schema.ts:5-6`). U25's verification
   line cannot pass as written. Amend it to "every source in use".
4. **`licenceFallback` and two blocking questions are closed.** The wire now requires `licenceName` and
   `attributionLanguage` (`dataSources.schema.ts:31` and `:37`). So the fallback at `ingredientSpecialization.md:1305`,
   `:1343` and `:1455` can never show, and questions 4 and 5 (`:1799-1801`) and E11 are answered. Remove the key from
   §S19 and close the questions. Mockup frame 20 still draws the fallback for Japan.
5. **"A route change puts focus on the h1 (the house rule)."** `ingredientSpecialization.md:1271`. No such rule exists
   in code. Other pages focus their `h1` only on a signal, and the settings `h1` never takes focus. Either build it
   once in the app shell, or drop the claim. First, record in a browser what Next.js does on this navigation
   today.

---

## 5. What this pass did not check

### Out of scope here, because the dialog's only host is the row editor

These belong to §S8.8 and were not verified. The row editor's EVALUATE owes them.

- The commit and removal announcements (`statusAdded`, `statusChanged`, `statusRemoved`).
- Focus back on `⋮` after every close route, on web.
- The native close count that returns the reading cursor.
- The commit port: one rebind for a stored line, the form value for a new one.

### Browser checks owed

- D1 and D2 measurements (above).
- Where focus lands after following "Data sources" from the read view (§4 item 5).
- The details dialog at 320 × 640 and at 640 × 360 with 200% text. `variantSurfaceReflow.spec.ts` covers the read
  view, the version preview and the filter Sheet, but not the dialog or the conflict view. U15 asks for "each
  surface".
- The Data sources page at 640 × 360 with 200% text. `dataSources.spec.ts:78` tests 320 px only.

### Device checks owed

- D3 on TalkBack and VoiceOver.
- D6 with NVDA and VoiceOver on Safari (already owed by U14).
- TalkBack on the Data sources sheet: does it read "Data sources" twice? `FullScreenSheet` labels its surface
  (`FullScreenSheet.native.tsx`, the `View` with `accessibilityLabel`) and the page also shows the title.
- `accessibilityLanguage` on the credit is iOS only (`DataSourceCard.native.tsx`). Android reads a French or
  Japanese credit in the app's language. The code records this. React Native cannot fix it today.

---

## 6. States, per surface

"Partial" does not apply to the dialog or the Data sources page: each is one read that settles whole.

| Surface         | Loading                                        | Empty                                        | Error                               | Offline                          | Success                                                                  |
| --------------- | ---------------------------------------------- | -------------------------------------------- | ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Dialog          | `loading`, 3 skeleton rows                     | `noVariants`, or `detailsNoneLeft` in `edit` | `loadFailed` + `retry`, also on 202 | `OfflineReadSlot`, `readOffline` | host-owned, not checked (§5)                                             |
| Data sources    | `dataSources.loading`, 3 cards                 | `dataSources.empty`                          | `loadFailed` + `retry` (D3)         | `OfflineReadSlot`, `readOffline` | cards in the service's order                                             |
| Read view       | owned by the existing page                     | a root-bound line shows the name only        | owned by the existing page          | owned by the existing page       | dotted line under the name (D1)                                          |
| Version preview | owned by the existing modal                    | a root-bound line shows the name only        | owned by the existing modal         | owned by the existing modal      | the parts the version froze, so a retired variant still shows (R29)      |
| Conflict view   | not applicable: it opens on a settled conflict | a root-bound side shows its value only       | owned by the existing view          | owned by the existing view       | each side's own frozen parts, and the parts in the radio and group names |

The keys these surfaces use carry the `en` text that §S11 and §S19 specify (`FR/messages.ts:710-745`, `:880-882`,
`FR/dataSources/messages.ts`). The one exception is `licenceFallback` (§4 item 4).

---

## 7. Passes run

- **Heuristic (Nielsen's 10):** findings D4, D5, D8. Cognitive walkthrough not run: no first-use flow is in scope.
- **WCAG 2.2 AA, checked by number:** 1.3.1 (D6), 1.4.1, 1.4.3, 1.4.4 (D7), 1.4.10, 1.4.11, 2.1.1, 2.1.2, 2.4.3 (D3),
  2.4.4, 2.4.6, 2.4.7, 2.5.3, 2.5.8, 3.1.2, 4.1.2, 4.1.3 (D3, D4). Contrast figures are the token file's own
  (`UI/tokens/colors.ts`). Not checked: `forced-colors`, RTL, a real screen reader.
- **Cross-platform (`cross-platform-translation.md` ten-point pass):**
    - Both platforms are named. The dispositions match §S10 and §S18.
    - Primary actions sit by reach. D2 breaks this on web.
    - No affordance needs hover.
    - The longest strings wrap, and none is clamped.
    - Tests cover 320 px for the read surfaces, but not for the dialog (§5).
    - The scroll budget is §S10's. The Sheet owns the keyboard-open rule.
    - Each platform has its dismiss routes.
    - Class fixes are named: D2, D10 and D11.
- **Deceptive patterns:** none. `currentRetired` and `noneLeft` state a real cost in neutral words.
- **Parity against the mockup and specs:** D1, D2, D7, D8, D9, and §4.

## 8. Preferences, not binding

- A variant change shows as "1 added, 1 removed" in the version compare view, because a rebind changes the line's
  identity. That matches §S1's rule for the conflict view, but a cook can read it as two edits. Outside U15's list.
- On iOS, the only way out of the full-screen Data sources sheet is the × at the top end, a hard reach on a large
  phone. That is the platform convention for a full-screen modal, so I recommend no change.

## References consulted

`ux-mode-playbooks` (EVALUATE). `ux-design-corpus`: `critique-handoff.md` (severity scale, parity order),
`accessibility.md` (SC list, focus at transitions), `cross-platform-translation.md` (the ten-point pass). The W3C
APG grouped listbox pattern is cited from the spec's own §S9, not fetched again.

## Artefacts written

- `docs/design/readSurfacesEvaluation.md`: this evaluation. Nothing else was edited.
