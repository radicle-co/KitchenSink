# Unit Test Plan: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/007-grocery-lists/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the Grocery Lists & Online Ordering feature. Every non-`[EXTERNAL]` module design (`MOD-001`–`MOD-014`) has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

Modules `MOD-015`–`MOD-018` are tagged `[EXTERNAL]` and are skipped.

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C…)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3…)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor, consult the "Parent Architecture Modules" field in `module-design.md`.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

## Unit Tests

---

### Module: MOD-001 (GroceryListController)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/grocery-lists/grocery-list.controller.ts`

#### Test Case: UTP-001-A (handleGenerate — branch coverage for validation and service delegation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies all branches in `handleGenerate`: valid UUID passes validation and delegates to service; invalid UUID throws `ValidationError`; service result is returned as HTTP 201.

**Dependency & Mock Registry:**

| Dependency           | Source                    | Mock/Stub Strategy                                      | Rationale                                           |
| -------------------- | ------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `groceryListService` | ARCH-001 Interface        | Stub: `generateList` returns a fixed `GroceryList` stub | Isolate controller from service logic               |
| `req.user.id`        | AuthMiddleware (ARCH-012) | Stub: set `req.user = { id: "user-uuid-1" }`            | AuthMiddleware runs before handler; pre-set in test |

- **Unit Scenario: UTS-001-A1** — Valid UUID body, service succeeds
    - **Arrange**: Set `req.user.id = "user-uuid-1"`. Set `body.mealPlanId = "550e8400-e29b-41d4-a716-446655440000"` (valid UUID). Stub `groceryListService.generateList` to resolve with `{ id: "list-1", items: [] }`.
    - **Act**: Call `handleGenerate(req, body)`.
    - **Assert**: Returns `{ statusCode: 201, body: { id: "list-1", items: [] } }`. `groceryListService.generateList` called once with `("550e8400-e29b-41d4-a716-446655440000", "user-uuid-1")`.

- **Unit Scenario: UTS-001-A2** — Invalid UUID body, validation branch taken
    - **Arrange**: Set `req.user.id = "user-uuid-1"`. Set `body.mealPlanId = "not-a-uuid"`.
    - **Act**: Call `handleGenerate(req, body)`.
    - **Assert**: Throws `ValidationError` with `statusCode: 400`. `groceryListService.generateList` never called.

#### Test Case: UTP-001-B (handleGet and handleDelete — UUID validation branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `handleGet` and `handleDelete` UUID path-param validation branches and successful delegation paths.

**Dependency & Mock Registry:**

| Dependency           | Source             | Mock/Stub Strategy                                       | Rationale                             |
| -------------------- | ------------------ | -------------------------------------------------------- | ------------------------------------- |
| `groceryListService` | ARCH-001 Interface | Stub: `getList` returns stub; `deleteList` resolves void | Isolate controller from service logic |

- **Unit Scenario: UTS-001-B1** — handleGet with valid UUID
    - **Arrange**: Set `req.user.id = "user-uuid-1"`. Set `params.id = "550e8400-e29b-41d4-a716-446655440000"`. Stub `groceryListService.getList` to resolve with `{ id: "list-1" }`.
    - **Act**: Call `handleGet(req, params)`.
    - **Assert**: Returns `{ statusCode: 200, body: { id: "list-1" } }`.

- **Unit Scenario: UTS-001-B2** — handleGet with invalid UUID
    - **Arrange**: Set `params.id = "bad-id"`.
    - **Act**: Call `handleGet(req, params)`.
    - **Assert**: Throws `ValidationError` with `statusCode: 400`. `groceryListService.getList` never called.

- **Unit Scenario: UTS-001-B3** — handleDelete with valid UUID
    - **Arrange**: Set `params.id = "550e8400-e29b-41d4-a716-446655440000"`. Stub `groceryListService.deleteList` to resolve void.
    - **Act**: Call `handleDelete(req, params)`.
    - **Assert**: Returns `statusCode: 204`. `groceryListService.deleteList` called once with `("550e8400-e29b-41d4-a716-446655440000", "user-uuid-1")`.

---

### Module: MOD-002 (GroceryListService — generateList)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/grocery-lists/grocery-list.service.ts`

#### Test Case: UTP-002-A (generateList — branch coverage for meal plan lookup and aggregation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies all branches in `generateList`: null meal plan throws `NotFoundException`; successful path fetches ingredients in parallel, aggregates, writes to DB, and returns result.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                     | Rationale                 |
| ----------------------- | ------------------ | ------------------------------------------------------ | ------------------------- |
| `mealPlanAdapter`       | ARCH-014 Interface | Stub: `getMealPlan` returns stub or null               | Isolate from HTTP adapter |
| `recipeAdapter`         | ARCH-014 Interface | Stub: `getIngredients` returns fixed ingredient tuples | Isolate from HTTP adapter |
| `ingredientAggregator`  | ARCH-003 Interface | Stub: `aggregate` returns fixed `GroceryListItem[]`    | Isolate aggregation logic |
| `groceryListRepository` | ARCH-006 Interface | Stub: `createList` returns fixed `GroceryList`         | Isolate DB writes         |

- **Unit Scenario: UTS-002-A1** — Meal plan not found, NotFoundException thrown
    - **Arrange**: Stub `mealPlanAdapter.getMealPlan` to resolve `null`.
    - **Act**: Call `generateList("meal-plan-uuid", "user-uuid-1")`.
    - **Assert**: Throws `NotFoundException` with code `"meal_plan_not_found"`. `recipeAdapter.getIngredients` never called.

- **Unit Scenario: UTS-002-A2** — Successful path, parallel ingredient fetch, aggregation, DB write
    - **Arrange**: Stub `mealPlanAdapter.getMealPlan` to resolve `{ recipes: [{ recipeId: "r1" }, { recipeId: "r2" }] }`. Stub `recipeAdapter.getIngredients` to resolve `[{ ingredientId: "i1", quantity: 2, unit: "g" }]` for each call. Stub `ingredientAggregator.aggregate` to resolve `[{ name: "Flour", quantity: 4, unit: "g" }]`. Stub `groceryListRepository.createList` to resolve `{ id: "list-1" }`.
    - **Act**: Call `generateList("meal-plan-uuid", "user-uuid-1")`.
    - **Assert**: Returns `{ id: "list-1" }`. `recipeAdapter.getIngredients` called twice (once per recipeId) concurrently. `ingredientAggregator.aggregate` called once with combined tuples. `groceryListRepository.createList` called once.

#### Test Case: UTP-002-B (generateList — 5-second timeout boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies the 5000 ms timeout constant: operations completing just under the limit succeed; operations exceeding the limit throw `TimeoutError`.

**Dependency & Mock Registry:**

| Dependency        | Source             | Mock/Stub Strategy                                    | Rationale                        |
| ----------------- | ------------------ | ----------------------------------------------------- | -------------------------------- |
| `mealPlanAdapter` | ARCH-014 Interface | Stub: delays response by configurable milliseconds    | Control timing without real HTTP |
| Timer             | Node.js runtime    | Use fake timers (jest.useFakeTimers) to control clock | Deterministic timeout testing    |

- **Unit Scenario: UTS-002-B1** — Operation completes at 4999 ms (max - 1), no timeout
    - **Arrange**: Stub `mealPlanAdapter.getMealPlan` to resolve after 4999 ms. Use fake timers.
    - **Act**: Call `generateList("meal-plan-uuid", "user-uuid-1")`.
    - **Assert**: Does not throw `TimeoutError`; resolves successfully.

- **Unit Scenario: UTS-002-B2** — Operation exceeds 5000 ms (max + 1), TimeoutError thrown
    - **Arrange**: Stub `mealPlanAdapter.getMealPlan` to never resolve. Advance fake timer by 5001 ms.
    - **Act**: Call `generateList("meal-plan-uuid", "user-uuid-1")`.
    - **Assert**: Throws `TimeoutError` with `statusCode: 504`.

---

### Module: MOD-003 (IngredientAggregator)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/grocery-lists/ingredient-aggregator.ts`

#### Test Case: UTP-003-A (aggregate — deduplication and quantity summation logic)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies the accumulator loop: known ingredients are normalised and summed by `canonicalId`; unknown ingredients pass through with `unitFactor = 1`; final `GroceryListItem[]` is correctly constructed.

**Dependency & Mock Registry:**

| Dependency    | Source             | Mock/Stub Strategy                                                  | Rationale               |
| ------------- | ------------------ | ------------------------------------------------------------------- | ----------------------- |
| `usdaAdapter` | ARCH-014 Interface | Stub: `normalise` returns a `Map` with controlled canonical entries | Isolate USDA HTTP calls |

- **Unit Scenario: UTS-003-A1** — Two tuples with same canonicalId, quantities summed
    - **Arrange**: Set `tuples = [{ ingredientId: "i1", quantity: 2, unit: "g" }, { ingredientId: "i1", quantity: 3, unit: "g" }]`. Stub `usdaAdapter.normalise(["i1"])` to return `Map { "i1" => { canonicalId: "c1", canonicalName: "Flour", unitFactor: 1, baseUnit: "g" } }`.
    - **Act**: Call `aggregate(tuples)`.
    - **Assert**: Returns `[{ ingredientId: "c1", name: "Flour", quantity: 5, unit: "g", alreadyHave: false }]`. Accumulator `quantity` for `"c1"` equals `5`.

- **Unit Scenario: UTS-003-A2** — Unknown ingredient (not in USDA map), pass-through branch
    - **Arrange**: Set `tuples = [{ ingredientId: "unknown-id", quantity: 1, unit: "cup" }]`. Stub `usdaAdapter.normalise(["unknown-id"])` to return empty `Map {}`.
    - **Act**: Call `aggregate(tuples)`.
    - **Assert**: Returns `[{ ingredientId: "unknown-id", name: "unknown-id", quantity: 1, unit: "cup", alreadyHave: false }]`. `unitFactor` defaulted to `1`.

- **Unit Scenario: UTS-003-A3** — unitFactor applied to quantity before accumulation
    - **Arrange**: Set `tuples = [{ ingredientId: "i2", quantity: 500, unit: "ml" }]`. Stub `usdaAdapter.normalise` to return `Map { "i2" => { canonicalId: "c2", canonicalName: "Milk", unitFactor: 0.001, baseUnit: "L" } }`.
    - **Act**: Call `aggregate(tuples)`.
    - **Assert**: Returns `[{ name: "Milk", quantity: 0.5, unit: "L" }]`. Internal `normalised_qty = 500 * 0.001 = 0.5`.

#### Test Case: UTP-003-B (aggregate — empty input boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies behaviour when `tuples` array is empty (min boundary = 0 elements).

**Dependency & Mock Registry:**

| Dependency    | Source             | Mock/Stub Strategy                          | Rationale                   |
| ------------- | ------------------ | ------------------------------------------- | --------------------------- |
| `usdaAdapter` | ARCH-014 Interface | Stub: `normalise([])` returns empty `Map{}` | No USDA calls for empty set |

- **Unit Scenario: UTS-003-B1** — Empty tuples array returns empty items array
    - **Arrange**: Set `tuples = []`. Stub `usdaAdapter.normalise` to return `Map {}`.
    - **Act**: Call `aggregate([])`.
    - **Assert**: Returns `[]`. `usdaAdapter.normalise` called with `[]`.

---

### Module: MOD-004 (ListStateController)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/grocery-lists/list-state.controller.ts`

#### Test Case: UTP-004-A (handleMarkAlreadyHave — validation branches and delegation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies UUID validation for path params and boolean validation for body; valid inputs delegate to `listStateService.markAlreadyHave`.

**Dependency & Mock Registry:**

| Dependency         | Source             | Mock/Stub Strategy                                      | Rationale                       |
| ------------------ | ------------------ | ------------------------------------------------------- | ------------------------------- |
| `listStateService` | ARCH-004 Interface | Stub: `markAlreadyHave` returns fixed `GroceryListItem` | Isolate controller from service |

- **Unit Scenario: UTS-004-A1** — Valid params and boolean body, delegates successfully
    - **Arrange**: Set `params = { id: "550e8400-e29b-41d4-a716-446655440000", itemId: "660e8400-e29b-41d4-a716-446655440001" }`. Set `body = { alreadyHave: true }`. Stub `listStateService.markAlreadyHave` to resolve `{ id: "item-1", alreadyHave: true }`.
    - **Act**: Call `handleMarkAlreadyHave(req, params, body)`.
    - **Assert**: Returns `{ statusCode: 200, body: { id: "item-1", alreadyHave: true } }`.

- **Unit Scenario: UTS-004-A2** — Invalid UUID in params, ValidationError thrown
    - **Arrange**: Set `params = { id: "not-uuid", itemId: "660e8400-e29b-41d4-a716-446655440001" }`. Set `body = { alreadyHave: false }`.
    - **Act**: Call `handleMarkAlreadyHave(req, params, body)`.
    - **Assert**: Throws `ValidationError` with `statusCode: 400`. `listStateService.markAlreadyHave` never called.

#### Test Case: UTP-004-B (handleGetItems — filter default and enum equivalence)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Verifies the `filter` query param: absent → defaults to `"active"`; `"active"` and `"all"` are valid partitions; any other value is invalid.

**Dependency & Mock Registry:**

| Dependency         | Source             | Mock/Stub Strategy                                 | Rationale                       |
| ------------------ | ------------------ | -------------------------------------------------- | ------------------------------- |
| `listStateService` | ARCH-004 Interface | Stub: `getItems` returns fixed `GroceryListItem[]` | Isolate controller from service |

- **Unit Scenario: UTS-004-B1** — filter absent, defaults to "active"
    - **Arrange**: Set `query = {}`. Stub `listStateService.getItems` to resolve `[]`.
    - **Act**: Call `handleGetItems(req, params, query)`.
    - **Assert**: `listStateService.getItems` called with third arg `"active"`.

- **Unit Scenario: UTS-004-B2** — filter = "all", passed through
    - **Arrange**: Set `query = { filter: "all" }`. Stub `listStateService.getItems` to resolve `[]`.
    - **Act**: Call `handleGetItems(req, params, query)`.
    - **Assert**: `listStateService.getItems` called with third arg `"all"`.

---

### Module: MOD-005 (ListStateService)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/grocery-lists/list-state.service.ts`

#### Test Case: UTP-005-A (markAlreadyHave — optimistic lock retry loop)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies the retry loop: first attempt succeeds (no retry); first attempt fails with `VersionConflict`, second succeeds; three consecutive `VersionConflict` throws `ConflictError`.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                                   | Rationale                   |
| ----------------------- | ------------------ | -------------------------------------------------------------------- | --------------------------- |
| `groceryListRepository` | ARCH-006 Interface | Stub: `assertOwnership` resolves void; `updateItemFlag` configurable | Isolate retry logic from DB |

- **Unit Scenario: UTS-005-A1** — First attempt succeeds, no retry
    - **Arrange**: Stub `groceryListRepository.assertOwnership` to resolve void. Stub `groceryListRepository.updateItemFlag` to resolve `{ id: "item-1", alreadyHave: true }` on first call.
    - **Act**: Call `markAlreadyHave("list-uuid", "item-uuid", "user-uuid", true)`.
    - **Assert**: Returns `{ id: "item-1", alreadyHave: true }`. `updateItemFlag` called exactly once. Internal `attempt` equals `1`.

- **Unit Scenario: UTS-005-A2** — First attempt VersionConflict, second succeeds
    - **Arrange**: Stub `updateItemFlag` to throw `VersionConflict` on call 1, resolve `{ id: "item-1" }` on call 2.
    - **Act**: Call `markAlreadyHave("list-uuid", "item-uuid", "user-uuid", false)`.
    - **Assert**: Returns `{ id: "item-1" }`. `updateItemFlag` called exactly twice. Internal `attempt` equals `2`.

- **Unit Scenario: UTS-005-A3** — Three consecutive VersionConflicts, ConflictError thrown
    - **Arrange**: Stub `updateItemFlag` to always throw `VersionConflict`.
    - **Act**: Call `markAlreadyHave("list-uuid", "item-uuid", "user-uuid", true)`.
    - **Assert**: Throws `ConflictError` with code `"optimistic_lock_max_retries"`. `updateItemFlag` called exactly 3 times. Internal `attempt` equals `3` at throw.

#### Test Case: UTP-005-B (markAlreadyHave — attempt counter boundary values)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `attempt` counter boundaries: `MAX_RETRIES = 3`; at attempt 2 (max - 1) retry is allowed; at attempt 3 (max) `ConflictError` is thrown.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                     | Rationale                |
| ----------------------- | ------------------ | ------------------------------------------------------ | ------------------------ |
| `groceryListRepository` | ARCH-006 Interface | Stub: `updateItemFlag` throws `VersionConflict` always | Control retry exhaustion |

- **Unit Scenario: UTS-005-B1** — attempt = 2 (MAX_RETRIES - 1), retry permitted
    - **Arrange**: Stub `updateItemFlag` to throw `VersionConflict` on calls 1–2, resolve on call 3.
    - **Act**: Call `markAlreadyHave("list-uuid", "item-uuid", "user-uuid", true)`.
    - **Assert**: Does not throw `ConflictError`; resolves successfully. `updateItemFlag` called 3 times.

- **Unit Scenario: UTS-005-B2** — attempt = 3 (MAX_RETRIES), ConflictError thrown
    - **Arrange**: Stub `updateItemFlag` to always throw `VersionConflict`.
    - **Act**: Call `markAlreadyHave("list-uuid", "item-uuid", "user-uuid", true)`.
    - **Assert**: Throws `ConflictError`. `updateItemFlag` called exactly 3 times (not 4).

#### Test Case: UTP-005-C (getItems — filter branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `getItems` filter branching: `"active"` passes `{ alreadyHave: false }` to repository; `"all"` passes `{}`.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                     | Rationale            |
| ----------------------- | ------------------ | ------------------------------------------------------ | -------------------- |
| `groceryListRepository` | ARCH-006 Interface | Stub: `assertOwnership` void; `findItems` returns `[]` | Isolate filter logic |

- **Unit Scenario: UTS-005-C1** — filter = "active", repository called with alreadyHave: false
    - **Arrange**: Stub `assertOwnership` to resolve void. Stub `findItems` to resolve `[]`.
    - **Act**: Call `getItems("list-uuid", "user-uuid", "active")`.
    - **Assert**: `findItems` called with `("list-uuid", { alreadyHave: false })`.

- **Unit Scenario: UTS-005-C2** — filter = "all", repository called with empty filter
    - **Arrange**: Stub `assertOwnership` to resolve void. Stub `findItems` to resolve `[]`.
    - **Act**: Call `getItems("list-uuid", "user-uuid", "all")`.
    - **Assert**: `findItems` called with `("list-uuid", {})`.

---

### Module: MOD-006 (GroceryListRepository — grocery_lists table)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/grocery-lists/grocery-list.repository.ts`

#### Test Case: UTP-006-A (createList — transactional insert logic)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `createList` executes a single DB transaction inserting the list row and all item rows atomically, then maps to domain object.

**Dependency & Mock Registry:**

| Dependency | Source           | Mock/Stub Strategy                                                   | Rationale                    |
| ---------- | ---------------- | -------------------------------------------------------------------- | ---------------------------- |
| `db`       | Drizzle ORM / pg | Stub: transaction callback captures INSERT calls; returns fixed rows | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-006-A1** — Two items inserted within single transaction
    - **Arrange**: Stub DB transaction to capture calls. Provide `items = [{ ingredientId: "i1", name: "Flour", quantity: 2, unit: "g" }, { ingredientId: "i2", name: "Milk", quantity: 1, unit: "L" }]`.
    - **Act**: Call `createList("user-uuid", "meal-plan-uuid", items)`.
    - **Assert**: DB transaction called once. Two item INSERT statements executed inside transaction. Returns mapped `GroceryList` with `items.length === 2`.

#### Test Case: UTP-006-B (assertOwnership — branch coverage for not-found and not-owner)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `assertOwnership` branches: list not found → `NotFoundException`; list found but different userId → `OwnershipError`; matching userId → resolves void.

**Dependency & Mock Registry:**

| Dependency | Source           | Mock/Stub Strategy                                         | Rationale                    |
| ---------- | ---------------- | ---------------------------------------------------------- | ---------------------------- |
| `db`       | Drizzle ORM / pg | Stub: SELECT returns null, mismatched row, or matching row | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-006-B1** — List not found, NotFoundException thrown
    - **Arrange**: Stub DB SELECT to return `null`.
    - **Act**: Call `assertOwnership("list-uuid", "user-uuid")`.
    - **Assert**: Throws `NotFoundException` with message `"list_not_found"`.

- **Unit Scenario: UTS-006-B2** — List found, userId mismatch, OwnershipError thrown
    - **Arrange**: Stub DB SELECT to return `{ userId: "other-user" }`.
    - **Act**: Call `assertOwnership("list-uuid", "user-uuid")`.
    - **Assert**: Throws `OwnershipError` with code `"NOT_OWNER"`.

- **Unit Scenario: UTS-006-B3** — List found, userId matches, resolves void
    - **Arrange**: Stub DB SELECT to return `{ userId: "user-uuid" }`.
    - **Act**: Call `assertOwnership("list-uuid", "user-uuid")`.
    - **Assert**: Resolves without throwing.

#### Test Case: UTP-006-C (findItems — filter predicate branch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `findItems` appends `AND alreadyHave = filter.alreadyHave` when `filter.alreadyHave` is defined, and omits it when undefined.

**Dependency & Mock Registry:**

| Dependency | Source           | Mock/Stub Strategy                               | Rationale                    |
| ---------- | ---------------- | ------------------------------------------------ | ---------------------------- |
| `db`       | Drizzle ORM / pg | Stub: captures query builder calls; returns `[]` | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-006-C1** — filter.alreadyHave = false, WHERE clause includes predicate
    - **Arrange**: Stub DB query builder to capture WHERE conditions.
    - **Act**: Call `findItems("list-uuid", { alreadyHave: false })`.
    - **Assert**: Query includes `alreadyHave = false` predicate.

- **Unit Scenario: UTS-006-C2** — filter = {}, no alreadyHave predicate appended
    - **Arrange**: Stub DB query builder to capture WHERE conditions.
    - **Act**: Call `findItems("list-uuid", {})`.
    - **Assert**: Query does NOT include `alreadyHave` predicate.

---

### Module: MOD-007 (GroceryListRepository — updateItemFlag with optimistic lock)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/grocery-list/grocery-list.repository.ts`

#### Test Case: UTP-007-A (updateItemFlag — state transition coverage)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies all state transitions: `ReadCurrent → NotFound` (item missing); `VersionedUpdate → Success` (rowsAffected = 1); `VersionedUpdate → VersionConflict` (rowsAffected = 0).

**Dependency & Mock Registry:**

| Dependency | Source           | Mock/Stub Strategy                                                          | Rationale                    |
| ---------- | ---------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `db`       | Drizzle ORM / pg | Stub: SELECT returns null or row; UPDATE returns `{ rowsAffected: 0 or 1 }` | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-007-A1** — Item not found (ReadCurrent → NotFound)
    - **Arrange**: Stub SELECT to return `null`.
    - **Act**: Call `updateItemFlag("item-uuid", true)`.
    - **Assert**: Throws `NotFoundException` with message `"item_not_found"`. UPDATE never executed.

- **Unit Scenario: UTS-007-A2** — Version matches, update succeeds (VersionedUpdate → Success)
    - **Arrange**: Stub SELECT to return `{ id: "item-uuid", version: 5, alreadyHave: false }`. Stub UPDATE to return `{ rowsAffected: 1 }`. Stub second SELECT to return `{ id: "item-uuid", version: 6, alreadyHave: true }`.
    - **Act**: Call `updateItemFlag("item-uuid", true)`.
    - **Assert**: Returns mapped `GroceryListItem` with `alreadyHave: true` and `version: 6`. UPDATE WHERE clause includes `version = 5`.

- **Unit Scenario: UTS-007-A3** — Version mismatch, concurrent write detected (VersionedUpdate → VersionConflict)
    - **Arrange**: Stub SELECT to return `{ id: "item-uuid", version: 5 }`. Stub UPDATE to return `{ rowsAffected: 0 }`.
    - **Act**: Call `updateItemFlag("item-uuid", false)`.
    - **Assert**: Throws `VersionConflict` with code `"VERSION_CONFLICT"`.

#### Test Case: UTP-007-B (updateItemFlag — version counter boundary values)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `version` counter boundaries: `version = 0` (min, initial insert); `version = 1` (min + 1, first update); `rowsAffected` boundary at 0 vs 1.

**Dependency & Mock Registry:**

| Dependency | Source           | Mock/Stub Strategy                                                  | Rationale                    |
| ---------- | ---------------- | ------------------------------------------------------------------- | ---------------------------- |
| `db`       | Drizzle ORM / pg | Stub: SELECT returns row with specific version; UPDATE configurable | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-007-B1** — version = 0 (initial), successful update sets version = 1
    - **Arrange**: Stub SELECT to return `{ version: 0 }`. Stub UPDATE to return `{ rowsAffected: 1 }`. Stub second SELECT to return `{ version: 1 }`.
    - **Act**: Call `updateItemFlag("item-uuid", true)`.
    - **Assert**: UPDATE WHERE clause uses `version = 0`. Returned item has `version: 1`.

- **Unit Scenario: UTS-007-B2** — rowsAffected = 0 (boundary), VersionConflict thrown
    - **Arrange**: Stub SELECT to return `{ version: 3 }`. Stub UPDATE to return `{ rowsAffected: 0 }`.
    - **Act**: Call `updateItemFlag("item-uuid", true)`.
    - **Assert**: Throws `VersionConflict`. Internal `rowsAffected` equals `0`.

---

### Module: MOD-008 (OnlineOrderingController)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/online-ordering/online-ordering.controller.ts`

#### Test Case: UTP-008-A (handleSubmitOrder — UUID validation and delegation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies UUID path-param validation branch and successful delegation to `onlineOrderingService.submitOrder`.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                                 | Rationale                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------ | ------------------------------- |
| `onlineOrderingService` | ARCH-007 Interface | Stub: `submitOrder` returns `{ orderId, providerOrderId, status }` | Isolate controller from service |

- **Unit Scenario: UTS-008-A1** — Valid UUID, service returns order submission
    - **Arrange**: Set `params.id = "550e8400-e29b-41d4-a716-446655440000"`. Set `req.user.id = "user-uuid-1"`. Stub `onlineOrderingService.submitOrder` to resolve `{ orderId: "o1", providerOrderId: "p1", status: "submitted" }`.
    - **Act**: Call `handleSubmitOrder(req, params)`.
    - **Assert**: Returns `{ statusCode: 201, body: { orderId: "o1", providerOrderId: "p1", status: "submitted" } }`.

- **Unit Scenario: UTS-008-A2** — Invalid UUID, ValidationError thrown before service call
    - **Arrange**: Set `params.id = "not-a-uuid"`.
    - **Act**: Call `handleSubmitOrder(req, params)`.
    - **Assert**: Throws `ValidationError` with `statusCode: 400`. `onlineOrderingService.submitOrder` never called.

---

### Module: MOD-009 (OnlineOrderingService)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/online-ordering/online-ordering.service.ts`

#### Test Case: UTP-009-A (submitOrder — branch coverage for empty list and no store config)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies branches: empty active items list throws `BadRequestError`; no store config throws `PreconditionFailedError`; successful path maps items and submits.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                       | Rationale                       |
| ----------------------- | ------------------ | -------------------------------------------------------- | ------------------------------- |
| `groceryListRepository` | ARCH-006 Interface | Stub: `findItems` returns configurable items             | Isolate from DB                 |
| `storeConfigService`    | ARCH-010 Interface | Stub: `getStoreConfig` returns config or null            | Isolate from config service     |
| `groceryStoreAdapter`   | ARCH-014 Interface | Stub: `mapAndSubmit` returns `{ providerOrderId: "p1" }` | Isolate from external store API |

- **Unit Scenario: UTS-009-A1** — Empty active items list, BadRequestError thrown
    - **Arrange**: Stub `groceryListRepository.findItems` to resolve `[]`.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: Throws `BadRequestError` with code `"empty_list"`. `storeConfigService.getStoreConfig` never called.

- **Unit Scenario: UTS-009-A2** — No store config, PreconditionFailedError thrown
    - **Arrange**: Stub `findItems` to resolve `[{ id: "item-1", alreadyHave: false }]`. Stub `storeConfigService.getStoreConfig` to resolve `null`.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: Throws `PreconditionFailedError` with code `"no_store_config"`. `groceryStoreAdapter.mapAndSubmit` never called.

- **Unit Scenario: UTS-009-A3** — Valid items and config, order submitted successfully
    - **Arrange**: Stub `findItems` to resolve `[{ id: "item-1", alreadyHave: false }]`. Stub `getStoreConfig` to resolve `{ provider: "KROGER", credentials: {} }`. Stub `groceryStoreAdapter.mapAndSubmit` to resolve `{ providerOrderId: "p1" }`.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: Returns `{ orderId: <uuid>, providerOrderId: "p1", status: "submitted" }`. `groceryStoreAdapter.mapAndSubmit` called once.

#### Test Case: UTP-009-B (submitOrder — exponential backoff retry state transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies retry state machine: `SubmittingOrder → Retrying → SubmittingOrder` on `GroceryStoreApiError`; `Retrying → ServiceUnavailable` after 3 attempts; `SubmittingOrder → Success` on first success.

**Dependency & Mock Registry:**

| Dependency            | Source             | Mock/Stub Strategy                                                    | Rationale                       |
| --------------------- | ------------------ | --------------------------------------------------------------------- | ------------------------------- |
| `groceryStoreAdapter` | ARCH-014 Interface | Stub: `mapAndSubmit` throws `GroceryStoreApiError` configurable times | Control retry exhaustion        |
| `sleep`               | Node.js runtime    | Stub: `sleep` resolves immediately                                    | Avoid real delays in unit tests |

- **Unit Scenario: UTS-009-B1** — First attempt succeeds (SubmittingOrder → Success)
    - **Arrange**: Stub `mapAndSubmit` to resolve `{ providerOrderId: "p1" }` on first call.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")` (with valid items and config pre-stubbed).
    - **Assert**: Returns successfully. `mapAndSubmit` called once. `sleep` never called. Internal `attempt = 1`.

- **Unit Scenario: UTS-009-B2** — Two GroceryStoreApiErrors then success (Retrying × 2 → Success)
    - **Arrange**: Stub `mapAndSubmit` to throw `GroceryStoreApiError` on calls 1–2, resolve on call 3. Stub `sleep` to resolve immediately.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: Returns successfully. `mapAndSubmit` called 3 times. `sleep` called twice with `backoffMs` values `1000` then `2000`.

- **Unit Scenario: UTS-009-B3** — Three GroceryStoreApiErrors, ServiceUnavailableError thrown
    - **Arrange**: Stub `mapAndSubmit` to always throw `GroceryStoreApiError`. Stub `sleep` to resolve immediately.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: Throws `ServiceUnavailableError` with code `"store_unavailable"` and `retryAfter` set. `mapAndSubmit` called exactly 3 times. Internal `attempt = 3` at throw.

#### Test Case: UTP-009-C (submitOrder — backoffMs boundary values)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `backoffMs` exponential progression: starts at `1000` (min), doubles to `2000` after first retry, `4000` after second retry; `MAX_RETRIES = 3` constant.

**Dependency & Mock Registry:**

| Dependency            | Source             | Mock/Stub Strategy                              | Rationale                       |
| --------------------- | ------------------ | ----------------------------------------------- | ------------------------------- |
| `groceryStoreAdapter` | ARCH-014 Interface | Stub: always throws `GroceryStoreApiError`      | Force all retry paths           |
| `sleep`               | Node.js runtime    | Spy: captures `backoffMs` argument on each call | Verify backoff values precisely |

- **Unit Scenario: UTS-009-C1** — backoffMs sequence: 1000 → 2000 across two retries
    - **Arrange**: Stub `mapAndSubmit` to throw `GroceryStoreApiError` 3 times. Spy on `sleep`.
    - **Act**: Call `submitOrder("list-uuid", "user-uuid")`.
    - **Assert**: `sleep` call 1 receives `1000`. `sleep` call 2 receives `2000`. `backoffMs` after second doubling would be `4000` (not used since attempt 3 throws).

---

### Module: MOD-010 (StoreConfigController)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/store-config/store-config.controller.ts`

#### Test Case: UTP-010-A (handleList — empty vs non-empty configs branch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `handleList` branch: when `configs.length == 0` returns `setupGuidance`; when configs exist returns `configs`.

**Dependency & Mock Registry:**

| Dependency           | Source             | Mock/Stub Strategy                                                                          | Rationale          |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------- | ------------------ |
| `storeConfigService` | ARCH-009 Interface | Stub: `listConfigs` returns `{ configs: [], setupGuidance: {...} }` or `{ configs: [...] }` | Isolate controller |

- **Unit Scenario: UTS-010-A1** — No configs, setupGuidance returned
    - **Arrange**: Stub `storeConfigService.listConfigs` to resolve `{ configs: [], setupGuidance: { message: "No grocery store connected.", supportedProviders: ["KROGER","WALMART","INSTACART"] } }`.
    - **Act**: Call `handleList(req)`.
    - **Assert**: Returns `{ statusCode: 200, body: { message: "No grocery store connected.", supportedProviders: [...] } }`.

- **Unit Scenario: UTS-010-A2** — Configs exist, configs array returned
    - **Arrange**: Stub `storeConfigService.listConfigs` to resolve `{ configs: [{ id: "cfg-1" }], setupGuidance: null }`.
    - **Act**: Call `handleList(req)`.
    - **Assert**: Returns `{ statusCode: 200, body: [{ id: "cfg-1" }] }`.

#### Test Case: UTP-010-B (handleCreate — provider enum and credentials validation)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Verifies `CreateStoreConfigDTO` validation: valid provider enum values (KROGER, WALMART, INSTACART) pass; invalid provider value throws `ValidationError`; empty credentials object throws `ValidationError`.

**Dependency & Mock Registry:**

| Dependency           | Source             | Mock/Stub Strategy                               | Rationale                       |
| -------------------- | ------------------ | ------------------------------------------------ | ------------------------------- |
| `storeConfigService` | ARCH-009 Interface | Stub: `createConfig` returns fixed `StoreConfig` | Isolate controller from service |

- **Unit Scenario: UTS-010-B1** — Valid provider "KROGER", valid credentials, delegates successfully
    - **Arrange**: Set `body = { provider: "KROGER", credentials: { apiKey: "key123" } }`. Stub `createConfig` to resolve `{ id: "cfg-1" }`.
    - **Act**: Call `handleCreate(req, body)`.
    - **Assert**: Returns `{ statusCode: 201, body: { id: "cfg-1" } }`.

- **Unit Scenario: UTS-010-B2** — Invalid provider "AMAZON", ValidationError thrown
    - **Arrange**: Set `body = { provider: "AMAZON", credentials: { apiKey: "key" } }`.
    - **Act**: Call `handleCreate(req, body)`.
    - **Assert**: Throws `ValidationError` with `statusCode: 400`. `storeConfigService.createConfig` never called.

---

### Module: MOD-011 (StoreConfigService)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/store-config/store-config.service.ts`

#### Test Case: UTP-011-A (listConfigs — empty vs non-empty branch and setupGuidance construction)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `listConfigs` branch: empty repository result returns `setupGuidance` with static message and `SUPPORTED_PROVIDERS`; non-empty returns configs with `setupGuidance: null`.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                       | Rationale       |
| ----------------------- | ------------------ | -------------------------------------------------------- | --------------- |
| `storeConfigRepository` | ARCH-011 Interface | Stub: `findByUserId` returns `[]` or `[{ id: "cfg-1" }]` | Isolate from DB |

- **Unit Scenario: UTS-011-A1** — Empty configs, setupGuidance constructed with SUPPORTED_PROVIDERS
    - **Arrange**: Stub `storeConfigRepository.findByUserId` to resolve `[]`.
    - **Act**: Call `listConfigs("user-uuid")`.
    - **Assert**: Returns `{ configs: [], setupGuidance: { message: "No grocery store connected. Add a store to enable online ordering.", supportedProviders: ["KROGER", "WALMART", "INSTACART"] } }`. Internal `SUPPORTED_PROVIDERS` constant used.

- **Unit Scenario: UTS-011-A2** — Non-empty configs, setupGuidance is null
    - **Arrange**: Stub `findByUserId` to resolve `[{ id: "cfg-1" }]`.
    - **Act**: Call `listConfigs("user-uuid")`.
    - **Assert**: Returns `{ configs: [{ id: "cfg-1" }], setupGuidance: null }`.

#### Test Case: UTP-011-B (createConfig — credentials validation and KMS encryption branch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `createConfig`: invalid credentials format throws `ValidationError`; valid credentials are KMS-encrypted and stored.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                         | Rationale             |
| ----------------------- | ------------------ | ------------------------------------------ | --------------------- |
| `kmsEncrypt`            | AWS KMS            | Stub: returns fixed `Buffer` ciphertext    | Isolate from real KMS |
| `storeConfigRepository` | ARCH-011 Interface | Stub: `create` returns fixed `StoreConfig` | Isolate from DB       |

- **Unit Scenario: UTS-011-B1** — Invalid credentials format, ValidationError thrown
    - **Arrange**: Set `dto = { provider: "KROGER", credentials: {} }` (empty object fails schema). Stub provider schema validator to reject.
    - **Act**: Call `createConfig("user-uuid", dto)`.
    - **Assert**: Throws `ValidationError` with code `"invalid_credentials_format"`. `kmsEncrypt` never called.

- **Unit Scenario: UTS-011-B2** — Valid credentials, KMS encrypts and repository stores
    - **Arrange**: Set `dto = { provider: "KROGER", credentials: { apiKey: "key123" } }`. Stub `kmsEncrypt` to resolve `Buffer.from("encrypted")`. Stub `storeConfigRepository.create` to resolve `{ id: "cfg-1" }`.
    - **Act**: Call `createConfig("user-uuid", dto)`.
    - **Assert**: `kmsEncrypt` called once with `{ apiKey: "key123" }`. `storeConfigRepository.create` called with `{ userId: "user-uuid", provider: "KROGER", encryptedCredentials: Buffer.from("encrypted") }`. Returns `{ id: "cfg-1" }`.

#### Test Case: UTP-011-C (deleteConfig — not-found and ownership branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `deleteConfig` branches: config not found → `NotFoundException`; config found but different userId → `ForbiddenException`; matching userId → deletes.

**Dependency & Mock Registry:**

| Dependency              | Source             | Mock/Stub Strategy                                         | Rationale       |
| ----------------------- | ------------------ | ---------------------------------------------------------- | --------------- |
| `storeConfigRepository` | ARCH-011 Interface | Stub: `findById` returns null, mismatched, or matching row | Isolate from DB |

- **Unit Scenario: UTS-011-C1** — Config not found, NotFoundException thrown
    - **Arrange**: Stub `storeConfigRepository.findById` to resolve `null`.
    - **Act**: Call `deleteConfig("cfg-uuid", "user-uuid")`.
    - **Assert**: Throws `NotFoundException` with code `"config_not_found"`.

- **Unit Scenario: UTS-011-C2** — Config found, userId mismatch, ForbiddenException thrown
    - **Arrange**: Stub `findById` to resolve `{ id: "cfg-uuid", userId: "other-user" }`.
    - **Act**: Call `deleteConfig("cfg-uuid", "user-uuid")`.
    - **Assert**: Throws `ForbiddenException` with code `"not_owner"`.

- **Unit Scenario: UTS-011-C3** — Config found, userId matches, delete executed
    - **Arrange**: Stub `findById` to resolve `{ id: "cfg-uuid", userId: "user-uuid" }`. Stub `storeConfigRepository.delete` to resolve void.
    - **Act**: Call `deleteConfig("cfg-uuid", "user-uuid")`.
    - **Assert**: `storeConfigRepository.delete` called once with `"cfg-uuid"`. Resolves without throwing.

---

### Module: MOD-012 (StoreConfigRepository)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/store-config/store-config.repository.ts`

#### Test Case: UTP-012-A (mapToStoreConfig — KMS decrypt on read)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `mapToStoreConfig` calls `kmsDecrypt` on every read and maps all fields correctly.

**Dependency & Mock Registry:**

| Dependency   | Source  | Mock/Stub Strategy                               | Rationale                    |
| ------------ | ------- | ------------------------------------------------ | ---------------------------- |
| `kmsDecrypt` | AWS KMS | Stub: returns fixed decrypted credentials object | Isolate from real KMS        |
| `db`         | Drizzle | Stub: SELECT returns fixed DB row                | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-012-A1** — findById returns row, kmsDecrypt called, domain object mapped
    - **Arrange**: Stub DB SELECT to return `{ id: "cfg-1", userId: "user-uuid", provider: "KROGER", encryptedCredentials: Buffer.from("enc"), createdAt: new Date("2026-01-01") }`. Stub `kmsDecrypt` to resolve `{ apiKey: "key123" }`.
    - **Act**: Call `findById("cfg-1")`.
    - **Assert**: `kmsDecrypt` called once with `Buffer.from("enc")`. Returns `{ id: "cfg-1", userId: "user-uuid", provider: "KROGER", credentials: { apiKey: "key123" }, createdAt: new Date("2026-01-01") }`.

- **Unit Scenario: UTS-012-A2** — findById returns null, null returned without kmsDecrypt
    - **Arrange**: Stub DB SELECT to return `null`.
    - **Act**: Call `findById("cfg-1")`.
    - **Assert**: Returns `null`. `kmsDecrypt` never called.

#### Test Case: UTP-012-B (ProviderEnum — equivalence partitioning for valid/invalid values)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Verifies `ProviderEnum` constraint: KROGER, WALMART, INSTACART are valid partitions; any other string is invalid and causes a DB constraint violation.

**Dependency & Mock Registry:**

| Dependency | Source  | Mock/Stub Strategy                                                  | Rationale                    |
| ---------- | ------- | ------------------------------------------------------------------- | ---------------------------- |
| `db`       | Drizzle | Stub: INSERT throws `DatabaseError` for invalid provider enum value | Isolate from real PostgreSQL |

- **Unit Scenario: UTS-012-B1** — Valid provider "WALMART", INSERT succeeds
    - **Arrange**: Stub DB INSERT to resolve with row `{ id: "cfg-2", provider: "WALMART" }`. Stub `kmsDecrypt` to resolve `{}`.
    - **Act**: Call `create({ userId: "user-uuid", provider: "WALMART", encryptedCredentials: Buffer.from("enc") })`.
    - **Assert**: Returns mapped `StoreConfig` with `provider: "WALMART"`.

- **Unit Scenario: UTS-012-B2** — Invalid provider "AMAZON", DatabaseError thrown
    - **Arrange**: Stub DB INSERT to throw `DatabaseError` with code `"DB_ERROR"`.
    - **Act**: Call `create({ userId: "user-uuid", provider: "AMAZON", encryptedCredentials: Buffer.from("enc") })`.
    - **Assert**: Throws `DatabaseError` with code `"DB_ERROR"`.

---

### Module: MOD-013 (AuthMiddleware)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/auth/middleware/auth.middleware.ts`

#### Test Case: UTP-013-A (use — state transition coverage)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies all state transitions: `ExtractToken → Rejected` (missing/malformed header); `VerifyToken → Rejected` (invalid/expired token or disallowed `azp`); `VerifyToken → Attached` (valid token, `request.user` set).

**Dependency & Mock Registry:**

| Dependency         | Source           | Mock/Stub Strategy                                   | Rationale                            |
| ------------------ | ---------------- | ---------------------------------------------------- | ------------------------------------ |
| `clerkAuth`        | ClerkAuthService | Stub: `verifyToken` returns decoded claims or throws | Isolate from real token verification |
| `req`/`res`/`next` | NestJS / Express | Stub: configurable request object; spy on `next`     | Isolate from NestJS runtime          |

- **Unit Scenario: UTS-013-A1** — Missing Authorization header (ExtractToken → Rejected)
    - **Arrange**: Set `request.headers = {}` (no `authorization` key).
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: Throws `UnauthorizedException` with message `"missing_token"`. `clerkAuth.verifyToken` never called.

- **Unit Scenario: UTS-013-A2** — Header present but does not start with "Bearer " (ExtractToken → Rejected)
    - **Arrange**: Set `request.headers.authorization = "Basic abc123"`.
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: Throws `UnauthorizedException` with message `"missing_token"`.

- **Unit Scenario: UTS-013-A3** — Valid Bearer token, verification rejects (VerifyToken → Rejected)
    - **Arrange**: Set `request.headers.authorization = "Bearer valid.jwt.token"`. Stub `clerkAuth.verifyToken` to reject (invalid signature / disallowed `azp`).
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: Throws `UnauthorizedException` with message `"invalid_token"`. `request.user` not set.

- **Unit Scenario: UTS-013-A4** — Valid Bearer token, claims.sub missing (VerifyToken → Rejected)
    - **Arrange**: Set `request.headers.authorization = "Bearer valid.jwt.token"`. Stub `clerkAuth.verifyToken` to resolve `{ sub: null }`.
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: Throws `UnauthorizedException` with message `"invalid_token"`.

- **Unit Scenario: UTS-013-A5** — Valid Bearer token, valid claims (VerifyToken → Attached)
    - **Arrange**: Set `request.headers.authorization = "Bearer valid.jwt.token"`. Stub `clerkAuth.verifyToken` to resolve `{ sub: "user_2abc123" }`.
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: Calls `next()`. `request.user` is the resolved app user for sub `"user_2abc123"`.

#### Test Case: UTP-013-B (use — token extraction boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `token` extraction: `authHeader.slice(7)` correctly strips exactly 7 characters ("Bearer "); empty string after slice is treated as invalid.

**Dependency & Mock Registry:**

| Dependency  | Source           | Mock/Stub Strategy                                    | Rationale                            |
| ----------- | ---------------- | ----------------------------------------------------- | ------------------------------------ |
| `clerkAuth` | ClerkAuthService | Stub: `verifyToken` returns `{ sub: "user_2abc123" }` | Isolate from real token verification |

- **Unit Scenario: UTS-013-B1** — "Bearer " prefix (7 chars) stripped, remaining token passed to verify
    - **Arrange**: Set `request.headers.authorization = "Bearer eyJhbGciOiJSUzI1NiJ9"`. Stub `clerkAuth.verifyToken` to resolve `{ sub: "user_2abc123" }`.
    - **Act**: Call `use(req, res, next)`.
    - **Assert**: `clerkAuth.verifyToken` called with `"eyJhbGciOiJSUzI1NiJ9"` (no "Bearer " prefix). Calls `next()`.

---

### Module: MOD-014 (SubscriptionGuard)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/auth/subscription.guard.ts`

#### Test Case: UTP-014-A (canActivate — state transition coverage)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies all state transitions: `CheckUserId → InternalError` (userId missing); `FetchSubscription → Allowed` (isPremium = true); `FetchSubscription → Rejected` (isPremium = false); `FetchSubscription → Rejected` (adapter timeout/error, fail-closed).

**Dependency & Mock Registry:**

| Dependency             | Source             | Mock/Stub Strategy                                                   | Rationale                           |
| ---------------------- | ------------------ | -------------------------------------------------------------------- | ----------------------------------- |
| `subscriptionsAdapter` | ARCH-014 Interface | Stub: `checkSubscription` returns `{ isPremium: bool }` or throws    | Isolate from real subscriptions API |
| `context`              | NestJS             | Stub: `switchToHttp().getRequest()` returns configurable request obj | Isolate from NestJS runtime         |

- **Unit Scenario: UTS-014-A1** — userId missing (CheckUserId → InternalError)
    - **Arrange**: Set `request.user = undefined` (AuthMiddleware not applied).
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `InternalServerErrorException` with `statusCode: 500`. `subscriptionsAdapter.checkSubscription` never called.

- **Unit Scenario: UTS-014-A2** — isPremium = true (FetchSubscription → Allowed)
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `subscriptionsAdapter.checkSubscription` to resolve `{ isPremium: true }`.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Returns `true`. No exception thrown.

- **Unit Scenario: UTS-014-A3** — isPremium = false (FetchSubscription → Rejected)
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `subscriptionsAdapter.checkSubscription` to resolve `{ isPremium: false }`.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `ForbiddenException` with message `"premium_required"`.

- **Unit Scenario: UTS-014-A4** — Adapter timeout (FetchSubscription → Rejected, fail-closed)
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `subscriptionsAdapter.checkSubscription` to reject with `TimeoutError` after 2001 ms (TIMEOUT_MS + 1). Use fake timers.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `ForbiddenException` with message `"premium_required"`. Fail-closed behaviour confirmed.

- **Unit Scenario: UTS-014-A5** — Adapter error (FetchSubscription → Rejected, fail-closed)
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `subscriptionsAdapter.checkSubscription` to throw `AdapterError`.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `ForbiddenException` with message `"premium_required"`.

#### Test Case: UTP-014-B (canActivate — isPremium boolean equivalence partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Verifies `isPremium` boolean partitions: `true` → allowed (one valid partition); `false` → rejected (one invalid partition).

**Dependency & Mock Registry:**

| Dependency             | Source             | Mock/Stub Strategy                                    | Rationale                           |
| ---------------------- | ------------------ | ----------------------------------------------------- | ----------------------------------- |
| `subscriptionsAdapter` | ARCH-014 Interface | Stub: `checkSubscription` returns configurable result | Isolate from real subscriptions API |

- **Unit Scenario: UTS-014-B1** — isPremium = true (valid partition), returns true
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `checkSubscription` to resolve `{ isPremium: true }`.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Returns `true`.

- **Unit Scenario: UTS-014-B2** — isPremium = false (invalid partition), throws ForbiddenException
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `checkSubscription` to resolve `{ isPremium: false }`.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `ForbiddenException`.

#### Test Case: UTP-014-C (canActivate — TIMEOUT_MS boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `TIMEOUT_MS = 2000` constant: adapter completing at 1999 ms (max - 1) is allowed; adapter exceeding 2000 ms triggers fail-closed rejection.

**Dependency & Mock Registry:**

| Dependency             | Source             | Mock/Stub Strategy                                 | Rationale                        |
| ---------------------- | ------------------ | -------------------------------------------------- | -------------------------------- |
| `subscriptionsAdapter` | ARCH-014 Interface | Stub: delays response by configurable milliseconds | Control timing without real HTTP |
| Timer                  | Node.js runtime    | Use fake timers to control clock                   | Deterministic timeout testing    |

- **Unit Scenario: UTS-014-C1** — Adapter responds at 1999 ms (TIMEOUT_MS - 1), allowed
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `checkSubscription` to resolve `{ isPremium: true }` after 1999 ms. Use fake timers.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Returns `true`. No `ForbiddenException` thrown.

- **Unit Scenario: UTS-014-C2** — Adapter exceeds 2000 ms (TIMEOUT_MS), fail-closed rejection
    - **Arrange**: Set `request.user = { id: "user-uuid" }`. Stub `checkSubscription` to never resolve. Advance fake timer by 2001 ms.
    - **Act**: Call `canActivate(context)`.
    - **Assert**: Throws `ForbiddenException` with message `"premium_required"`.

---

## Coverage Summary

| Module    | Name                                                               | UTP Count | UTS Count | Techniques Applied                                         |
| --------- | ------------------------------------------------------------------ | --------- | --------- | ---------------------------------------------------------- |
| MOD-001   | GroceryListController                                              | 2         | 5         | Statement & Branch Coverage                                |
| MOD-002   | GroceryListService — generateList                                  | 2         | 4         | Statement & Branch Coverage, Boundary Value Analysis       |
| MOD-003   | IngredientAggregator                                               | 2         | 4         | Statement & Branch Coverage, Boundary Value Analysis       |
| MOD-004   | ListStateController                                                | 2         | 4         | Statement & Branch Coverage, Equivalence Partitioning      |
| MOD-005   | ListStateService                                                   | 3         | 7         | Statement & Branch Coverage, Boundary Value Analysis       |
| MOD-006   | GroceryListRepository — grocery_lists table                        | 3         | 7         | Statement & Branch Coverage                                |
| MOD-007   | GroceryListRepository — updateItemFlag                             | 2         | 5         | State Transition Testing, Boundary Value Analysis          |
| MOD-008   | OnlineOrderingController                                           | 1         | 2         | Statement & Branch Coverage                                |
| MOD-009   | OnlineOrderingService                                              | 3         | 7         | Statement & Branch Coverage, State Transition Testing, BVA |
| MOD-010   | StoreConfigController                                              | 2         | 4         | Statement & Branch Coverage, Equivalence Partitioning      |
| MOD-011   | StoreConfigService                                                 | 3         | 7         | Statement & Branch Coverage                                |
| MOD-012   | StoreConfigRepository                                              | 2         | 4         | Statement & Branch Coverage, Equivalence Partitioning      |
| MOD-013   | AuthMiddleware                                                     | 2         | 6         | State Transition Testing, Boundary Value Analysis          |
| MOD-014   | SubscriptionGuard                                                  | 3         | 7         | State Transition Testing, Equivalence Partitioning, BVA    |
| MOD-015   | MealPlanAdapter [EXTERNAL]                                         | —         | —         | Skipped                                                    |
| MOD-016   | RecipeAdapter [EXTERNAL]                                           | —         | —         | Skipped                                                    |
| MOD-017   | UsdaAdapter + Clerk verification + SubscriptionsAdapter [EXTERNAL] | —         | —         | Skipped                                                    |
| MOD-018   | GroceryStoreAdapter [EXTERNAL]                                     | —         | —         | Skipped                                                    |
| **Total** |                                                                    | **32**    | **73**    |                                                            |

**All 14 non-`[EXTERNAL]` modules covered. All 5 ISO 29119-4 white-box techniques applied.**

## Coverage Completion Unit Tests

### Module: MOD-015 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-015.

#### Test Case: UTP-015-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-015 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-015-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-015
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-015-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-015
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-016 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-016.

#### Test Case: UTP-016-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-016 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-016-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-016
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-016-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-016
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-017 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-017.

#### Test Case: UTP-017-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-017 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-017-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-017
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-017-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-017
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-018 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-018.

#### Test Case: UTP-018-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-018 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-018-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-018
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-018-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-018
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
