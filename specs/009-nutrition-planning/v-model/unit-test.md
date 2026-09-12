# Unit Test Plan: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the Nutrition Planning feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001

## ISO 29119-4 White-Box Techniques

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

---

## Unit Tests

---

### Module: MOD-001 (NutritionPlanController)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/nutrition-planning/nutrition-plan.controller.ts`

---

#### Test Case: UTP-001-A (createPlan — JWT auth + delegation + response mapping)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies POST /api/v1/nutrition-plans calls ClerkAuthService, delegates to service, returns 201 with response DTO.

**Scenarios:**

**UTS-001-A1** — Valid JWT + valid DTO → 201 with plan

- Arrange: mock ClerkAuthService.verifyToken() → { userId: 'uid-123' }; mock service.createPlan() → { id: 'plan-1', name: 'Keto Plan', dailyCalories: 2000, userId: 'uid-123' }
- Act: result = await controller.createPlan(mockReq, { name: 'Keto Plan', dailyCalories: 2000, macroTargets: { protein: 150, carbs: 50, fat: 120 } })
- Assert: result.status === 201; result.body.plan.id === 'plan-1'
- Mock isolation: ClerkAuthService stubbed; NutritionPlanService stubbed

**UTS-001-A2** — Missing Authorization header → 401 thrown before service call

- Arrange: mock ClerkAuthService.verifyToken() → null
- Act/Assert: controller.createPlan(mockReq, validDto) throws UnauthorizedException; verify service.createPlan NOT called
- Mock isolation: ClerkAuthService stubbed

**UTS-001-A3** — Service throws NotFoundException → 404 propagated

- Arrange: mock ClerkAuthService.verifyToken() → { userId: 'uid' }; mock service.createPlan() → throws new NotFoundException('User not found')
- Act/Assert: controller.createPlan(mockReq, validDto) throws NotFoundException
- Mock isolation: ClerkAuthService stubbed; NutritionPlanService stubbed

---

#### Test Case: UTP-001-B (getPlan + updatePlan — ID validation + authorization)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies getPlan checks UUID format and ownership; updatePlan applies partial updates.

**Scenarios:**

**UTS-001-B1** — Invalid UUID format → BadRequestException on getPlan

- Arrange: id = 'not-a-uuid'; mock ClerkAuthService.verifyToken() → { userId: 'uid' }
- Act/Assert: controller.getPlan(mockReq, 'not-a-uuid') throws BadRequestException; verify service.getPlan NOT called
- Mock isolation: ClerkAuthService stubbed

**UTS-001-B2** — Plan not found → NotFoundException

- Arrange: id = 'valid-uuid'; mock ClerkAuthService.verifyToken() → { userId: 'uid' }; mock service.getPlan() → null
- Act/Assert: controller.getPlan(mockReq, id) throws NotFoundException
- Mock isolation: ClerkAuthService stubbed; NutritionPlanService stubbed

**UTS-001-B3** — updatePlan with partial DTO → service called with partial patch

- Arrange: mock ClerkAuthService.verifyToken() → { userId: 'uid' }; mock service.updatePlan() → updatedPlan
- Act: result = await controller.updatePlan(mockReq, 'valid-uuid', { dailyCalories: 1800 })
- Assert: verify service.updatePlan called with 'valid-uuid', { dailyCalories: 1800 }
- Mock isolation: ClerkAuthService stubbed; NutritionPlanService stubbed

---

### Module: MOD-002 (NutritionPlanService)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/nutrition-planning/nutrition-plan.service.ts`

---

#### Test Case: UTP-002-A (createPlan — validation + repo delegation)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies createPlan validates macro targets (protein+carbs+fat > 0), builds plan entity, and delegates to repository.

**Scenarios:**

**UTS-002-A1** — Valid plan → saved and returned with generated ID

- Arrange: mock repo.create() → { id: 'plan-new', userId: 'uid', name: 'Low Carb', dailyCalories: 1800, macroTargets: { protein: 120, carbs: 80, fat: 100 } }
- Act: result = await service.createPlan('uid', { name: 'Low Carb', dailyCalories: 1800, macroTargets: { protein: 120, carbs: 80, fat: 100 } })
- Assert: result.id === 'plan-new'; result.name === 'Low Carb'
- Mock isolation: NutritionPlanRepository stubbed

**UTS-002-A2** — Negative dailyCalories → ValidationError thrown

- Arrange: input = { name: 'Test', dailyCalories: -100, macroTargets: { protein: 50, carbs: 50, fat: 50 } }
- Act/Assert: service.createPlan('uid', input) throws ValidationError
- Mock isolation: none

**UTS-002-A3** — Macro target sum exceeds dailyCalories warning → plan still created (warning logged)

- Arrange: mock repo.create() → { id: 'plan-1' }; mock logger.warn = jest.fn()
- Act: result = await service.createPlan('uid', { dailyCalories: 1500, macroTargets: { protein: 800, carbs: 800, fat: 800 } }) // sum = 2400 > 1500
- Assert: result !== null; verify logger.warn called once
- Mock isolation: NutritionPlanRepository stubbed; Logger stubbed

---

#### Test Case: UTP-002-B (getPlan — ownership check)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies getPlan retrieves from repo and checks userId ownership; returns null if not found or not owner.

**Scenarios:**

**UTS-002-B1** — Plan found and owned → plan returned

- Arrange: mock repo.findById('plan-1') → { id: 'plan-1', userId: 'uid', name: 'My Plan' }
- Act: result = await service.getPlan('plan-1', 'uid')
- Assert: result !== null; result.name === 'My Plan'
- Mock isolation: NutritionPlanRepository stubbed

**UTS-002-B2** — Plan exists but not owned by user → null returned (not throw)

- Arrange: mock repo.findById('plan-1') → { id: 'plan-1', userId: 'other-user' }
- Act: result = await service.getPlan('plan-1', 'uid')
- Assert: result === null; no exception thrown
- Mock isolation: NutritionPlanRepository stubbed

**UTS-002-B3** — Plan not found → null returned

- Arrange: mock repo.findById('nonexistent') → null
- Act: result = await service.getPlan('nonexistent', 'uid')
- Assert: result === null
- Mock isolation: NutritionPlanRepository stubbed

---

### Module: MOD-003 (NutritionPlanRepository)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/nutrition-planning/nutrition-plan.repository.ts`

---

#### Test Case: UTP-003-A (create + findById + findByUserId — Drizzle ORM)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies CRUD operations against the nutrition_plans table using Drizzle.

**Scenarios:**

**UTS-003-A1** — create → INSERT, returns record with generated ID

- Arrange: mock db.insert().values().returning() → [{ id: 'plan-new', userId: 'uid', name: 'Test', dailyCalories: 2000, createdAt: 'ts' }]
- Act: result = await repo.create({ userId: 'uid', name: 'Test', dailyCalories: 2000 })
- Assert: result.id === 'plan-new'
- Mock isolation: DrizzleDb stubbed

**UTS-003-A2** — findById returns null when not found

- Arrange: mock db.select().from().where().limit(1) → []
- Act: result = await repo.findById('nonexistent')
- Assert: result === null
- Mock isolation: DrizzleDb stubbed

**UTS-003-A3** — findByUserId returns all plans for user

- Arrange: mock db.select().from().where().limit(1) → [] but findByUserId uses cursor-based pagination
- Act: result = await repo.findByUserId('uid', { limit: 20, cursor: null })
- Assert: Array.isArray(result); result.length >= 0
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-004 (DashboardController)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/nutrition-planning/dashboard.controller.ts`

---

#### Test Case: UTP-004-A (getDashboard — aggregate stats + macro progress)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies GET /api/v1/nutrition-plans/dashboard computes today's calories, macro progress percentages, and plan summary.

**Scenarios:**

**UTS-004-A1** — Dashboard with today's logged meals → macro progress returned

- Arrange: mock service.getDashboard() → { totalCaloriesConsumed: 1400, totalCaloriesTarget: 2000, macroProgress: { protein: 60, carbs: 40, fat: 30 }, activePlans: [{ id: 'plan-1', name: 'Keto' }] }
- Act: result = await controller.getDashboard(mockReq)
- Assert: result.status === 200; result.body.totalCaloriesConsumed === 1400; result.body.macroProgress.protein === 60; result.body.activePlans.length === 1
- Mock isolation: NutritionPlanService stubbed

**UTS-004-A2** — No meals logged today → zero consumption shown

- Arrange: mock service.getDashboard() → { totalCaloriesConsumed: 0, totalCaloriesTarget: 2000, macroProgress: { protein: 0, carbs: 0, fat: 0 }, activePlans: [] }
- Act: result = await controller.getDashboard(mockReq)
- Assert: result.status === 200; result.body.totalCaloriesConsumed === 0
- Mock isolation: NutritionPlanService stubbed

---

### Module: MOD-005 (MealPlanLinkerController)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/nutrition-planning/meal-plan-linker.controller.ts`

---

#### Test Case: UTP-005-A (linkMealPlanToRecipe + unlink — authorization + validation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies linking and unlinking of recipe instances to nutrition plans with ownership validation.

**Scenarios:**

**UTS-005-A1** — Link valid recipe to plan → 201 returned

- Arrange: mock service.linkMealPlanToRecipe('plan-1', 'recipe-1', 'uid') → { planId: 'plan-1', recipeId: 'recipe-1' }
- Act: result = await controller.linkMealPlanToRecipe(mockReq, 'plan-1', { recipeId: 'recipe-1' })
- Assert: result.status === 201; verify service.linkMealPlanToRecipe called
- Mock isolation: NutritionPlanService stubbed; ClerkAuthService stubbed

**UTS-005-A2** — Link recipe to another user's plan → 403 Forbidden

- Arrange: mock service.linkMealPlanToRecipe() → throws ForbiddenException
- Act/Assert: controller.linkMealPlanToRecipe(mockReq, 'other-plan', { recipeId: 'recipe-1' }) throws ForbiddenException
- Mock isolation: NutritionPlanService stubbed

---

### Module: MOD-006 (MealPlanLinkerService)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/nutrition-planning/meal-plan-linker.service.ts`

---

#### Test Case: UTP-006-A (linkMealPlanToRecipe + findLinksByPlanId)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies linking persists in meal_plan_links table; findLinksByPlanId returns all linked recipes.

**Scenarios:**

**UTS-006-A1** — Link new recipe → entry created in meal_plan_links

- Arrange: mock repo.findPlanById('plan-1') → { id: 'plan-1', userId: 'uid' }; mock repo.findRecipeById('recipe-1') → { id: 'recipe-1', ownerId: 'uid' }; mock repo.createLink() → { planId: 'plan-1', recipeId: 'recipe-1' }
- Act: result = await service.linkMealPlanToRecipe('plan-1', 'recipe-1', 'uid')
- Assert: result.planId === 'plan-1'; verify repo.createLink called once
- Mock isolation: MealPlanLinkRepository stubbed

**UTS-006-A2** — Plan not found → NotFoundException

- Arrange: mock repo.findPlanById('nonexistent') → null
- Act/Assert: service.linkMealPlanToRecipe('nonexistent', 'recipe-1', 'uid') throws NotFoundException
- Mock isolation: MealPlanLinkRepository stubbed

**UTS-006-A3** — findLinksByPlanId → all linked recipes returned

- Arrange: mock repo.findLinksByPlanId('plan-1') → [{ recipeId: 'r1', recipeTitle: 'Breakfast' }, { recipeId: 'r2', recipeTitle: 'Lunch' }]
- Act: result = await service.findLinksByPlanId('plan-1')
- Assert: result.length === 2; result[0].recipeId === 'r1'
- Mock isolation: MealPlanLinkRepository stubbed

---

### Module: MOD-007 (MealPlanLinkRepository)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/nutrition-planning/meal-plan-link.repository.ts`

---

#### Test Case: UTP-007-A (createLink + findLinksByPlanId + deleteLink)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies meal_plan_links table operations.

**Scenarios:**

**UTS-007-A1** — createLink → INSERT with planId and recipeId, returns link

- Arrange: mock db.insert().values().returning() → [{ planId: 'p1', recipeId: 'r1', linkedAt: 'ts' }]
- Act: result = await repo.createLink({ planId: 'p1', recipeId: 'r1' })
- Assert: result.planId === 'p1'; result.recipeId === 'r1'
- Mock isolation: DrizzleDb stubbed

**UTS-007-A2** — deleteLink → DELETE by planId+recipeId

- Arrange: mock db.delete().where() → { rowCount: 1 }
- Act: result = await repo.deleteLink('p1', 'r1')
- Assert: result.rowCount === 1
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-008 (ComplianceAnalyserService)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/nutrition-planning/compliance-analyser.service.ts`

---

#### Test Case: UTP-008-A (analyzeCompliance — macro comparison + status determination)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies analyzeCompliance compares actual vs target macros and assigns RED/YELLOW/GREEN status per macro.

**Scenarios:**

**UTS-008-A1** — All macros within target (GREEN) → status = 'green' per macro

- Arrange: actual = { protein: 110, carbs: 75, fat: 95 }; targets = { protein: 120, carbs: 80, fat: 100 }; tolerance = 0.15
- Act: result = service.analyzeCompliance(actual, targets, 0.15)
- Assert: result.protein.status === 'green'; result.carbs.status === 'green'; result.fat.status === 'green'
- Mock isolation: none (pure function)

**UTS-008-A2** — Protein exceeds target by >15% (RED); carbs within tolerance (GREEN)

- Arrange: actual = { protein: 150, carbs: 78, fat: 98 }; targets = { protein: 120, carbs: 80, fat: 100 }; tolerance = 0.15
- Act: result = service.analyzeCompliance(actual, targets, 0.15)
- Assert: result.protein.status === 'red'; result.protein.actual === 150; result.protein.target === 120
- Mock isolation: none

**UTS-008-A3** — Carbs within 15% but above target (YELLOW)

- Arrange: actual = { protein: 118, carbs: 88, fat: 100 }; targets = { protein: 120, carbs: 80, fat: 100 }; tolerance = 0.15
- Act: result = service.analyzeCompliance(actual, targets, 0.15)
- Assert: result.carbs.status === 'yellow'; result.carbs.actual === 88; result.carbs.target === 80
- Mock isolation: none

**UTS-008-A4** — Fat below target by 20% (RED)

- Arrange: actual = { protein: 118, carbs: 78, fat: 80 }; targets = { protein: 120, carbs: 80, fat: 100 }; tolerance = 0.15
- Act: result = service.analyzeCompliance(actual, targets, 0.15)
- Assert: result.fat.status === 'red'; result.fat.deviationPercent === -20
- Mock isolation: none

---

### Module: MOD-009 (ComplianceController)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/nutrition-planning/compliance.controller.ts`

---

#### Test Case: UTP-009-A (getCompliance — aggregates logged meals + calls analyser)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies GET /api/v1/nutrition-plans/:id/compliance fetches today's logged items, sums macros, and returns compliance analysis.

**Scenarios:**

**UTS-009-A1** — Plan with logged meals → compliance returned

- Arrange: mock service.getComplianceSummary('plan-1', 'uid') → { protein: { actual: 110, target: 120, status: 'green', deviationPercent: -8 }, carbs: { actual: 78, target: 80, status: 'green', deviationPercent: -2 }, fat: { actual: 95, target: 100, status: 'green', deviationPercent: -5 }, overallStatus: 'green' }
- Act: result = await controller.getCompliance(mockReq, 'plan-1')
- Assert: result.status === 200; result.body.protein.status === 'green'; result.body.overallStatus === 'green'
- Mock isolation: ComplianceAnalyserService stubbed

**UTS-009-A2** — No meals logged today → zero actuals, overall = 'insufficient_data'

- Arrange: mock service.getComplianceSummary() → { protein: { actual: 0, target: 120, status: 'insufficient_data' }, ... }
- Act: result = await controller.getCompliance(mockReq, 'plan-1')
- Assert: result.status === 200; result.body.overallStatus === 'insufficient_data'
- Mock isolation: ComplianceAnalyserService stubbed

---

### Module: MOD-010 (TrainerClientController)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/nutrition-planning/trainer-client.controller.ts`

---

#### Test Case: UTP-010-A (getClientProgress + assignPlanToClient)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies trainer can view client progress and assign nutrition plans to clients.

**Scenarios:**

**UTS-010-A1** — Trainer assigns plan to client → 201 returned

- Arrange: mock service.assignPlanToClient('client-uid', 'plan-1', 'trainer-uid') → { clientId: 'client-uid', planId: 'plan-1' }
- Act: result = await controller.assignPlanToClient(mockReq, { clientId: 'client-uid', planId: 'plan-1' })
- Assert: result.status === 201
- Mock isolation: TrainerClientService stubbed; ClerkAuthService stubbed

**UTS-010-A2** — Unauthorized user (not a trainer) → 403

- Arrange: mock ClerkAuthService.verifyToken() → { userId: 'regular-user', role: 'client' }; mock service.assignPlanToClient() → throws ForbiddenException
- Act/Assert: controller.assignPlanToClient(mockReq, { clientId: 'client-uid', planId: 'plan-1' }) throws ForbiddenException
- Mock isolation: ClerkAuthService stubbed; TrainerClientService stubbed

---

### Module: MOD-011 (TrainerClientService)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/nutrition-planning/trainer-client.service.ts`

---

#### Test Case: UTP-011-A (assignPlanToClient + getClientProgress)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies plan assignment persists trainer-client relationship; getClientProgress returns aggregated compliance history.

**Scenarios:**

**UTS-011-A1** — Assign plan → stored in trainer_clients table

- Arrange: mock consentRepo.findConsent('client-uid', 'trainer-uid') → { granted: true }; mock planRepo.findById('plan-1') → { id: 'plan-1' }; mock repo.upsertClientPlan() → saved
- Act: result = await service.assignPlanToClient('client-uid', 'plan-1', 'trainer-uid')
- Assert: result.planId === 'plan-1'; verify consentRepo called first (consent check)
- Mock isolation: ConsentRepository stubbed; NutritionPlanRepository stubbed

**UTS-011-A2** — Client has not granted consent to trainer → ForbiddenError

- Arrange: mock consentRepo.findConsent('client-uid', 'trainer-uid') → { granted: false }
- Act/Assert: service.assignPlanToClient('client-uid', 'plan-1', 'trainer-uid') throws ForbiddenError
- Mock isolation: ConsentRepository stubbed

**UTS-011-A3** — getClientProgress returns aggregated compliance scores

- Arrange: mock repo.findClientPlanAssignments() → [{ planId: 'plan-1' }]; mock complianceService.getComplianceSummary() → { overallStatus: 'green' }
- Act: result = await service.getClientProgress('client-uid', 'trainer-uid')
- Assert: result.complianceHistory.length >= 0; result.clientId === 'client-uid'
- Mock isolation: TrainerClientRepository stubbed; ComplianceAnalyserService stubbed

---

### Module: MOD-012 (ConsentRepository)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/nutrition-planning/consent.repository.ts`

---

#### Test Case: UTP-012-A (findConsent + grantConsent + revokeConsent)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies consent records are stored and queried correctly.

**Scenarios:**

**UTS-012-A1** — findConsent with valid consent → returned

- Arrange: mock db.select().from().where().limit(1) → [{ trainerUserId: 'trainer-1', clientUserId: 'client-1', granted: true, grantedAt: 'ts' }]
- Act: result = await repo.findConsent('client-1', 'trainer-1')
- Assert: result.granted === true
- Mock isolation: DrizzleDb stubbed

**UTS-012-A2** — No consent found → null returned

- Arrange: mock db.select().from().where().limit(1) → []
- Act: result = await repo.findConsent('client-1', 'unknown-trainer')
- Assert: result === null
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-013 (AIRecipeSwapController)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/nutrition-planning/ai-recipe-swap.controller.ts`

---

#### Test Case: UTP-013-A (getSwapRecommendations — token validation + service delegation)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies POST /api/v1/nutrition-plans/:id/swap-recommendations calls AI service to suggest compliant recipe swaps.

**Scenarios:**

**UTS-013-A1** — Valid request → 200 with swap recommendations

- Arrange: mock aiService.getSwapRecommendations('plan-1', 'uid') → { swaps: [{ originalRecipeId: 'r1', suggestedRecipeId: 'r2', reason: 'Lower carbs' }] }
- Act: result = await controller.getSwapRecommendations(mockReq, 'plan-1')
- Assert: result.status === 200; result.body.swaps.length === 1
- Mock isolation: AIRecipeSwapService stubbed; ClerkAuthService stubbed

**UTS-013-A2** — Plan not found → 404

- Arrange: mock aiService.getSwapRecommendations() → throws NotFoundException
- Act/Assert: controller.getSwapRecommendations(mockReq, 'nonexistent-plan') throws NotFoundException
- Mock isolation: AIRecipeSwapService stubbed

---

### Module: MOD-014 (AIRecipeSwapService)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `src/nutrition-planning/ai-recipe-swap.service.ts`

---

#### Test Case: UTP-014-A (getSwapRecommendations — compliance check + AI dispatch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies getSwapRecommendations checks compliance to identify deficient macros, builds swap criteria, and dispatches to AI adapter.

**Scenarios:**

**UTS-014-A1** — Protein deficient → AI suggests high-protein swap

- Arrange: mock complianceAnalyser.analyzeCompliance() → { protein: { status: 'red' }, carbs: { status: 'green' }, fat: { status: 'green' } }; mock aiProviderAdapter.dispatch() → { suggestedRecipeId: 'high-protein-recipe', reason: '25% more protein' }
- Act: result = await service.getSwapRecommendations('plan-1', 'uid')
- Assert: result.swaps[0].reason.toLowerCase().includes('protein'); verify aiProviderAdapter.dispatch called
- Mock isolation: ComplianceAnalyserService stubbed; AIProviderAdapter stubbed

**UTS-014-A2** — All macros within target → no swaps returned (no deficiency)

- Arrange: mock complianceAnalyser.analyzeCompliance() → { protein: { status: 'green' }, carbs: { status: 'green' }, fat: { status: 'green' } }
- Act: result = await service.getSwapRecommendations('plan-1', 'uid')
- Assert: result.swaps.length === 0; verify aiProviderAdapter.dispatch NOT called
- Mock isolation: ComplianceAnalyserService stubbed

---

### Module: MOD-015 (MealPlanningAdapter)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `src/nutrition-planning/adapters/meal-planning.adapter.ts`

---

#### Test Case: UTP-015-A (adaptMealPlanEntity + adaptRecipeToMealPlan)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Internal Data Structures View
**Description**: Verifies entity-to-DTO mapping and recipe-to-meal-plan adaptation.

**Scenarios:**

**UTS-015-A1** — adaptMealPlanEntity maps all fields correctly

- Arrange: entity = { id: 'p1', name: 'Keto', dailyCalories: 2000, macroTargets: { protein: 150, carbs: 50, fat: 120 }, userId: 'uid', createdAt: new Date('2026-01-01') }
- Act: dto = adapter.adaptMealPlanEntity(entity)
- Assert: dto.id === 'p1'; dto.name === 'Keto'; dto.macroTargets.protein === 150; dto.dailyCalories === 2000
- Mock isolation: none (pure mapper)

**UTS-015-A2** — adaptRecipeToMealPlan maps recipe to meal plan entry

- Arrange: recipe = { id: 'r1', title: 'Chicken Salad', ingredients: ['chicken'], instructions: ['mix'], estimatedCalories: 350 }
- Act: entry = adapter.adaptRecipeToMealPlan(recipe, 'lunch', '2026-05-09')
- Assert: entry.recipeId === 'r1'; entry.mealType === 'lunch'; entry.scheduledDate === '2026-05-09'
- Mock isolation: none

---

### Module: MOD-016 (USDAFoodDataAdapter)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `src/nutrition-planning/adapters/usda-food-data.adapter.ts`

---

#### Test Case: UTP-016-A (searchUSDAFoods + getFoodItemByNdbNo)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies USDA FoodData Central API search and item retrieval.

**Scenarios:**

**UTS-016-A1** — searchUSDAFoods returns formatted results

- Arrange: mock httpClient.get() → { foods: [{ foodName: 'Chicken breast', nutrients: [{ nutrientId: 1003, value: 31 }] }] }
- Act: result = await adapter.searchUSDAFoods('chicken breast', 25)
- Assert: result[0].foodName === 'Chicken breast'; result[0].calories !== undefined
- Mock isolation: HttpClient stubbed

**UTS-016-A2** — getFoodItemByNdbNo returns detailed nutrient breakdown

- Arrange: mock httpClient.get() → { foods: [{ foodName: 'Egg', nutrients: [{ nutrientId: 1003, value: 6 }] }] }
- Act: result = await adapter.getFoodItemByNdbNo('00001')
- Assert: result !== null; result.foodName === 'Egg'
- Mock isolation: HttpClient stubbed

---

### Module: MOD-017 (RecipeAppAdapter)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `src/nutrition-planning/adapters/recipe-app.adapter.ts`

---

#### Test Case: UTP-017-A (fetchRecipeById + fetchRecipesByIngredient)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies recipe fetching from the Recipe App (001-commise-recipe-app) via internal API calls.

**Scenarios:**

**UTS-017-A1** — fetchRecipeById returns recipe with estimated nutrition

- Arrange: mock internalHttpClient.get() → { id: 'r1', title: 'Caesar Salad', estimatedCalories: 450, ingredients: ['romaine'] }
- Act: result = await adapter.fetchRecipeById('r1', 'uid')
- Assert: result.id === 'r1'; result.estimatedCalories === 450
- Mock isolation: InternalHttpClient stubbed

**UTS-017-A2** — fetchRecipesByIngredient returns matching recipes

- Arrange: mock internalHttpClient.get() → [{ id: 'r2', title: 'Chicken Soup', estimatedCalories: 300 }]
- Act: result = await adapter.fetchRecipesByIngredient('chicken', 'uid')
- Assert: result.length >= 1; result[0].title.includes('chicken')
- Mock isolation: InternalHttpClient stubbed

---

### Module: MOD-018 (ClerkAuthService)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `src/nutrition-planning/adapters/clerkAuth.service.ts`

---

#### Test Case: UTP-018-A (verifyToken + extractUserId)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies networkless Clerk session-token verification via `@clerk/backend` `verifyToken` (public `CLERK_JWT_KEY` + `azp` enforcement) and user ID extraction from the token payload.

**Scenarios:**

**UTS-018-A1** — Valid JWT → user object extracted

- Arrange: mock @clerk/backend verifyToken() → { sub: 'user-123', email: 'test@example.com', public_metadata: {} }
- Act: result = await clerkAuthService.verifyToken('valid-token')
- Assert: result.userId === 'user-123'; result.email === 'test@example.com'
- Mock isolation: @clerk/backend verifyToken stubbed

**UTS-018-A2** — Missing auth header → null returned

- Arrange: header = undefined
- Act: result = await clerkAuthService.verifyToken(undefined)
- Assert: result === null
- Mock isolation: none

**UTS-018-A3** — Invalid JWT → Error thrown

- Arrange: mock @clerk/backend verifyToken() → throws Error('Invalid signature')
- Act/Assert: clerkAuthService.verifyToken('bad-token') throws Error
- Mock isolation: @clerk/backend verifyToken stubbed

---

### Module: MOD-019 (SubscriptionGate) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `src/shared/middleware/subscription-gate.ts` [CROSS-CUTTING]

No unit tests — subscription status check cross-cutting utility. Covered by integration tests.

---

### Module: MOD-020 (TypeSafetyAndDocsEnforcer) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-020
**Target Source File(s)**: `src/shared/middleware/type-safety.ts` [CROSS-CUTTING]

No unit tests — compile-time TypeScript and OpenAPI doc enforcement. Build step verifies compliance.

---

## ARCH↔MOD↔UTP Traceability

| MOD ID  | MOD Name                  | UTP Count       | UTS Count        |
| ------- | ------------------------- | --------------- | ---------------- |
| MOD-001 | NutritionPlanController   | 2 (A, B)        | 6 (A1-A3, B1-B3) |
| MOD-002 | NutritionPlanService      | 2 (A, B)        | 6 (A1-A3, B1-B3) |
| MOD-003 | NutritionPlanRepository   | 1 (A)           | 3 (A1-A3)        |
| MOD-004 | DashboardController       | 1 (A)           | 2 (A1-A2)        |
| MOD-005 | MealPlanLinkerController  | 1 (A)           | 2 (A1-A2)        |
| MOD-006 | MealPlanLinkerService     | 1 (A)           | 3 (A1-A3)        |
| MOD-007 | MealPlanLinkRepository    | 1 (A)           | 2 (A1-A2)        |
| MOD-008 | ComplianceAnalyserService | 1 (A)           | 4 (A1-A4)        |
| MOD-009 | ComplianceController      | 1 (A)           | 2 (A1-A2)        |
| MOD-010 | TrainerClientController   | 1 (A)           | 2 (A1-A2)        |
| MOD-011 | TrainerClientService      | 1 (A)           | 3 (A1-A3)        |
| MOD-012 | ConsentRepository         | 1 (A)           | 2 (A1-A2)        |
| MOD-013 | AIRecipeSwapController    | 1 (A)           | 2 (A1-A2)        |
| MOD-014 | AIRecipeSwapService       | 1 (A)           | 2 (A1-A2)        |
| MOD-015 | MealPlanningAdapter       | 1 (A)           | 2 (A1-A2)        |
| MOD-016 | USDAFoodDataAdapter       | 1 (A)           | 2 (A1-A2)        |
| MOD-017 | RecipeAppAdapter          | 1 (A)           | 2 (A1-A2)        |
| MOD-018 | ClerkAuthService          | 1 (A)           | 3 (A1-A3)        |
| MOD-019 | SubscriptionGate          | [CROSS-CUTTING] | —                |
| MOD-020 | TypeSafetyAndDocsEnforcer | [CROSS-CUTTING] | —                |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.

## Coverage Completion Unit Tests

### Module: MOD-019 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-019.

#### Test Case: UTP-019-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-019 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-019-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-019
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-019-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-019
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-020 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-020.

#### Test Case: UTP-020-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-020 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-020-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-020
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-020-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-020
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
