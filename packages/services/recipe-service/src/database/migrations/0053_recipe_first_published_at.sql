-- A recipe records when it was FIRST published, and that fact decides whether a save records a version (ADR-0058,
-- which amends ADR-0034).
--
-- A save of a never-published draft overwrites it in place and writes no `recipe_versions` row; versions start at the
-- first publish. The editor saves a draft on a cadence, so a version per save would push the cook's real history out
-- of the ten-version window (`VERSION_RETENTION_LIMIT`).
--
-- ⛔ NOT `status`. A published recipe may be set back to draft (`PATCH … { status: 'draft' }`), and its saves must keep
-- versioning. So the decision needs a fact that, once true, stays true: `first_published_at` is set on the first
-- publish and never cleared.
--
-- ⛔ A TRIGGER, NOT A CHECK, because "never cleared" compares OLD with NEW, and a CHECK sees only NEW (the reasoning
-- feature 015 recorded for its ratchet). The trigger also SETS the column, so every writer gets the same rule — the
-- service's DAL, and every tool that inserts recipes directly — and no application code writes it. The CHECK beside
-- it states the invariant a published row must satisfy.
--
-- ⚠️ EXPAND-ONLY. The column is added nullable and backfilled for published rows, which the CHECK needs. Drafts stay
-- NULL: nothing is live (owner, 2026-09-26), so no draft's earlier publish history is lost by that.

ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS first_published_at timestamptz;

UPDATE recipes
   SET first_published_at = created_at
 WHERE status = 'published'
   AND first_published_at IS NULL;

ALTER TABLE recipes
    ADD CONSTRAINT recipes_published_has_first_published_at
        CHECK (status <> 'published' OR first_published_at IS NOT NULL);

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
    ELSE
        NEW.first_published_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipes_first_published_at
    BEFORE INSERT OR UPDATE OF status, first_published_at
    ON recipes
    FOR EACH ROW
    EXECUTE FUNCTION recipes_first_published_at_ratchet();
