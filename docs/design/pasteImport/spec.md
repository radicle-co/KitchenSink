# Whole-page paste import: SPECIFY (web and mobile)

**What this is.** The build spec for pasting a recipe, as text or as a whole web page, on web and mobile. `fe-1` builds
PR C from it, and the designer draws the boards in §12 from it. It is a design document. It is not production code, and
no file it names exists until PR C builds it, unless this spec says it exists.

**Inputs.** The DISCOVER and DESIGN draft (`uxDraft.md`, held outside the repo), the architect's blueprint
(`blueprint.md`, outside the repo), which governs the wire, the pipeline and the caps, the UI Designer's decisions
(2026-11-15), and the owner's rulings of 2026-11-15 (§0).

**The spec 004 AI fallback.** The blueprint planned the AI text extraction as a fourth paste PR, "PR D". The owner moved
it into the recipe-importing feature spec (`specs/004-recipe-importing/`) on 2026-11-15, so it ships when that feature
is built. This spec calls it "the spec 004 AI fallback". The mobile paste row and the hint "Text, or a whole web page"
wait for it.

**Standing.** Written by `staff-ux-engineer`, SPECIFY mode. I authored the draft this spec converges. I read the boards
as source and did not render them, so the visual notes about the existing boards are from markup.

---

## 0. Decisions in force

These are settled. This spec specifies them and does not reopen them.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| D1  | Direction A: one box that becomes a source card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UI Designer                                                   |
| D2  | The chooser row reads "Paste a recipe", hint "Text, or a whole web page". The Add a recipe chooser is a deliverable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | UI Designer                                                   |
| D3  | The box becomes a card on any HTML signal (`<html`, `<script`, `application/ld+json`, case-insensitive) or plain text over 20,000 characters. Short text stays editable.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | UI Designer                                                   |
| D4  | "How to copy a whole page" is web only, collapsed, and never on phones. The shortcut copy is "verify before ship".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | UI Designer                                                   |
| D5  | A detected address is a suggestion. It fills and selects the statement, and the cook confirms it at Save. It is never set automatically (ADR-0072 §9, ADR-0089 §1 and §7, spec 016 FR-014). The cook may change it to another source or to "I wrote this". An LLM guess (the spec 004 AI fallback) is only a question chip.                                                                                                                                                                                                                                                                                                     | UI Designer, review 2026-11-15                                |
| D6  | The one-recipe review looks like the bulk step without "1 of 1", Skip, Next, the rail or the mode choice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | UI Designer                                                   |
| D7  | Save is never disabled. Holds sit in a "Needed before saving" group. Save with an unmet hold keeps the cook on the page, moves focus to the first unmet item and announces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | UI Designer                                                   |
| D8  | For a web copy, Public is hidden, with one line saying why and the private slot count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | UI Designer                                                   |
| D9  | Success opens recipe detail with the Checking badge (ADR-0074) and one polite announcement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | UI Designer                                                   |
| D10 | Several recipes on one page: a pick-one list on the device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | UI Designer                                                   |
| D11 | A copy of the same page already saved: the cook is told, with three actions, Duplicate, Replace and Cancel. Replace confirms first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owner ruling 1                                                |
| D12 | Lines from a page read "Pasted:". Typed text keeps "You wrote:".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Owner ruling 2                                                |
| D13 | The drifted boards are redrawn this round (§12.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | UI Designer                                                   |
| D14 | Sizes: phone 390 (iOS) and 384 (Android), tablet 834 and 1194, web 1280 with breakpoints 1024 and 768. Web below 840 behaves like a phone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | UI Designer, owner P5                                         |
| D15 | `TextArea` always gets a `maxRows` cap here. The card is its own render component, chosen by the orchestration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | UI Designer                                                   |
| D16 | A paste spends the one import allowance (spec 004 `FR-067`). There is no paste counter. Quota copy names the import allowance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner ruling 2026-11-15. ADR-0072 §8.                         |
| D17 | The paste box lives on the chooser path. The editor's Paste sheet stays for ingredient and step lists. No "Paste from clipboard" button on mobile (Settled 34). Section names keep the "For the glaze: " step prefix as plain text. Pasted imports appear in "Your imports".                                                                                                                                                                                                                                                                                                                                                    | UI Designer                                                   |
| D18 | A change from a detected third-party source to "I wrote this" saves normally. The recipe cannot go public until a person clears it. Private is never blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner ruling 2026-11-15                                       |
| D19 | At the AI spend ceiling the paste ends with a clear message and a path to type the recipe. It never waits for next month. The page's main photo follows §6.8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner rulings 2026-11-15                                      |
| D25 | At import the cook chooses Private, Public (a Commise-written version) or Both (spec 004 `FR-065`). If the rewrite cannot run, only Private is offered. Until the Commise-written version ships (spec 003B, planned), the rewrite cannot run, so a copy shows only Private, as D8 already draws.                                                                                                                                                                                                                                                                                                                                | Owner ruling 2026-11-15                                       |
| D26 | The page is read on the device in tiers: schema.org data, then microdata, then a rule-based reader, then an on-device AI tier when the account setting allows it (on by default on mobile, off on web), each a strict yes or no (spec 004 `FR-064`). The cook never reviews the extraction. P5 keeps the ingredient match review (ADR-0071) and the statement.                                                                                                                                                                                                                                                                  | Owner ruling 2026-11-15                                       |
| D27 | "Where is this recipe from?" is asked only when part of the recipe was pasted and the cook gave no statement (S9). Its choices are: I wrote this; from a web page; from a cookbook or magazine; from another person; keep it private (spec 016). The §7.4 keys and the S9 boards are re-specified to that set.                                                                                                                                                                                                                                                                                                                  | Owner ruling 2026-11-15                                       |
| D28 | The private copy keeps the page's wording, with food matching, and shows the source author's name (spec 004 `FR-066`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner ruling 2026-11-15                                       |
| D29 | On the slots-full dead end (S17) the main button is "Upgrade to Pro", with "Compare plans" and a "Not now" button of equal size (`010-FR-042c`, amended for this screen only).                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner ruling 2026-11-15                                       |
| D30 | Add a recipe (P1) is never a centred dialog or a sheet. The floating New recipe button (FAB) opens a speed dial. The inline New recipe button on the My recipes search row (N1) and the sidebar New recipe button (`RecipeCreateButton`) open an anchored menu. The options are spec 004's: Paste a recipe, Paste a link, Photograph a recipe card, More ways, and Write it yourself. There is no fixed cap: one item per way in that has shipped, up to spec 004's five. A way in whose flow has not shipped is absent. A centred modal is kept for a task that must block all interaction and context, and this one does not. | Owner comment on the ImportAddRecipeWeb1280 board, 2026-11-17 |
| D31 | Paste is available on all devices: the web paste item shows in P1 on every web screen, touch browsers included. Nothing hides it by pointer type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Owner answer 2026-11-17 (was O7)                              |
| D32 | Leaving a started import has no confirm. Back just leaves, the import is already saved, and a short snackbar says where (`importMessages.leave.saved`). The "Leave the import?" dialog (`ImportWizardLeave`) is dropped.                                                                                                                                                                                                                                                                                                                                                                                                        | Owner answer 2026-11-17 (was Q7)                              |

Governing documents read: `docs/design/uiRefreshWorkshop5/ownerFeedback.md` (N1, N8, P4, P5, C2, E1 apply),
`docs/research/userNeeds/synthesis.md` (theme 1, need 2, designer point 1), ADR-0072 §3, ADR-0074 §3a, ADR-0089 §1, §5
and §7, and the owner's type-scale and 28 pt rulings in memory (even sizes only, which overrides C1's 13, 15 and 17).

D30 rests on the owner ruling of 2026-11-17. It widens `docs/design/uiOverhaul/createEntryC.md` §8, the "M3 FAB menu / speed dial" row, which
flips to a speed dial on Android only, to iPhone and web 390 as well, and it overrides that file's objections to an
extended FAB and to the iOS form. The flip condition alone ("the chooser becomes pure buttons") is not what carries it:
P1 is now pure buttons, but the ruling is the authority. The conflicts D30 opens with older rulings are answered in D30
to D32, and §15 lists what spec 004 must amend.

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
 │ ├─► P4 Already saved (duplicate) ──┤
 │ └──────────────────────────────────┴─► P5 Review ─ Save ─► P6 Recipe detail (Checking)
 └─ Write it yourself ─► editor (exists)
```

| Screen           | Web, 840 and wider                                        | Web below 840, phone 390 and 384                | Tablet 834 and 1194                        |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| P1 Add a recipe  | Menu anchored to the search-row New recipe (web from 600) | Speed dial from the FAB (web below 600, phones) | Menu anchored to the search-row New recipe |
| P2 Paste         | Full page in the Recipes area, eyebrow Back "‹ Recipes"   | Pushed page, chevron Back only (N8)             | Pushed page, chevron Back with "Recipes"   |
| P3 Pick one      | Full page, replaces P2 in history                         | Pushed page                                     | Pushed page                                |
| P4 Already saved | Full page                                                 | Pushed page                                     | Pushed page                                |
| P5 Review        | Two columns at the `wide` container class, else one       | One column, Save pinned at the bottom           | 834: one column. 1194: two columns         |
| P6 Recipe detail | Exists. Gains the Checking badge                          | Exists                                          | Exists                                     |

On mobile, until the spec 004 AI fallback ships, there is no P1: "New recipe" opens the editor directly, as it does
today, and no one-item menu is drawn or built. When it ships, mobile gets P1 with both items (§14).

Back from P5 returns to P2 with the card and the paste kept. Back from P3 or P4 returns to P2. P2's Back leaves the
flow without a prompt: nothing is saved yet and the clipboard still holds the paste. Once an import exists (after
Import), leaving keeps the item under "To review" in My recipes and says so in a snackbar, with no confirm (S39, D32).

Navigation on mobile is the Recipes tab's native stack (DD25). P2, P3, P4 and P5 are pushed screens. On success P5 is
replaced by P6, so Back from the recipe goes to My recipes, never into a finished review.

---

## 3. Layout

Container rules use the house container classes on `<main>`'s content width (`packages/apps/commise/ui/src/tokens/layout.ts`:
narrow below 600, regular below 960, wide from 960). The viewport rule decides only the shell (tab bar below 840, sidebar
from 840) and whether actions pin (below 840).

### 3.1 P1 Add a recipe

P1 is a menu of the ways to add a recipe. It is never a centred dialog or a sheet (D30). The control that opens it
decides its form. The viewport class decides the control (`packages/apps/commise/ui/src/tokens/layout.ts`: compact
below 600, medium below 840, expanded from 840).

| Viewport                                      | Control                                                           | P1 form       | Boards                                      |
| --------------------------------------------- | ----------------------------------------------------------------- | ------------- | ------------------------------------------- |
| Compact: web below 600, iPhone, Android phone | The floating "New recipe" (`CreateFab`)                           | Speed dial    | Web390, Iphone390, Android384               |
| Medium and expanded: web from 600, iPad       | The "New recipe" primary button on the My recipes search row (N1) | Anchored menu | Web768, Web1024, Web1280, Ipad834, Ipad1194 |
| Expanded web, 840 and wider, every screen     | The sidebar "New recipe" (`RecipeCreateButton`)                   | Anchored menu | Web1024, Web1280                            |

This follows the recipes canvases: `RecipesWeb390` and `RecipesIphone390` draw the FAB, `RecipesWeb768` and
`RecipesIpad820` draw the search-row button with a chevron. At web 390 the anchored menu is not used, because the
control there is the FAB. A sheet is not used either, because the owner ruled a speed dial for the FAB.

**Anchored menu (button).**

- It opens below the button, with its trailing edge on the button's trailing edge, 8 below it. When aligning the trailing edge would leave the window, it flips to align its leading edge with the button's leading edge. This is the case for the sidebar trigger, which sits in a 256 px sidebar. Width stays 320. When the
  space below is too small, it opens above. It never covers the button.
- Surface `paperOverlay`, radius 12, `shadows.lg`, a `lineDivider` hairline, 8 inner padding. No scrim. The page stays
  visible and a click outside closes the menu (non-modal).
- The button shows its open state: fill `actionPressed`, and the trailing `chevronDown` turns to point up.
- No title and no Close control inside. The menu's name is "Add a recipe" (`chooser.title`).

**Speed dial (FAB).**

- The items stack above the FAB, 12 above it, 8 apart, at the trailing edge. They share one width:
  `min(312, window - 32)`. Each item is a raised card: `paperOverlay`, radius 18, `shadows.lg`.
- A scrim (`scrim`) covers the whole screen, the tab bar included. A tap on the scrim closes the dial.
- The FAB becomes a 56 round button with the `x` glyph. Its name is "Close Add a recipe" (`chooser.close`).
- When the items are taller than the space above the FAB, the item column scrolls inside itself. The FAB never moves.

**Items, in both forms.** Each item is a whole-row control: glyph, title (`cardTitle`), hint (`meta`, `inkMuted`). No
trailing chevron: an item is an action, not a list row. Each item is at least 56 tall. In the menu the glyph is plain, 24. In the dial it sits in a 36 `surfaceMuted` disc. Title and hint wrap. Nothing truncates.

**Items, in this order on both platforms.** "Write it yourself" is always last.

| #   | Item                     | Hint                                     | Glyph            | Present when                                                                               |
| --- | ------------------------ | ---------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| 1   | Paste a recipe           | Text, or a whole web page                | `clipboardPaste` | Web from PR C (page-only hint until the spec 004 AI fallback). Mobile from the AI fallback |
| 2   | Paste a link             | A link to a recipe on the web            | `link` (new)     | The spec 004 link import ships. It opens its own screen. A field is not put in a menu      |
| 3   | Photograph a recipe card | A card or a cookbook page                | `camera`         | The spec 011 photo route ships, for the cooks its plan rule allows                         |
| 4   | More ways                | A file, or your library from another app | `fileUp` (new)   | The spec 004 file or library import ships (ADR-0072)                                       |
| 5   | Write it yourself        | Start from an empty recipe               | `pencilLine`     | Always                                                                                     |

- An item appears only when its flow has a destination. Until then it is absent. It is never disabled and never marked
  "soon". The host builds the item list from the routes that exist (a registry), so a missing route cannot be drawn.
- **With one item there is no menu.** When "Write it yourself" is the only item, the control opens the empty editor in
  one tap, with no expanded state and no `aria-haspopup`. That is mobile until the spec 004 AI fallback ships (§14), and
  the `ImportAddRecipeBeforeAiIphone390` board.
- **No fixed cap on items (D30).** The chooser lists one item per way in that has shipped, up to the five above. uiOverhaul D4's
  cap of three no longer applies.
- **Paste is on every device (D31).** The web paste item shows on every web screen, a touch browser included. Nothing
  hides it by pointer type. Before the AI fallback its hint is `chooser.pasteHintPageOnly`. A touch browser has no
  page-source view, so a paste there that holds no recipe gets the S21 refusal (`paste.refused.noRecipePageOnly`).
  Only the "How to copy a whole page" disclosure stays fine-pointer only (§3.6).

### 3.2 P2 Paste screen

Order, top to bottom, at every size:

1. H1 "Paste a recipe" (`largeTitle`, 28, the cap).
2. Hint (`meta`, `inkMuted`), tied to the box by `describedBy`.
3. **The entry slot**: either the box (`TextArea`) or the card (`PastedContentCard`). The orchestration picks one.
4. Status line (S2, S6, S7) or inline error (S23 to S28), in one region under the entry.
5. Web only, fine pointer only: the "How to copy a whole page" disclosure (§3.6).
6. Actions: Import (primary). On web from 840, Import sits at the end of an in-flow row, content width, with no Cancel
   (Back is the way out). Below 840 on web, on phones and on iPad 834, Import is full width and pinned at the bottom
   above the keyboard. iPad 1194 keeps Import in flow at the end of the column, as web from 840 does.

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
  kind (S8, S9). When the page has a main photo, a small source-photo preview sits beside the title (§6.8). It shows no
  control: the cook removes the photo later in the editor.
- **"Needed before saving" group** (§6.3): present only while at least one hold is unmet.
- **Lines:** `ImportLineList` (the shared `MatchLineList`), with the existing nothing-to-fix sentence.
- **Source and visibility:** the statement block (§8.2) and the visibility block.
- **Save area:** the confirmation line, then Save recipe.

| Container class       | Arrangement                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| narrow and regular    | One column: header, Needed group, source and visibility, lines, Save area. Save is pinned at the bottom (sticky bar, `data-import-bar`, as `ImportWizardStep` does today) so it is in reach however long the recipe.                                                                                                                                                                   |
| wide (960 of content) | Two columns. Left, flexible: header and lines. Right, 320 wide: Needed group at the top, then source and visibility, then the Save area in flow. The right column sticks to the top while the lines scroll. DOM order: header, Needed group, source and visibility, Save area, lines. The grid places the lines in the left column. Reading and Tab order reach Save before the lines. |

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

| Element                  | Web                                                                                                                      | Mobile                                                                                        | Disposition | Why                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Add a recipe (P1)        | Anchored menu from the search-row button from 600, or the sidebar New recipe from 840. Speed dial from the FAB below 600 | Speed dial from the FAB on phones. Anchored menu from the search-row button on iPad           | moved       | The control decides the form (D30). The FAB sits in thumb reach, so its items stack above it |
| Paste item in P1         | Shown on every web screen, touch included                                                                                | Shown from the AI fallback (§14)                                                              | kept        | Paste is available on all devices (D31)                                                      |
| Paste screen             | Page in the Recipes area                                                                                                 | Pushed screen in the Recipes stack                                                            | kept        | Same job                                                                                     |
| How to copy a whole page | Disclosure, fine pointer only                                                                                            | Absent                                                                                        | dropped     | Phones have no built-in source view (draft §1b, Apple Community 2026)                        |
| Box height               | 10 to 16 rows                                                                                                            | Phone 8 to 12 rows, tablet 10 to 16                                                           | collapsed   | The box and Import fit above the phone keyboard                                              |
| Paste gesture            | Ctrl or Command+V, or the context menu                                                                                   | The system paste menu on long press. No paste button, so no clipboard prompt (Settled 34)     | translated  | No clipboard read                                                                            |
| Import                   | End of an in-flow row from 840, content width                                                                            | Phones and iPad 834: full width, pinned at the bottom, above the keyboard. iPad 1194: in flow | moved       | Thumb reach. Full width removes wrap risk on "Import recipe" at +35%                         |
| Card URL                 | Wraps anywhere, at most 2 lines, then an ellipsis                                                                        | Same                                                                                          | kept        | The full address is in the review's Source field, so the card shows enough to recognise it   |
| Clear                    | Ghost button in the card                                                                                                 | Same, 44 pt or 48 dp target                                                                   | kept        | Always visible. No hover reveal                                                              |
| Pick one                 | Radio list, Import in flow                                                                                               | Radio list rows full width, Import pinned                                                     | moved       | Reach                                                                                        |
| Review                   | Two columns at wide, else one                                                                                            | One column, source before lines, Save pinned. 1194 two columns                                | moved       | Priority on a narrow screen is what blocks Save                                              |
| Save                     | In flow at the foot of the right column at wide, pinned below                                                            | Pinned at the bottom                                                                          | moved       | Reach                                                                                        |
| Duplicate actions        | One row, content width, primary first                                                                                    | Stacked, full width, primary nearest the thumb (bottom)                                       | moved       | Reach, and three labels do not fit one row at 320                                            |

**Primary action per platform.** Import, Save and the duplicate primary sit bottom and full width on phones and on web
below 840 (thumb zone, Fitts). From 840 on web they sit in flow at the end of the content, because the pointer is
precise and the eye ends there. Tablet 834 pins like a phone. Tablet 1194 keeps Import in flow and Save at the foot of the right column,
which is within the lower side reach for two hands at the edges.

**Hover, right-click, keyboard, drag.** Nothing depends on hover. The disclosure needs a click or Enter, not hover. The
context-menu paste on web has the touch equivalent of the system paste menu. Keyboard: every control is reachable by Tab.
There is no drag anywhere (WCAG 2.5.7 not engaged).

**Longest strings.** Controls are sized to their longest realistic string with +35%:

| Element           | Longest English                                                                       | Overflow rule                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import button     | "Import recipe" (13)                                                                  | Full width on phone. From 840 min-width 160, wraps to 2 lines, never truncates                                                                                                      |
| Save button       | "Save and replace" (16)                                                               | Same                                                                                                                                                                                |
| Duplicate actions | "Replace my copy" (15)                                                                | Stacked full width below 840. From 840 one row, each wraps to 2 lines                                                                                                               |
| Menu item         | "Photograph a recipe card" (24), hint "A file, or your library from another app" (41) | Title and hint wrap, no line limit. Dial width `min(312, window - 32)`, menu 320. At +35% a hint wraps to 3 lines, and the dial column scrolls inside itself if it runs out of room |
| Card recipe name  | A title up to the recipe title cap                                                    | Wraps, at most 3 lines, then ellipsis. Full name in the accessible name                                                                                                             |
| Card URL          | Up to 2,000 characters                                                                | `overflow-wrap: anywhere`, 2 lines, ellipsis                                                                                                                                        |
| Review H1         | Recipe title                                                                          | Wraps, never truncates                                                                                                                                                              |
| Pick-one row      | Recipe title                                                                          | Wraps, never truncates                                                                                                                                                              |

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

**Back and dismissal.** iOS edge swipe and the header chevron, Android system back, web browser back. The anchored
menu closes on Escape, a click or tap outside, and Tab out, and focus returns to New recipe. The speed dial closes on a
tap on the scrim, the FAB's close glyph, Escape on a hardware keyboard, and the Android system Back. Back closes only the
dial and never leaves the screen (`BackInterceptProvider`, DD25). Focus returns to the FAB.

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
- `link`: the trimmed paste is exactly one `http://` or `https://` address with no whitespace. Pure, in the same
  Specification. The paste is never opened (spec 004 `FR-064`).
- `shortText`: everything else.

Two named constants, owned by the blueprint's page reader beside its other caps (PR B), not by this screen:
`MAX_PASTE_BYTES = 2_000_000` and `PASTE_CARD_THRESHOLD_CHARS = 20_000`. The architect places them. This spec names
them only so the screen never repeats a literal.

**Per platform, too large.** The value is already in the field when the change event arrives, on both platforms. The
orchestration then clears the box and shows S25. Nothing is cut short. The cook pastes less. On native the measurement
of a large `TextInput` value is an open risk (§15, A1).

### 5.2 Per control

| Control            | Behaviour                                                                                                                                                                                                                     | Disabled when                                | Latency budget and feedback                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Menu item          | Closes P1 first, then navigates to its destination (the held-item rule of `ActionMenu`).                                                                                                                                      | Never. An item with no destination is absent | Instant                                                                            |
| Box                | Plain text, no rich paste. On `page` or `longText` the orchestration swaps it for the card. `shortText` stays editable.                                                                                                       | Never                                        | The swap happens in the same frame as the change on web. Reading over 1 s shows S2 |
| Card Clear         | Empties the paste, drops any import id, puts the empty box back and focuses it.                                                                                                                                               | Never                                        | Instant                                                                            |
| Import             | `empty`: focuses the box and announces S1's alert. `shortText` or `longText` in PR C: S22. `page` with no recipe: S21. `several`: P3. Otherwise mints one import id per paste, creates the import and advances to the review. | Never. Busy while importing (`busy`)         | Over 1 s S6, over 10 s S7 with Cancel                                              |
| Cancel (S7)        | Stops polling, deletes the import (`DELETE /import/{id}`), keeps the card, returns to S4 or S5.                                                                                                                               | Never                                        | Instant to the cook. The delete runs behind                                        |
| Pick-one radio     | Selects one title.                                                                                                                                                                                                            | Never                                        | Instant                                                                            |
| Pick-one Import    | No choice: focuses the group, announces "Choose a recipe first." Otherwise continues as Import with the chosen recipe.                                                                                                        | Never                                        | As Import                                                                          |
| Statement controls | Change the statement. Each choice is recorded (`recordChoices`).                                                                                                                                                              | Never                                        | Optimistic. A failed record shows S18 at Save                                      |
| Save recipe        | Unmet hold: S15. Otherwise records choices, calls `leave`, advances until saved, then opens P6.                                                                                                                               | Never (D7). Busy while saving                | Over 1 s the button's busy state. Over 10 s S34's slow line                        |
| Duplicate actions  | §6.5                                                                                                                                                                                                                          | Never                                        | Instant                                                                            |

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

| #   | State            | What the cook sees                                                                                                                                                                                                                       | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Empty, first run | Title, hint, empty box with its label, Import. Web fine pointer: the collapsed disclosure. Import pressed while empty: the box takes focus and an alert under it.                                                                        | Title "Paste a recipe" (`title`). Box label "Recipe" (`boxLabel`). Hint, web: "Paste the recipe’s text, or the whole page. We read it here and never visit the site." (`hint`). Hint, native: "Paste the recipe’s text. We read it here and never visit the site." (`hintNative`). Hint, web in PR C (paired with `chooser.pasteHintPageOnly`): "Paste the whole web page. We read it here and never visit the site." (`hintPageOnly`). `hint` replaces it, and it is deleted, when the spec 004 AI fallback ships. Import "Import recipe" (`import`). Empty press: "Paste a recipe first." (`emptyAlert`) |
| S2  | Reading          | Only when classifying or reading a page takes over 1 s. A static `clock` glyph and a line under the entry. Import is busy.                                                                                                               | "Reading what you pasted…" (`reading`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S3  | Short text       | The box, editable, with the text. Import enabled.                                                                                                                                                                                        | No new copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S4  | Page card        | `PastedContentCard`, page kind: `globe` glyph, kind line, recipe name if one was found, the site, the URL, the size, Clear. When several recipes were found, the recipe line gives the count instead. No address: the site line says so. | Kind "Web page pasted" (`card.pageKind`). Site "From {site}" (`card.from`). No address: "No web address in this page" (`card.noAddress`). Several: `card.recipeCount` one "{count} recipe on this page", other "{count} recipes on this page". Size "{size}" (`card.size`). Clear "Clear" (`card.clear`), accessible name "Clear the pasted page" (`card.clearPageName`)                                                                                                                                                                                                                                   |
| S5  | Long-text card   | `PastedContentCard`, text kind: `list` glyph, "Text pasted", line count and size, Clear.                                                                                                                                                 | Kind "Text pasted" (`card.textKind`). Lines `card.lines` one "{count} line · {size}", other "{count} lines · {size}". Clear name "Clear the pasted text" (`card.clearTextName`)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S6  | Importing        | After Import, over 1 s: static `clock` glyph and a line under the entry, Import busy.                                                                                                                                                    | "Getting the recipe ready…" (`importing`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S7  | Importing, slow  | Over 10 s: the line changes and a Cancel (secondary) appears beside it.                                                                                                                                                                  | "This is taking longer than usual. You can cancel, and your paste stays here." (`importingSlow`). "Cancel import" (`cancel`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 6.2 Refusals and errors on P2

Each shows under the entry as `role="alert"`, with `triangleAlert` in `attention`. The paste is always kept, except S25,
which never kept it.

In S19, S20, S21, S22, S26, S28, S47, S48 and S49 the same paste would be refused again, so "Write it yourself" is the primary action
and Import is not shown, pinned or in flow. Clear (or "Paste again") returns to S1, which shows Import.

| #   | State                                                        | Trigger                                                                                                                                  | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Actions                                                                                                                                                            |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S19 | No ingredients                                               | The page's recipe has no ingredient lines (device), or the item's issue is `noIngredients`.                                              | "We found {title}, but no ingredients in it." (`refused.noIngredients`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | "Write it yourself" (`writeIt`), Clear                                                                                                                             |
| S20 | No steps                                                     | No steps (device), or issue `noSteps`.                                                                                                   | "We found {title}, but no steps in it." (`refused.noSteps`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Same                                                                                                                                                               |
| S21 | No recipe in the page                                        | The page reader finds no recipe (PR C, before the LLM fallback).                                                                         | After the spec 004 AI fallback: "We couldn’t find a recipe in this page. Try copying just the recipe’s text, or write it yourself." (`refused.noRecipe`). PR C web, where plain text is refused (S22): "We couldn’t find a recipe in this page. Write it yourself, and paste the ingredients and the steps into it." (`refused.noRecipePageOnly`). `refused.noRecipe` replaces it, and it is deleted, when the spec 004 AI fallback ships                                                                                                                                        | Same                                                                                                                                                               |
| S22 | Text not readable yet (web, before the spec 004 AI fallback) | `shortText` or `longText` before the spec 004 AI fallback ships.                                                                         | "Plain text can’t be imported yet. That comes later. For now, paste the whole web page, or write the recipe yourself and paste the ingredients and the steps into it." Actions: "Write it yourself" (primary), "Paste again". (`refused.textNotYet`, `writeIt`, `pasteAgain`)                                                                                                                                                                                                                                                                                                    | Not reached on mobile: there is no paste route there until the spec 004 AI fallback (§14, owner exception). Removed on web when the spec 004 AI fallback ships.    |
| S23 | Offline                                                      | No connection at Import.                                                                                                                 | "You’re offline. Your paste is kept here. Import it when you’re back online." (`error.offline`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | "Try again" (**reuse** `wizard.retry`)                                                                                                                             |
| S24 | Server error                                                 | A 5xx, a timeout, or `failed`.                                                                                                           | "We couldn’t import this just now. Your paste is kept here. Try again in a moment." (`error.server`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | "Try again"                                                                                                                                                        |
| S25 | Too large                                                    | Over 2,000,000 UTF-8 bytes, before any parsing.                                                                                          | "This paste is {size}, and the most we can read is {limit}. Copy just the recipe and paste that." (`error.tooLarge`)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None. The box is empty and focused                                                                                                                                 |
| S26 | Recipe too large                                             | The extracted recipe is over `MAX_IMPORT_RECIPE_BYTES` (`packages/schemas/recipe/src/schemas/import.schema.ts`) on the device.           | "We found {title}, but it’s too long to import. Write it yourself, and paste the ingredients and the steps into it." (`error.recipeTooLarge`)                                                                                                                                                                                                                                                                                                                                                                                                                                    | "Write it yourself", Clear                                                                                                                                         |
| S27 | Import allowance used (D16)                                  | The view's `allowance.used >= limit`, or the item's issue is `waitingForAllowance`.                                                      | `error.allowance`, one: "You’ve used your import allowance of {count} recipe in 24 hours. You can import again from {time}. Your paste is kept here." other: "You’ve used your import allowance of {count} recipes in 24 hours. You can import again from {time}. Your paste is kept here."                                                                                                                                                                                                                                                                                      | None. `{time}` is `resetsAt`, formatted for the locale with the day when it is not today                                                                           |
| S28 | AI spend ceiling reached (the spec 004 AI fallback, D19)     | The text job answers `budgetSpent`. The paste ends here. Nothing waits for next month.                                                   | Page: "We can’t read this page right now. Write the recipe yourself. You can paste its ingredients and its steps into it." (`error.budgetSpentPage`). Text: "We can’t read this text right now. Write the recipe yourself. You can paste its ingredients and its steps into it." (`error.budgetSpentText`)                                                                                                                                                                                                                                                                       | "Write it yourself" (primary), Clear                                                                                                                               |
| S47 | Too long for the AI reader                                   | With the spec 004 AI fallback: the reduced text is over the AI input cap (`FR-058`), checked before any job. Nothing is sent or charged. | Page: "This page is too long for us to read. Copy just the recipe's text and paste that, or write it yourself." (`refused.aiTooLongPage`) (verify before ship). Text: "This text is too long for us to read. Paste just the recipe, or write it yourself." (`refused.aiTooLongText`) (verify before ship)                                                                                                                                                                                                                                                                        | "Write it yourself" (primary), "Paste again"                                                                                                                       |
| S48 | Page asks not to be read by AI                               | With the spec 004 AI fallback: no device tier said yes, and the page carries a data-mining opt-out (`FR-063`). No job, no charge.        | "We can't read this page automatically. Write the recipe yourself. You can paste its ingredients and its steps into it." (`refused.optOut`) (verify before ship). Neutral: it does not name the page's setting or blame the site.                                                                                                                                                                                                                                                                                                                                                | "Write it yourself" (primary), Clear                                                                                                                               |
| S49 | Only a link                                                  | Classifier `link` (§5.1).                                                                                                                | Before link import ships: "That's a link, and we don't open links here. Open the page, copy the whole page, and paste it here. Or write the recipe yourself." (`refused.linkOnly`) (verify before ship). After link import ships: "That's a link. To import from a link, use Paste a link." (`refused.linkOnlyUseLink`) (verify before ship). Mobile wording once the paste route exists: "That's a link, and we don't open links here. Open the page, copy the recipe's text, and paste it here. Or write the recipe yourself." (`refused.linkOnlyMobile`) (verify before ship) | Before link import: "Write it yourself" (primary), "Paste again". After: "Paste a link" (primary, opens the link method with the address filled in), "Paste again" |

The draft's "budget spent" is two different limits. S27 is the import allowance (owner ruling 3). S28 is the AI spend
ceiling (the spec 004 AI fallback, blueprint §7), and it never names the allowance because it is not one. Matching lines without the AI
check in review reuses the existing no-AI-check copy (**reuse**, the `ImportPasteNoAiCheck` board's words).

### 6.3 Review (P5) and its holds

| #   | State                               | What the cook sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8  | Source found (`suggestedStatement`) | Header meta "Pasted from {site}". Statement block filled and selected: From a source, the URL in Source, A public web page. A note under it. Above Save, the confirmation line. Public hidden, the private line shown (S10).                                                                                                                                                                                                                                                           | Meta "Pasted from {site}" (`review.fromSite`). Note "We found this address in what you pasted. Change it if it’s wrong." (`review.sourceFound`). Confirmation "Saving confirms this recipe is from {site}." (`review.confirmSource`)                                                                                                                                                                                                                        |
| S9  | Source not found                    | Header meta "Pasted". The statement block is inside the Needed group with nothing selected. With the spec 004 AI fallback only: when the text job proposed a site, a question chip with Yes and No above the choices. Yes fills From a source, the site, A public web page, still confirmed at Save. No removes the chip.                                                                                                                                                              | Meta "Pasted" (`review.fromPaste`). Prompt "We couldn’t find where this came from. Tell us, so it’s labelled right." (`review.sourceUnknown`). Chip (the spec 004 AI fallback) "Is it from {site}?" (`review.sourceGuess`), "Yes" (`review.sourceGuessYes`), "No" (`review.sourceGuessNo`)                                                                                                                                                                  |
| S10 | Ready                               | No unmet hold. No Needed group. Lines, source, the visibility line, Save.                                                                                                                                                                                                                                                                                                                                                                                                              | Title of the lines section "Ingredients" (**reuse** the editor's section title). Visibility line, web copy (D8): `review.webPrivate` one "A copy of a web page stays private. It uses 1 of your private slots, and {count} is left.", other "A copy of a web page stays private. It uses 1 of your private slots, and {count} are left." Pro (no limit): "A copy of a web page stays private." (`review.webPrivatePro`). Save "Save recipe" (`review.save`) |
| S11 | Hold: needs a statement             | In the Needed group: the statement block's "Where is it from?" with nothing chosen.                                                                                                                                                                                                                                                                                                                                                                                                    | Group heading "Needed before saving" (`hold.heading`). Item "Say where this recipe is from." (`hold.statement`)                                                                                                                                                                                                                                                                                                                                             |
| S12 | Hold: needs a cuisine               | In the group: the cuisine `Combobox` (the editor's `useCuisineField`).                                                                                                                                                                                                                                                                                                                                                                                                                 | "Choose a cuisine." (`hold.cuisine`)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S13 | Hold: needs servings                | In the group: the servings `Stepper`, empty.                                                                                                                                                                                                                                                                                                                                                                                                                                           | "How many people does it feed?" (`hold.servings`)                                                                                                                                                                                                                                                                                                                                                                                                           |
| S14 | Hold: needs times                   | In the group: prep and cook `DurationField`s.                                                                                                                                                                                                                                                                                                                                                                                                                                          | "Add prep and cook times. Zero is fine." (`hold.times`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| S15 | Save pressed with an unmet hold     | The cook stays. Focus moves to the first unmet control in the order statement, cuisine, servings, times (ADR-0072 order). Each unmet item gets a `danger` outline and its own error line. An alert announces the count and the first item.                                                                                                                                                                                                                                             | `hold.saveBlocked` one "{count} thing is needed before saving: {first}", other "{count} things are needed before saving. First: {first}". `{first}` is the item's own sentence from S11 to S14. Item error lines reuse those sentences                                                                                                                                                                                                                      |
| S16 | Visibility refused                  | Item issue `visibilityRefused`. Only reachable when the cook chose "I wrote this" and Public was refused. The visibility block shows in the group, focus target "Who can see it".                                                                                                                                                                                                                                                                                                      | "We can’t save it as public. Choose Private, or change where it’s from." (`hold.visibilityRefused`)                                                                                                                                                                                                                                                                                                                                                         |
| S17 | Private slots full                  | View `pause.reason = outOfSlots`, or a private save with no slot. A notice replaces the Save area. Focus target is the notice's heading.                                                                                                                                                                                                                                                                                                                                               | The dead end is the public version design spec's `ImportDeadEnd` (B5, boards `ImportPublicDeadEnd*`). Use its copy and actions.                                                                                                                                                                                                                                                                                                                             |
| S18 | Save refused                        | Item issue `saveRefused`, or a choice that did not record. An alert above Save. Save stays enabled.                                                                                                                                                                                                                                                                                                                                                                                    | "We couldn’t save this recipe. Your choices are kept. Try again." (`hold.saveRefused`)                                                                                                                                                                                                                                                                                                                                                                      |
| S34 | Saving                              | Save is busy. Over 10 s, a line above it.                                                                                                                                                                                                                                                                                                                                                                                                                                              | "Still saving. Stay on this page until it’s done." (`review.savingSlow`)                                                                                                                                                                                                                                                                                                                                                                                    |
| S37 | Lines from a page (D12)             | A matched line's original text, where the line list shows it, reads "Pasted:" for a paste and "You wrote:" for typed text.                                                                                                                                                                                                                                                                                                                                                             | "Pasted: “{line}”" (`review.linePasted`). "You wrote:" is **reuse** (the existing row view copy)                                                                                                                                                                                                                                                                                                                                                            |
| S38 | Offline in review                   | A banner above the lines. Choices stay in memory on this device. Save shows S23's sentence as an alert if pressed.                                                                                                                                                                                                                                                                                                                                                                     | "You’re offline. Your choices are kept on this device. Save when you’re back online." (`review.offline`)                                                                                                                                                                                                                                                                                                                                                    |
| S40 | Changed to "I wrote this" (D18)     | The cook changes a detected third-party source to "I wrote this". "Who can see it" appears with Private selected. A neutral note sits under the "Where is it from?" choice, its one position, in `inkMuted` `meta`, with no glyph and no colour. It shows whenever "I wrote this" replaced a detected source, whichever visibility is chosen. No dialog. The S8 note and the confirmation line "Saving confirms this recipe is from {site}." are removed, because they no longer hold. | `review.wroteItNote`: "If you make it public, a person checks it before others can see it. Private is not affected."                                                                                                                                                                                                                                                                                                                                        |
| S39 | Leaving after Import                | Back from P2, or closing the app, after an import exists and before Save. Back just leaves, with no confirm (D32). A polite snackbar on the next screen says where the import went.                                                                                                                                                                                                                                                                                                    | "Saved. Finish it from My recipes." (`importMessages.leave.saved`)                                                                                                                                                                                                                                                                                                                                                                                          |

**Hold field labels.** The controls in S12 to S14 keep the editor's labels: the keys `cuisineLabel`, `servingsLabel`,
`prepTimeLabel` and `cookTimeLabel` in `recipeFormMessages` (`packages/apps/commise/features/recipes/src/form/messages.ts`),
with that file's other cuisine and servings keys for the controls' own parts. No new `paste.*` key is added for them.
Only the hold sentences (`hold.*`) are new.

**The order of "Needed before saving".** The group always lists its items in one fixed order: where it is from (S11),
cuisine (S12), servings (S13), times (S14), then who can see it (S16). It is the order of the `ImportHold` union (§8.2)
and of S15's focus rule, and ADR-0072 fixes cuisine, servings and times in that order. Only unmet items show, and the
order of the ones left never changes. S16 never shows with S11, because S16 needs a chosen statement. A Replace (S44)
has no S11 and no S16, because the copy keeps its statement and its visibility. Cuisine, servings and times work as
they do for a new copy (§15, A10). Boards:
W11 at 1280 and 768, W19 at 390.

**Steps with section names.** A step that starts with the blueprint's "For the glaze: " prefix shows it as plain text,
part of the step. No heading, no bold.

**Section names in a hold sentence.** Each hold sentence is one whole string. Nothing is assembled from fragments.

### 6.4 Several recipes (P3)

| #   | State    | Copy (key)                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S29 | Pick one | Title "Choose a recipe" (`pickOne.title`). Line `pickOne.intro` one "This page has {count} recipe. Choose the one to import.", other "This page has {count} recipes. Choose the one to import." Group name "Recipes on this page" (`pickOne.groupLabel`). Import "Import recipe" (`import`). No choice pressed: "Choose a recipe first." (`pickOne.chooseFirst`) |

### 6.5 Already saved (P4) and Replace

Replace applies only to the cook's private copies. Imported wording never replaces a public recipe.

Trigger: when the cook presses Import, BEFORE `POST /import`, the recipe's detected address matches the citation of one of the cook's own saved recipes. Plain
text with no address is never checked. Another cook's copy is invisible and never matches (the draft's drift note). Because the check runs before the import is created, Cancel and "Keep my copy" spend nothing from the import allowance. Cancel returns to P2 with the card kept. "Import as a new copy" continues as Import.

**Primary action: "Import as a new copy" (Duplicate).** It is the one forward action that loses nothing, so it is the
safe default for a cook who does not stop to read. Replace is destructive, so it is secondary in `destructive` style with
a confirm step. Cancel is quiet. Order, web: primary, Replace, Cancel. Phone: stacked with the primary at the bottom,
nearest the thumb, then Replace, then Cancel on top.

| #   | State                                  | What the cook sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S30 | Already saved                          | H1, body with the saved copy's title as a link to it, three actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Title "You already have this recipe" (`duplicate.title`). Body "You saved {title} from {site} on {date}." (`duplicate.body`), where `{title}` is the link, name "Open {title}" (`duplicate.openName`). "Import as a new copy" (`duplicate.newCopy`). "Replace my copy" (`duplicate.replace`). "Cancel" (`duplicate.cancel`)                                                                                                                                                                                                 |
| S31 | Replace, confirm                       | `ConfirmDialog` (`@commise/ui/confirm-dialog`). Focus on its title. The destructive action is not the default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Title "Replace your copy of {title}?" (`replace.confirmTitle`). Body "The recipe you import now takes the place of the copy you saved on {date}." (`replace.confirmBody`). "Replace" (`replace.confirm`). "Keep my copy" (`replace.keep`)                                                                                                                                                                                                                                                                                   |
| S32 | Replacing                              | After confirm the cook goes to the review (P5) as usual. Save reads "Save and replace". While saving, the button is busy with the line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Save "Save and replace" (`replace.save`). Busy line "Replacing your copy…" (`replace.progress`)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S33 | Replace failed                         | An alert above Save. Save stays enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | "We couldn’t replace your copy. Try again, or import this as a new copy." (`replace.failed`). Action "Import as a new copy" (`duplicate.newCopy`)                                                                                                                                                                                                                                                                                                                                                                           |
| S36 | Replaced                               | Opens P6 with the Checking badge and one polite announcement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | "Your copy of {title} is replaced. We’re checking it." (`replace.done`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S42 | Several copies saved                   | The cook has more than one copy of this page. S30's body changes, and a list of the copies sits under it, newest first, nothing chosen. Each row is a radio: the copy's title, then a meta line with the saved date and the site. A copy whose `everPublished` is false reads "Draft", whatever its current status (§15, A8). Two copies saved the same day show the time too. The list holds at most 20 and the answer carries a `total`. When `total` is more than the copies shown, the body gives the total and says these are the most recent (§15, A9). One copy keeps S30 as it is.                                                                                                             | Body `duplicate.bodyMany`: one "You saved this page {count} time. To replace one, choose it first.", other "You saved this page {count} times. To replace one, choose it first." Over 20: `duplicate.bodyAtLimit`: "You saved this page {total} times. These are your {count} most recent copies." Group name `duplicate.copiesLabel`: "Your copies of this page". Row meta `duplicate.copyMeta`: "Saved {date} · {site}". Draft row `duplicate.copyMetaDraft`: "Draft · last saved {date} · {site}". The actions are S30's |
| S43 | Replace with no copy chosen            | "Replace my copy" pressed while several copies show and none is chosen. Focus moves to the list, which gets the `danger` outline and an error line under it. Nothing else happens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `duplicate.chooseFirst`: "Choose the copy to replace first."                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S44 | Replace: where it is from carries over | P5 after a confirmed Replace. A Replace keeps the copy's statement, source and visibility, so the statement block shows them as plain text, not as controls: "From a source", Source, What kind of source, Who can see it, the attribution line, the author line when the page names one (`editor.source.authorLabel`), and a line that says they carry over. There is no S8 note, no confirmation line and no private slot line, because nothing new is stated and no new slot is used. The header meta says which copy it replaces. Save reads "Save and replace". The save checks cuisine, servings and times like a new copy, with no statement, no visibility choice and no slot hold (§15, A10). | Meta `replace.meta`: "Pasted from {site}. Replaces your copy saved on {date}." Note `replace.keptNote`: "These come from your copy and carry over when you replace it." The labels are the `statement.*` keys and the attribution line is `editor.source.rightsLabel` (**reuse**)                                                                                                                                                                                                                                           |
| S45 | Replace a draft, confirm               | The chosen copy has `everPublished` false (§15, A8). Replacing it overwrites the draft in place, and no earlier version of it is kept, so the confirm says so instead of S31. `ConfirmDialog`: focus opens on the safe action. The two buttons are the same width: side by side where the dialog is wide enough, stacked full width with "Replace draft" on top where it is not.                                                                                                                                                                                                                                                                                                                       | Title `replace.draftConfirmTitle`: "Replace your draft of {title}?" Body `replace.draftConfirmBody`: "Your draft is overwritten, and no earlier version of it is kept." "Replace draft" (`replace.draftConfirm`). "Keep my draft" (`replace.draftKeep`)                                                                                                                                                                                                                                                                     |
| S46 | Replace refused: the copy changed      | Save and replace is refused because the chosen copy changed after the cook chose it, was deleted, or is no longer private. One message covers every cause. An alert takes the place of Save, with two actions. "Choose a copy again" reopens P4 with a fresh list. "Import as a new copy" turns the review into a new-copy review: the statement block becomes editable, filled from S8, the S8 note and the confirmation line come back, and the new copy uses a private slot, so S17 can follow. S33 stays for a failed request.                                                                                                                                                                     | `replace.conflict`: "We didn’t replace your copy, because it changed after you chose it or it’s no longer private. Choose a copy again, or import this as a new copy." "Choose a copy again" (`replace.chooseAgain`). "Import as a new copy" (**reuse** `duplicate.newCopy`)                                                                                                                                                                                                                                                |
| S50 | Already saved, public copy             | One matching copy, and it is public. As S30, with two actions: "Import as a new copy" (primary) and Cancel. No Replace. One line under the body.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Line "Your copy is public, so an import can't replace it." (`duplicate.publicNoReplace`) (verify before ship). Actions reuse `duplicate.newCopy` and `duplicate.cancel`.                                                                                                                                                                                                                                                                                                                                                    |
| S51 | Several copies, some public            | As S42. A public copy's row has no radio, and its meta line adds "Public". Replace shows while at least one private copy is listed. If every listed copy is public, S50 applies with the S42 body.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Meta "Public" (`duplicate.publicMeta`). S42's body keys are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

The copy never says what happens to plans, lists, comments, versions or the old recipe's page, because the lead has not
defined it (§15, L1). "Keep my copy" closes the dialog and returns to S30. "Keep my draft" returns to S42 with the
draft still chosen.

**Choosing a copy.** A row's accessible name is its title and its meta line, so two rows with the same title differ by
date. With several copies, Replace confirms against the chosen one: S31 for a copy whose `everPublished` is true, S45 for one
whose `everPublished` is false. The copy's current status does not decide it. Replacing still makes one version of the same recipe at the version the cook saw.

### 6.6 Success (P6)

| #   | State | What the cook sees                                                                                                                           | Copy (key)                                                                                                                               |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| S35 | Saved | Recipe detail replaces the review. The status row by the title shows "Checking", then the outcome per ADR-0074 §3a. One polite announcement. | Badge "Checking" (`checkingBadge`, shared, see §8.3). Announcement "{title} is saved. We’re checking it. Only you can see it." (`saved`) |

"Only you can see it" is true for every web copy (ADR-0089 §5) and for every private save. For a cook who chose "I wrote
this" and Public, the announcement is "{title} is saved. We’re checking it." (`savedPublic`). The draft's claim about
plans and lists has no source and is dropped.

### 6.6a Held from public until a person checks it (D18)

| #   | State                   | What the cook sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Copy (key)                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S41 | Saved, held from public | The cook chose "I wrote this" over a detected third-party source, and chose Public. A paste saves Private for now, so the recipe is saved private and waits for a person to check it before it can be public. Recipe detail shows the Private badge and the In review badge (ADR-0074 §3a: In review is decided by the check, whatever the visibility), and one line under them. When a person clears it, the cook can make it public and the line goes away. If the cook chose Private, none of this applies: the save is an ordinary private save (S35). The copy names no time and never says the recipe can never be public. | Line `heldForCheck`: "Only you can see this recipe. A person checks it before it can be public." Announcement `savedHeldForCheck`: "{title} is saved, and only you can see it. A person checks it before it can be public." The badge words are the existing Private and In review badges (**reuse**, ADR-0074 §3a). No web-copy attribution line shows, because the cook said "I wrote this" |

**The cook cannot clear the hold.** No control on recipe detail, in the editor, in the review or in a menu offers to
clear, dispute, appeal or speed up this check: no "Request review", no "I own this", no "Remove hold". Only a person's
decision ends it, and only a verified claim by the site itself can clear the underlying signal (2026-11-15). Editing the recipe does not clear it either. The cook can always keep the recipe private, which is never
blocked.

The boards draw S41 with the Private and In review badges and the held line under them (W13, W14). The mobile board M14
takes the same copy in the mobile round.

This is the ADR-0074 review path, not a new state of the recipe. What makes it go to a person rather than clear on its own is a server rule (§15, A7). The copy never says why, never mentions the detected site and never asks the cook to justify the choice.

### 6.7 Disclosure and Add a recipe copy

See §7.2 and §7.3. The states are numbered S1 to S51. P1 has these states, and no others:

| State    | What shows                                                                                             | Board                              |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Closed   | The control at rest: the search-row button with `chevronDown`, or the FAB with `plus` and "New recipe" | Recipes canvases                   |
| Open     | The menu or the dial with the items that exist. Focus on the first item                                | `ImportAddRecipe*`                 |
| One item | No menu. The control opens the editor                                                                  | `ImportAddRecipeBeforeAiIphone390` |
| Full set | All five items, when spec 004 and spec 011 ship                                                        | `ImportAddRecipeFullSet*`          |

P1 has no loading, empty, error or offline state of its own. The items come from code, not from a request. Offline, every
item still shows. Each destination owns its own offline state (the editor works offline, ADR-0057).

---

### 6.8 Photo from the page

Gated (spec 004 D-020): the page-photo routes ship only after the owner records a release sign-off.

The private copy of an imported recipe keeps the source page's main photo (spec 004 `FR-008`). One image only. Step photos
and galleries are out of scope.

**Where it shows.** The private copy's recipe detail, in the hero photo slot. My recipes cards, as the thumbnail. The
paste review (P5) header, as a small preview beside the title. Cooking mode and every other surface follow recipe
detail. Never on a public version (ADR-0093). A household never sees the source photo of a paid-site private copy: the
household view shows no image and no link row, the same as for the paid wording. The photo has no share or export
control. It leaves Commise only in the account data export.

**The cook's own photo comes first.** The source photo is used only while the cook has added none. The editor's photo
control shows it with "Remove photo". Removing it is final for that copy.

| #   | State                            | What the cook sees                                                                                                                                                                                                                                                            |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) | Saved                            | The photo, synced from the device.                                                                                                                                                                                                                                            |
| (2) | Loading                          | The house image placeholder at the slot's fixed aspect ratio, so nothing shifts.                                                                                                                                                                                              |
| (3) | Shown from the source, not saved | It looks the same as (1). Offline, it falls back to (4). It is never written to offline storage.                                                                                                                                                                              |
| (4) | Link only                        | No image area. One row reads "See the photo on {site}" (`privateCopy.photoLink`), with the external-link mark "↗" and the hidden text "(opens in a new tab)" (buildSpec E33). It opens the source page in the browser, and its accessible name says it opens outside Commise. |
| (5) | Failed                           | A failed device fetch or sync falls to (3), then to (4), with no error shown. A photo never blocks or holds a save.                                                                                                                                                           |

**Credit and alt text.** Under the image in (1) and (3): "Photo from {site}" (`privateCopy.photoCredit`, `meta`, linked
to the source page). The alt text is "{title}, photo from {site}" (`privateCopy.photoAlt`). The rights line has two forms
(§7.4). All copy needs a check before ship.

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

### 7.3 Add a recipe (P1)

| Key                         | Copy                                       | Used by                                       |
| --------------------------- | ------------------------------------------ | --------------------------------------------- |
| `chooser.title`             | "Add a recipe"                             | The menu's accessible name, both forms        |
| `chooser.close`             | "Close Add a recipe"                       | The FAB's name while the dial is open         |
| `chooser.paste`             | "Paste a recipe"                           | Item 1                                        |
| `chooser.pasteHint`         | "Text, or a whole web page"                | Item 1, after the spec 004 AI fallback        |
| `chooser.pasteHintPageOnly` | "Copy a whole web page and paste it"       | Item 1 on web, until the spec 004 AI fallback |
| `chooser.link`              | "Paste a link"                             | Item 2 (new)                                  |
| `chooser.linkHint`          | "A link to a recipe on the web"            | Item 2 (new)                                  |
| `chooser.photo`             | "Photograph a recipe card"                 | Item 3 (new)                                  |
| `chooser.photoHint`         | "A card or a cookbook page"                | Item 3 (new)                                  |
| `chooser.more`              | "More ways"                                | Item 4 (new)                                  |
| `chooser.moreHint`          | "A file, or your library from another app" | Item 4 (new)                                  |
| `chooser.write`             | "Write it yourself"                        | Item 5                                        |
| `chooser.writeHint`         | "Start from an empty recipe"               | Item 5                                        |

The trigger's name is the existing `list.createCta` ("New recipe") on both forms. It is not a new key, and it gains no
suffix such as "choose how to add it": `aria-haspopup="menu"` and the expanded state already say it opens a menu.

The keys sit under `importMessages.chooser.*`, not `paste.*`, because P1 outlives this feature. The six new keys ship
with the flows they name, not with PR C. A key with no item is dead copy.

Until the spec 004 AI fallback ships, the web item uses `chooser.pasteHintPageOnly`, because plain text cannot be read
yet and the hint must not promise it. P2 pairs it with `paste.hintPageOnly` and S21 with
`paste.refused.noRecipePageOnly`. When the spec 004 AI fallback ships, the hint becomes `chooser.pasteHint` and the
three page-only keys are deleted. Mobile has no menu until the spec 004 AI fallback: "New recipe" opens the editor
directly. After it ships, mobile shows the menu with both items (§14, owner exception).

### 7.4 Statement block keys (`importMessages.statement.*`)

The words are the `ImportStatements` and `ImportWizardStep` boards'. They sit under `statement.*`, not `paste.*`,
because the bulk import's statement screens will read the same strings. One source for one piece of knowledge.

| Key                     | Copy                             |
| ----------------------- | -------------------------------- |
| `statement.whereFrom`   | "Where is it from?"              |
| `statement.wroteIt`     | "I wrote this"                   |
| `statement.fromSource`  | "From a source"                  |
| `statement.sourceLabel` | "Source"                         |
| `statement.kindLabel`   | "What kind of source?"           |
| `statement.publicWeb`   | "A public web page"              |
| `statement.bookOrPaid`  | "A book or a paid site"          |
| `statement.whoCanSee`   | "Who can see it"                 |
| `statement.public`      | "Public"                         |
| `statement.publicHint`  | "Anyone can find it in Discover" |
| `statement.private`     | "Private"                        |
| `statement.privateHint` | "Only you can see it"            |

**The attribution line for a web copy has two keys: `editor.source.rightsLabel` and `editor.source.rightsLabelWithPhoto`**
(`packages/apps/commise/features/recipes/src/editor/messages.ts`). The editor's Source field renders `rightsLabel` today. The
page's photo decides which key shows. This feature changes the copy of the first and adds the second. The new copy was settled on 2026-11-15:

- `editor.source.rightsLabel`: from "Copied from a public web page · {site}" to "Saved from {site}. The words belong to
  their author. Private to you." (shown when no photo from the page is shown; with one, `editor.source.rightsLabelWithPhoto`)

`{site}` is the registrable domain, as it is today (ADR-0089 §3). The review (S8, S10) and recipe detail, wherever the
source is shown, read the same key. Two items join that key's existing "Words to avoid" list in the
same file, which stays the one list: wording that names the site as the author or suggests it endorses the copy ("By
{site}", "From the kitchen of {site}"), and any claim that we checked the copyright, the terms or the right to share. The
board drift "We checked its terms: you can share it" (§12.3) is removed for the same reason.

"Who can see it" shows only when "I wrote this" is chosen. For a web page or a book, the visibility line (S10) replaces it
(D8). Nothing is disabled, so no `aria-disabled` radio is ever drawn.

The private copy also shows the source author's name where the page gives one (D28, spec 004 `FR-066`). It is
the line under `editor.source.rightsLabel`: "Recipe by {author}." (`editor.source.authorLabel`). It shows only when the page
names an author.

_(Amended 2026-11-15, D27.)_ The statement keys above predate the owner's five choices for "Where is this recipe
from?". They are re-specified to that set at the next SPECIFY round, so the paste screens and the bulk import read one
set of strings.

### 7.5 Your imports

A pasted import lists like any import, wherever imports are listed (D17). No screen in code or on the canvases is named "Your imports" today, and the bulk copy sends waiting items to "To review" in My recipes (`leave.resume`), so S39 names that place (§15, U4). The S39 snackbar is the new key `importMessages.leave.saved`. The existing `leave.resume` is the body of the dropped bulk "Save and leave?" dialog, with a `{next}` and plural text, so it is not reused. Its row reads the recipe title, then "Pasted · {site}" (`yourImports.fromSite`)
or "Pasted text" (`yourImports.fromText`).

---

## 8. Components and tokens

### 8.1 Existing, reused (paths checked in this worktree)

| Part                                                                                                          | Path                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateFab`, `ActionMenu` (its Radix base and held-item rule), `Button`                                       | `packages/apps/commise/ui/src/createFab/`, `ui/src/actionMenu/`, `ui/src/button/`                                                                        |
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

**The P1 host (feature, not a render component).** `RecipeCreateButton` (`features/recipes/src/list/`) already
selects the create control by where it is drawn. It gains the item list and picks the form:

- one item: today's control, which runs the item (no menu);
- two or more, compact viewport: `CreateFabMenu` (§8.3);
- two or more, medium or expanded: `CreateMenuButton` (§8.3) on the search row. The sidebar variant opens P1 as described in §3.1.

The item list comes from one pure registry, `addRecipeItemsOf(routes)`, which lists only the routes that exist, in the
§3.1 order, with "Write it yourself" last. It is the only place that decides which items show. P1 needs no feature
render component of its own: both forms are design-system primitives.

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
2. **Glyphs `link` and `fileUp`**, when items 2 and 4 ship. Not needed for PR C.
3. **`@commise/ui/create-menu`, a new package export with two render components and one item type.** Both are needed
   for PR C on web, and for mobile when the spec 004 AI fallback ships.

    ```ts
    /** One way to add a recipe. There is no `disabled` field: an item with no destination is absent. */
    interface CreateMenuItem {
        readonly id: string;
        readonly icon: IconName;
        readonly title: string;
        readonly hint: string;
        readonly onSelect: () => void;
    }
    interface CreateMenuProps {
        /** The control's visible label and name: "New recipe". */
        readonly label: string;
        /** The menu's accessible name: "Add a recipe". */
        readonly menuLabel: string;
        /** Two or more, in order. The host renders no menu for one. */
        readonly items: readonly CreateMenuItem[];
        readonly focusRequested?: boolean;
        readonly onFocusRequestHandled?: () => void;
    }
    interface CreateFabMenuProps extends CreateMenuProps {
        /** The open FAB's name: "Close Add a recipe". */
        readonly closeLabel: string;
    }
    ```

    - **`CreateMenuButton`** (anchored menu). Web leaf: Radix `DropdownMenu` with `modal={false}`, the same base as
      `ActionMenu`'s web leaf, so it inherits the APG menu-button keyboard model. The trigger is the design-system
      `Button` (primary, `plus`, trailing `chevronDown`). Native leaf (iPad): an anchored Tamagui `Popover` with no
      adapt-to-sheet, holding `menuitem` rows. This is new: `Popover.native` and `ActionMenu.native` are both sheets
      today, because a phone has no room to anchor. An iPad does.
    - **`CreateFabMenu`** (speed dial). Composes `CreateFab` for the closed face and keeps every `CreateFab` rule
      (placement, shrink on scroll, hidden with the keyboard, yields in first run). Open: the scrim, the item stack and
      the close face (§3.1). Web leaf: Radix `DropdownMenu`, modal, with the scrim as its overlay. Native leaf: a
      Tamagui `Portal` over the screen, with `BackInterceptProvider` for Android Back.
    - Both reuse `ActionMenu`'s held-item rule: a chosen item runs once the menu has gone, so the screen it opens never
      meets the menu.
    - Why not extend `ActionMenu`: its contract is a row's actions behind a `⋯` named for that row, with a structural
      destructive slot and a sheet on native. A create menu has a labelled primary trigger, hints, no destructive
      action, and two native forms. Folding both into one component needs a mode prop that switches behaviour, which
      the house forbids. The two share the Radix base, not the component.
    - Why not `Popover`: it is a titled `role="dialog"` with a Close control. A list of actions is a menu.
    - Retired prior art: `features/recipes/src/speedDial/SpeedDial.tsx` (commits `d53f2b08f`, `644a5b5e4`), built on
      the owner ruling of 2026-08-25 and retired by uiOverhaul D4. Read it in history for its tests. Do not restore it into the
      feature package: the menu now lives in the design system, so web and native and every create surface share it.

4. **`CreateFab` yields from the medium viewport.** The recipes canvases draw the search-row button from 600 (N1), and
   `RecipeCreateButton` still floats the FAB below 840. `createFabPolicy` answers `hidden` from `medium`, and the
   search-row button takes its place. `docs/design/uiOverhaul/buildSpec.md` §3.4 (tablet: always-extended FAB) is
   superseded by N1 and the canvases on this point.

No new token. No disclosure primitive (web only, native `<details>`).

### 8.4 Tokens used

Type roles only (`packages/apps/commise/ui/src/tokens/typography.ts`): `largeTitle` 28 for H1s (the cap), `sectionTitle`
18, `cardTitle` 16, `body` 16, `label` 14, `meta` 14. Every size is even.

Colour: `ink`, `inkMuted`, `paper`, `paperRaised`, `lineDivider`, `lineControl`, `attention` for warning glyphs,
`danger` for the unmet-hold outline and its error line, `action` only on the enabled primary button fill and the card's
left edge (P4, C2), `focusRing`.

Space (`spacingRole` in `tokens/layout.ts`): `gapWithin` 8 inside the card, `gapGroup` 16 between the entry and its
status, `gapSection` 32 between the review's groups, `headerToContent` 24 under H1s. Radius `md` for the card and the
group.

### 8.5 Pattern register

| Unit                                                          | `@pattern`                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pastedContentKindOf` (classifier, §5.1)                      | Specification: the card rule written once                                                       |
| `pastedRecipeImport` reducer                                  | State, with each transition a Command (blueprint)                                               |
| `usePastedRecipeImport`                                       | Headless hook: the orchestration that picks box or card, page or pick-one, and owns focus moves |
| `PasteImportPage`                                             | Template: a fixed frame with an entry slot the host fills                                       |
| `PastedContentCard`                                           | Visitor, satisfied by the language: an exhaustive switch over `PastedContentSummary`            |
| `NeededBeforeSaving`                                          | Visitor, satisfied by the language: an exhaustive switch over `ImportHold`                      |
| `ImportOneRecipeReview`                                       | Template: the same slots as the bulk step, a different frame                                    |
| `addRecipeItemsOf`                                            | Registry: the list of routes that exist, built once                                             |
| `RecipeCreateButton`                                          | Strategy, selected by the host: no menu, `CreateFabMenu` or `CreateMenuButton`                  |
| `CreateMenuButton`, `CreateFabMenu`                           | Menu Button (WAI-ARIA APG), an Adapter over Radix `DropdownMenu` on web and Tamagui on native   |
| `PickOneRecipe`, `AlreadySavedNotice`, `ImportStatementBlock` | No tag beyond their layer, unless the builder finds one                                         |

Preserved: `ImportWizardStep`, `ImportLineList`, `MatchLineList`, `Sheet`, `ActionMenu` and `CreateFab` keep their contracts. Already satisfied, so
add nothing: TanStack mutations are the Commands for create, record and leave. Focus requests use the existing
`ControlFocus` request and acknowledge pair.

---

## 9. Accessibility contract (WCAG 2.2 AA)

Claimed level: WCAG 2.2 AA, both platforms. EN 301 549 cites 2.1 AA, which 2.2 AA satisfies.

- **Headings.** One H1 per screen (P2, P3, P4, P5). In P5 "Needed before saving", the source block and "Ingredients"
  are H2. P1 is a menu, so it has no heading. Its name is "Add a recipe" (§9a).
- **Reading order (1.3.2, 2.4.3).** In P5's two columns the DOM order is header, Needed group, source and visibility,
  Save area, then lines. The grid places the lines in the left column. Visual order differs, but Tab and the screen
  reader reach Save without passing every line. One column uses the same DOM order.
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
- **Targets (2.5.8).** Clear, the radio rows, the guess chip's Yes and No, and the duplicate actions
  are at least 24 CSS px on web, and 44 pt on iOS and 48 dp on Android by platform convention. The P1 items are 56 (§9a).
- **Focus not obscured (2.4.11).** The pinned bars reserve their height under a focused field (`data-import-bar` on web,
  field reveal on native).
- **Contrast (1.4.3, 1.4.11).** Text on `paperRaised` uses `ink` and `inkMuted`. The card's `action` edge is decoration,
  not the only cue, so 1.4.11 does not bind it. The unmet outline in `danger` must reach 3:1 against `paperRaised` in
  light and dark. The designer checks both on the boards.
- **Duplicate and Replace.** S31 opens a `ConfirmDialog` that traps focus, lands on its title, and returns focus to
  "Replace my copy" on Keep.
- **Route changes.** Every new screen moves focus to its H1. P6 follows recipe detail's existing landing.
- **Voice control.** Every visible label is contained in its accessible name.
- **Reduced motion.** No motion beyond the platform's own push and sheet transitions, and P1's (§9a).

### 9a. P1 Add a recipe

- **Roles (4.1.2).** Web: the trigger has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`. The menu is
  `role="menu"`, named "Add a recipe". Each item is `role="menuitem"`, named by its title, with the hint as its
  description (`aria-describedby`). Native: the trigger has `accessibilityRole="button"` and
  `accessibilityState={{ expanded }}`. The item container has `accessibilityRole="menu"`, each item
  `accessibilityRole="menuitem"` with the hint as `accessibilityHint`. The one-item control has no popup and no
  expanded state.
- **Focus (2.4.3, 2.1.1).** On open, focus moves to the first item (screen-reader focus on native). Arrow Up and Down
  move between items and wrap. Home and End go to the first and last. Enter or Space runs the focused item. Escape
  closes and returns focus to the trigger. On web Tab closes the menu and moves on. The speed dial traps focus in the
  items and the close FAB while it is open, because the scrim blocks the rest of the screen.
- **Dismissal.** The menu closes on Escape and on a click or tap outside. The dial closes on the scrim, the close FAB,
  Escape, and Android Back. Every close returns focus to the control that opened it.
- **Targets (2.5.8).** Items are at least 56 tall and full width of the menu, above 44 pt and 48 dp. The open FAB is 56.
- **Name in label (2.5.3).** The trigger's name is its visible label, "New recipe". The open FAB has no visible label,
  so its name is "Close Add a recipe", which a voice user reads from the `x` glyph's meaning.
- **Contrast (1.4.3, 1.4.11).** Item text on `paperOverlay` uses `ink` and `inkMuted`. The focused item's 2 px
  `focusRing` and the open button's `actionPressed` fill must reach 3:1 in light and dark. The designer checks both
  on the boards.
- **Reflow (1.4.10).** At 320 the dial is 288 wide and the menu is not used (320 is compact). Titles and hints wrap. No
  horizontal scroll.
- **Motion (2.3.3).** The items fade and rise 8 over the platform's short duration, staggered by at most 3 steps. Under
  reduced motion they appear at once.

---

## 10. Motion

None of our own beyond P1. Screen pushes, the sheet and the dialog use the platform's and the primitives' transitions, which
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

The boards draw the state after the spec 004 AI fallback: both platforms show the paste item with "Text, or a whole web page". The web P1
board adds one more variant with the page-only hint, `ImportPasteEmptyWeb1280` adds a page-only S1 frame, and W6 draws S21
with `refused.noRecipePageOnly` and the S22 board, for the PR C release (§14).

**Sample values, the same on every board.** URL `https://www.allrecipes.com/recipe/26317/chicken-pot-pie-ix/` (site
`allrecipes.com`, recipe "Chicken pot pie"). Dates as `Intl` long form, day month year: "2 November 2026". Private
slots: "12 are left". S27: an allowance of 200 recipes in 24 hours (ADR-0072), with `{time}` as a time of day today,
"8:15 am".

### 12.1 `recipeImportingWeb`

| #   | Board                                                                | States shown                                                                                                                                                                | Sizes                                                     |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| W1  | ImportAddRecipe (redraw)                                             | P1 open, two items: the anchored menu from 768, the speed dial at 390 (D30). PageOnly at 1280: the PR C hint. FullSet: all five items, labelled as the state after spec 004 | 1280, 1024, 768, 390, PageOnly 1280, FullSet 1280 and 390 |
| W2  | ImportPasteEmpty                                                     | S1, and S1 page only (PR C) at 1280. 1024 shows the disclosure open                                                                                                         | 1280, 1024, 768                                           |
| W3  | ImportPastePageCard                                                  | S4 with a recipe name                                                                                                                                                       | 1280, 768                                                 |
| W4  | ImportPasteTextCard                                                  | S5, and S3 beside it                                                                                                                                                        | 1280                                                      |
| W5  | ImportPasteWaiting                                                   | S2, S6, S7                                                                                                                                                                  | 1280                                                      |
| W6  | ImportPasteRefused                                                   | S19, S21 (page only, PR C), S22, S25, S26                                                                                                                                   | 1280, 768                                                 |
| W7  | ImportPasteErrors                                                    | S23, S24, S27, S28                                                                                                                                                          | 1280                                                      |
| W8  | ImportPastePickOne                                                   | S29                                                                                                                                                                         | 1280, 768                                                 |
| W9  | ImportPasteDuplicate                                                 | S30, S31, S33 and S32, with S44's read-only statement                                                                                                                       | 1280, 768                                                 |
| W10 | ImportPasteReview                                                    | S8, S10, S37, S40                                                                                                                                                           | 1280, 1024, 768                                           |
| W11 | ImportPasteReviewHolds                                               | S9, S11 to S15 after Save                                                                                                                                                   | 1280, 768                                                 |
| W13 | ImportPasteSaved                                                     | S35, and S41 (Private, In review and the held line) beside it                                                                                                               | 1280, 768                                                 |
| W14 | ImportPasteHeld                                                      | S41                                                                                                                                                                         | 390                                                       |
| W15 | ImportPasteCopies                                                    | S42, S43, and S42 at the 20-copy limit (1280 only)                                                                                                                          | 1280, 390                                                 |
| W16 | ImportPasteReplaceReview                                             | S44                                                                                                                                                                         | 1280, 390                                                 |
| W17 | ImportPasteReplaceDraft                                              | S45                                                                                                                                                                         | 1280, 390                                                 |
| W18 | ImportPasteReplaceConflict                                           | S46                                                                                                                                                                         | 1280, 390                                                 |
| W19 | ImportPasteReviewHolds                                               | S11 to S15 in their fixed order (W11 at 390)                                                                                                                                | 390                                                       |
| W20 | `ImportPasteReadRefused`                                             | S47, S48, S49                                                                                                                                                               | 1280, 768, 390                                            |
| W21 | `ImportPasteDuplicatePublic`                                         | S50, S51                                                                                                                                                                    | 1280, 768, 390                                            |
| W22 | `ImportPasteReviewPhoto`                                             | The P5 source-photo preview                                                                                                                                                 | 1280, 768, 390                                            |
| W23 | `recipeDetailWeb` `RecipePrivateImportPhoto{Saved,Loading,LinkOnly}` | Photo states (1), (2) and (4), §6.8                                                                                                                                         | 1280, 390                                                 |
| W24 | `ImportLinkPasteInstead`                                             | A link we may not fetch: paste the page instead                                                                                                                             | 1280, 768, 390                                            |

W14 to W19 have no 768 board. Web below 840 lays these screens out as it does at 390: one column, actions pinned and
stacked. The confirm dialog puts its buttons side by side at 768, as it does at 1280.

### 12.2 `recipeImportingMobile`

| #   | Board                                                                   | States shown                                                                                                                               | Sizes                                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M1  | ImportAddRecipe (redraw)                                                | P1 open, two items: the speed dial on phones, the anchored menu on iPad (D30). FullSet: all five items. BeforeAi: no menu, the FAB at rest | Iphone390, Android384, Ipad834, Ipad1194, FullSet Iphone390, BeforeAi Iphone390 |
| M2  | ImportPasteEmpty                                                        | S1, keyboard closed                                                                                                                        | Iphone390, Android384, Ipad834, Ipad1194                                        |
| M3  | ImportPasteKeyboard                                                     | S3 with the keyboard open, Import above it                                                                                                 | Iphone390, Android384                                                           |
| M4  | ImportPasteTextCard                                                     | S5                                                                                                                                         | Iphone390, Android384                                                           |
| M5  | ImportPastePageCard                                                     | S4                                                                                                                                         | Iphone390, Ipad1194                                                             |
| M6  | ImportPasteWaiting                                                      | S6, S7                                                                                                                                     | Iphone390                                                                       |
| M7  | ImportPasteRefused                                                      | S25, S26                                                                                                                                   | Iphone390, Ipad834                                                              |
| M8  | ImportPasteErrors                                                       | S23, S27                                                                                                                                   | Iphone390                                                                       |
| M9  | ImportPastePickOne                                                      | S29                                                                                                                                        | Iphone390, Ipad1194                                                             |
| M10 | ImportPasteDuplicate                                                    | S30, S31                                                                                                                                   | Iphone390, Ipad834                                                              |
| M11 | ImportPasteReview                                                       | S8, S10, S40                                                                                                                               | Iphone390, Android384, Ipad834, Ipad1194                                        |
| M12 | ImportPasteReviewHolds                                                  | S9, S15                                                                                                                                    | Iphone390, Android384, Ipad1194                                                 |
| M14 | ImportPasteSaved                                                        | S35, S41 (Private, In review and the held line)                                                                                            | Iphone390, Ipad834                                                              |
| M15 | `ImportPasteReadRefused`                                                | S47, S48, S49                                                                                                                              | Iphone390, Android384, Ipad834, Ipad1194                                        |
| M16 | `ImportPasteDuplicatePublic`                                            | S50, S51                                                                                                                                   | Iphone390, Android384, Ipad834, Ipad1194                                        |
| M17 | `ImportPasteReviewPhoto`                                                | The P5 source-photo preview                                                                                                                | Iphone390, Android384, Ipad834, Ipad1194                                        |
| M18 | `recipeDetailMobile` `RecipePrivateImportPhoto{Saved,Loading,LinkOnly}` | Photo states (1), (2) and (4), §6.8                                                                                                        | Iphone390, Android384, Ipad820                                                  |
| M19 | `ImportLinkPasteInstead`                                                | A link we may not fetch: paste the page instead                                                                                            | Iphone390, Android384, Ipad834, Ipad1194                                        |

### 12.3 Redrawn this round (D13)

At their existing sizes: web 1280 and 390, mobile Iphone390 and Android384. The Ipad820 boards are redrawn at Ipad834,
except ImportWizardStep and ImportStatements, which are redrawn in place at Ipad820 as U2 allows.

| Board                 | Change                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ImportLinkProgress    | Drop "Opened the page", which is a fetch. A paste never fetches. If the link import keeps this board, its steps name only what that route does.                                                           |
| ImportReviewDraft     | Drop "We checked its terms: you can share it" and the Public option for a web page. Private only, with the S10 line. The servings hold sits in "Needed before saving" at the top, and Save stays enabled. |
| ImportLinkPrivateOnly | Same: no Public row and no `aria-disabled` radio. One line says why it is private, with the slot count.                                                                                                   |
| ImportAlreadyImported | Drop "Another cook brought it in". Another cook's copy is invisible. Redraw as S30 with Duplicate, Replace and Cancel.                                                                                    |
| ImportPasteText       | Drop the source choice on the paste screen and "Make a draft". It becomes P2 (S1) with "Import recipe". The source moves to review.                                                                       |
| ImportWizardStep      | Drop the Public option for a web page and Private "needs Pro". Private only, as ADR-0089 §5 says.                                                                                                         |
| ImportStatements      | Drop "needs Pro". The web-page rows are private only.                                                                                                                                                     |

The rights line has two forms. With the page's photo shown: "Saved from {site}. The words and photo belong to their author. Private to you." (`editor.source.rightsLabelWithPhoto`). Without one: "Saved from {site}. The words belong to their author. Private to you." (`editor.source.rightsLabel`). Both need a check before ship. Every `recipeImportingWeb` board and every `recipeImportingMobile` board that shows the line carries it. The author line (`editor.source.authorLabel`) is drawn on the boards that show the read-only statement (S33, S44,
S46). The other web boards that show the attribution line, ImportPasteReview (W10) among them, add it at their next
redraw.

**Boards removed (D32).** `ImportWizardLeave` (`ImportWizardLeaveWeb1280`, `ImportWizardLeaveWeb390`, `ImportWizardLeaveIphone390`, `ImportWizardLeaveAndroid384`, `ImportWizardLeaveIpad820`) is deleted from both canvases. Leaving has no confirm. The wizard's leave snackbar is S39.

**Further drift, flagged and not in this round's count.** All five `ImportWizardStates` boards and all five
`ImportStatements` boards (Web1280, Web390, Iphone390, Android384, Ipad820) keep an `aria-disabled` Public radio on the
book-sourced row, the pattern the ImportLinkPrivateOnly row above removes. They are bulk boards and go to the bulk round (§15,
U3).

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

- **Web, from PR C:** the "Paste a recipe" item is live, with the page-only hint (`chooser.pasteHintPageOnly`), P2's
  page-only hint (`paste.hintPageOnly`) and the page-only S21 (`paste.refused.noRecipePageOnly`). A whole page is
  imported. A plain text paste gets S22, which says plain text comes later and offers "Write it yourself".
- **Mobile, until the spec 004 AI fallback:** no menu. "New recipe" opens the editor directly, as today. A one-item
  menu is not drawn or built (`ImportAddRecipeBeforeAiIphone390` draws this state).
- **Why:** a phone cannot practically copy a page's source, so a phone paste is plain text. Nothing reads plain text
  before the spec 004 AI fallback, so a mobile row would refuse every paste. A desktop cook can copy a whole page, so web gets real value
  now.
- **Ends when:** the spec 004 AI fallback ships. Then both platforms open P1 with both items, with the hint
  "Text, or a whole web page". S22 and the three page-only keys are removed, and P2 and S21 use `paste.hint` and
  `paste.refused.noRecipe`.
- **Scope:** this feature only. It sets no precedent for other features.

---

## 15. Open questions

### For the owner

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

- **A8. Was a copy ever published?** Resolved (architect ruling, 2026-11-17). Each copy in the list carries
  `everPublished: boolean`. S42's "Draft" row and the choice of S45 over S31 read it, never the copy's current status.
  Every imported copy has `everPublished` true, because an import saves a published private recipe. Only a
  page-linked recipe made in the editor and never published has it false, so the "Draft" row and S45 appear only for
  such editor drafts, never for an earlier import.
- **A9. More than 20 copies.** Resolved (architect ruling, 2026-11-17). The list answer carries a top-level `total`. Over
  20, the body is `duplicate.bodyAtLimit` (S42), and `duplicate.mostRecent` is dropped. `everPublished` (A8) and
  `total` are a pending contract change, owned by the 003B lead.
- **A10. Holds on a Replace.** Resolved (architect ruling, 2026-11-17). A Replace save checks cuisine, servings and times
  like a new copy, with no statement, no visibility choice and no slot hold.

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
- **U3.** The further drift in §12.3: the `aria-disabled` Public radio on the book-sourced row of the five `ImportWizardStates` and the five `ImportStatements` boards.

### UI Designer rulings on this section (2026-11-15)

These are decided. They change the open items above as follows.

- **D20, on A2. Superseded by the owner, 2026-11-15: web first.** The web row is live with PR C, with a page-only hint,
  and mobile has no chooser ("New recipe" opens the editor) until the spec 004 AI fallback. The owner's exception and its reason are recorded in §14. S22 tells a web
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
- **On the chooser.** Superseded by D30 (2026-11-17).
