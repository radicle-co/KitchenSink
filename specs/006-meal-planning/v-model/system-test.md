# System Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/006-meal-planning/v-model/system-design.md`

## Overview

This document defines the System Test Plan for the Meal Planning feature. Every system component in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language is technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case identifies its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (Meal Plan Manager)

**Parent Requirements**: REQ-001, REQ-002, REQ-009, REQ-010

#### Test Case: STP-001-A (Meal Plan REST API Contract — Create and Read)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Meal Plan REST API correctly accepts `CreateMealPlanDTO`, persists a `MealPlan` entity with row-level security, and returns a well-formed `MealPlanDTO`.

- **System Scenario: STS-001-A1**
    - **Given** a valid `AuthContext { userId: "u1", tier: "free" }` is resolved from a Bearer JWT and a `CreateMealPlanDTO { startDate: "2026-06-01", endDate: "2026-06-07", slots: ["breakfast","lunch","dinner","snacks"] }` is submitted to `POST /meal-plans`
    - **When** the Meal Plan Manager processes the request
    - **Then** a `MealPlan` row is inserted into PostgreSQL with `userId = "u1"`, the response status is HTTP 201, and the body matches `MealPlanDTO { id, startDate, endDate, slots[], status: "draft" }`

- **System Scenario: STS-001-A2**
    - **Given** a `MealPlan` with `id = "mp1"` owned by `userId = "u1"` exists in PostgreSQL
    - **When** `GET /meal-plans/mp1` is called with a Bearer token resolving to `userId = "u1"`
    - **Then** the response is HTTP 200 with `MealPlanDTO` containing all persisted fields; row-level security prevents access by any other `userId`

#### Test Case: STP-001-B (Meal Plan Lifecycle State Transitions)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the Meal Plan Manager enforces valid lifecycle state transitions (draft → active → archived) and rejects invalid transitions.

- **System Scenario: STS-001-B1**
    - **Given** a `MealPlan` in state `"draft"` exists for `userId = "u1"`
    - **When** `PATCH /meal-plans/{id}` is called with `{ status: "active" }`
    - **Then** the plan state transitions to `"active"` and the response is HTTP 200 with updated `MealPlanDTO`

- **System Scenario: STS-001-B2**
    - **Given** a `MealPlan` in state `"archived"` exists
    - **When** `PATCH /meal-plans/{id}` is called with `{ status: "draft" }`
    - **Then** the response is HTTP 400 with an error body indicating an invalid state transition; the plan state remains `"archived"`

#### Test Case: STP-001-C (30-Day Boundary — Scalability Constraint)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that the Meal Plan Manager correctly handles plans at the 30-day boundary and beyond without functional degradation.

- **System Scenario: STS-001-C1**
    - **Given** a `CreateMealPlanDTO` with `startDate = "2026-06-01"` and `endDate = "2026-07-01"` (exactly 30 days) is submitted
    - **When** the Meal Plan Manager processes the request
    - **Then** the plan is created with 30 `MealSlot` rows per slot type, the response is HTTP 201, and `GET /meal-plans/{id}` returns all 30 days without truncation

- **System Scenario: STS-001-C2**
    - **Given** a `CreateMealPlanDTO` with a date range of 90 days is submitted
    - **When** the Meal Plan Manager processes the request
    - **Then** the plan is created successfully, all 90 days are persisted, and paginated `GET /meal-plans/{id}/slots` returns complete results across pages

#### Test Case: STP-001-D (Authentication Gate — Clerk Auth Adapter Failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Meal Plan Manager blocks all operations when the Clerk session token validation call to SYS-007 fails.

- **System Scenario: STS-001-D1**
    - **Given** the Clerk session-token verification interface in SYS-007 is configured to throw `UnauthorizedException`
    - **When** `POST /meal-plans` is called with any Bearer token
    - **Then** the response is HTTP 401, no `MealPlan` row is inserted, and the error body contains `{ error: "Unauthorized" }`

---

### Component Verification: SYS-002 (Recipe Assignment Service)

**Parent Requirements**: REQ-003, REQ-009

#### Test Case: STP-002-A (Recipe Assignment REST API Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Recipe Assignment REST API accepts `AssignRecipeDTO { slotId, recipeId }`, validates recipe ownership via SYS-007, and returns a well-formed `MealSlotDTO`.

- **System Scenario: STS-002-A1**
    - **Given** a `MealSlot` with `id = "slot1"` exists in plan `"mp1"` owned by `userId = "u1"`, and the Recipe API adapter in SYS-007 returns `RecipeDTO { id: "r1", ingredients: [...] }` for `recipeId = "r1"`
    - **When** `POST /meal-plans/mp1/slots/slot1/recipes` is called with `AssignRecipeDTO { slotId: "slot1", recipeId: "r1" }` and a valid auth token for `userId = "u1"`
    - **Then** a `RecipeAssignment` row is inserted into PostgreSQL, the response is HTTP 201, and the body matches `MealSlotDTO { id: "slot1", recipeId: "r1", ... }`

- **System Scenario: STS-002-A2**
    - **Given** the Recipe API adapter in SYS-007 returns HTTP 404 for `recipeId = "r-nonexistent"`
    - **When** `POST /meal-plans/mp1/slots/slot1/recipes` is called with `AssignRecipeDTO { recipeId: "r-nonexistent" }`
    - **Then** the response is HTTP 404 with `{ error: "RecipeNotFoundException" }` and no `RecipeAssignment` row is inserted

#### Test Case: STP-002-B (Recipe Ownership Validation — Cross-User Isolation)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the Recipe Assignment Service rejects assignment of recipes not belonging to the authenticated user.

- **System Scenario: STS-002-B1**
    - **Given** `recipeId = "r2"` belongs to `userId = "u2"` in the Recipe API, and the request is authenticated as `userId = "u1"`
    - **When** `POST /meal-plans/mp1/slots/slot1/recipes` is called with `AssignRecipeDTO { recipeId: "r2" }`
    - **Then** the response is HTTP 404 (recipe not found in user's collection) and no `RecipeAssignment` row is inserted

#### Test Case: STP-002-C (Recipe API Adapter Failure — Fault Injection)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Recipe Assignment Service propagates Recipe API adapter failures correctly when SYS-007 is unavailable.

- **System Scenario: STS-002-C1**
    - **Given** the Recipe API adapter in SYS-007 is configured to throw a network timeout exception
    - **When** `POST /meal-plans/mp1/slots/slot1/recipes` is called with a valid `AssignRecipeDTO`
    - **Then** the response is HTTP 503, no `RecipeAssignment` row is inserted, and the error body indicates upstream dependency failure

---

### Component Verification: SYS-003 (Nutritional Summary Engine)

**Parent Requirements**: REQ-004, REQ-005, REQ-011

#### Test Case: STP-003-A (Nutritional Summary REST API Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Nutritional Summary REST API returns a well-formed `NutritionalSummaryDTO { daily[], weekly }` for a plan with assigned recipes.

- **System Scenario: STS-003-A1**
    - **Given** a `MealPlan` with 7 days of assigned recipes exists, and the USDA Food Data adapter in SYS-007 returns `NutrientDataDTO[]` for all ingredient IDs
    - **When** `GET /meal-plans/{id}/nutrition` is called with a valid auth token
    - **Then** the response is HTTP 200 with `NutritionalSummaryDTO` containing 7 `daily[]` entries and a `weekly` aggregate; values match the sum of USDA nutrient data for all assigned recipes

- **System Scenario: STS-003-A2**
    - **Given** a `MealPlan` with no assigned recipes exists
    - **When** `GET /meal-plans/{id}/nutrition` is called
    - **Then** the response is HTTP 200 with `NutritionalSummaryDTO { daily: [{ calories: 0, ... }], weekly: { calories: 0, ... } }`

#### Test Case: STP-003-B (Nutritional Summary Cache Behavior)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View
**Description**: Verifies that computed `NutritionalSummary` values are cached in Redis with a 1-hour TTL and invalidated on plan change.

- **System Scenario: STS-003-B1**
    - **Given** `GET /meal-plans/{id}/nutrition` has been called once and the result is cached in Redis
    - **When** `GET /meal-plans/{id}/nutrition` is called again within 1 hour
    - **Then** the USDA Food Data adapter in SYS-007 is NOT called; the cached `NutritionalSummaryDTO` is returned with HTTP 200

- **System Scenario: STS-003-B2**
    - **Given** a cached `NutritionalSummary` exists for plan `"mp1"` in Redis
    - **When** a recipe is assigned to a slot in `"mp1"` (SYS-002 write)
    - **Then** the Redis cache entry for `"mp1"` is invalidated; the next `GET /meal-plans/mp1/nutrition` call recomputes from USDA data

#### Test Case: STP-003-C (USDA Adapter Failure — Degraded Response)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Nutritional Summary Engine returns HTTP 503 when the USDA Food Data adapter in SYS-007 is unavailable.

- **System Scenario: STS-003-C1**
    - **Given** the USDA Food Data adapter in SYS-007 is configured to throw `NutrientDataUnavailableException`
    - **When** `GET /meal-plans/{id}/nutrition` is called and no cached result exists
    - **Then** the response is HTTP 503 with `{ error: "NutrientDataUnavailable" }`; no partial summary is returned

---

### Component Verification: SYS-004 (AI Meal Suggestion Service)

**Parent Requirements**: REQ-006

#### Test Case: STP-004-A (AI Suggestions REST API Contract — Premium Gate)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the AI Suggestions REST API enforces the premium tier gate and returns a well-formed `SuggestionListDTO` for eligible users.

- **System Scenario: STS-004-A1**
    - **Given** `AuthContext { userId: "u1", tier: "premium" }` is resolved and the AI provider adapter in SYS-007 returns `AIResponseDTO { suggestions: ["r1","r2","r3"] }` for a valid `PromptDTO`
    - **When** `POST /meal-plans/{id}/suggestions` is called with `SuggestionRequestDTO { preferences: { diet: "vegetarian" }, planId: "mp1" }`
    - **Then** the response is HTTP 200 with `SuggestionListDTO { recipes: ["r1","r2","r3"] }`

- **System Scenario: STS-004-A2**
    - **Given** `AuthContext { userId: "u2", tier: "free" }` is resolved
    - **When** `POST /meal-plans/{id}/suggestions` is called
    - **Then** the response is HTTP 402 with `{ error: "PremiumRequired" }`; the AI provider adapter is NOT invoked

#### Test Case: STP-004-B (AI Provider Adapter Failure — Graceful Degradation)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the AI Meal Suggestion Service returns HTTP 503 and does not crash when the AI provider adapter in SYS-007 throws `AIProviderException`.

- **System Scenario: STS-004-B1**
    - **Given** `AuthContext { tier: "premium" }` is resolved and the AI provider adapter in SYS-007 is configured to throw `AIProviderException`
    - **When** `POST /meal-plans/{id}/suggestions` is called
    - **Then** the response is HTTP 503 with `{ error: "AIProviderUnavailable" }`; no partial suggestion list is returned

---

### Component Verification: SYS-005 (Meal Plan Auto-Generator)

**Parent Requirements**: REQ-007

#### Test Case: STP-005-A (Auto-Generate REST API Contract — Premium Gate)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Auto-Generate REST API enforces the premium tier gate and returns a draft `MealPlanDTO` for eligible users.

- **System Scenario: STS-005-A1**
    - **Given** `AuthContext { userId: "u1", tier: "premium" }` is resolved, SYS-004 returns a `SuggestionListDTO`, and SYS-002 successfully persists all assignments
    - **When** `POST /meal-plans/auto-generate` is called with `AutoGenerateDTO { preferences: { diet: "vegan" }, dateRange: { start: "2026-06-01", end: "2026-06-07" } }`
    - **Then** the response is HTTP 201 with a `MealPlanDTO` in state `"draft"` with all slots populated; all `RecipeAssignment` rows are persisted in PostgreSQL

- **System Scenario: STS-005-A2**
    - **Given** `AuthContext { userId: "u3", tier: "free" }` is resolved
    - **When** `POST /meal-plans/auto-generate` is called
    - **Then** the response is HTTP 402 with `{ error: "PremiumRequired" }`; neither SYS-004 nor SYS-002 is invoked

#### Test Case: STP-005-B (Auto-Generator Rollback on Assignment Failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Meal Plan Auto-Generator rolls back all assignments when SYS-002 bulk assignment fails partway through.

- **System Scenario: STS-005-B1**
    - **Given** SYS-004 returns a `SuggestionListDTO` with 14 recipes and SYS-002 bulk assignment throws an exception after persisting 7 assignments
    - **When** `POST /meal-plans/auto-generate` is called
    - **Then** the response is HTTP 500, all 7 partial `RecipeAssignment` rows are rolled back, and no `MealPlan` row is left in an inconsistent state

---

### Component Verification: SYS-006 (Food Waste Optimizer)

**Parent Requirements**: REQ-008

#### Test Case: STP-006-A (Waste Optimize REST API Contract — Premium Gate)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Waste Optimize REST API enforces the premium tier gate and returns a well-formed `OptimizationSuggestionsDTO { swaps[] }`.

- **System Scenario: STS-006-A1**
    - **Given** `AuthContext { userId: "u1", tier: "premium" }` is resolved, a `MealPlan` with assigned recipes exists, and the Ingredient Overlap Analysis interface in SYS-007 returns an `OverlapMatrixDTO`
    - **When** `POST /meal-plans/{id}/optimize` is called with `planId = "mp1"`
    - **Then** the response is HTTP 200 with `OptimizationSuggestionsDTO { swaps: [...] }`; the result is ephemeral (not persisted to PostgreSQL)

- **System Scenario: STS-006-A2**
    - **Given** `AuthContext { userId: "u4", tier: "free" }` is resolved
    - **When** `POST /meal-plans/{id}/optimize` is called
    - **Then** the response is HTTP 402 with `{ error: "PremiumRequired" }`; SYS-007 is NOT invoked

#### Test Case: STP-006-B (Optimizer — Plan Not Found)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the Food Waste Optimizer returns HTTP 404 when the referenced plan does not exist or does not belong to the authenticated user.

- **System Scenario: STS-006-B1**
    - **Given** `AuthContext { userId: "u1", tier: "premium" }` is resolved and `planId = "mp-nonexistent"` does not exist in PostgreSQL
    - **When** `POST /meal-plans/mp-nonexistent/optimize` is called
    - **Then** the response is HTTP 404 with `{ error: "MealPlanNotFound" }`; SYS-007 is NOT invoked

#### Test Case: STP-006-C (Ingredient Overlap Adapter Failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Food Waste Optimizer returns HTTP 503 when the Ingredient Overlap Analysis adapter in SYS-007 throws `NutrientDataUnavailableException`.

- **System Scenario: STS-006-C1**
    - **Given** `AuthContext { tier: "premium" }` is resolved, a valid plan exists, and the Ingredient Overlap Analysis interface in SYS-007 is configured to throw `NutrientDataUnavailableException`
    - **When** `POST /meal-plans/{id}/optimize` is called
    - **Then** the response is HTTP 503 with `{ error: "OptimizationDataUnavailable" }`; no partial `OptimizationSuggestionsDTO` is returned

---

### Component Verification: SYS-007 (External Integration Adapters)

**Parent Requirements**: REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006

#### Test Case: STP-007-A (Clerk session-token verification Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Clerk session-token verification adapter correctly resolves a Bearer JWT to `AuthContext { userId, tier }` and throws `UnauthorizedException` for invalid tokens.

- **System Scenario: STS-007-A1**
    - **Given** a valid, non-expired Clerk session token with claims `{ sub: "u1", "app/tier": "premium" }` is presented
    - **When** the Clerk session-token verification interface is invoked
    - **Then** it returns `AuthContext { userId: "u1", tier: "premium" }` without error

- **System Scenario: STS-007-A2**
    - **Given** an expired or malformed JWT is presented
    - **When** the Clerk session-token verification interface is invoked
    - **Then** it throws `UnauthorizedException`; no `AuthContext` is returned

#### Test Case: STP-007-B (Recipe API Fetch Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Recipe API Fetch adapter returns `RecipeDTO { ingredients[] }` for a valid `recipeId` and throws `RecipeNotFoundException` for unknown IDs.

- **System Scenario: STS-007-B1**
    - **Given** the Recipe API (feature 001) is reachable and `recipeId = "r1"` exists in the user's collection
    - **When** the Recipe API Fetch interface is invoked with `recipeId = "r1"`
    - **Then** it returns `RecipeDTO { id: "r1", ingredients: [...] }`

- **System Scenario: STS-007-B2**
    - **Given** `recipeId = "r-unknown"` does not exist in the Recipe API
    - **When** the Recipe API Fetch interface is invoked
    - **Then** it throws `RecipeNotFoundException`

#### Test Case: STP-007-C (USDA Food Data Lookup Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the USDA Food Data Lookup adapter returns `NutrientDataDTO[]` for a list of ingredient IDs and throws `NutrientDataUnavailableException` on service failure.

- **System Scenario: STS-007-C1**
    - **Given** the USDA food data service (feature 003) is reachable and `ingredientIds = ["i1","i2"]` are known
    - **When** the USDA Food Data Lookup interface is invoked with `ingredientIds = ["i1","i2"]`
    - **Then** it returns `NutrientDataDTO[]` with entries for both ingredient IDs

- **System Scenario: STS-007-C2**
    - **Given** the USDA food data service returns HTTP 503
    - **When** the USDA Food Data Lookup interface is invoked
    - **Then** it throws `NutrientDataUnavailableException`

#### Test Case: STP-007-D (Downstream Exposure — Grocery List and Nutrition Plan Interfaces)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that SYS-007 exposes meal plan data in formats consumable by downstream features 007 (grocery lists) and 009 (nutrition plans).

- **System Scenario: STS-007-D1**
    - **Given** a `MealPlan` with assigned recipes exists for `userId = "u1"`
    - **When** the downstream grocery list consumer (feature 007) queries the meal plan data interface
    - **Then** the response includes `MealPlanDTO` with all `RecipeAssignment` entries and ingredient lists in the format specified by the REQ-IF-005 contract

- **System Scenario: STS-007-D2**
    - **Given** a `MealPlan` with nutritional summaries exists for `userId = "u1"`
    - **When** the downstream nutrition plan consumer (feature 009) queries the meal plan data interface
    - **Then** the response includes linkable `MealPlanDTO` data in the format specified by the REQ-IF-006 contract

#### Test Case: STP-007-E (AI Provider Invoke Interface Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the AI Provider Invoke adapter returns `AIResponseDTO { suggestions[] }` for a valid `PromptDTO` and throws `AIProviderException` on failure.

- **System Scenario: STS-007-E1**
    - **Given** the AI provider (feature 005) is reachable and a valid `PromptDTO` is constructed from user preferences
    - **When** the AI Provider Invoke interface is called
    - **Then** it returns `AIResponseDTO { suggestions: [...] }` with at least one suggestion

- **System Scenario: STS-007-E2**
    - **Given** the AI provider returns HTTP 500
    - **When** the AI Provider Invoke interface is called
    - **Then** it throws `AIProviderException`

---

### Component Verification: SYS-008 (Quality & Compliance Layer)

**Parent Requirements**: REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004

#### Test Case: STP-008-A (TypeScript Strict-Mode Compilation)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that all TypeScript source files introduced by the Meal Planning feature compile with `strict: true` and contain no `any` type usage outside explicitly marked test doubles.

- **System Scenario: STS-008-A1**
    - **Given** the TypeScript compiler is configured with `strict: true` in `tsconfig.json`
    - **When** `tsc --noEmit` is executed against all Meal Planning source files
    - **Then** the compiler exits with code 0 and emits zero diagnostic errors

- **System Scenario: STS-008-A2**
    - **Given** a static analysis scan is run against all Meal Planning source files
    - **When** the scan checks for `any` type usage outside files annotated with `// @test-double`
    - **Then** zero occurrences of bare `any` are reported in production source files

#### Test Case: STP-008-B (JSDoc Documentation Coverage)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that all exported functions and interfaces introduced by the Meal Planning feature carry JSDoc documentation.

- **System Scenario: STS-008-B1**
    - **Given** a JSDoc coverage tool is run against all Meal Planning exported symbols
    - **When** the tool checks for `@param`, `@returns`, and description blocks on all exported functions and interfaces
    - **Then** coverage is 100% — zero exported symbols are missing JSDoc annotations

#### Test Case: STP-008-C (Accessible UI Component Contracts)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that all UI components introduced by the Meal Planning feature satisfy accessible component contracts (ARIA roles, keyboard navigation, color-state accessibility).

- **System Scenario: STS-008-C1**
    - **Given** the Meal Planning UI components are rendered in a test environment
    - **When** an automated accessibility audit (axe-core or equivalent) is run against all Meal Planning views
    - **Then** zero WCAG 2.1 AA violations are reported; all interactive elements have valid ARIA roles and labels

- **System Scenario: STS-008-C2**
    - **Given** the Meal Planning UI renders nutritional status indicators using color
    - **When** a color-contrast check is run against all color-state combinations
    - **Then** all foreground/background color pairs meet a minimum contrast ratio of 4.5:1 (WCAG AA)

---

## Coverage Summary

| Metric                         | Count                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Total System Components (SYS)  | 8                                                                                              |
| Total Test Cases (STP)         | 18                                                                                             |
| Total System Scenarios (STS)   | 36                                                                                             |
| Components with ≥1 STP         | 8 / 8 (100%)                                                                                   |
| Test Cases with ≥1 STS         | 18 / 18 (100%)                                                                                 |
| Techniques Used                | Interface Contract Testing, Boundary Value Analysis, Equivalence Partitioning, Fault Injection |
| **Forward Coverage (SYS→STP)** | **100%**                                                                                       |

## Traceability Matrix

| SYS ID  | Component Name                | STP IDs                                               | Parent Requirements                                                    |
| ------- | ----------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| SYS-001 | Meal Plan Manager             | STP-001-A, STP-001-B, STP-001-C, STP-001-D            | REQ-001, REQ-002, REQ-009, REQ-010                                     |
| SYS-002 | Recipe Assignment Service     | STP-002-A, STP-002-B, STP-002-C                       | REQ-003, REQ-009                                                       |
| SYS-003 | Nutritional Summary Engine    | STP-003-A, STP-003-B, STP-003-C                       | REQ-004, REQ-005, REQ-011                                              |
| SYS-004 | AI Meal Suggestion Service    | STP-004-A, STP-004-B                                  | REQ-006                                                                |
| SYS-005 | Meal Plan Auto-Generator      | STP-005-A, STP-005-B                                  | REQ-007                                                                |
| SYS-006 | Food Waste Optimizer          | STP-006-A, STP-006-B, STP-006-C                       | REQ-008                                                                |
| SYS-007 | External Integration Adapters | STP-007-A, STP-007-B, STP-007-C, STP-007-D, STP-007-E | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006 |
| SYS-008 | Quality & Compliance Layer    | STP-008-A, STP-008-B, STP-008-C                       | REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004                         |
