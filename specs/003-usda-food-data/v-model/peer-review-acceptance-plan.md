# Peer Review — acceptance-plan

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-20
**Artifact**: acceptance-plan.md — full plan, reviewed against the reconciled + clarified spec (Session 2026-06-20: rolling-window limiter, demotion fairness, SWR-indefinite, tombstone-TTL)
**Standard**: ISO 29119

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **4** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

This is a fresh pass replacing the stale 2026-06-19 review (which still scored ATP-008-F against a per-`sub` enqueue quota with a `429` boundary and the ≤20%-of-budget share ceiling — all of which the locked design has **removed**). The artifact itself is reconciled to the new model and is in good shape:

- **Rolling window** — AT-019-A / AT-NF012-A assert "no rolling-60-min window ever exceeds 1,000 USDA calls (SC-002)", consumer pauses at 900 (90%), zero `429`. Correct, and matches the not-token-bucket model.
- **Demotion fairness** — ATP-008-F / ATS-041-F1 now assert ">50 pending → **accepted (`202`)**, items demoted to the back, **no `429`**, no rejection", a concurrent user still served, and **dynamic re-promotion below 50**. This is exactly SC-012 / FR-043; the previous Minor (PRF-ATP-001 quota-boundary not measurable) is **obsolete** — there is no quota boundary to measure.
- **SWR** — ATS-031-B1 (serve held data `200` + background re-fetch) and ATS-031-B2 (**serve stale indefinitely** on persistent re-fetch failure, no max-staleness cutoff) cover the lifecycle.
- **Tombstone TTL** — ATS-025-A1 (within TTL → `404` no enqueue) and ATS-025-A2 (after **30-day** TTL → `202` re-attempt, counts against the rolling-window budget) cover both sides.
- **Auth** — ATP-008-A..I map AS-1..AS-12; networkless verify discharged via egress-deny harness (ATS-037-B2); `$connect` pinned `403`; M2M accepted; oversized batch (>100) → `400`.

No Critical or Major remains. The findings are a deferred-variant-as-live wording issue, a coverage gap for the limiter state-loss bound at acceptance level, a stale technique label, and the surviving `$connect` status-wording reconciliation.

## Findings

---

### PRF-ATP-001 — Redis cache treated as a primary data source in ATS-001-A2 and AT-NF011-A, contradicting the lean-launch Postgres-only default

**Severity**: Minor
**Defect type**: Consistency / alignment with spec (deferred variant presented as live)

**Artifact**: acceptance-plan.md (AT-001-A / ATS-001-A2; AT-NF011-A / ATS-NF011-A1)

**Evidence**:

- Spec A-002 / FR-001 / FR-030 make Redis a deferred post-launch variant; the lean launch reads from Postgres (optionally an in-process LRU) with no Redis.
- ATS-001-A2 asserts "a food record exists **in the Redis cache** … served from cache; no USDA API call" as a standalone acceptance scenario, and AT-NF011-A's Given reads "the local store (**or Redis cache**)" for the 50ms p95 probe.
- Unlike the spec (which tags every Redis mention "deferred"), these scenarios present cache serving as an equal launch path without the caveat.

**Impact**: Low — the assertions are harmless if Redis is absent (they simply don't apply), but a client signing off the gate could read cache-hit serving as an in-scope launch requirement. The default lean build cannot run ATS-001-A2 as written.

**Required action**: Tag ATS-001-A2 (and the "or Redis cache" clause in AT-NF011-A) as deferred-variant-only, or fold cache serving into the Postgres scenario as an optional path, so the lean-launch exit gate is unambiguous.

---

### PRF-ATP-002 — No acceptance scenario for rolling-window SC-002 compliance across a limiter state-loss event (empty `usda_call_log` bounded burst)

**Severity**: Minor
**Defect type**: Completeness — uncovered degradation of the changed (rolling-window) mechanism

**Artifact**: acceptance-plan.md (AT-NF012-A / ATS-NF012-A1; REQ-NF-012)

**Evidence**:

- ATS-NF012-A1 verifies SC-002 ("no rolling-60-min window exceeds 1,000 USDA calls; zero `429`") under a **sustained steady-state stream** only.
- The spec's own Edge Cases (spec.md line 261) call out the worst case for this guarantee — limiter state loss (call-log truncation / Redis restart) producing a bounded burst of up to 1,000 calls before the window refills. No acceptance scenario exercises SC-002 across such an event, even as a "remains bounded after recovery" assertion.

**Impact**: The headline rate-limit guarantee is accepted only on the happy path. This is primarily a system/unit concern (see peer-review-system-test PRF-STP-001), so it is Minor here, but the acceptance gate currently signs off SC-002 without touching its most fragile moment.

**Required action**: Either add an acceptance scenario asserting that after a limiter-store reset under load the trailing-60-min count remains bounded (≤1,000 reconverges, no sustained breach), or explicitly note that state-loss bounding is discharged at the system-test layer and out of scope for the acceptance gate.

---

### PRF-ATP-003 — AT-008-A search test tagged "Equivalence Partitioning" though its scenarios are an exact-match vs no-match contract pair

**Severity**: Minor
**Defect type**: Technique label precision

**Artifact**: acceptance-plan.md (AT-008-A / ATS-008-A1, A2)

**Evidence**:

- AT-008-A is labelled Equivalence Partitioning but its two scenarios are a results-returned (match) case and an empty-array (no-match) case — a contract pair, closer to Interface Contract Testing (which AT-009-A already uses for the no-USDA-call property). The fuzzy/typo partition that would justify EP (e.g. "avacado" → "avocado", spec US-6 AS-2) is not present at acceptance level.

**Impact**: None functionally; the technique name overstates the partitioning. The fuzzy-match behavior that distinguishes search (FR-008 `pg_trgm`) is only asserted in the system layer, not at acceptance.

**Required action**: Either retag AT-008-A as Interface Contract Testing, or add a fuzzy/typo scenario (misspelled query still matches) so the EP label is earned.

---

### PRF-ATP-004 — AS-7 acceptance pins `$connect` to `403` while spec AS-7 says `401`/`403`; record the FR-049(d) rationale inline

**Severity**: Observation
**Defect type**: Spec/plan wording reconciliation (carried unchanged)

**Artifact**: acceptance-plan.md (ATP-008-E / ATS-040-E1)

**Evidence**:

- ATS-040-E1 asserts the unauthenticated `$connect` "is rejected with `403`". Spec AS-7 (spec.md line 72) says "rejected (`401`/`403`)". The plan correctly narrows to the single pinned status mandated by FR-049(d)/FR-050 (API-Gateway-WebSocket authorizers return a pinned `403`), but does not cite FR-049/FR-050, so a reviewer reconciling against AS-7 could read `401` as also acceptable.

**Impact**: None functionally — `403` is the correct pinned status. Raised only so the deliberate narrowing is traceable and not later relaxed.

**Required action**: Add an inline reference to FR-049(d) at ATS-040-E1 noting the pinned-`403` `$connect` status is intentional.

---

## CI Gate

0 Critical / 0 Major → **PASS** (exit code 0). The plan correctly reflects the locked rolling-window + demotion + SWR-indefinite + tombstone-TTL design; remaining findings are Minor/Observation refinements.

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

- **PRF-ATP-001** (Redis cache treated as a primary source) — resolved by **D-CLEANUP**: the canonical serve path is the **local-store read (RESOLVED)**; ATS-001-A2 and the AT-NF011-A "or Redis cache" clause are **deferred-variant-only**. Rename the `food-cache-hit-rate` metric to the local-store-serve/resolution metric.
- **PRF-ATP-002 / PRF-ATP-003 / PRF-ATP-004** — carried unchanged (limiter state-loss coverage; technique label; pinned-`403` `$connect` rationale); the register does not alter them.
- **Acceptance tests to add** (per §4): **AT-MRG5-A/B/C** (auto-resolve 1 → RESOLVED / >1 → UNRESOLVED + candidate set persisted / 0 → NOT_FOUND); **AT-RES1-x** (`food_candidates` `UNIQUE(food_id, source, external_key)` + `PATCH`-resolve rejects a non-member → `CandidateMismatchError`); **AT-025a-A/B** (UNRESOLVED candidate-set TTL re-fan-out; human pick before expiry wins); **AT-LC-A..E** (FAILED→PENDING, NOT_FOUND→PENDING post-TTL, PATCH-on-RESOLVED idempotent no-op, refresh-does-not-clobber-manual-pick, `createByName` reactivation); **AT-018-A** (`leased_at` reaper orphan `in_flight` → `pending`); **AT-043a-A / AT-044b-A** (multi-requester demotion; near-ceiling flood-shed `503`); plus the **SC-014** first-time NEW-food resolution-rate criterion split from the SC-005 serve-throughput target.
