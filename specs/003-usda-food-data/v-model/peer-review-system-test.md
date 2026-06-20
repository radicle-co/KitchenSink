# Peer Review — system-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: system-test.md — auth slice STP-013 (SYS-013 AuthnAuthzLayer)
**Standard**: ISO 29119

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 2     |
| Observation        | 1     |
| **Total Findings** | **3** |

SYS-013 now has 6 STP cases (STP-013-A..F) with 16 STS scenarios, so the "≥1 STP per component" bar remains met and the technique mix is correct for each case. The Traceability Summary covers 13/13 components and its totals are updated to **35 STP / 59 STS** consistent with the SYS-013 row (`STP-013-A, B, C, D, E, F` → 16 STS). SC-010 (A), SC-011 (B), SC-012 (C) are each addressed by a named technique with no "as a user" epic/journey narrative leaking in. **Both Major findings from the prior pass are resolved**: STP-013-B (SC-011 load-shed) is now specified to a measurable, reproducible standard (concrete concurrency bound, flood rate, mix, window, sample size, and a conjunctive pass metric), and the former STP-013-D no longer overloads one Equivalence-Partitioning label — it is split into EP (scope-`403`/M2M), a new **State Transition** case for the FR-051 precedence ordering, and a **Boundary Value Analysis** case for the batch cap. The remaining findings are two Minors and one Observation carried unchanged from the prior pass (out of scope for this fix); none gate the artifact.

## Findings

---

### PRF-STP-001 — STP-013-B (SC-011 load-shed) now specifies measurable, reproducible test parameters — RESOLVED

**Severity**: Resolved (was Major)
**Defect type**: Non-measurable validation criterion — **addressed**

**Artifact**: system-test.md (STP-013-B / STS-013-B1)

**Evidence**:

- STS-013-B1 now states concrete parameters: verifier concurrency bound under test `C = 50`, per-source `401`-rate cap `200`/min/source, an invalid-token flood of **2,000 req/s** (= `40×C`, an explicit multiple of the bound) from a bounded **8** source identities, a **120 s** window (first 10 s discarded as warm-up), a valid-traffic baseline of **100 req/s** at a stated **1:20** valid:invalid mix, and **≥ 11,000** valid-request latency samples for the p95.
- The pass metric is now conjunctive and falsifiable: **valid-token p95 ≤ 10ms** AND **in-flight signature checks ≤ `C` (50)** with bounded (non-monotonically-growing) queue depth AND **≥ 95%** of invalid requests load-shed. Non-saturation is given a concrete metric (in-flight count and queue depth) rather than left qualitative.
- Auth-attributable latency is now defined as the verify-start → verify-complete span (request receipt to authn decision), isolated from downstream SYS-001/SYS-007 handling.

**Resolution**: The scenario is now reproducible — re-running with the same `C`, cap, rates, mix, window, and sample size yields the same verdict. SC-011's adversarial clause (FR-052, closing RT F-015) is discharged by a falsifiable test; the "5-token-per-second flood" loophole from the prior pass is closed.

---

### PRF-STP-002 — Former STP-013-D split by correct ISO 29119 technique (EP / State Transition / BVA) — RESOLVED

**Severity**: Resolved (was Major)
**Defect type**: Mismatched / overloaded test technique — **addressed**

**Artifact**: system-test.md (STP-013-D, STP-013-E, STP-013-F)

**Evidence**:

- **STP-013-D (Equivalence Partitioning)** now covers only the two cleanly-partitioned authorization/principal outcome classes: authenticated-but-unauthorized session token → `403` (STS-013-D1, FR-039) and valid Clerk M2M service principal → accepted (STS-013-D2, FR-047). EP is the correct technique for these representative-class distinctions, and the description explicitly notes ordering/bound concerns are split out.
- **STP-013-E (State Transition)** is a new case for the FR-051 precedence chain `401` → `403` → `400`/`404` → business logic, exercising **each adjacent ordering pair as a discrete transition**: STS-013-E1 (`401` precedes `403`), STS-013-E2 (`403` precedes `400`), STS-013-E3 (`400` precedes business/`404`). This addresses the prior gap where `401`-before-`403` and `400`-before-`404` were asserted only in prose; each is now its own scenario with two simultaneous competing defects.
- **STP-013-F (Boundary Value Analysis)** is a new case for the batch hard limit of 100 with the missing boundary cases: just-under **99** (accepted, STS-013-F1), at-limit **100** (accepted/inclusive, STS-013-F2), just-over **101** (`400`, STS-013-F3), FR-045.
- The "ISO 29119 Test Techniques" header now lists **State Transition**, and the SYS-013 intro paragraph and Traceability Summary totals (35 STP / 59 STS) are updated consistently.

**Resolution**: Each named technique now actually generates its test's classes/cases — the ordering property is under State Transition, the numeric limit under BVA, and the residual scope/M2M class distinctions under EP. STP-013 / STS-013 ID structure is preserved (re-lettered, no collisions).

---

### PRF-STP-003 — STS-013-C1 and STS-013-C2 share quota/window state without an isolation/reset precondition

**Severity**: Minor
**Defect type**: Scenario independence (shared state)

**Artifact**: system-test.md (STP-013-C, STS-013-C1; STS-013-C2)

**Evidence**:

- STS-013-C1 drives `sub` `A` to its per-hour quota and asserts `429`. STS-013-C2 then reasons about `A`'s accepted enqueues "over the rolling-hour window" against the global 1,000 req/hr budget with `A` already scripting continuously.
- Both operate on the same per-`sub` quota counter and the same global rolling-hour budget, but neither states a reset/seed precondition (fresh window, cleared counters) isolating it from the other or from prior runs. STS-013-C1's exhaustion of `A` is exactly the precondition that would contaminate a re-run of C2 (or vice-versa) if executed in sequence against shared infrastructure.

**Impact**: Rolling-window/quota tests are notoriously order- and time-sensitive. Without an explicit "given a fresh rolling-hour window with counters reset for A and B" precondition, the two scenarios are not independently runnable, risking flaky/false passes depending on execution order and wall-clock alignment.

**Required action**: Add an explicit reset/seed Given to each of STS-013-C1 and -C2 (fresh window, zeroed per-`sub` and global counters), or state a deterministic clock/window fixture so the two scenarios are order-independent.

---

### PRF-STP-004 — STS-013-A4 ("missing/malformed `CLERK_JWT_KEY`") is a configuration-error case carried inside the Equivalence-Partitioning invalid-credential set

**Severity**: Minor
**Defect type**: Technique/partition misclassification

**Artifact**: system-test.md (STP-013-A technique line; STS-013-A4)

**Evidence**:

- STP-013-A is "Equivalence Partitioning" over _invalid-credential_ classes (missing token, expired, nbf, malformed, wrong-`azp`, wrong-instance — and parenthetically tags the last as "fail-closed config error", a partial acknowledgement of the mix).
- STS-013-A4 injects a **server-side config fault** ("`CLERK_JWT_KEY` is missing or malformed … verifier cannot initialize") and asserts fail-closed `401` even for an otherwise-valid token. That is **Fault Injection** of the environment, not an equivalence class of the _credential_ — it belongs with the fail-closed-on-error property (FR-040), not in the credential-partition set.

**Impact**: Minor — the assertion is correct and valuable (it is arguably the most important fail-closed case). The misclassification means the EP partition table is impure and the config-fault case isn't grouped with the other fault-injection coverage, weakening traceability of FR-040.

**Required action**: Either retag STS-013-A4 under a Fault-Injection sub-case (cross-referencing FR-040) or note explicitly in the STP-013-A description that it mixes credential-EP with one environment fault-injection scenario by design.

---

### PRF-STP-005 — STS-013-D1/D2 use light "an authenticated user … calls" / "a server-initiated caller … calls" phrasing; confirm it stays behavioural, not journey-narrative

**Severity**: Observation
**Defect type**: Style / journey-language risk

**Artifact**: system-test.md (STS-013-D1; STS-013-D2)

**Evidence**:

- The slice is overwhelmingly black-box/behavioural ("SYS-013 rejects…", "no event reaches SYS-002"). No "As a user, I want…" epic language leaks in — good.
- STS-013-D1 ("an authenticated user … calls an operational/administrative endpoint") and STS-013-D2 ("a server-initiated caller … calls `GET /v1/foods/{fdcId}`") edge toward actor-journey phrasing. They remain anchored to a concrete request/response, so this is borderline-acceptable, but the actor framing is the seam where journey language usually creeps into system tests.

**Impact**: None functionally; raised only to keep the system-test layer free of user-journey framing (that framing belongs in the acceptance plan / ATP-008, which is its correct home here).

**Required action**: No change required. If tightening, restate D1/D2 as "a request bearing a token whose `public_metadata` lacks scope X" / "a request bearing a valid M2M token" to keep the layer purely interface-behavioural.
