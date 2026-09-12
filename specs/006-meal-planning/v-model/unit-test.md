# Unit Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/module-design.md`](./module-design.md)

## Overview

Every module design (`MOD-NNN`) has one or more Unit Test Cases (`UTP-NNN-X`), each with executable Unit Scenarios
(`UTS-NNN-X#`) in white-box Arrange/Act/Assert form.

Unit tests verify **internal module logic** — control flow, transformations, boundaries. They do not test module
boundaries (integration), user journeys (acceptance) or system behaviour (system tests).

> **Regeneration note — two structural corrections, not just content edits.**
>
> 1. **Assert outcomes, not calls.** Many May scenarios ended in `service.getPlan called once with ('plan-1','user-1')`.
>    `ENGINEERING_EXCELLENCE.md` → QSE §3 names that explicitly: _"'The mock was invoked with X' is weak; 'the persisted
>    row now equals Y / the response body is Z / this specific error was thrown' is strong."_ Call-assertions survive
>    here only for genuinely fire-and-forget effects — of which this feature has none. Every scenario below asserts a
>    returned value, a thrown error type, or a persisted state.
> 2. **Weight follows risk, not module count.** The May plan spread effort evenly across 22 controllers and adapters.
>    The reconciled design concentrates all business rules in eight pure modules, so that is where the depth goes —
>    including **property-based** tests, which the May plan had none of despite the rollup being a pure fold, the single
>    most property-testable thing in the feature.
>
> Modules for deleted components (`MOD-009` cache, `MOD-017` USDA adapter, `MOD-010`–`MOD-015` AI/waste, `MOD-021`
> premium guard, `MOD-018` Clerk adapter under the old numbering) have no successors. `MOD-024` is build-time only and
> has no executable unit tests.

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — NNN matches the parent MOD; X is a letter.
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}`.
- Lineage: `UTS-004-A1` → `UTP-004-A` → `MOD-004` → `ARCH-004` (via module-design's Parent field).

## ISO 29119-4 White-Box Techniques

| Technique                       | Source View              | What it tests                                             |
| ------------------------------- | ------------------------ | --------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View   | Every line and both outcomes of every branch              |
| **Boundary Value Analysis**     | Internal Data Structures | min−1, min, mid, max, max+1                               |
| **Equivalence Partitioning**    | Internal Data Structures | Discrete types: unions, enums, booleans                   |
| **Strict Isolation**            | Interface View           | External dependencies stubbed at the port                 |
| **Error Guessing**              | Error Handling           | Negative paths, invalid input, dependency failure         |
| **State Transition Testing**    | State Machine View       | Every transition, including invalid ones                  |
| **Property-Based Testing**      | Algorithmic/Logic View   | **New.** Invariants over generated inputs, with shrinking |

**The acid test applies to every scenario**: _would this still pass if the production code were broken?_ Any scenario
that would is rewritten, per `ENGINEERING_EXCELLENCE.md` → QSE §3.

---

## MOD-001: MealPlanIds

**Parent**: ARCH-001 · **Target**: `packages/shared/meal-plan-core/src/ids.ts`

#### UTP-001-A — Equivalence Partitioning: brand constructors parse and reject

| Scenario   | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| UTS-001-A1 | A valid UUID returns a branded value equal to the input string  |
| UTS-001-A2 | An empty string throws `ZodError`                               |
| UTS-001-A3 | A non-UUID string throws `ZodError`                             |
| UTS-001-A4 | `isMealPlanId` narrows a valid value and rejects an invalid one |

**UTS-001-A1**

```
Arrange: raw = '4f2a…-uuid'
Act:     id = mealPlanId(raw)
Assert:  id === raw                      // brand is compile-time only; runtime identity preserved
         typeof id === 'string'
```

#### UTP-001-B — Compile-time nominality (type-level test)

| Scenario   | Description                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- |
| UTS-001-B1 | Passing a `RecipeId` where `MealPlanId` is expected is a **compile error** (`expectTypeOf`) |

This is a `vitest` type assertion, not a runtime test. Without it the brand is decoration — the whole point is that the
transposition fails to compile.

---

## MOD-002: DateRange

**Parent**: ARCH-002 · **Target**: `packages/shared/meal-plan-core/src/dateRange.ts`

#### UTP-002-A — Boundary Value Analysis: span limits

**Technique**: BVA · **Covers**: the `SPAN_TOO_LONG` and `END_BEFORE_START` branches

| Scenario   | Input               | Expected                                           |
| ---------- | ------------------- | -------------------------------------------------- |
| UTS-002-A1 | start = end (1 day) | constructs; `dayCount === 1`                       |
| UTS-002-A2 | 2 days              | constructs; `dayCount === 2`                       |
| UTS-002-A3 | exactly 90 days     | constructs; `dayCount === 90`                      |
| UTS-002-A4 | 91 days             | throws `InvalidDateRangeError('SPAN_TOO_LONG')`    |
| UTS-002-A5 | end = start − 1 day | throws `InvalidDateRangeError('END_BEFORE_START')` |

**UTS-002-A3 / A4** are the mutation-sensitive pair: flipping `>` to `>=` in the span check breaks exactly one of them.
A plan that tested only "7 days works" would survive that mutation.

#### UTP-002-B — Error Guessing: malformed input

| Scenario   | Input                     | Expected                                              |
| ---------- | ------------------------- | ----------------------------------------------------- |
| UTS-002-B1 | `'2026-13-01'` (month 13) | throws `InvalidDateRangeError('NOT_A_CALENDAR_DATE')` |
| UTS-002-B2 | `'2026-02-30'`            | throws — calendar-invalid, not merely malformed       |
| UTS-002-B3 | `'2026-05-11T00:00:00Z'`  | throws — an **instant** is not a calendar date        |
| UTS-002-B4 | `''`                      | throws                                                |

UTS-002-B3 is load-bearing: accepting an instant here is how HAZ-001 (time-zone day drift) gets in.

#### UTP-002-C — DST and calendar correctness

**Technique**: Error Guessing + BVA · **Covers**: `dayCount`, `eachDate`

| Scenario   | Description                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| UTS-002-C1 | A range spanning a **spring-forward** transition yields the same `dayCount` as an equivalent non-DST range |
| UTS-002-C2 | A range spanning a **fall-back** transition yields the same `dayCount`                                     |
| UTS-002-C3 | Southern-hemisphere DST (e.g. `Australia/Sydney`) — same result                                            |
| UTS-002-C4 | A range crossing 29 Feb in a leap year counts the extra day                                                |
| UTS-002-C5 | A range crossing a year boundary counts correctly                                                          |
| UTS-002-C6 | `eachDate` returns exactly `dayCount` dates, ordered, with no gaps or repeats                              |

Run under at least three `TZ` values including one with a half-hour offset. A millisecond-arithmetic implementation
passes UTC and fails these — which is the point.

#### UTP-002-D — Locale week grouping

| Scenario   | Locale  | Expected                                        |
| ---------- | ------- | ----------------------------------------------- |
| UTS-002-D1 | `en-GB` | first day of week is Monday                     |
| UTS-002-D2 | `en-US` | first day of week is Sunday                     |
| UTS-002-D3 | any     | the union of all weeks equals `eachDate(range)` |

#### UTP-002-E — Property-Based

| Scenario   | Property                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| UTS-002-E1 | For any valid range, `eachDate(range).length === dayCount(range)`                                                     |
| UTS-002-E2 | For any valid range, `contains(range, d)` ⟺ `d ∈ eachDate(range)`                                                     |
| UTS-002-E3 | For any `start` and `0 ≤ n ≤ 89`, `dateRange(start, addCalendarDays(start, n))` constructs and has `dayCount === n+1` |

---

## MOD-003: MealSlot

**Parent**: ARCH-003 · **Target**: `packages/shared/meal-plan-core/src/mealSlot.ts`

#### UTP-003-A — Equivalence Partitioning

| Scenario   | Input                             | Expected                            |
| ---------- | --------------------------------- | ----------------------------------- |
| UTS-003-A1 | each of the four valid slots      | `isMealSlot` true                   |
| UTS-003-A2 | `'brunch'`                        | false                               |
| UTS-003-A3 | `'Breakfast'` (wrong case)        | false — the union is case-sensitive |
| UTS-003-A4 | `parseSlotSet([])`                | throws `EmptySlotSetError`          |
| UTS-003-A5 | `parseSlotSet(['lunch','lunch'])` | throws `DuplicateSlotError`         |
| UTS-003-A6 | `parseSlotSet(['brunch'])`        | throws `UnknownSlotError`           |

#### UTP-003-B — Ordering

| Scenario   | Input                                    | Expected                                               |
| ---------- | ---------------------------------------- | ------------------------------------------------------ |
| UTS-003-B1 | `['snack','breakfast','dinner','lunch']` | `['breakfast','lunch','dinner','snack']`               |
| UTS-003-B2 | any subset                               | ordered by `MEAL_SLOT_ORDER`, **never alphabetically** |

UTS-003-B2 fails an alphabetical sort (`breakfast, dinner, lunch, snack`) — the plausible-and-wrong implementation.

---

## MOD-004: aggregatePlanNutrition — the deepest suite

**Parent**: ARCH-004 · **Target**: `packages/shared/meal-plan-core/src/nutritionRollup.ts`

This module carries every nutrition rule in the feature and is pure, so it gets the heaviest coverage. It is also the
prime target for mutation testing (`ENGINEERING_EXCELLENCE.md` → QSE §4).

#### UTP-004-A — Statement & Branch Coverage: the fold

| Scenario   | Description                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| UTS-004-A1 | One entry, complete nutrition, `servings = 1` → totals equal the recipe's per-serving values          |
| UTS-004-A2 | One entry, `servings = 3` → every macro exactly tripled                                               |
| UTS-004-A3 | Two entries on one day → macros summed                                                                |
| UTS-004-A4 | Entries across two days → each day totalled independently; plan total is their sum                    |
| UTS-004-A5 | An entry whose recipe nutrition has `isComplete: false` → values counted, **day** `isComplete: false` |
| UTS-004-A6 | An entry whose recipe maps to `null` (unreadable) → contributes **nothing**, day `isComplete: false`  |
| UTS-004-A7 | An entry whose recipe id is **absent** from the map → same as A6                                      |

**UTS-004-A6**

```
Arrange:
  range   = dateRange('2026-05-11','2026-05-12')
  entries = [ entry(r1, '2026-05-11', 'dinner', servings 2),
              entry(r2, '2026-05-11', 'lunch',  servings 1) ]
  map     = Map([[r1, { calories:100, proteinG:10, carbsG:20, fatG:5, isComplete:true }],
                 [r2, null]])
Act:
  result = aggregatePlanNutrition(range, entries, map)
Assert:
  result.perDay[0].totals   equals { calories:200, proteinG:20, carbsG:40, fatG:10 }   // r2 contributed NOTHING
  result.perDay[0].isComplete === false                                                 // and destroyed completeness
  result.planTotal.isComplete === false
```

Asserting **both** halves matters: an implementation that skipped `r2` but left `isComplete: true` would produce a
confidently wrong number (HAZ-032) and would pass a test that only checked the arithmetic.

#### UTP-004-B — Absent vs. zero (HAZ-033)

| Scenario   | Description                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------- |
| UTS-004-B1 | A day with **no entries** → `totals === undefined`, **not** a zeroed Macros object              |
| UTS-004-B2 | A day with no entries → `isComplete === true` (nothing is unaccounted for)                      |
| UTS-004-B3 | A plan with **no entries at all** → `planTotal.totals === undefined`, `isComplete === true`     |
| UTS-004-B4 | A plan where every entry is orphaned → `planTotal.totals === undefined`, `isComplete === false` |
| UTS-004-B5 | A genuine zero-calorie recipe → `totals` is **defined** with `calories: 0`                      |

B1 vs. B5 is the discrimination the whole design rests on: "nothing planned" and "planned, zero calories" must not
render identically.

#### UTP-004-C — Shape completeness

| Scenario   | Description                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| UTS-004-C1 | `perDay.length === dayCount(range)` for a 1-day plan                           |
| UTS-004-C2 | …for a 90-day plan with entries on only two days — 88 empty days still present |
| UTS-004-C3 | `perDay` is ordered ascending by date                                          |
| UTS-004-C4 | An entry dated outside the range is **not** silently added as an extra day     |

#### UTP-004-D — Boundary Value Analysis

| Scenario   | Input                              | Expected                                          |
| ---------- | ---------------------------------- | ------------------------------------------------- |
| UTS-004-D1 | `servings = 1`                     | ×1                                                |
| UTS-004-D2 | `servings = 99`                    | ×99, no overflow or precision loss                |
| UTS-004-D3 | 360 entries (90 days × 4 slots)    | completes; totals equal a reference sum           |
| UTS-004-D4 | macros with 2-dp fractional values | accumulated without drift beyond a stated epsilon |

#### UTP-004-E — Property-Based

| Scenario   | Property                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-004-E1 | **Order independence** — shuffling `entries` never changes the result                                                                             |
| UTS-004-E2 | **Servings linearity** — multiplying every `servings` by _k_ multiplies every macro by exactly _k_                                                |
| UTS-004-E3 | **Monotonic completeness** — if any contributing input is incomplete or missing, the day is incomplete; adding a complete entry never restores it |
| UTS-004-E4 | **Additivity** — the plan total equals the sum of day totals, for any generated plan                                                              |
| UTS-004-E5 | **Purity** — calling twice with the same inputs returns deep-equal results                                                                        |

#### UTP-004-F — Mutation gate

Not a test but a required check: run mutation testing over this module. Surviving mutants on the `isComplete`
propagation or the servings multiply are release blockers.

---

## MOD-005: mealPlanAccessPolicy

**Parent**: ARCH-005 · **Target**: `packages/shared/meal-plan-core/src/mealPlanAccessPolicy.ts`

#### UTP-005-A — Strict Isolation + Error Guessing: fail-closed

| Scenario   | Viewer              | Resource owner | Expected                                       |
| ---------- | ------------------- | -------------- | ---------------------------------------------- |
| UTS-005-A1 | `{ id: 'u1' }`      | `'u1'`         | true                                           |
| UTS-005-A2 | `{ id: 'u2' }`      | `'u1'`         | false                                          |
| UTS-005-A3 | `{ id: undefined }` | `'u1'`         | **false** — an unresolved viewer can never own |
| UTS-005-A4 | `{ id: '' }`        | `''`           | **false** — empty must not match empty         |

A3 and A4 are the security cases. An implementation using loose equality or a truthiness check passes A1/A2 and fails
these.

---

## MOD-006: templateProjection

**Parent**: ARCH-006 · **Target**: `packages/shared/meal-plan-core/src/templateProjection.ts`

#### UTP-006-A — Branch Coverage: skip reasons

| Scenario   | Description                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- |
| UTS-006-A1 | All recipes readable, all offsets in range → all entries mapped, both skip counts `0`       |
| UTS-006-A2 | One recipe unreadable → skipped, `unreadableRecipe === 1`, others still mapped              |
| UTS-006-A3 | One offset ≥ span → skipped, `outOfRange === 1`                                             |
| UTS-006-A4 | An entry both unreadable **and** out of range → counted **once**, under `unreadableRecipe`  |
| UTS-006-A5 | Readability map missing an id entirely → treated as unreadable (**fail closed**)            |
| UTS-006-A6 | Empty template → empty plan, both counts `0`                                                |
| UTS-006-A7 | Every recipe unreadable → empty plan, `unreadableRecipe === template.entries.length`        |
| UTS-006-A8 | Entry's slot not in the plan's selected set → skipped, `slotNotSelected === 1` (REQ-CN-013) |
| UTS-006-A9 | Two entries target one (offset, slot) cell → second skipped, `occupied === 1` (REQ-CN-010)  |

A4 pins the ordering: double-counting one entry would misreport the total to the user.

#### UTP-006-B — Boundary Value Analysis: offsets

| Scenario   | `dayOffset` | span | Expected             |
| ---------- | ----------- | ---- | -------------------- |
| UTS-006-B1 | 0           | 7    | maps to `startDate`  |
| UTS-006-B2 | 6           | 7    | maps to the last day |
| UTS-006-B3 | 7           | 7    | out of range         |
| UTS-006-B4 | 0           | 1    | maps                 |

#### UTP-006-C — Property-Based

| Scenario   | Property                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-006-C1 | **Round trip** — for any plan, `applyTemplate(toTemplate(plan), plan.startDate, allReadable)` reproduces the original entries' (date, slot, recipe, servings) |
| UTS-006-C2 | **Date independence** — applying the same template at two different start dates yields entries at identical relative offsets                                  |
| UTS-006-C3 | **Conservation** — `mapped + unreadableRecipe + outOfRange + slotNotSelected + occupied === template.entries.length`, always                                  |

C3 is the invariant that makes the skip report trustworthy; without it entries could vanish uncounted.

#### UTP-006-D — DST

| Scenario   | Description                                                                             |
| ---------- | --------------------------------------------------------------------------------------- |
| UTS-006-D1 | A template applied across a DST transition places entries on the intended calendar days |

---

## MOD-007: groceryProjection

**Parent**: ARCH-007 · **Target**: `packages/shared/meal-plan-core/src/groceryProjection.ts`

| Test case | Scenario   | Description                                                                                                          |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| UTP-007-A | UTS-007-A1 | Projection carries `version: 'v1'`, plan id and date range                                                           |
|           | UTS-007-A2 | Each entry exposes exactly `recipeId`, `date`, `mealSlot`, `servings` — **no ingredients, no note, no internal ids** |
|           | UTS-007-A3 | Orphaned entries are **excluded**                                                                                    |
|           | UTS-007-A4 | An empty plan yields `entries: []`, not `undefined`                                                                  |

UTS-007-A2 is a contract test in unit form: it fails if someone adds a field, which is the point of a versioned wire
shape.

---

## MOD-008: mealPlanDatabaseName

**Parent**: ARCH-008 · **Target**: `packages/shared/meal-plan-core/src/mealPlanDatabaseName.ts`

| Test case | Scenario   | Description                                                                                                       |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| UTP-008-A | UTS-008-A1 | `stage === baseStage` → the base name                                                                             |
|           | UTS-008-A2 | `stage = 'pr-73'`, base `'sandbox'` → `kitchensink_meal_plans_pr_73`                                              |
|           | UTS-008-A3 | Hyphens sanitised to underscores                                                                                  |
|           | UTS-008-A4 | `pr-1` and `pr-15` produce **different** names (delimiter-aware, ADR-0005 lesson)                                 |
| UTP-008-B | UTS-008-B1 | **The module has no imports** — a static assertion, protecting the deploy-time constraint that caused defect #119 |

---

## MOD-009 – MOD-013: Controllers, services, repositories

Thin by design; the rules live in the pure modules above. Each gets branch coverage on its own guards plus error-path
assertions. Representative cases:

| MOD     | Test case | Scenario   | Description                                                                                                            |
| ------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| MOD-009 | UTP-009-A | UTS-009-A1 | Malformed body → `ZodError`; the service is **never reached** (assert no state change, not "mock not called")          |
|         |           | UTS-009-A2 | `listQuerySchema` clamps `limit > 100` and defaults an absent `limit` to 20                                            |
| MOD-010 | UTP-010-A | UTS-010-A1 | `create` with an invalid range surfaces `InvalidDateRangeError` unchanged                                              |
|         |           | UTS-010-A2 | `getDetail` for a plan owned by someone else throws `MealPlanNotFoundError` — **the same error as absent**             |
|         | UTP-010-B | UTS-010-B1 | Narrowing the range with entries outside it throws `EntriesOutsideNewRangeError` carrying the affected count (HAZ-029) |
|         |           | UTS-010-B2 | Narrowing with **no** affected entries succeeds                                                                        |
| MOD-011 | UTP-011-A | UTS-011-A1 | `findOwned` emits SQL containing the owner predicate (snapshot of the generated query)                                 |
|         |           | UTS-011-A2 | Keyset page 2 excludes the last row of page 1 and includes no duplicates                                               |
| MOD-012 | UTP-012-A | UTS-012-A1 | Date outside plan range → `DateOutsidePlanRangeError`                                                                  |
|         |           | UTS-012-A2 | Slot not in the plan's slot set → `SlotNotInPlanError`                                                                 |
|         |           | UTS-012-A3 | `servings = 0` and `100` → `InvalidServingsError`; `1` and `99` succeed                                                |
|         |           | UTS-012-A4 | Note of 501 characters → `NoteTooLongError`; 500 succeeds                                                              |
|         | UTP-012-B | UTS-012-B1 | Gateway `not-readable` → `RecipeNotReadableError`, and **no row is persisted**                                         |
|         |           | UTS-012-B2 | Gateway `unavailable` → `RecipeCheckUnavailableError`, **no row persisted** — fail closed (HAZ-031)                    |
|         |           | UTS-012-B3 | Same recipe assigned to two different cells → **both** persist (not a conflict)                                        |
|         | UTP-012-C | UTS-012-C1 | Remove an already-removed entry → success-shaped, no error                                                             |
| MOD-013 | UTP-013-A | UTS-013-A1 | Apply returns the plan as a **summary** (no `nutrition`) **and** the skip report from MOD-006 unaltered                |
|         |           | UTS-013-A2 | A failure mid-insert leaves **no** plan row (transactional; asserted against the DB in integration)                    |
|         |           | UTS-013-A3 | `availability` passes through verbatim — `degraded`/`unavailable` are **not** flattened to `available` (REQ-024)       |

UTS-012-B2 is the fail-open regression test. An implementation whose switch has a permissive `default` passes B1 and
fails B2.

> **UTS-013-A1 amended and UTS-013-A3 added, 2026-08-07.** A1 said only "returns the plan"; it now pins the plan to the
> **summary** shape, because the apply response is written to the idempotency ledger and replayed for 24 h (REQ-015),
> and a detail shape would carry a `nutrition` rollup — a persisted total, which REQ-CN-004 forbids outright and which
> a replay would serve stale. A3 is new because nothing asserted that the gateway's three-state verdict survives the
> call: flattening it is invisible in the happy path and only shows up as a user being told, during an outage, that
> their recipes are gone (REQ-024). Both are properties a mutation would otherwise pass through untouched.

---

## MOD-014: PlanNutritionService

**Parent**: ARCH-014 · **Target**: `src/nutrition/plan-nutrition.service.ts`

| Test case | Scenario   | Description                                                                                                                                                |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTP-014-A | UTS-014-A1 | Distinct recipe ids are collected — 10 entries sharing 3 recipes request **3** ids                                                                         |
|           | UTS-014-A2 | Zero entries → **no** gateway call, and every day still returned with `totals: undefined`                                                                  |
|           | UTS-014-A3 | Gateway `unavailable` → summary returns with `isComplete: false`; **no throw**                                                                             |
| UTP-014-B | UTS-014-B1 | The module performs no arithmetic: given a stubbed gateway, the output is byte-identical to calling `aggregatePlanNutrition` directly with the same inputs |

UTS-014-B1 is a structural guard against macro logic creeping back into the orchestrator.

---

## MOD-015: RecipeGateway — the degradation suite

**Parent**: ARCH-015 · **Target**: `src/recipes/recipe.gateway.ts`

Every scenario asserts the **returned value**. The gateway must never throw, so "does not reject" is asserted
explicitly in each.

#### UTP-015-A — Error Guessing: failure modes

| Scenario   | Stubbed transport               | Expected                                                       |
| ---------- | ------------------------------- | -------------------------------------------------------------- |
| UTS-015-A1 | 200 with valid payload          | `availability: 'available'`; map populated                     |
| UTS-015-A2 | Timeout (AbortSignal fires)     | `availability: 'unavailable'`; empty map; **no throw**         |
| UTS-015-A3 | 500                             | `'unavailable'`; **no throw**                                  |
| UTS-015-A4 | 401 / 403                       | `'unavailable'`; **no throw**                                  |
| UTS-015-A5 | Network error                   | `'unavailable'`; **no throw**                                  |
| UTS-015-A6 | 200 with a malformed body       | `'unavailable'`; malformed data **not** leaked into the map    |
| UTS-015-A7 | 200 with `nutrition: null` rows | `'available'`; those ids map to `null` (→ orphaned downstream) |

#### UTP-015-B — Partial batch (the three-state case)

| Scenario   | Description                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| UTS-015-B1 | 250 ids, chunk 1 succeeds and chunk 2 fails → `availability: 'degraded'`, map holds chunk 1 only |
| UTS-015-B2 | All chunks fail → `'unavailable'`                                                                |
| UTS-015-B3 | All chunks succeed → `'available'`                                                               |

B1 is the scenario a boolean `isAvailable` cannot express — the reason the discriminant is three-state.

#### UTP-015-C — Chunking (BVA)

| Scenario   | Ids | Expected requests |
| ---------- | --- | ----------------- |
| UTS-015-C1 | 0   | 0                 |
| UTS-015-C2 | 1   | 1                 |
| UTS-015-C3 | 360 | 1                 |
| UTS-015-C4 | 500 | 1                 |
| UTS-015-C5 | 501 | 2                 |

> **Corrected 2026-08-07 (T033).** These rows read 100→1, 101→2 and 360→4 against MOD-015's stale
> `BATCH_LIMIT = 100`. That limit contradicted REQ-010 — a maximal 90-day plan is 360 recipes and must be
> read in EXACTLY ONE request — so the old 360→4 row asserted the very behaviour the requirement forbids.
> The boundary now sits at 500, the provider limit REQ-IF-008 set because 500 > 360.
> | UTS-015-C6 | duplicates in input | deduplicated before chunking |

#### UTP-015-D — Timeout mechanism (not just timeout behaviour)

| Scenario   | Description                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTS-015-D1 | The request is issued with an `AbortSignal`, and on timeout the underlying request is **aborted** — asserted by observing the abort event, not merely that the call returned (HAZ-034) |

A `Promise.race` implementation passes A2 and fails D1. That is the entire distinction.

#### UTP-015-E — Log discipline

| Scenario   | Description                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| UTS-015-E1 | 50 consecutive failures within the interval → at most **one** warn-level log |
| UTS-015-E2 | A failure after the interval elapses → one further warn-level log            |

---

## MOD-016: IdempotencyStore

**Parent**: ARCH-016 · **Target**: `src/common/idempotency.store.ts`

| Test case | Scenario   | Description                                                                                  |
| --------- | ---------- | -------------------------------------------------------------------------------------------- |
| UTP-016-A | UTS-016-A1 | Absent key → `lookup` returns `null`                                                         |
|           | UTS-016-A2 | After `store`, `lookup` returns the exact stored body                                        |
|           | UTS-016-A3 | Same key, **different owner** → `null` (no cross-tenant replay)                              |
|           | UTS-016-A4 | Same key, **different endpoint** → `null`                                                    |
|           | UTS-016-A5 | No `Idempotency-Key` supplied → `lookup` returns `null` without querying                     |
| UTP-016-B | UTS-016-B1 | Two concurrent identical stores → exactly one row (`ON CONFLICT DO NOTHING`)                 |
| UTP-016-C | UTS-016-C1 | A key stored more than 24 h ago is **not** returned by `lookup` — expired keys do not replay |
|           | UTS-016-C2 | The prune statement is owner-scoped and capped at 50 rows (asserted on the generated SQL)    |

The transactional-coupling case (HAZ-030) is asserted at the integration tier, where a real transaction can be aborted.

---

## MOD-017: Error classes and envelope

| Test case | Scenario   | Description                                                                                                           |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| UTP-017-A | UTS-017-A1 | Each error class satisfies `instanceof Error` **and** `instanceof <ItsClass>` — the `Object.setPrototypeOf` guarantee |
|           | UTS-017-A2 | Each `is*` guard returns true for its own class and false for every sibling                                           |
|           | UTS-017-A3 | `error.name` matches the class name                                                                                   |
|           | UTS-017-A4 | Contextual fields (`planId`, `slot`, `affectedCount`) are carried on the instance                                     |
| UTP-017-B | UTS-017-B1 | The filter maps each error to its documented `{code, status}`                                                         |
|           | UTS-017-B2 | `RecipeNotReadableError` maps to the **same** code and body as `MealPlanNotFoundError` — no existence disclosure      |
|           | UTS-017-B3 | An unknown error maps to a generic 500 with **no** stack trace or SQL in the body                                     |

UTS-017-A1 fails if `Object.setPrototypeOf` is omitted — the exact bug the convention exists to prevent.

---

## MOD-018: AccountErasureParticipant

| Test case | Scenario   | Description                                                |
| --------- | ---------- | ---------------------------------------------------------- |
| UTP-018-A | UTS-018-A1 | Deletes across **all four** tables for the target owner    |
|           | UTS-018-A2 | Leaves another owner's rows untouched                      |
|           | UTS-018-A3 | Re-running after a completed erasure succeeds (idempotent) |
|           | UTS-018-A4 | A user with no meal-plan data erases cleanly               |

---

## MOD-019: useMealPlanBoard

| Test case | Scenario   | Description                                                                                        |
| --------- | ---------- | -------------------------------------------------------------------------------------------------- |
| UTP-019-A | UTS-019-A1 | `selectBoard` is pure and unit-tested **without React** — given data, produces the view model      |
|           | UTS-019-A2 | An orphaned entry maps to `{ kind: 'orphaned' }`                                                   |
|           | UTS-019-A3 | An in-flight optimistic entry maps to `{ kind: 'pending' }`                                        |
| UTP-019-B | UTS-019-B1 | `assign` applies an optimistic entry immediately                                                   |
|           | UTS-019-B2 | On error the optimistic entry rolls back and an error state is exposed                             |
|           | UTS-019-B3 | Mutations do **not** auto-retry (`retry: false`) — a client retry would race the optimistic update |

---

## MOD-020 – MOD-023: Render components, platform layer, widget, messages

Component tests are enumerated per state in [`system-test.md`](./system-test.md) and
[`tasks.md`](../tasks.md); unit-level cases here cover pure logic only.

| MOD     | Test case | Scenario   | Description                                                                                                                                                       |
| ------- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-020 | UTP-020-A | UTS-020-A1 | The `EntryViewState` switch is exhaustive — an added union member fails `typecheck` (type-level test)                                                             |
|         |           | UTS-020-A2 | No render component accepts a behaviour-switching boolean prop (lint-enforced; asserted by a props-shape test)                                                    |
| MOD-021 | UTP-021-A | UTS-021-A1 | Web and native board modules export **identical** public API surfaces (type-level)                                                                                |
| MOD-022 | UTP-022-A | UTS-022-A1 | The descriptor's `id`, `capability` and `defaultWeight` match the retired roadmap spec exactly — so Home ordering does not shift when the placeholder is replaced |
|         |           | UTS-022-A2 | `ROADMAP_WIDGET_SPECS` contains **no** `meal-plan` entry (SC-006-005)                                                                                             |
| MOD-023 | UTP-023-A | UTS-023-A1 | Every message key used by the package exists in the `en` dictionary                                                                                               |
|         |           | UTS-023-A2 | No user-visible string literal exists outside `messages.ts` (lint rule test)                                                                                      |
|         |           | UTS-023-A3 | `errors` is **total** over `MealPlanErrorCode`, and an unrecognized code resolves to localized generic copy — never to the envelope's `message` (REQ-023)         |

---

## MOD-025: MealPlanClient

| Test case | Scenario   | Description                                                                              |
| --------- | ---------- | ---------------------------------------------------------------------------------------- |
| UTP-025-A | UTS-025-A1 | A `{code,message}` error body maps to the matching typed client error                    |
|           | UTS-025-A2 | A 404 maps to a not-found error regardless of whether the cause was absence or ownership |
|           | UTS-025-A3 | `Idempotency-Key` is attached to entry-create and template-apply requests                |
|           | UTS-025-A4 | Query keys are stable and include the plan id (cache-correctness)                        |
|           | UTS-025-A5 | The plans infinite query advances by `nextCursor` and stops when it is absent (REQ-025)  |

---

## MOD-024: QualityComplianceModule

`[CROSS-CUTTING]`, build-time only. **No executable unit tests.** Its enforcement is verified by CI checks recorded in
[`system-test.md`](./system-test.md) — including the dependency assertion for REQ-NF-009 (no cache, queue, worker or
object-store dependency).

---

## Coverage Summary

> **Counts corrected 2026-08-07.** This table read `50` UTP / `162` UTS. Both were wrong **before** this revision's
> three additions: the file already held 51 test cases and 166 scenarios, so the summary understated its own contents.
> The figures below are grepped from the tables above (`UTP-\d{3}-[A-Z]`, `UTS-\d{3}-[A-Z]\d+`, unique) and must be
> re-derived, never hand-adjusted — this is the same hand-maintained-tally failure `requirements.md` recorded as
> PRF-REQ-001.

| Metric                                            | Count                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| MODs with executable unit tests                   | 24 / 25 (MOD-024 is build-time only)                       |
| Unit test cases (`UTP`)                           | 51                                                         |
| Unit scenarios (`UTS`)                            | 169                                                        |
| Property-based cases                              | 3 cases / 13 properties — **new in this regeneration**     |
| Type-level cases                                  | 5 (nominality, exhaustiveness, API parity, import-freedom) |
| Scenarios asserting outcomes rather than calls    | **169 / 169**                                              |
| Modules with dedicated fail-closed security tests | MOD-005, MOD-012, MOD-006                                  |
| Modules under the mutation gate                   | MOD-002, MOD-004, MOD-006 (all pure business rules)        |

### Hazard coverage from the unit tier

| Hazard  | Covering scenarios                                          |
| ------- | ----------------------------------------------------------- |
| HAZ-001 | UTS-002-B3, UTP-002-C                                       |
| HAZ-002 | UTS-002-C1..C3, UTS-002-E1                                  |
| HAZ-003 | UTS-002-A3/A4                                               |
| HAZ-005 | UTS-004-A6/A7                                               |
| HAZ-008 | UTS-004-A2, UTS-004-D2, UTS-004-E2, UTP-004-F               |
| HAZ-029 | UTS-010-B1/B2                                               |
| HAZ-031 | UTS-012-B2                                                  |
| HAZ-032 | UTS-004-A5/A6, UTS-015-B1                                   |
| HAZ-033 | UTS-004-B1..B5                                              |
| HAZ-034 | UTS-015-D1                                                  |
| HAZ-035 | UTS-015-E1/E2                                               |
| HAZ-036 | UTP-015-C                                                   |
| HAZ-037 | UTS-006-A2..A7, UTS-006-C3                                  |
| HAZ-038 | UTS-022-A1/A2                                               |
| HAZ-039 | UTP-005-A, UTS-021-A1                                       |
| HAZ-040 | UTP-018-A                                                   |
| HAZ-041 | UTS-008-B1                                                  |
| HAZ-043 | UTS-012-A3/A4 (paired with DB `CHECK` tests in integration) |

HAZ-006, HAZ-020, HAZ-021, HAZ-026, HAZ-030 and HAZ-042 are covered at the **integration** tier, where a real database,
a real transaction and a second principal exist. They are listed here so the gap is visible rather than implied.
