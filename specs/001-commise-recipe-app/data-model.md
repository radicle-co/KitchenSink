# Data Model: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app` | **Date**: 2026-04-18
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Design Constraints

- **Storage**: the **shared RDS PostgreSQL 16 instance** (`kitchensink-identity-{stage}`, global DataStack) — recipe tables live in their **own logical database `kitchensink_recipes`** on that shared instance (provisioned by a `RecipeDbBootstrap` custom resource mirroring `FoodDbBootstrap`: a passwordless IAM-auth `recipe_app` role + the `kitchensink_recipes` database; the service authenticates via RDS IAM tokens — no password secret). **No new RDS instance** — a separate logical database on the shared instance costs nothing extra and keeps recipes isolated from identity/food data.
- **Extensions**: `pg_trgm` (fuzzy search), `pgcrypto` (gen_random_uuid) — enabled via `CREATE EXTENSION`
- **Triggers**: `search_vector` tsvector maintained by PostgreSQL trigger (not application layer)
- **JSONB**: used for recipe version snapshots, flexible metadata
- **GIN indexes**: full support on tsvector, text[], and JSONB columns
- **No transaction row limit**: bulk operations work natively
- **Per-PR isolation**: per-PR **logical databases** within the shared RDS (ADR-0006); `kitchensink_recipes` follows the same per-PR cloning as the other service databases.

---

## Entity Relationship Overview

```
recipes ──< recipe_ingredients >── ingredients
   │
   ├──< recipe_steps
   ├──< recipe_photos
   ├──< recipe_versions
   └──< recipe_collections >── collections
```

---

## Schema DDL

> **Database.** All tables below live in the recipe service's **own logical database `kitchensink_recipes`** on the **shared** RDS instance (default `public` schema, like identity/food). The logical database is the isolation boundary — no new RDS instance, and no cross-database FKs (recipes never FKs into identity/food; `owner_id`/`food_id` are opaque values).

> **User reference (no local `users` table).** The recipe service does **not** own a `users` table.
> `owner_id` / `created_by` store the **app-user ULID (from the token claim)** directly as `VARCHAR(255) NOT NULL`
> with **no FK** and **no read-through user replication**. The recipe `AuthMiddleware` verifies the
> Clerk session token and reads the app-user ULID from the token claim; author display/profile is resolved via the identity
> client (002) when needed, never stored here.

### `recipes`

```sql
CREATE TABLE recipes (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- App-user ULID of the owner (from token claim). No FK, no local users table (see note above).
    owner_id              VARCHAR(255) NOT NULL,
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
    has_partial_nutrition  BOOLEAN     NOT NULL DEFAULT false,  -- any user-entered ingredient, or any
                                                                -- ingredient whose food resolution is
                                                                -- still pending/unresolved (async, R5)

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
CREATE INDEX idx_recipes_owner_id         ON recipes (owner_id);
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
    -- Optional per-step timer in seconds (contract `timerSeconds`); NULL = no timer.
    timer_seconds INTEGER CHECK (timer_seconds IS NULL OR timer_seconds > 0),
    UNIQUE (recipe_id, step_number)
);

CREATE INDEX idx_recipe_steps_recipe_id ON recipe_steps (recipe_id);
```

---

### `ingredients` (food-service-backed + user-entered, from 003-food-data)

Backed by the **source-agnostic food service (003)** via its typed client
`@kitchensink/food-service-client` (`FoodServiceClient`) — **not** by querying USDA directly. Foods are
referenced by the food service's internal **ULID** (`food_id`), stored as an **opaque cross-service
reference** (never a USDA `fdcId`, and **not** a cross-DB FK to the food DB). The `ingredients` +
`recipe_ingredients` tables — and the food↔ingredient link — are owned by **001**. Resolution is
**asynchronous**: a just-added food may be `pending` (nutrition not ready yet) or `unresolved` (needs
disambiguation) before it becomes `resolved` (golden record with nutrition). See R5 / FR-007.

```sql
CREATE TABLE ingredients (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT    NOT NULL,
    -- Opaque reference to the food service (003) golden record by its internal ULID.
    -- NEVER a USDA fdcId (003 is source-agnostic); this is a cross-service reference,
    -- not a cross-DB FK. Null for user-entered / freeform ingredients.
    food_id         TEXT,
    -- Async food-resolution status (`foodResolutionStatus` in @kitchensink/recipe-core),
    -- mirroring the shipped food client's FoodStatus (UPPER_SNAKE, incl. the terminal states):
    --   'PENDING'    → addByName accepted (202), nutrition not ready yet
    --   'UNRESOLVED' → needs disambiguation (getCandidates + resolve)
    --   'RESOLVED'   → golden record available (nutrition populated below)
    --   'NOT_FOUND'  → food service could not match the name (terminal)
    --   'FAILED'     → resolution failed (terminal)
    -- Nullable: set ONLY for database-backed ingredients (food_id present); NULL for
    -- user-entered / freeform ingredients (is_user_entered=true, no food reference).
    -- Freeform / user-supplied nutrition (FR-007a) is the SEPARATE is_user_entered
    -- boolean below — it is NOT a food-resolution-status value.
    food_resolution_status TEXT
                      CHECK (food_resolution_status IN ('PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED')),
    is_user_entered BOOLEAN NOT NULL DEFAULT false,
    -- Per-100g nutrition — populated from the food golden record once 'resolved'; null while pending
    calories_per_100g   NUMERIC(8,2),
    protein_g_per_100g  NUMERIC(8,2),
    carbs_g_per_100g    NUMERIC(8,2),
    fat_g_per_100g      NUMERIC(8,2),
    search_vector   TSVECTOR,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingredients_search_vector ON ingredients USING GIN (search_vector);
CREATE INDEX idx_ingredients_food_id       ON ingredients (food_id) WHERE food_id IS NOT NULL;

-- pg_trgm GIN index for fuzzy autocomplete (typo-tolerant ingredient search)
CREATE INDEX idx_ingredients_name_trgm     ON ingredients USING GIN (name gin_trgm_ops);
```

**Food-client call surface (R5)**: typeahead over known foods → `foodClient.search(query)` (sync,
local `/v1/foods/search`); an unknown name → `foodClient.addByName(name)` → `202 { id, status }`
(`PENDING`/`UNRESOLVED`), poll via `getById(id)` / `getStatus(id)` until `RESOLVED`; disambiguate an
`UNRESOLVED` food via `getCandidates(id)` + `resolve(id, candidateIds)`. The ingredient picker MUST
surface a "nutrition pending" state, and a recipe may temporarily show partial nutrition.

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
    s3_key        TEXT    NOT NULL,          -- the single stored object key (served as-is via CloudFront)
    content_type  TEXT    NOT NULL,          -- validated MIME (image/jpeg | image/png | image/webp)
    size_bytes    INTEGER,                   -- object size from the S3 HEAD (≤ 5 MB)
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

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
    created_by      VARCHAR(255) NOT NULL,   -- app-user ULID (from token claim); no FK, no local users table
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
    owner_id            VARCHAR(255) NOT NULL,   -- app-user ULID (from token claim); no FK, no local users table
    name                 TEXT        NOT NULL,
    description          TEXT,

    -- Collection visibility (FR-010). Collections are PRIVATE by default; a
    -- collection must be explicitly made 'public' before it can be discovered
    -- or cloned by another user (FR-011 clone-a-public-collection depends on this).
    visibility           TEXT        NOT NULL DEFAULT 'private'
                         CHECK (visibility IN ('public', 'private')),

    -- Clone provenance (FR-011). NULL = original collection authored by owner.
    -- NOT NULL = this collection was cloned from another (snapshot at clone time).
    -- Pull-from-source updates are EXPLICIT and OPT-IN; setting this column
    -- never causes implicit re-sync of recipe membership.
    -- ON DELETE SET NULL (T119): deleting a source collection orphans the clone's
    -- provenance pointer rather than cascading the delete to the clone.
    source_collection_id UUID        REFERENCES collections(id) ON DELETE SET NULL,

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

CREATE INDEX idx_collections_owner_id            ON collections (owner_id);
CREATE INDEX idx_collections_source_collection   ON collections (source_collection_id)
    WHERE source_collection_id IS NOT NULL;
CREATE INDEX idx_recipe_collections_recipe_id    ON recipe_collections (recipe_id);
```

**Clone semantics (FR-011)**:

- Cloning a collection inserts a new `collections` row with `source_collection_id` set to the source, plus one `recipe_collections` row per source recipe with `added_via = 'clone_seed'`.
- Subsequent edits to the source collection do **not** propagate automatically.
- The owner of the cloned collection may invoke `POST /v1/collections/{id}/pull-from-source` to fetch new recipes added to the source since the last pull; new memberships are inserted with `added_via = 'pull'`. Removed recipes in the source are **not** removed from the clone.

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

## Photo Upload Flow

Photos are stored and served **as-is** — no resizing, no derived variants, no async processing. The
flow is fully synchronous within the Fargate recipe API; there is no photo-processor Lambda and no
`photo-processed` SQS queue.

```
POST /v1/recipes/{id}/photos/upload-url
  → Fargate recipe API generates an S3 presigned PUT URL
    (ContentLengthRange ≤ 5 MB; ContentType restricted to the allowlist)
  → Returns { uploadUrl, key, expiresIn: 900 }

Client PUT → s3://bucket/photos/{uuid}.{ext}

POST /v1/recipes/{id}/photos/confirm { key, contentType }
  → Fargate recipe API validates the uploaded object:
     ├── reads the file's leading bytes and checks the magic-byte signature
     │   (JPEG / PNG / WebP — NOT the client-supplied Content-Type); reject others
     └── S3 HEAD → size_bytes ≤ 5 MB; reject otherwise
  → INSERT recipe_photos { s3_key, content_type, size_bytes, sort_order }

Serving:
  https://cdn.commise.app/{s3_key}   (CloudFront, immutable cache — the object served unmodified)
```

Presigned URL constraint (5 MB limit + allowlisted content type):

```typescript
const command = new PutObjectCommand({
    Bucket: process.env.UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType, // one of image/jpeg | image/png | image/webp
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

- **Drizzle ORM** (`drizzle-orm` + `pg`) for schema definitions in `packages/services/recipe-service/src/database/schema/`
- **drizzle-kit** for migration generation (`drizzle-kit generate`) and execution (`drizzle-kit migrate`)
- Migrations live in `packages/services/recipe-service/src/database/migrations/` (auto-generated, committed to git)
- Schema files: `recipes.ts`, `ingredients.ts`, `versions.ts`, `photos.ts`, `collections.ts`

The recipe service (`@kitchensink/recipe-service`) **uses the shared RDS instance with its own logical
database `kitchensink_recipes`** — it does **not** provision a new RDS instance. The database + its owning
role are provisioned by a **`RecipeDbBootstrap` custom resource** (a master-connected Lambda mirroring
`FoodDbBootstrap`): a passwordless **IAM-auth `recipe_app` LOGIN role** (`GRANT rds_iam`) and the base
`kitchensink_recipes` database. The service authenticates with **short-lived RDS IAM tokens** (no password
secret), its Fargate task role granted `rds-db:connect` scoped to the `recipe_app` db-user, and
`Fn.importValue`s the shared instance endpoint exactly as the food service does. Tables use the default `public` schema within
`kitchensink_recipes` — the logical database is the isolation boundary, so no PII adjacency and no
cross-database FKs. There is **no** shared db package. The recipe service does **not** own a `users` table: `owner_id` / `created_by` store the
app-user ULID (from the token claim) directly (`VARCHAR(255) NOT NULL`, no FK, no read-through user replication);
author display/profile is resolved via the identity client (002) when needed.

The Drizzle schema is the **source of truth** — this DDL document is a design reference only.

### Trigger Setup

The `recipes_search_vector_update()` trigger function (see Search Vector Maintenance above) is created via a **custom SQL migration** in drizzle-kit, since Drizzle ORM does not natively support trigger definitions. Add as a `sql` block in the initial migration:

```typescript
// packages/services/recipe-service/src/database/migrations/0001_add_search_trigger.ts
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

1. Frontend calls `POST /v1/account/erasure` (idempotent per C-007) to enumerate the user's tombstoned + active recipes, photos, versions, collections, and pending archives.
2. User confirms; backend records an `erasure_request` audit row (out of scope for this feature; tracked in compliance backlog) and enqueues an erasure job.
3. Erasure worker, in order:
    - DELETEs `recipe_version_pending_archives` rows for the user's recipes.
    - DELETEs S3 objects under `versions/{recipe_id}/` and `photos/{recipe_id}/` for each owned recipe.
    - DELETEs `recipe_versions`, `recipe_photos`, `recipe_ingredients`, `recipe_steps`, `recipe_collections`, `recipes`, and `collections` for the user.

    (No local `users` row to delete — the recipe service does not own one; the user's identity record is erased by feature 002.)

4. Cloned descendants owned by **other** users are unaffected; their `cloned_from_id` is set to NULL by the erasure worker prior to deleting the source recipe to preserve referential integrity without leaking source data.

This is the **only** code path permitted to issue `DELETE FROM recipes`. All other "delete" operations MUST set `deleted_at` instead.

### `account_erasure_jobs` (erasure idempotency, C-007)

Tracks each `POST /v1/account/erasure` enqueue so the endpoint is idempotent per C-007 (**not** a 409).
This table is the **single authoritative source** for the erasure job status enum.

```sql
CREATE TABLE account_erasure_jobs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- App-user ULID (from token claim) of the user whose data is being erased. No FK, no local users table.
    owner_id    VARCHAR(255) NOT NULL,

    -- Canonical erasure job status enum (authoritative source for every artifact).
    --   'queued'    → enqueued, worker has not started
    --   'running'   → worker is draining the erasure steps
    --   'completed' → all data physically removed (terminal)
    --   'failed'    → worker errored; a fresh POST retries (terminal-until-retry)
    status       TEXT        NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    attempts     INTEGER     NOT NULL DEFAULT 0,
    last_error   TEXT,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one in-flight job per user: a duplicate POST while a job is 'queued'/'running'
-- collides here, so the endpoint returns 202 with the existing job id (no second enqueue).
CREATE UNIQUE INDEX idx_erasure_jobs_active_owner
    ON account_erasure_jobs (owner_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX idx_erasure_jobs_status
    ON account_erasure_jobs (status)
    WHERE status IN ('queued', 'running');
```

**Idempotency behavior (C-007)** — `POST /v1/account/erasure`:

- Duplicate while a job is `queued`/`running` → **202 with the existing job id** (no second enqueue).
- After a `completed` job → **410** (already erased).
- After a `failed` job → **202** (fresh retry; a new `queued` job is enqueued).

The cron sweeper re-drains jobs stuck in `queued`/`running` (see plan.md).

---

## Read-path filter rule (C-007)

Every query against `recipes` in production code paths MUST include `AND r.deleted_at IS NULL` (or the equivalent in Drizzle ORM via a shared `activeRecipes()` query helper). The only exceptions are:

- The GDPR erasure preview endpoint.
- The erasure worker itself.
- Internal admin/debug tooling explicitly scoped to tombstone inspection.

A repository-wide ESLint rule (`no-raw-recipes-select`) enforces use of the `activeRecipes()` helper for SELECTs against the `recipes` table.
