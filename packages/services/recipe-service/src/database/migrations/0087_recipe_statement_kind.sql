-- 0087 — what the cook STATED about a recipe: `recipes.statement_kind`, and whether content was pasted: `content_pasted_at`.
--
-- WHY (the statement rule, Option B). A recipe the cook wrote that has no statement, and whose content was pasted or that has
-- any source evidence, may not be left published and public until the cook says "I wrote this" (`statementRequiredOf`,
-- recipe-core). Today nothing records that the cook ever said it: a cleared web source reads as `user_created` exactly like a
-- recipe typed by hand. Two columns record the two facts the rule reads that no existing column holds.
--
-- `statement_kind` is the vocabulary the import items already store (`recipe_import_items.statement_kind`, 0059) plus one
-- member of its own: `authored` ("I wrote this"), `source` (a stated web page, book or paid site, which `source_kind` says),
-- or `fromPerson` ("from another person": the cook says the recipe is not theirs to publish, and states no source). NULL is
-- no statement: every recipe the cook typed, a cleared source, and the curator's public-domain text. It is the ONE spelling
-- of "none". Nothing sets `authored` or `fromPerson` for the cook; only their own statement does.
--
-- `content_pasted_at` is the client's word that content was pasted into the recipe. It can only make the rule STRICTER, and
-- the data layer writes `COALESCE(content_pasted_at, now())`, so once set it stays set. It is not on the wire.
--
-- Four CHECKs, inline (ADR-0035 requires additive changes only; 0071 is the precedent). The vocabulary is closed. `authored`
-- and `fromPerson` belong only to a recipe that has no source of its own (`user_created` with no kind): a recipe cannot be
-- another person's AND state a web page. And every stated source kind is paired with `statement_kind = 'source'`, and only it,
-- so a row cannot say "a web copy" and "no statement" at once.
--
-- ⛔ The third CHECK breaks any writer that sets a `source_kind` without `statement_kind = 'source'` in the same statement:
-- the previous release's code does. The owner chose to accept that (nothing is live, no compatibility shim): the schema stack
-- deploys AHEAD of the service (ADR-0035), so the window in which a statement-bearing write from the old code is refused is the
-- deploy window, and the refusal is a constraint error, never silent data loss.
--
-- `recipe_needs_statement(recipe_id)` is the SQL twin of `statementRequiredOf`, and `recipe_is_from_person(recipe_id)` the SQL
-- twin of `fromPersonOf`, for the one query that must ask them: account erasure's donate step, which never donates a recipe
-- either holds. Two functions and not one, because they are two rules with two reasons (the statement rule is owed by the cook;
-- "from another person" is already said). A FUNCTION and not an exported SQL string, on the precedent of
-- `recipe_holds_third_party_source` (0086) and `recipe_holds_private_food` (0064). A LOCAL e2e test holds each pair together.
--
-- Additive and expand-only: two nullable columns with no default (no rewrite), four CHECKs that hold for every row the new
-- code writes, and two functions.

-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipes
    ADD COLUMN statement_kind text,
    ADD COLUMN content_pasted_at timestamptz,
    ADD CONSTRAINT recipes_statement_kind_check CHECK (statement_kind IN ('authored', 'source', 'fromPerson')),
    ADD CONSTRAINT recipes_statement_authored_is_own CHECK (
        statement_kind IS DISTINCT FROM 'authored' OR (source_type = 'user_created' AND source_kind IS NULL)
    ),
    ADD CONSTRAINT recipes_statement_from_person_is_own CHECK (
        statement_kind IS DISTINCT FROM 'fromPerson' OR (source_type = 'user_created' AND source_kind IS NULL)
    );

-- A recipe stored before this file that already states a source has no statement kind, and the pairing CHECK below refuses
-- it. Its source IS a statement (the one the cook made), so it is written as one before the CHECK is added. The one-statement
-- ALTER this replaces failed the whole migration on any database that held such a row.
UPDATE recipes SET statement_kind = 'source' WHERE source_kind IS NOT NULL AND statement_kind IS NULL;

ALTER TABLE recipes
    ADD CONSTRAINT recipes_statement_kind_pairs_source_kind CHECK (
        (source_kind IS NULL) = (statement_kind IS DISTINCT FROM 'source')
    );

COMMENT ON COLUMN recipes.statement_kind IS
    'What the cook stated: authored ("I wrote this"), source (a stated web page, book or paid site; source_kind says which) or fromPerson ("from another person": private only). NULL: no statement. Only the cook sets authored and fromPerson.';
COMMENT ON COLUMN recipes.content_pasted_at IS
    'When the cook''s client first said content was pasted into the recipe. Written with COALESCE(content_pasted_at, now()), so never cleared. Not on the wire.';

-- The SQL twin of `statementRequiredOf` (recipe-core): a cook-written recipe with no statement whose content was pasted or that
-- has any source evidence. The unrecognised-kind arm of the TypeScript rule cannot occur here: the CHECK above is closed.
CREATE FUNCTION recipe_needs_statement(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.id = p_recipe_id
           AND r.source_type = 'user_created'
           AND r.statement_kind IS NULL
           AND (r.content_pasted_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM recipe_source_evidence e WHERE e.recipe_id = r.id))
    );
$$ LANGUAGE sql STABLE;

-- The SQL twin of `fromPersonOf` (recipe-core): the cook said the recipe is another person's. Account erasure never donates
-- such a recipe, because a donation publishes it.
CREATE FUNCTION recipe_is_from_person(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM recipes r WHERE r.id = p_recipe_id AND r.statement_kind = 'fromPerson');
$$ LANGUAGE sql STABLE;
