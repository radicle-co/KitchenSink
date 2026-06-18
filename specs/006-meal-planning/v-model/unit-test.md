# Unit Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/006-meal-planning/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the Meal Planning feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

MOD-022 is `[CROSS-CUTTING]` and build-time only; it has no runtime logic and is excluded from executable unit test cases (noted in its section).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor, consult the "Parent Architecture Modules" field in `module-design.md`.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

## Unit Tests

---

### MOD-001: MealPlanController

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/meal-planning/controllers/meal-plan.controller.ts`

---

#### UTP-001-A — Branch Coverage: getMealPlan null-check

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF result IS NULL → THROW NotFoundException` branch in `getMealPlan`

| Scenario | ID         | Description                                                  |
| -------- | ---------- | ------------------------------------------------------------ |
| 1        | UTS-001-A1 | Service returns a plan → controller returns it (true branch) |
| 2        | UTS-001-A2 | Service returns null → controller throws NotFoundException   |

**UTS-001-A1**

```
Arrange:
  mealPlanService = mock({ getPlan: async () => ({ id: 'plan-1', name: 'Week 1' }) })
  controller = new MealPlanController(mealPlanService)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.getMealPlan('plan-1', authContext)
Assert:
  result.id === 'plan-1'
  mealPlanService.getPlan called once with ('plan-1', 'user-1')
```

**UTS-001-A2**

```
Arrange:
  mealPlanService = mock({ getPlan: async () => null })
  controller = new MealPlanController(mealPlanService)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  call = () => controller.getMealPlan('plan-1', authContext)
Assert:
  call() rejects with NotFoundException
  error.message === 'Plan not found'
```

---

#### UTP-001-B — Strict Isolation: all handler methods delegate to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: `createMealPlan`, `updateMealPlan`, `deleteMealPlan` — no business logic in controller

| Scenario | ID         | Description                                            |
| -------- | ---------- | ------------------------------------------------------ |
| 1        | UTS-001-B1 | createMealPlan delegates to mealPlanService.createPlan |
| 2        | UTS-001-B2 | updateMealPlan delegates to mealPlanService.updatePlan |
| 3        | UTS-001-B3 | deleteMealPlan delegates to mealPlanService.deletePlan |

**UTS-001-B1**

```
Arrange:
  mealPlanService = mock({ createPlan: async () => ({ id: 'plan-1' }) })
  controller = new MealPlanController(mealPlanService)
  body = { name: 'Week 1', startDate: '2026-06-01', endDate: '2026-06-07', slots: [] }
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.createMealPlan(body, authContext)
Assert:
  mealPlanService.createPlan called once with (body, 'user-1')
  result.id === 'plan-1'
```

**UTS-001-B2**

```
Arrange:
  mealPlanService = mock({ updatePlan: async () => ({ id: 'plan-1', name: 'Updated' }) })
  controller = new MealPlanController(mealPlanService)
  body = { name: 'Updated' }
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.updateMealPlan('plan-1', body, authContext)
Assert:
  mealPlanService.updatePlan called once with ('plan-1', body, 'user-1')
  result.name === 'Updated'
```

**UTS-001-B3**

```
Arrange:
  mealPlanService = mock({ deletePlan: async () => undefined })
  controller = new MealPlanController(mealPlanService)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  await controller.deleteMealPlan('plan-1', authContext)
Assert:
  mealPlanService.deletePlan called once with ('plan-1', 'user-1')
```

---

### MOD-002: MealPlanService

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/meal-planning/services/meal-plan.service.ts`

---

#### UTP-002-A — Branch Coverage: createPlan date-range and slot validation

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF endDate <= startDate`, `IF dayCount > 365`, slot dayOffset/mealType validation branches

| Scenario | ID         | Description                                                      |
| -------- | ---------- | ---------------------------------------------------------------- |
| 1        | UTS-002-A1 | endDate == startDate → throws InvalidDateRangeException          |
| 2        | UTS-002-A2 | endDate < startDate → throws InvalidDateRangeException           |
| 3        | UTS-002-A3 | dayCount == 366 → throws InvalidDateRangeException (exceeds 365) |
| 4        | UTS-002-A4 | dayCount == 365 → succeeds (boundary pass)                       |
| 5        | UTS-002-A5 | slot.dayOffset < 0 → throws InvalidSlotException                 |
| 6        | UTS-002-A6 | slot.dayOffset >= dayCount → throws InvalidSlotException         |
| 7        | UTS-002-A7 | slot.mealType not in enum → throws InvalidSlotException          |
| 8        | UTS-002-A8 | valid dto → calls repository.insert and returns plan             |

**UTS-002-A1**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-01', slots: [] }
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidDateRangeException
  repo.insert not called
```

**UTS-002-A2**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-07', endDate: '2026-06-01', slots: [] }
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidDateRangeException
```

**UTS-002-A3**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-01-01', endDate: '2027-01-02', slots: [] }  // 366 days
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidDateRangeException('Plan may not exceed 365 days')
```

**UTS-002-A4**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-01-01', endDate: '2027-01-01', slots: [] }  // exactly 365 days
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once
  result.id === 'plan-1'
```

**UTS-002-A5**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: -1, mealType: 'BREAKFAST' }] }
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidSlotException('dayOffset out of range')
```

**UTS-002-A6**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 7, mealType: 'BREAKFAST' }] }
  // dayCount = 7, valid offsets 0..6
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidSlotException('dayOffset out of range')
```

**UTS-002-A7**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 0, mealType: 'BRUNCH' }] }
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidSlotException('Unknown mealType')
```

**UTS-002-A8**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1', name: 'Week 1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 0, mealType: 'BREAKFAST' }] }
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once with object containing { userId: 'user-1' }
  result.id === 'plan-1'
```

---

#### UTP-002-B — Boundary Value Analysis: dayCount boundary

**Technique**: Boundary Value Analysis
**Source View**: Internal Data Structures
**Covers**: `dayCount` scalar boundary at 365 (max valid)

| Scenario | ID         | Description                             |
| -------- | ---------- | --------------------------------------- |
| 1        | UTS-002-B1 | dayCount = 364 → succeeds               |
| 2        | UTS-002-B2 | dayCount = 365 → succeeds (max valid)   |
| 3        | UTS-002-B3 | dayCount = 366 → throws (max+1 invalid) |

**UTS-002-B1**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-01-01', endDate: '2026-12-31', slots: [] }  // 364 days
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once
```

**UTS-002-B2**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-01-01', endDate: '2027-01-01', slots: [] }  // 365 days
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once
```

**UTS-002-B3**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-01-01', endDate: '2027-01-02', slots: [] }  // 366 days
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidDateRangeException
  repo.insert not called
```

---

#### UTP-002-C — Equivalence Partitioning: mealType enum

**Technique**: Equivalence Partitioning
**Source View**: Internal Data Structures
**Covers**: `mealType` enum {BREAKFAST, LUNCH, DINNER, SNACK} vs invalid values

| Scenario | ID         | Description                              |
| -------- | ---------- | ---------------------------------------- |
| 1        | UTS-002-C1 | mealType = 'BREAKFAST' → valid partition |
| 2        | UTS-002-C2 | mealType = 'SNACK' → valid partition     |
| 3        | UTS-002-C3 | mealType = 'BRUNCH' → invalid partition  |

**UTS-002-C1**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 0, mealType: 'BREAKFAST' }] }
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once
```

**UTS-002-C2**

```
Arrange:
  repo = mock({ insert: async () => ({ id: 'plan-1' }) })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 0, mealType: 'SNACK' }] }
Act:
  result = await service.createPlan(dto, 'user-1')
Assert:
  repo.insert called once
```

**UTS-002-C3**

```
Arrange:
  repo = mock({ insert: jest.fn() })
  service = new MealPlanService(repo)
  dto = { startDate: '2026-06-01', endDate: '2026-06-08', slots: [{ dayOffset: 0, mealType: 'BRUNCH' }] }
Act:
  call = () => service.createPlan(dto, 'user-1')
Assert:
  call() rejects with InvalidSlotException
```

---

### MOD-003: MealPlanRepository

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/meal-planning/repositories/meal-plan.repository.ts`

---

#### UTP-003-A — Branch Coverage: insert slot bulk path

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF data.slots.length > 0` branch in `insert`

| Scenario | ID         | Description                                |
| -------- | ---------- | ------------------------------------------ |
| 1        | UTS-003-A1 | slots array empty → bulk insert NOT called |
| 2        | UTS-003-A2 | slots array non-empty → bulk insert called |

**UTS-003-A1**

```
Arrange:
  db = mock with insert chain returning [{ id: 'plan-1' }] for mealPlansTable
  repo = new MealPlanRepository(db)
  data = { userId: 'user-1', name: 'Week 1', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-08'), slots: [] }
Act:
  result = await repo.insert(data)
Assert:
  db.insert called once (mealPlansTable only)
  result.id === 'plan-1'
```

**UTS-003-A2**

```
Arrange:
  db = mock with two insert calls: first returns plan row, second returns slot rows
  repo = new MealPlanRepository(db)
  data = { userId: 'user-1', name: 'Week 1', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-08'), slots: [{ dayOffset: 0, mealType: 'BREAKFAST' }] }
Act:
  result = await repo.insert(data)
Assert:
  db.insert called twice (mealPlansTable + mealSlotsTable)
  result.id defined
```

---

#### UTP-003-B — Strict Isolation: findByIdAndUser enforces userId filter

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: Row-level security — userId always included in WHERE clause

| Scenario | ID         | Description                                    |
| -------- | ---------- | ---------------------------------------------- |
| 1        | UTS-003-B1 | Query includes both planId and userId in WHERE |
| 2        | UTS-003-B2 | No matching row → returns null                 |

**UTS-003-B1**

```
Arrange:
  db = mock that captures WHERE predicates; returns [{ id: 'plan-1', userId: 'user-1' }]
  repo = new MealPlanRepository(db)
Act:
  result = await repo.findByIdAndUser('plan-1', 'user-1')
Assert:
  WHERE clause contains eq(mealPlansTable.id, 'plan-1') AND eq(mealPlansTable.userId, 'user-1')
  result.id === 'plan-1'
```

**UTS-003-B2**

```
Arrange:
  db = mock that returns []
  repo = new MealPlanRepository(db)
Act:
  result = await repo.findByIdAndUser('plan-999', 'user-1')
Assert:
  result === null
```

---

### MOD-004: RecipeAssignmentController

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/meal-planning/controllers/recipe-assignment.controller.ts`

---

#### UTP-004-A — Strict Isolation: all handlers delegate to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: Controller contains no business logic; all calls forwarded to RecipeAssignmentService

| Scenario | ID         | Description                                            |
| -------- | ---------- | ------------------------------------------------------ |
| 1        | UTS-004-A1 | assignRecipe delegates to service.assignRecipe         |
| 2        | UTS-004-A2 | removeAssignment delegates to service.removeAssignment |

**UTS-004-A1**

```
Arrange:
  service = mock({ assignRecipe: async () => ({ slotId: 'slot-1', recipeId: 'recipe-1' }) })
  controller = new RecipeAssignmentController(service)
  body = { recipeId: 'recipe-1' }
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.assignRecipe('slot-1', body, authContext)
Assert:
  service.assignRecipe called once with ('slot-1', 'recipe-1', 'user-1')
  result.slotId === 'slot-1'
```

**UTS-004-A2**

```
Arrange:
  service = mock({ removeAssignment: async () => undefined })
  controller = new RecipeAssignmentController(service)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  await controller.removeAssignment('slot-1', authContext)
Assert:
  service.removeAssignment called once with ('slot-1', 'user-1')
```

---

### MOD-005: RecipeAssignmentService

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/meal-planning/services/recipe-assignment.service.ts`

---

#### UTP-005-A — Branch Coverage: assignRecipe ownership check

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF slot IS NULL → throw SlotNotFoundException`

| Scenario | ID         | Description                                            |
| -------- | ---------- | ------------------------------------------------------ |
| 1        | UTS-005-A1 | Slot not found for user → throws SlotNotFoundException |
| 2        | UTS-005-A2 | Slot found → calls upsertAssignment and returns result |

**UTS-005-A1**

```
Arrange:
  repo = mock({ findSlotByIdAndUser: async () => null, upsertAssignment: jest.fn() })
  service = new RecipeAssignmentService(repo)
Act:
  call = () => service.assignRecipe('slot-1', 'recipe-1', 'user-1')
Assert:
  call() rejects with SlotNotFoundException
  repo.upsertAssignment not called
```

**UTS-005-A2**

```
Arrange:
  repo = mock({ findSlotByIdAndUser: async () => ({ id: 'slot-1' }), upsertAssignment: async () => ({ slotId: 'slot-1', recipeId: 'recipe-1' }) })
  service = new RecipeAssignmentService(repo)
Act:
  result = await service.assignRecipe('slot-1', 'recipe-1', 'user-1')
Assert:
  repo.upsertAssignment called once with ('slot-1', 'recipe-1')
  result.recipeId === 'recipe-1'
```

---

#### UTP-005-B — Branch Coverage: removeAssignment ownership check

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF slot IS NULL → throw SlotNotFoundException` in removeAssignment

| Scenario | ID         | Description                                   |
| -------- | ---------- | --------------------------------------------- |
| 1        | UTS-005-B1 | Slot not found → throws SlotNotFoundException |
| 2        | UTS-005-B2 | Slot found → calls deleteAssignment           |

**UTS-005-B1**

```
Arrange:
  repo = mock({ findSlotByIdAndUser: async () => null, deleteAssignment: jest.fn() })
  service = new RecipeAssignmentService(repo)
Act:
  call = () => service.removeAssignment('slot-1', 'user-1')
Assert:
  call() rejects with SlotNotFoundException
  repo.deleteAssignment not called
```

**UTS-005-B2**

```
Arrange:
  repo = mock({ findSlotByIdAndUser: async () => ({ id: 'slot-1' }), deleteAssignment: async () => undefined })
  service = new RecipeAssignmentService(repo)
Act:
  await service.removeAssignment('slot-1', 'user-1')
Assert:
  repo.deleteAssignment called once with ('slot-1')
```

---

### MOD-006: RecipeAssignmentRepository

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/meal-planning/repositories/recipe-assignment.repository.ts`

---

#### UTP-006-A — Branch Coverage: findSlotByIdAndUser join result

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: JOIN on mealPlansTable to enforce ownership; null return when no row

| Scenario | ID         | Description                            |
| -------- | ---------- | -------------------------------------- |
| 1        | UTS-006-A1 | Row found → returns meal_slots portion |
| 2        | UTS-006-A2 | No row → returns null                  |

**UTS-006-A1**

```
Arrange:
  db = mock returning [{ meal_slots: { id: 'slot-1', planId: 'plan-1' } }]
  repo = new RecipeAssignmentRepository(db)
Act:
  result = await repo.findSlotByIdAndUser('slot-1', 'user-1')
Assert:
  result.id === 'slot-1'
```

**UTS-006-A2**

```
Arrange:
  db = mock returning []
  repo = new RecipeAssignmentRepository(db)
Act:
  result = await repo.findSlotByIdAndUser('slot-999', 'user-1')
Assert:
  result === null
```

---

#### UTP-006-B — Strict Isolation: upsertAssignment uses ON CONFLICT DO UPDATE

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: Upsert semantics — existing assignment is replaced, not duplicated

| Scenario | ID         | Description                                                  |
| -------- | ---------- | ------------------------------------------------------------ |
| 1        | UTS-006-B1 | upsertAssignment calls onConflictDoUpdate with slotId target |

**UTS-006-B1**

```
Arrange:
  db = mock that captures insert chain; returning returns [{ slotId: 'slot-1', recipeId: 'recipe-2' }]
  repo = new RecipeAssignmentRepository(db)
Act:
  result = await repo.upsertAssignment('slot-1', 'recipe-2')
Assert:
  onConflictDoUpdate called with { target: recipeAssignmentsTable.slotId, set: { recipeId: 'recipe-2' } }
  result.recipeId === 'recipe-2'
```

---

### MOD-007: NutritionalSummaryController

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/meal-planning/controllers/nutritional-summary.controller.ts`

---

#### UTP-007-A — Strict Isolation: handlers delegate to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: getDailySummary and getWeeklySummary contain no logic; pure delegation

| Scenario | ID         | Description                                            |
| -------- | ---------- | ------------------------------------------------------ |
| 1        | UTS-007-A1 | getDailySummary delegates to service.getDailySummary   |
| 2        | UTS-007-A2 | getWeeklySummary delegates to service.getWeeklySummary |

**UTS-007-A1**

```
Arrange:
  service = mock({ getDailySummary: async () => ({ calories: 2000 }) })
  controller = new NutritionalSummaryController(service)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.getDailySummary('plan-1', authContext)
Assert:
  service.getDailySummary called once with ('plan-1', 'user-1')
  result.calories === 2000
```

**UTS-007-A2**

```
Arrange:
  service = mock({ getWeeklySummary: async () => ({ calories: 14000 }) })
  controller = new NutritionalSummaryController(service)
  authContext = { userId: 'user-1', tier: 'free' }
Act:
  result = await controller.getWeeklySummary('plan-1', authContext)
Assert:
  service.getWeeklySummary called once with ('plan-1', 'user-1')
  result.calories === 14000
```

---

### MOD-008: NutritionalSummaryService

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/meal-planning/services/nutritional-summary.service.ts`

---

#### UTP-008-A — Branch Coverage: cache hit vs miss

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF cached IS NOT NULL → return cached` vs compute path

| Scenario | ID         | Description                                                   |
| -------- | ---------- | ------------------------------------------------------------- |
| 1        | UTS-008-A1 | Cache hit → returns cached value without calling USDA adapter |
| 2        | UTS-008-A2 | Cache miss → computes summary and stores in cache             |

**UTS-008-A1**

```
Arrange:
  cache = mock({ get: async () => ({ calories: 1800 }), set: jest.fn() })
  usdaAdapter = mock({ fetchNutrition: jest.fn() })
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [] }) })
  service = new NutritionalSummaryService(repo, usdaAdapter, cache)
Act:
  result = await service.getDailySummary('plan-1', 'user-1')
Assert:
  cache.get called once
  usdaAdapter.fetchNutrition not called
  result.calories === 1800
```

**UTS-008-A2**

```
Arrange:
  cache = mock({ get: async () => null, set: jest.fn() })
  usdaAdapter = mock({ fetchNutrition: async () => ({ calories: 500, protein: 30 }) })
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [{ assignment: { recipeId: 'r-1' } }] }) })
  recipeAdapter = mock({ fetchRecipe: async () => ({ ingredients: [{ fdcId: 'fdc-1', quantity: 100 }] }) })
  service = new NutritionalSummaryService(repo, usdaAdapter, cache, recipeAdapter)
Act:
  result = await service.getDailySummary('plan-1', 'user-1')
Assert:
  usdaAdapter.fetchNutrition called
  cache.set called once with computed summary
  result.calories > 0
```

---

#### UTP-008-B — Branch Coverage: cache failure is non-fatal

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `CacheException (non-fatal)` — service continues when cache throws

| Scenario | ID         | Description                                                     |
| -------- | ---------- | --------------------------------------------------------------- |
| 1        | UTS-008-B1 | cache.get throws CacheException → service computes live         |
| 2        | UTS-008-B2 | cache.set throws CacheException → service returns result anyway |

**UTS-008-B1**

```
Arrange:
  cache = mock({ get: async () => { throw new CacheException('Redis down') }, set: jest.fn() })
  usdaAdapter = mock({ fetchNutrition: async () => ({ calories: 500 }) })
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [] }) })
  service = new NutritionalSummaryService(repo, usdaAdapter, cache)
Act:
  result = await service.getDailySummary('plan-1', 'user-1')
Assert:
  result defined (no exception propagated)
  usdaAdapter.fetchNutrition called (fallback to live compute)
```

**UTS-008-B2**

```
Arrange:
  cache = mock({ get: async () => null, set: async () => { throw new CacheException('Redis down') } })
  usdaAdapter = mock({ fetchNutrition: async () => ({ calories: 500 }) })
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [] }) })
  service = new NutritionalSummaryService(repo, usdaAdapter, cache)
Act:
  result = await service.getDailySummary('plan-1', 'user-1')
Assert:
  result defined (cache.set failure does not propagate)
```

---

### MOD-009: NutritionalSummaryCache

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/meal-planning/cache/nutritional-summary.cache.ts`

---

#### UTP-009-A — State Transition Testing: Empty ↔ Populated

**Technique**: State Transition Testing
**Source View**: State Machine View
**Covers**: Empty→Populated (set), Populated→Empty (invalidate), Populated→Populated (get hit), Empty→Empty (get miss)

| Scenario | ID         | Description                                                |
| -------- | ---------- | ---------------------------------------------------------- |
| 1        | UTS-009-A1 | Empty + get(key) → returns null (Empty→Empty)              |
| 2        | UTS-009-A2 | Empty + set(key, value, ttl) → Populated (Empty→Populated) |
| 3        | UTS-009-A3 | Populated + get(key) → returns value (Populated→Populated) |
| 4        | UTS-009-A4 | Populated + invalidate(planId) → Empty (Populated→Empty)   |

**UTS-009-A1**

```
Arrange:
  redis = mock({ get: async () => null })
  cache = new NutritionalSummaryCache(redis)
Act:
  result = await cache.get('nutrition:plan-1:daily')
Assert:
  result === null
  redis.get called once with 'nutrition:plan-1:daily'
```

**UTS-009-A2**

```
Arrange:
  redis = mock({ set: jest.fn() })
  cache = new NutritionalSummaryCache(redis)
  value = { calories: 2000, protein: 80 }
Act:
  await cache.set('nutrition:plan-1:daily', value, 3600)
Assert:
  redis.set called once with ('nutrition:plan-1:daily', JSON.stringify(value), 'EX', 3600)
```

**UTS-009-A3**

```
Arrange:
  stored = { calories: 2000 }
  redis = mock({ get: async () => JSON.stringify(stored) })
  cache = new NutritionalSummaryCache(redis)
Act:
  result = await cache.get('nutrition:plan-1:daily')
Assert:
  result.calories === 2000
```

**UTS-009-A4**

```
Arrange:
  redis = mock({ del: jest.fn() })
  cache = new NutritionalSummaryCache(redis)
Act:
  await cache.invalidate('plan-1')
Assert:
  redis.del called once with ('nutrition:plan-1:daily', 'nutrition:plan-1:weekly')
```

---

#### UTP-009-B — Boundary Value Analysis: ttl boundary

**Technique**: Boundary Value Analysis
**Source View**: Internal Data Structures
**Covers**: `ttl` scalar — must be positive; 0 is invalid (min-1 boundary)

| Scenario | ID         | Description                        |
| -------- | ---------- | ---------------------------------- |
| 1        | UTS-009-B1 | ttl = 1 → valid (min boundary)     |
| 2        | UTS-009-B2 | ttl = 3600 → valid (nominal)       |
| 3        | UTS-009-B3 | ttl = 0 → invalid (min-1 boundary) |

**UTS-009-B1**

```
Arrange:
  redis = mock({ set: jest.fn() })
  cache = new NutritionalSummaryCache(redis)
Act:
  await cache.set('key', { calories: 100 }, 1)
Assert:
  redis.set called with ('key', ..., 'EX', 1)
```

**UTS-009-B2**

```
Arrange:
  redis = mock({ set: jest.fn() })
  cache = new NutritionalSummaryCache(redis)
Act:
  await cache.set('key', { calories: 100 }, 3600)
Assert:
  redis.set called with ('key', ..., 'EX', 3600)
```

**UTS-009-B3**

```
Arrange:
  redis = mock({ set: jest.fn() })
  cache = new NutritionalSummaryCache(redis)
Act:
  call = () => cache.set('key', { calories: 100 }, 0)
Assert:
  call() rejects with RangeError or ValidationException (ttl must be > 0)
```

---

### MOD-010: AISuggestionController

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/meal-planning/controllers/ai-suggestion.controller.ts`

---

#### UTP-010-A — Strict Isolation: handler delegates to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: getSuggestions contains no logic; pure delegation to AISuggestionService

| Scenario | ID         | Description                                        |
| -------- | ---------- | -------------------------------------------------- |
| 1        | UTS-010-A1 | getSuggestions delegates to service.getSuggestions |

**UTS-010-A1**

```
Arrange:
  service = mock({ getSuggestions: async () => ({ suggestions: [{ recipeId: 'r-1', score: 0.9 }] }) })
  controller = new AISuggestionController(service)
  body = { dietaryPreferences: { vegetarian: true } }
  authContext = { userId: 'user-1', tier: 'premium' }
Act:
  result = await controller.getSuggestions(body, authContext)
Assert:
  service.getSuggestions called once with (body.dietaryPreferences, 'user-1')
  result.suggestions.length === 1
```

---

### MOD-011: AISuggestionService

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/meal-planning/services/ai-suggestion.service.ts`

---

#### UTP-011-A — Branch Coverage: AI response parsing

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: Parse AI JSON response; handle malformed JSON; handle empty suggestions array

| Scenario | ID         | Description                                    |
| -------- | ---------- | ---------------------------------------------- |
| 1        | UTS-011-A1 | Valid AI JSON → returns parsed suggestions     |
| 2        | UTS-011-A2 | Malformed JSON from AI → throws ParseException |
| 3        | UTS-011-A3 | Empty suggestions array → returns empty list   |

**UTS-011-A1**

```
Arrange:
  aiAdapter = mock({ invoke: async () => ({ content: JSON.stringify([{ recipeId: 'r-1', score: 0.9 }]) }) })
  recipeAdapter = mock({ fetchUserRecipes: async () => [{ id: 'r-1', name: 'Pasta' }] })
  service = new AISuggestionService(aiAdapter, recipeAdapter)
Act:
  result = await service.getSuggestions({ vegetarian: true }, 'user-1')
Assert:
  result.suggestions[0].recipeId === 'r-1'
```

**UTS-011-A2**

```
Arrange:
  aiAdapter = mock({ invoke: async () => ({ content: 'not valid json {{{' }) })
  recipeAdapter = mock({ fetchUserRecipes: async () => [] })
  service = new AISuggestionService(aiAdapter, recipeAdapter)
Act:
  call = () => service.getSuggestions({ vegetarian: true }, 'user-1')
Assert:
  call() rejects with ParseException
```

**UTS-011-A3**

```
Arrange:
  aiAdapter = mock({ invoke: async () => ({ content: JSON.stringify([]) }) })
  recipeAdapter = mock({ fetchUserRecipes: async () => [] })
  service = new AISuggestionService(aiAdapter, recipeAdapter)
Act:
  result = await service.getSuggestions({ vegetarian: true }, 'user-1')
Assert:
  result.suggestions.length === 0
```

---

### MOD-012: AutoGenerateController

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/meal-planning/controllers/auto-generate.controller.ts`

---

#### UTP-012-A — Strict Isolation: handler delegates to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: autoGenerate contains no logic; pure delegation to AutoGenerateService

| Scenario | ID         | Description                                    |
| -------- | ---------- | ---------------------------------------------- |
| 1        | UTS-012-A1 | autoGenerate delegates to service.autoGenerate |

**UTS-012-A1**

```
Arrange:
  service = mock({ autoGenerate: async () => ({ id: 'plan-1', slots: [] }) })
  controller = new AutoGenerateController(service)
  body = { preferences: { vegetarian: true }, dateRange: { startDate: '2026-06-01', endDate: '2026-06-08' } }
  authContext = { userId: 'user-1', tier: 'premium' }
Act:
  result = await controller.autoGenerate(body, authContext)
Assert:
  service.autoGenerate called once with (body.preferences, body.dateRange, 'user-1')
  result.id === 'plan-1'
```

---

### MOD-013: AutoGenerateService

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/meal-planning/services/auto-generate.service.ts`

---

#### UTP-013-A — Branch Coverage: slot generation loop

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `FOR day IN 0..dayCount-1 FOR mealType IN [BREAKFAST, LUNCH, DINNER]` — correct slot count

| Scenario | ID         | Description                                                |
| -------- | ---------- | ---------------------------------------------------------- |
| 1        | UTS-013-A1 | 1-day range → generates 3 slots (BREAKFAST, LUNCH, DINNER) |
| 2        | UTS-013-A2 | 7-day range → generates 21 slots                           |

**UTS-013-A1**

```
Arrange:
  mealPlanService = mock({ createPlan: async (dto) => ({ id: 'plan-1', slots: dto.slots }) })
  aiSuggestionService = mock({ getSuggestions: async () => ({ suggestions: [] }) })
  recipeAssignmentService = mock({ bulkAssign: async () => [] })
  service = new AutoGenerateService(mealPlanService, aiSuggestionService, recipeAssignmentService)
  dateRange = { startDate: '2026-06-01', endDate: '2026-06-02' }  // 1 day
Act:
  result = await service.autoGenerate({}, dateRange, 'user-1')
Assert:
  mealPlanService.createPlan called with dto.slots.length === 3
  dto.slots contains BREAKFAST, LUNCH, DINNER for dayOffset 0
```

**UTS-013-A2**

```
Arrange:
  mealPlanService = mock({ createPlan: async (dto) => ({ id: 'plan-1', slots: dto.slots }) })
  aiSuggestionService = mock({ getSuggestions: async () => ({ suggestions: [] }) })
  recipeAssignmentService = mock({ bulkAssign: async () => [] })
  service = new AutoGenerateService(mealPlanService, aiSuggestionService, recipeAssignmentService)
  dateRange = { startDate: '2026-06-01', endDate: '2026-06-08' }  // 7 days
Act:
  result = await service.autoGenerate({}, dateRange, 'user-1')
Assert:
  mealPlanService.createPlan called with dto.slots.length === 21
```

---

#### UTP-013-B — Strict Isolation: orchestration order

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: Steps 1→2→3→4 execute in order; bulkAssign receives plan slots and ranked recipes

| Scenario | ID         | Description                                |
| -------- | ---------- | ------------------------------------------ |
| 1        | UTS-013-B1 | All three services called in correct order |

**UTS-013-B1**

```
Arrange:
  callOrder = []
  mealPlanService = mock({ createPlan: async () => { callOrder.push('create'); return { id: 'plan-1', slots: [{ id: 's-1' }] } } })
  aiSuggestionService = mock({ getSuggestions: async () => { callOrder.push('suggest'); return { suggestions: [{ recipeId: 'r-1' }] } } })
  recipeAssignmentService = mock({ bulkAssign: async () => { callOrder.push('assign'); return [] } })
  service = new AutoGenerateService(mealPlanService, aiSuggestionService, recipeAssignmentService)
Act:
  await service.autoGenerate({}, { startDate: '2026-06-01', endDate: '2026-06-02' }, 'user-1')
Assert:
  callOrder === ['create', 'suggest', 'assign']
```

---

### MOD-014: WasteOptimizationController

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `src/meal-planning/controllers/waste-optimization.controller.ts`

---

#### UTP-014-A — Strict Isolation: handler delegates to service

**Technique**: Strict Isolation
**Source View**: Architecture Interface View
**Covers**: getOptimizations contains no logic; pure delegation

| Scenario | ID         | Description                                            |
| -------- | ---------- | ------------------------------------------------------ |
| 1        | UTS-014-A1 | getOptimizations delegates to service.getOptimizations |

**UTS-014-A1**

```
Arrange:
  service = mock({ getOptimizations: async () => ({ suggestions: [{ recipeId: 'r-2', overlapScore: 0.8 }] }) })
  controller = new WasteOptimizationController(service)
  authContext = { userId: 'user-1', tier: 'premium' }
Act:
  result = await controller.getOptimizations('plan-1', authContext)
Assert:
  service.getOptimizations called once with ('plan-1', 'user-1')
  result.suggestions.length === 1
```

---

### MOD-015: WasteOptimizationService

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `src/meal-planning/services/waste-optimization.service.ts`

---

#### UTP-015-A — Branch Coverage: ingredient overlap scoring

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: Overlap score computation; deduplication of ingredient IDs; ranking by score

| Scenario | ID         | Description                                          |
| -------- | ---------- | ---------------------------------------------------- |
| 1        | UTS-015-A1 | Two recipes share ingredients → higher overlap score |
| 2        | UTS-015-A2 | No shared ingredients → overlap score = 0            |
| 3        | UTS-015-A3 | Duplicate ingredient IDs deduplicated before scoring |

**UTS-015-A1**

```
Arrange:
  // Plan has recipe r-1 with ingredients [A, B]; candidate r-2 has [A, B, C]
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [{ assignment: { recipeId: 'r-1' } }] }) })
  recipeAdapter = mock({
    fetchRecipe: async (id) => id === 'r-1'
      ? { ingredients: [{ fdcId: 'A' }, { fdcId: 'B' }] }
      : { ingredients: [{ fdcId: 'A' }, { fdcId: 'B' }, { fdcId: 'C' }] },
    fetchUserRecipes: async () => [{ id: 'r-2' }]
  })
  service = new WasteOptimizationService(repo, recipeAdapter)
Act:
  result = await service.getOptimizations('plan-1', 'user-1')
Assert:
  result.suggestions[0].recipeId === 'r-2'
  result.suggestions[0].overlapScore > 0
```

**UTS-015-A2**

```
Arrange:
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [{ assignment: { recipeId: 'r-1' } }] }) })
  recipeAdapter = mock({
    fetchRecipe: async (id) => id === 'r-1'
      ? { ingredients: [{ fdcId: 'A' }] }
      : { ingredients: [{ fdcId: 'Z' }] },
    fetchUserRecipes: async () => [{ id: 'r-2' }]
  })
  service = new WasteOptimizationService(repo, recipeAdapter)
Act:
  result = await service.getOptimizations('plan-1', 'user-1')
Assert:
  result.suggestions[0].overlapScore === 0
```

**UTS-015-A3**

```
Arrange:
  // Plan has recipe r-1 with duplicate ingredient IDs [A, A, B]
  repo = mock({ findByIdAndUser: async () => ({ id: 'plan-1', slots: [{ assignment: { recipeId: 'r-1' } }] }) })
  recipeAdapter = mock({
    fetchRecipe: async () => ({ ingredients: [{ fdcId: 'A' }, { fdcId: 'A' }, { fdcId: 'B' }] }),
    fetchUserRecipes: async () => []
  })
  service = new WasteOptimizationService(repo, recipeAdapter)
Act:
  result = await service.getOptimizations('plan-1', 'user-1')
Assert:
  // allIngredientIds deduplicated to ['A', 'B'] — no error thrown
  result defined
```

---

### MOD-016: RecipeApiAdapter

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `src/meal-planning/adapters/recipe-api.adapter.ts`

---

#### UTP-016-A — Branch Coverage: fetchRecipe status codes

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF response.status == 404 → return null`, `IF response.status != 200 → throw`

| Scenario | ID         | Description                                   |
| -------- | ---------- | --------------------------------------------- |
| 1        | UTS-016-A1 | HTTP 200 → returns RecipeDTO                  |
| 2        | UTS-016-A2 | HTTP 404 → returns null                       |
| 3        | UTS-016-A3 | HTTP 500 → throws ServiceUnavailableException |

**UTS-016-A1**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 200, data: { id: 'r-1', name: 'Pasta' } }) })
  adapter = new RecipeApiAdapter(httpClient, config)
Act:
  result = await adapter.fetchRecipe('r-1', 'user-1')
Assert:
  result.id === 'r-1'
```

**UTS-016-A2**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 404 }) })
  adapter = new RecipeApiAdapter(httpClient, config)
Act:
  result = await adapter.fetchRecipe('r-999', 'user-1')
Assert:
  result === null
```

**UTS-016-A3**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 500 }) })
  adapter = new RecipeApiAdapter(httpClient, config)
Act:
  call = () => adapter.fetchRecipe('r-1', 'user-1')
Assert:
  call() rejects with ServiceUnavailableException
```

---

### MOD-017: UsdaFoodApiAdapter

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `src/meal-planning/adapters/usda-food-api.adapter.ts`

---

#### UTP-017-A — Branch Coverage: circuit breaker state

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: Circuit breaker CLOSED (normal), OPEN (fast-fail), failure count increment

| Scenario | ID         | Description                                                         |
| -------- | ---------- | ------------------------------------------------------------------- |
| 1        | UTS-017-A1 | Circuit CLOSED + HTTP 200 → returns NutritionDTO                    |
| 2        | UTS-017-A2 | Circuit OPEN → throws ServiceUnavailableException without HTTP call |
| 3        | UTS-017-A3 | HTTP error increments failure count toward OPEN threshold           |

**UTS-017-A1**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 200, data: { calories: 350 } }) })
  adapter = new UsdaFoodApiAdapter(httpClient, config)
  // circuit starts CLOSED
Act:
  result = await adapter.fetchNutrition('fdc-1', 100)
Assert:
  result.calories === 350
  httpClient.get called once
```

**UTS-017-A2**

```
Arrange:
  httpClient = mock({ get: jest.fn() })
  adapter = new UsdaFoodApiAdapter(httpClient, config)
  adapter.forceCircuitOpen()  // test helper to set circuit state
Act:
  call = () => adapter.fetchNutrition('fdc-1', 100)
Assert:
  call() rejects with ServiceUnavailableException('Circuit open')
  httpClient.get not called
```

**UTS-017-A3**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 503 }) })
  adapter = new UsdaFoodApiAdapter(httpClient, config)
  initialFailures = adapter.getFailureCount()
Act:
  try { await adapter.fetchNutrition('fdc-1', 100) } catch {}
Assert:
  adapter.getFailureCount() === initialFailures + 1
```

---

#### UTP-017-B — State Transition Testing: circuit breaker states

**Technique**: State Transition Testing
**Source View**: State Machine View
**Covers**: CLOSED→OPEN (threshold reached), OPEN→HALF-OPEN (timeout), HALF-OPEN→CLOSED (success), HALF-OPEN→OPEN (failure)

| Scenario | ID         | Description                                       |
| -------- | ---------- | ------------------------------------------------- |
| 1        | UTS-017-B1 | CLOSED + N failures → transitions to OPEN         |
| 2        | UTS-017-B2 | OPEN + timeout elapsed → transitions to HALF-OPEN |
| 3        | UTS-017-B3 | HALF-OPEN + success → transitions to CLOSED       |
| 4        | UTS-017-B4 | HALF-OPEN + failure → transitions back to OPEN    |

**UTS-017-B1**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 503 }) })
  adapter = new UsdaFoodApiAdapter(httpClient, { failureThreshold: 3, resetTimeout: 60000 })
Act:
  for i in 1..3: try { await adapter.fetchNutrition('fdc-1', 100) } catch {}
Assert:
  adapter.getCircuitState() === 'OPEN'
```

**UTS-017-B2**

```
Arrange:
  adapter = new UsdaFoodApiAdapter(httpClient, { failureThreshold: 3, resetTimeout: 100 })
  adapter.forceCircuitOpen()
  await sleep(150)  // exceed resetTimeout
Act:
  adapter.checkCircuitState()
Assert:
  adapter.getCircuitState() === 'HALF-OPEN'
```

**UTS-017-B3**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 200, data: { calories: 100 } }) })
  adapter = new UsdaFoodApiAdapter(httpClient, config)
  adapter.forceCircuitHalfOpen()
Act:
  await adapter.fetchNutrition('fdc-1', 100)
Assert:
  adapter.getCircuitState() === 'CLOSED'
  adapter.getFailureCount() === 0
```

**UTS-017-B4**

```
Arrange:
  httpClient = mock({ get: async () => ({ status: 503 }) })
  adapter = new UsdaFoodApiAdapter(httpClient, config)
  adapter.forceCircuitHalfOpen()
Act:
  try { await adapter.fetchNutrition('fdc-1', 100) } catch {}
Assert:
  adapter.getCircuitState() === 'OPEN'
```

---

### MOD-018: AiPromptBuilder

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `src/meal-planning/utils/ai-prompt-builder.ts`

---

#### UTP-018-A — Branch Coverage: prompt construction

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: Dietary preference flags included/excluded in prompt; recipe list serialization

| Scenario | ID         | Description                                             |
| -------- | ---------- | ------------------------------------------------------- |
| 1        | UTS-018-A1 | vegetarian=true → prompt contains 'vegetarian'          |
| 2        | UTS-018-A2 | vegetarian=false → prompt does NOT contain 'vegetarian' |
| 3        | UTS-018-A3 | Empty recipe list → prompt is still valid (non-empty)   |
| 4        | UTS-018-A4 | Non-empty recipe list → all recipe IDs appear in prompt |

**UTS-018-A1**

```
Arrange:
  builder = new AiPromptBuilder()
  preferences = { vegetarian: true, glutenFree: false }
  recipes = [{ id: 'r-1', name: 'Salad' }]
Act:
  prompt = builder.build(preferences, recipes)
Assert:
  prompt.text.includes('vegetarian')
```

**UTS-018-A2**

```
Arrange:
  builder = new AiPromptBuilder()
  preferences = { vegetarian: false }
  recipes = []
Act:
  prompt = builder.build(preferences, recipes)
Assert:
  !prompt.text.includes('vegetarian')
```

**UTS-018-A3**

```
Arrange:
  builder = new AiPromptBuilder()
Act:
  prompt = builder.build({}, [])
Assert:
  prompt.text defined
  prompt.text.length > 0
```

**UTS-018-A4**

```
Arrange:
  builder = new AiPromptBuilder()
  recipes = [{ id: 'r-1', name: 'Pasta' }, { id: 'r-2', name: 'Salad' }]
Act:
  prompt = builder.build({}, recipes)
Assert:
  prompt.text.includes('r-1')
  prompt.text.includes('r-2')
```

---

#### UTP-018-B — Boundary Value Analysis: maxTokens

**Technique**: Boundary Value Analysis
**Source View**: Internal Data Structures
**Covers**: `maxTokens` scalar — default 1000; boundary at 1 (min) and 0 (min-1 invalid)

| Scenario | ID         | Description                              |
| -------- | ---------- | ---------------------------------------- |
| 1        | UTS-018-B1 | No maxTokens override → defaults to 1000 |
| 2        | UTS-018-B2 | maxTokens = 1 → valid (min boundary)     |
| 3        | UTS-018-B3 | maxTokens = 0 → invalid (min-1 boundary) |

**UTS-018-B1**

```
Arrange:
  builder = new AiPromptBuilder()
Act:
  prompt = builder.build({}, [])
Assert:
  prompt.maxTokens === 1000
```

**UTS-018-B2**

```
Arrange:
  builder = new AiPromptBuilder()
Act:
  prompt = builder.build({}, [], { maxTokens: 1 })
Assert:
  prompt.maxTokens === 1
```

**UTS-018-B3**

```
Arrange:
  builder = new AiPromptBuilder()
Act:
  call = () => builder.build({}, [], { maxTokens: 0 })
Assert:
  call() throws RangeError or ValidationException
```

---

### MOD-019: AiProviderAdapter

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `src/meal-planning/adapters/ai-provider.adapter.ts`

---

#### UTP-019-A — Branch Coverage: response parsing

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF response.status != 200 → throw`, `IF content IS NULL → throw ParseException`

| Scenario | ID         | Description                                                             |
| -------- | ---------- | ----------------------------------------------------------------------- |
| 1        | UTS-019-A1 | HTTP 200 with content → returns AIResponseDTO                           |
| 2        | UTS-019-A2 | HTTP non-200 → throws ServiceUnavailableException                       |
| 3        | UTS-019-A3 | HTTP 200 but choices[0].message.content is null → throws ParseException |

**UTS-019-A1**

```
Arrange:
  httpClient = mock({ post: async () => ({ status: 200, data: { choices: [{ message: { content: 'suggestion json' } }] } }) })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  result = await adapter.invoke({ text: 'suggest meals', maxTokens: 500 })
Assert:
  result.content === 'suggestion json'
```

**UTS-019-A2**

```
Arrange:
  httpClient = mock({ post: async () => ({ status: 429 }) })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  call = () => adapter.invoke({ text: 'suggest meals' })
Assert:
  call() rejects with ServiceUnavailableException('AI provider error: 429')
```

**UTS-019-A3**

```
Arrange:
  httpClient = mock({ post: async () => ({ status: 200, data: { choices: [{ message: { content: null } }] } }) })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  call = () => adapter.invoke({ text: 'suggest meals' })
Assert:
  call() rejects with ParseException('AI provider returned empty content')
```

---

#### UTP-019-B — Boundary Value Analysis: maxTokens and temperature defaults

**Technique**: Boundary Value Analysis
**Source View**: Internal Data Structures
**Covers**: `maxTokens ?? 1000` and `temperature ?? 0.3` default application

| Scenario | ID         | Description                                          |
| -------- | ---------- | ---------------------------------------------------- |
| 1        | UTS-019-B1 | prompt.maxTokens undefined → request body uses 1000  |
| 2        | UTS-019-B2 | prompt.temperature undefined → request body uses 0.3 |
| 3        | UTS-019-B3 | prompt.maxTokens = 500 → request body uses 500       |

**UTS-019-B1**

```
Arrange:
  capturedBody = null
  httpClient = mock({ post: async (url, body) => { capturedBody = body; return { status: 200, data: { choices: [{ message: { content: 'ok' } }] } } } })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  await adapter.invoke({ text: 'suggest' })
Assert:
  capturedBody.max_tokens === 1000
```

**UTS-019-B2**

```
Arrange:
  capturedBody = null
  httpClient = mock({ post: async (url, body) => { capturedBody = body; return { status: 200, data: { choices: [{ message: { content: 'ok' } }] } } } })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  await adapter.invoke({ text: 'suggest' })
Assert:
  capturedBody.temperature === 0.3
```

**UTS-019-B3**

```
Arrange:
  capturedBody = null
  httpClient = mock({ post: async (url, body) => { capturedBody = body; return { status: 200, data: { choices: [{ message: { content: 'ok' } }] } } } })
  adapter = new AiProviderAdapter(httpClient, config)
Act:
  await adapter.invoke({ text: 'suggest', maxTokens: 500 })
Assert:
  capturedBody.max_tokens === 500
```

---

### MOD-020: MealPlanPublicApiAdapter

**Parent Architecture Modules**: ARCH-020
**Target Source File(s)**: `src/meal-planning/adapters/meal-plan-public-api.adapter.ts`

---

#### UTP-020-A — Branch Coverage: version dispatch

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF version == "v1"`, `ELSE IF version == "v2"`, `ELSE → throw UnsupportedVersionException`

| Scenario | ID         | Description                                                    |
| -------- | ---------- | -------------------------------------------------------------- |
| 1        | UTS-020-A1 | version = "v1" → returns v1 DTO (no nutritionSummaryUrl)       |
| 2        | UTS-020-A2 | version = "v2" → returns v2 DTO (includes nutritionSummaryUrl) |
| 3        | UTS-020-A3 | version = "v3" → throws UnsupportedVersionException            |
| 4        | UTS-020-A4 | default (no version arg) → returns v1 DTO                      |

**UTS-020-A1**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'Week 1', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-07'), slots: [], createdAt: new Date() }
Act:
  result = adapter.serializeMealPlan(plan, 'v1')
Assert:
  result.id === 'plan-1'
  result.nutritionSummaryUrl === undefined
```

**UTS-020-A2**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'Week 1', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-07'), slots: [], createdAt: new Date() }
Act:
  result = adapter.serializeMealPlan(plan, 'v2')
Assert:
  result.nutritionSummaryUrl === '/meal-plans/plan-1/nutrition/weekly'
```

**UTS-020-A3**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'Week 1', startDate: new Date(), endDate: new Date(), slots: [], createdAt: new Date() }
Act:
  call = () => adapter.serializeMealPlan(plan, 'v3')
Assert:
  call() throws UnsupportedVersionException('Unknown version: v3')
```

**UTS-020-A4**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'Week 1', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-07'), slots: [], createdAt: new Date() }
Act:
  result = adapter.serializeMealPlan(plan)  // no version arg → defaults to 'v1'
Assert:
  result.id === 'plan-1'
  result.nutritionSummaryUrl === undefined
```

---

#### UTP-020-B — Branch Coverage: slot serialization with null assignment

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `recipeId: s.assignment?.recipeId ?? null` — optional chaining branch

| Scenario | ID         | Description                               |
| -------- | ---------- | ----------------------------------------- |
| 1        | UTS-020-B1 | Slot has assignment → recipeId populated  |
| 2        | UTS-020-B2 | Slot has no assignment → recipeId is null |

**UTS-020-B1**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'W', startDate: new Date(), endDate: new Date(), createdAt: new Date(), slots: [{ id: 's-1', dayOffset: 0, mealType: 'BREAKFAST', assignment: { recipeId: 'r-1' } }] }
Act:
  result = adapter.serializeMealPlan(plan, 'v1')
Assert:
  result.slots[0].recipeId === 'r-1'
```

**UTS-020-B2**

```
Arrange:
  adapter = new MealPlanPublicApiAdapter()
  plan = { id: 'plan-1', name: 'W', startDate: new Date(), endDate: new Date(), createdAt: new Date(), slots: [{ id: 's-1', dayOffset: 0, mealType: 'BREAKFAST', assignment: null }] }
Act:
  result = adapter.serializeMealPlan(plan, 'v1')
Assert:
  result.slots[0].recipeId === null
```

---

### MOD-021: PremiumTierGuard

**Parent Architecture Modules**: ARCH-021
**Target Source File(s)**: `src/meal-planning/guards/premium-tier.guard.ts`

---

#### UTP-021-A — Branch Coverage: canActivate predicate

**Technique**: Statement & Branch Coverage
**Source View**: Algorithmic/Logic View
**Covers**: `IF authContext IS NULL → throw UnauthorizedException`, `IF tier != "premium" → throw ForbiddenException`, `RETURN true`

| Scenario | ID         | Description                                        |
| -------- | ---------- | -------------------------------------------------- |
| 1        | UTS-021-A1 | authContext is null → throws UnauthorizedException |
| 2        | UTS-021-A2 | tier = "free" → throws ForbiddenException          |
| 3        | UTS-021-A3 | tier = "premium" → returns true                    |

**UTS-021-A1**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: null })
Act:
  call = () => guard.canActivate(context)
Assert:
  call() throws UnauthorizedException('AuthContext missing — AuthMiddleware must run first')
```

**UTS-021-A2**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: { userId: 'user-1', tier: 'free' } })
Act:
  call = () => guard.canActivate(context)
Assert:
  call() throws ForbiddenException('Premium subscription required')
```

**UTS-021-A3**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: { userId: 'user-1', tier: 'premium' } })
Act:
  result = guard.canActivate(context)
Assert:
  result === true
```

---

#### UTP-021-B — Equivalence Partitioning: tier values

**Technique**: Equivalence Partitioning
**Source View**: Internal Data Structures
**Covers**: `tier` string — valid partition {"premium"}, invalid partition {"free", any other string}

| Scenario | ID         | Description                                                         |
| -------- | ---------- | ------------------------------------------------------------------- |
| 1        | UTS-021-B1 | tier = "premium" → valid partition → returns true                   |
| 2        | UTS-021-B2 | tier = "free" → invalid partition → throws ForbiddenException       |
| 3        | UTS-021-B3 | tier = "enterprise" → invalid partition → throws ForbiddenException |

**UTS-021-B1**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: { userId: 'u', tier: 'premium' } })
Act:
  result = guard.canActivate(context)
Assert:
  result === true
```

**UTS-021-B2**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: { userId: 'u', tier: 'free' } })
Act:
  call = () => guard.canActivate(context)
Assert:
  call() throws ForbiddenException
```

**UTS-021-B3**

```
Arrange:
  guard = new PremiumTierGuard()
  context = mockExecutionContext({ authContext: { userId: 'u', tier: 'enterprise' } })
Act:
  call = () => guard.canActivate(context)
Assert:
  call() throws ForbiddenException
```

---

### MOD-022: QualityComplianceModule [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-022
**Target Source File(s)**: `tsconfig.json`, `.eslintrc.js`, `src/meal-planning/**/*.ts`

> **Note**: MOD-022 is a build-time-only cross-cutting module with no runtime logic, state, or data structures. It has no executable unit test cases. Compliance is verified by CI gate: `tsc --noEmit` and `eslint` must exit zero. No `UTP-022-*` scenarios are defined.

---

## Coverage Summary

| MOD ID    | Module Name                  | Test Cases | Scenarios | Techniques Applied                                |
| --------- | ---------------------------- | ---------- | --------- | ------------------------------------------------- |
| MOD-001   | MealPlanController           | 2 (A–B)    | 5         | Statement & Branch, Strict Isolation              |
| MOD-002   | MealPlanService              | 3 (A–C)    | 14        | Statement & Branch, BVA, Equivalence Partitioning |
| MOD-003   | MealPlanRepository           | 2 (A–B)    | 4         | Statement & Branch, Strict Isolation              |
| MOD-004   | RecipeAssignmentController   | 1 (A)      | 2         | Strict Isolation                                  |
| MOD-005   | RecipeAssignmentService      | 2 (A–B)    | 4         | Statement & Branch                                |
| MOD-006   | RecipeAssignmentRepository   | 2 (A–B)    | 3         | Statement & Branch, Strict Isolation              |
| MOD-007   | NutritionalSummaryController | 1 (A)      | 2         | Strict Isolation                                  |
| MOD-008   | NutritionalSummaryService    | 2 (A–B)    | 4         | Statement & Branch                                |
| MOD-009   | NutritionalSummaryCache      | 2 (A–B)    | 7         | State Transition, BVA                             |
| MOD-010   | AISuggestionController       | 1 (A)      | 1         | Strict Isolation                                  |
| MOD-011   | AISuggestionService          | 1 (A)      | 3         | Statement & Branch                                |
| MOD-012   | AutoGenerateController       | 1 (A)      | 1         | Strict Isolation                                  |
| MOD-013   | AutoGenerateService          | 2 (A–B)    | 3         | Statement & Branch, Strict Isolation              |
| MOD-014   | WasteOptimizationController  | 1 (A)      | 1         | Strict Isolation                                  |
| MOD-015   | WasteOptimizationService     | 1 (A)      | 3         | Statement & Branch                                |
| MOD-016   | RecipeApiAdapter             | 1 (A)      | 3         | Statement & Branch                                |
| MOD-017   | UsdaFoodApiAdapter           | 2 (A–B)    | 7         | Statement & Branch, State Transition              |
| MOD-018   | AiPromptBuilder              | 2 (A–B)    | 7         | Statement & Branch, BVA                           |
| MOD-019   | AiProviderAdapter            | 2 (A–B)    | 6         | Statement & Branch, BVA                           |
| MOD-020   | MealPlanPublicApiAdapter     | 2 (A–B)    | 6         | Statement & Branch                                |
| MOD-021   | PremiumTierGuard             | 2 (A–B)    | 6         | Statement & Branch, Equivalence Partitioning      |
| MOD-022   | QualityComplianceModule      | 0          | 0         | Build-time only — no executable unit tests        |
| **TOTAL** |                              | **35**     | **92**    |                                                   |

## Traceability

| UTP ID    | MOD ID  | Technique                   | REQ Coverage              |
| --------- | ------- | --------------------------- | ------------------------- |
| UTP-001-A | MOD-001 | Statement & Branch Coverage | REQ-001, REQ-002          |
| UTP-001-B | MOD-001 | Strict Isolation            | REQ-001, REQ-002          |
| UTP-002-A | MOD-002 | Statement & Branch Coverage | REQ-001, REQ-002          |
| UTP-002-B | MOD-002 | Boundary Value Analysis     | REQ-001                   |
| UTP-002-C | MOD-002 | Equivalence Partitioning    | REQ-002                   |
| UTP-003-A | MOD-003 | Statement & Branch Coverage | REQ-001                   |
| UTP-003-B | MOD-003 | Strict Isolation            | REQ-001                   |
| UTP-004-A | MOD-004 | Strict Isolation            | REQ-003                   |
| UTP-005-A | MOD-005 | Statement & Branch Coverage | REQ-003                   |
| UTP-005-B | MOD-005 | Statement & Branch Coverage | REQ-003                   |
| UTP-006-A | MOD-006 | Statement & Branch Coverage | REQ-003                   |
| UTP-006-B | MOD-006 | Strict Isolation            | REQ-003                   |
| UTP-007-A | MOD-007 | Strict Isolation            | REQ-004, REQ-005          |
| UTP-008-A | MOD-008 | Statement & Branch Coverage | REQ-004, REQ-005          |
| UTP-008-B | MOD-008 | Statement & Branch Coverage | REQ-004, REQ-005          |
| UTP-009-A | MOD-009 | State Transition Testing    | REQ-004, REQ-005          |
| UTP-009-B | MOD-009 | Boundary Value Analysis     | REQ-004, REQ-005          |
| UTP-010-A | MOD-010 | Strict Isolation            | REQ-006                   |
| UTP-011-A | MOD-011 | Statement & Branch Coverage | REQ-006                   |
| UTP-012-A | MOD-012 | Strict Isolation            | REQ-007                   |
| UTP-013-A | MOD-013 | Statement & Branch Coverage | REQ-007                   |
| UTP-013-B | MOD-013 | Strict Isolation            | REQ-007                   |
| UTP-014-A | MOD-014 | Strict Isolation            | REQ-008                   |
| UTP-015-A | MOD-015 | Statement & Branch Coverage | REQ-008                   |
| UTP-016-A | MOD-016 | Statement & Branch Coverage | REQ-003, REQ-006, REQ-007 |
| UTP-017-A | MOD-017 | Statement & Branch Coverage | REQ-004, REQ-005          |
| UTP-017-B | MOD-017 | State Transition Testing    | REQ-004, REQ-005          |
| UTP-018-A | MOD-018 | Statement & Branch Coverage | REQ-006, REQ-007          |
| UTP-018-B | MOD-018 | Boundary Value Analysis     | REQ-006, REQ-007          |
| UTP-019-A | MOD-019 | Statement & Branch Coverage | REQ-006, REQ-007          |
| UTP-019-B | MOD-019 | Boundary Value Analysis     | REQ-006, REQ-007          |
| UTP-020-A | MOD-020 | Statement & Branch Coverage | REQ-001, REQ-003          |
| UTP-020-B | MOD-020 | Statement & Branch Coverage | REQ-003                   |
| UTP-021-A | MOD-021 | Statement & Branch Coverage | REQ-006, REQ-007, REQ-008 |
| UTP-021-B | MOD-021 | Equivalence Partitioning    | REQ-006, REQ-007, REQ-008 |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.
