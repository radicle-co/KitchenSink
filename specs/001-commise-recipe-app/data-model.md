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
   ├──< recipe_ratings          (CR-001; one row per (recipe, user))
   └──< recipe_collections >── collections
```

> **Owner-scoped roots (C-007).** Three columns are roots of user-owned data and every one of them must
> be reached by GDPR erasure: `recipes.owner_id`, `collections.owner_id`, and — added by CR-001 —
> **`recipe_ratings.user_id`**. A rating is authored by its rater, not by the rated recipe's owner, so it
> is the only owner-scoped root that routinely lives on **another user's** row. See
> [Soft Delete & GDPR Erasure](#soft-delete--gdpr-erasure-c-007).

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

    -- Difficulty (CR-001 / FR-001b). NULLABLE ON PURPOSE — "the author did not say" is a real,
    -- representable state, and there is no honest default. Unlike servings/times (0007/0008), which
    -- are load-bearing (scaling + nutrition) and always knowable, difficulty is a subjective
    -- judgement nothing computes from. A NOT NULL DEFAULT 'medium' would make every recipe claim its
    -- author chose "medium" — fabricated authorship, and wrong the moment 004 imports a recipe whose
    -- source states no difficulty. NULL renders as NO badge, never as a guess.
    difficulty             TEXT        CHECK (difficulty IN ('easy', 'medium', 'hard')),

    -- Denormalized rating aggregate (CR-001 / FR-013a) — maintained ONLY by the
    -- recipe_ratings_aggregate_refresh() trigger below. Never written by application code.
    -- average_rating IS NULL exactly when rating_count = 0 (an unrated recipe has no average; 0.00
    -- would render as a real zero-star score). The CHECK makes that pairing unrepresentable.
    average_rating         NUMERIC(3,2),
    rating_count           INTEGER     NOT NULL DEFAULT 0,
    CONSTRAINT recipes_rating_count_nonneg CHECK (rating_count >= 0),
    CONSTRAINT recipes_average_rating_range
        CHECK (average_rating IS NULL OR (average_rating >= 1 AND average_rating <= 5)),
    CONSTRAINT recipes_rating_aggregate_coherent
        CHECK ((rating_count = 0) = (average_rating IS NULL)),

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

-- CR-001 / FR-001c: serves the cover-photo LATERAL on the recipe LIST projection (one photo per recipe,
-- lowest sort_order). Supersedes idx_recipe_photos_recipe_id for that access path (leftmost prefix).
CREATE INDEX idx_recipe_photos_recipe_cover ON recipe_photos (recipe_id, sort_order, created_at, id);
```

**Enforcement note**: The 10-photo limit per recipe is enforced in the service layer via a COUNT check before INSERT, with a database advisory lock to prevent race conditions.

#### Cover photo resolution (CR-001 / FR-001c)

The recipe **list** projection carries a `coverPhotoUrl` so the Home widget and the list grid can render a
card image without an N+1 fetch of each recipe's detail. It is **derived, not stored**: the cover is the
recipe's photo with the lowest `sort_order`.

`sort_order` is not unique per recipe (it defaults to `0`), so the tiebreak is part of the rule — without it
the chosen cover can flip between two equally-ordered photos from one request to the next:

```sql
-- Cover photo for a page of recipes: ONE query, no N+1.
SELECT r.*, cp.s3_key AS cover_photo_key
FROM recipes r
LEFT JOIN LATERAL (
    SELECT p.s3_key
    FROM recipe_photos p
    WHERE p.recipe_id = r.id
    ORDER BY p.sort_order, p.created_at, p.id   -- deterministic: sort_order alone can tie
    LIMIT 1
) cp ON true
WHERE r.deleted_at IS NULL;
```

A recipe with no photos yields `NULL` → `coverPhotoUrl` is **absent** from the response (never `null`, never
a placeholder image URL — the client owns the no-image visual).

> ⚠️ **Known performance risk (accepted, with a named follow-up).** Photos are stored and served **as-is** —
> no resizing, no derived variants (see [Photo Upload Flow](#photo-upload-flow)). The card renders a 4:3
> thumbnail, so `coverPhotoUrl` today makes the client download the **full-size original** (up to 5 MB per
> photo) to paint a ~300 px tile. A 4-card Home widget can therefore pull ~20 MB on first paint. This is a
> real regression risk against **SC-009** and mobile data use, and it is **not** solved by CR-001. Tracked
> as **FOLLOW-UP-CR-001-A** (derived photo renditions / thumbnail variants) in
> [CR-001](./change-requests/CR-001-mockup-parity.md); it must be resolved before the Home widget is
> considered release-ready on mobile.

---

## Derived read-model properties (CR-001)

Some card fields the mockup shows are **not columns** and MUST NOT become columns. They are computed on
projection from data the row already carries, so they cannot drift out of sync with the truth they derive
from, and they cost no migration and no write path.

| Property                | Derived from                                 | Rule                                                                    |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `usesPremiumCapability` | `recipes.visibility` + `recipes.source_type` | See below (FR-003a). One authoritative implementation in `recipe-core`. |
| `coverPhotoUrl`         | `recipe_photos` (lowest `sort_order`)        | See [Cover photo resolution](#cover-photo-resolution-cr-001--fr-001c).  |

### `usesPremiumCapability` — the PRO badge (FR-003a)

The PRO badge means **"this recipe uses a capability only a premium user has"**. It is **derived, never
stored**: there is no `is_pro` column, no entitlement model, and no overlap with feature 010.

The **only** premium-gated recipe capability today is **choosing** private visibility. The naive rule
`visibility === 'private'` is **wrong**, and this is the trap to avoid:

| Condition                    | Private allowed?                    | Premium capability used? |
| ---------------------------- | ----------------------------------- | ------------------------ |
| `user_created`, private      | premium only                        | **yes**                  |
| `imported_public`, private   | premium only (+ substantive edit)   | **yes**                  |
| `imported_physical`, private | **any tier** — private is forced    | **no**                   |
| `imported_paid`, private     | **any tier** — private is permanent | **no**                   |

Per C-004, `imported_physical` and `imported_paid` recipes are private **regardless of tier**, so a
free-tier user can hold private recipes. `visibility === 'private'` alone would brand those with a PRO
badge they did not earn. The correct rule is therefore:

```
usesPremiumCapability = visibility === 'private'
                        AND source_type IN ('user_created', 'imported_public')
```

This is only latent today (004 has not shipped, so every row is `user_created`), which is exactly why it
must be encoded correctly **now** — while the rule lives in one place and costs nothing to get right.

**One authoritative representation (DRY).** The rule is implemented **once**, as a pure function in
`@kitchensink/recipe-core`, and called by both the list and the detail projection. It is never re-derived
in a mapper, a controller, or a client. **Forward path:** when 010 ships real entitlements, this function is
the single place that changes — no wire change, no client change, which is precisely why the derived value
is exposed as a field rather than left for clients to compute.

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

### `recipe_ratings` (CR-001 / FR-013)

One row per (recipe, rater). Re-rating **updates** the row; it never inserts a second one. `user_id` is the
**rater's** app-user ULID — not the recipe owner's — which makes this table the third owner-scoped erasure
root (see [Soft Delete & GDPR Erasure](#soft-delete--gdpr-erasure-c-007)).

```sql
CREATE TABLE recipe_ratings (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id   UUID         NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    -- App-user ULID of the RATER (from token claim). No FK, no local users table (D2) — same rule as
    -- recipes.owner_id / collections.owner_id.
    user_id     VARCHAR(255) NOT NULL,
    stars       INTEGER      NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT recipe_ratings_stars_range CHECK (stars BETWEEN 1 AND 5),
    -- One rating per user per recipe. This is also the conflict target of the idempotent
    -- PUT /v1/recipes/{id}/rating upsert (ON CONFLICT (recipe_id, user_id) DO UPDATE).
    CONSTRAINT recipe_ratings_recipe_user_unique UNIQUE (recipe_id, user_id)
);

-- The UNIQUE constraint's index is (recipe_id, user_id) — leftmost-prefix, so it already serves
-- "all ratings for a recipe" (the aggregate recompute). No separate recipe_id index is needed.

-- REQUIRED for GDPR erasure: the sweep is `DELETE FROM recipe_ratings WHERE user_id = :ownerId`.
-- Without this index that delete is a Seq Scan of every rating in the system (verified by EXPLAIN).
CREATE INDEX idx_recipe_ratings_user_id ON recipe_ratings (user_id);
```

**Rating rules (FR-013)** — enforced in the service layer, not at the DB (they are business rules, not
schema invariants, per the same split as [Visibility Enforcement](#visibility-enforcement-rules-c-004)):

- A user may rate any recipe they can **see**. The existing read-path visibility/IDOR rule governs, so a
  recipe the caller cannot read is **not rateable and MUST NOT be distinguishable from a non-existent
  one** — same `404 RECIPE_NOT_FOUND` as a read, never `403`.
- A user MUST NOT rate their **own** recipe (`recipes.owner_id = :userId` → `403 CANNOT_RATE_OWN_RECIPE`).
  `403` is correct _here_ — the caller demonstrably already knows the recipe exists, so there is nothing to leak.
- A tombstoned recipe (`deleted_at IS NOT NULL`) is not rateable → `404`.

#### Rating Aggregate Maintenance (PostgreSQL Trigger)

`recipes.average_rating` / `recipes.rating_count` are **trigger-maintained**, following the same pattern as
the trigger-maintained `search_vector` above: the database owns the derived value, so no application path —
including the bulk deletes in the erasure worker and the FK cascade — can bypass it and leave the aggregate
wrong.

Two properties of this design are **load-bearing and non-obvious**; both were verified empirically against
PostgreSQL 16 before this DDL was written:

1. **It is a STATEMENT-level trigger over a transition table, not a row-level trigger.** A bulk
   `DELETE FROM recipe_ratings WHERE user_id = :ownerId` (GDPR erasure) fires it **once**, not once per row
   (`EXPLAIN ANALYZE` → `Trigger trg_recipe_ratings_agg_del: calls=1`). Note that PostgreSQL forbids
   transition tables on a multi-event trigger, which is why there are **three** single-event triggers
   sharing one function rather than one `INSERT OR UPDATE OR DELETE` trigger.
2. **The `FOR UPDATE` lock is not optional — it is the correctness fix for a lost update.** Without it, two
   users rating the same recipe concurrently at READ COMMITTED silently corrupt the aggregate: the second
   transaction's recompute reads a snapshot taken _before_ the first committed, blocks on the row lock, then
   writes its stale count over the fresh one. Measured on PG 16: two concurrent raters produced
   `rating_count = 1, average_rating = 3.00` against a ground truth of `2 / 4.00` — and it never self-heals.
   Taking the lock **first** forces the aggregate statement onto a fresh snapshot that sees the committed
   row. `ORDER BY id` gives a deterministic lock order so multi-recipe statements cannot deadlock.

```sql
CREATE OR REPLACE FUNCTION recipe_ratings_aggregate_refresh() RETURNS trigger AS $$
BEGIN
  -- Lock the affected recipes FIRST, in a deterministic order. Under READ COMMITTED this blocks a
  -- concurrent rater of the same recipe until it commits; the aggregate below then runs on a fresh
  -- snapshot that includes that commit. Without this lock the recompute silently writes a stale
  -- aggregate (lost update) that never self-corrects.
  PERFORM 1 FROM recipes
   WHERE id IN (SELECT DISTINCT recipe_id FROM changed_rows)
   ORDER BY id
     FOR UPDATE;

  WITH affected AS (
      SELECT DISTINCT recipe_id FROM changed_rows
  ), agg AS (
      -- LEFT JOIN so a recipe whose last rating was just deleted yields cnt = 0 (and NULL average)
      -- rather than dropping out of the result and keeping a stale count.
      SELECT a.recipe_id,
             COUNT(rr.id)               AS cnt,
             AVG(rr.stars)::NUMERIC(3,2) AS avg_stars
      FROM affected a
      LEFT JOIN recipe_ratings rr ON rr.recipe_id = a.recipe_id
      GROUP BY a.recipe_id
  )
  UPDATE recipes r
     SET rating_count   = agg.cnt,
         average_rating = CASE WHEN agg.cnt = 0 THEN NULL ELSE agg.avg_stars END
    FROM agg
   WHERE r.id = agg.recipe_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Transition tables are not permitted on a multi-event trigger, so: one trigger per event, one shared
-- function, all referencing the transition table under the same name `changed_rows`.
CREATE TRIGGER trg_recipe_ratings_agg_ins AFTER INSERT ON recipe_ratings
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT
  EXECUTE FUNCTION recipe_ratings_aggregate_refresh();

CREATE TRIGGER trg_recipe_ratings_agg_upd AFTER UPDATE ON recipe_ratings
  REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT
  EXECUTE FUNCTION recipe_ratings_aggregate_refresh();

CREATE TRIGGER trg_recipe_ratings_agg_del AFTER DELETE ON recipe_ratings
  REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT
  EXECUTE FUNCTION recipe_ratings_aggregate_refresh();
```

**Recipe-delete cascade is safe (verified).** `DELETE FROM recipes` cascades to `recipe_ratings`, which
fires `trg_recipe_ratings_agg_del`, whose `UPDATE recipes` then matches zero rows because the recipe is
already gone. It is a single silent no-op — no error, no orphan rows.

**Why trigger-maintained and not computed on read** — see [CR-001 § D-B](./change-requests/CR-001-mockup-parity.md).
In one line: the read path (Home widget + list, every session, every user) vastly outnumbers the write path
(rating a recipe, once per user per recipe), so the aggregate is computed once per _write_ instead of on
every _read_, and it arrives free in the `recipes` row the list query already selects — no JOIN, no
GROUP BY, and it stays sortable/indexable if rating-ordered browse is ever added.

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

Client PUT → s3://{RECIPE_MEDIA_BUCKET}/recipes/{ownerId}/{recipeId}/photos/{uuid}
             (ARCH-BE-3 — owner-prefixed. The key MUST start with `recipes/{ownerId}/` or the object
              silently survives GDPR erasure, whose sweep matches exactly that prefix.)

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
2. Serialize snapshot → upload to S3 at `recipeVersionArchiveKey({ ownerId, recipeId, versionNumber })`
   = `recipes/{ownerId}/{recipeId}/versions/{version_number}.json` (ARCH-BE-3 — owner-prefixed, built
   ONLY via `@kitchensink/recipe-core`, never hand-assembled)
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

| Condition                    | Allowed visibility                                    |
| ---------------------------- | ----------------------------------------------------- |
| Free-tier user, user_created | `public` only                                         |
| Premium user, user_created   | `public` or `private`                                 |
| Any user, imported_public    | `public` or `private` — see the clone amendment below |
| Any user, imported_physical  | `private` only                                        |
| Any user, imported_paid      | `private` only (permanent)                            |
| Premium lapse                | No new private; existing private stay private         |

Enforced in service layer (`RecipeService.setVisibility()`), NOT at DB constraint level (visibility rules are business logic, not schema invariants).

> **⚠️ Amended 2026-08-22 (C-016-003 / A-4) — matrix updated, code NOT updated.**
>
> The `imported_public` row previously read "`public` only — unless premium AND `has_substantive_edit = true`".
> Under [016](../016-legal-compliance-framework/spec.md) `FR-015b`, the substantive edit gates **publication**
> rather than **privacy**, and the premium gate on clone-privacy is removed (D4a / 015 C-015-001).
>
> Two consequent changes to `packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts` are
> **specified but not made** — they are implementation work and need their own failing tests first:
>
> 1. `evaluateVisibility` — the `IMPORTED_PUBLIC` + `private` branch drops its `isPremium` and
>    `hasSubstantiveEdit` denials; a new denial gates **publication** of any clone lacking a substantive edit.
> 2. `defaultCloneVisibility` — an unmodified clone is not publishable, so it can no longer default to
>    `PUBLIC` for non-physical/paid sources.
>
> `evaluateVisibility`'s input may also need a provenance-restriction term for `001-FR-005a`; no such signal
> exists in the schema today, so that requirement is blocked on modelling it.

---

## Implementation Notes

### ORM: Drizzle + drizzle-kit Migrations

All schema in this document is expressed as reference SQL DDL for clarity. The **actual implementation** uses:

- **Drizzle ORM** (`drizzle-orm` + `pg`) for schema definitions in `packages/services/recipe-service/src/database/schema/`
- **drizzle-kit** for migration generation (`drizzle-kit generate`) and execution (`drizzle-kit migrate`)
- Migrations live in `packages/services/recipe-service/src/database/migrations/` (auto-generated, committed to git)
- Schema files: `recipes.ts`, `ingredients.ts`, `versions.ts`, `photos.ts`, `collections.ts`, `ratings.ts` (CR-001)

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

> The same applies to `recipe_ratings_aggregate_refresh()` and its three triggers (see
> [Rating Aggregate Maintenance](#rating-aggregate-maintenance-postgresql-trigger)) — hand-authored SQL in
> the CR-001 migration, not Drizzle-generated. Drizzle's schema definition for `recipes.average_rating` /
> `recipes.rating_count` describes the columns only; the **trigger** is what maintains them, and no
> application code may write those two columns.

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
3. Archive worker Lambda consumes the message, sets status=`in_flight`, uploads the JSON snapshot to `s3://{RECIPE_ARCHIVE_BUCKET}/` + `recipeVersionArchiveKey({ ownerId, recipeId, versionNumber })` = `recipes/{ownerId}/{recipeId}/versions/{version_number}.json` (ARCH-BE-3 — the key comes from `@kitchensink/recipe-core`; the service and worker MUST NOT each build their own, which is the drift that defect recorded), then sets `recipe_versions.s3_key` and DELETEs the pending row on success.
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
3. Erasure worker, **rows first, then the S3 sweeps** (see the ordering note below):

    1. DELETEs **`recipe_ratings` rows authored BY the user** (`WHERE user_id = :ownerId`) — the CR-001
       third owner-scoped root. These live on **other users' recipes**, which survive. The aggregate
       trigger re-derives `average_rating` / `rating_count` on each affected surviving recipe. Uses
       `idx_recipe_ratings_user_id`.
    2. Sets `cloned_from_id = NULL` on cloned descendants owned by **other** users (step 5 below).
    3. DELETEs `recipe_version_pending_archives` rows for the user's recipes.
    4. DELETEs `recipe_versions`, `recipe_photos`, `recipe_ingredients`, `recipe_steps`,
       `recipe_collections`, `recipes`, and `collections` for the user. Deleting the user's own recipes
       cascades to `recipe_ratings` rows authored by **other** users on those recipes — correct: the rated
       recipe ceases to exist.
    5. **Then** sweeps S3: deletes every object under `ownerMediaPrefix(ownerId)` = `recipes/{ownerId}/`
       in **both** `RECIPE_MEDIA_BUCKET` and `RECIPE_ARCHIVE_BUCKET` (ARCH-BE-3 —
       `@kitchensink/recipe-core`). Version archives live under the same owner prefix **by design**, which
       is precisely what lets one prefix sweep reach them.

    (No local `users` row to delete — the recipe service does not own one; the user's identity record is erased by feature 002.)

    > **Ordering: rows first, then S3 — and why this reversed.** An earlier revision of this document
    > prescribed S3-before-rows. That order existed **only** because the key scheme it assumed was
    > _row-enumerated_ (`photos/{recipe_id}/`): you had to read the rows to learn which objects to delete,
    > so the rows had to outlive the sweep. **ARCH-BE-3's owner-prefixed keys removed that constraint** —
    > the sweep is a pure prefix scan that never reads the database. Deleting rows first is therefore
    > strictly better: the reverse leaves live rows pointing at already-deleted objects (broken reads for
    > the window between the two steps) and widens the failure race. Both the key scheme and the step order
    > in this section were stale against ARCH-BE-3; they are the same root cause, fixed together (CR-001).

4. **The erasure worker MUST NOT disable triggers** (`ALTER TABLE … DISABLE TRIGGER`) to speed up the bulk
   deletes. Doing so would leave **other users'** recipes holding permanently wrong rating aggregates with
   nothing to repair them. It is not needed for performance: the aggregate trigger is **statement-level**,
   so the whole `DELETE … WHERE user_id = :ownerId` fires it exactly **once** regardless of how many ratings
   the user authored (verified: `Trigger trg_recipe_ratings_agg_del: calls=1`).
5. Cloned descendants owned by **other** users are unaffected; their `cloned_from_id` is set to NULL by the erasure worker prior to deleting the source recipe to preserve referential integrity without leaking source data.

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

> **Who writes `failed` — the worker deliberately does NOT.** On error the erasure worker records
> `attempts` / `last_error`, **leaves the job `running`**, and rethrows so SQS redelivers. Giving up is the
> DLQ's decision, not the worker's. This is not an oversight, and it must not be "fixed" into a
> `status = 'failed'` write inside the worker, for two compounding reasons:
>
> 1. `failed` drops the job out of the `queued`/`running` set that the cron sweeper re-drains — so a job
>    that marked itself failed would be abandoned by the very mechanism meant to recover it.
> 2. `failed` frees `idx_erasure_jobs_active_owner` (the partial unique index covers only
>    `queued`/`running`). A re-`POST` would then insert a **second** active job, and the original SQS
>    message's next retry would crash on that index.
>
> The `failed` state is therefore **terminal-until-retry and written from exactly one place outside the
> worker**. Which place is being decided in **T136b** (a DLQ-subscribed handler vs. the sweeper detecting
> exhausted `attempts`); until T136b lands, **nothing writes `failed`** and the third bullet above is
> unreachable in practice. The idempotency contract above is unchanged and remains correct — this note
> records the _writer_, which was previously unstated and made the `failed` path read as reachable when no
> code produced it.

---

## Read-path filter rule (C-007)

Every query against `recipes` in production code paths MUST include `AND r.deleted_at IS NULL` (or the equivalent in Drizzle ORM via a shared `activeRecipes()` query helper). The only exceptions are:

- The GDPR erasure preview endpoint.
- The erasure worker itself.
- Internal admin/debug tooling explicitly scoped to tombstone inspection.

A repository-wide ESLint rule (`no-raw-recipes-select`) enforces use of the `activeRecipes()` helper for SELECTs against the `recipes` table.
