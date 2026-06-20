# Integration Test Plan: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for the USDA Food Data Integration feature. Every architecture module in `architecture-design.md` has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys. Language is module-boundary-oriented. The USDA API is never called in the request path — all user-facing lookups are served from local storage (PostgreSQL; in-process LRU cache by default, deferred Redis variant). Cache misses trigger a backfill pipeline backed by a Postgres `fetch_queue` with `LISTEN/NOTIFY`: ARCH-001 → ARCH-002 → ARCH-003 → `fetch_queue` (Postgres) → ARCH-004 (Fargate consumer worker) → ARCH-005 → ARCH-008 → ARCH-006 → ARCH-007.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — where NNN matches the parent ARCH, X is a letter suffix (A, B, C...)
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}` — nested under the parent ITP, with numeric suffix (1, 2, 3...)
- Example: `ITS-001-A1` → Scenario 1 of Test Case A verifying ARCH-001

## ISO 29119-4 Integration Test Techniques

Consumer-Driven Contract Testing (CDCT) is included for externally consumed module contracts; provider modules publish contracts and consumer modules validate expectations before integration deployment.

Each test case identifies its technique by name and anchors to a specific architecture view:

| Technique                                | Source View                   | What It Tests                                                                            |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| **Interface Contract Testing**           | Interface View                | Module API contracts, data format compliance, error responses                            |
| **Data Flow Testing**                    | Data Flow View                | End-to-end data transformation chain validation                                          |
| **Interface Fault Injection**            | Interface View + Process View | Malformed payloads, timeouts, graceful failure                                           |
| **Concurrency & Race Condition Testing** | Process View                  | Simultaneous access, lock handling, queue ordering                                       |
| **Consumer-Driven Contract Testing**     | Interface View + Process View | Consumer-published pacts verified against the provider (M2M / async seams) before deploy |

## Integration Tests

---

### Module Verification: ARCH-001 (FoodApiController)

**Parent System Components**: SYS-001

#### Test Case: ITP-001-A (FoodApiController→FoodCacheService contract on cache hit)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 correctly invokes ARCH-007's `get(fdcId)` operation and propagates the returned `FoodData` payload as a `200 OK` response without modification.

- **Integration Scenario: ITS-001-A1**
    - **Given** Module ARCH-007 (FoodCacheService) holds a cached entry for `fdcId=12345` with `fetch_status='fetched'`
    - **When** Module ARCH-001 (FoodApiController) sends a `GET /v1/foods/12345` request to ARCH-007 via `get(12345)`
    - **Then** The handshake between ARCH-001 and ARCH-007 completes with ARCH-001 receiving `FoodData` and returning `200 OK` with the full nutrition payload to the caller

- **Integration Scenario: ITS-001-A2**
    - **Given** Module ARCH-007 returns `null` (cache miss) and Module ARCH-006 (FoodPostgresRepository) also returns `null` (DB miss)
    - **When** Module ARCH-001 sends `get(12345)` to ARCH-007 then `findByFdcId(12345)` to ARCH-006
    - **Then** Module ARCH-001 receives `null` from both ARCH-007 and ARCH-006, then sends `publishFoodRequested(12345)` to ARCH-002, and returns `202 Accepted` to the caller

#### Test Case: ITP-001-B (FoodApiController input validation gate — no invalid input reaches ARCH-002)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 rejects malformed `fdcId` values before any downstream module boundary is crossed, ensuring ARCH-002 never receives invalid payloads.

- **Integration Scenario: ITS-001-B1**
    - **Given** Module ARCH-001 receives a request with `fdcId='abc'` (non-numeric)
    - **When** ARCH-001 performs input validation before invoking any downstream module
    - **Then** Module ARCH-001 returns `400 Bad Request` to the caller and sends zero messages to ARCH-002 (EnqueueEmitter)

- **Integration Scenario: ITS-001-B2**
    - **Given** Module ARCH-001 receives a request with `fdcId=-1` (negative integer)
    - **When** ARCH-001 performs boundary validation
    - **Then** Module ARCH-001 returns `400 Bad Request` and the ARCH-002 boundary is never crossed

#### Test Case: ITP-001-C (FoodApiController→FoodCacheService deduplication handshake)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 calls ARCH-007's `isPending(fdcId)` before publishing to ARCH-002, and returns `202 Accepted` without re-queuing when the food is already pending.

- **Integration Scenario: ITS-001-C1**
    - **Given** Module ARCH-007 returns `true` from `isPending(12345)` (food already in pending_fetch set)
    - **When** Module ARCH-001 sends `isPending(12345)` to ARCH-007
    - **Then** Module ARCH-001 receives `true`, returns `202 Accepted` to the caller, and sends zero `publishFoodRequested` calls to ARCH-002

#### Test Case: ITP-001-D (FoodApiController stale-while-revalidate seam: serve stale 200 + enqueue re-fetch)

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies the stale-read (SWR) seam (FR-031, clarified 2026-06-20): on a read where ARCH-006 returns a held-but-`stale` record, ARCH-001 serves the existing data immediately as `200` (with a staleness indicator) **and** enqueues a background re-fetch via ARCH-002 — the read never blocks and never returns `202` for a record it already holds. If the re-fetch keeps failing, repeated reads continue serving the stale data indefinitely (availability over freshness).

- **Integration Scenario: ITS-001-D1**
    - **Given** Module ARCH-007 returns `null` (cache miss) and Module ARCH-006 `findByFdcId(12345)` returns a held record with `fetch_status='stale'` (older than the staleness threshold), with a spy on ARCH-002 `publishFoodRequested`
    - **When** Module ARCH-001 handles `GET /v1/foods/12345`
    - **Then** ARCH-001 returns `200 OK` with the stale `FoodData` and a staleness indicator (not `202`), and sends exactly one `publishFoodRequested({ fdcId: 12345 })` to ARCH-002 (background re-fetch enqueued, stale-while-revalidate)

- **Integration Scenario: ITS-001-D2**
    - **Given** The background re-fetch has repeatedly failed (prolonged USDA outage) and ARCH-006 still returns the same `stale` record on a subsequent read
    - **When** Module ARCH-001 handles `GET /v1/foods/12345` again
    - **Then** ARCH-001 still returns `200 OK` with the stale data + indicator — the held record is served indefinitely (no max-staleness cutoff withholds it) — and re-enqueues the re-fetch (subject to ARCH-003 `ON CONFLICT` dedup)

#### Test Case: ITP-001-E (FoodApiController tombstone-TTL seam: within TTL → 404 no enqueue; after TTL → re-attempt)

**Technique**: Interface Contract Testing + Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the `not_found` tombstone-TTL seam (FR-025, clarified 2026-06-20): a `fdcId` tombstoned as `not_found` returns `404` from ARCH-001 **without** crossing the ARCH-002 enqueue boundary while the tombstone is **within its configurable TTL (default 30 days)**; once the TTL has lapsed, a later read re-attempts by enqueuing a re-fetch (counting against the normal rolling-window budget so it cannot bypass the rate limit).

- **Integration Scenario: ITS-001-E1**
    - **Given** Module ARCH-006 `findByFdcId(12345)` returns a `not_found` tombstone whose age is within the 30-day TTL, with a spy on ARCH-002 `publishFoodRequested`
    - **When** Module ARCH-001 handles `GET /v1/foods/12345`
    - **Then** ARCH-001 returns `404` and sends **zero** `publishFoodRequested` calls to ARCH-002 — within TTL → `404` with no enqueue (FR-025)

- **Integration Scenario: ITS-001-E2**
    - **Given** Module ARCH-006 returns a `not_found` tombstone whose age has exceeded the 30-day TTL
    - **When** Module ARCH-001 handles `GET /v1/foods/12345`
    - **Then** ARCH-001 enqueues a re-attempt — exactly one `publishFoodRequested({ fdcId: 12345 })` to ARCH-002 (after TTL → re-attempt, against the normal rolling-window budget) — and returns `202`/pending while the re-fetch is in flight

---

### Module Verification: ARCH-002 (EnqueueEmitter)

**Parent System Components**: SYS-002

#### Test Case: ITP-002-A (EnqueueEmitter→EventBridge bus contract for FoodRequested events)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-002 correctly validates and publishes `FoodRequested` event payloads to the EventBridge default bus, and that the event schema matches the contract expected by ARCH-003.

- **Integration Scenario: ITS-002-A1**
    - **Given** Module ARCH-001 sends `publishFoodRequested({ fdcId: 12345, requestedAt: '2026-05-09T00:00:00Z' })` to ARCH-002
    - **When** Module ARCH-002 validates the payload and publishes to the EventBridge default bus
    - **Then** The handshake between ARCH-002 and EventBridge completes with an `{ eventId: string }` response, and the event is routed to ARCH-003

- **Integration Scenario: ITS-002-A2**
    - **Given** Module ARCH-001 sends `publishFoodBatchRequested({ fdcIds: [1,2,3], requestedAt: '2026-05-09T00:00:00Z' })` to ARCH-002
    - **When** Module ARCH-002 publishes the batch event to EventBridge
    - **Then** Module ARCH-002 returns `{ eventId: string }` and the event is routed by ARCH-003 into the single Postgres `fetch_queue` as a low-demand row (`request_count` 0–1), which sorts after high-demand rows under the demand-weighted ordering

#### Test Case: ITP-002-B (EnqueueEmitter rejects malformed payloads before publish)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-002 performs input validation and does not publish malformed events to EventBridge.

- **Integration Scenario: ITS-002-B1**
    - **Given** Module ARCH-001 sends a payload with missing `requestedAt` field to ARCH-002
    - **When** Module ARCH-002 validates the event payload at its boundary
    - **Then** Module ARCH-002 rejects the payload and returns an error to ARCH-001 without publishing to EventBridge

---

### Module Verification: ARCH-003 (FetchQueueRouter)

**Parent System Components**: SYS-002, SYS-003, SYS-004

#### Test Case: ITP-003-A (FetchQueueRouter inserts FoodRequested events into the single demand-weighted Postgres `fetch_queue`)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-003 correctly accepts direct enqueues from ARCH-001/`EnqueueEmitter` — both single-food cache-miss (`publishFoodRequested`) and batch (`publishFoodBatchRequested`) — as rows in the single Postgres `fetch_queue` (with distinct-requester demand recorded in `fetch_requesters`, plus `NOTIFY`). The demand path is a direct `INSERT … ON CONFLICT` + `pg_notify` — **not** an EventBridge event. There is no high/low priority tier — every row lands in the one `fetch_queue` ordered purely by demand (`request_count DESC, first_requested ASC`); a high-demand single lookup sorts ahead of a low-demand batch row only because of its higher distinct-requester `request_count`, not a priority column.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-001 resolves a single-food cache miss for one fdcId and invokes `EnqueueEmitter.publishFoodRequested` (after `admitEnqueue` admission)
    - **When** Module ARCH-003 performs the enqueue — upsert `(fdc_id, sub)` into `fetch_requesters` (ON CONFLICT DO NOTHING) then `INSERT INTO fetch_queue` with the capped distinct-requester `request_count` + `NOTIFY`
    - **Then** The handshake between ARCH-003 and the Postgres `fetch_queue` completes with the row committed and a `LISTEN/NOTIFY` signal emitted, and the ARCH-004 Fargate consumer worker leases the highest-demand row from `fetch_queue`

- **Integration Scenario: ITS-003-A2**
    - **Given** ARCH-001 resolves a batch cache miss (multiple fdcIds) and invokes `EnqueueEmitter.publishFoodBatchRequested` (after `admitEnqueue` admission)
    - **When** Module ARCH-003 performs the batch enqueue (per-id `fetch_requesters` upsert + `INSERT INTO fetch_queue`)
    - **Then** The handshake between ARCH-003 and the Postgres `fetch_queue` completes with the low-demand rows committed (`request_count` 0–1), which sort after high-demand rows under the demand-weighted ordering

#### Test Case: ITP-003-B (FetchQueueRouter tombstone handshake on persistent enqueue/processing failure)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-003 marks rows as tombstones (`status='tombstone'`) per FR-016 retry semantics when the `fetch_queue` row cannot be processed (≤5 attempts with exponential backoff, then tombstone; a 404 from USDA tombstones immediately).

- **Integration Scenario: ITS-003-B1**
    - **Given** A `fetch_queue` row has exhausted its retry budget (5 attempts, exponential backoff) under FR-016
    - **When** Module ARCH-003 / the consumer worker reaches the terminal retry for the row
    - **Then** The row is transitioned to `status='tombstone'` and the failure is recorded (no further leasing of that row)

---

### Module Verification: ARCH-004 (FoodConsumerService)

**Parent System Components**: SYS-005

#### Test Case: ITP-004-A (FoodConsumerService→RollingWindowLimiter contract before USDA call)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-004 always calls ARCH-005's `checkAndRecord()` (count the trailing-60-min USDA calls and atomically record the new one) before invoking ARCH-008, and that the rolling-window result gates the USDA API call.

- **Integration Scenario: ITS-004-A1**
    - **Given** Module ARCH-005 (RollingWindowLimiter) returns `{ allowed: true, windowCount: 500 }` to ARCH-004 (trailing-60-min count well below the 900 pause threshold; the new call is recorded)
    - **When** Module ARCH-004 sends `checkAndRecord()` to ARCH-005 before processing a leased `fetch_queue` row
    - **Then** Module ARCH-004 proceeds to invoke ARCH-008 (`fetchFoods([12345])`) and does not extend the row lease (FR-018) on the `fetch_queue` row

- **Integration Scenario: ITS-004-A2**
    - **Given** Module ARCH-005 returns `{ allowed: false, paused: true, windowCount: 900 }` to ARCH-004 (trailing-60-min count at the 90% pause threshold; no new call recorded)
    - **When** Module ARCH-004 sends `checkAndRecord()` to ARCH-005
    - **Then** Module ARCH-004 pauses draining — releases / re-leases the `fetch_queue` row (extends the row lease per FR-018/FR-021 so it becomes visible again once earlier calls age out of the window) and does NOT invoke ARCH-008

#### Test Case: ITP-004-B (FoodConsumerService data flow: `fetch_queue`→USDA→PostgreSQL→cache)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the end-to-end data transformation chain from `fetch_queue` row lease through USDA API fetch, PostgreSQL upsert, and cache invalidation across module boundaries.

- **Integration Scenario: ITS-004-B1**
    - **Given** Module ARCH-004 (Fargate consumer worker) leases the highest-demand `fetch_queue` row `{ fdcId: 12345 }` and ARCH-005 allows the call (trailing-60-min count below the pause threshold; the call is recorded against the rolling window)
    - **When** Module ARCH-004 sends `fetchFoods([12345])` to ARCH-008, receives `USDAFoodResponse[]`, then sends `upsertFood(food)` to ARCH-006, then sends `invalidate(12345)` and `clearPending(12345)` to ARCH-007
    - **Then** The data transformation chain completes: ARCH-006 persists the food record, ARCH-007 clears the cache entry, and ARCH-004 marks the `fetch_queue` row done (deletes/completes the leased row)

#### Test Case: ITP-004-C (FoodConsumerService retry with exponential backoff on USDA error)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-004 applies the FR-016 retry semantics (≤5 attempts, exponential backoff, then tombstone) when ARCH-008 returns an error, without completing the `fetch_queue` row.

- **Integration Scenario: ITS-004-C1**
    - **Given** Module ARCH-008 returns a `500 Server Error` to ARCH-004 on first invocation
    - **When** Module ARCH-004 receives the error from ARCH-008
    - **Then** Module ARCH-004 does NOT complete the `fetch_queue` row, increments the attempt count and applies exponential backoff (FR-016), and the row's lease (FR-018) expires so it becomes visible again for retry

---

### Module Verification: ARCH-005 (RollingWindowLimiter)

**Parent System Components**: SYS-006 `[CROSS-CUTTING]`

#### Test Case: ITP-005-A (RollingWindowLimiter atomic count-and-record under concurrent Fargate consumer worker invocations)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-005's atomic count-and-record on the `usda_call_log` (Postgres `INSERT ... WHERE (SELECT count over trailing 60 min) < cap RETURNING`; deferred Redis variant: a sorted-set Lua script over `ZCOUNT`) counts the trailing-60-min calls and records the new one in one atomic step when multiple ARCH-004 instances invoke `checkAndRecord()` simultaneously, ensuring no more than 1,000 USDA calls occur in any trailing 60 minutes (FR-019/FR-020, SC-002).

- **Integration Scenario: ITS-005-A1**
    - **Given** Module ARCH-005's `usda_call_log` already holds 999 calls within the trailing 60 minutes (one slot below the 1,000 cap) and two ARCH-004 instances simultaneously send `checkAndRecord()`
    - **When** Both ARCH-004 instances invoke ARCH-005's `checkAndRecord()` concurrently
    - **Then** Exactly one ARCH-004 instance receives `{ allowed: true, windowCount: 1000 }` (its call is recorded) and the other receives `{ allowed: false, windowCount: 1000 }` (the 1,001st call in the window is blocked) — the cap is never breached and no call is double-recorded

- **Integration Scenario: ITS-005-A2**
    - **Given** Module ARCH-005's `usda_call_log` is empty for the trailing 60 minutes (count 0) and 1,500 concurrent ARCH-004 invocations each call `checkAndRecord()`
    - **When** All 1,500 invocations execute the atomic count-and-record against ARCH-005 simultaneously
    - **Then** Exactly 1,000 invocations receive `{ allowed: true }` (recorded into the window) and the remaining 500 receive `{ allowed: false }` — the trailing-60-min window is atomically capped at 1,000

#### Test Case: ITP-005-B (RollingWindowLimiter→call-log-store interface fault on store unavailability)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-005 propagates a call-log-store unavailability error (Postgres `usda_call_log` by default; deferred Redis sorted-set variant) to ARCH-004 in a way that causes ARCH-004 to fail safely (not call USDA API) — the limiter fails closed rather than assuming an empty window.

- **Integration Scenario: ITS-005-B1**
    - **Given** The `usda_call_log` store is unavailable when ARCH-004 sends `checkAndRecord()` to ARCH-005
    - **When** Module ARCH-005 attempts the atomic count-and-record against the store
    - **Then** Module ARCH-005 returns an error to ARCH-004, and ARCH-004 does NOT invoke ARCH-008 (USDA API call is blocked)

---

### Module Verification: ARCH-006 (FoodPostgresRepository)

**Parent System Components**: SYS-007

#### Test Case: ITP-006-A (FoodPostgresRepository upsert contract with FoodConsumerService)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-006 correctly accepts `FoodData` from ARCH-004 via `upsertFood()` and persists it, returning `{ success: boolean }` as specified in the interface contract.

- **Integration Scenario: ITS-006-A1**
    - **Given** Module ARCH-004 has a valid `USDAFoodResponse` parsed into `FoodData` format
    - **When** Module ARCH-004 sends `upsertFood(food)` to ARCH-006
    - **Then** Module ARCH-006 persists the record to PostgreSQL and returns `{ success: true }` to ARCH-004

- **Integration Scenario: ITS-006-A2**
    - **Given** Module ARCH-001 sends `findByFdcId(12345)` to ARCH-006 for a food with `fetch_status='fetched'`
    - **When** Module ARCH-006 queries PostgreSQL
    - **Then** Module ARCH-006 returns the full `FoodData` object to ARCH-001 with all required fields (`fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`)

#### Test Case: ITP-006-B (FoodPostgresRepository data flow: full-text search boundary)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-006 correctly transforms a search query string from ARCH-001 into a PostgreSQL full-text/trigram query and returns `FoodData[]`.

- **Integration Scenario: ITS-006-B1**
    - **Given** Module ARCH-001 sends `searchFoods('chicken breast')` to ARCH-006
    - **When** Module ARCH-006 executes the pg_trgm/tsvector query against PostgreSQL
    - **Then** Module ARCH-006 returns `FoodData[]` to ARCH-001 with results ranked by relevance

#### Test Case: ITP-006-C (FoodPostgresRepository connection error propagation)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-006 propagates PostgreSQL connection errors to callers (ARCH-001, ARCH-004) without swallowing them.

- **Integration Scenario: ITS-006-C1**
    - **Given** PostgreSQL is unavailable when ARCH-004 sends `upsertFood(food)` to ARCH-006
    - **When** Module ARCH-006 attempts the database operation
    - **Then** Module ARCH-006 returns a connection error to ARCH-004, and ARCH-004 does NOT complete the `fetch_queue` row (its lease expires, enabling retry per FR-016)

---

### Module Verification: ARCH-007 (FoodCacheService)

**Parent System Components**: SYS-008

#### Test Case: ITP-007-A (FoodCacheService cache-through data flow: ARCH-001→ARCH-007→ARCH-006)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the cache-through data flow where ARCH-001 queries ARCH-007 first, falls through to ARCH-006 on miss, and the result flows back through ARCH-007 to ARCH-001.

- **Integration Scenario: ITS-007-A1**
    - **Given** Module ARCH-007 returns `null` from `get(12345)` (Redis miss) and ARCH-006 returns a `FoodData` record
    - **When** Module ARCH-001 sends `get(12345)` to ARCH-007, then `findByFdcId(12345)` to ARCH-006
    - **Then** The data flows from ARCH-006 → ARCH-001 → `200 OK` response, and ARCH-007 is not populated (cache-through does not auto-populate on read miss)

#### Test Case: ITP-007-B (FoodCacheService pending_fetch deduplication under concurrent ARCH-001 requests)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-007's `pending_fetch` set (in-process/Postgres by default; deferred Redis variant) prevents duplicate `fetch_queue` rows when multiple ARCH-001 instances concurrently request the same uncached food.

- **Integration Scenario: ITS-007-B1**
    - **Given** Two concurrent ARCH-001 instances both receive cache miss for `fdcId=12345` and both call `isPending(12345)` on ARCH-007 simultaneously
    - **When** Both ARCH-001 instances invoke `markPending(12345)` on ARCH-007 (SADD to pending_fetch set)
    - **Then** Exactly one ARCH-001 instance proceeds to call ARCH-002 (`publishFoodRequested`); the second receives `isPending=true` and returns `202 Accepted` without publishing

#### Test Case: ITP-007-C (FoodCacheService cache invalidation handshake with FoodConsumerService)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-004 correctly calls ARCH-007's `invalidate()` and `clearPending()` after a successful USDA fetch and PostgreSQL upsert.

- **Integration Scenario: ITS-007-C1**
    - **Given** Module ARCH-004 has successfully upserted food data into ARCH-006
    - **When** Module ARCH-004 sends `invalidate(12345)` then `clearPending(12345)` to ARCH-007
    - **Then** Module ARCH-007 removes `food:12345` from Redis and removes `12345` from the `pending_fetch` set, returning `void` to ARCH-004

#### Test Case: ITP-007-D (FoodCacheService Redis unavailability fault propagation)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-007 propagates Redis unavailability errors to ARCH-001 so that ARCH-001 can fall through to ARCH-006 rather than failing the request.

- **Integration Scenario: ITS-007-D1**
    - **Given** Redis is unavailable when ARCH-001 sends `get(12345)` to ARCH-007
    - **When** Module ARCH-007 attempts the Redis GET operation
    - **Then** Module ARCH-007 returns an error/null to ARCH-001, and ARCH-001 falls through to ARCH-006 (`findByFdcId`) rather than returning a 503

---

### Module Verification: ARCH-008 (UsdaApiClient)

**Parent System Components**: SYS-009

#### Test Case: ITP-008-A (UsdaApiClient→USDA API contract: batch request and response parsing)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-008 correctly sends batch requests (up to 20 fdcIds) to the USDA FoodData Central API and parses `USDAFoodResponse[]` for ARCH-004.

- **Integration Scenario: ITS-008-A1**
    - **Given** Module ARCH-004 sends `fetchFoods([12345, 67890])` to ARCH-008 with a valid API key from ARCH-010
    - **When** Module ARCH-008 sends an HTTP POST to the USDA API with the fdcId batch
    - **Then** Module ARCH-008 receives a valid USDA response and returns `USDAFoodResponse[]` to ARCH-004 with all requested foods

#### Test Case: ITP-008-B (UsdaApiClient error classification and propagation)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-008 correctly classifies USDA API errors (401, 429, 500) and propagates them to ARCH-004 in a way that enables appropriate retry behavior.

- **Integration Scenario: ITS-008-B1**
    - **Given** The USDA API returns `429 Too Many Requests` to ARCH-008
    - **When** Module ARCH-008 receives the 429 response
    - **Then** Module ARCH-008 returns a rate-limit error to ARCH-004, and ARCH-004 applies exponential backoff (FR-016) without completing the `fetch_queue` row

- **Integration Scenario: ITS-008-B2**
    - **Given** The USDA API returns `401 Unauthorized` to ARCH-008 (invalid API key)
    - **When** Module ARCH-008 receives the 401 response
    - **Then** Module ARCH-008 returns an authentication error to ARCH-004, classified distinctly from transient errors

---

### Module Verification: ARCH-009 (WebSocketNotifier)

**Parent System Components**: SYS-010 `[CROSS-CUTTING]`

#### Test Case: ITP-009-A (WebSocketNotifier→API Gateway WebSocket contract for FoodDataReceived events)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-009 correctly receives `FoodDataReceived` events from EventBridge and pushes notifications to connected clients via the API Gateway WebSocket API boundary.

- **Integration Scenario: ITS-009-A1**
    - **Given** EventBridge delivers a `FoodDataReceived` event `{ fdcId: 12345, foodData: FoodData }` to ARCH-009
    - **When** Module ARCH-009 invokes `notifyClients(12345, foodData)` against the API Gateway WebSocket API
    - **Then** Module ARCH-009 returns the count of clients notified to the EventBridge invocation context (fire-and-forget; WebSocket connection errors do not propagate as failures)

#### Test Case: ITP-009-B (WebSocketNotifier graceful handling of WebSocket connection errors)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 handles WebSocket connection errors gracefully (fire-and-forget) without failing the EventBridge invocation.

- **Integration Scenario: ITS-009-B1**
    - **Given** All connected WebSocket clients have disconnected before ARCH-009 receives the `FoodDataReceived` event
    - **When** Module ARCH-009 attempts `notifyClients(12345, foodData)` against the API Gateway WebSocket API
    - **Then** Module ARCH-009 returns `0` clients notified without throwing an error to EventBridge

---

### Module Verification: ARCH-010 (SecretManager)

**Parent System Components**: SYS-011 `[CROSS-CUTTING]`

#### Test Case: ITP-010-A (SecretManager→AWS Secrets Manager contract: API key retrieval for ARCH-008)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-010 correctly retrieves the USDA API key from AWS Secrets Manager and provides it to ARCH-008 (injected as Lambda environment variable at cold start), and that the key is never exposed in logs.

- **Integration Scenario: ITS-010-A1**
    - **Given** AWS Secrets Manager holds a valid USDA API key secret
    - **When** Module ARCH-010 invokes `getUsdaApiKey()` during Lambda cold start
    - **Then** Module ARCH-010 returns the API key string to the Lambda environment, and the key value does NOT appear in any ARCH-011 (MonitoringLogger) log output

#### Test Case: ITP-010-B (SecretManager fault propagation on secret not found)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 propagates a "secret not found" error to the Lambda initialization context, preventing ARCH-008 from making unauthenticated USDA API calls.

- **Integration Scenario: ITS-010-B1**
    - **Given** AWS Secrets Manager does not contain the expected USDA API key secret
    - **When** Module ARCH-010 invokes `getUsdaApiKey()`
    - **Then** Module ARCH-010 returns a "Secret not found" error to the Lambda initialization context, and ARCH-008 is not invoked

---

### Module Verification: ARCH-011 (MonitoringLogger)

**Parent System Components**: SYS-012 `[CROSS-CUTTING]`

#### Test Case: ITP-011-A (MonitoringLogger structured log contract with ARCH-001 and ARCH-004)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011 correctly accepts structured JSON log entries from ARCH-001 and ARCH-004 via `logRequest()`, including `requestId` correlation, and emits them to CloudWatch without dropping fields.

- **Integration Scenario: ITS-011-A1**
    - **Given** Module ARCH-001 processes a `GET /v1/foods/12345` request with `requestId='req-abc'`
    - **When** Module ARCH-001 sends `logRequest('req-abc', { path: '/v1/foods/12345', status: 200 }, 45)` to ARCH-011
    - **Then** Module ARCH-011 emits a structured JSON log entry to CloudWatch containing `requestId`, `path`, `status`, and `duration` fields — no fields are dropped

#### Test Case: ITP-011-B (MonitoringLogger metric emission contract: queue depth and trailing-60-min USDA call count)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-011 correctly receives metric data from ARCH-004 and ARCH-005 and emits CloudWatch metrics for queue depth and the trailing-60-min USDA call count (rolling-window utilization).

- **Integration Scenario: ITS-011-B1**
    - **Given** Module ARCH-004 processes a `fetch_queue` row and ARCH-005 returns `{ allowed: true, windowCount: 750 }` (750 USDA calls in the trailing 60 minutes)
    - **When** Module ARCH-004 sends `incrementMetric('usda_calls_trailing_60min', 750)` to ARCH-011
    - **Then** Module ARCH-011 emits the metric to CloudWatch with the correct namespace and value (so rolling-window compliance — never >1,000 in any trailing hour — is verifiable per SC-002)

#### Test Case: ITP-011-C (MonitoringLogger X-Ray trace boundary handshake)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011's `startTrace(reqId)` correctly opens an X-Ray segment that spans the ARCH-001→ARCH-007→ARCH-006 call chain.

- **Integration Scenario: ITS-011-C1**
    - **Given** Module ARCH-001 begins processing a food lookup request
    - **When** Module ARCH-001 sends `startTrace('req-abc')` to ARCH-011
    - **Then** Module ARCH-011 returns a `Segment` object to ARCH-001, and the segment is visible in X-Ray with the correct `requestId` correlation

---

### Module Verification: ARCH-012 (FoodAuthGuard)

**Parent System Components**: SYS-013
**Modules Under Test**: MOD-012 (ClerkAuthMiddleware), MOD-013 (DemotionAndFairness), MOD-014 (AsyncProducerAuthz)
**Requirements**: REQ-037, REQ-038, REQ-039, REQ-040 (split: REQ-040a per-item partial batch / REQ-040b queue-depth + `503`), REQ-041, REQ-042, REQ-043, REQ-044

> ARCH-012 is wired into the route stack **in front of** ARCH-001 (every HTTP route) and ARCH-009 (`$connect`). These tests verify the seam: the auth guard either admits a request to the downstream handler with an `AuthenticatedCaller`, or fails closed before any downstream module boundary (ARCH-002 publish / ARCH-003 enqueue / ARCH-008 USDA call) is crossed.

#### Test Case: ITP-012-A (FoodAuthGuard rejects unauthenticated requests before any enqueue or USDA call)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies end-to-end that a request with no/invalid token is rejected with `401` by ARCH-012 before the ARCH-002 (EnqueueEmitter) and ARCH-003 (FetchQueueRouter) boundaries are crossed — no fetch is enqueued and no ARCH-008 (USDA) call is made (REQ-037, SC-010).

- **Integration Scenario: ITS-012-A1**
    - **Given** Module ARCH-012 fronts ARCH-001, with `verifyToken` stubbed to throw on the supplied token, and spies attached to ARCH-002 `publishFoodRequested` and ARCH-003 `enqueue`
    - **When** A `GET /v1/foods/12345` request with no `Authorization` header reaches the route stack (cache miss path)
    - **Then** ARCH-012 returns `401 Unauthorized` to the caller; the ARCH-001 handler is never invoked; ARCH-002 `publishFoodRequested` and ARCH-003 `enqueue` receive **zero** calls; no ARCH-008 USDA call is made

- **Integration Scenario: ITS-012-A2**
    - **Given** Module ARCH-012 fronts ARCH-009 `$connect`, with `verifyToken` stubbed to reject a token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`
    - **When** A WebSocket `$connect` is attempted with the wrong-`azp` token presented via the `Sec-WebSocket-Protocol` subprotocol
    - **Then** ARCH-012 rejects the handshake with the pinned `403` `$connect` status before the connection is established and before any `fetch_requesters` subscription row is written (REQ-043)

#### Test Case: ITP-012-B (FoodAuthGuard accepts a Clerk M2M service token)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that a server-to-server caller presenting a valid Clerk machine (M2M) token whose `azp` is in the authorized-parties allowlist is admitted (not forced to `401`), and the downstream handler receives an `AuthenticatedCaller` carrying a service identity (REQ-041, A-012).

- **Integration Scenario: ITS-012-B1**
    - **Given** Module ARCH-012 with `verifyToken` stubbed to resolve `{ sub: 'svc_meal_planning', azp: 'https://meal.commise.app', public_metadata: {} }` for a valid M2M token in `CLERK_AUTHORIZED_PARTIES`
    - **When** Downstream service 006 (meal-planning) sends `GET /v1/foods/12345` with the M2M Bearer token to the route stack
    - **Then** ARCH-012 admits the request and hands ARCH-001 an `AuthenticatedCaller` with `isService=true` and `sub='svc_meal_planning'`; the handler proceeds to the normal cache-lookup path (no `401`)

#### Test Case: ITP-012-C (DemotionAndFairness — one `sub` is demoted, not rejected, and cannot starve others)

**Technique**: Interface Contract Testing + Concurrency & Race Condition Testing
**Target View**: Interface View + Process View
**Description**: Verifies the seam between ARCH-012 (MOD-013) and the ARCH-003 enqueue boundary under fairness-by-demotion (FR-043, SC-012, revised 2026-06-20): when a single authenticated `sub` scripts cache-miss lookups past the `DEMOTE_THRESHOLD = 50` per-`sub` PENDING-count trigger (i.e. **more than 50 items currently pending**), its requests are **still accepted and enqueued** (`202`, **no `429`**, never rejected for a personal limit) but its queued items are ranked to the **back** of the priority order so they cannot starve other users; a concurrent low-pending `sub` keeps draining at normal priority — and the heavy `sub` still drains on spare capacity (work-conserving). Demotion is dynamic and is gated on the count exceeding 50, not reaching it: at exactly 50 pending the `sub` is **not** demoted, and once the heavy `sub`'s pending count falls back to 50 or below its items return to normal priority.

- **Integration Scenario: ITS-012-C1**
    - **Given** Module ARCH-012's `fetch_queue` + `fetch_requesters` state is seeded so `sub='user_greedy'` already has **more than 50 items pending**, with a spy on ARCH-003 `enqueue` and visibility into the drain-time priority ordering
    - **When** `user_greedy` issues more cache-miss `GET /v1/foods/{fdcId}` lookups for not-yet-cached `fdcId`s
    - **Then** ARCH-012 returns `202 Accepted` (**not `429`**), ARCH-003 `enqueue` **is** invoked for each request, but those rows are ranked to the **back** of the priority order (below FR-015 demand ordering); a concurrent `sub='user_other'` (under 50 pending) is enqueued at normal priority and drains ahead — one account cannot starve the shared USDA budget for others

- **Integration Scenario: ITS-012-C2**
    - **Given** `sub='user_greedy'`'s pending count later drops below 50 as its back-ranked items drain on spare capacity
    - **When** `user_greedy` issues another cache-miss lookup, and the consumer recomputes priority at drain time from live `fetch_queue` + `fetch_requesters` state
    - **Then** the `sub`'s newly enqueued items are scored at **normal** priority again (dynamic re-promotion — the scorer reads live state, not a frozen demotion flag), confirming the demotion is reversible and work-conserving (FR-043/SC-012)

- **Integration Scenario: ITS-012-C3**
    - **Given** Module ARCH-012's `fetch_queue` + `fetch_requesters` state is seeded so `sub='user_edge'` has **exactly 50 items pending** (`DEMOTE_THRESHOLD = 50`, the boundary at the trigger value), with a spy on ARCH-003 `enqueue` and visibility into the drain-time priority ordering
    - **When** `user_edge` issues another cache-miss `GET /v1/foods/{fdcId}` lookup for a not-yet-cached `fdcId`
    - **Then** ARCH-012 returns `202 Accepted`, ARCH-003 `enqueue` **is** invoked, and the row is scored at **normal** priority (NOT back-ranked) — at exactly 50 pending the `sub` is **not** demoted; demotion is gated on the count exceeding 50, confirming the boundary is `> 50`, not `>= 50` (FR-043/SC-012)

#### Test Case: ITP-012-D (FoodAuthGuard fails closed with 503 on queue backpressure / open circuit)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that when the `fetch_queue` exceeds its enforced maximum depth, or the USDA circuit breaker is open, an authenticated enqueue attempt fails closed with `503` rather than growing the queue unbounded. **This scenario verifies FR-046** (queue backpressure ceiling + enforced circuit breaker → `503`), wired through ARCH-012 (REQ-040b — the queue-depth/`503` backpressure split of REQ-040). This system-wide `503` backstop is distinct from per-`sub` demotion (FR-043), which never rejects; and the hard batch-size `400` of FR-045 is a _distinct_ gate verified separately by ITP-012-G (REQ-040a) — neither must be conflated with this `503` backpressure path.

- **Integration Scenario: ITS-012-D1**
    - **Given** Module ARCH-012 (MOD-013) is configured with `MAX_QUEUE_DEPTH`, and the ARCH-003 queue-depth probe is stubbed to report depth above the ceiling (or the circuit breaker reports `open`)
    - **When** An authenticated cache-miss request reaches the enqueue gate
    - **Then** ARCH-012 returns `503 Service Unavailable` and ARCH-003 `enqueue` receives zero calls — the queue is not grown past its bound; recovery drains with jitter (no thundering herd)

#### Test Case: ITP-012-E (Async-path provenance — only authorized principals drive consumption)

**Technique**: Interface Contract Testing
**Target View**: Interface View + Process View
**Description**: Verifies that the async producer→consumer seam preserves US-0: ARCH-004 (FoodConsumerService) validates event provenance, so a `FoodRequested`/`FoodBatchRequested` event not originating from a named, least-privilege principal is not processed into a USDA call (REQ-042 / FR-048).

- **Integration Scenario: ITS-012-E1**
    - **Given** ARCH-004 (Fargate consumer worker) leases rows from the Postgres `fetch_queue` with provenance validation enabled, and an event arrives without the authorized internal-principal provenance marker (e.g. forged/unsigned source)
    - **When** ARCH-004 processes the leased `fetch_queue` row
    - **Then** ARCH-004 rejects the row (tombstones it — `status='tombstone'` — or drops it) and does **not** invoke ARCH-005 (rate limiter) or ARCH-008 (USDA API) — every accepted fetch traces to an `AuthenticatedCaller` or an authorized internal principal

- **Integration Scenario: ITS-012-E2**
    - **Given** ARCH-004 receives a well-formed `FoodRequested` event whose provenance marker identifies a named least-privilege producer principal
    - **When** ARCH-004 processes the record
    - **Then** ARCH-004 accepts it and proceeds to the ARCH-005 rolling-window check-and-record → ARCH-008 USDA fetch path — the synchronous auth guarantee extends to the async edge

#### Test Case: ITP-012-F (FoodAuthGuard scope gate and 401→403→400 status precedence through the route stack)

**Technique**: Interface Contract Testing + Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the module-seam behavior of the scope gate and the status-precedence ordering as wired through the route stack in front of ARCH-001. An authenticated token that lacks the required operational scope is rejected with `403` (distinct from the `401` unauthenticated case), and the full precedence chain `401 → 403 → 400` is exercised end-to-end: a bad token always wins over a malformed body (`401`), a valid-but-unscoped token wins over a malformed body (`403`), and only a valid + scoped token surfaces the input-validation error (`400`). This is the integration counterpart to the unit-level UTP-012-D; it asserts the guard fails closed before the ARCH-002 publish / ARCH-003 enqueue / ARCH-008 USDA boundaries on the `401` and `403` paths (REQ-038, REQ-044, FR-051).

- **Integration Scenario: ITS-012-F1**
    - **Given** Module ARCH-012 fronts an operational endpoint (`POST /v1/foods/{fdcId}/refetch`, requiring scope `'foods:refetch'`), with `verifyToken` stubbed to resolve `{ sub: 'user_plain', azp: <authorized>, public_metadata: {} }` (valid token, **no** operational scope), and spies attached to ARCH-002 `publishFoodRequested` and ARCH-003 `enqueue`
    - **When** `user_plain` sends the refetch request with the valid-but-unscoped Bearer token to the route stack
    - **Then** ARCH-012 returns `403 Forbidden` to the caller — distinct from the unauthenticated `401`; the ARCH-001 handler is never invoked; ARCH-002 `publishFoodRequested` and ARCH-003 `enqueue` receive **zero** calls; no ARCH-008 USDA call is made

- **Integration Scenario: ITS-012-F2**
    - **Given** Module ARCH-012 fronts the same operational endpoint, with `verifyToken` stubbed to **throw**, and a request body that is also malformed (e.g. non-JSON / invalid `fdcId`)
    - **When** The request reaches the route stack with both a bad token and a malformed body
    - **Then** ARCH-012 returns `401 Unauthorized` — the auth seam runs before input validation, so `401` wins over the would-be `400`; ARCH-001 validation is never reached and no downstream boundary is crossed (precedence step 1: `401 > 400`)

- **Integration Scenario: ITS-012-F3**
    - **Given** Module ARCH-012 fronts the same operational endpoint, with `verifyToken` stubbed to resolve a **valid but unscoped** caller (`public_metadata: {}`), and the same malformed request body
    - **When** The request reaches the route stack with a valid-but-unscoped token and a malformed body
    - **Then** ARCH-012 returns `403 Forbidden` — the scope gate runs before ARCH-001 input validation, so `403` wins over the would-be `400`; no downstream boundary is crossed (precedence step 2: `403 > 400`)

- **Integration Scenario: ITS-012-F4**
    - **Given** Module ARCH-012 fronts the same operational endpoint, with `verifyToken` stubbed to resolve a caller holding `public_metadata.scopes: ['foods:refetch']`, and a malformed request body
    - **When** The request reaches the route stack with a valid + scoped token and a malformed body
    - **Then** ARCH-012 **admits** the request to ARCH-001, which performs input validation and returns `400 Bad Request` for the malformed body — only once auth (`401`) and scope (`403`) both pass does the input-validation `400` surface (precedence step 3: `400` reached last)

#### Test Case: ITP-012-G (DemotionAndFairness — oversized batch → `400` at the enqueue gate; accepted batch → per-item partial)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the module-seam behavior of the hard batch-size cap (MOD-013, FR-045): a `POST /v1/foods/batch` carrying more than the bound (100) `fdcId`s is rejected with `400 Bad Request` at the ARCH-012 enqueue gate **before** the ARCH-003 enqueue boundary is crossed — distinct from the FR-046 `503` backpressure path of ITP-012-D. For an accepted batch mixing cached and uncached ids, the seam returns a **per-item partial result** — cached/stale foods inline and each miss as a `pending` entry whose fetch is enqueued (subject to the same demotion fairness, FR-043, not a per-user quota). This is the integration counterpart to the unit-level UTP-012-F/UTP-001-H; it asserts the batch cap fails closed at the seam so an oversized batch cannot enqueue partial work (REQ-040a — the per-item partial-batch split of REQ-040, FR-045).

- **Integration Scenario: ITS-012-G1**
    - **Given** Module ARCH-012 (MOD-013) is configured with `MAX_BATCH = 100`, with a spy on ARCH-003 `enqueue`
    - **When** An authenticated caller sends `POST /v1/foods/batch` with `101` `fdcId`s (over the cap) to the route stack
    - **Then** ARCH-012 returns `400 Bad Request` to the caller; ARCH-003 `enqueue` receives **zero** calls; no ARCH-008 USDA call is made — the oversized batch is rejected whole at the seam (no partial enqueue)

- **Integration Scenario: ITS-012-G2**
    - **Given** Module ARCH-012 (MOD-013) with `MAX_BATCH = 100`, spy on ARCH-003 `enqueue`, and a batch of exactly `100` `fdcId`s mixing cached ids and cache-miss ids
    - **When** The same authenticated caller sends `POST /v1/foods/batch` with those `100` `fdcId`s (at the cap)
    - **Then** ARCH-012 admits the request and returns a **per-item partial** response — cached foods inline and each miss as a `pending` entry — and ARCH-003 `enqueue` is invoked once per miss (each subject to demotion fairness, FR-043, not a per-user quota); this confirms the `400` branch is the batch ceiling, not an always-reject (boundary at-limit accepted)

#### Test Case: ITP-012-H (Consumer-Driven Contract — M2M service-token seam and async-producer provenance seam)

**Technique**: Consumer-Driven Contract Testing (CDCT)
**Target View**: Interface View + Process View
**Description**: Verifies the two server-to-server seams via **consumer-published pacts** (not provider-authored stubs): (1) the **M2M token seam** — a downstream consumer service (006 meal-planning) publishes a contract describing the request it sends (`GET /v1/foods/{fdcId}` with a Clerk M2M Bearer whose `azp` is in `CLERK_AUTHORIZED_PARTIES`) and the responses it depends on (`200` admitted, `401` on missing/invalid M2M token), and ARCH-012 (provider) is verified against that published expectation (REQ-041, FR-047, A-012); and (2) the **async-producer provenance seam** — the producer (recipe-import / stale-refresh internal principal) publishes a contract for the `FoodRequested`/`FoodBatchRequested` event it emits, including the authorized-principal provenance marker (`requestedBy`), and ARCH-004 (consumer) is verified to accept only events satisfying that pact and reject (tombstone — `status='tombstone'`) events lacking it (REQ-042, FR-048). Consumer expectations are validated against the provider contract **before** integration deployment, catching drift the provider's own stubs would miss.

- **Integration Scenario: ITS-012-H1**
    - **Given** Downstream service 006 (meal-planning), as **consumer**, publishes a pact: "I send `GET /v1/foods/12345` with a valid Clerk **M2M** Bearer token whose `azp` is in `CLERK_AUTHORIZED_PARTIES`, and I expect `200 OK` with the cache-hit `FoodData` shape; if my token is missing/expired I expect `401`"
    - **When** ARCH-012 (provider) is replayed against the consumer's published pact with `verifyToken` resolving the M2M claim set (`isService=true`, `sub='svc_meal_planning'`) for the valid case and throwing for the missing-token case
    - **Then** The provider satisfies the contract: the valid M2M request is admitted to the ARCH-001 cache-lookup path (not `401`) and the missing-token request yields `401` — the M2M consumer's expectations are honored, and any provider-side change that would `401` a valid M2M token fails this CDCT check before deploy

- **Integration Scenario: ITS-012-H2**
    - **Given** The internal recipe-import producer principal, as **consumer of the async seam**, publishes a pact for the event it emits: "I publish `FoodRequested` carrying a `requestedBy` provenance marker identifying my named least-privilege principal; a consumer MUST accept it, and MUST reject any `FoodRequested` lacking that marker"
    - **When** ARCH-004 (provider/consumer of the queue) is verified against the published event pact with one event carrying the authorized provenance marker and one forged/unsigned event lacking it
    - **Then** ARCH-004 accepts the marked event and proceeds to the ARCH-005 → ARCH-008 path, and tombstones the unmarked event's `fetch_queue` row (`status='tombstone'`) without invoking ARCH-005 or ARCH-008 — the async-edge provenance contract (US-0 on internal producers) is verified consumer-first, not via a provider-authored stub

---

## Test Harness & Mocking Strategy

| Test Case | External Dependency                                                                            | Mock/Stub Strategy                                                                                                                    | Rationale                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ITP-001-A | ARCH-007 (Redis)                                                                               | In-memory Redis stub (ioredis-mock)                                                                                                   | Isolates ARCH-001↔ARCH-007 boundary without real Redis                                                                                         |
| ITP-001-B | ARCH-002 (EventBridge)                                                                         | Spy on publishFoodRequested — assert zero calls                                                                                       | Verifies no downstream boundary is crossed on invalid input                                                                                    |
| ITP-001-C | ARCH-007 (Redis pending set)                                                                   | In-memory Redis stub with pre-seeded pending_fetch set                                                                                | Simulates deduplication state                                                                                                                  |
| ITP-001-D | ARCH-006 (`stale` record); ARCH-002                                                            | DB stub returns a `stale` record; spy on `publishFoodRequested`                                                                       | Verifies stale-while-revalidate: serve stale `200` + enqueue re-fetch; serve indefinitely on repeated failure                                  |
| ITP-001-E | ARCH-006 (`not_found` tombstone w/ controlled age); ARCH-002                                   | DB stub returns a tombstone within / past the 30-day TTL; spy on `publishFoodRequested`                                               | Verifies tombstone TTL: within TTL → `404` no enqueue; after TTL → re-attempt                                                                  |
| ITP-002-A | EventBridge default bus                                                                        | AWS SDK mock (aws-sdk-mock / jest mock)                                                                                               | Avoids real EventBridge calls; verifies payload schema                                                                                         |
| ITP-002-B | EventBridge default bus                                                                        | AWS SDK mock — assert PutEvents not called                                                                                            | Verifies validation gate before publish                                                                                                        |
| ITP-003-A | Postgres `fetch_queue` (single demand-weighted queue)                                          | Test PostgreSQL instance (Docker) or pg-mem; assert INSERT + `NOTIFY`                                                                 | Verifies enqueue + demand-weighted ordering (`request_count DESC, first_requested ASC`) against the real `fetch_queue` schema                  |
| ITP-003-B | Postgres `fetch_queue` (retry-exhausted row)                                                   | Test PostgreSQL instance; drive a row past its FR-016 retry budget                                                                    | Simulates persistent failure for tombstone (`status='tombstone'`) transition                                                                   |
| ITP-004-A | ARCH-005 (`usda_call_log`; deferred Redis sorted set)                                          | Call-log stub returning controlled `{ allowed, paused, windowCount }` results                                                         | Isolates the rolling-window check-and-record gate from the real store                                                                          |
| ITP-004-B | ARCH-008 (USDA API)                                                                            | HTTP mock (nock) returning valid USDAFoodResponse                                                                                     | Avoids real USDA API calls; controls response data                                                                                             |
| ITP-004-C | ARCH-008 (USDA API)                                                                            | HTTP mock returning 500 on first call                                                                                                 | Simulates transient USDA error for retry verification                                                                                          |
| ITP-005-A | `usda_call_log` (concurrent access)                                                            | Real Postgres instance with concurrent test clients (deferred Redis variant: real sorted-set Lua)                                     | Concurrency test requires real atomic count-and-record over the trailing 60-min window                                                         |
| ITP-005-B | `usda_call_log` store (unavailable)                                                            | Call-log store stub throwing connection error                                                                                         | Simulates call-log-store failure for fail-closed fault propagation test                                                                        |
| ITP-006-A | PostgreSQL                                                                                     | Test PostgreSQL instance (Docker) or pg-mem                                                                                           | Verifies real SQL upsert behavior; schema-level contract                                                                                       |
| ITP-006-B | PostgreSQL (pg_trgm)                                                                           | Test PostgreSQL instance with pg_trgm extension                                                                                       | Full-text search requires real extension                                                                                                       |
| ITP-006-C | PostgreSQL (unavailable)                                                                       | pg-mock throwing connection error                                                                                                     | Simulates DB failure for error propagation test                                                                                                |
| ITP-007-A | ARCH-007 (Redis), ARCH-006                                                                     | Redis stub (miss) + PostgreSQL stub (hit)                                                                                             | Isolates cache-through data flow                                                                                                               |
| ITP-007-B | Redis (concurrent SADD)                                                                        | Real Redis instance with concurrent test clients                                                                                      | Concurrency test requires real Redis SADD atomicity                                                                                            |
| ITP-007-C | Redis (invalidate/clear)                                                                       | Redis stub — assert DEL and SREM called                                                                                               | Verifies cache invalidation handshake                                                                                                          |
| ITP-007-D | Redis (unavailable)                                                                            | Redis stub throwing connection error                                                                                                  | Simulates Redis failure for fallthrough test                                                                                                   |
| ITP-008-A | USDA FoodData Central API                                                                      | HTTP mock (nock) with valid USDA response fixture                                                                                     | Avoids real USDA API dependency; controls response                                                                                             |
| ITP-008-B | USDA FoodData Central API                                                                      | HTTP mock returning 429 / 401 responses                                                                                               | Simulates USDA error codes for classification test                                                                                             |
| ITP-009-A | API Gateway WebSocket API                                                                      | AWS SDK mock for PostToConnection                                                                                                     | Avoids real WebSocket connections; verifies notification dispatch                                                                              |
| ITP-009-B | API Gateway WebSocket API                                                                      | AWS SDK mock returning GoneException (disconnected)                                                                                   | Simulates disconnected clients for fire-and-forget test                                                                                        |
| ITP-010-A | AWS Secrets Manager                                                                            | AWS SDK mock returning valid secret string                                                                                            | Avoids real Secrets Manager; verifies key retrieval contract                                                                                   |
| ITP-010-B | AWS Secrets Manager                                                                            | AWS SDK mock throwing ResourceNotFoundException                                                                                       | Simulates missing secret for fault propagation test                                                                                            |
| ITP-011-A | CloudWatch Logs                                                                                | AWS SDK mock — assert PutLogEvents payload                                                                                            | Verifies structured log field completeness                                                                                                     |
| ITP-011-B | CloudWatch Metrics                                                                             | AWS SDK mock — assert PutMetricData values                                                                                            | Verifies metric emission contract                                                                                                              |
| ITP-011-C | AWS X-Ray                                                                                      | X-Ray SDK mock — assert segment creation                                                                                              | Verifies trace boundary handshake                                                                                                              |
| ITP-012-A | @clerk/backend `verifyToken`; ARCH-002/ARCH-003                                                | Stub `verifyToken` to throw; spy on `publishFoodRequested` / `enqueue` — assert zero                                                  | Networkless verify; assert fail-closed before any downstream boundary                                                                          |
| ITP-012-B | @clerk/backend `verifyToken`                                                                   | Stub `verifyToken` to resolve a valid M2M claim set                                                                                   | Verifies M2M service token is admitted, not `401`                                                                                              |
| ITP-012-C | `fetch_queue` + `fetch_requesters` pending state; ARCH-003                                     | Pending state pre-seeded so one `sub` has >50 / exactly 50 / <50 pending; spy on `enqueue` + drain-time priority ordering             | Verifies demotion-not-rejection fairness (`202`, no `429`) + the `DEMOTE_THRESHOLD = 50` `>50` boundary + dynamic re-promotion from live state |
| ITP-012-D | ARCH-003 queue-depth probe / circuit breaker                                                   | Stub depth above ceiling / breaker `open`; spy on `enqueue`                                                                           | Simulates backpressure for `503` fail-closed test (system-wide backstop, distinct from demotion)                                               |
| ITP-012-E | ARCH-004 consumer; Postgres `fetch_queue` event provenance                                     | Inject events with/without authorized-principal provenance marker                                                                     | Verifies async-path provenance validation (US-0 on internal edge)                                                                              |
| ITP-012-F | @clerk/backend `verifyToken`; ARCH-001 validation                                              | Stub `verifyToken` to throw / resolve unscoped / resolve scoped; malformed body; spy on `publishFoodRequested` / `enqueue`            | Verifies scope `403` and the `401 → 403 → 400` precedence through the route stack                                                              |
| ITP-012-G | ARCH-003 enqueue; cache/DB for mixed batch                                                     | Spy on `enqueue`; submit batch of 101 (over cap) and of 100 mixed cached/miss `fdcId`s                                                | Verifies FR-045 batch `400` fails closed before enqueue, and accepted batch → per-item partial (distinct from FR-046 `503`)                    |
| ITP-012-H | @clerk/backend `verifyToken`; consumer pacts (Pact/contract broker); ARCH-004 event provenance | Replay consumer-published M2M and async-event pacts against ARCH-012 / ARCH-004; resolve M2M claims / inject marked + unmarked events | Consumer-driven contract verification of the M2M and async-producer seams before deploy                                                        |

---

## Coverage Summary

| Metric                            | Count          |
| --------------------------------- | -------------- |
| Total Architecture Modules (ARCH) | 12             |
| Total Test Cases (ITP)            | 38             |
| Total Scenarios (ITS)             | 57             |
| Modules with ≥1 ITP               | 12 / 12 (100%) |
| Test Cases with ≥1 ITS            | 38 / 38 (100%) |
| **Overall Coverage (ARCH→ITP)**   | **100%**       |

### Technique Distribution

| Technique                            | Test Cases | Percentage |
| ------------------------------------ | ---------- | ---------- |
| Interface Contract Testing           | 18         | 47%        |
| Interface Fault Injection            | 13         | 34%        |
| Data Flow Testing                    | 4          | 11%        |
| Concurrency & Race Condition Testing | 2          | 5%         |
| Consumer-Driven Contract Testing     | 1          | 3%         |
| **Total**                            | **38**     | **100%**   |

> Note: ITP-012-C applies both Interface Contract Testing and Concurrency & Race Condition Testing, and ITP-012-F applies both Interface Contract Testing and Interface Fault Injection; each is counted once under its primary technique (Interface Contract Testing) in the table above. ITP-012-G is counted under Interface Fault Injection, and ITP-012-H under Consumer-Driven Contract Testing (the seam-pact technique named in the Overview, now exercised by a concrete test case).

## Uncovered Modules

None — full coverage achieved.
