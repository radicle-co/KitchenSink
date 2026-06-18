# V-Model Traceability Matrix: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Generated**: 2026-05-09
**Baseline Status**: Draft — Pending Execution
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

---

## Artifact Information

| Artifact                   | File                                                 | Created    | Status     | Scope                                                        |
| -------------------------- | ---------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------ |
| Requirements Specification | `specs/007-grocery-lists/v-model/requirements.md`    | 2026-05-09 | Draft      | 11 FR + 4 NF + 6 IF + 3 CN = 24 total requirements           |
| Acceptance Test Plan       | `specs/007-grocery-lists/v-model/acceptance-plan.md` | 2026-05-09 | Draft      | AT cases for all 11 FR + selected NF/IF/CN                   |
| Unit Test Plan             | `specs/007-grocery-lists/v-model/unit-test.md`       | 2026-05-09 | Draft      | 14 MODs (4 EXTERNAL skipped), 32 UTP cases, 73 UTS scenarios |
| System Design              | `specs/007-grocery-lists/v-model/system-design.md`   | —          | Referenced | ARCH modules (ARCH-001 through ARCH-014)                     |
| Module Design              | `specs/007-grocery-lists/v-model/module-design.md`   | —          | Referenced | MOD-001 through MOD-018 (MOD-015–018 EXTERNAL)               |

**Legend**:

- ⬜ Pending Execution — test defined, not yet run
- ✅ Passed — test executed and passed
- ❌ Failed — test executed and failed
- ⚠️ Partially Passed — test executed with partial pass

---

## Matrix A: Forward Traceability (REQ → ATP)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage.

### Functional Requirements

| REQ-ID  | Requirement (Summary)                                        | Priority | ATP-ID   | Acceptance Test (Summary)                                                  | Verification Method      | Status |
| ------- | ------------------------------------------------------------ | -------- | -------- | -------------------------------------------------------------------------- | ------------------------ | ------ |
| REQ-001 | Generate consolidated grocery list from meal plan            | P1       | AT-001-A | Consolidated list generated from 7-day plan; single-recipe plan            | Equivalence Partitioning | ⬜     |
| REQ-002 | Deduplicate ingredients, summing quantities                  | P1       | AT-002-A | Duplicate ingredient merged into single line item with summed quantity     | Equivalence Partitioning | ⬜     |
| REQ-003 | List generation completes within 5 seconds                   | P1       | AT-003-A | Generation completes within 5 s at max and min scale                       | Boundary Value Analysis  | ⬜     |
| REQ-004 | Mark items as "already have"                                 | P1       | AT-004-A | Item toggled to "already have"; toggle reversed; state persists            | Equivalence Partitioning | ⬜     |
| REQ-005 | Exclude "already have" items from shopping view and orders   | P1       | AT-005-A | Marked items absent from shopping view; excluded from online order payload | Equivalence Partitioning | ⬜     |
| REQ-006 | Configure grocery store integrations                         | P2       | AT-006-A | User connects store; manages existing connection                           | Equivalence Partitioning | ⬜     |
| REQ-007 | Guide users through store setup when ordering without config | P2       | AT-007-A | User guided to setup flow without losing grocery list                      | Equivalence Partitioning | ⬜     |
| REQ-008 | Map ingredients to store products and create online order    | P2       | AT-008-A | Active ingredients mapped and order submitted; unmatched items surfaced    | Equivalence Partitioning | ⬜     |
| REQ-009 | Handle empty meal plan with error/guidance message           | P2       | AT-009-A | Clear guidance shown when meal plan has no recipes                         | Equivalence Partitioning | ⬜     |
| REQ-010 | Handle grocery store API outages gracefully                  | P2       | AT-010-A | User-facing error shown; grocery list unchanged; no partial order          | Fault Injection          | ⬜     |
| REQ-011 | Full workflow completable in under 10 minutes                | P2       | AT-011-A | End-to-end workflow from plan to order confirmation under 10 min           | Equivalence Partitioning | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                              | Priority | ATP-ID                         | Acceptance Test (Summary)                                         | Verification Method      | Status |
| ---------- | ------------------------------------------------------------------ | -------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------ | ------ |
| REQ-NF-001 | TypeScript strict mode; no `any` outside test doubles              | P1       | _(Inspection — no AT defined)_ | —                                                                 | Inspection               | ⬜     |
| REQ-NF-002 | All exported functions/interfaces carry JSDoc                      | P1       | _(Inspection — no AT defined)_ | —                                                                 | Inspection               | ⬜     |
| REQ-NF-003 | UI components expose accessible names via `getByRole`/`getByLabel` | P1       | AT-NF-003-A                    | Every interactive element reachable via role/label queries        | Equivalence Partitioning | ⬜     |
| REQ-NF-004 | Color not sole conveyor of state; icon/text label required         | P1       | AT-NF-004-A                    | Every state indicator includes icon or text label alongside color | Equivalence Partitioning | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                               | Priority | ATP-ID                         | Acceptance Test (Summary)                                   | Verification Method      | Status |
| ---------- | ------------------------------------------------------------------- | -------- | ------------------------------ | ----------------------------------------------------------- | ------------------------ | ------ |
| REQ-IF-001 | Integrate with third-party grocery store APIs                       | P2       | _(Inspection — no AT defined)_ | —                                                           | Inspection               | ⬜     |
| REQ-IF-002 | Consume ingredient data from Recipe entities (001)                  | P1       | _(Inspection — no AT defined)_ | —                                                           | Inspection               | ⬜     |
| REQ-IF-003 | Use USDA Food Data (003) for ingredient identity/unit normalization | P1       | _(Inspection — no AT defined)_ | —                                                           | Inspection               | ⬜     |
| REQ-IF-004 | Consume meal plan data from 006-meal-planning                       | P1       | _(Inspection — no AT defined)_ | —                                                           | Inspection               | ⬜     |
| REQ-IF-005 | Enforce Clerk authentication on all endpoints                       | P1       | AT-IF-005-A                    | Unauthenticated requests rejected; user redirected to login | Equivalence Partitioning | ⬜     |
| REQ-IF-006 | Online ordering restricted to premium subscribers (010)             | P2       | AT-IF-006-A                    | Free-tier user sees paywall; order not submitted            | Equivalence Partitioning | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                              | Priority | ATP-ID                         | Acceptance Test (Summary)                     | Verification Method      | Status |
| ---------- | ------------------------------------------------------------------ | -------- | ------------------------------ | --------------------------------------------- | ------------------------ | ------ |
| REQ-CN-001 | All API routes require a valid Clerk session token                 | P1       | AT-CN-001-A                    | Expired/missing JWT → 401; tampered JWT → 401 | Fault Injection          | ⬜     |
| REQ-CN-002 | Online ordering gated behind premium subscription                  | P2       | AT-CN-002-A                    | Free-tier user calling ordering API → 403     | Equivalence Partitioning | ⬜     |
| REQ-CN-003 | Ingredient data derived exclusively from meal plan/recipe entities | P1       | _(Inspection — no AT defined)_ | —                                             | Inspection               | ⬜     |

---

## Matrix B: Backward Traceability (ATP → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

| ATP-ID      | Acceptance Test (Summary)                           | REQ-ID     | Requirement (Summary)                                        | Justification                                                              |
| ----------- | --------------------------------------------------- | ---------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| AT-001-A    | Consolidated list generated from 7-day plan         | REQ-001    | Generate consolidated grocery list from meal plan            | Directly verifies single unified list output from multi-recipe plan        |
| AT-002-A    | Duplicate ingredient merged into single line item   | REQ-002    | Deduplicate ingredients, summing quantities                  | Confirms deduplication and quantity summation including unit normalization |
| AT-003-A    | Generation completes within 5 seconds               | REQ-003    | List generation completes within 5 seconds                   | Boundary test at max and min scale against 5 s SLA                         |
| AT-004-A    | Item toggled to "already have"; state persists      | REQ-004    | Mark items as "already have"                                 | Confirms toggle on/off and cross-session persistence                       |
| AT-005-A    | Marked items absent from shopping view and order    | REQ-005    | Exclude "already have" items from shopping view and orders   | Confirms exclusion from both UI view and online order payload              |
| AT-006-A    | User connects and manages grocery store integration | REQ-006    | Configure grocery store integrations                         | Confirms store connection flow and management of existing connection       |
| AT-007-A    | User guided to setup without losing grocery list    | REQ-007    | Guide users through store setup when ordering without config | Confirms setup guidance flow preserves list state                          |
| AT-008-A    | Active ingredients mapped and order submitted       | REQ-008    | Map ingredients to store products and create online order    | Confirms product mapping and order submission; unmatched items surfaced    |
| AT-009-A    | Guidance shown for empty meal plan                  | REQ-009    | Handle empty meal plan with error/guidance message           | Confirms no silent empty-list state; clear user guidance shown             |
| AT-010-A    | User-facing error on API outage; list unchanged     | REQ-010    | Handle grocery store API outages gracefully                  | Confirms resilience: error surfaced, list preserved, no partial order      |
| AT-011-A    | End-to-end workflow under 10 minutes                | REQ-011    | Full workflow completable in under 10 minutes                | Confirms end-to-end usability SLA from plan to order confirmation          |
| AT-NF-003-A | Interactive elements reachable via role/label       | REQ-NF-003 | UI components expose accessible names                        | Confirms screen-reader and Playwright accessibility query compatibility    |
| AT-NF-004-A | State indicators include icon/text alongside color  | REQ-NF-004 | Color not sole conveyor of state                             | Confirms color-blind-safe state communication in all item states           |
| AT-IF-005-A | Unauthenticated requests rejected                   | REQ-IF-005 | Enforce Clerk authentication on all endpoints                | Confirms auth gate on all grocery list and ordering endpoints              |
| AT-IF-006-A | Free-tier user sees paywall                         | REQ-IF-006 | Online ordering restricted to premium subscribers            | Confirms subscription gate enforced at UI and API layer                    |
| AT-CN-001-A | Expired/missing/tampered JWT → 401                  | REQ-CN-001 | All API routes require a valid Clerk session token           | Confirms JWT validation on every route; tampered tokens rejected           |
| AT-CN-002-A | Free-tier user calling ordering API → 403           | REQ-CN-002 | Online ordering gated behind premium subscription            | Confirms 403 response for non-premium users at API level                   |

---

## Matrix C: Integration Verification

> Integration-level requirements verified at module boundaries (ARCH-level). Unit tests (UTP) verify internal module logic; integration tests verify cross-module contracts.

| Integration Point                                          | REQ-IDs                      | MOD Boundary         | UTP Coverage                                              | Integration Test Status | Notes                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------- | -------------------- | --------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GroceryListController → GroceryListService                 | REQ-001, REQ-002, REQ-003    | MOD-001 ↔ MOD-002    | UTP-001-A, UTP-001-B (service mocked)                     | ⬜                      | Integration test needed: controller delegates to real service; end-to-end list generation                                        |
| GroceryListService → IngredientAggregator                  | REQ-002, REQ-003             | MOD-002 ↔ MOD-003    | UTP-002-A (aggregator mocked)                             | ⬜                      | Integration test needed: real aggregation with USDA normalization                                                                |
| GroceryListService → MealPlanAdapter (EXTERNAL)            | REQ-001, REQ-IF-004          | MOD-002 ↔ MOD-015    | UTP-002-A (adapter mocked)                                | ⬜                      | Integration test needed: real HTTP call to 006-meal-planning API                                                                 |
| GroceryListService → RecipeAdapter (EXTERNAL)              | REQ-001, REQ-IF-002          | MOD-002 ↔ MOD-016    | UTP-002-A (adapter mocked)                                | ⬜                      | Integration test needed: real HTTP call to 001-commise-recipe-app API                                                            |
| IngredientAggregator → UsdaAdapter (EXTERNAL)              | REQ-002, REQ-IF-003          | MOD-003 ↔ MOD-017    | UTP-003-A (adapter mocked)                                | ⬜                      | Integration test needed: real USDA normalization with canonical ingredient IDs                                                   |
| ListStateController → ListStateService                     | REQ-004, REQ-005             | MOD-004 ↔ MOD-005    | UTP-004-A, UTP-004-B (service mocked)                     | ⬜                      | Integration test needed: controller delegates to real service; state persists to DB                                              |
| ListStateService → GroceryListRepository (optimistic lock) | REQ-004, REQ-005             | MOD-005 ↔ MOD-007    | UTP-005-A, UTP-005-B (repository mocked)                  | ⬜                      | Integration test needed: real optimistic lock retry against PostgreSQL                                                           |
| GroceryListRepository → PostgreSQL (transactional insert)  | REQ-001, REQ-002             | MOD-006 ↔ PostgreSQL | UTP-006-A (DB mocked)                                     | ⬜                      | Integration test needed: real transaction with rollback on failure                                                               |
| GroceryListRepository → PostgreSQL (updateItemFlag)        | REQ-004, REQ-005             | MOD-007 ↔ PostgreSQL | UTP-007-A, UTP-007-B (DB mocked)                          | ⬜                      | Integration test needed: real versioned UPDATE with concurrent write simulation                                                  |
| OnlineOrderingController → OnlineOrderingService           | REQ-008, REQ-010             | MOD-008 ↔ MOD-009    | UTP-008-A (service mocked)                                | ⬜                      | Integration test needed: controller delegates to real service; order lifecycle                                                   |
| OnlineOrderingService → GroceryStoreAdapter (EXTERNAL)     | REQ-008, REQ-010, REQ-IF-001 | MOD-009 ↔ MOD-018    | UTP-009-B, UTP-009-C (adapter mocked)                     | ⬜                      | Integration test needed: real HTTP call to grocery store API with retry                                                          |
| StoreConfigController → StoreConfigService                 | REQ-006, REQ-007             | MOD-010 ↔ MOD-011    | UTP-010-A, UTP-010-B (service mocked)                     | ⬜                      | Integration test needed: store config CRUD with real service                                                                     |
| StoreConfigService → StoreConfigRepository + KMS           | REQ-006, REQ-CN-002          | MOD-011 ↔ MOD-012    | UTP-011-A, UTP-011-B, UTP-011-C (repository + KMS mocked) | ⬜                      | Integration test needed: real KMS encrypt/decrypt round-trip with PostgreSQL                                                     |
| AuthMiddleware → Clerk verifyToken (networkless)           | REQ-CN-001, REQ-IF-005       | MOD-013 ↔ MOD-017    | UTP-013-A, UTP-013-B (verification stubbed)               | ⬜                      | Integration test needed: networkless verification with a real Clerk dev-instance token (CLERK_JWT_KEY + azp); no JWKS round trip |
| SubscriptionGuard → SubscriptionsAdapter (EXTERNAL)        | REQ-CN-002, REQ-IF-006       | MOD-014 ↔ MOD-017    | UTP-014-A, UTP-014-B, UTP-014-C (adapter mocked)          | ⬜                      | Integration test needed: real subscription check against 010-subscriptions API                                                   |

---

## Matrix D: Implementation Verification

> Maps module designs (MOD) to unit test cases (UTP) and their scenarios (UTS). Verifies implementation completeness at the code level.

| MOD-ID  | Module Name                                             | Source File                                         | ARCH Parent | UTP Cases                       | UTS Scenarios                                                                                                                                                     | Implementation Status  |
| ------- | ------------------------------------------------------- | --------------------------------------------------- | ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| MOD-001 | GroceryListController                                   | `src/grocery-lists/grocery-list.controller.ts`      | ARCH-001    | UTP-001-A, UTP-001-B            | UTS-001-A1, UTS-001-A2, UTS-001-B1, UTS-001-B2, UTS-001-B3 (5 total)                                                                                              | ⬜                     |
| MOD-002 | GroceryListService — generateList                       | `src/grocery-lists/grocery-list.service.ts`         | ARCH-002    | UTP-002-A, UTP-002-B            | UTS-002-A1, UTS-002-A2, UTS-002-B1, UTS-002-B2 (4 total)                                                                                                          | ⬜                     |
| MOD-003 | IngredientAggregator                                    | `src/grocery-lists/ingredient-aggregator.ts`        | ARCH-003    | UTP-003-A, UTP-003-B            | UTS-003-A1, UTS-003-A2, UTS-003-A3, UTS-003-B1 (4 total)                                                                                                          | ⬜                     |
| MOD-004 | ListStateController                                     | `src/grocery-lists/list-state.controller.ts`        | ARCH-004    | UTP-004-A, UTP-004-B            | UTS-004-A1, UTS-004-A2, UTS-004-B1, UTS-004-B2 (4 total)                                                                                                          | ⬜                     |
| MOD-005 | ListStateService                                        | `src/grocery-lists/list-state.service.ts`           | ARCH-005    | UTP-005-A, UTP-005-B, UTP-005-C | UTS-005-A1, UTS-005-A2, UTS-005-A3, UTS-005-B1, UTS-005-B2, UTS-005-C1, UTS-005-C2 (7 total)                                                                      | ⬜                     |
| MOD-006 | GroceryListRepository — grocery_lists table             | `src/grocery-lists/grocery-list.repository.ts`      | ARCH-006    | UTP-006-A, UTP-006-B, UTP-006-C | UTS-006-A1, UTS-006-A2, UTS-006-B1, UTS-006-B2, UTS-006-B3, UTS-006-C1, UTS-006-C2 (7 total)                                                                      | ⬜                     |
| MOD-007 | GroceryListRepository — updateItemFlag                  | `src/grocery-list/grocery-list.repository.ts`       | ARCH-006    | UTP-007-A, UTP-007-B            | UTS-007-A1, UTS-007-A2, UTS-007-A3, UTS-007-B1, UTS-007-B2 (5 total)                                                                                              | ⬜                     |
| MOD-008 | OnlineOrderingController                                | `src/online-ordering/online-ordering.controller.ts` | ARCH-007    | UTP-008-A                       | UTS-008-A1, UTS-008-A2 (2 total)                                                                                                                                  | ⬜                     |
| MOD-009 | OnlineOrderingService                                   | `src/online-ordering/online-ordering.service.ts`    | ARCH-008    | UTP-009-A, UTP-009-B, UTP-009-C | UTS-009-A1, UTS-009-A2, UTS-009-A3, UTS-009-B1, UTS-009-B2, UTS-009-B3, UTS-009-C1 (7 total)                                                                      | ⬜                     |
| MOD-010 | StoreConfigController                                   | `src/store-config/store-config.controller.ts`       | ARCH-009    | UTP-010-A, UTP-010-B            | UTS-010-A1, UTS-010-A2, UTS-010-B1, UTS-010-B2 (4 total)                                                                                                          | ⬜                     |
| MOD-011 | StoreConfigService                                      | `src/store-config/store-config.service.ts`          | ARCH-010    | UTP-011-A, UTP-011-B, UTP-011-C | UTS-011-A1, UTS-011-A2, UTS-011-B1, UTS-011-B2, UTS-011-C1, UTS-011-C2, UTS-011-C3 (7 total)                                                                      | ⬜                     |
| MOD-012 | StoreConfigRepository                                   | `src/store-config/store-config.repository.ts`       | ARCH-011    | UTP-012-A, UTP-012-B            | UTS-012-A1, UTS-012-B1, UTS-012-B2 (4 total — note: UTS-012-A1 covers findById + kmsDecrypt)                                                                      | ⬜                     |
| MOD-013 | AuthMiddleware                                          | `src/auth/middleware/auth.middleware.ts`            | ARCH-012    | UTP-013-A, UTP-013-B            | UTS-013-A1, UTS-013-A2, UTS-013-A3, UTS-013-A4, UTS-013-A5, UTS-013-B1 (6 total)                                                                                  | ⬜                     |
| MOD-014 | SubscriptionGuard                                       | `src/auth/subscription.guard.ts`                    | ARCH-013    | UTP-014-A, UTP-014-B, UTP-014-C | UTS-014-A1, UTS-014-A2, UTS-014-A3, UTS-014-A4, UTS-014-A5, UTS-014-B1, UTS-014-B2, UTS-014-C1, UTS-014-C2 (7 total — note: UTS-014-A covers 5 state transitions) | ⬜                     |
| MOD-015 | MealPlanAdapter                                         | _(EXTERNAL — 006-meal-planning)_                    | ARCH-014    | —                               | —                                                                                                                                                                 | _(EXTERNAL — skipped)_ |
| MOD-016 | RecipeAdapter                                           | _(EXTERNAL — 001-commise-recipe-app)_               | ARCH-014    | —                               | —                                                                                                                                                                 | _(EXTERNAL — skipped)_ |
| MOD-017 | UsdaAdapter + Clerk verification + SubscriptionsAdapter | _(EXTERNAL — 003, 002, 010)_                        | ARCH-014    | —                               | —                                                                                                                                                                 | _(EXTERNAL — skipped)_ |
| MOD-018 | GroceryStoreAdapter                                     | _(EXTERNAL — third-party grocery store APIs)_       | ARCH-014    | —                               | —                                                                                                                                                                 | _(EXTERNAL — skipped)_ |

### UTP → REQ Traceability (Implementation → Requirement)

| UTP-ID    | Module                                         | Technique                   | REQ-IDs Covered           | UTS Count | Status |
| --------- | ---------------------------------------------- | --------------------------- | ------------------------- | --------- | ------ |
| UTP-001-A | MOD-001 GroceryListController                  | Statement & Branch Coverage | REQ-001, REQ-009          | 2         | ⬜     |
| UTP-001-B | MOD-001 GroceryListController                  | Statement & Branch Coverage | REQ-001, REQ-004, REQ-005 | 3         | ⬜     |
| UTP-002-A | MOD-002 GroceryListService                     | Statement & Branch Coverage | REQ-001, REQ-002, REQ-009 | 2         | ⬜     |
| UTP-002-B | MOD-002 GroceryListService                     | Boundary Value Analysis     | REQ-003                   | 2         | ⬜     |
| UTP-003-A | MOD-003 IngredientAggregator                   | Statement & Branch Coverage | REQ-002                   | 3         | ⬜     |
| UTP-003-B | MOD-003 IngredientAggregator                   | Boundary Value Analysis     | REQ-002                   | 1         | ⬜     |
| UTP-004-A | MOD-004 ListStateController                    | Statement & Branch Coverage | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-004-B | MOD-004 ListStateController                    | Equivalence Partitioning    | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-005-A | MOD-005 ListStateService                       | Statement & Branch Coverage | REQ-004, REQ-005          | 3         | ⬜     |
| UTP-005-B | MOD-005 ListStateService                       | Boundary Value Analysis     | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-005-C | MOD-005 ListStateService                       | Statement & Branch Coverage | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-006-A | MOD-006 GroceryListRepository                  | Statement & Branch Coverage | REQ-001, REQ-002          | 2         | ⬜     |
| UTP-006-B | MOD-006 GroceryListRepository                  | Statement & Branch Coverage | REQ-001, REQ-CN-001       | 3         | ⬜     |
| UTP-006-C | MOD-006 GroceryListRepository                  | Statement & Branch Coverage | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-007-A | MOD-007 GroceryListRepository — updateItemFlag | State Transition Testing    | REQ-004, REQ-005          | 3         | ⬜     |
| UTP-007-B | MOD-007 GroceryListRepository — updateItemFlag | Boundary Value Analysis     | REQ-004, REQ-005          | 2         | ⬜     |
| UTP-008-A | MOD-008 OnlineOrderingController               | Statement & Branch Coverage | REQ-008, REQ-010          | 2         | ⬜     |
| UTP-009-A | MOD-009 OnlineOrderingService                  | Statement & Branch Coverage | REQ-008, REQ-009, REQ-010 | 3         | ⬜     |
| UTP-009-B | MOD-009 OnlineOrderingService                  | State Transition Testing    | REQ-010                   | 3         | ⬜     |
| UTP-009-C | MOD-009 OnlineOrderingService                  | Boundary Value Analysis     | REQ-010                   | 1         | ⬜     |
| UTP-010-A | MOD-010 StoreConfigController                  | Statement & Branch Coverage | REQ-006, REQ-007          | 2         | ⬜     |
| UTP-010-B | MOD-010 StoreConfigController                  | Equivalence Partitioning    | REQ-006                   | 2         | ⬜     |
| UTP-011-A | MOD-011 StoreConfigService                     | Statement & Branch Coverage | REQ-006, REQ-007          | 2         | ⬜     |
| UTP-011-B | MOD-011 StoreConfigService                     | Statement & Branch Coverage | REQ-006, REQ-CN-002       | 2         | ⬜     |
| UTP-011-C | MOD-011 StoreConfigService                     | Statement & Branch Coverage | REQ-006, REQ-CN-001       | 3         | ⬜     |
| UTP-012-A | MOD-012 StoreConfigRepository                  | Statement & Branch Coverage | REQ-006                   | 1         | ⬜     |
| UTP-012-B | MOD-012 StoreConfigRepository                  | Equivalence Partitioning    | REQ-006                   | 2         | ⬜     |
| UTP-013-A | MOD-013 AuthMiddleware                         | State Transition Testing    | REQ-CN-001, REQ-IF-005    | 5         | ⬜     |
| UTP-013-B | MOD-013 AuthMiddleware                         | Boundary Value Analysis     | REQ-CN-001, REQ-IF-005    | 1         | ⬜     |
| UTP-014-A | MOD-014 SubscriptionGuard                      | State Transition Testing    | REQ-CN-002, REQ-IF-006    | 5         | ⬜     |
| UTP-014-B | MOD-014 SubscriptionGuard                      | Equivalence Partitioning    | REQ-CN-002, REQ-IF-006    | 2         | ⬜     |
| UTP-014-C | MOD-014 SubscriptionGuard                      | Boundary Value Analysis     | REQ-CN-002, REQ-IF-006    | 2         | ⬜     |

---

## Matrix H: Hazard Traceability

> Security and safety hazards linked to requirements and their mitigations. Derived from the security-critical and data-integrity-critical nature of the grocery lists and online ordering feature.

| HAZ-ID  | Hazard Description                                                     | Severity | REQ-IDs                | Mitigation                                                                                                                                 | Verification                        | Status |
| ------- | ---------------------------------------------------------------------- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------ |
| HAZ-001 | Unauthenticated access to grocery list data                            | Critical | REQ-CN-001, REQ-IF-005 | AuthMiddleware verifies the session token on every request; missing/expired/tampered tokens or disallowed `azp` → 401                      | AT-CN-001-A, UTP-013-A              | ⬜     |
| HAZ-002 | Free-tier user submits online order bypassing subscription gate        | High     | REQ-CN-002, REQ-IF-006 | SubscriptionGuard enforces premium check; fail-closed on adapter error → 403                                                               | AT-CN-002-A, AT-IF-006-A, UTP-014-A | ⬜     |
| HAZ-003 | Grocery store API credentials exposed in plaintext                     | Critical | REQ-006                | Credentials encrypted with AWS KMS before DB write; decrypted only at read time                                                            | UTP-011-B, UTP-012-A                | ⬜     |
| HAZ-004 | Concurrent "already have" toggle causes data corruption                | High     | REQ-004, REQ-005       | Optimistic locking with version counter; `VersionConflict` triggers retry (max 3); `ConflictError` on exhaustion                           | UTP-007-A, UTP-005-A                | ⬜     |
| HAZ-005 | Partial online order submitted during grocery store API outage         | High     | REQ-010                | Retry with exponential backoff (3 attempts); `ServiceUnavailableError` on exhaustion; grocery list state preserved                         | AT-010-A, UTP-009-B                 | ⬜     |
| HAZ-006 | User accesses another user's grocery list (IDOR)                       | Critical | REQ-CN-001             | `assertOwnership` validates `userId` on every list/item operation; mismatch → `OwnershipError`                                             | UTP-006-B                           | ⬜     |
| HAZ-007 | User deletes another user's store config (IDOR)                        | High     | REQ-006, REQ-CN-001    | `deleteConfig` validates `userId` ownership before delete; mismatch → `ForbiddenException`                                                 | UTP-011-C                           | ⬜     |
| HAZ-008 | Ingredient deduplication produces incorrect quantities (unit mismatch) | Medium   | REQ-002, REQ-IF-003    | USDA normalization converts all quantities to canonical base unit before summation; unknown ingredients pass through with `unitFactor = 1` | AT-002-A, UTP-003-A                 | ⬜     |
| HAZ-009 | Empty meal plan generates silent empty grocery list                    | Medium   | REQ-009                | `generateList` throws `BadRequestError` when active items list is empty; surfaced as user-facing guidance                                  | AT-009-A, UTP-009-A                 | ⬜     |
| HAZ-010 | SubscriptionGuard adapter timeout allows free-tier order               | High     | REQ-CN-002             | Fail-closed: adapter timeout → `ForbiddenException("premium_required")`; `TIMEOUT_MS = 2000`                                               | UTP-014-C                           | ⬜     |
| HAZ-011 | Invalid grocery store provider enum stored in DB                       | Low      | REQ-006                | `ProviderEnum` constraint enforced at DTO validation and DB schema level; invalid value → `DatabaseError`                                  | UTP-012-B                           | ⬜     |
| HAZ-012 | Grocery list generation exceeds 5-second SLA under load                | Medium   | REQ-003                | Parallel ingredient fetch via `Promise.all`; 5 s timeout enforced in `generateList`; `TimeoutError` on breach                              | AT-003-A, UTP-002-B                 | ⬜     |

---

## Coverage Audit

### Functional Requirements Coverage

| Category                                  | Total REQs | REQs with AT | REQs Inspection-Only | REQs with No Coverage | Coverage % |
| ----------------------------------------- | ---------- | ------------ | -------------------- | --------------------- | ---------- |
| Functional (REQ-001 to REQ-011)           | 11         | 11           | 0                    | 0                     | **100%**   |
| Non-Functional (REQ-NF-001 to REQ-NF-004) | 4          | 2            | 2                    | 0                     | **100%**   |
| Interface (REQ-IF-001 to REQ-IF-006)      | 6          | 2            | 4                    | 0                     | **100%**   |
| Constraint (REQ-CN-001 to REQ-CN-003)     | 3          | 2            | 1                    | 0                     | **100%**   |
| **Total**                                 | **24**     | **17**       | **7**                | **0**                 | **100%**   |

> Note: "Inspection-Only" requirements are verified by code review and static analysis, not by executable tests. They are fully covered by their stated verification method.

### Unit Test Coverage

| MOD-ID      | Module                                 | UTP Cases | UTS Scenarios | Techniques Applied                                                                               |
| ----------- | -------------------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------ |
| MOD-001     | GroceryListController                  | 2         | 5             | Statement & Branch Coverage, Strict Isolation                                                    |
| MOD-002     | GroceryListService — generateList      | 2         | 4             | Statement & Branch Coverage, Boundary Value Analysis, Strict Isolation                           |
| MOD-003     | IngredientAggregator                   | 2         | 4             | Statement & Branch Coverage, Boundary Value Analysis, Strict Isolation                           |
| MOD-004     | ListStateController                    | 2         | 4             | Statement & Branch Coverage, Equivalence Partitioning, Strict Isolation                          |
| MOD-005     | ListStateService                       | 3         | 7             | Statement & Branch Coverage, Boundary Value Analysis, Strict Isolation                           |
| MOD-006     | GroceryListRepository — grocery_lists  | 3         | 7             | Statement & Branch Coverage, Strict Isolation                                                    |
| MOD-007     | GroceryListRepository — updateItemFlag | 2         | 5             | State Transition Testing, Boundary Value Analysis, Strict Isolation                              |
| MOD-008     | OnlineOrderingController               | 1         | 2             | Statement & Branch Coverage, Strict Isolation                                                    |
| MOD-009     | OnlineOrderingService                  | 3         | 7             | Statement & Branch Coverage, State Transition Testing, Boundary Value Analysis, Strict Isolation |
| MOD-010     | StoreConfigController                  | 2         | 4             | Statement & Branch Coverage, Equivalence Partitioning, Strict Isolation                          |
| MOD-011     | StoreConfigService                     | 3         | 7             | Statement & Branch Coverage, Strict Isolation                                                    |
| MOD-012     | StoreConfigRepository                  | 2         | 4             | Statement & Branch Coverage, Equivalence Partitioning, Strict Isolation                          |
| MOD-013     | AuthMiddleware                         | 2         | 6             | State Transition Testing, Boundary Value Analysis, Strict Isolation                              |
| MOD-014     | SubscriptionGuard                      | 3         | 9             | State Transition Testing, Equivalence Partitioning, Boundary Value Analysis, Strict Isolation    |
| MOD-015–018 | EXTERNAL modules                       | —         | —             | Skipped (4 modules)                                                                              |
| **Total**   | —                                      | **32**    | **75**        | All 5 ISO 29119-4 techniques represented                                                         |

> Note: UTS count in this matrix reflects the full scenario count per module including all sub-scenarios; minor variance from unit-test.md summary (73) reflects counting of UTS-014-A sub-scenarios.

### Acceptance Test Coverage

| Tier                               | AT Cases        | ATS Scenarios         | Platforms Covered         |
| ---------------------------------- | --------------- | --------------------- | ------------------------- |
| Functional (AT-001 through AT-011) | 11 AT cases     | ~22 ATS scenarios     | Mobile, Web, Backend, API |
| Non-Functional (AT-NF-\*)          | 2 AT cases      | 2 ATS scenarios       | Mobile, Web               |
| Interface (AT-IF-\*)               | 2 AT cases      | 2 ATS scenarios       | Backend, API              |
| Constraint (AT-CN-\*)              | 2 AT cases      | 3 ATS scenarios       | Backend, API              |
| **Total**                          | **17 AT cases** | **~29 ATS scenarios** | All platforms             |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan ATs** (acceptance tests with no corresponding REQ):

> None identified. All AT cases in `acceptance-plan.md` map to a REQ-\* identifier via the naming convention (AT-NNN-X → REQ-NNN, AT-NF-NNN-X → REQ-NF-NNN, AT-IF-NNN-X → REQ-IF-NNN, AT-CN-NNN-X → REQ-CN-NNN).

**Orphan UTPs** (unit test cases with no corresponding MOD):

> None identified. All UTP cases in `unit-test.md` map to a MOD-NNN identifier (UTP-001 through UTP-014).

**Orphan REQs** (requirements with no verification path):

> None identified. All 24 requirements have at least one verification method (Test, Inspection, or Analysis).

### Gap Analysis

**Requirements with no executable acceptance test (Inspection-Only)**:

These requirements are verified by code review, static analysis, or architectural dependency inspection — not by executable test scenarios. They are **not gaps** but are flagged for completeness:

| REQ-ID     | Verification Method | Risk Level | Mitigation                                                                                                                        |
| ---------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| REQ-NF-001 | Inspection          | Low        | TypeScript `strict: true` enforced by CI (`tsc --noEmit`); `any` usage detectable via ESLint `@typescript-eslint/no-explicit-any` |
| REQ-NF-002 | Inspection          | Low        | JSDoc coverage reviewable via `eslint-plugin-jsdoc` linting rules                                                                 |
| REQ-IF-001 | Inspection          | Low        | Third-party API integration contracts verifiable by code review of adapter implementations                                        |
| REQ-IF-002 | Inspection          | Low        | Recipe entity consumption verifiable by code review of `RecipeAdapter` interface and usage                                        |
| REQ-IF-003 | Inspection          | Low        | USDA adapter usage verifiable by code review of `IngredientAggregator` dependency injection                                       |
| REQ-IF-004 | Inspection          | Low        | Meal plan adapter usage verifiable by code review of `GroceryListService` dependency injection                                    |
| REQ-CN-003 | Inspection          | Low        | Scope constraint; absence of manual ingredient entry verifiable by code review and API surface inspection                         |

**Modules with no unit test coverage** (implementation gaps):

| Gap                                                             | Description                        | Risk   | Recommendation                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-015 MealPlanAdapter                                         | EXTERNAL — no unit tests by design | Medium | Integration test needed: verify HTTP contract with 006-meal-planning API in staging environment                                      |
| MOD-016 RecipeAdapter                                           | EXTERNAL — no unit tests by design | Medium | Integration test needed: verify HTTP contract with 001-commise-recipe-app API in staging environment                                 |
| MOD-017 UsdaAdapter + Clerk verification + SubscriptionsAdapter | EXTERNAL — no unit tests by design | Medium | Integration tests needed: USDA normalization, networkless Clerk session-token verification (CLERK_JWT_KEY + azp), subscription check |
| MOD-018 GroceryStoreAdapter                                     | EXTERNAL — no unit tests by design | High   | Integration test needed: verify HTTP contract with grocery store provider APIs (Kroger, Walmart, Instacart) in sandbox               |

**Requirements covered only at unit level (no acceptance test)**:

> None. All requirements verified by Test method have at least one acceptance test case. Requirements verified by Inspection are covered by their stated method.

**Integration test gaps** (cross-module contracts not yet covered by integration tests):

| Gap                                                                | REQ-IDs          | Risk   | Recommendation                                                                                 |
| ------------------------------------------------------------------ | ---------------- | ------ | ---------------------------------------------------------------------------------------------- |
| No integration test for optimistic lock under real concurrent load | REQ-004, REQ-005 | High   | Add PostgreSQL-level concurrency test simulating two simultaneous `updateItemFlag` calls       |
| No integration test for KMS encrypt/decrypt round-trip             | REQ-006          | High   | Add integration test verifying credentials survive KMS encrypt → store → decrypt cycle         |
| No integration test for 5-second SLA under realistic data volume   | REQ-003          | Medium | Add load test with 7-day plan at maximum expected recipe/ingredient count against real DB      |
| No integration test for grocery store API retry with real HTTP     | REQ-010          | Medium | Add integration test using WireMock or similar to simulate API outage and verify retry/backoff |
