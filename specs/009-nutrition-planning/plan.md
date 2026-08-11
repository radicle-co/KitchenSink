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

🟠 **OPEN — which service owns `/api/v1/nutrition-plans/*`?** This plan does not say, and it is not derivable
from §15 or any existing ADR. **Question for the owner: `@kitchensink/recipe-service`, or a new
`@kitchensink/nutrition-service`?** The answer picks the schema package name, so nothing below names it. **The
obligation binds whichever service ends up owning the paths.**

**The owning service MUST** author every nutrition-plan, target, link and compliance-report request/response
shape as **zod in that service** at `src/**/*.schema.ts` beside its controller; **validate its own requests
with that same zod** via `nestjs-zod`'s `createZodDto`; generate and commit `packages/schemas/<service>`
exporting the zod, `z.infer` types, `contract-hash.ts`, a barrel and a **derived** `openapi.yaml` (outbound
only — never a codegen input); and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts`
files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the client
half got skipped portfolio-wide:

- Import its wire **types and zod** from that service's schema package, and **declare no nutrition-plan request
  or response body type of its own** — including in `@commise/web`, `@commise/mobile` and feature packages
  (GR-015 §15-b.4).
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
