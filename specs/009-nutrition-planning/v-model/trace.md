# V-Model Traceability Matrix: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source Artifacts**: `requirements.md` (2026-05-09), `acceptance-plan.md` (2026-05-09), `unit-test.md` (2026-05-09)

---

## Artifact Information

| Artifact           | Requirement Count                              | AT Count    | UTP Count    | UTS Count        |
| ------------------ | ---------------------------------------------- | ----------- | ------------ | ---------------- |
| requirements.md    | 17 (4 FR + 4 NF + 5 IF + 2 CN + 2 ASSUMPTIONS) | —           | —            | —                |
| acceptance-plan.md | —                                              | 25 AT cases | —            | —                |
| unit-test.md       | —                                              | —           | 28 UTP cases | 71 UTS scenarios |

---

## Matrix A: Forward Traceability (REQ → ATP)

### Functional Requirements

| REQ-ID  | Requirement                                                                | ATP-ID | Acceptance Test                    | Verification  | Status               |
| ------- | -------------------------------------------------------------------------- | ------ | ---------------------------------- | ------------- | -------------------- |
| REQ-001 | Create nutrition plans with daily caloric and macronutrient targets        | AC-001 | Plan creation with targets         | Test          | ⬜ Pending Execution |
| REQ-002 | Link meal plans to nutrition plans                                         | AC-002 | Link meal plan to nutrition        | Test          | ⬜ Pending Execution |
| REQ-003 | Display compliance analysis with gap/excess indicators                     | AC-003 | Compliance view with indicators    | Test          | ⬜ Pending Execution |
| REQ-004 | Save nutrition plan and make visible on dashboard                          | AC-004 | Plan appears on dashboard          | Test          | ⬜ Pending Execution |
| REQ-005 | Trainers with appropriate permissions create plans for clients _(Premium)_ | AC-011 | Premium trainer creates for client | Test          | ⬜ Pending Execution |
| REQ-006 | Clients view nutrition plans created for them by trainer                   | AC-012 | Client views trainer plan          | Test          | ⬜ Pending Execution |
| REQ-007 | Suggest recipe swaps when meal plan does not meet targets _(Premium)_      | AC-014 | Swap suggestions displayed         | Demonstration | ⬜ Pending Execution |
| REQ-008 | Explicit client consent required before trainer creates plan               | AC-013 | Consent prompt appears             | Test          | ⬜ Pending Execution |

### Non-Functional Requirements

| REQ-ID     | Requirement                                                                | ATP-ID | Acceptance Test              | Verification | Status               |
| ---------- | -------------------------------------------------------------------------- | ------ | ---------------------------- | ------------ | -------------------- |
| REQ-NF-001 | TypeScript compiles with `strict: true`; no `any` outside test doubles     | AC-017 | `npx tsc --strict` passes    | Inspection   | ⬜ Pending Execution |
| REQ-NF-002 | All exported functions/interfaces have JSDoc                               | AC-018 | JSDoc on all exports         | Inspection   | ⬜ Pending Execution |
| REQ-NF-003 | UI components expose accessible name via `getByRole`/`getByLabel`          | AC-019 | Playwright a11y audit        | Test         | ⬜ Pending Execution |
| REQ-NF-004 | Color not sole conveyor of compliance state; icon or text accompanies      | AC-005 | Icon + text with color       | Inspection   | ⬜ Pending Execution |
| REQ-NF-005 | Nutritional calculations accurate within 5% of source food database values | AC-006 | Calculation accuracy vs USDA | Analysis     | ⬜ Pending Execution |

### Interface Requirements

| REQ-ID     | Requirement                                                                    | ATP-ID         | Acceptance Test                           | Verification | Status               |
| ---------- | ------------------------------------------------------------------------------ | -------------- | ----------------------------------------- | ------------ | -------------------- |
| REQ-IF-001 | Integrate with Meal Planning (006) for meal plan data                          | AC-007         | Correct meal plan data in compliance view | Test         | ⬜ Pending Execution |
| REQ-IF-002 | Integrate with USDA Food Data (003) for nutritional values                     | AC-008         | USDA values in calculations               | Test         | ⬜ Pending Execution |
| REQ-IF-003 | Integrate with Recipe App (001) for recipe nutritional data                    | AC-009         | Recipe data as calculation basis          | Test         | ⬜ Pending Execution |
| REQ-IF-004 | Integrate with Clerk (002) for authentication and trainer-client relationships | AC-010         | Auth required; relationship enforced      | Test         | ⬜ Pending Execution |
| REQ-IF-005 | Integrate with Subscriptions (010) to gate premium features                    | AC-015, AC-016 | Premium features gated                    | Test         | ⬜ Pending Execution |

### Constraint Requirements

| REQ-ID     | Requirement                                                    | ATP-ID         | Acceptance Test                 | Verification | Status               |
| ---------- | -------------------------------------------------------------- | -------------- | ------------------------------- | ------------ | -------------------- |
| REQ-CN-001 | Cannot deploy independently of 006, 003, 001, 002              | AC-020         | Deployment blocked without deps | Inspection   | ⬜ Pending Execution |
| REQ-CN-002 | Premium capabilities restricted to active premium subscription | AC-015, AC-016 | Subscription check enforcement  | Test         | ⬜ Pending Execution |

---

## Matrix B: Backward Traceability (ATP → REQ)

| ATP-ID | Acceptance Test                   | REQ-ID                 | Requirement                                       | Justification                                                      |
| ------ | --------------------------------- | ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| AC-001 | Plan creation with targets        | REQ-001                | Create nutrition plan with caloric/macro targets  | Core feature: users must be able to define their nutritional goals |
| AC-002 | Link meal plan                    | REQ-002                | Link meal plans to nutrition plans                | Enables compliance analysis between planned meals and targets      |
| AC-003 | Compliance view with indicators   | REQ-003                | Display gap/excess analysis with clear indicators | Actionable feedback to users; primary value proposition            |
| AC-004 | Dashboard visibility              | REQ-004                | Save plan and make visible on dashboard           | Persistence and discoverability of created plans                   |
| AC-005 | Icon + text with color            | REQ-NF-004             | Color not sole state conveyor                     | Accessibility for color-blind users per Constitution Principle VII |
| AC-006 | Calculation accuracy              | REQ-NF-005             | 5% accuracy vs source database                    | Data integrity and user trust per SC-010                           |
| AC-007 | Meal plan data integration        | REQ-IF-001             | Meal Planning (006) integration                   | Dependency: meal plan data required for compliance                 |
| AC-008 | USDA values integration           | REQ-IF-002             | USDA Food Data (003) integration                  | Dependency: nutritional values sourced from food database          |
| AC-009 | Recipe nutritional data           | REQ-IF-003             | Recipe App (001) integration                      | Dependency: recipe data underpins per-meal compliance              |
| AC-010 | Auth required                     | REQ-IF-004             | Clerk (002) integration                           | All features require authentication                                |
| AC-011 | Premium trainer creates           | REQ-005, REQ-CN-002    | Trainer creates for clients (Premium)             | Trainer-client workflow with subscription gate                     |
| AC-012 | Client views trainer plan         | REQ-006                | Client views trainer-created plans                | Completes the trainer-client loop                                  |
| AC-013 | Consent prompt                    | REQ-008                | Explicit client consent required                  | Privacy and consent enforcement                                    |
| AC-014 | Swap suggestions                  | REQ-007, REQ-IF-005    | AI swap suggestions (Premium)                     | Proactive guidance to close nutritional gaps                       |
| AC-015 | Premium gate for trainer planning | REQ-CN-002, REQ-IF-005 | Trainer planning behind subscription              | Business model constraint                                          |
| AC-016 | Premium gate for AI swaps         | REQ-IF-005, REQ-007    | AI swap suggestions behind subscription           | Business model constraint                                          |
| AC-017 | TypeScript strict mode            | REQ-NF-001             | `strict: true` enforcement                        | Type safety per Constitution Principle I                           |
| AC-018 | JSDoc on exports                  | REQ-NF-002             | Documentation on all exports                      | Maintainability per Constitution Principle II                      |
| AC-019 | Accessible component names        | REQ-NF-003             | `getByRole`/`getByLabel` exposure                 | Accessibility compliance per Principles IV & VII                   |
| AC-020 | Co-deployment constraint          | REQ-CN-001             | Cannot deploy without required deps               | Runtime failure prevention                                         |

---

## Matrix C: Integration Verification

| Integration Point        | Description                                                        | MOD Boundary     | UTP Coverage  | Integration Test Gap        |
| ------------------------ | ------------------------------------------------------------------ | ---------------- | ------------- | --------------------------- |
| MOD-001 ↔ MOD-002        | NutritionPlanScreen → NutritionPlanState (plan CRUD)               | UI → State       | UTP-002-A/B/C | ⚠️ Gap: no integration test |
| MOD-001 ↔ MOD-003        | NutritionPlanScreen → MacroDisplay (targets render)                | UI → Logic       | UTP-003-A/B   | ⚠️ Gap: no integration test |
| MOD-001 ↔ MOD-007        | NutritionPlanScreen → ComplianceDisplay (analysis view)            | UI → Logic       | UTP-007-A/B/C | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (006) | NutritionPlanState → Meal Planning service                         | State → External | UTP-002-D     | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (003) | NutritionPlanState → USDA Food Data service                        | State → External | UTP-002-E     | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (001) | NutritionPlanState → Recipe App service                            | State → External | UTP-002-F     | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (002) | NutritionPlanState → ClerkAuthService (002)                        | State → External | UTP-002-G     | ⚠️ Gap: no integration test |
| MOD-002 ↔ EXTERNAL (010) | NutritionPlanState → Subscriptions service (premium check)         | State → External | UTP-002-H     | ⚠️ Gap: no integration test |
| MOD-005 ↔ MOD-001        | TrainerPlanCreator → NutritionPlanScreen (plan created for client) | Logic → UI       | UTP-005-A/B   | ⚠️ Gap: no integration test |
| MOD-006 ↔ MOD-001        | ClientPlanViewer → NutritionPlanScreen (view trainer plan)         | Logic → UI       | UTP-006-A/B   | ⚠️ Gap: no integration test |
| MOD-008 ↔ MOD-001        | SwapSuggestionEngine → NutritionPlanScreen (AI suggestions)        | Logic → UI       | UTP-008-A/B   | ⚠️ Gap: no integration test |
| MOD-004 ↔ MOD-007        | ConsentHandler → ComplianceDisplay (consent-gated access)          | Logic → Logic    | UTP-004-A/B   | ⚠️ Gap: no integration test |

---

## Matrix D: Implementation Verification

| MOD-ID  | Module Name                 | Source File                                                               | UTP Count | UTS Count | Verification         |
| ------- | --------------------------- | ------------------------------------------------------------------------- | --------- | --------- | -------------------- |
| MOD-001 | NutritionPlanScreen         | `src/features/nutrition-planning/screens/NutritionPlanScreen.tsx`         | 3         | 7         | ⬜ Pending Execution |
| MOD-002 | NutritionPlanState          | `src/features/nutrition-planning/state/NutritionPlanState.tsx`            | 8         | 18        | ⬜ Pending Execution |
| MOD-003 | MacroDisplay                | `src/features/nutrition-planning/components/MacroDisplay.tsx`             | 2         | 5         | ⬜ Pending Execution |
| MOD-004 | ConsentHandler              | `src/features/nutrition-planning/components/ConsentHandler.tsx`           | 2         | 4         | ⬜ Pending Execution |
| MOD-005 | TrainerPlanCreator          | `src/features/nutrition-planning/services/TrainerPlanCreator.ts`          | 2         | 5         | ⬜ Pending Execution |
| MOD-006 | ClientPlanViewer            | `src/features/nutrition-planning/services/ClientPlanViewer.ts`            | 2         | 4         | ⬜ Pending Execution |
| MOD-007 | ComplianceDisplay           | `src/features/nutrition-planning/components/ComplianceDisplay.tsx`        | 3         | 8         | ⬜ Pending Execution |
| MOD-008 | SwapSuggestionEngine        | `src/features/nutrition-planning/services/SwapSuggestionEngine.ts`        | 3         | 8         | ⬜ Pending Execution |
| MOD-009 | NutritionPlanRepository     | `src/features/nutrition-planning/data/NutritionPlanRepository.ts`         | 2         | 6         | ⬜ Pending Execution |
| MOD-010 | NutritionCalculationService | `src/features/nutrition-planning/services/NutritionCalculationService.ts` | 3         | 8         | ⬜ Pending Execution |

### UTP → REQ Traceability (ISO 29119-4 Techniques)

| UTP-ID    | Test Case                        | REQ Coverage        | Technique                   |
| --------- | -------------------------------- | ------------------- | --------------------------- |
| UTP-001-A | Plan creation form               | REQ-001             | Statement Coverage          |
| UTP-001-B | Target input validation          | REQ-001             | Boundary Value Analysis     |
| UTP-001-C | Dashboard card rendering         | REQ-004             | Statement Coverage          |
| UTP-002-A | Plan state CRUD                  | REQ-001, REQ-004    | Statement & Branch Coverage |
| UTP-002-B | Meal plan linking                | REQ-002             | Statement Coverage          |
| UTP-002-C | Compliance calculation trigger   | REQ-003             | State Transition Testing    |
| UTP-002-D | Meal plan retrieval (006)        | REQ-IF-001          | Strict Isolation            |
| UTP-002-E | USDA data retrieval (003)        | REQ-IF-002          | Strict Isolation            |
| UTP-002-F | Recipe data retrieval (001)      | REQ-IF-003          | Strict Isolation            |
| UTP-002-G | Auth session verification (002)  | REQ-IF-004          | Strict Isolation            |
| UTP-002-H | Premium subscription check (010) | REQ-CN-002          | Statement Coverage          |
| UTP-003-A | Macro ring rendering             | REQ-001             | Statement Coverage          |
| UTP-003-B | Gap/excess indicator display     | REQ-003, REQ-NF-004 | Equivalence Partitioning    |
| UTP-004-A | Consent state machine            | REQ-008             | State Transition Testing    |
| UTP-004-B | Consent revocation               | REQ-008             | Statement Coverage          |
| UTP-005-A | Trainer plan creation            | REQ-005             | Statement Coverage          |
| UTP-005-B | Premium gate on creation         | REQ-CN-002          | Branch Coverage             |
| UTP-006-A | Client plan visibility           | REQ-006             | Statement Coverage          |
| UTP-006-B | Plan filtering by owner          | REQ-006             | Boundary Value Analysis     |
| UTP-007-A | Compliance data aggregation      | REQ-003             | Statement Coverage          |
| UTP-007-B | Gap/excess threshold logic       | REQ-003             | Boundary Value Analysis     |
| UTP-007-C | Icon + text pairing check        | REQ-NF-004          | Equivalence Partitioning    |
| UTP-008-A | Swap suggestion generation       | REQ-007             | Statement Coverage          |
| UTP-008-B | Premium gate on suggestions      | REQ-IF-005          | Branch Coverage             |
| UTP-009-A | Plan persistence                 | REQ-004             | Statement Coverage          |
| UTP-009-B | Plan retrieval                   | REQ-004             | Boundary Value Analysis     |
| UTP-010-A | Caloric sum calculation          | REQ-NF-005          | Statement Coverage          |
| UTP-010-B | Macro percentage calculation     | REQ-NF-005          | Boundary Value Analysis     |
| UTP-010-C | 5% accuracy threshold check      | REQ-NF-005          | Boundary Value Analysis     |

---

## Matrix H: Hazard Traceability

| HAZ-ID  | Hazard                                                                  | Affected REQ           | Mitigation REQ                                              | Verification   |
| ------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- | -------------- |
| HAZ-001 | Planner creates plan for client without consent → privacy violation     | REQ-008                | REQ-008 (explicit consent), MOD-004 ConsentHandler          | AC-013         |
| HAZ-002 | Free-tier user accesses trainer planning → business model bypass        | REQ-CN-002             | REQ-CN-002 (subscription gate), REQ-IF-005                  | AC-015         |
| HAZ-003 | AI swap suggestion uses wrong nutritional data → user eats wrong macros | REQ-IF-002, REQ-IF-003 | REQ-NF-005 (5% accuracy), MOD-010                           | AC-006, AC-008 |
| HAZ-004 | Compliance calculation uses stale recipe data after recipe edit         | REQ-IF-003             | REQ-IF-001 (meal plan refresh), MOD-002                     | AC-007         |
| HAZ-005 | Color-only gap/excess indicator not visible to color-blind user         | REQ-NF-004             | REQ-NF-004 (icon+text), UTP-007-C                           | AC-005         |
| HAZ-006 | Nutrition plan deployed without Meal Planning (006) → runtime crash     | REQ-CN-001             | REQ-CN-001 (co-deployment inspection), MOD-002              | AC-020         |
| HAZ-007 | Client sees another client's nutrition plan → data leak                 | REQ-IF-004             | REQ-IF-004 (Clerk relationship enforcement)                 | AC-010         |
| HAZ-008 | Trainer plan created but client subscription lapses → orphaned plan     | REQ-006, REQ-CN-002    | REQ-022, REQ-023 (subscription lapse handling)              | AC-022, AC-023 |
| HAZ-009 | Swap suggestion leads to recipe with incompatible allergens             | REQ-007                | ConsentHandler (client consent includes allergen awareness) | AC-013         |
| HAZ-010 | TypeScript `any` leaks into production → wrong macro calculation        | REQ-NF-001             | REQ-NF-001 (`strict: true`), MOD-011                        | AC-017         |
| HAZ-011 | Calculation accuracy > 5% deviation → user loses trust                  | REQ-NF-005             | REQ-NF-005 (5% threshold), MOD-010                          | AC-006         |

---

## Coverage Audit

### Forward Coverage (REQ → ATP)

| Category            | Total  | With AT | Inspection-only | Analysis-only | Uncovered |
| ------------------- | ------ | ------- | --------------- | ------------- | --------- |
| Functional (FR)     | 4      | 3       | 0               | 1             | 0         |
| Non-Functional (NF) | 4      | 2       | 2               | 0             | 0         |
| Interface (IF)      | 5      | 5       | 0               | 0             | 0         |
| Constraint (CN)     | 2      | 2       | 0               | 0             | 0         |
| **Total**           | **15** | **12**  | **2**           | **1**         | **0**     |

### Backward Coverage (ATP → REQ)

| Direction | Total | Mapped | Orphan |
| --------- | ----- | ------ | ------ |
| AT → REQ  | 25    | 25     | 0      |

### Unit Test Coverage

| MOD Category                     | Count  | UTP Count | UTS Count |
| -------------------------------- | ------ | --------- | --------- |
| Runtime modules                  | 10     | 28        | 71        |
| Config/compile-time (no runtime) | 0      | 0         | 0         |
| **Total**                        | **10** | **28**    | **71**    |

**Overall coverage: 100%** (all 15 requirements have verification path)

---

## Orphan & Gap Report

### Orphans (ATP/UTS with no REQ)

**None found** — all 25 ATPs trace to at least one requirement.

### Gaps (REQ with no verification path)

**None found** — all 15 requirements have either an AT, inspection path, or analysis justification.

### Integration Test Gaps (Priority Ordered)

| Priority | Integration Point                         | Risk                                                 |
| -------- | ----------------------------------------- | ---------------------------------------------------- |
| P1       | MOD-002 ↔ EXTERNAL (006) (Meal Planning)  | Compliance calculations wrong without meal plan data |
| P1       | MOD-002 ↔ EXTERNAL (002) (Clerk)          | Not authenticated; cannot enforce relationships      |
| P2       | MOD-002 ↔ EXTERNAL (003) (USDA)           | Nutritional values wrong; compliance inaccurate      |
| P2       | MOD-005 ↔ MOD-001 (Trainer plan creation) | Trainer cannot create plans for clients              |
| P3       | MOD-008 ↔ MOD-001 (AI swap suggestions)   | Suggestions not displayed to user                    |

**Recommendation**: Create `specs/009-nutrition-planning/v-model/integration-test.md` to address P1/P2 gaps before deployment.

---

## Baseline State

All matrix entries are set to **⬜ Pending Execution** — no acceptance tests, unit tests, or integration tests have been executed. This baseline reflects the pre-implementation state of the V-Model documentation.

---

_Matrix generated: 2026-05-09 | Source: speckit v-model trace | Status: Baseline (pre-execution)_
