-- 0026_memo_owner_erasure.sql (plan U10; owner ruling 2026-08-23) — make a memo's phrase erasable.
--
-- ⛔⛔ THIS MIGRATION'S RULING WAS REVERSED ON 2026-08-25. Read
-- `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md` BEFORE reasoning from
-- anything below. The owner ruled that an ingredient phrase is NOT private data, so migration 0033 DROPPED
-- the `owner_id` column this file adds, along with its partial index and the erasure sweep it existed for.
-- What survives of this file is the `source_phrase` `NOT NULL` relaxation — kept for a different reason
-- (0031's backfills already nulled the column, so it can no longer be restored). Everything below is the
-- record of a decision that no longer holds.
--
-- ## The gap this closes
--
-- `ingredient_resolution_memos.source_phrase` is text a user typed, remembered because the verification gate
-- agreed with the resolution it produced. 0021 shipped that column with NO author column beside it, and its
-- header recorded the consequence honestly: `recipe-workers`' account-erasure sweep had no per-user predicate
-- to key on, so the phrase was unreachable by erasure. That was tolerable only while U10 shipped no route;
-- U14 published the correction surface, and the memo write path now runs on the ordinary resolution path.
--
-- ## ⚠️ The alternative that was NOT taken, recorded so it is not re-proposed as an improvement
--
-- `source_phrase` is WRITE-ONLY today: `verdictStore.rememberAgreement` inserts it and nothing selects it —
-- the memo tier's reads (`resolutionMappings.dal.ts`) take `food_id`, `verified_by` and the trigram distance
-- over `normalized_key`. Dropping the column would therefore have removed the question rather than answering
-- it, at the cost of the two-way door 0021 keeps for the mappings tier (with the phrase stored, a change to
-- `normalizedIngredientKey` is repaired by a backfill rather than by data loss).
--
-- ⛔ The owner ruled to KEEP the phrase and make it erasable. Note what that costs, since it is the whole
-- point of this migration: the memo table now holds a person-to-row link it did not hold before. That link
-- is what makes erasure possible, and it is what erasure must never miss.
--
-- ## Why `owner_id` is the LAST writer's, and why that is correct
--
-- The table's primary key is `normalized_key` — one memo per phrase, upserted. Two users whose lines
-- normalize to the same key produce one row, and the later write replaces `source_phrase`, `owner_id` and
-- `verified_by` together. So `owner_id` names whoever most recently caused this memo to be written. An
-- earlier user's phrase is not left behind unswept: it was overwritten at that moment, by the same statement
-- that moved the owner link. The two columns move as a pair or not at all.
--
-- ## EXPAND-ONLY (ADR-0022)
--
-- Every statement widens what the schema accepts: a new NULLABLE column, a relaxed NOT NULL, and a partial
-- index. Code that predates this migration keeps working against the migrated schema — which is the property
-- the in-stack migration Trigger depends on, since the migration lands before the image that reads it.
-- ⚠️ `source_phrase` MUST lose its NOT NULL here and not in a later release: the sweep sets it to NULL, and a
-- sweep that runs against the old constraint fails the erasure job rather than the statement.

ALTER TABLE "ingredient_resolution_memos"
    ADD COLUMN IF NOT EXISTS "owner_id" text;

ALTER TABLE "ingredient_resolution_memos"
    ALTER COLUMN "source_phrase" DROP NOT NULL;

-- Partial, mirroring `idx_resolution_mappings_author`: the sweep's predicate is `owner_id = $1`, and a
-- de-identified row is NULL forever after, so indexing the NULLs would index the table's eventual majority
-- for a query that can never match them.
CREATE INDEX IF NOT EXISTS "idx_resolution_memos_owner"
    ON "ingredient_resolution_memos" ("owner_id")
    WHERE "owner_id" IS NOT NULL;
