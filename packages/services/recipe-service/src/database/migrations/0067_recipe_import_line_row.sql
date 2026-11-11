-- 0067 — the bulk import's snapshot line keeps the ROW the editor saves, not only its measure (ADR-0072 §4).
--
-- ⛔ THE SAVED LINE MUST READ AS THE COOK WROTE IT. recipe-core's `pastedLineRowOf` builds a pasted row: a leading size word is
-- the unit ("3 large eggs" is 3 `large` `eggs`), a dimension in parentheses is a NOTE and never the unit ("1 (9 inch) pie
-- pastry"), and the cook's own words are the shown name when the parse chose them (owner ruling 2026-11-08). The import saves
-- a line long after its one-day parse job is gone, so the snapshot keeps what that rule produced:
--
--  - `name`: the food's name with the size word moved out. A line kept as written is saved under it, so it never reads
--    "3 large large eggs". `phrase` stays whole beside it, because it is what the match was asked.
--  - `display_text`: the cook's words, when the parse chose them; NULL when the food's own name is shown.
--  - `note`: the dimension the cook wrote in parentheses; NULL when there is none.
--
-- The quantity and unit columns already hold that row's measure, which is the measure the proposal's verdict key covers, so
-- the saved line keys exactly as the proposal did and the gate is not paid twice.
--
-- Additive and expand-only (ADR-0035): three nullable text columns, each refusing a blank as `ingredients.display_text` and
-- `ingredients.note` do. A line snapshotted before this migration has a NULL `name` and is saved under its phrase. No GRANT:
-- the service role's DML on this table comes from 0059 (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_lines
    ADD COLUMN name text CONSTRAINT recipe_import_lines_name_check CHECK (name IS NULL OR btrim(name) <> ''),
    ADD COLUMN display_text text
        CONSTRAINT recipe_import_lines_display_text_check CHECK (display_text IS NULL OR btrim(display_text) <> ''),
    ADD COLUMN note text CONSTRAINT recipe_import_lines_note_check CHECK (note IS NULL OR btrim(note) <> '');
