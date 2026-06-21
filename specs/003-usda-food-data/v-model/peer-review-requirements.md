# Peer Review — requirements

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-20
**Artifact**: requirements.md (84 requirements) — full sweep, with emphasis on the reconciled Postgres-as-queue + rolling-window + demotion-fairness + lifecycle (SWR / tombstone-TTL / batch-partial) design
**Standard**: INCOSE Guide for Writing Requirements
**Supersedes**: the 2026-06-19 peer-review (STALE — predates the SQS→Postgres reconciliation and the 2026-06-20 rate-limit/fairness/lifecycle clarifications; it reviewed a token-bucket + per-user `429` quota model that is no longer the design).

## Summary

| Severity           | Count  |
| ------------------ | ------ |
| Critical           | 3      |
| Major              | 4      |
| Minor              | 3      |
| Observation        | 3      |
| **Total Findings** | **13** |

Overall assessment: **FAIL — 3 Critical / 4 Major.** The auth slice (REQ-035, REQ-037a..d, REQ-038a..c, REQ-039, REQ-040a..b, REQ-041..044, REQ-IF-007/008) and the lifecycle requirements (REQ-005 tombstone-TTL, REQ-031 SWR) are **correctly reconciled** to the locked design — REQ-039 is now demotion-by-back-ranking (no per-user `429`), the glossary `RateLimitWindow` is annotated "(formerly TokenBucketState)", and the rolling-window requirements (REQ-019/020/021) are clean. **However, the demand-path and queue-management requirements (REQ-011, REQ-012, REQ-013–REQ-017) were not migrated** and still describe the superseded model: cache-miss enqueue via an **EventBridge `FoodRequested`/`FoodBatchRequested` publish**, **static origin-based high/low priority**, a **claim-high-priority-first** worker, and **60s/120s leases** — all of which directly contradict spec.md (FR-011 "EventBridge is NOT on the demand-path enqueue"; FR-014/FR-015 single demand-weighted `fetch_queue`; FR-018 30s lease) and the reconciled REQ-039. These are the blocking findings.

## Findings

---

### PRF-REQ-001

**Severity**: Critical (Regression vs reconciled design — demand-path enqueue mechanism)
**Defect type**: Internal consistency / alignment with spec.md
**Location**: REQ-011, REQ-012 (and REQ-IF-005 partial)

**Description**: REQ-011 states "The system SHALL **publish a `FoodRequested` event to EventBridge** when a single food lookup results in a cache miss" and REQ-012 the same for `FoodBatchRequested`. This is the **superseded SQS/EventBridge demand-path model**. The locked design (spec.md FR-011, FR-014, FR-017; Glossary `FoodDataEvent`; this artifact's own Overview line 10 and REQ-IF-005) is unambiguous that the **cache-miss enqueue is a direct `INSERT … ON CONFLICT` into `fetch_queue` paired with `pg_notify('fetch_queued')`** and that **"EventBridge is reserved for scheduled producers (stale-refresh/bulk-sync) and the `FoodDataReceived` completion event — it is not on the demand-path enqueue."** As written, REQ-011/REQ-012 mandate an architecture the design forbids, and they are the parents of SYS-002 (EventBridgeBus) and SYS-003/004 (the fetch queues) in system-design.md, so the contradiction propagates downstream. Implementation is blocked: an implementer cannot satisfy both REQ-011 ("publish to EventBridge") and FR-011 ("not on the demand-path enqueue").

**Recommendation**: Rewrite REQ-011/REQ-012 to "SHALL enqueue the cache-miss `fdcId`(s) into `fetch_queue` via the idempotent `INSERT … ON CONFLICT` (REQ-013/FR-014) paired with `pg_notify('fetch_queued')` (FR-017); EventBridge is used only for scheduled producers and the `FoodDataReceived` completion event." Re-cite FR-011/FR-014/FR-017. Reconcile REQ-IF-005's phrasing (it is already half-correct: it says `FoodRequested`/`FoodBatchRequested` "manifest as `fetch_queue` rows (insert + NOTIFY)").

---

### PRF-REQ-002

**Severity**: Critical (Regression vs reconciled design — queue priority model)
**Defect type**: Internal consistency / correctness of the new mechanism
**Location**: REQ-014, REQ-015 (and REQ-IF-005, SYS-003/004 parents)

**Description**: REQ-014 mandates a **static origin-based priority attribute** ("`FoodRequested`-origin rows at high priority, `FoodBatchRequested`/`IngestionScheduled`-origin rows at low priority") and REQ-015 mandates a **claim-high-priority-first** worker ("SHALL claim high-priority rows first … only claim low-priority rows when no high-priority rows are claimable"). This is the superseded two-class static-priority model. The locked design (spec.md FR-014/FR-015; REQ-039 in this same artifact; system-design Path 4) is **demand-weighted dynamic ordering**: `SELECT … ORDER BY request_count DESC, first_requested ASC` with **dynamic per-`sub` demotion computed at drain time** (>50 pending → ranked to back). REQ-014/REQ-015 contradict the reconciled REQ-039 inside the same document ("priority is computed at drain time from the requester's current pending count … the queue scorer reads live state, not a frozen flag"). The two priority models are mutually exclusive: a frozen `priority` column cannot also be "computed at drain time from live state."

**Recommendation**: Replace REQ-014 with the demand-counter + dynamic-demotion model ("each `fetch_queue` row carries `request_count`; ordering is `request_count DESC, first_requested ASC`; a `sub` with >50 pending is demoted to the back, computed at drain time"), and REQ-015 with the `SELECT … FOR UPDATE SKIP LOCKED` drain order (FR-015). Keep one logical `fetch_queue`; drop the high/low static-class language. Cite FR-014/FR-015/FR-043/FR-044.

---

### PRF-REQ-003

**Severity**: Critical (Internal contradiction — lease duration)
**Defect type**: Internal consistency / alignment with spec.md
**Location**: REQ-017 vs REQ-021, REQ-CN-003, spec.md FR-018 / FR-022 / Edge Cases

**Description**: REQ-017 states "A claimed **high-priority** `fetch_queue` row SHALL hold a lease of **60 seconds**; a claimed **low-priority** row SHALL hold a lease of **120 seconds**." spec.md FR-018 and the Edge Cases section define a **single 30-second** lease ("Stale `in_flight` rows older than **30s** MUST be reverted to `pending`"; "The `in_flight` lease expires after **30s**"). REQ-017 both (a) introduces lease values that contradict the spec's 30s and (b) re-asserts the high/low priority dichotomy that PRF-REQ-002 flags as superseded. A verifier cannot determine the correct lease-timeout boundary, and the crash-recovery test (acceptance "in_flight … reverts to pending") would be written against the wrong threshold.

**Recommendation**: Set REQ-017 to a single 30s lease matching FR-018 ("a claimed `in_flight` row SHALL hold a 30-second lease; an expired lease SHALL revert the row to `pending`"), removing the priority-class split.

---

### PRF-REQ-004

**Severity**: Major (Inconsistency — tombstone status vs delete; tombstone TTL)
**Defect type**: Internal consistency / alignment with spec.md
**Location**: REQ-024, REQ-025 vs spec.md FR-024, FR-025; REQ-018 vs FR-025

**Description**: Two related drifts:

1. **Resolution mechanism**: REQ-024 says on `200` the consumer "SHALL … **delete the `fetch_queue` row**" and REQ-025 says on `404` "write a tombstone record … **delete the `fetch_queue` row**." spec.md FR-024 says "mark the `fetch_queue` row fetched (**resolve/delete** the row)" — acceptable — but FR-025 says on `404` "**set the `fetch_queue` row `status='tombstone'`**" (the durable row IS the audit record; US-5 AS-6/AS-7 require querying `WHERE status='tombstone'`). REQ-025's "delete the row" destroys the tombstone audit record that SC-006 and US-5 depend on.
2. **Tombstone TTL conflation**: REQ-025 (the `foods` `not_found` tombstone) correctly carries the **30-day** TTL (matches FR-025). But REQ-018 says "Tombstone rows (`status='tombstone'`) SHALL be retained for **14 days**" — that is the `fetch_queue` retry-exhausted tombstone (Glossary "Tombstone Row … Retained for 14 days"), a different entity from the `foods` `not_found` 30-day tombstone. The two TTLs are correct individually but the shared term "tombstone" with no disambiguation invites the wrong value being implemented.

**Recommendation**: Change REQ-025 to "set the `fetch_queue` row `status='tombstone'`" (do not delete) so the audit record survives. Add a one-line disambiguation that the `foods.fetch_status='not_found'` tombstone (30-day TTL, REQ-005/FR-025) and the `fetch_queue.status='tombstone'` retry-exhausted row (14-day retention, REQ-018) are distinct.

---

### PRF-REQ-005

**Severity**: Major (Completeness — FR-043 distinct-requester demand counting unmodeled)
**Defect type**: Completeness / traceability
**Location**: REQ-014/REQ-015 (request_count semantics) vs spec.md FR-044

**Description**: spec.md FR-044 requires that demand counting (`request_count`) count **distinct authenticated `sub`s** per `fdcId` (not raw request volume), with a **capped** priority contribution and **aging** so no `fdcId` is pinned to the front indefinitely (anti-starvation). No REQ row captures FR-044. REQ-014/REQ-015 (once corrected per PRF-REQ-002) describe `request_count DESC` ordering but say nothing about distinct-`sub` counting, the cap, or aging. This is a load-bearing correctness property of the reconciled priority mechanism — without it the new ordering reintroduces the priority-inversion starvation FR-044 exists to prevent — and it is currently untraceable from requirements.

**Recommendation**: Add a requirement (e.g. REQ-014b) binding FR-044: "`request_count` SHALL count distinct authenticated `sub`s per `fdcId` (resolved via `fetch_requesters`); a single `sub`'s repeated requests SHALL NOT increment priority more than once; the priority contribution SHALL be capped and queue ordering SHALL apply aging." Verification = Test.

---

### PRF-REQ-006

**Severity**: Major (Completeness — FR-045 batch per-item partial response unmodeled in functional rows)
**Defect type**: Completeness / traceability
**Location**: REQ-012, REQ-040a vs spec.md FR-045

**Description**: The reconciled batch contract (spec.md FR-045, clarified 2026-06-20) has two binding parts: (a) hard max **100 `fdcId`s/request → `400`, enqueue nothing**; and (b) **per-item partial response** — cached/stale foods inline + each miss returned as a `pending` entry (enqueued) in one body. REQ-040a captures both correctly ("a hard maximum of 100 … per-item partial result … cached/stale foods returned inline and each miss returned as a `pending` entry"). **Good.** However REQ-012 (the recipe-import multi-food path) still describes the old "publish a single `FoodBatchRequested` event" shape and does not reference the per-item partial response or the 100-id cap, so the two batch requirements are inconsistent with each other. (REQ-040a is correct; REQ-012 is stale — overlaps PRF-REQ-001.)

**Recommendation**: After fixing REQ-012 per PRF-REQ-001, cross-reference REQ-040a for the response shape and the 100-id cap so the multi-food path and the batch endpoint describe one consistent contract.

---

### PRF-REQ-007

**Severity**: Major (Inconsistency — REQ-013/REQ-030 Redis framed as co-equal vs deferred)
**Defect type**: Internal consistency
**Location**: REQ-013, REQ-024, REQ-030, REQ-008/SYS-008 vs A-002 / lean-launch default

**Description**: The lean-launch default is **Postgres-only; Redis is the deferred variant** (A-002, REQ-CN-002, Glossary "Lean Launch"/"Full Architecture"). REQ-013 and REQ-020 correctly mark Redis "deferred variant." But REQ-024 still says on success the consumer "SHALL **cache it in Redis** (deferred variant only)" — the "(deferred variant only)" qualifier is present, good — while the deduplication requirement REQ-013 lists the Postgres `ON CONFLICT` as the lean default. This is internally consistent on inspection; the residual issue is only that REQ-024's success-path step lists "remove it from the pending set" (a Redis-set concept) alongside the Postgres `fetch_queue` resolution, mixing the two dedup mechanisms in one row. Minor-leaning Major because it muddies which dedup mechanism the success path clears in the default build.

**Recommendation**: In REQ-024 split the lean-launch success path (resolve the `fetch_queue` row; emit `FoodDataReceived`) from the deferred-variant steps (Redis cache write, Redis pending-set removal), so the default build's success path contains no Redis-only step.

---

### PRF-REQ-008

**Severity**: Minor (Traceability — FR-046 queue-depth backstop interaction with demotion)
**Defect type**: Traceability precision
**Location**: REQ-040b, REQ-039 vs spec.md FR-046 / FR-043

**Description**: REQ-040b correctly binds the 10,000-entry `fetch_queue` depth ceiling + circuit-breaker `503` (FR-046). REQ-039 correctly binds demotion fairness (FR-043) and references "the queue-depth backstop (REQ-040b, `503`)." The pairing is sound. The only gap: neither row states the **interaction order** — whether the depth `503` is evaluated before or after the per-`sub` demotion ranking at enqueue (system-design Path 0 places `503` first, then demotion). Without that ordering the two admission controls are individually traceable but their composition is not.

**Recommendation**: Add to REQ-040b (or REQ-039) one clause fixing the order: "queue-depth/circuit `503` is evaluated at enqueue before demotion ranking is applied" (consistent with the `401 → 403 → 400 → 404/202/200` precedence and Path 0).

---

### PRF-REQ-009

**Severity**: Minor (Traceability — FR-050 still uncited)
**Defect type**: Completeness / traceability
**Location**: Auth slice vs spec.md FR-050

**Description**: Carried forward and still valid against the reconciled design: FR-050 (HTTP in-process middleware on every route, no fail-open authorizer cache to poison; deferred WebSocket `$connect` cache TTL=0 keyed solely on the verified token, attached to every route AND method, no default-open) is not cited by any REQ row. REQ-035 captures "no API Gateway / Lambda authorizer in the HTTP request path" and REQ-043 specifies the `$connect` contract, but the FR-050 "no fail-open cache / every route / no default-open" binding is unmapped.

**Recommendation**: Extend REQ-043 with the `$connect` authorizer cache-binding / no-default-open rule and note in REQ-035/REQ-037a that the in-process middleware runs on every route with no fail-open cache; add the FR-050 citation.

---

### PRF-REQ-010

**Severity**: Minor (Traceability — REQ-036 numbering gap)
**Defect type**: Internal consistency
**Location**: REQ-035 → REQ-037a numbering

**Description**: Carried forward: the IDs jump REQ-035 → REQ-037a with no REQ-036 and no "reserved/omitted" annotation. FR-036's networkless-verification obligation is folded into REQ-037a (cited "FR-035/FR-036"), so nothing is lost, but the discontinuity reads as a dropped requirement to downstream V&V.

**Recommendation**: Add "REQ-036 intentionally not used; FR-036 covered within REQ-037a," or renumber.

---

### PRF-REQ-011

**Severity**: Observation (Resolved — fairness model migrated to demotion)
**Defect type**: Internal consistency / correctness of the new mechanism
**Location**: REQ-039, SC-012, Glossary `RateLimitWindow`

**Description**: **RESOLVED / correct.** REQ-039 is fully reconciled to the locked demotion model: "fairness by **queue demotion, not rejection** … **no personal-limit `429`** … >50 pending → ranked to the **back** … **dynamic** … computed **at drain time** … work-conserving." It correctly distinguishes the global rolling-window limiter (REQ-019, protects USDA) from demotion (protects users from each other) and ties to SC-012 and the 90% pause. The prior review's per-`sub` `200/hr` quota + `20%` ceiling + `429` (a token-bucket artifact) is gone. The Glossary `RateLimitWindow` is annotated "(formerly TokenBucketState)" with Postgres `usda_call_log` as the lean state. No action.

---

### PRF-REQ-012

**Severity**: Observation (Resolved — lifecycle: SWR + tombstone TTL)
**Defect type**: Completeness / correctness
**Location**: REQ-005, REQ-031

**Description**: **RESOLVED / correct.** REQ-005 binds the 30-day tombstone TTL with post-TTL re-attempt counting against the normal budget (FR-025). REQ-031 binds stale-while-revalidate: serve stale `200` immediately + background re-fetch, never `202` for a held record, and **serve stale indefinitely** if the re-fetch keeps failing — matching the 2026-06-20 clarifications (FR-031). No action. (See PRF-REQ-004 for the residual term-disambiguation note that keeps this an Observation rather than fully clean.)

---

### PRF-REQ-013

**Severity**: Observation (Resolved — auth slice + rolling window stable)
**Defect type**: Internal consistency / traceability
**Location**: REQ-019/020/021 (rolling window), REQ-035/037a–d/038a–c/041–044, REQ-IF-007/008, A-011

**Description**: **RESOLVED / stable.** The rolling-60-min-window requirements (REQ-019 ≤1,000 trailing-hr / pause at 90%/900; REQ-020 atomic `usda_call_log` count+insert; REQ-021 hold-at-cap-and-wait) are clean and free of token-bucket residue. The auth slice remains converged on the in-process NestJS middleware model (REQ-035/REQ-IF-007: "no API Gateway / Lambda authorizer in the HTTP request path"), the WebSocket `$connect` authorizer is the only authorizer surface (REQ-043), M2M class (REQ-041), async-producer provenance (REQ-042), load-shed (REQ-044a/b), and non-secret config (REQ-044c) are all present and atomic. These slices did not regress; the blocking defects are confined to the demand-path/queue-management rows (PRF-REQ-001..003) that the reconciliation pass missed.

---

## Verdict

**Verdict: FAIL — 3 Critical / 4 Major.** The auth, rolling-window, demotion-fairness, and lifecycle requirements are correctly reconciled, but the demand-path enqueue (REQ-011/012), queue priority (REQ-014/015), and lease (REQ-017) requirements still encode the superseded EventBridge-publish + static-priority + 60s/120s-lease model and contradict both spec.md and the reconciled REQ-039 in the same document. Migrate REQ-011–REQ-017 to the Postgres-as-queue / demand-weighted / dynamic-demotion / 30s-lease model, fix the tombstone-delete-vs-status drift (REQ-025), and add the FR-044 distinct-requester and FR-045 cross-reference coverage before this artifact passes the gate.

---

## Remediation Status (2026-06-20, round 4)

All **Critical and Major** findings in this review were **remediated in the same session**. The artifacts now reflect the canonical model — Postgres demand-weighted `fetch_queue` (single queue, no high/low tier), rolling-60-min window limiter (`usda_call_log`), dynamic queue **demotion** wired on every enqueue path (incl. single-food), distinct-requester demand via `fetch_requesters` (FR-044), `status` enum `pending | in_flight | tombstone`, single 30s lease, rolling-window state-loss hazard (HAZ-041), and in-process NestJS auth. Reconciled across spec/plan/tasks + the full v-model. This record documents the findings **as reviewed**; the gate (`.forge-status.yml → peer_review_gate`) reflects the post-remediation state. An independent re-review is the optional final confirmation.
