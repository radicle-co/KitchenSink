# Codebase Analysis: USDA Food Data Integration

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), root `package.json`, `AGENTS.md`

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._
_Updated 2026-06-28: reconciled to the source-agnostic stabilization baseline (golden-record local store keyed by ULID `id`; `external_key` adapter-only; `FoodFetchCompleted` completion event; `food_candidates`; distinct-requester demand; `FoodAuthGuard`)._

---

## Monorepo Layout

KitchenSink is a Turborepo + npm workspaces monorepo. Root `package.json` currently defines:

```json
"workspaces": [
  "packages/tools/*",
  "packages/apps/commise/web",
  "packages/apps/commise/mobile",
  "packages/ui"
]
```

Turbo tasks are standardized at root (`build`, `test`, `lint`, `typecheck`, `format`, `format:check`).

---

## Existing Workspaces

### `packages/tools/*`

Tooling and utility packages.

### `packages/apps/commise/web`

Web client consuming Commise APIs; downstream consumer of food search + nutrition data.

### `packages/apps/commise/mobile`

Mobile client requiring ingredient-matching and nutrition views.

### `packages/ui`

Shared UI components for web/mobile surfaces.

---

## New Workspaces Required

From plan architecture, feature 003 introduces backend-focused domains:

| New Workspace / Module Boundary        | Purpose                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source adapter module (USDA at launch) | Typed source client behind the adapter boundary + error taxonomy (`SourceApiError`; `UsdaApiError` is adapter-only). Maps the source's native id to `external_key` (USDA's `fdcId` stays inside this boundary).                                                                                                 |
| Food service module                    | Local golden-record lookup by ULID `id`, lifecycle status endpoint, add-by-name + candidate resolution, `pg_trgm` search; `FoodAuthGuard`-protected.                                                                                                                                                            |
| Queue producer module                  | Direct `INSERT … ON CONFLICT (food_id, sub)` into `fetch_requesters` + capped distinct-requester `request_count` (`PRIORITY_CAP=1`) + `pg_notify` (demand); EventBridge only for scheduled producers + `FoodFetchCompleted`.                                                                                    |
| Fargate consumer + reaper module       | Drains `fetch_queue` under an advisory lock (single drainer, `LISTEN/NOTIFY`), fans out per source, merges the golden record, auto-resolves (1 survivor → `RESOLVED`, >1 → `UNRESOLVED`, 0 → `NOT_FOUND`), tombstones terminal failures; reaper reclaims `in_flight` rows older than the 30s `leased_at` lease. |
| Rolling-window limiter module          | `source_call_log` (≤1,000 calls/trailing-hr, pause at 900); Postgres lean default, Redis variant deferred (ARCH-007).                                                                                                                                                                                           |

---

## Conventions

### TypeScript

- Root enforces Node `>=24.0.0` and TypeScript 5.
- Feature spec adds strict TypeScript constraints (NFR-001, NFR-009, NFR-010).

### Code Style

- Lint + format gates required by root scripts and NFR-007.
- JSDoc and aliased imports are constitution-derived requirements (NFR-002, NFR-003).
- Custom errors extend `Error` with matching `is*` guards; the public error surface is `SourceApiError` / `RateLimitWindowFullError` / `FoodNotFoundError` / `CandidateMismatchError` (`UsdaApiError` stays adapter-only).

### Testing Strategy

- Root supports `turbo run test`.
- Spec adds test pyramid and requirement-mapping constraints (NFR-008).

### Environment Management

- USDA API key and infra parameters must remain server-side (A-009).
- URL versioning for the food API (`/v1/foods/*`) is fixed by A-010; the surface is `FoodAuthGuard`-protected (FR-035).

---

## Data Model Summary

`plan.md §2` is the canonical data model: **13 tables** anchored on the `food` golden-record table with an internal ULID `id` primary key (no source-native key as PK/FK). The source's native id is stored as `external_key` (USDA's `fdcId` lives only inside the adapter boundary). Per-source provenance lives in `food_sources`; `food_nutrients` / `food_portions` / `food_field_provenance` reference it via composite `(food_id, source_id)` FKs (`ON DELETE NO ACTION`) so a value can only reference a source row of the **same** food. Nutrient amounts are numeric/decimal — no raw payload, no EAV. `pg_trgm` indexes back local search.

- Food lifecycle status enum: `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED` (no `stale` status — refresh is change-driven).
- `food_candidates` (id, food_id, source, external_key, name, summary, created_at; `UNIQUE(food_id, source, external_key)`) persists the surviving candidate set that backs the `UNRESOLVED` candidate-pick flow (US-2a).
- `fetch_queue` (row status `pending | in_flight | tombstone`, `leased_at` lease column) + `fetch_requesters` carry distinct-requester demand; `source_call_log` is the rolling-window ledger; `source_sync_metadata` tracks change-driven refresh state.

This supports read-path determinism (FR-001/FR-002), async resolution state (FR-003/FR-004), the candidate-resolution flow (FR-RES-1/FR-RES-2/FR-RES-3), and change-driven refresh (FR-031).

---

## Auth Architecture

Food endpoints are protected by a dedicated **`FoodAuthGuard`** (a NestJS guard in the food service — distinct from the identity service's `AuthMiddleware`) that performs **networkless** Clerk session-token verification (public `CLERK_JWT_KEY`, `azp` / authorized-parties enforced), **fail-closed**. Identity comes only from the verified Clerk `sub`; admin scopes/permissions come from the signed token's `public_metadata`. There is deliberately **no** trusted-header identity path — the forgeable `x-debug-sub` header is removed/ignored, because the service is fronted by a public ALB.

- `GET /v1/foods/{id}`
- `GET /v1/foods/{id}/status`
- `GET /v1/foods/search`

Unauthenticated calls return `401` (FR-035, FR-050, FR-053).

---

## Infrastructure

Core runtime topology in plan:

- API layer serving golden records from the local store (`FoodAuthGuard`-protected)
- Demand path: direct `INSERT … ON CONFLICT (food_id, sub)` into `fetch_requesters` + capped distinct-requester `request_count` (`PRIORITY_CAP=1`) + `pg_notify`; EventBridge rules only for scheduled producers and the `FoodFetchCompleted` completion event
- Single demand-weighted `fetch_queue` (+ `fetch_requesters`) ordered `request_count DESC, first_requested ASC`, with **drain-time** demotion (a food is demoted only when **all** its requesters exceed the 50-pending threshold) and near-ceiling flood-shed (`503`, never `429`); tombstone rows for terminal failures (no DLQ)
- Single-instance Fargate consumer worker (advisory lock = single drainer, LISTEN/NOTIFY) + a reaper that reverts `in_flight` rows whose `leased_at < now() - 30s` back to `pending`
- Change-driven refresh as a low-priority Fargate scheduled task (idle-drain, yields to live demand) via re-fetch + `item_version` hash compare; never overwrites a user's manual pick
- Rolling-window limiter on `source_call_log`; deferred Redis variant (ARCH-007), PostgreSQL as durable source of truth

---

## Workspace Dependency Graph

```
Commise Web/Mobile
    -> /v1/foods API (FoodAuthGuard)
        -> PostgreSQL local store (deferred Redis variant) (read path)
        -> fetch_requesters/fetch_queue (+pg_notify) (on add-by-name miss)
            -> Fargate worker (advisory lock, LISTEN/NOTIFY) + reaper (leased_at)
                -> rolling-window limiter (source_call_log)
                    -> source adapter (USDA at launch)
                    -> PostgreSQL golden-record upsert (tombstone on terminal failure)
```

---

## Gaps and Pending Decisions

1. Redis rollout timing remains threshold-based (A-002).
2. WebSocket notifications remain deferred (A-007 / FR-034).
3. Ingredient substitution and unit conversion are UX-documented but not standalone FRs (warnings in verify report).

---

## Source File References

- [../spec.md](../spec.md)
- [../plan.md](../plan.md)
- [../tasks.md](../tasks.md)
- [../../../AGENTS.md](../../../AGENTS.md)
- [../../../package.json](../../../package.json)
