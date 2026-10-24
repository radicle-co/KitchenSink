# Web and mobile parity audit, heuristic evaluation and WCAG 2.2 AA audit (2026-10-17)

**What this is.** A written audit artefact (design deliverable, not production code, not a spec). It closes the tracker row
"Written web and mobile parity audit" in `docs/plans/2026-10-13-007-chore-finish-pr91-plan.md`. Playwright and Maestro on the
finished tree are separate rows and are not covered here.

**Range.** `git diff 4b658b672..HEAD -- packages/apps/commise` at `b8de2f9f7` (762 files; 343 non-test `.ts`/`.tsx` source files).
**Governing design.** `docs/design/uiOverhaul/ownerDecisions.md` (wins), then `buildSpec.md`.

## Hat and standing (read this before trusting any line)

- **Hat:** UX researcher / UI designer, EVALUATE mode. I did not author the code under audit. I did author the earlier
  specs this audit measures it against, so the spec-versus-code rows are the weaker kind of check; the owner rulings are the
  external criteria.
- **Nothing was rendered.** No browser, no device, no screen reader, no 320 px viewport. Everything below is inspection of
  source. **Inspection is not user evidence.** No finding here says what users do. Heuristic claims are labelled as
  heuristic judgement.
- **Coverage, stated honestly.** Of the 343 in-scope source files, I read about 30 in full or in their load-bearing part:
  both `RecipeEditorView` leaves, `RecipeBasicsFields` (web) and its cuisine/chip parts (native), `ChipInput`, the Home
  widget surface, slot, greeting and roadmap slot on both apps (by diff), the byline rule, `RecipeSourceLine`, both
  `RecipeUpsellSheet`s, `privateGate`, `useGatedPrivate`, both `PasteProgressBlock`s, both `RecipePhotoManager`s (controls),
  the social sign-in buttons, `Button.native`, `Chip`, the tooltip contract, `CollectionListFrame`, `SignInForm`, the web
  profile account group, `recentSearchStore` (both). I pattern-scanned all 343 for: click handlers on non-interactive
  elements, `outline-none`, positive `tabIndex`, `<img>` alt, hard-coded user strings, small fixed sizes, `hitSlop`,
  hover/drag/context-menu affordances, `Pressable` without a role, and web/native live-region counts. I did **not** read the
  other ~310 files line by line. This is a **sample plus mechanical scans**, not a complete audit.
- **Contrast was computed, not recalled.** 26 foreground/background pairs from `ui/src/tokens/colors.ts` (light and dark),
  scripted. All pass the threshold that applies to them (table in Part 2).
- **Product breadth.** The unit of translation here is the _job_, not the screen. Most of the app is one feature package
  (`features/recipes`, `features/account`, `features/core`) with ~33 `X.tsx` / `X.native.tsx` pairs in scope. The two apps
  share one copy catalogue (`*Messages` in the feature packages), enforced by `appCopyIsNotDuplicated.test.ts`. That is why
  localisation keys below are written once and apply to both platforms.

## Raising this before we build (one item, Situation A-adjacent, pre-existing)

**"I must tell you this": the web app keeps recent searches in `localStorage`.** `web/src/lib/recentSearchStore.ts:19-56`
writes the key `commise.recipes.recentSearches.v1` (`features/recipes/src/discovery/recentSearches.ts:28`) to
`window.localStorage`. Owner ruling 2026-09-17 keeps durable app data out of the browser; D7 and D18 are recorded as the
_only_ two narrow exceptions (`ownerDecisions.md:24-27, 54-56`), and D19 says "No preference is kept in browser storage"
(`:59`). Recent searches are neither the editor draft nor cook marks. Two further facts make it worse than a policy miss:
the key is **not scoped to the signed-in person**, and I found **no code that clears it at sign-out** on either platform
(grep of the sign-out path and `features/account/src/session`; negative result, not a proof). On a shared browser, person B
sees person A's searches. It predates this range (`00eb976e2` is an ancestor of `4b658b672`), so it is not a regression of
this branch. Underlying goal (a fast repeat search) is kept by an in-memory list per session, or by `sessionStorage` scoped by
subject like D18. Native `AsyncStorage` is allowed by the ruling but has the same unscoped key and no sign-out clear.
**Decided (owner, 2026-10-17): keep on the device, per user, ended by sign-out. Recorded as D23 in `ownerDecisions.md`; built.**

---

# Part 1. Web and mobile parity audit

**Legend.** _Lock-step_ = same job, same elements, same states. _Disposition_ per `§3.6`: kept · collapsed · moved ·
deferred · dropped, each with its authority. A "gap" is a difference with no recorded authority or a defect. Source cites are
`path:line` on `b8de2f9f7`.

## 1.0 Structural finding

Parity here is **by construction**, not by review. Screens are composed in `features/*` from one hook and one message
catalogue, with a `.native.tsx` leaf where the platform needs one (`RecipeEditorView.tsx` / `.native.tsx` both call
`useEditorPage(props)` and draw the same chrome, sections and notices). The two apps' Home hosts are near-copies
(`web/src/components/home/*` and `mobile/src/components/home/*`, same nine file names). That guarantees copy and state
parity; it does **not** guarantee quality parity (`§3.6`). The dispositions below are where the quality questions sit.
**Risk to name:** nine duplicated Home files per app are a drift surface with no cross-app guard I could find. I did not
look for one outside `repoGuards`; treat as unverified.

## 1.1 One-page editor (create and edit)

| Element                                                  | Web                                                                       | Mobile                                                                                   | Lock-step?                 | Disposition and authority                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| Header, close ×, ⋯ discard menu                          | `EditorHeader.tsx`                                                        | `EditorHeader.native.tsx`                                                                | yes                        | kept. × never asks (`RecipeEditorView.tsx:15`)                                               |
| Section index                                            | rail ≥ wide, strip regular, bar+sheet phones (`SectionIndex.tsx:231,257`) | same component; bar hides while keyboard is open (`RecipeEditorView.native.tsx:107,189`) | yes, one extra native rule | kept. D2. Keyboard-open hide is native-only: **moved** to header-alone, `buildSpec §7.1`     |
| Action bar                                               | pinned, glass; unpins when header + bar exceed half the viewport (`:98`)  | outside scroller in thumb zone; same unpin rule (`:103-107`)                             | yes                        | kept; primary position re-decided per platform by reach, `compactHeightLayout.md A1`         |
| Sections (Details, Ingredients, Steps, Photos & publish) | `EditorSection`                                                           | `EditorSection.native` + `focusSignal`                                                   | yes                        | kept. Native adds screen-reader cursor move on jump (`:121-126`). Web moves focus to heading |
| Unload prompt                                            | `useUnloadGuard` (`:101`)                                                 | none                                                                                     | no, by design              | dropped on native: no tab to close; device draft + outbox instead. D7                        |
| Header status "Saved in this tab"                        | web                                                                       | "Saved on this device"                                                                   | no, by design              | kept. D7; keys `editorMessages.status.savedInTab` / `.savedOnDevice`                         |
| Cuisine clear button                                     | none; Escape clears a closed list (`Combobox.tsx:45`)                     | 48 dp clear button (`RecipeBasicsFields.native.tsx:186`, `cuisineClear`)                 | no, by design              | kept. `cuisineField.md:202,211`                                                              |
| Tag / diet chip add                                      | Enter or comma (`ChipInput.tsx`)                                          | plus an Add control (`addTagLabel`, `addDietaryFlagLabel`)                               | no, by design              | kept: touch gets an explicit control. Web keeps `enterKeyHint="done"`                        |
| Ingredient amount note                                   | `ingredientRowView` note                                                  | same note, plus `rowAmountInvalid` fallback (`IngredientLineEditor.native.tsx:59`)       | yes                        | kept; same key `recipeFormMessages.rowAmountInvalid`                                         |
| Row editor                                               | inline                                                                    | sheet on phones                                                                          | no, by design              | moved. "On phones the row editor opens as a sheet" (`ownerDecisions.md:84`)                  |
| Row ⋯ menu (move up/down, move to group)                 | `rowMenu.ts`                                                              | same list                                                                                | yes                        | kept. No drag reorder exists, so SC 2.5.7 has nothing to satisfy                             |
| Steps paste                                              | `PasteStepsControl` pair                                                  | pair                                                                                     | yes                        | kept                                                                                         |
| Ingredient paste gating (D10)                            | `pasteAvailable` in session                                               | same                                                                                     | yes                        | kept; shared `useRecipeEditorSession.ts:253`                                                 |
| Conflict view                                            | wrapped in `EDITOR_GUTTER`                                                | own 16 pt padding (`RecipeConflictView.native.tsx:420`)                                  | yes                        | kept                                                                                         |
| Back-to-top                                              | none                                                                      | none                                                                                     | yes                        | dropped on both. D3                                                                          |
| Guided first-recipe hints                                | none                                                                      | none                                                                                     | yes                        | dropped. Decision 12                                                                         |

**States, all shared keys** (`editorMessages`, `recipeFormMessages`, `photoMessages`):

- **Empty / first-run:** `steps.empty`, `photos.empty`, `photoMessages.emptyBody`; new recipe is the empty editor.
- **Loading:** `EditorStateFrame` (web), mobile screen suspends; label is the shared load caption.
- **Partial / validation:** `index.status.*` (`fix`, `notStarted`, `optional`, `ready`, `complete`), `index.reason.ingredientsUnresolved`, `…QuantityInvalid`; title/description counters `details.titleCounter`, `details.titleLimit`, `details.descriptionLimit` (D: over 256 blocks Publish).
- **Saving / saved / error:** `status.saving`, `.saved`, `.savedOnDevice`, `.savedInTab`, `.changesOnDevice`, `.changesInTab`, `.deviceFailed`, `.tabFailed`, `.saveFailed`, `.notSaved`, `.unconfirmed`; `failure.failedBody`, `failure.retry`.
- **Conflict:** `status.conflict` plus `RecipeConflictView` copy (`recipeVersionMessages`).
- **Resume:** `resume.body/save/discard`.
- **Offline:** no editor-specific string. Draft and outbox live on the device, so the editor saves regardless (owner offline directive). Shell connectivity notice is `offlineNoticeMessages` (web `AppShell.tsx` `SyncNoticeHost`).
- **Permission-denied:** the editor reaches Private through the paid gate (1.7). No other denial state.
- **Success:** `published`, then the detail page snackbar "Recipe published."

## 1.2 Home widgets

| Element              | Web                                                                                 | Mobile                                               | Lock-step?    | Disposition                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting (H1 + date) | `HomeGreeting.tsx`, reads clock after hydration, reserved `aria-hidden` placeholder | `HomeGreeting.tsx` (mobile), reads in render         | yes           | kept; hydration is web-only machinery                                                                                                                          |
| Avatar action        | in large title below 840; sidebar holds avatar at 840+                              | avatar in large title                                | yes           | kept. D5/D6                                                                                                                                                    |
| New recipe           | `RecipeCreateButton` right after the H1 (FAB) / sidebar button at 840+              | `CreateFab` floated by `HomeScreen`, not in the host | yes           | moved (host → screen). D4, D13                                                                                                                                 |
| Recent recipes       | compact 2×2 / 4×1 / full 4×1 by container width (`cardVariantOf`)                   | same function, `useMainContainerClass`               | yes           | kept. D8                                                                                                                                                       |
| Coming soon group    | 3-column grid at `@wide/main` (`HomeWidgetSurface.tsx` `COMING_SOON_SPAN`)          | stacked                                              | no, by design | collapsed on native; width never reaches a 3-up grid on a phone. **Not recorded as a decision anywhere I read; recommend a one-line note in `buildSpec §4.2`** |
| Roadmap slot         | `next/dynamic` + `Suspense`                                                         | `React.lazy` + `Suspense`                            | yes           | kept                                                                                                                                                           |
| Widget error         | `HomeWidgetErrorNotice` (`role="status"`)                                           | same notice                                          | yes           | kept                                                                                                                                                           |
| Subscription nudge   | dialog                                                                              | sheet, with `mobile.home.nudge.close`                | yes           | kept. Upgrade action only dismisses (010 not shipped; `SubscriptionNudge.tsx:37`)                                                                              |

**States:** **loading** `RecipeWidgetLoadingCard`; **empty / first-run** `recipeMessages.home.recentEmptyBody`, `.firstRecipe`, `.pasteIngredients`, `.findOnDiscover`; **error** `home.loadError` + `home.retry`, with `home.seeAll` / `seeAllLabel` kept so the route off Home survives; **widget crash** `homeMessages.widgetError`; **offline** shell notice, cached cards stay; **permission-denied** n/a (own library); **success** n/a.

## 1.3 Discover

| Element                        | Web                                              | Mobile                                               | Lock-step? | Disposition                                                   |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| Search field + recent searches | `RecipeDiscoveryFrame.tsx` panel, `localStorage` | `DiscoveryRecentSearches.native.tsx`, `AsyncStorage` | no         | **GAP G1** (storage policy), see top                          |
| Filters                        | `FilterTrigger.tsx` popover                      | `DiscoveryControls.native.tsx` sheet                 | yes        | moved to a sheet on touch                                     |
| Sort                           | `DiscoverySortMenu.tsx`                          | `.native.tsx`                                        | yes        | kept                                                          |
| Browse rails                   | `RailTrack.tsx` (scroll, controls)               | `RecipeBrowseRails.native.tsx`                       | yes        | kept; native uses horizontal scroll, web adds `useRailScroll` |
| Card byline                    | `DiscoveryFooter.tsx` via `bylineOf`             | `.native.tsx` via same rule                          | yes        | kept. One rule: person / name / former / source / none        |
| Save a copy on card            | icon                                             | icon                                                 | yes        | kept. Owner: stays an icon on Discover                        |

**States:** **loading** `discoveryMessages.loadingLabel`, `loadingMore`; **empty** `emptyTitle`, `emptyBody`, plus `noResults.ts` variants; **error** `errorTitle`, `retry`, `loadMoreError`, `refreshError`, `railError`, `railEmpty`, `railsRefreshError`; **offline** read slot keeps cached results (`OfflineReadSlot`); **permission-denied** n/a; **first-run** rails with no recents.

## 1.4 Recipe detail

| Element                                | Web                                               | Mobile                                               | Lock-step?    | Disposition                     |
| -------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | ------------- | ------------------------------- |
| Body                                   | `RecipeDetailBody.tsx`                            | `.native.tsx` split into `Detail*Section.native.tsx` | yes           | kept                            |
| Serving scale                          | `ServingScaleControl`                             | same file                                            | yes           | kept                            |
| Tap-to-check ingredients, current step | `sessionStorage` (`cookMarksBackend.ts:73`)       | memory (`cookMarksBackend.native.ts`)                | no, by design | kept. D18                       |
| Screen on (keep awake)                 | shown only if available (`useKeepAwakeAvailable`) | always                                               | no, by design | kept; web Wake Lock is optional |
| Rating                                 | `RecipeRatingDisplay/Input` pairs                 | same                                                 | yes           | kept; owner sees aggregate only |
| Source line                            | `RecipeSourceLine.tsx`, new tab                   | `.native.tsx`, `openExternalUrl.native.ts`           | yes           | kept                            |
| Byline                                 | `detailFacts` + `bylineOf`                        | same                                                 | yes           | kept                            |
| Version number                         | none on the page                                  | none                                                 | yes           | dropped. Decision 7             |
| Delete then snackbar "Recipe deleted"  | address param `RecipeDeletedNotice`               | `snackbar.show` (`RecipeDetailScreen.tsx:228`)       | yes           | kept. Decision 4                |
| Save a copy                            | creates a draft, lands in editor                  | same                                                 | yes           | kept. Decision 3                |
| ⋯ menu                                 | `detailMenu.ts`                                   | same                                                 | yes           | kept                            |

**States:** **loading** `recipeLoadMessages.loadingLabel` ("Loading recipe…"); **error** `.errorTitle`, `.retry`; **permission-denied / not found** one state, `.notFoundTitle` (a 404 hides existence on purpose, final, no retry); **partial** nutrition stale `recipeMessages.detail.nutritionStale`; **offline** refresh notice, cached recipe stays; **success** `detailActions.recipeDeleted`, `…saveCopy…`; **first-run** n/a.

## 1.5 Collections

Pairs: `CollectionHeader`, `ListFrame`, `ListResults`, `Members`, `MemberRow`, `Sheet`, `UpsellSheet`, `RecipePicker`, `PullUpdatesDialog`, and the load/loading/error leaves. All have both leaves; delete/make-public dialogs are shared.

| Element                               | Web                                                                             | Mobile                                    | Lock-step? | Disposition     |
| ------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- | ---------- | --------------- |
| New collection                        | secondary button in header at 840+, FAB below (`CollectionListFrame.tsx:44-53`) | FAB (`CollectionListFrame.native.tsx:70`) | yes        | kept. D4        |
| Source owner byline ("Copied from …") | `sourceOwnerByline.ts`                                                          | same                                      | yes        | kept            |
| Make private                          | upsell sheet when `upsell`                                                      | same                                      | yes        | kept. See 1.7   |
| Pull updates                          | dialog                                                                          | dialog                                    | yes        | kept            |
| Recipe picker                         | dialog/sheet                                                                    | sheet                                     | yes        | moved on phones |

**States:** **loading** `collectionMessages` `loadingLabel` (list, detail, picker); **empty** `emptyTitle`, `emptyBody` (list, detail, picker); **error** `errorTitle`, `retry`, `loadMoreError`, `refreshError`, `refreshRetry`, `deleteError`, `removeError`, `createFailed`, `visibilityFailed`, `saveCopyFailed`, `addFailed`, `toggleAddFailed`, `toggleRemoveFailed`; **not found** `notFoundTitle`, `notFoundBody`; **permission-denied** `upsellTitle`, `upsellBody`, `upsellSee`, `upsellNotNow`, `upsellClose`; **offline** refresh notice; **success** snackbars on create/copy.

## 1.6 Cuisine field

Shared `useCuisineField` + `Combobox` (`typedText="isValue"`, `openOnFocus`). Differences are all recorded in `cuisineField.md`: native clear button and `listMaxRows` of five (`CUISINE_LIST_MAX_ROWS`); web Escape-to-clear. **Lock-step on job; designed differences on input.** **States and keys** (`recipeFormMessages`): label `cuisineLabel`; hint `cuisineHint` ("You need one to publish."); list `cuisineListLabel`, `cuisineSuggestionCount`; **empty/no match** `cuisineNoMatch`, `cuisineNotListedHeading`, `cuisineUseOwn`, `cuisineUseOwnName`; **error** `errors.cuisineTooLong` (spoken once via `alertAnnouncement`, S9); **publish refused** is spoken by the refusal path (S8). Required to publish, public-domain import exempt (owner 2026-10-13).

## 1.7 Roles and paid gate

Decision logic lives once: `actions/privateGate.ts` (`granted` / `upsell` / `hidden` / `loading`, loading fails closed), `useGatedPrivate`, and recipe-service policy modules. Both platforms draw the same states.

| State          | Recipe                                                   | Collection                   | Both platforms                                                          |
| -------------- | -------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `granted`      | Private works                                            | Private works                | yes                                                                     |
| `upsell`       | Premium sheet (`RecipeUpsellSheet` pair)                 | `CollectionUpsellSheet` pair | yes. Keys `recipeActionMessages.upsell.*`, `collectionMessages.upsell*` |
| `hidden`       | no Private, no upsell; `visibility.publicIsFinal`        | same                         | yes                                                                     |
| `loading`      | nothing offered                                          | nothing offered              | yes                                                                     |
| server refusal | `recipeActionMessages…privateRefused.final` / `.premium` | `visibilityFailed`           | yes                                                                     |

**Gap, not parity:** the upsell's **See Premium** only closes the sheet (`useGatedPrivate.ts:64`, `CollectionDetailBody.tsx:157`). See H1.

## 1.8 Usernames byline

One rule, `byline/bylineOf.ts`, rendered through `bylineText` on Discover (`DiscoveryFooter`), recipe detail (`detailFacts`), and the collection header, list and pull dialog. An erased author is `former` and decided first (the `user_<ULID>` pseudonym would otherwise read like a username). **Lock-step: yes, by single rule.** Profile: username and email appear once, in the header, on both apps (decision 13); web's `ProfileAccountGroup.tsx` holds the display-name row only. **States:** `none` renders nothing; `former` has its own copy in `bylineMessages`. Web-only `ShortcutSwitchRow` ("/" search shortcut, D19) is **dropped** on native (no hardware keyboard on the touch path).

## 1.9 Parse statuses

`PasteProgressBlock` pair draws one `pasteProgressViewOf` view. Web: separate spans and a focus-on-signal block (`tabIndex=-1`). Native: one `accessible` summary whose label joins title, status, hint and failure (`PasteProgressBlock.native.tsx`), then the action buttons outside it. **Lock-step: yes in content.** Actions: visible text "Try again" / "Add the rest as written", accessible name longer ("Try again for 3 lines") and **contains** the visible text, so SC 2.5.3 holds on both. **States:** `pasteProgressStarted`, status words from `statusWord.ts`, `pasteRetryFailed`, `statusActionRetry`, `statusActionRetryLookupLabel`; **retry cancels nothing paid** (tracker: "Add as written does not cancel that line's paid parse"). **Gap G3:** see below, upload progress.

## 1.10 Sign-in with Google and Apple

| Element               | Web                                                                             | Mobile                                                                               | Lock-step?    | Disposition                                                           |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------- |
| Form                  | Clerk's `<SignIn>` widget (`SignInForm.tsx`), copy from `lib/clerkLocalization` | own screens `login.tsx`, `signup.tsx`, `authSurfaceMessages` + `mobileMessages.auth` | no            | kept. Different engines, one brand line "Your recipes, in one place." |
| Google                | **not verifiable from code** (Clerk dashboard config)                           | `GoogleSignInButton.tsx`                                                             | unverified    | open                                                                  |
| Apple                 | none                                                                            | system `AppleAuthenticationButton`, iOS only                                         | no, by design | dropped on web, `buildSpec.md:1730` ("Apple on native")               |
| Photo panel           | ≥ 1024 (`AuthSplitLayout`)                                                      | none                                                                                 | no, by design | dropped on phones. Decision in "Adopted" list                         |
| Provider group absent | n/a                                                                             | draws nothing (prod Android)                                                         | n/a           | kept                                                                  |
| Sign-up entry         | link from `signUpUrl`                                                           | `LoginScreen` control                                                                | yes           | kept. FR-045a                                                         |

**States (mobile, `mobileMessages.auth`):** busy `socialBusy` (polite status, SC 4.1.3), failure `socialFailed` (alert), `signInFailed`, `signUpFailed`, `verifyFailed`, `sendCodeFailed`, `networkError`, divider `orDivider`. **Web states are Clerk's own and unverified.** **One Tap (owner ruling 2026-10-13): no One Tap code found in `web/src`** (grep); "not built in scope". The roles/paid-gate **variables** are infra and are not UI.

## 1.11 Parity gaps (the list)

| #   | Severity          | Gap                                                                                                                                                              | Where                                                                                                              | Note                                                                                                                                                                                                                                 |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | **High**          | Recent searches in `localStorage`, unscoped, never cleared at sign-out                                                                                           | `web/src/lib/recentSearchStore.ts:19-56`; `recentSearches.ts:28`; native `mobile/src/storage/recentSearchStore.ts` | pre-existing; raised above                                                                                                                                                                                                           |
| G2  | Low               | List view mode kept in a **cookie** on web (`web/src/app/[locale]/recipes/page.tsx:48`), `AsyncStorage` on native (`useStoredViewMode.ts`)                       |                                                                                                                    | D19: "No preference is kept in browser storage." **Resolved 2026-10-17:** the owner ruled it a preference; it is now the account setting `recipeViewMode` (both stores removed; `recipeViewModeHasNoDeviceStore.test.ts` guards it). |
| G3  | Low               | Upload in progress is announced on web (`role="status"`, `RecipePhotoManager.tsx:75`) and not on native (`progressbar` only, `RecipePhotoManager.native.tsx:80`) |                                                                                                                    | the failure is an assertive alert on both                                                                                                                                                                                            |
| G4  | Low (house floor) | Photo controls bypass the `Button` primitive: native Remove pill, Replace, queue Retry/Remove are ~21 pt tall, cover radio 24×24 pt; no `hitSlop`                | `RecipePhotoManager.native.tsx:341-383`; web `RecipePhotoManager.tsx:171,234,248` `px-3 py-1`                      | pre-existing (2-line diff in range). Class: `Button size="sm"` already carries a 44/48 hit frame (`Button.native.tsx:147-148`)                                                                                                       |

No other parity gap found in what I read. **Not a gap, but undocumented:** Home's "Coming soon" grid versus stack (1.2).

---

# Part 2. Heuristic evaluation and WCAG 2.2 AA audit

## 2.0 Method and limits

Inspection only. Standard: **WCAG 2.2 AA** (no stricter binding level found in the repo; `buildSpec.md:14` adds a **house floor** of 44 × 44 pt iOS, 48 × 48 dp Android for touch). Heuristics: Nielsen's ten. Contrast computed with the WCAG relative-luminance formula. Nothing was rendered, so reflow, text spacing, focus-obscured and zoom items are marked "likely pass, not rendered". **WCAG failures and house-floor misses are counted separately.**

## 2.1 Heuristic findings

| #   | Severity        | Heuristic                                                               | Observation                                                                                                                                                                                               | Judgement                                                                                                                                                                                                                                                                                            | Recommendation                                                                                                                                             |
| --- | --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Medium (latent) | #2 match the real world; #4 consistency (the control does what it says) | **See Premium** closes the sheet and goes nowhere on both platforms (`useGatedPrivate.ts:64`; `CollectionDetailBody.tsx:157`). Same limit as the Home nudge (`SubscriptionNudge.tsx:37`: 010 not shipped) | A button whose label promises a destination and only dismisses reads as broken. Latent: it shows only in `upsell` state, and both gate variables are false (tracker line 131), so it is `hidden` today. Equal weight with Not now is correct and spec'd (DSA Art. 25 reasoning, `buildSpec.md:1134`) | Before the gate flips, either ship the destination or relabel to "Learn more" with a body that says Premium is not open yet. Heuristic judgement, untested |
| H2  | Low             | #1 visibility of system status                                          | Web document titles are set in a client effect (`AppShell.tsx:86`); server HTML carries the site title only. Per-route pages have no `generateMetadata` except profile, legal and auth                    | Fine after hydration for people using a browser with scripts. Shared links and no-script users get the generic title                                                                                                                                                                                 | Unverified how `recipes/[id]` titles itself; check                                                                                                         |
| H3  | Info            | #9 recover from errors                                                  | "Offline" has no dedicated sentence; a failed refresh says `refreshError` and keeps cached data                                                                                                           | Consistent with the owner's offline directive. A cook cannot tell offline from a server fault                                                                                                                                                                                                        | Leave; shell `SyncNoticeHost` carries connectivity                                                                                                         |

**Checked and found sound (so the search is visible):** the upsell actions at equal weight; no hover-only, right-click-only or drag-only control anywhere in range (grep); the loading doctrine (visible caption names the status); label-in-name on the paste actions; no hard-coded user strings in 343 files (scan); web/native copy from one catalogue; destructive × never asks, with a draft guard instead; fail-closed `loading` in the paid gate; error text names the next step on the editor failure notice.

## 2.2 WCAG 2.2 AA by criterion

| SC                                     | Verdict                        | Evidence                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.1 Non-text content                 | pass (sampled)                 | both `<img>` have `alt` from keys (`RecipePhotoManager.tsx:117,196`)                                                                                                                                                                                                      |
| 1.3.1 Info and relationships           | pass (sampled)                 | `ol` for steps, `ul` for photos; native `role="list"/"listitem"` (`RecipeInstructionsFields.native.tsx:55,76`)                                                                                                                                                            |
| 1.3.5 Identify input purpose           | pass                           | `autoComplete` set on email, current/new password, one-time-code (`login.tsx:268,283`; `signup.tsx:326`; `AuthCodeFields.tsx:52`)                                                                                                                                         |
| 1.4.1 Use of colour                    | pass (sampled)                 | cover status is text (`RecipePhotoManager.tsx:126`); links underlined (`RecipeSourceLine.tsx`)                                                                                                                                                                            |
| 1.4.3 Contrast (min)                   | **pass, computed**             | see table below                                                                                                                                                                                                                                                           |
| 1.4.4 / 1.4.10 / 1.4.12                | likely pass, not rendered      | no `allowFontScaling={false}` or px text found; `min-w-0`, wrap and container classes used. **320 px not checked**                                                                                                                                                        |
| 1.4.11 Non-text contrast               | **pass, computed**             | control edge 3.44:1 on sand, 3.21:1 on linen, 4.72:1 dark; focus ring 5.75:1 light                                                                                                                                                                                        |
| 1.4.13 Content on hover                | pass                           | `Tooltip.tsx:9-16`: hover and focus, Escape dismiss, hoverable, touch never opens it                                                                                                                                                                                      |
| 2.1.1 Keyboard                         | pass (sampled)                 | no click handler on non-interactive elements (scan)                                                                                                                                                                                                                       |
| 2.4.2 Page titled                      | likely pass, see H2            |                                                                                                                                                                                                                                                                           |
| 2.4.3 Focus order                      | not verified                   | DOM order is source order on web; native jump moves the screen-reader cursor                                                                                                                                                                                              |
| 2.4.7 Focus visible                    | pass (sampled)                 | `RecipeCard.tsx:499` and `CollectionListResults.tsx:~100` draw `has-[:focus-visible]:ring-2` on the card while the stretched link removes its outline; chips, rows, tab bar, sidebar carry `focus-visible:ring-2`                                                         |
| 2.4.11 Focus not obscured (new in 2.2) | **likely pass, not rendered**  | sticky header and pinned action bar: `PopupInsetsContext` + `useEditorScrollPadding` (`RecipeEditorView.tsx:105-111`)                                                                                                                                                     |
| 2.5.3 Label in name                    | pass                           | "Try again for 3 lines" contains "Try again"                                                                                                                                                                                                                              |
| 2.5.7 Dragging movements (new)         | pass                           | no drag exists; reorder is by menu (`rowMenu.ts`)                                                                                                                                                                                                                         |
| 2.5.8 Target size (min) (new)          | pass                           | all sampled targets ≥ 24 px or meet the spacing exception; `Button sm` hit frame 44/48; chips extend `pointer-coarse`                                                                                                                                                     |
| 3.2.2 On input                         | pass (sampled)                 | cuisine commits on explicit choice / Done                                                                                                                                                                                                                                 |
| 3.3.1 Error identification             | pass                           | `role="alert"` errors on web; `accessibilityRole="alert"` on native (`RecipeInstructionsFields.native.tsx:42-46`)                                                                                                                                                         |
| 3.3.7 Redundant entry (new)            | pass                           | Google/Apple finish step asks only for the missing fields (`SignUpFields.tsx`); display name prefilled from Google given name                                                                                                                                             |
| 3.3.8 Accessible authentication (new)  | pass on mobile; web unverified | native password and OTP fields declare `autoComplete`, so a manager or paste works; web is Clerk's widget                                                                                                                                                                 |
| **4.1.3 Status messages**              | **FAIL (Minor), likely**       | native upload-in-flight is a `progressbar` with no live region (`RecipePhotoManager.native.tsx:80-84`); web announces it with `role="status"` (`:75`). A screen-reader user gets no feedback between choosing a photo and the result. Inspection only; device test needed |
| 4.1.2 Name, role, value                | pass (sampled)                 | one `Pressable` without a role found, a hidden backdrop (`Sheet.native.tsx:96`, `accessible={false}`, a close button exists)                                                                                                                                              |
| 2.3.3 Animation from interactions      | n/a (AAA)                      | `Button.tsx:65` spinner has no reduced-motion variant; not an AA criterion; **not counted**                                                                                                                                                                               |

**Non-findings, to prevent re-raising:** `focus:outline-none` on `tabIndex=-1` headings (`RecipeDetailBody.tsx:140`, `HomeGreeting.tsx:52`) is a programmatic focus target, outside 2.4.7; disabled controls are exempt from contrast.

**Computed contrast (WCAG ratio; threshold in brackets):** light `inkMuted` on canvas 5.41, on linen 5.05, on selected fill 4.87 [4.5]; `actionText` on canvas 5.75, linen 5.36, selected fill 5.18 [4.5]; `dangerText` on canvas 5.23 [4.5]; attention on canvas 5.45 [4.5]; white on seafoam fill 4.67 [4.5]; rating on white 4.43 [3, graphic]; control edge on canvas 3.44, on linen 3.21 [3]; focus ring on canvas 5.75 [3]. Dark: `inkMuted` on canvas 8.70, on muted 6.82; `actionText` on paper 8.82, on selected 6.31; `dangerText` on paper 7.10; attention on paper 9.69 [4.5]; control edge on canvas 4.72, on raised paper 3.94 [3]; selected edge on selected fill 5.13 [3]. **All pass.** Not computed: text over photos (`photoChip` is 92% opaque, designed for it), glass materials, and Clerk's themed widget.

## 2.3 House-floor misses (not WCAG failures; counted separately)

| #   | Control                                            | Size                                                                          | Floor                     | Where                                           |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| F1  | Photo Remove, Replace, queue Retry/Remove (native) | ~21 pt tall, 11 pt label                                                      | 44 pt iOS / 48 dp Android | `RecipePhotoManager.native.tsx:334-350,377-383` |
| F2  | Cover radio (native)                               | 24 × 24 pt                                                                    | same                      | `:365-376`                                      |
| F3  | Same web pills                                     | `px-3 py-1` text-caption, ~24 px, not measured; no `pointer-coarse` extension | 44 on coarse pointers     | `RecipePhotoManager.tsx:171,234,248`            |

All three are one class: hand-rolled pills instead of `Button size="sm"`, which already supplies the hit frame. **The fix belongs at the call sites using the primitive** (no new primitive needed). Pre-existing, so lowest cost to do alongside the next touch of the file.

## 2.4 Totals

- **Parity gaps:** High 1 (G1) · Medium 0 · Low 3 (G2, G3, G4).
- **Heuristic:** Medium 1 (H1, latent) · Low 1 (H2) · Info 1 (H3).
- **WCAG 2.2 AA failures (inspection, likely):** Serious 0 · Minor 1 (4.1.3 native upload).
- **House-floor misses:** 3 (F1-F3, one class).

## 2.5 What I could not check

Anything rendered: 320 px reflow, 200% zoom, text spacing, dark-mode appearance of glass, real focus order, screen-reader flow on VoiceOver and TalkBack, keyboard-open behaviour, safe-area insets, and the landscape compact tab bar (decision 9). Clerk's web sign-in states and whether Google shows on web. Whether any guard keeps the nine duplicated Home files in step. The other ~310 in-scope files beyond the scans listed. RTL and +35% string expansion (the app ships `en` only; nothing here was tested for either).

## 2.6 Measurement and hand-off

- **Signals:** G1 is closed when no `localStorage` write exists outside the D7/D18 set and sign-out removes the key (`repoGuards` test over `localStorage`). F1-F3 close with a 44/48 measurement in the native and Playwright mobile-width tests. H1 closes when See Premium goes somewhere or is relabelled.
- **Owner decisions needed:** (1) G1 keep or scope; (2) G2 is a view mode a "preference" under D19.
- **Next actor:** the frontend implementer, for G1, G3, G4/F1-F3, once the owner answers (1). Findings in the "undocumented disposition" bucket (Home Coming soon stack) are feedback about the spec: add one line to `buildSpec.md §4.2`.
- **Then:** Playwright (web) and Maestro (mobile) on the finished tree, the separate tracker row; this audit does not replace them.

**References consulted:** `ownerDecisions.md`, `buildSpec.md` (lines 14, 45, 100-115, 1134-1142), `cuisineField.md`, WCAG 2.2 success criteria named above (criterion numbers and levels from memory of the W3C text; **not re-fetched today**, so treat the numbers as to be spot-checked against w3.org/TR/WCAG22), Nielsen's ten heuristics, `ui/src/tokens/colors.ts` (contrast computed). `ux-design-corpus` was **not loaded** for this pass.
