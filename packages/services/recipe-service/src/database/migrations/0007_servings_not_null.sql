-- 0007_servings_not_null.sql (contract divergence #4) — servings is REQUIRED.
--
-- Every recipe must have a serving amount: nutrition calculation and ingredient-measurement scaling both
-- depend on it, and there is no valid "unknown servings" state. The create API already requires it
-- (@Min(1)) and recipe-core types it as a required positive int, but the column was nullable — the
-- outlier that forced the `?? 0` / `?? 1` fabrications in the search / collections / snapshot mappers.
--
-- Codify the invariant at the database: NOT NULL alongside the existing CHECK (servings > 0) fully
-- enforces required-positive. Feature 001 has never shipped and the test DB is rebuilt per run, so no
-- rows hold NULL — no backfill is required before the constraint.

ALTER TABLE "recipes" ALTER COLUMN "servings" SET NOT NULL;
