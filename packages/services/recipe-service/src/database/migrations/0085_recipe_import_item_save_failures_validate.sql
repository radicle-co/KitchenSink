-- 0085 — validate the CHECK that 0084 added as NOT VALID (re-review of #220).
--
-- The runner applies each migration file in ONE transaction. 0084's `ADD COLUMN` takes ACCESS EXCLUSIVE on
-- `recipe_import_items` and holds it until 0084 commits, so a validating CHECK there would scan the table under that lock.
-- 0084 therefore adds the constraint NOT VALID, which binds every new write at once. This file scans the existing rows in
-- its own transaction, where `VALIDATE CONSTRAINT` takes only SHARE UPDATE EXCLUSIVE: reads and writes carry on while it runs.
--
-- ⚠️ `lock_timeout`: SHARE UPDATE EXCLUSIVE still waits behind a running `ALTER TABLE` or VACUUM. A deploy that cannot
--   take it in 5 s fails and a re-run retries it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items VALIDATE CONSTRAINT recipe_import_items_save_failures_check;
