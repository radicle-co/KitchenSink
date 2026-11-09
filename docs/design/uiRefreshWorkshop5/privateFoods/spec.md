# Private foods: the committed design spec (SPECIFY, web and native)

Written 2026-11-09 by staff-ux-engineer. This is a design spec, not production code. It covers the architect's 18
states for the owner's private-food rulings of 2026-11-08 and 2026-11-09. Read it beside the architect's blueprint
(`~/.local/state/kitchensink/briefs/privateFoodsBlueprint2026-11-09.txt`), which owns the wire shapes.

Binding inputs kept, not restated: `../ownerFeedback.md` (R6, R12, N6, N8, B1, C1, T1, T7, T29, T31),
`../nativeBoards/designAnswers.md` (type roles, the 2x cap, the 1.5x chrome cap, no nowrap, #144, 2026-11-08 items 1 to
6, "Pro"), `../../uiOverhaul/buildSpec.md` (§1.4, §1.5, §7.7, §7.8, §7.10), and
`../redesignCanvas/ingredientMatching.md` (the open-choices sheet).

Standing: I read the code and the docs. I rendered nothing. Every layout claim here is from source and the binding
boards, so a board round must check it at 390, 384, 820, 1280 and 320.

---

## 1. Purpose

A cook makes their own food when the catalog lacks it. That food is private. The owner's rules say it can live only in
private recipes. It becomes public only after staff approve the cook's ask. Readers only see an approved
version. The cook needs three things from the UI: to know, before they press Publish, that a line blocks a public
recipe. To see where each of their foods stands with staff. And to get from a blocked line to the fix in one step.
The user need behind the staff gate is theme 1 of `docs/research/userNeeds/synthesis.md`: recipe data that is quietly
wrong loses people's trust (CK-006, FR-011). A shared food is shared data, so it is reviewed.

---

## 2. Decisions

### D1. The refusal (15, 16) is a new sheet, not the publish sheet

- The "publish sheet" with open choices is designed (`ingredientMatching.md` lines 42 to 45, keys
  `editor.publish.openChoices.*`) but **not built**: no code reads those keys. So there is nothing to reuse.
- It is also the wrong kind. The open-choices sheet warns and lets the cook go on ("Publish anyway"). The refusal is a
  hard stop that the server decides. Mixing them puts "Publish anyway" next to something that cannot be published.
- So: `PrivateFoodsRefusalSheet`, a new pair in `features/recipes/src/editor/` (`.tsx` and `.native.tsx`), built on the
  shared `Sheet` (`packages/apps/commise/ui/src/sheet/Sheet.tsx`, `Sheet.native.tsx`). A sheet, not `ConfirmDialog`,
  because `ConfirmDialog` is for destructive steps only by contract (`confirmDialog/props.ts` lines 10 to 13) and this
  holds a list with one button per line. It uses the same Sheet the open-choices sheet will use, so when that one is
  built the two share a frame. Do not extract a shared body now. Wait for the second real user.
- If one press meets both, the order is fixed: the open-choices sheet runs first (it is client-side, before the send).
  If the cook then sends and the server refuses, the refusal sheet opens after the first sheet's `onDismissed`. Two
  modals are never on screen together. This spec sets no other rule for the open-choices sheet, because it is not
  built. The client never blocks a press on its own view (D2).

### D2. Prevent before refusing

The 409 is a backstop. The editor says it first:

- The row's second-line slot (#144 item 6) shows the private-food line (D3) in `attention` while the recipe's chosen
  visibility is Public, draft or published.
- The Photos & publish ready line (buildSpec §7.7 item 3, the D20 pattern) adds: "{count} ingredient uses your private
  food, so this recipe can't be public yet." It is a link that jumps to the first such row, like "Fix {n} things".
- Publish stays enabled. The server re-checks each food (staff can approve a food after the client loads it),
  so the client never blocks the press on its own view.

### D3. What a private food looks like in the editor

- It is **not** a `StandIn`. A stand-in means a name was withheld (`standIn/props.ts`), and here the cook owns the food
  and sees its name.
- In a **private** recipe: the row's second line holds a `StatusBadge` with `status="private"` and the words "Private
  food" (lock glyph, `pearl` fill, `ink` text, buildSpec §1.4 "Status"). When the row also has a "Counted as {food}"
  line (2026-11-08 item 1), the badge follows that text on the same line, after a space, and wraps to the next line when it does not fit.
- In a **public** recipe (draft or published): the second line is an attention line instead, at the row's start edge,
  `caption` in `attention` with the `lock` glyph: "Private food. A public recipe can't use it." The attention line
  takes the slot, as 2026-11-08 item 1 says it does.
- The badge is not pressable. `StatusBadge` is "not pressable" by contract (`statusBadge/props.ts` line 3), and B1 keeps
  chips for choosing. Opening the food goes through the row's ⋯ menu (D6).
- No new badge status is needed: `private`, `public`, `note` and `attention` cover every state in this spec. No change
  to the `StatusBadge` primitive.

### D4. Where the food page's status sits, and the comparison in state 9

- **Status sits under the title, before the facts**, like R6 (a recipe's Public or Private sits by its name). One row of
  `StatusBadge`s, then a **status panel**: a `paper` card with no edge, padding 16, holding one statement (`cardTitle`),
  at most two detail lines (`meta`, `inkMuted`) and, on tablet and web, the state's actions.
- **State 9 comparison: changed fields only, "from → to".** The page's main facts stay the public version, because that
  is what every reader and every recipe uses. Under the status panel sits a section "Your edit" (`sectionTitle`, H2)
  listing only the fields the edit changes. Each row: the field label (`meta`, `inkMuted`) on its own line, then
  "120 kcal → 135 kcal" in `body`, the new value in `figureInline`. The arrow is `aria-hidden`. A last line, "Nothing
  else changes." (`meta`, `inkMuted`). The same form on every width: it is short, it never needs two columns, and it
  survives 320 px and 2x text without a table. Change is shown by words and position, never colour alone (SC 1.4.1).
- I rejected a two-column "Public now | Your edit" table: on a phone at 2x text it either scrolls sideways or crushes
  the label, and most edits change one or two of five fields, so the table holds mostly repeats.

### D5. Web and native translation (staff-ux §3.6)

Full table in §9. In short: the food page's actions sit in the status panel on tablet and web, and at the end of the
page on a phone, where the thumb is (the page is short, see the scroll budget). Nothing on these surfaces depends on
hover. "Open food" opens a new tab on web and pushes `FoodDetail` above the editor on native. Every surface is checked
at 320 CSS px with no side scroll.

### D6. Entry to the food page (18)

- **Editor:** the row's ⋯ menu (`ActionMenu`) gains "Open food" on any line bound to a food the cook authored, private
  or public. It sits after "Food details" and before the move items. Web opens a new tab. Native pushes `FoodDetail`.
- **Refusal sheet:** each named line has an "Open food" button (D1).
- **Recipe detail:** no link. The author's line keeps its existing "Your own food" note badge
  (`detail/detailFacts.ts` line 367). The detail page is a cooking surface, and 2026-11-08 item 1 keeps food links off
  it. This departs from the brief's "the food chip opens the food page", for the reason in D3. See flag F10.

### D7. Asking to make a food public has no dialog, but says it is one-way

Promotion is one-way (blueprint §5). The status panel says so in plain words right above the button, so the cook reads
it before pressing. A dialog adds a step and no fact. The ask itself is cheap to undo in effect: nothing
is public until staff approve, and Withdraw closes a pending ask.

### D8. Withdraw always confirms

`ConfirmDialog` (`ui/src/confirmDialog/`), because withdrawing is destructive and has no undo route in the blueprint.
The body names who is affected, in that state's terms (§5.10). Focus opens on Keep.

### D9. Keys

- Food page: a new `foodPageMessages` in `features/recipes/src/foodPage/messages.ts` (the `editor/messages.ts`
  precedent), keys `foodPage.*` below.
- Edit sheet: a new block `ingredientEditFood` in `features/recipes/src/messages.ts`, beside `ingredientCreateFood`.
- Refusal: `editorMessages.publishRefused.*` in `features/recipes/src/editor/messages.ts`.
- Row: `rowState.privateFood*` and `row.openFood` in `features/recipes/src/form/messages.ts` (buildSpec §7.11 places row
  keys there).
- Erasure: `erase.*` in `features/account/src/danger/messages.ts`.
- `en` only. Dates use the locale's medium date ("Nov 9, 2026" in en-US) through `Intl.DateTimeFormat`, passed as
  `{date}`. Counts use ICU plural.

---

## 3. Flags on the architect's states (what looks wrong or missing)

Each flag says who must answer. The spec below builds my call where one is marked "my call".

- **F1. A free-tier cook has no "keep it private".** Private recipes are Pro-only today (`visibilityPolicy`, and
  `actions/messages.ts` `privatePremiumOnly`). So the brief's second way forward does not exist for most cooks. My call:
  the refusal shows only the ways that work for this cook (§7.3), and no upsell inside a refusal. **Owner question Q1.**
  Also: live strings say "Premium", which breaks the "Pro" ruling: `editor/messages.ts` `privatePremiumOnly`, and
  `actions/messages.ts` `privateRefused.premium` and the Private upsell title. Fix them in the same change.
- **F2. "Ask to make public" does not unblock the publish today.** Staff must approve first. The copy says that, and
  adds the way the brief left out: change or remove the line. That is the only way forward that works right now.
- **F3. The refusal has more doors than the editor.** The blueprint's write paths include the detail page's
  Make public (`setVisibility`, `actions/RecipeMakePublicDialog.tsx`), version Restore (`versions.service.ts:226`) and
  rebind. The same sheet serves all three (§7.4). Rebind happens inside the editor, so it is state 16.
- **F4. The editor line does not know the food is the cook's private one.** `RecipeFormIngredient`
  (`form/values.ts` lines 103 to 128) has `foodId` and `resolutionStatus`, nothing about owner or visibility. D2 and D3
  need a per-line `foodVisibility: 'private' | 'public'` for the cook's own authored foods, from the recipe read and
  from a pick. **Architect.**
- **F5. `sortOrder` can drift from the screen.** The cook can reorder lines while a write waits in the outbox
  (ADR-0057). The client matches refused lines by `foodId` first and uses `sortOrder` only when two lines share one
  food. **Architect:** confirm `foodId` is always present in `lines[]` (it is in the blueprint).
- **F6. A parked write that meets the 409.** If the outbox sends a public save later and it is refused, it must park
  as refused (never retried, it will refuse again), and the editor must show the refusal sheet the next time it opens.
  **Architect** (ADR-0057's sender rules).
- **F7. Erasure (17) needs a field on the wire.** `DonatableRecipe` is `{ id, title }` (`danger/model.ts` lines 15 to
  20). Without a `holdsPrivateFood` flag the dialog cannot say which recipes will be deleted, and the server
  removes elected recipes silently. That is a deceptive outcome, so 17 is blocked on this field. **Architect.**
- **F8. The decline reason and the declined version are not readable.** The author `GET` "returns the pending
  snapshot". States 7 and 10 need the newest request whatever its status: `status`, `createdAt`, `decidedAt`,
  `declineReason`, and the snapshot. My call: Edit after a decline prefills from the declined version, so the cook fixes
  the one thing staff named instead of retyping. **Architect.**
- **F9. An edit to a private food that has a pending ask (state 6).** The brief says "an edit replaces the ask". The
  blueprint's "a new edit closes the pending request and opens one at the new version" is written for promoted foods.
  My call: the same holds for a private food with an open ask, and the sheet says so (§6.2). **Architect:** confirm the
  policy covers it.
- **F10. "The food chip opens the food page" (18).** I put the entry in the row's ⋯ menu instead (D3, D6). If the owner
  wants a tappable chip on the line, that is a new pressable-chip treatment B1 does not have yet. **Owner question Q2.**
- **F11. State 12 has no way in.** Nothing in the 18 states links to another cook's public food. My call: the row ⋯
  "Open food" also appears on a line bound to another cook's public food in the cook's own editor, and a deep link
  works. Another cook's withdrawn food answers state 2, because readers never see a hidden food.
- **F12. Portions cannot be edited.** The page shows portions (the API has `MAX_AUTHORED_PORTION_LABEL`,
  `foods.schema.ts:832`) but `AuthoredFoodSheet` edits only the name and four macros. My call: Edit covers what the
  sheet covers. Portions are read-only here. A portions editor is a separate design.
- **F13. `AuthoredFoodSheet` has no edit mode.** Its states are create-only (`hooks/authoredFoodCreate.model.ts`).
  Edit mode is new work: a `useAuthoredFoodEdit` hook with the same state shape plus `sentForReview`.
- **F14. Withdraw has no undo.** I write "You can't undo this." **Architect:** confirm no restore route exists or is
  planned. If one is, the copy changes.
- **F15. Native navigation.** Pushing `FoodDetail` above the editor must not fire the editor's leave, checkpoint or
  discard guard. It is not a leave. **Implementer note**, and a Maestro check (§11).
- **F16. Test seeding needs staff.** States 7 to 10 exist only after a staff decision. `e2e-seed` needs a `food:admin`
  test principal to drive the decision route, or those states can only be component-tested. **Architect.**
- **F17. The existing Maestro flow dies.** `privateFoodStandIn.yaml` saves a copy of a public recipe holding another
  cook's private food. Under rule 1 that recipe cannot exist. The blueprint already replaces it.
- **F18. The web route is a one-way door.** `/{locale}/foods/{foodId}` will be linked and bookmarked. ⚠️ ONE-WAY DOOR:
  renaming it later costs redirects. My call: keep it as specified. Flip it if a second food surface (a public
  food browser) is planned, which wants `/foods` as its index.

---

## 4. Shared pieces

### 4.1 Components, by real path

| Use                   | Component                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Status words          | `ui/src/statusBadge/StatusBadge(.native).tsx`                                               |
| Not found, error      | `ui/src/stateNotice/StateNotice(.native).tsx`                                               |
| Loading               | `ui/src/loadingNotice/LoadingNotice(.native).tsx`                                           |
| Offline read          | `ui/src/offlineNotice/OfflineReadSlot(.native).tsx` (no retry, by its contract)             |
| Page frame, back bar  | `ui/src/pushedPage/PushedPageFrame(.native).tsx`                                            |
| Withdraw confirmation | `ui/src/confirmDialog/ConfirmDialog(.native).tsx`                                           |
| Refusal sheet frame   | `ui/src/sheet/Sheet(.native).tsx`                                                           |
| Buttons               | `ui/src/button/Button(.native).tsx` (`primary`, `secondary`, `ghost`, `destructive` inline) |
| Announcements         | `ui/src/liveRegion/`                                                                        |
| Snackbar after a save | `ui/src/snackbar/`                                                                          |
| Edit form             | `features/recipes/src/form/AuthoredFoodSheet(.native).tsx`, gaining edit mode               |
| Row menu              | `ui/src/actionMenu/`                                                                        |
| Erasure election      | `features/account/src/danger/AccountEraseDialog(.native).tsx`                               |

New, all in feature code (not the design system):

- `features/recipes/src/foodPage/FoodPageView(.native).tsx` (render), `useFoodPage.ts` (orchestration),
  `foodPageState.ts` (pure: wire answer to one of the page states), `messages.ts`.
- `FoodStatusPanel(.native).tsx`, `FoodEditComparison(.native).tsx`.
- `features/recipes/src/editor/PrivateFoodsRefusalSheet(.native).tsx` and `privateFoodsRefusal.ts` (pure: the 409's
  lines matched to the draft's rows, and which ways forward this cook has).
- Routes: web `packages/apps/commise/web/src/app/[locale]/foods/[foodId]/page.tsx`. Native `FoodDetail` in the root
  stack (blueprint step 6, ADR-0056 item 2), `presentation: 'card'`, edge swipe on.

`foodPageState.ts` maps to a closed union, one member per state 1 to 12, so the view is an exhaustive switch.

### 4.2 Primitive changes

None required. Two notes for the design system owner (me):

- `StatusBadge` covers every status here with `note` and `attention`. If a third surface needs "waiting for review",
  promote it to a named status then, not now.
- **One primitive change: a link item in `ActionMenu`.** The ⋯ "Open food" item on web opens a new tab. Today an
  `ActionMenuItem` is a command only (`ui/src/actionMenu/props.ts`: `id`, `label`, `icon`, `disabled`, `onSelect`,
  `unavailable`, no `href`). Add an optional `href` with `newTab: boolean` to the item, rendered as a link on web,
  and on native ignored in favour of `onSelect`. The new-tab accessible name rule (§10) then lives in the primitive,
  not in each feature that calls `window.open`. Blast radius: additive, no consumer changes.

### 4.3 Tokens

Roles only (buildSpec §1.4, §1.5): `canvas`, `paper`, `ink`, `inkMuted`, `lineDivider`, `actionText`, `attention`,
`danger`, `focusRing`. Type: `largeTitle` (food name, Playfair, names only), `sectionTitle`, `cardTitle`, `body`,
`meta`, `caption`, `label`, `figureInline` and the `figures` variant for every number. Sizes only from 14, 16, 18, 28
(T1). Side padding 16 (T31). Steel is an accent only (P4): no filled steel surfaces. The one filled control is the
state's single primary button.

---

## 5. The food page (states 1 to 12)

### 5.1 Frame, every state

- **Web:** `PushedPageFrame` with a back control. Opened from the editor in a new tab, there is no in-app history, so
  Back goes to the cook's recipe list ("‹ My recipes"). Opened in the same tab, Back is the browser's.
- **Native:** `FoodDetail` above the editor. Back is the chevron alone on a phone (N8), named "Back to Edit recipe",
  plus the iOS edge swipe and Android Back. Leaving returns to the editor exactly as it was (F15).
- **Title:** the food name in `largeTitle`, H1, wraps between words, never truncates. Before the read lands it is
  "Food" (`foodPage.titleFallback`).
- **Content width:** `content-reading` (buildSpec §1.3), left-aligned to the gutter like every content page.

### 5.2 Body order, states 5 to 12

1. Title (H1).
2. Badge row: the state's `StatusBadge`s, 8 apart.
3. Status panel, in states 5 to 11. State 12 has none.
4. State 9 only: "Your edit" (H2) with the comparison (D4).
5. "Nutrition per 100 g" (H2, `sectionTitle`). Four rows: Calories, Protein, Carbs, Fat. Label `meta` `inkMuted` on the
   start edge, value `body` with `figures` on the end edge. At 2x text, when label and value do not fit one line, the
   value drops under the label (no nowrap). The value never draws larger than its label (2026-11-05).
6. "Portions" (H2), one row per portion: "1 cup · 240 g". The section is left out when there are none.
7. Phone only: the action group (§5.3).
8. Withdraw, set apart (24 above, a `lineDivider` rule), as R12 sets Delete apart. Hidden in states 11 and 12.

### 5.3 Actions by width

- **Phone (below 600):** the state's actions stack full width at the end of the content, before Withdraw. Primary on
  top. Buttons `lg`, 52 tall. Reach: the page is short (title, panel, five figures), so at 1x on a 390 board the group
  sits in the lower half, inside the thumb zone. At 2x it scrolls, which is fine for a page read top to bottom.
- **Tablet and web (600 and up):** the actions sit in the status panel under its text, in a row, primary last at the
  end edge, wrapping to a column when they do not fit. Buttons `md`.
- One primary per state at most. Edit is `secondary`. Withdraw is `destructive` with the `inline` tone.

### 5.4 State 1: loading

- `LoadingNotice` with "Loading food" in the content area, the title "Food". Skeleton heights match the badge row,
  panel and four figure rows, so nothing shifts on arrival.
- Announce: the notice's own polite status. On arrival, nothing is announced. Focus stays where it was (web: the page
  start. Native: the title, see §10).

### 5.5 State 2: not found

Same for a missing id, another cook's private food, and another cook's withdrawn food. It says nothing about which.

- `StateNotice`: title `foodPage.notFound.title` "Food not found", body `foodPage.notFound.body` "It was removed, or
  the link is wrong.", primary action: native "Back to Edit recipe" when opened from the editor, else
  "Go to My recipes" (`foodPage.notFound.toRecipes`).
- Focus moves to the notice title. Web document title "Food not found".

### 5.6 State 3: error, with retry

- `StateNotice`: title `foodPage.error.title` "We couldn't load this food", no body sentence ending in "try again"
  (T7), primary `foodPage.error.retry` "Try again" (icon `rotateCcw`).
- Retry shows state 1 again. Focus stays on the notice title after a failed retry, and the title is re-announced
  politely.

### 5.7 State 4: offline

- No cached copy: `OfflineReadSlot` with the existing `offlineNoticeMessages.readOffline`. No retry button. The read
  resumes on reconnect (the primitive's contract).
- A cached copy: the page shows it, the shell's connectivity notice shows, and every action button is disabled with
  one line under the panel: `foodPage.offlineActions` "Editing and asking need a connection." Disabled buttons keep
  their names. The line is their description.

### 5.8 State 5: private

- Badge: `private` "Private" (`foodPage.status.private`).
- Panel: `foodPage.private.statement` "Only you can see this food. You can use it in your private recipes."
  Detail: `foodPage.private.askNote` "After staff approve it, anyone can find and use it, and it can't be made private
  again."
- Actions: Edit (`foodPage.action.edit` "Edit"), Ask to make public (primary, `foodPage.action.ask` "Ask to make
  public"), Withdraw (`foodPage.action.withdraw` "Withdraw").
- Ask pressed: the button shows its busy state ("Sending…", `foodPage.ask.busy`). Success moves to state 6 and
  announces `foodPage.ask.done` "Asked to make public." politely. Focus moves to the panel statement. Failure: an inline
  line under the button in `danger` text, `foodPage.ask.failed` "We couldn't send your ask.", and the button stays.
  A 409 (the food changed elsewhere) refetches and shows the true state, announcing its statement.

### 5.9 State 6: asked to make public

- Badges: `private` "Private", `note` "Waiting for review" (`foodPage.status.asked`).
- Panel: `foodPage.asked.statement` "You asked to make this food public on {date}." Detail:
  `foodPage.asked.detail` "Staff are reviewing it. It stays private until they approve. If you edit it, your edit is
  sent for review instead."
- Actions: Edit, Withdraw. No primary. No cancel-ask control: the blueprint has no route for it, and Withdraw closes the ask.

### 5.10 Withdraw confirmation (states 5, 6, 7, 8, 9, 10)

`ConfirmDialog`. Title `foodPage.withdraw.title` "Withdraw {name}?". Confirm `foodPage.withdraw.confirm` "Withdraw
food" (icon `trash`). Keep `foodPage.withdraw.keep` "Keep food". Busy `foodPage.withdraw.busy` "Withdrawing…". Error
`foodPage.withdraw.failed` "We couldn't withdraw this food."

Body by state:

- Private, no ask (5, 7): `foodPage.withdraw.bodyPrivate` "Your recipes that use it will show it as removed and stop
  counting its nutrition. You can't undo this."
- Private with an ask (6): `foodPage.withdraw.bodyAsked` "Your ask to make it public is cancelled. Your recipes that use
  it will show it as removed and stop counting its nutrition. You can't undo this."
- Public (8, 9, 10): `foodPage.withdraw.bodyPublic` "No one will be able to find it. Every recipe that uses it, yours and
  other cooks', will show it as removed and stop counting its nutrition. Any edit waiting for review is cancelled. You
  can't undo this."

After confirming: state 11, focus on the panel statement, polite `foodPage.withdraw.done` "Food withdrawn."

### 5.11 State 7: first ask not approved

- Badges: `private` "Private", `attention` "Not approved" (`foodPage.status.declined`).
- Panel: `foodPage.declined.statement` "Staff didn't approve making this food public." Detail 1:
  `foodPage.declined.reason` "Their reason: {reason}" (the reason as staff wrote it, `body`, wraps). Detail 2:
  `foodPage.declined.next` "It stays private. Edit the food to ask again."
- Actions: Edit (primary here, because it is the way forward), Withdraw. No Ask button: a declined version cannot be
  re-asked, so the control is absent rather than disabled.
- Edit prefills from the declined version (F8).

### 5.12 State 8: public, the approved version

- Badge: `public` "Public" (`foodPage.status.public`).
- Panel: `foodPage.public.statement` "Anyone can find and use this food." Detail: `foodPage.public.detail` "Staff review
  each edit before anyone sees it."
- Actions: Edit, Withdraw.

### 5.13 State 9: public, an edit waiting

- Badges: `public` "Public", `note` "Edit waiting for review" (`foodPage.status.editWaiting`).
- Panel: `foodPage.editWaiting.statement` "You sent an edit for review on {date}." Detail:
  `foodPage.editWaiting.detail` "Until staff approve it, everyone sees the public version below, and so do your
  recipes."
- "Your edit" section (D4). Heading `foodPage.yourEdit.heading` "Your edit". Row text `foodPage.yourEdit.row`
  "{from} → {to}". Spoken name per row `foodPage.yourEdit.rowSpoken` "{field}: public {from}, your edit {to}". Last line
  `foodPage.yourEdit.rest` "Nothing else changes." A name change is a row with the field "Name".
- The facts below are headed "Nutrition per 100 g" as usual and show the public values.
- Actions: Edit (prefills from the waiting edit, never the public version, or the cook loses it), Withdraw.

### 5.14 State 10: public, edit not approved

- Badges: `public` "Public", `attention` "Edit not approved" (`foodPage.status.editDeclined`).
- Panel: `foodPage.editDeclined.statement` "Staff didn't approve your edit." Detail 1: `foodPage.declined.reason`
  "Their reason: {reason}". Detail 2: `foodPage.editDeclined.next` "The public version hasn't changed. You can edit
  again."
- Actions: Edit (prefills from the declined version, F8), Withdraw.

### 5.15 State 11: withdrawn

- Badge: `note` "Withdrawn" (`foodPage.status.withdrawn`).
- Panel: `foodPage.withdrawn.statement` "You withdrew this food." Detail: `foodPage.withdrawn.detail` "Recipes that used
  it show it as removed." No date unless the read carries one (it does not today).
- Facts shown read-only. No actions, no Withdraw.

### 5.16 State 12: another cook's public food

- Badge: `public` "Public". No panel, no author name, no actions. The facts only.
- Reached by the row ⋯ "Open food" on a line bound to it, or a deep link (F11).

---

## 6. The edit sheet (states 13 and 14)

`AuthoredFoodSheet` gains `mode: 'create' | 'edit'` as **data** the orchestration passes, chosen by the host. The
render leaf derives only display from it (title, submit label, notice). The submit behaviour lives in the hook
(`useAuthoredFoodEdit`), so this stays a display derivation, not a behaviour switch. Fields, labels, limits and errors
are the create form's (`ingredientCreateFood.*`).

### 6.1 State 13: a private food saves at once

- Title `ingredientEditFood.title` "Edit {name}". Submit `ingredientEditFood.save` "Save". Busy
  `ingredientEditFood.saving` "Saving…". No review notice.
- Success: the sheet closes, the page shows the new values, snackbar and polite announce
  `ingredientEditFood.saved` "Food saved." Focus returns to Edit.
- Failure: `ingredientEditFood.failed` "We couldn't save your changes." inside the sheet, above the submit, the draft
  kept.
- Duplicate name: the create form's `duplicateNotice` sentence, without "Use that one" (nothing to reuse while
  editing).

### 6.2 State 13 with an open ask (state 6)

- Notice at the top of the form, `caption` `inkMuted` with the `info` glyph: `ingredientEditFood.askReplaced` "You asked
  to make this food public. Saving sends this version for review instead." (F9.)
- After save: state 6 with the new date, announce `ingredientEditFood.askResent` "Food saved and sent for review."

### 6.3 State 14: a public food goes to review

- Before save, the notice at the top of the form: `ingredientEditFood.reviewNotice` "Staff review every change to a
  public food. Until they approve, everyone, including your recipes, keeps the current version."
- If an edit is already waiting (state 9): a second line `ingredientEditFood.replacesWaiting` "This replaces the edit
  waiting for review."
- Submit `ingredientEditFood.send` "Send for review". Busy `ingredientEditFood.sending` "Sending…".
- After the `202 editPending`: the sheet closes, the page moves to state 9, snackbar and polite announce
  `ingredientEditFood.sent` "Edit sent for review." Focus returns to Edit.
- Nothing changed in the form: "Send for review" is disabled, and the line `ingredientEditFood.noChange` "Change
  something to send it for review." sits under it as its description. The cook is never left to guess whether an
  edit went out.

---

## 7. The refusal (states 15 and 16)

### 7.1 When it opens

On the server's `409 PRIVATE_FOODS_ON_PUBLIC_RECIPE`, from: Publish with Public chosen (15), Save changes on a public
recipe (16, including a rebind inside the editor), the detail page's Make public, and a version Restore into a public
recipe (F3). Never from the client's own prediction (D2).

### 7.2 Layout

`Sheet`, titled. Phone: bottom sheet, the footer pinned at the bottom (thumb zone). Tablet and web: the Sheet's wide
form, max width as the open-choices sheet will use.

1. Title, `editorMessages.publishRefused.title` "This recipe can't be public yet".
2. Why, `body`: `publishRefused.why` ICU plural, one: "{count} ingredient uses a food only you can see. A public recipe
   can use only public foods, so every reader sees each ingredient and its nutrition." other: "{count} ingredients use
   foods only you can see. …" (same second sentence).
3. The lines, a list (`role="list"`). Each item: the line exactly as the editor row shows it (the amount in
   `figureInline`, then the cook's words, wrapping between words, #144), and under it, at the start edge, a `secondary`
   `md` button "Open food" (`publishRefused.openFood`). The button is below the text, never beside it, so a long line
   never squeezes it.
4. Web only, `meta` `inkMuted`: `publishRefused.newTab` "Each food opens in a new tab, so your recipe stays here."
5. "Ways forward" (`label`, H3 inside the sheet): `publishRefused.waysHeading` "To go on". A list of the ways this cook
   has (§7.3).
6. Footer: the actions (§7.3). Primary at the end edge on web, on top in a column on phone.

### 7.3 Ways forward and actions by cook

"Can go private" is the existing client rule, not the plan name: the outcome of `actions/privateGate.ts` for a change
to Private is `apply` (the viewer's paid-feature state is `granted`). So when 015's private slot ships, the table
follows it with no change here. `upsell`, `hidden` and `loading` all read as "cannot go private", and the refusal shows
no upsell.

| Cook and door                     | Ways listed                                | Actions                                                      |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Can go private, Publish (15)      | `wayChange`, `wayAsk`, `wayPrivatePublish` | primary "Publish as private" · secondary "Back to editor"    |
| Can go private, Save changes (16) | `wayChange`, `wayAsk`, `wayPrivateSave`    | primary "Make private and save" · secondary "Back to editor" |
| Cannot, Publish (15)              | `wayChange`, `wayAsk`, then `draftKept`    | primary "Back to editor"                                     |
| Cannot, Save changes (16)         | `wayChange`, `wayAsk`, then `changesKept`  | primary "Back to editor"                                     |
| Detail Make public, Restore       | `wayChange`, `wayAsk`                      | primary "Close"                                              |

The existing Make private path (`actions/messages.ts` `makePrivate`) has no consequence sentence of its own, so
`wayPrivateSave` is the only copy of it. If a Make-private confirmation is ever written, it takes this sentence by key
rather than a second wording.

Strings (`editorMessages.publishRefused.*`):

- `wayChange` "Change or remove these ingredients in the editor."
- `wayAsk` "Ask to make each food public from its page. Once staff approve it, you can make this recipe public."
- `wayPrivatePublish` "Or publish this recipe as private."
- `wayPrivateSave` "Or make this recipe private. Other cooks won't be able to see it anymore."
- `draftKept` "Your recipe is saved as a draft."
- `changesKept` "Your changes are kept on this device. The public recipe hasn't changed."
- `publishPrivate` "Publish as private", `savePrivate` "Make private and save", `back` "Back to editor", `close`
  "Close".

"Publish as private" and "Make private and save" switch the visibility to Private and send again in one step. They are
labelled with both halves of what they do, so nothing happens that the label does not say.

### 7.4 Behaviour

- "Back to editor" (and every close route: Escape, scrim, swipe on the handle, Android Back) closes the sheet. Then the
  editor scrolls to the first named row and its attention line (D3) is visible.
- "Open food": web opens `/{locale}/foods/{foodId}` in a new tab and leaves the sheet open. Native closes the sheet and
  pushes `FoodDetail`. Coming back with Back reopens nothing. The row attention lines carry the state.
- A line that the server names but the draft no longer holds (deleted since) is left out of the list. If no line is left,
  the sheet does not open and the client sends the save again, once.

### 7.5 State 16 entry, adding a private food to a public recipe

The editor allows the pick, because it holds a device draft. The row shows the attention line at once (D3), and the
ready line counts it (D2). The refusal comes only at Save changes. I did not block the pick: the cook can be about to fix the
food, or about to make the recipe private.

---

## 8. Erasure election (state 17)

Blocked on F7. With `holdsPrivateFood` on each `DonatableRecipe`:

- The election list keeps only recipes that can be shared, as checkboxes, unchanged.
- Under it, when any recipe holds a private food: `erase.privateFoodsHeading` "These will be deleted" (`label`, H4) and
  `erase.privateFoodsHelp` "They use foods only you can see, so they can't be shared." Then a plain list of their titles
  (`meta`, no checkboxes, nothing focusable). The deletion is stated before the cook types the phrase.
- If every private recipe holds a private food: the checkbox list is replaced by `erase.donateNoneShareable` "None of
  your private recipes can be shared, because each uses a food only you can see. Everything will be deleted." and the
  list of titles.
- Native: the same order inside the dialog's scroll. No other change to `AccountEraseDialog`.

---

## 9. Platform translation

| Element                       | Web                                               | Native                                                  | Disposition | Why                                                  |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| Food page container           | route page in `PushedPageFrame`                   | `FoodDetail` in the root stack, card, edge swipe        | translated  | blueprint step 6, ADR-0056                           |
| Food page actions             | in the status panel from 600                      | phone: end of content, full width. Tablet: in the panel | moved       | thumb reach on phones. Reading order on wide screens |
| Back                          | Back bar. A new tab goes to My recipes            | chevron alone on phone (N8), edge swipe, Android Back   | translated  | platform back routes                                 |
| "Open food" (refusal, ⋯ menu) | new tab, sheet stays open                         | push `FoodDetail` above the editor, sheet closes        | translated  | keep the editor where the cook left it               |
| Refusal sheet                 | Sheet, wide form                                  | bottom sheet, footer pinned                             | kept        | same job                                             |
| Withdraw confirmation         | Radix `AlertDialog` via `ConfirmDialog`           | `DialogFrame` via `ConfirmDialog`                       | kept        | the primitive already translates                     |
| Row "Open food"               | ⋯ menu link item                                  | ⋯ menu item                                             | kept        | no hover anywhere                                    |
| Hover                         | `pearl` tint on menu items and buttons (existing) | pressed state                                           | translated  | no hover on touch. Nothing is hover-only             |
| Edit sheet                    | Sheet                                             | bottom sheet, `KeyboardAvoider`                         | kept        | existing `AuthoredFoodSheet` behaviour               |

- **Hover, right-click, drag, keyboard:** none of these surfaces uses hover, right-click or drag. Every control is a
  button or link reachable by Tab, with Enter and Space.
- **Longest strings:** a 120-character food name wraps in the title, the withdraw dialog title and the refusal line.
  The longest button, "Make private and save" (21 characters), at 2x on a 320 phone in a full-width button wraps to two
  lines inside the button, never truncates, and the button grows (no nowrap). "Ask to make public" fits one line at 1x
  on 320. A staff reason has no length cap in the blueprint. It wraps as body text. At +35% expansion every label
  still wraps rather than clipping.
- **320 CSS px:** checked by construction: single-column page, no table, the comparison is stacked text, the figure
  rows drop the value under the label when needed, the refusal list puts its button under the text. No side scroll.
- **Scroll budget, phone 390 at 1x:** title, badges, panel and the four figures are visible without scrolling in
  states 5, 6, 8 and 11. The action group sits at or just below the fold in states 7, 9 and 10 (the reason and the
  comparison push it). Refusal sheet: the title, the why and the first line are visible on open. The footer is pinned
  so the primary is always visible.
- **Keyboard open:** only the edit sheet has inputs. It uses the existing `AuthoredFoodSheet` keyboard handling. The
  new review notice sits above the first field and scrolls off when the keyboard opens. That is fine: the cook reads it on open.
- **Shared primitive:** the new-tab link item belongs in `ActionMenu` (§4.2). Nothing else here is a class.

---

## 10. Accessibility contract (WCAG 2.2 AA)

- **Headings:** food page H1 = food name. H2 "Your edit", "Nutrition per 100 g", "Portions". Refusal sheet title is
  the dialog name; "To go on" is H3. Erasure "These will be deleted" is H4 under the dialog's H3 section.
- **Roles and names:**
    - Badges are text, read with the badge row in order ("Public, Edit waiting for review").
    - Refusal "Open food" buttons: web name "Open {line} in a new tab" (`publishRefused.openFoodNameWeb`), native
      "Open {line}" (`publishRefused.openFoodName`). `{line}` is the visible line text, so the name starts with the
      visible words (SC 2.5.3).
    - Row ⋯ item: `row.openFood` "Open food". On web its name adds ", opens in a new tab" (`row.openFoodNewTab`).
    - Comparison rows: each row's spoken text is `foodPage.yourEdit.rowSpoken`. The arrow is hidden.
    - The private-food attention line is the row's description (`aria-describedby` on web, `accessibilityHint` on
      native), as 2026-11-08 item 1 does for "Counted as".
- **Focus:**
    - Page open (web): focus on the H1 after the read lands only after an in-app move. A new tab starts at the
      document top. Native: the screen-reader cursor on the title.
    - State change on the page (ask sent, edit sent, withdrawn): focus to the status panel's statement.
    - Refusal sheet opens: focus on the sheet title. Closes: focus to the first named row's open control in the editor;
      from the detail page, back to Make public.
    - Withdraw dialog: focus on Keep. Closes to Withdraw (kept) or the panel statement (withdrawn).
    - Edit sheet: focus on the name field. Closes to Edit.
- **Announcements (SC 4.1.3), all polite:** "Asked to make public.", "Edit sent for review.", "Food saved.", "Food
  withdrawn.", failures, and on the refusal sheet nothing extra (the dialog name and why are read on open).
- **Targets:** buttons 44 (`md`) and 52 (`lg`) tall (B1). No `sm` button is used, because `sm` draws 36
  (`ui/src/button/surfaceClass.ts` line 77). Above WCAG 2.5.8's 24 CSS px floor and at Apple HIG 44 pt. Android menu rows 48 dp.
- **Focus not obscured (SC 2.4.11):** the refusal sheet footer is pinned. Its list scrolls with scroll padding equal
  to the footer height.
- **Text size:** content roles to 2x, the back bar and `barTitle` to 1.5x (chrome cap). Nothing larger than the 28
  title.
- **Reduced motion:** the Sheet and dialog open and close instantly. No other motion is added.

---

## 11. Tests (written red first)

### Component (vitest + RTL, web and native leaves)

- `foodPageState.test.ts`: every wire answer maps to exactly one of states 1 to 12. Another cook's private and withdrawn
  foods map to not found. A declined request without a newer version maps to 7 or 10.
- `FoodPageView` web and native, one test per state: badges, statement, reason, date, which actions show. Ask is absent
  in 7. States 11 and 12 have no actions and no Withdraw. Offline disables the actions and shows the line.
- `FoodEditComparison`: only changed fields listed. Spoken names; "Nothing else changes."
- `AuthoredFoodSheet` edit mode: private save copy and announce. Public shows the review notice before save and
  "Send for review". The replaces-waiting line in state 9. Prefill from the waiting and the declined version. No
  request when nothing changed.
- `privateFoodsRefusal.test.ts`: lines matched by `foodId`, `sortOrder` fallback, deleted lines dropped. The ways and
  actions table of §7.3 for Pro and free, each door.
- `PrivateFoodsRefusalSheet` web and native: copy, plural, "Open food" names with and without new tab, focus on open
  and on close, "Publish as private" sends with Private.
- Editor row: private badge in a private recipe, attention line in a public draft and a published public recipe. The
  ready line count and its jump; ⋯ "Open food" only on authored foods.
- `AccountEraseDialog` web and native: the "These will be deleted" list, the all-blocked copy, no checkbox for a
  blocked recipe.
- Withdraw bodies per state.

### Playwright (web)

- `foodPage.spec.ts`: open own private food, ask to make public, see "Waiting for review". Withdraw with the
  confirmation. Another cook's private food id shows "Food not found".
- `publishRefusedPrivateFood.spec.ts`: a draft with a private food, Public chosen, Publish, the sheet names the line,
  "Open food" opens a new tab on the food page, "Back to editor" lands on the row. Pro variant publishes as private.
- `editPublicFood.spec.ts`: needs F16's staff seed. Edit a public food, see "Edit waiting for review" and the
  comparison. The recipe page still shows the old figure.
- Selectors `getByRole`/`getByLabel` only.

### Maestro (native)

- `publishRefusedForPrivateFood.yaml` (replaces `privateFoodStandIn.yaml`): publish refused, Open food pushes
  `FoodDetail`, Back returns to the editor with the draft intact and no leave prompt (F15).
- `askToMakeFoodPublic.yaml`: from the row ⋯ menu to the food page, Ask, the waiting state.
- `withdrawFood.yaml`: confirmation copy and the withdrawn state.
- Run each on the iPhone 390, Android 384 and iPad 820 boards' devices (T29), at default and largest text.

---

## 12. Out of scope

A staff screen (API only, by ruling). Signed-out reading (ruling 4). A portions editor (F12). Cancelling an ask
without withdrawing. Notifications when staff decide. The cook learns on the page (see Q3). A public food browser.

## 13. Success measure

- Guardrail: the count of `PRIVATE_FOODS_ON_PUBLIC_RECIPE` refusals per publish attempt. If D2 works, refusals are
  rare, because the cook sees the attention line first. A high rate means the prevention is not read.
- Signal: share of refused publishes followed, in the same session, by a successful publish (any visibility) or a
  changed line. Low means the ways forward are unclear.
- Instrumentation: the refusal sheet open, its action chosen, and the outcome of the next save. Who reads it: the
  product owner, weekly after launch.

## 14. Owner questions

- **Q1.** A free-tier cook cannot keep a recipe private, so the refusal leaves them only "change the food" or wait for
  staff. Is that the intent until D4a lands, or do you want a recipe holding a private food allowed to stay private for
  free cooks?
- **Q2.** The brief says the food chip on a line opens the food page. I used the row's ⋯ menu, because the status badge
  is not a control and chips are for choosing (B1). Do you want a tappable chip there instead?
- **Q3.** When staff decide, how does the cook find out? This spec shows it only on the food page. A notice on Home or
  a push is a separate decision.

## 15. Evidence

- **Checked against the corpus (2026-11-09):** `ux-design-corpus/references/accessibility.md` for SC 2.5.8 (24 CSS
  px), 1.4.10 (320 CSS px), 4.1.3 and 2.4.11. `device-ergonomics.md` for the target authorities (HIG 44 pt, Material
  48 dp).
- **Read in source:** `ui/src/confirmDialog/props.ts`, `standIn/props.ts`, `statusBadge/props.ts`,
  `dialogFrame/props.ts`, `sheet/props.ts`, `stateNotice/props.ts`, `offlineNotice/props.ts`, `button/props.ts`,
  `button/surfaceClass.ts`, `actionMenu/props.ts`, `pushedPage/pinnedBarSlot.ts`, the icon names `info`, `lock`,
  `rotateCcw`, `trash`. `features/recipes/src/form/authoredFoodSheet.model.ts`, `form/values.ts`,
  `form/ingredientRowView.ts`, `detail/detailFacts.ts`, `editor/gate.ts`, `editor/messages.ts`, `messages.ts`,
  `actions/privateGate.ts`, `actions/messages.ts`. `features/account/src/danger/AccountEraseDialog.tsx`,
  `danger/model.ts`, `danger/messages.ts`. `food-service/src/foods/foods.schema.ts`. The Maestro flow
  `privateFoodStandIn.yaml`.
- **Assumed, not verified:** that `PushedPageFrame` serves a native root-stack card screen as it serves a pushed
  page; that the Sheet's wide web form suits a list of this length; the scroll budget figures (from the boards'
  sizes, not a render).
- **Judgement, labelled:** D4 (changed fields only), D7 (no ask dialog), the phone action placement, and the status
  panel's look. The principle in each: one fact in one place, and the action where the thumb is.
- **Not run:** `critique-handoff.md`'s handoff checklist was not loaded. No render of any state. A board round must
  draw states 5, 9, 15 and 17 at 390, 384, 820, 1280 and 320 before the build.

## 16. UI Designer review (2026-11-09)

- Q1 is settled, not open. The owner ruled that a free cook holds up to 50 private recipes (ADR-0073, 2026-10-26).
  "Can go private" therefore means the cook is Pro or has a free private slot. The code's old Pro gate
  (`visibilityPolicy`, `privatePremiumOnly`) is owed work, and this feature depends on it: the refusal's "keep it
  private" way must work for a free cook with a slot. A free cook with no slot sees `wayChange` and `wayAsk` only, plus
  one line that says their private recipes are full. The refusal never shows an upsell. The "Premium" strings become
  "Pro" in the same change.
- Q2 is settled: the row's ⋯ menu "Open food" stands, and the line gets no tappable chip (D3, D6, F10).
- F19, added. A cook who asked to make a food public has no way back to it except through a recipe line. Profile gets
  a "Your foods" row that opens a plain list of the cook's own foods, each with its status badge, and each row opens the
  food page. It needs the same list endpoint the food page reads from. **Architect** for the endpoint. The list design
  follows the Collections list rows. A board is owed before build.
- Q3 answered by the owner (2026-11-09): when staff decide, the cook gets a push notification. The in-app result on
  the food page and the editor rows stays. Native only. Web shows the in-app result only, unless the architect finds
  web push already exists.
    - Ask for push permission in context, the first time the cook presses "Ask to make public", never at sign-in. The
      ask stays sent whatever the answer. If permission is denied, nothing else changes.
    - Copy (keys under `foods.push.*`). Each tap opens that food's page.
        - Approved: "{food} is public now". Body: "Your recipes can use it in public."
        - Not approved: "{food} wasn't made public". Body: "Open it to see why."
        - Edit approved: "Your change to {food} is live".
        - Edit not approved: "Your change to {food} wasn't approved". Body: "Open it to see why."
    - No decline reason in the notice itself, because a lock screen is not private.
- A private food in a public recipe is an attention item, never "done": the Ingredients section shows the attention state (the same rank as "Needs a match"), and the sections bar shows its "⚠ 1" count.

## 17. After the architect's Revision 4 (2026-11-09)

These bind over the sections above.

- The refusal is a 400 with the refused lines keyed by `foodId` (ties by `sortOrder`), not a 409. A parked save that
  meets it makes the editor work the refusal out from its own lines and open the sheet. If no line is private any more,
  the cook presses Save again.
- Each line carries `foodVisibility` from food's live answer, so a just-approved food reads public at once and the
  row's attention line clears.
- The food page and the "Your foods" list read one `publicationState` per food: `private`, `asked`, `notApproved`,
  `public`, `editWaiting`, `editNotApproved`, `withdrawn`. They map to states 5, 6, 7, 8, 9, 10 and 11.
- Profile's "Your foods" row shows a dot when a staff decision is new since the cook last opened that food. Use the
  existing unread-dot treatment if one exists, with an accessible name: "Your foods, 1 new decision".
- Push waits for spec 014's notification channel. Until then, the result is in-app only: the food page, the Your foods
  badges and the Profile dot. The app does NOT ask for notification permission in this increment (014 FR-050). The
  push copy and the in-context ask in §16 stay for that later increment.
- The free cook's 50 slots are already enforced on the server, so "keep it private" works for a cook with a free slot.
  Remove the old "needs Pro and a change of your own" strings.
