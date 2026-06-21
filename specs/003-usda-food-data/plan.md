# Technical Plan: Feature 003 — USDA Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate worker + rolling 60-min window limiter)
**Reference**: `docs/architecture/usda/05-event-driven-queue-based.md`
**Status**: Draft

---

## 1. Architecture Overview

### System Context

```
USDA FoodData Central (1,000 req/hr limit)
        ↑  (async, rolling-60-min-window rate-limited)
        │
Fargate consumer worker  ← LISTEN/NOTIFY ─┐
   (rolling 60-min window: ≤1,000 calls    │
    in any trailing 60 min; pause @ 90%)   │
        ↓                                 │
PostgreSQL  (kitchensink_food on the shared kitchensink-data-{stage} instance)
  • foods (local store)                   │
  • fetch_queue (Postgres-as-queue) ──────┘ pg_notify('fetch_queued')
        ↑
ALB → ECS/Fargate NestJS service (FoodService)
   FoodAuthGuard (in-process Clerk verifyToken + azp)
        ↑
   Commise App (user token) / downstream services (M2M token) / Search UX

EventBridge (scheduled only): stale-refresh cron + bulk-sync → enqueue
```

> Every entry point (incl. WebSocket `$connect`) is fronted by **`FoodAuthGuard`** (§2A) —
> networkless Clerk verification — before any DB/queue/USDA work. Fairness is enforced by
> **demotion** at queue drain time (no per-`sub` enqueue quota; §2A.4). Async producers
> (EventBridge/cron/bulk-sync) are gated by least-privilege IAM (FR-048).

### Data Flow

1. **Lookup path** (synchronous): ALB → ECS/Fargate NestJS service → PostgreSQL → response (no USDA call; optional in-process LRU per §6)
2. **Fetch path** (async): cache miss → `INSERT INTO fetch_queue … ON CONFLICT` + `pg_notify('fetch_queued')` → Fargate worker wakes (LISTEN/NOTIFY), drains by demand-weighted priority (demoting `sub`s with >50 pending items to the back), rolling-60-min-window-limited USDA call → upsert `foods`, mark fetched
3. **Bulk path**: multiple unknown fdcIds → one enqueue per id (deduped) → USDA batch endpoint (≤20 ids / 1 windowed call)
4. **Scheduled path**: EventBridge cron → stale-refresh / bulk-sync → enqueue rows on `fetch_queue`

### Key Architecture Decision

Use Architecture 5 (Event-Driven Queue-Based) per user selection. This treats the USDA rate limit as a first-class constraint and decouples data fetching from data serving.

### Package & Infrastructure Layout (locked 2026-06-19)

| Package                            | Path                             | Role                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kitchensink/food-service`        | `packages/services/food-service` | Deployable NestJS service on **ECS/Fargate fronted by the single shared per-stage ALB** (owned by the global infra) via a **host-based listener rule** (priority 200) — not its own ALB — `/v1/foods/*` API + in-process `FoodAuthGuard`, Drizzle schema/migrations, the Fargate consumer worker, the lambdas, and its **own CDK** (`infra/lib/`). |
| `@kitchensink/usda-client`         | `packages/clients/usda`          | External USDA FoodData Central client library (typed wrapper; no DB/server).                                                                                                                                                                                                                                                                       |
| `@kitchensink/food-service-client` | `packages/clients/food-service`  | Typed client for our `/v1/foods/*` API used by web/mobile + downstream (001/006/007/009 M2M callers).                                                                                                                                                                                                                                              |
| `@kitchensink/clerk-verify`        | `packages/shared/clerk-verify`   | Shared networkless Clerk verification, extracted from the identity service.                                                                                                                                                                                                                                                                        |

**Database — reuse, no new RDS, no cluster.** The food tables live in a **separate logical
database `kitchensink_food`** on the **existing shared instance `kitchensink-data-{stage}`** (a
single `rds.DatabaseInstance`, db.t4g.small, owned by the global DataStack in
`packages/infra/global`). The `kitchensink_food` database + its least-privilege role/secret are
provisioned in that **global DataStack** (platform infra); `food-service` `Fn.importValue`s the
shared DB exports and runs its migrations against `kitchensink_food`. The instance's `pg_trgm`
extension is already bootstrapped (FR-008 search). Reusing the instance inherits its current
`multiAz: false` posture (acceptable for lean launch; SC-009 99.9% is a future shared-DB concern).

---

## 2. Data Model

### Core Tables

```sql
-- Local USDA food data store
foods (
  fdc_id INT PRIMARY KEY,          -- USDA FoodData Central ID
  description TEXT,
  data_type TEXT,                  -- 'Foundation' | 'SR Legacy' | 'Branded'
  fetch_status TEXT,              -- pending|fetched|failed|not_found|stale (FR-028)
  last_synced_at TIMESTAMP,
  raw_json JSONB,                  -- Full USDA response
  -- Standard nutrients (per 100g)
  calories DECIMAL,
  protein_g DECIMAL,
  carbs_g DECIMAL,
  fat_g DECIMAL,
  fiber_g DECIMAL,
  sodium_mg DECIMAL,
  -- Extended nutrients
  sugar_g DECIMAL,
  saturated_fat_g DECIMAL,
  cholesterol_mg DECIMAL,
  -- Micros
  vitamin_a_iu DECIMAL,
  vitamin_c_mg DECIMAL,
  calcium_mg DECIMAL,
  iron_mg DECIMAL,
  -- Search vector
  search_vector TSVECTOR,
  -- Branding (Branded Foods only)
  brand_owner TEXT,
  brand_name TEXT,
  upc_code TEXT
)

-- USDA sync metadata
usda_sync_metadata (
  id INT PRIMARY KEY DEFAULT 1,   -- Singleton
  last_full_sync_at TIMESTAMP,
  last_incremental_at TIMESTAMP,
  foundation_version TEXT,
  sr_legacy_version TEXT,
  branded_version TEXT
)

-- Demand-weighted fetch queue (Postgres-as-queue; replaces SQS + the old
-- usda_pending/usda_fetch_failures tables — dedup, demand counting, retry,
-- and tombstoning all live in one row; FR-014..FR-018)
fetch_queue (
  fdc_id           text PRIMARY KEY,     -- ON CONFLICT dedup (FR-014)
  request_count    int  NOT NULL DEFAULT 1,
  first_requested  timestamptz NOT NULL DEFAULT now(),
  last_requested   timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending',  -- pending|in_flight|tombstone
  attempts         int  NOT NULL DEFAULT 0,           -- retry/backoff (FR-016)
  last_error       text,
  fetched_at       timestamptz
)
-- INDEX (request_count DESC, first_requested ASC) WHERE status='pending'  -- FR-015

-- USDA rolling-60-min-window call log (FR-019/FR-020; Postgres in lean launch).
-- One timestamped row per USDA call; the trailing-60-min count = COUNT(*) over
-- the last 60 min. Pruned/filtered to the trailing 60 min (older rows are
-- irrelevant and may be deleted). Replaces the old token-bucket `rate_limiter_state`
-- row (a refilling bucket could emit ~2,000 calls across a rolling hour and breach
-- the hard cap). Deferred Redis variant: a sorted set (ZADD ts / ZCOUNT last 60 min).
usda_call_log (
  id        bigserial PRIMARY KEY,
  called_at timestamptz NOT NULL DEFAULT now()
)
-- INDEX (called_at)  -- windowed count + prune

-- Distinct-requester demand (FR-044) + WS targeting. Also the source for the
-- per-`sub` pending count that drives fairness-by-demotion (§2A.4): a `sub` with
-- >50 pending `fetch_queue` items is ranked to the back of the priority order.
-- (No per-`sub`/global enqueue quota tables — fairness is by demotion, not rejection.)
fetch_requesters (
  fdc_id       text NOT NULL,              -- distinct-`sub` demand + WS targeting
  sub          text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fdc_id, sub)
)
```

> The `foods` table's authoritative columns are spec **FR-028** (`fetch_status` enum
> `pending|fetched|failed|not_found|stale`, `fetched_at`, `last_requested_at`,
> `request_count`, `created_at`, `updated_at`) — T-005 is the source of truth for the DDL.
> The old `usda_fetch_failures` and `usda_pending` tables are **removed**: failure
> tracking is `fetch_queue.{attempts,last_error,status}` and dedup is the `fetch_queue`
> `ON CONFLICT` (FR-014). The food schema tables are: `foods`, `fetch_queue`,
> `fetch_requesters`, `usda_call_log`, and `usda_sync_metadata` (all in the
> `kitchensink_food` database). There is **no** `rate_limiter_state` (replaced by
> `usda_call_log`, the rolling-60-min window) and **no** `user_fetch_quota` /
> `global_fetch_quota` (fairness is by demotion at drain time, not a per-`sub` quota).

### Integration with 001

The `ingredients` table in 001 already has `usda_fdc_id` and 4 macro columns. 003 extends it with additional nutrient columns and `fetch_status` tracking.

---

## 2A. Authentication & Authorization (FR-035–FR-053)

> Added by the 2026-06-19 re-plan to close sync-verify DRIFT-101 and the red-team
> findings (RT-003-usda-food-data-2026-06-19). The pre-auth plan had **zero** auth
> coverage; this section is the design source for the auth slice of tasks + the
> v-model V&V chain.

### 2A.1 `FoodAuthGuard` — the named auth component (FR-053)

A single auth component fronts **every** food data entry point — all HTTP routes
**and** the WebSocket `$connect`. It is a first-class architecture module (not spec
prose), and every auth FR (FR-035–FR-052) traces to it.

- **Verification is networkless** (FR-036/FR-037): `verifyToken` from `@clerk/backend`
  using the public `CLERK_JWT_KEY`, enforcing `azp` ∈ `CLERK_AUTHORIZED_PARTIES`.
  No IdP round trip, no Clerk secret key, no Auth0/Cognito authorizer. Mirrors the
  identity service's `ClerkAuthService`/`AuthMiddleware` (`packages/services/identity/src/auth/`).
- **Identity from the verified token only** (FR-038): `sub` (+ `azp`, `public_metadata`)
  come from the validated JWT; no client-suppliable identity header is ever trusted.

**Deployment decision (locked 2026-06-19): in-process NestJS middleware on ECS/Fargate.**
FoodService is a NestJS service on **ECS/Fargate fronted by the single shared per-stage ALB**
(owned by the global infra; the service adds a host-based listener rule at priority 200 rather
than creating its own ALB — same topology as the identity service, which uses priority 100).
The service is still fronted by a **public, internet-facing ALB**, so the auth rationale is
unchanged. Therefore `FoodAuthGuard` is implemented as **NestJS `AuthMiddleware` running
in-process**, not as a Lambda authorizer:

- An **API Gateway Lambda authorizer cannot front an ALB** — Lambda authorizers are an API
  Gateway / AppSync feature; ALB has no equivalent (its only native auth is redirect-based
  `authenticate-oidc`/`authenticate-cognito`, the wrong shape for verifying a Clerk bearer
  token). Using a Lambda authorizer would require inserting `API Gateway → VPC Link → ALB →
ECS` purely to host it — an extra edge layer for no gain, since the token verifies
  networklessly in ~1ms in-process.
- The middleware **reuses the identity service's Clerk verification**: extract the
  `ClerkAuthService` verify logic (`verifyToken` + `azp`) into a shared
  **`@kitchensink/clerk-verify`** package (`packages/shared/clerk-verify`) consumed by both
  the identity service and `food-service` — one implementation, no drift.
- No cold start → SC-011 (≤10ms p95) is met without provisioned concurrency; fairness-by-demotion
  (FR-043) lives in the same service, computed at queue drain time (not a pre-enqueue quota check).
- **FR-050 reframed for middleware:** the middleware runs on **every** route (there is no
  authorizer result cache to fall open); the cache-TTL/route-binding form of FR-050 applies
  only to the WebSocket `$connect` authorizer below.
- _If_ API Gateway is later added in front of FoodService for other reasons (WAF, usage
  plans, unified edge), a Clerk REQUEST Lambda authorizer becomes the right tool and FR-050's
  cache rules re-apply — but that is out of scope for this plan.

### 2A.2 Token classes (FR-047, A-012)

| Class                   | Caller                                                                                             | `azp`                           | Verified by               |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------- |
| **User session token**  | web/mobile end users                                                                               | web/mobile origins              | networkless `verifyToken` |
| **Machine (M2M) token** | downstream services (001/006/007/009) + internal jobs (recipe import FR-012, stale-refresh FR-032) | service client ids in allowlist | networkless `verifyToken` |

Every endpoint is classified user-token / service-token / both (see §3 table). Server-initiated
paths that lack a user token MUST use an M2M token — they are **not** exempt from auth.

### 2A.3 Authorization (FR-039, FR-051)

- Food data is shared reference data → **any authenticated principal may read** (no per-record ownership).
- Operational/admin endpoints (manual re-fetch, stale-refresh trigger) require an **elevated scope**
  read from the token's signed `public_metadata`; missing scope → **`403 Forbidden`** (distinct from `401`).
- **Response precedence (FR-051):** `401` (authn) → `403` (authz scope) → `400` (input validation)
  → `404`/`202`/`200` (business logic). Applies to FR-002/003/005/006.

### 2A.4 Queue fairness by demotion (FR-043, FR-044, FR-045, FR-046 — denial-of-wallet)

Auth ≠ rate limiting. Fairness is enforced **without rejecting any authenticated request for a
personal quota** — the food service only calls USDA on a cache miss, and the rolling-60-min-window
limiter (§4, FR-019) already guarantees the system never exceeds 1,000 req/hr. Within that budget,
fairness is by **demotion at drain time**, not by a per-`sub` enqueue quota:

- **Fairness by demotion** (FR-043): a `sub` with **more than 50 items currently pending** in the
  `fetch_queue` has their queued items ranked to the **back** of the priority order (below the FR-015
  demand ordering), so a heavy user cannot starve other users. This is **dynamic** — priority is
  computed **at drain time** from the requester's _current_ per-`sub` pending count (the scorer reads
  live state, not a frozen flag), so items auto re-promote to normal priority the moment the `sub`
  drops below 50. The scheme is **work-conserving**: a demoted user still drains on spare capacity,
  and **no enqueue is ever rejected with `429`** for a personal quota. The per-`sub` pending count is
  **derived** from `fetch_queue` + `fetch_requesters` (DEMOTE_THRESHOLD = 50) — no quota counter
  table is stored.
- **Distinct-requester demand** (FR-044): `request_count` (FR-015 priority) counts **distinct `sub`s**
  via the `fetch_requesters(fdc_id, sub, requested_at)` table — a `sub` cannot inflate priority by
  repeating; contribution capped; ordering aged so no `fdcId` is pinned to the front. This table also
  drives WebSocket targeting (§2A.5) **and** supplies the per-`sub` pending count used by demotion above.
- **Max batch size** (FR-045): `POST /v1/foods/batch` and recipe-import sets ≤ 100 `fdcId`s; over → `400`.
  A mixed cached+miss batch returns a **per-item partial response** — cached foods inline and a `pending`
  entry per miss (each enqueued) in one response, so the caller gets available data immediately and polls
  only the pending ids. (USDA's 20-ID/call cap, FR-023, stays an internal detail.)
- **Queue backpressure + circuit breaker** (FR-046): enforced max `fetch_queue` depth; when exceeded, or
  when the USDA circuit breaker is **open**, new enqueues fail closed with **`503`** (jittered recovery,
  no thundering herd). The breaker is a normative requirement, not the §6 footnote. (This is a global
  backpressure / availability control, not a per-`sub` quota.)

### 2A.5 WebSocket auth (FR-041, FR-049)

The WebSocket notifier (US-9, deferred P3) runs on an **API Gateway WebSocket API** — separate
from the ECS HTTP service. This is the one surface where a **`$connect` Lambda authorizer** is the
right tool (it reuses the same shared Clerk-verification package), and FR-050's cache-TTL/route-binding
rules apply here.

- Token presented at `$connect` via query param or `Sec-WebSocket-Protocol` (browsers can't set
  `Authorization` on WS); `$connect` rejection pinned to **`403`**.
- Mid-connection expiry (`exp` passes): connection closed (re-auth on reconnect after the 10-min idle close).
- `FoodDataReceived` pushes resolve recipients from `fetch_requesters` (the requester `sub`→`fdcId` set) —
  **no broadcast** to non-requesting connections (fixes the previously-unimplementable ownership guarantee).

### 2A.6 Async-producer authorization (FR-048)

Only named, least-privilege IAM roles may drive fetch work, across **both** producer surfaces (§4):
the demand path — `INSERT` into `fetch_queue` (the in-process `FoodRequested`/`FoodBatchRequested`
enqueues) — and the scheduled path — `events:PutEvents` for `IngestionScheduled`. The consumer
validates event/row provenance on both. The `requestedBy` field carries the authenticated `sub` or
the named service principal — never an unauthenticated `'system'` shortcut that bypasses the edge.

### 2A.7 Auth-layer DoS protection (FR-052, SC-011)

Bound auth-verification concurrency + per-source `401`-rate cap (load-shed) so a flood of well-formed-
but-invalid tokens (each forcing a CPU-bound signature verify before the fail-closed `401`) cannot
saturate the verifier and breach SC-009. SC-011's ≤10ms p95 is validated **under an invalid-token flood**.

### 2A.8 Config (FR-042)

`CLERK_JWT_KEY` (public PEM) + `CLERK_AUTHORIZED_PARTIES` (azp allowlist) — both non-secret. USDA API key
remains the only secret (Secrets Manager). New data: `fetch_requesters` (distinct-requester demand +
per-`sub` pending count for demotion) and `usda_call_log` (rolling-60-min window). No quota tables.

---

## 3. API Contracts

### Endpoints

Auth column: **U** = user session token, **M** = M2M/service token, **scope** = additionally requires
a `public_metadata` scope. All endpoints reject with `401` (no/invalid token) before any other handling.
There is **no** per-`sub` `429` — fairness is by demotion at drain time (FR-043), not request rejection.

| Method | Path                            | Auth      | Description                                                                               |
| ------ | ------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| GET    | `/v1/foods/{fdcId}`             | U or M    | Get food by USDA FDC ID (`200`/`202`/`404`)                                               |
| GET    | `/v1/foods/{fdcId}/status`      | U or M    | Poll fetch status                                                                         |
| GET    | `/v1/foods/search?query=`       | U or M    | Search local foods                                                                        |
| POST   | `/v1/foods/batch`               | U or M    | Batch fetch; ≤100 ids (`400` over); per-item partial (cached inline + `pending` per miss) |
| GET    | `/v1/foods/{fdcId}/nutrients`   | U or M    | Get full nutrient breakdown                                                               |
| GET    | `/v1/foods/autocomplete?query=` | U or M    | Autocomplete suggestions                                                                  |
| POST   | `/v1/foods/{fdcId}/refetch`     | U + scope | Operational manual re-fetch (`403` w/o scope)                                             |
| WS     | `$connect`                      | U         | WebSocket subscribe (`403` reject; FR-049)                                                |

### Response Shapes

```typescript
// GET /v1/foods/{fdcId} — success (fetched)
200 OK
{
  "fdcId": 171688,
  "description": "Apple, raw, granny smith",
  "dataType": "Foundation",
  "nutrients": {
    "calories": 58,
    "proteinG": 0.3,
    "carbsG": 13.4,
    "fatG": 0.2,
    "fiberG": 2.4
  },
  "fetchStatus": "fetched"
}

// GET /v1/foods/{fdcId} — pending (async backfill)
202 Accepted
{
  "status": "pending",
  "fdcId": 171688,
  "estimatedWaitSeconds": 3
}

// GET /v1/foods/{fdcId} — not found (tombstoned, within TTL)
404 Not Found
{
  "error": "Food not found",
  "fdcId": 999999,
  "message": "This food was not found in USDA; tombstoned until TTL expiry (default 30 days), after which a re-attempt is allowed"
}

// GET /v1/foods/{fdcId} — stale record (older than 30-day threshold)
// Serve stale immediately as 200 (stale-while-revalidate) + trigger a background re-fetch;
// the read never blocks and stale data is served indefinitely if re-fetch keeps failing (FR-031).
200 OK
{
  "fdcId": 171688,
  "description": "Apple, raw, granny smith",
  "dataType": "Foundation",
  "nutrients": { "calories": 58, "proteinG": 0.3, "carbsG": 13.4, "fatG": 0.2, "fiberG": 2.4 },
  "fetchStatus": "stale",
  "stale": true
}

// Any endpoint — unauthenticated / invalid / expired / wrong-azp token (FR-035, FR-040)
401 Unauthorized
{ "error": "Unauthorized", "message": "Valid Clerk session or M2M token required" }

// Operational endpoint — authenticated but missing required scope (FR-039, FR-051)
403 Forbidden
{ "error": "Forbidden", "message": "Operation requires elevated scope" }

// POST /v1/foods/batch — per-item partial response (FR-045): cached inline + pending per miss
200 OK
{
  "items": [
    { "fdcId": 171688, "status": "fetched", "description": "Apple, raw, granny smith", "nutrients": { "calories": 58 } },
    { "fdcId": 99999,  "status": "pending", "estimatedWaitSeconds": 30 }
  ]
}

// NOTE: there is no per-`sub` quota `429` (FR-043 fairness is by demotion at drain time, not rejection).

// Batch over the max id limit (FR-045) — or queue/circuit backpressure (FR-046 → 503)
400 Bad Request   { "error": "Batch too large", "maxIds": 100 }
503 Service Unavailable   { "error": "Fetch temporarily unavailable", "retryAfterSeconds": 30 }
```

> **Status precedence (FR-051):** `401` → `403` → `400` → `404`/`202`/`200`. A malformed
> `fdcId` with a bad token returns `401` (not `400`); a valid token on a tombstoned food returns `404`.

---

## 4. Event Contracts

> **Event taxonomy (reconciled 2026-06-20).** Two distinct mechanisms — do not conflate them.
> The **demand path** (`FoodRequested`/`FoodBatchRequested`) is an **in-process Postgres
> `fetch_queue` enqueue**, NOT an EventBridge event (corrected here to match spec.md
> `FoodDataEvent` + v-model `REQ-IF-005`/`ARCH-002`; the pre-reconciliation SQS/EventBridge
> demand model is dead). EventBridge carries **only** the scheduled producers and the
> completion signal. The CDK (`FoodServiceStack`) already reflects this — its only EventBridge
> rules are the two schedules + the `FoodFetchCompleted` completion rule; there is no
> demand-event rule.

#### Demand-path enqueue (in-process — NOT EventBridge)

`FoodRequested` / `FoodBatchRequested` are the names of the in-process enqueue operations
(`EnqueueEmitter.publishFoodRequested` / `publishFoodBatchRequested`, ARCH-002). Each performs a
direct `INSERT … ON CONFLICT` into the Postgres `fetch_queue` paired with `pg_notify('fetch_queued', fdc_id)`
(FR-011/FR-014/FR-017) — no `events:PutEvents`, no EventBridge topic, no SQS.

```typescript
// Cache miss — single food (→ fetch_queue INSERT … ON CONFLICT + pg_notify)
FoodRequested {
  fdcId: number,
  requestedAt: ISO8601,
  requestedBy: string,      // authenticated Clerk sub or named service principal (FR-048; never an unauthenticated 'system' shortcut)
  // No priority field — the single fetch_queue is ordered purely by demand
  // (request_count DESC, first_requested ASC); request_count is the capped distinct-requester count (FR-044).
}

// Batch import — multiple foods (→ per-id fetch_queue rows, deduped via ON CONFLICT)
FoodBatchRequested {
  fdcIds: number[],         // ≤100 ids/request (FR-045); each becomes one fetch_queue row
  requestedAt: ISO8601,
  requestedBy: string,
  source: 'import' | 'recipe',
  correlationId: string
}
```

#### EventBridge Events (scheduled producers + completion only)

```typescript
// Scheduled producer — stale-refresh / bulk-sync cron enqueues low-demand fetch_queue rows (FR-031/FR-032)
IngestionScheduled {
  eventId: string,
  timestamp: ISO8601,
  source: 'stale-refresh' | 'bulk-sync',
  requestedBy: string,      // named, least-privilege producer principal (FR-048)
}

// Fetch completed — Fargate worker → search-indexer + WebSocket notification (FR-034)
// (spec.md + v-model name this `FoodDataReceived`; `FoodFetchCompleted` is the plan/CDK alias —
//  the CDK rule matches detailType `FoodFetchCompleted`. Naming-harmonization is a tracked follow-up.)
FoodFetchCompleted {  // alias of v-model FoodDataReceived
  eventId: string,
  timestamp: ISO8601,
  fdcId: number,
  status: 'fetched' | 'not_found' | 'failed'
}

// Terminal failure — emitted to CloudWatch/SNS on tombstone (not a bus consumer fan-out)
FetchFailed {
  eventId: string,
  timestamp: ISO8601,
  fdcId: number,
  attempts: number,
  lastError: string,
}
```

### Fetch Queue (Postgres)

**Table**: `fetch_queue` — single durable demand-weighted queue for missing-ingredient lookups (ordered by `request_count DESC, first_requested ASC`; no high/low priority tier).

```sql
CREATE TABLE fetch_queue (
  fdc_id           text PRIMARY KEY,
  request_count    int  NOT NULL DEFAULT 1,
  first_requested  timestamptz NOT NULL DEFAULT now(),
  last_requested   timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending', -- pending|in_flight|done|tombstone
  attempts         int  NOT NULL DEFAULT 0,
  last_error       text,
  fetched_at       timestamptz
);
CREATE INDEX idx_fetch_queue_priority
  ON fetch_queue (request_count DESC, first_requested ASC)
  WHERE status = 'pending';
```

**Wakeup channel**: Postgres `LISTEN/NOTIFY` on channel `fetch_queued`. Enqueue statement is paired with `pg_notify('fetch_queued', fdc_id)`. No SQS, no Redis on the critical path.

**Rate limiter**: Single shared **rolling 60-minute window** — ≤1,000 USDA calls in any trailing 60 min (FR-019). Before each USDA call the consumer does an atomic check-and-record against the shared `usda_call_log` (count rows in the trailing 60 min, insert the new call in one transaction); at 90% (900) it pauses draining and resumes as older calls age out of the window. This replaces the old token bucket (a 1,000-cap bucket refilling 1,000/hr could emit ~2,000 calls across a rolling hour, breaching the hard cap). Deferred Redis variant: a sorted set (`ZADD` ts / `ZCOUNT` last 60 min).

**Lease timeout**: Rows stuck in `status='in_flight'` for >30s are reverted to `pending` by a watchdog query run on consumer start and every minute (recovers from consumer crashes).

**No DLQ infrastructure**: Tombstone rows (`status='tombstone'`) are the audit trail — queryable via SQL, alertable via CloudWatch metric, and reprocessable by setting `status='pending'`.

---

## 5. Lambda Functions

### food-fetch-consumer (Fargate worker, event-driven)

- **Runtime**: Node.js 22.x in a Fargate task (single instance, scale-to-zero via ECS desired-count=0/1 toggle if cost-critical)
- **Memory**: 512 MB
- **Trigger**: Postgres `LISTEN fetch_queued` (one connection held open for the worker lifetime)
- **Drain loop**: On notify wakeup → `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1 ORDER BY request_count DESC, first_requested ASC` → process → `UPDATE` → loop until queue empty → block on next NOTIFY
- **Rate limiting**: Rolling 60-minute window — ≤1,000 USDA calls in any trailing 60 min; atomic check-and-record against `usda_call_log`, pause draining at 90% (900), resume as calls age out. On USDA `429`, treat the window as full and back off (do not call)
- **Error handling**: 5 attempts with exponential backoff (`last_requested = now() + interval '2^attempts seconds'`) → `status='tombstone'`
- **Lease recovery**: Watchdog query reverts `in_flight` rows older than 30s to `pending`

### food-search-indexer (EventBridge trigger)

- Triggered by `FoodFetchCompleted` event emitted by the consumer on successful fetch
- Updates PostgreSQL `search_vector` with new food data
- Invalidates any application-layer cache

### usda-bulk-sync (EventBridge scheduled)

- Runs weekly (Sunday 2am UTC)
- Downloads Foundation + SR Legacy from USDA bulk files
- Upserts into PostgreSQL
- Updates `usda_sync_metadata`

---

## 6. Resilience & External Services

### USDA API (external)

- **Rate limit**: ≤1,000 calls in any trailing 60 minutes — enforced via a rolling 60-min window (`usda_call_log`); worker pauses at 90% (900)
- **Timeout**: 10s per request
- **Degraded mode**: If USDA API unavailable, return 503 with retry-after header
- **Circuit breaker**: After 5 consecutive failures, open circuit for 60s

### Application-layer cache (optional, in-process)

- Postgres `foods` table is the source of truth and is already fast (B-tree primary key on `fdc_id`, shared_buffers serves hot rows in microseconds at this scale).
- An optional in-process LRU cache in the NestJS API process MAY accelerate repeated lookups within a single request handler lifetime; no shared cache infrastructure is required at MVP scale.
- **No ElastiCache Redis** is provisioned. The original "Redis sorted set" priority-queue design was replaced by Postgres-as-queue (see §4 Fetch Queue). Reintroduce Redis only when single-Postgres-CPU `ORDER BY` of `fetch_queue` exceeds ~5ms p99 — a horizon well beyond launch.

---

## 7. Migration / Schema Changes

```sql
-- Migration for 003 usda-food-data
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS usda_fdc_id INT REFERENCES foods(fdc_id);
ALTER TABLE ingredients ADD COLUMN fetch_status TEXT DEFAULT 'unlinked';
ALTER TABLE ingredients ADD COLUMN fiber_g_per_100g DECIMAL;
ALTER TABLE ingredients ADD COLUMN sodium_mg_per_100g DECIMAL;
ALTER TABLE ingredients ADD COLUMN serving_size_g DECIMAL;
ALTER TABLE ingredients ADD COLUMN serving_description TEXT;
ALTER TABLE ingredients ADD COLUMN brand_owner TEXT;
ALTER TABLE ingredients ADD COLUMN last_synced_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS usda_sync_metadata (...);
CREATE TABLE IF NOT EXISTS fetch_queue (...);          -- see §4 (dedup, demand, retry, tombstone)
CREATE TABLE IF NOT EXISTS fetch_requesters (...);     -- distinct-requester demand + per-sub pending count (demotion)
CREATE TABLE IF NOT EXISTS usda_call_log (...);        -- rolling 60-min window limiter
-- No rate_limiter_state, user_fetch_quota, or global_fetch_quota tables.

-- Indexes
CREATE INDEX idx_foods_fetch_status ON foods(fetch_status) WHERE fetch_status = 'pending';
CREATE INDEX idx_foods_search ON foods USING GIN(search_vector);
CREATE INDEX idx_foods_data_type ON foods(data_type);
```

---

## 8. Monitoring & Observability

### CloudWatch Metrics

- `usda-fetch-queue-depth` — Postgres `fetch_queue` pending-row depth
- `usda-api-request-count` — success/failure rate
- `usda-api-latency` — p50/p95/p99
- `usda-rolling-window-count` — USDA calls in the trailing 60 min (alarm approaching 900/1,000)
- `food-cache-hit-rate` — local cache hit rate (in-process LRU; Postgres fallback)

### Alarms

- tombstone-row count > 0 → SNS alert
- API error rate > 5% → SNS alert
- Queue depth > 10,000 → SNS alert

---

## 9. Open Questions (from Research)

1. **Branded Foods sync**: Full 3.1 GB monthly update vs incremental API — preference?
2. **WebSocket notifications**: Required as optional enhancement per FR-034 — deferred or in-scope for initial release?

---

## 10. Implementation Order

1. **Packages + workspace wiring** — `@kitchensink/{food-service,usda-client,clerk-verify}`, register `packages/clients/*` (T-060, T-046, T-003)
2. **Global DataStack: `kitchensink_food` database** on the shared instance + food-service CDK (T-001b, T-001)
3. **PostgreSQL schema** — `foods`, `fetch_queue`, `fetch_requesters`, `usda_call_log`, `usda_sync_metadata`, indexes (T-004–T-009, T-056)
4. **Auth slice (US-0)** — `FoodAuthGuard` middleware + M2M + scopes/403 + fairness-by-demotion + backpressure + DoS (T-033, T-046–T-056; Test-first)
5. **REST API endpoints** — `GET /v1/foods/{fdcId}`, `/status`, `/search`, `/batch` (auth-gated)
6. **Postgres fetch_queue + Fargate consumer worker** — LISTEN/NOTIFY, rolling-60-min-window rate limiter, fairness-by-demotion at drain time (T-016–T-026)
7. **Bulk sync + stale-refresh lambdas** — EventBridge scheduled (T-030–T-032)
8. **Monitoring + alarms**, then **WebSocket notifications** (P3, deferred)
