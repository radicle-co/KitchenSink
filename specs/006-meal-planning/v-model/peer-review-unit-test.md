# Peer Review — unit-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-09 | **Re-reviewed**: 2026-08-02
**Artifact**: `unit-test.md` (50 test cases / 162 scenarios across 24 executable modules)
**Standard**: ISO 29119-4; `docs/engineering/ENGINEERING_EXCELLENCE.md` → Quality Systems Engineering

## Summary

| Severity           | Count        |
| ------------------ | ------------ |
| Critical           | 0            |
| Major              | 0            |
| Minor              | 1 (resolved) |
| Observation        | 3            |
| **Total Findings** | **4**        |

**Verdict**: ✅ Pass — the single MINOR finding is resolved by enumeration.

## Findings

### PRF-006-14 · MINOR — Scenario totals are derived, not enumerated · ✅ RESOLVED

Five tables abbreviated scenario ranges, so the headline was internally consistent but never verified id-by-id.

**Disposition (2026-08-02)**: **resolved by enumeration.** Every id was extracted and de-duplicated: the true figures
are **50 UTP / 162 UTS** (published: 47/168). No dangling references — every id cited in the coverage section is
defined in the body. Corrected here and in `traceability-matrix.md` Matrix D (per-module counts), `trace.md` and the
release audit.

### OBSERVATION — The "assert outcomes, not calls" correction is the substantive change

The May plan's scenarios routinely ended in `mealPlanService.getPlan called once with ('plan-1','user-1')`.
`ENGINEERING_EXCELLENCE.md` → QSE §3 names that pattern as weak, and §3's acid test ("would this still pass if the
production code were broken?") fails it outright: a controller that called the service and then returned the wrong thing
would pass. All 162 scenarios now assert a returned value, a thrown error type, or persisted state. This is a
correctness change to the test plan, not a stylistic one.

### OBSERVATION — Property-based testing is introduced where it is genuinely applicable

Eleven properties across three modules. `aggregatePlanNutrition` is a pure fold — associativity, order-independence,
servings linearity and monotonic completeness are exactly the invariants QSE §4 says to reach for a generator on. The
May plan had none, despite the same function being the feature's core logic. Shrinking on `isComplete` propagation in
particular will find the interleaving a hand-written example set will not.

### OBSERVATION — Several scenarios are written specifically to fail plausible-but-wrong implementations

Recorded because these are the ones to protect in review: **UTS-002-A3/A4** (90 vs 91 days) discriminate `>` from `>=`;
**UTS-003-B2** fails an alphabetical slot sort; **UTS-004-B1 vs B5** discriminate "no meals planned" from a genuine
zero-calorie recipe; **UTS-012-B2** fails a gateway switch with a permissive `default`; **UTS-015-D1** fails a
`Promise.race` timeout that UTS-015-A2 would pass; **UTS-017-A1** fails when `Object.setPrototypeOf` is omitted. Each
targets a specific way the code could be locally plausible and wrong.

## Verification performed

- 24/24 executable modules have ≥ 1 UTP; MOD-024's exclusion is justified (build-time only).
- Every UTP names its ISO 29119-4 technique and anchors to a module-design view.
- Boundary analysis present on every scalar bound: span (1/2/90/91), servings (0/1/99/100), note length (500/501),
  batch size (0/1/100/101/360), day offset (0/span−1/span).
- Negative and error paths present for every module that can fail.
- Security-relevant fail-closed cases exist for MOD-005 (absent viewer id), MOD-012 (gateway unavailable) and MOD-006
  (missing readability entry).
- Type-level tests cover the properties runtime tests cannot: brand nominality, union exhaustiveness, cross-platform API
  parity, and MOD-008's import-freedom.
- A mutation gate is declared on the three pure business-rule modules.
