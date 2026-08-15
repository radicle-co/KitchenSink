# Technical Plan: Feature 009 — Nutrition Planning

**Feature**: `009-nutrition-planning`
**Status**: Draft

---

## 1. Architecture Overview

### System Context

```
User (or trainer) creates Nutrition Plan
    ↓
Define daily macro targets (calories, protein, carbs, fat)
    ↓
Link to Meal Plan (006)
    ↓
System calculates planned nutrition from recipe ingredients (via 003)
    ↓
Compliance tracking: planned vs. targets
    ↓
Trainer → Client visibility (premium via 010)
```

### GDPR Article 9 Compliance

Nutrition data is **special category health data** under GDPR Article 9. Requires:

- Explicit consent for processing
- Data minimization (only necessary fields)
- Right to erasure (user can delete all nutrition data)
- No third-party sharing without explicit consent

---

## 2. Data Model

### Core Tables

```sql
-- Nutrition plan (user's macro targets)
nutrition_plans (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  trainer_id UUID REFERENCES users(id),  -- nullable, set if created by trainer
  name TEXT,
  is_public BOOLEAN DEFAULT false,       -- Client sees plan if shared
  -- Daily targets
  daily_calories INT,
  daily_protein_g INT,
  daily_carbs_g INT,
  daily_fat_g INT,
  -- Optional: percentage-based model (alternative to gram targets)
  protein_pct INT,
  carbs_pct INT,
  fat_pct INT,
  -- Activity level used for calculation
  activity_level TEXT,      -- 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  goal TEXT,               -- 'lose' | 'maintain' | 'gain'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Meal plan → nutrition plan linkage
meal_plan_nutrition_link (
  meal_plan_id UUID REFERENCES meal_plans(id),
  nutrition_plan_id UUID REFERENCES nutrition_plans(id),
  PRIMARY KEY (meal_plan_id, nutrition_plan_id)
)

-- Actual vs planned tracking (per day)
nutrition_compliance (
  id UUID PRIMARY KEY,
  nutrition_plan_id UUID REFERENCES nutrition_plans(id),
  date DATE,
  planned_calories DECIMAL,
  planned_protein_g DECIMAL,
  planned_carbs_g DECIMAL,
  planned_fat_g DECIMAL,
  actual_calories DECIMAL,     -- filled by 006 meal plan actuals
  actual_protein_g DECIMAL,
  actual_carbs_g DECIMAL,
  actual_fat_g DECIMAL,
  compliance_status TEXT,     -- 'on_track' | 'over' | 'under'
  created_at TIMESTAMP
)

-- Trainer-client relationship
trainer_clients (
  trainer_id UUID REFERENCES users(id),
  client_id UUID REFERENCES users(id),
  status TEXT,              -- 'pending' | 'active' | 'revoked'
  created_at TIMESTAMP
)
```

### Macro Calculation Pipeline

```typescript
// TDEE calculation (Mifflin-St Jeor)
interface MacroCalculator {
    calculateBMR(weightKg: number, heightCm: number, age: number, sex: 'M' | 'F'): number;
    calculateTDEE(bmr: number, activityLevel: ActivityLevel): number;
    calculateMacros(tdee: number, goal: 'lose' | 'maintain' | 'gain'): MacroTargets;
    calculateFromRecipe(recipe: Recipe): RecipeMacro; // via 003 USDA data
    calculateFromMealPlan(planId: UUID): MealPlanMacro; // via 006
}

// Example: 80kg male, 175cm, 30yo, moderate activity
// BMR = 10×80 + 6.25×175 - 5×30 + 5 = 1757 cal
// TDEE = 1757 × 1.55 = 2723 cal
// Goal: maintain → 2723 cal/day target
```

---

## 3. API Contracts

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

✅ **RESOLVED (2026-08-12) — BOTH path families, `/api/v1/nutrition-plans/*` AND `/api/v1/trainer/*`, are owned
by `@kitchensink/recipe-service`**, per
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md).
**No new deployable service is created for 009.** ⚠️ The superseded OPEN marker asked only about
`/api/v1/nutrition-plans/*` and left the trainer-client surface unaddressed; both are named here, because a
half-owned feature is how the other half gets invented somewhere else.

| Role                                  | Binding for 009                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)  | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/nutrition-plans/*.schema.ts` |
| Schema package (generated, committed) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, **extended, never forked**               |
| Consuming client                      | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                           |
| Consuming apps                        | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package                |
| NestJS module (internal boundary)     | `NutritionPlansModule`, a sibling of the shipped `RecipesModule` / `SearchModule`                  |
| Nightly compliance rollup             | `@kitchensink/recipe-workers` — asynchronous by design, not in the API process                     |

**The one-line reason, specific to 009**: **006 ↔ 009 are two halves of one calculation** —
`meal_plan_nutrition_link` (§2) is a join table between a **006** table and a **009** table, and the compliance
query reads both — so splitting them would put a transaction boundary through the middle of a single
user-visible number. Every other join this feature has also lands on `recipes` (recipe nutrition is the basis
of compliance), so any boundary that excludes recipes puts the network in the busiest place.

**A schema package is per SERVICE, not per feature.** 009 adds `*.schema.ts` files under
`packages/services/recipe-service/src/nutrition-plans/`, beside the controller they serve, and the **existing**
generator copies them into the **existing** `@kitchensink/schema-recipe` (⚠️ **re-measured 2026-08-12: 10**
authored schema files and a **5,700**-line derived `openapi.yaml`, correcting the "8 authored / 4,945-line" figures
this line carried from 2026-08-11 — the `versions` and `api-error` copies have since landed, and the derived
document is **generated**, so `ls` the directory and `wc -l` the file rather than quoting).
There is **no** `@kitchensink/schema-nutrition`, and neither
`packages/services/nutrition-service` nor `packages/services/nutrition` exists. 004 already set this precedent
for the recipe service — add to `packages/schemas/recipe`, never fork it.

**The NestJS module is the internal boundary, and it is mandatory now even though the service boundary is
not.** `NutritionPlansModule` sits beside `RecipesModule` with its own DAL and its own `*.schema.ts` beside its
controller, and it owns **both** the `/api/v1/nutrition-plans/*` and `/api/v1/trainer/*` controllers. A future
extraction cuts at **that module edge**, and its cost is a new schema package plus a client base-URL change —
which is precisely why the module edge cannot be skipped today. On this feature that is not a formality: 009 is
**the most likely of the four to flip**.

**Flip condition (ADR-0017) — and it is a compliance trigger, not an engineering one**: extract
`@kitchensink/nutrition-service` + `@kitchensink/schema-nutrition` when **a DPIA (or a customer contract)
requires physical isolation of GDPR Article 9 health data**. Until then, Article 9 data lands in the recipe
database, and the two controls that matter regardless of topology are the ones this plan already carries — a
validation error **names the offending field and never echoes the rejected health value**, and the unknown-key
choice is a **data-minimisation control**. That is an **accepted consequence**, recorded in ADR-0017's
_Consequences_, not a defect to work around.

**`@kitchensink/recipe-service` MUST** author every nutrition-plan, target, link, compliance-report and
trainer-client request/response shape as **zod in the service** at `src/nutrition-plans/*.schema.ts` beside its
controller; **validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto`; extend the
committed `@kitchensink/schema-recipe`, which exports the zod, `z.infer` types, `contractHash.ts`, a barrel
and a **derived** `openapi.yaml` (outbound only — never a codegen input); and keep every `*.schema.ts`
importing **only `zod` and other `*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the client
half got skipped portfolio-wide:

- Import its wire **types and zod** from `@kitchensink/schema-recipe`, and **declare no nutrition-plan or
  trainer-client request or response body type of its own** — including in `@commise/web`, `@commise/mobile`
  and feature packages (GR-015 §15-b.4).
- **Derive** any divergent consumer shape with `Pick` / `Omit` / `Partial`. The macro-progress ring model and
  the compliance chart's series model are derivations of the compliance-report wire type, never parallel
  interfaces. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **009 is also a CLIENT of our other services**, bound identically: nutrient data via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`, recipe/meal-plan reads via their own
  schema packages. 009 declares no 001, 003 or 006 wire type.
- **A new endpoint is not complete until its types are reachable from the schema package.**

**Drift gates** — inherited from GR-015 §15-c, all three required: turbo `inputs` rebuild, the
regenerate-and-diff CI gate, and the `CONTRACT_HASH` boot assertion.

⚠️ **This feature's wire shapes carry GDPR Article 9 special-category health data (§1, §4).** That raises the
stakes on the client half specifically: a hand-written client type is a second, unreviewed description of what
health fields cross the wire, and a data-minimization review of the service tells you nothing about it. Keeping
one authored definition is what makes "only necessary fields" auditable in one place. A **redacted** or
trainer-visible projection is a `Pick`/`Omit` **derivation** of the wire type — never a separately declared
shape that could silently regain a field.

**⚠️ Third-party APIs (GR-015 §15-d).** 009 consumes no external API directly today. If one is added (a
wearable, fitness-tracker, or health-platform integration is the obvious candidate), it is the **opposite**
case: we do not serve it, so its client **validates the raw upstream shape at the boundary with zod**, **may
declare its own types**, and **gets no OpenAPI document**. On health data that boundary parse is a privacy
control as well as a correctness one. `packages/clients/usda` is the reference implementation and its
`schemas.ts` must never be "converged".

### 3.0a Input validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. ✅ **§3.0 now names the owner** —
`@kitchensink/recipe-service`, for **both** `/api/v1/nutrition-plans/*` and `/api/v1/trainer/*` (ADR-0017) — so
every obligation below binds a package that exists.

- **One mechanism, one `400`.** Every plan, target, link, compliance-report and trainer-client input — body,
  path params (`{id}`, `{clientId}`), query params — is parsed by `@kitchensink/recipe-service`'s own
  `*.schema.ts` zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. One mechanism per service, one
  `400` path naming the offending field. 009 adds **no** `class-validator` DTO. ⚠️ **Two corrections, 2026-08-12.**
  **(1)** This bullet said 009 must not add one "to the 19 files still being removed from that service"; **there are
  no such files** — the 19 was a **mention** count, the one real importer is converged, and
  `class-validator` / `class-transformer` are **removed from recipe-service's `package.json` and
  `prod.package.json`**. 009 would therefore be **introducing** the second mechanism, not joining a residue.
  **(2)** ✅ It also said "009's own `tasks.md` currently specifies `class-validator` DTOs, which this plan forbids …
  that file needs repointing"; **`tasks.md` has since been repointed** (see its T-0xx "⛔ NOT `class-validator`"
  note), so there is no divergence left to fix. Enforcement is no longer prose either: repo-wide gate **G5** in
  `packages/infra/global/__tests__/serviceSecurityInvariants.test.ts` requires a `ZodValidationPipe` over every
  controller in every deployable, with **no exception list**.
- **⛔ THE FLOOR, and on this feature it doubles as a safety bound.** Every input field writing a bounded
  column is validated at least as strictly as the column can store. Naming 009's actual columns from §2:
  **seven `INT` (`int4`) columns** — `daily_calories`, `daily_protein_g`, `daily_carbs_g`, `daily_fat_g`,
  `protein_pct`, `carbs_pct`, `fat_pct` — carry **no declared bounds** beyond the `int4` ceiling of
  **2,147,483,647**; `activity_level`, `goal`, `compliance_status` and `trainer_clients.status` are
  **enum-by-comment `TEXT`**, so the column enforces nothing and the domain has to be written into the zod;
  and the `nutrition_compliance` planned/actual values are `DECIMAL` with **no declared `(p,s)`**, which must
  be declared before it can be a floor at all. A target the column cannot hold is a `400` at the boundary,
  never a failed `INSERT`.
    - ⚠️ **The `MacroCalculator` inputs have NO declared storage at all.** `weightKg`, `heightCm`, `age` and
      `sex` (§2 _Macro Calculation Pipeline_) are function parameters, not columns, so there is nothing to
      derive a floor from — and they feed a Mifflin-St Jeor calculation whose output becomes a calorie target.
      They are **inputs that need bounds**, authored deliberately in the schema.
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
      `*.schema.ts`. §3.0's import constraint is unchanged by GR-016.
    - ⚠️ **The floor is a floor, and here that matters more than usual.** A `numeric` column will happily store
      a 50,000-calorie daily target; **what is medically implausible is a product decision this feature owns**,
      and it is not derivable from storage. Bounds that exist to protect a user are authored deliberately, in
      the schema, where the client sees them.
    - ✅ **OPEN-GR-016-A is CLOSED (ruled 2026-08-12, GR-017 §17-d):**
      the floor is enforced by a **per-service boundary-parity test**, not a review checklist. It lives in
      `@kitchensink/recipe-service`; it **may import both** the Drizzle schema and the authored zod, because
      **a test is not a wire schema**; it **derives** the bounded-column enumeration from the Drizzle schema
      rather than typing it out; and it asserts the field→column mapping complete **in both directions** —
      every bounded column has an entry or a reasoned exemption, and every entry names a column that exists.
      ⚠️ Its stated limitation matters on this feature: the test proves the floor for the columns it **maps**,
      and only the derived enumeration catches a **new** column. Derive it.
- **⚠️ Unknown-key handling is a DATA-MINIMIZATION control here, not a style choice.** These bodies carry GDPR
  Article 9 special-category health data (§1, §4). `z.object()` **strips unknown keys silently** — which means
  a client sending an extra health field gets a `200` and no record of what it tried to send; `z.strictObject()`
  **rejects** it. Naming the choice per surface is what makes "only necessary fields cross the wire" auditable
  in one place. ✅ **OPEN-GR-016-B is now CLOSED, and it landed the way this feature needed** (ruled 2026-08-12,
  GR-017 §17-c): **`z.strictObject()` is the portfolio default for every mutating request body.** Plain
  `z.object()` is
  permitted only with a **documented forward-compatibility reason at the schema**, which in practice means a
  **read** surface — and on Article 9 data, "we silently accepted a health field we do not model" is exactly
  what a documented exemption would have to justify.
- **Validation errors must not echo health values.** A `400` names the offending **field**, not the rejected
  value, and validation failures are logged without the payload — the same reasoning §4 applies to storage,
  applied to the error path.
- **Non-HTTP ingress**: 009 declares no queue, event or webhook consumer today, and the two named candidates
  are a **nightly compliance-rollup job** (ADR-0017 decision 5 places it in `@kitchensink/recipe-workers`) and a
  **wearable / health-platform ingest**. Each **parses its payload against an authored zod before acting on
  it** — a scheduled invocation included, because "the payload is ours" is an assumption about a deploy that has
  already drifted once. For the wearable ingest the **boundary parse is a privacy control as well as a
  correctness one**: it is what decides which health fields are allowed to exist in our database at all. A
  signed third-party callback gets **signature then schema** (a signature proves origin, not shape), and per
  [GR-018 §18-c](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) a
  signature-verifying sender that retries on any non-2xx is answered **`2xx`** with the rejection recorded in
  the body, the logs, a per-`reason` counter and an alarm. An invalid payload is **never** retried, and — per
  §18-d — **not recorded as a row** either.
- **009 is a CLIENT of our other services**, both directions: outbound bodies validated against
  `@kitchensink/schema-food` (nutrients) and the recipe/meal-plan schema packages before the call; responses
  validated on receipt.
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Note the interaction and do not "fix" it: a redacted or
  trainer-visible projection is enforced by being a `Pick`/`Omit` **derivation** of the wire type (§3.0), not by
  a response-side parse.

### Endpoints

| Method | Path                                      | Auth     | Description                      |
| ------ | ----------------------------------------- | -------- | -------------------------------- |
| GET    | `/api/v1/nutrition-plans`                 | Required | List user's plans (own + shared) |
| POST   | `/api/v1/nutrition-plans`                 | Required | Create nutrition plan            |
| GET    | `/api/v1/nutrition-plans/{id}`            | Required | Get plan with targets            |
| PUT    | `/api/v1/nutrition-plans/{id}`            | Required | Update plan                      |
| DELETE | `/api/v1/nutrition-plans/{id}`            | Required | Delete plan                      |
| POST   | `/api/v1/nutrition-plans/{id}/link`       | Required | Link to meal plan                |
| GET    | `/api/v1/nutrition-plans/{id}/compliance` | Required | Get compliance report            |
| POST   | `/api/v1/nutrition-plans/{id}/share`      | Required | Share with client (premium)      |

### Trainer-Client Endpoints

| Method | Path                                                | Auth     | Description                    |
| ------ | --------------------------------------------------- | -------- | ------------------------------ |
| POST   | `/api/v1/trainer/clients/{clientId}/nutrition-plan` | Required | Create plan for client         |
| GET    | `/api/v1/trainer/clients/{clientId}/compliance`     | Required | View client's compliance       |
| POST   | `/api/v1/trainer/invite`                            | Required | Invite client to link accounts |

### Request/Response Shapes

```typescript
// POST /api/v1/nutrition-plans
Request:
{
  "name": "June Cut Plan",
  "dailyCalories": 2200,
  "dailyProteinG": 165,
  "dailyCarbsG": 220,
  "dailyFatG": 73,
  "activityLevel": "moderate",
  "goal": "lose"
}

Response:
{
  "id": "np_abc",
  "name": "June Cut Plan",
  "dailyTargets": { "calories": 2200, "proteinG": 165, "carbsG": 220, "fatG": 73 },
  "linkedMealPlans": []
}

// GET /api/v1/nutrition-plans/{id}/compliance
Response:
{
  "planId": "np_abc",
  "dateRange": { "start": "2026-06-01", "end": "2026-06-07" },
  "daily": [
    {
      "date": "2026-06-01",
      "planned": { "calories": 2200, "proteinG": 165, "carbsG": 220, "fatG": 73 },
      "actual": { "calories": 2100, "proteinG": 150, "carbsG": 200, "fatG": 65 },
      "status": "under",
      "delta": { "calories": -100, "proteinG": -15 }
    }
  ],
  "summary": {
    "avgCompliance": "92%",
    "proteinAdherence": "88%",
    "bestDay": "2026-06-03",
    "worstDay": "2026-06-01"
  }
}
```

---

## 4. Compliance Tracking

### Calculation Flow

```typescript
// On meal plan entry add (triggered by 006):
function updateCompliance(mealPlanId: UUID, date: Date): void {
    const entries = getMealPlanEntries(mealPlanId, date);
    const nutrition = calculateDayNutrition(entries); // via 003
    upsertNutritionCompliance({
        nutrition_plan_id: linkedPlanId,
        date,
        actual_calories: nutrition.calories,
        actual_protein_g: nutrition.proteinG,
        actual_carbs_g: nutrition.carbsG,
        actual_fat_g: nutrition.fatG,
        compliance_status: calculateStatus(nutrition, targets),
    });
}
```

### Status Indicators

```typescript
enum ComplianceStatus {
    ON_TRACK = 'on_track', // within ±5% of target
    OVER = 'over', // >105% of any macro
    UNDER = 'under', // <95% of any macro
}
```

---

## 5. Trainer-Client Model (Premium via 010)

### Sharing Flow

```typescript
// Trainer creates plan for client
POST /api/v1/trainer/clients/{clientId}/nutrition-plan
  → Creates plan with trainer_id set
  → Sets is_public = false (client must accept)
  → Sends notification to client

// Client accepts
POST /api/v1/nutrition-plans/{id}/accept
  → Links to client's account

// Client views shared plan
GET /api/v1/nutrition-plans?include=shared
  → Returns trainer-created plans visible to client
```

### Privacy

- Trainer can only see client's compliance data for plans they created
- Client can revoke access at any time
- All data subject to GDPR Article 9

---

## 6. Migration / Schema Changes

```sql
-- Migration for 009 nutrition-planning
CREATE TABLE nutrition_plans (...);
CREATE TABLE meal_plan_nutrition_link (...);
CREATE TABLE nutrition_compliance (...);
CREATE TABLE trainer_clients (...);

CREATE INDEX idx_nutrition_plans_user_id ON nutrition_plans(user_id);
CREATE INDEX idx_nutrition_plans_trainer_id ON nutrition_plans(trainer_id);
CREATE INDEX idx_nutrition_compliance_plan_date ON nutrition_compliance(nutrition_plan_id, date);
CREATE INDEX idx_trainer_clients_trainer ON trainer_clients(trainer_id);
CREATE INDEX idx_trainer_clients_client ON trainer_clients(client_id);
```

---

## 7. Open Questions

1. **Activity level granularity**: 5 levels or 3? (Sedentary/Light/Moderate/Active/Very Active vs. Sedentary/Active/Very Active)
2. **Goal presets**: Loss/gain/maintain — use percentage deficit/surplus or fixed values?
3. **Client consent**: How explicit does Article 9 consent need to be? (checkbox at plan creation?)

---

## 8. Implementation Order

1. **CRUD APIs** — nutrition_plans
2. **Macro calculator service** — BMR/TDEE/Macro calculation
3. **Compliance calculation** — aggregate from 006 meal plan entries
4. **GET compliance** — daily + weekly reports
5. **Trainer-client model** — sharing, invites, access control
6. **Frontend dashboard** — progress charts, macro breakdown
7. **AI suggestions (005)** — "swap X for lower-carb alternative" (premium)
