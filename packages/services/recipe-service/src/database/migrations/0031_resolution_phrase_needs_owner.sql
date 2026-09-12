-- 0031_resolution_phrase_needs_owner.sql (plan U10 → U14) — a typed phrase never sits without an owner.
--
-- ⛔⛔ THIS MIGRATION'S PREMISE WAS REVERSED ON 2026-08-25, THE DAY AFTER IT LANDED. Read
-- `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md` BEFORE reasoning from
-- anything below. The owner ruled that an ingredient phrase is NOT private data, so migration 0033 DROPPED
-- both CHECKs this file adds. ⚠️ Its BACKFILLS are not undone and cannot be: the phrases they nulled are
-- gone, exactly as the note at the foot of this header says.
--
-- ⚠️ ONE conclusion here SURVIVES the reversal, and 0033 relies on it: `promoteByCorroboration` still stores
-- no phrase on a corroboration binding. This file removed that copy on TWO arguments and the reversal
-- overturns only the privacy one — the copy also bought NOTHING, because the binding CITES two rows that
-- each carry their own phrase.
--
-- ## The defect
--
-- `ResolutionMappingsDal.promoteByCorroboration` inserted the `corroboration` binding with
-- `author_id = NULL` (correct — nobody wrote it) and a COPY of `request.sourcePhrase`, which is the
-- promoting cook's own typed words. The account-erasure sweep reaches this table with
--
--   UPDATE ingredient_resolution_mappings
--      SET superseded_at = now(), author_id = NULL, source_phrase = NULL
--    WHERE author_id = $owner AND superseded_at IS NULL;
--
-- so that row was STRUCTURALLY unreachable by the only predicate that de-identifies the table. When both
-- cooks whose agreement produced the binding exercised their right to erasure, their own rows were scrubbed
-- and this third row kept one of their phrases forever. Nothing failed and nothing could: the table IS
-- swept, and a coverage gate that reasons per TABLE reported it covered.
--
-- The memo tier had the same hole by a different route. `ResolutionMappingsDal.recordMemo` inserted
-- `source_phrase` with NO `owner_id` in the statement at all, so every memo it wrote was invisible to
-- 0026's `WHERE owner_id = $owner`; and `verdictStore.rememberAgreement` wrote the phrase even when the
-- message carried no owner, which 0026's own header called "exactly the position every memo was in before
-- 0026" — true, and still a phrase with nobody to point erasure at.
--
-- ## ⛔ THE REPAIRS THAT ARE WRONG, and why
--
--   * **A DELETE.** 0021's header and the sweep's step 10 both say it: a corroboration binding CITES the two
--     author rows whose agreement produced it (`corroborated_a`/`corroborated_b`, a self-FK), so deleting
--     them breaks those references or — worse — silently un-resolves an ingredient for every OTHER user.
--   * **Stamping `superseded_at` on the binding.** The same harm wearing an `UPDATE`'s clothes. The binding
--     is `global` scope: retiring it withdraws a resolution from the WHOLE installation the moment ONE of
--     its two authors exercises a PERSONAL right. 0029 reaches the identical conclusion for U21's sibling
--     tier, and for the identical reason.
--   * **Teaching the sweep a second predicate** — `origin = 'corroboration' AND corroborated_a IN (…)`. It
--     cannot work: step 10 nulls `author_id` on the very rows that predicate would have to join through, so
--     by the time it ran the citation no longer names anybody. And it could not tell WHICH of the two cooks
--     typed the copied phrase, because nothing on the row records that.
--
-- ## The ruling: the phrase is never STORED, not swept afterwards
--
-- ⛔ The phrase on a corroboration binding is a COPY with no purpose of its own. Its documented job —
-- 0021's "two-way door", so a change to `normalizedIngredientKey` is repaired by
-- `UPDATE … SET normalized_key = f(source_phrase)` instead of by data loss — is already served by the two
-- rows the binding CITES, each of which carries its own phrase beside its own author. A backfill for a
-- binding runs through `corroborated_a`; when BOTH citations have been erased their phrases are NULL anyway,
-- so the binding's repairability is exactly the weaker of its two citations either way. Storing the copy
-- bought nothing and cost an unbounded retention window — from promotion until an erasure that could never
-- reach it.
--
-- This is not a new decision. 0029 already shipped it for the parse-correction tier, in the note beside
-- `ingredient_parse_corrections_owner_line_pair`: *"A corroboration binding satisfies it by carrying
-- NEITHER: it copies no cook's line, which is also why erasing either contributing cook leaves nothing on
-- the binding to strip."* This migration brings 0021's two tables to the rule its own sibling already has.
--
-- ## Why a CHECK and not a comment
--
-- The invariant is *a phrase and the person it belongs to exist together or not at all*. Written as a
-- constraint it makes the defect UNREPRESENTABLE, so a future writer who never reads this file cannot
-- reintroduce it, and — the half that matters just as much — a future edit that splits the sweep into two
-- statements is REFUSED rather than quietly leaving a previous owner's id beside somebody else's words,
-- which would aim the NEXT erasure at the wrong person. It also makes both sweeps idempotent by
-- construction: a re-swept row is already in the target state on both columns.
--
-- The backfills are stated in terms of the INVARIANT (`owner IS NULL AND phrase IS NOT NULL`) rather than of
-- `origin = 'corroboration'`, so they repair exactly the set the constraint forbids. Today that set is the
-- corroboration bindings plus any ownerless memo; stated this way the two cannot disagree.
--
-- ## ⚠️ CONTRACTING (ADR-0022), with the window stated rather than waved away
--
-- Every other statement in this repository's migrations widens what the schema accepts; a CHECK narrows it.
-- The in-stack migration Trigger applies this BEFORE the new task set serves, so for the length of one ECS
-- rolling deploy the PREVIOUS image is still writing the shape this constraint now refuses. What that costs,
-- per tier:
--
--   * **Memos — nothing.** `verifyLine` wraps `rememberAgreement` in a `try`/`catch` that logs and continues,
--     so a rejected memo is a missing memo and a log line, never a failed message.
--   * **Mappings — one bounded, retryable failure.** `promoteByCorroboration` runs inside the caller's
--     transaction, so a rejection during the window would roll back that cook's own correction with a 500.
--     It needs a SECOND, independent cook to correct the SAME phrase to the SAME food inside the rolling
--     window, and the caller may simply correct it again afterwards. No data is lost and no read is broken.
--
-- ⛔ The ADR-conformant alternative — ship the writer change now and the constraint a release later — was
-- REJECTED. It trades a minutes-long retryable window for an indefinite one in which the only thing
-- forbidding the copy is a comment, and a comment is precisely what was in place while this defect shipped.
-- There is also no production corroboration traffic to expose: recipe-service is not deployed to prod, and
-- every `pr-{N}` database (ADR-0006) is created by the migration run itself.
--
-- There is no down-migration in any runner here. Recovery is `ALTER TABLE … DROP CONSTRAINT`; the backfilled
-- phrases are not recoverable, which is the whole point of the change.

-- ── The curated tier (0021) ───────────────────────────────────────────────────────────────────────

-- Every row the constraint below would reject: a phrase with no author to attribute it to. Today that is
-- exactly the `corroboration` bindings written before this release.
UPDATE "ingredient_resolution_mappings"
   SET "source_phrase" = NULL
 WHERE "author_id" IS NULL AND "source_phrase" IS NOT NULL;

-- ⛔ THE PAIR INVARIANT, the shape `ingredient_parse_corrections_owner_line_pair` (0029) already carries.
-- Biconditional rather than one-directional on purpose: the reverse half is what refuses a half-run sweep.
ALTER TABLE "ingredient_resolution_mappings"
    ADD CONSTRAINT "ingredient_resolution_mappings_phrase_needs_owner"
    CHECK (("author_id" IS NULL) = ("source_phrase" IS NULL));

-- ── The machine-derived tier (0021, amended by 0026) ──────────────────────────────────────────────

UPDATE "ingredient_resolution_memos"
   SET "source_phrase" = NULL
 WHERE "owner_id" IS NULL AND "source_phrase" IS NOT NULL;

-- The same invariant one tier down. A memo is keyed by `normalized_key` alone and two cooks whose lines
-- normalize alike share ONE row, so the upsert replaces the phrase and the owner link TOGETHER — this is
-- what makes that "together" a fact rather than a convention, and it is why a memo whose owner is unknown
-- now records the machine's conclusion (`food_id`, `verified_by`) and no phrase at all.
ALTER TABLE "ingredient_resolution_memos"
    ADD CONSTRAINT "ingredient_resolution_memos_phrase_needs_owner"
    CHECK (("owner_id" IS NULL) = ("source_phrase" IS NULL));
