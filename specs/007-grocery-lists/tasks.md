# Tasks: Feature 007 — Grocery Lists & Online Ordering

**Feature**: `007-grocery-lists`
**Generated**: 2026-06-02
**Source Artifacts**: spec.md, plan.md, product-spec/product-spec.md
**Total Tasks**: 46

---

## US Reference

| US-ID  | Title                                          | FRs            |
| ------ | ---------------------------------------------- | -------------- |
| US-001 | Generate List from Meal Plan                   | FR-028         |
| US-002 | Deduplicate and Sum Ingredient Quantities      | FR-028         |
| US-003 | Mark "Already Have" Items                      | FR-029         |
| US-004 | Review List in Aisle-Oriented Grouping         | FR-028, FR-029 |
| US-005 | Configure Store Connection                     | FR-030         |
| US-006 | Guided Setup on Order Attempt                  | FR-030         |
| US-007 | Create Order Handoff from List (Premium)       | FR-031         |
| US-008 | Pre-Order Review for Mapped vs Unmapped Items  | FR-031         |
| US-009 | Household List Sharing and Sync                | —              |
| US-010 | Voice Add for Quick Capture                    | —              |
| US-011 | Access Shopping Lists from Dedicated Page      | FR-032         |
| US-012 | Navigate Between Meal Plans and Shopping Lists | FR-033         |

---

## Dependency Graph (only tasks in this file)

```
[T-001] DB Migration
    ↓
[T-002] Drizzle Schema
    ↓
[T-003] Unit Conversion Utility (shared)
    ↓
[T-004] Ingredient Aggregator Service
    ↓
[T-005] Pantry Service
    ↓
[T-006..T-012] Core API Endpoints
    ↓
[T-013..T-015] Store Mapping (Walmart — adapter first)
    ↓
[T-016..T-018] Store Mapping (Instacart — adapter second)
    ↓
[T-019] Order Status Polling
    ↓
[T-020] Premium Feature Guard (010 gating)
    ↓
[T-021..T-024] NestJS Module Wiring & Guards
    ↓
[T-025..T-028] Web UI (Next.js)          [T-039] Dedicated Shopping Lists Page (Web)
    ↓                                         ↓
[T-041..T-044] Mobile UI (Expo/RN)       [T-040] Meal Plan Cross-Links (Web + 006 view)
    ↓
[T-045..T-046] Mobile E2E Tests
    ↓
[T-029..T-038] Tests & Validation
```

> **Store adapter note**: T-013..T-018 implement the adapter code and can be built and unit-tested with mocks. They MUST NOT be marked complete until a real API key or sandbox credential is available for integration testing against the actual store API.

---

## US-001 — Generate List from Meal Plan

- [ ] **T-001** [P1] [US-001] Create DB migration for grocery_lists, grocery_list_items, user_pantry_items, grocery_product_map — `packages/api/migrations/007_grocery_lists.sql`
    - Depends on: 006-meal-planning migration (meal_plans table must exist)
    - Implements: FR-028
    - Acceptance: Migration runs cleanly; tables created with correct FKs and indexes.

- [ ] **T-002** [P1] [US-001] Define Drizzle ORM schemas for all four tables — `packages/api/src/db/schema/grocery-lists.ts`
    - Depends on: T-001
    - Implements: FR-028
    - Acceptance: `tsc --noEmit` passes; schema matches plan.md Section 2.

- [ ] **T-003** [P1] [US-001] Build shared culinary-units utility (parse, toBaseUnit, toDisplayUnit, density map) — `packages/shared/src/culinary-units.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Unit tests pass for volume↔mass conversions (flour, sugar, butter, oil, milk); strict mode, JSDoc on all exports.

- [ ] **T-004** [P1] [US-001] Implement IngredientAggregatorService (aggregate, normalizeUnit, deduplicate) — `packages/services/grocery-lists/src/ingredient-aggregator.service.ts`
    - Depends on: T-003
    - Implements: FR-028
    - Acceptance: "2 cups flour" + "100g flour" = ~315g flour in test; deduplication collapses same fdc_id to single line.

- [ ] **T-005** [P1] [US-001] Implement PantryService (add/remove/get/subtractFromList/pruneExpired) — `packages/services/grocery-lists/src/pantry.service.ts`
    - Depends on: T-002
    - Implements: FR-028, FR-029
    - Acceptance: Items in user_pantry_items marked as is_pantry in list; expired items pruned on @Cron schedule.

- [ ] **T-006** [P1] [US-001] POST /v1/grocery-lists endpoint — generate list from meal plan — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-004, T-005
    - Implements: FR-028
    - Acceptance: Scenario 1 from spec passes; empty meal plan returns 200 with empty items array; SC-004 timing target.

- [ ] **T-007** [P1] [US-001] GET /v1/grocery-lists endpoint — list user's grocery lists — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Returns only authenticated user's lists; cursor-based pagination works.

- [ ] **T-008** [P1] [US-001] GET /v1/grocery-lists/:id endpoint — get list with items — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Returns all items sorted by sort_order then category; 404 if not found or wrong user.

---

## US-002 — Deduplicate and Sum Ingredient Quantities

- [ ] **T-004** [P1] [US-002] _(shared with US-001)_ IngredientAggregatorService deduplication — `packages/services/grocery-lists/src/ingredient-aggregator.service.ts`
    - Depends on: T-003
    - Implements: FR-028
    - Acceptance: Same fdc_id from multiple recipes collapses to single line with summed grams; unit display is grocery-friendly.

- [ ] **T-025** [P2] [US-002] Web UI: grocery list page with category-grouped items — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-006, T-008
    - Implements: FR-028
    - Acceptance: Items grouped by category; each item shows display name + quantity display + category badge; accessible (NFR-003, NFR-004).

- [ ] **T-041** [P2] [US-002] Mobile UI: grocery list screen with category-grouped items — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-006, T-008
    - Mirrors: T-025
    - Implements: FR-028
    - Acceptance: Items grouped by category; each item shows display name + quantity display + category badge; accessible.

---

## US-003 — Mark "Already Have" Items

- [ ] **T-009** [P1] [US-003] PUT /v1/grocery-lists/:id endpoint — batch update items (toggle is_pantry, is_ordered, sort_order) — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-029
    - Acceptance: Scenario 3 from spec passes; pantry items excluded from "to order" count; 403 if wrong user.

- [ ] **T-011** [P1] [US-003] POST /v1/grocery-lists/:id/items/:itemId/pantry endpoint — mark as pantry — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-029
    - Acceptance: 200 on success; 404 if item missing; pantry flag persisted.

- [ ] **T-012** [P1] [US-003] DELETE /v1/grocery-lists/:id/items/:itemId/pantry endpoint — remove pantry flag — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-029
    - Acceptance: 200 on success; 404 if item missing; flag removed.

- [ ] **T-026** [P2] [US-003] Web UI: pantry toggle per item (optimistic update, strikethrough + muted + icon) — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-011, T-012, T-025
    - Implements: FR-029
    - Acceptance: Scenario 3 passes in Playwright; summary counter updates in real-time.

- [ ] **T-042** [P2] [US-003] Mobile UI: pantry toggle per item (optimistic update, strikethrough + muted + icon) — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-011, T-012, T-041
    - Mirrors: T-026
    - Implements: FR-029
    - Acceptance: Scenario 3 passes in Detox/Maestro; summary counter updates in real-time.

---

## US-004 — Review List in Aisle-Oriented Grouping

- [ ] **T-025** [P2] [US-004] _(shared with US-002)_ Web grocery list page with aisle grouping — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-006, T-008
    - Implements: FR-028, FR-029
    - Acceptance: Items grouped by category; full workflow completable in under 10 minutes for 7-day plan (SC-008).

- [ ] **T-041** [P2] [US-004] _(shared with US-002)_ Mobile grocery list screen with aisle grouping — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-006, T-008
    - Mirrors: T-025
    - Implements: FR-028, FR-029
    - Acceptance: Items grouped by category; one-handed check-off interactions supported.

---

## US-005 — Configure Store Connection

- [ ] **T-013** [P2] [US-005] Walmart adapter: searchByIngredient + createCart + checkout — `packages/services/grocery-lists/src/adapters/walmart.adapter.ts`
    - Depends on: T-004
    - Implements: FR-030
    - Acceptance: Adapter unit tests pass with mocks; 10s timeout configured; circuit breaker after 5 failures.

- [ ] **T-014** [P2] [US-005] ProductMappingService: USDA fdc_id → store SKU lookup + cache — `packages/services/grocery-lists/src/product-mapping.service.ts`
    - Depends on: T-013
    - Implements: FR-030
    - Acceptance: Returns walmart_sku + price for known fdc_id; null for unmapped items; JSONB store_sku persisted.

- [ ] **T-016** [P2] [US-005] Instacart adapter: OAuth authorize + searchProducts + createOrder — `packages/services/grocery-lists/src/adapters/instacart.adapter.ts`
    - Depends on: T-014
    - Implements: FR-030
    - Acceptance: Adapter unit tests pass with mocks; OAuth flow mocked; 10s timeout. _⚠️ Cannot complete integration testing without sandbox credentials._

- [ ] **T-027** [P2] [US-005] Web UI: store connection section (Walmart API key entry, Instacart OAuth, disconnect) — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-016, T-025
    - Implements: FR-030
    - Acceptance: Connected state shows store name + "Disconnect" option; unconnected state shows setup prompt.

- [ ] **T-043** [P2] [US-005] Mobile UI: store connection screen (bottom sheet/modal with Walmart key entry, Instacart OAuth) — `packages/apps/commise/mobile/app/store-connection.tsx`
    - Depends on: T-016, T-041
    - Mirrors: T-027
    - Implements: FR-030
    - Acceptance: OAuth redirect and callback work end-to-end on mobile. _⚠️ Instacart path cannot be fully accepted without sandbox credentials._

---

## US-006 — Guided Setup on Order Attempt

- [ ] **T-027** [P2] [US-006] _(shared with US-005)_ Web UI shows guided setup when user attempts order without configured store — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-016, T-025
    - Implements: FR-030
    - Acceptance: Scenario 5 from spec passes: user without connected store sees setup guidance on order attempt.

- [ ] **T-043** [P2] [US-006] _(shared with US-005)_ Mobile UI shows guided setup when user attempts order without configured store — `packages/apps/commise/mobile/app/store-connection.tsx`
    - Depends on: T-016, T-041
    - Mirrors: T-027
    - Implements: FR-030
    - Acceptance: Scenario 5 passes on mobile.

---

## US-007 — Create Order Handoff from List (Premium)

- [ ] **T-015** [P2] [US-007] Walmart adapter: checkout handoff URL generation — `packages/services/grocery-lists/src/adapters/walmart.adapter.ts`
    - Depends on: T-013
    - Implements: FR-031
    - Acceptance: Returns valid checkoutUrl for cart of mapped items; unmapped items excluded from cart.

- [ ] **T-017** [P2] [US-007] Instacart adapter: order creation + checkout handoff — `packages/services/grocery-lists/src/adapters/instacart.adapter.ts`
    - Depends on: T-016
    - Implements: FR-031
    - Acceptance: Returns orderId + checkoutUrl for mapped items; unmapped items excluded. _⚠️ Integration testing blocked without sandbox credentials._

- [ ] **T-018** [P2] [US-007] StoreMappingRegistry: adapter selection (walmart | instacart | null) — `packages/services/grocery-lists/src/adapters/registry.ts`
    - Depends on: T-015, T-017
    - Implements: FR-030, FR-031
    - Acceptance: Resolves correct adapter by store name; returns null if no store configured.

- [ ] **T-019** [P2] [US-007] Order status polling service (polls store API, updates list status: pending | ready | unavailable) — `packages/services/grocery-lists/src/order-status.service.ts`
    - Depends on: T-018
    - Implements: FR-031
    - Acceptance: Polling runs on interval; status transitions recorded; unavailable shown on store API failure.

- [ ] **T-020** [P2] [US-007] PremiumOrderingGuard: gate order routes behind 010 subscription check — `packages/api/src/guards/premium-ordering.guard.ts`
    - Depends on: 010-subscriptions (subscription check service)
    - Implements: FR-031
    - Acceptance: Free users receive 403 with upgrade message; premium users pass through.

- [ ] **T-028** [P2] [US-007] Web UI: "Order Groceries" button (disabled + upgrade prompt for free users), pre-order review, checkout URL, status polling — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-027
    - Implements: FR-031
    - Acceptance: Scenario 4 from spec passes in Playwright; premium gate shows upgrade prompt for free users.

- [ ] **T-044** [P2] [US-007] Mobile UI: "Order Groceries" button (disabled + upgrade prompt), pre-order review bottom sheet, checkout URL in system browser, status polling — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-043
    - Mirrors: T-028
    - Implements: FR-031
    - Acceptance: Scenario 4 passes on mobile; premium gate shows upgrade prompt for free users.

---

## US-008 — Pre-Order Review for Mapped vs Unmapped Items

- [ ] **T-028** [P2] [US-008] _(shared with US-007)_ Web pre-order review: mapped vs unmapped items with manual selection — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-027
    - Implements: FR-031
    - Acceptance: Mapped items shown with store price; unmapped items shown for manual selection or skip.

- [ ] **T-044** [P2] [US-008] _(shared with US-007)_ Mobile pre-order review: mapped vs unmapped in scrollable bottom sheet — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-043
    - Mirrors: T-028
    - Implements: FR-031
    - Acceptance: Mapped items shown with store price; unmapped items shown for manual selection or skip.

---

## US-011 — Access Shopping Lists from Dedicated Page

- [ ] **T-039** [P2] [US-011] Web: dedicated Shopping Lists page at /shopping-lists — list all lists, paginated, create standalone or from meal plan picker — `packages/apps/commise/web/app/shopping-lists/page.tsx`
    - Depends on: T-006, T-007, T-008
    - Implements: FR-032
    - Acceptance: SC-009 — user can reach page from main nav and create a list without visiting a meal plan first; accessible (NFR-003).

- [ ] **T-045** [P2] [US-011] Mobile: Shopping Lists tab/screen — list all lists, create standalone or from meal plan picker — `packages/apps/commise/mobile/app/shopping-lists.tsx`
    - Depends on: T-006, T-007, T-008, T-041
    - Mirrors: T-039
    - Implements: FR-032
    - Acceptance: SC-009 on mobile; user can reach from main nav and create a list without visiting a meal plan first.

---

## US-012 — Navigate Between Meal Plans and Shopping Lists

- [ ] **T-040** [P2] [US-012] Web + 006: meal plan / shopping list cross-links — grocery list shows "From meal plan" back-link; meal plan shows associated grocery lists — `packages/apps/commise/web/app/meal-plans/[id]/page.tsx`, `packages/apps/commise/web/app/shopping-lists/[id]/page.tsx`
    - Depends on: T-025, T-039
    - Implements: FR-033
    - Acceptance: Grocery list shows back-link to meal plan when meal_plan_id set; deleted meal plan shows "no longer available"; meal plan detail shows associated lists.

- [ ] **T-046** [P2] [US-012] Mobile: meal plan / shopping list cross-links — `packages/apps/commise/mobile/app/meal-plan.tsx`, `packages/apps/commise/mobile/app/shopping-lists/[id].tsx`
    - Depends on: T-041, T-045
    - Mirrors: T-040
    - Implements: FR-033
    - Acceptance: Same as T-040 on mobile; both links work on web and mobile.

---

## Cross-Cutting — NestJS Module Wiring

- [ ] **T-021** [P1] [all] GroceryListsModule wiring with imports (Drizzle, Pantry, Aggregator, ProductMapping, Adapters) — `packages/api/src/grocery-lists/grocery-lists.module.ts`
    - Depends on: T-002, T-004, T-005, T-014
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: Module imports/exports correct; `tsc --noEmit` passes; no circular deps.

- [ ] **T-022** [P1] [all] GroceryListsController: register all 9 endpoints with AuthMiddleware and PremiumOrderingGuard — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-021
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: All routes registered; Swagger docs generated; guards applied to correct routes.

- [ ] **T-023** [P1] [all] GroceryListsService: thin orchestration layer (aggregator + pantry + mapping + Drizzle CRUD) — `packages/api/src/grocery-lists/grocery-lists.service.ts`
    - Depends on: T-004, T-005, T-014
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: All methods have JSDoc; no business logic in controller; service methods unit-tested.

- [ ] **T-024** [P1] [all] DTOs: CreateGroceryListDto, UpdateGroceryListItemsDto, GroceryListResponseDto, GroceryListItemDto, OrderResponseDto — `packages/api/src/grocery-lists/dto/`
    - Depends on: T-002
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: class-validator decorators on all fields; class-transformer @Expose(); invalid requests return 400 with field-level errors.

---

## Tests & Validation

- [ ] **T-029** [P1] [all] Unit tests: culinary-units utility — `packages/shared/src/culinary-units.spec.ts`
    - Depends on: T-003
    - Acceptance: 100% branch coverage for parse, toBaseUnit, toDisplayUnit.

- [ ] **T-030** [P1] [all] Unit tests: IngredientAggregatorService — `packages/services/grocery-lists/src/ingredient-aggregator.service.spec.ts`
    - Depends on: T-004
    - Acceptance: Coverage for deduplication, unit normalization, empty input, unknown density fallback.

- [ ] **T-031** [P1] [all] Unit tests: PantryService — `packages/services/grocery-lists/src/pantry.service.spec.ts`
    - Depends on: T-005
    - Acceptance: Coverage for add/remove/get/subtractFromList/pruneExpired; expired items pruned correctly.

- [ ] **T-032** [P1] [all] Unit tests: ProductMappingService + Walmart adapter — `packages/services/grocery-lists/src/adapters/walmart.adapter.spec.ts`
    - Depends on: T-014
    - Acceptance: Coverage for search, cart creation, checkout; circuit breaker behavior verified.

- [ ] **T-033** [P1] [all] Unit tests: GroceryListsController — `packages/api/src/grocery-lists/grocery-lists.controller.spec.ts`
    - Depends on: T-022
    - Acceptance: All 9 endpoints tested; auth guards mocked; 404/403 cases covered.

- [ ] **T-034** [P1] [all] Unit tests: GroceryListsService — `packages/api/src/grocery-lists/grocery-lists.service.spec.ts`
    - Depends on: T-023
    - Acceptance: Coverage for generate, list, get, update, delete, order, status; JSDoc verified.

- [ ] **T-035** [P1] [all] Playwright E2E: grocery list generation + pantry toggle + aisle grouping — `packages/apps/commise/web/e2e/grocery-lists.spec.ts`
    - Depends on: T-025, T-026
    - Acceptance: Scenario 1, 2, 3 from spec pass; SC-008 timing under 10 minutes for 7-day plan.

- [ ] **T-036** [P1] [all] Playwright E2E: dedicated Shopping Lists page + cross-links — `packages/apps/commise/web/e2e/shopping-lists.spec.ts`
    - Depends on: T-039, T-040
    - Acceptance: SC-009 passes; user reaches /shopping-lists from main nav, creates list without visiting meal plan.

- [ ] **T-037** [P1] [all] Playwright E2E: store connection + online ordering (premium gating) — `packages/apps/commise/web/e2e/grocery-ordering.spec.ts`
    - Depends on: T-027, T-028
    - Acceptance: Scenario 4, 5 from spec pass; premium gate blocks free users; checkout URL returned.

- [ ] **T-038** [P1] [all] Mobile E2E: Detox/Maestro — grocery list generation + pantry toggle + aisle grouping — `packages/apps/commise/mobile/e2e/grocery-lists.test.js`
    - Depends on: T-041, T-042
    - Acceptance: Scenario 1, 2, 3 from spec pass on mobile; one-handed interactions verified.

- [ ] **T-046** [P2] [US-012] _(also listed above)_ Mobile: meal plan / shopping list cross-links E2E — `packages/apps/commise/mobile/e2e/shopping-lists.test.js`
    - Depends on: T-045
    - Acceptance: Cross-link navigation works on mobile; meal plan shows associated lists.

---

## Additional API Endpoints

- [ ] **T-010** [P2] [US-001] DELETE /v1/grocery-lists/:id — delete list — `packages/api/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: 204 on success; 403 if wrong user; cascade deletes items.

---

## Summary Table

| Task  | Priority | US         | FR         | Package Path                                    | Depends On                        |
| ----- | -------- | ---------- | ---------- | ----------------------------------------------- | --------------------------------- |
| T-001 | P1       | US-001     | FR-028     | `packages/api/migrations/`                      | 006 migration                     |
| T-002 | P1       | US-001     | FR-028     | `packages/api/src/db/schema/`                   | T-001                             |
| T-003 | P1       | US-001     | FR-028     | `packages/shared/src/`                          | T-002                             |
| T-004 | P1       | US-001/002 | FR-028     | `packages/services/grocery-lists/src/`          | T-003                             |
| T-005 | P1       | US-001/003 | FR-028/029 | `packages/services/grocery-lists/src/`          | T-002                             |
| T-006 | P1       | US-001     | FR-028     | `packages/api/src/grocery-lists/`               | T-004, T-005                      |
| T-007 | P1       | US-001     | FR-028     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-008 | P1       | US-001     | FR-028     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-009 | P1       | US-003     | FR-029     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-010 | P2       | US-001     | FR-028     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-011 | P1       | US-003     | FR-029     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-012 | P1       | US-003     | FR-029     | `packages/api/src/grocery-lists/`               | T-002                             |
| T-013 | P2       | US-005     | FR-030     | `packages/services/grocery-lists/src/adapters/` | T-004                             |
| T-014 | P2       | US-005     | FR-030     | `packages/services/grocery-lists/src/`          | T-013                             |
| T-015 | P2       | US-007     | FR-031     | `packages/services/grocery-lists/src/adapters/` | T-013                             |
| T-016 | P2       | US-005     | FR-030     | `packages/services/grocery-lists/src/adapters/` | T-014                             |
| T-017 | P2       | US-007     | FR-031     | `packages/services/grocery-lists/src/adapters/` | T-016                             |
| T-018 | P2       | US-007     | FR-030/031 | `packages/services/grocery-lists/src/adapters/` | T-015, T-017                      |
| T-019 | P2       | US-007     | FR-031     | `packages/services/grocery-lists/src/`          | T-018                             |
| T-020 | P2       | US-007     | FR-031     | `packages/api/src/guards/`                      | 010-subscriptions                 |
| T-021 | P1       | all        | all        | `packages/api/src/grocery-lists/`               | T-002, T-004, T-005, T-014        |
| T-022 | P1       | all        | all        | `packages/api/src/grocery-lists/`               | T-021                             |
| T-023 | P1       | all        | all        | `packages/api/src/grocery-lists/`               | T-004, T-005, T-014               |
| T-024 | P1       | all        | all        | `packages/api/src/grocery-lists/dto/`           | T-002                             |
| T-025 | P2       | US-002/004 | FR-028/029 | `packages/apps/commise/web/app/`                | T-006, T-008                      |
| T-026 | P2       | US-003     | FR-029     | `packages/apps/commise/web/app/`                | T-011, T-012, T-025               |
| T-027 | P2       | US-005/006 | FR-030     | `packages/apps/commise/web/app/`                | T-016, T-025                      |
| T-028 | P2       | US-007/008 | FR-031     | `packages/apps/commise/web/app/`                | T-015, T-018, T-019, T-020, T-027 |
| T-029 | P1       | all        | all        | `packages/shared/src/`                          | T-003                             |
| T-030 | P1       | all        | all        | `packages/services/grocery-lists/src/`          | T-004                             |
| T-031 | P1       | all        | all        | `packages/services/grocery-lists/src/`          | T-005                             |
| T-032 | P1       | all        | all        | `packages/services/grocery-lists/src/adapters/` | T-014                             |
| T-033 | P1       | all        | all        | `packages/api/src/grocery-lists/`               | T-022                             |
| T-034 | P1       | all        | all        | `packages/api/src/grocery-lists/`               | T-023                             |
| T-035 | P1       | all        | all        | `packages/apps/commise/web/e2e/`                | T-025, T-026                      |
| T-036 | P1       | all        | all        | `packages/apps/commise/web/e2e/`                | T-039, T-040                      |
| T-037 | P1       | all        | all        | `packages/apps/commise/web/e2e/`                | T-027, T-028                      |
| T-038 | P1       | all        | all        | `packages/apps/commise/mobile/e2e/`             | T-041, T-042                      |
| T-039 | P2       | US-011     | FR-032     | `packages/apps/commise/web/app/`                | T-006, T-007, T-008               |
| T-040 | P2       | US-012     | FR-033     | `packages/apps/commise/web/app/`                | T-025, T-039                      |
| T-041 | P2       | US-002/004 | FR-028/029 | `packages/apps/commise/mobile/app/`             | T-006, T-008                      |
| T-042 | P2       | US-003     | FR-029     | `packages/apps/commise/mobile/app/`             | T-011, T-012, T-041               |
| T-043 | P2       | US-005/006 | FR-030     | `packages/apps/commise/mobile/app/`             | T-016, T-041                      |
| T-044 | P2       | US-007/008 | FR-031     | `packages/apps/commise/mobile/app/`             | T-015, T-018, T-019, T-020, T-043 |
| T-045 | P2       | US-011     | FR-032     | `packages/apps/commise/mobile/app/`             | T-006, T-007, T-008, T-041        |
| T-046 | P2       | US-012     | FR-033     | `packages/apps/commise/mobile/app/`             | T-041, T-045                      |
