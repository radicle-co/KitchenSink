# Phase 5 (Plan) Digest — 003-usda-food-data

**Date:** 2026-06-19 (re-baselined 2026-06-21; **reconciled to the stabilized plan 2026-06-27**)
**Scope:** Originally a re-plan to add auth coverage (closes sync-verify DRIFT-101 + red-team RT-2026-06-19). The plan was then re-baselined to the **source-agnostic food data model** and **stabilized** per the decision register. This digest reflects the **stabilized** §1–§10 plan: source-agnostic golden-record schema, the §2A auth slice, distinct-requester demand, fairness-by-demotion (no quota/`429`), and the canonical `FoodFetchCompleted` completion event.

## Key decisions

- **Source-agnostic golden record.** A food is keyed by an internal ULID `id` (never a source key); USDA is one pluggable source adapter; foods are assembled into a cross-source golden record with per-field provenance. `fdcId` exists **only** inside the USDA adapter boundary (`fdcId → external_key`). The canonical store is **13 tables** (§2), including **`food_candidates`** (backs `UNRESOLVED` / disambiguation US-2a) and a `leased_at` worker-lease column on `fetch_queue`.
- **`FoodAuthGuard`** — single named auth component fronting every food entry point (HTTP + WS `$connect`); networkless Clerk `verifyToken` (`CLERK_JWT_KEY` + `azp`), mirroring the identity service's `ClerkAuthService`/`AuthMiddleware`. Identity comes **only** from the verified token `sub`; the forgeable `x-debug-sub` (and any trusted-header identity) path is **removed**. Closes the "auth absent from architecture" gap (FR-053 / RT F-002).
- **Deployment LOCKED (2026-06-19): in-process NestJS middleware on ECS/Fargate behind the shared per-stage ALB.** A Lambda authorizer can't front an ALB (API Gateway-only), so auth verifies in-process (~1ms, networkless) via the shared `@kitchensink/clerk-verify` package. A `$connect` Lambda authorizer is used only for the deferred API Gateway WebSocket API; FR-050 cache rules apply there only.
- **Two token classes** (FR-047/A-012): user session token + M2M token for downstream services (001/006/007/009) and internal jobs — resolves the CRITICAL that backend callers couldn't authenticate (RT F-006).
- **Auth ≠ rate limiting; fairness is by demotion, not quota.** There is **no per-`sub` enqueue quota and no `429`** on enqueue/reads/resolves. Fairness is **demotion at drain time** (FR-043): a `sub` with >50 pending items is ranked to the back; a shared food is demoted only when **all** its requesters exceed the threshold (FR-043a). Demand priority is the **capped distinct-`sub` count** via the `fetch_requesters` table (FR-044) — never a raw `+1`. Near the **global** rolling-window ceiling, a flooding `sub`'s **NEW** enqueues are shed first with **`503`** (FR-043b). Max batch size → `400` (FR-045); queue depth + circuit breaker → `503` (FR-046). Closes insider denial-of-wallet (RT F-001/011/013/014).
- **Completion event = `FoodFetchCompleted`** (matches plan §4 + the deployed CDK `FoodFetchCompletedRule`, `detailType: ['FoodFetchCompleted']`). The demand path (`FoodRequested`/`FoodBatchRequested`) is an in-process `fetch_queue` enqueue, **not** an EventBridge event.
- **Status precedence** `401`→`403`→`400`→`404`/`202`/`200` (FR-051); `403` for insufficient scope.
- **Settled lifecycle/refresh semantics.** Survivor-count auto-resolve (1→`RESOLVED`, >1→`UNRESOLVED`, 0→`NOT_FOUND`; no nutrient tolerance — FR-MRG-5); `UNRESOLVED` kept until a human picks, candidate set expires after 30 days then re-fans-out (FR-025a); legal transition set + manual-pick protection + idempotent candidate-validated `PATCH`-resolve (FR-028a); change-refresh is a **Fargate scheduled task** (idle-drain, budget-bounded), re-enqueuing via the ordinary path (D-REFRESH).
- **Operational data:** `fetch_requesters` (distinct-requester demand + per-`sub` pending count for demotion **and** WebSocket targeting, FR-041/049) and `source_call_log` (per-source rolling-60-min window, pruned beyond the window). **No quota tables.**

## Top NFRs

1. SC-011 — auth verification ≤10ms p95, validated under invalid-token flood (FR-052).
2. SC-002 — per-source rolling-60-min budget never exceeded (USDA ≤1,000/hr), held by the single-drainer advisory lock making the count-and-record serial (FR-019/FR-022).
3. SC-005 / SC-014 — local-store **serve** throughput stays high (reads with no source call) while **first-time NEW-food resolution** is budget-bounded (~500–900/hr); the two are distinct metrics.

## Artifacts produced

- `plan.md` — §2A auth slice (8 subsections); §2 source-agnostic 13-table schema (incl. `food_candidates`, `leased_at`, same-food composite provenance FKs); §3 endpoints + auth response shapes (`401`/`403`/`400`/`503`; **no `429`**); §4 event contracts (`FoodFetchCompleted`, distinct-requester enqueue SQL); §5 fan-out/merge worker (survivor-count rule, lifecycle transitions, reaper, Fargate change-refresh); §9 settled decisions.
- No new ADRs (the Fargate change-refresh cites ADR-0004 for the egress/compute-placement rationale only).

## Open risks / trade-offs

- **No Redis at launch (per A-002).** The Redis read-through cache and Redis sorted-set limiter are deferred post-launch variants (ARCH-007); reintroduce only when single-Postgres `ORDER BY fetch_queue` or read latency exceeds the A-002 thresholds.
- **Shared-instance posture.** `kitchensink_food` reuses the shared `kitchensink-data-{stage}` instance (`multiAz: false`); SC-009's 99.9% is a future shared-DB concern (A-013/T-061).

## Handoff notes for tasks (Phase 5B)

- Generate an **auth task group** covering FR-035–FR-053: `FoodAuthGuard` (verify + azp + fail-closed), M2M token support, fairness-by-demotion (FR-043/FR-043a) + near-ceiling flood-shed `503` (FR-043b), `fetch_requesters` + distinct-requester demand (FR-044), batch cap (FR-045), queue backpressure/circuit breaker (FR-046), WebSocket auth + targeting, status precedence/`403`, async-producer IAM, auth-layer DoS protection. **No `429`/quota tasks.**
- Add migration tasks for `fetch_requesters`, `food_candidates`, the `leased_at` lease column, and the same-food composite provenance FKs.
- Every auth FR must get ≥1 task and trace into the v-model V&V chain (requirements → design → unit/integration/system/acceptance tests → traceability → hazard for auth-bypass/denial-of-wallet).
- TDD: auth tests (`401`/`403`/`503`, azp rejection, no-broadcast WS, one-user-can't-starve-others, flood-shed near ceiling) are `Test-first: true`.

## Prior lessons applied

None — `research/README.md` has no "Prior lessons that apply" section; none forwarded.
