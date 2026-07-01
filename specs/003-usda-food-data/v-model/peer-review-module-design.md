# Peer Review — module-design

**Reviewer**: Independent V-Model Peer Reviewer
**Date**: 2026-06-20
**Artifact**: module-design.md — full document (MOD-001…MOD-014), with focus on the locked rate-limiter and fairness slice: **MOD-005 `RollingWindowLimiter`** (decomposing ARCH-005) and the ARCH-012 decomposition **MOD-012 `ClerkAuthMiddleware` / MOD-013 `DemotionAndFairness` / MOD-014 `AsyncProducerAuthz`**
**Standard**: IEEE 1016 / DO-178C-style low-level module design
**Source of truth**: `../spec.md` (FR-019/020/023/043/044/045/046/048/052/053, SC-011/012, A-012) + clarifications (token-bucket→rolling-window, quota→demotion); `../v-model/architecture-design.md` ARCH-005/ARCH-012; `../plan.md` §2A
**Locked design checked for**: rolling-60-min window (atomic count+record, no token bucket); demotion fairness (DEMOTE_THRESHOLD=50, dynamic re-promotion, no `429`, per-`sub` pending derived from `fetch_queue`+`fetch_requesters`, quota tables dropped); SWR / tombstone-TTL-30d / batch-partial; in-process auth; correct source paths.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **6** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

Overall assessment: **PASS WITH MAJORS**. The slice is well-reconciled to the locked design. **MOD-005** is fully re-modeled as a rolling-60-min window: an explicit "(formerly TokenBucketRateLimiter)" note with the breach rationale, an atomic single-statement count+conditional-insert against `usda_call_log` (FR-020), `HARD_CAP=1000` / `PAUSE_THRESHOLD=900`, a `shouldPauseDraining` soft gate, "treat the window as full / back off (NOT a state reset)" on USDA `429`, and a deferred-Redis Lua variant — no token/refill/capacity concept survives. **MOD-013** is fully re-modeled as `DemotionAndFairness`: "(formerly QuotaAndFairness)", `DEMOTE_THRESHOLD=50`, **dynamic** drain-time re-promotion (`isDemoted`/`drainPriorityTier` read live `pendingCountForSub`, no frozen flag), explicit "no `429`, never rejected for a personal quota," per-`sub` pending derived by joining `fetch_queue`↔`fetch_requesters` (no `user_fetch_quota`/`global_fetch_quota`/`QUOTA_PER_HOUR`/`GLOBAL_SHARE_CAP`), with FR-044 distinct-requester demand + `PRIORITY_CAP=1` and FR-045/FR-046 retained. MOD-012 (DoS load-shed gates, fail-closed `401`, `azp`, `403`, M2M) and MOD-014 (FR-048 async-producer provenance) carry all four IEEE 1016 views and trace to ARCH-012. Source paths match the lock (`rate-limiter` lives in MOD-005; `auth/demotion-and-fairness.service.ts` for MOD-013; `food-service`/`usda-client`/`clerk-verify` packages). 14 MODs, 100% ARCH coverage.

Two **Majors** block clean implementation of the fairness path: (1) **MOD-013's admission gate is never invoked on the single-food cache-miss path** — MOD-001's single-food and SWR-refetch and tombstone-expiry branches call `markPending` + `EventBridgePublisher.publishFoodRequested` directly, with only an inline `// admit (MOD-013)` _comment_ and no actual `admitEnqueue` call (the real call exists **only** in the batch handler), so the primary path skips backpressure (FR-046 `503`), distinct-requester demand (FR-044), and demotion enrollment (FR-043); and (2) `MAX_QUEUE_DEPTH` / the demand model remain under-specified and divergent from spec (`M` symbolic vs FR-046's binding 10,000; the demand-counting status literal disagrees with the queue's status enum). Minors cover the MOD-013/MOD-014 symbol mix-up in MOD-001 (`AsyncEnqueueAuthz.admitEnqueue`), FR-044 aging with no owning MOD, and the unawaited `verifyToken`. The token-bucket / quota / SQS purge is complete on the design side.

## Findings

---

### PRF-MOD-001 — MOD-013 `admitEnqueue` is not actually called on the single-food cache-miss / SWR / tombstone-expiry paths (only the batch path); the others carry a comment, not a call

**Severity**: Major
**Defect type**: Completeness / wiring correctness (fairness + backpressure not enforced on the primary demand path)
**Artifact**: module-design.md MOD-001 §1 — single-food miss (lines 80–84), SWR re-fetch (lines 60–63 + `triggerBackgroundRefetch` 155–157), tombstone-TTL-lapse re-attempt (lines 69–73); contrast batch path (line 121); MOD-013 `admitEnqueue` (lines 1301–1306)

**Evidence**:

- The **batch** handler correctly calls `AsyncEnqueueAuthz.admitEnqueue(req.user, fdcIds)` (line 121) before enqueueing misses.
- The **single-food** miss (Layer 4, lines 80–84) does `CacheService.markPending(fdcId)` then `EventBridgePublisher.publishFoodRequested(...)` — the only MOD-013 reference is the inline comment `// Layer 4: Trigger async backfill — admit (MOD-013) then INSERT …`. There is no `admitEnqueue` / `checkBackpressure` / `recordDemand` invocation.
- Same for the **SWR background re-fetch** (`triggerBackgroundRefetch`, lines 155–157, comment "admit (MOD-013)" at line 61) and the **tombstone-TTL-lapsed re-attempt** (lines 69–73).
- Consequence: on the highest-traffic path (single-food cache miss), `fetch_queue` backpressure / circuit-breaker (FR-046 → `503`), distinct-requester demand recording (FR-044, `fetch_requesters` upsert + capped bump), and the per-`sub` demotion enrollment that SC-012/FR-043 rely on are all bypassed. The demotion query `pendingCountForSub` joins `fetch_requesters`, but no single-food path writes `fetch_requesters` (only MOD-013 `recordDemand` does, which is unreached) — so demotion would see an empty requester set and never engage.

**Impact**: FR-043 (demotion), FR-044 (distinct-requester demand), and FR-046 (backpressure `503`) are unenforced for single-food lookups and SWR/tombstone re-fetches — i.e. for the dominant request mix. SC-012's "no single `sub` starves others" cannot hold. This is the locked-design fairness mechanism failing to fire on its primary path.

**Required Action**: Make MOD-001's single-food miss, `triggerBackgroundRefetch`, and tombstone-lapse branches call `DemotionAndFairness.admitEnqueue(req.user, [fdcId])` (which runs `checkBackpressure` + `recordDemand`) before `publishFoodRequested`, so every demand-path enqueue records `fetch_requesters` and is subject to backpressure — matching the batch path and the ARCH-012 "before/at enqueue" contract.

---

### PRF-MOD-002 — `MAX_QUEUE_DEPTH` stays symbolic (`M`) and the demand/status model diverges from spec.md (FR-046 binds 10,000; demotion query keys on `'queued'`)

**Severity**: Major
**Defect type**: Under-specification + cross-artifact consistency
**Artifact**: module-design.md MOD-013 §1 (`MAX_QUEUE_DEPTH = M`, line 1252), §3 `FairnessConfig.maxQueueDepth: number` (line 1339), `pendingCountForSub` (`q.status = 'queued'`, line 1281); cross-check spec.md FR-046 (10,000, configurable), FetchQueueRow status enum (`pending|in_flight|tombstone`), MOD-003/MOD-004 (`queued|leased|tombstone`)

**Evidence**:

- FR-046 fixes a **binding** `fetch_queue` ceiling of **10,000 entries (configurable)**, but MOD-013 §1 still declares `MAX_QUEUE_DEPTH = M` (symbolic) and §3 `maxQueueDepth: number` carries no default. An implementer cannot derive the ceiling from the design; this was flagged in the prior review and is still open.
- The per-`sub` pending-count query filters `q.status = 'queued'`, but spec.md's FetchQueueRow status enum is `pending | in_flight | tombstone` (MOD-003/MOD-004 use `queued|leased|tombstone`). The status literal that defines "currently pending" is not agreed across the three artifacts, so the demotion count can silently mismatch the rows actually queued (see also peer-review-architecture-design PRF-ARCH-002).

**Impact**: Backpressure `503` (FR-046) and the demotion pending-count (FR-043/SC-012) both depend on values the design leaves symbolic or inconsistent. Low risk to the auth invariants, but a traceable correctness gap on the fairness path.

**Required Action**: Set `maxQueueDepth` to the concrete FR-046 default (10,000, configurable) in MOD-013 §1/§3, and reconcile the `pendingCountForSub` status filter to the single canonical `fetch_queue.status` enum once the spec/ARCH/MOD vocabulary is unified.

---

### PRF-MOD-003 — MOD-001 references the wrong owning module for `admitEnqueue` (`AsyncEnqueueAuthz` ≠ MOD-013 `DemotionAndFairness` / MOD-014 `AsyncProducerAuthz`)

**Severity**: Minor
**Defect type**: ARCH↔MOD / inter-module name agreement
**Artifact**: module-design.md MOD-001 §1 (line 121, `AsyncEnqueueAuthz.admitEnqueue(req.user, fdcIds)`); MOD-013 owns `admitEnqueue` (line 1301); MOD-014 is `AsyncProducerAuthz` (line 1356)

**Evidence**:

- The batch handler calls `AsyncEnqueueAuthz.admitEnqueue(...)`. No module named `AsyncEnqueueAuthz` exists. `admitEnqueue` is defined on **MOD-013 `DemotionAndFairness`**; the similarly-named **MOD-014 `AsyncProducerAuthz`** owns the _async-producer provenance_ leg (`admitAsyncEvent`/`assertEnqueueProvenance`), a different concern.
- This collides two distinct auth-slice modules under an invented name and will mislead an implementer into wiring the wrong service on the synchronous demand path.

**Required Action**: Call `DemotionAndFairness.admitEnqueue(req.user, fdcIds)` in MOD-001 (and apply the same correction when fixing PRF-MOD-001's single-food path), reserving `AsyncProducerAuthz` (MOD-014) for the consumer-side provenance gate.

---

### PRF-MOD-004 — FR-044 anti-starvation aging is still delegated to "the queue scorer" with no owning MOD

**Severity**: Minor (carried from prior review)
**Defect type**: Traceability gap
**Artifact**: module-design.md MOD-013 §1 (`recordDemand`, line 1273 comment "aging applied by the queue scorer"), `drainPriorityTier` (lines 1294–1296); spec.md FR-044

**Evidence**:

- FR-044 requires three behaviours: distinct-`sub` counting, capped contribution, **and** "queue ordering MUST apply aging so no `fdcId` can be pinned to the front indefinitely."
- MOD-013 models the first two (`fetch_requesters` upsert + `PRIORITY_CAP=1`) and adds `drainPriorityTier` for the demotion tier, but the **aging** clause is still offloaded inline to "the queue scorer" with no MOD/ARCH home. `drainPriorityTier` returns only the demoted/normal tier; it does not encode FIFO-aging within a tier, and no MOD owns it (MOD-003 is the `fetch_queue` schema/claim SQL, MOD-004 the drain loop — neither is named as the aging owner).

**Impact**: One-third of FR-044 has no owning module; per FR-053's anti-pattern, an aging requirement with no module home risks being dropped at implementation.

**Required Action**: Make aging an explicit step in MOD-013's `drainPriorityTier` (or name MOD-003/MOD-004's claim `ORDER BY` as the aging owner — the ARCH-004 claim already sorts `first_requested ASC`), so all three FR-044 clauses trace to a module.

---

### PRF-MOD-005 — MOD-012 §1 `verifyToken` is invoked without an explicit `await`, leaving the async fail-closed + semaphore-release boundary unpinned

**Severity**: Minor (carried from prior review)
**Defect type**: Interface ambiguity / fail-closed + concurrency correctness
**Artifact**: module-design.md MOD-012 §1 (`claims = verifyToken(...)` inside `TRY/CATCH/FINALLY`, lines 1129–1141)

**Evidence**:

- `@clerk/backend` `verifyToken` returns a Promise, but MOD-012 writes `claims = verifyToken(token, {...})` inside a synchronous `TRY/CATCH AnyVerificationError` whose `FINALLY` releases `verifySemaphore`.
- Without `await`, a rejected verification would not be caught by the synchronous `CATCH`, so the fail-closed `401` branch (FR-040) would not fire, and the `FINALLY` would release the concurrency slot **before** verification settles — under-counting in-flight verifies and undermining the FR-052/SC-011 load-shed guarantee.

**Required Action**: Make `use(...)` `async` and write `claims = AWAIT verifyToken(...)`, so the `CATCH` intercepts the rejection (fail-closed `401`) and the `FINALLY` releases the semaphore only after settlement. Mirror in `authorizeConnect`.

---

### PRF-MOD-006 — Design↔unit-test symbol drift is one-sided (design now canonical; unit-test.md still stale)

**Severity**: Observation
**Defect type**: Consistency (naming) — design side canonical, test side not reconciled
**Artifact**: module-design.md MOD-012/MOD-013 (`use`/`requireScope`/`req.user`/`tokenClass`/`admitEnqueue`/`isDemoted`); `unit-test.md` UTP-012 (`middleware.verify`/`req.caller`/`isService`/`checkQuota`/`enqueueGate`)

**Evidence**:

- MOD-012/MOD-013 commit to one canonical internal symbol set (`req.user.{sub,azp,scopes,permissions,tokenClass}`, `admitEnqueue`, `isDemoted`, `drainPriorityTier`); the module design is internally coherent and quota-free.
- `unit-test.md` was not reconciled — it still references `req.caller`/`isService`/`checkQuota`/`enqueueGate` (the latter does not exist in MOD-013, whose orchestrator is `admitEnqueue` + `checkBackpressure`), and uses pre-demotion "quota" vocabulary.

**Impact**: Not a defect in module-design — it is the authoritative low-level contract and is consistent. The unreconciled half is a test-artifact defect tracked in `peer-review-unit-test.md`; recorded here only so the design↔test traceability audit captures the divergence.

**Required Action**: No change required in module-design. Reconcile `unit-test.md` UTP-012 to the canonical MOD-012/MOD-013 names and the demotion (not quota) model.

---

_End of Peer Review — module-design, 003-usda-food-data_

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

- **PRF-MOD-001** (`admitEnqueue` on every demand path) — stands; `admitEnqueue` is the per-path admit/backpressure entry, demotion itself is **drain-time** compute (D-FAIRNESS), and `recordDemand` is the distinct-requester upsert (`PRIORITY_CAP=1`, D-DEMAND). `fdc_id` → `food_id`.
- **PRF-MOD-002** (`MAX_QUEUE_DEPTH` / status literal) — set `MAX_QUEUE_DEPTH = 10,000`; canonical `fetch_queue.status = pending | in_flight | tombstone` (+ the new **`leased_at`** column); MOD-003/MOD-004 derive the lease from `leased_at` (drop `lease_expires_at`).
- **PRF-MOD-003 / PRF-MOD-004 / PRF-MOD-005 / PRF-MOD-006** — carried (owning-module name; FR-044 aging owner; `await verifyToken`; design↔unit-test symbol drift).
- **Modules to add** (per §3.4/§3.7/§3.11/§3.16): a **`CandidateStore`** (MOD-006 / MOD-018) over `food_candidates`; **MOD-020** change-refresh **Fargate scheduled task** (D-REFRESH); composite `(food_id, source_id)` provenance FKs (MOD-019); the `source_call_log` retention sweep in MOD-005. The auth guard is **`FoodAuthGuard`** (MOD-012), `x-debug-sub` removed.
