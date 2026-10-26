-- 0059 — bulk recipe import: the header, its items, and the snapshot of each item's match lines (ADR-0072).
--
-- WHAT THIS IS. A cook brings hundreds of recipes at once. The CLIENT drives the import in bounded `advance` steps, as
-- the cook, because food search runs as the caller or not at all (ADR-0071 §1); nothing here matches or binds in the
-- background. These tables are the server's memory of where an import stands, so any device the cook signs in on can
-- resume it. Routes: `/api/v1/import` (the tables are named after it: recipe_imports, recipe_import_items,
-- recipe_import_lines).
--
--   recipe_imports       the header: whose, which of the three match modes, the visibility asked for, the wizard cursor
--   recipe_import_items  one row per recipe the client sent: the recipe as sent, its stage, the cook's review mark,
--                        the parse job, the allowance it paid, the recipe it saved, and the per-recipe statement
--   recipe_import_lines  the SNAPSHOT of each parsed food's match, plus the cook's pick and the origin the save wrote
--
-- ⛔ A PARSE JOB LIVES ONE DAY (PARSE_JOB_TTL_HOURS) and its match rows are deleted with it, but a review wizard over five
-- hundred recipes outlives that. So the first read of a line's match is COPIED into recipe_import_lines, and the import
-- reads the copy. The lines therefore carry NO foreign key to recipe_parse_job_lines or recipe_parse_job_matches: a key
-- there would cascade the snapshot away with the job, which is the thing it exists to prevent. The item's own key to its
-- job is ON DELETE SET NULL for the same reason.
--
-- ⛔ NO FOOD NAMES (ADR-0045). Only opaque ids and the cook's own source words (the parsed phrase) are stored. Names come
-- from food at read time, as the caller.
--
-- ⛔ NO VERDICT. The review gate writes its verdict under a verification key, from the worker, after the snapshot. The
-- verdict is read by `verification_key` on every view, so a verdict that lands late still reaches the line. A copy here
-- would go stale the moment it was taken.
--
-- ⛔ NO `flagged` COLUMN AND NO `version` COLUMN. "Flagged" is derived from the verdict at read time (`importFlagOf`), and
-- the view's `version` is a digest of what the view was built from. Both would be wrong the moment a verdict landed.
--
-- ONE PARSE JOB PER ITEM. The snapshot keys a line by the item's own (line_index, food_index), which are the job's indexes
-- only while a job holds exactly one item. So `parse_job_id` and `recipe_id` are UNIQUE (partial): a job belongs to one
-- item, and a recipe to one item, which is also the schema's only defence against a second create of the same recipe.
-- The service snapshots an item's lines whole, in one transaction, at the `parsing -> matched` step, and claims the item
-- (UPDATE ... WHERE saved_at IS NULL) in the same transaction that writes the recipe.
--
-- ⛔ "SAVED" AND "PAID" ARE THEIR OWN COLUMNS (`saved_at`, `allowance_spent_at`), never inferred from `recipe_id` or from
-- `parse_job_id`. A cook who deletes the draft the import made, or a job the TTL purged, must not make the item look
-- unsaved or unpaid: the next `advance` would create the recipe again and spend the allowance again. `recipe_id` and
-- `parse_job_id` are ON DELETE SET NULL for that reason, and the row remembers what happened.
--
-- THE PER-RECIPE STATEMENT (ADR-0072 §9) is two columns and a kind: `statement_kind` is `authored` ("I wrote this", no
-- citation) or `source` ("From a source", a citation and a source kind of `public_web`, `book` or `paid_site`). The
-- recipe's `source_type` is DERIVED from it when the item is saved and is not stored here, so there is one statement of
-- the fact. An item cannot be saved without one (the CHECK below).
--
-- ERASURE. `recipe_imports.user_id` is the only user key; items and lines reach erasure by cascade, and the recipes the
-- import saved survive their import (their `import_line_id` is SET NULL, see 0060). The sweep and the test-principal purge
-- delete `recipe_imports` by `user_id`.
--
-- Additive and expand-only (ADR-0035): three new tables, read and written only by this release's code. No GRANT is written
-- here: the runner applies as the owner and `ALTER DEFAULT PRIVILEGES` gives the service role DML on every table the owner
-- creates (ADR-0039), as 0058 did. The grant is proven by the LOCAL e2e suite writing as the service role.

CREATE TABLE recipe_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The app-user ULID from the verified token, never a request body field.
    user_id varchar(255) NOT NULL,
    -- Save lines as written / Pick the best match for me / Let me review each (ADR-0072 §7). Chosen once, for the import.
    match_mode text NOT NULL CHECK (match_mode IN ('keepAsWritten', 'bindBest', 'review')),
    -- What the cook asked for the whole import. An item may override it. The visibility policy decides what each recipe's
    -- label allows; a refused choice is the service's to answer, never this table's to repair.
    visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
    -- The wizard's position: the ordinal of the item the cook is on. A position EQUAL TO THE ITEM COUNT means done (past
    -- the last item), which is the reducer's `done`; it is derived, not stored, so items appended by a later chunk reopen
    -- the wizard at the first new item. Ordinals are contiguous 0..n-1 (the create path's rule; SQL cannot say it). The
    -- cursor command compares it, so a stale device is told the cursor moved.
    cursor_ordinal integer NOT NULL DEFAULT 0 CHECK (cursor_ordinal >= 0),
    -- Set by "Save and leave". In `review` mode an item is ready when the cook has no open line on it or this is set.
    review_closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- The cook's imports, newest first; and the erasure sweep's key.
CREATE INDEX recipe_imports_user_created_idx ON recipe_imports (user_id, created_at);

CREATE TABLE recipe_import_items (
    import_id uuid NOT NULL REFERENCES recipe_imports (id) ON DELETE CASCADE,
    -- The recipe's position in the file the client read. The client's identity for the item, stable across devices.
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    -- The recipe as the client sent it (one structured recipe per item; the server never receives an archive). It is
    -- dropped once the recipe is saved, so a long import does not keep every recipe's text twice; hence NULL is allowed,
    -- but only for a saved item. Its SIZE is the contract's bound, not a CHECK: Postgres re-evaluates every CHECK on every
    -- UPDATE of the row, and a stage or review update would otherwise serialise the whole document each time.
    payload jsonb,
    -- Where the item stands. `ready` is NOT a stage: readiness is computed from the lines (`isReadyToSave`), not stored.
    stage text NOT NULL DEFAULT 'received' CHECK (stage IN ('received', 'parsing', 'matched', 'saved')),
    -- The cook's mark in the wizard (`ITEM_REVIEWS`).
    review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'reviewed', 'skipped')),
    -- The parse job holding this item's lines. SET NULL: the TTL purge deletes jobs daily, and the snapshot has what is needed.
    parse_job_id uuid REFERENCES recipe_parse_jobs (id) ON DELETE SET NULL,
    -- When the item spent its allowance unit (the first send of its lines for parsing). Once set it is never spent again.
    allowance_spent_at timestamptz,
    -- When matching finished and the lines were snapshotted: the age `isReadyToSave` waits on (`matchedForMs`).
    matched_at timestamptz,
    -- When the draft was saved. The item is saved exactly once.
    saved_at timestamptz,
    -- The draft it created. SET NULL: the cook may delete the draft, and the item stays saved.
    recipe_id uuid REFERENCES recipes (id) ON DELETE SET NULL,
    -- The per-recipe statement (ADR-0072 §9). NULL until the cook records it.
    statement_kind text CHECK (statement_kind IN ('authored', 'source')),
    citation text CHECK (btrim(citation) <> '' AND char_length(citation) <= 2000),
    source_kind text CHECK (source_kind IN ('public_web', 'book', 'paid_site')),
    -- This recipe's own choice, overriding the import's. NULL: use the import's.
    visibility text CHECK (visibility IN ('public', 'private')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (import_id, ordinal),
    CONSTRAINT recipe_import_items_payload_is_object
        CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object'),
    -- The recipe's text may be shed only once it is saved; before that it is all the server has.
    CONSTRAINT recipe_import_items_payload_until_saved CHECK (payload IS NOT NULL OR stage = 'saved'),
    -- `saved` is a stage AND a timestamp, and the two are one fact.
    CONSTRAINT recipe_import_items_saved_iff_stage CHECK ((saved_at IS NOT NULL) = (stage = 'saved')),
    CONSTRAINT recipe_import_items_recipe_needs_save CHECK (recipe_id IS NULL OR saved_at IS NOT NULL),
    -- Lines are snapshotted when matching finishes, and an item cannot be saved before that.
    CONSTRAINT recipe_import_items_matched_iff_stage CHECK ((matched_at IS NOT NULL) = (stage IN ('matched', 'saved'))),
    -- A job exists only for an item that has paid; the paid fact outlives the job.
    CONSTRAINT recipe_import_items_job_needs_payment CHECK (parse_job_id IS NULL OR allowance_spent_at IS NOT NULL),
    -- The statement is one of two forms. "I wrote this" carries no citation; "From a source" carries both.
    CONSTRAINT recipe_import_items_statement_authored
        CHECK (statement_kind IS DISTINCT FROM 'authored' OR (citation IS NULL AND source_kind IS NULL)),
    CONSTRAINT recipe_import_items_statement_source
        CHECK (statement_kind IS DISTINCT FROM 'source' OR (citation IS NOT NULL AND source_kind IS NOT NULL)),
    CONSTRAINT recipe_import_items_statement_recorded
        CHECK (statement_kind IS NOT NULL OR (citation IS NULL AND source_kind IS NULL)),
    -- A saved recipe always has its statement: the label is set from it, so a save without one has no label to set.
    CONSTRAINT recipe_import_items_saved_has_statement CHECK (saved_at IS NULL OR statement_kind IS NOT NULL)
);

-- One job per item, and one item per recipe (see the header). The unique indexes also serve the SET NULL lookups: the
-- TTL purge deletes a job, and a recipe delete finds the item that names it, without scanning the table.
CREATE UNIQUE INDEX recipe_import_items_parse_job_idx ON recipe_import_items (parse_job_id) WHERE parse_job_id IS NOT NULL;
CREATE UNIQUE INDEX recipe_import_items_recipe_idx ON recipe_import_items (recipe_id) WHERE recipe_id IS NOT NULL;

CREATE TABLE recipe_import_lines (
    -- A surrogate key, because `ingredients.import_line_id` (0060) points at one line and a four-column key is a poor thing to repeat.
    -- Who bound a line is NOT stored here: `ingredients.bound_by` is the one place (ADR-0072 §5), and a copy would go
    -- stale on the cook's first edit.
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL,
    -- The item this line belongs to.
    ordinal integer NOT NULL,
    -- Which line of the recipe, and which food of that line ("salt and pepper" names two).
    line_index integer NOT NULL CHECK (line_index >= 0),
    food_index integer NOT NULL CHECK (food_index >= 0),
    -- ── the snapshot of recipe_parse_job_matches (0057), keyed by the item's own line and food index (one job per item) ──────────────────────────────────────────────────────────────
    line_digest text NOT NULL,
    -- What the match was computed from: the line digest, the food's phrase and the measure.
    judgement_digest text NOT NULL,
    -- The ingredient phrase the parse lifted out of the line, in the source's own words (ADR-0027: not personal data).
    phrase text NOT NULL,
    -- The measure, as typed columns that mirror `ingredients` (0051) because the save copies them across and a snapshot
    -- is provenance that lives as long as the recipe does. NULL is the one spelling of "the source stated no amount".
    quantity numeric(10, 3),
    quantity_high numeric(10, 3),
    unit text NOT NULL,
    -- What the source printed before the importer restated a historical measure (0027).
    stated_quantity numeric(10, 3),
    stated_quantity_high numeric(10, 3),
    stated_unit text,
    -- How this recipe prepares the food (`finely chopped`); NULL when the line says nothing.
    preparation text CHECK (preparation IS NULL OR btrim(preparation) <> ''),
    -- The tier that proposed the food. NULL means the chain found nothing.
    matched_by text CHECK (matched_by IN ('curated', 'memo', 'lexical')),
    food_id text,
    food_variant_id text,
    rung text,
    margin double precision,
    -- The shortlist, best first: [{ "kind", "id", "rung", "isDefault" }], ids only.
    candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The key the review gate's verdict is read under. The verdict itself is never stored here. (Where the budget-spent
    -- outcome of ADR-0072 §10 is recorded is the service lane's decision; it is not a value of `review` below.)
    verification_key text,
    -- Where the gate's review stands: 'owed' (under verification_key) or 'refused'. NULL: nothing was proposed.
    review text CHECK (review IN ('owed', 'refused')),
    -- ── the cook's pick ─────────────────────────────────────────────────────────────────────────────────────────────────
    picked_food_id text,
    picked_food_variant_id text,
    -- "Keep this line as written" is a pick too, and it is the cook's decision, which always wins.
    picked_as_written boolean NOT NULL DEFAULT false,
    -- The `judgement_digest` the cook saw when they picked, so a pick made against a judgement that has since been
    -- recomputed no longer applies. NOT NULL exactly when a pick exists.
    picked_against_digest text,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (import_id, ordinal) REFERENCES recipe_import_items (import_id, ordinal) ON DELETE CASCADE,
    CONSTRAINT recipe_import_lines_position_key UNIQUE (import_id, ordinal, line_index, food_index),
    -- The same arc as 0057: at most one of a food or a variant, a tier exactly when a food is proposed, a verification key
    -- only for a proposed food and exactly when a review is owed, and a review exactly when a food is proposed.
    CONSTRAINT recipe_import_lines_one_food CHECK (num_nonnulls(food_id, food_variant_id) <= 1),
    CONSTRAINT recipe_import_lines_food_has_tier
        CHECK ((matched_by IS NULL) = (num_nonnulls(food_id, food_variant_id) = 0)),
    CONSTRAINT recipe_import_lines_key_has_food
        CHECK (verification_key IS NULL OR num_nonnulls(food_id, food_variant_id) = 1),
    CONSTRAINT recipe_import_lines_key_iff_owed
        CHECK ((review IS NOT DISTINCT FROM 'owed') = (verification_key IS NOT NULL)),
    CONSTRAINT recipe_import_lines_review_iff_food
        CHECK ((review IS NULL) = (num_nonnulls(food_id, food_variant_id) = 0)),
    CONSTRAINT recipe_import_lines_candidates_bounded
        CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) <= 5),
    -- A pick is at most one of a food, a variant, or "as written"; it is recorded against a digest exactly when it exists.
    CONSTRAINT recipe_import_lines_one_pick
        CHECK (num_nonnulls(picked_food_id, picked_food_variant_id) + (picked_as_written)::int <= 1),
    CONSTRAINT recipe_import_lines_pick_has_digest
        CHECK (
            (num_nonnulls(picked_food_id, picked_food_variant_id) > 0 OR picked_as_written)
            = (picked_against_digest IS NOT NULL)
        ),
    -- The measure's own illegal states, as `ingredients` states them (0051): a zero amount, an upper bound with no lower or
    -- at or below it, and half a restatement.
    CONSTRAINT recipe_import_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT recipe_import_lines_quantity_coherent
        CHECK (quantity_high IS NULL OR (quantity IS NOT NULL AND quantity_high > quantity)),
    CONSTRAINT recipe_import_lines_stated_measure_coherent
        CHECK (
            (stated_quantity IS NULL AND stated_quantity_high IS NULL AND stated_unit IS NULL)
            OR (
                stated_quantity IS NOT NULL
                AND stated_quantity > 0
                AND stated_unit IS NOT NULL
                AND stated_unit <> ''
                AND quantity IS NOT NULL
                AND (stated_quantity_high IS NULL OR stated_quantity_high > stated_quantity)
            )
        )
);

COMMENT ON TABLE recipe_imports IS 'ADR-0072: one bulk import, driven by the client in bounded steps. Erased with its user.';
COMMENT ON TABLE recipe_import_items IS
    'ADR-0072: one recipe of an import. saved_at and allowance_spent_at are facts of their own, not inferred from recipe_id or parse_job_id.';
COMMENT ON TABLE recipe_import_lines IS
    'ADR-0072 §4: a snapshot of recipe_parse_job_matches, so a parse job that expires does not erase an open wizard. No food names; no verdict.';
COMMENT ON COLUMN recipe_imports.cursor_ordinal IS 'The wizard position. NULL means done, the same sum type as the cursor reducer.';
COMMENT ON COLUMN recipe_import_items.payload IS 'The recipe as the client sent it. Dropped once saved.';
COMMENT ON COLUMN recipe_import_lines.picked_against_digest IS
    'The judgement_digest the cook saw when they picked. NOT NULL exactly when a pick exists.';
