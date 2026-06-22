# System Design: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/v-model/requirements.md`

> **Re-baseline note (2026-06-22).** This artifact (V-Model Layer 2, traces to `requirements.md`
> REQ-\* ids) was regenerated to match the **source-agnostic food data redesign** (spec.md / plan.md
> re-baselined 2026-06-21). A food is now keyed by an internal surrogate `id` (ULID-valued, named `id`);
> **USDA is one pluggable source adapter** among many; foods are assembled into a **cross-source golden
> record** with per-field provenance; users add foods **by name** through a `PENDING → (UNRESOLVED) →
RESOLVED` lifecycle (terminal `NOT_FOUND` / `FAILED`). All `fdcId` / `fetch_status` /
> denormalized-nutrient-column references from the prior USDA-coupled design are removed from the
> canonical system view and **confined to the USDA-adapter boundary** (SYS-009 / SYS-014; `fdcId →
external_key` inbound). **Preserved (re-keyed) SYS ids** — SYS-001..SYS-013 survive as the same roles,
> re-keyed from `fdcId` to the food `id` and generalized from USDA-only to **per source**; the auth slice
> (SYS-013) and the queue/worker/limiter family (SYS-002..SYS-006) keep their ids and substance.
> **New SYS ids** — SYS-014..SYS-020 cover the genuinely new capabilities (source-adapter registry/interface,
> golden-record merge engine, candidate/resolve, provenance store, DAO/repository layer, change-driven
> refresh, adapter input validation/HTTPS). No existing SYS id was renumbered.

## Overview

Event-driven, queue-based, **source-agnostic** architecture for external food/nutrition integration. The
HTTP read API is a NestJS service on ECS/Fargate behind the single shared per-stage public ALB (host-based
listener rule, priority 200); user-facing food lookups are served from the local PostgreSQL store
(`kitchensink_food` on the shared `kitchensink-data-{stage}` instance; Redis cache is a deferred variant)
— **no external source is ever called in the request path**. A food is keyed by an internal `id` created
up front by an **add-by-name** request (`POST /v1/foods`), deduped on a normalized-name key under a short
advisory lock so concurrent adds collapse to one row. The add enqueues a sync via a direct
`INSERT … ON CONFLICT (food_id)` into the single Postgres `fetch_queue` paired with
`pg_notify('fetch_queued', id)`, drained over `LISTEN/NOTIFY` by a single Fargate **fan-out/merge worker**
(single instance via advisory lock). The worker fans out across **every wired source adapter** by name,
fetches from each source that has the item (each call governed by a **per-source** rolling-60-minute-window
limiter — USDA ≤1,000/hr, pause at 90% / 900), normalizes the results, and **merges them into a golden
record** with per-field provenance — moving the food through `PENDING → (UNRESOLVED) → RESOLVED`
(terminal `NOT_FOUND` / `FAILED`). Multiple non-collapsible candidates surface as `UNRESOLVED` for a
human pick (`GET /candidates` + `PATCH /v1/foods/{id}`). Demand is counted as **distinct authenticated
requesters** (`sub`s) per food `id` (tracked in `fetch_requesters`, folded into a capped `request_count`),
drained `ORDER BY <effective_priority> DESC, first_requested ASC` with aging and per-`sub` demotion (a
`sub` with >50 pending items is ranked to the back, dynamically, at drain time). Queue rows carry a single
`status` of `pending | in_flight | tombstone`; success resolves the row, a no-source fan-out tombstones it
(`NOT_FOUND`, 30-day TTL), and a source-error fan-out tombstones after the retry budget (`FAILED`,
re-fetchable). Each lease is a single **30s** `in_flight` lease. EventBridge carries **only** scheduled
producers (change-driven refresh) and the `FoodDataReceived` completion event — never the demand-path
enqueue. **USDA terminology (`fdcId`) lives only at the adapter boundary** (SYS-009/SYS-014), mapped to
`external_key` inbound. (A WebSocket push notifier on API Gateway WebSocket API is deferred to US-9 and is
the only Lambda-authorizer surface.)

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-013, REQ-014` — component satisfies both requirements
- **Re-baseline (2026-06-22):** SYS-001..SYS-013 preserved (re-keyed); SYS-014..SYS-020 are new.

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Parent Requirements                                                                                                                                                                                   | Type      |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| SYS-001 | FoodApiController             | NestJS controller in the food read service on ECS/Fargate behind the shared public ALB. Handles all `/v1/foods/*` endpoints (`POST` add-by-name, `GET /{id}` (+`/status`), `GET /candidates`, `PATCH /{id}` resolve, `GET /search`, `POST /batch`) with in-process `AuthMiddleware`/`FoodAuthGuard` (SYS-013) ahead of every handler. Serves the golden record from the local store only; never calls an external source. Returns `200` only when `status='RESOLVED'`, `202` when `PENDING`/`UNRESOLVED`, `404` when `NOT_FOUND`/`FAILED`/no row (status still retrievable), `400` on malformed `id`/empty name. Validates the `id` path param is a well-formed ULID.                                                                                                                                                                                                                                                                                              | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-033, REQ-047, REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-009                                            | Component |
| SYS-002 | EventBridgeBus                | Event bus for **scheduled producers only** (change-driven refresh, `IngestionScheduled`) and the `FoodDataReceived` completion event. **Not** on the demand-path enqueue — add-by-name enqueues are `INSERT … ON CONFLICT (food_id)` into `fetch_queue` + `pg_notify` directly from SYS-001. Decouples scheduled producers and completion consumers from the API service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | REQ-032, REQ-IF-005                                                                                                                                                                                   | Component |
| SYS-003 | FetchQueue                    | The single Postgres `fetch_queue` (Postgres-as-queue), **keyed on the food `id`** (`food_id PRIMARY KEY REFERENCES food(id)`). Every fetch unit of work — demand-path add-by-name, batch/recipe import, and scheduled refresh — is one row in this one table. **No** static high/low partition: ordering is demand-weighted at drain time, `ORDER BY <effective_priority> DESC, first_requested ASC`, where `effective_priority` is the capped distinct-`sub` `request_count` (via `fetch_requesters`, FR-044) with aging, and a `sub` holding >50 pending rows is demoted to the back (dynamic, at drain time). Rows carry a single `status` of `pending \| in_flight \| tombstone`. Drained by the Fargate fan-out/merge worker via `LISTEN/NOTIFY`.                                                                                                                                                                                                             | REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-018, REQ-039, REQ-IF-005                                                                                                                             | Component |
| SYS-004 | FetchRequesters               | Postgres `fetch_requesters` table modeling **distinct-requester demand** (FR-044): `(food_id, sub)` upserted `ON CONFLICT DO NOTHING` per request so a single `sub`'s repeats never re-count. Supplies the **capped** distinct-`sub` `request_count` on each `fetch_queue` row (`PRIORITY_CAP = 1`), each `sub`'s live pending count for SYS-013 demotion, and the authoritative subscription set the WebSocket notifier (SYS-010) uses for per-recipient targeting. Keyed on the food `id`, not a source key. Not a separate queue — a demand index over the single `fetch_queue`.                                                                                                                                                                                                                                                                                                                                                                                | REQ-014, REQ-039                                                                                                                                                                                      | Component |
| SYS-005 | FoodFanOutMergeWorker         | Rate-limited Fargate consumer worker (single instance via advisory lock) that drains the single `fetch_queue` via `LISTEN/NOTIFY` in demand-weighted order (dynamic >50-pending demotion; no high/low split). Claims one row under a single **30s** `in_flight` lease (stale rows >30s revert to `pending` for crash recovery). For each row it **fans out across every wired source adapter** (SYS-014) by name, fetches from each source that has the item (per-source rolling-window-limited, SYS-006), invokes adapter validation (SYS-020), pre-merges/dedups candidates, drives the golden-record merge (SYS-015), persists via the DAO layer (SYS-018) with provenance (SYS-017), and sets `food.status` to `RESOLVED`/`UNRESOLVED`/`NOT_FOUND`/`FAILED`. Retries transient errors up to 5 attempts with backoff then tombstones; emits `FoodDataReceived`. Validates async-producer provenance (FR-048).                                                   | REQ-015, REQ-016, REQ-017, REQ-024, REQ-025, REQ-027, REQ-042, REQ-050                                                                                                                                | Component |
| SYS-006 | PerSourceRollingWindowLimiter | **Per-source** rolling-60-minute-window limiter holding the worker to ≤ each source's hourly cap in any trailing 60 minutes (USDA ≤1,000; the worker pauses draining work that needs a given source at 90% — USDA 900 — and resumes as that source's earlier calls age out). State = recent source-call timestamps in the Postgres `source_call_log` keyed by `source` (lean default); a per-source Redis sorted set is the deferred variant. Check-and-record (count trailing-60-min calls + record the new call) is atomic per source. On a source `429`, backs off treating that source's window as full. Each additional wired source gets its own window sized to that source's limit.                                                                                                                                                                                                                                                                        | REQ-019, REQ-020, REQ-021, REQ-026                                                                                                                                                                    | Component |
| SYS-007 | FoodCanonicalPostgresStore    | PostgreSQL-backed canonical, normalized, provenance-bearing store on `kitchensink_food` (shared instance). Holds the source-agnostic schema: `food` (golden scalar fields — internal `id` PK, `name`, `normalized_name` dedup key, `description`, `kind` (`generic\|branded`), brand attributes, barcode, lifecycle `status`, `tombstoned_at`, timestamps), `food_sources` (crosswalk, `UNIQUE(source, external_key)`, `item_version`, **no verbatim payload**), `nutrient` (dictionary; units live here), `food_nutrients` (`amount`, `basis`, `source_id`), `food_portions` (`gram_weight`, `source_id`), `food_field_provenance` (`food_id`, `field`, `source_id`), `food_category`(+assignment). Indexed for `id` PK, `status`, the unique `normalized_name`, `food_sources(source, external_key)`, `food_nutrients(food_id)`/`(source_id)`, and trigram GIN on `name`/`description`. No `fdcId`, no denormalized nutrient columns, no `fetch_status`, no EAV. | REQ-001, REQ-002, REQ-003, REQ-004, REQ-008, REQ-010, REQ-028, REQ-029, REQ-NF-018                                                                                                                    | Component |
| SYS-008 | FoodRedisCache                | Optional Redis cache (deferred post-launch variant; lean-launch default is the Postgres canonical store) for hot food data, keyed `food:{id}` with a 24h TTL and `allkeys-lfu` eviction. Pending-fetch dedup is the `fetch_queue` `ON CONFLICT` row, not a Redis set. Secondary role: per-source rolling-window limiter state (sorted-set variant). Not part of the lean-launch build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | REQ-001, REQ-030                                                                                                                                                                                      | Component |
| SYS-009 | UsdaSourceApi                 | External USDA FoodData Central REST API — **the adapter-boundary external system**. Called exclusively by the USDA adapter inside the worker via the per-source rolling-window limiter. Uses `GET /v1/food/{fdcId}` (single) and `POST /v1/foods` with ≤20 `fdcId`s (batch, 1 windowed call). **`fdcId` exists only here**; the adapter maps it to `external_key` inbound. USDA is the only wired source today; additional sources are additive external systems behind their own adapters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | REQ-019, REQ-023, REQ-IF-004, REQ-IF-006                                                                                                                                                              | Component |
| SYS-010 | WebSocketNotificationLambda   | Optional Lambda triggered by `FoodDataReceived` events from EventBridge. Pushes real-time updates (carrying the food `id`) to connected clients via API Gateway WebSocket API, targeted per-recipient via the `fetch_requesters` subscription set. Launch deferred (US-9). The only Lambda-authorizer surface (`$connect`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | REQ-034, REQ-043, REQ-IF-008                                                                                                                                                                          | Component |
| SYS-011 | SecretManagement              | AWS Secrets Manager integration for **per-source** API key storage and rotation (e.g. the USDA key). Injected into the worker environment via secure parameter; never exposed in responses or logs. Each external source's API key is the only secret on the path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | REQ-IF-006, REQ-044c                                                                                                                                                                                  | Component |
| SYS-012 | MonitoringAndLogging          | CloudWatch for the ECS/Fargate API service and the Fargate worker: logs, metrics (queue depth, per-source trailing-60-min call counts, resolution latency, `UNRESOLVED` backlog, tombstone-row count, auth-`401` rate), and alarms. X-Ray tracing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | REQ-NF-012, REQ-NF-016                                                                                                                                                                                | Component |
| SYS-013 | AuthnAuthzLayer               | Named Clerk authentication & authorization component fronting **every** food data entry point. Networkless `@clerk/backend` `verifyToken` against non-secret `CLERK_JWT_KEY` with `azp` allowlist, fail-closed `401`. Two surfaces: (1) in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate HTTP service behind the public ALB; (2) a WebSocket `$connect` Lambda authorizer (pinned `403`). Emits the `AuthenticatedCaller` principal (`sub`, `azp`, scopes from `public_metadata`), enforces scope `403`/precedence, per-`sub` demotion fairness (>50 pending → ranked to back; no `429`), batch/queue bounds (`400`/`503`), M2M token class, async-producer provenance, and auth-layer load-shed. Reuses the identity service's `ClerkAuthService` verify logic via shared `@kitchensink/clerk-verify`.                                                                                                                                       | REQ-035, REQ-IF-007, REQ-IF-008, REQ-037a, REQ-037b, REQ-037c, REQ-037d, REQ-038a, REQ-038b, REQ-038c, REQ-039, REQ-040a, REQ-040b, REQ-041, REQ-042, REQ-043, REQ-044a, REQ-044b, REQ-044c, REQ-044d | Component |
| SYS-014 | SourceAdapterRegistry         | **(New.)** The pluggable **source-adapter registry + `FoodSourceAdapter` interface** (`searchByName`, `fetchByKey`, internal `mapToCanonical`). The worker (SYS-005) iterates this registry to fan out; adding a source is **additive** (append an adapter + a `source` enum value) and never touches the canonical schema. **The USDA adapter (`@kitchensink/usda-client`) is the only wired adapter and the only place `fdcId`/USDA terms appear** — it maps `fdcId → external_key` inbound. No source-specific structure leaks past this boundary into services, DAOs, or the API. USDA is the default highest source priority until an explicit ranking is configured.                                                                                                                                                                                                                                                                                         | REQ-046, REQ-050, REQ-054, REQ-CN-007, REQ-IF-004, REQ-IF-012                                                                                                                                         | Component |
| SYS-015 | GoldenRecordMergeEngine       | **(New.)** Field-level cross-source merge that assembles the golden record after candidates are normalized: **presence beats absence**; identity/short fields (`name`, `brand`) take the **higher-priority source** (NOT longest); free-text (`description`, `ingredients`) **longer-wins**; nutrients normalized to a common basis (per-100g) before any blend, conflicts resolved to the higher-priority source with `food_nutrients.source_id` recording the winner. Deterministic and auditable. Drives the `RESOLVED`/`UNRESOLVED` outcome (single confident merge vs. residual ambiguity).                                                                                                                                                                                                                                                                                                                                                                   | REQ-050, REQ-051                                                                                                                                                                                      | Component |
| SYS-016 | CandidateResolutionService    | **(New.)** Cross-source candidate disambiguation: `GET /v1/foods/{id}/candidates` returns the candidate list for an `UNRESOLVED` food (each candidate carries its `source` and that source's item key); `PATCH /v1/foods/{id}` resolves from the user's pick — each chosen candidate **validated to belong to that food's own candidate set** — drives the merge (SYS-015) and moves the food to `RESOLVED`. An out-of-set pick is rejected (`400`/`409`) with `status` unchanged; the user's pick is stored as ordinary provenance (SYS-017). The human is the final arbiter, so pre-merge dedup need not be perfect.                                                                                                                                                                                                                                                                                                                                             | REQ-048, REQ-049, REQ-IF-010, REQ-IF-011                                                                                                                                                              | Component |
| SYS-017 | ProvenanceStore               | **(New.)** Per-field provenance at the value's grain (not payload, not EAV): a `source_id` reference column on the multi-valued tables (`food_nutrients`, `food_portions`, `food_category_assignment`) and a thin `food_field_provenance(food_id, field, source_id)` side-table for scalar `food.*` fields keyed by a controlled `field` enum. The user's manual resolution (SYS-016) is stored as ordinary provenance. "Which fields came from source X for this food" is answerable by a single query across the value tables and `food_field_provenance`. No verbatim source payload retained.                                                                                                                                                                                                                                                                                                                                                                  | REQ-028, REQ-029, REQ-052                                                                                                                                                                             | Component |
| SYS-018 | FoodDaoRepositoryLayer        | **(New.)** The DAO/repository persistence seam: per-aggregate DAOs (`FoodDao`, `FoodSourcesDao`, `NutrientDao`, `FoodNutrientsDao`, `FoodPortionsDao`, `FoodFieldProvenanceDao`, `FoodCategoryDao`) behind the `FoodsRepository`. **All persistence goes through this layer** — services and the worker never issue source-specific SQL. Owns the add-by-name dedup mechanics: the normalized-name unique key + short **advisory lock** so concurrent adds of the same name collapse to one canonical row + `id`, and the idempotent `fetch_queue` `INSERT … ON CONFLICT (food_id)`. Adding a source is additive and never touches this layer's canonical contracts.                                                                                                                                                                                                                                                                                               | REQ-005, REQ-013, REQ-028, REQ-047, REQ-054                                                                                                                                                           | Component |
| SYS-019 | ChangeDrivenRefresh           | **(New.)** Change-driven refresh: once a food is populated our stored values stand; a scheduled `IngestionScheduled` rule (SYS-002) triggers periodic checks that re-pull a field **only** when its originating external source item has changed upstream (detected via a per-item version/etag/hash in `food_sources.item_version`, not stored payload), never blindly re-blending. A user's manual resolution is preserved automatically (it is just a stored value). Affected fields are re-enqueued as low-priority `fetch_queue` work (deduped via `ON CONFLICT`); re-pulled values pass adapter validation (SYS-020) and update their `source_id` provenance. No max-staleness cutoff withholds an already-held record.                                                                                                                                                                                                                                      | REQ-031, REQ-032, REQ-053                                                                                                                                                                             | Component |
| SYS-020 | AdapterInputValidation        | **(New.)** Source-boundary input validation + transport security: each source adapter validates and sanitizes the values it maps (type/range checks, length caps, text sanitization) **before** they enter the canonical store; outbound source fetches use **HTTPS with certificate validation**; a response that fails validation is **rejected, not stored**. No invalid input reaches the canonical schema or the `fetch_queue`. Complements SYS-001's request-edge `id`/name validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | REQ-006, REQ-055, REQ-NF-018                                                                                                                                                                          | Component |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship  | Failure Impact                                                                                                                                                                                                        |
| ------- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-001 | SYS-018 | Reads/Writes  | Add-by-name + reads go through the DAO layer (normalized-name dedup under advisory lock; `fetch_queue` `INSERT … ON CONFLICT`). If the DAO layer/DB is unavailable, the API returns `503`; no graceful degradation    |
| SYS-001 | SYS-007 | Reads         | If the canonical store is unavailable, the API returns `503`; reads never fall back to a source                                                                                                                       |
| SYS-001 | SYS-004 | Records       | Demand-path upsert `(food_id, sub)` into `fetch_requesters` `ON CONFLICT DO NOTHING` (caps the derived `request_count`). If it fails, demand weighting degrades to last-known counts; ordering still functions        |
| SYS-001 | SYS-003 | Enqueues      | Demand-path enqueue is `INSERT … ON CONFLICT (food_id)` into the single `fetch_queue` + `pg_notify` (no EventBridge). If the insert fails, the food is not resolved; client polls and sees `PENDING`/`404`            |
| SYS-001 | SYS-016 | Delegates     | `GET /candidates` and `PATCH /{id}` resolve delegate to the candidate service. If unavailable, an `UNRESOLVED` food cannot be resolved by hand (stays `UNRESOLVED`)                                                   |
| SYS-001 | SYS-008 | Reads         | If Redis (deferred variant) is unavailable, falls through to the Postgres canonical store; slight latency increase                                                                                                    |
| SYS-002 | SYS-003 | Enqueues      | Scheduled producers (`IngestionScheduled` change-refresh) `INSERT` low-demand rows into the single `fetch_queue`. If the insert fails, scheduled refresh rows are lost; tombstones capture terminal failures          |
| SYS-002 | SYS-019 | Triggers      | `IngestionScheduled` cron drives change-driven refresh. If the rule fails, data freshness lags; already-held records are unaffected (reads never block)                                                               |
| SYS-003 | SYS-005 | Feeds         | The single `fetch_queue` feeds the worker in demand-weighted order (dynamic demotion). If the worker is behind, rows accumulate; resolution delayed                                                                   |
| SYS-004 | SYS-005 | Weights       | `fetch_requesters` supplies the capped distinct-`sub` demand count and per-`sub` pending count for `<effective_priority>`/demotion at drain time. If unavailable, the worker falls back to last-known `request_count` |
| SYS-005 | SYS-014 | Fans out      | The worker iterates the adapter registry to fan out by name. If an adapter errors, that source contributes nothing; the food resolves from remaining sources or lands `FAILED`/`NOT_FOUND`                            |
| SYS-005 | SYS-006 | Throttles     | Every source call passes the per-source limiter. If the limiter is unavailable, the worker cannot call that source safely and re-defers the row                                                                       |
| SYS-005 | SYS-015 | Merges        | The worker hands normalized candidates to the merge engine. A merge that yields one confident record → `RESOLVED`; multiple non-collapsible → `UNRESOLVED`                                                            |
| SYS-005 | SYS-018 | Persists      | The worker writes the golden record + crosswalk + provenance through the DAO layer. If a write fails, data is not lost; retry with backoff                                                                            |
| SYS-005 | SYS-020 | Validates     | The worker invokes adapter validation before any value enters the store. A response failing validation is rejected, not stored                                                                                        |
| SYS-005 | SYS-008 | Invalidates   | If Redis invalidate fails (deferred variant), stale data may be served from cache up to TTL (24h)                                                                                                                     |
| SYS-014 | SYS-009 | Calls         | The USDA adapter calls the USDA API via the limiter; `fdcId → external_key` mapping is confined here. If USDA is unavailable, the worker retries with backoff and tombstones after 5 attempts                         |
| SYS-014 | SYS-020 | Uses          | Each adapter's `mapToCanonical` runs adapter validation/HTTPS before returning a canonical candidate                                                                                                                  |
| SYS-014 | SYS-011 | Reads         | The adapter obtains its source API key from Secrets Manager. If unavailable, that adapter cannot call its source; it contributes nothing to the fan-out                                                               |
| SYS-015 | SYS-017 | Records       | The merge engine records the winning source per field/value into the provenance store                                                                                                                                 |
| SYS-016 | SYS-015 | Drives        | A valid `PATCH` candidate pick drives the merge into the golden record → `RESOLVED`                                                                                                                                   |
| SYS-016 | SYS-017 | Records       | The user's manual pick is stored as ordinary provenance                                                                                                                                                               |
| SYS-017 | SYS-007 | Persists      | Provenance is value-grain columns + the `food_field_provenance` side-table in the canonical store                                                                                                                     |
| SYS-018 | SYS-007 | Persists      | The DAO layer is the sole writer/reader of the canonical store                                                                                                                                                        |
| SYS-019 | SYS-014 | Re-fetches    | Refresh re-fetches a backing item via its adapter and compares `item_version`. If unchanged, nothing is overwritten                                                                                                   |
| SYS-019 | SYS-003 | Re-enqueues   | Changed fields are re-enqueued as low-priority `fetch_queue` rows (deduped via `ON CONFLICT`)                                                                                                                         |
| SYS-010 | SYS-004 | Targets       | WebSocket push targets recipients via the `fetch_requesters` subscription set (the verified `sub` that requested that food `id`); never broadcast                                                                     |
| SYS-013 | SYS-001 | Fronts        | In-process middleware on ECS/Fargate; every HTTP route is gated. Verification failure → `401`/`403` before business logic — no enqueue, no source call                                                                |
| SYS-013 | SYS-010 | Fronts        | WebSocket `$connect` Lambda authorizer; unauthenticated connections rejected (`403`) before establishment                                                                                                             |
| SYS-013 | SYS-003 | Gates         | Per-`sub` demotion fairness (>50 pending → ranked to back; no `429`) and `fetch_queue` depth / circuit-breaker bounds (`503`) applied after authn, before/at the `fetch_queue` INSERT                                 |
| SYS-001 | SYS-013 | Authenticates | The API service depends on the auth layer for the `AuthenticatedCaller`; a misconfigured `CLERK_JWT_KEY` fails closed to `401`                                                                                        |
| SYS-005 | SYS-002 | Publishes     | The worker emits `FoodDataReceived` on completion; failure is fire-and-forget (polling remains the primary notification)                                                                                              |
| SYS-002 | SYS-005 | Validates     | Consumer-side provenance check (FR-048): SYS-005 validates each drained row / `IngestionScheduled` event originated from an authorized principal; absent provenance → not processed                                   |

### Dependency Diagram

```text
Client ─(Bearer token)→ SYS-013 (AuthnAuthzLayer) ─[401/403 fail-closed]
   ├─ HTTP:  in-proc NestJS AuthMiddleware on ECS/Fargate (ALB) ─→ SYS-001 (FoodApiController)
   └─ WS:    $connect Lambda authorizer ───────────────────────→ SYS-010 (WebSocket)
                        ↓ (AuthenticatedCaller; per-sub demotion >50 pending / queue 503 before publish)
Client → ALB → ECS/Fargate NestJS service → SYS-001 (FoodApiController)
                        ↓ (all persistence via the DAO layer)
                 SYS-018 (FoodDaoRepositoryLayer) ── normalized-name dedup (advisory lock) ──→ SYS-007 (canonical store)
                        ├─ upsert (food_id, sub) → SYS-004 (fetch_requesters: distinct-requester demand, cap=1)
                        ↓ INSERT … ON CONFLICT (food_id) + pg_notify (demand path; NO EventBridge)
              SYS-003 (single fetch_queue; status pending|in_flight|tombstone; keyed on food id) ──┐
                        ↑                                                                           ├─ LISTEN/NOTIFY (demand-weighted, >50-pending demotion) ─→ SYS-005 (FoodFanOutMergeWorker; 30s lease)
                        │ INSERT (scheduled only: IngestionScheduled)                               │     ↓ fan out by name
                   SYS-002 (EventBridge: scheduled + FoodDataReceived) ── triggers ─→ SYS-019 (ChangeDrivenRefresh)
                        │                                                                  SYS-014 (SourceAdapterRegistry: USDA = fdcId→external_key boundary)
                        │                                                                     ↓ per-source limited     ↓ validates
                        │                                          SYS-006 (PerSourceRollingWindowLimiter)   SYS-020 (AdapterInputValidation/HTTPS)
                        │                                                                     ↓ calls
                        │                                                                  SYS-009 (USDA API — fdcId only here)
                        │                                          normalized candidates ↓
                        │                                          SYS-015 (GoldenRecordMergeEngine) ── records → SYS-017 (ProvenanceStore)
                        │                                          SYS-016 (CandidateResolutionService: /candidates, PATCH resolve)
                        │                                                                     ↓ persists (via SYS-018)
                   (tombstone rows on terminal failure)                                    SYS-007 (canonical PostgreSQL)
                                                                                              ↑ reads/writes
                   SYS-011 (SecretsManager: per-source key) ←── reads ── SYS-014
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Interface                          | Direction | Description                                                                                                                                                                                              |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALB → ECS/Fargate NestJS REST API  | Inbound   | `POST /v1/foods` (by name), `GET /v1/foods/{id}` (+ `/status`), `GET /v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`, `GET /v1/foods/search`, `POST /v1/foods/batch` — all keyed on the internal `id` |
| USDA FoodData Central API          | Outbound  | `GET /v1/food/{fdcId}` (single), `POST /v1/foods` (batch ≤20 `fdcId`s), per-source rolling-window-limited (≤1,000/trailing-60-min). `fdcId` confined to the adapter, HTTPS + cert validation             |
| WebSocket API (optional, deferred) | Outbound  | Real-time `FoodDataReceived` push (carrying the food `id`) to connected clients, per-recipient                                                                                                           |
| Clerk session/M2M token (Bearer)   | Inbound   | Presented at every HTTP entry point and WebSocket `$connect`; verified networklessly via `CLERK_JWT_KEY` (no IdP round trip) by SYS-013                                                                  |

### Internal Interfaces

| SYS-NNN           | Interface Contract                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| SYS-001 → SYS-018 | Add-by-name: `createByName(normalizedName)` under advisory lock → returns existing or new `food.id` (collapses concurrent adds); reads/searches go through DAO methods (`findById`, `searchByName`, `findByExternalKey`)                       |
| SYS-001 → SYS-004 | Distinct-requester record: `INSERT INTO fetch_requesters (food_id, sub) … ON CONFLICT (food_id, sub) DO NOTHING` (a `sub`'s repeats never re-count, FR-044)                                                                                    |
| SYS-001 → SYS-003 | Demand enqueue: `INSERT INTO fetch_queue (food_id) … ON CONFLICT (food_id) DO UPDATE SET request_count = LEAST(distinct-sub count, cap), last_requested = now()` + `pg_notify('fetch_queued', food_id)` — capped distinct-`sub` count (FR-044) |
| SYS-001 → SYS-016 | `getCandidates(id)` → candidate list; `resolve(id, candidateIds)` → validated to the food's candidate set → merge → `RESOLVED` (or `400`/`409`)                                                                                                |
| SYS-005 → SYS-014 | `for each adapter: searchByName(name)`; `fetchByKey(externalKey)` → `CanonicalCandidate`; the USDA adapter maps `fdcId → external_key` internally                                                                                              |
| SYS-005 → SYS-006 | Per-source atomic check-and-record on `source_call_log` (count trailing-60-min calls for `source` + insert the new call in one transaction; Redis sorted-set variant deferred); returns `{ allowed, windowCount }`                             |
| SYS-005 → SYS-015 | `merge(candidates) → { goldenRecord, outcome: 'RESOLVED'                                                                                                                                                                                       | 'UNRESOLVED' }` applying presence-beats-absence / higher-priority / longer-wins / per-100g nutrient rules |
| SYS-005 → SYS-018 | Upsert golden record: `food` (status), `food_sources` (`UNIQUE(source, external_key)`, `item_version`), `food_nutrients`/`food_portions` (`source_id`), `food_field_provenance`; resolve the `fetch_queue` row (or `status='tombstone'`)       |
| SYS-014 → SYS-009 | HTTP GET/POST to USDA with `Authorization`/API-key header (per-source key from Secrets Manager); `fdcId` request keys, mapped to `external_key` on the way in                                                                                  |
| SYS-014 → SYS-020 | `validateAndSanitize(mappedCandidate)` (type/range/length/text); HTTPS + cert validation; reject-not-store on failure                                                                                                                          |
| SYS-015 → SYS-017 | `recordProvenance(food_id, field                                                                                                                                                                                                               | valueRow, source_id)`— scalar fields →`food_field_provenance`; multi-valued rows → `source_id` column     |
| SYS-011 → SYS-014 | Environment/secret injection: per-source API key (e.g. `USDA_API_KEY`)                                                                                                                                                                         |
| SYS-013 → SYS-001 | Verified `AuthenticatedCaller` `{ sub, azp, scopes }` surfaced to HTTP handlers (req context); rejects with `401`/`403`                                                                                                                        |
| SYS-013 → SYS-010 | `$connect` authorizer policy (Allow/Deny); verified `sub` passed via WebSocket `$context.authorizer`                                                                                                                                           |
| SYS-013 → SYS-003 | Pre-enqueue gate: `fetch_queue` depth / circuit-breaker check (`503`) before INSERT; per-`sub` fairness is demotion at drain time (>50 pending → ranked to back), not a quota `429`                                                            |
| SYS-002 → SYS-019 | `IngestionScheduled` cron → change-driven refresh check; re-enqueues only fields whose `item_version` changed upstream                                                                                                                         |

### Interface Contracts Table

| Contract ID | SYS Source | SYS Target | Operation             | Request Schema                                                                                                                                                                             | Response Schema                                                                             |
| ----------- | ---------- | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| IC-001      | SYS-001    | SYS-018    | CreateByName          | `{ name: string }` → normalized; advisory-lock dedup                                                                                                                                       | `{ id: ULID, created: boolean }`                                                            |
| IC-002      | SYS-001    | SYS-003    | EnqueueFetch          | `INSERT INTO fetch_requesters (food_id, sub) ON CONFLICT DO NOTHING`; then `INSERT INTO fetch_queue (food_id) ON CONFLICT (food_id) DO UPDATE` (capped distinct-`sub` count) + `pg_notify` | `{ enqueued: boolean }`                                                                     |
| IC-003      | SYS-001    | SYS-007    | QueryFood             | `id: ULID`                                                                                                                                                                                 | `GoldenRecord \| Pending(202) \| NotFound(404)`                                             |
| IC-004      | SYS-001    | SYS-016    | GetCandidates/Resolve | `id: ULID` / `{ id, candidateIds: string[] }`                                                                                                                                              | `Candidate[]` / `{ id, status: 'RESOLVED' } \| 400/409`                                     |
| IC-005      | SYS-005    | SYS-006    | CheckAndRecordCall    | `{ source }`                                                                                                                                                                               | `{ allowed: boolean, windowCount: number }`                                                 |
| IC-006      | SYS-005    | SYS-014    | FanOutFetch           | `{ name }` → per-adapter `searchByName`; `{ externalKey }` → `fetchByKey`                                                                                                                  | `SourceCandidate[]` / `CanonicalCandidate`                                                  |
| IC-007      | SYS-005    | SYS-015    | Merge                 | `CanonicalCandidate[]`                                                                                                                                                                     | `{ goldenRecord, outcome: 'RESOLVED' \| 'UNRESOLVED' }`                                     |
| IC-008      | SYS-005    | SYS-018    | UpsertGoldenRecord    | `{ goldenRecord, sources[], nutrients[], portions[], provenance[] }`                                                                                                                       | `{ success: boolean, status: food_status }`                                                 |
| IC-009      | SYS-014    | SYS-009    | FetchFromUsda         | `{ fdcIds: number[] }` (≤20; adapter-internal — mapped to `external_key`)                                                                                                                  | `UsdaFoodResponse[]` (HTTPS, validated)                                                     |
| IC-010      | SYS-013    | SYS-001    | VerifyToken           | `Authorization: Bearer <Clerk JWT>` — user session **or** M2M token; networkless via `CLERK_JWT_KEY` + `azp ∈ CLERK_AUTHORIZED_PARTIES` (FR-047/A-012)                                     | `AuthenticatedCaller { sub, azp, scopes } \| 401 \| 403`                                    |
| IC-011      | SYS-013    | SYS-003    | GateEnqueue           | `{ sub, food_id }`                                                                                                                                                                         | `Allow (normal) \| Allow (demoted — sub >50 pending) \| 503 (backpressure/open circuit)`    |
| IC-012      | SYS-013    | SYS-001    | ValidateBatch         | `{ sub, names: string[] }` (`POST /v1/foods/batch`)                                                                                                                                        | `Accepted (≤100) — per-item partial: resolved inline + each miss PENDING (enqueued) \| 400` |
| IC-013      | SYS-013    | SYS-010    | AuthorizeConnect      | `$connect` token (query param / `Sec-WebSocket-Protocol`)                                                                                                                                  | `Allow { $context.authorizer.sub } \| 403 (pinned)`                                         |

## Data Flow View (IEEE 1016 §5.4)

### Path 0: Auth Edge (SYS-013 — fronts every entry point)

Every entry point flows through SYS-013 before SYS-001 business logic, the fairness gate, or any enqueue.
SYS-013 fails closed; Paths 1–5 begin only after this gate is passed.

```
Client → (Authorization: Bearer <Clerk session/M2M token>)
  → ALB → ECS/Fargate NestJS service → AuthMiddleware/FoodAuthGuard (SYS-013)
    → verifyToken(CLERK_JWT_KEY, azp) — networkless [fail-closed]
       ├─ missing/invalid/expired token | azp mismatch | verify error → 401 (no enqueue, no source call)
       ├─ operational endpoint, scope absent from public_metadata     → 403
       └─ valid → req.user = AuthenticatedCaller { sub, azp, scopes }
            → pre-enqueue backpressure + fairness gate (at the fetch_queue INSERT … ON CONFLICT + pg_notify)
               ├─ fetch_queue depth exceeded | source circuit open → 503 (fail closed)
               ├─ sub has >50 pending → enqueue accepted but ranked to BACK (demotion; no 429), dynamic at drain time
               └─ within budget → hand off to SYS-001 (Paths 1–5)
  (status precedence: 401 → 403 → 400 → 404/202/200)
```

(WebSocket `$connect`, SYS-010, deferred US-9: SYS-013's `$connect` Lambda authorizer verifies the same
token and pins rejection to `403` before connection establishment.)

### Path 1: Food Read (RESOLVED Hit)

```
Client → GET /v1/foods/{id}
  → ALB → ECS/Fargate NestJS service → FoodApiController (SYS-001)
    → [optional Redis GET food:{id} (SYS-008) — deferred variant only]
    → DAO findById (SYS-018) → canonical store (SYS-007) [HIT, status='RESOLVED']
    → assemble golden record (scalars + nutrients + portions + per-field provenance)
    → Return 200 { id, name, description, kind, status:'RESOLVED', nutrients[], portions[], provenance{} }
  → Client
```

### Path 2: Read — PENDING / UNRESOLVED / Terminal (no source call)

```
Client → GET /v1/foods/{id}  (or /status)
  → SYS-001 → DAO findById (SYS-018) → SYS-007
    ├─ status PENDING|UNRESOLVED → 202 { id, status, estimatedWaitSeconds }  (UNRESOLVED → client calls /candidates)
    └─ status NOT_FOUND|FAILED | no row → 404 { id, status }  (status retrievable; NO fetch enqueued)
  → Client
```

### Path 3: Add By Name (Cache Miss → Async Resolution)

```
Client → POST /v1/foods { "name": "broccoli" }
  → SYS-001 (validate non-empty name)
    → SYS-018 createByName(normalizedName) under advisory lock
         ├─ existing in-flight normalized name → return existing food.id (collapse; no duplicate row)
         └─ new → INSERT food (id=ULID, normalized_name, status='PENDING')
    → INSERT INTO fetch_requesters (id, sub) ON CONFLICT (food_id, sub) DO NOTHING (SYS-004 — distinct-requester, FR-044)
    → INSERT INTO fetch_queue (food_id) VALUES (id) ON CONFLICT (food_id) DO UPDATE SET request_count = capped distinct-sub count, last_requested = now() (SYS-003)
    → pg_notify('fetch_queued', id)
    → Return 202 { status:'PENDING', id, estimatedWaitSeconds:30 }
  → Client polls GET /v1/foods/{id} until 200 / 404 / UNRESOLVED
```

### Path 4: Fan-Out + Golden-Record Merge (Worker)

```
Postgres LISTEN/NOTIFY (fetch_queued) → Fargate FoodFanOutMergeWorker (SYS-005)
  → validate row provenance (authorized principal / named IAM producer, FR-048) — drop unauthenticated producers
  → SELECT food_id FROM fetch_queue WHERE status='pending' AND last_requested <= now()
       ORDER BY (requester pending-count > 50) ASC, request_count DESC, first_requested ASC
       FOR UPDATE SKIP LOCKED LIMIT 1
     (capped distinct-sub request_count + aging + dynamic >50-pending demotion; no high/low split)
  → UPDATE fetch_queue SET status='in_flight', last_requested=now()   (single 30s in_flight lease; stale >30s reverts to pending)
  → read food.name (the add-by-name query)
  → FOR EACH wired adapter in SourceAdapterRegistry (SYS-014):              (USDA only today; additive)
       → PerSourceRollingWindowLimiter.checkAndRecordCall(source) (SYS-006) [allowed — trailing-60-min < cap]
       → adapter.searchByName(name) → fetchByKey(externalKey)              (USDA: fdcId→external_key, HTTPS)
       → AdapterInputValidation.validateAndSanitize(...) (SYS-020)         [reject-not-store on failure]
  → pre-merge dedup across sources (as far as confident)
  → GoldenRecordMergeEngine.merge(candidates) (SYS-015)
       ├─ exactly one confident survivor → assemble golden record → status='RESOLVED'
       ├─ ≥2 non-collapsible survivors  → status='UNRESOLVED' (surface via /candidates, SYS-016)
       ├─ no source has it              → status='NOT_FOUND' + fetch_queue status='tombstone' (30d TTL); no retry (REQ-025)
       └─ source error after retries    → status='FAILED' + fetch_queue status='tombstone'; re-fetchable (REQ-016/REQ-027)
  → persist via DAO layer (SYS-018): food, food_sources (UNIQUE(source, external_key), item_version),
       food_nutrients/food_portions (source_id), food_field_provenance (SYS-017)
  → resolve fetch_queue row (RESOLVED) | tombstone (terminal); [Redis DEL food:{id} if deferred variant]
  → EventBridge Publish FoodDataReceived { id, status }
```

### Path 5: Disambiguate Candidates and Resolve (Human-in-the-loop)

```
Client → GET /v1/foods/{id}/candidates   (food status='UNRESOLVED')
  → SYS-001 → CandidateResolutionService (SYS-016)
    → Return 200 { id, candidates: [ { candidateId, source, externalKey, name, summary }, ... ] }
Client → PATCH /v1/foods/{id} { "candidateIds": ["c1"] }
  → SYS-016 validate each candidateId ∈ this food's own candidate set
       ├─ out-of-set → 400/409 { error } (status unchanged)
       └─ valid → GoldenRecordMergeEngine.merge (SYS-015) → record user pick as ordinary provenance (SYS-017)
             → food.status='RESOLVED' → Return 200 { id, status:'RESOLVED' }
```

### Path 6: Per-Source Rate-Limited (No Capacity)

```
Postgres LISTEN/NOTIFY (fetch_queued) → Worker (SYS-005)
  → PerSourceRollingWindowLimiter.checkAndRecordCall(source) (SYS-006) [NOT allowed — trailing-60-min ≥ cap, or ≥90% pause]
  → revert the 30s in_flight lease to status='pending' (no source call); pause draining work that needs that source
  → Row remains 'pending'; reprocessed once that source's earlier calls age out of the window
```

### Path 7: Change-Driven Refresh (Scheduled)

```
EventBridge IngestionScheduled (cron) → ChangeDrivenRefresh (SYS-019)
  → for RESOLVED foods, re-fetch each backing source item via its adapter (SYS-014), compare food_sources.item_version
       ├─ unchanged upstream → leave the field intact (incl. user-resolved fields) — no overwrite
       └─ changed upstream    → re-enqueue the affected food as low-priority fetch_queue work (ON CONFLICT, SYS-003)
  → on re-pull: adapter validation (SYS-020) passes → update value + source_id provenance (SYS-017); never blind re-blend
```

## Physical View

| Component         | AWS Resource                                               | Region    | Notes                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALB               | Shared per-stage Application Load Balancer                 | us-east-1 | Public; host-based listener rule (priority 200) fronting the food read service; not service-owned                                                                      |
| FoodApiService    | ECS/Fargate service                                        | us-east-1 | NestJS REST API (SYS-001); in-process `AuthMiddleware` (SYS-013); DAO layer (SYS-018); candidate service (SYS-016)                                                     |
| EventBridge       | Default event bus                                          | us-east-1 | Scheduled producers (change-refresh `IngestionScheduled`) + `FoodDataReceived` only; not on the demand path                                                            |
| FetchQueue        | Postgres `fetch_queue` table                               | us-east-1 | SYS-003; single demand-weighted queue keyed on food `id`; `status pending\|in_flight\|tombstone`; 30s `in_flight` lease; tombstone on terminal (30d TTL for NOT_FOUND) |
| FetchRequesters   | Postgres `fetch_requesters` table                          | us-east-1 | SYS-004; `(food_id, sub)` distinct-requester demand (cap=1) + per-`sub` pending count; also the WebSocket subscription set                                             |
| FanOutMergeWorker | ECS/Fargate task                                           | us-east-1 | Worker (SYS-005); single instance via advisory lock; LISTEN/NOTIFY drain; fan-out (SYS-014) + merge (SYS-015)                                                          |
| PerSourceLimiter  | Postgres `source_call_log` (keyed by `source`)             | us-east-1 | SYS-006; per-source rolling 60-min window (lean); per-source Redis sorted set deferred                                                                                 |
| CanonicalStore    | `kitchensink_food` DB on shared `kitchensink-data-{stage}` | us-east-1 | SYS-007; 12-table source-agnostic schema; logical DB on the shared instance; no new RDS, no cluster                                                                    |
| SourceAdapters    | In-process libraries in the worker                         | us-east-1 | SYS-014; `@kitchensink/usda-client` is the only wired adapter (fdcId→external_key); SYS-009 is the external USDA API                                                   |
| RedisCache        | ElastiCache Redis                                          | us-east-1 | SYS-008; deferred post-launch variant; lean-launch default is Postgres                                                                                                 |
| SecretsManager    | Secrets Manager                                            | us-east-1 | SYS-011; per-source API key (e.g. USDA) rotation                                                                                                                       |
| WebSocketNotifier | API Gateway WebSocket + Lambda                             | us-east-1 | SYS-010; deferred (US-9); `$connect` Lambda authorizer (sole Lambda-authorizer surface, SYS-013)                                                                       |
| CloudWatch        | Log groups, metrics, alarms                                | us-east-1 | SYS-012; API service + worker logging/metrics/alarms; X-Ray                                                                                                            |

## Trade-off Decisions

| Decision                | Chosen Option                                                                                                     | Rationale                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Food identity           | Internal surrogate `id` (ULID), never a source-native key                                                         | The one expensive-to-undo decision (REQ-045/REQ-CN-007); makes multi-source additive without a second migration                               |
| Source coupling         | `fdcId`/USDA confined to the adapter boundary (SYS-009/SYS-014), mapped to `external_key`                         | Rejects "the first source defines the schema" (REQ-046); keeps the canonical model source-agnostic                                            |
| Cross-source assembly   | Fan-out across adapters → golden-record merge with per-field provenance                                           | Deterministic, auditable cross-source data (REQ-050/REQ-051/REQ-052); built now though USDA is the only wired source (costly foundation)      |
| Disambiguation          | `UNRESOLVED` + human pick (`/candidates`, `PATCH`) when not confidently collapsible                               | The human is the final arbiter, so the matcher need not be perfect (REQ-048/REQ-049)                                                          |
| Source API call path    | Async via Postgres `fetch_queue` keyed on food `id` (not sync in API)                                             | Decouples user latency from source availability; the only model consistent with the per-source rolling-window limiter                         |
| Add path                | Add **by name** (`POST /v1/foods`) with normalized-name dedup under an advisory lock                              | Replaces add-by-`fdcId`; the up-front `id` unifies queue key / poll handle / identity (REQ-005/REQ-047)                                       |
| Rate limiter            | **Per-source** rolling 60-min window — Postgres `source_call_log` atomic count+insert (Redis sorted-set deferred) | Strictly enforces ≤ each source's cap in any trailing hour (a refilling bucket could emit ~2×); generalizes USDA-only to per-source (REQ-019) |
| Refresh                 | Change-driven (re-pull a field only when its source item changed upstream), not stale-by-age                      | Keeps data current without overwriting human decisions or churning unchanged values (REQ-031/REQ-053)                                         |
| Fairness model          | Demotion (>50 pending → ranked to back, dynamic at drain time), not per-user quota `429`                          | Work-conserving; no legitimate request rejected; heavy users use only spare capacity                                                          |
| Persistence             | DAO/repository layer (SYS-018); source-boundary input validation + HTTPS (SYS-020)                                | No source-specific SQL leaks; malformed/untrusted source data is rejected, not stored (REQ-054/REQ-055)                                       |
| Notification            | Client polling (WebSocket deferred to US-9)                                                                       | Simpler launch; no WebSocket infra required at MVP                                                                                            |
| Cache layer             | PostgreSQL canonical store by default (Redis deferred)                                                            | Lean launch; add Redis hot cache when p95 warrants it (REQ-CN-002)                                                                            |
| Database initial sizing | Shared `kitchensink-data-{stage}` instance (`kitchensink_food` DB)                                                | Reuses the shared instance; no new RDS, grows with demand (REQ-CN-001)                                                                        |

## Component Traceability Detail

### Component: SYS-001 (FoodApiController)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-033, REQ-047, REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-009

**Traceability Rationale**: SYS-001 is the NestJS controller on ECS/Fargate behind the shared public ALB, with SYS-013's `AuthMiddleware`/`FoodAuthGuard` in-process ahead of every handler. It serves the golden record from the local store only (never a source, REQ-001/REQ-009), returns `200` only when `status='RESOLVED'` (REQ-002), `202` for `PENDING`/`UNRESOLVED` (REQ-003/REQ-033), `404` for `NOT_FOUND`/`FAILED`/no row with the status still retrievable (REQ-004), and `400` for a malformed ULID `id` or empty name (REQ-006). It exposes add-by-name (`POST /v1/foods`, REQ-005/REQ-047/REQ-IF-009), single read + status (REQ-IF-001/REQ-IF-002), and search incl. barcode/`external_key` lookup (REQ-008/REQ-010/REQ-IF-003). Delegates candidate/resolve to SYS-016 and persistence to SYS-018. No `fdcId` appears in any DTO or path param.

### Component: SYS-002 (EventBridgeBus)

**Parent Requirements**: REQ-032, REQ-IF-005

**Traceability Rationale**: SYS-002 carries **only** the scheduled change-driven-refresh producer (`IngestionScheduled`, REQ-032) and the `FoodDataReceived` completion event, whose contract is REQ-IF-005. It is **not** on the demand path — add-by-name enqueues go directly to `fetch_queue` via `INSERT … ON CONFLICT (food_id)` + `pg_notify` from SYS-001.

### Component: SYS-003 (FetchQueue)

**Parent Requirements**: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-018, REQ-039, REQ-IF-005

**Traceability Rationale**: SYS-003 is the **single** Postgres `fetch_queue` keyed on the food `id` (`food_id PRIMARY KEY REFERENCES food(id)`). It implements the demand-path enqueue (REQ-011) and per-`id` multi-add enqueue (REQ-012), queue-grain dedup (`ON CONFLICT`, REQ-013), single-queue demand-weighted admission (REQ-014), demand-weighted drain ordering with aging (REQ-015), the dynamic >50-pending demotion overlay (REQ-039) computed at drain time, and tombstone retention with TTL (REQ-018). Rows carry a single `status` of `pending | in_flight | tombstone`; a no-source/error fan-out sets `status='tombstone'`. `FoodRequested`/`FoodBatchRequested` manifest as these rows (REQ-IF-005), not EventBridge events.

### Component: SYS-004 (FetchRequesters)

**Parent Requirements**: REQ-014, REQ-039

**Traceability Rationale**: SYS-004 models **distinct-requester demand** (FR-044): `(food_id, sub)` upserted `ON CONFLICT DO NOTHING` so a `sub`'s repeats never re-count, capping each `sub`'s contribution at 1 (`PRIORITY_CAP`). It supplies the capped `request_count` feeding SYS-003's ordering (REQ-014), each `sub`'s live pending count for the demotion overlay (REQ-039), and the per-recipient WebSocket subscription set (FR-041). Keyed on the food `id`, not a source key.

### Component: SYS-005 (FoodFanOutMergeWorker)

**Parent Requirements**: REQ-015, REQ-016, REQ-017, REQ-024, REQ-025, REQ-027, REQ-042, REQ-050

**Traceability Rationale**: SYS-005 drains the single `fetch_queue` in demand-weighted order with dynamic demotion (REQ-015), claims one row under a single **30s** `in_flight` lease and reverts stale rows for crash recovery (REQ-017), **fans out across every wired adapter** and merges into the golden record (REQ-050), maps a source `200` into the canonical model with the crosswalk row and emits `FoodDataReceived` (REQ-024), sets `NOT_FOUND` + tombstone when no source has the item (REQ-025), retries transient errors up to 5 attempts then sets `FAILED` + tombstone (REQ-016/REQ-027), and validates async-producer provenance before processing (REQ-042/FR-048). The merge rules and provenance are delegated to SYS-015/SYS-017; the per-source throttle to SYS-006.

### Component: SYS-006 (PerSourceRollingWindowLimiter)

**Parent Requirements**: REQ-019, REQ-020, REQ-021, REQ-026

**Traceability Rationale**: SYS-006 enforces the **per-source** rolling-60-minute window (USDA ≤1,000; pause at 90% / 900, REQ-019), performs the atomic per-source check-and-record on `source_call_log` (REQ-020), holds the worker below the cap by re-deferring the `fetch_queue` row lease when a source is at cap (REQ-021), and backs off treating a source's window as full on a `429` (REQ-026). Each additional wired source gets its own window. Tombstone-TTL retention (REQ-018) belongs to SYS-003.

### Component: SYS-007 (FoodCanonicalPostgresStore)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-008, REQ-010, REQ-028, REQ-029, REQ-NF-018

**Traceability Rationale**: SYS-007 is the normalized, provenance-bearing canonical store (REQ-028) with the access-path indexes for sub-200ms search, lifecycle/refresh queries, and single-query provenance (REQ-029/REQ-010). It backs the lifecycle reads (REQ-002/REQ-003/REQ-004), local-only search incl. barcode/`external_key` via the `food_sources` crosswalk (REQ-008), and faithful nutrient values after per-100g basis normalization (REQ-NF-018). No `fdcId`, no denormalized nutrient columns, no `fetch_status`, no EAV.

### Component: SYS-008 (FoodRedisCache)

**Parent Requirements**: REQ-001, REQ-030

**Traceability Rationale**: SYS-008 is the optional Redis hot cache (deferred post-launch variant; the lean-launch default is the Postgres canonical store, REQ-001). When enabled it uses the `food:{id}` key format with a 24h TTL and `allkeys-lfu` eviction (REQ-030), keyed on the internal `id` (not a source key).

### Component: SYS-009 (UsdaSourceApi)

**Parent Requirements**: REQ-019, REQ-023, REQ-IF-004, REQ-IF-006

**Traceability Rationale**: SYS-009 is the external USDA FoodData Central API — the adapter-boundary external system. It is called only by the USDA adapter (SYS-014) via the per-source limiter (REQ-019), using `GET /v1/food/{fdcId}` and `POST /v1/foods` (≤20 `fdcId`s, 1 windowed call, REQ-023/REQ-IF-004). **`fdcId` exists only here** and is mapped to `external_key` inbound; the USDA API key is held in Secrets Manager (REQ-IF-006).

### Component: SYS-010 (WebSocketNotificationLambda)

**Parent Requirements**: REQ-034, REQ-043, REQ-IF-008

**Traceability Rationale**: SYS-010 is the optional WebSocket push notifier (deferred US-9) emitting `FoodDataReceived`-triggered pushes carrying the food `id` (REQ-034). Its `$connect` authentication, per-recipient targeting via the `fetch_requesters` subscription set, and pinned `403` are specified by REQ-043, with the shared token-in / verified-principal-out contract REQ-IF-008.

### Component: SYS-011 (SecretManagement)

**Parent Requirements**: REQ-IF-006, REQ-044c

**Traceability Rationale**: SYS-011 stores each external source's API key (e.g. the USDA key) in AWS Secrets Manager and injects it into the worker's adapters, never exposing it in responses or logs (REQ-IF-006). Each source's API key remains the only secret on the path (REQ-044c).

### Component: SYS-012 (MonitoringAndLogging)

**Parent Requirements**: REQ-NF-012, REQ-NF-016

**Traceability Rationale**: SYS-012 provides the CloudWatch metrics/alarms that make per-source rolling-window compliance verifiable — no rolling-hour window over a source's cap and zero `429`s under normal operation (REQ-NF-012) — and the tombstone-row count tracking that evidences zero data loss from queue-processing failures (REQ-NF-016).

### Component: SYS-013 (AuthnAuthzLayer)

**Parent Requirements**: REQ-035, REQ-IF-007, REQ-IF-008, REQ-037a, REQ-037b, REQ-037c, REQ-037d, REQ-038a, REQ-038b, REQ-038c, REQ-039, REQ-040a, REQ-040b, REQ-041, REQ-042, REQ-043, REQ-044a, REQ-044b, REQ-044c, REQ-044d

**Traceability Rationale**: SYS-013 is the named auth component (REQ-044d/FR-053) fronting every food data entry point, satisfying the HTTP authentication boundary (REQ-035) by reusing the shared Commise Clerk auth layer (REQ-IF-007). Its deployment is **split**: HTTP routes are gated by in-process NestJS `AuthMiddleware`/`FoodAuthGuard` on the ECS/Fargate service behind the public ALB (an ALB cannot front an API Gateway Lambda authorizer, and the token verifies networklessly so no extra edge layer is warranted), while the deferred WebSocket surface (SYS-010) uses a `$connect` Lambda authorizer. Both reuse `ClerkAuthService` verify logic via shared `@kitchensink/clerk-verify`. SYS-013 produces the `AuthenticatedCaller` consumed by SYS-001 (REQ-IF-008/REQ-037a–d), enforces scope-gated `403` and status precedence (REQ-038a–c), per-`sub` demotion fairness (>50 pending → ranked to back; no `429`) at the `fetch_queue` INSERT (REQ-039), batch/queue `400`/`503` bounds with per-item partial batch responses (REQ-040a/REQ-040b), the M2M token class (REQ-041), async-producer provenance (REQ-042), WebSocket `$connect` auth and per-recipient targeting (REQ-043), and auth-layer load-shed under invalid-token floods (REQ-044a–d). Re-keyed: WebSocket/requester targeting now keys on the food `id`; the rate budget is described per source.

### Component: SYS-014 (SourceAdapterRegistry) — NEW

**Parent Requirements**: REQ-046, REQ-050, REQ-054, REQ-CN-007, REQ-IF-004, REQ-IF-012

**Traceability Rationale**: SYS-014 is the pluggable source-adapter registry + `FoodSourceAdapter` interface (`searchByName`, `fetchByKey`, internal `mapToCanonical`, REQ-054/REQ-IF-012) that SYS-005 iterates to fan out (REQ-050). It is the **adapter boundary that confines `fdcId`/USDA terms** — the USDA adapter (`@kitchensink/usda-client`) is the only wired adapter and the only place a source-native key appears, mapped to `external_key` inbound (REQ-046/REQ-IF-004); no source-native identifier is ever a key in the canonical schema (REQ-CN-007). Adding a source is additive (append an adapter + a `source` enum value) and never touches the canonical schema (REQ-054).

### Component: SYS-015 (GoldenRecordMergeEngine) — NEW

**Parent Requirements**: REQ-050, REQ-051

**Traceability Rationale**: SYS-015 performs the field-level cross-source merge that assembles the golden record (REQ-050) with the normative rules (REQ-051): presence beats absence; identity/short fields take the higher-priority source (NOT longest); free-text longer-wins; nutrients normalized to per-100g before any blend, conflicts resolved to the higher-priority source with `food_nutrients.source_id` recording the winner. It drives the `RESOLVED` (one confident survivor) vs `UNRESOLVED` (residual ambiguity) outcome and records winners via SYS-017.

### Component: SYS-016 (CandidateResolutionService) — NEW

**Parent Requirements**: REQ-048, REQ-049, REQ-IF-010, REQ-IF-011

**Traceability Rationale**: SYS-016 exposes the cross-source candidate set for an `UNRESOLVED` food (`GET /candidates`, each candidate carrying its `source` and item key, REQ-048/REQ-IF-010) and resolves from the user's pick (`PATCH /{id}`, REQ-049/REQ-IF-011), validating each chosen candidate belongs to that food's own candidate set (out-of-set → `400`/`409`, status unchanged), driving the merge (SYS-015), and storing the pick as ordinary provenance (SYS-017). The human is the final arbiter, keeping pre-merge dedup safe.

### Component: SYS-017 (ProvenanceStore) — NEW

**Parent Requirements**: REQ-028, REQ-029, REQ-052

**Traceability Rationale**: SYS-017 stores provenance at the value's grain (REQ-052): a `source_id` reference column on `food_nutrients`/`food_portions`/`food_category_assignment` and the thin `food_field_provenance(food_id, field, source_id)` side-table for scalar fields keyed by a controlled `field` enum (part of the REQ-028 schema). "Which fields came from source X for this food" is answerable by a single query (REQ-029). The user's manual resolution (SYS-016) is stored as ordinary provenance. No verbatim source payload is retained — no EAV, no payload column.

### Component: SYS-018 (FoodDaoRepositoryLayer) — NEW

**Parent Requirements**: REQ-005, REQ-013, REQ-028, REQ-047, REQ-054

**Traceability Rationale**: SYS-018 is the DAO/repository persistence seam through which **all** persistence flows (REQ-054) — per-aggregate DAOs behind the `FoodsRepository`, so services and the worker never issue source-specific SQL. It owns the add-by-name dedup mechanics: the normalized-name unique key + short advisory lock collapsing concurrent adds to one canonical row + `id` (REQ-005/REQ-013/REQ-047) and the idempotent `fetch_queue` `INSERT … ON CONFLICT (food_id)` (queue-grain dedup, REQ-013). It implements the canonical schema's persistence contracts (REQ-028) without source coupling.

### Component: SYS-019 (ChangeDrivenRefresh) — NEW

**Parent Requirements**: REQ-031, REQ-032, REQ-053

**Traceability Rationale**: SYS-019 implements change-driven refresh (REQ-031/REQ-053): once a food is populated our stored values stand, and a scheduled `IngestionScheduled` rule (REQ-032) triggers checks that re-pull a field **only** when its originating external source item changed upstream (detected via `food_sources.item_version`, not stored payload), never blindly re-blending. A user's manual resolution is preserved automatically. Affected fields are re-enqueued as low-priority `fetch_queue` work (deduped via `ON CONFLICT`); re-pulled values pass adapter validation (SYS-020) and update their `source_id` provenance. There is no max-staleness cutoff withholding an already-held record.

### Component: SYS-020 (AdapterInputValidation) — NEW

**Parent Requirements**: REQ-006, REQ-055, REQ-NF-018

**Traceability Rationale**: SYS-020 is the source-boundary input-validation + transport-security capability (REQ-055): each adapter validates/sanitizes the values it maps (type/range checks, length caps, text sanitization) before they enter the canonical store; outbound fetches use HTTPS with certificate validation; a response failing validation is rejected, not stored. It complements SYS-001's request-edge `id`/name validation so no invalid input reaches the canonical schema or the `fetch_queue` (REQ-006), and preserves nutrient fidelity beyond basis normalization (REQ-NF-018).

## Requirements Coverage Summary

| Requirement family                                       | Covering SYS ids                                     |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Local-only serve / read lifecycle (REQ-001..004)         | SYS-001, SYS-007, SYS-018                            |
| Add-by-name / dedup / validation (REQ-005, 006, 047)     | SYS-001, SYS-018, SYS-020                            |
| Status polling (REQ-007, 033)                            | SYS-001                                              |
| Search (REQ-008, 009, 010)                               | SYS-001, SYS-007                                     |
| Demand path / queue / requesters (REQ-011..015, 039)     | SYS-001, SYS-002, SYS-003, SYS-004, SYS-005, SYS-013 |
| Retry / tombstone / lease / TTL (REQ-016..018, 025, 027) | SYS-003, SYS-005, SYS-006                            |
| Per-source rate limiter (REQ-019..021, 023, 026)         | SYS-006, SYS-009, SYS-014                            |
| Single consumer (REQ-022 / REQ-CN-003)                   | SYS-005                                              |
| Source ingestion / crosswalk (REQ-024)                   | SYS-005, SYS-014, SYS-018                            |
| Canonical schema + indexes (REQ-028, 029)                | SYS-007, SYS-017, SYS-018                            |
| Redis (deferred) (REQ-030)                               | SYS-008                                              |
| Change-driven refresh (REQ-031, 032, 053)                | SYS-002, SYS-019, SYS-014                            |
| WebSocket (REQ-034)                                      | SYS-010                                              |
| Auth slice (REQ-035, 037a..044d, IF-007, IF-008)         | SYS-013 (+ SYS-001, SYS-003, SYS-010)                |
| Internal-id identity (REQ-045, CN-007)                   | SYS-007, SYS-014, SYS-018                            |
| fdcId confined to adapter (REQ-046)                      | SYS-009, SYS-014                                     |
| Candidates / resolve (REQ-048, 049, IF-010, IF-011)      | SYS-016, SYS-015                                     |
| Fan-out + golden record (REQ-050)                        | SYS-005, SYS-014, SYS-015                            |
| Merge rules (REQ-051)                                    | SYS-015                                              |
| Per-field provenance (REQ-052)                           | SYS-017, SYS-015                                     |
| Source-adapter interface (REQ-054, IF-012)               | SYS-014, SYS-018                                     |
| Input validation + HTTPS (REQ-055)                       | SYS-020                                              |
| Interface contracts (REQ-IF-001..006, 009)               | SYS-001, SYS-009, SYS-011                            |
| Monitoring (REQ-NF-012, NF-016)                          | SYS-012                                              |

**SYS id inventory (final):** SYS-001..SYS-013 preserved (re-keyed `fdcId → id`, USDA → per-source); SYS-014..SYS-020 new. 20 components total.

```

```
