-- 0092 — the persisted facts behind the source lock (P8, ADR-0099): a recipe's source answer is CONFIRMED once, a staff
-- correction can HOLD a recipe off Public, and every correction leaves an append-only RECORD.
--
-- ⛔ A COOK NEVER WRITES THESE. Once a recipe's source answer is confirmed, only Commise changes it (owner Q4, 2026-11-19,
-- ADR-0097 decision 3). The service refuses a cook's change by reading `source_confirmed_at`; staff change an answer through
-- one granted route that writes the record below in the same transaction.
--
-- 1. `recipes.source_confirmed_at` — when the answer was first confirmed, and never changed or cleared afterwards. The ACT sets
--    it (plan KTD-3): the database on the first publish (this file extends the 0053 trigger, so an insert saved as published
--    and the erasure donation confirm too), the service on a Make public that carries a statement and on a staff correction.
--    An editor save of a draft never confirms. The ratchet is a trigger of its own, with no column list, so no statement can
--    slip past it: it allows NULL to a value and nothing else. `CHECK (first_published_at IS NULL OR source_confirmed_at IS NOT
--    NULL)` states the invariant a published row must satisfy.
--
-- 2. `recipes.source_correction_hold` — a correction that could itself open a Public path (to "I wrote this" or "From another
--    person", or off a paid site) holds the recipe off Public. It is its own fact and NOT a read of the correction record: the
--    hold must survive a clone, and an EXISTS on the record table would not. A ratchet (false to true only), a CHECK that no
--    held recipe is public, whatever writer sets `visibility`, and a BEFORE INSERT trigger that copies the hold onto a clone.
--
-- 3. `recipe_source_corrections` — who changed which recipe's answer, when, from what to what, on what ground and why.
--    ⛔ APPEND-ONLY BY TRIGGER, NOT BY REVOKE, for the reason 0086 gives (the grant setup re-grants every table). It admits the
--    ON DELETE CASCADE of a recipe that is gone, and ONE update: account erasure replaces `actor_account_id` with an erased
--    token while an erasure job for that account is in flight (0090's condition), moving no other column.
--
-- 4. `recipe_source_evidence.capture` gains `staffCorrection`: a correction to a web page, a book or a paid site appends the
--    evidence row that answer needs, because 0086's deferred constraint refuses a stated source with none. Evidence only
--    holds Public; it never opens it.
--
-- REVERSIBLE BY A MIGRATION WHILE THE APP IS NOT LIVE, ONE-WAY AT LAUNCH (ADR-0099). EXPAND-ONLY: two columns with a default,
-- a table, triggers, and a CHECK on the capture that accepts strictly more than before. Code from the previous release writes
-- none of it and reads none of it. The new CHECKs hold for every existing row (nothing is held; every published row is
-- backfilled below).

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipes
    ADD COLUMN source_confirmed_at timestamptz,
    ADD COLUMN source_correction_hold boolean NOT NULL DEFAULT false;

-- A recipe that was already published has had its source answer in front of readers: it is confirmed at its first publish.
UPDATE recipes
   SET source_confirmed_at = first_published_at
 WHERE first_published_at IS NOT NULL
   AND source_confirmed_at IS NULL;

ALTER TABLE recipes
    ADD CONSTRAINT recipes_first_published_has_source_confirmed
        CHECK (first_published_at IS NULL OR source_confirmed_at IS NOT NULL),
    ADD CONSTRAINT recipes_held_is_not_public
        CHECK (NOT (source_correction_hold AND visibility = 'public'));

COMMENT ON COLUMN recipes.source_confirmed_at IS
    'When the recipe''s source answer was first confirmed (the first publish, a Make public that carries a statement, or a staff correction). Never changed or cleared once set. A cook cannot change a confirmed answer (ADR-0099).';
COMMENT ON COLUMN recipes.source_correction_hold IS
    'True once a staff correction that could itself open a Public path was applied to this recipe or to the recipe it was cloned from. Never cleared. A held recipe is never public (ADR-0099).';

-- 0053's trigger now also confirms the answer on the first publish. It runs BEFORE the ratchet below (triggers fire in name
-- order: `trg_recipes_first_published_at` sorts before `trg_recipes_source_confirmed_ratchet`).
CREATE OR REPLACE FUNCTION recipes_first_published_at_ratchet() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.first_published_at IS NOT NULL THEN
        IF NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
            RAISE EXCEPTION 'recipes.first_published_at is set on the first publish and never changed (ADR-0058)'
                USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
    END IF;

    -- Derived, not written: a value a writer supplies is replaced by the rule. A published row keeps a stated instant
    -- on INSERT (a seeding tool may carry one); everything else is decided here.
    IF NEW.status = 'published' THEN
        NEW.first_published_at := CASE
            WHEN TG_OP = 'INSERT' THEN coalesce(NEW.first_published_at, now())
            ELSE now()
        END;
        -- The first publish confirms the source answer, and keeps an earlier confirmation (ADR-0099).
        NEW.source_confirmed_at := CASE
            WHEN TG_OP = 'INSERT' THEN coalesce(NEW.source_confirmed_at, NEW.first_published_at)
            ELSE coalesce(OLD.source_confirmed_at, NEW.source_confirmed_at, NEW.first_published_at)
        END;
    ELSE
        NEW.first_published_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE FUNCTION recipes_source_confirmed_ratchet() RETURNS trigger AS $$
BEGIN
    IF OLD.source_confirmed_at IS NOT NULL AND NEW.source_confirmed_at IS DISTINCT FROM OLD.source_confirmed_at THEN
        RAISE EXCEPTION 'recipes.source_confirmed_at is set once and never changed or cleared (ADR-0099)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

-- No column list: a statement that touches any column meets it, so no writer can reach the column some other way.
CREATE TRIGGER trg_recipes_source_confirmed_ratchet
    BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION recipes_source_confirmed_ratchet();

CREATE FUNCTION recipes_source_correction_hold_ratchet() RETURNS trigger AS $$
BEGIN
    IF OLD.source_correction_hold AND NOT NEW.source_correction_hold THEN
        RAISE EXCEPTION 'recipes.source_correction_hold goes from false to true and never back (ADR-0099)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipes_source_correction_hold_ratchet
    BEFORE UPDATE OF source_correction_hold ON recipes
    FOR EACH ROW EXECUTE FUNCTION recipes_source_correction_hold_ratchet();

-- A clone carries the hold of the recipe it was copied from, written by the database, so cloning is not a way around it
-- whichever writer sets `cloned_from_id`. BEFORE INSERT, because it sets a column of the row being inserted: the AFTER INSERT
-- clone triggers of 0086 and 0090 write another table.
CREATE FUNCTION recipes_clone_inherits_source_correction_hold() RETURNS trigger AS $$
BEGIN
    NEW.source_correction_hold := NEW.source_correction_hold OR coalesce(
        (SELECT p.source_correction_hold FROM recipes p WHERE p.id = NEW.cloned_from_id), false);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipes_clone_inherits_source_correction_hold
    BEFORE INSERT ON recipes
    FOR EACH ROW WHEN (NEW.cloned_from_id IS NOT NULL)
    EXECUTE FUNCTION recipes_clone_inherits_source_correction_hold();

CREATE TABLE recipe_source_corrections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    actor_account_id varchar(255) NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    old_source_type text NOT NULL,
    new_source_type text NOT NULL,
    old_source_kind text,
    new_source_kind text,
    old_statement_kind text,
    new_statement_kind text,
    old_source_url text CHECK (length(old_source_url) <= 2000),
    new_source_url text CHECK (length(new_source_url) <= 2000),
    old_source_attribution text CHECK (length(old_source_attribution) <= 500),
    new_source_attribution text CHECK (length(new_source_attribution) <= 500),
    ground text NOT NULL CHECK (ground IN ('ownerConfirmedByAccountEmail')),
    reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 1000),
    CONSTRAINT recipe_source_corrections_actor_shape CHECK (
        actor_account_id !~ '^erased_' OR actor_account_id ~ '^erased_[0-9a-f]{32}$')
);

CREATE INDEX recipe_source_corrections_recipe_idx ON recipe_source_corrections (recipe_id, recorded_at);

COMMENT ON TABLE recipe_source_corrections IS
    'Append-only record of every staff correction of a recipe''s source answer: who, when, old and new answer with its citation, the ground and the reason. UPDATE and DELETE raise, except the cascade of a deleted recipe and the one erasure UPDATE that replaces actor_account_id with an erased_ token. The reason is never logged.';

CREATE FUNCTION recipe_source_corrections_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id) THEN
        RETURN OLD; -- the recipe is gone: only its ON DELETE CASCADE reaches here
    END IF;

    -- The erasure relabel: the actor alone, from a real id to an erased token, while the actor's erasure is in flight (or the
    -- actor is a registered test principal whose reset is running), as 0090 allows for the attestations. Every other column
    -- must be unchanged.
    IF TG_OP = 'UPDATE'
       AND OLD.actor_account_id !~ '^erased_'
       AND NEW.actor_account_id ~ '^erased_[0-9a-f]{32}$'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.recipe_id IS NOT DISTINCT FROM OLD.recipe_id
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
       AND NEW.old_source_type IS NOT DISTINCT FROM OLD.old_source_type
       AND NEW.new_source_type IS NOT DISTINCT FROM OLD.new_source_type
       AND NEW.old_source_kind IS NOT DISTINCT FROM OLD.old_source_kind
       AND NEW.new_source_kind IS NOT DISTINCT FROM OLD.new_source_kind
       AND NEW.old_statement_kind IS NOT DISTINCT FROM OLD.old_statement_kind
       AND NEW.new_statement_kind IS NOT DISTINCT FROM OLD.new_statement_kind
       AND NEW.old_source_url IS NOT DISTINCT FROM OLD.old_source_url
       AND NEW.new_source_url IS NOT DISTINCT FROM OLD.new_source_url
       AND NEW.old_source_attribution IS NOT DISTINCT FROM OLD.old_source_attribution
       AND NEW.new_source_attribution IS NOT DISTINCT FROM OLD.new_source_attribution
       AND NEW.ground IS NOT DISTINCT FROM OLD.ground
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason
       AND (
           EXISTS (
               SELECT 1 FROM account_erasure_jobs j
                WHERE j.owner_id = OLD.actor_account_id AND j.status IN ('queued', 'running')
           )
           OR (
               EXISTS (SELECT 1 FROM test_principals p WHERE p.user_id = OLD.actor_account_id)
               AND EXISTS (
                   SELECT 1 FROM test_reset_jobs j
                    WHERE j.user_id = OLD.actor_account_id AND j.status = 'running'
               )
           )
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'recipe_source_corrections is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipe_source_corrections_append_only
    BEFORE UPDATE OR DELETE ON recipe_source_corrections
    FOR EACH ROW EXECUTE FUNCTION recipe_source_corrections_append_only();

-- `TRUNCATE` fires no row trigger, and `TRUNCATE recipes CASCADE` reaches this table: a statement trigger refuses it (see 0086).
CREATE FUNCTION recipe_source_corrections_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_source_corrections is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipe_source_corrections_no_truncate
    BEFORE TRUNCATE ON recipe_source_corrections
    FOR EACH STATEMENT EXECUTE FUNCTION recipe_source_corrections_no_truncate();

-- A correction to a web page, a book or a paid site appends the evidence row that answer needs.
ALTER TABLE recipe_source_evidence
    DROP CONSTRAINT recipe_source_evidence_capture_check,
    ADD CONSTRAINT recipe_source_evidence_capture_check
        CHECK (capture IN ('pastedPage', 'editorLink', 'editorCitation', 'importFile', 'staffCorrection')),
    DROP CONSTRAINT recipe_source_evidence_capture_shape,
    ADD CONSTRAINT recipe_source_evidence_capture_shape CHECK (
        (capture <> 'editorLink' OR source_kind = 'public_web')
        AND (capture <> 'editorCitation' OR (source_kind IN ('book', 'paid_site') AND citation IS NOT NULL))
        AND (capture <> 'importFile' OR source_kind IS NOT NULL)
        AND (capture <> 'staffCorrection' OR source_kind IS NOT NULL)
        AND (capture <> 'pastedPage' OR paste_digest IS NOT NULL));
