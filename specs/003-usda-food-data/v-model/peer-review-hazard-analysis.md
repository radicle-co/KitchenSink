# Peer Review — hazard-analysis.md

**Reviewer**: AI Peer Review (spec-kit V-Model — independent IEEE 1028 inspection)
**Date**: 2026-06-20
**Artifact**: hazard-analysis.md (40 hazard entries, 13 system components), reviewed against the reconciled + clarified spec (Session 2026-06-20: rolling-window limiter, demotion fairness, SWR-indefinite, tombstone-TTL)
**Cross-checked against**: `../spec.md` (FR-019/FR-020 rolling window, FR-043/FR-044 demotion, FR-031 SWR-indefinite, FR-025 tombstone TTL, FR-035–FR-053, SC-002/010/011/012), Edge Cases (spec.md line 261)
**Standard**: IEC 60812 / ISO 14971 FMEA profile (consumer SaaS, non-regulated; `domain: ''`)

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 1     |
| Major              | 0     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **5** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

This is a fresh pass replacing the stale 2026-06-19 review. That prior review **affirmed the wrong design**: its "RESOLVED" record for HAZ-038 describes a quota-store **fail-CLOSED `503`** posture reading `quota:{sub}` / `user_fetch_quota` — tables and a posture the locked design has **dropped**. The actual HAZ-038 in this artifact is the correct reconciled hazard (**demotion-scorer demand-state unavailable → fail-OPEN to availability**, no rejection, the rolling-window cap remaining the hard budget guarantee). So the register is now ahead of its old review.

Re-scored against the locked design, the register is largely aligned:

- **HAZ-016** = atomic windowed count+record race → overshoot >1,000 in any trailing 60 min, mitigated by the `usda_call_log` atomic count-and-insert (`INSERT … WHERE (SELECT count(…)) < 1000 RETURNING`; Redis Lua deferred). Correct reframe from the old token-bucket Lua.
- **HAZ-038** = demotion-scorer demand-state unavailable, **fail-open to availability** (don't demote, never reject; rolling-window cap is the independent hard budget). Sound and correctly justified.
- **HAZ-037** = insider denial-of-wallet, mitigated by demotion-not-rejection (no `429`), FR-019 90% pause as the hard budget, FR-044/045/046. Correct, Critical × Occasional = Undesirable.
- **HAZ-009** = stale-refresh accumulation, effect explicitly reframed to "serves held stale data indefinitely (availability over freshness), no max-staleness cutoff" — matches SWR-indefinite (FR-031).
- **HAZ-019** = tombstone TTL (30-day re-attempt) present.
- **HAZ-036/039/040** auth hazards intact (auth-bypass, token-class confusion, WS `$connect` cache fall-open).

The one Critical is a genuine **uncovered new failure mode**: the spec's own Edge Cases call out rolling-window **state loss → bounded burst of up to 1,000 calls** before the window refills, and no hazard row captures it. HAZ-015 (count-math bug) and HAZ-016 (count+record race) are adjacent but distinct.

## Findings

---

### PRF-HAZ-001 — No hazard for rolling-window limiter state loss (empty `usda_call_log` → bounded burst before window refills)

- **Severity**: Critical
- **Defect type**: Missing failure mode — uncovered new (rolling-window) hazard
- **Location**: hazard-analysis.md, SYS-006 register (HAZ-015, HAZ-016); cross-ref spec.md Edge Cases line 261, FR-019/FR-020, SC-002
- **Description**: The locked design tracks limiter state as timestamps in `usda_call_log` (lean) / a Redis sorted set (deferred). The spec's Edge Cases section explicitly enumerates the failure: "When the rolling-window limiter state is lost (Redis restart or PostgreSQL call-log truncation) … the call log is empty, so the trailing-60-min count starts at 0 and **up to 1,000 API calls could fire** before the window refills with fresh timestamps … can briefly exceed the true rolling-hour count right after the loss." This is a direct path to a transient SC-002 breach (the headline ≤1,000/trailing-hour guarantee) and is materially **different** from the two SYS-006 hazards already present:
    - HAZ-015 = "count math bug over-counts (or never ages out)" — a logic defect, not state loss.
    - HAZ-016 = "atomic count+record race allows overshoot" — concurrency under intact state, not an emptied store.
    - State loss is the third, distinct mode: state is internally consistent and concurrency-safe, but **empty**, so the budget invariant is briefly violated by construction. The prompt's review brief lists "limiter-state-loss (empty call log → bounded burst)" as a failure mode the register must carry; it is absent.
- **Impact**: The worst-case window for the system's hardest guarantee (SC-002, A-001 — the USDA key ban risk) has no hazard, no severity/likelihood, no decided mitigation posture, and no Matrix-H traceability. Because it can breach the cap, it is at least Serious; given the consequence (key sanction / pipeline-wide outage) and that restart/truncation is a routine operational event, Critical × Remote = Undesirable is the appropriate cell.
- **Recommendation**: Add a SYS-006 hazard, e.g.: **"Rolling-window state loss (call-log truncation / Redis restart) empties the trailing-60-min count, allowing a bounded burst of up to 1,000 calls before the window refills."** Effect: transient SC-002 over-emit, bounded and self-converging. Mitigation: bound the burst at the hard cap (count-and-insert still rejects beyond 1,000 within the recovering window); prefer the durable Postgres `usda_call_log` (survives app restarts, unlike an in-memory/Redis store) so state loss is rare; optionally warm/seed the window from recent persisted call records on startup; SYS-012 alarm on a count discontinuity. Decide and record the residual-risk acceptance (the spec already accepts it as "bounded and safe-ish"), so the acceptance is explicit rather than implicit.

---

### PRF-HAZ-002 — HAZ-020 (cache-invalidation-missed) and the SYS-008 register assume a live cache layer that the lean launch does not include

- **Severity**: Minor
- **Defect type**: Consistency / deferred variant treated as live
- **Location**: hazard-analysis.md, SYS-008 register (HAZ-020); component title "FoodDataCacheAndPendingSet (Postgres default; Redis deferred)"
- **Description**: The SYS-008 title is correctly reframed ("Postgres default; Redis deferred") — good. But HAZ-020 ("Cache invalidation missed after successful upsert … stale food data served despite newer USDA data in PostgreSQL") is a **Redis-specific** failure that cannot occur in the lean launch (Postgres is the source of truth; there is no separate cache to invalidate). Its mitigation cites REQ-022/REQ-023 cache semantics + ARCH-007 invalidation-on-write, all deferred-variant controls. The hazard is presented at the same severity/likelihood as launch-relevant rows with no "deferred variant only" qualifier.
- **Impact**: Low — the hazard is real for the deferred architecture. But a reader auditing launch-blocking risk would weigh a hazard that the launch build structurally cannot hit, and HAZ-020's "Occasional" likelihood is misleading for the Postgres-only default (it is effectively Improbable / N/A there).
- **Recommendation**: Tag HAZ-020 (and any other purely-cache-layer rows) "deferred-variant only," or split the likelihood by variant (N/A for lean launch, Occasional for the Redis variant). HAZ-021 (pending-row lease orphan) is fine — it is keyed on the `fetch_queue` row lease (FR-018), which is the lean-launch mechanism.

---

### PRF-HAZ-003 — HAZ-010 mitigation cites "REQ-IF-004 batch limit (max 20 IDs)" as the client-facing cap, contradicting FR-045's 100-id client limit

- **Severity**: Minor
- **Defect type**: Traceability / contradiction with locked design
- **Location**: hazard-analysis.md, SYS-004 register (HAZ-010)
- **Description**: HAZ-010 ("Batch payload exceeds `fetch_queue` row constraints and the enqueue is dropped") mitigates with "REQ-IF-004 batch limit (**max 20 IDs**)." Under the locked design, 20 is the **internal USDA-call batch detail** (FR-023); the **client-facing** hard batch cap is **100** (FR-045, `400` over the limit, enqueues nothing) — and HAZ-037's own mitigation correctly cites "FR-045 hard batch-size cap (`400`)." So HAZ-010 cites the wrong bound as the protective limit and is internally inconsistent with HAZ-037.
- **Impact**: A reader tracing the batch-oversize control from HAZ-010 lands on the 20-id internal detail instead of the binding 100-id client cap (FR-045), weakening Matrix-H closure for the batch-backpressure path.
- **Recommendation**: Update HAZ-010's mitigation to cite FR-045 (100-id client cap + `400`) as the client-facing limit, keeping FR-023 (≤20 ids/USDA call) only as the internal batching note.

---

### PRF-HAZ-004 — HAZ-036 and HAZ-037 each still bundle multiple separately-mitigated failure modes into one row (granularity)

- **Severity**: Minor
- **Defect type**: FMEA granularity (compound failure mode) — carried unchanged
- **Location**: hazard-analysis.md, HAZ-036 and HAZ-037
- **Description**: Per IEC 60812 a row should isolate one failure mode so its severity/likelihood/mitigation can each be assessed. HAZ-036 still bundles ≥4 modes (anonymous, forged-identity-header, expired/`nbf`, wrong-`azp`/wrong-instance) plus async-producer bypass, each with a different controlling FR (FR-035/FR-038/FR-037/FR-048). HAZ-037 still bundles per-`sub` budget exhaustion (FR-043), distinct-requester priority-inflation starvation (FR-044), oversized batch (FR-045), and queue-depth/circuit-breaker (FR-046) under one Critical × Occasional rating — and FR-044 starvation vs FR-043 budget exhaustion have materially different likelihoods.
- **Impact**: A single severity/likelihood pair cannot be exactly correct for a union of modes. Non-blocking: the controlling FRs are each cited in the mitigation cell, so traceability is recoverable.
- **Recommendation**: Optionally decompose HAZ-036 into {edge auth-bypass; client-forgeable-identity-header trust; async-producer/provenance bypass} and HAZ-037 into {per-`sub` budget exhaustion; distinct-requester priority-inflation starvation; oversized-batch / queue-backpressure}, each child carrying its own severity/likelihood and FR for one-to-one Matrix-H traceability.

---

### PRF-HAZ-005 — Coverage Summary "Mitigations referencing `REQ-NNN`" label still reads stronger than its OR-legend; confirm REQ-037–REQ-044 exist

- **Severity**: Observation
- **Defect type**: Traceability statement precision — carried unchanged
- **Location**: hazard-analysis.md, Coverage Summary row "Mitigations referencing `REQ-NNN` ✓"; HAZ-032 (ARCH/MOD-only) mitigation cell
- **Description**: The legend says "every hazard mitigation cites at least one `REQ-NNN` **or** `SYS/ARCH/MOD` companion control" (an OR), yet the row label "Mitigations referencing `REQ-NNN` ✓" reads as a universal-REQ claim. The five SYS-013 rows all lead with FR-IDs plus explicit `REQ-037..044 / REQ-IF-008`, so the auth slice closes cleanly; but ARCH-only rows (e.g. HAZ-032 cites only ARCH/MOD) make the stronger reading false.
- **Impact**: A reader auditing Matrix H for hazard→REQ closure on the ARCH rows finds the label over-promises. Precision issue, not a missing mitigation.
- **Recommendation**: Reword to "every hazard cites ≥1 control among REQ/SYS/ARCH/MOD" (matching the legend), or add the missing `REQ` to the ARCH-only rows. Spot-check that REQ-037–REQ-044 / REQ-IF-008 exist in `requirements.md` so the auth rows close Matrix H.

---

## Disposition

1 Critical / 0 Major → does **not** pass the baseline gate. The Critical (PRF-HAZ-001, missing rolling-window state-loss hazard) is the one new-failure-mode the reconciliation introduced and the register has not yet absorbed — it must be added before baseline because it can breach the system's hardest guarantee (SC-002). The rolling-window race (HAZ-016), demotion fail-open (HAZ-038), SWR-indefinite (HAZ-009), tombstone-TTL (HAZ-019), and auth hazards (HAZ-036..040) are all correctly reconciled to the locked design. The three Minors and one Observation are non-blocking refinements.

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

- **PRF-HAZ-001** (rolling-window state-loss bounded burst) — carried as the limiter-state-loss hazard (HAZ-041); unchanged by the register.
- **PRF-HAZ-002** (HAZ-020 cache-invalidation) — **deferred-variant-only**; the lean launch has no separate cache to invalidate. HAZ-021 (pending-row lease orphan) harmonizes to the **`leased_at`** column + 30s reaper (**D-LEASE**); use the same `leased_at` framing in HAZ-008.
- **PRF-HAZ-003 / PRF-HAZ-004 / PRF-HAZ-005** — carried (FR-045 100-id client cap citation; FMEA granularity; coverage-summary wording).
- **Hazards to add** (per §3.4/§3.6/§3.11): a **candidate-set integrity / 30-day-expiry** hazard (stale candidates served or lost — D-CANDIDATES/D-UNRESOLVED-TTL) and the **provenance cross-`food_id` `source_id`** hazard, now closed structurally by the composite `(food_id, source_id)` FK (HAZ-017 mitigation). The `food.status` enum naming applies to every status-bearing hazard.
