-- 0006_ingredient_dedup_unique.sql (ADV-5) — make catalog dedup race-proof at the database.
--
-- `IngredientsDal.createFreeform` / `createFoodBacked` dedup with a read-then-insert (SELECT-miss →
-- INSERT). Two concurrent calls for the same food_id (or the same freeform name) both miss the SELECT
-- and both INSERT, producing DUPLICATE catalog rows. A race can only be resolved atomically by the
-- database, so the authoritative fix is a UNIQUE constraint; the DAL then uses INSERT … ON CONFLICT
-- DO NOTHING + re-select so the loser of the race returns the winner's row instead of erroring.
--
-- Dedup keys:
--   * food-backed rows  → the opaque `food_id` (one catalog row per food-service golden record).
--   * freeform rows     → the case-insensitive `name`, scoped to `is_user_entered = true`.
--
-- The food-backed unique index SUPERSEDES the non-unique `idx_ingredients_food_id` (same partial
-- predicate), so it is dropped and recreated as UNIQUE under the same name — it still serves lookups.
--
-- Greenfield note: feature 001 has never shipped to prod, and the test DB is rebuilt per run, so the
-- table is empty when this applies — no duplicate backfill is required before creating the indexes.

DROP INDEX IF EXISTS "idx_ingredients_food_id";

CREATE UNIQUE INDEX "idx_ingredients_food_id"
    ON "ingredients" USING btree ("food_id")
    WHERE "food_id" IS NOT NULL;

CREATE UNIQUE INDEX "idx_ingredients_freeform_name"
    ON "ingredients" USING btree (lower("name"))
    WHERE "is_user_entered" = true;
