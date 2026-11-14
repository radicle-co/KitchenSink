-- 0084 — a bulk-import item counts the saves that failed for a cause no rule recognises (re-review of #220).
--
-- The save holds an item for every refusal it can name. A failure it cannot name (a database error, a declared name that no
-- longer matches) used to send the item to the back of the queue and retry it on every `advance`, for ever, with no issue
-- the cook could see. Now each such failure is counted, and after `IMPORT_SAVE_FAILURE_CAP` in a row the item is held as a
-- create refusal (`saveRefused`).
--
--  - `save_failures`: the count at the item's current `decision_rev`. Every write that moves `decision_rev` sets it back to 0,
--    so a decision of the cook starts the count again. NOT NULL with a constant DEFAULT: PostgreSQL stores the default once,
--    so adding the column rewrites no row.
--
-- Additive and expand-only (ADR-0035): the running release does not know the column and never writes it, and the default
-- covers its inserts. The CHECK is added NOT VALID: it binds every write at once, and 0085 scans the existing rows under a
-- lighter lock. No GRANT: the service role's DML on this table comes from 0059 (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN save_failures integer NOT NULL DEFAULT 0;

ALTER TABLE recipe_import_items
    ADD CONSTRAINT recipe_import_items_save_failures_check CHECK (save_failures >= 0) NOT VALID;
