# Public version on recipe detail: SPECIFY (web and mobile)

**What this is.** The build spec for how recipe detail shows a public version and the private copy of an import (spec
003B). It covers the credit (C1), the hidden views (C2), the later route "Share a public version" (C3) and "Report a
problem" (C4). It retires the facts card and linked card boards. `fe-1` builds from it, and a drawing pass makes the boards in §9. It is
a design document, not production code. No file it names exists until the build makes it, unless it says so.

**Inputs.** `docs/design/publicVersion/spec.md` (§0, §0.2 X4, §3.5, §6.9, §12). Copy v3 (the design session's final
copy, held outside the repository). Owner rulings: `docs/design/uiRefreshWorkshop5/ownerFeedback.md` (R6, R11, R12,
P5, N8), the modal rule (a non-modal surface first, a centred dialog only to block everything), even type sizes and a
28 pt maximum. ADR-0093: no facts cards and no linked cards. Specs 003B FR-034a and FR-063, 020 FR-082, 016 US2.

**Standing.** Written by `staff-ux-engineer`, SPECIFY mode. Every judgement about what a cook prefers is heuristic
judgement, untested.

---

## 0. Decisions this spec makes

| #   | Decision                                                                                                                                                            | Why                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The credit is a block of plain lines under the badge row, before the hero photo's rating row. It is not a card.                                                     | R6: the recipe's own facts sit by its name. A card reads as a facts card, which ADR-0093 retires.                                                   |
| D2  | The owner never sees "Report a problem" on their own public version. They can edit it or make it private.                                                           | Same rule as R7 (an owner cannot rate their own recipe). This differs from the drawn B9 and M9 boards (§10).                                        |
| D3  | "Report a problem" opens the existing report page of spec 016 (`RightsReport*` boards), with this recipe as the target. There is no second report form.             | One report form in the product. A second form with other reasons drifts from the notice route that 016 owns.                                        |
| D4  | The reader menu on a public version labels its report item `publicPage.report` too. Both entry points open the same page.                                           | One action, one name. "Report this recipe" stays on every other recipe.                                                                             |
| D5  | While hidden, the owner's visibility badge reads "Hidden" (`publicPage.hiddenBadge`, new) in place of "Public".                                                     | "Public" is false while no reader can see the page.                                                                                                 |
| D6  | A hidden page shows a reader only `publicPage.hiddenReader` and the app's own navigation. No title, photo, cook, credit or action. It never says a report happened. | FR-082 hides the version from every public surface. A title or cook name on the hidden page leaks it.                                               |
| D7  | "Share a public version" replaces "Make public" in the owner menu of a private import. The server's offer decides what pressing it does (spec.md V1).               | A private import can never itself go public (ADR-0093, its Amends line on ADR-0073, and §1). The menu keeps one visibility item in one place (R12). |
| D8  | When the later route cannot write now, the menu surface swaps its items for the offer's one line and "Done". It never opens a centred dialog.                       | Copy such as `budget.line` and `privateOnly.noSteps` promises "share it later from the recipe", so the item must answer.                            |

---

## 1. C1 Credit and licence

### 1.1 Public version (owner and reader)

Under the badge row, in this order. Body small (14), `inkMuted`, line height 20, 4 between lines, 16 above and 24 below
the block.

1. `credit.written`: "Steps written by Commise with AI, checked by {cook}." `{cook}` is the cook's display name, plain
   text (the cook row above it already links the profile).
2. `credit.basedOn`, free site only: "Based on a recipe at {site}. Not affiliated." `{site}` is a link to the source
   page. Web: a new tab, `rel="noopener noreferrer"`, with "opens in a new tab" in its accessible name. Mobile: the
   in-app browser. A paid site shows no line 2 (spec.md V7).
3. `review.licence`: "Shared under {licenceName}. Credit: Commise and contributors. Your edits are shared the same way."
   `{licenceName}` links to the licence terms page (003B FR-062).
4. Owner, Both path: `done.linkPrivate` "See my copy", a text link. It pushes the private copy.
5. Reader, signed in or out: `publicPage.report` "Report a problem", a text link with the `flag` glyph (16) before it
   (§4).

⛔ `editor.source.rightsLabel` and `editor.source.authorLabel` never appear on a public version. The `Checking` badge
(ADR-0074) sits in the badge row as spec.md §6.9 draws it.

### 1.2 Private copy (owner only)

Under the badge row, same type:

1. `editor.source.rightsLabel`. Its copy is owned by `docs/design/pasteImport/spec.md` §7.4.
2. `editor.source.authorLabel`, only when the page names an author. Copy as in the paste spec §7.4.
3. `done.linkPublic` "See the public version", only when this copy has a public version (Both path, or the later route
   once published). It pushes the public version.

### 1.3 Longest strings (+35%)

| String                                 | Rule                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `credit.written` with a 40-char name   | Wraps, no limit. The name never truncates.                                                        |
| `credit.basedOn` with a 60-char domain | `overflow-wrap: anywhere` on the link only.                                                       |
| `review.licence` (about 100 chars)     | Wraps. At 320 it takes 4 lines, at +35% 6 lines. Acceptable: it is below the fold-critical facts. |

---

## 2. C2 Hidden views

| View                  | Who    | What shows                                                                                                                                                                                                                                             |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hidden after a report | Owner  | The whole recipe, as before. Badge `publicPage.hiddenBadge` "Hidden". Under the title, a `StaticNotice` (glyph `eyeOff`, §2.1) with `publicPage.hiddenOwner` (copy v3). The credit block follows unchanged. Edit, the menu and cooking work as before. |
| Hidden                | Reader | The `RecipeNotFound*` layout: the app's navigation and back control, then `publicPage.hiddenReader` as the page's H1: "This recipe isn’t available right now." Nothing else. The page is `noindex` and its document title is the app name only.        |

The reader view drops the second line of the not-found board, because that line names the wrong cause. It also drops "Back to My recipes", because a signed-out reader has none. The way out
is the shell's back control (N8) and navigation, which exist for every role.

A reader who sent the report and comes back sees this same view (§4.3).

### 2.1 Design-system additions

The hidden notice is static information above content the owner can still use. No house notice fits: `StateNotice`
replaces the content, takes no glyph and is `role="alert"`; `LoadingNotice`, `RefreshNotice`, `SyncNotice` and
`OfflineReadSlot` are all `role="status"` live regions.

- **`StaticNotice`** (new, `packages/apps/commise/ui/src/staticNotice/`, web and native): a `Surface` (tone `muted`,
  radius 12, padding 12 by 16) holding a decorative `Icon` (20, `inkMuted`) and one line of body small (14) `ink` text.
  Props: `glyph: IconName`, `children: string`. No role, no live region, never takes focus.
- **Glyphs** added to `ICON_NAMES` (`icon/props.ts`): `eyeOff` (the hidden notice and badge) and `flag` (the report
  link, §1.1). Neither mirrors in RTL.

---

## 3. C3 "Share a public version" (`later.action`)

**Where.** The owner's more menu on a private import (`RecipeDetailMenu*`), in the slot "Make public" holds on other
recipes: after Version history, before Clear checks. The `globe` glyph (20). It shows when all three hold: the viewer
is the owner, the recipe is private, and the recipe read's owner-only `hasSourceRecord` flag is true. An editor recipe,
or a paste with no detected address, never shows it. Inside that set it always shows, so no board draws a hidden item.

**What pressing it does.** The press fetches the server's `offer` for this copy. The client renders it and never
derives it. While the fetch runs, the item shows a spinner in place of its glyph, its label stays, and the menu stays
open. A failed fetch swaps the surface for `later.failed` (new, §6) and "Done" (`failed.done`), as for a `privateOnly` line. A `deadEnd` offer
opens spec.md P9 (B5).

| `offer`                                | Result                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `choice` or `publicOnly`               | The menu closes and P7 Writing is pushed (spec.md §3.2), as on the Both path: the copy is already saved, so `writing.bothSaved` shows. Then P8 Review, Publish, the age question at a first publish (P10), and success. |
| `privateOnly` (any reason)             | The menu surface swaps its items for the reason's line (copy v3 `privateOnly.*`, or `budget.line`) and one "Done" (`failed.done`, spec.md §7.2). Done closes it. Nothing is sent.                                       |
| `publicExists` `published`             | The surface shows `publicExists.published` and the link `publicExists.link` "See the public version", which pushes it, then "Done".                                                                                     |
| `publicExists` `writing` or `inReview` | The surface shows `publicExists.writing` or `publicExists.inReview`, then "Done".                                                                                                                                       |

**Success.** P8 is replaced by this private copy (Back never lands in the finished flow, spec.md S7). The credit block
gains `done.linkPublic`, and one polite announcement reads `done.public`.

**Failure on the way.** `409 offerChanged` and `409 publicExists` at the start show spec.md B8's `offerChanged.line`
or the `publicExists.published` line on P7, as on import. Offline at press: P7 shows `writing.offline` with "Try again"
(spec.md §6.6).

---

## 4. C4 "Report a problem" (`publicPage.report`)

### 4.1 Where

- In the credit block, last line, for every reader (§1.1). It is where a reader looks when the steps or the source seem
  wrong.
- In the reader more menu, in place of "Report this recipe", labelled `publicPage.report` (D4). Last item, set apart
  like Delete recipe in the owner menu.

### 4.2 What it opens

The existing 016 report page (`RightsReport*`), pushed, with the target set to this public version. It keeps its own
title, reasons, details field, email field and "Send report". It is a page, not a sheet or panel, on every size: it
holds a radio group of reasons and two text fields, so on a phone the keyboard covers most of a bottom sheet,
and a page gives the fields room and native back. A side panel on wide web was dropped: it is a
second presentation of the same form. Back returns to the recipe with nothing sent.

### 4.3 States

| State      | What shows                                                                                                                                                                                                                                                   | Copy and key                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Signed in  | Email filled from the account, editable.                                                                                                                                                                                                                     | 016's own strings                                                                   |
| Signed out | The same page. Email empty and required. No sign-in step, because 016 US2 lets anyone report without an account.                                                                                                                                             | 016's own strings                                                                   |
| Sending    | "Send report" shows the house busy state (`pendingBar` in the button, label kept, `aria-busy`). Fields are read-only. A second press does nothing.                                                                                                           | label kept                                                                          |
| Sent       | The 016 "Report received" page replaces the form. Its Done returns to the recipe, which now shows the hidden reader view (§2), because FR-082 hides it at once. One polite announcement: the received page's H1.                                             | 016's own strings                                                                   |
| Error      | An alert above "Send report". Every field keeps its input. "Send report" retries.                                                                                                                                                                            | `publicPage.reportFailed` (new): "We couldn’t send your report. Try again."         |
| Offline    | No connectivity banner on this page: the house notices promise that changes sync later, and a report is never queued. Send stays enabled. Pressing it shows `publicPage.reportOffline` as an alert directly above Send, sends nothing and keeps every input. | `publicPage.reportOffline` (new): "You’re offline. Connect, then send your report." |
| Owner      | Not reachable (D2).                                                                                                                                                                                                                                          | none                                                                                |

---

## 5. Recipe detail states with a public version

| State               | Owner                                                                                                                       | Reader                                                                                                                            | Copy and key                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Loading             | Existing skeleton. The credit block reserves 3 lines.                                                                       | Same                                                                                                                              | `recipeLoadMessages.loadingLabel` (reuse)                           |
| Error               | Existing `RecipeLoadError*` layout                                                                                          | Same                                                                                                                              | `recipeLoadMessages.errorTitle`, `recipeLoadMessages.retry` (reuse) |
| Offline, cached     | The recipe from cache with `OfflineNotice`. The credit shows. Links that need the network open and fail in their own place. | Same                                                                                                                              | core offline messages (`offlineTitle`, reuse)                       |
| Not found           | `RecipeNotFound*`                                                                                                           | Same                                                                                                                              | `recipeLoadMessages.notFoundTitle` (reuse)                          |
| Signed out          | n/a                                                                                                                         | The public version with the credit and "Report a problem". No rating, no Save a copy (they need an account, as on other recipes). | as §1.1                                                             |
| Checking (ADR-0074) | Badge `Checking`                                                                                                            | Not visible to readers until cleared                                                                                              | `checkingBadge` (reuse, paste spec)                                 |
| Hidden              | §2                                                                                                                          | §2                                                                                                                                | §2                                                                  |

The layout reserves the credit block's height on load, so nothing shifts when it arrives.

---

## 6. New strings

Keys are under `importMessages.choice.*`, as copy v3's `publicPage.*` keys are.

| Key                        | Copy                                                              | Where  |
| -------------------------- | ----------------------------------------------------------------- | ------ |
| `publicPage.hiddenBadge`   | "Hidden"                                                          | §2, D5 |
| `publicPage.reportFailed`  | "We couldn’t send your report. Try again."                        | §4.3   |
| `publicPage.reportOffline` | "You’re offline. Connect, then send your report."                 | §4.3   |
| `later.failed`             | "We couldn’t check this recipe right now. Try again in a moment." | §3     |

Every other string is copy v3, spec.md §7.2, the paste spec, or `recipeLoadMessages`, as cited.

---

## 7. Platform translation (staff-ux §3.6)

| Element               | Web 1280                                | Web 390                         | iPhone 390 and Android 384                       | iPad 820                  | Disposition | Why                                      |
| --------------------- | --------------------------------------- | ------------------------------- | ------------------------------------------------ | ------------------------- | ----------- | ---------------------------------------- |
| Credit block          | Under the badge row, left column        | Under the badge row, one column | Same as web 390                                  | Same as web 1280          | kept        | Part of the recipe's identity (R6)       |
| `credit.basedOn` link | New tab                                 | New tab                         | In-app browser                                   | In-app browser            | translated  | Keeps the recipe in the stack            |
| Owner menu            | Anchored popover from the more button   | Bottom sheet                    | Bottom sheet (existing `sheetMenu`)              | Anchored popover          | kept        | Existing menu surfaces                   |
| Later-route line      | In the same popover, in place of items  | In the same sheet               | In the same sheet. Done full width at the bottom | In the same popover       | kept        | No new surface, no centred dialog (D8)   |
| Report link           | In the credit block and the reader menu | Same                            | Same                                             | Same                      | kept        |                                          |
| Report page           | Pushed page, Send in flow               | Pushed page, Send pinned        | Pushed page, Send pinned, full width             | Pushed page, Send in flow | moved       | Reach. The keyboard is open while typing |
| Hidden notice         | Under the title                         | Same                            | Same                                             | Same                      | kept        |                                          |

**Primary action by reach.** The page's primary actions do not change (Start cooking, Edit recipe or Save a copy, R4).
Report is never a primary. On phones and web below 840, Done in the later-route sheet and Send on the report page sit at
the bottom, full width. From 840 on web and on iPad they sit in flow.

**Touch equivalents.** Nothing depends on hover, right-click or drag. The links act on tap, Enter and Space where they
are buttons. The credit links are in-text links with 24 px of line height.

**320 CSS px.** The credit block wraps, the domain breaks anywhere, and the hidden notice wraps. No element passes the
right edge. The drawing pass renders each 390 board at 320 to confirm.

**Scroll budget.** At 390 by 844, the credit block adds about 120 px below the badge row on a free-site version. The
ingredients card still starts on the first screen at 390. At 320 it starts after one short scroll, which is accepted:
R1's pinned bar keeps the ingredients in reach.

**Keyboard open.** Only the report page has inputs. The focused field scrolls above the pinned Send (WCAG 2.4.11, the
`fieldReveal` hooks on native, `scroll-padding-bottom` on web).

---

## 8. Accessibility contract (WCAG 2.2 AA)

- **Structure.** The credit block is a `<p>` group under the title, with no heading of its own. The hidden reader view
  has one H1, the line itself.
- **Links (2.4.4).** "Report a problem", "See my copy" and "See the public version" are links with their visible text as
  the accessible name (2.5.3). The domain link adds "opens in a new tab" on web.
- **Status (4.1.3).** The hidden notice is static text, not live. `done.public` and the received page's H1 go through
  the polite `LiveRegion`. The report error and offline alerts are `role="alert"`, and focus moves to them.
- **Busy (4.1.2).** Send has `aria-busy="true"` while sending, and its label never changes.
- **Menu.** The later-route line replaces the menu items in the same surface, and focus moves to the line. Done returns
  focus to the more button.
- **Not by colour (1.4.1).** The hidden badge and notice carry the `eyeOff` glyph and text.
- **Targets (2.5.8).** Menu rows 44 tall on web and iOS, 48 dp on Android. Done and Send 44 pt or 48 dp.
- **Contrast (1.4.3).** `inkMuted` body small on `paper` and on `paperRaised`, light and dark: the drawing pass computes
  each pair on the boards and records the ratio.
- **Reduced motion.** No motion of our own.

---

## 9. Boards

### 9.1 Retired (ADR-0093)

A board is "replaced" only when a new board shows the same role in the same situation. Otherwise it is deleted.

| Canvas             | Board                         | Fate                                                                                 |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
| recipeDetailWeb    | RecipeFactsWeb1280            | Replaced by RecipePublicVersionWeb1280 (a reader views the public form of an import) |
| recipeDetailWeb    | RecipeFactsWeb390             | Replaced by RecipePublicVersionWeb390                                                |
| recipeDetailWeb    | RecipeFactsBookWeb1280        | Deleted (003B writes no public version of a book)                                    |
| recipeDetailWeb    | RecipeFactsBookWeb390         | Deleted                                                                              |
| recipeDetailWeb    | RecipeFactsSaveCopyWeb1280    | Deleted (Save a copy is RecipeSaveCopyWeb1280)                                       |
| recipeDetailWeb    | RecipeFactsSaveCopyWeb390     | Deleted (RecipeSaveCopyWeb390)                                                       |
| recipeDetailMobile | RecipeFactsIphone390          | Replaced by RecipePublicVersionIphone390                                             |
| recipeDetailMobile | RecipeFactsAndroid384         | Replaced by RecipePublicVersionAndroid384                                            |
| recipeDetailMobile | RecipeFactsIpad820            | Replaced by RecipePublicVersionIpad820                                               |
| recipeDetailMobile | RecipeFactsBookIphone390      | Deleted                                                                              |
| recipeDetailMobile | RecipeFactsBookAndroid384     | Deleted                                                                              |
| recipeDetailMobile | RecipeFactsBookIpad820        | Deleted                                                                              |
| recipeDetailMobile | RecipeFactsSaveCopyIphone390  | Deleted (RecipeSaveCopyIphone390)                                                    |
| recipeDetailMobile | RecipeFactsSaveCopyAndroid384 | Deleted (RecipeSaveCopyAndroid384)                                                   |
| recipeDetailMobile | RecipeFactsSaveCopyIpad820    | Deleted (RecipeSaveCopyIpad820)                                                      |
| recipeDetailWeb    | RecipeSourceCardWeb1280       | Replaced by RecipePublicVersionWeb1280 (a reader views a recipe from a site)         |
| recipeDetailWeb    | RecipeSourceCardWeb390        | Replaced by RecipePublicVersionWeb390                                                |
| recipeDetailMobile | RecipeSourceCardIphone390     | Replaced by RecipePublicVersionIphone390                                             |
| recipeDetailMobile | RecipeSourceCardAndroid384    | Replaced by RecipePublicVersionAndroid384                                            |
| recipeDetailMobile | RecipeSourceCardIpad820       | Replaced by RecipePublicVersionIpad820                                               |

Each retired board also leaves `canvas.json`. ⛔ No new board shows a facts card, a linked card, a method link-out or "The method stays
with its author".

### 9.2 New

Sample values: spec.md S14 (public title "Baked chicken and vegetable pie", cook "Eliza Ramirez", source
`allrecipes.com`, "CC BY-SA 4.0", paid example `pantrypress.example`). Reader "Ana Lima".

| Board id (size suffix added per row) | States shown                                                                                 | recipeDetailWeb | recipeDetailMobile             |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | --------------- | ------------------------------ |
| RecipePublicVersion                  | Reader, signed in, free-site credit, "Report a problem"                                      | Web1280, Web390 | Iphone390, Android384, Ipad820 |
| RecipePublicVersionStates            | Stacked: signed out, paid-site credit (no line 2), loading, offline cached, +35% credit      | Web1280, Web390 | Iphone390                      |
| RecipePublicVersionOwner             | Owner, Both path, Checking badge, "See my copy", no Report                                   | Web1280, Web390 | Iphone390, Android384, Ipad820 |
| RecipePublicVersionHidden            | Owner: hidden after a report                                                                 | Web1280, Web390 | Iphone390, Ipad820             |
| RecipePublicVersionHiddenReader      | Reader view of a hidden version                                                              | Web1280, Web390 | Iphone390                      |
| RecipePrivateImportMenu              | Private copy with rightsLabel and authorLabel, owner menu open with "Share a public version" | Web1280, Web390 | Iphone390, Android384, Ipad820 |
| RecipePrivateImportShareLine         | Stacked: loading, privateOnly paidRecent, budget, publicExists published, writing            | Web1280, Web390 | Iphone390, Ipad820             |
| RecipePublicVersionReaderMenu        | Reader menu open on a public version, item "Report a problem"                                | Web1280, Web390 | Iphone390                      |

On `reportsRulesAndYourRightsWeb` and `reportsRulesAndYourRightsMobile`, one board each:

| Board id           | States shown                                                                         | Sizes                                              |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| RightsReportStates | Stacked: signed out (email empty), sending, error, offline. Target: a public version | Web1280, Web390 (web). Iphone390, Ipad820 (mobile) |

Sizes left off a board show the same layout as a drawn size (P5): Android
384 matches iPhone 390 except the menu sheet, which is drawn at both on the boards where it appears.

---

## 10. Open items and conflicts

1. **Contract owed (003B lead).** Ruled by the 003B lead 2026-11-17: show the item when owner + private +
   `hasSourceRecord`, and fetch the offer on press (§3). The contract
   (`specs/003B-public-rewrite/contracts/publicVersion.api.md`) owes two things: the `hasSourceRecord` field on the
   recipe read, and an offer read for a private copy. This spec does not specify their wire shape.
2. **003B lead, key names.** `privateCopy.author` in copy v3 is replaced by `editor.source.authorLabel`. The site placeholder is `{site}`
   everywhere (003B renames `{domain}`).
3. **Drawn boards differ (D2).** B9 and M9 on `recipeImporting*` show "Report a problem" on the owner's public version.
   This spec removes it for the owner. Those boards are to drop the line.
4. **016 owner.** The reader menu item "Report this recipe" becomes "Report a problem" on a public version (D4).
5. **New strings** (§6), for the lead.
6. **Owner question, FR-082.** One report, from any reader, signed out included, hides a public version at once until
   staff decide. Is that the intended behaviour for a signed-out report?
7. **003B lead, leaf keys that clash with groups.** In the message files the leaf `credit` clashes with the group
   `credit.*` (`credit.written`, `credit.basedOn`), and the leaf `notNow` with `notNow.note`. The 003B lead is renaming
   the leaves; the names follow from the 003B lead. Bare uses as leaf keys: `spec.md` §3.1 (`credit` before
   `creditLink`), §6.1 "Nothing chosen (Free)" row (`credit`) and §6.5 "Switch on, upsell, trial eligible" row (`notNow`).
   None in this spec. The `credit` and `notNow` props of `ImportChoiceGroup` and `PublicVersionReview` (spec.md §8.2)
   are props, not keys.
