-- 0078 — a bulk-import item can be refused, or wait for the servings and times the save needs (ADR-0072 §3 as amended
-- 2026-11-11).
--
-- The create route needs servings and both times, and nothing makes one up (no "1 serving", no "0 minutes"). Another app's
-- export often states none of them. So an item that lacks one waits in the import until the cook gives it, as it waits for a
-- cuisine (0076). A recipe with no ingredient line or no step is different: the import REFUSES it outright.
--
--  - `servings`, `prep_time_minutes`, `cook_time_minutes`: what the cook gave in the import for a recipe whose file states none.
--    Each replaces the file's value for this recipe, and NULL means the cook gave none. Servings is at least 1 and the minutes
--    are at least 0, the bounds the create route holds.
--  - `refusal`: why the import REFUSES the recipe, set when the item is written (the file has no ingredient line, or no step).
--    A refused recipe is never paid for, parsed or saved, so the paying and parsing queries leave it alone in SQL, where the
--    payload's counts are not at hand. A refusal exists only while the item is `received` (it never leaves that stage). It does
--    NOT require that the item is unpaid: a paid received item may be replaced by an empty recipe, and the unit stays spent.
--
-- Additive and expand-only (ADR-0035): four nullable columns. The CHECKs are added NOT VALID: they bind every write at once,
-- and 0079 scans the existing rows under a lighter lock. No GRANT: the service role's DML on this table comes from 0059
-- (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN servings integer,
    ADD COLUMN prep_time_minutes integer,
    ADD COLUMN cook_time_minutes integer,
    ADD COLUMN refusal text;

ALTER TABLE recipe_import_items
    ADD CONSTRAINT recipe_import_items_servings_check CHECK (servings IS NULL OR servings >= 1) NOT VALID,
    ADD CONSTRAINT recipe_import_items_prep_time_minutes_check
        CHECK (prep_time_minutes IS NULL OR prep_time_minutes >= 0) NOT VALID,
    ADD CONSTRAINT recipe_import_items_cook_time_minutes_check
        CHECK (cook_time_minutes IS NULL OR cook_time_minutes >= 0) NOT VALID,
    ADD CONSTRAINT recipe_import_items_refusal_check
        CHECK (refusal IS NULL OR refusal IN ('noIngredients', 'noSteps')) NOT VALID,
    ADD CONSTRAINT recipe_import_items_refusal_only_received CHECK (refusal IS NULL OR stage = 'received') NOT VALID;
