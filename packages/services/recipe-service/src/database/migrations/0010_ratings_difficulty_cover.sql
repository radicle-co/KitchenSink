-- 0010_ratings_difficulty_cover.sql (CR-001 — mockup parity) — difficulty, ratings + the
-- trigger-maintained rating aggregate, the cover-photo index, and the erasure owner_id index.
--
-- Hand-authored, ordered DDL (repo convention — Drizzle does not model triggers, and the aggregate is
-- the trigger's job, not the ORM's). The Drizzle definitions in src/database/schema/{recipes,ratings,
-- photos,account}.ts document the same final shapes and drive the query layer; this file is what the
-- in-VPC migration runner applies.
--
-- Adds, in order:
--   1. recipes.difficulty (nullable, NO default) + rating aggregate columns + their CHECKs.
--   2. recipe_ratings + its UNIQUE(recipe_id, user_id) and user_id indexes.
--   3. recipe_ratings_aggregate_refresh() + the THREE single-event statement-level triggers.
--   4. idx_recipe_photos_recipe_cover (cover LATERAL) + idx_erasure_jobs_owner_id (erasure guard).
--
-- SAFE AGAINST EXISTING ROWS. Feature 001 has never shipped and the test DB is rebuilt per run, but this
-- is written to be safe anyway: every ADD COLUMN is nullable or DEFAULTed (metadata-only, no rewrite),
-- and no existing row can violate a new CHECK — difficulty backfills NULL, and rating_count DEFAULT 0
-- with average_rating NULL satisfies recipes_rating_aggregate_coherent. No backfill required.

-- ── 1. recipes: difficulty + rating aggregate ──────────────────────────────────────────────────────
-- difficulty is NULLABLE with NO DEFAULT, DELIBERATELY diverging from servings/times (0007/0008 made
-- those NOT NULL). Those are load-bearing (scaling + nutrition) and always knowable by the author;
-- difficulty is a subjective judgement nothing computes from, and "the author did not state one" is a
-- real, first-class state. A NOT NULL DEFAULT 'medium' would fabricate authorship on every existing row
-- — and would be wrong the moment 004 imports a recipe whose source states no difficulty. NULL → no badge.
ALTER TABLE "recipes" ADD COLUMN "difficulty" text;

-- Denormalized rating aggregate (FR-013a). Maintained ONLY by the trigger below — NEVER written by
-- application code. average_rating IS NULL exactly when rating_count = 0 (an unrated recipe has NO
-- average; 0.00 would render as a real zero-star score), enforced by recipes_rating_aggregate_coherent.
ALTER TABLE "recipes" ADD COLUMN "average_rating" numeric(3, 2);
ALTER TABLE "recipes" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;

-- difficulty: NULL passes (NULL IN (...) is NULL, not false), so this enforces the enum only on stated values.
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_difficulty_check"
    CHECK ("difficulty" IN ('easy', 'medium', 'hard'));
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_rating_count_nonneg"
    CHECK ("rating_count" >= 0);
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_average_rating_range"
    CHECK ("average_rating" IS NULL OR ("average_rating" >= 1 AND "average_rating" <= 5));
-- The incoherent pairing (a count with no average, or an average with no count) is unrepresentable.
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_rating_aggregate_coherent"
    CHECK (("rating_count" = 0) = ("average_rating" IS NULL));

-- ── 2. recipe_ratings: one row per (recipe, rater) ─────────────────────────────────────────────────
-- user_id is the RATER's app-user ULID (from the token claim) — no FK, no local users table (D2), same
-- rule as recipes.owner_id. Ratings routinely live on OTHER users' recipes, which is why user_id is the
-- third owner-scoped GDPR erasure root. recipe_id CASCADEs so deleting a recipe removes its ratings.
CREATE TABLE "recipe_ratings" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_id"  uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "user_id"    varchar(255) NOT NULL,
    "stars"      integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "recipe_ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5)
);

-- One rating per (recipe, user) — also the ON CONFLICT (recipe_id, user_id) target of the idempotent
-- PUT upsert. Its (recipe_id, user_id) leftmost prefix already serves "all ratings for a recipe" (the
-- aggregate recompute), so no separate recipe_id index is needed.
CREATE UNIQUE INDEX "recipe_ratings_recipe_user_unique" ON "recipe_ratings" ("recipe_id", "user_id");
-- REQUIRED for the GDPR erasure sweep `DELETE FROM recipe_ratings WHERE user_id = :ownerId` — without it
-- that delete is a Seq Scan of every rating in the system.
CREATE INDEX "idx_recipe_ratings_user_id" ON "recipe_ratings" ("user_id");

-- ── 3. Rating aggregate maintenance trigger (data-model "Rating Aggregate Maintenance") ────────────
-- Two load-bearing, non-obvious properties, both verified on PG 16 (see data-model.md):
--
--   (a) STATEMENT-level over a transition table, not row-level. A bulk `DELETE ... WHERE user_id = :owner`
--       (GDPR erasure) fires it ONCE regardless of row count, not once per row. PostgreSQL forbids
--       transition tables on a multi-event trigger, so there are THREE single-event triggers sharing one
--       function, all referencing the transition table under the same name `changed_rows`.
--   (b) The FOR UPDATE lock is the correctness fix for a LOST UPDATE, not an optimization. Without it,
--       two users rating the same recipe concurrently at READ COMMITTED silently corrupt the aggregate:
--       the second txn recomputes on a snapshot taken BEFORE the first committed, blocks on the row lock,
--       then writes its stale count over the fresh one. Locking the affected recipes FIRST, in ORDER BY
--       id (deterministic → no deadlock), forces the recompute onto a snapshot that sees the committed row.
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

-- ── 4. Supporting indexes ──────────────────────────────────────────────────────────────────────────
-- Cover-photo LATERAL on the recipe LIST projection (lowest sort_order, ties broken by created_at, id).
-- The column order matches the LATERAL's ORDER BY so its LIMIT 1 is an index-ordered lookup.
CREATE INDEX "idx_recipe_photos_recipe_cover" ON "recipe_photos" ("recipe_id", "sort_order", "created_at", "id");

-- Plain (non-partial) owner index for the erasure resurrection-race guard's `SELECT EXISTS(... WHERE
-- owner_id = $1)` (no status filter → cannot use the partial idx_erasure_jobs_active_owner).
CREATE INDEX "idx_erasure_jobs_owner_id" ON "account_erasure_jobs" ("owner_id");
