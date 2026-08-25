# Tasks: Feature 003 — Source-Agnostic Food Data Integration

**Feature**: `003-usda-food-data`
**Architecture**: Event-Driven Queue-Based (Postgres `fetch_queue` + LISTEN/NOTIFY + Fargate fan-out/merge worker + per-source rolling 60-min window limiter)
**Updated**: 2026-06-28 — **stabilized to the decision register** (canonical names, `food_candidates`, `leased_at`, distinct-requester demand, settled auto-resolve/UNRESOLVED-TTL/refresh); supersedes the 2026-06-22 source-agnostic re-baseline. **Review-2 remediation applied** (DSN-13 change-refresh scheduled-task CDK T-001c; DSN-14 `CandidateMismatchError` → `409`; DSN-11 demotion-query perf note/test; DSN-3 distinct-`sub` enqueue formula; DB-5/DB-6/DB-7/DB-8 nutrient-dedup/amount-CHECK/gram_weight-CHECK/`fetch_state`-CHECK/reaper-index schema tasks; TST-2/4/5/6/7/8 red-gate scenarios).
**Source Artifacts**: plan.md (re-baselined), spec.md (re-baselined), product-spec.md, decision-register.md
**Design Reference**: plan.md §2 (13 canonical tables), §2A (auth), §3 (API contracts), §4 (queue/limiter), §5 (fan-out + merge), §9 (deferred decisions)

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
> | OLD DB schema (`foods` + `fdcId` PK + denormalized nutrient cols)         | **REBUILD** → the 13 normalized tables                                       |
> | OLD REST API (`/api/v1/foods/{fdcId}` read/batch, denormalized DTOs)      | **REBUILD** → add-by-name + id-read + candidates + PATCH-resolve + search    |
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

<!-- The example above is INDENTED on purpose. It is the format illustration, not a task, but at column 0 it
     matched every "count the open checkboxes" sweep and made feature 003 read as having one more open task
     than it has — a phantom that cost real time to chase. Indenting keeps the example faithful while taking
     it out of the anchored `^[-*] \[ \]` count. Do not un-indent it, and do not "complete" it. -->

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

> ⚠️ **URL prefix normalized 2026-08-12 (GR-002 AC-002-a).** This file previously carried **19** bare
> `/v1/foods/*` references. The canonical path is **`/api/v1/foods/*`** and that is what all three services serve.
> ⛔ This is **not** a claim that the bare form was removed from the running service: `FoodsController` deliberately
> registers `@Controller(['api/v1/foods', 'v1/foods'])`, because the bare path is a **DEPRECATED ALIAS** kept for
> consumers outside this repository (already-shipped mobile builds, cached web bundles with build-time-inlined
> endpoints). Retiring the alias has an ordered prerequisite list — see
> [ADR-0011](../../docs/architecture/decisions/0011-api-version-prefix.md). Specs cite the canonical path; the alias
> stays in code until ADR-0011 s list is worked through.

| Package                            | Path                             | Role                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@kitchensink/food-service`        | `packages/services/food-service` | Deployable NestJS service on ECS/Fargate behind the shared per-stage ALB (host rule, priority 200). Canonical Drizzle schema/DAOs, `/api/v1/foods/*` API, in-process `FoodAuthGuard`, source-adapter interface + fan-out/merge worker, own CDK. **Built (old design); schema/API/worker rebuilt under this plan.** |
| `@kitchensink/usda-client`         | `packages/clients/usda`          | The **USDA source adapter** — typed wrapper over USDA FoodData Central. The **only** place `fdcId` / USDA terms appear; maps `fdcId → external_key` inbound. **Built + zod-validated; wrapped in `FoodSourceAdapter` as a new task.**                                                                              |
| `@kitchensink/food-service-client` | `packages/clients/food-service`  | Typed client for **our** `/api/v1/foods/*` API (web/mobile + 001/006/007/009 M2M callers). Exposes only canonical `id`-keyed shapes. **Placeholder built; surface rebuilt to the new API.**                                                                                                                        |
| `@kitchensink/clerk-verify`        | `packages/shared/clerk-verify`   | Shared networkless Clerk verification (`verifyToken` + `azp`), extracted from the identity service.                                                                                                                                                                                                                |

**Database (no new RDS, no cluster):** the food tables live in the **separate logical database
`kitchensink_food`** on the existing shared instance `kitchensink-data-{stage}` (db.t4g.small, global
DataStack). `pg_trgm` is already bootstrapped on the instance (FR-008 fuzzy search). Migrations run via the
**in-VPC migration-runner Lambda (FU-MIGRATE)**; phases build/test against **Docker Postgres** until that
runner is wired.

**Canonical table set (13):** `food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`,
`food_field_provenance`, `food_category`, `food_category_assignment`, `fetch_queue`, `fetch_requesters`,
`source_call_log`, `source_sync_metadata`, `food_candidates`. **Removed** from the old design: `foods` (denormalized),
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
  └─► CHANGE-REFRESH SCHEDULED-TASK CDK (T-001c — EventBridge → ECS RunTask) ─► T-170
  └─► ENV CONFIG source-agnostic (T-002) · usda-client (T-003 ✓)
        └─► PHASE 1: 13-TABLE SCHEMA + MIGRATIONS + DAOs (T-100..T-111)
              ├─► PHASE 2: FoodSourceAdapter iface + USDA adapter wrap (T-120..T-122)
              ├─► PHASE 8: AUTH WIRING (T-046 ✓dep, T-033, T-047..T-056)  [US-0]
              │     └─► gates ▼
              ├─► VALIDATION + CONTRACT CONFORMANCE (T-204..T-208) [GR-016/017: pipe, floor, ingress, client]
              ├─► PHASE 3: READ API  GET /{id} · /status · /candidates · /search (T-130..T-134)
              │     └─► PHASE 4: CREATE/RESOLVE API  POST /api/v1/foods · PATCH /{id} · /batch (T-140..T-145)
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

- [x] **T-001** [M] [Test-first: false] `FoodServiceStack` CDK (ECS/Fargate, shared-ALB host rule priority 200, fan-out worker, scheduled-producer EventBridge — no SQS, no per-service ALB, no new RDS) — `packages/services/food-service/infra/lib/FoodServiceStack.ts` (ARCH-001, FR-005..FR-035 deploy surface)
      **(reuse: built + synth-verified in old Phase 0. Worker/lambda handlers are skeletons fleshed out in Phases 5–7/9. EventBridge demand-rule already correctly absent — demand path is the Postgres `fetch_queue`. No structural change required for the re-baseline.)**

- [x] **T-001b** [S] [Test-first: false] Global DataStack: `kitchensink_food` logical DB + least-privilege role/secret on the shared instance (exports `FoodDbSecretArn`/`FoodDatabaseName`; reuse bootstrapped `pg_trgm`) — `packages/infra/global/lib/platform/DataStack.ts` (ARCH-001)
      **(reuse: built in old Phase 0 — no new RDS/cluster. Unchanged by the re-baseline.)**

- [x] **T-001c** [S] [Test-first: false] Change-refresh **Fargate scheduled-task CDK wiring** — EventBridge schedule (`IngestionScheduled`) → ECS `RunTask` target running the change-refresh task definition (D-REFRESH); least-privilege task-execution + task IAM roles (read `kitchensink_food`, `events:PutEvents` for `IngestionScheduled`); Fargate in the public subnet (`assignPublicIp`, IGW egress off the NAT path, ADR-0004) — `packages/services/food-service/infra/lib/FoodServiceStack.ts` (FR-032)
      **(new — DSN-13: T-001 was synth-verified against the prior VPC-Lambda producer; the change-refresh path is now an ECS scheduled task (D-REFRESH), so the EventBridge-schedule → ECS-`RunTask` target, its task definition, and the `RunTask`/task-execution IAM roles are wired here. The app-level T-170 consumes this.)**
      **Acceptance**: `cdk synth` emits an EventBridge rule whose target is the change-refresh ECS task (`RunTask`); the task role can read `kitchensink_food` and `events:PutEvents`; the task runs in the public subnet with `assignPublicIp` (no NAT path).

- [x] **T-003** [M] [Test-first: true] `@kitchensink/usda-client` — typed USDA HTTP client + zod validation of the USDA wire shape (`getFood`/`getFoodsBatch`/`searchFoods`, error types incl. `UsdaSchemaError`, ≤20-id batch) — `packages/clients/usda/src/usda-api.client.ts` (FR-023, FR-ADP-3)
      **(reuse: built TDD, 12/12 tests green, validates the raw USDA wire shape at the boundary. The client itself is DONE — it is wrapped in the `FoodSourceAdapter` interface by the NEW T-120/T-121.)**

- [x] **T-002** [S] [Test-first: false] Source-agnostic env config (Zod) — rename USDA-coupled vars to the source-neutral set — `packages/services/food-service/src/config/` (FR-019, FR-025, FR-025a, FR-032, FR-042)
      Adjust the existing Zod env schema (built in old Phase 0) to the re-baselined config: - `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` (non-secret; FR-042). - `FOOD_DEMOTE_THRESHOLD` (default 50; FR-043), `FOOD_MAX_QUEUE_DEPTH` (default 10000; FR-046),
      `FOOD_MAX_BATCH_NAMES` (default 100; FR-045), `FOOD_LEASE_TIMEOUT_SECONDS` (default 30; FR-018, `leased_at` reaper window),
      `FOOD_NOT_FOUND_TTL_DAYS` (default 30; FR-025), `FOOD_UNRESOLVED_TTL_DAYS` (default 30; `food_candidates`-set expiry, FR-025a). - The auto-resolve boundary is a **survivor-count rule** (normalized-name exact match) with **no nutrient tolerance**; the old `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` knob is **removed** (D-AUTORESOLVE). - **Per-source** config block keyed by `source` (USDA today): `USDA_API_KEY` (secret), `USDA_API_BASE_URL`,
      `USDA_RATE_LIMIT_PER_HOUR` (default 1000; rolling-60-min cap, pause at 90%). - The old single-source `USDA_STALE_THRESHOLD_DAYS` is **removed** (refresh is change-driven, not age-based).
      **Acceptance**: missing `USDA_API_KEY` or `CLERK_JWT_KEY` throws a descriptive Zod error at startup; all
      vars reachable via `ConfigService` in both the NestJS API and the Fargate worker.

---

## Phase 1 — Canonical Schema (13 tables) + Migrations + DAOs

> **REBUILD.** Replaces the old `foods`/`usda_*` schema entirely. Build/test on Docker Postgres until
> FU-MIGRATE (T-191) wires the in-VPC runner. The old T-004..T-009 (`foods` denormalized table, `fdcId` PK,
> `usda_sync_metadata`, `usda_call_log`, `ingredients` FK) are **removed/replaced** by the tasks below.

- [x] **T-100** [M] [Test-first: true] Drizzle schema — canonical core (`food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`, `food_field_provenance`, `food_category`, `food_category_assignment`) + enums (`food_status`, `food_kind`, `food_source`, `food_field`, `nutrient_basis`) — `packages/services/food-service/src/db/schema/food.ts` (FR-028, FR-IDN-1, FR-IDN-3)
      ULID `text('id')` PKs via a `newFoodId()` helper (reusing `ulidx`, mirroring identity's `newUserId`);
      `pgEnum` enums; `timestamp(col, { withTimezone: true })`; `numeric` for nutrient amounts/gram weights
      (SC-008 fidelity). `food_sources.external_key` (mapped from `fdcId`), `item_version` for refresh
      (FR-032), and `food_sources.fetch_state text` with `CHECK (fetch_state IN ('fetched','error'))` (DB-7) — the
      operational text+CHECK columns (`fetch_state`, and `fetch_queue.status` in T-101) are deliberately text+CHECK,
      **not** `pgEnum`; document that choice so the "controlled sets are `pgEnum`" rule stays internally consistent. **Provenance same-food integrity (D-PROVENANCE-FK):** `food_sources` carries `UNIQUE(food_id, id)`;
      `food_nutrients` / `food_portions` / `food_field_provenance` / `food_category_assignment` reference
      `food_sources` via a **composite `(food_id, source_id)` FK** (`ON DELETE NO ACTION`), while their `food_id`
      FK to `food` stays `ON DELETE CASCADE`. No `raw_json`, no `fetch_status`, no denormalized nutrient columns.
      **Acceptance**: `drizzle-kit generate` emits valid SQL; column types/enums match plan.md §2 exactly;
      a schema test asserts no source-native identifier column (no `fdc_id`) exists on any canonical table (SC-013);
      a value row whose `source_id` belongs to a different `food_id` is rejected by the composite FK.

- [x] **T-101** [S] [Test-first: true] Drizzle schema — operational tables (`fetch_queue` keyed on food `id` PK, `fetch_requesters`, `source_call_log` per-source, `source_sync_metadata` per-source) — `packages/services/food-service/src/db/schema/operational.ts` (FR-014, FR-018, FR-019, FR-043, FR-044, FR-IDN-3)
      `fetch_queue.food_id text PRIMARY KEY REFERENCES food(id)`; `status CHECK IN ('pending','in_flight','tombstone')`;
      **`leased_at timestamptz`** worker-lease column (D-LEASE — the reaper reverts `in_flight` rows whose
      `leased_at < now() - FOOD_LEASE_TIMEOUT_SECONDS` back to `pending`; reject `lease_expires_at` / reusing
      `last_requested` as a lease);
      `fetch_requesters(food_id, sub, requested_at)` PK `(food_id, sub)`; `source_call_log(id bigserial, source, called_at)`;
      `source_sync_metadata(source PRIMARY KEY, last_full_sync_at, last_incremental_at, source_version)`.
      **Acceptance**: tables generate cleanly; the `fetch_queue` status CHECK rejects invalid values; the
      `leased_at` column exists and is nullable (set on lease, cleared on release);
      `source_call_log` starts empty and the trailing-60-min count query returns 0 on a fresh DB.

- [x] **T-102** [M] [Test-first: true] Migration: canonical core tables + constraints — `—` (FR-028, FR-IDN-1)
      Ordered SQL creating the 8 canonical tables with their `food_id` FKs (`ON DELETE CASCADE` to `food`), the
      `food_normalized_name_unique` UNIQUE index (FR-005/FR-013 dedup), `food_sources_source_key_unique
UNIQUE(source, external_key)` (R4), and the `food_sources.fetch_state` `CHECK (fetch_state IN ('fetched','error'))` (DB-7). **Provenance same-food integrity (D-PROVENANCE-FK):** add
      `UNIQUE(food_id, id)` on `food_sources` and make the `source_id` references on `food_nutrients` /
      `food_portions` / `food_field_provenance` / `food_category_assignment` **composite `(food_id, source_id)`
      FKs with `ON DELETE NO ACTION`** (a `food_sources` row removal must not cascade-delete golden/manual values).
      **Acceptance**: migration runs cleanly on `kitchensink_food` (Docker Postgres); inserting two foods with the
      same `normalized_name` violates the unique constraint; inserting two `food_sources` with the same
      `(source, external_key)` is rejected; a `food_nutrients`/`food_portions`/`food_field_provenance` row pointing
      at a `source_id` from a **different** `food_id` is rejected by the composite FK.

- [x] **T-103** [S] [Test-first: true] Migration: operational tables — `—` (FR-014, FR-019, FR-043)
      Ordered SQL for `fetch_queue`, `fetch_requesters`, `source_call_log`, `source_sync_metadata`. Includes
      **user-erasure handling**: on a user-deletion event, `fetch_requesters` rows for that `sub` are deleted
      (closes the constitution data-privacy warning). **No `user_fetch_quota`/`global_fetch_quota` tables.**
      **Acceptance**: `ON CONFLICT (food_id) DO UPDATE` on `fetch_queue` works atomically; `fetch_requesters`
      dedups on `(food_id, sub)`.

- [x] **T-104** [S] [Test-first: true] Migration: indexes (search + lifecycle + queue + limiter) — `—` (FR-008, FR-010, FR-015, FR-019, FR-029)
      Apply: `food_status_idx`; `food_barcode_idx WHERE barcode IS NOT NULL`; GIN trigram
      `food_name_trgm_idx` / `food_description_trgm_idx` (`gin_trgm_ops`); `food_sources_food_id_idx`;
      `food_nutrients_food_id_idx`; `food_nutrients_source_id_idx`; the **demand-weighted partial**
      `idx_fetch_queue_priority ON fetch_queue (request_count DESC, first_requested ASC) WHERE status='pending'`;
      the **reaper partial** `idx_fetch_queue_inflight_leased ON fetch_queue (leased_at) WHERE status='in_flight'`
      (so the lease reaper and `leaseNext`'s `in_flight` re-claim branch do not seq-scan, DB-8);
      `idx_fetch_requesters_sub`; `idx_source_call_log_source_called_at` (windowed count + prune). `CREATE
EXTENSION IF NOT EXISTS pg_trgm`.
      **Acceptance**: `EXPLAIN ANALYZE` shows GIN index scan on trigram name search, index-only scan on the
      pending-priority partial index, an index scan on `idx_fetch_queue_inflight_leased` for the reaper's
      `in_flight`/`leased_at` predicate (DB-8), and an index scan for the trailing-60-min `source_call_log` count.

- [x] **T-105** [M] [Test-first: true] DAO: `FoodDao` (golden-record aggregate read/upsert; normalized-name dedup; legal status transitions; tombstone TTL fields) — `packages/services/food-service/src/foods/dao/food.dao.ts` (FR-002, FR-005, FR-013, FR-025, FR-028, FR-028a, FR-IDN-1)
      _(2026-06-29: green — `food.dao.ts` + `dao.errors.ts`; createByName idempotency + terminal-row reactivation, guarded illegal-transition rejection, and golden-record read (no fdcId) covered by `tests/food.dao.integration.test.ts`. See implementation-log.)_
      Per-aggregate DAO behind the existing `FoodsRepository` seam. `getById`, `createByName` (compute
      `normalized_name`, insert with `status='PENDING'`), `setStatus` (enforces the legal transition set
      `PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}` / `UNRESOLVED→RESOLVED` / `FAILED→PENDING` /
      `NOT_FOUND→PENDING`, FR-028a), `upsertGoldenScalars`, `readGoldenRecord` (joins nutrients/portions/provenance).
      `createByName` on an existing **terminal-state** (`NOT_FOUND`/`FAILED`, past TTL) normalized-name row
      **reactivates** it (→`PENDING`, re-enqueue) instead of raising a `23505` (FR-028a). No source term leaks (FR-ADP-1).
      **Acceptance**: `createByName` is idempotent on normalized name (returns the existing `id` on a second add);
      a `createByName` for a terminal-state past-TTL row reactivates it to `PENDING` (no `23505`); `setStatus`
      rejects an illegal transition; `readGoldenRecord` returns `id`/name/description/nutrients/portions/provenance
      with no `fdcId` anywhere.

- [x] **T-106** [S] [Test-first: true] DAO: `FoodSourcesDao` (crosswalk upsert; `external_key` + `item_version`; barcode/external-key lookup → `id`; carries `UNIQUE(food_id, id)` so value rows can take a composite same-food FK) — `packages/services/food-service/src/foods/dao/foodSources.dao.ts` (FR-008, FR-028, FR-029, FR-032)
      _(2026-06-29: green — `foodSources.dao.ts`; external-key + barcode lookup, item_version upsert, and the composite-FK same-food acceptance covered by `tests/foodSources.dao.integration.test.ts`.)_
      **Acceptance**: `findFoodIdByExternalKey(source, key)` resolves via `UNIQUE(source, external_key)`;
      `upsertSource` records/updates `item_version`; the inserted row satisfies `UNIQUE(food_id, id)` (D-PROVENANCE-FK).

- [x] **T-107** [S] [Test-first: true] DAO: `NutrientDao` + `FoodNutrientsDao` (dictionary upsert keyed on a stable dedup key — `external_code` is **nullable** (a source nutrient with no INFOODS tagname → multiple NULLs), so the dictionary key is `UNIQUE(COALESCE(external_code, lower(name) || '|' || unit))` so duplicate `'Protein'` rows cannot split `nutrient_id` (DB-5); the adapter resolves a source nutrient → `nutrient_id` via that key; per-value `source_id` via the composite `(food_id, source_id)` same-food FK; `UNIQUE(food_id, nutrient_id)` golden winner; `food_nutrients.amount numeric` with `CHECK (amount >= 0)` (DB-6); per-100g basis) — `packages/services/food-service/src/foods/dao/nutrient.dao.ts`, `foodNutrients.dao.ts` (FR-028, FR-MRG-3, SC-008)
      **Acceptance**: nutrient amounts stored as `numeric` (no float drift); a second value for the same
      `(food_id, nutrient_id)` overwrites the golden winner and updates `source_id`; a `source_id` from another
      food is rejected (composite FK); two source nutrients resolving to the same dictionary entry — one with a NULL
      `external_code` — collapse to one `nutrient_id` (DB-5); a negative `amount` is rejected by `CHECK (amount >= 0)` (DB-6).
      _(2026-06-29: green — `nutrient.dao.ts` (`resolveOrCreate`) + `foodNutrients.dao.ts` (`upsertValue`);
      duplicate-`Protein` dedup + NULL-`external_code` collapse, golden-winner overwrite, cross-food source_id
      rejection, and negative-amount CHECK covered by `tests/nutrient.dao.integration.test.ts`. **Deviation:** dedup
      honors the committed two-constraint schema (`UNIQUE(external_code)` + case-sensitive `UNIQUE(name, unit)`), not
      the single `COALESCE(…lower(name)…)` expression key in this prose — see implementation-log for the case-sensitivity caveat.)_

- [x] **T-108** [S] [Test-first: true] DAO: `FoodPortionsDao`, `FoodFieldProvenanceDao`, `FoodCategoryDao` (per-value `source_id` via the composite `(food_id, source_id)` same-food FK; `food_portions.gram_weight numeric` with `CHECK (gram_weight > 0)` (DB-6); single-query "which fields came from source X") — `packages/services/food-service/src/foods/dao/` (FR-028, FR-029, R7)
      **Acceptance**: a UNION query across `food_field_provenance` + `food_nutrients` + `food_portions` filtered by
      `source_id IN (food_sources of food X, source S)` returns the provenance set in one query (FR-029/SC-013);
      a non-positive `gram_weight` is rejected by `CHECK (gram_weight > 0)` (DB-6).
      _(2026-06-29: green — `foodPortions.dao.ts`, `foodFieldProvenance.dao.ts`, `foodCategory.dao.ts`; the
      single-query UNION `fieldsFromSource` and the gram_weight CHECK covered by `tests/foodProvenance.dao.integration.test.ts`.)_

- [x] **T-109** [M] [Test-first: true] DAO: `FetchQueueDao` + `FetchRequestersDao` (idempotent `INSERT … ON CONFLICT`; distinct-requester demand — `request_count` set to the distinct-`sub` count, each `sub` contributing at most once, `PRIORITY_CAP=1` per `sub`, never a raw `+1`; `SELECT … FOR UPDATE SKIP LOCKED` drain; `leased_at` reaper; per-`sub` live pending count) — `packages/services/food-service/src/foods/dao/fetchQueue.dao.ts`, `fetchRequesters.dao.ts` (FR-014, FR-015, FR-018, FR-043, FR-044)
      **Acceptance**: concurrent enqueues for one `id` produce exactly one row whose `request_count` equals the
      number of **distinct `sub`s** (one `sub`'s repeats do not inflate it); the drain query orders by
      `request_count DESC, first_requested ASC`; the reaper reverts `in_flight` rows whose `leased_at` is older
      than the lease timeout to `pending`.
      _(2026-06-29: green — `fetchQueue.dao.ts` + `fetchRequesters.dao.ts`; 50-adds-one-sub→`request_count=1`,
      N-distinct-subs→N, demand-ordered `FOR UPDATE SKIP LOCKED` lease, and reaper/lease-on-claim reclaim (attempts
      untouched) covered by `tests/fetchQueue.dao.integration.test.ts`. **Deviation:** `enqueue` computes
      `request_count` from the live distinct-sub count on the insert path too, not the literal `1` in MOD-003's
      pseudocode — see implementation-log.)_

- [x] **T-110** [S] [Test-first: true] DAO: `SourceCallLogDao` (atomic check-and-record for the per-source rolling 60-min window; prune) — `packages/services/food-service/src/foods/dao/sourceCallLog.dao.ts` (FR-019, FR-020)
      Single-statement atomic `INSERT … SELECT now() WHERE (SELECT count(*) FROM source_call_log WHERE source=$1
AND called_at > now()-interval '60 minutes') < $cap RETURNING id` (permits the call only under cap) +
      a prune of rows older than 60 min.
      **Acceptance**: concurrent check-and-record never lets the trailing count exceed the cap (no race);
      the trailing-60-min count slides as old rows age out; a prune-boundary test — rows at `now()-59m` / `-60m` /
      `-61m` → only the `>60m` row is deleted and the in-window count is unchanged (the prune must not under-count the
      limiter, TST-5).
      _(2026-06-29: green — `sourceCallLog.dao.ts`; under-cap allow / at-cap deny / 40-way-concurrent never-exceeds-cap,
      sliding window, and conservative prune (TST-5) covered by `tests/sourceCallLog.dao.integration.test.ts`.
      **Deviation:** `checkAndRecord` adds a per-source xact advisory lock so the cap holds under concurrency outside the
      single-drainer lock — see implementation-log.)_

- [x] **T-111** [M] [Test-first: true] `food_candidates` schema + migration + `CandidateStore` DAO (backs `UNRESOLVED` / US-2a) — `packages/services/food-service/src/db/schema/foodCandidates.ts`, migration, `packages/services/food-service/src/foods/dao/foodCandidates.dao.ts` (FR-028, FR-RES-1, FR-RES-2, FR-MRG-5, FR-025a)
      _(2026-06-29: schema + migration delivered and green — `food_candidates` table + `UNIQUE(food_id, source, external_key)` verified.)_
      _(2026-06-29: `CandidateStore` DAO delivered and green — `foodCandidates.dao.ts` (`persistCandidates`, `getCandidates`,
      `isMember`, `clear`); idempotent persist, 30-day-TTL exclusion (FR-025a), membership validation, clear-on-resolve, and
      parent-`food` cascade covered by `tests/foodCandidates.dao.integration.test.ts`.)_
      The 13th canonical table (D-CANDIDATES): `food_candidates(id text PK, food_id text NOT NULL REFERENCES
food(id) ON DELETE CASCADE, source food_source NOT NULL, external_key text NOT NULL, name text NOT NULL,
summary text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(food_id, source, external_key))`. DAO:
      `persistCandidates(food_id, candidates[])` (worker writes the surviving set on an `UNRESOLVED` outcome),
      `listByFood(food_id)` (backs `GET /candidates`), `isMember(food_id, candidate_id)` (PATCH-resolve
      validation), `clear(food_id)` (on resolve or candidate-set expiry).
      **Acceptance**: migration runs cleanly on `kitchensink_food` (Docker Postgres); a duplicate
      `(food_id, source, external_key)` is rejected; `clear` removes a food's candidate set; deleting the parent
      `food` cascades the candidates.

---

## Phase 2 — Source Adapter Interface + USDA Adapter Wrap

> **NEW.** The `usda-client` (T-003) is done; this phase introduces the `FoodSourceAdapter` boundary and
> wraps the client so the worker fans out over a registry. USDA is the only wired adapter; the loop is over a
> registry so adding a source is additive (FR-MRG-4/FR-ADP-1).

- [x] **T-120** [M] [Test-first: true] `FoodSourceAdapter` interface + adapter registry + canonical candidate types (`SourceCandidate`, `CanonicalCandidate`) + source-priority config (`['usda']`) — `packages/services/food-service/src/sources/foodSourceAdapter.ts` (FR-ADP-1, FR-MRG-2, FR-MRG-4)
      `interface FoodSourceAdapter { readonly source; searchByName(name): Promise<SourceCandidate[]>;
fetchByKey(externalKey): Promise<CanonicalCandidate>; }`. A static config-ordered priority list (USDA
      highest) per §9-5. No source-specific structure may appear in these types.
      **Acceptance**: a type-level test asserts the canonical candidate carries `source` + `externalKey` (never
      `fdcId`); the registry resolves the USDA adapter by `source='usda'`.

- [x] **T-121** [M] [Test-first: true] USDA adapter — wrap `@kitchensink/usda-client` to implement `FoodSourceAdapter`: `searchByName` (USDA `searchFoods`), `fetchByKey` (`getFood`, `fdcId → external_key`), `mapToCanonical` (USDA nutrients→`food_nutrients` per-100g, portions→`food_portions`, validate/sanitize) — `packages/clients/usda` consumer in `packages/services/food-service/src/sources/usda/usda.adapter.ts` (FR-IDN-2, FR-023, FR-024, FR-ADP-2, FR-ADP-3)
      The **only** place `fdcId` and USDA terms appear. Validates/sanitizes mapped values (type/range/length/text)
      before they enter the store; a response failing validation is rejected, not stored. MAY use the ≤20-key
      USDA batch (counts as 1 windowed call) once it has resolved which items to fetch (adapter-internal).
      **Acceptance**: `fetchByKey` returns a `CanonicalCandidate` with `external_key` (mapped from `fdcId`),
      per-100g nutrients, and `item_version`; an out-of-range/over-length value is rejected before mapping; the
      public return type exposes no `fdcId`.

- [x] **T-122** [S] [Test-first: true] Per-source rolling-window limiter (`RollingWindowLimiter` over `SourceCallLogDao`; pause at 90%; `429`-failsafe treats the window as full) — `packages/services/food-service/src/sources/RollingWindowLimiter.ts` (FR-019, FR-020, FR-021, FR-026)
      `tryRecord(source)`, `count(source)`, `isPaused(source)` (true once the trailing count ≥ 90% of that
      source's cap). USDA cap 1000, pause 900. Keyed per source so each wired source gets its own window.
      **Acceptance**: covers US-3 scenarios — record below cap → true; pause at 900; reject at 1000; window slides
      as calls age out; a `429` is treated as window-full and triggers backoff.

---

## Phase 3 — Read API (id-read, status, candidates, search, key lookup)

> **REBUILD.** Replaces the old `fdcId`-keyed `GET /api/v1/foods/{fdcId}` read/`/nutrients`/`/autocomplete`.
> All routes are auth-gated by `FoodAuthGuard` (Phase 8) and obey the FR-051 precedence
> (`401`→`403`→`400`→`404`/`202`/`200`).
> ⚠️ **Deploy gate (US-0 launch-blocking, FR-035).** No `/api/v1/foods/*` endpoint from Phases 3–4 may be
> exposed publicly until T-033 (Phase 8 `FoodAuthGuard`) is mounted. Phases 3–7 build/test the routes
> behind the unmerged auth wiring; the service is not deployed to a public ALB target until auth lands.

- [x] **T-130** [M] [Test-first: true] `FoodsModule` + `FoodsController`/`FoodsService` rewired to the new DAOs + adapter registry — `packages/services/food-service/src/foods/foods.module.ts` (FR-001, FR-IDN-1)
      **(reuse: module shell exists from old Phase 2; rewire providers to the per-aggregate DAOs, the adapter
      registry, and the enqueue emitter.)**
      **Acceptance**: module bootstraps; controller/service/DAOs injectable; no `UsdaApiModule` import leaks USDA
      types into the controller layer.

- [x] **T-131** [M] [Test-first: true] `GET /api/v1/foods/{id}` — golden-record read + lifecycle status codes (`200` only `RESOLVED`; `202` `PENDING`/`UNRESOLVED`; `404` `NOT_FOUND`/`FAILED`/no row, status retrievable); ULID validation `400` — `—` (FR-002, FR-003, FR-004, FR-006)
      **Acceptance**: covers US-1 scenarios 1–4 and US-8 — `RESOLVED` → `200` golden record < 50ms, no source call;
      `PENDING`/`UNRESOLVED` → `202`; `NOT_FOUND`/`FAILED` → `404` with `status` in body; malformed `id` → `400`.

- [x] **T-132** [S] [Test-first: false] `GET /api/v1/foods/{id}/status` — lifecycle poll (+ golden record when `RESOLVED`) — `—` (FR-007, FR-033)
      **Acceptance**: returns the correct shape per status (US-8 scenarios 1–4).

- [x] **T-133** [M] [Test-first: true] `GET /api/v1/foods/{id}/candidates` — list the persisted cross-source candidates (from `food_candidates`, T-111) for an `UNRESOLVED` food (each carries `source` + that source's `external_key`) — `—` (FR-RES-1)
      **Acceptance**: an `UNRESOLVED` food returns its `food_candidates` rows; a `RESOLVED`/`PENDING` food returns an
      empty/appropriate response (US-2a scenario 1); no `fdcId` appears in the response shape.

- [x] **T-134** [M] [Test-first: true] `GET /api/v1/foods/search?query=` — local `pg_trgm` fuzzy/substring/partial search → `id`s ranked by relevance; barcode/`external_key` lookup via `food_sources` crosswalk; never calls a source — `—` (FR-008, FR-009, FR-010)
      **Acceptance**: covers US-6 — "chicken breast" ranked hits; "avacado" fuzzy-matches "Avocado, raw"; no local
      match → empty set (no source call); a known barcode/external_key resolves to the food `id`; ≤200ms at 10k
      foods.

---

## Phase 4 — Create / Resolve API (add-by-name, PATCH-resolve, batch, enqueue)

> **REBUILD.** The primary path into external sources. Auth-gated; FR-051 precedence applies.
> ⚠️ **Deploy gate (US-0 launch-blocking, FR-035).** Same rule as Phase 3 — these create/resolve routes
> must not be publicly exposed until T-033 (Phase 8 `FoodAuthGuard`) is mounted.

- [x] **T-140** [M] [Test-first: true] `POST /api/v1/foods` — add-by-name: create canonical row + `id` (normalized-name dedup under a Postgres advisory lock so concurrent adds collapse to one row; a terminal-state past-TTL row for the same normalized name is **reactivated** → `PENDING` + re-enqueue via T-105, never a `23505`, FR-028a), enqueue (`INSERT … ON CONFLICT` + `pg_notify`), return `202` + `id`; empty/whitespace name → `400` — `—` (FR-005, FR-006, FR-011, FR-013, FR-025, FR-028a, FR-IDN-1)
      **Acceptance**: covers US-2 scenarios 1 & 4 — first add → `202` + `id` < 100ms with one `fetch_queue` row;
      a concurrent second add for the same normalized name collapses to the same `id` (no duplicate canonical or
      queue row); an add for a terminal-state past-TTL row reactivates it to `PENDING` (no `23505`); two **concurrent**
      re-adds of the same terminal past-TTL normalized name collapse to a single reactivation (one →`PENDING`, one
      enqueue, no `23505`, TST-8); empty name → `400`, nothing enqueued.

- [x] **T-141** [S] [Test-first: true] Enqueue emitter (`EnqueueEmitter.publishFoodRequested` / `publishFoodBatchRequested`) — in-process `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify('fetch_queued', food_id)`; `requestedBy` = verified `sub`/service principal (no `'system'` shortcut) — `packages/services/food-service/src/foods/enqueue.emitter.ts` (FR-011, FR-014, FR-017, FR-048)
      **Acceptance**: each enqueue fires exactly one `pg_notify` with the `food_id`; duplicate enqueue increments
      distinct-requester demand, not a raw counter.

- [x] **T-142** [M] [Test-first: true] `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick: **UNRESOLVED-only + idempotent** (a PATCH on an already-`RESOLVED` food is a no-op `200`); validate each chosen candidate is a member of this food's `food_candidates` set (else `CandidateMismatchError` → **`409 Conflict`** — `400` is reserved for a malformed body, DSN-14 — status unchanged); drive the merge (Phase 6) → `RESOLVED` and **clear the `food_candidates` set** (T-111); manual pick stored as ordinary provenance — `—` (FR-RES-2, FR-RES-3, FR-028a)
      **Acceptance**: covers US-2a scenarios 2 & 3 — a valid pick merges → `RESOLVED` and clears the candidate set;
      a candidate not in the food's set → `CandidateMismatchError` **`409`** with `status` unchanged; a PATCH on an
      already-`RESOLVED` food is an idempotent no-op; a valid pick whose `fetchByKey` re-fetch throws
      `SourceApiError` leaves the food `UNRESOLVED` with its `food_candidates` set **not** cleared and no golden-record
      write (TST-2); with the source window at/over cap (`shouldPauseDraining` true), a PATCH-resolve still proceeds
      per the settled DSN-6 cap semantics (TST-4).

- [x] **T-143** [M] [Test-first: true] `POST /api/v1/foods/batch` — ≤100 names (`400` over), per-item partial response (locally-`RESOLVED` inline + `PENDING` per add-by-name miss, each row created + enqueued), distinct-requester demand — `—` (FR-012, FR-045)
      **Acceptance**: covers US-4 scenarios 1, 2, 4 — 15 names (10 locally `RESOLVED`, 5 add-by-name miss) → 10 inline + 5 `PENDING` `id`s in one body; 3-of-5 in flight collapse to existing `id`s; a single batch body containing the
      same name twice collapses to one row (intra-batch dedup, TST-8); >100 names → `400`, nothing enqueued.

- [x] **T-144** [S] [Test-first: true] Queue backpressure + circuit breaker + near-ceiling flood-shed on enqueue (`fetch_queue` depth ceiling 10,000 or open source breaker → `503`, jittered recovery; near the global rolling-window ceiling, **NEW** enqueues from the highest-pending `sub` are shed first with `503` + `Retry-After` to preserve headroom — reads and `PATCH`-resolves are never shed and never `429`) — `—` (FR-046, FR-043b)
      **Acceptance**: at max depth / breaker-open, `POST /api/v1/foods` and `/batch` return `503`; near the ceiling a
      flooding `sub`'s NEW enqueue gets `503` while other users are unaffected; recovery drains without a burst spike.

- [x] **T-145** [S] [Test-first: false] Operational `POST /api/v1/foods/{id}/refetch` (admin-scoped manual re-enqueue) — `—` (FR-039, FR-051)
      **Acceptance**: a valid token without the elevated `public_metadata` scope → `403`; with scope → re-enqueues.

---

## Phase 5 — Postgres Queue + Fargate Fan-Out Worker + Limiter

> **REBUILD.** Replaces the old single-source fetch worker. Fan-out across the adapter registry, per-source
> rolling-window limiter, demotion at drain time, lease/retry/backoff. The worker scaffold (LISTEN/NOTIFY,
> single-instance advisory lock) exists as a skeleton from old Phase 0/3.

- [x] **T-150** [M] [Test-first: false] Fargate worker scaffold flesh-out — single instance via Postgres advisory lock (FR-022), `LISTEN fetch_queued`, structured logging (powertools), Sentry, SIGTERM lease release — `packages/services/food-service/src/worker/` (FR-017, FR-018, FR-022)
      **(reuse: skeleton exists; flesh out the lifecycle.)**
      **Acceptance**: worker holds the `LISTEN` connection; only one instance drains (advisory lock); SIGTERM
      reverts this worker's `in_flight` rows to `pending`; wake-to-process ≤ 100ms; an integration scenario stands up
      two `acquireWorkerLock()` against one Postgres → exactly one acquires and the loser drains nothing until release (TST-7).

- [x] **T-151** [M] [Test-first: true] Drain loop with demand-weighting + **demotion at drain time** — `SELECT … FOR UPDATE SKIP LOCKED` ordered by `request_count DESC, first_requested ASC`, with a food ranked to the back **only when all of its current requesters** individually exceed the 50-pending threshold (live per-`sub` count from `fetch_queue`+`fetch_requesters`; dynamic re-promotion when any requester drops below the threshold). No stored tier/`drain_priority_tier`, no `enqueueLowPriority` — demotion is drain-time live compute — `—` (FR-015, FR-043, FR-043a, FR-044)
      **Acceptance**: covers US-5 scenarios 1–2 + SC-012 — `A` (50) before `B` (1); FIFO tie-break; a food whose requesters all have >50 pending is ranked to the back while others drain, auto re-promoted when any requester drops below 50; a food with even one under-threshold requester is **not** demoted; **no `429`**. The per-`sub` demotion `COUNT(*)` is a correlated subquery inside the drain `ORDER BY`; acceptable at launch scale (< 10,000 rows), revisit/materialize a per-`sub` pending count at scale — cost is covered by the drain/demotion perf test in T-195 (DSN-11).

- [x] **T-152** [L] [Test-first: true] Fan-out across the adapter registry — for each wired adapter `searchByName(name)` (per-source rolling-window-limited via T-122), `fetchByKey` + `mapToCanonical` the hits — `—` (FR-MRG-1, FR-MRG-4, FR-ADP-1, FR-019)
      **Acceptance**: a queued food fans out over the registry; USDA is called within its window; a source that
      returns no hits contributes nothing; the limiter pauses USDA draining at 90%.

- [x] **T-153** [M] [Test-first: true] Lease reaper + tombstone/backoff/retry — `in_flight` rows with `leased_at < now() - FOOD_LEASE_TIMEOUT_SECONDS` → `pending` (reaper at consumer start + every minute; uses the partial index `idx_fetch_queue_inflight_leased`, DB-8); source `5xx`/timeout → `pending`, `attempts++`, `last_requested = now()+2^attempts s` (`FAILED→PENDING` retry, no 30-day gate); after 5 attempts → food `FAILED`, row `tombstone`, `last_error`; no source has it → `NOT_FOUND` tombstone immediately (no retry; `NOT_FOUND→PENDING` only after the 30-day TTL) — `—` (FR-016, FR-018, FR-025, FR-026, FR-027, FR-028a)
      **Acceptance**: covers US-5 scenarios 5–7 — an orphaned `in_flight` row with `leased_at` >30s is reclaimed to
      `pending`; `5xx` cycles `pending→in_flight→pending` with backoff, lands `FAILED`/`tombstone` after 5 attempts;
      no-source → `NOT_FOUND`/`tombstone` immediately; tombstone rows queryable via SQL with `attempts`/`last_error`.

- [x] **T-154** [S] [Test-first: false] Success path — on a confident merge, upsert golden record (Phase 6), write `food_sources` crosswalk, **delete the `fetch_queue` row** (no `done` status), emit `FoodFetchCompleted` (via `publishFoodFetchCompleted`) — `—` (FR-024, FR-MRG-1)
      **Acceptance**: a resolved food has its `fetch_queue` row removed; `FoodFetchCompleted` carries the food `id`.

- [x] **T-155** [S] [Test-first: false] Worker uses the USDA adapter's ≤20-key batch where it has resolved multiple items (counts as 1 windowed call) — `—` (FR-023, SC-014)
      **Acceptance**: a fan-out resolving several USDA items in one drain issues 1 batch call recorded once
      against the window (US-4 scenario 3); first-time NEW-food resolution stays within the source budget (SC-014, ~500–900/hr).

---

## Phase 6 — Merge Engine + Golden Record + Per-Field Provenance

> **REBUILD.** The cross-source merge that the old single-source worker had no equivalent of.

- [x] **T-160** [L] [Test-first: true] Merge engine (field-level): presence beats absence; identity/short fields (`name`, `brand_*`) → higher-priority source; free-text (`description`, `ingredients`) → longer-wins; nutrients normalized per-100g then higher-priority source wins on conflict — `packages/services/food-service/src/foods/merge/mergeEngine.ts` (FR-MRG-2, FR-MRG-3)
      **Acceptance**: unit tests assert each rule independently — absence filled by another source; short field takes
      USDA (higher priority) not the longest; description takes the longer; conflicting nutrient takes the
      higher-priority source; all values normalized to per-100g before blending.

- [x] **T-161** [M] [Test-first: true] Provenance writer — scalar fields → `food_field_provenance(food_id, field, source_id)`; `food_nutrients.source_id` / `food_portions.source_id`; "which fields came from source X" single-query (no payload retained) — `—` (FR-028, FR-029, SC-013, R5, R7)
      **Acceptance**: every stored scalar/nutrient/portion of a `RESOLVED` food carries a resolvable `source_id`;
      the provenance UNION query answers source-X in one statement; no `raw_json` is written (SC-013).

- [x] **T-162** [M] [Test-first: true] Pre-merge dedup + **auto-resolve boundary** — after dedup, count candidates surviving **normalized-name exact match**: exactly one → `RESOLVED`; **>1 → `UNRESOLVED`** (persist the surviving candidates to `food_candidates` via T-111); **0 → `NOT_FOUND`**. **No nutrient tolerance** — bias toward `UNRESOLVED` over a wrong auto-pick (human is the final arbiter) — `—` (FR-RES-3, FR-MRG-1, FR-MRG-5, §9-1)
      **Acceptance**: a single surviving candidate → `RESOLVED`; two non-collapsible survivors → `UNRESOLVED` with the
      surviving set persisted to `food_candidates` (satisfying `UNIQUE(food_id, source, external_key)`); zero
      survivors → `NOT_FOUND`. No `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` knob (dropped at stabilization, D-AUTORESOLVE).

- [x] **T-163** [S] [Test-first: true] Manual-resolution merge path (PATCH pick → merge → `RESOLVED`, pick stored as ordinary provenance so refresh protects it) — `—` (FR-RES-2, FR-031)
      **Acceptance**: a PATCH-driven merge sets `RESOLVED` and records the chosen candidate's `source_id`;
      the value is indistinguishable from a normal stored value to the refresh path.

- [x] **T-164** [S] [Test-first: false] Input validation/sanitization + HTTPS enforcement at the merge boundary (reject-not-store on validation failure; cert-validated outbound) — `—` (FR-ADP-2, FR-ADP-3)
      **Acceptance**: a candidate value failing validation is dropped (food still resolves from valid values/other
      sources); outbound fetches use HTTPS with certificate validation.

- [x] **T-165** [S] [Test-first: false] `FoodFetchCompleted` / `FetchFailed` event emission (canonical names; FU-EVENTNAME closed) — `—` (FR-034)
      **Acceptance**: completion emits `FoodFetchCompleted{ id, status }` via `publishFoodFetchCompleted`; a tombstone
      emits `FetchFailed` to CloudWatch/SNS; the `detailType` matches the deployed CDK `FoodFetchCompletedRule`
      (`detailType: ['FoodFetchCompleted']`); a red-gate test asserts `FetchFailed{ id }` is put on the bus
      (fire-and-forget) on a `FAILED` tombstone — `FetchFailed` is **retained** as a canonical event (it is not
      vestigial; FU-EVENTNAME stays closed), TST-6.

---

## Phase 7 — Change-Driven Refresh + UNRESOLVED TTL

> **REBUILD.** Replaces the old age-based stale-while-revalidate (T-063/T-030) entirely. The read never
> blocks on refresh; a field moves only when its originating external item changed upstream.

- [x] **T-170** [M] [Test-first: false] Change-refresh **Fargate scheduled task** (triggered by the EventBridge `IngestionScheduled` schedule — **not** a VPC Lambda; ADR-0004 egress/compute-placement rationale: Fargate in public subnets egresses via the IGW, off the NAT path; the EventBridge-schedule → ECS `RunTask` target + IAM roles + task definition are provisioned by T-001c, DSN-13) — selects `RESOLVED` foods and re-enqueues them through the **ordinary** `enqueue(food_id, 'svc_change_refresh')` path (a low-demand row, deduped via `ON CONFLICT`); idle-drain background work that yields to live demand, budget-bounded (no fixed cadence promise) — `packages/services/food-service/src/worker/change-refresh/` (FR-032)
      **Acceptance**: the scheduled task enqueues `RESOLVED` foods via the ordinary low-demand enqueue path;
      `NOT_FOUND`/`FAILED` tombstones are not refreshed; refresh work yields to live demand and never overwrites a
      user's manual pick.

- [x] **T-171** [M] [Test-first: true] Change detection on refresh — adapter re-fetches each backing source item, compares `food_sources.item_version`; re-pull a field ONLY when its originating item changed; unchanged + user-resolved fields left intact; re-pulled values pass FR-ADP-2 and update `source_id` — `—` (FR-031, FR-032)
      **Acceptance**: covers US-7 scenarios 1–4 — only fields from a changed item are re-pulled; an all-unchanged
      food is untouched; a user-resolved field whose item is unchanged is preserved; a re-pulled value passes
      validation and updates provenance.

- [x] **T-172** [S] [Test-first: true] `UNRESOLVED` candidate-set expiry — the change-refresh task expires a food's `food_candidates` set 30 days after `created_at` (`FOOD_UNRESOLVED_TTL_DAYS`, default 30); the **food is kept `UNRESOLVED`** (never swept to `NOT_FOUND`) and the next add-by-name request re-fans-out against the normal budget; a human pick made before expiry still wins — `—` (FR-025a, §9-2)
      **Acceptance**: a `food_candidates` set older than 30 days is cleared (via T-111 `clear`) and the next request
      re-fans-out while the food stays `UNRESOLVED` (not `NOT_FOUND`); a human pick before expiry → `RESOLVED` with no
      re-fan-out; a recently-created candidate set is untouched. **(30-day default; config-overridable via `FOOD_UNRESOLVED_TTL_DAYS`.)**

---

## Phase 8 — Authentication & Authorization Wiring (US-0, FR-035–FR-053)

> **REUSE / WIRE.** The in-process `AuthMiddleware` + shared `ClerkAuthService` pattern is established in the
> identity service. This phase extracts the shared verify package and wires it onto food-service routes; it is
> mostly wiring + tests, not a from-scratch build. **Build this slice before exposing Phases 3–4 publicly.**

- [x] **T-046** [M] [Test-first: false] `@kitchensink/clerk-verify` shared package — extract networkless `verifyToken(jwtKey, authorizedParties)` from the identity service's `ClerkAuthService`; consumed by both identity and food-service (one impl, no drift) — `packages/shared/clerk-verify` (FR-036, FR-053)
      **(reuse: lifts existing identity-service verification — refactor/extract, not new logic.)**
      **Acceptance**: identity + food-service both import it; verification makes zero outbound network calls.

- [x] **T-033** [M] [Test-first: true] `FoodAuthGuard` — in-process NestJS `AuthMiddleware` on every `/api/v1/foods/*` route; networkless `verifyToken` (`CLERK_JWT_KEY` + `azp`); identity from verified `sub` only (no client header); fail-closed — `packages/services/food-service/src/auth/` (FR-035, FR-036, FR-037, FR-038, FR-040, FR-042, FR-053)
      **(reuse: mirrors identity `AuthMiddleware`.)**
      **Acceptance**: covers US-0 scenarios 1–6 + SC-010 — no/invalid/expired/wrong-`azp` token → `401`, no row,
      no enqueue, no source call; valid token → `req.user.sub` set (from the verified Clerk `sub` only); a forged
      `x-authorizer-context` **or `x-debug-sub`** is ignored (no trusted-header identity path); missing
      `CLERK_JWT_KEY` → fail-closed `401`.

- [x] **T-047** [S] [Test-first: true] M2M / service-token support — accept Clerk machine tokens (azp-allowlisted) for downstream 001/006/007/009 + internal jobs (recipe import FR-012, change-refresh FR-032); classify each endpoint user/service/both — `—` (FR-047, A-012)
      **Acceptance**: US-0 scenario 11 — a valid M2M token is accepted (not `401`); a user-only endpoint rejects a
      service token where disallowed.

- [x] **T-048** [S] [Test-first: true] Authorization scopes + status precedence — `403` for authenticated-but-insufficient `public_metadata` scope on operational endpoints; enforce `401`→`403`→`400`→`404`/`202`/`200` — `—` (FR-039, FR-051)
      **Acceptance**: US-0 scenario 10 — valid token w/o scope on `/refetch` → `403`; malformed `id` with a bad
      token → `401` (not `400`).

- [x] **T-049** [M] [Test-first: true] Fairness by **demotion** (no per-user quota, no `429`) — drain-time scorer demotes a food only when **all** its requesters exceed the 50-pending threshold; dynamic re-promotion; work-conserving — `—` (FR-043, FR-043a, SC-012)
      **(implemented in the drain loop T-151; this task is the auth-side guarantee + test.)**
      **Acceptance**: US-0 scenario 9 + SC-012 — a food whose requesters all have >50 pending is demoted while others
      drain; auto re-promoted when any requester drops below 50; a food with an under-threshold requester is not
      demoted; no request rejected with `429`.

- [x] **T-050** [S] [Test-first: true] Distinct-requester demand counting — `request_count` = the **count of distinct `sub`s** via `fetch_requesters` (uncapped total; each `sub` contributes at most one via the `(food_id, sub)` PK — `PRIORITY_CAP=1` is structural per `sub`, never `LEAST(count, 1)`, DSN-3); one `sub`'s repeats can't inflate priority; aged — `—` (FR-044)
      **Acceptance**: a single `sub` repeatedly adding one name cannot pin it ahead of genuine distinct-requester
      demand.

- [x] **T-051** [S] [Test-first: true] Max batch size enforcement — `POST /api/v1/foods/batch` + recipe-import sets ≤100 names → `400` over, nothing enqueued; accepted misses feed demotion (not a quota) — `—` (FR-045)
      **(shares the endpoint with T-143; this is the auth-side cap + test.)**
      **Acceptance**: US-0 scenario 12 — oversized batch → `400`, nothing enqueued.

- [x] **T-052** [S] [Test-first: true] Queue backpressure + circuit breaker + near-ceiling flood-shed (auth/DoS side) — depth ceiling / open breaker → `503`, jittered recovery; near the global rolling-window ceiling, a flooding `sub`'s NEW enqueues are shed first with `503` while reads/`PATCH`-resolves are never shed (no `429`) — `—` (FR-046, FR-043b)
      **(shares enforcement with T-144.)**
      **Acceptance**: at max depth / breaker-open, enqueue returns `503`; near the ceiling a flooding `sub` gets `503`
      on NEW enqueue while other users are unaffected; recovery drains without a burst.

- [x] **T-053** [S] [Test-first: false] Async-producer least-privilege IAM + provenance — only named IAM roles may `events:PutEvents` / insert into `fetch_queue`; consumer validates provenance; `requestedBy` is a real principal (no `'system'` shortcut) — `packages/services/food-service/infra/lib/FoodServiceStack.ts` (named task roles grant `events:PutEvents`) + `src/worker/provenance.ts` (FR-048)
      **Acceptance**: an unnamed/unauthorized producer cannot enqueue; the consumer rejects rows with no valid
      `requestedBy`.
      **(CODE DONE — consumer provenance over `fetch_requesters` (`src/worker/provenance.ts` +
      `FoodConsumerService.processRow` refuses a row with no valid recorded requester / the `'system'`
      shortcut; unit + integration green). The least-privilege IAM half (only named roles may
      `events:PutEvents` / insert into `fetch_queue`) is infra/CDK and remains DEFERRED — not `[x]`.)**

- [x] **T-054** [S] [Test-first: true] Auth-layer DoS protection — bound verification concurrency + per-source `401`-rate cap (load-shed) under an invalid-token flood — `—` (FR-052, SC-009, SC-011)
      **Acceptance**: SC-011 (≤10ms p95) holds under an invalid-token flood, not just the happy path.

- [x] **T-056** [S] [Test-first: false] `fetch_requesters` migration + user-erasure handling (no quota tables) — `—` (FR-043, FR-044)
      **(folded into T-103; retained as the auth-traceable migration anchor — on user-deletion, delete that `sub`'s
      `fetch_requesters` rows; no `user_fetch_quota`/`global_fetch_quota`.)**
      **Acceptance**: deleting a user removes their `fetch_requesters` rows; no quota table exists.

- [x] **T-057** [M] [Test-first: false] `@kitchensink/food-service-client` — rebuild the typed client to the new API surface (`addByName`/`getById`/`getStatus`/`getCandidates`/`resolve`/`search`/`batch`); attach user or M2M token; map `401`/`403`/`400`/`409`/`503`/`404`/`202` (no per-user `429`; a `CandidateMismatchError` surfaces as **`409 Conflict`**, DSN-14) — `packages/clients/food-service` (FR-047)
      **(reuse: placeholder package exists; rebuild the surface to the id-keyed API.)**
      **Acceptance**: a downstream service calls the food API with an M2M token via this client and gets typed
      results; unauthorized calls surface typed `401`/`403`; no `fdcId` in the client's public shapes.

> **WebSocket auth (FR-041, FR-049)** is tracked with the deferred WebSocket work in **Phase 9**
> (`$connect` Lambda authorizer + per-`sub` notification targeting from `fetch_requesters`).

---

## Phase 9 — Search Indexer / Observability / WebSocket (deferred bits)

- [x] **T-180** [S] [Test-first: false] Optional ranked-FTS indexer (generated `tsvector` + GIN) on `FoodFetchCompleted` — `packages/services/food-service/src/lambdas/food-search-indexer/handler.ts` (FR-008) — _implemented as an additive `0001_food_fts.sql` migration (STORED generated `search_vector` + GIN) + ranked `ts_rank` search in `FoodSearchDao` (pg_trgm retained as fuzzy fallback); no separate indexer Lambda needed since the column is generated, not application-maintained._
      **Deferred** — `pg_trgm` (T-104/T-134) already covers fuzzy search; add only if ranked full-text is needed.
      **Acceptance**: after a resolve, the food appears in ranked FTS results; no Redis to invalidate.

- [x] **T-181** [S] [Test-first: false] Custom CloudWatch metrics from the worker — `food-fetch-queue-depth`, `food-resolution-latency-seconds`, `source-rolling-window-count` (per source), `source-api-success-rate`, `food-unresolved-backlog`, `food-tombstone-count`, `food-local-store-serve-rate`, `auth-401-rate` (emitted via CloudWatch EMF to stdout — no extra IAM; added `food-fetch-pending-age-seconds`/`food-in-flight-leases`/`food-worker-error-count` to back the T-183 alarm + T-182 widgets) — `packages/services/food-service/src/observability/emfMetrics.ts` (+ worker wiring) (SC-002, SC-006, US-10)
      **Acceptance**: metrics populate after processing test requests; per-source window count is visible; the
      local-store serve rate reflects `RESOLVED` reads served with no source call (not a USDA "cache hit").

- [x] **T-182** [S] [Test-first: false] CloudWatch dashboard `food-data` (queue depth, in-flight leases, per-source trailing-60-min count, UNRESOLVED backlog, tombstone count, resolution latency, worker error rate; per-stage name, `pr-{N}` prefix when ephemeral per ADR-0005) — `packages/services/food-service/infra/lib/FoodServiceStack.ts` (US-10)
      **Acceptance**: dashboard visible after `cdk deploy`; widgets populate after 100 test requests.

- [x] **T-183** [S] [Test-first: false] CloudWatch alarms — tombstone-row count > 0; API error rate > 5% (target-group 5xx per ADR-0003); `fetch_queue` depth > 10,000 (FR-046); pending `first_requested` age > 5 min; all → SNS topic + `SnsAction` — `packages/services/food-service/infra/lib/FoodServiceStack.ts` (SC-006, US-10)
      **Acceptance**: each alarm created in synth and fires on its condition (US-10 scenarios 2–3).

- [x] **T-184** [S] [Test-first: false] Operational query endpoints (admin-scoped) — `GET /api/v1/foods/admin/metrics` (queue depths + UNRESOLVED backlog + NOT*FOUND/FAILED tombstone counts + per-source trailing-60-min window utilization) and `GET /api/v1/foods/admin/queue` (depths); both gated by `food:admin` (401 unauth / 403 unscoped). The read-only operational-query slice of FR-039/US-10 — `packages/services/food-service/src/foods/admin/`. *(The mutating `POST /ops/retry/{id}` tombstone→pending action is deferred: out of this read-only operational-query slice; `FetchQueueDao.reactivate` already backs it.)\_ (FR-039, FR-016, FR-018)
      **Acceptance**: counts accurate; retry re-queues a tombstone; all require the elevated scope (`403` without).

- [x] **T-185** **[CLOSED — WON'T DO as specified, superseded by feature 014, 2026-08-10]** API Gateway WebSocket API + `$connect` Lambda authorizer — **NOT BUILT.** The `$connect` authorizer, the query-param/subprotocol token hand-off and the FR-050 cache rules all describe plumbing for a socket this service will not host.
      ORIGINAL ENTRY: [M] [Test-first: true] [P3 — Deferred] API Gateway WebSocket API + `$connect` Lambda authorizer (reuses `@kitchensink/clerk-verify`; token via query param / `Sec-WebSocket-Protocol`; reject → `403`; mid-connection `exp` → close; FR-050 cache rules apply here) — `—` (FR-034, FR-041, FR-049, FR-050)
      **Deferred** — implement only if polling UX (US-8) proves insufficient.
      **Acceptance**: `$connect` without a valid token → `403`; with a valid token → connection + `sub` stored.

- [x] **T-186** **[CLOSED — WON'T DO as specified, superseded by feature 014, 2026-08-10]** WebSocket push on resolve — **NOT BUILT HERE.** The outcome (a requester learns their food resolved, and only the requesters do) is delivered by 014. Resolving recipients from `fetch_requesters` at completion time was never viable anyway: `FetchQueueDao.resolve` DELETES those rows in the same transaction that completes the food, so the read is a race by construction.
      ORIGINAL ENTRY: [S] [Test-first: false] [P3 — Deferred] WebSocket push on resolve — on `FoodFetchCompleted`, resolve recipients from `fetch_requesters` (`sub`→food `id` set), push `{type:"food_ready", id}`, no broadcast; clean up stale (410) connections — `—` (FR-034, FR-041)
      **Acceptance**: US-9 — a connected requester receives the push within 60s; non-requesting connections get
      nothing; stale connections are cleaned up.

---

## Phase 10 — E2E Harness + Migration Runner

- [x] **T-190** [M] [Test-first: false] E2E harness — booted food-service (real `FoodAuthGuard`, real minted RS256 JWT) + Docker Postgres + manually-driven `FoodConsumerService.drain()` with a programmable stub `FoodSourceAdapter`; scenarios add-by-name `202`→worker fan-out/merge→`200`, dedup, UNRESOLVED+candidates/PATCH-resolve, NOT_FOUND, FAILED+`FetchFailed`, batch partial, search (fuzzy/external_key/barcode crosswalk), backpressure `503`, `FoodFetchCompleted` emission — `packages/services/food-service/tests/e2e/foodsApi.e2e.test.ts` + `tests/support/{jwt,stub-source-adapter}.ts` (15 specs, FR-005, FR-011, FR-013, FR-014, FR-024, FR-MRG-1, FR-RES-2 — E2E). EventBridge completion captured via an in-memory `EventBus` (no real AWS); LocalStack not required by these flows.
      **(reuse/extend: foundation in place — `infra/localstack/docker-compose.yml` (`localstack:4.4.0` + `postgres:16`), `e2e-food` CI job, `test:e2e` script, `health.e2e.test.ts` boots the real Nest app + migrates Docker Postgres. Extend with the re-baselined id-keyed flows once Phases 3–6 land. Community tier — no auth token.)**
      **Acceptance**: `npm run test:e2e --workspace=packages/services/food-service` boots against Docker Postgres
      and the add-by-name → fan-out → resolve / dedup / candidates / batch / EventBridge scenarios pass; the
      `e2e-food` CI job is required on the food-service path. **Checkbox stays unticked until the new flows land.**

- [x] **T-191** [M] [Test-first: false] FU-MIGRATE — in-VPC migration-runner Lambda (mirrors identity-webhooks `migrate.ts`: VPC-attached, reaches private RDS, applies the Phase-1 ordered SQL against `kitchensink_food`, tracked in `schema_migrations`, invoked at deploy; wired to `FoodDbSecretArn`. SECRET-SHAPE: `food_app` secret holds only `{username,password}`, so host/port/dbname come from env `FOOD_DB_ENDPOINT/PORT/NAME`. esbuild → `dist-lambda/`, `FoodMigrationFunctionName` exported) — `packages/services/food-service/src/lambdas/migrate/` (ARCH-001)
      **(deferred to deploy/release-readiness per the 2026-06-20 decision; phases build against Docker Postgres
      until then.)**
      **Acceptance**: the runner applies the 003 migrations against `kitchensink_food` over the NAT-less private
      path; re-running is idempotent (tracked migrations skipped).

---

## Phase 11 — Performance & Availability

- [x] **T-195** [M] [Test-first: false] Performance / load tests for SC-001/003/004/005/007 — **MEASURED 2026-08-08.** Local-workstation numbers (production Docker image, local Postgres, 51,000 foods, 50 peak VUs) — NOT deployed guarantees:
      SC-001 read p95 **4.00ms** (budget 50ms) · SC-004 serve rate **90.49%** (>80%) · SC-005 throughput **94.30/s** (>1.39/s) · SC-007 search p95 **160ms** (200ms; one shape breached once at 205.56ms) · SC-003 drain claim @ depth 100 **7.00ms** (60ms). All PASS.
      **DSN-11 CONFIRMED and ESCALATED — see the new task below.** `FetchQueueDao.leaseNext`'s FR-043 demotion clause is a per-`sub` correlated `COUNT(*)` inside the `ORDER BY` of a `LIMIT 1 FOR UPDATE SKIP LOCKED`, so `LIMIT 1` cannot avoid evaluating it per candidate row: **541ms/claim at depth 1,000** (46–54s of SC-003's 60s budget in claim overhead alone) and **7.6–11s/claim at 10,000** (13–20 minutes to drain 100 items). Cause proven, not inferred: the `mixed` profile (nothing demoted) is as slow or slower than `adversarial` (all demoted), so the cost is the aggregate running AT ALL.
      **SC-003 as written is not breached** (conditioned on depth < 100). The finding is that **FR-046 permits a depth at which SC-003 is unachievable, and the boundary is between 100 and 1,000 rows** — far below DSN-11's assumed "acceptable below 10,000". The budget was NOT widened; the CI probe is red and that red is the flag.
      Also found: **SC-007 is at risk for 2-character queries** — `EXPLAIN` shows a Seq Scan on `food` (51,000 rows, 157.99ms, no index) because a 2-char pattern yields no complete trigram, so `ILIKE '%ch%'` cannot use `food_name_trgm_idx`. `query=chicken` is a BitmapOr over three GIN indexes at 19.8ms.
      **Acceptance**: MET — each SC threshold measured/reported under representative load with no source call; regressions fail CI (`_ci-heavy.yml`, opt-in tier, no `continue-on-error`); the drain/demotion perf test at the FR-046 10,000-row ceiling ran and **flagged DSN-11 rather than absorbing it**.

- [x] **T-196** [S] [Test-first: false] **[CLOSED — WON'T DO, owner ruling 2026-08-08]** Multi-AZ upgrade of the shared `kitchensink-data-{stage}` instance (SC-009) — `packages/infra/global/lib/platform/DataStack.ts` (SC-009, A-013)
      **Owner ruling (2026-08-08), recorded as the standing architecture, not a deferral:** _"one cluster, one
      AZ, one region for now. Sandbox and prod are all contained inside the one cluster. We will break that
      out and scale when we start making money."_ So this is not "deferred pending revisit" — single-AZ is the
      intended topology until revenue, and SC-009's Multi-AZ clause is **dispositioned-to-spec** rather than
      implemented. Cost was the deciding factor: +$35.6/mo measured (RDS rate ×2 plus mirrored gp2 storage) is
      ~12% of the $300 monthly budget guardrail for an availability property a pre-revenue product does not
      need.
      **Accepted risk, stated plainly:** an AZ failure takes down sandbox AND prod together, because they share
      the one instance. Recovery is restore-from-snapshot, so the exposure is bounded by the backup window, not
      by a failover. Nothing in the codebase pretends otherwise.
      **What re-opens it:** paying customers, or an availability commitment to anyone. At that point the change
      is `multiAz: true` in `DataStack.ts` plus a failover test plan, and it is platform-wide (identity + food + recipe), not a per-feature change.

---

## FR Coverage Audit (stabilized — all 71 FRs: 53 numbered + FR-025a/FR-028a/FR-043a/FR-043b + FR-IDN-1..3 + FR-RES-1..3 + FR-MRG-1..5 + FR-ADP-1..3)

| FR       | Covered By                                      | Status                                            |
| -------- | ----------------------------------------------- | ------------------------------------------------- |
| FR-IDN-1 | T-100, T-105, T-140                             | ✅                                                |
| FR-IDN-2 | T-121                                           | ✅                                                |
| FR-IDN-3 | T-100, T-101                                    | ✅                                                |
| FR-001   | T-130, T-131                                    | ✅                                                |
| FR-002   | T-105, T-131                                    | ✅                                                |
| FR-003   | T-131                                           | ✅                                                |
| FR-004   | T-131                                           | ✅                                                |
| FR-005   | T-105, T-140                                    | ✅                                                |
| FR-006   | T-131, T-140                                    | ✅                                                |
| FR-007   | T-132                                           | ✅                                                |
| FR-RES-1 | T-111, T-133                                    | ✅                                                |
| FR-RES-2 | T-111, T-142, T-163                             | ✅                                                |
| FR-RES-3 | T-142, T-162                                    | ✅                                                |
| FR-008   | T-104, T-106, T-134, T-180, T-204, T-205, T-208 | ✅                                                |
| FR-009   | T-134                                           | ✅                                                |
| FR-010   | T-104, T-134, T-204                             | ✅                                                |
| FR-011   | T-140, T-141                                    | ✅                                                |
| FR-012   | T-143, T-047                                    | ✅                                                |
| FR-013   | T-105, T-140                                    | ✅                                                |
| FR-014   | T-101, T-109, T-141                             | ✅                                                |
| FR-015   | T-104, T-109, T-151                             | ✅                                                |
| FR-016   | T-153, T-184                                    | ✅                                                |
| FR-017   | T-141, T-150                                    | ✅                                                |
| FR-018   | T-109, T-122, T-150, T-153                      | ✅                                                |
| FR-019   | T-002, T-110, T-122, T-152                      | ✅                                                |
| FR-020   | T-110, T-122                                    | ✅                                                |
| FR-021   | T-122                                           | ✅                                                |
| FR-022   | T-150                                           | ✅                                                |
| FR-023   | T-003, T-121, T-155                             | ✅                                                |
| FR-024   | T-121, T-154                                    | ✅                                                |
| FR-025   | T-002, T-105, T-140, T-153                      | ✅ (30d NOT_FOUND TTL → reactivation)             |
| FR-025a  | T-002, T-111, T-172                             | ✅ (UNRESOLVED candidate-set 30d expiry)          |
| FR-026   | T-122, T-153                                    | ✅                                                |
| FR-027   | T-153                                           | ✅                                                |
| FR-028   | T-100, T-101, T-102, T-105–T-108, T-111, T-161  | ✅                                                |
| FR-028a  | T-105, T-131, T-140, T-142, T-153               | ✅ (legal lifecycle transition set)               |
| FR-029   | T-104, T-108, T-161                             | ✅                                                |
| FR-030   | T-186 (deferred Redis variant) / in-proc LRU    | ⚠️ deferred (no Redis at launch; in-process only) |
| FR-031   | T-163, T-171                                    | ✅ (change-driven, not age-based)                 |
| FR-032   | T-001c, T-170, T-171                            | ✅                                                |
| FR-033   | T-131, T-132                                    | ✅                                                |
| FR-034   | T-165, T-185, T-186                             | ✅ (deferred)                                     |
| FR-MRG-1 | T-152, T-154, T-162                             | ✅                                                |
| FR-MRG-2 | T-120, T-160                                    | ✅                                                |
| FR-MRG-3 | T-107, T-160                                    | ✅                                                |
| FR-MRG-4 | T-120, T-152                                    | ✅                                                |
| FR-MRG-5 | T-111, T-162                                    | ✅ (auto-resolve survivor-count boundary)         |
| FR-ADP-1 | T-120, T-121, T-152                             | ✅                                                |
| FR-ADP-2 | T-121, T-164, T-171                             | ✅                                                |
| FR-ADP-3 | T-003, T-121, T-164                             | ✅                                                |
| FR-035   | T-033                                           | ✅                                                |
| FR-036   | T-033, T-046                                    | ✅                                                |
| FR-037   | T-033                                           | ✅                                                |
| FR-038   | T-033                                           | ✅                                                |
| FR-039   | T-048, T-145, T-184                             | ✅                                                |
| FR-040   | T-033                                           | ✅                                                |
| FR-041   | T-185, T-186                                    | ✅ (deferred)                                     |
| FR-042   | T-002, T-033                                    | ✅                                                |
| FR-043   | T-049, T-151                                    | ✅                                                |
| FR-043a  | T-049, T-151                                    | ✅ (multi-requester demotion)                     |
| FR-043b  | T-052, T-144                                    | ✅ (near-ceiling flood-shed, 503)                 |
| FR-044   | T-050, T-109, T-151                             | ✅                                                |
| FR-045   | T-051, T-143                                    | ✅                                                |
| FR-046   | T-052, T-144, T-183                             | ✅                                                |
| FR-047   | T-047, T-057                                    | ✅                                                |
| FR-048   | T-053, T-141                                    | ✅                                                |
| FR-049   | T-185                                           | ✅ (deferred)                                     |
| FR-050   | T-033, T-185                                    | ✅                                                |
| FR-051   | T-048, T-131, T-142                             | ✅                                                |
| FR-052   | T-054                                           | ✅                                                |
| FR-053   | T-033, T-046                                    | ✅                                                |

**Gap**: None. All functional requirements trace to ≥1 task. **FR-030** is intentionally not built as
ElastiCache Redis at launch (A-002) — the new architecture removes Redis; the cache-acceleration intent is met
by an optional in-process LRU (plan §6) and the deferred Redis variant rides with T-186/the limiter's deferred
sorted-set form.

**Success-criteria coverage:** SC-001/003/004/007 → T-195; SC-002 → T-110/T-122/T-181; SC-005 (local-store
serve/read throughput, no source call) → T-131/T-195; SC-006 → T-153/T-181/T-183; SC-008 → T-100/T-107;
SC-009 → T-054/T-196; SC-010 → T-033; SC-011 → T-054; SC-012 → T-049/T-151; SC-013 → T-100/T-108/T-161;
SC-014 (first-time NEW-food resolution rate ~500–900/hr, bounded by the source budget SC-002) → T-152/T-155.

**Test-first tasks (red-gate, 43):** T-003, T-033, T-047, T-048, T-049, T-050, T-051, T-052, T-054, T-100,
T-101, T-102, T-103, T-104, T-105, T-106, T-107, T-108, T-109, T-110, T-111, T-120, T-121, T-122, T-130, T-131,
T-133, T-134, T-140, T-141, T-142, T-143, T-144, T-151, T-152, T-153, T-160, T-161, T-162, T-163, T-171,
T-172, T-185.

---

## Follow-ups (carried from `.forge-status.yml`)

- **FU-MIGRATE** — in-VPC migration-runner Lambda → **T-191** ✅ done (built + tested on Docker Postgres; `FoodMigrationFunction` wired in the stack).
- **FU-INGREDIENTS** — `ingredients ↔ food(id)` is a **soft `food_id text` column owned by feature 001** (no cross-DB FK; app-layer validation). Not a 003 task.
- **FU-EVENTNAME** — **CLOSED (stabilization 2026-06-28):** the completion event is canonically **`FoodFetchCompleted`** (published via `publishFoodFetchCompleted`), matching plan §4 and the deployed CDK `FoodFetchCompletedRule` (`detailType: ['FoodFetchCompleted']`); all spec/plan/v-model/task references now use it (T-154/T-165). `FoodDataReceived`/`publishFoodDataReceived` are retired.
- **FU-ESBUILD** — esbuild bundling for the food Lambdas → ✅ done for the migrate Lambda (`esbuild.mjs` → `dist-lambda/`, `npm run bundle:lambda`, run by `infra:synth`/`infra:deploy`). Search-indexer T-180 shipped as a STORED generated column (no Lambda), so only the migrate handler is bundled. (Change-refresh moved to a Fargate scheduled task T-170 — D-REFRESH — so it no longer needs Lambda bundling.)
- **FU-LOCALSTACK-E2E** — E2E foundation in place (LocalStack Community + Docker Postgres); the re-baselined id-keyed AWS-service flows land with T-190 as Phases 3–6 complete.

### Escalated by T-195's measurements (2026-08-08)

- [x] **T-197** [M] [Test-first: true] **DSN-11 — DONE 2026-08-09, but NOT by materializing anything.** The fix was to move the FR-043 fairness term out of the `ORDER BY` and into a `WHERE` filter, so the claim's ordering matches the `idx_fetch_queue_priority` index that ALREADY existed and the scan early-terminates — `packages/services/food-service/src/foods/dao/fetchQueue.dao.ts` (FR-043, FR-046, SC-003)
      **Root cause restated:** the demotion rank was the LEADING sort key and was computed, so Postgres had to evaluate a correlated `COUNT(*)` for every eligible row before it could know which row sorted first. `LIMIT 1` could never avoid it. The index was not missing — the fairness clause was blocking it.
      **Measured LOCALLY (claim p95, 60ms budget):** depth 10,000 `mixed` **19,504.82ms → 8.53ms**; depth 1,000 **1,346ms → 3.79ms**; depth 100 5.79ms → 2.97ms. `adversarial` at the ceiling 10,964.78ms → 28.66ms. Buffer hits at the ceiling **27,840,438 → 443**.
      **⚠️ CORRECTION (2026-08-10) — "Both `_ci-heavy.yml` steps now PASS" was wrong.** That claim rested on the local numbers above and was never confirmed on a runner. On CI (run 31323016643) the **SC-003 contract gate (depth 100) PASSES** with ~12x headroom (4.78ms `mixed` / 2.64ms `adversarial`), and the **FR-046 ceiling probe FAILS on one series**: depth 1,000 `mixed` 3.98ms and `adversarial` 10.76ms pass, depth 10,000 `mixed` 16.73ms passes, depth 10,000 **`adversarial` 85.52ms vs the 60ms budget — a 1.43x breach**. CI hardware measures ~2.4-3x slower than the dev machine, which is exactly what turns 28.66ms into 85.52ms. The rewrite's ~128x win at the ceiling is real and stands; what is wrong is only the PASS claim. **SC-003 is still not breached** (it is conditioned on depth < 100, where the gate passes) — this is FR-046 ceiling headroom.
      **Therefore "NOT built, deliberately" below is RE-OPENED, on CI evidence rather than local.** The breaching series is the one where nothing is promoted, so the claim must examine all 10,000 eligible rows to prove the promoted tier empty before falling through — a query-SHAPE cost, not a missing index (`idx_fetch_queue_priority` is used). Closing it means making "the promoted tier is empty" a set-based or maintained determination. **Not** raising `FOOD_DRAIN_CLAIM_P95_MS`, and not adding `continue-on-error` to the probe. **Owner decision needed:** land that change, or accept a documented FR-046 ceiling limit and record why a 60ms budget derived from SC-003's depth-100 slot is the right bar to hold a depth-10,000 adversarial probe to. **→ CLOSED by T-201 (2026-08-10)**, by the set-based determination named here — see that entry. **→ And the parenthetical question ("why is a depth-100-derived budget the right bar at depth 10,000?") is ANSWERED by T-203 (2026-08-12), which T-201 had mooted rather than decided: the 60ms bar STAYS at every depth, because depth ≥ 1,000 is where both real defects surfaced while depth 100 kept 8–12× headroom. What was wrong was only its ATTRIBUTION — a breach above depth 100 is an FR-046/DSN-11 scaling breach, not an SC-003 breach — and the probe now says so.**
      The pre-fix numbers came out WORSE than T-195 reported (19.5s vs 7.6–11s), and `mixed` (nothing demoted) stayed slower than `adversarial` (all demoted) — re-confirming that the cost was the aggregate running AT ALL, not the demotions it found.
      **Three non-obvious findings, recorded so nobody "cleans them up":** (1) the exclusion must be an uncorrelated `NOT IN` over the CTE, which becomes a hashed SubPlan built ONCE per statement — the `NOT EXISTS` form re-plans an anti-join per row and measured 3× slower (108ms at the ceiling); it is NULL-safe only because `requester_id` is `NOT NULL`. (2) The two branches (promoted tier, then demoted fallback) live in ONE statement under `COALESCE`, which genuinely short-circuits (`InitPlan … never executed`), keeping the claim atomic on one snapshot. (3) The FR-018 lapsed-lease reclaim became its OWN statement, because an `OR` across two statuses forces a `BitmapOr` + full sort that destroys the index path.
      **Semantics proven, not asserted:** a differential harness ran the old and new rankings over 12 randomised queues sweeping the demotion regime (89→777 of 784 rows demoted, plus lapsed leases, backed-off rows, tombstones, requester-less foods) — **0 disagreements / 12 trials**. T-151's fairness suite passes with **every assertion unmodified**. Mutation-checked: deleting the demotion filter fails 5 tests, deleting the fallback branch fails 4.
      **NOT built, deliberately:** no materialized `demoted` column and no per-requester counter column — the per-claim CTE pass costs 5–9ms at the ceiling, so neither escalation is needed, and nothing new can silently drift.
      **Residual:** the win depends on the planner choosing a hashed SubPlan; if it ever declined, cost degrades to ~50ms, not to the old quadratic. Reap-on-claim now reverts ALL lapsed leases rather than stealing one at a time — same duplicate-work class as before, arriving sooner. `attempts` untouched throughout (DSN-5).

- [x] **T-201** [M] [Test-first: true] **DSN-11 closed — the promoted-tier emptiness is now determined from the AGGREGATE, not by walking the queue.** `packages/services/food-service/src/foods/dao/fetchQueue.dao.ts` (FR-043, FR-043a, FR-046, SC-003)
      **What T-197 left:** its rewrite fixed the general case but not the one where NOTHING is promoted. Early termination on `idx_fetch_queue_priority` is worth nothing when no row qualifies, so the promoted branch still had to examine every eligible row before it could conclude its tier was empty and fall through. CI measured `adversarial` @ depth 10,000 at **85.52ms p95 vs the 60ms budget**; the same query measured 28.66ms on the dev machine, which is the whole reason T-197's "no materialization needed" call did not survive contact with a runner.
      **The change:** `over_demand` is now DERIVED from a `demand` CTE that keeps each requester's `count(*) > threshold` boolean, and a third CTE `promoted_ready` asks — from that aggregate — whether any requester is under the threshold AND holds at least one eligible pending row, `LIMIT 1`. `CASE WHEN EXISTS (promoted_ready)` gates the promoted branch, so an empty promoted tier leaves it `never executed`. The probe is bounded by the DISTINCT-REQUESTER count, not by queue depth. The gate had to go in `CASE`, not in the branch's own `WHERE`: a qual is evaluated per row and would still walk the index.
      **Why not the maintained counter DSN-11 originally proposed:** it is a second representation of one number, which is precisely the T-199a split-brain (`8f6e1e7f`) by construction. Deriving both tiers from one `demand` CTE keeps `FOOD_DEMOTE_THRESHOLD` stated **exactly once** in the statement while still giving the probe something cheap to read. Accepted residual, stated not hidden: the claim is still linear in `fetch_requesters` ROWS (one aggregate must read them), and no longer linear in QUEUE DEPTH — which is the quantity FR-046 bounds and DSN-11 escalated.
      **Measured locally through the real DAO** (30 samples, before → after): `adversarial` @10,000 **41.70ms → 7.20ms**, @1,000 6.97ms → 4.03ms, @100 3.04ms → 2.94ms; `mixed` @10,000 8.86ms → 9.04ms (unchanged within spread). In-database timing without the client round trip: 33.21ms → 3.56ms, **40,457 → 1,439 shared buffer hits**. An earlier revision that ALSO swapped `NOT IN over_demand` for `IN under_demand` cost `mixed` ~30% (a 10,000-entry hashed SubPlan instead of 50) for no semantic gain and was rejected. **These numbers are not evidence about CI** (~3× slower); the `_ci-heavy.yml` ceiling probe is the only arbiter of the absolute figures.
      **Semantics proven, and this time the proof is COMMITTED.** T-197's differential harness was a throwaway script that never entered the repo, so its "0 disagreements / 12 trials" was unreproducible and protected nothing after the change that made it. `tests/drainClaimRankingDifferential.integration.test.ts` is that harness, committed: 12 seeded randomised queues (reproducible from the seed alone), each drained to empty TWICE — once through **FR-043 stated literally** (demotion as the leading sort key, correlated per-requester `COUNT(*)`, the shape the requirement describes) and once through the real DAO — asserting identical drain ORDER, not one claim. The oracle is the spec, deliberately not "the previous query", so a drift introduced at step N cannot be blessed by step N+1. Anti-vacuity: the corpus must cover the mixed regime, fairness must actually have reordered something, and a requester must land on EXACTLY the threshold. That last case was ADDED after measurement — without it, mutating `count(*) > threshold` to `>=` produced zero disagreements, i.e. the suite could not see an FR-043a off-by-one.
      **Mutation evidence.** Equivalence harness: forcing the gate false, `>` → `>=`, and `count(*) > 0` all produce disagreements; inverting the gate's `NOT` filter does NOT (it makes the gate more permissive, so the ranking is unchanged and only cost regresses — recorded, because it is why cost needs its own gate). Cost: `drainClaimScaling.integration.test.ts` now `EXPLAIN (ANALYZE, FORMAT JSON)`s the statement the DAO actually sent (captured from a Drizzle logger — never restated, or the copy becomes the thing that drifts) and asserts it pulls ≤ 10 tuples from `idx_fetch_queue_priority` at two depths when everything is demoted. Weakening the gate to `CASE WHEN true OR …` reds it with **201 tuples at depth 200 and 2,001 at depth 2,000**; reverting to the pre-T-201 query reds the capture step, which is the intended behaviour for a plan gate that cannot identify its statement. T-151's fairness suite passes with **every assertion unmodified** (26 integration files / 263 tests green).
      **Nothing was weakened to get here:** `FOOD_DRAIN_CLAIM_P95_MS` is untouched at 60, the ceiling probe has no `continue-on-error` and no `|| true`, and the `adversarial` fixture is unchanged.
      **CONFIRMED ON CI (run 31451860784)** — the arbiter, not the dev machine. Before → after, same runner class, budget p95 ≤ 60ms: depth 100 `mixed` 4.78 → 4.87ms and `adversarial` 2.64 → 2.65ms; depth 1,000 `mixed` 3.98 → 5.46ms and `adversarial` **10.76 → 3.91ms**; depth 10,000 `mixed` 16.73 → 16.59ms and `adversarial` **85.52 → 10.81ms**. The breaching series is **7.9× faster and now 5.6× inside the budget**; every series passes and DSN-11 is closed on CI evidence. Instructive detail: the local prediction was 7.20ms against CI's 10.81ms, so the ~3× hardware factor applies to the REMAINING per-claim aggregate as well — which is the whole reason the probe, not a workstation, is the contract.
      **⚠️ The `Load test (food — k6)` job is still RED, on a DIFFERENT and pre-existing failure** — SC-007's `narrow` (253.10ms) and `phrase` (206.29ms) shapes against the 200ms budget. That is T-202 below, not this task; the drain steps only produced numbers at all because they now carry `if: ${{ !cancelled() }}` (a search breach previously skipped them, so the run reported no drain measurement).
      **⚠️ SUPERSEDED AS A p95 REFERENCE (2026-08-12) — see T-203. The before → after above stands; the p95 column does not.** Run 31608073724 reported `mixed` @10,000 at **90.23ms p95** with the statement, its plan, its `never executed` branch and its buffer counts all unchanged. Its MEDIAN was 12.23ms — the second-fastest ever recorded for that series, and 22% faster than the 15.69ms of this confirming run. The cause was the probe's estimator plus runner stalls, not the query. The Stage-2 buffer figure is also corrected there: **328, not 1,439** (the 1,439 was measured on tables the k6 steps had bloated to ~5× the pages).

- [x] **T-202** [M] [Test-first: true] **SC-007 headroom — DONE 2026-08-11, by changing the ACCESS PATH rather than the statement.** `packages/services/food-service/src/db/migrations/0004_food_name_trgm_gist.sql` (SC-007, FR-008, FR-010)
      T-195's Finding 1 said to "treat SC-007 as AT RISK … and as unvalidated on deployed hardware". Measured, it is breached — but for different shapes than the one Finding 1 named (`short`, which T-198 fixed and which now measures 51.66ms on CI):
      | shape | workstation (3 runs) | CI 31323016643 | CI 31451273786 | CI 31451860784 |
      | `narrow` | 105.07 / 68.2 / 68.4ms | 196.73 ✓ | 258.74 ✗ | 253.10 ✗ |
      | `phrase` | 130.89 / 52.6 / 52.1ms | 152.41 ✓ | 185.20 ✓ | 206.29 ✗ |
      **This is a marginal budget, not a flake.** The distributions barely move (`narrow` avg 145.6 → 156.4 → 154.2ms); only the p95 tail crosses. `narrow` passed its first CI run by 1.7% and has failed both since; `phrase` has now crossed too. It is the SAME lesson DSN-11 taught: CI measures ~2.5–3.8× slower than the machine these budgets were validated on.
      **NOT attributable to T-197/T-201** — nothing in that work touches `FoodSearchDao`, the search indexes or the fixture, and the drain probe runs in its own process after the k6 scripts.
      **SUPERSEDED 2026-08-10 by owner ruling:** SC-007 is now 250ms p95 ±15% (gate 287.5ms), because the 200ms was validated on a workstation and CI measures 2.5-3.8x slower. The gate passes at that ceiling. This instruction originally read "Do NOT raise SEARCH_P95_MS — 200ms is SC-007 verbatim"; widening it changes the reported number, not the latency (the same rule that governs `FOOD_DRAIN_CLAIM_P95_MS`). The fix belongs in the search path. `narrow` is a 3-lexeme AND plus a long `ILIKE` pattern, so the cost is index intersection plus a per-row `GREATEST(ts_rank, similarity(…))` over every matched row before `LIMIT 20`. The candidate that changes NO semantics is to stop ranking rows that cannot reach the top 20. Per T-198, anything that changes which rows match (or their order) needs a product call, not a DAO edit.
      **Blast radius while open:** the `Load test (food — k6)` job is RED, so the whole heavy tier reports failure on a search regression rather than on anything else.
      **CLOSED 2026-08-11.** The recorded candidate was measured and is WRONG — ranking all 364 `narrow` matches down to 20 costs **0.14ms of a 45.8ms statement**. 66% of the statement is the `name % query` branch's ACCESS PATH, fixed by a GiST trigram index (migration `0004`); no SQL in the DAO changed, because an index cannot move a row or a rank. Local DB time on the fixture CI seeds, in CI's build order: `narrow` 45.8 → 14.6ms, `phrase` 44.4 → 11.1ms. Evidence, the rejected alternatives, the mutation results and two ESCALATED findings are in "T-202 — measured evidence" below.

- [x] **T-203** [S] [Test-first: false] **The drain probe's own p95 estimator — a 5.4× "regression" that did not exist. DONE 2026-08-12; NO SQL CHANGED.** `packages/services/food-service/tests/load/drainDemotion.perf.ts` (SC-003, FR-046, DSN-11)
      **Reported as:** `mixed` @10,000 at **90.23ms p95 vs the 60ms budget** (run 31608073724), a 5.4× regression against the 16.59ms T-201 was confirmed at, with `adversarial` unaffected — a signature that points squarely at the promoted branch T-201 added.
      **Actual cause: the measurement, not the query.** The MEDIAN of that series was **12.23ms**, the second-fastest ever recorded for it and 22% faster than the confirming run's 15.69ms. `mixed` @10,000 p50/p95 across five heavy runs on one branch: 15.69/16.59, 15.14/15.41, 16.58/18.01, 11.84/12.36, **12.23/90.23**. `EXPLAIN (ANALYZE, BUFFERS)` of the statement captured from the DAO shows the T-201 shape fully intact — `promoted_ready` gating, `never executed` branches, `idx_fetch_queue_priority` at `rows=1 loops=1` — and both committed gates pass unmodified.
      **Two mechanisms combined.** (1) `percentile()` is nearest-rank, so at n=30 the reported "p95" IS the second-largest sample and "p99" IS the maximum — which is why every table this probe ever printed had `p99 == max` in EVERY row. Two slow samples out of thirty therefore decided a contract verdict. (2) The runner intermittently stalls 30–170ms: the same run measured `adversarial` @1,000 at p50 3.55ms / p95 29.37ms, and run 31537195430 measured `mixed` @**100** at p50 2.31ms / p95 **56.51ms** — 94% of the budget at the depth where SC-003 binds, where the statement does ~2ms of work. **The estimator could red the SC-003 gate itself on noise.**
      **The fix is the estimator, and it widens nothing.** Sample default 30 → 300, so p95 is the 16th-largest observation (15 above it) and a burst of stalls no longer sets it while a genuine 5%-of-claims pathology still does. Cost at depth 10,000: sampling 0.35s → 3.0s per series against ~18s of seeding, so the two-profile run went 38.4s → 42.1s. `FOOD_DRAIN_CLAIM_P95_MS` is still 60, the fixture and profiles are unchanged, no `continue-on-error` was added, the depth-100 gate is untouched, and **no SQL was modified**. `percentile()` stays nearest-rank deliberately (a latency gate should assert on an observation that happened, not an interpolated value that did not); the `p99 == max` trap and the `n >= 10 × 100/(100−p)` resolution rule are now in its docstring.
      **Reporting corrected (this is what made the red misleading).** A breach above depth 100 now reads as an **FR-046-ceiling / DSN-11 SCALING** breach, not as "does NOT stay within the SC-003 backfill budget", and the depth-100 backlog arithmetic is no longer printed at deeper points — "draining a 100-item backlog … 15.0% of SC-003's 60s budget" at depth 10,000 is a category error twice over (the backlog there is 10,000 items, and enqueues are already 503-ing) and it is what sent a reader after an SC-003 emergency the spec does not describe. The breach message now leads with the host-stall signature and cites run 31537195430's `mixed` @100 as the example. Depth 100 keeps its existing wording: a breach there IS an SC-003 breach.
      **T-197's open owner question is hereby ANSWERED: the gate STAYS at every depth.** That entry asked whether to "accept a documented FR-046 ceiling limit and record why a 60ms budget derived from SC-003's depth-100 slot is the right bar to hold a depth-10,000 adversarial probe to"; T-201 mooted it by making the query fast rather than deciding it. **De-gating depth 10,000 was considered and REJECTED**, because depth ≥ 1,000 is where both real defects this probe has ever caught actually surfaced — T-195's O(depth × requesters) ranking (541ms @1,000, 7.6–11s @10,000) and T-197's O(depth) promoted-tier walk (85.52ms @10,000, reproducible run over run) — while the depth-100 gate kept 8–12× headroom throughout and would have caught neither. Downgrading the ceiling to reported-only would retire the only gate that has ever earned its keep in order to suppress a symptom whose cause is the estimator. The 60ms bar is depth-independent as ENGINEERING INTENT (the queue machinery must not be what sets the drain rate); only its attribution to SC-003 was depth-specific, and that is what was fixed.
      **Ruled out by measurement, not by argument:** this harness's own fixture churn (each series bulk-deletes and re-inserts tens of thousands of rows, so autovacuum racing the measurement was the plausible innocent explanation) — 300 samples either side of an explicit `VACUUM (ANALYZE)` moved p50 by 0.2–0.4ms and `autovacuum_count` never advanced. Reproduced locally instead: single samples of **62.63ms and 73.78ms** against 8–10ms medians, and two 300-sample runs of the identical fixture minutes apart returning p95 **32.28ms and 7.60ms**.
      **Also corrected:** T-201's "1,439 shared buffer hits" is **328** on a freshly-seeded fixture (311 of them the `demand` aggregate's two sequential scans). The 1,439 was measured against a database the k6 steps had already churned, i.e. tables bloated to ~5× the pages for the same rows. Nothing asserts on either figure — the scaling gate asserts index TUPLES, which bloat does not move.
      **And a misdiagnosis worth recording, because it is the tempting one:** the failure was first attributed to branch 1 (the promoted tier `adversarial` never enters, hence "mixed-only"). Measured, branch 1 is **1.547ms of an 8.889ms statement (~17%)**, and 1.521ms of that is building the 50-row hashed `over_demand` SubPlan once; the index scan is 0.003ms. The FR-043 `demand` aggregate is **81% of `mixed` and 97% of `adversarial`**, and the whole mixed/adversarial delta is that aggregate reading 30,000 vs 20,000 `fetch_requesters` rows (727 vs 311 buffers). The residual T-201 documented — linear in requester ROWS, not in queue depth — is therefore still the only real cost, and still not worth a maintained counter (T-199a split-brain).
      **OWNER RULED 2026-08-12, and it is NOT the re-measure design:** _"I think we have to account for and allow variations with plus/minus 15% on perf metrics."_ So a documented **±15% variance allowance** lands instead, as its own named constant (`CLAIM_P95_VARIANCE_ALLOWANCE`) deriving `EFFECTIVE_CEILING_MS = 60 × 1.15 = 69ms`. The 15% is deliberately NOT folded into the 60: the 60 must stay visibly derived from SC-003's arithmetic and the 15% must stay visibly an owner judgement about measurement noise, and a single `69` would lose both facts and read as a quietly raised budget. It is also not env-overridable — `FOOD_DRAIN_CLAIM_P95_MS` already exists for exploration, and a second loosening knob is a second way to lose the number. All three figures (measured p95, budget, allowance, ceiling) print on EVERY series, pass or fail, because a tolerance nobody can see in the output is indistinguishable from a raised threshold. Recorded in `spec.md` under SC-003 **and** cross-referenced from SC-007, whose 2026-08-10 ruling this generalizes.
      **⛔ The honest arithmetic, stated rather than papered over: ±15% would NOT have prevented the red that prompted it.** 60 × 1.15 = 69ms, and the failing run measured **90.23ms** — 50% over budget, not 15%. What removed the false red is the n=300 change above: the worst contaminated p95 measured at n=300 was **32.28ms**, comfortably inside 60ms, let alone 69ms. The allowance is a stated safety margin ON TOP of an honest estimator and never the mechanism that makes the estimator honest. A reader who conflates the two will misdiagnose the next occurrence.
      **Depth-100 consequence, decided and recorded (not buried):** the owner said "perf metrics" generally, so the allowance applies at EVERY depth **including depth 100**, which makes SC-003's effective claim allowance 69ms — **11.5% of the 600ms per-item slot rather than 10%**. That is a small but genuine loosening of a contract gate, so it is written into `spec.md` next to SC-003 itself. The alternative — hold depth 100 at a hard 60ms and apply ±15% only above it, where a breach is a scaling finding rather than a product-promise one — is flagged there for the owner as a defensible different call needing one more decision and no code beyond a depth predicate.
      **DEAD, and deliberately not built:** the re-measure-before-failing gate (on breach, re-measure once; fail only if it breaches again). It was the proposal the owner ruled against, so there is **no stub, no flag and no dormant code path** for it.
      **Residual, narrowed rather than closed:** n=300 makes p95 resolve the contracted quantity, and ±15% absorbs the ordinary run-to-run spread on top. What remains is that a contamination episode large enough to move the **16th-largest of 300** samples past 69ms would still red the job. That is now a deliberately accepted risk with a number on it, not an unexamined one.
      **What is NOT diagnosed, and is not claimed to be:** the source of the stalls on GitHub's runners — CPU steal versus IO contention — which cannot be told apart from inside the job. Established: the stalls exist, they are not the query, and they are not this fixture's vacuum state.

- [x] **T-198** [S] [Test-first: true] **SC-007 short-query index bypass** — a 2-char query yields no complete trigram, so the `ILIKE` branches Seq Scan 51,000 rows at ~158ms. Gate them behind `length(query) >= 3` (or enforce a minimum at the boundary) — `packages/services/food-service/src/foods/dao/foodSearch.dao.ts:48` (SC-007, FR-008, FR-010)
      This CHANGES SEARCH SEMANTICS (a 2-char query stops matching mid-word), so it needs a product call, not just a DAO edit.
      **Implemented 2026-08-09 as ROUTING, not gating** — a 1–2 char query is served by a second statement (word-initial prefix matching over the GIN index the schema ALREADY had), not refused. **No migration and no new index were needed.** Measured evidence, the semantic change, and the rejected alternatives are recorded in "T-198 — measured evidence" below.

- [x] **T-199** [S] [Test-first: true] **DONE 2026-08-09. Two defects T-195 found in shipped code, unrelated to perf — both turned out to be WIDER than described:**
      (a) `FOOD_DEMOTE_THRESHOLD` was not dead config, it was **split brain**. `AdmissionService` DID read it (with its own separate default); only `fetchQueue.dao.ts`'s drain-time demotion hardcoded `50`. So tuning the knob moved the API's near-ceiling flood-shed and left the worker's demotion at 50 — the two halves of FR-043 silently disagreeing, with `50` written in three places. Both consumers now resolve through ONE reader, `demoteThresholdFromEnv()`; the default and its validation live once, shared with the boot-time `EnvironmentSchema`. Adjacent bug fixed with it: `AdmissionService` coerced via a bare `Number(...)`, so `FOOD_DEMOTE_THRESHOLD=fifty` became `NaN`, every `pending > NaN` was `false`, and **the flood-shed was silently disabled**.
      (b) `FOOD_METRIC.localStoreServeRate` was not one missing call site — `FoodMetrics` was wired ONLY into the Fargate worker, so **the API emitted no EMF at all**. Now emitted from the golden-record read (`FoodsService.getFood`), before the status branch, so 200/202/404 each contribute exactly one observation. Unit `Percent` 100/0, one observation per read: CloudWatch's `Average` IS SC-004's serve-rate with no conversion, `SampleCount` is total reads, `Sum / 100` is the served-read count SC-005 is written in. A service-computed ratio is not even expressible — SC-004 spans a rolling 24h window no single task can see. Also charted on the T-182 dashboard (emitted makes it queryable; charted makes it observable). **No alarm, deliberately:** SC-004's ">80%" only holds once the store holds 5,000+ unique RESOLVED foods, so a cold prod store or any per-PR preview sits legitimately below it.
      **Still unemitted for the same root cause, NOT fixed here:** `FOOD_METRIC.sourceApiSuccessRate` and `FOOD_METRIC.auth401Rate`.
      (c) The unlinted tree was **51 errors across 16 files**, not two. The old glob (`src/**/*.ts` minus `*.test.ts`) excluded the whole `tests/` tree AND every co-located `src/**/__tests__/**` spec. Now `'src/**/*.ts' 'tests/**/*.ts'`; no rule loosened, no override added, no inline disable. `tests/load/*.load.js` stays unlinted — those run under k6's runtime, are outside the tsconfig `include`, and the typed parser rejects them; linting them needs a separate untyped config block plus k6 globals (follow-up, and they were equally unlinted before).

### Escalated by the GR-016 / GR-017 conformance sweep (2026-08-12)

> ⛔ **Food WAS the live proof that GR-015 and GR-016 are SEPARATE obligations.** It satisfied GR-015 in full — 6
> authored `*.schema.ts` files, a committed `@kitchensink/schema-food`, a derived `openapi.yaml` now **1,134 lines /
> 12 paths** (⚠️ re-measured 2026-08-12, correcting **922** from the day before; it is generated, so `wc -l` it) —
> and, as measured on **2026-08-11 and again on 2026-08-12**, it registered **ZERO**
> `ZodValidationPipe` and **ZERO** `createZodDto`: `FoodsController` took **`@Body() body: unknown`** and
> re-derived validation per method with `safeParse`. **A reviewer reading only the contract artifacts would see a
> conformant service.** That is why 17-a.5 is its own numbered obligation.
>
> ✅ **Read that paragraph in the PAST TENSE — corrected 2026-08-12.** Food now registers **4**
> `ZodValidationPipe` references and **4** `createZodDto` classes, all committed in `49a1df7f`. The example keeps
> its place because it is the **evidence for the rule**, not an open finding: the two obligations are separable, and
> food is how we know.
>
> ✅ **CONVERGENCE IS COMMITTED — corrected 2026-08-12.** This block previously read _"IN FLIGHT IN THE WORKING TREE
> (uncommitted) … a new **untracked** `src/foods/dto/foods.dto.ts`"_. It landed in **`49a1df7f`** ("feat(security):
> bind food's validation pipe, escape LIKE wildcards, gate future services"): `app.module.ts` binds
> `ZodValidationPipe` through `APP_PIPE`, and **`src/foods/dto/foods.dto.ts` is TRACKED** — `git ls-files` lists it
> with its own `__tests__/foods.dto.test.ts` beside it — and `foods.controller.ts` contains **no `safeParse`**.
> ⛔ **Do not re-do this work on the strength of the "uncommitted" wording**, and do not treat the DTO file as a
> stray artifact to clean up. Every claim below names what was measured so the next reader can re-measure rather
> than trust — and that is the lesson, not the numbers: a working-tree observation goes stale on the next commit.
>
> ⛔ **Do NOT touch `packages/clients/usda/src/schemas.ts` in this work.** Those boundary schemas are **correct**
> and are the portfolio's reference implementation for GR-015 §15-d.

- [ ] **T-204** [M] [Test-first: true] **Register `nestjs-zod`'s `ZodValidationPipe` and convert EVERY food route to `createZodDto`, deleting the per-method `safeParse`** — `packages/services/food-service/src/app.module.ts`, `src/foods/foods.controller.ts`, `src/foods/admin/foodsAdmin.controller.ts`, `src/foods/serviceErasure.controller.ts` (FR-008, FR-010, FR-035–FR-053, GR-016 §16-a, GR-017 §17-a.5)
      **The defect this closes, stated as measured:** with `@Body() body: unknown` plus hand-written per-method `safeParse`, validation failure had **no single path** — so a **wrong-typed field**, a **missing field** and an **unknown key** _all_ reported `{ error: 'Empty name' }`. Three distinct failures, one misleading message, and the parse living **inside** the method body where it is optional by construction and gets skipped on the next endpoint. `unknown` is not a validation strategy (GR-016 §16-a.4).
      **State RE-VERIFIED 2026-08-12, against the COMMITTED tree** (⚠️ correcting this line's earlier "uncommitted working tree / `foods.dto.ts` exists (untracked)" reading, which was accurate when taken and went stale at `49a1df7f`): `app.module.ts` binds `ZodValidationPipe` via `APP_PIPE`; **`src/foods/dto/foods.dto.ts` is tracked** and declares **4** `createZodDto` classes (`AddFoodBodyDto`, `BatchAddFoodBodyDto`, `ResolveFoodBodyDto`, `SearchFoodQueryDto`) over **4** `z.strictObject` schemas, with `__tests__/foods.dto.test.ts` beside it; `foods.controller.ts` has **zero** `safeParse` across its 8 routes (`GET search`, `POST /`, `POST batch`, `GET :id/status`, `GET :id/candidates`, `POST :id/refetch`, `PATCH :id`, `GET :id`). ✅ **The two controllers this line left "to verify" are CONFIRMED genuinely bodyless**: `foodsAdmin.controller.ts` has two `@Get` routes and no parameter decorator at all, and `serviceErasure.controller.ts`'s single `@Post('erasure')` takes only `@ServiceErasurePrincipal()` — the owner comes from the **verified token's bound claim, never a body or query value** — so there is no body for a DTO to wrap. ⚠️ **Still genuinely open**: the five `:id` routes narrow the path param with the controller's own `requireId(id)` rather than a zod ULID DTO, which is the remaining half of this task's "path params are the internal ULID" clause below.
      **⚠️ Bind `nestjs-zod`'s pipe, never Nest's own, and never to the bare class token.** Under Nest's built-in `ValidationPipe` a `createZodDto` DTO **validates nothing while looking correctly wired** — schema present, DTO referenced, route reads as validated, no input checked. Food's own `src/foods/dto/foods.dto.ts` header already documents this hazard for both wrong-pipe forms; identity shipped it live on `PATCH /users/me`.
      **⚠️ ONE mechanism only** (§16-a.2): no `class-validator` DTO is introduced, and no `safeParse` is left behind "as a belt and braces" — a second mechanism is a second error contract, and the whole point is that the parse **cannot** be skipped.
      **⛔ `z.strictObject()` on every mutating body** (GR-017 §17-c): `POST /`, `POST batch`, `POST :id/refetch`, `PATCH :id`. Plain `z.object()` **strips unknown keys silently**, so a client misspelling a field on `PATCH :id` (the resolve route) would get a `200` and a write that did not do what it was told.
      **⚠️ Path params are the internal food `id` (ULID), never a source key** — so `:id` is parsed as a ULID, not as a bare string, on every one of the five routes that takes it.
      **⛔ File placement:** `src/foods/dto/foods.dto.ts` and `src/foods/dto/serviceErasure.schema.ts` sit under a **`dto/` directory**, which §15.2 does not use — the contract is authored as `src/**/*.schema.ts` **beside the controller it serves**. Flagged rather than churned in this task: moving them changes the `contract:generate` input set and the `CONTRACT_HASH`, so it belongs in one deliberate move (T-206) with the regenerate-and-diff gate green either side.
      **Tests: unit AND integration, both required.** Unit: per-DTO accept/reject, and specifically that a **wrong-typed field**, a **missing field** and an **unknown key** now produce **three distinguishable** `400`s rather than one `'Empty name'`. Integration: post a **known-bad body to a REAL route** on a booted app and assert the `400` and its field name — ⚠️ **this is the ONLY thing that can observe the wrong-pipe failure**, so a unit test over the DTO in isolation does not discharge it (modelled on `packages/services/identity/tests/appValidation.test.ts`). Plus **e2e** (`tests/e2e/*.e2e.test.ts`, LocalStack + Docker Postgres) and **k6** — food is a deployable and owes all four tiers (§7.1, GR-017 §17-a.8); the existing SC-007 search budget must hold across the pipe change.

- [ ] **T-205** [M] [Test-first: true] **Storage-floor boundary-parity test with bidirectional mapping completeness** — `packages/services/food-service/src/foods/__tests__/storageCapacity.test.ts` (FR-008, FR-IDN-1..3, GR-016 §16-d, GR-017 §17-d)
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storageCapacity.ts`), and a `storageCapacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
      Lives **in the service** (never in `packages/schemas/food`, never in a wire schema) and imports **both** the Drizzle schema and the authored zod — **a test is not a wire schema**, so §16-d's ban on the _production_ coupling is not weakened; this is precisely the "assertion between two independently authored artifacts" §16-d asks for.
      **Derives** the enumeration of bounded columns from the Drizzle schema rather than typing it out, and asserts for each writing wire field that the zod **rejects** a value the column cannot hold: `name` / `description` lengths, the food-status enum domain (`RESOLVED` / `UNRESOLVED` / `NOT_FOUND` / pending), nutrient `numeric(p,s)` precision **and scale**, `item_version`, batch size, `requester_id` nullability, and any integer column against the `int4` ceiling **2,147,483,647**.
      **Mapping completeness asserted in BOTH directions**: every bounded column has an entry or an **explicit, reasoned exemption**, and every entry names a column that **exists**. ⚠️ Without the bidirectional check the test silently shrinks to the fields someone remembered and passes — the review-checklist failure with a green tick on it. A deliberately unmapped bounded column must **fail** the test, and an entry naming a nonexistent column must **fail** it too.
      **⛔ Asserted, never derived** — no zod generated from Drizzle, no storage type imported into a `*.schema.ts`.
      **⚠️ Nutrient precision is the live risk here**, not string length: a nutrient value that overflows `numeric(p,s)` raises `22003` at the `INSERT` — **a 500 where the contract owed a 400** — and food's write path is fed by USDA data whose magnitudes we do not control. The upstream boundary (`packages/clients/usda/src/schemas.ts`) is the **first** guard and stays exactly as it is; this test proves our **own** wire bound is no looser than our own column.
      **⚠️ Limitation, stated not papered over:** this proves the floor only for the columns it maps. Only the "every bounded column has an entry" direction can catch a **new** column, and only if the enumeration is derived. Derive it.
      **Tests:** unit (the parity assertions, both completeness directions) **AND** integration (a precision-overflowing nutrient and a ceiling+1 integer each posted to a real route yield `400`, not a failed `INSERT` surfacing as `500`).

- [ ] **T-206** [S] [Test-first: true] **Move food's wire schemas out of `dto/` to `*.schema.ts` beside their controllers, and re-verify all three drift gates** — `packages/services/food-service/src/foods/`, `turbo.json` (GR-015 §15-a.1/§15-c, GR-017 §17-a.2/§17-a.4, CODING_STANDARDS §15.2)
      **Depends on** T-204.
      §15.2 places the authored contract at `src/**/*.schema.ts` **beside the controller it serves**. Food currently has `src/foods/foods.schema.ts` (correct) alongside `src/foods/dto/foods.dto.ts` and `src/foods/dto/serviceErasure.schema.ts` (a `dto/` directory). Consolidate onto the `*.schema.ts` form; the `createZodDto` classes may live beside the zod they wrap, but the **zod** is the authored artifact and its location is what `contract:generate` reads.
      **Re-verify all three drift gates after the move — a file rename changes the input set, so every gate must be re-proven, not assumed:** **(1) Rebuild** — `turbo.json`'s `@kitchensink/schema-food#build` `$TURBO_ROOT$`-anchored **`inputs`** still cover every authored schema file. **(2) Correctness** — `npm run contract:verify` regenerates `packages/schemas/food` with **no diff**. **(3) Skew** — the `CONTRACT_HASH` boot assertion still fires: the service refuses to start on mismatch, **before** the HTTP listener binds.
      **⛔ NOT `dependsOn`** — `schema-food#build` `dependsOn` `food-service#build` must not be re-proposed; that edge closes the cycle `client → schema → service → client`. The generated files are committed, so ordering was never the requirement; content-hashed `inputs` are.
      **⛔ The schema package is a literal file COPY** (zod are runtime values and cannot be derived from themselves), and its **`openapi.yaml` is DERIVED** output for `oasdiff`/docs/integrators — **NEVER a codegen input**.
      **⚠️ Expect the `CONTRACT_HASH` to change** (the hash covers the service's schema sources), so `@kitchensink/food-service-client`'s existing `src/contractSkew.ts` guard and `src/__tests__/contractSkew.test.ts` must be re-run, not just re-compiled. That is the guard working, not a regression.
      **Tests:** unit (`src/__tests__/buildInputs.test.ts` covers every relocated file; a `main-boot-order` test asserts the hash check precedes `listen()`) **AND** integration (`scripts/contractDriftGate.mjs` clean on a fresh checkout and red on a hand-edited schema package; boot with a skewed hash binds no port).

- [ ] **T-207** [S] [Test-first: true] **Parse food's non-HTTP ingress against authored zod, with one rejection path and no retry of invalid payloads** — `packages/services/food-service/src/worker/`, `src/events/` (FR-043, FR-046, FR-MRG-1..5, GR-016 §16-b, GR-018 §18-a/§18-b/§18-d, GR-019)
      **Food's non-HTTP ingress, enumerated** (GR-016 §16-b requires the list, or an explicit "none"): (1) the **Fargate fan-out worker**'s claimed queue items (T-155/T-197/T-201); (2) the **`FoodFetchCompleted`** EventBridge consumer (FU-EVENTNAME); (3) the **change-driven refresh** scheduled task (T-170, D-REFRESH); (4) the **service-erasure** internal callback from identity's fan-out Lambda. Food has **no third-party webhook** — the USDA integration is **outbound polling** — so GR-018 §18-c's `2xx` inversion does **not** apply here.
      Each parses its payload against an authored zod **before it becomes work** — **including the scheduled refresh**, because "the payload is ours" is an assumption about a deploy that has already drifted once. Rejections take **ONE** path per ingress with the cause in a **`reason`** field; a shape failure and a credential failure are **equally invalid** and differ **only** in `reason`.
      **An invalid payload is NEVER retried** — record it and **complete** the item, or dead-letter it **once** with the `reason`, and alarm DLQ/queue depth. ⚠️ **This interacts with `attempts` and the lapsed-lease reclaim (DSN-5, T-197):** an **invalid** payload must **not** consume retry budget or be re-claimed, whereas a **transient** failure (USDA `5xx`, rate limit, DB timeout) is a **different** `reason` and legitimately retries. Conflating the two is the defect — it converts a producer's bug into sustained load against a rate-limited upstream and buries the signal that would have found it.
      **⛔ No sentinel identifiers, and no row for a rejected payload** (GR-019): an unresolvable `food_id` or `requester_id` is a **rejection**, never `'unknown'`/`''`/`0` — not in storage, not on a wire, not as a map key, and **not as a metrics dimension**, where it would fuse every unattributable fetch into one fictitious subject that cannot be told apart from a real id afterwards. ⚠️ `requester_id` is `NOT NULL` and T-197's `NOT IN` exclusion is **NULL-safe only because of that**, so a sentinel here would also silently change queue-ranking semantics.
      **Tests:** unit (each envelope zod rejects every malformed variant; the rejection shape differs only in `reason`; an unresolvable id rejects rather than defaults; `attempts` is untouched on an invalid payload) **AND** integration (an **invalid** payload is asserted **not** re-claimed or redriven and its per-`reason` counter increments, while a **transient** failure **is** retried, **and** a valid payload still succeeds — all three, or the suite passes on a handler that never fails).

- [ ] **T-208** [S] [Test-first: true] **Confirm the food client's consumer half, and record the USDA boundary as the §15-d OPPOSITE case** — `packages/clients/food-service/src/`, `packages/clients/usda/src/schemas.ts` (read-only) (FR-008, GR-015 §15-b/§15-d, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.1–§17-b.6, §17-f)
      **The consumer half is largely LANDED and this task is its standing guard, not a rewrite.** Verified 2026-08-12: `packages/clients/food-service/src/contractSkew.ts` exists with `src/__tests__/contractSkew.test.ts` and an `src/__integration__/contractSkew.integration.test.ts`, and the client validates responses on receipt.
      Confirm and keep: the client imports wire **types and runtime zod** from `@kitchensink/schema-food` and declares **no** wire shape of its own (its `types.ts` holds only config, options and its own error shapes — **including type-only** declarations); **every response is parsed the moment it arrives**; **every outbound body is validated against `@kitchensink/schema-food`'s zod before the call**, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. The **recipe → food** edge (`@kitchensink/food-service-client`, the ingredient/catalog reads) is named in GR-016 §16-c.4 so it is not treated as internal-and-therefore-trusted.
      **⛔ Do NOT add server-side response validation** — GR-016 §16-g **defers** a producing service parsing what it **emits**; that is an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f). Conflating the two is how contributors either skip the required half or add the forbidden one.
      **⛔ USDA is the OPPOSITE case, and this is the record that says so.** USDA FoodData Central is an API the platform does **not** serve: there is no service of ours to own its types and its contract can change without telling us. `packages/clients/usda` **validates the raw upstream wire shape at the boundary with zod**, **MAY declare its own types**, deliberately returns a **normalized** type that differs from the raw shape, and **gets NO OpenAPI document**. Rules 17-b.1–17-b.5 do **not** apply to it.
      **⛔ `packages/clients/usda/src/schemas.ts` must NEVER be "converged" under GR-015 §15-b — it is the portfolio's REFERENCE IMPLEMENTATION.** Deleting or merging those schemas replaces a **checked parse** of a remote party's JSON with **unchecked trust**, on the pipeline that is the single writer of every nutrient value in the food database. That is a **security and correctness regression, not a cleanup**, and this task adds **no** change to that file — it exists so a contributor applying §15-b mechanically is stopped before deleting a boundary.
      **Tests:** unit (a response with a missing, renamed and wrong-typed field each raise the typed parse error; an invalid outbound body is rejected **before** any fetch; `contractSkew.test.ts` reports a skewed hash and names both hashes without overclaiming) **AND** integration (`src/__integration__/` against a booted food service; recorded real USDA payloads parse clean at the boundary and a mutated one is rejected there) — ⚠️ plus a `git ls-files`-based assertion that **no** file in `packages/clients/food-service` or any consuming app declares a food wire shape, and that `packages/clients/usda/src/schemas.ts` is **excluded by an explicit, reasoned allowlist** rather than by silence (AC-017-b).

### T-202 — measured evidence (2026-08-11)

Implemented as a **new ACCESS PATH** — `food_name_trgm_gist_idx`, migration `0004` — and **not one character
of `FoodSearchDao` SQL changed**. Postgres 16 (Docker, local, a throwaway container on port 55433), 50,000
`RESOLVED` foods, warm cache, `EXPLAIN (ANALYZE, BUFFERS)`, best of seven. Measured on TWO fixture shapes: the
one CI seeds (`preparePerfFixture.ts`, verbose descriptions) and a production-shaped copy of it
(`description = name`, which is what both USDA ingestion paths write — `usda.adapter.ts:290`,
`usdaBulk.parser.ts:165`).

**The recorded candidate was wrong, and measuring it is what found the real cost.** `narrow` matches 364 rows,
and ranking them down to 20 is a top-N heapsort costing **0.14ms of a 45.8ms statement**. It is also not
implementable: a `name %` match scores ≥ 0.3 while an FTS-only match scores ~0.06, so the expensive branch
supplies most of the top 20 — you cannot know which rows reach the limit without scoring all of them.

| part of the statement (`raw chicken breast`)        | cost       | share |
| --------------------------------------------------- | ---------- | ----- |
| `name % query` — index scan + recheck of 9,754 rows | **30.5ms** | 66%   |
| `description ILIKE` — index scan + recheck          | 6.1ms      | 13%   |
| FTS + `name ILIKE` — index scans + recheck          | 2.4ms      | 5%    |
| ranking all 364 matches down to 20                  | **0.14ms** | 0.3%  |

`food_name_trgm_idx` (GIN) answers `name % 'raw chicken breast'` by admitting every row sharing
`ceil(0.3 × n_query_trigrams)` trigrams — **9,758 candidates for 368 true matches** — and the bitmap heap scan
then re-evaluates the predicate (a fresh `similarity()`, measured at **2.19µs**) on the 9,754 it discards,
touching all 4,250 heap blocks of the table. A **GiST** trigram index over the same column answers the same
operator with 368 candidates: that branch drops 30.5ms → 8.0ms.

Local DB time on the fixture CI seeds. Two "after" columns because the index's packing depends on WHEN it is
built: CI applies this migration BEFORE the seed, so the index is grown by the bulk INSERT; a later
`CREATE INDEX` packs it better. The CI-order column is the honest one for the gate.

| shape (local DB time, the fixture CI seeds) | before  | after (CI order) | after (index built last) |
| ------------------------------------------- | ------- | ---------------- | ------------------------ |
| `narrow` (`raw chicken breast`)             | 45.76ms | 14.56ms          | 12.35ms                  |
| `phrase` (`raw chicken`)                    | 44.43ms | 11.14ms          | 9.85ms                   |
| `broad` (`chicken`)                         | 17.65ms | 15.04ms          | 13.20ms                  |
| `brand` (`northvale`)                       | 11.48ms | 19.53ms          | 16.94ms                  |
| `miss` (`zqxjkvwf0`)                        | 0.12ms  | 6.68ms           | 4.93ms                   |
| `barcode`                                   | 1.14ms  | —                | 4.04ms                   |

**`brand`/`miss`/`barcode` regress in relative terms, deliberately.** GiST scans its whole index whatever the
needle, so this trades a cost that tracked pattern length (0.12–45.8ms) for a flat 7–20ms band. For a **p95**
gate that is the better property — it caps the tail — and the worst shape drops from 45.8ms to 19.5ms while
every regressed shape stays 14–43× inside the 287.5ms ceiling. The GIN index is KEPT: it is the better answer
for the `ILIKE '%q%'` branches, which GiST can only serve by scanning its whole index. The planner picks per
branch, so the two are complements — do not "consolidate" them.

**Why this cannot change a result, proved rather than asserted.** `%` is rechecked from the heap (`Recheck
Cond` appears in every plan), so no index — precise or lossy — can change which rows match or their order. The
`(id, name, score)` sequence of the statement the DAO **actually sends** (captured from a Drizzle logger, never
restated) was compared against a pure Seq Scan with `enable_indexscan`, `enable_bitmapscan` and
`enable_indexonlyscan` all off, over **932 probes** — every k6 shape's full vocabulary cross-product plus
typos, mid-word substrings, stopwords, LIKE metacharacters, case variants, reversed word order, a 300-character
needle — on both fixtures. **932/932 identical, both shapes.** 19 of those probes are pinned per-PR by
`tests/foodSearchAccessPath.integration.test.ts` in the `integration-food` tier.

**CI-MEASURED, before and after** — the only arbiter of this gate, since this workstation runs ~4.4× faster.
Both runs are the same 50-VU profile against the same 50,000-food fixture on GitHub-hosted runners; before =
run 31454689817 (job 93666141627, the last green run on the old access path), after = run 31459435996 (job
93680080158).

| shape                          | p95 before | p95 after   | p99 before | p99 after | max before | max after |
| ------------------------------ | ---------- | ----------- | ---------- | --------- | ---------- | --------- |
| `narrow`                       | 209.90ms   | **42.42ms** | 253.69ms   | 45.82ms   | 294.94ms   | 47.45ms   |
| `phrase`                       | 158.39ms   | **29.42ms** | 222.23ms   | 32.60ms   | 256.04ms   | 52.69ms   |
| `broad`                        | 71.78ms    | 35.18ms     | 114.56ms   | 38.56ms   | 138.24ms   | 66.81ms   |
| `brand`                        | 64.23ms    | 43.95ms     | 83.72ms    | 47.86ms   | 135.11ms   | 58.82ms   |
| `short`                        | 44.46ms    | 44.70ms     | 87.06ms    | 66.88ms   | 121.56ms   | 81.22ms   |
| `miss`                         | 6.53ms     | 18.64ms     | 9.91ms     | 21.16ms   | 22.68ms    | 43.14ms   |
| `barcode`                      | 11.45ms    | 16.36ms     | 15.62ms    | 18.81ms   | 23.60ms    | 26.75ms   |
| **aggregate (the SC-007 p95)** | 154.33ms   | **39.81ms** | 207.87ms   | 46.44ms   | 294.94ms   | 81.22ms   |

**Headroom against the 287.5ms ceiling went from 1.37× to 6.4×.** The gated quantity is the worst shape, and
that is now `short` at 44.70ms rather than `narrow` at 209.90ms — a **4.7× improvement in the number the gate
actually tests**. The tail moved even more than the p95: `narrow`'s max was **294.94ms, ABOVE the ceiling**
(only p95 is asserted, so it passed), and is now 47.45ms.

Two things the local measurements got wrong, both in the same direction:

- **`brand` did not regress on CI, it improved 64.23 → 43.95ms**, where locally it went 11.5 → 19.5ms. At 50
  VUs the runner is partly contention-bound, so cutting total CPU across the rotation helps every shape —
  including the ones whose isolated cost rose. `miss` (6.5 → 18.6ms) and `barcode` (11.5 → 16.4ms) did regress
  as predicted, and are 15× and 18× inside the ceiling.
- **The whole suite now lands in a 16–45ms band** (was 6.5–210ms), which is the flat-tail property the GiST
  trade was chosen for, measured end to end rather than argued.

**Two removals rejected, both measured:**

- **`name % query` is NOT dead work.** T-198's finding 4 ("contributes nothing at ANY length") was measured
  with single-WORD needles against long names; a multi-word needle IS a large fraction of the name, so its
  similarity clears the 0.3 threshold easily. For `narrow` this branch carries **335 of the 364 matched rows
  on its own**. Removing it changes which rows match — a product decision (T-198), not a DAO edit.
- **`description ILIKE` matched 0 rows that `name ILIKE` did not** on either fixture, and is worth 6.1ms — but
  that redundancy holds only because both ingestion paths set `description := name`, an invariant of the
  WRITERS and not of the schema. `name ILIKE p OR (description IS DISTINCT FROM name AND description ILIKE p)`
  is provably equivalent for all data and was built and measured: **no faster**, because it does not let the
  planner skip the index scan.

**A UNION rewrite was built and rejected on measurement.** Replacing the four-way `OR` with a `UNION` of four
single-predicate branches joined back by id is provably set-equivalent (verified row-for-row) and does force
per-branch index use, but it loses the BitmapOr's shared heap access: `narrow` 32.3ms (vs 12.4ms), `broad`
25.9ms (vs 13.2ms), `brand` 26.4ms (vs 16.9ms).

**A query-plan cost gate was written, measured and REMOVED** — the reasoning lives in the new suite's docblock
so nobody re-adds it. This statement's natural plan genuinely flips with table size and name diversity
(Seq-Scan-and-filter at 6,000 rows, trigram BitmapOr at 12,000, Seq Scan again at 25,000, BitmapOr at 50,000),
and forcing the planner does not restore discrimination: `enable_seqscan = off` buys a full `Index Scan` with
the whole `OR` in `Filter`, so the wasted-recheck metric reads **25.20× at 6,000 rows and 25.24× at 18,000 —
identical with and without the new index**; adding `enable_indexscan = off` buys a bitmap scan over
`food_status_idx`, which matches every `RESOLVED` row, and the `%` predicate lands in `Filter` again. A gate
that must disable four access paths to see the one it cares about is asserting the planner's arithmetic.
`drainClaimScaling.integration.test.ts` can assert a plan because its statement has ONE sane plan at every
depth; this one does not. The latency contract stays with `search.load.js`.

**Mutation-verified — every guard broken on purpose and the failure observed.** Migration switched to GIN: 1
integration failure. GiST made to REPLACE the GIN index: 1. Migration `0004` deleted: 1. `name % query`
dropped from the DAO: **20** integration failures, the statement-identification guard firing first and loudly
rather than silently proving the prefix statement equivalent to itself. `description ILIKE` dropped: 3 **unit**
failures (the T-198a statement-shape tier — the integration equivalence gate correctly does NOT catch it,
since it compares ONE statement under two access paths). Probe set reduced to `ILIKE`-only needles: 1. The
pass also found a REAL GAP and closed it: `ORDER BY score DESC, name ASC` was pinned only for the short/prefix
statement, so dropping `name ASC` from the **relevance** statement was green in every tier — an
access-path-dependent row order, on the exact statement whose access path this task changed, while
`FoodCatalogGateway` re-sorts hits on precisely `score DESC, name ASC`. Now pinned in the unit tier; the
mutation reds it.

**ESCALATED, not fixed here — two findings bigger than T-202, each needing an owner call.** Both are also
recorded as Finding 4 in `tests/load/README.md`.

1. **`similarity()` and the `%` operator's `similarity_op` both carry Postgres' DEFAULT `procost` of 1**, while
   a call measures **2.19µs** — about 100× a simple operator. The planner therefore does not know that "Seq
   Scan and filter" means one `similarity()` per row, and on a **production-shaped** 50,000-food store it picks
   exactly that: `narrow` measures **145.4ms** locally, 3× what this fixture produces, and the new GiST index
   buys nothing there because it is never chosen. `ALTER FUNCTION similarity(text, text) COST 100` plus the
   same for `similarity_op` flips it to the GiST bitmap plan and is **strictly better on every shape**:
   `narrow` 145.4 → 15.6ms, `phrase` 128.1 → 11.5ms, `broad` 118.8 → 15.0ms, `brand` 124.6 → 17.4ms, `miss`
   119.8 → 6.5ms. Not shipped because `ALTER FUNCTION` needs ownership of a pg_trgm-owned function (the in-VPC
   migration runner only needs `CREATE EXTENSION IF NOT EXISTS` today, so a privilege failure there breaks
   EVERY migration), because it changes plans for every query in the database, and because
   `ALTER EXTENSION pg_trgm UPDATE` silently resets it. This is an ADR-shaped decision.
2. **The k6 perf fixture is not production-shaped, and that is what hides (1).** `perfFoodDescription` writes
   verbose prose, justified in its docblock as keeping the indexes "as large as the deployed store". The
   justification is inverted: production sets `description := name`, so the deployed
   `food_description_trgm_idx` indexes the name's trigrams and `search_vector` indexes the name's words twice.
   The prose makes `food` ~6× larger in pages, which makes a Seq Scan look expensive and pushes the planner
   onto the BitmapOr — the fixture accidentally gets the GOOD plan. Correcting it would make the reported CI
   numbers WORSE until (1) is fixed, which is why this is one finding and not two tickets.

### T-198 — measured evidence (2026-08-09)

Implemented as **routing by query length** in `FoodSearchDao.selectSearchStrategy`, not as the `length(query) >= 3`
gate the ticket proposed: a 1–2 character query is not refused, it is served by a second statement —
word-initial prefix matching, `search_vector @@ to_tsquery('simple', '<token>:*')`, over the **existing**
`food_search_vector_idx`. 3+ characters keep the previous statement byte for byte.

Postgres 16 (Docker, local, database `food_it_198`), 50,000 `RESOLVED` foods, warm cache,
`EXPLAIN (ANALYZE, BUFFERS)`, best of three. `name`/`description` shaped the way production writes them —
both USDA ingestion paths set `description := name` (`usda.adapter.ts:290`, `usdaBulk.parser.ts:165`).

| query             | chars        | BEFORE                         | AFTER                                                   | change  |
| ----------------- | ------------ | ------------------------------ | ------------------------------------------------------- | ------- |
| `b`               | 1            | Seq Scan · **156.5ms**         | Bitmap Index Scan `food_search_vector_idx` · **13.6ms** | 11.5×   |
| `c`               | 1            | Parallel Seq Scan · **87.5ms** | Bitmap Index Scan · **15.1ms**                          | 5.8×    |
| `a`               | 1 (stopword) | Parallel Seq Scan · **95.4ms** | Bitmap Index Scan · **5.5ms**                           | 17×     |
| `s`               | 1            | Parallel Seq Scan · **85.2ms** | Bitmap Index Scan · **12.9ms**                          | 6.6×    |
| `ch`              | 2            | Seq Scan · **134.2ms**         | Bitmap Index Scan · **6.2ms**                           | 21.6×   |
| `qu`              | 2            | Seq Scan · **127.3ms**         | Bitmap Index Scan · **5.4ms**                           | 23×     |
| `be`              | 2 (stopword) | Seq Scan · **125.8ms**         | Bitmap Index Scan · **3.9ms**                           | 32×     |
| `on`              | 2 (stopword) | Seq Scan · **130.9ms**         | Bitmap Index Scan · **0.06ms**                          | ~2,400× |
| `zq`              | 2 (no match) | Seq Scan · **119.8ms**         | Bitmap Index Scan · **0.05ms**                          | ~2,500× |
| `chicken`         | 7            | Bitmap Heap Scan · **15.6ms**  | _unchanged — same statement_                            | —       |
| `grilled chicken` | 15           | Bitmap Heap Scan · **41.6ms**  | _unchanged — same statement_                            | —       |

Worst case over all 26 single letters, on the more pessimistic T-195 fixture shape (verbose descriptions):
**32.6ms** (`m`, which word-initially matches all 50,000 rows there), against SC-007's 200ms p95 — 6.1×
headroom, in family with the other shapes' 8–35× instead of the ~1.3× the `short` shape had. End-to-end
through the shipped DAO (wall clock, including round trip): `b` 8.7ms, `c` 9.3ms, `ch` 4.0ms,
`chicken` 16.8ms.

**Four causes, all reproduced on real data — the ticket named only the first.**

1. `ILIKE '%ch%'` cannot use a trigram index below 3 characters (as stated).
2. The FTS branch is **also dead** at 1–2 characters, for an unrelated reason: `plainto_tsquery('english', …)`
   is exact-lexeme-after-stemming, so `ch` never matches `chicken`. Measured 0 rows for every 1–2 char query.
3. **Stopword trap confirmed.** `plainto_tsquery('english', 'be'|'a'|'on'|'it'|'is')` is EMPTY, and so is
   `to_tsquery('english', 'be:*')` — which is why the new statement uses the **`simple`** config. Prefix
   matching compares stored lexeme text, so `simple` still matches the `english`-stemmed stored vector
   (verified: `be:*` → `Beef`) while not discarding the needle as a stopword.
4. **`name % query` contributes nothing at ANY length** on realistic names: max `similarity()` was 0.25 for
   `chicken` against a 45-char name, below the 0.3 threshold, and 0.03–0.06 at 1–2 chars — where it was the
   only thing feeding the score. Left in place (≥3 chars is unchanged by mandate).

**Why no migration: the index the ticket assumed is not needed, and its design is measurably wrong.** A
left-anchored `lower(name) text_pattern_ops` btree prefix index was built and measured — genuinely ~100×
faster (0.14ms, index-ordered early termination) but it matches **name-initially only**, and on the 50,000-food
fixture `ch` returned **0 rows** through it (fixture names begin with the preparation word) where the shipped
query returns 8,695. It would miss the canonical `eg` → `Large egg` case. A name-only `tsvector` column + GIN
index was also built and measured (worst case 32.6ms → 17.1ms), then **rejected as redundant**: production
sets `description := name`, so `search_vector` already indexes only the name's words. Note also that ordering
by `lower(name)` needs a `COLLATE "C"` sort key to be index-ordered at all — plain `ORDER BY name` sorted
14,286 rows at 10.7ms — so the btree route is not the cheap win it appears to be.

**The semantic change (the product call), stated exactly.** A 1–2 character query used to match **mid-word**
and rank by trigram noise; it now matches **word-initially**. Queries that used to return rows and now return
none: `ic` (matched `Chicken`, `Rice`), `an` (`Ranch`, `Banana`), `on` (`Salmon` — 9,720 rows on the fixture),
`ee` (`Beef`, `Cheese`), and any 1–2 character needle occurring only inside a word. Gained: `eg` now finds
`Large egg`, and `be`/`a`/`on`/`it`/`is` work at all. Ranking is name-initial first, then shortest name, then
`name`; the score **encodes** that order, because `FoodCatalogGateway` in the recipe service re-sorts hits by
`score DESC, name ASC` and would otherwise discard it.

Tests: `src/foods/dao/__tests__/foodSearch.dao.test.ts` (34 unit — the pure routing/sanitisation) and the
`word-initial prefix path` block in `tests/foodSearch.dao.integration.test.ts` (real Postgres).
Mutation-verified: flipping `simple`→`english`, dropping the metacharacter whitelist, moving the length
threshold, dropping `:*`, and removing either ranking term each fail ≥1 test. There is deliberately **no
query-plan assertion** — see the comment in the integration file for why one was written, measured and
removed (forcing the planner does not discriminate, and natural plan choice is cost-model noise below
production scale).

### T-198a — closing the regression hole T-198 left (2026-08-09)

T-198 proved the fix but left the GUARD in the wrong place: the only thing holding short-query latency was the
k6 `short` shape, and `load-test-food` is **HEAVY-TIER** (`heavy-e2e` label, the 07:00 UTC nightly, or manual
dispatch), so an ordinary PR could revert the routing behind green checks. Two changes, no production code
touched:

**1. The `SEARCH_SHORT_P95_MS` exemption is DELETED.** It defaulted to `SEARCH_P95_MS` (200ms), so it never
loosened anything by itself — but it was a knob whose only possible use was to raise the `short` shape above
the success criterion it is named after, and the finding that justified it no longer exists. All seven shapes
now read `SEARCH_P95_MS`, and the threshold loop in `search.load.js` is uniform so a per-shape exemption
cannot be reintroduced invisibly. **Per-shape attribution is unchanged** — it comes from the `{shape:…}`
threshold tag, never from a per-shape constant. The budget stays at exactly SC-007's **200ms**, not a tighter
round number: the measured DB-side worst case is 32.6ms, but the endpoint is three queries behind a
signature verification on a 512-CPU-unit Fargate task, and inventing a budget the spec does not state would
manufacture flake instead of catching regressions.

**2. The load-bearing guards moved to the tiers that run UNLABELLED** — `unit` and `integration-food` in
`_ci.yml`, both on every PR:

- **Routing** (`selectSearchStrategy`, pure, no DB) — the "can't happen" layer. Length 0 / 1 / 2 / 3 / long,
  whitespace-only, punctuation-only, astral-character counting, and the metacharacter whitelist.
- **Statement shape** (NEW, unit tier) — `FoodSearchDao.search` runs against a fake client that renders the
  executed SQL through drizzle's `PgDialect`, exactly as the `pg` driver receives it. A 1–2 character query
  must carry `to_tsquery('simple', $n::text)` and must contain **none** of `ILIKE` / `name %` /
  `similarity(` / `plainto_tsquery`, and must bind no `%q%` pattern; a 3+ character query must carry all of
  them and none of the prefix form. Also pinned: exactly ONE statement per call, `status = 'RESOLVED'`, and
  the `LIMIT` (a single letter is word-initial across most of a real catalogue, so an unbounded prefix
  statement is an SC-007 breach by itself). This is the layer the pure routing test cannot cover: the
  selector can be correct while `search` ignores what it selected.
- **Behaviour** (integration tier, real Postgres) — the semantic contract pinned in BOTH directions: the
  queries that must now match (`eg` → `Large egg`, and the five stopwords) and the ones that must now return
  nothing (`ic`, `ee`, `an` for `Ranch`, `on` for `Salmon`). Plus: only `RESOLVED` rows surface even when
  PENDING/UNRESOLVED/NOT_FOUND/FAILED rows carry a matching name, the FR-010 cap holds at 25 candidates, and
  every token the whitelist ADMITS is a tsquery Postgres will parse (a bare digit, a non-ASCII letter, and
  both cases of it) — the mirror of the existing "metacharacters do not throw" cases, which only prove the
  characters it REMOVES are safe.

**Still deliberately NOT added: a query-plan assertion.** T-198's reasons stand and are recorded in the
integration file — forcing `enable_seqscan=off` does not discriminate (`food_status_idx` lets the OLD
statement avoid a Seq Scan too), and natural plan choice is cost-model noise below production scale (the same
statement chose different plans at 3k/6k/12k/25k/50k rows).

**Mutation-verified — every guard was broken on purpose and the failure observed.** Reverting the dispatch to
one statement: 9 unit + 3 integration failures. Threshold `2 → 1`: 31 unit + 3 integration. `simple` →
`english` in the SQL: 4 unit + 6 integration. Dropping `:*`: 16 unit + 12 integration. Removing the
whitelist: 25 unit + 12 integration. Removing the prefix statement's `LIMIT`: 2 unit + 1 integration.
Removing its `RESOLVED` filter: 1 unit + 1 integration. OR-ing an `ILIKE` branch back in (a partial revert):
3 unit + 1 integration. Flattening the score: 3 unit + 1 integration. Removing the shortest-name term: 3
unit + 2 integration. The first mutation pass also found a defect in the new tests themselves — they pinned
placeholder NUMBERS (`$5`, `$6`), so an unrelated ranking edit failed them for the wrong reason; they now
match `$\d+`, which keeps the discrimination without the brittleness.

**k6 verified live**, against the built image on 4,000 RESOLVED foods (a reduced local population — this is
NOT an SC-007 validation at 50,000): all seven shapes registered and passed at `p(95)<200`, with
`{ shape:short }` at **p95 4.64ms** — now the tightest shape, where T-195 measured it as the loosest at
~160ms. Loophole proven closed: with `FOOD_SEARCH_P95_MS=3` **and** `FOOD_SEARCH_SHORT_P95_MS=100000` set,
`{ shape:short }` still breached and k6 exited `99`; the deleted override is inert.

**Residual risk, stated plainly.** A _latency_ regression whose symptom is time rather than statement shape —
principally a dropped `food_search_vector_idx`, or the RESOLVED population growing past SC-007's 50,000
ceiling — is still caught ONLY by the label-gated k6 tier, so in practice by the nightly (within 24h of
merge) rather than on the PR. The deterministic tiers pin shape, not time, and this note does not claim
otherwise. Making it unconditional is not free: the `short` shape needs the 50,000-food fixture, which means
the Docker image build + seed + boot that `load-test-food` already does (~several minutes). The cheapest
honest options, in order of cost: (a) make the `heavy-e2e` label required for merge on any PR touching
`food-service/src/foods/dao/**`; (b) add a `search`-only k6 job at a reduced population, which would catch a
missing index (an index-less scan of 5,000 rows is still ~10× a prefix scan) but not a growth breach; (c)
move `load-test-food` to run on push-to-`main`, catching it post-merge but pre-deploy. Not chosen here — it
is a CI-topology call with a cost, and belongs to the owner. A second, smaller residual: the two suites
cannot see each other's blind spots by construction (unit cannot see data, integration cannot see SQL text),
so both must keep running — removing either leaves a mutation uncaught, which is why the mutation table above
records BOTH tiers' counts.

Also found while verifying, NOT fixed here (separate concerns, both pre-existing):
`ApiExceptionFilter.catch` swallows every unclassified throwable with **no log line at all** — a genuine 500
in the food API is invisible on the container's stdout, which is how the `TypeError` below took a debug patch
to find. And `tsx src/main.ts` cannot boot this service at all: esbuild does not emit
`emitDecoratorMetadata`, so every Nest constructor injection resolves to `undefined` and the first handler
throws `Cannot read properties of undefined`. A local run needs `nest build` + the Docker image (as
`_ci-heavy.yml` does), which is worth a line in the load README if anyone else tries it.

Follow-ups this opened, none done here:

- `description ILIKE '%q%'` in the ≥3-character statement is **dead work in production**: it can never match
  anything `name ILIKE` does not, because `description` is a copy of `name`. Same for `name % …` per cause 4.
  Removing both would cut the ≥3-character shapes' cost and is behaviour-preserving on production data.
- `tests/load/perfFixture.ts`'s note that a one-word description "would make SC-007 pass for the wrong
  reason" is **inverted**: production descriptions ARE one-line names, so the fixture's verbose boilerplate
  makes every index larger and every short query broader than deployed. T-195's numbers are therefore a
  pessimistic bound — the safe direction, but the stated reason is wrong.
- `src/sources/usda/bulk/usdaBulk.parser.ts:130` contains a **literal NUL byte** in a template string (a hash
  field separator), which makes `grep`/`rg` treat the whole file as binary. Should be `\0`.

---

## Plan §9 decisions (settled at stabilization 2026-06-28)

These were the open §9 gate items; all are now **settled** by the decision register (only the product-spec
food-substitution FR remains open, and it is owned outside this task list).

1. **Auto-resolve boundary (§9-1) — SETTLED (D-AUTORESOLVE).** Auto-`RESOLVED` iff **exactly one** candidate
   survives **normalized-name exact match** after pre-merge dedup; **>1 → `UNRESOLVED`** (surviving set persisted to
   `food_candidates`); **0 → `NOT_FOUND`**. **No nutrient tolerance** — the `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE`
   knob is dropped; bias toward `UNRESOLVED` over a wrong auto-pick (FR-MRG-5, T-162).
2. **`UNRESOLVED` candidate-set TTL (§9-2) — SETTLED (D-UNRESOLVED-TTL).** An `UNRESOLVED` food is **kept until a
   human picks**; its `food_candidates` set **expires 30 days after `created_at`** and the next add-by-name request
   re-fans-out — it is **not** swept to `NOT_FOUND`. 30-day default, config-overridable via
   `FOOD_UNRESOLVED_TTL_DAYS` (FR-025a, T-172).
3. **Source priority ranking (§9-5) — SETTLED.** USDA hard-coded highest now (`['usda']` static config); promote to
   a DB-backed ranking only when a second source is wired (T-120). No schema change at launch.
4. Async candidate search (§9-3) and change-detection via `item_version` (§9-4) are resolved in-plan (async +
   `food_sources.item_version`) — no open decision, recorded for traceability.

---

## ⚠️ PARTLY RESOLVED — SC-007's load fixture vs. the head-term retrieval branch (raised 2026-08-23)

**Status: RESOLVED in direction, not yet built. The BREACH is closed by owner ruling 2026-08-24 (SC-007 →
500ms p95, flat). The FIXTURE is to be made realistically skewed — owner ruling 2026-08-25 — which is work,
not a decision.**

⛔ **What "realistically skewed" means, measured 2026-08-25 against the real 8,094-row catalog.**
`perfFixture.ts` builds names by `index % list.length` over tiny vocabularies, so EVERY head term matches a
uniform ~9.09% of rows. Reality is heavy-tailed: **1.89% at p50**, with a worst realistic term (`ground
beef` → `beef`) at **13.75%**. The fixture is therefore wrong in BOTH directions at once — it charges a
median query tail cost, which is why every probe shape tripled together rather than a subset, and it
UNDERSTATES the worst case, which at 50,000 rows would scan ~6,875 rows against the fixture's 4,545.

⚠️ Re-baseline every SC-007 figure afterwards and record the deltas rather than replacing the old numbers
silently — the current ones are not wrong measurements, they are measurements of a different population.

⛔ **What the ruling does and does not do.** At 500ms the measured `narrow` p95 of ~184ms and the 303ms
breach both pass, with roughly 1.6–2.7x headroom, so the heavy tier is trustworthy again and the head-term
branch can stay as written. It does **not** make the benchmark truthful. Measured 2026-08-24 against the
real 8,094-row catalog, head-term selectivity is **1.89% at p50** where the fixture is a uniform **9.09%**
— so the fixture charges a MEDIAN query tail cost, which is why every probe shape tripled at once rather
than a subset. And the worst realistic real head term (`ground beef` → `beef`, **13.75%**) is BROADER than
the fixture's uniform value, so at 50,000 rows a real query would scan ~6,875 rows against the fixture's
4,545. **Fixing the fixture alone would never have been sufficient, and neither claim in the fork below was
wholly right.**

⚠️ A separate owner ruling the same day removes a different part of this benchmark: **FR-010a sets a
three-character minimum query length**, which deletes the `wordInitialPrefix` strategy and with it the k6
`short` probe. That probe was one of the two signals used below to isolate code from host — the argument
still stands on the flat `localStoreRead`, but the probe itself is going away.

⚠️ **Deferred, recorded so it is not rediscovered as novel:** a trie or similar prefix structure is a known
opportunity for search and was explicitly deferred by the owner on 2026-08-24. 500ms is the bar for now.

---

**Original entry, kept for the evidence it carries:**

`8c70d742` ("retrieve on the head term, which folds diacritics for free") added one clause to
`FoodSearchDao.relevanceQuery`:

```sql
OR rank_tokens @> ARRAY[${head}]::text[]
```

It fixed four measured zero-retrieval failures (`jalapeño`, `Kerrygold butter`, `oregano`, `Arborio rice`) and
is the highest-value lever the 2026-08-22 measurement identified. It also moved k6 `search` p95 from ~48 ms to
~133 ms and `narrow` from ~53 ms to ~184 ms, cutting SC-007's 288 ms headroom from ~5.6x to ~1.5x. Heavy E2E
run `32639941903` then breached it — `narrow` 303 ms, `brand` 297 ms — on a commit touching no food file.

**The evidence isolates code from host.** `localStoreRead` p95 (a single-row read the search predicate cannot
touch) is flat at 3.85–5.56 ms across all five runs, and the `short` probe — the one shape where the branch
cannot fire, since a 2-character head matches nothing — stays flat at 40–47 ms while every other shape
triples. That is a code signature, not a slow runner.

⚠️ **Do not re-run and call it green.** At 1.5x headroom ordinary p95 tail variance decides the outcome.

### The fork — these are different claims about reality, not two spellings of one fix

1. **The fixture is lying.** `tests/load/perfFixture.ts` builds names as `"{prep} {ingredient} {cut}, {brand}
{serial}"` by `index % list.length`, so head terms distribute uniformly over tiny vocabularies:
   `@> ARRAY['breast']` matches ~4,545 of 50,000 rows. On the real 8,094-row USDA catalog a cook's head term
   matches a handful, and `8c70d742` repaired exactly this unfaithfulness in the ACCESS-PATH corpus
   (`foodSearchAccessPath.integration.test.ts:421`) while leaving the LOAD fixture untouched. Choosing this
   means: production search did not regress, and the fixture must be made selectively realistic.
2. **The query is too broad.** Bound the head-term branch's contribution — cap its candidate set, require it to
   co-occur with another term, or only fall back to it when the conjunction returns nothing. Choosing this
   means: the branch really can degrade a large catalog and the fix belongs in the query.

⚠️ Whichever is chosen, note what let this through: `foodSearchAccessPath.integration.test.ts` asserts the
PLAN, not the LATENCY, so nothing caught it until the label-gated heavy tier ran hours later. A plan assertion
cannot see a query that picks the right index and then scores 4,545 rows through it.

---

## ⛔ OPEN — `parseIngredientLine` folds measurements into the food name, silently (raised 2026-08-23)

**Status: undecided. A defect, not a fork — but the fix has a design choice inside it.**

`parseIngredientLine` reads the LEADING quantity phrase and treats everything after it as the food. Where a
line states more than one measurement, the remainder lands in `name`, and `reviewReasons` stays **empty** —
so nothing downstream knows. Measured 2026-08-23:

| line                                                | name it produced                             | reviewReasons |
| --------------------------------------------------- | -------------------------------------------- | ------------- |
| `2 cups and 1 tablespoon all-purpose flour, sifted` | `and 1 tablespoon all-purpose flour, sifted` | `[]`          |
| `1 pound (about 4 cups) shredded cooked chicken`    | `(about 4 cups) shredded cooked chicken`     | `[]`          |
| `a handful of fresh basil leaves, torn`             | `handful of fresh basil leaves, torn`        | `[]`          |

⛔ A food name carrying a measurement matches no catalog row, so the line resolves to nothing or to something
wrong — and the empty `reviewReasons` means it is not surfaced for correction either. This is the same
corruption class the verification gate exists to catch, arriving from our own parser.

⚠️ What the parser gets RIGHT is worth stating, because the fix must not cost it: exact rational arithmetic
(`1/3` → `1n/3n`, stored canonically as `0.333`, never a float artifact), unit normalisation (`pound` → `lb`),
ranges (`1 to 2 teaspoons`), number words (`one and a half` → 3/2, `two dozen` → 24), and an honest
`{kind:'absent'}` + `no_quantity` on `salt and pepper to taste`.

### The design choice inside the fix

The missing capability is **segmentation** — deciding where the measurement ends and the food begins when a
line states more than one. Three shapes, which mean different things and must not be conflated:

- **additive** — `2 cups and 1 tablespoon`: sum them.
- **equivalent** — `1 pound (about 4 cups)`: the same amount said twice; summing DOUBLES it.
- **container and net** — `1 (14.5 ounce) can`: one is what is bought, the other what is in it.

The connective words carry the distinction (`and`/`plus` vs. a parenthetical), so a splitter keyed on them is
deterministic and testable. ⚠️ Note the downstream constraint: `IngredientQuantity` stores ONE quantity and
ONE unit, so an additive pair must also be converted to a common unit and summed — `millilitresPerUnit`
already exists for that half.

⚠️ Related, and the reason this surfaced: an LLM asked to parse the same lines segments all three correctly,
while producing worse numbers (`1/3` → `0.3333333333333333`, and the same line answering differently between
runs at `temperature: 0`). The division that holds is: a model decides where the boundaries are, our parser
converts what it is handed. Neither does the other's job.

---

## ⚠️ RULED — every open preview shares ONE USDA key while each counts its own quota (raised 2026-08-24)

**Status: direction ruled by the owner 2026-08-24. Seed the catalog; stop rationing the quota. One
precondition below is still open, and it changes the shape of the work.**

### The ruling

1. **Seed the catalog from the USDA BULK download rather than rationing the API.** The bulk datasets are
   HTTP file downloads — `usdaBulk.reader.ts` states it "never touches the rate-limited USDA API and
   consumes ZERO of the shared 1,000/hr quota" — and the seeder already exists (`npm run seed:usda-bulk`).
   SR Legacy is ~6 MB / 7,793 foods and **frozen since 2018-04**; Foundation is ~4 MB / 469 foods, reissued
   about twice a year. ⛔ Do NOT reach for the ~480 MB full archive: the importer filters to
   `foundation_food` + `sr_legacy_food`, so Branded costs only disk and read time.
   This attacks the CAUSE. Every option below it rations a budget; none reduce demand, and the demand is
   almost entirely an empty cache being filled with data that could simply be copied in.
2. **⛔ Rate limiting stays GLOBAL. Stop asking the question.** No per-PR key, no cross-stage counter, no
   dividing the cap by open-PR count. After seeding there is little traffic left to police.
3. **More API keys are obtainable if ever needed** (owner, 2026-08-24). This removes the objection that
   option 1 of the original fork rested on — it is no longer "drive someone else's signup flow from CI" —
   but it stays UNCHOSEN, because seeding means the extra keys are not needed.

### ⛔ Read the limit, do not model it

`api.data.gov` returns `X-RateLimit-Limit` and `X-RateLimit-Remaining` on **every** response, and
`UsdaApiClient` reads neither — it only maps `429`. So `RollingWindowLimiter` counts rows in Postgres to
MODEL a number the server reports for free.

⚠️ This also settles the per-IP-versus-per-key ambiguity empirically instead of by argument. FDC's API guide
says "per IP address"; api.data.gov says "for each API key"; the breach text says the KEY is blocked. Two
callers on different addresses, comparing `X-RateLimit-Remaining`, answer it in one run. **It matters
because food tasks run in public subnets with `assignPublicIp: true`, so every task already has its own
public address** — if the limit is per-IP, the fleet was never sharing a budget and this entry's arithmetic
never applied.

### How the seed reaches each environment

Seed each **base** database once, and let ephemeral stages CLONE it rather than seeding themselves:

- `ensureDatabaseExists` (`src/lambdas/migrate/handler.ts:228`) runs a bare `CREATE DATABASE "<name>"` and
  deliberately **skips the base** — `kitchensink_food` comes from the DataStack bootstrap.
- Adding `TEMPLATE "kitchensink_food"` makes Postgres clone the seeded base at the filesystem level. An
  ephemeral stage then starts WARM, with no seed run of its own and no cold-cache API spend.

⚠️ **Two things this depends on.** `TEMPLATE` fails if ANY session is connected to the template database —
satisfied today only because no food service runs at the base stage, which is a load-bearing coincidence
rather than a guarantee, and deserves a guard. And a clone inherits the base's schema version, so the
migration runner still applies anything newer on top; base-versus-branch migration interaction needs a test.

### Where each environment gets its seed (owner confirmation, 2026-08-24)

Only the services under `packages/infra/global` — identity and the shared platform — run permanently at
both prod and sandbox. **Every other service, food included, deploys to the PR sandbox and to production.**
That is what `infra/bin/app.ts:33` already enforces: it refuses a food deploy at a non-prod base stage
because "every PR deploys its own (stage `pr-{N}`)". So there are three seed targets, and they differ:

| target                              | what it is                                                           | how it gets seeded                                                          |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **prod** `kitchensink_food`         | the live catalog, already partly filled on demand                    | seeded once; the importer merges in place and never duplicates              |
| **sandbox base** `kitchensink_food` | exists from the DataStack bootstrap; **nothing ever connects to it** | seeded once, and exists purely to be cloned                                 |
| each **`pr-{N}`**                   | ephemeral, created per PR                                            | `CREATE DATABASE … TEMPLATE "kitchensink_food"` — a warm clone, no seed run |

⛔ **The `TEMPLATE` clone is viable precisely BECAUSE food has no persistent non-prod instance.** Postgres
refuses to clone a database that has any open session, and the sandbox base has none — not by luck, but as
a direct consequence of the rule above. ⚠️ It would break silently if a persistent sandbox food service
were ever added, so the clone path needs a guard that says so rather than a comment that hopes so.

---

**Original entry, kept for the evidence and the option costs:**

Every `pr-{N}` food preview authenticates to USDA FoodData Central with the SAME API key, and every one of them
enforces A-001's cap against a counter only it can see. With N previews open, the fleet is authorized to issue up
to N × 900 background calls an hour against a budget of 1,000. A-001 (`spec.md:792`) is unambiguous that there is
no relief on the other side:

> **A-001**: Each external source's rate limit is a hard constraint. For USDA, the FoodData Central limit of 1,000
> requests per hour per API key cannot be increased through paid tiers or support requests within the project
> timeline.

### The two halves, and why each is individually correct

**The key rides `baseStage`.** `packages/services/food-service/infra/lib/FoodServiceStack.ts:437-441` imports the
secret by name:

```ts
const usdaApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
    this,
    'ImportedUsdaApiKeySecret',
    `kitchensink/${baseStage}/food/usda-api-key`,
);
```

`baseStage` is `sandbox` for every non-prod stage (`infra/bin/app.ts:24`); `stage` is `pr-{N}`. ADR-0006 lists this
secret **by name** among the platform imports that ride `baseStage` on purpose, and it is right to: a per-PR secret
would have to be issued out of band by a human on every PR open, which is the coupling "no per-PR platform" exists
to remove. Prod imports `kitchensink/prod/food/usda-api-key` and is therefore NOT in the blast radius — ⚠️ on the
assumption that the two secrets hold DIFFERENT keys, which is an operator fact set by `put-secret-value` and
asserted nowhere in this repo.

**The counter rides `stage`.** `RollingWindowLimiter` counts rows in `source_call_log` (`tryRecord`,
`src/sources/RollingWindowLimiter.ts:93-100`) against `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` (default 1,000,
`src/config/env.schema.ts:58`), and pauses background drain at `PAUSE_FRACTION = 0.9` → 900
(`RollingWindowLimiter.ts:17`, `:42-49`). ADR-0006 gives each preview its own logical database
`kitchensink_food_pr_{N}`, so `source_call_log` is private to that preview: pr-1's limiter cannot see one call
pr-2 made. That isolation is also right — shared tables would let previews corrupt each other's fixtures. The two
designs are simply keyed on different things, and nothing is keyed on the thing that is actually scarce.

⚠️ The 429 failsafe does not close the gap either. `markWindowFull` (`RollingWindowLimiter.ts:144-146`) writes an
**in-process** `Map` (`:71`), so it is invisible across stages AND across the two tasks of one stage. When USDA
starts refusing, each of the 2N tasks must learn it separately, and each learns it by spending a call.

### Why it does not read as a bug

- The defect lives only in the seam. Both halves are deliberate, documented and load-bearing; no single file spans
  the seam, so no file is wrong when read on its own terms.
- The only in-repo prose describing the secret's name gets it **wrong in the reassuring direction**:
  `infra/bin/app.ts:75-76` says the key is "imported by name `kitchensink/{stage}/food/usda-api-key`". A reader who
  trusts that comment concludes each preview already has its own key. The code, in a different file, says
  `baseStage`.
- The limiter's own JSDoc (`RollingWindowLimiter.ts:31-36`) states that "the API, the fan-out worker … and the
  change-refresh task all charge the SAME external quota" — true, and it names three consumers **within one
  stage**. The paragraph reads as though the sharing question has already been asked and answered.

### What actually spends the budget

Each PR runs one API task plus one worker task (`.github/workflows/sandbox-deploy.yml:695-696`), and a
change-refresh task fires every 6 hours (`FoodServiceStack.ts:637-653`). Two amplifiers sit on top:

- **A fresh preview database is empty.** ADR-0006's migration runner CREATEs `kitchensink_food_pr_{N}` and applies
  migrations; nothing seeds it. The whole design is cache-aside — local → miss → source-within-quota → persist →
  never re-fetch — so a preview starts at a 0% hit rate and pays full source cost for foods other previews have
  already fetched. **The isolation that blinds the counters also destroys the sharing that would have made one
  budget sufficient.**
- **CI is not a consumer.** Every workflow injects a dummy key (`_ci.yml:1104`, `_ci.yml:1373`,
  `_ci-heavy.yml:901`), so no automated tier makes a real USDA call. The spend comes from humans using previews,
  which is why the arithmetic above is an upper bound on _authorized_ calls, not a forecast of actual ones.

### ⚠️ This is UNMEASURED

**Nobody has observed an exhaustion event.** Searched for one and found none: no `429` / `OVER_RATE_LIMIT` /
quota-exhaustion finding in `docs/reports/`, `docs/reviews/2026-08-14-pr91-findings/`, `docs/runbooks/`, or any
spec. The nearest thing is the 2026-08-22 resolution measurement, which ran against a local corpus. This repo keeps
no incident log. So the case above is arithmetic and reading, not evidence.

⛔ Do not read "unmeasured" as "would have shown up by now" — read it as **we would not currently notice.** The one
surface tracking source-call volume is the dashboard widget "Per-source rolling-60-min calls"
(`FoodServiceStack.ts:1036-1039`), and it has two defects of its own: (a) every stage emits into the same
`Commise/Food` namespace under a single `source` dimension with **no stage dimension**
(`src/observability/emfMetrics.ts:324-331`), so prod and every preview co-mingle into one series and no call can be
attributed to a preview; and (b) the widget's `emfMetric` helper (`:934-940`) builds a **dimensionless** metric
while the emitter publishes only the `source`-dimensioned series, so the widget plots nothing — UNVERIFIED against
live CloudWatch, and W4 in `packages/infra/global/__tests__/serviceInfraWiringInvariants.test.ts:806` cannot catch
it because W4 gates alarms, not dashboard widgets. No alarm watches the metric at all.

### The options — none chosen

1. **A key per PR.** Correct isolation, and the configured cap would then mean what it says. Cost: a third-party
   credential must be issued per preview. Registration is a self-service form, so automating it means driving
   someone else's signup flow from CI, and doing it by hand puts a human back in the PR-open path — the coupling
   ADR-0006 removed. It also multiplies this project's footprint against USDA rather than reducing it, at a source
   that A-001 records as unraisable.
2. **One counter that crosses stage boundaries.** Move `source_call_log` (or just the window count) out of the
   per-PR database into a store the whole sandbox base stage shares. This is the only option where the enforced
   number and the enforced-against number are the same number. Cost: it deliberately punches through ADR-0006's
   isolation — a shared writable table every preview touches is the shared-tables model that ADR rejected — and it
   needs a substrate with its own IAM and failure mode (a table in the shared `kitchensink_food` database reachable
   from a per-PR role, DynamoDB, or Valkey per ADR-0016). ⚠️ It also forces a product question the current design
   never has to answer: what a preview does when the SHARED window is full, given that one busy preview would then
   starve every other.
3. **Accept the risk, with an alarm.** Cheapest, and honest that previews are low-stakes. Cost: per the section
   above, "just add an alarm" is not free — it needs a `stage` dimension the emitter does not attach and a widget
   that works. And an alarm is a detector, not a control: it reports that the key was already exhausted, on
   whichever stage happened to call next.
4. **Divide the cap by open-PR count.** Set `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` per deploy from the number of open
   PRs; the knob already exists (`FoodServiceStack.ts:420-429` reads a `foodSourceRateLimitPerHour` CDK context
   value). Cost: it is only correct at deploy time — opening PR N+1 does not lower the cap of the N already
   running, so the fleet stays over-provisioned until each redeploys — and it splits the budget across previews
   that are mostly idle, leaving the one preview a human is actually using with 1/N of a quota it could have had.

⚠️ Whichever is chosen, note the SHAPE of the defect: the enforcement point and the resource it protects are keyed
on different things. Any fix that leaves `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` describing a _per-stage_ number while
the credential is _per-base-stage_ has re-described the defect, not removed it.
