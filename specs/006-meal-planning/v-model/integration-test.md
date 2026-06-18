# Integration Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/006-meal-planning/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for the Meal Planning feature. Every architecture module in `architecture-design.md` (ARCH-001 through ARCH-022) has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys. Language is module-boundary-oriented throughout.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — where NNN matches the parent ARCH, X is a letter suffix (A, B, C...)
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}` — nested under the parent ITP, with numeric suffix (1, 2, 3...)
- Example: `ITS-001-A1` → Scenario 1 of Test Case A verifying ARCH-001

## ISO 29119-4 Integration Test Techniques

Consumer-Driven Contract Testing (CDCT) is included for externally consumed module contracts; provider modules publish contracts and consumer modules validate expectations before integration deployment.

Each test case identifies its technique by name and anchors to a specific architecture view:

| Technique                                | Source View                   | What It Tests                                                 |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| **Interface Contract Testing**           | Interface View                | Module API contracts, data format compliance, error responses |
| **Data Flow Testing**                    | Data Flow View                | End-to-end data transformation chain validation               |
| **Interface Fault Injection**            | Interface View + Process View | Malformed payloads, timeouts, graceful failure                |
| **Concurrency & Race Condition Testing** | Process View                  | Simultaneous access, lock handling, queue ordering            |

## Integration Tests

---

### Module Verification: ARCH-001 (MealPlanController)

**Parent System Components**: SYS-001

#### Test Case: ITP-001-A (MealPlanController → MealPlanService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 correctly marshals validated `CreateMealPlanDTO` to ARCH-002 and propagates the returned `MealPlanDTO` back to the caller without mutation.

- **Integration Scenario: ITS-001-A1**
    - **Given** ARCH-002 (MealPlanService) is available and ARCH-018 (ClerkAuthService) has produced a valid `AuthContext { userId, tier }`
    - **When** ARCH-001 receives a well-formed `CreateMealPlanDTO { name, startDate, endDate, slots[] }` and forwards it to ARCH-002
    - **Then** ARCH-001 receives a `MealPlanDTO` from ARCH-002 and returns HTTP 201 with the unmodified DTO body

- **Integration Scenario: ITS-001-A2**
    - **Given** ARCH-002 raises `InvalidDateRangeException` for a payload where `endDate ≤ startDate`
    - **When** ARCH-001 forwards the DTO to ARCH-002
    - **Then** ARCH-001 translates the domain exception to HTTP 400 `{ message, errors[] }` without leaking internal stack traces

#### Test Case: ITP-001-B (MealPlanController fault isolation from MealPlanService)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 correctly isolates and translates failures from ARCH-002 into well-formed HTTP error responses.

- **Integration Scenario: ITS-001-B1**
    - **Given** ARCH-002 raises `PlanNotFoundException` for a `planId` that does not belong to the authenticated `userId`
    - **When** ARCH-001 forwards a `GET /meal-plans/:id` request to ARCH-002
    - **Then** ARCH-001 returns HTTP 404 `{ message }` and does not expose internal plan identifiers

---

### Module Verification: ARCH-002 (MealPlanService)

**Parent System Components**: SYS-001

#### Test Case: ITP-002-A (MealPlanService → MealPlanRepository contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-002 correctly passes scoped persistence calls to ARCH-003 with the correct `userId` and receives well-typed domain entities.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-003 (MealPlanRepository) is available and contains no existing plans for `userId`
    - **When** ARCH-002 calls `createPlan(dto, userId)` and delegates to ARCH-003
    - **Then** ARCH-003 returns a persisted `MealPlan` entity and ARCH-002 returns it to ARCH-001 without stripping required fields

- **Integration Scenario: ITS-002-A2**
    - **Given** ARCH-003 returns a `MealPlan` entity with `userId` scoping applied
    - **When** ARCH-002 calls `updatePlan(planId, dto, userId)` and ARCH-003 confirms ownership
    - **Then** ARCH-002 returns the updated `MealPlan` entity to ARCH-001

#### Test Case: ITP-002-B (MealPlanService fault propagation from MealPlanRepository)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-002 correctly wraps database-level failures from ARCH-003 into domain exceptions.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-003 throws a database constraint violation (e.g., duplicate plan name)
    - **When** ARCH-002 calls `createPlan(dto, userId)`
    - **Then** ARCH-002 wraps the error in a domain exception and propagates it to ARCH-001 without exposing raw SQL error messages

---

### Module Verification: ARCH-003 (MealPlanRepository)

**Parent System Components**: SYS-001

#### Test Case: ITP-003-A (MealPlanRepository data flow to/from PostgreSQL)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-003 correctly transforms `MealPlan` domain entities to SQL rows and back, with `userId` row-level security scoping enforced at the persistence boundary.

- **Integration Scenario: ITS-003-A1**
    - **Given** the `meal_plans` table is empty for `userId-A` and contains rows for `userId-B`
    - **When** ARCH-003 receives `findAll(userId-A)` from ARCH-002
    - **Then** ARCH-003 returns an empty array and does not include rows belonging to `userId-B`

- **Integration Scenario: ITS-003-A2**
    - **Given** a 30-day meal plan with 120 slots exists for `userId`
    - **When** ARCH-003 receives `findById(planId, userId)` from ARCH-002
    - **Then** ARCH-003 returns the full paginated `MealPlan` entity including all 120 `meal_slots` rows

#### Test Case: ITP-003-B (MealPlanRepository concurrency under simultaneous writes)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-003 handles concurrent plan creation requests for the same `userId` without data corruption.

- **Integration Scenario: ITS-003-B1**
    - **Given** two concurrent `createPlan` calls from ARCH-002 for the same `userId` arrive simultaneously
    - **When** ARCH-003 executes both INSERT operations
    - **Then** both plans are persisted with distinct `id` values and neither write is lost or partially applied

---

### Module Verification: ARCH-004 (RecipeAssignmentController)

**Parent System Components**: SYS-002

#### Test Case: ITP-004-A (RecipeAssignmentController → RecipeAssignmentService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-004 correctly forwards `AssignRecipeDTO` to ARCH-005 and returns the resulting `MealSlotDTO` to the caller.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-005 (RecipeAssignmentService) is available and ARCH-018 has produced a valid `AuthContext`
    - **When** ARCH-004 receives `POST /meal-plans/:id/slots/:slotId/recipes` with a valid `{ recipeId }` body and forwards it to ARCH-005
    - **Then** ARCH-004 receives a `MealSlotDTO` from ARCH-005 and returns HTTP 201

- **Integration Scenario: ITS-004-A2**
    - **Given** ARCH-005 raises `SlotNotFoundException` for an unknown `slotId`
    - **When** ARCH-004 forwards the assignment request to ARCH-005
    - **Then** ARCH-004 returns HTTP 404 `{ message }` without exposing internal slot identifiers

#### Test Case: ITP-004-B (RecipeAssignmentController fault injection from RecipeAssignmentService)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-004 correctly handles upstream failures from ARCH-005 when the Recipe API is unavailable.

- **Integration Scenario: ITS-004-B1**
    - **Given** ARCH-005 raises `ExternalAdapterException` because ARCH-016 (RecipeApiAdapter) is unreachable
    - **When** ARCH-004 forwards the assignment request to ARCH-005
    - **Then** ARCH-004 returns HTTP 503 `{ message }` and does not return a partial assignment

---

### Module Verification: ARCH-005 (RecipeAssignmentService)

**Parent System Components**: SYS-002

#### Test Case: ITP-005-A (RecipeAssignmentService → RecipeApiAdapter + RecipeAssignmentRepository data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-005 correctly orchestrates the assignment flow: ownership check via ARCH-016, then persistence via ARCH-006.

- **Integration Scenario: ITS-005-A1**
    - **Given** ARCH-016 returns a valid `RecipeDTO { id, name, ingredients[] }` for the requested `recipeId`
    - **When** ARCH-005 receives `assign(slotId, recipeId, userId)` from ARCH-004
    - **Then** ARCH-005 passes `{ slotId, recipeId }` to ARCH-006 and returns the persisted `MealSlotDTO` to ARCH-004

- **Integration Scenario: ITS-005-A2**
    - **Given** ARCH-016 returns `RecipeNotFoundException` for a `recipeId` not owned by `userId`
    - **When** ARCH-005 receives `assign(slotId, recipeId, userId)` from ARCH-004
    - **Then** ARCH-005 propagates the exception to ARCH-004 without calling ARCH-006

#### Test Case: ITP-005-B (RecipeAssignmentService bulk assignment concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-005 handles bulk assignment (from ARCH-013 auto-generation) atomically.

- **Integration Scenario: ITS-005-B1**
    - **Given** ARCH-013 (AutoGenerateService) calls `bulkAssign(slots[], recipes[])` with 30 slot-recipe pairs
    - **When** ARCH-005 delegates to ARCH-006 for bulk INSERT within a database transaction
    - **Then** either all 30 assignments are persisted or none are (full rollback on partial failure)

---

### Module Verification: ARCH-006 (RecipeAssignmentRepository)

**Parent System Components**: SYS-002, SYS-005

#### Test Case: ITP-006-A (RecipeAssignmentRepository bulk insert data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-006 correctly transforms `{ slotId, recipeId }[]` arrays into bulk INSERT SQL and returns typed `RecipeAssignment[]` entities.

- **Integration Scenario: ITS-006-A1**
    - **Given** the `recipe_assignments` table is empty for the target `planId`
    - **When** ARCH-006 receives `bulkInsert([{ slotId, recipeId }])` from ARCH-005 with 10 pairs
    - **Then** ARCH-006 returns 10 `RecipeAssignment` entities with correct `slotId` and `recipeId` mappings

#### Test Case: ITP-006-B (RecipeAssignmentRepository cascade delete boundary)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-006 correctly propagates cascade deletes when a meal slot is removed.

- **Integration Scenario: ITS-006-B1**
    - **Given** a `meal_slot` row has 3 associated `recipe_assignments` rows
    - **When** ARCH-006 receives `deleteBySlotId(slotId)` from ARCH-005
    - **Then** all 3 `recipe_assignments` rows are removed and ARCH-006 returns a success confirmation to ARCH-005

---

### Module Verification: ARCH-007 (NutritionalSummaryController)

**Parent System Components**: SYS-003

#### Test Case: ITP-007-A (NutritionalSummaryController → NutritionalSummaryService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-007 correctly forwards `planId` and `userId` to ARCH-008 and returns the `NutritionalSummaryDTO` to the caller.

- **Integration Scenario: ITS-007-A1**
    - **Given** ARCH-008 (NutritionalSummaryService) returns a valid `NutritionalSummaryDTO { daily[], weekly }` for the requested `planId`
    - **When** ARCH-007 receives `GET /meal-plans/:id/nutrition/daily` and forwards to ARCH-008
    - **Then** ARCH-007 returns HTTP 200 with the unmodified `NutritionalSummaryDTO`

- **Integration Scenario: ITS-007-A2**
    - **Given** ARCH-008 raises `NutrientDataUnavailableException` because ARCH-017 is unavailable
    - **When** ARCH-007 forwards the request to ARCH-008
    - **Then** ARCH-007 returns HTTP 503 `{ message }` without returning a partial summary

---

### Module Verification: ARCH-008 (NutritionalSummaryService)

**Parent System Components**: SYS-003

#### Test Case: ITP-008-A (NutritionalSummaryService → NutritionalSummaryCache → UsdaFoodDataAdapter data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the cache-first data flow: ARCH-008 checks ARCH-009 before calling ARCH-017, and correctly aggregates nutrient data into daily/weekly totals.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-009 returns `null` (cache miss) for `planId`
    - **When** ARCH-008 receives `getSummary(planId, userId)` from ARCH-007
    - **Then** ARCH-008 calls ARCH-017 with the ingredient IDs, aggregates the returned `NutrientDataDTO[]`, writes the result to ARCH-009, and returns `NutritionalSummaryDTO` to ARCH-007

- **Integration Scenario: ITS-008-A2**
    - **Given** ARCH-009 returns a cached `NutritionalSummaryDTO` for `planId`
    - **When** ARCH-008 receives `getSummary(planId, userId)` from ARCH-007
    - **Then** ARCH-008 returns the cached DTO to ARCH-007 without calling ARCH-017

#### Test Case: ITP-008-B (NutritionalSummaryService parallel USDA fetch concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-008 correctly uses `Promise.all` for parallel ingredient lookups and handles partial failures.

- **Integration Scenario: ITS-008-B1**
    - **Given** a plan has 50 unique ingredients requiring USDA lookup
    - **When** ARCH-008 calls ARCH-017 `batchFetchNutrients(ingredientIds[])` via `Promise.all`
    - **Then** all 50 nutrient results are received and aggregated without race conditions in the accumulation step

---

### Module Verification: ARCH-009 (NutritionalSummaryCache)

**Parent System Components**: SYS-003

#### Test Case: ITP-009-A (NutritionalSummaryCache → NutritionalSummaryService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-009 correctly returns cached DTOs on hit and `null` on miss, and that cache invalidation is propagated correctly.

- **Integration Scenario: ITS-009-A1**
    - **Given** ARCH-009 has a cached `NutritionalSummaryDTO` for `planId` with TTL > 0
    - **When** ARCH-008 calls `get(planId)` on ARCH-009
    - **Then** ARCH-009 returns the cached `NutritionalSummaryDTO` to ARCH-008

- **Integration Scenario: ITS-009-A2**
    - **Given** a plan mutation occurs (recipe assignment added) and ARCH-002 triggers cache invalidation
    - **When** ARCH-009 receives `invalidate(planId)`
    - **Then** the next `get(planId)` call from ARCH-008 returns `null` (cache miss)

#### Test Case: ITP-009-B (NutritionalSummaryCache graceful degradation on Redis failure)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 swallows `CacheException` and allows ARCH-008 to fall back to USDA computation.

- **Integration Scenario: ITS-009-B1**
    - **Given** the Redis backend is unavailable and ARCH-009 raises `CacheException` internally
    - **When** ARCH-008 calls `get(planId)` on ARCH-009
    - **Then** ARCH-009 returns `null` to ARCH-008 (exception swallowed) and ARCH-008 proceeds to call ARCH-017

---

### Module Verification: ARCH-010 (AISuggestionController)

**Parent System Components**: SYS-004

#### Test Case: ITP-010-A (AISuggestionController → PremiumTierGuard → AISuggestionService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-010 correctly enforces the premium gate via ARCH-021 before delegating to ARCH-011.

- **Integration Scenario: ITS-010-A1**
    - **Given** ARCH-021 (PremiumTierGuard) passes (tier === 'premium') and ARCH-011 returns a valid `SuggestionListDTO`
    - **When** ARCH-010 receives `POST /meal-plans/:id/suggestions` with a valid `SuggestionRequestDTO`
    - **Then** ARCH-010 returns HTTP 200 with the `SuggestionListDTO` from ARCH-011

- **Integration Scenario: ITS-010-A2**
    - **Given** ARCH-021 raises `PaymentRequiredException` (tier === 'free')
    - **When** ARCH-010 receives the suggestion request
    - **Then** ARCH-010 returns HTTP 402 `{ message }` without calling ARCH-011

#### Test Case: ITP-010-B (AISuggestionController fault injection from AISuggestionService)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 correctly handles AI provider unavailability propagated from ARCH-011.

- **Integration Scenario: ITS-010-B1**
    - **Given** ARCH-011 raises `AIProviderException` because ARCH-019 timed out
    - **When** ARCH-010 forwards the suggestion request to ARCH-011
    - **Then** ARCH-010 returns HTTP 503 `{ message }` without returning a partial suggestion list

---

### Module Verification: ARCH-011 (AISuggestionService)

**Parent System Components**: SYS-004

#### Test Case: ITP-011-A (AISuggestionService → AiProviderAdapter data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-011 correctly constructs a `PromptDTO` from dietary preferences, sends it to ARCH-019, and parses the `AIResponseDTO` into a ranked `SuggestionListDTO`.

- **Integration Scenario: ITS-011-A1**
    - **Given** ARCH-019 (AiProviderAdapter) returns `AIResponseDTO { suggestions: string[] }` for a valid `PromptDTO`
    - **When** ARCH-011 receives `getSuggestions(preferences, userId)` from ARCH-010 or ARCH-013
    - **Then** ARCH-011 parses the AI response into a typed `SuggestionListDTO` ordered by confidence score and returns it to the caller

#### Test Case: ITP-011-B (AISuggestionService fault injection from AiProviderAdapter)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-011 correctly propagates `AIProviderException` from ARCH-019 without returning partial data.

- **Integration Scenario: ITS-011-B1**
    - **Given** ARCH-019 raises `AIProviderException` (30s timeout exceeded)
    - **When** ARCH-011 calls `invoke(PromptDTO)` on ARCH-019
    - **Then** ARCH-011 propagates `AIProviderException` to the caller (ARCH-010 or ARCH-013) without returning a partial `SuggestionListDTO`

---

### Module Verification: ARCH-012 (AutoGenerateController)

**Parent System Components**: SYS-005

#### Test Case: ITP-012-A (AutoGenerateController → PremiumTierGuard → AutoGenerateService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-012 enforces the premium gate via ARCH-021 before delegating to ARCH-013 and returns the draft `MealPlanDTO`.

- **Integration Scenario: ITS-012-A1**
    - **Given** ARCH-021 passes (tier === 'premium') and ARCH-013 returns a draft `MealPlanDTO`
    - **When** ARCH-012 receives `POST /meal-plans/auto-generate` with valid preferences and date range
    - **Then** ARCH-012 returns HTTP 201 with the draft `MealPlanDTO` from ARCH-013

- **Integration Scenario: ITS-012-A2**
    - **Given** ARCH-021 raises `PaymentRequiredException` (tier === 'free')
    - **When** ARCH-012 receives the auto-generate request
    - **Then** ARCH-012 returns HTTP 402 `{ message }` without calling ARCH-013

---

### Module Verification: ARCH-013 (AutoGenerateService)

**Parent System Components**: SYS-005

#### Test Case: ITP-013-A (AutoGenerateService → AISuggestionService → RecipeAssignmentService orchestration data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the full auto-generation data flow: ARCH-013 calls ARCH-011 for suggestions, then ARCH-005 for bulk assignment, and returns a complete draft plan.

- **Integration Scenario: ITS-013-A1**
    - **Given** ARCH-011 returns a `SuggestionListDTO` with 21 recipes (3 per day × 7 days) and ARCH-005 successfully bulk-assigns all slots
    - **When** ARCH-013 receives `autoGenerate(preferences, dateRange, userId)` from ARCH-012
    - **Then** ARCH-013 returns a draft `MealPlanDTO` with all slots populated to ARCH-012

#### Test Case: ITP-013-B (AutoGenerateService transactional rollback on bulk assignment failure)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-013 triggers a full rollback when ARCH-005 bulk assignment fails mid-transaction.

- **Integration Scenario: ITS-013-B1**
    - **Given** ARCH-005 raises an exception after inserting 10 of 21 assignments (partial failure)
    - **When** ARCH-013 calls `bulkAssign(slots[], recipes[])` on ARCH-005
    - **Then** ARCH-013 triggers a full database rollback via ARCH-005/ARCH-006 and propagates the error to ARCH-012 without returning a partial plan

---

### Module Verification: ARCH-014 (WasteOptimizerController)

**Parent System Components**: SYS-006

#### Test Case: ITP-014-A (WasteOptimizerController → PremiumTierGuard → WasteOptimizerService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-014 enforces the premium gate via ARCH-021 before delegating to ARCH-015 and returns `OptimizationSuggestionsDTO`.

- **Integration Scenario: ITS-014-A1**
    - **Given** ARCH-021 passes (tier === 'premium') and ARCH-015 returns `OptimizationSuggestionsDTO { swaps[] }`
    - **When** ARCH-014 receives `POST /meal-plans/:id/optimize`
    - **Then** ARCH-014 returns HTTP 200 with the `OptimizationSuggestionsDTO` from ARCH-015

- **Integration Scenario: ITS-014-A2**
    - **Given** ARCH-021 raises `PaymentRequiredException`
    - **When** ARCH-014 receives the optimize request
    - **Then** ARCH-014 returns HTTP 402 `{ message }` without calling ARCH-015

---

### Module Verification: ARCH-015 (WasteOptimizerService)

**Parent System Components**: SYS-006

#### Test Case: ITP-015-A (WasteOptimizerService → MealPlanRepository + UsdaFoodDataAdapter data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-015 correctly fetches plan data from ARCH-003 and ingredient data from ARCH-017 to compute the overlap graph.

- **Integration Scenario: ITS-015-A1**
    - **Given** ARCH-003 returns a `MealPlan` with 14 assigned recipes and ARCH-017 returns `NutrientDataDTO[]` for all ingredients
    - **When** ARCH-015 receives `optimize(planId, userId)` from ARCH-014
    - **Then** ARCH-015 returns `OptimizationSuggestionsDTO { swaps[] }` ranked by ingredient overlap score to ARCH-014

#### Test Case: ITP-015-B (WasteOptimizerService fault injection from UsdaFoodDataAdapter)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-015 correctly propagates `NutrientDataUnavailableException` from ARCH-017.

- **Integration Scenario: ITS-015-B1**
    - **Given** ARCH-017 raises `NutrientDataUnavailableException` (circuit breaker open)
    - **When** ARCH-015 calls `batchFetchNutrients(ingredientIds[])` on ARCH-017
    - **Then** ARCH-015 propagates `NutrientDataUnavailableException` to ARCH-014 without returning partial swap suggestions

---

### Module Verification: ARCH-016 (RecipeApiAdapter)

**Parent System Components**: SYS-007

#### Test Case: ITP-016-A (RecipeApiAdapter → Recipe API contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-016 correctly sends authenticated requests to the Recipe API and deserializes `RecipeDTO` responses.

- **Integration Scenario: ITS-016-A1**
    - **Given** the Recipe API returns HTTP 200 with a valid recipe JSON body for the requested `recipeId`
    - **When** ARCH-005 calls `fetchRecipe(recipeId, userId)` on ARCH-016
    - **Then** ARCH-016 returns a typed `RecipeDTO { id, name, ingredients[] }` to ARCH-005

- **Integration Scenario: ITS-016-A2**
    - **Given** the Recipe API returns HTTP 404 for an unknown `recipeId`
    - **When** ARCH-005 calls `fetchRecipe(recipeId, userId)` on ARCH-016
    - **Then** ARCH-016 raises `RecipeNotFoundException` to ARCH-005

#### Test Case: ITP-016-B (RecipeApiAdapter retry fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-016 retries up to 3 times on network failure before raising `ExternalAdapterException`.

- **Integration Scenario: ITS-016-B1**
    - **Given** the Recipe API is unreachable (connection refused) for all 3 retry attempts
    - **When** ARCH-005 calls `fetchRecipe(recipeId, userId)` on ARCH-016
    - **Then** ARCH-016 raises `ExternalAdapterException` to ARCH-005 after exhausting retries with exponential backoff

---

### Module Verification: ARCH-017 (UsdaFoodDataAdapter)

**Parent System Components**: SYS-007

#### Test Case: ITP-017-A (UsdaFoodDataAdapter batch fetch data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-017 correctly chunks large ingredient lists, fetches in parallel, and returns a complete `NutrientDataDTO[]`.

- **Integration Scenario: ITS-017-A1**
    - **Given** ARCH-008 or ARCH-015 calls `batchFetchNutrients(ingredientIds[])` with 75 ingredient IDs (exceeds 50-item batch limit)
    - **When** ARCH-017 splits the list into two chunks and fetches in parallel via `Promise.all`
    - **Then** ARCH-017 returns a merged `NutrientDataDTO[]` of 75 entries to the caller

#### Test Case: ITP-017-B (UsdaFoodDataAdapter circuit breaker fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-017 opens the circuit breaker after repeated 5xx responses and raises `NutrientDataUnavailableException`.

- **Integration Scenario: ITS-017-B1**
    - **Given** the USDA food data service returns HTTP 503 on consecutive requests (circuit breaker threshold reached)
    - **When** ARCH-008 calls `batchFetchNutrients(ingredientIds[])` on ARCH-017
    - **Then** ARCH-017 raises `NutrientDataUnavailableException` immediately (circuit open) without making additional HTTP calls

---

### Module Verification: ARCH-018 (ClerkAuthService)

**Parent System Components**: SYS-007

#### Test Case: ITP-018-A (ClerkAuthService → downstream modules AuthContext contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-018 correctly validates JWT tokens and produces a well-typed `AuthContext { userId, tier }` consumed by all controllers and ARCH-021.

- **Integration Scenario: ITS-018-A1**
    - **Given** a valid Bearer token with claims `{ sub: userId, tier: 'premium' }` is presented
    - **When** ARCH-018 verifies the token networklessly (via `CLERK_JWT_KEY`) and passes `AuthContext` to ARCH-001, ARCH-004, ARCH-007, ARCH-010, ARCH-012, or ARCH-014
    - **Then** the receiving module receives `AuthContext { userId: string, tier: 'premium' }` with correct field types

- **Integration Scenario: ITS-018-A2**
    - **Given** an expired JWT token is presented
    - **When** ARCH-018 attempts to validate the token
    - **Then** ARCH-018 raises `UnauthorizedException` and the request is rejected with HTTP 401 before reaching any controller

#### Test Case: ITP-018-B (ClerkAuthService unauthorized-party fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-018 rejects a token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`. (Verification is networkless — `verifyToken` via the public `CLERK_JWT_KEY` — so there is no JWKS/issuer endpoint to be unreachable.)

- **Integration Scenario: ITS-018-B1**
    - **Given** a Bearer token whose `azp` claim is not in `CLERK_AUTHORIZED_PARTIES`
    - **When** ARCH-018 attempts to verify the token
    - **Then** ARCH-018 raises `UnauthorizedException` and all downstream modules receive HTTP 401

---

### Module Verification: ARCH-019 (AiProviderAdapter)

**Parent System Components**: SYS-007

#### Test Case: ITP-019-A (AiProviderAdapter → AI provider contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-019 correctly sends `PromptDTO` to the AI provider and deserializes the response into a typed `AIResponseDTO`.

- **Integration Scenario: ITS-019-A1**
    - **Given** the AI provider returns a valid JSON response with `{ suggestions: string[] }`
    - **When** ARCH-011 calls `invoke(PromptDTO)` on ARCH-019
    - **Then** ARCH-019 returns a typed `AIResponseDTO { suggestions: string[] }` to ARCH-011

#### Test Case: ITP-019-B (AiProviderAdapter timeout fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-019 raises `AIProviderException` when the AI provider exceeds the 30-second timeout.

- **Integration Scenario: ITS-019-B1**
    - **Given** the AI provider does not respond within 30 seconds
    - **When** ARCH-011 calls `invoke(PromptDTO)` on ARCH-019
    - **Then** ARCH-019 raises `AIProviderException` to ARCH-011 after the 30-second timeout

- **Integration Scenario: ITS-019-B2**
    - **Given** the AI provider returns a malformed response (non-JSON body)
    - **When** ARCH-011 calls `invoke(PromptDTO)` on ARCH-019
    - **Then** ARCH-019 raises `AIProviderException` to ARCH-011 without returning a partial `AIResponseDTO`

---

### Module Verification: ARCH-020 (MealPlanPublicApiAdapter)

**Parent System Components**: SYS-007

#### Test Case: ITP-020-A (MealPlanPublicApiAdapter versioned serialization data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-020 correctly transforms a `MealPlan` domain entity into a versioned `PublicMealPlanDTO` consumable by downstream features 007 and 009.

- **Integration Scenario: ITS-020-A1**
    - **Given** ARCH-003 returns a `MealPlan` entity with slots and assignments populated
    - **When** ARCH-020 receives `serialize(plan, 'v1')` from a downstream consumer (feature 007 or 009)
    - **Then** ARCH-020 returns `PublicMealPlanDTO { planId, slots[], nutritionSummary? }` in v1 format without internal domain fields

#### Test Case: ITP-020-B (MealPlanPublicApiAdapter serialization fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-020 raises `SerializationException` on malformed input rather than returning a partial DTO.

- **Integration Scenario: ITS-020-B1**
    - **Given** the `MealPlan` entity passed to ARCH-020 has a null `slots` field (unexpected state)
    - **When** ARCH-020 calls `serialize(plan, 'v1')`
    - **Then** ARCH-020 raises `SerializationException` to the caller without returning a partial `PublicMealPlanDTO`

---

### Module Verification: ARCH-021 (PremiumTierGuard)

**Parent System Components**: SYS-004, SYS-005, SYS-006

#### Test Case: ITP-021-A (PremiumTierGuard → ClerkAuthService AuthContext contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-021 correctly reads `AuthContext.tier` from the request context (populated by ARCH-018) and enforces the premium gate.

- **Integration Scenario: ITS-021-A1**
    - **Given** ARCH-018 has populated `AuthContext { userId, tier: 'premium' }` on the request
    - **When** ARCH-021 calls `canActivate(context)` for a premium-gated endpoint (ARCH-010, ARCH-012, or ARCH-014)
    - **Then** ARCH-021 returns `true` and the request proceeds to the target controller

- **Integration Scenario: ITS-021-A2**
    - **Given** ARCH-018 has populated `AuthContext { userId, tier: 'free' }` on the request
    - **When** ARCH-021 calls `canActivate(context)` for a premium-gated endpoint
    - **Then** ARCH-021 raises `PaymentRequiredException` (HTTP 402) and the request does not reach the target controller

#### Test Case: ITP-021-B (PremiumTierGuard concurrent premium checks)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-021 correctly handles concurrent requests from the same user without tier state leaking between requests.

- **Integration Scenario: ITS-021-B1**
    - **Given** two concurrent requests arrive: one with `tier: 'premium'` and one with `tier: 'free'` for the same premium-gated endpoint
    - **When** ARCH-021 evaluates both requests simultaneously
    - **Then** the premium request proceeds and the free-tier request is rejected with HTTP 402, with no tier state shared between the two request contexts

---

### Module Verification: ARCH-022 (QualityComplianceModule) `[CROSS-CUTTING]`

**Parent System Components**: SYS-008

#### Test Case: ITP-022-A (QualityComplianceModule → CI pipeline build-time contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-022 correctly enforces TypeScript strict-mode and JSDoc/accessibility lint rules at the CI boundary, blocking non-compliant code from merging.

- **Integration Scenario: ITS-022-A1**
    - **Given** a module in the meal planning feature introduces a TypeScript `any` type without explicit annotation
    - **When** the CI pipeline runs the TypeScript compiler with `tsconfig.json { strict: true, noImplicitAny: true }`
    - **Then** the build step fails and the CI pipeline reports a compliance violation, blocking the PR merge

- **Integration Scenario: ITS-022-A2**
    - **Given** a React component in the meal planning feature renders an interactive element without an `aria-label` attribute
    - **When** the CI pipeline runs ESLint with `jsx-a11y` rules enabled
    - **Then** the lint step fails and the CI pipeline reports an accessibility compliance violation, blocking the PR merge

---

## Coverage Summary

| ARCH ID   | Module Name                  | ITP Count | ITS Count | Techniques Applied                                               |
| --------- | ---------------------------- | --------- | --------- | ---------------------------------------------------------------- |
| ARCH-001  | MealPlanController           | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-002  | MealPlanService              | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-003  | MealPlanRepository           | 2         | 3         | Data Flow Testing, Concurrency & Race Condition Testing          |
| ARCH-004  | RecipeAssignmentController   | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-005  | RecipeAssignmentService      | 2         | 3         | Data Flow Testing, Concurrency & Race Condition Testing          |
| ARCH-006  | RecipeAssignmentRepository   | 2         | 2         | Data Flow Testing, Interface Contract Testing                    |
| ARCH-007  | NutritionalSummaryController | 1         | 2         | Interface Contract Testing                                       |
| ARCH-008  | NutritionalSummaryService    | 2         | 3         | Data Flow Testing, Concurrency & Race Condition Testing          |
| ARCH-009  | NutritionalSummaryCache      | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-010  | AISuggestionController       | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-011  | AISuggestionService          | 2         | 2         | Data Flow Testing, Interface Fault Injection                     |
| ARCH-012  | AutoGenerateController       | 1         | 2         | Interface Contract Testing                                       |
| ARCH-013  | AutoGenerateService          | 2         | 2         | Data Flow Testing, Interface Fault Injection                     |
| ARCH-014  | WasteOptimizerController     | 1         | 2         | Interface Contract Testing                                       |
| ARCH-015  | WasteOptimizerService        | 2         | 2         | Data Flow Testing, Interface Fault Injection                     |
| ARCH-016  | RecipeApiAdapter             | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-017  | UsdaFoodDataAdapter          | 2         | 2         | Data Flow Testing, Interface Fault Injection                     |
| ARCH-018  | ClerkAuthService             | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-019  | AiProviderAdapter            | 2         | 3         | Interface Contract Testing, Interface Fault Injection            |
| ARCH-020  | MealPlanPublicApiAdapter     | 2         | 2         | Data Flow Testing, Interface Fault Injection                     |
| ARCH-021  | PremiumTierGuard             | 2         | 3         | Interface Contract Testing, Concurrency & Race Condition Testing |
| ARCH-022  | QualityComplianceModule      | 1         | 2         | Interface Contract Testing                                       |
| **Total** |                              | **40**    | **57**    | All 4 ISO 29119-4 techniques applied                             |

## Traceability

All 22 ARCH modules (ARCH-001 through ARCH-022) have at least one ITP. All 4 mandatory ISO 29119-4 integration test techniques are represented:

- **Interface Contract Testing**: ARCH-001, ARCH-002, ARCH-004, ARCH-006, ARCH-007, ARCH-009, ARCH-010, ARCH-012, ARCH-014, ARCH-016, ARCH-018, ARCH-019, ARCH-021, ARCH-022
- **Data Flow Testing**: ARCH-003, ARCH-005, ARCH-006, ARCH-008, ARCH-011, ARCH-013, ARCH-015, ARCH-017, ARCH-020
- **Interface Fault Injection**: ARCH-001, ARCH-002, ARCH-004, ARCH-009, ARCH-010, ARCH-011, ARCH-013, ARCH-015, ARCH-016, ARCH-017, ARCH-018, ARCH-019, ARCH-020
- **Concurrency & Race Condition Testing**: ARCH-003, ARCH-005, ARCH-008, ARCH-021
