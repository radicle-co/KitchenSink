# Module Design: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/architecture-design.md`](./architecture-design.md)

## Overview

Twenty-five architecture modules decompose into twenty-five module designs, `MOD-001`–`MOD-025`, one per ARCH. The
detail is concentrated where the design decisions are: the **pure domain** modules (`MOD-002`, `MOD-004`, `MOD-006`,
`MOD-005`), the **Gateway** (`MOD-015`), and **idempotency** (`MOD-016`). CRUD controllers and repositories are
mechanical and are specified at the level needed to write them, not padded.

> **Regeneration note.** The May design had 22 modules rooted at `src/meal-planning/{controllers,services,repositories,
guards}/` — an **organize-by-generic-type** layout that `CODING_STANDARDS §3` forbids ("Organize by feature domain,
> not by generic type"). Every path below is rooted in a real workspace and grouped by domain. Nine modules are gone
> (cache, USDA adapter, five AI/waste modules, premium guard, Clerk adapter); errors are `*Error` with `is*` guards, not
> `*Exception`; dates on contracts are ISO strings, never `Date`.

## ID Schema

- **Module Design**: `MOD-NNN` — sequential, 3-digit.
- **Parent Architecture Modules**: comma-separated `ARCH-NNN` (authoritative for traceability).
- **Target Source File(s)**: paths relative to the repository root.
- Purity is stated per module. An impure function carries `@sideEffect` in its JSDoc (`CODING_STANDARDS §2`).

---

## Shared domain — `packages/shared/meal-plan-core` (all pure, zero I/O)

### MOD-001 (MealPlanIds)

**Parent**: ARCH-001 · **Target**: `packages/shared/meal-plan-core/src/ids.ts` · **Purity**: pure (constructors throw)

```pseudocode
mealPlanIdSchema         = z.string().uuid().brand<'MealPlanId'>()
mealPlanEntryIdSchema    = z.string().uuid().brand<'MealPlanEntryId'>()
mealPlanTemplateIdSchema = z.string().uuid().brand<'MealPlanTemplateId'>()

FUNCTION mealPlanId(raw: string) -> MealPlanId:      RETURN mealPlanIdSchema.parse(raw)   // throws ZodError
FUNCTION isMealPlanId(v: unknown) -> v is MealPlanId: RETURN mealPlanIdSchema.safeParse(v).success
// …same shape for entry and template ids
```

Extends the shipped `@kitchensink/recipe-core/ids` pattern so a `RecipeId` cannot be passed where a `MealPlanId` is
expected. `RecipeId` is **imported** from recipe-core, never redeclared — one authoritative representation.

**Errors**: `ZodError` at the boundary only. **State**: none.

---

### MOD-002 (DateRange)

**Parent**: ARCH-002 · **Target**: `packages/shared/meal-plan-core/src/dateRange.ts` · **Purity**: pure

```pseudocode
CONSTANT MAX_SPAN_DAYS = 90

// Value Object: cannot exist inverted or over-long. Downstream code NEVER re-checks.
FUNCTION dateRange(startDate: IsoDate, endDate: IsoDate) -> DateRange:
    IF NOT isIsoCalendarDate(startDate) OR NOT isIsoCalendarDate(endDate):
        THROW InvalidDateRangeError('NOT_A_CALENDAR_DATE')
    IF endDate < startDate:                       // lexicographic compare is valid for YYYY-MM-DD
        THROW InvalidDateRangeError('END_BEFORE_START')
    IF dayCount(startDate, endDate) > MAX_SPAN_DAYS:
        THROW InvalidDateRangeError('SPAN_TOO_LONG')
    RETURN frozen { startDate, endDate }

FUNCTION dayCount(range) -> number:
    // differenceInCalendarDays (date-fns) + 1 — CALENDAR days, so a DST transition
    // does not add or remove a column. Never (end - start) / 86_400_000.
    RETURN differenceInCalendarDays(parseIso(range.endDate), parseIso(range.startDate)) + 1

FUNCTION contains(range, date: IsoDate) -> boolean:
    RETURN date >= range.startDate AND date <= range.endDate

FUNCTION eachDate(range) -> IsoDate[]:            // ordered, inclusive
FUNCTION groupIntoWeeks(range, locale) -> Week[]:
    // startOfWeek(date, { locale }) — honours the locale's first day of week (FR-037).
    // MUST NOT hard-code Monday or Sunday.
```

**Internal data**

| Name            | Type      | Constraints                 | Description                         |
| --------------- | --------- | --------------------------- | ----------------------------------- |
| `startDate`     | `IsoDate` | `YYYY-MM-DD`, immutable     | Inclusive first calendar day        |
| `endDate`       | `IsoDate` | `YYYY-MM-DD`, ≥ `startDate` | Inclusive last calendar day         |
| `MAX_SPAN_DAYS` | number    | 90                          | Mirrors the DB `CHECK` (REQ-CN-005) |

**Errors**: `InvalidDateRangeError` + `isInvalidDateRangeError`, carrying a discriminated `reason`.

**Test obligations**: boundary cases 1 day, 90 days, 91 days, end = start, end < start by one day; a range crossing a
DST transition in a southern- and northern-hemisphere zone; a range crossing a year boundary; a leap day.

---

### MOD-003 (MealSlot)

**Parent**: ARCH-003 · **Target**: `packages/shared/meal-plan-core/src/mealSlot.ts` · **Purity**: pure

```pseudocode
TYPE MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
CONSTANT MEAL_SLOT_ORDER: readonly MealSlot[] = ['breakfast','lunch','dinner','snack']  // display order

FUNCTION isMealSlot(v: unknown) -> v is MealSlot
FUNCTION sortSlots(slots) -> MealSlot[]                      // by MEAL_SLOT_ORDER, never alphabetical
FUNCTION planUsesSlot(plan, slot) -> boolean
FUNCTION parseSlotSet(raw: string[]) -> MealSlot[]:
    IF raw.length == 0                THROW EmptySlotSetError()
    IF hasDuplicates(raw)             THROW DuplicateSlotError()
    IF any(NOT isMealSlot)            THROW UnknownSlotError()
    RETURN sortSlots(raw)
```

Ordering lives here once. A UI that sorted slots alphabetically would render `breakfast, dinner, lunch, snack` — the
kind of quiet wrongness a shared constant prevents.

**Errors**: `EmptySlotSetError`, `DuplicateSlotError`, `UnknownSlotError`, each with an `is*` guard.

---

### MOD-004 (aggregatePlanNutrition) — the core algorithm

**Parent**: ARCH-004 · **Target**: `packages/shared/meal-plan-core/src/nutritionRollup.ts` · **Purity**: **pure — no
I/O, no clock, no randomness**

```pseudocode
// Consumes RecipeNutrition from @kitchensink/recipe-core. Does NOT recompute macros —
// recipe-core owns that computation, including unit conversion and per-line partiality.

TYPE Macros    = { calories, proteinG, carbsG, fatG }            // all non-negative
TYPE DayTotal  = { date: IsoDate, totals?: Macros, isComplete: boolean }
TYPE PlanTotal = { totals?: Macros, isComplete: boolean }

FUNCTION aggregatePlanNutrition(
    range: DateRange,
    entries: readonly MealPlanEntry[],
    nutritionByRecipeId: ReadonlyMap<RecipeId, RecipeNutrition | null>,
) -> { perDay: DayTotal[], planTotal: PlanTotal }:

    perDay = []
    FOR EACH date IN eachDate(range):                       // EVERY day, including empty ones
        dayEntries = entries WHERE entry.date == date

        acc = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
        complete = true
        contributed = false                                 // did ANY entry actually add nutrition?

        FOR EACH entry IN dayEntries:
            n = nutritionByRecipeId.get(entry.recipeId)
            IF n IS undefined OR n IS null:
                // undefined = gateway never answered for this id; null = unreadable (orphaned).
                // Both contribute NOTHING and destroy completeness.
                complete = false
                CONTINUE
            acc.calories += n.calories * entry.servings
            acc.proteinG += n.proteinG * entry.servings
            acc.carbsG   += n.carbsG   * entry.servings
            acc.fatG     += n.fatG     * entry.servings
            contributed = true
            IF NOT n.isComplete:
                complete = false          // recipe-level partiality propagates upward

        // CORRECTED 2026-08-05 (T011/T012). The earlier pseudocode special-cased only the EMPTY day, so a
        // day whose entries were ALL orphaned fell through and reported `totals: {0,0,0,0}` — the exact
        // false zero HAZ-033 calls "a factual lie about the plan", and a direct contradiction of both
        // UTS-004-B4 and this module's own invariant (`totals === undefined` iff the day has no
        // CONTRIBUTING entry). Gating on `contributed` satisfies all three and removes the special case:
        // an empty day and an all-orphaned day both report no totals, and differ only in `isComplete`.
        perDay.push({ date, totals: contributed ? acc : undefined, isComplete: complete })

    contributing = perDay WHERE totals IS DEFINED
    planTotal = contributing IS EMPTY
        ? { totals: undefined, isComplete: all(perDay, d => d.isComplete) }
        : { totals: sumMacros(contributing.totals), isComplete: all(perDay, d => d.isComplete) }

    RETURN { perDay, planTotal }
```

**Invariants (property-test these, per `ENGINEERING_EXCELLENCE` QSE §4)**

| Invariant                                                                 | Why it matters                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Summation is order-independent and associative                            | Entry ordering must never change a total             |
| `isComplete` is monotonically destroyed — never restored by a later entry | One unaccounted line makes the whole day an estimate |
| `perDay.length == dayCount(range)` always                                 | Empty days are represented, not omitted              |
| `totals === undefined` ⟺ the day has no contributing entry                | Distinguishes "nothing planned" from "zero calories" |
| Doubling every `servings` doubles every macro exactly                     | Servings is a pure multiplier (FR-030)               |
| Output depends only on inputs                                             | No clock, no I/O — the reason no cache is needed     |

**State machine**: none. **Errors**: none — the function is total. A missing or unreadable recipe is a _value_ handled
by the fold, not an exception.

**Test obligations**: 0 entries; 1 entry; all entries orphaned; mixed complete/partial; servings at 1 and 99; a 90-day
plan at full density; `undefined` vs `null` map entries; float accumulation over 360 entries.

---

### MOD-005 (mealPlanAccessPolicy)

**Parent**: ARCH-005 · **Target**: `packages/shared/meal-plan-core/src/mealPlanAccessPolicy.ts` · **Purity**: pure

```pseudocode
// SECURITY-RELEVANT: every predicate FAILS CLOSED. An absent viewer id can never satisfy ownership.
// Single authoritative representation, called identically by service, web and mobile — the D7 lesson
// from recipeAccessPolicy, where web and mobile implemented two different clone gates.

FUNCTION isOwner(resource: { ownerId }, viewer: Viewer) -> boolean:
    RETURN viewer.id IS DEFINED AND viewer.id === resource.ownerId

FUNCTION canViewPlan(plan, viewer)   -> boolean:  RETURN isOwner(plan, viewer)
FUNCTION canModifyPlan(plan, viewer) -> boolean:  RETURN isOwner(plan, viewer)
FUNCTION canApplyTemplate(t, viewer) -> boolean:  RETURN isOwner(t, viewer)
```

The client half of the gate; the service is the enforcement boundary. They must agree, or the UI lies about what an
action will do.

**Test obligations**: absent viewer id; empty-string viewer id; transposed ids; owner match.

---

### MOD-006 (templateProjection)

**Parent**: ARCH-006 · **Target**: `packages/shared/meal-plan-core/src/templateProjection.ts` · **Purity**: pure

```pseudocode
FUNCTION toTemplate(plan, entries) -> TemplateDraft:
    // Relative offsets, NOT dates — this is what makes a template re-appliable.
    RETURN {
        spanDays: dayCount(plan.range),
        mealSlots: plan.mealSlots,
        entries: entries.map(e => ({
            dayOffset: signedDayOffset(plan.range, e.date),   // via the DateRange value object
            mealSlot: e.mealSlot, recipeId: e.recipeId, servings: e.servings,
        })),
    }

FUNCTION applyTemplate(template, startDate, readability: ReadonlyMap<RecipeId, boolean>)
        -> { range, entries, skipped: { unreadableRecipe, outOfRange, slotNotSelected, occupied } }:
    range = dateRange(startDate, addCalendarDays(startDate, template.spanDays - 1))
    // CORRECTED 2026-08-05 (T016). This carried only TWO skip reasons; it predates REQ-CN-010 (a cell holds
    // at most one entry) and REQ-CN-013 (an entry's slot must be one its plan selected). Both are now
    // enforced by the database, so an unskipped entry of either kind fails the WHOLE apply transaction —
    // the user gets nothing instead of a partial plan with a reported skip.
    //
    // Precedence resolves the target OUTSIDE-IN — does the day exist, does that slot exist on it, is the
    // cell free — with readability first as the only reason a user can act on:
    //     unreadableRecipe -> outOfRange -> slotNotSelected -> occupied
    // Exactly one count per entry. A cell is claimed only by an entry actually PLACED, so a skipped entry
    // never blocks a readable duplicate behind it.
    entries = []; unreadableRecipe = 0; outOfRange = 0; slotNotSelected = 0; occupied = 0

    FOR EACH te IN template.entries:
        IF readability.get(te.recipeId) !== true:      // absent or false ⇒ skip (FAIL CLOSED)
            unreadableRecipe += 1; CONTINUE
        date = addCalendarDays(startDate, te.dayOffset)
        IF NOT contains(range, date):
            outOfRange += 1; CONTINUE
        entries.push({ date, mealSlot: te.mealSlot, recipeId: te.recipeId, servings: te.servings })

    RETURN { range, entries, skipped: { unreadableRecipe, outOfRange, slotNotSelected, occupied } }
```

The **skip counts are part of the return value**, not a log line — they are shown to the user (FR-028). Ordering of the
two checks is deliberate: readability is checked first so an unreadable recipe outside the range is reported once, by
its more actionable reason.

**Test obligations**: round-trip `toTemplate ∘ applyTemplate` preserves relative positions (property test); offset 0;
offset = span − 1; offset ≥ span (out of range); all recipes unreadable; empty template; DST-crossing target range.

---

### MOD-007 (groceryProjection)

**Parent**: ARCH-007 · **Target**: `packages/shared/meal-plan-core/src/groceryProjection.ts` · **Purity**: pure

```pseudocode
FUNCTION toGroceryProjection(plan, entries, orphanedIds: ReadonlySet<MealPlanEntryId>) -> GroceryProjectionV1:
    RETURN {
        version: 'v1',
        planId: plan.id,
        dateRange: { start: plan.range.startDate, end: plan.range.endDate },   // WIRE keys stay start/end
        entries: entries
            .filter(e => NOT orphanedIds.has(e.id))          // an unreadable recipe cannot be shopped for
            .map(e => ({ recipeId: e.recipeId, date: e.date, mealSlot: e.mealSlot, servings: e.servings })),
    }
```

**No ingredients, no quantities, no units, no dedup** — 007 owns those rules. Versioned additively: a new optional field
never breaks a consumer.

---

### MOD-008 (mealPlanDatabaseName)

**Parent**: ARCH-008 · **Target**: `packages/shared/meal-plan-core/src/mealPlanDatabaseName.ts` · **Purity**: pure

```pseudocode
CONSTANT BASE_DATABASE_NAME = 'kitchensink_meal_plans'
FUNCTION mealPlanDatabaseName(stage, baseStage) -> string:
    RETURN stage === baseStage ? BASE_DATABASE_NAME : `${BASE_DATABASE_NAME}_${sanitize(stage)}`
```

**This module MUST have no imports and MUST NOT be re-exported from the barrel.** Imported as
`@kitchensink/meal-plan-core/database-name`. This is the exact constraint documented on `recipeDatabaseName.ts`, whose
violation (defect #119) pointed the recipe API and its workers at two different databases in a live preview — with three
destructive scheduled workers on the wrong one. A cross-stack parity test is part of this module's contract.

---

## Service — `packages/services/meal-plan-service`

### MOD-009 (MealPlansController)

**Parent**: ARCH-009 · **Target**: `src/plans/meal-plans.controller.ts` · **Purity**: impure (`@sideEffect`: HTTP)

```pseudocode
@Controller('v1/meal-plans')
// AuthMiddleware is global (all routes but /health); req.principal carries the app-user ULID. No per-route
// guard. CORRECTED 2026-08-07 (T024): this said `req.user`, which collides with Express/passport
// typings — every shipped service uses `req.principal` with @OwnerId() / @CurrentPrincipal().

@Post()    create(@Body raw, @CurrentPrincipal p)          -> 201 MealPlanDetail
    dto = createMealPlanSchema.parse(raw)            // parse, don't validate
    RETURN plansService.create(dto, p.userId)

@Get()     list(@Query raw, @CurrentPrincipal p)           -> 200 { items, nextCursor? }
    q = listQuerySchema.parse(raw)                   // cursor + limit (≤100, default 20) — KEYSET
    RETURN plansService.list(p.userId, q)

@Get(':id')    get(id, p)      -> 200 MealPlanDetail  // plan + entries + nutrition, ONE round trip
@Patch(':id')  update(id, raw, p) -> 200 MealPlanDetail
@Delete(':id') remove(id, p)   -> 204                 // cascades to entries; repeat succeeds
```

**Errors**

| Condition                    | Error                        | HTTP | Note                                         |
| ---------------------------- | ---------------------------- | ---- | -------------------------------------------- |
| Body/query fails Zod         | `ZodError` → filter          | 422  | Field-bound `details[]`                      |
| Plan absent **or not owned** | `MealPlanNotFoundError`      | 404  | **Identical response for both** (REQ-CN-002) |
| Invalid range/slots          | `InvalidDateRangeError` etc. | 422  |                                              |
| No/invalid token             | middleware                   | 401  |                                              |

---

### MOD-010 (MealPlansService)

**Parent**: ARCH-010 · **Target**: `src/plans/meal-plans.service.ts` · **Purity**: impure (`@sideEffect`: DB)

```pseudocode
FUNCTION create(dto, userId):
    range = dateRange(dto.startDate, dto.endDate)     // MOD-002 throws on invalid
    slots = parseSlotSet(dto.mealSlots)               // MOD-003 throws on invalid
    RETURN repo.insert({ ownerId: userId, name: dto.name, range, slots })

FUNCTION getDetail(planId, userId):
    plan = repo.findOwned(planId, userId)             // owner predicate IN the query
    IF plan IS NULL THROW MealPlanNotFoundError(planId)
    entries = entriesRepo.listForPlan(planId)
    summary = nutritionService.summarize(plan, entries)     // MOD-014
    RETURN compose(plan, entries, summary)

FUNCTION update(planId, dto, userId):
    plan = findOwned…
    IF dto narrows the range AND entries fall outside:
        THROW EntriesOutsideNewRangeError({ affectedCount })   // 409 — never silently orphan the user's work
```

**State machine**: none. A plan has no lifecycle states — the `is_locked` state machine of the May design is deleted
(C-006-007).

---

### MOD-011 (MealPlansRepository)

**Parent**: ARCH-011 · **Target**: `src/plans/dal/meal-plans.repository.ts` · **Purity**: impure (`@sideEffect`: SQL)

```pseudocode
FUNCTION findOwned(planId, ownerId):
    // Owner predicate is part of the WHERE clause, never a post-filter — a post-filter
    // leaks existence through timing and is one refactor away from being dropped.
    SELECT * FROM meal_plans WHERE id = $1 AND owner_id = $2

FUNCTION listOwned(ownerId, cursor?, limit):
    // KEYSET pagination on (created_at DESC, id DESC), backed by meal_plans_owner_created_idx.
    // Offset paging drifts under concurrent inserts and degrades on deep pages.
    SELECT * FROM meal_plans
     WHERE owner_id = $1 AND ($2 IS NULL OR (created_at, id) < ($2.createdAt, $2.id))
     ORDER BY created_at DESC, id DESC LIMIT $3 + 1
```

---

### MOD-012 (Entries: controller + service + repository)

**Parent**: ARCH-012 · **Target**: `src/entries/meal-plan-entries.{controller,service}.ts`,
`src/entries/dal/meal-plan-entries.repository.ts` · **Purity**: impure

```pseudocode
FUNCTION assign(planId, dto, userId, idempotencyKey):
    prior = idempotency.lookup(userId, 'POST /entries', idempotencyKey)
    IF prior EXISTS: RETURN prior                       // replay, do not re-execute (FR-032)

    plan = plansRepo.findOwned(planId, userId)
    IF plan IS NULL THROW MealPlanNotFoundError(planId)
    IF NOT contains(plan.range, dto.date)   THROW DateOutsidePlanRangeError(dto.date, plan.range)
    IF NOT planUsesSlot(plan, dto.mealSlot) THROW SlotNotInPlanError(dto.mealSlot)
    IF dto.servings < 1 OR > 99             THROW InvalidServingsError(dto.servings)
    IF dto.note AND length > 500            THROW NoteTooLongError()

    readable = recipeGateway.isReadable(dto.recipeId, principal)
    SWITCH readable:
        CASE 'readable':      break
        CASE 'not-readable':  THROW RecipeNotReadableError(dto.recipeId)   // 404-shaped: discloses nothing
        CASE 'unavailable':   THROW RecipeCheckUnavailableError()          // 503 — FAIL CLOSED, never assume readable

    TRANSACTION:
        entry = repo.insert({ planId, ...dto })
        idempotency.store(userId, 'POST /entries', idempotencyKey, entry)   // SAME transaction
    RETURN entry

FUNCTION move(entryId, target, userId):   // re-runs the cell validation above; no duplicate row created
FUNCTION remove(entryId, userId):         // idempotent — removing an absent entry returns success-shaped
```

Note there is **no duplicate-assignment conflict check**: FR-023 explicitly permits the same recipe in multiple cells
and repeats within a cell, so there is no natural key. That is exactly why an idempotency ledger is required rather than
a unique constraint.

**Errors**: `MealPlanNotFoundError` (404) · `DateOutsidePlanRangeError`, `SlotNotInPlanError`, `InvalidServingsError`,
`NoteTooLongError` (422) · `RecipeNotReadableError` (404) · `RecipeCheckUnavailableError` (503).

---

### MOD-013 (Templates: controller + service + repository)

**Parent**: ARCH-013 · **Target**: `src/templates/*` · **Purity**: impure

```pseudocode
FUNCTION saveAsTemplate(planId, name, userId):
    plan = plansRepo.findOwned(planId, userId) OR THROW MealPlanNotFoundError
    draft = toTemplate(plan, entriesRepo.listForPlan(planId))       // MOD-006, pure
    TRANSACTION: insert template + template_entries
    RETURN template

FUNCTION apply(templateId, startDate, name, userId, idempotencyKey):
    prior = idempotency.lookup(...) ; IF prior RETURN prior
    template = repo.findOwned(templateId, userId) OR THROW TemplateNotFoundError
    outcome = recipeGateway.batchReadable(distinct(template.recipeIds), principal)
    // gateway unavailable ⇒ every id unknown ⇒ every entry skipped ⇒ an empty plan and an
    // honest skip report, rather than a plan silently missing meals for an unstated reason.
    result = applyTemplate(template, startDate, outcome.byRecipeId)  // MOD-006, pure
    TRANSACTION:
        plan = plansRepo.insert(...)
        entriesRepo.bulkInsert(result.entries)
        idempotency.store(...)
    RETURN { plan: MealPlanSummary(plan),           // SUMMARY — never MealPlanDetail. See below.
             skipped: result.skipped,
             recipeAvailability: outcome.availability }   // REQ-024 — see below.
```

**Return shape — `plan` is a `MealPlanSummary`, never a `MealPlanDetail`.** `MealPlanDetail` requires `nutrition`, and
this value is **stored in the idempotency ledger and replayed for 24 hours** (REQ-015). Nutrition is derived at read
time and MUST NOT be persisted (REQ-CN-004, and STS-003-A6 is the standing guard) — so a replay of a detail-shaped
response would serve a nutrition rollup snapshotted at first-apply, which goes stale on the very next recipe edit with
no invalidation path. That is precisely the second-source-of-truth failure REQ-CN-004 exists to prevent, smuggled in
through the replay path where nobody would look for it. A caller that wants nutrition issues `GET /meal-plans/{id}`,
which computes it fresh.

**`recipeAvailability` (REQ-024).** The gateway's verdict is three-state (`available | degraded | unavailable`) and
the apply MUST pass it through, because the four skip counts cannot express "we could not check": both a confirmed
unreadable recipe and an unanswered one land in `unreadableRecipe`, so an outage is indistinguishable from mass recipe
deletion — and the two call for opposite user actions (retry versus rebuild the template). This field is what lets the
client tell them apart. Note it is part of the value written to the ledger, so a replay reports the availability **as
of the original apply**, which is correct: a replay is a re-read of that decision, not a fresh one.

**Errors**: `TemplateNotFoundError` (404) · `InvalidDateRangeError` (422).

> **Corrected 2026-08-07 (defect review).** The pseudocode used to end `RETURN { plan, skipped: result.skipped }` with
> no shape stated for `plan` and no availability at all. That silence is what let `contracts/openapi.yaml` declare
> `AppliedTemplate.plan` as a **`MealPlanDetail`** — a shape this operation cannot honestly return, for the
> ledger-replay reason above. The shipped service already does the right thing (`toPlanSummary` in
> `packages/services/meal-plan-service/src/templates/meal-plan-templates.service.ts`, returning
> `MealPlanSummaryResource`), so the document and the contract were the drift, not the code. **The contract fix is not
> made here** — `openapi.yaml` is owned by the main implementation thread and is reported to it.

---

### MOD-014 (PlanNutritionService)

**Parent**: ARCH-014 · **Target**: `src/nutrition/plan-nutrition.service.ts` · **Purity**: impure orchestration around a
pure core

```pseudocode
FUNCTION summarize(plan, entries):
    ids = distinct(entries.map(e => e.recipeId))
    IF ids IS EMPTY:
        RETURN aggregatePlanNutrition(plan.range, [], emptyMap())     // still returns every day
    result = recipeGateway.batchNutrition(ids, principal)             // ONE logical call; gateway chunks
    RETURN aggregatePlanNutrition(plan.range, entries, result.byRecipeId)
```

**This module contains no arithmetic.** Every macro operation lives in MOD-004. That separation is what makes the maths
exhaustively testable without a network and is why the May `NutritionCalculator` interface — which mixed a
`triggerOnEntryAdd(entry): void` side effect into a "calculator" — is deleted.

**Errors**: none. Gateway unavailability is a value; the summary comes back with `isComplete: false`.

---

### MOD-015 (RecipeGateway) — the availability boundary

**Parent**: ARCH-015 · **Target**: `src/recipes/recipe.gateway.ts` · **Purity**: impure (`@sideEffect`: HTTP)

```pseudocode
CONSTANT BATCH_LIMIT = 500
    // CORRECTED 2026-08-07 (T033). 100 CONTRADICTED REQ-010, which requires a whole plan read to issue
    // EXACTLY ONE batch request. A maximal 90-day x 4-slot plan references up to 360 distinct recipes, so
    // a limit of 100 forces four calls for an ordinary plan. REQ-IF-008 fixed the provider at 500
    // PRECISELY because 500 > 360 — chunking is therefore a guard against pathological input, never the
    // normal path. Changing this number without re-reading REQ-010 will silently reintroduce the N-call
    // read that the batch endpoint exists to eliminate.
CONSTANT TIMEOUT_MS  = 2_000
CONSTANT FAILURE_LOG_INTERVAL_MS = 60_000

// Modelled on the shipped FoodCatalogGateway. A TOTAL FUNCTION: it never throws.
FUNCTION batchNutrition(recipeIds, principal) -> { byRecipeId, availability }:
    chunks = chunk(distinct(recipeIds), BATCH_LIMIT)
    byRecipeId = new Map(); anyFailed = false; anySucceeded = false

    FOR EACH chunk IN chunks:
        TRY:
            // Real AbortSignal at the transport. NOT Promise.race — a race leaves the
            // underlying request pending, leaking one socket per timeout.
            res = AWAIT client.post('/api/v1/recipes/nutrition-batch',
                                    { json: { recipeIds: chunk }, signal: AbortSignal.timeout(TIMEOUT_MS) })
            parsed = batchNutritionSchema.safeParse(res)
            IF NOT parsed.success: anyFailed = true; logThrottled('malformed'); CONTINUE
            FOR EACH (id, state) IN parsed.data.nutrition: byRecipeId.set(id, state)
            // A requested id ABSENT from the map is unreadable -> orphan (FR-033). Read it with a
            // hasOwn guard, never a bare index: a Record index reaches the prototype chain, so an id
            // of 'toString' returns a FUNCTION rather than undefined.
            anySucceeded = true
        CATCH (timeout | 5xx | network | auth):
            anyFailed = true; logThrottled(errorKind)          // ≤ 1 log per interval; rest at debug

    availability = anyFailed ? (anySucceeded ? 'degraded' : 'unavailable') : 'available'
    RETURN { byRecipeId, availability }

FUNCTION isReadable(recipeId, principal) -> 'readable' | 'not-readable' | 'unavailable'
FUNCTION batchReadable(recipeIds, principal) -> ReadonlyMap<RecipeId, boolean>
```

**Why each property is load-bearing**

| Property                 | Failure it prevents                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Never throws             | A recipe-service blip would otherwise 500 the whole planner, losing the user's own data with it.       |
| Real `AbortSignal`       | `Promise.race` resolves the wrapper but leaks the request — one hung socket per call under an outage.  |
| Three-state availability | `degraded` (some chunks answered) is a real state; a boolean would round it to "fine" or "broken".     |
| Boundary normalization   | A malformed payload is dropped here rather than leaking an unvalidated shape into the fold.            |
| Throttled logging        | A per-plan-read failure path multiplies an outage into a log flood — cost, and signal buried in noise. |
| Gateway-owned chunking   | Callers pass all ids; no caller can forget to chunk and blow the batch limit.                          |

**Test obligations**: timeout; 5xx; network error; malformed body; partial batch (chunk 1 ok, chunk 2 fails → `degraded`);
empty id list; > `BATCH_LIMIT` ids; `null` nutrition entries; auth failure. Each asserts the returned **value**, never
that a mock was called.

---

### MOD-016 (IdempotencyStore)

**Parent**: ARCH-016 · **Target**: `src/common/idempotency.store.ts` · **Purity**: impure (`@sideEffect`: DB)

```pseudocode
FUNCTION lookup(ownerId, endpoint, key) -> StoredResponse | null:
    IF key IS ABSENT: RETURN null
    SELECT response_body FROM meal_plan_idempotency_keys
     WHERE owner_id = $1 AND endpoint = $2 AND idempotency_key = $3

FUNCTION store(ownerId, endpoint, key, response):
    // MUST run inside the caller's transaction. If it committed separately, a crash between
    // the two could record a key for an entry that was never created — and the retry would
    // return a success for work that never happened.
    INSERT ... ON CONFLICT DO NOTHING
```

Scoped by `owner_id` so one user's key can never replay another's response.

**Retention — 24 hours, pruned opportunistically (PRF-006-17).** Every `store` also runs a **bounded** prune inside the
same transaction:

```sql
DELETE FROM meal_plan_idempotency_keys
 WHERE ctid IN (
   SELECT ctid FROM meal_plan_idempotency_keys
    WHERE owner_id = $1 AND created_at < now() - INTERVAL '24 hours'
    LIMIT 50
 );
```

Why this shape rather than a scheduled job:

- **No infrastructure.** `pg_cron` is not enabled on this platform, and every other scheduled task here is an
  EventBridge rule driving a Lambda or ECS task — which REQ-NF-009 forbids for this feature. Opportunistic pruning needs
  neither.
- **Self-limiting.** The table only accumulates while it is being written to, which is precisely when the prune runs.
  An idle service has nothing to prune.
- **Bounded.** `LIMIT 50` caps the work added to any one request, so a long-idle owner with a large backlog cannot turn
  a single assignment into a slow query. The backlog drains over the following writes.
- **Owner-scoped**, so one user's backlog never taxes another's request.
- **24 hours** is the conventional window for request idempotency: long enough to cover an offline mobile client
  retrying on reconnect, short enough that stored response bodies are not held indefinitely.

**Interaction with MOD-018 (erasure)**: account erasure deletes a user's keys immediately regardless of age, so
retention never keeps data alive past an erasure request (REQ-020).

**Test obligations**: first call stores; identical replay returns the stored body without a second insert; a different
owner with the same key is unaffected; concurrent identical requests produce exactly one entry; an **expired** key does
not replay; the prune is **bounded** and **owner-scoped**. The transactional-coupling case (HAZ-030) and the pruning
behaviour are asserted at the integration tier, where a real transaction and a real clock exist.

---

### MOD-017 (ApiExceptionFilter + error classes)

**Parent**: ARCH-017 · **Target**: `src/common/apiException.filter.ts`, `src/common/errors/*.ts` · **Purity**: pure
error constructors; impure filter

```pseudocode
// EVERY domain error follows CODING_STANDARDS §6:
export class MealPlanNotFoundError extends Error {
    readonly planId: string
    constructor(planId) {
        super(`Meal plan not found: ${planId}`)
        this.name = 'MealPlanNotFoundError'
        this.planId = planId
        Object.setPrototypeOf(this, MealPlanNotFoundError.prototype)   // instanceof across module boundaries
    }
}
export function isMealPlanNotFoundError(e: unknown): e is MealPlanNotFoundError { ... }

// ONE envelope for the whole service:
FUNCTION catch(error) -> { code, message, details? } + status
```

| Error                         | code                        | HTTP |
| ----------------------------- | --------------------------- | ---- |
| `MealPlanNotFoundError`       | `MEAL_PLAN_NOT_FOUND`       | 404  |
| `TemplateNotFoundError`       | `TEMPLATE_NOT_FOUND`        | 404  |
| `RecipeNotReadableError`      | `MEAL_PLAN_NOT_FOUND`†      | 404  |
| `InvalidDateRangeError`       | `INVALID_DATE_RANGE`        | 422  |
| `SlotNotInPlanError`          | `SLOT_NOT_IN_PLAN`          | 422  |
| `DateOutsidePlanRangeError`   | `DATE_OUTSIDE_PLAN_RANGE`   | 422  |
| `InvalidServingsError`        | `INVALID_SERVINGS`          | 422  |
| `EntriesOutsideNewRangeError` | `ENTRIES_OUTSIDE_NEW_RANGE` | 409  |
| `RecipeCheckUnavailableError` | `DEPENDENCY_UNAVAILABLE`    | 503  |

† Deliberate: an unreadable recipe returns the same code and shape as an absent one, so the response discloses nothing
about whether the recipe exists (REQ-CN-002). A distinct `RECIPE_NOT_READABLE` code would be the disclosure.

---

### MOD-018 (AccountErasureParticipant)

**Parent**: ARCH-018 · **Target**: `src/erasure/account-erasure.service.ts` · **Purity**: impure

```pseudocode
FUNCTION eraseForUser(userId):
    TRANSACTION:
        DELETE FROM meal_plan_template_entries WHERE template_id IN (SELECT id FROM meal_plan_templates WHERE owner_id=$1)
        DELETE FROM meal_plan_templates       WHERE owner_id = $1
        DELETE FROM meal_plan_entries         WHERE meal_plan_id IN (SELECT id FROM meal_plans WHERE owner_id=$1)
        DELETE FROM meal_plans                WHERE owner_id = $1
        DELETE FROM meal_plan_idempotency_keys WHERE owner_id = $1
    // Idempotent: re-running after a partial failure completes without error.
```

Joins the mechanism 001 C-007 established. **No second erasure path** — a second one is a second thing to forget.

---

## Client — `packages/apps/commise/features/meal-plan`

### MOD-019 (useMealPlanBoard)

**Parent**: ARCH-019 · **Target**: `src/hooks/useMealPlanBoard.ts` · **Purity**: impure hook over pure selectors

```pseudocode
FUNCTION useMealPlanBoard(planId) -> {
    board: BoardViewModel, status, assign, move, remove, setServings, setNote,
}:
    query = useMealPlanQuery(planId)                    // TanStack
    assign = useMutation({ mutationFn, onMutate: optimistic, onError: rollback, retry: false })
    // retry:false is deliberate — the Idempotency-Key makes a USER-driven retry safe;
    // an automatic client retry would race the optimistic update.
    board  = selectBoard(query.data)                    // PURE selector, unit-testable without React
    RETURN { board, ... }
```

The single command surface both platforms drive. Tests assert the resulting board state, never the gesture.

---

### MOD-020 (Board render components)

**Parent**: ARCH-020 · **Target**: `src/board/{DayColumn,SlotCell,EntryCard,NutritionSummary}.tsx` · **Purity**: pure
`props → JSX`

```pseudocode
TYPE EntryViewState =
    | { kind: 'assigned', entry, recipeTitle, caloriesPerServing? }
    | { kind: 'orphaned', entry }
    | { kind: 'pending',  optimisticEntry }

FUNCTION SlotCell({ state }):
    SWITCH state.kind:                       // exhaustive — a new kind fails typecheck, not review
        CASE 'assigned': RETURN <AssignedEntryCard …/>
        CASE 'orphaned': RETURN <OrphanedEntryCard …/>     // "Recipe unavailable" + icon (NFR-004)
        CASE 'pending':  RETURN <PendingEntryCard …/>
```

**No boolean flag props** (`CODING_STANDARDS §11`): the parent composes by union member. `EntryCard` never takes
`isOrphaned`. Every string comes from MOD-023.

**Plans list (`src/plans/{PlanList,PlanListItem}.tsx`) — added 2026-08-07 for REQ-025 / FR-022a.** Same discipline: a
`PlanListViewState` discriminated union (`loading | empty | populated | loading-more | failed`) over which the surface
switches exhaustively, driven by `mealPlansInfiniteQuery` from MOD-025. It lives here rather than becoming a
twenty-sixth ARCH/MOD pair because it is a render surface over an existing query — no new architectural element —
which keeps the ARCH↔MOD mapping one-to-one. `failed` is a distinct member on purpose: rendering a load failure as
`empty` asserts "you have no plans", which is a lie the user will act on. Its `(both)` column and its five states are
in the `STP-010-A` matrix. The **switcher** is the same component surfaced from an open plan (MOD-021 owns the
platform affordance: a popover on web, a sheet on native), not a second implementation.

---

### MOD-021 (Platform interaction layer)

**Parent**: ARCH-021 · **Target**: `src/board/MealPlanBoard.tsx`, `src/board/MealPlanBoard.native.tsx` · **Purity**:
impure (interaction)

Web wires `@dnd-kit` `PointerSensor` **and** `KeyboardSensor` with live-region announcements; mobile wires
tap-to-assign and long-press. Both export the **same public API** and call MOD-019. `@dnd-kit` is imported only from the
`.tsx` file — never from shared code, so Metro never resolves it on native.

**Refs**: the only permitted ref in this feature is `@dnd-kit`'s sensor attachment to a DOM node — a genuinely external,
non-declarative system (`CLAUDE.md`: refs are near-forbidden).

---

### MOD-022 (MealPlanHomeWidget)

**Parent**: ARCH-022 · **Target**: `src/widget/MealPlanHomeWidget.tsx` + `.native.tsx`; **modifies**
`packages/apps/commise/features/core/src/roadmapWidgets.ts` and both apps' skeleton maps

```pseudocode
DESCRIPTOR = { kind: 'live', id: 'meal-plan',
               capability: ROADMAP_CAPABILITIES.mealPlanning,
               defaultWeight: 1200,                                  // preserve the mockup's position
               load: () => import('@commise/features-meal-plan/widget/web') }   // /mobile on native

// Retirement, in the SAME change (FR-035):
//   1. remove { id: 'meal-plan', … } from ROADMAP_WIDGET_SPECS
//   2. remove 'meal-plan' from the RoadmapWidgetId union
//   3. delete each app's meal-plan skeleton
// Because RoadmapWidgetId feeds a TOTAL Record<RoadmapWidgetId, HomeWidgetLoader>,
// a partial retirement fails `typecheck` rather than review.
```

States: today's entries · empty state + CTA · error boundary. Absent (not skeletal) when the capability is off.

---

### MOD-023 (messages)

**Parent**: ARCH-023 · **Target**: `src/messages.ts` · **Purity**: pure data

`LocalizedMessages<MealPlanMessages>` with the required `en` entry, resolved via `resolveMessages` from `@commise/i18n`.
Every planner, widget, validation and error string lives here (FR-038). A lint rule rejects user-visible literals
elsewhere in the package.

**Error copy is keyed by wire `code`, and the wire `message` is never rendered (FR-038a, REQ-023) — added 2026-08-07.**
`MealPlanMessages` carries an `errors` map **total over `MealPlanErrorCode`** plus an `errors.unknown` fallback, and
the selection is a pure `messageForErrorCode(code)`. Two properties follow, and both are load-bearing:

1. **Totality** — a code added to the service's table with no key here fails `typecheck`, not review, so a new failure
   mode cannot ship with no copy. Verified by `UTS-023-A3`.
2. **The fallback is localized copy, never `error.message`.** Falling back to the envelope's `message` is the exact
   defect FR-038a forbids: it is operator-facing English, it is not ours, and — being a member expression rather than
   a string literal — the FR-038 literal audit (`noUserVisibleLiterals.test.ts`) cannot see it. That is why REQ-023 is
   its own requirement with its own check (`STS-008-A7`) rather than a clause on REQ-019.

---

### MOD-024 (QualityComplianceModule) `[CROSS-CUTTING]`

**Parent**: ARCH-024 · **Target**: tooling configs · **Purity**: n/a — build/lint time only

Enforces strict TS, JSDoc + pattern-named module headers, `eslint-plugin-check-file` naming per regime, jsx-a11y, the
`§7.1` test matrix in CI, and a dependency check asserting REQ-NF-009 (no cache/queue/worker/object-store dependency
enters `package.json`). No runtime artifact.

---

### MOD-025 (MealPlanClient)

**Parent**: ARCH-025 · **Target**: `packages/clients/meal-plan-service/src/{client,queries,hooks,errors}.ts`

`ky`-based typed client with TanStack query/mutation definitions, typed error mapping from the shared envelope, a
`testing/` fixture surface (`make*` factories accepting `Partial<T>`), and `__integration__/` contract tests against the
real service. Shared by web and mobile — API clients do not fork per platform (`§14.2`).

---

## ARCH ↔ MOD Traceability

| ARCH     | MOD     | ARCH     | MOD     | ARCH     | MOD     |
| -------- | ------- | -------- | ------- | -------- | ------- |
| ARCH-001 | MOD-001 | ARCH-010 | MOD-010 | ARCH-019 | MOD-019 |
| ARCH-002 | MOD-002 | ARCH-011 | MOD-011 | ARCH-020 | MOD-020 |
| ARCH-003 | MOD-003 | ARCH-012 | MOD-012 | ARCH-021 | MOD-021 |
| ARCH-004 | MOD-004 | ARCH-013 | MOD-013 | ARCH-022 | MOD-022 |
| ARCH-005 | MOD-005 | ARCH-014 | MOD-014 | ARCH-023 | MOD-023 |
| ARCH-006 | MOD-006 | ARCH-015 | MOD-015 | ARCH-024 | MOD-024 |
| ARCH-007 | MOD-007 | ARCH-016 | MOD-016 | ARCH-025 | MOD-025 |
| ARCH-008 | MOD-008 | ARCH-017 | MOD-017 |          |         |
| ARCH-009 | MOD-009 | ARCH-018 | MOD-018 |          |         |

**Coverage**: 25 / 25 ARCH modules (100%), one-to-one. **Derived modules**: 0.

## Purity Summary

| Classification                      | Modules                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| **Pure** (no I/O, clock, or random) | MOD-001..008, MOD-020, MOD-023, plus `selectBoard` inside MOD-019 |
| Impure, `@sideEffect` documented    | MOD-009..019, MOD-021, MOD-022, MOD-025                           |
| Build-time only                     | MOD-024                                                           |

Ten of twenty-five modules — including **all** the business rules and the entire nutrition computation — are pure and
testable with no network, no database and no React. That is the property the May design gave away by putting
`triggerOnEntryAdd(entry): void` on a calculator.
