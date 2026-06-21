# Tasks: Feature 003 — USDA Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate Worker + Rolling 60-min Window Limiter)
**Updated**: 2026-06-20
**Source Artifacts**: plan.md, spec.md, product-spec.md
**Design Reference**: plan.md §4 Fetch Queue (Postgres-as-queue), spec.md FR-014..FR-018

---

## Package Layout & Database (locked 2026-06-19)

| Package                            | Path                             | Role                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kitchensink/food-service`        | `packages/services/food-service` | Deployable NestJS service on **ECS/Fargate fronted by the single shared per-stage ALB** (global infra, host-based listener rule at priority 200 — not its own ALB) — `/v1/foods/*` API + `FoodAuthGuard` (in-process Clerk `AuthMiddleware`), Drizzle schema/migrations, the Fargate consumer worker, the lambdas, and its **own CDK** (`infra/lib/`, like `@kitchensink/identity-service`). |
| `@kitchensink/usda-client`         | `packages/clients/usda`          | External **USDA FoodData Central** client library (typed `getFood`/`getFoodsBatch`/`searchFoods` + error types). No DB, no HTTP server. Consumed by `food-service`.                                                                                                                                                                                                                          |
| `@kitchensink/food-service-client` | `packages/clients/food-service`  | Typed client for **our** `/v1/foods/*` API, consumed by web/mobile and downstream services (001/006/007/009 — the M2M callers).                                                                                                                                                                                                                                                              |
| `@kitchensink/clerk-verify`        | `packages/shared/clerk-verify`   | Shared networkless Clerk verification (`verifyToken` + `azp`), extracted from the identity service's `ClerkAuthService`; consumed by both identity and food-service.                                                                                                                                                                                                                         |

> `packages/clients/usda` and `packages/clients/food-service` MUST be added to the root
> `package.json` `workspaces` array as **explicit paths** (`packages/clients` is a semantic
> grouping folder, not a glob — matching how `packages/apps/commise/{web,mobile}` are listed).
> `services/*` and `shared/*` globs already cover `food-service` and `clerk-verify`.

**Database (no new RDS, no cluster):** reuse the existing shared instance
`kitchensink-data-{stage}` (a single `rds.DatabaseInstance`, db.t4g.small, defined in
`packages/infra/global/lib/platform/data-stack.ts`). Add a **separate logical database
`kitchensink_food`** on that instance (own least-privilege role + secret), provisioned in the
**global DataStack** so it stays platform infra. `food-service` `Fn.importValue`s the shared
`kitchensink-data-{stage}:Database*` exports and runs its Drizzle migrations against
`kitchensink_food`. (`pg_trgm` is already bootstrapped on the instance — covers FR-008 search.)

**Data-model note (clarified 2026-06-20):** the `kitchensink_food` tables are `foods`,
`fetch_queue`, `fetch_requesters`, `usda_sync_metadata`, and `usda_call_log` (the rolling
60-min USDA-call log — timestamped rows pruned to the trailing 60 min, replacing the old
`rate_limiter_state` token-bucket table). The per-user quota tables `user_fetch_quota` and
`global_fetch_quota` are **dropped** — fairness is enforced by queue **demotion** (FR-043),
which derives a `sub`'s pending count at drain time from `fetch_queue` + `fetch_requesters`
(no quota row, no `429`).

---

## User Story Reference

| US     | Name                                | Priority | FRs                                                    |
| ------ | ----------------------------------- | -------- | ------------------------------------------------------ |
| US-0   | Authenticated & Authorized Access   | P1       | FR-035–FR-053 (auth slice; T-033, T-046–T-056)         |
| US-001 | Single Food Lookup (Cache Hit)      | P1       | FR-001, FR-002, FR-005, FR-006                         |
| US-002 | Cache Miss / Async Backfill         | P1       | FR-003, FR-004, FR-007, FR-011, FR-013, FR-024, FR-025 |
| US-003 | Rate-Limited USDA Consumption       | P1       | FR-019, FR-020, FR-021, FR-022, FR-026, FR-027         |
| US-004 | Bulk Ingredient Lookup              | P1       | FR-012, FR-023, FR-024                                 |
| US-005 | Demand-Weighted Priority + Recovery | P1       | FR-014, FR-015, FR-016, FR-017, FR-018                 |
| US-006 | Food Search by Name                 | P2       | FR-008, FR-009, FR-010                                 |
| US-007 | Stale Data Refresh                  | P2       | FR-031, FR-032                                         |
| US-008 | Fetch Status Polling                | P2       | FR-007, FR-033                                         |
| US-009 | WebSocket Notifications             | P3       | FR-034                                                 |
| US-010 | Monitoring Dashboard                | P3       | FR-016, FR-018 (SC-006 DLQ/tombstone alarm)            |

---

## Dependency Graph

```
PACKAGES + WORKSPACE (T-060 → T-003, T-046, T-057)
GLOBAL DB (T-001b: kitchensink_food) ─► FOOD-SERVICE CDK (T-001)
  └─► SETUP/CONFIG (T-002, T-004)
        └─► SCHEMA (T-005–T-009, T-056 auth tables)
              └─► API LAYER (T-010–T-015)
                    ├─► QUEUE + FARGATE CONSUMER (T-016–T-023)
                    │     └─► ROLLING-WINDOW LIMITER (T-024–T-026) ─► BATCH (T-027–T-029)
                    ├─► STALE-WHILE-REVALIDATE READ (T-063) · STALE REFRESH / BULK SYNC (T-030–T-032)
                    ├─► AUTH & AUTHZ (T-033, T-046–T-056) [US-0, FR-035–FR-053]
                    └─► MONITORING (T-034–T-037)

PERF/LOAD TESTS (T-062) [SC-001/003/004/007]
WEBSOCKET (T-038–T-039) [P3 — Deferred] · MULTI-AZ UPGRADE (T-061) [deferred, SC-009]
INTEGRATION TESTS (T-040–T-045) · E2E HARNESS (T-064) [booted service + LocalStack + Docker Postgres]
```

---

## Phase 0 — Setup & Infrastructure

- [x] **T-001** [P0] [Foundation] `FoodServiceStack` CDK — `packages/services/food-service/infra/lib/food-service-stack.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-001b
      **Implements**: ARCH-001

    Create the food-service's own CDK (mirroring `packages/services/identity/infra/lib/`). The
    `FoodServiceStack` defines the **ECS/Fargate** NestJS service, the Fargate consumer worker, the
    lambdas (stale-refresh, bulk-sync, search-indexer), and the EventBridge (scheduled-producer)
    wiring — **no SQS** (the demand queue is the Postgres `fetch_queue`). It does **NOT** create its
    own ALB: it `Fn.importValue`s the **single shared per-stage ALB** (owned by the global infra,
    `kitchensink-alb-{stage}`) HTTPS listener and adds a **host-based listener rule** (priority 200)
    routing `food[.stage].{domain}` to its own target group, plus the A-record aliased to the shared
    ALB. It also does **NOT** create an RDS — it `Fn.importValue`s the shared
    `kitchensink-data-{stage}:Database{Endpoint,Port,SecretArn}` and the new
    `kitchensink-data-{stage}:FoodDbSecretArn` (T-001b) and connects to the `kitchensink_food`
    database.

    **Acceptance**:
    - `cdk synth` produces valid CloudFormation with no errors, **no new RDS resource**, and
      **no per-service ALB** (0 `AWS::ElasticLoadBalancingV2::LoadBalancer`) — the stack instead
      adds exactly one `AWS::ElasticLoadBalancingV2::ListenerRule` (host-header condition, priority 200) + one target group on the shared ALB's imported HTTPS listener, plus the A-record
    - Stack exports `foodFetchWorkerServiceName`; imports the shared DB endpoint/secret and the
      shared ALB listener/ARN exports

- [x] **T-001b** [P0] [Foundation] Global DataStack: add `kitchensink_food` database — `packages/infra/global/lib/platform/data-stack.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: —
      **Implements**: ARCH-001 (shared data tier)

    Extend the **global** DataStack (no new instance, no cluster) to provision a second logical
    database `kitchensink_food` on the existing `kitchensink-data-{stage}` instance, with its own
    least-privilege role + credentials secret, and export `FoodDbSecretArn` / `FoodDatabaseName`.
    Reuse the instance's already-bootstrapped `pg_trgm` extension.

    **Acceptance**:
    - `cdk diff` on the data stack adds only a database + role + secret (no instance/cluster change)
    - New exports `kitchensink-data-{stage}:FoodDbSecretArn`, `:FoodDatabaseName` are present

---

- [x] **T-002** [P0] [Foundation] Environment Config (Zod) — `—`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-001
      **Implements**: FR-019, FR-031 (env-driven config)

    Add USDA-specific env vars to the Zod schema in `@nestjs/config`:
    - `USDA_API_KEY` (required, string)
    - `USDA_API_BASE_URL` (default: `https://api.nal.usda.gov/fdc/v1`)
    - `USDA_RATE_LIMIT_PER_HOUR` (default: 1000) — the rolling-60-min-window cap (FR-019); the worker pauses draining at 90% of this
    - `USDA_STALE_THRESHOLD_DAYS` (default: 30)
    - `USDA_TOMBSTONE_TTL_DAYS` (default: 30) — `not_found` tombstone TTL after which a lookup may re-attempt (FR-025)
    - `USDA_WORKER_DESIRED_COUNT` (default: 1)
    - `USDA_LEASE_TIMEOUT_SECONDS` (default: 30)

    **Acceptance**:
    - Missing `USDA_API_KEY` at startup throws a descriptive Zod validation error
    - All env vars accessible via `ConfigService` in Fargate and NestJS contexts

---

- [x] **T-003** [P0] [Foundation] `@kitchensink/usda-client` package + USDA API client — `packages/clients/usda/src/usda-api.client.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-002, T-060
      **Implements**: FR-023 (USDA API integration)

    Scaffold the **`@kitchensink/usda-client`** package (`packages/clients/usda`, extending the shared tooling configs per NFR-006) and create `packages/clients/usda/src/usda-api.client.ts` — a typed HTTP client wrapping the USDA FoodData Central REST API. This package is the external-API client only (no DB, no server); `food-service` depends on it.
    - `getFood(fdcId: number): Promise<UsdaFoodDetail>`
    - `getFoodsBatch(fdcIds: number[]): Promise<UsdaFoodDetail[]>` (POST `/v1/foods`, max 20 IDs)
    - `searchFoods(query: string): Promise<UsdaSearchResult>`
    - 10s request timeout
    - Throws `UsdaNotFoundError` on 404, `UsdaRateLimitError` on 429, `UsdaServerError` on 5xx

    **Acceptance**:
    - Unit tests mock HTTP layer; all error types are thrown correctly
    - `getFoodsBatch` rejects arrays > 20 IDs with `InvalidBatchSizeError`

---

- [x] **T-004** [P0] [Foundation] Drizzle Schema Files for 003 — `packages/services/food-service/src/db/schema/usda.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-001
      **Implements**: FR-028 (data persistence schema)

    Create `packages/services/food-service/src/db/schema/usda.ts` with Drizzle table definitions for:
    - `foods` (all columns from plan.md §2)
    - `fetch_queue` (`fdc_id` text PK, `request_count`, `first_requested`, `last_requested`, `status`, `attempts`, `last_error`, `fetched_at`)
    - `usda_sync_metadata` (singleton)
    - `usda_call_log` (rolling 60-min window persistence: timestamped rows, one per USDA call, pruned to the trailing 60 min)

    Export all tables from `packages/services/food-service/src/db/schema/index.ts`.

    **Acceptance**:
    - `drizzle-kit generate` produces valid SQL migration with no errors
    - All column types match plan.md §2 and spec.md FR-028 exactly

---

## Phase 1 — Database Schema (US-001 foundation)

- [x] **T-005** [P1] [US-001] Migration: `foods` Table — `—`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-004
      **Implements**: FR-028, FR-029

    Write and apply Drizzle migration creating the `foods` table:
    - Primary key `fdc_id INT`
    - All macro/micro nutrient columns (`DECIMAL`, nullable)
    - `fetch_status TEXT` with check constraint (`pending | fetched | not_found | failed | stale`)
    - `search_vector TSVECTOR`
    - `raw_json JSONB`
    - `fetched_at TIMESTAMP`, `last_requested_at TIMESTAMP`, `request_count INT DEFAULT 0`
    - `created_at`, `updated_at`

    **Acceptance**:
    - Migration runs cleanly against the `kitchensink_food` database on the shared `kitchensink-data-{stage}` instance
    - `fetch_status` check constraint rejects invalid values

---

- [x] **T-006** [P1] [US-005] Migration: `fetch_queue` Table — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-004
      **Implements**: FR-014, FR-015

    Write and apply migration creating the `fetch_queue` table per plan.md §4:

    ```sql
    CREATE TABLE fetch_queue (
      fdc_id           text PRIMARY KEY,
      request_count    int  NOT NULL DEFAULT 1,
      first_requested  timestamptz NOT NULL DEFAULT now(),
      last_requested   timestamptz NOT NULL DEFAULT now(),
      status           text NOT NULL DEFAULT 'pending',
      attempts         int  NOT NULL DEFAULT 0,
      last_error       text,
      fetched_at       timestamptz
    );
    CREATE INDEX idx_fetch_queue_priority
      ON fetch_queue (request_count DESC, first_requested ASC)
      WHERE status = 'pending';
    ```

    **Acceptance**:
    - `EXPLAIN ANALYZE` shows index-only scan for pending selection
    - `ON CONFLICT (fdc_id) DO UPDATE` works atomically

---

- [x] **T-007** [P1] [US-001] Migration: Supporting Tables — `—`
      **Story**: US-001 / US-005
      **Priority**: P1
      **Depends on**: T-005, T-006
      **Implements**: FR-019, FR-028

    Write and apply migrations for:
    - `usda_sync_metadata` (singleton row, `id INT PRIMARY KEY DEFAULT 1`, `last_full_sync_at`, `last_incremental_at`, `foundation_version`, `sr_legacy_version`, `branded_version`)
    - `usda_call_log` (rolling 60-min window: `id BIGSERIAL PRIMARY KEY`, `called_at TIMESTAMPTZ NOT NULL DEFAULT now()`, plus `idx_usda_call_log_called_at` btree on `called_at` for trailing-window counts and pruning). One row is inserted per USDA call; rows older than 60 min are pruned/ignored. No singleton/token columns — the trailing-60-min count is derived from the row timestamps.

    **Acceptance**:
    - `usda_sync_metadata` has a default row with `id = 1`
    - `usda_call_log` starts empty; `SELECT count(*) FROM usda_call_log WHERE called_at > now() - interval '60 minutes'` returns 0 on a fresh DB
    - `idx_usda_call_log_called_at` supports an index scan for the trailing-60-min count

---

- [x] **T-008** [P1] [US-001] Migration: Indexes — `—`
      **Story**: US-001 / US-006
      **Priority**: P1
      **Depends on**: T-005, T-006, T-007
      **Implements**: FR-029

    Apply indexes:
    - `idx_foods_fetch_status_fetched_at` — composite on `(fetch_status, fetched_at)`
    - `idx_foods_last_requested` — btree on `last_requested_at`
    - `idx_foods_search` — GIN index on `search_vector`
    - `idx_foods_data_type` — btree on `data_type`
    - `idx_foods_upc` — btree on `upc_code` (nullable, for branded foods)

    Enable `pg_trgm` extension for fuzzy search.

    **Acceptance**:
    - `EXPLAIN ANALYZE` on `search_vector @@ to_tsquery(...)` shows GIN index scan
    - `EXPLAIN ANALYZE` on `fetch_status = 'pending' AND fetched_at < ...` shows composite index scan

---

- [ ] **T-009** [P1] [US-004] Migration: `ingredients` Table Extensions — **DEFERRED (owned by feature 001)** — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-005
      **Implements**: FR-001 (downstream integration)
      **Follow-up**: `FU-INGREDIENTS` (`.forge-status.yml`)

    > **DEFERRED — do NOT implement under 003.** The `ingredients` table is owned by feature
    > **001** (`packages/shared/db/src/schema/ingredients.ts`, **not built yet**) and lives in a
    > **different logical database** than `kitchensink_food`. The original plan §7
    > `ALTER TABLE ingredients … usda_fdc_id INT REFERENCES foods(fdc_id)` is therefore an
    > **impossible cross-database foreign key** (Postgres cannot FK across databases) **and** 003
    > cannot `ALTER` a table it does not own / that does not exist.
    >
    > **Correct integration (owned by 001):** when 001 builds `ingredients`, it adds a **soft
    > `usda_fdc_id INT` column (no cross-DB FK)** plus the nutrient/sync columns below. Linkage to
    > `foods(fdc_id)` is validated at the **application layer** (the food-service client), not by a
    > DB constraint. See plan.md §7 and §2 "Integration with 001".
    >
    > Deferred column set (added by 001, not 003): `usda_fdc_id INT` (soft, no FK),
    > `fetch_status TEXT DEFAULT 'unlinked'`, `fiber_g_per_100g DECIMAL`,
    > `sodium_mg_per_100g DECIMAL`, `serving_size_g DECIMAL`, `serving_description TEXT`,
    > `brand_owner TEXT`, `last_synced_at TIMESTAMP`.

    **Acceptance** (when 001 implements this, not under 003):
    - 001's `ingredients` migration adds `usda_fdc_id INT` as a **soft column (no cross-DB FK)**; `NULL` allowed
    - Application-layer linkage validation against `food-service` covers what the FK cannot

---

## Phase 2 — REST API Layer (US-001, US-002, US-006, US-008)

- [x] **T-010** [P1] [US-001] NestJS Module: `FoodsModule` — `packages/services/food-service/src/foods/foods.module.ts`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-005, T-006, T-007, T-008
      **Implements**: FR-001

    Scaffold `packages/services/food-service/src/foods/foods.module.ts` with:
    - `FoodsController` (routes)
    - `FoodsService` (business logic)
    - `FoodsRepository` (Drizzle queries)
    - Import `UsdaApiModule`, `EventBridgeModule`

    **Acceptance**:
    - Module bootstraps without errors in NestJS app
    - All providers injectable via DI

---

- [x] **T-011** [P1] [US-001] `GET /v1/foods/{fdcId}` — Cache Hit & Tombstone Path — `—`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-010
      **Implements**: FR-001, FR-002, FR-005, FR-006

    Implement the synchronous lookup path:
    1. Validate `fdcId` is a positive integer (400 on invalid)
    2. Check PostgreSQL `foods` table:
        - `fetch_status = 'fetched'` → return 200 with full food data
        - `fetch_status = 'not_found'` (tombstone) → if the tombstone is **within** its TTL (default 30d, `USDA_TOMBSTONE_TTL_DAYS`), return 404 with tombstone message (no queuing); if the TTL has **lapsed**, re-attempt (enqueue per T-012) so USDA can be re-checked (FR-025)
    3. Response shape per plan.md §3

    **Acceptance**:
    - Cache hit returns 200 within 50ms (US-001 scenario 1)
    - Tombstoned food within TTL returns 404 without queuing (US-001 scenario 4)
    - Tombstoned food past TTL is re-enqueued on lookup (FR-025 TTL re-attempt)
    - Invalid `fdcId` returns 400 (FR-006)

---

- [x] **T-012** [P1] [US-002] `GET /v1/foods/{fdcId}` — Cache Miss / Enqueue Path — `—`
      **Story**: US-002
      **Priority**: P1
      **Depends on**: T-011, T-016
      **Implements**: FR-003, FR-004, FR-011, FR-013, FR-014, FR-017

    Extend the lookup handler for async backfill:
    1. Food not in local store → execute idempotent enqueue with **distinct-requester** demand (FR-044 — each `sub` contributes at most 1; never a raw `request_count + 1`):
        ```sql
        -- distinct-requester demand (PRIORITY_CAP=1 is inherent in COUNT(DISTINCT sub))
        INSERT INTO fetch_requesters (fdc_id, sub) VALUES ($1, $2)
          ON CONFLICT (fdc_id, sub) DO NOTHING;
        INSERT INTO fetch_queue (fdc_id) VALUES ($1)
        ON CONFLICT (fdc_id) DO UPDATE
        SET request_count = (SELECT count(*) FROM fetch_requesters WHERE fdc_id = $1),
            last_requested = now()
        WHERE fetch_queue.status IN ('pending', 'in_flight');
        ```
    2. Pair with `pg_notify('fetch_queued', fdc_id)`
    3. Return `202 Accepted` with `{ status: "pending", fdcId, estimatedWaitSeconds: 30 }`
    4. Duplicate requests increment `request_count` (US-005 scenario 3)

    **Acceptance**:
    - First request returns 202 within 100ms (US-002 scenario 1)
    - Second request increments `request_count`, returns 202 without duplicate row (US-005 scenario 3)
    - `pg_notify` fires on every enqueue

---

- [x] **T-063** [P2] [US-007] `GET /v1/foods/{fdcId}` — Stale-While-Revalidate Read Path — `—`
      **Story**: US-007
      **Priority**: P2
      **Depends on**: T-011, T-016
      **Implements**: FR-031

    Extend the lookup handler for the `stale` read path (stale-while-revalidate):
    1. Record with `fetch_status = 'stale'` (or `fetched` past `USDA_STALE_THRESHOLD_DAYS`) → **serve the existing data immediately as `200`** with a staleness indicator (the read never blocks and never returns `202` for a record it already holds)
    2. Trigger a **background re-fetch** by enqueuing via `FetchQueueService` (deduped per FR-014) + `pg_notify`
    3. If the background re-fetch keeps failing (e.g. prolonged USDA outage), **continue serving the stale data indefinitely** — there is no max-staleness cutoff that withholds an already-held record; the re-fetch keeps retrying (availability over freshness)

    **Acceptance**:
    - A `stale` record returns `200` with the staleness indicator (not `202`) and enqueues a background re-fetch
    - A repeated read while the re-fetch is still failing keeps returning the stale `200` (served indefinitely)
    - Once the re-fetch succeeds the record is upserted and subsequent reads return fresh `200`

---

- [x] **T-013** [P2] [US-008] `GET /v1/foods/{fdcId}/status` — `—`
      **Story**: US-008
      **Priority**: P2
      **Depends on**: T-010
      **Implements**: FR-007, FR-033

    Implement status polling:
    - Query `foods.fetch_status` or `fetch_queue.status` for the given `fdcId`
    - `pending` / `in_flight` → `{ fdcId, status: "pending", estimatedWaitSeconds: 20 }`
    - `fetched` → `{ fdcId, status: "fetched", ...fullFoodData }`
    - `not_found` (tombstone) → `{ fdcId, status: "not_found" }`
    - `tombstone` (from fetch_queue) → `{ fdcId, status: "not_found" }`
    - Food not in DB at all → 404

    **Acceptance**:
    - All status transitions return correct shapes (US-008 scenarios 1–4)

---

- [x] **T-014** [P2] [US-006] `GET /v1/foods/search?query=` & Autocomplete — `—`
      **Story**: US-006
      **Priority**: P2
      **Depends on**: T-008, T-010
      **Implements**: FR-008, FR-009, FR-010

    Implement full-text + fuzzy search:
    - Use `search_vector @@ plainto_tsquery(query)` for FTS
    - Fall back to `pg_trgm` similarity for short/misspelled queries
    - Return max 20 results ranked by relevance (`ts_rank`)
    - Never calls USDA API (local-only)
    - `GET /v1/foods/autocomplete?query=` — same logic, returns `[{ fdcId, description }]` (max 10)

    **Acceptance**:
    - "chicken breast" returns relevant results (US-006 scenario 1)
    - "avacado" returns avocado via fuzzy match (US-006 scenario 2)
    - Empty result set returned (not USDA call) when no local match (US-006 scenario 3)
    - 10,000-food dataset returns results within 200ms (US-006 scenario 4)

---

- [x] **T-015** [P2] [US-001] `GET /v1/foods/{fdcId}/nutrients` — `—`
      **Story**: US-001 / US-004
      **Priority**: P2
      **Depends on**: T-011
      **Implements**: FR-002

    Implement full nutrient breakdown:
    - Returns all macro + micro columns from `foods` table
    - Includes `raw_json` nutrient array from USDA response
    - 404 if food not fetched yet (with pending status hint)

    **Acceptance**:
    - Returns all nutrient fields including micros
    - Null fields included in response (not omitted)

---

## Phase 3 — Postgres Queue + Fargate Consumer (US-002, US-003, US-005)

- [x] **T-016** [P1] [US-002] Enqueue Service (`FetchQueueService`) — `packages/services/food-service/src/foods/fetch-queue.service.ts`
      **Story**: US-002 / US-005
      **Priority**: P1
      **Depends on**: T-006
      **Implements**: FR-014, FR-017

    Create `packages/services/food-service/src/foods/fetch-queue.service.ts`:
    - `enqueue(fdcId: string, source: 'single' | 'batch'): Promise<void>`
    - Executes `INSERT … ON CONFLICT DO UPDATE` per FR-014
    - Emits `pg_notify('fetch_queued', fdc_id)` after successful insert
    - Used by API handlers (T-012, T-027) and stale refresh (T-031)

    **Acceptance**:
    - Concurrent enqueues for same `fdcId` produce exactly one row with incremented counter
    - `pg_notify` payload contains the `fdc_id`

---

- [ ] **T-017** [P1] [US-005] Fargate Worker Scaffold (`food-fetch-worker`) — `packages/services/food-service/src/worker/`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-001, T-003
      **Implements**: FR-017, FR-018, FR-022

    Create `packages/services/food-service/src/worker/`:
    - ECS Fargate task definition (512 MB, Node.js 22.x)
    - Single desired count (FR-022: exactly one consumer)
    - `LISTEN fetch_queued` on startup (persistent Postgres connection)
    - Structured logging via `@aws-lambda-powertools/logger`
    - Sentry error capture via `@sentry/aws-serverless`
    - Graceful shutdown on SIGTERM (release `in_flight` leases)

    **Acceptance**:
    - Worker deploys via CDK and holds `LISTEN` connection open
    - `pg_notify` wake-to-process latency ≤ 100ms (US-005 scenario 4)
    - SIGTERM handler reverts all `in_flight` rows for this worker to `pending`

---

- [ ] **T-018** [P1] [US-005] Consumer: LISTEN/NOTIFY Wakeup + Drain Loop — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-017, T-016
      **Implements**: FR-015, FR-017

    Implement the drain loop in the worker:
    1. Block on `LISTEN fetch_queued` notification
    2. On wakeup: `SELECT fdc_id FROM fetch_queue WHERE status='pending' AND last_requested <= now() ORDER BY request_count DESC, first_requested ASC FOR UPDATE SKIP LOCKED LIMIT 1`
    3. Transition selected row `status='in_flight'`
    4. Process → update row → loop until no pending rows match
    5. Return to blocking `LISTEN`

    **Acceptance**:
    - `A` with `request_count=50` processed before `B` with `request_count=1` (US-005 scenario 1)
    - Tie-break: earlier `first_requested` wins (US-005 scenario 2)
    - Empty queue → worker blocks, consuming no CPU

---

- [ ] **T-019** [P1] [US-002] Consumer: Single Food Fetch Flow — `—`
      **Story**: US-002
      **Priority**: P1
      **Depends on**: T-018, T-003, T-024
      **Implements**: FR-023, FR-024, FR-025

    Implement single-food fetch in the worker:
    1. Extract `fdc_id` from locked row
    2. Check the rolling-window limiter (`RollingWindowLimiter.tryRecord()`); if it returns `false` (window full / at 90% pause), leave the row `pending` and stop draining
    3. Call `UsdaApiClient.getFood(fdcId)`
    4. On 200: upsert `foods` with `fetch_status='fetched'`, `fetched_at=now()`, and **delete the `fetch_queue` row** (success removes it — the canonical `fetch_queue` status enum is `pending | in_flight | tombstone`; there is no `done`)
    5. On 404: tombstone immediately — `fetch_queue.status='tombstone'`, `foods.fetch_status='not_found'` (no retry)
    6. On 5xx: set `fetch_queue.status='pending'`, `attempts=attempts+1`, `last_error=<code>`, `last_requested=now()+backoff(attempts)` (US-005 scenario 5)

    **Acceptance**:
    - Successful fetch: food in DB with `fetch_status='fetched'` (US-002 scenario 2)
    - USDA 404: tombstone written, no retry (US-002 scenario 5)
    - USDA 5xx: row returned to pending with incremented `attempts` (US-005 scenario 5)

---

- [ ] **T-020** [P1] [US-004] Consumer: Batch Food Fetch Flow — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-019
      **Implements**: FR-012, FR-023, FR-024

    Implement batch fetch in the worker:
    1. Select up to 20 pending rows with `source='batch'` or adjacent `fdc_id`s (lock all with `FOR UPDATE SKIP LOCKED`)
    2. Record exactly 1 USDA call against the rolling window (`RollingWindowLimiter.tryRecord()`) for the whole batch
    3. Call `UsdaApiClient.getFoodsBatch(fdcIds)` (POST `/v1/foods`)
    4. For each result: upsert `fetch_status='fetched'` and **delete the `fetch_queue` row**
    5. For each 404 in batch response: write tombstone
    6. On partial 5xx: successful items have their `fetch_queue` row deleted, failed items left `pending` with `attempts++`

    **Acceptance**:
    - 5 IDs in batch → 1 USDA call recorded against the rolling window (US-004 scenario 3)
    - Mixed 200/404 batch: 4 fetched + 1 tombstoned (US-004 scenario 4)

---

- [ ] **T-021** [P1] [US-005] Consumer: Lease Watchdog — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-017
      **Implements**: FR-018

    Implement lease recovery:
    - Watchdog query run on worker start and every 60s:
        ```sql
        UPDATE fetch_queue SET status='pending'
        WHERE status='in_flight' AND last_requested < now() - interval '30 seconds';
        ```
    - Also run on SIGTERM to release this worker's leases

    **Acceptance**:
    - Row stuck `in_flight` for 35s reverted to `pending` on next watchdog tick (US-005 lease recovery)
    - Worker crash: leases recovered within 60s

---

- [ ] **T-022** [P1] [US-005] Consumer: Tombstone & Backoff Logic — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-019
      **Implements**: FR-016, FR-025, FR-026, FR-027

    Implement error classification and retry policy:
    - 404 → immediate `status='tombstone'`, `last_error='404'`, no retry. The tombstone carries a **configurable TTL (default 30 days, `USDA_TOMBSTONE_TTL_DAYS`)**; record `fetched_at`/`tombstoned_at` so a later lookup after the TTL has lapsed MAY re-attempt the fetch (FR-025). The re-attempt counts against the normal rolling-window budget (FR-019). Within the TTL the tombstone returns `404` without enqueueing.
    - 429 → treat the rolling window as full and back off (pause draining), return row to `pending` with `attempts++`, backoff `2^attempts` seconds
    - 5xx / timeout → return to `pending`, `attempts++`, backoff `2^attempts` seconds
    - After 5 attempts → `status='tombstone'`, `last_error='max_retries'`
    - Tombstone rows queryable by ops for audit

    **Acceptance**:
    - 5xx row cycles `pending → in_flight → pending` with exponential backoff, lands in tombstone after 5 attempts (US-005 scenario 5)
    - 404 immediate tombstone (US-002 scenario 5)
    - A `not_found` tombstone older than the TTL is re-attempted on the next lookup; within the TTL it returns `404` without enqueueing (FR-025)

---

- [ ] **T-023** [P2] [US-006] Food Search Indexer (EventBridge) — `packages/services/food-service/src/lambdas/food-search-indexer/handler.ts`
      **Story**: US-006
      **Priority**: P2
      **Depends on**: T-019
      **Implements**: FR-008

    Create `packages/services/food-service/src/lambdas/food-search-indexer/handler.ts`:
    - Triggered by `FoodFetchCompleted` EventBridge event (emitted by worker on successful fetch)
    - Updates `foods.search_vector`: `to_tsvector('english', description)`
    - Invalidates any in-process LRU cache

    **Acceptance**:
    - After fetch, `search_vector` is populated and food appears in search results
    - No Redis cache to invalidate (architecture uses PostgreSQL directly)

---

## Phase 4 — Rolling 60-Minute Window Rate Limiter (US-003)

- [ ] **T-024** [P1] [US-003] Rolling Window Limiter: In-Process Implementation — `packages/services/food-service/src/rate-limiter/rolling-window-limiter.ts`
      **Story**: US-003
      **Priority**: P1
      **Depends on**: T-007
      **Implements**: FR-019, FR-020

    Create `packages/services/food-service/src/rate-limiter/rolling-window-limiter.ts`:
    - `RollingWindowLimiter` class: `tryRecord(): boolean` (count trailing-60-min calls and record the new call atomically; reject when already at cap), `count(): number` (calls in the trailing 60 min), `isPaused(): boolean` (true once the trailing count ≥ 900 / 90%)
    - Limit: **≤1,000 USDA calls per trailing 60 minutes**; worker pauses draining at **90% (900)** and resumes as calls age out of the window (no continuous refill, no token capacity)
    - In-process state is a list of recent call timestamps, pruned to the trailing 60 min (single Fargate worker = no shared state needed at MVP)
    - Thread-safe within the Node.js event loop

    **Acceptance**:
    - `tryRecord()` with a trailing count of 3 → returns `true`, count becomes 4 (US-003 scenario 1)
    - `isPaused()` flips to `true` once the trailing count reaches 900 and back to `false` as calls age out below the threshold (US-003 scenario 2)
    - `tryRecord()` when the trailing count is at 1,000 → returns `false`, worker pauses draining (US-003 scenario 3)
    - Calls older than 60 min are excluded from the count (window slides)

---

- [ ] **T-025** [P2] [US-003] Rolling Window Limiter: Postgres Persistence (`usda_call_log`) — `—`
      **Story**: US-003
      **Priority**: P2
      **Depends on**: T-024
      **Implements**: FR-020

    Create the `usda_call_log`-backed `RollingWindowLimiter` variant:
    - Atomic check-and-record in one statement, e.g. `INSERT INTO usda_call_log (called_at) SELECT now() WHERE (SELECT count(*) FROM usda_call_log WHERE called_at > now() - interval '60 minutes') < 1000 RETURNING id` — inserts (and thus permits the call) only when the trailing-60-min count is below the cap
    - Periodically prune rows older than 60 min (`DELETE FROM usda_call_log WHERE called_at < now() - interval '60 minutes'`)
    - Falls back to in-process if the call log is unavailable

    **Acceptance**:
    - Concurrent check-and-record calls are atomic (no race lets the trailing count exceed 1,000)
    - Trailing-60-min count is computed correctly as old rows age out / are pruned

---

- [ ] **T-026** [P1] [US-003] Rolling Window Limiter: Unit Tests — `—`
      **Story**: US-003
      **Priority**: P1
      **Depends on**: T-024, T-025
      **Implements**: FR-019, FR-020

    Write unit tests for the in-process and `usda_call_log`-backed `RollingWindowLimiter`:
    - Record with the trailing count below cap (returns true)
    - Record at the 1,000 cap (returns false / worker pauses)
    - Pause at 90% (900) and resume as calls age out (mock time)
    - Window slide: calls older than 60 min drop out of the count (mock time)
    - Concurrent check-and-record (mock DB for atomicity — never exceeds 1,000)
    - USDA 429 failsafe: treat the window as full and back off

    **Acceptance**:
    - All scenarios from US-003 acceptance criteria covered
    - Tests pass with `npm test`

---

## Phase 5 — Batch Processing & Deduplication (US-004)

- [ ] **T-027** [P1] [US-004] `POST /v1/foods/batch` — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-012, T-016
      **Implements**: FR-012

    Implement the batch request endpoint:
    1. Accept `{ fdcIds: number[] }` (max 20, validated)
    2. Resolve known foods from PostgreSQL
    3. Identify unknown IDs (not in `foods` and not `done` in `fetch_queue`)
    4. Deduplicate against `fetch_queue` pending rows
    5. Enqueue unknown IDs via `FetchQueueService` with `source='batch'`
    6. Return: resolved foods + pending IDs

    **Acceptance**:
    - 15 ingredients (10 known, 5 unknown) → 10 resolved + 5 pending (US-004 scenario 1)
    - 5 unknown IDs → all enqueued, `request_count` incremented if already pending (US-004 scenario 2)

---

- [ ] **T-028** [P1] [US-004] Batch Consumer Integration — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-020, T-027
      **Implements**: FR-012, FR-013

    Wire batch enqueue to batch consumer:
    - API enqueues at `request_count=0` for background batch enrichment (drains during idle periods)
    - Worker selects batch-ready rows (adjacent `fdc_id`s or `source='batch'`)
    - Single `POST /v1/foods` call counts as 1 USDA call against the rolling window for up to 20 items

    **Acceptance**:
    - Batch of 20 IDs → 1 USDA API call, 1 call recorded against the rolling window
    - Background batch jobs do not starve high-priority single lookups

---

- [ ] **T-029** [P1] [US-005] Demand-Weighted Priority Verification — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-018, T-027
      **Implements**: FR-015

    Verify and tune priority ordering:
    - Unit test: enqueue `fdc_id=A` 50 times, `fdc_id=B` once
    - Assert worker selects `A` before `B`
    - Background batch enrichment (`request_count=0`) drains only when no `request_count>0` rows exist

    **Acceptance**:
    - `A` (request_count=50) processed before `B` (request_count=1) (US-005 scenario 1)
    - Batch rows at `request_count=0` yield to any user-demand row

---

## Phase 6 — Stale Data Refresh (US-007)

- [ ] **T-030** [P2] [US-007] Stale Refresh Scheduler (EventBridge) — `packages/services/food-service/src/lambdas/usda-stale-refresh/handler.ts`
      **Story**: US-007
      **Priority**: P2
      **Depends on**: T-001
      **Implements**: FR-031

    Create `packages/services/food-service/src/lambdas/usda-stale-refresh/handler.ts`:
    - EventBridge scheduled rule: daily at 3am UTC
    - Query `foods` where `fetched_at < NOW() - INTERVAL '30 days'` AND `fetch_status = 'fetched'`
    - Configurable threshold via `USDA_STALE_THRESHOLD_DAYS`

    **Acceptance**:
    - Food fetched 31 days ago → identified as stale (US-007 scenario 1)
    - Food fetched 5 days ago → NOT identified (US-007 scenario 2)
    - Tombstoned foods (`not_found`) → never re-queued (US-007 scenario 3)

---

- [ ] **T-031** [P2] [US-007] Stale Refresh Enqueue — `—`
      **Story**: US-007
      **Priority**: P2
      **Depends on**: T-030, T-016
      **Implements**: FR-032

    Extend stale refresh Lambda to enqueue via `FetchQueueService`:
    - Batch stale `fdcIds` into groups of 20
    - Enqueue each group with `source='batch'` and `request_count=0`
    - `pg_notify('fetch_queued', ...)` triggers worker

    **Acceptance**:
    - 500 stale foods → 25 batch enqueues (20 per batch)
    - Worker wakes and drains stale batch during idle periods

---

- [ ] **T-032** [P2] [US-007] Bulk Sync Lambda (Weekly Foundation/SR Legacy) — `packages/services/food-service/src/lambdas/usda-bulk-sync/handler.ts`
      **Story**: US-007 (bulk variant)
      **Priority**: P2
      **Depends on**: T-005, T-007
      **Implements**: FR-031

    Create `packages/services/food-service/src/lambdas/usda-bulk-sync/handler.ts`:
    - EventBridge scheduled: Sunday 2am UTC
    - Downloads Foundation + SR Legacy bulk files from USDA
    - Upserts into `foods` table (batch inserts, 1,000 rows/batch)
    - Updates `usda_sync_metadata` with version and timestamp

    **Acceptance**:
    - Lambda completes without timeout for a 10,000-row test dataset
    - `usda_sync_metadata` updated after successful run

---

## Phase 7 — Authentication & Authorization (US-0, FR-035–FR-053)

> Expanded by the 2026-06-19 re-plan to cover the full auth slice (plan §2A). Closes
> sync-verify DRIFT-101 (tasks layer) and the red-team findings. Deployment: in-process
> NestJS `AuthMiddleware` on ECS/Fargate (ALB), shared `ClerkAuthService` verification.

- [ ] **T-033** [P1] [FR-035..038,040] `FoodAuthGuard` — NestJS AuthMiddleware — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-010, T-046 · **Implements**: FR-035, FR-036, FR-037, FR-038, FR-040
      In-process NestJS `AuthMiddleware` on every `/v1/foods/*` route (mirrors `packages/services/identity` `AuthMiddleware`). Networkless `verifyToken` via shared package (`CLERK_JWT_KEY` + `azp`); identity from verified `sub` only (no client header); fail-closed.
      **Acceptance**: no/invalid/expired/wrong-`azp` token → `401`, no enqueue, no USDA call; valid token → `req.user.sub` set; verification makes zero outbound network calls.

- [ ] **T-046** [P1] [FR-036,053] `@kitchensink/clerk-verify` shared package — `packages/shared/clerk-verify`
      **Story**: US-0 · **Depends on**: — · **Implements**: FR-036, FR-053
      Extract `verifyToken(jwtKey, authorizedParties)` from the identity service's `ClerkAuthService` into a shared `@kitchensink/*` package consumed by both identity and food services (one implementation, no drift). FoodAuthGuard is the named, traceable auth component fronting all entry points.

- [ ] **T-047** [P1] [FR-047] M2M / service-token support — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-033 · **Implements**: FR-047 (A-012)
      Accept Clerk **machine (M2M) tokens** (azp-allowlisted) for downstream services (001/006/007/009) and internal jobs (recipe import FR-012, stale-refresh FR-032). Classify each endpoint user-token / service-token / both.
      **Acceptance**: a backend caller with a valid M2M token is accepted (not `401`); a user-only endpoint rejects a service token where disallowed.

- [ ] **T-048** [P1] [FR-039,051] Authorization scopes + status precedence — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-033 · **Implements**: FR-039, FR-051
      `403` for authenticated-but-insufficient `public_metadata` scope on operational endpoints; enforce precedence `401`→`403`→`400`→`404`/`202`/`200` (governs FR-002/003/005/006).
      **Acceptance**: valid token without scope on `POST /v1/foods/{fdcId}/refetch` → `403`; malformed `fdcId` with bad token → `401` (not `400`).

- [ ] **T-049** [P1] [FR-043] Per-`sub` fairness by **demotion** (no quota, no `429`) — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-033, T-056, T-018 (queue) · **Implements**: FR-043 (SC-012)
      Fairness is enforced by **queue demotion, not rejection** — there is **no per-`sub` quota and no `429`**. At drain time the queue scorer computes each candidate row's owning `sub`'s **current pending count** (derived live from `fetch_queue` + `fetch_requesters`); when a `sub` has **more than 50 pending items**, that `sub`'s rows are ranked to the **back** of the priority order (below FR-015 demand ordering) so they cannot starve other users. Demotion is **dynamic**: it reads live state, so a `sub`'s rows auto re-promote to normal priority once its pending count drops back below 50 (no frozen flag, no rejection). Work-conserving — demoted rows still drain on spare capacity.
      **Acceptance**: a `sub` with >50 pending items has its rows ranked to the back while other users' rows drain first; when its pending count falls below 50 its rows return to normal priority; **no request is rejected with `429`** (SC-012 demotion-fairness test).

- [ ] **T-050** [P1] [FR-044] Distinct-requester demand counting — `Test-first: true`
      **Story**: US-0/US-5 · **Depends on**: T-056, T-018 (queue) · **Implements**: FR-044
      `request_count` priority counts **distinct `sub`s** via `fetch_requesters(fdc_id, sub, requested_at)`; repeat requests from one `sub` don't inflate priority; contribution capped; ordering aged.
      **Acceptance**: a single `sub` repeatedly requesting one `fdcId` cannot pin it ahead of genuine distinct-requester demand.

- [ ] **T-051** [P1] [FR-045] Max batch size enforcement — `Test-first: true`
      **Story**: US-0/US-4 · **Depends on**: T-024 (batch) · **Implements**: FR-045
      `POST /v1/foods/batch` and recipe-import sets ≤ 100 `fdcId`s → `400` over limit, no enqueue; accepted IDs add to the `sub`'s pending count (and so feed the FR-043 demotion check, not a quota). Per FR-045 an accepted mixed batch returns a **per-item partial** result (cached/stale foods inline, each miss as a `pending` entry whose fetch is enqueued).
      **Acceptance**: oversized batch returns `400` and enqueues nothing; an accepted mixed batch returns cached items inline and `pending` entries for the misses in one response body.

- [ ] **T-052** [P1] [FR-046] Queue backpressure + circuit breaker — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-018, T-020 · **Implements**: FR-046
      Enforced max `fetch_queue` depth; when exceeded or the USDA circuit breaker is open → new enqueues fail closed with `503`; jittered recovery (no thundering herd).
      **Acceptance**: at max depth / breaker-open, enqueue returns `503`; recovery drains without a burst spike.

- [ ] **T-053** [P2] [FR-048] Async-producer least-privilege IAM + provenance — `—`
      **Story**: US-0 · **Depends on**: T-006 (infra) · **Implements**: FR-048
      Only named IAM roles may `events:PutEvents` / insert into `fetch_queue`; consumer validates event provenance; `requestedBy` carries the authenticated `sub` or named service principal (no unauthenticated `'system'` shortcut).

- [ ] **T-054** [P2] [FR-052] Auth-layer DoS protection — `Test-first: true`
      **Story**: US-0 · **Depends on**: T-033 · **Implements**: FR-052 (SC-009/SC-011)
      Bound verification concurrency + per-source `401`-rate cap (load-shed) so an invalid-token flood can't saturate the verifier.
      **Acceptance**: SC-011 (≤10ms p95) holds under an invalid-token flood, not just the happy path.

- [ ] **T-056** [P1] [FR-043,044] Migration: `fetch_requesters` (no quota tables) — `—`
      **Story**: US-0 · **Depends on**: T-010 · **Implements**: FR-043, FR-044
      Drizzle migration for `fetch_requesters(fdc_id, sub, requested_at)` (+ indexes, including one on `sub` to compute a `sub`'s live pending count for the FR-043 demotion check). **No `user_fetch_quota` / `global_fetch_quota` tables** — fairness is demotion (FR-043), which derives the per-`sub` pending count at drain time from `fetch_queue` + `fetch_requesters`; there is no quota row and no `429`. Includes **user-erasure handling**: on a user-deletion event, `fetch_requesters` rows for that `sub` are deleted (or TTL'd) — closes the constitution data-privacy warning.

> **WebSocket auth (FR-041, FR-049)** is tracked with the deferred WebSocket work in **Phase 9**
> (`$connect` Lambda authorizer on the API Gateway WebSocket API + per-`sub` notification
> targeting from `fetch_requesters`), since the WS API itself is P3-deferred.

---

## Phase 7b — Packages & Workspace Wiring (Foundation)

- [x] **T-060** [P0] [Foundation] Register new packages in root workspaces — `package.json`
      **Story**: Foundation · **Depends on**: — · **Implements**: NFR-006
      Add explicit paths `"packages/clients/usda"` and `"packages/clients/food-service"` to the root
      `package.json` `workspaces` array (`packages/clients` stays a grouping folder, not a glob —
      matching `apps/commise/{web,mobile}`). `services/*` and `shared/*` globs already cover
      `food-service` and `clerk-verify`. Each new package extends the shared `@kitchensink/{typescript,eslint,prettier,vitest}` configs and declares its Turbo tasks.
      **Acceptance**: `npm install` links all four packages; `turbo run typecheck` resolves them.

- [ ] **T-057** [P2] [US-0/integration] `@kitchensink/food-service-client` package — `packages/clients/food-service`
      **Story**: US-0 · **Depends on**: T-010, T-047, T-060 · **Implements**: FR-047 (consumer side)
      Typed client for **our** `/v1/foods/*` API, consumed by web/mobile and downstream services
      (001/006/007/009). Surfaces `getFood`/`searchFoods`/batch, attaches the caller's Clerk token
      (user session **or** M2M service token per FR-047), and maps `401`/`403`/`400`/`503`/`404`/`202` (no per-user `429` — fairness is queue demotion, FR-043; `503` is the FR-046 backpressure/circuit-breaker status).
      **Acceptance**: a downstream service can call the food API with an M2M token via this client and
      receive typed results; unauthorized calls surface typed `401`/`403` errors.

---

## Phase 8 — Monitoring & Observability (US-010)

- [ ] **T-034** [P2] [US-010] Custom CloudWatch Metrics — `—`
      **Story**: US-010
      **Priority**: P2
      **Depends on**: T-017
      **Implements**: FR-016, FR-018

    Emit custom CloudWatch metrics from the Fargate worker:
    - `usda-fetch-queue-depth` — `SELECT count(*) FROM fetch_queue WHERE status='pending'`
    - `usda-api-request-count` — success/failure dimensions
    - `usda-api-latency` — p50/p95/p99
    - `usda-rolling-window-count` — trailing-60-min USDA call count after each recorded call
    - `usda-in-flight-leases` — rows with `status='in_flight'`

    **Acceptance**:
    - Metrics visible in CloudWatch after processing test messages (US-010 scenario 4)
    - `usda-fetch-queue-depth` accurately reflects pending count

---

- [ ] **T-035** [P2] [US-010] CloudWatch Dashboard — `—`
      **Story**: US-010
      **Priority**: P2
      **Depends on**: T-034
      **Implements**: FR-035 (ops)

    CDK: Create CloudWatch dashboard `usda-food-data`:
    - Pending queue depth
    - In-flight lease count
    - Trailing-60-min USDA call count (rolling window)
    - Worker error rate
    - USDA API latency distribution
    - Tombstone count

    **Acceptance**:
    - Dashboard visible in CloudWatch console after `cdk deploy`
    - All 6 widgets populated after processing 100 test requests (US-010 scenario 1)

---

- [ ] **T-036** [P2] [US-010] CloudWatch Alarms — `—`
      **Story**: US-010
      **Priority**: P2
      **Depends on**: T-035
      **Implements**: FR-016, FR-018

    CDK: Create alarms:
    - Tombstone count increase > 0 in 5 min → SNS alert (US-010 scenario 2)
    - API error rate > 5% → SNS alert
    - Queue depth > 10,000 → SNS alert
    - Pending row age > 5 minutes → SNS alert (US-010 scenario 3)

    **Acceptance**:
    - All 4 alarms created in CDK synth
    - Tombstone alarm fires when new tombstones appear (US-010 scenario 2)

---

- [ ] **T-037** [P2] [US-010] Operational Query Endpoint — `—`
      **Story**: US-010
      **Priority**: P2
      **Depends on**: T-036
      **Implements**: FR-016, FR-018

    Create `GET /v1/foods/ops/queue` (authenticated, admin-scoped):
    - Returns current queue depth, in-flight count, tombstone count
    - `GET /v1/foods/ops/tombstones?limit=` — paginated tombstone rows with `attempts`, `last_error`
    - `POST /v1/foods/ops/retry/{fdcId}` — flip `status='pending'` for a tombstone

    **Acceptance**:
    - Ops endpoint returns accurate counts
    - Retry endpoint successfully re-queues a tombstone for reprocessing

---

## Phase 9 — WebSocket Notifications [P3 — Deferred]

- [ ] **T-038** [P3] [US-009] CDK: API Gateway WebSocket API — `—`
      **Story**: US-009
      **Priority**: P3
      **Depends on**: T-033
      **Implements**: FR-034

    > **Deferred**: Implement only if polling UX (US-008) is validated as insufficient.

    Create API Gateway WebSocket API (the one surface where a `$connect` **Lambda authorizer** is the right tool — reuses the shared Clerk-verify package; FR-050 cache rules apply here):
    - `$connect` Lambda authorizer verifies the Clerk token (token via query param or `Sec-WebSocket-Protocol`, since browsers can't set `Authorization` on WS); reject → `403` (FR-041, FR-049)
    - mid-connection `exp` → close; reconnect re-auth after the 10-min idle close
    - Store connection IDs + authenticated `sub` in DynamoDB (`usda_ws_connections`); associate `fdcId` subscriptions with `sub` (drives no-broadcast targeting from `fetch_requesters`)

    **Implements**: FR-034, FR-041, FR-049

    **Acceptance**:
    - `$connect` without a valid token → `403` (no connection); with a valid token → connection + `sub` stored
    - `FoodDataReceived` push reaches only connections whose `sub` requested that `fdcId` (no broadcast)

---

- [ ] **T-039** [P3] [US-009] WebSocket: Push Notification on Fetch Complete — `—`
      **Story**: US-009
      **Priority**: P3
      **Depends on**: T-038
      **Implements**: FR-034

    Extend worker or EventBridge rule to push WebSocket notification:
    - On `FoodFetchCompleted` event: look up subscribed connection IDs for `fdcId`
    - Push `{ type: "food_ready", fdcId }` via `ApiGatewayManagementApi`
    - Handle stale connections (410 Gone → delete from DynamoDB)

    **Acceptance**:
    - Connected client receives push within 60s of food being fetched (US-009 scenario 1)
    - Stale connection cleaned up without error (US-009 scenario 3)

---

## Phase 10 — Integration Tests

- [ ] **T-040** [P1] [US-001] Integration Test: Cache Hit Path (US-001) — `—`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-011
      **Implements**: FR-001, FR-002, FR-005, FR-006

    Seed 5 known USDA foods in PostgreSQL with `fetch_status='fetched'`. Request each by `fdcId` and verify:
    - 200 OK with complete nutritional data
    - Sub-50ms latency
    - No USDA API call made

    **Acceptance**:
    - All US-001 acceptance scenarios pass end-to-end

---

- [ ] **T-041** [P1] [US-002] Integration Test: Cache Miss → Fetch (US-002) — `—`
      **Story**: US-002
      **Priority**: P1
      **Depends on**: T-012, T-019
      **Implements**: FR-003, FR-004, FR-011, FR-013, FR-024, FR-025

    Request a valid `fdcId` that does not exist locally:
    1. Verify `202 Accepted` returned immediately
    2. Verify `fetch_queue` row created with `status='pending'`
    3. Wait for worker to process
    4. Re-request same `fdcId` → verify `200 OK` with full data
    5. Verify no duplicate `fetch_queue` rows created on concurrent requests

    **Acceptance**:
    - All US-002 acceptance scenarios pass end-to-end
    - Deduplication works under 10 concurrent requests

---

- [ ] **T-042** [P1] [US-004] Integration Test: Batch + Deduplication (US-004) — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-027, T-020
      **Implements**: FR-012, FR-023, FR-024

    Create a recipe with 15 ingredients where 10 are locally cached and 5 are unknown:
    - Verify response includes 10 resolved + 5 pending
    - Verify exactly 1 batch USDA API call made (not 5 individual calls)
    - Verify 1 USDA call recorded against the rolling window for the batch

    **Acceptance**:
    - All US-004 acceptance scenarios pass end-to-end

---

- [ ] **T-043** [P1] [US-005] Integration Test: Priority + Tombstone (US-005) — `—`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-018, T-022
      **Implements**: FR-014, FR-015, FR-016, FR-017, FR-018

    Test demand-weighted priority and failure recovery:
    1. Enqueue `fdc_id=A` 50 times, `fdc_id=B` once → verify `A` processed first
    2. Inject USDA 503 for `fdc_id=C` → verify 5 retry cycles with backoff → tombstone
    3. Inject USDA 404 for `fdc_id=D` → verify immediate tombstone
    4. Verify tombstone rows queryable via ops endpoint

    **Acceptance**:
    - All US-005 acceptance scenarios pass end-to-end

---

- [ ] **T-044** [P2] [US-006] Integration Test: Search + Fuzzy (US-006) — `—`
      **Story**: US-006
      **Priority**: P2
      **Depends on**: T-014
      **Implements**: FR-008, FR-009, FR-010

    Seed 100 foods into PostgreSQL with `search_vector` populated:
    - Search "chicken breast" → verify relevant results ranked
    - Search "avacado" → verify fuzzy match returns "Avocado, raw"
    - Search non-existent term → verify empty result, no USDA call
    - Verify all results within 200ms

    **Acceptance**:
    - All US-006 acceptance scenarios pass end-to-end

---

- [ ] **T-045** [P2] [US-001] In-Process LRU Cache (Optional) — `—`
      **Story**: US-001
      **Priority**: P2
      **Depends on**: T-010
      **Implements**: FR-030 (in-process variant, no Redis)

    Add an optional in-process LRU cache in the NestJS API process:
    - Key format: `food:{fdcId}`
    - Max 1,000 entries, 5-minute TTL
    - Used for repeated lookups within a single request handler lifetime
    - No shared cache infrastructure (no Redis)

    **Acceptance**:
    - Repeated lookup of same `fdcId` within 5 minutes served from memory
    - Cache miss falls through to PostgreSQL
    - No Redis infrastructure provisioned

---

- [ ] **T-064** [P1] [US-001/002/004] E2E Harness: booted food-service + real Postgres — `packages/services/food-service/vitest.e2e.config.ts`
      **Story**: US-001/US-002/US-004 · **Depends on**: T-010, T-012, T-017, T-019 · **Implements**: FR-001..FR-006, FR-011, FR-013, FR-014, FR-024 (E2E coverage)

    Stand up a **true end-to-end** harness for the headless food API (the Phase 10 T-040–T-045 tests
    are component/integration-level with stubs; this exercises the real wiring). Harness =
    **LocalStack (Hobby) + Docker Postgres**, mirroring the user's Armoury pattern
    (`infra/localstack/docker-compose.yml` at the repo root), runnable identically locally and in CI.
    Mirror the existing `identity` / `identity-webhooks` e2e pattern (`test:e2e` script +
    `vitest.e2e.config.ts`):
    - **Docker Postgres** (the `postgres:16` service in `infra/localstack/docker-compose.yml`, a plain
      container — the "Docker for RDS" decision, **not** LocalStack RDS), migrated to the
      `kitchensink_food` schema from the Phase-1 ordered SQL. This is also the agreed local/test DB
      strategy standing in for the deferred deploy-time migration runner (see `.forge-status.yml`
      follow-up FU-MIGRATE).
    - **LocalStack** (`localstack/localstack:4.4.0`, services
      `secretsmanager,events,sqs,sns,sts,iam,logs,cloudwatch,ssm`; `events` = EventBridge) for the AWS
      services food-service will exercise once they land. food-service has **no `@aws-sdk/*` runtime
      deps today** (it only needs Postgres), so the LocalStack container is wired and ready but is not
      exercised by the current E2E. Needs the `LOCALSTACK_AUTH_TOKEN` Hobby secret for Pro features
      (CI: `secrets.LOCALSTACK_AUTH_TOKEN`); the current /health + DB E2E does not depend on it.
    - **Booted Nest app** via `NestFactory.create(AppModule)` + `app.listen(0)` (HTTP via `fetch`;
      supertest is not a repo dep). The full flow adds the real `FoodAuthGuard` with a test Clerk JWT
      key, real controllers/services/DAOs, real `fetch_queue` + `pg_notify`, with the USDA HTTP client
      mocked at the network boundary only.
    - **Scenarios (Phases 2/3):** cache-hit `200` (no USDA call); cache-miss → `202` + `fetch_queue`
      row + worker drains → re-request `200`; concurrent same-`fdcId` dedup (one row); batch per-item
      partial; EventBridge fetch-completion fan-out asserted via LocalStack.
    - Wire `npm run test:e2e --workspace=packages/services/food-service` and add it to CI (`_ci.yml`)
      as a separate `e2e-food` job (not the default `test`), with both the Postgres and LocalStack
      service containers.

    **Foundation (in place now):** the compose file (`infra/localstack/docker-compose.yml`) + root
    `localstack:up`/`localstack:down` scripts; the `e2e-food` CI job (Postgres + LocalStack services);
    `vitest.e2e.config.ts` + `test:e2e` script; and `tests/e2e/health.e2e.test.ts`, which migrates the
    Docker Postgres, boots the real Nest app, and asserts `GET /health` → 200 + end-to-end DB
    reachability. The full API + EventBridge E2E flows fill in with Phases 2/3. **Checkbox stays
    unticked — only the foundation exists.**

    **Acceptance**:
    - `npm run test:e2e --workspace=packages/services/food-service` boots the app against the Docker
      Postgres and the cache-hit / cache-miss→fetch / dedup / batch / EventBridge scenarios pass green
    - The e2e job runs in CI and is required on the food-service path

---

## Phase 11 — Performance & Availability

- [ ] **T-062** [P2] [perf] Performance / load tests for SC-001/003/004/007 — `—`
      **Story**: US-001/002/006 · **Depends on**: T-040 · **Implements**: SC-001, SC-003, SC-004, SC-007
      Load-test harness validating the measurable success criteria the functional integration tests
      don't cover: cache-hit p95 ≤ 50ms (SC-001), backfill `202`→available p95 ≤ 60s at queue depth
      < 100 (SC-003), cache-hit rate ≥ 80% after 5,000 foods (SC-004), search p95 ≤ 200ms at 50,000
      foods (SC-007). (SC-011 auth-under-flood is already covered by STP-013-B.)
      **Acceptance**: each SC threshold measured and reported under representative load; regressions fail CI.

- [ ] **T-061** [P3 — Deferred] [infra] Multi-AZ upgrade of shared DB (SC-009) — `packages/infra/global/lib/platform/data-stack.ts`
      **Story**: US-0/availability · **Depends on**: — · **Implements**: SC-009 (A-013)
      Promote the shared `kitchensink-data-{stage}` instance to `multiAz: true` so SC-009's 99.9%
      target becomes defensible. **Deferred to the GA/scale phase** — lean launch accepts the
      single-AZ risk (A-013). This is a global-DataStack change affecting all consumers (identity +
      food), so it is coordinated platform work, not food-only.
      **Acceptance**: `cdk diff` flips `multiAz` to true with a failover test plan; no data loss.

---

## FR Coverage Audit

| FR     | Covered By          | Status                                  |
| ------ | ------------------- | --------------------------------------- |
| FR-001 | T-010, T-011        | ✅                                      |
| FR-002 | T-011, T-015        | ✅                                      |
| FR-003 | T-012               | ✅                                      |
| FR-004 | T-012               | ✅                                      |
| FR-005 | T-011               | ✅                                      |
| FR-006 | T-011               | ✅                                      |
| FR-007 | T-013               | ✅                                      |
| FR-008 | T-014, T-023        | ✅                                      |
| FR-009 | T-014               | ✅                                      |
| FR-010 | T-014               | ✅                                      |
| FR-011 | T-012               | ✅                                      |
| FR-012 | T-027, T-028        | ✅                                      |
| FR-013 | T-012, T-028        | ✅                                      |
| FR-014 | T-016               | ✅                                      |
| FR-015 | T-018, T-029        | ✅                                      |
| FR-016 | T-022, T-037        | ✅                                      |
| FR-017 | T-016, T-017, T-018 | ✅                                      |
| FR-018 | T-017, T-021, T-024 | ✅                                      |
| FR-019 | T-002, T-024        | ✅                                      |
| FR-020 | T-024, T-025        | ✅                                      |
| FR-021 | T-024               | ✅                                      |
| FR-022 | T-017               | ✅                                      |
| FR-023 | T-003, T-019, T-020 | ✅                                      |
| FR-024 | T-019, T-020        | ✅                                      |
| FR-025 | T-011, T-019, T-022 | ✅ (incl. 30d tombstone TTL re-attempt) |
| FR-026 | T-022               | ✅                                      |
| FR-027 | T-022               | ✅                                      |
| FR-028 | T-004, T-005        | ✅                                      |
| FR-029 | T-005, T-008        | ✅                                      |
| FR-030 | T-045               | ✅ (in-process, no Redis)               |
| FR-031 | T-063, T-030, T-032 | ✅ (SWR on-read + scheduled sweep)      |
| FR-032 | T-031               | ✅                                      |
| FR-033 | T-013               | ✅                                      |
| FR-034 | T-038, T-039        | ✅ (deferred)                           |
| FR-035 | T-033               | ✅                                      |

**Gap**: None. All **53 FRs** trace to at least one task. FR-030 maps to T-045 (in-process LRU) because the new architecture explicitly removes Redis; the functional intent (cache acceleration) is preserved without ElastiCache infrastructure.

**Auth coverage (FR-035–FR-053, added 2026-06-19 re-plan):**

| FR                                     | Task(s)                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| FR-035, FR-036, FR-037, FR-038, FR-040 | T-033 (FoodAuthGuard middleware) + T-046 (shared verify pkg)                                  |
| FR-039, FR-051                         | T-048 (scopes + `403` + status precedence)                                                    |
| FR-041, FR-049                         | Phase 9 (T-038/T-039 — `$connect` authorizer + per-`sub` targeting, deferred)                 |
| FR-042                                 | T-033 / config                                                                                |
| FR-043                                 | T-049 (per-`sub` demotion, no quota/`429`) · FR-044 → T-050 · FR-045 → T-051 · FR-046 → T-052 |
| FR-047                                 | T-047 (M2M) · FR-048 → T-053 · FR-052 → T-054 · FR-053 → T-046                                |
| migrations                             | T-056 (`fetch_requesters`, user-erasure — no quota tables)                                    |

Test-first tasks: T-033, T-047, T-048, T-049, T-050, T-051, T-052, T-054 (auth `401`/`403`, demotion fairness (no `429`), azp rejection, no-broadcast WS, one-user-can't-starve-others).
