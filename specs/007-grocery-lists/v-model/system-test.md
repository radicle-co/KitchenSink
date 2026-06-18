# System Test Plan: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/007-grocery-lists/v-model/system-design.md`

## Overview

This document defines the System Test Plan for Grocery Lists & Online Ordering. Every system component
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

### Component Verification: SYS-001 (Grocery List Generator)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-009, REQ-IF-002, REQ-IF-003, REQ-IF-004

#### Test Case: STP-001-A (GenerateList interface contract produces consolidated, deduplicated output)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `GenerateList(mealPlanId, userId)` (IF-INT-001) returns a structured list of canonical ingredient items with quantities aggregated across all recipes in the meal plan, and that duplicate ingredients are merged into a single line item.

- **System Scenario: STS-001-A1**
    - **Given** a valid `mealPlanId` referencing a 7-day meal plan with 14 recipes, and a valid `userId` with an active session
    - **When** `GenerateList(mealPlanId, userId)` is invoked via IF-INT-001
    - **Then** the response contains a `GroceryList` with `GroceryListItem[]` where each `canonicalName` appears exactly once, quantities are summed across all recipes, and units are normalised to canonical USDA units

- **System Scenario: STS-001-A2**
    - **Given** a `mealPlanId` that does not exist in the MealPlan API (006)
    - **When** `GenerateList(mealPlanId, userId)` is invoked via IF-INT-001
    - **Then** the component returns a structured error with code `MEAL_PLAN_NOT_FOUND` and does not persist a partial `GroceryList`

#### Test Case: STP-001-B (Aggregation and deduplication correctness across overlapping recipes)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the aggregation engine correctly handles three equivalence classes: ingredients appearing in exactly one recipe, ingredients appearing in multiple recipes with identical units, and ingredients appearing in multiple recipes with differing units requiring USDA normalisation.

- **System Scenario: STS-001-B1**
    - **Given** a meal plan containing Recipe A (200g chicken) and Recipe B (300g chicken), both using the same canonical unit
    - **When** `GenerateList` processes the meal plan
    - **Then** the resulting `GroceryListItem` for chicken has `quantity = 500` and `unit = "g"`

- **System Scenario: STS-001-B2**
    - **Given** a meal plan containing Recipe A (2 cups flour) and Recipe B (250 ml flour), requiring unit conversion via USDA Food Data
    - **When** `GenerateList` processes the meal plan
    - **Then** the resulting `GroceryListItem` for flour has a single normalised quantity in the canonical USDA unit, and no duplicate flour entries exist in the output

- **System Scenario: STS-001-B3**
    - **Given** a meal plan where every recipe contains a unique ingredient with no overlaps
    - **When** `GenerateList` processes the meal plan
    - **Then** the output contains exactly one `GroceryListItem` per unique ingredient, each with the quantity from its single source recipe

#### Test Case: STP-001-C (Performance: list generation completes within 5 seconds for a 7-day plan)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies REQ-003 — the system completes grocery list generation from a 7-day meal plan within the 5-second SLA boundary.

- **System Scenario: STS-001-C1**
    - **Given** a 7-day meal plan (maximum standard plan size) with all upstream adapters (SYS-006) responding within their nominal latency envelopes
    - **When** `GenerateList(mealPlanId, userId)` is invoked
    - **Then** the complete `GroceryList` is returned within 5000 ms of invocation, measured from request receipt to response serialisation

- **System Scenario: STS-001-C2**
    - **Given** a meal plan with 0 recipes (minimum boundary)
    - **When** `GenerateList(mealPlanId, userId)` is invoked
    - **Then** the component returns an empty `GroceryListItem[]` within 500 ms

#### Test Case: STP-001-D (Upstream adapter failure propagates as structured error)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-006 adapters (MealPlan API, Recipe API, or USDA) are unavailable, SYS-001 propagates a structured upstream error without crashing or returning partial data.

- **System Scenario: STS-001-D1**
    - **Given** the MealPlan API adapter (IF-EXT-005 via SYS-006) is configured to return HTTP 503
    - **When** `GenerateList(mealPlanId, userId)` is invoked
    - **Then** the component returns a structured error with code `UPSTREAM_UNAVAILABLE` and source `MEAL_PLAN_API`, and no `GroceryList` record is persisted

- **System Scenario: STS-001-D2**
    - **Given** the USDA Food Data adapter (IF-EXT-007 via SYS-006) returns a timeout after 3000 ms
    - **When** `GenerateList` attempts unit normalisation for an ingredient requiring USDA lookup
    - **Then** the component returns a structured error with code `UPSTREAM_TIMEOUT` and source `USDA_API`, and the partial list is not persisted

---

### Component Verification: SYS-002 (List State Manager)

**Parent Requirements**: REQ-004, REQ-005, REQ-011

#### Test Case: STP-002-A (CRUD operations on GroceryListItem enforce per-user isolation)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `GetListItems(listId, userId)` and `MarkAlreadyHave(itemId, userId)` (IF-INT-002, IF-INT-003) enforce ownership — a user can only read and mutate items belonging to their own lists.

- **System Scenario: STS-002-A1**
    - **Given** a `GroceryList` owned by `userId = "user-A"` with three `GroceryListItem` records
    - **When** `GetListItems(listId, "user-A")` is invoked
    - **Then** all three items are returned with their current `alreadyHave` flags

- **System Scenario: STS-002-A2**
    - **Given** a `GroceryList` owned by `userId = "user-A"`
    - **When** `GetListItems(listId, "user-B")` is invoked with a different userId
    - **Then** the component returns a `FORBIDDEN` error and no items are disclosed

#### Test Case: STP-002-B (MarkAlreadyHave correctly toggles item exclusion state)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View
**Description**: Verifies that `MarkAlreadyHave(itemId, userId)` correctly transitions `GroceryListItem.alreadyHave` between `false` and `true`, and that the state is durably persisted.

- **System Scenario: STS-002-B1**
    - **Given** a `GroceryListItem` with `alreadyHave = false`
    - **When** `MarkAlreadyHave(itemId, userId)` is invoked with `alreadyHave = true`
    - **Then** the item's `alreadyHave` field is set to `true` in the database, and subsequent `GetListItems` calls return the item with `alreadyHave = true`

- **System Scenario: STS-002-B2**
    - **Given** a `GroceryListItem` with `alreadyHave = true`
    - **When** `MarkAlreadyHave(itemId, userId)` is invoked with `alreadyHave = false`
    - **Then** the item's `alreadyHave` field is set to `false` in the database, and the item reappears in the active shopping view

#### Test Case: STP-002-C (Items marked alreadyHave are excluded from shopping view and order submission)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies REQ-005 — items with `alreadyHave = true` are filtered out of the active shopping list view and are not included in any order payload passed to SYS-003.

- **System Scenario: STS-002-C1**
    - **Given** a `GroceryList` with 5 items, 2 of which have `alreadyHave = true`
    - **When** `GetListItems(listId, userId)` is called with a shopping-view filter
    - **Then** only the 3 items with `alreadyHave = false` are returned

- **System Scenario: STS-002-C2**
    - **Given** a `GroceryList` where all items have `alreadyHave = true`
    - **When** SYS-003 reads list items via IF-INT-002 to construct an order
    - **Then** the order payload contains zero items and SYS-003 returns an `EMPTY_ORDER` error without submitting to the store API

#### Test Case: STP-002-D (Auth enforcer failure rejects CRUD operations)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-005 is unavailable or returns an auth failure, SYS-002 rejects all CRUD operations before any data access occurs.

- **System Scenario: STS-002-D1**
    - **Given** SYS-005 `ValidateJWT` returns `INVALID_TOKEN` for the caller's JWT
    - **When** `MarkAlreadyHave(itemId, userId)` is invoked
    - **Then** the component returns `UNAUTHORIZED` and no database write is performed

---

### Component Verification: SYS-003 (Online Ordering Orchestrator)

**Parent Requirements**: REQ-008, REQ-010, REQ-IF-001

#### Test Case: STP-003-A (SubmitOrder interface contract maps list items to store SKUs and submits order)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `SubmitOrder(listId, storeId)` (IF-INT-004) correctly reads non-excluded list items from SYS-002, maps each to a provider SKU via `IngredientMapping`, and submits a well-formed order payload to the grocery store API adapter (IF-EXT-004 via SYS-006).

- **System Scenario: STS-003-A1**
    - **Given** a `GroceryList` with 4 active items (none marked `alreadyHave`), a valid `StoreConfig` for the user, and all `IngredientMapping` records present
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** the grocery store API adapter receives a payload containing exactly 4 line items with correct `providerSku` values, and an `OrderSubmission` record is persisted with `status = "submitted"` and a non-null `providerOrderId`

- **System Scenario: STS-003-A2**
    - **Given** a `GroceryList` item with no corresponding `IngredientMapping` for the configured store
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** the unmapped item is omitted from the order payload, the order is submitted with the remaining mapped items, and the `OrderSubmission` record notes the unmapped ingredient IDs

#### Test Case: STP-003-B (Graceful degradation when grocery store API is unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies REQ-010 — when the grocery store API adapter (SYS-006 → IF-EXT-004) returns an error or timeout, SYS-003 preserves order state and returns a structured degradation response without data loss.

- **System Scenario: STS-003-B1**
    - **Given** the grocery store API adapter returns HTTP 503 on order submission
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** an `OrderSubmission` record is persisted with `status = "failed"` and `providerOrderId = null`, and the component returns a structured error with code `STORE_API_UNAVAILABLE`

- **System Scenario: STS-003-B2**
    - **Given** the grocery store API adapter times out after 10 seconds
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** the `OrderSubmission` record is persisted with `status = "failed"`, the list items remain unchanged, and the component returns `STORE_API_TIMEOUT`

#### Test Case: STP-003-C (SYS-002 unavailability prevents order with stale or missing item data)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-002 `GetListItems` fails, SYS-003 does not submit an order with incomplete or stale data.

- **System Scenario: STS-003-C1**
    - **Given** SYS-002 returns an error when `GetListItems(listId, userId)` is called
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** no order payload is sent to the store API, no `OrderSubmission` record is created, and the component returns `LIST_READ_FAILURE`

#### Test Case: STP-003-D (Missing store configuration triggers configuration error, not order submission)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-004 returns no configured store for the user, SYS-003 returns a configuration error and does not attempt order submission.

- **System Scenario: STS-003-D1**
    - **Given** SYS-004 `GetStoreConfig(userId)` returns no active `StoreConfig` for the user
    - **When** `SubmitOrder(listId, storeId)` is invoked
    - **Then** the component returns `STORE_NOT_CONFIGURED` and no order payload is dispatched to any store API

---

### Component Verification: SYS-004 (Store Configuration Manager)

**Parent Requirements**: REQ-006, REQ-007

#### Test Case: STP-004-A (Store configuration CRUD enforces per-user ownership)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `GetStoreConfig(userId)` (IF-INT-005) returns only the `StoreConfig` records owned by the requesting user, and that configuration mutations are scoped to the authenticated user.

- **System Scenario: STS-004-A1**
    - **Given** two users each with a distinct `StoreConfig` record
    - **When** `GetStoreConfig("user-A")` is invoked
    - **Then** only `user-A`'s `StoreConfig` is returned; `user-B`'s configuration is not disclosed

- **System Scenario: STS-004-A2**
    - **Given** a user with no existing `StoreConfig`
    - **When** `GetStoreConfig(userId)` is invoked
    - **Then** the component returns an empty result (not an error), signalling that store setup is required

#### Test Case: STP-004-B (Unconfigured store triggers setup guidance response)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies REQ-007 — when a user attempts online ordering without a configured store, SYS-004 returns a response that guides the caller through store setup rather than failing silently.

- **System Scenario: STS-004-B1**
    - **Given** a user with no active `StoreConfig` who triggers an ordering flow
    - **When** SYS-003 calls `GetStoreConfig(userId)` via SYS-004
    - **Then** SYS-004 returns `{ configured: false, setupRequired: true, availableProviders: [...] }` enabling the caller to surface store setup guidance

#### Test Case: STP-004-C (Auth enforcer failure rejects store configuration changes)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when SYS-005 rejects the caller's JWT, SYS-004 does not allow any store configuration read or write.

- **System Scenario: STS-004-C1**
    - **Given** SYS-005 `ValidateJWT` returns `INVALID_TOKEN`
    - **When** a store configuration mutation is attempted via SYS-004
    - **Then** the component returns `UNAUTHORIZED` and no `StoreConfig` record is created or modified

---

### Component Verification: SYS-005 (Auth & Subscription Enforcer)

**Parent Requirements**: REQ-CN-001, REQ-CN-002, REQ-IF-005, REQ-IF-006

#### Test Case: STP-005-A (ValidateJWT rejects missing, expired, and malformed tokens)

**Technique**: Equivalence Partitioning
**Target View**: Interface View
**Description**: Verifies that `ValidateJWT(token)` (IF-INT-006) correctly classifies three token equivalence classes: valid tokens (pass), expired tokens (reject), and malformed tokens (reject), before any domain logic executes.

- **System Scenario: STS-005-A1**
    - **Given** a well-formed, non-expired Clerk session token verifiable with the `CLERK_JWT_KEY` public key and an allowed `azp`
    - **When** `ValidateJWT(token)` is invoked
    - **Then** the component returns `{ valid: true, userId, claims }` and processing continues

- **System Scenario: STS-005-A2**
    - **Given** a Clerk session token with an `exp` claim in the past
    - **When** `ValidateJWT(token)` is invoked
    - **Then** the component returns `{ valid: false, reason: "TOKEN_EXPIRED" }` and the calling component rejects the request with HTTP 401

- **System Scenario: STS-005-A3**
    - **Given** a token string that is not a valid JWT (e.g., random bytes)
    - **When** `ValidateJWT(token)` is invoked
    - **Then** the component returns `{ valid: false, reason: "MALFORMED_TOKEN" }` and the calling component rejects the request with HTTP 401

- **System Scenario: STS-005-A4**
    - **Given** no Authorization header is present in the inbound request
    - **When** any grocery list or ordering endpoint is invoked
    - **Then** SYS-005 intercepts the request and returns HTTP 401 before any domain component executes

#### Test Case: STP-005-B (CheckSubscription gates online ordering to premium tier only)

**Technique**: Equivalence Partitioning
**Target View**: Interface View
**Description**: Verifies that `CheckSubscription(userId, tier)` (IF-INT-007) correctly enforces the premium subscription gate for online ordering, allowing premium users and blocking free-tier users.

- **System Scenario: STS-005-B1**
    - **Given** a user with an active premium subscription as confirmed by the Subscriptions API (IF-EXT-009)
    - **When** `CheckSubscription(userId, "premium")` is invoked
    - **Then** the component returns `{ authorized: true }` and the ordering flow proceeds

- **System Scenario: STS-005-B2**
    - **Given** a user with a free-tier subscription
    - **When** `CheckSubscription(userId, "premium")` is invoked
    - **Then** the component returns `{ authorized: false, reason: "SUBSCRIPTION_REQUIRED" }` and the calling component returns HTTP 403

#### Test Case: STP-005-C (Token verification failure causes fail-closed behaviour)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Clerk session-token verification (IF-EXT-008) is networkless — performed in-process against the `CLERK_JWT_KEY` public key with `azp` enforcement, so there is no JWKS endpoint that can become unavailable. This case instead verifies that any verification failure (invalid signature, expired token, or a disallowed `azp`) makes SYS-005 fail closed — rejecting the request rather than allowing unauthenticated access.

- **System Scenario: STS-005-C1**
    - **Given** a token whose signature does not verify against `CLERK_JWT_KEY`, or whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`
    - **When** `ValidateJWT(token)` is invoked
    - **Then** the component returns `{ valid: false, reason: "TOKEN_VERIFICATION_FAILED" }` and the request is rejected with HTTP 401 (never 200)

#### Test Case: STP-005-D (Subscriptions API unavailability causes fail-closed for premium gate)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when the Subscriptions API (IF-EXT-009 via SYS-006) is unavailable, SYS-005 fails closed on the premium gate — denying ordering access rather than granting it.

- **System Scenario: STS-005-D1**
    - **Given** the Subscriptions API adapter returns HTTP 503
    - **When** `CheckSubscription(userId, "premium")` is invoked
    - **Then** the component returns `{ authorized: false, reason: "SUBSCRIPTION_CHECK_UNAVAILABLE" }` and the ordering request is rejected with HTTP 503

---

### Component Verification: SYS-006 (External Dependency Adapters)

**Parent Requirements**: REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006, REQ-CN-003

#### Test Case: STP-006-A (Adapter interfaces expose typed contracts isolating domain logic from third-party APIs)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that each adapter (MealPlan, Recipe, USDA, Clerk, Subscriptions, Grocery Store) exposes a typed TypeScript interface and that domain components (SYS-001 through SYS-005) interact exclusively through these interfaces, not through raw HTTP clients.

- **System Scenario: STS-006-A1**
    - **Given** the MealPlan adapter is initialised with a valid base URL and auth token
    - **When** `MealPlanAdapter.getMealPlan(mealPlanId)` is called
    - **Then** the adapter returns a typed `MealPlan` object conforming to the interface contract, with no raw HTTP response objects exposed to the caller

- **System Scenario: STS-006-A2**
    - **Given** the Grocery Store adapter is initialised for provider "Instacart"
    - **When** `GroceryStoreAdapter.submitOrder(orderPayload)` is called
    - **Then** the adapter translates the canonical order payload to the Instacart-specific API format, submits it, and returns a typed `OrderResult` object

#### Test Case: STP-006-B (Upstream API error responses are translated to structured adapter errors)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that when any upstream API returns an error (4xx/5xx), the adapter translates it into a structured `AdapterError` with a typed `code` and `source` field, preventing raw HTTP errors from leaking into domain logic.

- **System Scenario: STS-006-B1**
    - **Given** the Recipe API (IF-EXT-006) returns HTTP 404 for a requested recipe ID
    - **When** `RecipeAdapter.getRecipe(recipeId)` is called
    - **Then** the adapter throws or returns `AdapterError { code: "NOT_FOUND", source: "RECIPE_API", upstreamStatus: 404 }` — not a raw HTTP response

- **System Scenario: STS-006-B2**
    - **Given** the USDA Food Data API (IF-EXT-007) returns HTTP 429 (rate limited)
    - **When** `UsdaAdapter.resolveIngredient(name)` is called
    - **Then** the adapter returns `AdapterError { code: "RATE_LIMITED", source: "USDA_API", retryAfter: <seconds> }`

#### Test Case: STP-006-C (Boundary: adapter handles maximum payload sizes without truncation)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that adapters correctly handle maximum expected payload sizes — a 7-day meal plan with the maximum number of recipes and ingredients — without truncating data or exceeding memory limits.

- **System Scenario: STS-006-C1**
    - **Given** the MealPlan API returns a response representing a 7-day plan with 21 recipes and 200 unique ingredients (maximum expected payload)
    - **When** `MealPlanAdapter.getMealPlan(mealPlanId)` is called
    - **Then** the adapter returns a fully populated `MealPlan` object with all 21 recipes and 200 ingredients intact, with no truncation

---

## Coverage Summary

| Metric                         | Count          |
| ------------------------------ | -------------- |
| Total System Components (SYS)  | 6              |
| Total Test Cases (STP)         | 22             |
| Total Scenarios (STS)          | 39             |
| Components with ≥1 STP         | 6 / 6 (100%)   |
| Test Cases with ≥1 STS         | 22 / 22 (100%) |
| **Overall Coverage (SYS→STP)** | **100%**       |

## Uncovered Components

None — all 6 system components (SYS-001 through SYS-006) have at least one test case.

## Traceability

| STP ID    | SYS ID  | REQ IDs                                              | Technique                  |
| --------- | ------- | ---------------------------------------------------- | -------------------------- |
| STP-001-A | SYS-001 | REQ-001, REQ-002, REQ-IF-002, REQ-IF-003, REQ-IF-004 | Interface Contract Testing |
| STP-001-B | SYS-001 | REQ-001, REQ-002                                     | Equivalence Partitioning   |
| STP-001-C | SYS-001 | REQ-003                                              | Boundary Value Analysis    |
| STP-001-D | SYS-001 | REQ-IF-002, REQ-IF-003, REQ-IF-004                   | Fault Injection            |
| STP-002-A | SYS-002 | REQ-004, REQ-005                                     | Interface Contract Testing |
| STP-002-B | SYS-002 | REQ-004                                              | Equivalence Partitioning   |
| STP-002-C | SYS-002 | REQ-005                                              | Equivalence Partitioning   |
| STP-002-D | SYS-002 | REQ-IF-005                                           | Fault Injection            |
| STP-003-A | SYS-003 | REQ-008, REQ-IF-001                                  | Interface Contract Testing |
| STP-003-B | SYS-003 | REQ-010                                              | Fault Injection            |
| STP-003-C | SYS-003 | REQ-008                                              | Fault Injection            |
| STP-003-D | SYS-003 | REQ-006, REQ-007                                     | Fault Injection            |
| STP-004-A | SYS-004 | REQ-006                                              | Interface Contract Testing |
| STP-004-B | SYS-004 | REQ-007                                              | Equivalence Partitioning   |
| STP-004-C | SYS-004 | REQ-IF-005                                           | Fault Injection            |
| STP-005-A | SYS-005 | REQ-CN-001, REQ-IF-005                               | Equivalence Partitioning   |
| STP-005-B | SYS-005 | REQ-CN-002, REQ-IF-006                               | Equivalence Partitioning   |
| STP-005-C | SYS-005 | REQ-IF-005                                           | Fault Injection            |
| STP-005-D | SYS-005 | REQ-CN-002, REQ-IF-006                               | Fault Injection            |
| STP-006-A | SYS-006 | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004       | Interface Contract Testing |
| STP-006-B | SYS-006 | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004       | Fault Injection            |
| STP-006-C | SYS-006 | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004       | Boundary Value Analysis    |
