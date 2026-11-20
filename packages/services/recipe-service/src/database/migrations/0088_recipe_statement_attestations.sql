-- 0088 — recipe_statement_attestations: an append-only record of every statement a cook made about a recipe, and every
-- time they confirmed Public.
--
-- WHY A TABLE OF ITS OWN. Columns on `recipes` keep only the latest act: a cook who says "I wrote this", clears it and says
-- it again would leave one row. `recipe_source_evidence` holds facts about the CONTENT, and `sourceConflictOf`,
-- `recipe_holds_third_party_source` and `recipe_needs_statement` count any row there; a cook's own act in it would have to be
-- filtered out of all three. So the cook's acts get their own table, one row per act, append-only, with a `version` and a
-- `locale` like a terms acceptance: a record that can be rewritten is not a record.
--
-- WHAT A ROW RECORDS. `choice` is what the cook said (`authored`, `publicWeb`, `book`, `fromPerson`, `cleared`, or the passive
-- `publicConfirm` shown beside the Public choice); `wording_version` and `locale` name the copy they saw (a key into the closed
-- lists in recipe-core, never the text, so a new wording needs no migration); `action` is the write it rode on. `mode` is
-- `explicit` for a statement and `implicit` for the confirmation, and the two are tied by a CHECK so neither can be recorded as
-- the other. A `cleared` row has no wording: nothing was shown.
--
-- WHO WRITES IT. The service, in the same transaction as the write it records and after the version check, so a refused or
-- rolled-back write leaves no row. A clone copies none: they are the acts of the cook who made them.
--
-- ⛔ APPEND-ONLY BY TRIGGER, NOT BY REVOKE, for the reason 0086 gives: the grant setup re-grants UPDATE and DELETE on every
-- table inside every migration, so a REVOKE here would be undone before this file commits. The trigger admits exactly two
-- writes beyond INSERT:
--   1. the `ON DELETE CASCADE` of a recipe that is already gone;
--   2. ONE UPDATE, made by account erasure: `account_id` changes from a real id to an erased token, and no other column moves.
-- Account erasure therefore deletes the rows of a recipe it removes, and for a recipe it keeps (a donated one) it replaces
-- `account_id` with ONE random token per erasure, so the kept rows still say what was chosen, in which wording and locale, and
-- when, but no longer say by whom. The token is `erased_` plus 32 lowercase hex characters, links to nothing else, and the
-- CHECK below admits no other `erased_` value.
--
-- `account_id` equals `recipes.owner_id` at the time of the act.
--
-- ⚠️ ON A DONATED RECIPE THE ACCOUNT ID STAYS REACHABLE for now. The token above replaces `account_id` on these rows only.
-- `recipes.owner_id` and `recipe_versions.created_by` still hold the erased account's id on a donated recipe until the next PR
-- gives them the same token, so a person who reads the recipe's row can still tell whose account it was.
--
-- ALSO IN THIS FILE: the editor may now state a BOOK ("from a cookbook or magazine"), which writes evidence with a new capture,
-- `editorCitation`. 0086 named neither CHECK, so PostgreSQL named the inline one `recipe_source_evidence_capture_check`
-- (confirmed against a migrated database); both are dropped and re-added widened.
--
-- EXPAND-ONLY: a new table, a function and trigger, and two CHECKs that accept strictly more than before. Code from the
-- previous release writes none of it and reads none of it.

SET LOCAL lock_timeout = '5s';

CREATE TABLE recipe_statement_attestations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    account_id varchar(255) NOT NULL,
    mode text NOT NULL CHECK (mode IN ('explicit', 'implicit')),
    choice text NOT NULL CHECK (choice IN ('authored', 'publicWeb', 'book', 'fromPerson', 'cleared', 'publicConfirm')),
    wording_version text CHECK (wording_version ~ '^[a-z][A-Za-z0-9]*\.v[0-9]+$'),
    locale text CHECK (length(locale) BETWEEN 2 AND 35),
    action text NOT NULL CHECK (action IN ('create', 'update', 'setVisibility')),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recipe_statement_attestations_account_shape CHECK (
        account_id !~ '^erased_' OR account_id ~ '^erased_[0-9a-f]{32}$'),
    CONSTRAINT recipe_statement_attestations_mode_choice CHECK ((mode = 'implicit') = (choice = 'publicConfirm')),
    CONSTRAINT recipe_statement_attestations_wording CHECK (
        (choice = 'cleared') = (wording_version IS NULL) AND (wording_version IS NULL) = (locale IS NULL))
);

CREATE INDEX recipe_statement_attestations_recipe_idx ON recipe_statement_attestations (recipe_id, recorded_at);

COMMENT ON TABLE recipe_statement_attestations IS
    'Append-only record of every statement a cook made about a recipe and every Public confirmation, one row per act. UPDATE and DELETE raise, except the cascade of a deleted recipe and the one erasure UPDATE that replaces account_id with an erased_ token.';

CREATE FUNCTION recipe_statement_attestations_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id) THEN
        RETURN OLD; -- the recipe is gone: only its ON DELETE CASCADE reaches here
    END IF;

    -- The erasure swap: account_id alone, from a real id to an erased token. Every other column must be unchanged.
    IF TG_OP = 'UPDATE'
       AND OLD.account_id !~ '^erased_'
       AND NEW.account_id ~ '^erased_[0-9a-f]{32}$'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.recipe_id IS NOT DISTINCT FROM OLD.recipe_id
       AND NEW.mode IS NOT DISTINCT FROM OLD.mode
       AND NEW.choice IS NOT DISTINCT FROM OLD.choice
       AND NEW.wording_version IS NOT DISTINCT FROM OLD.wording_version
       AND NEW.locale IS NOT DISTINCT FROM OLD.locale
       AND NEW.action IS NOT DISTINCT FROM OLD.action
       AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'recipe_statement_attestations is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipe_statement_attestations_append_only
    BEFORE UPDATE OR DELETE ON recipe_statement_attestations
    FOR EACH ROW EXECUTE FUNCTION recipe_statement_attestations_append_only();

-- `TRUNCATE` fires no row trigger, and `TRUNCATE recipes CASCADE` reaches this table. A statement trigger refuses it, with a
-- function of its own that reads no `OLD` (see 0086). The owner can drop it; this stops the slip, not a decision. The test
-- harness switches it off for one transaction to empty a test database, and a LOCAL e2e test proves both.
CREATE FUNCTION recipe_statement_attestations_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_statement_attestations is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipe_statement_attestations_no_truncate
    BEFORE TRUNCATE ON recipe_statement_attestations
    FOR EACH STATEMENT EXECUTE FUNCTION recipe_statement_attestations_no_truncate();

ALTER TABLE recipe_source_evidence
    DROP CONSTRAINT recipe_source_evidence_capture_check,
    ADD CONSTRAINT recipe_source_evidence_capture_check
        CHECK (capture IN ('pastedPage', 'editorLink', 'editorCitation', 'importFile')),
    DROP CONSTRAINT recipe_source_evidence_capture_shape,
    ADD CONSTRAINT recipe_source_evidence_capture_shape CHECK (
        (capture <> 'editorLink' OR source_kind = 'public_web')
        AND (capture <> 'editorCitation' OR (source_kind = 'book' AND citation IS NOT NULL))
        AND (capture <> 'importFile' OR source_kind IS NOT NULL)
        AND (capture <> 'pastedPage' OR paste_digest IS NOT NULL));
