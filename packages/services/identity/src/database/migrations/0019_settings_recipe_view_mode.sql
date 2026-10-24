-- 0019 — the recipe library's grid/list choice becomes an account setting (ADR-0059, owner ruling 2026-10-17).
--
-- It was a cookie on web and a device-store value on native. Both are gone: the choice now follows the cook to
-- another browser or phone, like every other setting (owner ruling D19).
--
-- ⛔ NULLABLE, NO `DEFAULT`. NULL means "never chosen", and the service answers it as `auto` — the client picks by the
-- width it has (a list on a phone, a grid on a wide screen). No stored value could say that, and a default here would
-- both be a second copy of the default and record a choice the cook never made.
--
-- ⛔ A CHECK, NOT AN ENUM TYPE. The column admits `grid` and `list` and nothing else, so a client bug cannot store a
-- word the read then has to explain. A new layout later is a new CHECK (drop and add, in a later release); an enum
-- type could only ever grow, and its removal is a table rewrite. `auto` is deliberately NOT admitted: it is the
-- absence of a choice, which NULL already says.
--
-- ⚠️ NO GRANT. The column inherits the table's privileges (ADR-0039's default-privilege hook).
--
-- ⚠️ ERASURE. Nothing to add: `eraseIdentityRow` deletes the whole `settings` row and a closure keeps it, so the
-- choice follows the table.
--
-- Expand-only (ADR-0035): one nullable column and a constraint no existing row can violate (every row holds NULL).
-- Old code ignores the column; the new code reads it only after this has been applied.

ALTER TABLE settings ADD COLUMN recipe_view_mode text;

ALTER TABLE settings
    ADD CONSTRAINT settings_recipe_view_mode_known CHECK (recipe_view_mode IN ('grid', 'list'));

COMMENT ON COLUMN settings.recipe_view_mode IS
    'NULL means never chosen; the service answers it as auto (the client picks by width). grid or list otherwise.';
