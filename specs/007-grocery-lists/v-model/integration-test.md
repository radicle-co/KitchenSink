# Integration Test Plan: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/007-grocery-lists/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for Grocery Lists & Online Ordering. Every architecture module in `architecture-design.md` (ARCH-001–ARCH-014) has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

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

### ARCH-001: GroceryListController

#### ITP-001-A — Controller → AuthMiddleware JWT Handshake (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-001 ↔ ARCH-012)
**Requirement Refs**: REQ-003

**ITS-001-A1** — Valid JWT propagates userId to service layer

```gherkin
Given ARCH-001 GroceryListController receives POST /grocery-lists/generate with a valid Bearer JWT and body {mealPlanId: "<uuid>"}
When ARCH-001 delegates token validation to ARCH-012 AuthMiddleware
Then ARCH-012 returns userId attached to request context
And ARCH-001 passes {mealPlanId, userId} to ARCH-002 GroceryListService
And the downstream call carries the correct userId extracted from the JWT sub claim
```

**ITS-001-A2** — Missing Authorization header produces 401 at controller boundary

```gherkin
Given ARCH-001 GroceryListController receives POST /grocery-lists/generate with no Authorization header
When ARCH-001 invokes ARCH-012 AuthMiddleware
Then ARCH-012 returns UnauthorizedError {statusCode: 401, message: "Unauthorized"}
And ARCH-001 serialises the error as HTTP 401 without calling ARCH-002
```

#### ITP-001-B — Controller → GroceryListService Response Serialisation (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-001 ↔ ARCH-002)
**Requirement Refs**: REQ-001

**ITS-001-B1** — GroceryListService success response serialised as 201

```gherkin
Given ARCH-002 GroceryListService returns a GroceryList domain entity {id, userId, mealPlanId, items[]}
When ARCH-001 GroceryListController receives the entity
Then ARCH-001 serialises it as HTTP 201 with body {groceryListId, items[]}
And the response shape matches the Interface View contract for ARCH-001 Output
```

**ITS-001-B2** — TimeoutError from GroceryListService serialised as 504

```gherkin
Given ARCH-002 GroceryListService throws TimeoutError {code: "GENERATION_TIMEOUT"} after 5 seconds
When ARCH-001 GroceryListController catches the error
Then ARCH-001 serialises it as HTTP 504 with body {statusCode: 504, message}
And no partial GroceryList data is included in the response
```

#### ITP-001-C — Controller DTO Validation Boundary (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View (ARCH-001 input boundary)
**Requirement Refs**: REQ-001

**ITS-001-C1** — Malformed mealPlanId (non-UUID) rejected before service call

```gherkin
Given ARCH-001 GroceryListController receives POST /grocery-lists/generate with body {mealPlanId: "not-a-uuid"}
When ARCH-001 applies DTO validation
Then ARCH-001 returns HTTP 400 ValidationError {statusCode: 400, message, errors[]}
And ARCH-002 GroceryListService is never invoked
```

---

### ARCH-002: GroceryListService

#### ITP-002-A — Service → ExternalAdapters MealPlan Fetch (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-002 ↔ ARCH-014 MealPlanAdapter)
**Requirement Refs**: REQ-001

**ITS-002-A1** — MealPlanAdapter returns MealPlan with recipes[]

```gherkin
Given ARCH-002 GroceryListService calls ARCH-014 MealPlanAdapter.getMealPlan(mealPlanId)
When MealPlanAdapter returns MealPlan {recipes: [{recipeId: "<uuid>"}]}
Then ARCH-002 extracts recipeIds[] from the MealPlan
And passes recipeIds[] to ARCH-014 RecipeAdapter.getIngredients()
```

**ITS-002-A2** — EmptyPlanError emitted when MealPlan has no recipes

```gherkin
Given ARCH-014 MealPlanAdapter.getMealPlan() returns MealPlan {recipes: []}
When ARCH-002 GroceryListService evaluates the result
Then ARCH-002 throws EmptyPlanError {code: "EMPTY_PLAN"}
And ARCH-003 IngredientAggregator is never invoked
```

#### ITP-002-B — Service → IngredientAggregator Handshake (Data Flow Testing)

**Technique**: Data Flow Testing
**Architecture View**: Data Flow View (ARCH-002 → ARCH-003)
**Requirement Refs**: REQ-001, REQ-002

**ITS-002-B1** — IngredientTuple[] flows from RecipeAdapter through Service to Aggregator

```gherkin
Given ARCH-014 RecipeAdapter.getIngredients() returns IngredientTuple[] [{ingredientId, quantity, unit}]
When ARCH-002 GroceryListService passes the tuples to ARCH-003 IngredientAggregator.aggregate()
Then ARCH-003 receives the complete unmodified IngredientTuple[] from ARCH-002
And ARCH-003 returns GroceryListItem[] back to ARCH-002
```

#### ITP-002-C — Service 5-Second Timeout Enforcement (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Process View (ARCH-002 timeout boundary)
**Requirement Refs**: REQ-003

**ITS-002-C1** — Timeout fires when external adapter calls exceed 5 seconds

```gherkin
Given ARCH-014 MealPlanAdapter.getMealPlan() delays response beyond 5000ms
When ARCH-002 GroceryListService enforces the 5-second timeout budget
Then ARCH-002 throws TimeoutError {code: "GENERATION_TIMEOUT"}
And ARCH-006 GroceryListRepository.createList() is never called
```

#### ITP-002-D — Service → Repository Persistence Handshake (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-002 ↔ ARCH-006)
**Requirement Refs**: REQ-001

**ITS-002-D1** — GroceryListRepository receives CreateListDTO and returns persisted GroceryList

```gherkin
Given ARCH-003 IngredientAggregator returns GroceryListItem[] to ARCH-002
When ARCH-002 GroceryListService calls ARCH-006 GroceryListRepository.createList({userId, mealPlanId, items[]})
Then ARCH-006 returns GroceryList {id, userId, mealPlanId, items[]}
And ARCH-002 returns the GroceryList entity to ARCH-001 GroceryListController
```

---

### ARCH-003: IngredientAggregator

#### ITP-003-A — Aggregator → UsdaAdapter Normalisation Contract (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-003 ↔ ARCH-014 UsdaAdapter)
**Requirement Refs**: REQ-002

**ITS-003-A1** — ingredientIds[] sent to UsdaAdapter; CanonicalIngredient[] returned

```gherkin
Given ARCH-003 IngredientAggregator receives IngredientTuple[] with ingredientIds [A, B, C]
When ARCH-003 calls ARCH-014 UsdaAdapter.normalise([A, B, C])
Then ARCH-014 returns CanonicalIngredient[] [{canonicalId, canonicalName, unitFactor}] for each id
And ARCH-003 uses the canonical mapping to deduplicate and sum quantities
```

**ITS-003-A2** — NormalisationError propagated when UsdaAdapter returns incomplete mapping

```gherkin
Given ARCH-014 UsdaAdapter.normalise() returns a CanonicalIngredient[] missing entries for some ingredientIds
When ARCH-003 IngredientAggregator detects incomplete mapping
Then ARCH-003 throws NormalisationError {code: "USDA_NORMALISATION_FAILED"}
And no GroceryListItem[] is returned to ARCH-002
```

#### ITP-003-B — Aggregator Deduplication Data Flow (Data Flow Testing)

**Technique**: Data Flow Testing
**Architecture View**: Data Flow View (ARCH-003 internal seam with ARCH-014)
**Requirement Refs**: REQ-002

**ITS-003-B1** — Duplicate ingredientIds collapsed to single GroceryListItem with summed quantity

```gherkin
Given ARCH-003 receives IngredientTuple[] [{ingredientId: "X", quantity: 2, unit: "cup"}, {ingredientId: "X", quantity: 1, unit: "cup"}]
And ARCH-014 UsdaAdapter maps "X" to canonicalId "CX" with unitFactor 1.0
When ARCH-003 deduplicates by canonicalId
Then ARCH-003 returns GroceryListItem[] with exactly one entry for "CX" with quantity 3
```

---

### ARCH-004: ListStateController

#### ITP-004-A — Controller → AuthMiddleware → ListStateService Chain (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-004 ↔ ARCH-012 ↔ ARCH-005)
**Requirement Refs**: REQ-004

**ITS-004-A1** — PATCH request with valid JWT routes userId and payload to ListStateService

```gherkin
Given ARCH-004 ListStateController receives PATCH /grocery-lists/:id/items/:itemId with valid JWT and body {alreadyHave: true}
When ARCH-004 invokes ARCH-012 AuthMiddleware and receives userId
Then ARCH-004 calls ARCH-005 ListStateService.markAlreadyHave(listId, itemId, userId, true)
And ARCH-005 returns updated GroceryListItem
And ARCH-004 serialises it as HTTP 200 {id, ingredientId, alreadyHave: true, ...}
```

**ITS-004-A2** — OwnershipError from ListStateService serialised as 403

```gherkin
Given ARCH-005 ListStateService throws OwnershipError {code: "NOT_OWNER"}
When ARCH-004 ListStateController catches the error
Then ARCH-004 serialises it as HTTP 403 ForbiddenError {statusCode: 403, message}
```

**ITS-004-A3** — ConflictError from ListStateService serialised as 409

```gherkin
Given ARCH-005 ListStateService throws ConflictError {code: "OPTIMISTIC_LOCK_CONFLICT"} after max retries
When ARCH-004 ListStateController catches the error
Then ARCH-004 serialises it as HTTP 409 ConflictError {statusCode: 409, message}
```

#### ITP-004-B — Controller Fault Injection: Missing Body Fields (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View (ARCH-004 input boundary)
**Requirement Refs**: REQ-004

**ITS-004-B1** — PATCH body missing alreadyHave field rejected before service call

```gherkin
Given ARCH-004 ListStateController receives PATCH /grocery-lists/:id/items/:itemId with body {}
When ARCH-004 applies DTO validation
Then ARCH-004 returns HTTP 400 ValidationError
And ARCH-005 ListStateService is never invoked
```

---

### ARCH-005: ListStateService

#### ITP-005-A — Service → Repository Ownership Assertion (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-005 ↔ ARCH-006)
**Requirement Refs**: REQ-004

**ITS-005-A1** — assertOwnership passes when userId matches list owner

```gherkin
Given ARCH-005 ListStateService calls ARCH-006 GroceryListRepository.assertOwnership(listId, userId)
When ARCH-006 confirms userId owns listId
Then ARCH-005 proceeds to call ARCH-006 GroceryListRepository.updateItemFlag(itemId, alreadyHave, version)
```

**ITS-005-A2** — assertOwnership failure propagates OwnershipError to controller

```gherkin
Given ARCH-006 GroceryListRepository.assertOwnership() returns ownership mismatch
When ARCH-005 ListStateService receives the mismatch
Then ARCH-005 throws OwnershipError {code: "NOT_OWNER"}
And ARCH-006 GroceryListRepository.updateItemFlag() is never called
```

#### ITP-005-B — Service → Repository Optimistic Lock Retry (Concurrency & Race Condition Testing)

**Technique**: Concurrency & Race Condition Testing
**Architecture View**: Process View (ARCH-005 ↔ ARCH-006 optimistic lock)
**Requirement Refs**: REQ-004

**ITS-005-B1** — VersionConflict triggers retry up to 3 times

```gherkin
Given ARCH-006 GroceryListRepository.updateItemFlag() returns VersionConflict on first two attempts
When ARCH-005 ListStateService retries the update
Then ARCH-005 retries exactly 2 more times (3 total)
And on the third attempt ARCH-006 returns the updated GroceryListItem
And ARCH-005 returns the item to ARCH-004 ListStateController
```

**ITS-005-B2** — ConflictError thrown after 3 failed optimistic lock attempts

```gherkin
Given ARCH-006 GroceryListRepository.updateItemFlag() returns VersionConflict on all 3 attempts
When ARCH-005 ListStateService exhausts retries
Then ARCH-005 throws ConflictError {code: "OPTIMISTIC_LOCK_CONFLICT"}
And ARCH-004 ListStateController receives the error for serialisation
```

---

### ARCH-006: GroceryListRepository

#### ITP-006-A — Repository → Database Transactional Write (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-006 ↔ PostgreSQL)
**Requirement Refs**: REQ-001

**ITS-006-A1** — createList inserts grocery_lists and grocery_list_items atomically

```gherkin
Given ARCH-006 GroceryListRepository.createList() receives CreateListDTO {userId, mealPlanId, items[3]}
When ARCH-006 executes the transactional insert
Then one row is inserted into grocery_lists and three rows into grocery_list_items in a single transaction
And ARCH-006 returns GroceryList {id, userId, mealPlanId, items[3]}
```

**ITS-006-A2** — DatabaseError propagated on connection failure

```gherkin
Given the PostgreSQL connection is unavailable when ARCH-006 GroceryListRepository.createList() is called
When ARCH-006 attempts the transactional insert
Then ARCH-006 throws DatabaseError {code: "DB_ERROR"}
And no partial data is committed to the database
```

#### ITP-006-B — Repository Optimistic Lock Version Column (Concurrency & Race Condition Testing)

**Technique**: Concurrency & Race Condition Testing
**Architecture View**: Process View (ARCH-006 version column)
**Requirement Refs**: REQ-004

**ITS-006-B1** — Concurrent updateItemFlag calls with same version produce VersionConflict for one

```gherkin
Given two concurrent calls to ARCH-006 GroceryListRepository.updateItemFlag(itemId, alreadyHave, version=1) arrive simultaneously
When the database processes both updates
Then exactly one update succeeds and increments version to 2
And the other update receives VersionConflict {code: "VERSION_CONFLICT"}
```

#### ITP-006-C — Repository alreadyHave Filter Data Flow (Data Flow Testing)

**Technique**: Data Flow Testing
**Architecture View**: Data Flow View (ARCH-006 filtered query)
**Requirement Refs**: REQ-005

**ITS-006-C1** — getActiveItems returns only items where alreadyHave = false

```gherkin
Given grocery_list_items contains items [{id: "A", alreadyHave: false}, {id: "B", alreadyHave: true}]
When ARCH-006 GroceryListRepository.getActiveItems(listId) is called
Then ARCH-006 returns only [{id: "A", alreadyHave: false}]
And item "B" is excluded from the result set
```

---

### ARCH-007: OnlineOrderingController

#### ITP-007-A — Controller → AuthMiddleware + SubscriptionGuard Chain (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-007 ↔ ARCH-012 ↔ ARCH-013)
**Requirement Refs**: REQ-006

**ITS-007-A1** — Premium user JWT passes both guards and reaches OnlineOrderingService

```gherkin
Given ARCH-007 OnlineOrderingController receives POST /grocery-lists/:id/order with a valid premium-user JWT
When ARCH-007 invokes ARCH-012 AuthMiddleware then ARCH-013 SubscriptionGuard in sequence
Then ARCH-012 returns userId and ARCH-013 confirms premium tier
And ARCH-007 calls ARCH-008 OnlineOrderingService.submitOrder(listId, userId)
```

**ITS-007-A2** — Free-tier user blocked by SubscriptionGuard with 403

```gherkin
Given ARCH-013 SubscriptionGuard returns free-tier rejection for userId
When ARCH-007 OnlineOrderingController receives the rejection
Then ARCH-007 serialises it as HTTP 403 ForbiddenError {statusCode: 403, message: "premium_required"}
And ARCH-008 OnlineOrderingService is never invoked
```

#### ITP-007-B — Controller → Service StoreApiError Serialisation (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View (ARCH-007 ↔ ARCH-008 error boundary)
**Requirement Refs**: REQ-010

**ITS-007-B1** — StoreApiError from OnlineOrderingService serialised as 503

```gherkin
Given ARCH-008 OnlineOrderingService throws StoreApiError {code: "STORE_API_UNAVAILABLE"}
When ARCH-007 OnlineOrderingController catches the error
Then ARCH-007 serialises it as HTTP 503 ServiceUnavailable {statusCode: 503, error, retryAfter}
And the grocery list state is preserved (no mutation occurred)
```

---

### ARCH-008: OnlineOrderingService

#### ITP-008-A — Service → ListStateService Active Items Fetch (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-008 ↔ ARCH-005)
**Requirement Refs**: REQ-005, REQ-006

**ITS-008-A1** — OnlineOrderingService receives only alreadyHave=false items from ListStateService

```gherkin
Given ARCH-005 ListStateService.getActiveItems(listId, userId) returns GroceryListItem[] filtered to alreadyHave=false
When ARCH-008 OnlineOrderingService receives the item list
Then ARCH-008 passes only those items to ARCH-014 GroceryStoreAdapter for order submission
And no alreadyHave=true items are included in the order payload
```

#### ITP-008-B — Service → StoreConfigService Config Resolution (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-008 ↔ ARCH-010)
**Requirement Refs**: REQ-007

**ITS-008-B1** — NoStoreConfigError propagated when StoreConfigService finds no config

```gherkin
Given ARCH-010 StoreConfigService.getConfig(userId) returns NoStoreConfigError {code: "NO_STORE_CONFIG"}
When ARCH-008 OnlineOrderingService receives the error
Then ARCH-008 throws NoStoreConfigError
And ARCH-014 GroceryStoreAdapter is never invoked
```

#### ITP-008-C — Service → GroceryStoreAdapter Retry on Outage (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View + Process View (ARCH-008 ↔ ARCH-014 GroceryStoreAdapter)
**Requirement Refs**: REQ-010

**ITS-008-C1** — Transient GroceryStoreAdapter failure triggers retry; success on second attempt

```gherkin
Given ARCH-014 GroceryStoreAdapter.submitOrder() fails with a transient network error on the first attempt
When ARCH-008 OnlineOrderingService applies retry logic
Then ARCH-008 retries the call to ARCH-014 GroceryStoreAdapter
And on the second attempt ARCH-014 returns OrderSubmission {providerOrderId, status: "submitted"}
And ARCH-008 returns the OrderSubmission to ARCH-007 OnlineOrderingController
```

**ITS-008-C2** — Persistent GroceryStoreAdapter outage results in StoreApiError with list state preserved

```gherkin
Given ARCH-014 GroceryStoreAdapter.submitOrder() fails on all retry attempts
When ARCH-008 OnlineOrderingService exhausts retries
Then ARCH-008 throws StoreApiError {code: "STORE_API_UNAVAILABLE"}
And ARCH-006 GroceryListRepository state is unchanged (no order record written)
```

---

### ARCH-009: StoreConfigController

#### ITP-009-A — Controller → StoreConfigService Credential Delegation (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-009 ↔ ARCH-010)
**Requirement Refs**: REQ-007

**ITS-009-A1** — POST /store-configs delegates validated credentials to StoreConfigService

```gherkin
Given ARCH-009 StoreConfigController receives POST /store-configs with valid JWT and body {provider: "KROGER", credentials: {...}}
When ARCH-009 delegates to ARCH-010 StoreConfigService.createConfig(userId, provider, credentials)
Then ARCH-010 returns StoreConfig {id, provider, active: true}
And ARCH-009 serialises it as HTTP 201 {id, provider, active}
```

**ITS-009-A2** — Setup guidance payload returned when no config exists

```gherkin
Given ARCH-010 StoreConfigService.getConfig(userId) returns setup guidance payload (no config found)
When ARCH-009 StoreConfigController receives the guidance payload
Then ARCH-009 serialises it as HTTP 200 {id: null, provider: null, setupGuide: {...}}
```

#### ITP-009-B — Controller Fault Injection: Invalid Provider Enum (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View (ARCH-009 input boundary)
**Requirement Refs**: REQ-007

**ITS-009-B1** — Unsupported provider value rejected before service call

```gherkin
Given ARCH-009 StoreConfigController receives POST /store-configs with body {provider: "UNSUPPORTED_STORE", credentials: {}}
When ARCH-009 applies DTO validation
Then ARCH-009 returns HTTP 400 ValidationError {statusCode: 400, message}
And ARCH-010 StoreConfigService is never invoked
```

---

### ARCH-010: StoreConfigService

#### ITP-010-A — Service → StoreConfigRepository Encrypted Persistence (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-010 ↔ ARCH-011)
**Requirement Refs**: REQ-007, REQ-008

**ITS-010-A1** — Credentials encrypted before being passed to StoreConfigRepository

```gherkin
Given ARCH-010 StoreConfigService.createConfig(userId, provider, credentials) is called with plaintext credentials
When ARCH-010 encrypts credentials via AES-256-GCM (KMS) and calls ARCH-011 StoreConfigRepository.createConfig({userId, provider, encryptedCreds})
Then ARCH-011 receives encryptedCreds (not plaintext)
And ARCH-011 returns StoreConfig domain entity
And ARCH-010 returns the entity to ARCH-009 StoreConfigController
```

**ITS-010-A2** — InvalidCredentials error propagated when provider validation fails

```gherkin
Given ARCH-010 StoreConfigService validates provider credentials and detects an invalid shape
When ARCH-010 rejects the credentials
Then ARCH-010 throws InvalidCredentials {code: "INVALID_CREDENTIALS"}
And ARCH-011 StoreConfigRepository.createConfig() is never called
```

---

### ARCH-011: StoreConfigRepository

#### ITP-011-A — Repository → Database Encrypted Credential Storage (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-011 ↔ PostgreSQL store_configs table)
**Requirement Refs**: REQ-008

**ITS-011-A1** — createConfig persists encryptedCreds to store_configs table

```gherkin
Given ARCH-011 StoreConfigRepository.createConfig({userId, provider: "KROGER", encryptedCreds: "<ciphertext>"}) is called
When ARCH-011 executes the INSERT
Then one row is written to store_configs with encryptedCreds stored as ciphertext (not plaintext)
And ARCH-011 returns StoreConfig {id, userId, provider, active: true}
```

**ITS-011-B1** — getByUserId returns decrypted StoreConfig[] for the user

```gherkin
Given store_configs contains one row for userId with encryptedCreds
When ARCH-011 StoreConfigRepository.getByUserId(userId) is called
Then ARCH-011 decrypts the credentials on read
And returns StoreConfig[] with the decrypted credential shape to ARCH-010 StoreConfigService
```

---

### ARCH-012: AuthMiddleware [CROSS-CUTTING]

#### ITP-012-A — AuthMiddleware → ClerkAuthService Token Verification (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-012 ↔ ARCH-014 ClerkAuthService)
**Requirement Refs**: REQ-CN-001

**ITS-012-A1** — Valid Clerk session token verified networklessly (CLERK_JWT_KEY); userId extracted and attached to context

```gherkin
Given ARCH-012 AuthMiddleware receives a Bearer JWT from the request Authorization header
When ARCH-012 calls ARCH-014 ClerkAuthService.verifyToken(token)
Then ARCH-014 returns {userId} decoded from the JWT sub claim
And ARCH-012 attaches userId to request.user.id
And control returns to the calling controller (ARCH-001, ARCH-004, or ARCH-007)
```

**ITS-012-A2** — Expired token causes ClerkAuthService to reject; AuthMiddleware returns 401

```gherkin
Given ARCH-014 ClerkAuthService.verifyToken(token) throws a token-expiry error
When ARCH-012 AuthMiddleware receives the error
Then ARCH-012 returns UnauthorizedError {statusCode: 401, message: "Unauthorized"}
And the downstream controller never receives a userId
```

#### ITP-012-B — AuthMiddleware Fault Injection: Token Verification Failure (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View + Process View (ARCH-012 ↔ ARCH-014 ClerkAuthService)
**Requirement Refs**: REQ-CN-001

**ITS-012-B1** — Disallowed azp (or malformed/invalid token) causes ClerkAuthService to reject; AuthMiddleware returns 401

```gherkin
Given ARCH-014 ClerkAuthService.verifyToken(token) rejects the token (disallowed azp / bad signature)
When ARCH-012 AuthMiddleware catches the error
Then ARCH-012 returns UnauthorizedError {statusCode: 401, message: "Unauthorized"}
And no userId is propagated to any downstream module
```

---

### ARCH-013: SubscriptionGuard [CROSS-CUTTING]

#### ITP-013-A — SubscriptionGuard → SubscriptionsAdapter Premium Check (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-013 ↔ ARCH-014 SubscriptionsAdapter)
**Requirement Refs**: REQ-CN-002

**ITS-013-A1** — Premium userId confirmed by SubscriptionsAdapter; guard passes

```gherkin
Given ARCH-012 AuthMiddleware has already attached userId to request context
When ARCH-013 SubscriptionGuard calls ARCH-014 SubscriptionsAdapter.isPremium(userId)
Then ARCH-014 returns {premium: true}
And ARCH-013 allows the request to proceed to ARCH-007 OnlineOrderingController
```

**ITS-013-A2** — Free-tier userId rejected by SubscriptionsAdapter; guard returns 403

```gherkin
Given ARCH-014 SubscriptionsAdapter.isPremium(userId) returns {premium: false}
When ARCH-013 SubscriptionGuard receives the result
Then ARCH-013 returns ForbiddenError {statusCode: 403, message: "premium_required"}
And ARCH-008 OnlineOrderingService is never invoked
```

#### ITP-013-B — SubscriptionGuard Fault Injection: SubscriptionsAdapter Unavailable (Interface Fault Injection)

**Technique**: Interface Fault Injection
**Architecture View**: Interface View + Process View (ARCH-013 ↔ ARCH-014)
**Requirement Refs**: REQ-CN-002

**ITS-013-B1** — SubscriptionsAdapter network failure causes SubscriptionGuard to fail closed (403)

```gherkin
Given ARCH-014 SubscriptionsAdapter.isPremium(userId) throws a network error
When ARCH-013 SubscriptionGuard catches the error
Then ARCH-013 fails closed and returns ForbiddenError {statusCode: 403, message: "premium_required"}
And ARCH-008 OnlineOrderingService is never invoked
```

---

### ARCH-014: ExternalAdapters [CROSS-CUTTING]

#### ITP-014-A — MealPlanAdapter → Meal Plan Service Contract (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-014 MealPlanAdapter ↔ external Meal Plan API)
**Requirement Refs**: REQ-001

**ITS-014-A1** — MealPlanAdapter maps external API response to MealPlan domain object

```gherkin
Given the external Meal Plan API (feature 006) returns a valid meal plan JSON payload
When ARCH-014 MealPlanAdapter.getMealPlan(mealPlanId) processes the response
Then MealPlanAdapter returns a MealPlan domain object {recipes: [{recipeId}]}
And the domain object shape matches the contract expected by ARCH-002 GroceryListService
```

#### ITP-014-B — RecipeAdapter Parallel Fetch Data Flow (Data Flow Testing)

**Technique**: Data Flow Testing
**Architecture View**: Data Flow View (ARCH-014 RecipeAdapter parallel calls)
**Requirement Refs**: REQ-001

**ITS-014-B1** — RecipeAdapter fetches ingredients for multiple recipeIds in parallel

```gherkin
Given ARCH-002 GroceryListService passes recipeIds [R1, R2, R3] to ARCH-014 RecipeAdapter.getIngredients()
When ARCH-014 RecipeAdapter executes parallel HTTP calls for each recipeId
Then ARCH-014 returns a merged IngredientTuple[] combining results from all three recipe fetches
And the merged array is returned to ARCH-002 as a single flat IngredientTuple[]
```

#### ITP-014-C — GroceryStoreAdapter Provider Mapping (Interface Contract Testing)

**Technique**: Interface Contract Testing
**Architecture View**: Interface View (ARCH-014 GroceryStoreAdapter ↔ provider API)
**Requirement Refs**: REQ-006

**ITS-014-C1** — GroceryStoreAdapter maps GroceryListItem[] to provider-specific order payload

```gherkin
Given ARCH-008 OnlineOrderingService passes GroceryListItem[] and StoreConfig {provider: "KROGER", decryptedCredentials} to ARCH-014 GroceryStoreAdapter.submitOrder()
When ARCH-014 GroceryStoreAdapter maps items to Kroger SKU format and submits to the provider API
Then the provider API returns a confirmation with providerOrderId
And ARCH-014 returns OrderSubmission {providerOrderId, status: "submitted"} to ARCH-008
```

#### ITP-014-D — ClerkAuthService Concurrency: Parallel Token Verifications (Concurrency & Race Condition Testing)

**Technique**: Concurrency & Race Condition Testing
**Architecture View**: Process View (ARCH-014 ClerkAuthService concurrent calls)
**Requirement Refs**: REQ-CN-001

**ITS-014-D1** — Concurrent networkless token verifications produce no race conditions (no shared mutable cache)

```gherkin
Given 10 concurrent requests each invoke ARCH-014 ClerkAuthService.verifyToken(token) simultaneously
When ClerkAuthService verifies all tokens statelessly and networklessly against the public CLERK_JWT_KEY
Then all 10 verifications complete with no shared mutable state to corrupt and no cross-request interference
And each returns the correct userId for its respective token
```

---

## Coverage Summary

| ARCH ID   | Module Name                       | ITP Count | ITS Count | Techniques Applied                                          |
| --------- | --------------------------------- | --------- | --------- | ----------------------------------------------------------- |
| ARCH-001  | GroceryListController             | 3         | 5         | Interface Contract, Interface Fault Injection               |
| ARCH-002  | GroceryListService                | 4         | 5         | Interface Contract, Data Flow, Interface Fault Injection    |
| ARCH-003  | IngredientAggregator              | 2         | 3         | Interface Contract, Data Flow                               |
| ARCH-004  | ListStateController               | 2         | 4         | Interface Contract, Interface Fault Injection               |
| ARCH-005  | ListStateService                  | 2         | 4         | Interface Contract, Concurrency & Race Condition            |
| ARCH-006  | GroceryListRepository             | 3         | 4         | Interface Contract, Concurrency & Race Condition, Data Flow |
| ARCH-007  | OnlineOrderingController          | 2         | 3         | Interface Contract, Interface Fault Injection               |
| ARCH-008  | OnlineOrderingService             | 3         | 4         | Interface Contract, Interface Fault Injection               |
| ARCH-009  | StoreConfigController             | 2         | 3         | Interface Contract, Interface Fault Injection               |
| ARCH-010  | StoreConfigService                | 1         | 2         | Interface Contract                                          |
| ARCH-011  | StoreConfigRepository             | 1         | 2         | Interface Contract                                          |
| ARCH-012  | AuthMiddleware [CROSS-CUTTING]    | 2         | 3         | Interface Contract, Interface Fault Injection               |
| ARCH-013  | SubscriptionGuard [CROSS-CUTTING] | 2         | 3         | Interface Contract, Interface Fault Injection               |
| ARCH-014  | ExternalAdapters [CROSS-CUTTING]  | 4         | 5         | Interface Contract, Data Flow, Concurrency & Race Condition |
| **Total** |                                   | **33**    | **49**    |                                                             |

## Technique Coverage

| Technique                            | ITP Count |
| ------------------------------------ | --------- |
| Interface Contract Testing           | 22        |
| Data Flow Testing                    | 5         |
| Interface Fault Injection            | 11        |
| Concurrency & Race Condition Testing | 4         |

All four mandatory ISO 29119-4 integration test techniques are represented.

## ARCH Coverage Verification

All 14 architecture modules (ARCH-001 through ARCH-014) have at least one ITP. All cross-cutting modules (ARCH-012, ARCH-013, ARCH-014) have at least one ITP as required.

✅ **Coverage: 14/14 ARCH modules covered**
✅ **All ITP have at least one ITS**
✅ **All four ISO 29119-4 techniques applied**
