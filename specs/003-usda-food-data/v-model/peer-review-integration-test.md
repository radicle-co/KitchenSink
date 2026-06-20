# Peer Review — integration-test

**Reviewer**: Independent V-Model Peer Reviewer
**Date**: 2026-06-20
**Artifact**: integration-test.md — refreshed against the reconciled + clarified design (2026-06-20): rolling-window seam (ARCH-005/MOD-005), fairness-by-demotion seam (ARCH-012/MOD-013), stale-while-revalidate + tombstone-TTL seams (ARCH-001↔ARCH-006/ARCH-002), per-item batch partial, and the intact auth slice (ITP-012-\*).
**Standard**: ISO/IEC/IEEE 29119-4
**Cross-checked against**: `module-design.md` MOD-005, MOD-013, MOD-014, MOD-001/004; `../spec.md` FR-019/020/025/026/031/043/045/046, SC-002/SC-012; `requirements.md` REQ-039/040a/040b/042.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 1     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **5** |

Overall assessment: **PASS WITH MAJORS.** The prior (2026-06-19) review is superseded. Every changed mechanism now has a module-boundary seam case:

- **Rolling-window seam (MOD-005):** ITP-004-A verifies ARCH-004 always calls `checkAndRecord()` before ARCH-008 and that the result gates the USDA call (admit below 900; pause at 900 records nothing). ITP-005-A is a **real-Postgres concurrent** count-and-record harness asserting the cap holds under contention — `999 + 2 concurrent → exactly one admit`, and `1,500 concurrent on empty → exactly 1,000 admit / 500 block` (the 1,001st blocked; cap never breached). ITP-005-B fails closed on store unavailability. **No token-bucket seam survives.**
- **USDA 429 → back off:** ITP-008-B classifies `429` → ARCH-004 applies backoff without completing the row (FR-016/FR-026), not a window reset.
- **Demotion + re-promotion seam (MOD-013):** ITP-012-C seeds `fetch_queue` + `fetch_requesters` so one `sub` has **>50 pending**, then asserts `202` (**no `429`**), `enqueue` still invoked, rows ranked to the **back**, a concurrent low-pending `sub` drains ahead, and **dynamic re-promotion** when the heavy `sub` drops below 50. **No quota / `429` / `user_fetch_quota` seam survives.**
- **SWR-indefinite seam:** ITP-001-D serves stale `200` + enqueues re-fetch, and on repeated failure **serves indefinitely** (re-enqueue subject to `ON CONFLICT` dedup).
- **Tombstone-TTL seam:** ITP-001-E covers within-TTL `404`/zero-enqueue and after-TTL re-attempt against the rolling-window budget.
- **Batch-partial seam:** ITP-012-G covers `101 → 400`/zero-enqueue and the **at-100 boundary** → per-item partial (cached inline + per-miss `pending`, `enqueue` once per miss).
- **Auth slice intact:** ITP-012-A/B/F (401/403/precedence), ITP-012-D (`503`), ITP-012-E/H (async-provenance / CDC pacts), and the WS `$connect`-authorizer seam are preserved.

No changed requirement has zero or contradictory seam coverage → **no Critical**. The single Major is a design↔test symbol-binding defect (MOD-005 return field) that spans every rolling-window seam; the Minors are carried-over traceability-precision items the refresh did not clear.

---

## Findings

---

### PRF-ITP-007 — Rolling-window seams assert a `trailingCount` field that the design's `WindowCheckResult` names `windowCount` (Major)

**Defect type**: Consistency (naming) — seam contracts cannot bind 1:1 to MOD-005
**Artifact**: integration-test.md ITP-004-A (lines 196/201), ITP-005-A (line 242), ITP-011-B (line 467) — all assert `{ allowed, …, trailingCount }`; `module-design.md` MOD-005 §Internal Data Structures (`WindowCheckResult = { allowed: boolean, windowCount: number }`, line 579)

**Evidence**:

- The MOD-005 seam contract returned across the ARCH-005↔ARCH-004 boundary is `WindowCheckResult { allowed, windowCount }`. Every rolling-window integration scenario stubs/asserts the field as `trailingCount` (e.g. ITP-005-A "receives `{ allowed: true, trailingCount: 1000 }`"; ITP-011-B emits `incrementMetric('usda_calls_trailing_60min', 750)` off a `trailingCount: 750` result).
- Because integration tests verify the _seam contract_, the field name on the wire is load-bearing here (more so than in the unit suite): the ARCH-005→ARCH-004 and ARCH-004→ARCH-011 handshakes assert a return shape the design does not define.
- The _values and the seam logic_ are correct — only the contract field name diverges. Companion to the unit-side PRF-UTP-010.

**Impact**: The rolling-window seam — the SC-002 mechanism — is contracted on a field (`trailingCount`) absent from MOD-005's `WindowCheckResult`. A provider/consumer contract or generated stub built from the design would not expose `trailingCount`, so these seam assertions cannot bind without a rename on one side.

**Required Action**: Reconcile the seam contract to one name. Either rename the ITP assertions `trailingCount → windowCount` (matching MOD-005 §579), or rename the field in MOD-005 and propagate to ARCH-011's metric key. The CloudWatch metric name (`usda_calls_trailing_60min`) may stay; only the result-field reference must match the design.

---

### PRF-ITP-008 — ITP-012-D and ITP-012-G still carry the coarse `REQ-040` tag after the split into REQ-040a (batch `400`) / REQ-040b (queue `503`) (Minor)

**Defect type**: Traceability precision (carried over, still open)
**Artifact**: integration-test.md ITP-012-D (line 539, "wired through ARCH-012 (REQ-040)"), ITP-012-G (line 592, "REQ-040, FR-045"), header line 488 ("REQ-040"); `requirements.md` REQ-040a / REQ-040b

**Evidence**:

- `requirements.md` splits REQ-040 into **REQ-040a** (batch → 100-id cap, over-limit `400`, enqueue nothing — FR-045) and **REQ-040b** (max `fetch_queue` depth 10,000, fail closed `503`, breaker drain with jitter — FR-046).
- ITP-012-D (the `503` backpressure case) verifies **REQ-040b** but still tags bare `REQ-040`; ITP-012-G (the batch-`400` case) verifies **REQ-040a** but tags `REQ-040`. The FR-level conflation is already fixed (D→FR-046, G→FR-045); only the REQ-level tag stays coarse, and the same `REQ-040` now labels two cases verifying opposite gates.
- This is the prior PRF-ITP-004, unresolved in the refresh.

**Impact**: Low — a matrix consumer counting `REQ-040` cannot tell which half (batch `400` vs queue `503`) each case covers; both read as undifferentiated `REQ-040`.

**Required Action**: Retag ITP-012-D → **REQ-040b / FR-046** and ITP-012-G → **REQ-040a / FR-045**, and split the `REQ-040` token in the ARCH-012 header line into `REQ-040a, REQ-040b`.

---

### PRF-ITP-009 — ITP-012 "Modules Under Test" omits MOD-014, though ITP-012-E/H exercise its async-producer provenance behaviour (Minor)

**Defect type**: Traceability (module-to-test mapping incomplete; carried over)
**Artifact**: integration-test.md ARCH-012 header line 487 ("Modules Under Test: MOD-012 (ClerkAuthMiddleware), MOD-013 (DemotionAndFairness)"); `module-design.md` MOD-014 (AsyncProducerAuthz)

**Evidence**:

- The reconciled design decomposes ARCH-012 into three MODs, with **MOD-014 (AsyncProducerAuthz)** owning the async-producer provenance / least-privilege logic that ITP-012-E (event provenance accept/reject, REQ-042/FR-048) and ITP-012-H (consumer-published event pact, tombstone the unmarked event) actually verify against ARCH-004.
- The "Modules Under Test" line still lists only MOD-012 and MOD-013, so the cases verifying MOD-014's behaviour are not mapped back to MOD-014. This is the prior PRF-ITP-005, unresolved.

**Impact**: Low — the behaviour is integration-tested, but the design↔test module map omits MOD-014, so an auditor reconciling "every MOD has integration coverage" would not see ITP-012-E/-H credited to MOD-014.

**Required Action**: Add MOD-014 to the ITP-012 "Modules Under Test" header and tag ITP-012-E / ITP-012-H to MOD-014.

---

### PRF-ITP-010 — ITP-012-C demotion seam lacks an explicit _exactly-50_ (non-demoted) boundary scenario (Minor)

**Defect type**: Test quality — boundary value at the demotion threshold missing at the seam
**Artifact**: integration-test.md ITP-012-C (seeds one `sub` "more than 50 items pending" → demoted; later "drops below 50" → re-promote); `module-design.md` MOD-013 `DEMOTE_THRESHOLD = 50` (`> 50` demotes); `../spec.md` FR-043

**Evidence**:

- The locked rule is `pendingCount > 50` demotes; `== 50` does **not** demote (the unit suite pins this in UTS-012-E1, "at exactly 50 pending the `sub` is **not** demoted"). ITP-012-C seeds ">50" (demoted) and "<50" (re-promoted) but never the **exactly-50** edge at the seam, so the `>` vs `>=` comparison is verified only at the unit layer, not at the ARCH-012↔ARCH-003 enqueue/ordering seam.
- The boundary matters at the seam because demotion is computed at drain time from live `fetch_queue` + `fetch_requesters` state; an off-by-one in the scorer's threshold query would mis-rank a `sub` sitting exactly at 50.

**Impact**: Low — both demoted and re-promoted sides are covered; only the exact-threshold equality is unverified at the integration boundary, where the live-state count query is the thing under test.

**Required Action**: Add an ITS to ITP-012-C seeding a `sub` at **exactly 50 pending** and asserting it enqueues at **normal** (front-tier) priority — confirming the seam's threshold query is `> 50`, not `>= 50`, consistent with UTS-012-E1.

---

### PRF-ITP-011 — ITP-012-C claims "demotion fairness under concurrency" but the pending state is pre-seeded; the real-concurrency proof lives in ITP-005-A, not here (Observation)

**Defect type**: Weak technique vs. claimed property (testability)
**Artifact**: integration-test.md ITP-012-C (pre-seeded `fetch_queue` + `fetch_requesters` so one `sub` has >50 pending; concurrent `user_other`); Test-Harness row 658

**Evidence**:

- ITP-012-C verifies demotion _ordering_ (heavy `sub` to the back, `user_other` drains ahead, dynamic re-promotion) against **pre-seeded** pending state with a spy on `enqueue` and drain-time ordering. This is the right shape for a _fairness-ordering_ seam test — the demotion decision is observable from the priority key the scorer assigns.
- It does not, and need not, exercise a _race_ (two subs mutating the shared pending count under contention). The genuine concurrency/atomicity proof for the shared budget is correctly located in **ITP-005-A** (real-Postgres, N parallel clients on the rolling window). So the demotion-at-drain-time property is testable as described (the priority key is deterministic from seeded live state), and the atomic count race is testable where it belongs.

**Impact**: None, provided ITP-012-C is read as a fairness-_ordering_ test and the atomicity property is traced to ITP-005-A (it is). Flagged only so the SC-012 fairness claim is not over-credited to a pre-seeded sequential harness.

**Required Action**: Advisory — keep ITP-012-C scoped to demotion ordering / dynamic re-promotion; ensure any SC-012 atomicity claim references the real-concurrent ITP-005-A harness, not ITP-012-C.

---

**Verdict: PASS WITH MAJORS — Critical: 0, Major: 1 (PRF-ITP-007 MOD-005 seam contract names `trailingCount`, design says `windowCount`).** All five changed mechanisms (rolling-window incl. concurrent cap proof, demotion + re-promotion, SWR-indefinite, tombstone-TTL, batch-partial) have module-boundary seam coverage with no surviving token-bucket or quota/`429` seam; the residual Minors are carried-over traceability-precision items (REQ-040 split, MOD-014 mapping, exactly-50 boundary).

_End of Peer Review — integration-test, 003-usda-food-data_

---

## Remediation Status (2026-06-20, round 4)

All **Critical and Major** findings in this review were **remediated in the same session**. The artifacts now reflect the canonical model — Postgres demand-weighted `fetch_queue` (single queue, no high/low tier), rolling-60-min window limiter (`usda_call_log`), dynamic queue **demotion** wired on every enqueue path (incl. single-food), distinct-requester demand via `fetch_requesters` (FR-044), `status` enum `pending | in_flight | tombstone`, single 30s lease, rolling-window state-loss hazard (HAZ-041), and in-process NestJS auth. Reconciled across spec/plan/tasks + the full v-model. This record documents the findings **as reviewed**; the gate (`.forge-status.yml → peer_review_gate`) reflects the post-remediation state. An independent re-review is the optional final confirmation.
