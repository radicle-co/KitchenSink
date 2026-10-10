-- The resolution memory names a ROOT or a VARIANT (curated catalog plan U9; R20, R23; ADR-0045).
--
-- A recipe line binds a root or one of its variants since 0051. The three tables that REMEMBER what a phrase
-- resolved to — the cooks' corrections (`ingredient_resolution_mappings`), the gate-agreed memos
-- (`ingredient_resolution_memos`) and the gate's verdicts (`recipe_ingredient_verifications`) — named a root only,
-- so a cook who corrected "tomato paste" to a variant, or a memo the gate agreed for a variant-bound line, had
-- nowhere to say so. Each table now carries the same two-column arc `food_lookups` does.
--
-- ⛔ AN EXCLUSIVE ARC, NOT A KIND COLUMN. Exactly one of `food_id` and `food_variant_id` is set, counted by
-- `num_nonnulls`, for 0051's reasons: a discriminator would be a second statement of the same fact, and a second
-- statement can be wrong. Both columns stay OPAQUE food-service ids: no foreign key (ADR-0006 gives food its own
-- database), and either may dangle after a reseed, which every reader already treats as a miss.
--
-- ⛔ ONE PARSE. `src/database/schema/foodRefArc.ts` is the one reader and writer of the arc; an inline
-- `food_id ?? food_variant_id` anywhere else is the drift the arc exists to prevent.
--
-- ⚠️ EXPAND-ONLY, and NO BACKFILL. `food_id` loses its `NOT NULL`; nothing is renamed or dropped. Nothing is live and
-- no database holds rows that matter (owner, 2026-09-26), and every existing row names a root, which the new CHECK
-- admits as it stands.
--
-- An index per arm only where a reader exists: the mappings' live lookup reads by `(normalized_key, food)`, so the
-- variant arm gets its own partial index beside 0021's root one. The memos are keyed by `normalized_key` alone, and no
-- reader queries the verdicts by food (`idx_line_verifications_contradicted` has no code reader), so neither gains one.

-- ── ingredient_resolution_mappings ─────────────────────────────────────────────────────────────────────────

ALTER TABLE ingredient_resolution_mappings
    ALTER COLUMN food_id DROP NOT NULL;

ALTER TABLE ingredient_resolution_mappings
    ADD COLUMN IF NOT EXISTS food_variant_id text;

ALTER TABLE ingredient_resolution_mappings
    ADD CONSTRAINT ingredient_resolution_mappings_one_food
        CHECK (num_nonnulls(food_id, food_variant_id) = 1);

CREATE INDEX IF NOT EXISTS idx_resolution_mappings_live_variant_lookup
    ON ingredient_resolution_mappings (normalized_key, food_variant_id)
    WHERE superseded_at IS NULL AND food_variant_id IS NOT NULL;

-- ── ingredient_resolution_memos ────────────────────────────────────────────────────────────────────────────

ALTER TABLE ingredient_resolution_memos
    ALTER COLUMN food_id DROP NOT NULL;

ALTER TABLE ingredient_resolution_memos
    ADD COLUMN IF NOT EXISTS food_variant_id text;

ALTER TABLE ingredient_resolution_memos
    ADD CONSTRAINT ingredient_resolution_memos_one_food
        CHECK (num_nonnulls(food_id, food_variant_id) = 1);

-- ── recipe_ingredient_verifications ────────────────────────────────────────────────────────────────────────

ALTER TABLE recipe_ingredient_verifications
    ALTER COLUMN food_id DROP NOT NULL;

ALTER TABLE recipe_ingredient_verifications
    ADD COLUMN IF NOT EXISTS food_variant_id text;

ALTER TABLE recipe_ingredient_verifications
    ADD CONSTRAINT recipe_ingredient_verifications_one_food
        CHECK (num_nonnulls(food_id, food_variant_id) = 1);
