-- 0070 — whether the recipe's OWNER supplied a line's source text (ADR-0090).
--
-- `source_line` is verbatim copied text, and ADR-0082 §2 forbids any line of it word for word on a public form. The
-- recipe read shows it to one cook only: the owner, AND only on a line whose text that owner supplied
-- (`recipes/domain/transcriptionDisclosure.ts`). Ownership alone is not enough, because a clone COPIES the text (the
-- verification gate judges it and `verificationKey` hashes it), and the cloner then owns a copy of another cook's words.
--
-- The column is TRUE only where the owner supplied the text: a create that carried it, and the carry-forward of such a
-- line through an edit or a restore. A clone of another cook's recipe writes FALSE; a clone of the cook's own keeps the
-- source line's value. NOT NULL with no third state: a line whose writer is unknown is FALSE, which hides the text.
--
-- THE CHECK runs one way: the flag needs a text to describe. FALSE beside a text is the clone, which is the point.
--
-- EXPAND ONLY (ADR-0035). The column has a DEFAULT, so the previous release's inserts (which never name it) keep working.
-- They write FALSE. ⚠️ And the previous release re-inserts EVERY line of a recipe on EVERY save (`replaceForRecipe`), so
-- any save it serves between this migration and the new release, a title edit included, resets that recipe's backfilled
-- TRUE to FALSE for good. That window fails CLOSED: it never shows anyone text they did not write, but it hides an
-- owner's own lines. Avoid editing the backfilled recipes during the deploy, or re-run the UPDATE below afterwards: it
-- is idempotent and its predicate is unchanged by any save.
--
-- THE BACKFILL, and why its predicate is safe.
--
-- A recipe whose `cloned_from_id` is set is a clone: FALSE. A recipe whose `cloned_from_id` is NULL is NOT proven
-- owner-created, because two statements NULL that pointer on a clone that survives its source: account erasure
-- (`eraseRecipeRows` step 5) and the test-principal purge (`purgeTestPrincipalRows` step 2). No marker that a recipe is a
-- clone survives either: the clone writes no version row (a clone is a draft, and ADR-0058 versions a draft only from
-- its first publish), and `source_type`, `has_substantive_edit` and `bound_by` do not tell a clone apart. A durable
-- `recipes.is_clone` exists only on an unmerged branch.
--
-- So lineage is proven by TIME. A detach only rewrites a clone that existed when its erasure or purge ran, and every such
-- run leaves a job row: `account_erasure_jobs` is never deleted (it is the erasure's legal record), and a
-- `test_reset_jobs` row that erasure deletes (step 15) is older than the erasure job that deleted it. Every job write
-- that follows a detach (the completion, an error note, a later claim) sets `updated_at = now()`. A job still queued or
-- running counts as now and later ('infinity'), because its detach may already have committed. So a recipe with no
-- pointer, created AFTER the latest moment any job was touched, cannot have been detached: it is not a clone.
--
--   TRUE  where source_line IS NOT NULL
--           AND cloned_from_id IS NULL
--           AND created_at > the latest job time (-infinity when neither table has a row)
--   FALSE everywhere else.
--
-- ⚠️ Accepted cost: an owner-created recipe made BEFORE the latest job, and every self-clone made before this migration,
-- stays FALSE, so its owner is not shown their pasted lines. Both fail closed. A completed erasure replay runs the detach
-- again without touching the job row, and that is safe for a different reason: the erased account cannot write, so its
-- owner-only set is already empty and the replay detaches nothing.

-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it, instead of stalling every query
--   queued behind it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE ingredients ADD COLUMN source_line_transcribed_by_owner boolean NOT NULL DEFAULT false;

WITH horizon AS (
    SELECT GREATEST(
        (SELECT max(CASE WHEN status IN ('queued', 'running') THEN 'infinity'::timestamptz
                         ELSE GREATEST(created_at, updated_at, confirmed_at) END)
           FROM account_erasure_jobs),
        (SELECT max(CASE WHEN status IN ('queued', 'running') THEN 'infinity'::timestamptz
                         ELSE GREATEST(created_at, updated_at) END)
           FROM test_reset_jobs)
    ) AS latest_job_at
)
UPDATE ingredients AS line
   SET source_line_transcribed_by_owner = true
  FROM recipes AS recipe, horizon
 WHERE line.recipe_id = recipe.id
   AND line.source_line IS NOT NULL
   AND recipe.cloned_from_id IS NULL
   AND recipe.created_at > COALESCE(horizon.latest_job_at, '-infinity'::timestamptz);

ALTER TABLE ingredients
    ADD CONSTRAINT ingredients_transcribed_by_owner_has_source_line
        CHECK (NOT source_line_transcribed_by_owner OR source_line IS NOT NULL);

COMMENT ON COLUMN ingredients.source_line_transcribed_by_owner IS
    'True when the recipe''s owner supplied source_line. With ownership, it decides who is shown that text (ADR-0090). False on a clone of another cook''s recipe.';
