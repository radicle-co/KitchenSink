# V-Model Traceability Baseline: Meal Planning

**Feature Branch**: `006-meal-planning`
**Generated**: 2026-05-09 | **Re-baselined**: 2026-08-02
**Baseline Status**: Draft — pending execution
**Standard**: ISO 29119 / V-Model bidirectional coverage

> **Companion document.** [`traceability-matrix.md`](./traceability-matrix.md) holds the per-requirement mapping
> matrices (A–H). **This** document holds the artifact inventory, the bidirectional coverage roll-up and the **gap
> register** — the honest list of what is not covered and why.
>
> **Re-baseline note.** The May baseline closed with three open recommendations, all now resolved:
> _(1)_ "create an integration test plan — all 14 integration points lack test cases" → `integration-test.md` now
> defines 18 cases / 72 scenarios; _(2)_ REQ-NF-003, REQ-IF-005 and REQ-IF-006 flagged "Test (no AT defined), Medium
> risk" → all three now have acceptance scenarios; _(3)_ its priority list named `PremiumTierGuard`,
> `UsdaFoodApiAdapter` and `AiProviderAdapter` as the top integration risks — **none of those modules exists** in the
> reconciled design, which is why a stale baseline is worse than none: it aims effort at the wrong things.

---

## Artifact Inventory

| Artifact              | File                     | Regenerated | Scope                                                                                                                 |
| --------------------- | ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Requirements          | `requirements.md`        | 2026-08-02  | 19 FR + 10 NF + 6 IF + 11 CN = **46** Phase-1 active, + 5 Phase-2 deferred, + 1 `[DEPRECATED]` (REQ-IF-002) = 51 rows |
| System Design         | `system-design.md`       | 2026-08-02  | 12 SYS components (9 Phase-1, 3 deferred)                                                                             |
| Architecture Design   | `architecture-design.md` | 2026-08-02  | 25 ARCH modules                                                                                                       |
| Module Design         | `module-design.md`       | 2026-08-02  | 25 MOD designs (24 executable)                                                                                        |
| Hazard Analysis       | `hazard-analysis.md`     | 2026-08-02  | 43 HAZ ids; 26 active                                                                                                 |
| Unit Test Plan        | `unit-test.md`           | 2026-08-02  | 50 UTP / **162** UTS                                                                                                  |
| Integration Test Plan | `integration-test.md`    | 2026-08-02  | 18 ITP / **72** ITS                                                                                                   |
| System Test Plan      | `system-test.md`         | 2026-08-02  | 16 STP / **71** STS + an 81-test component matrix                                                                     |
| Acceptance Test Plan  | `acceptance-plan.md`     | 2026-08-02  | 9 active AT cases / **52** ATS                                                                                        |
| Traceability Matrix   | `traceability-matrix.md` | 2026-08-02  | Matrices A–H                                                                                                          |

**Legend**: ⬜ Pending execution · ✅ Passed · ❌ Failed · ⚠️ Partial · ⏸️ Deferred

---

## Bidirectional Coverage Roll-up

### Forward (requirement → verification)

| Level               | Source            | Target           | Coverage           |
| ------------------- | ----------------- | ---------------- | ------------------ |
| Validation          | 46 Phase-1 REQ    | AT / CI evidence | **46 / 46 (100%)** |
| System verification | 46 Phase-1 REQ    | SYS → STP        | **46 / 46 (100%)** |
| Architecture        | 9 Phase-1 SYS     | ARCH             | **9 / 9 (100%)**   |
| Module              | 25 ARCH           | MOD              | **25 / 25 (100%)** |
| Unit                | 24 executable MOD | UTP              | **24 / 24 (100%)** |
| Hazard              | 26 active HAZ     | ≥ 1 test each    | **26 / 26 (100%)** |
| Success criteria    | 5 SC              | Test or CI check | **5 / 5 (100%)**   |

### Backward (verification → requirement)

| Tier        | Scenarios | Traced upward | Orphans |
| ----------- | --------- | ------------- | ------- |
| Unit        | 162       | 162           | **0**   |
| Integration | 72        | 72            | **0**   |
| System      | 71        | 71            | **0**   |
| Acceptance  | 52        | 52            | **0**   |
| **Total**   | **357**   | **357**       | **0**   |

---

## Verification Method Distribution

| Method                   | Count | Requirements                                                            |
| ------------------------ | ----- | ----------------------------------------------------------------------- |
| Test (executable)        | 24    | Most functional and interface requirements                              |
| Inspection (CI-enforced) | 13    | REQ-019, REQ-NF-001/002/004/005/007/008/009/010, REQ-CN-003/004/006/007 |
| Test + Inspection        | 1     | REQ-NF-005 (test mandate — CI report **and** review)                    |
| Demonstration            | 1     | REQ-011 (timed session)                                                 |
| Deferred                 | 5     | REQ-006, 007, 008, IF-004, CN-001                                       |

"Inspection" here means a **CI-enforced automated check**, not a human read-through. Every inspection row names a
concrete gate in [`system-test.md`](./system-test.md) STP-008-A/B. That distinction matters: the May baseline listed
REQ-NF-002 as "Inspection — JSDoc coverage reviewable via linting rules", which describes a capability, not a gate.

---

## Gap Register

The honest list. A gap silently omitted is worse than one recorded.

### G-1 — Phase-2 requirements have no verification (accepted, blocked)

| REQ                                   | Blocker                                                             | Resolution                                     |
| ------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| REQ-006, REQ-007, REQ-008, REQ-IF-004 | Feature 005 does not exist — no AI provider contract                | Write scenarios against 005's real contract    |
| REQ-CN-001                            | Feature 010 does not exist; `subscriptionTier` is not a token claim | Write against 010's real entitlement mechanism |

**Not a coverage failure.** The Phase-1 obligation is the inverse and _is_ verified: no premium surface ships.

### G-2 — REQ-IF-008 lands in another package (cross-feature prerequisite)

The batch nutrition projection is implemented in `packages/services/recipe-service`, not here. It is verified by the
consumer-driven contract cases `ITS-015-C1..C4`, which run in **001's** CI as well as 006's.

**Risk**: sequencing. 006's nutrition work is blocked until it lands. Tracked as task 1 in the implementation order.

### G-3 — Infrastructure hazards are verified by synth, not runtime

HAZ-041 (database-name derivation) and HAZ-042 (listener priority) are verified by CDK synth assertions
(`STS-008-B2..B6`). Synth proves the template is right; it does not prove the deploy succeeded.

**Compensating control**: the ADR-0010 ensure-exists deploy gate plus the post-deploy ecosystem smoke (`STS-007-A1`).
**Residual**: a synth-correct template can still fail to deploy for reasons outside this feature (a quota, a drifted
stack). Accepted; the smoke catches it before the preview is declared healthy.

### G-4 — SC-006-001 and SC-006-002 require human sessions

Workflow time and interaction count are measured in timed usability runs, not CI. They can regress silently between
sessions.

**Compensating control**: `MET-006-016` instruments interaction count continuously, so SC-006-002 has a live proxy.
SC-006-001 has none. **Accepted gap** — the alternative is a synthetic script that measures a robot's speed, not a
user's.

### G-5 — Mobile E2E is CI-gated behind a label

Maestro flows run only when the `heavy-e2e` label is applied, matching the existing arrangement for mobile flows.

**Risk**: a mobile regression can merge without the flows having run.
**Compensating control**: 41 mobile **component** tests run on every push, covering all 12 states; Maestro covers
journey wiring only. **Accepted**, and stated so nobody reads a green build as "mobile journeys verified".

### G-6 — Mutation testing is a gate on three modules only

`UTP-004-F` applies the mutation gate to MOD-002, MOD-004 and MOD-006 — the pure business rules. It is not run
repo-wide.

**Rationale**: mutation testing is expensive; `ENGINEERING_EXCELLENCE.md` → QSE §4 directs it at "core domain logic and
anything AI-generated", which is exactly these three. **Accepted, scoped deliberately.**

### G-7 — No module has zero coverage, with one by-design exception

MOD-024 (`QualityComplianceModule`) is build-time only and has no runtime logic. Verified by the CI gates it configures.
**By design, not a gap.**

---

## Resolved Gaps (May baseline → now)

| May gap                                                          | Status                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| "All 14 integration points lack integration test cases"          | **Resolved** — 18 ITP / 63 ITS defined                                           |
| REQ-NF-003 "Test (no AT defined), Medium risk"                   | **Resolved** — ATS-006-H1/H2/H5 + STP-010-B                                      |
| REQ-IF-005 "no AT defined; define when 007 is implemented"       | **Resolved** — ATS-006-G2/G4 verify **006's** side without needing 007           |
| REQ-IF-006 "no AT defined; define when 009 is implemented"       | **Resolved** — ATS-006-G4, STS-011-A1/A2                                         |
| 13 requirements with `❌ MISSING` acceptance coverage            | **Resolved** — 0 remaining                                                       |
| Integration priority list naming three non-existent modules      | **Resolved** — the modules were deleted; priorities re-derived from real hazards |
| No component-test tier despite `§7.1` requiring one per UI state | **Resolved** — 81-test matrix                                                    |
| No mobile tests of any kind                                      | **Resolved** — 29 component tests + 6 Maestro flows                              |
| No k6 tier despite a deployable service                          | **Resolved** — 5 profiles                                                        |
| No hazard→test traceability                                      | **Resolved** — Matrix H, 26 / 26                                                 |

---

## Re-baseline Triggers

Re-run this baseline when any of the following changes:

1. A requirement is added, removed or reworded in `requirements.md`.
2. A Clarification is added to `spec.md` (Matrix F must gain a row).
3. A hazard is added or its risk level changes (Matrix H).
4. Feature 005 or 010 ships — unblocks G-1 and requires Phase-2 scenarios.
5. The recipe-service batch projection contract changes — G-2.
6. A test tier's file convention changes.

---

_Baseline generated from source artifacts dated 2026-08-02. Every count in this document is derived from the artifacts
as written; none is carried forward from the May baseline._
