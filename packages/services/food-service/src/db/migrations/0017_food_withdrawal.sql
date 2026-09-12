-- 0017 — what a withdrawal RECORDS, and the dedup index it must stop blocking (owner ruling 5).
--
-- Requires 0016's enum label to be committed; see that file for why the two cannot share a transaction.
--
-- ── withdrawn_at: a status cannot answer WHEN ─────────────────────────────────────────────────────
--   The ruling is that the retained row exists to "provide information about what was deleted". A bare
--   status carries the fact and not the date, and the date is also the only thing that makes the future
--   sweep (explicitly out of scope) implementable without guessing.
--
--   ⛔ NOT `tombstoned_at`, which is already load-bearing: it anchors `createByName`'s NOT_FOUND TTL
--   reactivation (`food.dao.ts`). Reusing it would make a withdrawal look like an expired lookup.
--
-- ── The dedup index MUST stop seeing withdrawn rows ───────────────────────────────────────────────
--   `food_normalized_name_per_author_unique` is (normalized_name, user_id) WHERE user_id IS NOT NULL —
--   STATUS-BLIND. Retaining the row therefore BLOCKS the author from re-adding a food under the same
--   name, which is a user-visible regression the soft delete would otherwise create: "delete it and add
--   it again" would answer 409 DUPLICATE_AUTHORED_NAME forever.
--
--   EXPAND-FIRST, as 0013 did: create the narrower index under a temporary name, drop the old one, then
--   rename. The new predicate is strictly narrower than the old one, so the CREATE cannot fail anywhere
--   the old index held.

ALTER TABLE "food" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "food_normalized_name_per_author_live_unique"
    ON "food" ("normalized_name", "user_id")
    WHERE "user_id" IS NOT NULL AND "status" <> 'WITHDRAWN';

DROP INDEX IF EXISTS "food_normalized_name_per_author_unique";

ALTER INDEX "food_normalized_name_per_author_live_unique"
    RENAME TO "food_normalized_name_per_author_unique";
