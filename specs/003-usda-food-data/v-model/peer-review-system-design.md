# Peer Review — system-design

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: system-design.md (13 system components) — auth slice (SYS-013 AuthnAuthzLayer) and the HTTP read entry point (SYS-001 FoodApiController)
**Standard**: IEEE 1016
**Scope**: SYS-001 + SYS-013 — 4-view coverage (Decomposition / Dependency / Interface / Data Flow), upward traceability to REQ-IF-008 + REQ-037a..044d, interface error-response completeness (400/401/403/429/503), Physical-view runtime placement, and consistency with `../spec.md` and `../plan.md` §2A.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 2     |
| Observation        | 1     |
| **Total Findings** | **3** |

Overall assessment: **PASS**. Both prior Majors are **RESOLVED**. SYS-013 now appears in the Data Flow view: a dedicated **Path 0: Auth Edge** (§5.4, lines 127–143) models verify → `401`/`403` fail-closed → pre-enqueue quota/backpressure → `429`/`503`, and the prose explicitly states "Every entry point flows through SYS-013 before SYS-001 business logic … Paths 1–4 below begin only after this gate is passed," so the auth/admission layer is now visible in the request-execution view and SYS-013 has full 4-view coverage. The machine-readable Interface Contracts Table gains **IC-008** (`SYS-013→SYS-001 ValidateBatch → Accepted (≤ 100 IDs) | 400`) and **IC-009** (`SYS-013→SYS-010 AuthorizeConnect → Allow | 403`), closing the prior batch-cap-`400` and WebSocket-`403` contract gaps; error-response coverage (400/401/403/429/503) is now complete in the table. The prior Critical deployment contradiction remains resolved and was not regressed. Residual findings are interface-precision Minors and a decomposition-granularity Observation — none blocks the gate.

## Findings

---

### PRF-SYS-001 — SYS-013 Data Flow coverage

**Severity**: Observation (Resolved — prior Major: SYS-013 absent from the Data Flow view)
**Defect type**: Completeness / View coverage
**Location**: system-design.md Data Flow View §5.4, Path 0 (lines 127–143)

**Description**: **RESOLVED.** SYS-013 is now present in the Data Flow view. The new **Path 0: Auth Edge** models the full fronting sequence — `ALB → ECS/Fargate → AuthMiddleware/FoodAuthGuard (SYS-013) → verifyToken(CLERK_JWT_KEY, azp)` with the fail-closed branches `401` (missing/invalid/expired/`azp` mismatch), `403` (scope absent), then the post-auth `pre-enqueue quota/fairness gate` emitting `429` (quota) and `503` (queue depth | circuit open) before the SYS-002 publish / `fetch_queue` insert — and pins the status precedence `401 → 403 → 400 → 404/202/200`. The explicit guard sentence ("Paths 1–4 below begin only after this gate is passed") binds the auth edge ahead of the request-execution paths, so the prior gap (no auth/quota step shown before `EventBridge Publish`) is closed. The 4-view-coverage criterion is met for SYS-013.

Minor structural note (not a defect): Paths 1–3 bodies still begin at `FoodApiController (SYS-001)` without re-stating the SYS-013 hop inline; coverage is satisfied by the Path 0 preamble and its explicit gating statement. Inlining a one-line "(after Path 0)" marker at the head of Paths 1–3 would make the composition self-evident without cross-reading, but is optional.

---

### PRF-SYS-002 — Interface Contracts Table error-response coverage

**Severity**: Observation (Resolved — prior Major: IC table omits 400 and WS 403)
**Defect type**: Completeness / Interface error-response coverage
**Location**: system-design.md Interface Contracts Table (IC-008, IC-009 — lines 122–123)

**Description**: **RESOLVED.** The two missing machine-readable contracts are added:

- **IC-008** `SYS-013 → SYS-001 ValidateBatch {sub, fdcIds: number[]} (POST /v1/foods/batch) → Accepted (≤ 100 IDs) | 400 (batch cap exceeded — no enqueue)` covers the REQ-040a/FR-045 batch-cap rejection.
- **IC-009** `SYS-013 → SYS-010 AuthorizeConnect ($connect token via query param / Sec-WebSocket-Protocol subprotocol) → Allow { $context.authorizer.sub } | 403 (pinned $connect rejection)` covers the REQ-043/FR-049 WebSocket `$connect` rejection.

Combined with IC-006 (`401|403`) and IC-007 (`429|503`), the table now expresses the full 400/401/403/429/503 error surface, so SYS-013's enforce-`400` and WS-`403` behaviours are verifiable from the contracts table that downstream module/interface design consumes. No further action.

---

### PRF-SYS-003 — IC-006 response schema does not distinguish user `sub` from M2M/service identity

**Severity**: Minor
**Defect type**: Interface precision
**Location**: system-design.md IC-006 (line 120) and External Interfaces "Clerk session/M2M token" (line 92)

**Description**: SYS-013's decomposition and the external-interface table both acknowledge the M2M token class (REQ-041/FR-047, A-012), where `AuthenticatedCaller` carries a service identity rather than a human `sub`. IC-006's response schema is still just `AuthenticatedCaller | 401 | 403` with no field-level shape, so the user-vs-service principal distinction (and which fields are populated for an M2M caller) is not expressed at the contract boundary the module design implements against. (Unchanged from prior review — not in the remediation scope.)

**Recommendation**: Expand IC-006's response schema to enumerate `AuthenticatedCaller { sub, azp, scopes, tokenClass: 'user' | 'm2m' }` (or equivalent), so the M2M classification required by REQ-041 is contract-visible.

---

### PRF-SYS-004 — SYS-013 → SYS-002 "Gates" omits the FR-048 async-producer provenance check from the dependency/interface contract

**Severity**: Minor
**Defect type**: Traceability precision
**Location**: system-design.md Dependency View `SYS-013 → SYS-002` (line 57), Internal Interfaces `SYS-013 → SYS-002` (line 109), IC-007 (line 121)

**Description**: REQ-042/FR-048 (async-producer authorization: only named IAM principals may publish to EventBridge / insert `fetch_queue`, and the consumer validates event provenance) is listed as a SYS-013 parent and named in the rationale, and the dependency cell now appends "async producers must present an authorized principal" (line 57). However, the consumer-side provenance validation (which involves SYS-005) is still not represented as a dependency or interface contract — IC-007 covers only the synchronous per-`sub` quota/backpressure gate. REQ-042's consumer-validation leg therefore still traces to SYS-013 by prose only. (Partially addressed; producer-side mention added, consumer-side validation still uncontracted.)

**Recommendation**: Add a `SYS-013 → SYS-005` provenance-validation relationship (or an interface note) capturing that accepted events carry an authenticated `requestedBy` principal and the consumer validates it, so REQ-042's consumer leg is anchored in a view and not only the rationale.

---

### PRF-SYS-005 — SYS-013 collapses three distinct concerns (authn, quota/fairness, DoS load-shed) into one component

**Severity**: Observation
**Defect type**: Decomposition granularity
**Location**: system-design.md SYS-013 Decomposition row (line 34) and Traceability Rationale (line 311)

**Description**: SYS-013 carries nine parent requirements spanning cryptographic token verification (REQ-037), authorization scopes (REQ-038), per-`sub` enqueue quota / fairness (REQ-039/040), M2M classification (REQ-041), async provenance (REQ-042), WebSocket auth (REQ-043), and auth-layer DoS load-shed (REQ-044). These are cohesive as "the auth/admission edge" but operate at different layers (the quota/backpressure gate is admission control that runs after authn and is arguably closer to SYS-002). This is acceptable at system-design granularity. (Unchanged from prior review.)

**Recommendation**: No change required at the system-design level. Confirm at module design that the verify/authn concern is split from the quota/fairness/backpressure admission-control concern so REQ-039/040/044 get independent module-level coverage. (Note: `module-design.md` already separates `QuotaConfig`/quota enforcement from the verifier, so this is on track.)
