# V-Model Closure Checklist

**Version**: 0.1.0
**Generated**: 2026-05-13
**Authority**: [GR-001 Release Readiness Gate](./governance-rules.md#gr-001-release-readiness-gate), `/speckit.v-model.trace`, `/speckit.v-model.audit-report`
**Status**: Active closure checklist — no feature may claim release readiness until every applicable item is complete.

---

## Purpose

This document defines exactly what must be done to turn a feature's V-Model corpus from a bootstrapped/pre-implementation artifact set into release-ready evidence. It exists to prevent documentation-only changes from being mistaken for executed verification.

---

## Closure Definition

A feature's V-Model is **closed** only when all of the following are true for `specs/<feature>/v-model/`:

1. **Requirements baseline is current**
    - `requirements.md` contains every active functional, non-functional, interface, constraint, and governance requirement.
    - No product decision exists only in `review.md`, `product-spec/`, `plan.md`, or `tasks.md` without an equivalent `REQ-*` entry or an explicit out-of-scope/deferred record.
    - Requirement IDs are stable; renumbering requires a traceability update.

2. **Design levels are synchronized**
    - `system-design.md` maps every `REQ-*` to one or more `SYS-*` components.
    - `architecture-design.md` maps every relevant `SYS-*` component to `ARCH-*` modules.
    - `module-design.md` maps every `ARCH-*` module to implementation-level `MOD-*` units.
    - New requirements are propagated through every downstream design level before implementation begins.

3. **Test artifacts exist at every required level**
    - `acceptance-plan.md` maps each user/product requirement to `ATP-*` cases and executable `ATS-*` scenarios.
    - `system-test.md` maps every system component to `STP-*` and `STS-*` coverage.
    - `integration-test.md` maps every architecture module/interface to `ITP-*` and `ITS-*` coverage.
    - `unit-test.md` maps every module/design unit to `UTP-*` and `UTS-*` coverage.
    - No test case or scenario is orphaned; every test maps back to a requirement/design source.

4. **Traceability matrix has zero gaps**
    - `traceability-matrix.md` contains forward and backward links for all applicable matrices:
        - Matrix A: requirements ↔ acceptance tests/scenarios
        - Matrix B: requirements ↔ system tests/scenarios
        - Matrix C: architecture/modules ↔ integration tests/scenarios
        - Matrix D: modules ↔ unit tests/scenarios
        - Matrix H: hazards ↔ mitigations/tests
    - No row contains `❌ MISSING`.
    - No required mapped row remains `⬜ Untested` after test-result ingestion.

5. **Hazards and waivers are explicit**
    - `hazard-analysis.md` covers safety/security/privacy/compliance hazards relevant to the feature.
    - Hazard mitigations map to requirements and tests in Matrix H.
    - If any scenario is waived, `waivers.md` exists, is non-empty, and includes: waiver ID, linked requirement/test, reason, approver, expiry/review date, and residual risk.
    - A missing `waivers.md` is acceptable only when there are zero waivers.

6. **Real execution results are ingested**
    - CI/manual/system/integration/unit results are produced by actual execution, not assumed from documentation.
    - Results are ingested through the V-Model test-results workflow or recorded with equivalent auditable evidence.
    - Each mapped scenario has one of: `passed`, `failed`, `skipped with approved waiver`, or `waived`.
    - Failed scenarios keep the release audit blocked until fixed or formally waived.

7. **Release audit is regenerated from current data**
    - `release-audit-report.md` is regenerated after traceability and test-result updates.
    - It reports no missing required mappings, no unexecuted required scenarios, and no unwaived failures.
    - It does not claim `RELEASE READY` while any GR-001 condition fails.

8. **Product Forge verify agrees with V-Model evidence**
    - `verify-report.md` is regenerated or updated only after the V-Model release audit is current.
    - `.forge-status.yml` may set `verify: completed` only when `verify-report.md` has no CRITICAL findings for the current gate.
    - `.forge-status.yml` may set `release-readiness: completed` only when `release-audit-report.md` is unblocked and all release criteria are satisfied.

---

## Current Portfolio Reality

As of 2026-05-13, this repository's V-Model artifacts are largely bootstrapped/pre-implementation artifacts. Many release audits correctly remain `❌ BLOCKED` because implementation tasks are unchecked, traceability matrices contain missing mappings, scenario execution results have not been ingested, or waiver files are absent.

Documentation edits can make the artifact chain honest and internally consistent, but they cannot close V-Model gates. Closure requires implementation, real test execution, traceability updates, waiver decisions where applicable, and regenerated audit reports.

---

## Feature-Specific Hot Spots

| Feature                  | Blocking V-Model closure work                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `001-commise-recipe-app` | Resolve GR-002 API prefix and GR-007 shared-core handoff before implementation; then ingest real execution results.                |
| `010-subscriptions`      | Synchronize REQ-026..REQ-031 through architecture/module/hazard/unit/integration/system traceability and regenerate release audit. |
| `012-creator-profiles`   | Close release-audit missing mappings and untested scenarios; complete formal spec/product-spec FR crosswalk during revalidation.   |
| `013-cooking-school`     | Implement tasks, close missing traceability cells, ingest execution results, and regenerate blocked release audit.                 |

---

## Command Sequence for Closure

For each feature, use this order after implementation work exists:

1. `/speckit.product-forge.sync-verify` — confirm research/product/spec/plan/tasks/code alignment.
2. `/speckit.v-model.requirements` — update requirements if any product/implementation decision changed.
3. `/speckit.v-model.system-design`, `/speckit.v-model.architecture-design`, `/speckit.v-model.module-design` — propagate requirements through design levels.
4. `/speckit.v-model.acceptance`, `/speckit.v-model.system-test`, `/speckit.v-model.integration-test`, `/speckit.v-model.unit-test`, `/speckit.v-model.hazard-analysis` — update test/hazard coverage.
5. `/speckit.v-model.trace` — rebuild the bidirectional traceability matrix and verify zero gaps/orphans.
6. `/speckit.v-model.test-results` — ingest actual JUnit/Cobertura/manual evidence.
7. `/speckit.v-model.audit-report` — regenerate the release audit.
8. `/speckit.product-forge.verify-full` — refresh final Product Forge verification.
9. Update `.forge-status.yml` only after the regenerated reports support the new status.
