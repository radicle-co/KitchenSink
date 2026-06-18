# V-Model Peer Review: Cooking Mode (008)

**Artifact Set**: `specs/008-cooking-mode/v-model/`
**Reviewed**: 2026-05-09
**Reviewer**: AI Peer Review (speckit.v-model.peer-review)
**Status**: Draft — Findings Require Resolution Before Baseline

**Artifacts Reviewed**:

- `requirements.md` (2026-05-09)
- `acceptance-plan.md` (2026-05-09)
- `unit-test.md` (2026-05-09)
- `trace.md` (2026-05-09)

**Standards Applied**: ISO 29119-4 (white-box test techniques), V-Model traceability conventions, speckit peer-review criteria

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 4     |
| WARNING  | 7     |
| PASSED   | 8     |

---

## CRITICAL Findings

---

### PRF-008-A1 — Requirement Count Inconsistency Across All Three Artifacts

**Severity**: CRITICAL
**Artifacts**: `requirements.md` (footer), `trace.md` (header), `acceptance-plan.md` (summary matrix)
**Criterion**: Internal consistency — requirement totals must agree across all artifacts

**Evidence**:

- `requirements.md` footer states: **"Total Requirements: 18"**
- Actual count in `requirements.md` tables: 11 FR + 5 NF + 2 IF + 2 CN = **20 requirements**
- `trace.md` Artifact Information table states: **"20 (9 FR + 4 NF + 4 IF + 3 CN)"**
- `acceptance-plan.md` Feature Test Summary Matrix covers: REQ-001–REQ-011, REQ-NF-001–REQ-NF-005, REQ-IF-001–REQ-IF-002, REQ-CN-001–REQ-CN-002 = **20 rows**

Three different counts (18, 20 with wrong breakdown, 20 with correct count) across three artifacts. The `trace.md` breakdown of "9 FR + 4 NF + 4 IF + 3 CN" is also wrong — `requirements.md` defines 11 FR, 5 NF, 2 IF, 2 CN.

**Impact**: Traceability completeness cannot be verified when the baseline count is disputed. Any coverage gap analysis built on the wrong total is invalid.

**Required Action**: Correct `requirements.md` footer to "Total Requirements: 20". Correct `trace.md` Artifact Information breakdown to "11 FR + 5 NF + 2 IF + 2 CN = 20". Verify all three artifacts agree before baselining.

---

### PRF-008-A2 — Phantom Requirements Referenced in trace.md Not Present in requirements.md

**Severity**: CRITICAL
**Artifacts**: `trace.md` (Matrix A, Matrix B, Matrix C), `requirements.md`
**Criterion**: Traceability completeness — every REQ-ID cited in the trace must exist in requirements.md

**Evidence**:

`trace.md` Matrix A references three requirement IDs that do not appear anywhere in `requirements.md`:

| Phantom ID   | Where Referenced in trace.md                                                  | Expected Location      |
| ------------ | ----------------------------------------------------------------------------- | ---------------------- |
| `REQ-IF-003` | Matrix A (Interface Requirements row), Matrix B, Matrix D UTP→REQ table       | Not in requirements.md |
| `REQ-IF-004` | Matrix A (Interface Requirements row), Matrix B                               | Not in requirements.md |
| `REQ-CN-003` | Matrix A (Constraint Requirements row), Matrix B, Matrix H (HAZ-001, HAZ-005) | Not in requirements.md |

`requirements.md` defines only: REQ-IF-001, REQ-IF-002, REQ-CN-001, REQ-CN-002.

The content of these phantom IDs (session persistence across lifecycle events, timer events via RN Alert API, wake lock released on exit with implicit timeout) partially overlaps with existing requirements (REQ-CN-002 covers wake lock release; REQ-IF-002 covers auth). It is unclear whether these are missing requirements that were never added to `requirements.md`, or IDs that were renamed/merged and the trace was not updated.

**Impact**: Matrix A has dangling forward traces to non-existent requirements. Matrix H hazard mitigations reference REQ-CN-003 which cannot be verified. Any coverage claim for these IDs is unfounded.

**Required Action**: Either (a) add REQ-IF-003, REQ-IF-004, REQ-CN-003 to `requirements.md` with full entries, or (b) remap all trace references to the correct existing REQ-IDs and remove the phantom IDs. Reconcile Matrix H hazard mitigations accordingly.

---

### PRF-008-A3 — AT Group Numbering Mismatch Between acceptance-plan.md and trace.md

**Severity**: CRITICAL
**Artifacts**: `acceptance-plan.md`, `trace.md` (Matrix A, Matrix B)
**Criterion**: Internal consistency — AT-ID labels must be identical across all artifacts

**Evidence**:

`acceptance-plan.md` defines these AT groups in order:

- AT-008-A: Step-by-Step Display
- AT-008-B: Forward Navigation
- AT-008-C: Backward Navigation
- AT-008-D: Countdown Timers
- **AT-008-E: Screen Wake Lock** (REQ-007, REQ-CN-002)
- **AT-008-F: Offline Functionality** (REQ-011)
- AT-008-G: Authentication Gate
- AT-008-H: Read-Only Constraint

`trace.md` Matrix A maps:

- REQ-007 → **AT-008-F** "Screen Wake Lock"
- REQ-011 → **AT-008-G** "Offline Resilience"
- REQ-IF-002 → **AT-008-H** "Clerk Integration"
- REQ-CN-001 → **AT-008-L** "Co-deployment Constraint"

Every AT group from AT-008-E onward is off by one letter in the trace relative to the acceptance plan. The trace also references AT-008-I through AT-008-M which do not appear in `acceptance-plan.md` at all.

**Impact**: Any automated or manual lookup of an AT-ID will resolve to the wrong test group. Coverage claims in Matrix B are unreliable. AT-008-I (Session Persistence), AT-008-J (Type Safety), AT-008-K (Accessibility), AT-008-L (Co-deployment), AT-008-M (BDD Scenarios) are orphaned in the trace with no corresponding acceptance-plan.md sections.

**Required Action**: Align AT-ID labels across both artifacts. Either extend `acceptance-plan.md` to include AT-008-I through AT-008-M, or renumber the trace to match the acceptance plan's actual letter assignments. Verify every AT-ID in Matrix B resolves to a real section in `acceptance-plan.md`.

---

### PRF-008-A4 — REQ-009 Has No Acceptance Test Coverage

**Severity**: CRITICAL
**Artifacts**: `trace.md` (Matrix A), `acceptance-plan.md`
**Criterion**: Traceability completeness — every requirement must have at least one acceptance test

**Evidence**:

`trace.md` Matrix A, Functional Requirements section:

```
| REQ-009 | Smooth transitions between steps | — | — | Demonstration | ⬜ Pending Execution |
```

The ATP-ID and Acceptance Test columns are both `—`, indicating no acceptance test is assigned. `acceptance-plan.md` Feature Test Summary Matrix row for REQ-009 lists "1 scenario" with method "Demonstration" but no AT group is defined in the acceptance plan body for smooth transitions. The only reference is a note in the summary table with no corresponding ATS scenario.

REQ-009 is P2 priority and verification method is "Demonstration" — this does not exempt it from requiring a defined acceptance test case. A demonstration without a defined pass criterion is not a verifiable test.

**Impact**: REQ-009 cannot be verified at acceptance level. The feature cannot be declared shippable against its own exit criteria (Gate 1 requires REQ-001–REQ-011 all passing).

**Required Action**: Add an AT-008-x group for smooth step transitions to `acceptance-plan.md` with at least one ATS scenario defining observable pass criteria (e.g., animation completes within N ms; no frame drop below 60fps). Update Matrix A in `trace.md` with the correct AT-ID.

---

## WARNING Findings

---

### PRF-008-B1 — unit-test.md Source References Non-Existent Artifact

**Severity**: WARNING
**Artifact**: `unit-test.md` (header)
**Criterion**: Standards compliance — source artifacts must exist and be reachable

**Evidence**:

`unit-test.md` header states:

```
Source: specs/008-cooking-mode/v-model/module-design.md
```

`module-design.md` is not present in the reviewed artifact set and was not provided. The unit test plan references MOD-NNN IDs (MOD-001 through MOD-018) that are defined in this missing document. Without `module-design.md`, the MOD-ID → ARCH-ID lineage cannot be verified, and the "Parent Architecture Modules" fields (ARCH-001, ARCH-002, etc.) in each MOD section are unverifiable.

Similarly, `acceptance-plan.md` header cites `system-test.md` as a source, which is also absent from the reviewed set.

**Impact**: The unit test plan's claim of ISO 29119-4 compliance cannot be fully validated without the module design it derives from. MOD-ID assignments may not match the actual module design document.

**Required Action**: Include `module-design.md` and `system-test.md` in the peer review artifact set, or confirm they exist at the referenced paths. If they do not yet exist, mark the unit-test.md and acceptance-plan.md source fields as `[PENDING]` rather than citing non-existent files.

---

### PRF-008-B2 — trace.md UTP→REQ Mapping Contradicts unit-test.md Module Assignments

**Severity**: WARNING
**Artifacts**: `trace.md` (Matrix D, UTP→REQ table), `unit-test.md`
**Criterion**: Internal consistency — UTP descriptions and REQ coverage must match the actual test case content

**Evidence**:

`trace.md` Matrix D UTP→REQ table describes UTP-001-A as "Cooking Mode entry initialization" covering REQ-001, REQ-008 with technique "Statement & Branch Coverage". However, `unit-test.md` defines:

```
UTP-001-A — Mount: Auth failure redirects to Login
Technique: Statement & Branch Coverage (AuthError branch)
```

This tests the auth failure path, not "entry initialization." The REQ coverage in the trace (REQ-001, REQ-008) does not match the actual test content (which covers the auth guard, more relevant to REQ-IF-002).

Additional mismatches observed:

- trace.md UTP-001-B: "Step rendering large-text format" → unit-test.md UTP-001-B: "Mount: Recipe not found falls back to cache hit" (covers offline/cache, not large-text rendering)
- trace.md UTP-001-C: "Screen wake lock activation" → unit-test.md UTP-001-C: "Mount: Cache miss sets error state"

The trace.md UTP→REQ descriptions appear to have been written against a different version of the unit test plan, or the MOD-001 UTP lettering was reorganized after the trace was written.

**Impact**: REQ coverage claims in Matrix D are unreliable. Automated traceability tooling would report false coverage for REQ-001, REQ-007, REQ-008 at the unit test level.

**Required Action**: Reconcile the UTP→REQ table in `trace.md` against the actual UTP definitions in `unit-test.md`. Update descriptions and REQ-ID assignments to reflect the real test content.

---

### PRF-008-B3 — Timer Pause/Resume Scenario Missing from Acceptance Tests

**Severity**: WARNING
**Artifacts**: `acceptance-plan.md`, `requirements.md`
**Criterion**: Coverage gaps — user-observable behaviors implied by requirements must have test scenarios

**Evidence**:

REQ-004 requires "integrated countdown timers for recipe steps that include a time duration." REQ-005 requires "a visible countdown when a step timer is active." The acceptance plan (AT-008-D) covers:

- Timer displayed for timed step (ATS-008-D1)
- Countdown decrements in real time (ATS-008-D2)
- Audible alert on completion (ATS-008-D3)
- Timer not displayed for non-timed step (ATS-008-D4)

Missing scenarios:

1. **Timer behavior when user navigates away from a timed step mid-countdown** — does the timer pause, reset, or continue? This is a critical UX decision with no test coverage.
2. **Timer behavior when app is backgrounded** — REQ-IF-003 (session persistence) implies the session survives backgrounding, but no test verifies timer state is preserved or correctly resumed.
3. **Timer start trigger** — ATS-008-D1 shows the timer "displayed" on navigation to the step, but does not specify whether the timer starts automatically or requires user action.

**Impact**: Timer behavior in edge cases (navigation away, app background) is unspecified and untested. Implementation teams will make arbitrary decisions that may not match user expectations.

**Required Action**: Add ATS scenarios for: (a) navigating away from a timed step mid-countdown and returning, (b) app backgrounded with active timer, (c) explicit timer start trigger (auto vs. manual). Update REQ-004/REQ-005 if the behavior needs to be formally specified.

---

### PRF-008-B4 — REQ-NF-003 Verification Method Inconsistency

**Severity**: WARNING
**Artifacts**: `requirements.md`, `acceptance-plan.md`, `trace.md`
**Criterion**: Standards compliance — verification method must be consistent across artifacts

**Evidence**:

`requirements.md` defines REQ-NF-003 ("step text readable from 3 feet") with verification method: **Test**
`acceptance-plan.md` Feature Test Summary Matrix row for REQ-NF-003: method **Demonstration**
`trace.md` Matrix A: verification method **Inspection**

Three different verification methods for the same requirement across three artifacts. "Readable from 3 feet" is a subjective criterion that cannot be verified by automated test; "Demonstration" is the most appropriate method, but the inconsistency means the requirement's verification approach is undefined.

**Impact**: Test planning cannot determine whether this requirement needs an automated test, a manual demonstration, or an inspection checklist. The exit criteria in `acceptance-plan.md` Gate 2 references this requirement without clarifying the method.

**Required Action**: Standardize REQ-NF-003 verification method to "Demonstration" across all three artifacts (the most appropriate for a subjective readability criterion). Add a concrete demonstration script: device model, distance, lighting conditions, minimum font size (18sp), contrast ratio (4.5:1).

---

### PRF-008-B5 — No Unit Tests for Timer Pause/Resume State Transitions

**Severity**: WARNING
**Artifacts**: `unit-test.md`
**Criterion**: Coverage gaps — state machine views must cover all transitions including invalid ones

**Evidence**:

`unit-test.md` MOD-004 (StepNavigationController, mapped to TimerDisplay in some sections) covers:

- UTP-004-A: invalid totalSteps throws
- UTP-004-B: stepIndex clamping
- UTP-004-C/D: goNext/goPrev boundary clamps
- UTP-004-E: normal navigation callbacks
- UTP-004-F: unsubscribe
- UTP-004-G: State Transition (Uninitialised → AtFirst → Middle → AtLast)

The timer engine (referenced as `TimerEngine` in UTP-001-E mocks) has no dedicated MOD entry with state transition tests covering: `Idle → Running → Paused → Running → Completed`. The `TimerEngine.reset()` is called on unmount (UTP-001-E) but there are no unit tests for the timer's internal state machine — specifically the `Paused` state and re-entry from `Running`.

**Impact**: Timer state machine has incomplete coverage. The `Paused` transition (if it exists) and the `Running → Completed` edge are not explicitly tested at the unit level.

**Required Action**: Add a MOD entry for `TimerEngine` (or identify which existing MOD covers it) with State Transition Testing scenarios covering all timer states including `Paused` and invalid transitions (e.g., `start()` called when already `Running`).

---

### PRF-008-B6 — Gesture Navigation Acceptance Test Has Only One Scenario (REQ-010)

**Severity**: WARNING
**Artifacts**: `acceptance-plan.md`
**Criterion**: Coverage gaps — P2 requirements with multiple interaction modes need multi-scenario coverage

**Evidence**:

AT-008-E (Gesture Navigation) in `acceptance-plan.md` contains only one scenario:

```
ATS-008-E1 | Gesture navigation (swipe) | User on step 2 | User swipes left/right | System navigates to correct step
```

REQ-010 specifies "simple gestures / taps" — two distinct input modalities. The acceptance plan covers swipe gestures in AT-008-B3 (forward swipe) and AT-008-C3 (backward swipe) under navigation groups, but AT-008-E (the dedicated gesture group) has only one scenario and does not cover:

- Tap targets (button size, hit area)
- Simultaneous gesture + button press conflict
- Gesture threshold (accidental swipe rejection)

**Impact**: Gesture input is a primary interaction modality for hands-free kitchen use (the core use case). Insufficient acceptance coverage for this modality risks shipping a gesture implementation that fails in real kitchen conditions.

**Required Action**: Expand AT-008-E with scenarios for: (a) tap navigation (separate from swipe), (b) minimum tap target size (44×44pt per WCAG 2.5.5), (c) accidental swipe rejection threshold. Consider promoting gesture coverage to P1 given the hands-free use case.

---

### PRF-008-B7 — HAZ-015 (XSS via Recipe Content) Has No Unit or Acceptance Test

**Severity**: WARNING
**Artifacts**: `trace.md` (Matrix H), `acceptance-plan.md`, `unit-test.md`
**Criterion**: Coverage gaps — hazards must have verifiable mitigations

**Evidence**:

`trace.md` Matrix H:

```
| HAZ-015 | Step content XSS via untrusted recipe source | REQ-001 | Sanitization in Recipe App (001) | AT-008-A |
```

The mitigation is delegated entirely to feature 001 ("Sanitization in Recipe App (001)"). AT-008-A (Step-by-Step Display) has no scenario that verifies XSS sanitization. No unit test in `unit-test.md` tests that step content containing HTML/script tags is rendered safely (escaped or stripped).

Cooking Mode renders recipe step content directly. Even if feature 001 sanitizes on write, Cooking Mode should defensively verify that rendered content does not execute scripts — especially since it is a read-only consumer that cannot control upstream data quality.

**Impact**: If feature 001's sanitization is incomplete or bypassed, Cooking Mode has no defense-in-depth. The hazard is acknowledged but not mitigated at the Cooking Mode layer.

**Required Action**: Add a unit test scenario to `StepDisplayPanel` (MOD-002/UTP-002) that verifies step instruction text containing `<script>` or `<img onerror>` payloads is rendered as escaped text, not executed. Add a corresponding ATS scenario to AT-008-A or a new AT-008-x security group.

---

## PASSED Findings

---

### PRF-008-C1 — ISO 29119-4 Technique Coverage in unit-test.md

**Status**: PASSED
**Artifact**: `unit-test.md`

All six mandatory ISO 29119-4 white-box techniques are represented across the unit test cases: Statement & Branch Coverage, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation, Error Guessing, and State Transition Testing. Each UTP explicitly names its technique and anchors it to a specific module design view. The technique table in the Overview section correctly maps each technique to its source view.

---

### PRF-008-C2 — BDD Scenario Structure in acceptance-plan.md

**Status**: PASSED
**Artifact**: `acceptance-plan.md`

All ATS scenarios follow the required Given/When/Then structure with concrete, observable pass criteria. Scenarios avoid vague language ("should work") and specify measurable outcomes (e.g., "Text size ≥ 18sp; contrast ratio ≥ 4.5:1", "wake lock released within 1 second"). The three-tier Tier 1/2/3 structure is correctly applied.

---

### PRF-008-C3 — Hazard Traceability Matrix Completeness

**Status**: PASSED
**Artifact**: `trace.md` (Matrix H)

Matrix H identifies 15 hazards covering the primary risk categories for a hands-free kitchen application: screen lock, timer silence, motion sickness, stale offline data, navigation boundary confusion, session loss, gesture misregistration, type safety, accessibility, co-deployment, memory leaks, authorization, session expiry, and XSS. Each hazard links to an affected REQ, a mitigation REQ, and a verification reference. Coverage is thorough for a P2 feature.

---

### PRF-008-C4 — Boundary Value Analysis Coverage for Navigation

**Status**: PASSED
**Artifact**: `unit-test.md` (UTP-004-A through UTP-004-G)

`StepNavigationController` (MOD-004) has comprehensive BVA coverage: `totalSteps = 0` and `-1` (below min), `stepIndex` clamping at both boundaries, `goNext` at last step, `goPrev` at first step, and the full state transition sequence Uninitialised → AtFirst → Middle → AtLast. The min-1, min, mid, max, max+1 pattern is correctly applied.

---

### PRF-008-C5 — Offline Resilience Scenarios

**Status**: PASSED
**Artifact**: `acceptance-plan.md` (AT-008-F)

AT-008-F correctly distinguishes between two offline scenarios: (1) recipe pre-loaded then connectivity lost (should succeed), and (2) recipe not pre-loaded with no connectivity (should fail with a user-friendly error message). This is the correct equivalence partitioning for REQ-011. The error message text is specified ("Recipe could not be loaded — check connection"), enabling exact string matching in automated tests.

---

### PRF-008-C6 — Read-Only Constraint Verification

**Status**: PASSED
**Artifact**: `acceptance-plan.md` (AT-008-H), `requirements.md` (REQ-CN-001)

AT-008-H provides two concrete scenarios for the read-only constraint: (1) Recipe data in feature 001 is unchanged after a Cooking Mode session, and (2) timer state is held in local component state only and does not write to any backend. These scenarios are verifiable via before/after data comparison and network request inspection. The constraint is correctly classified as Inspection verification.

---

### PRF-008-C7 — Strict Isolation Applied to External Dependencies

**Status**: PASSED
**Artifact**: `unit-test.md`

External dependencies (AuthGuard, RecipeDataAdapter, OfflineRecipeCache, ScreenWakeLockManager, TimerEngine) are consistently mocked/stubbed in unit tests. UTP-001-A through UTP-001-E demonstrate correct strict isolation: each test controls exactly one dependency's behavior while stubbing all others. This prevents test coupling and ensures unit tests verify module logic in isolation.

---

### PRF-008-C8 — Exit Criteria Defined in acceptance-plan.md

**Status**: PASSED
**Artifact**: `acceptance-plan.md`

The acceptance plan defines explicit, gated exit criteria across five gates: Functional Completeness (REQ-001–REQ-011), Accessibility (TypeScript strict, JSDoc, WCAG), Integration (Recipe App + Clerk), Non-Functional (readability, accessible names, color independence), and Constraint (read-only, wake lock). Each gate has checkboxes tied to specific requirements. This structure enables unambiguous shippability determination.

---

## Resolution Priority

| Priority                       | Finding    | Action                                                               |
| ------------------------------ | ---------- | -------------------------------------------------------------------- |
| P0 — Block baseline            | PRF-008-A1 | Fix requirement count discrepancy in all three artifacts             |
| P0 — Block baseline            | PRF-008-A2 | Resolve phantom REQ-IF-003, REQ-IF-004, REQ-CN-003                   |
| P0 — Block baseline            | PRF-008-A3 | Align AT-ID numbering between acceptance-plan.md and trace.md        |
| P0 — Block baseline            | PRF-008-A4 | Add acceptance test for REQ-009 (smooth transitions)                 |
| P1 — Fix before implementation | PRF-008-B1 | Confirm module-design.md and system-test.md exist at cited paths     |
| P1 — Fix before implementation | PRF-008-B2 | Reconcile UTP→REQ descriptions in trace.md with unit-test.md content |
| P1 — Fix before implementation | PRF-008-B3 | Add timer pause/resume/background acceptance scenarios               |
| P1 — Fix before implementation | PRF-008-B4 | Standardize REQ-NF-003 verification method across all artifacts      |
| P2 — Fix before test execution | PRF-008-B5 | Add TimerEngine state transition unit tests                          |
| P2 — Fix before test execution | PRF-008-B6 | Expand gesture navigation acceptance scenarios                       |
| P2 — Fix before test execution | PRF-008-B7 | Add XSS defense-in-depth unit test and acceptance scenario           |

---

_Peer review generated by speckit.v-model.peer-review. All findings are backed by direct artifact evidence. Resolve all CRITICAL findings before baselining the artifact set._
