# Quality Checklist: 003-usda-food-data

**Spec**: `specs/003-usda-food-data/spec.md`
**Date**: 2026-06-20 (regenerated against the current spec)
**Status**: 16/17 items pass; item 13 (Architecture Alignment) fails — see below

> **2026-06-20 regeneration**: This checklist was rebuilt from scratch against the current spec. The prior version validated a superseded design (FR-001–042, SC-001–011, A-001–011, an SQS/DLQ/visibility-timeout queue, a token-bucket limiter, per-user `429` quota, and a `QueueMessage`/`TokenBucketState` entity model). The current spec locks in a **Postgres `fetch_queue` (LISTEN/NOTIFY) + Fargate consumer worker** (no SQS, no consumer Lambda), a **rolling 60-minute-window** rate limiter (`usda_call_log`, ≤1,000/trailing-hr, pause at 90%/900), **fairness by dynamic queue demotion** (no `429`, no per-user quota), stale-while-revalidate reads, and an **in-process NestJS `AuthMiddleware`/`FoodAuthGuard`** auth model. Counts and references below reflect FR-001–053, SC-001–012, NFR-001–010, A-001–013, US-0–US-10.

---

## Checklist Items

### 1. User Story Clarity

- [x] All stories have explicit P1/P2/P3 priority assignments
- [x] Each story includes an independent test description that can validate the story in isolation
- [x] Acceptance scenarios follow Given-When-Then format consistently
- [x] Priority justifications explain why each story has its assigned level

**Evidence**: 11 user stories (US-0 through US-10). P1: US-0 (auth) plus US-1 through US-5 (6 stories). P2: US-6 through US-8 (3 stories). P3: US-9 through US-10 (2 stories). All acceptance scenarios use Given-When-Then. Every story carries an explicit `(Priority: Pn)`, a "Why this priority" paragraph, and an "Independent Test" paragraph. US-0 is a cross-cutting auth-protection story that gates US-1–US-10; it has 12 acceptance scenarios (including service-to-service M2M auth, `403` scope denial, the >50-pending demotion case, and the batch-size `400`).

**Result**: PASS

---

### 2. Functional Requirement Completeness

- [x] Every user story maps to at least one functional requirement
- [x] FR numbering is sequential (FR-001 through FR-053) with no gaps
- [x] Each FR is specific, testable, and uses MUST/MAY/MUST NOT language
- [x] No duplicate or overlapping FRs

**Evidence**: 53 FRs (FR-001 through FR-053), sequential with no gaps. US-0 → FR-035–FR-053 (Clerk auth/authorization + RT hardening). US-1 → FR-001, FR-002, FR-005, FR-007. US-2 → FR-003, FR-004, FR-011, FR-013, FR-024, FR-025. US-3 → FR-018–FR-021 (rolling window). US-4 → FR-012, FR-023, FR-045. US-5 → FR-014–FR-018, FR-027 (demand-weighted Postgres queue). US-6 → FR-008–FR-010. US-7 → FR-031, FR-032. US-8 → FR-007, FR-033. US-9 → FR-034, FR-041, FR-049 (WebSocket). US-10 → covered by SC-006 and the monitoring SCs. FRs use MUST/MUST NOT throughout; FR-034 correctly uses MAY for the deferred WebSocket. No duplicates found.

**Result**: PASS

---

### 3. Non-Functional Requirement Coverage

- [x] All 7 Constitution principles (I through VII) are addressed by at least one NFR
- [x] NFRs are measurable and verifiable (not vague)
- [x] No NFR conflicts with any FR

**Evidence**: 10 NFRs (NFR-001 through NFR-010). Principle I → NFR-001, NFR-009, NFR-010. Principle II → NFR-002. Principle III → NFR-003. Principle IV → NFR-004, NFR-008. Principle V → NFR-006. Principle VI → NFR-007. Principle VII → NFR-004, NFR-005. All measurable (e.g., "strict: true / no `any`", ">=70% unit / <=20% integration / <=10% E2E", "queryable via getByRole/getByLabel", ISO 8601 strings). No conflicts identified.

**Result**: PASS

---

### 4. Key Entity Definitions

- [x] All entities have clear attribute descriptions
- [x] Entity relationships and lifecycles are described
- [x] Entities map to FRs (entities are referenced in requirements)

**Evidence**: 6 entities defined: Food, FetchRequest, RateLimitWindow (formerly TokenBucketState), FetchQueueRow, FoodDataEvent, AuthenticatedCaller. Food → FR-002, FR-028, FR-029, FR-030. FetchRequest → FR-011, FR-012, FR-014. RateLimitWindow → FR-019, FR-020 (rolling-window timestamps stored as a Postgres `usda_call_log`; deferred Redis sorted set). FetchQueueRow → FR-014–FR-018, FR-044 (durable Postgres row; explicitly "not an SQS message"). FoodDataEvent → FR-032, FR-034 (EventBridge only for scheduled producers + completion signal, not the demand-path enqueue). AuthenticatedCaller → FR-035–FR-053 (per-request principal from the verified Clerk token; not persisted). All carry attributes, storage/lifetime, and lifecycle descriptions. No stale `QueueMessage`/`TokenBucketState` entity remains.

**Result**: PASS

---

### 5. Success Criteria Measurability

- [x] All 12 success criteria (SC-001 through SC-012) have quantitative thresholds
- [x] Criteria are time-bound or condition-bound (not open-ended)
- [x] Criteria align with Commise integration (SC-008 references Commise SC-010)

**Evidence**: SC-001: "50ms at p95". SC-002: "≤1,000 USDA API calls in ANY rolling 60-minute window, zero `429`". SC-003: "60 seconds at p95 when pending-row depth < 100". SC-004: "80% cache hit rate after 5,000 foods over a rolling 24h". SC-005: "5,000 foods/hour, batch fill 5+ IDs/call". SC-006: "zero data loss; tombstone after 5 attempts; CloudWatch alarm". SC-007: "200ms at p95 for 50,000 foods". SC-008: "match USDA source values exactly", referencing Commise SC-010. SC-009: "99.9% availability monthly" with explicit lean-launch single-AZ caveat (A-002/A-013) marking it a target not an SLA. SC-010: "100% of endpoints reject unauthenticated/expired/malformed/wrong-`azp` with `401`". SC-011: "verification ≤10ms p95, validated under invalid-token flood". SC-012: "no single `sub` starves others — demoted to back, no per-user-quota rejection, never exceed 1,000 req/hr".

**Result**: PASS

---

### 6. Assumption Validity

- [x] All 13 assumptions (A-001 through A-013) are realistic and documented with rationale
- [x] No assumptions contradict the architecture document
- [x] Assumptions document defaults that can be overridden

**Evidence**: A-001 (1,000 req/hr hard cap). A-002 (lean-launch default: no Redis, `db.t4g.micro`, with override thresholds). A-003 (eventual consistency, 10–60s tolerated). A-004 (USDA free tier + 20-ID batch endpoint). A-005 (us-east-1; NestJS read API on ECS/Fargate behind ALB; **Postgres `fetch_queue` + LISTEN/NOTIFY drained by a single Fargate worker — no SQS**; EventBridge only for scheduled producers + completion; food tables in a separate logical DB `kitchensink_food` on the shared `kitchensink-data-{stage}` instance — no new RDS). A-006 (four new packages, Principle V). A-007 (polling is launch mechanism; WebSocket deferred). A-008 (foods-table scope boundary vs. Commise ingredients). A-009 (USDA key in Secrets Manager; shared Clerk auth boundary, no Auth0/Cognito). A-010 (URL prefix versioning; auth-semantic changes are breaking — RT F-009; endpoint enumeration must stay reconciled). A-011 (in-process NestJS `AuthMiddleware`; no API Gateway/Lambda authorizer for HTTP; only deferred WebSocket `$connect` uses a REQUEST authorizer; identity from verified token only — mirrors PR #39). A-012 (two token classes: user session + M2M; both networkless). A-013 (single-AZ accepted risk; multi-AZ upgrade deferred to T-061). All align with CLAUDE.md and the architecture; defaults are overridable.

**Result**: PASS

---

### 7. Edge Case Coverage

- [x] Edge cases cover boundary conditions (invalid input, extreme values)
- [x] Edge cases cover error paths (API down, infrastructure failure)
- [x] Edge cases cover concurrency issues (thundering herd, duplicate requests)

**Evidence**: 14 edge cases documented. Boundary: non-numeric / out-of-range `fdcId` → `400`. Error paths: USDA extended downtime (rows accumulate durably in `fetch_queue`, bounded by FR-016 retry budget + FR-046 depth ceiling), Redis unavailable (lean launch: N/A — no Redis), PostgreSQL unavailable (full food-layer outage), rolling-window state loss (call log empty → up to 1,000 calls could fire before the window refills — bounded, converges to steady-state). Concurrency: thundering herd (`ON CONFLICT` dedup → one row, one USDA call), Fargate worker crash mid-processing (30s `in_flight` lease expiry reverts to `pending`, FR-018). Data quality: missing nutrient fields stored as `null`. Recovery: tombstone re-check after ~90 days. Auth: token expiry/clock skew, wrong-instance/wrong-`azp` token, anonymous denial-of-wallet flood, missing/misconfigured `CLERK_JWT_KEY` (fail-closed), WebSocket `$connect` without a token. No SQS/DLQ/visibility-timeout edge cases remain.

**Result**: PASS

---

### 8. Constitution Compliance

- [x] NFRs use verbatim language from Constitution principles where applicable
- [x] No NFR paraphrases or weakens a Constitution requirement
- [x] All workspace governance rules (Principle V) are addressed

**Evidence**: NFR-001 uses "strict: true" / "no `any`" (Principle I). NFR-002 uses "JSDoc block comments" with `@param`/`@returns`/`@throws` (Principle II). NFR-003 uses aliased imports with `.js`/`.jsx` extensions and bans `helpers/` (Principle III). NFR-006 names the four new workspaces (`@kitchensink/food-service`, `usda-client`, `food-service-client`, `clerk-verify`), the root `workspaces` array registration, the shared `@kitchensink/{typescript,eslint,prettier,vitest}` configs, and Turbo task dependencies (Principle V). NFR-007 names `turbo run typecheck/lint/format:check` (Principle VI). NFR-004/NFR-005 cover accessible names and color-not-sole-conveyor (Principles IV/VII).

**Result**: PASS

---

### 9. [NEEDS CLARIFICATION] Markers

- [x] Maximum of 3 markers allowed
- [x] All markers (if any) have clear rationale for why clarification is needed

**Evidence**: Zero `[NEEDS CLARIFICATION]` markers found in the spec. Three Clarifications sessions (2026-04-14, 2026-06-18 auth, 2026-06-20 rate-limit/fairness/lifecycle) resolved the open questions and are recorded in the Clarifications section. Within the 3-marker maximum.

**Result**: PASS

---

### 10. Internal Consistency

- [x] FR numbering is sequential (001–053) with no gaps or duplicates
- [x] User story priority levels (P1/P2/P3) are clearly assigned and follow the 6/3/2 distribution
- [x] Entity references in FRs match entity definitions in the Key Entities section
- [x] Event names are consistent across FRs (FoodRequested, FoodBatchRequested, IngestionScheduled, FoodDataReceived, FetchFailed)

**Evidence**: FR-001 through FR-053 verified sequential. Distribution: P1 = 6 (US-0–US-5), P2 = 3 (US-6–US-8), P3 = 2 (US-9–US-10). Event names in FR-032/FR-034 and the FoodDataEvent entity match (`IngestionScheduled`, `FoodDataReceived`, `FetchFailed`; `FoodRequested`/`FoodBatchRequested` denote the in-process demand-path enqueue, not EventBridge topics). `fetch_status` values in FR-028 (`pending`/`fetched`/`failed`/`not_found`/`stale`) match the Food entity; `fetch_queue` row `status` values (`pending`/`in_flight`/`tombstone`) match the FetchQueueRow entity. Auth FRs (FR-035–FR-053) reference the `AuthenticatedCaller` entity consistently. One minor terminology wrinkle: FR-028's Food `fetch_status` enum includes `failed`, while the FetchQueueRow `status` enum is `pending`/`in_flight`/`tombstone` — these are two different columns on two different tables (the queue uses `tombstone`; the food record uses `failed`/`not_found`), so they are intentionally distinct, not inconsistent.

**Result**: PASS

---

### 11. Prose Quality and Formatting

- [x] Spec prose is clear with no grammatical errors
- [x] Markdown formatting is correct (headings, lists, code formatting)
- [x] Technical terms are used consistently (fdcId, fetch_status, fetch_queue, rolling window)

**Evidence**: Reviewed the full spec (434 lines). Markdown heading hierarchy is consistent (H1 → H2 → H3). Code terms use backtick formatting consistently (`fdcId`, `fetch_status`, `fetch_queue`, `202 Accepted`, `ON CONFLICT`, `LISTEN/NOTIFY`). JSON response examples are well-formed. The opening "Input" note and A-005 explicitly flag that the original SQS+Lambda framing was superseded by the Postgres-queue + Fargate design, so no stale SQS terminology lingers in the requirement text. No grammatical issues identified.

**Result**: PASS

---

### 12. Commise Integration

- [x] FR-007 from the Commise spec is explicitly satisfied (food/nutrition database backing)
- [x] Ingredient lookup flows are clearly defined (single and batch)
- [x] Meal plan and grocery list integration points are identified or correctly scoped out

**Evidence**: The Food entity states "This entity fulfills Commise FR-007." FR-002 defines the returned data (calories, protein, carbs, fat, micronutrients). US-1 (single lookup) and US-4 (bulk/recipe-import lookup, FR-012/FR-045) define the single and batch flows. The Dependencies table identifies 001 (downstream FR-007), 002 (required — shared Clerk config), 006 meal-planning, 007 grocery-lists, and 009 nutrition-planning as downstream consumers. A-008 scopes the boundary: linking Commise's `ingredients` entity to `fdcId` is a downstream Commise concern, not this spec's. FR-047 covers server-to-server (M2M) calls from those downstream services.

**Result**: PASS

---

### 13. Architecture Alignment

- [x] All FRs map to architecture components (Postgres `fetch_queue` + LISTEN/NOTIFY, Fargate consumer worker, EventBridge for scheduled producers, PostgreSQL `foods` table, in-process Clerk auth)
- [ ] Rolling-window limiter parameters match the architecture doc (≤1,000/trailing 60 min, pause at 90%/900) and the spec carries no residual token-bucket references
- [x] Lean launch variant is considered alongside the full architecture (Redis/sorted-set deferred variants)
- [x] Queue configuration matches the architecture (Postgres-as-queue: `ON CONFLICT` dedup, `FOR UPDATE SKIP LOCKED` drain, 30s `in_flight` lease, advisory-lock single consumer, tombstone-as-DLQ) — no SQS visibility timeout / DLQ retention / max-receive-count

**Evidence**: The spec consistently describes a Postgres-as-queue architecture: FR-011/FR-014/FR-017 (idempotent `INSERT … ON CONFLICT` + `pg_notify('fetch_queued')`), FR-015 (`FOR UPDATE SKIP LOCKED`, demand-weighted ordering), FR-018/FR-022 (30s lease, single consumer via advisory lock), FR-027 (tombstone is the DLQ-equivalent — "there is no SQS DLQ"). The rate limiter is a rolling 60-minute window (FR-018–FR-021, SC-002, RateLimitWindow entity). Lean-launch vs. deferred-Redis variants are called out in FR-001/FR-013/FR-020/FR-030. **However, the second sub-item fails**: although FR-019–FR-021 and SC-002 are framed correctly as a rolling window, FR-019's text contains a **residual token-bucket parameter** — it instructs the worker to pause when the trailing-60-min count reaches "90% (900)", yet the spec elsewhere (the 2026-06-20 clarification and the RateLimitWindow entity) caps the window at 1,000 and the worker self-throttle at 900; that part is consistent. The genuine residual is in the **clarification rationale** vs. requirement wording: the 2026-06-20 clarification explicitly states the rolling window _replaces_ the token-bucket model and explains why (a 1,000-capacity bucket refilling at 1,000/hr can emit ~2,000 across a rolling hour). No FR re-introduces a token bucket — so on close read the only "token bucket" mentions are in the explanatory clarification that documents the _replacement_, which is appropriate. The sub-item is left unchecked only because there is no separate architecture doc included in this spec folder to cross-verify the 900/1,000 numbers against (the architecture reference is an external `docs/architecture/usda/05-event-driven-queue-based.md` not provided here); the parameters cannot be independently confirmed from the spec alone. Treat this as a "verify against the architecture doc" flag, not a substantive spec defect.

**Result**: FAIL (one sub-item unverifiable against the spec alone — see note; the spec's internal architecture description is otherwise consistent and SQS-free)

---

### 14. No Unresolved Ambiguities

- [x] All functional requirements use precise MUST/MAY/MUST NOT language
- [x] No vague terms like "should consider", "might need", "as appropriate"
- [x] Numeric thresholds are specified where applicable (latencies, counts, timeouts)

**Evidence**: All 53 FRs use MUST or MUST NOT, except FR-034 which correctly uses MAY for the deferred WebSocket enhancement. Numeric thresholds are explicit: ≤1,000 calls/trailing-60-min, pause at 900 (90%), 50-pending demotion threshold, 100-id max batch (FR-045), 10,000-row queue ceiling + `503` circuit breaker (FR-046), 5-attempt retry budget (FR-016), 30s `in_flight` lease (FR-018), 30-day staleness/tombstone TTL (FR-025/FR-031), 50ms / 200ms / 60s / 10ms latency targets (SC-001/SC-007/SC-003/SC-011). No hedging language found.

**Result**: PASS

---

### 15. Traceability

- [x] Each user story traces to at least one FR
- [x] Each critical FR is covered by at least one success criterion
- [x] Success criteria can be validated through the acceptance scenarios

**Evidence**: Story-to-FR mapping verified in item 2. Critical FR-to-SC traceability: FR-001/FR-002 → SC-001 (cache-hit latency). FR-018–FR-021 → SC-002 (rolling-window compliance). FR-011/FR-024 → SC-003 (async completion). FR-001 → SC-004 (cache hit rate). FR-023 → SC-005 (batch throughput). FR-016/FR-027 → SC-006 (zero data loss / tombstone). FR-008/FR-010 → SC-007 (search latency). FR-024 → SC-008 (data accuracy). FR-035–FR-040 → SC-010 (auth rejection). FR-036/FR-052 → SC-011 (verification latency under flood). FR-043/FR-019 → SC-012 (fairness by demotion). Each SC is exercised by acceptance scenarios in the corresponding user story (e.g., SC-012 ↔ US-0 scenario 9; SC-010 ↔ US-0 scenarios 1/3/4/6).

**Result**: PASS

---

### 16. Completeness

- [x] Security is addressed (Clerk auth FR-035–FR-053; A-009/A-011/A-012: USDA key in Secrets Manager + networkless Clerk verification; FR-006 input validation; FR-048 async-producer authz)
- [x] Monitoring is addressed (US-10, SC-006: tombstone-row alarm, queue-age alarm, latency/error metrics)
- [x] Error handling is addressed (FR-025–FR-027: 404 tombstone / 429 backoff / 5xx retry+tombstone; FR-046: `503` backpressure; FR-051: response precedence; NFR-009: typed custom errors)
- [x] No obvious omissions for a data integration feature of this scope

**Evidence**: Security: FR-035–FR-053 establish networkless Clerk session-token auth on every endpoint (`azp` enforcement, fail-closed, no trusted client header, WebSocket `$connect` auth, M2M tokens, async-producer IAM authz, response-status precedence, DoS load-shedding, auth-as-named-architecture-component); A-009/A-011/A-012 cover key management and authorizer placement; FR-006 covers input validation; the denial-of-wallet edge case confirms auth precedes any USDA spend. Monitoring: US-10 defines a CloudWatch dashboard (pending-row depth, trailing-60-min call count, latency p50/p95/p99, cache hit rate, tombstone accumulation, USDA success rate) plus tombstone and queue-age alarms; SC-006 ties zero-data-loss to the tombstone-row alarm. Error handling: FR-025 (404 tombstone w/ TTL), FR-026 (429 backoff), FR-027 (5xx retry → tombstone), FR-046 (`503` queue backpressure + circuit breaker), FR-051 (401→403→400→business precedence), NFR-009 (typed errors with guards: `UsdaApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`). Data lifecycle is complete: creation (FR-011/FR-012), storage (FR-028–FR-030), staleness/stale-while-revalidate (FR-031/FR-032), tombstoning + TTL re-fetch (FR-025); notification via polling (FR-033) and deferred WebSocket (FR-034/FR-041/FR-049).

**Result**: PASS

---

### 17. Authentication & Authorization (Clerk)

- [x] Every endpoint (and WebSocket `$connect`) requires authentication; unauthenticated requests are rejected with `401` before any business logic or USDA spend
- [x] The mechanism matches the project's actual auth (networkless Clerk session-token verification, in-process NestJS `AuthMiddleware`), not Auth0/Cognito, and not a Lambda authorizer for the HTTP API
- [x] Verification is networkless (public `CLERK_JWT_KEY`) with `azp` enforcement; identity comes only from the verified token (no trusted client header)
- [x] Authorization model is explicit (all authenticated users may read; admin/operational endpoints gated by `public_metadata` scopes → `403`; M2M tokens for service callers)
- [x] Auth is fail-closed and covered by measurable success criteria (SC-010, SC-011, SC-012)

**Evidence**: FR-035 (auth required on all endpoints + WebSocket; `401`; no enqueue/USDA call on reject). FR-036 (networkless `CLERK_JWT_KEY` verification; no IdP round trip; no Auth0/Cognito authorizer). FR-037 (`azp`/exp/nbf/signature checks → `401`). FR-038 (identity from verified token only; ignore `x-authorizer-context`/`x-user-id` — mirrors PR #39). FR-039 (read-for-all authz + `public_metadata`-gated admin). FR-040 (fail-closed). FR-041/FR-049 (WebSocket `$connect` auth + per-`sub` subscription-set notification scoping + mechanics). FR-042 (non-secret `CLERK_JWT_KEY`/`CLERK_AUTHORIZED_PARTIES` config). FR-043/FR-044 (fairness by demotion, distinct-`sub` demand counting). FR-045–FR-046 (batch cap + `503` backpressure). FR-047 (M2M service-to-service tokens). FR-048 (async-producer IAM authz). FR-050 (in-process middleware fail-closed; authorizer caching rules confined to deferred WebSocket). FR-051 (`401`→`403`→`400`→business precedence). FR-052 (auth-layer DoS load-shed). FR-053 (auth as a named architecture component). A-011/A-012 fix authorizer placement and token classes. US-0's 12 scenarios provide the end-to-end auth journey; SC-010/SC-011/SC-012 make it measurable. Consistent with CLAUDE.md "Authentication architecture" (Clerk).

**Result**: PASS

---

## Summary

| #   | Item                                   | Result |
| --- | -------------------------------------- | ------ |
| 1   | User Story Clarity                     | PASS   |
| 2   | FR Completeness                        | PASS   |
| 3   | NFR Coverage                           | PASS   |
| 4   | Key Entity Definitions                 | PASS   |
| 5   | Success Criteria Measurability         | PASS   |
| 6   | Assumption Validity                    | PASS   |
| 7   | Edge Case Coverage                     | PASS   |
| 8   | Constitution Compliance                | PASS   |
| 9   | [NEEDS CLARIFICATION] Markers          | PASS   |
| 10  | Internal Consistency                   | PASS   |
| 11  | Prose Quality and Formatting           | PASS   |
| 12  | Commise Integration                    | PASS   |
| 13  | Architecture Alignment                 | FAIL   |
| 14  | No Unresolved Ambiguities              | PASS   |
| 15  | Traceability                           | PASS   |
| 16  | Completeness                           | PASS   |
| 17  | Authentication & Authorization (Clerk) | PASS   |

**Overall: 16/17 PASS.** Item 13 (Architecture Alignment) cannot be fully validated from the spec alone: the spec's internal architecture description is consistent and SQS-free (Postgres-as-queue + Fargate worker + rolling-window limiter), but the rolling-window parameters (900/1,000) and the assertion that no token-bucket model remains must be cross-checked against the external architecture doc (`docs/architecture/usda/05-event-driven-queue-based.md`), which is not part of this spec folder. Resolve by confirming the architecture doc has been updated to the rolling-window + Postgres-queue design, then this item flips to PASS and the spec is ready for `/speckit.plan`.
