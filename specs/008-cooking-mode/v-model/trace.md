# V-Model Traceability Matrix: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Draft
**Source Artifacts**: `requirements.md` (2026-05-09), `acceptance-plan.md` (2026-05-09), `unit-test.md` (2026-05-09)

---

## Artifact Information

| Artifact           | Requirement Count              | AT Count    | UTP Count    | UTS Count        |
| ------------------ | ------------------------------ | ----------- | ------------ | ---------------- |
| requirements.md    | 20 (9 FR + 4 NF + 4 IF + 3 CN) | —           | —            | —                |
| acceptance-plan.md | —                              | 17 AT cases | —            | —                |
| unit-test.md       | —                              | —           | 34 UTP cases | 82 UTS scenarios |

---

## Matrix A: Forward Traceability (REQ → ATP)

### Functional Requirements

| REQ-ID  | Requirement                                                                                | ATP-ID   | Acceptance Test      | Verification  | Status               |
| ------- | ------------------------------------------------------------------------------------------ | -------- | -------------------- | ------------- | -------------------- |
| REQ-001 | Cooking Mode displays recipe instructions one step at a time in large, readable formatting | AT-008-A | Step-by-Step Display | Test          | ⬜ Pending Execution |
| REQ-002 | Users can navigate forward through recipe steps                                            | AT-008-B | Forward Navigation   | Test          | ⬜ Pending Execution |
| REQ-003 | Users can navigate backward without losing current position                                | AT-008-C | Backward Navigation  | Test          | ⬜ Pending Execution |
| REQ-004 | Integrated countdown timers for timed steps                                                | AT-008-D | Timer Integration    | Test          | ⬜ Pending Execution |
| REQ-005 | Visible countdown when step timer is active                                                | AT-008-D | Timer Integration    | Demonstration | ⬜ Pending Execution |
| REQ-006 | Audible alert when step countdown completes                                                | AT-008-D | Timer Integration    | Test          | ⬜ Pending Execution |
| REQ-007 | Device screen stays active during Cooking Mode                                             | AT-008-F | Screen Wake Lock     | Test          | ⬜ Pending Execution |
| REQ-008 | First instruction step displayed on entry                                                  | AT-008-A | Step-by-Step Display | Test          | ⬜ Pending Execution |
| REQ-009 | Smooth transitions between steps                                                           | —        | —                    | Demonstration | ⬜ Pending Execution |
| REQ-010 | Gesture/tap-based step navigation                                                          | AT-008-E | Gesture Navigation   | Test          | ⬜ Pending Execution |
| REQ-011 | Offline functionality after recipe loaded                                                  | AT-008-G | Offline Resilience   | Test          | ⬜ Pending Execution |

### Non-Functional Requirements

| REQ-ID     | Requirement                                                            | ATP-ID   | Acceptance Test | Verification | Status               |
| ---------- | ---------------------------------------------------------------------- | -------- | --------------- | ------------ | -------------------- |
| REQ-NF-001 | TypeScript compiles with `strict: true`; no `any` outside test doubles | AT-008-J | Type Safety     | Inspection   | ⬜ Pending Execution |
| REQ-NF-002 | All exported functions/interfaces have JSDoc                           | AT-008-J | Type Safety     | Inspection   | ⬜ Pending Execution |
| REQ-NF-003 | UI components expose accessible name via `getByRole`/`getByLabel`      | AT-008-K | Accessibility   | Test         | ⬜ Pending Execution |
| REQ-NF-004 | Color not sole conveyor of state; icon or text accompanies color       | AT-008-K | Accessibility   | Inspection   | ⬜ Pending Execution |

### Interface Requirements

| REQ-ID     | Requirement                                                        | ATP-ID   | Acceptance Test        | Verification | Status               |
| ---------- | ------------------------------------------------------------------ | -------- | ---------------------- | ------------ | -------------------- |
| REQ-IF-001 | Integrates with Recipe App feature (001) for recipe data           | AT-008-H | Recipe App Integration | Test         | ⬜ Pending Execution |
| REQ-IF-002 | Integrates with Clerk feature (002) for authentication             | AT-008-H | Clerk Integration      | Test         | ⬜ Pending Execution |
| REQ-IF-003 | Cooking Mode session state persists across app lifecycle events    | AT-008-I | Session Persistence    | Test         | ⬜ Pending Execution |
| REQ-IF-004 | Timer events scheduled via reactive layer (React Native Alert API) | AT-008-D | Timer Integration      | Test         | ⬜ Pending Execution |

### Constraint Requirements

| REQ-ID     | Requirement                                                                       | ATP-ID   | Acceptance Test          | Verification | Status               |
| ---------- | --------------------------------------------------------------------------------- | -------- | ------------------------ | ------------ | -------------------- |
| REQ-CN-001 | Cooking Mode cannot be deployed independently of Recipe App (001) and Clerk (002) | AT-008-L | Co-deployment Constraint | Inspection   | ⬜ Pending Execution |
| REQ-CN-002 | Timer alerts use React Native Alert API; no third-party timer libraries           | AT-008-D | Timer Integration        | Inspection   | ⬜ Pending Execution |
| REQ-CN-003 | Screen wake lock released on exit; implicit timeout prevents orphan wake locks    | AT-008-F | Screen Wake Lock         | Test         | ⬜ Pending Execution |

---

## Matrix B: Backward Traceability (ATP → REQ)

| ATP-ID   | Acceptance Test          | REQ-ID                                                        | Requirement                                | Justification                                                                 |
| -------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| AT-008-A | Step-by-Step Display     | REQ-001                                                       | One-step-at-a-time display                 | Core Cooking Mode purpose — single step visibility is the primary UX contract |
| AT-008-A | Step-by-Step Display     | REQ-008                                                       | First step on entry                        | Entry state must be deterministic at step 1                                   |
| AT-008-B | Forward Navigation       | REQ-002                                                       | Forward navigation required                | Sequential recipe progression is fundamental to the feature                   |
| AT-008-C | Backward Navigation      | REQ-003                                                       | Backward navigation without position loss  | Reviewing prior steps without restart is a core usability requirement         |
| AT-008-D | Timer Integration        | REQ-004                                                       | Integrated timers for timed steps          | Timed steps must have in-context countdown; context switching is unacceptable |
| AT-008-D | Timer Integration        | REQ-005                                                       | Visible countdown during active timer      | Real-time feedback on remaining time is required for hands-free use           |
| AT-008-D | Timer Integration        | REQ-006                                                       | Audible alert on timer completion          | Kitchen environments are noisy; visual-only alerts are insufficient           |
| AT-008-D | Timer Integration        | REQ-IF-004                                                    | Timer events via RN Alert API              | Constraint: no third-party timer libraries                                    |
| AT-008-E | Gesture Navigation       | REQ-010                                                       | Gesture/tap-based navigation               | Wet/occupied hands require large-target gesture input                         |
| AT-008-F | Screen Wake Lock         | REQ-007                                                       | Screen stays active during Cooking Mode    | Hands-free use means no tapping to wake screen                                |
| AT-008-F | Screen Wake Lock         | REQ-CN-003                                                    | Wake lock released on exit                 | Constraint: orphan wake locks must be prevented                               |
| AT-008-G | Offline Resilience       | REQ-011                                                       | Offline after recipe loaded                | Intermittent kitchen connectivity requires loaded-recipe offline access       |
| AT-008-H | Recipe App Integration   | REQ-IF-001                                                    | Recipe data from 001                       | Dependency: recipe content sourced from feature 001                           |
| AT-008-H | Clerk Integration        | REQ-IF-002                                                    | Authentication from 002                    | Dependency: all features require Clerk authentication                         |
| AT-008-I | Session Persistence      | REQ-IF-003                                                    | Session state across lifecycle events      | Cooking sessions must survive app background/foreground transitions           |
| AT-008-J | Type Safety              | REQ-NF-001                                                    | TypeScript strict mode                     | NFR: type safety across the codebase                                          |
| AT-008-J | Type Safety              | REQ-NF-002                                                    | JSDoc on exported symbols                  | NFR: maintainability and developer experience                                 |
| AT-008-K | Accessibility            | REQ-NF-003                                                    | Accessible names via getByRole/getByLabel  | NFR: accessibility compliance (WCAG 2.1 AA)                                   |
| AT-008-K | Accessibility            | REQ-NF-004                                                    | Color not sole state conveyor              | NFR: accessibility for color-blind users                                      |
| AT-008-L | Co-deployment Constraint | REQ-CN-001                                                    | Cannot deploy independently of 001 and 002 | Constraint: runtime failures prevented by co-deployment                       |
| AT-008-M | BDD Scenarios            | REQ-001, REQ-002, REQ-003, REQ-007, REQ-008, REQ-010, REQ-011 | All Tier 1/2/3 BDD scenarios               | Full backward trace from each ATS scenario to parent REQ                      |

---

## Matrix C: Integration Verification

| Integration Point                 | Description                                                             | MOD Boundary     | UTP Coverage    | Integration Test Gap                     |
| --------------------------------- | ----------------------------------------------------------------------- | ---------------- | --------------- | ---------------------------------------- |
| MOD-001 ↔ MOD-002                 | CookingModeScreen → CookingModeState navigation state                   | UI → State       | UTP-002-A/B/C   | ⚠️ Gap: no integration test              |
| MOD-001 ↔ MOD-007                 | CookingModeScreen → WakeLockManager screen active token                 | UI → Platform    | UTP-007-A       | ⚠️ Gap: no integration test              |
| MOD-001 ↔ MOD-010                 | CookingModeScreen → AudioManager alert playback                         | UI → Platform    | UTP-010-A/B     | ⚠️ Gap: no integration test              |
| MOD-003 ↔ MOD-001                 | StepDisplay → CookingModeScreen rendered output                         | Logic → UI       | UTP-003-A/B/C/D | ⚠️ Gap: no integration test              |
| MOD-004 ↔ MOD-001                 | TimerDisplay → CookingModeScreen countdown renders                      | Logic → UI       | UTP-004-A/B/C   | ⚠️ Gap: no integration test              |
| MOD-005 ↔ MOD-001                 | GestureNav → CookingModeScreen touch events                             | Logic → UI       | UTP-005-A/B/C/D | ⚠️ Gap: no integration test              |
| MOD-006 ↔ MOD-008                 | OfflineRecipeCache → CookingModeState recipe hydration                  | Logic → State    | UTP-006-A/B     | ⚠️ Gap: no integration test              |
| MOD-009 ↔ MOD-001                 | SessionPersistence → CookingModeScreen lifecycle recovery               | Logic → UI       | UTP-009-A/B/C   | ⚠️ Gap: no integration test              |
| MOD-001 ↔ EXTERNAL (001)          | CookingModeScreen → Recipe App feature (recipe data)                    | UI → External    | —               | ⚠️ Gap: no integration test              |
| MOD-001 ↔ EXTERNAL (002)          | CookingModeScreen → Clerk feature (auth)                                | UI → External    | —               | ⚠️ Gap: no integration test              |
| MOD-001 ↔ EXTERNAL (RN)           | CookingModeScreen → React Native platform APIs (Alert, Screen, NetInfo) | UI → Platform    | —               | ⚠️ Gap: no integration test              |
| MOD-002 ↔ EXTERNAL (001)          | CookingModeState → Recipe data layer                                    | State → External | UTP-002-D       | ⚠️ Gap: no integration test              |
| MOD-011 ↔ MOD-001                 | TypeSafetyConfig → CookingModeScreen compile-time checks                | Config → UI      | —               | ⚠️ Gap: no integration test              |
| MOD-018 ↔ MOD-001                 | AccessibilityRuntime → CookingModeScreen accessible names               | Config → UI      | UTP-018-A/B     | ⚠️ Gap: no integration test              |
| MOD-012/013/014/017/019 ↔ MOD-001 | Linting/Config → CookingModeScreen (build-time)                         | Config → UI      | —               | ⚠️ Gap: build-time only, no runtime test |

---

## Matrix D: Implementation Verification

| MOD-ID  | Module Name                | Source File                                                | UTP Count | UTS Count | Verification         |
| ------- | -------------------------- | ---------------------------------------------------------- | --------- | --------- | -------------------- |
| MOD-001 | CookingModeScreen          | `src/features/cooking-mode/screens/CookingModeScreen.tsx`  | 3         | 6         | ⬜ Pending Execution |
| MOD-002 | CookingModeState           | `src/features/cooking-mode/state/CookingModeState.tsx`     | 4         | 9         | ⬜ Pending Execution |
| MOD-003 | StepDisplay                | `src/features/cooking-mode/components/StepDisplay.tsx`     | 3         | 8         | ⬜ Pending Execution |
| MOD-004 | TimerDisplay               | `src/features/cooking-mode/components/TimerDisplay.tsx`    | 4         | 10        | ⬜ Pending Execution |
| MOD-005 | GestureNav                 | `src/features/cooking-mode/components/GestureNav.tsx`      | 3         | 9         | ⬜ Pending Execution |
| MOD-006 | OfflineRecipeCache         | `src/features/cooking-mode/services/OfflineRecipeCache.ts` | 2         | 5         | ⬜ Pending Execution |
| MOD-007 | WakeLockManager            | `src/features/cooking-mode/services/WakeLockManager.ts`    | 2         | 4         | ⬜ Pending Execution |
| MOD-008 | SessionPersistence         | `src/features/cooking-mode/services/SessionPersistence.ts` | 3         | 7         | ⬜ Pending Execution |
| MOD-009 | AudioManager               | `src/features/cooking-mode/services/AudioManager.ts`       | 3         | 6         | ⬜ Pending Execution |
| MOD-010 | NavigationFlow             | `src/features/cooking-mode/utils/NavigationFlow.ts`        | 3         | 7         | ⬜ Pending Execution |
| MOD-011 | TypeScriptStrictConfig     | `tsconfig.json` (strict mode)                              | 0         | 0         | Inspection only      |
| MOD-012 | ESLintNoAnyRule            | `.eslintrc` (no-explicit-any)                              | 0         | 0         | Inspection only      |
| MOD-013 | AccessibilityLintRules     | `.eslintrc` (jsx-a11y rules)                               | 0         | 0         | Inspection only      |
| MOD-014 | AccessibilityTestConfig    | `playwright.config.ts` (a11y rules)                        | 0         | 0         | Inspection only      |
| MOD-015 | ExpoLifecycleConfig        | `App.tsx` lifecycle hooks                                  | 2         | 4         | ⬜ Pending Execution |
| MOD-016 | ExpoNotificationConfig     | Notification handling                                      | 1         | 2         | ⬜ Pending Execution |
| MOD-017 | OfflineDetectionConfig     | NetInfo monitoring                                         | 1         | 2         | ⬜ Pending Execution |
| MOD-018 | AccessibilityRuntimeChecks | `src/utils/accessibility.ts`                               | 2         | 3         | ⬜ Pending Execution |

### UTP → REQ Traceability (ISO 29119-4 Techniques)

| UTP-ID    | Test Case                         | REQ Coverage           | Technique                   |
| --------- | --------------------------------- | ---------------------- | --------------------------- |
| UTP-001-A | Cooking Mode entry initialization | REQ-001, REQ-008       | Statement & Branch Coverage |
| UTP-001-B | Step rendering large-text format  | REQ-001                | Boundary Value Analysis     |
| UTP-001-C | Screen wake lock activation       | REQ-007, REQ-CN-003    | State Transition Testing    |
| UTP-002-A | Forward step transition           | REQ-002                | Statement Coverage          |
| UTP-002-B | Backward step transition          | REQ-003                | Statement Coverage          |
| UTP-002-C | Position preservation on back     | REQ-003                | Boundary Value Analysis     |
| UTP-002-D | Recipe hydration from Recipe App  | REQ-IF-001             | Strict Isolation            |
| UTP-003-A | Step content rendering            | REQ-001                | Statement Coverage          |
| UTP-003-B | Large-text accessibility          | REQ-NF-003, REQ-NF-004 | Equivalence Partitioning    |
| UTP-004-A | Timer initialization              | REQ-004                | Statement Coverage          |
| UTP-004-B | Countdown display update          | REQ-005                | Boundary Value Analysis     |
| UTP-004-C | Timer completion alert            | REQ-006                | State Transition Testing    |
| UTP-004-D | Wake lock during active timer     | REQ-007                | Strict Isolation            |
| UTP-005-A | Tap navigation forward            | REQ-010                | Statement Coverage          |
| UTP-005-B | Tap navigation backward           | REQ-010                | Statement Coverage          |
| UTP-005-C | Gesture swipe forward             | REQ-010                | Boundary Value Analysis     |
| UTP-005-D | Gesture swipe backward            | REQ-010                | Equivalence Partitioning    |
| UTP-006-A | Recipe cached for offline         | REQ-011                | Statement Coverage          |
| UTP-006-B | Offline timer functionality       | REQ-011                | Strict Isolation            |
| UTP-007-A | Wake lock acquired on entry       | REQ-007                | State Transition Testing    |
| UTP-007-B | Wake lock released on exit        | REQ-CN-003             | State Transition Testing    |
| UTP-008-A | Session state serialization       | REQ-IF-003             | Statement Coverage          |
| UTP-008-B | Session state deserialization     | REQ-IF-003             | Boundary Value Analysis     |
| UTP-008-C | Lifecycle event recovery          | REQ-IF-003             | State Transition Testing    |
| UTP-009-A | Audio alert playback              | REQ-006                | Statement Coverage          |
| UTP-009-B | Audio alert volume                | REQ-006                | Equivalence Partitioning    |
| UTP-010-A | Step transition animation         | REQ-009                | Statement Coverage          |
| UTP-010-B | Gesture-to-step mapping           | REQ-010                | Statement Coverage          |
| UTP-015-A | App lifecycle event handling      | REQ-IF-003             | State Transition Testing    |
| UTP-015-B | Lifecycle timer coordination      | REQ-004                | Statement Coverage          |
| UTP-016-A | Notification permission request   | REQ-006                | Statement Coverage          |
| UTP-017-A | Connectivity state monitoring     | REQ-011                | Statement Coverage          |
| UTP-018-A | getByRole accessible name         | REQ-NF-003             | Statement Coverage          |
| UTP-018-B | Color + icon/text pairing check   | REQ-NF-004             | Equivalence Partitioning    |

---

## Matrix H: Hazard Traceability

| HAZ-ID  | Hazard                                                                         | Affected REQ | Mitigation REQ                                 | Verification           |
| ------- | ------------------------------------------------------------------------------ | ------------ | ---------------------------------------------- | ---------------------- |
| HAZ-001 | Screen lock during active cooking → user loses visual reference                | REQ-007      | REQ-CN-003 (wake lock on exit)                 | UTP-007-A/B, UTP-015-A |
| HAZ-002 | Timer completes silently in noisy kitchen → step missed                        | REQ-006      | REQ-006 (audible alert), UTP-009-A/B           | AT-008-D               |
| HAZ-003 | Step transition animation causes motion sickness                               | REQ-009      | REQ-009 (smooth transition), UTP-010-A         | AT-008-A               |
| HAZ-004 | Offline mode serves stale recipe data after meal plan update                   | REQ-011      | REQ-IF-001 (Recipe App integration), UTP-006-A | AT-008-G               |
| HAZ-005 | Back navigation from step 1 does not indicate boundary                         | REQ-003      | UTP-002-C (position preservation)              | AT-008-C               |
| HAZ-006 | Session loss on app background → cooking progress lost                         | REQ-IF-003   | UTP-008-A/B/C (SessionPersistence), UTP-015-A  | AT-008-I               |
| HAZ-007 | Gesture navigation misregistered → wrong step displayed                        | REQ-010      | UTP-005-C/D (gesture boundary testing)         | AT-008-E               |
| HAZ-008 | TypeScript strict mode violation in production build                           | REQ-NF-001   | REQ-NF-001 (strict: true enforcement), MOD-011 | AT-008-J               |
| HAZ-009 | Accessibility: screen reader cannot read step text                             | REQ-NF-003   | UTP-003-B (accessible name), UTP-018-A         | AT-008-K               |
| HAZ-010 | Accessibility: color-only timer state (red=urgent) not conveyed to color-blind | REQ-NF-004   | UTP-018-B (icon+text pairing)                  | AT-008-K               |
| HAZ-011 | Co-deployment violation → Cooking Mode fails at runtime without Recipe App     | REQ-CN-001   | REQ-CN-001 inspection                          | AT-008-L               |
| HAZ-012 | Timer alert via third-party library introduces memory leak                     | REQ-CN-002   | REQ-CN-002 (RN Alert API only), UTP-004-D      | Inspection             |
| HAZ-013 | Private recipe enters Cooking Mode via shared link                             | REQ-IF-001   | Auth integration (002) gate                    | AT-008-H               |
| HAZ-014 | Auth session expiry during cooking → progress loss                             | REQ-IF-002   | Session recovery via 002                       | AT-008-H               |
| HAZ-015 | Step content XSS via untrusted recipe source                                   | REQ-001      | Sanitization in Recipe App (001)               | AT-008-A               |

---

## Coverage Audit

### Forward Coverage (REQ → ATP)

| Category            | Total  | With AT | Inspection-only | Analysis-only | Uncovered |
| ------------------- | ------ | ------- | --------------- | ------------- | --------- |
| Functional (FR)     | 9      | 9       | 0               | 0             | 0         |
| Non-Functional (NF) | 4      | 2       | 2               | 0             | 0         |
| Interface (IF)      | 4      | 4       | 0               | 0             | 0         |
| Constraint (CN)     | 3      | 2       | 1               | 0             | 0         |
| **Total**           | **20** | **17**  | **3**           | **0**         | **0**     |

### Backward Coverage (ATP → REQ)

| Direction | Total | Mapped | Orphan |
| --------- | ----- | ------ | ------ |
| AT → REQ  | 17    | 17     | 0      |

### Unit Test Coverage

| MOD Category                     | Count  | UTP Count | UTS Count |
| -------------------------------- | ------ | --------- | --------- |
| Runtime modules                  | 14     | 34        | 82        |
| Config/compile-time (no runtime) | 4      | 0         | 0         |
| **Total**                        | **18** | **34**    | **82**    |

**Overall coverage: 100%** (all 20 requirements have verification path)

---

## Orphan & Gap Report

### Orphans (ATP/UTS with no REQ)

**None found** — all 17 ATPs trace to at least one requirement.

### Gaps (REQ with no verification path)

**None found** — all 20 requirements have either an AT, inspection path, or demonstration justification.

### Integration Test Gaps (Priority Ordered)

| Priority | Integration Point                      | Risk                                    |
| -------- | -------------------------------------- | --------------------------------------- |
| P1       | MOD-001 ↔ MOD-002 (navigation state)   | Screen freeze if state transition fails |
| P1       | MOD-001 ↔ MOD-007 (wake lock)          | Device sleep during cooking             |
| P2       | MOD-003 ↔ MOD-001 (step rendering)     | Steps not visible                       |
| P2       | MOD-004 ↔ MOD-001 (timer display)      | Countdown not visible                   |
| P2       | MOD-001 ↔ EXTERNAL (001) (recipe data) | No recipe to display                    |
| P2       | MOD-001 ↔ EXTERNAL (002) (auth)        | Not authenticated                       |
| P3       | MOD-006 ↔ MOD-008 (offline cache)      | Session recovery fails offline          |

**Recommendation**: Create `specs/008-cooking-mode/v-model/integration-test.md` to address P1/P2 gaps before deployment.

---

## Baseline State

All matrix entries are set to **⬜ Pending Execution** — no acceptance tests, unit tests, or integration tests have been executed. This baseline reflects the pre-implementation state of the V-Model documentation.

---

_Matrix generated: 2026-05-09 | Source: speckit v-model trace | Status: Baseline (pre-execution)_
