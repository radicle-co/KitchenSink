# Module Design: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/v-model/architecture-design.md`
**Standard**: DO-178C / ISO 26262 Low-Level Module Design

> **Re-baseline note (2026-06-22).** This artifact (V-Model Layer 4, traces to `architecture-design.md`
> ARCH-_ ids) was regenerated to match the **source-agnostic food data redesign**. A food is keyed by an
> internal `id`; **USDA is one pluggable source adapter**; foods are assembled into a **cross-source
> golden record** with per-field provenance; users add foods **by name** through a `PENDING →
(UNRESOLVED) → RESOLVED` lifecycle. The lifecycle status enum is now
> `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED` (the old `fetch_status` enum
> `pending|fetched|not_found|stale` is removed). **`fdcId` / the denormalized `foods` table /
> JSONB-nutrient / `fetch_status` / stale-by-age design are removed from the canonical view and confined
> to the USDA adapter (MOD-008 only), which maps `fdcId → external_key` inbound.** MOD-001..MOD-014 are
> **preserved in id and intent** (re-keyed `fdcId → id`, USDA-only → per-source) and **MOD-015..MOD-021**
> are **new**, decomposing the seven new architecture modules ARCH-013..ARCH-019. The pre-existing
> SYS-parent mismatch (MODs that had mapped ARCH-006→SYS-006 and ARCH-007→SYS-007) is fixed: MOD parents
> are re-keyed to the correct SYS per `architecture-design.md`'s SYS→ARCH coverage table
> (ARCH-006→SYS-007, ARCH-007→SYS-008, ARCH-008→SYS-009, ARCH-009→SYS-010, ARCH-010→SYS-011,
> ARCH-011→SYS-012). MOD traces now cite `REQ-_`ids (Layer-1 requirements), not bare`FR-\*`.

---

## Overview

This document decomposes each of the **19 architecture modules (ARCH-001 through ARCH-019)** into
low-level module designs. Each module is assigned a unique `MOD-NNN` identifier and includes four
mandatory views. ARCH-012 (FoodAuthGuard) decomposes into three modules — MOD-012
(`ClerkAuthMiddleware`), MOD-013 (`DemotionAndFairness`), and MOD-014 (`AsyncProducerAuthz`); every
other ARCH module maps to exactly one MOD. There are **21 MODs** total.

1. **Algorithmic / Logic View** — pseudocode describing the module's core logic
2. **State Machine View** — `stateDiagram-v2` (or `N/A Stateless` for pure functions)
3. **Internal Data Structures** — table of key data structures used internally
4. **Error Handling Return Codes** — table of error conditions and responses

**Identity & confinement invariants (hold across every MOD below):**

- Every canonical row, DAO method, queue row, poll handle, DTO, and API field is keyed on the internal
  ULID `id` (REQ-045/REQ-CN-007). No source-native identifier is ever a primary or foreign key.
- `fdcId` and all USDA-specific terms appear **only** in **MOD-008 (UsdaApiClient)**, which maps
  `fdcId → external_key` inbound (REQ-046). No other MOD references `fdcId`.
- All persistence flows through the DAO/repository seam (**MOD-016**, REQ-054); no source-specific SQL
  leaks into services, the worker, or the API.

---

## ID Schema

- **Module**: `MOD-NNN` — sequential low-level module identifier
- **Parent Architecture Module**: `ARCH-NNN` — the architecture module this MOD decomposes
- **Traceability**: Each MOD traces to one ARCH and to the `REQ-*` it implements; each ARCH may have one
  or more MODs
- **Re-baseline (2026-06-22):** MOD-001..MOD-014 preserved (re-keyed); MOD-015..MOD-021 new

---

## MOD-001 — FoodApiController (Request Handler)

**Parent ARCH**: ARCH-001 (**Parent SYS**: SYS-001)
**Type**: Stateful (per-request lifecycle)
**Runtime**: NestJS controller on ECS/Fargate (Node.js 22.x), ALB-fronted
**Target source file**: `packages/services/food-service/src/foods/foods.controller.ts`

> Re-keyed from the old `fdcId`-path read API to the **add-by-name + read-by-`id`** API. The path param
> is the internal ULID `id`; there is no `fdcId` route. The controller never calls a source — it reads
> the golden record via the DAO layer (MOD-016) and enqueues via MOD-002/MOD-003. Status precedence is
> `401 → 403 → 400 → 404/202/200` (REQ-039/REQ-051; auth/scope handled by MOD-012).

### 1. Algorithmic / Logic View

```
// GET /v1/foods/{id} — read by internal id (REQ-002/REQ-003/REQ-004)
FUNCTION handleGetFood(req):
  id = parsePathParam(req, "id")
  IF NOT isValidUlid(id):
    RETURN 400 { error: "Invalid id format" }     // REQ-006 — well-formed ULID only

  // Optional in-process/Redis hot cache (MOD-007) consulted first ONLY when the deferred variant is on.
  record = FoodDaoRepository.findById(id)          // MOD-016 → MOD-006 (golden record + provenance)
  IF record IS NULL:
    RETURN 404 { error: "Not found" }              // no such row

  SWITCH record.status:
    CASE 'RESOLVED':
      RETURN 200 { food: toGoldenRecordDto(record) }       // golden record only on RESOLVED (REQ-002)
    CASE 'PENDING', 'UNRESOLVED':
      RETURN 202 { id, status: record.status, estimatedWaitSeconds: 30 }  // (REQ-003)
    CASE 'NOT_FOUND', 'FAILED':
      RETURN 404 { id, status: record.status }              // 404 but status retrievable (REQ-004)

// POST /v1/foods — add by name (REQ-005/REQ-047/REQ-IF-009)
FUNCTION handleAddByName(req):
  name = trim(req.body.name)
  IF name == "" OR isWhitespaceOnly(name):
    RETURN 400 { error: "Name must not be empty" }          // REQ-006 — nothing enqueued

  normalized = normalizeName(name)                          // lowercased + trimmed (REQ-005)

  // Advisory-lock dedup: concurrent adds of the same normalized name collapse to one row + id (MOD-016).
  { id, created } = FoodDaoRepository.createByName(normalized, name)  // status='PENDING' on create

  // Pre-enqueue fairness/backpressure (MOD-013) — NO 429: demotion only; 400 batch / 503 backpressure.
  DemotionAndFairness.admitEnqueue(req.user, [id])          // MOD-013
  EnqueueEmitter.publishFoodRequested({ id, requestedBy: req.user.sub })  // MOD-002 → fetch_queue + pg_notify
  RETURN 202 { id, status: "PENDING", estimatedWaitSeconds: 30 }

// GET /v1/foods/{id}/status — lifecycle poll (REQ-007)
FUNCTION handleGetStatus(req):
  id = parsePathParam(req, "id")
  IF NOT isValidUlid(id):
    RETURN 400 { error: "Invalid id format" }
  record = FoodDaoRepository.findById(id)
  IF record IS NULL:
    RETURN 404 { error: "Not found" }
  RETURN 200 { id, status: record.status, food: record.status == 'RESOLVED' ? toGoldenRecordDto(record) : undefined }

// GET /v1/foods/{id}/candidates — disambiguation list (REQ-048/REQ-IF-010) → delegates to MOD-018
FUNCTION handleGetCandidates(req):
  id = parsePathParam(req, "id")
  IF NOT isValidUlid(id):
    RETURN 400 { error: "Invalid id format" }
  RETURN 200 { id, candidates: CandidateResolutionService.getCandidates(id) }  // MOD-018; 404 if no row

// PATCH /v1/foods/{id} — resolve from a candidate pick (REQ-049/REQ-IF-011) → delegates to MOD-018
FUNCTION handleResolve(req):
  id = parsePathParam(req, "id")
  IF NOT isValidUlid(id):
    RETURN 400 { error: "Invalid id format" }
  candidateIds = req.body.candidateIds
  result = CandidateResolutionService.resolve(id, candidateIds)  // MOD-018 — validates candidate-set membership
  RETURN 200 { id, status: result.status }                       // 400/409 thrown by MOD-018 if out-of-set

// GET /v1/foods/search?query= — local store only (REQ-008/REQ-IF-002); incl. barcode/external_key
FUNCTION handleSearch(req):
  query = req.query.query
  IF length(query) < 2:
    RETURN 400 { error: "Query too short" }
  results = FoodDaoRepository.searchByName(query)               // MOD-016 → pg_trgm; never a source call (REQ-009)
  RETURN 200 { results }                                        // [{ id, name, score }]

// POST /v1/foods/batch — bounded batch add-by-name with per-item partial result (REQ-045/REQ-IF-009)
FUNCTION handleBatch(req):
  names = req.body.names
  IF length(names) == 0 OR length(names) > 100:
    RETURN 400 { error: "names must be 1–100 items" }           // REQ-045 — enqueue NOTHING over cap
  ids = []
  FOR EACH name IN names:
    IF trim(name) == "": CONTINUE                               // skip blanks; do not fail whole batch
    { id } = FoodDaoRepository.createByName(normalizeName(name), name)
    ids.push(id)
  DemotionAndFairness.admitEnqueue(req.user, ids)               // MOD-013 — single backpressure/demotion gate

  resolved = []
  pending  = []
  FOR EACH id IN ids:
    record = FoodDaoRepository.findById(id)
    IF record.status == 'RESOLVED':
      resolved.push({ id, food: toGoldenRecordDto(record) })    // available data returned inline
    ELSE:
      EnqueueEmitter.publishFoodRequested({ id, requestedBy: req.user.sub })  // enqueue the miss
      pending.push({ id, status: record.status })               // PENDING/UNRESOLVED — caller polls these
  RETURN 200 { resolved, pending }                              // per-item partial (REQ-045)

FUNCTION isValidUlid(id):
  RETURN matches(id, /^[0-9A-HJKMNP-TV-Z]{26}$/)                // Crockford base32, 26 chars (platform ULID)

FUNCTION normalizeName(name):
  RETURN toLowerCase(trim(collapseWhitespace(name)))            // the dedup key (REQ-005)
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> ValidatingInput : HTTP request received (after MOD-012 auth)
  ValidatingInput --> Rejected400 : invalid id / empty name / query too short / batch > 100
  ValidatingInput --> ReadingById : GET /{id} valid
  ValidatingInput --> Adding : POST /v1/foods valid name
  ValidatingInput --> Delegating : /candidates or PATCH or /search
  ReadingById --> Responding404 : no row OR status NOT_FOUND/FAILED
  ReadingById --> Responding202 : status PENDING/UNRESOLVED
  ReadingById --> Responding200 : status RESOLVED (golden record)
  Adding --> CreatingRow : createByName (advisory-lock dedup, MOD-016)
  CreatingRow --> Admitting : admitEnqueue (MOD-013)
  Admitting --> Responding503 : backpressure / circuit open (FR-046)
  Admitting --> Enqueuing : admitted (demote if >50 pending; no 429)
  Enqueuing --> Responding202 : fetch_queue INSERT + pg_notify (status PENDING)
  Delegating --> Responding200 : candidates / resolve / search result
  Delegating --> Rejected400 : PATCH out-of-set candidate (400/409 from MOD-018)
  Responding200 --> [*]
  Responding202 --> [*]
  Responding404 --> [*]
  Responding503 --> [*]
  Rejected400 --> [*]
```

### 3. Internal Data Structures

| Name               | Type                                                                                                           | Description                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `RequestContext`   | `{ id?: string, requestId: string, startTime: number }`                                                        | Per-request metadata for logging (the internal `id`, never a source key) |
| `AddByNameDto`     | `{ name: string }`                                                                                             | `POST /v1/foods` body; normalized to the dedup key before any write      |
| `GoldenRecordDto`  | `{ id, name, description, kind, nutrients: NutrientDto[], portions: PortionDto[], provenance: ProvenanceDto }` | RESOLVED response shape — id-keyed, no `fdcId`                           |
| `BatchResultDto`   | `{ resolved: { id, food }[], pending: { id, status }[] }`                                                      | Per-item partial response (REQ-045)                                      |
| `ValidationResult` | `{ valid: boolean, error?: string }`                                                                           | Output of ULID / name / query validation                                 |

### 4. Error Handling Return Codes

| Error Condition                                         | HTTP Status | Response Body                                  | Action                                                               |
| ------------------------------------------------------- | ----------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Malformed `id` (not a ULID)                             | 400         | `{ error: "Invalid id format" }`               | Return immediately; nothing enqueued (REQ-006)                       |
| Empty / whitespace-only name (`POST /v1/foods`)         | 400         | `{ error: "Name must not be empty" }`          | Return immediately; no row created, nothing enqueued (REQ-006)       |
| Search query too short (<2 chars)                       | 400         | `{ error: "Query too short" }`                 | Return immediately                                                   |
| Batch > 100 names                                       | 400         | `{ error: "names must be 1–100 items" }`       | Reject whole batch; create no rows, enqueue nothing (REQ-045)        |
| PATCH candidate not in this food's set                  | 400 / 409   | `{ error: "Candidate not in set" }`            | Thrown by MOD-018; food `status` unchanged (REQ-049)                 |
| Backpressure — queue saturated / circuit open (MOD-013) | 503         | `{ error: "Fetch queue saturated" }`           | `BackpressureError` from MOD-013 on any enqueue path; do not enqueue |
| PostgreSQL connection error (via MOD-016)               | 503         | `{ error: "Service temporarily unavailable" }` | Log error, return 503                                                |
| No row for `id`                                         | 404         | `{ error: "Not found" }`                       | Return immediately                                                   |

---

## MOD-002 — EnqueueEmitter (Postgres-as-queue enqueue + scheduled/completion fan-out)

**Parent ARCH**: ARCH-002 (**Parent SYS**: SYS-002)
**Type**: Stateless
**Runtime**: NestJS provider on ECS/Fargate (Node.js 22.x), called inline from ARCH-001 and ARCH-004
**Target source file**: `packages/services/food-service/src/queue/enqueue-emitter.service.ts`

> The demand-path enqueue is **not** an EventBridge event. `publishFoodRequested` /
> `publishFoodBatchRequested` are thin wrappers over an `INSERT INTO fetch_queue` (keyed on `food_id`) +
> `pg_notify('fetch_queued', id)` (Postgres-as-queue, REQ-011/REQ-014/REQ-017). EventBridge is retained
> ONLY for scheduled producers (`IngestionScheduled`, change-driven refresh REQ-032) and the
> fire-and-forget `FoodDataReceived` completion event (REQ-034). Payloads carry the food `id`, never
> `fdcId`.

### 1. Algorithmic / Logic View

```
FUNCTION publishFoodRequested(payload: { id, requestedBy }):
  IF NOT isValidUlid(payload.id):
    THROW ValidationError("Invalid food id")
  IF payload.requestedBy IS NULL OR payload.requestedBy == "":
    THROW ValidationError("Missing requestedBy provenance")     // authenticated provenance (REQ-042)

  // Postgres-as-queue: idempotent INSERT keyed on food_id, then NOTIFY the consumer. Distinct-requester
  // demand counting + the fetch_requesters upsert are done by MOD-003 (FetchQueueRouter.enqueue).
  FetchQueueRouter.enqueue(payload.id, payload.requestedBy)      // MOD-003: ON CONFLICT (food_id) + requester upsert
  Postgres.notify("fetch_queued", payload.id)                   // LISTEN/NOTIFY wake
  RETURN { enqueued: true }

FUNCTION publishFoodBatchRequested(payload: { ids, requestedBy }):
  IF length(payload.ids) == 0 OR length(payload.ids) > 100:
    THROW ValidationError("ids must be 1–100 items")            // client-facing batch cap (REQ-045)
  FOR EACH id IN payload.ids:
    publishFoodRequested({ id, requestedBy: payload.requestedBy })
  RETURN { enqueued: length(payload.ids) }

FUNCTION publishIngestionScheduled():
  // EventBridge scheduled producer — drives change-driven refresh (MOD-020); not a demand-path enqueue.
  entry = { Source: "food-service", DetailType: "IngestionScheduled",
            Detail: JSON.stringify({ scheduledAt: ISO8601Now() }), EventBusName: ENV.EVENT_BUS_NAME }
  RETURN { eventId: EventBridgeClient.putEvents({ Entries: [entry] }).Entries[0].EventId }

FUNCTION publishFoodDataReceived(payload: { id, status }):
  // FoodDataReceived stays on EventBridge — fire-and-forget fan-out to the (deferred) WS notifier (MOD-009).
  entry = { Source: "food-service", DetailType: "FoodDataReceived",
            Detail: JSON.stringify({ id: payload.id, status: payload.status }), EventBusName: ENV.EVENT_BUS_NAME }
  response = EventBridgeClient.putEvents({ Entries: [entry] })
  IF response.FailedEntryCount > 0:                              // fire-and-forget: log, do not throw
    MonitoringLogger.logRequest("eb-publish-fail", { id: payload.id }, 0)
```

### 2. State Machine View

`N/A Stateless` — EnqueueEmitter is a pure function module. Each call is independent with no retained state between invocations.

### 3. Internal Data Structures

| Name              | Type                                           | Description                                                                    |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `EnqueueResult`   | `{ enqueued: boolean }`                        | Successful `fetch_queue` INSERT + NOTIFY response (keyed on food `id`)         |
| `EventEntry`      | `{ Source, DetailType, Detail, EventBusName }` | EventBridge PutEvents entry shape (IngestionScheduled + FoodDataReceived only) |
| `ScheduledEvent`  | `{ scheduledAt: string }`                      | `IngestionScheduled` detail — drives change-driven refresh (MOD-020)           |
| `CompletionEvent` | `{ id: string, status: FoodStatus }`           | `FoodDataReceived` detail — carries the food `id`, never `fdcId`               |

### 4. Error Handling Return Codes

| Error Condition                                       | Error Type        | Response | Action                                                |
| ----------------------------------------------------- | ----------------- | -------- | ----------------------------------------------------- |
| Invalid food `id` in payload                          | `ValidationError` | Throw    | Caller receives error; no `fetch_queue` INSERT        |
| Missing `requestedBy` provenance                      | `ValidationError` | Throw    | No enqueue without authenticated provenance (REQ-042) |
| `ids` array empty or >100                             | `ValidationError` | Throw    | Caller receives error (REQ-045)                       |
| `fetch_queue` INSERT / NOTIFY failure                 | `EnqueueError`    | Throw    | Caller returns 503                                    |
| EventBridge `FailedEntryCount > 0` (FoodDataReceived) | Log only          | No throw | Fire-and-forget; log warning                          |

---

## MOD-003 — FetchQueueRouter (Postgres-as-Queue Demand-Weighted Router)

**Parent ARCH**: ARCH-003 (**Parent SYS**: SYS-002, SYS-003, SYS-004)
**Type**: Stateless (Postgres `fetch_queue` schema + lease/demand claim logic)
**Runtime**: Postgres `fetch_queue` table + `LISTEN/NOTIFY`; claim queries run inside the Fargate consumer worker (ARCH-004)
**Target source file**: `packages/services/food-service/src/queue/fetch-queue.router.ts`

> Re-keyed from `fdcId` to the food `id` (`fetch_queue.food_id PK`). No SQS, no EventBridge rules, no DLQ.
> There is NO static priority column and NO separate high/low queue — ordering is purely demand-weighted:
> `request_count DESC, first_requested ASC`, where `request_count` is the **capped distinct-requester
> count** (PRIORITY_CAP=1) derived from `fetch_requesters` (REQ-044). Background / refresh / batch
> enqueues carry low/zero demand, so they sort after high-demand rows naturally — not a separate tier.
> The single Fargate worker (one instance via a Postgres advisory lock, REQ-022) claims highest-demand
> rows first under a lease (`FOR UPDATE SKIP LOCKED` + lease timeout — REQ-018), with drain-time demotion
> of over-demand `sub`s (>50 pending) applied on top (REQ-043). Exhausted rows become tombstones
> (`status='tombstone'`), the DLQ analog. Status enum = `pending | in_flight | tombstone`.

### 1. Algorithmic / Logic View

```
// fetch_queue schema (Postgres-as-queue). Keyed on food id; ordering is demand-weighted (no priority col).
//   fetch_queue(food_id PK REFERENCES food(id), request_count, first_requested, last_requested,
//               status 'pending'|'in_flight'|'tombstone', attempts, last_error, fetched_at)
//   fetch_requesters(food_id, sub, requested_at, PK(food_id, sub))   -- distinct-requester demand (REQ-044)
// request_count = capped distinct-requester count (PRIORITY_CAP=1) — NEVER a raw +1; a sub counts once.

// Demand-path enqueue (REQ-014/REQ-044): upsert the requester, then set request_count = capped distinct count.
FUNCTION enqueue(foodId, sub):
  // (1) record distinct requester — PK(food_id, sub) makes repeat adds idempotent
  Postgres.query("INSERT INTO fetch_requesters (food_id, sub) VALUES ($1,$2) ON CONFLICT DO NOTHING", [foodId, sub])
  // (2) idempotent queue row keyed on food_id; request_count = capped distinct-sub count (PRIORITY_CAP=1)
  Postgres.query("""
    INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status)
    VALUES ($1, 1, now(), now(), 'pending')
    ON CONFLICT (food_id) DO UPDATE SET
      request_count = LEAST((SELECT count(*) FROM fetch_requesters WHERE food_id = $1), <PRIORITY_CAP_SCALE>),
      last_requested = now()
    WHERE fetch_queue.status = 'pending'
  """, [foodId])
  RETURN { enqueued: true }

// Single-instance worker guard (REQ-022): one consumer drains the queue (advisory lock).
FUNCTION acquireWorkerLock():
  RETURN Postgres.query("SELECT pg_try_advisory_lock($1)", [FETCH_QUEUE_LOCK_KEY])

// Claim the next eligible row, highest-demand first, under a lease (REQ-015/REQ-018). Demotion (REQ-043)
// is folded into the ORDER BY from the live per-sub pending count (drainPriorityTier, MOD-013).
FUNCTION leaseNext(leaseSeconds):
  sql = """
    UPDATE fetch_queue
    SET status='in_flight', lease_expires_at = now() + ($1 || ' seconds')::interval, attempts = attempts + 1
    WHERE food_id = (
      SELECT q.food_id FROM fetch_queue q
      WHERE (q.status='pending' AND q.last_requested <= now())
         OR (q.status='in_flight' AND q.lease_expires_at < now())     -- reclaim expired leases (REQ-018)
      ORDER BY drain_priority_tier(q.food_id) ASC,                    -- demoted subs to the back (REQ-043)
               q.request_count DESC, q.first_requested ASC            -- demand weight + FIFO (REQ-015)
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  """
  RETURN Postgres.query(sql, [leaseSeconds])

FUNCTION resolve(foodId):
  // RESOLVED food: clear the row from the pending set (ack).
  RETURN Postgres.query("DELETE FROM fetch_queue WHERE food_id = $1", [foodId])

FUNCTION tombstone(foodId, lastError):
  // NOT_FOUND/FAILED: status='tombstone' is the DLQ analog + audit trail (REQ-016/REQ-025/REQ-027).
  RETURN Postgres.query("UPDATE fetch_queue SET status='tombstone', last_error=$2 WHERE food_id=$1", [foodId, lastError])

FUNCTION requeueWithBackoff(foodId, baseSeconds, attempts):
  // exponential backoff on last_requested (REQ-016): now() + 2^attempts seconds
  RETURN Postgres.query("""UPDATE fetch_queue SET status='pending',
    last_requested = now() + (power(2, attempts) || ' seconds')::interval WHERE food_id=$1""", [foodId])

FUNCTION listenForWork():
  Postgres.execute("LISTEN fetch_queued")
```

### 2. State Machine View

`N/A Stateless` — FetchQueueRouter is the `fetch_queue` schema plus deterministic claim/lease SQL. No in-process runtime state; ordering is the demand-weighted `request_count DESC, first_requested ASC` ORDER BY (with the drain-time demotion tier prepended), and rows are leased/reclaimed by timestamp.

### 3. Internal Data Structures

| Name            | Type                                                                                                                                               | Description                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `FetchQueueRow` | `{ food_id, request_count, first_requested, last_requested, status: 'pending'\|'in_flight'\|'tombstone', attempts, last_error, lease_expires_at }` | Postgres `fetch_queue` row — keyed on food `id`                         |
| `RequesterRow`  | `{ food_id, sub, requested_at }` (PK `food_id`+`sub`)                                                                                              | Distinct-requester demand; PK makes repeat adds idempotent (REQ-044)    |
| `WorkerLock`    | `{ lockKey: number, acquired: boolean }`                                                                                                           | `pg_try_advisory_lock` result enforcing single-instance drain (REQ-022) |

### 4. Error Handling Return Codes

| Error Condition                                | Handling                          | Action                                                             |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Worker advisory lock already held              | `pg_try_advisory_lock` returns 0  | This instance idles; the single holder drains the queue (REQ-022)  |
| Lease expired before completion (worker crash) | Row reclaimed by next `leaseNext` | `lease_expires_at < now()` makes the row claimable again (REQ-018) |
| Row exhausts retry budget (attempts > 5)       | Set `status='tombstone'`          | Tombstone row (DLQ analog); food set `FAILED`; alarmed (REQ-016)   |
| `NOTIFY` lost / worker not LISTENing           | Periodic poll fallback            | Claim loop also polls on an interval; NOTIFY only reduces latency  |
| Duplicate enqueue (same `food_id`)             | `ON CONFLICT (food_id) DO UPDATE` | No duplicate row; distinct-requester demand recomputed (REQ-014)   |

---

## MOD-004 — FoodConsumerService (Fan-Out / Merge Worker)

**Parent ARCH**: ARCH-004 (**Parent SYS**: SYS-005)
**Type**: Stateful (long-running drain loop; single instance via Postgres advisory lock)
**Runtime**: Fargate consumer worker (Node.js 22.x), `LISTEN fetch_queued` + lease-claim loop
**Target source files**: `packages/services/food-service/src/worker/...`

> Heavily rewritten: the worker no longer fetches a single `fdcId` and upserts a denormalized row. Per
> queued food `id` it reads `food.name`, **iterates the source-adapter registry (MOD-015)** to fan out by
> name, calls each adapter **per-source rate-limited (MOD-005)**, validates each candidate at the adapter
> boundary (MOD-021, inside the adapter), **pre-merges**, drives the **golden-record merge (MOD-017)**,
> persists via the DAO layer (MOD-016) with provenance (MOD-019), and sets `food.status` to one of
> `RESOLVED | UNRESOLVED | NOT_FOUND | FAILED`. Async-producer provenance is validated first (MOD-014,
> REQ-042/REQ-048-analog). 30s `in_flight` lease; exponential backoff then tombstone after 5 attempts.

### 1. Algorithmic / Logic View

```
// Single-instance drain loop (REQ-022). One worker holds the advisory lock; it LISTENs + polls.
FUNCTION runWorker():
  IF NOT FetchQueueRouter.acquireWorkerLock():
    RETURN  // another instance is draining; idle
  FetchQueueRouter.listenForWork()                 // LISTEN fetch_queued
  LOOP:
    waitForNotifyOrInterval()
    row = FetchQueueRouter.leaseNext(leaseSeconds = 30)   // lease = visibility-timeout analog (REQ-018)
    IF row IS NOT NULL:
      processRow(row)

FUNCTION processRow(row):
  // Validate async provenance before any source consumption (MOD-014, REQ-042/REQ-048).
  AsyncProducerAuthz.assertEnqueueProvenance(dbSessionRole, row.requested_by)

  foodId = row.food_id
  name   = FoodDaoRepository.getName(foodId)         // MOD-016 — the add-by-name query

  // Fan out across the wired source-adapter registry (MOD-015). USDA is the only wired adapter today.
  candidates = []
  failedSources = 0
  FOR EACH adapter IN SourceAdapterRegistry.adapters():       // MOD-015
    // Per-source rolling-window gate (MOD-005). Pause this source at 90%; window full → defer the row.
    IF RollingWindowLimiter.shouldPauseDraining(adapter.source):
      FetchQueueRouter.requeueWithBackoff(foodId, RollingWindowLimiter.getWaitTime(adapter.source) + 5, row.attempts)
      RETURN                                                  // resume once earlier calls age out
    window = RollingWindowLimiter.checkAndRecordCall(adapter.source)
    IF NOT window.allowed:
      FetchQueueRouter.requeueWithBackoff(foodId, RollingWindowLimiter.getWaitTime(adapter.source) + 5, row.attempts)
      RETURN
    TRY:
      hits = adapter.searchByName(name)                       // per-source candidates (source + key)
      FOR EACH hit IN hits:
        candidates.push(adapter.fetchByKey(hit.externalKey))  // fetch + mapToCanonical + validate (MOD-021)
    CATCH SourceApiError(status=429):
      // source rate-limited despite our limiter — treat window full, back off (REQ-026)
      RollingWindowLimiter.markWindowFull(adapter.source)
      FetchQueueRouter.requeueWithBackoff(foodId, 60, row.attempts)
      RETURN
    CATCH SourceApiError(status=5xx) OR Timeout:
      failedSources += 1                                      // this source contributes nothing
    CATCH ValidationError:
      // reject-not-store: a candidate failing adapter validation is dropped (MOD-021, REQ-055)
      CONTINUE

  // No source had the item → NOT_FOUND tombstone (REQ-025).
  IF length(candidates) == 0 AND failedSources == 0:
    FoodDaoRepository.updateStatus(foodId, "NOT_FOUND", tombstonedAt = now())   // 30-day TTL
    FetchQueueRouter.tombstone(foodId, "no_source_has_item")
    EnqueueEmitter.publishFoodDataReceived({ id: foodId, status: "NOT_FOUND" })
    RETURN

  // Every source errored after retries → FAILED (REQ-027). Retry budget gates this.
  IF length(candidates) == 0 AND failedSources > 0:
    IF row.attempts >= 5:
      FoodDaoRepository.updateStatus(foodId, "FAILED", tombstonedAt = now())
      FetchQueueRouter.tombstone(foodId, "all_sources_errored")
      EnqueueEmitter.publishFoodDataReceived({ id: foodId, status: "FAILED" })
    ELSE:
      FetchQueueRouter.requeueWithBackoff(foodId, 5, row.attempts)              // exponential backoff (REQ-016)
    RETURN

  // Pre-merge dedup across sources as far as confident; residual ambiguity → UNRESOLVED (REQ-048/REQ-RES-3).
  collapsed = preMergeDedup(candidates)             // name normalization + attribute similarity
  result = GoldenRecordMergeEngine.merge(collapsed) // MOD-017 → { goldenRecord, outcome }

  // Persist atomically via the DAO layer (MOD-016) with per-field/value provenance (MOD-019).
  FoodDaoRepository.upsertGoldenRecord(foodId, result.goldenRecord, result.outcome)  // food_sources, food_nutrients, food_portions, food_field_provenance
  FetchQueueRouter.resolve(foodId)                  // ack: clear the row (RESOLVED or UNRESOLVED)
  EnqueueEmitter.publishFoodDataReceived({ id: foodId, status: result.outcome })
  MonitoringLogger.incrementMetric("consumer.resolved", 1)
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Draining : advisory lock acquired (single instance, REQ-022)
  Draining --> ClaimingRow : NOTIFY received or poll interval
  ClaimingRow --> Draining : no eligible row (idle until next wake)
  ClaimingRow --> CheckingProvenance : row leased (FOR UPDATE SKIP LOCKED, REQ-018)
  CheckingProvenance --> FanningOut : provenance ok (MOD-014)
  FanningOut --> DeferringLease : a source's window full / ≥90% (MOD-005)
  FanningOut --> Merging : candidates collected across wired adapters
  DeferringLease --> Draining : row re-queued with backoff; re-claimed later
  Merging --> Tombstoning : no source has it → NOT_FOUND, or all sources errored (attempts>5) → FAILED
  Merging --> Persisting : merge produced a golden record
  Persisting --> Resolving : RESOLVED (confident) or UNRESOLVED (multi-candidate)
  Resolving --> Draining : fetch_queue row cleared; FoodDataReceived emitted
  Tombstoning --> Draining : status='tombstone'; food NOT_FOUND/FAILED; FoodDataReceived emitted
```

### 3. Internal Data Structures

| Name                 | Type                                                                                                     | Description                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `FetchQueueRow`      | `{ food_id, request_count, status, attempts, last_error, lease_expires_at, requested_by }`               | Leased row being processed (keyed on food `id`)         |
| `CanonicalCandidate` | `{ source, externalKey, name, kind, nutrients: NutrientValue[], portions: PortionValue[], itemVersion }` | A validated, source-agnostic candidate from one adapter |
| `MergeResult`        | `{ goldenRecord: GoldenRecord, outcome: 'RESOLVED'\|'UNRESOLVED' }`                                      | Output of MOD-017 (MergeEngine)                         |
| `ProcessDisposition` | `'resolve' \| 'requeue_backoff' \| 'tombstone_not_found' \| 'tombstone_failed' \| 'defer_lease'`         | Disposition applied to the leased row                   |

### 4. Error Handling Return Codes

| Error Condition                                 | Action                                       | fetch_queue / food Outcome                                       |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| A source's rolling window full / ≥90% (MOD-005) | `requeueWithBackoff(waitTime + 5s)`          | Row stays `pending`; re-claimed after calls age out (REQ-019)    |
| Source 429                                      | `markWindowFull` + `requeueWithBackoff(60s)` | Row re-queued; stop draining that source (REQ-026)               |
| Source 5xx / timeout (attempts ≤ 5)             | `requeueWithBackoff` (exponential, REQ-016)  | Row re-queued; that source contributes nothing this pass         |
| All sources errored (attempts > 5)              | `updateStatus(FAILED)` + `tombstone`         | food `FAILED`; tombstone row (DLQ analog) + alarm (REQ-027)      |
| No source has the item                          | `updateStatus(NOT_FOUND)` + `tombstone`      | food `NOT_FOUND` tombstone (30-day TTL); no retry (REQ-025)      |
| Candidate fails adapter validation (MOD-021)    | Drop the candidate (reject-not-store)        | Food may still resolve from remaining valid candidates (REQ-055) |
| Multiple non-collapsible candidates             | `upsertGoldenRecord(outcome=UNRESOLVED)`     | food `UNRESOLVED`; surfaced via MOD-018 `/candidates`            |
| PostgreSQL upsert failure (MOD-016)             | `requeueWithBackoff`                         | Row re-queued; retried under REQ-016 budget                      |
| Worker crash mid-lease                          | Lease expires → row reclaimed                | `lease_expires_at < now()` re-exposes the row (REQ-018)          |

---

## MOD-005 — RollingWindowLimiter (Per-Source Atomic Rolling 60-Minute Window)

**Parent ARCH**: ARCH-005 (**Parent SYS**: SYS-006 [CROSS-CUTTING])
**Type**: Stateful (state stored in Postgres by default; Redis is a deferred variant)
**Runtime**: Called from the ARCH-004 Fargate consumer worker; state = recent **per-source** call timestamps in the `source_call_log` table (`kitchensink_food` DB). The deferred variant keeps the same timestamps in a per-source Redis sorted set.
**Target source file**: `packages/services/food-service/src/worker/rolling-window.limiter.ts`

> Re-keyed from a single USDA window to a **per-source** window on `source_call_log` (keyed by `source`).
> Each wired source gets its own trailing-60-min window sized to its cap (USDA: ≤1,000; pause at 90% =
> 900). This is a rolling window, not a token bucket (a 1,000-capacity bucket refilling at 1,000/hr can
> emit ~2,000 calls across a rolling hour, breaching the hard cap; the rolling window enforces ≤cap
> strictly — REQ-019/REQ-020). State is the set of recent per-source call timestamps; admission is a
> windowed count, and a call is recorded by inserting its timestamp atomically.

### 1. Algorithmic / Logic View

```
WINDOW_SECONDS = 3600                              // trailing 60-minute window
// Per-source caps; additive — each wired source has its own cap + pause threshold.
SOURCE_CAPS    = { usda: { hardCap: 1000, pauseThreshold: 900 } }   // 90% pause (REQ-019)

// Default (lean-launch) state: source_call_log(source, called_at) — one row per recent per-source call.
// check-and-record is ONE atomic Postgres txn (count + conditional insert), so a source's window can
// never be overshot under concurrent worker access (REQ-020).

FUNCTION checkAndRecordCall(source):
  cap = SOURCE_CAPS[source].hardCap
  // Single statement: windowed count for THIS source, insert only if strictly under the cap.
  //   INSERT INTO source_call_log (source, called_at)
  //   SELECT $1, now()
  //   WHERE (SELECT count(*) FROM source_call_log
  //          WHERE source=$1 AND called_at > now() - interval '3600 seconds') < $2
  //   RETURNING called_at;
  inserted = Postgres.query(ATOMIC_COUNT_AND_INSERT_SQL, [source, cap])
  windowCount = countCallsInTrailingWindow(source)
  RETURN { allowed: inserted.rowCount == 1, windowCount }

FUNCTION shouldPauseDraining(source):
  // Soft gate consulted BEFORE a fetch: pause at 90% so the worker stops well before the hard cap.
  RETURN countCallsInTrailingWindow(source) >= SOURCE_CAPS[source].pauseThreshold

FUNCTION countCallsInTrailingWindow(source):
  // SELECT count(*) FROM source_call_log WHERE source=$1 AND called_at > now() - interval '3600 seconds'
  RETURN Postgres.query(WINDOW_COUNT_SQL, [source]).count

FUNCTION getWaitTime(source):
  // Seconds until this source's oldest in-window call ages out.
  IF countCallsInTrailingWindow(source) < SOURCE_CAPS[source].hardCap:
    RETURN 0
  oldest = Postgres.query(OLDEST_IN_WINDOW_SQL, [source]).called_at
  RETURN ceil((oldest + WINDOW_SECONDS) - now())

FUNCTION markWindowFull(source):
  // On a source 429: treat the window as full so the worker backs off draining that source (REQ-026).
  windowFullUntil[source] = now() + BACKOFF_SECONDS

// ---- DEFERRED Redis variant (functionally identical, per source) ---------------------------
//   WINDOW_KEY(source) = "rate_limiter:" + source + ":calls"  (sorted set of call timestamps)
//   Lua: ZREMRANGEBYSCORE drop aged-out; n = ZCOUNT trailing 60 min;
//        if n < cap then ZADD now; return {1, n+1} else return {0, n} end
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> WindowOpen
  WindowOpen --> WindowOpen : checkAndRecordCall(source) inserts timestamp (count < cap)
  WindowOpen --> DrainPaused : trailing-60-min count reaches pauseThreshold (90%)
  WindowOpen --> WindowFull : trailing-60-min count reaches hardCap
  DrainPaused --> WindowOpen : earlier calls age out → count < pauseThreshold
  WindowFull --> WindowOpen : oldest in-window call ages out → count < hardCap
  WindowOpen --> [*] : checkAndRecordCall returns allowed=true
  WindowFull --> [*] : checkAndRecordCall returns allowed=false (window full)
```

### 3. Internal Data Structures

| Name                | Type                                                                   | Description                                                                                        |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `source_call_log`   | table `{ id, source, called_at }` (one row per recent per-source call) | The rolling-window state; per-source trailing-60-min `count(*)` is the window count (lean default) |
| `WindowCheckResult` | `{ allowed: boolean, windowCount: number }`                            | Return of `checkAndRecordCall(source)` — whether the call may proceed + trailing count             |
| `SourceCaps`        | `Record<FoodSourceId, { hardCap: number, pauseThreshold: number }>`    | Per-source caps (USDA: 1000 / 900); additive — a new source appends its own entry                  |
| `CallTimestampSet`  | per-source sorted set `rate_limiter:{source}:calls`                    | DEFERRED Redis variant of the timestamp state                                                      |

### 4. Error Handling Return Codes

| Error Condition                                         | Action                           | Caller Impact                                                                          |
| ------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Store unavailable (Postgres/Redis)                      | Throw `RateLimitWindowFullError` | ARCH-004 treats as not-allowed; re-queues the row with backoff                         |
| Store timeout (>100ms)                                  | Throw `RateLimitWindowFullError` | Same as unavailable                                                                    |
| Count-and-record txn / Lua error                        | Throw `RateLimitWindowFullError` | ARCH-004 re-queues the row                                                             |
| Source returns 429 despite the limiter                  | `markWindowFull(source)`         | ARCH-004 pauses draining that source and re-queues (NOT a state reset, REQ-026)        |
| Window state lost (call-log truncation / Redis restart) | Trailing count restarts at 0     | Bounded: may briefly exceed the true rolling-hour count before fresh timestamps refill |

---

## MOD-006 — FoodPostgresRepository (Canonical Normalized Store)

**Parent ARCH**: ARCH-006 (**Parent SYS**: SYS-007 — _corrected from SYS-006_)
**Type**: Stateless (connection pool held by the long-running Fargate/Nest process)
**Runtime**: ECS/Fargate (Node.js 22.x), Drizzle ORM over the 12-table canonical schema in the `kitchensink_food` logical database on the shared `kitchensink-data-{stage}` instance (no new RDS, no cluster)
**Target source file**: `packages/services/food-service/src/database/schema/*.ts` + low-level query builders

> Completely rewritten from the denormalized `foods`-with-`fdcId`-PK / JSONB-nutrient / `fetch_status`
> design to the **normalized, provenance-bearing** schema. Tables: `food` (internal `id` PK,
> `normalized_name` dedup key, lifecycle `status`, golden scalars), `food_sources` (crosswalk,
> `UNIQUE(source, external_key)`, `item_version`, **no payload**), `nutrient` (dictionary),
> `food_nutrients`/`food_portions` (`source_id` per-value provenance), `food_field_provenance` (scalar
> provenance), `food_category`(+assignment); plus operational `fetch_queue`/`fetch_requesters`/
> `source_call_log`/`source_sync_metadata`. No `fdcId`, no denormalized nutrient columns, no
> `fetch_status`, no EAV. MOD-016 (DAO layer) is the only caller; this module is the physical schema + raw
> query layer underneath it.

### 1. Algorithmic / Logic View

```
// Drizzle schema (excerpt — controlled enums + golden record). ULID PKs use text('id') + newFoodId().
// pgEnum food_status   = ['PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED']    (REQ-028 lifecycle)
// pgEnum food_kind     = ['generic','branded']                                       (REQ-IDN-3)
// pgEnum food_source   = ['usda']    // additive — new sources append a value
// pgEnum food_field    = ['name','description','kind','brand_owner','brand_name','barcode']
// pgEnum nutrient_basis= ['per_100g','per_serving']

FUNCTION findGoldenRecord(id): GoldenRecord | null
  // Assemble scalars + nutrients + portions + provenance for one food id.
  food = query("SELECT * FROM food WHERE id = $1", [id])
  IF food IS NULL: RETURN null
  nutrients = query("""SELECT fn.*, n.name, n.unit FROM food_nutrients fn
                       JOIN nutrient n ON n.id = fn.nutrient_id WHERE fn.food_id = $1""", [id])
  portions  = query("SELECT * FROM food_portions WHERE food_id = $1", [id])
  prov      = query("SELECT field, source_id FROM food_field_provenance WHERE food_id = $1", [id])
  RETURN assembleGoldenRecord(food, nutrients, portions, prov)

FUNCTION findByExternalKey(source, externalKey): { id } | null
  // Crosswalk + barcode/external_key lookup (REQ-008) via the UNIQUE(source, external_key) index.
  RETURN query("SELECT food_id AS id FROM food_sources WHERE source=$1 AND external_key=$2", [source, externalKey])

FUNCTION searchFoods(query): { id, name, score }[]
  // pg_trgm fuzzy/substring/partial on name+description (REQ-008/REQ-010). Local store only — no source.
  sql = """
    SELECT id, name, similarity(name, $1) AS score
    FROM food
    WHERE name % $1 OR description ILIKE '%' || $1 || '%'
    ORDER BY score DESC LIMIT 50
  """
  RETURN query(sql, [query])

FUNCTION updateStatus(id, status, tombstonedAt?): { success: boolean }
  VALIDATE status IN ['PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED']   // lifecycle enum (REQ-028)
  query("UPDATE food SET status=$1, tombstoned_at=$3, updated_at=now() WHERE id=$2", [status, id, tombstonedAt])
  RETURN { success: true }

FUNCTION upsertCrosswalk(foodId, source, externalKey, itemVersion): { sourceId }
  // food_sources crosswalk; UNIQUE(source, external_key) is the dedup + provenance anchor. NO payload.
  row = query("""INSERT INTO food_sources (id, food_id, source, external_key, item_version)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (source, external_key) DO UPDATE SET item_version=$5, fetched_at=now()
                 RETURNING id""", [newFoodId(), foodId, source, externalKey, itemVersion])
  RETURN { sourceId: row.id }
```

### 2. State Machine View

`N/A Stateless` — FoodPostgresRepository is a pure data-access module over the normalized schema. Each method executes discrete SQL with no retained state between calls. The connection pool is held by the long-running process against the shared `kitchensink-data-{stage}` instance, not by this module.

### 3. Internal Data Structures

| Name              | Type                                                                                                                                | Description                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `FoodRow`         | `{ id, name, normalized_name, description, kind, brand_owner, brand_name, barcode, status, tombstoned_at, created_at, updated_at }` | The `food` golden-scalar row (id-keyed, no `fdcId`)              |
| `FoodSourceRow`   | `{ id, food_id, source, external_key, fetch_state, item_version, fetched_at }`                                                      | Crosswalk row; `id` is the `source_id` referenced for provenance |
| `FoodNutrientRow` | `{ id, food_id, nutrient_id, amount: numeric, basis, source_id }`                                                                   | Normalized nutrient value with per-value provenance (REQ-052)    |
| `GoldenRecord`    | `{ id, name, description, kind, nutrients: NutrientValue[], portions: PortionValue[], provenance: { field, source }[] }`            | Assembled cross-source record returned to MOD-016                |
| `PoolConfig`      | `{ host, port, database: 'kitchensink_food', user, password, max: 10, idleTimeoutMillis: 30000 }`                                   | pg Pool config (password from SecretManager)                     |

### 4. Error Handling Return Codes

| Error Condition                          | Error Type                | Action                                                           |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Connection refused / timeout             | `PostgresConnectionError` | Throw; caller returns 503                                        |
| Query timeout (>5s)                      | `PostgresQueryTimeout`    | Throw; caller returns 503                                        |
| `UNIQUE(source, external_key)` conflict  | Handled by `ON CONFLICT`  | No error; crosswalk upsert succeeds                              |
| Invalid `food_status` value              | `ValidationError`         | Throw before query execution                                     |
| Row not found (`findGoldenRecord`)       | —                         | Return `null` (not an error)                                     |
| Normalized-name unique conflict (create) | Surfaced to MOD-016       | MOD-016's advisory lock collapses to the existing `id` (REQ-005) |

---

## MOD-007 — FoodCacheService (Optional Hot Cache)

**Parent ARCH**: ARCH-007 (**Parent SYS**: SYS-008 — _corrected from SYS-007_)
**Type**: Stateless (state in the cache store — deferred Redis variant; lean-launch default has no shared cache)
**Runtime**: ECS/Fargate (Node.js 22.x). Lean-launch default is the Postgres canonical store (optionally an in-process LRU within a handler lifetime); the deferred Redis variant uses `ioredis`
**Target source file**: `packages/services/food-service/src/cache/food-cache.service.ts`

> Re-keyed from `food:{fdcId}` to `food:{id}` (the internal ULID). The cache is **optional** — the
> lean-launch default is the Postgres canonical store (MOD-006) plus an optional in-process LRU; the Redis
> read-through cache (`food:{id}`, TTL 24h, `allkeys-lfu`) is a deferred post-launch variant
> (REQ-030/A-002). **Pending-fetch dedup is the `fetch_queue` `ON CONFLICT` row (MOD-003), not a Redis
> set** — the old `pending_fetch` set is removed.

### 1. Algorithmic / Logic View

```
FOOD_KEY(id) = "food:" + id                        // keyed on the internal ULID id; TTL = 86400s (24h)

FUNCTION get(id): GoldenRecord | null
  raw = Cache.get(FOOD_KEY(id))
  RETURN raw IS NULL ? null : JSON.parse(raw)

FUNCTION set(id, data: GoldenRecord, ttl = 86400): void
  Cache.set(FOOD_KEY(id), JSON.stringify(data), "EX", ttl)     // REQ-030 (deferred variant)

FUNCTION invalidate(id): void
  Cache.del(FOOD_KEY(id))                                       // called by MOD-004 after a merge upsert

// NOTE: no pending-set here. Pending-fetch dedup is the fetch_queue ON CONFLICT (food_id) row (MOD-003).
```

### 2. State Machine View

`N/A Stateless` — a thin wrapper over the optional cache store. All state lives in the store (or is absent at lean launch); the module retains no in-process state between requests.

### 3. Internal Data Structures

| Name                | Type                                                                              | Description                                                        |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `CacheKey`          | `"food:{id}"`                                                                     | Cache key keyed on the internal ULID `id` (deferred Redis variant) |
| `CacheClientConfig` | `{ host, port, password, tls: true, connectTimeout: 2000, commandTimeout: 1000 }` | ioredis shape for the deferred Redis variant                       |

### 4. Error Handling Return Codes

| Error Condition                | Action                        | Caller Impact                                    |
| ------------------------------ | ----------------------------- | ------------------------------------------------ |
| Cache store connection refused | Throw `CacheUnavailableError` | ARCH-001 falls through to PostgreSQL (MOD-016)   |
| Cache command timeout (>1s)    | Throw `CacheUnavailableError` | ARCH-001 falls through to PostgreSQL             |
| JSON parse error on `get()`    | Log error, return `null`      | Cache treated as miss; canonical store consulted |
| `invalidate` failure           | Log warning, continue         | Stale entry expires via TTL                      |

---

## MOD-008 — UsdaApiClient (USDA Source Adapter — the _only_ `fdcId` boundary)

**Parent ARCH**: ARCH-008 (**Parent SYS**: SYS-009 — _corrected from SYS-008_)
**Type**: Stateless
**Runtime**: Node.js 22.x, native `fetch`; invoked from the ARCH-004 worker via the registry (MOD-015)
**Target source file**: `packages/clients/usda/src/usda-api.client.ts` (package `@kitchensink/usda-client`)

> **This is the ONE module where `fdcId` and USDA-native terms appear** (REQ-046/REQ-IDN-2). It implements
> the `FoodSourceAdapter` interface (`source='usda'`, `searchByName`, `fetchByKey`) and registers into
> MOD-015. `mapToCanonical` is internal to `fetchByKey` and performs the **`fdcId → external_key`**
> mapping inbound; nothing past this boundary sees `fdcId`. It validates/sanitizes via MOD-021 and
> enforces HTTPS with cert validation (REQ-055). It MAY batch USDA's `POST /v1/foods` (≤20 keys/call = 1
> windowed call, REQ-023) — an adapter-internal optimization invisible to the canonical API.

### 1. Algorithmic / Logic View

```
USDA_BASE_URL      = "https://api.nal.usda.gov/fdc/v1"
MAX_BATCH_SIZE     = 20                              // USDA hard cap: 20 fdcIds/call (REQ-023)
REQUEST_TIMEOUT_MS = 10000

readonly source = 'usda'                             // FoodSourceAdapter.source

// FoodSourceAdapter.searchByName — candidates carry the source + that source's key (fdcId), confined here.
FUNCTION searchByName(name): SourceCandidate[]
  apiKey = SecretManager.getSourceApiKey('usda')     // MOD-010 (per-source key)
  assertHttps(USDA_BASE_URL)                          // MOD-021 — HTTPS + cert validation (REQ-055)
  response = HTTP.GET(USDA_BASE_URL + "/foods/search?query=" + encode(name),
                      headers: { "X-Api-Key": apiKey }, timeout: REQUEST_TIMEOUT_MS)
  classifyErrors(response)                            // 401/404/429/5xx → SourceApiError
  data = JSON.parse(response.body)
  // fdcId lives ONLY here; surfaced as externalKey to everything downstream.
  RETURN data.foods.map(f => ({ source: 'usda', externalKey: String(f.fdcId), name: f.description }))

// FoodSourceAdapter.fetchByKey — fetch one item by its USDA key, map to canonical, validate.
FUNCTION fetchByKey(externalKey): CanonicalCandidate
  apiKey = SecretManager.getSourceApiKey('usda')
  assertHttps(USDA_BASE_URL)                          // MOD-021 (REQ-055)
  fdcId  = externalKey                                // the inbound fdcId — the ONLY place it is named
  response = HTTP.GET(USDA_BASE_URL + "/food/" + fdcId, headers: { "X-Api-Key": apiKey }, timeout: REQUEST_TIMEOUT_MS)
  classifyErrors(response)
  raw = JSON.parse(response.body)
  mapped = mapToCanonical(raw)                        // fdcId → external_key happens here
  RETURN AdapterInputValidator.validateAndSanitize(mapped)   // MOD-021 — reject-not-store (REQ-055)

// Optional batch (adapter-internal optimization; ≤20 keys/call = 1 windowed call, REQ-023).
FUNCTION fetchManyByKeys(externalKeys): CanonicalCandidate[]
  IF length(externalKeys) > MAX_BATCH_SIZE:
    THROW SourceApiError("Batch exceeds USDA cap of 20", 400)
  response = HTTP.POST(USDA_BASE_URL + "/foods", headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
                       body: JSON.stringify({ fdcIds: externalKeys.map(Number), format: "abridged" }), timeout: REQUEST_TIMEOUT_MS)
  classifyErrors(response)
  RETURN JSON.parse(response.body).map(raw => AdapterInputValidator.validateAndSanitize(mapToCanonical(raw)))

// mapToCanonical — the fdcId→external_key boundary. Produces a SOURCE-AGNOSTIC candidate.
FUNCTION mapToCanonical(usdaItem): MappedCandidate
  RETURN {
    source: 'usda',
    externalKey: String(usdaItem.fdcId),             // fdcId → external_key (REQ-046)
    name: usdaItem.description,
    kind: usdaItem.dataType == 'Branded' ? 'branded' : 'generic',  // USDA data-type → canonical kind (REQ-IDN-3)
    brandOwner: usdaItem.brandOwner OR null,
    nutrients: usdaItem.foodNutrients.map(n => ({
      code: n.nutrient.number, name: n.nutrient.name, unit: n.nutrient.unitName,
      amount: n.amount, basis: 'per_100g'            // USDA abridged is per-100g; normalized before blend
    })),
    portions: (usdaItem.foodPortions OR []).map(p => ({ label: p.modifier, gramWeight: p.gramWeight })),
    itemVersion: usdaItem.publicationDate OR hash(usdaItem)   // food_sources.item_version for change-refresh (REQ-032)
  }

FUNCTION classifyErrors(response):
  IF response.status == 401: THROW SourceApiError("Invalid USDA API key", 401)
  IF response.status == 404: THROW SourceApiError("Item not found in USDA", 404)
  IF response.status == 429: THROW SourceApiError("USDA rate limit exceeded", 429)
  IF response.status >= 500: THROW SourceApiError("USDA server error", response.status)
```

### 2. State Machine View

`N/A Stateless` — UsdaApiClient is a pure HTTP adapter. Each call is independent; no connection pooling or session state is maintained between invocations.

### 3. Internal Data Structures

| Name              | Type                                                                                                                           | Description                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `UsdaFoodItem`    | `{ fdcId, description, dataType, brandOwner?, foodNutrients: UsdaNutrient[], foodPortions?: UsdaPortion[], publicationDate? }` | Raw USDA response item — **`fdcId` confined here**                    |
| `UsdaNutrient`    | `{ nutrient: { number, name, unitName }, amount }`                                                                             | Raw USDA nutrient (mapped to a source-agnostic value)                 |
| `SourceCandidate` | `{ source: 'usda', externalKey: string, name: string }`                                                                        | `searchByName` result — `externalKey`, never `fdcId`, past this point |
| `MappedCandidate` | `{ source, externalKey, name, kind, brandOwner, nutrients, portions, itemVersion }`                                            | Pre-validation canonical mapping handed to MOD-021                    |
| `SourceApiError`  | `{ message: string, statusCode: number }`                                                                                      | Typed error (extends `Error`, has `isSourceApiError` guard, NFR-009)  |

### 4. Error Handling Return Codes

| Error Condition               | Error Type               | Status Code | Action                                                   |
| ----------------------------- | ------------------------ | ----------- | -------------------------------------------------------- |
| HTTP 401 Unauthorized         | `SourceApiError`         | 401         | Throw; ARCH-004 alerts on-call (per-source key rotation) |
| HTTP 429 Too Many Requests    | `SourceApiError`         | 429         | Throw; ARCH-004 marks window full + backs off (REQ-026)  |
| HTTP 5xx Server Error         | `SourceApiError`         | 5xx         | Throw; ARCH-004 re-queues with backoff (≤5, REQ-016)     |
| HTTP 404 Not Found            | `SourceApiError`         | 404         | Throw; this source contributes nothing (may → NOT_FOUND) |
| Request timeout (>10s)        | `SourceApiError`         | 0           | Throw; ARCH-004 re-queues with backoff                   |
| Mapped value fails validation | `ValidationError`        | —           | From MOD-021; candidate rejected, not stored (REQ-055)   |
| Non-HTTPS / cert failure      | `TransportSecurityError` | —           | From MOD-021 `assertHttps`; fetch refused (REQ-055)      |
| `externalKeys` > 20 (batch)   | `SourceApiError`         | 400         | Throw before HTTP call (USDA 20/call cap, REQ-023)       |

---

## MOD-009 — WebSocketNotifier (Real-Time Client Notification — deferred)

**Parent ARCH**: ARCH-009 (**Parent SYS**: SYS-010 — _corrected from SYS-009_)
**Type**: Stateless (connection state in API Gateway WebSocket + DynamoDB)
**Runtime**: AWS Lambda (Node.js 22.x), `@aws-sdk/client-apigatewaymanagementapi`
**Target source file**: `packages/services/food-service/src/ws/websocket-notifier.handler.ts`

> Re-keyed from `fdcId` to the food `id`. ARCH-009 is **launch-deferred** (US-9); the EventBridge
> `FoodDataReceived` rule targets nothing until then. The notifier resolves recipients from the
> authenticated **subscription set** (`fetch_requesters`, `sub → id`) so a completion is delivered only to
> connections whose `sub` requested that `id` (REQ-041). The `$connect` REQUEST authorizer (sole
> Lambda-authorizer surface) reuses MOD-012's shared Clerk verification.

### 1. Algorithmic / Logic View

```
// NOTE: ARCH-009 is launch-deferred (US-9). Scaffolded only. Keyed on the food id, never fdcId.

FUNCTION notifyClients(id: string, status: FoodStatus): number
  // Recipients = connections whose authenticated sub requested this food id (REQ-041).
  subs = FetchRequesters.subsFor(id)                  // SELECT sub FROM fetch_requesters WHERE food_id = $1
  connectionIds = ConnectionStore.connectionsForSubs(subs)
  notified = 0
  FOR EACH connectionId IN connectionIds:
    TRY:
      ApiGatewayManagementClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ type: "food_ready", id, status })   // carries the food id (REQ-034)
      })
      notified += 1
    CATCH GoneException:
      ConnectionStore.deleteConnection(connectionId)  // stale; clean up
    CATCH Error:
      MonitoringLogger.logRequest("ws-notify-fail", { connectionId, id }, 0)
  RETURN notified

FUNCTION onConnect(connectionId, sub, tokenExp): void
  ConnectionStore.putConnection({ connectionId, sub, tokenExp, ttl: now() + 3600 })

FUNCTION enforceTokenExpiry(connectionId, tokenExp): void
  // Mid-connection expiry (REQ-049b): a WS connection MUST NOT outlive its token.
  IF tokenExp <= now():
    ApiGatewayManagementClient.deleteConnection({ ConnectionId: connectionId })  // server-side close
    ConnectionStore.deleteConnection(connectionId)
    MonitoringLogger.incrementMetric("ws.closed.token_expired", 1)               // re-auth on reconnect (REQ-049c)
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Disconnected
  Disconnected --> Connected : $connect (onConnect, token verified — MOD-012; sub→id subscription persisted)
  Connected --> Notified : FoodDataReceived(id) → postToConnection (only to subscribed subs, REQ-041)
  Notified --> Connected : client remains connected
  Connected --> Disconnected : $disconnect (onDisconnect)
  Connected --> Disconnected : GoneException (stale connection cleaned up)
  Connected --> Disconnected : token exp passes mid-connection → server-side close (REQ-049b)
  Disconnected --> [*] : re-auth required on reconnect with fresh token (REQ-049c)
```

### 3. Internal Data Structures

| Name               | Type                                                                   | Description                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectionRecord` | `{ connectionId: string, sub: string, tokenExp: number, ttl: number }` | DynamoDB item; `sub` joins to `fetch_requesters` for per-recipient delivery (REQ-041); `tokenExp` drives mid-connection close (REQ-049b) |
| `WsMessage`        | `{ type: 'food_ready', id: string, status: FoodStatus }`               | JSON payload pushed to clients — carries the food `id`, never `fdcId`                                                                    |
| `ApiGwMgmtConfig`  | `{ endpoint: string }`                                                 | API Gateway Management API endpoint (`wss://.../@connections`)                                                                           |

### 4. Error Handling Return Codes

| Error Condition                    | Action                            | Impact                                                                      |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `GoneException` (stale connection) | Delete connection from DynamoDB   | Stale entry cleaned up; no client impact                                    |
| DynamoDB lookup failure            | Log error, return 0               | No clients notified; non-fatal (clients fall back to polling)               |
| `postToConnection` timeout         | Log warning, continue             | Client misses notification; sees data on next poll                          |
| No subscribed connections for `id` | Return 0                          | Normal case; no client subscribed                                           |
| Token `exp` passes mid-connection  | Server-side close + delete record | Connection closed (REQ-049b); client re-auths with a fresh token (REQ-049c) |
| `$connect` token invalid           | 403 (pinned)                      | Reject before connection established (REQ-049d)                             |

---

## MOD-010 — SecretManager (Per-Source API Key Wrapper)

**Parent ARCH**: ARCH-010 (**Parent SYS**: SYS-011 — _corrected from a CROSS-CUTTING-only mapping_)
**Type**: Stateful (in-memory cache with TTL)
**Runtime**: ECS/Fargate (Node.js 22.x) — in-process cache lives for the container lifetime; `@aws-sdk/client-secrets-manager`
**Target source file**: `packages/services/food-service/src/secrets/secret-manager.service.ts`

> Generalized from `getUsdaApiKey()` to a **per-source** `getSourceApiKey(source)`. Each external source's
> API key (e.g. the USDA key) is the only secret this feature requires (REQ-042/A-009); injected to the
> worker/adapters as config, never logged or returned.

### 1. Algorithmic / Logic View

```
SECRET_CACHE = {}                                    // { source: { value, expiresAt } }
CACHE_TTL_MS = 300000                                // 5 minutes

FUNCTION getSourceApiKey(source): string
  secretName = ENV.SOURCE_API_KEY_SECRET_NAME[source]   // per-source secret (e.g. usda)
  cached = SECRET_CACHE[source]
  IF cached IS NOT NULL AND cached.expiresAt > now():
    RETURN cached.value
  response = SecretsManagerClient.getSecretValue({ SecretId: secretName })
  apiKey = JSON.parse(response.SecretString).apiKey
  SECRET_CACHE[source] = { value: apiKey, expiresAt: now() + CACHE_TTL_MS }
  RETURN apiKey

FUNCTION rotateKey(source): { success: boolean }
  SecretsManagerClient.rotateSecret({ SecretId: ENV.SOURCE_API_KEY_SECRET_NAME[source] })
  DELETE SECRET_CACHE[source]
  RETURN { success: true }
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> CacheEmpty
  CacheEmpty --> Fetching : getSourceApiKey(source) called
  Fetching --> CachePopulated : secret retrieved
  Fetching --> Error : Secrets Manager unavailable
  CachePopulated --> CachePopulated : getSourceApiKey(source) (cache HIT)
  CachePopulated --> CacheExpired : TTL elapsed (5 min)
  CacheExpired --> Fetching : getSourceApiKey(source) called
  CachePopulated --> CacheEmpty : rotateKey(source) called
  Error --> [*]
```

### 3. Internal Data Structures

| Name          | Type                                                         | Description                                                  |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `SecretCache` | `Record<FoodSourceId, { value: string, expiresAt: number }>` | Per-source in-memory cache; lives for the container lifetime |
| `SecretValue` | `{ apiKey: string }`                                         | JSON structure stored in Secrets Manager                     |

### 4. Error Handling Return Codes

| Error Condition                                | Error Type            | Action                                         |
| ---------------------------------------------- | --------------------- | ---------------------------------------------- |
| Secret not found (`ResourceNotFoundException`) | `SecretNotFoundError` | Throw; the adapter cannot proceed              |
| Access denied (`AccessDeniedException`)        | `SecretAccessError`   | Throw; alert on-call (IAM misconfiguration)    |
| Secrets Manager throttling                     | `SecretThrottleError` | Retry with exponential backoff (3 attempts)    |
| JSON parse error on secret value               | `SecretFormatError`   | Throw; alert on-call (secret format corrupted) |

---

## MOD-011 — MonitoringLogger (Structured Logging & Metrics)

**Parent ARCH**: ARCH-011 (**Parent SYS**: SYS-012 — _corrected from a CROSS-CUTTING-only mapping_)
**Type**: Stateless
**Runtime**: ECS/Fargate (Node.js 22.x) — shared by the food-service API and the consumer worker; `@aws-lambda-powertools/logger` + CloudWatch SDK
**Target source file**: `packages/services/food-service/src/observability/monitoring-logger.service.ts`

> Metrics re-keyed to the new model: queue depth, **per-source** trailing-60-min call counts, resolution
> latency, `UNRESOLVED` backlog, tombstone-row count, auth-`401` rate.

### 1. Algorithmic / Logic View

```
logger = new Logger({ serviceName: "food-service", logLevel: ENV.LOG_LEVEL OR "INFO" })

FUNCTION logRequest(requestId, event, durationMs): void
  logger.info("request", { requestId, event, durationMs, timestamp: ISO8601Now() })

FUNCTION logError(requestId, error, context): void
  logger.error("error", { requestId, errorName: error.name, errorMessage: error.message,
                          stackTrace: error.stack, context, timestamp: ISO8601Now() })

FUNCTION incrementMetric(name, value): void
  // CloudWatch EMF. Namespace 'FoodData' (source-agnostic; was 'UsdaFoodData').
  logger.info("metric", { _aws: { Timestamp: unixMs(), CloudWatchMetrics: [{
    Namespace: "FoodData", Dimensions: [["service"]], Metrics: [{ Name: name, Unit: "Count" }] }] },
    service: "food-service", [name]: value })

FUNCTION startTrace(requestId): Segment
  RETURN Tracer.getSegment().addNewSubsegment(requestId)       // X-Ray
```

### 2. State Machine View

`N/A Stateless` — pure utility module. Each call emits a log entry or metric independently; no state retained.

### 3. Internal Data Structures

| Name        | Type                                                                        | Description                                   |
| ----------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `LogEntry`  | `{ requestId, event, durationMs, timestamp }`                               | Structured log payload                        |
| `EmfMetric` | `{ _aws: { Timestamp, CloudWatchMetrics }, service, [metricName]: number }` | CloudWatch EMF payload (Namespace `FoodData`) |
| `Segment`   | X-Ray `Subsegment`                                                          | Distributed-tracing segment                   |

### 4. Error Handling Return Codes

| Error Condition                  | Action                             | Impact                            |
| -------------------------------- | ---------------------------------- | --------------------------------- |
| CloudWatch Logs delivery failure | Swallow error (log driver handles) | Log may be lost; non-fatal        |
| EMF metric parse error           | Log raw JSON                       | Metric lost; non-fatal            |
| X-Ray tracing disabled           | Return no-op Segment               | Tracing unavailable; non-fatal    |
| Invalid log level in ENV         | Default to `INFO`                  | Degraded observability; non-fatal |

---

## MOD-012 — ClerkAuthMiddleware (Networkless Token Verification & Authorization)

**Parent ARCH**: ARCH-012 (**Parent SYS**: SYS-013)
**Type**: Stateful (per-request lifecycle; populates `req.user`)
**Runtime**: NestJS `AuthMiddleware` on ECS/Fargate (Node.js 22.x), ALB-fronted; reuses the shared `@kitchensink/clerk-verify` package. WebSocket `$connect` reuses the same verification in a Lambda authorizer (the only Lambda-authorizer surface).
**Target source file**: `packages/services/food-service/src/auth/clerk-auth.middleware.ts` (+ shared `@kitchensink/clerk-verify`)

> **Preserved verbatim-in-intent** (re-keyed `fdcId → id` where it appeared in comments only). Networkless
> Clerk verification (signature/`exp`/`nbf`/`azp` via public `CLERK_JWT_KEY`), fail-closed `401`, identity
> solely from the verified `sub`, `403` scope gate from `public_metadata`, M2M support, and the
> auth-layer DoS guards (per-source `401`-rate cap + verify-concurrency semaphore). REQ-035..042, REQ-047,
> REQ-050..053 trace here.

### 1. Algorithmic / Logic View

```
CLERK_JWT_KEY          = ENV.CLERK_JWT_KEY            // public PEM verification key (non-secret, REQ-042)
AUTHORIZED_PARTIES     = ENV.CLERK_AUTHORIZED_PARTIES // azp allowlist (REQ-037)

// Auth-layer DoS protection (REQ-052, SC-011): bound verify concurrency + per-source 401-rate cap.
VERIFY_CONCURRENCY_MAX = ENV.VERIFY_CONCURRENCY_MAX OR 64
SOURCE_401_RATE_MAX    = ENV.SOURCE_401_RATE_MAX OR 20
SOURCE_401_WINDOW_S    = 10
verifySemaphore        = Semaphore(VERIFY_CONCURRENCY_MAX)

FUNCTION sourceKey(req):
  RETURN albAttestedClientIp(req) OR req.connection.remoteAddr   // never a client-suppliable header (REQ-038)

// NestJS middleware — runs before EVERY route (REQ-035/REQ-050). Fail-closed (REQ-040).
FUNCTION use(req, res, next):
  token = extractBearer(req.headers.authorization)
  IF token IS NULL OR token == "":
    RETURN res.status(401).json({ error: "Missing bearer token" })

  src = sourceKey(req)
  IF Source401RateLimiter.isOverCap(src, SOURCE_401_RATE_MAX, SOURCE_401_WINDOW_S):
    RETURN res.status(429).json({ error: "Too many failed auth attempts" })   // load-shed (REQ-052)
  IF NOT verifySemaphore.tryAcquire():
    RETURN res.status(503).json({ error: "Auth verifier saturated" })          // shed not queue (REQ-052)

  TRY:
    claims = await verifyToken(token, { jwtKey: CLERK_JWT_KEY, authorizedParties: AUTHORIZED_PARTIES })  // networkless (REQ-036)
  CATCH AnyVerificationError:
    Source401RateLimiter.record(src, SOURCE_401_WINDOW_S)
    RETURN res.status(401).json({ error: "Invalid token" })                    // fail closed (REQ-040)
  FINALLY:
    verifySemaphore.release()

  DELETE req.headers["x-authorizer-context"]; DELETE req.headers["x-user-id"]   // ignore forged identity (REQ-038)
  req.user = {
    sub: claims.sub,                                  // human sub OR M2M service identity (REQ-047)
    azp: claims.azp,
    scopes: claims.public_metadata?.scopes OR [],     // operational scopes (REQ-039)
    permissions: claims.public_metadata?.permissions OR [],
    tokenClass: claims.sub.startsWith("svc_") ? "m2m" : "user"
  }
  next()

FUNCTION requireScope(requiredScope):                 // operational/admin endpoints only (REQ-039)
  RETURN (req, res, next) => requiredScope IN req.user.scopes ? next()
         : res.status(403).json({ error: "Insufficient scope" })               // 403 ≠ 401 (REQ-051)

FUNCTION authorizeConnect(event):                     // WS $connect authorizer (REQ-041/REQ-049)
  token = event.queryStringParameters?.token OR subprotocolToken(event)
  TRY:
    claims = await verifyToken(token, { jwtKey: CLERK_JWT_KEY, authorizedParties: AUTHORIZED_PARTIES })
  CATCH AnyVerificationError:
    RETURN deny()                                     // API GW WS → pinned 403 (REQ-049d)
  RETURN allow(principalId = claims.sub, context = { tokenExp: claims.exp })    // sub + exp → subscription set
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> AwaitingRequest
  AwaitingRequest --> ExtractingToken : request received
  ExtractingToken --> Rejected401 : no bearer token
  ExtractingToken --> LoadShedCheck : token present
  LoadShedCheck --> Shed429 : source over 401-rate cap (REQ-052)
  LoadShedCheck --> Shed503 : verify-concurrency exhausted (REQ-052)
  LoadShedCheck --> Verifying : within budget
  Verifying --> Rejected401 : signature/exp/nbf/azp fail or verify exception (fail closed)
  Verifying --> Authenticated : claims valid → req.user populated
  Authenticated --> Rejected403 : operational endpoint, scope missing
  Authenticated --> HandlerRuns : read endpoint or scope present
  Rejected401 --> [*]
  Rejected403 --> [*]
  Shed429 --> [*]
  Shed503 --> [*]
  HandlerRuns --> [*]
```

### 3. Internal Data Structures

| Name                  | Type                                                                                                 | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AuthenticatedCaller` | `{ sub: string, azp: string, scopes: string[], permissions: string[], tokenClass: 'user' \| 'm2m' }` | Verified principal on `req.user`; never persisted, never from a header (REQ-038)         |
| `VerifyOptions`       | `{ jwtKey: string, authorizedParties: string[] }`                                                    | Networkless `verifyToken` options — no secret key, no JWKS URL                           |
| `ClerkClaims`         | `{ sub, azp, exp, nbf, public_metadata?: { scopes?, permissions? } }`                                | Decoded + verified Clerk token claims                                                    |
| `Source401Counter`    | `Map<sourceKey, { count, windowStart }>`                                                             | Per-source rolling 401-rate counter for load-shed (REQ-052); source from ALB-attested IP |
| `VerifySemaphore`     | `Semaphore(VERIFY_CONCURRENCY_MAX)`                                                                  | Process-local cap on concurrent `verifyToken`; sheds (503) when exhausted (REQ-052)      |

### 4. Error Handling Return Codes

| Error Condition                                    | HTTP Status  | Response                                     | Action                                                  |
| -------------------------------------------------- | ------------ | -------------------------------------------- | ------------------------------------------------------- |
| Missing / empty bearer token                       | 401          | `{ error: "Missing bearer token" }`          | Fail closed; no handler, no enqueue (REQ-035)           |
| Invalid signature / `exp` / `nbf` / `azp`          | 401          | `{ error: "Invalid token" }`                 | Fail closed (REQ-037/REQ-040)                           |
| Missing / malformed `CLERK_JWT_KEY` config         | 401          | `{ error: "Invalid token" }`                 | Fail closed — never proceed unauthenticated (REQ-040)   |
| Authenticated but scope missing (operational)      | 403          | `{ error: "Insufficient scope" }`            | Distinct from 401; precedence 401→403 (REQ-039/REQ-051) |
| Client-supplied `x-authorizer-context`/`x-user-id` | —            | Header stripped, ignored                     | Identity only from verified `sub` (REQ-038)             |
| WebSocket `$connect` token invalid                 | 403 (pinned) | API GW deny policy                           | Reject before connection established (REQ-049d)         |
| Source over per-source 401-rate cap                | 429          | `{ error: "Too many failed auth attempts" }` | Load-shed BEFORE any verify (REQ-052; protects SC-011)  |
| Verify-concurrency cap exhausted                   | 503          | `{ error: "Auth verifier saturated" }`       | Shed not queue (REQ-052)                                |

---

## MOD-013 — DemotionAndFairness (Per-`sub` Demotion, Distinct-Requester Demand & Backpressure)

**Parent ARCH**: ARCH-012 (**Parent SYS**: SYS-013)
**Type**: Stateful (state in PostgreSQL: `fetch_queue`, `fetch_requesters`; per-`sub` pending count is derived, not stored)
**Runtime**: NestJS service on ECS/Fargate invoked inline after MOD-012, **before** `INSERT INTO fetch_queue`; the demotion priority is computed at **drain time** by the queue scorer (ARCH-004)
**Target source file**: `packages/services/food-service/src/auth/demotion-and-fairness.service.ts`

> **Preserved (re-keyed `fdcId → id`).** Fairness is **demotion, not rejection** (REQ-043): a `sub` with
>
> > 50 pending `fetch_queue` items has its rows ranked to the back (dynamic at drain time; no `429`).
> > Distinct-requester demand counting (REQ-044), batch cap `400` (REQ-045), and backpressure/circuit-breaker
> > `503` (REQ-046) are unchanged. Ops names `admitEnqueue`/`isDemoted` are kept (architecture-design
> > requires them). No `QUOTA_PER_HOUR`, no `429` on this path.

### 1. Algorithmic / Logic View

```
MAX_BATCH_IDS    = 100          // client-facing batch cap (REQ-045) — distinct from USDA 20/call (REQ-023)
DEMOTE_THRESHOLD = 50           // a sub with > 50 pending items is demoted to the back (REQ-043)
MAX_QUEUE_DEPTH  = 10000        // enforced fetch_queue ceiling (REQ-046)
PRIORITY_CAP     = 1            // a single sub contributes at most once to demand (REQ-044)

FUNCTION enforceBatchCap(ids):                        // 400 at input-validation tier (REQ-045/REQ-051)
  IF length(ids) > MAX_BATCH_IDS:
    THROW BatchTooLargeError(400, "Batch exceeds max of 100 ids")   // enqueue NOTHING

FUNCTION checkBackpressure():                         // 503 — fail closed (REQ-046)
  IF CircuitBreaker.state == "open":
    THROW BackpressureError(503, "source circuit open")
  IF FetchQueue.depth() >= MAX_QUEUE_DEPTH:
    THROW BackpressureError(503, "Fetch queue saturated")

FUNCTION recordDemand(sub, foodId):                   // distinct-requester demand (REQ-044)
  inserted = FetchRequesters.upsert({ foodId, sub, requestedAt: now() })   // PK(food_id, sub) idempotent
  IF inserted:
    FetchQueue.bumpDemand(foodId, PRIORITY_CAP)        // capped; aging applied at drain time (MOD-004)

FUNCTION pendingCountForSub(sub):                     // derived, live (no stored counter, no window)
  // SELECT count(*) FROM fetch_queue q JOIN fetch_requesters r USING (food_id)
  //   WHERE r.sub = $1 AND q.status IN ('pending','in_flight')
  RETURN Postgres.query(PENDING_COUNT_SQL, [sub]).count

FUNCTION isDemoted(sub):                              // > 50 pending → rank to back (REQ-043)
  RETURN pendingCountForSub(sub) > DEMOTE_THRESHOLD

FUNCTION drainPriorityTier(foodId):                  // consulted by MOD-003.leaseNext ORDER BY
  // demoted → 1 (back), normal → 0 (front); recomputed every drain pass from live pending count
  sub = FetchQueue.requestedBy(foodId)
  RETURN isDemoted(sub) ? 1 : 0

FUNCTION admitEnqueue(reqUser, ids):                  // invoked by ARCH-001 before publishFoodRequested
  enforceBatchCap(ids)                                 // 400
  checkBackpressure()                                  // 503
  FOR EACH id IN ids:
    recordDemand(reqUser.sub, id)
  RETURN { admitted: true }                            // never rejected for a personal quota (REQ-043)
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Admitting
  Admitting --> Rejected400 : batch > 100 ids (REQ-045)
  Admitting --> CheckingBackpressure : batch ok
  CheckingBackpressure --> Rejected503 : queue full OR circuit open (REQ-046)
  CheckingBackpressure --> RecordingDemand : capacity available
  RecordingDemand --> Admitted : distinct-requester upsert + capped demand (REQ-044); always admitted (no 429)
  Admitted --> [*]
  Rejected400 --> [*]
  Rejected503 --> [*]

  state "Drain-time scoring (ARCH-004)" as DrainScoring {
    [*] --> EvaluatingPendingCount
    EvaluatingPendingCount --> NormalPriority : sub pending ≤ 50 (front tier)
    EvaluatingPendingCount --> Demoted : sub pending > 50 → ranked to back (REQ-043)
    Demoted --> NormalPriority : pending drops ≤ 50 → auto re-promote (dynamic, REQ-043)
    NormalPriority --> Demoted : pending rises > 50
  }
```

### 3. Internal Data Structures

| Name               | Type                                                                              | Description                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `fetch_queue`      | table `{ food_id, status, request_count, first_requested, ... }`                  | Pending work (keyed on food `id`); the per-`sub` pending count is derived by joining to `fetch_requesters` (REQ-043) |
| `fetch_requesters` | table `{ food_id: string, sub: string, requested_at }` (PK `food_id`+`sub`)       | Distinct-requester set; PK makes repeat adds idempotent (REQ-044) + WS recipient set (REQ-041)                       |
| `PendingCount`     | `{ sub: string, count: number }`                                                  | Derived (not stored) per-`sub` pending count; drives dynamic demotion/re-promotion (REQ-043)                         |
| `FairnessConfig`   | `{ demoteThreshold: 50, maxBatchIds: 100, maxQueueDepth: 10000, priorityCap: 1 }` | Static fairness/backpressure thresholds                                                                              |

### 4. Error Handling Return Codes

| Error Condition                         | Error Type / Status        | Action                                                                               |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| Batch size > 100 `id`s                  | `BatchTooLargeError` / 400 | Reject; enqueue nothing (REQ-045)                                                    |
| `fetch_queue` depth ≥ MAX_QUEUE_DEPTH   | `BackpressureError` / 503  | Fail closed; do not grow queue (REQ-046)                                             |
| Source circuit breaker open             | `BackpressureError` / 503  | Fail closed; jittered drain on recovery (REQ-046)                                    |
| `sub` has > 50 pending items            | — (admitted, demoted)      | NO 429 — request accepted; the sub's rows ranked to the back at drain time (REQ-043) |
| `sub` pending count drops to ≤ 50       | — (auto re-promote)        | Demotion lifts dynamically at the next drain pass (REQ-043)                          |
| Repeat add for same `(id, sub)`         | — (idempotent upsert)      | No double demand increment; priority capped (REQ-044)                                |
| Postgres (queue/requesters) unavailable | `BackpressureError` / 503  | Fail closed — never default-open the enqueue path                                    |

---

## MOD-014 — AsyncProducerAuthz (Async-Producer Provenance & Least-Privilege Enforcement)

**Parent ARCH**: ARCH-012 (**Parent SYS**: SYS-013)
**Type**: Stateful (per-event validation in the consumer/worker; reads IAM-principal allowlist + event attributes)
**Runtime**: Invoked inline in the Fargate consumer worker (ARCH-004) before any source fetch or `INSERT INTO fetch_queue`, and at the EventBridge/`fetch_queue` ingress boundary
**Target source file**: `packages/services/food-service/src/auth/async-producer-authz.service.ts`

> **Preserved (generalized USDA → external source).** US-0's guarantee — _"no unauthenticated path may
> drive external source consumption"_ — must hold for async/internal producers (EventBridge, cron,
> bulk-sync, recipe import), not only the synchronous HTTP edge (REQ-042/REQ-048-analog). Two layers:
> least-privilege IAM principal allowlist + event-provenance (`requestedBy`) validation. Every deny is
> fail-closed.

### 1. Algorithmic / Logic View

```
ALLOWED_PRODUCER_PRINCIPALS = ENV.ALLOWED_PRODUCER_PRINCIPAL_ARNS   // consumer / import / scheduler roles
ALLOWED_DETAIL_TYPES        = ["FoodRequested", "FoodBatchRequested", "IngestionScheduled"]
SERVICE_PRINCIPAL_PREFIX    = "svc_"

FUNCTION assertProducerPrincipal(invocationContext):
  principalArn = invocationContext.callerArn          // AWS-attested, not client-suppliable
  IF principalArn NOT IN ALLOWED_PRODUCER_PRINCIPALS:
    THROW UnauthorizedProducerError("Producer principal not on least-privilege allowlist", principalArn)

FUNCTION assertProvenance(event):
  IF event.DetailType NOT IN ALLOWED_DETAIL_TYPES:
    THROW UnauthorizedProducerError("Unrecognized detail-type", event.DetailType)
  requestedBy = JSON.parse(event.Detail).requestedBy
  IF requestedBy IS NULL OR requestedBy == "" OR requestedBy == "system":
    THROW ProvenanceError("Missing/anonymous requestedBy — no unauthenticated producer path")
  isNamedService = startsWith(requestedBy, SERVICE_PRINCIPAL_PREFIX)
  isHumanSub     = isClerkSub(requestedBy)
  IF NOT (isNamedService OR isHumanSub):
    THROW ProvenanceError("requestedBy is neither an authenticated sub nor a named service principal")
  RETURN { requestedBy, requesterClass: isNamedService ? "service" : "user" }

FUNCTION admitAsyncEvent(invocationContext, event):  // consumer ingress, before MOD-005 / fetch / enqueue
  assertProducerPrincipal(invocationContext)          // layer 1: IAM least-privilege
  prov = assertProvenance(event)                      // layer 2: authenticated provenance
  RETURN { admitted: true, requestedBy: prov.requestedBy, requesterClass: prov.requesterClass }

FUNCTION assertEnqueueProvenance(dbSessionRole, requestedBy):  // direct fetch_queue INSERT guard (REQ-032/FR-012)
  IF dbSessionRole NOT IN ALLOWED_PRODUCER_PRINCIPALS:
    THROW UnauthorizedProducerError("DB session role not allowlisted for fetch_queue INSERT", dbSessionRole)
  IF requestedBy IS NULL OR requestedBy == "" OR requestedBy == "system":
    THROW ProvenanceError("fetch_queue INSERT requires authenticated requestedBy")
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> ReceivingAsyncEvent
  ReceivingAsyncEvent --> CheckingProducerPrincipal : EventBridge/queue/insert ingress
  CheckingProducerPrincipal --> RejectedUnauthorizedProducer : principal not on least-privilege allowlist
  CheckingProducerPrincipal --> CheckingProvenance : principal allowlisted
  CheckingProvenance --> RejectedProvenance : requestedBy missing / 'system' / unrecognized detail-type
  CheckingProvenance --> Admitted : requestedBy is authenticated sub OR named service principal
  Admitted --> [*] : proceed to rolling-window limiter (MOD-005) → fetch / enqueue (ARCH-004)
  RejectedUnauthorizedProducer --> [*] : event dropped + alarmed; no fetch, no enqueue
  RejectedProvenance --> [*] : event dropped + alarmed; no fetch, no enqueue
```

### 3. Internal Data Structures

| Name                | Type                                                                                                       | Description                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ProducerAllowlist` | `Set<string>` (IAM principal ARNs)                                                                         | Named least-privilege producers granted `events:PutEvents` / `fetch_queue` INSERT; IaC-provisioned, config-loaded |
| `InvocationContext` | `{ callerArn: string, eventSource: string }`                                                               | AWS-attested delivery identity (worker exec role or DB session role); never a forgeable event-body field          |
| `EventProvenance`   | `{ requestedBy: string, requesterClass: 'user' \| 'service' }`                                             | Validated provenance carried from the synchronous edge (MOD-012 `sub`) or a named service principal               |
| `AsyncAuthzConfig`  | `{ allowedProducerPrincipalArns: string[], allowedDetailTypes: string[], servicePrincipalPrefix: 'svc_' }` | Static least-privilege configuration                                                                              |

### 4. Error Handling Return Codes

| Error Condition                                         | Error Type                  | Action                                                                          |
| ------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Delivering IAM principal not on allowlist               | `UnauthorizedProducerError` | Drop event; no fetch, no enqueue; CloudWatch alarm                              |
| `requestedBy` missing / empty / `'system'`              | `ProvenanceError`           | Drop event; no fetch, no enqueue; alarm — closes the unauthenticated async path |
| `requestedBy` neither authenticated `sub` nor named svc | `ProvenanceError`           | Drop event; no fetch, no enqueue; alarm                                         |
| Unrecognized `detail-type` on the bus                   | `UnauthorizedProducerError` | Drop event; no work performed                                                   |
| `fetch_queue` INSERT under non-allowlisted DB role      | `UnauthorizedProducerError` | Reject INSERT; least-privilege DB grants are the primary control                |
| Allowlist config missing/empty at boot                  | `ProducerConfigError`       | Fail closed — refuse to process async events rather than default-open           |

---

## MOD-015 — SourceAdapterRegistry (Pluggable Source-Adapter Registry & Interface)

**Parent ARCH**: ARCH-013 (**Parent SYS**: SYS-014)
**Type**: Stateful (in-process registry of wired adapters; holds the static source-priority order)
**Runtime**: In-process within the Fargate worker / NestJS service (Node.js 22.x)
**Target source file**: `packages/services/food-service/src/sources/source-adapter.registry.ts` (+ the `FoodSourceAdapter` interface)

> **(New.)** The pluggable registry + the `FoodSourceAdapter` interface. ARCH-004 iterates it to fan out
> by name. **The adapter boundary that confines `fdcId`/USDA** — MOD-008 is the only registered adapter
> today and the only place a source-native key appears (mapped to `external_key`). Adding a source is
> additive (append an adapter + a `source` enum value) and never touches the canonical schema (REQ-054).
> Holds the static source-priority order (`['usda']` default) the merge engine (MOD-017) consults.

### 1. Algorithmic / Logic View

```typescript
/** A pluggable food source. No source-specific structure leaks past this boundary (REQ-054). */
interface FoodSourceAdapter {
    readonly source: FoodSourceId; // e.g. 'usda'
    searchByName(name: string): Promise<SourceCandidate[]>; // candidates (source + that source's key)
    fetchByKey(externalKey: string): Promise<CanonicalCandidate>; // fetch + mapToCanonical + validate (MOD-021)
    // mapToCanonical is internal to fetchByKey; for USDA it does the fdcId→external_key mapping (MOD-008).
}
```

```
// Static priority order — higher index = higher priority. USDA is default highest until reconfigured.
PRIORITY_ORDER = ['usda']                            // additive; new sources append (REQ-051)
adapters       = Map<FoodSourceId, FoodSourceAdapter>()

FUNCTION register(adapter):                          // additive — never touches the canonical schema (REQ-054)
  IF adapters.has(adapter.source):
    THROW DuplicateSourceError(adapter.source)
  adapters.set(adapter.source, adapter)

FUNCTION allAdapters(): FoodSourceAdapter[]
  RETURN PRIORITY_ORDER.filter(s => adapters.has(s)).map(s => adapters.get(s))   // wired, in priority order

FUNCTION priorityOf(source): number                  // consulted by the merge engine (MOD-017)
  idx = PRIORITY_ORDER.indexOf(source)
  IF idx < 0: THROW UnknownSourceError(source)
  RETURN PRIORITY_ORDER.length - idx                  // 'usda' default highest
```

At bootstrap, `@kitchensink/usda-client` (MOD-008) is the only `register(...)` call. A second source is
added by implementing `FoodSourceAdapter`, appending a `food_source` enum value, and one `register(...)` —
no canonical schema, DAO, service, or API change (REQ-054, golden-record-now decision REQ-050/REQ-CN-007).

### 2. State Machine View

`N/A Stateless` — the registry is populated once at bootstrap and read-only thereafter; lookups are pure. (No per-request state machine.)

### 3. Internal Data Structures

| Name                | Type                                                         | Description                                                                               |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `FoodSourceAdapter` | `interface` (above)                                          | The common adapter contract; the only structure crossing the source boundary (REQ-IF-012) |
| `FoodSourceId`      | `'usda'` (extensible union backed by the `food_source` enum) | Source identifier; additive — new sources append a value                                  |
| `PriorityOrder`     | `FoodSourceId[]` (`['usda']`)                                | Static source-priority order consulted by the merge engine (REQ-051)                      |
| `AdapterMap`        | `Map<FoodSourceId, FoodSourceAdapter>`                       | Wired-adapter registry (USDA only today)                                                  |

### 4. Error Handling Return Codes

| Error Condition                    | Error Type             | Action                                                         |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `register` a duplicate `source`    | `DuplicateSourceError` | Throw at bootstrap; misconfiguration surfaced before serving   |
| `priorityOf` an unknown source     | `UnknownSourceError`   | Throw; a source must be in `PRIORITY_ORDER` to participate     |
| An adapter's `searchByName` throws | Propagated to MOD-004  | That source contributes nothing; fan-out continues (REQ-050)   |
| No adapters wired (empty registry) | `NoAdaptersError`      | Fail closed at boot — refuse to start a worker with no sources |

---

## MOD-016 — FoodDaoRepository (DAO / Repository Persistence Seam)

**Parent ARCH**: ARCH-014 (**Parent SYS**: SYS-018)
**Type**: Stateless (per-aggregate DAOs behind the `FoodsRepository` seam; advisory-lock dedup is transactional)
**Runtime**: In-process Drizzle DAO layer over `kitchensink_food` (NestJS service + worker, Node.js 22.x)
**Target source file**: `packages/services/food-service/src/database/foods.repository.ts` (+ per-aggregate DAOs)

> **(New.)** The DAO/repository persistence seam — per-aggregate DAOs (`FoodDao`, `FoodSourcesDao`,
> `NutrientDao`, `FoodNutrientsDao`, `FoodPortionsDao`, `FoodFieldProvenanceDao`, `FoodCategoryDao`) behind
> the `FoodsRepository`, over MOD-006. **All persistence goes through this layer** (REQ-054) — no
> source-specific SQL in services/worker. Owns **add-by-name dedup**: the normalized-name unique key + a
> short `pg_advisory_xact_lock` so concurrent adds collapse to one row + `id`, and the idempotent
> `fetch_queue` `INSERT … ON CONFLICT (food_id)`. Mirrors the identity service's `FoodsRepository` seam +
> `newFoodId()` (ULID) + the `pg_advisory_xact_lock` dedup pattern.

### 1. Algorithmic / Logic View

```
// Add-by-name dedup (REQ-005/REQ-013). A short advisory lock keyed on the normalized name hash collapses
// concurrent adds to one row + id; the UNIQUE(normalized_name) index is the durable backstop.
FUNCTION createByName(normalizedName, displayName): { id, created }
  RETURN db.transaction(tx => {
    // Serialize concurrent adds of the SAME name only (lock key = hash of the normalized name).
    tx.execute("SELECT pg_advisory_xact_lock($1)", [hashToBigint(normalizedName)])
    existing = tx.query("SELECT id FROM food WHERE normalized_name = $1", [normalizedName])
    IF existing IS NOT NULL:
      RETURN { id: existing.id, created: false }        // collapse to the in-flight/existing row
    id = newFoodId()                                    // ULID, named `id` (mirrors newUserId — REQ-045)
    tx.query("""INSERT INTO food (id, name, normalized_name, status)
                VALUES ($1, $2, $3, 'PENDING')""", [id, displayName, normalizedName])
    RETURN { id, created: true }
  })

FUNCTION findById(id): GoldenRecord | null
  RETURN FoodPostgresRepository.findGoldenRecord(id)    // MOD-006

FUNCTION getName(id): string | null
  RETURN FoodDao.selectName(id)                          // the add-by-name query used by the worker

FUNCTION searchByName(query): { id, name, score }[]
  RETURN FoodPostgresRepository.searchFoods(query)       // MOD-006 (pg_trgm); never a source call

// Persist a merged golden record atomically across the normalized tables, with provenance (MOD-019).
FUNCTION upsertGoldenRecord(foodId, golden, outcome): { success, status }
  RETURN db.transaction(tx => {
    FoodDao.updateScalars(tx, foodId, golden.scalars)                  // food.* golden scalars
    FOR EACH cand IN golden.contributingSources:
      sourceId = FoodSourcesDao.upsertCrosswalk(tx, foodId, cand.source, cand.externalKey, cand.itemVersion)  // UNIQUE(source, external_key)
      cand.sourceId = sourceId
    FoodNutrientsDao.replaceForFood(tx, foodId, golden.nutrients)      // (food_id, nutrient_id, amount, basis, source_id)
    FoodPortionsDao.replaceForFood(tx, foodId, golden.portions)        // (food_id, label, gram_weight, source_id)
    ProvenanceStore.recordScalarFields(tx, foodId, golden.fieldProvenance)  // MOD-019 → food_field_provenance
    FoodCategoryDao.assign(tx, foodId, golden.categories)
    status = outcome == 'UNRESOLVED' ? 'UNRESOLVED' : 'RESOLVED'
    FoodDao.updateStatus(tx, foodId, status)
    RETURN { success: true, status }
  })

FUNCTION updateStatus(id, status, tombstonedAt?): { success }
  RETURN FoodDao.updateStatus(id, status, tombstonedAt)  // PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED
```

### 2. State Machine View

`N/A Stateless` — the DAO seam executes discrete transactions; `createByName`/`upsertGoldenRecord` are atomic units with no retained in-process state. (The advisory lock lives for the transaction only.)

### 3. Internal Data Structures

| Name                 | Type                                                                                                                               | Description                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `FoodsRepository`    | facade over `{ FoodDao, FoodSourcesDao, NutrientDao, FoodNutrientsDao, FoodPortionsDao, FoodFieldProvenanceDao, FoodCategoryDao }` | The single persistence seam (REQ-054)                              |
| `CreateByNameResult` | `{ id: string, created: boolean }`                                                                                                 | `created=false` ⇒ collapsed to an existing/in-flight row (REQ-005) |
| `GoldenRecordWrite`  | `{ scalars, nutrients, portions, fieldProvenance, contributingSources, categories }`                                               | The merge engine's output, persisted atomically                    |
| `AdvisoryLockKey`    | `bigint` (hash of `normalized_name`)                                                                                               | `pg_advisory_xact_lock` key — serializes same-name adds only       |

### 4. Error Handling Return Codes

| Error Condition                               | Error Type                | Action                                                                      |
| --------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| Concurrent add for the same normalized name   | — (advisory lock)         | Second caller blocks briefly, then collapses to the existing `id` (REQ-005) |
| `UNIQUE(normalized_name)` race (lock skipped) | Handled by index conflict | Re-select the existing row; return `{ created: false }`                     |
| Transaction failure mid-`upsertGoldenRecord`  | `PostgresConnectionError` | Whole transaction rolls back; MOD-004 re-queues with backoff                |
| `id` not found (`findById`/`getName`)         | —                         | Return `null` (not an error)                                                |
| Source-specific SQL attempted outside a DAO   | — (design constraint)     | Forbidden by REQ-054; all SQL is in a DAO, none in services/worker          |

---

## MOD-017 — GoldenRecordMergeEngine (Field-Level Cross-Source Merge)

**Parent ARCH**: ARCH-015 (**Parent SYS**: SYS-015)
**Type**: Stateless (deterministic pure function over normalized candidates)
**Runtime**: In-process within the Fargate worker (Node.js 22.x), invoked by MOD-004 after candidates are normalized
**Target source file**: `packages/services/food-service/src/merge/golden-record-merge.engine.ts`

> **(New.)** Field-level cross-source merge. Rules (REQ-051): **presence beats absence**; identity/short
> fields (`name`, `brand_owner`, `brand_name`) → higher-priority source (NOT longest); free-text
> (`description`, `ingredients`) → longer-wins; nutrients normalized to **per-100g** before any blend,
> conflicts → higher-priority source with `food_nutrients.source_id` recording the winner. Emits the
> golden record + the `RESOLVED`/`UNRESOLVED` outcome; records winners' provenance via MOD-019 (through
> MOD-016/MOD-006). Source priority comes from MOD-015 `priorityOf`.

### 1. Algorithmic / Logic View

```
// Deterministic, side-effect-free. Input: pre-merge-deduped candidates from MOD-004. Output: golden record.
FUNCTION merge(candidates: CanonicalCandidate[]): MergeResult
  IF length(candidates) == 0:
    RETURN { goldenRecord: null, outcome: 'NOT_FOUND' }      // (worker handles tombstone)

  // If pre-merge could not confidently collapse to one logical item → UNRESOLVED (REQ-048/REQ-RES-3).
  IF NOT confidentlyCollapsible(candidates):
    RETURN { goldenRecord: partial(candidates), outcome: 'UNRESOLVED', candidateSet: candidates }

  golden = { scalars: {}, nutrients: {}, portions: [], fieldProvenance: {}, contributingSources: [] }

  // --- Identity/short scalar fields: higher-priority source wins (NOT longest) (REQ-051) ---
  FOR EACH field IN ['name', 'brand_owner', 'brand_name', 'kind']:
    winner = highestPriorityWithValue(candidates, field)     // presence beats absence
    IF winner IS NOT NULL:
      golden.scalars[field]          = winner.value
      golden.fieldProvenance[field]  = winner.source          // → food_field_provenance (MOD-019)

  // --- Free-text fields: longer value wins (REQ-051) ---
  FOR EACH field IN ['description', 'ingredients']:
    winner = longestWithValue(candidates, field)             // presence beats absence; ties → higher priority
    IF winner IS NOT NULL:
      golden.scalars[field]          = winner.value
      golden.fieldProvenance[field]  = winner.source

  // --- Nutrients: normalize to per-100g FIRST, then higher-priority source wins per nutrient (REQ-051) ---
  FOR EACH nutrientCode IN union(candidates.nutrients.code):
    values = candidates
      .map(c => normalizeToPer100g(c.nutrientFor(nutrientCode)))   // basis normalization before any blend
      .filter(v => v IS NOT NULL)                                  // presence beats absence
    IF length(values) > 0:
      winner = maxBy(values, v => priorityOf(v.source))            // MOD-015 priority; conflict → higher source
      golden.nutrients[nutrientCode] = { amount: winner.amount, basis: 'per_100g', source: winner.source }

  // --- Portions: union across sources, each carrying its own source_id provenance ---
  golden.portions = candidates.flatMap(c => c.portions.map(p => ({ ...p, source: c.source })))

  golden.contributingSources = distinct(candidates.map(c => ({ source: c.source, externalKey: c.externalKey, itemVersion: c.itemVersion })))
  RETURN { goldenRecord: golden, outcome: 'RESOLVED' }

FUNCTION highestPriorityWithValue(candidates, field):
  withValue = candidates.filter(c => c[field] IS NOT NULL AND c[field] != "")
  RETURN withValue IS EMPTY ? null : maxBy(withValue, c => SourceAdapterRegistry.priorityOf(c.source))  // MOD-015

FUNCTION longestWithValue(candidates, field):
  withValue = candidates.filter(c => c[field] IS NOT NULL AND c[field] != "")
  RETURN withValue IS EMPTY ? null : maxBy(withValue, c => length(c[field]))   // ties → higher priority

FUNCTION normalizeToPer100g(nutrient):
  IF nutrient IS NULL: RETURN null
  IF nutrient.basis == 'per_100g': RETURN nutrient
  RETURN { ...nutrient, amount: nutrient.amount * (100 / nutrient.servingGrams), basis: 'per_100g' }  // SC-008 fidelity
```

### 2. State Machine View

`N/A Stateless` — `merge` is a deterministic pure function; the same candidate set always yields the same golden record + outcome. No retained state, no I/O. (Persistence and provenance writes are done by the caller via MOD-016/MOD-019.)

### 3. Internal Data Structures

| Name                 | Type                                                                                                                                     | Description                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `CanonicalCandidate` | `{ source, externalKey, name, kind, brandOwner, description, nutrients: NutrientValue[], portions, itemVersion }`                        | A validated, source-agnostic candidate (no `fdcId`)               |
| `GoldenRecord`       | `{ scalars, nutrients: Record<code, { amount, basis, source }>, portions, fieldProvenance: Record<field, source>, contributingSources }` | The assembled cross-source record                                 |
| `MergeResult`        | `{ goldenRecord: GoldenRecord \| null, outcome: 'RESOLVED' \| 'UNRESOLVED' \| 'NOT_FOUND', candidateSet? }`                              | Deterministic merge outcome                                       |
| `NutrientValue`      | `{ code, name, unit, amount, basis: 'per_100g' \| 'per_serving', source }`                                                               | A single source's nutrient value before/after basis normalization |

### 4. Error Handling Return Codes

| Error Condition                                             | Error Type / Outcome           | Action                                                                     |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| Empty candidate set                                         | outcome `NOT_FOUND`            | Worker tombstones the food (REQ-025)                                       |
| Non-collapsible multi-candidate set                         | outcome `UNRESOLVED`           | Candidate set surfaced via MOD-018; food `UNRESOLVED` (REQ-048)            |
| Nutrient with missing serving basis (per_serving, no grams) | drop that value                | Cannot normalize to per-100g → presence treated as absence for it (SC-008) |
| Conflicting nutrient values, equal priority                 | deterministic tiebreak         | First in `PRIORITY_ORDER` wins; recorded via `source_id` (REQ-051)         |
| Unknown source in a candidate                               | `UnknownSourceError` (MOD-015) | Surfaces a registry misconfiguration; worker fails the row closed          |

---

## MOD-018 — CandidateResolutionService (`/candidates` + PATCH-Resolve)

**Parent ARCH**: ARCH-016 (**Parent SYS**: SYS-016)
**Type**: Stateful (per-request; validates against the food's own candidate set, then drives a merge)
**Runtime**: In-process NestJS provider on ECS/Fargate (Node.js 22.x), invoked by ARCH-001
**Target source file**: `packages/services/food-service/src/candidates/candidate-resolution.service.ts`

> **(New.)** Cross-source disambiguation. `getCandidates(id)` lists candidates for an `UNRESOLVED` food
> (each with its `source` + item key); `resolve(id, candidateIds)` **validates each pick belongs to the
> food's own candidate set** (out-of-set → `400`/`409`, status unchanged), drives the merge (MOD-017),
> stores the pick as **ordinary provenance** (MOD-019), and moves the food to `RESOLVED` (REQ-049). The
> candidate set is the per-source candidates retained for the `UNRESOLVED` food.

### 1. Algorithmic / Logic View

```
FUNCTION getCandidates(id): Candidate[]
  food = FoodDaoRepository.findById(id)               // MOD-016
  IF food IS NULL: THROW NotFoundError(404)
  IF food.status != 'UNRESOLVED':
    RETURN []                                          // candidates only meaningful while UNRESOLVED
  // Candidates retained for this food during fan-out (one per surviving per-source candidate).
  rows = CandidateStore.forFood(id)                    // { candidateId, source, externalKey, name, summary }
  RETURN rows.map(r => ({ candidateId: r.candidateId, source: r.source, externalKey: r.externalKey, name: r.name, summary: r.summary }))

FUNCTION resolve(id, candidateIds): { id, status }
  food = FoodDaoRepository.findById(id)
  IF food IS NULL: THROW NotFoundError(404)
  ownSet = CandidateStore.idsForFood(id)              // this food's candidate set

  // Candidate-set validation: every pick MUST belong to THIS food (REQ-049). Prevents cross-food contamination.
  FOR EACH cid IN candidateIds:
    IF cid NOT IN ownSet:
      THROW CandidateMismatchError(409, "Candidate not in this food's set")   // status unchanged

  selected = CandidateStore.fetch(id, candidateIds)   // the chosen CanonicalCandidate(s)
  result   = GoldenRecordMergeEngine.merge(selected)  // MOD-017 — user pick drives the merge
  // The user's manual pick is stored as ORDINARY provenance (no special-casing) (REQ-052).
  FoodDaoRepository.upsertGoldenRecord(id, result.goldenRecord, 'RESOLVED')   // MOD-016 → MOD-019 provenance
  CandidateStore.clear(id)                            // candidate set consumed
  RETURN { id, status: 'RESOLVED' }
```

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> ListingCandidates : GET /{id}/candidates
  Idle --> Resolving : PATCH /{id} { candidateIds }
  ListingCandidates --> Responded404 : no row
  ListingCandidates --> RespondedList : UNRESOLVED → candidate list (or [] if not UNRESOLVED)
  Resolving --> Responded404 : no row
  Resolving --> Rejected409 : a pick is NOT in this food's candidate set (status unchanged, REQ-049)
  Resolving --> Merging : all picks in-set
  Merging --> Resolved : merge → upsert golden record + user-pick provenance → status RESOLVED
  RespondedList --> [*]
  Responded404 --> [*]
  Rejected409 --> [*]
  Resolved --> [*]
```

### 3. Internal Data Structures

| Name            | Type                                                                                                 | Description                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Candidate`     | `{ candidateId: string, source: FoodSourceId, externalKey: string, name: string, summary?: string }` | One per-source candidate surfaced for an `UNRESOLVED` food (REQ-IF-010)       |
| `CandidateSet`  | `Set<candidateId>` for a food `id`                                                                   | The food's own candidate set; the membership check guards `resolve` (REQ-049) |
| `ResolveDto`    | `{ candidateIds: string[] }`                                                                         | `PATCH /v1/foods/{id}` body                                                   |
| `ResolveResult` | `{ id: string, status: 'RESOLVED' }`                                                                 | Successful resolve outcome                                                    |

### 4. Error Handling Return Codes

| Error Condition                            | Error Type / Status            | Action                                                           |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| No row for `id`                            | `NotFoundError` / 404          | Return 404                                                       |
| Candidate not in this food's set           | `CandidateMismatchError` / 409 | Reject; food `status` unchanged (REQ-049)                        |
| `getCandidates` on a non-`UNRESOLVED` food | — / 200                        | Return `[]` (no candidates to disambiguate)                      |
| Merge yields `UNRESOLVED` again            | — (defensive)                  | Should not occur for a user pick; if it does, leave `UNRESOLVED` |
| Persist failure during resolve             | `PostgresConnectionError`      | Transaction rolls back; status unchanged; caller retries         |

---

## MOD-019 — ProvenanceStore (Per-Field / Value-Grain Provenance)

**Parent ARCH**: ARCH-017 (**Parent SYS**: SYS-017)
**Type**: Stateless (writes through the DAO layer; provenance is value-grain, not payload)
**Runtime**: In-process within the worker / candidate service (Node.js 22.x), written via MOD-016 → MOD-006
**Target source file**: `packages/services/food-service/src/provenance/provenance-store.service.ts`

> **(New.)** Per-field provenance at the value grain: a `source_id` reference column on
> `food_nutrients`/`food_portions`/`food_category_assignment` and the thin
> `food_field_provenance(food_id, field, source_id)` side-table for scalar fields (controlled `field`
> enum). "Which fields came from source X" is one query (REQ-052/REQ-029). **No verbatim payload, no EAV.**
> Written by MOD-017/MOD-018 through MOD-016.

### 1. Algorithmic / Logic View

```
// Controlled field enum (no EAV value column): name|description|kind|brand_owner|brand_name|barcode (REQ-052).
FUNCTION recordScalarFields(tx, foodId, fieldProvenance: Record<field, source>):
  FOR EACH (field, source) IN fieldProvenance:
    sourceId = FoodSourcesDao.idFor(tx, foodId, source)         // the crosswalk row id = source_id
    tx.query("""INSERT INTO food_field_provenance (food_id, field, source_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (food_id, field) DO UPDATE SET source_id = EXCLUDED.source_id""",
             [foodId, field, sourceId])

// Value-grain provenance is the source_id column written inline by FoodNutrientsDao/FoodPortionsDao
// during upsertGoldenRecord (MOD-016); this records the controlled scalar fields. No payload stored.

// "Which fields came from source X" — single query (REQ-029/R7), no payload read because none is stored.
FUNCTION fieldsFromSource(foodId, source): { field: string }[]
  RETURN Postgres.query("""
    SELECT 'field:' || field AS field FROM food_field_provenance ffp
      JOIN food_sources fs ON fs.id = ffp.source_id
      WHERE ffp.food_id = $1 AND fs.source = $2
    UNION ALL
    SELECT 'nutrient:' || fn.nutrient_id FROM food_nutrients fn
      JOIN food_sources fs ON fs.id = fn.source_id
      WHERE fn.food_id = $1 AND fs.source = $2
    UNION ALL
    SELECT 'portion:' || fp.id FROM food_portions fp
      JOIN food_sources fs ON fs.id = fp.source_id
      WHERE fp.food_id = $1 AND fs.source = $2
  """, [foodId, source])
```

### 2. State Machine View

`N/A Stateless` — provenance writes are idempotent upserts within the caller's transaction; reads are a single `UNION` query. No retained in-process state.

### 3. Internal Data Structures

| Name                    | Type                                                                     | Description                                                                                     |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `food_field_provenance` | table `{ food_id, field: food_field, source_id }` (PK `food_id`+`field`) | One provenance row per scalar field; controlled enum, no value column (no EAV)                  |
| `FieldProvenance`       | `Record<FoodField, FoodSourceId>`                                        | The merge engine's scalar-field → winning-source map (REQ-052)                                  |
| `SourceFields`          | `{ field: string }[]`                                                    | `fieldsFromSource` result — the single-query "which fields came from source X" answer (REQ-029) |

### 4. Error Handling Return Codes

| Error Condition                                 | Error Type                | Action                                                                    |
| ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Connection error during a provenance write      | `PostgresConnectionError` | Transaction rolls back with the parent `upsertGoldenRecord`               |
| `field` not in the controlled enum              | `ValidationError`         | Throw before write — no EAV / free-form field names allowed               |
| `source_id` does not resolve to a crosswalk row | `DataIntegrityError`      | FK violation; a provenance write must reference a real `food_sources` row |
| Duplicate `(food_id, field)`                    | Handled by `ON CONFLICT`  | Latest winning source overwrites (merge re-run is idempotent)             |

---

## MOD-020 — ChangeRefreshConsumer (Change-Driven Refresh)

**Parent ARCH**: ARCH-018 (**Parent SYS**: SYS-019)
**Type**: Stateful (scheduled handler; compares per-item versions, re-enqueues only changed items)
**Runtime**: EventBridge-scheduled handler (`IngestionScheduled`) in the food-service deployment unit (Node.js 22.x)
**Target source file**: `packages/services/food-service/src/refresh/change-refresh.consumer.ts`

> **(New.)** EventBridge-scheduled (`IngestionScheduled`) change-driven refresh. For `RESOLVED` foods,
> re-fetches each backing source item via its adapter (MOD-015) and compares `food_sources.item_version`;
> re-pulls a field **only** when its originating external item changed upstream, never blindly re-blending
> (REQ-031/REQ-053). Unchanged fields (incl. user-resolved) are left intact; re-pulled values pass MOD-021
> validation and update `source_id` provenance (MOD-019). Re-enqueues affected foods as **low-priority**
> `fetch_queue` work (deduped via `ON CONFLICT`, REQ-032).

### 1. Algorithmic / Logic View

```
FUNCTION onScheduled(event: IngestionScheduled):
  // Iterate RESOLVED foods' backing source items (batched / paged for scale).
  FOR EACH (foodId, crosswalk) IN FoodSourcesDao.resolvedBackingItems():   // food.status='RESOLVED'
    IF itemChanged(crosswalk.source, crosswalk.external_key, crosswalk.item_version):
      // The external item this food was pulled from changed upstream → re-enqueue as LOW-priority work.
      FetchQueueRouter.enqueueLowPriority(foodId, requestedBy = "svc_change_refresh")  // ON CONFLICT dedup (REQ-032)
    ELSE:
      // Unchanged upstream → leave every field intact (incl. user-resolved) — NO overwrite (REQ-031/REQ-053)
      CONTINUE

FUNCTION itemChanged(source, externalKey, knownVersion): boolean
  adapter = SourceAdapterRegistry.adapterFor(source)   // MOD-015
  current = adapter.fetchByKey(externalKey)            // validated via MOD-021 (REQ-055)
  // Compare per-item version/etag/hash — NOT stored raw payload (none is retained) (REQ-032).
  RETURN current.itemVersion != knownVersion
```

When the re-enqueued low-priority row is later drained by MOD-004, only the fields whose originating item
changed are re-pulled and re-merged; their `source_id` provenance is updated (MOD-019), and unchanged
fields — including a user's manual resolution (MOD-018) — are preserved because nothing re-pulls them.

### 2. State Machine View

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Scanning : IngestionScheduled (cron)
  Scanning --> ComparingVersion : next RESOLVED food's backing item
  ComparingVersion --> LeavingIntact : item_version unchanged upstream (incl. user-resolved) — no overwrite
  ComparingVersion --> ReEnqueuing : item_version changed upstream
  ReEnqueuing --> Scanning : low-priority fetch_queue row (ON CONFLICT dedup)
  LeavingIntact --> Scanning : next backing item
  Scanning --> [*] : all RESOLVED foods scanned
```

### 3. Internal Data Structures

| Name                 | Type                                            | Description                                                                |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `IngestionScheduled` | `{ scheduledAt: string }`                       | EventBridge cron detail that triggers the refresh scan                     |
| `BackingItem`        | `{ foodId, source, externalKey, item_version }` | One `food_sources` crosswalk row for a `RESOLVED` food                     |
| `RefreshDecision`    | `'reenqueue' \| 'leave_intact'`                 | Per-item outcome — re-enqueue only on an upstream version change (REQ-053) |

### 4. Error Handling Return Codes

| Error Condition                            | Action                      | Effect                                                                 |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| Adapter `fetchByKey` errors during compare | Skip this item this cycle   | Leave the field intact; retry on the next scheduled run (no overwrite) |
| Re-pulled value fails MOD-021 validation   | reject-not-store            | Field not updated; existing value preserved (REQ-055)                  |
| `enqueueLowPriority` hits a duplicate row  | `ON CONFLICT (food_id)`     | No duplicate; demand unchanged (REQ-032)                               |
| Item unchanged upstream                    | leave intact                | No write, no churn (REQ-031) — user-resolved fields preserved          |
| Scan partially fails mid-cycle             | Retry with backoff next run | Idempotent — unchanged items are simply re-compared                    |

---

## MOD-021 — AdapterInputValidator (Source-Boundary Validation & Transport Security)

**Parent ARCH**: ARCH-019 (**Parent SYS**: SYS-020 [CROSS-CUTTING])
**Type**: Stateless (pure validation/sanitization + transport-security assertions)
**Runtime**: In-process inside each source adapter's `mapToCanonical` (Node.js 22.x); used by MOD-008
**Target source file**: `packages/services/food-service/src/sources/adapter-input-validator.ts`

> **(New.)** Source-boundary input validation + transport security used inside each adapter's
> `mapToCanonical`: type/range checks, length caps, text sanitization before any value enters the
> canonical store; HTTPS with certificate validation on outbound fetches; **reject-not-store** on a
> response that fails validation (REQ-055). Preserves nutrient fidelity beyond per-100g basis
> normalization (SC-008).

### 1. Algorithmic / Logic View

```
MAX_NAME_LEN        = 512
MAX_DESCRIPTION_LEN = 8192
NUTRIENT_AMOUNT_MAX = 1e6                            // sanity range cap (per-100g amounts)

FUNCTION assertHttps(url):                          // transport security (REQ-055)
  IF NOT startsWith(url, "https://"):
    THROW TransportSecurityError("Non-HTTPS source URL refused")
  // Node's fetch/undici validates the server certificate by default; reject on cert failure.

FUNCTION validateAndSanitize(mapped: MappedCandidate): CanonicalCandidate
  // Reject-not-store: any failure throws ValidationError; the worker drops this candidate (MOD-004).
  name = sanitizeText(mapped.name)
  IF name == "" OR length(name) > MAX_NAME_LEN:
    THROW ValidationError("name out of bounds")
  description = mapped.description ? sanitizeText(mapped.description) : null
  IF description != NULL AND length(description) > MAX_DESCRIPTION_LEN:
    THROW ValidationError("description too long")
  IF mapped.kind NOT IN ['generic', 'branded']:
    THROW ValidationError("invalid kind")

  nutrients = []
  FOR EACH n IN mapped.nutrients:
    IF NOT isFiniteNumber(n.amount) OR n.amount < 0 OR n.amount > NUTRIENT_AMOUNT_MAX:
      THROW ValidationError("nutrient amount out of range: " + n.code)   // reject-not-store
    IF n.basis NOT IN ['per_100g', 'per_serving']:
      THROW ValidationError("invalid nutrient basis")
    nutrients.push({ code: n.code, name: sanitizeText(n.name), unit: n.unit, amount: n.amount, basis: n.basis })
    // NOTE: fidelity preserved — no lossy rounding here beyond basis normalization done in the merge (SC-008).

  portions = mapped.portions.map(p => {
    IF NOT isFiniteNumber(p.gramWeight) OR p.gramWeight <= 0:
      THROW ValidationError("invalid portion gram weight")
    RETURN { label: sanitizeText(p.label), gramWeight: p.gramWeight }
  })

  RETURN { source: mapped.source, externalKey: mapped.externalKey, name, kind: mapped.kind,
           brandOwner: mapped.brandOwner ? sanitizeText(mapped.brandOwner) : null,
           description, nutrients, portions, itemVersion: mapped.itemVersion }

FUNCTION sanitizeText(s):
  // Strip control chars / null bytes; normalize whitespace; no HTML/markup injected into the store.
  RETURN normalizeWhitespace(stripControlChars(s))
```

### 2. State Machine View

`N/A Stateless` — pure validation/sanitization functions; the same input always yields the same accept/reject outcome. No I/O beyond the transport-security assertion (which inspects the URL scheme), no retained state.

### 3. Internal Data Structures

| Name                     | Type                                                                                             | Description                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `MappedCandidate`        | `{ source, externalKey, name, kind, brandOwner, description, nutrients, portions, itemVersion }` | Pre-validation candidate from an adapter's `mapToCanonical`                       |
| `CanonicalCandidate`     | same shape, post-validation/sanitization                                                         | Clean candidate safe to enter the canonical store                                 |
| `ValidationError`        | `{ message: string, field?: string }`                                                            | Extends `Error`, has `isValidationError` guard (NFR-009); drives reject-not-store |
| `TransportSecurityError` | `{ message: string }`                                                                            | Thrown by `assertHttps` on a non-HTTPS / cert-failed fetch (REQ-055)              |

### 4. Error Handling Return Codes

| Error Condition                           | Error Type               | Action                                                                   |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Non-HTTPS source URL / cert failure       | `TransportSecurityError` | Refuse the fetch; the adapter throws, the candidate is dropped (REQ-055) |
| `name` empty or over length cap           | `ValidationError`        | Reject candidate (reject-not-store); food may resolve from others        |
| Nutrient amount non-finite / out of range | `ValidationError`        | Reject candidate; no malformed value enters the store (REQ-055)          |
| Invalid `kind` / nutrient `basis`         | `ValidationError`        | Reject candidate                                                         |
| Portion gram weight ≤ 0 / non-finite      | `ValidationError`        | Reject candidate                                                         |
| Control chars / null bytes in text        | sanitized                | Stripped before storage (sanitize, not reject)                           |

---

## ARCH ↔ MOD Traceability Matrix

This matrix maps each Architecture Module (ARCH) to its corresponding low-level Module Design (MOD), and
traces both back to parent System Components (SYS) per `architecture-design.md`'s SYS→ARCH coverage table.

| ARCH ID  | ARCH Name                  | MOD ID  | MOD Name                                                      | Parent SYS                | REQ trace                                                      | Notes                                                                                                                      |
| -------- | -------------------------- | ------- | ------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ARCH-001 | FoodApiController          | MOD-001 | FoodApiController (Request Handler)                           | SYS-001                   | REQ-002..007, REQ-IF-001/002, REQ-045..049, REQ-IF-009..011    | Add-by-name + read-by-`id`; candidates/PATCH delegate to MOD-018; status enum PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED |
| ARCH-002 | EnqueueEmitter             | MOD-002 | EnqueueEmitter (enqueue + scheduled/completion fan-out)       | SYS-002                   | REQ-011, REQ-014, REQ-017, REQ-032, REQ-034                    | FoodRequested → `fetch_queue` INSERT + `pg_notify` (id-keyed); IngestionScheduled/FoodDataReceived → EventBridge           |
| ARCH-003 | FetchQueueRouter           | MOD-003 | FetchQueueRouter (Postgres-as-Queue Demand-Weighted Router)   | SYS-002, SYS-003, SYS-004 | REQ-014, REQ-015, REQ-016, REQ-018, REQ-022, REQ-044           | `fetch_queue(food_id PK)`; demand-weighted + demotion-tier ORDER BY; lease; tombstone; advisory-lock single worker         |
| ARCH-004 | FoodConsumerService        | MOD-004 | FoodConsumerService (Fan-Out / Merge Worker)                  | SYS-005                   | REQ-016, REQ-018, REQ-025..027, REQ-050, REQ-MRG-1             | Fan out over registry → per-source limit → validate → pre-merge → merge → persist → status; FAILED/NOT_FOUND tombstones    |
| ARCH-005 | RollingWindowLimiter       | MOD-005 | RollingWindowLimiter (Per-Source Rolling 60-Min Window)       | SYS-006 [CROSS-CUTTING]   | REQ-019, REQ-020, REQ-021, REQ-026                             | Per-source atomic `source_call_log` count+insert; ≤cap/60min, pause at 90%; Redis sorted-set deferred                      |
| ARCH-006 | FoodPostgresRepository     | MOD-006 | FoodPostgresRepository (Canonical Normalized Store)           | **SYS-007** _(corrected)_ | REQ-028, REQ-029, REQ-008, REQ-CN-007                          | 12-table normalized provenance-bearing schema; no `fdcId`/JSONB/`fetch_status`/EAV; pg_trgm search                         |
| ARCH-007 | FoodCacheService           | MOD-007 | FoodCacheService (Optional Hot Cache)                         | **SYS-008** _(corrected)_ | REQ-030, REQ-001                                               | Optional `food:{id}` Redis (deferred); lean default Postgres/LRU; no pending-set (queue ON CONFLICT does dedup)            |
| ARCH-008 | UsdaApiClient              | MOD-008 | UsdaApiClient (USDA Source Adapter — _only_ `fdcId` boundary) | **SYS-009** _(corrected)_ | REQ-023, REQ-024, REQ-046, REQ-IF-005, REQ-IF-012              | The ONLY module with `fdcId`/USDA terms; `fdcId → external_key`; implements `FoodSourceAdapter`                            |
| ARCH-009 | WebSocketNotifier          | MOD-009 | WebSocketNotifier (Real-Time Notification — deferred)         | **SYS-010** _(corrected)_ | REQ-034, REQ-041, REQ-049                                      | Launch-deferred (US-9); `id`-keyed; per-recipient via `fetch_requesters`; `$connect` Lambda authorizer                     |
| ARCH-010 | SecretManager              | MOD-010 | SecretManager (Per-Source API Key Wrapper)                    | **SYS-011** _(corrected)_ | REQ-042, REQ-CN (A-009)                                        | Per-source `getSourceApiKey(source)`; 5-min cache; rotation                                                                |
| ARCH-011 | MonitoringLogger           | MOD-011 | MonitoringLogger (Structured Logging & Metrics)               | **SYS-012** _(corrected)_ | REQ-NF (observability), REQ trace via SC-002                   | EMF (Namespace `FoodData`); per-source call counts, UNRESOLVED backlog, tombstone count, auth-401 rate                     |
| ARCH-012 | FoodAuthGuard              | MOD-012 | ClerkAuthMiddleware (Networkless Verification & Scope)        | SYS-013                   | REQ-035..042, REQ-047, REQ-050, REQ-051, REQ-052, REQ-053-auth | Networkless `verifyToken`; fail-closed 401; azp; 403; M2M; load-shed DoS guards                                            |
| ARCH-012 | FoodAuthGuard              | MOD-013 | DemotionAndFairness (Per-`sub` Demotion & Backpressure)       | SYS-013                   | REQ-043, REQ-044, REQ-045, REQ-046                             | Demotion not rejection (>50 pending → back, dynamic, no 429); distinct-requester demand; batch cap 400; 503                |
| ARCH-012 | FoodAuthGuard              | MOD-014 | AsyncProducerAuthz (Async-Producer Provenance)                | SYS-013                   | REQ-042 (async leg), REQ-032/FR-012 provenance                 | Least-privilege IAM producers + `requestedBy` provenance on async/internal paths (EventBridge / `fetch_queue`)             |
| ARCH-013 | SourceAdapterRegistry      | MOD-015 | SourceAdapterRegistry (Registry & `FoodSourceAdapter`)        | SYS-014                   | REQ-054, REQ-IF-012, REQ-050, REQ-CN-007                       | **New.** Pluggable registry; `fdcId` confined to registered adapters; static priority order; additive sources              |
| ARCH-014 | FoodDaoRepository          | MOD-016 | FoodDaoRepository (DAO / Repository Seam)                     | SYS-018                   | REQ-005, REQ-013, REQ-054, REQ-028                             | **New.** Sole persistence seam; advisory-lock add-by-name dedup; per-aggregate DAOs over MOD-006                           |
| ARCH-015 | GoldenRecordMergeEngine    | MOD-017 | GoldenRecordMergeEngine (Field-Level Merge)                   | SYS-015                   | REQ-051, REQ-MRG-2, REQ-MRG-3, REQ-050                         | **New.** Presence>absence; identity→priority; free-text→longer; nutrients→per-100g then priority                           |
| ARCH-016 | CandidateResolutionService | MOD-018 | CandidateResolutionService (`/candidates` + PATCH)            | SYS-016                   | REQ-048, REQ-049, REQ-IF-010, REQ-IF-011, REQ-052              | **New.** Candidate-set validation (out-of-set → 400/409); merge → RESOLVED; user pick = ordinary provenance                |
| ARCH-017 | ProvenanceStore            | MOD-019 | ProvenanceStore (Value-Grain Provenance)                      | SYS-017                   | REQ-052, REQ-029                                               | **New.** `source_id` columns + `food_field_provenance`; "which fields came from source X" = one query; no EAV              |
| ARCH-018 | ChangeRefreshConsumer      | MOD-020 | ChangeRefreshConsumer (Change-Driven Refresh)                 | SYS-019                   | REQ-031, REQ-032, REQ-053                                      | **New.** Compares `food_sources.item_version`; re-pulls only changed items; preserves user-resolved fields                 |
| ARCH-019 | AdapterInputValidator      | MOD-021 | AdapterInputValidator (Boundary Validation & HTTPS)           | SYS-020 [CROSS-CUTTING]   | REQ-055, REQ-024, REQ-032 (refresh validation)                 | **New.** Type/range/length/text validate + sanitize; HTTPS + cert; reject-not-store; fidelity preserved                    |

### Coverage Summary

| Metric                                                           | Count                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total ARCH modules                                               | 19 (ARCH-001..ARCH-019)                                                                                                                                  |
| Total MOD modules                                                | 21 (MOD-001..MOD-021)                                                                                                                                    |
| ARCH modules with full MOD coverage                              | 19 / 19 (100%)                                                                                                                                           |
| MOD modules preserved (re-keyed `fdcId → id`, USDA → per-source) | 14 (MOD-001..MOD-014)                                                                                                                                    |
| MOD modules added (new ARCH-013..019)                            | 7 (MOD-015..MOD-021)                                                                                                                                     |
| MOD modules rewritten in substance (schema/behavior)             | 6 (MOD-001, MOD-004, MOD-006, MOD-007, MOD-008, MOD-005 per-source generalization)                                                                       |
| MOD modules preserved verbatim-in-intent (re-key only)           | 6 (MOD-002, MOD-003, MOD-009, MOD-010, MOD-011, MOD-014)                                                                                                 |
| MOD modules preserved verbatim (auth slice)                      | 2 (MOD-012, MOD-013 — ids + substance kept; `admitEnqueue`/`isDemoted` op names retained)                                                                |
| MOD modules with a Stateful state machine                        | 9 (MOD-001, MOD-004, MOD-005, MOD-010, MOD-012, MOD-013, MOD-014, MOD-018, MOD-020)                                                                      |
| MOD modules marked `N/A Stateless`                               | 12 (MOD-002, MOD-003, MOD-006, MOD-007, MOD-008, MOD-011, MOD-015, MOD-016, MOD-017, MOD-019, MOD-021, MOD-009-deferred-scaffold has a WS state machine) |
| Modules where `fdcId` appears (must be exactly one)              | 1 (MOD-008 only — REQ-046/SC-013)                                                                                                                        |
| SYS-parent corrections applied                                   | 6 (MOD-006→SYS-007, MOD-007→SYS-008, MOD-008→SYS-009, MOD-009→SYS-010, MOD-010→SYS-011, MOD-011→SYS-012)                                                 |

> **`fdcId` confinement check (SC-013/REQ-046).** A grep for `fdcId` across this artifact returns matches
> **only** inside **MOD-008 (UsdaApiClient)**. Every other MOD — controller, queue, worker, store, DAO,
> merge, candidates, provenance, refresh, validator, auth — is keyed on the internal ULID `id` and the
> source-agnostic `external_key`.

---

_End of Module Design — 003-usda-food-data (re-baselined 2026-06-22 to the source-agnostic food data model)_
