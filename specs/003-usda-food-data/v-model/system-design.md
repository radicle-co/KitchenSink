# System Design: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/requirements.md`

## Overview

Event-driven, queue-based architecture for USDA FoodData Central integration. The HTTP read API is a NestJS service running on ECS/Fargate behind a public ALB; user-facing food lookups are served from local PostgreSQL (with optional Redis cache; lean-launch default is Postgres) — the USDA API is never called in the request path. Cache misses and pending foods trigger async backfill via an `INSERT … ON CONFLICT` into the single Postgres `fetch_queue` (Postgres-as-queue) paired with `pg_notify`, drained over `LISTEN/NOTIFY` by a single Fargate consumer worker (single instance via advisory lock), rate-limited to ≤1,000 USDA API calls in any trailing 60 minutes via a rolling-60-minute-window limiter (the worker pauses draining at 90% / 900). Demand is counted as **distinct authenticated requesters** (`sub`s) per `fdcId` — tracked in `fetch_requesters` and folded into a capped `request_count` — not raw request volume; the worker drains `ORDER BY <effective_priority> DESC, first_requested ASC` with aging (so no `fdcId` is pinned to the front indefinitely) and per-`sub` demotion (a single `sub` holding >50 pending items is ranked to the back, dynamically, computed at drain time). Rows carry a single `status` of `pending | in_flight | tombstone`; a successful fetch upserts the food and **deletes** the row. Each lease is a single **30s** `in_flight` lease (FR-018). EventBridge is used only for scheduled producers (stale-refresh / bulk-sync) and the `FoodDataReceived` completion event — never the demand-path enqueue. The system handles eventual consistency via client polling. (A WebSocket push notifier on API Gateway WebSocket API is deferred to US-9 and is the only Lambda-authorizer surface.)

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Parent Requirements                                                                                                                                                                                   | Type      |
| ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| SYS-001 | FoodApiController           | NestJS controller in the food read service running on ECS/Fargate behind a public ALB. Handles all food lookup endpoints with in-process `AuthMiddleware`/`FoodAuthGuard` (SYS-013). Serves from local store only; never calls USDA API directly. Returns 200/202/404/400 based on local fetch_status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-031, REQ-033                                                                                            | Component |
| SYS-002 | EventBridgeBus              | Event bus for **scheduled producers only** (stale-refresh / bulk-sync, `IngestionScheduled`) and the `FoodDataReceived` completion event. It is **not** on the demand-path enqueue — cache-miss enqueues are `INSERT … ON CONFLICT` into `fetch_queue` + `pg_notify` directly from SYS-001. Decouples scheduled producers and completion consumers from the API service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | REQ-032, REQ-IF-005                                                                                                                                                                                   | Component |
| SYS-003 | FetchQueue                  | The single Postgres `fetch_queue` (Postgres-as-queue) — every fetch unit of work, regardless of origin (demand-path lookups, batch/recipe-triggered, and periodic refresh), is one row in this one table. There is **no** static high/low partition: ordering is **demand-weighted** at drain time, `ORDER BY <effective_priority> DESC, first_requested ASC`, where `effective_priority` is the capped distinct-`sub` `request_count` (SYS-001/SYS-013 → SYS-003 via `fetch_requesters`, FR-044) with aging, and a `sub` holding >50 pending rows is demoted to the back (dynamic, computed at drain time). Rows carry a single `status` of `pending \| in_flight \| tombstone`. Drained by the Fargate consumer worker via `LISTEN/NOTIFY`. Lower-demand origins (batch/scheduled) simply enqueue with lower demand, not into a separate queue.    | REQ-013, REQ-014, REQ-015, REQ-031, REQ-039                                                                                                                                                           | Component |
| SYS-004 | FetchRequesters             | Postgres `fetch_requesters` table modeling **distinct-requester demand** (FR-044): `(fdc_id, sub)` upserted `ON CONFLICT DO NOTHING` per request so a single `sub`'s repeats never re-count. The demand-weighted `request_count` on each `fetch_queue` row (SYS-003) is derived as the **capped** distinct-`sub` count (`PRIORITY_CAP = 1` — each `sub` contributes at most 1, never raw `request_count + 1`), with aging applied so no `fdcId` is pinned to the front. Also the authoritative subscription set the WebSocket notifier (SYS-010) uses for per-recipient targeting and the source of each `sub`'s pending-count for SYS-013 demotion fairness. Not a separate queue — a demand index over the single `fetch_queue`.                                                                                                                   | REQ-014, REQ-039                                                                                                                                                                                      | Component |
| SYS-005 | FoodConsumerWorker          | Rate-limited Fargate consumer worker (single instance via advisory lock) that drains the single Postgres `fetch_queue` via `LISTEN/NOTIFY` in demand-weighted order (`ORDER BY <effective_priority> DESC, first_requested ASC` with dynamic >50-pending demotion; no high/low split). Claims one row under a single **30s** `in_flight` lease (FR-018); a stale `in_flight` row older than 30s reverts to `pending` for crash recovery. Calls USDA API via the rolling-window limiter (≤1,000 in any trailing 60 min; pauses at 90%). Processes up to 20 fdcIds per batch API call. On success upserts the food into PostgreSQL and **deletes** the `fetch_queue` row (invalidates the optional Redis cache when present); validates async-producer provenance before processing (FR-048).                                                           | REQ-015, REQ-016, REQ-017, REQ-024, REQ-027, REQ-042                                                                                                                                                  | Component |
| SYS-006 | RollingWindowLimiter        | Rolling-60-minute-window limiter holding the Fargate consumer worker to ≤1,000 USDA API calls in any trailing 60 minutes (worker pauses draining at 90% / 900; resumes as calls age out). State = recent USDA-call timestamps in a Postgres `usda_call_log` by default; a Redis sorted set is the deferred post-launch variant. On USDA `429`, backs off (treats the window as full). Prevents throttling and strictly enforces the hard cap.                                                                                                                                                                                                                                                                                                                                                                                                        | REQ-019, REQ-020, REQ-021, REQ-026                                                                                                                                                                    | Component |
| SYS-007 | FoodDataPostgresRepository  | PostgreSQL-backed persistent store for food data and fetch_status tracking. Contains foods table with fdcId, description, nutrition fields, fetch_status, fetched_at, last_requested_at, request_count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-020, REQ-021                                                                                                                                         | Component |
| SYS-008 | FoodDataRedisCache          | Optional Redis cache (deferred post-launch variant; lean-launch default is Postgres) for hot food data (TTL 24h). Pending-fetch deduplication is the `fetch_queue` `ON CONFLICT` row, not a Redis set. Role 1: hot cache. Role 2: rolling-window limiter state (Redis sorted-set variant). Role 3: dedup is the `fetch_queue` row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | REQ-001, REQ-030                                                                                                                                                                                      | Component |
| SYS-009 | USDAFoodDataCentralApi      | External USDA FoodData Central REST API. Called exclusively by the Fargate consumer worker via rolling-window-controlled HTTP. Used for batch (up to 20 IDs) and single food lookups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | REQ-016, REQ-017, REQ-024                                                                                                                                                                             | Component |
| SYS-010 | WebSocketNotificationLambda | Optional Lambda triggered by FoodDataReceived events from EventBridge. Pushes real-time updates to connected clients via API Gateway WebSocket API. Launch deferred (US-9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | REQ-034, REQ-043, REQ-IF-008                                                                                                                                                                          | Component |
| SYS-011 | SecretManagement            | AWS Secrets Manager integration for USDA API key storage and rotation. Injected into the Fargate consumer worker environment via secure parameter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | REQ-IF-006                                                                                                                                                                                            | Component |
| SYS-012 | MonitoringAndLogging        | CloudWatch for the ECS/Fargate API service and the Fargate consumer worker logs, metrics, and alarms. X-Ray tracing for distributed request visibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | REQ-NF-012, REQ-NF-016                                                                                                                                                                                | Component |
| SYS-013 | AuthnAuthzLayer             | Named Clerk authentication & authorization component fronting **every** food data entry point. Networkless `@clerk/backend` `verifyToken` against non-secret `CLERK_JWT_KEY` with `azp` allowlist, fail-closed `401`. Two deployment surfaces: (1) in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate HTTP service behind the public ALB (HTTP routes); (2) a WebSocket `$connect` Lambda authorizer (pinned `403`). Emits the `AuthenticatedCaller` principal (`sub`, `azp`, scopes from `public_metadata`), enforces scope `403`/precedence, per-`sub` demotion fairness (>50 pending → ranked to back; no `429`), batch/queue bounds (`400`/`503`), M2M token class, async-producer provenance, and auth-layer load-shed. Reuses the identity service's `ClerkAuthService` verify logic via a shared `@kitchensink/*` package. | REQ-035, REQ-IF-007, REQ-IF-008, REQ-037a, REQ-037b, REQ-037c, REQ-037d, REQ-038a, REQ-038b, REQ-038c, REQ-039, REQ-040a, REQ-040b, REQ-041, REQ-042, REQ-043, REQ-044a, REQ-044b, REQ-044c, REQ-044d | Component |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship  | Failure Impact                                                                                                                                                                                                                                                                                                                         |
| ------- | ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-001 | SYS-003 | Enqueues      | Demand-path enqueue is `INSERT … ON CONFLICT` into the single `fetch_queue` + `pg_notify` (no EventBridge). If the insert fails, food fetch is lost; client gets stale data or 404                                                                                                                                                     |
| SYS-001 | SYS-004 | Records       | Demand-path upsert `(fdc_id, sub)` into `fetch_requesters` `ON CONFLICT DO NOTHING` to count distinct requesters (caps the derived `request_count`). If it fails, demand weighting degrades to last-known counts; ordering still functions                                                                                             |
| SYS-001 | SYS-007 | Reads         | If PostgreSQL unavailable, the API service returns 503; no graceful degradation                                                                                                                                                                                                                                                        |
| SYS-001 | SYS-008 | Reads         | If Redis unavailable, falls through to PostgreSQL; slight latency increase                                                                                                                                                                                                                                                             |
| SYS-002 | SYS-003 | Enqueues      | Scheduled producers (`IngestionScheduled` stale-refresh / bulk-sync) `INSERT` low-demand rows into the single `fetch_queue`. If the insert fails, scheduled refresh/bulk-sync rows are lost; tombstone rows capture terminal failures                                                                                                  |
| SYS-003 | SYS-005 | Feeds         | The single `fetch_queue` feeds the consumer worker in demand-weighted order (with dynamic demotion). If the consumer worker is behind, rows accumulate; food data delayed                                                                                                                                                              |
| SYS-004 | SYS-005 | Weights       | `fetch_requesters` supplies the capped distinct-`sub` demand count and per-`sub` pending count used to compute `<effective_priority>`/demotion at drain time. If unavailable, the worker falls back to last-known `request_count`; ordering degrades but draining continues                                                            |
| SYS-005 | SYS-006 | Calls         | If the RollingWindowLimiter is unavailable, the consumer worker cannot call USDA API safely                                                                                                                                                                                                                                            |
| SYS-005 | SYS-007 | Writes        | If PostgreSQL write fails, USDA data lost; retry with exponential backoff                                                                                                                                                                                                                                                              |
| SYS-005 | SYS-008 | Invalidates   | If Redis invalidate fails, stale data may be served from cache up to TTL (24h)                                                                                                                                                                                                                                                         |
| SYS-005 | SYS-009 | Calls         | If USDA API unavailable, the consumer worker retries with backoff (FR-016) and tombstones after 5 attempts                                                                                                                                                                                                                             |
| SYS-005 | SYS-011 | Reads         | If Secrets Manager unavailable, the consumer worker cannot obtain API key; stops processing                                                                                                                                                                                                                                            |
| SYS-007 | SYS-008 | Reads         | Optional cache backfill on read miss; not a hard dependency                                                                                                                                                                                                                                                                            |
| SYS-008 | SYS-007 | Reads         | Redis miss falls through to PostgreSQL; not a failure path                                                                                                                                                                                                                                                                             |
| SYS-010 | SYS-001 | Publishes     | WebSocket push is fire-and-forget; failure does not affect the API service                                                                                                                                                                                                                                                             |
| SYS-013 | SYS-001 | Fronts        | In-process middleware on ECS/Fargate; every HTTP route is gated. If verification fails, request is rejected `401`/`403` before business logic — no enqueue, no USDA call                                                                                                                                                               |
| SYS-013 | SYS-010 | Fronts        | WebSocket `$connect` Lambda authorizer; unauthenticated connections rejected (`403`) before establishment. Recipient targeting uses the verified `sub` via the requester set                                                                                                                                                           |
| SYS-013 | SYS-003 | Gates         | Per-`sub` demotion fairness (>50 pending → ranked to back, dynamic at drain time; no `429`) and `fetch_queue` depth / circuit-breaker bounds (`503`) applied after authn, before/at the `fetch_queue` INSERT … ON CONFLICT; async producers must present an authorized principal                                                       |
| SYS-001 | SYS-013 | Authenticates | API service depends on the auth layer to resolve the `AuthenticatedCaller`; if the auth layer is misconfigured (missing `CLERK_JWT_KEY`) it fails closed to `401`                                                                                                                                                                      |
| SYS-010 | SYS-013 | Authenticates | WebSocket `$connect` depends on the `$connect` authorizer to verify the token before the connection is accepted                                                                                                                                                                                                                        |
| SYS-002 | SYS-005 | Validates     | Consumer-side provenance check (FR-048): SYS-005 validates that each drained `fetch_queue` row / `IngestionScheduled` event originated from an authorized principal (named least-privilege IAM producer or an `AuthenticatedCaller`). If provenance is absent, the row is not processed — no USDA call for an unauthenticated producer |

### Dependency Diagram

```text
Client ─(Bearer token)→ SYS-013 (AuthnAuthzLayer) ─[401/403 fail-closed]
   ├─ HTTP:  in-proc NestJS AuthMiddleware on ECS/Fargate (ALB) ─→ SYS-001 (FoodApiController)
   └─ WS:    $connect Lambda authorizer ───────────────────────→ SYS-010 (WebSocket)
                        ↓ (AuthenticatedCaller; per-sub demotion >50 pending / queue 503 before publish)
Client → ALB → ECS/Fargate NestJS service → SYS-001 (FoodApiController)
                        ↓ INSERT … ON CONFLICT + pg_notify (demand path; NO EventBridge)
                        ├─ upsert (fdc_id, sub) → SYS-004 (fetch_requesters: distinct-requester demand, cap=1)
                        ↓                                ↘ supplies capped request_count + per-sub pending count
              SYS-003 (single fetch_queue; status pending|in_flight|tombstone) ──┐
                        ↑                                                         ├─ LISTEN/NOTIFY (demand-weighted ORDER BY <effective_priority> DESC, first_requested ASC; >50-pending demotion) ─→ SYS-005 (Fargate ConsumerWorker; 30s in_flight lease) ──→ SYS-009 (USDA API)
                        │ INSERT (scheduled only: IngestionScheduled)                    ↓ calls                                    ↓ writes (success ⇒ delete row; 404 ⇒ status=tombstone)
                   SYS-002 (EventBridge: scheduled producers + FoodDataReceived) ─ validates provenance → SYS-005
                        │                                          SYS-006 (RollingWindowLimiter)
                        │                                          ↓ writes
                   (tombstone rows on terminal failure)        SYS-007 (PostgreSQL)
                                                                   ↑ reads/writes
                   SYS-011 (SecretsManager) ←── reads ── SYS-005
                        │
                        └──USDA API key──→
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Interface                          | Direction | Description                                                                                                                             |
| ---------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ALB → ECS/Fargate NestJS REST API  | Inbound   | `GET /v1/foods/{fdcId}`, `GET /v1/foods/search`, `GET /v1/foods/{fdcId}/status`, `GET /v1/foods/{fdcId}/nutrition`                      |
| USDA FoodData Central API          | Outbound  | `POST /v1/foods` (batch up to 20 IDs), rate-limited to ≤1,000 calls in any trailing 60 minutes (rolling window)                         |
| WebSocket API (optional, deferred) | Outbound  | Real-time `FoodDataReceived` push to connected clients                                                                                  |
| Clerk session/M2M token (Bearer)   | Inbound   | Presented at every HTTP entry point and WebSocket `$connect`; verified networklessly via `CLERK_JWT_KEY` (no IdP round trip) by SYS-013 |

### Internal Interfaces

| SYS-NNN           | Interface Contract                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-001 → SYS-004 | Distinct-requester record: `INSERT INTO fetch_requesters (fdc_id, sub) VALUES (...) ON CONFLICT (fdc_id, sub) DO NOTHING` (a `sub`'s repeats never re-count, FR-044)                                                                                                                                                                                                               |
| SYS-001 → SYS-003 | Demand enqueue: `INSERT INTO fetch_queue (fdc_id, ...) VALUES (...) ON CONFLICT (fdc_id) DO UPDATE SET request_count = LEAST((SELECT count(DISTINCT sub) FROM fetch_requesters WHERE fdc_id = excluded.fdc_id), PRIORITY_CAP-derived cap), last_requested = now()` + `pg_notify('fetch_queued', fdc_id)` — capped distinct-`sub` count, **never** raw `request_count + 1` (FR-044) |
| SYS-001 → SYS-007 | SQL: `SELECT * FROM foods WHERE fdcId = $1`                                                                                                                                                                                                                                                                                                                                        |
| SYS-002 → SYS-003 | Scheduled-producer enqueue: `INSERT INTO fetch_queue (fdc_id, ...) ON CONFLICT (fdc_id) DO UPDATE SET last_requested = now()` (low-demand `IngestionScheduled` stale-refresh / bulk-sync; demand still counted via `fetch_requesters`, not raw +1)                                                                                                                                 |
| SYS-005 → SYS-006 | Atomic check-and-record on the Postgres `usda_call_log` (count trailing-60-min calls + insert the new call in one transaction; Redis sorted-set Lua variant deferred); returns `{ allowed: bool, windowCount: number }`                                                                                                                                                            |
| SYS-005 → SYS-009 | HTTP POST with Authorization header (API key from Secrets Manager)                                                                                                                                                                                                                                                                                                                 |
| SYS-005 → SYS-007 | UPSERT: `INSERT INTO foods (...) VALUES (...) ON CONFLICT (fdcId) DO UPDATE SET ...`                                                                                                                                                                                                                                                                                               |
| SYS-005 → SYS-008 | DEL command on `food:{fdcId}` key (optional Redis cache); on success the pending row is cleared by **deleting the `fetch_queue` row** (`DELETE FROM fetch_queue WHERE fdc_id = $1`), not a status flag and not a Redis set (FR-024)                                                                                                                                                |
| SYS-011 → SYS-005 | Environment variable injection: `USDA_API_KEY`                                                                                                                                                                                                                                                                                                                                     |
| SYS-013 → SYS-001 | Verified `AuthenticatedCaller` `{ sub, azp, scopes }` surfaced to HTTP handlers (req context); rejects with `401`/`403`                                                                                                                                                                                                                                                            |
| SYS-013 → SYS-010 | `$connect` authorizer policy (Allow/Deny); verified `sub` passed via WebSocket `$context.authorizer`                                                                                                                                                                                                                                                                               |
| SYS-013 → SYS-003 | Pre-enqueue gate: `fetch_queue` depth / circuit-breaker check (`503`) before `INSERT INTO fetch_queue`; per-`sub` fairness is demotion at drain time (>50 pending → ranked to back, dynamic), not a quota `429`                                                                                                                                                                    |

### Interface Contracts Table

| Contract ID | SYS Source | SYS Target | Operation          | Request Schema                                                                                                                                                                                                                                                                                          | Response Schema                                                                                                                          |
| ----------- | ---------- | ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| IC-001      | SYS-001    | SYS-003    | EnqueueFetch       | `INSERT INTO fetch_requesters (fdc_id, sub) ON CONFLICT (fdc_id, sub) DO NOTHING`; then `INSERT INTO fetch_queue (fdc_id) ON CONFLICT (fdc_id) DO UPDATE SET request_count = capped distinct-`sub`count (each`sub`≤ 1; never raw`+ 1`), last_requested = now()` + `pg_notify('fetch_queued')` (FR-044)  | `{ enqueued: boolean }`                                                                                                                  |
| IC-002      | SYS-001    | SYS-007    | QueryFood          | `fdcId: number`                                                                                                                                                                                                                                                                                         | `FoodData \| NotFound \| Pending`                                                                                                        |
| IC-003      | SYS-005    | SYS-006    | CheckAndRecordCall | none                                                                                                                                                                                                                                                                                                    | `{ allowed: boolean, windowCount: number }`                                                                                              |
| IC-004      | SYS-005    | SYS-009    | FetchFoods         | `{ fdcIds: number[] }`                                                                                                                                                                                                                                                                                  | `USDAFoodResponse[]`                                                                                                                     |
| IC-005      | SYS-005    | SYS-007    | UpsertFood         | `FoodData`                                                                                                                                                                                                                                                                                              | `{ success: boolean }`                                                                                                                   |
| IC-006      | SYS-013    | SYS-001    | VerifyToken        | `Authorization: Bearer <Clerk JWT>` — either a **user session token** (`sub` = human Clerk user) or a **machine (M2M) token** (`sub` = service identity); both verified networklessly via `CLERK_JWT_KEY` with `azp ∈ CLERK_AUTHORIZED_PARTIES` (no Clerk secret key on the request path, FR-047/A-012) | `AuthenticatedCaller { sub, azp, scopes } \| 401 \| 403`                                                                                 |
| IC-007      | SYS-013    | SYS-003    | GateEnqueue        | `{ sub, fdcIds }`                                                                                                                                                                                                                                                                                       | `Allow (normal priority) \| Allow (demoted — sub >50 pending) \| 503 (backpressure)`                                                     |
| IC-008      | SYS-013    | SYS-001    | ValidateBatch      | `{ sub, fdcIds: number[] }` (`POST /v1/foods/batch`)                                                                                                                                                                                                                                                    | `Accepted (≤ 100 IDs) — per-item partial: cached/stale inline + each miss `pending` (enqueued) \| 400 (batch cap exceeded — no enqueue)` |
| IC-009      | SYS-013    | SYS-010    | AuthorizeConnect   | `$connect` token (query param / `Sec-WebSocket-Protocol` subprotocol)                                                                                                                                                                                                                                   | `Allow { $context.authorizer.sub } \| 403 (pinned $connect rejection)`                                                                   |

## Data Flow View (IEEE 1016 §5.4)

### Path 0: Auth Edge (SYS-013 — fronts every entry point)

Every entry point flows through SYS-013 before SYS-001 business logic, the quota gate, or any enqueue. SYS-013 fails closed; Paths 1–4 below begin only after this gate is passed.

```
Client → (Authorization: Bearer <Clerk session/M2M token>)
  → ALB → ECS/Fargate NestJS service → AuthMiddleware/FoodAuthGuard (SYS-013)
    → verifyToken(CLERK_JWT_KEY, azp) — networkless [fail-closed]
       ├─ missing/invalid/expired token | azp mismatch | verify error → 401 (no enqueue, no USDA call)
       ├─ operational endpoint, scope absent from public_metadata     → 403
       └─ valid → req.user = AuthenticatedCaller { sub, azp, scopes }
            → pre-enqueue backpressure + fairness gate (at the fetch_queue INSERT … ON CONFLICT + pg_notify)
               ├─ fetch_queue depth exceeded | circuit open → 503 (fail closed)
               ├─ sub has >50 pending → enqueue accepted but ranked to BACK (demotion; no 429), dynamic at drain time
               └─ within budget → hand off to SYS-001 (Paths 1–4)
  (status precedence: 401 → 403 → 400 → 404/202/200)
```

(WebSocket `$connect`, SYS-010, deferred US-9: SYS-013's `$connect` Lambda authorizer verifies the same token and pins rejection to `403` before connection establishment.)

### Path 1: Food Lookup (Cache Hit)

```
Client → GET /v1/foods/12345
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → Redis GET food:12345 (SYS-008) [HIT]
    → Return 200 { fdcId, description, nutrition, fetch_status: 'fetched' }
  → Client
```

### Path 2: Food Lookup (Cache Miss, DB Hit)

```
Client → GET /v1/foods/12345
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → Redis GET food:12345 (SYS-008) [MISS]
    → PostgreSQL SELECT * FROM foods WHERE fdcId = 12345 (SYS-007) [HIT, fetch_status = 'fetched']
    → Redis SET food:12345 TTL 24h (SYS-008)
    → Return 200 { fdcId, description, nutrition, fetch_status: 'fetched' }
  → Client
```

### Path 2b: Food Lookup (DB Hit, Stale — Stale-While-Revalidate)

```
Client → GET /v1/foods/12345
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → PostgreSQL SELECT … (SYS-007) [HIT, fetch_status = 'stale' — fetched_at older than threshold]
    → INSERT INTO fetch_queue (12345, ...) ON CONFLICT … (SYS-003) + pg_notify (background re-fetch)
    → Return 200 { fdcId, ..., fetch_status: 'stale', stale: true }  ← serve stale immediately, never blocks
  → Client (read self-heals on next access; if re-fetch keeps failing, stale data served indefinitely)
```

### Path 3: Food Lookup (Cache Miss, DB Miss, New Food)

```
Client → GET /v1/foods/12345
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → Redis GET food:12345 [MISS] (optional cache)
    → PostgreSQL SELECT [MISS, fetch_status NOT EXISTS]
    → INSERT INTO fetch_requesters (12345, sub) ON CONFLICT (fdc_id, sub) DO NOTHING (SYS-004 — distinct-requester demand, FR-044)
    → INSERT INTO fetch_queue (fdc_id, ...) VALUES (12345, ...) ON CONFLICT (fdc_id) DO UPDATE SET request_count = capped distinct-`sub` count (each sub ≤ 1; never raw + 1), last_requested = now() (SYS-003)
    → pg_notify('fetch_queued', '12345')
    → Return 202 { status: 'pending', fdcId: 12345, estimatedWaitSeconds: 30, partialData }
  → Client polls GET /v1/foods/12345/status until 200
```

### Path 4: Consumer Worker Processing (Demand-Weighted Drain)

```
Postgres LISTEN/NOTIFY (fetch_queued) → Fargate ConsumerWorker (SYS-005)
  → validate row provenance (authorized principal / named IAM producer, FR-048) — drop unauthenticated producers
  → SELECT … FROM fetch_queue WHERE status='pending' AND last_requested <= now()
       ORDER BY (requester pending-count > 50) ASC, request_count DESC, first_requested ASC
       FOR UPDATE SKIP LOCKED LIMIT 1
     (single demand-weighted queue: capped distinct-`sub` request_count with aging + dynamic >50-pending demotion; no high/low split)
     (NOTE: the leading boolean `(requester pending-count > 50) ASC` term IS the `<effective_priority>` demotion overlay of REQ-015/REQ-039 — false (0) sorts ahead of true (1), ranking a >50-pending requester to the back at drain time; it is not query drift)
  → UPDATE fetch_queue SET status='in_flight', last_requested=now() WHERE fdc_id=12345   (single 30s in_flight lease, FR-018; stale in_flight >30s reverts to pending)
  → RollingWindowLimiter.CheckAndRecordCall() (SYS-006) [allowed — trailing-60-min count < cap]
  → HTTP POST USDA /v1/foods { fdcIds: [12345] }
  → Parse USDA response
  → PostgreSQL UPSERT foods (SYS-007)
  → on 200 success: DELETE FROM fetch_queue WHERE fdc_id=12345 (row removed — no 'done' status) + Redis DEL food:12345 (optional cache, SYS-008)
       (on USDA 404: UPDATE fetch_queue SET status='tombstone' instead — durable audit row, 30d TTL; no delete)
  → EventBridge Publish FoodDataReceived { fdcId: 12345, fetchedAt: ... }
```

### Path 5: Consumer Worker Rate-Limited (No Tokens)

```
Postgres LISTEN/NOTIFY (fetch_queued) → Fargate ConsumerWorker (SYS-005)
  → RollingWindowLimiter.CheckAndRecordCall() [NOT allowed, trailing-60-min count ≥ cap (or ≥90% pause threshold)]
  → revert any 30s in_flight lease back to status='pending' (no USDA call); pause draining / back off
  → Row remains 'pending'; reprocessed once earlier calls age out of the window
```

## Physical View

| Component            | AWS Resource                                               | Region    | Notes                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALB                  | Application Load Balancer                                  | us-east-1 | Public; HTTP entry point fronting the food read service                                                                                                                                                    |
| FoodApiService       | ECS/Fargate service                                        | us-east-1 | NestJS REST API (SYS-001); in-process `AuthMiddleware` (SYS-013)                                                                                                                                           |
| EventBridge          | Default event bus                                          | us-east-1 | Scheduled producers (stale-refresh / bulk-sync) + `FoodDataReceived` only; not on demand path                                                                                                              |
| FetchQueue           | Postgres `fetch_queue` table                               | us-east-1 | SYS-003; single demand-weighted queue (no high/low split); `status pending\|in_flight\|tombstone`; single 30s `in_flight` lease (FR-018); success ⇒ row deleted, USDA 404 ⇒ `status='tombstone'` (30d TTL) |
| FetchRequesters      | Postgres `fetch_requesters` table                          | us-east-1 | SYS-004; `(fdc_id, sub)` distinct-requester demand (cap=1) feeding the capped `request_count`; also the WebSocket subscription set (FR-044/FR-041)                                                         |
| ConsumerWorker       | ECS/Fargate task                                           | us-east-1 | Fargate consumer worker (SYS-005); single instance via advisory lock; LISTEN/NOTIFY drain                                                                                                                  |
| RollingWindowLimiter | Postgres `usda_call_log`                                   | us-east-1 | Postgres default (lean-launch); Redis sorted set is a deferred post-launch variant                                                                                                                         |
| PostgreSQL           | `kitchensink_food` DB on shared `kitchensink-data-{stage}` | us-east-1 | Logical database on the shared instance; no new RDS, no cluster                                                                                                                                            |
| RedisCache           | ElastiCache Redis                                          | us-east-1 | Deferred post-launch variant; lean-launch default is Postgres                                                                                                                                              |
| SecretsManager       | Secrets Manager                                            | us-east-1 | USDA API key rotation                                                                                                                                                                                      |
| WebSocketNotifier    | API Gateway WebSocket + Lambda                             | us-east-1 | Deferred (US-9); `$connect` Lambda authorizer (SYS-010/SYS-013)                                                                                                                                            |
| CloudWatch           | Log groups, metrics, alarms                                | us-east-1 | API service + consumer worker logging                                                                                                                                                                      |

## Trade-off Decisions

| Decision                    | Chosen Option                                                                                                                                                                                                             | Rationale                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| USDA API call path          | Async via Postgres `fetch_queue` (not sync in API service)                                                                                                                                                                | Decouples user latency from USDA availability                                                                                                   |
| Notification mechanism      | Client polling (not WebSocket)                                                                                                                                                                                            | Simpler launch; WebSocket deferred to US-9                                                                                                      |
| Cache layer                 | PostgreSQL by default (Redis deferred post-launch)                                                                                                                                                                        | Lean launch; add Redis hot cache when p95 warrants it                                                                                           |
| Rate limiter implementation | Rolling 60-min window — Postgres `usda_call_log` atomic count+insert (Redis sorted-set variant deferred)                                                                                                                  | Strictly enforces ≤1,000 in any trailing hour (a refilling bucket could emit ~2,000); worker pauses at 90%                                      |
| Fairness model              | Demotion (>50 pending → ranked to back, dynamic at drain time), not per-user quota `429`                                                                                                                                  | Work-conserving; no legitimate request rejected; heavy users use only spare capacity                                                            |
| Stale-record read           | Stale-while-revalidate (serve stale `200` + background re-fetch; serve indefinitely on repeated failure)                                                                                                                  | Read never blocks on USDA; availability over freshness                                                                                          |
| Queue priority              | Single demand-weighted `fetch_queue` (`ORDER BY <effective_priority> DESC, first_requested ASC`; capped distinct-`sub` `request_count` via `fetch_requesters` + aging + >50-pending demotion) — no static high/low queues | One queue; distinct-requester demand (not raw volume) keeps user-facing lookups ahead of batch enrichment without starving single-request items |
| Database initial sizing     | Shared `kitchensink-data-{stage}` instance (`kitchensink_food` DB)                                                                                                                                                        | Reuses shared instance; no new RDS, grows with demand                                                                                           |

## Component Traceability Detail

### Component: SYS-001 (FoodApiController)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-031, REQ-033

**Traceability Rationale**: SYS-001 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views, including the stale-while-revalidate read that serves stale data as `200` and enqueues a background re-fetch (REQ-031, Path 2b) and the client-polling `GET /v1/foods/{fdcId}/status` notification path (REQ-033). It is a NestJS controller in the food read service deployed on ECS/Fargate behind the public ALB, with SYS-013's `AuthMiddleware`/`FoodAuthGuard` running in-process ahead of every route handler (no API Gateway / Lambda authorizer on the HTTP path — plan §2A).

### Component: SYS-002 (EventBridgeBus)

**Parent Requirements**: REQ-032, REQ-IF-005

**Traceability Rationale**: SYS-002 carries **only** scheduled-producer events (`IngestionScheduled` stale-refresh / bulk-sync, REQ-032) and the `FoodDataReceived` completion event, whose event contract/schema is REQ-IF-005. It is **not** on the demand-path enqueue — cache-miss enqueues go directly to the `fetch_queue` via `INSERT … ON CONFLICT` + `pg_notify` from SYS-001 (REQ-011/REQ-012), so SYS-002 no longer traces to the demand-path requirements. It implements its parents through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-003 (FetchQueue)

**Parent Requirements**: REQ-013, REQ-014, REQ-015, REQ-031, REQ-039

**Traceability Rationale**: SYS-003 is the **single** Postgres `fetch_queue` — there is no static high/low partition. It implements dedup (`ON CONFLICT`, REQ-013), single-queue demand-weighted admission (REQ-014), demand-weighted drain ordering with aging (REQ-015), the dynamic >50-pending demotion overlay (REQ-039), computed at drain time, and absorbs the stale-while-revalidate background re-fetch row enqueued on a stale read (REQ-031, Path 2b). Rows carry a single `status` of `pending | in_flight | tombstone`; success deletes the row (FR-024) and a USDA `404` sets `status='tombstone'` (FR-025). Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-004 (FetchRequesters)

**Parent Requirements**: REQ-014, REQ-039

**Traceability Rationale**: SYS-004 is the Postgres `fetch_requesters` table that models **distinct-requester demand** (FR-044): `(fdc_id, sub)` upserted `ON CONFLICT DO NOTHING` so a single `sub`'s repeats never re-count, capping each `sub`'s contribution at 1 (`PRIORITY_CAP`). It is the source of the capped `request_count` feeding SYS-003's ordering (REQ-014), each `sub`'s pending count for the demotion overlay (REQ-039), and the subscription set for per-recipient WebSocket targeting (FR-041). It is **not** a second queue. Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-005 (FoodConsumerWorker)

**Parent Requirements**: REQ-015, REQ-016, REQ-017, REQ-024, REQ-027, REQ-042

**Traceability Rationale**: SYS-005 drains the single `fetch_queue` in demand-weighted order with dynamic demotion (REQ-015), claims one row under a single **30s** `in_flight` lease and reverts stale `in_flight` rows to `pending` for crash recovery (REQ-017), retries transient failures up to 5 attempts then tombstones (REQ-016/REQ-027), on success upserts the food and **deletes** the row (REQ-024), and validates async-producer provenance before processing each row (REQ-042/FR-048). Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-006 (RollingWindowLimiter)

**Parent Requirements**: REQ-019, REQ-020, REQ-021, REQ-026

**Traceability Rationale**: SYS-006 enforces the rolling-60-minute window of ≤1,000 USDA calls and the worker pause at 90%/900 (REQ-019), performs the atomic check-and-record on the `usda_call_log` (REQ-020), holds the consumer below the cap by re-deferring the `fetch_queue` row lease when at the 1,000/hr cap (REQ-021), and backs off treating the window as full on a USDA `429` (REQ-026). Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views. (Tombstone-row TTL retention, REQ-018, belongs to SYS-003, not the limiter.)

### Component: SYS-007 (FoodDataPostgresRepository)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-020, REQ-021

**Traceability Rationale**: SYS-007 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-008 (FoodDataRedisCache)

**Parent Requirements**: REQ-001, REQ-030

**Traceability Rationale**: SYS-008 is the optional Redis hot cache (deferred post-launch variant; the lean-launch default is the PostgreSQL local store, REQ-001). When enabled it uses the `food:{fdcId}` key format with a 24h TTL and `allkeys-lfu` eviction (REQ-030). The single-consumer/USDA-batch behavior (REQ-022/REQ-023) belongs to SYS-005/SYS-009, not the cache. Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-009 (USDAFoodDataCentralApi)

**Parent Requirements**: REQ-016, REQ-017, REQ-024

**Traceability Rationale**: SYS-009 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-010 (WebSocketNotificationLambda)

**Parent Requirements**: REQ-034, REQ-043, REQ-IF-008

**Traceability Rationale**: SYS-010 is the optional WebSocket push notifier (deferred US-9) that emits `FoodDataReceived`-triggered pushes to connected clients (REQ-034). Its `$connect` authentication, per-recipient targeting via the `fetch_requesters` subscription set, and pinned `403` rejection are specified by REQ-043, with the shared token-in / verified-principal-out auth contract REQ-IF-008. Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-011 (SecretManagement)

**Parent Requirements**: REQ-IF-006

**Traceability Rationale**: SYS-011 stores the USDA API key in AWS Secrets Manager and injects it into the Fargate consumer worker environment, never exposing it in client-facing responses or logs (REQ-IF-006). Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-012 (MonitoringAndLogging)

**Parent Requirements**: REQ-NF-012, REQ-NF-016

**Traceability Rationale**: SYS-012 provides the CloudWatch metrics/alarms that make the rolling-window compliance verifiable — no rolling-hour window over 1,000 calls and zero `429`s under normal operation (REQ-NF-012, SC-002) — and the tombstone-row count tracking that evidences zero data loss from queue-processing failures (REQ-NF-016, SC-006). Schema/index/cache-key requirements (REQ-028/REQ-029/REQ-030) belong to SYS-007/SYS-008, not the monitoring layer. Behavior is defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-013 (AuthnAuthzLayer)

**Parent Requirements**: REQ-035, REQ-IF-007, REQ-IF-008, REQ-037a, REQ-037b, REQ-037c, REQ-037d, REQ-038a, REQ-038b, REQ-038c, REQ-039, REQ-040a, REQ-040b, REQ-041, REQ-042, REQ-043, REQ-044a, REQ-044b, REQ-044c, REQ-044d

**Traceability Rationale**: SYS-013 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views. It is the named auth component (REQ-044d/FR-053) positioned in front of every food data entry point, satisfying the HTTP authentication boundary (REQ-035) by reusing the shared Commise Clerk auth layer (REQ-IF-007). Its deployment is **split**: HTTP routes are gated by in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate service behind the public ALB (an ALB cannot front an API Gateway Lambda authorizer, and the token verifies networklessly so no extra edge layer is warranted — plan §2A), while the deferred WebSocket surface (SYS-010) uses a `$connect` Lambda authorizer because there is no in-process request middleware on the WebSocket connection lifecycle. Both surfaces reuse the identity service's `ClerkAuthService` verify logic (`verifyToken` + `azp`) via a shared `@kitchensink/*` package. SYS-013 produces the `AuthenticatedCaller` principal consumed by SYS-001 (REQ-IF-008/REQ-037a–d), enforces scope-gated `403` and status precedence (REQ-038a–c), per-`sub` demotion fairness (>50 pending → ranked to back, dynamic at drain time; no `429`) at the `fetch_queue` INSERT (REQ-039), batch/queue `400`/`503` bounds with per-item partial batch responses (REQ-040a/REQ-040b), the M2M token class for service callers (REQ-041), async-producer provenance for EventBridge/`fetch_queue` (REQ-042), WebSocket `$connect` auth and per-recipient targeting via the requester set (REQ-043), and auth-layer load-shed under invalid-token floods (REQ-044a–d).
