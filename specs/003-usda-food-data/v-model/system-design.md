# System Design: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/requirements.md`

## Overview

Event-driven, queue-based architecture for USDA FoodData Central integration. The HTTP read API is a NestJS service running on ECS/Fargate behind a public ALB; user-facing food lookups are served from local PostgreSQL (with optional Redis cache) — the USDA API is never called in the request path. Cache misses and pending foods trigger async backfill via EventBridge → SQS → a Fargate consumer worker, rate-limited to 1,000 USDA API calls per hour via a Redis token-bucket algorithm. The system handles eventual consistency via client polling. (A WebSocket push notifier on API Gateway WebSocket API is deferred to US-9 and is the only Lambda-authorizer surface.)

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Parent Requirements                                                                      | Type      |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| SYS-001 | FoodApiController           | NestJS controller in the food read service running on ECS/Fargate behind a public ALB. Handles all food lookup endpoints with in-process `AuthMiddleware`/`FoodAuthGuard` (SYS-013). Serves from local store only; never calls USDA API directly. Returns 200/202/404/400 based on local fetch_status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010 | Component |
| SYS-002 | EventBridgeBus              | Central event bus routing FoodRequested and FoodBatchRequested events to respective SQS queues. Decouples the API service from queue producers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | REQ-011, REQ-012                                                                         | Component |
| SYS-003 | HighPriorityFoodQueue       | SQS FIFO queue for individual food lookup requests. Polled by Consumer Lambda ahead of LowPriorityQueue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | REQ-011, REQ-012, REQ-014                                                                | Component |
| SYS-004 | LowPriorityFoodQueue        | SQS FIFO queue for batch/recipe-triggered and periodic refresh events. Polled only when HighPriorityQueue is empty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | REQ-011, REQ-013                                                                         | Component |
| SYS-005 | FoodConsumerLambda          | Rate-limited Lambda that consumes from both queues. Calls USDA API via token-bucket (max 1,000/hr). Processes up to 20 fdcIds per batch API call. Writes results to PostgreSQL and invalidates Redis cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | REQ-011, REQ-012, REQ-014, REQ-015, REQ-016, REQ-017                                     | Component |
| SYS-006 | TokenBucketRateLimiter      | Redis-backed token bucket limiting Consumer Lambda to 1,000 USDA API calls/hour. Prevents throttling and ensures fair distribution across time windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | REQ-018, REQ-019                                                                         | Component |
| SYS-007 | FoodDataPostgresRepository  | PostgreSQL-backed persistent store for food data and fetch_status tracking. Contains foods table with fdcId, description, nutrition fields, fetch_status, fetched_at, last_requested_at, request_count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-020, REQ-021                            | Component |
| SYS-008 | FoodDataRedisCache          | Redis cache for hot food data (TTL 24h) and pending fetch deduplication set. Role 1: hot cache. Role 2: token bucket state. Role 3: pending set deduplication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | REQ-001, REQ-002, REQ-003, REQ-004, REQ-022, REQ-023                                     | Component |
| SYS-009 | USDAFoodDataCentralApi      | External USDA FoodData Central REST API. Called exclusively by Consumer Lambda via token-bucket-controlled HTTP. Used for batch (up to 20 IDs) and single food lookups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | REQ-016, REQ-017, REQ-024                                                                | Component |
| SYS-010 | WebSocketNotificationLambda | Optional Lambda triggered by FoodDataReceived events from EventBridge. Pushes real-time updates to connected clients via API Gateway WebSocket API. Launch deferred (US-9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | REQ-025                                                                                  | Component |
| SYS-011 | SecretManagement            | AWS Secrets Manager integration for USDA API key storage and rotation. Injected into Consumer Lambda environment via secure parameter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | REQ-026, REQ-027                                                                         | Component |
| SYS-012 | MonitoringAndLogging        | CloudWatch for the ECS/Fargate API service and the Fargate consumer worker logs, metrics, and alarms. X-Ray tracing for distributed request visibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | REQ-028, REQ-029, REQ-030                                                                | Component |
| SYS-013 | AuthnAuthzLayer             | Named Clerk authentication & authorization component fronting **every** food data entry point. Networkless `@clerk/backend` `verifyToken` against non-secret `CLERK_JWT_KEY` with `azp` allowlist, fail-closed `401`. Two deployment surfaces: (1) in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate HTTP service behind the public ALB (HTTP routes); (2) a WebSocket `$connect` Lambda authorizer (pinned `403`). Emits the `AuthenticatedCaller` principal (`sub`, `azp`, scopes from `public_metadata`), enforces scope `403`/precedence, per-`sub` enqueue quota (`429`), batch/queue bounds (`400`/`503`), M2M token class, async-producer provenance, and auth-layer load-shed. Reuses the identity service's `ClerkAuthService` verify logic via a shared `@kitchensink/*` package. | REQ-IF-008, REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044       | Component |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship  | Failure Impact                                                                                                                                                                                        |
| ------- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-001 | SYS-002 | Calls         | If EventBridge publish fails, food fetch is lost; client gets stale data or 404                                                                                                                       |
| SYS-001 | SYS-007 | Reads         | If PostgreSQL unavailable, the API service returns 503; no graceful degradation                                                                                                                       |
| SYS-001 | SYS-008 | Reads         | If Redis unavailable, falls through to PostgreSQL; slight latency increase                                                                                                                            |
| SYS-002 | SYS-003 | Routes        | If HighPriorityQueue unavailable, food lookups fail; batch jobs queued to DLQ                                                                                                                         |
| SYS-002 | SYS-004 | Routes        | If LowPriorityQueue unavailable, batch imports fail silently; DLQ capture                                                                                                                             |
| SYS-003 | SYS-005 | Feeds         | If Consumer Lambda is behind, HighPriorityQueue accumulates; food data delayed                                                                                                                        |
| SYS-004 | SYS-005 | Feeds         | If Consumer Lambda is behind, LowPriorityQueue accumulates; batch enrichment delayed                                                                                                                  |
| SYS-005 | SYS-006 | Calls         | If TokenBucket unavailable, Consumer Lambda cannot call USDA API safely                                                                                                                               |
| SYS-005 | SYS-007 | Writes        | If PostgreSQL write fails, USDA data lost; retry with exponential backoff                                                                                                                             |
| SYS-005 | SYS-008 | Invalidates   | If Redis invalidate fails, stale data may be served from cache up to TTL (24h)                                                                                                                        |
| SYS-005 | SYS-009 | Calls         | If USDA API unavailable, Consumer Lambda re-queues with retry limit                                                                                                                                   |
| SYS-005 | SYS-011 | Reads         | If Secrets Manager unavailable, Consumer Lambda cannot obtain API key; stops processing                                                                                                               |
| SYS-007 | SYS-008 | Reads         | Optional cache backfill on read miss; not a hard dependency                                                                                                                                           |
| SYS-008 | SYS-007 | Reads         | Redis miss falls through to PostgreSQL; not a failure path                                                                                                                                            |
| SYS-010 | SYS-001 | Publishes     | WebSocket push is fire-and-forget; failure does not affect the API service                                                                                                                            |
| SYS-013 | SYS-001 | Fronts        | In-process middleware on ECS/Fargate; every HTTP route is gated. If verification fails, request is rejected `401`/`403` before business logic — no enqueue, no USDA call                              |
| SYS-013 | SYS-010 | Fronts        | WebSocket `$connect` Lambda authorizer; unauthenticated connections rejected (`403`) before establishment. Recipient targeting uses the verified `sub` via the requester set                          |
| SYS-013 | SYS-002 | Gates         | Per-`sub` enqueue quota (`429`) and queue/circuit-breaker bounds (`503`) applied after authn, before EventBridge publish / `fetch_queue` insert; async producers must present an authorized principal |
| SYS-001 | SYS-013 | Authenticates | API service depends on the auth layer to resolve the `AuthenticatedCaller`; if the auth layer is misconfigured (missing `CLERK_JWT_KEY`) it fails closed to `401`                                     |
| SYS-010 | SYS-013 | Authenticates | WebSocket `$connect` depends on the `$connect` authorizer to verify the token before the connection is accepted                                                                                       |

### Dependency Diagram

```text
Client ─(Bearer token)→ SYS-013 (AuthnAuthzLayer) ─[401/403 fail-closed]
   ├─ HTTP:  in-proc NestJS AuthMiddleware on ECS/Fargate (ALB) ─→ SYS-001 (FoodApiController)
   └─ WS:    $connect Lambda authorizer ───────────────────────→ SYS-010 (WebSocket)
                        ↓ (AuthenticatedCaller; per-sub quota 429 / queue 503 before publish)
Client → ALB → ECS/Fargate NestJS service → SYS-001 (FoodApiController)
                        ↓ publish
                   SYS-002 (EventBridge)
                        ↓ route
              ┌────── SYS-003 (HighPriorityQueue) ──→ SYS-005 (ConsumerLambda) ──→ SYS-009 (USDA API)
              │                                              ↓ calls              ↓ writes
              └────── SYS-004 (LowPriorityQueue) ──→ SYS-005 ──→ SYS-006 (TokenBucket)
                        │                                   ↓ writes
                   (DLQ)                               SYS-007 (PostgreSQL)
                        │                                   ↑ reads/writes
                   SYS-011 (SecretsManager) ←── reads ── SYS-005
                        │
                        └──USDA API key──→
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Interface                          | Direction | Description                                                                                                                             |
| ---------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ALB → ECS/Fargate NestJS REST API  | Inbound   | `GET /v1/foods/{fdcId}`, `GET /v1/foods/search`, `GET /v1/foods/{fdcId}/status`, `GET /v1/foods/{fdcId}/nutrition`                      |
| USDA FoodData Central API          | Outbound  | `POST /v1/foods` (batch up to 20 IDs), rate-limited to 1,000 calls/hour                                                                 |
| WebSocket API (optional, deferred) | Outbound  | Real-time `FoodDataReceived` push to connected clients                                                                                  |
| Clerk session/M2M token (Bearer)   | Inbound   | Presented at every HTTP entry point and WebSocket `$connect`; verified networklessly via `CLERK_JWT_KEY` (no IdP round trip) by SYS-013 |

### Internal Interfaces

| SYS-NNN           | Interface Contract                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SYS-001 → SYS-002 | `FoodRequested` event: `{ "fdcId": number, "requestedAt": timestamp }`                                                   |
| SYS-001 → SYS-007 | SQL: `SELECT * FROM foods WHERE fdcId = $1`                                                                              |
| SYS-002 → SYS-003 | SQS message: `{ "fdcId": number, "priority": "high", "correlationId": string }`                                          |
| SYS-002 → SYS-004 | SQS message: `{ "fdcIds": number[], "priority": "low", "correlationId": string }`                                        |
| SYS-005 → SYS-006 | Lua script atomic token check-and-decrement; returns `{ allowed: bool, tokensRemaining: number }`                        |
| SYS-005 → SYS-009 | HTTP POST with Authorization header (API key from Secrets Manager)                                                       |
| SYS-005 → SYS-007 | UPSERT: `INSERT INTO foods (...) VALUES (...) ON CONFLICT (fdcId) DO UPDATE SET ...`                                     |
| SYS-005 → SYS-008 | DEL command on `food:{fdcId}` key + SADD to `pending_fetch` set                                                          |
| SYS-011 → SYS-005 | Environment variable injection: `USDA_API_KEY`                                                                           |
| SYS-013 → SYS-001 | Verified `AuthenticatedCaller` `{ sub, azp, scopes }` surfaced to HTTP handlers (req context); rejects with `401`/`403`  |
| SYS-013 → SYS-010 | `$connect` authorizer policy (Allow/Deny); verified `sub` passed via WebSocket `$context.authorizer`                     |
| SYS-013 → SYS-002 | Pre-publish gate: per-`sub` quota check (`429`) + queue depth / circuit-breaker check (`503`) before EventBridge publish |

### Interface Contracts Table

| Contract ID | SYS Source | SYS Target | Operation        | Request Schema                                                        | Response Schema                                                        |
| ----------- | ---------- | ---------- | ---------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| IC-001      | SYS-001    | SYS-002    | PublishEvent     | `FoodRequested { fdcId, requestedAt }`                                | `EventId`                                                              |
| IC-002      | SYS-001    | SYS-007    | QueryFood        | `fdcId: number`                                                       | `FoodData \| NotFound \| Pending`                                      |
| IC-003      | SYS-005    | SYS-006    | CheckRateLimit   | none                                                                  | `{ allowed: boolean, tokensRemaining: number }`                        |
| IC-004      | SYS-005    | SYS-009    | FetchFoods       | `{ fdcIds: number[] }`                                                | `USDAFoodResponse[]`                                                   |
| IC-005      | SYS-005    | SYS-007    | UpsertFood       | `FoodData`                                                            | `{ success: boolean }`                                                 |
| IC-006      | SYS-013    | SYS-001    | VerifyToken      | `Bearer <clerk session/M2M token>`                                    | `AuthenticatedCaller \| 401 \| 403`                                    |
| IC-007      | SYS-013    | SYS-002    | GateEnqueue      | `{ sub, fdcIds }`                                                     | `Allow \| 429 (quota) \| 503 (backpressure)`                           |
| IC-008      | SYS-013    | SYS-001    | ValidateBatch    | `{ sub, fdcIds: number[] }` (`POST /v1/foods/batch`)                  | `Accepted (≤ 100 IDs) \| 400 (batch cap exceeded — no enqueue)`        |
| IC-009      | SYS-013    | SYS-010    | AuthorizeConnect | `$connect` token (query param / `Sec-WebSocket-Protocol` subprotocol) | `Allow { $context.authorizer.sub } \| 403 (pinned $connect rejection)` |

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
            → pre-enqueue quota/fairness gate (before SYS-002 publish / fetch_queue insert)
               ├─ per-sub enqueue quota exceeded → 429 (no enqueue)
               ├─ fetch_queue depth exceeded | circuit open → 503 (fail closed)
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

### Path 3: Food Lookup (Cache Miss, DB Miss, New Food)

```
Client → GET /v1/foods/12345
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → Redis GET food:12345 [MISS]
    → PostgreSQL SELECT [MISS, fetch_status NOT EXISTS]
    → Redis SISMEMBER pending_fetch 12345 [NOT MEMBER]
    → Redis SADD pending_fetch 12345
    → EventBridge Publish FoodRequested { fdcId: 12345, requestedAt: ... } (SYS-002)
    → Return 202 { status: 'pending', fdcId: 12345, estimatedWaitSeconds: 30, partialData }
  → Client polls GET /v1/foods/12345/status until 200
```

### Path 4: Consumer Lambda Processing (High Priority)

```
SQS HighPriorityQueue → ConsumerLambda (SYS-005)
  → TokenBucket.Check() (SYS-006) [allowed]
  → HTTP POST USDA /v1/foods { fdcIds: [12345] }
  → Parse USDA response
  → PostgreSQL UPSERT foods (SYS-007)
  → Redis DEL food:12345 + SREM pending_fetch 12345 (SYS-008)
  → EventBridge Publish FoodDataReceived { fdcId: 12345, fetchedAt: ... }
  → DELETE message from SQS
```

### Path 5: Consumer Lambda Rate-Limited (No Tokens)

```
SQS HighPriorityQueue → ConsumerLambda (SYS-005)
  → TokenBucket.Check() [NOT allowed, tokens = 0]
  → VISIBILITY_TIMEOUT backoff (30s increment)
  → Message returns to queue; reprocessed when tokens refill
```

## Physical View

| Component         | AWS Resource                   | Region    | Notes                                                            |
| ----------------- | ------------------------------ | --------- | ---------------------------------------------------------------- |
| ALB               | Application Load Balancer      | us-east-1 | Public; HTTP entry point fronting the food read service          |
| FoodApiService    | ECS/Fargate service            | us-east-1 | NestJS REST API (SYS-001); in-process `AuthMiddleware` (SYS-013) |
| EventBridge       | Default event bus              | us-east-1 | 3 rules for routing                                              |
| HighPriorityQueue | SQS FIFO                       | us-east-1 | 5min visibility timeout, DLQ                                     |
| LowPriorityQueue  | SQS FIFO                       | us-east-1 | 15min visibility timeout, DLQ                                    |
| ConsumerWorker    | ECS/Fargate task               | us-east-1 | Fargate consumer worker (SYS-005); Postgres-as-queue polling     |
| TokenBucket       | ElastiCache Redis (cluster)    | us-east-1 | t4g.micro for dev, scaling based on ops                          |
| PostgreSQL        | RDS db.t4g.small               | us-east-1 | 2 vCPU, 2GB RAM, ~$25/mo                                         |
| RedisCache        | ElastiCache Redis              | us-east-1 | Optional lean-launch; add when p95 > 100ms                       |
| SecretsManager    | Secrets Manager                | us-east-1 | USDA API key rotation                                            |
| WebSocketNotifier | API Gateway WebSocket + Lambda | us-east-1 | Deferred (US-9); `$connect` Lambda authorizer (SYS-010/SYS-013)  |
| CloudWatch        | Log groups, metrics, alarms    | us-east-1 | API service + consumer worker logging                            |

## Trade-off Decisions

| Decision                    | Chosen Option                            | Rationale                                               |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| USDA API call path          | Async via SQS (not sync in API service)  | Decouples user latency from USDA availability           |
| Notification mechanism      | Client polling (not WebSocket)           | Simpler launch; WebSocket deferred to US-9              |
| Cache layer                 | Redis + PostgreSQL (not PostgreSQL only) | Sub-10ms hot cache response; USDA rate limit protection |
| Token bucket implementation | Redis Lua atomic script                  | Atomic check-and-decrement prevents overshoot           |
| Queue priority              | Two SQS queues with consumer polling     | User-facing lookups ahead of batch enrichment           |
| Database initial sizing     | db.t4g.small (not pre-sized for 330K)    | Grows with actual demand; not pre-optimized             |

## Component Traceability Detail

### Component: SYS-001 (FoodApiController)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010

**Traceability Rationale**: SYS-001 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views. It is a NestJS controller in the food read service deployed on ECS/Fargate behind the public ALB, with SYS-013's `AuthMiddleware`/`FoodAuthGuard` running in-process ahead of every route handler (no API Gateway / Lambda authorizer on the HTTP path — plan §2A).

### Component: SYS-002 (EventBridgeBus)

**Parent Requirements**: REQ-011, REQ-012

**Traceability Rationale**: SYS-002 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-003 (HighPriorityFoodQueue)

**Parent Requirements**: REQ-011, REQ-012, REQ-014

**Traceability Rationale**: SYS-003 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-004 (LowPriorityFoodQueue)

**Parent Requirements**: REQ-011, REQ-013

**Traceability Rationale**: SYS-004 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-005 (FoodConsumerLambda)

**Parent Requirements**: REQ-011, REQ-012, REQ-014, REQ-015, REQ-016, REQ-017

**Traceability Rationale**: SYS-005 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-006 (TokenBucketRateLimiter)

**Parent Requirements**: REQ-018, REQ-019

**Traceability Rationale**: SYS-006 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-007 (FoodDataPostgresRepository)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-020, REQ-021

**Traceability Rationale**: SYS-007 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-008 (FoodDataRedisCache)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-022, REQ-023

**Traceability Rationale**: SYS-008 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-009 (USDAFoodDataCentralApi)

**Parent Requirements**: REQ-016, REQ-017, REQ-024

**Traceability Rationale**: SYS-009 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-010 (WebSocketNotificationLambda)

**Parent Requirements**: REQ-025

**Traceability Rationale**: SYS-010 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-011 (SecretManagement)

**Parent Requirements**: REQ-026, REQ-027

**Traceability Rationale**: SYS-011 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-012 (MonitoringAndLogging)

**Parent Requirements**: REQ-028, REQ-029, REQ-030

**Traceability Rationale**: SYS-012 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-013 (AuthnAuthzLayer)

**Parent Requirements**: REQ-IF-008, REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044

**Traceability Rationale**: SYS-013 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views. It is the named auth component (REQ-044/FR-053) positioned in front of every food data entry point. Its deployment is **split**: HTTP routes are gated by in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate service behind the public ALB (an ALB cannot front an API Gateway Lambda authorizer, and the token verifies networklessly so no extra edge layer is warranted — plan §2A), while the deferred WebSocket surface (SYS-010) uses a `$connect` Lambda authorizer because there is no in-process request middleware on the WebSocket connection lifecycle. Both surfaces reuse the identity service's `ClerkAuthService` verify logic (`verifyToken` + `azp`) via a shared `@kitchensink/*` package. SYS-013 produces the `AuthenticatedCaller` principal consumed by SYS-001 (REQ-IF-008/REQ-037), enforces scope-gated `403` and status precedence (REQ-038), the per-`sub` enqueue quota `429` ahead of SYS-002 publish (REQ-039), batch/queue `400`/`503` bounds (REQ-040), the M2M token class for service callers (REQ-041), async-producer provenance for EventBridge/`fetch_queue` (REQ-042), WebSocket `$connect` auth and per-recipient targeting via the requester set (REQ-043), and auth-layer load-shed under invalid-token floods (REQ-044).
