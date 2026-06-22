# Integration Test Plan: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/v-model/architecture-design.md` (+ `module-design.md`)

> **Re-baseline note (2026-06-22).** This artifact (V-Model integration layer) was regenerated to match
> the **source-agnostic food data redesign** in the just-re-baselined `architecture-design.md`
> (ARCH-001..ARCH-019) and `module-design.md` (MOD-001..MOD-021). A food is keyed by an internal ULID
> `id`; **USDA is one pluggable source adapter**; foods are assembled into a **cross-source golden record**
> with per-field provenance; users add foods **by name** through a `PENDING → (UNRESOLVED) → RESOLVED`
> lifecycle (terminal `NOT_FOUND` / `FAILED`). The demand path is now **add-by-name → create+dedup →
> enqueue**; the worker is a **fan-out/merge** worker keyed on the food `id` with a **per-source**
> rolling-60-min limiter. **`fdcId` / `fetch_status` / denormalized-nutrient / single-`fdcId`-fetch flows
> are removed** from every integration test except the USDA-adapter slice (ITP-008 / ITP-013-B), which is
> the only place a source-native key (`fdcId → external_key`) appears.
>
> **Preserved (re-keyed) ITP ids** — ITP-001..ITP-012 survive as the same module-seam test cases, re-keyed
> `fdcId → id` and generalized USDA-only → per-source. The **auth integration slice (ITP-012-A..H)** is
> preserved in id and substance (`fdcId → id`, `/refetch` path re-keyed). **New ITP ids** — ITP-013..ITP-019
> cover the new architecture modules (adapter registry, DAO seam, merge engine, candidate/resolve,
> provenance store, change-driven refresh, adapter input validation). New scenarios were added to the
> preserved cases for the new interaction flows (add-by-name dedup collapse, fan-out+merge, NOT_FOUND vs
> FAILED, per-source pause/resume). No surviving ITP id was renumbered.

## Overview

This document defines the Integration Test Plan for the source-agnostic food data integration. Every
architecture module in `architecture-design.md` has one or more Test Cases (ITP), and every Test Case has
one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys.
Language is module-boundary-oriented. **No external source is ever called in the request path** — all
user-facing lookups are served from the local canonical store (PostgreSQL; optional Redis hot-cache is a
deferred variant). An add-by-name miss creates the food `id` (dedup-collapsed under an advisory lock,
ARCH-014) and enqueues a row into the Postgres `fetch_queue` (keyed on `food_id`) with `LISTEN/NOTIFY`. The
key demand→resolution chain is:

`ARCH-012 → ARCH-001 → ARCH-014 (createByName dedup) → ARCH-003 (fetch_queue + pg_notify) → ARCH-004
(fan-out/merge worker) → [ ARCH-013 registry → ARCH-005 per-source limiter → ARCH-008 adapter → ARCH-019
validate ] → ARCH-015 merge → ARCH-014/ARCH-006 persist → ARCH-017 provenance → status set → ARCH-002
FoodDataReceived`. `UNRESOLVED` foods are disambiguated by `ARCH-001 /candidates + PATCH → ARCH-016`.
Change-driven refresh runs `EventBridge → ARCH-018 → (item_version compare) → ARCH-003 re-enqueue`.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — where NNN matches the parent ARCH, X is a letter suffix (A, B, C...)
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}` — nested under the parent ITP, with numeric suffix (1, 2, 3...)
- **Test-Case marker**: `TC-ITP-{NNN}-{X}` — the stable handle each scenario set exposes to `tasks.md`
  (one `TC-*` per ITP; a task references the `TC-*` to pull in all its ITS scenarios).
- Example: `ITS-001-A1` → Scenario 1 of Test Case A verifying ARCH-001; its task handle is `TC-ITP-001-A`.
- **Re-baseline (2026-06-22):** ITP-001..ITP-012 preserved (re-keyed `fdcId → id`); ITP-013..ITP-019 new.

## ISO 29119-4 Integration Test Techniques

Consumer-Driven Contract Testing (CDCT) is included for externally consumed module contracts; provider
modules publish contracts and consumer modules validate expectations before integration deployment.

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
**Modules Under Test**: MOD-001 (FoodApiController)

#### Test Case: ITP-001-A (FoodApiController→FoodDaoRepository read-by-`id` contract on RESOLVED hit) `TC-ITP-001-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 reads the golden record via the DAO layer (ARCH-014 → ARCH-006) and
returns it as `200 OK` **only** when `status='RESOLVED'`, without calling any source.
**Trace**: ARCH-001 → ARCH-014 → ARCH-006 (MOD-001/MOD-016/MOD-006); REQ-002, REQ-IF-001.

- **Integration Scenario: ITS-001-A1**
    - **Given** ARCH-014 `findById(id)` returns an assembled `GoldenRecord` for a food whose `status='RESOLVED'` (golden scalars + nutrients + portions + provenance)
    - **When** ARCH-001 handles `GET /v1/foods/{id}` and invokes `findById(id)` on ARCH-014
    - **Then** the ARCH-001↔ARCH-014 handshake completes with ARCH-001 returning `200 OK` carrying `{ id, name, status:'RESOLVED', nutrients[], portions[], provenance{} }` — no `fdcId` in any field, and no ARCH-013/ARCH-008 source call is made

- **Integration Scenario: ITS-001-A2**
    - **Given** ARCH-014 `findById(id)` returns `null` (no such row)
    - **When** ARCH-001 handles `GET /v1/foods/{id}`
    - **Then** ARCH-001 returns `404 Not Found` and crosses no enqueue boundary (ARCH-002/ARCH-003 receive zero calls — a read never enqueues)

#### Test Case: ITP-001-B (FoodApiController input-validation gate — no invalid input reaches the enqueue boundary) `TC-ITP-001-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 rejects a malformed `id` (non-ULID) and an empty/whitespace name
before any downstream module boundary is crossed, so ARCH-014 (`createByName`) and ARCH-002/ARCH-003
(enqueue) never receive invalid input.
**Trace**: ARCH-001 → ARCH-014/ARCH-002/ARCH-003 (MOD-001); REQ-006.

- **Integration Scenario: ITS-001-B1**
    - **Given** ARCH-001 receives `GET /v1/foods/not-a-ulid` (path param is not a 26-char Crockford ULID), with spies on ARCH-014 `findById` and ARCH-002 `publishFoodRequested`
    - **When** ARCH-001 performs ULID validation before invoking any downstream module
    - **Then** ARCH-001 returns `400 Bad Request` and ARCH-014/ARCH-002 receive **zero** calls

- **Integration Scenario: ITS-001-B2**
    - **Given** ARCH-001 receives `POST /v1/foods` with `{ name: "   " }` (whitespace-only), with a spy on ARCH-014 `createByName`
    - **When** ARCH-001 performs name validation at its boundary
    - **Then** ARCH-001 returns `400 Bad Request`, **no** `food` row is created (ARCH-014 `createByName` receives zero calls), and nothing is enqueued (REQ-006)

#### Test Case: ITP-001-C (FoodApiController add-by-name → create+dedup → enqueue handshake) `TC-ITP-001-C`

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies the add-by-name miss path: ARCH-001 normalizes the name, calls ARCH-014
`createByName` (advisory-lock dedup) to obtain the food `id`, passes the per-`sub` fairness gate
(ARCH-012 `admitEnqueue`), enqueues via ARCH-002 → ARCH-003 (`INSERT … ON CONFLICT (food_id)` + `pg_notify`),
and returns `202 Accepted { status:'PENDING', id }`.
**Trace**: ARCH-001 → ARCH-014 → ARCH-012 → ARCH-002 → ARCH-003 (MOD-001/MOD-016/MOD-013/MOD-002/MOD-003);
REQ-005, REQ-047, REQ-IF-009.

- **Integration Scenario: ITS-001-C1**
    - **Given** no `food` row exists for `normalizeName("broccoli")`, the caller is below the 50-pending demotion threshold, with a spy on ARCH-002 `publishFoodRequested`
    - **When** ARCH-001 handles `POST /v1/foods { "name": "broccoli" }` — `createByName` on ARCH-014 returns `{ id, created:true }` (status `PENDING`), `admitEnqueue` returns `isDemoted=false`
    - **Then** ARCH-001 sends exactly one `publishFoodRequested({ id, requestedBy: sub })` to ARCH-002 and returns `202 Accepted { id, status:'PENDING', estimatedWaitSeconds }` — the returned `id` is the ULID created by ARCH-014, never a source key

#### Test Case: ITP-001-D (FoodApiController status-mapping seam: PENDING/UNRESOLVED → 202; NOT_FOUND/FAILED → 404 with status) `TC-ITP-001-D`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the lifecycle-status → HTTP-status mapping at the ARCH-001↔ARCH-014 seam: a held
row that is not yet `RESOLVED` returns `202` (poll handle), a terminal `NOT_FOUND`/`FAILED` returns `404`
with the lifecycle `status` still retrievable (so a client holding the `id` can see _why_), and a read
never enqueues.
**Trace**: ARCH-001 → ARCH-014 (MOD-001); REQ-003, REQ-004, REQ-007.

- **Integration Scenario: ITS-001-D1**
    - **Given** ARCH-014 `findById(id)` returns a row with `status='PENDING'` (then a second row with `status='UNRESOLVED'`)
    - **When** ARCH-001 handles `GET /v1/foods/{id}` for each
    - **Then** ARCH-001 returns `202 Accepted { id, status }` for both (the food is held but not resolved), and sends **zero** enqueue calls to ARCH-002 (a read never re-enqueues)

- **Integration Scenario: ITS-001-D2**
    - **Given** ARCH-014 `findById(id)` returns a row with `status='NOT_FOUND'` (then a row with `status='FAILED'`), with a spy on ARCH-002 `publishFoodRequested`
    - **When** ARCH-001 handles `GET /v1/foods/{id}` for each
    - **Then** ARCH-001 returns `404` with the lifecycle `status` retrievable in the body, and ARCH-002 receives **zero** calls — terminal states do not re-enqueue on a plain read (REQ-004)

#### Test Case: ITP-001-E (FoodApiController NOT_FOUND tombstone-TTL re-attempt seam) `TC-ITP-001-E`

**Technique**: Interface Contract Testing + Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the `NOT_FOUND` tombstone-TTL seam (clarified 2026-06-21, default 30 days): a fresh
**add-by-name** for a name whose food is a `NOT_FOUND` tombstone within its TTL does **not** cross the
enqueue boundary; once the TTL has lapsed, a later add re-attempts (a source may since have the item),
counting against the normal rolling-window budget so it cannot bypass the rate limit.
**Trace**: ARCH-001 → ARCH-014 → ARCH-002/ARCH-003 (MOD-001/MOD-016/MOD-003); REQ-025.

- **Integration Scenario: ITS-001-E1**
    - **Given** ARCH-014 holds a `NOT_FOUND` tombstone for `normalizeName("dragonfruit jerky")` whose age is **within** the 30-day TTL, with a spy on ARCH-002 `publishFoodRequested`
    - **When** ARCH-001 handles a fresh `POST /v1/foods { "name": "dragonfruit jerky" }` (it collapses to the existing tombstoned `id`)
    - **Then** ARCH-001 returns `404`/`202` reflecting the tombstone `status` and sends **zero** `publishFoodRequested` calls to ARCH-002 — within TTL → no re-enqueue (REQ-025)

- **Integration Scenario: ITS-001-E2**
    - **Given** ARCH-014 holds a `NOT_FOUND` tombstone whose age has **exceeded** the 30-day TTL
    - **When** ARCH-001 handles a fresh add-by-name for that name
    - **Then** ARCH-001 enqueues a re-attempt — exactly one `publishFoodRequested({ id, requestedBy: sub })` to ARCH-002 (against the normal rolling-window budget) — and returns `202 { status:'PENDING' }` while the re-fetch is in flight

---

### Module Verification: ARCH-002 (EnqueueEmitter)

**Parent System Components**: SYS-002
**Modules Under Test**: MOD-002 (EnqueueEmitter)

#### Test Case: ITP-002-A (EnqueueEmitter→Postgres `fetch_queue` enqueue contract for add-by-name demand) `TC-ITP-002-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-002 validates the demand payload (food `id` + `requestedBy` provenance)
and performs the **direct Postgres enqueue** via ARCH-003 — `INSERT … ON CONFLICT (food_id)` + the
distinct-requester upsert + `NOTIFY 'fetch_queued'` — returning `{ enqueued: true }`. The demand path does
**not** use EventBridge; EventBridge is retained only for scheduled producers and the `FoodDataReceived`
completion event (ITP-002-C). Payloads carry the food `id`, never `fdcId`.
**Trace**: ARCH-002 → ARCH-003 (MOD-002/MOD-003); REQ-011, REQ-014, REQ-017.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-001 sends `publishFoodRequested({ id, requestedBy: 'user_abc' })` to ARCH-002
    - **When** ARCH-002 validates the payload and performs the direct Postgres enqueue handshake (ARCH-003 `enqueue` → requester upsert + `INSERT … ON CONFLICT (food_id)` + `NOTIFY 'fetch_queued'`)
    - **Then** the handshake completes with `{ enqueued: true }` and a `fetch_queue` row keyed on `food_id` visible to ARCH-004 (consistent with ITP-003-A), and **no** EventBridge event is emitted on this path

- **Integration Scenario: ITS-002-A2**
    - **Given** ARCH-001 sends `publishFoodBatchRequested({ ids:[id1,id2,id3], requestedBy:'user_abc' })` to ARCH-002
    - **When** ARCH-002 fans the batch into per-`id` `publishFoodRequested` calls (each a `fetch_queue` `INSERT … ON CONFLICT (food_id)` + `NOTIFY`)
    - **Then** ARCH-002 returns `{ enqueued: 3 }` and three demand rows land in ARCH-003's `fetch_queue`, each carrying low/zero distinct-requester demand so they sort after high-demand rows (demand-weighted order, not a separate tier)

#### Test Case: ITP-002-B (EnqueueEmitter rejects malformed / unprovenanced payloads before enqueue) `TC-ITP-002-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-002 performs input validation and does **not** insert into the Postgres
`fetch_queue` (no INSERT, no `NOTIFY`) when the food `id` is malformed or the `requestedBy` provenance is
missing (the latter preserves US-0 on the async edge — no enqueue without an authenticated principal).
**Trace**: ARCH-002 → ARCH-003 (MOD-002/MOD-014); REQ-042.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-001 sends `publishFoodRequested({ id: 'not-a-ulid', requestedBy:'user_abc' })` to ARCH-002
    - **When** ARCH-002 validates the payload at its boundary
    - **Then** ARCH-002 throws `ValidationError` to ARCH-001 without an `INSERT INTO fetch_queue` or a `NOTIFY`

- **Integration Scenario: ITS-002-B2**
    - **Given** ARCH-001 sends `publishFoodRequested({ id, requestedBy: '' })` (missing provenance)
    - **When** ARCH-002 validates the payload
    - **Then** ARCH-002 rejects it with `ValidationError` and the ARCH-003 enqueue boundary is never crossed — no fetch can be driven without authenticated provenance (REQ-042)

#### Test Case: ITP-002-C (EnqueueEmitter→EventBridge contract for scheduled + completion events only) `TC-ITP-002-C`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the **only** events ARCH-002 puts on EventBridge are the scheduled producer
(`IngestionScheduled`, drives ARCH-018) and the fire-and-forget `FoodDataReceived` completion event — and
that `FoodDataReceived` carries the food `id`, never `fdcId`, and never throws on a failed put.
**Trace**: ARCH-002 → EventBridge → ARCH-018/ARCH-009 (MOD-002); REQ-032, REQ-034.

- **Integration Scenario: ITS-002-C1**
    - **Given** ARCH-004 finishes resolving a food and calls `publishFoodDataReceived({ id, status:'RESOLVED' })`
    - **When** ARCH-002 puts the entry on the EventBridge default bus
    - **Then** the entry's `DetailType='FoodDataReceived'` and its detail is `{ id, status }` (id-keyed, no `fdcId`); a non-zero `FailedEntryCount` is logged, not thrown (fire-and-forget)

---

### Module Verification: ARCH-003 (FetchQueueRouter)

**Parent System Components**: SYS-002, SYS-003, SYS-004
**Modules Under Test**: MOD-003 (FetchQueueRouter)

#### Test Case: ITP-003-A (FetchQueueRouter enqueues demand into the single demand-weighted Postgres `fetch_queue` keyed on `food_id`) `TC-ITP-003-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-003 accepts demand-path enqueues keyed on `food_id` — the
distinct-requester upsert into `fetch_requesters` (`ON CONFLICT (food_id, sub) DO NOTHING`) followed by
the `INSERT INTO fetch_queue … ON CONFLICT (food_id)` setting `request_count` to the **capped
distinct-`sub` count** (PRIORITY_CAP=1, never a raw `+1`) plus `NOTIFY`. There is no priority column and no
high/low tier — every row lands in the one `fetch_queue` ordered by `request_count DESC, first_requested ASC`.
The status enum is `pending | in_flight | tombstone`.
**Trace**: ARCH-003 ↔ Postgres `fetch_queue`/`fetch_requesters` → ARCH-004 (MOD-003); REQ-014, REQ-015, REQ-044.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-001 resolves an add-by-name miss for one food `id` and invokes `enqueue(id, sub)` (after `admitEnqueue`)
    - **When** ARCH-003 upserts `(food_id, sub)` into `fetch_requesters` (ON CONFLICT DO NOTHING) then `INSERT INTO fetch_queue` with the capped distinct-requester `request_count` + `NOTIFY 'fetch_queued'`
    - **Then** the row commits, a `LISTEN/NOTIFY` signal is emitted, and the ARCH-004 fan-out/merge worker leases the highest-demand `pending` row (`FOR UPDATE SKIP LOCKED`, demand order, status→`in_flight`)

- **Integration Scenario: ITS-003-A2**
    - **Given** a background / refresh enqueue (`requestedBy='svc_change_refresh'`) for a food `id` with zero distinct end-user demand
    - **When** ARCH-003 commits the row
    - **Then** the row carries low `request_count` and sorts **after** high-demand end-user rows under the demand-weighted ORDER BY — a separate low-priority tier is not needed (demand weight alone orders it)

#### Test Case: ITP-003-B (FetchQueueRouter tombstone handshake on persistent processing failure) `TC-ITP-003-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-003 transitions a row to `status='tombstone'` (the DLQ analog + audit
trail; no SQS DLQ) when it cannot be processed — ≤5 attempts with exponential backoff then tombstone, and a
`NOT_FOUND` tombstone carries the 30-day TTL.
**Trace**: ARCH-003 (MOD-003); REQ-016, REQ-025, REQ-027.

- **Integration Scenario: ITS-003-B1**
    - **Given** a `fetch_queue` row has exhausted its retry budget (`attempts > 5`, exponential backoff applied via `requeueWithBackoff`)
    - **When** ARCH-004 reaches the terminal retry and calls `tombstone(food_id, lastError)`
    - **Then** ARCH-003 sets `status='tombstone'` and records `last_error`; the row is no longer leased, and the audit trail is preserved (no row deletion)

#### Test Case: ITP-003-C (FetchQueueRouter distinct-requester dedup collapse under concurrent adds) `TC-ITP-003-C`

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies the queue-grain dedup seam (FR-044): when multiple authenticated `sub`s
concurrently add the **same** food `id`, the `INSERT … ON CONFLICT (food_id)` collapses to a **single**
`fetch_queue` row whose `request_count` equals the **capped distinct-`sub`** count — never a raw increment,
never duplicate rows — so a single food is fetched once however many requesters demand it.
**Trace**: ARCH-003 ↔ Postgres (MOD-003); REQ-013, REQ-014, REQ-044.

- **Integration Scenario: ITS-003-C1**
    - **Given** three distinct `sub`s (`user_a`, `user_b`, `user_a` again) concurrently call `enqueue(id, sub)` for the same food `id` against a real Postgres instance
    - **When** all three execute the requester upsert + `INSERT … ON CONFLICT (food_id)` simultaneously
    - **Then** exactly **one** `fetch_queue` row exists for that `food_id`, `fetch_requesters` holds exactly two rows (`user_a` counted once via `PK(food_id, sub)`), and `request_count` reflects the capped distinct-`sub` count (PRIORITY_CAP=1) — no duplicate queue row, no double counting

---

### Module Verification: ARCH-004 (FoodConsumerService)

**Parent System Components**: SYS-005
**Modules Under Test**: MOD-004 (FoodConsumerService), MOD-014 (AsyncProducerAuthz)

#### Test Case: ITP-004-A (FoodConsumerService→RollingWindowLimiter per-source gate before each source call) `TC-ITP-004-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that, per wired adapter, ARCH-004 calls ARCH-005's `checkAndRecordCall(source)`
(count the source's trailing-60-min calls and atomically record the new one) **before** invoking that
source's adapter, and that the per-source result gates the call.
**Trace**: ARCH-004 → ARCH-005 → ARCH-013/ARCH-008 (MOD-004/MOD-005/MOD-015); REQ-019, REQ-020.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-005 returns `{ allowed: true, windowCount: 153 }` for `source='usda'` (below the 900 pause threshold; the call is recorded), and `shouldPauseDraining('usda')` is false
    - **When** ARCH-004 leases a row and, for the USDA adapter, calls `checkAndRecordCall('usda')` before fanning out
    - **Then** ARCH-004 proceeds to call the USDA adapter (ARCH-008 via ARCH-013) and does not defer the lease

- **Integration Scenario: ITS-004-A2**
    - **Given** ARCH-005 `shouldPauseDraining('usda')` returns true (trailing-60-min count ≥ 900 / 90%), so no new USDA call is recorded
    - **When** ARCH-004 evaluates the per-source gate before the USDA fan-out
    - **Then** ARCH-004 **pauses** draining USDA work — reverts the `in_flight` lease to `status='pending'` via `requeueWithBackoff(getWaitTime('usda')+5)` — and does NOT call ARCH-008; the row resumes once that source's earlier calls age out (per-source pause, ITP-005-C)

#### Test Case: ITP-004-B (FoodConsumerService fan-out → merge → persist → provenance data flow) `TC-ITP-004-B`

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the end-to-end fan-out/merge data flow across module boundaries: lease row → read
`food.name` → iterate the adapter registry (ARCH-013) per-source-rate-limited (ARCH-005) → validate at the
adapter boundary (ARCH-019) → pre-merge → golden-record merge (ARCH-015) → persist the golden record +
crosswalk + provenance via the DAO layer (ARCH-014 → ARCH-006 / ARCH-017) → set `status='RESOLVED'` →
resolve the `fetch_queue` row → publish `FoodDataReceived`.
**Trace**: ARCH-004 → ARCH-013 → ARCH-005 → ARCH-008 → ARCH-019 → ARCH-015 → ARCH-014 → ARCH-006/ARCH-017 →
ARCH-002 (MOD-004/MOD-015/MOD-005/MOD-008/MOD-021/MOD-017/MOD-016/MOD-019); REQ-MRG-1, REQ-050, REQ-052.

- **Integration Scenario: ITS-004-B1**
    - **Given** ARCH-004 leases the highest-demand `fetch_queue` row `{ food_id, requested_by }`, ARCH-005 allows the USDA call, and the USDA adapter returns one validated `CanonicalCandidate` for the food's name
    - **When** ARCH-004 fans out across `SourceAdapterRegistry.adapters()` (USDA only today), collects the candidate (validated by ARCH-019 inside the adapter), pre-merges, calls `GoldenRecordMergeEngine.merge(candidates)` (ARCH-015), then `upsertGoldenRecord(food_id, golden, 'RESOLVED')` on ARCH-014
    - **Then** the chain completes: ARCH-006 persists `food` (status `RESOLVED`), `food_sources` (`UNIQUE(source, external_key)`, `item_version`), `food_nutrients`/`food_portions` (`source_id`); ARCH-017 records per-field provenance; ARCH-004 calls `FetchQueueRouter.resolve(food_id)` (row cleared) and `publishFoodDataReceived({ id, status:'RESOLVED' })`

#### Test Case: ITP-004-C (FoodConsumerService retry with exponential backoff on a single-source error) `TC-ITP-004-C`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-004 applies the FR-016 retry semantics (≤5 attempts, exponential
backoff, then tombstone) when a source adapter returns a transient error — without resolving the
`fetch_queue` row — and treats a source `429` as a window-full backoff for that source.
**Trace**: ARCH-004 → ARCH-008 → ARCH-005 → ARCH-003 (MOD-004); REQ-016, REQ-026, REQ-027.

- **Integration Scenario: ITS-004-C1**
    - **Given** the USDA adapter returns a `5xx` to ARCH-004 on first invocation (`row.attempts < 5`)
    - **When** ARCH-004 catches the source error during fan-out
    - **Then** ARCH-004 does NOT resolve the row; it calls `requeueWithBackoff(food_id, …, attempts)` (exponential, REQ-016), the row returns to `status='pending'`, and is re-claimable after the backoff

- **Integration Scenario: ITS-004-C2**
    - **Given** the USDA adapter returns `429 Too Many Requests` to ARCH-004 despite the limiter
    - **When** ARCH-004 catches the `429`
    - **Then** ARCH-004 calls `ARCH-005.markWindowFull('usda')` and `requeueWithBackoff(food_id, 60, attempts)` — it stops draining USDA work and re-queues, rather than resetting the window (REQ-026)

#### Test Case: ITP-004-D (FoodConsumerService terminal disposition seam: NOT_FOUND vs FAILED tombstone) `TC-ITP-004-D`

**Technique**: Interface Contract Testing + Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the worker's two terminal dispositions at the ARCH-004↔ARCH-014↔ARCH-003 seam: when
**no** wired source has the item, the food becomes `NOT_FOUND` (terminal tombstone, 30-day TTL, no retry);
when **every** source errored after the retry budget is exhausted, the food becomes `FAILED`. Both set the
food `status` via ARCH-014, tombstone the `fetch_queue` row via ARCH-003, and publish `FoodDataReceived`.
**Trace**: ARCH-004 → ARCH-014 → ARCH-003 → ARCH-002 (MOD-004); REQ-025, REQ-027.

- **Integration Scenario: ITS-004-D1**
    - **Given** the fan-out across all wired adapters returns **zero** candidates and **zero** source errors (no source has the item)
    - **When** ARCH-004 finishes processing the row
    - **Then** ARCH-004 calls `updateStatus(food_id, 'NOT_FOUND', tombstonedAt)` on ARCH-014, `tombstone(food_id, 'no_source_has_item')` on ARCH-003 (30-day TTL), and `publishFoodDataReceived({ id, status:'NOT_FOUND' })` — no retry within the TTL (REQ-025)

- **Integration Scenario: ITS-004-D2**
    - **Given** every wired source errored on each attempt and `row.attempts >= 5` (retry budget exhausted)
    - **When** ARCH-004 finishes processing the row
    - **Then** ARCH-004 calls `updateStatus(food_id, 'FAILED', tombstonedAt)`, `tombstone(food_id, 'all_sources_errored')`, and `publishFoodDataReceived({ id, status:'FAILED' })` — distinct from `NOT_FOUND` (a source failure, not an absence) (REQ-027)

#### Test Case: ITP-004-E (FoodConsumerService async-producer provenance gate before any source consumption) `TC-ITP-004-E`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the async-edge provenance seam (US-0): ARCH-004 (via MOD-014) validates the leased
row's `requested_by` provenance **before** calling ARCH-005/ARCH-008, so a row whose provenance is absent
or not an authorized least-privilege principal is rejected (tombstoned) and never drives a source call.
**Trace**: ARCH-004 → MOD-014 → ARCH-005/ARCH-008 (MOD-004/MOD-014); REQ-042, REQ-048-analog.

- **Integration Scenario: ITS-004-E1**
    - **Given** ARCH-004 leases a `fetch_queue` row whose `requested_by` is absent / the generic `'system'` marker (forged or unprovenanced), with spies on ARCH-005 `checkAndRecordCall` and the USDA adapter
    - **When** ARCH-004 runs `AsyncProducerAuthz.assertEnqueueProvenance` first
    - **Then** ARCH-004 rejects the row (tombstones it) and invokes **neither** ARCH-005 nor ARCH-008 — every accepted fetch traces to an authenticated caller or an authorized internal principal

- **Integration Scenario: ITS-004-E2**
    - **Given** ARCH-004 leases a row whose `requested_by` is a named, allowlisted least-privilege principal
    - **When** ARCH-004 validates provenance
    - **Then** ARCH-004 accepts the row and proceeds to the ARCH-005 per-source check-and-record → adapter fan-out path — the synchronous auth guarantee extends to the async edge

---

### Module Verification: ARCH-005 (RollingWindowLimiter — per source)

**Parent System Components**: SYS-006 `[CROSS-CUTTING]`
**Modules Under Test**: MOD-005 (RollingWindowLimiter)

#### Test Case: ITP-005-A (RollingWindowLimiter atomic per-source count-and-record under concurrent worker access) `TC-ITP-005-A`

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-005's atomic per-source count-and-record on the `source_call_log`
(Postgres `INSERT … WHERE (trailing-60-min count for THIS source) < cap RETURNING`; deferred Redis
sorted-set Lua variant) counts the trailing-60-min calls **for that source** and records the new one in one
atomic step, so no source's window is ever overshot under concurrent ARCH-004 access (USDA ≤1,000;
REQ-019/REQ-020).
**Trace**: ARCH-005 ↔ Postgres `source_call_log` (MOD-005); REQ-019, REQ-020.

- **Integration Scenario: ITS-005-A1**
    - **Given** `source_call_log` already holds **999** `usda` calls within the trailing 60 minutes (one below the 1,000 cap) and two ARCH-004 paths simultaneously call `checkAndRecordCall('usda')`
    - **When** both execute the atomic count-and-record concurrently against a real Postgres instance
    - **Then** exactly one receives `{ allowed: true, windowCount: 1000 }` (its call is recorded) and the other `{ allowed: false, windowCount: 1000 }` — the USDA cap is never breached and no call is double-recorded

- **Integration Scenario: ITS-005-A2**
    - **Given** `source_call_log` is empty for `usda` in the trailing 60 minutes and 1,500 concurrent `checkAndRecordCall('usda')` invocations execute
    - **When** all 1,500 run the atomic count-and-record simultaneously
    - **Then** exactly 1,000 receive `{ allowed: true }` and the remaining 500 `{ allowed: false }` — the per-source trailing-60-min window is atomically capped at the USDA hardCap

#### Test Case: ITP-005-B (RollingWindowLimiter→call-log-store fault: fail closed) `TC-ITP-005-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-005 propagates a `source_call_log` store-unavailability error to ARCH-004
so the worker fails safely (does **not** call the source) — the limiter fails closed rather than assuming an
empty window.
**Trace**: ARCH-005 → ARCH-004 → ARCH-008 (MOD-005/MOD-004); REQ-020.

- **Integration Scenario: ITS-005-B1**
    - **Given** the `source_call_log` store is unavailable when ARCH-004 calls `checkAndRecordCall('usda')`
    - **When** ARCH-005 attempts the atomic count-and-record
    - **Then** ARCH-005 throws `RateLimitWindowFullError` to ARCH-004, which treats it as not-allowed and re-queues the row with backoff — no USDA call is made

#### Test Case: ITP-005-C (RollingWindowLimiter per-source pause / resume seam) `TC-ITP-005-C`

**Technique**: Interface Contract Testing
**Target View**: Interface View + Process View
**Description**: Verifies the per-source pause/resume seam: ARCH-005 reports `shouldPauseDraining(source)` at
90% so ARCH-004 pauses draining **only that source's** work, and `getWaitTime(source)` returns the seconds
until that source's oldest in-window call ages out, after which the row resumes. Each wired source has its
own independent window — pausing one source does not block another.
**Trace**: ARCH-005 ↔ ARCH-004 (MOD-005/MOD-004); REQ-019, REQ-021, REQ-026.

- **Integration Scenario: ITS-005-C1**
    - **Given** `source_call_log` holds 900 `usda` calls in the trailing window (pauseThreshold reached) and 0 calls for a hypothetical second source
    - **When** ARCH-004 consults `shouldPauseDraining('usda')` and `getWaitTime('usda')`
    - **Then** ARCH-005 returns pause=true with a positive wait for `usda`, ARCH-004 defers that row via `requeueWithBackoff(getWaitTime+5)`, and work needing the second source (pause=false) is unaffected — the windows are per-source

- **Integration Scenario: ITS-005-C2**
    - **Given** enough of the USDA window's oldest calls have aged past 60 minutes that the trailing count falls below the pauseThreshold
    - **When** the deferred row is re-leased and ARCH-004 re-consults `shouldPauseDraining('usda')`
    - **Then** ARCH-005 returns pause=false and ARCH-004 resumes draining USDA work — resume is driven purely by calls aging out of the rolling window (no separate refill timer)

---

### Module Verification: ARCH-006 (FoodPostgresRepository)

**Parent System Components**: SYS-007
**Modules Under Test**: MOD-006 (FoodPostgresRepository)

#### Test Case: ITP-006-A (FoodPostgresRepository golden-record upsert + read contract with the DAO layer) `TC-ITP-006-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-006 persists and reassembles a normalized, provenance-bearing golden
record on behalf of ARCH-014: writing `food` scalars, the `food_sources` crosswalk
(`UNIQUE(source, external_key)`, `item_version`), normalized `food_nutrients`/`food_portions` (`source_id`),
and `food_field_provenance`; and reading them back via `findGoldenRecord(id)`. No `fdcId`, no denormalized
nutrient columns, no `fetch_status`.
**Trace**: ARCH-014 → ARCH-006 (MOD-016/MOD-006); REQ-028, REQ-CN-007.

- **Integration Scenario: ITS-006-A1**
    - **Given** ARCH-014 calls `upsertGoldenRecord(food_id, golden, 'RESOLVED')` against a real Postgres instance with the 12-table canonical schema
    - **When** ARCH-006 executes the transactional upsert across `food`, `food_sources`, `food_nutrients`, `food_portions`, `food_field_provenance`
    - **Then** a subsequent `findGoldenRecord(food_id)` returns the assembled `GoldenRecord` with `status='RESOLVED'`, nutrients on a `per_100g` basis carrying `source_id`, and per-field provenance — and the `food_sources` row is keyed on `(source, external_key)`, never `fdcId`

- **Integration Scenario: ITS-006-A2**
    - **Given** ARCH-006 holds a `food` row with `status='UNRESOLVED'`
    - **When** ARCH-014 calls `findById(id)`
    - **Then** ARCH-006 returns the partial golden record with `status='UNRESOLVED'` (so ARCH-001 maps it to `202` and ARCH-016 can list candidates)

#### Test Case: ITP-006-B (FoodPostgresRepository search data-flow boundary: pg_trgm, local-only) `TC-ITP-006-B`

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-006 transforms a search query into a PostgreSQL pg_trgm/`ILIKE` query
over `name`/`description` and returns `{ id, name, score }[]` ranked by relevance — including
barcode/`external_key` lookup via the crosswalk — entirely from the local store (no source call).
**Trace**: ARCH-014 → ARCH-006 (MOD-016/MOD-006); REQ-008, REQ-010.

- **Integration Scenario: ITS-006-B1**
    - **Given** ARCH-014 calls `searchByName('chicken breast')` against a Postgres instance with the pg_trgm extension and seeded `food` rows
    - **When** ARCH-006 executes the `name % $1 OR description ILIKE …` query
    - **Then** ARCH-006 returns `{ id, name, score }[]` ranked by similarity — id-keyed, no source call

- **Integration Scenario: ITS-006-B2**
    - **Given** a `food_sources` crosswalk row with `external_key` equal to a scanned barcode
    - **When** ARCH-014 calls `findByExternalKey(source, barcode)`
    - **Then** ARCH-006 returns `{ id }` via the `UNIQUE(source, external_key)` index — barcode resolves to the internal `id`

#### Test Case: ITP-006-C (FoodPostgresRepository connection-error propagation) `TC-ITP-006-C`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-006 propagates PostgreSQL connection errors to callers (ARCH-014 → ARCH-001
/ ARCH-004) without swallowing them, so a read returns `503` and a worker upsert re-queues.
**Trace**: ARCH-006 → ARCH-014 → ARCH-001/ARCH-004 (MOD-006/MOD-016); REQ-028.

- **Integration Scenario: ITS-006-C1**
    - **Given** PostgreSQL is unavailable when ARCH-004 (via ARCH-014) calls `upsertGoldenRecord`
    - **When** ARCH-006 attempts the transaction
    - **Then** ARCH-006 throws `PostgresConnectionError`; the transaction rolls back; ARCH-004 does NOT resolve the `fetch_queue` row (it re-queues with backoff per REQ-016)

---

### Module Verification: ARCH-007 (FoodCacheService — optional, deferred)

**Parent System Components**: SYS-008
**Modules Under Test**: MOD-007 (FoodCacheService)

#### Test Case: ITP-007-A (FoodCacheService cache-through data flow when the deferred variant is enabled) `TC-ITP-007-A`

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the optional hot-cache cache-through flow (deferred Redis variant): ARCH-001
consults ARCH-007 `get(id)` first, falls through to ARCH-014/ARCH-006 on miss, and the result is keyed on
the internal `id` (`food:{id}`). The lean-launch default has no shared cache — this case applies only when
the variant is enabled.
**Trace**: ARCH-001 → ARCH-007 → ARCH-014/ARCH-006 (MOD-001/MOD-007/MOD-016); REQ-030, REQ-001.

- **Integration Scenario: ITS-007-A1**
    - **Given** the deferred Redis variant is enabled, ARCH-007 `get(id)` returns `null` (miss), and ARCH-014 returns a `RESOLVED` golden record
    - **When** ARCH-001 handles `GET /v1/foods/{id}` — consults ARCH-007 then falls through to ARCH-014
    - **Then** the data flows ARCH-006 → ARCH-014 → ARCH-001 → `200 OK`, keyed on the internal `id`; pending-fetch dedup is NOT a Redis set (it is the `fetch_queue` `ON CONFLICT` row in ARCH-003)

#### Test Case: ITP-007-B (FoodCacheService unavailability fault: fall through, don't 503) `TC-ITP-007-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that when the optional cache store is unavailable, ARCH-007 returns an error/`null`
to ARCH-001 so ARCH-001 falls through to ARCH-014/ARCH-006 rather than failing the request — the cache is
strictly optional.
**Trace**: ARCH-007 → ARCH-001 → ARCH-014 (MOD-007/MOD-001); REQ-030.

- **Integration Scenario: ITS-007-B1**
    - **Given** the Redis variant is enabled but Redis is unavailable when ARCH-001 calls `get(id)`
    - **When** ARCH-007 attempts the GET
    - **Then** ARCH-007 returns an error/`null` and ARCH-001 falls through to ARCH-014 `findById(id)` rather than returning `503` — availability over cache

---

### Module Verification: ARCH-008 (UsdaApiClient — the _only_ `fdcId` boundary)

**Parent System Components**: SYS-009
**Modules Under Test**: MOD-008 (UsdaApiClient)

> ARCH-008 is the **only** module where `fdcId` and USDA terms appear; it maps `fdcId → external_key`
> inbound and implements the `FoodSourceAdapter` interface registered in ARCH-013. These are the only
> integration tests that may reference `fdcId`.

#### Test Case: ITP-008-A (UsdaApiClient→USDA API adapter contract: search + fetch, `fdcId → external_key`) `TC-ITP-008-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-008 implements `FoodSourceAdapter` — `searchByName(name)` returns
`SourceCandidate[]` and `fetchByKey(externalKey)` fetches the USDA item (`fdcId` internally) over HTTPS,
maps it to a `CanonicalCandidate` (validated by ARCH-019), and exposes **only** `external_key` past the
adapter boundary. The `fdcId → external_key` mapping happens here and nowhere else.
**Trace**: ARCH-004/ARCH-013 → ARCH-008 → USDA API (MOD-008/MOD-015); REQ-023, REQ-046, REQ-IF-005, REQ-IF-012.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-004 (via ARCH-013) calls `searchByName('broccoli')` on the USDA adapter with a valid API key from ARCH-010, with the USDA API mocked (nock)
    - **When** ARCH-008 issues the HTTPS search and then `fetchByKey(externalKey)` for a hit
    - **Then** ARCH-008 returns a `CanonicalCandidate` carrying `{ source:'usda', externalKey, name, nutrients[], portions[], itemVersion }` — the USDA `fdcId` is mapped to `external_key` at the boundary and never surfaces to ARCH-004/ARCH-015

#### Test Case: ITP-008-B (UsdaApiClient error classification and propagation) `TC-ITP-008-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-008 classifies USDA API errors (401, 429, 5xx) and propagates them so
ARCH-004 applies the correct disposition (429 → per-source window-full backoff; 5xx → retry budget; 401 →
distinct auth error).
**Trace**: ARCH-008 → ARCH-004 (MOD-008/MOD-004); REQ-024, REQ-026.

- **Integration Scenario: ITS-008-B1**
    - **Given** the USDA API (mocked) returns `429 Too Many Requests`
    - **When** ARCH-008 receives the 429
    - **Then** ARCH-008 raises a rate-limit-classified `SourceApiError(status=429)` to ARCH-004, which calls `markWindowFull('usda')` + backoff (ITP-004-C2) — not a terminal failure

- **Integration Scenario: ITS-008-B2**
    - **Given** the USDA API returns `401 Unauthorized` (invalid key)
    - **When** ARCH-008 receives the 401
    - **Then** ARCH-008 raises an authentication-classified error, distinct from transient 5xx/429 — so ARCH-004 does not treat a key problem as a retriable source error

---

### Module Verification: ARCH-009 (WebSocketNotifier — deferred, US-9)

**Parent System Components**: SYS-010 `[CROSS-CUTTING]`
**Modules Under Test**: MOD-009 (WebSocketNotifier)

#### Test Case: ITP-009-A (WebSocketNotifier→API Gateway WebSocket contract for FoodDataReceived events) `TC-ITP-009-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-009 receives `FoodDataReceived` events (carrying the food `id`) from
EventBridge and pushes notifications to connected clients via the API Gateway WebSocket API, targeted
per-recipient via the `fetch_requesters` subscription set. Launch-deferred (US-9).
**Trace**: EventBridge → ARCH-009 → API GW WebSocket (MOD-009); REQ-034.

- **Integration Scenario: ITS-009-A1**
    - **Given** EventBridge delivers `FoodDataReceived { id, status:'RESOLVED' }` to ARCH-009 and the subscription set lists two connected recipients for that `id`
    - **When** ARCH-009 invokes `notifyClients(id, data)` against the API Gateway WebSocket API (AWS SDK mocked)
    - **Then** ARCH-009 returns the count of clients notified (fire-and-forget; the payload is id-keyed, no `fdcId`)

#### Test Case: ITP-009-B (WebSocketNotifier graceful handling of disconnected clients) `TC-ITP-009-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 handles WebSocket connection errors gracefully (fire-and-forget)
without failing the EventBridge invocation.
**Trace**: ARCH-009 → API GW WebSocket (MOD-009); REQ-034.

- **Integration Scenario: ITS-009-B1**
    - **Given** all connected clients have disconnected before ARCH-009 receives the `FoodDataReceived` event (the SDK returns `GoneException`)
    - **When** ARCH-009 attempts `notifyClients(id, data)`
    - **Then** ARCH-009 returns `0` clients notified without throwing to EventBridge

---

### Module Verification: ARCH-010 (SecretManager)

**Parent System Components**: SYS-011 `[CROSS-CUTTING]`
**Modules Under Test**: MOD-010 (SecretManager)

#### Test Case: ITP-010-A (SecretManager→AWS Secrets Manager contract: per-source API key retrieval) `TC-ITP-010-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-010 retrieves a **per-source** API key (e.g. the USDA key) from AWS
Secrets Manager and provides it to the adapter (injected as a worker environment variable), and that the
key never appears in logs.
**Trace**: ARCH-010 → ARCH-008 / ARCH-011 (MOD-010); REQ-042, A-009.

- **Integration Scenario: ITS-010-A1**
    - **Given** AWS Secrets Manager (mocked) holds a valid USDA key under the per-source secret name
    - **When** ARCH-010 invokes `getSourceApiKey('usda')`
    - **Then** ARCH-010 returns the key string for the adapter, and the value does NOT appear in any ARCH-011 log output

#### Test Case: ITP-010-B (SecretManager fault propagation on secret not found) `TC-ITP-010-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 propagates a "secret not found" error so the adapter cannot make
unauthenticated source calls.
**Trace**: ARCH-010 → ARCH-008 (MOD-010); REQ-042.

- **Integration Scenario: ITS-010-B1**
    - **Given** AWS Secrets Manager does not contain the expected per-source key
    - **When** ARCH-010 invokes `getSourceApiKey('usda')`
    - **Then** ARCH-010 raises a "Secret not found" error and the USDA adapter is not invoked

---

### Module Verification: ARCH-011 (MonitoringLogger)

**Parent System Components**: SYS-012 `[CROSS-CUTTING]`
**Modules Under Test**: MOD-011 (MonitoringLogger)

#### Test Case: ITP-011-A (MonitoringLogger structured-log contract with ARCH-001 and ARCH-004) `TC-ITP-011-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011 accepts structured JSON log entries from ARCH-001 and ARCH-004 via
`logRequest()` with `requestId` correlation and emits them to CloudWatch without dropping fields.
**Trace**: ARCH-001/ARCH-004 → ARCH-011 (MOD-011); REQ-NF (observability).

- **Integration Scenario: ITS-011-A1**
    - **Given** ARCH-001 processes a `GET /v1/foods/{id}` with `requestId='req-abc'`
    - **When** ARCH-001 sends `logRequest('req-abc', { path:'/v1/foods/{id}', status:200 }, 45)` to ARCH-011
    - **Then** ARCH-011 emits a structured JSON entry to CloudWatch containing `requestId`, `path`, `status`, `duration` — no fields dropped, and the log carries the internal `id`, never `fdcId`

#### Test Case: ITP-011-B (MonitoringLogger metric emission: queue depth + per-source trailing-60-min call count) `TC-ITP-011-B`

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-011 receives metric data from ARCH-004 and ARCH-005 and emits CloudWatch
metrics for `fetch_queue` depth and the **per-source** trailing-60-min call count (plus the `UNRESOLVED`
backlog and tombstone-row count), so rolling-window compliance is verifiable.
**Trace**: ARCH-004/ARCH-005 → ARCH-011 (MOD-011); SC-002.

- **Integration Scenario: ITS-011-B1**
    - **Given** ARCH-005 returns `{ allowed: true, windowCount: 750 }` for `source='usda'`
    - **When** ARCH-004 sends `incrementMetric('source_calls_trailing_60min', 750)` (dimensioned by `source='usda'`) to ARCH-011
    - **Then** ARCH-011 emits the metric to CloudWatch with the correct namespace + per-source dimension (so the ≤1,000/hr USDA compliance is verifiable per SC-002)

#### Test Case: ITP-011-C (MonitoringLogger X-Ray trace boundary handshake) `TC-ITP-011-C`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011's `startTrace(reqId)` opens an X-Ray segment spanning the
ARCH-001→ARCH-014→ARCH-006 read chain.
**Trace**: ARCH-001 → ARCH-011 (MOD-011); REQ-NF (observability).

- **Integration Scenario: ITS-011-C1**
    - **Given** ARCH-001 begins processing a food read
    - **When** ARCH-001 sends `startTrace('req-abc')` to ARCH-011
    - **Then** ARCH-011 returns a `Segment` and the segment is visible in X-Ray with the correct `requestId` correlation

---

### Module Verification: ARCH-012 (FoodAuthGuard)

**Parent System Components**: SYS-013
**Modules Under Test**: MOD-012 (ClerkAuthMiddleware), MOD-013 (DemotionAndFairness), MOD-014 (AsyncProducerAuthz)
**Requirements**: REQ-035..042, REQ-043, REQ-044, REQ-045, REQ-046, REQ-047, REQ-051

> ARCH-012 is wired into the route stack **in front of** ARCH-001 (every HTTP route) and ARCH-009 (`$connect`).
> These tests verify the seam: the auth guard either admits a request to the downstream handler with an
> `AuthenticatedCaller`, or fails closed before any downstream module boundary (ARCH-014 create / ARCH-002
> publish / ARCH-003 enqueue / ARCH-008 source call) is crossed. Re-keyed `fdcId → id`; the operational
> endpoint is `POST /v1/foods/{id}/refetch`.

#### Test Case: ITP-012-A (FoodAuthGuard rejects unauthenticated requests before any create, enqueue, or source call) `TC-ITP-012-A`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies end-to-end that a request with no/invalid token is rejected with `401` by ARCH-012
before the ARCH-014 (create), ARCH-002 (publish), and ARCH-003 (enqueue) boundaries are crossed — no food
row is created, no fetch is enqueued, no source call is made (REQ-037, SC-010).
**Trace**: ARCH-012 → ARCH-001 → ARCH-014/ARCH-002/ARCH-003 (MOD-012); REQ-037.

- **Integration Scenario: ITS-012-A1**
    - **Given** ARCH-012 fronts ARCH-001 with `verifyToken` stubbed to throw, and spies on ARCH-014 `createByName`, ARCH-002 `publishFoodRequested`, ARCH-003 `enqueue`
    - **When** a `POST /v1/foods { name }` request with no `Authorization` header reaches the route stack
    - **Then** ARCH-012 returns `401 Unauthorized`; the ARCH-001 handler is never invoked; ARCH-014/ARCH-002/ARCH-003 receive **zero** calls; no ARCH-008 source call is made

- **Integration Scenario: ITS-012-A2**
    - **Given** ARCH-012 fronts ARCH-009 `$connect`, with `verifyToken` stubbed to reject a token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`
    - **When** a WebSocket `$connect` is attempted with the wrong-`azp` token via the `Sec-WebSocket-Protocol` subprotocol
    - **Then** ARCH-012 rejects the handshake with the pinned `403` `$connect` status before the connection is established and before any `fetch_requesters` subscription row is written (REQ-043)

#### Test Case: ITP-012-B (FoodAuthGuard accepts a Clerk M2M service token) `TC-ITP-012-B`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that a server-to-server caller presenting a valid Clerk machine (M2M) token whose
`azp` is in the authorized-parties allowlist is admitted (not forced to `401`), and the downstream handler
receives an `AuthenticatedCaller` carrying a service identity (REQ-041, A-012).
**Trace**: ARCH-012 → ARCH-001 (MOD-012); REQ-041.

- **Integration Scenario: ITS-012-B1**
    - **Given** ARCH-012 with `verifyToken` stubbed to resolve `{ sub:'svc_meal_planning', azp:'https://meal.commise.app', public_metadata:{} }` for a valid M2M token in `CLERK_AUTHORIZED_PARTIES`
    - **When** downstream service 006 (meal-planning) sends `GET /v1/foods/{id}` with the M2M Bearer token
    - **Then** ARCH-012 admits the request and hands ARCH-001 an `AuthenticatedCaller` with `isService=true` and `sub='svc_meal_planning'`; the handler proceeds to the normal read path (no `401`)

#### Test Case: ITP-012-C (DemotionAndFairness — one `sub` is demoted, not rejected, and cannot starve others) `TC-ITP-012-C`

**Technique**: Interface Contract Testing + Concurrency & Race Condition Testing
**Target View**: Interface View + Process View
**Description**: Verifies the seam between ARCH-012 (MOD-013) and the ARCH-003 enqueue boundary under
fairness-by-demotion (REQ-043, SC-012): when a single authenticated `sub` scripts add-by-name lookups past
the `DEMOTE_THRESHOLD = 50` per-`sub` PENDING-count trigger (**more than 50 pending**), its requests are
**still accepted and enqueued** (`202`, **no `429`**) but ranked to the **back** of the priority order so
they cannot starve other users; a concurrent low-pending `sub` keeps draining at normal priority — and the
heavy `sub` still drains on spare capacity (work-conserving). Demotion is dynamic and gated on `> 50`, not
`>= 50`.
**Trace**: ARCH-012 (MOD-013) → ARCH-003 (MOD-013/MOD-003); REQ-043, REQ-044.

- **Integration Scenario: ITS-012-C1**
    - **Given** the `fetch_queue` + `fetch_requesters` state is seeded so `sub='user_greedy'` already has **more than 50** foods pending, with a spy on ARCH-003 `enqueue` and visibility into drain-time priority
    - **When** `user_greedy` issues more add-by-name lookups for not-yet-resolved names
    - **Then** ARCH-012 returns `202 Accepted` (**not `429`**), ARCH-003 `enqueue` **is** invoked for each, but those rows are ranked to the **back** of the order; a concurrent `sub='user_other'` (<50 pending) enqueues at normal priority and drains ahead — one account cannot starve the shared source budget

- **Integration Scenario: ITS-012-C2**
    - **Given** `user_greedy`'s pending count later drops below 50 as its back-ranked rows drain on spare capacity
    - **When** `user_greedy` issues another add-by-name lookup and the worker recomputes priority at drain time from live `fetch_queue` + `fetch_requesters` state
    - **Then** the newly enqueued rows are scored at **normal** priority again (dynamic re-promotion from live state, not a frozen flag) — demotion is reversible and work-conserving

- **Integration Scenario: ITS-012-C3**
    - **Given** the state is seeded so `sub='user_edge'` has **exactly 50** foods pending (`DEMOTE_THRESHOLD = 50`, the boundary at the trigger value)
    - **When** `user_edge` issues another add-by-name lookup
    - **Then** ARCH-012 returns `202 Accepted`, ARCH-003 `enqueue` **is** invoked, and the row is scored at **normal** priority (NOT back-ranked) — at exactly 50 the `sub` is **not** demoted, confirming the boundary is `> 50`, not `>= 50`

#### Test Case: ITP-012-D (FoodAuthGuard fails closed with 503 on queue backpressure / open circuit) `TC-ITP-012-D`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that when the `fetch_queue` exceeds its enforced maximum depth, or a source circuit
breaker is open, an authenticated enqueue attempt fails closed with `503` rather than growing the queue
unbounded (REQ-046). This system-wide `503` backstop is distinct from per-`sub` demotion (REQ-043, never
rejects) and from the hard batch-size `400` of REQ-045 (ITP-012-G).
**Trace**: ARCH-012 (MOD-013) → ARCH-003 (MOD-013); REQ-046.

- **Integration Scenario: ITS-012-D1**
    - **Given** ARCH-012 (MOD-013) is configured with `MAX_QUEUE_DEPTH`, and the ARCH-003 queue-depth probe is stubbed above the ceiling (or the circuit reports `open`), with a spy on ARCH-003 `enqueue`
    - **When** an authenticated add-by-name request reaches the enqueue gate
    - **Then** ARCH-012 returns `503 Service Unavailable` and ARCH-003 `enqueue` receives zero calls — the queue is not grown past its bound; recovery drains with jitter (no thundering herd)

#### Test Case: ITP-012-E (Async-path provenance — only authorized principals drive consumption) `TC-ITP-012-E`

**Technique**: Interface Contract Testing
**Target View**: Interface View + Process View
**Description**: Verifies that the async producer→consumer seam preserves US-0: ARCH-004 (MOD-014) validates
event provenance, so a `fetch_queue` row not originating from a named, least-privilege principal is not
processed into a source call (REQ-042). (This is the auth-slice view of the worker-side gate also covered by
ITP-004-E.)
**Trace**: ARCH-012 (MOD-014) → ARCH-004 → ARCH-005/ARCH-008 (MOD-014/MOD-004); REQ-042.

- **Integration Scenario: ITS-012-E1**
    - **Given** ARCH-004 leases rows with provenance validation enabled and a row arrives without the authorized internal-principal provenance marker (forged/unsigned)
    - **When** ARCH-004 processes the leased row
    - **Then** ARCH-004 rejects the row (tombstones it) and does **not** invoke ARCH-005 or ARCH-008 — every accepted fetch traces to an `AuthenticatedCaller` or an authorized internal principal

- **Integration Scenario: ITS-012-E2**
    - **Given** ARCH-004 leases a well-formed row whose provenance marker identifies a named least-privilege producer principal
    - **When** ARCH-004 processes it
    - **Then** ARCH-004 accepts it and proceeds to the ARCH-005 per-source check-and-record → ARCH-008 fan-out path — the synchronous auth guarantee extends to the async edge

#### Test Case: ITP-012-F (FoodAuthGuard scope gate and 401→403→400 precedence through the route stack) `TC-ITP-012-F`

**Technique**: Interface Contract Testing + Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the scope gate and status-precedence ordering wired through the route stack in front
of ARCH-001. An authenticated token lacking the required operational scope is rejected with `403` (distinct
from the `401` unauthenticated case), and the precedence chain `401 → 403 → 400` is exercised end-to-end on
the operational `POST /v1/foods/{id}/refetch` endpoint: a bad token wins over a malformed body (`401`), a
valid-but-unscoped token wins over a malformed body (`403`), and only a valid + scoped token surfaces the
input-validation `400`. The guard fails closed before the ARCH-002 publish / ARCH-003 enqueue / ARCH-008
boundaries on the `401`/`403` paths.
**Trace**: ARCH-012 → ARCH-001 → ARCH-002/ARCH-003 (MOD-012); REQ-038, REQ-039, REQ-051.

- **Integration Scenario: ITS-012-F1**
    - **Given** ARCH-012 fronts `POST /v1/foods/{id}/refetch` (requiring scope `'foods:refetch'`), `verifyToken` stubbed to resolve `{ sub:'user_plain', azp:<authorized>, public_metadata:{} }` (valid, **no** scope), spies on ARCH-002 `publishFoodRequested` and ARCH-003 `enqueue`
    - **When** `user_plain` sends the refetch request with the valid-but-unscoped Bearer token
    - **Then** ARCH-012 returns `403 Forbidden` — distinct from `401`; the ARCH-001 handler is never invoked; ARCH-002/ARCH-003 receive **zero** calls; no source call is made

- **Integration Scenario: ITS-012-F2**
    - **Given** ARCH-012 fronts the same endpoint, `verifyToken` stubbed to **throw**, and a request body that is also malformed (non-JSON / invalid `id`)
    - **When** the request reaches the route stack with both a bad token and a malformed body
    - **Then** ARCH-012 returns `401` — the auth seam runs before input validation, so `401` wins over the would-be `400`; ARCH-001 validation is never reached (precedence step 1: `401 > 400`)

- **Integration Scenario: ITS-012-F3**
    - **Given** ARCH-012 fronts the same endpoint, `verifyToken` stubbed to resolve a **valid but unscoped** caller, and the same malformed body
    - **When** the request reaches the route stack with a valid-but-unscoped token and a malformed body
    - **Then** ARCH-012 returns `403` — the scope gate runs before ARCH-001 input validation, so `403` wins over the would-be `400` (precedence step 2: `403 > 400`)

- **Integration Scenario: ITS-012-F4**
    - **Given** ARCH-012 fronts the same endpoint, `verifyToken` stubbed to resolve a caller holding `public_metadata.scopes:['foods:refetch']`, and a malformed body
    - **When** the request reaches the route stack with a valid + scoped token and a malformed body
    - **Then** ARCH-012 **admits** the request to ARCH-001, which performs input validation and returns `400 Bad Request` — only once auth (`401`) and scope (`403`) both pass does the `400` surface (precedence step 3)

#### Test Case: ITP-012-G (DemotionAndFairness — oversized batch → `400` at the enqueue gate; accepted batch → per-item partial) `TC-ITP-012-G`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the hard batch-size cap (MOD-013, REQ-045): a `POST /v1/foods/batch` carrying more
than 100 names is rejected with `400` at the ARCH-012 enqueue gate **before** the ARCH-003 boundary —
distinct from the REQ-046 `503` backpressure path (ITP-012-D). For an accepted batch mixing
resolved/unresolved names, the seam returns a **per-item partial result** — resolved foods inline and each
miss as a `pending` entry whose fetch is enqueued (subject to demotion fairness, REQ-043, not a per-user
quota).
**Trace**: ARCH-012 (MOD-013) → ARCH-014/ARCH-003 (MOD-013/MOD-001); REQ-045.

- **Integration Scenario: ITS-012-G1**
    - **Given** ARCH-012 (MOD-013) configured with `MAX_BATCH = 100`, with a spy on ARCH-003 `enqueue`
    - **When** an authenticated caller sends `POST /v1/foods/batch` with `101` names (over the cap)
    - **Then** ARCH-012 returns `400 Bad Request`; ARCH-003 `enqueue` receives **zero** calls; no source call is made — the oversized batch is rejected whole (no partial enqueue)

- **Integration Scenario: ITS-012-G2**
    - **Given** `MAX_BATCH = 100`, a spy on ARCH-003 `enqueue`, and a batch of exactly `100` names mixing already-`RESOLVED` foods and add-by-name misses
    - **When** the caller sends `POST /v1/foods/batch` with those `100` names (at the cap)
    - **Then** ARCH-012 admits the request and returns a **per-item partial** response — resolved foods inline + each miss as a `pending` entry — and ARCH-003 `enqueue` is invoked once per miss (each subject to demotion fairness, not a per-user quota); the `400` branch is the ceiling, not an always-reject (at-limit accepted)

#### Test Case: ITP-012-H (Consumer-Driven Contract — M2M service-token seam and async-producer provenance seam) `TC-ITP-012-H`

**Technique**: Consumer-Driven Contract Testing (CDCT)
**Target View**: Interface View + Process View
**Description**: Verifies the two server-to-server seams via **consumer-published pacts** (not provider stubs):
(1) the **M2M token seam** — downstream service 006 (meal-planning) publishes a contract for the request it
sends (`GET /v1/foods/{id}` with a Clerk M2M Bearer whose `azp` is in `CLERK_AUTHORIZED_PARTIES`) and the
responses it depends on (`200` admitted, `401` on missing/invalid M2M token), and ARCH-012 (provider) is
verified against it (REQ-041, A-012); and (2) the **async-producer provenance seam** — the internal producer
(recipe-import / change-refresh principal) publishes a contract for the demand it emits including the
`requestedBy` provenance marker, and ARCH-004 (consumer) is verified to accept only marked demand and reject
(tombstone) unmarked demand (REQ-042). Consumer expectations are validated against the provider **before**
integration deployment.
**Trace**: ARCH-012/ARCH-004 (MOD-012/MOD-014); REQ-041, REQ-042.

- **Integration Scenario: ITS-012-H1**
    - **Given** downstream service 006, as **consumer**, publishes a pact: "I send `GET /v1/foods/{id}` with a valid Clerk **M2M** Bearer whose `azp` is in `CLERK_AUTHORIZED_PARTIES`, expecting `200` with the golden-record shape; if my token is missing/expired I expect `401`"
    - **When** ARCH-012 (provider) is replayed against the pact with `verifyToken` resolving the M2M claim set for the valid case and throwing for the missing-token case
    - **Then** the provider satisfies the contract: the valid M2M request is admitted to the ARCH-001 read path (not `401`) and the missing-token request yields `401` — any provider change that would `401` a valid M2M token fails this CDCT check before deploy

- **Integration Scenario: ITS-012-H2**
    - **Given** the internal recipe-import producer principal, as **consumer of the async seam**, publishes a pact: "I emit demand carrying a `requestedBy` marker identifying my named least-privilege principal; a consumer MUST accept it and MUST reject any demand lacking that marker"
    - **When** ARCH-004 is verified against the pact with one marked row and one forged/unmarked row
    - **Then** ARCH-004 accepts the marked row (proceeds to ARCH-005 → ARCH-008) and tombstones the unmarked row without invoking ARCH-005/ARCH-008 — the async-edge provenance contract is verified consumer-first

---

### Module Verification: ARCH-013 (SourceAdapterRegistry) `[NEW]`

**Parent System Components**: SYS-014
**Modules Under Test**: MOD-015 (SourceAdapterRegistry)

#### Test Case: ITP-013-A (SourceAdapterRegistry fan-out boundary: worker iterates the wired registry in priority order) `TC-ITP-013-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the ARCH-004↔ARCH-013 fan-out seam: ARCH-004 obtains the wired adapters via
`adapters()` (in static priority order) and the merge engine consults `priorityOf(source)`; adding a source
is additive (one `register(...)` + a `source` enum value) and never touches the canonical schema. A
duplicate `register` fails closed at bootstrap.
**Trace**: ARCH-004 → ARCH-013 → ARCH-015 (MOD-004/MOD-015/MOD-017); REQ-050, REQ-054, REQ-IF-012.

- **Integration Scenario: ITS-013-A1**
    - **Given** the registry has the USDA adapter (`MOD-008`) registered as the only wired adapter and `PRIORITY_ORDER=['usda']`
    - **When** ARCH-004 calls `adapters()` during fan-out and ARCH-015 calls `priorityOf('usda')`
    - **Then** `adapters()` returns `[usdaAdapter]` in priority order and `priorityOf('usda')` returns the highest priority — the worker iterates exactly the wired set, and the merge engine resolves source precedence through the registry

- **Integration Scenario: ITS-013-A2**
    - **Given** a second `FoodSourceAdapter` for a new `source` is registered alongside USDA (no canonical schema change)
    - **When** ARCH-004 fans out
    - **Then** `adapters()` returns both in `PRIORITY_ORDER` and the worker calls each — adding a source is additive at the registry boundary only; a duplicate `register('usda')` raises `DuplicateSourceError` at bootstrap (fail closed before serving)

#### Test Case: ITP-013-B (SourceAdapterRegistry confines `fdcId` to the adapter — no source-native key leaks past the boundary) `TC-ITP-013-B`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the confinement invariant at the registry boundary: the `FoodSourceAdapter`
contract exposes only `searchByName`/`fetchByKey` returning source-agnostic `CanonicalCandidate`s keyed on
`external_key`; the USDA `fdcId → external_key` mapping is internal to ARCH-008's `mapToCanonical`, so no
candidate crossing into ARCH-004/ARCH-015 carries `fdcId`.
**Trace**: ARCH-013 ↔ ARCH-008 → ARCH-004 (MOD-015/MOD-008); REQ-046, REQ-054, REQ-CN-007.

- **Integration Scenario: ITS-013-B1**
    - **Given** the USDA adapter (the only registered adapter) resolves a name to a USDA item whose native key is an `fdcId`
    - **When** ARCH-004 receives the `CanonicalCandidate` from `fetchByKey` across the registry boundary
    - **Then** the candidate carries `{ source:'usda', externalKey, … }` and **no** `fdcId` field — the source-native key is mapped to `external_key` inside the adapter and never surfaces to the worker, merge engine, DAO, or store (SC-013 confinement)

---

### Module Verification: ARCH-014 (FoodDaoRepository) `[NEW]`

**Parent System Components**: SYS-018
**Modules Under Test**: MOD-016 (FoodDaoRepository)

#### Test Case: ITP-014-A (FoodDaoRepository add-by-name dedup collapse under concurrent adds — advisory lock) `TC-ITP-014-A`

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies the name-grain dedup seam (REQ-005/REQ-013): when multiple requests concurrently
`createByName` the **same** normalized name, the short `pg_advisory_xact_lock` keyed on the name hash
serializes them and the `UNIQUE(normalized_name)` index backstops, so they collapse to **one** `food` row +
`id` — exactly one caller gets `created=true`, the rest get that same `id` with `created=false`.
**Trace**: ARCH-001 → ARCH-014 → ARCH-006 (MOD-016/MOD-006); REQ-005, REQ-013.

- **Integration Scenario: ITS-014-A1**
    - **Given** no `food` row exists for `normalizeName("greek yogurt")` and three requests concurrently call `createByName("greek yogurt", …)` against a real Postgres instance
    - **When** all three contend on `pg_advisory_xact_lock(hash(normalized_name))` then check `UNIQUE(normalized_name)`
    - **Then** exactly **one** `food` row exists with one `id`; exactly one caller receives `{ created:true }` and the other two receive `{ id:<same>, created:false }` — concurrent adds collapse to one row + `id`, never duplicates

#### Test Case: ITP-014-B (FoodDaoRepository golden-record persistence seam — the sole persistence path) `TC-ITP-014-B`

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies that `upsertGoldenRecord` persists a merged golden record atomically across the
normalized tables via the per-aggregate DAOs (FoodDao, FoodSourcesDao, FoodNutrientsDao, FoodPortionsDao,
FoodFieldProvenanceDao, FoodCategoryDao) over ARCH-006 — and that this is the **only** persistence seam (no
source-specific SQL leaks into services/worker, REQ-054). A mid-transaction failure rolls the whole write
back so the worker can re-queue.
**Trace**: ARCH-004/ARCH-016 → ARCH-014 → ARCH-006/ARCH-017 (MOD-016/MOD-006/MOD-019); REQ-028, REQ-054.

- **Integration Scenario: ITS-014-B1**
    - **Given** ARCH-004 passes a merged `GoldenRecord` (scalars + nutrients + portions + fieldProvenance + contributingSources) with `outcome='RESOLVED'` to `upsertGoldenRecord(food_id, golden, 'RESOLVED')`
    - **When** ARCH-014 runs the single transaction across its per-aggregate DAOs
    - **Then** `food` scalars, `food_sources` crosswalk (`UNIQUE(source, external_key)`), `food_nutrients`/`food_portions` (`source_id`), and `food_field_provenance` are all written and `status` is set to `RESOLVED` atomically — and a subsequent `findById` returns the assembled record

- **Integration Scenario: ITS-014-B2**
    - **Given** a `food_nutrients` write fails mid-transaction (e.g. constraint violation injected)
    - **When** ARCH-014 executes `upsertGoldenRecord`
    - **Then** the entire transaction rolls back (no partial golden record persisted) and the error propagates to ARCH-004, which re-queues the row with backoff — the seam is all-or-nothing

---

### Module Verification: ARCH-015 (GoldenRecordMergeEngine) `[NEW]`

**Parent System Components**: SYS-015
**Modules Under Test**: MOD-017 (GoldenRecordMergeEngine)

#### Test Case: ITP-015-A (GoldenRecordMergeEngine field-level merge across sources → RESOLVED golden record) `TC-ITP-015-A`

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the merge seam invoked by ARCH-004: presence beats absence; identity/short fields
(`name`, `brand_owner`) → higher-priority source (NOT longest); free-text (`description`) → longer-wins;
nutrients normalized to **per-100g** before any blend with conflicts → higher-priority source recording the
winning `source`. Source priority is resolved through ARCH-013 `priorityOf`. Output feeds ARCH-014 +
ARCH-017.
**Trace**: ARCH-004 → ARCH-015 → ARCH-013/ARCH-014/ARCH-017 (MOD-017/MOD-015); REQ-051, REQ-MRG-2, REQ-MRG-3.

- **Integration Scenario: ITS-015-A1**
    - **Given** two collapsed `CanonicalCandidate`s for one food — a higher-priority source with `name` + a per-serving `protein` value, and a lower-priority source with a longer `description` + a per-100g `protein` value
    - **When** ARCH-004 calls `merge(candidates)` (which consults ARCH-013 `priorityOf`)
    - **Then** the golden record takes `name` from the higher-priority source, `description` from the longer value, and the per-`protein` winner is the higher-priority source's value **normalized to per-100g first**; `outcome='RESOLVED'`; each value's `source` is recorded for provenance (ARCH-017)

#### Test Case: ITP-015-B (GoldenRecordMergeEngine non-collapsible candidates → UNRESOLVED outcome) `TC-ITP-015-B`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that when candidates cannot be confidently collapsed to one logical item, ARCH-015
returns `outcome='UNRESOLVED'` with the candidate set retained — so ARCH-004 persists `status='UNRESOLVED'`
and ARCH-016 can surface the candidates for a human pick.
**Trace**: ARCH-004 → ARCH-015 → ARCH-016 (MOD-017/MOD-018); REQ-048, REQ-RES-3.

- **Integration Scenario: ITS-015-B1**
    - **Given** two `CanonicalCandidate`s that pre-merge could not confidently collapse (distinct branded items)
    - **When** ARCH-004 calls `merge(candidates)`
    - **Then** ARCH-015 returns `{ outcome:'UNRESOLVED', candidateSet }`, ARCH-004 persists `status='UNRESOLVED'` via ARCH-014, and the candidate set is available to ARCH-016 `/candidates`

---

### Module Verification: ARCH-016 (CandidateResolutionService) `[NEW]`

**Parent System Components**: SYS-016
**Modules Under Test**: MOD-018 (CandidateResolutionService)

#### Test Case: ITP-016-A (CandidateResolutionService getCandidates seam for an UNRESOLVED food) `TC-ITP-016-A`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the ARCH-001→ARCH-016 delegation for `GET /v1/foods/{id}/candidates`: for an
`UNRESOLVED` food, `getCandidates(id)` returns the per-source candidate list (each with `source` +
`externalKey` + name/summary); for a non-`UNRESOLVED` food it returns `[]`; for no row it raises `404`.
**Trace**: ARCH-001 → ARCH-016 → ARCH-014 (MOD-001/MOD-018/MOD-016); REQ-048, REQ-IF-010.

- **Integration Scenario: ITS-016-A1**
    - **Given** a food with `status='UNRESOLVED'` whose fan-out retained two candidates
    - **When** ARCH-001 delegates `GET /v1/foods/{id}/candidates` to ARCH-016 `getCandidates(id)`
    - **Then** ARCH-016 returns two `Candidate`s, each carrying `{ candidateId, source, externalKey, name, summary }` — id-keyed at the food level, source-native key exposed only as the opaque candidate `externalKey`

#### Test Case: ITP-016-B (CandidateResolutionService PATCH-resolve seam: in-set pick → merge → RESOLVED) `TC-ITP-016-B`

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies the resolve seam: ARCH-016 validates each pick belongs to **this** food's candidate
set, drives the merge (ARCH-015), persists the golden record + the user pick as **ordinary** provenance
(ARCH-014 → ARCH-017), and moves the food to `RESOLVED`.
**Trace**: ARCH-001 → ARCH-016 → ARCH-015 → ARCH-014/ARCH-017 (MOD-018/MOD-017/MOD-016/MOD-019); REQ-049, REQ-052.

- **Integration Scenario: ITS-016-B1**
    - **Given** an `UNRESOLVED` food and a `candidateId` that belongs to its own candidate set
    - **When** ARCH-001 delegates `PATCH /v1/foods/{id} { candidateIds:[cid] }` to ARCH-016 `resolve(id, [cid])`
    - **Then** ARCH-016 calls `merge(selected)` (ARCH-015), `upsertGoldenRecord(id, golden, 'RESOLVED')` (ARCH-014, storing the pick as ordinary provenance via ARCH-017), and returns `{ id, status:'RESOLVED' }` — a subsequent read returns `200`

#### Test Case: ITP-016-C (CandidateResolutionService out-of-set pick → 400/409, status unchanged) `TC-ITP-016-C`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the candidate-set membership guard: a `PATCH` referencing a candidate that does NOT
belong to this food's set is rejected (`400`/`409`) and the food's `status` is unchanged — preventing
cross-food contamination.
**Trace**: ARCH-001 → ARCH-016 → ARCH-014 (MOD-018); REQ-049.

- **Integration Scenario: ITS-016-C1**
    - **Given** an `UNRESOLVED` food and a `candidateId` that belongs to a **different** food's candidate set, with a spy on ARCH-014 `upsertGoldenRecord`
    - **When** ARCH-001 delegates `PATCH /v1/foods/{id} { candidateIds:[otherCid] }` to ARCH-016 `resolve`
    - **Then** ARCH-016 raises `CandidateMismatchError` (`400`/`409`), the food's `status` stays `UNRESOLVED`, and ARCH-014 `upsertGoldenRecord` receives **zero** calls

---

### Module Verification: ARCH-017 (ProvenanceStore) `[NEW]`

**Parent System Components**: SYS-017
**Modules Under Test**: MOD-019 (ProvenanceStore)

#### Test Case: ITP-017-A (ProvenanceStore per-field provenance persisted at the value grain) `TC-ITP-017-A`

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies that, during `upsertGoldenRecord`, ARCH-017 writes per-field provenance through
ARCH-014/ARCH-006: a `source_id` reference on each `food_nutrients`/`food_portions` row and a
`food_field_provenance(food_id, field, source_id)` row per scalar field (controlled `field` enum, no value
column, no EAV, no verbatim payload).
**Trace**: ARCH-015/ARCH-016 → ARCH-014 → ARCH-017 → ARCH-006 (MOD-019/MOD-016/MOD-006); REQ-052, REQ-029.

- **Integration Scenario: ITS-017-A1**
    - **Given** a merged golden record where `name` came from source A and a `protein` nutrient came from source B
    - **When** ARCH-014 calls `ProvenanceStore.recordScalarFields` (and the nutrient DAO writes `source_id`) inside the upsert transaction
    - **Then** `food_field_provenance` holds `(food_id, 'name', source_id_A)` and the `food_nutrients` protein row carries `source_id_B` — each value records its originating source; no free-form `field` value is accepted (controlled enum)

#### Test Case: ITP-017-B (ProvenanceStore "which fields came from source X" single-query seam) `TC-ITP-017-B`

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `fieldsFromSource(food_id, source)` answers "which fields came from source X" in
a single `UNION` query over `food_field_provenance` + `food_nutrients`/`food_portions` `source_id` joins —
without reading any stored payload (none is retained).
**Trace**: ARCH-017 → ARCH-006 (MOD-019/MOD-006); REQ-029, REQ-052.

- **Integration Scenario: ITS-017-B1**
    - **Given** a `RESOLVED` food whose `name` + `description` came from `usda` and whose one `portion` came from a second source
    - **When** a caller invokes `fieldsFromSource(food_id, 'usda')`
    - **Then** ARCH-017 returns `['field:name','field:description']` (and **not** the portion) from the single `UNION` query — provenance is queryable per source with no payload stored

---

### Module Verification: ARCH-018 (ChangeRefreshConsumer) `[NEW]`

**Parent System Components**: SYS-019
**Modules Under Test**: MOD-020 (ChangeRefreshConsumer)

#### Test Case: ITP-018-A (ChangeRefreshConsumer re-enqueues only items whose upstream `item_version` changed) `TC-ITP-018-A`

**Technique**: Interface Contract Testing + Data Flow Testing
**Target View**: Interface View + Data Flow View
**Description**: Verifies the change-driven refresh seam: on `IngestionScheduled`, ARCH-018 iterates
`RESOLVED` foods' backing source items, re-fetches each via the adapter (ARCH-013), compares
`food_sources.item_version`, and re-enqueues the affected food as **low-priority** `fetch_queue` work
(deduped via `ON CONFLICT`) **only** when the upstream item changed — never blindly re-blending.
**Trace**: EventBridge → ARCH-018 → ARCH-013 → ARCH-003 (MOD-020/MOD-015/MOD-003); REQ-031, REQ-032, REQ-053.

- **Integration Scenario: ITS-018-A1**
    - **Given** a `RESOLVED` food backed by a USDA item whose adapter `fetchByKey` now returns a **different** `itemVersion` than the stored `food_sources.item_version`, with a spy on ARCH-003 `enqueueLowPriority`
    - **When** ARCH-018 `onScheduled` compares versions via `itemChanged(source, externalKey, knownVersion)`
    - **Then** ARCH-018 re-enqueues the food as low-priority `fetch_queue` work (`requestedBy='svc_change_refresh'`, `ON CONFLICT (food_id)`) — the changed item drives a re-merge later, sorting after end-user demand

#### Test Case: ITP-018-B (ChangeRefreshConsumer leaves unchanged + user-resolved fields intact) `TC-ITP-018-B`

**Technique**: Interface Contract Testing
**Target View**: Interface View + Process View
**Description**: Verifies that when an upstream item's `item_version` is unchanged, ARCH-018 leaves every
field intact (including a user's manual resolution) and does NOT re-enqueue — no churn, no overwrite — and a
re-pulled value that later fails ARCH-019 validation is rejected-not-stored (the existing value preserved).
**Trace**: ARCH-018 → ARCH-013/ARCH-019 → ARCH-003 (MOD-020/MOD-021); REQ-031, REQ-053, REQ-055.

- **Integration Scenario: ITS-018-B1**
    - **Given** a `RESOLVED` food whose backing item's `itemVersion` equals the stored `food_sources.item_version`, with a spy on ARCH-003 `enqueueLowPriority`
    - **When** ARCH-018 `onScheduled` compares versions
    - **Then** ARCH-018 leaves the field intact and ARCH-003 `enqueueLowPriority` receives **zero** calls — unchanged upstream → no re-enqueue, user-resolved fields preserved (REQ-031)

---

### Module Verification: ARCH-019 (AdapterInputValidator) `[NEW]`

**Parent System Components**: SYS-020 `[CROSS-CUTTING]`
**Modules Under Test**: MOD-021 (AdapterInputValidator)

#### Test Case: ITP-019-A (AdapterInputValidator boundary validation: reject-not-store on a malformed mapped candidate) `TC-ITP-019-A`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies the source-boundary validation seam used inside each adapter's `mapToCanonical`:
type/range/length/text checks before any value enters the canonical store; on a value that fails (e.g. a
nutrient amount out of range, an over-length name), `validateAndSanitize` throws `ValidationError` so the
adapter drops the candidate (reject-not-store) — and ARCH-004 can still resolve the food from remaining
valid candidates.
**Trace**: ARCH-008 → ARCH-019 → ARCH-004 (MOD-021/MOD-008/MOD-004); REQ-055, REQ-024.

- **Integration Scenario: ITS-019-A1**
    - **Given** the USDA adapter's `mapToCanonical` produces a `MappedCandidate` with a nutrient `amount` that is non-finite / out of range (or a name over the length cap)
    - **When** the adapter calls `ARCH-019.validateAndSanitize(mapped)`
    - **Then** ARCH-019 throws `ValidationError`; the adapter drops this candidate (reject-not-store) and no malformed value enters the canonical store; ARCH-004 continues fan-out and may still resolve from other valid candidates (REQ-055)

- **Integration Scenario: ITS-019-A2**
    - **Given** a `MappedCandidate` whose text fields contain control characters / null bytes but are otherwise valid
    - **When** the adapter calls `validateAndSanitize(mapped)`
    - **Then** ARCH-019 returns a `CanonicalCandidate` with the text **sanitized** (control chars stripped, whitespace normalized) — sanitize, not reject, for recoverable text

#### Test Case: ITP-019-B (AdapterInputValidator transport security: HTTPS + cert validation on outbound fetches) `TC-ITP-019-B`

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that `assertHttps(url)` refuses a non-HTTPS (or cert-failing) source URL before any
outbound fetch, so a downgraded/MITM source endpoint cannot feed the canonical store.
**Trace**: ARCH-008 → ARCH-019 (MOD-021/MOD-008); REQ-055.

- **Integration Scenario: ITS-019-B1**
    - **Given** an adapter is configured (in a fault-injection harness) with a non-`https://` source URL
    - **When** the adapter calls `ARCH-019.assertHttps(url)` before fetching
    - **Then** ARCH-019 throws `TransportSecurityError`; the fetch never happens and the candidate is dropped — transport security is enforced at the adapter boundary (REQ-055)

---

## Test Harness & Mocking Strategy

| Test Case | External Dependency                                               | Mock/Stub Strategy                                                                                           | Rationale                                                                            |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ITP-001-A | ARCH-014 (DAO) / ARCH-006                                         | DAO stub returns a `RESOLVED` `GoldenRecord`; spy on adapter registry to assert zero source calls            | Isolates ARCH-001↔ARCH-014 read seam; proves no source in the read path              |
| ITP-001-B | ARCH-014 / ARCH-002                                               | Spies on `createByName` / `publishFoodRequested` — assert zero calls on invalid input                        | Verifies input-validation gate before any downstream boundary                        |
| ITP-001-C | ARCH-014 / ARCH-002                                               | `createByName` returns `{ id, created:true }`; spy on `publishFoodRequested`                                 | Verifies add-by-name → create → enqueue handshake; `id`-keyed `202`                  |
| ITP-001-D | ARCH-014                                                          | DAO stub returns rows with each lifecycle status; spy on `publishFoodRequested`                              | Verifies status→HTTP mapping (202/404) and that reads never enqueue                  |
| ITP-001-E | ARCH-014 / ARCH-002                                               | DAO stub returns a `NOT_FOUND` tombstone within / past the 30-day TTL; spy on `publishFoodRequested`         | Verifies tombstone TTL: within → no enqueue; after → re-attempt                      |
| ITP-002-A | Postgres `fetch_queue`                                            | Test Postgres (Docker) or pg-mem; assert ARCH-003 `enqueue` (INSERT ON CONFLICT + `NOTIFY`) → `{ enqueued }` | Verifies direct Postgres enqueue handshake (no EventBridge on demand path)           |
| ITP-002-B | Postgres `fetch_queue`                                            | Assert no INSERT / no `NOTIFY` on malformed id or missing `requestedBy`                                      | Verifies validation + async-provenance gate before enqueue                           |
| ITP-002-C | EventBridge                                                       | AWS SDK mock — assert `DetailType` + id-keyed detail; non-zero `FailedEntryCount` logged not thrown          | Verifies EventBridge carries only scheduled + completion events                      |
| ITP-003-A | Postgres `fetch_queue`/`fetch_requesters`                         | Test Postgres; assert INSERT + demand-weighted ORDER BY + `NOTIFY`                                           | Verifies `food_id`-keyed enqueue + demand ordering against the real schema           |
| ITP-003-B | Postgres `fetch_queue` (retry-exhausted row)                      | Drive a row past its FR-016 budget; assert `status='tombstone'` + `last_error`                               | Simulates persistent failure for tombstone transition                                |
| ITP-003-C | Postgres `fetch_queue`/`fetch_requesters` (concurrent)            | Real Postgres with concurrent clients enqueuing the same `food_id`                                           | Concurrency test of `ON CONFLICT (food_id)` collapse + capped distinct-`sub` count   |
| ITP-004-A | ARCH-005 (`source_call_log`)                                      | Limiter stub returning controlled `{ allowed, windowCount }` + `shouldPauseDraining`                         | Isolates the per-source gate from the real store                                     |
| ITP-004-B | ARCH-013/ARCH-008 (adapter); ARCH-015; ARCH-014                   | nock USDA fixture → one `CanonicalCandidate`; real merge + DAO over test Postgres                            | Verifies the fan-out→merge→persist→provenance data flow end-to-end                   |
| ITP-004-C | ARCH-008 (adapter)                                                | nock returns 5xx then 429                                                                                    | Verifies backoff (REQ-016) and per-source window-full handling (REQ-026)             |
| ITP-004-D | ARCH-013/ARCH-008; ARCH-014; ARCH-003                             | Adapter returns zero candidates / all-error; assert NOT_FOUND vs FAILED disposition                          | Verifies the two terminal tombstone dispositions                                     |
| ITP-004-E | Postgres `fetch_queue` row provenance                             | Lease rows with / without authorized `requested_by`; spy on limiter + adapter                                | Verifies async-producer provenance gate before any source call                       |
| ITP-005-A | `source_call_log` (concurrent)                                    | Real Postgres with concurrent clients (deferred Redis: real sorted-set Lua)                                  | Concurrency requires real atomic per-source count-and-record                         |
| ITP-005-B | `source_call_log` store (unavailable)                             | Store stub throwing connection error                                                                         | Simulates store failure for fail-closed propagation                                  |
| ITP-005-C | `source_call_log` (aging window)                                  | Real Postgres seeded to pause threshold; advance/age timestamps for resume                                   | Verifies per-source pause/resume independence                                        |
| ITP-006-A | PostgreSQL (12-table schema)                                      | Test Postgres (Docker)                                                                                       | Verifies real golden-record upsert + reassembly; schema-level contract               |
| ITP-006-B | PostgreSQL (pg_trgm)                                              | Test Postgres with pg_trgm extension                                                                         | Search + barcode/external_key lookup require the real extension/index                |
| ITP-006-C | PostgreSQL (unavailable)                                          | pg mock throwing connection error                                                                            | Simulates DB failure for error propagation / rollback                                |
| ITP-007-A | ARCH-007 (deferred Redis variant)                                 | In-memory Redis stub (miss) + DAO stub (hit)                                                                 | Isolates the optional cache-through flow (variant only)                              |
| ITP-007-B | ARCH-007 (Redis unavailable)                                      | Redis stub throwing connection error                                                                         | Verifies fall-through to Postgres rather than 503                                    |
| ITP-008-A | USDA FoodData Central API                                         | nock with a valid USDA response fixture                                                                      | Verifies adapter contract + `fdcId → external_key` mapping; the only `fdcId` slice   |
| ITP-008-B | USDA FoodData Central API                                         | nock returning 429 / 401                                                                                     | Verifies USDA error classification for worker disposition                            |
| ITP-009-A | API Gateway WebSocket API                                         | AWS SDK mock for PostToConnection                                                                            | Deferred (US-9); verifies id-keyed notification dispatch                             |
| ITP-009-B | API Gateway WebSocket API                                         | AWS SDK mock returning GoneException                                                                         | Verifies fire-and-forget on disconnected clients                                     |
| ITP-010-A | AWS Secrets Manager                                               | AWS SDK mock returning a valid per-source secret                                                             | Verifies per-source key retrieval; key absent from logs                              |
| ITP-010-B | AWS Secrets Manager                                               | AWS SDK mock throwing ResourceNotFoundException                                                              | Verifies fault propagation prevents unauthenticated source calls                     |
| ITP-011-A | CloudWatch Logs                                                   | AWS SDK mock — assert PutLogEvents payload (id-keyed)                                                        | Verifies structured-log field completeness                                           |
| ITP-011-B | CloudWatch Metrics                                                | AWS SDK mock — assert PutMetricData with per-source dimension                                                | Verifies per-source rolling-window metric emission (SC-002)                          |
| ITP-011-C | AWS X-Ray                                                         | X-Ray SDK mock — assert segment creation                                                                     | Verifies trace boundary handshake                                                    |
| ITP-012-A | @clerk/backend `verifyToken`; ARCH-014/002/003                    | Stub `verifyToken` to throw; spies on `createByName`/`publishFoodRequested`/`enqueue` — assert zero          | Networkless verify; fail-closed before any downstream boundary                       |
| ITP-012-B | @clerk/backend `verifyToken`                                      | Stub `verifyToken` to resolve a valid M2M claim set                                                          | Verifies M2M service token admitted, not 401                                         |
| ITP-012-C | `fetch_queue` + `fetch_requesters` pending state; ARCH-003        | Seed one `sub` to >50 / exactly 50 / <50 pending; spy on `enqueue` + drain-time ordering                     | Verifies demotion-not-rejection + the `>50` boundary + dynamic re-promotion          |
| ITP-012-D | ARCH-003 queue-depth probe / circuit breaker                      | Stub depth above ceiling / breaker open; spy on `enqueue`                                                    | Verifies `503` fail-closed backstop (distinct from demotion)                         |
| ITP-012-E | ARCH-004 consumer; `fetch_queue` row provenance                   | Inject rows with / without authorized provenance marker                                                      | Verifies async-path provenance (US-0 on internal edge)                               |
| ITP-012-F | @clerk/backend `verifyToken`; ARCH-001 validation                 | Stub throw / unscoped / scoped; malformed body; spies on `publishFoodRequested`/`enqueue`                    | Verifies scope `403` + `401→403→400` precedence through the stack                    |
| ITP-012-G | ARCH-003 enqueue; DAO for mixed batch                             | Spy on `enqueue`; submit 101 (over cap) and 100 mixed resolved/miss names                                    | Verifies REQ-045 batch `400` before enqueue + per-item partial (distinct from `503`) |
| ITP-012-H | @clerk/backend `verifyToken`; consumer pacts; ARCH-004 provenance | Replay consumer M2M + async pacts against ARCH-012/ARCH-004                                                  | Consumer-driven verification of the M2M + async seams before deploy                  |
| ITP-013-A | ARCH-013 registry; ARCH-004/ARCH-015                              | Real registry with USDA adapter (+ a stub second adapter); spy on `adapters()`/`priorityOf`                  | Verifies fan-out boundary, priority order, additive register, duplicate fail-closed  |
| ITP-013-B | ARCH-008 adapter `CanonicalCandidate`                             | Adapter resolves a USDA item; assert the crossed candidate has `external_key`, no `fdcId`                    | Verifies `fdcId` confinement at the registry boundary (SC-013)                       |
| ITP-014-A | Postgres `food` (concurrent createByName)                         | Real Postgres with concurrent clients on the same normalized name (advisory lock + UNIQUE)                   | Concurrency test of name-grain dedup collapse                                        |
| ITP-014-B | Postgres (12-table schema); per-aggregate DAOs                    | Test Postgres; inject a mid-transaction failure for the rollback case                                        | Verifies the sole persistence seam + atomic all-or-nothing upsert                    |
| ITP-015-A | ARCH-013 `priorityOf`                                             | Real merge engine with two crafted candidates; stub `priorityOf`                                             | Verifies field-level merge rules → RESOLVED (deterministic)                          |
| ITP-015-B | —                                                                 | Two non-collapsible candidates fed to `merge`                                                                | Verifies UNRESOLVED outcome + candidate-set retention                                |
| ITP-016-A | ARCH-014; candidate store                                         | Seed an UNRESOLVED food with a retained candidate set                                                        | Verifies `getCandidates` list / `[]` / 404 seam                                      |
| ITP-016-B | ARCH-015; ARCH-014/ARCH-017                                       | Real resolve over test Postgres with an in-set pick                                                          | Verifies resolve → merge → persist → RESOLVED + user-pick provenance                 |
| ITP-016-C | ARCH-014                                                          | PATCH a candidate from a different food's set; spy on `upsertGoldenRecord`                                   | Verifies out-of-set guard → 400/409, status unchanged                                |
| ITP-017-A | Postgres `food_field_provenance` / `food_nutrients.source_id`     | Test Postgres; assert provenance rows + `source_id` columns                                                  | Verifies value-grain provenance persisted (no EAV / payload)                         |
| ITP-017-B | Postgres (provenance joins)                                       | Test Postgres; assert single `UNION` query result                                                            | Verifies "which fields came from source X" without payload                           |
| ITP-018-A | ARCH-013 adapter (changed itemVersion); ARCH-003                  | Adapter returns a changed `itemVersion`; spy on `enqueueLowPriority`                                         | Verifies change-driven re-enqueue only on upstream change                            |
| ITP-018-B | ARCH-013 adapter (unchanged itemVersion); ARCH-003                | Adapter returns the stored `itemVersion`; spy on `enqueueLowPriority`                                        | Verifies unchanged → no re-enqueue, user-resolved fields preserved                   |
| ITP-019-A | ARCH-008 `mapToCanonical` output                                  | Feed a malformed / control-char `MappedCandidate` to `validateAndSanitize`                                   | Verifies reject-not-store vs sanitize at the adapter boundary                        |
| ITP-019-B | adapter outbound URL                                              | Configure a non-HTTPS source URL in a fault harness                                                          | Verifies HTTPS/cert transport-security assertion                                     |

---

## Coverage Summary

| Metric                            | Count          |
| --------------------------------- | -------------- |
| Total Architecture Modules (ARCH) | 19             |
| Total Test Cases (ITP)            | 56             |
| Total Scenarios (ITS)             | 84             |
| Modules with ≥1 ITP               | 19 / 19 (100%) |
| Test Cases with ≥1 ITS            | 56 / 56 (100%) |
| **Overall Coverage (ARCH→ITP)**   | **100%**       |

### ARCH → ITP coverage map

| ARCH module                         | Covering ITP test case(s)             |
| ----------------------------------- | ------------------------------------- |
| ARCH-001 FoodApiController          | ITP-001-A, -B, -C, -D, -E             |
| ARCH-002 EnqueueEmitter             | ITP-002-A, -B, -C                     |
| ARCH-003 FetchQueueRouter           | ITP-003-A, -B, -C                     |
| ARCH-004 FoodConsumerService        | ITP-004-A, -B, -C, -D, -E             |
| ARCH-005 RollingWindowLimiter       | ITP-005-A, -B, -C                     |
| ARCH-006 FoodPostgresRepository     | ITP-006-A, -B, -C                     |
| ARCH-007 FoodCacheService           | ITP-007-A, -B                         |
| ARCH-008 UsdaApiClient              | ITP-008-A, -B                         |
| ARCH-009 WebSocketNotifier          | ITP-009-A, -B                         |
| ARCH-010 SecretManager              | ITP-010-A, -B                         |
| ARCH-011 MonitoringLogger           | ITP-011-A, -B, -C                     |
| ARCH-012 FoodAuthGuard              | ITP-012-A, -B, -C, -D, -E, -F, -G, -H |
| ARCH-013 SourceAdapterRegistry      | ITP-013-A, -B                         |
| ARCH-014 FoodDaoRepository          | ITP-014-A, -B                         |
| ARCH-015 GoldenRecordMergeEngine    | ITP-015-A, -B                         |
| ARCH-016 CandidateResolutionService | ITP-016-A, -B, -C                     |
| ARCH-017 ProvenanceStore            | ITP-017-A, -B                         |
| ARCH-018 ChangeRefreshConsumer      | ITP-018-A, -B                         |
| ARCH-019 AdapterInputValidator      | ITP-019-A, -B                         |

### Technique Distribution

| Technique                            | Test Cases | Percentage |
| ------------------------------------ | ---------- | ---------- |
| Interface Contract Testing           | 30         | 54%        |
| Interface Fault Injection            | 17         | 30%        |
| Data Flow Testing                    | 5          | 9%         |
| Concurrency & Race Condition Testing | 3          | 5%         |
| Consumer-Driven Contract Testing     | 1          | 2%         |
| **Total**                            | **56**     | **100%**   |

> Note: each test case is counted once under its **primary** (first-named) technique. Cases combining
> techniques — ITP-001-C/-E, ITP-004-D, ITP-012-C/-F, ITP-014-B, ITP-015→016-B (Contract + Data Flow /
>
> - Fault Injection) — are tallied under the first technique in their header. The three Concurrency cases
>   are ITP-003-C, ITP-005-A, ITP-014-A; ITP-012-H is the sole CDCT case (the seam-pact technique named in
>   the Overview).

### `TC-*` task handles (feed `tasks.md`)

Every test case exposes a stable `TC-ITP-{NNN}-{X}` handle (printed on the case header) that a task in
`tasks.md` references to pull in all of that case's ITS scenarios. The full set:

`TC-ITP-001-A..E`, `TC-ITP-002-A..C`, `TC-ITP-003-A..C`, `TC-ITP-004-A..E`, `TC-ITP-005-A..C`,
`TC-ITP-006-A..C`, `TC-ITP-007-A..B`, `TC-ITP-008-A..B`, `TC-ITP-009-A..B`, `TC-ITP-010-A..B`,
`TC-ITP-011-A..C`, `TC-ITP-012-A..H`, `TC-ITP-013-A..B`, `TC-ITP-014-A..B`, `TC-ITP-015-A..B`,
`TC-ITP-016-A..C`, `TC-ITP-017-A..B`, `TC-ITP-018-A..B`, `TC-ITP-019-A..B` — **56** handles (one per ITP).

The new-flow handles are the ones `tasks.md` red-gate tasks should cite for the redesign: add-by-name
dedup collapse (`TC-ITP-003-C`, `TC-ITP-014-A`), worker fan-out + golden-record merge + provenance
(`TC-ITP-004-B`, `TC-ITP-015-A`, `TC-ITP-017-A`), UNRESOLVED → candidates → PATCH-resolve
(`TC-ITP-015-B`, `TC-ITP-016-A/B/C`), change-driven refresh (`TC-ITP-018-A/B`), per-source limiter
pause/resume (`TC-ITP-005-A/C`), adapter-registry + input-validation boundary
(`TC-ITP-013-A/B`, `TC-ITP-019-A/B`), and the preserved auth slice (`TC-ITP-012-A..H`).

## Uncovered Modules

None — full coverage achieved (19 / 19 ARCH modules).
