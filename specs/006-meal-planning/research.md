# Research: Feature 006 — Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-05-08 | **Reconciled**: 2026-08-02
**Spec**: [spec.md](./spec.md) | **Status**: Complete, partially superseded — see
[Reconciliation (2026-08-02)](#reconciliation-2026-08-02)

> **Read this first.** This document was written in May 2026, **before** features 001, 002 and 003 shipped. Its external
> research (RQ-1 through RQ-5 — competitor UX, calendar-vs-list, AI patterns, drag-library selection, calendar
> components) stands and is still the basis for the design. Its **platform-facing** answers (RQ-6, RQ-7, RQ-9) were
> reasoned from an imagined codebase and are now contradicted by the shipped one; RQ-8 is half-right. Each superseded
> answer is left in place with its reasoning intact and is corrected in the Reconciliation section at the end, because
> knowing _why_ a plausible answer was wrong is worth more than a clean deletion. Where this document and the codebase
> disagree, **the codebase wins**.

## Research Questions

| #    | Question                                                                         | Status                                                        |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| RQ-1 | How do Paprika, Mealime, and Eat This Much handle meal planning UX?              | ✅ Answered — stands                                          |
| RQ-2 | Calendar-based vs. list-based planning: which pattern wins and why?              | ✅ Answered — stands                                          |
| RQ-3 | AI meal suggestion patterns — how do competitors implement them?                 | ✅ Answered — stands, but **deferred to Phase 2** (C-006-009) |
| RQ-4 | React drag-and-drop library selection for recipe-to-meal assignment              | ✅ Answered — stands, **web only** (see R-4 below)            |
| RQ-5 | Week/calendar view React libraries for meal planning                             | ✅ Answered — stands                                          |
| RQ-6 | Meal plan data model: recipe-to-meal assignment schema in PostgreSQL             | ⚠️ **Superseded** — see R-6                                   |
| RQ-7 | Nutritional rollup aggregation — daily/weekly totals query strategy              | ⛔ **Reversed** — see R-7                                     |
| RQ-8 | How does 006 consume recipes from 001 and feed into 007 (grocery lists)?         | ⚠️ **Revised** — see R-8                                      |
| RQ-9 | Integration with 003 (USDA nutrition) and 009 (nutrition planning) for summaries | ⛔ **Reversed** — see R-9                                     |

---

## RQ-1: Competitor Analysis — Meal Planning UX

### Paprika

Paprika is the most feature-complete recipe-centric meal planner. Its architecture is a **three-tier calendar** (daily / weekly / monthly) with a separate **Menus** concept for reusable multi-day templates.

**Key UX patterns:**

- **Three views**: Daily (sorted by meal type), Weekly (7-day grid), Monthly (calendar overview). Users switch via segmented control.
- **Meal types**: Breakfast, Lunch, Dinner, Snack — fully customizable with color and time associations.
- **Two entry points**: Add from the meal planner (+button) or from the recipe screen (Calendar toolbar button → pick date → pick meal type).
- **Drag-and-drop**: Windows version explicitly supports drag-and-drop to move meals between days; copy/paste via right-click also supported.
- **Menus (reusable templates)**: A "Menu" is a named collection of recipes organized by day (Day 1–7). Adding a Menu to the planner fills in all days from a chosen start date. This is the key differentiator for repeat-week planning.
- **Grocery list integration**: "Add to Grocery List" action works on the currently visible view scope (day/week/month). One tap generates the list for the entire visible period.
- **Calendar export**: Export to iCal/Calendar app — meals become calendar events.

**Data model insight**: Paprika's sync blog post reveals a web of relationships: recipes ↔ categories ↔ groceries ↔ meals must all sync simultaneously. This implies a normalized relational model, not embedded JSONB.

Source: [Paprika iOS User Guide](https://www.paprikaapp.com/help/ios/), [Paprika Android User Guide](http://www.paprikaapp.com/help/android/), [Paprika Windows User Guide](http://www.paprikaapp.com/help/windows/)

---

### Mealime

Mealime takes a **list-first, not calendar-first** approach. The core loop is: browse recipes → add to plan → build plan → get grocery list. There is no week-grid calendar view in the free tier.

**Key UX patterns:**

- **Plan-as-a-list**: A meal plan is a flat list of recipes for the week, not a day-by-day calendar grid. The "Schedule" feature (assign recipes to specific days) is a secondary step.
- **Preference-driven discovery**: Dietary type, allergies, disliked ingredients, and macro filters drive recipe surfacing. The app shows only recipes that match.
- **Build flow**: Browse → tap + on recipe card → tap "Build this Meal Plan" → review → confirm. The entire flow takes under 20 seconds.
- **Grocery list**: Auto-generated from the plan. Users can check off items they already have and add custom items.
- **Nutritional info**: Calories, macros, micros — **Pro only**. Free users see no nutrition data.
- **Meal plan history**: **Pro only**. Free users can only have one active plan.
- **No drag-and-drop**: Mealime does not support drag-and-drop recipe assignment.

**Weakness**: Mealime is more of a "recipe discovery + grocery list" app than a true meal planner. No week view, no multi-meal-per-day assignment, no calendar grid.

Source: [Mealime Guide to Meal Planning](https://www.mealime.com/guides/guide-to-meal-planning), [ScreensDesign Mealime Showcase](https://screensdesign.com/showcase/mealime-meal-plans-recipes)

---

### Eat This Much

Eat This Much is the most **automation-first** meal planner. Its core value proposition is "put your diet on autopilot" — the algorithm generates a complete week of meals that hit calorie and macro targets.

**Key UX patterns:**

- **Auto-generation**: Input calorie target, macro ratios, dietary style, meal count, cooking time per meal → system generates a full day or week instantly.
- **Lock-and-regenerate**: Users can lock meals they want to keep and regenerate the rest. This is the primary interaction model, not manual drag-and-drop.
- **Per-day customization** (Premium): Each day of the week can have unique calorie/macro targets (e.g., higher carbs on workout days).
- **Pantry integration**: Add items you already own; the algorithm prioritizes using them up to reduce waste.
- **Weekly auto-delivery** (Premium): The system emails a new week's plan + grocery list automatically.
- **AI feedback loop**: Thumbs up/down on meal combinations trains the recommendation algorithm over time.
- **Adaptive macro engine**: After 10–14 days of consistent weight logging with ≥80% meal compliance, the system recalibrates macros automatically.

**Algorithm insight**: The generator uses a constraint-satisfaction approach — it must hit calorie targets, macro ratios, dietary restrictions, disliked ingredients, cooking time limits, and budget simultaneously. It is not LLM-based; it is a rule-based optimizer with ML-trained preference weights.

Source: [Eat This Much homepage](https://www.eatthismuch.com/), [Eat This Much Premium features](https://www.eatthismuch.com/choose-plan/), [AI Meal Planner macro adjustment guide](https://www.alibaba.com/product-insights/how-to-use-ai-meal-planners-like-eatthismuch-to-adjust-macros-automatically-when-your-weight-loss-stalls.html)

---

## RQ-2: Calendar-Based vs. List-Based Planning UX

### The Verdict: Calendar wins for recipe apps; list wins for diet apps

| Dimension              | Calendar (Paprika model)                       | List (Mealime model)                    |
| ---------------------- | ---------------------------------------------- | --------------------------------------- |
| **Mental model**       | "What am I eating on Tuesday?"                 | "What am I cooking this week?"          |
| **Primary user**       | Home cook planning family meals                | Diet-focused user hitting macro targets |
| **Drag-and-drop**      | Natural — move Tuesday's dinner to Wednesday   | N/A — no day-level assignment           |
| **Nutritional view**   | Per-day column totals                          | Per-plan aggregate                      |
| **Grocery generation** | Scoped to visible period (day/week/month)      | Whole-plan at once                      |
| **Reuse**              | Menus (reusable week templates)                | Saved plans (history, Pro only)         |
| **Complexity**         | Higher — requires understanding of grid layout | Lower — linear browse-and-add flow      |

**Recommendation for Commise**: Use a **weekly calendar grid** as the primary view (aligns with 001's recipe-centric identity and Paprika's proven model), with a **list/agenda fallback** for mobile. The calendar grid enables drag-and-drop, per-day nutritional summaries, and the grocery list scoping that 007 needs.

**shadcn/ui has a pre-built meal planner block** (updated March 17, 2026) with breakfast/lunch/dinner slots, calorie counts, and daily nutritional totals using TypeScript + shadcn/ui + Tailwind CSS. This is a strong starting point.

Source: [shadcn/ui React Meal Planner Calendar Block](https://www.shadcn.io/blocks/calendar-meal-planner)

---

## RQ-3: AI Meal Suggestion Patterns

### Pattern 1: Constraint-Satisfaction Generator (Eat This Much)

The algorithm takes hard constraints (calories, macros, dietary flags, disliked ingredients, cooking time, budget) and soft preferences (cuisine history, ratings) and solves for a valid meal assignment. This is **not LLM-based** — it is a rule engine with ML-trained weights. Suitable for nutrition-first users.

### Pattern 2: LLM Structured Output (emerging pattern, 2025–2026)

Using LangChain + Zod schemas to guarantee structured JSON output from an LLM. The LLM receives user goals, dietary restrictions, and available recipes, and returns a typed meal plan object. Achieves ~94% JSON parsing reliability at scale; 100% with `StructuredOutputParser`.

```typescript
// LangChain + Zod pattern for structured meal plan generation
const weeklyPlanSchema = z.object({
    days: z.array(
        z.object({
            date: z.string(),
            meals: z.object({
                breakfast: z.object({ recipeId: z.string(), title: z.string() }).optional(),
                lunch: z.object({ recipeId: z.string(), title: z.string() }).optional(),
                dinner: z.object({ recipeId: z.string(), title: z.string() }).optional(),
                snacks: z.array(z.object({ recipeId: z.string(), title: z.string() })).optional(),
            }),
        }),
    ),
});

const parser = StructuredOutputParser.fromZodSchema(weeklyPlanSchema);
```

Source: [Building a Smart AI Meal Planner with LangChain](https://www.wellally.tech/blog/build-ai-meal-planner-nextjs-langchain)

### Pattern 3: Preference-Filtered Recommendation (Mealime)

Surface recipes that match dietary type + allergy restrictions + disliked ingredients. No LLM involved — pure database filtering with personalization weights. Fast, cheap, deterministic.

### Recommendation for Commise

For the **AI meal suggestions** feature (spec User Story 1, acceptance scenario 2), use a **hybrid approach**:

1. **Primary path** (free tier): Preference-filtered recommendation from the user's own recipe collection — filter by dietary flags, cuisine, estimated cook time, and recently-used exclusion. No LLM cost.
2. **AI suggestion path** (premium): LLM call via 005-ai-integration with structured output (Zod schema). The prompt includes: user's dietary preferences, current week's assigned recipes (for variety), nutritional targets from 009 (if linked), and the user's recipe collection titles/IDs. The LLM returns recipe IDs to assign, not new recipe content.
3. **Auto-generate path** (premium): Full week generation — same LLM call but for all 7 days simultaneously.

**NestJS integration**: Use `nest-langchain` (npm, actively maintained as of Feb 2026) for injectable LangChain agents, or wire directly via `@langchain/openai` + `StructuredOutputParser`. The 005-ai-integration spec already defines the AI provider config — 006 should consume it as a NestJS module dependency.

Source: [nest-langchain npm](https://registry.npmjs.org/nest-langchain), [nestjs-generative-ai npm](https://registry.npmjs.org/nestjs-generative-ai)

---

## RQ-4: Drag-and-Drop Library Selection

### 2026 State of React DnD

| Library                             | Weekly Downloads | Status          | Bundle (core) | Verdict                   |
| ----------------------------------- | ---------------- | --------------- | ------------- | ------------------------- |
| `react-beautiful-dnd`               | ~1.2M            | ❌ **Archived** | ~30KB         | Do not use — deprecated   |
| `@dnd-kit/core`                     | ~2.8M            | ✅ Active       | ~6KB          | **Recommended**           |
| `@atlaskit/pragmatic-drag-and-drop` | ~180K            | ✅ Active       | ~3.5KB        | For Jira-scale complexity |

**`react-beautiful-dnd` is archived** as of 2025. Atlassian moved to Pragmatic DnD for their own products. The community standard in 2026 is `@dnd-kit`.

### Why `@dnd-kit` for Commise

- **Multi-container drag**: Drag recipes between day columns and meal-type rows — exactly the meal planner grid pattern. Uses `closestCorners` collision detection for multi-container setups.
- **Modular**: Install only `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (~15KB total).
- **Accessibility**: Screen reader announcements, keyboard sensor, pointer/touch sensors all built-in.
- **TypeScript-first**: Full type definitions.
- **Virtual list support**: If the recipe picker sidebar has many recipes, combine with `@tanstack/react-virtual`.

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Collision detection for meal planner grid**: Use `closestCorners` (best for multi-container kanban-style layouts). Each day-column + meal-type cell is a `useDroppable` target. Recipe cards in the sidebar and assigned meal slots are `useSortable` items.

Source: [dnd-kit vs react-beautiful-dnd vs Pragmatic DnD 2026](https://www.pkgpulse.com/blog/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026), [dnd-kit official site](https://dndkit.com/)

---

## RQ-5: Week/Calendar View React Libraries

### Options Evaluated

| Library                        | Stars | DnD Support | TypeScript | Tailwind | Verdict                                 |
| ------------------------------ | ----- | ----------- | ---------- | -------- | --------------------------------------- |
| `shadcn/ui` meal planner block | N/A   | No (static) | ✅         | ✅       | **Best starting point** — customize     |
| `ilamy-calendar`               | New   | ✅ dnd-kit  | ✅         | ✅       | Full calendar, RFC 5545 RRULE           |
| `calendarkit-pro`              | New   | ✅          | ✅         | ✅       | 5 views, resource scheduling            |
| `react-beauty-calendar`        | Low   | ✅ dnd-kit  | ✅         | ✅       | Google Calendar-inspired, v2.0 Feb 2026 |
| `FullCalendar`                 | High  | ✅          | ✅         | ❌       | Heavy, not Tailwind-native              |

### Recommendation

**Build a custom weekly grid on top of `shadcn/ui` + `@dnd-kit`**, using the [shadcn/ui meal planner block](https://www.shadcn.io/blocks/calendar-meal-planner) as the visual template. This approach:

1. Matches the existing project stack (shadcn/ui + Tailwind CSS v4 per AGENTS.md).
2. Avoids a heavy calendar library dependency for what is fundamentally a 7-column grid.
3. Gives full control over the meal-type row structure (Breakfast / Lunch / Dinner / Snack rows per day column).
4. Integrates cleanly with `@dnd-kit` for drag-and-drop.

The weekly grid is a CSS Grid layout: 8 columns (time/meal-type label + 7 day columns) × N rows (one per meal type). Each cell is a `useDroppable` target. Recipe cards are `useDraggable` items.

For **mobile** (Expo/React Native per AGENTS.md), use a vertical list view (day-by-day accordion) rather than a 7-column grid — the grid does not translate to small screens.

---

## RQ-6: Meal Plan Data Model

### Canonical Three-Level Hierarchy

The industry-standard schema for meal planning apps (validated across SmartEat AI, PrepPal, and multiple Stack Overflow discussions) is a **three-level hierarchy**:

```
meal_plans (1 per user per date range)
  └── meal_plan_days (1 per calendar date)
        └── meal_plan_entries (1 per recipe assignment: date × meal_type × recipe)
```

### Proposed PostgreSQL Schema for 006

⛔ **SUPERSEDED — this is the May draft, kept as the record R-6 corrects. Do NOT copy this DDL.** Every
`REFERENCES users(id)`, `REFERENCES recipes(id)` and `REFERENCES nutrition_plans(id)` below crosses a database
boundary and is unenforceable; the recipe FK additionally contradicts the orphan requirement. The authoritative
DDL is [`plan.md` §Data Model](./plan.md#data-model), which stores `owner_id` as a `varchar(255)` ULID and
`recipe_id` as a bare `uuid`, per **C-006-002** / **REQ-CN-003**. See **R-6** below for the full account.
_(Banner added 2026-08-16 — the prose correction existed, but nothing marked the block a reader would copy.)_

```sql
-- Level 1: The plan container
CREATE TABLE meal_plans (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID        NOT NULL REFERENCES users(id),
    title           TEXT        NOT NULL DEFAULT 'My Meal Plan',
    start_date      DATE        NOT NULL,
    end_date        DATE        NOT NULL,
    -- Link to 009 nutrition plan (optional)
    nutrition_plan_id UUID      REFERENCES nutrition_plans(id),
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'template')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meal_plans_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_meal_plans_owner_id ON meal_plans (owner_id);
CREATE INDEX idx_meal_plans_date_range ON meal_plans (owner_id, start_date, end_date);

-- Level 2: Individual meal slot assignments
-- No separate "days" table needed — the date is a column on entries
CREATE TABLE meal_plan_entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_plan_id    UUID        NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    plan_date       DATE        NOT NULL,
    meal_type       TEXT        NOT NULL
                    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id       UUID        NOT NULL REFERENCES recipes(id),
    servings        NUMERIC(5,2) NOT NULL DEFAULT 1.0
                    CHECK (servings > 0),
    -- Display order within a meal_type slot on a given day
    sort_order      INTEGER     NOT NULL DEFAULT 0,
    -- Denormalized nutrition snapshot at time of assignment (avoids re-join on every render)
    nutrition_snapshot JSONB,   -- { calories, protein_g, carbs_g, fat_g }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meal_plan_entries_plan_id ON meal_plan_entries (meal_plan_id);
CREATE INDEX idx_meal_plan_entries_date ON meal_plan_entries (meal_plan_id, plan_date);
CREATE UNIQUE INDEX idx_meal_plan_entries_slot
    ON meal_plan_entries (meal_plan_id, plan_date, meal_type, recipe_id);

-- Level 3: Reusable week templates (Paprika "Menus" equivalent)
CREATE TABLE meal_plan_templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID        NOT NULL REFERENCES users(id),
    title           TEXT        NOT NULL,
    description     TEXT,
    duration_days   INTEGER     NOT NULL DEFAULT 7 CHECK (duration_days > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meal_plan_template_entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID        NOT NULL REFERENCES meal_plan_templates(id) ON DELETE CASCADE,
    day_offset      INTEGER     NOT NULL CHECK (day_offset >= 0), -- 0 = Day 1, 6 = Day 7
    meal_type       TEXT        NOT NULL
                    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id       UUID        NOT NULL REFERENCES recipes(id),
    servings        NUMERIC(5,2) NOT NULL DEFAULT 1.0,
    sort_order      INTEGER     NOT NULL DEFAULT 0
);
```

### Key Design Decisions

1. **No separate `meal_plan_days` table**: The `plan_date` column on `meal_plan_entries` is sufficient. A separate days table adds a join with no benefit for this access pattern.
2. **`nutrition_snapshot` JSONB**: Denormalized nutrition at assignment time. Avoids a 6-table join (entries → recipes → recipe_ingredients → ingredients → food_nutrients → nutrients) on every calendar render. Updated when the recipe's nutrition changes via a background job or trigger.
3. **`servings` column**: Allows scaling a recipe's nutrition contribution (e.g., assign 2 servings of a recipe that serves 4).
4. **Templates**: The `meal_plan_templates` + `meal_plan_template_entries` tables implement Paprika's "Menus" concept — reusable week patterns that can be stamped onto a date range.
5. **`status = 'template'`** on `meal_plans`: Alternatively, a plan can be marked as a template directly, avoiding the separate template tables for simple use cases.

Source: [SmartEat AI Database Schema](https://mintlify.com/SmartEatAI/smart-eat-ai/development/database-schema), [Stack Overflow: meal planner DB optimization](https://stackoverflow.com/questions/76414276/how-to-optimise-db-schema-for-a-meal-planner-app)

---

## RQ-7: Nutritional Rollup Aggregation

### The Query Problem

A meal plan nutritional summary requires aggregating `calories`, `protein_g`, `carbs_g`, `fat_g` across all entries for a given day or week, scaled by `servings`. The naive approach (6-table join per render) is too slow.

### Strategy 1: Denormalized `nutrition_snapshot` (Recommended)

Store a `nutrition_snapshot JSONB` on each `meal_plan_entry` at assignment time. The daily/weekly rollup becomes a simple SUM over the entries table:

```sql
-- Daily nutritional totals for a meal plan
SELECT
    plan_date,
    SUM((nutrition_snapshot->>'calories')::NUMERIC * servings)    AS total_calories,
    SUM((nutrition_snapshot->>'protein_g')::NUMERIC * servings)   AS total_protein_g,
    SUM((nutrition_snapshot->>'carbs_g')::NUMERIC * servings)     AS total_carbs_g,
    SUM((nutrition_snapshot->>'fat_g')::NUMERIC * servings)       AS total_fat_g
FROM meal_plan_entries
WHERE meal_plan_id = $1
GROUP BY plan_date
ORDER BY plan_date;
```

This query hits only `meal_plan_entries` — no joins. With the `idx_meal_plan_entries_plan_id` index, this is a fast index scan + aggregate.

### Strategy 2: PostgreSQL `GROUPING SETS` for Multi-Level Rollup

For the nutrition summary panel (daily totals + weekly total in one query), use `GROUPING SETS`:

```sql
-- Daily totals + weekly grand total in one query
SELECT
    plan_date,
    meal_type,
    SUM((nutrition_snapshot->>'calories')::NUMERIC * servings) AS calories,
    SUM((nutrition_snapshot->>'protein_g')::NUMERIC * servings) AS protein_g
FROM meal_plan_entries
WHERE meal_plan_id = $1
GROUP BY GROUPING SETS (
    (plan_date, meal_type),  -- per meal slot
    (plan_date),             -- per day total
    ()                       -- weekly grand total
)
ORDER BY plan_date NULLS LAST, meal_type NULLS LAST;
```

`GROUPING SETS` avoids multiple round-trips and is supported on RDS PostgreSQL 16.

Source: [PostgreSQL GROUPING SETS in Practice](https://thelinuxcode.com/postgresql-grouping-sets-in-practice-clean-multi-level-aggregations-without-query-sprawl/)

### Strategy 3: Snapshot Staleness Handling

When a recipe's nutrition data changes (e.g., after a USDA ingredient update from 003), the `nutrition_snapshot` on existing `meal_plan_entries` becomes stale. Two options:

- **Lazy refresh**: On meal plan load, check `recipe.updated_at > entry.updated_at` and re-compute snapshots for stale entries. Simple, no background job needed.
- **SQS-triggered refresh**: When 003 updates a food item, enqueue affected recipe IDs to an SQS queue. A Lambda worker re-computes and updates `nutrition_snapshot` for all entries referencing those recipes. Consistent with the existing SQS pattern in 003.

**Recommendation**: Use lazy refresh for MVP (simpler), migrate to SQS-triggered refresh when 003 is live.

---

## RQ-8: Integration with 001 (Recipes) and 007 (Grocery Lists)

### Consuming Recipes from 001

`meal_plan_entries.recipe_id` is a foreign key to `recipes.id` (001's table). The meal planning service reads recipes via the existing `RecipesService` from 001. Key access patterns:

1. **Recipe picker sidebar**: Query `recipes WHERE owner_id = $userId AND deleted_at IS NULL` with optional FTS filter. Paginated. Uses 001's existing search infrastructure.
2. **Nutrition snapshot population**: On entry creation, call `RecipesService.getNutritionSummary(recipeId, servings)` to compute the snapshot. This method aggregates `recipe_ingredients → ingredients → food_nutrients` (003's data).
3. **Recipe detail on hover/tap**: Deep-link to the recipe detail view from 001 — no data duplication needed.

**Visibility constraint**: A meal plan entry can only reference recipes where `owner_id = meal_plan.owner_id` OR `visibility = 'public'`. This mirrors 001's access control model.

### Feeding into 007 (Grocery Lists)

The grocery list generation flow (007) consumes meal plan data as follows:

```
meal_plan_entries (for a date range)
  → JOIN recipes → recipe_ingredients → ingredients
  → aggregate by ingredient_id, SUM(quantity * servings)
  → normalize units (003's unit normalization)
  → output: grocery_list_items
```

**The 006→007 contract**: 007 needs a `GET /meal-plans/:id/ingredients?startDate=&endDate=` endpoint from 006 that returns aggregated ingredient quantities for a date range. This is the primary integration surface.

**Scoping**: Paprika's model of scoping grocery generation to the currently visible view (day/week/month) is the right UX. The API should accept `startDate` + `endDate` parameters so 007 can request any range.

---

## RQ-9: Integration with 003 (USDA Nutrition) and 009 (Nutrition Planning)

### 003 Integration (USDA Food Data)

Nutrition data flows into 006 via the path established in 003's research:

```
recipe_ingredients.ingredient_id
  → ingredients.fdc_id (USDA FoodData Central ID)
  → food_nutrients (cached in RDS from 003's Lambda enrichment pipeline)
  → SUM(nutrient_value * quantity_in_grams / 100) per recipe
  → scaled by meal_plan_entries.servings
  → stored in meal_plan_entries.nutrition_snapshot
```

The `nutrition_snapshot` JSONB stores the **macro summary** (calories, protein, carbs, fat) for fast calendar rendering. Full micronutrient detail (for 009's compliance analysis) is computed on-demand by joining through to `food_nutrients`.

**Partial nutrition flag**: `recipes.has_partial_nutrition` (from 001's schema) indicates that some ingredients lack USDA data. The meal plan UI should surface this as a warning on the nutritional summary (e.g., "⚠ Nutrition estimate — some ingredients missing data").

### 009 Integration (Nutrition Planning)

009's `nutrition_plans` table links to `meal_plans` for compliance analysis. The integration is:

1. **Link**: A `nutrition_plan` has an optional `meal_plan_id` FK. When linked, 009 computes compliance by comparing `meal_plan_entries` nutritional totals against the nutrition plan's daily targets.
2. **Display in 006**: The meal plan calendar can optionally show a compliance indicator per day (e.g., a colored bar: green = on target, yellow = ±10%, red = >20% off). This data comes from a 009 API call, not computed in 006.
3. **AI suggestion context**: When generating AI meal suggestions (RQ-3), if a nutrition plan is linked, pass the daily calorie/macro targets to the LLM prompt as constraints.

---

## Summary of Key Decisions

Reconciled 2026-08-02. Rows marked **(revised)** replace the May answer; the original reasoning is preserved in the RQ
section above and the correction is explained below.

| Decision                                | Choice                                                                                                     | Rationale                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary UX pattern**                  | Weekly calendar grid (7-column × meal-slot rows)                                                           | Matches recipe-app identity; enables DnD; aligns with Paprika's proven model                                                                                              |
| **Mobile UX** _(revised)_               | Day-by-day vertical list with **tap-to-assign**, no drag                                                   | A 7-column grid is unusable on a phone, and card-dragging fights the scroll gesture. Fewer interactions (SC-006-002).                                                     |
| **Drag-and-drop library**               | `@dnd-kit/core` + `@dnd-kit/sortable` — **web only**                                                       | Chosen for its **keyboard sensor**: NFR-003 requires a keyboard-operable equivalent, which pointer-only libraries cannot give.                                            |
| **Calendar component**                  | Custom grid on the existing design tokens (`@commise/ui`) + Tailwind CSS v4                                | Slot semantics are domain-specific; a generic scheduler models timeline events, not named meal slots                                                                      |
| **Data model** _(revised)_              | `meal_plans` → `meal_plan_entries`, **no FKs to users or recipes**, plus templates + an idempotency ledger | No local users table exists (001 "D2"); recipes live in a different logical database, so a recipe FK is unenforceable and contradicts orphan semantics                    |
| **Nutrition rollup** _(revised)_        | **Pure read-time fold** over recipe-level `RecipeNutrition × servings`; no snapshot table, no cache        | 001 already computes per-serving recipe nutrition purely, with an `isComplete` partial flag. A snapshot is a second source of truth that goes stale on every recipe edit. |
| **Nutrition source** _(revised)_        | The **recipe service**, via one additive batch projection                                                  | 006 never calls the food service; nutrition is already resolved and denormalized by 001                                                                                   |
| **Fibre** _(new)_                       | Out of scope                                                                                               | Shipped `RecipeNutrition` is calories/protein/carbs/fat only                                                                                                              |
| **Cache** _(revised)_                   | **None**                                                                                                   | No Redis/ElastiCache exists; ADR-0004/0007/0008 exist to keep this spend out. The fold is microseconds.                                                                   |
| **Async layer** _(revised)_             | **None** — no SQS, no worker, no DLQ                                                                       | Its only purpose was to refresh the snapshot table that no longer exists                                                                                                  |
| **AI suggestions**                      | Hybrid: preference-filter + LLM structured output — **Phase 2, deferred**                                  | Blocked on 005 (no provider surface) **and** 010 (tier is not a token claim, so no gate is enforceable)                                                                   |
| **Reusable templates**                  | `meal_plan_templates` + `meal_plan_template_entries`, keyed by **relative day offset**                     | Paprika "Menus" equivalent; offsets (not dates) are what make a template re-appliable                                                                                     |
| **Lock / finalize** _(new)_             | **Dropped**                                                                                                | Its only purpose was freezing a plan for grocery ordering; 007 does not exist. YAGNI.                                                                                     |
| **007 integration surface** _(revised)_ | `GET /api/v1/meal-plans/{id}/grocery-projection` — a **read projection**, versioned additively             | 006 provides data; it does not aggregate ingredients or generate lists. Ingredient expansion belongs to 007, which owns the dedup/merge rules.                            |

---

## Reconciliation (2026-08-02)

What changed after 001/002/003 shipped, and why each May answer failed. Recorded so the same reasoning is not repeated.

### R-4 — `@dnd-kit` stands, but the _reason_ changed and its scope narrowed

May chose `@dnd-kit` largely on ecosystem grounds (react-beautiful-dnd deprecated). That is still true, but the binding
reason is **NFR-003**: the planner's drag interaction must have a keyboard-operable equivalent, and `@dnd-kit` ships an
accessible keyboard sensor with screen-reader announcements. It is also now explicitly a **web-only** dependency — never
imported from shared code — because mobile does not use drag at all.

### R-6 — the data model was right in shape, wrong at every boundary

The flat `meal_plans → meal_plan_entries` shape (date as a column, no days table) was a good call and is kept. What was
wrong:

- `user_id UUID REFERENCES users(id)` — **there is no users table**. `recipes.owner_id` is a `varchar(255)` app-user
  ULID with no FK, and its schema header documents this as a deliberate decision ("D2: no local `users` table").
- `recipe_id UUID REFERENCES recipes(id)` — a **cross-database** FK. Recipes are in `kitchensink_recipes`; meal plans
  are in their own logical database. Postgres cannot enforce it. Worse, the same document required entries to survive
  recipe removal as `orphaned` — a foreign key and an orphan requirement are mutually exclusive.
- `meal_plan_nutrition` with `fiber_g_total` — see R-7; fibre is not obtainable from any shipped source.

### R-7 — the nutrition strategy was solving a problem the platform had already solved

May framed the problem as "6-table join per calendar row" and reached for a denormalized snapshot plus `GROUPING SETS`
plus SQS-driven refresh. That framing assumed 006 would aggregate **ingredients**. It does not. 001 ships:

- per-100g macros persisted on ingredient rows,
- `@kitchensink/recipe-core/nutrition` — a pure per-serving fold with unit conversion, portion handling, user overrides
  and an `isComplete` partial-estimate flag,
- `leadCaloriesPerServing` and `hasPartialNutrition` denormalized onto the recipe **list** projection specifically to
  avoid an N+1 on cards.

So 006's aggregation is `Σ(recipeNutrition × servings)` over at most 360 entries — a pure fold costing microseconds. The
snapshot table bought nothing and cost correctness: a recipe edited after the rollup leaves stored totals silently
wrong, with no invalidation path. Removing it also removed the SQS layer, the DLQ, the worker and the "updating
nutrition" UI state that existed only to service it.

The real cost is the **network**, not the arithmetic — which is why the one genuine addition is a bounded **batch**
nutrition projection on the recipe service, sized to a whole plan.

### R-8 — consumption from 001 is right; the handoff to 007 was over-reaching

Consuming recipes by id and honouring their access rules is correct. But the proposed
`GET /meal-plans/:id/ingredients` had 006 expanding recipes into an aggregated ingredient list — that is 007's job, and
007 owns the dedup, unit-merge and pantry rules that make it non-trivial. 006 now exposes a plain read projection of
entries (recipe id, date, slot, servings) and lets 007 do the aggregation it is responsible for. This also means 006
does not need recipe **ingredients** at all — only recipe **nutrition** — which materially narrows its dependency.

### R-9 — 006 does not integrate with 003

The May answer assumed a `usda_fdc_id` on ingredients and a live USDA nutrient fetch. Neither survives contact with the
shipped platform: 003 is deliberately **source-agnostic** (USDA is one adapter behind
`packages/services/food-service/src/sources/foodSourceAdapter.ts`), foods are referenced by an opaque internal id and
never by `fdcId`, and nutrition is resolved asynchronously and denormalized by 001 long before 006 reads it. **006 makes
no call to the food service.** The 009 half of RQ-9 stands: 009 links to meal plans and computes compliance itself;
006 provides the projection (FR-036) and computes no compliance.

### R-3 addendum — AI is deferred, and the entitlement is the harder blocker

The AI patterns research is sound and is kept for when 005 exists. The blocker that May did not see is **010**: the
premium gate was designed to read `tier` from the session token's `public_metadata`, but on `main` that claim carries
only `scopes`/`permissions` — asserted by `packages/shared/clerk-verify/src/__tests__/clerkVerify.test.ts` — while
`subscriptionTier` lives in the identity service's `accounts` table. A guard reading `tier` from the token denies every
user. FR-025/026/027 are therefore Phase 2 (spec C-006-009).
