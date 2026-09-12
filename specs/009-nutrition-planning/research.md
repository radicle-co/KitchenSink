# Research: Feature 009 — Nutrition Planning

**Branch**: `009-nutrition-planning` | **Date**: 2026-05-08
**Spec**: [spec.md](./spec.md) | **Status**: Complete

## Research Questions

| #    | Question                                                                      | Status      |
| ---- | ----------------------------------------------------------------------------- | ----------- |
| RQ-1 | How do MyFitnessPal, Cronometer, and Nutrition.gov handle macro targets?      | ✅ Answered |
| RQ-2 | Trainer-client monitoring patterns (Trainerize, PT Distinction)               | ✅ Answered |
| RQ-3 | GDPR Article 9 (special category: health data) compliance requirements        | ✅ Answered |
| RQ-4 | Macro calculation formulas: BMR, TDEE, activity multipliers                   | ✅ Answered |
| RQ-5 | How does 009 consume from 001 (recipes), 003 (USDA), and 006 (meal planning)? | ✅ Answered |
| RQ-6 | Nutrition calculation pipeline: USDA nutrients → aggregated per meal plan     | ✅ Answered |
| RQ-7 | Data model for targets vs. actuals tracking                                   | ✅ Answered |
| RQ-8 | Progress tracking visualization patterns                                      | ✅ Answered |

---

## RQ-1: Competitor Analysis — Macro Target Approaches

### MyFitnessPal

MyFitnessPal uses a **percentage-based macro model** in its free tier: users set protein/carbs/fat as percentages that must sum to 100%. Precise gram-based targets require a Premium subscription. The app auto-calculates a calorie goal from user profile data (age, weight, height, activity level, goal) and then derives macro gram targets from the percentages × calorie goal.

**Key UX patterns:**

- Calorie goal is the primary anchor; macros are derived from it
- Free tier: macro percentages only (e.g., 30% protein, 40% carbs, 30% fat)
- Premium tier: fixed gram targets per macro
- Exercise logging adjusts the daily calorie allowance ("eating back exercise calories")
- Food database: 11M+ entries, largely user-generated and unverified

**API data structures** (from the MFP developer API):

```
GoalPreferences {
  daily_step_goal: Integer
  daily_energy_goal: MeasuredValue  // calories
  // macro targets derived from energy × ratios
}
```

Source: [MFP API Appendix — Goal Preferences](https://myfitnesspalapi.com/docs/appendix-data-structures-goal-preferences/)

### Cronometer

Cronometer is the most sophisticated macro target system among consumer apps. It offers **three distinct target modes**:

| Mode                | Description                                                                | Best For                                         |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| **Macro Ratios**    | Targets are percentages of energy goal; auto-updates when energy changes   | Dynamic goals (exercise logging, weight changes) |
| **Fixed Targets**   | Absolute gram amounts per macro; static daily                              | Bodybuilding, precise clinical targets           |
| **Keto Calculator** | Dynamic: max protein from lean body mass, max carbs fixed, fat = remainder | Ketogenic diets                                  |

**Carbohydrate tracking options**: Total carbs vs. Net carbs (Total − Fiber − Sugar Alcohols). Net carbs formula: `net_carbs = total_carbs - fiber - sugar_alcohols`.

**Weekly macro scheduling**: Cronometer supports assigning different macro templates to different days of the week (e.g., higher carbs on training days). This is exposed via their internal API as `set_weekly_macro_schedule`.

**Data accuracy**: Cronometer uses a tiered trust model — USDA SR Legacy / Foundation as highest trust, Branded Foods for packaged goods, community entries lowest. This aligns directly with 003's data strategy.

Source: [Cronometer — Edit Macronutrient Targets](https://support.cronometer.com/hc/en-us/articles/360060119292-Edit-Macronutrient-Targets) (2026-05-07)

### Nutrition.gov / USDA Approach

Nutrition.gov (USDA) does not offer a tracking app but publishes the **Dietary Reference Intakes (DRI)** which are the scientific basis for default macro targets:

| Macro         | AMDR (% of calories) | Notes                            |
| ------------- | -------------------- | -------------------------------- |
| Protein       | 10–35%               | RDA: 0.8g/kg body weight minimum |
| Carbohydrates | 45–65%               | RDA: 130g/day minimum            |
| Fat           | 20–35%               | No RDA; AMDR only                |

Source: Institute of Medicine, _Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids_, National Academies Press, 2005.

**Key insight for 009**: Default macro targets should be seeded from AMDR percentages applied to the user's TDEE. Users can then override with fixed gram targets (Cronometer's "Fixed Targets" mode) or keep ratio-based targets (Cronometer's "Macro Ratios" mode). Both modes should be supported.

---

## RQ-2: Trainer-Client Monitoring Patterns

### Trainerize (ABC Trainerize)

Trainerize is the market leader for trainer-client nutrition coaching software. Its architecture reveals the canonical patterns for this domain:

**Compliance scoring model:**

- Automated compliance scoring: clients tagged as **High (80%+)**, **Moderate**, or **Low** adherence
- Weekly dashboard: filter clients by compliance score, message specific groups
- Compliance is calculated as: `(meals_logged / meals_planned) × 100`

**Data flow:**

```
Trainer sets macro targets → Client logs meals (in-app or MFP sync)
→ Trainerize aggregates daily totals → Trainer sees compliance dashboard
```

**MyFitnessPal integration**: Clients log in MFP; Trainerize pulls calories, macros, and meal details via MFP's API. Trainer sees real-time data without requiring clients to change their existing workflow.

**Smart Meal Planner**: Trainer inputs macro targets + dietary preferences → system generates 3–7 day meal plan in ~2 minutes. This is the AI-assisted planning pattern we should consider for 009's premium tier.

Source: [Trainerize — Nutrition Coaching](https://www.trainerize.com/nutrition-coaching/) (2026)

### PT Distinction

PT Distinction differentiates on **coaching depth** rather than automation:

**Nutrition tracking options for clients** (multiple modalities):

1. In-app food tracking (calorie counter)
2. MyFitnessPal integration (full macro/micro sync)
3. Written/photo food diary
4. Simple adherence chart (binary: followed plan / didn't)

**Trainer monitoring:**

- Live activity feeds: real-time view of what clients have/haven't done
- Weekly progress reports: automated summaries of fitness + nutrition compliance
- Adherence charting: visual timeline of plan adherence per client

**Key differentiator**: PT Distinction pulls MFP data including **micronutrients**, not just macros. This is relevant for 009's potential future expansion.

Source: [PT Distinction — Features](https://www.ptdistinction.com/features) (2026)

### Patterns to Adopt for 009

| Pattern               | Trainerize              | PT Distinction            | 009 Recommendation                                  |
| --------------------- | ----------------------- | ------------------------- | --------------------------------------------------- |
| Compliance scoring    | 80%+ = High             | Adherence chart           | Implement % compliance with High/Moderate/Low tiers |
| Client data entry     | In-app + MFP            | In-app + MFP + photo      | In-app (meal plan entries from 006)                 |
| Trainer dashboard     | Per-client + aggregate  | Live feed + weekly report | Weekly summary + per-client drill-down              |
| Macro target setting  | Trainer sets for client | Trainer sets for client   | Trainer creates plan, assigns to client             |
| Notification triggers | Automated reminders     | Scheduled messaging       | Out of scope for MVP; flag for 010                  |

---

## RQ-3: GDPR Article 9 — Health Data Compliance

### Classification

Nutrition tracking data **is health data** under GDPR Article 9. The ICO and EDPB guidance is explicit: "fitness tracker data revealing health conditions" and dietary information tied to health goals falls under the special category definition.

This means 009 must comply with **both**:

1. **Article 6** — a lawful basis for processing (most likely: explicit consent, or legitimate interests)
2. **Article 9(2)** — a specific condition for processing special category data

### Applicable Article 9(2) Conditions

For a nutrition planning app, the most applicable conditions are:

| Condition                       | Article | Applicability to 009                                                                                   |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| **Explicit consent**            | 9(2)(a) | ✅ Primary basis — user explicitly opts in to nutrition tracking                                       |
| **Health or social care**       | 9(2)(h) | ⚠️ Only if delivered by health professionals under professional secrecy obligations — unlikely for 009 |
| **Made public by data subject** | 9(2)(e) | ❌ Not applicable                                                                                      |

**Recommendation**: Rely on **explicit consent (Article 9(2)(a))** as the primary basis. This requires:

- Separate, granular consent request specifically for health/nutrition data (not bundled with general T&C)
- Clear explanation of what data is processed and why
- Easy withdrawal mechanism

Source: [ICO — Special Category Data](https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/lawful-basis-for-processing/special-category-data/) | [PrivacyForge — Special Categories Guide](https://www.privacyforge.ai/blog/special-categories-of-data-under-gdpr-complete-compliance-guide-2025) (2026-01-13)

### Required Technical Safeguards

| Requirement                     | Implementation for 009                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Data minimisation**           | Only collect macros/calories needed for targets; don't store raw food diary unless user explicitly enables it |
| **Purpose limitation**          | Nutrition data used only for compliance tracking; not for ads, profiling, or third-party sharing              |
| **Pseudonymisation**            | Trainer-client: trainer sees client data by user ID / display name, not PII in API responses                  |
| **Encryption at rest**          | RDS encryption enabled (already standard in AWS RDS); S3 server-side encryption for any exports               |
| **Encryption in transit**       | TLS 1.2+ enforced (standard NestJS + AWS ALB config)                                                          |
| **Access controls**             | Row-level security: clients can only read their own data; trainers can only read their assigned clients' data |
| **DPIA**                        | Required — nutrition data processed at scale, used to determine access to coaching services                   |
| **Retention policy**            | Define and document; recommend: active data retained while account active + 90 days post-deletion             |
| **Appropriate Policy Document** | Required under UK DPA 2018 Schedule 1 if relying on any condition other than explicit consent                 |

### Trainer-Client Data Sharing

When a trainer accesses a client's nutrition data, this is a **data controller → data processor** relationship (or joint controller, depending on structure). The Data Processing Agreement (DPA) between the platform and trainer must:

- Identify the special category data being shared
- Specify the Article 9(2)(a) consent basis
- Prohibit the trainer from using client data outside the coaching relationship
- Require the trainer to assist with breach notifications

Source: [GDPR Article 9 — Legislation.gov.uk](https://www.legislation.gov.uk/eur/2016/679/article/9?view=plain)

---

## RQ-4: Macro Calculation Formulas

### BMR (Basal Metabolic Rate)

Three validated formulas, in order of recommendation:

**1. Mifflin-St Jeor (1990) — Recommended Default**

```
Males:   BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) + 5
Females: BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) − 161
```

- Accuracy: within ±10% for 82% of adults (Frankenfield et al., 2003)
- Validated by American Dietetic Association 2005 systematic review as most accurate for general populations
- Does not require body fat % — suitable for onboarding

**2. Harris-Benedict Revised (1984) — Legacy/Clinical**

```
Males:   BMR = 88.362 + (13.397 × weight_kg) + (4.799 × height_cm) − (5.677 × age)
Females: BMR = 447.593 + (9.247 × weight_kg) + (3.098 × height_cm) − (4.330 × age)
```

- Accuracy: ±10–15%; tends to overestimate by ~5%
- Use for: compatibility with older clinical records

**3. Katch-McArdle (1996) — Best Accuracy with Body Fat %**

```
BMR = 370 + (21.6 × LBM_kg)
where LBM = total_weight_kg × (1 − body_fat_fraction)
```

- Accuracy: ±5–8%
- Use for: users who provide body fat % (e.g., from fitness tracker integration)

Source: [Calorique — Methodology](https://calorique.io/methodology/) (2026-03-07) | [TDEEcal — Formulas Compared](https://tdeecal.net/tdee/tdee-formulas-compared/) (2026-03-02)

### TDEE (Total Daily Energy Expenditure)

```
TDEE = BMR × Activity_Multiplier
```

**Standard Activity Multipliers** (National Academy of Sciences DRI, 2005):

| Activity Level    | Multiplier | Description                        |
| ----------------- | ---------- | ---------------------------------- |
| Sedentary         | 1.2        | Little/no exercise, desk job       |
| Lightly Active    | 1.375      | Light exercise 1–3 days/week       |
| Moderately Active | 1.55       | Moderate exercise 3–5 days/week    |
| Very Active       | 1.725      | Hard exercise 6–7 days/week        |
| Extra Active      | 1.9        | Physical job + hard exercise daily |

**Important caveat**: TDEE is an estimate with ±200 kcal standard error. The system should present it as a starting point, not a precise prescription. Trainerize and Cronometer both allow manual override of the calculated TDEE.

### Macro Targets from TDEE

Once TDEE is established, macro gram targets are derived:

```typescript
// Ratio-based (Cronometer "Macro Ratios" mode)
function macrosFromRatios(tdee: number, proteinPct: number, carbsPct: number, fatPct: number) {
    return {
        protein_g: (tdee * proteinPct) / 4, // 4 kcal/g
        carbs_g: (tdee * carbsPct) / 4, // 4 kcal/g
        fat_g: (tdee * fatPct) / 9, // 9 kcal/g
    };
}

// Fixed targets (Cronometer "Fixed Targets" mode)
// User directly inputs gram amounts; calories derived:
function caloriesFromMacros(protein_g: number, carbs_g: number, fat_g: number) {
    return protein_g * 4 + carbs_g * 4 + fat_g * 9;
}
```

**Caloric constants**: Protein = 4 kcal/g, Carbohydrates = 4 kcal/g, Fat = 9 kcal/g. These are the Atwater general factors, universally used.

---

## RQ-5: Integration with 001, 003, and 006

### Dependency Map

```
003 (USDA Food Data)
  └── provides: nutrient profiles per ingredient (calories, protein_g, carbs_g, fat_g per 100g)
        ↓
001 (Recipes)
  └── consumes: ingredient nutrient profiles
  └── provides: recipe-level nutrition totals (via recipe_ingredients × usda_nutrients)
        ↓
006 (Meal Planning)
  └── consumes: recipe nutrition totals
  └── provides: meal_plan_entries with nutrition_snapshot JSONB
  └── provides: daily/weekly nutritional rollup queries
        ↓
009 (Nutrition Planning)  ← THIS FEATURE
  └── consumes: meal_plan daily totals from 006
  └── provides: nutrition_plans with macro targets
  └── provides: compliance analysis (targets vs. actuals)
  └── provides: trainer-client monitoring
```

### What 009 Reads from 006

From 006's `meal_plan_entries` table, 009 needs the daily nutritional rollup:

```sql
-- 009 reads this view/query from 006's schema
SELECT
    plan_date,
    SUM((nutrition_snapshot->>'calories')::NUMERIC * servings) AS actual_calories,
    SUM((nutrition_snapshot->>'protein_g')::NUMERIC * servings) AS actual_protein_g,
    SUM((nutrition_snapshot->>'carbs_g')::NUMERIC * servings)  AS actual_carbs_g,
    SUM((nutrition_snapshot->>'fat_g')::NUMERIC * servings)    AS actual_fat_g
FROM meal_plan_entries
WHERE meal_plan_id = $1
GROUP BY plan_date;
```

This is already designed in 006's research (RQ-7, Strategy 1). The `nutrition_snapshot` JSONB on each entry is the integration point — 009 does not need to re-join through recipes and ingredients.

### What 009 Reads from 001

009 does not directly query 001's recipe tables. The nutrition data flows through 006's `nutrition_snapshot` denormalization. However, 009 may need to call 001's recipe service for **recipe swap suggestions** (premium feature): given a macro gap, find recipes that would fill it.

### What 009 Reads from 003

009 does not directly query 003's USDA tables. The USDA data is already aggregated into recipe-level nutrition by 001, and then into meal-plan-level snapshots by 006. 009 operates at the plan/day level, not the ingredient level.

---

## RQ-6: Nutrition Calculation Pipeline

### Pipeline Overview

```
[User Profile] → BMR calculation → TDEE calculation → Macro targets
                                                            ↓
[Meal Plan (006)] → daily nutritional rollup → Actuals
                                                            ↓
                                          [009 Compliance Engine]
                                          targets vs. actuals → gaps/excesses
```

### Compliance Calculation

```typescript
interface DailyCompliance {
    plan_date: Date;
    targets: MacroTargets;
    actuals: MacroActuals;
    compliance: {
        calories_pct: number; // actuals.calories / targets.calories × 100
        protein_pct: number;
        carbs_pct: number;
        fat_pct: number;
        overall_score: number; // weighted average or min of the four
    };
    status: 'on_track' | 'under' | 'over' | 'no_data';
}
```

**Compliance thresholds** (based on Trainerize's 80% model):

- **On track**: 90–110% of target for all macros
- **Under**: < 90% of target for calories or any macro
- **Over**: > 110% of target for calories or any macro
- **No data**: no meal plan entries for that date

### Snapshot Staleness

009 inherits the staleness problem from 006: if a recipe's USDA data is updated (via 003's SQS pipeline), the `nutrition_snapshot` on `meal_plan_entries` becomes stale, which means 009's compliance calculations will be wrong.

**Mitigation**: 009 should display a "last calculated" timestamp on compliance summaries. The SQS-triggered refresh pipeline from 006 (RQ-7, Strategy 3) handles the underlying data; 009 just needs to re-run its compliance aggregation after snapshots are refreshed.

---

## RQ-7: Data Model for Targets vs. Actuals

### Proposed Schema

⛔ **No foreign key leaves `kitchensink_recipes`** _(corrected 2026-08-16)_. 009 lives in
`@kitchensink/recipe-service` (ADR-0017), so FKs among its own tables and 001's are real. `users` is the
identity database and `meal_plans` moved to `kitchensink_meal_plans` when 006 was extracted on 2026-08-14;
Postgres enforces neither, so this block previously declared six unenforceable constraints. The app-user
identifier is also a **ULID** stored as `VARCHAR(255)`, not a `UUID` — dropping the FK without fixing the type
would leave a second, silent incompatibility. Same rule as 006's **C-006-002** / **REQ-CN-003**.

```sql
-- Nutrition plan: the container for macro targets
CREATE TABLE nutrition_plans (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            VARCHAR(255) NOT NULL,  -- app-user ULID from the token claim; NO FK (identity database)
    -- Trainer-client: if set, this plan was created by a trainer for a client
    created_by_id       VARCHAR(255),           -- NULL = self-created; app-user ULID, NO FK
    title               TEXT        NOT NULL,
    description         TEXT,
    -- Target mode: 'ratio' (% of calories) or 'fixed' (absolute grams)
    target_mode         TEXT        NOT NULL DEFAULT 'ratio'
                        CHECK (target_mode IN ('ratio', 'fixed')),
    -- Calorie target (always stored in kcal)
    target_calories     NUMERIC(7,1) NOT NULL,
    -- Macro targets: stored as grams (computed from ratios at save time if mode='ratio')
    target_protein_g    NUMERIC(6,1) NOT NULL,
    target_carbs_g      NUMERIC(6,1) NOT NULL,
    target_fat_g        NUMERIC(6,1) NOT NULL,
    -- Optional: ratios stored for display/recalculation when calorie target changes
    ratio_protein_pct   NUMERIC(5,2),  -- e.g., 30.00 = 30%
    ratio_carbs_pct     NUMERIC(5,2),
    ratio_fat_pct       NUMERIC(5,2),
    -- BMR/TDEE inputs (stored for audit/recalculation)
    bmr_formula         TEXT        CHECK (bmr_formula IN ('mifflin_st_jeor', 'harris_benedict', 'katch_mcardle')),
    activity_level      TEXT        CHECK (activity_level IN ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active')),
    calculated_bmr      NUMERIC(7,1),
    calculated_tdee     NUMERIC(7,1),
    -- Date range this plan applies to
    start_date          DATE        NOT NULL,
    end_date            DATE,       -- NULL = ongoing
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'template')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nutrition_plans_owner_id ON nutrition_plans (owner_id);
CREATE INDEX idx_nutrition_plans_created_by ON nutrition_plans (created_by_id) WHERE created_by_id IS NOT NULL;

-- Links a nutrition plan to one or more meal plans (from 006)
-- A nutrition plan can span multiple meal plans (e.g., weekly meal plans within a monthly nutrition plan)
CREATE TABLE nutrition_plan_meal_plans (
    nutrition_plan_id   UUID        NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,  -- local
    meal_plan_id        UUID        NOT NULL,  -- 006 owns it in kitchensink_meal_plans — NO FK, NO cascade
    PRIMARY KEY (nutrition_plan_id, meal_plan_id)
);
-- ⚠️ The lost `ON DELETE CASCADE` is a real behaviour change, not a cosmetic one: deleting a meal plan can no
-- longer clean this table up. A link row whose `meal_plan_id` no longer resolves is handled at READ time —
-- rendered unavailable and excluded from compliance — mirroring how 006 handles an unreadable recipe
-- (C-006-006). No stored flag, no sweeper, because either would need a cross-service deletion notification
-- that deliberately does not exist.

-- Trainer-client relationship
CREATE TABLE trainer_client_relationships (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id          VARCHAR(255) NOT NULL,  -- app-user ULID; NO FK (identity database)
    client_id           VARCHAR(255) NOT NULL,  -- app-user ULID; NO FK (identity database)
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('pending', 'active', 'paused', 'terminated')),
    -- Explicit consent record for health data sharing (GDPR Article 9(2)(a))
    consent_given_at    TIMESTAMPTZ,
    consent_withdrawn_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_self_coaching CHECK (trainer_id != client_id),
    UNIQUE (trainer_id, client_id)
);

CREATE INDEX idx_tcr_trainer_id ON trainer_client_relationships (trainer_id);
CREATE INDEX idx_tcr_client_id ON trainer_client_relationships (client_id);

-- Daily compliance snapshots (materialized for dashboard performance)
-- Populated by a background job or on-demand calculation
CREATE TABLE nutrition_compliance_snapshots (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nutrition_plan_id   UUID        NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
    snapshot_date       DATE        NOT NULL,
    -- Actuals (from 006 meal_plan_entries rollup)
    actual_calories     NUMERIC(7,1),
    actual_protein_g    NUMERIC(6,1),
    actual_carbs_g      NUMERIC(6,1),
    actual_fat_g        NUMERIC(6,1),
    -- Compliance percentages
    calories_compliance_pct  NUMERIC(5,1),  -- actual/target × 100
    protein_compliance_pct   NUMERIC(5,1),
    carbs_compliance_pct     NUMERIC(5,1),
    fat_compliance_pct       NUMERIC(5,1),
    -- Derived status
    compliance_status   TEXT        CHECK (compliance_status IN ('on_track', 'under', 'over', 'no_data')),
    calculated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nutrition_plan_id, snapshot_date)
);

CREATE INDEX idx_ncs_plan_date ON nutrition_compliance_snapshots (nutrition_plan_id, snapshot_date);
```

### Key Design Decisions

1. **Targets stored as grams, not ratios**: Even in ratio mode, gram targets are computed and stored at save time. This prevents compliance calculations from drifting if the calorie target changes mid-plan. The original ratios are stored separately for display.

2. **`created_by_id` for trainer-client**: A nutrition plan created by a trainer for a client has `owner_id = client_id` and `created_by_id = trainer_id`. This means the client always owns their data (GDPR compliance), but the trainer's authorship is recorded.

3. **`trainer_client_relationships.consent_given_at`**: Explicit GDPR Article 9(2)(a) consent timestamp. A trainer cannot access a client's nutrition data until `consent_given_at IS NOT NULL AND consent_withdrawn_at IS NULL`.

4. **`nutrition_compliance_snapshots`**: Denormalized compliance data for dashboard performance. Recalculated when meal plan entries change (via SQS event from 006) or on-demand. Avoids expensive joins on every trainer dashboard load.

5. **`nutrition_plan_meal_plans` join table**: A nutrition plan can span multiple meal plans (e.g., a 4-week nutrition plan linked to four weekly meal plans). This is the correct cardinality — 006's research confirmed meal plans are bounded by date range.

---

## RQ-8: Progress Tracking Visualization

### Industry Patterns

**Cronometer's approach**: Ring/donut charts for macro breakdown (% of target consumed), horizontal progress bars per nutrient, color-coded (green = on track, yellow = approaching limit, red = over). Daily diary view shows running totals that update as food is logged.

**Trainerize's approach**: Weekly compliance score (0–100%) per client, trend line over time, traffic light system (green/amber/red) for at-a-glance status. Trainer dashboard shows all clients sorted by compliance score.

**PT Distinction's approach**: Adherence chart (calendar heatmap), weekly summary cards, live activity feed for real-time monitoring.

### Recommended Visualization Stack for 009

| View                | Component                                       | Data Source                                               |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Daily macro rings   | Donut chart (4 rings: cal, protein, carbs, fat) | `nutrition_compliance_snapshots` for the day              |
| Weekly trend        | Line chart: actual vs. target per macro         | `nutrition_compliance_snapshots` GROUP BY week            |
| Trainer client list | Table with compliance % + traffic light         | `nutrition_compliance_snapshots` latest 7 days per client |
| Calendar heatmap    | Color-coded calendar                            | `compliance_status` per day                               |

**Library recommendation**: For the web app (Next.js), use **Recharts** (already common in the React ecosystem, lightweight, composable). For mobile (Expo), use **Victory Native** or **react-native-svg-charts**. Both support the donut/line/bar patterns needed.

**Key UX insight from Trainerize**: The compliance percentage (0–100%) is more actionable than raw gram numbers for the trainer dashboard. Show the percentage prominently; show gram details on drill-down.

---

## Summary: Key Decisions for 009

| Decision             | Recommendation                                                      | Rationale                                                                                       |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Target modes         | Support both ratio-based and fixed-gram                             | Cronometer pattern; ratio mode is better for dynamic goals, fixed for clinical precision        |
| BMR formula          | Mifflin-St Jeor as default; offer Harris-Benedict and Katch-McArdle | Most validated for general population; Katch-McArdle for users with body fat %                  |
| Compliance threshold | On track = 90–110% of target                                        | Trainerize's 80% threshold is too lenient; 90–110% is more clinically appropriate               |
| GDPR basis           | Explicit consent (Article 9(2)(a))                                  | Clearest legal basis; requires separate consent UI at onboarding                                |
| Trainer data access  | Gated by `consent_given_at` timestamp                               | GDPR Article 9 compliance; trainer cannot see client data without explicit consent              |
| Actuals source       | 006's `nutrition_snapshot` JSONB rollup                             | Already computed; no re-join through recipes/ingredients needed                                 |
| Compliance storage   | Denormalized `nutrition_compliance_snapshots`                       | Dashboard performance; avoids expensive joins on trainer's multi-client view                    |
| Net carbs            | Support as optional display mode                                    | Cronometer pattern; relevant for keto users; `net_carbs = total_carbs - fiber - sugar_alcohols` |

---

## Sources

| Source                                  | URL                                                                                                                                                                   | Date       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Cronometer — Edit Macronutrient Targets | https://support.cronometer.com/hc/en-us/articles/360060119292-Edit-Macronutrient-Targets                                                                              | 2026-05-07 |
| MFP API — Goal Preferences              | https://myfitnesspalapi.com/docs/appendix-data-structures-goal-preferences/                                                                                           | 2026       |
| Trainerize — Nutrition Coaching         | https://www.trainerize.com/nutrition-coaching/                                                                                                                        | 2026       |
| PT Distinction — Features               | https://www.ptdistinction.com/features                                                                                                                                | 2026       |
| ICO — Special Category Data             | https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/lawful-basis-for-processing/special-category-data/ | 2026       |
| GDPR Article 9 — Legislation.gov.uk     | https://www.legislation.gov.uk/eur/2016/679/article/9?view=plain                                                                                                      | 2026       |
| PrivacyForge — Special Categories Guide | https://www.privacyforge.ai/blog/special-categories-of-data-under-gdpr-complete-compliance-guide-2025                                                                 | 2026-01-13 |
| Calorique — BMR/TDEE Methodology        | https://calorique.io/methodology/                                                                                                                                     | 2026-03-07 |
| TDEEcal — Formulas Compared             | https://tdeecal.net/tdee/tdee-formulas-compared/                                                                                                                      | 2026-03-02 |
| Institute of Medicine — DRI 2005        | National Academies Press, 2005                                                                                                                                        | 2005       |
| 006 Meal Planning Research              | ../006-meal-planning/research.md                                                                                                                                      | 2026-05-08 |
| 003 USDA Food Data Research             | ../003-usda-food-data/research.md                                                                                                                                     | 2026-05-08 |
