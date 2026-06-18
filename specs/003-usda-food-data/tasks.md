# Tasks: Feature 003 — USDA Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate Worker + Token Bucket)
**Updated**: 2026-06-02
**Source Artifacts**: plan.md, spec.md, product-spec.md
**Design Reference**: plan.md §4 Fetch Queue (Postgres-as-queue), spec.md FR-014..FR-018

---

## User Story Reference

| US     | Name                                | Priority | FRs                                                    |
| ------ | ----------------------------------- | -------- | ------------------------------------------------------ |
| US-001 | Single Food Lookup (Cache Hit)      | P1       | FR-001, FR-002, FR-005, FR-006                         |
| US-002 | Cache Miss / Async Backfill         | P1       | FR-003, FR-004, FR-007, FR-011, FR-013, FR-024, FR-025 |
| US-003 | Rate-Limited USDA Consumption       | P1       | FR-019, FR-020, FR-021, FR-022, FR-026, FR-027         |
| US-004 | Bulk Ingredient Lookup              | P1       | FR-012, FR-023, FR-024                                 |
| US-005 | Demand-Weighted Priority + Recovery | P1       | FR-014, FR-015, FR-016, FR-017, FR-018                 |
| US-006 | Food Search by Name                 | P2       | FR-008, FR-009, FR-010                                 |
| US-007 | Stale Data Refresh                  | P2       | FR-031, FR-032                                         |
| US-008 | Fetch Status Polling                | P2       | FR-007, FR-033                                         |
| US-009 | WebSocket Notifications             | P3       | FR-034                                                 |
| US-010 | Monitoring Dashboard                | P3       | FR-016, FR-018, FR-035                                 |

---

## Dependency Graph

```
SETUP (T-001–T-004)
  └─► SCHEMA (T-005–T-009)
        └─► API LAYER (T-010–T-015)
              ├─► QUEUE + CONSUMER (T-016–T-023)
              │     └─► RATE LIMITER (T-024–T-026)
              │           └─► BATCH PROCESSING (T-027–T-029)
              ├─► SEARCH INDEXER (T-023)
              ├─► STALE REFRESH (T-030–T-032)
              ├─► AUTH INTEGRATION (T-033)
              └─► MONITORING (T-034–T-037)

WEBSOCKET (T-038–T-039) [P3 — Deferred]
INTEGRATION TESTS (T-040–T-045)
```

---

## Phase 0 — Setup & Infrastructure

- [ ] **T-001** [P0] [Foundation] CDK Stack Scaffold — `—`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: —
      **Implements**: ARCH-001 (Postgres-as-queue stack)

    Create the CDK stack for feature 003 under `infra/stacks/usda-food-data/`. Define the stack class, environment config, and export outputs (RDS cluster endpoint, Fargate service name, Lambda ARNs, table names) consumed by other stacks.

    **Acceptance**:
    - `cdk synth` produces valid CloudFormation with no errors
    - Stack exports `usdaFoodDataRdsEndpoint`, `usdaFetchWorkerServiceName`

---

- [ ] **T-002** [P0] [Foundation] Environment Config (Zod) — `—`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-001
      **Implements**: FR-019, FR-031 (env-driven config)

    Add USDA-specific env vars to the Zod schema in `@nestjs/config`:
    - `USDA_API_KEY` (required, string)
    - `USDA_API_BASE_URL` (default: `https://api.nal.usda.gov/fdc/v1`)
    - `USDA_RATE_LIMIT_PER_HOUR` (default: 1000)
    - `USDA_STALE_THRESHOLD_DAYS` (default: 30)
    - `USDA_WORKER_DESIRED_COUNT` (default: 1)
    - `USDA_LEASE_TIMEOUT_SECONDS` (default: 30)

    **Acceptance**:
    - Missing `USDA_API_KEY` at startup throws a descriptive Zod validation error
    - All env vars accessible via `ConfigService` in Fargate and NestJS contexts

---

- [ ] **T-003** [P0] [Foundation] USDA API Client Module — `packages/services/usda-food-data/src/usda/usda-api.client.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-002
      **Implements**: FR-023 (USDA API integration)

    Create `packages/services/usda-food-data/src/usda/usda-api.client.ts` — a typed HTTP client wrapping the USDA FoodData Central REST API:
    - `getFood(fdcId: number): Promise<UsdaFoodDetail>`
    - `getFoodsBatch(fdcIds: number[]): Promise<UsdaFoodDetail[]>` (POST `/v1/foods`, max 20 IDs)
    - `searchFoods(query: string): Promise<UsdaSearchResult>`
    - 10s request timeout
    - Throws `UsdaNotFoundError` on 404, `UsdaRateLimitError` on 429, `UsdaServerError` on 5xx

    **Acceptance**:
    - Unit tests mock HTTP layer; all error types are thrown correctly
    - `getFoodsBatch` rejects arrays > 20 IDs with `InvalidBatchSizeError`

---

- [ ] **T-004** [P0] [Foundation] Drizzle Schema Files for 003 — `packages/api/usda-food/src/db/schema/usda.ts`
      **Story**: Foundation
      **Priority**: P0
      **Depends on**: T-001
      **Implements**: FR-028 (data persistence schema)

    Create `packages/api/usda-food/src/db/schema/usda.ts` with Drizzle table definitions for:
    - `foods` (all columns from plan.md §2)
    - `fetch_queue` (`fdc_id` text PK, `request_count`, `first_requested`, `last_requested`, `status`, `attempts`, `last_error`, `fetched_at`)
    - `usda_sync_metadata` (singleton)
    - `rate_limiter_state` (token bucket persistence)

    Export all tables from `packages/api/usda-food/src/db/schema/index.ts`.

    **Acceptance**:
    - `drizzle-kit generate` produces valid SQL migration with no errors
    - All column types match plan.md §2 and spec.md FR-028 exactly

---

## Phase 1 — Database Schema (US-001 foundation)

- [ ] **T-005** [P1] [US-001] Migration: `foods` Table — `—`
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
    - Migration runs cleanly on a fresh PostgreSQL 16 instance
    - `fetch_status` check constraint rejects invalid values

---

- [ ] **T-006** [P1] [US-005] Migration: `fetch_queue` Table — `—`
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

- [ ] **T-007** [P1] [US-001] Migration: Supporting Tables — `—`
      **Story**: US-001 / US-005
      **Priority**: P1
      **Depends on**: T-005, T-006
      **Implements**: FR-019, FR-028

    Write and apply migrations for:
    - `usda_sync_metadata` (singleton row, `id INT PRIMARY KEY DEFAULT 1`, `last_full_sync_at`, `last_incremental_at`, `foundation_version`, `sr_legacy_version`, `branded_version`)
    - `rate_limiter_state` (`id INT PRIMARY KEY DEFAULT 1`, `available_tokens INT`, `last_refill_at TIMESTAMPTZ`, `capacity INT DEFAULT 1000`)

    **Acceptance**:
    - `usda_sync_metadata` has a default row with `id = 1`
    - `rate_limiter_state` defaults to `available_tokens = 1000`

---

- [ ] **T-008** [P1] [US-001] Migration: Indexes — `—`
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

- [ ] **T-009** [P1] [US-004] Migration: `ingredients` Table Extensions — `—`
      **Story**: US-004
      **Priority**: P1
      **Depends on**: T-005
      **Implements**: FR-001 (downstream integration)

    Apply `ALTER TABLE ingredients` from plan.md §7:
    - `usda_fdc_id INT REFERENCES foods(fdc_id)` (nullable FK)
    - `fetch_status TEXT DEFAULT 'unlinked'`
    - `fiber_g_per_100g DECIMAL`
    - `sodium_mg_per_100g DECIMAL`
    - `serving_size_g DECIMAL`
    - `serving_description TEXT`
    - `brand_owner TEXT`
    - `last_synced_at TIMESTAMP`

    **Acceptance**:
    - Migration is idempotent (`IF NOT EXISTS` guards)
    - FK constraint enforced; `NULL` allowed

---

## Phase 2 — REST API Layer (US-001, US-002, US-006, US-008)

- [ ] **T-010** [P1] [US-001] NestJS Module: `FoodsModule` — `packages/api/usda-food/src/foods/foods.module.ts`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-005, T-006, T-007, T-008
      **Implements**: FR-001

    Scaffold `packages/api/usda-food/src/foods/foods.module.ts` with:
    - `FoodsController` (routes)
    - `FoodsService` (business logic)
    - `FoodsRepository` (Drizzle queries)
    - Import `UsdaApiModule`, `EventBridgeModule`

    **Acceptance**:
    - Module bootstraps without errors in NestJS app
    - All providers injectable via DI

---

- [ ] **T-011** [P1] [US-001] `GET /v1/foods/{fdcId}` — Cache Hit & Tombstone Path — `—`
      **Story**: US-001
      **Priority**: P1
      **Depends on**: T-010
      **Implements**: FR-001, FR-002, FR-005, FR-006

    Implement the synchronous lookup path:
    1. Validate `fdcId` is a positive integer (400 on invalid)
    2. Check PostgreSQL `foods` table:
        - `fetch_status = 'fetched'` → return 200 with full food data
        - `fetch_status = 'not_found'` → return 404 with tombstone message (no queuing)
    3. Response shape per plan.md §3

    **Acceptance**:
    - Cache hit returns 200 within 50ms (US-001 scenario 1)
    - Tombstoned food returns 404 without queuing (US-001 scenario 4)
    - Invalid `fdcId` returns 400 (FR-006)

---

- [ ] **T-012** [P1] [US-002] `GET /v1/foods/{fdcId}` — Cache Miss / Enqueue Path — `—`
      **Story**: US-002
      **Priority**: P1
      **Depends on**: T-011, T-016
      **Implements**: FR-003, FR-004, FR-011, FR-013, FR-014, FR-017

    Extend the lookup handler for async backfill:
    1. Food not in local store → execute idempotent enqueue:
        ```sql
        INSERT INTO fetch_queue (fdc_id) VALUES ($1)
        ON CONFLICT (fdc_id) DO UPDATE
        SET request_count = fetch_queue.request_count + 1,
            last_requested = now()
        WHERE fetch_queue.status = 'pending';
        ```
    2. Pair with `pg_notify('fetch_queued', fdc_id)`
    3. Return `202 Accepted` with `{ status: "pending", fdcId, estimatedWaitSeconds: 30 }`
    4. Duplicate requests increment `request_count` (US-005 scenario 3)

    **Acceptance**:
    - First request returns 202 within 100ms (US-002 scenario 1)
    - Second request increments `request_count`, returns 202 without duplicate row (US-005 scenario 3)
    - `pg_notify` fires on every enqueue

---

- [ ] **T-013** [P2] [US-008] `GET /v1/foods/{fdcId}/status` — `—`
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

- [ ] **T-014** [P2] [US-006] `GET /v1/foods/search?query=` & Autocomplete — `—`
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

- [ ] **T-015** [P2] [US-001] `GET /v1/foods/{fdcId}/nutrients` — `—`
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

- [ ] **T-016** [P1] [US-002] Enqueue Service (`FetchQueueService`) — `packages/api/usda-food/src/foods/fetch-queue.service.ts`
      **Story**: US-002 / US-005
      **Priority**: P1
      **Depends on**: T-006
      **Implements**: FR-014, FR-017

    Create `packages/api/usda-food/src/foods/fetch-queue.service.ts`:
    - `enqueue(fdcId: string, source: 'single' | 'batch'): Promise<void>`
    - Executes `INSERT … ON CONFLICT DO UPDATE` per FR-014
    - Emits `pg_notify('fetch_queued', fdc_id)` after successful insert
    - Used by API handlers (T-012, T-027) and stale refresh (T-031)

    **Acceptance**:
    - Concurrent enqueues for same `fdcId` produce exactly one row with incremented counter
    - `pg_notify` payload contains the `fdc_id`

---

- [ ] **T-017** [P1] [US-005] Fargate Worker Scaffold (`food-fetch-worker`) — `packages/services/usda-food-data/src/worker/`
      **Story**: US-005
      **Priority**: P1
      **Depends on**: T-001, T-003
      **Implements**: FR-017, FR-018, FR-022

    Create `packages/services/usda-food-data/src/worker/`:
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
    2. Check token bucket (`consume(1)`)
    3. Call `UsdaApiClient.getFood(fdcId)`
    4. On 200: upsert `foods` with `fetch_status='fetched'`, update `fetch_queue` `status='done'`, `fetched_at=now()`
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
    2. Consume exactly 1 token from bucket
    3. Call `UsdaApiClient.getFoodsBatch(fdcIds)` (POST `/v1/foods`)
    4. For each result: upsert `fetch_status='fetched'`, mark `fetch_queue.status='done'`
    5. For each 404 in batch response: write tombstone
    6. On partial 5xx: successful items marked `done`, failed items returned to `pending` with `attempts++`

    **Acceptance**:
    - 5 IDs in batch → 1 token consumed (US-004 scenario 3)
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
    - 404 → immediate `status='tombstone'`, `last_error='404'`, no retry
    - 429 → reset token bucket to 0, return row to `pending` with `attempts++`, backoff `2^attempts` seconds
    - 5xx / timeout → return to `pending`, `attempts++`, backoff `2^attempts` seconds
    - After 5 attempts → `status='tombstone'`, `last_error='max_retries'`
    - Tombstone rows queryable by ops for audit

    **Acceptance**:
    - 5xx row cycles `pending → in_flight → pending` with exponential backoff, lands in tombstone after 5 attempts (US-005 scenario 5)
    - 404 immediate tombstone (US-002 scenario 5)

---

- [ ] **T-023** [P2] [US-006] Food Search Indexer (EventBridge) — `packages/services/usda-food-data/src/lambdas/food-search-indexer/handler.ts`
      **Story**: US-006
      **Priority**: P2
      **Depends on**: T-019
      **Implements**: FR-008

    Create `packages/services/usda-food-data/src/lambdas/food-search-indexer/handler.ts`:
    - Triggered by `FoodFetchCompleted` EventBridge event (emitted by worker on successful fetch)
    - Updates `foods.search_vector`: `to_tsvector('english', description)`
    - Invalidates any in-process LRU cache

    **Acceptance**:
    - After fetch, `search_vector` is populated and food appears in search results
    - No Redis cache to invalidate (architecture uses PostgreSQL directly)

---

## Phase 4 — Token Bucket Rate Limiter (US-003)

- [ ] **T-024** [P1] [US-003] Token Bucket: In-Process Implementation — `packages/services/usda-food-data/src/usda/token-bucket.ts`
      **Story**: US-003
      **Priority**: P1
      **Depends on**: T-007
      **Implements**: FR-019, FR-020

    Create `packages/services/usda-food-data/src/usda/token-bucket.ts`:
    - `TokenBucket` class: `consume(n: number): boolean`, `reset(): void`, `available(): number`
    - Capacity: 1,000 tokens; refill: 16.67/min (1 per 3.6s)
    - In-process state (single Fargate worker = no shared state needed at MVP)
    - Thread-safe within the Node.js event loop

    **Acceptance**:
    - `consume(1)` with 3 tokens remaining → returns `true`, leaves 2 (US-003 scenario 1)
    - Refill adds ~16–17 tokens per minute up to 1,000 cap (US-003 scenario 3)
    - `consume(1)` with 0 tokens → returns `false`, worker sleeps (US-003 scenario 2)

---

- [ ] **T-025** [P2] [US-003] Token Bucket: Postgres Persistence (Future-Proofing) — `—`
      **Story**: US-003
      **Priority**: P2
      **Depends on**: T-024
      **Implements**: FR-020

    Create `PostgresTokenBucket` implementation using `rate_limiter_state` row:
    - Atomic check-and-consume via `UPDATE rate_limiter_state SET available_tokens = available_tokens - n WHERE available_tokens >= n RETURNING available_tokens`
    - Refill logic: calculate tokens earned since `last_refill_at`
    - Falls back to in-process if Postgres row unavailable

    **Acceptance**:
    - Concurrent consume calls are atomic (no race condition)
    - Refill adds correct token count based on elapsed time

---

- [ ] **T-026** [P1] [US-003] Token Bucket: Unit Tests — `—`
      **Story**: US-003
      **Priority**: P1
      **Depends on**: T-024, T-025
      **Implements**: FR-019, FR-020

    Write unit tests for `TokenBucket` and `PostgresTokenBucket`:
    - Consume with sufficient tokens
    - Consume with 0 tokens (returns false / sleeps)
    - Refill rate (mock time)
    - Concurrent consume (mock DB for atomicity)
    - Reset to 0 (USDA 429 scenario)
    - Boundary: 1,000 cap

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
    - Single `POST /v1/foods` call consumes 1 token for up to 20 items

    **Acceptance**:
    - Batch of 20 IDs → 1 USDA API call, 1 token consumed
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

- [ ] **T-030** [P2] [US-007] Stale Refresh Scheduler (EventBridge) — `packages/services/usda-food-data/src/lambdas/usda-stale-refresh/handler.ts`
      **Story**: US-007
      **Priority**: P2
      **Depends on**: T-001
      **Implements**: FR-031

    Create `packages/services/usda-food-data/src/lambdas/usda-stale-refresh/handler.ts`:
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

- [ ] **T-032** [P2] [US-007] Bulk Sync Lambda (Weekly Foundation/SR Legacy) — `packages/services/usda-food-data/src/lambdas/usda-bulk-sync/handler.ts`
      **Story**: US-007 (bulk variant)
      **Priority**: P2
      **Depends on**: T-005, T-007
      **Implements**: FR-031

    Create `packages/services/usda-food-data/src/lambdas/usda-bulk-sync/handler.ts`:
    - EventBridge scheduled: Sunday 2am UTC
    - Downloads Foundation + SR Legacy bulk files from USDA
    - Upserts into `foods` table (batch inserts, 1,000 rows/batch)
    - Updates `usda_sync_metadata` with version and timestamp

    **Acceptance**:
    - Lambda completes without timeout for a 10,000-row test dataset
    - `usda_sync_metadata` updated after successful run

---

## Phase 7 — Auth Integration (FR-035)

- [ ] **T-033** [P1] [FR-035] Lambda Authorizer Integration — `—`
      **Story**: FR-035
      **Priority**: P1
      **Depends on**: T-010
      **Implements**: FR-035

    Wire the shared Clerk auth middleware from feature 002 to all `/v1/foods/*` routes:
    - All 6 endpoints require a valid Clerk session token
    - Verification is networkless: `verifyToken` from `@clerk/backend` using the public `CLERK_JWT_KEY`, with authorized parties enforced via `CLERK_AUTHORIZED_PARTIES` (`azp`)

    **Acceptance**:
    - Unauthenticated request to any `/v1/foods/*` endpoint returns 401
    - Valid Clerk session token returns expected response

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
    - `usda-token-bucket-available` — after each consume
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
    - Token bucket available tokens
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

    Create API Gateway WebSocket API:
    - `$connect` / `$disconnect` routes
    - Store connection IDs in DynamoDB (`usda_ws_connections`)
    - Associate `fdcId` subscriptions with connection IDs

    **Acceptance**:
    - Client can establish WebSocket connection with valid Clerk session token
    - Connection ID stored in DynamoDB on connect, removed on disconnect

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
    - Verify 1 token consumed for the batch

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

## FR Coverage Audit

| FR     | Covered By          | Status                    |
| ------ | ------------------- | ------------------------- |
| FR-001 | T-010, T-011        | ✅                        |
| FR-002 | T-011, T-015        | ✅                        |
| FR-003 | T-012               | ✅                        |
| FR-004 | T-012               | ✅                        |
| FR-005 | T-011               | ✅                        |
| FR-006 | T-011               | ✅                        |
| FR-007 | T-013               | ✅                        |
| FR-008 | T-014, T-023        | ✅                        |
| FR-009 | T-014               | ✅                        |
| FR-010 | T-014               | ✅                        |
| FR-011 | T-012               | ✅                        |
| FR-012 | T-027, T-028        | ✅                        |
| FR-013 | T-012, T-028        | ✅                        |
| FR-014 | T-016               | ✅                        |
| FR-015 | T-018, T-029        | ✅                        |
| FR-016 | T-022, T-037        | ✅                        |
| FR-017 | T-016, T-017, T-018 | ✅                        |
| FR-018 | T-017, T-021, T-024 | ✅                        |
| FR-019 | T-002, T-024        | ✅                        |
| FR-020 | T-024, T-025        | ✅                        |
| FR-021 | T-024               | ✅                        |
| FR-022 | T-017               | ✅                        |
| FR-023 | T-003, T-019, T-020 | ✅                        |
| FR-024 | T-019, T-020        | ✅                        |
| FR-025 | T-019, T-022        | ✅                        |
| FR-026 | T-022               | ✅                        |
| FR-027 | T-022               | ✅                        |
| FR-028 | T-004, T-005        | ✅                        |
| FR-029 | T-005, T-008        | ✅                        |
| FR-030 | T-045               | ✅ (in-process, no Redis) |
| FR-031 | T-030, T-032        | ✅                        |
| FR-032 | T-031               | ✅                        |
| FR-033 | T-013               | ✅                        |
| FR-034 | T-038, T-039        | ✅ (deferred)             |
| FR-035 | T-033               | ✅                        |

**Gap**: None. All 35 FRs trace to at least one task. FR-030 maps to T-045 (in-process LRU) because the new architecture explicitly removes Redis; the functional intent (cache acceleration) is preserved without ElastiCache infrastructure.
