# Quality Checklist: 003-usda-food-data

**Spec**: `specs/003-usda-food-data/spec.md`
**Date**: 2026-06-28 (regenerated against the stabilized spec — Decision Register applied)
**Status**: 17/17 items pass

> **2026-06-28 stabilization regeneration**: This checklist was rebuilt against the stabilized spec after the
> Decision Register (`decision-register.md`) **and the Review-2 issue ledger (`.stabilization/review2/issue-ledger.md`)
> blocking-defect fixes** were applied. Review-2 hardened the spec's lifecycle/queue/budget control loop:
> terminal-state **reactivation now explicitly resets the `fetch_queue` row** (DSN-1, reconciling the FR-014
> `WHERE status='pending'` guard) and re-adds branch on lifecycle state so a `RESOLVED` re-add never re-fetches;
> the **`attempts` counter increments only on real source failures** (5xx/timeout), never on rate-limit
> deferrals or reaper reclaims (DSN-5); **`PATCH`-resolve is counted against the rolling window** (drawing the
> reserved 10% headroom, waiting at the true cap, never an unrecorded call — DSN-6) and is concurrency-guarded by
> a conditional `UPDATE` (DSN-8); change-refresh has a single executable home — a **distinct refresh branch**
> (selective per-item re-pull, no re-fan-out/re-disambiguation — DSN-4); the queue ordering is pure
> `request_count DESC, first_requested ASC` with **no aging term** (DSN-7); `NOT_FOUND` is separated from
> `FAILED` alarming (DSN-9); async-producer provenance validates against **`fetch_requesters` / the named service
> principal** (no `requested_by` queue column — DSN-2); `CandidateMismatchError` is pinned to **`409`** (DSN-14);
> `estimatedWaitSeconds` is a **static placeholder** (DSN-16); the **M2M service-token path is a bounded,
> deliberate exception** to the networkless mandate — Clerk machine tokens are opaque, secret-key-verified, and
> `azp`-less (DSN-12); and the data-model section gained **nutrient-dictionary dedup, `amount`/`gram_weight`
> CHECK constraints, a `fetch_state` CHECK, and a `(leased_at) WHERE status='in_flight'` partial index** (DB-5/6/7/8).
> The current spec locks in a **Postgres `fetch_queue`
> (LISTEN/NOTIFY) + Fargate consumer worker** (no SQS, no consumer Lambda), a **rolling 60-minute-window**
> per-source rate limiter (`source_call_log`, ≤1,000/trailing-hr, pause at 90%/900, rows pruned beyond the
> window), **distinct-requester demand** (`fetch_requesters`, `PRIORITY_CAP = 1` per `sub`, never a raw `+1`),
> **fairness by drain-time demotion** (no `429`, no per-user quota, no `user_fetch_quota`/`global_fetch_quota`
> tables) completed with **multi-requester demotion** (FR-043a) and **near-ceiling flood-shedding** (FR-043b,
> `503`), a **worker lease** (`leased_at` + reaper, FR-018), **change-driven refresh** (re-fetch + hash compare,
> Fargate scheduled task, ordinary low-demand enqueue), the **`food_candidates`** table backing
> `UNRESOLVED`/US-2a, the **auto-resolve survivor-count boundary** (FR-MRG-5), the **legal lifecycle transition
> set** (FR-028a), **composite same-food provenance FKs** (FR-028/SC-013), the canonical completion event
> **`FoodFetchCompleted`** (matching the deployed EventBridge rule), and an **in-process NestJS `FoodAuthGuard`**
> auth model. All `fdcId`/cache-hit/`fetch_status`/stale-while-revalidate framing has been purged outside the
> USDA adapter boundary. Counts below reflect FR-001–053 (numbered) + sub-ids (FR-025a/FR-028a/FR-043a/FR-043b)
>
> - lettered families (FR-IDN/FR-RES/FR-MRG/FR-ADP), SC-001–014, NFR-001–010, A-001–014, US-0–US-10, and 12 key
>   entities.

---

## Checklist Items

### 1. User Story Clarity

- [x] All stories have explicit P1/P2/P3 priority assignments
- [x] Each story includes an independent test description that can validate the story in isolation
- [x] Acceptance scenarios follow Given-When-Then format consistently
- [x] Priority justifications explain why each story has its assigned level

**Evidence**: 11 user stories (US-0 through US-10). P1: US-0 (auth), US-1, US-2, US-2a, US-3, US-4, US-5. P2: US-6, US-7, US-8. P3: US-9, US-10. All acceptance scenarios use Given-When-Then. Every story carries an explicit `(Priority: Pn)`, a "Why this priority" paragraph, and an "Independent Test" paragraph. US-0 is a cross-cutting auth-protection story that gates US-1–US-10; it has 12 acceptance scenarios (including service-to-service M2M auth, `403` scope denial, the >50-pending demotion case, and the batch-size `400`). US-2a (disambiguation) is the short-form story id and is parented under add-by-name (US-2); its scenarios cover candidate read, candidate-in-set validation (`CandidateMismatchError` → **`409 Conflict`**, DSN-14), idempotent `PATCH` on an already-`RESOLVED` food, and 30-day candidate-set expiry → re-fan-out.

**Result**: PASS

---

### 2. Functional Requirement Completeness

- [x] Every user story maps to at least one functional requirement
- [x] FR id schemes are internally consistent and every id is referenced/traceable (no gaps within each scheme)
- [x] Each FR is specific, testable, and uses MUST/MAY/MUST NOT language
- [x] No duplicate or overlapping FRs

**Evidence**: The spec uses three coordinated FR id schemes (the "FR-001..053 sequential, no gaps" single-series claim of the prior baseline no longer holds and has been corrected): (a) a **numbered series FR-001–FR-053** (sequential, no gaps), (b) **sub-lettered refinements** appended to their parent — **FR-025a** (UNRESOLVED candidate-set TTL), **FR-028a** (legal lifecycle transition set), **FR-043a** (multi-requester demotion), **FR-043b** (near-ceiling flood-shedding), and (c) **lettered domain families** — **FR-IDN-1..3** (identity / source-agnostic naming), **FR-RES-1..3** (candidates & resolution), **FR-MRG-1..5** (fan-out & golden-record merge), **FR-ADP-1..3** (source adapters & input safety). Story mapping: US-0 → FR-035–FR-053; US-1 → FR-001/FR-002/FR-004/FR-007; US-2 → FR-005/FR-011/FR-013/FR-014/FR-025/FR-MRG-1/FR-MRG-5; US-2a → FR-RES-1/FR-RES-2/FR-RES-3/FR-MRG-5/FR-025a/FR-028a; US-3 → FR-018–FR-022/FR-026; US-4 → FR-012/FR-023/FR-045; US-5 → FR-014–FR-018/FR-027/FR-043a/FR-044; US-6 → FR-008–FR-010; US-7 → FR-031/FR-032; US-8 → FR-003/FR-007/FR-033; US-9 → FR-034/FR-041/FR-049; US-10 → covered by SC-006 and the monitoring SCs. FRs use MUST/MUST NOT throughout; FR-034 correctly uses MAY for the deferred WebSocket. No duplicates found (the previously-reused `FR-018` candidate-surfacing reference has been re-pointed to FR-RES-1).

**Result**: PASS

---

### 3. Non-Functional Requirement Coverage

- [x] All 7 Constitution principles (I through VII) are addressed by at least one NFR
- [x] NFRs are measurable and verifiable (not vague)
- [x] No NFR conflicts with any FR

**Evidence**: 10 NFRs (NFR-001 through NFR-010). Principle I → NFR-001, NFR-009, NFR-010. Principle II → NFR-002. Principle III → NFR-003. Principle IV → NFR-004, NFR-008. Principle V → NFR-006. Principle VI → NFR-007. Principle VII → NFR-004, NFR-005. All measurable (e.g., "strict: true / no `any`", ">=70% unit / <=20% integration / <=10% E2E", "queryable via getByRole/getByLabel", ISO 8601 strings). NFR-009 names the public error surface (`SourceApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`, `CandidateMismatchError`) — `UsdaApiError` is adapter-only and never appears on the public surface. No conflicts identified.

**Result**: PASS

---

### 4. Key Entity Definitions

- [x] All entities have clear attribute descriptions
- [x] Entity relationships and lifecycles are described
- [x] Entities map to FRs (entities are referenced in requirements)

**Evidence**: **12** entities defined (up from the prior baseline's 6): Food, FoodSource (crosswalk), Nutrient (dictionary), FoodNutrient (value), FoodPortion, FoodFieldProvenance, Candidate, FetchRequest, RateLimitWindow (per source; formerly TokenBucketState), FetchQueueRow, FoodDataEvent, AuthenticatedCaller. Food → FR-002/FR-028/FR-028a/FR-029. The provenance quartet (FoodSource/FoodNutrient/FoodPortion/FoodFieldProvenance) → FR-028 (composite `(food_id, source_id)` same-food FKs)/FR-029/SC-013. Candidate → bound to the **`food_candidates`** table (FR-028/FR-MRG-5/FR-RES-1/FR-RES-2/FR-025a). RateLimitWindow → FR-019/FR-020 (rolling-window timestamps stored as a Postgres `source_call_log`, pruned beyond 60 min; deferred Redis sorted set). FetchQueueRow → FR-014–FR-018/FR-044 (durable Postgres row with `leased_at`; **no** stored priority/tier column; distinct requesters in the `fetch_requesters` side table; explicitly "not an SQS message"). FoodDataEvent → FR-032/FR-034 (EventBridge `DetailType`s = `IngestionScheduled`, `FoodFetchCompleted`, `FetchFailed` — the last emitted on a **`FAILED`** tombstone only, not on the normal `NOT_FOUND` outcome, DSN-9; `FoodRequested`/`FoodBatchRequested` are in-process demand markers, **not** EventBridge types). AuthenticatedCaller → FR-035–FR-053 (per-request principal from the verified Clerk token; produced by `FoodAuthGuard`; not persisted). All carry attributes, storage/lifetime, and lifecycle descriptions. No stale `QueueMessage`/`TokenBucketState` entity remains.

**Result**: PASS

---

### 5. Success Criteria Measurability

- [x] All 14 success criteria (SC-001 through SC-014) have quantitative thresholds
- [x] Criteria are time-bound or condition-bound (not open-ended)
- [x] Criteria align with Commise integration (SC-008 references Commise SC-010)

**Evidence**: SC-001: "50ms at p95". SC-002: "≤1,000 USDA API calls in ANY rolling 60-minute window, zero `429`". SC-003: "60 seconds at p95 when pending-row depth < 100". SC-004: "local-store serve rate > 80% after 5,000 `RESOLVED` foods over a rolling 24h" (renamed from "cache hit rate"). **SC-005 and SC-014 are now split (D-SC005)**: SC-005 = **read/serve throughput** (local `RESOLVED` reads, no source call — comfortably > 5,000 served reads/hr, bounded by DB/API capacity); SC-014 = **first-time NEW-food resolution rate** (~500–900/hr, bounded by the per-source budget SC-002; the flat "≥5,000 foods/hr resolution" claim is dropped as physically impossible under the 1,000/hr cap). SC-006: "zero data loss; tombstone after 5 **failed** attempts; **`FAILED`-tombstone** CloudWatch alarm with `NOT_FOUND` tracked as a separate non-paging backlog metric (DSN-9)". SC-007: "200ms at p95 for 50,000 foods". SC-008: "faithful to source after per-100g normalization", referencing Commise SC-010. SC-009: "99.9% availability monthly" with explicit lean-launch single-AZ caveat (A-002/A-013) marking it a target not an SLA. SC-010: "100% of endpoints reject unauthenticated/expired/malformed/wrong-`azp` with `401`". SC-011: "verification ≤10ms p95, validated under invalid-token flood". SC-012: "no single `sub` starves others — demoted to back, no per-user-quota rejection, never exceed 1,000 req/hr". SC-013: structural same-food provenance integrity (composite `(food_id, source_id)` FKs) + no source-native id on the public surface. SC-014: see above.

**Result**: PASS

---

### 6. Assumption Validity

- [x] All 14 assumptions (A-001 through A-014) are realistic and documented with rationale
- [x] No assumptions contradict the architecture document
- [x] Assumptions document defaults that can be overridden

**Evidence**: A-001 (1,000 req/hr hard cap). A-002 (lean-launch default: no Redis, `db.t4g.micro`, with override thresholds). A-003 (eventual consistency, 10–60s tolerated). A-004 (USDA free tier + 20-ID batch endpoint; USDA is the only wired source, multi-source machinery built now). A-005 (us-east-1; NestJS read API on ECS/Fargate behind the shared per-stage ALB; **Postgres `fetch_queue` + LISTEN/NOTIFY drained by a single Fargate worker — no SQS**; EventBridge only for scheduled producers + the `FoodFetchCompleted` completion event; food tables in a separate logical DB `kitchensink_food` on the shared instance — no new RDS). A-006 (four new packages, Principle V). A-007 (polling is launch mechanism; WebSocket deferred). A-008 (foods-table scope boundary vs. Commise ingredients). A-009 (USDA key in Secrets Manager; shared Clerk auth boundary, no Auth0/Cognito). A-010 (URL prefix versioning; auth-semantic changes are breaking — RT F-009; endpoint enumeration kept reconciled). A-011 (in-process NestJS **`FoodAuthGuard`** — the food service's analogue of the identity service's `AuthMiddleware`; no API Gateway/Lambda authorizer for HTTP; only the deferred WebSocket `$connect` uses a REQUEST authorizer; identity from verified token only — mirrors PR #39). A-012 (two token classes on two distinct paths: user session tokens verified **networklessly** via `CLERK_JWT_KEY` with `azp`; M2M machine tokens are opaque, **secret-key/Backend-API-verified and `azp`-less** — a bounded exception to the networkless mandate, scoped to service callers only, DSN-12). A-013 (single-AZ accepted risk; multi-AZ upgrade deferred to T-061). A-014 (source-agnostic identity re-baseline: internal `id`, no source-native key; `fdcId` confined to the USDA adapter; clean replacement, no data to migrate). All align with CLAUDE.md and the in-folder v-model architecture; defaults are overridable.

**Result**: PASS

---

### 7. Edge Case Coverage

- [x] Edge cases cover boundary conditions (invalid input, extreme values)
- [x] Edge cases cover error paths (API down, infrastructure failure)
- [x] Edge cases cover concurrency issues (thundering herd, duplicate requests)

**Evidence**: Boundary: non-ULID `id` → `400`; empty/whitespace name → `400`; adapter-rejected value (wrong type/range/length) not stored (FR-ADP-2). Error paths: source extended downtime (rows accumulate durably in `fetch_queue`, bounded by FR-016 retry budget + FR-046 depth ceiling), PostgreSQL unavailable (full food-layer outage — `fetch_queue` rows are durable and unaffected once DB recovers), rolling-window state loss (call log empty → up to the cap could fire before the window refills — bounded, converges to steady-state), Redis unavailable (lean launch: N/A — no Redis). Concurrency: thundering herd (normalized-name dedup key + short lock → one canonical row + `id`; `ON CONFLICT` → one `fetch_queue` row; one fan-out), Fargate worker crash mid-processing (the `in_flight` lease tracked by **`leased_at`** expires after 30s and a **reaper** reverts the row to `pending`, FR-018). Data quality: a source omitting nutrient fields is represented by **missing `food_nutrients` rows** (absence, not a `null` column) — "presence beats absence" lets another source supply it. Lifecycle: a previously-`NOT_FOUND` food becomes available after its **30-day** TTL (re-enqueue + re-fan-out); an **`UNRESOLVED` food nobody picks is kept until a human acts** — never swept to `NOT_FOUND` — while its `food_candidates` set expires after 30 days and re-fans-out on the next request (FR-025a). Auth: token expiry/clock skew, wrong-instance/wrong-`azp` token, anonymous denial-of-wallet flood, missing/misconfigured `CLERK_JWT_KEY` (fail-closed), WebSocket `$connect` without a token. No SQS/DLQ/visibility-timeout edge cases remain; the stale "~90-day re-check" has been corrected to 30 days.

**Result**: PASS

---

### 8. Constitution Compliance

- [x] NFRs use verbatim language from Constitution principles where applicable
- [x] No NFR paraphrases or weakens a Constitution requirement
- [x] All workspace governance rules (Principle V) are addressed

**Evidence**: NFR-001 uses "strict: true" / "no `any`" (Principle I). NFR-002 uses "JSDoc block comments" with `@param`/`@returns`/`@throws` (Principle II). NFR-003 uses aliased imports with `.js`/`.jsx` extensions and bans `helpers/` (Principle III). NFR-006 names the four new workspaces (`@kitchensink/food-service`, `usda-client`, `food-service-client`, `clerk-verify`), the root `workspaces` array registration, the shared `@kitchensink/{typescript,eslint,prettier,vitest}` configs, and Turbo task dependencies (Principle V). NFR-007 names `turbo run typecheck/lint/format:check` (Principle VI). NFR-004/NFR-005 cover accessible names and color-not-sole-conveyor for the lifecycle statuses (Principles IV/VII).

**Result**: PASS

---

### 9. [NEEDS CLARIFICATION] Markers

- [x] Maximum of 3 markers allowed
- [x] All markers (if any) have clear rationale for why clarification is needed

**Evidence**: Zero `[NEEDS CLARIFICATION]` markers in the spec. Four Clarifications sessions (2026-04-14, 2026-06-18 auth, 2026-06-20 rate-limit/fairness/lifecycle, 2026-06-21 source-agnostic re-baseline) resolved the open questions and are recorded in the Clarifications section. Within the 3-marker maximum.

**Result**: PASS

---

### 10. Internal Consistency

- [x] FR id schemes are internally consistent (numbered FR-001–053 + sub-ids + lettered families), each referenced
- [x] User story priority levels (P1/P2/P3) are clearly assigned and follow the documented distribution
- [x] Entity references in FRs match entity definitions in the Key Entities section
- [x] Event names are consistent across FRs and entities (canonical: `IngestionScheduled`, `FoodFetchCompleted`, `FetchFailed`)

**Evidence**: FR id schemes verified in item 2. Priority distribution: P1 = US-0/US-1/US-2/US-2a/US-3/US-4/US-5, P2 = US-6/US-7/US-8, P3 = US-9/US-10. Entity references reconcile: the food lifecycle `status` enum (`PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`) in FR-028/FR-028a matches the Food entity (the legacy `fetch_status` enum is fully removed); the `fetch_queue` row `status` enum (`pending`/`in_flight`/`tombstone`) matches the FetchQueueRow entity — two distinct columns on two distinct tables, intentionally different. **Event-name consistency**: the only EventBridge `DetailType`s are `IngestionScheduled`, **`FoodFetchCompleted`** (the canonical completion name, replacing the former `FoodDataReceived`, matching the deployed `FoodFetchCompletedRule`), and `FetchFailed`; `FoodRequested` and `FoodBatchRequested` are **in-process demand-path enqueue markers, not EventBridge types** (so `FoodBatchRequested` is not an orphan event — it is correctly scoped as the batch-enqueue marker). Auth FRs (FR-035–FR-053) reference the `AuthenticatedCaller` entity and the named `FoodAuthGuard` component consistently.

**Result**: PASS

---

### 11. Prose Quality and Formatting

- [x] Spec prose is clear with no grammatical errors
- [x] Markdown formatting is correct (headings, lists, code formatting)
- [x] Technical terms are used consistently (canonical `id`/`external_key`, `food.status`, `fetch_queue`, rolling window)

**Evidence**: Markdown heading hierarchy is consistent (H1 → H2 → H3); the FR-014 SQL is fenced; JSON response examples are well-formed. Code terms use backtick formatting consistently. Terminology is canonical: the internal ULID **`id`** and **`external_key`** (never `fdcId` outside the USDA adapter), **`food.status`** (never `fetch_status`), `fetch_queue`/`fetch_requesters`/`source_call_log`/`food_candidates`, `leased_at`, `FoodFetchCompleted`, `FoodAuthGuard`. `fdcId` appears **only** at the USDA adapter boundary (FR-IDN-2/FR-023/FR-024 and A-014, where it is explicitly "USDA's `external_key`, inside the adapter"). The opening "Input" note and A-005 flag that the original SQS+Lambda framing was superseded, so no stale SQS terminology lingers. No grammatical issues identified.

**Result**: PASS

---

### 12. Commise Integration

- [x] FR-007 from the Commise spec is explicitly satisfied (food/nutrition database backing)
- [x] Ingredient lookup flows are clearly defined (single and batch)
- [x] Meal plan and grocery list integration points are identified or correctly scoped out

**Evidence**: The Food entity states "Fulfills Commise FR-007." FR-002 defines the returned golden-record data (calories, protein, carbs, fat, micronutrients, per-field provenance). US-1 (single read) and US-4 (bulk/recipe-import, FR-012/FR-045) define the single and batch flows. The Dependencies table identifies 001 (downstream FR-007), 002 (required — shared Clerk config), 006 meal-planning, 007 grocery-lists, and 009 nutrition-planning as downstream consumers. A-008 scopes the boundary: linking Commise's `ingredients` entity to a Food's `id` is a downstream Commise concern. FR-047 covers server-to-server (M2M) calls from those downstream services.

**Result**: PASS

---

### 13. Architecture Alignment

- [x] All FRs map to architecture components (Postgres `fetch_queue` + LISTEN/NOTIFY, Fargate consumer worker, EventBridge for scheduled producers + `FoodFetchCompleted`, PostgreSQL canonical schema, in-process `FoodAuthGuard`)
- [x] Rolling-window limiter parameters match the in-folder architecture (≤1,000/trailing 60 min, pause at 90%/900) and the spec carries no residual token-bucket requirement
- [x] Lean launch variant is considered alongside the full architecture (Redis/sorted-set deferred variants)
- [x] Queue configuration matches the architecture (Postgres-as-queue: `ON CONFLICT` dedup, `FOR UPDATE SKIP LOCKED` drain, `leased_at` 30s lease + reaper, advisory-lock single consumer, tombstone-as-DLQ) — no SQS visibility timeout / DLQ retention / max-receive-count

**Evidence**: The spec consistently describes a Postgres-as-queue architecture: FR-011/FR-014/FR-017 (idempotent `INSERT … ON CONFLICT` + `pg_notify('fetch_queued')`, distinct-requester counting via `fetch_requesters`), FR-015 (`FOR UPDATE SKIP LOCKED`, `request_count DESC, first_requested ASC` ordering with drain-time demotion), FR-018/FR-022 (`leased_at` 30s lease + reaper, single consumer via advisory lock), FR-027 (tombstone is the DLQ-equivalent — "there is no SQS DLQ"). The rate limiter is a per-source rolling 60-minute window (FR-019–FR-021, SC-002, RateLimitWindow entity), and FR-020 states the single-drainer advisory lock is what makes the count+insert effectively serial ("zero `429` in any window"). The prior baseline left this item **FAIL** only because the rolling-window parameters (900/1,000) and the "no token-bucket residual" assertion could not be cross-verified — the architecture doc was external. The stabilized feature folder now contains **`v-model/architecture-design.md`** (and `system-design.md`), which carry the same rolling-window + Postgres-queue + `FoodAuthGuard` + `FoodFetchCompleted` design; the 900/1,000 parameters and the SQS-free, token-bucket-free posture are now verifiable in-folder. The only "token bucket" mentions in the spec are in the 2026-06-20 clarification that documents the rolling window **replacing** the token-bucket model (appropriate history, not a live requirement).

**Result**: PASS

---

### 14. No Unresolved Ambiguities

- [x] All functional requirements use precise MUST/MAY/MUST NOT language
- [x] No vague terms like "should consider", "might need", "as appropriate"
- [x] Numeric thresholds are specified where applicable (latencies, counts, timeouts)

**Evidence**: All FRs use MUST or MUST NOT, except FR-034 which correctly uses MAY for the deferred WebSocket. Numeric thresholds are explicit: ≤1,000 calls/trailing-60-min, pause at 900 (90%), 50-pending demotion threshold, `PRIORITY_CAP = 1` per requester, 100-id max batch (FR-045), 10,000-row queue ceiling + `503` circuit breaker (FR-046), 5-attempt retry budget (FR-016), 30s `in_flight` lease (FR-018), 30-day NOT_FOUND tombstone TTL (FR-025) and 30-day UNRESOLVED candidate-set TTL (FR-025a), ~500–900 NEW-food resolutions/hr (SC-014), 50ms/200ms/60s/10ms latency targets (SC-001/SC-007/SC-003/SC-011). The auto-resolve boundary is a concrete survivor count (1/>1/0, FR-MRG-5) with **no** nutrient-tolerance knob. No hedging language found.

**Result**: PASS

---

### 15. Traceability

- [x] Each user story traces to at least one FR
- [x] Each critical FR is covered by at least one success criterion
- [x] Success criteria can be validated through the acceptance scenarios

**Evidence**: Story-to-FR mapping verified in item 2 (US-2a candidate-surfacing now correctly traces to FR-RES-1, not the reused FR-018). Critical FR-to-SC traceability: FR-001/FR-002 → SC-001 (read latency) + SC-004 (local-store serve rate) + SC-005 (serve throughput). FR-018–FR-022 → SC-002 (rolling-window compliance). FR-MRG-1/FR-MRG-5 → SC-003/SC-014 (resolution + NEW-food rate). FR-008/FR-010 → SC-007 (search latency). FR-ADP-2/FR-024 → SC-008 (data fidelity). FR-028/FR-029 → SC-013 (provenance integrity). FR-035–FR-040 → SC-010 (auth rejection). FR-036/FR-052 → SC-011 (verification latency under flood). FR-043/FR-043a/FR-043b/FR-019 → SC-012 (fairness by demotion + flood-shed). FR-016/FR-027 → SC-006 (zero data loss / tombstone). Each SC is exercised by acceptance scenarios in the corresponding user story (e.g., SC-012 ↔ US-0 scenario 9; SC-010 ↔ US-0 scenarios 1/3/4/6; FR-MRG-5 ↔ US-2 scenarios 2/5/6 and US-2a scenarios 1–3).

**Result**: PASS

---

### 16. Completeness

- [x] Security is addressed (Clerk auth FR-035–FR-053; A-009/A-011/A-012: USDA key in Secrets Manager + networkless Clerk verification; FR-ADP-2/FR-ADP-3 input/transport safety; FR-048 async-producer authz)
- [x] Monitoring is addressed (US-10, SC-006: `FAILED`-tombstone alarm + `NOT_FOUND` backlog metric, queue-age alarm, latency/error metrics, local-store serve rate)
- [x] Error handling is addressed (FR-025/FR-026/FR-027: NOT_FOUND tombstone / source-429 backoff / 5xx retry+tombstone; FR-046: `503` backpressure; FR-051: response precedence; NFR-009: typed custom errors)
- [x] No obvious omissions for a data integration feature of this scope

**Evidence**: Security: FR-035–FR-053 establish networkless Clerk session-token auth on every endpoint (`azp` enforcement, fail-closed, no trusted client header — `x-authorizer-context`/`x-user-id`/`x-debug-sub` ignored and the debug-header path removed, FR-038, WebSocket `$connect` auth, M2M tokens, async-producer IAM authz, response-status precedence, DoS load-shedding, auth as the named `FoodAuthGuard` component); A-009/A-011/A-012 cover key management and guard placement; FR-ADP-2/FR-ADP-3 cover input validation/sanitization and HTTPS with cert validation; the denial-of-wallet edge case confirms auth precedes any source spend. Monitoring: US-10 defines a CloudWatch dashboard (pending-row depth, trailing-60-min call counts, latency p50/p95/p99, local-store serve rate, `FAILED`-tombstone count and separate `NOT_FOUND` backlog, `UNRESOLVED` backlog, per-source success rate) plus a `FAILED`-tombstone alarm (NOT_FOUND is a normal outcome and does **not** page, DSN-9) and a queue-age alarm; SC-006 ties zero-data-loss to the `FAILED`-tombstone alarm. Error handling: FR-025 (NOT_FOUND tombstone w/ 30-day TTL), FR-026 (source-429 backoff — distinct from the **absence** of any per-user `429`, FR-043), FR-027 (5xx retry → FAILED tombstone), FR-046 (`503` queue backpressure + circuit breaker + FR-043b near-ceiling flood-shed), FR-051 (`401`→`403`→`400`→business precedence), NFR-009 (typed errors with guards: `SourceApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`, `CandidateMismatchError` — `UsdaApiError` is adapter-only). Data lifecycle is complete: creation/reactivation (FR-005/FR-011/FR-012/FR-028a), storage (FR-028–FR-030), candidate persistence/resolution (FR-MRG-5/FR-RES-1/FR-RES-2/FR-025a), change-driven refresh (FR-031/FR-032), tombstoning + TTL re-fetch (FR-025); notification via polling (FR-033) and deferred WebSocket (FR-034/FR-041/FR-049, `FoodFetchCompleted`).

**Result**: PASS

---

### 17. Authentication & Authorization (Clerk)

- [x] Every endpoint (and WebSocket `$connect`) requires authentication; unauthenticated requests are rejected with `401` before any business logic or source spend
- [x] The mechanism matches the project's actual auth (networkless Clerk session-token verification, in-process NestJS `FoodAuthGuard`), not Auth0/Cognito, and not a Lambda authorizer for the HTTP API
- [x] **User-session** verification is networkless (public `CLERK_JWT_KEY`) with `azp` enforcement; identity comes only from the verified token (no trusted client header, incl. `x-debug-sub`). The **M2M service-token path is a documented, bounded exception** (opaque machine tokens are secret-key/Backend-API-verified, `azp`-less, allowlisted by machine id) — surfaced explicitly in FR-047/FR-042/A-009/A-012 (DSN-12), scoped to service callers only and never touching the user-session edge
- [x] Authorization model is explicit (all authenticated users may read; admin/operational endpoints gated by `public_metadata` scopes → `403`; M2M tokens for service callers, allowlisted by `FOOD_AUTHORIZED_MACHINES`)
- [x] Auth is fail-closed and covered by measurable success criteria (SC-010, SC-011, SC-012)

**Evidence**: FR-035 (auth required on all endpoints + WebSocket; `401`; no enqueue/source call on reject). FR-036 (networkless `CLERK_JWT_KEY` verification; no IdP round trip; no Auth0/Cognito authorizer). FR-037 (`azp`/exp/nbf/signature checks → `401`). FR-038 (identity from verified token only; ignore `x-authorizer-context`/`x-user-id`/`x-debug-sub`; the debug-header identity path is **removed**, not merely unused — mirrors PR #39). FR-039 (read-for-all authz + `public_metadata`-gated admin → `403`). FR-040 (fail-closed). FR-041/FR-049 (WebSocket `$connect` auth + per-`sub` subscription-set notification scoping on `FoodFetchCompleted`). FR-042 (non-secret `CLERK_JWT_KEY`/`CLERK_AUTHORIZED_PARTIES` config). FR-043/FR-043a/FR-043b/FR-044 (fairness by demotion + multi-requester demotion + near-ceiling flood-shed + distinct-`sub` demand counting — no per-user `429`/quota). FR-045–FR-046 (batch cap + `503` backpressure). FR-047 (M2M service-to-service tokens — distinct opaque token class, secret-key/Backend-API-verified, `azp`-less, allowlisted by machine id; a bounded networkless-mandate exception, DSN-12). FR-048 (async-producer authz validated against `fetch_requesters` / the named service principal — no `requested_by` queue column, DSN-2). FR-050 (in-process `FoodAuthGuard` fail-closed, no result cache; authorizer caching rules confined to deferred WebSocket). FR-051 (`401`→`403`→`400`→business precedence). FR-052 (auth-layer DoS load-shed). FR-053 (auth as the named `FoodAuthGuard` architecture component). A-011/A-012 fix guard placement and token classes. US-0's 12 scenarios provide the end-to-end auth journey; SC-010/SC-011/SC-012 make it measurable. Consistent with CLAUDE.md "Authentication architecture" (Clerk).

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
| 13  | Architecture Alignment                 | PASS   |
| 14  | No Unresolved Ambiguities              | PASS   |
| 15  | Traceability                           | PASS   |
| 16  | Completeness                           | PASS   |
| 17  | Authentication & Authorization (Clerk) | PASS   |

**Overall: 17/17 PASS.** Item 13 (Architecture Alignment) — the prior baseline's sole FAIL — now passes: the stabilized feature folder contains `v-model/architecture-design.md` and `v-model/system-design.md`, against which the rolling-window parameters (≤1,000/trailing-60-min, pause at 900) and the SQS-free, token-bucket-free, `FoodFetchCompleted` + `FoodAuthGuard` design are verifiable. The spec is internally consistent with the Decision Register and ready for `/speckit.plan` continuation.
