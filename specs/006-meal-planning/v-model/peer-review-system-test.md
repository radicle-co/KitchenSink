# Peer Review — system-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-09 | **Re-reviewed**: 2026-08-02
**Artifact**: `system-test.md` (16 test cases / 71 scenarios + an 81-test component matrix)
**Standard**: ISO 29119; `docs/CODING_STANDARDS.md §7.1`

## Summary

| Severity           | Count      |
| ------------------ | ---------- |
| Critical           | 0          |
| Major              | 1 (closed) |
| Minor              | 2          |
| Observation        | 2          |
| **Total Findings** | **5**      |

**Verdict**: ✅ Pass — all findings closed.

## Findings

### PRF-006-11 · MAJOR — STS-PERF-A2 asserts a threshold no requirement states · ✅ CLOSED

The 90-day profile reuses the 30-day p95 target. No requirement extends `REQ-NF-006` to the maximum supported plan size,
so this scenario tests an unstated expectation — it will either be silently relaxed when it fails, or enforce a bar
nobody agreed to. **Disposition (2026-08-02)**: **resolved by removing the threshold, not by adding a requirement.** The owner accepted the residual: the 90-day profile now asserts **bounded fan-out only** and carries no p95. That removes the unstated expectation this finding was about — the scenario no longer tests anything nobody agreed to.

### PRF-006-15 · MINOR — The component-matrix split is unverified arithmetic · ✅ RESOLVED

**Disposition (2026-08-02)**: recounted cell-by-cell. **50 ticked cells → 81 tests (40 web, 41 mobile)**, because each
`(both)` column is two tests. The published 63/34/29 was low by 29% — material, since SC-006-004 measures against this
denominator.

### PRF-006-14 · MINOR — Scenario totals are derived · ✅ RESOLVED

**Disposition (2026-08-02)**: enumerated. True figures **16 STP / 71 STS** (published 14/57), the STS total including
the 14 E2E flows and 5 k6 profiles that carry `STS` ids.

### OBSERVATION — This artifact closes the largest gap in the May set

`CODING_STANDARDS §7.1` requires a component test for **every** UI path/state on **each** platform, a Playwright test
per web story, and a Maestro flow per mobile story. The May plan had **no component tier and no mobile tests at all** —
so two of the six mandated categories were unmet by omission rather than by decision, and nothing in the document said
so. The matrix now makes the obligation countable and therefore auditable.

### OBSERVATION — Infrastructure assertions cover the two hazards no other tier can reach

STP-008-B verifies listener-priority band allocation (HAZ-042) and cross-stack database-name parity (HAZ-041) at synth
time. HAZ-041 has a production precedent — defect #119 pointed a service and its destructive workers at different
databases — so a synth assertion is the right control, and `trace.md` G-3 honestly records that synth proves the
template, not the deploy.

Also worth recording: **STS-008-A5** turns "we removed Redis and SQS" from a claim in a document into a dependency check
that fails a build. Prose decisions decay; this one cannot.

## Verification performed

- 9/9 Phase-1 SYS components have ≥ 1 STP.
- All six `§7.1` categories are present: component-per-state, Playwright, Maestro, unit+integration (by reference), e2e,
  k6. The compliance table states this explicitly and notes the May plan satisfied two.
- Accessibility has dedicated scenarios including a keyboard-only assignment path (STS-010-B2), which is the
  requirement-level justification for the `@dnd-kit` choice.
- Cross-platform parity is asserted on accessible names and derived view model, not merely on feature presence.
- k6 profiles include a **degraded** profile, so the gateway's failure behaviour is proven under load rather than only
  in a unit stub.
- STS-003-A6 (edit a recipe, re-read the plan, see new values) is a standing guard against a nutrition cache or rollup
  table reappearing — a design decision defended by a test.
