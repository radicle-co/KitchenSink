-- 0063 — a line's NOTE, and the rule that a line's shown text is never blank (owner ruling 2026-11-08, ADR-0045).
--
-- `note` is a dimension the cook wrote in parentheses after the amount ("1 (9 inch) double-crust pie pastry" -> "9 inch").
-- It is shown beside the food with the preparation and is never the unit, never a food name and never a matching input.
-- NULL means no note, and it is the ONE spelling of none: a blank note would be a second one.
--
-- `display_text` already exists (0051). It is the food text a line SHOWS ("lean ground beef"); NULL shows the bound
-- food's name. This migration only gives it the same blank-text rule as `preparation` and `group_label`, which the
-- wire already enforces, so a row that cannot be read back cannot be written.
--
-- Additive and expand-only (ADR-0035): one nullable column with no default, so no rewrite and no backfill. Code from the
-- previous release neither reads nor writes it. The two CHECKs hold for every row the previous release could write,
-- because its wire already refused a blank `notes`.

-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it, instead of stalling every query
--   queued behind it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE ingredients
    ADD COLUMN note text,
    ADD CONSTRAINT ingredients_note_present CHECK (note IS NULL OR btrim(note) <> ''),
    ADD CONSTRAINT ingredients_display_text_present CHECK (display_text IS NULL OR btrim(display_text) <> '');

COMMENT ON COLUMN ingredients.note IS
    'A dimension the cook wrote in parentheses after the amount (9 inch), shown beside the food. NULL: none. Never a food name, never a matching input.';
COMMENT ON COLUMN ingredients.display_text IS
    'The food text this line SHOWS (the cook''s words, chosen once when the line was written). NULL shows the bound food''s name. Never a food name, never shared, never a matching input.';
