-- 0066 — the bulk import's save fence, its parse-job generation, the saved line's verdict key and the purge's activity
-- index (ADR-0072). 0059 created the tables; these are the columns the service lane needs.
--
-- ⛔ A PARSE JOB IS CREATED UNDER A DETERMINISTIC ID, and `parse_generation` is the third part of it. The service derives the
-- job id from (import, ordinal, generation), so a retry after a crash between "the job was created" and "the item names it"
-- finds the same job instead of making a second one (a second job is a second LLM bill). A job that expired, or was purged
-- while the item still waits on it, is replaced by bumping the generation: the new id cannot collide with the old job's rows.
--
-- ⛔ `decision_rev` FENCES THE SAVE. A save reads the item (statement, visibility, review mark, picks), spends seconds asking
-- food to admit foods, and only then claims the item in the recipe's own transaction. Without a fence a cook's decision that
-- commits in that window is silently ignored (the recipe is saved with the old statement and label) or lost (a pick stored on
-- an item that is already saved, with no rebind). Every writer of a decision bumps this counter under the item's row lock, and
-- the claim requires it unchanged; a mismatch rolls the recipe back and the next call saves from the new state. An integer,
-- not `updated_at`: the clock moves for reasons that are not decisions, and a JS `Date` has no microseconds.
--
-- ⛔ `saved_verification_key` is the key the review gate's verdict about the SAVED line lives under (the same
-- `verificationKey(verifiedLineIdentity(...))` the recipe detail reads with), computed when the item is saved. It is a key,
-- never a verdict. The snapshot's own `verification_key` judges the PROPOSED food, and a line the import bound to another food
-- (a default, or the best match) is judged under a different key; "flagged" and the view's `version` read the verdict by it,
-- in SQL, without re-deriving a hash for every line on every poll.
--
-- ⛔ `recipe_imports.updated_at` IS THE ACTIVITY CLOCK the purge reads (ADR-0072 §12): every write route bumps it, reads never
-- do, and an import untouched for 30 days has its working data deleted (the recipes it saved stay). The index lets the purge
-- find idle imports without scanning every import.
--
-- Additive and expand-only (ADR-0035): two `NOT NULL DEFAULT 0` integers (a metadata-only change on PostgreSQL 11+), one
-- nullable text column and one index, read and written only by the service lane. No GRANT: the service role's DML on these
-- tables comes from 0059's tables (ADR-0039). A plain CREATE INDEX, because the runner applies in a transaction.

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the three import tables. A deploy that cannot take it in 5 s fails
-- and a re-run retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_items
    ADD COLUMN parse_generation integer NOT NULL DEFAULT 0 CHECK (parse_generation >= 0),
    ADD COLUMN decision_rev integer NOT NULL DEFAULT 0 CHECK (decision_rev >= 0);

ALTER TABLE recipe_import_lines
    -- NULL until the item is saved, and for a line kept as written (nothing is bound, so nothing is judged).
    ADD COLUMN saved_verification_key text;

CREATE INDEX recipe_imports_updated_idx ON recipe_imports (updated_at);
