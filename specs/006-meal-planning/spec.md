# Feature Specification: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-04-14
**Last Revised**: 2026-08-02 — full reconciliation against shipped `main` (001 recipe core, 002 auth, 003 food data). The
2026-04/05 draft was written before any of those three shipped and had drifted materially from the codebase; every
requirement below has been re-derived from what actually exists. See **Clarifications (Session 2026-08-02)**.
**Status**: Draft — ready for planning. Not implemented. Phase 1 (FR-022/023/024 + FR-028..FR-041) is implementable
today; Phase 2 (FR-025/026/027) is **blocked** on features 005 and 010 and is deliberately out of the first
implementation scope (see Clarification C-006-009). FR-041 is the Phase-1 obligation that deferral depends on: the
premium surfaces are **unreachable**, not merely unbuilt.
**Input**: Split from `001-commise-recipe-app` — meal plan creation, recipe assignment, nutritional summaries, and
AI-powered meal suggestions.

## Dependencies

| Spec                                                        | Relationship                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required — SHIPPED.** Meal plans reference recipes owned/readable by the planner. 006 consumes `@kitchensink/recipe-service-client` and the pure domain in `@kitchensink/recipe-core`. 006 **requires one additive change to 001** — a batch nutrition projection (see FR-024 and C-006-003).           |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required — SHIPPED.** All meal-planning routes are authenticated. The app-user ULID arrives as a signed session-token claim and is surfaced as `userId` by `@kitchensink/clerk-verify`; 006 stores it as `owner_id` with no local `users` table and no FK (the 001 "D2" pattern).                       |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Indirect — SHIPPED.** 006 does **not** call the food service. Ingredient nutrition is already resolved and denormalized onto recipe ingredient rows by 001; 006 aggregates recipe-level nutrition only. The food service is source-agnostic — "USDA" is one adapter behind it, not an API 006 talks to. |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Required for Phase 2 — NOT BUILT.** FR-025/026/027 cannot be implemented until an AI provider surface exists.                                                                                                                                                                                           |
| [007-grocery-lists](../007-grocery-lists/spec.md)           | **Downstream — NOT BUILT.** Grocery lists are generated from meal plans. 006 exposes a stable read projection for it (FR-036) but does **not** build list generation.                                                                                                                                     |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Downstream — NOT BUILT.** Nutrition plans link to meal plans for compliance.                                                                                                                                                                                                                            |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Required for Phase 2 — NOT BUILT.** Premium entitlement gates FR-025/026/027. Today `subscriptionTier` lives in the identity service's `accounts` table and is **not** a session-token claim, so no entitlement gate can be enforced yet (C-006-009).                                                   |

Cross-feature FR references use the qualified `{feature}-FR-{NNN}` namespace required by
[GR-003](../governance-rules.md#gr-003-fr-identifier-namespace) and are registered in
[`cross-feature-FR-index.md`](../cross-feature-FR-index.md).

## Clarifications

### Session 2026-08-02 — reconciliation with shipped `main`

Every decision below resolves an open question, a contradiction, or a codebase mismatch found in the pre-reconciliation
draft. They are recorded here rather than silently folded into the requirements.

- **C-006-001 — Meal planning is its own platform service, `@kitchensink/meal-plan-service`.** It is not a module inside
  `recipe-service`. Rationale: it is a distinct bounded context with its own lifecycle, and `kitchensink_recipes` is
  already operated on by three scheduled destructive workers (version-archive prune, GDPR erasure sweep, orphan
  deletion) whose blast radius must not widen. It follows the established platform/product split
  (`CODING_STANDARDS §5.1`) and the shipped `recipe-service` topology. Cost is one additional ECS task per stage,
  budgeted explicitly in [plan.md](./plan.md) against the ADR-0008 account budget.
- **C-006-002 — No local `users` table and no cross-database foreign keys.** `owner_id` is the app-user ULID stored as
  `VARCHAR(255) NOT NULL` with no FK, exactly as `recipes.owner_id` does. `recipe_id` is stored as a `uuid` value with
  **no** foreign key, because recipes live in a different logical database (`kitchensink_recipes`). The pre-reconciliation
  draft specified `REFERENCES users(id)` and `REFERENCES recipes(id)`; both are unenforceable here, and the recipe FK
  additionally contradicted the requirement that entries survive recipe removal.
- **C-006-003 — Nutrition is aggregated from recipe-level nutrition, not from ingredients or the food service.** 001
  already persists per-100g macros on recipe ingredient rows and already computes per-serving recipe nutrition as a pure
  function (`@kitchensink/recipe-core/nutrition`) with an `isComplete` partial-data flag. 006 sums
  `recipeNutrition × servings` and propagates partiality. The pre-reconciliation design re-fetched nutrients per
  ingredient from "the USDA API", which would have duplicated a better existing implementation, produced false-precise
  totals with no partial concept, and coupled 006 to a source that 003 deliberately abstracted away.
- **C-006-004 — Fibre is out of scope.** The shipped `RecipeNutrition` carries calories, protein, carbohydrate and fat
  only. The draft's `fiber_g_total` column was unobtainable from any shipped source. Fibre enters when 009 or a recipe-core
  change introduces it, not before.
- **C-006-005 — No cache tier.** Daily and weekly totals are computed by a pure function over values already read for
  the page. The draft specified a Redis-backed summary cache; there is no Redis or ElastiCache in this platform, and
  ADR-0004/0007/0008 exist specifically to keep spend of that shape out. If measurement later justifies a cache it
  requires its own ADR and a costed line item.
- **C-006-006 — "Orphaned entry" means the referenced recipe is no longer readable, detected on read.** No event bus,
  no deletion webhook, no replicated recipe state. 001 deletion is a **soft-delete tombstone** (001-FR-002): the recipe
  stops being readable but no cross-service notification exists or is needed. An entry whose recipe read returns
  not-found renders as orphaned and is excluded from nutrition totals. True hard purge only occurs via a user's own
  GDPR erasure, which also erases that user's meal plans.
- **C-006-007 — The lock / finalize mechanism is dropped.** The draft carried `is_locked`, a lock endpoint and lock UI
  while simultaneously listing "what does locked mean?" as an open question. Its only stated purpose was to freeze a
  plan for grocery ordering, and 007 does not exist. This is a capability for a presumed future need — YAGNI applies.
  It returns, if ever, with 007 and its own requirement.
- **C-006-008 — Templates are in scope (FR-028); recurring schedules and leftover tracking are not.** Templates are a
  projection of a plan the user already has and were designed in the wireframes; recurrence needs a scheduling engine
  and leftovers need a consumption model, neither of which any current requirement drives. This resolves W-001 and
  W-002 from the 2026-05-12 verify report, which were left unresolved for three months.
- **C-006-009 — FR-025/026/027 (AI suggestions, auto-generation, waste optimization) are Phase 2 and deferred.** They
  require 005 (not built) for the AI surface and 010 (not built) for the premium entitlement. Critically, the
  entitlement cannot be enforced today at all: `subscriptionTier` is stored in the identity service's `accounts` table,
  while the session token's `public_metadata` carries only `scopes`/`permissions` — a fact asserted by
  `packages/shared/clerk-verify/src/__tests__/clerkVerify.test.ts`. A guard reading `tier` from the token would deny
  every user. Phase 1 ships the capability seam and no premium surface.
- **C-006-010 — Meal planning ships to web and mobile in the same release.** `CODING_STANDARDS §14.1` is a hard rule and
  names `tasks.md` explicitly. The draft had zero mobile tasks, zero mobile wireframes, and a web-only drag-and-drop
  interaction model. Mobile uses a distinct assignment interaction (FR-034); no waiver is taken.
- **C-006-011 — Home widget: 006 retires the `meal-plan` roadmap placeholder that `main` already ships.** The Home
  widget surface (001-FR-046) already defines `ROADMAP_CAPABILITIES.mealPlanning`, a `'meal-plan'` nav item, and a
  `'meal-plan'` roadmap placeholder at `defaultWeight: 1200`. 006 ships `@commise/features-meal-plan` — the package name
  `packages/apps/commise/features/core/src/roadmapWidgets.ts` already anticipates — and follows that module's documented
  retirement procedure (FR-035).

### Session 2026-08-02 (b) — raised by peer review of `v-model/requirements.md`

- **C-006-012 — A cell holds at most one entry, and a move onto an occupied cell swaps.** The multiplicity rule had
  never been stated, and `plan.md` had rejected a uniqueness constraint on `(plan, date, slot)` citing a permission
  FR-023 did not actually grant ("the same cell to hold repeats" — FR-023 permitted only the same _recipe_ in more
  than one _cell_). Every product artifact says single occupancy: the week grid draws each cell as `+` or exactly one
  card, the empty state is "all cells in the `+` add state", and mobile's flow is "tap an **empty** slot". Single
  occupancy is therefore the rule (FR-023), enforced by a database constraint rather than application code, and
  drop-onto-occupied is a **swap** (FR-023a). Loosening this later (a cell holding a main plus a side) is a constraint
  drop; tightening it later would be a data migration — so the cheap-to-reverse direction is to constrain now. The
  uniqueness constraint does **not** retire the FR-032 idempotency ledger: only the ledger distinguishes a retry from
  a deliberate reassignment, and only the ledger covers multi-row template application.
- **C-006-013 — The Phase-1 obligation for premium features is that they are unreachable, not that they are gated.**
  The constraint "AI features MUST be restricted to entitled subscribers" cannot be verified in Phase 1 — there is no
  entitlement to check (C-006-009) — so as written it was a top-priority requirement nothing could test. The
  enforceable Phase-1 obligation is stated instead as FR-041 (no such surface is reachable), which is inspectable
  today; the entitlement gate itself moves wholly into the Phase-2 baseline. FR-040 likewise makes the feature's
  bounded dependency surface an explicit requirement rather than an omission, and supplies the FR-040 target that
  FR-032 was already citing before it existed.

### Session 2026-08-07 — defects found by implementation against the shipped code

Three gaps that only surfaced once the service, the client and the planner package existed. Each is recorded here
because the previous text was not merely incomplete — it asserted, or implied, something the code contradicts.

- **C-006-014 — The error envelope's `message` is operator-facing and MUST NOT be shown to a user; user copy comes
  from `code`.** `contracts/openapi.yaml` (`ApiError.message`: _"Not localized — user-facing copy is selected
  client-side from `code` via `@commise/i18n` (FR-038)"_) and
  `packages/clients/meal-plan-service/src/errors.ts` (_"Branch on this, never on `message` — FR-038 selects copy from
  it"_) both attribute that rule to FR-038. **FR-038 never said it.** It required localization and forbade hard-coded
  literals, neither of which stops a component rendering a string the _server_ sent. The gap is not theoretical: every
  typed client error carries an English default (`'That meal slot already holds an entry'`,
  `'The meal-plan service did not respond in time'`), and a `catch (e) { show(e.message) }` would pass the FR-038
  literal audit (`noUserVisibleLiterals.test.ts`) with a clean sheet while showing untranslated developer English to a
  non-English user. The rule is therefore stated as **FR-038a** and carried by **REQ-023**, so the two comments above
  now cite something real.
- **C-006-015 — A recipe-service outage MUST NOT be reported to the user as "your recipes are gone".**
  `TemplateSkipReport` declares exactly four counts under `additionalProperties: false`, so
  `MealPlanTemplatesService.resolveReadability` (`packages/services/meal-plan-service/src/templates/meal-plan-templates.service.ts`)
  folds `unavailable` and `degraded` readability into `unreadableRecipe` and writes the true availability only to the
  `warn` log. Fail-closed is right; **reporting** it as a confirmed unreadable recipe is not. In the worst case the
  user applies a template during an outage, receives an empty plan whose report says every entry's recipe is
  unreadable, and concludes their recipes were deleted — the one conclusion that makes them rebuild the template. The
  response MUST distinguish the two, as **FR-028a** / **REQ-024**. _Rejected alternative: refusing the apply with
  `503 DEPENDENCY_UNAVAILABLE`._ It reads cleaner, but it throws away the usable partial result of a `degraded` verdict
  (some ids answered, some did not) and contradicts the standing rule that a template apply always yields the plan the
  user asked for plus a report accounting for every entry. An additive field preserves both.
- **C-006-016 — The plans list is a specified surface, not an implementation detail.** US-006-001 scenario 5 has
  always promised "they see only their own plans, most recent first, paginated", and both sides ship it —
  `GET /api/v1/meal-plans` (`meal-plans.controller.ts`) and `listMealPlans` / `mealPlansInfiniteQuery`
  (`packages/clients/meal-plan-service`) — but **no FR, no REQ and no component-test cell** described the surface, and
  nothing at all said how an owner of two plans reaches the second one. A user with more than one plan had no
  specified route to it. Stated as **FR-022a** / **REQ-025**, with the `Plans list (both)` column added to the
  `STP-010-A` matrix.

## User Scenarios & Testing _(mandatory)_

### User Story 1 (US-006-001) - Create a Meal Plan (Priority: P2)

A user creates a meal plan covering a date range and sees an empty planner grid: one column per day, one row per meal
slot (breakfast, lunch, dinner, snack). They can name the plan, pick its date range, and choose which meal slots the
plan uses — a user who does not plan snacks should not stare at an empty snack row all week.

**Why this priority**: Meal planning turns a recipe box into a daily-use tool. It is the first of the post-001 features
to light up a Home widget, and it is the upstream dependency for grocery lists (007) and nutrition compliance (009).

**Independent Test**: Create a 7-day plan with three meal slots, reload, and confirm the plan persists with the correct
day columns and slot rows and no entries.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they create a plan with a name, a start date, an end date and a set of meal
   slots, **Then** the plan is persisted and rendered as a grid of (day × slot) cells, all empty.
2. **Given** a user creating a plan, **When** the end date precedes the start date, **Then** the request is rejected with
   a validation error naming the offending field, and no plan is created.
3. **Given** a user creating a plan, **When** the range exceeds the maximum supported span (FR-022), **Then** the request
   is rejected with a validation error stating the maximum.
4. **Given** a user with no meal plans, **When** they open the planner, **Then** they see an empty state with a "Create
   your first plan" call to action — not a blank grid and not fabricated sample data.
5. **Given** a user who owns plans, **When** they list them, **Then** they see only their own plans, most recent first,
   paginated.
6. **Given** a user, **When** they request a plan they do not own by its id, **Then** the system responds exactly as it
   would for a plan that does not exist, disclosing nothing about whether it exists.
7. **Given** a user who owns more plans than one page holds, **When** they reach the end of the plans list, **Then**
   the next page loads in place — the list has a distinct in-flight state for it, and no plan appears twice or is
   skipped across the page boundary (FR-022a). _(Added 2026-08-07, C-006-016.)_
8. **Given** a user with a plan already open, **When** they choose another of their plans, **Then** that plan opens
   without their having to navigate back out through Home — the switch is reachable from the open plan itself
   (FR-022a). _(Added 2026-08-07, C-006-016.)_
9. **Given** the plans list fails to load, **When** the user opens it, **Then** they see a localized, retryable error
   — not an empty list, which would read as "you have no plans" (FR-022a, FR-038a).
   _(Added 2026-08-07, C-006-016.)_

---

### User Story 2 (US-006-002) - Assign Recipes to Meal Slots (Priority: P2)

A user fills their plan by assigning recipes to specific (day, slot) cells. On web they drag a recipe from a sidebar
onto a cell; on mobile they tap a cell and pick a recipe from a sheet. They can set how many servings that meal is for,
attach a short note ("omit onions"), move an assignment to another cell, and remove it.

**Why this priority**: An empty plan has no value. Assignment is the core interaction of the feature.

**Independent Test**: Assign seven recipes across a week on web and on mobile, move one, remove one, reload, and confirm
the grid matches on both platforms.

**Acceptance Scenarios**:

1. **Given** a plan and a recipe the user can read, **When** they assign it to a (date, slot) cell, **Then** an entry is
   created carrying the recipe reference, date, slot, servings and optional note.
2. **Given** an assignment attempt, **When** the target date falls outside the plan's range, **Then** it is rejected with
   a validation error and no entry is created.
3. **Given** an assignment attempt, **When** the target slot is not one of the plan's configured slots, **Then** it is
   rejected with a validation error.
4. **Given** an assignment attempt, **When** the referenced recipe is not readable by this user, **Then** it is rejected
   exactly as it would be for a recipe that does not exist.
5. **Given** an existing entry, **When** the user moves it to a different (date, slot) cell, **Then** the entry's
   position updates and no duplicate is created.
6. **Given** an existing entry, **When** the user removes it, **Then** it is deleted and the day's totals recompute; **and
   when** they remove it again, **Then** the request still succeeds.
7. **Given** an entry-creation request that is retried with the same idempotency key, **When** the retry arrives, **Then**
   the original entry is returned and no second entry is created.
8. **Given** the same recipe assigned to two different cells, **When** both are saved, **Then** both persist — repeating a
   recipe across the week is normal use, not a conflict.

---

### User Story 3 (US-006-003) - See Nutrition for the Plan (Priority: P2)

A user viewing a plan sees per-day macro totals and a whole-plan total, derived from the recipes they assigned and the
servings they chose. Where the underlying recipe data is incomplete, the user is told the total is a partial estimate
rather than shown a confidently wrong number.

**Why this priority**: Nutrition is the payoff that distinguishes a meal plan from a calendar, and it is the data 009
builds compliance on.

**Independent Test**: Assign recipes with known macros across two days, verify each day's totals equal the sum of
(recipe per-serving nutrition × entry servings), and verify a recipe with unresolved ingredients marks the day partial.

**Acceptance Scenarios**:

1. **Given** a day with assigned entries, **When** the user views the plan, **Then** that day shows total calories,
   protein, carbohydrate and fat equal to the sum over its entries of the recipe's per-serving nutrition multiplied by
   that entry's servings.
2. **Given** a day where at least one entry's recipe has incomplete nutrition, **When** totals are displayed, **Then**
   the day is marked as a partial estimate, with a label — not colour alone (NFR-004).
3. **Given** a day with no entries, **When** the user views it, **Then** it shows no totals at all — not zeroes, which
   would read as a genuine zero-calorie day.
4. **Given** a plan, **When** the user views its summary, **Then** a whole-plan total is shown, marked partial if any
   contributing day is partial.
5. **Given** an entry whose recipe is no longer readable (orphaned, C-006-006), **When** totals are computed, **Then**
   that entry is excluded and the affected day is marked partial.
6. **Given** a 30-day plan with entries on every day and slot, **When** the user opens it, **Then** nutrition is
   retrieved without one request per entry (no N+1) and within the NFR-006 latency budget.

---

### User Story 4 (US-006-004) - Plan Templates (Priority: P3)

A user who has built a week they like saves it as a template and later applies that template to a new date range,
producing a fresh plan with the same slot assignments shifted onto the new dates.

**Why this priority**: Re-planning from scratch every week is the main reason users abandon meal planners. It is
inexpensive here because a template is a projection of a plan that already exists.

**Independent Test**: Save a populated 7-day plan as a template, apply it to next week, and confirm the new plan carries
the same recipes in the same relative day/slot positions with independent entries.

**Acceptance Scenarios**:

1. **Given** a plan with entries, **When** the user saves it as a named template, **Then** the template records the
   entries by **relative day offset** and slot, not by absolute date.
2. **Given** a template, **When** the user applies it to a new start date, **Then** a new plan is created with entries at
   the corresponding offsets, and editing the new plan does not affect the template.
3. **Given** any template, **When** it is applied, **Then** the new plan's range covers the template's span exactly, so
   no entry can fall outside it — and if the out-of-range count is ever non-zero it is reported to the user rather than
   dropped, because the only way to reach it is a stored template that is already malformed.
4. **Given** a template entry whose recipe is no longer readable, **When** the template is applied, **Then** that entry is
   skipped and reported, and the rest of the template still applies.
5. **Given** a user, **When** they list templates, **Then** they see only their own.
6. **Given** the recipe service is unavailable or answers for only some of the template's recipes, **When** the template
   is applied, **Then** the skipped entries are reported as **not verifiable right now** with a retry, distinctly from
   entries whose recipe is confirmed unreadable (FR-028a). _(Added 2026-08-07, C-006-015.)_

> **Scenario 3 rewritten 2026-08-07.** It used to read _"Given a template whose span exceeds the target range, when it
> is applied, then entries falling outside the new range are omitted and the user is told how many were omitted."_
> **That premise is unreachable through the API.** `ApplyMealPlanTemplateRequest` carries only `startDate` and an
> optional `name` (`packages/services/meal-plan-service/src/templates/meal-plan-templates.dto.ts`), and
> `applyTemplate` derives the range as `[startDate, startDate + spanDays − 1]`
> (`packages/shared/meal-plan-core/src/templateProjection.ts`) — the target range therefore _always equals_ the template
> span, and the caller has no way to make it shorter. `outOfRange` still increments, but only for a `dayOffset` that is
> non-integer or outside `[0, spanDays − 1]`, i.e. a template row that violates its own template's span: a
> data-integrity guard, not a user-facing case. Left as it was, the scenario was an acceptance criterion no test could
> honestly satisfy — the tempting "fix" is a test that constructs the impossible state directly and then proves
> nothing about the product.
>
> **What would make the original premise reachable**, should it ever be wanted: the apply request would have to let the
> caller bound the target independently of the template — an explicit `endDate` (or `spanDays`) on
> `ApplyMealPlanTemplateRequest`, or applying a template _into an existing plan_ rather than always creating a new one.
> Either is an additive contract change plus a rule for which end is truncated; neither is in this release, and no
> requirement asks for one. The pure-function behaviour stays specified and tested (`UTS-006-A3`, `UTS-006-B3`) because
> the conservation property that makes the skip report trustworthy (`UTS-006-C3`) depends on it.

---

### User Story 5 (US-006-005) - Home Widget and Navigation (Priority: P2)

A user who has a meal plan covering today sees "This Week's Meals" on their Home screen showing today's assignments, and
can reach the planner from Home navigation. This replaces the skeleton placeholder that ships today.

**Why this priority**: 001 built the widget surface expressly so each feature lights up its own widget. Shipping the
service without the widget leaves a permanent skeleton on the product's most-visited screen.

**Independent Test**: With the meal-plan capability enabled and a plan covering today, load Home on web and mobile and
confirm the live widget renders today's entries and that the roadmap skeleton no longer appears.

**Acceptance Scenarios**:

1. **Given** the meal-plan capability is live and the user has a plan covering today, **When** they view Home, **Then**
   the Meal Plan widget shows today's entries with recipe names and meal slot. _(Satisfies 001 US-000 scenario 6.)_
2. **Given** the capability is live and the user has no plan covering today, **When** they view Home, **Then** the widget
   renders its own empty state with a call to action — not a skeleton and not another feature's data.
3. **Given** the capability is live, **When** Home renders on web and on mobile, **Then** the widget is present on both in
   the same state (001 US-000 scenario 11).
4. **Given** the capability is **not** enabled, **When** the user views Home, **Then** the widget is absent — the roadmap
   skeleton it replaced has been retired and MUST NOT still be registered (FR-035).
5. **Given** the widget's backing request fails, **When** Home renders, **Then** the widget's error boundary shows a
   recoverable error and the rest of Home still renders.

---

### User Story 6 (US-006-006) - AI Suggestions, Auto-Generation and Waste Optimization (Priority: P4 — **Phase 2, deferred**)

A premium user asks the system to suggest a recipe for a slot, to generate a whole draft plan from constraints, or to
rearrange a plan to reuse overlapping ingredients and reduce waste.

**Status**: **Deferred — not in the Phase 1 implementation scope.** Blocked on 005 (AI provider surface) and 010
(premium entitlement). See C-006-009. Requirements FR-025/026/027 remain specified so the cross-feature index and 010's
entitlement work stay anchored, but no task in this feature's `tasks.md` implements them, and no premium surface ships.

**Acceptance Scenarios**: deferred with the story. They will be written against 005's actual provider contract and 010's
actual entitlement mechanism rather than guessed at now — the previous draft guessed, and guessed wrong about where the
tier is stored.

---

### Edge Cases

- **Plan spanning a daylight-saving transition or crossing a month/year boundary.** Dates are calendar dates, not
  instants; a plan MUST contain the same number of day columns regardless of DST (FR-037).
- **A user in a locale whose week starts on Monday vs. Sunday.** The week view MUST honour the locale's first day of
  week rather than hard-coding one (FR-037).
- **Very large plans (30+ days).** Bounded by FR-022's maximum span; nutrition must not degrade into per-entry reads
  (US-006-003 scenario 6, NFR-006).
- **An entry's recipe becomes unreadable between assignment and viewing.** Resolved by C-006-006 / FR-033.
- **A recipe's nutrition changes after assignment.** Totals are computed at read time from current recipe nutrition, so
  the plan reflects the recipe as it is now. Nutrition is never snapshotted onto the entry — a snapshot would silently
  go stale and there is no requirement for historical fidelity.
- **Two devices editing the same plan concurrently.** Entry operations are independent row-level writes; last write wins
  per entry, and no plan-level optimistic-concurrency token is introduced (unlike 001-FR-007c, there is no
  whole-document save here to conflict).
- **Two devices assigning to the same empty cell at once.** FR-023's uniqueness constraint makes this a race the
  database settles: one insert wins, the other MUST surface as "that slot was just filled" and re-render the cell,
  never as a generic failure and never by silently overwriting the winner.
- **A move whose target cell is occupied.** FR-023a's swap. Both row updates MUST occur in one transaction — a
  half-applied swap would either lose an entry or momentarily violate the uniqueness constraint.
- **A retried assignment after a network drop.** Resolved by FR-032 (idempotency). The uniqueness constraint is
  defence in depth, not the mechanism: it stops a duplicate row, but only the idempotency ledger can tell a _retry_
  of an assignment from a _deliberate reassignment_ of the same cell, and only the ledger covers the multi-row
  template application.
- **A user erases their account (001 C-007).** Their meal plans and templates are erased with their recipes (FR-039).

## Requirements _(mandatory)_

### Functional Requirements

FR-022 through FR-027 retain their original identifiers — `006-FR-025`, `006-FR-026` and `006-FR-027` are referenced by
[010-subscriptions](../010-subscriptions/spec.md) via the cross-feature index and MUST NOT be renumbered. FR-028 onward
are added by this reconciliation.

**Meal plan lifecycle**

- **FR-022**: System MUST allow an authenticated user to create meal plans over a calendar date range with a
  user-selected subset of meal slots (`breakfast`, `lunch`, `dinner`, `snack`). The range MUST be validated: end date on
  or after start date, and span no greater than **90 days**. At least one meal slot MUST be selected. Plans are private
  to their owner; there is no sharing model in this feature.
- **FR-022a**: System MUST provide, on **both** platforms, a plans surface listing the owner's plans newest-first with
  **keyset** pagination (never offsets), from which the owner opens a plan; and MUST make switching from an open plan to
  another of the owner's plans reachable **from the open plan itself**, without navigating back out through Home. The
  surface MUST distinguish its own states: loading, no plans at all (the "create your first plan" call to action of
  US-006-001 scenario 4), populated, the next page loading, and a load failure — a failure MUST NOT render as an empty
  list, which asserts the false fact that the user has no plans. _(Added 2026-08-07, C-006-016: the endpoint and the
  client have always shipped; the surface and the switch were unspecified, leaving an owner of two plans no stated route
  to the second.)_
- **FR-023**: System MUST allow the owner to assign a recipe to a (date, meal slot) cell within the plan's range,
  recording servings (**1–99**, default 1) and an optional free-text note. Assigning the same recipe to more than one
  cell MUST be permitted. A cell MUST hold **at most one entry** — the grid renders each cell as either the `+` add
  affordance or exactly one card, and mobile's flow is "tap an **empty** slot", so a second occupant is a state no
  surface can present; single occupancy MUST be enforced by a database uniqueness constraint on
  `(plan, date, slot)`, not by application code alone. The referenced recipe MUST be readable by the requesting user
  at assignment time, verified against the recipe service; an unreadable or non-existent recipe MUST produce an
  identical not-found response, disclosing nothing.
- **FR-023a**: System MUST allow the owner to move an entry to another cell within the plan's range, and to remove an
  entry. Because a cell holds at most one entry (FR-023), moving onto an **occupied** cell MUST **swap** the two
  entries in a single atomic operation rather than overwriting or rejecting: the wireframes' recovery discipline is
  that a user's placement is never silently discarded, and a rejection would leave the drag with no outcome the grid
  can show. Both entries keep their own servings and note.
- **FR-024**: System MUST expose per-day and whole-plan nutrition totals (calories, protein, carbohydrate, fat) for a
  plan, computed as the sum over entries of the referenced recipe's **per-serving** nutrition multiplied by the entry's
  servings. Totals MUST carry a completeness flag that is false when any contributing entry could not be fully
  accounted — an unreadable recipe, or a recipe whose own nutrition is incomplete — and the UI MUST present an
  incomplete total as a partial estimate. A day with no entries MUST report **no** totals rather than zeroes. The
  computation MUST NOT issue one request per entry; it depends on an additive batch nutrition projection added to the
  recipe service (001), specified in [plan.md](./plan.md) §API Contracts.

**Premium / AI — Phase 2, deferred (C-006-009)**

- **FR-025**: System MUST provide AI-powered meal suggestions for a slot based on user preferences, dietary needs and
  the user's readable recipes. _(Premium — deferred, blocked on 005 + 010.)_
- **FR-026**: System MUST provide auto-generation of a complete draft meal plan from user-defined constraints, presented
  for review before it is applied. _(Premium — deferred, blocked on 005 + 010.)_
- **FR-027**: System MUST provide food-waste optimization that proposes recipe rearrangements or swaps maximising shared
  ingredient usage across the plan. _(Premium — deferred, blocked on 005 + 010.)_

**Templates**

- **FR-028**: System MUST allow the owner to save an existing plan as a named template and to apply a template to a new
  start date, producing an independent new plan. A template MUST record entries by **relative day offset and slot**,
  never by absolute date. Applying a template MUST skip entries that fall outside the target range or whose recipe is no
  longer readable, and MUST report the number skipped for each reason. Templates are private to their owner.
- **FR-028a**: When applying a template, the system MUST distinguish an entry skipped because its recipe is **confirmed
  unreadable** from one skipped because readability **could not be determined** — the recipe service was unavailable, or
  answered for only part of the batch. Skipping in both cases is correct (fail closed, FR-023); **reporting** them
  identically is not, because "your recipe is gone" and "we could not check just now" call for opposite user actions —
  rebuild the template, versus retry it. The apply response MUST therefore carry the readability availability
  alongside the skip counts, and the UI MUST present an unverifiable skip as retryable rather than permanent.
  _(Added 2026-08-07, C-006-015.)_

**Planning semantics**

- **FR-029**: System MUST scope every read and write to the authenticated owner. A plan, entry or template belonging to
  another user MUST be indistinguishable from one that does not exist.
- **FR-030**: System MUST treat `servings` on an entry as the number of servings that meal is planned for, and MUST use
  it as the multiplier for that entry's nutrition contribution (FR-024) and for the downstream grocery projection
  (FR-036). It is the feature's family-sizing mechanism; no separate household-size model is introduced.
- **FR-031**: System MUST allow an optional per-entry note of bounded length, stored and returned verbatim, and never
  interpreted as instructions by any downstream process.
- **FR-032**: System MUST accept an `Idempotency-Key` header on entry creation and on template application, and MUST
  return the original result for a repeated key rather than performing the action twice. A key MUST remain
  replayable for **24 hours** from first use; beyond that window the request is treated as new. Expired records MUST be
  removed **without a scheduled job, worker or any added infrastructure** — the feature ships none (FR-040).
- **FR-033**: System MUST render an entry whose referenced recipe is no longer readable as **orphaned**: the entry
  persists and remains visible and removable, is labelled as unavailable with text (not colour alone), and is excluded
  from nutrition totals while marking the affected day partial. Orphan state MUST be determined at read time from the
  recipe service's response; the system MUST NOT replicate recipe state or depend on a deletion notification.

**Presentation**

- **FR-034**: System MUST ship the planner on **both** web and mobile in the same release. Web MUST support assignment by
  pointer drag-and-drop **and** by an equivalent keyboard-accessible control; mobile MUST provide a tap-to-assign
  interaction (cell → recipe picker sheet) rather than drag-and-drop. Both platforms MUST expose the same set of
  operations, and shared logic MUST live in shared packages per `CODING_STANDARDS §14.2`.
- **FR-035**: System MUST replace the Home `meal-plan` roadmap placeholder with a live widget contributed by
  `@commise/features-meal-plan`, following the retirement procedure documented in
  `packages/apps/commise/features/core/src/roadmapWidgets.ts` — remove the `meal-plan` entry from `ROADMAP_WIDGET_SPECS`
  and remove each app's corresponding skeleton, in the same change that registers the live descriptor. Because
  `RoadmapWidgetId` is a literal union consumed by an exhaustive per-app skeleton map, a partial retirement MUST fail
  `typecheck` rather than review. The widget MUST render today's entries, its own empty state, and a recoverable error
  state, and MUST be gated on `ROADMAP_CAPABILITIES.mealPlanning`.
- **FR-036**: System MUST expose a stable read projection of a plan suitable for downstream consumption by 007 and 009 —
  entries with recipe reference, date, slot and servings — versioned additively. 006 MUST NOT implement grocery-list
  generation or nutrition-plan compliance; it provides the data those features read.
- **FR-037**: The planner MUST treat plan dates as calendar dates (ISO 8601 `YYYY-MM-DD`), never as instants, so that a
  plan's day count is unaffected by time zone or daylight-saving transitions. Week grouping MUST honour the active
  locale's first day of week.
- **FR-038**: Every user-facing string in the planner, the widget and their error states MUST be localized through
  `@commise/i18n`; no hard-coded user-visible literals.
- **FR-038a**: The service's error envelope carries a `message` that is **operator-facing** — for developers, logs and
  incident triage — and it MUST NOT be rendered to a user on either platform. User-facing copy for a failure MUST be
  selected from the envelope's stable `code` through `@commise/i18n`, and an **unrecognized** `code` MUST resolve to a
  localized generic failure message, never to the wire `message` as a fallback. _(Added 2026-08-07, C-006-014. This rule
  was already asserted in `contracts/openapi.yaml` and in the meal-plan client's JSDoc and attributed to FR-038, which
  does not state it: FR-038 governs literals in our own source, and the wire `message` is neither a literal nor ours.
  Without this FR nothing forbade a client showing untranslated developer English to a non-English user, and the
  FR-038 literal audit would not have caught it.)_
- **FR-039**: A user's meal plans, entries and templates MUST be erased when that user erases their account
  (001 C-007). 006 MUST participate in the existing account-erasure mechanism rather than introducing a second one.

**Bounded dependency surface**

- **FR-040**: The feature's runtime dependency surface MUST be exactly the recipe service (001) and Clerk session
  verification (002). It MUST NOT introduce a cache tier, queue, worker or object store — the platform runs none and
  the cost posture (ADR-0004/0007/0008) does not admit one — and it MUST NOT call the food service (003): 003 is
  source-agnostic and its data is denormalized onto recipe rows by 001 long before 006 reads it (C-006-003, C-006-005).
  This is the FR that FR-032's pruning clause depends on.
- **FR-041**: No AI suggestion, auto-generation or waste-optimization surface (FR-025/026/027) may be **reachable** in
  Phase 1 — not as a disabled control, a feature-flagged route, or an API endpoint. The premium entitlement those
  features require cannot be enforced on the current platform (C-006-009), so the Phase-1 obligation is that they do
  not ship at all rather than ship ungated. This is verifiable today; the entitlement gate itself is not.

### Non-Functional Requirements _(constitution-derived, v1.3.0)_

- **NFR-001**: All TypeScript MUST compile under `strict: true`; no `any`, no `@ts-ignore`/`@ts-expect-error` outside
  explicitly marked test doubles. _(Principle I)_
- **NFR-002**: All exported functions, types and interfaces MUST carry JSDoc; every module MUST carry a module header
  naming the design pattern it implements. _(Principle II, `CLAUDE.md` design-pattern-first)_
- **NFR-003**: Every UI element MUST expose an accessible name queryable via `getByRole`/`getByLabel`; `data-testid` and
  `page.waitForTimeout()` are banned in Playwright specs. Drag-and-drop MUST have a keyboard-operable equivalent.
  _(Principles IV & VII)_
- **NFR-004**: Colour MUST NOT be the sole conveyor of state; partial-nutrition, orphaned-entry and premium-gated states
  MUST each pair colour with an icon or text label. _(Principle VII)_
- **NFR-005**: Tests are written **before** the code they cover (TDD red → green), and every category in
  `CODING_STANDARDS §7.1` that this feature touches MUST have passing tests of every required kind — component tests for
  every UI state, Playwright per web story, Maestro per mobile story, unit **and** integration for non-UI code, plus e2e
  and k6 for the service. _(Principle IV; `CLAUDE.md` testing policy)_
- **NFR-006**: Reading a 30-day plan with nutrition MUST complete within a p95 of 500 ms server-side and MUST issue a
  bounded number of downstream requests independent of entry count. _(Principle I; matches 001's API budget.)_
- **NFR-007**: Web and mobile MUST reach feature parity in the same release; shared logic lives in shared packages and
  platform variants use the `.native.ts(x)` suffix. _(Principle VIII, `CODING_STANDARDS §14`)_

### Key Entities

- **Meal Plan** — a named, owner-scoped planning surface over a calendar date range with a selected set of meal slots.
  Owns its entries.
- **Meal Plan Entry** — one recipe assigned to one (date, meal slot) cell of a plan, with servings and an optional note.
  References a recipe by id across a service boundary; carries no copy of recipe data.
- **Meal Plan Template** — a named, owner-scoped set of (day offset, meal slot, recipe, servings) tuples derived from a
  plan and applicable to a new start date.
- **Day Nutrition** _(derived, never stored)_ — per-day macro totals with a completeness flag, computed at read time.

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md) ·
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md). Full
bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016), which this section summarises and must not
contradict. **This section applies existing portfolio rules and mints NO new FR** (GR-003). GR-015 decides who
**authors** the contract; GR-016 decides where that zod **runs**.

### Contract ownership (GR-015)

| Role                                        | Binding for 006                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)        | `@kitchensink/meal-plan-service` — `packages/services/meal-plan-service/src/meal-plans/*.schema.ts` |
| Schema package (**generated**, committed)   | `@kitchensink/schema-meal-plan` — `packages/schemas/meal-plan`, generated, **never hand-edited**    |
| Consuming client                            | `@kitchensink/meal-plan-service-client` — `packages/clients/meal-plan-service`                      |
| Consuming apps / feature packages           | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package                 |
| Domain types (a **different** axis, GR-007) | `@kitchensink/meal-plan-core` — reused `import type`, never re-declared in the schema package       |

✅ **Ownership is decided** (ADR-0017's 2026-08-14 amendment; reasoning restated 2026-08-16): 006's paths are
**`/api/v1/meal-plans/*`** and they land in **`@kitchensink/meal-plan-service`**, its **own** deployable with
its own logical database `kitchensink_meal_plans`. A **schema package is per SERVICE, not per feature** — which
is precisely why `@kitchensink/schema-meal-plan` exists and `@kitchensink/schema-meal-planning` does not. 006
adopts the `/api/v1/*` prefix regardless of service, which closes its bare-`/v1/*` GR-002 holdout.

⛔ **This table previously bound 006 to `@kitchensink/recipe-service` / `@kitchensink/schema-recipe` and said
"no new deployable is created" — stale text from 2026-08-12, superseded by the extraction two days later.**
It is recorded rather than silently swapped because a reader who acted on it would have authored 006's zod
inside another service's contract package, which GR-015 makes very hard to unwind. ADR-0017's **2026-08-16**
amendment additionally records that the extraction rests on an owner ruling — its two claimed "engineering
facts" were refuted — and that its unpriced cost lands here: see `plan.md`'s 2026-08-16 amendment §A-3, where
006 **re-declares** the read-time orphan handling that co-location's `ON DELETE CASCADE` would have deleted.

**The service MUST** author every meal-plan, entry, nutrition-summary and suggestion request/response shape as
**zod in the service** at `src/meal-plans/*.schema.ts`, **beside the controller it serves**; validate its own
requests with **that same zod**; and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts`
files**. `@kitchensink/schema-meal-plan` exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a
**barrel**, and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them:

- The schema package is a literal file **COPY**, not a transformation. Zod schemas are **runtime values**, so
  they cannot be derived from themselves, and every package exports raw `./src/*.ts` — there is no
  bundle-into-`dist` path to derive through.
- Turbo wires the copy with `$TURBO_ROOT$` **`inputs`**, **NOT** `dependsOn`. That edge is what closes the cycle
  `client → schema → service → client`, and ordering was never the requirement, because the generated files are
  **committed**.
- `openapi.yaml` is **DERIVED OUTPUT** for `oasdiff`, docs and external integrators. It is **NEVER a codegen
  input**: through JSON Schema you lose `readonly`, branded and template-literal types, and discriminated unions
  flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with
nothing, survived behind green builds).

- **No meal-plan wire shape is declared anywhere outside the schema package** — including **type-only**
  declarations, and including `packages/apps/**` feature packages (GR-015 §15-b.4).
- Both the **type and the runtime zod** are imported from `@kitchensink/schema-meal-plan`.
- A genuinely divergent consumer shape — the calendar grid's per-slot view model, a drag-payload model — is
  **DERIVED** with `Pick` / `Omit` / `Partial`, never independently declared. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **006 is also a CLIENT of other services** and is bound identically there: recipe reads via
  `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`, nutrition via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`, AI suggestions via 005. 006 declares no wire
  type belonging to 001, 003, 005, 007 or 009.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): the schema-package additions,
  the typed client methods, **response validation on receipt**, and the **contract-skew guard**. "The calendar UI
  will add the type" is a **contract fork, not a task**.
    - ✅ **CORRECTED 2026-08-12 — the portfolio-wide claim this bullet ended on is no longer true.** It read: _"not
      one `tasks.md` in the portfolio carried these tasks while nine `plan.md` files stated the obligation in
      prose."_ Re-measured today across all fourteen features: **14 of 14 `tasks.md` reference `CONTRACT_HASH`,
      14 of 14 reference contract **skew**, and 14 of 14 `plan.md` state the obligation** — and **11 of 14** carry
      it as a real **checkbox task**, not just prose (measured by attributing every line to the checkbox block it
      falls under, rather than grepping the file, which cannot tell a task from a paragraph).
    - ⛔ **006 is one of the THREE that still do not** (with 008 and 009): `specs/006-meal-planning/tasks.md` names
      `CONTRACT_HASH` and skew **only in prose**, with **zero** checkbox blocks carrying either, and **no** task
      naming `packages/schemas/`. So this bullet's warning still binds **here** — it is just no longer a
      portfolio-wide indictment, and the fix is a task in 006's own list, not another paragraph.

**Drift gates** — inherited from GR-015 §15-c, all three, not reinvented here: the turbo `inputs` rebuild, the
**regenerate-and-diff CI gate**, and the **`CONTRACT_HASH` boot assertion** (the only layer that catches a
deployed service running ahead of a released mobile binary).

⚠️ **Third-party APIs (GR-015 §15-d) — forward-looking for 006.** 006 consumes **no** third-party API directly:
USDA reaches it **transitively** through the food service, and the AI provider sits behind 005. If 006 ever calls
an external API itself, that client is the **OPPOSITE** case — it **validates the raw upstream shape at the
boundary with its own zod**, **MAY declare its own types**, and gets **NO** OpenAPI document.
`packages/clients/usda` is the reference implementation and must never be "converged"; deleting a boundary schema
in the name of this section removes a validation boundary rather than tidying one.

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every input above — body, path params (`{id}`, `{entryId}`), query params — is
  parsed by the recipe service's own authored zod via `createZodDto` plus **`nestjs-zod`'s**
  `ZodValidationPipe`. ⚠️ Under Nest's **OWN** `ValidationPipe` a `createZodDto` DTO validates **NOTHING while
  looking correctly wired** — the schema is present, the DTO is referenced, the route reads as validated, and no
  input is checked. It already bit identity's `PATCH /users/me`, and **the only way to observe it is a test that
  posts a known-bad body to a real route and asserts the `400`**.
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12). Plain `z.object()` needs a
  documented forward-compatibility reason at the schema, which in practice means a **read** surface. On
  `PUT /api/v1/meal-plans/{id}` a silently stripped unknown key is a `200` for an edit that did not happen.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer.** ⛔ Server-side
  **response** validation is **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"** — a
  contributor who adds an emission-side parse is undoing a decision, not closing a gap.
- **⛔ The storage floor — an ASSERTION, never a derivation.** `meal_plan_entries.servings` is `int4`, ceiling
  **2,147,483,647**: this is the live class of defect that made `servings: 9999999999` **a 500 that owed a 400**
  in the recipe service. `plan_type` and `meal_type` are **enum-by-comment `TEXT`**, so the column enforces
  nothing and the domain must be written into the zod. No zod is generated from the storage schema and **no
  storage type enters a wire schema**. **A floor is not a target**: `meal_plans.name` is unbounded `text()` —
  PostgreSQL imposes no limit — so a length cap on user prose is a **product decision 006 owns**. Enforcement is
  the per-service parity test specified in GR-017 §17-d, whose field→column mapping is asserted complete **in
  both directions**.
- **Non-HTTP ingress.** 006 owns **no queue, event or webhook CONSUMER**. Its SQS use for the 005 AI call is
  **outbound / producer** — governed by GR-016 §16-c.2, which validates the outbound body against the callee's
  schema zod **before the send**. If 006 ever consumes (an AI reply, a plan-rollover job), that handler parses
  its payload against an authored zod, because a pipe reaches neither, and an invalid payload is rejected once
  and **never redriven** (GR-018 §18-b).
- **No request-derived value reaches `sql.raw()`.** A request-selected sort or grouping maps through a validated
  enum to a **closed allowlist of literals** in code — the request supplies the key, never the SQL fragment.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-006-001** _(formerly SC-008)_: A user can complete the plan-to-grocery-projection workflow for a 7-day plan in
  under 10 minutes, measured from plan creation to the projection being available.
- **SC-006-002**: A user can assign a recipe to a slot in **3 interactions or fewer** from an open plan, on both web and
  mobile.
- **SC-006-003**: Reading a 30-day plan with full nutrition completes within a p95 of **500 ms** server-side under the
  k6 load profile defined in [plan.md](./plan.md), with a bounded downstream request count.
- **SC-006-004**: **100%** of planner UI states — loading, empty, populated, partial-nutrition, orphaned-entry, error,
  saving, and next-page-loading — have a passing component test on both platforms, and every user story has a passing
  Playwright (web) and Maestro (mobile) flow. The authoritative enumeration is the `STP-010-A` matrix in
  [`v-model/system-test.md`](./v-model/system-test.md); the list here is a summary of it, not a second definition.
- **SC-006-005**: The Home `meal-plan` roadmap placeholder is fully retired: no `meal-plan` entry remains in
  `ROADMAP_WIDGET_SPECS` and no per-app skeleton for it remains, verified by the existing exhaustiveness typecheck.

## Assumptions

- Recipes assigned to a plan are readable by the planner at assignment time; 006 does not grant, widen or cache any
  recipe access. `@kitchensink/recipe-core/recipeAccessPolicy` remains the single authoritative client-side statement of
  those rules, and the recipe service remains the enforcement boundary.
- The batch nutrition projection required by FR-024 is an **additive** change to the shipped recipe service and is
  tracked as a cross-feature dependency in [plan.md](./plan.md); 006 cannot meet NFR-006 without it.
- No requirement in this feature depends on 004, 008, 011, 012, 013 or 014.
- Everything else inherits from [001-commise-recipe-app](../001-commise-recipe-app/spec.md).
