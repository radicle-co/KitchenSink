-- 0009 — index `food.rank_tokens`, so it can be a PREDICATE and not only a sort key.
--
-- ## Why this index now exists, when 0008 deliberately added none
--
-- 0008 ends: "No index is added. These columns are a SORT KEY, never a predicate." That was true of U5's
-- ranking, and it stops being true here: the catalog's retrieval predicate now includes
-- `rank_tokens @> ARRAY[head]`, which without a GIN index is a sequential scan of every RESOLVED row on
-- every typeahead keystroke.
--
-- ## What the predicate is for, measured
--
-- U6 widened retrieval with a head-term branch and put it on `IngredientsDal.search` — the recipe-LOCAL
-- table. Its plan entry names two files, both in recipe-service. The catalog kept
-- `plainto_tsquery OR aliases_tsquery OR name % OR name ILIKE OR description ILIKE`, and on 2026-08-22 that
-- set was measured against 8,094 real USDA foods:
--
--   * `jalapeño`         → 0 rows. `similarity('Peppers, jalapeno, raw', 'jalapeño') = 0.250` against the
--                          0.3 `pg_trgm` threshold; folded, it is 0.429.
--   * `Kerrygold butter` → 0 rows. The tsquery conjunction needs `kerrygold`, which no row carries; trigram
--                          against `Butter, salted` is 0.292 — short by 0.008.
--   * `Fresh oregano`    → `Basil, fresh` and `Thyme, fresh`. `fresh & oregano` matched nothing (the only
--                          oregano row is `Spices, oregano, dried`), so both hits were earned on the
--                          modifier rather than on the food.
--
-- `rank_tokens` is already the name's folded, singularized token array, so ONE containment test is both
-- head-term retrieval and diacritic folding. ⛔ Deliberately NOT the `unaccent` extension: 0008 rejected it
-- because its rules file is not NFD and could not be mirrored in TypeScript, and the SQL and TS engines
-- must agree on the fold.
--
-- ## Deploy note
--
-- `CREATE INDEX` (not CONCURRENTLY) — per ADR-0022 migrations run INSIDE the deploy, ahead of the service
-- that reads them, so the lock window belongs to the migration rather than to a period of schema skew. The
-- `gin__int_ops`-free default `array_ops` is correct here: the operator is `@>` over `text[]`.
--
-- Purely EXPAND: an index is invisible to the previous image, so a rollback leaves it harmlessly present.

CREATE INDEX IF NOT EXISTS idx_food_rank_tokens ON food USING GIN (rank_tokens);

COMMENT ON INDEX idx_food_rank_tokens IS
    'Supports the head-term retrieval branch in FoodSearchDao.relevanceQuery (rank_tokens @> ARRAY[head]).';
