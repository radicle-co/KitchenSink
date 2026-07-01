# Peer Review — system-design

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-20
**Artifact**: system-design.md (13 system components, SYS-001..SYS-013) — full 4-view sweep against the reconciled Postgres-as-queue + rolling-window + demotion-fairness + SWR/tombstone-TTL/batch-partial design
**Standard**: IEEE 1016
**Supersedes**: the 2026-06-19 peer-review (STALE — reviewed a `429` per-user quota gate in Path 0 / IC-007 and a token-bucket limiter; both are no longer the design).

## Summary

| Severity           | Count  |
| ------------------ | ------ |
| Critical           | 2      |
| Major              | 3      |
| Minor              | 2      |
| Observation        | 3      |
| **Total Findings** | **10** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

Overall assessment: **FAIL — 2 Critical / 3 Major.** The auth/admission edge is **correctly reconciled**: SYS-013's row, Path 0, IC-007, and the Trade-off table all model **demotion (>50 pending → ranked to back, dynamic at drain time; no `429`)** rather than a per-user quota, and SYS-006 (RollingWindowLimiter) and Path 2b (stale-while-revalidate, serve-stale-indefinitely) match the locked design. **However the queue decomposition still encodes the superseded model**: SYS-002 (EventBridgeBus) traces to the stale demand-path REQ-011/REQ-012, and SYS-003/SYS-004 are split into **HighPriorityFetchQueue / LowPriorityFetchQueue** as if static origin-based priority were the ordering — contradicting the single demand-weighted `fetch_queue` with dynamic demotion that the same document describes in Path 4, SYS-013, and the Trade-off table. The decomposition view and the data-flow/dependency views therefore disagree internally. Those are the blocking findings.

## Findings

---

### PRF-SYS-001 — SYS-002 (EventBridgeBus) traces to the superseded demand-path enqueue

**Severity**: Critical
**Defect type**: Internal consistency / traceability vs spec.md
**Location**: SYS-002 Decomposition row (line 23) + Parent Requirements (REQ-011, REQ-012); Component Traceability Detail (lines 253–257); Dependency View SYS-002→SYS-003/004 (lines 43–44)

**Description**: SYS-002's **Parent Requirements are REQ-011, REQ-012** — the requirements that say "publish a `FoodRequested`/`FoodBatchRequested` event **to EventBridge** on cache miss." That is the superseded SQS/EventBridge demand path. SYS-002's own description correctly states it is "for **scheduled producers only** … **not** on the demand-path enqueue — cache-miss enqueues are `INSERT … ON CONFLICT` into `fetch_queue` + `pg_notify`," so the **component narrative contradicts its own traceability**: it claims it is not on the demand path while tracing to the two demand-path requirements. Per the locked design (spec.md FR-011) EventBridge carries only `IngestionScheduled` (FR-032) and `FoodFetchCompleted` (FR-034). A V-model trace keyed on REQ→SYS would conclude the demand-path enqueue is implemented by EventBridge, which the design forbids.

**Recommendation**: Re-parent SYS-002 to the scheduled-producer + completion requirements (REQ-032 / REQ-IF-005 `IngestionScheduled`+`FoodFetchCompleted`), and re-parent the demand-path enqueue (corrected REQ-011/012/013/014) to SYS-003 + SYS-001. This depends on the requirements.md fix (peer-review-requirements PRF-REQ-001); flag both together.

---

### PRF-SYS-002 — SYS-003 / SYS-004 split the single demand-weighted queue into static high/low priority components

**Severity**: Critical
**Defect type**: Internal consistency / correctness of the new mechanism
**Location**: SYS-003 "HighPriorityFetchQueue" (line 24), SYS-004 "LowPriorityFetchQueue" (line 25); Physical View rows (lines 222–223); vs Path 4 (line 197), SYS-013 row (line 34), Trade-off "Queue priority" (line 242)

**Description**: SYS-003 and SYS-004 are modeled as two components — "**High**PriorityFetchQueue" (individual lookups) and "**Low**PriorityFetchQueue" (batch/scheduled) — keyed on static origin-based priority (parents REQ-011/012/013/014, the static-`priority` model). The locked design is **one** `fetch_queue` ordered `request_count DESC, first_requested ASC` with **dynamic per-`sub` demotion at drain time** (>50 pending → back). The same document already states this correctly elsewhere: Path 4 selects `ORDER BY (requester pending-count > 50) ASC, request_count DESC, first_requested ASC`; the Trade-off "Queue priority" row says "Demand-weighted `fetch_queue` (`ORDER BY request_count DESC, first_requested ASC`)"; SYS-013 enforces demotion not static class. So the Decomposition view (two static-priority queue components) contradicts the Data-Flow and Trade-off views (one demand-weighted queue). The descriptions hedge ("same Postgres `fetch_queue`, lower `request_count`") but the component split itself reifies a two-class static model that the ordering does not use — there is no "high" vs "low" partition at drain time, only a live `request_count`/demotion score.

**Recommendation**: Collapse SYS-003 and SYS-004 into a single `FetchQueue` component (Postgres `fetch_queue`) whose ordering is demand-weighted with dynamic demotion; if a "scheduled/low-demand" sub-aspect is worth naming, model it as a property of enqueued rows (lower `request_count`, low-priority origin tag), not a separate queue component. Re-parent to corrected REQ-014/REQ-015/FR-043/FR-044. Update the two Physical-View rows accordingly.

---

### PRF-SYS-003 — SYS-005 lease/processing model not anchored to the 30s lease; high/low drain language leaks from SYS-003/004

**Severity**: Major
**Defect type**: Traceability / consistency vs spec.md FR-018
**Location**: SYS-005 (line 26), Dependency View SYS-003→SYS-005 / SYS-004→SYS-005 (lines 45–46), Path 4 (line 197)

**Description**: SYS-005 (FoodConsumerWorker) drains "via `LISTEN/NOTIFY`" and is rate-limited correctly, but the dependency view describes it feeding from a **high** queue and a **low** queue (inheriting the PRF-SYS-002 split), and neither the SYS-005 row nor Path 4 anchors the **30-second `in_flight` lease** that FR-018 / spec Edge Cases require for crash recovery. Path 4 mentions "row lease, FR-018" parenthetically but the value is absent, and requirements.md REQ-017 (its parent) currently states a contradictory 60s/120s. The worker's crash-recovery behavior (revert `in_flight` → `pending` after 30s) is a load-bearing reliability property and is not pinned in any view.

**Recommendation**: After collapsing SYS-003/004, state in SYS-005 (and Path 4) the single `fetch_queue` drain with the 30s lease revert. Keep the upstream requirements.md REQ-017 fix (30s) in sync.

---

### PRF-SYS-004 — Path 4 / REQ-024 success path: "delete" vs durable tombstone audit row inconsistency

**Severity**: Major
**Defect type**: Consistency vs spec.md FR-024/FR-025 + SC-006
**Location**: Path 4 (line 202) "UPDATE fetch_queue SET status='done'"; SYS-005 description; vs spec.md FR-025 / US-5 AS-6/AS-7

**Description**: Path 4 resolves a successful fetch with `UPDATE fetch_queue SET status='done'` — but the schema/glossary statuses for `fetch_queue` are `pending | in_flight | tombstone` (FoodDataEntity glossary; FR-027), with no `'done'` state, and the foods-table `fetch_status` enum is `pending|fetched|failed|not_found|stale`. The design uses two different status vocabularies and Path 4 introduces a third value (`'done'`) that appears nowhere in the requirements. Separately, on USDA `404` the consumer must **set the `fetch_queue` row `status='tombstone'`** (durable audit row queried by US-5 AS-7 and counted by SC-006), but requirements.md REQ-025 says "delete the row" (flagged in the requirements review). The system-design must not depend on a row state (`'done'`) that the data model does not define.

**Recommendation**: Reconcile the `fetch_queue` status vocabulary to one enumerated set (e.g. `pending | in_flight | fetched | tombstone`) and use it consistently in Path 4, SYS-003/005, and IC-001/IC-005. Ensure the `404` path sets `status='tombstone'` (not delete) so the audit row survives for SC-006/US-5.

---

### PRF-SYS-005 — FR-044 distinct-requester / capped / aged demand counting not represented in any view

**Severity**: Major
**Defect type**: Completeness / traceability
**Location**: SYS-003 (request_count semantics), SYS-013 row (fetch_requesters), Path 4 ordering; vs spec.md FR-044

**Description**: The reconciled priority mechanism depends on `request_count` counting **distinct authenticated `sub`s** per `fdcId` (via `fetch_requesters`), with a **cap** and **aging** to prevent a single account pinning an `fdcId` to the front (FR-044). SYS-013 mentions `fetch_requesters` for WebSocket recipient targeting and demotion, but **no component or interface contract models the distinct-`sub` demand-count derivation** that feeds Path 4's `ORDER BY request_count`. As designed, `request_count` is incremented by raw `ON CONFLICT DO UPDATE SET request_count = request_count + 1` (IC-001, SYS-001→SYS-003), i.e. raw request volume — which is exactly the FR-044 anti-pattern. The design currently contradicts FR-044's "MUST NOT increment priority more than once per `sub`."

**Recommendation**: Add an interface/data contract (SYS-001/SYS-013 → SYS-003 via `fetch_requesters`) that derives `request_count` as a distinct-`sub` count with a cap and aging, and reflect it in IC-001 and Path 4's ordering expression.

---

### PRF-SYS-006 — IC-006 response schema does not distinguish user `sub` from M2M/service identity

**Severity**: Minor
**Defect type**: Interface precision
**Location**: IC-006 (line 120), External Interfaces "Clerk session/M2M token" (line 92), SYS-013 (REQ-041)

**Description**: Carried forward and still valid. SYS-013 and the external-interface table acknowledge the M2M token class (REQ-041/FR-047, A-012), but IC-006's response schema is `AuthenticatedCaller | 401 | 403` with no field shape, so the user-vs-service principal distinction is not contract-visible at the boundary the module design implements against.

**Recommendation**: Expand IC-006 to `AuthenticatedCaller { sub, azp, scopes, tokenClass: 'user' | 'm2m' }`.

---

### PRF-SYS-007 — SYS-013 → SYS-005 async-producer provenance (FR-048) still uncontracted

**Severity**: Minor
**Defect type**: Traceability precision
**Location**: Dependency View SYS-013→SYS-003 (line 57), Internal Interfaces (line 109), IC-007 (line 121); vs spec.md FR-048

**Description**: Carried forward. REQ-042/FR-048 (only named IAM principals may publish to EventBridge / insert `fetch_queue`; the **consumer validates event provenance**) names producer-side authorization in the SYS-013→SYS-003 cell, but the **consumer-side provenance validation** (SYS-005) is still not a dependency or interface contract — IC-007 covers only the synchronous per-`sub` demotion/backpressure gate. REQ-042's consumer leg traces to SYS-013 by prose only.

**Recommendation**: Add a SYS-013 → SYS-005 (or SYS-002 → SYS-005) provenance-validation relationship/interface note so the consumer-validation leg is anchored in a view.

---

### PRF-SYS-008 — Auth/admission edge fully reconciled to demotion (no 429)

**Severity**: Observation (Resolved — prior design reviewed a `429` quota gate)
**Defect type**: Correctness of the new mechanism
**Location**: SYS-013 row (line 34), Path 0 (lines 127–143), IC-007 (line 121), Trade-off "Fairness model" (line 240), Dependency SYS-013→SYS-003 (line 57)

**Description**: **RESOLVED / correct.** Every auth-edge surface models the locked demotion model, not a per-user quota: SYS-013 — "per-`sub` demotion fairness (>50 pending → ranked to back; no `429`)"; Path 0 — "sub has >50 pending → enqueue accepted but ranked to BACK (demotion; no 429), dynamic at drain time"; IC-007 GateEnqueue → "Allow (normal) | Allow (demoted — sub >50 pending) | 503 (backpressure)" (no `429` branch); Trade-off "Fairness model" → "Demotion … not per-user quota `429`." The prior review's IC-007 `429` and the `200/hr` quota are gone. SYS-006 RollingWindowLimiter correctly uses the Postgres `usda_call_log` rolling-window (≤1,000 trailing-hr, pause at 90%/900; Redis sorted-set deferred) — not a token bucket. No action.

---

### PRF-SYS-009 — Lifecycle paths (SWR, batch partial) reconciled

**Severity**: Observation (Resolved)
**Defect type**: Completeness / correctness
**Location**: Path 2b (lines 169–178), IC-008 (line 122), Trade-off "Stale-record read" (line 241), Path 5 (rate-limited)

**Description**: **RESOLVED / correct.** Path 2b models stale-while-revalidate exactly per FR-031: serve stale `200` immediately + `INSERT … ON CONFLICT` background re-fetch, "never blocks," and "if re-fetch keeps failing, stale data served indefinitely." IC-008 (ValidateBatch) models the FR-045 per-item partial response ("cached/stale inline + each miss `pending` (enqueued)") and the 100-id `400` cap. Path 5 models the rolling-window pause (release lease, no status change, reprocess when calls age out). These match the 2026-06-20 clarifications. No action.

---

### PRF-SYS-010 — SYS-008 (Redis) correctly deferred; no token-bucket residue in limiter state

**Severity**: Observation (Resolved)
**Defect type**: Internal consistency
**Location**: SYS-008 (line 29), SYS-006 (line 27), Trade-off "Cache layer" / "Rate limiter implementation" (lines 238–239), Physical View RollingWindowLimiter row (line 225)

**Description**: **RESOLVED / correct.** SYS-008 is "Optional Redis cache (deferred post-launch variant; lean-launch default is Postgres)" and explicitly notes "Pending-fetch deduplication is the `fetch_queue` `ON CONFLICT` row, not a Redis set." SYS-006 / Physical View place the rolling-window state in Postgres `usda_call_log` by default with the Redis sorted-set as the deferred variant. No co-equal-Redis or token-bucket framing remains in the limiter/cache design. No action. (Residual: SYS-008 still lists REQ-022/REQ-023 as parents which are worker/USDA-API requirements, a minor mis-parent, but not design-blocking — fold into the PRF-SYS-002 re-parenting pass.)

---

## Verdict

**Verdict: FAIL — 2 Critical / 3 Major.** The auth/admission edge (SYS-013, Path 0, IC-007), the rolling-window limiter (SYS-006), and the lifecycle paths (Path 2b SWR, IC-008 batch-partial, Path 5) are correctly reconciled to the locked design with no token-bucket/`429`/co-equal-Redis residue. The blocking defects are in the queue decomposition: SYS-002 traces to the superseded EventBridge demand-path (REQ-011/012), and SYS-003/SYS-004 reify a static high/low-priority split that contradicts the single demand-weighted `fetch_queue` with dynamic demotion described in Path 4 / the Trade-off table. Collapse SYS-003/SYS-004 into one demand-weighted `FetchQueue`, re-parent SYS-002 to the scheduled-producer/completion requirements, reconcile the `fetch_queue` status vocabulary (drop `'done'`; keep `tombstone` audit rows), and model FR-044 distinct-requester demand counting before this artifact passes the gate.

---

## Remediation Status (2026-06-20, round 4)

All **Critical and Major** findings in this review were **remediated in the same session**. The artifacts now reflect the canonical model — Postgres demand-weighted `fetch_queue` (single queue, no high/low tier), rolling-60-min window limiter (`usda_call_log`), dynamic queue **demotion** wired on every enqueue path (incl. single-food), distinct-requester demand via `fetch_requesters` (FR-044), `status` enum `pending | in_flight | tombstone`, single 30s lease, rolling-window state-loss hazard (HAZ-041), and in-process NestJS auth. Reconciled across spec/plan/tasks + the full v-model. This record documents the findings **as reviewed**; the gate (`.forge-status.yml → peer_review_gate`) reflects the post-remediation state. An independent re-review is the optional final confirmation.

---

## Stabilization reconciliation (decision register, 2026-06-28)

> This section supersedes the "Remediation Status (round 4)" note above wherever they differ. The
> stabilization **decision register** (`../decision-register.md`), with `../.stabilization/inputs/`, is the
> single canonical resolution. The findings above are retained verbatim as the review record; read every
> term in them through the canonical mapping below. The only in-place body edit applied by stabilization is
> the mandated completion-event rename to **`FoodFetchCompleted`** (the retired `FoodData*` completion-event names; D-EVENT).

**Canonical names (§1; D-EVENT / D-CLEANUP / D-AUTH).**

- Completion event = **`FoodFetchCompleted`** (EventBridge `DetailType`; publisher `publishFoodFetchCompleted`). `FoodRequested`/`FoodBatchRequested` are in-process enqueue markers, **not** EventBridge types; `IngestionScheduled`/`FetchFailed` keep their names.
- `food.status` lifecycle enum = **`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`** (replaces the old `fetch_status` = `pending/fetched/failed/not_found/stale`). `fetch_queue.status` stays **`pending | in_flight | tombstone`**.
- USDA native id = **`external_key`**; the public/PK id is the internal **ULID `id`**. `fdcId`/`fdc_id` is **adapter-only** and must not appear on schema/DTO/API/DAO. Source = the **`food_source`** enum (no free-text). Errors: **`SourceApiError`** (not `UsdaApiError`), plus `RateLimitWindowFullError`/`FoodNotFoundError`/`CandidateMismatchError`.
- Read framing = **local-store read (RESOLVED) / local-store serve rate / add-by-name miss**; "cache hit/miss/hit-rate" is reserved for the deferred Redis variant (ARCH-007) only.
- Auth = **`FoodAuthGuard`** (food service; networkless Clerk verify, fail-closed, scopes from `public_metadata`); the forgeable **`x-debug-sub`** / trusted-identity-header path is removed (identity = the verified Clerk `sub` only). The auth slice is unchanged in scope.

**Canonical schema (§2; D-CANDIDATES / D-LEASE / D-PROVENANCE-FK).** plan.md §2 = **13 tables** (the 12 there **plus `food_candidates`** — `id, food_id, source, external_key, name, summary, created_at`; `UNIQUE(food_id, source, external_key)`, backing `UNRESOLVED`/US-2a). `fetch_queue` gains **`leased_at timestamptz`** with a reaper reverting `in_flight` rows older than 30s (single-drainer = FR-022 advisory lock). `food_sources` gains `UNIQUE(food_id, id)`; nutrients/portions/field-provenance/category-assignment use composite **`(food_id, source_id)` FKs**, `ON DELETE NO ACTION`. `source_call_log` rows beyond the trailing 60-min window are pruned on a periodic sweep.

**Canonical behaviour (D-AUTORESOLVE / D-UNRESOLVED-TTL / D-LIFECYCLE / D-DEMAND / D-FAIRNESS / D-REFRESH / D-SC005).**

- Auto-resolve: after pre-merge dedup, **1 survivor of normalized-name exact match → `RESOLVED`; >1 → `UNRESOLVED`** (persist survivors to `food_candidates`); **0 → `NOT_FOUND`**. No nutrient tolerance.
- `UNRESOLVED` is kept until a human picks; its candidate set expires 30 days after `created_at` and re-fans-out on the next request (never swept to `NOT_FOUND`). The **30-day TTL is `NOT_FOUND`-only**; `FAILED→PENDING` is bounded-backoff retry (no 30-day gate).
- Legal transitions: `PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}`; `UNRESOLVED→RESOLVED`; `FAILED→PENDING`; `NOT_FOUND→PENDING` (post-TTL). `PATCH`-resolve is UNRESOLVED-only, idempotent, candidate-in-set validated (`CandidateMismatchError`). `createByName` reactivates a terminal-state row (no `23505`). Refresh never overwrites a manual pick.
- Demand = distinct-requester: upsert `(food_id, sub)` into `fetch_requesters` `ON CONFLICT DO NOTHING`, then set `request_count` to the **capped distinct-`sub` count (`PRIORITY_CAP = 1`)** — never raw `+1`. One demand-weighted `fetch_queue` ordered `request_count DESC, first_requested ASC`; demotion is **drain-time live compute** (no `drain_priority_tier` column, no `enqueueLowPriority`). No per-user quota, no `429`; near-ceiling NEW-enqueue flood-shed = `503`. Change-refresh runs as a **Fargate scheduled task** that yields to live demand, re-enqueuing via the ordinary path.
- SC-005 splits into **read/serve throughput** (local reads, high target) vs **first-time NEW-food resolution rate** (~500–900/hr, bounded by SC-002 ≤1,000 calls/rolling-60-min — new **SC-014**).

**Finding dispositions for this artifact.**

- **PRF-SYS-001** (SYS-002 EventBridge demand-path) — re-parent SYS-002 to the scheduled-producer + completion requirements; EventBridge carries only `IngestionScheduled` + `FoodFetchCompleted`. The demand-path enqueue is the `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify`.
- **PRF-SYS-002** (SYS-003/SYS-004 static high/low split) — **collapse into one demand-weighted `FetchQueue`** (D-FAIRNESS); there is no static tier and **no `drain_priority_tier` column** — demotion is drain-time compute.
- **PRF-SYS-004** (`status='done'`; delete-vs-tombstone) — canonical `fetch_queue.status = pending | in_flight | tombstone` (drop `'done'`); the `404` path sets `status='tombstone'`; add the **`leased_at`** column + 30s reaper in Path 4; the `food.status` lifecycle enum is the separate set above.
- **PRF-SYS-003 / PRF-SYS-005 / PRF-SYS-006 / PRF-SYS-007** — carried; SYS-005 anchors the single 30s lease; demand counting is distinct-requester (D-DEMAND).
- **System components to add** (per §3.4/§3.7/§3.11/§3.13/§3.16): SYS-007 enumerates **13 tables incl. `food_candidates`** + composite `(food_id, source_id)` provenance FKs; SYS-013 is **`FoodAuthGuard`** (`x-debug-sub` removed); add **SYS-019** change-refresh **Fargate scheduled task** (D-REFRESH); the `source_call_log` retention sweep in SYS-006.
