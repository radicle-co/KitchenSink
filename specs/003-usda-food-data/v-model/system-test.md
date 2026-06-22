# System Test Plan: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/v-model/system-design.md`

> **Re-baseline note (2026-06-22).** This System Test Plan (V-Model Layer 2 verification, traces to
> `system-design.md` SYS-_ and `requirements.md` REQ-_) was regenerated to match the **source-agnostic
> food data redesign** (system-design.md re-baselined 2026-06-22). System tests now verify the
> source-agnostic end-to-end behavior: a food is keyed by an internal surrogate `id` (ULID); users add
> foods **by name** through a `PENDING → (UNRESOLVED → resolve) → RESOLVED` lifecycle (terminal
> `NOT_FOUND` / `FAILED`); the worker **fans out across every wired source adapter** and **merges** the
> results into a cross-source **golden record** with per-field provenance; rate limiting is **per source**;
> and refresh is **change-driven**. The prior `fdcId`-keyed cache-hit/miss + `fetch_status` +
> denormalized-nutrient end-to-end flows are **removed** from the canonical system tests. **`fdcId` /
> USDA terminology is confined to the USDA-adapter-boundary tests only** (STP-009-_, STP-014-_ —
> `fdcId → external_key` inbound).
>
> **Preserved (re-keyed) STP ids** — STP-001..STP-013 survive as the same roles, re-keyed from `fdcId`
> to the food `id` and generalized from USDA-only to **per source**. The auth slice (STP-013-A..F)
> keeps its ids and substance, re-keyed `fdcId → id`. **New STP ids** — STP-014..STP-020 cover the new
> capabilities (source-adapter registry, golden-record merge, candidate/resolve, provenance, DAO layer,
> change-driven refresh, adapter input validation/HTTPS). No surviving STP id was renumbered.

## Overview

This document defines the System Test Plan for the Source-Agnostic Food Data Integration feature. Every
system component in `system-design.md` (SYS-001..SYS-020) has one or more Test Cases (STP), and every Test
Case has one or more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **end-to-end architectural behavior** against the SYS components, not unit internals.
The architecture is event-driven and queue-based, and **source-agnostic**: user-facing food lookups are
served exclusively from the local PostgreSQL canonical store (Redis cache is a deferred variant; lean-launch
default is Postgres); **no external source is ever called in the request path**. A food is keyed by an
internal `id` created up front by an **add-by-name** request; the demand path is a Postgres `fetch_queue`
table with `LISTEN/NOTIFY`, drained by a single Fargate **fan-out/merge worker** that fans out across the
**source-adapter registry**, applies a **per-source** rolling-window limiter, and assembles a **golden
record** with per-field provenance. EventBridge is used only for scheduled producers (change-driven refresh)
and the `FoodDataReceived` completion notification. **USDA terms (`fdcId`) live only at the adapter
boundary** (SYS-009 / SYS-014), mapped to `external_key` inbound.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001
- **Re-baseline (2026-06-22):** STP-001..STP-013 preserved (re-keyed `fdcId → id`, USDA → per-source);
  STP-014..STP-020 are new.

## ISO 29119 Test Techniques

Each test case identifies its technique by name:

- **Interface Contract Testing** — Verifies API/component contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data/lifecycle classes
- **State Transition** — Tests ordered/sequenced behavior (e.g. the `PENDING → UNRESOLVED → RESOLVED`
  lifecycle; status-precedence resolution between competing faults)
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (FoodApiController)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-033, REQ-047, REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-009

#### Test Case: STP-001-A (Local-Store-Only Serving — No External Source Call in Request Path)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-003: SYS-001 → SYS-007 via SYS-018)
**Description**: Verifies that FoodApiController serves the golden record exclusively from the local store
(lean default: PostgreSQL canonical store; deferred variant adds a Redis cache) and never invokes any
external source during the request lifecycle (REQ-001/REQ-009).

- **System Scenario: STS-001-A1**
    - **Given** a food exists in the canonical store with a known `id` and `status = 'RESOLVED'` (its golden record assembled from one or more sources); no outbound route to any external source is available
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** FoodApiController reads via the DAO layer (SYS-018) → `findById` against SYS-007; no outbound HTTP call to any source (`api.nal.usda.gov` or otherwise) is made; response is `200 OK` with the golden record (`id`, `name`, `description`, `kind`, `status:'RESOLVED'`, normalized nutrients incl. calories/protein/carbs/fat, portions, and per-field provenance)

- **System Scenario: STS-001-A2** _(deferred Redis variant)_
    - **Given** the deferred Redis cache is enabled and holds `food:{id}` for a `RESOLVED` food
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** FoodApiController serves the golden record from the `GET food:{id}` cache hit (SYS-008); no `findById` is issued to SYS-007; no outbound source call. _(Under the lean Postgres default this read is served by STS-001-A1's indexed `findById` instead.)_

#### Test Case: STP-001-B (HTTP Status Code Contract per Lifecycle Status)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (`food.status` lifecycle enum: `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`)
**Description**: Verifies that FoodApiController returns the correct HTTP status code for each lifecycle
`status` partition (REQ-002/REQ-003/REQ-004/REQ-033). `200` is reserved for `RESOLVED`; `PENDING`/`UNRESOLVED`
are `202`; `NOT_FOUND`/`FAILED`/no-row are `404` with the status still retrievable.

- **System Scenario: STS-001-B1** (`RESOLVED → 200`)
    - **Given** the canonical store holds a food with `status = 'RESOLVED'`
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** response status is `200 OK`; body is the full golden record keyed on `id`

- **System Scenario: STS-001-B2** (`PENDING → 202`)
    - **Given** the canonical store holds a food with `status = 'PENDING'`
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** response status is `202 Accepted`; body is `{ "id": <ulid>, "status": "PENDING", "estimatedWaitSeconds": <positive integer> }`; **no new fetch is enqueued** by a read (the fetch was enqueued at add time)

- **System Scenario: STS-001-B3** (`UNRESOLVED → 202`)
    - **Given** the canonical store holds a food with `status = 'UNRESOLVED'` (the fan-out yielded multiple non-collapsible candidates)
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** response status is `202 Accepted`; body is `{ "id": <ulid>, "status": "UNRESOLVED" }` directing the client to `GET /v1/foods/{id}/candidates` (SYS-016); no fetch is enqueued

- **System Scenario: STS-001-B4** (`NOT_FOUND → 404`, status retrievable)
    - **Given** the canonical store holds a food with `status = 'NOT_FOUND'` (terminal tombstone, no source has it)
    - **When** FoodApiController receives `GET /v1/foods/{id}` (and `GET /v1/foods/{id}/status`)
    - **Then** response status is `404 Not Found`; the lifecycle `status` remains retrievable so a client holding the `id` can see _why_ it is not `200`; **no** fetch is enqueued and **no** source call is made

- **System Scenario: STS-001-B5** (`FAILED → 404`, status retrievable)
    - **Given** the canonical store holds a food with `status = 'FAILED'` (a source fetch errored after the bounded retry budget)
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** response status is `404 Not Found` with the `status` retrievable (a `FAILED` status message suggests trying again later); no fetch is enqueued by the read (the held food remains re-fetchable only via an explicit add)

- **System Scenario: STS-001-B6** (no row → 404)
    - **Given** no food row exists for the supplied (well-formed) `id`
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** response status is `404 Not Found`; no row is created and no fetch is enqueued (a read never enqueues — adds are the only enqueue path)

#### Test Case: STP-001-C (Input Validation — id / name Boundary Values)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (`id`: well-formed ULID; `POST` name: non-empty)
**Description**: Verifies that FoodApiController rejects malformed `id` path params and empty/whitespace
names with `400` before any downstream component is invoked (REQ-006), so no invalid input reaches the
`fetch_queue`.

- **System Scenario: STS-001-C1**
    - **Given** FoodApiController is running
    - **When** it receives `GET /v1/foods/not-a-ulid` (malformed `id`)
    - **Then** response status is `400 Bad Request`; no read is issued to SYS-018/SYS-007 and nothing is enqueued

- **System Scenario: STS-001-C2**
    - **Given** FoodApiController is running
    - **When** it receives `POST /v1/foods` with `{ "name": "   " }` (whitespace-only name)
    - **Then** response status is `400 Bad Request`; no canonical row is created, no requester demand recorded, and no `fetch_queue` row inserted

- **System Scenario: STS-001-C3**
    - **Given** FoodApiController is running
    - **When** it receives `POST /v1/foods` with an empty body / missing `name`
    - **Then** response status is `400 Bad Request`; no downstream component is invoked

- **System Scenario: STS-001-C4**
    - **Given** FoodApiController is running
    - **When** it receives `GET /v1/foods/{id}` with a **well-formed** ULID `id`
    - **Then** the request proceeds to the DAO read (SYS-018); the response is not `400`

#### Test Case: STP-001-D (Search Endpoint — Local-Only Execution, Returns ids)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-IF-003: SYS-001 → SYS-007 full-text/trigram search)
**Description**: Verifies that `GET /v1/foods/search` executes exclusively against the local canonical store
using `pg_trgm`/FTS, returns canonical `id`s ranked by relevance, supports barcode/`external_key` lookup via
the `food_sources` crosswalk, and never calls any external source (REQ-008/REQ-009/REQ-010).

- **System Scenario: STS-001-D1**
    - **Given** the canonical store contains many `RESOLVED` foods; no outbound network route to any source is available
    - **When** FoodApiController receives `GET /v1/foods/search?query=chicken`
    - **Then** FoodApiController issues a trigram/tsvector query against SYS-007 via the DAO layer; results are returned as canonical `id`s ranked by relevance; no outbound source call is made; response time is under 200ms

- **System Scenario: STS-001-D2** (scale boundary)
    - **Given** the canonical store contains 50,000 foods
    - **When** FoodApiController receives `GET /v1/foods/search?query=broccoli`
    - **Then** the relevance-ranked `id` list is returned within 200ms at p95 (SC-007)

- **System Scenario: STS-001-D3** (barcode / external_key lookup via crosswalk)
    - **Given** a `RESOLVED` food is backed by a known barcode / a source's `external_key` recorded in `food_sources`
    - **When** FoodApiController receives a search/lookup by that barcode / `external_key`
    - **Then** FoodApiController resolves it to the food's canonical `id` via the `food_sources (source, external_key)` crosswalk (SYS-007); no source call is made

#### Test Case: STP-001-E (Add-By-Name — id Created Up Front, 202 + PENDING)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-001: SYS-001 → SYS-018 createByName; IC-002: SYS-001 → SYS-003 enqueue)
**Description**: Verifies the primary entry capability `POST /v1/foods` (add by name, US-2): create the
canonical row + `id`, record distinct-requester demand, enqueue the sync, and return `202 Accepted` with the
`id` (REQ-005/REQ-047/REQ-IF-009). End-to-end resolution is covered by STP-005; this case verifies the
synchronous add contract.

- **System Scenario: STS-001-E1**
    - **Given** no food exists for the normalized name "broccoli"
    - **When** FoodApiController receives `POST /v1/foods` with `{ "name": "broccoli" }`
    - **Then** FoodApiController calls SYS-018 `createByName` (advisory-lock dedup) creating a `food` row with `id = <ULID>`, `normalized_name`, `status = 'PENDING'`; upserts `(food_id, sub)` into `fetch_requesters` (SYS-004); inserts a `fetch_queue` row `ON CONFLICT (food_id)` (SYS-003) and issues `pg_notify('fetch_queued', id)`; response is `202 Accepted` with `{ "status": "PENDING", "id": <ulid>, "estimatedWaitSeconds": 30 }` within 100ms

#### Test Case: STP-001-F (Batch Endpoint — Per-Item Partial Response, ids)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (IC-012: SYS-001 batch; SYS-001 → SYS-018 read / SYS-003 enqueue for misses)
**Description**: Verifies that `POST /v1/foods/batch` mixing `RESOLVED` and unknown names returns a per-item
partial result in one response — resolved foods inline with their `id`s, each miss as a `PENDING` entry whose
row is created and fetch enqueued — rather than all-or-nothing withholding (REQ-040a, US-4).

- **System Scenario: STS-001-F1**
    - **Given** a batch of 15 ingredient names where 10 already resolve locally (`status = 'RESOLVED'`) and 5 do not
    - **When** FoodApiController receives `POST /v1/foods/batch` with those 15 names
    - **Then** the single response body returns the 10 resolved foods inline (with `id`s + golden-record data) and the 5 misses each as `{ "status": "PENDING", "id": <ulid> }`; for each miss a canonical row + `id` is created and a `fetch_queue` row enqueued `ON CONFLICT` (SYS-003); the caller receives available data immediately and polls only the pending `id`s

- **System Scenario: STS-001-F2** (in-flight collapse within a batch)
    - **Given** within a 5-name batch, 3 names are already in flight (rows created and queued) and 2 are truly new
    - **When** FoodApiController processes the batch
    - **Then** the 3 in-flight names collapse to their existing `id`s (normalized-name dedup, SYS-018) and only the 2 new names create new rows; no duplicate `fetch_queue` rows are created

---

### Component Verification: SYS-002 (EventBridgeBus — scheduled producers + FoodDataReceived only)

**Parent Requirements**: REQ-032, REQ-IF-005

> **Demand path is NOT EventBridge.** Add-by-name **demand** enqueues by inserting a `fetch_queue` row and
> signalling `pg_notify('fetch_queued', id)` (Postgres `LISTEN/NOTIFY`), drained by the Fargate worker —
> EventBridge is **not** on the request/demand path. EventBridge carries **only** scheduled producers
> (change-driven refresh, `IngestionScheduled`) and the asynchronous `FoodDataReceived` completion event.
> The scenarios below assert `fetch_queue` insert + `pg_notify` for the demand path and EventBridge for the
> scheduled/completion paths only.

#### Test Case: STP-002-A (Demand-Path Enqueue Bypasses EventBridge — fetch_queue + pg_notify)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-002: SYS-001 → SYS-003; SYS-001 → SYS-004)
**Description**: Verifies that an add-by-name cache miss inserts one row into the single demand-weighted
`fetch_queue` (SYS-003) and records the distinct requester in `fetch_requesters` (SYS-004) **directly from
SYS-001**, with **no** EventBridge event on the demand path (REQ-IF-005).

- **System Scenario: STS-002-A1**
    - **Given** SYS-001 resolves an add-by-name cache miss for a new normalized name requested by `sub = "user_abc"`, creating `food.id = X`
    - **When** SYS-001 executes `INSERT INTO fetch_queue (food_id) VALUES (X) ON CONFLICT (food_id) DO UPDATE …`, upserts `(X, "user_abc")` into `fetch_requesters` `ON CONFLICT DO NOTHING`, and issues `pg_notify('fetch_queued', X)`
    - **Then** exactly one row exists in SYS-003 for `X` and exactly one row in SYS-004 for `(X, "user_abc")`; **no** EventBridge event is published on this demand path (the only producers are the scheduled `IngestionScheduled` and the completion `FoodDataReceived`)

#### Test Case: STP-002-B (Scheduled Producer + Completion Event Routing via EventBridge)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-019 scheduled; SYS-005 → SYS-002 → SYS-010 completion)
**Description**: Verifies that EventBridge routes the scheduled `IngestionScheduled` producer to the
change-driven refresh (SYS-019) and the `FoodDataReceived` completion event emitted by the worker (SYS-005)
to its consumers (REQ-032/REQ-IF-005).

- **System Scenario: STS-002-B1** (scheduled producer)
    - **Given** an `IngestionScheduled` cron rule is configured on the EventBridge bus
    - **When** the rule fires
    - **Then** the event is routed to SYS-019 (ChangeDrivenRefresh); no demand-path `fetch_queue` insert is performed by the bus itself (SYS-019 decides what to re-enqueue)

- **System Scenario: STS-002-B2** (completion event)
    - **Given** the worker (SYS-005) finishes resolving a food and publishes `FoodDataReceived { id, status }`
    - **When** EventBridge routes the event
    - **Then** the event is delivered to its consumers (the deferred WebSocket notifier SYS-010); failure to deliver is fire-and-forget and does not affect the core pipeline (polling remains the primary notification)

#### Test Case: STP-002-C (Fault Injection — fetch_queue Insert Failure on the Demand Path)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-001 → SYS-003: enqueue failure)
**Description**: Verifies system behavior when the demand-path `fetch_queue` insert fails (REQ-011/REQ-014).

- **System Scenario: STS-002-C1**
    - **Given** the `fetch_queue` insert is unavailable (simulated via Postgres error or permission deny)
    - **When** FoodApiController attempts to enqueue the sync for a newly-added food `id`
    - **Then** the food is not resolved; on a subsequent `GET /v1/foods/{id}` the client sees `PENDING` (`202`) or, if the row was never created, `404` — the failure does not crash the request path; no row reaches SYS-003

---

### Component Verification: SYS-003 (FetchQueue — single demand-weighted queue, keyed on food id)

**Parent Requirements**: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-018, REQ-039, REQ-IF-005

> **Single demand-weighted queue, keyed on the food `id`.** SYS-003 is the one `fetch_queue` table
> (`food_id PRIMARY KEY REFERENCES food(id)`). There is no static high/low priority split. Drain order is
> `ORDER BY <effective_priority> DESC, first_requested ASC`, where `<effective_priority>` is the capped
> distinct-`sub` `request_count` (from SYS-004) with aging and a dynamic >50-pending demotion overlay
> computed at drain time. Rows carry a single `status` of `pending | in_flight | tombstone`.

#### Test Case: STP-003-A (Demand-Weighted Ordering + 30s Lease Delivery Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-003; SYS-003 → SYS-005)
**Description**: Verifies that the single `fetch_queue` is drained in demand-weighted order —
`request_count DESC, first_requested ASC` — and delivers leased rows to SYS-005 under a single 30s
`in_flight` lease (REQ-015/REQ-017), keyed on the food `id`.

- **System Scenario: STS-003-A1**
    - **Given** `fetch_queue` holds three pending rows keyed on food ids — `{ food_id: A, request_count: 50, first_requested: t0 }`, `{ food_id: B, request_count: 1, first_requested: t1 }`, `{ food_id: C, request_count: 50, first_requested: t2 }` (`t0 < t1 < t2`)
    - **When** SYS-005 claims pending rows via `SELECT food_id … WHERE status='pending' AND last_requested <= now() ORDER BY <effective_priority> DESC, first_requested ASC FOR UPDATE SKIP LOCKED LIMIT 1` and transitions each to `in_flight` under a single 30s lease
    - **Then** rows are delivered highest-demand-first with the oldest `first_requested` breaking ties — `A` (count 50, t0) before `C` (count 50, t2) before `B` (count 1); each leased row carries `food_id` intact; no static `priority` column participates

#### Test Case: STP-003-B (Idempotent Enqueue Dedup + Distinct-Requester request_count)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-002: SYS-001 → SYS-003; SYS-004 → SYS-003 request_count)
**Description**: Verifies queue-grain dedup (`ON CONFLICT (food_id)`) and that repeated adds for the same
`id` increment the **capped distinct-`sub`** `request_count` rather than creating duplicate rows
(REQ-013/REQ-014/REQ-039, US-5).

- **System Scenario: STS-003-B1**
    - **Given** a `fetch_queue` row exists for `food_id = X` with `request_count = 1` (requested by `user_a`)
    - **When** a second distinct `sub` `user_b` adds the same food, and `user_a` re-adds it a third time
    - **Then** no duplicate row is created; `request_count` becomes `2` (each `sub` contributes at most 1 — `PRIORITY_CAP = 1`; `user_a`'s repeat is a no-op via `fetch_requesters` `ON CONFLICT DO NOTHING`); the single row's `last_requested` is updated

#### Test Case: STP-003-C (Tombstone Routing on Terminal Failure — DLQ-equivalent, 30-day TTL)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-003 → SYS-005 failure path; tombstone retention)
**Description**: Verifies that rows exceeding the retry budget (5 attempts, `FAILED`) or whose fan-out finds
no source (`NOT_FOUND`) are tombstoned (`status = 'tombstone'`, the DLQ-equivalent) and retained for a
30-day TTL (REQ-016/REQ-018/REQ-025/REQ-027), fully auditable via SQL.

- **System Scenario: STS-003-C1** (FAILED after retry budget)
    - **Given** a row `{ food_id: F }` is pending; the source fan-out errors (5xx/timeout) on each attempt and the lease (30s) expires for retry between attempts
    - **When** the row has been attempted 5 times without success
    - **Then** the food is set to `status = 'FAILED'` and the `fetch_queue` row to `status = 'tombstone'` with `last_error` populated; it is no longer leasable from the pending set; `SELECT * FROM fetch_queue WHERE status='tombstone'` returns the row with `attempts`, `last_error`, `last_requested`

- **System Scenario: STS-003-C2** (NOT_FOUND tombstone TTL re-attempt)
    - **Given** a food is `status = 'NOT_FOUND'` with `fetch_queue status='tombstone'` and `tombstoned_at` older than the 30-day TTL
    - **When** a later add-by-name for that normalized name arrives after the TTL lapses
    - **Then** the fan-out is re-attempted (a fresh `fetch_queue` row enqueued); within the TTL the same add would instead surface the `NOT_FOUND` food (`404`) without re-enqueueing; the re-attempt counts against the per-source rolling-window budget (REQ-019), so it cannot bypass the rate limit

---

### Component Verification: SYS-004 (FetchRequesters — distinct-requester demand)

**Parent Requirements**: REQ-014, REQ-039

> **Demand index, not a second queue.** SYS-004 is the `fetch_requesters` table recording distinct
> `(food_id, sub)` pairs. Its capped `count(*)` per `food_id` (`PRIORITY_CAP = 1` per `sub` via
> `ON CONFLICT DO NOTHING`) drives `fetch_queue.request_count`; each `sub`'s live pending count drives the
> SYS-013 demotion overlay; and the set is the per-recipient WebSocket subscription set (SYS-010). Keyed on
> the food `id`, not a source key. It does not deliver rows to SYS-005.

#### Test Case: STP-004-A (Distinct-Requester Demand — Idempotent Upsert Drives request_count)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-004; SYS-004 → SYS-003 request_count)
**Description**: Verifies that `fetch_requesters` records distinct `(food_id, sub)` pairs idempotently
(one row per requester, capped at 1 per `sub`) and that the `count(*)` per `food_id` drives the capped
`fetch_queue.request_count` (REQ-014/REQ-039, FR-044).

- **System Scenario: STS-004-A1**
    - **Given** `fetch_requesters` is empty for `food_id = X`
    - **When** SYS-001 upserts `(X, "user_a")`, then `(X, "user_b")`, then `(X, "user_a")` again — each `INSERT … ON CONFLICT (food_id, sub) DO NOTHING`
    - **Then** exactly two rows exist for `X` — `(X, "user_a")` and `(X, "user_b")` — the repeated `(X, "user_a")` upsert is a no-op (idempotent, cap 1 per `sub`); `count(*) WHERE food_id = X` is `2`, driving `fetch_queue.request_count = 2`; no row is delivered to SYS-005 from this table

#### Test Case: STP-004-B (Demand Decay on Terminal Resolution)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-004 ↔ SYS-003 lifecycle)
**Description**: Verifies that `fetch_requesters` demand is tied to the `fetch_queue` row lifecycle — when a
row is terminally resolved (success-resolve or tombstone after the retry budget), its backing demand no
longer contributes to any active drain ordering (REQ-039).

- **System Scenario: STS-004-B1**
    - **Given** `food_id = F` has two `fetch_requesters` rows (`request_count = 2`) and its `fetch_queue` row repeatedly fails its source fan-out 5 times
    - **When** the row is set to `status = 'tombstone'` and the food to `FAILED`
    - **Then** the tombstoned row is no longer leasable; its `fetch_requesters` demand no longer contributes to any active `request_count` ordering for `F`

---

### Component Verification: SYS-005 (FoodFanOutMergeWorker)

**Parent Requirements**: REQ-015, REQ-016, REQ-017, REQ-024, REQ-025, REQ-027, REQ-042, REQ-050

#### Test Case: STP-005-A (Demand-Weighted Lease Order)

**Technique**: Interface Contract Testing
**Target View**: Dependency View (SYS-003 → SYS-005)
**Description**: Verifies that the Fargate fan-out/merge worker leases from the single `fetch_queue` in
demand-weighted order — `<effective_priority> DESC, first_requested ASC` — so high-demand foods drain
before low/zero-demand (background/refresh) rows, without any static priority tier (REQ-015, US-5).

- **System Scenario: STS-005-A1**
    - **Given** `fetch_queue` contains both high-demand rows (`request_count ≥ 2`) and low/zero-demand background/refresh rows
    - **When** the worker begins a drain cycle
    - **Then** the worker processes the available high-demand rows before leasing any low/zero-demand row (ordering is `request_count DESC, first_requested ASC` with aging)

- **System Scenario: STS-005-A2**
    - **Given** `fetch_queue` contains only low/zero-demand background rows (no high-demand rows pending)
    - **When** the worker begins a drain cycle
    - **Then** the worker leases and processes the available background rows (they sort last only relative to high-demand rows; with none pending they drain normally)

#### Test Case: STP-005-B (End-to-End Fan-Out + Golden-Record Merge → RESOLVED — Full Success Path)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-006 SYS-005 → SYS-014; IC-007 SYS-005 → SYS-015; IC-008 SYS-005 → SYS-018)
**Description**: Verifies the complete add-by-name resolution journey (US-2 acceptance #2/#3): drain the
`fetch_queue` row keyed on `id` → **fan out across every wired source adapter by name** (SYS-014) under the
per-source limiter (SYS-006) and adapter validation (SYS-020) → assemble the **golden record** (SYS-015) →
persist via the DAO layer (SYS-018) with provenance (SYS-017) → set `status = 'RESOLVED'` → resolve the
`fetch_queue` row → emit `FoodDataReceived` (REQ-050/REQ-024).

- **System Scenario: STS-005-B1**
    - **Given** a `fetch_queue` row keyed on `food_id = X` (a PENDING food named "broccoli") is pending; the per-source rolling-window count for each wired source is below the pause threshold; the wired adapters return matching items that collapse to one confident record
    - **When** the worker leases and processes the row
    - **Then** the worker: (1) reads `food.name`; (2) iterates the SourceAdapterRegistry (SYS-014) calling `searchByName` then `fetchByKey` on each adapter (each call check-and-recorded against SYS-006); (3) runs adapter validation/HTTPS (SYS-020) on each mapped candidate; (4) hands normalized candidates to the merge engine (SYS-015) which yields **one confident golden record** (`outcome: 'RESOLVED'`); (5) persists via the DAO layer (SYS-018) — `food` (`status='RESOLVED'`), `food_sources` (`UNIQUE(source, external_key)`, `item_version`), `food_nutrients`/`food_portions` (`source_id`), `food_field_provenance` — recording provenance (SYS-017); (6) resolves the `fetch_queue` row (removed from the pending set; _deferred Redis variant: `DEL food:{id}`_); (7) publishes `FoodDataReceived { id, status:'RESOLVED' }` to SYS-002. A subsequent `GET /v1/foods/{id}` returns `200` with the golden record

#### Test Case: STP-005-C (Fan-Out → UNRESOLVED when Candidates Do Not Collapse)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (`status = 'UNRESOLVED'`; SYS-005 → SYS-015 outcome)
**Description**: Verifies that when the fan-out yields multiple non-collapsible candidates, the worker sets
`status = 'UNRESOLVED'` and surfaces them for a human pick rather than blindly merging (REQ-050, US-2 #6).

- **System Scenario: STS-005-C1**
    - **Given** a pending `food_id = X`; the wired adapters return ≥2 candidates the merge engine (SYS-015) cannot confidently collapse
    - **When** the worker processes the row
    - **Then** the merge `outcome` is `'UNRESOLVED'`; the food is set to `status = 'UNRESOLVED'`; the candidate set is persisted for retrieval via `GET /v1/foods/{id}/candidates` (SYS-016); the `fetch_queue` row is resolved (the food awaits a human pick, not a retry); a subsequent `GET /v1/foods/{id}` returns `202` with `status:'UNRESOLVED'`

#### Test Case: STP-005-D (Fan-Out finds No Source — NOT_FOUND Tombstone, no retry, TTL re-attempt)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (`status = 'NOT_FOUND'`; tombstone TTL default 30 days)
**Description**: Verifies that a fan-out where **no wired source** has the item results in `NOT_FOUND` + a
tombstone with no immediate retry, and that the tombstone carries a 30-day TTL after which a later add MAY
re-attempt (REQ-025, US-2 #5).

- **System Scenario: STS-005-D1**
    - **Given** a pending `food_id = X`; every wired adapter's `searchByName` returns no item
    - **When** the worker processes the row
    - **Then** the food is set to `status = 'NOT_FOUND'`; the `fetch_queue` row is set to `status = 'tombstone'` (`tombstoned_at` recorded); no retry/backoff occurs; no `FoodDataReceived` resolution-success event is emitted

- **System Scenario: STS-005-D2** (TTL re-attempt)
    - **Given** a `NOT_FOUND` tombstone whose age exceeds the 30-day TTL
    - **When** a later add-by-name for the same normalized name arrives
    - **Then** the fan-out is re-attempted (fresh enqueue, `202`/`PENDING`); within the TTL the same add surfaces `404` without re-enqueueing; the re-attempt counts against the per-source rolling-window budget (REQ-019)

#### Test Case: STP-005-E (Source 429 — Treat That Source's Window as Full and Back Off)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-014/SYS-009: source rate limit exceeded)
**Description**: Verifies that a source `429` during fan-out causes the worker to treat **that source's**
rolling window as full, back off, leave the row `pending`, and stop draining further rows needing that source
(REQ-026, US-3 #4).

- **System Scenario: STS-005-E1**
    - **Given** the per-source rolling-window count is below the pause threshold; the worker is processing leased rows; a wired source (e.g. USDA) returns `429 Too Many Requests` during fan-out
    - **When** the worker receives the 429
    - **Then** the worker treats that source's window as full and backs off (pauses draining work needing that source); the current `fetch_queue` row is left `pending` (its 30s lease reverts for retry after the backoff gate); rows needing only other sources are unaffected

#### Test Case: STP-005-F (Source 5xx — Row-Lease Retry with Backoff → FAILED)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-014/SYS-009: transient error)
**Description**: Verifies that source 5xx/timeout errors leave the `fetch_queue` row `pending` for row-lease
retry with backoff and, after 5 cumulative attempts, set the food to `FAILED` + tombstone (REQ-016/REQ-027,
US-5 #5).

- **System Scenario: STS-005-F1**
    - **Given** a pending `food_id = X`; a wired source returns `503 Service Unavailable` during fan-out
    - **When** the worker processes the row
    - **Then** the worker sets `status='pending'`, `attempts = attempts + 1`, `last_requested = now() + backoff(attempts)`; the row becomes leasable again after backoff; after 5 total attempts the food is set to `FAILED` and the row to `status='tombstone'` with `last_error` populated

#### Test Case: STP-005-G (Async-Producer Provenance Validation — FR-048)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-002 → SYS-005: consumer-side provenance check)
**Description**: Verifies that the worker validates each drained row / `IngestionScheduled` event originated
from an authorized principal before processing, so US-0's guarantee holds for async/internal producers
(REQ-042/FR-048).

- **System Scenario: STS-005-G1**
    - **Given** a `fetch_queue` row / scheduled event lacking valid async-producer provenance (not traceable to an authenticated `AuthenticatedCaller` or an authorized named IAM producer)
    - **When** the worker drains it
    - **Then** the row/event is **not processed** (no fan-out, no source call); an error is logged to CloudWatch (SYS-012); only provenance-bearing work proceeds

---

### Component Verification: SYS-006 (PerSourceRollingWindowLimiter)

**Parent Requirements**: REQ-019, REQ-020, REQ-021, REQ-026

> **Per-source window.** SYS-006 holds the worker to ≤ each source's hourly cap in any trailing 60 minutes.
> USDA ≤1,000 with a 90% (900) pause. State is recent source-call timestamps in the Postgres
> `source_call_log` keyed by `source` (lean default); a per-source Redis sorted set is the deferred variant.
> Each wired source gets its own window.

#### Test Case: STP-006-A (Atomic Per-Source Check-and-Record)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-005: SYS-005 → SYS-006)
**Description**: Verifies that the per-source check-and-record operation — counting a source's calls in the
trailing 60 minutes and recording the new call timestamp in one atomic step keyed by `source` — returns the
correct schema (REQ-019/REQ-020, US-3 #1/#5).

- **System Scenario: STS-006-A1**
    - **Given** `source_call_log` contains 500 USDA call timestamps within the trailing 60 minutes (below the 1,000 cap)
    - **When** SYS-005 executes `checkAndRecordCall('USDA')`
    - **Then** the operation returns `{ "allowed": true, "windowCount": 501 }`; exactly one new USDA call timestamp is appended atomically; another source's window is unaffected

- **System Scenario: STS-006-A2**
    - **Given** `source_call_log` contains 1,000 USDA call timestamps within the trailing 60 minutes (at the cap)
    - **When** SYS-005 executes `checkAndRecordCall('USDA')`
    - **Then** the operation returns `{ "allowed": false, "windowCount": 1000 }`; no new timestamp is recorded

#### Test Case: STP-006-B (Per-Source Cap and 90% Pause Boundary Values)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (USDA cap ≤1,000 / trailing-60-min; pause at 90% = 900)
**Description**: Verifies the per-source hard cap and the 90% pause/resume behavior as calls age out of the
trailing 60-minute window at boundary values (REQ-019/REQ-021, US-3 #2/#3).

- **System Scenario: STS-006-B1**
    - **Given** the USDA window holds 900 timestamps within the trailing 60 minutes (the 90% pause threshold)
    - **When** SYS-005 considers the next row needing a USDA call
    - **Then** the worker pauses USDA draining (records no new call) until earlier calls age out; the trailing-60-min count is held ≤900 while paused (≤1,000 cap never breached)

- **System Scenario: STS-006-B2**
    - **Given** the USDA window holds 899 timestamps within the trailing 60 minutes
    - **When** SYS-005 executes a check-and-record for USDA
    - **Then** the operation returns `{ "allowed": true, "windowCount": 900 }`; recording the 900th call reaches the pause threshold, so the next check pauses USDA draining

- **System Scenario: STS-006-B3**
    - **Given** the USDA window holds 900 timestamps and the worker is paused; enough time elapses that the oldest timestamps fall outside the trailing 60-minute window
    - **When** the worker re-evaluates the USDA window
    - **Then** the trailing-60-min count is now below 900; the next check-and-record returns `{ "allowed": true }` and USDA draining resumes

#### Test Case: STP-006-C (Fault Injection — Per-Source Limiter Store Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-006: store unavailable)
**Description**: Verifies worker behavior when the per-source limiter store (`source_call_log` / Redis sorted
set) is unreachable (REQ-021).

- **System Scenario: STS-006-C1**
    - **Given** the per-source limiter store (SYS-006) is unreachable (connection timeout)
    - **When** the worker attempts the atomic check-and-record for a source
    - **Then** the worker does NOT call that source (cannot call it safely); the `fetch_queue` row is re-deferred to `pending` (its 30s lease reverts); an error is logged to CloudWatch (SYS-012)

#### Test Case: STP-006-D (State Loss — Bounded, Self-Converging Burst on source_call_log Reset)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-006 per-source state loss → bounded transient SC-002 breach; HAZ-041)
**Description**: Verifies the limiter's **state-loss** failure mode (spec.md Edge Case / HAZ-041): when a
source's durable `source_call_log` is truncated/reset, the limiter restarts at windowCount = 0 and can fire a
bounded burst before the log refills. The burst is **bounded (≤ ~that source's cap)** and **self-converging**
— the limiter re-pins to ≤ the per-source cap on its own with **no sustained** SC-002 breach — and
conservative startup (treat the window as full / seed from recent `food_sources` fetch timestamps) prevents
the burst entirely. Distinct from STP-006-A/B (math/aging on intact state).

- **System Scenario: STS-006-D1** (bounded, self-converging burst on naive restart)
    - **Given** USDA's `source_call_log` already reflects a near-cap trailing-60-min count (~900 real calls) and a large pending `fetch_queue` backlog; the durable USDA `source_call_log` is then **truncated** (state loss), resetting the observed windowCount to 0 while the real trailing-hour total is unchanged
    - **When** the worker resumes draining USDA work and the limiter performs check-and-record against the now-empty USDA log under naive (non-conservative) startup
    - **Then** the limiter allows new USDA calls until the log refills, firing a burst **bounded above by ~1,000** (USDA's cap); the true trailing-60-min total briefly exceeds 1,000 (a **transient SC-002 breach**) but the window is **self-converging** — it pauses at 900/90% as new timestamps accumulate and re-converges to ≤1,000 within one trailing hour with **no sustained** overage; the SC-002 monitor (SYS-012) records the excursion and return to budget

- **System Scenario: STS-006-D2** (conservative startup suppresses the burst)
    - **Given** the same near-cap real USDA trailing-hour state and a truncated/empty `source_call_log`
    - **When** the limiter performs **conservative startup** on detected state loss — treating the USDA window as full (or seeding windowCount from recent `food_sources`/source fetch timestamps within the trailing hour) instead of trusting the empty log
    - **Then** the limiter pauses USDA draining at/above the 900 threshold immediately; **no burst fires** and **no SC-002 breach occurs** (mitigation per HAZ-041)

---

### Component Verification: SYS-007 (FoodCanonicalPostgresStore)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-008, REQ-010, REQ-028, REQ-029, REQ-NF-018

> **Source-agnostic schema.** SYS-007 holds the normalized, provenance-bearing canonical schema: `food`
> (internal `id` PK, `normalized_name` dedup key, lifecycle `status`), `food_sources`
> (`UNIQUE(source, external_key)`, `item_version`, no payload), `nutrient` (units), `food_nutrients`
> (`amount`, `basis`, `source_id`), `food_portions` (`source_id`), `food_field_provenance`. No `fdcId`, no
> denormalized nutrient columns, no `fetch_status`, no EAV.

#### Test Case: STP-007-A (Golden-Record Upsert Contract — Insert and Update)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-008: SYS-005 → SYS-018 → SYS-007 upsert)
**Description**: Verifies that the canonical-store upsert (via the DAO layer) correctly handles both insert
(new food) and update (existing food) cases for the golden record (REQ-028).

- **System Scenario: STS-007-A1**
    - **Given** no `food` row exists for `id = X`
    - **When** the worker upserts the golden record with `status = 'RESOLVED'`
    - **Then** a new `food` row is inserted with `id`, `name`, `normalized_name`, `description`, `kind`, `status = 'RESOLVED'`, timestamps; the `food_sources` crosswalk row (`UNIQUE(source, external_key)`, `item_version`), `food_nutrients` (`amount`, `basis`, `source_id`), `food_portions` (`source_id`), and `food_field_provenance` rows are persisted; **no** `fetch_status` column and **no** denormalized nutrient column exists

- **System Scenario: STS-007-A2**
    - **Given** a `food` row exists for `id = X` with `status = 'PENDING'`
    - **When** the worker upserts the assembled golden record with `status = 'RESOLVED'`
    - **Then** the existing row is updated; `status` changes to `'RESOLVED'`; `updated_at` is refreshed; no duplicate `food` row is created (the `id` PK and `normalized_name` unique key hold)

#### Test Case: STP-007-B (Lifecycle Status Round-Trip — All Partitions)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (`food.status`: `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`)
**Description**: Verifies that each valid lifecycle `status` partition is stored and retrieved correctly and
maps to the right read response (REQ-002/REQ-003/REQ-004).

- **System Scenario: STS-007-B1** (`PENDING`)
    - **Given** a `food` row is stored with `status = 'PENDING'`
    - **When** the DAO `findById` reads it
    - **Then** the row returns `status = 'PENDING'`; FoodApiController returns `202`

- **System Scenario: STS-007-B2** (`UNRESOLVED`)
    - **Given** a `food` row has `status = 'UNRESOLVED'`
    - **When** the DAO reads it
    - **Then** the row returns `status = 'UNRESOLVED'`; FoodApiController returns `202` directing the client to `/candidates`

- **System Scenario: STS-007-B3** (`RESOLVED`)
    - **Given** a `food` row has `status = 'RESOLVED'` with a complete golden record
    - **When** the DAO reads it
    - **Then** the row returns `status = 'RESOLVED'`; FoodApiController returns `200` with the assembled golden record (scalars + nutrients + portions + provenance)

- **System Scenario: STS-007-B4** (`NOT_FOUND`)
    - **Given** a `food` row has `status = 'NOT_FOUND'` (tombstone)
    - **When** the DAO reads it
    - **Then** the row returns `status = 'NOT_FOUND'`; FoodApiController returns `404` with the status retrievable

- **System Scenario: STS-007-B5** (`FAILED`)
    - **Given** a `food` row has `status = 'FAILED'`
    - **When** the DAO reads it
    - **Then** the row returns `status = 'FAILED'`; FoodApiController returns `404` with the status retrievable; the held food remains re-fetchable

#### Test Case: STP-007-C (Nutrient Fidelity — per-100g Basis Normalization Recorded)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (`food_nutrients.basis`; SC-008 fidelity)
**Description**: Verifies that stored nutrient values are faithful to their source after the documented
per-100g basis normalization, recorded via `basis`, with no lossy rounding beyond that (REQ-NF-018, US-2a #4).

- **System Scenario: STS-007-C1**
    - **Given** a source returns a nutrient at a non-100g basis (e.g. per-serving)
    - **When** the worker normalizes and persists it via the DAO layer
    - **Then** the stored `food_nutrients` row carries the per-100g `amount` with `basis` recording the normalization and `source_id` recording the origin; the value round-trips faithfully (no lossy rounding beyond basis conversion)

#### Test Case: STP-007-D (Fault Injection — Canonical Store Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-001 → SYS-018 → SYS-007: store unavailable)
**Description**: Verifies FoodApiController behavior when the canonical store is unreachable (the DAO layer
returns an error); reads never fall back to a source (REQ-001).

- **System Scenario: STS-007-D1**
    - **Given** the canonical store (SYS-007) is unreachable (connection refused)
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** FoodApiController returns `503 Service Unavailable`; no source call is made; the error is logged to CloudWatch (SYS-012)

---

### Component Verification: SYS-008 (FoodRedisCache — Postgres default; Redis deferred)

**Parent Requirements**: REQ-001, REQ-030

> **Deferred-component caveat (mirrors SYS-006).** The lean-launch default for SYS-008 is **PostgreSQL**
> itself: hot-read serving is the indexed canonical `findById`; pending-fetch dedup is the `fetch_queue`
> `ON CONFLICT` row, **not** a Redis set. **Redis is a deferred variant**. Scenarios below are written
> against the Postgres lean default; the parenthetical Redis variant is the deferred equivalent.

#### Test Case: STP-008-A (Hot-Read Serving from the Local Store)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-007 read; deferred: SYS-001 → Redis GET)
**Description**: Verifies that a hot `RESOLVED` food is served on a single indexed read (REQ-001). Lean
default: a DAO `findById` on `food`; deferred: a `GET food:{id}` cache hit.

- **System Scenario: STS-008-A1**
    - **Given** the canonical store holds a `RESOLVED` food for `id = X`
    - **When** FoodApiController resolves `GET /v1/foods/{id}`
    - **Then** the golden record is returned `200 OK` from a single indexed DAO read against SYS-007; no source call. _(Deferred Redis variant: a `GET food:{id}` cache hit returns `200 OK` with no canonical read.)_

#### Test Case: STP-008-B (Pending-Fetch Deduplication — Idempotent Enqueue, not a Redis set)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-003 pending dedup; deferred: Redis pending set)
**Description**: Verifies that concurrent/repeat adds for the same normalized name produce exactly one
`fetch_queue` row (REQ-013). Lean default: `INSERT INTO fetch_queue … ON CONFLICT (food_id) DO NOTHING/UPDATE`
plus the normalized-name dedup of SYS-018; deferred: a Redis set guard.

- **System Scenario: STS-008-B1**
    - **Given** `food_id = X` already has a pending `fetch_queue` row (an in-flight resolution)
    - **When** a second add for the same normalized name arrives
    - **Then** it collapses to the same `id` and inserts **no** new `fetch_queue` row (the `ON CONFLICT` insert is a no-op / counter update; only the new requester's `fetch_requesters` demand is recorded); response is `202` with `status:'PENDING'`. _(Deferred Redis variant: a pending-set guard short-circuits the second enqueue.)_

#### Test Case: STP-008-C (TTL Boundary — Deferred Redis Cache Freshness)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (deferred Redis TTL: 24 hours)
**Description**: Verifies the deferred Redis cache key format/TTL (REQ-030). Under the lean Postgres default
there is no separate cache layer; this case is meaningful only once Redis is adopted.

- **System Scenario: STS-008-C1** _(deferred Redis variant)_
    - **Given** the deferred Redis cache holds `food:{id}` with the 24h TTL and `allkeys-lfu` eviction
    - **When** the TTL elapses
    - **Then** the next `GET food:{id}` returns nil and FoodApiController falls through to the canonical store (SYS-007); under the lean default the canonical store is always authoritative

#### Test Case: STP-008-D (Fault Injection — Deferred Cache Unavailable, Fallthrough)

**Technique**: Fault Injection
**Target View**: Dependency View (deferred: SYS-001 → Redis unavailable)
**Description**: Verifies that, **in the deferred Redis variant**, cache unavailability causes a fallthrough
to the canonical store without an error. Under the lean default this degenerates to the SYS-007-unavailable
case (STP-007-D).

- **System Scenario: STS-008-D1** _(deferred Redis variant)_
    - **Given** the deferred Redis cache is enabled but unreachable; the canonical store holds a `RESOLVED` food
    - **When** FoodApiController receives `GET /v1/foods/{id}`
    - **Then** FoodApiController falls through to SYS-007; response is `200 OK`; no `503` is returned due to the deferred cache failure alone

---

### Component Verification: SYS-009 (UsdaSourceApi — adapter-boundary external system, fdcId only here)

**Parent Requirements**: REQ-019, REQ-023, REQ-IF-004, REQ-IF-006

> **Adapter-boundary scope.** SYS-009 is the external USDA FoodData Central API. **`fdcId` exists only at
> this boundary** (and in SYS-014's USDA adapter), mapped to `external_key` inbound. These are the only
> system tests in this plan that legitimately reference `fdcId`.

#### Test Case: STP-009-A (USDA Batch Endpoint Contract — POST /v1/foods, ≤20 fdcIds, 1 windowed call)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-009: SYS-014 → SYS-009)
**Description**: Verifies that the USDA adapter calls the USDA batch endpoint with the correct request schema
and that batching ≤20 `fdcId`s counts as exactly 1 call against USDA's rolling window (REQ-023/REQ-IF-004,
US-4 #3). `fdcId` is confined to this boundary, mapped to `external_key` inbound.

- **System Scenario: STS-009-A1**
    - **Given** USDA's trailing-60-min window is below the pause threshold; the USDA adapter resolved that several queued foods are backed by USDA items `[fdcId1 … fdcIdN]` (N ≤ 20)
    - **When** the adapter calls `POST https://api.nal.usda.gov/fdc/v1/foods` with `Authorization`/API-key and body `{ "fdcIds": [fdcId1 … fdcIdN] }`
    - **Then** USDA returns `200 OK` with an array of food objects; exactly **1** call is recorded against the USDA per-source window (SYS-006) regardless of batch size; the adapter maps each `fdcId → external_key` inbound (no `fdcId` escapes the adapter)

- **System Scenario: STS-009-A2** (single fetch + over-batch split)
    - **Given** the USDA adapter must fetch 21 USDA items (exceeds the 20-key batch limit)
    - **When** the adapter fetches them
    - **Then** it splits into 2 USDA calls (20 + 1) — single fetches use `GET /v1/food/{fdcId}` — and records **2** calls against the USDA window; the 20-key cap is an adapter-internal detail invisible to the canonical API

#### Test Case: STP-009-B (USDA API Key Injection from Secrets Manager)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-011 → SYS-014: USDA_API_KEY injection)
**Description**: Verifies that the USDA adapter authenticates using the API key from SYS-011 (REQ-IF-006).

- **System Scenario: STS-009-B1**
    - **Given** the USDA API key is injected into the worker/adapter from SYS-011
    - **When** the adapter calls the USDA API over HTTPS
    - **Then** the `Authorization`/API-key header carries the correct key; USDA returns `200 OK` (not `401`); the key never appears in responses or logs

---

### Component Verification: SYS-010 (WebSocketNotificationLambda — deferred US-9)

**Parent Requirements**: REQ-034, REQ-043, REQ-IF-008

#### Test Case: STP-010-A (Fire-and-Forget WebSocket Push — No Impact on Core Pipeline)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-010 → SYS-001/SYS-005: fire-and-forget)
**Description**: Verifies that WebSocketNotificationLambda failure does not affect FoodApiController or the
fan-out/merge pipeline (polling remains primary, REQ-033/REQ-034).

- **System Scenario: STS-010-A1**
    - **Given** WebSocketNotificationLambda (SYS-010) is unavailable or throws
    - **When** the worker publishes `FoodDataReceived { id, status }` to SYS-002
    - **Then** routing to SYS-010 fails silently; FoodApiController continues serving and the worker continues processing; no error propagates to the core pipeline

#### Test Case: STP-010-B (Per-Recipient Push on FoodDataReceived — Targeted via fetch_requesters)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-002 → SYS-010; SYS-010 → SYS-004 subscription set)
**Description**: Verifies that WebSocketNotificationLambda is triggered by `FoodDataReceived` and pushes the
food `id` only to connections whose authenticated `sub` requested that food `id`, never broadcast
(REQ-034/REQ-043, US-0 #8).

- **System Scenario: STS-010-B1**
    - **Given** clients are connected; the worker publishes `FoodDataReceived { "id": "<ulid>", "status": "RESOLVED" }`; the `fetch_requesters` subscription set records which `sub`s requested that `id`
    - **When** EventBridge routes the event to SYS-010
    - **Then** SYS-010 pushes `{ "type": "food_ready", "id": "<ulid>" }` via the API Gateway Management API only to the connections whose authenticated `sub` is in the `fetch_requesters` set for that `id`; non-subscribed connections receive nothing

---

### Component Verification: SYS-011 (SecretManagement — per-source API keys)

**Parent Requirements**: REQ-IF-006, REQ-044c

#### Test Case: STP-011-A (Per-Source API Key Injection into the Worker/Adapter)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-011 → SYS-014)
**Description**: Verifies that each external source's API key (e.g. the USDA key) is retrieved from Secrets
Manager and injected into the worker's adapter (REQ-IF-006/REQ-044c).

- **System Scenario: STS-011-A1**
    - **Given** Secrets Manager holds the per-source secret (e.g. `food-service/usda-api-key`)
    - **When** the worker/adapter starts
    - **Then** the source's API key is injected into the adapter environment; the adapter authenticates to its source; the key is never exposed in responses or logs (each source's key is the only secret on the path)

#### Test Case: STP-011-B (Fault Injection — Secrets Manager Unavailable)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-014 → SYS-011: unavailable)
**Description**: Verifies that an adapter cannot call its source when its secret is unreachable, contributing
nothing to the fan-out (REQ-IF-006).

- **System Scenario: STS-011-B1**
    - **Given** Secrets Manager (SYS-011) is unreachable (network partition or IAM deny)
    - **When** the adapter attempts to retrieve its source API key
    - **Then** the adapter does NOT call its source; it contributes nothing to the fan-out; an error is logged to CloudWatch (SYS-012); the `fetch_queue` row is re-deferred (lease reverts) or the food resolves from remaining sources

---

### Component Verification: SYS-012 (MonitoringAndLogging)

**Parent Requirements**: REQ-NF-012, REQ-NF-016

#### Test Case: STP-012-A (Structured Log Emission — API Service and Worker)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-012; SYS-005 → SYS-012)
**Description**: Verifies that both FoodApiController and the fan-out/merge worker emit structured logs to
CloudWatch (REQ-NF-012/REQ-NF-016).

- **System Scenario: STS-012-A1**
    - **Given** FoodApiController is invoked with `GET /v1/foods/{id}`
    - **When** the request completes (success or error)
    - **Then** a structured log entry is written to the API CloudWatch log group containing at minimum: `id`, lifecycle `status`, HTTP response code, and request duration

- **System Scenario: STS-012-A2**
    - **Given** the worker processes a `fetch_queue` row from SYS-003
    - **When** processing completes (RESOLVED, UNRESOLVED, NOT_FOUND, FAILED, 429, or 5xx)
    - **Then** a structured log entry is written to the worker CloudWatch log group containing: `id`, per-source response code(s), per-source trailing-60-min window count, merge outcome, and resolution outcome

#### Test Case: STP-012-B (X-Ray Tracing — Distributed Request Visibility)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-001 → SYS-012 tracing)
**Description**: Verifies that X-Ray traces span FoodApiController and the worker across the resolution flow.

- **System Scenario: STS-012-B1**
    - **Given** X-Ray active tracing is enabled on the API service and the worker
    - **When** an add-by-name triggers the full pipeline: SYS-001 → `fetch_queue` insert + `pg_notify` → worker → fan-out (SYS-014) → merge (SYS-015) → canonical store
    - **Then** an X-Ray trace is recorded with segments per component; the trace is queryable by the food `id`

#### Test Case: STP-012-C (CloudWatch Alarms — SC-002 Per-Source Window & Tombstone Count)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View (alarm thresholds; SC-002 / SC-006)
**Description**: Verifies that CloudWatch alarms make per-source rolling-window compliance (no rolling-hour
window over a source's cap, zero `429`) and zero-data-loss tombstoning verifiable (REQ-NF-012/REQ-NF-016).

- **System Scenario: STS-012-C1** (per-source window / error-rate alarm)
    - **Given** an alarm is configured on the worker per-source window metric / error rate
    - **When** a source's trailing-hour count approaches its cap, a `429` occurs, or the worker error rate exceeds the threshold
    - **Then** the alarm transitions to `ALARM`; an SNS notification is triggered; the SC-002 excursion is recorded

- **System Scenario: STS-012-C2** (tombstone-count alarm)
    - **Given** a CloudWatch metric tracks the `fetch_queue` tombstone-row count (the audit record; no DLQ)
    - **When** persistently failing foods are tombstoned (`FAILED`/`NOT_FOUND`)
    - **Then** the tombstone-row count is trackable/alarmable, evidencing zero data loss from queue-processing failures (SC-006)

---

### Component Verification: SYS-013 (AuthnAuthzLayer)

**Parent Requirements**: REQ-035, REQ-IF-007, REQ-IF-008, REQ-037a–d, REQ-038a–c, REQ-039, REQ-040a–b, REQ-041, REQ-042, REQ-043, REQ-044a–d

The auth layer is the in-process NestJS `AuthMiddleware`/`FoodAuthGuard` (using `@kitchensink/clerk-verify`)
on the ECS/Fargate food read service; it is not a Lambda authorizer (except the deferred WebSocket
`$connect` authorizer). It fronts **every** food data entry point (every HTTP `/v1/foods/*` route and the
WebSocket `$connect`). These scenarios verify its architectural behavior as a black box: rejection before any
downstream component is reached (no `fetch_queue` insert, no source call), the load-shed property under an
invalid-token flood, per-`sub` fairness by queue demotion (not rejection), the scope-`403`/M2M authorization
classes, the `401`→`403`→`400`→business status-precedence ordering, and the batch-size boundary. Verification
is networkless (`@clerk/backend` `verifyToken` against the non-secret `CLERK_JWT_KEY`), fail-closed. **The
auth slice is preserved from the prior baseline, re-keyed `fdcId → id`** (every path param, demotion key, and
subscription target is now the internal food `id`).

#### Test Case: STP-013-A (Fail-Closed `401` at Every Entry Point — No Enqueue, No Source Call)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-013 → SYS-001, SYS-010); Dependency View (SYS-013 → SYS-003)
**Description**: Verifies that SYS-013 rejects unauthenticated, expired, malformed, and
wrong-`azp`/wrong-instance requests with `401` at every HTTP route and the WebSocket `$connect`, before
SYS-001/SYS-010 business logic runs, and that no row is enqueued to the SYS-003 `fetch_queue` (nor demand
recorded in SYS-004) and no source call is made (SC-010). _(Invalid-credential classes: missing token,
expired `exp`, not-yet-valid `nbf`, malformed/garbage, valid signature but wrong `azp`, token for a different
Clerk instance.)_

- **System Scenario: STS-013-A1**
    - **Given** SYS-013 is attached to every `/v1/foods/*` route; no `Authorization` header is present
    - **When** each entry point is exercised in turn — `POST /v1/foods`, `GET /v1/foods/{id}`, `GET /v1/foods/{id}/status`, `GET /v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`, `GET /v1/foods/search?query=chicken`, and `POST /v1/foods/batch`
    - **Then** every endpoint returns `401 Unauthorized`; SYS-001 business logic is not reached; no row is inserted into the SYS-003 `fetch_queue` and no demand is recorded in SYS-004; no outbound source call is made

- **System Scenario: STS-013-A2**
    - **Given** SYS-013 fronts the WebSocket API Gateway `$connect` route
    - **When** a `$connect` is attempted with no token (and, separately, an expired token and a wrong-`azp` token)
    - **Then** the connection is rejected with `403` (pinned `$connect` status) before establishment; no `connectionId` is registered; no subscription row is written; no downstream component is invoked

- **System Scenario: STS-013-A3**
    - **Given** SYS-013 receives, across separate `GET /v1/foods/{id}` requests, each invalid-credential class — expired (`exp` past), not-yet-valid (`nbf` future), malformed/garbage Bearer, a token whose `azp` ∉ `CLERK_AUTHORIZED_PARTIES`, and a token signed for a different Clerk instance
    - **When** each request is processed
    - **Then** every request returns `401`; no `fetch_queue` row is enqueued for any; verification is networkless (no outbound call to Clerk or any IdP observed)

- **System Scenario: STS-013-A4** _(config-state fault, not a per-request credential partition)_
    - **Given** `CLERK_JWT_KEY` is missing or malformed in SYS-013 **configuration** (the verifier cannot initialize) — a process-wide deployment/config-state fault, distinct from the per-request credential classes
    - **When** any `/v1/foods/*` request arrives — even one bearing an otherwise-valid token
    - **Then** SYS-013 fails closed with `401`; no request proceeds unauthenticated; no enqueue and no source call occur

- **System Scenario: STS-013-A5**
    - **Given** a `GET /v1/foods/{id}` request carries no valid token but supplies a forged identity header (`x-authorizer-context`/`x-user-id` claiming an authenticated `sub`)
    - **When** SYS-013 processes the request
    - **Then** the response is `401`; the forged headers are ignored (identity is derived solely from the verified token); no enqueue and no source call occur

#### Test Case: STP-013-B (Verification Load-Shed Under Invalid-Token Flood — p95 ≤ 10ms)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-013 verifier concurrency bound + per-source `401`-rate cap)
**Description**: Verifies that SYS-013 sheds load rather than saturating when flooded with
well-formed-but-unverifiable tokens (each forcing a full CPU-bound signature check before the fail-closed
`401`), so SC-011's ≤10ms p95 holds under attack and SC-009 availability is not breached (FR-052).

- **System Scenario: STS-013-B1**
    - **Given** the verifier concurrency bound under test is `C = 50` in-flight signature checks and the per-source `401`-rate cap is `200` `401`/min/source; **and** a sustained flood of well-formed-but-invalid tokens (valid structure, signature fails against `CLERK_JWT_KEY`) is generated against `GET /v1/foods/{id}` at **2,000 req/s** (= `40×C`) from a bounded set of **8** source identities for a **120 s** measurement window; **and** a baseline of legitimate valid-token requests is interleaved at **100 req/s** (valid:invalid ≈ 1:20)
    - **When** SYS-013 processes the mixed load over the 120 s window (first 10 s discarded as warm-up; metrics over the remaining 110 s, ≥ 11,000 valid-request latency samples)
    - **Then** the per-source `401`-rate cap / concurrency bound engages — **≥ 95%** of the invalid flood is load-shed (fast-rejected without a full signature check), in-flight checks stay **≤ `C` (50)** and the verifier queue depth stays bounded (no monotonic growth); **and** valid-token requests are served with auth-attributable overhead **≤ 10ms at p95** (SC-011, measured verify-start → verify-complete, isolated from SYS-001/SYS-007); **and** no invalid request is enqueued to SYS-003 (nor recorded in SYS-004) or reaches any source path. _Pass = (valid-token p95 ≤ 10ms) AND (in-flight ≤ C) AND (≥ 95% shed). Reproducible: same parameters yield the same verdict._

#### Test Case: STP-013-C (Per-`sub` Fairness by Queue Demotion — No `429`, Dynamic Re-Promotion)

**Technique**: Boundary Value Analysis
**Target View**: Dependency View (SYS-013/SYS-005 → SYS-003/SYS-004: drain-time priority from live pending count)
**Description**: Verifies that fairness is enforced by **queue demotion, not rejection**: a `sub` with more
than 50 items currently pending in the `fetch_queue` has its items ranked to the **back**, while other `sub`s
continue to be served. No authenticated cache-miss add is rejected — there is **no per-user quota and no
`429`**. Demotion is **dynamic**: priority is computed at drain time from the requester's live pending count,
so items auto-return to normal priority once the `sub` falls below 50 (SC-012, FR-043, US-0 #9). The boundary
under test is the **50-pending** threshold.

- **System Scenario: STS-013-C1**
    - **Given** the `fetch_queue` and `fetch_requesters` demand state are **reset to empty** at the start, then authenticated `sub` `A` is **seeded to a known pending count of 51** by enqueuing 51 distinct add-by-name lookups for `A` and **holding the consumer drain paused** so the count stays at 51
    - **When** `sub` `A` triggers another add-by-name (`POST /v1/foods` for a new name)
    - **Then** the response is `202 Accepted` (not rejected; no `429`); the fetch **is** enqueued, but `A`'s items are ranked to the back of the priority order so they drain only on spare capacity

- **System Scenario: STS-013-C2**
    - **Given** the demand state is **reset to empty**, the SYS-006 USDA window is **seeded below the pause threshold** (deterministic drain capacity against the 1,000/hr budget), and authenticated `sub` `A` scripts add-by-name lookups continuously (driving its pending count above 50) while `sub` `B` issues occasional adds
    - **When** the consumer drains and `A`'s pending count later falls below 50
    - **Then** while `A` is above 50, `A`'s demoted items yield to `B`'s normally-prioritized items (one account cannot starve the shared budget); none of `A`'s requests receive `429`; once `A`'s live pending count drops below 50, the drain-time scorer re-promotes `A`'s remaining items (no frozen demotion flag)

#### Test Case: STP-013-D (Scope `403` vs `401` Authorization Class; M2M Service-Token Acceptance)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-013 → SYS-001: authorization-outcome class, principal class)
**Description**: Verifies two equivalence classes: an authenticated-but-unauthorized session token
(insufficient scope) → `403`, distinct from the unauthenticated `401`; and a valid Clerk M2M (service)
principal → accepted (FR-039/FR-047, US-0 #10/#11). _(Ordering and input-bound concerns split out to
STP-013-E and STP-013-F.)_

- **System Scenario: STS-013-D1**
    - **Given** an authenticated user whose verified token `public_metadata` lacks the required operational scope
    - **When** the user calls an operational/administrative endpoint (e.g. a manual re-fetch trigger)
    - **Then** the response is `403 Forbidden` (authenticated but unauthorized), distinct from `401`; no re-fetch is enqueued

- **System Scenario: STS-013-D2**
    - **Given** a server-initiated caller (e.g. feature 006 meal-planning) presents a Clerk **M2M** token whose `azp` ∈ `CLERK_AUTHORIZED_PARTIES` and no end-user session token
    - **When** it calls `GET /v1/foods/{id}`
    - **Then** SYS-013 verifies the M2M token networklessly and accepts the request (the `AuthenticatedCaller` carries a service identity); the call is **not** forced to `401`

#### Test Case: STP-013-E (Status-Precedence Ordering — `401` → `403` → `400` → business logic)

**Technique**: State Transition
**Target View**: Interface View (SYS-013 → SYS-001: ordered resolution of competing defects per FR-051)
**Description**: Verifies the normative precedence chain `401` → `403` → `400`/`404` → business logic (FR-051,
US-0) as an ordered decision sequence. Each scenario presents **two simultaneous** defects at adjacent
precedence levels and asserts the higher-precedence status wins.

- **System Scenario: STS-013-E1** (`401` precedes `403`)
    - **Given** a request bearing **no** valid token that **also** targets an endpoint for which the (absent) principal would lack scope
    - **When** SYS-013 evaluates the request
    - **Then** the response is `401` (authentication before authorization); the scope check is never reached; no `403` is emitted

- **System Scenario: STS-013-E2** (`403` precedes `400`)
    - **Given** a request bearing a **valid** token with **insufficient scope** that **also** carries a malformed/oversized payload (a `400`-class defect)
    - **When** SYS-013/SYS-001 evaluate the request
    - **Then** the response is `403` — authorization resolves before input validation; the `400`/`404` defect is never evaluated; no enqueue and no business logic run

- **System Scenario: STS-013-E3** (`400` precedes business logic / `404`)
    - **Given** an authenticated, authorized request whose payload is malformed (e.g. a malformed `id` path param) and that would also miss in the local store
    - **When** SYS-013/SYS-001 evaluate the request
    - **Then** the response is `400` — input validation resolves before business logic, so no `404`/lookup is performed and nothing is enqueued; confirming the full chain `401` → `403` → `400` → business

#### Test Case: STP-013-F (Batch Hard-Limit `400` — name/id-Array Size Boundary)

**Technique**: Boundary Value Analysis
**Target View**: Interface View (IC-012: SYS-013 → SYS-001: batch input bound, FR-045)
**Description**: Verifies the `POST /v1/foods/batch` hard maximum of **100** names/`id`s as a boundary —
just-under (99, accepted), at-limit (100, accepted), just-over (101, `400`) (REQ-040a, US-0 #12). All
requests are authenticated and authorized so the boundary is isolated from the precedence chain. (The USDA
adapter's internal 20-key cap is a separate adapter detail, STP-009-A.)

- **System Scenario: STS-013-F1** (just-under — 99)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose array contains exactly **99** names/`id`s
    - **When** SYS-013/SYS-001 process the request
    - **Then** the request is accepted (not rejected on size); the batch proceeds to normal per-item partial handling

- **System Scenario: STS-013-F2** (at-limit — 100)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose array contains exactly **100** entries (the inclusive hard maximum)
    - **When** SYS-013/SYS-001 process the request
    - **Then** the request is accepted (the limit is inclusive); the batch proceeds to normal handling

- **System Scenario: STS-013-F3** (just-over — 101)
    - **Given** an authenticated, authorized `POST /v1/foods/batch` whose array contains **101** entries
    - **When** SYS-013/SYS-001 process the request (authn/authz having passed)
    - **Then** the response is `400 Bad Request`; **nothing is enqueued** for any entry; nothing counts toward the requester's pending-count demotion threshold

---

### Component Verification: SYS-014 (SourceAdapterRegistry) — NEW

**Parent Requirements**: REQ-046, REQ-050, REQ-054, REQ-CN-007, REQ-IF-004, REQ-IF-012

> **Adapter boundary.** SYS-014 is the pluggable registry + `FoodSourceAdapter` interface
> (`searchByName`, `fetchByKey`, internal `mapToCanonical`). **The USDA adapter is the only wired adapter and
> the only place `fdcId`/USDA terms appear**, mapping `fdcId → external_key` inbound. Adding a source is
> additive (append an adapter + a `source` enum value) and never touches the canonical schema.

#### Test Case: STP-014-A (Registry Fan-Out — Worker Iterates Every Wired Adapter by Name)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-006: SYS-005 → SYS-014)
**Description**: Verifies that the worker iterates the SourceAdapterRegistry to fan out across **every wired
adapter** by name, each returning source-agnostic canonical candidates through the `FoodSourceAdapter`
interface (REQ-050/REQ-054/REQ-IF-012).

- **System Scenario: STS-014-A1**
    - **Given** the registry holds the wired adapters (USDA today; the harness wires a second stub adapter to exercise multi-source); a `food` named "broccoli" is being resolved
    - **When** the worker fans out
    - **Then** the worker calls `searchByName("broccoli")` then `fetchByKey(externalKey)` on **each** wired adapter; each adapter returns a `CanonicalCandidate` exposing only source-agnostic shapes (`source`, `externalKey`, normalized fields) — no source-native structure (no `fdcId`) leaks past the interface

#### Test Case: STP-014-B (fdcId Confinement — No Source-Native Key Escapes the Adapter)

**Technique**: Interface Contract Testing
**Target View**: Interface View (SYS-014 → SYS-018/SYS-007: source-agnostic boundary, SC-013)
**Description**: Verifies that `fdcId` and USDA-specific terms appear **only** inside the USDA adapter; the
adapter maps `fdcId → external_key` inbound, and no canonical row, DAO, public DTO, or API field outside the
adapter exposes a source-native identifier (REQ-046/REQ-CN-007, SC-013).

- **System Scenario: STS-014-B1**
    - **Given** the USDA adapter receives a USDA response carrying `fdcId = 12345`
    - **When** it maps the response via `mapToCanonical`
    - **Then** the emitted `CanonicalCandidate` carries `source = 'USDA'`, `external_key = '12345'` — **no** `fdcId` field — and the persisted `food`/`food_sources`/DTO/API response contain `external_key` in the crosswalk and the internal `id` as identity, never `fdcId`; a scan of the canonical store, DTOs, and API responses finds no `fdcId` outside the adapter boundary

#### Test Case: STP-014-C (Additive Source — Adding an Adapter Never Touches the Canonical Schema)

**Technique**: Equivalence Partitioning
**Target View**: Dependency View (SYS-014 extensibility)
**Description**: Verifies that wiring an additional source is additive — appending an adapter + a `source`
enum value — and that the fan-out/merge/candidate/provenance machinery handles it without canonical-schema
changes (REQ-054/REQ-050, US-2/US-2a multi-source readiness).

- **System Scenario: STS-014-C1**
    - **Given** a second stub adapter is appended to the registry with a new `source` enum value
    - **When** the worker resolves a food both sources have
    - **Then** the worker fans out to both adapters and the merge engine (SYS-015) assembles a cross-source golden record with per-source provenance; no canonical table/column is altered to admit the new source (the `food_sources (source, external_key)` crosswalk and `source_id` provenance columns absorb it)

#### Test Case: STP-014-D (Fault Injection — One Adapter Errors, Others Still Contribute)

**Technique**: Fault Injection
**Target View**: Dependency View (SYS-005 → SYS-014: per-adapter isolation)
**Description**: Verifies that an erroring adapter contributes nothing while remaining sources still resolve
the food, or the food lands `FAILED`/`NOT_FOUND` per the fan-out outcome (REQ-050).

- **System Scenario: STS-014-D1**
    - **Given** two adapters are wired; one throws/errs during fan-out while the other returns a valid candidate
    - **When** the worker fans out
    - **Then** the erroring adapter contributes nothing; the food resolves from the remaining adapter's candidate (`RESOLVED`/`UNRESOLVED`); if **all** adapters error after the retry budget the food lands `FAILED` (STP-005-F), and if all return no item it lands `NOT_FOUND` (STP-005-D)

---

### Component Verification: SYS-015 (GoldenRecordMergeEngine) — NEW

**Parent Requirements**: REQ-050, REQ-051

> **Field-level merge rules (REQ-051).** Presence beats absence; identity/short fields (`name`, `brand`)
> take the **higher-priority source** (NOT longest); free-text (`description`, `ingredients`) **longer-wins**;
> nutrients normalized to per-100g before any blend, conflicts to the higher-priority source with
> `food_nutrients.source_id` recording the winner. Deterministic and auditable. Drives `RESOLVED` vs
> `UNRESOLVED`.

#### Test Case: STP-015-A (Merge Rule — Presence Beats Absence + Higher-Priority Identity Fields)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (IC-007: SYS-005 → SYS-015)
**Description**: Verifies the presence-beats-absence rule and the higher-priority-source rule for
identity/short fields (`name`, `brand`) — USDA is the default highest priority (REQ-051).

- **System Scenario: STS-015-A1**
    - **Given** candidates from two sources: source-1 (higher priority, e.g. USDA) supplies `name` and `brand`; source-2 supplies `brand` and a `barcode` that source-1 lacks
    - **When** the merge engine assembles the golden record
    - **Then** `name`/`brand` take source-1's values (higher priority, not longest); `barcode` is taken from source-2 (presence beats absence — source-1 lacked it); each field's winning `source_id` is recorded

#### Test Case: STP-015-B (Merge Rule — Free-Text Longer-Wins; Nutrient per-100g + Conflict to Higher Priority)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (free-text length; nutrient per-100g basis + priority conflict)
**Description**: Verifies that free-text fields (`description`, `ingredients`) take the **longer** value, and
that nutrient values are normalized to per-100g before any blend with conflicts resolved to the
higher-priority source, `food_nutrients.source_id` recording the winner (REQ-051, US-2a #4).

- **System Scenario: STS-015-B1** (free-text longer-wins)
    - **Given** two candidates supply `description` of different lengths
    - **When** the merge engine assembles the record
    - **Then** the **longer** `description` wins (free-text rule, not source priority); its `source_id` is recorded in `food_field_provenance`

- **System Scenario: STS-015-B2** (nutrient per-100g + priority conflict)
    - **Given** two candidates supply the same nutrient at different bases (per-serving vs per-100g) and slightly different values
    - **When** the merge engine normalizes and blends
    - **Then** both are normalized to per-100g **before** comparison; on the resulting conflict the **higher-priority source** wins; the winning value's `food_nutrients.source_id` records the source; no lossy rounding beyond basis conversion (SC-008)

#### Test Case: STP-015-C (Merge Outcome — RESOLVED vs UNRESOLVED)

**Technique**: State Transition
**Target View**: Interface View (SYS-015 → SYS-005 outcome → lifecycle status)
**Description**: Verifies that the merge yields `RESOLVED` when candidates collapse to one confident record
and `UNRESOLVED` when residual ambiguity remains (REQ-050, US-2 #2/#6).

- **System Scenario: STS-015-C1** (RESOLVED)
    - **Given** candidates that confidently collapse to a single record
    - **When** the merge runs
    - **Then** `outcome = 'RESOLVED'`; one golden record is produced; the food is set to `RESOLVED`

- **System Scenario: STS-015-C2** (UNRESOLVED)
    - **Given** ≥2 non-collapsible candidates (the matcher need not be perfect — the human is the arbiter)
    - **When** the merge runs
    - **Then** `outcome = 'UNRESOLVED'`; the candidate set is retained for SYS-016; the food is set to `UNRESOLVED`

---

### Component Verification: SYS-016 (CandidateResolutionService) — NEW

**Parent Requirements**: REQ-048, REQ-049, REQ-IF-010, REQ-IF-011

#### Test Case: STP-016-A (GET /candidates — Cross-Source Candidate List for an UNRESOLVED Food)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-004/IC-IF-010: SYS-001 → SYS-016)
**Description**: Verifies that `GET /v1/foods/{id}/candidates` returns the candidate list for an
`UNRESOLVED` food, each candidate carrying its `source` and that source's item key (REQ-048/REQ-IF-010,
US-2a #1).

- **System Scenario: STS-016-A1**
    - **Given** a food with `status = 'UNRESOLVED'` whose fan-out produced multiple candidates
    - **When** the client calls `GET /v1/foods/{id}/candidates`
    - **Then** response is `200` with `{ id, candidates: [ { candidateId, source, externalKey, name, summary }, … ] }`; each candidate carries its `source` and item key; no source call is made (candidates were assembled at fan-out time)

#### Test Case: STP-016-B (PATCH resolve — Valid Pick Drives Merge → RESOLVED)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-004/IC-IF-011: SYS-016 → SYS-015 → SYS-018)
**Description**: Verifies that `PATCH /v1/foods/{id}` with a candidate from the food's own set drives the
merge into the golden record, moves the food to `RESOLVED`, and stores the user's pick as ordinary
provenance (REQ-049/REQ-IF-011, US-2a #2/#4).

- **System Scenario: STS-016-B1**
    - **Given** an `UNRESOLVED` food and a `candidateId` from **its own** candidate set
    - **When** the client calls `PATCH /v1/foods/{id}` with `{ "candidateIds": ["c1"] }`
    - **Then** SYS-016 validates `c1` belongs to this food's candidate set, drives the merge (SYS-015), persists the golden record via the DAO layer, stores the user's pick as ordinary provenance (SYS-017), sets `status = 'RESOLVED'`, and returns `200` with `{ id, status: 'RESOLVED' }`; a subsequent `GET /v1/foods/{id}` returns the golden record

#### Test Case: STP-016-C (PATCH resolve — Out-of-Set Candidate Rejected, Status Unchanged)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-016 candidate-set validation)
**Description**: Verifies that a `PATCH` referencing a candidate **not** in the food's own candidate set is
rejected (`400`/`409`) with the food's `status` unchanged, preventing cross-food contamination (REQ-049,
US-2a #3).

- **System Scenario: STS-016-C1**
    - **Given** an `UNRESOLVED` food and a `candidateId` belonging to a **different** food (out of this food's set)
    - **When** the client calls `PATCH /v1/foods/{id}` with that out-of-set candidate
    - **Then** the request is rejected (`400`/`409`) with an error body; the food's `status` remains `UNRESOLVED` (no merge, no provenance written)

---

### Component Verification: SYS-017 (ProvenanceStore) — NEW

**Parent Requirements**: REQ-028, REQ-029, REQ-052

> **Value-grain provenance.** A `source_id` column on `food_nutrients`/`food_portions`/
> `food_category_assignment` and a thin `food_field_provenance(food_id, field, source_id)` side-table for
> scalar `food.*` fields. No verbatim payload, no EAV. The user's manual pick is ordinary provenance.

#### Test Case: STP-017-A (Per-Field Provenance Recorded at the Value Grain)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC: SYS-015 → SYS-017 recordProvenance)
**Description**: Verifies that the merge engine records the winning source per field/value — scalar fields to
`food_field_provenance`, multi-valued rows to their `source_id` column (REQ-052/REQ-028, US-2a #4).

- **System Scenario: STS-017-A1**
    - **Given** a golden record whose `name` came from source-1 (by priority) and whose a `fat` nutrient came from source-2
    - **When** the merge persists provenance
    - **Then** `food_field_provenance` holds `(food_id, 'name', source_1_id)`; the `food_nutrients` row for `fat` carries `source_id = source_2_id`; no verbatim source payload is retained

#### Test Case: STP-017-B (Single-Query Provenance — "Which fields came from source X")

**Technique**: Interface Contract Testing
**Target View**: Data Design View (REQ-029 single-query provenance)
**Description**: Verifies that "which fields came from source X for this food" is answerable by a single query
across the value tables and `food_field_provenance` (REQ-029/REQ-052).

- **System Scenario: STS-017-B1**
    - **Given** a `RESOLVED` food with fields/values attributed across multiple sources
    - **When** an operator runs a single query joining the value tables + `food_field_provenance` filtered by `source_id`
    - **Then** the set of fields/values originating from that source is returned in one query (no EAV traversal, no payload parsing)

#### Test Case: STP-017-C (User Manual Resolution Stored as Ordinary Provenance)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (SYS-016 → SYS-017)
**Description**: Verifies that a user's manual pick (US-2a) is stored as ordinary provenance, indistinguishable
in mechanism from a source-attributed value (REQ-052).

- **System Scenario: STS-017-C1**
    - **Given** a user resolves an `UNRESOLVED` food by picking a candidate (STP-016-B)
    - **When** provenance is recorded
    - **Then** the chosen values' provenance is written via the same `source_id`/`food_field_provenance` mechanism (the pick's originating source recorded); the manual resolution is preserved by change-driven refresh as an ordinary stored value (cross-ref STP-019-C)

---

### Component Verification: SYS-018 (FoodDaoRepositoryLayer) — NEW

**Parent Requirements**: REQ-005, REQ-013, REQ-028, REQ-047, REQ-054

> **Persistence seam.** All persistence flows through per-aggregate DAOs behind `FoodsRepository`; services
> and the worker never issue source-specific SQL. Owns the add-by-name dedup mechanics: the normalized-name
> unique key + short **advisory lock** + the idempotent `fetch_queue` `INSERT … ON CONFLICT (food_id)`.

#### Test Case: STP-018-A (Add-By-Name Dedup — Concurrent Adds Collapse to One id Under Advisory Lock)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-001: SYS-001 → SYS-018 createByName)
**Description**: Verifies that concurrent adds of the same normalized name collapse to one canonical row +
`id` via the normalized-name unique key under a short advisory lock — a thundering-herd-safe idempotency
guarantee (REQ-005/REQ-013/REQ-047, US-2 #4).

- **System Scenario: STS-018-A1**
    - **Given** no food exists for the normalized name "broccoli"
    - **When** N concurrent `POST /v1/foods` requests for "broccoli" arrive simultaneously
    - **Then** `createByName` (under the advisory lock + `normalized_name` unique key) creates exactly **one** `food` row + `id`; all N requests return `202` with the **same** `id`; exactly one `fetch_queue` row is enqueued (`ON CONFLICT (food_id)` collapses duplicates); each distinct `sub` is recorded once in `fetch_requesters`

#### Test Case: STP-018-B (All Persistence Through the DAO Layer — No Source-Specific SQL Leaks)

**Technique**: Interface Contract Testing
**Target View**: Dependency View (SYS-001/SYS-005 → SYS-018 → SYS-007 sole writer/reader)
**Description**: Verifies that services and the worker read/write the canonical store **only** through the DAO
layer's source-agnostic contracts, with no source-specific SQL crossing the boundary (REQ-054/REQ-028).

- **System Scenario: STS-018-B1**
    - **Given** the worker has an assembled golden record + crosswalk + provenance to persist
    - **When** it persists via `FoodsRepository` (`FoodDao`, `FoodSourcesDao`, `FoodNutrientsDao`, `FoodPortionsDao`, `FoodFieldProvenanceDao`, …)
    - **Then** the write goes entirely through the DAO contracts (`upsert golden record`, `findById`, `searchByName`, `findByExternalKey`); no source-native column or `fdcId` appears in any DAO signature or the persisted rows; the DAO layer is the sole writer/reader of SYS-007

#### Test Case: STP-018-C (Idempotent Enqueue — fetch_queue ON CONFLICT (food_id))

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC-002: SYS-018 → SYS-003 queue-grain dedup)
**Description**: Verifies the DAO-owned idempotent enqueue: duplicate enqueues for the same `id` collapse via
`INSERT INTO fetch_queue (food_id) … ON CONFLICT (food_id) DO UPDATE` (REQ-013).

- **System Scenario: STS-018-C1**
    - **Given** a `fetch_queue` row already exists for `food_id = X`
    - **When** the DAO enqueues `X` again
    - **Then** no duplicate row is created; the existing row's capped `request_count`/`last_requested` are updated; the queue-grain dedup holds independently of the name-grain dedup (STP-018-A)

---

### Component Verification: SYS-019 (ChangeDrivenRefresh) — NEW

**Parent Requirements**: REQ-031, REQ-032, REQ-053

> **Change-driven, not stale-by-age.** Once a food is populated our stored values stand; a scheduled
> `IngestionScheduled` rule triggers checks that re-pull a field **only** when its originating external item
> changed upstream (detected via `food_sources.item_version`, not stored payload). User-resolved fields are
> preserved automatically. No max-staleness cutoff withholds an already-held record.

#### Test Case: STP-019-A (Re-Pull Only Changed-Upstream Fields)

**Technique**: Interface Contract Testing
**Target View**: Interface View (IC: SYS-002 → SYS-019 → SYS-014; SYS-019 → SYS-003)
**Description**: Verifies that the scheduled refresh re-pulls and updates **only** the fields whose backing
source item changed upstream, leaving all other fields intact (REQ-031/REQ-053, US-7 #1).

- **System Scenario: STS-019-A1**
    - **Given** a `RESOLVED` food whose `protein` came from source item X and `fat` from source item Y; the scheduled refresh runs; re-fetching via the adapter shows X unchanged (`item_version` equal) but Y changed (`item_version` differs)
    - **When** SYS-019 processes the food
    - **Then** the affected food is re-enqueued as **low-priority** `fetch_queue` work (`ON CONFLICT`, SYS-003); only the `fat` field is re-pulled and updated (its `source_id` provenance refreshed to the re-fetched Y); `protein` and all other fields are left intact; no blind re-blend occurs

#### Test Case: STP-019-B (Unchanged Upstream — No Overwrite)

**Technique**: Equivalence Partitioning
**Target View**: Dependency View (SYS-019 → SYS-014 item_version comparison)
**Description**: Verifies that when all backing source items are unchanged upstream, no field is updated and
no value is overwritten (REQ-031, US-7 #2).

- **System Scenario: STS-019-B1**
    - **Given** a `RESOLVED` food whose backing source items are all unchanged upstream (matching `item_version`)
    - **When** the scheduled refresh runs
    - **Then** no field is updated; no `fetch_queue` re-enqueue is needed for changed data; the golden record is untouched; reads never blocked on this check

#### Test Case: STP-019-C (User-Resolved Field Preserved Across Refresh)

**Technique**: Equivalence Partitioning
**Target View**: Dependency View (SYS-019 preserves SYS-016/SYS-017 manual resolution)
**Description**: Verifies that a field a user manually resolved (US-2a) is preserved across refresh — it is
just a stored value; only its originating external item changing can move it (REQ-053, US-7 #3).

- **System Scenario: STS-019-C1**
    - **Given** a `RESOLVED` food with a field the user manually resolved (provenance recorded per STP-017-C), and that field's originating external item is unchanged upstream
    - **When** the scheduled refresh runs
    - **Then** the user's value is preserved (not re-blended, not overwritten); only an upstream change to its originating item would move it

#### Test Case: STP-019-D (Re-Pulled Value Passes Adapter Validation Before Storage)

**Technique**: Interface Contract Testing
**Target View**: Dependency View (SYS-019 → SYS-014 → SYS-020)
**Description**: Verifies that a re-pulled value passes adapter input validation (SYS-020) before it is stored
and updates its `source_id` provenance (REQ-032/REQ-053, US-7 #4).

- **System Scenario: STS-019-D1**
    - **Given** a backing source item changed upstream and the refresh re-pulls the affected field
    - **When** the re-pulled value is processed
    - **Then** it passes adapter validation/sanitization (SYS-020) before storage; a value that fails validation is rejected, not stored (cross-ref STP-020-A); on success the value is stored with refreshed `source_id` provenance (SYS-017)

---

### Component Verification: SYS-020 (AdapterInputValidation) — NEW

**Parent Requirements**: REQ-006, REQ-055, REQ-NF-018

> **Source-boundary validation + transport security.** Each adapter validates/sanitizes the values it maps
> (type/range/length/text) **before** they enter the canonical store; outbound fetches use **HTTPS with
> certificate validation**; a response that fails validation is **rejected, not stored**. Complements
> SYS-001's request-edge `id`/name validation.

#### Test Case: STP-020-A (Reject-Not-Store — Invalid Source Value Never Enters the Canonical Store)

**Technique**: Equivalence Partitioning
**Target View**: Interface View (IC: SYS-014 → SYS-020 validateAndSanitize)
**Description**: Verifies that a mapped candidate failing validation (type/range/length/text) is **rejected,
not stored**, so no invalid input reaches the canonical schema or the `fetch_queue` (REQ-055/REQ-006).

- **System Scenario: STS-020-A1**
    - **Given** an adapter maps a source response containing an out-of-range/oversized/malformed value (e.g. a negative nutrient amount or an over-length name)
    - **When** `validateAndSanitize` runs before persistence
    - **Then** the offending candidate is **rejected** (not stored); no invalid value enters SYS-007; the food resolves from valid candidates or, if none remain, follows the no-source/error outcome (STP-005-D/F); the rejection is logged (SYS-012)

#### Test Case: STP-020-B (Sanitization — Text Values Sanitized Before Storage)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View (length caps / text sanitization)
**Description**: Verifies that text values are sanitized and length-capped at the boundary before they enter
the canonical store (REQ-055, defense against malformed/untrusted source data).

- **System Scenario: STS-020-B1**
    - **Given** an adapter maps a source text field at/over the length cap, or containing control/markup characters
    - **When** `validateAndSanitize` runs
    - **Then** the value is sanitized/truncated to the cap before storage (or rejected if it cannot be made safe); the stored canonical value is clean; nutrient fidelity beyond basis normalization is preserved (REQ-NF-018)

#### Test Case: STP-020-C (HTTPS + Certificate Validation on Outbound Source Fetches)

**Technique**: Interface Contract Testing
**Target View**: Dependency View (SYS-014/SYS-020 → SYS-009 transport security)
**Description**: Verifies that outbound source fetches use HTTPS with certificate validation; a connection
failing certificate validation does not deliver a stored value (REQ-055).

- **System Scenario: STS-020-C1**
    - **Given** an adapter is about to fetch from its source
    - **When** the outbound request is made
    - **Then** the request uses HTTPS with certificate validation enabled; a fetch against an invalid/untrusted certificate fails closed (treated as a source error, STP-005-F) and no value is stored from it

---

## Traceability Summary

| SYS ID  | Component Name                              | Test Cases                  | Scenarios                                                                      |
| ------- | ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| SYS-001 | FoodApiController                           | STP-001-A, B, C, D, E, F    | STS-001-A1, A2, B1, B2, B3, B4, B5, B6, C1, C2, C3, C4, D1, D2, D3, E1, F1, F2 |
| SYS-002 | EventBridgeBus (scheduled + completion)     | STP-002-A, B, C             | STS-002-A1, B1, B2, C1                                                         |
| SYS-003 | FetchQueue (single demand-weighted queue)   | STP-003-A, B, C             | STS-003-A1, B1, C1, C2                                                         |
| SYS-004 | FetchRequesters (distinct-requester demand) | STP-004-A, B                | STS-004-A1, B1                                                                 |
| SYS-005 | FoodFanOutMergeWorker                       | STP-005-A, B, C, D, E, F, G | STS-005-A1, A2, B1, C1, D1, D2, E1, F1, G1                                     |
| SYS-006 | PerSourceRollingWindowLimiter               | STP-006-A, B, C, D          | STS-006-A1, A2, B1, B2, B3, C1, D1, D2                                         |
| SYS-007 | FoodCanonicalPostgresStore                  | STP-007-A, B, C, D          | STS-007-A1, A2, B1, B2, B3, B4, B5, C1, D1                                     |
| SYS-008 | FoodRedisCache (Postgres default)           | STP-008-A, B, C, D          | STS-008-A1, B1, C1, D1                                                         |
| SYS-009 | UsdaSourceApi (fdcId boundary)              | STP-009-A, B                | STS-009-A1, A2, B1                                                             |
| SYS-010 | WebSocketNotificationLambda (deferred)      | STP-010-A, B                | STS-010-A1, B1                                                                 |
| SYS-011 | SecretManagement (per-source keys)          | STP-011-A, B                | STS-011-A1, B1                                                                 |
| SYS-012 | MonitoringAndLogging                        | STP-012-A, B, C             | STS-012-A1, A2, B1, C1, C2                                                     |
| SYS-013 | AuthnAuthzLayer                             | STP-013-A, B, C, D, E, F    | STS-013-A1, A2, A3, A4, A5, B1, C1, C2, D1, D2, E1, E2, E3, F1, F2, F3         |
| SYS-014 | SourceAdapterRegistry (NEW)                 | STP-014-A, B, C, D          | STS-014-A1, B1, C1, D1                                                         |
| SYS-015 | GoldenRecordMergeEngine (NEW)               | STP-015-A, B, C             | STS-015-A1, B1, B2, C1, C2                                                     |
| SYS-016 | CandidateResolutionService (NEW)            | STP-016-A, B, C             | STS-016-A1, B1, C1                                                             |
| SYS-017 | ProvenanceStore (NEW)                       | STP-017-A, B, C             | STS-017-A1, B1, C1                                                             |
| SYS-018 | FoodDaoRepositoryLayer (NEW)                | STP-018-A, B, C             | STS-018-A1, B1, C1                                                             |
| SYS-019 | ChangeDrivenRefresh (NEW)                   | STP-019-A, B, C, D          | STS-019-A1, B1, C1, D1                                                         |
| SYS-020 | AdapterInputValidation (NEW)                | STP-020-A, B, C             | STS-020-A1, B1, C1                                                             |

**Total Test Cases**: 71 STP
**Total Scenarios**: 111 STS
**Components Covered**: 20 / 20 (100%)

### Requirements Coverage (REQ → covering STP)

| Requirement family                                           | Covering STP ids                                        |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Local-only serve / read lifecycle (REQ-001..004)             | STP-001-A/B, STP-007-A/B/D, STP-008-A                   |
| Add-by-name / dedup / validation (REQ-005, 006, 047)         | STP-001-C/E, STP-018-A/C, STP-020-A                     |
| Status polling (REQ-007, 033)                                | STP-001-B                                               |
| Search incl. barcode/external_key (REQ-008, 009, 010)        | STP-001-D                                               |
| Demand path / queue / requesters (REQ-011..015, 039)         | STP-002-A, STP-003-A/B, STP-004-A, STP-005-A, STP-013-C |
| Retry / tombstone / lease / TTL (REQ-016..018, 025, 027)     | STP-003-C, STP-005-D/F                                  |
| Per-source rate limiter (REQ-019..021, 023, 026)             | STP-005-E, STP-006-A/B/C/D, STP-009-A                   |
| Source ingestion / crosswalk (REQ-024)                       | STP-005-B, STP-007-A, STP-014-B                         |
| Canonical schema + indexes / fidelity (REQ-028, 029, NF-018) | STP-007-A/C, STP-017-A/B, STP-018-B                     |
| Redis (deferred) (REQ-030)                                   | STP-008-A/B/C/D                                         |
| Change-driven refresh (REQ-031, 032, 053)                    | STP-019-A/B/C/D                                         |
| WebSocket (REQ-034, 043)                                     | STP-010-A/B, STP-013-A                                  |
| Auth slice (REQ-035, 037a..044d, IF-007, IF-008)             | STP-013-A/B/C/D/E/F, STP-005-G (FR-048)                 |
| Internal-id identity (REQ-045, CN-007)                       | STP-014-B, STP-018-A/B                                  |
| fdcId confined to adapter (REQ-046, IF-004)                  | STP-009-A, STP-014-B                                    |
| Candidates / resolve (REQ-048, 049, IF-010, IF-011)          | STP-016-A/B/C, STP-005-C                                |
| Fan-out + golden record (REQ-050)                            | STP-005-B/C/D, STP-014-A/C/D, STP-015-C                 |
| Merge rules (REQ-051)                                        | STP-015-A/B/C                                           |
| Per-field provenance (REQ-052)                               | STP-017-A/B/C, STP-015-A/B                              |
| Source-adapter interface (REQ-054, IF-012)                   | STP-014-A/C, STP-018-B                                  |
| Input validation + HTTPS (REQ-055)                           | STP-020-A/B/C                                           |
| M2M / async-producer provenance (REQ-041, 042)               | STP-013-D, STP-005-G                                    |
| Batch bounds / partial response (REQ-040a, 040b)             | STP-001-F, STP-013-F                                    |
| Interface contracts (REQ-IF-001..006, 009)                   | STP-001-A/B/D/E, STP-009-A/B, STP-011-A                 |
| Monitoring (REQ-NF-012, NF-016)                              | STP-012-A/B/C                                           |

**STP id inventory (final):** STP-001..STP-013 preserved (re-keyed `fdcId → id`, USDA → per-source);
STP-014..STP-020 new. `fdcId` is referenced only in the SYS-009/SYS-014 adapter-boundary tests
(STP-009-A, STP-014-B). 20 components covered.
