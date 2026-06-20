# Peer Review — integration-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: integration-test.md — auth slice ITP-012 (ARCH-012 FoodAuthGuard; MOD-012 ClerkAuthMiddleware, MOD-013 QuotaAndFairness, MOD-014 AsyncProducerAuthz)
**Standard**: ISO 29119-4

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 2     |
| Observation        | 1     |
| **Total Findings** | **3** |

Overall assessment: **PASS.** ARCH-012 now has 8 ITP cases (ITP-012-A..H), each with ≥1 ITS and a Test-Harness row, exercising the synchronous edge (`401`/`403`/`400`/`429`/`503`), the async-producer provenance edge, and the server-to-server seams.

**Both prior Majors are RESOLVED:**

- **PRF-ITP-002 (no consumer-driven contract for the M2M / async-producer seams) — RESOLVED.** New **ITP-012-H** is tagged **Consumer-Driven Contract Testing** and verifies both seams via consumer-published pacts (not provider-authored stubs): ITS-012-H1 — downstream service 006 (meal-planning) publishes an M2M-token pact (`GET /v1/foods/{fdcId}` with a Clerk M2M Bearer whose `azp ∈ CLERK_AUTHORIZED_PARTIES`; expects `200`/`401`) and ARCH-012 is verified against it; ITS-012-H2 — the internal recipe-import producer publishes an event pact (`FoodRequested` carrying a `requestedBy` provenance marker) and ARCH-004 is verified to accept the marked event and DLQ the unmarked one. The Overview's named CDCT technique is now exercised by a concrete case, and the harness row references a Pact/contract-broker replay rather than a provider self-stub.
- **PRF-ITP-003 (ITP-012-D mislabel — traced REQ-040 but verified FR-046) — RESOLVED.** The FR-045/FR-046 conflation is removed: ITP-012-D now states "**This scenario verifies FR-046**" (queue backpressure ceiling + circuit breaker → `503`) and explicitly defers the batch-`400` to ITP-012-G; the new **ITP-012-G** owns the FR-045 oversized-batch `400` seam (101 ids → `400`, zero enqueue, no quota debit, with the at-`100` boundary admitted), each cross-referencing the other as a distinct gate. The two requirements are no longer conflated, and the previously-missing batch-`400` integration seam now has its own case.

The prior PRF-ITP-001 (scope-`403` / `401→403→400` precedence) remains closed via ITP-012-F. Residual findings are precision-level traceability items plus the in-memory-concurrency caveat carried over from before; none blocks the slice.

---

## Findings

---

### PRF-ITP-004 — ITP-012-D and ITP-012-G both carry the bare `REQ-040` tag, now ambiguous since REQ-040 split into REQ-040a (batch `400`) and REQ-040b (queue `503`) (Minor)

**Defect type**: Traceability precision (coarse requirement tag)
**Artifact**: integration-test.md ITP-012-D (line 502, "wired through ARCH-012 (REQ-040)"), ITP-012-G (line 555, "(REQ-040, FR-045)"); `requirements.md` REQ-040a / REQ-040b

**Evidence**:

- `requirements.md` splits REQ-040 into **REQ-040a** (batch lookups → hard 100-`fdcId` cap, over-limit `400`, enqueue nothing — FR-045) and **REQ-040b** (max `fetch_queue` depth 10,000, fail closed `503`, breaker drain with jitter — FR-046).
- ITP-012-D (the `503` backpressure case) tags `REQ-040`, but the precise requirement it verifies is **REQ-040b**. ITP-012-G (the batch-`400` case) tags `REQ-040, FR-045`, but the precise requirement is **REQ-040a**.
- The FR-level conflation that the prior PRF-ITP-003 flagged is fixed (D→FR-046, G→FR-045); only the REQ-level tag remains coarse, and the same bare `REQ-040` now appears on two cases verifying opposite gates.

**Impact**: Low — a matrix consumer counting REQ-040 as "integration-covered" cannot tell which half (batch `400` vs queue `503`) each case verifies; both currently read as covering an undifferentiated REQ-040.

**Required Action**: Retag ITP-012-D to **REQ-040b / FR-046** and ITP-012-G to **REQ-040a / FR-045** so each case traces to the precise sub-requirement.

---

### PRF-ITP-005 — The async-producer seam is now a first-class module (MOD-014) but the ITP-012 "Modules Under Test" header and matrix do not name it (Minor)

**Defect type**: Traceability (module-to-test mapping incomplete)
**Artifact**: integration-test.md ARCH-012 header ("Modules Under Test: MOD-012 (ClerkAuthMiddleware), MOD-013 (QuotaAndFairness)"); `module-design.md` MOD-014 (AsyncProducerAuthz)

**Evidence**:

- `module-design.md` now decomposes ARCH-012 into three MODs, adding **MOD-014 (AsyncProducerAuthz)** as the owner of the async-producer provenance / least-privilege logic that ITP-012-E and ITP-012-H actually exercise (against ARCH-004).
- The ITP-012 "Modules Under Test" line still lists only MOD-012 and MOD-013, so the case that verifies MOD-014's behaviour (provenance-marker accept/reject) is not mapped back to MOD-014 in the integration plan, even though the scenarios cover it.

**Impact**: Low — the behaviour is integration-tested, but the design↔test module map omits MOD-014, so an auditor reconciling "every MOD has integration coverage" would not see ITP-012-E/-H credited to MOD-014.

**Required Action**: Add MOD-014 to the ITP-012 "Modules Under Test" header and tag ITP-012-E / ITP-012-H (the async-provenance scenarios) to MOD-014 so the async leg traces from the module to its integration cases.

---

### PRF-ITP-006 — ITP-012-C claims "Concurrency & Race Condition Testing" but the harness is an in-memory, pre-seeded sequential store (Observation)

**Defect type**: Weak technique vs. claimed property
**Artifact**: integration-test.md ITP-012-C (line 489, technique tag; line 491 description); Test-Harness row (line 619)

**Evidence**:

- ITP-012-C is tagged "Interface Contract Testing **+ Concurrency & Race Condition Testing**" and claims one account "cannot starve the shared USDA budget for others" with a concurrent `user_other`.
- The harness row backs it with an "In-memory quota store pre-seeded to exhausted; spy on `enqueue`" explicitly "without real Redis". An in-memory, pre-seeded store with a sequential spy cannot exercise the interleaving the Concurrency technique names (two `sub`s decrementing a shared global-share ceiling under contention). Unchanged by the remediation.

**Impact**: The fairness/quota race — the property SC-012 cares about — is asserted by a test that structurally cannot observe a race; it verifies the arithmetic of the ceiling, not its atomicity. (The atomic dual-counter commit is the same anti-pattern flagged elsewhere across the slice: invariants verified by an in-process mock rather than a concurrent harness.)

**Required Action**: Either drop the "Concurrency & Race Condition Testing" claim from ITP-012-C (leaving an honest contract test) or add a real concurrent harness (real/embedded Redis, N parallel clients against one rolling window) for the fairness/atomicity assertion — mirroring the real-Redis posture already used in ITP-005-A / ITP-007-B.

---

_End of Peer Review — integration-test (auth slice), 003-usda-food-data_
