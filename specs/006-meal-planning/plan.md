# Technical Plan: Feature 006 — Meal Planning

**Feature**: `006-meal-planning`
**Status**: Draft

---

## 1. Architecture Overview

### System Context

```
User creates meal plan (1 week, 2 weeks, etc.)
    ↓
Assign recipes to meal slots (breakfast/lunch/dinner/snack)
    ↓
Nutritional summary (pulled from 003 USDA data via 001 recipes)
    ↓
Grocery list generation (triggers 007)
    ↓
AI suggestions (triggers 005 AI integration)
```

### Meal Plan Data Flow

```
MealPlan {
  id, userId, startDate, endDate, name
  → MealPlanEntries[] (recipe + meal slot + day)
  → NutritionalSummary (aggregated from recipe ingredients via 003)
}
```

---

## 2. Data Model

### Core Tables

```sql
-- Meal plan (user's weekly/monthly plan)
meal_plans (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  is_locked BOOLEAN DEFAULT false,   -- Locked = finalized, not editable
  plan_type TEXT                     -- 'weekly' | 'biweekly' | 'custom'
)

-- Individual meal assignments
meal_plan_entries (
  id UUID PRIMARY KEY,
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES recipes(id),
  meal_type TEXT,                   -- 'breakfast' | 'lunch' | 'dinner' | 'snack'
  date DATE,
  servings INT DEFAULT 1,
  notes TEXT,                       -- "omit onions", "extra spicy"
  created_at TIMESTAMP
)

-- Aggregated nutritional totals per meal plan day
meal_plan_nutrition (
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE CASCADE,
  date DATE,
  calories_total DECIMAL,
  protein_g_total DECIMAL,
  carbs_g_total DECIMAL,
  fat_g_total DECIMAL,
  fiber_g_total DECIMAL,
  PRIMARY KEY (meal_plan_id, date)
)
```

---

## 3. API Contracts

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). This section states the
bindings for this feature; the rule lives there and wins on any detail.

✅ **RESOLVED (2026-08-12) — `/api/v1/meal-plans/*` is owned by `@kitchensink/recipe-service`**, per
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md).
**No new deployable service is created for 006.**

| Role                                  | Binding for 006                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)  | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/meal-plans/*.schema.ts` |
| Schema package (generated, committed) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, **extended, never forked**          |
| Consuming client                      | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                      |
| Consuming apps                        | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package           |
| NestJS module (internal boundary)     | `MealPlansModule`, a sibling of the shipped `RecipesModule` / `SearchModule`                  |

**The one-line reason, specific to 006**: every join this feature has is against `recipes`
(`meal_plan_entries.recipe_id`, §2), and in **one** database `ON DELETE CASCADE` deletes 006's
recipe-deletion orphan handler and its `is_orphaned` column outright — so this decision **removes** a task, a
column and a background job rather than adding them. 006 ↔ 009 are additionally **two halves of one
calculation**: 009's `meal_plan_nutrition_link` joins a 006 table to a 009 table.

**A schema package is per SERVICE, not per feature.** 006 adds `*.schema.ts` files under
`packages/services/recipe-service/src/meal-plans/`, beside the controller they serve, and the **existing**
generator copies them into the **existing** `@kitchensink/schema-recipe` (⚠️ **re-measured 2026-08-12: 10**
authored schema files and a **5,700**-line derived `openapi.yaml`, correcting the "8 authored / 4,945-line" figures
this line carried from 2026-08-11 — the `versions` and `api-error` copies have since landed, and the derived
document is **generated**, so `ls` the directory and `wc -l` the file rather than quoting).
There is **no** `@kitchensink/schema-meal-planning`, and 006 does not get
one. 004 already set this precedent for the recipe service — add to `packages/schemas/recipe`, never fork it.

**The NestJS module is the internal boundary, and it is mandatory now even though the service boundary is
not.** `MealPlansModule` sits beside `RecipesModule` with its own DAL and its own `*.schema.ts` beside its
controller. A future extraction cuts at **that module edge**, and its cost is a new schema package plus a
client base-URL change — which is exactly why the module edge cannot be skipped today.

**Flip condition (ADR-0017)**: extract 006 into its own service when meal planning grows a **write volume or
a scaling profile that competes with recipe search** — i.e. when the planner becomes the hot path rather than
a premium side feature.

**`@kitchensink/recipe-service` MUST**:

- Author every meal-plan, entry, nutrition-summary and suggestion request/response shape as **zod in the
  service** at `src/meal-plans/*.schema.ts`, beside the controller it serves.
- **Validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto` — not a separate
  `class-validator` DTO that agrees with the schema by convention. ⚠️ 006 adds **no** `class-validator` DTO to
  the 19 files already being removed from that service (re-measured 2026-08-12).
- Extend the committed `@kitchensink/schema-recipe`, which exports the zod, `z.infer` types,
  `contract-hash.ts`, a barrel, and a **derived** `openapi.yaml` (outbound only — for `oasdiff`, docs and
  integrators, **never a codegen input**).
- Keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the
client half got skipped portfolio-wide (276 + 144 lines of redeclared wire types survived behind green
builds):

- Import its wire **types and zod** from `@kitchensink/schema-recipe`.
- **Declare no meal-plan request or response body type of its own** — not in `packages/clients/*`, and not in
  `@commise/web` / `@commise/mobile` / a feature package either (GR-015 §15-b.4).
- **Derive** any divergent consumer shape with `Pick` / `Omit` / `Partial` over the wire type. The calendar
  grid's per-slot view model is the obvious case here: it is a derivation of the entry wire type, never a
  parallel interface. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **006 is also a CLIENT of other services** and §15-b binds it there identically: nutrition data via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`; recipe reads via
  `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`; AI suggestions via 005 →
  `@kitchensink/schema-ai`. **006 declares no wire type belonging to 001, 003, 005 or 007.**
- **A new endpoint is not complete until its types are reachable from the schema package.** "The calendar UI
  will add the type" is a contract fork, not a task.

**Drift gates** — inherited from GR-015 §15-c, all three required, not reinvented per feature: turbo
`inputs`-driven rebuild, a **regenerate-and-diff CI gate** (the strong gate), and a `CONTRACT_HASH` **boot
assertion** (the only layer that catches a deployed service running ahead of a released mobile binary).

**⚠️ Third-party APIs (GR-015 §15-d).** 006 consumes no external API directly today. If one is added, it is
the **opposite** case: we do not serve it, so its client **validates the raw upstream shape at the boundary
with zod**, **may declare its own types**, and **gets no OpenAPI document**. `packages/clients/usda` is the
reference implementation and its `schemas.ts` must never be "converged".

> ✅ **Paths below are FIXED (2026-08-12).** Adopting `@kitchensink/recipe-service` means adopting its prefix,
> so every path in this plan moved from bare `/v1/meal-plans/*` to canonical **`/api/v1/meal-plans/*`**. That
> closes the GR-002 holdout this plan previously flagged (GR-002 Current State recorded 006 as the last one).
> The shipped recipe-service controllers additionally answer the bare `/v1/*` form as a **deprecated alias**,
> for URLs external consumers already hold ([ADR-0011](../../docs/architecture/decisions/0011-api-version-prefix.md)) —
> 006's paths are new, so they get **no** alias.

### 3.0a Input validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. ✅ **§3.0 now names the owner** —
`@kitchensink/recipe-service` (ADR-0017) — so every obligation below binds a package that exists.

- **One mechanism, one `400`.** Every meal-plan, entry, nutrition-summary and suggestion input — body, path
  params (`{id}`, `{entryId}`), query params — is parsed by `@kitchensink/recipe-service`'s own `*.schema.ts`
  zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. 006 adds **no** `class-validator` DTO to the
  19 files already being removed there (re-measured 2026-08-12: 18 `ZodValidationPipe`, 26 `createZodDto`, 19
  `class-validator` files — two mechanisms in one service, mid-convergence).
- **⛔ THE FLOOR — 006's own bodies reach it.** `POST /api/v1/meal-plans/{id}/entries` carries **`servings`**,
  which is one of the five int-backed fields measured with **no upper bound** against an `integer` (`int4`)
  column capped at **2,147,483,647**. Every input field writing a bounded column is validated at least as
  strictly as the column can store — `servings`, entry counts, `mealType` / `planType` enums, nullability,
  and the `startDate` / `endDate` / `date` values (ISO-8601 strings per CODING_STANDARDS, so a **format and a
  plausible range**, not just "a string").
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
      `*.schema.ts`. §3.0's import constraint is unchanged by GR-016.
    - ⚠️ **The floor is a floor.** A `meal_plans.name` writing an unbounded `text()` column has **no storage
      bound to derive from**, so its length limit is a product decision 006 owns.
    - ✅ **OPEN-GR-016-A is CLOSED (ruled 2026-08-12, GR-017 §17-d):**
      the floor is enforced by a **per-service boundary-parity test**, not a review checklist. It lives in
      `@kitchensink/recipe-service` (beside `recipes/dto/__tests__/numeric-bounds.dto.test.ts`, the existing
      example); it **may import both** the Drizzle schema and the authored zod, because **a test is not a wire
      schema**; it **derives** the bounded-column enumeration from the Drizzle schema rather than typing it
      out; and it asserts the field→column mapping complete **in both directions** — every bounded column has
      an entry or a reasoned exemption, and every entry names a column that exists. Without the second
      direction the test silently shrinks to the fields someone remembered and stays green.
- **Range inputs are inputs.** A plan window (`startDate`/`endDate`) and any calendar range query bound the
  work the request can ask for: a reversed or absurd range is rejected at the boundary rather than becoming a
  query that scans a year of entries. Cross-field rules like `endDate >= startDate` live **in the schema**
  (a zod refinement), so the client sees the same rule the server enforces.
- **Non-HTTP ingress — 006 is a queue PRODUCER, not a consumer.** §7 _Resilience_ specifies an **async SQS
  pattern for the outbound 005 AI call**; that is 006 **publishing** a message, which GR-016 §16-c.2 governs
  (the outbound body is validated against the callee's schema-package zod **before** the send), not §16-b.
  006 declares **no queue, event or webhook CONSUMER** today. ⚠️ The two claims previously stood side by side
  in this plan and read as a contradiction; they are not one — the direction is what differs. **If 006 ever
  consumes** (an AI-suggestion **reply** off a queue, or a plan-rollover job — both plausible), that handler
  **parses its payload against an authored zod before acting on it**, because a pipe reaches neither, and an
  invalid payload is rejected once and **never redriven**
  ([GR-018](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) §18-b).
- **006 is a CLIENT of several services**, and GR-016 §16-c binds both directions: outbound bodies validated
  against the callee's schema-package zod **before the call** — nutrition via `@kitchensink/schema-food`,
  recipe reads via `@kitchensink/schema-recipe`, AI suggestions via `@kitchensink/schema-ai` — and each
  **response validated on receipt**.
- ✅ **Unknown keys — OPEN-GR-016-B is CLOSED (ruled 2026-08-12, GR-017 §17-c):**
  **`z.strictObject()` is the portfolio default for every mutating request body**, so 006's `POST`/`PUT`/`DELETE`
  bodies reject unknown keys. Plain `z.object()` is permitted only with a **documented forward-compatibility
  reason at the schema**, which in practice means a **read** surface (a calendar-range query string an older
  service may receive from a newer client). `PUT /api/v1/meal-plans/{id}` is the case the ruling protects: a
  silently stripped key returns `200` for an edit that did not happen, and silence is the worse failure.
- **No request-derived value reaches `sql.raw()`**; a request-selected sort or grouping maps through a
  validated enum to a closed allowlist of literals in code.
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Do not plan or task server-side response parsing.

### Endpoints

| Method | Path                                          | Auth     | Description                           |
| ------ | --------------------------------------------- | -------- | ------------------------------------- |
| GET    | `/api/v1/meal-plans`                          | Required | List user's meal plans                |
| POST   | `/api/v1/meal-plans`                          | Required | Create new meal plan                  |
| GET    | `/api/v1/meal-plans/{id}`                     | Required | Get meal plan with entries            |
| PUT    | `/api/v1/meal-plans/{id}`                     | Required | Update meal plan (add/remove entries) |
| DELETE | `/api/v1/meal-plans/{id}`                     | Required | Delete meal plan                      |
| POST   | `/api/v1/meal-plans/{id}/entries`             | Required | Add recipe to meal plan               |
| DELETE | `/api/v1/meal-plans/{id}/entries/{entryId}`   | Required | Remove entry                          |
| GET    | `/api/v1/meal-plans/{id}/nutrition`           | Required | Get aggregated nutrition summary      |
| POST   | `/api/v1/meal-plans/{id}/recipes/suggestions` | Required | Get AI suggestions (005)              |

### Request/Response Shapes

```typescript
// POST /api/v1/meal-plans
Request:
{
  "name": "Week of May 12",
  "startDate": "2026-05-12",
  "endDate": "2026-05-18",
  "planType": "weekly"
}

Response: MealPlan with id, entries: [], nutrition summary empty

// POST /api/v1/meal-plans/{id}/entries
Request:
{
  "recipeId": "rec_abc123",
  "date": "2026-05-12",
  "mealType": "dinner",
  "servings": 2
}

// GET /api/v1/meal-plans/{id}/nutrition
Response:
{
  "planId": "mp_xyz",
  "dateRange": { "start": "2026-05-12", "end": "2026-05-18" },
  "dailyNutrition": [
    {
      "date": "2026-05-12",
      "meals": [
        { "mealType": "breakfast", "recipeId": "...", "calories": 450, "proteinG": 25, "carbsG": 40, "fatG": 15 },
        { "mealType": "lunch", "recipeId": "...", "calories": 620, "proteinG": 35, "carbsG": 55, "fatG": 20 }
      ],
      "totals": { "calories": 1070, "proteinG": 60, "carbsG": 95, "fatG": 35 }
    }
  ],
  "weekTotals": { "calories": 15400, "proteinG": 420, "carbsG": 1890, "fatG": 490 }
}
```

---

## 4. Drag-and-Drop UX (Frontend)

### Component Architecture

```
<MealPlanCalendar>
  ├── <WeekStrip> (Mon-Sun columns)
  │   ├── <DayColumn>
  │   │   ├── <BreakfastSlot> ← drag target
  │   │   ├── <LunchSlot> ← drag target
  │   │   ├── <DinnerSlot> ← drag target
  │   │   └── <SnackSlot> ← drag target
  │   └── ...
  ├── <RecipeSidebar> (draggable recipe cards)
  └── <NutritionSummary> (sticky footer)
```

### Drag Library

Use `@dnd-kit/core` + `@dnd-kit/sortable` — best React accessibility support, works with touch and mouse.

---

## 5. Integration with 003 (USDA) and 007 (Grocery)

### Nutritional Rollup

```typescript
// When recipe is added to meal plan:
// 1. Fetch recipe ingredients (001)
// 2. For each ingredient with usda_fdc_id → fetch nutrients (003)
// 3. Sum per day → meal_plan_nutrition table

interface NutritionCalculator {
    calculateDayNutrition(entries: MealPlanEntry[]): DayNutrition;
    calculateWeekNutrition(planId: UUID): WeekNutrition;
    triggerOnEntryAdd(entry: MealPlanEntry): void;
}
```

### Grocery List Generation (triggers 007)

```typescript
// POST /api/v1/meal-plans/{id}/grocery-list
// → fetches all entries for the plan
// → aggregates ingredients across recipes (dedup via 007)
// → returns grocery list manifest (leaves actual 007 creation to user)
```

---

## 6. AI Integration (via 005)

### Meal Suggestion Flow

```typescript
// POST /api/v1/meal-plans/{id}/recipes/suggestions
// → calls 005 AI service
// → passes: user preferences, dietary restrictions, existing recipes, target macros

interface MealSuggestionRequest {
    planId: UUID;
    targetDate: Date;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    preferences: UserPreferences; // from user profile
    macroTargets?: MacroTargets; // optional override
}

// Response: suggested recipes ranked by match score
```

---

## 7. Resilience & External Services

- **003 USDA API**: Cache-aside for ingredient nutrients, TTL 1h
- **005 AI API**: Async SQS pattern, 60s timeout, retry with exponential backoff
- **Recipe availability**: If recipe is deleted, mark entry as `orphaned` — don't cascade delete entry

---

## 8. Migration / Schema Changes

```sql
-- Migration for 006 meal-planning
CREATE TABLE meal_plans (...);
CREATE TABLE meal_plan_entries (...);
CREATE TABLE meal_plan_nutrition (...);

CREATE INDEX idx_meal_plans_user_id ON meal_plans(user_id);
CREATE INDEX idx_meal_plans_dates ON meal_plans(start_date, end_date);
CREATE INDEX idx_meal_plan_entries_plan_id ON meal_plan_entries(meal_plan_id);
CREATE INDEX idx_meal_plan_entries_date ON meal_plan_entries(date);
CREATE INDEX idx_meal_plan_nutrition_plan_date ON meal_plan_nutrition(meal_plan_id, date);
```

---

## 9. Open Questions

1. **Meal plan templates**: Should users save/reuse custom templates?
2. **Recipe scaling**: If I assign 2 servings for dinner but my plan is for 1 person, does grocery list scale automatically?
3. **Lock mechanism**: What does "locked" mean in practice? Prevents editing? Just signals finalization for grocery ordering?

---

## 10. Implementation Order

1. **CRUD APIs** — meal_plans, meal_plan_entries
2. **GET nutrition** — aggregation from recipe ingredients via 003
3. **Frontend calendar** — drag-and-drop @dnd-kit
4. **Grocery list generation** — aggregate + hand off to 007
5. **AI suggestions** — integrate via 005
6. **Lock/finalize flow** — prevent edits after grocery generation
