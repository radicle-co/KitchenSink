-- 0041_ingredient_source_phrase.sql (owner ruling 2026-08-31, U15 report "Owner rulings" §3) — the
-- ingredient PHRASE the parse lifted out of `source_line`, and the memo-table reset the re-grain requires.
--
-- ⛔ THE MEMO TIER COULD NEVER FIRE, AND THIS COLUMN IS THE REPAIR. `ingredient_resolution_memos` is read
-- by the cascade with `normalizedIngredientKey(name)` — the phrase a picker or importer queries with
-- (`cold water`) — while the verification worker keyed every memo it wrote on the WHOLE source line
-- (`one quart of cold water`). Reads and writes were on different grains, structurally: U15's measurement
-- run banked 289 verified memos and not one of them could ever serve any query. The phrase exists only
-- where the line was PARSED (the cookbook importer, the parse pipeline), so it is captured at create time
-- into this column, carried to the worker on the verification message, and the memo is keyed on it.
--
-- ⚠️ NOT DERIVABLE FROM `source_line` AFTER THE FACT. Re-parsing at memo-write time would haul the
-- two-engine parse machinery into the worker and could disagree with the parse that produced the line —
-- the memo would then be keyed on a phrase the stored quantity/unit were never lifted from. The phrase is
-- a create-time fact, like `source_line` itself, and `NULL` means "no parse produced one": the worker
-- writes NO memo for such a line, never one at the dead line grain.
--
-- THE MEMO RESET WAS THE OTHER HALF OF THE RULING, and it is HISTORY now — see the scrub note below.
-- Every memo row predating this migration is keyed at the line grain and unreachable by construction; the
-- ruling was re-grain + delete (rebuilding costs ~$0.02 of verification) rather than re-key-in-place (a
-- reparse-driven migration script for rows only a local measurement database holds — no deployed
-- environment has ever written a memo).
--
-- ⛔ SCRUBBED 2026-09-02 (owner ruling — "I don't want hidden bombs in the app"). This file used to end with
-- an UNQUALIFIED `DELETE FROM ingredient_resolution_memos;`. It was safe only by ACCIDENT: the runner skips
-- a file whose name is in `schema_migrations`, and on a re-run with that row cleared the `ADD COLUMN` above
-- would error first and roll the DELETE back with it. That made an otherwise-reasonable edit — adding
-- `IF NOT EXISTS` to the ADD COLUMN — silently turn a re-run into a whole-table wipe, with the guard being
-- a line the editor was not looking at.
--
-- ⚠️ Removing it is behaviour-preserving on EVERY reachable path, verified rather than assumed:
--   * `schema_migrations` is `name TEXT PRIMARY KEY` with NO checksum (see `src/lambdas/migrate/handler.ts`)
--     and the skip is a pure name match, so editing this body cannot reach a database that already ran it;
--   * on a FRESH database the table is empty when this file runs — no migration inserts a memo (only the
--     deployed application writes one, and 0021 creates the table 20 migrations earlier). MEASURED: 0 rows
--     immediately before this file, over the full ordered set.
-- The reset therefore ran exactly once, everywhere it was ever going to, before this edit.
-- `migrationDestructiveDml.test.ts` now fails any migration carrying an unqualified DELETE/UPDATE.
--
-- PERSONAL DATA: same posture as `source_line` one column over — text a user's source stated, on
-- `recipe_ingredients`, reached by the account-erasure worker via the recipe cascade. ADR-0027 rules the
-- phrase itself is not personal data; the column still rides the cascade.

ALTER TABLE recipe_ingredients
    ADD COLUMN source_phrase text;

COMMENT ON COLUMN recipe_ingredients.source_phrase IS
    'The ingredient phrase the parse lifted out of source_line — the memo tier''s key grain (0041). NULL: authored line, or created before 0041.';
