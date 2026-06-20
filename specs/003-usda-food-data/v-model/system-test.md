# System Test Plan: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/system-design.md`

## Overview

This document defines the System Test Plan for the USDA Food Data Integration feature. Every system component in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language is technical and component-oriented. The architecture is event-driven and queue-based: user-facing food lookups are served exclusively from local PostgreSQL (Redis cache is a deferred variant; lean-launch default is Postgres); the USDA API is never called in the request path. The fetch pipeline is backed by a Postgres `fetch_queue` table with `LISTEN/NOTIFY`, drained by a Fargate consumer worker; EventBridge is used only for scheduled producers and the `FoodDataReceived` notification.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case identifies its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **State Transition** — Tests ordered/sequenced behavior (e.g. status-precedence resolution between competing faults)
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (FoodApiController)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010

#### Test Case: STP-001-A (Local-Store-Only Serving — No USDA API Call in Request Path)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-002: SYS-001 → SYS-007)
**Description**: Verifies that FoodApiController serves all responses exclusively from PostgreSQL/Redis and never invokes the USDA API during the request lifecycle.

- **System Scenario: STS-001-A1**
    - **Given** a food record exists in PostgreSQL with `fdc_id = 12345` and `fetch_status = 'fetched'`; Redis cache is cold for `food:12345`
    - **When** FoodApiController receives `GET /v1/foods/12345`
    - **Then** FoodApiController executes `SELECT * FROM foods WHERE fdc_id = 12345` against SYS-007; no outbound HTTP call to `api.nal.usda.gov` is made; response is `200 OK` with `fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`, and available micronutrients

- **System Scenario: STS-001-A2**
    - **Given** Redis cache contains `food:12345` with `fetch_status = 'fetched'`
    - **When** FoodApiController receives `GET /v1/foods/12345`
    - **Then** FoodApiController executes `GET food:12345` against SYS-008 (cache hit); no PostgreSQL query is issued; no outbound HTTP call to USDA API; response is `200 OK` with full nutrition payload

#### Test Case: STP-001-B (HTTP Status Code Contract per fetch_status)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (fetch_status state machine)
**Description**: Verifies that FoodApiController returns the correct HTTP status code for each `fetch_status` partition.

- **System Scenario: STS-001-B1**
    - **Given** PostgreSQL contains `fdc_id = 11111` with `fetch_status = 'fetched'`
    - **When** FoodApiController receives `GET /v1/foods/11111`
    - **Then** response status is `200 OK`; body contains `fdcId: 11111` and all required nutrition fields

- **System Scenario: STS-001-B2**
    - **Given** no record exists in PostgreSQL or Redis for `fdc_id = 22222`; `pending_fetch` Redis set does not contain `22222`
    - **When** FoodApiController receives `GET /v1/foods/22222`
    - **Then** response status is `202 Accepted`; body is `{ "status": "pending", "fdcId": 22222, "estimatedWaitSeconds": <positive integer> }`; a `FoodRequested` event is published to SYS-002

- **System Scenario: STS-001-B3**
    - **Given** PostgreSQL contains `fdc_id = 33333` with `fetch_status = 'pending'`; `pending_fetch` Redis set contains `33333`
    - **When** FoodApiController receives `GET /v1/foods/33333`
    - **Then** response status is `202 Accepted`; no new `FoodRequested` event is published to SYS-002 (deduplication enforced)

- **System Scenario: STS-001-B4**
    - **Given** PostgreSQL contains `fdc_id = 44444` with `fetch_status = 'not_found'`
    - **When** FoodApiController receives `GET /v1/foods/44444`
    - **Then** response status is `404 Not Found`; no event is published to SYS-002; no row is inserted into `fetch_queue`

- **System Scenario: STS-001-B5**
    - **Given** PostgreSQL contains `fdc_id = 55557` with `fetch_status = 'stale'` (`fetched_at` older than the 30-day threshold)
    - **When** FoodApiController receives `GET /v1/foods/55557`
    - **Then** response status is `200 OK` and the held (stale) data is served immediately with a staleness indicator (the read never blocks and never returns `202` for a record it already holds); a background re-fetch is enqueued as a `fetch_queue` row (stale-while-revalidate, FR-031)

- **System Scenario: STS-001-B6**
    - **Given** PostgreSQL contains `fdc_id = 55558` with `fetch_status = 'stale'`; the background re-fetch repeatedly fails (e.g. prolonged USDA outage)
    - **When** FoodApiController receives repeated `GET /v1/foods/55558` requests across the outage
    - **Then** every response is `200 OK` serving the stale data with the staleness indicator (availability over freshness — reads never depend on USDA health, no max-staleness cutoff withholds the held record); the background re-fetch keeps retrying (FR-031)

#### Test Case: STP-001-C (Input Validation — fdcId Boundary Values)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (fdcId: numeric, positive integer)
**Description**: Verifies that FoodApiController rejects invalid `fdcId` inputs before any downstream component is invoked.

- **System Scenario: STS-001-C1**
    - **Given** FoodApiController is running
    - **When** FoodApiController receives `GET /v1/foods/0`
    - **Then** response status is `400 Bad Request`; no query is issued to SYS-007 or SYS-008; no event is published to SYS-002

- **System Scenario: STS-001-C2**
    - **Given** FoodApiController is running
    - **When** FoodApiController receives `GET /v1/foods/-1`
    - **Then** response status is `400 Bad Request`; no downstream component is invoked

- **System Scenario: STS-001-C3**
    - **Given** FoodApiController is running
    - **When** FoodApiController receives `GET /v1/foods/abc`
    - **Then** response status is `400 Bad Request`; no downstream component is invoked

- **System Scenario: STS-001-C4**
    - **Given** FoodApiController is running
    - **When** FoodApiController receives `GET /v1/foods/1` (minimum valid positive integer)
    - **Then** FoodApiController proceeds to query SYS-007/SYS-008; response is not `400`

#### Test Case: STP-001-D (Search Endpoint — Local-Only Execution)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-007 full-text search)
**Description**: Verifies that `GET /v1/foods/search` executes exclusively against local PostgreSQL using pg_trgm/FTS and never calls the USDA API.

- **System Scenario: STS-001-D1**
    - **Given** PostgreSQL contains 1,000 food records with `fetch_status = 'fetched'`; no outbound network route to USDA API is available
    - **When** FoodApiController receives `GET /v1/foods/search?query=chicken`
    - **Then** FoodApiController issues a pg_trgm or tsvector query against SYS-007; results are returned ranked by relevance; no outbound HTTP call to USDA API; response time is under 200ms

- **System Scenario: STS-001-D2**
    - **Given** PostgreSQL contains 50,000 food records
    - **When** FoodApiController receives `GET /v1/foods/search?query=broccoli`
    - **Then** response is returned within 200ms; results are ranked by relevance score descending

#### Test Case: STP-001-E (Batch Endpoint — Per-Item Partial Response)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-001 → SYS-007 read; SYS-001 → SYS-002 enqueue for misses)
**Description**: Verifies that `POST /v1/foods/batch` mixing cached/stale and uncached ids returns a per-item partial result in one response — cached/stale foods inline, each miss as a `pending` entry whose fetch is enqueued — rather than withholding all-or-nothing (FR-045).

- **System Scenario: STS-001-E1**
    - **Given** PostgreSQL contains `fdc_id = 100` (`fetch_status = 'fetched'`) and `fdc_id = 200` (`fetch_status = 'stale'`); `fdc_id = 300` and `fdc_id = 400` have no local record
    - **When** FoodApiController receives `POST /v1/foods/batch` with `{ "fdcIds": [100, 200, 300, 400] }`
    - **Then** the response is a single body returning `100` and `200` inline with their food data (`200` carries a staleness indicator), and `300` and `400` each as a `pending` entry; high-priority `fetch_queue` rows are enqueued for `300` and `400` (and a background re-fetch for the stale `200`); the caller receives available data immediately and polls only the pending ids

---

### Component Verification: SYS-002 (EventBridgeBus)

**Parent Requirements**: REQ-011, REQ-012

#### Test Case: STP-002-A (Enqueue Routing — FoodRequested to High-Priority fetch_queue Row)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-001: SYS-001 → SYS-002; SYS-002 → SYS-003)
**Description**: Verifies that a `FoodRequested` cache-miss results in a high-priority row inserted into SYS-003 (HighPriorityFetchQueue: `fetch_queue` rows with `priority = 'high'`).

- **System Scenario: STS-002-A1**
    - **Given** SYS-001 resolves a single-food cache miss for `fdc_id = 12345`
    - **When** SYS-001 executes `INSERT INTO fetch_queue (fdc_id, priority, ...) VALUES (12345, 'high', ...)` and issues a `NOTIFY fetch_queue` signal
    - **Then** a high-priority row is present in SYS-003 (HighPriorityFetchQueue); no low-priority row is written to SYS-004 (LowPriorityFetchQueue)

#### Test Case: STP-002-B (Enqueue Routing — FoodBatchRequested to Low-Priority fetch_queue Rows)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-004)
**Description**: Verifies that a batch request results in low-priority rows inserted into SYS-004 (LowPriorityFetchQueue: `fetch_queue` rows with `priority = 'low'`).

- **System Scenario: STS-002-B1**
    - **Given** a producer resolves a batch request for `fdcIds = [1, 2, 3]` with `correlationId = "abc"`
    - **When** the producer inserts the batch rows into `fetch_queue` with `priority = 'low'` and issues a `NOTIFY fetch_queue` signal
    - **Then** the low-priority rows are present in SYS-004 (LowPriorityFetchQueue); no high-priority row is written to SYS-003

#### Test Case: STP-002-C (Fault Injection — fetch_queue Insert Failure)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-001 → SYS-002: enqueue failure)
**Description**: Verifies system behavior when the `fetch_queue` insert fails.

- **System Scenario: STS-002-C1**
    - **Given** the `fetch_queue` insert is unavailable (simulated via Postgres error or permission deny)
    - **When** FoodApiController attempts to enqueue a fetch for `fdc_id = 99999`
    - **Then** FoodApiController returns `202 Accepted` to the caller (or propagates an error); the food record remains in `fetch_status = 'pending'` or is not created; no row reaches SYS-003

---

### Component Verification: SYS-003 (HighPriorityFetchQueue)

**Parent Requirements**: REQ-011, REQ-012, REQ-014

#### Test Case: STP-003-A (Priority-Ordered Row Delivery Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-003; SYS-003 → SYS-005)
**Description**: Verifies that HighPriorityFetchQueue (`fetch_queue` rows with `priority = 'high'`) is drained in insertion order and delivers leased rows to SYS-005 with the correct schema.

- **System Scenario: STS-003-A1**
    - **Given** HighPriorityFetchQueue holds no pending high-priority rows; SYS-002 inserts a high-priority `FoodRequested` row
    - **When** the `fetch_queue` row `{ "fdc_id": 12345, "priority": "high", "correlation_id": "xyz" }` is inserted and a `NOTIFY fetch_queue` signal fires
    - **Then** SYS-005 (Fargate consumer worker) leases the row (via `SELECT ... FOR UPDATE SKIP LOCKED`) with all three fields intact; rows are drained in `created_at` order relative to other high-priority rows

#### Test Case: STP-003-B (Tombstone Routing After Max Attempts)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-003 → SYS-005 failure path)
**Description**: Verifies that rows exceeding the max attempt count (≤5 attempts with backoff, FR-016) are tombstoned (`status = 'tombstone'`, the DLQ-equivalent).

- **System Scenario: STS-003-B1**
    - **Given** a row `{ "fdc_id": 55555 }` is pending in HighPriorityFetchQueue; SYS-005 fails to process it and does not mark it done on each attempt (the row lease, FR-018, expires for retry between attempts)
    - **When** the row has been attempted 5 times without success
    - **Then** the row is set to `status = 'tombstone'` (DLQ-equivalent); it is no longer leasable from the pending set

---

### Component Verification: SYS-004 (LowPriorityFetchQueue)

**Parent Requirements**: REQ-011, REQ-013

#### Test Case: STP-004-A (Row Delivery — Batch Schema)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-004)
**Description**: Verifies that LowPriorityFetchQueue (`fetch_queue` rows with `priority = 'low'`) delivers batch rows with the correct schema to SYS-005.

- **System Scenario: STS-004-A1**
    - **Given** LowPriorityFetchQueue holds no pending low-priority rows; SYS-002 inserts `FoodBatchRequested` rows
    - **When** the `fetch_queue` rows `{ "fdc_ids": [1, 2, 3], "priority": "low", "correlation_id": "batch-001" }` are inserted
    - **Then** SYS-005 leases the rows with `fdc_ids` intact; rows are drained in `created_at` order

#### Test Case: STP-004-B (Tombstone Routing After Max Attempts)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-004 → SYS-005 failure path)
**Description**: Verifies that low-priority rows exceeding the max attempt count are tombstoned (`status = 'tombstone'`, the DLQ-equivalent).

- **System Scenario: STS-004-B1**
    - **Given** a batch row `{ "fdc_ids": [77777, 88888] }` is pending in LowPriorityFetchQueue; SYS-005 fails to process it 5 times
    - **When** the row has been attempted 5 times without success
    - **Then** the row is set to `status = 'tombstone'` (DLQ-equivalent); it is no longer leasable from the pending set

---

### Component Verification: SYS-005 (FoodConsumerWorker)

**Parent Requirements**: REQ-011, REQ-012, REQ-014, REQ-015, REQ-016, REQ-017

#### Test Case: STP-005-A (High-Priority Lease Priority)

**Technique**: Interface Contract Testing
**Target View**: Dependency View (SYS-003 → SYS-005; SYS-004 → SYS-005)
**Description**: Verifies that the Fargate consumer worker leases from HighPriorityFetchQueue first and only leases from LowPriorityFetchQueue when no high-priority rows are pending.

- **System Scenario: STS-005-A1**
    - **Given** both SYS-003 and SYS-004 contain pending rows
    - **When** the consumer worker begins a drain cycle
    - **Then** the consumer worker processes all available high-priority rows from SYS-003 before leasing any row from SYS-004

- **System Scenario: STS-005-A2**
    - **Given** SYS-003 has no pending rows; SYS-004 contains pending rows
    - **When** the consumer worker begins a drain cycle
    - **Then** the consumer worker leases rows from SYS-004 and processes the available rows

#### Test Case: STP-005-B (Successful USDA Fetch — Full Success Path)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-004: SYS-005 → SYS-009; IC-005: SYS-005 → SYS-007)
**Description**: Verifies the complete success path: rolling-window check-and-record → USDA call → PostgreSQL upsert → cache invalidation → fetch_queue row completion → EventBridge `FoodDataReceived` emit.

- **System Scenario: STS-005-B1**
    - **Given** SYS-006 rolling-window trailing-60-min count is below 900; a `fetch_queue` row `{ "fdc_id": 12345 }` is pending in SYS-003; USDA API returns `200 OK` with food data for `fdcId = 12345`
    - **When** the consumer worker processes the leased row
    - **Then** the consumer worker: (1) calls SYS-006 to check-and-record against the rolling window and receives `{ allowed: true }` (the new call timestamp is recorded in `usda_call_log`); (2) calls USDA API `POST /v1/foods` with `{ fdcIds: [12345] }`; (3) upserts food into SYS-007 with `fetch_status = 'fetched'`; (4) invalidates the cache for `food:12345` and clears the `pending_fetch` marker in SYS-008; (5) marks the `fetch_queue` row `status = 'done'` in SYS-003; (6) publishes the `FoodDataReceived` event to SYS-002

#### Test Case: STP-005-C (Batch Processing — Up to 20 fdcIds per USDA Call)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (batch size: 1–20 fdcIds per USDA API call)
**Description**: Verifies that the consumer worker batches up to 20 fdcIds per USDA API call and records exactly 1 call against the rolling window per USDA call regardless of batch size.

- **System Scenario: STS-005-C1**
    - **Given** SYS-006 rolling-window trailing-60-min count is below 900; a `fetch_queue` row contains `{ "fdc_ids": [1, 2, ..., 20] }` (20 IDs)
    - **When** the consumer worker processes the leased row
    - **Then** exactly 1 HTTP call is made to USDA API with all 20 IDs; exactly 1 call is recorded against the SYS-006 rolling window

- **System Scenario: STS-005-C2**
    - **Given** SYS-006 rolling-window trailing-60-min count is at least 2 below the cap; a `fetch_queue` row contains `{ "fdc_ids": [1, 2, ..., 21] }` (21 IDs, exceeds batch limit)
    - **When** the consumer worker processes the leased row
    - **Then** the consumer worker splits into 2 USDA API calls (20 + 1); 2 calls are recorded against the SYS-006 rolling window

#### Test Case: STP-005-D (USDA 404 — Tombstone Write with TTL Re-Attempt)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (fetch_status = 'not_found'; tombstone TTL default 30 days)
**Description**: Verifies that a USDA 404 response results in a tombstone record with no immediate retry, and that the tombstone carries a configurable TTL (default 30 days) after which a later lookup MAY re-attempt the fetch.

- **System Scenario: STS-005-D1**
    - **Given** a `fetch_queue` row `{ "fdc_id": 99999 }` is pending in SYS-003; USDA API returns `404 Not Found` for `fdcId = 99999`
    - **When** the consumer worker processes the leased row
    - **Then** the consumer worker upserts `{ fdc_id: 99999, fetch_status: 'not_found' }` into SYS-007; the `fetch_queue` row is marked `status = 'tombstone'`; the 404 is treated as immediate (no retry, no backoff, FR-016); no `FoodDataReceived` event is emitted

- **System Scenario: STS-005-D2**
    - **Given** a tombstone record `{ fdc_id: 99999, fetch_status: 'not_found' }` exists in SYS-007 whose tombstone age exceeds the configured TTL (default 30 days)
    - **When** FoodApiController receives `GET /v1/foods/99999` after the TTL has lapsed
    - **Then** the lookup re-attempts the fetch (a new high-priority `fetch_queue` row is enqueued for `99999`, response `202 Accepted`); within the TTL the same lookup would instead return `404` without enqueueing; the re-attempt counts against the SYS-006 rolling-window budget so it cannot bypass the rate limit (FR-025)

#### Test Case: STP-005-E (USDA 429 — Treat Rolling Window as Full and Back Off)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-009: rate limit exceeded)
**Description**: Verifies that a USDA 429 response causes the consumer to treat the rolling window as full, back off, and stop processing remaining rows (a failsafe; the consumer does not reset any counter).

- **System Scenario: STS-005-E1**
    - **Given** the SYS-006 rolling-window trailing-60-min count is below the cap; the consumer worker is processing a batch of 3 leased `fetch_queue` rows; USDA API returns `429 Too Many Requests` on the second row
    - **When** the consumer worker receives the 429 response
    - **Then** the consumer worker treats the rolling window as full and backs off (pauses draining); the second `fetch_queue` row is left `pending` (its row lease, FR-018, expires for retry after the backoff gate); the third row is not processed in this drain cycle

#### Test Case: STP-005-F (USDA 5xx — Row-Lease Retry with Backoff)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-009: transient error)
**Description**: Verifies that USDA 5xx errors leave the `fetch_queue` row incomplete for row-lease retry with backoff (FR-016).

- **System Scenario: STS-005-F1**
    - **Given** a `fetch_queue` row `{ "fdc_id": 11111 }` is pending in SYS-003; USDA API returns `503 Service Unavailable`
    - **When** the consumer worker processes the leased row
    - **Then** the consumer worker does NOT mark the row `done`; the row becomes leasable again after its row lease (FR-018) expires; the attempt count is incremented with backoff and, after 5 total attempts (FR-016), the row is set to `status = 'tombstone'` (DLQ-equivalent)

---

### Component Verification: SYS-006 (RollingWindowLimiter)

**Parent Requirements**: REQ-018, REQ-019

#### Test Case: STP-006-A (Atomic Rolling-Window Check-and-Record)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-003: SYS-005 → SYS-006)
**Description**: Verifies that the rolling-window check-and-record operation — counting calls in the trailing 60 minutes and recording the new call timestamp in one atomic step — returns the correct response schema. (Lean launch: a Postgres `usda_call_log` count+insert in a transaction; deferred variant: a Redis sorted-set Lua script.)

- **System Scenario: STS-006-A1**
    - **Given** the `usda_call_log` contains 500 call timestamps within the trailing 60 minutes (below the 1,000 cap)
    - **When** SYS-005 executes the atomic check-and-record operation
    - **Then** the operation returns `{ "allowed": true, "trailingCount": 501 }`; exactly one new call timestamp is appended to `usda_call_log` in a single atomic operation

- **System Scenario: STS-006-A2**
    - **Given** the `usda_call_log` contains 1,000 call timestamps within the trailing 60 minutes (at the cap)
    - **When** SYS-005 executes the atomic check-and-record operation
    - **Then** the operation returns `{ "allowed": false, "trailingCount": 1000 }`; no new timestamp is recorded in `usda_call_log`

#### Test Case: STP-006-B (Rolling-Window Cap and Aging Boundary Values)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (cap: ≤1,000 calls in any trailing 60 minutes; pause at 90% = 900)
**Description**: Verifies the rolling-window hard cap and the 90% pause/resume behavior as calls age out of the trailing 60-minute window at boundary values.

- **System Scenario: STS-006-B1**
    - **Given** the `usda_call_log` holds 900 call timestamps within the trailing 60 minutes (the 90% pause threshold)
    - **When** SYS-005 considers the next USDA call
    - **Then** the consumer pauses draining (does not record a new call) until earlier calls age out; the trailing-60-min count is held at or below 900 while paused (≤1,000 cap never breached)

- **System Scenario: STS-006-B2**
    - **Given** the `usda_call_log` holds 899 call timestamps within the trailing 60 minutes
    - **When** SYS-005 executes a check-and-record
    - **Then** the operation returns `{ "allowed": true, "trailingCount": 900 }`; recording the 900th call reaches the pause threshold, so the next check pauses draining

- **System Scenario: STS-006-B3**
    - **Given** the `usda_call_log` holds 900 timestamps and the consumer is paused; enough time elapses that the oldest timestamps fall outside the trailing 60-minute window, dropping the count below the threshold
    - **When** the consumer re-evaluates the rolling window
    - **Then** the trailing-60-min count is now below 900; the next check-and-record returns `{ "allowed": true }` and draining resumes

#### Test Case: STP-006-C (Fault Injection — Rolling-Window Store Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-006: rolling-window store unavailable)
**Description**: Verifies consumer worker behavior when the rolling-window store (`usda_call_log` / Redis sorted set) is unreachable.

- **System Scenario: STS-006-C1**
    - **Given** the rolling-window store (SYS-006) is unreachable (connection timeout)
    - **When** the consumer worker attempts the atomic rolling-window check-and-record
    - **Then** the consumer worker does NOT call the USDA API; the `fetch_queue` row is left incomplete (its row lease, FR-018, expires for retry); an error is logged to CloudWatch (SYS-012)

---

### Component Verification: SYS-007 (FoodDataPostgresRepository)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-020, REQ-021

#### Test Case: STP-007-A (Upsert Contract — ON CONFLICT Behavior)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-005: SYS-005 → SYS-007 UPSERT)
**Description**: Verifies that the PostgreSQL upsert correctly handles both insert (new food) and update (existing food) cases.

- **System Scenario: STS-007-A1**
    - **Given** no record exists for `fdc_id = 12345` in the `foods` table
    - **When** the consumer worker executes `INSERT INTO foods (...) VALUES (...) ON CONFLICT (fdc_id) DO UPDATE SET ...` with `fetch_status = 'fetched'`
    - **Then** a new row is inserted with all required fields: `fdc_id`, `description`, `data_type`, `nutrients` (JSONB), `fetch_status = 'fetched'`, `fetched_at`, `created_at`, `updated_at`

- **System Scenario: STS-007-A2**
    - **Given** a record exists for `fdc_id = 12345` with `fetch_status = 'pending'`
    - **When** the consumer worker executes the upsert with `fetch_status = 'fetched'` and updated nutrition data
    - **Then** the existing row is updated; `fetch_status` changes to `'fetched'`; `fetched_at` and `updated_at` are set to current timestamp; no duplicate row is created

#### Test Case: STP-007-B (fetch_status State Machine — All Partitions)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (fetch_status: 'pending' | 'fetched' | 'failed' | 'not_found' | 'stale')
**Description**: Verifies that each valid `fetch_status` value is stored and retrieved correctly.

- **System Scenario: STS-007-B1**
    - **Given** a food record is inserted with `fetch_status = 'pending'`
    - **When** FoodApiController queries `SELECT * FROM foods WHERE fdc_id = $1`
    - **Then** the returned row has `fetch_status = 'pending'`; FoodApiController returns `202 Accepted`

- **System Scenario: STS-007-B2**
    - **Given** a food record has `fetch_status = 'not_found'`
    - **When** FoodApiController queries the record
    - **Then** the returned row has `fetch_status = 'not_found'`; FoodApiController returns `404 Not Found`

#### Test Case: STP-007-C (Fault Injection — PostgreSQL Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-001 → SYS-007: PostgreSQL unavailable)
**Description**: Verifies FoodApiController behavior when PostgreSQL is unreachable.

- **System Scenario: STS-007-C1**
    - **Given** PostgreSQL (SYS-007) is unreachable (connection refused)
    - **When** FoodApiController receives `GET /v1/foods/12345`
    - **Then** FoodApiController returns `503 Service Unavailable`; no USDA API call is made; the error is logged to CloudWatch (SYS-012)

---

### Component Verification: SYS-008 (FoodDataRedisCache)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-022, REQ-023

#### Test Case: STP-008-A (Cache Hit — Hot Food Data Served from Redis)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-008 GET)
**Description**: Verifies that a Redis cache hit bypasses PostgreSQL and returns food data directly.

- **System Scenario: STS-008-A1**
    - **Given** Redis key `food:12345` exists with TTL > 0 and contains serialized food data with `fetch_status = 'fetched'`
    - **When** FoodApiController executes `GET food:12345`
    - **Then** FoodApiController returns the cached data as `200 OK`; no `SELECT` query is issued to SYS-007

#### Test Case: STP-008-B (Cache TTL Boundary — 24-Hour Expiry)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (Redis TTL: 24 hours = 86,400 seconds)
**Description**: Verifies that cached food data expires after exactly 24 hours.

- **System Scenario: STS-008-B1**
    - **Given** the consumer worker writes `SET food:12345 <data> EX 86400` to Redis after a successful USDA fetch
    - **When** 86,400 seconds elapse
    - **Then** `GET food:12345` returns nil (key expired); FoodApiController falls through to PostgreSQL on the next request

#### Test Case: STP-008-C (Pending-Set Deduplication — SISMEMBER / SADD)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-008 pending_fetch set)
**Description**: Verifies that the `pending_fetch` Redis set prevents duplicate `FoodRequested` events for the same `fdcId`.

- **System Scenario: STS-008-C1**
    - **Given** `pending_fetch` Redis set contains `12345`
    - **When** FoodApiController receives `GET /v1/foods/12345` (cache miss, DB miss)
    - **Then** FoodApiController executes `SISMEMBER pending_fetch 12345` → returns 1; no `FoodRequested` event is published; response is `202 Accepted`

- **System Scenario: STS-008-C2**
    - **Given** `pending_fetch` Redis set does NOT contain `99999`
    - **When** FoodApiController receives `GET /v1/foods/99999` (cache miss, DB miss)
    - **Then** FoodApiController executes `SADD pending_fetch 99999`; a `FoodRequested` event is published to SYS-002; response is `202 Accepted`

#### Test Case: STP-008-D (Fault Injection — Redis Unavailable, Fallthrough to PostgreSQL)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-001 → SYS-008: Redis unavailable)
**Description**: Verifies that Redis unavailability causes FoodApiController to fall through to PostgreSQL without returning an error.

- **System Scenario: STS-008-D1**
    - **Given** Redis (SYS-008) is unreachable; PostgreSQL contains `fdc_id = 12345` with `fetch_status = 'fetched'`
    - **When** FoodApiController receives `GET /v1/foods/12345`
    - **Then** FoodApiController falls through to SYS-007; response is `200 OK` with food data; no `503` is returned due to Redis failure alone

---

### Component Verification: SYS-009 (USDAFoodDataCentralApi)

**Parent Requirements**: REQ-016, REQ-017, REQ-024

#### Test Case: STP-009-A (Batch Endpoint Contract — POST /v1/foods)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-004: SYS-005 → SYS-009)
**Description**: Verifies that the consumer worker (via `@kitchensink/usda-client`) calls the USDA batch endpoint with the correct request schema and processes the response correctly.

- **System Scenario: STS-009-A1**
    - **Given** the SYS-006 rolling-window trailing-60-min count is below 900; a `fetch_queue` row contains `{ "fdc_ids": [12345, 67890] }`
    - **When** the consumer worker calls `POST https://api.nal.usda.gov/fdc/v1/foods` with `Authorization: Bearer <USDA_API_KEY>` and body `{ "fdcIds": [12345, 67890] }`
    - **Then** USDA API returns `200 OK` with an array of food objects; the consumer worker upserts each food into SYS-007

#### Test Case: STP-009-B (API Key Injection from Secrets Manager)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-011 → SYS-005: USDA_API_KEY injection)
**Description**: Verifies that the consumer worker uses the API key from SYS-011 (Secrets Manager) in all USDA API calls.

- **System Scenario: STS-009-B1**
    - **Given** `USDA_API_KEY` environment variable is set in the consumer worker from SYS-011
    - **When** the consumer worker calls the USDA API
    - **Then** the `Authorization` header contains the correct API key value; the USDA API returns `200 OK` (not `401 Unauthorized`)

---

### Component Verification: SYS-010 (WebSocketNotificationLambda)

**Parent Requirements**: REQ-025

#### Test Case: STP-010-A (Fire-and-Forget WebSocket Push — No Impact on API Lambda)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-010 → SYS-001: fire-and-forget)
**Description**: Verifies that WebSocketNotificationLambda failure does not affect FoodApiController or the core data pipeline.

- **System Scenario: STS-010-A1**
    - **Given** WebSocketNotificationLambda (SYS-010) is unavailable or throws an exception
    - **When** a `FoodDataReceived` event is published to SYS-002 by the consumer worker
    - **Then** the event routing to SYS-010 fails silently; FoodApiController continues to serve requests normally; the consumer worker continues processing; no error propagates to the core pipeline

#### Test Case: STP-010-B (WebSocket Push on FoodDataReceived Event)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-010 event routing)
**Description**: Verifies that WebSocketNotificationLambda is triggered by `FoodDataReceived` events and pushes to connected clients.

- **System Scenario: STS-010-B1**
    - **Given** a client is connected to the API Gateway WebSocket API; the consumer worker publishes `FoodDataReceived { "fdcId": 12345, "fetchedAt": "<timestamp>" }` to SYS-002
    - **When** EventBridgeBus routes the event to SYS-010
    - **Then** WebSocketNotificationLambda calls `@connections/{connectionId}` on the API Gateway Management API with the food data payload; the connected client receives the push notification

---

### Component Verification: SYS-011 (SecretManagement)

**Parent Requirements**: REQ-026, REQ-027

#### Test Case: STP-011-A (API Key Injection into Consumer Worker Environment)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-011 → SYS-005: USDA_API_KEY)
**Description**: Verifies that the USDA API key is retrieved from Secrets Manager and injected into the consumer worker as an environment variable.

- **System Scenario: STS-011-A1**
    - **Given** Secrets Manager contains a secret named `food-service/usda-api-key` with value `<valid-api-key>`
    - **When** the consumer worker starts
    - **Then** the `USDA_API_KEY` environment variable is populated with the secret value; the consumer worker successfully authenticates to the USDA API

#### Test Case: STP-011-B (Fault Injection — Secrets Manager Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-011: Secrets Manager unavailable)
**Description**: Verifies that the consumer worker stops processing when Secrets Manager is unreachable.

- **System Scenario: STS-011-B1**
    - **Given** Secrets Manager (SYS-011) is unreachable (network partition or IAM deny)
    - **When** the consumer worker attempts to retrieve the USDA API key
    - **Then** the consumer worker does NOT call the USDA API; processing stops; an error is logged to CloudWatch (SYS-012); `fetch_queue` rows remain incomplete (row leases expire for retry)

---

### Component Verification: SYS-012 (MonitoringAndLogging)

**Parent Requirements**: REQ-028, REQ-029, REQ-030

#### Test Case: STP-012-A (CloudWatch Log Emission — API Service and Consumer Worker)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-012; SYS-005 → SYS-012)
**Description**: Verifies that both FoodApiController and the consumer worker emit structured logs to CloudWatch.

- **System Scenario: STS-012-A1**
    - **Given** FoodApiController is invoked with `GET /v1/foods/12345`
    - **When** the request completes (success or error)
    - **Then** a structured log entry is written to the FoodApiController CloudWatch log group containing at minimum: `fdcId`, `fetch_status`, HTTP response code, and request duration

- **System Scenario: STS-012-A2**
    - **Given** the consumer worker processes a `fetch_queue` row from SYS-003
    - **When** the processing completes (success, 404, 429, or 5xx)
    - **Then** a structured log entry is written to the consumer worker CloudWatch log group containing: `fdcId`, USDA response code, trailing-60-min rolling-window count, and processing outcome

#### Test Case: STP-012-B (X-Ray Tracing — Distributed Request Visibility)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-012 tracing)
**Description**: Verifies that X-Ray traces are emitted for distributed request flows spanning FoodApiController and the consumer worker.

- **System Scenario: STS-012-B1**
    - **Given** X-Ray active tracing is enabled on FoodApiController and the consumer worker
    - **When** a food lookup triggers the full pipeline: FoodApiController → `fetch_queue` insert + `NOTIFY` → consumer worker → USDA API → PostgreSQL
    - **Then** an X-Ray trace is recorded with segments for each component; the trace is queryable in the X-Ray console by `fdcId` or `correlationId`

#### Test Case: STP-012-C (CloudWatch Alarm — Consumer Worker Error Rate)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (alarm thresholds)
**Description**: Verifies that CloudWatch alarms fire when error rates exceed configured thresholds.

- **System Scenario: STS-012-C1**
    - **Given** a CloudWatch alarm is configured on the consumer worker error rate with threshold > 5% over 5 minutes
    - **When** the consumer worker error rate exceeds 5% (e.g., 6 errors in 100 processed rows within 5 minutes)
    - **Then** the CloudWatch alarm transitions to `ALARM` state; an SNS notification is triggered

---

### Component Verification: SYS-013 (AuthnAuthzLayer)

**Parent Requirements**: REQ-IF-008, REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044

The auth layer is the in-process NestJS `AuthMiddleware`/`FoodAuthGuard` (using `@kitchensink/clerk-verify`) on the ECS/Fargate `food-service`; it is not a Lambda authorizer (except the deferred WebSocket `$connect` authorizer). It fronts **every** food data entry point (every HTTP `/v1/foods/*` route and the WebSocket `$connect`). These scenarios verify its architectural behavior as a black box: rejection before any downstream component is reached (no `fetch_queue` insert, no USDA call), the load-shed property under an invalid-token flood, per-`sub` fairness by queue demotion (not rejection), the scope-`403`/M2M authorization classes, the `401`→`403`→`400`→business status-precedence ordering, and the batch-size boundary. Verification is networkless (`@clerk/backend` `verifyToken` against the non-secret `CLERK_JWT_KEY`), fail-closed.

#### Test Case: STP-013-A (Fail-Closed `401` at Every Entry Point — No Enqueue, No USDA Call)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-013 → SYS-001, SYS-010); Dependency View (SYS-013 → SYS-002)
**Description**: Verifies that SYS-013 rejects unauthenticated, expired, malformed, and wrong-`azp`/wrong-instance requests with `401` at every HTTP route and the WebSocket `$connect`, before SYS-001/SYS-010 business logic runs, and that no `FoodDataReceived` event reaches SYS-002 and no row is enqueued to SYS-003/SYS-004 `fetch_queue` (SC-010). _(Invalid-credential equivalence classes: missing token, expired `exp`, not-yet-valid `nbf`, malformed/garbage, valid signature but wrong `azp`, token signed for a different Clerk instance — fail-closed config error.)_

- **System Scenario: STS-013-A1**
    - **Given** SYS-013 is attached to every `/v1/foods/*` route; no `Authorization` header is present
    - **When** each entry point is exercised in turn — `GET /v1/foods/12345`, `GET /v1/foods/12345/status`, `GET /v1/foods/search?query=chicken`, `GET /v1/foods/12345/nutrients`, `GET /v1/foods/autocomplete?prefix=chic`, and `POST /v1/foods/batch`
    - **Then** every endpoint returns `401 Unauthorized`; SYS-001 business logic is not reached; no `fetch_queue` row is inserted for SYS-003 or SYS-004; no outbound call to `api.nal.usda.gov` is made

- **System Scenario: STS-013-A2**
    - **Given** SYS-013 fronts the WebSocket API Gateway `$connect` route
    - **When** a `$connect` is attempted with no token (and, separately, with an expired token and with a wrong-`azp` token)
    - **Then** the connection is rejected with `403` (pinned `$connect` status) before the connection is established; no `connectionId` is registered; no subscription row is written; no downstream component is invoked

- **System Scenario: STS-013-A3**
    - **Given** SYS-013 receives, across separate requests to `GET /v1/foods/12345`, each invalid-credential class — an expired token (`exp` in the past), a not-yet-valid token (`nbf` in the future), a malformed/garbage Bearer string, a well-formed token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`, and a token signed for a different Clerk instance (signature fails against `CLERK_JWT_KEY`)
    - **When** each request is processed
    - **Then** every request returns `401 Unauthorized`; no `fetch_queue` row is enqueued for any of them; verification is performed networklessly (no outbound call to Clerk or any IdP observed on the request path)

- **System Scenario: STS-013-A4**
    - **Given** `CLERK_JWT_KEY` is missing or malformed in SYS-013 configuration (verifier cannot initialize)
    - **When** any `/v1/foods/*` request arrives — even one bearing an otherwise-valid token
    - **Then** SYS-013 fails closed with `401`; no request proceeds unauthenticated; no enqueue and no USDA call occur

- **System Scenario: STS-013-A5**
    - **Given** a request to `GET /v1/foods/12345` carries no valid token but supplies a forged identity header (`x-authorizer-context` and `x-user-id` claiming an authenticated `sub`)
    - **When** SYS-013 processes the request
    - **Then** the response is `401`; the forged headers are ignored (identity is derived solely from the verified token); no enqueue and no USDA call occur

#### Test Case: STP-013-B (Verification Load-Shed Under Invalid-Token Flood — p95 ≤ 10ms)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-013 verifier concurrency bound + per-source `401`-rate cap)
**Description**: Verifies that SYS-013 sheds load rather than saturating when flooded with well-formed-but-unverifiable tokens (each forcing a full CPU-bound signature check before the fail-closed `401`), so SC-011's ≤10ms p95 holds under attack and SC-009 availability is not breached (FR-052).

- **System Scenario: STS-013-B1**
    - **Given** the verifier concurrency bound under test is `C = 50` in-flight signature checks and the per-source `401`-rate cap is `200` `401`/min/source; **and** a sustained flood of well-formed-but-invalid tokens (valid structure, signature fails against `CLERK_JWT_KEY`) is generated against `GET /v1/foods/{fdcId}` at **2,000 req/s** (= `40×C`, ≥ a stated multiple of the concurrency bound) from a bounded set of **8** source identities for a **120 s** measurement window; **and** a separate baseline of legitimate valid-token requests is interleaved at **100 req/s** (valid:invalid mix ≈ 1:20)
    - **When** SYS-013 processes the mixed load over the 120 s window (first 10 s discarded as warm-up; metrics taken over the remaining 110 s, ≥ 11,000 valid-request latency samples)
    - **Then** the per-source `401`-rate cap / concurrency bound engages — **≥ 95%** of the invalid flood is load-shed (fast-rejected at the cap or rejected without a full CPU-bound signature check), in-flight signature checks stay **≤ `C` (50)** and the verifier queue depth stays bounded (does not grow monotonically across the window), i.e. the verifier does not saturate; **and** valid-token requests continue to be served with auth-attributable verification overhead **≤ 10ms at p95** (SC-011), where auth-attributable latency is measured as the time from request receipt to the authn decision (verify-start → verify-complete span), isolated from downstream SYS-001/SYS-007 handling; **and** no invalid request is enqueued to the SYS-003/SYS-004 `fetch_queue` or reaches the USDA path. _Pass = (valid-token p95 ≤ 10ms) AND (in-flight ≤ C across the window) AND (≥ 95% of invalid requests shed). The scenario is reproducible: same C, cap, rates, mix, window, and sample size yield the same verdict._

#### Test Case: STP-013-C (Per-`sub` Fairness by Queue Demotion — No `429`, Dynamic Re-Promotion)

**Technique**: Boundary Value Analysis
**Target View**: Dependency View (SYS-013/SYS-005 → SYS-003/SYS-004: drain-time priority computed from the requester's current pending count)
**Description**: Verifies that fairness is enforced by **queue demotion, not rejection**: a `sub` with more than 50 items currently pending in the `fetch_queue` has its queued (and subsequent) items ranked to the **back** of the priority order, while other `sub`s continue to be served. No authenticated cache-miss request is rejected — there is **no per-user quota and no `429`**. Demotion is **dynamic**: priority is computed at drain time from the requester's live pending count, so items auto-return to normal priority once the `sub` falls below 50 (SC-012, FR-043). The boundary under test is the **50-pending** demotion threshold.

- **System Scenario: STS-013-C1**
    - **Given** an authenticated `sub` `A` already has more than 50 items pending in the `fetch_queue`
    - **When** `sub` `A` triggers another cache-miss lookup (`GET /v1/foods/{newFdcId}` for an unknown id)
    - **Then** the response is `202 Accepted` (the request is **not** rejected; no `429`); the fetch **is** enqueued, but `sub` `A`'s items are ranked to the back of the priority order (lowest priority, below FR-015 demand ordering) so they drain only on spare capacity

- **System Scenario: STS-013-C2**
    - **Given** authenticated `sub` `A` is scripting cache-miss lookups continuously (driving its pending count above 50) while authenticated `sub` `B` issues occasional cache-miss lookups, against the global 1,000 req/hr USDA budget (SYS-006 rolling window)
    - **When** the consumer drains the `fetch_queue` and `sub` `A`'s pending count later falls back below 50
    - **Then** while `A` is above 50, `A`'s demoted items yield to `B`'s normally-prioritized items (one account cannot starve the shared budget for others); none of `A`'s requests receive `429`; once `A`'s live pending count drops below 50, the drain-time scorer re-promotes `A`'s remaining items to normal priority (no frozen demotion flag)

#### Test Case: STP-013-D (Scope `403` vs `401` Authorization Class; M2M Service-Token Acceptance)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-013 → SYS-001: authorization-outcome class, principal class)
**Description**: Verifies the two principal/authorization equivalence classes whose representatives partition cleanly: an authenticated-but-unauthorized session token (insufficient scope) → `403`, distinct from the unauthenticated `401` class; and a valid Clerk M2M (service) principal → accepted (FR-039/FR-047). _(Ordering/precedence and input-bound concerns are intentionally split out to STP-013-E and STP-013-F respectively — EP partitions outcome classes, it does not express either an ordering property or a numeric limit.)_

- **System Scenario: STS-013-D1**
    - **Given** an authenticated user whose verified token `public_metadata` lacks the required operational scope
    - **When** the user calls an operational/administrative endpoint (e.g. a manual re-fetch trigger)
    - **Then** the response is `403 Forbidden` (authenticated but unauthorized), distinct from the `401` unauthenticated case; no re-fetch is enqueued

- **System Scenario: STS-013-D2**
    - **Given** a server-initiated caller (e.g. SYS for feature 006 meal-planning) presents a Clerk **machine (M2M)** token whose `azp` is in `CLERK_AUTHORIZED_PARTIES` and no end-user session token
    - **When** it calls `GET /v1/foods/{fdcId}`
    - **Then** SYS-013 verifies the M2M token networklessly and accepts the request (the `AuthenticatedCaller` carries a service identity); the server-to-server call is **not** forced to `401`

#### Test Case: STP-013-E (Status-Precedence Ordering — `401` → `403` → `400` → business logic)

**Technique**: State Transition
**Target View**: Interface View (SYS-013 → SYS-001: ordered resolution of competing request defects per FR-051)
**Description**: Verifies the normative status-precedence chain `401` → `403` → `400`/`404` → business logic (FR-051) as an ordered decision sequence. Each scenario presents a request carrying **two simultaneous** defects at adjacent precedence levels and asserts the higher-precedence status wins, exercising each adjacent ordering pair as a discrete transition (EP cannot express "given two faults, the earlier-precedence one wins").

- **System Scenario: STS-013-E1** (`401` precedes `403`)
    - **Given** a request bearing **no** valid token that **also** targets an endpoint for which the (absent) principal would lack scope
    - **When** SYS-013 evaluates the request
    - **Then** the response is `401` (authentication is evaluated before authorization); the scope check is never reached; no `403` is emitted

- **System Scenario: STS-013-E2** (`403` precedes `400`)
    - **Given** a request bearing a **valid** token with **insufficient scope** that **also** carries a malformed/oversized payload (a `400`-class input defect)
    - **When** SYS-013/SYS-001 evaluate the request
    - **Then** the response is `403` — authorization is resolved **before** input validation, so the `400`/`404` defect is never evaluated; no enqueue and no business logic run

- **System Scenario: STS-013-E3** (`400` precedes business logic / `404`)
    - **Given** an authenticated, authorized request whose payload is malformed (e.g. non-numeric `fdcId`) and that would also miss in the local store
    - **When** SYS-013/SYS-001 evaluate the request
    - **Then** the response is `400` — input validation resolves before business logic, so no `404`/lookup is performed and nothing is enqueued; confirming the full chain `401` → `403` → `400` → business is honored across the three adjacent transitions

#### Test Case: STP-013-F (Batch Hard-Limit `400` — `fdcId`-Array Size Boundary)

**Technique**: Boundary Value Analysis
**Target View**: Interface View (SYS-013 → SYS-001: batch input bound, FR-045)
**Description**: Verifies the `POST /v1/foods/batch` hard maximum of **100** `fdcId`s as a boundary, exercising just-under (99, accepted), at-limit (100, accepted), and just-over (101, `400`) cases (FR-045). All requests are authenticated and authorized so the boundary is isolated from the precedence chain.

- **System Scenario: STS-013-F1** (just-under — 99)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose `fdcId` array contains exactly **99** ids
    - **When** SYS-013/SYS-001 process the request
    - **Then** the request is accepted (not rejected on size); the batch proceeds to normal handling

- **System Scenario: STS-013-F2** (at-limit — 100)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose `fdcId` array contains exactly **100** ids (the hard maximum)
    - **When** SYS-013/SYS-001 process the request
    - **Then** the request is accepted (the limit is inclusive); the batch proceeds to normal handling

- **System Scenario: STS-013-F3** (just-over — 101)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose `fdcId` array contains **101** ids (one over the hard maximum)
    - **When** SYS-013/SYS-001 process the request (authentication and authorization having passed)
    - **Then** the response is `400 Bad Request`; no fetch is enqueued for any id in the batch; nothing counts toward the requester's pending-count demotion threshold for the rejected request

---

## Traceability Summary

| SYS ID  | Component Name              | Test Cases               | Scenarios                                                              |
| ------- | --------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| SYS-001 | FoodApiController           | STP-001-A, B, C, D, E    | STS-001-A1, A2, B1, B2, B3, B4, B5, B6, C1, C2, C3, C4, D1, D2, E1     |
| SYS-002 | EventBridgeBus              | STP-002-A, B, C          | STS-002-A1, B1, C1                                                     |
| SYS-003 | HighPriorityFetchQueue      | STP-003-A, B             | STS-003-A1, B1                                                         |
| SYS-004 | LowPriorityFetchQueue       | STP-004-A, B             | STS-004-A1, B1                                                         |
| SYS-005 | FoodConsumerWorker          | STP-005-A, B, C, D, E, F | STS-005-A1, A2, B1, C1, C2, D1, D2, E1, F1                             |
| SYS-006 | RollingWindowLimiter        | STP-006-A, B, C          | STS-006-A1, A2, B1, B2, B3, C1                                         |
| SYS-007 | FoodDataPostgresRepository  | STP-007-A, B, C          | STS-007-A1, A2, B1, B2, C1                                             |
| SYS-008 | FoodDataRedisCache          | STP-008-A, B, C, D       | STS-008-A1, B1, C1, C2, D1                                             |
| SYS-009 | USDAFoodDataCentralApi      | STP-009-A, B             | STS-009-A1, B1                                                         |
| SYS-010 | WebSocketNotificationLambda | STP-010-A, B             | STS-010-A1, B1                                                         |
| SYS-011 | SecretManagement            | STP-011-A, B             | STS-011-A1, B1                                                         |
| SYS-012 | MonitoringAndLogging        | STP-012-A, B, C          | STS-012-A1, A2, B1, C1                                                 |
| SYS-013 | AuthnAuthzLayer             | STP-013-A, B, C, D, E, F | STS-013-A1, A2, A3, A4, A5, B1, C1, C2, D1, D2, E1, E2, E3, F1, F2, F3 |

**Total Test Cases**: 36 STP
**Total Scenarios**: 63 STS
**Components Covered**: 13 / 13 (100%)
