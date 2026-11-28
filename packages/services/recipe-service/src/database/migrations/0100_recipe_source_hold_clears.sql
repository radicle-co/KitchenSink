-- 0100 — a correction hold has two ways back, and each is one audited record (ADR-0106).
--
-- 1. `recipe_source_hold_clears`: one row per cleared recipe (`cause` staff | earnedRewrite). APPEND-ONLY BY TRIGGER, NOT BY
--    GRANT, for the reason 0086 gives (its grant setup re-grants every table, so the application roles hold UPDATE and DELETE).
--    "Staff only" is a service rule; no reader or cook response selects this table. The carve-outs are those of 0092's
--    `recipe_source_corrections`: the cascade of a deleted recipe and the erasure relabel of the actor, which freezes every
--    other column.
-- 2. `recorded_at` and `xact_id` (xid8) are written by a BEFORE INSERT trigger and never by the caller. The stamp trigger also
--    locks the recipe and refuses a record for a recipe that is not held. `UNIQUE (recipe_id, xact_id)`: one clear per recipe
--    per transaction. A deferred constraint trigger checks at commit that the hold is false, so a clear rolled back to a
--    savepoint cannot leave a record behind.
-- 3. The hold ratchet is replaced and recreated AFTER UPDATE, restricted to a change of the column. An AFTER row trigger sees the
--    final row after every BEFORE trigger, so no BEFORE trigger can write the hold unseen. ⛔ Nothing may write the hold except
--    through the rule: true to false only with a record for this recipe, this transaction and this instant; false to true is
--    refused when such a record exists (no hold after a clear in the same transaction).
-- 4. `recipe_held_from_readers` gains the fourth term `recipe_is_from_person(r.id)`: a from-person recipe stays hidden after a
--    clear. BODY ONLY. A later rewrite of the function keeps that term (a repoGuards check reads the newest definition).
-- 5. The legacy SQL twin `recipe_holds_third_party_source` keeps its body (a worker from before A2 may still call it).
--
-- Trust model, one line each: a savepoint takes the top-level transaction id and the deferred check catches a rolled-back clear;
-- COMMIT PREPARED and logical apply run no trigger; an owner or master role bypasses every trigger and DD17 keeps services off
-- those roles. EXPAND-ONLY: a table, triggers, one replaced function body; no data change, no grant change.
-- The stamp trigger's `AND FOUND` is deliberate: a record for a recipe that does not exist is left to the foreign key (23503).

SET LOCAL lock_timeout = '5s';

CREATE TABLE recipe_source_hold_clears (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    cause text NOT NULL,
    actor_account_id varchar(255),
    reason text NOT NULL,
    recorded_at timestamptz NOT NULL,
    xact_id xid8 NOT NULL,
    CONSTRAINT recipe_source_hold_clears_cause_check CHECK (cause IN ('staff', 'earnedRewrite')),
    CONSTRAINT recipe_source_hold_clears_cause_actor CHECK ((cause = 'staff') = (actor_account_id IS NOT NULL)),
    CONSTRAINT recipe_source_hold_clears_earned_reason CHECK (cause <> 'earnedRewrite' OR reason = 'earnedRewrite'),
    CONSTRAINT recipe_source_hold_clears_reason_check CHECK (btrim(reason) <> '' AND length(reason) <= 1000),
    CONSTRAINT recipe_source_hold_clears_actor_shape CHECK (
        actor_account_id !~ '^erased_' OR actor_account_id ~ '^erased_[0-9a-f]{32}$'),
    CONSTRAINT recipe_source_hold_clears_recipe_xact_key UNIQUE (recipe_id, xact_id)
);

COMMENT ON TABLE recipe_source_hold_clears IS
    'Append-only record of every clear of a recipe''s correction hold: cause staff (actor and reason) or earnedRewrite. UPDATE and DELETE raise, except the cascade of a deleted recipe and the one erasure UPDATE that replaces actor_account_id with an erased_ token. Read by staff only; the reason is never logged (ADR-0106).';

CREATE FUNCTION recipe_source_hold_clears_stamp() RETURNS trigger AS $$
DECLARE
    held boolean;
BEGIN
    -- Written here, whatever the caller sent.
    NEW.xact_id := pg_current_xact_id();
    NEW.recorded_at := now();

    -- Locks the recipe (a no-op when the service already holds the lock) so two direct writers serialise.
    SELECT source_correction_hold INTO held FROM recipes WHERE id = NEW.recipe_id FOR UPDATE;

    IF held IS NOT TRUE AND FOUND THEN
        RAISE EXCEPTION 'recipe_source_hold_clears: the recipe is not held' USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipe_source_hold_clears_stamp
    BEFORE INSERT ON recipe_source_hold_clears
    FOR EACH ROW EXECUTE FUNCTION recipe_source_hold_clears_stamp();

CREATE FUNCTION recipe_source_hold_clears_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id) THEN
        RETURN OLD; -- the recipe is gone: only its ON DELETE CASCADE reaches here
    END IF;

    -- The erasure relabel: the actor alone, from a real id to an erased token, while the actor's erasure is in flight (or the
    -- actor is a registered test principal whose reset is running), as 0092 allows for the corrections.
    IF TG_OP = 'UPDATE'
       AND OLD.actor_account_id IS NOT NULL
       AND OLD.actor_account_id !~ '^erased_'
       AND NEW.actor_account_id ~ '^erased_[0-9a-f]{32}$'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.recipe_id IS NOT DISTINCT FROM OLD.recipe_id
       AND NEW.cause IS NOT DISTINCT FROM OLD.cause
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
       AND NEW.xact_id IS NOT DISTINCT FROM OLD.xact_id
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

    RAISE EXCEPTION 'recipe_source_hold_clears is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipe_source_hold_clears_append_only
    BEFORE UPDATE OR DELETE ON recipe_source_hold_clears
    FOR EACH ROW EXECUTE FUNCTION recipe_source_hold_clears_append_only();

-- `TRUNCATE` fires no row trigger, and `TRUNCATE recipes CASCADE` reaches this table: a statement trigger refuses it (see 0086).
CREATE FUNCTION recipe_source_hold_clears_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_source_hold_clears is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER trg_recipe_source_hold_clears_no_truncate
    BEFORE TRUNCATE ON recipe_source_hold_clears
    FOR EACH STATEMENT EXECUTE FUNCTION recipe_source_hold_clears_no_truncate();

-- At COMMIT the recipe must be cleared. A recipe deleted in the same transaction passes.
CREATE FUNCTION recipe_source_hold_clears_cleared_at_commit() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM recipes WHERE id = NEW.recipe_id AND source_correction_hold) THEN
        RAISE EXCEPTION 'recipe_source_hold_clears: a clear record needs the hold cleared in the same transaction'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

CREATE CONSTRAINT TRIGGER recipe_source_hold_clears_cleared_at_commit
    AFTER INSERT ON recipe_source_hold_clears
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION recipe_source_hold_clears_cleared_at_commit();

-- The ratchet, AFTER the row is final (see the header).
CREATE OR REPLACE FUNCTION recipes_source_correction_hold_ratchet() RETURNS trigger AS $$
DECLARE
    cleared boolean;
BEGIN
    cleared := EXISTS (
        SELECT 1 FROM recipe_source_hold_clears c
         WHERE c.recipe_id = OLD.id AND c.xact_id = pg_current_xact_id() AND c.recorded_at = now());

    IF OLD.source_correction_hold AND NOT NEW.source_correction_hold AND NOT cleared THEN
        RAISE EXCEPTION 'recipes.source_correction_hold is cleared only with a clear record in the same transaction (ADR-0106)'
            USING ERRCODE = 'check_violation';
    ELSIF NOT OLD.source_correction_hold AND NEW.source_correction_hold AND cleared THEN
        RAISE EXCEPTION 'recipes.source_correction_hold: no hold after a clear in the same transaction (ADR-0106)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER trg_recipes_source_correction_hold_ratchet ON recipes;

CREATE TRIGGER trg_recipes_source_correction_hold_ratchet
    AFTER UPDATE ON recipes
    FOR EACH ROW WHEN (OLD.source_correction_hold IS DISTINCT FROM NEW.source_correction_hold)
    EXECUTE FUNCTION recipes_source_correction_hold_ratchet();

-- The read function calls it, and a PARALLEL UNSAFE callee would make the caller unsafe too. Body and config are 0090's.
ALTER FUNCTION recipe_is_from_person(uuid) PARALLEL SAFE;

-- The fourth term. CREATE OR REPLACE resets unstated attributes, so every attribute is restated.
CREATE OR REPLACE FUNCTION recipe_held_from_readers(r recipes, private_only_keys jsonb) RETURNS boolean AS $$
    SELECT coalesce(r.source_correction_hold, false)
        OR recipe_has_cook_source_evidence(r.id)
        OR coalesce(
               (r.source_type || ':' || coalesce(r.source_kind, '')) IN (SELECT jsonb_array_elements_text(private_only_keys)),
               false)
        OR recipe_is_from_person(r.id);
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION recipe_holds_third_party_source(uuid) IS
    'Legacy: no caller after A2 (the write side is sourceConflictOf, which ignores staffCorrection evidence). Kept for a worker from before A2; drop in a later contract migration (ADR-0106).';

COMMENT ON COLUMN recipes.source_correction_hold IS
    'Set by a staff correction (or inherited by a clone). Cleared only with a recipe_source_hold_clears record in the same transaction (ADR-0106). A held recipe is hidden from readers whatever its visibility (ADR-0105).';
