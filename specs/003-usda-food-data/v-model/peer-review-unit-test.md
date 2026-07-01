# Peer Review — unit-test

**Reviewer**: Independent V-Model Peer Reviewer
**Date**: 2026-06-20
**Artifact**: unit-test.md — refreshed against the reconciled + clarified design (2026-06-20): rolling-window limiter (MOD-005), fairness-by-demotion (MOD-013), stale-while-revalidate + tombstone-TTL lifecycle (MOD-001/MOD-004), per-item batch partial, and the intact auth slice (UTP-012/013/014).
**Standard**: ISO/IEC/IEEE 29119-4 (test design techniques)
**Cross-checked against**: `module-design.md` MOD-005, MOD-013, MOD-001, MOD-004, MOD-012/013/014; `../spec.md` FR-019/020/021/025/026/031/043/044/045/046, SC-002/SC-012; `requirements.md` REQ-039/040a/040b.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 3     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **7** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

Overall assessment: **PASS WITH MAJORS.** The prior (2026-06-19) review is superseded. The unit suite has been correctly re-pointed at the reconciled design: every changed mechanism now has unit coverage —

- **Rolling-window limiter (MOD-005):** UTP-005-A drives the trailing-60-min boundaries (empty admits, 899→admit, **exactly 900→pause**, **exactly 1000→1,001st blocked**); UTP-005-B fails closed on store unavailability; UTP-005-C is the `WindowOpen ⇄ WindowFull/DrainPaused` state machine including **calls aging out → resume**. The atomic count-and-record on `usda_call_log` (`INSERT … WHERE count < cap RETURNING`) is named. **No token-bucket / 3-token / 16.67-refill cases remain.**
- **USDA 429 → back off, not reset:** UTP-004-B asserts `extendLease("row-1", 60)` and that the row stays `pending` (FR-026), not a window reset.
- **Demotion + dynamic re-promotion (MOD-013):** UTP-012-E covers **==50 not demoted**, **51 → back-of-queue but still `enqueue`d (no 429, never rejected)**, and **drops to 49 → re-promoted from live state**, work-conserving. **No quota / `429` / `user_fetch_quota` cases remain.**
- **SWR-indefinite:** UTP-001-F serves stale `200` + enqueues re-fetch, and **F2 serves indefinitely** on repeated failure.
- **Tombstone-TTL:** UTP-001-D covers within-TTL `404`/no-enqueue and after-TTL re-attempt counting against the rolling-window budget.
- **Batch partial:** UTP-001-H (cached inline + per-miss `pending`) and UTP-012-F (≤100 boundary / >100 `400`).
- **Auth slice intact:** UTP-012/013/014 and the WS `$connect`-authorizer-only path (UTP-013) are preserved.

The Majors below are **traceability/consistency defects that would block clean 1:1 binding to the locked design**, plus **one genuine contradiction** where a test asserts a cap that the design does not define. None is a coverage hole (no changed requirement has zero coverage → no Critical), but the contradiction (PRF-UTP-009) is borderline and should be resolved before the suite is considered authoritative.

---

## Findings

---

### PRF-UTP-009 — UTS-012-G3 asserts a `DEMAND_CAP = 50` distinct-requester cap that contradicts the locked design (per-`sub` `PRIORITY_CAP = 1`, FR-044) (Major)

**Defect type**: Coverage — contradictory case referencing a non-existent mechanism
**Artifact**: `unit-test.md` UTP-012-G / UTS-012-G3 (`DEMAND_CAP = 50`; 60 distinct subs → `getDemand === 50`); `module-design.md` MOD-013 §`PRIORITY_CAP = 1` (line 1253), `recordDemand` (FR-044); `../spec.md` FR-044

**Evidence**:

- FR-044 / MOD-013 cap the **per-`sub`** contribution at `PRIORITY_CAP = 1` ("a single `sub` contributes at most once to demand"). The design has **no** per-`fdcId` cap on the number of distinct requesters — demand is the count of distinct subs, and 60 distinct subs legitimately yields demand 60 (each contributing its capped 1).
- UTS-012-G3 introduces `DEMAND_CAP = 50` and asserts `getDemand(12345) === 50` for 60 distinct subs — i.e. it caps the _distinct-requester total_ at 50. That cap exists nowhere in MOD-013, REQ-039/040, or FR-044, and it directly contradicts "distinct requesters each contribute exactly one" (correctly asserted one scenario up, in UTS-012-G2).
- This is the same stale `DEMAND_CAP = 50` value the prior review flagged (old PRF-UTP-007) as an invented magic value; under the reconciled design it is now an **active contradiction**, not just an un-anchored constant.

**Impact**: A test asserting a cap the design forbids will either fail against a correct implementation or drive an implementer to add a starvation-inducing distinct-requester ceiling the design rejected. The FR-044 mechanism that _is_ locked (per-`sub` cap of 1, plus aging) is left with a contradictory companion scenario.

**Required Action**: Replace UTS-012-G3. Assert the locked FR-044 behaviour: 60 distinct subs → `getDemand === 60` (or whatever the design's demand readout is) while a single `sub`'s repeats stay capped at `PRIORITY_CAP = 1`; and add a scenario for the **aging** clause (no `fdcId` pinned to front indefinitely). If a distinct-requester ceiling is genuinely wanted, anchor it in MOD-013 first, then test it.

---

### PRF-UTP-010 — MOD-005 unit cases use `trailingCount` / `cap` / `pauseThreshold`, but the design's canonical symbols are `windowCount` / `HARD_CAP` / `PAUSE_THRESHOLD` (Major)

**Defect type**: Consistency (naming) — tests cannot bind 1:1 to the module design
**Artifact**: `unit-test.md` UTP-005-A/B/C (`{ allowed, trailingCount }`, `cap = 1000`, `pauseThreshold = 900`); `module-design.md` MOD-005 §Internal Data Structures (`WindowCheckResult = { allowed, windowCount }`, line 579) and §constants (`HARD_CAP = 1000`, `PAUSE_THRESHOLD = 900`, lines 510–511)

**Evidence**:

- MOD-005 commits to one symbol set: the return type is `WindowCheckResult { allowed: boolean, windowCount: number }` and the constants are `HARD_CAP` / `PAUSE_THRESHOLD` / `WINDOW_SECONDS`.
- Every UTP-005 scenario asserts a field named `trailingCount` and arranges constants named `cap` / `pauseThreshold`. These names do not exist under the design; the design↔test binding audit will show drift across the entire MOD-005 case set.
- (The _values_ — 1000 / 900 / 3600 — and the _logic_ are correct; only the symbol names diverge.)

**Impact**: Not a logic defect, but the limiter is the load-bearing SC-002 mechanism and its tests reference a return field (`trailingCount`) absent from the design, so the suite cannot be generated/bound against MOD-005 without a rename. Mirrors the auth-slice naming drift the prior review raised for MOD-012/013.

**Required Action**: Reconcile UTP-005 to MOD-005's canonical names — `trailingCount → windowCount`, `cap → HARD_CAP`, `pauseThreshold → PAUSE_THRESHOLD` — or, if `trailingCount` is preferred, rename the field in MOD-005 §579 first and propagate. Pick one and make design and test agree.

---

### PRF-UTP-011 — UTS-012-H1 hard-codes `MAX_QUEUE_DEPTH = 1000`, contradicting REQ-040b's enforced 10,000 ceiling (Major)

**Defect type**: Traceability / boundary value inconsistent with the requirement
**Artifact**: `unit-test.md` UTS-012-H1/H2 (`MAX_QUEUE_DEPTH = 1000`); `requirements.md` REQ-040b ("maximum `fetch_queue` depth of **10,000 entries** (configurable)"); `module-design.md` MOD-013 (`MAX_QUEUE_DEPTH = M`, line 1252, symbolic)

**Evidence**:

- REQ-040b fixes the depth ceiling at **10,000** (configurable) with `503` fail-closed. The `503` backpressure boundary case (UTS-012-H1, "depth == max is over-full, reject") arranges `MAX_QUEUE_DEPTH = 1000` and tests the boundary at 1000/999 — an order of magnitude below the binding requirement.
- MOD-013 leaves the constant symbolic (`M`), so the test value matches the **requirement** (10,000) and matches the **design** (symbolic) — but is asserted at a concrete 1000 that traces to neither.
- This is the carried-over magic-value finding (old PRF-UTP-007's queue-depth half), still unresolved and now contradicting REQ-040b's explicit `10,000`.

**Impact**: The backpressure boundary — the SC-relevant `503` fail-closed gate — is verified at a value that conflicts with the binding requirement; a matrix consumer would credit REQ-040b coverage to a case testing the wrong ceiling. Low correctness risk (the branch logic is value-agnostic) but the boundary assertion is untraceable.

**Required Action**: Anchor `maxQueueDepth` in MOD-013 §constants to REQ-040b's `10,000` (configurable), then reference that design value from UTS-012-H1/H2 and test the boundary at the cap and cap±1 against it.

---

### PRF-UTP-012 — UTP-005-A "Requirements Under Test" should also enumerate FR-020 (atomicity) and FR-021 (age-out resume) exercised by its scenarios (Minor)

**Defect type**: Traceability (requirement-set under-declared)
**Artifact**: `unit-test.md` UTP-005-A/C headers; `../spec.md` FR-020 (atomic count-and-record), FR-021 (resume as calls age out)

**Evidence**:

- UTP-005-A's description names FR-019/FR-020 and SC-002, and UTP-005-C exercises FR-021 (the WindowFull→WindowOpen "calls aged out → resume" transition), but the case headers' requirement lines do not consistently enumerate FR-020/FR-021 alongside FR-019.
- The atomic `INSERT … WHERE count < cap RETURNING` (FR-020) is asserted via the in-process count-and-record mock in UTP-005-A but is not tagged to FR-020 in the header set; FR-021's resume is tagged only in prose.

**Impact**: Low — the behaviour is tested, but the matrix reading header lines would not credit UTP-005 with FR-020/FR-021, understating rolling-window coverage.

**Required Action**: Add FR-020 to UTP-005-A and FR-021 to UTP-005-C in the "Requirements Under Test" lines (and matrix rows).

---

### PRF-UTP-013 — Carryover: UTP-012 still uses non-canonical MOD-012/013 symbols (`checkQuota`/`validateBatch`/`countDemand`/`enqueueGate`, `req.caller`/`isService`) (Minor)

**Defect type**: Consistency (naming) — pre-existing, partially unresolved
**Artifact**: `unit-test.md` UTP-012 (`enqueueGate`, `checkQuota`, `validateBatch`, `countDemand`, `req.caller`, `isService`); `module-design.md` MOD-012/013 (`use`, `requireScope`, `req.user`/`tokenClass`, `admitEnqueue`/`checkBackpressure`, `enforceBatchCap`, `recordDemand`)

**Evidence**:

- The reconciliation renamed MOD-013 to `DemotionAndFairness` with functions `admitEnqueue`, `recordDemand`, `enforceBatchCap`, `isDemoted`/`priorityKey`. UTP-012-G/H still invoke `countDemand` / `enqueueGate` and assert `req.caller`/`isService`, none of which match the canonical MOD-012/013 symbols.
- Note: `checkQuota` and any `429`-quota references in UTP-012 prose are now doubly wrong — the design has **no quota function at all** (demotion replaced it). UTP-012-E/F/H themselves correctly say "no per-user quota," so the residual `checkQuota`-style naming is vestigial.

**Impact**: Same as PRF-UTP-010 — binding/audit drift, no logic defect. Confined to UTP-012.

**Required Action**: Reconcile UTP-012 symbols to canonical MOD-012/013 names (`enqueueGate → admitEnqueue`/`checkBackpressure`, `countDemand → recordDemand`, `validateBatch → enforceBatchCap`, `req.caller → req.user`, `isService → tokenClass`) and purge any residual `checkQuota`/quota wording.

---

### PRF-UTP-014 — Tombstone-TTL boundary is tested within/after but not _at_ the 30-day edge (Minor)

**Defect type**: Test quality — boundary value at the TTL edge missing
**Artifact**: `unit-test.md` UTP-001-D (within TTL → `404`/no enqueue; after TTL → re-attempt); `../spec.md` FR-025 (configurable TTL, default 30 days)

**Evidence**:

- UTP-001-D arranges a tombstone "within the 30-day TTL" and one "after the TTL has lapsed" — the two sides of the decision. There is no scenario at the exact boundary (age == TTL, e.g. exactly 30 days / TTL±epsilon) to pin whether the comparison is `>` or `>=`.
- The reconciled lifecycle treats the TTL as the load-bearing decision for whether a re-attempt bypasses the cache; an off-by-one at the edge changes whether a just-expired tombstone re-attempts or stays `404`.

**Impact**: Low — both branches are covered; only the exact-edge equality is unspecified, matching the boundary-value rigor the rolling-window (exactly 900 / exactly 1000) and demotion (exactly 50) cases already apply.

**Required Action**: Add a UTS-001-D scenario at age == TTL (and TTL−1s / TTL+1s) asserting the chosen boundary semantics, consistent with the configurable-TTL clarification.

---

### PRF-UTP-015 — UTP-005's atomic count-and-record is verified by an in-process mock, not a concurrent harness (Observation)

**Defect type**: Weak technique vs. claimed property (testability)
**Artifact**: `unit-test.md` UTP-005-A (CallLogStore mock "executes the atomic count-and-record in-process"); `../spec.md` FR-020, SC-002

**Evidence**:

- UTP-005-A correctly mocks the store to run the `INSERT … WHERE count < cap RETURNING` logic in-process — appropriate for a **unit** test of the limiter's decision logic.
- The _atomicity_ property (no double-record / no >1,000 under concurrent Fargate workers) is a race that a single-threaded in-process mock structurally cannot observe. This is by design deferred to the integration layer (ITP-005-A names a real-Postgres concurrent harness), so the unit suite is not the place to assert it — but the unit description should not be read as covering the race.

**Impact**: None at the unit level provided the integration layer owns the concurrency proof (it does, ITP-005-A). Flagged only so the atomicity claim is not double-credited to the unit suite.

**Required Action**: Advisory — keep UTP-005-A scoped to decision logic and ensure the FR-020/SC-002 atomicity assertion is traced to ITP-005-A (the concurrent harness), not to UTP-005-A.

---

**Verdict: PASS WITH MAJORS — Critical: 0, Major: 3 (PRF-UTP-009 contradictory `DEMAND_CAP`; PRF-UTP-010 MOD-005 symbol drift; PRF-UTP-011 `MAX_QUEUE_DEPTH=1000` vs REQ-040b 10,000).** All five changed mechanisms (rolling-window incl. boundaries, demotion + re-promotion, SWR-indefinite, tombstone-TTL, batch-partial) have unit coverage with no surviving token-bucket or quota/`429` cases; the Majors are consistency/contradiction defects to fix before the suite is authoritative.

_End of Peer Review — unit-test, 003-usda-food-data_

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

- **PRF-UTP-009** (`DEMAND_CAP = 50`) — **closed by D-DEMAND**: the only cap is the **per-`sub` `PRIORITY_CAP = 1`**; there is no per-`food_id` distinct-requester ceiling, so 60 distinct subs → demand 60. Replace UTS-012-G3 accordingly and add the FR-044 aging scenario.
- **PRF-UTP-011** (`MAX_QUEUE_DEPTH = 1000`) — anchor to **10,000** (configurable) per REQ-040b.
- **PRF-UTP-010 / PRF-UTP-012 / PRF-UTP-013 / PRF-UTP-014 / PRF-UTP-015** — carried (limiter `windowCount`/`HARD_CAP`/`PAUSE_THRESHOLD` symbol names; FR-020/021 traceability; UTP-012 canonical symbols + quota-word purge; tombstone-TTL boundary; atomicity-traced-to-integration).
- **Unit tests to add** (per §3.5/§3.4/§3.9/§3.10): **UTP-017** restated to the **auto-resolve survivor-count rule** (drop "confidently collapsible"); `food_candidates` `UNIQUE(food_id, source, external_key)` + `CandidateMismatchError`; the **`leased_at` reaper** reclaim query; lifecycle transitions (FAILED→PENDING, NOT_FOUND→PENDING, PATCH-on-RESOLVED idempotent no-op, `createByName` reactivation). `enqueueLowPriority` / `drain_priority_tier` / `checkQuota` cases are removed; the `food.status` enum replaces `fetch_status`.
