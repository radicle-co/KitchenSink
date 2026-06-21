# Codebase Analysis: USDA Food Data Integration

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), root `package.json`, `AGENTS.md`

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

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

| New Workspace / Module Boundary | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| USDA API module                 | Typed USDA client + error taxonomy                                                                           |
| Food service module             | Local-store lookup, status endpoint, search                                                                  |
| Queue producer module           | Direct `INSERT … ON CONFLICT` + `pg_notify` (demand); EventBridge for scheduled producers + FoodDataReceived |
| Fargate consumer worker module  | Drains fetch_queue (advisory lock, LISTEN/NOTIFY) + USDA upsert + tombstone on terminal failure              |
| Rolling-window limiter module   | usda_call_log (≤1,000/trailing-hr, pause at 900); Postgres lean default, Redis deferred                      |

---

## Conventions

### TypeScript

- Root enforces Node `>=24.0.0` and TypeScript 5.
- Feature spec adds strict TypeScript constraints (NFR-001, NFR-009, NFR-010).

### Code Style

- Lint + format gates required by root scripts and NFR-007.
- JSDoc and aliased imports are constitution-derived requirements (NFR-002, NFR-003).

### Testing Strategy

- Root supports `turbo run test`.
- Spec adds test pyramid and requirement-mapping constraints (NFR-008).

### Environment Management

- USDA API key and infra parameters must remain server-side (A-009).
- URL versioning for food API (`/v1/foods/*`) fixed in FR-035 + A-010.

---

## Data Model Summary

Plan/spec require local food persistence around `foods` core table with fetch lifecycle fields:

- primary key `fdc_id`
- status lifecycle (`pending`, `fetched`, `failed`, `not_found`, `stale`)
- nutrient payload and search-oriented indexes
- stale-refresh and request-count metadata

This supports read-path determinism (FR-001/FR-002), async fetch state (FR-003/FR-004), and stale management (FR-031/FR-032).

---

## Auth Architecture

Food endpoints inherit existing Commise auth boundary (shared API Gateway authorizer), not a separate auth stack.

- `GET /v1/foods/{fdcId}`
- `GET /v1/foods/{fdcId}/status`
- `GET /v1/foods/search`

Unauthenticated calls return `401` (FR-035).

---

## Infrastructure

Core runtime topology in plan:

- API layer serving from local store
- Demand path: direct `INSERT … ON CONFLICT` into fetch_queue + `pg_notify`; EventBridge rules for scheduled producers + FoodDataReceived only
- Single demand-weighted fetch_queue (+ fetch_requesters) with dynamic demotion (>50 pending → back); tombstone rows for terminal failures (no DLQ)
- Single-instance Fargate consumer worker (advisory lock, LISTEN/NOTIFY)
- Rolling-window limiter on usda_call_log; deferred Redis accelerator, PostgreSQL as durable source of truth

---

## Workspace Dependency Graph

```
Commise Web/Mobile
    -> /v1/foods API
        -> PostgreSQL + deferred Redis (read path)
        -> fetch_queue (+pg_notify) (on miss)
            -> Fargate worker (advisory lock, LISTEN/NOTIFY)
                -> rolling-window limiter (usda_call_log)
                    -> USDA API
                    -> PostgreSQL upsert + cache fill (tombstone on terminal failure)
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
