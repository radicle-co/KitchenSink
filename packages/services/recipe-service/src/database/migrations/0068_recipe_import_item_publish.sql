-- 0068 — a bulk-import item can be refused, or wait for what the save needs (ADR-0072 §3 as amended 2026-11-11).
--
-- The import saves every recipe PUBLISHED, never as a draft, and Publish needs a cuisine (unless the recipe is a public-domain
-- web import), at least one ingredient and at least one step. Another app's export often states no cuisine. Nothing makes one
-- up: no default and no AI pick. So an item that lacks one waits in the import until the cook decides, as an item without a
-- statement waits.
--
--  - `cuisine`: the cuisine the cook gave in the import, which replaces the file's for this recipe. NULL when the cook gave
--    none, and the save then uses the file's. A blank one is refused, as the create route refuses one.
--  - `held_at_rev`: the `decision_rev` at which the save found the item short of what Publish needs. While it equals
--    `decision_rev`, the save does not look at the item again, so an item that cannot be saved is never re-queued forever.
--    Every write of what an item is saved from moves `decision_rev` (0059), so the next decision releases the hold by itself:
--    nothing ever clears this column, and nothing reads it as the reason. The reason is derived from the item at read time.
--
--  - `servings`, `prep_time_minutes`, `cook_time_minutes`: what the cook gave in the import for a recipe whose file states none.
--    Each replaces the file's value for this recipe, and NULL means the cook gave none. Servings is at least 1 and the minutes
--    are at least 0, the bounds the create route holds. The create route needs all of them and nothing makes one up (no
--    "1 serving", no "0 minutes"), so a recipe missing one holds until the cook gives it, as it does for the cuisine.
--  - `refusal`: why the import REFUSES the recipe, set when the item is written (the file has no ingredient line, or no step).
--    A refused recipe is never paid for, parsed or saved, so the paying and parsing queries leave it alone in SQL, where the
--    payload's counts are not at hand. A refusal exists only while the item is `received` (it never leaves that stage). It does
--    NOT require that the item is unpaid: a paid received item may be replaced by an empty recipe, and the unit stays spent.
--
-- Additive and expand-only (ADR-0035): nullable columns. No GRANT: the service role's DML on this table comes from 0059
-- (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN cuisine text CONSTRAINT recipe_import_items_cuisine_check CHECK (cuisine IS NULL OR btrim(cuisine) <> ''),
    ADD COLUMN held_at_rev integer
        CONSTRAINT recipe_import_items_held_at_rev_check CHECK (held_at_rev IS NULL OR held_at_rev >= 0),
    ADD COLUMN servings integer CONSTRAINT recipe_import_items_servings_check CHECK (servings IS NULL OR servings >= 1),
    ADD COLUMN prep_time_minutes integer
        CONSTRAINT recipe_import_items_prep_time_minutes_check CHECK (prep_time_minutes IS NULL OR prep_time_minutes >= 0),
    ADD COLUMN cook_time_minutes integer
        CONSTRAINT recipe_import_items_cook_time_minutes_check CHECK (cook_time_minutes IS NULL OR cook_time_minutes >= 0),
    ADD COLUMN refusal text
        CONSTRAINT recipe_import_items_refusal_check CHECK (refusal IS NULL OR refusal IN ('noIngredients', 'noSteps')),
    ADD CONSTRAINT recipe_import_items_refusal_only_received CHECK (refusal IS NULL OR stage = 'received');
