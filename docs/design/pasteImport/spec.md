# Whole-page paste import: SPECIFY (web and mobile)

**What this is.** The build spec for pasting a recipe, as text or as a whole web page, on web and mobile. `fe-1` builds
PR C from it, and the designer draws the boards in §12 from it. It is a design document. It is not production code, and
no file it names exists until PR C builds it, unless this spec says it exists.

**Inputs.** The DISCOVER and DESIGN draft (`uxDraft.md`, held outside the repo), the architect's blueprint
(`blueprint.md`, outside the repo), which governs the wire, the pipeline and the caps, the UI Designer's decisions
(2026-11-15), and the owner's rulings and the legal answer relayed on 2026-11-15 (§0).

**The spec 004 AI fallback.** The blueprint planned the AI text extraction as a fourth paste PR, "PR D". The owner moved
it into the recipe-importing feature spec (`specs/004-recipe-importing/`) on 2026-11-15, so it ships when that feature
is built. This spec calls it "the spec 004 AI fallback". The mobile paste row and the hint "Text, or a whole web page"
wait for it.

**Standing.** Written by `staff-ux-engineer`, SPECIFY mode. I authored the draft this spec converges. I read the boards
as source and did not render them, so the visual notes about the existing boards are from markup.

---

## 0. Decisions in force

These are settled. This spec specifies them and does not reopen them.

| #   | Decision                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1  | Direction A: one box that becomes a source card.                                                                                                                                                                                                                                                                            | UI Designer                                                                                                            |
| D2  | The chooser row reads "Paste a recipe", hint "Text, or a whole web page". The Add a recipe chooser is a deliverable.                                                                                                                                                                                                        | UI Designer                                                                                                            |
| D3  | The box becomes a card on any HTML signal (`<html`, `<script`, `application/ld+json`, case-insensitive) or plain text over 20,000 characters. Short text stays editable.                                                                                                                                                    | UI Designer                                                                                                            |
| D4  | "How to copy a whole page" is web only, collapsed, and never on phones. The shortcut copy is "verify before ship".                                                                                                                                                                                                          | UI Designer                                                                                                            |
| D5  | A detected address is a suggestion. It fills and selects the statement, and the cook confirms it at Save. It is never set automatically (ADR-0072 §9, ADR-0089 §1 and §7, spec 016 FR-014). The cook may change it to another source or to "I wrote this". An LLM guess (the spec 004 AI fallback) is only a question chip. | UI Designer, legal answer 2026-11-15                                                                                   |
| D6  | The one-recipe review looks like the bulk step without "1 of 1", Skip, Next, the rail or the mode choice.                                                                                                                                                                                                                   | UI Designer                                                                                                            |
| D7  | Save is never disabled. Holds sit in a "Needed before saving" group. Save with an unmet hold keeps the cook on the page, moves focus to the first unmet item and announces it.                                                                                                                                              | UI Designer                                                                                                            |
| D8  | For a web copy, Public is hidden, with one line saying why and the private slot count.                                                                                                                                                                                                                                      | UI Designer                                                                                                            |
| D9  | Success opens recipe detail with the Checking badge (ADR-0074) and one polite announcement.                                                                                                                                                                                                                                 | UI Designer                                                                                                            |
| D10 | Several recipes on one page: a pick-one list on the device.                                                                                                                                                                                                                                                                 | UI Designer                                                                                                            |
| D11 | A copy of the same page already saved: the cook is told, with three actions, Duplicate, Replace and Cancel. Replace confirms first.                                                                                                                                                                                         | Owner ruling 1                                                                                                         |
| D12 | Lines from a page read "Pasted:". Typed text keeps "You wrote:".                                                                                                                                                                                                                                                            | Owner ruling 2                                                                                                         |
| D13 | The drifted boards are redrawn this round (§12.3).                                                                                                                                                                                                                                                                          | UI Designer                                                                                                            |
| D14 | Sizes: phone 390 (iOS) and 384 (Android), tablet 834 and 1194, web 1280 with breakpoints 1024 and 768. Web below 840 behaves like a phone.                                                                                                                                                                                  | UI Designer, owner P5                                                                                                  |
| D15 | `TextArea` always gets a `maxRows` cap here. The card is its own render component, chosen by the orchestration.                                                                                                                                                                                                             | UI Designer                                                                                                            |
| D16 | A paste spends the one import allowance. There is no paste counter. Quota copy names the import allowance.                                                                                                                                                                                                                  | Owner ruling 2026-11-15. The ADR-0072 amendment and the DD32 update are pending in the paste-import PRs (import lead). |
| D17 | The paste box lives on the chooser path. The editor's Paste sheet stays for ingredient and step lists. No "Paste from clipboard" button on mobile (Settled 34). Section names keep the "For the glaze: " step prefix as plain text. Pasted imports appear in "Your imports".                                                | UI Designer                                                                                                            |
| D18 | A change from a detected third-party source to "I wrote this" saves normally. The recipe cannot go public until a person clears it. Private is never blocked.                                                                                                                                                               | Owner ruling 2026-11-15                                                                                                |
| D19 | At the AI spend ceiling the paste ends with a clear message and a path to type the recipe. It never waits for next month. No photos come from a pasted page.                                                                                                                                                                | Owner rulings 2026-11-15                                                                                               |

Governing documents read: `docs/design/uiRefreshWorkshop5/ownerFeedback.md` (N1, N8, P4, P5, C2, E1 apply),
`docs/research/userNeeds/synthesis.md` (theme 1, need 2, designer point 1), ADR-0072 §3, ADR-0074 §3a, ADR-0089 §1, §5
and §7, and the owner's type-scale and 28 pt rulings in memory (even sizes only, which overrides C1's 13, 15 and 17).

---

## 1. Purpose

**User.** A home cook who found a recipe somewhere else and wants it in Commise. The baseline is the cook who
struggles, and the help must not get in an experienced cook's way. On a desktop the cook can copy a whole page's source.
On a phone the cook copies text, because phones have no practical way to copy a page's source.

**Goal.** Paste once, see in words where the recipe came from, fix what the import could not know, and save one recipe.

**Context.** A recipe page full of ads (need 1, FR-001), and imports elsewhere that quietly drop or change things (need
2, FR-011). The review step is where trust is earned, so the cook always sees the source and every line before saving.

**The one thing.** The cook never sees or scrolls half a megabyte of markup. The box turns into a card that says, in
words, "Web page pasted · Chicken pot pie · from allrecipes.com", before anything is imported. Heuristic judgement,
untested: it applies Nielsen #1 (visibility of system status) and #6 (recognition over recall).

**Requirements this spec traces to** (from the draft): R1 paste once and get one recipe. R2 see and change the source
before saving. R3 never lose the paste to an error. R4 never wait without feedback. R5 a screen reader is never read
markup. R6 WCAG 2.2 AA on both platforms.

---

## 2. Flow and screen inventory

```
My recipes ─ New recipe ─► P1 Add a recipe (chooser)
                              ├─ Paste a recipe ─► P2 Paste screen ─ Import ─┬─► P3 Pick one (several recipes) ─┐
                              │                                              ├─► P4 Already saved (duplicate) ──┤
                              │                                              └──────────────────────────────────┴─► P5 Review ─ Save ─► P6 Recipe detail (Checking)
                              └─ Write it yourself ─► editor (exists)
```

| Screen           | Web, 840 and wider                                      | Web below 840, phone 390 and 384      | Tablet 834 and 1194                      |
| ---------------- | ------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| P1 Add a recipe  | Centred dialog, at most 448 wide, from 640 (`sm`)       | Bottom sheet (web below 640, phones)  | Centred dialog, at most 448 wide         |
| P2 Paste         | Full page in the Recipes area, eyebrow Back "‹ Recipes" | Pushed page, chevron Back only (N8)   | Pushed page, chevron Back with "Recipes" |
| P3 Pick one      | Full page, replaces P2 in history                       | Pushed page                           | Pushed page                              |
| P4 Already saved | Full page                                               | Pushed page                           | Pushed page                              |
| P5 Review        | Two columns at the `wide` container class, else one     | One column, Save pinned at the bottom | 834: one column. 1194: two columns       |
| P6 Recipe detail | Exists. Gains the Checking badge                        | Exists                                | Exists                                   |

Back from P5 returns to P2 with the card and the paste kept. Back from P3 or P4 returns to P2. P2's Back leaves the
flow without a prompt: nothing is saved yet and the clipboard still holds the paste. Once an import exists (after
Import), leaving keeps the item under "To review" in My recipes (S39).

Navigation on mobile is the Recipes tab's native stack (DD25). P2, P3, P4 and P5 are pushed screens. On success P5 is
replaced by P6, so Back from the recipe goes to My recipes, never into a finished review.

---

## 3. Layout

Container rules use the house container classes on `<main>`'s content width (`packages/apps/commise/ui/src/tokens/layout.ts`:
narrow below 600, regular below 960, wide from 960). The viewport rule decides only the shell (tab bar below 840, sidebar
from 840) and whether actions pin (below 840).

### 3.1 P1 Add a recipe

- `Sheet` (`@commise/ui/sheet`) with `size="content"` and `presentation="dialog"`. That is a bottom sheet on a phone and
  a centred dialog of at most 448 from the tablet width (web `sm`, native 600 dp), which matches the
  `ImportAddRecipe*` boards (`.dlg` at 448 px and `.bsheet`).
- Title "Add a recipe" (the sheet's title, `sectionTitle` role). Then rows. Each row is a whole-row link: glyph, title
  (`cardTitle`), hint (`meta`, `inkMuted`), trailing `chevronRight`. Rows are at least 52 tall, separated by
  `lineDivider` hairlines, as the boards draw them.
- **Rows shipped in PR C, in this order:**
    1. "Paste a recipe" / "Text, or a whole web page", glyph `clipboardPaste`.
    2. "Write it yourself" / "Start from an empty recipe", glyph `pencilLine` (the board's `#pan` glyph does not exist in
       `glyphs.ts`, and `pencilLine` says "write").
- **Rows not shown until their flow ships:** the "Paste a link" field with Add, "Photograph a recipe card" and "More
  ways: a file, or your library from another app". None has a destination in code today, and a row that leads nowhere
  is a defect. Each is a registry entry that is absent, not disabled and not marked "soon". When the link field ships it
  needs a `link` glyph, which `glyphs.ts` does not have (a design-system addition, §8.3).
- N1 holds: the trigger is the existing "New recipe" button on the My recipes search row. Today it opens the editor.
  After PR C it opens P1.

### 3.2 P2 Paste screen

Order, top to bottom, at every size:

1. H1 "Paste a recipe" (`largeTitle`, 28, the cap).
2. Hint (`meta`, `inkMuted`), tied to the box by `describedBy`.
3. **The entry slot**: either the box (`TextArea`) or the card (`PastedContentCard`). The orchestration picks one.
4. Status line (S2, S6, S7) or inline error (S23 to S28), in one region under the entry.
5. Web only, fine pointer only: the "How to copy a whole page" disclosure (§3.6).
6. Actions: Import (primary). On web from 840, Import sits at the end of an in-flow row, content width, with no Cancel
   (Back is the way out). Below 840 and on native, Import is full width and pinned at the bottom above the keyboard.

Widths: the column is `max-w-reading` (640) on web, left-aligned to the gutter. The box is never wider than the column.

Box rows (D15): web and tablet `minRows` 10, `maxRows` 16. Phone `minRows` 8, `maxRows` 12. Past `maxRows` the box
scrolls inside itself.

### 3.3 P3 Pick one

H1 "Choose a recipe" then the explanation line, then a `RadioList` (`@commise/ui/radio-list`) of the titles, nothing
preselected, then Import (primary, same placement rules as P2). One column at every size, `max-w-reading` on web. This
reuses the `ImportVideoPickRecipes` page shape (heading, one line, a list, one action), with single choice instead of
check boxes. The blueprint's `several(titles)` gives titles only, so rows show the title alone, with no portions or time.

### 3.4 P4 Already saved

H1, body, the saved copy's title as a link, then three actions (§6.5). One column, `max-w-reading`.

### 3.5 P5 Review

- **Header:** H1 is the recipe title (`largeTitle`, wraps, never truncates). Under it a `meta` line naming the source
  kind (S8, S9).
- **"Needed before saving" group** (§6.3): present only while at least one hold is unmet.
- **Lines:** `ImportLineList` (the shared `MatchLineList`), with the existing nothing-to-fix sentence.
- **Source and visibility:** the statement block (§8.2) and the visibility block.
- **Save area:** the confirmation line, then Save recipe.

| Container class       | Arrangement                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| narrow and regular    | One column: header, Needed group, source and visibility, lines, Save area. Save is pinned at the bottom (sticky bar, `data-import-bar`, as `ImportWizardStep` does today) so it is in reach however long the recipe. |
| wide (960 of content) | Two columns. Left, flexible: header and lines. Right, 320 wide: Needed group at the top, then source and visibility, then the Save area in flow. The right column sticks to the top while the lines scroll.          |

On phones the source block comes **before** the lines, because the source is the thing the cook must confirm, and the
lines are the long part (priority order, cross-platform-translation "multi-column becomes single column with a stated
priority").

⚠️ **Where two columns start.** D7 says "top of the right column from 1024 on web". The house switches inside `<main>`
on the `wide` container class, which is 960 of content. With the 840+ sidebar, a 1024 window gives `<main>` well under
960 of content, so 1024 shows one column, with the Needed group at the top of that column. 1280 shows two. iPad 1194
shows two. This spec follows the container rule and reports the mismatch (§15, A5). D7's intent, holds first and in
reach, holds at both.

### 3.6 The "How to copy a whole page" disclosure (web only)

- A native `<details>` and `<summary>` on web. No primitive is needed because it never ships on native.
- Collapsed by default. Shown only under `@media (hover: hover) and (pointer: fine)`. That is the capability that
  matters (a keyboard and a source view), and it keeps it off phones and touch tablets in a browser at any width. A
  desktop browser narrowed below 840 still shows it.
- Content is a short intro and one list item per browser (§7.2). All shortcut copy carries "verify before ship".

---

## 4. Platform translation (staff-ux §3.6)

| Element                  | Web                                                           | Mobile                                                                                    | Disposition | Why                                                                                        |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| Chooser                  | Dialog from 640, sheet below                                  | Sheet on phones, dialog from 600 dp                                                       | kept        | One primitive (`presentation="dialog"`) decides by width on both                           |
| Paste screen             | Page in the Recipes area                                      | Pushed screen in the Recipes stack                                                        | kept        | Same job                                                                                   |
| How to copy a whole page | Disclosure, fine pointer only                                 | Absent                                                                                    | dropped     | Phones have no built-in source view (draft §1b, Apple Community 2026)                      |
| Box height               | 10 to 16 rows                                                 | Phone 8 to 12 rows, tablet 10 to 16                                                       | collapsed   | The box and Import fit above the phone keyboard                                            |
| Paste gesture            | Ctrl or Command+V, or the context menu                        | The system paste menu on long press. No paste button, so no clipboard prompt (Settled 34) | translated  | No clipboard read                                                                          |
| Import                   | End of an in-flow row from 840, content width                 | Full width, pinned at the bottom, above the keyboard                                      | moved       | Thumb reach. Full width removes wrap risk on "Import recipe" at +35%                       |
| Card URL                 | Wraps anywhere, at most 2 lines, then an ellipsis             | Same                                                                                      | kept        | The full address is in the review's Source field, so the card shows enough to recognise it |
| Clear                    | Ghost button in the card                                      | Same, 44 pt or 48 dp target                                                               | kept        | Always visible. No hover reveal                                                            |
| Pick one                 | Radio list, Import in flow                                    | Radio list rows full width, Import pinned                                                 | moved       | Reach                                                                                      |
| Review                   | Two columns at wide, else one                                 | One column, source before lines, Save pinned. 1194 two columns                            | moved       | Priority on a narrow screen is what blocks Save                                            |
| Save                     | In flow at the foot of the right column at wide, pinned below | Pinned at the bottom                                                                      | moved       | Reach                                                                                      |
| Duplicate actions        | One row, content width, primary first                         | Stacked, full width, primary nearest the thumb (bottom)                                   | moved       | Reach, and three labels do not fit one row at 320                                          |

**Primary action per platform.** Import, Save and the duplicate primary sit bottom and full width on phones and on web
below 840 (thumb zone, Fitts). From 840 on web they sit in flow at the end of the content, because the pointer is
precise and the eye ends there. Tablet 834 pins like a phone. Tablet 1194 keeps Save at the foot of the right column,
which is within the lower side reach for two hands at the edges.

**Hover, right-click, keyboard, drag.** Nothing depends on hover. The disclosure needs a click or Enter, not hover. The
context-menu paste on web has the touch equivalent of the system paste menu. Keyboard: every control is reachable by Tab.
There is no drag anywhere (WCAG 2.5.7 not engaged).

**Longest strings.** Controls are sized to their longest realistic string with +35%:

| Element           | Longest English                    | Overflow rule                                                                  |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Import button     | "Import recipe" (13)               | Full width on phone. From 840 min-width 160, wraps to 2 lines, never truncates |
| Save button       | "Save and replace" (16)            | Same                                                                           |
| Duplicate actions | "Replace my copy" (15)             | Stacked full width below 840. From 840 one row, each wraps to 2 lines          |
| Chooser row title | "Paste a recipe"                   | Wraps, no limit. The hint wraps                                                |
| Card recipe name  | A title up to the recipe title cap | Wraps, at most 3 lines, then ellipsis. Full name in the accessible name        |
| Card URL          | Up to 2,000 characters             | `overflow-wrap: anywhere`, 2 lines, ellipsis                                   |
| Review H1         | Recipe title                       | Wraps, never truncates                                                         |
| Pick-one row      | Recipe title                       | Wraps, never truncates                                                         |

**320 CSS px.** At 320 the card, the review and the pick-one list reflow to one column with no horizontal page scroll
(WCAG 1.4.10). The only long unbroken strings are the URL and pasted lines. Both take `overflow-wrap: anywhere`. The
draft checked this at the rule level. The designer confirms it on the 390 boards narrowed to 320.

**Scroll budget.** Without scrolling, at 390 by 844 with the keyboard closed: P2 shows the title, the hint, the box or
card and Import. P3 shows the title and at least three titles, and Import is pinned. P5 shows the title, the Needed group
(when present) and the source, and Save is pinned. Lines need scrolling, which is fine because the cook browses them.
No task needs more than about three screens of scroll before its primary action, because the primary action is pinned.

**Keyboard open.** P2: the box shrinks to the space between the header and Import, and Import stays visible above the
keyboard (`KeyboardLift` in `@commise/ui/keyboard-avoider`, which measures the overlap). P5: a focused field scrolls into
view above the pinned Save bar (the field-reveal hooks in `@commise/ui/field-reveal` on native, `scroll-padding-bottom`
keyed on `data-import-bar` on web, WCAG 2.4.11).

**Back and dismissal.** iOS edge swipe and the header chevron, Android system back, web browser back. P1 closes on
Escape, the scrim and the close control, and returns focus to New recipe (the `Sheet` does this).

**Rules that belong in a primitive.** (a) The `maxRows` cap: `TextArea` already takes it on both platforms
(`TextAreaProps.maxRows` in `packages/apps/commise/ui/src/input/props.ts`). This screen sets it. No primitive change. (b) The pinned action bar that reserves room under a
focused field already exists for the import step (`data-import-bar`). Reuse it, do not copy it.

---

## 5. Interaction

### 5.1 Classifying the paste (the orchestration's job)

On every change of the box's value, the orchestration classifies it with one pure function, a Specification:

- `empty`: blank.
- `tooLarge`: over 2,000,000 UTF-8 bytes, counted with `TextEncoder` (never `string.length`).
- `page`: contains `<html`, `<script` or `application/ld+json`, matched case-insensitively.
- `longText`: more than 20,000 characters (`string.length`, UTF-16 units, which is what "characters" means in the
  constant's name) and not a page.
- `shortText`: everything else.

Two named constants, owned by the blueprint's page reader beside its other caps (PR B), not by this screen:
`PASTE_MAX_BYTES = 2_000_000` and `PASTE_CARD_THRESHOLD_CHARS = 20_000`. The architect places them. This spec names
them only so the screen never repeats a literal.

**Per platform, too large.** The value is already in the field when the change event arrives, on both platforms. The
orchestration then clears the box and shows S25. Nothing is cut short. The cook pastes less. On native the measurement
of a large `TextInput` value is an open risk (§15, A1).

### 5.2 Per control

| Control            | Behaviour                                                                                                                                                                                                                     | Disabled when                        | Latency budget and feedback                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Chooser row        | Navigates to its destination and closes P1.                                                                                                                                                                                   | Never                                | Instant                                                                            |
| Box                | Plain text, no rich paste. On `page` or `longText` the orchestration swaps it for the card. `shortText` stays editable.                                                                                                       | Never                                | The swap happens in the same frame as the change on web. Reading over 1 s shows S2 |
| Card Clear         | Empties the paste, drops any import id, puts the empty box back and focuses it.                                                                                                                                               | Never                                | Instant                                                                            |
| Import             | `empty`: focuses the box and announces S1's alert. `shortText` or `longText` in PR C: S22. `page` with no recipe: S21. `several`: P3. Otherwise mints one import id per paste, creates the import and advances to the review. | Never. Busy while importing (`busy`) | Over 1 s S6, over 10 s S7 with Cancel                                              |
| Cancel (S7)        | Stops polling, deletes the import (`DELETE /import/{id}`), keeps the card, returns to S4 or S5.                                                                                                                               | Never                                | Instant to the cook. The delete runs behind                                        |
| Pick-one radio     | Selects one title.                                                                                                                                                                                                            | Never                                | Instant                                                                            |
| Pick-one Import    | No choice: focuses the group, announces "Choose a recipe first." Otherwise continues as Import with the chosen recipe.                                                                                                        | Never                                | As Import                                                                          |
| Statement controls | Change the statement. Each choice is recorded (`recordChoices`).                                                                                                                                                              | Never                                | Optimistic. A failed record shows S18 at Save                                      |
| Save recipe        | Unmet hold: S15. Otherwise records choices, calls `leave`, advances until saved, then opens P6.                                                                                                                               | Never (D7). Busy while saving        | Over 1 s the button's busy state. Over 10 s S34's slow line                        |
| Duplicate actions  | §6.5                                                                                                                                                                                                                          | Never                                | Instant                                                                            |

Nothing is undoable in this flow except by deleting the saved recipe from its own page. Replace is the one destructive
action, so it confirms first (S31).

**Replay safety.** The device mints one import id per paste attempt. A double press or a retry reuses it, and
`ImportService.create` is idempotent (blueprint §8). Clear, or a new paste, mints a new id.

---

## 6. States

Every state names its copy key. Keys are under `importMessages.paste.*` unless marked **reuse** or **statement**. Copy
is final unless marked "verify before ship". `{tokens}` are filled with `fillTemplate`. Counts use `PluralText` with
`pluralOf`, never `n === 1`. Sizes use `Intl.NumberFormat` with `style: 'unit'` and `unit: 'kilobyte'` or `'megabyte'`
(decimal units, so 2,000,000 bytes reads "2 MB" and agrees with the limit line).

### 6.1 Paste screen (P2)

| #   | State            | What the cook sees                                                                                                                                                                                                                       | Copy (key)                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Empty, first run | Title, hint, empty box with its label, Import. Web fine pointer: the collapsed disclosure. Import pressed while empty: the box takes focus and an alert under it.                                                                        | Title "Paste a recipe" (`title`). Box label "Recipe" (`boxLabel`). Hint, web: "Paste the recipe’s text, or the whole page. We read it here and never visit the site." (`hint`). Hint, native: "Paste the recipe’s text. We read it here and never visit the site." (`hintNative`). Import "Import recipe" (`import`). Empty press: "Paste a recipe first." (`emptyAlert`) |
| S2  | Reading          | Only when classifying or reading a page takes over 1 s. A static `clock` glyph and a line under the entry. Import is busy.                                                                                                               | "Reading what you pasted…" (`reading`)                                                                                                                                                                                                                                                                                                                                    |
| S3  | Short text       | The box, editable, with the text. Import enabled.                                                                                                                                                                                        | No new copy                                                                                                                                                                                                                                                                                                                                                               |
| S4  | Page card        | `PastedContentCard`, page kind: `globe` glyph, kind line, recipe name if one was found, the site, the URL, the size, Clear. When several recipes were found, the recipe line gives the count instead. No address: the site line says so. | Kind "Web page pasted" (`card.pageKind`). Site "From {site}" (`card.from`). No address: "No web address in this page" (`card.noAddress`). Several: `card.recipeCount` one "{count} recipe on this page", other "{count} recipes on this page". Size "{size}" (`card.size`). Clear "Clear" (`card.clear`), accessible name "Clear the pasted page" (`card.clearPageName`)  |
| S5  | Long-text card   | `PastedContentCard`, text kind: `list` glyph, "Text pasted", line count and size, Clear.                                                                                                                                                 | Kind "Text pasted" (`card.textKind`). Lines `card.lines` one "{count} line · {size}", other "{count} lines · {size}". Clear name "Clear the pasted text" (`card.clearTextName`)                                                                                                                                                                                           |
| S6  | Importing        | After Import, over 1 s: static `clock` glyph and a line under the entry, Import busy.                                                                                                                                                    | "Getting the recipe ready…" (`importing`)                                                                                                                                                                                                                                                                                                                                 |
| S7  | Importing, slow  | Over 10 s: the line changes and a Cancel (secondary) appears beside it.                                                                                                                                                                  | "This is taking longer than usual. You can cancel, and your paste stays here." (`importingSlow`). "Cancel import" (`cancel`)                                                                                                                                                                                                                                              |

### 6.2 Refusals and errors on P2

Each shows under the entry as `role="alert"`, with `triangleAlert` in `attention`. The paste is always kept, except S25,
which never kept it.

| #   | State                                                        | Trigger                                                                                                                        | Copy (key)                                                                                                                                                                                                                                                                                                 | Actions                                                                                                                                          |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| S19 | No ingredients                                               | The page's recipe has no ingredient lines (device), or the item's issue is `noIngredients`.                                    | "We found {title}, but no ingredients in it." (`refused.noIngredients`)                                                                                                                                                                                                                                    | "Write it yourself" (`writeIt`), Clear                                                                                                           |
| S20 | No steps                                                     | No steps (device), or issue `noSteps`.                                                                                         | "We found {title}, but no steps in it." (`refused.noSteps`)                                                                                                                                                                                                                                                | Same                                                                                                                                             |
| S21 | No recipe in the page                                        | The page reader finds no recipe (PR C, before the LLM fallback).                                                               | "We couldn’t find a recipe in this page. Try copying just the recipe’s text, or write it yourself." (`refused.noRecipe`)                                                                                                                                                                                   | Same                                                                                                                                             |
| S22 | Text not readable yet (web, before the spec 004 AI fallback) | `shortText` or `longText` before the spec 004 AI fallback ships.                                                               | "Plain text can’t be imported yet. That comes later. For now, paste the whole web page, or write the recipe yourself and paste the ingredients and the steps into it." Actions: "Write it yourself" (primary), "Paste again". (`refused.textNotYet`, `writeIt`, `pasteAgain`)                              | Not reached: the mobile row is hidden until the spec 004 AI fallback (§14, owner exception). Removed on web when the spec 004 AI fallback ships. |
| S23 | Offline                                                      | No connection at Import.                                                                                                       | "You’re offline. Your paste is kept here. Import it when you’re back online." (`error.offline`)                                                                                                                                                                                                            | "Try again" (**reuse** `wizard.retry`)                                                                                                           |
| S24 | Server error                                                 | A 5xx, a timeout, or `failed`.                                                                                                 | "We couldn’t import this just now. Your paste is kept here. Try again in a moment." (`error.server`)                                                                                                                                                                                                       | "Try again"                                                                                                                                      |
| S25 | Too large                                                    | Over 2,000,000 UTF-8 bytes, before any parsing.                                                                                | "This paste is {size}, and the most we can read is {limit}. Copy just the recipe and paste that." (`error.tooLarge`)                                                                                                                                                                                       | None. The box is empty and focused                                                                                                               |
| S26 | Recipe too large                                             | The extracted recipe is over `MAX_IMPORT_RECIPE_BYTES` (`packages/schemas/recipe/src/schemas/import.schema.ts`) on the device. | "We found {title}, but it’s too long to import. Write it yourself, and paste the ingredients and the steps into it." (`error.recipeTooLarge`)                                                                                                                                                              | "Write it yourself", Clear                                                                                                                       |
| S27 | Import allowance used (D16)                                  | The view's `allowance.used >= limit`, or the item's issue is `waitingForAllowance`.                                            | `error.allowance`, one: "You’ve used your import allowance of {count} recipe in 24 hours. You can import again from {time}. Your paste is kept here." other: "You’ve used your import allowance of {count} recipes in 24 hours. You can import again from {time}. Your paste is kept here."                | None. `{time}` is `resetsAt`, formatted for the locale with the day when it is not today                                                         |
| S28 | AI spend ceiling reached (the spec 004 AI fallback, D19)     | The text job answers `budgetSpent`. The paste ends here. Nothing waits for next month.                                         | Page: "We can’t read this page right now. Write the recipe yourself. You can paste its ingredients and its steps into it." (`error.budgetSpentPage`). Text: "We can’t read this text right now. Write the recipe yourself. You can paste its ingredients and its steps into it." (`error.budgetSpentText`) | "Write it yourself" (primary), Clear                                                                                                             |

The draft's "budget spent" is two different limits. S27 is the import allowance (owner ruling 3). S28 is the AI spend
ceiling (the spec 004 AI fallback, blueprint §7), and it never names the allowance because it is not one. Matching lines without the AI
check in review reuses the existing no-AI-check copy (**reuse**, the `ImportPasteNoAiCheck` board's words).

### 6.3 Review (P5) and its holds

| #   | State                               | What the cook sees                                                                                                                                                                                                                                                                                                                                                                  | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8  | Source found (`suggestedStatement`) | Header meta "Pasted from {site}". Statement block filled and selected: From a source, the URL in Source, A public web page. A note under it. Above Save, the confirmation line. Public hidden, the private line shown (S10).                                                                                                                                                        | Meta "Pasted from {site}" (`review.fromSite`). Note "We found this address in what you pasted. Change it if it’s wrong." (`review.sourceFound`). Confirmation "Saving confirms this recipe is from {site}." (`review.confirmSource`)                                                                                                                                                                                                                        |
| S9  | Source not found                    | Header meta "Pasted". The statement block is inside the Needed group with nothing selected. With the spec 004 AI fallback only: when the text job proposed a site, a question chip with Yes and No above the choices. Yes fills From a source, the site, A public web page, still confirmed at Save. No removes the chip.                                                           | Meta "Pasted" (`review.fromPaste`). Prompt "We couldn’t find where this came from. Tell us, so it’s labelled right." (`review.sourceUnknown`). Chip (the spec 004 AI fallback) "Is it from {site}?" (`review.sourceGuess`), "Yes" (`review.sourceGuessYes`), "No" (`review.sourceGuessNo`)                                                                                                                                                                  |
| S10 | Ready                               | No unmet hold. No Needed group. Lines, source, the visibility line, Save.                                                                                                                                                                                                                                                                                                           | Title of the lines section "Ingredients" (**reuse** the editor's section title). Visibility line, web copy (D8): `review.webPrivate` one "A copy of a web page stays private. It uses 1 of your private slots, and {count} is left.", other "A copy of a web page stays private. It uses 1 of your private slots, and {count} are left." Pro (no limit): "A copy of a web page stays private." (`review.webPrivatePro`). Save "Save recipe" (`review.save`) |
| S11 | Hold: needs a statement             | In the Needed group: the statement block's "Where is it from?" with nothing chosen.                                                                                                                                                                                                                                                                                                 | Group heading "Needed before saving" (`hold.heading`). Item "Say where this recipe is from." (`hold.statement`)                                                                                                                                                                                                                                                                                                                                             |
| S12 | Hold: needs a cuisine               | In the group: the cuisine `Combobox` (the editor's `useCuisineField`).                                                                                                                                                                                                                                                                                                              | "Choose a cuisine." (`hold.cuisine`)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S13 | Hold: needs servings                | In the group: the servings `Stepper`, empty.                                                                                                                                                                                                                                                                                                                                        | "How many people does it feed?" (`hold.servings`)                                                                                                                                                                                                                                                                                                                                                                                                           |
| S14 | Hold: needs times                   | In the group: prep and cook `DurationField`s.                                                                                                                                                                                                                                                                                                                                       | "Add prep and cook times. Zero is fine." (`hold.times`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| S15 | Save pressed with an unmet hold     | The cook stays. Focus moves to the first unmet control in the order statement, cuisine, servings, times (ADR-0072 order). Each unmet item gets a `danger` outline and its own error line. An alert announces the count and the first item.                                                                                                                                          | `hold.saveBlocked` one "{count} thing is needed before saving: {first}", other "{count} things are needed before saving. First: {first}". `{first}` is the item's own sentence from S11 to S14. Item error lines reuse those sentences                                                                                                                                                                                                                      |
| S16 | Visibility refused                  | Item issue `visibilityRefused`. Only reachable when the cook chose "I wrote this" and Public was refused. The visibility block shows in the group, focus target "Who can see it".                                                                                                                                                                                                   | "We can’t save it as public. Choose Private, or change where it’s from." (`hold.visibilityRefused`)                                                                                                                                                                                                                                                                                                                                                         |
| S17 | Private slots full                  | View `pause.reason = outOfSlots`, or a private save with no slot. A notice replaces the Save area. Focus target is the notice's heading.                                                                                                                                                                                                                                            | Title "Your private slots are full" (`hold.slotsFullTitle`). Body `hold.slotsFull`: "A copy of a web page can only be private, and all {total} of your private slots are in use. To free one, make a private recipe public or delete one. Pro has no limit." Actions "See Pro" (`hold.seePro`), "Cancel import" (`cancel`)                                                                                                                                  |
| S18 | Save refused                        | Item issue `saveRefused`, or a choice that did not record. An alert above Save. Save stays enabled.                                                                                                                                                                                                                                                                                 | "We couldn’t save this recipe. Your choices are kept. Try again." (`hold.saveRefused`)                                                                                                                                                                                                                                                                                                                                                                      |
| S34 | Saving                              | Save is busy. Over 10 s, a line above it.                                                                                                                                                                                                                                                                                                                                           | "Still saving. Stay on this page until it’s done." (`review.savingSlow`)                                                                                                                                                                                                                                                                                                                                                                                    |
| S37 | Lines from a page (D12)             | A matched line's original text, where the line list shows it, reads "Pasted:" for a paste and "You wrote:" for typed text.                                                                                                                                                                                                                                                          | "Pasted: “{line}”" (`review.linePasted`). "You wrote:" is **reuse** (the existing row view copy)                                                                                                                                                                                                                                                                                                                                                            |
| S38 | Offline in review                   | A banner above the lines. Choices stay in memory on this device. Save shows S23's sentence as an alert if pressed.                                                                                                                                                                                                                                                                  | "You’re offline. Your choices are kept on this device. Save when you’re back online." (`review.offline`)                                                                                                                                                                                                                                                                                                                                                    |
| S40 | Changed to "I wrote this" (D18)     | The cook changes a detected third-party source to "I wrote this". "Who can see it" appears with Private selected. A neutral note sits under the choice in `inkMuted` `meta`, with no glyph and no colour. No dialog. Choosing Private hides the note. The S8 note and the confirmation line "Saving confirms this recipe is from {site}." are removed, because they no longer hold. | `review.wroteItNote`: "If you make it public, a person checks it before others can see it. Private is not affected."                                                                                                                                                                                                                                                                                                                                        |
| S39 | Leaving after Import                | Back from P2, or closing the app, after an import exists and before Save. A polite snackbar on the next screen.                                                                                                                                                                                                                                                                     | "{title} waits under “To review” in My recipes." (`review.waits`)                                                                                                                                                                                                                                                                                                                                                                                           |

**Steps with section names.** A step that starts with the blueprint's "For the glaze: " prefix shows it as plain text,
part of the step. No heading, no bold.

**Section names in a hold sentence.** Each hold sentence is one whole string. Nothing is assembled from fragments.

### 6.4 Several recipes (P3)

| #   | State    | Copy (key)                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S29 | Pick one | Title "Choose a recipe" (`pickOne.title`). Line `pickOne.intro` one "This page has {count} recipe. Choose the one to import.", other "This page has {count} recipes. Choose the one to import." Group name "Recipes on this page" (`pickOne.groupLabel`). Import "Import recipe" (`import`). No choice pressed: "Choose a recipe first." (`pickOne.chooseFirst`) |

### 6.5 Already saved (P4) and Replace

Trigger: when the cook presses Import, BEFORE `POST /import`, the recipe's detected address matches the citation of one of the cook's own saved recipes. Plain
text with no address is never checked. Another cook's copy is invisible and never matches (the draft's drift note). Because the check runs before the import is created, Cancel and "Keep my copy" spend nothing from the import allowance. Cancel returns to P2 with the card kept. "Import as a new copy" continues as Import.

**Primary action: "Import as a new copy" (Duplicate).** It is the one forward action that loses nothing, so it is the
safe default for a cook who does not stop to read. Replace is destructive, so it is secondary in `destructive` style with
a confirm step. Cancel is quiet. Order, web: primary, Replace, Cancel. Phone: stacked with the primary at the bottom,
nearest the thumb, then Replace, then Cancel on top.

| #   | State            | What the cook sees                                                                                                                      | Copy (key)                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S30 | Already saved    | H1, body with the saved copy's title as a link to it, three actions.                                                                    | Title "You already have this recipe" (`duplicate.title`). Body "You saved {title} from {site} on {date}." (`duplicate.body`), where `{title}` is the link, name "Open {title}" (`duplicate.openName`). "Import as a new copy" (`duplicate.newCopy`). "Replace my copy" (`duplicate.replace`). "Cancel" (`duplicate.cancel`) |
| S31 | Replace, confirm | `ConfirmDialog` (`@commise/ui/confirm-dialog`). Focus on its title. The destructive action is not the default.                          | Title "Replace your copy of {title}?" (`replace.confirmTitle`). Body "The recipe you import now takes the place of the copy you saved on {date}." (`replace.confirmBody`). "Replace" (`replace.confirm`). "Keep my copy" (`replace.keep`)                                                                                   |
| S32 | Replacing        | After confirm the cook goes to the review (P5) as usual. Save reads "Save and replace". While saving, the button is busy with the line. | Save "Save and replace" (`replace.save`). Busy line "Replacing your copy…" (`replace.progress`)                                                                                                                                                                                                                             |
| S33 | Replace failed   | An alert above Save. Save stays enabled.                                                                                                | "We couldn’t replace your copy. Try again, or import this as a new copy." (`replace.failed`). Action "Import as a new copy" (`duplicate.newCopy`)                                                                                                                                                                           |
| S36 | Replaced         | Opens P6 with the Checking badge and one polite announcement.                                                                           | "Your copy of {title} is replaced. We’re checking it." (`replace.done`)                                                                                                                                                                                                                                                     |

The copy never says what happens to plans, lists, comments, versions or the old recipe's page, because the lead has not
defined it (§15, L1). "Keep my copy" closes the dialog and returns to S30.

### 6.6 Success (P6)

| #   | State | What the cook sees                                                                                                                           | Copy (key)                                                                                                                               |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| S35 | Saved | Recipe detail replaces the review. The status row by the title shows "Checking", then the outcome per ADR-0074 §3a. One polite announcement. | Badge "Checking" (`checkingBadge`, shared, see §8.3). Announcement "{title} is saved. We’re checking it. Only you can see it." (`saved`) |

"Only you can see it" is true for every web copy (ADR-0089 §5) and for every private save. For a cook who chose "I wrote
this" and Public, the announcement is "{title} is saved. We’re checking it." (`savedPublic`). The draft's claim about
plans and lists has no source and is dropped.

### 6.6a Held from public until a person checks it (D18)

| #   | State                   | What the cook sees                                                                                                                                                                                                                                                                                                                                                                                                                                    | Copy (key)                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S41 | Saved, held from public | The cook chose "I wrote this" over a detected third-party source, and chose Public. After the save, recipe detail shows the ADR-0074 badges as for any public save: "Checking" first, then "In review" while a person decides. Under the badge, one line says what this means. When a person clears it, the badge becomes Public and the line goes away. If the cook chose Private, none of this applies: the save is an ordinary private save (S35). | Line `heldForCheck`: "A person checks this recipe before others can see it. Until then only you can see it." Announcement `savedHeldForCheck`: "{title} is saved. Only you can see it until a person checks it." The badge words are the shared `checkingBadge` and the existing In review badge (**reuse**, ADR-0074 §3a) |

**The cook cannot clear the hold.** No control on recipe detail, in the editor, in the review or in a menu offers to
clear, dispute, appeal or speed up this check: no "Request review", no "I own this", no "Remove hold". Only a person's
decision ends it, and only a verified claim by the site itself can clear the underlying signal (expert legal review,
2026-11-15). Editing the recipe does not clear it either. The cook can always keep the recipe private, which is never
blocked.

This is the ADR-0074 review path, not a new state of the recipe. What makes it go to a person rather than clear on its own is a server rule (§15, A7). The copy never says why, never mentions the detected site and never asks the cook to justify the choice.

### 6.7 Disclosure and chooser copy

See §7.2 and §7.3. **State count: 41 (S1 to S41).**

---

## 7. Content

### 7.1 Content-design pass (corpus `content-design.md`)

- **Front-loaded.** Each error starts with what happened ("We couldn’t…", "This paste is…").
- **Three-part errors.** Every error says what happened, why when it helps, and what to do next, with the control there.
  No bare "Something went wrong". S24 says what to do.
- **No blame.** "This paste is too large" never says "invalid".
- **Verb plus object on buttons.** "Import recipe", "Save recipe", "Replace my copy", "Import as a new copy". "Cancel" on
  the duplicate screen is unambiguous because nothing else is open. The confirm dialog uses "Replace" and "Keep my copy",
  never "OK" and "Cancel".
- **One concept, one word.** "Import" for bringing a recipe in (matches "Your imports" and the allowance). "Paste" for
  the gesture. "Web page" for HTML. Never "HTML", "source code", "markup" or "JSON" on any screen. "Private slots" as
  everywhere else.
- **True and material.** S31's body states a true consequence and nothing the lead has not decided.
- **Plain English, no em-dashes, no semicolons**, sentence case, numerals, curly apostrophes as the house uses.
- **Localisation.** Every count is ICU-style `PluralText`. No sentence is built from fragments. `{size}`, `{date}` and
  `{time}` arrive formatted by `Intl`. Strings are sized for +35%.

### 7.2 The disclosure (web only, all "verify before ship")

| Key                | Copy                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `howTo.title`      | "How to copy a whole page"                                                                                                       |
| `howTo.intro`      | "Open the page’s source, select it all, copy it, then paste it here."                                                            |
| `howTo.chromeEdge` | "Chrome or Edge: press Ctrl+U, or Option+Command+U on a Mac. Then press Ctrl+A and Ctrl+C, or Command+A and Command+C on a Mac." |
| `howTo.firefox`    | "Firefox: press Ctrl+U, or Command+U on a Mac. Then select all and copy."                                                        |
| `howTo.safari`     | "Safari: first turn on the Develop menu in Safari’s Settings, under Advanced. Then press Option+Command+U, select all and copy." |

### 7.3 Chooser

| Key                         | Copy                                 |
| --------------------------- | ------------------------------------ |
| `chooser.title`             | "Add a recipe"                       |
| `chooser.close`             | "Close Add a recipe"                 |
| `chooser.paste`             | "Paste a recipe"                     |
| `chooser.pasteHint`         | "Text, or a whole web page"          |
| `chooser.pasteHintPageOnly` | "Copy a whole web page and paste it" |
| `chooser.write`             | "Write it yourself"                  |
| `chooser.writeHint`         | "Start from an empty recipe"         |

The chooser keys sit under `importMessages.chooser.*`, not `paste.*`, because the chooser outlives this feature.

Until the spec 004 AI fallback ships, the web row uses `chooser.pasteHintPageOnly`, because plain text cannot be read yet and the hint must
not promise it. When the spec 004 AI fallback ships, the hint becomes `chooser.pasteHint` and `pasteHintPageOnly` is deleted. Mobile shows
no paste row until the spec 004 AI fallback (§14, owner exception).

### 7.4 Statement block keys (`importMessages.statement.*`)

The words are the `ImportStatements` and `ImportWizardStep` boards'. They sit under `statement.*`, not `paste.*`,
because the bulk import's statement screens will read the same strings. One source for one piece of knowledge.

| Key                     | Copy                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `statement.whereFrom`   | "Where is it from?"                                                                 |
| `statement.wroteIt`     | "I wrote this"                                                                      |
| `statement.fromSource`  | "From a source"                                                                     |
| `statement.sourceLabel` | "Source"                                                                            |
| `statement.kindLabel`   | "What kind of source?"                                                              |
| `statement.publicWeb`   | "A public web page"                                                                 |
| `statement.bookOrPaid`  | "A book or a paid site"                                                             |
| `statement.whoCanSee`   | "Who can see it"                                                                    |
| `statement.public`      | "Public"                                                                            |
| `statement.publicHint`  | "Anyone can find it in Discover"                                                    |
| `statement.private`     | "Private"                                                                           |
| `statement.privateHint` | "Only you can see it"                                                               |
| `statement.savedFrom`   | "Saved from {domain}. The words and photos belong to their author. Private to you." |

**The attribution line for a pasted page** is `statement.savedFrom`, word for word, from an expert legal review on
2026-11-15 (AI analysis, attorney sign-off still owed). It shows in review under the confirmed source (S8, S10), and on
recipe detail wherever the recipe's source is shown. `{domain}` is the registrable domain (ADR-0089 §3). Two rules bind
every string in this feature:

- Never "By {site}", "From the kitchen of {site}" or any wording that names the site as the author or suggests it endorses
  the copy. That risks a false endorsement claim.
- Never a sentence that says or implies we checked the copyright, the terms or the right to share. The board drift
  "We checked its terms: you can share it" (§12.3) is removed for this reason too.

"Who can see it" shows only when "I wrote this" is chosen. For a web page or a book, the visibility line (S10) replaces it
(D8). Nothing is disabled, so no `aria-disabled` radio is ever drawn.

### 7.5 Your imports

A pasted import lists like any import, wherever imports are listed (D17). No screen in code or on the canvases is named "Your imports" today, and the bulk copy sends waiting items to "To review" in My recipes (`leave.resume`), so S39 names that place (§15, U4). Its row reads the recipe title, then "Pasted · {site}" (`yourImports.fromSite`)
or "Pasted text" (`yourImports.fromText`).

---

## 8. Components and tokens

### 8.1 Existing, reused (paths checked in this worktree)

| Part                                                                                                          | Path                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sheet` (`presentation="dialog"`, `size="content"`)                                                           | `packages/apps/commise/ui/src/sheet/Sheet.tsx`, `Sheet.native.tsx`                                                                                       |
| `TextArea` with `minRows`, `maxRows`                                                                          | `packages/apps/commise/ui/src/input/TextArea.tsx`, `TextArea.native.tsx`                                                                                 |
| `FieldLabel`, `fieldHintId`                                                                                   | `packages/apps/commise/ui/src/input/`                                                                                                                    |
| `Button` (`busy`, `description`, `focusRequested`)                                                            | `packages/apps/commise/ui/src/button/`                                                                                                                   |
| `RadioList`                                                                                                   | `packages/apps/commise/ui/src/radioList/`                                                                                                                |
| `LiveRegion`                                                                                                  | `packages/apps/commise/ui/src/liveRegion/`                                                                                                               |
| `KeyboardLift`                                                                                                | `packages/apps/commise/ui/src/keyboardAvoider/KeyboardLift.native.tsx`                                                                                   |
| `PushedPageFrame`                                                                                             | `packages/apps/commise/ui/src/pushedPage/`                                                                                                               |
| `ConfirmDialog`                                                                                               | `packages/apps/commise/ui/src/confirmDialog/`                                                                                                            |
| `StateNotice` (S17)                                                                                           | `packages/apps/commise/ui/src/stateNotice/`                                                                                                              |
| `Combobox`, `Stepper`, `DurationField`, `useCuisineField`                                                     | `packages/apps/commise/ui/src/combobox/`, `ui/src/input/`, `ui/src/durationField/`, `packages/apps/commise/features/recipes/src/form/useCuisineField.ts` |
| `ImportLineList` (the shared `MatchLineList`)                                                                 | `packages/apps/commise/features/recipes/src/import/ImportLineList.tsx`, `.native.tsx`                                                                    |
| `importMessages`                                                                                              | `packages/apps/commise/features/recipes/src/import/messages.ts`                                                                                          |
| Glyphs `clipboardPaste`, `pencilLine`, `globe`, `list`, `x`, `clock`, `triangleAlert`, `chevronRight`, `save` | `packages/apps/commise/ui/src/icon/glyphs.ts`                                                                                                            |

### 8.2 New render components (feature package, `features/recipes/src/import/`)

Each has a web leaf and a `.native.tsx` leaf with one shared props file. All are presentational: props in, markup out.

**`AddRecipeChooser`**. The P1 sheet and its rows.

```ts
interface AddRecipeChooserProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** The rows that ship, in order. The host builds this list from the registry of routes that exist. */
    readonly rows: readonly AddRecipeRow[];
}
interface AddRecipeRow {
    readonly id: 'paste' | 'write';
    readonly icon: IconName;
    readonly title: string;
    readonly hint: string;
    readonly onChoose: () => void;
}
```

The row is a plain pressable link row inside this component. `ChoiceRow` is not used: its contract is a selection
(`chosen`, `busy`, `refused`), and these rows navigate.

**`PasteImportPage`**. The P2 frame: title, hint, the entry slot, the status slot, the disclosure (web), Import.

```ts
interface PasteImportPageProps {
    /** The box or the card. The orchestration chooses which, so this frame never switches on a mode. */
    readonly entry: ReactNode;
    /** The status line or the alert under the entry, or nothing. */
    readonly status: ReactNode;
    readonly importBusy: boolean;
    readonly onImport: () => void;
    readonly importFocus: ControlFocus;
}
```

**`PastedContentCard`**. S4 and S5. Never a `TextArea` mode (D15).

```ts
type PastedContentSummary =
    | {
          readonly kind: 'page';
          readonly site: string | null;
          readonly url: string | null;
          readonly recipe:
              | { readonly kind: 'one'; readonly title: string }
              | { readonly kind: 'several'; readonly count: number }
              | { readonly kind: 'none' };
          readonly bytes: number;
      }
    | { readonly kind: 'text'; readonly lines: number; readonly bytes: number };
interface PastedContentCardProps {
    readonly summary: PastedContentSummary;
    readonly onClear: () => void;
    /** Raised by the host when the card replaces the focused box. */
    readonly focus: ControlFocus;
}
```

Look: `paperRaised` surface, `radius-md`, 16 padding (`gapGroup`), a 4-wide left edge in `action` (the one steel
accent, P4), glyph in `inkMuted`, kind line `label`, recipe name `cardTitle`, site `body`, URL and size `meta` in
`inkMuted`, Clear a `ghost` button with `x` at the end of the kind row.

**`ImportOneRecipeReview`**. P5's shell. It is a sibling of `ImportWizardStep`, not that component with options. D6 is
met in what the cook sees: the same heading, the same line list and the same statement block, without the progress
line, Skip, Next, Save and leave, the rail and the mode choice. Making those props optional would be the behaviour mode
prop the house rule forbids, and its bar has no Save (§15, A4).

```ts
interface ImportOneRecipeReviewProps {
    readonly recipeTitle: string;
    readonly sourceLine: string;
    /** The Needed group, or nothing. */
    readonly needed: ReactNode;
    /** The statement and visibility blocks. */
    readonly source: ReactNode;
    /** `ImportLineList`. */
    readonly children: ReactNode;
    /** The confirmation line and any alert above Save. */
    readonly saveNote: ReactNode;
    readonly saveLabel: string;
    readonly saving: boolean;
    readonly onSave: () => void;
}
```

**`NeededBeforeSaving`**. The hold group (S11 to S16).

```ts
type ImportHold =
    | { readonly kind: 'statement' }
    | { readonly kind: 'cuisine' }
    | { readonly kind: 'servings' }
    | { readonly kind: 'times' }
    | { readonly kind: 'visibility' };
interface NeededBeforeSavingProps {
    /** Unmet holds, in ADR order. Empty renders nothing. */
    readonly holds: readonly ImportHold[];
    /** Whether Save was pressed with these unmet: each item then shows its error line and outline. */
    readonly shown: boolean;
    /** Each hold's control, built by the host. */
    readonly renderControl: (hold: ImportHold) => ReactNode;
}
```

**`ImportStatementBlock`**. Where it is from, the source, the kind, and who can see it (§7.4), plus the optional spec 004 AI fallback
guess chip. Controlled. New, because "Where is it from?" exists only on the boards.

**`PickOneRecipe`**. P3: title, intro, a `RadioList`, Import.

**`AlreadySavedNotice`**. P4: title, body with the link, three actions.

### 8.3 Design-system additions (owned by `staff-ux-engineer`, `packages/apps/commise/ui`)

1. **`StatusBadge` gains `checking`.** `BADGE_STATUSES` has no checking value today, and ADR-0074 names the state. Words
   "Checking", glyph `clock`, tone the `note` tone. Key `checkingBadge` lives with the recipe detail copy, not here. If
   the content-source-check work already adds it, reuse that.
2. **A `link` glyph**, when the chooser's link row ships. Not needed for PR C.

No new token. No disclosure primitive (web only, native `<details>`).

### 8.4 Tokens used

Type roles only (`packages/apps/commise/ui/src/tokens/typography.ts`): `largeTitle` 28 for H1s (the cap), `sectionTitle`
18 for the sheet title, `cardTitle` 16, `body` 16, `label` 14, `meta` 14. Every size is even.

Colour: `ink`, `inkMuted`, `paper`, `paperRaised`, `lineDivider`, `lineControl`, `attention` for warning glyphs,
`danger` for the unmet-hold outline and its error line, `action` only on the enabled primary button fill and the card's
left edge (P4, C2), `focusRing`.

Space (`spacingRole` in `tokens/layout.ts`): `gapWithin` 8 inside the card, `gapGroup` 16 between the entry and its
status, `gapSection` 32 between the review's groups, `headerToContent` 24 under H1s. Radius `md` for the card and the
group.

### 8.5 Pattern register

| Unit                                                                              | `@pattern`                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pastedContentKindOf` (classifier, §5.1)                                          | Specification: the card rule written once                                                       |
| `pastedRecipeImport` reducer                                                      | State, with each transition a Command (blueprint)                                               |
| `usePastedRecipeImport`                                                           | Headless hook: the orchestration that picks box or card, page or pick-one, and owns focus moves |
| `PasteImportPage`                                                                 | Template: a fixed frame with an entry slot the host fills                                       |
| `PastedContentCard`                                                               | Visitor, satisfied by the language: an exhaustive switch over `PastedContentSummary`            |
| `NeededBeforeSaving`                                                              | Visitor, satisfied by the language: an exhaustive switch over `ImportHold`                      |
| `ImportOneRecipeReview`                                                           | Template: the same slots as the bulk step, a different frame                                    |
| `AddRecipeChooser` rows                                                           | Registry: the list of routes that exist, built once by the host                                 |
| `AddRecipeChooser`, `PickOneRecipe`, `AlreadySavedNotice`, `ImportStatementBlock` | No tag beyond their layer, unless the builder finds one                                         |

Preserved: `ImportWizardStep`, `ImportLineList`, `MatchLineList` and `Sheet` keep their contracts. Already satisfied, so
add nothing: TanStack mutations are the Commands for create, record and leave. Focus requests use the existing
`ControlFocus` request and acknowledge pair.

---

## 9. Accessibility contract (WCAG 2.2 AA)

Claimed level: WCAG 2.2 AA, both platforms. EN 301 549 cites 2.1 AA, which 2.2 AA satisfies.

- **Headings.** One H1 per screen (P2, P3, P4, P5). In P5 "Needed before saving", the source block and "Ingredients"
  are H2. The chooser's title is the dialog's name.
- **Landmarks and names.** The pinned action bars are groups named "Paste" (`actionsLabel`) and "Save"
  (`review.actionsLabel`).
- **The box.** Visible label "Recipe", tied to the hint by `aria-describedby` (1.3.1). Plain text. Tab leaves it (2.1.2).
  Capped height (1.4.4, 1.4.10).
- **Box to card (4.1.3, 2.4.3).** When the card replaces the focused box, focus moves to the card's kind line
  (`tabindex="-1"` on web, `accessibilityRole="header"` focus on native), and one polite announcement says the kind,
  the recipe and the site, from the card's own text. A screen reader never reaches the markup (R5).
- **Clear (2.5.3).** Accessible name starts with the visible word: "Clear the pasted page" or "Clear the pasted text".
  On Clear, focus returns to the empty box.
- **Status (4.1.3).** S2, S6, S7, S35 and S36 use one polite `LiveRegion`. Refusals and errors (S19 to S28, S15, S18,
  S33) are `role="alert"`, tied to the entry or to Save with `aria-describedby` (3.3.1, 3.3.3). Nothing announces per
  keystroke.
- **Save with unmet holds (D7).** Focus moves to the first unmet control. The alert names the count and the first item.
  Each unmet control gets `aria-invalid` and its error line in `aria-describedby`. Save keeps focusability because it is
  never disabled.
- **Glyphs.** Waiting states use a static glyph, not a spinner, except the `Button`'s own busy state (2.2.2, the house
  rule in `form/pasteStatusCopy.ts`).
- **Cancel** in S7 is the exit from a wait over 10 s.
- **Targets (2.5.8).** Clear, the chooser rows, the radio rows, the guess chip's Yes and No, and the duplicate actions
  are at least 24 CSS px on web, and 44 pt on iOS and 48 dp on Android by platform convention.
- **Focus not obscured (2.4.11).** The pinned bars reserve their height under a focused field (`data-import-bar` on web,
  field reveal on native).
- **Contrast (1.4.3, 1.4.11).** Text on `paperRaised` uses `ink` and `inkMuted`. The card's `action` edge is decoration,
  not the only cue, so 1.4.11 does not bind it. The unmet outline in `danger` must reach 3:1 against `paperRaised` in
  light and dark. The designer checks both on the boards.
- **Duplicate and Replace.** S31 opens a `ConfirmDialog` that traps focus, lands on its title, and returns focus to
  "Replace my copy" on Keep.
- **Route changes.** Every new screen moves focus to its H1. P6 follows recipe detail's existing landing.
- **Voice control.** Every visible label is contained in its accessible name.
- **Reduced motion.** No motion beyond the platform's own push and sheet transitions.

---

## 10. Motion

None of our own. Screen pushes, the sheet and the dialog use the platform's and the primitives' transitions, which
already honour reduced motion. The box-to-card swap is instant, with no cross-fade.

---

## 11. Edge cases

- **Longest content.** §4's table.
- **Zero.** Empty box (S1). A page with no recipe (S21). A recipe with no ingredients or steps (S19, S20). Several but
  then one left after de-duplication: the reader returns one, so there is no pick-one.
- **Huge.** Over 2,000,000 bytes (S25). An extracted recipe over `MAX_IMPORT_RECIPE_BYTES` (S26). A pasted page with a 31,800-character
  line never reaches the screen, because it becomes a card.
- **Two candidate addresses that disagree.** Detection returns none (blueprint §2), so S9.
- **The address is our own site, localhost or an IP.** Refused by `parseSourceLink`, so S9.
- **The cook edits the prefilled source.** It is the cook's statement from then on. The note in S8 goes away.
- **Slow network.** S6 and S7. Save S34.
- **Offline.** S23 and S38. The paste and the choices are never dropped.
- **Denied permission.** None. There is no clipboard read.
- **App killed mid-import.** The item waits under "To review" (S39). Resuming it opens P5 for that item.
- **Truncation rule.** Only the card truncates (recipe name 3 lines, URL 2 lines), each with the full text in the review.

---

## 12. Boards to draw

Each new board is drawn from the decisions and the existing `ImportWizardStep` and `ImportReviewDraft` look, not from the
old paste board. Every redrawn board uses role names, even sizes only (the existing boards use 13, 15 and 17, which the
type-scale ruling retired), and no Public option for a web page.

The boards draw the state after the spec 004 AI fallback: both platforms show the paste row with "Text, or a whole web page". The web chooser
board adds one more variant with the page-only hint and the S22 board, for the PR C release (§14).

### 12.1 `recipeImportingWeb`

| #   | Board                    | States shown                       | Sizes           |
| --- | ------------------------ | ---------------------------------- | --------------- |
| W1  | ImportAddRecipe (redraw) | P1 with the two shipped rows       | 1280, 1024, 768 |
| W2  | ImportPasteEmpty         | S1. 1024 shows the disclosure open | 1280, 1024, 768 |
| W3  | ImportPastePageCard      | S4 with a recipe name              | 1280, 768       |
| W4  | ImportPasteTextCard      | S5, and S3 beside it               | 1280            |
| W5  | ImportPasteWaiting       | S2, S6, S7                         | 1280            |
| W6  | ImportPasteRefused       | S19, S21, S22, S25, S26            | 1280, 768       |
| W7  | ImportPasteErrors        | S23, S24, S27, S28                 | 1280            |
| W8  | ImportPastePickOne       | S29                                | 1280, 768       |
| W9  | ImportPasteDuplicate     | S30, S31, S33                      | 1280, 768       |
| W10 | ImportPasteReview        | S8, S10, S37, S40                  | 1280, 1024, 768 |
| W11 | ImportPasteReviewHolds   | S9, S11 to S15 after Save          | 1280, 768       |
| W12 | ImportPasteSlotsFull     | S17, S18                           | 1280            |
| W13 | ImportPasteSaved         | S35, and S41 beside it             | 1280, 768       |

### 12.2 `recipeImportingMobile`

| #   | Board                    | States shown                               | Sizes                                    |
| --- | ------------------------ | ------------------------------------------ | ---------------------------------------- |
| M1  | ImportAddRecipe (redraw) | P1                                         | Iphone390, Android384, Ipad834, Ipad1194 |
| M2  | ImportPasteEmpty         | S1, keyboard closed                        | Iphone390, Android384, Ipad834, Ipad1194 |
| M3  | ImportPasteKeyboard      | S3 with the keyboard open, Import above it | Iphone390, Android384                    |
| M4  | ImportPasteTextCard      | S5                                         | Iphone390, Android384                    |
| M5  | ImportPastePageCard      | S4                                         | Iphone390, Ipad1194                      |
| M6  | ImportPasteWaiting       | S6, S7                                     | Iphone390                                |
| M7  | ImportPasteRefused       | S25, S26                                   | Iphone390, Ipad834                       |
| M8  | ImportPasteErrors        | S23, S27                                   | Iphone390                                |
| M9  | ImportPastePickOne       | S29                                        | Iphone390, Ipad1194                      |
| M10 | ImportPasteDuplicate     | S30, S31                                   | Iphone390, Ipad834                       |
| M11 | ImportPasteReview        | S8, S10, S40                               | Iphone390, Android384, Ipad834, Ipad1194 |
| M12 | ImportPasteReviewHolds   | S9, S15                                    | Iphone390, Android384, Ipad1194          |
| M13 | ImportPasteSlotsFull     | S17                                        | Iphone390                                |
| M14 | ImportPasteSaved         | S35, S41                                   | Iphone390, Ipad834                       |

### 12.3 Redrawn this round (D13), at their existing sizes (web 1280 and 390, mobile Iphone390, Android384 and Ipad820 redrawn at Ipad834)

| Board                 | Change                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ImportLinkProgress    | Drop "Opened the page", which is a fetch. A paste never fetches. If the link import keeps this board, its steps name only what that route does.                                                           |
| ImportReviewDraft     | Drop "We checked its terms: you can share it" and the Public option for a web page. Private only, with the S10 line. The servings hold sits in "Needed before saving" at the top, and Save stays enabled. |
| ImportLinkPrivateOnly | Same: no Public row and no `aria-disabled` radio. One line says why it is private, with the slot count.                                                                                                   |
| ImportAlreadyImported | Drop "Another cook brought it in". Another cook's copy is invisible. Redraw as S30 with Duplicate, Replace and Cancel.                                                                                    |
| ImportPasteText       | Drop the source choice on the paste screen and "Make a draft". It becomes P2 (S1) with "Import recipe". The source moves to review.                                                                       |

**Further drift, flagged and not in this round's count.** `ImportWizardStep`, `ImportStatements` and `ImportWizardStates`
offer Public for a public web page, or say Private "needs Pro" (the Private choice in `ImportWizardStepWeb1280.dc.html`). That contradicts
ADR-0089 §5. They are bulk boards, and D6 borrows their look, so they should be redrawn in the bulk round (§15, U3).

---

## 13. Out of scope

- The link import ("Paste a link"), the photograph route, file and library import, and the share extension.
- The LLM text job itself (the spec 004 AI fallback). This spec draws its two visible states (S9's chip, S28) so the spec 004 AI fallback needs no new design.
- What Replace does to the old recipe (L1).
- Changes to the editor's Paste sheet. It stays for ingredient and step lists.
- Any image from a paste (blueprint §3, owner Q6).

---

## 14. Success measure

- **Goal:** a cook brings in a recipe from a page with its source right.
- **Signal:** pasted imports that reach a saved recipe, and the share of those whose statement the cook changed from the
  prefill.
- **Metric:** completion rate from Import to S35, with a 95% interval and its n, per platform. Guardrail: the rate of
  S21 and S22 refusals, and recipes deleted within 24 hours of a pasted save.
- **Instrumentation:** events at Import, review shown, Save pressed with holds, saved, and each refusal key. Who reads it:
  the lead, weekly, for the first month.
- **First sign of trouble:** S22 (plain text not readable yet) dominating web refusals before the spec 004 AI fallback. It would mean web
  cooks paste text rather than pages, and the spec 004 AI fallback is more urgent than planned.

### Owner exception to the both-platforms rule

The owner ruled on 2026-11-15, relayed by Nova Squad, that whole-page paste goes live on **web with PR C**, before the spec 004 AI
fallback, and accepted an exception to the rule that every user-facing feature ships to web and mobile in the same release
(`docs/CODING_STANDARDS.md` §14).

- **Web, from PR C:** the "Paste a recipe" row is live, with the page-only hint. A whole page is imported. A plain text
  paste gets S22, which says plain text comes later and offers "Write it yourself".
- **Mobile, until the spec 004 AI fallback:** the paste row is hidden. The chooser shows "Write it yourself" only.
- **Why:** a phone cannot practically copy a page's source, so a phone paste is plain text. Nothing reads plain text
  before the spec 004 AI fallback, so a mobile row would refuse every paste. A desktop cook can copy a whole page, so web gets real value
  now.
- **Ends when:** the spec 004 AI fallback ships. Then both platforms show the row, with the hint "Text, or a whole web page", and S22 is
  removed.
- **Scope:** this feature only. It sets no precedent for other features.

---

## 15. Open questions

### For the owner

- **O3. Photos from a pasted page.** None for now (D19). The owner is choosing between showing the page's photos by link,
  privately, and showing none. Nothing in this spec
  shows or imports a page's photo. The cook adds photos in the editor.

### For the architect

- **A1.** The on-device measurement of a large `TextInput` value and of the page reader under Hermes (blueprint flip
  condition 1). It decides whether S2 is ever seen and whether the native too-large rule (clear after the value arrives)
  is bearable.
- **A2. Blocking for mobile: plain text has no path to a recipe until the spec 004 AI fallback.** The page reader reads JSON-LD and
  microdata only, and I found no whole-recipe text splitter in `recipe-core` or `features/recipes`. In PR C, a phone
  cook (text only) reaches S22 every time, and the chooser hint "Text, or a whole web page" promises more than PR C does.
  My call, specified above: S22 with "Write it yourself" in PR C. My recommendation: release PR C and the spec 004 AI fallback together for
  the mobile chooser row, or ship the web row first and the mobile row with the spec 004 AI fallback.
- **A3. Duplicate detection.** The blueprint has no de-duplication. S30 needs a lookup of the cook's own recipes by
  citation (device query or a server field on the create answer). Name it and its cost.
- **A4. `ImportWizardStep` cannot be reused as is.** Its props require `position`, `total`, `onSkip`, `onNext`,
  `nextFocus` and `onSaveAndLeave`, it has no Save, and it has no statement or visibility block. This spec adds the
  sibling `ImportOneRecipeReview` and shares the line list. Confirm the shape at BLUEPRINT.
- **A5. Two columns at 1024.** D7 says the right column starts at 1024 on web. The house switches on the `wide` container
  class (960 of content), which a 1024 window with the sidebar does not reach. This spec follows the container rule.
  Changing it would move the threshold for the bulk step too.
- **A6. Cancel during import.** Cancel deletes the import. If `advance` has already paid the allowance unit, say whether
  the unit is refunded. The S7 copy promises only that the paste stays.

- **A7. Held from public.** D18 needs the server to send a public save to a person when the cook's statement is "I wrote
  this" and the item carried a third-party `suggestedStatement`. Where that rule lives (the ADR-0074 hold or the import
  save) is yours. The client needs nothing new beyond the existing badges.

### For the lead

- **L1.** What Replace does to the old recipe: its plans, lists, comments, versions, links and its id. The copy promises
  none of it. The confirm body may need one more true sentence once it is decided.

### For the UI Designer, reported rather than changed

- **U1. D7 and an established pattern.** `ImportModeChoice` disables Start until a mode is chosen, with `mode.startHint`
  saying why (`props.ts`, "Never called while no mode is chosen"). That is the import flow's existing
  disabled-with-reason pattern, and D7 departs from it. I specified D7. If D7 is the new rule, `ImportModeChoice` should
  follow in the bulk round. The `ImportReviewDraft` boards already agree with D7: Save is enabled while servings show
  "Needed before saving".
- **U2. Tablet boards.** The mobile canvas draws iPad 820, not 834 or 1194. This round draws 834 and 1194 (D14). The
  existing 820 boards stay until their own redraw.
- **U4. "Your imports" is not a label anywhere.** D17 says pasted imports appear in "Your imports". The only existing place is "To review" in My recipes. Naming the import list is a terminology one-way door. This spec uses "To review" until it is named.
- **U3.** The further drift in §12.3 (`ImportWizardStep`, `ImportStatements`, `ImportWizardStates`).

### UI Designer rulings on this section (2026-11-15)

These are decided. They change the open items above as follows.

- **D20, on A2. Superseded by the owner, 2026-11-15: web first.** The web row is live with PR C, with a page-only hint,
  and the mobile row stays hidden until the spec 004 AI fallback. The owner's exception and its reason are recorded in §14. S22 tells a web
  cook who pastes plain text that it comes later, and offers "Write it yourself".
- **On A5.** Follow the house container rule: two columns from the `wide` class (960 px of content). D7's "from 1024" means
  "where the layout is two columns".
- **On U1.** D7 applies to a form with several required parts, where Save must lead the cook to what is missing. A
  single required choice that gates Start, as in `ImportModeChoice`, keeps the disabled button with its visible reason.
  The two patterns answer different situations, so `ImportModeChoice` does not change.
- **On U2.** Keep D14. Draw 834 and 1194 this round. The 820 boards are replaced at their own redraw.
- **On U3.** Redraw `ImportWizardStep`, `ImportStatements` and `ImportWizardStates` in this round too. They offer Public for
  a web page, which ADR-0089 §5 forbids.
- **On U4.** Use "To review" in My recipes. D17's "Your imports" means that list. Do not name a new list.
- **On the chooser.** The sheet becomes a centred dialog at 640 px, as the component does. D14's "840" applies only to the
  shell (tab bar or sidebar).
