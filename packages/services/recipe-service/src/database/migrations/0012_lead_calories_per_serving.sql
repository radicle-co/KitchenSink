-- 0012_lead_calories_per_serving.sql (W8-a.1) — denormalized headline per-serving calories.
--
-- Adds the recipe's headline per-serving calorie figure, RECOMPUTED at write time (create/update/clone)
-- from the ingredient lines via the single per-serving aggregator (recipes/domain/nutrition.ts
-- leadCaloriesPerServing) and stored here. The LIST / SEARCH / collection-embed base projections read
-- this column so a card shows calories WITHOUT the N+1 a full nutrition read would cost (calories are
-- otherwise RecipeDetail-only, computed on read).
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/recipes.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. NULLABLE with no default: a metadata-only ADD COLUMN (no table rewrite, no
-- backfill). A pre-existing recipe keeps lead_calories_per_serving = NULL until its next write recomputes
-- it, and the projection omits the field (rather than fabricating a 0) exactly as for a recipe with no
-- accounted nutrition — mirroring average_rating's "absent, never 0" rule. numeric(8,1) matches the
-- one-decimal wire precision of the nutrition aggregator with ample headroom.

ALTER TABLE recipes ADD COLUMN lead_calories_per_serving numeric(8, 1);
