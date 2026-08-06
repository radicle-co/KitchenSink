# Task List: Feature 006 — Meal Planning

**Feature**: `006-meal-planning`
**Generated**: 2026-06-02
**Source**: [spec.md](spec.md) | [plan.md](plan.md) | [product-spec/product-spec.md](product-spec/product-spec.md)

---

## US Reference Table

| Task ID     | Priority | User Story | Description                                                  |
| ----------- | -------- | ---------- | ------------------------------------------------------------ |
| T-001–T-003 | P2       | US-006-001 | Create meal plan with configurable date range and meal slots |
| T-004–T-006 | P2       | US-006-002 | Manually assign recipes to day/meal slots                    |
| T-007–T-009 | P2       | US-006-003 | View daily and weekly nutrition summaries                    |
| T-010–T-012 | P2       | US-006-004 | Complete planning workflow through grocery handoff           |
| T-013–T-014 | P2       | US-006-005 | AI-powered recipe suggestions for specific slots (Premium)   |
| T-015–T-016 | P2       | US-006-006 | AI auto-generate complete draft plan (Premium)               |
| T-017–T-018 | P2       | US-006-007 | Food waste optimization suggestions (Premium)                |

---

## Dependency Graph

```
T-001 (schema)
  → T-002 (meal plan API)
    → T-004 (entries API)
      → T-007 (nutrition service)
        → T-008 (nutrition API)
      → T-010 (grocery handoff)
      → T-012 (frontend calendar)
    → T-003 (list/get API)
  → T-005 (entry validation)
    → T-006 (orphan handling)
  → T-009 (nutrition tests)
    → T-011 (e2e nutrition flow)
  → T-013 (AI suggestion API)
    → T-014 (frontend AI suggestions)
  → T-015 (AI auto-generate API)
    → T-016 (frontend auto-generate)
  → T-017 (waste opt API)
    → T-018 (frontend waste opt)
```

---

## US-006-001: Create Plan

Implements **FR-022**.

- [ ] **T-001** [P2] [US-006-001] Create Drizzle schema + migration for `meal_plans`, `meal_plan_entries`, `meal_plan_nutrition` tables with indexes — `packages/api/src/db/migrations/006-meal-planning.sql`
    - **Depends on**: none
    - **Implements**: FR-022 (database foundation)
    - **Acceptance**: Schema applies cleanly; indexes cover `user_id`, `start_date`, `end_date`, `meal_plan_id`, `date`; migration rolls back successfully.

- [ ] **T-002** [P2] [US-006-001] Implement POST /v1/meal-plans and GET /v1/meal-plans endpoints with Zod validation — `packages/api/src/meal-plans/meal-plans.controller.ts`
    - **Depends on**: T-001
    - **Implements**: FR-022 (create + list)
    - **Acceptance**: Can create a plan with `name`, `startDate`, `endDate`, `planType`; list returns user's plans; 422 on invalid date ranges.

- [ ] **T-003** [P2] [US-006-001] Implement GET /v1/meal-plans/{id}, PUT /v1/meal-plans/{id}, DELETE /v1/meal-plans/{id} with ownership checks — `packages/api/src/meal-plans/meal-plans.controller.ts`
    - **Depends on**: T-002
    - **Implements**: FR-022 (read/update/delete)
    - **Acceptance**: 403 for non-owner access; 404 for missing plans; PUT rejects modification of locked plans; DELETE cascades to entries and nutrition rows.

---

## US-006-002: Assign Meals

Implements **FR-023**.

- [ ] **T-004** [P2] [US-006-002] Implement POST /v1/meal-plans/{id}/entries and DELETE /v1/meal-plans/{id}/entries/{entryId} — `packages/api/src/meal-plans/meal-plan-entries.controller.ts`
    - **Depends on**: T-002
    - **Implements**: FR-023 (assign/remove recipes)
    - **Acceptance**: Entry stores `recipeId`, `date`, `mealType`, `servings`, `notes`; POST triggers nutrition recalculation; DELETE removes entry and recalculates.

- [ ] **T-005** [P2] [US-006-002] Add validation for meal slot conflicts and recipe existence — `packages/api/src/meal-plans/meal-plan-entries.service.ts`
    - **Depends on**: T-004
    - **Implements**: FR-023 (validation layer)
    - **Acceptance**: 409 on duplicate recipe+date+mealType; 400 on recipe not in user's collection; 400 on date outside plan range.

- [ ] **T-006** [P2] [US-006-002] Handle orphaned entries when a recipe is deleted (mark `is_orphaned` instead of cascading) — `packages/api/src/meal-plans/meal-plan-entries.service.ts`
    - **Depends on**: T-004
    - **Implements**: plan.md §7 (resilience)
    - **Acceptance**: Entry remains with `isOrphaned=true` and `orphanedAt` timestamp; GET /v1/meal-plans/{id} includes orphaned entries flagged; nutrition calculation excludes orphaned entries.

---

## US-006-003: View Nutrition Summary

Implements **FR-024**.

- [ ] **T-007** [P2] [US-006-003] Build nutrition calculation service that aggregates recipe ingredients via 003 USDA data — `packages/services/nutrition/src/calculator.ts`
    - **Depends on**: T-004
    - **Implements**: FR-024 (aggregation engine)
    - **Acceptance**: Service fetches recipe ingredients (001), maps `usda_fdc_id` to nutrients (003), scales by servings, sums per day; cache-aside TTL 1h for USDA lookups.

- [ ] **T-008** [P2] [US-006-003] Implement GET /v1/meal-plans/{id}/nutrition endpoint returning daily + weekly totals — `packages/api/src/meal-plans/meal-plans.controller.ts`
    - **Depends on**: T-007
    - **Implements**: FR-024 (API contract)
    - **Acceptance**: Response matches plan.md §3 shape: `dailyNutrition[]` with per-meal breakdowns + `weekTotals`; recalculates on-demand within 500ms for 7-day plans.

- [ ] **T-009** [P2] [US-006-003] Unit tests for nutrition calculator with mocked USDA and recipe data — `packages/services/nutrition/src/__tests__/calculator.test.ts`
    - **Depends on**: T-007
    - **Implements**: FR-024 (test coverage)
    - **Acceptance**: ≥90% branch coverage; tests multi-day plans, serving scaling, orphaned entry exclusion, cache hit/miss paths.

---

## US-006-004: Complete Planning Workflow

Implements **SC-008**.

- [ ] **T-010** [P2] [US-006-004] Implement POST /v1/meal-plans/{id}/grocery-list to trigger 007 grocery list generation — `packages/api/src/meal-plans/meal-plans.controller.ts`
    - **Depends on**: T-004
    - **Implements**: SC-008 (grocery handoff)
    - **Acceptance**: Aggregates all plan entries' ingredients, deduplicates via 007 service, returns grocery list manifest; 400 if plan is empty; idempotent (same plan → same manifest).

- [ ] **T-011** [P2] [US-006-004] Add `is_locked` flag and locking endpoint PUT /v1/meal-plans/{id}/lock — `packages/api/src/meal-plans/meal-plans.controller.ts`
    - **Depends on**: T-003
    - **Implements**: plan.md schema (finalization signal)
    - **Acceptance**: Locked plan rejects entry modifications with 423; unlock requires explicit action; lock timestamp recorded.

- [ ] **T-012** [P2] [US-006-004] E2E Playwright test: create 7-day plan, assign 7 recipes, view nutrition, generate grocery list in under 10 minutes — `packages/apps/commise/web/e2e/meal-planning/workflow.spec.ts`
    - **Depends on**: T-008, T-010
    - **Implements**: SC-008 (end-to-end verification)
    - **Acceptance**: Test completes within simulated 10-minute user session; all assertions pass in CI.

---

## US-006-005: AI Suggestions (Premium)

Implements **FR-025**.

- [ ] **T-013** [P2] [US-006-005] Implement POST /v1/meal-plans/{id}/recipes/suggestions proxy to 005 AI service with SQS async fallback — `packages/api/src/meal-plans/ai-suggestions.controller.ts`
    - **Depends on**: T-004
    - **Implements**: FR-025 (AI integration)
    - **Acceptance**: Passes `planId`, `targetDate`, `mealType`, `preferences`, `macroTargets`; returns ranked recipe suggestions with match scores; 60s timeout with exponential backoff; premium gating returns 403 for non-premium users.

- [ ] **T-014** [P2] [US-006-005] Frontend UI for AI suggestion panel in meal slot context menu — `packages/apps/commise/web/src/components/meal-planning/AiSuggestionsPanel.tsx`
    - **Depends on**: T-013, T-012
    - **Implements**: FR-025 (UX)
    - **Acceptance**: Panel opens from slot overflow menu; displays 3–5 suggestions with preview cards; clicking suggestion assigns to slot and recalculates nutrition live.

---

## US-006-006: AI Auto-Generate Plan (Premium)

Implements **FR-026**.

- [ ] **T-015** [P2] [US-006-006] Implement POST /v1/meal-plans/{id}/auto-generate to draft full plan via 005 AI with user constraint input — `packages/api/src/meal-plans/ai-generation.controller.ts`
    - **Depends on**: T-002
    - **Implements**: FR-026 (auto-generation)
    - **Acceptance**: Accepts `preferences`, `dietaryRestrictions`, `macroTargets`, `excludedRecipes`; returns draft entries for all slots; does not overwrite existing entries unless `force=true`; premium gating.

- [ ] **T-016** [P2] [US-006-006] Frontend modal for auto-generate constraints and draft review before applying — `packages/apps/commise/web/src/components/meal-planning/AutoGenerateModal.tsx`
    - **Depends on**: T-015, T-012
    - **Implements**: FR-026 (UX)
    - **Acceptance**: Modal collects constraints, shows loading state, displays draft plan in calendar preview, allows accept (apply all) or reject (discard); accessible via `getByRole('dialog')`.

---

## US-006-007: Waste Optimization (Premium)

Implements **FR-027**.

- [ ] **T-017** [P2] [US-006-007] Implement POST /v1/meal-plans/{id}/optimize-waste to compute ingredient overlap swaps via 005 AI — `packages/api/src/meal-plans/waste-optimization.controller.ts`
    - **Depends on**: T-004
    - **Implements**: FR-027 (optimization engine)
    - **Acceptance**: Returns proposed swaps ranked by ingredient overlap increase; includes `wasteRisk` signal for perishable ingredients used only once; premium gating.

- [ ] **T-018** [P2] [US-006-007] Frontend UI to preview and accept/reject waste optimization proposals — `packages/apps/commise/web/src/components/meal-planning/WasteOptimizationPanel.tsx`
    - **Depends on**: T-017, T-012
    - **Implements**: FR-027 (UX)
    - **Acceptance**: Panel shows swap proposals with before/after ingredient overlap metrics; accept applies swap, reject dismisses with no plan change; perishable warnings highlighted with icon + text (not color alone).

---

## Cross-Cutting Tasks

- [ ] **T-019** [P2] [US-006-001–004] Implement drag-and-drop calendar UI with @dnd-kit/core + @dnd-kit/sortable — `packages/apps/commise/web/src/components/meal-planning/MealPlanCalendar.tsx`
    - **Depends on**: T-012
    - **Implements**: plan.md §4 (drag-and-drop UX)
    - **Acceptance**: Recipes draggable from sidebar to breakfast/lunch/dinner/snack slots; slots accept drops with visual feedback; keyboard accessible reordering; screen-reader announces drop results.

- [ ] **T-020** [P2] [US-006-003] Frontend nutrition summary sticky footer with live totals — `packages/apps/commise/web/src/components/meal-planning/NutritionSummary.tsx`
    - **Depends on**: T-008, T-012
    - **Implements**: FR-024 (live UX)
    - **Acceptance**: Footer shows daily and weekly calorie/protein/carbs/fat/fiber totals; updates within 300ms of slot change; color pairs with text labels per NFR-004.
      **Total Tasks**: 38

---

## Dependency Order

```
Phase 1 (DB/Schema) → Phase 2 (Backend CRUD) → Phase 3 (Nutrition) → Phase 4 (Frontend) → Phase 5 (Grocery) → Phase 6 (AI) → Phase 7 (Lock/Finalize) → Phase 8 (Tests)
```

---

## Phase 1 — Database Schema & Migration

> Prerequisite for all backend work. Maps to FR-022, FR-023, FR-024.

### TASK-001 · Create Drizzle schema for `meal_plans` table

**Story**: FR-022 — Users create meal plans for configurable date ranges
**Priority**: P1 (blocker)

- Define `meal_plans` table in Drizzle ORM schema file
- Fields: `id UUID PK`, `user_id UUID FK → users(id)`, `name TEXT`, `start_date DATE`, `end_date DATE`, `plan_type TEXT` (`'weekly' | 'biweekly' | 'custom'`), `is_locked BOOLEAN DEFAULT false`, `created_at TIMESTAMP`, `updated_at TIMESTAMP`
- Add `NOT NULL` constraints on `user_id`, `start_date`, `end_date`, `plan_type`
- Export TypeScript type `MealPlan` and `NewMealPlan` from schema

**Acceptance**: Schema compiles with `strict: true`; Drizzle `db:generate` produces valid SQL.

---

### TASK-002 · Create Drizzle schema for `meal_plan_entries` table

**Story**: FR-023 — Users assign recipes to meal slots
**Priority**: P1 (blocker)
**Depends on**: TASK-001

- Define `meal_plan_entries` table
- Fields: `id UUID PK`, `meal_plan_id UUID FK → meal_plans(id) ON DELETE CASCADE`, `recipe_id UUID FK → recipes(id)`, `meal_type TEXT` (`'breakfast' | 'lunch' | 'dinner' | 'snack'`), `date DATE`, `servings INT DEFAULT 1`, `notes TEXT`, `created_at TIMESTAMP`
- Add `orphaned BOOLEAN DEFAULT false` column for soft-delete when recipe is deleted (resilience requirement §7)
- Export `MealPlanEntry` and `NewMealPlanEntry` types

**Acceptance**: FK constraints correct; `orphaned` column present.

---

### TASK-003 · Create Drizzle schema for `meal_plan_nutrition` table

**Story**: FR-024 — Daily/weekly nutritional summaries
**Priority**: P1 (blocker)
**Depends on**: TASK-001

- Define `meal_plan_nutrition` table
- Fields: `meal_plan_id UUID FK → meal_plans(id) ON DELETE CASCADE`, `date DATE`, `calories_total DECIMAL`, `protein_g_total DECIMAL`, `carbs_g_total DECIMAL`, `fat_g_total DECIMAL`, `fiber_g_total DECIMAL`
- Composite PK: `(meal_plan_id, date)`
- Export `MealPlanNutrition` type

**Acceptance**: Composite PK defined; all decimal fields nullable (may be 0 if no USDA data).

---

### TASK-004 · Write and run DB migration for 006 tables

**Priority**: P1 (blocker)
**Depends on**: TASK-001, TASK-002, TASK-003

- Generate migration file via `drizzle-kit generate`
- Add all indexes from plan.md §8:
    - `idx_meal_plans_user_id ON meal_plans(user_id)`
    - `idx_meal_plans_dates ON meal_plans(start_date, end_date)`
    - `idx_meal_plan_entries_plan_id ON meal_plan_entries(meal_plan_id)`
    - `idx_meal_plan_entries_date ON meal_plan_entries(date)`
    - `idx_meal_plan_nutrition_plan_date ON meal_plan_nutrition(meal_plan_id, date)`
- Verify migration runs cleanly against local dev DB

**Acceptance**: `drizzle-kit migrate` succeeds; all 5 indexes present in DB.

---

## Phase 2 — Backend CRUD APIs

> Maps to FR-022, FR-023. All endpoints require Clerk session token (002 dependency).

### TASK-005 · Create `MealPlanModule` NestJS module scaffold

**Priority**: P1
**Depends on**: TASK-004

- Create `src/meal-plan/meal-plan.module.ts`
- Register `MealPlanController`, `MealPlanService`, `MealPlanRepository`
- Import `DrizzleModule` and `AuthModule` (002)
- Add JSDoc on module class (NFR-002)

**Acceptance**: Module compiles; no circular dependency errors.

---

### TASK-006 · Implement `MealPlanRepository` — CRUD for `meal_plans`

**Priority**: P1
**Depends on**: TASK-005

- Methods: `findAllByUser(userId)`, `findById(id, userId)`, `create(dto)`, `update(id, userId, dto)`, `delete(id, userId)`
- All queries scoped to `userId` (no cross-user data leakage)
- Use Drizzle query builder; no raw SQL
- Full JSDoc on all public methods (NFR-002)

**Acceptance**: Unit tests pass for all 5 methods; `userId` scoping verified.

---

### TASK-007 · Implement `MealPlanEntriesRepository` — CRUD for `meal_plan_entries`

**Priority**: P1
**Depends on**: TASK-005

- Methods: `addEntry(mealPlanId, dto)`, `removeEntry(entryId, mealPlanId)`, `listEntries(mealPlanId)`, `markOrphaned(recipeId)` (called when recipe deleted)
- `markOrphaned` sets `orphaned = true` for all entries referencing the deleted recipe
- JSDoc on all public methods

**Acceptance**: `markOrphaned` tested with a mock recipe deletion scenario.

---

### TASK-008 · Create DTOs for meal plan operations

**Priority**: P1
**Depends on**: TASK-005

- `CreateMealPlanDto`: `name`, `startDate`, `endDate`, `planType` — all validated with `class-validator`
- `UpdateMealPlanDto`: partial of above + `isLocked`
- `AddMealPlanEntryDto`: `recipeId`, `date`, `mealType`, `servings`, `notes?`
- Validate `mealType` is one of `breakfast | lunch | dinner | snack`
- Validate `startDate < endDate`
- Validate `servings >= 1`

**Acceptance**: Invalid payloads return 400 with descriptive messages; `strict: true` passes.

---

### TASK-009 · Implement `GET /v1/meal-plans` — list user's meal plans

**Priority**: P1
**Depends on**: TASK-006, TASK-008

- Auth guard applied (JWT from 002)
- Returns paginated list of `MealPlan` objects for authenticated user
- Response excludes other users' plans
- JSDoc on controller method

**Acceptance**: Returns 200 with array; 401 without token; empty array when no plans exist.

---

### TASK-010 · Implement `POST /v1/meal-plans` — create meal plan

**Priority**: P1
**Depends on**: TASK-006, TASK-008

- Validate `CreateMealPlanDto`
- Create plan with `userId` from JWT
- Return created `MealPlan` with empty `entries: []`

**Acceptance**: Returns 201 with plan; 400 on invalid dates; 401 without token.

---

### TASK-011 · Implement `GET /v1/meal-plans/{id}` — get plan with entries

**Priority**: P1
**Depends on**: TASK-006, TASK-007

- Fetch plan + all entries joined
- Return 404 if plan not found or belongs to different user
- Include `entries` array in response

**Acceptance**: Returns full plan with entries; 404 on wrong user or missing plan.

---

### TASK-012 · Implement `PUT /v1/meal-plans/{id}` — update meal plan

**Priority**: P1
**Depends on**: TASK-006, TASK-008

- Validate `UpdateMealPlanDto`
- Reject updates if `is_locked = true` (return 409 Conflict)
- Update `updated_at` timestamp

**Acceptance**: 409 returned when plan is locked; 200 on success.

---

### TASK-013 · Implement `DELETE /v1/meal-plans/{id}` — delete meal plan

**Priority**: P1
**Depends on**: TASK-006

- Cascade delete handled by DB FK constraint
- Return 204 on success; 404 if not found or wrong user

**Acceptance**: 204 returned; entries and nutrition rows cascade-deleted.

---

### TASK-014 · Implement `POST /v1/meal-plans/{id}/entries` — add recipe to plan

**Priority**: P1
**Depends on**: TASK-007, TASK-008

- Validate `AddMealPlanEntryDto`
- Reject if plan is locked (409)
- Reject if `recipeId` doesn't belong to user (403)
- Trigger nutrition recalculation (async, see TASK-019)

**Acceptance**: Entry created; 409 on locked plan; 403 on foreign recipe.

---

### TASK-015 · Implement `DELETE /v1/meal-plans/{id}/entries/{entryId}` — remove entry

**Priority**: P1
**Depends on**: TASK-007

- Verify entry belongs to the specified plan
- Reject if plan is locked (409)
- Trigger nutrition recalculation (async)

**Acceptance**: 204 on success; 409 on locked plan; 404 on missing entry.

---

## Phase 3 — Nutritional Aggregation

> Maps to FR-024. Depends on 003-usda-food-data integration.

### TASK-016 · Create `NutritionCalculatorService`

**Priority**: P1
**Depends on**: TASK-007

- Interface per plan.md §5:
    ```typescript
    interface NutritionCalculator {
        calculateDayNutrition(entries: MealPlanEntry[]): DayNutrition;
        calculateWeekNutrition(planId: UUID): WeekNutrition;
        triggerOnEntryAdd(entry: MealPlanEntry): void;
    }
    ```
- Fetch recipe ingredients from 001 service
- For each ingredient with `usda_fdc_id` → fetch nutrients from 003 (cache-aside, TTL 1h per plan.md §7)
- Sum per day → upsert `meal_plan_nutrition` row
- JSDoc on all public methods (NFR-002)

**Acceptance**: Calculates correct totals for a known recipe/ingredient fixture; cache hit avoids 003 call.

---

### TASK-017 · Implement `GET /v1/meal-plans/{id}/nutrition` — nutrition summary

**Priority**: P1
**Depends on**: TASK-016

- Return response shape from plan.md §3:
    - `planId`, `dateRange`, `dailyNutrition[]` (per-meal breakdown + daily totals), `weekTotals`
- If no nutrition data yet, return zeros (not 404)

**Acceptance**: Response matches schema; zeros returned for empty plan; 404 on missing plan.

---

### TASK-018 · Add recipe-deletion orphan handler

**Priority**: P2
**Depends on**: TASK-007

- Subscribe to recipe-deleted event (or hook into 001 delete endpoint)
- Call `MealPlanEntriesRepository.markOrphaned(recipeId)` on deletion
- Orphaned entries remain in plan but display as "Recipe unavailable"

**Acceptance**: Deleting a recipe marks all referencing entries as `orphaned = true`; plan still loads.

---

### TASK-019 · Async nutrition recalculation on entry add/remove

**Priority**: P2
**Depends on**: TASK-016

- On `POST /entries` or `DELETE /entries/{id}`, enqueue recalculation via SQS (or in-process async)
- Recalculation updates `meal_plan_nutrition` rows for affected date
- Handle 003 API unavailability gracefully (log, don't fail the entry operation)

**Acceptance**: Entry add/remove returns immediately; nutrition row updated asynchronously; 003 failure doesn't block entry mutation.

---

## Phase 4 — Frontend Calendar UI

> Maps to FR-022, FR-023, FR-024. Uses `@dnd-kit/core` + `@dnd-kit/sortable`.

### TASK-020 · Install and configure `@dnd-kit/core` + `@dnd-kit/sortable`

**Priority**: P1
**Depends on**: (none — frontend setup)

- `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- Verify no peer dependency conflicts with existing React version
- Add to `package.json` under correct workspace

**Acceptance**: Package installs; no peer dep warnings; TypeScript types resolve.

---

### TASK-021 · Build `<MealPlanCalendar>` container component

**Priority**: P1
**Depends on**: TASK-020

- Component architecture per plan.md §4:
    ```
    <MealPlanCalendar>
      ├── <WeekStrip> (Mon-Sun columns)
      │   └── <DayColumn> × 7
      │       ├── <BreakfastSlot>
      │       ├── <LunchSlot>
      │       ├── <DinnerSlot>
      │       └── <SnackSlot>
      ├── <RecipeSidebar>
      └── <NutritionSummary>
    ```
- Wrap with `<DndContext>` from `@dnd-kit/core`
- Accessible name on calendar region: `role="region" aria-label="Meal Plan Calendar"` (NFR-003)
- JSDoc on component (NFR-002)

**Acceptance**: Renders without errors; accessible name queryable via `getByRole('region', { name: /meal plan calendar/i })`.

---

### TASK-022 · Build `<DayColumn>` and meal slot drop targets

**Priority**: P1
**Depends on**: TASK-021

- Each slot (`<BreakfastSlot>`, etc.) is a `useDroppable` target
- Slot displays assigned recipe card or empty state ("+ Add recipe")
- Empty state has accessible label: `aria-label="Add recipe to {mealType} on {date}"` (NFR-003)
- Color is NOT the sole indicator of slot state — use icon + label (NFR-004)

**Acceptance**: Drop targets accept dragged recipe cards; empty state accessible; no color-only state.

---

### TASK-023 · Build `<RecipeSidebar>` with draggable recipe cards

**Priority**: P1
**Depends on**: TASK-021

- Fetch user's recipes from 001 API
- Each recipe card is `useDraggable` from `@dnd-kit/core`
- Support search/filter within sidebar
- Accessible: each card has `aria-label="Drag {recipeName} to a meal slot"` (NFR-003)

**Acceptance**: Cards draggable; sidebar searchable; accessible labels present.

---

### TASK-024 · Implement drag-and-drop assignment logic

**Priority**: P1
**Depends on**: TASK-022, TASK-023

- On `onDragEnd`: extract `recipeId`, `date`, `mealType` from drag event
- Call `POST /v1/meal-plans/{id}/entries` API
- Optimistic UI update; rollback on API error
- Handle touch and mouse (dnd-kit supports both natively)

**Acceptance**: Dragging recipe to slot creates entry; optimistic update visible; error rolls back.

---

### TASK-025 · Build `<NutritionSummary>` sticky footer

**Priority**: P1
**Depends on**: TASK-017 (API), TASK-021 (component tree)

- Display daily totals for selected day: calories, protein, carbs, fat
- Display weekly totals
- Poll or refetch after entry mutations
- Accessible: `role="complementary" aria-label="Nutrition Summary"` (NFR-003)
- Use icon + text for each macro (not color alone) (NFR-004)

**Acceptance**: Totals update after drag-and-drop; accessible role present; icons accompany values.

---

### TASK-026 · Build meal plan creation flow (date range picker)

**Priority**: P1
**Depends on**: TASK-010 (API)

- Form: `name`, `startDate`, `endDate`, `planType` (weekly/biweekly/custom)
- Validate `startDate < endDate` client-side
- On submit: `POST /v1/meal-plans` → redirect to calendar view
- Accessible form labels (NFR-003)

**Acceptance**: Form validates dates; creates plan; redirects to calendar; 400 errors displayed.

---

### TASK-027 · Handle locked plan state in UI

**Priority**: P2
**Depends on**: TASK-012, TASK-021

- When `is_locked = true`: disable all drag-and-drop, show "Plan finalized" banner
- Lock/unlock toggle button (calls `PUT /v1/meal-plans/{id}` with `isLocked`)
- Locked state uses icon + text label (not color alone) (NFR-004)

**Acceptance**: Locked plan disables DnD; banner visible; icon + text label present.

---

## Phase 5 — Grocery List Generation

> Maps to plan.md §5 integration with 007-grocery-lists.

### TASK-028 · Implement `POST /v1/meal-plans/{id}/grocery-list` endpoint

**Priority**: P2
**Depends on**: TASK-011

- Fetch all entries for the plan
- Aggregate ingredients across all recipes (dedup by ingredient name/usda_fdc_id)
- Scale quantities by `servings` per entry
- Return grocery list manifest (ingredient name, quantity, unit)
- Does NOT create a 007 grocery list — returns manifest for user to confirm

**Acceptance**: Returns aggregated ingredient list; quantities scaled by servings; duplicates merged.

---

### TASK-029 · Add "Generate Grocery List" button in UI

**Priority**: P2
**Depends on**: TASK-028, TASK-021

- Button in `<MealPlanCalendar>` header
- Calls `POST /v1/meal-plans/{id}/grocery-list`
- Displays manifest in modal/drawer for user review
- "Create Grocery List" CTA hands off to 007 flow
- Accessible: button has descriptive label (NFR-003)

**Acceptance**: Button triggers API; manifest displayed; CTA links to 007.

---

## Phase 6 — AI Meal Suggestions (Premium)

> Maps to FR-025, FR-026, FR-027. Integrates via 005-ai-integration. Premium gated.

### TASK-030 · Implement `POST /v1/meal-plans/{id}/recipes/suggestions` endpoint

**Priority**: P2 (Premium)
**Depends on**: TASK-011

- Request shape per plan.md §6: `planId`, `targetDate`, `mealType`, `preferences`, `macroTargets?`
- Call 005 AI service (async SQS pattern, 60s timeout, exponential backoff per plan.md §7)
- Return ranked recipe suggestions with match scores
- Gate behind subscription check (010-subscriptions)

**Acceptance**: Returns ranked suggestions; 402 for non-premium users; 504 on AI timeout.

---

### TASK-031 · Implement AI auto-generation endpoint

**Priority**: P2 (Premium)
**Depends on**: TASK-030

- `POST /v1/meal-plans/{id}/auto-generate`
- Accepts user constraints (dietary restrictions, macro targets, preferred cuisines)
- Calls 005 AI to generate full week plan
- Returns draft plan entries for user review before committing
- Gate behind subscription check

**Acceptance**: Returns full week of suggested entries; user can accept/reject before saving.

---

### TASK-032 · Implement food waste optimization endpoint

**Priority**: P3 (Premium)
**Depends on**: TASK-030

- `POST /v1/meal-plans/{id}/optimize-waste`
- Analyzes current entries for ingredient overlap opportunities
- Calls 005 AI for swap suggestions
- Returns suggested rearrangements with shared ingredient counts
- Gate behind subscription check

**Acceptance**: Returns suggestions with ingredient overlap metrics; 402 for non-premium.

---

### TASK-033 · Add AI suggestion UI in `<RecipeSidebar>`

**Priority**: P2 (Premium)
**Depends on**: TASK-030, TASK-023

- "Suggest for this slot" button on each meal slot (visible to premium users)
- Calls suggestions API with slot context
- Displays ranked suggestions in sidebar panel
- Loading state while AI processes (async)
- Premium upsell for non-premium users (NFR-003 accessible)

**Acceptance**: Suggestions load for premium users; upsell shown for free users; loading state visible.

---

## Phase 7 — Lock / Finalize Flow

> Maps to plan.md §10 step 6.

### TASK-034 · Implement plan lock/unlock logic

**Priority**: P2
**Depends on**: TASK-012

- `PUT /v1/meal-plans/{id}` with `{ isLocked: true }` finalizes plan
- Locked plans: reject all entry mutations (409)
- Locked plans: allow grocery list generation (read-only)
- Unlock: `{ isLocked: false }` re-enables editing

**Acceptance**: Locked plan rejects entry add/remove with 409; grocery list still works; unlock re-enables edits.

---

## Phase 8 — Tests

> NFR-001 through NFR-004 compliance. All tests must pass before merge.

### TASK-035 · Unit tests for `NutritionCalculatorService`

**Priority**: P1
**Depends on**: TASK-016

- Test `calculateDayNutrition` with known recipe/ingredient fixtures
- Test cache-aside behavior (mock 003 service)
- Test zero-nutrition case (no USDA data for ingredients)
- Test multi-recipe day aggregation

**Acceptance**: ≥90% branch coverage on `NutritionCalculatorService`.

---

### TASK-036 · Integration tests for meal plan CRUD endpoints

**Priority**: P1
**Depends on**: TASK-009 through TASK-015

- Test all 7 CRUD endpoints with real DB (test container or local PG)
- Test `userId` scoping (user A cannot access user B's plans)
- Test locked plan rejection (409)
- Test orphaned entry behavior

**Acceptance**: All endpoints return correct status codes; cross-user access returns 403/404.

---

### TASK-037 · Playwright E2E test — full meal plan workflow

**Priority**: P1
**Depends on**: TASK-021 through TASK-026

- Create 7-day meal plan via UI
- Drag 3 recipes to different slots
- Verify nutrition summary updates
- Generate grocery list manifest
- Verify accessible names on all interactive elements (NFR-003)
- Verify no color-only state indicators (NFR-004)

**Acceptance**: Full workflow completes in under 10 minutes (SC-008); all `getByRole`/`getByLabel` queries succeed.

---

### TASK-038 · TypeScript strict-mode audit

**Priority**: P1
**Depends on**: All implementation tasks

- Run `tsc --strict --noEmit` across all 006 source files
- Resolve any `any` types outside explicitly marked test doubles (NFR-001)
- Verify all exported functions/interfaces have JSDoc (NFR-002)

**Acceptance**: Zero TypeScript errors; zero undocumented exports.

---

## Summary Table

| Task     | Phase     | Priority | Depends On | Story/Req   |
| -------- | --------- | -------- | ---------- | ----------- |
| TASK-001 | Schema    | P1       | —          | FR-022      |
| TASK-002 | Schema    | P1       | 001        | FR-023      |
| TASK-003 | Schema    | P1       | 001        | FR-024      |
| TASK-004 | Schema    | P1       | 001–003    | All         |
| TASK-005 | Backend   | P1       | 004        | FR-022      |
| TASK-006 | Backend   | P1       | 005        | FR-022      |
| TASK-007 | Backend   | P1       | 005        | FR-023      |
| TASK-008 | Backend   | P1       | 005        | FR-022/023  |
| TASK-009 | Backend   | P1       | 006, 008   | FR-022      |
| TASK-010 | Backend   | P1       | 006, 008   | FR-022      |
| TASK-011 | Backend   | P1       | 006, 007   | FR-022/023  |
| TASK-012 | Backend   | P1       | 006, 008   | FR-022      |
| TASK-013 | Backend   | P1       | 006        | FR-022      |
| TASK-014 | Backend   | P1       | 007, 008   | FR-023      |
| TASK-015 | Backend   | P1       | 007        | FR-023      |
| TASK-016 | Nutrition | P1       | 007        | FR-024      |
| TASK-017 | Nutrition | P1       | 016        | FR-024      |
| TASK-018 | Nutrition | P2       | 007        | FR-023      |
| TASK-019 | Nutrition | P2       | 016        | FR-024      |
| TASK-020 | Frontend  | P1       | —          | FR-022      |
| TASK-021 | Frontend  | P1       | 020        | FR-022      |
| TASK-022 | Frontend  | P1       | 021        | FR-023      |
| TASK-023 | Frontend  | P1       | 021        | FR-023      |
| TASK-024 | Frontend  | P1       | 022, 023   | FR-023      |
| TASK-025 | Frontend  | P1       | 017, 021   | FR-024      |
| TASK-026 | Frontend  | P1       | 010        | FR-022      |
| TASK-027 | Frontend  | P2       | 012, 021   | FR-022      |
| TASK-028 | Grocery   | P2       | 011        | SC-008      |
| TASK-029 | Grocery   | P2       | 028, 021   | SC-008      |
| TASK-030 | AI        | P2       | 011        | FR-025      |
| TASK-031 | AI        | P2       | 030        | FR-026      |
| TASK-032 | AI        | P3       | 030        | FR-027      |
| TASK-033 | AI        | P2       | 030, 023   | FR-025      |
| TASK-034 | Lock      | P2       | 012        | FR-022      |
| TASK-035 | Tests     | P1       | 016        | NFR-001     |
| TASK-036 | Tests     | P1       | 009–015    | NFR-001     |
| TASK-037 | Tests     | P1       | 021–026    | SC-008      |
| TASK-038 | Tests     | P1       | All        | NFR-001/002 |

---

## Coverage Check

| Requirement                    | Covered By                  |
| ------------------------------ | --------------------------- |
| FR-022 (create meal plans)     | TASK-001, 005–010, 021, 026 |
| FR-023 (assign recipes)        | TASK-002, 007, 014, 022–024 |
| FR-024 (nutritional summaries) | TASK-003, 016–017, 025      |
| FR-025 (AI suggestions)        | TASK-030, 033               |
| FR-026 (AI auto-generation)    | TASK-031                    |
| FR-027 (waste optimization)    | TASK-032                    |
| SC-008 (10-min workflow)       | TASK-037                    |
| NFR-001 (strict TS)            | TASK-038                    |
| NFR-002 (JSDoc)                | TASK-038                    |
| NFR-003 (accessible names)     | TASK-021–026, 037           |
| NFR-004 (no color-only state)  | TASK-022, 025, 027          |
