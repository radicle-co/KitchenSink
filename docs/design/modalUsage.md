# Modals and other surfaces

Status: ruling recorded 2026-11-17. This file holds the research notes, the decision table, the surface list and the
audit of the current boards. The short form is in the design system's README, section "Modals and other surfaces"
(`packages/tools/designArtifact/content/designSystem/README.md`). This is a design document, not production code.

## 1. The ruling

The owner, 2026-11-17, on a canvas comment:

> "In general we want to avoid central modals unless we want to actively block all interaction and context (which
> there is a need for it, but not in this case). Review the modern design philosophies around central modals and
> modals in general and record the ruling around their usage in our design system"

The owner, 2026-11-17, on confirmations: "For confirmations, modals are appropriate."

As product behaviour:

1. **A centred modal blocks everything.** Use one only when the cook must stop and answer before anything else can
   happen. Nothing else on the screen can be used, and the cook cannot see past it.
2. **Everything else uses a lighter surface.** The cook keeps the screen they were on in view, and can still use it
   where the surface allows.
3. **Modals in general are the exception.** A bottom sheet, a side sheet or a full-screen sheet that blocks the page
   is still a modal. Use one only when the task needs the cook's full attention, it is short, and it ends in a clear
   result. A non-modal surface is the default.

The ruling narrows, and does not replace, the owner ruling of 2026-10-26 on dialog width ("448 on a tablet, 834 and
1194 alike", `packages/apps/commise/ui/src/sheet/sheetPresentation.ts:25`). That ruling still sets the width of the
centred dialogs that remain.

## 2. Decision table: when a centred modal is allowed

Ask the questions in order. The first "yes" decides.

| #   | Question                                                                                                                                                                 | If yes                                                                                                                                                                                  | Component                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Does the action destroy something that **cannot be undone**? (delete a recipe, erase an account, overwrite a draft with no version kept, sign out with unsynced changes) | **Centred modal.** Confirm with two verb buttons. Focus opens on the safe one.                                                                                                          | `ConfirmDialog`                                                                                         |
| 2   | Is it destructive but **undoable**? (remove a recipe from a collection, make a collection private)                                                                       | **No modal.** Do it at once and show an undo snackbar.                                                                                                                                  | `useSnackbar().show` with Undo                                                                          |
| 3   | Is it a **confirmation** before a commit that other people will see at once, or that spends or stops money? (publish, make public, buy, tip, cancel Pro, replace a copy) | **Centred modal** (owner: "For confirmations, modals are appropriate"). Short: the consequence in one or two sentences and two equal choices. Make public, Publish and Replace keep it. | `ConfirmDialog` when destructive. Otherwise `Sheet presentation="dialog"`                               |
| 4   | Is it an **interruption the cook must answer now**, raised by the app and not by the cook? (a timer alarm while cooking, a session that ends)                            | **Modal.** Full screen when it is the only thing that matters (the timer alarm). Centred otherwise.                                                                                     | `FullScreenSheet` (native) / `Sheet size="full"`. `DialogFrame role="alert"` for a centred interruption |
| 5   | Is it only **information**, an outcome, a limit or a refusal?                                                                                                            | **No modal.** Say it where it applies: inline notice beside the control, or a snackbar for an outcome.                                                                                  | `StateNotice`, `OfflineReadSlot`, `useSnackbar`                                                         |
| 6   | Is it an **upsell, a Pro gate or a nudge**?                                                                                                                              | **No modal.** An inline card in place of the locked feature. A full plan comparison is a page.                                                                                          | Inline card. `PushedPageFrame` or a route                                                               |
| 7   | Anything else: a form, a picker, a list, a detail, a set of actions                                                                                                      | **Non-modal surface** from the list in section 3.                                                                                                                                       | See section 3                                                                                           |

Three rules apply to every centred modal that remains:

- **One at a time.** Never open a modal from a modal. Apple HIG and Atlassian both say this (section 5).
- **Short.** A title, at most two sentences, and the actions. No scrolling form, no list to read, no table.
- **Equal choices.** The way out is as easy to see and press as the way in. The safe button is never smaller,
  fainter or hidden.

## 3. The surfaces to use instead, in order of preference

Take the first one that fits the task. "Web" means `@commise/ui` web leaf (`<Name>.tsx`), and "native" means
`<Name>.native.tsx`.

| Order | Surface                                         | Use it when                                                                                                                                                    | Web                                                                                                                                       | Native                                                                                                                                               | Focus and dismiss                                                                                                                                                                                                                              | Accessibility contract                                                                                                            |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Inline expansion**                            | The content belongs to one row or field: rename, a note, a short explanation, a limit, a refusal, a Pro gate.                                                  | `StateNotice`, or the row's own expanded state                                                                                            | `StateNotice`, or the row's own expanded state. `useFieldRevealHost` and `RevealSpacer` (native only, no web leaf) scroll a revealed field into view | Focus stays where it was, or moves to the first new field when the cook asked for it. Collapses on its own control. Nothing to dismiss.                                                                                                        | Disclosure pattern: a button with `aria-expanded`. The revealed content follows it in reading order.                              |
| 2     | **Anchored popover or menu**                    | A few related actions or a short choice, tied to one trigger: a row's actions, add to plan, save a copy.                                                       | `Popover` (non-modal dialog) or `ActionMenu` (Radix menu)                                                                                 | `Popover` and `ActionMenu` become a bottom sheet                                                                                                     | Opens on activation only, never on hover. Focus moves in. Escape, Close, an outside press or picking an item closes it, and focus returns to the trigger. Work is never lost on an outside press.                                              | Popover: `role="dialog"` without `aria-modal`, named by its trigger. Menu: menu-button pattern, `aria-haspopup`, `aria-expanded`. |
| 3     | **Create chooser** (pasteImport spec P1)        | The page's one create action has two to six kinds: new recipe, paste, import.                                                                                  | Surface by width: pasteImport spec P1 §3.1                                                                                                | Surface by width: pasteImport spec P1 §3.1                                                                                                           | The FAB turns into the close control. Items open above it, in the same place. Back, Close or an outside tap closes it and returns focus to the FAB.                                                                                            | The FAB is a button with `aria-expanded`. Items are buttons with their own names, in reading order after it.                      |
| 4     | **Side sheet** (wide web, iPad landscape)       | A task or detail that the cook does next to the page: comments, a picker over a long list, create a food while the ingredient line stays in view, meal detail. | Today's web `Sheet` centres from `sm`. Side panels drawn: Discover's filter panel, and `MealPlanAddMeal` and `MealPlanMealDetail` at 1280 | The native `Sheet` is bottom-anchored                                                                                                                | Non-modal by default: the page stays usable, focus moves to the sheet's title, Close and Escape return it to the opener. A modal side sheet only under rule 3 or 4.                                                                            | Non-modal: a labelled region or `role="dialog"` without `aria-modal`. Modal: the full dialog pattern below.                       |
| 5     | **Bottom sheet** (phones, and web below 640 px) | The phone form of rows 2 to 4: a menu, a picker, a short form, a detail.                                                                                       | `Sheet` below `sm`                                                                                                                        | `Sheet` (`BottomSheetPanel`). `size="full"` for a long one                                                                                           | Close control in the title row, Android Back, a swipe down on the title row, and the scrim each call `onOpenChange(false)`. Focus moves to the title. It returns to the opener. A sheet with unsaved input asks before a swipe throws it away. | Modal dialog pattern while it covers the page. Never stack a sheet on a sheet.                                                    |
| 6     | **Full page or route**                          | Long or many-step tasks, a checkout that asks for payment details, plan comparison, settings, anything a cook may leave and come back to.                      | `PushedPageFrame` or a route                                                                                                              | A stack screen (`PushedPageFrame`). `FullScreenSheet` for a modal one                                                                                | Back returns to where the cook was. Nothing to trap.                                                                                                                                                                                           | A page with its own `h1`. The route is linkable.                                                                                  |
| 7     | **Snackbar**                                    | The outcome of an action, with at most one follow-up such as Undo or Open.                                                                                     | `SnackbarHost` + `useSnackbar`                                                                                                            | Same                                                                                                                                                 | Never takes focus. The timer pauses on pointer or focus. With a screen reader on native it does not time out.                                                                                                                                  | Polite live region, always mounted.                                                                                               |

When a centred modal is right (section 2), it follows the W3C APG dialog pattern: focus moves into the dialog on
open, Tab and Shift+Tab stay inside it, Escape closes it unless the decision is required, focus returns to the
opener on close, the page behind is inert, and the dialog is named by its visible title. `ConfirmDialog` (web: Radix
`AlertDialog`. Native: `DialogFrame`) already does this.

## 4. Web to mobile

Translate the job, not the layout. The same task gets the surface each device is built for.

| Web, 840 px and wider                                           | Web below 640 px                                      | Phone (native)                             | Tablet (native)                                   | Why                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Anchored `Popover`                                              | Bottom sheet                                          | Bottom sheet (`Popover` native)            | Bottom sheet                                      | Apple HIG: reserve popovers for wide views, use a sheet in compact views.          |
| `ActionMenu` dropdown                                           | Bottom sheet of rows                                  | Bottom sheet of `menuitem` rows            | Same as phone                                     | A dropdown under a thumb hides the row it acts on.                                 |
| Anchored menu from 600 px, FAB menu below (pasteImport spec P1) | As left                                               | As left                                    | As left                                           | The create action sits where the thumb is (N1 keeps it out of the nav bar).        |
| Side sheet                                                      | Bottom sheet, `size="full"` when long                 | Bottom sheet, or a pushed screen when long | Side sheet in landscape. Bottom sheet in portrait | A wide screen has room for the task beside the page. A phone does not.             |
| Centred `ConfirmDialog`                                         | Centred `ConfirmDialog`, buttons stacked below 400 px | Centred `ConfirmDialog` in `DialogFrame`   | Same                                              | A blocking confirm looks the same everywhere. iOS and Android draw alerts centred. |
| Inline expansion                                                | Inline expansion                                      | Inline expansion                           | Inline expansion                                  | No translation needed.                                                             |
| Hover tooltip                                                   | Never the only route                                  | No hover: the same content on a tap        | Same                                              | Touch has no hover.                                                                |

## 5. Research notes

What each source says is quoted or closely paraphrased and marked with its source. My own reading is marked
"heuristic judgement, untested". Sources were fetched on 2026-11-17.

### Nielsen Norman Group

- **Modal and nonmodal dialogs** (Therese Fessenden, 2017-04-23).
  <https://www.nngroup.com/articles/modal-nonmodal-dialog/>
    - A modal "moves the system into a special mode requiring user interaction". Nonmodal dialogs "do not disable the
      main content".
    - Use modals "for important warnings, as a way to prevent or correct critical errors", and "to request the user to
      enter information critical to continuing the current process".
    - Do not use them "for nonessential information that is not related to the current user flow", nor "for complex
      decision making that requires additional sources of information unavailable in the modal".
    - Problems: they "require immediate attention", "interrupt the user's workflow", "cause users to forget what they
      were doing" and "block the content in the background".
- **Popups: 10 problematic trends and alternatives** (Anna Kaley, 2019-06-30).
  <https://www.nngroup.com/articles/popups/>
    - Modal overlays are for "delivering crucial information, only at appropriate times". Wait until the content "is
      contextually relevant to the user".
- **Bottom sheets: definition and UX guidelines** (Page Laubheimer, 2023-06-11).
  <https://www.nngroup.com/articles/bottom-sheet/>
    - "A modal bottom sheet blocks any interactions with the background content while it is visible". A nonmodal one
      lets the person keep using the page.
    - Support Back to dismiss. Give a clear Close button because a swipe is easy to miss. Do not stack sheets. Do not
      use sheets to replace page-to-page flows. Keep them short.

### Apple Human Interface Guidelines

- **Modality** (change log entry 2023-12-05).
  <https://developer.apple.com/design/human-interface-guidelines/modality>
    - "Present content modally only when there's a clear benefit. A modal experience takes people out of their current
      context and requires an action to dismiss."
    - "Aim to keep modal tasks simple, short, and streamlined."
    - "Consider using a full-screen modal style for in-depth content or a complex task."
    - "Let people dismiss a modal view before presenting another one."
- **Alerts.** <https://developer.apple.com/design/human-interface-guidelines/alerts>
    - "An alert gives people critical information they need right away", for example to "warn them when their action
      might destroy data" or "confirm a purchase".
    - "Use alerts sparingly." "Avoid using an alert merely to provide information."
    - "Avoid displaying alerts for common, undoable actions, even when they're destructive."
- **Popovers.** <https://developer.apple.com/design/human-interface-guidelines/popovers>
    - "Use a popover to expose a small amount of information or functionality."
    - "Avoid displaying popovers in compact views ... Reserve popovers for wide views; for compact views ... [use] a
      sheet instead."
    - "Always save work when automatically closing a nonmodal popover."
    - "Avoid using a popover to show a warning ... use an alert instead."
- **Sheets.** <https://developer.apple.com/design/human-interface-guidelines/sheets>
    - "A sheet is useful for requesting specific information from people or presenting a simple task".
    - "For complex or prolonged user flows, consider alternatives to sheets."
    - "In iOS and iPadOS, a sheet can be either modal or nonmodal." Use a nonmodal view "to present supplementary items
      that affect the main task in the parent view".
    - "Support swiping to dismiss a sheet", and confirm first if the sheet holds unsaved changes.

### Material Design 3

The m3.material.io pages render only with script and could not be read directly. These quotes are from Google's own
Material Components for Android docs, which implement M3 and link to the M3 pages.

- **Dialogs.** <https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md>
  (M3: <https://m3.material.io/components/dialogs/overview>)
    - "Dialogs are purposefully interruptive, so they should be used sparingly."
    - "Full-screen dialogs fill the entire screen, containing actions that require a series of tasks to complete."
- **Bottom sheets.** <https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md>
    - "Standard bottom sheets co-exist with the screen's main UI region", and "Modal bottom sheets present a set of choices
      while blocking interaction with the rest of the screen" and "are an alternative to inline menus and simple
      dialogs on mobile devices".
- **Side sheets.** <https://github.com/material-components/material-components-android/blob/master/docs/components/SideSheet.md>
    - "Standard side sheets co-exist with the screen's main UI region", and "Modal side sheets present the sheet while
      blocking interaction with the rest of the screen."
- **FAB menu.** <https://github.com/material-components/material-components-android/blob/master/docs/components/FloatingActionButtonMenu.md>
  (M3: <https://m3.material.io/components/fab-menu/overview>)
    - "A floating action button (FAB) menu opens from a FAB to show 2–6 related actions", and "It should replace the speed
      dial and any usage of stacked small FABs."

### W3C WAI-ARIA Authoring Practices

- **Dialog (modal) pattern.** <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
    - "Windows under a modal dialog are inert." Tab and Shift+Tab stay inside the dialog, and Escape "Closes the dialog".
    - "When a dialog opens, focus moves to an element contained in the dialog." "When a dialog closes, focus returns to
      the element that invoked the dialog".
    - The container has `aria-modal="true"` and is named by its visible title. `alertdialog` is for "dialogs that divert
      users' attention to a brief, important message".
- **Disclosure pattern.** <https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/>: a button with `aria-expanded`.
- **Menu button pattern.** <https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/>: `aria-haspopup` and
  `aria-expanded` on the button.
- **WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum).**
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>: "When a user interface component
  receives keyboard focus, the component is not entirely hidden due to author-created content." The Understanding
  document names non-modal dialogs and sticky footers as common causes. A non-modal surface therefore must not cover
  the control that has focus, or the cook must be able to close it without moving focus.

### GOV.UK Design System

GOV.UK publishes no modal component. The backlog discussion for one is closed with the status "Not published".
<https://github.com/alphagov/govuk-design-system-backlog/issues/30>

- A team member wrote in 2018: "We have updated our guidance which makes it clear to avoid modals in most cases" and
  "Timeout is one of the few cases where a modal is appropriate."
- A contributor noted in 2023 that "neither VoiceOver on iOS nor TalkBack on Android support aria-modal". That is a
  contributor's comment, not GOV.UK guidance, but it is why a native modal here must also hide the page behind it
  from the screen reader, which `Modal` and `DialogFrame` do.

### Microsoft Fluent 2

- **Dialog usage.** <https://fluent2.microsoft.design/components/web/react/core/dialog/usage>
    - "Dialogs are often interruptions, so use them for important actions." An alert dialog is only for potential loss,
      such as unsaved changes or destructive actions.
    - For context that "doesn't affect their current workflow, try a popover". For updates that need no response, use
      a toast. "Don't nest dialogs."

### Atlassian Design System

- **Modal dialog usage.** <https://atlassian.design/components/modal-dialog/usage>
    - Modals "can be invasive and should be used sparingly". "Don't use a modal dialog for complex interactions or
      large tables." "Don't use dialogs to trigger other dialogs".
    - "Use popups for smaller amounts of information along with controls." "To alert people about important
      information, or an action that's required to complete a task, use inline messages."

### What the sources agree on

Every source above treats the modal as the costly exception, for a short, critical decision. They differ on the
alternatives only in name: popover or popup, side or bottom sheet, toast or snackbar, inline message. Apple's
alert rule about undo is the sharpest test, and the house already follows it: removing a recipe from a collection
uses an undo snackbar, and deleting a collection keeps a dialog because it cannot be undone
(`docs/design/uiOverhaul/buildSpec.md:1067` and `:1070`).

Heuristic judgement, untested: in a kitchen the cook often has wet or busy hands and looks away. A centred modal
that appears while they cook hides the step they are on, which is the cost NN/g names ("cause users to forget what
they were doing"). That makes the ruling stricter here than in an office tool, except for the timer alarm, which
must interrupt.

## 6. Audit of the current boards and specs

Scope: every board of every `current` canvas in `docs/design/canvases/registry.json` on `origin/main` at `8c4bf97df`,
searched for `role="dialog"`, `role="alertdialog"`, `aria-modal`, a `dlg` class, `presentation="dialog"` and
`ConfirmDialog`, then checked by the CSS that places each one. Plus the design specs under `docs/design/` that name a
centred dialog. Nothing was redrawn. "Sizes" names where the board centres it: W = web 1280 (and 768 or 1024 where
drawn), T = native tablet (iPad 820, 834, 1194), P = phone. A board that is a bottom sheet on phones and centred on
wide screens is listed by its wide form, because that is where it breaks the ruling.

### Keep: it blocks for a stated reason

| Board or spec                                                                                                                                                                                                          | Sizes       | Why it may block                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `RecipeDeleteDialog` (recipe detail)                                                                                                                                                                                   | W T P       | Rule 1: deletes the recipe and its history. Cannot be undone.                                                        |
| `CollectionDeleteDialog`                                                                                                                                                                                               | W T P       | Rule 1: cannot be undone (`buildSpec.md:1070`).                                                                      |
| `RecipeCommentDelete`                                                                                                                                                                                                  | W           | Rule 1: "You can't undo this."                                                                                       |
| `AccountCloseDialog`, `AccountEraseDialog`, `AccountEraseDialogStates`                                                                                                                                                 | W T P       | Rule 1: the account and its data go.                                                                                 |
| `RecipeEditorDiscardChanges`, `RecipeEditorDiscardDraft`                                                                                                                                                               | W T P       | Rule 1: unsaved edits are lost.                                                                                      |
| `NewCollectionSheetErrors`, "Discard this collection?"                                                                                                                                                                 | W P         | Rule 1: the typed collection is lost.                                                                                |
| `DraftDeleteDraft`                                                                                                                                                                                                     | W T         | Rule 1: a never-published draft keeps no version (DD27).                                                             |
| `OfflineSignOut`                                                                                                                                                                                                       | W T         | Rule 1: three unsynced changes are deleted.                                                                          |
| `ImportPasteDuplicate`, `ImportPasteReplaceDraft` (spec S31, S45)                                                                                                                                                      | W T P       | Rule 1 and 3: the import replaces the cook's copy. S45 keeps no earlier version.                                     |
| `DraftSetBackToDraft`                                                                                                                                                                                                  | W T         | Rule 3: shared plans and a collection lose it, and publishing again does not restore it.                             |
| `RecipeMakePublicDialog`, `CollectionMakePublicDialog`                                                                                                                                                                 | W T P       | Rule 3: others can see and copy it at once. On Free it cannot go private again without Pro.                          |
| `RewardPublish`, `RewardUnpublish`                                                                                                                                                                                     | W T         | Rule 3: publishing exposes the recipe. Unpublishing spends a slot the cook has not earned.                           |
| `ChefBuyRecipe`, `SchoolCourseCheckout`, `CreatorTipJar`                                                                                                                                                               | W T         | Rule 3: money leaves the account. Keep only while each stays a short confirm. Keep and Not now stay equal in weight. |
| `SubscriptionCancel`                                                                                                                                                                                                   | W T         | Rule 3: changes billing. "Keep Pro" and "Cancel subscription" stay equal in weight.                                  |
| `CookingModeAlarmGoToStep` (S3b)                                                                                                                                                                                       | full screen | Rule 4: a timer the cook set has gone off. Full screen, not a centred card.                                          |
| `RecipeDetailPhotoLightbox`, `RecipeEditorPreview`                                                                                                                                                                     | full screen | Full-screen viewers the cook opened. Outside the centred-modal question.                                             |
| `RecipeEditorRowNutrition` and the row popovers (`popw`)                                                                                                                                                               | W           | Not centred: an anchored panel under its row, non-modal. Already conforms.                                           |
| `DiscoverFilters`, `DiscoverIngredientFilter`                                                                                                                                                                          | W           | A side panel, non-modal. Already conforms.                                                                           |
| `MealPlanAddMeal`, `MealPlanMealDetail` at web 1280                                                                                                                                                                    | W           | A side panel at 1280. Conforms there. See the tablet entry below.                                                    |
| Specs: `buildSpec.md` §6.5 and lines 1028, 1488. `proposalA.md:889`. `specRecipeAndWizard.md:276`, `:458`. `privateFoods/spec.md` withdraw confirm. `compactHeightLayout.md` §9 (`DialogFrame` for the three confirms) | n/a         | All are rule 1 confirms through `ConfirmDialog`.                                                                     |

### Change: it does not need to block

| Board or spec                                                                                                                          | Sizes                                    | Becomes                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ImportAddRecipe`, `ImportAddRecipePageOnly` and spec P1 (`pasteImport/spec.md` §3.1, table lines 91 and 203)                          | W T                                      | Surface by width: pasteImport spec P1 §3.1 (PR #328).                                                                       |
| `createEntryC.md:170`, `createEntryD.md:143`, `:173` choosers                                                                          | spec                                     | Superseded by P1. Follow P1.                                                                                                |
| `RecipeRating`                                                                                                                         | W T P                                    | Inline stars (ownerFeedback M2).                                                                                            |
| `RecipeComments`, `RecipeCommentsYours`                                                                                                | W                                        | Side sheet beside the recipe on wide web. Bottom sheet on phones (unchanged).                                               |
| `RecipeSaveCopy`                                                                                                                       | W                                        | Anchored `Popover` from Save a copy: what the copy contains, and Save my copy.                                              |
| `RecipeUpsellSheet`, `CollectionUpsellSheet`, `MealPlanSuggestPro`, `NutritionSwapsPro`, `AssistantProGate`, `MealPlanPlanForMeLocked` | W T                                      | Rule 6: an inline card where the locked feature is. "What you typed is kept" stays in the card.                             |
| `HomeSubscriptionNudge`                                                                                                                | W T P (modal bottom sheet at every size) | Rule 6: an inline card on Home. Modal at 1280 is the clearest break of "modals in general".                                 |
| `SubscriptionPaywall`                                                                                                                  | W T                                      | Rule 6: a page (`PushedPageFrame` or a route) that compares the plans.                                                      |
| `ImportBookSaved`                                                                                                                      | W T                                      | Rule 5: a snackbar, "Saved as a private recipe", with Open. "Add another" stays on the page.                                |
| `ImportLimitReached`                                                                                                                   | W T                                      | Rule 5: an inline notice at the import control, with the time it opens again.                                               |
| `SourceCheckPublishBlockedNoSlot`, `SourceCheckPublishBlockedWebImport`, `RewardCannotPublish`                                         | W T                                      | Rule 5: an inline notice at the visibility or publish control, with its choices beside it.                                  |
| `privateFoods/spec.md` D1 refusal sheet (built on `Sheet`)                                                                             | spec, W from 640                         | Rule 5: an inline notice at Publish that lists the lines, each with its action. A side sheet if the list is long.           |
| `SourceCheckAskAgain`                                                                                                                  | W T                                      | Anchored `Popover` from "Ask for another look" (one optional note, Send). Bottom sheet on phones.                           |
| `ImportWizardLeave`                                                                                                                    | W T                                      | No confirm: leaving saves. A snackbar says where to pick up ("Saved. Pick up at recipe 15"). Heuristic judgement, untested. |
| `ProfileDisplayName`, `ProfileDisplayNameStates`                                                                                       | W                                        | Inline edit on the profile row.                                                                                             |
| `CollectionRenameSheet`                                                                                                                | W                                        | Inline edit of the collection's title.                                                                                      |
| `NewCollectionSheet`                                                                                                                   | W                                        | Anchored `Popover` from New collection: one name field and Create.                                                          |
| `CollectionRecipePicker`, `CollectionPullUpdates`, `ingredientSpecialization.md:436` (Pull updates, centred from 640)                  | W                                        | Side sheet beside the collection: a list to review before adding.                                                           |
| `DraftCollectionPicker`, `DraftListPicker`, `DraftPlanPicker`                                                                          | W T                                      | Anchored `Popover` from the Add control when the list is short. Side sheet when it scrolls.                                 |
| `MealPlanAddToPlan`                                                                                                                    | W T                                      | Anchored `Popover` from Add to plan: plan, day, meal, servings.                                                             |
| `MealPlanMemberView`                                                                                                                   | W T                                      | `ActionMenu`: it is a list of plan actions.                                                                                 |
| `MealPlanCreatePlan`, `CircleCircleCreate`, `GroceryStoreConnect`, `CookWithMeStart`, `CookWithMeInvite`, `CookWithMeInviteEmpty`      | W T                                      | Side sheet on wide web and iPad landscape. Bottom sheet on phones (unchanged). A route if a flow grows past one screen.     |
| `MealPlanMealDetail`                                                                                                                   | T                                        | Side sheet on iPad, as on web 1280.                                                                                         |
| `RecipeEditorCreateFood`, `…Duplicate`, `…Errors`, `RecipeEditorFoodDetails`, `…Search`, `…States`                                     | W                                        | Side sheet, so the ingredient line the cook is fixing stays in view.                                                        |

### Not resolved in this pass

- `RecipeVersionPreview`, `RecipeVersionPreviewStates`, `RecipeVersionCompare` (web 1280) carry `role="dialog"` on a
  page-sized panel whose placement this audit did not resolve. Check them in the next round.
- `cookingMode` S2 and S3a boards (`CookingModeIngredients`, `CookingModeAddTimer`) are bottom sheets in cooking mode.
  They are not centred. Whether a non-modal sheet would serve better while cooking is a question for the cooking-mode
  round, not this one.
- Archived canvases (`*Combined`) were not audited.

## 7. The fix belongs in the primitive

Most "change" entries on web 1280 and tablet are one defect, not many. The web `Sheet` is a centred dialog from `sm`
(`packages/apps/commise/ui/src/sheet/Sheet.tsx:4`), and the native `presentation="dialog"` centres from 600 dp
(`sheetPresentation.ts:38`). So on web every task built on `Sheet` becomes a centred modal on a wide screen, whatever it is. On native only `presentation="dialog"` centres.

Follow-ups for the design system (not built here):

1. **A side-sheet presentation of `Sheet` for wide screens**, non-modal by default, so a task on `Sheet` becomes a
   side sheet from 840 px on web and on iPad landscape. `presentation="dialog"` then means only "this blocks", for
   rules 1, 3 and 4. This changes what a `Sheet` caller gets on wide screens, so it is a one-way door for the
   primitive's meaning: specify it before building.
2. **A FAB menu** on `CreateFab` for two to six create kinds. P1 needs it first.
3. **An anchored popover on iPad.** Native `Popover` is a bottom sheet on every size today.

## 8. Changes to this file

The ruling is the owner's. Any change to sections 1 and 2 needs a new owner ruling. Sections 6 and 7 are a working
list for later rounds.
