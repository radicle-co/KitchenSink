-- 0056_author_handle_tombstone.sql — erasure TOMBSTONES an author_handles row instead of deleting it.
--
-- WHY. Erasure used to DELETE the author_handles row (step 11 of eraseRecipeRows). The handle-sync consumer's
-- stale-snapshot guard is the upsert's `WHERE author_handles.source_timestamp < EXCLUDED.source_timestamp`, and a
-- guard that compares against a row cannot refuse when the row is gone: a late, redelivered or DLQ'd snapshot took
-- the INSERT branch and wrote the real name back over the pseudonym that steps 9-10 had put on the KEPT recipes.
-- That re-identified an erased author.
--
-- THE FIX. The row stays, as a tombstone: `erased_at` is set, `display_name` is the same pseudonym the kept recipes
-- carry, and `username` is NULL. The consumer's upsert gains `AND author_handles.erased_at IS NULL`, so the refusal is
-- in the single writer's SQL predicate (a check in TypeScript would be check-then-write, and race).
--
-- ⛔ THE CHECK makes the bad state unrepresentable: a tombstone that still carries a username cannot be stored, by
-- any writer. `user_<ULID>` is a legal Clerk username, so the pseudonym is never put in `username` either.
-- ⚠️ NO DEFAULT, NULLABLE: NULL means "never erased". Nothing is backfilled (nothing is live).
--
-- Additive and expand-only (ADR-0035): one nullable column and one constraint over rows that all satisfy it.

ALTER TABLE author_handles ADD COLUMN erased_at timestamptz;

ALTER TABLE author_handles
    ADD CONSTRAINT author_handles_tombstone_has_no_username CHECK (erased_at IS NULL OR username IS NULL);
