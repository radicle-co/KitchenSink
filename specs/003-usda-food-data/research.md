# Research: Feature 003 — USDA Food Data Integration

> **⚠️ SUPERSEDED (doc-stabilization 2026-06-28).** This root research note is a historical
> point-in-time record. Its pre-design framing (`ingredients` + `usda_fdc_id`, "cache hit/miss",
> `FoodRequested`→SQS, `fetch_status`) is superseded by the **source-agnostic stabilization
> baseline** — see [`decision-register.md`](./decision-register.md) (and the per-doc
> [`research/`](./research/) notes). Read with the decision register as the source of truth.

**Branch**: `003-usda-food-data` | **Date**: 2026-05-08
**Spec**: [spec.md](./spec.md) | **Status**: Complete (superseded — see banner above)

## Research Questions

| #    | Question                                                                        | Status      |
| ---- | ------------------------------------------------------------------------------- | ----------- |
| RQ-1 | How do competitor apps handle USDA data types (Foundation, SR Legacy, Branded)? | ✅ Answered |
| RQ-2 | USDA FoodData Central API: endpoints, rate limits, data format                  | ✅ Answered |
| RQ-3 | Alternative food APIs (Edamam, Nutritionix) — worth using alongside USDA?       | ✅ Answered |
| RQ-4 | Open-source TypeScript implementations of USDA FDC integration                  | ✅ Answered |
| RQ-5 | AWS Lambda + SQS caching/batching patterns for rate-limited external APIs       | ✅ Answered |
| RQ-6 | How does 003 integrate with 001's `ingredients` table and `recipe_ingredients`? | ✅ Answered |
| RQ-7 | Nutritional calculation pipeline — where does nutrient lookup happen?           | ✅ Answered |
| RQ-8 | UX patterns for ingredient/nutrient lookup in recipe building                   | ✅ Answered |

---

## RQ-1: Competitor Analysis — How Apps Handle USDA Data Types

### Cronometer

Cronometer is the most transparent about its data sourcing strategy. It uses a **tiered trust model**:

| Tier          | Source                                   | Use Case                                      |
| ------------- | ---------------------------------------- | --------------------------------------------- |
| Highest trust | NCCDB, USDA SR28 (SR Legacy), CNF, IFCDB | Lab-analyzed, comprehensive nutrient profiles |
| Mid trust     | FDC UPC (Branded Foods)                  | Exact label data for packaged foods           |
| Community     | CRDB (Cronometer curated) + Nutritionix  | Barcode scanning, branded products            |

**Key insight**: Cronometer treats Foundation/SR Legacy as the authoritative source for raw ingredients and uses Branded Foods only for packaged products. They explicitly tell users to prefer SR Legacy for "detailed information" and Branded for "exact label data." This maps directly to our use case: Foundation + SR Legacy for recipe ingredients, Branded for packaged goods.

Source: [Cronometer Data Sources](https://support.cronometer.com/hc/en-us/articles/360018239472-Data-Sources) (2026-03-09)

### Serverless Recipe Assistant (AWS Reference Architecture)

A 2026 AWS reference implementation demonstrates the canonical USDA integration pattern for Lambda:

- **Batch enrichment**: `enrich_nutrition.py` script parses ingredient lines (quantity, unit, name) via regex, looks up each in USDA using **Foundation + SR Legacy data types only** (not Branded), converts per-100g values to recipe quantities via a unit conversion table, and caches API responses locally to avoid redundant lookups.
- **Real-time lookup**: A `calculate_nutrition` Lambda tool calls USDA FDC in real time for user-submitted ingredient lists, returning a formatted markdown table with per-ingredient breakdowns.
- **Data type selection**: Foundation + SR Legacy for all ingredient lookups — Branded is excluded from the real-time path because it lacks full nutrient profiles.

Source: [Serverless Recipe Assistant](https://darryl-ruggles.cloud/serverless-recipe-assistant-with-agentcore-and-strands/) (2026-02-22)

### Open-Source Nutrition MCP (3-Tier Pattern)

The `nutrition-mcp` npm package (published March 2026) demonstrates a production-grade 3-tier lookup pattern:

```
Tier 1 (local SQLite FTS5)  →  326K+ foods from OpenNutrition dataset
Tier 2 (USDA FDC API)       →  fallback for cache misses; results cached locally
Tier 3 (web/manual)         →  future phase; manual cache_add for edge cases
```

Food IDs use prefixed namespacing: `on_abc123` (OpenNutrition), `usda_12345` (USDA), `web_xyz` (manual). This is the pattern we should adopt for our `ingredients` table.

Source: [nutrition-mcp on npm](https://registry.npmjs.org/nutrition-mcp) (2026-03-13)

### UX Patterns Observed Across Apps

1. **Autocomplete-first**: All apps use fast local search (FTS or trie) before hitting the API. Users expect sub-100ms autocomplete.
2. **Tiered display**: Show data source badge (USDA Foundation, Branded, User-entered) so users understand data quality.
3. **Pending state**: When a food is not yet in local cache, show a "pending" state and resolve asynchronously — never block the recipe save.
4. **Portion guidance**: Display `household_serving_fulltext` from USDA (e.g., "1 cup, chopped") alongside gram weights to help users pick portions.
5. **Override affordance**: Allow users to override USDA values with their own (maps to `user_calories`, `user_protein_g` etc. in `recipe_ingredients`).

---

## RQ-2: USDA FoodData Central API

### Base URL & Authentication

```
Base URL: https://api.nal.usda.gov/fdc/v1/
Auth:     ?api_key=<key>  (query param or X-Api-Key header)
Key:      Free — sign up at https://fdc.nal.usda.gov/api-key-signup
DEMO_KEY: Available for exploration; much lower rate limits
```

### Endpoints

| Endpoint        | Verb     | Purpose                                              |
| --------------- | -------- | ---------------------------------------------------- |
| `/food/{fdcId}` | GET      | Single food by FDC ID                                |
| `/foods`        | GET/POST | Batch fetch up to **20 FDC IDs** per request         |
| `/foods/list`   | GET/POST | Paged list of foods (abridged format)                |
| `/foods/search` | GET/POST | Full-text search; returns up to 200 results per page |

**Critical for our architecture**: The `/foods` batch endpoint accepts up to 20 IDs per call — this is the primary endpoint for the SQS consumer. A single SQS message should carry up to 20 `fdcIds` to maximize throughput per API token.

### Rate Limits

| Key Type           | Limit                                  |
| ------------------ | -------------------------------------- |
| Registered API key | **1,000 requests/hour** per IP address |
| DEMO_KEY           | ~30 requests/hour (much lower)         |
| Exceeded           | API key blocked for 1 hour             |
| Higher limits      | Contact FoodData Central directly      |

**Token bucket math**: 1,000 req/hour = ~16.7 req/min = ~0.28 req/sec. With 20 IDs per batch request, effective throughput is **20,000 food records/hour** — sufficient for background sync but requires careful throttling for real-time paths.

Source: [FDC API Guide](https://fdc.nal.usda.gov/api-guide)

### Data Types & When to Use Each

| Data Type            | Update Frequency          | Nutrient Depth                              | Best For                                                           |
| -------------------- | ------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| **Foundation Foods** | April & October (2×/year) | Highest — analytical, with variability data | Raw/minimally processed ingredients (apples, chicken breast, oats) |
| **SR Legacy**        | Final release April 2018  | High — comprehensive historical             | Broad ingredient coverage; fallback when Foundation lacks an item  |
| **Branded Foods**    | Monthly                   | Label-only — incomplete nutrient profiles   | Packaged products (Campbell's soup, Oreos)                         |
| **FNDDS**            | Every 2 years             | Moderate — NHANES dietary study data        | Survey/research use; not ideal for recipe apps                     |
| **Experimental**     | 2×/year (if available)    | Varies                                      | Research; not for production use                                   |

**Decision for Commise**:

- **Primary lookup path**: Foundation Foods → SR Legacy (fallback)
- **Branded Foods**: Separate lookup path for packaged ingredient search (barcode or brand name)
- **FNDDS/Experimental**: Excluded from production data pipeline

### JSON Response Shape (Food Detail)

```typescript
// Simplified — full spec at https://fdc.nal.usda.gov/api-spec/fdc_api.html
interface FdcFoodDetail {
    fdcId: number;
    description: string;
    dataType: 'Foundation' | 'SR Legacy' | 'Branded' | 'Survey (FNDDS)' | 'Experimental';
    publicationDate: string;
    foodCategory?: { description: string };
    // Foundation/SR Legacy only:
    scientificName?: string;
    // Branded only:
    brandOwner?: string;
    brandName?: string;
    ingredients?: string; // ingredient list text
    servingSize?: number;
    servingSizeUnit?: string;
    householdServingFulltext?: string; // "1 cup, chopped" — critical for portion UX
    // Nutrients (per 100g):
    foodNutrients: Array<{
        nutrient: { id: number; name: string; unitName: string; number: string };
        amount: number;
    }>;
    // Portions (Foundation/SR Legacy):
    foodPortions?: Array<{
        id: number;
        amount: number;
        gramWeight: number;
        portionDescription: string;
        modifier?: string;
        measureUnit?: { name: string };
    }>;
}
```

### Key Nutrient Numbers (for filtering API responses)

| Nutrient          | USDA Number | Unit |
| ----------------- | ----------- | ---- |
| Energy (calories) | 1008        | kcal |
| Protein           | 203         | g    |
| Total Fat         | 204         | g    |
| Carbohydrates     | 205         | g    |
| Fiber             | 291         | g    |
| Sugars            | 269         | g    |
| Sodium            | 307         | mg   |
| Calcium           | 301         | mg   |
| Iron              | 303         | mg   |

Use the `nutrients` query param to request only specific nutrient numbers — reduces response payload significantly.

### Downloadable Bulk Data (April 2026 Release)

| Data Type        | JSON Size (zipped) | JSON Size (unzipped) |
| ---------------- | ------------------ | -------------------- |
| Foundation Foods | 459 KB             | 6.5 MB               |
| SR Legacy        | 12.3 MB            | 205 MB               |
| Branded          | 195 MB             | 3.1 GB               |
| Full (all types) | 460 MB             | 3.1 GB               |

**Recommendation**: Seed Foundation Foods and SR Legacy from bulk download at deploy time (6.5 MB + 205 MB unzipped). This eliminates API calls for the ~9,000 Foundation + ~260,000 SR Legacy foods and makes the real-time API path only needed for Branded lookups and cache misses.

Source: [FDC Download Datasets](https://fdc.nal.usda.gov/download-datasets)

---

## RQ-3: Alternative Food APIs — Edamam & Nutritionix

### Comparison Matrix (2026)

| Capability                    | USDA FDC (free)          | Nutritionix      | Edamam         |
| ----------------------------- | ------------------------ | ---------------- | -------------- |
| Raw/minimally processed foods | ✅ Excellent             | ✅               | ✅             |
| Branded packaged foods        | ✅ ~93% US coverage      | ✅ 1M+ grocery   | ✅ 900K foods  |
| Restaurant menus              | ❌                       | ✅ 1,000+ chains | ❌             |
| Natural language parsing      | ❌                       | ✅ ~85% accuracy | ✅ NLP-based   |
| Bulk download                 | ✅ Free                  | ❌               | ❌             |
| Per-call cost                 | $0                       | ~$0.001–$0.005   | $0.003–$0.01   |
| Data ownership                | You own it               | Vendor lock-in   | Vendor lock-in |
| Rate limits                   | 1,000/hour               | Tier-based       | Tier-based     |
| Attribution required          | Requested (not required) | Required         | Required       |

### Nutritionix Pricing (2026)

| Tier                  | Price      | MAU    | Notes                               |
| --------------------- | ---------- | ------ | ----------------------------------- |
| Free (Business Trial) | $0         | 2      | 200 calls/day; attribution required |
| Starter               | $499/mo    | 200    |                                     |
| MVP                   | $999/mo    | 1,000  |                                     |
| Unicorn               | $1,850+/mo | Custom |                                     |

**Verdict**: Nutritionix's killer feature is restaurant menu data (Chipotle, Subway, etc.) and natural language parsing. For a recipe app focused on home cooking with structured ingredient entry, these features are not needed. The $499/mo minimum is prohibitive for an MVP.

### Edamam Pricing (2026)

| API                    | Entry Tier            | Notes                       |
| ---------------------- | --------------------- | --------------------------- |
| Food Database API      | $14/mo (Basic Vision) | NLP food search, 900K foods |
| Nutrition Analysis API | $29/mo (Basic)        | Recipe-level NLP analysis   |

**Verdict**: Edamam's NLP recipe analysis is compelling for future Feature 005 (AI Integration), but for structured USDA data lookup it adds cost without benefit. Their data is an "educated estimate" for recipe analysis — not suitable for precision nutrition tracking.

### Decision: USDA FDC as Primary, No Third-Party APIs at MVP

**Rationale**:

1. USDA data is free, authoritative, and bulk-downloadable — seed once, serve forever
2. Foundation + SR Legacy covers all raw ingredients needed for home cooking recipes
3. Branded Foods covers packaged goods via monthly sync
4. No vendor lock-in; data is CC0 (public domain)
5. Third-party APIs add $500–$2,000+/mo cost with no MVP-critical features
6. Natural language parsing (Nutritionix's differentiator) is a Feature 005 (AI) concern, not 003

**Future consideration**: If Feature 009 (Nutrition Planning) requires restaurant menu data, evaluate Nutritionix at that point.

Sources: [Self-Hosted Nutrition comparison](https://selfhostednutrition.org/api/nutritionix-api-when-to-use/) (2026-03-04), [NutriGraphAPI comparison](https://blog.nutrigraphapi.com/best-food-apis-for-developers-in-2026-edamam-vs-spoonacular-vs-nutritionix-vs-nutrigraphapi-2/) (2026-04-03)

---

## RQ-4: Open-Source TypeScript Implementations

### `food-ingredients-database` (npm, v1.1.0, March 2026)

The most production-ready TypeScript SDK for USDA FDC integration. Key architecture:

```
src/
  api/        // Orval-generated FDC client (from OpenAPI spec)
  cli/        // Stricli-based CLI commands
  local/      // Local shard loaders and search utilities
  sync/       // Ports, adapters, and sync orchestration
  syncFoods.ts
```

**Sync pattern** (directly applicable to our Lambda sync job):

```typescript
import { syncFoods, createJsonShardedDatabaseAdapter } from 'food-ingredients-database';

await syncFoods({
    providerOptions: { pageLimit: 1 },
    pageSize: 200,
    throttleMs: 0, // our SQS token bucket handles throttling
    logger: console,
    database: createJsonShardedDatabaseAdapter({ baseDir: './database/fdc' }),
});
```

**Search pattern** (applicable to our NestJS `FoodsService`):

```typescript
import { searchLocalFoods } from 'food-ingredients-database';

const foods = await searchLocalFoods('chicken breast', {
    nutrientNumber: '203', // protein
    maxResults: 10,
});
```

Source: [EduardoAC/food-ingredients-database](https://github.com/EduardoAC/food-ingredients-database) (last push 2026-03-20)

### `fooddata-central` (npm, Node.js client)

Lightweight Node.js client with TypeScript types. Useful as a reference for our HTTP client wrapper:

```typescript
import Client from 'fooddata-central';

const client = new Client({ api_key: process.env.USDA_API_KEY });
const results = await client.search({ generalSearchInput: 'raw broccoli' });
const details = await client.details(results.data.foods[0].fdcId);
```

Source: [metonym/fooddata-central](https://github.com/metonym/fooddata-central/blob/master/README.md)

### `usda-food-data-api-server` (TypeScript, MIT)

Self-hosted REST + GraphQL server backed by MongoDB. Demonstrates the GraphQL union type pattern for handling multiple FDC data types:

```graphql
union FoodItem = FoundationFoodItem | BrandedFoodItem | SurveyFoodItem | SRLegacyFoodItem

type Query {
    food(fdcId: Int!): FoodItem
    foods(fdcIds: [Int]!): [FoodItem]
    foodSearch(query: String!, dataType: [String]): [FoodItem]
}
```

Source: [dudeami0/usda-food-data-api-server](https://github.com/dudeami/usda-food-data-api-server)

### Recommendation

Do **not** take a direct dependency on `food-ingredients-database` — it uses a local JSON shard store (not PostgreSQL) and is designed for local-first apps. Instead, use it as a **reference implementation** for:

- The Orval-generated FDC API client pattern (generate our own from the FDC OpenAPI spec)
- The sync orchestration pattern (adapt for our SQS Lambda consumer)
- The pluggable provider registry pattern (future: add OpenFoodFacts)

---

## RQ-5: AWS Lambda + SQS Caching/Batching Patterns

### Token Bucket Pattern for Rate-Limited APIs

The spec already mandates an event-driven queue-based architecture (SQS + Lambda + token bucket). The key implementation details:

**Rate math**:

- USDA limit: 1,000 req/hour = 16.67 req/min
- Batch size: 20 IDs per `/foods` POST request
- Effective throughput: 20,000 food records/hour
- Safe token bucket: 15 tokens/min (10% headroom) = 900 req/hour

**SQS Lambda consumer pattern**:

```typescript
// Lambda handler — processes SQS batch
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        const { fdcIds, priority } = JSON.parse(record.body) as FoodBatchMessage;

        try {
            // Acquire token from DynamoDB token bucket before calling USDA
            await acquireToken(tokenBucketTable);

            // Batch fetch up to 20 IDs per USDA API call
            const foods = await usdaClient.getFoods(fdcIds.slice(0, 20));

            // Upsert into PostgreSQL ingredients table
            await ingredientsRepo.upsertBatch(foods);
        } catch (err) {
            if (isRateLimitError(err)) {
                // Return as failure — SQS will retry with backoff
                failures.push({ itemIdentifier: record.messageId });
            } else if (isNotFoundError(err)) {
                // Tombstone the fdcId — no retry
                await ingredientsRepo.markNotFound(fdcIds);
            }
        }
    }

    return { batchItemFailures: failures };
};
```

**DynamoDB token bucket** (standard pattern for Lambda rate limiting):

```typescript
// Atomic token acquisition using DynamoDB conditional write
async function acquireToken(tableName: string): Promise<void> {
    const now = Date.now();
    await dynamodb.updateItem({
        TableName: tableName,
        Key: { pk: { S: 'usda-token-bucket' } },
        UpdateExpression: 'SET tokens = tokens - :one, lastRefill = :now',
        ConditionExpression: 'tokens >= :one',
        ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':now': { N: String(now) },
        },
    });
}
```

### Caching Strategy: PostgreSQL as the Cache

Rather than a separate Redis/ElastiCache layer, use the `ingredients` table in PostgreSQL as the persistent cache:

1. **Cache hit**: `SELECT * FROM ingredients WHERE usda_fdc_id = $1` — returns immediately
2. **Cache miss**: Publish `FoodRequested` event to SQS High Priority queue; return `status: "pending"` to caller
3. **Background fill**: Lambda consumer fetches from USDA, upserts into `ingredients`, marks `fetch_status = 'fetched'`
4. **Stale check**: `updated_at` column; Foundation/SR Legacy data refreshed 2×/year via scheduled Lambda; Branded refreshed monthly

**Why not Redis?**: At our scale (recipe app, not a nutrition API), PostgreSQL with a GIN index on `usda_fdc_id` handles thousands of lookups/second. Redis adds operational complexity and cost (~$50/mo for ElastiCache) without meaningful benefit until we exceed ~10K concurrent users.

### Bulk Seed Lambda (One-Time + Scheduled)

```
EventBridge Scheduler → Lambda (BulkSeedJob)
  → Download FDC bulk JSON from S3 (pre-staged) or fdc.nal.usda.gov
  → Parse Foundation Foods (6.5 MB) + SR Legacy (205 MB)
  → Batch upsert into ingredients table (1,000 rows/batch)
  → Update sync_metadata table with last_synced_at
```

Schedule: April and October (matching FDC Foundation Foods release cadence). Branded Foods: monthly.

---

## RQ-6: Integration with 001's Data Model

### Existing `ingredients` Table (from 001 data-model.md)

```sql
CREATE TABLE ingredients (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT    NOT NULL,
    usda_fdc_id     INTEGER,                -- null for user-entered
    is_user_entered BOOLEAN NOT NULL DEFAULT false,
    -- Per-100g nutrition (populated by 003)
    calories_per_100g   NUMERIC(8,2),
    protein_g_per_100g  NUMERIC(8,2),
    carbs_g_per_100g    NUMERIC(8,2),
    fat_g_per_100g      NUMERIC(8,2),
    search_vector   TSVECTOR,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**003 must extend this table** with additional columns to support the full USDA data model:

```sql
-- Migration: 003-usda-food-data additions to ingredients
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS
    usda_data_type      TEXT CHECK (usda_data_type IN (
                            'Foundation', 'SR Legacy', 'Branded', 'Survey (FNDDS)'
                        )),
    fetch_status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (fetch_status IN ('pending', 'fetched', 'not_found', 'user_entered')),
    -- Extended macros
    fiber_g_per_100g    NUMERIC(8,2),
    sugar_g_per_100g    NUMERIC(8,2),
    sodium_mg_per_100g  NUMERIC(8,2),
    -- Portion guidance (from USDA foodPortions)
    serving_size_g      NUMERIC(8,2),
    serving_description TEXT,               -- "1 cup, chopped"
    -- Branded-specific
    brand_owner         TEXT,
    brand_name          TEXT,
    -- Sync metadata
    usda_published_date DATE,
    last_synced_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index for sync job queries
CREATE INDEX idx_ingredients_fetch_status ON ingredients (fetch_status)
    WHERE fetch_status IN ('pending', 'fetched');
CREATE INDEX idx_ingredients_data_type ON ingredients (usda_data_type)
    WHERE usda_data_type IS NOT NULL;
```

### `recipe_ingredients` — No Changes Needed

The existing `recipe_ingredients` table already has `user_calories`, `user_protein_g`, `user_carbs_g`, `user_fat_g` override columns. The 003 feature populates the base `ingredients` table; `recipe_ingredients` joins to it via `ingredient_id → ingredients.id`.

### New Tables Required by 003

```sql
-- Tracks USDA sync job state per data type
CREATE TABLE usda_sync_metadata (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    data_type       TEXT        NOT NULL UNIQUE,  -- 'Foundation' | 'SR Legacy' | 'Branded'
    last_synced_at  TIMESTAMPTZ,
    last_release    TEXT,                          -- e.g., '2026-04'
    total_records   INTEGER,
    status          TEXT        NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'running', 'complete', 'failed')),
    error_message   TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dead letter tracking for failed USDA fetches
CREATE TABLE usda_fetch_failures (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    fdc_id          INTEGER     NOT NULL,
    error_code      TEXT,
    error_message   TEXT,
    attempt_count   INTEGER     NOT NULL DEFAULT 1,
    last_attempted  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_usda_fetch_failures_fdc_id ON usda_fetch_failures (fdc_id);
```

---

## RQ-7: Nutritional Calculation Pipeline

### Where Nutrient Lookup Happens

The calculation pipeline has two distinct paths:

**Path A — Recipe Save (async, non-blocking)**:

```
User saves recipe with ingredients
  → NestJS RecipesService checks ingredients table for each fdcId
  → Cache hits: return full nutrition immediately
  → Cache misses: publish FoodBatchRequested to SQS; mark ingredient as pending
  → Return recipe with partial nutrition (pending ingredients show null macros)
  → Lambda consumer fills cache in background
  → Client polls or WebSocket push notifies when nutrition is ready
```

**Path B — Recipe Nutrition Display (sync, from cache)**:

```
User views recipe nutrition panel
  → NestJS FoodsService: SELECT from ingredients WHERE id IN (recipe_ingredient_ids)
  → For each ingredient: multiply per-100g values by (quantity_g / 100)
  → Sum across all ingredients for recipe totals
  → Divide by servings for per-serving values
```

**Calculation formula** (per ingredient):

```typescript
function calculateIngredientNutrition(ingredient: Ingredient, quantityG: number): IngredientNutrition {
    const factor = quantityG / 100;
    return {
        calories: (ingredient.calories_per_100g ?? 0) * factor,
        protein_g: (ingredient.protein_g_per_100g ?? 0) * factor,
        carbs_g: (ingredient.carbs_g_per_100g ?? 0) * factor,
        fat_g: (ingredient.fat_g_per_100g ?? 0) * factor,
        fiber_g: (ingredient.fiber_g_per_100g ?? 0) * factor,
        sugar_g: (ingredient.sugar_g_per_100g ?? 0) * factor,
        sodium_mg: (ingredient.sodium_mg_per_100g ?? 0) * factor,
    };
}
```

**Unit conversion** (quantity → grams): The `recipe_ingredients.unit` field stores the display unit ('cup', 'tbsp', 'oz', 'g', 'ml'). A unit conversion service maps these to grams using USDA `foodPortions` data (gram weights per portion) or a standard conversion table.

### NestJS Module Structure

```
src/
  foods/
    foods.module.ts
    foods.service.ts          // USDA API client + cache lookup
    foods.controller.ts       // GET /v1/foods/search, GET /v1/foods/:fdcId
    foods.repository.ts       // Drizzle ORM queries against ingredients table
    dto/
      food-search.dto.ts
      food-detail.dto.ts
    entities/
      ingredient.entity.ts    // Drizzle schema for ingredients table
  nutrition/
    nutrition.service.ts      // calculateRecipeNutrition(), calculateIngredientNutrition()
    nutrition.module.ts
  sync/
    usda-sync.service.ts      // Bulk seed + scheduled sync
    usda-sync.module.ts
  queue/
    food-queue.consumer.ts    // SQS Lambda handler
    food-queue.producer.ts    // Publishes FoodRequested / FoodBatchRequested events
```

---

## RQ-8: UX Patterns for Ingredient/Nutrient Lookup

### Ingredient Search UX (from competitor analysis)

**Pattern 1: Tiered autocomplete**

- Type "chicken" → local PostgreSQL FTS returns results in <50ms
- Results show data source badge: `[USDA Foundation]`, `[USDA Branded]`, `[User-entered]`
- Selecting a result shows serving size options from `foodPortions` (e.g., "1 breast (86g)", "1 cup, chopped (140g)")

**Pattern 2: Pending state handling**

- If user types an fdcId or selects a food not yet in local cache:
    - Show skeleton/spinner for nutrition panel
    - Recipe saves immediately with `status: "pending"` for that ingredient
    - Nutrition fills in when Lambda consumer completes (WebSocket or polling)

**Pattern 3: Portion picker**

- Primary: gram input (always available)
- Secondary: household measure dropdown populated from `foodPortions` (e.g., "1 cup", "1 tbsp")
- Conversion: `gramWeight` from USDA portion data drives the calculation

**Pattern 4: Nutrition panel**

- Show per-serving and per-recipe totals
- Highlight incomplete data (ingredients with `fetch_status = 'pending'` or `'not_found'`)
- Allow user override for any nutrient value (maps to `user_*` columns in `recipe_ingredients`)

### Data Quality Indicators

| Status                   | Display            | Meaning                                |
| ------------------------ | ------------------ | -------------------------------------- |
| `fetched` + `Foundation` | ✅ USDA Foundation | Highest quality, lab-analyzed          |
| `fetched` + `SR Legacy`  | ✅ USDA SR Legacy  | High quality, historical               |
| `fetched` + `Branded`    | 📦 Branded         | Label data only, may be incomplete     |
| `pending`                | ⏳ Loading...      | Queued for USDA fetch                  |
| `not_found`              | ⚠️ Not found       | No USDA match; user override available |
| `user_entered`           | ✏️ User-entered    | Manual nutrition data                  |

---

## Summary & Recommendations

### Architecture Decision: Hybrid Bulk Seed + On-Demand Queue

1. **At deploy time**: Bulk seed Foundation Foods (6.5 MB) and SR Legacy (205 MB) from FDC download into `ingredients` table. This covers ~270,000 foods with zero API calls.
2. **Monthly**: Scheduled Lambda syncs Branded Foods delta (195 MB zipped) — only new/updated records.
3. **On-demand**: When a recipe references an `fdcId` not in the local table, publish to SQS High Priority queue. Lambda consumer fetches from USDA API (up to 20 IDs per call) and upserts.
4. **Rate limiting**: DynamoDB token bucket at 15 tokens/min (900/hour, 10% below USDA limit).

### Key Integration Points with 001

| 001 Entity                           | 003 Responsibility                                                  |
| ------------------------------------ | ------------------------------------------------------------------- |
| `ingredients.usda_fdc_id`            | Foreign key to USDA FDC; populated by 003 sync                      |
| `ingredients.calories_per_100g` etc. | Populated from USDA `foodNutrients` (nutrient #1008, 203, 204, 205) |
| `recipe_ingredients.user_*`          | Override columns; 003 does not write these (user-driven)            |
| `recipes.ingredient_names_text`      | 003 populates `ingredients.name` from USDA `description` field      |

### Open Questions for Spec

1. **Portion unit normalization**: Should unit conversion (cup → grams) live in 003 or in a shared utility module? Recommend shared utility (used by 006 meal planning and 007 grocery lists too).
2. **Branded Foods sync frequency**: Monthly sync of 3.1 GB unzipped is significant. Consider incremental sync via USDA API (`/foods/list?dataType=Branded&pageNumber=N`) rather than full bulk download.
3. **International foods**: USDA is US-centric. If the app targets international users, OpenFoodFacts (free, CC-BY-SA) should be evaluated as a supplementary source for Feature 009.
4. **Nutrient depth**: The current `ingredients` schema stores only 4 macros. Feature 009 (Nutrition Planning) will need micronutrients (vitamins, minerals). Design the schema extension now to avoid a breaking migration later.

---

_Research completed: 2026-05-08. Sources: USDA FoodData Central official documentation, Cronometer support docs, npm package registry, GitHub open-source implementations, competitor analysis blogs._
