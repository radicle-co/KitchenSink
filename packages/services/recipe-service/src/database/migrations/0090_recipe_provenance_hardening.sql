-- 0090 — the records of what a cook stated and confirmed outlive the recipe, and the guards no longer read a name a session
-- can shadow.
--
-- ONE: RETENTION. An attestation is kept while its recipe is public, plus 6 years (ADR-0095 section 6). It cannot be, while
-- its foreign key CASCADES: the hard delete of a recipe (account erasure removes every private recipe of the account) took the
-- rows with it. So `recipe_id` becomes nullable with `ON DELETE SET NULL`, and `recipe_ref` carries the recipe's id for good.
-- `recipe_ref` is written by the service on insert and is NOT NULL; the CHECK keeps it equal to `recipe_id` for as long as the
-- recipe exists, so the two can never name different recipes.
--
-- The append-only guard now admits exactly two UPDATEs and one DELETE:
--   1. `recipe_id` going to NULL with every other column unchanged, when the recipe row no longer exists. That is the foreign
--      key's own action, and it is the only way a row loses its recipe.
--   2. The erasure swap of 0088: `account_id` from a real id to an `erased_` token, every other column unchanged, and now ONLY
--      while an erasure job is queued or running for that account. Before this, any role with UPDATE could move any live
--      account's rows to a token at any time, which destroys the record of who acted.
--   3. A DELETE of a row of a TEST PRINCIPAL's account (registered in `test_principals`, 0044), and only while a test reset
--      is running for that account (`test_reset_jobs`, 0045, status `running`). A test principal keeps nothing (ADR-0040), and its rows would otherwise stay
--      for good: the recipe delete of the reset empties `recipe_id`, so the cascade no longer takes them. A queued reset has not
--      begun, and a reset of one account never frees another account's rows.
-- A purge of rows past their retention gets its own exception when the purge job is built.
--
-- TWO: SEARCH PATH. A trigger or SQL function that names `recipes` with no schema is resolved through the session's search
-- path, and a session's own temporary schema comes FIRST unless `pg_temp` is listed. `CREATE TEMP TABLE recipes (id uuid)` in a
-- session of a role that may create temporary tables made `NOT EXISTS (SELECT 1 FROM recipes ...)` true, which let a DELETE
-- through the guard. Every function of 0086, 0087 and 0088 is recreated with a pinned path that lists `pg_temp` LAST.
--
-- THREE: `recipe_is_from_person` also counts a PAST `fromPerson` attestation when the stored statement is NULL, the SQL twin of
-- `fromPersonOf` (recipe-core). Without it a cook could say "from another person", clear the statement, and publish.
--
-- Expand-only: a nullable-to-be column backfilled in this file, a foreign key action, and `CREATE OR REPLACE` of functions.

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
    'Append-only record of every statement a cook made about a recipe and every Public confirmation, one row per act. UPDATE raises, except the foreign key emptying recipe_id of a recipe that is gone, and the erasure swap of account_id to an erased_ token while an erasure job is queued or running for that account. DELETE raises, except for a registered test principal while a test reset is running for the row''s account. recipe_ref keeps the recipe id after the recipe is deleted.';

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

    -- The erasure swap: account_id alone, from a real id to an erased token, while the account's erasure is in flight.
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
       AND EXISTS (
           SELECT 1 FROM account_erasure_jobs j
            WHERE j.owner_id = OLD.account_id AND j.status IN ('queued', 'running')
       ) THEN
        RETURN NEW;
    END IF;

    -- A test principal's reset: its own rows, while its reset is running.
    IF TG_OP = 'DELETE'
       AND EXISTS (
           SELECT 1 FROM test_reset_jobs j
            WHERE j.user_id = OLD.account_id AND j.status = 'running'
       )
       AND EXISTS (SELECT 1 FROM test_principals p WHERE p.user_id = OLD.account_id) THEN
        RETURN OLD;
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
