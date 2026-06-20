# Peer Review — hazard-analysis.md

**Reviewer**: AI Peer Review (spec-kit V-Model — independent IEEE 1028 inspection)
**Date**: 2026-06-19
**Artifact**: hazard-analysis.md (40 hazard entries, 13 system components; focus: SYS-013 AuthnAuthzLayer — HAZ-036..HAZ-040)
**Cross-checked against**: `../spec.md` (FR-035–FR-053, SC-010/011/012, A-011/A-012), `../../plan.md` §2A, `system-design.md` (SYS-013), `architecture-design.md` (ARCH-012), `unit-test.md` (UTS-012-H4)
**Standard**: IEC 60812 / ISO 14971 FMEA profile (consumer SaaS, non-regulated; `domain: ''`)

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 2     |
| Observation        | 3     |
| **Total Findings** | **5** |

**Overall assessment**: PASS. All four findings that previously blocked baseline are now **RESOLVED**. The prior Critical (PRF-HAZ-001) was already closed in the last pass and remains closed — HAZ-037 carries **Severity = Critical** with the Effect column explicitly justifying the rating as a sustained core-flow outage equal to the anonymous-path HAZ-036, risk recomputed (Critical × Occasional = Undesirable). The three previously-Major missing hazards have all been **added** to the SYS-013 register as distinct rows: **HAZ-038** (quota-store fail-open vs fail-closed), **HAZ-039** (user-session vs M2M token-class confusion), and **HAZ-040** (WebSocket `$connect` authorizer-cache fall-open). Each has its own failure mode, operational state, severity/likelihood, decided mitigation posture, and control bindings. The Coverage Summary, the SYS-013 narrative, and the register totals are all updated to `HAZ-001..HAZ-040` consistently. Remaining findings are Minor/Observation refinements that do not block baseline.

---

## Findings

### PRF-HAZ-001 — RESOLVED — HAZ-037 severity re-rated to Critical with risk recomputed

- **Severity**: Observation (resolution record — no action)
- **Defect type**: Incorrect risk classification (previously Critical finding) — confirmed closed
- **Location**: hazard-analysis.md, SYS-013 register, HAZ-037 (line 169)
- **Description**: HAZ-037 carries **Severity = Critical**, Likelihood = Occasional, Risk Level = Undesirable. The Effect column states "Exhausting the hard 1,000 req/hr budget (A-001/SC-002) is a **sustained outage of the core fetch flow for ALL users** — by the severity scale here that is Critical (sustained core-flow outage), equivalent to the anonymous-path HAZ-036." This matches the document's own Severity Scale ("Critical = … sustained core-flow outage (≥1 hour)") and removes the prior internal inconsistency where the insider path was Serious while the equivalent-effect anonymous path (HAZ-036) and token-bucket overshoot (HAZ-016) were Critical. The matrix cell (Critical × Occasional = Undesirable) is correctly applied. No further action.

### PRF-HAZ-002 — RESOLVED — HAZ-038 added for quota-store unavailability (fail-open vs fail-closed) with a decided fail-closed posture

- **Severity**: Observation (resolution record — no action)
- **Defect type**: Missing failure mode (operational-state coverage gap) — **confirmed added**
- **Location**: hazard-analysis.md, SYS-013 register, HAZ-038 (line 170); Operational States referenced via the `quota-store-down` state; SYS-013 narrative (line 164); Coverage Summary (line 193)
- **Description**: The gap is closed. HAZ-038 now hazards "Quota-store unavailability — the per-`sub` enqueue quota (FR-043) reads mutable state from Redis `quota:{sub}` / Postgres `user_fetch_quota`; that store goes down or times out, forcing a fail-open vs fail-closed decision," with Operational State `quota-store-down`, Severity = Critical, Likelihood = Occasional, Risk = Undesirable. Crucially the mitigation **decides the posture** rather than leaving it open: "**Fail-closed**: an unavailable/erroring quota store rejects the enqueue with `503` and never falls open to unlimited enqueue or debits the quota — consistent with FR-040's fail-closed principle and FR-046's enforced-breakpoint `503` family," and it binds to a concrete verification (UTS-012-H4 mocks the quota store throwing `ConnectionRefusedError` and asserts `503` with `FetchQueue.enqueue` called zero times and no quota debit). Controls REQ-039/REQ-040, ARCH-012, MOD-013 are cited. The previously-undecided posture and the missing operational state are both resolved. No further action.

### PRF-HAZ-003 — RESOLVED — HAZ-039 added for token-class confusion between user-session and M2M tokens

- **Severity**: Observation (resolution record — no action)
- **Defect type**: Missing failure mode (completeness) — **confirmed added**
- **Location**: hazard-analysis.md, SYS-013 register, HAZ-039 (line 171); SYS-013 narrative (line 164)
- **Description**: The gap is closed. HAZ-039 hazards "Token-class confusion (user vs M2M) — A-012/FR-047 introduce two token classes (user session, machine M2M) verified by the **same** networkless path and `azp` allowlist, so a token valid for one class can be accepted on a surface intended for the other," Severity = Critical, Likelihood = Remote, Risk = Undesirable. The Effect correctly isolates this from HAZ-036 (bypass) and HAZ-037 (abuse): "the caller authenticates successfully yet crosses the user↔service classification, defeating the per-endpoint trust model even though no token is forged." The mitigation requires per-endpoint **token-class classification** (FR-047) enforced after verification — the `AuthenticatedCaller` carries the class/`azp` so the wrong class on a surface is rejected (`401`/`403`) — plus FR-039/FR-051 scope precedence, bound to REQ-038/REQ-041, ARCH-012, MOD-012. This is exactly the `azp`-class assertion the prior pass found absent. No further action.

### PRF-HAZ-004 — RESOLVED — HAZ-040 added for the WebSocket `$connect` authorizer-cache fall-open

- **Severity**: Observation (resolution record — no action)
- **Defect type**: Missing failure mode (operational-state / misconfig coverage) — **confirmed added**
- **Location**: hazard-analysis.md, SYS-013 register, HAZ-040 (line 172); SYS-013 narrative (line 164)
- **Description**: The gap is closed. HAZ-040 now stands as its own failure mode — not merely an FR-050 citation inside HAZ-036's mitigation: "WebSocket `$connect` authorizer cache fall-open — the deferred WS `$connect` Lambda authorizer (FR-050) is the **one** surface with an API Gateway authorizer result cache, which can replay a once-valid policy after the token has expired or been revoked," Severity = Critical, Likelihood = Remote, Risk = Undesirable. The Effect correctly scopes the replay window to `$connect`/`$default` and explains why the HTTP edge (in-process `AuthMiddleware`, no cache) is exempt. Mitigation cites FR-050 (TTL = 0 or token-keyed cache, attached to every WS route AND method, denied → `401`/`403` never default-open) plus FR-049 mid-connection re-auth, bound to REQ-043/REQ-IF-008, ARCH-012, MOD-012. The fourth originally-flagged member (the async-producer `'system'` bypass) remains reconciled at source in the plan, so HAZ-036's FR-048 citation stays consistent. No further action.

### PRF-HAZ-005 — HAZ-036 and HAZ-037 each still conflate multiple separately-mitigated failure modes into one row (granularity)

- **Severity**: Minor
- **Defect type**: FMEA granularity (compound failure mode)
- **Location**: hazard-analysis.md, HAZ-036 and HAZ-037 (lines 168–169)
- **Description**: Per IEC 60812, a hazard row should isolate one failure mode so its severity, likelihood, and mitigation sufficiency can each be assessed. With HAZ-038/039/040 now carved out as distinct rows, the worst of the compounding is relieved — but HAZ-036 still bundles at least four modes (anonymous access, forged-identity-header, expired/`nbf` token, wrong-`azp`/wrong-instance) plus async-producer bypass, each with a different controlling FR (FR-035, FR-038, FR-037, FR-048); and HAZ-037 still bundles per-`sub` budget exhaustion (FR-043), distinct-requester priority-inflation starvation (FR-044), oversized batches (FR-045), and queue-depth/circuit-breaker (FR-046) under one Critical × Occasional rating — and FR-044 starvation vs FR-043 budget exhaustion have materially different likelihoods. A single severity/likelihood pair cannot be exactly correct for a union of modes.
- **Recommendation**: Optionally decompose HAZ-036 into {edge auth-bypass; client-forgeable-identity-header trust; async-producer/provenance bypass} and HAZ-037 into {per-`sub` budget exhaustion; distinct-requester priority-inflation starvation; oversized-batch / queue-backpressure}, each child carrying its own severity/likelihood and FR mitigation for one-to-one Matrix-H traceability. Non-blocking: the controlling FRs are individually cited in each row's mitigation, so traceability is recoverable even without the split.

### PRF-HAZ-006 — No standalone hazard for mid-connection WebSocket token expiry (FR-049b)

- **Severity**: Minor
- **Defect type**: Missing failure mode (state coverage)
- **Location**: hazard-analysis.md, SYS-013 / SYS-010 registers; cross-ref FR-049(b), plan §2A.5
- **Description**: FR-049(b) / plan §2A.5 mandate defined behaviour when a long-lived WebSocket connection's `exp` passes mid-connection (connection closed; re-auth on reconnect). HAZ-040 now references FR-049 mid-connection re-auth as part of its mitigation, but the _mid-connection expiry_ failure mode itself (an authenticated `$connect` outliving its token and continuing to receive `FoodDataReceived` pushes after the principal's session has expired/been revoked) is folded into HAZ-040 (cache replay) rather than standing alone. HAZ-026 (notification mis-route) is about correlation, not stale-auth lifetime. The two are adjacent but distinct: HAZ-040 is "a new connection re-establishes on a replayed policy"; FR-049b is "an existing connection survives its own token's expiry."
- **Recommendation**: Optionally add a distinct hazard: "WebSocket connection outlives token `exp`; pushes continue to a now-unauthenticated/revoked session," mitigation FR-049(b) (close/re-auth) + idle-close (US-9). Low priority — WS is P3/deferred and the behaviour is referenced inside HAZ-040; recording it standalone makes the deferral an explicit residual-risk acceptance rather than an implicit one.

### PRF-HAZ-007 — Coverage Summary "Mitigations referencing `REQ-NNN`" row label still reads stronger than its OR-legend

- **Severity**: Observation
- **Defect type**: Traceability statement precision
- **Location**: hazard-analysis.md, Coverage Summary row "Mitigations referencing `REQ-NNN`" (line 199); HAZ-032 mitigation cell (line 181)
- **Description**: The summary legend reads "Every hazard mitigation cites at least one `REQ-NNN` **or** `SYS/ARCH/MOD` companion control" (line 199) — an OR — yet the row label reads "Mitigations referencing `REQ-NNN` ✓", which reads as the stronger universal-REQ claim. The five SYS-013 rows (HAZ-036..HAZ-040) all lead with FR-IDs and then list explicit `REQ-037/038/039/040/041/042/043/044/REQ-IF-008`, so the ≥1-REQ rule holds cleanly for the entire auth slice; but some ARCH-level rows (e.g. HAZ-032 cites only ARCH/MOD) make the stronger reading false. A reader auditing Matrix H for hazard→REQ closure on the ARCH rows will find the label over-promises. Precision issue, not a missing mitigation.
- **Recommendation**: Reword the summary label to "every hazard cites ≥1 control among REQ/SYS/ARCH/MOD" (matching the legend), or add the missing `REQ` reference to the ARCH-only rows. Confirm REQ-037–REQ-044 and REQ-IF-008 exist in `requirements.md` so the auth rows close Matrix H cleanly (spot-check: all are referenced consistently across the SYS-013 register).

---

## Disposition

PASS. The four findings that previously gated baseline are all **RESOLVED**: PRF-HAZ-001 (HAZ-037 = Critical, risk recomputed), PRF-HAZ-002 (HAZ-038 quota-store fail-closed added), PRF-HAZ-003 (HAZ-039 token-class confusion added), and PRF-HAZ-004 (HAZ-040 WS `$connect` cache fall-open added). The register is internally consistent at `HAZ-001..HAZ-040` (30 SYS-level + 5 ARCH-level + 5 auth-slice), the Coverage Summary totals 40, and SYS-013 carries five well-mitigated, decided-posture hazards. The two Minor and one Observation findings (compound-row granularity on HAZ-036/HAZ-037, a standalone FR-049b row, and the Coverage Summary label wording) are refinements that do not block baseline and may be addressed in a future revision. **No Critical or Major findings remain — this artifact is approved for baseline.**
