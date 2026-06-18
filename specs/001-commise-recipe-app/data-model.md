# Data Model: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app` | **Date**: 2026-04-18
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Design Constraints

- **Storage**: RDS PostgreSQL 16 (`db.t4g.small` ~$25/mo launch)
- **Extensions**: `pg_trgm` (fuzzy search), `pgcrypto` (gen_random_uuid) — enabled via `CREATE EXTENSION`
- **Triggers**: `search_vector` tsvector maintained by PostgreSQL trigger (not application layer)
- **JSONB**: used for recipe version snapshots, flexible metadata
- **GIN indexes**: full support on tsvector, text[], and JSONB columns
- **No transaction row limit**: bulk operations work natively
- **Per-PR schema isolation**: schema `pr_<number>` for each PR; `public` for production

---

## Entity Relationship Overview

```
users ──< recipes ──< recipe_ingredients >── ingredients
              │
              ├──< recipe_steps
              ├──< recipe_photos
              ├──< recipe_versions
              └──< recipe_collections >── collections
```

---

## Schema DDL

### `users`

```sql
-- (superseded — see 002-user-auth) The users table is owned by feature 002.
-- users.sub (VARCHAR(255) COLLATE "C" PRIMARY KEY) is the canonical user identifier.
-- The id/clerk_id columns shown below are superseded; downstream FKs reference users(sub).
CREATE TABLE users (
    sub          VARCHAR(255) COLLATE "C" PRIMARY KEY,  -- Clerk sub claim; canonical PK
    email        TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    tier         TEXT        NOT NULL DEFAULT 'free'    -- 'free' | 'premium'
                             CHECK (tier IN ('free', 'premium')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `recipes`

```sql
CREATE TABLE recipes (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub              VARCHAR(255) NOT NULL REFERENCES users(sub),
    title                  TEXT        NOT NULL,
    description            TEXT,
    prep_time_minutes      INTEGER     CHECK (prep_time_minutes >= 0),
    cook_time_minutes      INTEGER     CHECK (cook_time_minutes >= 0),
    total_time_minutes     INTEGER     CHECK (total_time_minutes >= 0),
    servings               INTEGER     CHECK (servings > 0),

    -- Visibility (C-004)
    visibility             TEXT        NOT NULL DEFAULT 'public'
                           CHECK (visibility IN ('public', 'private')),
    source_type            TEXT        NOT NULL DEFAULT 'user_created'
                           CHECK (source_type IN (
                               'user_created',
                               'imported_public',   -- website / Instagram (always public)
                               'imported_physical', -- OCR / photo (starts private)
                               'imported_paid'      -- cookbook / subscription (always private)
                           )),
    source_url             TEXT,                    -- original URL if imported_public
    source_attribution     TEXT,                    -- display attribution text
    cloned_from_id         UUID        REFERENCES recipes(id),

    -- Substantive edit tracking (FR-005, C-004)
    -- True once ingredients or instructions have been modified after cloning
    has_substantive_edit   BOOLEAN     NOT NULL DEFAULT false,

    -- Facets (columnar — NOT embedded in tsvector, for efficient indexed filtering)
    cuisine                TEXT,                    -- 'italian', 'mexican', …
    dietary_flags          TEXT[]      NOT NULL DEFAULT '{}',
                                                    -- 'vegan', 'gluten_free', …
    tags                   TEXT[]      NOT NULL DEFAULT '{}',

    -- Nutrition summary (aggregate from recipe_ingredients)
    has_partial_nutrition  BOOLEAN     NOT NULL DEFAULT false,  -- any user-entered ingredient

    -- Versioning (FR-007b)
    current_version        INTEGER     NOT NULL DEFAULT 1,

    -- Denormalized ingredient names for FTS trigger (space-joined, updated by service layer)
    ingredient_names_text  TEXT        NOT NULL DEFAULT '',

    -- Full-text search vector (maintained by PostgreSQL trigger — see Search Vector Maintenance)
    -- Weighted: title (A) > description (B) > ingredient_names_text (C)
    search_vector          TSVECTOR,

    -- Soft-delete tombstone (C-007). NULL = active; NOT NULL = tombstoned and excluded
    -- from every read path except the GDPR erasure preview. Hard purge only via
    -- the user-initiated "Erase my data" flow.
    deleted_at             TIMESTAMPTZ,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GIN index for FTS (primary search path)
CREATE INDEX idx_recipes_search_vector    ON recipes USING GIN (search_vector);

-- B-tree indexes for faceted filtering
CREATE INDEX idx_recipes_owner_sub         ON recipes (owner_sub);
CREATE INDEX idx_recipes_visibility       ON recipes (visibility);
CREATE INDEX idx_recipes_cuisine          ON recipes (cuisine);
CREATE INDEX idx_recipes_cloned_from      ON recipes (cloned_from_id);

-- GIN indexes for array facets
CREATE INDEX idx_recipes_dietary_flags    ON recipes USING GIN (dietary_flags);
CREATE INDEX idx_recipes_tags             ON recipes USING GIN (tags);

-- Composite: most common query pattern (public recipes, ordered by recency)
CREATE INDEX idx_recipes_public_recent    ON recipes (visibility, created_at DESC)
    WHERE visibility = 'public';
```

#### Search Vector Maintenance (PostgreSQL Trigger)

RDS PostgreSQL supports triggers — `search_vector` is maintained automatically on every INSERT/UPDATE:

```sql
-- Trigger function: auto-maintains search_vector on recipe writes
CREATE OR REPLACE FUNCTION recipes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.ingredient_names_text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipes_search_vector
  BEFORE INSERT OR UPDATE OF title, description, ingredient_names_text
  ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION recipes_search_vector_update();
```

The `ingredient_names_text` column is a denormalized `TEXT` field updated by the service layer on ingredient changes (space-joined ingredient names). The trigger fires automatically to rebuild the weighted tsvector — no application-layer search vector management needed.

**Ingredient name sync**: When `recipe_ingredients` rows change, `RecipesService.syncIngredientNamesText(recipeId)` updates `recipes.ingredient_names_text`, which fires the trigger.

---

### `recipe_steps`

```sql
CREATE TABLE recipe_steps (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id   UUID    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL CHECK (step_number > 0),
    instruction TEXT    NOT NULL,
    UNIQUE (recipe_id, step_number)
);

CREATE INDEX idx_recipe_steps_recipe_id ON recipe_steps (recipe_id);
```

---

### `ingredients` (USDA-backed + user-entered, from 003-usda-food-data)

```sql
CREATE TABLE ingredients (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT    NOT NULL,
    usda_fdc_id     INTEGER,                -- null for user-entered
    is_user_entered BOOLEAN NOT NULL DEFAULT false,
    -- Per-100g nutrition
    calories_per_100g   NUMERIC(8,2),
    protein_g_per_100g  NUMERIC(8,2),
    carbs_g_per_100g    NUMERIC(8,2),
    fat_g_per_100g      NUMERIC(8,2),
    search_vector   TSVECTOR,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingredients_search_vector ON ingredients USING GIN (search_vector);
CREATE INDEX idx_ingredients_usda_fdc_id   ON ingredients (usda_fdc_id) WHERE usda_fdc_id IS NOT NULL;

-- pg_trgm GIN index for fuzzy autocomplete (typo-tolerant ingredient search)
CREATE INDEX idx_ingredients_name_trgm     ON ingredients USING GIN (name gin_trgm_ops);
```

---

### `recipe_ingredients`

```sql
CREATE TABLE recipe_ingredients (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id       UUID    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id   UUID    NOT NULL REFERENCES ingredients(id),
    quantity        NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
    unit            TEXT    NOT NULL,          -- 'g', 'ml', 'cup', 'tbsp', …
    display_text    TEXT,                      -- optional human-readable override
    sort_order      INTEGER NOT NULL DEFAULT 0,

    -- Denormalized for display / search_vector assembly (no JOIN needed on write)
    ingredient_name TEXT    NOT NULL,
    is_user_entered BOOLEAN NOT NULL DEFAULT false,

    -- User-entered nutrition override (FR-007a)
    user_calories   NUMERIC(8,2),
    user_protein_g  NUMERIC(8,2),
    user_carbs_g    NUMERIC(8,2),
    user_fat_g      NUMERIC(8,2)
);

CREATE INDEX idx_recipe_ingredients_recipe_id     ON recipe_ingredients (recipe_id);
CREATE INDEX idx_recipe_ingredients_ingredient_id ON recipe_ingredients (ingredient_id);
```

---

### `recipe_photos`

```sql
CREATE TABLE recipe_photos (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id     UUID    NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    s3_key_orig   TEXT    NOT NULL,          -- original upload key (may be deleted post-processing)
    s3_key_thumb  TEXT,                      -- 150×150 WebP
    s3_key_card   TEXT,                      -- 400×400 WebP
    s3_key_full   TEXT,                      -- 1200×1200 WebP
    cdn_url_base  TEXT    NOT NULL,          -- CloudFront base URL (without size suffix)
    processing_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processing', 'complete', 'failed')),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT max_photos_per_recipe CHECK (
        -- enforced at application layer; this constraint is advisory
        true
    )
);

-- Enforce max 10 photos per recipe via partial index + application layer check
CREATE INDEX idx_recipe_photos_recipe_id ON recipe_photos (recipe_id);
```

**Enforcement note**: The 10-photo limit per recipe is enforced in the service layer via a COUNT check before INSERT, with a database advisory lock to prevent race conditions.

---

### `recipe_versions`

Stores the last 10 versions in DB (queryable/restorable); all versions pushed to S3 (FR-007b).

```sql
CREATE TABLE recipe_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id       UUID        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    version_number  INTEGER     NOT NULL,
    snapshot        JSONB       NOT NULL,    -- full recipe snapshot at this version
    base_version    INTEGER,                 -- enables 3-way merge conflict detection
    s3_key          TEXT,                    -- S3 archive key (all versions)
    created_by      VARCHAR(255) NOT NULL REFERENCES users(sub),
    change_summary  TEXT,                    -- optional: what changed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (recipe_id, version_number)
);

CREATE INDEX idx_recipe_versions_recipe_id ON recipe_versions (recipe_id);

-- GIN index on snapshot for querying version content (e.g., "find versions where title was X")
CREATE INDEX idx_recipe_versions_snapshot ON recipe_versions USING GIN (snapshot);
```

**Snapshot format** (JSONB — enabled by RDS PostgreSQL):

```json
{
  "version": 1,
  "title": "...",
  "description": "...",
  "steps": [...],
  "ingredients": [...],
  "servings": 4,
  "prep_time_minutes": 15,
  "cook_time_minutes": 30
}
```

Application purges DB rows beyond 10 most recent on each write. All versions remain on S3 indefinitely.

---

### `collections` + `recipe_collections`

```sql
CREATE TABLE collections (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub            VARCHAR(255) NOT NULL REFERENCES users(sub),
    name                 TEXT        NOT NULL,
    description          TEXT,

    -- Clone provenance (FR-011). NULL = original collection authored by owner.
    -- NOT NULL = this collection was cloned from another (snapshot at clone time).
    -- Pull-from-source updates are EXPLICIT and OPT-IN; setting this column
    -- never causes implicit re-sync of recipe membership.
    source_collection_id UUID        REFERENCES collections(id),

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipe_collections (
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    recipe_id     UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Provenance of how this recipe entered the collection (FR-011).
    -- 'manual'      = user added directly
    -- 'clone_seed'  = inserted at collection-clone time from source snapshot
    -- 'pull'        = added by an explicit user-initiated "Pull updates from source"
    added_via     TEXT NOT NULL DEFAULT 'manual'
                  CHECK (added_via IN ('manual', 'clone_seed', 'pull')),

    PRIMARY KEY (collection_id, recipe_id)
);

CREATE INDEX idx_collections_owner_sub            ON collections (owner_sub);
CREATE INDEX idx_collections_source_collection   ON collections (source_collection_id)
    WHERE source_collection_id IS NOT NULL;
CREATE INDEX idx_recipe_collections_recipe_id    ON recipe_collections (recipe_id);
```

**Clone semantics (FR-011)**:

- Cloning a collection inserts a new `collections` row with `source_collection_id` set to the source, plus one `recipe_collections` row per source recipe with `added_via = 'clone_seed'`.
- Subsequent edits to the source collection do **not** propagate automatically.
- The owner of the cloned collection may invoke `POST /api/v1/collections/{id}/pull-from-source` to fetch new recipes added to the source since the last pull; new memberships are inserted with `added_via = 'pull'`. Removed recipes in the source are **not** removed from the clone.

---

## Search Query Pattern

### Standard recipe search (keyword + facets)

```sql
-- Parameterised: $1=query text, $2=cuisine (nullable), $3=dietary_flags (nullable),
--                $4=max_prep_time (nullable), $5=page_size, $6=offset
WITH matched AS (
    SELECT id, ts_rank_cd(search_vector, query) AS rank
    FROM recipes,
         plainto_tsquery('english', $1) AS query
    WHERE search_vector @@ query
      AND visibility = 'public'
      AND ($2 IS NULL OR cuisine = $2)
      AND ($3 IS NULL OR dietary_flags @> $3::text[])
      AND ($4 IS NULL OR total_time_minutes <= $4)
    LIMIT 10000   -- rank sampling: prevents full-table ts_rank scan
)
SELECT r.*
FROM matched m
JOIN recipes r ON r.id = m.id
ORDER BY m.rank DESC
LIMIT $5 OFFSET $6;
```

### Ingredient-based recipe search

```sql
-- Recipes containing ALL of the listed ingredient IDs
SELECT recipe_id
FROM recipe_ingredients
WHERE ingredient_id = ANY($1::uuid[])
GROUP BY recipe_id
HAVING count(DISTINCT ingredient_id) = array_length($1::uuid[], 1);
```

---

## Image Processing Pipeline

```
POST /api/v1/recipes/{id}/photos/upload-url
  → Lambda generates S3 presigned PUT URL
  → Returns { uploadUrl, key, expiresIn: 900 }

Client PUT → s3://bucket/uploads/{uuid}/original.{ext}
  → S3 event → Lambda (Sharp)
     ├── Resize to 150×150 → s3://bucket/photos/{uuid}/thumb.webp
     ├── Resize to 400×400 → s3://bucket/photos/{uuid}/card.webp
     └── Resize to 1200×1200 → s3://bucket/photos/{uuid}/full.webp
  → UPDATE recipe_photos SET
        s3_key_thumb = ..., s3_key_card = ..., s3_key_full = ...,
        processing_status = 'complete'
  → (Optional) DELETE original from S3 after successful processing

Serving:
  https://cdn.commise.app/photos/{uuid}/thumb.webp   (CloudFront, immutable cache)
  https://cdn.commise.app/photos/{uuid}/card.webp
  https://cdn.commise.app/photos/{uuid}/full.webp
```

Presigned URL constraint (5 MB limit):

```typescript
const command = new PutObjectCommand({
    Bucket: process.env.UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLengthRange: [1, 5 * 1024 * 1024], // 1 byte – 5 MB
});
```

---

## Version History Retention Logic

On every recipe save:

1. INSERT new `recipe_versions` row with full snapshot
2. Serialize snapshot → upload to S3 (`versions/{recipe_id}/{version_number}.json`)
3. COUNT versions in DB for this recipe
4. If count > 10: DELETE the oldest `recipe_versions` rows (keep 10 most recent)
5. UPDATE `recipes.current_version` to new version number

S3 versions are **never deleted** (lifecycle: NONE on versions prefix).

---

## Concurrent Edit Conflict Detection (FR-007c)

**Optimistic concurrency via `current_version`**:

```sql
-- Client sends current_version it last read
UPDATE recipes
SET title = $2, current_version = current_version + 1, updated_at = now()
WHERE id = $1
  AND current_version = $3   -- conflict guard
RETURNING id, current_version;
```

If 0 rows returned → conflict detected → return HTTP 409 with both the client's version snapshot and the current DB state → frontend presents merge UI.

---

## Visibility Enforcement Rules (C-004)

| Condition                    | Allowed visibility                                               |
| ---------------------------- | ---------------------------------------------------------------- |
| Free-tier user, user_created | `public` only                                                    |
| Premium user, user_created   | `public` or `private`                                            |
| Any user, imported_public    | `public` only — unless premium AND `has_substantive_edit = true` |
| Any user, imported_physical  | `private` only                                                   |
| Any user, imported_paid      | `private` only (permanent)                                       |
| Premium lapse                | No new private; existing private stay private                    |

Enforced in service layer (`RecipeService.setVisibility()`), NOT at DB constraint level (visibility rules are business logic, not schema invariants).

---

## Implementation Notes

### ORM: Drizzle + drizzle-kit Migrations

All schema in this document is expressed as reference SQL DDL for clarity. The **actual implementation** uses:

- **Drizzle ORM** (`drizzle-orm` + `pg`) for schema definitions in `packages/shared/db/src/schema/`
- **drizzle-kit** for migration generation (`drizzle-kit generate`) and execution (`drizzle-kit migrate`)
- Migrations live in `packages/shared/db/src/migrations/` (auto-generated, committed to git)
- Schema files: `recipes.ts`, `ingredients.ts`, `versions.ts`, `photos.ts`, `collections.ts`, `users.ts`

The Drizzle schema is the **source of truth** — this DDL document is a design reference only.

### Trigger Setup

The `recipes_search_vector_update()` trigger function (see Search Vector Maintenance above) is created via a **custom SQL migration** in drizzle-kit, since Drizzle ORM does not natively support trigger definitions. Add as a `sql` block in the initial migration:

```typescript
// packages/shared/db/src/migrations/0001_add_search_trigger.ts
import { sql } from 'drizzle-orm';

export const searchTriggerMigration = sql`
  CREATE OR REPLACE FUNCTION recipes_search_vector_update() RETURNS trigger AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW.ingredient_names_text, '')), 'C');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER trg_recipes_search_vector
    BEFORE INSERT OR UPDATE OF title, description, ingredient_names_text
    ON recipes
    FOR EACH ROW
    EXECUTE FUNCTION recipes_search_vector_update();
`;
```

---

### `recipe_version_pending_archives` (FR-007b-i)

Tracks recipe-version snapshots that have been written to PostgreSQL but not yet archived to S3. The recipe save transaction is the **source of truth**; S3 archiving is asynchronous and retried via SQS until success.

```sql
CREATE TABLE recipe_version_pending_archives (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id UUID        NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
    recipe_id         UUID        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    version_number    INTEGER     NOT NULL,

    -- Archive lifecycle
    status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_flight', 'failed', 'dlq')),
    attempts          INTEGER     NOT NULL DEFAULT 0,
    last_error        TEXT,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- SQS coordination
    sqs_message_id    TEXT,
    sqs_receipt       TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (recipe_version_id)
);

CREATE INDEX idx_pending_archives_status_next
    ON recipe_version_pending_archives (status, next_attempt_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX idx_pending_archives_recipe_id
    ON recipe_version_pending_archives (recipe_id);
```

**Lifecycle (FR-007b-i)**:

1. Recipe save transaction commits: writes `recipes` + `recipe_versions` + `recipe_version_pending_archives` (status=`pending`) atomically.
2. Same transaction enqueues an SQS message referencing `recipe_version_pending_archives.id`.
3. Archive worker Lambda consumes the message, sets status=`in_flight`, uploads JSON snapshot to `s3://archive-bucket/versions/{recipe_id}/{version_number}.json`, then sets `recipe_versions.s3_key` and DELETEs the pending row on success.
4. On failure: increment `attempts`, set `status='failed'`, record `last_error`, schedule `next_attempt_at` with exponential backoff. SQS redrive policy moves messages exceeding `maxReceiveCount` to a DLQ; the worker marks `status='dlq'` for operator visibility.
5. The user-facing read path **never blocks** on archive completion. `recipe_versions.s3_key IS NULL` simply means "DB-only so far"; the row is fully usable for restore.

---

## Soft Delete & GDPR Erasure (C-007)

### Soft-delete semantics

- Recipe deletion sets `recipes.deleted_at = now()`. The row is retained for audit/history and is **excluded from every read path** (search, list, single fetch, collection membership listings) by adding `AND deleted_at IS NULL` to all production queries.
- Tombstoned recipes remain referenced by `recipe_versions`, `recipe_collections`, and `cloned_from_id` so that history and provenance remain intact for non-deleted descendants.
- Restoring a tombstoned recipe (within the retention window) is an `UPDATE recipes SET deleted_at = NULL` — no data reconstruction needed.

### Hard purge ("Erase my data")

User-initiated GDPR erasure is the **only** path that physically removes data:

1. Frontend calls `POST /api/v1/account/erasure-requests` to enumerate the user's tombstoned + active recipes, photos, versions, collections, and pending archives.
2. User confirms; backend records an `erasure_request` audit row (out of scope for this feature; tracked in compliance backlog) and enqueues an erasure job.
3. Erasure worker, in order:
    - DELETEs `recipe_version_pending_archives` rows for the user's recipes.
    - DELETEs S3 objects under `versions/{recipe_id}/` and `photos/{recipe_id}/` for each owned recipe.
    - DELETEs `recipe_versions`, `recipe_photos`, `recipe_ingredients`, `recipe_steps`, `recipe_collections`, `recipes`, and `collections` for the user.
    - DELETEs the `users` row last.
4. Cloned descendants owned by **other** users are unaffected; their `cloned_from_id` is set to NULL by the erasure worker prior to deleting the source recipe to preserve referential integrity without leaking source data.

This is the **only** code path permitted to issue `DELETE FROM recipes`. All other "delete" operations MUST set `deleted_at` instead.

---

## Read-path filter rule (C-007)

Every query against `recipes` in production code paths MUST include `AND r.deleted_at IS NULL` (or the equivalent in Drizzle ORM via a shared `activeRecipes()` query helper). The only exceptions are:

- The GDPR erasure preview endpoint.
- The erasure worker itself.
- Internal admin/debug tooling explicitly scoped to tombstone inspection.

A repository-wide ESLint rule (`no-raw-recipes-select`) enforces use of the `activeRecipes()` helper for SELECTs against the `recipes` table.
