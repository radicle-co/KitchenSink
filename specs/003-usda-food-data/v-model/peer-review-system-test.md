# Peer Review — system-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-20
**Artifact**: system-test.md — full register (SYS-001..SYS-013), reviewed against the reconciled + clarified spec (Session 2026-06-20: rolling-window limiter, demotion fairness, SWR-indefinite, tombstone-TTL)
**Standard**: ISO 29119

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **6** |

This is a fresh pass replacing the stale 2026-06-19 review (which still scored against a token-bucket / per-`sub` quota / `429` design and reported 35 STP / 59 STS). The artifact itself has been reconciled to the locked design and is largely aligned: SYS-006 is the **RollingWindowLimiter** (STP-006-A atomic check-and-record against `usda_call_log`, STP-006-B 90%/900 pause boundary, ≤1,000 cap), STP-013-C enforces fairness **by demotion with no `429`** and dynamic re-promotion, STS-001-B6 covers **serve-stale-indefinitely**, STP-005-D2 covers the **30-day tombstone TTL** re-attempt, and STP-013 (A–F, incl. STP-013-B invalid-token-flood) is intact with the WS `$connect` authorizer scoped correctly. Totals are now 36 STP / 63 STS, internally consistent.

The two Major findings are **completeness/consistency gaps against the new model**, not technique defects: (1) the rolling-window limiter has no system test for the **state-loss / empty-call-log bounded-burst** failure mode that the spec's own edge-case list calls out, and (2) the **Redis cache (SYS-008) is presented as a first-class live component** and woven into SYS-001's primary read/dedup scenarios, contradicting the lean-launch default (Postgres-only, `ON CONFLICT` dedup) where Redis is an explicitly deferred variant.

## Findings

---

### PRF-STP-001 — No system test for rolling-window limiter state-loss / empty-`usda_call_log` bounded burst

**Severity**: Major
**Defect type**: Completeness — uncovered changed mechanism (rolling-window failure mode)

**Artifact**: system-test.md (SYS-006 / STP-006-A, B, C)

**Evidence**:

- The locked design tracks limiter state as recent USDA-call timestamps in `usda_call_log` (lean) and the spec **Edge Cases** (spec.md line 261) explicitly enumerate the failure: "When the rolling-window limiter state is lost (Redis restart or PostgreSQL call-log truncation) … the call log is empty, so the trailing-60-min count starts at 0 and up to 1,000 API calls could fire before the window refills … can briefly exceed the true rolling-hour count right after the loss before converging to steady-state."
- STP-006 covers the atomic check-and-record (A), the cap/aging boundary at 900/1,000 (B), and store-**unavailability** (C1: store unreachable → no USDA call, row left incomplete). None of these covers the distinct **state-loss-then-available** mode where the store is reachable but empty (truncated/restarted) and the count restarts at 0.
- This is the rolling-window analogue of the limiter-state-loss hazard the hazard register must also carry (see peer-review-hazard-analysis PRF-HAZ-001); the system layer is where the bounded-burst convergence behavior would actually be exercised.

**Impact**: The single most spec-called-out rolling-window degradation has no executable scenario, so an implementation could converge incorrectly (e.g. over-count protection lost, or a permanent over-emit) and pass the suite. SC-002 ("never >1,000 in any trailing 60 min") is the headline guarantee; the moment its backing state is lost is exactly when it is most at risk.

**Required action**: Add an STP-006 scenario: given `usda_call_log` is truncated/emptied while reachable, when the consumer resumes check-and-record, then at most 1,000 calls fire before fresh timestamps refill the window and steady-state ≤1,000 reconverges (assert the bound and the convergence, matching the spec's "bounded" claim). Cross-reference the new limiter-state-loss hazard.

---

### PRF-STP-002 — Redis cache (SYS-008) is tested as a live first-class component and embedded in SYS-001 primary scenarios, contradicting the lean-launch Postgres-only default

**Severity**: Major
**Defect type**: Consistency / alignment with spec (deferred variant presented as live design)

**Artifact**: system-test.md (SYS-008 STP-008-A/B/C/D; SYS-001 STS-001-A2, B2, B3; SYS-005 STS-005-B1 step 4)

**Evidence**:

- Spec FR-001/FR-013/FR-030 and A-002 make Redis a **deferred post-launch variant**: lean-launch dedup is `INSERT … ON CONFLICT` on `fetch_queue`, reads are Postgres (optionally in-process LRU), and FR-030 (Redis key/TTL) is flagged "_(deferred post-launch variant)_ … Not part of the lean-launch build."
- The artifact, however, gives Redis a full component register (STP-008-A "Cache Hit — Hot Food Data Served from Redis", STP-008-B "24-Hour Expiry", STP-008-C "Pending-Set Deduplication — SISMEMBER / SADD", STP-008-D "Redis Unavailable") with **no deferred-variant caveat**, and threads it into the _primary_ read/dedup path: STS-001-A2 ("Redis cache contains `food:12345` … no PostgreSQL query"), STS-001-B2/B3 dedup keyed on the `pending_fetch` **Redis set**, and STS-005-B1 step 4 makes "invalidate the cache for `food:12345` and clear the `pending_fetch` marker in SYS-008" a **required** success-path side effect.
- Contrast with SYS-006, which the artifact handles correctly — every Redis mention is tagged "deferred variant" alongside the `usda_call_log` lean default. SYS-008 did not receive the same treatment.

**Impact**: The default lean-launch build has no Redis, so STP-008-A/B/C and the Redis-dependent SYS-001 dedup scenarios are untestable as written and the `ON CONFLICT` dedup that _is_ the launch mechanism (FR-013/FR-014) has no SYS-001-level coverage equivalent to STS-001-B3. An implementer reading this suite would build the deferred architecture, not the lean launch. The overview line 42 ("serves all responses exclusively from PostgreSQL/Redis") compounds the ambiguity.

**Required action**: Mark SYS-008 and STP-008-A/B/C/D as deferred-variant (mirroring the SYS-006 treatment), and make the lean-launch Postgres path primary in SYS-001: rewrite STS-001-B2/B3 dedup to assert the `fetch_queue` `ON CONFLICT` no-duplicate-row behavior (FR-014) as the default, with the Redis `pending_fetch` set as the deferred alternative. Soften STS-005-B1 step 4 to "cache invalidation (deferred variant only)."

---

### PRF-STP-003 — SYS-002 is still titled "EventBridgeBus" as the demand-path enqueue router, contradicting FR-011 (direct `fetch_queue` INSERT + `pg_notify`)

**Severity**: Minor
**Defect type**: Consistency / stale component framing

**Artifact**: system-test.md (SYS-002 component header; STP-002-A, B, C; Traceability Summary)

**Evidence**:

- Spec FR-011 and the `FoodDataEvent` entity are explicit: the demand-path enqueue is a direct `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify('fetch_queued')`; **EventBridge is reserved for scheduled producers (FR-032) and the `FoodDataReceived` completion event (FR-034) only — it is not on the demand-path enqueue.**
- SYS-002 is named "EventBridgeBus" and its cases are titled "Enqueue Routing — FoodRequested to High-Priority fetch*queue Row" / "FoodBatchRequested to Low-Priority fetch_queue Rows", framing EventBridge as the enqueue router. The scenario \_bodies* are actually correct (STS-002-A1: "executes `INSERT INTO fetch_queue … VALUES (12345, 'high', …)` and issues a `NOTIFY fetch_queue`"), so this is a component-label/title mismatch, not a wrong test.

**Impact**: A reader could infer EventBridge is on the demand-path hot path (the exact thing FR-011 forbids). Traceability of REQ-011/REQ-012 points at a component whose name no longer matches its role.

**Required action**: Rename SYS-002 to reflect the demand-path enqueue (e.g. "FetchQueueEnqueue (`INSERT … ON CONFLICT` + `pg_notify`)") and retitle STP-002-A/B to drop "EventBridge" routing language; keep the scenario bodies. Reserve any genuine EventBridge component for the scheduled-producer / `FoodDataReceived` path.

---

### PRF-STP-004 — STS-013-A4 (missing/malformed `CLERK_JWT_KEY`) is a config fault-injection case carried inside the Equivalence-Partitioning invalid-credential set

**Severity**: Minor
**Defect type**: Technique / partition misclassification (carried from prior pass — still present)

**Artifact**: system-test.md (STP-013-A technique line; STS-013-A4)

**Evidence**:

- STP-013-A is "Equivalence Partitioning" over invalid-_credential_ classes (missing/expired/`nbf`/malformed/wrong-`azp`/wrong-instance). STS-013-A4 injects a **server-side config fault** ("`CLERK_JWT_KEY` is missing or malformed … verifier cannot initialize") and asserts fail-closed `401` — that is Fault Injection of the environment (the FR-040 fail-closed property), not an equivalence class of the credential.

**Impact**: Minor — the assertion is correct and high-value; only the EP partition table is impure and the FR-040 config-fault case isn't grouped with the other fault-injection coverage.

**Required action**: Retag STS-013-A4 as a Fault-Injection sub-case cross-referencing FR-040, or note in the STP-013-A description that it deliberately mixes one environment fault into the credential-EP set.

---

### PRF-STP-005 — STS-013-C1/C2 (demotion fairness) lack an explicit reset/seed precondition for the shared `fetch_queue` pending-count and rolling-window state

**Severity**: Minor
**Defect type**: Scenario independence (shared, time-sensitive state)

**Artifact**: system-test.md (STP-013-C, STS-013-C1; STS-013-C2)

**Evidence**:

- STS-013-C1 drives `sub` `A` above 50 pending and asserts demotion-to-back (correctly, no `429`). STS-013-C2 then reasons about `A` "scripting continuously … against the global 1,000 req/hr budget" with re-promotion once `A` drops below 50.
- Both depend on the same live `fetch_requesters` pending-count and the same SYS-006 rolling window, but neither states a fresh-window / cleared-pending-count seed. C1's build-up of `A`'s pending set is exactly the precondition that would contaminate a re-run of C2 in sequence.
- (This finding is the demotion-model analogue of the prior pass's PRF-STP-003; the underlying flakiness risk survived the quota→demotion rewrite because pending-count and window state are still shared and time-sensitive.)

**Impact**: The two scenarios are not order-independent; without a deterministic clock/window fixture and a "given a fresh window with `A`/`B` pending counts seeded to known values" Given, they risk flaky passes by execution order.

**Required action**: Add an explicit reset/seed Given to each (fresh rolling-hour window; `A` and `B` pending counts seeded deterministically), or pin a clock/window fixture so C1 and C2 are order-independent.

---

### PRF-STP-006 — STS-013-D1/D2 actor framing ("an authenticated user … calls", "a server-initiated caller … calls") edges toward journey language in the system layer

**Severity**: Observation
**Defect type**: Style / journey-language risk (carried unchanged)

**Artifact**: system-test.md (STS-013-D1; STS-013-D2)

**Evidence**:

- The slice is overwhelmingly black-box ("SYS-013 rejects…", "no `fetch_queue` row is inserted"), but D1/D2's actor framing is the seam where user-journey phrasing usually creeps into system tests. They stay anchored to a concrete request/response, so this is borderline-acceptable.

**Impact**: None functionally; raised only to keep the system layer interface-behavioural (actor-journey framing belongs in ATP-008).

**Required action**: No change required. If tightening, restate as "a request bearing a token whose `public_metadata` lacks scope X" / "a request bearing a valid M2M token."

---

## Disposition

2 Major / 0 Critical → does **not** pass the baseline gate. The Majors are both alignment-to-new-model gaps (limiter state-loss coverage; Redis-as-live vs lean-launch Postgres default) rather than auth-slice regressions — the auth, rolling-window, demotion, SWR, and tombstone-TTL mechanisms are otherwise correctly tested. Fix PRF-STP-001 and PRF-STP-002 to clear the gate; the three Minors and one Observation are advisory.

---

## Remediation Status (2026-06-20, round 4)

All **Critical and Major** findings in this review were **remediated in the same session**. The artifacts now reflect the canonical model — Postgres demand-weighted `fetch_queue` (single queue, no high/low tier), rolling-60-min window limiter (`usda_call_log`), dynamic queue **demotion** wired on every enqueue path (incl. single-food), distinct-requester demand via `fetch_requesters` (FR-044), `status` enum `pending | in_flight | tombstone`, single 30s lease, rolling-window state-loss hazard (HAZ-041), and in-process NestJS auth. Reconciled across spec/plan/tasks + the full v-model. This record documents the findings **as reviewed**; the gate (`.forge-status.yml → peer_review_gate`) reflects the post-remediation state. An independent re-review is the optional final confirmation.
