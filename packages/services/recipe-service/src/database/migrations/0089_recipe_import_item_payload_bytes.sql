-- 0089 — a bulk-import item stores the byte size of its payload, so the unpaid-byte cap sums a number (GATE finding SCQ-1).
--
-- The cap (`RecipeImportItemsDal`, ADR-0072 §8) measures the cook's whole unpaid backlog twice on every chunk that adds
-- bytes. It used to do that with `sum(octet_length(payload::text))`, which serialises every unpaid payload of the cook on each
-- measure. The size is now a fact of the row, kept by the database:
--
--  - `payload_bytes`: `octet_length(payload::text)`, a STORED generated column, so it cannot drift from the payload and no
--    writer sets it. It is NULL when the payload is NULL (a saved item sheds its payload; CHECK `payload_until_saved`).
--
-- Additive and expand-only (ADR-0035): the running release does not know the column, never writes it, and no INSERT of it
-- can name it. No GRANT: the service role's DML on this table comes from 0059 (ADR-0039).
--
-- ⚠️ Adding a STORED generated column REWRITES the table under ACCESS EXCLUSIVE, which holds until this file commits. The
--   rewrite is one pass over `recipe_import_items`, a table that holds only unpaid and not-yet-purged bulk-import items.
--   `lock_timeout` bounds the wait for the lock, not the rewrite.

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN payload_bytes integer GENERATED ALWAYS AS (octet_length(payload::text)) STORED;
