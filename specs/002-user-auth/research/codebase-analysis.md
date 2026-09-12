# Codebase Analysis: Clerk User Authentication

**Branch**: `002-user-auth` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [data-model.md](../data-model.md), root `package.json`, `AGENTS.md`

---

## Monorepo Layout

KitchenSink is a **Turborepo + npm workspaces** monorepo. Root `package.json` defines four workspace globs:

```json
"workspaces": [
    "packages/tools/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/ui"
]
```

**Turbo tasks** (from root scripts):

- `build` → `turbo run build`
- `test` → `turbo run test`
- `lint` → `turbo run lint format:check`
- `typecheck` → `turbo run typecheck`
- `format` / `format:check` → turbo task wrappers

**Node version**: `>=24.0.0` at monorepo root (`package.json`).

---

## Existing Workspaces Relevant to Feature 002

### `packages/apps/commise/web`

Web authentication integration surface (Next.js + `@clerk/nextjs`) with protected-route redirects and callback handling.

### `packages/apps/commise/mobile`

Mobile authentication integration surface (Expo + `@clerk/expo`) with secure storage (`expo-secure-store`) and deep-link callback handling.

### `packages/ui`

Shared UI layer for auth states and account screens. NFR constraints require accessible naming and token-driven styling.

### `packages/tools/*`

Tooling/automation support. May host migration and deployment helpers used by auth infrastructure flows.

---

## Planned Auth Implementation Surfaces

Per [plan.md](../plan.md), feature 002 implementation is organized around a service-first auth package structure:

| Surface                     | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `src/auth/authorizer/*`     | API Gateway Lambda REQUEST authorizer, JWT validation, policy/context output |
| `src/auth/webhook/*`        | IdP user.created webhook action ingestion and DB sync                        |
| `src/auth/profile/*`        | Profile retrieval and account update endpoints                               |
| `src/auth/deletion/*`       | Account deletion endpoint + async retry consumer                             |
| `src/auth/reconciliation/*` | Nightly IdP↔DB consistency repair job                                        |
| `src/auth/observability/*`  | Structured logs, metrics, tracing, and error tracking integration            |

This structure aligns with tasks in `tasks.md` (T-001 through T-124) and enables isolated testing boundaries.

---

## Data Model Alignment

`data-model.md` defines core entities:

- **User** (`id`, `identity_id`, `email`, `display_name`, `avatar_url`, `status`, timestamps)
- **Account** (subscription/account metadata linked to user)

Critical consistency invariants:

1. `User.id` (UUIDv4) is canonical and must be propagated through Clerk metadata claim flows (FR-015, FR-040).
2. Deletion is cascade-based for all user-owned data paths (FR-025).
3. Suspension state is dual-tracked (IdP block + DB status) for defense-in-depth (FR-041..FR-044).

---

## Architecture Coupling Points

### Auth Boundary to API Gateway

- Authorizer validates JWT claims (`iss`, `aud`, `exp`, signature) and emits allow/deny with context.
- API endpoints consume context rather than duplicating identity lookup where possible.

### Auth Boundary to Database

- Post-registration sync + reconciliation are the primary consistency mechanisms.
- Account lifecycle updates (profile/edit/suspension/reactivation/deletion) remain DB-backed with the IdP as identity authority.

### Auth Boundary to Async Infrastructure

- SQS queue + DLQ handle eventual consistency for IdP deletion API failures.
- EventBridge scheduler drives nightly reconciliation.

---

## Observability Surface

Planned observability stack in source artifacts:

- `@aws-lambda-powertools/logger` for structured logging
- CloudWatch metrics/alarms for auth pipelines and DLQ
- AWS X-Ray for distributed trace continuity
- Sentry integration for serverless exception telemetry

These map directly to NFR-012..NFR-015 and tasks T-003, T-061, T-110..T-112.

---

## Gap Notes (Non-Blocking)

1. `data-model.md` labels storage as Aurora DSQL while `plan.md` and `AGENTS.md` state PostgreSQL 16/RDS context. This is a source inconsistency to resolve during revalidation.
2. Root runtime version is Node 24+ while feature implementation context references Node 22 Lambda runtime. This is expected cross-surface divergence but should be documented in release/build tooling for clarity.

Both gaps are informational and do not block Product Forge bootstrap artifacts.
