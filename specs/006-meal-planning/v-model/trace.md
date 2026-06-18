# V-Model Traceability Matrix: Meal Planning

**Feature Branch**: `006-meal-planning`
**Generated**: 2026-05-09
**Baseline Status**: Draft — Pending Execution
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

---

## Artifact Information

| Artifact                   | File                                                 | Created    | Status     | Scope                                                            |
| -------------------------- | ---------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------- |
| Requirements Specification | `specs/006-meal-planning/v-model/requirements.md`    | 2026-05-09 | Draft      | 11 FR + 4 NF + 6 IF + 2 CN = 23 total requirements               |
| Acceptance Test Plan       | `specs/006-meal-planning/v-model/acceptance-plan.md` | 2026-05-09 | Draft      | AT cases for all 11 FR + selected NF/IF/CN                       |
| Unit Test Plan             | `specs/006-meal-planning/v-model/unit-test.md`       | 2026-05-09 | Draft      | 21 MODs (22 incl. cross-cutting), 35 UTP cases, 92 UTS scenarios |
| System Design              | `specs/006-meal-planning/v-model/system-design.md`   | —          | Referenced | ARCH modules (ARCH-001 through ARCH-022)                         |
| Module Design              | `specs/006-meal-planning/v-model/module-design.md`   | —          | Referenced | MOD-001 through MOD-022                                          |

**Legend**:

- ⬜ Pending Execution — test defined, not yet run
- ✅ Passed — test executed and passed
- ❌ Failed — test executed and failed
- ⚠️ Partially Passed — test executed with partial pass

---

## Matrix A: Forward Traceability (REQ → ATP)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage.

### Functional Requirements

| REQ-ID  | Requirement (Summary)                                                       | Priority | ATP-ID                            | Acceptance Test (Summary)                                                 | Verification Method                        | Status |
| ------- | --------------------------------------------------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| REQ-001 | Create meal plan for configurable date range                                | P2       | AT-006-A                          | Meal Plan CRUD (create 1-week, 30+ days, unauthenticated, view, delete)   | Scenario-Based Testing                     | ⬜     |
| REQ-002 | Customizable meal slots per day (breakfast, lunch, dinner, snacks)          | P2       | AT-006-B                          | Recipe Assignment to Meal Slots                                           | Equivalence Partitioning                   | ⬜     |
| REQ-003 | Manually assign recipes from personal collection to meal slots              | P2       | AT-006-B                          | Recipe Assignment to Meal Slots (assign, remove, non-owned, out-of-range) | Scenario-Based Testing                     | ⬜     |
| REQ-004 | Display daily nutritional summaries calculated from assigned recipes        | P2       | AT-006-C                          | Nutritional Summaries (daily with recipes, empty day)                     | Boundary Value Analysis                    | ⬜     |
| REQ-005 | Display weekly nutritional summaries aggregated across all days             | P2       | AT-006-C                          | Nutritional Summaries (weekly full, weekly partial)                       | Scenario-Based Testing                     | ⬜     |
| REQ-006 | AI-powered meal suggestions for premium users                               | P2       | AT-006-D                          | AI Meal Suggestions (premium, free-tier 402, accept, reject)              | Branch Coverage + Equivalence Partitioning | ⬜     |
| REQ-007 | Auto-generation of complete meal plan for premium users                     | P2       | AT-006-E                          | Auto-Generation (complete plan, conflicting constraints)                  | State Transition Testing                   | ⬜     |
| REQ-008 | Food waste optimization for premium users                                   | P2       | AT-006-F                          | Food Waste Optimization (overlap found, no waste)                         | Scenario-Based Testing                     | ⬜     |
| REQ-009 | View completed meal plan with all slots, recipes, and nutritional summaries | P2       | AT-006-A (ATS-006-A4)             | View own meal plan — full plan with slots and recipes                     | Demonstration                              | ⬜     |
| REQ-010 | Support meal plans spanning at least 30 days                                | P2       | AT-006-A (ATS-006-A2)             | Create plan for 30+ days; 201 returned                                    | Boundary Value Analysis                    | ⬜     |
| REQ-011 | Complete meal-plan-to-grocery-list workflow in under 10 minutes             | P2       | _(Demonstration — no AT defined)_ | —                                                                         | Demonstration                              | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                             | Priority | ATP-ID                                         | Acceptance Test (Summary) | Verification Method | Status |
| ---------- | ----------------------------------------------------------------- | -------- | ---------------------------------------------- | ------------------------- | ------------------- | ------ |
| REQ-NF-001 | TypeScript strict mode; no `any` outside test doubles             | P1       | _(Inspection — no AT defined)_                 | —                         | Inspection          | ⬜     |
| REQ-NF-002 | All exported functions and interfaces carry JSDoc                 | P1       | _(Inspection — no AT defined)_                 | —                         | Inspection          | ⬜     |
| REQ-NF-003 | UI components expose accessible name via `getByRole`/`getByLabel` | P1       | _(Test — no AT defined in acceptance-plan.md)_ | —                         | Test                | ⬜     |
| REQ-NF-004 | Color not sole conveyor of state; icon or text label required     | P1       | _(Inspection — no AT defined)_                 | —                         | Inspection          | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                                   | Priority | ATP-ID                         | Acceptance Test (Summary)                          | Verification Method | Status |
| ---------- | ----------------------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------- | ------------------- | ------ |
| REQ-IF-001 | Integrate with Recipe entity API (feature 001)                          | P1       | _(Inspection — no AT defined)_ | —                                                  | Inspection          | ⬜     |
| REQ-IF-002 | Integrate with USDA food data service (feature 003)                     | P1       | AT-006-C (ATS-006-C1)          | Daily summary computed from USDA ingredient data   | Test                | ⬜     |
| REQ-IF-003 | Enforce authentication via Clerk (feature 002)                          | P1       | AT-006-A (ATS-006-A3)          | Unauthenticated request returns 401                | Test                | ⬜     |
| REQ-IF-004 | Integrate with AI provider config (feature 005) for premium AI features | P2       | AT-006-D, AT-006-E             | AI suggestions and auto-generation use AI provider | Test                | ⬜     |
| REQ-IF-005 | Expose meal plan data consumable by feature 007 (grocery lists)         | P2       | _(Inspection — no AT defined)_ | —                                                  | Test                | ⬜     |
| REQ-IF-006 | Expose meal plan data linkable by feature 009 (nutrition planning)      | P2       | _(Inspection — no AT defined)_ | —                                                  | Test                | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                               | Priority | ATP-ID                                    | Acceptance Test (Summary)                          | Verification Method | Status |
| ---------- | ------------------------------------------------------------------- | -------- | ----------------------------------------- | -------------------------------------------------- | ------------------- | ------ |
| REQ-CN-001 | AI features restricted to premium subscribers only                  | P1       | AT-006-D (ATS-006-D2), AT-006-E, AT-006-F | Free-tier returns 402 for all AI/premium endpoints | Test                | ⬜     |
| REQ-CN-002 | Meal Plan entity scoped to authenticated user; no cross-user access | P1       | AT-006-A (ATS-006-A5)                     | View another user's plan returns 404               | Test                | ⬜     |

---

## Matrix B: Backward Traceability (ATP → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

| ATP-ID   | Acceptance Test (Summary)         | REQ-ID                       | Requirement (Summary)                                                      | Justification                                              |
| -------- | --------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AT-006-A | Meal Plan CRUD                    | REQ-001, REQ-010, REQ-CN-001 | Create plan for configurable date range; 30+ day support; auth enforcement | Covers create, view, delete, and auth boundary scenarios   |
| AT-006-B | Recipe Assignment to Meal Slots   | REQ-002, REQ-003             | Customizable meal slots; manual recipe assignment                          | Covers assign, remove, non-owned recipe, out-of-range slot |
| AT-006-C | Nutritional Summaries             | REQ-004, REQ-005             | Daily and weekly nutritional summaries                                     | Covers daily with/without recipes; weekly full and partial |
| AT-006-D | AI Meal Suggestions (Premium)     | REQ-006, REQ-CN-001          | AI suggestions for premium users; 402 for free-tier                        | Covers premium success, free-tier gate, accept, reject     |
| AT-006-E | Auto-Generation (Premium)         | REQ-007, REQ-CN-001          | Auto-generate complete plan for premium users                              | Covers full generation and conflicting constraints         |
| AT-006-F | Food Waste Optimization (Premium) | REQ-008, REQ-CN-001          | Food waste optimization for premium users                                  | Covers overlap detection and no-waste scenario             |

### Scenario-Level Backward Traceability

| ATS-ID     | Scenario (Summary)                           | AT-ID    | REQ-IDs             |
| ---------- | -------------------------------------------- | -------- | ------------------- |
| ATS-006-A1 | Create plan for 1 week                       | AT-006-A | REQ-001             |
| ATS-006-A2 | Create plan for 30+ days                     | AT-006-A | REQ-001, REQ-010    |
| ATS-006-A3 | Create plan unauthenticated → 401            | AT-006-A | REQ-IF-003          |
| ATS-006-A4 | View own meal plan                           | AT-006-A | REQ-001, REQ-009    |
| ATS-006-A5 | View another user's plan → 404               | AT-006-A | REQ-CN-002          |
| ATS-006-A6 | Delete meal plan                             | AT-006-A | REQ-001             |
| ATS-006-B1 | Assign recipe to breakfast slot              | AT-006-B | REQ-002, REQ-003    |
| ATS-006-B2 | Remove recipe from slot                      | AT-006-B | REQ-003             |
| ATS-006-B3 | Assign recipe user doesn't own → 404         | AT-006-B | REQ-003             |
| ATS-006-B4 | Assign to slot outside plan date range → 400 | AT-006-B | REQ-002, REQ-003    |
| ATS-006-C1 | Daily summary with assigned recipes          | AT-006-C | REQ-004, REQ-IF-002 |
| ATS-006-C2 | Daily summary with no recipes → zeros        | AT-006-C | REQ-004             |
| ATS-006-C3 | Weekly summary full week                     | AT-006-C | REQ-005             |
| ATS-006-C4 | Weekly summary partial week                  | AT-006-C | REQ-005             |
| ATS-006-D1 | Premium user requests suggestions            | AT-006-D | REQ-006             |
| ATS-006-D2 | Free-tier user requests suggestions → 402    | AT-006-D | REQ-CN-001          |
| ATS-006-D3 | Premium user accepts suggestion              | AT-006-D | REQ-006             |
| ATS-006-D4 | Premium user rejects all suggestions         | AT-006-D | REQ-006             |
| ATS-006-E1 | Auto-generate complete plan                  | AT-006-E | REQ-007             |
| ATS-006-E2 | Auto-generate with conflicting constraints   | AT-006-E | REQ-007             |
| ATS-006-F1 | Waste optimization identifies overlap        | AT-006-F | REQ-008             |
| ATS-006-F2 | No waste found                               | AT-006-F | REQ-008             |

---

## Matrix C: Integration Verification

> Integration-level requirements verified at module boundaries (ARCH-level). Unit tests (UTP) verify internal module logic; integration tests verify cross-module contracts.

| Integration Point                                                                     | REQ-IDs                   | MOD Boundary                        | UTP Coverage                                                 | Integration Test Status | Notes                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- | ------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| MealPlanController → MealPlanService                                                  | REQ-001, REQ-002          | MOD-001 ↔ MOD-002                   | UTP-001-A (null-check), UTP-001-B (delegation)               | ⬜                      | Integration test needed: controller routes to service with real NestJS DI                             |
| MealPlanService → MealPlanRepository                                                  | REQ-001, REQ-002, REQ-010 | MOD-002 ↔ MOD-003                   | UTP-002-A (date/slot validation), UTP-003-A (insert)         | ⬜                      | Integration test needed: service validates then persists to real DB                                   |
| MealPlanRepository → PostgreSQL (Drizzle ORM)                                         | REQ-001, REQ-CN-002       | MOD-003 ↔ pg                        | UTP-003-B (userId filter)                                    | ⬜                      | Integration test needed: row-level security enforced in real DB query                                 |
| RecipeAssignmentController → RecipeAssignmentService                                  | REQ-003                   | MOD-004 ↔ MOD-005                   | UTP-004-A (delegation)                                       | ⬜                      | Integration test needed: assignment routes through real NestJS DI                                     |
| RecipeAssignmentService → RecipeAssignmentRepository                                  | REQ-003                   | MOD-005 ↔ MOD-006                   | UTP-005-A, UTP-005-B (ownership check)                       | ⬜                      | Integration test needed: ownership check with real DB slot lookup                                     |
| RecipeAssignmentRepository → PostgreSQL (upsert)                                      | REQ-003                   | MOD-006 ↔ pg                        | UTP-006-B (upsert semantics)                                 | ⬜                      | Integration test needed: ON CONFLICT DO UPDATE in real DB                                             |
| NutritionalSummaryService → UsdaFoodApiAdapter                                        | REQ-004, REQ-005          | MOD-008 ↔ MOD-017                   | UTP-008-A (cache hit/miss), UTP-017-A (circuit breaker)      | ⬜                      | Integration test needed: real USDA API call with circuit breaker                                      |
| NutritionalSummaryService → NutritionalSummaryCache                                   | REQ-004, REQ-005          | MOD-008 ↔ MOD-009                   | UTP-008-B (cache fault tolerance)                            | ⬜                      | Integration test needed: Redis cache with real TTL and invalidation                                   |
| AISuggestionService → AiProviderAdapter                                               | REQ-006                   | MOD-011 ↔ MOD-019                   | UTP-011-A (response parsing), UTP-019-A (HTTP status)        | ⬜                      | Integration test needed: real AI provider API call and JSON parsing                                   |
| AISuggestionService → RecipeApiAdapter                                                | REQ-006, REQ-IF-001       | MOD-011 ↔ MOD-016                   | UTP-016-A (status codes)                                     | ⬜                      | Integration test needed: recipe collection fetch from feature 001 API                                 |
| AutoGenerateService → MealPlanService + AISuggestionService + RecipeAssignmentService | REQ-007                   | MOD-013 ↔ MOD-002, MOD-011, MOD-005 | UTP-013-A (slot generation), UTP-013-B (orchestration order) | ⬜                      | Integration test needed: full auto-generate pipeline with real services                               |
| WasteOptimizationService → RecipeApiAdapter                                           | REQ-008, REQ-IF-001       | MOD-015 ↔ MOD-016                   | UTP-015-A (overlap scoring)                                  | ⬜                      | Integration test needed: ingredient overlap computed from real recipe data                            |
| PremiumTierGuard → NestJS ExecutionContext                                            | REQ-CN-001                | MOD-021 ↔ NestJS                    | UTP-021-A, UTP-021-B (tier check)                            | ⬜                      | Integration test needed: guard applied to premium endpoints in real request pipeline                  |
| MealPlanPublicApiAdapter → downstream consumers (007, 009)                            | REQ-IF-005, REQ-IF-006    | MOD-020 ↔ external                  | UTP-020-A (version dispatch), UTP-020-B (slot serialization) | ⬜                      | Integration test needed: v1/v2 serialization consumed by grocery list and nutrition planning features |

---

## Matrix D: Implementation Verification

> Maps module designs (MOD) to unit test cases (UTP) and their scenarios (UTS). Verifies implementation completeness at the code level.

| MOD-ID  | Module Name                               | Source File                                                       | ARCH Parent | UTP Cases                       | UTS Scenarios                                                                  | Implementation Status |
| ------- | ----------------------------------------- | ----------------------------------------------------------------- | ----------- | ------------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| MOD-001 | MealPlanController                        | `src/meal-planning/controllers/meal-plan.controller.ts`           | ARCH-001    | UTP-001-A, UTP-001-B            | UTS-001-A1 through A2, UTS-001-B1 through B3 (5 total)                         | ⬜                    |
| MOD-002 | MealPlanService                           | `src/meal-planning/services/meal-plan.service.ts`                 | ARCH-002    | UTP-002-A, UTP-002-B, UTP-002-C | UTS-002-A1 through A8, UTS-002-B1 through B3, UTS-002-C1 through C3 (14 total) | ⬜                    |
| MOD-003 | MealPlanRepository                        | `src/meal-planning/repositories/meal-plan.repository.ts`          | ARCH-003    | UTP-003-A, UTP-003-B            | UTS-003-A1 through A2, UTS-003-B1 through B2 (4 total)                         | ⬜                    |
| MOD-004 | RecipeAssignmentController                | `src/meal-planning/controllers/recipe-assignment.controller.ts`   | ARCH-004    | UTP-004-A                       | UTS-004-A1 through A2 (2 total)                                                | ⬜                    |
| MOD-005 | RecipeAssignmentService                   | `src/meal-planning/services/recipe-assignment.service.ts`         | ARCH-005    | UTP-005-A, UTP-005-B            | UTS-005-A1 through A2, UTS-005-B1 through B2 (4 total)                         | ⬜                    |
| MOD-006 | RecipeAssignmentRepository                | `src/meal-planning/repositories/recipe-assignment.repository.ts`  | ARCH-006    | UTP-006-A, UTP-006-B            | UTS-006-A1 through A2, UTS-006-B1 (3 total)                                    | ⬜                    |
| MOD-007 | NutritionalSummaryController              | `src/meal-planning/controllers/nutritional-summary.controller.ts` | ARCH-007    | UTP-007-A                       | UTS-007-A1 through A2 (2 total)                                                | ⬜                    |
| MOD-008 | NutritionalSummaryService                 | `src/meal-planning/services/nutritional-summary.service.ts`       | ARCH-008    | UTP-008-A, UTP-008-B            | UTS-008-A1 through A2, UTS-008-B1 through B2 (4 total)                         | ⬜                    |
| MOD-009 | NutritionalSummaryCache                   | `src/meal-planning/cache/nutritional-summary.cache.ts`            | ARCH-009    | UTP-009-A, UTP-009-B            | UTS-009-A1 through A4, UTS-009-B1 through B3 (7 total)                         | ⬜                    |
| MOD-010 | AISuggestionController                    | `src/meal-planning/controllers/ai-suggestion.controller.ts`       | ARCH-010    | UTP-010-A                       | UTS-010-A1 (1 total)                                                           | ⬜                    |
| MOD-011 | AISuggestionService                       | `src/meal-planning/services/ai-suggestion.service.ts`             | ARCH-011    | UTP-011-A                       | UTS-011-A1 through A3 (3 total)                                                | ⬜                    |
| MOD-012 | AutoGenerateController                    | `src/meal-planning/controllers/auto-generate.controller.ts`       | ARCH-012    | UTP-012-A                       | UTS-012-A1 (1 total)                                                           | ⬜                    |
| MOD-013 | AutoGenerateService                       | `src/meal-planning/services/auto-generate.service.ts`             | ARCH-013    | UTP-013-A, UTP-013-B            | UTS-013-A1 through A2, UTS-013-B1 (3 total)                                    | ⬜                    |
| MOD-014 | WasteOptimizationController               | `src/meal-planning/controllers/waste-optimization.controller.ts`  | ARCH-014    | UTP-014-A                       | UTS-014-A1 (1 total)                                                           | ⬜                    |
| MOD-015 | WasteOptimizationService                  | `src/meal-planning/services/waste-optimization.service.ts`        | ARCH-015    | UTP-015-A                       | UTS-015-A1 through A3 (3 total)                                                | ⬜                    |
| MOD-016 | RecipeApiAdapter                          | `src/meal-planning/adapters/recipe-api.adapter.ts`                | ARCH-016    | UTP-016-A                       | UTS-016-A1 through A3 (3 total)                                                | ⬜                    |
| MOD-017 | UsdaFoodApiAdapter                        | `src/meal-planning/adapters/usda-food-api.adapter.ts`             | ARCH-017    | UTP-017-A, UTP-017-B            | UTS-017-A1 through A3, UTS-017-B1 through B4 (7 total)                         | ⬜                    |
| MOD-018 | AiPromptBuilder                           | `src/meal-planning/utils/ai-prompt-builder.ts`                    | ARCH-018    | UTP-018-A, UTP-018-B            | UTS-018-A1 through A4, UTS-018-B1 through B3 (7 total)                         | ⬜                    |
| MOD-019 | AiProviderAdapter                         | `src/meal-planning/adapters/ai-provider.adapter.ts`               | ARCH-019    | UTP-019-A, UTP-019-B            | UTS-019-A1 through A3, UTS-019-B1 through B3 (6 total)                         | ⬜                    |
| MOD-020 | MealPlanPublicApiAdapter                  | `src/meal-planning/adapters/meal-plan-public-api.adapter.ts`      | ARCH-020    | UTP-020-A, UTP-020-B            | UTS-020-A1 through A4, UTS-020-B1 through B2 (6 total)                         | ⬜                    |
| MOD-021 | PremiumTierGuard                          | `src/meal-planning/guards/premium-tier.guard.ts`                  | ARCH-021    | UTP-021-A, UTP-021-B            | UTS-021-A1 through A3, UTS-021-B1 through B3 (6 total)                         | ⬜                    |
| MOD-022 | QualityComplianceModule _(cross-cutting)_ | `tsconfig.json`, `.eslintrc.js`, `src/meal-planning/**/*.ts`      | ARCH-022    | _(none — build-time only)_      | _(none)_                                                                       | ⬜                    |

### UTP → REQ Traceability (Implementation → Requirement)

| UTP-ID    | Module                               | Technique                   | REQ-IDs Covered           | UTS Count | Status |
| --------- | ------------------------------------ | --------------------------- | ------------------------- | --------- | ------ |
| UTP-001-A | MOD-001 MealPlanController           | Statement & Branch Coverage | REQ-001, REQ-002          | 2         | ⬜     |
| UTP-001-B | MOD-001 MealPlanController           | Strict Isolation            | REQ-001, REQ-002          | 3         | ⬜     |
| UTP-002-A | MOD-002 MealPlanService              | Statement & Branch Coverage | REQ-001, REQ-002          | 8         | ⬜     |
| UTP-002-B | MOD-002 MealPlanService              | Boundary Value Analysis     | REQ-001                   | 3         | ⬜     |
| UTP-002-C | MOD-002 MealPlanService              | Equivalence Partitioning    | REQ-002                   | 3         | ⬜     |
| UTP-003-A | MOD-003 MealPlanRepository           | Statement & Branch Coverage | REQ-001                   | 2         | ⬜     |
| UTP-003-B | MOD-003 MealPlanRepository           | Strict Isolation            | REQ-001                   | 2         | ⬜     |
| UTP-004-A | MOD-004 RecipeAssignmentController   | Strict Isolation            | REQ-003                   | 2         | ⬜     |
| UTP-005-A | MOD-005 RecipeAssignmentService      | Statement & Branch Coverage | REQ-003                   | 2         | ⬜     |
| UTP-005-B | MOD-005 RecipeAssignmentService      | Statement & Branch Coverage | REQ-003                   | 2         | ⬜     |
| UTP-006-A | MOD-006 RecipeAssignmentRepository   | Statement & Branch Coverage | REQ-003                   | 2         | ⬜     |
| UTP-006-B | MOD-006 RecipeAssignmentRepository   | Strict Isolation            | REQ-003                   | 1         | ⬜     |
| UTP-007-A | MOD-007 NutritionalSummaryController | Strict Isolation            | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-008-A | MOD-008 NutritionalSummaryService    | Statement & Branch Coverage | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-008-B | MOD-008 NutritionalSummaryService    | Statement & Branch Coverage | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-009-A | MOD-009 NutritionalSummaryCache      | State Transition Testing    | REQ-004, REQ-005          | 4         | ⬜     |
| UTP-009-B | MOD-009 NutritionalSummaryCache      | Boundary Value Analysis     | REQ-004, REQ-005          | 3         | ⬜     |
| UTP-010-A | MOD-010 AISuggestionController       | Strict Isolation            | REQ-006                   | 1         | ⬜     |
| UTP-011-A | MOD-011 AISuggestionService          | Statement & Branch Coverage | REQ-006                   | 3         | ⬜     |
| UTP-012-A | MOD-012 AutoGenerateController       | Strict Isolation            | REQ-007                   | 1         | ⬜     |
| UTP-013-A | MOD-013 AutoGenerateService          | Statement & Branch Coverage | REQ-007                   | 2         | ⬜     |
| UTP-013-B | MOD-013 AutoGenerateService          | Strict Isolation            | REQ-007                   | 1         | ⬜     |
| UTP-014-A | MOD-014 WasteOptimizationController  | Strict Isolation            | REQ-008                   | 1         | ⬜     |
| UTP-015-A | MOD-015 WasteOptimizationService     | Statement & Branch Coverage | REQ-008                   | 3         | ⬜     |
| UTP-016-A | MOD-016 RecipeApiAdapter             | Statement & Branch Coverage | REQ-003, REQ-006, REQ-007 | 3         | ⬜     |
| UTP-017-A | MOD-017 UsdaFoodApiAdapter           | Statement & Branch Coverage | REQ-004, REQ-005          | 3         | ⬜     |
| UTP-017-B | MOD-017 UsdaFoodApiAdapter           | State Transition Testing    | REQ-004, REQ-005          | 4         | ⬜     |
| UTP-018-A | MOD-018 AiPromptBuilder              | Statement & Branch Coverage | REQ-006, REQ-007          | 4         | ⬜     |
| UTP-018-B | MOD-018 AiPromptBuilder              | Boundary Value Analysis     | REQ-006, REQ-007          | 3         | ⬜     |
| UTP-019-A | MOD-019 AiProviderAdapter            | Statement & Branch Coverage | REQ-006, REQ-007          | 3         | ⬜     |
| UTP-019-B | MOD-019 AiProviderAdapter            | Boundary Value Analysis     | REQ-006, REQ-007          | 3         | ⬜     |
| UTP-020-A | MOD-020 MealPlanPublicApiAdapter     | Statement & Branch Coverage | REQ-001, REQ-003          | 4         | ⬜     |
| UTP-020-B | MOD-020 MealPlanPublicApiAdapter     | Statement & Branch Coverage | REQ-003                   | 2         | ⬜     |
| UTP-021-A | MOD-021 PremiumTierGuard             | Statement & Branch Coverage | REQ-006, REQ-007, REQ-008 | 3         | ⬜     |
| UTP-021-B | MOD-021 PremiumTierGuard             | Equivalence Partitioning    | REQ-006, REQ-007, REQ-008 | 3         | ⬜     |

---

## Matrix H: Hazard Traceability

> Security and safety hazards linked to requirements and their mitigations. Derived from the multi-user, premium-gated, and AI-integrated nature of the meal planning feature.

| HAZ-ID  | Hazard Description                                                         | Severity | REQ-IDs                | Mitigation                                                                                                           | Verification                                              | Status |
| ------- | -------------------------------------------------------------------------- | -------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------ |
| HAZ-001 | Cross-user meal plan access (IDOR)                                         | Critical | REQ-CN-002             | `findByIdAndUser` always includes `userId` in WHERE clause; 404 returned for non-owned plans                         | AT-006-A (ATS-006-A5), UTP-003-B                          | ⬜     |
| HAZ-002 | Unauthenticated access to meal planning endpoints                          | High     | REQ-IF-003             | Clerk session token required on all endpoints; 401 returned without valid session                                    | AT-006-A (ATS-006-A3)                                     | ⬜     |
| HAZ-003 | Free-tier user bypasses premium gate (AI features)                         | High     | REQ-CN-001             | `PremiumTierGuard` applied to all AI/premium endpoints; 402 returned for free-tier                                   | AT-006-D (ATS-006-D2), UTP-021-A, UTP-021-B               | ⬜     |
| HAZ-004 | Recipe assignment to slot owned by another user                            | High     | REQ-CN-002, REQ-003    | `findSlotByIdAndUser` JOIN enforces plan ownership before upsert; 404 returned                                       | AT-006-B (ATS-006-B3), UTP-005-A, UTP-006-A               | ⬜     |
| HAZ-005 | AI provider returns malformed JSON causing unhandled exception             | Medium   | REQ-006, REQ-007       | `AISuggestionService` catches `ParseException`; `AiProviderAdapter` validates response shape                         | UTP-011-A (UTS-011-A2), UTP-019-A (UTS-019-A3)            | ⬜     |
| HAZ-006 | USDA API outage cascades to nutritional summary failure                    | Medium   | REQ-004, REQ-005       | Circuit breaker in `UsdaFoodApiAdapter` (CLOSED→OPEN→HALF-OPEN); cache serves stale data on miss                     | UTP-017-A, UTP-017-B, UTP-008-B                           | ⬜     |
| HAZ-007 | Redis cache failure causes nutritional summary unavailability              | Low      | REQ-004, REQ-005       | `NutritionalSummaryService` treats `CacheException` as non-fatal; falls back to live USDA compute                    | UTP-008-B (UTS-008-B1, UTS-008-B2)                        | ⬜     |
| HAZ-008 | Meal plan date range exceeds 365 days causing performance degradation      | Medium   | REQ-001, REQ-010       | `MealPlanService.createPlan` rejects `dayCount > 365` with `InvalidDateRangeException`                               | UTP-002-A (UTS-002-A3), UTP-002-B (UTS-002-B3)            | ⬜     |
| HAZ-009 | Slot assigned outside plan date range corrupts plan integrity              | Medium   | REQ-002, REQ-003       | `MealPlanService` validates `slot.dayOffset >= 0` and `< dayCount`; throws `InvalidSlotException`                    | UTP-002-A (UTS-002-A5, UTS-002-A6), AT-006-B (ATS-006-B4) | ⬜     |
| HAZ-010 | Invalid `mealType` enum value stored in database                           | Low      | REQ-002                | `MealPlanService` validates `mealType` against enum {BREAKFAST, LUNCH, DINNER, SNACK}; throws `InvalidSlotException` | UTP-002-A (UTS-002-A7), UTP-002-C                         | ⬜     |
| HAZ-011 | Downstream consumer (007, 009) receives incompatible meal plan API version | Low      | REQ-IF-005, REQ-IF-006 | `MealPlanPublicApiAdapter` version dispatch throws `UnsupportedVersionException` for unknown versions                | UTP-020-A (UTS-020-A3)                                    | ⬜     |
| HAZ-012 | AI prompt injection via user-controlled dietary preferences                | Medium   | REQ-006, REQ-007       | `AiPromptBuilder` serializes preferences as structured data, not raw string interpolation                            | UTP-018-A                                                 | ⬜     |

---

## Coverage Audit

### Functional Requirements Coverage

| Category                                  | Total REQs | REQs with AT | REQs Inspection-Only | REQs with No Coverage                            | Coverage % |
| ----------------------------------------- | ---------- | ------------ | -------------------- | ------------------------------------------------ | ---------- |
| Functional (REQ-001 to REQ-011)           | 11         | 9            | 0                    | 2 (REQ-009 Demonstration, REQ-011 Demonstration) | **82%**    |
| Non-Functional (REQ-NF-001 to REQ-NF-004) | 4          | 0            | 3                    | 1 (REQ-NF-003 Test — no AT defined)              | **75%**    |
| Interface (REQ-IF-001 to REQ-IF-006)      | 6          | 3            | 3                    | 0                                                | **100%**   |
| Constraint (REQ-CN-001 to REQ-CN-002)     | 2          | 2            | 0                    | 0                                                | **100%**   |
| **Total**                                 | **23**     | **14**       | **6**                | **3**                                            | **87%**    |

> Note: "Inspection-Only" requirements are verified by code review and static analysis, not by executable tests. They are fully covered by their stated verification method. REQ-009 and REQ-011 are Demonstration-only and have no executable AT by design.

### Unit Test Coverage

| MOD-ID    | Module                       | UTP Cases | UTS Scenarios | Techniques Applied                                                    |
| --------- | ---------------------------- | --------- | ------------- | --------------------------------------------------------------------- |
| MOD-001   | MealPlanController           | 2         | 5             | Statement & Branch, Strict Isolation                                  |
| MOD-002   | MealPlanService              | 3         | 14            | Statement & Branch, Boundary Value Analysis, Equivalence Partitioning |
| MOD-003   | MealPlanRepository           | 2         | 4             | Statement & Branch, Strict Isolation                                  |
| MOD-004   | RecipeAssignmentController   | 1         | 2             | Strict Isolation                                                      |
| MOD-005   | RecipeAssignmentService      | 2         | 4             | Statement & Branch                                                    |
| MOD-006   | RecipeAssignmentRepository   | 2         | 3             | Statement & Branch, Strict Isolation                                  |
| MOD-007   | NutritionalSummaryController | 1         | 2             | Strict Isolation                                                      |
| MOD-008   | NutritionalSummaryService    | 2         | 4             | Statement & Branch                                                    |
| MOD-009   | NutritionalSummaryCache      | 2         | 7             | State Transition, Boundary Value Analysis                             |
| MOD-010   | AISuggestionController       | 1         | 1             | Strict Isolation                                                      |
| MOD-011   | AISuggestionService          | 1         | 3             | Statement & Branch                                                    |
| MOD-012   | AutoGenerateController       | 1         | 1             | Strict Isolation                                                      |
| MOD-013   | AutoGenerateService          | 2         | 3             | Statement & Branch, Strict Isolation                                  |
| MOD-014   | WasteOptimizationController  | 1         | 1             | Strict Isolation                                                      |
| MOD-015   | WasteOptimizationService     | 1         | 3             | Statement & Branch                                                    |
| MOD-016   | RecipeApiAdapter             | 1         | 3             | Statement & Branch                                                    |
| MOD-017   | UsdaFoodApiAdapter           | 2         | 7             | Statement & Branch, State Transition                                  |
| MOD-018   | AiPromptBuilder              | 2         | 7             | Statement & Branch, Boundary Value Analysis                           |
| MOD-019   | AiProviderAdapter            | 2         | 6             | Statement & Branch, Boundary Value Analysis                           |
| MOD-020   | MealPlanPublicApiAdapter     | 2         | 6             | Statement & Branch                                                    |
| MOD-021   | PremiumTierGuard             | 2         | 6             | Statement & Branch, Equivalence Partitioning                          |
| MOD-022   | QualityComplianceModule      | 0         | 0             | Build-time only — no executable unit tests                            |
| **Total** | —                            | **35**    | **92**        | All 5 ISO 29119-4 techniques represented                              |

### Acceptance Test Coverage

| Tier                                                  | AT Cases       | ATS Scenarios        | Scope                                                    |
| ----------------------------------------------------- | -------------- | -------------------- | -------------------------------------------------------- |
| Functional — Free Tier (AT-006-A through AT-006-C)    | 3 AT cases     | 12 ATS scenarios     | Meal plan CRUD, recipe assignment, nutritional summaries |
| Functional — Premium Tier (AT-006-D through AT-006-F) | 3 AT cases     | 8 ATS scenarios      | AI suggestions, auto-generation, waste optimization      |
| **Total**                                             | **6 AT cases** | **20 ATS scenarios** | Free + Premium tiers                                     |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan ATs** (acceptance tests with no corresponding REQ):

> None identified. All 6 AT cases in `acceptance-plan.md` map to REQ-\* identifiers via the `Requirement` field in each AT section.

**Orphan UTPs** (unit test cases with no corresponding MOD):

> None identified. All 35 UTP cases in `unit-test.md` map to a MOD-NNN identifier via the section header.

**Orphan REQs** (requirements with no verification path):

> None identified. All 23 requirements have at least one verification method (Test, Inspection, or Demonstration).

### Gap Analysis

**Requirements with no executable acceptance test (Inspection/Demonstration only)**:

These requirements are verified by code review, static analysis, or live demonstration — not by executable test scenarios. They are **not gaps** but are flagged for completeness:

| REQ-ID     | Verification Method  | Risk Level | Mitigation                                                                                             |
| ---------- | -------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| REQ-NF-001 | Inspection           | Low        | TypeScript strict mode enforced by CI (`tsc --noEmit`)                                                 |
| REQ-NF-002 | Inspection           | Low        | JSDoc coverage reviewable via linting rules                                                            |
| REQ-NF-003 | Test (no AT defined) | Medium     | Playwright `getByRole`/`getByLabel` assertions needed in E2E test plan                                 |
| REQ-NF-004 | Inspection           | Low        | Color-only state verifiable by accessibility audit and code review                                     |
| REQ-IF-001 | Inspection           | Low        | Recipe API integration verifiable by code review of `RecipeApiAdapter`                                 |
| REQ-IF-005 | Test (no AT defined) | Medium     | Downstream grocery list consumer contract test needed; define AT when feature 007 is implemented       |
| REQ-IF-006 | Test (no AT defined) | Medium     | Downstream nutrition planning consumer contract test needed; define AT when feature 009 is implemented |
| REQ-009    | Demonstration        | Low        | Covered implicitly by AT-006-A (ATS-006-A4); no separate executable test required                      |
| REQ-011    | Demonstration        | Low        | End-to-end timing test; verifiable by manual walkthrough during UAT                                    |

**Modules with no unit test coverage** (implementation gaps):

| Gap                             | Description                       | Risk | Recommendation                                                           |
| ------------------------------- | --------------------------------- | ---- | ------------------------------------------------------------------------ |
| MOD-022 QualityComplianceModule | Build-time only; no runtime logic | None | Verified by CI gate (`tsc --noEmit` + `eslint`); no UTP needed by design |

**Integration test gaps**:

All 14 integration points identified in Matrix C lack defined integration test cases. Integration tests are required to verify cross-module contracts and are not covered by the current unit test plan or acceptance test plan.

**Recommendation**: Create an integration test plan (`integration-test.md`) covering the 14 integration points in Matrix C before implementation begins. Priority order:

1. `MealPlanRepository → PostgreSQL` (row-level security — HAZ-001)
2. `PremiumTierGuard → NestJS ExecutionContext` (premium gate — HAZ-003)
3. `NutritionalSummaryService → UsdaFoodApiAdapter` (circuit breaker — HAZ-006)
4. `AISuggestionService → AiProviderAdapter` (AI response parsing — HAZ-005)
5. Remaining integration points

---

_Traceability matrix generated from source artifacts dated 2026-05-09. Re-baseline required after any requirement change, acceptance plan update, or unit test plan amendment._
