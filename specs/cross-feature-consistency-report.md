# Cross-Feature Consistency Report — Product Forge Features 001–010

**Generated**: 2026-05-09
**Scope**: `specs/001-commise-recipe-app` through `specs/010-subscriptions`
**Status**: Bootstrap-state — no implementation code exists; analysis covers spec-layer artifacts only (`spec.md`, `product-spec/product-spec.md`, `plan.md`, `research/codebase-analysis.md`)

---

## 1. Shared Concerns Matrix

Matrix of which features explicitly touch each cross-cutting domain. "●" = feature has concrete spec/plan content; "○" = referenced but not primary owner.

| Domain                         | 001 | 002 | 003 | 004 | 005 | 006 | 007 | 008 | 009 | 010 |
| ------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Auth / Clerk**               | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   | ●   |
| **USDA / Food Data**           | ●   |     | ●   | ○   |     | ●   | ●   |     | ●   |     |
| **AI / LLM**                   |     |     |     |     | ●   | ○   |     |     |     |     |
| **Photo Storage (S3/CDN)**     | ●   |     |     | ○   |     |     |     |     |     |     |
| **Billing / Stripe**           | ○   |     |     |     | ○   | ○   | ○   |     | ○   | ●   |
| **Offline Mode**               |     |     |     |     |     |     |     | ●   |     |     |
| **Sync / Conflict Resolution** | ●   |     |     |     |     |     |     | ●   |     |     |
| **Notifications**              | ○   |     | ○   |     | ○   |     |     | ○   | ○   | ○   |
| **Search (FTS)**               | ●   |     | ●   |     | ○   |     | ○   |     |     |     |

**Key observations**:

- Auth/Clerk is the most pervasive concern — every feature lists 002 as a **Required** or **Referenced** dependency. This is the expected foundational dependency.
- USDA food data is the second most pervasive, touching 001 (ingredient backing), 003 (owner), 006, 007, and 009.
- Photo storage is owned by 001; 004 (recipe importing) is the only other feature that references it (for OCR imports).
- Notifications, offline mode, and sync are the thinnest — each covered by only 1–2 features with scattered references.

---

## 2. Contract Drift

### 2.1 FR Numbering Collisions

Each feature's spec defines its own FR number sequence starting from FR-001. There is **no system-wide unique FR identifier** — `FR-001` means different things in every spec. Cross-feature FR references (e.g., `001 FR-045` in 002's spec) use the source feature's numbering.

| FR Number | Used In         | Meaning                                        |
| --------- | --------------- | ---------------------------------------------- |
| `FR-001`  | 001 spec.md:77  | Recipe creation with full fields               |
| `FR-001`  | 002 spec.md:206 | Clerk auth via hosted sign-in (session tokens) |
| `FR-001`  | 003 spec.md     | (USDA food lookup — different section)         |
| `FR-001`  | 005 spec.md     | (AI provider config — different section)       |
| `FR-001`  | 006 spec.md     | (Meal plan creation — different section)       |
| `FR-001`  | 007 spec.md     | (Grocery list generation — different section)  |
| `FR-001`  | 008 spec.md:42  | Cooking Mode step display                      |
| `FR-001`  | 009 spec.md     | (Nutrition plan creation — different section)  |
| `FR-001`  | 010 spec.md     | (Free tier definition — different section)     |

**Severity**: ⚠️ **WARNING** — Ambiguous in cross-feature references. When features reference "FR-045" from another spec they must qualify it as `<feature>-FR-045`. All existing cross-references do this correctly (`001 FR-045`, `003 FR-035`, etc.). However, no canonical cross-reference index exists to validate these references.

**Files**: `specs/002-user-auth/spec.md:12` (`001 FR-045`), `specs/002-user-auth/spec.md:13` (`003 FR-035`), `specs/005-ai-integration/spec.md:14` (external agent OAuth builds on auth layer)

---

### 2.2 API Endpoint Prefix Drift

| Feature | API Prefix Claimed                                         | Source                                                                                   |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 001     | `/api/recipes`, `/api/collections`, `/api/photos`          | `contracts/api.openapi.yaml:25+`                                                         |
| 002     | `/v1/auth/*`, `/v1/profile`, `/v1/account`                 | `plan.md:todo` (section 3, API contracts)                                                |
| 003     | `/v1/foods/*` (URL prefix versioning)                      | `spec.md:23` ("Q: versioning strategy → A: URL prefix versioning — `/v1/foods/{fdcId}`") |
| 004     | `/v1/recipes/import`                                       | `plan.md:15` (`POST /v1/recipes/import`)                                                 |
| 005     | `/v1/ai/*` (implied)                                       | `tasks.md:103` (`401 if unauthenticated — Clerk AuthMiddleware`)                         |
| 006     | `/v1/meal-plans/*`                                         | `plan.md:85-95`                                                                          |
| 007     | `/v1/grocery-lists/*`                                      | `plan.md` (section 3)                                                                    |
| 008     | `/v1/recipes/{id}/instructions` (consumed from 001)        | `plan.md:77`                                                                             |
| 009     | `/v1/nutrition-plans/*` (implied)                          | `plan.md` (section 3)                                                                    |
| 010     | `/v1/account/upgrade` (Stripe Checkout), webhook endpoints | `plan.md:13-24`                                                                          |

**Severity**: ⚠️ **WARNING** — 001 uses `/api/*` while 002–010 all use `/v1/*`. No formal API contract convention document exists. 001's own OpenAPI spec (`contracts/api.openapi.yaml`) uses `/api/recipes` which conflicts with the rest-of-system `/v1/*` convention. This will cause client SDK misalignment if not resolved before implementation.

**Files**:

- `specs/001-commise-recipe-app/contracts/api.openapi.yaml:25` — uses `/api/recipes`
- `specs/003-usda-food-data/spec.md:23` — explicitly opts for `/v1/foods/*`
- `specs/006-meal-planning/plan.md:85-95` — uses `/v1/meal-plans/*`

---

### 2.3 Node.js Version Inconsistency

| Feature | Node.js Version                                                           | Source                                                                               |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 001     | 24.x (`.nvmrc` + `package.json` engines)                                  | `plan.md:21`                                                                         |
| 002     | 22.x (Lambda runtime)                                                     | `plan.md:22` ("**Language/Version**: TypeScript 5.x, Node.js 22.x (Lambda runtime)") |
| 003     | (not explicitly declared in spec/plan; codebase-analysis says `>=24.0.0`) | `research/codebase-analysis.md:63`                                                   |
| 004     | (not explicitly declared in spec/plan)                                    | —                                                                                    |
| 005     | 24.x (NestJS 11)                                                          | `plan.md:6`                                                                          |
| 006     | (not explicitly declared)                                                 | —                                                                                    |
| 007     | (not explicitly declared)                                                 | —                                                                                    |
| 008     | (not explicitly declared)                                                 | —                                                                                    |
| 009     | (not explicitly declared)                                                 | —                                                                                    |
| 010     | (not explicitly declared)                                                 | —                                                                                    |

**Severity**: ⚠️ **WARNING** — 002 explicitly targets Node.js **22.x** (Lambda runtime), while 001, 005 target **24.x**. This is potentially intentional (002 is Lambda-only vs 001's Fargate backend), but the difference is not explained in any shared conventions document. The monorepo root `package.json` enforces `>=24.0.0`, so 002's plan may be inconsistent with the workspace root.

**Files**:

- `specs/001-commise-recipe-app/plan.md:21`
- `specs/002-user-auth/plan.md:22`

---

### 2.4 Entity / Data Model Name Drift

| Concept                    | 001 Name                                        | 003 Name                                | 006 Name                           | 007 Name                                               | 009 Name                                        |
| -------------------------- | ----------------------------------------------- | --------------------------------------- | ---------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Nutritional data aggregate | `Recipe.nutrition` (per-ingredient via FR-007a) | `foods` table (USDA nutrients per 100g) | `meal_plan_nutrition` table        | `grocery_list_items` (aggregated, normalized to grams) | `nutrition_compliance` table                    |
| Plan/assignment entity     | `Recipe` (user-created)                         | —                                       | `meal_plans` + `meal_plan_entries` | `grocery_lists` + `grocery_list_items`                 | `nutrition_plans` + `meal_plan_nutrition_link`  |
| User context               | `users` table                                   | —                                       | —                                  | —                                                      | `trainer_clients` (trainer-client relationship) |
| Unique food identifier     | `fdcId` (from USDA)                             | `fdc_id` (column name)                  | references via `fdcId`             | `usda_fdc_id` in `grocery_list_items`                  | references via `fdcId`                          |
| Subscription tier field    | `Account.plan` ('free'/'premium')               | —                                       | —                                  | —                                                      | —                                               |

**Severity**: ⚠️ **WARNING** — 003 uses `fdc_id` (snake_case column name) while 007 uses `usda_fdc_id` (full snake_case). 006's `meal_plan_nutrition` table is not the same as 001's per-recipe nutrition. No shared type library (`shared/recipe-core`) yet enforces these conventions across features. These are not yet true conflicts (no implementation), but the naming divergence will need resolution before code generation.

**Files**:

- `specs/003-usda-food-data/plan.md:51` (`fdc_id INT PRIMARY KEY`)
- `specs/007-grocery-lists/plan.md:55` (`usda_fdc_id INT REFERENCES foods(fdc_id)`)
- `specs/006-meal-planning/plan.md:67` (`meal_plan_nutrition` table)
- `specs/010-subscriptions/plan.md:61` (`plan: 'free' | 'premium'`)

---

### 2.5 Visibility / Tier Gatekeeping Terminology Inconsistency

| Feature        | Terminology Used                                                      | Source       |
| -------------- | --------------------------------------------------------------------- | ------------ |
| 001 spec.md:80 | "Free-tier users' recipes are always public"                          | `spec.md:80` |
| 010 spec.md    | "free tier" and "premium subscription"                                | `spec.md`    |
| 004 spec.md:14 | "visibility rules differ for free vs premium users"                   | `spec.md:14` |
| 005 spec.md:14 | "AI generation and instruction optimization are premium features"     | `spec.md:14` |
| 006 spec.md:18 | "AI suggestions, auto-generation, and waste optimization are premium" | `spec.md:18` |
| 008 spec.md    | (no tier gating — cooking mode is free)                               | `spec.md`    |

**Severity**: ℹ️ **INFO** — Terminology is consistent across all features ("free" / "premium"). 008 is notably absent from premium gating references, implying it is a free feature — this is consistent with its standalone dependency list (only 001 + 002).

---

## 3. Dependency Ordering

### 3.1 Declared Dependencies (from spec.md Dependency tables)

```
001 (foundational)
 ├── 002 (Required)
 ├── 003 (Provides ingredient data)
 ├── 004 (Extends recipe creation)
 ├── 005 (Extends recipe creation)
 ├── 006 (Consumes recipes)
 ├── 007 (Consumes ingredients via meal plans)
 ├── 008 (Consumes recipe instructions)
 ├── 009 (Consumes nutritional data via meal plans)
 └── 010 (Gates premium features)

002 (foundational — Clerk)
 └── (all features depend on it indirectly)

003 (USDA food data — feeds 001, 006, 007, 009)
 └── 002 (Required — Clerk session-token verification)

004 (Recipe importing — extends 001)
 ├── 001 (Required)
 ├── 002 (Required)
 └── 010 (Referenced — visibility)

005 (AI integration — extends 001)
 ├── 001 (Required)
 ├── 002 (Required)
 └── 010 (Referenced — premium gating)

006 (Meal planning — consumes 001, 003, 002)
 ├── 001 (Required)
 ├── 003 (Required)
 ├── 002 (Required)
 ├── 005 (Referenced — AI meal suggestions)
 ├── 007 (Downstream — grocery lists from meal plans)
 ├── 009 (Downstream — nutrition plans link to meal plans)
 └── 010 (Referenced — premium gating)

007 (Grocery lists — consumes 006, 001, 003, 002)
 ├── 006 (Required — generates from meal plans)
 ├── 001 (Required)
 ├── 003 (Required)
 ├── 002 (Required)
 └── 010 (Referenced — online ordering is premium)

008 (Cooking mode — consumes 001, 002)
 ├── 001 (Required)
 └── 002 (Required)

009 (Nutrition planning — consumes 006, 003, 001, 002)
 ├── 006 (Required)
 ├── 003 (Required)
 ├── 001 (Required)
 ├── 002 (Required)
 └── 010 (Referenced — trainer planning is premium)

010 (Subscriptions — gates premium features)
 ├── 002 (Required — subscription tier on Account entity)
 └── 001, 004, 005, 006, 007, 009 (all Referenced)
```

### 3.2 Ordering Constraints (Topological Sort)

| Phase                                                | Features           | Rationale                                                                                                                                             |
| ---------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 (must build first)**                       | 001, 002           | All other features depend on the recipe entity model (001) and auth (002)                                                                             |
| **Phase 2 (after 001+002)**                          | 003, 004, 005, 008 | Directly depend only on 001+002; no inter-feature ordering requirements among them                                                                    |
| **Phase 3 (after 001+002+003)**                      | 006, 009           | Require USDA food data from 003 in addition to 001+002                                                                                                |
| **Phase 4 (after 006)**                              | 007                | Requires meal plans from 006 to generate grocery lists                                                                                                |
| **Phase 5 (at any point, gates Phase 2-4 features)** | 010                | Subscription tier gates premium features in 004, 005, 006, 007, 009; can be built in parallel but must be live before premium features are functional |

**Severity**: ⚠️ **WARNING** — **006-meal-planning → 007-grocery-lists** is the only hard **inter-feature dependency chain** (006 outputs consumed by 007). If 007 is built before 006, its `meal_plan_id UUID REFERENCES meal_plans(id)` foreign key in `grocery_lists` (`plan.md:43`) would have no target table. This is correctly captured in 007's dependency table but not flagged as a blocking constraint.

**Files**:

- `specs/007-grocery-lists/spec.md:10-16` (dependency table)
- `specs/007-grocery-lists/plan.md:43` (`meal_plan_id UUID REFERENCES meal_plans(id)`)
- `specs/006-meal-planning/spec.md:16` (007 is downstream)

---

## 4. Naming / Terminology Consistency

| Concept                       | Preferred Term                        | Variants Used                                                                                 | Features Using Each                  |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| Food database ID              | `fdcId`                               | `fdc_id` (column), `usda_fdc_id` (column)                                                     | All (003 owns, others reference)     |
| USDA nutritional record       | "Food"                                | "Ingredient" (001 spec.md clarification: Food = USDA record, Ingredient = recipe component)   | 003 (primary), 001, 006, 007, 009    |
| Meal assignment time slot     | "meal_type"                           | "meal slot" (006 plan.md:59)                                                                  | 006, 007                             |
| Grocery line item             | "grocery_list_items"                  | "items" (007 plan.md), "line items" (007 spec.md)                                             | 007                                  |
| Subscription tier             | "premium"                             | "paid" (not used), "subscription" (010 plan.md)                                               | 010 (owner), 004, 005, 006, 007, 009 |
| Free tier                     | "free" (consistent)                   | —                                                                                             | All                                  |
| Nutritional compliance status | "compliance_status"                   | "compliance_status TEXT" in 009 plan.md:84; not referenced in other features                  | 009 only                             |
| Trainer-client relationship   | "trainer_clients" table               | "trainer-client model" (009 spec.md), "trainer-client relationship" (009 plan.md)             | 009 only                             |
| Version archiving             | "version archive" / "pending archive" | "version-archive-worker" (001 plan.md), "recipe_version_pending_archives" (001 data-model.md) | 001 only                             |
| Screen wake lock              | "wake lock"                           | "screen active" (008 spec.md acceptance), "keep screen on" (008 plan.md)                      | 008 only                             |
| AI provider user-owned keys   | "BYOK"                                | "user-provided keys" (005 plan.md:46), "user-configured provider" (005 spec.md)               | 005 only                             |

**Severity**: ℹ️ **INFO** — No contradictory terminology detected. The main risk is `fdcId` vs `fdc_id` vs `usda_fdc_id` which is a column-naming (snake_case vs camelCase) convention issue, not a semantic conflict.

---

## 5. Open Cross-Feature Questions

The following gaps are not owned by any single feature spec and require a cross-cutting decision:

### 5.1 No Shared `shared/recipe-core` Type Library Exists Yet

**Question**: Who owns `packages/shared/src/recipe-core/`? 001 plan.md:126-129 defines `shared/recipe-core` as the home for `Recipe`, `Ingredient`, `Step`, `Collection` types. 002, 003, 005, 006, 007, 008, 009, 010 all define their own data models extending or referencing these entities. No feature has a task to actually create `shared/recipe-core`.

**Impact**: Until `shared/recipe-core` is extracted and published, each feature risks defining its own view of `Recipe`, `Ingredient`, `User`, `Account`. This is the primary contract drift risk.

**Owner suggestion**: 001 (foundational — should extract shared types as part of its implementation).

---

### 5.2 No Shared Error Taxonomy

**Question**: Is there a system-wide error code convention? 002 plan.md mentions `401` from Clerk AuthMiddleware, 003 plan.md mentions `not_found / failed / pending` fetch statuses, 005 plan.md mentions `401` from Clerk AuthMiddleware. 001 plan.md mentions `400` for validation.

**Impact**: Each feature may define its own error code semantics. A cross-feature API error handling convention is needed before 006+007 are implemented.

---

### 5.3 No Shared Notification System

**Question**: Which feature owns push/email/in-app notifications? 001 product-spec mentions notifications; 003 plan.md mentions "email/webhook notifications" for food fetch failures; 005 plan.md mentions "transparency disclosures on AI-generated content"; 008 plan.md mentions timer alerts; 009 plan.md mentions "notifications for compliance gaps".

**Impact**: Five features independently reference notifications with no owner. A notification delivery system (Push, email, in-app) is not specced anywhere.

---

### 5.4 Offline / Sync Strategy Is Unresolved for Most Features

**Question**: 001 spec.md:spec mentions soft-delete tombstone, 001 plan.md mentions version archive with S3 + SQS + DLQ, 008 plan.md mentions `CookingSession` persisted to device storage. But there is no shared offline architecture. 006, 007, 009 have no offline strategy.

**Impact**: 007 grocery lists and 006 meal plans will need offline support for a usable mobile experience. Without a shared strategy (e.g., CRDT-based sync, Operational Transform, or a simple conflict-resolution policy), each feature will invent its own approach.

**Files**:

- `specs/008-cooking-mode/plan.md:39-47` (CookingSession device storage)
- `specs/001-commise-recipe-app/spec.md` (soft delete tombstone)
- `specs/001-commise-recipe-app/plan.md:15-16` (S3 version archive with SQS+DLQ)

---

### 5.5 Search Architecture Ownership

**Question**: 001 plan.md specifies PostgreSQL FTS (`tsvector`/`tsquery` + GIN indexes) as the primary search with a Typesense fallback. 003 plan.md specifies Redis cache + PostgreSQL for food data search. No feature owns a "Search Service" that spans both recipe and food data.

**Impact**: Recipe search (001) and food search (003) are separate implementations. A user searching for "chicken pasta" who expects unified recipe + ingredient results has no cross-feature search behavior defined.

---

### 5.6 EU AI Act Compliance Ownership

**Question**: 005 spec.md:18 states "EU AI Act compliance: Transparency disclosures on all AI-generated content. Live August 2, 2026." This affects any feature that displays AI-generated content (005 AI generation, 006 AI meal suggestions, 009 AI recipe swaps).

**Impact**: The specific disclosure format, placement, and opt-out policy for AI-generated content is defined only in 005. Features 006 and 009 that generate AI content via 005 are not explicitly scoped to the same compliance requirement.

---

## 6. Severity-Ranked Findings

### 🔴 CRITICAL

**(Requires resolution before Phase 3+ implementation)**

---

**[CR-001] API Prefix Collision: 001 uses `/api/*` while 002–010 use `/v1/*`**

- **Severity**: CRITICAL
- **Files**:
    - `specs/001-commise-recipe-app/contracts/api.openapi.yaml:25` — `/api/recipes`
    - `specs/003-usda-food-data/spec.md:23` — `/v1/foods/*`
    - `specs/006-meal-planning/plan.md:85-95` — `/v1/meal-plans/*`
    - `specs/007-grocery-lists/plan.md` — `/v1/grocery-lists/*`
- **Finding**: 001's OpenAPI spec defines all paths under `/api/*`. All other features (002–010) plan their endpoints under `/v1/*`. The monorepo has no shared API convention document. This means a client SDK generated from 001's OpenAPI spec would use `/api/*` while the majority of features use `/v1/*`, creating a fragmented API surface.
- **Recommendation**: Establish `/v1/*` as the canonical prefix. Update 001's OpenAPI spec and move existing endpoints from `/api/*` to `/v1/*` as part of 001's implementation. Create a shared API convention artifact (e.g., `docs/api-conventions.md`) before Phase 2 begins.

---

**[CR-002] No Shared Type Library: `shared/recipe-core` Is Referenced But Never Created**

- **Severity**: CRITICAL
- **Files**:
    - `specs/001-commise-recipe-app/plan.md:126-129` — defines `shared/recipe-core` with `Recipe`, `Ingredient`, `Step`, `Collection` types but no task creates it
    - `specs/002-user-auth/research/codebase-analysis.md:71-74` — defines its own `User` and `Account` types independent of any shared library
    - `specs/006-meal-planning/plan.md:40-77` — defines `meal_plans`, `meal_plan_entries`, `meal_plan_nutrition` without referencing a shared type
    - `specs/010-subscriptions/plan.md:58-78` — adds `plan`, `subscriptionStatus` to `Account` entity with no shared type reference
- **Finding**: Eight features define or reference entity types in isolation. 001's plan.md promises a `shared/recipe-core` package but no feature has a task to create or publish it. This is the primary enabler of contract drift.
- **Recommendation**: Add a `shared/recipe-core` extraction task to 001's task list. All features that define entities should import from `shared/recipe-core` as a hard constraint. Consider a shared `entities` workspace package (`packages/shared/src/entities/`) that includes `User`, `Account`, `Recipe`, `Ingredient`, `Food`, `MealPlan`, `NutritionPlan`, `GroceryList`.

---

### ⚠️ WARNING

**(Should be resolved before Phase 2 implementation begins)**

---

**[WA-001] Node.js Version Mismatch: 002 Targets 22.x (Lambda) While Monorepo Root Targets ≥24.x**

- **Severity**: WARNING
- **Files**:
    - `specs/002-user-auth/plan.md:22` — "Node.js 22.x (Lambda runtime)"
    - `specs/001-commise-recipe-app/plan.md:21` — "Node.js 24.x (per `.nvmrc` + `package.json` engines)"
    - `specs/002-user-auth/research/codebase-analysis.md:28` — "`>=24.0.0` at monorepo root"
- **Finding**: 002's plan says Node 22.x but the monorepo root `package.json` enforces `>=24.0.0`. This is potentially intentional (Lambda runtime may lag), but 002's plan does not explain or justify the divergence. Lambda Node.js 22 runtime was announced in late 2024 and is available in all commercial regions.
- **Recommendation**: Align 002 to Node.js 24.x or explicitly document why 22.x is required. If Lambda确实是22-only at launch, document a migration plan to 24.x.

---

**[WA-002] Inter-Feature Dependency Chain: 006 → 007 is Implied But Not Flagged as Blocking**

- **Severity**: WARNING
- **Files**:
    - `specs/007-grocery-lists/spec.md:10-12` — "**Required** — grocery lists are generated from meal plans"
    - `specs/007-grocery-lists/plan.md:43` — `meal_plan_id UUID REFERENCES meal_plans(id)`
    - `specs/006-meal-planning/spec.md:16` — "007-grocery-lists is **Downstream**"
- **Finding**: 007 depends on 006 for its `meal_plan_id` foreign key. If 007 is built before 006's `meal_plans` table exists, the migration would fail. This is a standard foreign-key dependency, but 007's spec does not flag it as a "blocking" constraint in the same way it declares 006 as "Required".
- **Recommendation**: Add a note to 007's spec that the 006 `meal_plans` table must exist (migrated) before 007's migration can run. This is a standard database deployment ordering concern.

---

**[WA-003] FR Number Ambiguity Without System-Wide Namespace**

- **Severity**: WARNING
- **Files**:
    - `specs/002-user-auth/spec.md:12` — "001 FR-045 requires authentication"
    - `specs/002-user-auth/spec.md:13` — "003 FR-035 uses the shared API Gateway authorizer"
    - `specs/001-commise-recipe-app/spec.md:14` — "Provides the food/nutrition database backing FR-007 (ingredient data)"
- **Finding**: All cross-feature FR references correctly qualify with the source feature prefix (`001 FR-045`). However, no validation mechanism exists to detect a missing or renamed FR in a source spec. A future refactor of 001 that renames FR-045 would break 002's spec with no automated detection.
- **Recommendation**: Create a cross-feature FR reference index artifact (`specs/cross-feature-FR-index.md`) that lists all cross-feature FR citations. This can be verified manually or via a CI check that `rg "FR-\d+" specs/NNN-spec.md` references are validated against a central registry.

---

**[WA-004] Notification System Has No Owner**

- **Severity**: WARNING
- **Files**:
    - `specs/001-commise-recipe-app/product-spec/product-spec.md` — notifications mentioned in vision/principles
    - `specs/003-usda-food-data/plan.md` — "email/webhook notifications" for fetch failures
    - `specs/005-ai-integration/plan.md:18` — "EU AI Act transparency disclosures"
    - `specs/008-cooking-mode/plan.md` — timer alerts
    - `specs/009-nutrition-planning/plan.md` — compliance gap notifications
- **Finding**: Five features reference notification behavior with no feature owning the notification delivery infrastructure. No feature's spec has a dependency on a notification service, and no plan defines a notification module.
- **Recommendation**: Assign notification infrastructure ownership. Options: (a) 001 extends to own a `notifications` module, (b) a new feature 011 is created for cross-app notifications, or (c) an external service (e.g., AWS SNS, SendGrid) is used with a convention that features publish notification events to a shared topic.

---

**[WA-005] Offline / Sync Strategy Is Isolated to 008**

- **Severity**: WARNING
- **Files**:
    - `specs/008-cooking-mode/plan.md:39-47` — `CookingSession` persisted to device storage (IndexedDB/AsyncStorage)
    - `specs/001-commise-recipe-app/plan.md:15-16` — S3 version archive with SQS+DLQ for async retry
    - `specs/007-grocery-lists/plan.md` — no offline strategy mentioned
    - `specs/006-meal-planning/plan.md` — no offline strategy mentioned
- **Finding**: Only 008 has a concrete offline architecture (device-side session persistence). 007 grocery lists and 006 meal plans have no specified offline behavior, yet a mobile user standing in a grocery store with spotty connectivity would expect their list to work offline. 001's async S3 archive is not the same as client-side offline-first.
- **Recommendation**: Define a cross-feature offline strategy before mobile implementation begins. At minimum, decide: (a) which features require offline support, (b) a shared persistence layer (IndexedDB for web, AsyncStorage for mobile), and (c) a sync reconciliation strategy.

---

**[WA-006] EU AI Act Compliance Not Propagation to Downstream AI Features**

- **Severity**: WARNING
- **Files**:
    - `specs/005-ai-integration/spec.md:18` — "EU AI Act compliance: Transparency disclosures on all AI-generated content. Live August 2, 2026."
    - `specs/006-meal-planning/spec.md` — "AI meal suggestions" (premium feature) but no EU AI Act mention
    - `specs/009-nutrition-planning/spec.md` — "AI recipe swaps" (premium feature) but no EU AI Act mention
- **Finding**: 005 owns the EU AI Act compliance requirement for AI-generated content disclosures. Features 006 and 009 generate AI content via 005's provider but do not explicitly inherit the disclosure requirement. If a user gets an AI-generated meal plan (006) or an AI recipe swap (009), the same transparency disclosure may be legally required.
- **Recommendation**: Add EU AI Act compliance scope to 006 and 009 specs, referencing 005's disclosure implementation. The disclosure component should be in a shared UI location so 006/009 can reuse it rather than reimplementing.

---

### ℹ️ INFO

\*\*(Low urgency; noted for completeness)

---

**[IN-001] `fdcId` Naming Inconsistency Across Column Names**

- **Severity**: INFO
- **Files**:
    - `specs/003-usda-food-data/plan.md:51` — `fdc_id INT PRIMARY KEY`
    - `specs/007-grocery-lists/plan.md:55` — `usda_fdc_id INT REFERENCES foods(fdc_id)`
- **Finding**: Snake*case column names use `fdc_id` in 003 and `usda_fdc_id` in 007. This is a convention-level inconsistency (one feature uses the raw USDA field name, another prefixes it with `usda*` for disambiguation). Both are valid; the issue is no shared column naming convention.
- **Recommendation**: Document a snake_case naming convention for all foreign key columns that reference other feature's tables. Suggested rule: `referencingFeature_referencedFeature_primaryKey` (e.g., `usda_fdc_id` if the column lives in another feature's table, or just `fdc_id` if in the feature that owns the table).

---

**[IN-002] `meal_plan_nutrition` Table Name Collides With 006's Same-Name Aggregate**

- **Severity**: INFO
- **Files**:
    - `specs/006-meal-planning/plan.md:67` — `meal_plan_nutrition` table (aggregated nutritional totals per meal plan day)
    - `specs/001-commise-recipe-app/data-model.md` — may define related nutrition fields
- **Finding**: 006 defines `meal_plan_nutrition` as an aggregated per-day table. 001 defines per-recipe nutrition override fields. No collision currently (different tables), but the naming similarity could cause confusion during implementation.
- **Recommendation**: Consider renaming 006's `meal_plan_nutrition` to `meal_plan_daily_nutrition` for clarity.

---

**[IN-003] 010 Subscriptions Gating Mechanism Defined in Isolation**

- **Severity**: INFO
- **Files**:
    - `specs/010-subscriptions/plan.md:19` — "`@RequirePremium()` decorator + `PlanGuard`"
    - `specs/005-ai-integration/plan.md` — references "premium features" but no code-level gating in 005's plan
    - `specs/006-meal-planning/plan.md` — references "premium features" but no code-level gating in 006's plan
- **Finding**: 010 defines the feature gating mechanism (`@RequirePremium()` decorator) but 005 and 006 only reference premium features textually. If 005/006 implement their own gating before 010's decorator is available, they may invent ad-hoc solutions.
- **Recommendation**: 010's `@RequirePremium()` decorator and `PlanGuard` should be in a shared location (`shared/auth/` or a dedicated `packages/subscription` workspace) so 004, 005, 006, 007, 009 can import and use it during their implementation rather than after 010 is complete.

---

**[IN-004] `CookingSession` Device Storage Not Referenced Outside 008**

- **Severity**: INFO
- **Files**:
    - `specs/008-cooking-mode/plan.md:39-47` — `CookingSession` interface (persisted to device storage)
    - `specs/001-commise-recipe-app/plan.md` — no mention of cooking session state
- **Finding**: 008 plans device-side session storage for cooking mode resume. No other feature references this pattern or uses it for cross-feature state. If another feature (e.g., 007 grocery lists) needed device-side persistence, it would have no shared pattern to follow.
- **Recommendation**: Consider promoting 008's device storage adapters (`packages/shared/src/cooking/`) to a general `packages/shared/src/persistence/` module with web (IndexedDB) and mobile (AsyncStorage) adapters, if other features are likely to need offline device state.

---

## 7. Summary

| Severity    | Count | Primary Root Cause                                                                                                                   |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 CRITICAL | 2     | API prefix fragmentation; missing shared type library                                                                                |
| ⚠️ WARNING  | 6     | Node version mismatch; inter-feature DB ordering; FR namespace gaps; notification ownership; offline strategy; EU AI Act propagation |
| ℹ️ INFO     | 4     | Naming conventions; table name similarity; decorator sharing; device storage pattern                                                 |

**Priority ordering for resolution**:

1. **CR-001** (API prefix) — resolve before any Phase 2 API implementation
2. **CR-002** (shared types) — create `shared/recipe-core` as a first-class task in 001's implementation plan
3. **WA-001** (Node version) — align 002 to 24.x or document justification
4. **WA-003** (FR index) — create a cross-feature FR reference index
5. **WA-004** (notifications) — assign ownership before 003 goes to implementation
6. **WA-005** (offline strategy) — define cross-feature offline architecture before mobile work begins
7. **WA-006** (EU AI Act) — extend compliance scope to 006 and 009

---

## 8. Portfolio-Wide Standards (Resolved 2026-05-09)

Announced by user during sequential revalidation of feature `002-user-auth`. **These are mandatory for all features (001–010) and any future feature.**

### S-001: API URL Pattern (REQUIRED)

**Pattern**: `{protocol}://{host}:{port}/api/:version/*`

- Both `/api` AND `/v{N}` segments are **required**.
- Examples: `/api/v1/recipes`, `/api/v1/auth/callback`, `/api/v1/grocery-lists/{id}`.

**Resolves**: CR-001.

**Affected features and corrections required**:

| Feature | Current state                 | Required correction                                              |
| ------- | ----------------------------- | ---------------------------------------------------------------- |
| 001     | `/api/*` (no version segment) | Add `/v1` → `/api/v1/*` across `spec.md`, `plan.md`, contracts   |
| 002     | `/v1/*` (no `/api` segment)   | Add `/api` → `/api/v1/*` across `spec.md`, `plan.md`, contracts  |
| 003–010 | `/v1/*` (no `/api` segment)   | Same as 002 — to be confirmed during each feature's revalidation |

### S-002: Package Naming (REQUIRED)

**Pattern**: `@kitchensink/{group}-{name}`

- Examples: `@kitchensink/data-usda`, `@kitchensink/shared-recipe-core`, `@kitchensink/auth-client`, `@kitchensink/auth-server`.
- Group examples: `data`, `shared`, `auth`, `ui`, `apps`.

**Resolves**: CR-002 (the missing `shared/recipe-core` library should be `@kitchensink/shared-recipe-core`).

**Affected features**: All. To be confirmed during each feature's revalidation.

### S-003: Node Runtime (REQUIRED)

**Version**: **24.x everywhere**, including AWS Lambda functions.

**Resolves**: WA-001.

**Affected features and corrections required**:

| Feature | Current state         | Required correction                                                           |
| ------- | --------------------- | ----------------------------------------------------------------------------- |
| 002     | Lambda 22.x           | Upgrade Lambda runtime to 24.x in `plan.md`, `tech-stack.md`, CDK definitions |
| Others  | Inherit root `>=24.x` | Verify during each feature's revalidation                                     |

---

## 9. Canonical Persona Library (Resolved 2026-05-09)

User-approved canonical personas for the entire portfolio. **All product-specs MUST source personas from this library — no per-feature one-offs.** Internal/operational roles MUST be moved to a separate `## Internal Stakeholders` section in each spec.

| ID      | Name       | Archetype                | Core Motivation                                                                          |
| ------- | ---------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| **P1**  | **Casey**  | Beginner Cook            | Build confidence, guided cooking, accessible UX                                          |
| **P2**  | **Taylor** | Aspiring Chef            | Technique mastery, fancy/advanced dishes                                                 |
| **P3**  | **Riley**  | Family Meal Planner      | Quick, kid-friendly, weekly rotation, household scale                                    |
| **P4**  | **Sam**    | Nutrition & Diet Planner | Macros, diet protocols, goal tracking                                                    |
| **P5**  | **Morgan** | Discovery Seeker         | New cuisines, inspiration, expanding repertoire                                          |
| **P6**  | **Avery**  | Waste Optimizer          | Use-the-fridge, ingredient chaining, cost reduction                                      |
| **P7**  | **Quinn**  | AI Companion User        | Conversational kitchen brain, hands-free assistance                                      |
| **P8**  | **Alex**   | Commise Power User       | Multi-feature daily power use, integrations, automation                                  |
| **P9**  | **Drew**   | Professional Chef        | Restaurant prep, scaled batches, brand presence                                          |
| **P10** | **Sage**   | Heritage Archivist       | Digitize hard-copy recipes (cards, cookbooks); share with family circle                  |
| **P11** | **Robin**  | Recipe Creator           | Public creator profile (`commise.com/@robin`); food-blogger brand; audience monetization |
| **P12** | **Jamie**  | Cooking Student          | Learn technique from videos (knife skills, food science)                                 |
| **P13** | **Reese**  | Cooking Educator         | Teach via video; build a "school" of subscribers                                         |

**Internal stakeholders** (NOT user personas — for ops/support sections only): Support/Admin Operator, Operations Engineer, External-Agent Integrator, Coach/Trainer (when supporting P4 Sam), Compliance Reviewer.

---

## 10. Standard S-004: Sharing & Audience Model (REQUIRED)

Unified portfolio-level sharing primitive. Replaces the ad-hoc per-feature sharing concepts in 001 (`Recipe Sharer`), 011 (family circles), 012 (public profiles), and 013 (published lessons).

**Audience scopes** (applied to recipes, collections, meal plans, lessons, profiles):

| Scope              | Visibility                                                       | Owner control               | Indexable            |
| ------------------ | ---------------------------------------------------------------- | --------------------------- | -------------------- |
| `private`          | Owner only                                                       | full                        | no                   |
| `circle`           | Members of a named circle (family, friends, team)                | invite/revoke               | no                   |
| `public-profile`   | Anyone with the URL; surfaced on creator's `@handle` page        | full + monetization options | yes                  |
| `published-lesson` | Anyone enrolled (free or paid) in a Cooking School lesson/course | full + price/tier           | yes (course catalog) |

**Required implementation properties**:

- Single `audience` field on shareable entities (`recipe`, `collection`, `lesson`, etc.) with `{ scope, ref_id?, price_cents? }` shape.
- Single `Circle` entity owned by feature 011 but reusable from 001, 006, 007.
- Single `CreatorProfile` entity owned by 012, referenced from 010 (monetization) and 013 (educator profiles).
- Audit logging on every audience change (compliance and trust).

**Affected features**: 001, 004, 006, 007, 010, 011, 012, 013.

---

## 11. New Features 011 / 012 / 013 (Resolved 2026-05-09)

User-approved expansion of the portfolio to cover personas P10–P13. Each is a standalone Product Forge feature with its own bootstrap artifacts.

### 011 — Recipe Digitization & Family Circles

- **Anchored personas**: P10 Sage (primary); P3 Riley, P8 Alex (secondary).
- **Scope**: OCR import from photos of hard-copy recipes (cards, cookbooks, handwriting); structured normalization; `Circle` sharing primitive (private invite-based groups).
- **Boundary vs 004**: 004 owns **structured/web-URL imports** (JSON-LD, schema.org/Recipe, site adapters). 011 owns **unstructured-photo imports** (OCR pipeline, handwriting recognition, manual correction UX) and the `Circle` audience primitive (S-004).
- **Cross-feature owners**: `Circle` entity (used by 001, 006, 007).

### 012 — Public Creator Profiles

- **Anchored personas**: P11 Robin (primary); P5 Morgan (discovery side), P9 Drew (chef brand).
- **Scope**: `@handle` profile pages, follow/unfollow, public collections, embed widgets, basic creator analytics.
- **Cross-feature owners**: `CreatorProfile` entity (referenced by 010 for monetization, 013 for educator profiles).
- **Touches 010**: tip jars, premium recipes, paid follows — extends 010's billing model.

### 013 — Cooking School (Video Learning Platform)

- **Anchored personas**: P12 Jamie (consumer); P13 Reese (creator); P1 Casey, P2 Taylor (overlap consumers); P9 Drew (pro-level content).
- **Scope**: video upload + transcode + CDN delivery, lessons, courses, learner progress tracking, possibly live classes (Phase 2).
- **Two-sided marketplace**: learners + educators. Largest scope of the three new features.
- **Touches 010**: course purchases, educator subscription tiers, revenue share.
- **Touches 005**: AI-assisted lesson script drafting from recipes (`Reese` Should story).

---

## 12. Per-Feature Persona Remap (Resolved 2026-05-09)

Mandatory remap from current per-feature personas to the canonical library (§9). Each row shows the **new** primary/secondary/tertiary persona slot and the **internal stakeholders** to move into a separate section.

| Feature                               | Primary                   | Secondary | Tertiary  | Internal Stakeholders                              |
| ------------------------------------- | ------------------------- | --------- | --------- | -------------------------------------------------- |
| 001 Commise Recipe App                | P8 Alex                   | P3 Riley  | P5 Morgan | Support Operator                                   |
| 002 Clerk User Auth                   | P1 Casey                  | P8 Alex   | P9 Drew   | Support/Admin Operator                             |
| 003 USDA Food Data                    | P4 Sam                    | P6 Avery  | P3 Riley  | Operations Engineer                                |
| 004 Recipe Importing (web/structured) | P5 Morgan                 | P3 Riley  | P11 Robin | —                                                  |
| 005 AI Integration                    | P7 Quinn                  | P1 Casey  | P8 Alex   | External-Agent Integrator                          |
| 006 Meal Planning                     | P3 Riley                  | P4 Sam    | P6 Avery  | —                                                  |
| 007 Grocery Lists                     | P3 Riley                  | P6 Avery  | P8 Alex   | —                                                  |
| 008 Cooking Mode                      | P1 Casey                  | P2 Taylor | P9 Drew   | — (accessibility = P1 trait, not separate persona) |
| 009 Nutrition Planning                | P4 Sam                    | P3 Riley  | P1 Casey  | Coach/Trainer                                      |
| 010 Subscriptions                     | P8 Alex                   | P3 Riley  | P11 Robin | —                                                  |
| **011 Recipe Digitization**           | **P10 Sage**              | P3 Riley  | P8 Alex   | —                                                  |
| **012 Creator Profiles**              | **P11 Robin**             | P5 Morgan | P9 Drew   | —                                                  |
| **013 Cooking School**                | **P12 Jamie / P13 Reese** | P1 Casey  | P2 Taylor | —                                                  |

**Banned in user-facing persona sections**: `Jordan` (was overused as ops placeholder — moved to Internal Stakeholders), unnamed roles (008's "Active Home Cook", "Accessibility-Sensitive Cook" — must be remapped to canonical IDs).
