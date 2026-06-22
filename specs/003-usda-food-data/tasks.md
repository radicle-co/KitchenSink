# Tasks: Feature 003 — Source-Agnostic Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate fan-out/merge worker + per-source rolling 60-min window limiter)
**Updated**: 2026-06-22 — **re-baselined to the source-agnostic food data model**
**Source Artifacts**: plan.md (re-baselined), spec.md (re-baselined), product-spec.md
**Design Reference**: plan.md §2 (12 canonical tables), §2A (auth), §3 (API contracts), §4 (queue/limiter), §5 (fan-out + merge), §9 (deferred decisions)

---

> ## Re-baseline note (2026-06-22)
>
> This task list was **regenerated to the source-agnostic food data model**, superseding the
> USDA-coupled Phase 1–2 design. A food is now keyed by an internal surrogate `id` (ULID-valued,
> named `id`); USDA is **one pluggable source adapter** among many; foods are assembled into a
> **cross-source golden record** with per-field provenance; users add foods **by name** through a
> `PENDING → (UNRESOLVED) → RESOLVED` lifecycle (terminal `NOT_FOUND` / `FAILED`). `fdcId` /
> `fetch_status` / denormalized-nutrient columns are removed from the canonical model and confined
> to the USDA adapter boundary (`fdcId → external_key` inbound).
>
> **What carries over vs. what is rebuilt (Phase 0–2 of the OLD design was built + merged):**
>
> | Area                                                                      | Disposition                                                                  |
> | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
> | `@kitchensink/food-service` NestJS package + its own CDK                  | **REUSE** — `[x]`                                                            |
> | `kitchensink_food` logical DB on the shared global DataStack              | **REUSE** — `[x]`                                                            |
> | Shared-ALB host rule (priority 200), Zod env config scaffold              | **REUSE** (env vars renamed source-agnostic)                                 |
> | LocalStack + Docker-Postgres E2E harness                                  | **REUSE / extend**                                                           |
> | `@kitchensink/usda-client` (typed USDA HTTP client + zod wire validation) | **REUSE** as the first adapter; **NEW** task wraps it in `FoodSourceAdapter` |
> | Auth: in-process `AuthMiddleware` + shared `ClerkAuthService`             | **REUSE / wire** (mostly wiring, not from-scratch)                           |
> | OLD DB schema (`foods` + `fdcId` PK + denormalized nutrient cols)         | **REBUILD** → the 12 normalized tables                                       |
> | OLD REST API (`/v1/foods/{fdcId}` read/batch, denormalized DTOs)          | **REBUILD** → add-by-name + id-read + candidates + PATCH-resolve + search    |
> | OLD DAO/repository layer                                                  | **REBUILD** → per-aggregate DAOs over the new schema                         |
> | OLD worker (single-source fetch)                                          | **REBUILD** → fan-out + merge                                                |
>
> This is a **clean replacement — no data to migrate** (A-014). Old `fdcId`-keyed tasks are
> **removed/replaced**, not left in place. Where an old task's artifact is reused with light change,
> it is marked `[x]` with an explicit `(reuse: …)` note.

---

## Legend

```
- [ ] T-NNN [size S/M/L] [Test-first: true|false] description (FR-refs)
```

- `[x]` = already built + merged (Phase 0–2 of the old design) and reusable as-is or with the noted change.
- `[size]` — S ≤ ~½ day, M ≈ 1–2 days, L ≈ 3+ days.
- `[Test-first: true]` — TDD red-gate task: write the failing test first (schema constraints, DAO behavior,
  merge rules, dedup/lock, lifecycle status codes, rate limiter, auth `401`/`403`, demotion fairness).
- **FR-refs** use the re-baselined spec FR ids, including the grouped ids `FR-IDN-*` (identity/naming),
  `FR-RES-*` (candidates/resolution), `FR-MRG-*` (fan-out/merge), `FR-ADP-*` (adapters/input-safety),
  and `FR-035..FR-053` (auth).
- **All path params are the internal food `id` (ULID), never a source key.**

---

## Package Layout & Database (locked 2026-06-19; re-baselined 2026-06-21)

| Package                            | Path                             | Role                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kitchensink/food-service`        | `packages/services/food-service` | Deployable NestJS service on ECS/Fargate behind the shared per-stage ALB (host rule, priority 200). Canonical Drizzle schema/DAOs, `/v1/foods/*` API, in-process `FoodAuthGuard`, source-adapter interface + fan-out/merge worker, own CDK. **Built (old design); schema/API/worker rebuilt under this plan.** |
| `@kitchensink/usda-client`         | `packages/clients/usda`          | The **USDA source adapter** — typed wrapper over USDA FoodData Central. The **only** place `fdcId` / USDA terms appear; maps `fdcId → external_key` inbound. **Built + zod-validated; wrapped in `FoodSourceAdapter` as a new task.**                                                                          |
| `@kitchensink/food-service-client` | `packages/clients/food-service`  | Typed client for **our** `/v1/foods/*` API (web/mobile + 001/006/007/009 M2M callers). Exposes only canonical `id`-keyed shapes. **Placeholder built; surface rebuilt to the new API.**                                                                                                                        |
| `@kitchensink/clerk-verify`        | `packages/shared/clerk-verify`   | Shared networkless Clerk verification (`verifyToken` + `azp`), extracted from the identity service.                                                                                                                                                                                                            |

**Database (no new RDS, no cluster):** the food tables live in the **separate logical database
`kitchensink_food`** on the existing shared instance `kitchensink-data-{stage}` (db.t4g.small, global
DataStack). `pg_trgm` is already bootstrapped on the instance (FR-008 fuzzy search). Migrations run via the
**in-VPC migration-runner Lambda (FU-MIGRATE)**; phases build/test against **Docker Postgres** until that
runner is wired.

**Canonical table set (12):** `food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`,
`food_field_provenance`, `food_category`, `food_category_assignment`, `fetch_queue`, `fetch_requesters`,
`source_call_log`, `source_sync_metadata`. **Removed** from the old design: `foods` (denormalized),
`usda_sync_metadata`, `usda_call_log`, `rate_limiter_state`, `user_fetch_quota`, `global_fetch_quota`, and
all denormalized-nutrient / `raw_json` / `fetch_status` columns.

---

## User Story Reference

| US    | Name                                | Priority | FRs                                              |
| ----- | ----------------------------------- | -------- | ------------------------------------------------ |
| US-0  | Authenticated & Authorized Access   | P1       | FR-035–FR-053                                    |
| US-1  | Single Food Read (Resolved Hit)     | P1       | FR-001, FR-002, FR-004, FR-IDN-1                 |
| US-2  | Add Food By Name (async resolution) | P1       | FR-005, FR-006, FR-011, FR-013, FR-MRG-1, FR-025 |
| US-2a | Disambiguate Candidates and Resolve | P1       | FR-RES-1, FR-RES-2, FR-RES-3                     |
| US-3  | Rate-Limited Source Consumption     | P1       | FR-018, FR-019, FR-020, FR-021, FR-022, FR-026   |
| US-4  | Bulk Ingredient Resolution          | P1       | FR-012, FR-023, FR-045                           |
| US-5  | Demand-Weighted Priority + Recovery | P1       | FR-014, FR-015, FR-016, FR-017, FR-018, FR-027   |
| US-6  | Food Search by Name                 | P2       | FR-008, FR-009, FR-010                           |
| US-7  | Change-Driven Data Refresh          | P2       | FR-031, FR-032                                   |
| US-8  | Resolution Status Polling           | P2       | FR-007, FR-033                                   |
| US-9  | WebSocket Real-Time Notifications   | P3       | FR-034, FR-041, FR-049                           |
| US-10 | Monitoring and Observability        | P3       | FR-016, FR-018, SC-002, SC-006                   |

---

## Dependency Graph

```
PACKAGES + WORKSPACE (T-060 ✓) ─► FOOD-SERVICE CDK (T-001 ✓) ─► GLOBAL DB kitchensink_food (T-001b ✓)
  └─► ENV CONFIG source-agnostic (T-002) · usda-client (T-003 ✓)
        └─► PHASE 1: 12-TABLE SCHEMA + MIGRATIONS + DAOs (T-100..T-110)
              ├─► PHASE 2: FoodSourceAdapter iface + USDA adapter wrap (T-120..T-122)
              ├─► PHASE 8: AUTH WIRING (T-046 ✓dep, T-033, T-047..T-056)  [US-0]
              │     └─► gates ▼
              ├─► PHASE 3: READ API  GET /{id} · /status · /candidates · /search (T-130..T-134)
              │     └─► PHASE 4: CREATE/RESOLVE API  POST /v1/foods · PATCH /{id} · /batch (T-140..T-145)
              │           └─► PHASE 5: QUEUE + FARGATE FAN-OUT WORKER + LIMITER (T-150..T-159)
              │                 └─► PHASE 6: MERGE ENGINE + GOLDEN RECORD + PROVENANCE (T-160..T-165)
              │                       └─► PHASE 7: CHANGE-DRIVEN REFRESH + UNRESOLVED TTL (T-170..T-172)
              └─► PHASE 9: SEARCH-INDEXER / OBSERVABILITY / WS (T-180..T-187)  [P2/P3 deferred bits]

PHASE 10: E2E HARNESS (T-190 ✓foundation) + MIGRATION-RUNNER FU-MIGRATE (T-191)
PHASE 11: PERF/LOAD (T-195) [SC-001/003/004/007] · MULTI-AZ UPGRADE (T-196) [deferred, SC-009]
```

---

## Phase 0 — Setup & Infrastructure (mostly DONE — old design, reused)

- [x] **T-060** [S] [Test-first: false] Register the four packages in the root `package.json` workspaces — `package.json` (NFR-006)
      **(reuse: built in old Phase 0 — `packages/clients/usda` + `packages/clients/food-service` added as explicit paths; `services/*`/`shared/*` globs cover the rest. No change needed.)**

- [x] **T-001** [M] [Test-first: false] `FoodServiceStack` CDK (ECS/Fargate, shared-ALB host rule priority 200, fan-out worker, scheduled-producer EventBridge — no SQS, no per-service ALB, no new RDS) — `packages/services/food-service/infra/lib/food-service-stack.ts` (ARCH-001, FR-005..FR-035 deploy surface)
      **(reuse: built + synth-verified in old Phase 0. Worker/lambda handlers are skeletons fleshed out in Phases 5–7/9. EventBridge demand-rule already correctly absent — demand path is the Postgres `fetch_queue`. No structural change required for the re-baseline.)**

- [x] **T-001b** [S] [Test-first: false] Global DataStack: `kitchensink_food` logical DB + least-privilege role/secret on the shared instance (exports `FoodDbSecretArn`/`FoodDatabaseName`; reuse bootstrapped `pg_trgm`) — `packages/infra/global/lib/platform/data-stack.ts` (ARCH-001)
      **(reuse: built in old Phase 0 — no new RDS/cluster. Unchanged by the re-baseline.)**

- [x] **T-003** [M] [Test-first: true] `@kitchensink/usda-client` — typed USDA HTTP client + zod validation of the USDA wire shape (`getFood`/`getFoodsBatch`/`searchFoods`, error types incl. `UsdaSchemaError`, ≤20-id batch) — `packages/clients/usda/src/usda-api.client.ts` (FR-023, FR-ADP-3)
      **(reuse: built TDD, 12/12 tests green, validates the raw USDA wire shape at the boundary. The client itself is DONE — it is wrapped in the `FoodSourceAdapter` interface by the NEW T-120/T-121.)**

- [ ] **T-002** [S] [Test-first: false] Source-agnostic env config (Zod) — rename USDA-coupled vars to the source-neutral set — `packages/services/food-service/src/config/` (FR-019, FR-025, FR-032, FR-042)
      Adjust the existing Zod env schema (built in old Phase 0) to the re-baselined config: - `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` (non-secret; FR-042). - `FOOD_DEMOTE_THRESHOLD` (default 50; FR-043), `FOOD_MAX_QUEUE_DEPTH` (default 10000; FR-046),
      `FOOD_MAX_BATCH_NAMES` (default 100; FR-045), `FOOD_LEASE_TIMEOUT_SECONDS` (default 30; FR-018),
      `FOOD_NOT_FOUND_TTL_DAYS` (default 30; FR-025), `FOOD_UNRESOLVED_TTL_DAYS` (default 30; §9-2),
      `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` (default 0.10; §9-1 auto-resolve rule). - **Per-source** config block keyed by `source` (USDA today): `USDA_API_KEY` (secret), `USDA_API_BASE_URL`,
      `USDA_RATE_LIMIT_PER_HOUR` (default 1000; rolling-60-min cap, pause at 90%). - The old single-source `USDA_STALE_THRESHOLD_DAYS` is **removed** (refresh is change-driven, not age-based).
      **Acceptance**: missing `USDA_API_KEY` or `CLERK_JWT_KEY` throws a descriptive Zod error at startup; all
      vars reachable via `ConfigService` in both the NestJS API and the Fargate worker.

---

## Phase 1 — Canonical Schema (12 tables) + Migrations + DAOs

> **REBUILD.** Replaces the old `foods`/`usda_*` schema entirely. Build/test on Docker Postgres until
> FU-MIGRATE (T-191) wires the in-VPC runner. The old T-004..T-009 (`foods` denormalized table, `fdcId` PK,
> `usda_sync_metadata`, `usda_call_log`, `ingredients` FK) are **removed/replaced** by the tasks below.

- [ ] **T-100** [M] [Test-first: true] Drizzle schema — canonical core (`food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`, `food_field_provenance`, `food_category`, `food_category_assignment`) + enums (`food_status`, `food_kind`, `food_source`, `food_field`, `nutrient_basis`) — `packages/services/food-service/src/db/schema/food.ts` (FR-028, FR-IDN-1, FR-IDN-3)
      ULID `text('id')` PKs via a `newFoodId()` helper (reusing `ulidx`, mirroring identity's `newUserId`);
      `pgEnum` enums; `timestamp(col, { withTimezone: true })`; `numeric` for nutrient amounts/gram weights
      (SC-008 fidelity). `food_sources.external_key` (mapped from `fdcId`), `item_version` for refresh
      (FR-032). No `raw_json`, no `fetch_status`, no denormalized nutrient columns.
      **Acceptance**: `drizzle-kit generate` emits valid SQL; column types/enums match plan.md §2 exactly;
      a schema test asserts no source-native identifier column (no `fdc_id`) exists on any canonical table (SC-013).

- [ ] **T-101** [S] [Test-first: true] Drizzle schema — operational tables (`fetch_queue` keyed on food `id` PK, `fetch_requesters`, `source_call_log` per-source, `source_sync_metadata` per-source) — `packages/services/food-service/src/db/schema/operational.ts` (FR-014, FR-019, FR-043, FR-044, FR-IDN-3)
      `fetch_queue.food_id text PRIMARY KEY REFERENCES food(id)`; `status CHECK IN ('pending','in_flight','tombstone')`;
      `fetch_requesters(food_id, sub, requested_at)` PK `(food_id, sub)`; `source_call_log(id bigserial, source, called_at)`;
      `source_sync_metadata(source PRIMARY KEY, last_full_sync_at, last_incremental_at, source_version)`.
      **Acceptance**: tables generate cleanly; the `fetch_queue` status CHECK rejects invalid values;
      `source_call_log` starts empty and the trailing-60-min count query returns 0 on a fresh DB.

- [ ] **T-102** [M] [Test-first: true] Migration: canonical core tables + constraints — `—` (FR-028, FR-IDN-1)
      Ordered SQL creating the 8 canonical tables with their FKs (`ON DELETE CASCADE` to `food`), the
      `food_normalized_name_unique` UNIQUE index (FR-005/FR-013 dedup), and `food_sources_source_key_unique
UNIQUE(source, external_key)` (R4).
      **Acceptance**: migration runs cleanly on `kitchensink_food` (Docker Postgres); inserting two foods with the
      same `normalized_name` violates the unique constraint; inserting two `food_sources` with the same
      `(source, external_key)` is rejected.

- [ ] **T-103** [S] [Test-first: true] Migration: operational tables — `—` (FR-014, FR-019, FR-043)
      Ordered SQL for `fetch_queue`, `fetch_requesters`, `source_call_log`, `source_sync_metadata`. Includes
      **user-erasure handling**: on a user-deletion event, `fetch_requesters` rows for that `sub` are deleted
      (closes the constitution data-privacy warning). **No `user_fetch_quota`/`global_fetch_quota` tables.**
      **Acceptance**: `ON CONFLICT (food_id) DO UPDATE` on `fetch_queue` works atomically; `fetch_requesters`
      dedups on `(food_id, sub)`.

- [ ] **T-104** [S] [Test-first: true] Migration: indexes (search + lifecycle + queue + limiter) — `—` (FR-008, FR-010, FR-015, FR-019, FR-029)
      Apply: `food_status_idx`; `food_barcode_idx WHERE barcode IS NOT NULL`; GIN trigram
      `food_name_trgm_idx` / `food_description_trgm_idx` (`gin_trgm_ops`); `food_sources_food_id_idx`;
      `food_nutrients_food_id_idx`; `food_nutrients_source_id_idx`; the **demand-weighted partial**
      `idx_fetch_queue_priority ON fetch_queue (request_count DESC, first_requested ASC) WHERE status='pending'`;
      `idx_fetch_requesters_sub`; `idx_source_call_log_source_called_at` (windowed count + prune). `CREATE
EXTENSION IF NOT EXISTS pg_trgm`.
      **Acceptance**: `EXPLAIN ANALYZE` shows GIN index scan on trigram name search, index-only scan on the
      pending-priority partial index, and an index scan for the trailing-60-min `source_call_log` count.

- [ ] **T-105** [M] [Test-first: true] DAO: `FoodDao` (golden-record aggregate read/upsert; normalized-name dedup; status transitions; tombstone TTL fields) — `packages/services/food-service/src/foods/dao/food.dao.ts` (FR-002, FR-005, FR-013, FR-028, FR-IDN-1)
      Per-aggregate DAO behind the existing `FoodsRepository` seam. `getById`, `createByName` (compute
      `normalized_name`, insert with `status='PENDING'`), `setStatus`, `upsertGoldenScalars`, `readGoldenRecord`
      (joins nutrients/portions/provenance). No source term leaks (FR-ADP-1).
      **Acceptance**: `createByName` is idempotent on normalized name (returns the existing `id` on a second add);
      `readGoldenRecord` returns `id`/name/description/nutrients/portions/provenance with no `fdcId` anywhere.

- [ ] **T-106** [S] [Test-first: true] DAO: `FoodSourcesDao` (crosswalk upsert; `external_key` + `item_version`; barcode/external-key lookup → `id`) — `packages/services/food-service/src/foods/dao/food-sources.dao.ts` (FR-008, FR-028, FR-029, FR-032)
      **Acceptance**: `findFoodIdByExternalKey(source, key)` resolves via `UNIQUE(source, external_key)`;
      `upsertSource` records/updates `item_version`.

- [ ] **T-107** [S] [Test-first: true] DAO: `NutrientDao` + `FoodNutrientsDao` (dictionary upsert by `external_code`; per-value `source_id`; `UNIQUE(food_id, nutrient_id)` golden winner; per-100g basis) — `packages/services/food-service/src/foods/dao/nutrient.dao.ts`, `food-nutrients.dao.ts` (FR-028, FR-MRG-3, SC-008)
      **Acceptance**: nutrient amounts stored as `numeric` (no float drift); a second value for the same
      `(food_id, nutrient_id)` overwrites the golden winner and updates `source_id`.

- [ ] **T-108** [S] [Test-first: true] DAO: `FoodPortionsDao`, `FoodFieldProvenanceDao`, `FoodCategoryDao` (per-value `source_id`; single-query "which fields came from source X") — `packages/services/food-service/src/foods/dao/` (FR-028, FR-029, R7)
      **Acceptance**: a UNION query across `food_field_provenance` + `food_nutrients` + `food_portions` filtered by
      `source_id IN (food_sources of food X, source S)` returns the provenance set in one query (FR-029/SC-013).

- [ ] **T-109** [M] [Test-first: true] DAO: `FetchQueueDao` + `FetchRequestersDao` (idempotent `INSERT … ON CONFLICT`; distinct-requester demand; `SELECT … FOR UPDATE SKIP LOCKED` drain; lease watchdog; per-`sub` live pending count) — `packages/services/food-service/src/foods/dao/fetch-queue.dao.ts`, `fetch-requesters.dao.ts` (FR-014, FR-015, FR-018, FR-043, FR-044)
      **Acceptance**: concurrent enqueues for one `id` produce exactly one row with the demand counter computed
      from distinct `sub`s; the drain query orders by `request_count DESC, first_requested ASC`; the watchdog
      reverts `in_flight` rows older than the lease timeout to `pending`.

- [ ] **T-110** [S] [Test-first: true] DAO: `SourceCallLogDao` (atomic check-and-record for the per-source rolling 60-min window; prune) — `packages/services/food-service/src/foods/dao/source-call-log.dao.ts` (FR-019, FR-020)
      Single-statement atomic `INSERT … SELECT now() WHERE (SELECT count(*) FROM source_call_log WHERE source=$1
AND called_at > now()-interval '60 minutes') < $cap RETURNING id` (permits the call only under cap) +
      a prune of rows older than 60 min.
      **Acceptance**: concurrent check-and-record never lets the trailing count exceed the cap (no race);
      the trailing-60-min count slides as old rows age out.

---

## Phase 2 — Source Adapter Interface + USDA Adapter Wrap

> **NEW.** The `usda-client` (T-003) is done; this phase introduces the `FoodSourceAdapter` boundary and
> wraps the client so the worker fans out over a registry. USDA is the only wired adapter; the loop is over a
> registry so adding a source is additive (FR-MRG-4/FR-ADP-1).

- [ ] **T-120** [M] [Test-first: true] `FoodSourceAdapter` interface + adapter registry + canonical candidate types (`SourceCandidate`, `CanonicalCandidate`) + source-priority config (`['usda']`) — `packages/services/food-service/src/sources/food-source-adapter.ts` (FR-ADP-1, FR-MRG-2, FR-MRG-4)
      `interface FoodSourceAdapter { readonly source; searchByName(name): Promise<SourceCandidate[]>;
fetchByKey(externalKey): Promise<CanonicalCandidate>; }`. A static config-ordered priority list (USDA
      highest) per §9-5. No source-specific structure may appear in these types.
      **Acceptance**: a type-level test asserts the canonical candidate carries `source` + `externalKey` (never
      `fdcId`); the registry resolves the USDA adapter by `source='usda'`.

- [ ] **T-121** [M] [Test-first: true] USDA adapter — wrap `@kitchensink/usda-client` to implement `FoodSourceAdapter`: `searchByName` (USDA `searchFoods`), `fetchByKey` (`getFood`, `fdcId → external_key`), `mapToCanonical` (USDA nutrients→`food_nutrients` per-100g, portions→`food_portions`, validate/sanitize) — `packages/clients/usda` consumer in `packages/services/food-service/src/sources/usda/usda.adapter.ts` (FR-IDN-2, FR-023, FR-024, FR-ADP-2, FR-ADP-3)
      The **only** place `fdcId` and USDA terms appear. Validates/sanitizes mapped values (type/range/length/text)
      before they enter the store; a response failing validation is rejected, not stored. MAY use the ≤20-key
      USDA batch (counts as 1 windowed call) once it has resolved which items to fetch (adapter-internal).
      **Acceptance**: `fetchByKey` returns a `CanonicalCandidate` with `external_key` (mapped from `fdcId`),
      per-100g nutrients, and `item_version`; an out-of-range/over-length value is rejected before mapping; the
      public return type exposes no `fdcId`.

- [ ] **T-122** [S] [Test-first: true] Per-source rolling-window limiter (`RollingWindowLimiter` over `SourceCallLogDao`; pause at 90%; `429`-failsafe treats the window as full) — `packages/services/food-service/src/sources/rolling-window-limiter.ts` (FR-019, FR-020, FR-021, FR-026)
      `tryRecord(source)`, `count(source)`, `isPaused(source)` (true once the trailing count ≥ 90% of that
      source's cap). USDA cap 1000, pause 900. Keyed per source so each wired source gets its own window.
      **Acceptance**: covers US-3 scenarios — record below cap → true; pause at 900; reject at 1000; window slides
      as calls age out; a `429` is treated as window-full and triggers backoff.

---

## Phase 3 — Read API (id-read, status, candidates, search, key lookup)

> **REBUILD.** Replaces the old `fdcId`-keyed `GET /v1/foods/{fdcId}` read/`/nutrients`/`/autocomplete`.
> All routes are auth-gated by `FoodAuthGuard` (Phase 8) and obey the FR-051 precedence
> (`401`→`403`→`400`→`404`/`202`/`200`).
> ⚠️ **Deploy gate (US-0 launch-blocking, FR-035).** No `/v1/foods/*` endpoint from Phases 3–4 may be
> exposed publicly until T-033 (Phase 8 `FoodAuthGuard`) is mounted. Phases 3–7 build/test the routes
> behind the unmerged auth wiring; the service is not deployed to a public ALB target until auth lands.

- [ ] **T-130** [M] [Test-first: true] `FoodsModule` + `FoodsController`/`FoodsService` rewired to the new DAOs + adapter registry — `packages/services/food-service/src/foods/foods.module.ts` (FR-001, FR-IDN-1)
      **(reuse: module shell exists from old Phase 2; rewire providers to the per-aggregate DAOs, the adapter
      registry, and the enqueue emitter.)**
      **Acceptance**: module bootstraps; controller/service/DAOs injectable; no `UsdaApiModule` import leaks USDA
      types into the controller layer.

- [ ] **T-131** [M] [Test-first: true] `GET /v1/foods/{id}` — golden-record read + lifecycle status codes (`200` only `RESOLVED`; `202` `PENDING`/`UNRESOLVED`; `404` `NOT_FOUND`/`FAILED`/no row, status retrievable); ULID validation `400` — `—` (FR-002, FR-003, FR-004, FR-006)
      **Acceptance**: covers US-1 scenarios 1–4 and US-8 — `RESOLVED` → `200` golden record < 50ms, no source call;
      `PENDING`/`UNRESOLVED` → `202`; `NOT_FOUND`/`FAILED` → `404` with `status` in body; malformed `id` → `400`.

- [ ] **T-132** [S] [Test-first: false] `GET /v1/foods/{id}/status` — lifecycle poll (+ golden record when `RESOLVED`) — `—` (FR-007, FR-033)
      **Acceptance**: returns the correct shape per status (US-8 scenarios 1–4).

- [ ] **T-133** [M] [Test-first: true] `GET /v1/foods/{id}/candidates` — list cross-source candidates for an `UNRESOLVED` food (each carries `source` + that source's item key) — `—` (FR-RES-1)
      **Acceptance**: an `UNRESOLVED` food returns its candidate list; a `RESOLVED`/`PENDING` food returns an
      empty/appropriate response (US-2a scenario 1).

- [ ] **T-134** [M] [Test-first: true] `GET /v1/foods/search?query=` — local `pg_trgm` fuzzy/substring/partial search → `id`s ranked by relevance; barcode/`external_key` lookup via `food_sources` crosswalk; never calls a source — `—` (FR-008, FR-009, FR-010)
      **Acceptance**: covers US-6 — "chicken breast" ranked hits; "avacado" fuzzy-matches "Avocado, raw"; no local
      match → empty set (no source call); a known barcode/external_key resolves to the food `id`; ≤200ms at 10k
      foods.

---

## Phase 4 — Create / Resolve API (add-by-name, PATCH-resolve, batch, enqueue)

> **REBUILD.** The primary path into external sources. Auth-gated; FR-051 precedence applies.
> ⚠️ **Deploy gate (US-0 launch-blocking, FR-035).** Same rule as Phase 3 — these create/resolve routes
> must not be publicly exposed until T-033 (Phase 8 `FoodAuthGuard`) is mounted.

- [ ] **T-140** [M] [Test-first: true] `POST /v1/foods` — add-by-name: create canonical row + `id` (normalized-name dedup under a Postgres advisory lock so concurrent adds collapse to one row), enqueue (`INSERT … ON CONFLICT` + `pg_notify`), return `202` + `id`; empty/whitespace name → `400` — `—` (FR-005, FR-006, FR-011, FR-013, FR-IDN-1)
      **Acceptance**: covers US-2 scenarios 1 & 4 — first add → `202` + `id` < 100ms with one `fetch_queue` row;
      a concurrent second add for the same normalized name collapses to the same `id` (no duplicate canonical or
      queue row); empty name → `400`, nothing enqueued.

- [ ] **T-141** [S] [Test-first: true] Enqueue emitter (`EnqueueEmitter.publishFoodRequested` / `publishFoodBatchRequested`) — in-process `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify('fetch_queued', food_id)`; `requestedBy` = verified `sub`/service principal (no `'system'` shortcut) — `packages/services/food-service/src/foods/enqueue.emitter.ts` (FR-011, FR-014, FR-017, FR-048)
      **Acceptance**: each enqueue fires exactly one `pg_notify` with the `food_id`; duplicate enqueue increments
      distinct-requester demand, not a raw counter.

- [ ] **T-142** [M] [Test-first: true] `PATCH /v1/foods/{id}` — resolve from the user's candidate pick: validate each chosen candidate belongs to this food's candidate set (else `400`/`409`, status unchanged), drive the merge (Phase 6) → `RESOLVED`; manual pick stored as ordinary provenance — `—` (FR-RES-2, FR-RES-3)
      **Acceptance**: covers US-2a scenarios 2 & 3 — a valid pick merges → `RESOLVED`; a candidate not in the food's
      set → `400`/`409` with `status` unchanged.

- [ ] **T-143** [M] [Test-first: true] `POST /v1/foods/batch` — ≤100 names (`400` over), per-item partial response (cached `RESOLVED` inline + `PENDING` per miss, each row created + enqueued), distinct-requester demand — `—` (FR-012, FR-045)
      **Acceptance**: covers US-4 scenarios 1, 2, 4 — 15 names (10 cached, 5 miss) → 10 inline + 5 `PENDING` `id`s
      in one body; 3-of-5 in flight collapse to existing `id`s; >100 names → `400`, nothing enqueued.

- [ ] **T-144** [S] [Test-first: true] Queue backpressure + circuit breaker on enqueue (`fetch_queue` depth ceiling 10,000 or open source breaker → `503`, jittered recovery) — `—` (FR-046)
      **Acceptance**: at max depth / breaker-open, `POST /v1/foods` and `/batch` return `503`; recovery drains
      without a burst spike.

- [ ] **T-145** [S] [Test-first: false] Operational `POST /v1/foods/{id}/refetch` (admin-scoped manual re-enqueue) — `—` (FR-039, FR-051)
      **Acceptance**: a valid token without the elevated `public_metadata` scope → `403`; with scope → re-enqueues.

---

## Phase 5 — Postgres Queue + Fargate Fan-Out Worker + Limiter

> **REBUILD.** Replaces the old single-source fetch worker. Fan-out across the adapter registry, per-source
> rolling-window limiter, demotion at drain time, lease/retry/backoff. The worker scaffold (LISTEN/NOTIFY,
> single-instance advisory lock) exists as a skeleton from old Phase 0/3.

- [ ] **T-150** [M] [Test-first: false] Fargate worker scaffold flesh-out — single instance via Postgres advisory lock (FR-022), `LISTEN fetch_queued`, structured logging (powertools), Sentry, SIGTERM lease release — `packages/services/food-service/src/worker/` (FR-017, FR-018, FR-022)
      **(reuse: skeleton exists; flesh out the lifecycle.)**
      **Acceptance**: worker holds the `LISTEN` connection; only one instance drains (advisory lock); SIGTERM
      reverts this worker's `in_flight` rows to `pending`; wake-to-process ≤ 100ms.

- [ ] **T-151** [M] [Test-first: true] Drain loop with demand-weighting + **demotion at drain time** — `SELECT … FOR UPDATE SKIP LOCKED` ordered by `request_count DESC, first_requested ASC`, with `sub`s over the 50-pending threshold ranked to the back (live per-`sub` count from `fetch_queue`+`fetch_requesters`; dynamic re-promotion) — `—` (FR-015, FR-043, FR-044)
      **Acceptance**: covers US-5 scenarios 1–2 + SC-012 — `A` (50) before `B` (1); FIFO tie-break; a `sub` with >50 pending is ranked to the back while others drain, auto re-promoted when it drops below 50; **no `429`**.

- [ ] **T-152** [L] [Test-first: true] Fan-out across the adapter registry — for each wired adapter `searchByName(name)` (per-source rolling-window-limited via T-122), `fetchByKey` + `mapToCanonical` the hits — `—` (FR-MRG-1, FR-MRG-4, FR-ADP-1, FR-019)
      **Acceptance**: a queued food fans out over the registry; USDA is called within its window; a source that
      returns no hits contributes nothing; the limiter pauses USDA draining at 90%.

- [ ] **T-153** [M] [Test-first: true] Lease watchdog + tombstone/backoff/retry — `in_flight` >30s → `pending`; source `5xx`/timeout → `pending`, `attempts++`, `last_requested = now()+2^attempts s`; after 5 attempts → food `FAILED`, row `tombstone`, `last_error`; no source has it → `NOT_FOUND` tombstone immediately (no retry) — `—` (FR-016, FR-018, FR-025, FR-026, FR-027)
      **Acceptance**: covers US-5 scenarios 5–7 — `5xx` cycles `pending→in_flight→pending` with backoff, lands
      `FAILED`/`tombstone` after 5 attempts; no-source → `NOT_FOUND`/`tombstone` immediately; tombstone rows
      queryable via SQL with `attempts`/`last_error`.

- [ ] **T-154** [S] [Test-first: false] Success path — on a confident merge, upsert golden record (Phase 6), write `food_sources` crosswalk, **delete the `fetch_queue` row** (no `done` status), emit `FoodDataReceived` — `—` (FR-024, FR-MRG-1)
      **Acceptance**: a resolved food has its `fetch_queue` row removed; `FoodDataReceived` carries the food `id`.

- [ ] **T-155** [S] [Test-first: false] Worker uses the USDA adapter's ≤20-key batch where it has resolved multiple items (counts as 1 windowed call) — `—` (FR-023, SC-005)
      **Acceptance**: a fan-out resolving several USDA items in one drain issues 1 batch call recorded once
      against the window (US-4 scenario 3).

---

## Phase 6 — Merge Engine + Golden Record + Per-Field Provenance

> **REBUILD.** The cross-source merge that the old single-source worker had no equivalent of.

- [ ] **T-160** [L] [Test-first: true] Merge engine (field-level): presence beats absence; identity/short fields (`name`, `brand_*`) → higher-priority source; free-text (`description`, `ingredients`) → longer-wins; nutrients normalized per-100g then higher-priority source wins on conflict — `packages/services/food-service/src/foods/merge/merge-engine.ts` (FR-MRG-2, FR-MRG-3)
      **Acceptance**: unit tests assert each rule independently — absence filled by another source; short field takes
      USDA (higher priority) not the longest; description takes the longer; conflicting nutrient takes the
      higher-priority source; all values normalized to per-100g before blending.

- [ ] **T-161** [M] [Test-first: true] Provenance writer — scalar fields → `food_field_provenance(food_id, field, source_id)`; `food_nutrients.source_id` / `food_portions.source_id`; "which fields came from source X" single-query (no payload retained) — `—` (FR-028, FR-029, SC-013, R5, R7)
      **Acceptance**: every stored scalar/nutrient/portion of a `RESOLVED` food carries a resolvable `source_id`;
      the provenance UNION query answers source-X in one statement; no `raw_json` is written (SC-013).

- [ ] **T-162** [M] [Test-first: true] Pre-merge dedup + **auto-resolve rule** — collapse candidates confidently (normalized-name exact match + nutrient agreement within ±10% on energy/protein); exactly one surviving candidate → `RESOLVED`; ≥2 non-collapsible → `UNRESOLVED` — `—` (FR-RES-3, FR-MRG-1, §9-1)
      **Acceptance**: one surviving candidate (single hit, or hits collapsing within tolerance) → `RESOLVED`; two
      non-collapsible survivors → `UNRESOLVED`; the tolerance is config-driven (`FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE`).
      **(Default confirmed at the plan gate 2026-06-22: ±10% via `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE=0.10`, config-overridable without a schema change.)**

- [ ] **T-163** [S] [Test-first: true] Manual-resolution merge path (PATCH pick → merge → `RESOLVED`, pick stored as ordinary provenance so refresh protects it) — `—` (FR-RES-2, FR-031)
      **Acceptance**: a PATCH-driven merge sets `RESOLVED` and records the chosen candidate's `source_id`;
      the value is indistinguishable from a normal stored value to the refresh path.

- [ ] **T-164** [S] [Test-first: false] Input validation/sanitization + HTTPS enforcement at the merge boundary (reject-not-store on validation failure; cert-validated outbound) — `—` (FR-ADP-2, FR-ADP-3)
      **Acceptance**: a candidate value failing validation is dropped (food still resolves from valid values/other
      sources); outbound fetches use HTTPS with certificate validation.

- [ ] **T-165** [S] [Test-first: false] `FoodDataReceived` / `FetchFailed` event emission (canonical name harmonized — see FU-EVENTNAME) — `—` (FR-034)
      **Acceptance**: completion emits `FoodDataReceived{ id, status }`; a tombstone emits `FetchFailed` to
      CloudWatch/SNS; the detailType matches the CDK rule.

---

## Phase 7 — Change-Driven Refresh + UNRESOLVED TTL

> **REBUILD.** Replaces the old age-based stale-while-revalidate (T-063/T-030) entirely. The read never
> blocks on refresh; a field moves only when its originating external item changed upstream.

- [ ] **T-170** [M] [Test-first: false] Change-refresh scheduler (EventBridge `IngestionScheduled` cron) — select `RESOLVED` foods, enqueue low-priority refresh work (deduped via `ON CONFLICT`) — `packages/services/food-service/src/lambdas/change-refresh/handler.ts` (FR-032)
      **(needs FU-ESBUILD bundling like identity-webhooks.)**
      **Acceptance**: the cron enqueues `RESOLVED` foods as low-priority `fetch_queue` work; `NOT_FOUND`/`FAILED`
      tombstones are not refreshed.

- [ ] **T-171** [M] [Test-first: true] Change detection on refresh — adapter re-fetches each backing source item, compares `food_sources.item_version`; re-pull a field ONLY when its originating item changed; unchanged + user-resolved fields left intact; re-pulled values pass FR-ADP-2 and update `source_id` — `—` (FR-031, FR-032)
      **Acceptance**: covers US-7 scenarios 1–4 — only fields from a changed item are re-pulled; an all-unchanged
      food is untouched; a user-resolved field whose item is unchanged is preserved; a re-pulled value passes
      validation and updates provenance.

- [ ] **T-172** [S] [Test-first: true] `UNRESOLVED` 30-day TTL sweep — change-refresh cron sweeps `UNRESOLVED` foods older than `FOOD_UNRESOLVED_TTL_DAYS` (default 30, via `food.updated_at`) to `NOT_FOUND` (re-addable); reuses the tombstone TTL machinery — `—` (§9-2, FR-025)
      **Acceptance**: an `UNRESOLVED` food untouched for >30 days is swept to `NOT_FOUND`; a recently-updated one is
      not. **(Default confirmed at the plan gate 2026-06-22: 30 days via `FOOD_UNRESOLVED_TTL_DAYS=30`, config-overridable.)**

---

## Phase 8 — Authentication & Authorization Wiring (US-0, FR-035–FR-053)

> **REUSE / WIRE.** The in-process `AuthMiddleware` + shared `ClerkAuthService` pattern is established in the
> identity service. This phase extracts the shared verify package and wires it onto food-service routes; it is
> mostly wiring + tests, not a from-scratch build. **Build this slice before exposing Phases 3–4 publicly.**

- [ ] **T-046** [M] [Test-first: false] `@kitchensink/clerk-verify` shared package — extract networkless `verifyToken(jwtKey, authorizedParties)` from the identity service's `ClerkAuthService`; consumed by both identity and food-service (one impl, no drift) — `packages/shared/clerk-verify` (FR-036, FR-053)
      **(reuse: lifts existing identity-service verification — refactor/extract, not new logic.)**
      **Acceptance**: identity + food-service both import it; verification makes zero outbound network calls.

- [ ] **T-033** [M] [Test-first: true] `FoodAuthGuard` — in-process NestJS `AuthMiddleware` on every `/v1/foods/*` route; networkless `verifyToken` (`CLERK_JWT_KEY` + `azp`); identity from verified `sub` only (no client header); fail-closed — `packages/services/food-service/src/auth/` (FR-035, FR-036, FR-037, FR-038, FR-040, FR-042, FR-053)
      **(reuse: mirrors identity `AuthMiddleware`.)**
      **Acceptance**: covers US-0 scenarios 1–6 + SC-010 — no/invalid/expired/wrong-`azp` token → `401`, no row,
      no enqueue, no source call; valid token → `req.user.sub` set; a forged `x-authorizer-context` is ignored;
      missing `CLERK_JWT_KEY` → fail-closed `401`.

- [ ] **T-047** [S] [Test-first: true] M2M / service-token support — accept Clerk machine tokens (azp-allowlisted) for downstream 001/006/007/009 + internal jobs (recipe import FR-012, change-refresh FR-032); classify each endpoint user/service/both — `—` (FR-047, A-012)
      **Acceptance**: US-0 scenario 11 — a valid M2M token is accepted (not `401`); a user-only endpoint rejects a
      service token where disallowed.

- [ ] **T-048** [S] [Test-first: true] Authorization scopes + status precedence — `403` for authenticated-but-insufficient `public_metadata` scope on operational endpoints; enforce `401`→`403`→`400`→`404`/`202`/`200` — `—` (FR-039, FR-051)
      **Acceptance**: US-0 scenario 10 — valid token w/o scope on `/refetch` → `403`; malformed `id` with a bad
      token → `401` (not `400`).

- [ ] **T-049** [M] [Test-first: true] Fairness by **demotion** (no quota, no `429`) — drain-time scorer demotes a `sub` with >50 pending to the back; dynamic re-promotion; work-conserving — `—` (FR-043, SC-012)
      **(implemented in the drain loop T-151; this task is the auth-side guarantee + test.)**
      **Acceptance**: US-0 scenario 9 + SC-012 — a >50-pending `sub` is demoted while others drain; auto re-promoted
      below 50; no request rejected with `429`.

- [ ] **T-050** [S] [Test-first: true] Distinct-requester demand counting — `request_count` counts distinct `sub`s via `fetch_requesters`; one `sub`'s repeats can't inflate priority; capped + aged — `—` (FR-044)
      **Acceptance**: a single `sub` repeatedly adding one name cannot pin it ahead of genuine distinct-requester
      demand.

- [ ] **T-051** [S] [Test-first: true] Max batch size enforcement — `POST /v1/foods/batch` + recipe-import sets ≤100 names → `400` over, nothing enqueued; accepted misses feed demotion (not a quota) — `—` (FR-045)
      **(shares the endpoint with T-143; this is the auth-side cap + test.)**
      **Acceptance**: US-0 scenario 12 — oversized batch → `400`, nothing enqueued.

- [ ] **T-052** [S] [Test-first: true] Queue backpressure + circuit breaker (auth/DoS side) — depth ceiling / open breaker → `503`, jittered recovery — `—` (FR-046)
      **(shares enforcement with T-144.)**
      **Acceptance**: at max depth / breaker-open, enqueue returns `503`; recovery drains without a burst.

- [ ] **T-053** [S] [Test-first: false] Async-producer least-privilege IAM + provenance — only named IAM roles may `events:PutEvents` / insert into `fetch_queue`; consumer validates provenance; `requestedBy` is a real principal (no `'system'` shortcut) — `—` (FR-048)
      **Acceptance**: an unnamed/unauthorized producer cannot enqueue; the consumer rejects rows with no valid
      `requestedBy`.

- [ ] **T-054** [S] [Test-first: true] Auth-layer DoS protection — bound verification concurrency + per-source `401`-rate cap (load-shed) under an invalid-token flood — `—` (FR-052, SC-009, SC-011)
      **Acceptance**: SC-011 (≤10ms p95) holds under an invalid-token flood, not just the happy path.

- [ ] **T-056** [S] [Test-first: false] `fetch_requesters` migration + user-erasure handling (no quota tables) — `—` (FR-043, FR-044)
      **(folded into T-103; retained as the auth-traceable migration anchor — on user-deletion, delete that `sub`'s
      `fetch_requesters` rows; no `user_fetch_quota`/`global_fetch_quota`.)**
      **Acceptance**: deleting a user removes their `fetch_requesters` rows; no quota table exists.

- [ ] **T-057** [M] [Test-first: false] `@kitchensink/food-service-client` — rebuild the typed client to the new API surface (`addByName`/`getById`/`getStatus`/`getCandidates`/`resolve`/`search`/`batch`); attach user or M2M token; map `401`/`403`/`400`/`503`/`404`/`202` (no per-user `429`) — `packages/clients/food-service` (FR-047)
      **(reuse: placeholder package exists; rebuild the surface to the id-keyed API.)**
      **Acceptance**: a downstream service calls the food API with an M2M token via this client and gets typed
      results; unauthorized calls surface typed `401`/`403`; no `fdcId` in the client's public shapes.

> **WebSocket auth (FR-041, FR-049)** is tracked with the deferred WebSocket work in **Phase 9**
> (`$connect` Lambda authorizer + per-`sub` notification targeting from `fetch_requesters`).

---

## Phase 9 — Search Indexer / Observability / WebSocket (deferred bits)

- [ ] **T-180** [S] [Test-first: false] Optional ranked-FTS indexer (generated `tsvector` + GIN) on `FoodDataReceived` — `packages/services/food-service/src/lambdas/food-search-indexer/handler.ts` (FR-008)
      **Deferred** — `pg_trgm` (T-104/T-134) already covers fuzzy search; add only if ranked full-text is needed.
      **Acceptance**: after a resolve, the food appears in ranked FTS results; no Redis to invalidate.

- [ ] **T-181** [S] [Test-first: false] Custom CloudWatch metrics from the worker — `food-fetch-queue-depth`, `food-resolution-latency-seconds`, `source-rolling-window-count` (per source), `source-api-success-rate`, `food-unresolved-backlog`, `food-tombstone-count`, `food-cache-hit-rate`, `auth-401-rate` — `—` (SC-002, SC-006, US-10)
      **Acceptance**: metrics populate after processing test requests; per-source window count is visible.

- [ ] **T-182** [S] [Test-first: false] CloudWatch dashboard `food-data` (queue depth, in-flight leases, per-source trailing-60-min count, UNRESOLVED backlog, tombstone count, resolution latency, worker error rate) — `—` (US-10)
      **Acceptance**: dashboard visible after `cdk deploy`; widgets populate after 100 test requests.

- [ ] **T-183** [S] [Test-first: false] CloudWatch alarms — tombstone-row count > 0; API error rate > 5%; `fetch_queue` depth > 10,000 (FR-046); pending `first_requested` age > 5 min — `—` (SC-006, US-10)
      **Acceptance**: each alarm created in synth and fires on its condition (US-10 scenarios 2–3).

- [ ] **T-184** [S] [Test-first: false] Operational query endpoints (admin-scoped) — `GET /v1/foods/ops/queue` (depths), `GET /v1/foods/ops/tombstones?limit=`, `POST /v1/foods/ops/retry/{id}` (flip `tombstone`→`pending`) — `—` (FR-039, FR-016, FR-018)
      **Acceptance**: counts accurate; retry re-queues a tombstone; all require the elevated scope (`403` without).

- [ ] **T-185** [M] [Test-first: true] [P3 — Deferred] API Gateway WebSocket API + `$connect` Lambda authorizer (reuses `@kitchensink/clerk-verify`; token via query param / `Sec-WebSocket-Protocol`; reject → `403`; mid-connection `exp` → close; FR-050 cache rules apply here) — `—` (FR-034, FR-041, FR-049, FR-050)
      **Deferred** — implement only if polling UX (US-8) proves insufficient.
      **Acceptance**: `$connect` without a valid token → `403`; with a valid token → connection + `sub` stored.

- [ ] **T-186** [S] [Test-first: false] [P3 — Deferred] WebSocket push on resolve — on `FoodDataReceived`, resolve recipients from `fetch_requesters` (`sub`→food `id` set), push `{type:"food_ready", id}`, no broadcast; clean up stale (410) connections — `—` (FR-034, FR-041)
      **Acceptance**: US-9 — a connected requester receives the push within 60s; non-requesting connections get
      nothing; stale connections are cleaned up.

---

## Phase 10 — E2E Harness + Migration Runner

- [ ] **T-190** [M] [Test-first: false] E2E harness — booted food-service + LocalStack (Community) + Docker Postgres; scenarios add-by-name `202`→worker fan-out/merge→`200`, dedup, candidates/PATCH-resolve, batch partial, EventBridge completion — `packages/services/food-service/vitest.e2e.config.ts` (FR-005, FR-011, FR-013, FR-014, FR-024, FR-MRG-1, FR-RES-2 — E2E)
      **(reuse/extend: foundation in place — `infra/localstack/docker-compose.yml` (`localstack:4.4.0` + `postgres:16`), `e2e-food` CI job, `test:e2e` script, `health.e2e.test.ts` boots the real Nest app + migrates Docker Postgres. Extend with the re-baselined id-keyed flows once Phases 3–6 land. Community tier — no auth token.)**
      **Acceptance**: `npm run test:e2e --workspace=packages/services/food-service` boots against Docker Postgres
      and the add-by-name → fan-out → resolve / dedup / candidates / batch / EventBridge scenarios pass; the
      `e2e-food` CI job is required on the food-service path. **Checkbox stays unticked until the new flows land.**

- [ ] **T-191** [M] [Test-first: false] FU-MIGRATE — in-VPC migration-runner Lambda (mirrors identity-webhooks `migrate.ts`: VPC-attached, reaches private RDS, applies the Phase-1 ordered SQL against `kitchensink_food`, tracked in `schema_migrations`, invoked at deploy; wired to `FoodDbSecretArn`) — `packages/services/food-service/src/lambdas/migrate/` (ARCH-001)
      **(deferred to deploy/release-readiness per the 2026-06-20 decision; phases build against Docker Postgres
      until then.)**
      **Acceptance**: the runner applies the 003 migrations against `kitchensink_food` over the NAT-less private
      path; re-running is idempotent (tracked migrations skipped).

---

## Phase 11 — Performance & Availability

- [ ] **T-195** [M] [Test-first: false] Performance / load tests for SC-001/003/004/007 — cache-hit p95 ≤ 50ms (SC-001), backfill `202`→`RESOLVED` p95 ≤ 60s at queue depth < 100 (SC-003), cache-hit rate ≥ 80% after 5,000 foods (SC-004), search p95 ≤ 200ms at 50,000 foods (SC-007) — `—` (SC-001, SC-003, SC-004, SC-007)
      **Acceptance**: each SC threshold measured/reported under representative load; regressions fail CI.

- [ ] **T-196** [S] [Test-first: false] [P3 — Deferred] Multi-AZ upgrade of the shared `kitchensink-data-{stage}` instance (SC-009) — `packages/infra/global/lib/platform/data-stack.ts` (SC-009, A-013)
      **Deferred to GA/scale** — lean launch accepts the single-AZ risk; platform-wide change (identity + food).
      **Acceptance**: `cdk diff` flips `multiAz` to true with a failover test plan; no data loss.

---

## FR Coverage Audit (re-baselined — all 67 FRs: 53 numbered + FR-IDN-1..3 + FR-RES-1..3 + FR-MRG-1..4 + FR-ADP-1..3)

| FR       | Covered By                                   | Status                                            |
| -------- | -------------------------------------------- | ------------------------------------------------- |
| FR-IDN-1 | T-100, T-105, T-140                          | ✅                                                |
| FR-IDN-2 | T-121                                        | ✅                                                |
| FR-IDN-3 | T-100, T-101                                 | ✅                                                |
| FR-001   | T-130, T-131                                 | ✅                                                |
| FR-002   | T-105, T-131                                 | ✅                                                |
| FR-003   | T-131                                        | ✅                                                |
| FR-004   | T-131                                        | ✅                                                |
| FR-005   | T-105, T-140                                 | ✅                                                |
| FR-006   | T-131, T-140                                 | ✅                                                |
| FR-007   | T-132                                        | ✅                                                |
| FR-RES-1 | T-133                                        | ✅                                                |
| FR-RES-2 | T-142, T-163                                 | ✅                                                |
| FR-RES-3 | T-142, T-162                                 | ✅                                                |
| FR-008   | T-104, T-106, T-134, T-180                   | ✅                                                |
| FR-009   | T-134                                        | ✅                                                |
| FR-010   | T-104, T-134                                 | ✅                                                |
| FR-011   | T-140, T-141                                 | ✅                                                |
| FR-012   | T-143, T-047                                 | ✅                                                |
| FR-013   | T-105, T-140                                 | ✅                                                |
| FR-014   | T-101, T-109, T-141                          | ✅                                                |
| FR-015   | T-104, T-109, T-151                          | ✅                                                |
| FR-016   | T-153, T-184                                 | ✅                                                |
| FR-017   | T-141, T-150                                 | ✅                                                |
| FR-018   | T-109, T-122, T-150, T-153                   | ✅                                                |
| FR-019   | T-002, T-110, T-122, T-152                   | ✅                                                |
| FR-020   | T-110, T-122                                 | ✅                                                |
| FR-021   | T-122                                        | ✅                                                |
| FR-022   | T-150                                        | ✅                                                |
| FR-023   | T-003, T-121, T-155                          | ✅                                                |
| FR-024   | T-121, T-154                                 | ✅                                                |
| FR-025   | T-002, T-153, T-172                          | ✅ (incl. 30d tombstone TTL re-attempt)           |
| FR-026   | T-122, T-153                                 | ✅                                                |
| FR-027   | T-153                                        | ✅                                                |
| FR-028   | T-100, T-101, T-102, T-105–T-108, T-161      | ✅                                                |
| FR-029   | T-104, T-108, T-161                          | ✅                                                |
| FR-030   | T-186 (deferred Redis variant) / in-proc LRU | ⚠️ deferred (no Redis at launch; in-process only) |
| FR-031   | T-163, T-171                                 | ✅ (change-driven, not age-based)                 |
| FR-032   | T-170, T-171                                 | ✅                                                |
| FR-033   | T-131, T-132                                 | ✅                                                |
| FR-034   | T-165, T-185, T-186                          | ✅ (deferred)                                     |
| FR-MRG-1 | T-152, T-154, T-162                          | ✅                                                |
| FR-MRG-2 | T-120, T-160                                 | ✅                                                |
| FR-MRG-3 | T-107, T-160                                 | ✅                                                |
| FR-MRG-4 | T-120, T-152                                 | ✅                                                |
| FR-ADP-1 | T-120, T-121, T-152                          | ✅                                                |
| FR-ADP-2 | T-121, T-164, T-171                          | ✅                                                |
| FR-ADP-3 | T-003, T-121, T-164                          | ✅                                                |
| FR-035   | T-033                                        | ✅                                                |
| FR-036   | T-033, T-046                                 | ✅                                                |
| FR-037   | T-033                                        | ✅                                                |
| FR-038   | T-033                                        | ✅                                                |
| FR-039   | T-048, T-145, T-184                          | ✅                                                |
| FR-040   | T-033                                        | ✅                                                |
| FR-041   | T-185, T-186                                 | ✅ (deferred)                                     |
| FR-042   | T-002, T-033                                 | ✅                                                |
| FR-043   | T-049, T-151                                 | ✅                                                |
| FR-044   | T-050, T-109, T-151                          | ✅                                                |
| FR-045   | T-051, T-143                                 | ✅                                                |
| FR-046   | T-052, T-144, T-183                          | ✅                                                |
| FR-047   | T-047, T-057                                 | ✅                                                |
| FR-048   | T-053, T-141                                 | ✅                                                |
| FR-049   | T-185                                        | ✅ (deferred)                                     |
| FR-050   | T-033, T-185                                 | ✅                                                |
| FR-051   | T-048, T-131, T-142                          | ✅                                                |
| FR-052   | T-054                                        | ✅                                                |
| FR-053   | T-033, T-046                                 | ✅                                                |

**Gap**: None. All functional requirements trace to ≥1 task. **FR-030** is intentionally not built as
ElastiCache Redis at launch (A-002) — the new architecture removes Redis; the cache-acceleration intent is met
by an optional in-process LRU (plan §6) and the deferred Redis variant rides with T-186/the limiter's deferred
sorted-set form.

**Success-criteria coverage:** SC-001/003/004/007 → T-195; SC-002 → T-110/T-122/T-181; SC-005 → T-152/T-155;
SC-006 → T-153/T-181/T-183; SC-008 → T-100/T-107; SC-009 → T-054/T-196; SC-010 → T-033; SC-011 → T-054;
SC-012 → T-049/T-151; SC-013 → T-100/T-108/T-161.

**Test-first tasks (red-gate, 42):** T-003, T-033, T-047, T-048, T-049, T-050, T-051, T-052, T-054, T-100,
T-101, T-102, T-103, T-104, T-105, T-106, T-107, T-108, T-109, T-110, T-120, T-121, T-122, T-130, T-131,
T-133, T-134, T-140, T-141, T-142, T-143, T-144, T-151, T-152, T-153, T-160, T-161, T-162, T-163, T-171,
T-172, T-185.

---

## Follow-ups (carried from `.forge-status.yml`)

- **FU-MIGRATE** — in-VPC migration-runner Lambda → **T-191** (deferred to deploy/release-readiness; build on Docker Postgres until then).
- **FU-INGREDIENTS** — `ingredients ↔ food(id)` is a **soft `food_id text` column owned by feature 001** (no cross-DB FK; app-layer validation). Not a 003 task.
- **FU-EVENTNAME** — harmonize the completion event name (`FoodDataReceived` vs `FoodFetchCompleted`) across spec/plan/CDK/v-model before the worker emits it (T-165).
- **FU-ESBUILD** — esbuild bundling for the food Lambdas (change-refresh T-170, search-indexer T-180, migrate T-191), like identity-webhooks.
- **FU-LOCALSTACK-E2E** — E2E foundation in place (LocalStack Community + Docker Postgres); the re-baselined id-keyed AWS-service flows land with T-190 as Phases 3–6 complete.

---

## Gate items needing your judgment (plan §9)

1. **Auto-resolve confidence threshold (§9-1)** — recommendation: auto-`RESOLVED` iff exactly one surviving
   candidate after pre-merge dedup (single hit, or hits collapsing on normalized-name exact match + nutrient
   agreement within **±10%** on energy/protein). The ±10% tolerance is a product call (T-162,
   `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE`).
2. **`UNRESOLVED` TTL (§9-2)** — recommendation: soft 30-day TTL via `food.updated_at`, swept to `NOT_FOUND` by
   the change-refresh cron (T-172). Confirm the 30-day default.
3. **Source priority ranking (§9-5)** — USDA hard-coded highest now (`['usda']` static config); promote to a
   DB-backed ranking only when a second source is wired (T-120). No schema change at launch.
4. Async candidate search (§9-3) and change-detection via `item_version` (§9-4) are resolved in-plan (async +
   `food_sources.item_version`) — no open decision, recorded for traceability.
