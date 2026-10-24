-- U8 — an ingredient quantity becomes `exact | range | absent` (R36, R40, R41; KTD-6).
--
-- Today `recipe_ingredients.quantity` is a required, positive scalar. That shape cannot hold either of the
-- two things real recipes say:
--   * `2 to 3 cups flour`  — the upper bound had nowhere to go, so the importer narrowed every range to its
--                            lower bound at the wire and counted the loss (`rangeNarrowedAtWire`).
--   * `butter the size of an egg` — the source states NO number. `NOT NULL` forced a fabricated one, and
--                            the only unfabricated answer available was to drop the whole line.
--
-- ── EXPAND ONLY (ADR-0022). Nothing here drops a column, narrows a type, or rewrites a row. ──
--
-- 1. `quantity_high` is ADDED nullable. Every existing row gets `NULL`, which reads as "this line states one
--    value, not two" — the correct meaning for every row already in the table, so there is no backfill.
--
-- 2. `quantity` DROPS `NOT NULL`. Existing rows are unaffected (they all hold a value); what changes is that
--    a NEW row may now say "the source stated no amount" without inventing a number for it.
--
-- ⚠️ 3. `recipe_ingredients_quantity_positive` (`CHECK (quantity > 0)`) is DELIBERATELY KEPT, which departs
--    from the plan's wording ("drop NOT NULL and the positive check"). A Postgres CHECK is satisfied when it
--    evaluates to NULL, so `quantity > 0` already ADMITS a NULL quantity — dropping it would buy nothing and
--    would cost the one guarantee that stops a `0` from re-entering as a second spelling of "absent", which
--    is the exact confusion this whole unit exists to remove. Verified against PostgreSQL 16 by
--    `__tests__/integration/database/quantityRange.integration.test.ts`.
--
-- 4. `recipe_ingredients_quantity_coherent` is ADDED to make the pair's illegal states unrepresentable in
--    the DATABASE as well as in the type:
--       * an upper bound with no lower bound      → rejected
--       * an upper bound at or below its lower    → rejected (coincident bounds ARE an exact quantity, and
--                                                    an amount must have exactly ONE representation)
--    Positivity of `quantity_high` follows transitively from `high > low > 0`.
--
--    `NOT VALID` deliberately: it skips the full-table verification scan (and the long ACCESS EXCLUSIVE lock
--    that comes with it) while still enforcing the constraint on every INSERT and UPDATE from this moment
--    on. Every pre-existing row trivially satisfies it (`quantity_high IS NULL`), so a later
--    `ALTER TABLE ... VALIDATE CONSTRAINT recipe_ingredients_quantity_coherent` is a no-op cleanup that can
--    run at any time, in its own migration, without blocking writes.
--
-- ── ROLLBACK ──
-- Rolling the IMAGE back is safe: the previous release only ever wrote a non-null `quantity` and never read
-- `quantity_high`, and the kept positive check still holds for it. Rolling the SCHEMA back is not offered
-- (there are no down-migrations in any runner) and is not needed.
--
-- No `CREATE INDEX CONCURRENTLY`: every runner wraps a file in BEGIN/COMMIT, so CONCURRENTLY cannot run
-- inside one. Nothing here needs an index — the column is projected, never filtered on.

ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS quantity_high numeric(10, 3);

ALTER TABLE recipe_ingredients
    ALTER COLUMN quantity DROP NOT NULL;

ALTER TABLE recipe_ingredients
    DROP CONSTRAINT IF EXISTS recipe_ingredients_quantity_coherent;

ALTER TABLE recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_quantity_coherent
        CHECK (quantity_high IS NULL OR (quantity IS NOT NULL AND quantity_high > quantity))
        NOT VALID;
