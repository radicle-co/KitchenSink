# System Test Plan: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/v-model/system-design.md`

## Overview

This document defines the System Test Plan for the Nutrition Planning feature. Every system component
in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or
more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language must be
technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case MUST identify its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (Nutrition Plan Manager)

**Parent Requirements**: REQ-001, REQ-004

#### Test Case: STP-001-A (Create Nutrition Plan — Valid Input Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /api/v1/nutrition-plans` accepts a well-formed payload and returns a persisted `NutritionPlan` object with all required fields.

- **System Scenario: STS-001-A1**
    - **Given** the Auth Integration Adapter (SYS-011) returns a valid `AuthenticatedUser` for the provided JWT
    - **When** `POST /api/v1/nutrition-plans` is called with `{ name: "Bulk Phase", dailyCalories: 2800, protein: 180, carbs: 320, fat: 80, period: "weekly" }`
    - **Then** the response status is `201`, the body contains a `NutritionPlan` with a non-null `id`, `userId` matching the authenticated user, and all submitted macro fields

- **System Scenario: STS-001-A2**
    - **Given** the Auth Integration Adapter (SYS-011) returns a valid `AuthenticatedUser`
    - **When** `POST /api/v1/nutrition-plans` is called with a payload missing the required `dailyCalories` field
    - **Then** the response status is `400` with a structured validation error body

- **System Scenario: STS-001-A3**
    - **Given** no JWT is present in the request headers
    - **When** `POST /api/v1/nutrition-plans` is called with an otherwise valid payload
    - **Then** the response status is `401` and the plan is not persisted to PostgreSQL

#### Test Case: STP-001-B (Retrieve Nutrition Plan — Boundary and Authorization)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that `GET /api/v1/nutrition-plans/:id` enforces row-level security and returns the correct entity from PostgreSQL.

- **System Scenario: STS-001-B1**
    - **Given** a `NutritionPlan` with `id = "plan-abc"` exists in PostgreSQL owned by `userId = "user-1"`
    - **When** `GET /api/v1/nutrition-plans/plan-abc` is called with a JWT resolving to `userId = "user-1"`
    - **Then** the response status is `200` and the body matches the stored `NutritionPlan` record

- **System Scenario: STS-001-B2**
    - **Given** a `NutritionPlan` with `id = "plan-abc"` exists owned by `userId = "user-1"`
    - **When** `GET /api/v1/nutrition-plans/plan-abc` is called with a JWT resolving to `userId = "user-2"` (different owner, non-trainer)
    - **Then** the response status is `403` and no plan data is returned

- **System Scenario: STS-001-B3**
    - **Given** no `NutritionPlan` exists with `id = "plan-xyz"`
    - **When** `GET /api/v1/nutrition-plans/plan-xyz` is called with a valid JWT
    - **Then** the response status is `404`

#### Test Case: STP-001-C (Auth Dependency Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-001 fails safely when SYS-011 (Auth Integration Adapter) is unavailable.

- **System Scenario: STS-001-C1**
    - **Given** SYS-011 throws `UnauthorizedError` for all JWT validation calls
    - **When** `POST /api/v1/nutrition-plans` is called with any payload
    - **Then** the response status is `401`, no database write occurs, and the error is not swallowed

---

### Component Verification: SYS-002 (Meal Plan Linker)

**Parent Requirements**: REQ-002, REQ-IF-001

#### Test Case: STP-002-A (Link Meal Plan — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /api/v1/nutrition-plans/:id/link` correctly associates a meal plan and validates existence via SYS-008.

- **System Scenario: STS-002-A1**
    - **Given** `NutritionPlan` with `id = "plan-1"` exists and SYS-008 confirms `mealPlanId = "mp-1"` exists
    - **When** `POST /api/v1/nutrition-plans/plan-1/link` is called with `{ mealPlanId: "mp-1" }`
    - **Then** the response status is `200`, the returned `NutritionPlan` contains a `linkedMealPlanId = "mp-1"`, and the `MealPlanLink` record is persisted in PostgreSQL

- **System Scenario: STS-002-A2**
    - **Given** `NutritionPlan` with `id = "plan-1"` already has `linkedMealPlanId = "mp-1"`
    - **When** `POST /api/v1/nutrition-plans/plan-1/link` is called again with `{ mealPlanId: "mp-1" }`
    - **Then** the response status is `409` with a conflict error body

- **System Scenario: STS-002-A3**
    - **Given** SYS-008 returns `MealPlanNotFoundError` for `mealPlanId = "mp-999"`
    - **When** `POST /api/v1/nutrition-plans/plan-1/link` is called with `{ mealPlanId: "mp-999" }`
    - **Then** the response status is `404` and no `MealPlanLink` record is created

#### Test Case: STP-002-B (Meal Planning Adapter Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-002 propagates failures from SYS-008 without silent data corruption.

- **System Scenario: STS-002-B1**
    - **Given** SYS-008 is unavailable (network timeout / service error)
    - **When** `POST /api/v1/nutrition-plans/plan-1/link` is called with a valid `mealPlanId`
    - **Then** the response status is `502` or `503`, no `MealPlanLink` record is written, and the error is logged

---

### Component Verification: SYS-003 (Compliance Analyser)

**Parent Requirements**: REQ-003, REQ-NF-005

#### Test Case: STP-003-A (Compliance Calculation — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `GET /api/v1/nutrition-plans/:id/compliance` returns a structured `ComplianceResult` with gap/excess indicators.

- **System Scenario: STS-003-A1**
    - **Given** `NutritionPlan` targets `{ dailyCalories: 2000, protein: 150, carbs: 200, fat: 70 }` and the linked meal plan totals `{ calories: 1800, protein: 130, carbs: 210, fat: 65 }`
    - **When** `GET /api/v1/nutrition-plans/plan-1/compliance` is called
    - **Then** the response body contains `ComplianceResult` with `calories: { gap: 200 }`, `protein: { gap: 20 }`, `carbs: { excess: 10 }`, `fat: { gap: 5 }` and no persistence occurs (in-memory computation)

- **System Scenario: STS-003-A2**
    - **Given** `NutritionPlan` with `id = "plan-no-link"` has no linked meal plan
    - **When** `GET /api/v1/nutrition-plans/plan-no-link/compliance` is called
    - **Then** the response status is `404` with an error indicating no linked meal plan

#### Test Case: STP-003-B (Calculation Accuracy — Boundary Value Analysis)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that compliance calculations remain within the 5% accuracy tolerance (REQ-NF-005).

- **System Scenario: STS-003-B1**
    - **Given** SYS-009 returns food nutritional values and SYS-010 returns recipe nutritional data for a meal plan
    - **When** the Compliance Analyser aggregates totals and computes gap/excess
    - **Then** the computed caloric total deviates by no more than 5% from the sum of source food database values

#### Test Case: STP-003-C (Dependency Fault Injection — Food and Recipe Adapters)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-003 fails gracefully when SYS-009 or SYS-010 are unavailable.

- **System Scenario: STS-003-C1**
    - **Given** SYS-009 throws `FoodDataUnavailableError`
    - **When** `GET /api/v1/nutrition-plans/plan-1/compliance` is called
    - **Then** the response status is `502` or `503` and no partial compliance result is returned

- **System Scenario: STS-003-C2**
    - **Given** SYS-010 throws a network error
    - **When** `GET /api/v1/nutrition-plans/plan-1/compliance` is called
    - **Then** the response status is `502` or `503` and the error is propagated without silent data loss

---

### Component Verification: SYS-004 (Dashboard Visibility Controller)

**Parent Requirements**: REQ-004

#### Test Case: STP-004-A (Plan Listing — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the dashboard listing endpoint returns all nutrition plans owned by the authenticated user.

- **System Scenario: STS-004-A1**
    - **Given** three `NutritionPlan` records exist in PostgreSQL for `userId = "user-1"` and two for `userId = "user-2"`
    - **When** `GET /api/v1/nutrition-plans` is called with a JWT resolving to `userId = "user-1"`
    - **Then** the response body contains exactly three plans, all with `userId = "user-1"`, ordered by creation date descending

- **System Scenario: STS-004-A2**
    - **Given** no `NutritionPlan` records exist for `userId = "user-new"`
    - **When** `GET /api/v1/nutrition-plans` is called with a JWT resolving to `userId = "user-new"`
    - **Then** the response status is `200` and the body contains an empty array

#### Test Case: STP-004-B (SYS-001 Dependency Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-004 fails safely when SYS-001 (Nutrition Plan Manager) read operations fail.

- **System Scenario: STS-004-B1**
    - **Given** the PostgreSQL connection used by SYS-001 is unavailable
    - **When** `GET /api/v1/nutrition-plans` is called
    - **Then** the response status is `503` and no partial plan list is returned

---

### Component Verification: SYS-005 (Trainer-Client Plan Controller)

**Parent Requirements**: REQ-005, REQ-006, REQ-008

#### Test Case: STP-005-A (Trainer Plan Creation — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `POST /api/v1/nutrition-plans/for-client` enforces trainer role, consent, and premium subscription before creating a plan.

- **System Scenario: STS-005-A1**
    - **Given** JWT resolves to a user with `role = "trainer"`, SYS-006 returns `ConsentStatus.GRANTED` for `{ trainerId, clientId }`, and SYS-012 returns `SubscriptionStatus.ACTIVE`
    - **When** `POST /api/v1/nutrition-plans/for-client` is called with `{ clientUserId: "client-1", planData: { ... } }`
    - **Then** the response status is `201` and the returned `NutritionPlan` has `userId = "client-1"` (owned by client)

- **System Scenario: STS-005-A2**
    - **Given** JWT resolves to a user with `role = "member"` (not trainer)
    - **When** `POST /api/v1/nutrition-plans/for-client` is called
    - **Then** the response status is `403` and no plan is created

- **System Scenario: STS-005-A3**
    - **Given** JWT resolves to a trainer, but SYS-006 returns `ConsentStatus.NOT_GRANTED`
    - **When** `POST /api/v1/nutrition-plans/for-client` is called
    - **Then** the response status is `403` with a consent-specific error body and no plan is created

- **System Scenario: STS-005-A4**
    - **Given** JWT resolves to a trainer with consent granted, but SYS-012 returns `SubscriptionStatus.INACTIVE`
    - **When** `POST /api/v1/nutrition-plans/for-client` is called
    - **Then** the response status is `402` and no plan is created

#### Test Case: STP-005-B (Consent and Subscription Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-005 fails safely (blocks operation) when SYS-006 or SYS-012 are unavailable.

- **System Scenario: STS-005-B1**
    - **Given** SYS-006 throws `ConsentNotGrantedError` due to service unavailability
    - **When** `POST /api/v1/nutrition-plans/for-client` is called by a trainer
    - **Then** the response status is `403` or `503` and no plan is created (safe failure)

- **System Scenario: STS-005-B2**
    - **Given** SYS-012 throws `SubscriptionRequiredError` due to service unavailability
    - **When** `POST /api/v1/nutrition-plans/for-client` is called by a trainer with consent
    - **Then** the response status is `402` or `503` and no plan is created (safe failure)

---

### Component Verification: SYS-006 (Consent Manager)

**Parent Requirements**: REQ-008

#### Test Case: STP-006-A (Consent Grant and Revoke — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that consent grant/revoke operations persist to PostgreSQL and that consent-state queries return accurate results.

- **System Scenario: STS-006-A1**
    - **Given** no `ConsentRecord` exists for `{ trainerId: "t-1", clientId: "c-1" }`
    - **When** the consent grant operation is invoked with `{ trainerId: "t-1", clientId: "c-1" }`
    - **Then** a `ConsentRecord` is persisted in PostgreSQL and a subsequent consent-state query returns `ConsentStatus.GRANTED`

- **System Scenario: STS-006-A2**
    - **Given** a `ConsentRecord` exists for `{ trainerId: "t-1", clientId: "c-1" }` with status `GRANTED`
    - **When** the consent revoke operation is invoked
    - **Then** the `ConsentRecord` is updated to `REVOKED` and a subsequent consent-state query returns `ConsentStatus.NOT_GRANTED`

#### Test Case: STP-006-B (Consent State — Equivalence Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View
**Description**: Verifies that all consent state classes (GRANTED, NOT_GRANTED, REVOKED) are handled distinctly.

- **System Scenario: STS-006-B1**
    - **Given** a `ConsentRecord` with status `GRANTED`
    - **When** SYS-005 queries consent state
    - **Then** SYS-006 returns `ConsentStatus.GRANTED` allowing the trainer operation to proceed

- **System Scenario: STS-006-B2**
    - **Given** no `ConsentRecord` exists (never granted)
    - **When** SYS-005 queries consent state
    - **Then** SYS-006 returns `ConsentStatus.NOT_GRANTED` blocking the trainer operation

---

### Component Verification: SYS-007 (AI Recipe Swap Suggester)

**Parent Requirements**: REQ-007

#### Test Case: STP-007-A (Swap Suggestion — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `GET /api/v1/nutrition-plans/:id/swap-suggestions` returns `SwapSuggestion[]` only when a compliance gap exists and the user has a premium subscription.

- **System Scenario: STS-007-A1**
    - **Given** SYS-012 returns `SubscriptionStatus.ACTIVE` and SYS-003 returns a `ComplianceResult` with a caloric gap of 300 kcal
    - **When** `GET /api/v1/nutrition-plans/plan-1/swap-suggestions` is called with a premium JWT
    - **Then** the response status is `200` and the body contains a non-empty `SwapSuggestion[]` with recipe alternatives sourced from SYS-010

- **System Scenario: STS-007-A2**
    - **Given** SYS-012 returns `SubscriptionStatus.INACTIVE`
    - **When** `GET /api/v1/nutrition-plans/plan-1/swap-suggestions` is called
    - **Then** the response status is `402` and no suggestions are returned

- **System Scenario: STS-007-A3**
    - **Given** SYS-012 returns `SubscriptionStatus.ACTIVE` but SYS-003 returns no compliance gap (all targets met)
    - **When** `GET /api/v1/nutrition-plans/plan-1/swap-suggestions` is called
    - **Then** the response status is `404` with an error indicating no compliance gap exists

#### Test Case: STP-007-B (Compliance and Recipe Adapter Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-007 fails safely when SYS-003 or SYS-010 are unavailable.

- **System Scenario: STS-007-B1**
    - **Given** SYS-003 throws `ComplianceUnavailableError`
    - **When** `GET /api/v1/nutrition-plans/plan-1/swap-suggestions` is called
    - **Then** the response status is `502` or `503` and no partial suggestions are returned

---

### Component Verification: SYS-008 (Meal Planning Integration Adapter)

**Parent Requirements**: REQ-IF-001, REQ-CN-001

#### Test Case: STP-008-A (Fetch Meal Plan Totals — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-008 correctly wraps the 006-meal-planning API and returns `MealPlanNutritionTotals` for a valid meal plan ID.

- **System Scenario: STS-008-A1**
    - **Given** the 006-meal-planning service returns nutritional totals for `mealPlanId = "mp-1"`
    - **When** SYS-008 `fetchMealPlanTotals("mp-1")` is called
    - **Then** the returned `MealPlanNutritionTotals` contains `{ calories, protein, carbs, fat }` matching the upstream response

- **System Scenario: STS-008-A2**
    - **Given** the 006-meal-planning service returns a 404 for `mealPlanId = "mp-999"`
    - **When** SYS-008 `fetchMealPlanTotals("mp-999")` is called
    - **Then** `MealPlanNotFoundError` is thrown

#### Test Case: STP-008-B (Auth Dependency Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-008 fails safely when SYS-011 cannot authenticate outbound requests.

- **System Scenario: STS-008-B1**
    - **Given** SYS-011 throws `UnauthorizedError` for outbound request authentication
    - **When** SYS-008 attempts to call the 006-meal-planning API
    - **Then** `UnauthorizedError` is propagated to the caller and no meal plan data is returned

---

### Component Verification: SYS-009 (USDA Food Data Integration Adapter)

**Parent Requirements**: REQ-IF-002, REQ-CN-001

#### Test Case: STP-009-A (Fetch Food Nutritional Data — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-009 correctly wraps the 003-usda-food-data API and returns a `FoodNutritionMap` for a list of food IDs.

- **System Scenario: STS-009-A1**
    - **Given** the 003-usda-food-data service returns nutritional data for `foodIds = ["f-1", "f-2"]`
    - **When** SYS-009 `fetchFoodNutritionalData(["f-1", "f-2"])` is called
    - **Then** the returned `FoodNutritionMap` contains entries for both `"f-1"` and `"f-2"` with `{ calories, protein, carbs, fat }` per food

- **System Scenario: STS-009-A2**
    - **Given** the 003-usda-food-data service is unavailable (timeout)
    - **When** SYS-009 `fetchFoodNutritionalData(["f-1"])` is called
    - **Then** `FoodDataUnavailableError` is thrown

#### Test Case: STP-009-B (Empty Input — Boundary Value Analysis)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies SYS-009 handles an empty food ID list without making an upstream call.

- **System Scenario: STS-009-B1**
    - **Given** an empty `foodIds = []` array is passed
    - **When** SYS-009 `fetchFoodNutritionalData([])` is called
    - **Then** an empty `FoodNutritionMap` is returned without making any network call to 003-usda-food-data

---

### Component Verification: SYS-010 (Recipe App Integration Adapter)

**Parent Requirements**: REQ-IF-003, REQ-CN-001

#### Test Case: STP-010-A (Fetch Recipe Nutrition — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-010 correctly wraps the 001-commise-recipe-app API and returns a `RecipeNutritionMap`.

- **System Scenario: STS-010-A1**
    - **Given** the 001-commise-recipe-app service returns nutritional data for `recipeIds = ["r-1", "r-2"]`
    - **When** SYS-010 `fetchRecipeNutrition(["r-1", "r-2"])` is called
    - **Then** the returned `RecipeNutritionMap` contains entries for both `"r-1"` and `"r-2"` with per-recipe nutritional totals

- **System Scenario: STS-010-A2**
    - **Given** the 001-commise-recipe-app service returns a 404 for `recipeId = "r-999"`
    - **When** SYS-010 `fetchRecipeNutrition(["r-999"])` is called
    - **Then** `RecipeNotFoundError` is thrown

#### Test Case: STP-010-B (Auth Dependency Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that SYS-010 fails safely when SYS-011 cannot authenticate outbound requests.

- **System Scenario: STS-010-B1**
    - **Given** SYS-011 throws `UnauthorizedError` for outbound request authentication
    - **When** SYS-010 attempts to call the 001-commise-recipe-app API
    - **Then** `UnauthorizedError` is propagated to the caller and no recipe data is returned

---

### Component Verification: SYS-011 (Auth Integration Adapter)

**Parent Requirements**: REQ-IF-004, REQ-CN-001

#### Test Case: STP-011-A (JWT Authentication — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-011 correctly validates JWTs via the 002-user-auth service and returns an `AuthenticatedUser`.

- **System Scenario: STS-011-A1**
    - **Given** a valid, non-expired Clerk session token issued by the Clerk instance
    - **When** SYS-011 `authenticateRequest(jwt)` is called
    - **Then** the returned `AuthenticatedUser` contains `{ userId, role, email }` matching the JWT claims

- **System Scenario: STS-011-A2**
    - **Given** an expired JWT
    - **When** SYS-011 `authenticateRequest(jwt)` is called
    - **Then** `UnauthorizedError` is thrown

#### Test Case: STP-011-B (Trainer-Client Relationship Resolution — Equivalence Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Interface View
**Description**: Verifies that SYS-011 resolves trainer-client relationships for all valid relationship classes.

- **System Scenario: STS-011-B1**
    - **Given** `userId = "t-1"` has an active trainer-client relationship with `clientId = "c-1"` in the user/identity service
    - **When** SYS-011 `resolveTrainerClientRelationship({ trainerId: "t-1", clientId: "c-1" })` is called
    - **Then** the relationship is confirmed and the call returns successfully

- **System Scenario: STS-011-B2**
    - **Given** `userId = "t-1"` has no trainer-client relationship with `clientId = "c-99"`
    - **When** SYS-011 `resolveTrainerClientRelationship({ trainerId: "t-1", clientId: "c-99" })` is called
    - **Then** `UnauthorizedError` or a relationship-not-found error is thrown

---

### Component Verification: SYS-012 (Subscription Gate)

**Parent Requirements**: REQ-IF-005, REQ-CN-002

#### Test Case: STP-012-A (Premium Subscription Check — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-012 correctly queries the 010-subscriptions service and returns `SubscriptionStatus`.

- **System Scenario: STS-012-A1**
    - **Given** the 010-subscriptions service returns an active premium subscription for `userId = "user-premium"`
    - **When** SYS-012 `checkSubscription("user-premium")` is called
    - **Then** `SubscriptionStatus.ACTIVE` is returned

- **System Scenario: STS-012-A2**
    - **Given** the 010-subscriptions service returns no active subscription for `userId = "user-free"`
    - **When** SYS-012 `checkSubscription("user-free")` is called
    - **Then** `SubscriptionStatus.INACTIVE` is returned

#### Test Case: STP-012-B (Cache TTL — Boundary Value Analysis)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that the 60-second TTL cache for `SubscriptionStatus` is respected and refreshed on expiry.

- **System Scenario: STS-012-B1**
    - **Given** `SubscriptionStatus.ACTIVE` is cached for `userId = "user-1"` with TTL = 60s
    - **When** SYS-012 `checkSubscription("user-1")` is called within the TTL window
    - **Then** the cached value is returned without making an upstream call to 010-subscriptions

- **System Scenario: STS-012-B2**
    - **Given** the cached `SubscriptionStatus` for `userId = "user-1"` has expired (TTL elapsed)
    - **When** SYS-012 `checkSubscription("user-1")` is called
    - **Then** a fresh call is made to 010-subscriptions and the cache is refreshed with a new 60s TTL

---

### Component Verification: SYS-013 (TypeScript Strict Compliance Layer)

**Parent Requirements**: REQ-NF-001, REQ-NF-002

#### Test Case: STP-013-A (Strict Compilation — Equivalence Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that all TypeScript source files in the feature compile under `strict: true` with no `any` usage outside explicitly marked test doubles.

- **System Scenario: STS-013-A1**
    - **Given** the TypeScript compiler is configured with `strict: true` in `tsconfig.json`
    - **When** `tsc --noEmit` is executed against all source files in the `009-nutrition-planning` feature
    - **Then** the compiler exits with code `0` and reports zero type errors

- **System Scenario: STS-013-A2**
    - **Given** a static analysis scan is run against all source files
    - **When** the scan checks for `any` type usage outside files annotated with `// @test-double`
    - **Then** zero occurrences of `any` are found in non-test-double source files

#### Test Case: STP-013-B (JSDoc Coverage — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View
**Description**: Verifies that all exported functions and interfaces carry JSDoc documentation.

- **System Scenario: STS-013-B1**
    - **Given** a documentation coverage tool is run against all exported symbols in the feature
    - **When** the tool checks for JSDoc presence on every `export function`, `export class`, and `export interface`
    - **Then** 100% of exported symbols have at least one JSDoc comment block

---

### Component Verification: SYS-014 (Accessibility Compliance Layer)

**Parent Requirements**: REQ-NF-003, REQ-NF-004

#### Test Case: STP-014-A (Accessible Component Names — Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View
**Description**: Verifies that all UI components introduced by the feature expose accessible names queryable via `getByRole` or `getByLabel`.

- **System Scenario: STS-014-A1**
    - **Given** the nutrition plan creation form is rendered in a Playwright test environment
    - **When** `page.getByRole("button", { name: /create nutrition plan/i })` is called
    - **Then** the button element is found without throwing a "not found" error

- **System Scenario: STS-014-A2**
    - **Given** the compliance analysis view is rendered with gap/excess indicators
    - **When** `page.getByLabel(/calorie gap/i)` is called
    - **Then** the compliance indicator element is found and accessible

#### Test Case: STP-014-B (Non-Color-Only Compliance Indicators — Equivalence Partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that compliance state (gap/excess) is conveyed by both color and a non-color indicator (icon or text label).

- **System Scenario: STS-014-B1**
    - **Given** the compliance analysis view renders a caloric gap state
    - **When** the DOM is inspected for the gap indicator element
    - **Then** the element contains both a color-coded class AND either an icon element (e.g., `aria-label="gap"`) or a visible text label (e.g., "Gap")

- **System Scenario: STS-014-B2**
    - **Given** the compliance analysis view renders a caloric excess state
    - **When** the DOM is inspected for the excess indicator element
    - **Then** the element contains both a color-coded class AND either an icon element or a visible text label (e.g., "Excess")

---

## Coverage Summary

| Metric                       | Count    |
| ---------------------------- | -------- |
| Total SYS-NNN components     | 14       |
| SYS components with ≥1 STP   | 14       |
| **SYS Coverage**             | **100%** |
| Total Test Cases (STP)       | 30       |
| Total System Scenarios (STS) | 57       |
| Techniques Used              | 4        |

### Technique Distribution

| Technique                  | Test Cases |
| -------------------------- | ---------- |
| Interface Contract Testing | 14         |
| Fault Injection            | 8          |
| Boundary Value Analysis    | 4          |
| Equivalence Partitioning   | 4          |

### Component → Test Case Mapping

| SYS ID  | Component Name                     | Test Cases                      | Scenarios |
| ------- | ---------------------------------- | ------------------------------- | --------- |
| SYS-001 | Nutrition Plan Manager             | STP-001-A, STP-001-B, STP-001-C | 7         |
| SYS-002 | Meal Plan Linker                   | STP-002-A, STP-002-B            | 4         |
| SYS-003 | Compliance Analyser                | STP-003-A, STP-003-B, STP-003-C | 5         |
| SYS-004 | Dashboard Visibility Controller    | STP-004-A, STP-004-B            | 3         |
| SYS-005 | Trainer-Client Plan Controller     | STP-005-A, STP-005-B            | 6         |
| SYS-006 | Consent Manager                    | STP-006-A, STP-006-B            | 4         |
| SYS-007 | AI Recipe Swap Suggester           | STP-007-A, STP-007-B            | 4         |
| SYS-008 | Meal Planning Integration Adapter  | STP-008-A, STP-008-B            | 3         |
| SYS-009 | USDA Food Data Integration Adapter | STP-009-A, STP-009-B            | 3         |
| SYS-010 | Recipe App Integration Adapter     | STP-010-A, STP-010-B            | 3         |
| SYS-011 | Auth Integration Adapter           | STP-011-A, STP-011-B            | 4         |
| SYS-012 | Subscription Gate                  | STP-012-A, STP-012-B            | 4         |
| SYS-013 | TypeScript Strict Compliance Layer | STP-013-A, STP-013-B            | 3         |
| SYS-014 | Accessibility Compliance Layer     | STP-014-A, STP-014-B            | 4         |
