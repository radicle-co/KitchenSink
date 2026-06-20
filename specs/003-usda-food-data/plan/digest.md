# Phase 5 (Plan) Digest — 003-usda-food-data

**Date:** 2026-06-19
**Scope:** Re-plan to add auth coverage (closes sync-verify DRIFT-101 + red-team RT-2026-06-19). Existing §1–§10 design retained; new **§2A Authentication & Authorization** added and API contract updated.

## Key decisions

- **`FoodAuthGuard`** — single named auth component fronting every food entry point (HTTP + WS `$connect`); networkless Clerk `verifyToken` (`CLERK_JWT_KEY` + `azp`), mirroring the identity service's `ClerkAuthService`/`AuthMiddleware`. Closes the "auth absent from architecture" gap (FR-053 / RT F-002).
- **Deployment LOCKED (2026-06-19): in-process NestJS `AuthMiddleware` on ECS/Fargate (ALB).** FoodService is NestJS on ECS/Fargate behind a public ALB (same as identity). A Lambda authorizer can't front an ALB (API Gateway-only), so auth verifies in-process (~1ms, networkless) via shared `ClerkAuthService` code. A `$connect` Lambda authorizer is used only for the deferred API Gateway WebSocket API; FR-050 cache rules apply there only.
- **Two token classes** (FR-047/A-012): user session token + M2M token for downstream services (001/006/007/009) and internal jobs — resolves the CRITICAL that backend callers couldn't authenticate (RT F-006).
- **Auth ≠ rate limiting:** per-`sub` enqueue quota → `429` (FR-043), distinct-requester demand via new `fetch_requesters` table (FR-044), max batch size → `400` (FR-045), queue depth + circuit breaker → `503` (FR-046). Closes insider denial-of-wallet (RT F-001/011/013/014).
- **Status precedence** `401`→`403`→`400`→`404`/`202`/`200` (FR-051); `403` for insufficient scope.
- **New data:** `user_fetch_quota` (or Redis), `fetch_requesters` (also drives per-`sub` WebSocket notification targeting, FR-041/049).

## Top NFRs

1. SC-011 — auth verification ≤10ms p95, validated under invalid-token flood (FR-052).
2. SC-012 — no single `sub` consumes >~20% of the global USDA budget (FR-043).
3. SC-002 — global USDA budget never exceeds 1,000/hr (unchanged; now defended at the per-user layer too).

## Artifacts produced

- `plan.md` — added §2A (8 subsections), updated §1 system context, §3 endpoints table + auth response shapes (401/403/429/400/503).
- No new ADRs.

## Open risks / trade-offs

- **Quota store** — Redis vs Postgres `user_fetch_quota`; lean-launch (no Redis, per A-002) implies Postgres initially.
- The spec↔plan async architecture divergence (spec: API Gateway+SQS+Redis; plan: Fargate+Postgres-queue) predates this re-plan and remains; §2A documents auth for both but the broader divergence should be reconciled in a later sync-verify.

## Handoff notes for tasks (Phase 5B)

- Generate an **auth task group** covering FR-035–FR-053: `FoodAuthGuard` (verify + azp + fail-closed), M2M token support, per-`sub` quota + `429`, `fetch_requesters` + distinct-requester demand, batch cap, queue backpressure/circuit breaker, WebSocket auth + targeting, status precedence/`403`, async-producer IAM, auth-layer DoS protection.
- Add migration tasks for `user_fetch_quota` and `fetch_requesters`.
- Every auth FR must get ≥1 task and trace into the v-model V&V chain (requirements → design → unit/integration/system/acceptance tests → traceability → hazard for auth-bypass/denial-of-wallet).
- TDD: auth tests (401/403/429, azp rejection, no-broadcast WS, one-user-can't-starve-others) are `Test-first: true`.

## Prior lessons applied

None — `research/README.md` has no "Prior lessons that apply" section; none forwarded.
