-- 0060 — who bound an ingredient line, and which imported line it came from (ADR-0072 §5).
--
-- `bound_by` is a CLOSED SET, owned by `BOUND_BY_VALUES` in `recipes/domain/bindingOriginCarryForward.ts` and parity-tested
-- against the CHECK below (`importSchemaParity.test.ts`). Adding a value is a migration AND a contract change, so the set is a
-- one-way door for stored rows. NULL means NO RECORDED ORIGIN: a line kept as written, or one written before bulk import
-- existed. A line bound to a food without a carried origin is `cook` (`carryForwardBinding`).
--
-- ⚠️ NO CROSS-TABLE CHECK. A line "kept as written" binds to an unresolved food (0051: `food_lookup_id` is NOT NULL, and
-- names exactly one of a food or an unresolved food), so "NULL exactly when as-written" would need to read `food_lookups`,
-- which a CHECK cannot. The carry-forward rule (`carryForwardBinding`) is the authority, and the identity it carries by is
-- the food alone.
--
-- `import_line_id` points at the snapshot line the ingredient was bound from. ON DELETE SET NULL: a recipe outlives its
-- import (the cook deletes the import, or an erasure removes it while a recipe is kept), and the link is only provenance.
-- It is carried forward by identity like `bound_by`, and cleared on a food change unless a rebind passes it on purpose.
--
-- The partial index serves the SET NULL: deleting an import's lines finds the ingredients that name them without a scan.
--
-- Additive and expand-only (ADR-0035): two nullable columns with no default, so no rewrite and no backfill. Code from the
-- previous release neither reads nor writes them.

-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it, instead of stalling every query
--   queued behind it (food 0025 to 0027 do the same; `migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE ingredients
    ADD COLUMN bound_by text,
    ADD COLUMN import_line_id uuid REFERENCES recipe_import_lines (id) ON DELETE SET NULL,
    ADD CONSTRAINT ingredients_bound_by_check
        CHECK (bound_by IN ('exact', 'curated', 'review', 'default', 'autoBest', 'cook'));

CREATE INDEX ingredients_import_line_idx ON ingredients (import_line_id) WHERE import_line_id IS NOT NULL;

COMMENT ON COLUMN ingredients.bound_by IS
    'Who bound the line to its food: exact, curated, review, default, autoBest or cook (ADR-0072 §5). NULL: no recorded origin.';
COMMENT ON COLUMN ingredients.import_line_id IS 'The bulk-import snapshot line this ingredient was bound from. SET NULL when the import goes.';
