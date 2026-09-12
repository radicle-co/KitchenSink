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

⛔ **No foreign key leaves `kitchensink_recipes`.** 007 lives in `@kitchensink/recipe-service` (ADR-0017), so a
reference to `recipes` or `recipe_ingredients` is a real, enforceable FK. `users` lives in the identity
database, `foods` in `kitchensink_food`, and `meal_plans` in `kitchensink_meal_plans` since 006 was extracted
on 2026-08-14 — Postgres cannot enforce a constraint against any of them, and declaring one produces a
migration that fails at deploy. This mirrors 006's **C-006-002** and **REQ-CN-003** verbatim in intent: the
owner identifier is the app-user **ULID** carried in the verified token claim, stored as `VARCHAR(255)` with
no FK and no local `users` table, exactly as `recipes.owner_id` does; every other out-of-database reference is
a bare id resolved over HTTP. _(Corrected 2026-08-16 — these tables previously declared four such FKs, and
`user_id UUID` was additionally the wrong TYPE for a ULID.)_

```sql
-- Grocery list (user's shopping list)
grocery_lists (
  id UUID PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL,  -- app-user ULID from the token claim; NO FK, no local users table
  meal_plan_id UUID,               -- nullable, can be standalone; 006 owns it in ANOTHER database — no FK
  name TEXT,
  status TEXT,                    -- 'draft' | 'ready' | 'ordered'
  store TEXT,                     -- 'walmart' | 'instacart' | null
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Individual line items
grocery_list_items (
  id UUID PRIMARY KEY,
  grocery_list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,  -- local: same database
  usda_fdc_id INT,                -- nullable for unmapped items; foods live in kitchensink_food — no FK
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
  owner_id VARCHAR(255) NOT NULL,  -- app-user ULID; NO FK
  usda_fdc_id INT,                 -- kitchensink_food — no FK
  quantity_g DECIMAL,
  expires_at TIMESTAMP,  -- 7 days from last update
  PRIMARY KEY (owner_id, usda_fdc_id)
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

✅ **RESOLVED (2026-08-12) — `/api/v1/grocery-lists/*` is owned by `@kitchensink/recipe-service`**, per
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md).
**No new deployable service is created for 007.**

| Role                                  | Binding for 007                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Owning service (**authors** the zod)  | `@kitchensink/recipe-service` — `packages/services/recipe-service/src/grocery-lists/*.schema.ts` |
| Schema package (generated, committed) | `@kitchensink/schema-recipe` — `packages/schemas/recipe`, **extended, never forked**             |
| Consuming client                      | `@kitchensink/recipe-service-client` — `packages/clients/recipe-service`                         |
| Consuming apps                        | `@commise/web`, `@commise/mobile`, and a `packages/apps/commise/features/*` package              |
| NestJS module (internal boundary)     | `GroceryListsModule`, a sibling of the shipped `RecipesModule` / `SearchModule`                  |
| Retailer adapters + polling           | `@kitchensink/recipe-workers` — a **worker plus scoped secrets**, deliberately **not** a service |

**The one-line reason, specific to 007**: 007's coupling to recipes is **weaker** than 006's or 009's — list
generation is a **one-shot read** of a plan and its recipes at generation time — but the genuinely separate
part, the **retailer integration, is a worker plus a set of scoped secrets, not a service**. There is nothing
left over that needs its own deployable, and a deployable costs an ECS service per stage plus one more task
per open pull request (ADR-0010 measured food's single per-PR API task at ≈ $8.25/month).

**A schema package is per SERVICE, not per feature.** 007 adds `*.schema.ts` files under
`packages/services/recipe-service/src/grocery-lists/`, beside the controller they serve, and the **existing**
generator copies them into the **existing** `@kitchensink/schema-recipe` (8 authored schema files today, a
4,945-line derived `openapi.yaml`). There is **no** `@kitchensink/schema-grocery`. 004 already set this
precedent for the recipe service — add to `packages/schemas/recipe`, never fork it.

**The NestJS module is the internal boundary, and it is mandatory now even though the service boundary is
not.** `GroceryListsModule` sits beside `RecipesModule` with its own DAL and its own `*.schema.ts` beside its
controller. A future extraction cuts at **that module edge**, and its cost is a new schema package plus a
client base-URL change — which is why the module edge cannot be skipped today.

**Flip condition (ADR-0017)**: extract `@kitchensink/grocery-service` when the retailer integration grows
**inbound** surface — a Walmart/Instacart webhook, a marketplace callback, or **per-user OAuth token storage**
at a volume that wants its own secret rotation and its own blast radius.

✅ **Repoint EXECUTED — `tasks.md` agrees with this section.** It formerly named
`packages/services/grocery-service/**` throughout (57 occurrences); commit `b9221bb3` (2026-08-12) — the **same
commit that ratified ADR-0017 and amended this plan** — repointed every one of them, changing that file by 183
insertions / 82 deletions (the 57 is counted against the pre-repoint revision, `b9221bb3^`). Each now reads
`packages/services/recipe-service/src/grocery-lists/**`, with the retailer adapters and the order-status polling
under `packages/services/recipe-workers/src/grocery/**`, and the file carries its own `Was → Now` mapping table.
Measured 2026-08-12: the **8** `grocery-service` strings left in it are all historical record (the mapping
table's `Was` column, its count statement, one superseded-task note, and ADR-0017's flip-condition package
name) — **no prescribed path** names a package that does not exist. This record is kept deliberately,
because the divergence it closes is
[GR-017 §17-e.12](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app)'s
failure mode — a plan amended while its task list is not — and a task list is where the package a contributor
actually creates gets chosen. Here the two moved together, in one commit; keep them that way.

**`@kitchensink/recipe-service` MUST** author every grocery-list, item, pantry-flag and order request/response
shape as **zod in the service** at `src/grocery-lists/*.schema.ts` beside its controller; **validate its own
requests with that same zod** via `nestjs-zod`'s `createZodDto`; extend the committed
`@kitchensink/schema-recipe`, which exports the zod, `z.infer` types, `contractHash.ts`, a barrel and a
**derived** `openapi.yaml` (outbound only — never a codegen input); and keep every `*.schema.ts` importing
**only `zod` and other `*.schema.ts` files**.

**Every client MUST** — separately mandatory, because mandating only the service half is exactly how the
client half got skipped portfolio-wide:

- Import its wire **types and zod** from `@kitchensink/schema-recipe`, and **declare no grocery-list request
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
the `status` enum in the response below are **ours** — 007 authors them as zod in `@kitchensink/recipe-service`.
What comes back from the retailer is not.

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

### 3.0a Input validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. ✅ **§3.0 now names the owner** —
`@kitchensink/recipe-service` (ADR-0017) — so every obligation below binds a package that exists.

- **One mechanism, one `400`.** Every grocery-list, item, pantry-flag and order input — body, path params
  (`{id}`, `{itemId}`), query params — is parsed by `@kitchensink/recipe-service`'s own `*.schema.ts` zod via
  `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. One mechanism, and one `400` path that names the
  offending field. 007 adds **no** `class-validator` DTO to the 19 files still being removed from that service
  (re-measured 2026-08-12).
- **⛔ THE FLOOR.** Every input field writing a bounded column is validated at least as strictly as the column
  can store. Naming 007's actual bounded columns from §2 rather than gesturing at them:
  `grocery_list_items.usda_fdc_id` and `sort_order` are `INT` (`int4`, ceiling **2,147,483,647**);
  `grocery_list_items.quantity_g` and `user_pantry_items.quantity_g` are `DECIMAL` **with no declared
  `(p,s)`** — ⚠️ **the precision and scale must be declared before either can be a floor at all**, because
  bare `numeric` in PostgreSQL is effectively unbounded and yields nothing to assert against; and `status`,
  `store` and `category` are **enum-by-comment `TEXT`**, so their domain is a product decision that must be
  written into the zod, since the column enforces nothing. A quantity the column cannot hold is a `400` at the
  boundary, never a failed `INSERT`.
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type in a `*.schema.ts`.
    - ⚠️ A `grocery_lists.name` writing an unbounded `text()` column has **no storage floor** — its limit is a
      product decision 007 owns.
    - ✅ **OPEN-GR-016-A is CLOSED (ruled 2026-08-12, GR-017 §17-d):**
      the floor is enforced by a **per-service boundary-parity test**, not a review checklist. It lives in
      `@kitchensink/recipe-service`; it **may import both** the Drizzle schema and the authored zod, because
      **a test is not a wire schema**; it **derives** the bounded-column enumeration from the Drizzle schema
      rather than typing it out; and it asserts the field→column mapping complete **in both directions** —
      every bounded column has an entry or a reasoned exemption, and every entry names a column that exists.
      Without the second direction the test silently shrinks to the fields someone remembered and stays green.
- **⚠️ The ORDER path spends real money, so its input bounds are a financial control.** `POST
/api/v1/grocery-lists/{id}/order` and its quantities are validated at the boundary before any retailer call:
  an unbounded quantity, a duplicated item, or an out-of-enum store is rejected here rather than becoming a
  cart. This is the same reasoning §15-d gives for parsing the retailer's **responses** — applied to the
  request we send.
- **✅ The Walmart/Instacart boundary parse is REQUIRED by GR-016, not merely permitted by §15-d.** Order-status
  polling is the sharpest case, exactly as §15-d says: an unvalidated status string decides whether we tell a
  user their groceries are coming. Nothing in GR-016 licenses converging those adapter schemas away.
- **Non-HTTP ingress is in scope, and 007 has two named ones.** (1) The **`@Cron` pantry-expiry prune** implied
  by `user_pantry_items.expires_at` and its 7-day TTL (§8 _Resolved Questions_ 6; its acceptance criterion
  already says "expired items pruned on `@Cron` schedule"), and (2) the **order-status polling** loop that
  reads each retailer (§8 _Resolved Questions_ 2 — **polling, not webhooks**). A scheduled invocation still
  parses its own event, because "the payload is ours" is an assumption about a deploy that has already drifted
  once. Both run in `@kitchensink/recipe-workers`, not in the API process (ADR-0017 decision 5).
    - ⚠️ **No retailer webhook exists today** — 007 chose polling deliberately. **If one is ever added**, it
      gets **signature THEN schema**, in that order, never one instead of the other: a signature proves
      **origin, not shape** (GR-016 §16-b). And per
      [GR-018 §18-c](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) a
      signature-verifying third-party sender that retries on any non-2xx is answered **`2xx`** with the
      rejection recorded in the body, the logs, a per-`reason` counter and an alarm — the retailer's shape
      failure and its signature failure are **equally invalid** and differ only in `reason`.
- **007 is a CLIENT of our other services**, both directions: outbound bodies validated against
  `@kitchensink/schema-recipe` / `@kitchensink/schema-food` before the call, responses validated on receipt.
- ✅ **Unknown keys — OPEN-GR-016-B is CLOSED (ruled 2026-08-12, GR-017 §17-c):**
  **`z.strictObject()` is the portfolio default for every mutating request body**, so 007's `POST`/`PUT`/`DELETE`
  bodies reject unknown keys. Plain `z.object()` is permitted only with a **documented forward-compatibility
  reason at the schema**, which in practice means a **read** surface. `PUT /api/v1/grocery-lists/{id}` (mark
  have/need) is the case the ruling protects — a silently stripped key returns `200` for a check-off that did
  not persist, on a screen the user is standing in a shop reading. ⚠️ **The retailer's inbound bodies are the
  opposite case and are NOT covered by this default**: they are Walmart's and Instacart's shapes, they gain
  fields without telling us, and their boundary schemas tolerate unknown keys **deliberately** (§15-d).
- **⛔ Response validation is DEFERRED (GR-016 §16-g)** for our own responses. The retailer-side parse above is
  **input** to us and is unaffected by that deferral.

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
