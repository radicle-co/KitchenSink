# Peer Review — unit-test (auth slice)

**Reviewer**: Independent V-Model Peer Reviewer
**Date**: 2026-06-19
**Artifact**: unit-test.md — **UTP-012** (MOD-012 ClerkAuthMiddleware + MOD-013 QuotaAndFairness) and **UTP-014** (MOD-014 AsyncProducerAuthz), all parented to ARCH-012
**Standard**: ISO/IEC/IEEE 29119-4 (test design techniques)
**Cross-checked against**: `module-design.md` MOD-012/MOD-013/MOD-014; `../spec.md` FR-035–FR-053, SC-011/SC-012; `../plan.md` §2A

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **4** |

Overall assessment: **PASS.** The auth slice now carries unit coverage for **all three** MODs under ARCH-012 — MOD-012 (UTP-012-A/B/C/D/I/J), MOD-013 (UTP-012-E/F/G/H), and the newly added MOD-014 (UTP-014-A through E). Mock registries and strict isolation are defined per case, boundary partners are explicit, and every deny/shed path asserts a fail-closed outcome (no `AuthenticatedCaller`, no fetch, no enqueue). The single prior **Major (PRF-UTP-004)** is resolved (see below). Residual findings are pre-existing consistency and coverage-bookkeeping items that this remediation did not target; none rises to Major.

**Prior Major resolved:**

- **PRF-UTP-004 (MOD-014 had no UTP; Coverage Summary stale at 13/13) — RESOLVED.** A new **UTP-014 (AsyncProducerAuthz)** module section exercises all four functions of MOD-014's least-privilege/provenance logic across five test cases and ten scenarios:
    - **UTP-014-A** — allowlisted IAM principal + authenticated-`sub` provenance → `admitAsyncEvent` admits with `requesterClass: 'user'` and emits the `async.producer.admitted` metric (happy-path traversal of both enforcement layers).
    - **UTP-014-B** — non-allowlisted delivering principal → `UnauthorizedProducerError` (fail closed) **before** provenance is evaluated; the forgeable-`Detail` bypass is excluded because the principal ARN is read from the AWS-attested context; the `fetch_queue` direct-insert leg (`assertEnqueueProvenance`) under a non-allowlisted DB role is also rejected (B2).
    - **UTP-014-C** — `requestedBy` of `null` / `''` / `'system'` / unrecognized → `ProvenanceError`, closing the unauthenticated async path; `'system'` is asserted as the named anonymous-origin boundary; nothing fetched/enqueued.
    - **UTP-014-D** — `svc_`-prefixed `requestedBy` → admitted as `requesterClass: 'service'` (proven via `isClerkSub` stubbed `false`, so the admit comes from the service-prefix branch alone); an unrecognized detail-type with otherwise-valid provenance is still dropped (D2).
    - **UTP-014-E** — empty/missing allowlist config at boot → `ProducerConfigError` (fails closed rather than treating an empty allowlist as allow-all).
    - The Coverage Summary is corrected to **Total MOD modules: 14**, **MODs with at least one UTP: 14 / 14 (100%)**, with UTP/UTS totals recomputed (45 → 50 UTP; 128 → 138 UTS) and the Technique Distribution table reconciled. ≥3 ISO-29119-4 techniques are applied across UTP-014 (Statement & Branch Coverage, Equivalence Partitioning, Boundary Value Analysis, Error Guessing, Strict Isolation).

---

## Findings

---

### PRF-UTP-005 — UTP-012 "Requirements Under Test" still enumerates only REQ-037..REQ-044; FR-052 / FR-049(b) are not listed despite the new cases (Minor)

**Defect type**: Traceability (requirement-set under-declared)
**Artifact**: `unit-test.md` UTP-012 header line ("Requirements Under Test: REQ-037 … REQ-044")

**Evidence**:

- UTP-012's "Requirements Under Test" line stops at REQ-044, but the slice contains UTP-012-I (FR-052 / SC-011) and UTP-012-J (FR-049b/FR-049d/FR-041). Those requirements are exercised by concrete scenarios but are not enumerated in the case's requirement set.
- (FR-048 is now correctly declared in the new UTP-014 header, so the FR-048 portion of the original finding is closed; only the UTP-012 FR-052/FR-049b declarations remain stale.)

**Impact**: The traceability matrix, reading the header line, would not credit UTP-012 with FR-052 / SC-011 / FR-049b, understating coverage and risking a false "uncovered requirement" flag for the very requirements the remediation added tests for.

**Required Action**: Extend the UTP-012 "Requirements Under Test" line (and the matrix rows) to include FR-052, SC-011 (UTP-012-I) and FR-049b, FR-049d, FR-041 (UTP-012-J).

---

### PRF-UTP-006 — Function and field names in UTP-012 diverge from the now-canonical MOD-012/MOD-013 symbols (Minor)

**Defect type**: Consistency (naming)
**Artifact**: `unit-test.md` UTP-012 (`middleware.verify`, `authorizeScope`, `req.caller`, `isService`, `checkQuota`, `validateBatch`, `countDemand`, `enqueueGate`); `module-design.md` MOD-012/MOD-013 (`use`, `requireScope`, `req.user`, `tokenClass`, `enforceQuota`, `enforceBatchCap`, `recordDemand`, `admitEnqueue`/`checkBackpressure`)

**Evidence**:

- The module design commits to one canonical symbol set (`use`, `requireScope`, `req.user` with `tokenClass`, `enforceQuota`, `enforceBatchCap`, `recordDemand`, `admitEnqueue`). The UTP-012 plan still invokes `middleware.verify`, `authorizeScope`, asserts `req.caller` with `isService`, and uses `checkQuota`/`validateBatch`/`countDemand`/`enqueueGate`.
- UTP-012-H's `enqueueGate` and UTP-012-J's `authorizeMessage` symbols have no matching name in MOD-013/MOD-012 (`admitEnqueue`/`checkBackpressure`; the mid-connection re-auth path lives in MOD-009 `enforceTokenExpiry`).
- (UTP-014 binds cleanly to the MOD-014 symbols — `admitAsyncEvent`, `assertProducerPrincipal`, `assertProvenance`, `assertEnqueueProvenance` — so the drift is confined to UTP-012.)

**Impact**: Not a logic defect, but UTP-012 entries reference symbols that do not exist under that name in the module design, so tests cannot bind 1:1 and the design↔test traceability audit shows divergence. The companion module-design finding (PRF-MOD-007) flags the same drift from the design side.

**Required Action**: Reconcile UTP-012 to the canonical MOD-012/MOD-013 names — `req.caller`→`req.user`, `isService`→`tokenClass`, `middleware.verify`→`use`, `checkQuota`→`enforceQuota`, `validateBatch`→`enforceBatchCap`, `countDemand`→`recordDemand`, `enqueueGate`→`admitEnqueue`/`checkBackpressure` — and point the WS mid-connection scenario at MOD-009's `enforceTokenExpiry`.

---

### PRF-UTP-007 — MOD-013 demand cap (`DEMAND_CAP = 50`) and `MAX_QUEUE_DEPTH = 1000` are introduced only in the tests, not anchored to the module design (Minor)

**Defect type**: Traceability / magic value
**Artifact**: `unit-test.md` UTS-012-G3 (`DEMAND_CAP = 50`), UTS-012-H1/H2 (`MAX_QUEUE_DEPTH = 1000`); `module-design.md` MOD-013 §1/§3 (`priorityCap: 1`, `MAX_QUEUE_DEPTH = M`, no demand cap)

**Evidence**:

- UTS-012-G3 asserts the demand contribution caps at 50 distinct subs using `DEMAND_CAP = 50`, a value absent from MOD-013 (which fixes only `priorityCap: 1`).
- UTS-012-H1/H2 hard-code `MAX_QUEUE_DEPTH = 1000`, but MOD-013 leaves it symbolic (`M`) and `requirements.md` REQ-040b fixes `10,000` — so the test value matches **neither** the design nor the requirement.

**Impact**: The cap-at-50 and queue-at-1000 boundaries are asserted against values invented in the test layer and inconsistent with REQ-040b's `10,000`. Low risk to correctness, but the boundary assertions are not traceable and already conflict with the requirement.

**Required Action**: Anchor `maxQueueDepth` (to REQ-040b's `10,000`, configurable) and a `demandCap` in MOD-013 §1/§3 first (companion finding PRF-MOD-005), then reference those design values from UTS-012-G3 / UTS-012-H (boundary at cap and cap±1).

---

### PRF-UTP-008 — UTP-012-C verifies headers are ignored but does not assert MOD-012's explicit header-strip step (Observation)

**Defect type**: Completeness of assertion
**Artifact**: `unit-test.md` UTP-012-C / UTS-012-C1; `module-design.md` MOD-012 §1 (`DELETE req.headers["x-authorizer-context"]` / `["x-user-id"]`)

**Evidence**:

- MOD-012 §1 explicitly deletes the `x-authorizer-context` and `x-user-id` headers before building the principal (defense-in-depth against the forged-header bypass that motivated PR #39).
- UTS-012-C1 asserts `req.caller.sub === 'user_real'` and that the headers "are never parsed into `req.caller`" — it asserts the outcome (identity from the verified token) but not that the headers were stripped. A downstream handler reading the raw header directly would still be exposed and this test would pass.

**Impact**: The test confirms the principal is correct but not the strip step from the design, leaving the forge-header bypass only partially asserted.

**Required Action**: Add an assertion to UTS-012-C1 that `req.headers['x-authorizer-context']` / `['x-user-id']` are absent (stripped) after `verify`, matching MOD-012 §1.

---

_End of Peer Review — unit-test (auth slice), 003-usda-food-data_
