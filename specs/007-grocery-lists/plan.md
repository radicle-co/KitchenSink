# Technical Plan: Feature 007 — Grocery Lists & Online Ordering

**Feature**: `007-grocery-lists`
**Status**: Pre-handoff (open questions resolved 2026-05-10 — see Section 8)

---

## 1. Architecture Overview

### System Context

```
[Meal Plan (006)]  ──────────────────────────────────────────────────────────┐
                                                                              │
[Shopping Lists Page (standalone)]  ─────────────────────────────────────────┤
                                                                              ▼
                                                              Generate Grocery List
                                                                              │
                                                    Aggregate Ingredients (from 001 recipe_ingredients via 003 USDA data)
                                                                              │
                                                    Deduplicate + Normalize Units (shared culinary-units utility)
                                                                              │
                                                    Pantry Subtraction (user's "already have" items)
                                                                              │
                                                    Store Mapping (Walmart adapter first; Instacart adapter second — both behind feature flag)
                                                                              │
                                                    Online Ordering (premium — via 010 subscriptions gating; polling for status)
```

**Cross-links**: A grocery list stores a nullable `meal_plan_id`. The meal plan view queries for associated lists. The grocery list view shows a back-link to the meal plan when `meal_plan_id` is set.

### Key Technical Challenges

1. **Unit normalization**: "2 cups flour" + "100g flour" = ~315g flour (need density data for cross-type conversion)
2. **Deduplication**: Same ingredient from multiple recipes → single aggregated line
3. **Store mapping**: Each store uses different SKUs — USDA FDID → store SKU is many-to-many

---

## 2. Data Model

### Core Tables

```sql
-- Grocery list (user's shopping list)
grocery_lists (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  meal_plan_id UUID REFERENCES meal_plans(id),  -- nullable, can be standalone
  name TEXT,
  status TEXT,                    -- 'draft' | 'ready' | 'ordered'
  store TEXT,                     -- 'walmart' | 'instacart' | null
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Individual line items
grocery_list_items (
  id UUID PRIMARY KEY,
  grocery_list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,
  usda_fdc_id INT REFERENCES foods(fdc_id),  -- nullable for unmapped items
  display_name TEXT,              -- "Yellow onion, raw"
  quantity_g DECIMAL,             -- normalized to grams (or mL for liquids)
  unit_display TEXT,               -- original unit for display ("2 cups")
  category TEXT,                   -- 'produce' | 'dairy' | 'meat' | 'bakery' | etc.
  is_pantry BOOLEAN DEFAULT false, -- "already have" / excluded
  is_ordered BOOLEAN DEFAULT false,
  store_sku JSONB,                -- { "walmart": "SKU123", "instacart": null }
  sort_order INT
)

-- User pantry (persisted "already have" items, expires after 7 days)
user_pantry_items (
  user_id UUID,
  usda_fdc_id INT,
  quantity_g DECIMAL,
  expires_at TIMESTAMP,  -- 7 days from last update
  PRIMARY KEY (user_id, usda_fdc_id)
)
```

### Aggregation Pipeline

```typescript
interface IngredientAggregator {
  // Input: recipe_ingredients from multiple recipes (via 001)
  // Output: deduplicated, normalized grocery items

  aggregate(ingredients: RecipeIngredient[]): GroceryListItem[];
  normalizeUnit(quantity: number, unit: string, foodType: FoodType): grams: number;
  deduplicate(items: GroceryListItem[]): GroceryListItem[];
}
```

---

## 3. API Contracts

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

🟠 **OPEN — which service owns `/api/v1/grocery-lists/*`?** This plan does not say, and it is not derivable
from §15 or any existing ADR. **Question for the owner: `@kitchensink/recipe-service`, or a new
`@kitchensink/grocery-service`?** The answer picks the schema package name, so nothing below names it. **The
obligation binds whichever service ends up owning the paths.**

**The owning service MUST** author every grocery-list, item, pantry-flag and order request/response shape as
**zod in that service** at `src/**/*.schema.ts` beside its controller; **validate its own requests with that
same zod** via `nestjs-zod`'s `createZodDto`; generate and commit `packages/schemas/<service>` exporting the
zod, `z.infer` types, `contract-hash.ts`, a barrel and a **derived** `openapi.yaml` (outbound only — never a
codegen input); and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the
client half got skipped portfolio-wide:

- Import its wire **types and zod** from that service's schema package, and **declare no grocery-list request
  or response body type of its own** — including in `@commise/web`, `@commise/mobile` and feature packages
  (GR-015 §15-b.4).
- **Derive** any divergent consumer shape with `Pick` / `Omit` / `Partial`. The check-off list view model and
  the aisle-grouped projection are derivations of the item wire type, never parallel interfaces. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **007 is also a CLIENT of our other services**, bound identically: recipe/ingredient reads via
  `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`, and food data via
  `@kitchensink/food-service-client` → `@kitchensink/schema-food`. 007 declares no 001 or 003 wire type.
- **A new endpoint is not complete until its types are reachable from the schema package.**

**Drift gates** — inherited from GR-015 §15-c, all three required: turbo `inputs` rebuild, the
regenerate-and-diff CI gate, and the `CONTRACT_HASH` boot assertion.

⚠️ **`storeMapping` is NOT a wire type we may invent from a retailer's shape.** The `storeMapping` field and
the `status` enum in the response below are **ours** — 007 authors them as zod in the owning service. What
comes back from the retailer is not.

### ⛔ THE EXCEPTION — Walmart and Instacart are third-party APIs. NEVER converge them. (GR-015 §15-d)

**We do not serve the retailer APIs.** There is no service of ours to own their types, and their contracts
change without telling us. So §5 _Store Integration_'s adapters are governed by §15-d, not §15-b:

- The **Walmart adapter** and the **Instacart adapter** MUST **validate the raw upstream wire shape at the
  boundary with zod**, the moment a body arrives — product/SKU lookups, cart creation, order placement, and
  order-status polling alike.
- Those adapters **MAY declare their own types**, and the normalized shape they hand back (our `storeMapping`,
  our `status` enum) **deliberately differs** from the raw retailer payload. That difference is the
  normalization, not drift.
- **No OpenAPI document is written for Walmart or Instacart**, and their shapes are **not** folded into our
  schema package as though we owned them. Instacart's `/idp/api/v1/products/*` is likewise **exempt from
  GR-002** — it is their URL, not ours.
- `packages/clients/usda` is the reference implementation; its `schemas.ts` must never be "converged".
- **Deleting a retailer boundary schema under §15-b is a security regression**, not a cleanup: this path
  spends real money on a user's behalf, and the parse is what stands between a retailer's JSON and an order
  request. Order-status polling is the sharpest case — an unvalidated status string decides whether we tell a
  user their groceries are coming.

### Endpoints

| Method | Path                                               | Auth     | Description                     |
| ------ | -------------------------------------------------- | -------- | ------------------------------- |
| POST   | `/api/v1/grocery-lists`                            | Required | Generate from meal plan         |
| GET    | `/api/v1/grocery-lists`                            | Required | List user's grocery lists       |
| GET    | `/api/v1/grocery-lists/{id}`                       | Required | Get list with items             |
| PUT    | `/api/v1/grocery-lists/{id}`                       | Required | Update items (mark have/need)   |
| DELETE | `/api/v1/grocery-lists/{id}`                       | Required | Delete list                     |
| POST   | `/api/v1/grocery-lists/{id}/items/{itemId}/pantry` | Required | Mark item as "in pantry"        |
| DELETE | `/api/v1/grocery-lists/{id}/items/{itemId}/pantry` | Required | Remove pantry flag              |
| POST   | `/api/v1/grocery-lists/{id}/order`                 | Required | Initiate online order (premium) |
| GET    | `/api/v1/grocery-lists/{id}/order-status`          | Required | Poll order status               |

### Request/Response Shapes

```typescript
// POST /api/v1/grocery-lists
Request:
{
  "mealPlanId": "mp_abc123",  // optional — can be empty list
  "name": "Week of May 12",
  "store": "walmart"  // optional, for premium ordering
}

Response:
{
  "groceryListId": "gl_xyz",
  "items": [
    {
      "id": "gli_001",
      "displayName": "Yellow onion, raw",
      "quantityDisplay": "3 cups + 1 tbsp",
      "quantityGrams": 315,
      "category": "produce",
      "isPantry": false,
      "storeMapping": { "walmart": "409999", "instacart": null },
      "status": "available"  // "available" | "unmapped" | "not_found"
    },
    ...
  ],
  "summary": {
    "totalItems": 28,
    "pantryItems": 4,
    "toOrderItems": 24,
    "estimatedTotal": "$47.82"
  }
}
```

---

## 4. Unit Conversion Utility

Shared across 003, 006, 007. Placed in `packages/shared/`:

```typescript
// packages/shared/culinary-units/src/index.ts

interface UnitConversion {
    // Parse "2 cups", "1/2 tsp", "400g" → { quantity: number, unit: string }
    parse(ingredientString: string): ParsedIngredient;

    // Convert to base unit (mL for volume, g for mass, count for items)
    toBaseUnit(quantity: number, unit: string): BaseQuantity;

    // Convert back to grocery-friendly display
    toDisplayUnit(grams: number, foodType: FoodType): string; // "1 lb 2 oz" or "500g"
}

const VOLUME_UNITS = ['tsp', 'tbsp', 'cup', 'floz', 'ml', 'l'];
const MASS_UNITS = ['oz', 'lb', 'g', 'kg'];
const COUNT_UNITS = ['clove', 'whole', 'slice', 'piece'];

// Density map for volume↔mass (water = 1g/mL as default, overridden per food)
const DENSITY_MAP: Record<string, number> = {
    water: 1.0,
    flour: 0.53, // 1 cup flour ≈ 125g (not 237mL × 1)
    sugar: 0.85,
    butter: 0.91,
    olive_oil: 0.92,
    milk: 1.03,
    // ... extend per research
};
```

---

## 5. Store Integration (Premium via 010)

### Walmart Open API

```typescript
// Product search → map ingredient to Walmart SKU
interface WalmartMapping {
    searchByIngredient(query: string, fdcId: number): Promise<WalmartProduct | null>;
    createCart(items: WalmartCartItem[]): Promise<CartId>;
    checkout(cartId: string): { checkoutUrl: string };
}
```

### Instacart Connect API

```typescript
// OAuth 2.0 — Instacart Connect Developer Platform
interface InstacartMapping {
    oauthAuthorize(): string; // redirect to Instacart OAuth
    searchProducts(query: string, fdcId: number): Promise<InstacartProduct | null>;
    createOrder(items: InstacartItem[]): Promise<OrderId>;
}
```

### Product Mapping Table

```sql
-- Local mapping: USDA FDID → store SKUs
grocery_product_map (
  usda_fdc_id INT PRIMARY KEY,
  walmart_sku TEXT,
  walmart_price DECIMAL,
  instacart_product_id TEXT,
  instacart_price DECIMAL,
  last_updated TIMESTAMP
)
```

---

## 6. Resilience & External Services

- **Walmart API**: 10s timeout, circuit breaker (5 failures → 60s open)
- **Instacart API**: OAuth token refresh, 10s timeout
- **Store API failure**: If mapping fails, show "unmapped" status, user selects manually
- **Never lose list**: Grocery list saved to PostgreSQL before attempting store API

---

## 7. Migration / Schema Changes

```sql
-- Migration for 007 grocery-lists
CREATE TABLE grocery_lists (...);
CREATE TABLE grocery_list_items (...);
CREATE TABLE user_pantry_items (...);
CREATE TABLE grocery_product_map (...);

CREATE INDEX idx_grocery_lists_user_id ON grocery_lists(user_id);
CREATE INDEX idx_grocery_lists_meal_plan_id ON grocery_lists(meal_plan_id);
CREATE INDEX idx_grocery_list_items_list_id ON grocery_list_items(grocery_list_id);
CREATE INDEX idx_grocery_list_items_fdc_id ON grocery_list_items(usda_fdc_id);
CREATE INDEX idx_user_pantry_user ON user_pantry_items(user_id);
```

---

## 8. Resolved Questions

The following questions were open in earlier drafts. Decisions are recorded here for engineering handoff.

### 1. Store integration sequencing: Walmart first

**Decision**: Build the Walmart adapter first. Instacart second.

**Rationale**: Walmart's Affiliate/Open API is publicly documented and uses a simple API key. Instacart Connect requires a partner agreement that is not yet in place. Both adapters are built behind a `STORE_INTEGRATION_ENABLED` feature flag so neither ships to users until the integration is validated. The task ordering in `tasks.md` reflects this: T-013..T-015 (Walmart) before T-016..T-018 (Instacart).

**Honest status**: No partner API access is confirmed at spec time. Tasks that implement store clients are labeled accordingly and must not be marked complete until a real API key or sandbox credential is available for integration testing.

### 2. Order status mechanism: polling, not webhooks

**Decision**: Client-driven polling at 30-second intervals via `GET /api/v1/grocery-lists/:id/order-status`. The server caches the last-known status for 30 seconds to avoid hammering the store API.

**Rationale**: Neither Walmart nor Instacart guarantees webhook delivery in their publicly documented APIs. Polling is simpler to implement, test without a live integration, and degrade gracefully. When a partner agreement is in place and webhook delivery is confirmed, this decision is revisited.

**Status values** (honest labels — not all states are reachable without a live integration):

| Value         | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `pending`     | Order submitted to store API; awaiting confirmation                 |
| `confirmed`   | Store API acknowledged the order                                    |
| `in_progress` | Store is picking/packing (if store API provides this signal)        |
| `delivered`   | Store reports delivery complete (if store API provides this signal) |
| `failed`      | Store API returned an error or timed out                            |
| `unavailable` | Store integration not active; status cannot be retrieved            |

States `in_progress` and `delivered` are only reachable if the store API provides those signals. The UI must not display them as guaranteed.

### 3. Store API outage behavior

**Decision**: The grocery list is always persisted to PostgreSQL before any store API call is attempted. If the store API is unreachable or returns an error:

- The list status remains `ready` (not `ordered`).
- The API returns a 502 with `{ error: 'STORE_UNAVAILABLE', message: 'Store unavailable — your list is saved. Try again later.' }`.
- The UI shows the error message and a retry button. The list is not corrupted.
- Circuit breaker (5 consecutive failures → 60s open) prevents cascading calls.

### 4. Dedicated Shopping Lists page

**Decision**: A dedicated `/shopping-lists` route exists in both web and mobile. Users can reach it from the main navigation without going through a meal plan. From this page they can:

- View all their grocery lists (paginated, sorted by `created_at DESC`).
- Create a new standalone list (no meal plan).
- Generate a list from a meal plan by selecting one from a picker.

This is captured as FR-032 in `spec.md` and T-039 in `tasks.md`.

### 5. Meal plan / shopping list cross-linking

**Decision**: `grocery_lists.meal_plan_id` is nullable. When set:

- The grocery list view shows a "From meal plan: [name]" link that navigates to the meal plan.
- The meal plan view (feature 006) shows a "Grocery Lists" section listing associated lists by name and date.
- If the meal plan is deleted, `meal_plan_id` is set to NULL via `ON DELETE SET NULL` and the list shows "Meal plan no longer available."

The 006 meal plan view change is a cross-feature UI task. It is documented here and in T-040 so the 006 team is aware of the dependency.

### 6. Pantry TTL: 7 days standard; "always exclude" deferred

**Decision**: 7-day TTL is the MVP default. A persistent "always exclude" pantry option is deferred to a post-MVP iteration. Power users can work around this by re-marking items after TTL expiry.

### 7. Recipe scaling

**Decision**: Grocery list generation respects the serving multiplier stored on each `meal_plan_recipe` row (from feature 006). If 006 does not yet expose a serving multiplier, the list defaults to the recipe's base serving count. This is a dependency on 006's data model and must be confirmed during integration.

---

## 9. Implementation Order

1. **DB migration + Drizzle schema** — all four tables including `meal_plan_id` nullable FK
2. **Unit conversion utility** — shared across 003, 006, 007
3. **Aggregation algorithm** — deduplicate by USDA FDID; respect serving multiplier from 006
4. **Pantry integration** — add/remove pantry items, 7-day TTL
5. **Core API endpoints** — generate, list, get, update, delete, pantry mark/unmark
6. **Dedicated Shopping Lists page** — web (`/shopping-lists`) and mobile equivalent
7. **Meal plan cross-links** — grocery list → meal plan back-link; meal plan → grocery lists list
8. **Walmart adapter** — behind feature flag; requires API key in env
9. **Instacart adapter** — behind feature flag; requires partner agreement and OAuth credentials
10. **Online ordering endpoints** — premium via 010 gating; polling for status
11. **Web UI** — grocery list page, pantry toggle, store connection, ordering UI
12. **Mobile UI** — equivalent screens for all web UI tasks
13. **Tests** — unit, integration, E2E, performance
