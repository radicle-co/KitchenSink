-- U10 — the recipe service stops storing food's nutrition.
--
-- ⛔⛔ DO NOT RUN THIS YET. It is written and reviewed, but the read path that REPLACES these columns is
-- only half-built: `FoodNutritionGateway` exists and is tested, and the food client can fetch the batch,
-- but `RecipesService.assembleNutritionLines` still reads nutrition from `IngredientsDal`, which still
-- selects the columns below. Running this now would make every recipe read fail on a missing column.
--
-- The remaining work, in order: (1) drop the five nutrition fields from `IngredientsDal`'s projection and
-- from the `Ingredient` type; (2) route `assembleNutritionLines` through `FoodNutritionGateway`, threading
-- the caller token the way `IngredientsService` already does; (3) delete `leadCaloriesFor` and the three
-- stored-lead write sites, deriving the figure at read time; (4) drop both fields from the GDPR export
-- (`export.mappers.ts` + `account.schema.ts`) and regenerate the contract; (5) update the fixtures and
-- tests the compiler lists. THEN run this, against production, per the plan's owner ruling.
--
-- WHAT THIS DESTROYS, stated plainly:
--   ingredients.calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, portions
--   recipes.lead_calories_per_serving, recipes.has_partial_nutrition
--
-- All seven held data DERIVED from the food service's golden records. None of it was authored here and none
-- of it can be authored here: the food service is the single writer for a food, and every value above was a
-- copy taken at resolution time. After this migration the recipe database holds `food_id` and
-- `food_resolution_status` and nothing else food-derived; nutrition is read live from
-- `GET /api/v1/foods/nutrition` and cached in-process (KTD-3, KTD-3a, KTD-3b).
--
-- ⛔ THIS IS NOT REVERSIBLE, AND NOTHING IN THIS REPOSITORY CAN MAKE IT SO.
--   * There are NO down-migrations in any of the three runners. There is no rollback script to write.
--   * Production deploys CODE BEFORE MIGRATING, so rolling the image back does not undo this.
--   * The dropped values cannot be reconstructed from recipe data — they were never computed here.
--
-- Recovery is FORWARD ONLY: re-resolve each `food_id` against the food service, which is exactly what the
-- new read path does on every request anyway. That is why losing the copies is acceptable — they were a
-- cache with no invalidation, not a record.
--
-- ⚠️ WHAT HAPPENS TO EXISTING ROWS. Every row keeps its `food_id` and `food_resolution_status`, so every
-- ingredient stays linked to its food. What changes for a reader is WHERE the numbers come from, and one
-- class of value legitimately CHANGES: wherever the old recipe-side selector matched a `kJ` energy row by
-- substring, the calorie figure was ~4.184× too large and is now correct. That is a user-visible correction,
-- not a regression — see the plan's user-visible-consequences table and
-- `packages/shared/recipe-core/src/__tests__/nutritionCharacterization.test.ts`, which pins the pre-change
-- values so the difference is a deliberate diff rather than a silent shift.
--
-- ⚠️ USER OVERRIDES ARE NOT TOUCHED. `recipe_ingredients.user_calories` and its siblings are the user's own
-- data, not food's, and they survive this migration untouched. Dropping them would be destroying something
-- only the user could recreate.
--
-- No `CREATE INDEX CONCURRENTLY` anywhere here: all three migration runners wrap each file in BEGIN/COMMIT,
-- so CONCURRENTLY cannot run inside one. With no production traffic the plain lock is milliseconds.

ALTER TABLE ingredients
    DROP COLUMN IF EXISTS calories_per_100g,
    DROP COLUMN IF EXISTS protein_g_per_100g,
    DROP COLUMN IF EXISTS carbs_g_per_100g,
    DROP COLUMN IF EXISTS fat_g_per_100g,
    DROP COLUMN IF EXISTS portions;

ALTER TABLE recipes
    DROP COLUMN IF EXISTS lead_calories_per_serving,
    DROP COLUMN IF EXISTS has_partial_nutrition;
