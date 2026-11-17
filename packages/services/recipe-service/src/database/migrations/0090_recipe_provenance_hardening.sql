-- 0090 — the records of what a cook stated and confirmed outlive the recipe, and the guards no longer read a name a session
-- can shadow.
--
-- ONE: RETENTION. An attestation is kept while its recipe is public, plus 6 years (ADR-0095 section 6). It cannot be, while
-- its foreign key CASCADES: the hard delete of a recipe (account erasure removes every private recipe of the account) took the
-- rows with it. So `recipe_id` becomes nullable with `ON DELETE SET NULL`, and `recipe_ref` carries the recipe's id for good.
-- `recipe_ref` is written by the service on insert and is NOT NULL; the CHECK keeps it equal to `recipe_id` for as long as the
-- recipe exists, so the two can never name different recipes.
--
-- The append-only guard now admits exactly two kinds of UPDATE and NO DELETE:
--   1. `recipe_id` going to NULL with every other column unchanged, when the recipe row no longer exists. That is the foreign
--      key's own action, and it is the only way a row loses its recipe.
--   2. The account swap of 0088: `account_id` from a real id to an `erased_` token, every other column unchanged, and only
--      while one of these is true for that account: an erasure job is queued or running (`account_erasure_jobs`), or the account
--      is a registered test principal (`test_principals`, 0044) whose reset is running (`test_reset_jobs`, 0045, status
--      `running`). Before this, any role with UPDATE could move any live account's rows to a token at any time, which destroys
--      the record of who acted.
-- A DELETE is always refused, for every role. A test principal keeps nothing (ADR-0040), but its records are only relabelled: the
-- reset swaps them to a token, so the worst a taken-over role can do is lose who made a record, never the record. A purge of rows
-- past their retention gets its own exception when the purge job is built.
--
-- TWO: SEARCH PATH. A trigger or SQL function that names `recipes` with no schema is resolved through the session's search
-- path, and a session's own temporary schema comes FIRST unless `pg_temp` is listed. `CREATE TEMP TABLE recipes (id uuid)` in a
-- session of a role that may create temporary tables made `NOT EXISTS (SELECT 1 FROM recipes ...)` true, which let a DELETE
-- through the guard. Every function of 0086, 0087 and 0088 is recreated with a pinned path that lists `pg_temp` LAST, and the eight older trigger and rule
-- functions get the same pin with `ALTER FUNCTION`, so no function of the schema is left open to it.
--
-- THREE: `recipe_is_from_person` also counts a PAST `fromPerson` attestation when the stored statement is NULL, the SQL twin of
-- `fromPersonOf` (recipe-core). Without it a cook could say "from another person", clear the statement, and publish.
--
-- FOUR: A CLONE keeps the "from another person" fact of its source (see the trigger at the end).
--
-- Deploy safety: `recipe_ref` is added, backfilled and set NOT NULL in this one file, which is safe because the attestations table
-- is created by 0088 in this same change and no older code writes to it. It would NOT be safe on a table older code writes to.

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_statement_attestations ADD COLUMN recipe_ref uuid;

-- The guard refuses every UPDATE, this one included, so it is switched off for the backfill alone. The table's own owner
-- (this migration's role) is the only one that may, and the trigger is on again before the statement ends.
ALTER TABLE recipe_statement_attestations DISABLE TRIGGER trg_recipe_statement_attestations_append_only;
UPDATE recipe_statement_attestations SET recipe_ref = recipe_id WHERE recipe_ref IS NULL;
ALTER TABLE recipe_statement_attestations ENABLE TRIGGER trg_recipe_statement_attestations_append_only;

ALTER TABLE recipe_statement_attestations
    ALTER COLUMN recipe_ref SET NOT NULL,
    ALTER COLUMN recipe_id DROP NOT NULL,
    DROP CONSTRAINT recipe_statement_attestations_recipe_id_fkey,
    ADD CONSTRAINT recipe_statement_attestations_recipe_id_fkey
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL,
    ADD CONSTRAINT recipe_statement_attestations_ref_matches CHECK (recipe_id IS NULL OR recipe_id = recipe_ref);

CREATE INDEX recipe_statement_attestations_ref_idx ON recipe_statement_attestations (recipe_ref, recorded_at);

COMMENT ON TABLE recipe_statement_attestations IS
    'Append-only record of every statement a cook made about a recipe and every Public confirmation, one row per act. UPDATE raises, except the foreign key emptying recipe_id of a recipe that is gone, and the swap of account_id to an erased_ token while an erasure job is queued or running for that account, or while a reset is running for an account that is a registered test principal. DELETE always raises. recipe_ref keeps the recipe id after the recipe is deleted.';

-- ── 0088: the attestation guard ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recipe_statement_attestations_append_only() RETURNS trigger AS $$
BEGIN
    -- The foreign key's own action: the recipe is gone, and only `recipe_id` moves.
    IF TG_OP = 'UPDATE'
       AND OLD.recipe_id IS NOT NULL
       AND NEW.recipe_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id)
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.recipe_ref IS NOT DISTINCT FROM OLD.recipe_ref
       AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
       AND NEW.mode IS NOT DISTINCT FROM OLD.mode
       AND NEW.choice IS NOT DISTINCT FROM OLD.choice
       AND NEW.wording_version IS NOT DISTINCT FROM OLD.wording_version
       AND NEW.locale IS NOT DISTINCT FROM OLD.locale
       AND NEW.action IS NOT DISTINCT FROM OLD.action
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at THEN
        RETURN NEW;
    END IF;

    -- The account swap: account_id alone, from a real id to an erased token, while the account's erasure is in flight or the
    -- account is a registered test principal whose reset is running. There is no DELETE exception.
    IF TG_OP = 'UPDATE'
       AND OLD.account_id !~ '^erased_'
       AND NEW.account_id ~ '^erased_[0-9a-f]{32}$'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.recipe_id IS NOT DISTINCT FROM OLD.recipe_id
       AND NEW.recipe_ref IS NOT DISTINCT FROM OLD.recipe_ref
       AND NEW.mode IS NOT DISTINCT FROM OLD.mode
       AND NEW.choice IS NOT DISTINCT FROM OLD.choice
       AND NEW.wording_version IS NOT DISTINCT FROM OLD.wording_version
       AND NEW.locale IS NOT DISTINCT FROM OLD.locale
       AND NEW.action IS NOT DISTINCT FROM OLD.action
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
       AND (
           EXISTS (
               SELECT 1 FROM account_erasure_jobs j
                WHERE j.owner_id = OLD.account_id AND j.status IN ('queued', 'running')
           )
           OR (
               EXISTS (SELECT 1 FROM test_principals p WHERE p.user_id = OLD.account_id)
               AND EXISTS (
                   SELECT 1 FROM test_reset_jobs j
                    WHERE j.user_id = OLD.account_id AND j.status = 'running'
               )
           )
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'recipe_statement_attestations is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION recipe_statement_attestations_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_statement_attestations is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

-- ── 0086: the evidence guard and its siblings ───────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recipe_source_evidence_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id) THEN
        RETURN OLD; -- the recipe is gone: only its ON DELETE CASCADE reaches here
    END IF;

    RAISE EXCEPTION 'recipe_source_evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION recipe_source_evidence_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_source_evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION recipes_clone_inherits_source_evidence() RETURNS trigger AS $$
BEGIN
    INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain, source_kind, citation,
        paste_digest, credit_authors, credit_publisher, credit_copyright_notice, credit_copyright_holder, credit_license,
        image_url, recorded_at)
    SELECT NEW.id, capture, source_url, source_key, source_domain, source_kind, citation, paste_digest, credit_authors,
           credit_publisher, credit_copyright_notice, credit_copyright_holder, credit_license, image_url, recorded_at
      FROM recipe_source_evidence WHERE recipe_id = NEW.cloned_from_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION recipes_stated_source_has_evidence() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM recipe_source_evidence e
         WHERE e.recipe_id = NEW.id
           AND e.source_kind = NEW.source_kind
           AND e.source_url IS NOT DISTINCT FROM NEW.source_url
    ) THEN
        RAISE EXCEPTION 'recipe % states a source (%) with no recipe_source_evidence row', NEW.id, NEW.source_kind
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION recipe_holds_third_party_source(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipe_source_evidence e
         WHERE e.recipe_id = p_recipe_id
           AND (e.source_domain IS NOT NULL OR e.source_kind IN ('book', 'paid_site'))
    );
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── 0087: the statement rules ───────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recipe_needs_statement(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.id = p_recipe_id
           AND r.source_type = 'user_created'
           AND r.statement_kind IS NULL
           AND (r.content_pasted_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM recipe_source_evidence e WHERE e.recipe_id = r.id))
    );
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- The SQL twin of `fromPersonOf` (recipe-core): the stored statement says "from another person", or there is NO stored
-- statement and the cook once attested "from another person". An explicit later statement (`authored`, `source`) replaces it.
CREATE OR REPLACE FUNCTION recipe_is_from_person(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.id = p_recipe_id
           AND (r.statement_kind = 'fromPerson'
                OR (r.statement_kind IS NULL
                    AND EXISTS (SELECT 1 FROM recipe_statement_attestations a
                                 WHERE a.recipe_id = r.id AND a.choice = 'fromPerson')))
    );
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── A clone keeps the "from another person" fact ───────────────────────────────────────────────────────────────────────────────

-- A clone has its own id, so a fact read by the recipe's id is lost on it. When the source is held as "from another person"
-- (`recipe_is_from_person`: its statement says so, or it has none and the cook once attested it) and the clone starts with no
-- statement of its own, the source's latest `fromPerson` row is copied to the clone: the account, mode, choice, wording, locale,
-- action and time are kept, and the row's recipe is the clone. The clone is then held at every route to Public, and erasure
-- never donates it, with no reading across `cloned_from_id`, so deleting the source later changes nothing. No other
-- attestation is copied: an "I wrote this" or a Public confirmation is the act of the cook who made it. A clone that starts
-- with a statement of its own needs no copy.
CREATE FUNCTION recipes_clone_inherits_from_person() RETURNS trigger AS $$
BEGIN
    IF NEW.statement_kind IS NULL AND recipe_is_from_person(NEW.cloned_from_id) THEN
        INSERT INTO recipe_statement_attestations (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale,
            action, recorded_at)
        SELECT NEW.id, NEW.id, a.account_id, a.mode, a.choice, a.wording_version, a.locale, a.action, a.recorded_at
          FROM recipe_statement_attestations a
         WHERE a.recipe_ref = NEW.cloned_from_id AND a.choice = 'fromPerson'
         ORDER BY a.recorded_at DESC, a.id DESC
         LIMIT 1;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipes_clone_inherits_from_person
    AFTER INSERT ON recipes
    FOR EACH ROW WHEN (NEW.cloned_from_id IS NOT NULL)
    EXECUTE FUNCTION recipes_clone_inherits_from_person();

-- ── The older functions: the same pin, no body restated ───────────────────────────────────────────────────────────────────────

-- Each of these names only `pg_catalog` and `public` objects, so the pin changes no answer.
ALTER FUNCTION recipes_search_vector_update() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION recipe_ratings_aggregate_refresh() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION analytics_events_fold() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION recipes_first_published_at_ratchet() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION recipe_private_food_lines(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION recipe_holds_private_food(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION ingredients_public_recipe_no_private_food() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION recipes_public_holds_no_private_food() SET search_path = pg_catalog, public, pg_temp;
