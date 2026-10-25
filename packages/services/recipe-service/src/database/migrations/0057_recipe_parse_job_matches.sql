-- 0057 — what each pasted line's foods were MATCHED to, as proposals the cook confirms (ADR-0071).
--
-- WHY. A production paste matched "milk" to milk crackers: the by-name path bound the catalog's top hit. Paste matches
-- are now PROPOSALS. When a job's lines are parsed, recipe-service runs the proposal chain (curated, memo, lexical)
-- AS THE COOK, stores one row per (line, food) here, and asks the verification gate about the proposed food. The job
-- view derives each food's match state at READ time from this row and the gate's verdict.
--
-- ⛔ A ROW BINDS NOTHING (R19, amended by ADR-0071). The reviewed draft still binds through POST /recipes and by-food
-- admission. Nothing here is a binding, and nothing reads it as one.
--
-- ⛔ NO FOOD NAMES (ADR-0045). Names are resolved at read time through food's refs, as the caller, so a food renamed
-- or made private after the match is shown as food says now. Only opaque ids are stored.
--
-- ⛔ KEYED TO THE LINE, not only the job. The FK is to recipe_parse_job_lines (job_id, line_index), so a match for a
-- line the job does not have is refused, and deleting a job removes its matches through its lines. That cascade is
-- also how account erasure reaches this table: the sweep deletes a cook's jobs, and nothing here names a person.
--
-- ⚠️ line_digest is the line's digest WHEN MATCHED. A row whose digest no longer equals the line's is stale (the cook
-- edited the line) and is ignored and recomputed; the DAL replaces it in place.
--
-- The CHECKs make bad rows unrepresentable: at most one food (0052's arc), a food only with the tier that proposed
-- it, a verification key only with a food, an enqueue only with a key, and at most five candidates.
--
-- Additive and expand-only (ADR-0035): one new table, read and written only by this release's code.

CREATE TABLE recipe_parse_job_matches (
    job_id uuid NOT NULL,
    line_index integer NOT NULL,
    -- Which food of the parsed line: one line can name several ("salt and pepper").
    food_index integer NOT NULL CHECK (food_index >= 0),
    line_digest text NOT NULL,
    -- The tier that proposed the food. NULL means the chain found nothing (no match).
    matched_by text CHECK (matched_by IN ('curated', 'memo', 'lexical')),
    -- The proposed food: a root or a variant, never both. Both NULL means no match.
    food_id text,
    food_variant_id text,
    -- The rung food ranked the proposal on (ADR-0070), as food published it. Free text: food owns the vocabulary.
    rung text,
    margin double precision,
    -- The shortlist the cook may choose from, in food's ranked order: [{ "kind", "id", "rung" }], ids only.
    candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The key the gate's verdict for the proposal is stored under in recipe_ingredient_verifications.
    verification_key text,
    -- When the verification request was claimed and sent. NULL means owed.
    enqueued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, line_index, food_index),
    FOREIGN KEY (job_id, line_index) REFERENCES recipe_parse_job_lines (job_id, line_index) ON DELETE CASCADE,
    CONSTRAINT recipe_parse_job_matches_one_food CHECK (num_nonnulls(food_id, food_variant_id) <= 1),
    CONSTRAINT recipe_parse_job_matches_food_has_tier
        CHECK ((matched_by IS NULL) = (num_nonnulls(food_id, food_variant_id) = 0)),
    CONSTRAINT recipe_parse_job_matches_key_has_food
        CHECK (verification_key IS NULL OR num_nonnulls(food_id, food_variant_id) = 1),
    CONSTRAINT recipe_parse_job_matches_enqueue_has_key CHECK (enqueued_at IS NULL OR verification_key IS NOT NULL),
    CONSTRAINT recipe_parse_job_matches_candidates_bounded
        CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) <= 5)
);

COMMENT ON TABLE recipe_parse_job_matches IS
    'ADR-0071: one proposal per parsed (line, food) of a paste job. Binds nothing; stores no food names.';
COMMENT ON COLUMN recipe_parse_job_matches.line_digest IS
    'The line digest when matched. A row whose digest differs from the line''s is stale and is recomputed.';
COMMENT ON COLUMN recipe_parse_job_matches.enqueued_at IS
    'When the verification request was claimed. Only one caller wins the claim; a failed send releases it.';
