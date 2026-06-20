# Peer Review — requirements

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: requirements.md — auth slice (REQ-IF-008, REQ-035, REQ-037a..d, REQ-038a..c, REQ-039, REQ-040a..b, REQ-041..043, REQ-044a..d)
**Standard**: INCOSE Guide for Writing Requirements

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 3     |
| Observation        | 3     |
| **Total Findings** | **6** |

Overall assessment: **PASS**. All four prior Majors are **RESOLVED**. The two load-bearing threshold gaps are closed with binding, INCOSE-conformant values: REQ-039 now states "**200 fetch enqueues per rolling hour** (= `floor(1,000 × 0.20)`)" and promotes the share bound to "**20% (an enforced ceiling, not a target)**"; REQ-040a states "**100 `fdcId`s per request (binding)**" and REQ-040b states "**10,000 entries**" plus the now-normative circuit breaker. The four compound requirements are decomposed into atomic, singly-verifiable rows (REQ-037a–d, REQ-038a–c, REQ-040a–b, REQ-044a–d), and the systemic "e.g."/"target"/"N" hedging has been removed from the SHALL clauses. Residual findings are traceability-hygiene Minors and Observations, none of which block the gate.

## Findings

---

### PRF-REQ-001

**Severity**: Observation (Resolved — prior Major: REQ-039 untestable quota threshold)
**Location**: REQ-039

**Description**: **RESOLVED.** The per-`sub` enqueue quota is now bound to a concrete normative value: "a per-`sub` enqueue quota of **200 fetch enqueues per rolling hour** (= `floor(1,000 × 0.20)`; per-user token/leaky bucket) applied **after** authentication and **before** `INSERT INTO fetch_queue`." The companion share bound is promoted from a soft "target" to "No single `sub` SHALL consume more than **20% (an enforced ceiling, not a target)** of the global **1,000 req/hr** USDA budget within any rolling hour." The unit (fetch enqueues), the window (rolling hour), the derivation (`floor(1,000 × 0.20)`), and the `429`/no-enqueue outcome are all stated. The requirement now agrees with `module-design.md` `QuotaConfig` (`quotaPerHour: 200`, `globalShareCap: 0.20`) and is testable against SC-012. The "N"/"target" symbols the prior review flagged are gone. No further action.

---

### PRF-REQ-002

**Severity**: Observation (Resolved — prior Major: REQ-040 undefined batch/queue thresholds)
**Location**: REQ-040a, REQ-040b

**Description**: **RESOLVED.** The compound REQ-040 is split, and both previously-undefined thresholds are now binding numbers:

- **REQ-040a** — batch cap is now "a hard maximum of **100 `fdcId`s per request (binding)**" (the illustrative "e.g. ≤ 100" is gone), with `400 Bad Request` and "SHALL enqueue nothing" on over-limit, and accepted IDs counting against REQ-039.
- **REQ-040b** — the queue-depth backpressure trigger is now an absolute count: "a maximum `fetch_queue` depth of **10,000 entries** (configurable) and SHALL fail closed with `503 Service Unavailable` when the queue depth reaches that ceiling **or** the USDA circuit breaker is open." The prior ambiguous "and/or" is resolved into two explicit, separately-testable `503` conditions, and the circuit breaker is stated as normative ("the enforced circuit breaker is normative, not an operational footnote") with jittered-drain recovery.

A verifier can now determine each boundary (100, 10,000) and the `400`/`503` semantics. No further action.

---

### PRF-REQ-003

**Severity**: Observation (Resolved — prior Major: compound / non-atomic requirements)
**Location**: REQ-037a–d, REQ-038a–c, REQ-040a–b, REQ-044a–d

**Description**: **RESOLVED.** All four compound requirements are decomposed into atomic rows, each carrying one obligation and one verification method:

- **REQ-037 → 037a** (Bearer + networkless `verifyToken`/`CLERK_JWT_KEY`), **037b** (`azp` ∈ `CLERK_AUTHORIZED_PARTIES`), **037c** (identity-from-token-only → `AuthenticatedCaller`), **037d** (fail-closed `401` enumeration).
- **REQ-038 → 038a** (authenticated-read authZ), **038b** (elevated-scope `403`), **038c** (the `401 → 403 → 400 → 404/202/200` precedence rule split out as its own row, FR-051).
- **REQ-040 → 040a** (batch-cap `400`), **040b** (queue-backpressure / circuit-breaker `503`).
- **REQ-044 → 044a** (verification-concurrency + `401`-rate load-shed), **044b** (SC-011 latency under invalid-token flood), **044c** (non-secret config, Verification = Inspection), **044d** (named-component + FR-035–FR-052 traceability, Verification = Inspection).

Traceability-to-test is now one-to-one per ID. Note the prior PRF-REQ-009 method concern is also addressed: REQ-044c/044d correctly carry Verification = **Inspection** rather than Test. No further action.

---

### PRF-REQ-004

**Severity**: Observation (Resolved — prior Major: systemic hedging in SHALL clauses)
**Location**: REQ-038*, REQ-039, REQ-040*, REQ-044\*

**Description**: **RESOLVED.** The editorial pass reached the requirement rows: every load-bearing "e.g."/"target"/"N"/"configured X" placeholder in a SHALL clause is now a binding value — `200` (REQ-039), `20%` enforced ceiling (REQ-039), `100` binding (REQ-040a), `10,000` (REQ-040b). Genuinely illustrative enumerations remain acceptable and are correctly scoped: REQ-038b's "(e.g. manual re-fetch, stale-refresh triggers)" is an example of an endpoint class, not a threshold. The slice no longer asserts hedged thresholds. No further action.

---

### PRF-REQ-005

**Severity**: Minor (Incomplete — traceability)
**Location**: Auth slice vs spec.md FR-050

**Description**: FR-050 (authorizer fail-closed hardening — HTTP API in-process middleware on every route with no result cache to poison; deferred WebSocket `$connect` authorizer cache TTL=0, keyed solely on the verified token, attached to every route AND method, no default-open response) is still not cited by any auth requirement. REQ-035 captures "no API Gateway / Lambda authorizer in the HTTP request path" and REQ-043 specifies the `$connect` auth contract, but neither records the FR-050 "runs on every route, no fail-open cache" form (HTTP) nor the "cache TTL=0 / no default-open" binding (WebSocket), and no REQ row carries the FR-050 citation. A V-model V&V chain keyed on FR coverage would still show FR-050 untraced. (Unchanged from prior review — not in the remediation scope.)

**Recommendation**: Extend REQ-043 to capture the WebSocket `$connect` authorizer cache-binding / no-default-open rule (the surviving form of FR-050), note in REQ-035/REQ-037a that the in-process middleware runs on every route with no fail-open authorizer cache, and add FR-050 to the relevant traceability citation.

---

### PRF-REQ-006

**Severity**: Minor (Inconsistent — traceability)
**Location**: REQ-036 numbering gap (REQ-035 → REQ-037a)

**Description**: The functional requirement IDs still jump from REQ-035 to REQ-037a with no REQ-036 and no annotation anywhere in requirements.md — no "REQ-036 (reserved)" / "intentionally omitted" marker or mapping note. The networkless-verification clause that FR-036 covers is folded into REQ-037a (cited as "FR-035/FR-036"), so the obligation is not lost, but the unexplained ID discontinuity still reads as a dropped requirement to downstream V&V. (Unchanged from prior review — not in the remediation scope.)

**Recommendation**: Add an explicit note where the gap occurs ("REQ-036 intentionally not used; FR-036 is covered within REQ-037a") or renumber to close the gap.

---

### PRF-REQ-007

**Severity**: Minor (Incomplete — traceability)
**Location**: REQ-039, REQ-040a

**Description**: The `AuthenticatedCaller` linkage across the quota/batch requirements is improved but still uneven. REQ-039 now names "derived from the `AuthenticatedCaller` `sub`" inline (an improvement over the prior parenthetical), and REQ-040a references "the per-`sub` quota (REQ-039)" — but REQ-040a still reaches the principal only indirectly via the REQ-039 cross-reference and never names `AuthenticatedCaller` itself. Since the slice's value is binding every accepted fetch to a verified principal, REQ-040a should make the entity link explicit rather than transitive. (Partially addressed; REQ-039 leg resolved, REQ-040a leg remains.)

**Recommendation**: Add an explicit `AuthenticatedCaller` reference to REQ-040a (the `sub` whose quota the accepted batch IDs consume) so the entity → requirement link is direct, not transitive through REQ-039.

---

### PRF-REQ-008

**Severity**: Observation (Resolved — prior Critical: deployment contradiction)
**Location**: REQ-035, REQ-037a, REQ-IF-007, REQ-IF-008, REQ-043; vs spec.md A-005/A-011/AuthenticatedCaller

**Description**: **RESOLVED and stable.** The HTTP auth requirements remain converged on the locked in-process model: REQ-035 reads "enforced in-process by the Commise NestJS `AuthMiddleware` … there is no API Gateway / Lambda authorizer in the HTTP request path," deferring mechanics to REQ-037a/REQ-IF-008; the single remaining Lambda-authorizer reference (REQ-043, WebSocket `$connect`) matches plan §2A.5 and spec.md A-005 ("the `$connect` Lambda authorizer is the only authorizer-Lambda in the design"). No mutually-exclusive deployment contradiction remains on the US-0 boundary. The decomposition in this pass did not regress it. No further action.

---

### PRF-REQ-009

**Severity**: Observation
**Location**: REQ-IF-008, REQ-035, REQ-037a..REQ-044d — Priority and Verification columns

**Description**: Positive note: every atomic auth row carries an explicit Priority (P1), a Verification Method, and FR citations. The prior verification-method concern (REQ-044's traceability obligation marked Test) is now resolved — REQ-044c and REQ-044d carry **Inspection**, matching their verify-a-design-artifact nature. Metadata completeness across the decomposed slice is sound. The residual defects are confined to traceability hygiene (PRF-REQ-005/006/007); the threshold-specificity, atomicity, and hedging Majors that dominated the prior pass are all cleared.
