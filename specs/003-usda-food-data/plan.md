# Technical Plan: Feature 003 — USDA Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (SQS + Lambda + Token Bucket)
**Reference**: `docs/architecture/usda/05-event-driven-queue-based.md`
**Status**: Draft

---

## 1. Architecture Overview

### System Context

```
USDA FoodData Central (1,000 req/hr limit)
        ↑
        │ (async, rate-limited)
        ↓
SQS Queue (USDA fetch requests)
        ↓
Lambda Consumer (token bucket @ 1,000 req/hr)
        ↓
PostgreSQL (local food store + Redis cache)
        ↑________________________|
        │                      |
REST API edge           API edge
(FoodAuthGuard:         (FoodAuthGuard)
 Clerk verifyToken      (search queries)
 + per-sub quota)
        ↑                      ↑
   Commise App /        Search UX
   downstream svcs (M2M)
```

> Every entry point (incl. WebSocket `$connect`) is fronted by **`FoodAuthGuard`** (§2A) —
> networkless Clerk verification + per-`sub` quota — before any DB/queue/USDA work. Async
> producers (EventBridge/cron/bulk-sync) are gated by least-privilege IAM (FR-048).

### Data Flow

1. **Lookup path** (synchronous): API → PostgreSQL → Redis cache → response (no USDA call)
2. **Fetch path** (async): Cache miss → EventBridge → SQS → Lambda consumer → USDA API → PostgreSQL → mark fetched
3. **Bulk path**: Multiple unknown fdcIds → single `FoodBatchRequested` event → batch Lambda → reduced queue pressure

### Key Architecture Decision

Use Architecture 5 (Event-Driven Queue-Based) per user selection. This treats the USDA rate limit as a first-class constraint and decouples data fetching from data serving.

---

## 2. Data Model

### Core Tables

```sql
-- Local USDA food data store
foods (
  fdc_id INT PRIMARY KEY,          -- USDA FoodData Central ID
  description TEXT,
  data_type TEXT,                  -- 'Foundation' | 'SR Legacy' | 'Branded'
  fetch_status TEXT,              -- 'pending' | 'fetched' | 'not_found' | 'failed'
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

-- Failed fetch tracking
usda_fetch_failures (
  fdc_id INT PRIMARY KEY,
  attempted_at TIMESTAMP,
  failure_reason TEXT,
  attempt_count INT DEFAULT 0
)

-- Pending fetch deduplication (prevents double-queuing)
usda_pending (
  fdc_id INT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  source TEXT                    -- 'single' | 'batch'
)
```

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
FoodService is a NestJS service on **ECS/Fargate behind a public ALB** (same topology as
the identity service). Therefore `FoodAuthGuard` is implemented as **NestJS `AuthMiddleware`
running in-process**, not as a Lambda authorizer:

- An **API Gateway Lambda authorizer cannot front an ALB** — Lambda authorizers are an API
  Gateway / AppSync feature; ALB has no equivalent (its only native auth is redirect-based
  `authenticate-oidc`/`authenticate-cognito`, the wrong shape for verifying a Clerk bearer
  token). Using a Lambda authorizer would require inserting `API Gateway → VPC Link → ALB →
ECS` purely to host it — an extra edge layer for no gain, since the token verifies
  networklessly in ~1ms in-process.
- The middleware **reuses the identity service's Clerk verification**: extract the
  `ClerkAuthService` verify logic (`verifyToken` + `azp`) into a shared `@kitchensink/*`
  package consumed by both services — one implementation, no drift.
- No cold start → SC-011 (≤10ms p95) is met without provisioned concurrency; the per-`sub`
  quota (FR-043) lives in the same process, right before enqueue.
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

### 2A.4 Per-user quota & queue fairness (FR-043, FR-044, FR-045, FR-046 — denial-of-wallet)

Auth ≠ rate limiting. New mechanisms, enforced **after** auth and **before** `INSERT INTO fetch_queue`:

- **Per-`sub` enqueue quota** (FR-043): leaky/token bucket of N enqueues/hr per principal; exceed → **`429`**.
  No single `sub` may consume > ~20% of the global 1,000/hr USDA budget (SC-012). State in Redis
  (`quota:{sub}`) or a Postgres table `user_fetch_quota(sub, window_start, count)`.
- **Distinct-requester demand** (FR-044): `request_count` (FR-015 priority) counts **distinct `sub`s**
  via a new `fetch_requesters(fdc_id, sub, requested_at)` table — a `sub` cannot inflate priority by
  repeating; contribution capped; ordering aged so no `fdcId` is pinned to the front. This table also
  drives WebSocket targeting (§2A.5).
- **Max batch size** (FR-045): `POST /v1/foods/batch` and recipe-import sets ≤ 100 `fdcId`s; over → `400`;
  accepted IDs count against the per-`sub` quota. (USDA's 20-ID/token cap, FR-023, stays an internal detail.)
- **Queue backpressure + circuit breaker** (FR-046): enforced max `fetch_queue` depth; when exceeded, or
  when the USDA circuit breaker is **open**, new enqueues fail closed with **`503`** (jittered recovery,
  no thundering herd). The breaker is a normative requirement, not the §6 footnote.

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

Only named, least-privilege IAM roles may `events:PutEvents` (`FoodRequested`/`FoodBatchRequested`/
`IngestionScheduled`) or `INSERT` into `fetch_queue`; the consumer validates event provenance. The
`requestedBy` field on events (§4) carries the authenticated `sub` or the named service principal —
never an unauthenticated `'system'` shortcut that bypasses the edge.

### 2A.7 Auth-layer DoS protection (FR-052, SC-011)

Bound auth-verification concurrency + per-source `401`-rate cap (load-shed) so a flood of well-formed-
but-invalid tokens (each forcing a CPU-bound signature verify before the fail-closed `401`) cannot
saturate the verifier and breach SC-009. SC-011's ≤10ms p95 is validated **under an invalid-token flood**.

### 2A.8 Config (FR-042)

`CLERK_JWT_KEY` (public PEM) + `CLERK_AUTHORIZED_PARTIES` (azp allowlist) — both non-secret. USDA API key
remains the only secret (Secrets Manager). New data: `user_fetch_quota` (or Redis), `fetch_requesters`.

---

## 3. API Contracts

### Endpoints

Auth column: **U** = user session token, **M** = M2M/service token, **scope** = additionally requires
a `public_metadata` scope. All endpoints reject with `401` (no/invalid token) before any other handling;
`429` when the per-`sub` quota (FR-043) is exceeded.

| Method | Path                            | Auth      | Description                                         |
| ------ | ------------------------------- | --------- | --------------------------------------------------- |
| GET    | `/v1/foods/{fdcId}`             | U or M    | Get food by USDA FDC ID (`200`/`202`/`404`)         |
| GET    | `/v1/foods/{fdcId}/status`      | U or M    | Poll fetch status                                   |
| GET    | `/v1/foods/search?query=`       | U or M    | Search local foods                                  |
| POST   | `/v1/foods/batch`               | U or M    | Batch fetch; ≤100 ids (`400` over), counts to quota |
| GET    | `/v1/foods/{fdcId}/nutrients`   | U or M    | Get full nutrient breakdown                         |
| GET    | `/v1/foods/autocomplete?query=` | U or M    | Autocomplete suggestions                            |
| POST   | `/v1/foods/{fdcId}/refetch`     | U + scope | Operational manual re-fetch (`403` w/o scope)       |
| WS     | `$connect`                      | U         | WebSocket subscribe (`403` reject; FR-049)          |

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

// GET /v1/foods/{fdcId} — not found (tombstoned)
404 Not Found
{
  "error": "Food not found",
  "fdcId": 999999,
  "message": "This food has been tombstoned after failed USDA lookup"
}

// Any endpoint — unauthenticated / invalid / expired / wrong-azp token (FR-035, FR-040)
401 Unauthorized
{ "error": "Unauthorized", "message": "Valid Clerk session or M2M token required" }

// Operational endpoint — authenticated but missing required scope (FR-039, FR-051)
403 Forbidden
{ "error": "Forbidden", "message": "Operation requires elevated scope" }

// Per-sub enqueue quota exceeded (FR-043)
429 Too Many Requests
{ "error": "Rate limited", "retryAfterSeconds": 120, "message": "Per-user fetch quota exceeded" }

// Batch over the max id limit (FR-045) — or queue/circuit backpressure (FR-046 → 503)
400 Bad Request   { "error": "Batch too large", "maxIds": 100 }
503 Service Unavailable   { "error": "Fetch temporarily unavailable", "retryAfterSeconds": 30 }
```

> **Status precedence (FR-051):** `401` → `403` → `400` → `404`/`202`/`200`. A malformed
> `fdcId` with a bad token returns `401` (not `400`); a valid token on a tombstoned food returns `404`.

---

## 4. Event Contracts

### EventBridge Events

```typescript
// Cache miss — single food
FoodRequested {
  eventId: string,
  timestamp: ISO8601,
  fdcId: number,
  requestedBy: string,      // authenticated Clerk sub or named service principal (FR-048; never an unauthenticated 'system' shortcut)
  priority: 'high' | 'normal'
}

// Batch import — multiple foods
FoodBatchRequested {
  eventId: string,
  timestamp: ISO8601,
  fdcIds: number[],
  source: 'import' | 'recipe',
  correlationId: string
}

// Fetch completed — for WebSocket notification
FoodFetchCompleted {
  eventId: string,
  timestamp: ISO8601,
  fdcId: number,
  status: 'fetched' | 'not_found' | 'failed'
}
```

### Fetch Queue (Postgres)

**Table**: `fetch_queue` — durable priority queue for missing-ingredient lookups.

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

**Rate limiter**: Single shared token bucket (USDA 1000 req/hr = 1 token / 3.6s) maintained in the consumer process (and refilled from a Postgres `rate_limiter_state` row if multiple consumers ever run).

**Lease timeout**: Rows stuck in `status='in_flight'` for >30s are reverted to `pending` by a watchdog query run on consumer start and every minute (recovers from consumer crashes).

**No DLQ infrastructure**: Tombstone rows (`status='tombstone'`) are the audit trail — queryable via SQL, alertable via CloudWatch metric, and reprocessable by setting `status='pending'`.

---

## 5. Lambda Functions

### food-fetch-consumer (Fargate worker, event-driven)

- **Runtime**: Node.js 22.x in a Fargate task (single instance, scale-to-zero via ECS desired-count=0/1 toggle if cost-critical)
- **Memory**: 512 MB
- **Trigger**: Postgres `LISTEN fetch_queued` (one connection held open for the worker lifetime)
- **Drain loop**: On notify wakeup → `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1 ORDER BY request_count DESC, first_requested ASC` → process → `UPDATE` → loop until queue empty → block on next NOTIFY
- **Rate limiting**: In-process token bucket capped at 1,000 req/hr to USDA API
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

- **Rate limit**: 1,000 req/hr — enforced via token bucket
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
CREATE TABLE IF NOT EXISTS usda_fetch_failures (...);
CREATE TABLE IF NOT EXISTS usda_pending (...);

-- Indexes
CREATE INDEX idx_foods_fetch_status ON foods(fetch_status) WHERE fetch_status = 'pending';
CREATE INDEX idx_foods_search ON foods USING GIN(search_vector);
CREATE INDEX idx_foods_data_type ON foods(data_type);
```

---

## 8. Monitoring & Observability

### CloudWatch Metrics

- `usda-fetch-queue-depth` — SQS queue depth
- `usda-api-request-count` — success/failure rate
- `usda-api-latency` — p50/p95/p99
- `usda-token-bucket-available` — remaining capacity
- `food-cache-hit-rate` — Redis hit rate

### Alarms

- DLQ depth > 0 → SNS alert
- API error rate > 5% → SNS alert
- Queue depth > 10,000 → SNS alert

---

## 9. Open Questions (from Research)

1. **Branded Foods sync**: Full 3.1 GB monthly update vs incremental API — preference?
2. **WebSocket notifications**: Required as optional enhancement per FR-034 — deferred or in-scope for initial release?

---

## 10. Implementation Order

1. **PostgreSQL schema** — foods table, indexes, sync metadata
2. **REST API endpoints** — GET /v1/foods/{fdcId}, /status, /search
3. **Redis cache layer** — cache-aside pattern
4. **SQS queue + consumer Lambda** — token bucket rate limiter
5. **EventBridge events** — FoodRequested, FoodBatchRequested
6. **Bulk sync Lambda** — weekly Foundation/SR Legacy download
7. **Monitoring + alarms**
8. **WebSocket notifications** (P3, deferred)
