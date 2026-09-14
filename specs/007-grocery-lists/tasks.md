# Tasks: Feature 007 — Grocery Lists & Online Ordering

**Feature**: `007-grocery-lists`
**Generated**: 2026-06-02
**Source Artifacts**: spec.md, plan.md, product-spec/product-spec.md
**Total Tasks**: 53 (T-001…T-046 the original set, T-047…T-052 added 2026-08-12 for contract ownership, validation and the
client half, T-053 split out of a duplicated T-046 on 2026-08-12)

> ✅ **RESOLVED (2026-08-12) — the eight duplicated task IDs are gone; every ID is now defined exactly once.**
> T-004, T-025, T-027, T-028, T-041, T-043, T-044 and T-046 were each **defined twice**, giving 60 checkbox lines
> for 52 IDs. A duplicated ID makes "done" ambiguous: a traceability row can be closed by the wrong task, and the
> dependency graph's referents stop being unique.
>
> The eight split into two different defects, and they got two different fixes:
>
> - **Seven were the same task cross-listed under a second user story** (`_(shared with US-00X)_`, same file path,
>   same work). Those are now **defined once**, tagged with every story they serve — matching what the Summary
>   Table already asserted (`T-025 | US-002/004`) — with the second story's acceptance criterion folded into the
>   definition. Each second site is now a **non-checkbox pointer**: one task, one checkbox, one done-state.
> - **T-046 was a genuine mis-numbering**: two different deliverables shared it — the mobile cross-link **UI**
>   (`mobile/app/meal-plan.tsx`) and the mobile cross-link **E2E test** (`mobile/e2e/shopping-lists.test.js`).
>   The E2E half is now **T-053**, and depends on T-046 rather than restating it.
>
> Enforced from now on by `packages/infra/global/__tests__/specTaskIds.test.ts`, which discovers every
> `specs/*/tasks.md` and fails on any identifier defined twice. It parses fenced blocks out first, so the ASCII
> dependency graph below — full of `[T-001]` tokens — is correctly read as references, not definitions.

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
[T-047] Author zod in recipe-service → regenerate `@kitchensink/schema-recipe`   (gates T-024)
    ↓
[T-021..T-024] NestJS Module Wiring, Guards & `createZodDto` validation
    ↓
[T-048] Storage-floor parity   [T-049] Non-HTTP ingress parse   [T-050] Retailer boundary zod (§15-d)
    ↓
[T-051] Recipe client + web/mobile derived view models   [T-052] k6
    ↓
[T-025..T-028] Web UI (Next.js)          [T-039] Dedicated Shopping Lists Page (Web)
    ↓                                         ↓
[T-041..T-044] Mobile UI (Expo/RN)       [T-040] Meal Plan Cross-Links (Web + 006 view)
    ↓
[T-045..T-046] Mobile Shopping-Lists Page & Cross-Links (UI)
    ↓
[T-053] Mobile cross-link E2E
    ↓
[T-029..T-038] Tests & Validation
```

> **Store adapter note**: T-013..T-018 implement the adapter code and can be built and unit-tested with mocks. They MUST NOT be marked complete until a real API key or sandbox credential is available for integration testing against the actual store API.

---

## US-001 — Generate List from Meal Plan

- [ ] **T-001** [P1] [US-001] Create DB migration for grocery_lists, grocery_list_items, user_pantry_items, grocery_product_map — `packages/services/recipe-service/src/database/migrations/00NN_grocery_lists.sql`
    - Depends on: 006-meal-planning migration (meal_plans table must exist)
    - Implements: FR-028
    - Acceptance: Migration runs cleanly; tables created with correct FKs and indexes.

- [ ] **T-002** [P1] [US-001] Define Drizzle ORM schemas for all four tables — `packages/services/recipe-service/src/database/schema/grocery-lists.ts`
    - Depends on: T-001
    - Implements: FR-028
    - Acceptance: `tsc --noEmit` passes; schema matches plan.md Section 2.

- [ ] **T-003** [P1] [US-001] Build shared culinary-units utility (parse, toBaseUnit, toDisplayUnit, density map) — `packages/shared/culinary-units/src/index.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Unit tests pass for volume↔mass conversions (flour, sugar, butter, oil, milk); strict mode, JSDoc on all exports.

- [ ] **T-004** [P1] [US-001, US-002] Implement IngredientAggregatorService (aggregate, normalizeUnit, deduplicate) — `packages/services/recipe-service/src/grocery-lists/ingredient-aggregator.service.ts`
    - Depends on: T-003
    - Implements: FR-028
    - Acceptance: "2 cups flour" + "100g flour" = ~315g flour in test; deduplication collapses same fdc_id to single line.
    - Acceptance (US-002): Same fdc_id from multiple recipes collapses to a single line with summed grams; unit display is grocery-friendly.

- [ ] **T-005** [P1] [US-001] Implement PantryService (add/remove/get/subtractFromList/pruneExpired) — `packages/services/recipe-service/src/grocery-lists/pantry.service.ts`
    - Depends on: T-002
    - Implements: FR-028, FR-029
    - Acceptance: Items in user_pantry_items marked as is_pantry in list; expired items pruned on @Cron schedule.

- [ ] **T-006** [P1] [US-001] POST /api/v1/grocery-lists endpoint — generate list from meal plan — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-004, T-005
    - Implements: FR-028
    - Acceptance: Scenario 1 from spec passes; empty meal plan returns 200 with empty items array; SC-004 timing target.

- [ ] **T-007** [P1] [US-001] GET /api/v1/grocery-lists endpoint — list user's grocery lists — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Returns only authenticated user's lists; cursor-based pagination works.

- [ ] **T-008** [P1] [US-001] GET /api/v1/grocery-lists/:id endpoint — get list with items — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: Returns all items sorted by sort_order then category; 404 if not found or wrong user.

---

## US-002 — Deduplicate and Sum Ingredient Quantities

- **T-004** — serves this story; **defined once under US-001 above**, where its US-002 acceptance criterion also lives. Not a
  second task and not a second checkbox.

- [ ] **T-025** [P2] [US-002, US-004] Web UI: grocery list page with category-grouped items — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-006, T-008
    - Implements: FR-028, FR-029
    - Acceptance: Items grouped by category; each item shows display name + quantity display + category badge; accessible (NFR-003, NFR-004).
    - Acceptance (US-004, aisle grouping): Items grouped by aisle/category; the full workflow is completable in under 10 minutes for a 7-day plan (SC-008).

- [ ] **T-041** [P2] [US-002, US-004] Mobile UI: grocery list screen with category-grouped items — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-006, T-008
    - Mirrors: T-025
    - Implements: FR-028, FR-029
    - Acceptance: Items grouped by category; each item shows display name + quantity display + category badge; accessible.
    - Acceptance (US-004, aisle grouping): Items grouped by aisle/category; one-handed check-off interactions supported.

---

## US-003 — Mark "Already Have" Items

- [ ] **T-009** [P1] [US-003] PUT /api/v1/grocery-lists/:id endpoint — batch update items (toggle is_pantry, is_ordered, sort_order) — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-029
    - Acceptance: Scenario 3 from spec passes; pantry items excluded from "to order" count; 403 if wrong user.

- [ ] **T-011** [P1] [US-003] POST /api/v1/grocery-lists/:id/items/:itemId/pantry endpoint — mark as pantry — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-029
    - Acceptance: 200 on success; 404 if item missing; pantry flag persisted.

- [ ] **T-012** [P1] [US-003] DELETE /api/v1/grocery-lists/:id/items/:itemId/pantry endpoint — remove pantry flag — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
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

- **T-025** — serves this story; **defined once under US-002 above**, where its US-004 aisle-grouping acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

- **T-041** — serves this story; **defined once under US-002 above**, where its US-004 aisle-grouping acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

---

## US-005 — Configure Store Connection

- [ ] **T-013** [P2] [US-005] Walmart adapter: searchByIngredient + createCart + checkout — `packages/services/recipe-workers/src/grocery/adapters/walmart.adapter.ts`
    - Depends on: T-004
    - Implements: FR-030
    - Acceptance: Adapter unit tests pass with mocks; 10s timeout configured; circuit breaker after 5 failures.

- [ ] **T-014** [P2] [US-005] ProductMappingService: USDA fdc_id → store SKU lookup + cache — `packages/services/recipe-service/src/grocery-lists/product-mapping.service.ts`
    - Depends on: T-013
    - Implements: FR-030
    - Acceptance: Returns walmart_sku + price for known fdc_id; null for unmapped items; JSONB store_sku persisted.

- [ ] **T-016** [P2] [US-005] Instacart adapter: OAuth authorize + searchProducts + createOrder — `packages/services/recipe-workers/src/grocery/adapters/instacart.adapter.ts`
    - Depends on: T-014
    - Implements: FR-030
    - Acceptance: Adapter unit tests pass with mocks; OAuth flow mocked; 10s timeout. _⚠️ Cannot complete integration testing without sandbox credentials._

- [ ] **T-027** [P2] [US-005, US-006] Web UI: store connection section (Walmart API key entry, Instacart OAuth, disconnect) — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-016, T-025
    - Implements: FR-030
    - Acceptance: Connected state shows store name + "Disconnect" option; unconnected state shows setup prompt.
    - Acceptance (US-006, guided setup): Scenario 5 from the spec passes — a user without a connected store sees setup guidance on order attempt.

- [ ] **T-043** [P2] [US-005, US-006] Mobile UI: store connection screen (bottom sheet/modal with Walmart key entry, Instacart OAuth) — `packages/apps/commise/mobile/app/store-connection.tsx`
    - Depends on: T-016, T-041
    - Mirrors: T-027
    - Implements: FR-030
    - Acceptance: OAuth redirect and callback work end-to-end on mobile. _⚠️ Instacart path cannot be fully accepted without sandbox credentials._
    - Acceptance (US-006, guided setup): Scenario 5 passes on mobile.

---

## US-006 — Guided Setup on Order Attempt

- **T-027** — serves this story; **defined once under US-005 above**, where its US-006 guided-setup acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

- **T-043** — serves this story; **defined once under US-005 above**, where its US-006 guided-setup acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

---

## US-007 — Create Order Handoff from List (Premium)

- [ ] **T-015** [P2] [US-007] Walmart adapter: checkout handoff URL generation — `packages/services/recipe-workers/src/grocery/adapters/walmart.adapter.ts`
    - Depends on: T-013
    - Implements: FR-031
    - Acceptance: Returns valid checkoutUrl for cart of mapped items; unmapped items excluded from cart.

- [ ] **T-017** [P2] [US-007] Instacart adapter: order creation + checkout handoff — `packages/services/recipe-workers/src/grocery/adapters/instacart.adapter.ts`
    - Depends on: T-016
    - Implements: FR-031
    - Acceptance: Returns orderId + checkoutUrl for mapped items; unmapped items excluded. _⚠️ Integration testing blocked without sandbox credentials._

- [ ] **T-018** [P2] [US-007] StoreMappingRegistry: adapter selection (walmart | instacart | null) — `packages/services/recipe-workers/src/grocery/adapters/registry.ts`
    - Depends on: T-015, T-017
    - Implements: FR-030, FR-031
    - Acceptance: Resolves correct adapter by store name; returns null if no store configured.

- [ ] **T-019** [P2] [US-007] Order status polling service (polls store API, updates list status: pending | ready | unavailable) — `packages/services/recipe-workers/src/grocery/order-status.service.ts`
    - Depends on: T-018
    - Implements: FR-031
    - Acceptance: Polling runs on interval; status transitions recorded; unavailable shown on store API failure.

- [ ] **T-020** [P2] [US-007] PremiumOrderingGuard: gate order routes behind 010 subscription check — `packages/shared/entitlement/src/guards/premium-ordering.guard.ts`
    - Depends on: 010-subscriptions (subscription check service)
    - Implements: FR-031
    - Acceptance: Free users receive 403 with upgrade message; premium users pass through.

- [ ] **T-028** [P2] [US-007, US-008] Web UI: "Order Groceries" button (disabled + upgrade prompt for free users), pre-order review, checkout URL, status polling — `packages/apps/commise/web/app/meal-plans/[id]/grocery-list/page.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-027
    - Implements: FR-031
    - Acceptance: Scenario 4 from spec passes in Playwright; premium gate shows upgrade prompt for free users.
    - Acceptance (US-008, pre-order review): Mapped items shown with store price; unmapped items shown for manual selection or skip.

- [ ] **T-044** [P2] [US-007, US-008] Mobile UI: "Order Groceries" button (disabled + upgrade prompt), pre-order review bottom sheet, checkout URL in system browser, status polling — `packages/apps/commise/mobile/app/grocery-list.tsx`
    - Depends on: T-015, T-018, T-019, T-020, T-043
    - Mirrors: T-028
    - Implements: FR-031
    - Acceptance: Scenario 4 passes on mobile; premium gate shows upgrade prompt for free users.
    - Acceptance (US-008, pre-order review): Mapped vs unmapped shown in a scrollable bottom sheet — mapped with store price, unmapped for manual selection or skip.

---

## US-008 — Pre-Order Review for Mapped vs Unmapped Items

- **T-028** — serves this story; **defined once under US-007 above**, where its US-008 pre-order-review acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

- **T-044** — serves this story; **defined once under US-007 above**, where its US-008 pre-order-review acceptance criterion also
  lives. Not a second task, and deliberately not a second checkbox.

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

- [ ] **T-021** [P1] [all] GroceryListsModule wiring with imports (Drizzle, Pantry, Aggregator, ProductMapping, Adapters) — `packages/services/recipe-service/src/grocery-lists/grocery-lists.module.ts`
    - Depends on: T-002, T-004, T-005, T-014
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: Module imports/exports correct; `tsc --noEmit` passes; no circular deps.

- [ ] **T-022** [P1] [all] GroceryListsController: register all 9 endpoints with AuthMiddleware and PremiumOrderingGuard — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-021
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: All routes registered; Swagger docs generated; guards applied to correct routes.

- [ ] **T-023** [P1] [all] GroceryListsService: thin orchestration layer (aggregator + pantry + mapping + Drizzle CRUD) — `packages/services/recipe-service/src/grocery-lists/grocery-lists.service.ts`
    - Depends on: T-004, T-005, T-014
    - Implements: FR-028, FR-029, FR-030, FR-031
    - Acceptance: All methods have JSDoc; no business logic in controller; service methods unit-tested.

- [ ] **T-024** [P1] [all] Wire request/response validation from the authored zod via `createZodDto` — `packages/services/recipe-service/src/grocery-lists/grocery-lists.schema.ts`
    - Depends on: T-002, T-047
    - Implements: FR-028, FR-029, FR-030, FR-031, GR-015 §15-a.2, GR-016 §16-a, GR-017 §17-a.5/§17-c
    - **⛔ Two corrections, both of which would have shipped a defect.** **(1) The `dto/` directory is wrong**: this task put DTOs in `packages/services/grocery-service/src/grocery-lists/dto/`, but `docs/CODING_STANDARDS.md` §15.2 requires the wire contract to be authored as `src/**/*.schema.ts` **beside the controller it serves** — not in a `dto/` directory. **(2) `class-validator` + `class-transformer` is a GR-016 §16-a.2 violation**: `@kitchensink/recipe-service` already validates with **`nestjs-zod`** and is mid-removal of **19 residual `class-validator` files** (measured 2026-08-12). Adding a second mechanism means two error contracts and two sets of edge cases to keep in step.
    - Acceptance: `CreateGroceryList`, `UpdateGroceryListItems`, `GroceryListResponse`, `GroceryListItem` and `OrderResponse` are **`z.infer` types over the T-047 zod**, exposed to routes through **`createZodDto`** under **`nestjs-zod`'s** `ZodValidationPipe` (never Nest's own, and never bound to the bare class token). Every **mutating** body uses **`z.strictObject()`** (GR-017 §17-c) — `z.object()` strips unknown keys silently, so a client misspelling `alreadyHave` would get a `200` and a partial write it was told succeeded. Invalid requests return **one** `400` naming the offending field(s). No `class-validator` decorator and no `@Expose()` anywhere in the module.
    - **⚠️ The failure this guards is invisible by construction**: under Nest's **own** `ValidationPipe` a `createZodDto` DTO **validates nothing while looking correctly wired**, which already bit identity's `PATCH /users/me`. The only way to see it is a test that posts a known-bad body to a real route.
    - Tests: unit (per-DTO accept/reject, unknown-key rejection) **AND** integration (a known-bad body posted to a **real** route on a booted app returns `400` with the field name, modelled on `packages/services/identity/tests/appValidation.test.ts`).

---

## Tests & Validation

- [ ] **T-029** [P1] [all] Unit tests: culinary-units utility — `packages/shared/culinary-units/src/__tests__/index.test.ts`
    - Depends on: T-003
    - Acceptance: 100% branch coverage for parse, toBaseUnit, toDisplayUnit.

- [ ] **T-030** [P1] [all] Unit tests: IngredientAggregatorService — `packages/services/recipe-service/src/grocery-lists/__tests__/ingredient-aggregator.service.test.ts`
    - Depends on: T-004
    - Acceptance: Coverage for deduplication, unit normalization, empty input, unknown density fallback.

- [ ] **T-031** [P1] [all] Unit tests: PantryService — `packages/services/recipe-service/src/grocery-lists/__tests__/pantry.service.test.ts`
    - Depends on: T-005
    - Acceptance: Coverage for add/remove/get/subtractFromList/pruneExpired; expired items pruned correctly.

- [ ] **T-032** [P1] [all] Unit tests: ProductMappingService + Walmart adapter — `packages/services/recipe-workers/src/grocery/adapters/__tests__/walmart.adapter.test.ts`
    - Depends on: T-014
    - Acceptance: Coverage for search, cart creation, checkout; circuit breaker behavior verified.

- [ ] **T-033** [P1] [all] Unit tests: GroceryListsController — `packages/services/recipe-service/src/grocery-lists/__tests__/grocery-lists.controller.test.ts`
    - Depends on: T-022
    - Acceptance: All 9 endpoints tested; auth guards mocked; 404/403 cases covered.

- [ ] **T-034** [P1] [all] Unit tests: GroceryListsService — `packages/services/recipe-service/src/grocery-lists/__tests__/grocery-lists.service.test.ts`
    - Depends on: T-023
    - Acceptance: Coverage for generate, list, get, update, delete, order, status; JSDoc verified.

- [ ] **T-035** [P1] [all] Playwright E2E: grocery list generation + pantry toggle + aisle grouping — `packages/apps/commise/web/tests/e2e/grocery-lists.spec.ts`
    - Depends on: T-025, T-026
    - Acceptance: Scenario 1, 2, 3 from spec pass; SC-008 timing under 10 minutes for 7-day plan.

- [ ] **T-036** [P1] [all] Playwright E2E: dedicated Shopping Lists page + cross-links — `packages/apps/commise/web/tests/e2e/shopping-lists.spec.ts`
    - Depends on: T-039, T-040
    - Acceptance: SC-009 passes; user reaches /shopping-lists from main nav, creates list without visiting meal plan.

- [ ] **T-037** [P1] [all] Playwright E2E: store connection + online ordering (premium gating) — `packages/apps/commise/web/tests/e2e/grocery-ordering.spec.ts`
    - Depends on: T-027, T-028
    - Acceptance: Scenario 4, 5 from spec pass; premium gate blocks free users; checkout URL returned.

- [ ] **T-038** [P1] [all] Mobile E2E: Detox/Maestro — grocery list generation + pantry toggle + aisle grouping — `packages/apps/commise/mobile/e2e/grocery-lists.test.js`
    - Depends on: T-041, T-042
    - Acceptance: Scenario 1, 2, 3 from spec pass on mobile; one-handed interactions verified.

- [ ] **T-053** [P2] [US-012] Mobile E2E: meal plan / shopping list cross-link navigation — `packages/apps/commise/mobile/e2e/shopping-lists.test.js`
    - Depends on: T-045, T-046
    - Implements: FR-033
    - Acceptance: Cross-link navigation works on mobile; meal plan shows associated lists.
    - ⚠️ Renumbered from `T-046` on 2026-08-12. This is the **E2E test** for the cross-links; `T-046` is the **UI** that
      implements them, in a different package path. They were two different deliverables sharing one identifier, which is
      why this one depends on the other rather than restating it.

---

## Additional API Endpoints

- [ ] **T-010** [P2] [US-001] DELETE /api/v1/grocery-lists/:id — delete list — `packages/services/recipe-service/src/grocery-lists/grocery-lists.controller.ts`
    - Depends on: T-002
    - Implements: FR-028
    - Acceptance: 204 on success; 403 if wrong user; cascade deletes items.

---

## Cross-Cutting — Contract ownership, validation & the client half (GR-015, GR-016, GR-017, GR-018)

> ⛔ **Service ownership is CLOSED, and every path in this file was repointed.**
> [ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md) rules 007
> into **`@kitchensink/recipe-service`** sharing **`@kitchensink/schema-recipe`**. **There is no
> `packages/services/grocery-service`** — all **57** references to it in this file were wrong, and there is **no**
> `@kitchensink/schema-grocery`: a schema package is per **SERVICE**, not per feature. 007 **extends** the
> existing `packages/schemas/recipe`; forking it is a violation.
>
> **Where each repointed group landed, and why:**
>
> | Was                                                           | Now                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
> | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | `grocery-service/src/grocery-lists/**`                        | `packages/services/recipe-service/src/grocery-lists/**` | ADR-0017 decision 4 — a NestJS module is the internal boundary, a sibling of `RecipesModule`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
> | `grocery-service/src/grocery-lists/dto/`                      | `recipe-service/src/grocery-lists/*.schema.ts`          | §15.2 — the contract is authored **beside its controller**, never in a `dto/` directory                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
> | `grocery-service/src/database/{migrations,schema}/`           | `recipe-service/src/database/{migrations,schema}/`      | one database with 001 and 009, so 007's FKs to `recipes` and `recipe_ingredients` are real and enforceable ⚠️ **Corrected 2026-08-16:** this cell used to justify the move with `meal_plan_entries → recipes`. That premise died when 006 was extracted on 2026-08-14 — `meal_plan_entries` now lives in `kitchensink_meal_plans`, so that particular edge is exactly the cross-database FK C-006-002 forbids, and 006's own plan already declares `recipe_id` as a bare `uuid`. The move is still right; the reason given for it was not. |
> | `grocery-service/src/adapters/**`, `order-status.service.ts`  | `packages/services/recipe-workers/src/grocery/**`       | ADR-0017 decision 5 — the retailer adapters and order-status **polling** are asynchronous by design and run in the worker, not the API process                                                                                                                                                                                                                                                                                                                                                                                             |
> | `grocery-service/src/common/guards/premium-ordering.guard.ts` | `packages/shared/entitlement/src/guards/`               | ADR-0017 decision 3 — the entitlement guard is a **shared** concern reading a claim from the signed Clerk session token, **not** an import of the identity service                                                                                                                                                                                                                                                                                                                                                                         |
>
> ⚠️ **The migration filename is `00NN_grocery_lists.sql`, not `007_grocery_lists.sql`** —
> `packages/services/recipe-service/src/database/migrations/` uses a 4-digit sequence (`0017` is the latest as of
> 2026-08-12), and 006's migration takes a number too. Claim the next free number at implementation time.
>
> ⚠️ **ADR-0017's flip condition for 007 is recorded**: extract `@kitchensink/grocery-service` when retailer
> integration grows **inbound** surface — a Walmart/Instacart webhook, a marketplace callback, or per-user OAuth
> token storage at a volume wanting its own secret rotation and blast radius. 007 chose **polling over webhooks**
> for order status, which is exactly why that condition has not fired.

- [ ] **T-047** [P1] [all] Author 007's wire shapes as zod in the recipe service and regenerate the existing schema package — `packages/services/recipe-service/src/grocery-lists/grocery-lists.schema.ts`, `orders.schema.ts` → `packages/schemas/recipe`
    - Depends on: T-002
    - Implements: FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, GR-015 §15-a, GR-017 §17-a.1/§17-a.3
    - Acceptance: Grocery-list, list-item, pantry ("already have"), store-connection and order-handoff shapes authored **beside their controllers** under `src/grocery-lists/`, importing **only `zod` and other `*.schema.ts` files**. `npm run contract:verify` regenerates `packages/schemas/recipe` (`schemas.ts`, `types.ts`, `contractHash.ts`, barrel, **derived** `openapi.yaml`) with no diff. **Add to the existing `@kitchensink/schema-recipe` — never fork it**, and never hand-edit the generated package.
    - **⛔ Three things that look wrong and are not**: the schema package is a literal file **COPY** (zod are runtime values and cannot be derived from themselves); `openapi.yaml` is **DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input**; the copy is wired with turbo `$TURBO_ROOT$` **`inputs`**, never `dependsOn` (that edge closes the cycle `client → schema → service → client`).
    - **⛔ No retailer type may enter this schema package.** Walmart's and Instacart's shapes are third-party (T-050) and stay on the adapter's side; our `OrderResponse` **deliberately differs** from theirs, and that difference is the normalization, not drift.
    - Tests: unit (each schema accepts a valid fixture and rejects every malformed variant) **AND** integration (regenerate-and-diff clean; `packages/services/recipe-service/src/__tests__/buildInputs.test.ts` covers the new files; the `CONTRACT_HASH` boot assertion still holds).

- [ ] **T-048** [P1] [all] Add the storage-floor boundary-parity test for 007's bounded columns — `packages/services/recipe-service/src/grocery-lists/__tests__/storageCapacity.test.ts`
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storageCapacity.ts`), and a `storageCapacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
    - Depends on: T-002, T-047
    - Implements: GR-016 §16-d, GR-017 §17-d
    - Acceptance: Lives **in the service**, imports **both** the drizzle schema and the authored zod (a test is not a wire schema, so §16-d's ban on the _production_ coupling is untouched), **derives** its bounded-column enumeration from the drizzle schema, and asserts each writing wire field **rejects** a value the column cannot hold: item **quantity** `numeric(p,s)` precision/scale, unit enum domain, aisle/category enum domain, list and item name lengths, order/line-item counts and any `price_cents` against the `int4` ceiling **2,147,483,647**, status enum domains, nullability. Mapping completeness asserted in **BOTH** directions — every bounded column has an entry or an explicit reasoned exemption, and every entry names a column that exists.
    - **⚠️ Quantity is the live risk here**: deduplication **sums** quantities across recipes (US-002), so the sum can overflow a `numeric(p,s)` even when every input fits. The aggregate is bounded too, and an overflow is a **`400` at the boundary**, never a `22003` from the `INSERT` surfacing as a `500`.
    - **⛔ Asserted, never derived** — no zod generated from drizzle, no storage type imported into a `*.schema.ts`.
    - **⚠️ Limitation**: only the "every bounded column has an entry" direction catches a **new** column, and only if the enumeration is derived. Derive it.
    - Tests: unit (the parity assertions, including the summed-quantity overflow) **AND** integration (a precision-overflowing quantity posted to a real route yields `400`, not a failed `INSERT`).

- [ ] **T-049** [P1] [all] Parse every non-HTTP ingress, with one rejection path and no retry of invalid payloads — `packages/services/recipe-workers/src/grocery/`
    - Depends on: T-047, T-018
    - Implements: FR-030, FR-031, GR-016 §16-b, GR-018 §18-a/§18-b/§18-d, GR-019
    - **007's non-HTTP ingress, enumerated**: (1) the **order-status polling** job (a scheduled invocation, in `recipe-workers` per ADR-0017 decision 5); (2) the **retailer product-mapping refresh** job; (3) the **grocery-list generation** request triggered from 006 (`006-FR-###` → `POST /api/v1/meal-plans/{id}/grocery-list`), whether it arrives over HTTP or a queue. ⚠️ **007 has NO retailer webhook** — it deliberately chose **polling**, so GR-018 §18-c's `2xx` inversion does **not** apply here. If a retailer webhook is ever added, that inversion becomes mandatory and this task changes.
    - Acceptance: Each parses its payload against an authored zod before it becomes work — **including the scheduled ones**, because "the payload is ours" is an assumption about a deploy that has already drifted once. Rejections take **one** path with the cause in a **`reason`** field; a shape failure and a credential failure are **equally invalid** and differ only in `reason`. An invalid payload is **NEVER retried** — record it and **complete** the message, or dead-letter it **once** with the `reason`, and alarm DLQ depth. A **transient** failure (retailer `5xx`, DB timeout, rate limit) is a **different** `reason` and **MAY** retry — that distinction is the rule, and conflating them is the defect.
    - **⛔ No sentinel identifiers, and no row for a rejected payload**: an unresolvable `grocery_list_id`, `order_id` or retailer `product_id` is a **rejection**, never `'unknown'`/`''`/`0` — not in storage, not on a wire, not as a map key, and **not as a metrics dimension**, where it would fuse every unattributable order into one fictitious subject that cannot be told apart from a real id afterwards (GR-019).
    - Tests: unit (each envelope zod rejects every malformed variant; the rejection shape differs only in `reason`; an unresolvable id rejects rather than defaults) **AND** integration (an **invalid** payload is asserted **not** redriven while a **transient** failure **is**, **and** a valid payload still succeeds — both halves, or the test passes on a handler that never fails).

- [ ] **T-050** [P2] [US-005/007] ⛔ Boundary-validate Walmart and Instacart — the §15-d OPPOSITE case — and never converge them — `packages/services/recipe-workers/src/grocery/adapters/`
    - Depends on: T-013, T-015
    - Implements: FR-030, FR-031, GR-015 §15-d, GR-016 §16-b, GR-017 §17-b.6
    - **⛔ Walmart's and Instacart's APIs are APIs the platform does NOT serve.** There is no service of ours to own their types, and each versions its contract independently of us — including behind T-013's adapter registry, where a new retailer can be added later.
    - Acceptance: Each adapter **validates the raw upstream wire shape at the boundary with its own zod**, the moment a body arrives — product search results, cart/order confirmations, order-status payloads, error envelopes. Each **MAY declare its own types**, and our normalized `OrderResponse` / product-mapping shape **deliberately differs** from the retailer's: that difference **is** the normalization, not drift. **NO OpenAPI document is written** for either retailer. Rules 17-b.1–17-b.5 do **not** apply to these adapters.
    - **⛔ "Converging" a retailer adapter under §15-b DELETES a validation boundary — a security regression, not a consistency win**, and this path handles a user's **store credentials and a real purchase**. `packages/clients/usda/src/schemas.ts` is the reference implementation and must **NEVER** be touched in this rule's name.
    - **⚠️ A missing price or an absent order id must REJECT, not default.** A defaulted `0` price or an `'unknown'` order id would silently pass a purchase confirmation the user is told succeeded (GR-019).
    - Tests: unit (each boundary schema rejects a renamed, missing, wrong-typed and null-valued upstream field; the normalized output is asserted **independent** of the raw shape; per-retailer fixtures kept separate so one retailer's change cannot mask the other's) **AND** integration (recorded real sandbox payloads parse clean; a mutated payload is rejected at the boundary and drives **no** order write). ⚠️ Per this file's own **store adapter note**, integration against a real key/sandbox credential is required before this is marked complete.

- [ ] **T-051** [P1] [all] Extend the typed recipe client for 007's endpoints and consume it from web + mobile in lockstep — `packages/clients/recipe-service/src/`, `packages/apps/commise/web`, `packages/apps/commise/mobile`
    - Depends on: T-047
    - Implements: FR-028…FR-033, GR-015 §15-b, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.1–§17-b.5, §17-f, CODING_STANDARDS §14.1
    - Acceptance: `@kitchensink/recipe-service-client` gains the grocery-list, pantry, store-connection and order methods, importing wire **types and runtime zod** from `@kitchensink/schema-recipe` and declaring **no** wire shape of its own (its `types.ts` holds only config, options and its own error shapes — including type-only declarations). **Every response is parsed the moment it arrives**; **every outbound body is validated against the callee's schema-package zod before the call**, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. The existing `packages/clients/recipe-service/src/contractSkew.ts` guard covers these endpoints once the hash changes — **extend its test, do not add a second guard**.
    - Acceptance (apps): No file in `@commise/web`, `@commise/mobile` or any feature package declares a grocery wire type. The aisle-grouped list view model, the mapped-vs-unmapped review model and the store-connection status model are **DERIVED** with `Pick`/`Omit`/`Partial`/mapped types. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`. Web (T-025…T-028, T-039, T-040) and mobile (T-041…T-044) ship in the **same release**, with `.native.ts(x)` for platform-specific files, and all copy goes through the localization path.
    - **⛔ Do NOT add server-side response validation** — GR-016 §16-g defers a **producing service** parsing what it **emits**; that is an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f).
    - Tests: unit (each method's happy path and every mapped error status; a response with a missing, renamed or wrong-typed field raises the typed parse error; an invalid outbound body is rejected before any fetch; each derived model asserted assignable from its wire parent; `src/__tests__/contractSkew.test.ts` extended) **AND** integration (`src/__integration__/client.integration.test.ts` against a booted recipe service) **AND** **vitest component tests for EVERY path/state on BOTH platforms** — loading, empty list, populated, all-already-have, unmapped-items, store-disconnected, premium-gated, order-pending/placed/failed, generation-failed — not a representative sample **AND** **Playwright** (web, extending T-035…T-037) **AND** **Maestro** flows (mobile, extending T-038/T-045/T-046) matching the Playwright specs one-for-one.

- [ ] **T-052** [P2] [all] Add the k6 load tier for the grocery surface — `packages/tools/loadtest/`
    - Depends on: T-024, T-047
    - Implements: NFR targets, CODING_STANDARDS §7.1 (a deployable owes e2e **AND** k6), GR-017 §17-a.8
    - Acceptance: Load profiles assert the latency/throughput SLOs for list generation (the heaviest read — a plan's entries joined to each recipe's ingredients) and for the aisle-grouped list read. ⚠️ Because 007 lands **inside** `@kitchensink/recipe-service`, these profiles must also show that grocery load does **not** regress **recipe search**'s SLO — ADR-0017 accepts a **shared blast radius**, and this is the tier that measures it.
    - **⚠️ Scripts live in `packages/tools/loadtest/`, shared across services, not colocated** (§7 Test File Location), and `open()` is script-relative. k6 is a **separate, additional** gate, not part of the 70/20/10 pyramid.
    - Tests: this task **is** the k6 tier; the e2e tier lives in `packages/services/recipe-service/tests/e2e/`.

---

## Summary Table

| Task  | Priority | US         | FR          | Package Path                                                                      | Depends On                        |
| ----- | -------- | ---------- | ----------- | --------------------------------------------------------------------------------- | --------------------------------- |
| T-001 | P1       | US-001     | FR-028      | `packages/services/recipe-service/src/database/migrations/`                       | 006 migration                     |
| T-002 | P1       | US-001     | FR-028      | `packages/services/recipe-service/src/database/schema/`                           | T-001                             |
| T-003 | P1       | US-001     | FR-028      | `packages/shared/`                                                                | T-002                             |
| T-004 | P1       | US-001/002 | FR-028      | `packages/services/recipe-service/src/grocery-lists/`                             | T-003                             |
| T-005 | P1       | US-001/003 | FR-028/029  | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-006 | P1       | US-001     | FR-028      | `packages/services/recipe-service/src/grocery-lists/`                             | T-004, T-005                      |
| T-007 | P1       | US-001     | FR-028      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-008 | P1       | US-001     | FR-028      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-009 | P1       | US-003     | FR-029      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-010 | P2       | US-001     | FR-028      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-011 | P1       | US-003     | FR-029      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-012 | P1       | US-003     | FR-029      | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-013 | P2       | US-005     | FR-030      | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-004                             |
| T-014 | P2       | US-005     | FR-030      | `packages/services/recipe-service/src/grocery-lists/`                             | T-013                             |
| T-015 | P2       | US-007     | FR-031      | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-013                             |
| T-016 | P2       | US-005     | FR-030      | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-014                             |
| T-017 | P2       | US-007     | FR-031      | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-016                             |
| T-018 | P2       | US-007     | FR-030/031  | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-015, T-017                      |
| T-019 | P2       | US-007     | FR-031      | `packages/services/recipe-service/src/grocery-lists/`                             | T-018                             |
| T-020 | P2       | US-007     | FR-031      | `packages/shared/entitlement/src/guards/`                                         | 010-subscriptions                 |
| T-021 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-002, T-004, T-005, T-014        |
| T-022 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-021                             |
| T-023 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-004, T-005, T-014               |
| T-024 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-002                             |
| T-025 | P2       | US-002/004 | FR-028/029  | `packages/apps/commise/web/app/`                                                  | T-006, T-008                      |
| T-026 | P2       | US-003     | FR-029      | `packages/apps/commise/web/app/`                                                  | T-011, T-012, T-025               |
| T-027 | P2       | US-005/006 | FR-030      | `packages/apps/commise/web/app/`                                                  | T-016, T-025                      |
| T-028 | P2       | US-007/008 | FR-031      | `packages/apps/commise/web/app/`                                                  | T-015, T-018, T-019, T-020, T-027 |
| T-029 | P1       | all        | all         | `packages/shared/`                                                                | T-003                             |
| T-030 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-004                             |
| T-031 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-005                             |
| T-032 | P1       | all        | all         | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-014                             |
| T-033 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-022                             |
| T-034 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/`                             | T-023                             |
| T-035 | P1       | all        | all         | `packages/apps/commise/web/e2e/`                                                  | T-025, T-026                      |
| T-036 | P1       | all        | all         | `packages/apps/commise/web/e2e/`                                                  | T-039, T-040                      |
| T-037 | P1       | all        | all         | `packages/apps/commise/web/e2e/`                                                  | T-027, T-028                      |
| T-038 | P1       | all        | all         | `packages/apps/commise/mobile/e2e/`                                               | T-041, T-042                      |
| T-039 | P2       | US-011     | FR-032      | `packages/apps/commise/web/app/`                                                  | T-006, T-007, T-008               |
| T-040 | P2       | US-012     | FR-033      | `packages/apps/commise/web/app/`                                                  | T-025, T-039                      |
| T-041 | P2       | US-002/004 | FR-028/029  | `packages/apps/commise/mobile/app/`                                               | T-006, T-008                      |
| T-042 | P2       | US-003     | FR-029      | `packages/apps/commise/mobile/app/`                                               | T-011, T-012, T-041               |
| T-043 | P2       | US-005/006 | FR-030      | `packages/apps/commise/mobile/app/`                                               | T-016, T-041                      |
| T-044 | P2       | US-007/008 | FR-031      | `packages/apps/commise/mobile/app/`                                               | T-015, T-018, T-019, T-020, T-043 |
| T-045 | P2       | US-011     | FR-032      | `packages/apps/commise/mobile/app/`                                               | T-006, T-007, T-008, T-041        |
| T-046 | P2       | US-012     | FR-033      | `packages/apps/commise/mobile/app/`                                               | T-041, T-045                      |
| T-047 | P1       | all        | FR-028..033 | `packages/services/recipe-service/src/grocery-lists/` → `packages/schemas/recipe` | T-002                             |
| T-048 | P1       | all        | all         | `packages/services/recipe-service/src/grocery-lists/__tests__/`                   | T-002, T-047                      |
| T-049 | P1       | all        | FR-030/031  | `packages/services/recipe-workers/src/grocery/`                                   | T-047, T-018                      |
| T-050 | P2       | US-005/007 | FR-030/031  | `packages/services/recipe-workers/src/grocery/adapters/`                          | T-013, T-015                      |
| T-051 | P1       | all        | FR-028..033 | `packages/clients/recipe-service/`, web + mobile                                  | T-047                             |
| T-052 | P2       | all        | all         | `packages/tools/loadtest/`                                                        | T-024, T-047                      |
| T-053 | P2       | US-012     | FR-033      | `packages/apps/commise/mobile/e2e/`                                               | T-045, T-046                      |
