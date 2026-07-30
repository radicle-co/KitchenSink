-- 0008_times_not_null.sql (contract divergence #6) — prep/cook/total times are REQUIRED.
--
-- A recipe you can cook from always states its prep, cook, and total time (the recipe-detail screen shows
-- all three), and the create API requires all three (divergence #5). `totalTimeMinutes` is independent,
-- not derived (inactive rest/marinate time belongs in the total but neither prep nor cook). The columns
-- were nullable — the outlier that forced the `RecipeResponse` times to be `number | null` and the
-- `?? 0` fabrications in the snapshot mapper, diverging from `recipe-core`'s required non-negative ints.
--
-- Codify the invariant at the database: NOT NULL alongside the existing CHECK (… >= 0). Feature 001 has
-- never shipped and the test DB is rebuilt per run, so no rows hold NULL — no backfill is required.

ALTER TABLE "recipes" ALTER COLUMN "prep_time_minutes" SET NOT NULL;
ALTER TABLE "recipes" ALTER COLUMN "cook_time_minutes" SET NOT NULL;
ALTER TABLE "recipes" ALTER COLUMN "total_time_minutes" SET NOT NULL;
