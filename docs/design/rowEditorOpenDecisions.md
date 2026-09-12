# Row editor: the open experience decisions (plan 002 V1 B6 to B8, curated U15)

**Mode:** SPECIFY, with one short DESIGN step (item 1, the trailing row's authoring control).
**Author:** `staff-ux-engineer`, 2026-10-02.
**Status:** design artefact. It is not production code.

This file decides the experience questions that `docs/design/rowEditorBlueprint.md` left open (its line 29). It also
decides item 10, which the lead added. The **S7 list contract** at the end decides the progressive search list. That
list replaces the "Search USDA" button (owner ruling 2026-10-02, ADR-0055). This file changes no system choice of the
blueprint. Some decisions here force a system change. Each one is listed under **System changes forced**, and its item
names it again.

**Standing.** I wrote `ingredientStatusExplanation.md` and `ingredientSpecialization.md`. So this file amends my own
work, and item 9 reverses one of my own table cells. I did not write the code. I saw nothing rendered. Every native
claim is reasoned from source, and each item names the device check it owes.

**Binding inputs, read in full:**

- the blueprint, all 29 lines.
- `ingredientStatusExplanation.md` §2a to §2d, §3a, §4b, §5, §8a to §8e, SPECIFY.1 to SPECIFY.4, and "V1 sign-off
  (2026-10-01)" (lines 890 to 963).
- `ingredientSpecialization.md` §S1, §S7, §S8.6 to §S8.9, §S12 to §S14, §S18.
- plan 002 R17, R26 and R27 (`docs/plans/2026-09-20-002-…-plan.md:162, 176, 177`).
- the curated plan's U14 and U15 (`docs/plans/2026-09-26-001-…-plan.md:1494-1600`).
- ADR-0045 lines 256 to 268, and the code at the paths cited below.

**Paths.** `FR` = `packages/apps/commise/features/recipes/src`. `UI` = `packages/apps/commise/ui/src`. `WEB` =
`packages/apps/commise/web/src`. `MOB` = `packages/apps/commise/mobile/src`.

---

## Owner questions (these belong to the owner, and why)

**O1. Does the correction control survive?** This is "Always use this for “{phrase}”"
(`WEB/components/recipes/IngredientPicker.tsx:209-224`).

**Owner ruling (2026-10-02):** retire it. The rebind command is the one place a correction is taught.

- _Why it is the owner's:_ removing it removes a shipped capability (the resolution plan's U14, R19 and R20). That is
  product scope.
- **I recommend retiring it.** Its premise is gone. The picker's docstring says it exists because the corrections table
  "had a writer and no caller" (`IngredientPicker.tsx:23-26`).
- The rebind command is now that caller. It records the correction with the line's own phrase (ADR-0045:259-262). That
  phrase is the key R17 is about.
- The control's key is a typed query. It is often a prefix such as "chick". A mapping on that key becomes everyone's
  after one more cook agrees (plan 002 R19).
- **What retiring it costs.** The command records a correction only for a line that carries a phrase: an imported
  source phrase, or a failed name (ADR-0045:259-262). So a Change food on a hand-typed line that matched the wrong
  food teaches nothing. Nothing on the create form teaches either. The corrections store then learns from imports and
  failures only.
- If the owner keeps it, item 3 gives it its one home.

**O2. The hourly budget figure.** Food allows 120 source calls per cook per hour. **Owner ruling (2026-10-02):** keep 120. The code marks the figure as a
proposal for the owner (`packages/services/food-service/src/common/throttle/throttle.config.ts:47-60`).

- _Why it is the owner's:_ it is a product limit on cooks.
- Item 10's copy never states the figure. So the copy stays the same for any figure.

**O3. The reach of R26.** Does R26 ("never in a popover") cover the suggestion list?

**Owner ruling (2026-10-02):** no. R26 covers a line's own ⋮ menu only, so `Create my own food` is the last option of
the trailing row's list.

- _Why it is the owner's:_ one reading of the answer reverses a recorded owner ruling (plan 002:176, and its origin
  `ingredientStatusExplanation.md` §5:292).
- Item 1 commits to a placement for the trailing row's `Create my own food` that is safe under the broad reading.
- **My preference, non-binding:** the last option of the trailing row's list. It sits beside the "no match" message,
  and it needs no scroll.
- If the owner says R26 governs a line's actions only, move it into the list. Nothing else changes.

**O4. Row 8 against plan U12.** U12 says "A root with at least one live variant shows `Add details`"
(`docs/plans/2026-09-26-001-…-plan.md:1409`). It names no exception for a row state.

**Owner ruling (2026-10-02):** item 9 stands. A `NEEDS_REVIEW` root-bound line offers no `Add details`.

- _Why it is the owner's:_ item 9 narrows that plan rule for row 8 (`NEEDS_REVIEW`). That changes a plan requirement,
  not only my own §S7 cell.
- Item 9's decision is the committed default.
- If the owner keeps U12 as written, `Add details` goes back on row 8. Then blueprint decision 4's extension applies:
  `refsOf` reads withheld lines, and the consumer keeps their figures out of every total.

---

## System changes forced (for `staff-architect` and the lead)

The blueprint says the combobox props stand "as is plus `onFocus`" (decision 1, line 7). These decisions need more.

1. **Option decoration.** `ComboboxOption` has only `key`, `label` and `busy` (`UI/combobox/props.ts:12-22`). The
   committed specs need more:
    - a result's dotted line under its name (`ingredientSpecialization.md` §S2:248-253, §S13 P5:964).
    - an accessible name that says more than the visible text: `{name}, your food` (L4), `{name}, from {source}` (S7
      list contract P5) and `Create my own food, opens a form` (P1).

    Add `detailParts?` (drawn by `VariantPartsLine`) and `accessibleName?`. Both are presentation data, not controls.
    So the APG rule that option children are presentational still holds. The built `tag?` served only the live
    option's `Slow` tag. S7.9 deletes that option, and a remote hit carries no tag (P5). So `tag?` goes in S7.9.

2. **One polite channel and one assertive channel.** `UI/combobox/Combobox.native.tsx:126-128` speaks
   `countAnnouncement`. Lines 144 and 153 also make the status text a live region. So a status can be spoken twice.
   The status text stops being a live region. The primitive gains `alertAnnouncement?` (assertive) beside
   `countAnnouncement` (polite). The same rule applies on web.
3. **Status lines after the listbox** (`trailingStatus?`), for the progressive answer's source notes and its loader
   (S7 list contract P3, system change 11). Status text sits outside `role="listbox"`. A listbox owns only `group` and
   `option` elements.
4. **Two exit controls in the primitive.** One is a `Cancel` text button for a row in Change food. The other is a
   native clear button for the trailing row and rows 1 and 2. Both are new combobox props (item 4).
5. **The row policy takes a `changing` input.** During Change food, the row has no `Change food`, `Add details` or
   `Edit details`. V1 sign-off Rule 1 (line 922) says an action that does not apply is absent, never greyed.
   `FR/form/ingredientRowPolicy.ts` decides this, not the leaves.
6. **`ActionMenu` changes in three ways.**
    - It takes a focus request (`focusRequested` and `onFocusRequestHandled`, the `Popover` shape). Focus then returns
      to `⋮` after a Change food cancel, long after the menu closed (item 4).
    - An open menu keeps the items it opened with (item 9).
    - A press on `⋮` does nothing while a chosen item waits to run (item 8).
7. **A distinct wire signal for "this cook's limit"** (item 10). Built. The apps read food's own `429
REQUESTER_LIMIT_REACHED` with `retryAfterSeconds`, because they call food directly. Recipe's resolve relay, which
   turned it into `503 SOURCE_BUSY`, is deleted (plan 002 S7, 2026-10-03).
8. **Escape with the list closed.** Blueprint decision 3 keeps the text there through downshift's `stateReducer`. Item 4
   needs Escape there to abandon the entry instead: clear the trailing row, restore a row's own name, or cancel Change
   food. The host decides which, so the reducer passes that Escape to the host.
9. **The cook's limit is held once, outside the query.** A per-query state forgets the limit at the next keystroke,
   and row 6's candidate pick never sees it. So one value, "limited until {time}", lives above every surface, for the
   session. Every remote pick and every candidate pick read it (item 10). A food refusal sets it, and so does a source
   frame that reports the cook's limit (S7 list contract P8).
10. **Not forced:** `refsOf` stays the same. Item 9 keeps `Add details` off row 8. So blueprint decision 4's conditional
    extension (line 10) does not apply.
11. **The trailing lines and the loader** (S7 list contract P3). `trailingStatus` becomes an ordered list of
    `ComboboxStatus` lines, drawn after the listbox in that order. A `loading` line is one line: a still glyph and its
    label. It is never placeholder rows, and it never moves. The editor stops passing a `loading` status before the
    list. If no other host passes one, the placeholder rows go from both leaves.
12. **The web popup holds still** (S7 list contract P9). As it opens on a text, it picks its side, once. It picks
    inside the space that the host's fixed and sticky chrome leaves. The host passes those insets, and floating-ui's
    collision padding applies them. The chrome stacks above the popup. A popup that opens above its field takes its
    full height at once, so content that arrives later fills it from the top down.
13. **Four needs on S7's wire** (ADR-0055 point 9). The architect names the shapes.
    - The database frame says, for each of its two groups, answered or unavailable. So each group can fail alone.
    - Every remote frame names its source by register id. The apps read the display name from the register through
      `useDataSources` (`dataSources.schema.ts`, `shortName` and `name`). So the wire carries no name.
    - A frame for the cook's limit carries the seconds until that limit ends, which the app turns into a time when
      the frame arrives, as it reads every other `retryAfterSeconds`.
    - A remote hit's name is the name its root will carry after the pick. So a pick never renames what the cook chose.

---

## Item 1. Where the picker's orphaned surfaces go

The picker has **six** triggers, not five. The blueprint's list (decision 2, line 8) omits the `name` pick. That is the
picker's primary button, "Find nutrition for “{query}”" (`IngredientPicker.tsx:462-470`, `findNutrition`). It is the
`{ kind: 'name' }` arm of `IngredientPick` (`FR/hooks/lineCommit.ts:30`).

**Decision.** _The list holds every way to fill this name. A line's icon column holds every action on the line._

| Surface                                 | Decision                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disambiguation** (row 6's candidates) | ⛔ **The panel never opens by itself.** A pick that lands `UNRESOLVED` commits as it is (blueprint decision 2). See the focus rules below.                |
| **The `name` pick** ("Find nutrition")  | The **first option** of `Not listed?`, the group after `Food catalog`.                                                                                    |
| **`addFreeform`** (the `declared` pick) | The **second option** of `Not listed?`. Its new text is "Use “{query}” as written, without nutrition".                                                    |
| **Remote results** (U29's live search)  | **No option and no button.** Each remote source's foods arrive by themselves, as a group `From {source}`, after `Not listed?` (S7 list contract P1).      |
| **The authored-food form**              | **A Sheet** (`@commise/ui/sheet`) on both platforms. It is never inline. The Sheet's name field shows the typed text, and the cook can edit it (§5a:308). |
| **The correction control**              | The owner's (O1). If it survives, item 3 places it.                                                                                                       |

**Disambiguation, focus.**

- From the trailing row, focus stays in the emptied trailing combobox (§2d:149, the F1 loop). The status line says the
  new line needs a choice.
- From a row in entry mode, focus goes to that row's glyph (§2d:148). That glyph is the candidates trigger. So one Enter
  or one tap opens the panel.

**Why the panel does not open by itself.** W3C's _Understanding SC 3.2.2_ (fetched 2026-10-02) calls a choice of option
"changing the setting". It also names a focus move to "a newly opened modal dialog" as a change of context. On native,
row 6's panel is a bottom sheet. An unasked panel also breaks the F1 loop at each ambiguous pick.

**Remote search runs with every search.** The owner ruled it law on 2026-10-02 (plan 002 R62, ADR-0055): no button.
Typing and arrow keys still never commit a line (3.2.2).

**The order of `Not listed?`.**

1. Find nutrition comes first, because §5a:307 names fixing first.
2. Use as written comes second. It is cheaper to undo than a new food.

`Create my own food` is not in this group. On the trailing row it is the list's last option, and it arrives once the
answer ends (S7 list contract P1). So a cook sees every food the search found before the costliest way.

**Where `Create my own food` opens from.**

- On a line: from that row's `⋮ → Create my own food` (policy rows 2, 4, 9 and 12).
- On the trailing row: from the list's last option (the DESIGN step below, settled by O3).

**The authored-food Sheet: focus and close.**

- On open (web), focus goes to the name field. On native, the reading cursor goes to the title at `onShow`.
- After a success from the trailing row, focus returns to the emptied trailing combobox (the F1 loop).
- After a success from a row's `⋮`, focus goes to that row's glyph (§2d:148).
- After Cancel or any close, focus returns to where the cook opened it: the trailing combobox, with its text, or the
  row's `⋮`.
- A success says `statusAuthoredAndLinked` or `statusAuthoredDuplicateLinked` (SPECIFY.2:576), polite.
- A failure stays in the Sheet with the draft kept (`statusAuthorFailed`, SPECIFY.2:577), assertive.
- The Sheet's close button is named `ingredientCreateFood.close` = `Close new food form` (new). Its title stays
  `ingredientCreateFood.formTitle`.

**DESIGN step: the trailing row's `Create my own food`.** I looked at three placements.

- (a) The last list option. This is best for the cook. But it is an action that opens a dialog from a list of values,
  which is unclear under 3.2.2. It is also open to the R26 objection (O3).
- (b) A control in the trailing row's icon column. No add-food glyph exists (`FR/form/icons.tsx:33-55`). An icon beside
  "Add an ingredient" also reads as a second add button.
- (c) A tertiary text button directly under the field.

**Committed: (a)**, because the owner's answer to O3 removed (a)'s R26 objection.

- It is the list's last option on the trailing row only. A row reaches it through its `⋮`.
- It shows only while the trailing field holds text at the search minimum or longer (`MIN_SEARCH_QUERY_LENGTH`).
- The form opens on the typed text with its leading and trailing spaces removed. Spaces inside stay. The cook cannot
  see an edge space, and one stored there makes a second spelling of the same food. Endorsed as built
  (`FR/form/rowEntryField.ts:117`, 2026-10-03).
- It arrives once the answer ends, after every food the search found (S7 list contract P1). Authoring a food the
  catalog or a remote source already holds splits one substance in two (§5a).
- **3.2.2.** Choosing it opens a modal Sheet, which _Understanding SC 3.2.2_ counts as a change of context. Its
  accessible name says so before the cook chooses it: `createOwnFoodOptionName` = `Create my own food, opens a form`.
  The name starts with the visible text (2.5.3).
- (b) and (c) are not built. Option (c)'s known cost, a button the open list covered on web, goes with it.

**States.** Rows 1 to 13 of SPECIFY.1 do not change. New states:

- a trailing-row pick that lands `UNRESOLVED`.
- a pick in flight (the field is busy, and the text stays).
- a failed pick (the text stays, with an alert).
- `Create my own food` shown or absent.

**Copy** (`RecipeFormMessages`, `FR/form/messages.ts`, `en`):

| Key                                                                                                                                                                                             | `en`                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ingredientSuggestionsMoreHeading` (new)                                                                                                                                                        | `Not listed?`                                                                     |
| `ingredientEntryFindByName` (moved from `WEB/i18n/messages.ts:454`, `picker.addByName`, text unchanged)                                                                                         | `Find nutrition for “{query}”`                                                    |
| `ingredientEntryUseAsWritten` (new, replaces `picker.addFreeform` at `:459`)                                                                                                                    | `Use “{query}” as written, without nutrition`                                     |
| `ingredientEntryFindByNameFailed` (replaces `picker.addByNameError` at `:456`)                                                                                                                  | `We couldn’t add “{query}”. Try again, or use it as written.`                     |
| `ingredientAddedNeedsChoice` (new). `{name}` is the glyph label's own value (`triggerFood`, `RecipeIngredientsFields.tsx:157-159`), never the typed text, so the sentence names a real control. | `Added {name}. It could be more than one food. Use “About {name}” to choose one.` |
| `ingredientSuggestionsAuthoredHeading` (S5 list contract, replaces `ingredientSuggestionsOwnHeading`), `ingredientSuggestionsCatalogHeading` (moved, unchanged)                                 | `Your foods`, `Food catalog`                                                      |
| `ingredientCatalogUnavailable` (S5 list contract, reworded)                                                                                                                                     | `The food catalog is unavailable right now, so only your foods were searched.`    |
| `ingredientAuthoredUnavailable` (S5 list contract, new)                                                                                                                                         | `Your foods are unavailable right now, so only the food catalog was searched.`    |
| `ingredientEntryAddingByName`, `ingredientEntryAddingFromCatalog` (moved from `:455` and `:452`, unchanged)                                                                                     | `Finding nutrition`, `Adding from the food catalog`                               |
| `createCustomFoodIconLabel` (SPECIFY.2:557, unchanged)                                                                                                                                          | `Create my own food`                                                              |

Shared `recipeMessages` (`FR/messages.ts`): the remote search's keys are in the S7 list contract's copy table. They
replace `ingredientLiveSearch`, which S7.9 deletes with the live option.

⛔ **One concept, one word.** `ingredientCreateFood.action` (`FR/messages.ts:736`, "Create your own food") retires with
the picker, its only reader. The action is `Create my own food` on every surface.

⛔ **Four strings name a control this design deletes ("custom ingredient").**

- `noResults` goes with the live option (S7.9).
- The web picker's `addByNameError` (`WEB/i18n/messages.ts:456`) is replaced above.
- `terminalNotice` (`:460`) and `disambiguateEmpty` (`:464`) retire with the picker. Row 6's panel gets its own empty
  state in B7.
- The mobile copies of these strings retire too.

**Accessibility (WCAG 2.2 AA).**

- 3.2.2: no pick opens a panel or a sheet.
- 2.4.3: focus targets follow §2d.
- 4.1.3: the `UNRESOLVED` outcome goes to the polite channel. A failed pick goes to the assertive channel.
- 2.5.3: each option's accessible name starts with its visible text.
- 2.5.8: options are 44 × 44 CSS px on web and 48 × 48 dp on native (§SPECIFY.3:598).
- 1.3.1: `Not listed?`, each `From {source}` and `None of these?` are labelled `role="group"` elements on web, and
  header-role text over their rows on native.

**Web and native.**

- Groups, order and labels: **kept**, the same on both.
- The authored-food Sheet: **moved**. It is a Radix dialog on web (full screen below 640 px) and a bottom sheet on native.
  That is the details dialog's container (§S10:815).
- Remote groups: **kept**, in the same place on both. They have no Close and no Try again. Escape or a blur closes the
  whole list, and a new text asks again (S7 list contract P10).

**Owner:** O1 (the correction control) and O3 (the reach of R26). Nothing else here.

---

## Item 2. The ways to fill a name are list options

**Decision: options, on both platforms.** This covers Find nutrition, Use as written and `Create my own food`. Remote
search has no option (S7 list contract).

- The APG combobox pattern takes "the popup, and the popup descendants" out of the page Tab sequence. DOM focus stays on
  the combobox (W3C ARIA APG, _Combobox Pattern_, fetched 2026-10-02).
- So a keyboard user never reaches a button inside the list.
- A button outside the list sits away from the results it produces. On web, the open list also covers it.
- Prior art puts "Create “x”" as the last row of a picker list (GitHub labels, Linear).
- Native has no listbox semantics. Its options are buttons in the same order (§S10:818).

**The states of remote search** are the S7 list contract's P6 table. The live option and its states (§S14 L1 to L9)
go in S7.9.

**Three edge rules.**

- Below the search minimum, the list shows only `ingredientSearch.tooShort` and no options (§S13 P2:961).
- `Not listed?` appears once the database part of the answer settles: answered, failed, out of time, or parked
  offline (S7 list contract P2). It never waits for a remote source.
- If the database part fails or is offline, the `Not listed?` group stays. A write is never refused ahead of time
  (§S13 P8 and P9).

**WCAG.**

- 2.1.1: arrows, Enter and a tap reach every option.
- 3.2.2: typing and arrow keys never commit a line, and no arriving frame does.
- 4.1.2: each option has `role="option"`, with `aria-disabled` while busy.
- 4.1.3: S7 list contract P7.

**Owner:** no.

---

## Item 3. The trailing add row

**What "the teach control" was.** It was the correction control of O1 in the deleted picker. It wrote through
`FR/hooks/useIngredientCorrection.ts` with surfacing `ingredient_picker`; both went when the owner retired the control
(O1, 2026-10-02). It sat inside each suggestion row. An
option cannot hold a control, so it cannot move into the list (blueprint decision 2).

**Its one home, for a yes on O1.**

- It is a post-pick offer in the row's status line, beside "Added {name}".
- Its text is `recipeCorrectionMessages.teachAction` (`FR/correction/messages.ts:45`).
- It shows only after a pick that meets all three conditions below:
    - the pick went the draft route and named a food (`catalogFood` or `admitted`, `commitRouteFor`,
      `lineCommit.ts:71-88`).
    - the typed text met the search minimum.
    - the pick carries no variant (§S13:991-994).
- The next keystroke or the next pick clears it.
- It never shows after a command-route pick. That command already records the correction (ADR-0045:259-262).
- Its outcome uses the existing correction notice (`toCorrectionNoticeModel`).

**The trailing control.**

- **Accessible name:** `addIngredientRowLabel` = `Add an ingredient` (SPECIFY.2:552, committed).
- **Visible:** the same text as the placeholder, and a decorative leading `PlusIcon` (`FR/form/icons.tsx:33`). The icon
  is hidden from assistive technology.
- **Placeholder colour:** `slate`, which is 5.24:1 on white (§S4:292). So it passes 1.4.3. The visible text is in the
  name, so 2.5.3 holds.
- **Not "Search ingredients":** the recipe filter bar already uses that name for a different job
  (`FR/filters/messages.ts:95`). The name says what the control does, not how it works.

**Test impact.** 25 flows select "Search ingredients" in the editor: 10 Playwright specs and 15 Maestro flows. The
implementer's 28 counts every file that holds the words.

- Three of those files select the filter bar, whose field has the same name: `search.spec.ts`,
  `variantSurfaceReflow.spec.ts:235` and `searchNavigation.yaml`. They stay as they are.
- `parseIngredients.yaml:41` holds the words in a comment only.
- `landscape.yaml` selects both fields (the filter at `:93`, the editor at `:157-160`). Only its editor step changes.
- Playwright changes in any case, because the role goes from `searchbox` to `combobox`. The selector becomes
  `getByRole('combobox', { name: 'Add an ingredient' })`.
- Maestro becomes `tapOn: 'Add an ingredient'`.

**States.**

- Empty: the placeholder, and no list.
- Typing: the list opens.
- Commit: the line appends, the field empties, and focus stays (§2d:149).
- Pick in flight: the text stays, and the field is busy.
- Pick failed: an alert, and the text stays. A failure that settles while its step is not shown: E2, below.
- Text at submit: blocked (§4b, `ingredientEntryPending`; R5 to R7).
- Offline: suggestions degrade (§7:391). Every write stays on offer.

**WCAG.**

- 1.3.1: a programmatic label, not the placeholder alone.
- 2.4.6 and 2.5.3: see above.
- 3.3.2: the hint `ingredientNameEditableHint`.
- 4.1.3: `Added {name}` is polite (the existing `ingredientPickerStatus.added`, `FR/messages.ts:681`).

**Web and native.** Kept on both. Native adds the 48 dp clear button (item 4). Below 640 px on web, the field takes a
full-width line, as row names do (§3c, P6).

**Owner:** the teach control's survival only (O1).

---

## Item 4. Change food: what cancels it, and where focus goes

**Decision.**

- Change food turns the name into a combobox. The field shows the current name, with the caret at the end (§2d:150).
- The line still holds the old food up to a pick (§4b:286).
- The dotted line is hidden during entry mode, because it describes the binding the cook is replacing. It comes back
  on cancel.
- Slot 2 drops `Change food`, `Add details` and `Edit details` (system change 5). So row 3 shows `Remove` directly.

**What cancels it.**

| Route                                                       | Web                                                 | Native                                        |
| ----------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| `Cancel`, a visible text button at the field's trailing end | yes                                                 | yes                                           |
| Escape with the list **open**                               | closes the list and keeps the text (§SPECIFY.3:594) | not available                                 |
| Escape with the list **closed**                             | cancels                                             | the same, with a hardware keyboard            |
| Android back, after the OS closes the keyboard              | not available                                       | cancels, through `@commise/ui/back-intercept` |
| Focus leaves the row, and no new text was typed             | cancels, and focus does not move                    | the keyboard closes with no new text: cancels |
| Focus leaves the row **with** new text                      | stays in entry mode, with the text                  | the same                                      |

**One Escape rule for every entry target** (system change 8). Escape with the list closed abandons the typed text. The field goes back to
what the line holds:

- on the trailing row, nothing (the text clears, which APG allows).
- on rows 1 and 2, the line's own name.
- on a row in Change food, record mode.

⛔ **Typed text on a Change food row blocks the save,** the same as on the trailing row (§4b). Without the block, the
save keeps the old food while the cook sees a new name in the field. That is U28's failure. The blueprint's
`validateRecipeForm(values, pendingEntryText)` (decision 1) already covers every target.

**Focus.**

- After a commit: the row's glyph (§2d:148). If the pick lands `UNRESOLVED`, that glyph is the candidates trigger.
- After a cancel: the row's `⋮`. Change food is only reachable from a `⋮` menu, because every state that offers it has
  two or more actions (`ingredientRowPolicy.ts:138-167`). So `⋮` is where the cook came from. APG's menu button pattern
  returns focus to the opener. This needs system change 6.
- Native: the screen-reader cursor moves to the same targets (`screenReaderFocus`). The keyboard closes, because the
  field unmounts.

**States.**

- Entry: the field, `Cancel`, the glyph and slot 2.
- Commit in flight: the field is busy. The row's other actions carry `aria-disabled` (V1 sign-off, line 932).
- Commit refused: the row stays in entry mode, the text stays, and `changeFoodFailed` shows as an alert.
- A `409`: the editor's existing conflict state (blueprint decision 7).
- Pending text at save: `ingredientEntryPendingChange` (R7).

**Copy** (`RecipeFormMessages`):

- `ingredientEntryCancel` = `Cancel` (the visible text).
- `ingredientEntryCancelLabel` = `Cancel, keep {food}`. This is the accessible name. It starts with the visible text
  (2.5.3).
- `ingredientEntryPendingChange` = `“{text}” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep {food}.`
  (R7 renamed and reworded it.)
- `changeFoodFailed` = `The change didn’t save. This ingredient still uses {food}.`
- `ingredientEntryClear` = `Clear text`. This names the native clear button. It replaces `searchClear`
  (`MOB/i18n/messages.ts:526`).

"Cancel" is safe here. It sits on a search field, as on the iOS search bar, and its accessible name says what it keeps. A
bare "Cancel" beside a row can read as "remove this ingredient".

**WCAG.**

- 2.1.1 and 2.1.2: Escape never traps, and Tab leaves.
- 2.4.3: the targets above.
- 3.2.1: focus alone never cancels. Only leaving with no new text cancels, and that loses nothing.
- 3.3.1: the alert for a refused commit names the row's food.
- 2.5.8: `Cancel` is 44 × 44 CSS px on web and 48 × 48 dp on native.

**Web and native.**

- Escape: **moved** to `Cancel` and Android back. Touch has no Escape.
- The native clear button (48 dp): **kept** from the picker (`MOB/components/IngredientPicker.tsx:564-573`), and moved
  into the primitive. It shows on the trailing row and on rows 1 and 2. A Change food row shows `Cancel` instead.
- Web has no visible clear button. Escape with the list closed clears, as §S18:1324 already decided.
- The longest string: `Cancel` has 6 characters, about 8 at +35%. The button fits its text, and the field shrinks
  (`min-w-0`).

**Owner:** no.

---

## Item 5. The suggestion-count announcement

**Decision.** One polite announcement, after the read for the **current** text settles.

- It never fires per keystroke. The read is debounced (`INGREDIENT_SEARCH_DEBOUNCE_MS`,
  `ingredientResolver.model.ts:51`).
- It never fires while the list is closed.
- It never repeats for the same text and the same count.
- It counts **foods**: the cook's own, the catalog's and each remote source's. It never counts the ways in `Not listed?`
  or `None of these?`.
- The progressive answer says it once, at completion, with a 1 s guard (S7 list contract P7).

| Situation                      | Polite text (`RecipeFormMessages`)                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 food                         | `ingredientSuggestionCountOne` = `1 food found`                                                                                                  |
| more than 1 food               | `ingredientSuggestionCountOther` = `{count} foods found`                                                                                         |
| 0 foods (both groups answered) | `ingredientNoSuggestions`, rewritten: `Nothing in your foods or the food catalog matches “{query}”. Keep typing, or find its nutrition by name.` |
| one group unavailable          | the count, then `ingredientCatalogUnavailable` or `ingredientAuthoredUnavailable` as a second sentence (S5 list contract)                        |
| searching                      | `ingredientPickerSearch.searching` (`FR/messages.ts:677`)                                                                                        |
| below the minimum              | nothing (§S13 P2)                                                                                                                                |

- The old zero text (SPECIFY.2:551) says "add it as your own food". The list holds no such control, so the text changes.
- A failed search is assertive, not polite: `ingredientPickerSearch.failed` (`:678`).
- Plurals use this file's `…One` and `…Other` convention (§S11:850).
- Whole sentences join. Fragments never do.

**WCAG.** 4.1.3.

**Web and native.** Web: one `aria-live="polite"` region and one `role="alert"`. Native: a polite `LiveRegion` and an
assertive one (system change 2).

**Owner:** no.

---

## Item 6. Two rows on one root, with different variants

**Decision.** A variant-bound row's controls name the parts after the food. A root-bound row keeps today's names. The
parts join with `", "`, which is how `VariantPartsLine` speaks them (§S4:287). Each label has its own template, so a
translation can reorder its words.

| Key (`RecipeFormMessages`, new)                | `en`                                |
| ---------------------------------------------- | ----------------------------------- |
| `ingredientStatusPanelTriggerLabelWithDetails` | `About {food}, {parts}`             |
| `ingredientStatusPanelCloseLabelWithDetails`   | `Close details for {food}, {parts}` |
| `ingredientActionsMenuLabelWithDetails`        | `Actions for {food}, {parts}`       |
| `ingredientActionsMenuCloseLabelWithDetails`   | `Close actions for {food}, {parts}` |

- So two rows read "About beef brisket, flat half, select" and "About beef brisket, point half, choice". A root-bound
  brisket still reads "About beef brisket".
- Two lines bound to the **same** variant keep the same name. That is accurate, because their panels say the same thing.
  The row's "Ingredient {number}" label also comes first.
- `{parts}` comes from `rowVariantParts` (`ingredientRowPolicy.ts:242-251`). That is the rule for the dotted line too. So
  a name never mentions parts the row does not show.

**WCAG.** 2.4.6 and 4.1.2. 2.5.3 does not apply, because the glyph and `⋮` have no visible text.

**Web and native.** The same.

**Owner:** no.

---

## Item 7. The native list is in flow

**Decision: in flow below the field, on native only.** Web stays an overlay (§2a:114).

- The implementer's reason is real. On Android, a child drawn outside its parent's bounds takes no touches
  (`UI/combobox/Combobox.native.tsx:8-10`).
- The other overlay is a `Modal`, which is a separate window. The field under it then loses the keyboard. This is
  reasoned from how React Native presents a Modal. It is not checked on a device.

**Three binding conditions.**

1. Every scroll ancestor sets `keyboardShouldPersistTaps="handled"`. Without it, the first tap closes the keyboard, then
   `onBlur` closes the list (`Combobox.native.tsx:121-123`), and the tap is lost. The one host sets it:
   `MOB/screens/RecipeEditor.tsx`, which holds the wizard steps (`FR/wizard/Wizard.native.tsx`). `RecipeForm` was
   deleted on 2026-10-03: nothing outside its own tests rendered it, on either platform.
2. The keyboard budget stands (§8e:491-493). The field and **at least three options** show inside the scroller's
   visible area. While the wizard bar is pinned, that area ends at the bar. Otherwise it ends at the keyboard.
   If they do not fit, the host scrolls the field to the top of the visible area as the list opens. Nothing above the
   field moves. Rows below the field move down. That is the cost of in-flow. How it is built: E1, below.
3. The list does not scroll on its own (no nested scrolling). It makes the page longer.

**WCAG.**

- 2.4.11: the list cannot cover its own field, because it is in flow. The keyboard must not cover the field
  (condition 2).
- 1.4.10: no change.

**Amend** for native: §2a:114 ("an overlay … no reflow"), §8e:481 ("overlay below", then "repositions above") and the 2.4.11 row
of SPECIFY.3 (:597).

⚠️ A device check is owed: Android and iOS, a phone in one hand, the keyboard up.

**Owner:** no.

---

## Item 8. Native `Edit details` from `⋮`

**Decision: the visible sequence.**

1. The cook taps `⋮`. The action sheet slides up, and the reading cursor goes to its title. The `Sheet` does this at
   `onShow` (`UI/sheet/Sheet.native.tsx:8-10`).
2. The cook taps `Edit details`. The action sheet slides fully out. **Focus does not return to `⋮` in between**
   (blueprint decision 5). A return there announces "Actions for …" and then "Edit details", back to back.
3. On `onDismissed`, the details sheet slides up. The reading cursor goes to its title, `Edit details` (§S8.6:739-741).
4. On every close of the details sheet, the cursor returns to `⋮` (§S8.8:762).

**Rules around the sequence.**

- With reduce motion, both sheets appear and leave without a slide (`sheetAnimationType`). The gap is one frame.
- While the chosen item waits to run, a press on `⋮` does nothing. Otherwise iOS meets two Modals at once. No visual
  state shows, because the wait is one slide-out.
- Android takes the same path. That gives one behaviour and one test.
- `Create my own food` from `⋮` uses the same sequence.
- Web: the dialog opens on the frame after the menu's `onSelect`. So the focus return records `⋮` (§S7:368-371).

**States.** Menu open. Item held (the menu leaves). Details opening. Details open. Closed, with focus on `⋮`.

**WCAG.** 2.4.3. 4.1.2: the trigger's `accessibilityState={{ expanded }}` is false once the menu is gone.

⚠️ **Not checked on a device.** `Sheet.native.tsx:16-19` records that iOS probably skips the slide-out today. The cause is
that the Sheet returns `null` once it is closed. Blueprint decision 5 changes that. An iOS device check is owed before
anyone claims this sequence works.

**Owner:** no.

---

## Item 9. `Add details` on row 8, and an unknown `hasVariants`

**Decision.** On row 8 (`NEEDS_REVIEW`), a root-bound line gets no `Add details`. A variant-bound line on row 8 keeps
`Edit details`. This reverses one cell of my own §S7:362. Two reasons:

1. Row 8 tells the cook that the match and their words disagree (`statusExplainNeedsReview`). `Add details` assumes the root is right. The
   remedy comes first (§3a:609). `Change food` already reaches a variant, because a query that names exactly one variant
   binds it (§S2:248-250).
2. Row 8's catalog figures are withheld (`packages/shared/recipe-core/src/nutrition.ts:313-331`). So the read that
   supplies `hasVariants` skips the line (`FR/form/nutritionLookup.ts:76-88`). A read for it fetches figures that must not count. That is the H10 class
   (§EVALUATE:764).

`Edit details` needs no read, because the binding already says "variant". It fixes a wrong variant, which is the repair
§S3:261-262 names.

**While `hasVariants` is unknown** (the read is loading, parked offline, or failed), the menu has no `Add details`.

- It is never greyed (Rule 1).
- It is never shown and then removed.
- It is never a dead end. About 1,416 roots have no variants (§1b:105).
- The total already shows a failed read once, with `nutritionLoadFailed` and its Try again.

**After `hasVariants` arrives.**

- Nothing is announced.
- **An open menu does not change.** It keeps the items it opened with (system change 6). So `Add details` never appears
  above a destructive `Remove` under the cook's finger.
- A line picked in this session gets the item after the read for its ref answers.
- `Edit details` does not depend on the read.

**WCAG.** 2.4.3 and 3.2.2: no item moves under focus.

**Web and native.** The same rule.

**Amend:** in §S7:362, the `Add details` cell becomes "none". §S12:905 needs a note for row 8.

**Owner:** O4 (U12 has no row exception).

---

## Item 10. "You reached your limit" against "the source is busy"

**Decision: two messages, and two signals on the wire.**

| Cause                                                                                                                                                 | What the cook reads                                                                                   | Is the wait shown?                                                   | Is a retry offered?                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **The cook's own limit.** Food's per-cook cap, per minute or per hour (`throttle/requesterSourceBudget.interceptor.ts` and the per-minute throttler). | `sourceLimitReached` = `You’ve reached your limit for food lookups. You can try again at {time}.`     | **Yes**, as a clock time                                             | No. A remote pick and a candidate pick make no request up to `{time}`. Then they come back. |
| **The source, or the shared window, is busy.** Food's `503`.                                                                                          | `busy`, serving search and pick: `Lookups from {source} aren’t available right now. Try again later.` | No. The client cannot know the end of a USDA block (§S14:1123-1125). | Yes: press again.                                                                           |
| **The cook's own limit, with no `Retry-After`.** Food always sends one. This row is a guard.                                                          | `sourceLimitReachedLater` = `You’ve reached your limit for food lookups. Try again later.`            | no                                                                   | No                                                                                          |

**The clock time.**

- `{time}` is a clock time, not a countdown. A countdown goes stale, and a ticking one is noise.
- It is the receipt time plus `Retry-After`, **rounded up to the next minute**. So the stated minute never fails.
- It uses the locale's hours and minutes (`Intl.DateTimeFormat`, `useLocale`).

**Where the copy lives.**

- The three keys (`busy`, `sourceLimitReached`, `sourceLimitReachedLater`) live in `ingredientRemoteSearch`, which both
  apps share (S7 list contract copy). `busy` names its source, because each source has its own shared window. The
  limit keys name none: food keeps one budget per cook across every source (`requester_source_budget`, keyed by
  requester only, food migration 0020).
- Row 6's candidates panel and a remote pick use the **same keys**. Both spend the same budget (PATCH resolve and the
  adopt command, `requesterSourceBudget.interceptor.ts`).
- The limit holds across text changes and across every surface, up to `{time}` (system change 9). Before `{time}`, a
  press on a remote hit or on a candidate makes no request. It repeats the message instead.
- These messages are assertive, because the service refused the cook's press.
- In the progressive list, nothing was pressed. So a source's busy or limit outcome there is a polite note with its
  own copy (S7 list contract P6).
- None states the hourly figure (O2). None blames the source for the cook's own limit.

**What the apps must receive.**

- **Through recipe (superseded):** recipe's resolve relay is deleted (plan 002 S7, 2026-10-03), so no food refusal
  passes through recipe any more.
- The split is safe. Food's `429` is only ever the cook's own cap, because food turns a source `429` into a `503`
  (`food-service/src/foods/foods.errors.ts:189-190`).
- **After S5, the apps call food directly:** food's `429` with `Retry-After`. Its body still owes a code, so a future
  `429` of another kind cannot pass as this one.
- **In the client:** a distinct error name, not the busy one. It maps to a view state, `limitReached`, which carries
  `retryAt`.
- The architect chooses the code's name. The split itself is required.

**WCAG.**

- 4.1.3: assertive.
- 2.2.1 does not apply. The limit belongs to the service. It is not a time limit on reading or input.
- 3.3.1: the message says what happened and the time it ends.

**Web and native.** The same copy and the same place: the row's failure line after a remote pick, and inside row 6's
panel.

**Deceptive-pattern check:** passes. The statement is true and material, and it applies no pressure.

**Owner:** the figure only (O2).

---

## Amendments owed in other docs (the lead applies them)

- `ingredientStatusExplanation.md`:
    - §2a:114 and §8e:481: native in flow (item 7).
    - SPECIFY.2: rewrite `ingredientNoSuggestions` (:551, item 5). Add the keys of items 1 and 4.
    - SPECIFY.3: the 2.4.11 row (:597, item 7).
    - §8b: six triggers, with the `name` pick added (item 1).
    - §4b: pending text on a Change food row also blocks the save (item 4).
- `ingredientSpecialization.md`:
    - §S7:362 and §S12:905: row 8 (item 9).
    - §S14:1112: the `busy` text changes (item 10).
    - §S14 placement: the live panel is the option's group (item 2).
    - §S18:1328-1331: the rows for the correction control, the live panel and the action buttons (items 1 to 3).
- Curated plan U12 (`:1409`): add the row 8 exception, once the owner answers O4.
- `rowEditorBlueprint.md` line 7: system changes 1 to 4 supersede the props text "as is plus `onFocus`". Line 9: system
  change 8 replaces "Escape on a closed list clears text (stateReducer keeps it)".

## Validation run (agent §6c)

1. **Against publication.** I fetched the APG _Combobox Pattern_ and _Understanding SC 3.2.2_ on 2026-10-02.
    - The APG Tab-sequence rule decides item 2.
    - 3.2.2's "newly opened modal dialog" decides the no-auto-open rule.
    - A first fetch of the WCAG 2.2 text put 3.2.2's wording under 3.2.1. I discarded it, and I quote only the
      Understanding page.
2. **Against myself, adversarially.**
    - _Against no auto-open:_ the cook can miss the alert glyph, so an unresolved line saves quietly. _Answer:_ the
      outcome is said on screen and aloud. The line keeps its alert glyph and its status word. The save path accepts
      `UNRESOLVED` by design (blueprint decision 2).
    - _Against item 9:_ dropping `Add details` loses a list-based fix on row 8. _Answer:_ `Change food` reaches the same
      variant, and the remedy-first rule applies.
    - _What flips item 9:_ proof that a variant pick re-checks the line and clears `NEEDS_REVIEW`, together with a wire
      that sends `hasVariants` without figures.
3. **Against prior art.** Item 2 follows the "create in the list" pattern (GitHub labels, Linear). Item 4's `Cancel`
   follows the iOS search bar. I cite both from familiarity, not from a fetched page, so neither is checked.

## What I could not check

- Nothing was rendered.
- No screen-reader run and no device run. Items 4, 7 and 8 each owe one.
- Unknown: does a variant pick clear `NEEDS_REVIEW`? That is the flip condition for item 9.
- Unknown: does the rebind command queue offline, or fail? That is the architect's question. Item 4's failure copy
  covers a refusal only.

## Success measure

- On both platforms, a cook types, picks and keeps entering ingredients with no manual focus move (the §2d loop).
- No copy names a deleted control. A search for the four strings above finds nothing.
- One Maestro flow and one Playwright spec each enter three ingredients through `Add an ingredient`. One of the three
  is an ambiguous pick. Each test asserts the focus and the announcement.

---

## Rulings after B6a (2026-10-02)

**Standing.** I read the combobox as built (`UI/combobox/props.ts`, `Combobox.tsx`, `Combobox.native.tsx`). Nothing was
rendered. Two of the four questions come from errors in my own text: item 2's L8 row and item 4's native Escape cell
(line 384). I withdraw both below.

### R1. The order inside the entry

**Both platforms, visual and reading order (1.3.2):** the field → the `status` line → the listbox → the trailing lines.
The S7 list contract (P1) gives the groups inside the listbox.

- The database line sits **above** the list only when our database found no food (`v3Evaluation.md` V3-M2a). It then
  explains the empty list. When our database found a food, the line is the first trailing line instead, so the cook
  sees the first food first. The choice is made once, when the database part of the answer settles, and it stays the
  same for that text. So nothing moves (S7 list contract P2).
- The trailing lines are last in the popup: each remote source's note, then the loader. Foods arrive above them (P3).
- The no-match note then sits directly above `Find nutrition`, the control it names. My O3 line ("beside the 'no
  match' message") assumed the note sat at the end. I withdraw that reason. O3's non-binding preference keeps its
  other reason: no scroll.
- `Create my own food` is the trailing row's last option, inside the listbox (O3, P1).
- No line is live (system change 2). All stay outside `role="listbox"`.
- **Built 2026-10-02:** the status line now stands before the list, and `trailingStatus` after it, on both leaves. In `props.ts:81-84`, `status` is shown "before the options", and `trailingStatus` "after the options".

### R2. How the offline state is spoken

- **The combobox never holds `OfflineReadSlot`.** The slot is a screen's content region. On web it is a
  `role="status"` (`UI/offlineNotice/OfflineReadSlot.tsx:25`), and on native it has no live region at all
  (`OfflineReadSlot.native.tsx:4-7`). Its padded, centred block is sized for a screen, not a list line. Inside the popup
  it speaks twice on web and never on native.
- **The answer parked (§S13 P9):** a trailing line holds `readOffline`, in the loader's place (S7 list contract P6).
  The host puts `readOffline` in `countAnnouncement` (polite).
- Polite, not assertive: nothing failed, and the read resumes by itself (`features/core/src/offline/messages.ts:20-24`).
  4.1.3.
- Precedent: `MOB/components/IngredientPicker.tsx:587-600` already speaks P9 through its polite region, because the
  native slot is silent.
- **The gap the live search had must not come back.** Its mutation paused offline and showed `searching` with no end.
  A parked answer shows `readOffline`, never a loader (P3).

### R3. The count: the closed-list rule wins, and the primitive owns it

Only the primitive knows whether the list shows (`props.ts:7`). So the primitive gates its polite region. The region
holds `countAnnouncement` while the popup shows and `''` otherwise, and it stays mounted (`Combobox.tsx:298-300`,
`Combobox.native.tsx:157-159`). A live region speaks at a change of its text, and at no other time. The result:

- **Spoken:** once at the settle of the current text's read, with the list open. Also once at each opening or
  reopening of the list on results. For the progressive answer, "settle" is the moment the S7 list contract's P7
  names.
- **Not spoken:** while the list is closed. Not at the close, because an emptied region is silent
  (`UI/liveRegion/LiveRegion.native.tsx:15`). Not while the list stays open with the same text.
- **Close, then reopen on the same results:** the count is spoken once more. The cook asked for the list, and the count
  says what it holds. Judgement.
- **"Never repeat" now means never twice in one opening.** _Corrected 2026-10-02 at build:_ every settled read is spoken
  once, a new text with the same count included, because the host half of this ruling puts `''` and then the searching
  text between two texts, so the region's text does change. The built primitive treats a changed string as settled
  (`ui/src/combobox/props.ts`, `countAnnouncement`). The paragraph below, kept as the reasoning, argued the opposite. GOV.UK's autocomplete does re-speak it, by alternating two regions
  (`alphagov/accessible-autocomplete`, `src/status.js`, fetched 2026-10-02). I do not follow it. The count did not
  change, so there is no new status, and the status stays programmatically determinable (4.1.3). Judgement.
- **The host's half:** `countAnnouncement` describes the current text only: its settled read, `searching` while that
  read runs, or `''`. Otherwise a list that a keystroke reopens speaks the previous text's count.
- **The assertive channel is never gated.** A choice closes the list before its failure arrives
  (`Combobox.native.tsx:84`, and downshift's close on a commit the reducer passes, `Combobox.tsx:103-105`).
- **A pick's outcome is not the count.** `Added {name}` (item 3) and item 1's needs-choice sentence land with the list
  closed. They go to the row's status line, the host's own polite region outside the primitive. Precedent:
  `WEB/components/recipes/IngredientPicker.tsx:563-570`. This is what item 1's "the polite channel" means.
- This supersedes item 5's second and third bullets.
- **Built 2026-10-02:** the polite region is gated on `popupShown` in both leaves, with these tests. Web component tests: Escape, then
  ArrowDown, on the same results speaks the count once. Native component tests: a blur empties the polite region.
  Both: a failure after a pick is spoken with the list closed. Native cannot reopen on the same results, because its
  list opens only on a text change (`Combobox.native.tsx:124-131`).

### R4. Native has no Escape: accepted, with one gap closed

- **Accepted.** React Native's `onKeyPress` reports Enter, Backspace and typed characters, and "on Android only the
  inputs from soft keyboard are handled, not the hardware keyboard inputs" (reactnative.dev/docs/textinput, fetched
  2026-10-02). For Escape with the popup hidden, APG says the combobox "Optionally" clears (APG Combobox Pattern,
  Keyboard Interaction, fetched 2026-10-02). So APG does not require it.
- 2.1.1 holds: `Cancel` is a button straight after the field (`Combobox.native.tsx:146-155`), reached by Tab and pressed
  with Space or Enter. 2.1.2 holds: Tab leaves the field.
- **Withdrawn:** item 4's native Escape cell (line 384, "the same, with a hardware keyboard"). It becomes "not
  available".
- **A Tab out with no new text does not cancel on native, and that is accepted.** Item 4's native no-new-text cancel
  (line 386) is keyed on the soft keyboard closing. With a hardware keyboard the soft keyboard never opens. A cancel on
  the field's blur is refused. `Cancel` is the next stop after the field (`Combobox.native.tsx:146-155`). A Tab to it
  then cancels the entry and unmounts the control that takes focus (2.4.3). Native cannot tell "moved to `Cancel`" from
  "left the row". So the row stays in entry mode. Nothing is lost, and `Cancel` and back still exit.
- **For that reason, unchanged text is never pending text.** The current name that Change food puts in the field
  (§2d:150) does not block the save until the cook changes it. Item 4's "Typed text … blocks the save" means changed
  text only.
- **Device check owed:** iPad with Full Keyboard Access and an Android tablet with a keyboard. From the field, Tab
  reaches `Cancel`, and Space or Enter presses it.

**Amendments owed in other docs (the lead applies them).**

- `ingredientSpecialization.md` §S13 P9 (`:990`) and §S14 L8 (`:1064`): "the slot's own" becomes the polite channel,
  and the slot becomes a status line.
- `ingredientSpecialization.md` §S14's "Live region" column (`:1058-1066`): "visible" means the line is shown. The
  column names the channel, and the visible line is never live (system change 2).

**Validation (agent §6c).** Against publication: the React Native `TextInput` docs and the APG Combobox Pattern, both
fetched 2026-10-02. Against prior art: GOV.UK `accessible-autocomplete` `status.js`. It silences the count after a
choice and while the field is out of focus, as R3 does at close. R3 departs from its re-speaking of an unchanged count,
as stated above.

---

## Rulings after B6b (2026-10-02)

**Standing.** I read the B6b code as built. Nothing was rendered. The hosts still pass `''` for the pending text (B8
wires them). So every claim about a refusal is reasoned from source.

### R5. Pending text blocks Save Draft: the block stands

- **Save Draft leaves the editor.** It calls `onSaved` (`FR/hooks/useRecipeEditor.ts:680-684`). On every host, that
  call leaves the editor:
    - web edit goes to the detail page (`WEB/components/recipes/RecipeEditContainer.tsx:153`).
    - mobile edit goes back (`MOB/screens/RecipeEditScreen.tsx:21-25`).
    - web create goes to the new recipe (`RecipeCreateContainer.tsx:217`).
- Text that is in no line goes with it, unseen. That is §4b's failure.
- **A draft still saves incomplete work.** The draft floor admits no ingredients and unresolved lines
  (`FR/form/steps.ts:92-98`). It refuses only text that is in no line at all.
- **The block costs one action.** `Use “{query}” as written, without nutrition` is always on offer, offline too (item 2's
  edge rules). Clear and `Cancel` are always there. So the block never strands the cook.
- **The unattended autosave passes `''`, and that is right** (`useRecipeEditor.ts:691-694`). It stays in the editor. So
  the text stays where the cook typed it.
- Rejected third options:
    - Lift the text into a line. §4b refuses it, because it reopens U28.
    - Declare the text as written at the save. That binds a choice the cook never made, as resolve-on-blur does.
    - Keep Save Draft in the editor. That changes the editor's exit on both platforms, for one edge.

### R6. Pending text blocks step 2's Next: the block stands

- Next already refuses an incomplete step 2 (`STEP_ERROR_FIELDS[2]`, `FR/form/steps.ts:32-37`). Pending text is step 2's
  own unfinished state. So the same gate applies.
- It catches the text while the field is on screen. Step 3 unmounts the field (`Wizard.tsx:282`).
- The rail and Prev stay ungated (`Wizard.tsx:136`). The entry is hoisted to the host (blueprint decision 1). So nothing
  is lost between steps.

### R7. After a refusal: the step, the focus, the list (2.4.3, 3.3.1, 3.3.3)

**The gap today.** A Save Draft refused from step 1, 3 or 4 shows nothing. The ingredients error renders only in step
2's body (`RecipeIngredientsFields.tsx:411-415`, `.native.tsx:368-371`). The footer notice follows only a refused Next
(`Wizard.tsx:532`). That fails 3.3.1. A blank title refused from step 3 fails the same way. So it is the wizard's class.

The implementer changes:

1. **The step.** A refused Save Draft or Publish goes to the first step, in order, that holds an error. This also closes
   the blank-title case. ⚠️ Blast radius: it changes the refusal of Publish and Save Draft for every error code, not
   only for pending text.
2. **The focus.** The host raises the existing `focusRequested` on the first pending field (`entry.pending`). It does
   this for a refused Next on step 2. It also does this for a refused save that lands on step 2 with
   `ingredientsPendingText`. The request is a level, so the field takes it after step 2 mounts
   (`UI/combobox/props.ts:132-139`).
    - Native: today the request calls only `.focus()` (`Combobox.native.tsx:66-70`). That does not move the
      screen-reader cursor. So the native request also calls `moveScreenReaderFocus` on the field
      (`@commise/ui/screen-reader-focus`), as item 4 does.
3. **The list opens with it.** Today a press in the field leaves the list shut (web `Combobox.tsx:103-104`). Native
   opens it only on a text change (`Combobox.native.tsx:127-130`). So the cook cannot choose a food without editing the
   text. The combobox gains `listRequested?: boolean`. It is a level, and the same `onFocusRequestHandled` acknowledges
   it. Web opens the list through downshift's `openMenu`. Native sets its `open`. The cook's own press asked for this.
   A list that opens is a change of content, not of context (judgement).
4. **Native opens the keyboard.** `focusRequested` calls `.focus()` (`Combobox.native.tsx:66-70`). Accepted: the next act
   is in this field. The field must stay above the keyboard.

**What is said, and where.**

- **On the field.** This is the sentence the cook always hears. Every pending field shows its row sentence under it.
  It shows after a refused save or Next. When the text is committed, cleared or cancelled, it goes.
- Web: the row sentence is the field's description (`invalid` and `describedBy`). It is never live. The focus move
  reads it (`UI/liveRegion/LiveRegion.native.tsx:20-21` states the same rule).
- Native: `describedBy` is web-only (`props.ts:130`). An `accessibilityHint` is not safe here, because VoiceOver and
  TalkBack each let the user turn hints off. So the native field sets `invalid`, and its own assertive channel
  (`alertAnnouncement`) speaks the row sentence at each refusal. R8's `alertOccurrence` makes a second refusal speak again.
  The hint stays `ingredientNameEditableHint`. The visible sentence under the field is not live.
- **In the existing alert regions.** The footer (a refused Next) and the section's error (a refused save) keep the
  form-level sentence. Both sentences state the same fact.
- **The list's count follows.** The list opens (step 3 above), so R3's polite count is spoken after the refusal.

**Copy** (`RecipeFormMessages`, `en`). Form-level codes take no parameters. So the form-level sentence names no row.

- `errors.ingredientsPendingText`, built, with new copy:
    - `An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.`
    - The built copy said "clear the box". That is wrong on a Change food row, where the way back is `Cancel`.
- `ingredientEntryPending`, the trailing row:
    - `“{text}” isn’t in the recipe yet. Choose a food for it, or clear the box.`
- `ingredientEntryPendingChange`, a Change food row:
    - `“{text}” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep {food}.`
- The two row keys **replace** the unbuilt `ingredientPendingText` and `ingredientPendingChangeText` (item 4, and
  `ingredientStatusExplanation.md` SPECIFY.2:594-595). The old names differed from the built code by one letter.
- `{text}` is the trimmed text. The sentence is a paragraph, so a long `{text}` wraps. No control holds it.

**Tests owed.**

- Web and native component tests: a refused Save Draft from step 3 lands on step 2. The pending field has focus, its
  list is open, and its row sentence is its description.
- Playwright and Maestro: type, press Save Draft, read the sentence, choose `Use … as written`, then save.

### R8. Item 10's repeat: the behaviour stands, the mechanism is corrected

- **The behaviour stands.** Each refused press says the limit again, assertively. Item 10 already says a press
  "repeats the message instead".
- **A count speaks nothing by itself.** The web alert speaks at a change of its text (`Combobox.tsx:304-306`). The native
  region announces from an effect keyed on its text (`LiveRegion.native.tsx:45-57`). The same string twice is silent.
  So, wired as built, the second and later presses say nothing.
- **The fix.** Two mounted assertive regions take turns on each change of the count: the region that spoke last is
  emptied and the other holds the message. (Not by the count's parity, which is silent when the count jumps by two.)
- Each press is then a change from `''` to text on a mounted region. Android needs that too. GOV.UK uses this
  technique (`accessible-autocomplete` `src/status.js`, fetched 2026-10-02).
- **R3 declined it for the count.** A refused press is a new event the cook caused. An unchanged count is not.
- **One owner for both surfaces.** A remote hit sits in the combobox (S7 list contract P8). Row 6's panel does not
  (`FR/hooks/useCandidateResolution.ts:48-51`). So the alternation lives once, in `@commise/ui`.
    - `LiveRegion` is the natural home, with a `occurrence?: number` prop. It is native-only today
      (`UI/liveRegion/index.ts`), so it gains a web leaf.
    - The combobox gains `alertOccurrence?: number` beside `alertAnnouncement`. The row derives the occurrence (`rowEntryFieldOf`); the hosts pass nothing.
    - The architect names both.
- **Test:** two refused presses. On web, the message appears in each region in turn. On native, the iOS announcement
  is called twice.

### R9. `Button` fills its slot: `width?: 'auto' | 'fill'`

- **Observation.** Web `PressScale` is an `inline-flex` span (`UI/pressScale/PressScale.tsx`, before R9). The button inside
  it has no width. So a column parent stretches the span and not the button. The lead measured "Back to recipes" at
  158 px on a 288 px form at 320 px.
- Native already follows its parent. `PressScale.native` styles only a transform (`:56-58`), and a column stretches its
  children. This is reasoned from source.
- **Decision.** `ButtonProps.width?: 'auto' | 'fill'`, default `'auto'`.
    - The span and the native pressable belong to `PressScale`, not `Button`. So `PressScaleProps` gains the same
      `width`, on both leaves, with the same default. `Button` passes it through. `PressScale` also wraps cards and the
      FAB, and their default does not change.
    - `'auto'` is today's behaviour on each platform, unchanged.
    - It is not named `'content'`. Native already lets the parent decide, so `'content'` promises a hug that native
      does not give. A native hug is the same undesigned app-wide change, on the other platform.
    - `'fill'` on web: the span becomes `flex self-stretch`, and the button takes `w-full`. The label stays centred.
    - `'fill'` on native: the pressable takes `alignSelf: 'stretch'`.
    - On both, a filled button fills a column, a centring column too. In a row, it keeps its content width.
    - Accepted cost: the stretch also overrides a row parent's `items-center`. So in a row, filled buttons share the
      row's height. At `sm` both paste-form labels fit one line, so nothing visible moves. If one label wraps, equal
      heights read better than two pill sizes (judgement).
- **No breakpoint in the primitive.** The parent's direction decides. The paste form's parent
  (`FR/parse/ParsePasteForm.tsx:100`) is a column below `sm` and a row from `sm` on. So it gets full width below `sm`
  and content width above, with no change to the parent.
- **Adopt it on the paste form, web.** Both buttons take `width="fill"`.
    - The acceptance test is `packages/apps/commise/web/tests/e2e/variantSurfaceReflow.spec.ts:240`.
    - ⚠️ It measures only 320 px. The `sm:` row case is not measured. One assertion at 640 px or wider, that both
      buttons sit on one line, covers it.
- **Adopt it on the filter Sheet's `Done`, both platforms** (`FR/filters/RecipeFilterBar.tsx` and
  `.native.tsx`). Use `Button`, with `variant="primary"`, a check icon and `width="fill"`.
    - This is a design call, and a visible change.
    - The charcoal fill (before R9, web and native `styles.done`) is not a house tier.
    - `Done` is the footer's only action, so it is primary. `Button` requires an icon, so a check glyph is added.
- **Blast radius.** The change is additive, and the default is unchanged. So no other screen moves. `Button` keeps its
  own height rule: 44 px on touch, and smaller for a mouse at 768 px and wider (`surfaceClass.ts`). The sheet layout
  also shows on a desktop window under 480 px tall, so `Done` is about 40 px there. That still passes 2.5.8 (24 px). A
  filled button fits its slot, so 1.4.10 is not affected.
- **Not owed here.** The native paste form hand-rolls both pills (`ParsePasteForm.native.tsx:100-125`). They already
  fill. A move to `Button` is a separate tidy-up.

**Amendments owed in other docs (the lead applies them).**

- `ingredientStatusExplanation.md` SPECIFY.2:594-595: rename and reword the two row keys (R7).
- `ingredientStatusExplanation.md` §4b:278: the refusal also opens the field's list. Save Draft and step 2's Next are
  refused too (R5, R6).
- This file, item 3's states (`:351`) and item 4's copy (`:415`, `:422`): the new key names (R7).

**Validation (agent §6c).**

- Against publication: GOV.UK `accessible-autocomplete` `status.js` (R8), the source R3 already fetched.
- Against myself: "a draft exists to save incomplete work". The draft floor still saves incomplete lines. It refuses
  only text that is in no line, on a press that leaves the editor (R5). If Save Draft ever stays in the editor, the
  block goes, and only the field's sentence remains.

**Device checks owed.**

- VoiceOver and TalkBack: a refused Save Draft speaks this sequence: the form-level alert, the field with its row
  sentence, then the list's count. Check that neither alert cuts the other off.
- Android: two refused limit presses are both spoken.

---

## S5 list contract (2026-10-02)

**Standing.** A scaled SPECIFY ruling. I wrote this file. I read the S3 blueprint and the lead's amendments to it. Both
are in the session scratchpad, dated 2026-10-02. No S3 or S5 code is built, so I read none. Nothing was rendered.
Paths: `RS` = `packages/services/recipe-service/src`, `FS` = `packages/services/food-service/src`, `Q` =
`packages/apps/commise/query/src`.

**Governing.** The house pattern: groups, never a blend (`RS/ingredients/ingredientSuggestion.ts:20-23`). §S13 P4 and
§S15 (`ingredientSpecialization.md:990`, `:1205-1215`). Items 1 and 5, and R1 and R3, in this file. Plan 002 R38 to
R40 and S3 to S6 (`…-plan.md:196-198`, `:553-556`).

### L1. Two groups, and one settle for both reads

**Decision.** The list holds two food groups, then `Not listed?` (item 1):

1. `Your foods`: the cook's own authored foods, from `GET /foods/authored/search`.
2. `Food catalog`: the catalog search, from `GET /foods/catalog/search`.

- A food's group is the read that returned it. "Yours" is never inferred from a missing field (plan S3 property 7).
- Each group keeps food's order. The client does not re-rank.
- Each group shows at most **10** foods. That is today's cap (`RS/ingredients/ingredients.service.ts:106`, and the apps
  pass no limit). Food's own cap is 20 (`FS/foods/dao/foodSearch.dao.ts:67`), and the S3 wire takes no limit. So the
  client slices. A limit on the wire splits the shared cache key. Without the slice, native's in-flow list (item 7)
  gets twice as long, and `Not listed?` moves ten rows further down.

**One settle.** The list stays `searching` until **both** halves settle. Then it renders once. Under S7, both groups
arrive in one frame of the progressive answer (ADR-0055 point 9). So this settle is the database part's. The S7 list
contract holds the rest of the list to it (P2). P7 gives the moment the count is spoken.

- _Why._ R3 speaks once per settled read. With two settles, the count is spoken twice, or the second half makes the
  first count wrong. A group that lands late also moves the other group under the pointer, or under the thumb on native,
  where the list is in flow.
- Three outcomes settle a half: an answer, a failure, or a parked read.
- **Parked.** Either half can be parked offline with no data. Then the view is P9 (`readOffline`) at once. Nothing waits
  for it. Offline, a read fails and then parks with no end (`Q/queryClient.ts:66-84`).
- **Deadline.** One deadline per text covers every attempt of a half. When it fires, that half counts as failed, and no
  attempt it started can land later. ⛔ Offline is the exception: a deadline that fires while the app is offline settles
  the half as parked (P9), not failed. "Offline" is the same online signal the `offline` view kind already reads. Offline,
  the first attempt fires and fails, and only then does the read park (`Q/queryClient.ts:66-77`). Without this rule, the
  deadline turns every offline search into P8's assertive failure. That breaks R2 and P9. The food client's per-request
  `signal` is not this deadline: it bounds one attempt, not every attempt of a half.
    - Without a deadline, a failing half can hold the other half's results through its retries. The house query retry
      allows up to three, and both of its vetoes abstain on a food error, so a food read without its own `retry`
      retries three times, `400` included.
    - The architect chose (S5 blueprint): one retry, for transport failures only, with zero delay, inside a
      3,000 ms deadline. The one retry is what lets an offline read park (P9).
- The deadline is not the client's 8 s default (`client.ts:102`). Recipe's per-keystroke bound was 600 ms
  (`RS/ingredients/ingredients.module.ts:83`), but that was one server calling another. A phone needs its own figure,
  measured. The architect sets it.
- **Cost (assumed, not measured).** On every text, the edge-cached catalog now waits for the authored read. That read
  always reaches food's origin (`private, no-store`). Measure the time until the list shows, on a phone on cellular.

**Rejected: one list merged by score.**

- It mixes private and shared foods in one ranking. So each row needs a tag to say whose it is. One label per group
  already says that, and §S15 chose labels for that reason ("one label for each group").
- Ranking is by text match only (KTD-15). A food the cook made because the catalog lacked it can sit below several
  catalog rows. In its own group it comes first.
- In a merged list, a failed half leaves no visible gap. In groups, the missing group has a sentence that says why.
- Merging still needs the settle and the deadline.

**What groups cost (heuristic judgement, untested).** A weak match from the cook's own foods can lead the list ahead of
an exact catalog match. That is the capture shape measured in U15 (`ingredientSuggestion.ts:116-121`). Here it reaches
only the cook's own list, and only foods they made.

**Flip condition.** Either of these sends L1 to the merged list with `ownFoodTag`:

- cooks often have more of their own matches than fit above the keyboard (§8e:491-493, three options).
- a test shows cooks picking a weak own match over an exact catalog match.

### L2. The "already used in a recipe" group goes, and so does its heading

**What it held.** `food_lookups` holds one binding per food for the whole platform (unique index,
`RS/database/schema/foodLookups.ts:61-63`). The read admits every shared binding, plus the caller's own private ones
(`RS/ingredients/dal/foodLookups.dal.ts:160-163`). So `Your ingredients` listed foods that _any_ cook had used. It was
never the cook's own history.

**Losing it is a small loss, and nothing personal goes with it** (heuristic judgement):

- Foods that some recipe uses no longer rank above foods that no recipe uses. The curated catalog returns each root once
  (§S2:246), so the near-duplicate problem that this order helped with is mostly gone. And the same "local first"
  order caused the U15 capture.
- A pick of such a food used to skip one round trip. The cook sees a delay, not a different choice.

**No cheap equivalent exists.**

- Recipe's `/ingredients/search`, which S6 keeps, runs food's search and filters the result
  (`RS/ingredients/ingredients.service.ts:324-361`). A per-keystroke call to it is the proxy R39 forbids.
- The only route that is not a proxy is a new recipe read of the cook's own bound food ids. That is a new "recently
  used" feature, and plan 002 does not ask for it.
- Not recommended. If the owner wants it, it is their call.

**The heading is wrong twice.**

- It never meant the cook's own foods.
- The group now holds foods the cook made, and every other surface calls those foods: `Create my own food`, and "Only
  you can see foods you create." (`FR/messages.ts:773`).

So it becomes `Your foods`. This is a two-way door: nothing is shipped.

### L3. Each half fails on its own

| Catalog                                           | Authored | Status line, before the list                     | Spoken                                                        |
| ------------------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------- |
| answered                                          | answered | none. With zero foods: `ingredientNoSuggestions` | the count, polite. With zero foods: `ingredientNoSuggestions` |
| failed                                            | answered | `ingredientCatalogUnavailable`                   | the count of any foods shown, then the sentence. Polite       |
| answered                                          | failed   | `ingredientAuthoredUnavailable`                  | the count of any foods shown, then the sentence. Polite       |
| failed                                            | failed   | `ingredientPickerSearch.failed` (P8)             | assertive                                                     |
| either half parked, or its deadline fired offline |          | `readOffline` (P9)                               | polite                                                        |

- Under S7 this table governs the database part only. The S7 list contract's P6 adds the remote part. Its two
  changes to this table: a failure of both halves is `ingredientDatabaseUnavailable`, polite, while a remote source
  is still being asked. Only a failure of every part is assertive.
- Each half's sentence stays true at any count, zero included. With zero foods, it stands alone.
- ⛔ Only an answer from **both** halves permits `ingredientNoSuggestions`. A failed half was never searched, so "No
  foods match" is then false.
- ⚠️ **This is a defect today, before S5.** `FR/form/entryCombobox.ts:154-156` tests for zero foods before it reads
  `catalogAvailability` (`:162`). So when the catalog is down and nothing else matches, the list already says "No foods
  match". I recommend the lead fixes it now.
- `Not listed?` stays in every row of the table (item 2).
- **A failed half** means a transport failure, its deadline, a 5xx, or `429 SEARCH_RATE_LIMITED`.
    - That `429` is not item 10's limit. It lasts seconds, and it refuses nothing the cook pressed.
    - That half does not ask again before its `Retry-After`.
- **`401 IDENTITY_SYNC_PENDING` on the authored half counts as failed, not as "no foods".**
    - Food raises it for a token that carries no app id (`FS/auth/authenticatedPrincipal.ts:76-91`). That describes the
      token, not the account, so I cannot show that a returning author never gets it.
    - An empty group hides their foods and says nothing.
    - Food's doc says the client refreshes the token and retries (`:39-41`). Today's food client cannot: its token
      callback takes no refresh flag. So the authored half reports failed, and the next keystroke asks again.
- R8's alternation is not needed here. While a new text is being searched, the assertive channel holds `''`
  (`entryCombobox.ts:127-134`). So the same failure again still changes the text, and it is spoken.

### L4. What S5's list contract carries for B8

These change items 1, 2 and 5 and system change 1:

1. **A catalog result's `variant`** (`FS/foods/foods.schema.ts:463-467`, parts `:332-337`).
    - It gives the option `detailParts` (the parts' text) and the accessible name
      `ingredientDetails.suggestionWithDetails`.
    - Today only a `local` row gets these (`entryCombobox.ts:235`). So a catalog result's matched variant is never
      shown.
    - Picking the result binds the variant (§S2:248-250). Whether that is the `catalogVariant` pick or a wider
      `catalogFood` (`FR/hooks/lineCommit.ts:31-33`) is the architect's call.
2. **An authored result.**
    - No detail line, because an authored food has no variants. No tag, because the heading says it.
    - Its accessible name is `{name}, your food` (§S15's `ownFoodName`), on both platforms.
    - _Why:_ native groups are header text only (item 1, 1.3.1). Without the name, a screen-reader user hears two
      `Butter` rows the same way.
    - The name starts with the visible text (2.5.3).
3. **A result with a null or blank name is dropped.** The schema allows a null name (`foods.schema.ts:445`). Recipe's
   gateway dropped such results (`RS/ingredients/foodCatalog.gateway.ts:17-18`), and S6 deletes the gateway.
4. **No option carries a binding.** Every food option is a pick by id. After S5, "Create my own food" goes to food and
   returns a food, not a binding, so the `admitted` pick has no producer and retires (S5 blueprint).
5. **The `terminal` view retires.** It needs a lone own row that is a dead end
   (`FR/hooks/ingredientResolver.model.ts:192`). Both new reads return only resolved foods.
6. **Creating a food clears the authored search from the app's cache.**
    - After `Create my own food` succeeds, the next search must find that food.
    - `no-store` stops HTTP caching. It does not clear the app's own query cache.
    - Without this, the cook types the name on the next row, sees no match, and creates the food again.
7. **Unchanged.** The count covers both groups (item 5). The query is keyed per user and purged at sign-out (plan S3
   property 7).

### Copy (`en`. `RecipeFormMessages` unless the key names `recipeMessages`)

| Key                                                                                                                                                   | `en`                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ingredientSuggestionsAuthoredHeading` (new. Replaces `ingredientSuggestionsOwnHeading`)                                                              | `Your foods`                                                                   |
| `ingredientSuggestionsCatalogHeading` (unchanged)                                                                                                     | `Food catalog`                                                                 |
| `ingredientCatalogUnavailable` (reworded, same meaning)                                                                                               | `The food catalog is unavailable right now, so only your foods were searched.` |
| `ingredientAuthoredUnavailable` (new)                                                                                                                 | `Your foods are unavailable right now, so only the food catalog was searched.` |
| `recipeMessages.ingredientPickerSearch.failed` (`FR/messages.ts:705`, unchanged)                                                                      | `We couldn’t search ingredients. Edit your search to try again.`               |
| `recipeMessages.ingredientDetails.ownFoodName` (§S15, decided, not built. Accessible name only. Beside `suggestionWithDetails`, `FR/messages.ts:742`) | `{name}, your food`                                                            |

§S15's `ownFoodTag` (`Your food`) is not built.

### Web and native

The same on both. `entryComboboxOf` is pure, and both leaves render it (`entryCombobox.ts:11`). On native the list is in
flow, so the single settle and the 10-food cap matter more there.

### Amendments owed (the lead applies them)

- `ingredientSpecialization.md`:
    - §S13 P4 (`:990`): two groups, `Your foods` then `Food catalog`. The cook's own foods leave the catalog group.
    - §S15 (`:1205`, `:1209-1215`): `ownFoodTag` is not built, and `ownFoodName` becomes the authored option's
      accessible name. This reverses my own cell.
- This file: item 1's copy table (`:217-218`) and item 5's "catalog unavailable" row (`:468`).
- Plan 002 S5 (`:555`): the deadline, the 10-food slice, the single settle and the cache clearing are S5's work.
- S6 deleted `useSuggestIngredients` with recipe's proxy.

**Owner:** nothing blocks. A personal "recently used" read is new scope (L2).

**Validation (agent §6c).** Against myself: the strongest case for the merged list is that an exact catalog match must
beat a weak own match. L1's flip covers it, and the cost stays inside the cook's own foods. Against the code: each claim
above cites the source it rests on. **Not checked:** the latency of the single settle, and the accessible name on a real
screen reader.

---

## S7 list contract: the progressive answer (owner ruling 2026-10-02)

**Standing.** A SPECIFY ruling, with one DESIGN step (P1, the place of `Create my own food`). I wrote this file. No S7
code is built, so I read none. I read the combobox leaves, `entryCombobox.ts`, `foodSuggestions.model.ts`,
`useReadDeadline.ts`, `useSourceLimit.ts`, both `AmbiguityReview` leaves and the wizard's chrome. Nothing was rendered.
Every placement claim here is reasoned from source.

**Governing.** ADR-0055 points 4, 5, 9 and 10. Plan 002 R62 to R67 and its S7 row. The owner, verbatim: _"The user sees
the dropdown list where there's a loading state in the dropdown and as food from the food search endpoint returns food
(from the search against our database and against the new search service) the foods fill in above the loader. The
loader then disappears when the search call returns completed."_ This replaces L1's single settle for the whole list.
L1 to L4 still govern the database part.

### P1. The order of the list

Top to bottom, inside the popup:

1. The database line (`status`), when our database found no food. L3 and P6 say which answers have one. When it
   found a food, the line is item 7's first line instead (`v3Evaluation.md` V3-M2a).
2. `Your foods`, at most 10.
3. `Food catalog`, at most 10.
4. `Not listed?`: Find nutrition, then Use as written.
5. One group per remote source, `From {source}`, at most 10 each, in the order their frames arrive.
6. On the trailing row only: `Create my own food`, once the answer ends. The answer ends at completion, at the end of
   its body, at a deadline, at a failure, or parked offline. With no remote group shown, the option joins
   `Not listed?` as its last option. Otherwise it stands under its own heading, `None of these?`. A parked answer
   always uses `None of these?`, because remote groups can still arrive after a reconnect. They then land above it.
7. The trailing lines: the database line when our database found a food, each remote source's note in arrival
   order, then the loader while the answer runs.

**Why remote groups come after `Not listed?`.** A frame can arrive while the cook reaches for Use as written. A group
added above it moves it under the pointer. On web the click then lands on a remote hit, and that pick creates a
catalog root. So remote groups only ever add at the end. This departs from the brief's order ("Your foods, Food
catalog, then each remote source"). `Not listed?` stands between them, for this reason.

**DESIGN step: where `Create my own food` goes.** I looked at two places.

- (a) The last option of `Not listed?`, shown with it. The cook can create at once. But the option then sits between
  the cook and remote foods, and one of them can be the right food. That is the defect an implementer reported, one group
  lower. Authoring a food a source already holds splits one substance in two (`ingredientStatusExplanation.md` §5a).
- (b) The list's last option, added at the end of the answer. **Committed.** It follows O3 literally ("the last option of
  the trailing row's list"), and an option added at the end moves nothing.
- The cost of (b): a cook who wants to create waits for the remote part, at most P3's budget. F3 is occasional, and
  its form takes far longer than that wait.
- `None of these?` exists only so the option does not read as a hit of the remote group above it.
- **Flip:** a measured share of cooks who abandon the entry while `Create my own food` has not yet appeared.

### P2. What moves, and what never does

**Rule.** No frame moves an option that is on screen. Every frame adds at the end of the listbox, or in the trailing
lines after it.

- **Before the database part settles, the popup shows only the loader.** No option shows, so nothing can move. The
  database part settles once: at its frame, at a failure, at its deadline, or parked offline. Then the database line,
  both groups and `Not listed?` appear together.
- _Why `Not listed?` waits:_ the database frame adds up to 20 foods above it. Shown earlier, it moves down by all of
  them. That is the largest move in the list, and Use as written is what a fast typist reaches for. L1's deadline
  (`FOOD_SEARCH_DEADLINE_MS`, 3,000 ms) bounds the wait. Offline, it shows at once.
- **The database line never changes after the settle.** New text can change its height. Anything said later goes in
  the trailing lines.
- **The database deadline.** At that deadline, with no database frame yet, the whole answer stops. Admitted remote
  calls still run to completion on the server and fill the cache (ADR-0055 point 6). A database frame that arrives
  later is never shown.
- **Keyboard highlight and focus.** DOM focus stays in the field for the whole answer (APG). The web leaf holds the
  highlight by option key (`UI/combobox/Combobox.tsx`, module doc). Frames only append, so the highlighted option also
  keeps its place on screen. An option's key comes from its source and the food's sealed reference, never its index.
- **No `aria-busy` on the listbox.** WAI-ARIA 1.2 lets assistive technology ignore changes inside a busy element
  until it is no longer busy (`aria-busy`, fetched 2026-10-02). That hides arriving foods from a cook who is moving
  through them. Each frame leaves the listbox complete, so the spec's rule for a widget that lacks its owned elements
  does not apply.
- **A new text starts a new answer.** The old request is cancelled, and none of its frames show for the new text
  (`entrySearchViewOf`, rule 2).
- **A reconnect resumes the parked answer.** `Not listed?` and `None of these?` stay on screen, because removing a
  control under the cook is worse than moving it. The database frame pushes both down. Remote groups land between
  them, so they push `None of these?` down. P1's order holds. This is the one accepted exception to the rule.
- **The app's cache.** A complete answer stays cached for its text, so a failed pick can be retried with no new search.
  An incomplete or failed answer is never kept as the text's answer. A kept one makes "Edit your search to try again"
  bring back the same gap.
- **Web placement:** P9.

### P3. The loader

- One line, last in the popup: a still glyph and its text. It is the `loading` kind of a trailing line (system
  change 11).
- Until the database part settles, its text is `ingredientPickerSearch.searching` (`Searching ingredients`). After that,
  until the answer ends, it is `ingredientRemoteSearch.stillSearching` (`Still searching other food databases`).
- It names no source. The apps learn a source from its frame, so the loader cannot name one that has not reported.
  "Other food databases" is true, because R62 asks every remote source that can search.
- **It never animates.** Once foods show, it sits beside usable options, and a remote wait can pass 5 s. SC 2.2.2 then
  needs a way to pause, stop or hide anything that moves (_Understanding SC 2.2.2_, fetched 2026-10-02). A still glyph
  needs none. `PendingBar` already keeps results still beside a wait (`UI/pendingBar/PendingBar.native.tsx`, module
  doc). The words carry the state.
- **It always ends**: at completion, at the end of the body, or at the overall deadline. The budget is 10 s from the
  request, because past 10 s a person turns to another task (corpus `interaction-motion.md`, response-time limits). S7
  fits food's wait for each source inside it. The architect sets the client's figure.
- It sits below every option, so its going moves no option.
- **No placeholder rows.** They reserved the height of results in a known place. Foods now arrive above the loader, so
  there is nothing to reserve.

### P4. How many foods per group

- At most **10** in every group: `Your foods`, `Food catalog` and each `From {source}`. One rule and one constant
  (`FOOD_GROUP_CAP`, `FR/hooks/foodSuggestions.model.ts`).
- The client slices whatever a frame holds. So a larger page from a source cannot lengthen the list.
- Each group keeps food's order. The client never re-ranks and never merges groups.

### P5. How a remote food names its source

- **The group heading names it:** `From {source}`.
- **Each hit's accessible name names it too:** `{name}, from {source}`. On native a group heading is header text only,
  so a screen-reader user moving through hits hears the source on each one. The name starts with the visible text
  (2.5.3).
- **No visible tag on a hit.** The heading already says it. That is L4's rule for the cook's own foods.
- **`{source}`** is the register's `shortName`, else its `name`, read through `useDataSources`. While that read is
  pending or failed, it is `ingredientRemoteSearch.sourceUnnamed` (`another food database`). It is never the raw id.
  Source names are not translated (`ingredientSpecialization.md` §S14, D11).
- **No string starts a sentence with `{source}`.** So the fallback reads correctly in every template.
- **A hit has no variant and no detail line** (R64).
- **A hit's name is the name its root will carry** (system change 13). So the line never shows a name the cook did not
  choose.
- **The longest real names** (`FS/sources/sourceRegister.ts`): `Livsmedelsdatabasen` (19 characters) is the longest
  short name. `Swiss Food Composition Database` (31) is the longest name with no short name. Today only USDA searches.

### P6. Every state

No line is live (system change 2). The channel column says what the host passes, and P7 says when.

| State                                                      | What shows                                                                                                                                                                                                                                                                                              | Channel                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Text below the minimum                                     | `ingredientSearch.tooShort` before the list. No options, no loader and no request.                                                                                                                                                                                                                      | none                                           |
| No frame yet                                               | The loader alone: `Searching ingredients`.                                                                                                                                                                                                                                                              | polite: `searching`                            |
| Database part arrived, remote still asked                  | Any database line (L3), `Your foods`, `Food catalog`, `Not listed?`, then the loader: `Still searching other food databases`.                                                                                                                                                                           | nothing new until P7                           |
| A remote source answered, with foods                       | Its group `From {source}`, after the last group.                                                                                                                                                                                                                                                        | P7                                             |
| A remote source answered, with nothing to show             | Nothing. Never "{source} has nothing": R66 hides a hit for a food our catalog holds, so the source can have had matches.                                                                                                                                                                                | P7                                             |
| A remote source busy                                       | A trailing note: `sourceBusy`.                                                                                                                                                                                                                                                                          | P7, polite                                     |
| The cook's own limit                                       | One trailing note for the answer: `sourceLimited`, or `sourceLimitedLater` with no end time. `{sources}` lists every source it skipped, in the locale's list format (`Intl.ListFormat`). One budget covers every source, so one note says it once. The limit is held for the session (system change 9). | P7, polite                                     |
| A remote source unavailable                                | A trailing note: `sourceUnavailable`.                                                                                                                                                                                                                                                                   | P7, polite                                     |
| Complete                                                   | The loader goes. On the trailing row, `Create my own food` arrives (P1).                                                                                                                                                                                                                                | P7                                             |
| The body ended without completion, or the overall deadline | What arrived stays. The loader goes. A trailing note: `incomplete`. `Create my own food` arrives.                                                                                                                                                                                                       | P7, polite                                     |
| One database group fails alone                             | Its L3 sentence as the database line: first among the trailing lines when the other group has foods, above the list when it has none (V3-M2a).                                                                                                                                                          | polite, with the count                         |
| Both database groups fail, remote still asked              | `ingredientDatabaseUnavailable` as the database line.                                                                                                                                                                                                                                                   | polite, with the count                         |
| Every part fails, or nothing arrived                       | With a database frame, its line stays and each source's note shows. With no frame, `ingredientPickerSearch.failed` is the database line. `Not listed?` and `Create my own food` show. No loader.                                                                                                        | **assertive**: `ingredientPickerSearch.failed` |
| Offline: the answer is parked                              | `Not listed?`, then `Create my own food` under `None of these?` (P1), then a trailing line, `readOffline`, in the loader's place. It resumes by itself (R2).                                                                                                                                            | polite: `readOffline`                          |

- "Nothing arrived" covers a transport error, a 5xx, a rate-limit refusal of the search itself, and the database
  deadline. L3 already counts each of these as failed.
- Only one case shows `ingredientNoSuggestions`: both database groups answered with no food. It speaks of our
  database alone. So it stays true after remote foods arrive.
- A remote outcome is a polite note. The cook pressed nothing, and the database foods still stand. A refused press is
  assertive (item 10). That is a different event.
- `sourceBusy` says try later. `sourceUnavailable` and `incomplete` say edit and try now. That keeps §S14's rule:
  busy means later, failed means now.
- A limit note's `{time}` follows item 10's clock rule.

### P7. When the count is spoken: once, at completion, with a 1 s guard

**Decision.** One polite announcement per text, at the end of the answer. If the answer still runs 1 s after the
database part settled, the database part is said then. The rest is said at the end of the answer.

- **Fast path,** the common case, where remote answers come from the cache: one announcement. It holds the total
  count (`ingredientSuggestionCountOne` or `…Other`) or `ingredientNoSuggestions`, then each unavailable sentence and
  each source note.
- **Slow path.** At the database settle plus 1 s: the database count or `ingredientNoSuggestions`, any L3 sentence,
  then `stillSearching`. When the answer ends: `moreOne` or `moreOther` for each source that added foods, then each
  source note. With no food added and no failure, it says `noMore`.
- **Every part failed:** `ingredientPickerSearch.failed`, assertive, once.

**Why not per frame.** Per frame gives one message per source, plus one. Frames from the cache land together. On iOS
the native `LiveRegion` makes an announcement (V1 sign-off Rule 3), and a new announcement can cut off the one before.
So frames that land together cut each other off. That is reasoned, and not checked on a device.

**Why not at completion alone.** A remote miss can take seconds, and a sighted cook already sees the database foods. A
screen-reader user then hears nothing for that whole wait. That gives them less than a sighted cook gets.

**Why 1 s.** Up to 1 s, a person's flow of thought is not broken (corpus `interaction-motion.md`). Algolia
Autocomplete calls itself "stalled" after 300 ms by default (`stallThreshold`, fetched 2026-10-02). I took the longer
limit so that more answers from the cache take the fast path. Judgement.

**Accepted cost.** An answer that ends just after the guard still gives two announcements close together. The second
is short: `noMore`, or one `more…` sentence.

**Mechanism.** The house `useReadDeadline` is the guard. Its key is the text, from the moment the database part
settles, and `undefined` before. Its time is 1,000 ms. As R3 requires, the host changes `countAnnouncement` only at
these moments. Between the settle and the guard it stays `Searching ingredients`, which is silent.

### P8. A remote pick

A cook picks a remote hit by the reference food issued. One command turns it into a catalog root (ADR-0055 point 10).
Then the line commits as any catalog pick does.

| State                                                 | What the cook sees                                                                                                                                                                 | Channel                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Adopting                                              | The list closes, as every pick closes it. The field is busy and keeps its text. The row's caption is `ingredientEntryAddingFromSource`.                                            | as a catalog pick (`rowBusyText`) |
| Adopted                                               | The line commits. `statusResolvedConfirmation`, with the root's name. Focus follows §2d.                                                                                           | polite                            |
| Failed: no answer, a 5xx, or the line's commit failed | `ingredientRemotePickFailed`. The text stays. Choosing the hit again retries. The command is idempotent on source and key, so a retry never makes a second root.                   | assertive                         |
| Refused: the hit is no longer valid                   | `ingredientRemotePickGone`. The text stays. The cached answer for this text is dropped, so the list asks again.                                                                    | assertive                         |
| Source busy                                           | `ingredientRemoteSearch.busy`.                                                                                                                                                     | assertive                         |
| The cook's limit                                      | `sourceLimitReached`, or `sourceLimitReachedLater`. The limit is held. Up to `{time}`, a press on any remote hit or row 6 candidate makes no request and repeats it (item 10, R8). | assertive                         |
| Offline                                               | As any pick: tried, never refused ahead of time, and waiting with its caption (`ingredientStatusExplanation.md` §7).                                                               | as a catalog pick                 |
| The recipe changed (`409`)                            | The editor's conflict state (blueprint decision 7). The new root stays, and it is harmless.                                                                                        | as today                          |

- While the cook's limit stands, the hits stay choosable. They are true answers. A press says the limit.
- A remote hit has no `Slow` tag. The wait follows the cook's own choice, and the caption names it.

### P9. Defect (a): the open list covers `Next` on desktop

⚠️ Amended by V3-1 (2026-10-03): the third observation below is wrong, and the side choice is decided there.

**Observation, from source, not rendered.**

- At `lg` and wider, the wizard's controls, `Next` among them, sit in its header band, `sticky top-0 z-20`
  (`FR/wizard/Wizard.tsx`, `WizardHeader`).
- The web popup is `z-50` (`UI/combobox/Combobox.tsx`). Floating-ui flips it above its field once the space below runs
  out, and keeps only 8 px from the viewport's edge. So it can paint over the band, and over `Next`.
- Below `lg`, the controls bar is `fixed bottom-0 z-60` (`Wizard.tsx`). It paints over the bottom of a popup that
  opens downward. The loader and the remote groups are now at that bottom.

**Is "Escape closes the list first" enough? No.**

- For a keyboard user it is enough today. Tab out of the field closes the list, so `Next` never takes focus under it
  (2.4.11 holds).
- For a pointer it is not. The list now stays open for the whole answer, and it grows.
- The reverse overlap, the bar over the list, has no Escape answer at all. It hides the loader and the remote foods.

**Decision** (system change 12).

- The popup's space leaves out the host's fixed and sticky chrome. The editor passes the header band's height above
  and the bar's height below. Floating-ui's collision padding applies them.
- The chrome stacks above the popup. If they ever meet, the page's own controls win.
- The popup picks its side once per text. A popup above its field takes its full height at once, so arriving content
  fills it from the top down and its top edge never moves (P2's rule).
- Escape keeps its job: it closes the list first (`ingredientStatusExplanation.md` SPECIFY.3, 2.1.1).
- With pending text, `Next` and Save Draft refuse anyway (R5, R6). `Previous` does not. So every control in the band
  must stay visible.

**Native.** The controls bar is a sibling below the scroll view, or, once unpinned, the scroller's last item
(`FR/wizard/Wizard.native.tsx`, module doc). The in-flow list cannot pass under it. Nothing to change.

### P10. Web and native (agent §3.6)

⚠️ Amended by V3-2 (2026-10-03): the popup's width.

| Element         | Web                                                                                  | Native                                                                                 | Disposition                   | Why                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The list        | an overlay below its field, its side fixed per text, inside the chrome's insets (P9) | in flow below its field (item 7)                                                       | kept, as item 7 decided       | Android takes no touches outside a parent's bounds (item 7).                                                                              |
| The loader      | the popup's last line, under a listbox that scrolls, so always in view               | the list's last line. With the keyboard up and a long list, it is below the fold       | kept. Native's view is a cost | The cook reaches it on the same scroll that reaches `Not listed?` and the remote foods. A screen-reader user hears `stillSearching` (P7). |
| Remote groups   | labelled `role="group"`                                                              | header-role text over buttons                                                          | kept                          | 1.3.1 on each.                                                                                                                            |
| Arriving frames | append in the listbox, which keeps its scroll position                               | append in the page, which keeps its scroll position. Content below the list moves down | kept                          | On native the cook's finger is in the list, above what moves. Item 7 accepts that rows below move.                                        |
| Escape          | closes the list                                                                      | none. Android back closes the keyboard, then cancels (item 4)                          | moved                         | Touch has no Escape.                                                                                                                      |

- **Primary action, by reach.** On both platforms the first food sits right under the field. Item 7's budget keeps
  the field and three options above the keyboard. Remote foods are never the primary action. On a phone with the
  keyboard up they need a scroll. That is accepted, because they are only foods our catalog lacks (R66).
- **Hover, right-click, drag:** none in this list. **Keyboard:** arrows and Enter on web, taps on native, Tab with a
  native hardware keyboard (R4).
- **Longest strings.** A heading such as `From Swiss Food Composition Database` wraps. Headings and notes are text,
  not controls. A note wraps to 3 or 4 lines at 320 px. A hit name of 120 characters or more wraps in full, as catalog
  names do. It is never cut, because its tail tells foods apart (`ingredientStatusExplanation.md` §3a). At +35%, the
  same rules hold. Reasoned, not rendered.
- **320 CSS px.** The popup is as wide as its field, and labels break words. Nothing scrolls sideways (1.4.10).
  Reasoned from source.
- **Keyboard open (native):** item 7's three conditions, unchanged.
- **Where the rules live.** P1 to P7 live in `entryComboboxOf`, which both leaves render. P3 and P9 live in the
  primitive. So no screen decides them again.

### P11. Accessibility contract (WCAG 2.2 AA)

- **1.3.1:** every group is labelled: `role="group"` with `aria-label` on web, header text on native. A hit's
  accessible name carries its source (P5). For every native View, the naming rule is `nativeContainerNames.md` N1.
- **1.3.2:** the reading order is the visual order: the groups in P1's order, with the database line before them
  when our database found no food and first among the trailing lines when it found one (V3-M2a). The host moves the
  line between slots in the DOM, never with CSS `order`.
- **2.1.1 / 2.1.2:** on web, arrows and Enter reach every option. On native, a tap does. Escape and Tab never trap.
- **2.2.2:** the loader never moves (P3). The list changes a few times, each time in answer to the cook's own typing,
  and then stops. I judge that this is not the "auto-updating information" 2.2.2 means. Judgement.
- **2.4.3:** focus stays in the field for the whole answer. After a remote pick it follows §2d, as any pick does.
- **2.4.11:** the popup never sits under or over the page's chrome (P9). On native, the keyboard never covers the
  field (item 7).
- **2.5.3:** every accessible name starts with its visible text: `{name}, from {source}` and
  `Create my own food, opens a form`.
- **2.5.8:** options are 44 × 44 CSS px on web and 48 × 48 dp on native. The loader and the notes are not targets.
- **3.2.2:** no frame selects, commits or moves focus. `Create my own food` says in its name that it opens a form
  (item 1).
- **3.3.1:** each pick failure names the food and what to do next (P8).
- **4.1.2:** no `aria-busy` on the listbox (P2). A busy option keeps `aria-busy` and `aria-disabled`.
- **4.1.3:** P7. The list is polite. Only a failure of every part, and a refused or failed pick, are assertive.

### P12. `AmbiguityReview`, and row 7's shortlist

Both surfaces re-derive a shortlist from the same food search (`FR/detail/AmbiguityReview.tsx`,
`FR/form/shortlistPanel.ts`). The owner ruled on 2026-10-02 that every place a cook picks a food shows remote foods:
adding a food while creating a recipe, changing a food inline while editing one, and answering which food a line
means. So both surfaces, and row 6's candidates, read the progressive answer as the editor's list does.

**Defect (b), fixed under either answer.**

- Today, with both searches failed, the review row says nothing: `reviewShortlistStatus` returns `''` for `failed`
  (`FR/detail/model.ts`). It also offers no retry: its Try again shows only after a failed pick.
- **Fix.** The row's status line says `candidatesLoadFailed` (`We couldn’t load options for that ingredient.`). Row 7
  already says that for the same fact. The row shows its Try again, which asks the row's search again.
- With both searches answered and no food, the row says `candidatesEmpty` (`No options to choose from.`), as row 7
  does. Today the row is empty.
- Each row's Try again gets the accessible name `ambiguousReviewRetryLabel`, `Try again for “{phrase}”`, because the
  page has one per row. It starts with the visible text (2.5.3).
- These sentences are polite, in the row's existing `role="status"`. Opening the review searches every row at once.
  As alerts, one outage fires one alert per row.

**What the ruling means for both surfaces:**

- Both read the progressive answer: database foods first, then each source's foods under a `From {source}` label,
  added at the end. Nothing already shown moves (P2).
- A review row's waiting line goes after its chips. Today its status line sits above them. A line there that empties
  at the end moves every chip up.
- A row speaks once, at the end of its answer, through its existing status line (P7, per row).
- A remote pick adopts first, then writes as today. P8's states and copy apply.
- **The cost to weigh.** Opening the review searches every row at once. Each cache miss spends the cook's hourly
  budget, once per row and source.

**One pick binds one line.** The review now commits each pick through the rebind command for that line alone, as
row 7 does (`ingredientStatusExplanation.md` §2c, owner ruling 2026-10-02), so a remote pick creates one root and
binds one line.

### Copy (`en`)

`RecipeFormMessages` (`FR/form/messages.ts`):

| Key                                                   | `en`                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ingredientNoSuggestions` (rewritten)                 | `Nothing in your foods or the food catalog matches “{query}”. Keep typing, or find its nutrition by name.` |
| `ingredientDatabaseUnavailable` (new)                 | `Your foods and the food catalog are unavailable right now.`                                               |
| `ingredientSuggestionsCreateHeading` (new)            | `None of these?`                                                                                           |
| `createOwnFoodOptionName` (new, accessible name only) | `Create my own food, opens a form`                                                                         |
| `ingredientEntryAddingFromSource` (new)               | `Adding from {source}`                                                                                     |
| `ingredientRemotePickFailed` (new)                    | `We couldn’t add {name} from {source}. Try again, or choose another food.`                                 |
| `ingredientRemotePickGone` (new)                      | `{name} isn’t available any more. Choose another food.`                                                    |

Shared `recipeMessages` (`FR/messages.ts`), new group `ingredientRemoteSearch`. It replaces `ingredientLiveSearch`,
which S7.9 deletes.

| Key                                                                            | `en`                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `groupHeading`                                                                 | `From {source}`                                                                                                                                                          |
| `hitName`                                                                      | `{name}, from {source}`                                                                                                                                                  |
| `sourceUnnamed`                                                                | `another food database`                                                                                                                                                  |
| `stillSearching`                                                               | `Still searching other food databases`                                                                                                                                   |
| `moreOne` · `moreOther`                                                        | `1 more food from {source}` · `{count} more foods from {source}`                                                                                                         |
| `noMore`                                                                       | `No more foods found.`                                                                                                                                                   |
| `incomplete`                                                                   | `The search didn’t finish, so this list isn’t complete. Edit your search to try again.`                                                                                  |
| `sourceBusy`                                                                   | `We couldn’t search {source} just now. Try again later.`                                                                                                                 |
| `sourceUnavailable`                                                            | `We didn’t hear back from {source}. Edit your search to try again.`                                                                                                      |
| `sourceLimited` · `sourceLimitedLater`                                         | `You’ve reached your limit for food lookups until {time}, so we didn’t search {sources}.` · `You’ve reached your limit for food lookups, so we didn’t search {sources}.` |
| `busy` (moved from `ingredientLiveSearch`, now with `{source}`)                | `Lookups from {source} aren’t available right now. Try again later.`                                                                                                     |
| `sourceLimitReached` · `sourceLimitReachedLater` (moved, now naming no source) | `You’ve reached your limit for food lookups. You can try again at {time}.` · `You’ve reached your limit for food lookups. Try again later.`                              |

`recipeMessages.detail`: `ambiguousReviewRetryLabel` (new) = `Try again for “{phrase}”`.

- **Reused as they are:** `ingredientPickerSearch.searching` and `.failed`, `ingredientSuggestionCountOne` and
  `…Other`, `ingredientCatalogUnavailable`, `ingredientAuthoredUnavailable`, `ingredientSuggestionsMoreHeading`,
  `readOffline`, `statusResolvedConfirmation`, `candidatesLoadFailed`, `candidatesEmpty`.
- **Retired with S7.9:** every other `ingredientLiveSearch` key.
- Plurals follow this file's `…One` and `…Other` convention (§S11). ⚠️ CLDR has up to six plural forms, so that
  convention fails in some languages (corpus `internationalisation.md`). That is a class for `@commise/i18n`, not
  for this list.

### Advocacy

- **R66 has a cost the cook pays, and food already measures it.** Say a cook types "garbanzo", and our catalog holds
  chickpeas under another name. The catalog group misses it. USDA's chickpea hit is hidden, because we hold that food.
  The cook sees nothing, though we have it. The owner ruled R66, and the search-gap record exists for this case. I
  recommend no change now. Watch the gap count. If gaps are frequent, the fix is a synonym backlog. Situation B, "I
  recommend".
- No other divergence from the cook's interest found.

### Amendments owed (the lead applies them)

- `ingredientSpecialization.md` §S14: two of its rules reverse here. "Never groups them by source" reverses. Frames
  arrive at different times, and only a group per source lets each one append without moving rows (P1).
  The hit's visible source tag reverses (P5). The live option and L1 to L9 retire. `hitName` becomes
  `{name}, from {source}`.
- `ingredientSpecialization.md` §S13 P4 and §S18: the remote groups and `None of these?`.
- Plan 002's S7 row: the four wire needs (system change 13), the 10 s budget (P3) and the questions below.

### For the architect, not the owner

- Does the progressive request retry once before its first frame? L1 allows one transport retry. R65 forbids an
  automatic retry of a remote call, and a retry before any frame resends calls that food already admitted.
  The list needs only that the cook never sees a retry.
- The client's overall deadline, inside the 10 s budget (P3).
- Whether a remote pick made offline queues the adopt command and the line's commit as one write (P8).

### Validation (agent §6c)

1. **Against publication.** _Understanding SC 2.2.2_ (fetched 2026-10-02) decides the still loader. WAI-ARIA 1.2's
   `aria-busy` (fetched 2026-10-02) decides that the listbox is never busy. The corpus gives the 1 s and 10 s limits.
2. **Against prior art.** Algolia Autocomplete's `stallThreshold` (default 300 ms, fetched 2026-10-02) shows that a
   stall threshold is common practice. Its page does not say whether it renders sources as they arrive. So I cite
   only the threshold.
3. **Against myself.**
    - _Against remote groups after `Not listed?`:_ remote foods beat Use as written, so they belong first.
      _Answer:_ that order moves Use as written under the pointer at each frame, and a mis-press there creates a
      catalog root. Stability wins. `Not listed?` still reads true, because remote foods are foods our catalog lacks
      (R66).
    - _Against hiding `Not listed?` until the database settles:_ R5 says Use as written is always on offer. _Answer:_ the
      wait is at most 3 s online, and offline it shows at once. Shown earlier, it moves by up to 20 rows.
    - _Against the still loader:_ an indeterminate spinner past a few seconds reads as broken (corpus), and a still
      one can read as frozen. _Answer:_ the words say what is happening. **Flip:** a test where cooks read it as
      frozen. Then it animates for at most 5 s.

### Not checked

- Nothing was rendered. P9's overlaps are reasoned from class names and stacking order. One render at 1280 px and one
  at 390 px are owed.
- No screen reader ran. P7's two-announcement edge needs VoiceOver and TalkBack.
- The share of answers that take P7's fast path is unknown until S7 runs.

### Success measure

- **Nothing moves.** On both leaves, a component test feeds frames one at a time. It asserts that every shown option
  keeps its index and its key. A Playwright spec holds a keyboard highlight across a frame.
- **One announcement.** The share of answers that end within 1 s of the database settle. If most take the slow path,
  revisit P7's guard.
- **Remote foods help.** The share of remote picks that adopt without failure. How often `Create my own food` follows
  a search that showed remote foods.

## V3 rulings (2026-10-03)

**Standing.** EVALUATE plus decisions, from the V3 review (`docs/design/v3Evaluation.md`). I rendered the web app
through Playwright with the repo's mocks. Native was read in code only. These rulings bind the build. Each names where
its rule lives.

### V3-1. Where the web popup goes (amends P9)

- **P9's observation was wrong.** The bar does not paint over the popup. The popup paints over the bar: the band is
  `sticky z-20`, which makes a stacking context, so the bar's `z-60` counts only inside it (`FR/wizard/Wizard.tsx:463`,
  `:546`). Measured at 390 × 844: the popup covers 54 of the bar's 62 px, and `Create my own food` sits where Next was.
- **The side is chosen against the popup's full height.** Its height with only the loader in it is the wrong input.
  floating-ui's `flip` judges overflow from the element's current rect (`@floating-ui/core` 1.8.0). So the popup first
  renders at a fixed probe height, `h-[min(20rem,calc(100dvh-1rem))]`, hidden with `invisible`. The probe must not
  read `--combobox-available-height`: `size` writes that property, and it stays on the element from the last text. A
  probe that read it measures the old side's space, and always fits. floating-ui
  places it, and that placement is the text's side. Then below takes the `max-h` class as today. The side still holds
  for the whole text (P2).
- **Binding:** the popup never covers the page's own fixed or sticky chrome. Its space, its side and its height leave
  out the band above and the bar below.
- **Mechanism, approved by the lead and built (2026-10-03)** (it adds a cross-package seam and two ref sites). As built, the insets trim floating-ui's clipping area rather than its derivable options, which floating-ui keeps from the first render; the side is below if the probe fits, else above, else the side with more room:
  `@commise/ui` gains one context, `PopupInsets`. Its value is a
  function that returns `{ top, bottom }`: the CSS px of the viewport that the page's own fixed or sticky chrome covers
  at the moment it is called. The default returns zeros. The web `Combobox` calls it inside floating-ui's derivable
  options. So `flip`, `shift` and `size` each add it to the 8 px margin. `autoUpdate` reads it again on each scroll.
  The web `Wizard` provides it. It holds its band and bar nodes in state through callback refs. That is the
  combobox's own idiom, so there is no `useRef`. Each call reads their rects. `top` is the band's bottom edge, or 0 for
  a band out of view. `bottom` is the viewport height minus the bar's top edge, or 0 for a bar that is not `fixed`. The lead adds the two ref
  sites to the pattern register.
- **Residual:** `autoUpdate` watches only the field and the popup. When the bar grows with a refusal, the insets are
  stale until the next scroll or resize.
- **No z-index changes.** With the insets applied, the popup and the chrome do not meet. A change to the band's layer
  moves every other layer that sits in it.
- **Native:** unchanged. The bar sits outside the scroller (`Wizard.native.tsx`).

### V3-2. The popup's width (amends P10's "as wide as its field")

- The popup is as wide as its field. A field narrower than 20rem gets a 20rem popup. The popup is never wider than the
  viewport less 8 px each side.
- In rem, through CSS: `size`'s `apply` sets `--combobox-reference-width` and `--combobox-available-width`, and the
  popup's class is `w-[max(var(--combobox-reference-width),min(20rem,var(--combobox-available-width)))]`. That is the
  same pattern as the height property today, and the same 20rem as `@commise/ui/popover`.
- `shift({ padding })` sits between `flip` and `size`. Near the right edge the popup slides left and keeps its width,
  instead of shrinking (measured at 320 px: 248 px today). With `shift` on, floating-ui reports the whole viewport as the
  available width.

### V3-3. Status lines never squeeze the list

- The listbox keeps a floor of up to three option rows: `min-h-11`, `min-h-22` or `min-h-33`, chosen by the option count
  (1, 2, 3 or more). An option is `min-h-11` already.
- The popup gets `overflow-y-auto`, so no line paints outside its card. Two scrollers nest only in one case: the
  lines and the floor are taller than the popup. That is accepted. downshift's `scrollIntoView` uses the card as its
  boundary (`compute-scroll-into-view`, `block: 'nearest'`), so the active option scrolls into view in the listbox
  and in the card.
- The loader stays pinned after the listbox (P10).
- **Not solved here:** at 640 × 360 with 200% text the wizard's band and bar take 258 of 360 px. That is
  `compactHeightLayout.md` A1's rule, which is mobile-only today. The lead decides whether it reaches the web bar.

### V3-4. The active option shows a ring

- `aria-selected:bg-pearl aria-selected:ring-2 aria-selected:ring-inset aria-selected:ring-seafoam`, the details
  dialog's active row (`FR/details/VariantOption.tsx:67-69`). Today the pearl fill alone is 1.09:1 against its neighbours.

### V3-5. `tag` goes

- Delete `ComboboxOption.tag` from `UI/combobox/props.ts` and both leaves, and its tests. P5 and L4 forbid a visible tag.
  A new need for one starts from a spec.

### V3-6. The loader glyph stays a still magnifier

- It names the activity, search, which is in the small set of icons people know without a label
  (`visual-systems.md`). The words carry the state (P3). It never animates. The same glyph on both platforms.

### V3-7. A remote pick in analytics: accepted, measured elsewhere

- The query-outcome wire has no remote group, so a remote pick ends its session as a no-pick
  (`FR/analytics/queryOutcome.model.ts`). The cook never sees it. P7's "remote foods help" measure is read from food's
  adopt outcomes on the server, which already records each one. The client wire change is owed later, not now.

### V3-8. An offline adopt is held in memory: accepted

- Every pick is held in memory while offline, on both platforms, and web does not persist by owner ruling
  (`offlineWriteAcceptance.md`). The adopt matches them. One rule for later: when recipe writes join the queue, the adopt
  and the line's commit queue as one item, never the adopt alone.

### V3-9. A review row says it is adding a remote food

- While a remote pick on a review row adopts and re-points the line, the row shows `ingredientEntryAddingFromSource` as
  a caption after its chips, not live. The busy chips carry the state for assistive technology, as P8 says ("as a catalog pick"). Both
  platforms.

### V3-10. Copy and P12, as built

- `sourceLimitedLater` and `sourceLimitReachedLater` are dropped. A `limited` frame always carries its seconds, so the
  time is always known. P6 and P8 now read: the note and the refusal always name a time.
- P12's "P7, per row" now reads: a review row speaks once, at the end of its answer, and only what its list did not
  show. A row with nothing to report stays silent, so a review that opens N rows does not speak N counts.

## End-of-plan rulings (2026-10-03)

**Standing.** EVALUATE plus decisions, by `staff-ux-engineer`. I wrote the specs under test, not the code. Native
evidence: Maestro hierarchy dumps and screenshots from API 34 and Android 15 (local run, 2026-10-03). Every "the
cook" sentence is heuristic judgement, untested with users. The naming rule from this review is in
`nativeContainerNames.md`.

### E1. The list behind the pinned bar (builds item 7, condition 2)

- **Observed** (Android 15, upright, keyboard open, the add-loop dump). The scroller shows 288 to 1063 px, about
  295 dp. The field sits at 877 to 1003. The list starts at 1014, and the scroller clips it at 1063. The count says
  20 foods. The cook sees none.
- **Observed.** R7's refusal opened this list, not a keystroke: the flow pressed Next, and the refusal moved focus
  to the field with its list. The bar is 172 dp only because the refusal notice shows.
- **Observed.** The bar is pinned, as A1 says: header and bar 234 dp, against half the frame, 264 dp.
- **Criterion.** Item 7, condition 2: the field and three options show. It was never built. Nothing scrolls the
  field. `RecipeEditor.tsx` scrolls only on a step change (`useScrollResetOnChange`). Nielsen #1.
- **What the cook sees.**
    - The trigger is each change of the popup from hidden to shown. A keystroke does it, and so does R7's focus
      request with its list.
    - At that moment the leaf asks the host to show the field and three 48 dp option rows. The host decides. Do
      they fit in the visible area? If not, the field moves up to its top, with an 8 dp gap. The foods show under
      it, above the bar.
    - It moves once for each opening. Later frames add rows below. The field does not move again (P2).
    - The bar stays where A1 puts it.
    - With reduced motion on, the move is instant. Otherwise it is the platform's own animated scroll.
- **Room to move.** The trailing row is near the end of the content, and the first frame can hold only the loader.
  Then a plain scroll stops short, and P2 forbids a second move. So, while the list is open, the scroll content ends
  with blank space. It is only as tall as the field needs to reach the top, and zero with enough content below.
  It is the scroller's last child, after the bar in A1's slot A, so an unpinned bar does not move. The list closes,
  and the space goes. This is the native twin of V3-1's probe: decide on the list's budget, not on its first frame.
- **Rejected.** Cap the list above the bar: the list is in flow under the field, so a cap only shortens it. Unpin
  while the keyboard is up: §4.1 rejected it, the bar fits here, and it costs U32 in the common case.
- **Where it lives.**
    - The trigger is in the native leaf, `UI/combobox/Combobox.native.tsx`. It knows the moment its popup shows, and
      it already holds the field's ref. So every host gets it. The leaf holds no geometry.
    - The fit test, the scroll and the space are in the host's scroller. The leaf reaches them through a new `@commise/ui` context,
      the native sibling of V3-1's `PopupInsets`. Its default does nothing.
    - Providers: `MOB/screens/RecipeEditor.tsx` and `FR/form/RecipeForm.native.tsx`, the two hosts item 7 names. A fix
      in the wizard alone leaves the edit form broken.
    - It adds a cross-package seam. So `staff-architect` signs off a BLUEPRINT first, as for V3-1.
    - Not reached: the filter bar's ingredient typeahead is a plain `TextInput` (`FR/filters/RecipeFilterBar.native.tsx`),
      not this primitive. Noted, not ruled.
- **How it fits.** A1 and §4: no change. The rule reads the scroller's viewport, never the bar, so it holds in both
  slots. V3-M2a: no change. The move brings into view what M2a put first, the first food. Its accepted cost stands.
- **Seen, not ruled.** The bar measured about 172 dp: a two-line notice and a wrapped row. §4.3 budgets 69 dp, and
  §4.2 expects a wrap only at 200% text. The dump does not give the font scale. At 100%, the row wraps for one reason:
  `Prev: Details`, `Save Draft` and `Next: Instructions` need more than 411 dp. Owed: check the scale.
- **Tests owed, red first.**
    - Component, `UI/combobox/__tests__/Combobox.native.test.tsx`: the first popup show calls the context once, with
      the field. A second frame and a re-render do not call it. A mount or re-render with `focusRequested` and
      `listRequested` calls it once. With no provider, nothing happens.
    - Component, `mobile/tests/screens/RecipeEditor.native.test.tsx` and `RecipeForm.native.test.tsx`: with a 295 dp
      viewport and the field near the end, the scroller gets one scroll to the field's top. The space is there only
      while the list is open.
    - Maestro, `addIngredientLoop.yaml`: after typing, the first option is visible with no scroll command. Note: the
      flow's `scrollUntilVisible` swipes from the screen's centre, about y = 1200. That point is on the bar, so the
      flow never scrolled the scroller. Part of today's red is the flow.
    - Device: API 34 and Android 15, upright and sideways, keyboard up.

- **As built (2026-10-03).** `@commise/ui/field-reveal`: a `FieldRevealContext` whose default does nothing, a pure fit
  rule, a reveal state machine, and an Adapter over the scroller (`measureField.native.ts`). `RecipeEditor` is the one
  host. One premise of the blueprint was false and the device caught it: on Fabric, `measureLayout` against the scroll
  view does not subtract the scroll offset (`DOM.cpp` passes `includeTransform: false`), so the Adapter reads the
  offset itself. Verified on API 34 (all flows) and on Android 15 (`addIngredientLoop`, scrolled and unscrolled
  pages). The ingredient-row flows on Android 15 are not yet verified.

### E2. A failed pick that settles while its step is not shown

- **Observed.** `FR/form/useIngredientsFields.ts:106` seeds `movedPast` from `rowEditor.settled` at mount. The row
  editor lives in `MOB/screens/RecipeEditor.tsx:187`, and it outlives the step. So on return, every settled failure
  reads as moved past. That is one that settled while the cook was away, and also one the cook saw and left
  untouched. The hook is shared, so web has the same defect.
- **Criterion.** Item 3: "Pick failed: an alert, and the text stays". WCAG 3.3.1. Nielsen #1 and #9.
- **While the step is not shown:** no alert. The failure's sentence belongs to step 2. On step 1 a sighted cook
  sees nothing of it, and a screen reader interrupts a task the cook chose.
- **The rail carries the cue instead.** Today the rail marks a step `needs attention` only after an attempt, a
  refused Next or Publish (`FR/wizard/model.ts:123-132`). A cook who pressed Previous during the adopt gets no mark.
  New rule: a failed pick counts as an attempt on its step. So while the failed text stands, the rail item reads
  `Ingredients: needs attention`, on every step. Clearing the text clears the mark, unless the step has another
  error. Accepted cost: an empty list then shows as that other error earlier than today. No new key.
- **On return:** the row shows its failure line, the same line a failure on the step shows. No new key. On web, the
  field's `aria-describedby` includes the line, as today. On native, the line comes right after the field in reading
  order. No alert plays at mount. An alert reports an event, and this is now a state. R6 still refuses Next.
- **The line goes** once the cook moves past it: new text, a pick, Change food again, or Cancel. Leaving the step is
  not moving past.
- **Two facts, two lifetimes.**
    - Moved past controls the line. It lives as long as `settled` does, in the host (`useLineCommit` or
      `useIngredientRowEditor`, the implementer's choice).
    - Settled before this mount controls the alert. Today's mount seeding stays, for the alert only.
    - One fact cannot serve both. iOS's `LiveRegion` announces any message present at mount (the effect in
      `UI/liveRegion/LiveRegion.native.tsx`). Android does not do so reliably. A shared fact makes iOS alone speak it.
- **Tests owed, red first.**
    - Hook: a failure settles while unmounted, then shows on remount (red today). A failure seen, left and returned to
      still shows (red today). A failure moved past, then left and returned to, stays hidden. A failure that settles
      while mounted shows and is spoken.
    - Component, both leaves (`RecipeIngredientsFields.rowEditor.test.tsx` and its native twin): on remount the line
      shows. Native, iOS spy: no `announceForAccessibilityWithOptions` call at mount. A new failure while mounted
      calls it once, assertive.
    - Integration, `FR/tests/__integration__/rowEditor.integration.test.tsx`: unmount and remount the field group
      under one host.
    - Rail, both wizard leaves (`Wizard.test.tsx`, `Wizard.native.test.tsx`): a failed pick on step 2 settles while
      step 1 shows, and the rail item reads `Ingredients: needs attention`. With one line in the recipe, clearing
      the text clears it. Red today.
    - Playwright: hold a failing adopt, press Previous, release it, return. The line shows, and it describes the field.
    - Maestro: none. A device flow cannot force the adopt to fail. Stated, not skipped.

### E3. Built behaviour no doc stated

- **Moved past.** Endorsed: a failure line hides once the cook types, picks, uses Change food again, or cancels.
  Not endorsed: the mount seeding, for the line (E2).
- **The authored-food name trim.** Endorsed. Recorded in item 1's DESIGN step.
- **Close labels on a stand-in row** (`FR/form/ingredientRowView.ts:214-224`). A close names what its trigger named.
  The `⋮` close uses `triggerFood`, the stand-in with its amount: endorsed. The glyph panel's close uses
  `displayName`, the bare stand-in: not endorsed. It takes `triggerFood` too. Then `About 2 cups Private ingredient`
  closes with `Close details for 2 cups Private ingredient` (Nielsen #4). Owed: one component test on a stand-in
  row, both leaves.
- **`section-{key}`.** A React key. It keeps a section heading's key apart from its first row's key in one flat list.
  It is not a design rule, so no doc records it. Its one effect: a heading remounts after its first line goes. That
  is harmless, because a heading holds no focus and no state.
- **A dialog keeps its line while it closes.** Endorsed. Recorded in `ingredientSpecialization.md` §S8.1.
- **Both bounds carry the mark.** Endorsed. Recorded in `ingredientStatusExplanation.md` SPECIFY §3, 3.3.1.
