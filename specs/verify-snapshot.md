# Verify-Report Snapshot (Current State)

**Generated**: 2026-05-13
**Source**: per-feature `specs/<feature>/verify-report.md`, V-Model release audits, and supplemental command verification (targeted remediation pass 2026-05-13)
**Purpose**: Live current-state counts for milestone burn-down tracking. Historical baselines remain in [`v1-launch-plan.md`](./v1-launch-plan.md) under each milestone's _Artifact Remediation_ section. V-Model closure criteria are defined in [`v-model-closure-checklist.md`](./v-model-closure-checklist.md).

---

## Snapshot

| Feature                    | Milestone         | CRITICAL | WARNING | Notes                                                                                                             |
| -------------------------- | ----------------- | -------: | ------: | ----------------------------------------------------------------------------------------------------------------- |
| `001-commise-recipe-app`   | `M1` Rivendell    |    **0** |   **2** | Prior route-standard and `shared/recipe-core` handoff criticals resolved at artifact/task-planning level          |
| `002-user-auth`            | `M0` Shire        |    **0** |   **3** | data-model wording, Node engine drift, FR-indexing of tasks                                                       |
| `003-usda-food-data`       | `M1` Rivendell    |    **0** |   **3** | substitution UX, unit conversion, deferred WebSocket                                                              |
| `004-recipe-importing`     | `M1` Rivendell    |    **0** |   **4** | FR-014a legal upstream, OCR phasing, competitor matrix, v-model review drift                                      |
| `005-ai-integration`       | `M5` Isengard     |    **0** |   **2** | tasks not FR-annotated; only SC-003 explicit                                                                      |
| `006-meal-planning`        | `M4` Helm's Deep  |    **0** |   **3** | template/recurrence FR, family sizing, single SC                                                                  |
| `007-grocery-lists`        | `M3` Rohan        |    **0** |   **3** | sharing FR, store layout FR, competitor baseline drift                                                            |
| `008-cooking-mode`         | `M3` Rohan        |    **0** |   **3** | ingredient checkoff FR, cook-time scaling, voice scope                                                            |
| `009-nutrition-planning`   | `M5` Isengard     |    **0** |   **3** | premium-behavior story split, dietary FR ID, consent FR                                                           |
| `010-subscriptions`        | `M6` Gondor       |    **0** |   **1** | Traceability mappings resolved; release audit blocked only by 125 unexecuted scenarios                            |
| `011-recipe-digitization`  | `M2` Moria        |    **0** |   **3** | Task inventory normalized to `T001`–`T100`; broken link/planning warnings remain                                  |
| `012-creator-profiles`     | `M7` Minas Tirith |    **1** |   **2** | Traceability mappings resolved; release audit blocked by 89 unexecuted scenarios                                  |
| `013-cooking-school`       | `M7` Minas Tirith |    **5** |   **5** | Implementation absent; release audit mappings resolved but 102 scenarios unexecuted                               |
| `014-notification-service` | `M8` Mordor       |    **2** |   **3** | Traceability mappings resolved; release audit blocked by 186 unexecuted scenarios; verify-phase tasks not started |
| **Total**                  |                   |    **8** |  **40** | —                                                                                                                 |

---

## Supplemental Command Verification (2026-05-13)

These checks validate the current repository/tooling state but **do not** close V-Model scenarios, because no linked JUnit/Cobertura execution artifacts were ingested into the target traceability matrices.

| Command                                                                                               | Result                                                  | Evidence Boundary                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run typecheck`                                                                                   | Completed; Turbo reported `0 successful, 0 total` tasks | Repository health signal only; no feature scenario execution |
| `npm run test`                                                                                        | Completed; Turbo reported `0 successful, 0 total` tasks | Repository health signal only; no feature scenario execution |
| `npm run build`                                                                                       | Completed; Turbo reported `0 successful, 0 total` tasks | Repository health signal only; no feature scenario execution |
| `npm run lint`                                                                                        | Completed; Turbo reported `0 successful, 0 total` tasks | Repository health signal only; no feature scenario execution |
| `lsp_diagnostics specs`                                                                               | `0` diagnostics across scanned Markdown files           | Artifact syntax/diagnostic signal only                       |
| `lsp_diagnostics .specify/extensions/v-model/scripts/bash/build-audit-report.sh`                      | `0` diagnostics                                         | Script diagnostic signal only                                |
| `build-audit-report.sh specs/010-subscriptions/v-model --system-name 010-subscriptions`               | Reproduced `0` anomalies and `125` untested scenarios   | Release audit remains blocked                                |
| `build-audit-report.sh specs/012-creator-profiles/v-model --system-name 012-creator-profiles`         | Reproduced `0` anomalies and `89` untested scenarios    | Release audit remains blocked                                |
| `build-audit-report.sh specs/013-cooking-school/v-model --system-name 013-cooking-school`             | Reproduced `0` anomalies and `102` untested scenarios   | Release audit remains blocked                                |
| `build-audit-report.sh specs/014-notification-service/v-model --system-name 014-notification-service` | Reproduced `0` anomalies and `186` untested scenarios   | Release audit remains blocked                                |

**Evidence policy**: Scenario statuses must remain `⬜ Untested` until real execution results are ingested through the deterministic V-Model test-results workflow. General monorepo commands cannot be mapped to scenario pass/fail status without traceable execution artifacts.

---

## Reconciliation vs `v1-launch-plan.md`

The launch plan documents two distinct count types:

| Reference                                                                                | Meaning                                | Source of truth                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| Pre-remediation counts in _Artifact Remediation_ (e.g. `6 critical / 2 warning → 0 / 0`) | Historical baseline at plan-write time | Frozen — do **not** rewrite               |
| `verify-report.md shows 0 CRITICAL, 0 WARNING` in _Exit_                                 | Forward-looking gate criterion         | Frozen — promotion blocker                |
| **This snapshot**                                                                        | **Current state**                      | **Re-run on demand; overwrites in place** |

**Effect**: Milestone burn-down progress = (historical baseline) − (current snapshot). No edits to `v1-launch-plan.md` are required from this run.

---

## Cross-Cutting Findings

Cross-feature inventory (`CR-*`, `WA-*`, `IN-*`) is tracked separately in [`cross-feature-burndown.md`](./cross-feature-burndown.md) and is **not** reflected in the per-feature counts above.

---

## Refresh Procedure

```bash
# Re-run verify for any feature N (preserves report format, overwrites counts)
/speckit.product-forge.verify-full   # inside feature dir, then update this snapshot
```

This file is the canonical "current verify state" reference. Update on every verification wave.
