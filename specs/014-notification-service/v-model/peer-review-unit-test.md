# Peer Review — unit-test.md

> **Scope warning.** The review below was performed on **2026-05-10 against 310 test cases** covering
> MOD-001…MOD-062, and reported zero findings. `unit-test.md` now covers MOD-001…MOD-082.
> UTP-063…UTP-082 were **not examined** by that review. See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: unit-test.md (310 test cases)
**Standard**: ISO 29119-4 White-Box Techniques

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 0     |
| Observation        | 0     |
| **Total Findings** | **0** |

## Findings

No findings.

---

## Supplement — 2026-08-10 (dual-ingress amendment)

**Scope of this supplement**: UTP-063…UTP-082 and UTS-063…UTS-082, covering MOD-063…MOD-082.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 white-box pass predates this material.

### What the amendment means for this artifact

The rules FR-026 states — which field is required on which path, and that nothing is ever defaulted — are
branch-level properties, so this is the layer that catches them. One hundred test cases were added across the
twenty new module designs, five techniques each.

### Findings observed during propagation

| ID               | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-UNITTEST-001 | Major       | **UTP-001…UTP-062's 310 cases are identical.** Every one declares the same "Representative valid + invalid module inputs with fixed IDs and timestamps", the same "Mandatory success, reject, and failure path coverage", the same assertion, and the same scenario text. Statement, branch, condition, boundary and equivalence coverage are named but not differentiated — the five techniques produce five copies of one test. Nothing here would fail if the code were wrong. |
| PRF-UNITTEST-002 | Major       | **A defaulted field cannot be caught by asserting acceptance.** UTP-067's boundary and equivalence cases must assert the **absence** of a default — that `occurredAt` is not stamped with receipt time, that `schemaVersion` is not assumed — because a validator that silently defaults passes every positive test. This is HAZ-034 and it is a branch-coverage-level defect.                                                                                                    |
| PRF-UNITTEST-003 | Minor       | **The ID allocation in `traceability-matrix.md` Matrix D does not match this document** for MOD-001…MOD-062, one technique out of phase (`UTP-001-E` sits under MOD-002 there, under MOD-001 here). The ids exist in both; they disagree about which module owns each case. The new rows follow this document. Same generator artefact as Matrix C.                                                                                                                               |
| PRF-UNITTEST-004 | Minor       | **UTP-075…UTP-078 cover contracts, not code.** SYS-038's derivation rule and SYS-039's no-aggregation guarantee have no branch to cover; their cases assert the derivation over fixture domain state and count deliveries against publishes. Named as such rather than dressed as white-box coverage.                                                                                                                                                                             |
| PRF-UNITTEST-005 | Observation | **Boundary cases now have real boundaries** — `schemaVersion` 0 and an unknown future value, identical `occurredAt` values, a quota at exactly its ceiling, DLQ depth zero versus one. The original 310 cases named the technique without ever stating a boundary value.                                                                                                                                                                                                          |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 2     |
| Observation        | 1     |
| **Total Findings** | **5** |

### Cross-artifact note

The same Major finding recurs in five of the nine peer-review supplements: `acceptance-plan.md`,
`system-test.md`, `integration-test.md`, `module-design.md` and this file consist almost entirely of one
template repeated — 62, 62, 248, 62 and 310 times respectively — and all five were reviewed as
zero-findings on 2026-05-10. That is a **generator** finding, not five artifact findings, and it is why the
2026-08-10 additions state concrete inputs and falsifiable assertions instead of matching their neighbours.
Regenerating the chain without fixing the generator would delete that content and restore the boilerplate.
