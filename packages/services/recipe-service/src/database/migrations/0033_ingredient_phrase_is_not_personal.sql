-- 0033_ingredient_phrase_is_not_personal.sql (owner ruling 2026-08-25; ADR-0027) — the reversal of 0026/0031.
--
-- ## ⛔ THIS REVERSES TWO RECORDED RULINGS. Read them before reasoning about this file.
--
--   * `0026_memo_owner_erasure.sql` (owner ruling 2026-08-23): *"The owner ruled to KEEP the phrase and make
--     it erasable"*, which added `ingredient_resolution_memos.owner_id` — a column its own header describes
--     as *"a person-to-row link it did not hold before"*.
--   * `0031_resolution_phrase_needs_owner.sql`: the CHECK pair *a phrase and the person it belongs to exist
--     together or not at all*, built entirely on the premise that a typed phrase is personal data which some
--     sweep must be able to reach.
--
-- The owner ruled on **2026-08-25** that the premise is wrong: **an ingredient phrase — the original a cook
-- typed, or a corrected one — is NOT private data.** It does not need to be erasable, and no erasure sweep
-- targets it. So the apparatus built on that premise comes off: the memo's person link, the two CHECKs, the
-- sibling CHECK 0029 shipped for the same reason, and the three partial indexes that existed only to make a
-- sweep predicate fast.
--
-- ## The user id STAYS — for a different reason, which is why it is RENAMED rather than kept as it was
--
-- A user id is retained on both correction tiers, and not for privacy or erasure: it is how the installation
-- counts **how many DISTINCT people made the same correction**. That count is the corroboration signal that
-- promotes a correction from personal (`scope = 'author'`) to global, so the column is load-bearing — it is
-- also two of the three `WHERE` clauses that ARE the authorization on these tables (see below).
--
-- `author_id` and `owner_id` are two spellings of one concept, and neither is the repository's canonical one.
-- `specs/governance-rules.md` **GR-004** fixes the canonical column name for a user reference at `user_id`
-- (AC-004-c: *"All features that reference another feature's primary key use the canonical column name"*), so
-- both tables were in the letter of a standing violation. The rename is a correction to that rule as much as
-- it is the owner's *"that doesn't make sense"*.
--
-- ⚠️ `scope`/`origin` keep their `'author'` VALUE, deliberately. After this migration `author` names exactly
-- one thing — a REACH — and `user` names exactly one thing: a person. The overload is what is being removed,
-- not the vocabulary.
--
-- ## ⛔ WHAT THIS MIGRATION MUST NOT BREAK — the three authorization properties
--
-- `resolutionMappings.dal.ts`'s header: *"Three `WHERE` clauses ARE the authorization, and none of them is a
-- branch."* Two of the three are this column, and a rename carries both expressions with it (PostgreSQL
-- rewrites index predicates and CHECK expressions on `RENAME COLUMN` — verified against a real database
-- before this file was written, not assumed):
--
--   1. `user_id = :caller` inside the supersede `UPDATE` — *"zero rows returned IS the denial"*. Broken, any
--      cook could supersede any other cook's correction.
--   2. `(scope = 'global' OR (:caller IS NOT NULL AND user_id = :caller))` — the read predicate. Broken,
--      every cook would see every other cook's personal corrections and an unattended import would see them
--      all.
--
-- …plus the partial unique index that IS the distinct-user counter. It is RENAMED here (`…_live_author` →
-- `…_live_user`) rather than dropped and recreated: `ALTER INDEX … RENAME` is a catalog-only operation, so
-- the uniqueness it enforces is never relaxed for an instant. A DROP+CREATE would open a window in which two
-- concurrent corrections from one cook could both land and manufacture a promotion nobody earned.
--
-- ⚠️ `user_id` STAYS NULLABLE. A `corroboration` binding has no user — nobody wrote it, two people's
-- agreement produced it — and the partial indexes' `user_id IS NOT NULL` half is what excludes those rows
-- from a uniqueness they have no user to be unique per.
--
-- ## ⚠️ `source_phrase` / `source_line` STAY NULLABLE, and restoring `NOT NULL` would be wrong twice over
--
-- 0026 dropped the memo's `NOT NULL` so the sweep could clear the column, and 0029 created `source_line`
-- nullable for the same reason. Both reasons are gone — but the column must stay nullable anyway:
--
--   * **A LIVE WRITER still inserts NULL there.** `promoteByCorroboration` writes no phrase onto the
--     corroboration binding it inserts, in BOTH tiers. 0031 removed that copy on two arguments and this
--     ruling reverses only one of them. The surviving argument has nothing to do with privacy: the copy
--     bought nothing, because the binding CITES two rows that each carry their own phrase, so 0021's
--     "two-way door" backfill (`SET normalized_key = f(source_phrase)`) runs through `corroborated_a`
--     either way. ⛔ Do not "restore" the copy on the strength of this reversal.
--   * **Existing rows already violate it.** 0031's backfills nulled `source_phrase` on every corroboration
--     binding and every ownerless memo, and 0031's own header says those phrases *"are not recoverable"*.
--     An `ALTER … SET NOT NULL` fails outright if any row violates it, so this migration would fail on every
--     database 0031 has already run against — which is every `pr-{N}` database this branch has deployed to.
--
-- **This reversal restores the RULE, not the data.** The phrases 0031 destroyed are gone.
--
-- ## ⚠️ CONTRACTING (ADR-0022), with the window stated rather than waved away
--
-- ADR-0022's standing precondition is EXPAND-FIRST: *"a contracting migration ships a release LATER than the
-- code that stopped reading the column."* A column rename and a column drop are both contracting, and the
-- in-stack Trigger applies this BEFORE the new handler code serves. So there is a window — from the Trigger
-- committing this file until the erasure Lambda's code update lands — in which the PREVIOUS image's
-- `eraseRecipeRows` issues its steps 10-12 against columns that no longer answer to those names, and gets
-- `42703 undefined_column`.
--
-- ⚠️ THREE code paths are affected, not one, and they do NOT fail the same way. An earlier draft of this
-- header costed only the first and called the whole window "a few redeliveries"; that was wrong, and the
-- correction matters more than the original claim because THIS paragraph is the precedent a future
-- contracting migration will cite.
--
--   1. **`eraseRecipeRows` steps 10-12 — RETRIES, and completes.** An `AccountErasureMessage` in flight
--      fails its attempt with `42703`. The worker's error path is built for exactly this: the job row stays
--      `running` (*"the message is still queued for redelivery, so the erasure IS still in flight"*),
--      `attempts`/`last_error` record the diagnosis, and SQS redelivers under `maxReceiveCount`. The retry
--      runs against the new handler, which issues no such statement. No right is dropped.
--   2. ⛔ **`verdictStore.rememberAgreement` — SWALLOWS, and the memo is LOST.** The previous image inserts
--      `owner_id`, which is `42703` after the Trigger. `verifyLine.ts` wraps that call in a `try`/`catch`
--      that logs and returns normally, so the message SUCCEEDS and is never redelivered — and the line's
--      verdict IS stored, so nothing will re-ask. This is knowledge lost, not retried. It is bounded to the
--      window and self-heals for every future occurrence of the phrase, but "no data is lost" would be a
--      false statement about it, so it is not made.
--   3. **The recipe service's own reads — DEGRADE SILENTLY, for the length of the ECS roll.** The old tasks
--      serve the whole rolling deploy naming `author_id`/`owner_id`. The U14 correction route 500s (visible),
--      and tier 1 of the resolution cascade degrades to a MISS rather than an error, because
--      `ingredients.service.ts` passes an `onTierFailure` that only `logger.warn`s. A cook's own curated
--      mapping stops binding for the duration, with nothing surfaced to them.
--
-- ⛔ I took the BOUNDED WINDOW, not expand-then-contract, and the reason is not convenience:
--
--   * Expand-then-contract here means shipping the worker change in one release and this file in a later
--     one — two merges to carry one owner ruling — under a standing repository directive to land on the open
--     branch and never split a change across PRs. Two half-landed releases of a reversal is a worse state to
--     be interrupted in than one bounded retry window.
--   * The exposure is sandbox and `pr-{N}` only. `recipe-service` is not deployed to production, so the only
--     erasure traffic that can meet this window is test traffic — and every `pr-{N}` database (ADR-0006) is
--     created by the migration run itself.
--   * The failure direction is acceptable ON THIS DATA, which is a narrower claim than "the failure
--     direction is safe". Path 1 — the RIGHTS path, the one ADR-0022's precondition exists to protect —
--     retries and completes; it does not silently under-deliver. Paths 2 and 3 lose a re-derivable memo and
--     degrade a resolution tier to a miss, both bounded by the window and both self-healing. Had the rights
--     path been the swallowing one, this decision would have gone the other way.
--
-- ⚠️ This is a statement about THIS reversal's cost, not a precedent. A contracting migration against a
-- table prod serves does not get the same answer.
--
-- ## ⛔ WHY A NEW MIGRATION AND NOT AN AMENDMENT TO 0031
--
-- 0031 has already RUN. It is pushed to `origin/chore/code-quality-enforcement-phase-1-2` (PR #91) and the
-- `deploy-recipe (pr-91)` sandbox job succeeded after it landed, so ADR-0022's in-stack Trigger applied it to
-- that database. `lambdas/migrate/handler.ts` tracks applied migrations by NAME ONLY — there is no checksum —
-- so an amended `0031` would be SKIPPED there and its two CHECKs would stand in that database forever, while
-- every fresh database got the amended file. Editing an applied migration is how two environments come to
-- disagree about a schema with nothing reporting it.
--
-- There is no down-migration in any runner in this repository. Recovery is to re-add the constraints and the
-- column by hand; the memo `owner_id` values this drops are not recoverable.

-- ── 1. The repealed CHECKs, dropped BEFORE the renames ────────────────────────────────────────────
--
-- ⛔ ORDER IS LOAD-BEARING. `RENAME COLUMN` rewrites a constraint's EXPRESSION but not its NAME, so renaming
-- first would leave a constraint literally called `…_phrase_needs_owner` enforcing
-- `(user_id IS NULL) = (source_phrase IS NULL)` — a name asserting a ruling that no longer holds, over an
-- expression about a column that is no longer an owner. Dropping first means the name and the rule die
-- together.

-- 0031's constraint on the curated tier. Its premise — a phrase must sit beside somebody erasure can point
-- at — is exactly what the 2026-08-25 ruling reverses.
ALTER TABLE "ingredient_resolution_mappings"
    DROP CONSTRAINT IF EXISTS "ingredient_resolution_mappings_phrase_needs_owner";

-- 0031's constraint on the memo tier. Dropped explicitly rather than left to fall out of the column drop
-- below, so the reversal of 0031 is visible in ONE place in this file instead of being an implied side
-- effect a reader has to know PostgreSQL's rules to see.
ALTER TABLE "ingredient_resolution_memos"
    DROP CONSTRAINT IF EXISTS "ingredient_resolution_memos_phrase_needs_owner";

-- ⛔ 0029's `…_owner_line_pair` goes too, and this is a JUDGEMENT rather than a mechanical consequence —
-- flagged as one so it can be cheaply overruled. 0029 shipped it BEFORE 0031 and stated only one reason for
-- it: *"an owner id left beside somebody else's line would aim the LATER erasure at the wrong person: it
-- would sweep a line that owner never typed and leave the one they did."* There is no later erasure. Leaving
-- it standing would put the two correction tiers — which 0029 deliberately shaped as siblings, *"the SUBJECT
-- differs but the scope rule is identical knowledge"* — under different constraints for no stated reason,
-- and a constraint whose only recorded justification has been repealed is the kind of stale invariant the
-- next reader reasons wrongly from.
ALTER TABLE "ingredient_parse_corrections"
    DROP CONSTRAINT IF EXISTS "ingredient_parse_corrections_owner_line_pair";

-- ── 2. The indexes that existed ONLY to make a sweep predicate fast ───────────────────────────────
--
-- Each of these was created with a one-line justification naming the sweep. 0021: *"The erasure sweep's
-- index. Erasure is a per-user operation on a path with a deadline, so it gets one."* With no sweep, they
-- are write amplification on every correction forever, for a query nobody issues.
--
-- ⚠️ Checked before dropping, not assumed: no read path filters on the person column ALONE. The write path's
-- own-row lookup is `(normalized_key, user_id)` and is served by the partial unique index below; the
-- corroborator scan is `(normalized_key, food_id)` + `user_id <> :caller` and is served by
-- `idx_resolution_mappings_live_lookup`.
DROP INDEX IF EXISTS "idx_resolution_mappings_author";
DROP INDEX IF EXISTS "idx_parse_corrections_owner";

-- ── 3. One name for one concept: `user_id` on both correction tiers (GR-004) ──────────────────────
--
-- ⚠️ Every partial index predicate and every remaining CHECK expression that mentions these columns is
-- rewritten by PostgreSQL as part of the rename. Nothing below has to restate them, and nothing should:
-- restating a predicate is how a copy drifts from the index it describes.
ALTER TABLE "ingredient_resolution_mappings" RENAME COLUMN "author_id" TO "user_id";
ALTER TABLE "ingredient_parse_corrections" RENAME COLUMN "owner_id" TO "user_id";

-- The index names carry the concept too, and a name that says `author`/`owner` over a column that says
-- `user` is the same overload this migration exists to remove. ⛔ RENAME, never DROP + CREATE: a rename is a
-- catalog-only operation, so the uniqueness that IS the corroboration counter is never relaxed for an
-- instant. Dropping and recreating would open a window in which one cook's two concurrent corrections could
-- both land live and manufacture a promotion nobody earned.
ALTER INDEX "idx_resolution_mappings_live_author" RENAME TO "idx_resolution_mappings_live_user";
ALTER INDEX "idx_parse_corrections_live_owner" RENAME TO "idx_parse_corrections_live_user";

-- ── 4. The memo tier loses its person link entirely ───────────────────────────────────────────────
--
-- ⛔ NOT a rename, and the asymmetry with the two tiers above is the whole point. A memo is the MODEL's
-- conclusion — *"nobody asserted it, so it has no scope and no author; what it carries instead is the
-- identifier of the model that AGREED with it"* (0021) — so there is no correction here and nothing to
-- count. `owner_id` was WRITE-ONLY: nothing ever SELECTed it, and its only index was partial and built for
-- the sweep predicate. 0026 added it solely to make erasure possible, so with erasure gone it is the single
-- identifying field left on an otherwise impersonal row. The right move for a column that exists only for a
-- repealed purpose is to remove it, not to rename it into a counter it cannot serve.
--
-- ⚠️ NO `CASCADE`, and none is needed: PostgreSQL drops indexes and table constraints involving a dropped
-- column automatically. `idx_resolution_memos_owner` goes with it. Verified against a real database rather
-- than read off the manual. ⛔ Do not add `CASCADE` here — it would also silently drop anything a future
-- reader had built on this column, which is exactly the review signal a bare `DROP COLUMN` preserves.
ALTER TABLE "ingredient_resolution_memos" DROP COLUMN IF EXISTS "owner_id";
