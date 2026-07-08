-- 0001: kitchensink_recipes initial schema (feature 001 — Commise recipe management core)
--
-- Hand-authored, ordered DDL — the SOURCE OF TRUTH the in-VPC migration runner applies (repo
-- convention, mirrors packages/services/{identity,food-service}/src/database/migrations/*.sql). The
-- Drizzle definitions in src/database/schema/*.ts drive the ORM/query layer and document the same
-- shapes (final state); this file + the 0002–0005 deltas are what run against the kitchensink_recipes
-- logical database on the shared kitchensink-data-{stage} instance.
--
-- Base tables only. The Phase-2 schema deltas are applied by subsequent migrations:
--   0002_soft_delete           → recipes.deleted_at + partial owner index (T118)
--   0003_collection_provenance → collections.source_collection_id + recipe_collections.added_via (T119)
--   0004_pending_archives      → recipe_version_pending_archives (T121)
--   0005_account_erasure       → account_erasure_jobs (T122)
--
-- Order: extensions -> tables -> indexes -> FTS trigger. Controlled value sets use TEXT + CHECK
-- (data-model.md), not native enums. No local users table (D2): owner_id / created_by store the
-- app-user ULID directly (VARCHAR(255) NOT NULL, no FK, no user replication).

-- gen_random_uuid() (UUID PKs) + pg_trgm (fuzzy ingredient autocomplete). Pre-bootstrapped on the
-- shared instance; a fresh/test DB needs them created here (pg_trgm must precede the GIN trigram index).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── recipes: the golden row ───────────────────────────────────────────────────────────────────────
CREATE TABLE "recipes" (
    "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_id"              varchar(255) NOT NULL,
    "title"                 text NOT NULL,
    "description"           text,
    "prep_time_minutes"     integer,
    "cook_time_minutes"     integer,
    "total_time_minutes"    integer,
    "servings"              integer,
    "visibility"            text DEFAULT 'public' NOT NULL,
    "source_type"           text DEFAULT 'user_created' NOT NULL,
    "source_url"            text,
    "source_attribution"    text,
    "cloned_from_id"        uuid REFERENCES "recipes"("id"),
    "has_substantive_edit"  boolean DEFAULT false NOT NULL,
    "cuisine"               text,
    "dietary_flags"         text[] DEFAULT '{}' NOT NULL,
    "tags"                  text[] DEFAULT '{}' NOT NULL,
    "has_partial_nutrition" boolean DEFAULT false NOT NULL,
    "current_version"       integer DEFAULT 1 NOT NULL,
    "ingredient_names_text" text DEFAULT '' NOT NULL,
    "search_vector"         tsvector,
    "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"            timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "recipes_prep_time_nonneg"  CHECK ("prep_time_minutes" >= 0),
    CONSTRAINT "recipes_cook_time_nonneg"  CHECK ("cook_time_minutes" >= 0),
    CONSTRAINT "recipes_total_time_nonneg" CHECK ("total_time_minutes" >= 0),
    CONSTRAINT "recipes_servings_positive" CHECK ("servings" > 0),
    CONSTRAINT "recipes_visibility_check"  CHECK ("visibility" IN ('public', 'private')),
    CONSTRAINT "recipes_source_type_check"
        CHECK ("source_type" IN ('user_created', 'imported_public', 'imported_physical', 'imported_paid'))
);

-- ── recipe_steps: ordered instructions (FK → recipes ON DELETE CASCADE) ───────────────────────────
CREATE TABLE "recipe_steps" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_id"     uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "step_number"   integer NOT NULL,
    "instruction"   text NOT NULL,
    "timer_seconds" integer,
    CONSTRAINT "recipe_steps_step_number_positive"    CHECK ("step_number" > 0),
    CONSTRAINT "recipe_steps_timer_seconds_positive"  CHECK ("timer_seconds" IS NULL OR "timer_seconds" > 0),
    CONSTRAINT "recipe_steps_recipe_step_unique"      UNIQUE ("recipe_id", "step_number")
);

-- ── ingredients: food-service-backed + user-entered catalog ───────────────────────────────────────
-- food_id is an OPAQUE cross-service reference to the food service's internal ULID (003) — NEVER a USDA
-- fdcId, NOT a cross-DB FK. food_resolution_status mirrors the food client FoodStatus (UPPER_SNAKE).
CREATE TABLE "ingredients" (
    "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name"                   text NOT NULL,
    "food_id"                text,
    "food_resolution_status" text,
    "is_user_entered"        boolean DEFAULT false NOT NULL,
    "calories_per_100g"      numeric(8, 2),
    "protein_g_per_100g"     numeric(8, 2),
    "carbs_g_per_100g"       numeric(8, 2),
    "fat_g_per_100g"         numeric(8, 2),
    "search_vector"          tsvector,
    "created_at"             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ingredients_food_resolution_status_check"
        CHECK ("food_resolution_status" IN ('PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED'))
);

-- ── recipe_ingredients: junction with denormalized display + user-entered nutrition ───────────────
CREATE TABLE "recipe_ingredients" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_id"       uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "ingredient_id"   uuid NOT NULL REFERENCES "ingredients"("id"),
    "quantity"        numeric(10, 3) NOT NULL,
    "unit"            text NOT NULL,
    "display_text"    text,
    "sort_order"      integer DEFAULT 0 NOT NULL,
    "ingredient_name" text NOT NULL,
    "is_user_entered" boolean DEFAULT false NOT NULL,
    "user_calories"   numeric(8, 2),
    "user_protein_g"  numeric(8, 2),
    "user_carbs_g"    numeric(8, 2),
    "user_fat_g"      numeric(8, 2),
    CONSTRAINT "recipe_ingredients_quantity_positive" CHECK ("quantity" > 0)
);

-- ── recipe_photos: S3-backed images validated by magic bytes + size, served as-is via CloudFront ───
-- No resizing/variants/processing state: a single stored object key per photo (the object served
-- unmodified). The recipe API inserts the row synchronously on confirm; there is no photo-processor.
CREATE TABLE "recipe_photos" (
    "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_id"    uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "s3_key"       text NOT NULL,
    "content_type" text NOT NULL,
    "size_bytes"   integer,
    "sort_order"   integer DEFAULT 0 NOT NULL,
    "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"   timestamp with time zone DEFAULT now() NOT NULL,
    -- Advisory only — the real 10-per-recipe cap is enforced in the service layer (COUNT + advisory lock).
    CONSTRAINT "max_photos_per_recipe" CHECK (true)
);

-- ── recipe_versions: snapshot history (last 10 in DB, all in S3). created_by = app-user ULID (D2). ─
CREATE TABLE "recipe_versions" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_id"      uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "version_number" integer NOT NULL,
    "snapshot"       jsonb NOT NULL,
    "base_version"   integer,
    "s3_key"         text,
    "created_by"     varchar(255) NOT NULL,
    "change_summary" text,
    "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "recipe_versions_recipe_version_unique" UNIQUE ("recipe_id", "version_number")
);

-- ── collections: private by default. owner_id = app-user ULID (D2). ───────────────────────────────
CREATE TABLE "collections" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_id"    varchar(255) NOT NULL,
    "name"        text NOT NULL,
    "description" text,
    "visibility"  text DEFAULT 'private' NOT NULL,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "collections_visibility_check" CHECK ("visibility" IN ('public', 'private'))
);

-- ── recipe_collections: junction (composite PK). ──────────────────────────────────────────────────
CREATE TABLE "recipe_collections" (
    "collection_id" uuid NOT NULL REFERENCES "collections"("id") ON DELETE CASCADE,
    "recipe_id"     uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "added_at"      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "recipe_collections_pk" PRIMARY KEY ("collection_id", "recipe_id")
);

-- ── Indexes ───────────────────────────────────────────────────────────────────────────────────────
-- recipes: FTS (primary search path), faceted B-tree filters, array facet GINs, and the hot
-- public-recent composite. (idx_recipes_owner_id is redefined as a partial index in 0002_soft_delete.)
CREATE INDEX "idx_recipes_search_vector" ON "recipes" USING gin ("search_vector");
CREATE INDEX "idx_recipes_owner_id"      ON "recipes" USING btree ("owner_id");
CREATE INDEX "idx_recipes_visibility"    ON "recipes" USING btree ("visibility");
CREATE INDEX "idx_recipes_cuisine"       ON "recipes" USING btree ("cuisine");
CREATE INDEX "idx_recipes_cloned_from"   ON "recipes" USING btree ("cloned_from_id");
CREATE INDEX "idx_recipes_dietary_flags" ON "recipes" USING gin ("dietary_flags");
CREATE INDEX "idx_recipes_tags"          ON "recipes" USING gin ("tags");
CREATE INDEX "idx_recipes_public_recent" ON "recipes" USING btree ("visibility", "created_at" DESC)
    WHERE "visibility" = 'public';

CREATE INDEX "idx_recipe_steps_recipe_id" ON "recipe_steps" USING btree ("recipe_id");

CREATE INDEX "idx_ingredients_search_vector" ON "ingredients" USING gin ("search_vector");
CREATE INDEX "idx_ingredients_food_id"       ON "ingredients" USING btree ("food_id") WHERE "food_id" IS NOT NULL;
CREATE INDEX "idx_ingredients_name_trgm"     ON "ingredients" USING gin ("name" gin_trgm_ops);

CREATE INDEX "idx_recipe_ingredients_recipe_id"     ON "recipe_ingredients" USING btree ("recipe_id");
CREATE INDEX "idx_recipe_ingredients_ingredient_id" ON "recipe_ingredients" USING btree ("ingredient_id");

CREATE INDEX "idx_recipe_photos_recipe_id" ON "recipe_photos" USING btree ("recipe_id");

CREATE INDEX "idx_recipe_versions_recipe_id" ON "recipe_versions" USING btree ("recipe_id");
CREATE INDEX "idx_recipe_versions_snapshot"  ON "recipe_versions" USING gin ("snapshot");

CREATE INDEX "idx_collections_owner_id"          ON "collections" USING btree ("owner_id");
CREATE INDEX "idx_recipe_collections_recipe_id"  ON "recipe_collections" USING btree ("recipe_id");

-- ── Full-text search trigger (data-model "Search Vector Maintenance") ──────────────────────────────
-- Drizzle ORM does not model triggers; search_vector is maintained here (NOT a generated column) so the
-- weighted tsvector rebuilds automatically on every recipe write. Weighted: title (A) > description (B)
-- > ingredient_names_text (C). ingredient_names_text is a denormalized space-joined field the service
-- layer updates on ingredient changes, which fires this trigger.
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
