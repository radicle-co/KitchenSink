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
-- ⛔ THE DELETE IS THE OTHER HALF OF THE RULING, not housekeeping. Every existing memo row is keyed at the
-- line grain and is unreachable by construction; the ruling was re-grain + delete (rebuilding costs ~$0.02
-- of verification) rather than re-key-in-place (a reparse-driven migration script for rows only a local
-- measurement database holds — no deployed environment has ever written a memo).
--
-- PERSONAL DATA: same posture as `source_line` one column over — text a user's source stated, on
-- `recipe_ingredients`, reached by the account-erasure worker via the recipe cascade. ADR-0027 rules the
-- phrase itself is not personal data; the column still rides the cascade.

ALTER TABLE recipe_ingredients
    ADD COLUMN source_phrase text;

COMMENT ON COLUMN recipe_ingredients.source_phrase IS
    'The ingredient phrase the parse lifted out of source_line — the memo tier''s key grain (0041). NULL: authored line, or created before 0041.';

DELETE FROM ingredient_resolution_memos;
