-- 0073 — validate the CHECK that 0072 added as NOT VALID (ADR-0090).
--
-- The runner applies each migration file in ONE transaction. 0072's `ADD COLUMN` takes ACCESS EXCLUSIVE on
-- `ingredients` and holds it until 0072 commits, so a validating CHECK there would scan the whole table under that
-- lock. 0072 therefore adds the constraint NOT VALID, which enforces it on every new write at once. This file scans the
-- existing rows in its own transaction, where `VALIDATE CONSTRAINT` takes only SHARE UPDATE EXCLUSIVE: reads and
-- writes to `ingredients` carry on while it runs.
--
-- ⚠️ `lock_timeout`: SHARE UPDATE EXCLUSIVE still waits behind a running `ALTER TABLE` or VACUUM. A deploy that cannot
--   take it in 5 s fails and a re-run retries it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE ingredients VALIDATE CONSTRAINT ingredients_transcribed_by_owner_has_source_line;
