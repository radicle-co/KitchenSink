# Peer Review — acceptance-plan

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: acceptance-plan.md — auth slice ATP-008 (US-0: Authenticated & Authorized Access to the Food Data API)
**Standard**: ISO 29119

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 1     |
| Observation        | 1     |
| **Total Findings** | **2** |

ATP-008 maps all twelve US-0 acceptance scenarios (AS-1..AS-12) to nine sub-plans (ATP-008-A..I), each with ≥1 BDD scenario in Given/When/Then form, and the AS→ATP coverage is complete (AS-1→A, AS-2→B1, AS-5→B2, AS-3→C, AS-4/AS-6→D, AS-7/AS-8→E, AS-9→F, AS-10→G, AS-11→H, AS-12→I). The format bar is met. Since the prior pass the artifact resolved the Major (AS-5 is now its own acceptance scenario, ATS-037-B2, made measurable at the network boundary via an egress-deny harness) and one of the two Minors (ATS-036-A1 now exercises all six `/v1/foods/*` entry points). The two remaining findings concern measurability of the per-`sub` quota boundary and a spec/plan status-wording reconciliation.

## Findings

---

### PRF-ATP-001 — ATP-008-F asserts cross-user fairness (AS-9) but specifies no quota value or window, so the `429` boundary is not measurable

**Severity**: Minor
**Defect type**: Non-measurable boundary condition — **NOT addressed**

**Artifact**: acceptance-plan.md (ATP-008-F / ATS-041-F1)

**Evidence**:

- ATP-008-F is tagged **Boundary Value Analysis** and is the acceptance discharge for AS-9 (per-`sub` quota → `429`) and, transitively, SC-012 (no `sub` > configured share of the global 1,000 req/hr budget).
- ATS-041-F1 says "an authenticated user who has **exceeded their per-`sub` enqueue quota** for the rolling hour" — but states no quota N, no window definition, and no at-limit / just-over boundary. For a test labelled _Boundary Value Analysis_, the boundary (Nth request accepted, (N+1)th → `429`) is exactly what must be pinned, and it is absent.
- The SC-012 fairness assertion ("a different authenticated user's cache-miss lookup is still accepted") has no quantified share ceiling (the spec's ≤ 20% of 1,000/hr) to check against.

**Impact**: The acceptance criterion cannot be objectively pass/failed: "exceeded their quota" is circular without a stated N and window. SC-012's ≤ 20% fairness target is referenced nowhere in the scenario, so a client signing off ATP-008-F cannot confirm the configured share was actually enforced.

**Required action**: Pin the boundary in ATS-041-F1: define N (or reference the configured per-`sub` quota), the rolling-window length, and assert the Nth enqueue succeeds while the (N+1)th returns `429`; add an assertion tying the accepted-share to the ≤ 20%-of-global-budget ceiling so SC-012 is measurable at acceptance.

---

### PRF-ATP-002 — AS-7 acceptance pins `$connect` to `403` while the spec scenario says `401`/`403`; record the rationale

**Severity**: Observation
**Defect type**: Spec/plan wording reconciliation

**Artifact**: acceptance-plan.md (ATP-008-E / ATS-040-E1)

**Evidence**:

- ATS-040-E1 asserts the unauthenticated WebSocket `$connect` "is rejected with `403` before the connection is established."
- Spec AS-7 (spec.md line 62) states "rejected (`401`/`403`)". The plan correctly narrows to the single pinned status mandated by FR-049(d)/FR-050 (API-Gateway-WebSocket authorizers return a pinned `403`), but the acceptance scenario does not cite FR-049/FR-050, so a reviewer reconciling against AS-7 could read the `401` option as also acceptable and weaken the assertion.

**Impact**: None functionally — `403` is the correct pinned status. Raised only so the deliberate narrowing from AS-7's "`401`/`403`" to a single `403` is traceable and not later "relaxed."

**Required action**: Add an inline reference to FR-049(d) at ATS-040-E1 noting the pinned-`403` `$connect` status is intentional.

---

## Resolved Since Prior Pass

- **PRF-ATP-001 (was Major) — AS-2/AS-5 conflation; AS-5 networkless guarantee not client-measurable.** **Addressed.** ATP-008-B now splits the two obligations: ATS-037-B1 covers the client-observable AS-2 valid-token handling (verified `sub` reflected in audit/log correlation and the per-`sub` rate-limit bucket), and a new ATS-037-B2 discharges AS-5 from a controllable external vantage — an egress-deny / network-isolation harness that blackholes every Clerk/IdP host, asserts the `200` outcome is unchanged (no request-path IdP dependency), and asserts **zero** outbound connection attempts to any Clerk/IdP host are observed at the network boundary during verification. The internal verifier mechanics are cross-referenced to STP-013-A / STS-013-A3. The networkless guarantee is now measured, not merely asserted.
- **PRF-ATP-002 (was Minor) — ATP-008-A omitted two of six `/v1/foods/*` entry points.** **Addressed.** ATS-036-A1's When clause now enumerates all six entry points (added `GET /v1/foods/12345/nutrients` and `GET /v1/foods/autocomplete?prefix=chick`), matching STS-013-A1's six-endpoint sweep so SC-010's "each endpoint" is discharged literally.

---

## CI Gate

0 Critical / 0 Major → **PASS** (exit code 0).
