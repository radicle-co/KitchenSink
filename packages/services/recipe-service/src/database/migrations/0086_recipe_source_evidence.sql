-- 0086 — recipe_source_evidence: an append-only record of every third-party source ever stated for a recipe.
--
-- WHY. A cook may state a web source on a draft and later clear it (`PATCH statement: null`), and a cleared statement reads as
-- `user_created`. Without a record that outlives the statement, a copied recipe could be published Public as the cook's own
-- work. The evidence rule refuses Public while any evidence of a third-party source exists (`sourceConflictOf`, recipe-core:
-- the ONE seam the feature-020 hold replaces). Private is never refused by it.
--
-- WHO WRITES IT. The service writes each row in the same transaction as the statement it records (create, a PATCH that applies
-- a statement, the import save). A trigger on `recipes` could not: it cannot know the `capture`, and a pasted page's evidence
-- (`paste_digest`, `credit_*`, `image_url`) exists only in the request. The paste-only columns are kept now, because a later
-- change writes them and a column added later is a second migration on a table that is already append-only.
--
-- ⛔ APPEND-ONLY BY TRIGGER, NOT BY REVOKE. The grant setup re-runs `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` inside
-- every migration and again after the last one, so a REVOKE here would be undone before this file commits. A trigger binds
-- every role: the service, the migrator, the owner and raw SQL. The one DELETE it admits is the `ON DELETE CASCADE` of a
-- recipe that is already gone, so account erasure and the test purge still remove a recipe's evidence with it. `TRUNCATE` has
-- a statement trigger of its own, below.
--
-- ⛔ A STATED SOURCE WITHOUT EVIDENCE CANNOT COMMIT. A deferred constraint trigger on `recipes` raises when a row with a
-- `source_kind` has no evidence row of the same kind and address, so a writer that forgot the evidence (or a raw INSERT) fails
-- at COMMIT, never silently.
--
-- ⛔ A CLONE INHERITS ITS PARENT'S EVIDENCE, written by the database, so cloning is not a way to launder a source, whichever
-- writer sets `cloned_from_id`. It runs before the deferred check above, so a clone of a web copy commits.
--
-- EXPAND-ONLY: a new table and two triggers on `recipes`. Code from the previous release writes no evidence, so after this file
-- applies and before the new code ships, its writes that state a source fail the backstop at commit (ADR-0035's deploy window):
-- the schema stack is deployed AHEAD of the service, and a statement written in that window is refused rather than lost.

SET LOCAL lock_timeout = '5s';

CREATE TABLE recipe_source_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    capture text NOT NULL CHECK (capture IN ('pastedPage', 'editorLink', 'importFile')),
    source_url text CHECK (length(source_url) <= 2000),
    source_key text CHECK (length(source_key) <= 2000),
    source_domain text CHECK (length(source_domain) <= 253),
    source_kind text CHECK (source_kind IN ('public_web', 'book', 'paid_site')),
    citation text CHECK (citation IS NULL OR (btrim(citation) <> '' AND length(citation) <= 500)),
    paste_digest text CHECK (paste_digest ~ '^[0-9a-f]{64}$'),
    credit_authors text[] CHECK (credit_authors IS NULL OR (cardinality(credit_authors) <= 10
        AND length(array_to_string(credit_authors, chr(31))) <= 2000)),
    credit_publisher text CHECK (length(credit_publisher) <= 500),
    credit_copyright_notice text CHECK (length(credit_copyright_notice) <= 1000),
    credit_copyright_holder text CHECK (length(credit_copyright_holder) <= 500),
    credit_license text CHECK (length(credit_license) <= 500),
    image_url text CHECK (length(image_url) <= 2000),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recipe_source_evidence_url_key_pair CHECK ((source_url IS NULL) = (source_key IS NULL)),
    CONSTRAINT recipe_source_evidence_web_has_url CHECK (source_kind IS DISTINCT FROM 'public_web'
        OR (source_url IS NOT NULL AND source_domain IS NOT NULL)),
    CONSTRAINT recipe_source_evidence_offline_has_citation CHECK (source_kind IS NULL
        OR source_kind NOT IN ('book', 'paid_site') OR source_domain IS NOT NULL OR citation IS NOT NULL),
    CONSTRAINT recipe_source_evidence_capture_shape CHECK (
        (capture <> 'editorLink' OR source_kind = 'public_web')
        AND (capture <> 'importFile' OR source_kind IS NOT NULL)
        AND (capture <> 'pastedPage' OR paste_digest IS NOT NULL))
);

CREATE INDEX recipe_source_evidence_recipe_id_idx ON recipe_source_evidence (recipe_id);
CREATE INDEX recipe_source_evidence_source_key_idx ON recipe_source_evidence (source_key);

COMMENT ON TABLE recipe_source_evidence IS
    'Append-only record of every third-party source ever stated for a recipe. A recipe with a row whose source_domain is set, or whose source_kind is book or paid_site, may not be Public (sourceConflictOf). UPDATE and DELETE raise, except the cascade of a deleted recipe.';

-- The SQL twin of the evidence half of `sourceConflictOf` (recipe-core), for the one query that must ask it: account erasure's
-- donate step, which composes it with the bound private-only keys. A FUNCTION and not an exported SQL string, on the precedent of
-- `recipe_holds_private_food` (0064): no SQL text crosses a package boundary. A LOCAL e2e test holds the pair against the TS rule.
CREATE FUNCTION recipe_holds_third_party_source(p_recipe_id uuid) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM recipe_source_evidence e
         WHERE e.recipe_id = p_recipe_id
           AND (e.source_domain IS NOT NULL OR e.source_kind IN ('book', 'paid_site'))
    );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION recipe_source_evidence_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM recipes WHERE id = OLD.recipe_id) THEN
        RETURN OLD; -- the recipe is gone: only its ON DELETE CASCADE reaches here
    END IF;

    RAISE EXCEPTION 'recipe_source_evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipe_source_evidence_append_only
    BEFORE UPDATE OR DELETE ON recipe_source_evidence
    FOR EACH ROW EXECUTE FUNCTION recipe_source_evidence_append_only();

-- `TRUNCATE` fires no row trigger, so the guard above never sees it, and `TRUNCATE recipes CASCADE` reaches this table too. A
-- statement trigger refuses it. It is a function of its own that reads no `OLD`: a statement trigger has no row. The owner is
-- the only role that holds the right, and it can drop a trigger; this stops the slip (a TRUNCATE typed against the wrong
-- table, or a cascade nobody read), not a decision. The test harness switches it off for one transaction to empty a test
-- database (`RoleDatabase.truncate`), and a LOCAL e2e test proves both.
CREATE FUNCTION recipe_source_evidence_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'recipe_source_evidence is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipe_source_evidence_no_truncate
    BEFORE TRUNCATE ON recipe_source_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION recipe_source_evidence_no_truncate();

CREATE FUNCTION recipes_clone_inherits_source_evidence() RETURNS trigger AS $$
BEGIN
    INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain, source_kind, citation,
        paste_digest, credit_authors, credit_publisher, credit_copyright_notice, credit_copyright_holder, credit_license,
        image_url, recorded_at)
    SELECT NEW.id, capture, source_url, source_key, source_domain, source_kind, citation, paste_digest, credit_authors,
           credit_publisher, credit_copyright_notice, credit_copyright_holder, credit_license, image_url, recorded_at
      FROM recipe_source_evidence WHERE recipe_id = NEW.cloned_from_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recipes_clone_inherits_source_evidence
    AFTER INSERT ON recipes
    FOR EACH ROW WHEN (NEW.cloned_from_id IS NOT NULL)
    EXECUTE FUNCTION recipes_clone_inherits_source_evidence();

CREATE FUNCTION recipes_stated_source_has_evidence() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER recipes_stated_source_has_evidence
    AFTER INSERT OR UPDATE OF source_kind, source_url ON recipes
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.source_kind IS NOT NULL)
    EXECUTE FUNCTION recipes_stated_source_has_evidence();
