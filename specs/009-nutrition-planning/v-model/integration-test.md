# Integration Test Plan: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for the Nutrition Planning feature. Every architecture module in `architecture-design.md` (ARCH-001 through ARCH-020) has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

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

### Module Verification: ARCH-001 (NutritionPlanController)

**Parent System Components**: SYS-001

#### Test Case: ITP-001-A (NutritionPlanController → NutritionPlanService contract compliance)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 correctly marshals a validated `CreateNutritionPlanDto` and authenticated `userId` to ARCH-002, and that ARCH-002's `NutritionPlan` response is serialised to a 201 HTTP response at the boundary.

- **Integration Scenario: ITS-001-A1**
    - **Given** ARCH-001 receives a well-formed POST request with a valid Bearer JWT and a complete `CreateNutritionPlanDto` body
    - **When** ARCH-001 passes `(userId, planData)` to ARCH-002 `createPlan`
    - **Then** ARCH-001 receives a `NutritionPlan` typed object from ARCH-002 and emits an HTTP 201 response with the serialised plan

- **Integration Scenario: ITS-001-A2**
    - **Given** ARCH-001 receives a POST request with a missing required field in the DTO body
    - **When** ARCH-001 attempts DTO validation before delegating to ARCH-002
    - **Then** ARCH-001 rejects the payload and returns a 400 `{ message, errors[] }` to the caller without invoking ARCH-002

#### Test Case: ITP-001-B (NutritionPlanController → ClerkAuthService fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 correctly propagates an `UnauthorizedError` from ARCH-018 as a 401 response and does not forward the request to ARCH-002.

- **Integration Scenario: ITS-001-B1**
    - **Given** ARCH-018 is configured to return `UnauthorizedError` for an expired JWT
    - **When** ARCH-001 sends the token to ARCH-018 `verifyToken`
    - **Then** ARCH-001 receives `UnauthorizedError` from ARCH-018, returns HTTP 401 to the caller, and does not invoke ARCH-002

---

### Module Verification: ARCH-002 (NutritionPlanService)

**Parent System Components**: SYS-001

#### Test Case: ITP-002-A (NutritionPlanService → NutritionPlanRepository data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-002 transforms a `CreateNutritionPlanDto` + `userId` into a `NewNutritionPlan` insert schema and that the `NutritionPlan` returned by ARCH-003 passes through ARCH-002 unchanged.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-002 receives a valid `(userId, planData)` pair from ARCH-001
    - **When** ARCH-002 sends a `NewNutritionPlan` to ARCH-003 `insert`
    - **Then** ARCH-003 returns a persisted `NutritionPlan` and ARCH-002 forwards it to ARCH-001 without mutation

#### Test Case: ITP-002-B (NutritionPlanService ownership enforcement at boundary)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-002 emits `UnauthorizedError` when the requesting `userId` does not own the target plan, without invoking ARCH-003.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-002 receives a `userId` that does not match the plan owner
    - **When** ARCH-002 evaluates ownership before delegating to ARCH-003
    - **Then** ARCH-002 returns `UnauthorizedError` to ARCH-001 and does not call ARCH-003

---

### Module Verification: ARCH-003 (NutritionPlanRepository)

**Parent System Components**: SYS-001

#### Test Case: ITP-003-A (NutritionPlanRepository → PostgreSQL insert contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-003 accepts a `NewNutritionPlan` Drizzle insert schema and returns a fully-typed `NutritionPlan` select schema after a successful DB insert.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-003 receives a valid `NewNutritionPlan` from ARCH-002
    - **When** ARCH-003 executes the Drizzle ORM insert against the `nutrition_plans` table
    - **Then** ARCH-003 returns a `NutritionPlan` with all non-nullable fields populated to ARCH-002

#### Test Case: ITP-003-B (NutritionPlanRepository → PostgreSQL constraint fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-003 propagates a `DatabaseError` to ARCH-002 when the DB rejects the insert due to a constraint violation.

- **Integration Scenario: ITS-003-B1**
    - **Given** the `nutrition_plans` table has a unique constraint that the incoming `NewNutritionPlan` would violate
    - **When** ARCH-003 sends the insert to PostgreSQL
    - **Then** ARCH-003 propagates a typed `DatabaseError` to ARCH-002 without swallowing the exception

---

### Module Verification: ARCH-004 (DashboardController)

**Parent System Components**: SYS-004

#### Test Case: ITP-004-A (DashboardController → NutritionPlanService listing contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-004 passes the authenticated `userId` to ARCH-002 for plan retrieval and serialises the returned `NutritionPlan[]` as a JSON array ordered by `createdAt` descending.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-004 receives a GET request with a valid Bearer JWT
    - **When** ARCH-004 delegates to ARCH-002 with the extracted `userId`
    - **Then** ARCH-004 receives `NutritionPlan[]` from ARCH-002 and emits an HTTP 200 response with the array ordered by `createdAt` descending

#### Test Case: ITP-004-B (DashboardController → ClerkAuthService fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-004 returns HTTP 401 when ARCH-018 rejects the JWT, without invoking ARCH-002.

- **Integration Scenario: ITS-004-B1**
    - **Given** ARCH-018 returns `UnauthorizedError` for the provided JWT
    - **When** ARCH-004 sends the token to ARCH-018 `verifyToken`
    - **Then** ARCH-004 returns HTTP 401 to the caller and does not invoke ARCH-002

---

### Module Verification: ARCH-005 (MealPlanLinkerController)

**Parent System Components**: SYS-002

#### Test Case: ITP-005-A (MealPlanLinkerController → MealPlanLinkerService contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-005 validates a `LinkMealPlanDto` and passes `(nutritionPlanId, mealPlanId, userId)` to ARCH-006, then serialises the updated `NutritionPlan` response.

- **Integration Scenario: ITS-005-A1**
    - **Given** ARCH-005 receives a POST request with a valid `LinkMealPlanDto` and Bearer JWT
    - **When** ARCH-005 delegates to ARCH-006 `linkMealPlan(nutritionPlanId, mealPlanId)`
    - **Then** ARCH-005 receives an updated `NutritionPlan` from ARCH-006 and emits HTTP 200 with the serialised plan

- **Integration Scenario: ITS-005-A2**
    - **Given** ARCH-006 returns `AlreadyLinkedError` for a duplicate link request
    - **When** ARCH-005 receives the error from ARCH-006
    - **Then** ARCH-005 maps the error to HTTP 409 and returns `{ message }` to the caller

#### Test Case: ITP-005-B (MealPlanLinkerController → MealPlanLinkerService fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-005 maps `MealPlanNotFoundError` from ARCH-006 to HTTP 404.

- **Integration Scenario: ITS-005-B1**
    - **Given** ARCH-006 returns `MealPlanNotFoundError` because the referenced meal plan does not exist
    - **When** ARCH-005 receives the error from ARCH-006
    - **Then** ARCH-005 returns HTTP 404 `{ message }` to the caller

---

### Module Verification: ARCH-006 (MealPlanLinkerService)

**Parent System Components**: SYS-002

#### Test Case: ITP-006-A (MealPlanLinkerService → MealPlanningAdapter + MealPlanLinkRepository data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-006 validates meal plan existence via ARCH-015 before persisting the link via ARCH-007, and that the resulting `NutritionPlan` is returned to ARCH-005.

- **Integration Scenario: ITS-006-A1**
    - **Given** ARCH-015 confirms the meal plan exists and ARCH-007 is ready to accept a `NewMealPlanLink`
    - **When** ARCH-006 sends `(nutritionPlanId, mealPlanId)` through the link lifecycle
    - **Then** ARCH-006 receives a `MealPlanLink` from ARCH-007 and returns an updated `NutritionPlan` to ARCH-005

#### Test Case: ITP-006-B (MealPlanLinkerService → MealPlanningAdapter fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-006 propagates `MealPlanNotFoundError` from ARCH-015 without invoking ARCH-007.

- **Integration Scenario: ITS-006-B1**
    - **Given** ARCH-015 returns `MealPlanNotFoundError` for the requested `mealPlanId`
    - **When** ARCH-006 receives the error from ARCH-015
    - **Then** ARCH-006 propagates `MealPlanNotFoundError` to ARCH-005 and does not invoke ARCH-007

---

### Module Verification: ARCH-007 (MealPlanLinkRepository)

**Parent System Components**: SYS-002

#### Test Case: ITP-007-A (MealPlanLinkRepository → PostgreSQL link insert contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-007 accepts a `NewMealPlanLink` Drizzle insert schema and returns a typed `MealPlanLink` on success.

- **Integration Scenario: ITS-007-A1**
    - **Given** ARCH-007 receives a valid `NewMealPlanLink` from ARCH-006
    - **When** ARCH-007 executes the Drizzle ORM insert against the `meal_plan_links` table
    - **Then** ARCH-007 returns a `MealPlanLink` with all fields populated to ARCH-006

#### Test Case: ITP-007-B (MealPlanLinkRepository → PostgreSQL constraint fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-007 propagates `DatabaseError` to ARCH-006 on a unique constraint violation (duplicate link).

- **Integration Scenario: ITS-007-B1**
    - **Given** the `meal_plan_links` table already contains a row for the given `(nutritionPlanId, mealPlanId)` pair
    - **When** ARCH-007 attempts to insert a duplicate `NewMealPlanLink`
    - **Then** ARCH-007 propagates a typed `DatabaseError` to ARCH-006

---

### Module Verification: ARCH-008 (ComplianceAnalyserService)

**Parent System Components**: SYS-003

#### Test Case: ITP-008-A (ComplianceAnalyserService → MealPlanningAdapter + USDAFoodDataAdapter + RecipeAppAdapter parallel data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-008 fans out to ARCH-015, ARCH-016, and ARCH-017 in parallel via `Promise.all`, aggregates the three nutrition data sources, and returns a `ComplianceResult` to ARCH-009.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-015, ARCH-016, and ARCH-017 all return valid nutrition data for the requested IDs
    - **When** ARCH-008 issues parallel requests to all three adapters
    - **Then** ARCH-008 aggregates the responses and returns a `ComplianceResult { calories, protein, carbs, fat, gaps, excesses }` to ARCH-009 with all fields present

#### Test Case: ITP-008-B (ComplianceAnalyserService → adapter concurrency and partial failure)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-008 handles a `Promise.all` partial failure (one adapter unavailable) by propagating `ComplianceUnavailableError` rather than returning a partial result.

- **Integration Scenario: ITS-008-B1**
    - **Given** ARCH-016 returns `FoodDataUnavailableError` while ARCH-015 and ARCH-017 succeed
    - **When** ARCH-008 awaits the `Promise.all` across all three adapters
    - **Then** ARCH-008 propagates `ComplianceUnavailableError` to ARCH-009 and does not return a partial `ComplianceResult`

#### Test Case: ITP-008-C (ComplianceAnalyserService → NoLinkedMealPlanError fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-008 emits `NoLinkedMealPlanError` when no meal plan is linked to the nutrition plan, without invoking any adapter.

- **Integration Scenario: ITS-008-C1**
    - **Given** the nutrition plan identified by `nutritionPlanId` has no linked meal plan
    - **When** ARCH-008 receives `(nutritionPlanId, userId)` from ARCH-009
    - **Then** ARCH-008 returns `NoLinkedMealPlanError` to ARCH-009 without invoking ARCH-015, ARCH-016, or ARCH-017

---

### Module Verification: ARCH-009 (ComplianceController)

**Parent System Components**: SYS-003

#### Test Case: ITP-009-A (ComplianceController → ComplianceAnalyserService contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-009 passes `(nutritionPlanId, userId)` to ARCH-008 and serialises the returned `ComplianceResult` as an HTTP 200 JSON response.

- **Integration Scenario: ITS-009-A1**
    - **Given** ARCH-009 receives a GET request with a valid `nutritionPlanId` path param and Bearer JWT
    - **When** ARCH-009 delegates to ARCH-008 `analyse(nutritionPlanId, userId)`
    - **Then** ARCH-009 receives a `ComplianceResult` from ARCH-008 and emits HTTP 200 with all nutrient fields serialised

#### Test Case: ITP-009-B (ComplianceController → ComplianceAnalyserService fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 maps `NoLinkedMealPlanError` from ARCH-008 to HTTP 404.

- **Integration Scenario: ITS-009-B1**
    - **Given** ARCH-008 returns `NoLinkedMealPlanError` for the requested plan
    - **When** ARCH-009 receives the error from ARCH-008
    - **Then** ARCH-009 returns HTTP 404 `{ message }` to the caller

---

### Module Verification: ARCH-010 (TrainerClientController)

**Parent System Components**: SYS-005, SYS-006

#### Test Case: ITP-010-A (TrainerClientController → ClerkAuthService + SubscriptionGate contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-010 sequentially calls ARCH-018 for role verification and ARCH-019 for premium subscription check before delegating to ARCH-011.

- **Integration Scenario: ITS-010-A1**
    - **Given** ARCH-018 returns `{ userId: trainerId, roles: [trainer] }` and ARCH-019 returns `{ active: true }`
    - **When** ARCH-010 processes a POST to `/trainer/clients/:clientId/nutrition-plans`
    - **Then** ARCH-010 delegates `(trainerId, clientId, planData)` to ARCH-011 and returns the resulting `NutritionPlan` as HTTP 201

#### Test Case: ITP-010-B (TrainerClientController → SubscriptionGate fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 returns HTTP 402 when ARCH-019 indicates the trainer lacks a premium subscription, without invoking ARCH-011.

- **Integration Scenario: ITS-010-B1**
    - **Given** ARCH-019 returns `SubscriptionRequiredError` for the trainer's `userId`
    - **When** ARCH-010 receives the error from ARCH-019
    - **Then** ARCH-010 returns HTTP 402 `{ message }` to the caller and does not invoke ARCH-011

---

### Module Verification: ARCH-011 (TrainerClientService)

**Parent System Components**: SYS-005, SYS-006

#### Test Case: ITP-011-A (TrainerClientService → ConsentRepository + NutritionPlanService sequential data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-011 gates plan creation on a successful consent check from ARCH-012 before delegating to ARCH-002, and that the resulting `NutritionPlan` (owned by `clientId`) is returned to ARCH-010.

- **Integration Scenario: ITS-011-A1**
    - **Given** ARCH-012 returns `ConsentStatus { granted: true }` for `(trainerId, clientId)`
    - **When** ARCH-011 delegates `(clientId, planData)` to ARCH-002 `createPlan`
    - **Then** ARCH-011 receives a `NutritionPlan` owned by `clientId` from ARCH-002 and returns it to ARCH-010

#### Test Case: ITP-011-B (TrainerClientService → ConsentRepository fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-011 propagates `ConsentNotGrantedError` from ARCH-012 without invoking ARCH-002.

- **Integration Scenario: ITS-011-B1**
    - **Given** ARCH-012 returns `ConsentStatus { granted: false }` for `(trainerId, clientId)`
    - **When** ARCH-011 evaluates the consent gate
    - **Then** ARCH-011 propagates `ConsentNotGrantedError` to ARCH-010 and does not invoke ARCH-002

---

### Module Verification: ARCH-012 (ConsentRepository)

**Parent System Components**: SYS-006

#### Test Case: ITP-012-A (ConsentRepository → PostgreSQL consent query contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-012 accepts `(trainerId, clientId)` and returns a typed `ConsentStatus { granted, grantedAt? }` from the `trainer_client_consents` table.

- **Integration Scenario: ITS-012-A1**
    - **Given** the `trainer_client_consents` table contains a granted consent row for `(trainerId, clientId)`
    - **When** ARCH-012 receives `(trainerId, clientId)` from ARCH-011
    - **Then** ARCH-012 returns `ConsentStatus { granted: true, grantedAt: Date }` to ARCH-011

- **Integration Scenario: ITS-012-A2**
    - **Given** no consent row exists for `(trainerId, clientId)`
    - **When** ARCH-012 queries the `trainer_client_consents` table
    - **Then** ARCH-012 returns `ConsentStatus { granted: false }` to ARCH-011

#### Test Case: ITP-012-B (ConsentRepository → PostgreSQL fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-012 propagates `DatabaseError` to ARCH-011 on a DB failure.

- **Integration Scenario: ITS-012-B1**
    - **Given** the PostgreSQL connection is unavailable when ARCH-012 attempts the consent query
    - **When** ARCH-012 sends the query to the database
    - **Then** ARCH-012 propagates a typed `DatabaseError` to ARCH-011

---

### Module Verification: ARCH-013 (AIRecipeSwapController)

**Parent System Components**: SYS-007

#### Test Case: ITP-013-A (AIRecipeSwapController → ClerkAuthService + SubscriptionGate + AIRecipeSwapService contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-013 validates JWT via ARCH-018, checks premium via ARCH-019, then delegates to ARCH-014 and serialises `SwapSuggestion[]` as HTTP 200.

- **Integration Scenario: ITS-013-A1**
    - **Given** ARCH-018 returns a valid `AuthenticatedUser` and ARCH-019 returns `{ active: true }`
    - **When** ARCH-013 delegates `(nutritionPlanId, userId)` to ARCH-014 `getSuggestions`
    - **Then** ARCH-013 receives `SwapSuggestion[]` from ARCH-014 and emits HTTP 200 with the serialised array

#### Test Case: ITP-013-B (AIRecipeSwapController → SubscriptionGate fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-013 returns HTTP 402 when ARCH-019 rejects the subscription check, without invoking ARCH-014.

- **Integration Scenario: ITS-013-B1**
    - **Given** ARCH-019 returns `SubscriptionRequiredError` for the requesting `userId`
    - **When** ARCH-013 receives the error from ARCH-019
    - **Then** ARCH-013 returns HTTP 402 `{ message }` to the caller and does not invoke ARCH-014

---

### Module Verification: ARCH-014 (AIRecipeSwapService)

**Parent System Components**: SYS-007

#### Test Case: ITP-014-A (AIRecipeSwapService → ComplianceAnalyserService + RecipeAppAdapter data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-014 retrieves compliance gaps from ARCH-008, passes gap nutrient profiles to ARCH-017, and returns ranked `SwapSuggestion[]` to ARCH-013.

- **Integration Scenario: ITS-014-A1**
    - **Given** ARCH-008 returns a `ComplianceResult { gaps }` with identified nutrient gaps
    - **When** ARCH-014 sends the gap nutrient profile to ARCH-017 `fetchAlternativeRecipes`
    - **Then** ARCH-014 receives `RecipeAlternative[]` from ARCH-017, ranks and formats them, and returns `SwapSuggestion[]` to ARCH-013

#### Test Case: ITP-014-B (AIRecipeSwapService → ComplianceAnalyserService fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-014 propagates `ComplianceUnavailableError` from ARCH-008 without invoking ARCH-017.

- **Integration Scenario: ITS-014-B1**
    - **Given** ARCH-008 returns `ComplianceUnavailableError` for the requested plan
    - **When** ARCH-014 receives the error from ARCH-008
    - **Then** ARCH-014 propagates `ComplianceUnavailableError` to ARCH-013 and does not invoke ARCH-017

---

### Module Verification: ARCH-015 (MealPlanningAdapter)

**Parent System Components**: SYS-008

#### Test Case: ITP-015-A (MealPlanningAdapter → 006-meal-planning API contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-015 sends a `mealPlanId` UUID to the 006-meal-planning internal API and returns a typed `MealPlanNutritionTotals` with all nutrient fields to ARCH-008.

- **Integration Scenario: ITS-015-A1**
    - **Given** the 006-meal-planning service is available and the `mealPlanId` exists
    - **When** ARCH-015 receives `mealPlanId` from ARCH-008 and issues the HTTP call
    - **Then** ARCH-015 returns `MealPlanNutritionTotals` with all nutrient fields populated to ARCH-008

#### Test Case: ITP-015-B (MealPlanningAdapter → 006-meal-planning fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-015 propagates `MealPlanNotFoundError` when the 006-meal-planning service returns a 404 for the requested `mealPlanId`.

- **Integration Scenario: ITS-015-B1**
    - **Given** the 006-meal-planning service returns HTTP 404 for the requested `mealPlanId`
    - **When** ARCH-015 receives the 404 response
    - **Then** ARCH-015 propagates a typed `MealPlanNotFoundError` to ARCH-008

---

### Module Verification: ARCH-016 (USDAFoodDataAdapter)

**Parent System Components**: SYS-009

#### Test Case: ITP-016-A (USDAFoodDataAdapter → 003-usda-food-data API contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-016 sends a non-empty `foodIds[]` UUID array to the 003-usda-food-data internal API and returns a `FoodNutritionMap` with all requested IDs present to ARCH-008.

- **Integration Scenario: ITS-016-A1**
    - **Given** the 003-usda-food-data service is available and all `foodIds` exist
    - **When** ARCH-016 receives `foodIds[]` from ARCH-008 and issues the HTTP call
    - **Then** ARCH-016 returns `FoodNutritionMap` with an entry for every requested `foodId` to ARCH-008

#### Test Case: ITP-016-B (USDAFoodDataAdapter → 003-usda-food-data fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-016 propagates `FoodDataUnavailableError` when the 003-usda-food-data service is unreachable or returns a 5xx error.

- **Integration Scenario: ITS-016-B1**
    - **Given** the 003-usda-food-data service returns HTTP 503
    - **When** ARCH-016 receives the error response
    - **Then** ARCH-016 propagates a typed `FoodDataUnavailableError` to ARCH-008

---

### Module Verification: ARCH-017 (RecipeAppAdapter)

**Parent System Components**: SYS-010

#### Test Case: ITP-017-A (RecipeAppAdapter → 001-commise-recipe-app API contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-017 sends a non-empty `recipeIds[]` UUID array to the 001-commise-recipe-app internal API and returns a `RecipeNutritionMap` with all requested IDs present to ARCH-008 or ARCH-014.

- **Integration Scenario: ITS-017-A1**
    - **Given** the 001-commise-recipe-app service is available and all `recipeIds` exist
    - **When** ARCH-017 receives `recipeIds[]` from ARCH-008 and issues the HTTP call
    - **Then** ARCH-017 returns `RecipeNutritionMap` with an entry for every requested `recipeId` to ARCH-008

- **Integration Scenario: ITS-017-A2**
    - **Given** the 001-commise-recipe-app service is available and ARCH-014 provides a gap nutrient profile
    - **When** ARCH-017 receives the gap profile from ARCH-014 and issues the `fetchAlternativeRecipes` call
    - **Then** ARCH-017 returns `RecipeAlternative[]` to ARCH-014

#### Test Case: ITP-017-B (RecipeAppAdapter → 001-commise-recipe-app fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-017 propagates `RecipeDataUnavailableError` when the 001-commise-recipe-app service is unreachable.

- **Integration Scenario: ITS-017-B1**
    - **Given** the 001-commise-recipe-app service returns a connection timeout
    - **When** ARCH-017 attempts the HTTP call
    - **Then** ARCH-017 propagates a typed `RecipeDataUnavailableError` to the calling module (ARCH-008 or ARCH-014)

---

### Module Verification: ARCH-018 (ClerkAuthService)

**Parent System Components**: SYS-011

#### Test Case: ITP-018-A (ClerkAuthService → Clerk session token verification contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-018 accepts a Bearer Clerk session token string and, via `verifyToken` (networkless verification using the `CLERK_JWT_KEY` public key with `azp`/`CLERK_AUTHORIZED_PARTIES` enforcement), returns a typed `AuthenticatedUser { userId, roles, email }` to the calling controller.

- **Integration Scenario: ITS-018-A1**
    - **Given** ARCH-018 receives a valid, non-expired Clerk session token from ARCH-001, ARCH-004, ARCH-005, ARCH-009, ARCH-010, or ARCH-013
    - **When** ARCH-018 verifies the token signature and claims via `verifyToken` against the `CLERK_JWT_KEY` public key (no network round trip), enforcing the authorized party
    - **Then** ARCH-018 returns `AuthenticatedUser { userId, roles, email }` to the calling module

#### Test Case: ITP-018-B (ClerkAuthService → Clerk session token fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-018 propagates `UnauthorizedError` for expired, malformed, or missing Clerk session tokens to all consuming controllers.

- **Integration Scenario: ITS-018-B1**
    - **Given** ARCH-018 receives an expired Clerk session token from any consuming controller
    - **When** ARCH-018 attempts `verifyToken` verification
    - **Then** ARCH-018 returns `UnauthorizedError` to the calling module

- **Integration Scenario: ITS-018-B2**
    - **Given** ARCH-018 receives a malformed (non-token) string from a consuming controller
    - **When** ARCH-018 attempts to parse the token
    - **Then** ARCH-018 returns `UnauthorizedError` to the calling module purely from the networkless `verifyToken` check against the `CLERK_JWT_KEY` public key — with no external network call, since Clerk verification fetches no remote signing keys and performs no outbound round trip

---

### Module Verification: ARCH-019 (SubscriptionGate)

**Parent System Components**: SYS-012

#### Test Case: ITP-019-A (SubscriptionGate → 010-subscriptions API contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-019 accepts a `userId` UUID and returns a typed `SubscriptionStatus { active, tier }` (with 60s TTL cache) to ARCH-010 or ARCH-013.

- **Integration Scenario: ITS-019-A1**
    - **Given** the 010-subscriptions API returns an active premium subscription for `userId`
    - **When** ARCH-019 receives `userId` from ARCH-010 or ARCH-013
    - **Then** ARCH-019 returns `SubscriptionStatus { active: true, tier: 'premium' }` to the calling module

#### Test Case: ITP-019-B (SubscriptionGate → cache concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that concurrent calls to ARCH-019 for the same `userId` within the 60s TTL window result in a single upstream call to the 010-subscriptions API, with all callers receiving the cached result.

- **Integration Scenario: ITS-019-B1**
    - **Given** two simultaneous requests arrive at ARCH-019 for the same `userId` within the 60s TTL window
    - **When** ARCH-019 processes both requests concurrently
    - **Then** ARCH-019 issues exactly one HTTP call to the 010-subscriptions API and returns the cached `SubscriptionStatus` to both callers

#### Test Case: ITP-019-C (SubscriptionGate → 010-subscriptions fault injection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-019 propagates `SubscriptionRequiredError` when the subscription is inactive or the 010-subscriptions API is unavailable.

- **Integration Scenario: ITS-019-C1**
    - **Given** the 010-subscriptions API returns `{ active: false }` for `userId`
    - **When** ARCH-019 evaluates the subscription status
    - **Then** ARCH-019 returns `SubscriptionRequiredError` to the calling module (ARCH-010 or ARCH-013)

---

### Module Verification: ARCH-020 (TypeSafetyAndDocsEnforcer) [CROSS-CUTTING]

**Parent System Components**: SYS-013, SYS-014

#### Test Case: ITP-020-A (TypeSafetyAndDocsEnforcer → TypeScript compiler contract across all module boundaries)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-020 enforces `strict: true` TypeScript compilation across all module boundary types — DTO interfaces, adapter response types, repository schemas, and service return types — with zero compiler errors.

- **Integration Scenario: ITS-020-A1**
    - **Given** all ARCH-001 through ARCH-019 module boundary types are defined with explicit TypeScript types (no `any`)
    - **When** ARCH-020 runs the TypeScript compiler with `strict: true` over the feature scope
    - **Then** ARCH-020 produces zero compiler errors and zero `any` usages at module boundaries

- **Integration Scenario: ITS-020-A2**
    - **Given** a module boundary type is changed to use `any` (e.g., an adapter response type)
    - **When** ARCH-020 runs the TypeScript compiler
    - **Then** ARCH-020 emits a compiler error identifying the offending boundary and the build fails

#### Test Case: ITP-020-B (TypeSafetyAndDocsEnforcer → JSDoc enforcement on exported module interfaces)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-020 enforces JSDoc presence on all exported module boundary symbols (controllers, services, adapters, repositories).

- **Integration Scenario: ITS-020-B1**
    - **Given** all exported symbols across ARCH-001 through ARCH-019 have JSDoc comments
    - **When** ARCH-020 runs the ESLint JSDoc rule over the feature scope
    - **Then** ARCH-020 reports zero JSDoc violations

- **Integration Scenario: ITS-020-B2**
    - **Given** an exported service method is missing its JSDoc comment
    - **When** ARCH-020 runs the ESLint JSDoc rule
    - **Then** ARCH-020 emits a lint error identifying the missing JSDoc and the lint check fails

---

## Coverage Summary

| Metric                                  | Count                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Total Architecture Modules (ARCH)       | 20                                                   |
| Total Integration Test Cases (ITP)      | 42                                                   |
| Total Integration Scenarios (ITS)       | 49                                                   |
| Modules with Interface Contract Testing | 20 (all modules)                                     |
| Modules with Data Flow Testing          | 5 (ARCH-002, ARCH-006, ARCH-008, ARCH-011, ARCH-014) |
| Modules with Interface Fault Injection  | 18 (all except ARCH-019-B, ARCH-020)                 |
| Modules with Concurrency Testing        | 2 (ARCH-008, ARCH-019)                               |
| Cross-Cutting Modules Covered           | 1 / 1 (ARCH-020)                                     |
| **ARCH Coverage**                       | **20 / 20 (100%)**                                   |

### ARCH → ITP Mapping

| ARCH ID  | Module Name               | ITP IDs                         | Techniques Used                                                            |
| -------- | ------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| ARCH-001 | NutritionPlanController   | ITP-001-A, ITP-001-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-002 | NutritionPlanService      | ITP-002-A, ITP-002-B            | Data Flow Testing, Interface Fault Injection                               |
| ARCH-003 | NutritionPlanRepository   | ITP-003-A, ITP-003-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-004 | DashboardController       | ITP-004-A, ITP-004-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-005 | MealPlanLinkerController  | ITP-005-A, ITP-005-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-006 | MealPlanLinkerService     | ITP-006-A, ITP-006-B            | Data Flow Testing, Interface Fault Injection                               |
| ARCH-007 | MealPlanLinkRepository    | ITP-007-A, ITP-007-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-008 | ComplianceAnalyserService | ITP-008-A, ITP-008-B, ITP-008-C | Data Flow Testing, Concurrency Testing, Interface Fault Injection          |
| ARCH-009 | ComplianceController      | ITP-009-A, ITP-009-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-010 | TrainerClientController   | ITP-010-A, ITP-010-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-011 | TrainerClientService      | ITP-011-A, ITP-011-B            | Data Flow Testing, Interface Fault Injection                               |
| ARCH-012 | ConsentRepository         | ITP-012-A, ITP-012-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-013 | AIRecipeSwapController    | ITP-013-A, ITP-013-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-014 | AIRecipeSwapService       | ITP-014-A, ITP-014-B            | Data Flow Testing, Interface Fault Injection                               |
| ARCH-015 | MealPlanningAdapter       | ITP-015-A, ITP-015-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-016 | USDAFoodDataAdapter       | ITP-016-A, ITP-016-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-017 | RecipeAppAdapter          | ITP-017-A, ITP-017-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-018 | ClerkAuthService          | ITP-018-A, ITP-018-B            | Interface Contract Testing, Interface Fault Injection                      |
| ARCH-019 | SubscriptionGate          | ITP-019-A, ITP-019-B, ITP-019-C | Interface Contract Testing, Concurrency Testing, Interface Fault Injection |
| ARCH-020 | TypeSafetyAndDocsEnforcer | ITP-020-A, ITP-020-B            | Interface Contract Testing (×2)                                            |
