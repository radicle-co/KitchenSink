-- 0062 — one S3 object is one recipe_photos row.
--
-- A retried confirm inserted a second row for the same object. Deleting either row then deleted the shared S3 object
-- and left the other row pointing at nothing. PhotosDal.create now returns the row a key already has; this index makes
-- the database refuse a second one whatever a caller does.
--
-- ⚠️ EXPAND-FIRST (ADR-0035): an older service never inserts a duplicate key from a single confirm, and a retry on the
--   older code would now fail loudly instead of storing a second row.
-- ⚠️ `lock_timeout`: CREATE UNIQUE INDEX takes a SHARE lock that blocks writes to recipe_photos while it builds. A deploy
--   that cannot take it in 5 s fails and a re-run retries it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_photos_s3_key ON recipe_photos (s3_key);
