# Unit Test Plan: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the USDA Food Data Integration feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
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

---

## Unit Tests

---

### Module: MOD-001 (FoodApiController — Request Handler)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `packages/services/food-service/src/food-api/handler.ts`

---

#### Test Case: UTP-001-A (isValidFdcId — boundary and branch coverage)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies every branch of `isValidFdcId()` across the integer boundary: non-numeric, ≤0, valid range, and >9999999.

**Dependency & Mock Registry:**

None — `isValidFdcId` is a pure function with no external dependencies.

- **Unit Scenario: UTS-001-A1**
    - **Arrange**: Set `fdcId = 0`
    - **Act**: Call `isValidFdcId(0)`
    - **Assert**: Returns `false` (boundary: min-1 is 0, must be > 0)

- **Unit Scenario: UTS-001-A2**
    - **Arrange**: Set `fdcId = 1`
    - **Act**: Call `isValidFdcId(1)`
    - **Assert**: Returns `true` (boundary: min valid value)

- **Unit Scenario: UTS-001-A3**
    - **Arrange**: Set `fdcId = 5000000`
    - **Act**: Call `isValidFdcId(5000000)`
    - **Assert**: Returns `true` (mid-range valid value)

- **Unit Scenario: UTS-001-A4**
    - **Arrange**: Set `fdcId = 9999999`
    - **Act**: Call `isValidFdcId(9999999)`
    - **Assert**: Returns `true` (boundary: max valid value)

- **Unit Scenario: UTS-001-A5**
    - **Arrange**: Set `fdcId = 10000000`
    - **Act**: Call `isValidFdcId(10000000)`
    - **Assert**: Returns `false` (boundary: max+1 exceeds limit)

- **Unit Scenario: UTS-001-A6**
    - **Arrange**: Set `fdcId = "abc"` (non-numeric string)
    - **Act**: Call `isValidFdcId("abc")`
    - **Assert**: Returns `false` (non-integer input)

- **Unit Scenario: UTS-001-A7**
    - **Arrange**: Set `fdcId = -1`
    - **Act**: Call `isValidFdcId(-1)`
    - **Assert**: Returns `false` (negative integer)

---

#### Test Case: UTP-001-B (handleGetFood — 4-layer cache lookup branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies every branch in `handleGetFood()`: invalid fdcId → 400; cache HIT → 200; cache MISS + DB HIT → 200; cache MISS + DB MISS + pending → 202; cache MISS + DB MISS + not pending → 202 with backfill trigger.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                                   | Rationale                                                                                             |
| -------------------- | -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CacheService`       | ARCH-007 | Mock: `get()` returns null or FoodData stub          | Isolate cache layer (in-process LRU / Postgres default; deferred Redis variant) from controller logic |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns null or FoodData stub  | Isolate DB layer from controller logic                                                                |
| `EnqueueEmitter`     | ARCH-002 | Mock: `publishFoodRequested()` returns `{ eventId }` | Prevent real EventBridge calls                                                                        |
| `MonitoringLogger`   | ARCH-011 | Stub: no-op                                          | Prevent CloudWatch side-effects                                                                       |

- **Unit Scenario: UTS-001-B1**
    - **Arrange**: Set `event.pathParameters.fdcId = "abc"`; `isValidFdcId` returns `false`
    - **Act**: Call `handleGetFood(event)` with mocked dependencies
    - **Assert**: Returns `{ statusCode: 400, body: '{"error":"Invalid fdcId format"}' }`; `CacheService.get` NOT called; `PostgresRepository.findByFdcId` NOT called

- **Unit Scenario: UTS-001-B2**
    - **Arrange**: Set `event.pathParameters.fdcId = "12345"`; `CacheService.get` mock returns `{ fdcId: 12345, description: "Apple" }` (cache HIT)
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains fdcId 12345 }`; `MonitoringLogger.incrementMetric` called with `"cache.hit", 1`; `PostgresRepository.findByFdcId` NOT called

- **Unit Scenario: UTS-001-B3**
    - **Arrange**: Set `fdcId = "12345"`; `CacheService.get` returns `null`; `PostgresRepository.findByFdcId` returns `{ fdcId: 12345, fetch_status: "fetched" }`
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 200 }`; `CacheService.set` called with `fdcId=12345, TTL=3600`; `MonitoringLogger.incrementMetric` called with `"db.hit", 1`

- **Unit Scenario: UTS-001-B4**
    - **Arrange**: Set `fdcId = "12345"`; `CacheService.get` returns `null`; `PostgresRepository.findByFdcId` returns `null`; `CacheService.isPending` returns `true`
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 202, body: contains "pending" }`; `EnqueueEmitter.publishFoodRequested` NOT called; `CacheService.markPending` NOT called

- **Unit Scenario: UTS-001-B5**
    - **Arrange**: Set `fdcId = "12345"`; `CacheService.get` returns `null`; `PostgresRepository.findByFdcId` returns `null`; `CacheService.isPending` returns `false`
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 202, body: contains "pending" }`; `CacheService.markPending` called with `12345`; `EnqueueEmitter.publishFoodRequested` called with `{ fdcId: 12345 }`; `MonitoringLogger.incrementMetric` called with `"backfill.triggered", 1`

---

#### Test Case: UTP-001-C (handleSearchFoods — query length branch coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies `handleSearchFoods()` rejects queries shorter than 2 characters and passes valid queries to the repository.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                              | Rationale                    |
| -------------------- | -------- | ----------------------------------------------- | ---------------------------- |
| `PostgresRepository` | ARCH-006 | Mock: `searchFoods()` returns `[]` or food list | Isolate DB from search logic |

- **Unit Scenario: UTS-001-C1**
    - **Arrange**: Set `event.queryStringParameters.query = "a"` (length 1)
    - **Act**: Call `handleSearchFoods(event)`
    - **Assert**: Returns `{ statusCode: 400, body: '{"error":"Query too short"}' }`; `PostgresRepository.searchFoods` NOT called

- **Unit Scenario: UTS-001-C2**
    - **Arrange**: Set `event.queryStringParameters.query = ""` (length 0)
    - **Act**: Call `handleSearchFoods(event)`
    - **Assert**: Returns `{ statusCode: 400 }`; `PostgresRepository.searchFoods` NOT called

- **Unit Scenario: UTS-001-C3**
    - **Arrange**: Set `event.queryStringParameters.query = "ap"` (length 2, boundary min valid); `PostgresRepository.searchFoods` mock returns `[{ fdcId: 1, description: "Apple" }]`
    - **Act**: Call `handleSearchFoods(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains foods array }`; `PostgresRepository.searchFoods` called with `"ap"`

---

#### Test Case: UTP-001-D (handleGetFoodStatus — state machine transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies `handleGetFoodStatus()` transitions: invalid fdcId → Rejected; DB null + pending → 200 pending; DB null + not pending → 404; DB row found → 200 with status.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                             | Rationale                                                                            |
| -------------------- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns null or row stub | Isolate DB from status logic                                                         |
| `CacheService`       | ARCH-007 | Mock: `isPending()` returns boolean            | Isolate cache (in-process LRU / Postgres default; deferred Redis variant) from logic |

- **Unit Scenario: UTS-001-D1**
    - **Arrange**: Set `fdcId = "-5"` (invalid); `isValidFdcId` returns `false`
    - **Act**: Call `handleGetFoodStatus(event)`
    - **Assert**: Returns `{ statusCode: 400 }`; `PostgresRepository.findByFdcId` NOT called

- **Unit Scenario: UTS-001-D2**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `null`; `CacheService.isPending` returns `true`
    - **Act**: Call `handleGetFoodStatus(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains '"status":"pending"' }`

- **Unit Scenario: UTS-001-D3**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `null`; `CacheService.isPending` returns `false`
    - **Act**: Call `handleGetFoodStatus(event)`
    - **Assert**: Returns `{ statusCode: 404 }`

- **Unit Scenario: UTS-001-D4**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fdcId: 12345, fetch_status: "fetched", nutrients: {} }`
    - **Act**: Call `handleGetFoodStatus(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains foodData }`

- **Unit Scenario: UTS-001-D5**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fdcId: 12345, fetch_status: "not_found" }`
    - **Act**: Call `handleGetFoodStatus(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains '"status":"not_found"' }`; `foodData` field absent

---

#### Test Case: UTP-001-E (handleGetNutrition — fetch_status guard)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures (`FetchStatus` enum)
**Description**: Verifies `handleGetNutrition()` returns 404 for all non-`fetched` FetchStatus values and 200 only when `fetch_status == "fetched"`.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                                            | Rationale                       |
| -------------------- | -------- | ------------------------------------------------------------- | ------------------------------- |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns row with varying `fetch_status` | Isolate DB from nutrition logic |

- **Unit Scenario: UTS-001-E1**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `null`
    - **Act**: Call `handleGetNutrition(event)`
    - **Assert**: Returns `{ statusCode: 404, body: contains "Nutrition data not available" }`

- **Unit Scenario: UTS-001-E2**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fetch_status: "pending" }`
    - **Act**: Call `handleGetNutrition(event)`
    - **Assert**: Returns `{ statusCode: 404 }`

- **Unit Scenario: UTS-001-E3**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fetch_status: "not_found" }`
    - **Act**: Call `handleGetNutrition(event)`
    - **Assert**: Returns `{ statusCode: 404 }`

- **Unit Scenario: UTS-001-E4**
    - **Arrange**: Set `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fetch_status: "fetched", nutrients: { protein: { amount: 2.5, unit: "g" } } }`
    - **Act**: Call `handleGetNutrition(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains nutrients object }`

---

#### Test Case: UTP-001-F (handleGetFood — stale-while-revalidate: serve stale 200 + enqueue re-fetch, serve indefinitely on repeated failure)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (Fetched → Stale → (Revalidating) → Fetched/Stale)
**Description**: Verifies the stale-read (SWR) branch of `handleGetFood()` (FR-031, clarified 2026-06-20): when the record is held but `stale` (older than the staleness threshold), the read **serves the existing data immediately as `200`** (with a staleness indicator) **and enqueues a background re-fetch** — the read never blocks and never returns `202` for a record it already holds. If the background re-fetch keeps failing (prolonged USDA outage), repeated reads **continue serving the stale data indefinitely** (availability over freshness) and keep enqueuing the re-fetch (subject to dedup) — there is no max-staleness cutoff that withholds an already-held record. The re-fetch enqueue is mocked so only the read decision logic is tested.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                                                                 | Rationale                                         |
| -------------------- | -------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| `CacheService`       | ARCH-007 | Mock: `get()` returns null (force DB read)                                         | Isolate cache layer from the stale-detection path |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns a row with `fetch_status='stale'` / old `fetched_at` | Drive the stale branch deterministically          |
| `EnqueueEmitter`     | ARCH-002 | Spy: `publishFoodRequested()` — assert re-fetch enqueued                           | Verify SWR enqueues the background re-fetch       |
| `MonitoringLogger`   | ARCH-011 | Stub: no-op                                                                        | Prevent CloudWatch side-effects                   |

- **Unit Scenario: UTS-001-F1**
    - **Arrange**: `fdcId = "12345"`; `CacheService.get` returns `null`; `PostgresRepository.findByFdcId` returns `{ fdcId: 12345, fetch_status: "stale", fetched_at: <31 days ago> }`
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 200, body: contains foodData AND a staleness indicator (e.g. "stale": true) }` (NOT `202` — the held record is served immediately); `EnqueueEmitter.publishFoodRequested` called with `{ fdcId: 12345 }` (background re-fetch enqueued, stale-while-revalidate)

- **Unit Scenario: UTS-001-F2**
    - **Arrange**: As F1, but the background re-fetch has repeatedly failed (USDA outage for days); the row is still `stale` on a subsequent read
    - **Act**: Call `handleGetFood(event)` again
    - **Assert**: Still returns `{ statusCode: 200, body: contains the stale foodData + staleness indicator }` — the stale record is served **indefinitely** (availability over freshness; no max-staleness cutoff withholds the held data); `EnqueueEmitter.publishFoodRequested` is invoked again to keep retrying the re-fetch (subject to `ON CONFLICT` dedup)

---

#### Test Case: UTP-001-G (handleGetFood — tombstone TTL: within TTL → 404 no enqueue; after TTL → re-attempt)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (tombstone TTL branch)
**Description**: Verifies the `not_found` tombstone TTL branch of `handleGetFood()` (FR-025, clarified 2026-06-20): a `fdcId` tombstoned as `not_found` returns `404` **without enqueueing** while the tombstone is **within its configurable TTL (default 30 days)**; once the TTL has lapsed, a later lookup **MAY re-attempt** the fetch (USDA may have since added the food) by enqueueing a re-fetch — and that re-attempt counts against the normal rolling-window budget so it cannot bypass the rate limit. The repository/clock and enqueue are mocked so only the TTL decision boundary is tested.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                                                                                   | Rationale                                               |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns a `not_found` tombstone row with controlled `fetched_at`/tombstone age | Drive the within-TTL vs after-TTL boundary              |
| `EnqueueEmitter`     | ARCH-002 | Spy: `publishFoodRequested()` — assert zero within TTL, one after TTL                                | Verify enqueue suppression within TTL, re-attempt after |
| `now`                | Internal | Mock: returns a controlled epoch so the TTL boundary can be crossed                                  | Deterministic TTL boundary                              |

- **Unit Scenario: UTS-001-G1**
    - **Arrange**: `TOMBSTONE_TTL_DAYS = 30`; `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns `{ fdcId: 12345, fetch_status: "not_found", fetched_at: <29 days ago> }` (within TTL, boundary max-1)
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: Returns `{ statusCode: 404 }`; `EnqueueEmitter.publishFoodRequested` called **zero** times (within TTL → `404` with no enqueue, FR-025)

- **Unit Scenario: UTS-001-G2**
    - **Arrange**: `TOMBSTONE_TTL_DAYS = 30`; `fdcId = "12345"`; `PostgresRepository.findByFdcId` returns a `not_found` tombstone with `fetched_at = <31 days ago>` (after TTL)
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: A re-attempt is enqueued — `EnqueueEmitter.publishFoodRequested` called once with `{ fdcId: 12345 }` (after TTL → re-attempt, counting against the normal rolling-window budget per FR-025); response is `202`/pending (a re-fetch is now in flight)

- **Unit Scenario: UTS-001-G3**
    - **Arrange**: `TOMBSTONE_TTL_DAYS = 30`; tombstone `fetched_at = exactly 30 days ago` (boundary at-TTL)
    - **Act**: Call `handleGetFood(event)`
    - **Assert**: At the exact TTL boundary the tombstone is treated as lapsed (TTL **has** elapsed) → `EnqueueEmitter.publishFoodRequested` called once (confirms the branch is gated on TTL elapse, not an always-404)

---

#### Test Case: UTP-001-H (handleGetFoodBatch — per-item partial: cached inline + pending per miss)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View (per-item partial assembly)
**Description**: Verifies the per-item partial response of `handleGetFoodBatch()` (`POST /v1/foods/batch`, FR-045, clarified 2026-06-20): for an accepted batch mixing cached/stale and uncached ids, the response returns **cached/stale foods inline** and **each miss as a `pending` entry whose fetch is enqueued**, in a single response body (no all-or-nothing withholding). Over-limit batches (>100) are rejected `400` with no enqueue (see also UTP-012-F). Cache/DB and enqueue are mocked so only the partial-assembly logic is tested.

**Dependency & Mock Registry:**

| Dependency           | Source   | Mock/Stub Strategy                                                                          | Rationale                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| `CacheService`       | ARCH-007 | Mock: `get()` returns FoodData for cached ids, null for misses                              | Drive the mixed cached/miss split |
| `PostgresRepository` | ARCH-006 | Mock: `findByFdcId()` returns rows for cached ids, null for misses                          | Resolve cached ids inline         |
| `EnqueueEmitter`     | ARCH-002 | Spy: `publishFoodRequested()` / `publishFoodBatchRequested()` — assert one enqueue per miss | Verify each miss is enqueued      |

- **Unit Scenario: UTS-001-H1**
    - **Arrange**: `fdcIds = [101, 102, 103]`; `CacheService.get` resolves `101` and `102` (cached HIT), `null` for `103` (miss); `PostgresRepository.findByFdcId(103)` returns `null`; `CacheService.isPending(103)` returns `false`
    - **Act**: Call `handleGetFoodBatch(event)`
    - **Assert**: Returns `{ statusCode: 200, body: { results: [ { fdcId: 101, foodData }, { fdcId: 102, foodData }, { fdcId: 103, status: "pending" } ] } }` — cached foods inline, the miss as a `pending` entry in one body; `EnqueueEmitter.publish*` enqueues a fetch for `103` only (per-item partial, FR-045)

- **Unit Scenario: UTS-001-H2**
    - **Arrange**: `fdcIds = [201, 202]`; both resolve from cache/DB (all cached)
    - **Act**: Call `handleGetFoodBatch(event)`
    - **Assert**: Returns `{ statusCode: 200 }` with both inline; `EnqueueEmitter.publish*` called **zero** times (no misses → no enqueue)

- **Unit Scenario: UTS-001-H3**
    - **Arrange**: `fdcIds` array of length `101` (over the `MAX_BATCH = 100` cap)
    - **Act**: Call `handleGetFoodBatch(event)`
    - **Assert**: Returns `{ statusCode: 400 }`; `EnqueueEmitter.publish*` called **zero** times — an oversized batch is rejected before any enqueue (FR-045, boundary max+1; cross-refs UTP-012-F)

---

### Module: MOD-002 (EnqueueEmitter — Event Emitter)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `packages/services/food-service/src/events/event-bridge-publisher.ts`

---

#### Test Case: UTP-002-A (publishFoodRequested — validation and happy path)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `publishFoodRequested()` throws `ValidationError` for invalid inputs and, on valid input, performs the Postgres-as-queue enqueue — `FetchQueue.insert(...)` (INSERT ON CONFLICT into `fetch_queue`) followed by `Postgres.notify('fetch_queue', …)` — returning `{ queueRowId }`.

**Dependency & Mock Registry:**

| Dependency         | Source                  | Mock/Stub Strategy                                 | Rationale                       |
| ------------------ | ----------------------- | -------------------------------------------------- | ------------------------------- |
| `FetchQueue`       | ARCH-003 (Postgres DAO) | Mock: `insert()` returns `{ queueRowId: "q-1" }`   | Prevent real Postgres writes    |
| `Postgres`         | pg client (external)    | Mock: `notify('fetch_queue', …)` records call args | Verify NOTIFY without a real DB |
| `MonitoringLogger` | ARCH-011                | Stub: no-op                                        | Prevent CloudWatch side-effects |

- **Unit Scenario: UTS-002-A1**
    - **Arrange**: Set `payload = { fdcId: 0, requestedAt: "2026-05-09T00:00:00Z" }` (invalid fdcId)
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `ValidationError("Invalid fdcId")`; `FetchQueue.insert` and `Postgres.notify` NOT called

- **Unit Scenario: UTS-002-A2**
    - **Arrange**: Set `payload = { fdcId: 12345, requestedAt: "not-a-date" }` (invalid timestamp)
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `ValidationError("Invalid requestedAt timestamp")`; `FetchQueue.insert` and `Postgres.notify` NOT called

- **Unit Scenario: UTS-002-A3**
    - **Arrange**: Set `payload = { fdcId: 12345, requestedAt: "2026-05-09T00:00:00Z" }`; `FetchQueue.insert` mock returns `{ queueRowId: "q-abc" }`
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Returns `{ queueRowId: "q-abc" }`; `FetchQueue.insert` called with a `fetch_queue` row containing `fdcId 12345` (INSERT ON CONFLICT on the dedupe key), then `Postgres.notify` called with `('fetch_queue', <payload containing fdcId 12345>)`

- **Unit Scenario: UTS-002-A4**
    - **Arrange**: Set valid `payload`; `FetchQueue.insert` mock rejects with a connection error
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `EnqueueError("fetch_queue insert failed")`; `Postgres.notify` NOT called

---

#### Test Case: UTP-002-B (publishFoodBatchRequested — batch size boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures (`fdcIds` array length)
**Description**: Verifies `publishFoodBatchRequested()` enforces the 1–100 client batch size constraint (FR-045) at boundaries, and on valid input performs the Postgres-as-queue enqueue (`FetchQueue.insert(...)` + `Postgres.notify('fetch_queue', …)`).

**Dependency & Mock Registry:**

| Dependency   | Source                  | Mock/Stub Strategy                                 | Rationale                       |
| ------------ | ----------------------- | -------------------------------------------------- | ------------------------------- |
| `FetchQueue` | ARCH-003 (Postgres DAO) | Mock: `insert()` returns `{ queueRowId: "q-1" }`   | Prevent real Postgres writes    |
| `Postgres`   | pg client (external)    | Mock: `notify('fetch_queue', …)` records call args | Verify NOTIFY without a real DB |

- **Unit Scenario: UTS-002-B1**
    - **Arrange**: Set `payload.fdcIds = []` (length 0, below min)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Throws `ValidationError("fdcIds must be 1–100 items")`; `FetchQueue.insert` and `Postgres.notify` NOT called

- **Unit Scenario: UTS-002-B2**
    - **Arrange**: Set `payload.fdcIds = [1]` (length 1, min valid); `requestedAt` valid ISO8601
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Returns `{ queueRowId: "q-1" }`; `FetchQueue.insert` called with a `fetch_queue` row covering the batch, then `Postgres.notify('fetch_queue', …)` called

- **Unit Scenario: UTS-002-B3**
    - **Arrange**: Set `payload.fdcIds = Array(100).fill(1).map((_, i) => i + 1)` (length 100, max valid)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Returns `{ queueRowId: "q-1" }`; `FetchQueue.insert` + `Postgres.notify('fetch_queue', …)` called once

- **Unit Scenario: UTS-002-B4**
    - **Arrange**: Set `payload.fdcIds = Array(101).fill(1).map((_, i) => i + 1)` (length 101, max+1)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Throws `ValidationError("fdcIds must be 1–100 items")`; `FetchQueue.insert` and `Postgres.notify` NOT called

---

#### Test Case: UTP-002-C (publishFoodDataReceived — fire-and-forget error handling)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (fire-and-forget branch)
**Description**: Verifies `publishFoodDataReceived()` logs but does NOT throw when `EventBridgeClient.putEvents` returns a failure.

**Dependency & Mock Registry:**

| Dependency          | Source             | Mock/Stub Strategy                                                                   | Rationale                            |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `EventBridgeClient` | AWS SDK (external) | Mock: `putEvents()` returns `{ FailedEntryCount: 1, Entries: [{ ErrorCode: "X" }] }` | Simulate partial failure             |
| `MonitoringLogger`  | ARCH-011           | Mock: `logRequest()` records call args                                               | Verify log call without side-effects |

- **Unit Scenario: UTS-002-C1**
    - **Arrange**: Set `payload = { fdcId: 12345, foodData: { description: "Apple" } }`; `EventBridgeClient.putEvents` mock returns `{ FailedEntryCount: 1, Entries: [{ ErrorCode: "ThrottlingException" }] }`
    - **Act**: Call `publishFoodDataReceived(payload)`
    - **Assert**: Does NOT throw; `MonitoringLogger.logRequest` called with `"eb-publish-fail"` and `{ fdcId: 12345 }`

- **Unit Scenario: UTS-002-C2**
    - **Arrange**: Set valid `payload`; `EventBridgeClient.putEvents` mock returns `{ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] }`
    - **Act**: Call `publishFoodDataReceived(payload)`
    - **Assert**: Does NOT throw; `MonitoringLogger.logRequest` NOT called with `"eb-publish-fail"`

---

### Module: MOD-003 (FetchQueueRouter — Postgres `fetch_queue` enqueue + `LISTEN/NOTIFY`)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `packages/services/food-service/src/queue/fetch-queue-router.ts`

---

#### Test Case: UTP-003-A (dedupeKey — deduplication key generation)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View (`dedupeKey` function)
**Description**: Verifies the `fetch_queue` deduplication key is deterministic within a 5-minute window and changes across window boundaries (so a duplicate enqueue collapses onto the same row via the unique dedupe-key constraint).

**Dependency & Mock Registry:**

None — `dedupeKey` is a pure function (SHA256 hash of fdcId + time-bucketed timestamp).

- **Unit Scenario: UTS-003-A1**
    - **Arrange**: Set `fdcId = 12345`; set `now()` to `T = 1000` (floor(1000/300) = 3)
    - **Act**: Call `dedupeKey(12345)` at time T
    - **Assert**: `dedupeKey` equals `SHA256("FoodRequested:12345:3")`; the row's `group_key` equals `"food-12345"`

- **Unit Scenario: UTS-003-A2**
    - **Arrange**: Set `fdcId = 12345`; set `now()` to `T = 1299` (still floor(1299/300) = 4, same window as T=1200)
    - **Act**: Call `dedupeKey(12345)` at time T and at T+1
    - **Assert**: Both calls return identical `dedupeKey` (same 5-minute bucket → collapses onto one `fetch_queue` row)

- **Unit Scenario: UTS-003-A3**
    - **Arrange**: Set `fdcId = 12345`; call at `T = 1199` (bucket 3) and `T = 1200` (bucket 4)
    - **Act**: Call `dedupeKey(12345)` at both times
    - **Assert**: `dedupeKey` values differ (window boundary crossed)

---

#### Test Case: UTP-003-B (configureRetry — max-attempt values before tombstone)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures (`fetch_queue` retry config)
**Description**: Verifies `configureRetry()` sets the FR-016 `maxAttempts` correctly for high-priority (3) and low-priority (5) rows, after which the row is transitioned to `status='tombstone'`.

**Dependency & Mock Registry:**

None — `configureRetry` is a pure configuration function operating on a `fetch_queue` row config object.

- **Unit Scenario: UTS-003-B1**
    - **Arrange**: Create `rowConfig = {}` stub; set `tombstoneStatus = "tombstone"`; set `maxAttempts = 3`
    - **Act**: Call `configureRetry(rowConfig, "tombstone", 3)`
    - **Assert**: `rowConfig.onExhausted.status` equals `"tombstone"`; `rowConfig.maxAttempts` equals `3`

- **Unit Scenario: UTS-003-B2**
    - **Arrange**: Create `rowConfig = {}` stub; set `maxAttempts = 5`
    - **Act**: Call `configureRetry(rowConfig, "tombstone", 5)`
    - **Assert**: `rowConfig.maxAttempts` equals `5`

---

### Module: MOD-004 (FoodConsumerService — `fetch_queue` Row Processor)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `packages/services/food-service/src/consumer/food-consumer.ts` (Fargate consumer worker — single instance, advisory lock)

---

#### Test Case: UTP-004-A (processRecord — rate limit exhausted branch)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (CheckingRateLimit → ReleasingLease)
**Description**: Verifies `processRecord()` releases/extends the `fetch_queue` row lease (FR-018/FR-021) and returns `{ failed: false }` when the rolling-window limiter is paused (trailing-60-min count at the 90% threshold).

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                                                                                | Rationale                                        |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `RollingWindowLimiter` | ARCH-005 | Mock: `checkAndRecord()` returns `{ allowed: false, paused: true }`; `getWaitTime()` returns `25` | Simulate the window paused at the 90% threshold  |
| `FetchQueueRouter`     | ARCH-003 | Mock: `extendLease()` records args                                                                | Prevent real Postgres `fetch_queue` writes       |
| `UsdaApiClient`        | ARCH-008 | Mock: NOT called (assert)                                                                         | Verify USDA not called when the window is paused |

- **Unit Scenario: UTS-004-A1**
    - **Arrange**: Set `record = { rowId: "row-1", fdcId: 12345, body: '{"fdcId":12345}' }`; `RollingWindowLimiter.checkAndRecord` returns `{ allowed: false, paused: true }` (window at the 90% pause threshold); `RollingWindowLimiter.getWaitTime` returns `25`
    - **Act**: Call `processRecord(record)`
    - **Assert**: Returns `{ failed: false, rowId: "row-1" }`; `FetchQueueRouter.extendLease` called with `("row-1", 30)` (25 + 5; row-lease extension while the worker waits for calls to age out of the window per FR-018/FR-021); `UsdaApiClient.fetchFoods` NOT called (no call recorded against the window)

---

#### Test Case: UTP-004-B (processRecord — USDA error branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (CATCH branches)
**Description**: Verifies `processRecord()` handles USDA 429, 5xx, and 404 errors with correct `fetch_queue` outcomes per FR-016 (≤5 attempts, exponential backoff, then tombstone; 404 → immediate tombstone).

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                                                   | Rationale                          |
| ---------------------- | -------- | -------------------------------------------------------------------- | ---------------------------------- |
| `RollingWindowLimiter` | ARCH-005 | Mock: `checkAndRecord()` returns `{ allowed: true }`                 | Allow rate limit to pass           |
| `UsdaApiClient`        | ARCH-008 | Mock: `fetchFoods()` throws `UsdaApiError` with varying status codes | Simulate USDA error responses      |
| `FetchQueueRouter`     | ARCH-003 | Mock: `extendLease()` / `tombstone()` record args                    | Verify row-lease / tombstone calls |
| `PostgresRepository`   | ARCH-006 | Mock: `updateFetchStatus()` records args                             | Verify DB update on 404            |
| `CacheService`         | ARCH-007 | Mock: `clearPending()` records args                                  | Verify pending cleared on 404      |

- **Unit Scenario: UTS-004-B1**
    - **Arrange**: `UsdaApiClient.fetchFoods` throws `UsdaApiError` with `status = 429`; `record.rowId = "row-1"`
    - **Act**: Call `processRecord(record)`
    - **Assert**: Returns `{ failed: false, rowId: record.rowId }`; `FetchQueueRouter.extendLease` called with `("row-1", 60)` (the consumer treats the rolling window as full and **backs off** — leaving the row `pending` for retry after the backoff gate — rather than resetting the window count; the row is not dropped, FR-026/FR-016/FR-018)

- **Unit Scenario: UTS-004-B2**
    - **Arrange**: `UsdaApiClient.fetchFoods` throws `UsdaApiError` with `status = 503`
    - **Act**: Call `processRecord(record)`
    - **Assert**: Returns `{ failed: true, rowId: record.rowId }`; `FetchQueueRouter.extendLease` NOT called (the lease simply expires, surfacing the row for retry under FR-016)

- **Unit Scenario: UTS-004-B3**
    - **Arrange**: `UsdaApiClient.fetchFoods` throws `UsdaApiError` with `status = 404`; `message.fdcId = 12345`
    - **Act**: Call `processRecord(record)`
    - **Assert**: Returns `{ failed: false, rowId: record.rowId }`; `FetchQueueRouter.tombstone` called with `record.rowId` (404 → immediate tombstone, `status='tombstone'`, FR-016); `PostgresRepository.updateFetchStatus` called with `(12345, "not_found")`; `CacheService.clearPending` called with `12345`

---

#### Test Case: UTP-004-C (processRecord — successful fetch and persist)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (FetchingFromUsda → PersistingResults → PublishingEvent)
**Description**: Verifies `processRecord()` upserts each food, invalidates cache, clears pending, publishes event, and increments metric on successful USDA fetch.

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                                                      | Rationale                                 |
| ---------------------- | -------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `RollingWindowLimiter` | ARCH-005 | Mock: `checkAndRecord()` returns `{ allowed: true }`                    | Allow rate limit to pass                  |
| `UsdaApiClient`        | ARCH-008 | Mock: `fetchFoods()` returns `[{ fdcId: 12345, description: "Apple" }]` | Simulate successful USDA fetch            |
| `PostgresRepository`   | ARCH-006 | Mock: `upsertFood()` returns `{ success: true }`                        | Prevent real DB writes                    |
| `CacheService`         | ARCH-007 | Mock: `invalidate()` and `clearPending()` record args                   | Verify cache operations                   |
| `FetchQueueRouter`     | ARCH-003 | Mock: `complete()` records args                                         | Verify the leased row is completed        |
| `EnqueueEmitter`       | ARCH-002 | Mock: `publishFoodDataReceived()` records args                          | Verify `FoodDataReceived` event published |
| `MonitoringLogger`     | ARCH-011 | Mock: `incrementMetric()` records args                                  | Verify metric emitted                     |

- **Unit Scenario: UTS-004-C1**
    - **Arrange**: `record.body = '{"fdcId":12345}'`; `UsdaApiClient.fetchFoods` returns `[{ fdcId: 12345, description: "Apple" }]`
    - **Act**: Call `processRecord(record)`
    - **Assert**: Returns `{ failed: false, rowId: record.rowId }`; `PostgresRepository.upsertFood` called with `{ fdcId: 12345 }`; `CacheService.invalidate` called with `12345`; `CacheService.clearPending` called with `12345`; `EnqueueEmitter.publishFoodDataReceived` called with `{ fdcId: 12345 }` (EventBridge `FoodDataReceived` only); `FetchQueueRouter.complete` called with `record.rowId` (leased row marked done); `MonitoringLogger.incrementMetric` called with `("consumer.processed", 1)`

---

#### Test Case: UTP-004-D (processBatch — leased-row failure aggregation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`processBatch` loop)
**Description**: Verifies `processBatch()` correctly aggregates failed `fetch_queue` rows from a mixed success/failure lease batch so that only failed rows are left un-completed (their leases expire and they surface again per FR-016).

**Dependency & Mock Registry:**

| Dependency      | Source   | Mock/Stub Strategy                                                                                             | Rationale                |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `processRecord` | Internal | Spy: first call returns `{ failed: false, rowId: "row-1" }`; second returns `{ failed: true, rowId: "row-2" }` | Control per-row outcomes |

- **Unit Scenario: UTS-004-D1**
    - **Arrange**: Set leased batch `rows = [{ rowId: "row-1" }, { rowId: "row-2" }]`; `processRecord` spy returns `{ failed: false }` for row-1 and `{ failed: true }` for row-2
    - **Act**: Call `processBatch(rows)`
    - **Assert**: Returns `{ failedRowIds: ["row-2"] }` (only the failed leased row included)

- **Unit Scenario: UTS-004-D2**
    - **Arrange**: Set leased batch `rows = [{ rowId: "row-1" }]`; `processRecord` spy returns `{ failed: false }`
    - **Act**: Call `processBatch(rows)`
    - **Assert**: Returns `{ failedRowIds: [] }` (empty array, no failures)

---

### Module: MOD-005 (RollingWindowLimiter — Postgres-Backed Atomic Rolling 60-Minute Window; deferred Redis sorted-set variant)

**Parent Architecture Modules**: ARCH-005 [CROSS-CUTTING]
**Target Source File(s)**: `packages/services/food-service/src/rate-limiter/rolling-window-limiter.ts`

---

#### Test Case: UTP-005-A (rolling-window logic — trailing-60-min count, 90% pause, hard cap)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View (atomic count-and-record over the trailing 60 minutes)
**Description**: Verifies the rolling-window count-and-record at its boundaries (FR-019, FR-020, FR-021): the limiter counts USDA calls in the trailing 60 minutes from the `usda_call_log`, admits-and-records below the `PAUSE_THRESHOLD` (900), pauses at the 90% (`PAUSE_THRESHOLD` = 900) threshold, and blocks the 1,001st call in any trailing-60-min window (the `HARD_CAP` of 1000 is never breached). By default this is an atomic Postgres count+insert on the `usda_call_log` (`INSERT ... WHERE (SELECT count(...)) < HARD_CAP RETURNING`); the deferred Redis variant runs the same logic as a sorted-set Lua script (`ZADD` timestamp / `ZCOUNT` last 60 min). The store is mocked to execute the count-and-record logic in-process.

**Dependency & Mock Registry:**

| Dependency     | Source                                                                | Mock/Stub Strategy                                                                                                                              | Rationale                                 |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `CallLogStore` | Postgres `usda_call_log` (default; deferred Redis sorted-set variant) | Mock: executes the atomic count-and-record in-process (`INSERT ... WHERE count < HARD_CAP RETURNING`, or the deferred Lua `eval` over `ZCOUNT`) | Isolate from real call-log infrastructure |

- **Unit Scenario: UTS-005-A1**
    - **Arrange**: Set `HARD_CAP = 1000`, `PAUSE_THRESHOLD = 900`; mock `CallLogStore` so the trailing-60-min count is `0` (window empty)
    - **Act**: Execute the atomic count-and-record via mock `CallLogStore`
    - **Assert**: Returns `{ allowed: true, windowCount: 1 }` (recorded the new call's timestamp); a new row/member is appended to the window (boundary: empty window admits)

- **Unit Scenario: UTS-005-A2**
    - **Arrange**: Set `HARD_CAP = 1000`, `PAUSE_THRESHOLD = 900`; mock `CallLogStore` so the trailing-60-min count is `899` (max-1, under the pause threshold)
    - **Act**: Execute the count-and-record
    - **Assert**: Returns `{ allowed: true, windowCount: 900 }`; the call is recorded (boundary: count below 900 still admits)

- **Unit Scenario: UTS-005-A3**
    - **Arrange**: Set `PAUSE_THRESHOLD = 900`; mock `CallLogStore` so the trailing-60-min count is `900` (at the 90% pause threshold)
    - **Act**: Execute the count-and-record
    - **Assert**: Returns `{ allowed: false, paused: true, windowCount: 900 }`; **no** new timestamp recorded — the worker pauses draining at 90% rather than advancing (boundary: count == 900 → pause, FR-019)

- **Unit Scenario: UTS-005-A4**
    - **Arrange**: Set `HARD_CAP = 1000`; mock `CallLogStore` so the trailing-60-min count is `1000` (the call would be the 1,001st in the window)
    - **Act**: Execute the count-and-record
    - **Assert**: Returns `{ allowed: false, windowCount: 1000 }`; the call is **not** recorded and **not** made — the 1,001st call in any trailing-60-min window is blocked, so the `HARD_CAP` of ≤1,000 is never breached (boundary: at-cap rejects, FR-019/SC-002)

---

#### Test Case: UTP-005-B (count-and-record — call-log-store unavailability error propagation)

**Technique**: Statement & Branch Coverage
**Target View**: Error Handling Return Codes
**Description**: Verifies the count-and-record operation throws `RateLimiterError` when the call-log store (Postgres `usda_call_log` by default; deferred Redis sorted-set variant) is unavailable or times out — the limiter fails closed (no USDA call proceeds) rather than assuming the window is empty.

**Dependency & Mock Registry:**

| Dependency     | Source                                                                | Mock/Stub Strategy                                     | Rationale                              |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `CallLogStore` | Postgres `usda_call_log` (default; deferred Redis sorted-set variant) | Mock: count-and-record throws `ConnectionRefusedError` | Simulate call-log-store unavailability |

- **Unit Scenario: UTS-005-B1**
    - **Arrange**: `CallLogStore` count-and-record mock throws `ConnectionRefusedError`
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Throws `RateLimiterError`; error message contains "unavailable" or "connection"

- **Unit Scenario: UTS-005-B2**
    - **Arrange**: `CallLogStore` count-and-record mock throws `TimeoutError` after 100ms
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Throws `RateLimiterError`

---

#### Test Case: UTP-005-C (state transitions — WindowOpen ↔ WindowFull as calls age out)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies the state machine transitions between `WindowOpen` and `WindowFull` as the trailing-60-min count rises to the 90% pause threshold and then drops back as earlier calls age out of the trailing window (FR-019/FR-021). The call-log store is mocked to return controlled trailing counts.

**Dependency & Mock Registry:**

| Dependency     | Source                                                                | Mock/Stub Strategy                                                           | Rationale                               |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| `CallLogStore` | Postgres `usda_call_log` (default; deferred Redis sorted-set variant) | Mock: count-and-record returns controlled `{ allowed, windowCount }` results | Drive state machine through transitions |

- **Unit Scenario: UTS-005-C1**
    - **Arrange**: `CallLogStore` returns a trailing-60-min count of `500` (well under the pause threshold)
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Returns `{ allowed: true, windowCount: 501 }` (state: WindowOpen)

- **Unit Scenario: UTS-005-C2**
    - **Arrange**: `CallLogStore` returns a trailing-60-min count of `899`, and the recorded call brings the trailing count to `900`
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Returns `{ allowed: true, windowCount: 900 }` (transition: WindowOpen → WindowFull at the 90% pause threshold)

- **Unit Scenario: UTS-005-C3**
    - **Arrange**: `CallLogStore` returns a trailing-60-min count of `900` (at the pause threshold)
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Returns `{ allowed: false, paused: true, windowCount: 900 }` (state: WindowFull — the worker pauses)

- **Unit Scenario: UTS-005-C4**
    - **Arrange**: After the window was full, enough earlier calls age out of the trailing 60 minutes that `CallLogStore` now returns a trailing-60-min count of `850`
    - **Act**: Call `checkAndRecord()`
    - **Assert**: Returns `{ allowed: true, windowCount: 851 }` (transition: WindowFull → WindowOpen — calls aged out of the window, the worker resumes draining, FR-021)

---

### Module: MOD-006 (FoodPostgresRepository — Database Access Layer)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `packages/services/food-service/src/repository/food-postgres-repository.ts`

---

#### Test Case: UTP-006-A (findByFdcId — row mapping and null return)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `findByFdcId()` returns `null` when no rows found and correctly maps a row to `FoodData` when found.

**Dependency & Mock Registry:**

| Dependency | Source  | Mock/Stub Strategy                                              | Rationale                   |
| ---------- | ------- | --------------------------------------------------------------- | --------------------------- |
| `pool`     | pg Pool | Mock: `query()` returns `{ rows: [] }` or `{ rows: [rowStub] }` | Prevent real DB connections |

- **Unit Scenario: UTS-006-A1**
    - **Arrange**: `pool.query` mock returns `{ rows: [] }` for `fdcId = 12345`
    - **Act**: Call `findByFdcId(12345)`
    - **Assert**: Returns `null`; `pool.query` called with SQL containing `$1` and params `[12345]`

- **Unit Scenario: UTS-006-A2**
    - **Arrange**: `pool.query` mock returns `{ rows: [{ fdc_id: 12345, description: "Apple", brand_owner: null, nutrients: '{"protein":{"amount":0.3,"unit":"g"}}', fetch_status: "fetched", fetched_at: new Date() }] }`
    - **Act**: Call `findByFdcId(12345)`
    - **Assert**: Returns `FoodData` object with `fdcId = 12345`, `description = "Apple"`, `fetchStatus = "fetched"`, `nutrients.protein.amount = 0.3`

---

#### Test Case: UTP-006-B (upsertFood — SQL construction and conflict handling)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `upsertFood()` executes the correct `INSERT ... ON CONFLICT DO UPDATE` SQL and returns `{ success: true }`.

**Dependency & Mock Registry:**

| Dependency | Source  | Mock/Stub Strategy                        | Rationale              |
| ---------- | ------- | ----------------------------------------- | ---------------------- |
| `pool`     | pg Pool | Mock: `query()` returns `{ rowCount: 1 }` | Prevent real DB writes |

- **Unit Scenario: UTS-006-B1**
    - **Arrange**: Set `food = { fdcId: 12345, description: "Apple", brandOwner: "Brand A", nutrients: { protein: { amount: 0.3, unit: "g" } }, fetchStatus: "fetched" }`
    - **Act**: Call `upsertFood(food)`
    - **Assert**: Returns `{ success: true }`; `pool.query` called with SQL containing `ON CONFLICT (fdc_id) DO UPDATE`; params include `12345`, `"Apple"`, `"Brand A"`, JSON-stringified nutrients

---

#### Test Case: UTP-006-C (updateFetchStatus — valid and invalid status values)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures (`FetchStatus` enum)
**Description**: Verifies `updateFetchStatus()` throws `ValidationError` for invalid status values and executes the UPDATE query for valid ones.

**Dependency & Mock Registry:**

| Dependency | Source  | Mock/Stub Strategy                        | Rationale              |
| ---------- | ------- | ----------------------------------------- | ---------------------- |
| `pool`     | pg Pool | Mock: `query()` returns `{ rowCount: 1 }` | Prevent real DB writes |

- **Unit Scenario: UTS-006-C1**
    - **Arrange**: Set `fdcId = 12345`, `status = "invalid_status"`
    - **Act**: Call `updateFetchStatus(12345, "invalid_status")`
    - **Assert**: Throws `ValidationError`; `pool.query` NOT called

- **Unit Scenario: UTS-006-C2**
    - **Arrange**: Set `fdcId = 12345`, `status = "not_found"` (valid enum value)
    - **Act**: Call `updateFetchStatus(12345, "not_found")`
    - **Assert**: `pool.query` called with UPDATE SQL and params `[12345, "not_found"]`; returns without throwing

- **Unit Scenario: UTS-006-C3**
    - **Arrange**: Set `fdcId = 12345`, `status = "pending"` (valid enum value)
    - **Act**: Call `updateFetchStatus(12345, "pending")`
    - **Assert**: `pool.query` called; returns without throwing

---

#### Test Case: UTP-006-D (findByFdcId — JSON parse error on nutrients column)

**Technique**: Statement & Branch Coverage
**Target View**: Error Handling Return Codes
**Description**: Verifies `findByFdcId()` logs a `DataIntegrityError` and returns `null` when the `nutrients` JSONB column contains malformed JSON.

**Dependency & Mock Registry:**

| Dependency         | Source   | Mock/Stub Strategy                                                                  | Rationale                |
| ------------------ | -------- | ----------------------------------------------------------------------------------- | ------------------------ |
| `pool`             | pg Pool  | Mock: `query()` returns `{ rows: [{ fdc_id: 12345, nutrients: "INVALID_JSON{" }] }` | Simulate corrupt DB data |
| `MonitoringLogger` | ARCH-011 | Mock: `logError()` records args                                                     | Verify error is logged   |

- **Unit Scenario: UTS-006-D1**
    - **Arrange**: `pool.query` returns row with `nutrients = "INVALID_JSON{"` (unparseable)
    - **Act**: Call `findByFdcId(12345)`
    - **Assert**: Returns `null`; `MonitoringLogger.logError` called with error containing "DataIntegrityError" or "JSON parse"

---

### Module: MOD-007 (FoodCacheService — Cache & Pending-Set Manager; in-process LRU / Postgres default, deferred Redis variant)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `packages/services/food-service/src/cache/food-cache.service.ts`

---

#### Test Case: UTP-007-A (get — cache hit, miss, and JSON parse error)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `get()` returns parsed `FoodData` on hit, `null` on miss, and `null` (with log) on JSON parse error.

**Dependency & Mock Registry:**

| Dependency         | Source                                                      | Mock/Stub Strategy                                             | Rationale                      |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| `CacheStore`       | in-process LRU / Postgres (default; deferred Redis variant) | Mock: `get()` returns `null`, JSON string, or malformed string | Prevent real cache-store calls |
| `MonitoringLogger` | ARCH-011                                                    | Mock: `logError()` records args                                | Verify error logging           |

- **Unit Scenario: UTS-007-A1**
    - **Arrange**: `CacheStore.get` mock returns `null` for key `"food:12345"`
    - **Act**: Call `get(12345)`
    - **Assert**: Returns `null`

- **Unit Scenario: UTS-007-A2**
    - **Arrange**: `CacheStore.get` mock returns `'{"fdcId":12345,"description":"Apple"}'`
    - **Act**: Call `get(12345)`
    - **Assert**: Returns `{ fdcId: 12345, description: "Apple" }`

- **Unit Scenario: UTS-007-A3**
    - **Arrange**: `CacheStore.get` mock returns `"INVALID_JSON{"`
    - **Act**: Call `get(12345)`
    - **Assert**: Returns `null`; `MonitoringLogger.logError` called

---

#### Test Case: UTP-007-B (set — key schema and TTL)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `set()` calls the cache store with the correct key (`"food:{fdcId}"`), JSON-serialized value, and TTL.

**Dependency & Mock Registry:**

| Dependency   | Source                                                      | Mock/Stub Strategy                   | Rationale               |
| ------------ | ----------------------------------------------------------- | ------------------------------------ | ----------------------- |
| `CacheStore` | in-process LRU / Postgres (default; deferred Redis variant) | Mock: `set()` records call arguments | Verify key/TTL contract |

- **Unit Scenario: UTS-007-B1**
    - **Arrange**: Set `fdcId = 12345`, `data = { fdcId: 12345, description: "Apple" }`, `ttl = 3600`
    - **Act**: Call `set(12345, data, 3600)`
    - **Assert**: `CacheStore.set` called with `("food:12345", '{"fdcId":12345,"description":"Apple"}', { ttlSeconds: 3600 })` (the deferred Redis variant maps this to `SET ... EX 3600`)

---

#### Test Case: UTP-007-C (isPending / markPending / clearPending — pending set operations)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies the pending-set operations use the correct store commands and key schemas. By default the pending set is the Postgres `pending_fetch` set (membership row + TTL column); the deferred Redis variant maps these to `SISMEMBER`/`SADD`/`SREM`.

**Dependency & Mock Registry:**

| Dependency        | Source                                                     | Mock/Stub Strategy                                                        | Rationale                        |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| `PendingSetStore` | Postgres `pending_fetch` (default; deferred Redis variant) | Mock: `isMember()` returns false/true; `add()` and `remove()` record args | Verify pending-set command usage |

- **Unit Scenario: UTS-007-C1**
    - **Arrange**: `PendingSetStore.isMember` mock returns `true` for `("pending_fetch", "12345")`
    - **Act**: Call `isPending(12345)`
    - **Assert**: Returns `true`

- **Unit Scenario: UTS-007-C2**
    - **Arrange**: `PendingSetStore.isMember` mock returns `false`
    - **Act**: Call `isPending(12345)`
    - **Assert**: Returns `false`

- **Unit Scenario: UTS-007-C3**
    - **Arrange**: `PendingSetStore.add` mock records args
    - **Act**: Call `markPending(12345)`
    - **Assert**: `PendingSetStore.add` called with `("pending_fetch", "12345", { ttlSeconds: 300 })` (Postgres membership row + TTL; the deferred Redis variant maps this to `SADD` + `SET pending_ttl:12345 "1" EX 300`)

- **Unit Scenario: UTS-007-C4**
    - **Arrange**: `PendingSetStore.remove` mock records args
    - **Act**: Call `clearPending(12345)`
    - **Assert**: `PendingSetStore.remove` called with `("pending_fetch", "12345")` (the deferred Redis variant maps this to `SREM` + `DEL pending_ttl:12345`)

---

### Module: MOD-008 (UsdaApiClient — HTTP Client for USDA FoodData Central)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `packages/clients/usda/src/usda-api.client.ts` (`@kitchensink/usda-client`)

---

#### Test Case: UTP-008-A (fetchFoods — batch size boundary validation)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures (`fdcIds` array, `MAX_BATCH_SIZE = 20`)
**Description**: Verifies `fetchFoods()` throws `ValidationError` for empty array and arrays exceeding 20 items, and proceeds for valid sizes.

**Dependency & Mock Registry:**

| Dependency      | Source     | Mock/Stub Strategy                               | Rationale                    |
| --------------- | ---------- | ------------------------------------------------ | ---------------------------- |
| `HTTP.POST`     | node-fetch | Mock: returns `{ status: 200, body: '[]' }`      | Prevent real HTTP calls      |
| `SecretManager` | ARCH-010   | Mock: `getUsdaApiKey()` returns `"test-api-key"` | Prevent Secrets Manager call |

- **Unit Scenario: UTS-008-A1**
    - **Arrange**: Set `fdcIds = []` (length 0)
    - **Act**: Call `fetchFoods([])`
    - **Assert**: Returns `[]` immediately; `HTTP.POST` NOT called

- **Unit Scenario: UTS-008-A2**
    - **Arrange**: Set `fdcIds = [1]` (length 1, min valid); `HTTP.POST` mock returns `{ status: 200, body: '[{"fdcId":1,"description":"Apple","foodNutrients":[]}]' }`
    - **Act**: Call `fetchFoods([1])`
    - **Assert**: Returns array with 1 `FoodData` item; `HTTP.POST` called with URL containing `/foods`

- **Unit Scenario: UTS-008-A3**
    - **Arrange**: Set `fdcIds = Array(20).fill(0).map((_, i) => i + 1)` (length 20, max valid)
    - **Act**: Call `fetchFoods(fdcIds)`
    - **Assert**: `HTTP.POST` called once; does NOT throw

- **Unit Scenario: UTS-008-A4**
    - **Arrange**: Set `fdcIds = Array(21).fill(0).map((_, i) => i + 1)` (length 21, max+1)
    - **Act**: Call `fetchFoods(fdcIds)`
    - **Assert**: Throws `ValidationError("Batch size exceeds maximum of 20")`; `HTTP.POST` NOT called

---

#### Test Case: UTP-008-B (fetchFoods — HTTP status code branches)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies `fetchFoods()` throws the correct `UsdaApiError` for each HTTP error status class.

**Dependency & Mock Registry:**

| Dependency      | Source     | Mock/Stub Strategy                               | Rationale                    |
| --------------- | ---------- | ------------------------------------------------ | ---------------------------- |
| `HTTP.POST`     | node-fetch | Mock: returns varying `{ status }` values        | Simulate USDA HTTP responses |
| `SecretManager` | ARCH-010   | Mock: `getUsdaApiKey()` returns `"test-api-key"` | Prevent Secrets Manager call |

- **Unit Scenario: UTS-008-B1**
    - **Arrange**: `HTTP.POST` mock returns `{ status: 401 }`
    - **Act**: Call `fetchFoods([12345])`
    - **Assert**: Throws `UsdaApiError` with `status = 401` and message containing "Invalid API key"

- **Unit Scenario: UTS-008-B2**
    - **Arrange**: `HTTP.POST` mock returns `{ status: 429 }`
    - **Act**: Call `fetchFoods([12345])`
    - **Assert**: Throws `UsdaApiError` with `status = 429` and message containing "rate limit"

- **Unit Scenario: UTS-008-B3**
    - **Arrange**: `HTTP.POST` mock returns `{ status: 500 }`
    - **Act**: Call `fetchFoods([12345])`
    - **Assert**: Throws `UsdaApiError` with `status = 500` and message containing "server error"

- **Unit Scenario: UTS-008-B4**
    - **Arrange**: `HTTP.POST` mock returns `{ status: 404 }`
    - **Act**: Call `fetchFoods([12345])`
    - **Assert**: Throws `UsdaApiError` with `status = 404`

---

#### Test Case: UTP-008-C (mapUsdaResponseToFoodData — nutrient extraction)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`mapUsdaResponseToFoodData` + `extractNutrients`)
**Description**: Verifies `mapUsdaResponseToFoodData()` correctly maps USDA response fields and `extractNutrients()` filters to the 6 target nutrient IDs.

**Dependency & Mock Registry:**

None — `mapUsdaResponseToFoodData` and `extractNutrients` are pure functions.

- **Unit Scenario: UTS-008-C1**
    - **Arrange**: Set `usdaItem = { fdcId: 12345, description: "Apple", brandOwner: "Brand A", foodNutrients: [{ nutrientId: 203, amount: 0.3, unitName: "g" }, { nutrientId: 999, amount: 100, unitName: "mg" }] }`
    - **Act**: Call `mapUsdaResponseToFoodData(usdaItem)`
    - **Assert**: Returns `FoodData` with `fdcId = 12345`, `description = "Apple"`, `brandOwner = "Brand A"`, `fetchStatus = "fetched"`; `nutrients` contains nutrientId 203 but NOT 999 (filtered out)

- **Unit Scenario: UTS-008-C2**
    - **Arrange**: Set `usdaItem` with `brandOwner = undefined`
    - **Act**: Call `mapUsdaResponseToFoodData(usdaItem)`
    - **Assert**: Returns `FoodData` with `brandOwner = null`

---

### Module: MOD-009 (WebSocketNotifier — Real-Time Client Notification)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `packages/services/food-service/src/websocket/websocket-notifier.ts`

---

#### Test Case: UTP-009-A (notifyClients — GoneException cleanup and fire-and-forget)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (Connected → Disconnected via GoneException)
**Description**: Verifies `notifyClients()` deletes stale connections on `GoneException`, logs but continues on other errors, and returns the correct `notifiedCount`.

**Dependency & Mock Registry:**

| Dependency                   | Source   | Mock/Stub Strategy                                                                             | Rationale                   |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| `ConnectionStore`            | DynamoDB | Mock: `getConnectionsForFdcId()` returns connection ID list; `deleteConnection()` records args | Prevent real DynamoDB calls |
| `ApiGatewayManagementClient` | AWS SDK  | Mock: `postToConnection()` succeeds, throws `GoneException`, or throws generic `Error`         | Simulate WebSocket states   |
| `MonitoringLogger`           | ARCH-011 | Mock: `logRequest()` records args                                                              | Verify error logging        |

- **Unit Scenario: UTS-009-A1**
    - **Arrange**: `ConnectionStore.getConnectionsForFdcId` returns `["conn-1", "conn-2"]`; `ApiGatewayManagementClient.postToConnection` succeeds for both
    - **Act**: Call `notifyClients(12345, foodDataStub)`
    - **Assert**: Returns `2`; `ConnectionStore.deleteConnection` NOT called

- **Unit Scenario: UTS-009-A2**
    - **Arrange**: `ConnectionStore.getConnectionsForFdcId` returns `["conn-1"]`; `ApiGatewayManagementClient.postToConnection` throws `GoneException`
    - **Act**: Call `notifyClients(12345, foodDataStub)`
    - **Assert**: Returns `0`; `ConnectionStore.deleteConnection` called with `"conn-1"`; `MonitoringLogger.logRequest` NOT called with `"ws-notify-fail"`

- **Unit Scenario: UTS-009-A3**
    - **Arrange**: `ConnectionStore.getConnectionsForFdcId` returns `["conn-1"]`; `ApiGatewayManagementClient.postToConnection` throws generic `Error("network error")`
    - **Act**: Call `notifyClients(12345, foodDataStub)`
    - **Assert**: Returns `0`; `ConnectionStore.deleteConnection` NOT called; `MonitoringLogger.logRequest` called with `"ws-notify-fail"` and `{ connectionId: "conn-1", fdcId: 12345 }`

- **Unit Scenario: UTS-009-A4**
    - **Arrange**: `ConnectionStore.getConnectionsForFdcId` returns `[]` (no subscribers)
    - **Act**: Call `notifyClients(12345, foodDataStub)`
    - **Assert**: Returns `0`; `ApiGatewayManagementClient.postToConnection` NOT called

---

#### Test Case: UTP-009-B (onConnect / onDisconnect — connection store operations)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `onConnect()` stores connection with TTL and `onDisconnect()` deletes it.

**Dependency & Mock Registry:**

| Dependency        | Source   | Mock/Stub Strategy                                           | Rationale                   |
| ----------------- | -------- | ------------------------------------------------------------ | --------------------------- |
| `ConnectionStore` | DynamoDB | Mock: `putConnection()` and `deleteConnection()` record args | Prevent real DynamoDB calls |

- **Unit Scenario: UTS-009-B1**
    - **Arrange**: Set `connectionId = "conn-1"`, `fdcId = 12345`; `now()` returns `1000`
    - **Act**: Call `onConnect("conn-1", 12345)`
    - **Assert**: `ConnectionStore.putConnection` called with `{ connectionId: "conn-1", fdcId: 12345, ttl: 4600 }` (1000 + 3600)

- **Unit Scenario: UTS-009-B2**
    - **Arrange**: Set `connectionId = "conn-1"`
    - **Act**: Call `onDisconnect("conn-1")`
    - **Assert**: `ConnectionStore.deleteConnection` called with `"conn-1"`

---

### Module: MOD-010 (SecretManager — AWS Secrets Manager Wrapper)

**Parent Architecture Modules**: ARCH-010 [CROSS-CUTTING]
**Target Source File(s)**: `packages/services/food-service/src/secrets/secret-manager.ts`

---

#### Test Case: UTP-010-A (getUsdaApiKey — in-memory cache hit and miss)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (CacheEmpty → CachePopulated → CacheExpired)
**Description**: Verifies `getUsdaApiKey()` returns cached value on HIT without calling Secrets Manager, and fetches + caches on MISS.

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                                                          | Rationale                          |
| ---------------------- | -------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `SecretsManagerClient` | AWS SDK  | Mock: `getSecretValue()` returns `{ SecretString: '{"apiKey":"key-123"}' }` | Prevent real Secrets Manager calls |
| `SECRET_CACHE`         | Internal | Direct manipulation: set/clear cache entries before each scenario           | Control cache state                |

- **Unit Scenario: UTS-010-A1**
    - **Arrange**: Set `SECRET_CACHE[secretName] = { value: "cached-key", expiresAt: now() + 60000 }` (cache HIT, not expired)
    - **Act**: Call `getUsdaApiKey()`
    - **Assert**: Returns `"cached-key"`; `SecretsManagerClient.getSecretValue` NOT called

- **Unit Scenario: UTS-010-A2**
    - **Arrange**: Set `SECRET_CACHE = {}` (cache MISS); `SecretsManagerClient.getSecretValue` mock returns `{ SecretString: '{"apiKey":"key-123"}' }`
    - **Act**: Call `getUsdaApiKey()`
    - **Assert**: Returns `"key-123"`; `SecretsManagerClient.getSecretValue` called once; `SECRET_CACHE[secretName].value` equals `"key-123"`; `SECRET_CACHE[secretName].expiresAt` approximately `now() + 300000`

- **Unit Scenario: UTS-010-A3**
    - **Arrange**: Set `SECRET_CACHE[secretName] = { value: "old-key", expiresAt: now() - 1 }` (cache EXPIRED); `SecretsManagerClient.getSecretValue` mock returns `{ SecretString: '{"apiKey":"new-key"}' }`
    - **Act**: Call `getUsdaApiKey()`
    - **Assert**: Returns `"new-key"`; `SecretsManagerClient.getSecretValue` called once (cache miss on expiry)

---

#### Test Case: UTP-010-B (rotateKey — cache invalidation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `rotateKey()` calls `SecretsManagerClient.rotateSecret` and deletes the in-memory cache entry.

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                            | Rationale                  |
| ---------------------- | -------- | --------------------------------------------- | -------------------------- |
| `SecretsManagerClient` | AWS SDK  | Mock: `rotateSecret()` returns `{}`           | Prevent real rotation call |
| `SECRET_CACHE`         | Internal | Direct manipulation: pre-populate cache entry | Verify cache is cleared    |

- **Unit Scenario: UTS-010-B1**
    - **Arrange**: Set `SECRET_CACHE[secretName] = { value: "old-key", expiresAt: now() + 60000 }`; `SecretsManagerClient.rotateSecret` mock records args
    - **Act**: Call `rotateKey()`
    - **Assert**: Returns `{ success: true }`; `SecretsManagerClient.rotateSecret` called with `{ SecretId: secretName }`; `SECRET_CACHE[secretName]` is `undefined`

---

#### Test Case: UTP-010-C (getUsdaApiKey — Secrets Manager error propagation)

**Technique**: Statement & Branch Coverage
**Target View**: Error Handling Return Codes
**Description**: Verifies `getUsdaApiKey()` propagates `SecretNotFoundError` and `SecretAccessError` from Secrets Manager.

**Dependency & Mock Registry:**

| Dependency             | Source  | Mock/Stub Strategy                                                                     | Rationale                  |
| ---------------------- | ------- | -------------------------------------------------------------------------------------- | -------------------------- |
| `SecretsManagerClient` | AWS SDK | Mock: `getSecretValue()` throws `ResourceNotFoundException` or `AccessDeniedException` | Simulate IAM/config errors |

- **Unit Scenario: UTS-010-C1**
    - **Arrange**: `SECRET_CACHE = {}`; `SecretsManagerClient.getSecretValue` throws `ResourceNotFoundException`
    - **Act**: Call `getUsdaApiKey()`
    - **Assert**: Throws `SecretNotFoundError`

- **Unit Scenario: UTS-010-C2**
    - **Arrange**: `SECRET_CACHE = {}`; `SecretsManagerClient.getSecretValue` throws `AccessDeniedException`
    - **Act**: Call `getUsdaApiKey()`
    - **Assert**: Throws `SecretAccessError`

---

### Module: MOD-011 (MonitoringLogger — Structured Logging & Metrics)

**Parent Architecture Modules**: ARCH-011 [CROSS-CUTTING]
**Target Source File(s)**: `packages/services/food-service/src/monitoring/monitoring-logger.ts`

---

#### Test Case: UTP-011-A (logRequest — structured log payload shape)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `logRequest()` calls the underlying `logger.info` with the correct structured payload including all required fields.

**Dependency & Mock Registry:**

| Dependency | Source                        | Mock/Stub Strategy                    | Rationale                          |
| ---------- | ----------------------------- | ------------------------------------- | ---------------------------------- |
| `logger`   | @aws-lambda-powertools/logger | Mock: `info()` records call arguments | Prevent real CloudWatch log writes |

- **Unit Scenario: UTS-011-A1**
    - **Arrange**: Set `requestId = "req-1"`, `event = { fdcId: 12345 }`, `durationMs = 42`; mock `ISO8601Now()` returns `"2026-05-09T00:00:00Z"`
    - **Act**: Call `logRequest("req-1", { fdcId: 12345 }, 42)`
    - **Assert**: `logger.info` called with `"request"` and object containing `{ requestId: "req-1", event: { fdcId: 12345 }, durationMs: 42, timestamp: "2026-05-09T00:00:00Z" }`

---

#### Test Case: UTP-011-B (logError — error fields extraction)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `logError()` extracts `name`, `message`, and `stack` from the `Error` object and includes them in the structured log.

**Dependency & Mock Registry:**

| Dependency | Source                        | Mock/Stub Strategy                     | Rationale                          |
| ---------- | ----------------------------- | -------------------------------------- | ---------------------------------- |
| `logger`   | @aws-lambda-powertools/logger | Mock: `error()` records call arguments | Prevent real CloudWatch log writes |

- **Unit Scenario: UTS-011-B1**
    - **Arrange**: Set `error = new Error("Something failed")`; `error.name = "ValidationError"`; `requestId = "req-1"`; `context = { fdcId: 12345 }`
    - **Act**: Call `logError("req-1", error, { fdcId: 12345 })`
    - **Assert**: `logger.error` called with `"error"` and object containing `{ requestId: "req-1", errorName: "ValidationError", errorMessage: "Something failed", stackTrace: error.stack, context: { fdcId: 12345 } }`

---

#### Test Case: UTP-011-C (incrementMetric — EMF payload structure)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (EMF metric format)
**Description**: Verifies `incrementMetric()` emits a CloudWatch EMF-compliant payload with the correct namespace, dimension, and metric name.

**Dependency & Mock Registry:**

| Dependency | Source                        | Mock/Stub Strategy                    | Rationale                          |
| ---------- | ----------------------------- | ------------------------------------- | ---------------------------------- |
| `logger`   | @aws-lambda-powertools/logger | Mock: `info()` records call arguments | Prevent real CloudWatch log writes |

- **Unit Scenario: UTS-011-C1**
    - **Arrange**: Set `name = "cache.hit"`, `value = 1`; mock `unixTimestampMs()` returns `1715212800000`
    - **Act**: Call `incrementMetric("cache.hit", 1)`
    - **Assert**: `logger.info` called with `"metric"` and object where `_aws.CloudWatchMetrics[0].Namespace = "UsdaFoodData"`, `_aws.CloudWatchMetrics[0].Metrics[0].Name = "cache.hit"`, `_aws.CloudWatchMetrics[0].Metrics[0].Unit = "Count"`, `["cache.hit"] = 1`, `service = "food-service"`

---

### Module: MOD-012 (ClerkAuthMiddleware — Networkless Clerk Verification & Scope Gate) + MOD-013 (DemotionAndFairness — Per-`sub` Pending-Count Demotion, Batch Cap & Distinct-Requester Demand)

**Parent Architecture Modules**: ARCH-012 (FoodAuthGuard)
**Requirements Under Test**: REQ-037a–d, REQ-038a–c, REQ-039, REQ-040a–b, REQ-041, REQ-042, REQ-043, REQ-044
**Target Source File(s)**: `packages/services/food-service/src/auth/clerk-auth.middleware.ts` (MOD-012, uses shared `@kitchensink/clerk-verify`), `packages/services/food-service/src/auth/demotion-and-fairness.service.ts` (MOD-013)

> The auth slice fronts every food-data entry point. MOD-012 verifies the Clerk session/M2M token networklessly (signature/`exp`/`nbf`/`azp` via the public `CLERK_JWT_KEY`), fails closed to `401`, derives the `AuthenticatedCaller` solely from the verified `sub`, and gates operational scopes (`403`) from `public_metadata`. MOD-013 enforces **fairness by demotion, not rejection** (FR-043, revised 2026-06-20): there is **no per-user quota and no `429`** — instead, when a single `sub` has **more than 50 items currently pending** in the `fetch_queue` (counted live from `fetch_queue` + `fetch_requesters`), that requester's queued items are ranked to the **back** of the priority order, with dynamic re-promotion once the pending count falls back below 50. It also enforces the batch-size cap (`400`) and distinct-requester demand counting before any fetch is enqueued; no authenticated cache-miss request is ever rejected for a personal limit (work-conserving). Unit scenarios isolate `@clerk/backend` `verifyToken` and all I/O behind mocks; only the module's internal control flow, boundaries, and state are exercised.

---

#### Test Case: UTP-012-A (verify — valid token → AuthenticatedCaller principal)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + Architecture Interface View
**Description**: Verifies that on a syntactically valid Clerk token with a matching `azp`, MOD-012 returns the verified claims and builds an `AuthenticatedCaller` whose `sub`/`azp`/scopes are sourced **only** from the `verifyToken` result — covering the success branch of the verification control flow (REQ-037a–d). `verifyToken` is mocked; no network call is made.

**Dependency & Mock Registry:**

| Dependency         | Source         | Mock/Stub Strategy                                                                                    | Rationale                                           |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `verifyToken`      | @clerk/backend | Mock: resolves `{ sub: 'user_abc', azp: 'https://app.commise.app', public_metadata: { scopes: [] } }` | Networkless verification; no IdP round trip in unit |
| `MonitoringLogger` | ARCH-011       | Stub: no-op                                                                                           | Prevent CloudWatch side-effects                     |

- **Unit Scenario: UTS-012-A1**
    - **Arrange**: Set `Authorization = 'Bearer good.jwt.token'`; configure `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to resolve `{ sub: 'user_abc', azp: 'https://app.commise.app', public_metadata: { scopes: [] } }`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: `verifyToken` called exactly once with `{ jwtKey: <CLERK_JWT_KEY>, authorizedParties: ['https://app.commise.app'] }` (networkless — no `secretKey`, no fetch); `req.caller` equals `{ sub: 'user_abc', azp: 'https://app.commise.app', scopes: [], isService: false }`; `next()` called with no error

- **Unit Scenario: UTS-012-A2**
    - **Arrange**: As A1 but `verifyToken` resolves with `public_metadata: { scopes: ['foods:refetch'] }`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: `req.caller.scopes` deep-equals `['foods:refetch']` — scopes are read solely from the verified token's `public_metadata`, not from any request field

---

#### Test Case: UTP-012-B (verify — no / malformed / invalid / expired / wrong-`azp` token → 401, fail closed)

**Technique**: Error Guessing + Statement & Branch Coverage + Strict Isolation
**Target View**: Error Handling & Return Codes + Algorithmic/Logic View
**Description**: Verifies every fail-closed branch yields `401` networklessly and never produces an `AuthenticatedCaller` or calls downstream logic (REQ-037a–d, REQ-044a–d). Each rejection path is driven by mocking `verifyToken` to throw, or by omitting the header — no real signature math, no IdP call.

**Dependency & Mock Registry:**

| Dependency    | Source         | Mock/Stub Strategy                                 | Rationale                                             |
| ------------- | -------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `verifyToken` | @clerk/backend | Mock: throws `TokenVerificationError` per scenario | Drive each fail-closed branch without real crypto/IdP |
| `next`        | NestJS         | Spy                                                | Assert downstream handler is never reached            |

- **Unit Scenario: UTS-012-B1**
    - **Arrange**: `req.headers` has no `Authorization` header
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401`; `verifyToken` **not** called; `req.caller` is `undefined`; `next()` not called with the request continuing — request never reaches business logic

- **Unit Scenario: UTS-012-B2**
    - **Arrange**: `Authorization = 'Bearer not-a-jwt'`; mock `verifyToken` to throw `new Error('malformed token')`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401`; `req.caller` is `undefined` (malformed token rejected)

- **Unit Scenario: UTS-012-B3**
    - **Arrange**: `Authorization = 'Bearer expired.jwt'`; mock `verifyToken` to throw a verification error with reason `token-expired` (`exp` in the past)
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401` (expiry rejected, fail closed)

- **Unit Scenario: UTS-012-B4**
    - **Arrange**: `Authorization = 'Bearer wrong.azp.jwt'`; `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to throw a verification error with reason `azp-mismatch` (token `azp = 'https://evil.example'`)
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401`; `verifyToken` was called with `authorizedParties: ['https://app.commise.app']` (the `azp` allowlist is enforced by the verifier, not the handler)

- **Unit Scenario: UTS-012-B5**
    - **Arrange**: `Authorization = 'Bearer good.jwt'`; `CLERK_JWT_KEY` config is empty/undefined so `verifyToken` throws a configuration error
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401` (missing key config fails closed — never proceeds unauthenticated)

---

#### Test Case: UTP-012-C (verify — client-supplied identity header is ignored)

**Technique**: Error Guessing + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies that a forged identity header (`x-authorizer-context` / `x-user-id`) is never read; the `AuthenticatedCaller.sub` comes solely from the verified token, even when the header claims a different `sub` (REQ-037a–d, mirrors PR #39 decision).

**Dependency & Mock Registry:**

| Dependency    | Source         | Mock/Stub Strategy                                                    | Rationale                     |
| ------------- | -------------- | --------------------------------------------------------------------- | ----------------------------- |
| `verifyToken` | @clerk/backend | Mock: resolves `{ sub: 'user_real', azp: 'https://app.commise.app' }` | Isolate verified-claim source |

- **Unit Scenario: UTS-012-C1**
    - **Arrange**: `Authorization = 'Bearer good.jwt'`; also set `req.headers['x-authorizer-context'] = JSON.stringify({ sub: 'user_admin_forged' })` and `req.headers['x-user-id'] = 'user_admin_forged'`; mock `verifyToken` to resolve `{ sub: 'user_real', azp: 'https://app.commise.app', public_metadata: {} }`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: `req.caller.sub === 'user_real'` (the verified token wins); the `x-authorizer-context` / `x-user-id` headers are never parsed into `req.caller`

---

#### Test Case: UTP-012-D (authorizeScope — missing operational scope → 403; precedence after 401)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + State Machine View (status precedence)
**Description**: Verifies the scope gate on an operational endpoint: an authenticated caller lacking the required scope receives `403` (distinct from the `401` unauthenticated case), and a caller holding the scope passes — covering both branches of the authorization check (REQ-038a–c, FR-051 precedence `401 → 403 → 400`).

**Dependency & Mock Registry:**

| Dependency            | Source  | Mock/Stub Strategy                         | Rationale                                          |
| --------------------- | ------- | ------------------------------------------ | -------------------------------------------------- |
| `AuthenticatedCaller` | MOD-012 | Stub principal built from a verified token | Scope gate runs on an already-authenticated caller |

- **Unit Scenario: UTS-012-D1**
    - **Arrange**: `req.caller = { sub: 'user_abc', scopes: [], isService: false }`; route requires scope `'foods:refetch'`
    - **Act**: Invoke `authorizeScope(req, 'foods:refetch')`
    - **Assert**: Responds `403 Forbidden` (authenticated but unauthorized — not `401`); downstream handler not reached

- **Unit Scenario: UTS-012-D2**
    - **Arrange**: `req.caller = { sub: 'user_abc', scopes: ['foods:refetch'], isService: false }`; route requires scope `'foods:refetch'`
    - **Act**: Invoke `authorizeScope(req, 'foods:refetch')`
    - **Assert**: Passes (no `403`); `next()` called — scope present authorizes the operational route

- **Unit Scenario: UTS-012-D3**
    - **Arrange**: A read endpoint (`GET /v1/foods/{fdcId}`) requiring no operational scope; `req.caller = { sub: 'user_abc', scopes: [] }`
    - **Act**: Invoke `authorizeScope(req, undefined)`
    - **Assert**: Passes — all authenticated users may read shared food reference data (no per-record ownership), per REQ-038

---

#### Test Case: UTP-012-E (computePriority — per-`sub` pending-count demotion, dynamic re-promotion, never rejected)

**Technique**: Boundary Value Analysis + State Transition Testing + Strict Isolation
**Target View**: Internal Data Structures + State Machine View
**Description**: Verifies fairness-by-demotion in MOD-013 (FR-043, SC-012, revised 2026-06-20): the drain-time priority scorer computes a `sub`'s rank from its **current pending count** read live from `fetch_queue` + `fetch_requesters`. A request from a `sub` with **more than 50 items currently pending** is **still admitted** (no `429`, never rejected for a personal limit) but its queued items are ranked to the **back** of the priority order; once the `sub`'s pending count falls back below 50 the scorer **dynamically re-promotes** the items to normal priority (it reads live state, not a frozen flag). Demotion is work-conserving — a demoted `sub` still drains on spare capacity. The pending-count source is mocked so only the demotion decision logic is tested.

**Dependency & Mock Registry:**

| Dependency          | Source                                        | Mock/Stub Strategy                                      | Rationale                                                             |
| ------------------- | --------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `PendingCountStore` | ARCH-003 (`fetch_queue` + `fetch_requesters`) | Mock: returns a controlled live pending count per `sub` | Isolate the demotion decision from the real queue tables              |
| `FetchQueue`        | ARCH-003 (Postgres `fetch_queue`)             | Spy: `enqueue()` — assert call count                    | Verify every authenticated request is still enqueued (never rejected) |

- **Unit Scenario: UTS-012-E1**
    - **Arrange**: Demotion threshold `T = 50`; mock `PendingCountStore` so `sub='user_abc'` has `pending = 50` (at the boundary, not yet over)
    - **Act**: Invoke `computePriority('user_abc', { fdcId: 12345 })`
    - **Assert**: Returns normal (non-demoted) priority and `{ admitted: true }`; `FetchQueue.enqueue` called once — at exactly 50 pending the `sub` is **not** demoted (boundary: == 50 is not "more than 50")

- **Unit Scenario: UTS-012-E2**
    - **Arrange**: Mock `PendingCountStore` so `sub='user_abc'` has `pending = 51` (more than 50)
    - **Act**: Invoke `computePriority('user_abc', { fdcId: 12345 })`
    - **Assert**: Returns **back-of-queue** (lowest, below FR-015 demand ordering) priority and `{ admitted: true }`; `FetchQueue.enqueue` **still called once** — the request is accepted (no `429`, never rejected for a personal limit); only its rank is demoted (boundary: 51 → demoted, FR-043)

- **Unit Scenario: UTS-012-E3**
    - **Arrange**: `sub='user_abc'` was demoted while at `pending = 80`; its pending count later drops to `pending = 49` (below the threshold) as items drain
    - **Act**: Invoke `computePriority('user_abc', { fdcId: 12345 })` again at the new live count
    - **Assert**: Returns normal (non-demoted) priority — the scorer **dynamically re-promotes** from live state once pending falls below 50, with no frozen demotion flag persisted; the heavy `sub` still drained on spare capacity throughout (work-conserving, FR-043/SC-012)

---

#### Test Case: UTP-012-F (validateBatch — oversized batch → 400, no enqueue)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Internal Data Structures + Algorithmic/Logic View
**Description**: Verifies the hard batch-size cap (e.g. ≤ 100 `fdcId`s) across the boundary: at-limit accepted, over-limit rejected with `400` before any enqueue (REQ-040a–b, FR-045). (There is no per-user quota to debit — fairness is by demotion, UTP-012-E.)

**Dependency & Mock Registry:**

| Dependency   | Source   | Mock/Stub Strategy                      | Rationale                                  |
| ------------ | -------- | --------------------------------------- | ------------------------------------------ |
| `FetchQueue` | ARCH-003 | Spy: `enqueue()` — assert zero on `400` | Verify nothing enqueues on oversized batch |

- **Unit Scenario: UTS-012-F1**
    - **Arrange**: `MAX_BATCH = 100`; `fdcIds` array of length `100`
    - **Act**: Invoke `validateBatch(fdcIds)`
    - **Assert**: Returns `{ valid: true }` (boundary: max accepted)

- **Unit Scenario: UTS-012-F2**
    - **Arrange**: `MAX_BATCH = 100`; `fdcIds` array of length `101`
    - **Act**: Invoke `validateBatch(fdcIds)`
    - **Assert**: Returns `{ valid: false, status: 400 }`; `FetchQueue.enqueue` called zero times (boundary: max+1 — rejected, no enqueue)

- **Unit Scenario: UTS-012-F3**
    - **Arrange**: `fdcIds = []` (empty batch)
    - **Act**: Invoke `validateBatch([])`
    - **Assert**: Returns `{ valid: false, status: 400 }` (degenerate min-1 boundary — empty batch rejected)

---

#### Test Case: UTP-012-G (countDemand — distinct-requester demand counts distinct subs only)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies demand-weighting counts **distinct authenticated `sub`s** per `fdcId` (via the requester subscription set), so a single `sub`'s repeated requests do not inflate priority more than once — each distinct `sub` contributes exactly `PRIORITY_CAP = 1`, and there is **no** per-`fdcId` demand ceiling, so demand scales linearly with the number of distinct requesters (REQ-039 demand / FR-044).

**Dependency & Mock Registry:**

| Dependency                 | Source                                                                     | Mock/Stub Strategy                                      | Rationale                                                                                     |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RequesterSubscriptionSet` | ARCH-007 (Postgres `fetch_requesters` set default; deferred Redis variant) | Mock: backed by an in-memory `Set` keyed `fdcId → subs` | Isolate distinct-counting from the real set store (Postgres unique-row / deferred Redis SADD) |

- **Unit Scenario: UTS-012-G1**
    - **Arrange**: For `fdcId=12345`, `sub='user_a'` records a request 5 times in a row
    - **Act**: Invoke `recordDemand(12345, 'user_a')` five times, then `getDemand(12345)`
    - **Assert**: `getDemand(12345) === 1` — repeated requests by the same `sub` count once (idempotent set-insert semantics: Postgres `INSERT ... ON CONFLICT DO NOTHING` by default, deferred Redis `SADD`), not 5

- **Unit Scenario: UTS-012-G2**
    - **Arrange**: For `fdcId=12345`, three distinct subs `user_a`, `user_b`, `user_c` each request once
    - **Act**: Record each, then `getDemand(12345)`
    - **Assert**: `getDemand(12345) === 3` — distinct requesters each contribute exactly one

- **Unit Scenario: UTS-012-G3**
    - **Arrange**: 60 distinct subs each request `fdcId=12345` once (each `sub` contributes `PRIORITY_CAP = 1` to the distinct-requester demand — there is no per-`fdcId` demand ceiling)
    - **Act**: Record all 60, then `getDemand(12345)`
    - **Assert**: `getDemand(12345) === 60` — distinct requesters each contribute exactly one (consistent with UTS-012-G2); demand scales linearly with distinct subs, with no per-`fdcId` cap clamping the total

---

#### Test Case: UTP-012-H (enqueueGate — 503 fail-closed family: backpressure, open circuit, pending-count store unavailable)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage + Error Guessing
**Target View**: Internal Data Structures + Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies the `503` decision branches of MOD-013's enqueue gate for an authenticated caller (note: there is no per-user quota — fairness is by demotion per UTP-012-E, not by `429`): (a) the `fetch_queue` is at/over its enforced `MAX_QUEUE_DEPTH` → `503` with no enqueue; (b) the USDA circuit breaker is `OPEN` → `503` with no enqueue; (c) the pending-count store (`fetch_queue` + `fetch_requesters`) used to compute demotion is unavailable → **fail closed** to `503` (never fail open to unbounded enqueue). These are the unit-level counterparts to the seam test ITP-012-D; the queue-depth probe, circuit breaker, and pending-count store are all mocked so only the gate's decision logic is exercised (REQ-040a–b, FR-046). Fail-closed is **defined** here: any error or unavailability of the demotion/depth/breaker signals resolves to a reject (`503`) and `FetchQueue.enqueue` is never called. (The system-wide `MAX_QUEUE_DEPTH` backstop is distinct from per-`sub` demotion: demotion never rejects, but the global depth ceiling can `503`.)

**Dependency & Mock Registry:**

| Dependency          | Source                                        | Mock/Stub Strategy                                                           | Rationale                                               |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `QueueDepthProbe`   | ARCH-003                                      | Mock: `currentDepth()` returns a controlled integer at/over/under the bound  | Drive the backpressure boundary without a real queue    |
| `CircuitBreaker`    | ARCH-008                                      | Mock: `state()` returns `'closed'` or `'open'`                               | Drive the open-circuit branch without real USDA state   |
| `PendingCountStore` | ARCH-003 (`fetch_queue` + `fetch_requesters`) | Mock: `pendingFor()` resolves a count **or** throws `ConnectionRefusedError` | Drive the demotion-input and store-unavailable branches |
| `FetchQueue`        | ARCH-003                                      | Spy: `enqueue()` — assert zero on every `503`                                | Verify nothing is enqueued when the gate fails closed   |

- **Unit Scenario: UTS-012-H1**
    - **Arrange**: `MAX_QUEUE_DEPTH = 10000`; mock `QueueDepthProbe.currentDepth()` returns `10000` (at the ceiling); `CircuitBreaker.state()` returns `'closed'`; `PendingCountStore.pendingFor('user_abc')` returns `5`
    - **Act**: Invoke `enqueueGate('user_abc', [12345])`
    - **Assert**: Returns `{ allowed: false, status: 503 }`; `FetchQueue.enqueue` called **zero** times (boundary: depth == max is over-full, reject — the global backstop, not a per-user limit)

- **Unit Scenario: UTS-012-H2**
    - **Arrange**: `MAX_QUEUE_DEPTH = 10000`; `QueueDepthProbe.currentDepth()` returns `9999` (max-1, under the ceiling); `CircuitBreaker.state()` returns `'closed'`; `PendingCountStore.pendingFor('user_abc')` returns `5`
    - **Act**: Invoke `enqueueGate('user_abc', [12345])`
    - **Assert**: Returns `{ allowed: true }`; `FetchQueue.enqueue` called once (boundary: max-1 admitted — confirms the `503` branch is the depth ceiling, not an always-reject)

- **Unit Scenario: UTS-012-H3**
    - **Arrange**: `QueueDepthProbe.currentDepth()` returns `10` (well under ceiling); `CircuitBreaker.state()` returns `'open'` (USDA breaker tripped); `PendingCountStore.pendingFor('user_abc')` returns `5`
    - **Act**: Invoke `enqueueGate('user_abc', [12345])`
    - **Assert**: Returns `{ allowed: false, status: 503 }`; `FetchQueue.enqueue` called **zero** times (open circuit fails closed independently of queue depth)

- **Unit Scenario: UTS-012-H4**
    - **Arrange**: `QueueDepthProbe.currentDepth()` returns `10`; `CircuitBreaker.state()` returns `'closed'`; mock `PendingCountStore.pendingFor('user_abc')` **throws** `ConnectionRefusedError` (pending-count store unavailable)
    - **Act**: Invoke `enqueueGate('user_abc', [12345])`
    - **Assert**: Returns `{ allowed: false, status: 503 }` — **fail closed**: an unavailable pending-count store (which feeds the demotion scorer) rejects rather than failing open to unbounded enqueue; `FetchQueue.enqueue` called **zero** times

---

#### Test Case: UTP-012-I (loadShedVerify — invalid-token flood load-shed: per-source `401`-rate cap + concurrency cap, SC-011 holds)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage + Error Guessing
**Target View**: Internal Data Structures + Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-012's DoS-protection branch (FR-052, SC-011): under a flood of well-formed-but-invalid tokens — each of which would otherwise force a CPU-bound `verifyToken` signature check before the fail-closed `401` — the verifier **load-sheds** rather than saturating. Two independent guards are exercised at their boundaries: (a) a **per-source `401`-rate cap** that short-circuits to `401` **without** invoking `verifyToken` once a source crosses its rolling `401` budget; and (b) a **bounded verification concurrency** semaphore that sheds (immediate `503`/`401` without a signature check) when in-flight verifications are at the ceiling, so a single flooding source cannot pin every worker and breach SC-011's ≤10ms p95 for legitimate callers. The rate-counter store, the clock, and `verifyToken` are mocked so only the load-shed decision logic is tested — no real crypto, no real timer. This is the unit-level counterpart to the seam/load behavior; it asserts the shed branch never produces an `AuthenticatedCaller`.

**Dependency & Mock Registry:**

| Dependency               | Source                                              | Mock/Stub Strategy                                                                                      | Rationale                                                                 |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `verifyToken`            | @clerk/backend                                      | Spy: throws `TokenVerificationError`; assert **call count** to prove the cap short-circuits ahead of it | Prove load-shed bypasses the CPU-bound signature check                    |
| `FailureRateStore`       | ARCH-007 (Postgres default; deferred Redis variant) | Mock: `count(source)` returns a controlled rolling `401` count at/over/under the cap                    | Drive the per-source `401`-rate-cap boundary without a real counter store |
| `VerifyConcurrencyGuard` | MOD-012                                             | Mock: `inFlight()` returns a controlled integer at/over/under `MAX_VERIFY_CONCURRENCY`                  | Drive the concurrency-cap shed branch deterministically                   |
| `MonitoringLogger`       | ARCH-011                                            | Mock: `incrementMetric()` records args                                                                  | Verify the `auth.load_shed` metric is emitted (observability of the shed) |

- **Unit Scenario: UTS-012-I1**
    - **Arrange**: `MAX_SOURCE_401_RATE = 100`/window; mock `FailureRateStore.count('1.2.3.4')` returns `99` (max-1, under the cap); `Authorization = 'Bearer well-formed.but.invalid'`; spy `verifyToken` throws `TokenVerificationError`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `401`; `verifyToken` **called exactly once** (under the cap → the signature check still runs, then fails closed); `req.caller` is `undefined` (boundary: max-1 — not yet shedding)

- **Unit Scenario: UTS-012-I2**
    - **Arrange**: `MAX_SOURCE_401_RATE = 100`; mock `FailureRateStore.count('1.2.3.4')` returns `100` (at the cap); same well-formed-but-invalid token; spy `verifyToken`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Responds `429` (per MOD-012's pinned per-source 401-rate-cap shed status, module-design.md §error map); `verifyToken` **called zero times** — the per-source cap short-circuits ahead of the CPU-bound verify (load-shed); `MonitoringLogger.incrementMetric` called with `("auth.load_shed", 1)`; `req.caller` is `undefined` (boundary: at-cap == shedding)

- **Unit Scenario: UTS-012-I3**
    - **Arrange**: `MAX_VERIFY_CONCURRENCY = 64`; mock `VerifyConcurrencyGuard.inFlight()` returns `64` (at the ceiling); `FailureRateStore.count` under cap; spy `verifyToken`
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Sheds without a signature check — responds `503` (per MOD-012's pinned `VerifySemaphore`-exhausted shed status, module-design.md §error map) and `verifyToken` **called zero times**; `MonitoringLogger.incrementMetric` called with `("auth.load_shed", 1)` — the concurrency semaphore caps in-flight verifications so a flood cannot saturate the verifier (boundary: in-flight == max → shed)

- **Unit Scenario: UTS-012-I4**
    - **Arrange**: `MAX_VERIFY_CONCURRENCY = 64`; mock `VerifyConcurrencyGuard.inFlight()` returns `63` (max-1, a slot free); `FailureRateStore.count` under cap; mock `verifyToken` to **resolve** a valid `{ sub: 'user_legit', azp: <authorized>, public_metadata: { scopes: [] } }` (a legitimate caller arriving during the flood)
    - **Act**: Invoke `middleware.verify(req)`
    - **Assert**: Admitted — `verifyToken` called once and `req.caller.sub === 'user_legit'`; **not** shed (boundary: max-1 — a free slot admits the legitimate request even while invalid traffic is shed elsewhere), demonstrating SC-011's ≤10ms p95 path stays open under the invalid-token flood

---

#### Test Case: UTP-012-J (authorizeConnect — WebSocket `$connect` auth + mid-connection `exp` → close)

**Technique**: State Transition Testing + Statement & Branch Coverage + Strict Isolation
**Target View**: State Machine View (Unauthenticated → Connected → Expired/Closed) + Algorithmic/Logic View
**Description**: Verifies the WebSocket auth path (FR-049, FR-041): MOD-012's shared Clerk verification, reused by the `$connect` REQUEST authorizer, (a) extracts the token from the `Sec-WebSocket-Protocol` subprotocol (or query param — browsers cannot set an `Authorization` header on a WS handshake), (b) admits a valid token and emits an `Allow` policy whose principal/`sub` is sourced solely from the verified claims, (c) **pins `$connect` rejection to `403`** for a missing/invalid token (per API Gateway WebSocket authorizers, not `401`), and (d) on a **mid-connection token expiry** — when `exp` passes during a long-lived connection and the next message (or a periodic re-auth check) re-verifies — transitions Connected → Closed (re-auth required on reconnect after the 10-minute idle close). `verifyToken` and the clock are mocked; no real socket, no IdP call.

**Dependency & Mock Registry:**

| Dependency        | Source         | Mock/Stub Strategy                                                                            | Rationale                                                              |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `verifyToken`     | @clerk/backend | Mock: resolves a valid claim set, or throws a `token-expired` verification error per scenario | Networkless `$connect` verification; drive expiry without a real clock |
| `now`             | Internal       | Mock: returns a controlled epoch so `exp` can be crossed deterministically                    | Drive the mid-connection expiry transition                             |
| `ConnectionStore` | DynamoDB       | Mock: `putConnection()` / `deleteConnection()` record args                                    | Verify the subscription row is written on connect, removed on close    |

- **Unit Scenario: UTS-012-J1**
    - **Arrange**: `$connect` event carries the token via `Sec-WebSocket-Protocol` (no `Authorization` header on the WS handshake); `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to resolve `{ sub: 'user_ws', azp: 'https://app.commise.app', exp: now() + 600, public_metadata: {} }`
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Returns an `Allow` IAM policy whose `principalId`/`context.sub === 'user_ws'` (sourced solely from the verified token); `verifyToken` called once with `authorizedParties: ['https://app.commise.app']` (token read from the subprotocol, never an `Authorization` header)

- **Unit Scenario: UTS-012-J2**
    - **Arrange**: `$connect` event with **no** token presented in the subprotocol or query param
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Rejects the handshake with the pinned `403` `$connect` status (NOT `401` — API Gateway WebSocket authorizer convention, FR-049d); `verifyToken` not called; no `Allow` policy emitted; `ConnectionStore.putConnection` not called (no `fetch_requesters` row written)

- **Unit Scenario: UTS-012-J3**
    - **Arrange**: `$connect` event with a well-formed but invalid token in the subprotocol; mock `verifyToken` to throw a `TokenVerificationError`
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Rejects with the pinned `403` `$connect` status (fail closed); no `Allow` policy; the connection is never established

- **Unit Scenario: UTS-012-J4**
    - **Arrange**: A connection was admitted at `now() = 1000` with a token whose `exp = 1300`; the clock advances to `now() = 1301` (token now expired); a subsequent message (or periodic re-auth check) triggers re-verification; mock `verifyToken` to throw a `token-expired` verification error at the new time
    - **Act**: Invoke `authorizeMessage(connectionId, req)` (the mid-connection re-auth path) at `now() = 1301`
    - **Assert**: The connection transitions Connected → Closed — the handler closes the socket (or returns the close directive) and `ConnectionStore.deleteConnection` is called with the `connectionId`; the expired token does NOT continue to authorize traffic (FR-049b: mid-connection `exp` → close, re-auth required on reconnect)

- **Unit Scenario: UTS-012-J5**
    - **Arrange**: A connection admitted at `now() = 1000` with `exp = 1300`; the clock is at `now() = 1299` (token still valid, max-1 boundary); mock `verifyToken` to resolve the still-valid claims
    - **Act**: Invoke `authorizeMessage(connectionId, req)` at `now() = 1299`
    - **Assert**: The connection remains Connected (no close); `ConnectionStore.deleteConnection` NOT called — confirms the close branch is gated on actual expiry, not an always-close (boundary: `exp - 1` still authorizes)

---

### Module: MOD-014 (AsyncProducerAuthz — Async-Producer Provenance & Least-Privilege Enforcement)

**Parent Architecture Modules**: ARCH-012 (FoodAuthGuard)
**Requirements Under Test**: REQ-037a–d, FR-048
**Target Source File(s)**: `packages/services/food-service/src/auth/async-producer-authz.service.ts` (MOD-014)

> US-0's guarantee — _"no unauthenticated path may drive USDA consumption"_ — must also hold on the **async/internal** producer leg (EventBridge events, cron/scheduled jobs, bulk-sync, recipe import), not only the synchronous HTTP edge that MOD-012 fronts. MOD-014 enforces two layers before any USDA fetch or `INSERT INTO fetch_queue`: **(1)** the delivering IAM principal — taken from the AWS-attested invocation context, never a forgeable event-body field — must be on the least-privilege producer allowlist; and **(2)** the event's `requestedBy` provenance must be an authenticated human `sub` (carried from MOD-012) or a named `svc_` service principal — never empty and never the anonymous `'system'` shortcut. Every deny path is **fail-closed**: the event is dropped, nothing is fetched or enqueued. Unit scenarios mock the invocation context, the allowlist config, and `MonitoringLogger`; only the module's internal control flow and boundaries are exercised — no real EventBridge, no DB.

---

#### Test Case: UTP-014-A (admitAsyncEvent — allowlisted principal + valid provenance → admitted)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + State Machine View (ReceivingAsyncEvent → CheckingProducerPrincipal → CheckingProvenance → Admitted)
**Description**: Verifies the happy-path admit branch of `admitAsyncEvent` (FR-048): when the AWS-attested delivering principal is on the least-privilege allowlist **and** the event's `requestedBy` is an authenticated human `sub`, the gate admits and returns the carried provenance with `requesterClass: 'user'` — covering the success traversal of both enforcement layers before any fetch/enqueue. The invocation context, allowlist, and logger are mocked; no real bus.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                                                    | Rationale                                                              |
| ------------------- | -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `{ callerArn: 'arn:aws:iam::…:role/food-consumer', eventSource: 'aws.events' }` | Delivery identity is AWS-attested, never client-suppliable — stub it   |
| `ProducerAllowlist` | Config (IaC)   | Stub: `Set(['arn:aws:iam::…:role/food-consumer', 'arn:aws:iam::…:role/import-job'])`  | Least-privilege allowlist is config, not request input                 |
| `isClerkSub`        | MOD-012        | Stub: returns `true` for `'user_async'`                                               | Shape-validate the carried authenticated sub without real verification |
| `MonitoringLogger`  | ARCH-011       | Spy: records `incrementMetric` calls                                                  | Assert the `async.producer.admitted` metric; no CloudWatch side-effect |

- **Unit Scenario: UTS-014-A1**
    - **Arrange**: `invocationContext.callerArn = 'arn:aws:iam::…:role/food-consumer'` (on the allowlist); `event = { DetailType: 'FoodRequested', Detail: JSON.stringify({ requestedBy: 'user_async' }) }`; `isClerkSub('user_async')` → `true`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Returns `{ admitted: true, requestedBy: 'user_async', requesterClass: 'user' }`; `MonitoringLogger.incrementMetric` called once with `('async.producer.admitted', 1)`; no error thrown — both the principal and provenance layers passed

---

#### Test Case: UTP-014-B (assertProducerPrincipal — non-allowlisted IAM principal → UnauthorizedProducerError, fail closed)

**Technique**: Equivalence Partitioning + Error Guessing + Strict Isolation
**Target View**: Error Handling & Return Codes + State Machine View (CheckingProducerPrincipal → RejectedUnauthorizedProducer)
**Description**: Verifies the layer-1 deny branch (FR-048): a delivering IAM principal that is **not** on the least-privilege allowlist is rejected with `UnauthorizedProducerError` **before** provenance is even evaluated — the event is dropped, no fetch and no enqueue occur, and an alarm metric is emitted (possible bus/role misconfig or abuse). The principal ARN is read from the AWS-attested context, never an event-body field, so a forged `Detail` cannot bypass this. The allowlist and logger are mocked.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                                            | Rationale                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `{ callerArn: 'arn:aws:iam::…:role/rogue', eventSource: 'aws.events' }` | Drive a principal absent from the allowlist |
| `ProducerAllowlist` | Config (IaC)   | Stub: `Set(['arn:aws:iam::…:role/food-consumer'])`                            | Rogue ARN is not a member                   |
| `FetchQueue`        | MOD-006        | Spy: `enqueue()`                                                              | Assert nothing is enqueued on the deny path |

- **Unit Scenario: UTS-014-B1**
    - **Arrange**: `invocationContext.callerArn = 'arn:aws:iam::…:role/rogue'` (not on the allowlist); `event = { DetailType: 'FoodRequested', Detail: JSON.stringify({ requestedBy: 'user_async' }) }` (provenance would otherwise be valid)
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `UnauthorizedProducerError` (with the offending `principalArn`); `assertProvenance` is never reached (layer-1 short-circuits before layer-2); `FetchQueue.enqueue` NOT called; `async.producer.admitted` metric NOT incremented — fail-closed, event dropped
    - **`isUnauthorizedProducerError(err)` type guard returns `true`** for the thrown error

- **Unit Scenario: UTS-014-B2**
    - **Arrange**: A `fetch_queue` direct-insert path: `assertEnqueueProvenance(dbSessionRole = 'arn:aws:iam::…:role/rogue-db', requestedBy = 'user_async')`; `'…role/rogue-db'` is not on the allowlist
    - **Act**: Invoke `assertEnqueueProvenance(dbSessionRole, requestedBy)`
    - **Assert**: Throws `UnauthorizedProducerError` (non-allowlisted DB session role); the INSERT is rejected — defense-in-depth behind the least-privilege DB grant (FR-048)

---

#### Test Case: UTP-014-C (assertProvenance — requestedBy missing / empty / 'system' → ProvenanceError, fail closed)

**Technique**: Equivalence Partitioning + Boundary Value Analysis + Error Guessing
**Target View**: Error Handling & Return Codes + Algorithmic/Logic View
**Description**: Verifies the layer-2 anonymous-origin deny branch (FR-048) — the one that closes the unauthenticated async path: for an **allowlisted** delivering principal, an event whose `requestedBy` is `null`, empty-string, or the generic `'system'` marker is rejected with `ProvenanceError`; the event is dropped and nothing is fetched or enqueued. The three anonymous-origin inputs form one equivalence class (each must reject) with `'system'` as the explicitly-named boundary that an unauthenticated producer would most plausibly supply. The allowlist passes so only the provenance branch is exercised.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                  | Rationale                                               |
| ------------------- | -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `callerArn` on the allowlist (layer-1 passes) | Isolate the layer-2 provenance branch                   |
| `ProducerAllowlist` | Config (IaC)   | Stub: contains the stubbed `callerArn`              | Ensure the principal check does not short-circuit first |
| `FetchQueue`        | MOD-006        | Spy: `enqueue()`                                    | Assert no enqueue on every reject                       |

- **Unit Scenario: UTS-014-C1**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: null })`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` ("Missing/anonymous requestedBy"); `FetchQueue.enqueue` NOT called; no admit metric — missing provenance fails closed

- **Unit Scenario: UTS-014-C2**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: '' })` (empty string boundary)
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError`; nothing fetched/enqueued — empty `requestedBy` is rejected identically to `null`

- **Unit Scenario: UTS-014-C3**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: 'system' })` (the named anonymous-origin boundary)
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` — the generic `'system'` string is explicitly rejected (no unauthenticated `'system'` shortcut); event dropped, fail closed (FR-048)

- **Unit Scenario: UTS-014-C4**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: 'unknown_token_42' })`; `isClerkSub('unknown_token_42')` → `false` and it lacks the `svc_` prefix
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` ("neither an authenticated sub nor a named service principal") — a present-but-unrecognized `requestedBy` is not admitted

---

#### Test Case: UTP-014-D (assertProvenance — named svc\_ service principal → admitted as requesterClass 'service')

**Technique**: Equivalence Partitioning + Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + State Machine View (CheckingProvenance → Admitted)
**Description**: Verifies the second admit equivalence class of layer-2 (FR-048): an allowlisted principal carrying a `requestedBy` that begins with the `svc_` service-principal prefix is admitted and classified `requesterClass: 'service'` (distinct from the human-`sub` class of UTP-014-A) — covering the `isNamedService` branch and confirming named service identities are a first-class authenticated provenance, not a `'system'`-style anonymous shortcut. `isClerkSub` is stubbed `false` to prove the admit comes from the service-prefix branch alone.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                           | Rationale                                                            |
| ------------------- | -------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `callerArn` on the allowlist (e.g. the scheduler role) | Layer-1 passes so the service-prefix branch is isolated              |
| `ProducerAllowlist` | Config (IaC)   | Stub: contains the stubbed `callerArn`                       | Allow the principal through to provenance                            |
| `isClerkSub`        | MOD-012        | Stub: returns `false`                                        | Prove admit is via the `svc_` prefix branch, not the human-`sub` one |
| `MonitoringLogger`  | ARCH-011       | Spy: records `incrementMetric`                               | Assert the admit metric on the service path                          |

- **Unit Scenario: UTS-014-D1**
    - **Arrange**: Allowlisted scheduler principal; `event = { DetailType: 'IngestionScheduled', Detail: JSON.stringify({ requestedBy: 'svc_nightly_sync' }) }`; `SERVICE_PRINCIPAL_PREFIX = 'svc_'`; `isClerkSub('svc_nightly_sync')` → `false`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Returns `{ admitted: true, requestedBy: 'svc_nightly_sync', requesterClass: 'service' }`; `MonitoringLogger.incrementMetric('async.producer.admitted', 1)` called once — the `svc_`-prefixed identity is admitted as a named service principal

- **Unit Scenario: UTS-014-D2**
    - **Arrange**: Allowlisted principal; `event.DetailType = 'PaymentSettled'` (not in `ALLOWED_DETAIL_TYPES = ['FoodRequested', 'FoodBatchRequested', 'IngestionScheduled']`); `Detail` carries a valid `svc_` `requestedBy`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `UnauthorizedProducerError` ("Unrecognized detail-type") — even a valid service provenance is dropped on an unrecognized detail-type; no work performed (FR-048)

---

#### Test Case: UTP-014-E (admitAsyncEvent — missing/empty allowlist config at boot → ProducerConfigError, fail closed)

**Technique**: Error Guessing + Statement & Branch Coverage
**Target View**: Error Handling & Return Codes
**Description**: Verifies the boot-time fail-closed posture (FR-048, mirrors FR-040): if the least-privilege allowlist config is missing or empty when async processing starts, the module **refuses to process async events** (`ProducerConfigError`) rather than defaulting open — an empty allowlist must never be read as "allow all". This guards the configuration-error class that would otherwise silently disable layer-1.

**Dependency & Mock Registry:**

| Dependency          | Source       | Mock/Stub Strategy                | Rationale                                         |
| ------------------- | ------------ | --------------------------------- | ------------------------------------------------- |
| `ProducerAllowlist` | Config (IaC) | Stub: empty `Set()` / `undefined` | Drive the missing/empty-config fail-closed branch |

- **Unit Scenario: UTS-014-E1**
    - **Arrange**: `ALLOWED_PRODUCER_PRINCIPAL_ARNS` resolves to an empty set (or undefined) at construction; a well-formed event with an allowlisted-looking principal and valid `svc_` provenance
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProducerConfigError` — the module fails closed (refuses to admit any async event) rather than treating an empty allowlist as allow-all; no fetch, no enqueue

---

## Coverage Summary

| Metric                                 | Count                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Total MOD modules                      | 14                                                                                                                                         |
| Non-[EXTERNAL] MODs requiring coverage | 14                                                                                                                                         |
| MODs with at least one UTP             | 14 / 14 (100%)                                                                                                                             |
| Total Unit Test Cases (UTP)            | 53                                                                                                                                         |
| Total Unit Test Scenarios (UTS)        | 147                                                                                                                                        |
| Techniques applied                     | Statement & Branch Coverage, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation, State Transition Testing, Error Guessing |

## Technique Distribution

| Technique                   | UTP Count |
| --------------------------- | --------- |
| Statement & Branch Coverage | 42        |
| Boundary Value Analysis     | 16        |
| Equivalence Partitioning    | 10        |
| Strict Isolation            | 17        |
| State Transition Testing    | 10        |
| Error Guessing              | 7         |

> Note: Many UTPs apply multiple techniques simultaneously; counts reflect primary + secondary technique pairings.

---

_End of Unit Test Plan — 003-usda-food-data_
