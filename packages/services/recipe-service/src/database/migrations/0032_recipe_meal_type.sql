-- 0032 — `recipes.meal_type`: the ONE closed classification axis (plan U34, owner ruling 2026-08-25).
--
-- WHAT THIS ADDS
--   A nullable `meal_type text` on `recipes`, plus `recipes_meal_type_check` restricting a STATED value to
--   the seven-member vocabulary in `@kitchensink/recipe-core`'s `RecipeMealType`
--   (breakfast | brunch | lunch | dinner | snack | dessert | drink).
--
-- WHY A CHECK HERE AT ALL, WHEN `tags` AND `dietary_flags` SIT BESIDE IT UNCONSTRAINED
--   Because the AXIS is closed, not because enums are tidier. "When in the day is this eaten" has a finite,
--   stable answer; "which cuisine", "which tag", "which diet" do not — a cuisine nobody curated, a tag a cook
--   invents and a diet that emerges next year all have to be expressible, which is why `CUISINES` ships as a
--   display list behind a plain `text` column and why `tags`/`dietary_flags` are unconstrained `text[]`.
--   Closing this one axis buys a filter facet that cannot rot into seventeen spellings of "dinner"; closing
--   any of the others would reject data that is simply new. Do not "tidy" the neighbours to match — an
--   integration test asserts, in the negative, that they stay free text.
--
--   It is deliberately NOT "course": a dish can be a starter and a side at once and the boundary moves by
--   cuisine, so course is not a closed set and modelling it as one would force a wrong answer on the cook.
--
-- WHY NULLABLE WITH NO DEFAULT
--   "The author did not state one" is a first-class state, exactly as for `difficulty` (0010). A DEFAULT
--   would silently classify every recipe ever written — a guess, asserted as fact, on a field a cook is
--   about to filter by. NULL passes the CHECK for free: `NULL IN (...)` evaluates to NULL, not false, and a
--   CHECK constraint admits anything that is not false.
--
-- WHY `NOT VALID`, AND WHY THAT IS SAFE (ADR-0022, expand-first)
--   `NOT VALID` skips the validating table scan — no ACCESS EXCLUSIVE lock held for the length of the scan on
--   a table that is read on every list, search and detail. It is safe here because every pre-existing row has
--   `meal_type IS NULL` by construction (the column is being added in this same statement), so there is
--   nothing a scan could find. The constraint still polices every INSERT and UPDATE from the moment it is
--   added, which is the property the integration test proves — a `NOT VALID` constraint is not an unenforced
--   one.
--
-- IDEMPOTENCE
--   `ADD COLUMN IF NOT EXISTS` plus `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`, matching 0030. The
--   runner keys `schema_migrations` by filename and there are no down-migrations in this repo, so a partially
--   applied file has to be re-runnable.
--
-- ROLLBACK
--   None, by convention. The column is additive and nullable; code that predates it neither writes nor reads
--   it, so an older release runs unchanged against this schema.

ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS meal_type text;

ALTER TABLE recipes
    DROP CONSTRAINT IF EXISTS recipes_meal_type_check;

ALTER TABLE recipes
    ADD CONSTRAINT recipes_meal_type_check
        CHECK (meal_type IN ('breakfast', 'brunch', 'lunch', 'dinner', 'snack', 'dessert', 'drink'))
        NOT VALID;
