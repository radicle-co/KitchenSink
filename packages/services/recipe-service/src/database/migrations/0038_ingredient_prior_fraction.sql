-- 0038 — the CAPTURED consumption prior on the recipe-local ingredients cache (plan U5, KTD-G).
--
-- ⛔ CAPTURED, not joined: ADR-0006 gives every stage (and every pr-{N}) its own logical database, so the
-- recipe-side ranking CANNOT read food-service's `food_popularity` table. The fraction is copied onto the
-- ingredients row at ingredient-cache time (admission and status refresh — the same moments the canonical
-- name and per-100g nutrition are captured), and the local rendering (`ingredientRelevance.ts`) reads it
-- exactly as the catalog rendering reads the sibling table.
--
-- Staleness contract (stated in the plan): a prior update on the food side reaches this column on the
-- NEXT ingredient cache refresh. Acceptable because consumption base rates move yearly, not daily.
ALTER TABLE ingredients
    ADD COLUMN prior_fraction numeric CHECK (prior_fraction >= 0 AND prior_fraction <= 1);

COMMENT ON COLUMN ingredients.prior_fraction IS
    'U5: FNDDS consumption-prior fraction captured from food-service at cache time. NULL = no prior.';
