# Research: Feature 007 — Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists` | **Date**: 2026-05-08
**Spec**: [spec.md](../spec.md) | **Status**: Complete

## Research Questions

| #    | Question                                                                           | Status      |
| ---- | ---------------------------------------------------------------------------------- | ----------- |
| RQ-1 | Competitor UX: how do Mealime, Paprika, AnyList handle grocery list aggregation?   | ✅ Answered |
| RQ-2 | Instacart Developer Platform API — shopping list and recipe page creation          | ✅ Answered |
| RQ-3 | Walmart Marketplace API — grocery ordering integration feasibility                 | ✅ Answered |
| RQ-4 | Amazon Fresh / Amazon Business API — grocery ordering integration feasibility      | ✅ Answered |
| RQ-5 | Unit conversion libraries for culinary measurements (cups → grams, tbsp → ml)      | ✅ Answered |
| RQ-6 | Ingredient aggregation algorithm — same ingredient, different units across recipes | ✅ Answered |
| RQ-7 | How does 007 consume meal plan data from 006?                                      | ✅ Answered |
| RQ-8 | Data model: `grocery_list_items` vs `recipe_ingredients` — what changes?           | ✅ Answered |
| RQ-9 | Unit conversion utility — shared across 003, 006, 007                              | ✅ Answered |

---

## RQ-1: Competitor UX — Grocery List Aggregation Patterns

### Paprika Recipe Manager

Paprika is the most direct competitor for the aggregation use case. Its "Smart Grocery Lists" feature:

- **Combines same-name ingredients automatically**: `1 egg` + `2 eggs` = `3 eggs`. This is exact-name matching, not fuzzy.
- **Sorts by aisle**: Dairy, Produce, etc. — user-configurable aisle order.
- **Multiple lists**: Users can maintain separate lists (e.g., "This Week," "Costco Run").
- **Pantry integration**: Items marked as "in pantry" are excluded from the generated list.
- **Measurement conversion**: Paprika converts between standard and metric within the same unit type (volume↔volume, mass↔mass) but does **not** cross volume↔mass boundaries without density data.

Source: [Paprika App Store listing](https://apps.apple.com/us/app/paprika-recipe-manager-3/id1303222868) (2026-04-27); [paprikaapp.com](http://www.paprikaapp.com/)

**Key insight**: Paprika's aggregation is name-based. It does not attempt cross-unit normalization (e.g., "2 cups flour" + "100g flour" remain separate). This is a known limitation users complain about.

### AnyList

AnyList's approach is **user-driven aggregation** rather than automatic:

- **Date-range selection**: User selects a date range from the meal plan calendar; AnyList shows all required ingredients. User taps to add individual items or adds everything at once.
- **Category auto-sort**: Items automatically grouped by store category (Produce, Dairy, Deli, etc.) with user-reorderable categories.
- **Real-time sharing**: Shared lists sync instantly across household members.
- **No automatic quantity combining**: AnyList does not auto-combine "2 cups flour" + "1 cup flour" — it adds both as separate line items. Users manually merge.

Source: [AnyList meal planning page](https://www.anylistapp.com/meal-planning); [App Store listing](https://apps.apple.com/us/app/anylist-grocery-shopping-list/id522167641) (v7.0, Apr 2026)

**Key insight**: AnyList prioritizes simplicity and sharing over smart aggregation. The lack of auto-combining is a deliberate UX choice — users retain control. This is a **differentiation opportunity** for Commise.

### Mealime

Mealime's grocery list is the most automated of the three:

- **Fully auto-generated**: When a user selects recipes for the week, Mealime generates the complete grocery list with no manual steps.
- **Ingredient combining**: Mealime combines identical ingredients across recipes (e.g., two recipes needing onions → one line item with total quantity).
- **Grocery delivery integration**: Mealime partners with grocery fulfillment services — users can send the list to a delivery partner directly from the app. This is the closest existing model to what 007 targets.
- **Category sorting**: All ingredients auto-sorted into store categories.
- **Waste minimization**: Meal plans are constructed to reuse overlapping ingredients, reducing the grocery list footprint.

Source: [Mealime Google Play listing](https://play.google.com/store/apps/details?id=com.mealime) (Mar 2026); [mealime.com](https://www.mealime.com/)

**Key insight**: Mealime's model — auto-generate list from meal plan, combine duplicates, send to delivery partner — is the **target UX pattern** for 007. The delivery integration is the premium differentiator.

### RecipeSage (Open Source Reference)

RecipeSage ([github.com/julianpoy/recipesage](https://github.com/julianpoy/recipesage), 851 stars, last push Apr 2026) is a TypeScript/Node.js open-source recipe + meal planner + shopping list app. Its shopping list feature:

- **Automatic item categorization**: Items are intelligently grouped; similar items are combined.
- **Multi-user collaboration**: Shopping lists shared between household members.
- **Meal plan → shopping list**: Direct workflow from meal plan to list.

This is the most relevant open-source reference implementation for 007's architecture.

### UX Pattern Summary

| Feature                       | Paprika | AnyList | Mealime | RecipeSage | **007 Target** |
| ----------------------------- | ------- | ------- | ------- | ---------- | -------------- |
| Auto-generate from meal plan  | ✅      | ✅      | ✅      | ✅         | ✅             |
| Auto-combine same ingredient  | ✅      | ❌      | ✅      | ✅         | ✅             |
| Cross-unit normalization      | ❌      | ❌      | ❌      | ❌         | ✅ (v2)        |
| Pantry/already-have exclusion | ✅      | ❌      | ❌      | ❌         | ✅             |
| Category/aisle sorting        | ✅      | ✅      | ✅      | ✅         | ✅             |
| Online ordering integration   | ❌      | ❌      | ✅      | ❌         | ✅ (premium)   |
| Real-time household sharing   | ❌      | ✅      | ❌      | ✅         | ✅             |

---

## RQ-2: Instacart Developer Platform API

### Overview

The **Instacart Developer Platform (IDP)** is the correct integration target for grocery ordering. It is explicitly designed for meal planning and recipe apps — not the retailer-only Connect APIs.

- **Production endpoint**: `https://connect.instacart.com`
- **Dev endpoint**: `https://connect.dev.instacart.tools`
- **Auth**: Bearer token (API key, not OAuth). Key obtained by contacting Instacart representative.
- **Onboarding time**: ~30–40 days from access request to production key.
- **Affiliate revenue**: Developers with live integrations can earn commissions on completed orders.

Source: [Instacart IDP Overview](https://docs.instacart.com/developer_platform_api/) (2026-04-29); [Get Started](https://docs.instacart.com/developer_platform_api/get_started/overview)

### Key Endpoints

#### `POST /idp/api/v1/products/shopping_list` — Create Shopping List Page

Creates a hosted Instacart shopping list page and returns a shareable link. Users click the link, select a store, add products to cart, and check out on Instacart.

**Request body** (key fields):

```typescript
interface InstacartShoppingListRequest {
    title: string;
    image_url?: string; // 500×500px
    link_type: 'shopping_list' | 'recipe';
    expires_in?: number; // days, max 365
    instructions?: string[];
    line_items: InstacartLineItem[];
    landing_page_configuration?: {
        partner_linkback_url?: string;
        enable_pantry_items?: boolean; // recipe link_type only
    };
}

interface InstacartLineItem {
    name: string; // used as search term for product matching
    display_text?: string; // shown in UI; falls back to name
    product_ids?: number[]; // pin to specific Instacart product IDs
    upcs?: string[]; // pin to specific UPCs (mutually exclusive with product_ids)
    line_item_measurements?: InstacartMeasurement[];
    filters?: {
        brand_filters?: string[]; // case-sensitive brand names
        health_filters?: Array<'ORGANIC' | 'GLUTEN_FREE' | 'FAT_FREE' | 'VEGAN' | 'KOSHER' | 'SUGAR_FREE' | 'LOW_FAT'>;
    };
}

interface InstacartMeasurement {
    quantity: number;
    unit: string; // 'each', 'package', 'tablespoon', 'teaspoon', 'ounce', 'kilogram', etc.
}
```

Source: [Create Shopping List Page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/) (2026-04-29)

#### `POST /idp/api/v1/products/recipe` — Create Recipe Page

Creates a recipe-specific page with ingredient-to-product matching. Supports `enable_pantry_items` so users can mark items they already have.

**Key difference from shopping list**: Recipe pages support pantry item marking and have a 30-day default expiry. Shopping list pages have no default expiry.

Source: [Create Recipe Page](https://docs.instacart.com/developer_platform_api/api/products/create_recipe_page) (2026-04-29)

### MCP Integration (AI-Native Path)

Instacart provides an **MCP server** at `https://mcp.instacart.com/mcp` (prod) / `https://mcp.dev.instacart.tools/mcp` (dev). This allows AI agents to create recipe pages and shopping lists via natural language without direct API integration.

Source: [Connect AI Agent to Instacart with MCP](https://docs.instacart.com/developer_platform_api/guide/tutorials/mcp/) (2025-11-04)

### Integration Architecture for 007

```
GroceryListService
  → aggregateIngredients(mealPlanId)
  → normalizeUnits(ingredients)
  → POST /idp/api/v1/products/shopping_list
  ← { link: "https://www.instacart.com/store/..." }
  → return link to client (redirect or deep link)
```

**Critical constraint**: IDP is a **redirect model** — Commise generates a link, user completes checkout on Instacart. Commise does not handle payment or fulfillment. This is the correct model for a B2C developer partner.

### Rate Limiting

HTTP 429 on excess requests. No published RPS limit — contact Instacart representative if repeatedly hitting limits.

---

## RQ-3: Walmart Marketplace API — Feasibility Assessment

### What Walmart's API Actually Is

The Walmart Developer Portal (`developer.walmart.com`) exposes the **Walmart Marketplace API** — designed for **third-party sellers** listing products on Walmart.com, not for consumer grocery ordering apps.

Key APIs:

- **Orders API**: Retrieve/manage orders for items _you sell_ on Walmart.com.
- **WFS (Walmart Fulfillment Services)**: Manage inventory in Walmart fulfillment centers.
- **Item Management API**: Create/update product listings.

**This is not a grocery ordering API for consumers.** It is a seller/vendor API.

Source: [Introduction to Walmart Marketplace APIs](https://developer.walmart.com/us-marketplace/docs/introduction-to-marketplace-apis); [Order Management API Overview](https://developer.walmart.com/global-marketplace/docs/order-management-api-overview) (Jan 2026)

### Walmart Grocery Integration Reality

There is **no public Walmart Grocery API** for third-party consumer apps to place grocery orders on behalf of users. Walmart's grocery ordering is available through:

1. **Walmart.com / Walmart app** — direct consumer channels only.
2. **Walmart+ affiliate program** — affiliate links, not programmatic ordering.
3. **Instacart** — Walmart is a retailer on Instacart's marketplace. **The Instacart IDP integration (RQ-2) covers Walmart grocery ordering** because Instacart's product catalog includes Walmart stores in many markets.

**Decision**: Do not build a direct Walmart API integration. The Instacart IDP covers Walmart as a retailer. If direct Walmart integration is required in the future, it would require a custom partnership agreement.

---

## RQ-4: Amazon Fresh / Amazon Business API — Feasibility Assessment

### Amazon Fresh

Amazon Fresh does **not have a public API** for third-party consumer grocery ordering. The Amazon SP-API (Selling Partner API) is for Amazon sellers, not for placing grocery orders on behalf of consumers.

The Amazon Orders API v2026-01-01 (newly released, migrating from v0) is for **sellers** to manage their own orders on Amazon — not for consumer apps to place orders.

Source: [Amazon Orders API v2026-01-01](https://developer-docs.amazon.com/sp-api/docs/orders-api) (2026); [Orders API Migration Guide](https://developer-docs.amazon.com/sp-api/changelog/new-introducing-the-orders-api-v2026-01-01)

The Amazon Business Cart API (`developer-docs.amazon.com/amazon-business`) allows programmatic cart management for **Amazon Business accounts** (B2B procurement), not consumer grocery ordering.

### Amazon Fresh Integration Reality

A 2020 GitHub issue on the Grocy project ([grocy/grocy#905](https://github.com/grocy/grocy/issues/905)) confirms: "Amazon Fresh at least seems to require some kind of onboarding to use their API" and the API is not publicly documented. The issue was closed as `wontfix/out-of-scope` in 2022 — the maintainers concluded that grocery delivery integration is too region-dependent and requires private partnerships.

The Amazon Creators API (replacing PA-API v5, which retired May 15, 2026) is for **product data/affiliate links** only — not for placing orders.

**Decision**: Do not build an Amazon Fresh integration. No viable public API exists. Instacart covers Amazon Fresh stores in markets where Amazon participates in Instacart's marketplace.

### Summary: Online Ordering Integration Strategy

| Provider        | API Type          | Consumer Ordering | Recommendation          |
| --------------- | ----------------- | ----------------- | ----------------------- |
| Instacart IDP   | Public (B2C)      | ✅ Redirect model | **Primary integration** |
| Walmart         | Seller/Vendor API | ❌                | Via Instacart           |
| Amazon Fresh    | No public API     | ❌                | Via Instacart           |
| Amazon Business | B2B Cart API      | ❌ (B2B only)     | Out of scope            |

**Instacart IDP is the only viable public API for consumer grocery ordering.** It covers ~1,400 retail banners including Walmart, Costco, Kroger, Safeway, and others across the US and Canada.

---

## RQ-5: Unit Conversion Libraries for Culinary Measurements

### The Core Problem

Culinary recipes use heterogeneous measurement systems:

- **Volume (US)**: tsp, tbsp, fl oz, cup, pint, quart, gallon
- **Volume (metric)**: ml, cl, dl, l
- **Mass**: g, kg, oz, lb
- **Count**: each, clove, bunch, pinch (unconvertible without density)

Aggregating "2 cups flour" + "100g flour" requires volume→mass conversion, which requires **ingredient-specific density data**. This is the hard problem.

A real-world bug report from TandoorRecipes ([issue #4457](https://github.com/TandoorRecipes/recipes/issues/4457), Feb 2026) documents exactly this: olive oil measured in tablespoons in one recipe and grams in another produces two separate shopping list entries. The proposed solution uses a density lookup table:

```python
UNIT_VOLUME = {'tablespoon': 15, 'teaspoon': 5, 'cup': 240, 'ml': 1, 'l': 1000}
INGREDIENT_DENSITIES = {'olive oil': 0.92, 'butter': 0.91, 'milk': 1.03, ...}

def convert_to_base_unit(amount, unit, food_name):
    if unit in ('g',): return amount, 'g'
    if unit in ('kg',): return amount * 1000, 'g'
    ml_per_unit = UNIT_VOLUME.get(unit)
    if ml_per_unit:
        ml = amount * ml_per_unit
        density = INGREDIENT_DENSITIES.get(normalize(food_name))
        if density:
            return round(ml * density, 2), 'g'
        return round(ml, 2), 'ml'
    return amount, unit
```

### Recommended Library: `parse-ingredient` (npm)

**Package**: [`parse-ingredient`](https://www.npmjs.com/package/parse-ingredient) (Jake Boone)
**GitHub**: [jakeboone02/parse-ingredient](https://github.com/jakeboone02/parse-ingredient) — 21 stars, TypeScript, last release v2.1.0 (Feb 2026), last push Apr 2026.

This is the most complete TypeScript-native solution. It provides:

1. **Parsing**: Converts ingredient strings to structured objects, handling mixed numbers, vulgar fractions, Unicode fractions.
2. **Unit normalization**: `normalizeUnits: true` option converts "cups" → "cup", "ml" → "milliliter" for consistent processing.
3. **`convertUnit` function**: Converts between compatible units (volume↔volume, mass↔mass). Returns `null` for incompatible types (volume↔mass — requires density).

```typescript
import { parseIngredient, convertUnit } from 'parse-ingredient';

// Parse
parseIngredient('2 1/2 cups all-purpose flour');
// → [{ quantity: 2.5, unitOfMeasureID: 'cup', unitOfMeasure: 'cup', description: 'all-purpose flour', ... }]

// Convert within same type
convertUnit(1, 'cup', 'milliliter'); // → 236.588 (US)
convertUnit(1, 'pound', 'gram'); // → 453.592
convertUnit(1, 'cup', 'gram'); // → null (incompatible: volume vs mass)

// Multi-system support
convertUnit(1, 'cup', 'milliliter', { fromSystem: 'imperial' }); // → 284.131
```

**Supported unit types**: `volume`, `mass`, `length`. Count-based units (pinch, clove, bag) cannot be converted.

Source: [parse-ingredient npm](https://www.npmjs.com/package/parse-ingredient); [GitHub](https://github.com/jakeboone02/parse-ingredient) (v2.1.0, Feb 2026)

### Supporting Library: `@magrinj/parse-ingredients`

**GitHub**: [magrinj/parse-ingredients](https://github.com/magrinj/parse-ingredients) — zero dependencies, TypeScript, multi-language (EN, FR, ES, IT, DE, PT).

Provides a `combine()` function that aggregates duplicate ingredients by summing quantities when name + unit match:

```typescript
import { combine } from '@magrinj/parse-ingredients';

combine([
  { quantity: '1', unit: 'cup', ingredient: 'flour', ... },
  { quantity: '2', unit: 'cup', ingredient: 'flour', ... },
]);
// → [{ quantity: '3', unit: 'cup', ingredient: 'flour', ... }]
```

**Limitation**: Combines only when unit is identical. Does not handle cross-unit aggregation.

### Volume→Mass Conversion Strategy

For cross-unit aggregation (the hard case), the approach is:

1. **Phase 1 (MVP)**: Aggregate only within the same unit type. "2 cups flour" + "1 cup flour" = "3 cups flour". "100g flour" remains a separate line item. Display both to user with a note.
2. **Phase 2**: Integrate USDA FDC density data (from 003) to enable volume→mass conversion for known ingredients. Normalize all quantities to grams for aggregation, then display in user-preferred unit.

The density data from USDA FDC (feature 003) is the key enabler for Phase 2. The `nutrients` data in FDC includes `100g` reference values, and portion data includes volume-to-weight conversions for many ingredients.

### Culinary Density Reference

From [culinaryconverters/culinary-conversion-docs](https://github.com/culinaryconverters/culinary-conversion-docs) (Jan 2026), key densities (g/ml):

| Ingredient                 | Density (g/ml) | Weight of 1 Cup |
| -------------------------- | -------------- | --------------- |
| Water                      | 1.00           | ~236g           |
| All-Purpose Flour (sifted) | 0.46           | ~109g           |
| All-Purpose Flour (packed) | 0.65           | ~155g           |
| Granulated Sugar           | 0.85           | ~200g           |
| Honey                      | 1.42           | ~335g           |

**Key insight**: Flour density varies by 40% depending on sifting. This means volume→mass conversion for dry ingredients is inherently approximate. The system should communicate this uncertainty to users.

---

## RQ-6: Ingredient Aggregation Algorithm

### The Aggregation Pipeline

Based on analysis of open-source implementations (RecipeSage, cooklang-parser, meal-planner libraries) and the TandoorRecipes bug report, the canonical aggregation pipeline is:

```
Input: [MealPlanEntry] (from 006)
  ↓
1. EXPAND: For each meal plan entry, fetch recipe → recipe_ingredients
2. SCALE: Adjust quantities by servings_override / recipe.default_servings
3. PARSE: Parse ingredient strings → { name, quantity, unit, notes }
4. NORMALIZE: Normalize unit strings (cups → cup, tbsps → tablespoon)
5. CANONICALIZE: Normalize ingredient names (lowercase, trim, remove articles)
6. GROUP: Group by (canonical_name, unit_type)  ← same-type grouping
7. CONVERT: Within each group, convert all quantities to base unit (ml for volume, g for mass)
8. SUM: Sum quantities within each group
9. FORMAT: Convert base unit back to user-preferred display unit
10. CATEGORIZE: Assign store category (Produce, Dairy, Pantry, etc.)
Output: [GroceryListItem]
```

### Cross-Recipe Aggregation: The `cooklang-parser` Approach

The `cooklang-parser` TypeScript library ([tmlmt/cooklang-parser](https://github.com/tmlmt/cooklang-parser), PR #99, Feb 2026) recently refactored its `ShoppingList` class to handle cross-recipe aggregation more accurately:

> "This PR refactors the ShoppingList class to use a new approach for ingredient quantity aggregation across recipes. It introduces a new `getRawQuantityGroups()` method in Recipe that returns unprocessed quantities, allowing for more accurate merging of complex quantity structures."

The key insight: **collect all raw quantities first, then process them together in a single pass** — rather than processing per-recipe and then merging. This avoids precision loss from intermediate rounding.

### Deduplication Strategy

**Same name + same unit** (easy case):

```
"2 cups flour" + "1 cup flour" → "3 cups flour"
```

Implementation: normalize unit string → group by `(canonical_name, normalized_unit)` → sum quantities.

**Same name + different unit, same type** (medium case):

```
"2 cups milk" + "500ml milk" → convert both to ml → "972.176ml milk" → display as "~1 liter milk"
```

Implementation: convert to base unit (ml for volume, g for mass) → sum → convert back to "best" display unit.

**Same name + different unit type** (hard case — requires density):

```
"2 cups flour" + "100g flour" → requires density lookup → approximate
```

Implementation (Phase 2): look up ingredient density from USDA FDC → convert volume to mass → sum in grams.

**Different name, same ingredient** (very hard — NLP):

```
"all-purpose flour" vs "AP flour" vs "plain flour"
```

Implementation: out of scope for MVP. Use exact canonical name matching. Consider fuzzy matching (Levenshtein distance ≤ 2) as a Phase 2 enhancement.

### Ingredient Name Canonicalization

```typescript
function canonicalizeName(name: string): string {
    return (
        name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            // Remove leading articles
            .replace(/^(a|an|the)\s+/i, '')
            // Remove trailing qualifiers in parentheses
            .replace(/\s*\([^)]*\)\s*$/, '')
            // Normalize common synonyms
            .replace(/\ball[- ]purpose\b/i, 'all-purpose')
            .replace(/\bap\b/i, 'all-purpose')
    );
}
```

---

## RQ-7: How 007 Consumes Meal Plan Data from 006

### 006 Data Model (from spec.md)

Feature 006 defines a **Meal Plan** as "a collection of meal slots organized by date and meal type (breakfast, lunch, dinner, snack). Spans a configurable date range."

The key entities from 006 that 007 consumes:

```typescript
// From 006
interface MealPlan {
    id: string;
    userId: string;
    startDate: Date;
    endDate: Date;
    slots: MealSlot[];
}

interface MealSlot {
    id: string;
    mealPlanId: string;
    date: Date;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    recipeId: string;
    servingsOverride?: number; // overrides recipe.defaultServings
}
```

### 007 Consumption Pattern

007 queries 006's data via a NestJS service-to-service call (same monolith, different modules):

```typescript
// In GroceryListService (007)
async generateFromMealPlan(
  mealPlanId: string,
  userId: string,
  options?: { dateRange?: { start: Date; end: Date } }
): Promise<GroceryList> {
  // 1. Fetch meal plan slots (via MealPlanService from 006)
  const slots = await this.mealPlanService.getSlotsWithRecipes(
    mealPlanId,
    userId,
    options?.dateRange
  );

  // 2. Expand each slot → recipe_ingredients (via RecipeService from 001)
  const allIngredients = await Promise.all(
    slots.map(slot =>
      this.recipeService.getIngredients(slot.recipeId).then(ingredients =>
        ingredients.map(ing => scaleIngredient(ing, slot.servingsOverride, slot.recipe.defaultServings))
      )
    )
  );

  // 3. Aggregate
  return this.aggregateIngredients(allIngredients.flat());
}
```

### Module Dependency Graph

```
007-GroceryListModule
  ├── imports: MealPlanModule (006)   ← getSlotsWithRecipes()
  ├── imports: RecipeModule (001)     ← getIngredients(), getRecipe()
  ├── imports: FoodDataModule (003)   ← getIngredientDensity() [Phase 2]
  └── imports: SubscriptionModule (010) ← isFeatureEnabled('online-ordering')
```

**NestJS pattern**: Use `forwardRef()` if circular dependencies arise between 006 and 007. Prefer unidirectional dependency: 007 depends on 006, not vice versa. 006 already declares 007 as a "Downstream" dependency in its spec.

---

## RQ-8: Data Model — `grocery_list_items` vs `recipe_ingredients`

### `recipe_ingredients` (from 001)

Stores the raw ingredient data as authored in a recipe:

```sql
CREATE TABLE recipe_ingredients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id     UUID REFERENCES foods(id),  -- nullable; links to USDA FDC (003)
  name        TEXT NOT NULL,              -- raw string: "all-purpose flour"
  quantity    NUMERIC,                    -- 2.5
  unit        TEXT,                       -- "cups"
  notes       TEXT,                       -- "sifted"
  sort_order  INTEGER NOT NULL DEFAULT 0
);
```

### `grocery_lists` and `grocery_list_items` (new in 007)

```sql
CREATE TABLE grocery_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_plan_id    UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'ordered' | 'completed' | 'archived'
  date_range_start DATE,
  date_range_end   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE grocery_list_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grocery_list_id     UUID NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  food_id             UUID REFERENCES foods(id),   -- nullable; from USDA FDC (003)
  canonical_name      TEXT NOT NULL,               -- normalized: "all-purpose flour"
  display_name        TEXT NOT NULL,               -- user-facing: "All-Purpose Flour"
  quantity            NUMERIC,                     -- aggregated: 3.5
  unit                TEXT,                        -- normalized: "cup"
  unit_type           TEXT,                        -- 'volume' | 'mass' | 'count' | 'unknown'
  store_category      TEXT,                        -- 'Produce' | 'Dairy' | 'Pantry' | etc.
  is_checked          BOOLEAN NOT NULL DEFAULT false,
  is_pantry_item      BOOLEAN NOT NULL DEFAULT false,  -- user marks "already have"
  source_recipe_ids   UUID[] NOT NULL DEFAULT '{}',    -- which recipes contributed
  notes               TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track which recipe_ingredients contributed to each grocery_list_item
CREATE TABLE grocery_list_item_sources (
  grocery_list_item_id  UUID NOT NULL REFERENCES grocery_list_items(id) ON DELETE CASCADE,
  recipe_ingredient_id  UUID NOT NULL REFERENCES recipe_ingredients(id) ON DELETE CASCADE,
  meal_slot_id          UUID NOT NULL REFERENCES meal_slots(id) ON DELETE CASCADE,
  contributed_quantity  NUMERIC,
  contributed_unit      TEXT,
  PRIMARY KEY (grocery_list_item_id, recipe_ingredient_id, meal_slot_id)
);
```

### Key Differences from `recipe_ingredients`

| Aspect               | `recipe_ingredients`                  | `grocery_list_items`                          |
| -------------------- | ------------------------------------- | --------------------------------------------- |
| Scope                | Single recipe, single ingredient line | Aggregated across multiple recipes/meal slots |
| Quantity             | As authored (e.g., "2 cups")          | Summed and normalized (e.g., "3.5 cups")      |
| Name                 | Raw string (may vary per recipe)      | Canonical + display name                      |
| Mutability           | Immutable (recipe source of truth)    | User-editable (check off, mark pantry)        |
| Ordering integration | N/A                                   | Maps to Instacart `line_items`                |
| Source tracking      | N/A                                   | `source_recipe_ids` + junction table          |

---

## RQ-9: Unit Conversion Utility — Shared Across 003, 006, 007

### Placement in Monorepo

The unit conversion utility should live in a **shared package** to avoid duplication across features:

```
packages/
  libs/
    culinary-units/          ← new shared package
      src/
        parse.ts             ← wraps parse-ingredient
        convert.ts           ← unit conversion (volume↔volume, mass↔mass)
        aggregate.ts         ← ingredient aggregation pipeline
        canonicalize.ts      ← name normalization
        categories.ts        ← store category assignment
      package.json           ← @kitchensink/culinary-units
```

### API Design

```typescript
// @kitchensink/culinary-units

export interface ParsedIngredient {
    name: string;
    canonicalName: string;
    quantity: number | null;
    unit: string | null;
    unitType: 'volume' | 'mass' | 'count' | 'unknown';
    baseQuantity: number | null; // quantity in base unit (ml or g)
    baseUnit: 'ml' | 'g' | null;
    notes: string | null;
}

// Parse a raw ingredient string
export function parseIngredientString(raw: string): ParsedIngredient;

// Convert quantity between compatible units (returns null if incompatible)
export function convertCulinaryUnit(
    quantity: number,
    fromUnit: string,
    toUnit: string,
    system?: 'us' | 'imperial' | 'metric',
): number | null;

// Aggregate a list of parsed ingredients (same-type units only)
export function aggregateIngredients(ingredients: ParsedIngredient[]): ParsedIngredient[];

// Assign store category to an ingredient name
export function assignStoreCategory(canonicalName: string): StoreCategory;

export type StoreCategory =
    | 'Produce'
    | 'Dairy & Eggs'
    | 'Meat & Seafood'
    | 'Bakery'
    | 'Pantry'
    | 'Frozen'
    | 'Beverages'
    | 'Condiments & Sauces'
    | 'Spices & Seasonings'
    | 'Other';
```

### Usage by Feature

| Feature | Usage                                                                |
| ------- | -------------------------------------------------------------------- |
| 003     | `parseIngredientString` for USDA FDC lookup normalization            |
| 006     | `parseIngredientString` + `convertCulinaryUnit` for nutritional sums |
| 007     | Full pipeline: parse → convert → aggregate → categorize              |

### Implementation Notes

- **Wrap `parse-ingredient`** (v2.1.0) for parsing and unit conversion — do not reimplement.
- **Wrap `@magrinj/parse-ingredients`** `combine()` for same-unit aggregation.
- **Custom density table** for volume→mass (Phase 2), seeded from USDA FDC portion data.
- **Store category assignment**: keyword-based lookup table (e.g., "flour" → Pantry, "milk" → Dairy & Eggs, "chicken" → Meat & Seafood). Fallback: "Other".

---

## Decisions & Recommendations

| #   | Decision                                                                      | Rationale                                                                                                                            |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | **Instacart IDP as sole online ordering integration**                         | Only viable public consumer grocery ordering API. Covers Walmart, Costco, Kroger, and ~1,400 other retailers via redirect model.     |
| D-2 | **No direct Walmart or Amazon Fresh integration**                             | No public consumer ordering APIs exist. Instacart covers both as retailers.                                                          |
| D-3 | **`parse-ingredient` (npm) as unit parsing/conversion library**               | TypeScript-native, actively maintained (v2.1.0 Feb 2026), handles mixed fractions, supports `convertUnit` for same-type conversions. |
| D-4 | **Phase 1: same-unit aggregation only; Phase 2: cross-unit via USDA density** | Cross-unit aggregation requires density data from 003. Decouple MVP from 003 dependency.                                             |
| D-5 | **`@kitchensink/culinary-units` shared package**                              | Unit conversion logic is needed by 003, 006, and 007. Shared package prevents duplication and ensures consistency.                   |
| D-6 | **Instacart redirect model (not embedded checkout)**                          | IDP is B2C redirect-only. Embedded checkout requires retailer-level Connect API access (not available to developer partners).        |
| D-7 | **`grocery_list_item_sources` junction table**                                | Enables "which recipes need this?" UX — users can see that "3 cups flour" comes from Recipe A (2 cups) + Recipe B (1 cup).           |
| D-8 | **Store category assignment via keyword lookup**                              | Sufficient for MVP. USDA FDC food category data (from 003) can improve accuracy in Phase 2.                                          |

---

## Open Questions

| #    | Question                                                                             | Impact                                                             | Owner    |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| OQ-1 | Should grocery lists be shareable/collaborative (like AnyList)?                      | Affects data model (shared ownership), real-time sync requirements | Product  |
| OQ-2 | Should the system support multiple simultaneous grocery lists (e.g., one per store)? | Affects `grocery_lists` schema and UI                              | Product  |
| OQ-3 | Instacart affiliate commission — does the business want to pursue this?              | Requires live integration approval (~30–40 days)                   | Business |
| OQ-4 | Should pantry tracking be a separate feature (008+) or part of 007?                  | Affects scope of `is_pantry_item` flag                             | Product  |
| OQ-5 | What is the target market for online ordering — US only, or US + Canada?             | Instacart IDP supports US + Canada (en-US, en-CA, fr-CA)           | Product  |

---

## References

| Source                          | URL                                                                                       | Date              |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| Instacart IDP Overview          | https://docs.instacart.com/developer_platform_api/                                        | 2026-04-29        |
| Instacart Create Shopping List  | https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/ | 2026-04-29        |
| Instacart Create Recipe Page    | https://docs.instacart.com/developer_platform_api/api/products/create_recipe_page         | 2026-04-29        |
| Instacart MCP Integration       | https://docs.instacart.com/developer_platform_api/guide/tutorials/mcp/                    | 2025-11-04        |
| Walmart Marketplace API         | https://developer.walmart.com/us-marketplace/docs/introduction-to-marketplace-apis        | 2026-01           |
| Amazon Orders API v2026-01-01   | https://developer-docs.amazon.com/sp-api/docs/orders-api                                  | 2026              |
| parse-ingredient npm            | https://www.npmjs.com/package/parse-ingredient                                            | v2.1.0, Feb 2026  |
| jakeboone02/parse-ingredient    | https://github.com/jakeboone02/parse-ingredient                                           | Apr 2026          |
| magrinj/parse-ingredients       | https://github.com/magrinj/parse-ingredients                                              | 2021              |
| TandoorRecipes issue #4457      | https://github.com/TandoorRecipes/recipes/issues/4457                                     | Feb 2026          |
| cooklang-parser PR #99          | https://github.com/tmlmt/cooklang-parser/pull/99                                          | Feb 2026          |
| culinaryconverters density docs | https://github.com/culinaryconverters/culinary-conversion-docs                            | Jan 2026          |
| Paprika App Store               | https://apps.apple.com/us/app/paprika-recipe-manager-3/id1303222868                       | 2026              |
| AnyList meal planning           | https://www.anylistapp.com/meal-planning                                                  | 2026              |
| Mealime Google Play             | https://play.google.com/store/apps/details?id=com.mealime                                 | Mar 2026          |
| RecipeSage GitHub               | https://github.com/julianpoy/recipesage                                                   | Apr 2026          |
| grocy issue #905                | https://github.com/grocy/grocy/issues/905                                                 | 2020, closed 2022 |
