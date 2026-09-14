# 10 — Recipe import: UX design specification

**Status**: design specification (read-only review; no code changed)
**Date**: 2026-08-14 · **Branch**: `chore/code-quality-enforcement-phase-1-2`
**Scope**: the UI for feature 004's import spine — method chooser, URL + file channels, bulk/async status,
draft review — on **web and mobile in lockstep** (`docs/CODING_STANDARDS.md` §14.1).

**Normative inputs** (read in full before this document):

- `docs/architecture/decisions/0019-recipe-import-spine.md` §2 (method chooser, no omni-input), §4 (superseding
  per-entity status), §5 (DB placeholder/shell so status is readable, not stream-only).
- `specs/004-recipe-importing/spec.md` — _The draft-and-confirm model_, FR-008, FR-011, FR-013, FR-015,
  FR-016, FR-018, FR-019, FR-020, FR-021, FR-022, FR-026, FR-027, FR-028, FR-046..FR-051, NFR-003..NFR-005.
- `specs/004-recipe-importing/plan.md` — the endpoint table (L211-226) and `207 Multi-Status` for bulk confirm.
- `CLAUDE.md` — cross-platform rule, localization, pure render components / orchestration split.

**Grounding**: every recommendation below cites a shipped file in this repo. Where no precedent exists, that is
said explicitly.

> ### ⚠️ Finding before design: `tasks.md` contradicts ADR-0019 and will build the wrong UI
>
> `specs/004-recipe-importing/tasks.md` predates the 2026-08-14 owner ruling and still instructs:
>
> - **T-018** — "OCR channel _(D-001 — P1, ships at launch)_", with `POST /import/photo`, Textract, S3 image
>   lifecycle (tasks.md:552-590). ADR-0019 §3 **supersedes** this: photo is 011's, 004 ships no OCR.
> - **T-021** — "Channel list driven by `GET /import/sources` so a gated channel **never renders**"
>   and "Mobile camera capture wired to the OCR channel (T-018) — mobile-primary, shipping in this task"
>   (tasks.md:659-662). Both directly contradict FR-046 / ADR-0019 §2, which require an unavailable method to
>   be **shown with its reason**, never omitted and never a control that does nothing.
> - **T-019** — "With [the Instagram flag] off … neither UI offers it — no dead affordance" (tasks.md:594-596).
>   Same contradiction.
>
> The whole of §"Method chooser" below assumes FR-046/ADR-0019 wins (they are the later, owner-ruled source).
> The reconciliation is a task-list edit, not a design choice — but it is a prerequisite, because a
> `GET /import/sources` that _omits_ a channel makes FR-046's display physically impossible on the client (the
> client cannot render a reason it was never told). See **Open question 1**.

---

## Entry points

### What exists today

| Surface                  | Create affordance                                                       | File                                                     |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Web recipe list          | Pinned FAB (`list.createCta`) + empty-state CTA, **mutually exclusive** | `features/recipes/src/list/RecipeList.tsx:91-97,162-177` |
| Web route                | `/[locale]/recipes/new` → `RecipeCreateContainer`                       | `web/src/app/[locale]/recipes/new/page.tsx`              |
| Web shell title registry | `SHELL_SURFACE_IDS` — a missing title is a **compile error**            | `web/src/components/app/shellSurfaces.ts`                |
| Mobile recipes surface   | `Surface` union + `RecipeListScreen`'s `onCreateRecipe` → `create`      | `mobile/src/screens/RecipesScreen.tsx:39-50,182-225`     |
| Mobile create screen     | `RecipeCreateScreen` (own step state, no `useRecipeEditor`)             | `mobile/src/screens/RecipeCreateScreen.tsx`              |

`RecipeList.tsx:91-97` documents a **standing rule**: the FAB is suppressed in the true-empty state "so there
are never two competing create affordances." Adding a second pinned "Import" button would break that rule on
both platforms. The design below respects it.

### Recommended entry points

**E1 — the add-affordance becomes a two-item disclosure, not a second button.**
The existing FAB (web) / create control (mobile) opens a small menu with exactly two items:

1. **Create a recipe** → today's `/recipes/new` · mobile `{ id: 'create' }`
2. **Import recipes** → new `/recipes/import` · mobile `{ id: 'import' }`

Web precedent for the disclosure is already in this package: `wizard/Wizard.tsx:393-475` (`WizardActionsMenu`)
— a trigger carrying `aria-haspopup="menu"` / `aria-expanded` / a localized `aria-label`, a `role="menu"` of
real `role="menuitem"` buttons, Escape-to-close and an outside-click backdrop, with no new dependency. Reuse
that shape; do not invent a second menu idiom. `actions/MoreActionsMenu.tsx` / `.native.tsx` is the existing
web+native **pair** of that idiom and is the better extraction target.

_Tradeoff, stated plainly_: this adds one tap to the manual-create path, which is today's primary path. The
alternative — a second pinned control — was rejected because the list file already records why. If the owner
prefers to protect manual-create, the fallback is E2 alone plus a header-level "Import" text button on the
list surface (secondary weight, not a FAB). See **Open question 8**.

**E2 — the true-empty state carries both CTAs inline (no menu).**
`RecipeList.tsx:53-74` already branches empty vs. narrowed-empty vs. community and renders one CTA. A user
with zero recipes is precisely the import audience (spec US1: "importing removes the single largest barrier to
onboarding"). Render **two** CTAs there: primary `Create a recipe`, secondary `Import recipes`. No menu — an
empty state should not hide its second option behind a disclosure. The narrowed-empty and Community branches
are unchanged (you never create or import into someone else's list — the `onCommunity` rule at
`RecipeList.tsx:62`).

**E3 — a resumable "imports in progress / drafts" entry.**
Drafts expire in 7 days (FR-018) and bulk imports outlive the surface that started them. Without a way back,
a user who navigates away has abandoned the work. The import landing surface (`/recipes/import`) therefore
shows, above the method chooser, a **compact resume strip** when the viewer has any open draft or non-terminal
import job: "N recipes waiting for review" → the draft list. This is a read off the durable projection
(FR-050), so it is correct without any live stream.

**E4 — no new nav destination, no new Home widget.**
`features/core/src/homeNavigation.ts` owns a closed six-destination model shared by the web sidebar, the web
mobile nav, and the native tab bar; adding a seventh is a cross-platform product change wider than 004 and is
not requested by any FR. Import lives under the `recipes` destination. (If the owner wants Home-level
promotion, that is **Open question 8**.)

**Routing / registry work implied (web)**: `SHELL_SURFACE_IDS` gains `recipeImport`, `recipeImportDrafts`,
`recipeImportDraft` — each then _forces_ a localized title via `Record<ShellSurfaceId, string>`
(`shellSurfaces.ts:15-40`). **Mobile**: `RecipesScreen`'s `Surface` union gains
`{ id: 'import' }`, `{ id: 'importProgress'; importId }`, `{ id: 'importDrafts'; importId? }`,
`{ id: 'importDraft'; draftId }` — a closed union, so a screen without a render arm is a compile error
(`RecipesScreen.tsx:182-263` is an exhaustive `switch` with no `default`).

---

## Method chooser

### What it presents

One surface (`/recipes/import`, mobile `import`), single column, with:

1. **A heading and one sentence of orientation** stating the model up front: _every method produces a draft you
   review before anything is added to your recipes._ This is not decoration — the draft-and-confirm model is
   the feature's load-bearing behaviour (spec, "The draft-and-confirm model"), and a user who does not know it
   will read the async progress screen as "it already imported 1,000 things I did not check."
2. **The resume strip** (E3) when applicable.
3. **One row per method**, in a list. Four methods, always all four present:

| Method         | `sourceType` (FR-011)            | What it takes                   | 004 status                                             |
| -------------- | -------------------------------- | ------------------------------- | ------------------------------------------------------ |
| From a link    | `imported_public` (server-set)   | a public recipe page URL        | **Available**                                          |
| From a file    | `user_created` (FR-011)          | JSON / YAML / Markdown, ≤ 1,000 | **Available**                                          |
| From a photo   | `imported_physical` (server-set) | a photo of a physical recipe    | **Unavailable — not built yet** (011; ADR-0019 §3)     |
| From Instagram | `imported_public` (server-set)   | a public post with recipe text  | **Unavailable — not enabled** (capability flag, D-002) |

Each row carries: the method name (the accessible name), one line describing the input format, and — when not
available — the reason. **No row is a link to a format-guessing input**: selecting a row routes to a surface
built for that input, which declares `sourceType` to the endpoint (ADR-0019 §2, FR-047).

### How availability is modelled (and why not a boolean)

Availability has **three** meaningfully different renderings, so it must be a discriminated union, not a
boolean — the same shape decision `hooks/ingredientResolver.model.ts:224-244` makes for the picker's view
state, and the same "resolve, never drop" doctrine as `features/core/src/homeNavigation.ts:59-80`:

```
available            → a real interactive control that routes to the method's surface
unavailable(reason)  → non-interactive, still FOCUSABLE, accessible name "{Method}, {reason}"
upgradeRequired      → interactive, but routes to the upgrade path — NOT to the import surface
```

Put the derivation in a **pure** function in `import/model.ts`
(`resolveImportMethods(sources, entitlement): readonly ResolvedImportMethod[]`), mirroring
`resolveHomeNav(liveCapabilities)` (`homeNavigation.ts:71-80`) and unit-tested independent of React. The render
leaves (`ImportMethodChooser.tsx` / `.native.tsx`) then contain **no branching logic beyond an exhaustive
switch** — the pure-render-component rule in `CLAUDE.md`.

### How "unavailable" reads

Reuse the shipped treatment verbatim rather than inventing one:

- Web: a focusable, non-interactive element with `aria-disabled` and
  `aria-label={`${label}, ${reasonSuffix}`}` — `web/src/components/home/chrome/HomeSidebar.tsx:95-105`
  (which also documents _not_ conveying the state by dimming text alone) and `HomeTabBar.tsx:65-68`.
- Native: `aria-disabled` + `accessibilityLabel={`${label}, ${reasonSuffix}`}` on a `View` (never a `Pressable`
  with a no-op `onPress`) — `mobile/src/components/home/chrome/HomeTabBar.tsx:69-80`.
- The reason is **visible text**, not colour or opacity alone (NFR-004, and `PlaceholderWidgetCard`'s rationale
  at `web/src/components/home/skeletons/PlaceholderWidgetCard.tsx:29`: a coming-soon state must be
  distinguishable from a stuck-loading state).

Two distinct reasons, two distinct strings — do not collapse them into one "coming soon":

- **Photo** — _not built yet_. Honest, and it is exactly ADR-0019's accepted cost ("The chooser must present
  that honestly rather than offering a method that does nothing"). Copy intent: names the capability, does not
  promise a date.
- **Instagram** — _not enabled here_. It is a configuration/credential state (D-002), not an unbuilt feature.

**The premium case is different from both** and must not be flattened into them: FR-028 requires a _distinct_
machine-readable refusal so the client can present the **upgrade path**, which is an action, not a dead row.
`upgradeRequired` therefore stays interactive. (Whether that path exists today is **Open question 2**.)

### Relationship to "create a recipe"

They are siblings under one add-affordance (E1), not nested. The distinction the copy must make is
_authorship_: **create** = you write it; **import** = we extract it and **you confirm it**. The chooser never
offers "create manually" as a fifth method — but note FR-014a's attested paste-and-cite flow may be exactly
that, which the spec leaves unresolved (**Open question 3**).

---

## Per-method surfaces

Both surfaces follow the shipped orchestration/render split: a container in the app owns the mutation and
navigation; the feature package ships a **controlled, presentational** leaf pair, like
`list/RecipeList.tsx` ("It fetches nothing; the composing app wires `useRecipes` … to these props",
`RecipeList.tsx:1-7`) and `photos/RecipePhotoManager.tsx` (which takes the platform file input as an
`addControl` prop rather than owning acquisition, `RecipePhotoManager.tsx:41-52`).

### A. From a link (`ImportUrlForm`)

**Contents** — one labelled URL field, one primary action, and a small note stating what happens next ("we'll
fetch it, then show you a draft to review"). Nothing else on the screen. The URL field is the only input, so
it takes autofocus on web and `autoFocus` on native.

**Client-side validation (the only checks the client owns)**

- non-empty after trim;
- parses as an absolute `http`/`https` URL.

**The client must NOT** duplicate the paywalled-source blocklist (FR-014), `robots.txt` policy (FR-023), or the
SSRF/redirect guard (NFR-007). Those are server policy with an admin-managed lifecycle — a client copy would
be a second authority that drifts the day an admin adds a domain. The client's job is to render the returned
code.

**States** (each becomes a component test):

| State               | What renders                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| idle                | empty field, primary disabled-by-emptiness (still focusable and named)                             |
| invalid input       | inline field error, `aria-invalid`, submit blocked, error text in `role="alert"`                   |
| submitting          | primary busy (`aria-busy`), field read-only, no double-submit (the `Idempotency-Key` is per press) |
| queued / processing | the async job's live status (see next section) — a `202` job, not a result                         |
| duplicate found     | **a success, not an error** (FR-008): shows the existing public recipe with _View_ and _Clone_     |
| failed (typed code) | `ImportErrorState` — one distinct message + next step per code                                     |
| succeeded           | routes to the draft review; focus moves to the review heading                                      |

**Error copy intent** (final strings are `cs-1`/`tw-1`'s; these are the _intents_, one per code from
`plan.md`):

| Code                          | Says                                 | Offers                                                         |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `IMPORT_SOURCE_BLOCKED`       | this site is not importable, and why | the attested paste-and-cite path (FR-014a), if it ships        |
| `IMPORT_SOURCE_UNREACHABLE`   | we could not reach the page          | retry (transient), and check the link                          |
| `IMPORT_NO_RECIPE_FOUND`      | the page has no recipe we can read   | try the file channel, or create manually — never a bare "fail" |
| `IMPORT_QUOTA_EXCEEDED`       | you've hit today's import allowance  | **the reset time** (FR-022 requires it) — never "try later"    |
| `IMPORT_REQUIRES_PREMIUM`     | this method needs premium            | the upgrade path (FR-028), never a generic auth error          |
| `IMPORT_PROVIDER_UNAVAILABLE` | the service is degraded right now    | retry later + the work is not lost                             |

Render every one of them through a single `ImportErrorState` leaf whose input is the **code union**, with an
exhaustive `switch` — so adding a code without a branch is a compile error (this is the same Visitor-by-TS
intent ADR-0019 §1 names, and it is what tasks.md T-024 already asks for).

### B. From a file (`ImportFilePicker`)

**Contents** — the platform file control supplied by the container as a prop (the `addControl` seam,
`RecipePhotoManager.tsx:41-52,220-229`), the **limits stated before selection** (accepted formats; the 1,000-recipe
cap from FR-026), the chosen file's name and size once picked, and one primary action.

Derive the limits from **one shared constant**, never a second literal in copy — the precedent is
`photos/messages.ts`'s `formatHint` with `{maxMb}` filled from `MAX_RECIPE_PHOTO_UPLOAD_MB`
(`photos/messages.ts:36-38`, `RecipePhotoManager.tsx:224-226`).

**Format authority**: FR-019 says the server determines type by **content inspection (magic bytes)**, never the
filename or client MIME type. The client's `accept` attribute is therefore a **convenience filter only**; the
UI must not tell the user a file is valid, and must render `IMPORT_UNSUPPORTED_FORMAT` from the server as the
authoritative answer.

**States**:

| State                | What renders                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| idle (no file)       | limits + picker; primary inert                                                                                             |
| file chosen          | file name (wrapping, see mobile §), size, _Change file_, primary enabled                                                   |
| submitting           | primary busy; picker disabled                                                                                              |
| parsed → 1 draft     | routes straight to draft review (the single-recipe case must not detour through a bulk screen)                             |
| parsed → N drafts    | routes to the bulk surface (below)                                                                                         |
| too large / too many | `IMPORT_PAYLOAD_TOO_LARGE` — must state the actual limit (FR-026 "rejecting a larger file with an explicit limit message") |
| unsupported format   | `IMPORT_UNSUPPORTED_FORMAT` — names the three supported formats                                                            |
| partial parse        | N drafts created **and** M records unreadable — both counts shown; a failure of one must not discard the others (FR-026)   |
| quota exceeded       | `IMPORT_QUOTA_EXCEEDED` with reset time                                                                                    |

Note the asymmetry that the design must not hide: **file import is synchronous** (`201`, `plan.md:215`), so its
"progress" is not a job — the asynchronous part is the _confirm_ and the _ingredient resolution_ downstream.
The URL channel is the reverse (`202` job → draft). One shared status component must handle both, keyed off
the entity-status model, not off which channel started it.

---

## Bulk & async status

This is the hardest surface, and the design principle is one sentence:

> **Render a bounded summary derived from a durable read; drill down on demand; never a 1,000-row live feed.**

ADR-0019 §4/§5 make this achievable: messages supersede per entity (so the live view is bounded), and the
status is readable from the database at any time (so the first paint never waits for a stream).

### The three moments

**At ~3 seconds** — the surface shows:

- A **heading naming the import** ("Importing 1,000 recipes from `cookbook.json`").
- A **determinate progress control**: `role="progressbar"` with `aria-valuemin=0`, `aria-valuemax=1000`,
  `aria-valuenow`, and an `aria-valuetext` carrying localized prose ("312 of 1,000 processed"). The denominator
  is known for a file import (the record count) — use it. For a URL job the count is 1 and the control is
  indeterminate; say "Working…" with `accessibilityRole="progressbar"` + label, the pattern already shipped at
  `mobile/src/components/LoadingState.tsx:40` and `versions/VersionPreviewModal.native.tsx:74`.
- **Four counters, as text**: queued · processing · succeeded · failed — the exact stage vocabulary of
  ADR-0019 §4 (`errored` folds into the failed counter _visually_ but keeps its own reason copy, since the
  user's next step differs: expected failure vs. unexpected fault).
- **An explicit "you can leave" affordance**: the import continues server-side and this screen is resumable
  (E3). Without it the user is held hostage by a progress bar for a long job.
- **No list of 1,000 rows.** A collapsed "View details" disclosure only.

**At ~30 seconds** — identical structure, counters advanced. Two additions:

- Recipes that have already reached `succeeded` become **linkable as they land** (progressive completion),
  because they are real recipes now — but they appear inside the _details_ disclosure, not as a growing feed on
  the summary.
- If a `processing` entity has been in flight beyond a threshold, the surface says so once ("still working on
  N") rather than silently looking stalled. It must never _imply_ failure from slowness.

**On partial failure (990 succeeded, 10 failed)** — the terminal state is neither success nor failure, and the
UI mirrors the `207 Multi-Status` semantics the plan already chose (`plan.md:228-231`):

- Headline states **three** outcomes, not two — FR-027's vocabulary: **created**, **already existed**,
  **failed**. "Already existed" is explicitly _not_ a failure (FR-027) and must read as an informational
  outcome that links to the existing recipe. Collapsing it into failure is the single most likely
  misimplementation here.
- The default drill-down view is **filtered to the failures** — the only actionable set — with a control to
  show all outcomes. Ten rows, not a thousand.
- Each failure row carries: the recipe title, or the source record's index/raw line when extraction never got a
  title; the reason (mapped from the code); and a per-row action.
- **Retry is offered only where it can succeed.** Reuse the queue's `retryable` discriminator rather than
  branching on `status === 'failed'` — `photos/RecipePhotoManager.tsx:186-203` documents exactly why: a
  client- or format-rejected item re-runs the same check and re-fails, so Retry there is a dead affordance.
  A record that failed on `IMPORT_UNSUPPORTED_FORMAT` gets _Edit as draft_ or _Discard_; one that failed on
  `IMPORT_PROVIDER_UNAVAILABLE` gets _Retry_.
- A bulk **"Retry all retryable (N)"** action, counting only the retryable subset.
- The 990 successes are summarised, and the surface offers the natural next step — _Review N drafts with gaps_
  (FR-026: gapless drafts are bulk-confirmable; drafts with gaps are surfaced individually).

### Live status without noise

**One reduction, pure, shared.** Put the message reducer in `import/status.model.ts` as pure functions —
mirroring `hooks/ingredientResolver.model.ts`'s `deriveViewState` (a discriminated union derived from raw
facts, unit-testable with no React):

- `applyStatusMessage(state, message)` — keyed by entity id; **ignores any message whose sequence is ≤ the held
  sequence** (ADR-0019 §4: supersession is by monotonic sequence, never arrival order; FR-051: ingestion is
  idempotent). This is the client half of the same rule, and it is what stops a redelivered `processing` from
  reverting a terminal `succeeded` in the UI.
- `deriveImportViewState(entities)` — returns `{ kind: 'queued' | 'processing' | 'partial' | 'succeeded' |
'failed' }` plus the bucket counts. The leaves render an exhaustive switch and nothing else.

**Connecting mid-import.** First paint comes from the **read**, not the stream (FR-050 / ADR-0019 §5). So the
surface's `loading` state is a query load, and a client that connects late, or reconnects after a drop, is
correct immediately. The stream only makes it _live_. If the delivery service (014) is unavailable or not yet
shipped, fall back to the **self-limiting poll** already in the client — `useIngredientStatus`'s
`refetchInterval` that returns a cadence while non-terminal and stops on terminal
(`packages/clients/recipe-service/src/hooks.ts:300-319`), with `usePollIngredientStatus`
(`features/recipes/src/hooks/usePollIngredientStatus.ts`) as the shape to copy. The UI must not distinguish
the two transports — that is the headless hook's business.

**Announcement policy (the anti-noise rule).** Per-entity churn must never reach the screen reader:

- Exactly **one** live region per import surface: the **summary**, `role="status"` / `aria-live="polite"`
  (native `accessibilityLiveRegion="polite"`, precedent `mobile/src/components/home/HomeWidgetErrorNotice.tsx:47`).
- It announces on **bucket-count change, throttled** (no more than roughly once per 10 s) and **always on
  terminal**. It does not announce per row.
- Per-row status changes are **not** in a live region.
- A whole-import failure, or quota refusal, uses `role="alert"` (native `accessibilityRole="alert"` +
  `accessibilityLiveRegion="assertive"`, precedent `photos/RecipePhotoManager.native.tsx:70`).
- The live region **must carry visible content**, not just an `aria-label` — `RecipePhotoManager.tsx:62-65`
  documents the failure: an empty `role="status"` node is zero-height, so it shows nothing and announces
  nothing.

**Rendering 1,000 rows.** Native: `FlashList` v2, **no** `estimatedItemSize` (v2 auto-measures) — the
convention already in `list/RecipeList.native.tsx:7-10`. Web: the recipe grids are plain DOM
(`RecipeList.tsx:80-88`); do **not** add a windowing dependency for this. Paginate the draft/outcome list
server-side — the drafts are database rows (FR-050 makes them readable) and the default view is the ≤N failures
anyway. If a full 1,000-row web view is genuinely required, that is a new dependency decision, not a UI detail.

### A recipe whose ingredients are still resolving

FR-020 is explicit: an unresolved ingredient **must not block confirmation**. So:

- The recipe is created, navigable, and complete. Nothing is gated on resolution.
- Each unresolved ingredient line carries a **per-line badge**, text + icon, never colour alone (NFR-004) —
  the same vocabulary already shipped for `FoodResolutionStatus` (`PENDING` → "Resolving…", `RESOLVED` → no
  badge, `UNRESOLVED` → "Needs a match" with a disambiguation action, `NOT_FOUND`/`FAILED` → a terminal
  badge). The classification helpers exist:
  `hooks/ingredientResolver.model.ts:141-163` (`isTerminalStatus`, `isUnresolvedStatus`, `nextMatchAction`).
- Nutrition that depends on an unresolved line reports itself as **incomplete**, never a fabricated `0` — this
  is already the shipped behaviour and its rationale (`ingredientResolver.model.ts:165-187`).
- The line polls itself to resolution and stops (`usePollIngredientStatus`); the food-side status is readable
  from the shell entry (FR-050), so a reload is correct.

---

## State matrix (surface × state)

Every cell is a required **vitest component test on both leaves** (`.tsx` and `.native.tsx`), per
`CLAUDE.md`'s testing policy: _every_ UI path/state, not just the happy path. "n/a" means the state cannot
occur on that surface and a test asserting its absence is not required.

| Surface                     | loading                                       | empty                                        | populated                    | error                                                                         | gated (premium)                               | disabled / unavailable                           | surface-specific extras                                                                                                                          |
| --------------------------- | --------------------------------------------- | -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Add-affordance menu**     | n/a                                           | n/a                                          | two items                    | n/a                                                                           | n/a                                           | n/a                                              | open / closed; Escape closes; outside-click closes                                                                                               |
| **Method chooser**          | sources query in flight (skeleton, captioned) | no methods available at all (all four gated) | 2 available + 2 unavailable  | sources query failed → retry, and **do not** silently render an empty chooser | `upgradeRequired` row routes to upgrade       | photo = _not built_; Instagram = _not enabled_   | resume strip present / absent                                                                                                                    |
| **URL surface**             | n/a                                           | idle empty field                             | valid URL entered            | each code in the table above                                                  | `IMPORT_REQUIRES_PREMIUM` (if reachable here) | primary inert while field empty                  | submitting; queued; processing; **duplicate found**; succeeded→route                                                                             |
| **File surface**            | n/a                                           | no file chosen                               | file chosen (name + size)    | too-large, unsupported, quota, partial-parse                                  | n/a for `user_created`                        | primary inert while no file                      | submitting; 1-draft route; N-draft route                                                                                                         |
| **Bulk progress**           | first read in flight                          | n/a (an import always has ≥1 entity)         | counters + progressbar       | whole-import errored                                                          | n/a                                           | n/a                                              | queued; processing; **partial (990/10)**; all-succeeded; all-failed; stalled-notice; reconnected-mid-import                                      |
| **Outcome / failure list**  | page load                                     | zero failures (→ "all N imported")           | 10 failure rows              | list fetch failed                                                             | n/a                                           | retry hidden on non-`retryable` rows             | filter = failures / all; "already existed" rows; retry-all busy                                                                                  |
| **Draft list**              | load                                          | no open drafts                               | N drafts, gapless vs. gapped | load failed                                                                   | n/a                                           | bulk-confirm inert when nothing gapless selected | selection state; bulk-confirm in flight; per-draft expiry countdown                                                                              |
| **Draft review**            | draft load                                    | n/a                                          | complete draft               | save rejected; `IMPORT_DRAFT_EXPIRED`                                         | attested paid-source consequence stated       | confirm blocked while required fields missing    | each missing-field permutation; unparsed ingredient line (raw retained, null quantity); low-confidence field (icon **and** text); save in flight |
| **Import error state**      | n/a                                           | n/a                                          | n/a                          | **one test per code** (exhaustive switch)                                     | premium code renders upgrade path             | n/a                                              | —                                                                                                                                                |
| **Attribution block**       | n/a                                           | absent source → renders nothing              | web source; Instagram source | n/a                                                                           | n/a                                           | n/a                                              | unverifiable source rendered as such (FR-017), never hidden                                                                                      |
| **Ingredient status badge** | n/a                                           | n/a                                          | `RESOLVED` (no badge)        | `FAILED`                                                                      | n/a                                           | n/a                                              | `PENDING`; `UNRESOLVED` (disambiguate); `NOT_FOUND`                                                                                              |

Per-surface **Playwright** (web) and **Maestro** (mobile) flows are additionally mandatory for every happy path
(`CLAUDE.md` testing policy): chooser→URL→draft→confirm; chooser→file→bulk→partial-failure→retry.

---

## Mobile / small-screen requirements

The owner reports existing layout flaws (positioning, spacing, layout). These are the concrete, enforceable
rules — each drawn from a defect this repo already fixed, so they are corrections, not preferences.

1. **Design at 360 × 640 first; every import surface is single-column at every width below `lg`.** Method rows
   carry descriptive text, so they must never be a 2-up grid on a phone. (The `grid-cols-2 sm:grid-cols-3`
   pattern at `RecipePhotoManager.tsx:80` is right for square thumbnails and wrong for text rows.)
2. **Touch targets ≥ 44 × 44** on every control, including per-row Retry/Discard in the failure list. Native:
   `minHeight: 44` (`list/RecipeSourceTabs.native.tsx:110-114`, `mobile/src/components/home/chrome/HomeTopBar.tsx:111`,
   `rating/RecipeRatingControl.native.tsx:187`). Web: `min-h-11` at base with `md:min-h-0` restoring desktop
   density (`list/RecipeList.tsx:132-135`).
3. **Safe areas on every pushed surface.** Apply **both** insets via `useSafeAreaInsets`
   (`mobile/src/screens/RecipesScreen.tsx:152-159`), whose comment names the real consequences: the top row
   renders under the status bar, and occluded nodes **drop out of the accessibility hierarchy**, which breaks
   screen readers _and_ Maestro. Web: any pinned control derives its bottom offset as
   `calc(<nav height> + env(safe-area-inset-bottom))` and drops at `lg`
   (`list/RecipeList.tsx:167-171`).
4. **Never more than two buttons in a footer row.** The U6 remediation in `wizard/Wizard.tsx:29-40` exists
   because four filled header buttons wrapped to two rows on a phone. The import surfaces inherit the same
   shape: one contextual primary, at most one secondary, everything else in an overflow disclosure.
5. **Wrap-safe rows.** Long localized labels and long URLs must break, not overflow: web `min-w-0` on the flex
   child + `break-words` (`wizard/Wizard.tsx:357-360,375`), native `flexShrink: 1`. An echoed URL uses
   `break-all` (web) / `numberOfLines` with the full value in the accessible name (native) — a URL is one
   unbreakable token and is the most likely thing to blow out this layout.
6. **The keyboard must not cover the primary action.** The URL screen's primary lives in the scrolled content
   flow or a keyboard-avoiding footer — never a fixed bottom bar. This surface is one field plus one button, so
   there is no reason for it to be pinned.
7. **Bulk lists are virtualized on native** — `FlashList` v2, no `estimatedItemSize`
   (`list/RecipeList.native.tsx:7-10`).
8. **Loading placeholders are motion-free** (`list/RecipeList.native.tsx:52-56`) and captioned with the
   localized label — an uncaptioned skeleton announces nothing. Progress is conveyed primarily by the
   **numeric counter**, which is correct under reduced motion and readable by a screen reader; any spinner is
   decorative (`aria-hidden` / `importantForAccessibility="no"`).
9. **Mobile has no shared sheet primitive.** `features/recipes/src/components/FullScreenSheet.native.tsx` has
   **no web sibling**, so it cannot carry a cross-platform pattern under §14.3. If the add-affordance menu is a
   sheet on mobile and a `role="menu"` popover on web, that is an intentional per-platform _render_ fork over
   one shared model — document it, and give both leaves the same public API (§14.3, §14.4).

---

## Accessibility requirements

Baseline is **WCAG 2.1 AA**, and the spec already binds two of its consequences: NFR-003 (every component
exposes an accessible name queryable via `getByRole`/`getByLabel`) and NFR-004 (colour is never the sole
conveyor of state). Playwright here may use **only** `getByRole`/`getByLabel` — `data-testid` and
`waitForTimeout` are banned (`CLAUDE.md`) — so the accessible names below are **contract**, not decoration:
changing one breaks an e2e test, which is the intended coupling.

### Roles and names, per control

| Control                  | Web                                                                                     | Native                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Add-affordance trigger   | `button`, `aria-haspopup="menu"`, `aria-expanded`, localized `aria-label`               | `Pressable`, `accessibilityRole="button"`, `accessibilityLabel`                   |
| Menu + items             | `role="menu"` / `role="menuitem"` buttons (`Wizard.tsx:441-469`)                        | sheet with `accessibilityRole="menu"`-equivalent items                            |
| Method row (available)   | `button`, name = method name                                                            | `Pressable`, `accessibilityLabel` = method name                                   |
| Method row (unavailable) | focusable, `aria-disabled`, name = `"{Method}, {reason}"`                               | `View`, `aria-disabled`, `accessibilityLabel` = `"{Method}, {reason}"`            |
| URL field                | `<input type="url">` + visible `<label>`; `aria-invalid`; `aria-describedby` → error id | `TextInput` with `accessibilityLabel`, `inputMode="url"`, no autocapitalize       |
| File control             | real `<input type="file">` with a visible label (passed in as `addControl`)             | document picker trigger with an `accessibilityLabel`                              |
| Progress                 | `role="progressbar"` + `aria-valuemin/max/now` + `aria-valuetext`                       | `accessibilityRole="progressbar"` + `accessibilityLabel` (+ `accessibilityValue`) |
| Summary live region      | `role="status" aria-live="polite"`, **with visible content**                            | `accessibilityLiveRegion="polite"` on a `Text` carrying the content               |
| Terminal failure / quota | `role="alert"`                                                                          | `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"`               |
| Per-row action           | name includes the item: "Retry import of {title}"                                       | same, via `accessibilityLabel`                                                    |
| Outcome filter           | `aria-pressed` toggle chips (`RecipeList.tsx:127-155` idiom)                            | same semantics on `Pressable`                                                     |

### Additional requirements

- **Uniqueness.** Every per-row control's accessible name must include its item — the photo queue's
  `{fileName}`-scoped Retry/Remove labels are the precedent (`photos/messages.ts:38-45`,
  `RecipePhotoManager.tsx:195-207`). In a 10-row failure list, ten controls named "Retry" are unqueryable by
  `getByRole` and unusable by a screen reader.
- **State is never colour-only** (NFR-004, WCAG 1.4.1). Every status badge pairs a word with its colour, as the
  photo queue already does (`RecipePhotoManager.tsx:150-180`).
- **Contrast**: read text at 4.5:1, non-text boundaries at 3:1 — and honour the palette split documented in
  `@commise/ui`'s `tokens/colors.ts` (the one authoritative statement), summarised at `wizard/Wizard.tsx:325-327`.
  Placeholder text uses `text-slate`, never `mist` (`RecipeList.tsx:118-120`).
- **Focus management**: on routing chooser → method surface → draft review, move focus to the destination's
  heading (a focusable `h1`/`h2`), and on import completion move focus to the summary. A route change that
  leaves focus on a now-unmounted trigger strands keyboard and screen-reader users.
- **Dismissal**: any menu/sheet closes on Escape **and** on outside click, with the listener scoped to exactly
  the open window (`Wizard.tsx:400-415`). Do not repeat the preview panel's documented gap
  (`Wizard.tsx:193-196`).
- **Localization**: all copy through `useMessages` with a `LocalizedMessages<T>` dictionary in
  `import/messages.ts`, shared by both leaves so the platforms cannot drift (`photos/messages.ts:1-9`).
  Interpolation via `fillTemplate` (`list/model.ts:42-43`); counts via `formatRecipeCount`'s
  `Intl.PluralRules` approach (`list/model.ts:51-70`) — "1,000 recipes" and "1 recipe" are not the same string,
  and number formatting is locale-dependent.
- **An accessibility audit of the built surfaces is still required** — this document specifies intent, it does
  not substitute for running the `accessibility` skill against the implementation.

---

## Open questions for the owner

1. **`GET /import/sources`: omit or annotate?** FR-046 / ADR-0019 §2 require an unavailable method to be shown
   **with its reason**; `tasks.md` T-031/T-019/T-021 require gated channels to be **omitted** from
   `/import/sources` and "never rendered". These cannot both hold — a client cannot render a reason it was not
   sent. _Recommendation_: the endpoint returns **all** methods, each with an availability discriminator and a
   reason code; "no dead affordance" is then satisfied by rendering a non-interactive row, not by hiding it.
   That is a wire-contract change (recipe service authors the zod, ADR-0014) and needs the owner's call.
2. **Is there an upgrade path to route to?** FR-028 wants the client to "present the upgrade path". 010-subscriptions
   has not shipped and entitlement is read from the signed token's `permissions`. What does `upgradeRequired`
   route to today — a real surface, an explainer, or nothing (in which case it degrades to an unavailable row)?
3. **Is attested paste-and-cite a fifth method?** FR-014a / D-003 / US1 scenario 8 describe pasting recipe
   content manually with an attestation and citation, classified `imported_paid`. FR-046 lists only four
   methods. If it is a method, it belongs in the chooser and needs its own surface; if it is a _mode of the
   draft review_, it belongs there. The spec does not say.
4. **Where does bulk confirmation live, and what is preselected?** FR-026 makes gapless drafts confirmable in
   one action and gapped drafts individually reviewable. Is that a control on the bulk progress surface, or a
   separate drafts list? Are all gapless drafts preselected by default (fast migration, but a bulk write the
   user did not individually inspect), or opt-in?
5. **Draft expiry (FR-018, 7 days) — is the user warned?** 004 emits status but 014 owns delivery. Does the
   drafts list show a countdown? What does `IMPORT_DRAFT_EXPIRED` offer as recovery — re-import from the
   retained source URL (possible for the URL channel) or nothing (the uploaded file is gone)?
6. **Does the import UI ship before 014's delivery service?** If yes, the surface is poll-only behind the same
   headless-hook seam (`useIngredientStatus`'s self-limiting `refetchInterval` is the shipped precedent), and
   the live-region cadence should be tuned to the poll interval. Confirm the sequencing.
7. **Is there an imports _history_?** FR-050 makes status readable at any time, but no FR requires a list of
   past imports. Without one, a completed partial-failure result is only reachable while the surface is open —
   which loses the 10 failures the moment the user navigates away. _Recommendation_: at minimum, keep the
   outcome reachable from the drafts entry until every draft is resolved or expired.
8. **Entry-point weighting.** Is the E1 disclosure acceptable (one extra tap on manual create), or should
   import be a secondary header control on the recipe list instead? And does the owner want any Home-level
   promotion (widget or nav destination), which E4 deliberately declines?
9. **Instagram row while the flag is off.** FR-046 says show it with a reason; T-019 says "neither UI offers
   it". Same conflict as (1), but with a different tradeoff: an unavailable Instagram row advertises an
   integration that may never be credentialed. Confirm FR-046 governs.

---

## Follow-on agents

- Interaction/motion detail, transition choreography of the progress surface → `iad-1`.
- Component API, token usage, and the shared-vs-forked leaf split → `dsl-1` and `ux-eng-1`.
- Implementation of the leaves and containers → `fe-1` / `frontend-ux-engineer`; contracts → `be-1`.
- Copy for every state and error code → `cs-1` / `tw-1` (this document specifies **intent**, not final strings).
- Accessibility audit of the built surfaces → the `accessibility` skill.
- Reconciling `tasks.md` T-018/T-019/T-021 to ADR-0019 → `po-1` / `pm-1`.

**Confidence**: High on the repo-grounded patterns, the state matrix, and the accessibility contract (all
traced to shipped files). Medium on the bulk surface's information architecture — no user research exists for
a 1,000-recipe migration in this product, and the 990/10 layout is reasoned from FR-027's outcome vocabulary
rather than from observed behaviour. The cheapest study that would inform it: a 5-participant unmoderated task
on a static prototype of the partial-failure screen, asking "what happened, and what would you do next?" —
recommend `uxr-1`.
