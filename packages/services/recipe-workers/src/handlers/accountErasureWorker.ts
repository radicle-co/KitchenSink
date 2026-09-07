import type { SQSHandler, SQSRecord } from 'aws-lambda';

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
    cdnOwnerPrefixInvalidationPath,
    ownerMediaPrefix,
    pseudonymizedAuthorHandle,
    recipeMediaPrefix,
    type AccountErasureMessage,
    type CdnInvalidationPort,
} from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import { isValid as isValidUlid } from 'ulidx';

import { requireEnv } from '../common/config.js';
import { createCloudFrontInvalidation } from '../common/cdnInvalidation.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/**
 * SQS-triggered account-erasure worker (GDPR right-to-erasure, C-007 / D7 / CR-002). VPC-attached DB
 * consumer.
 *
 * **This is a SCOPED erasure, not a whole-owner wipe (CR-002 / U3).** A user may keep community content:
 * a recipe is removed only when it is OWNER-ONLY — `visibility='private'` **OR** `status='draft'` (a
 * draft is owner-only regardless of visibility; both columns are a security boundary). A **truly-public**
 * recipe (`visibility='public' AND status='published'`) SURVIVES, pseudonymized. The owner may also
 * **donate** specific owner-only recipes via a per-recipe election (`account_erasure_jobs.publish_recipe_ids`):
 * those are flipped to public+published FIRST and then survive too. So this path removes only the owner's
 * owner-only, non-donated recipes (+ their media), all their collections, and their ratings on others'
 * recipes — and pseudonymizes what it keeps. See {@link eraseRecipeRows} + Specification B.
 *
 * This is the ONLY code path permitted to issue `DELETE FROM recipes` — every other "delete" in the
 * system sets `deleted_at` instead — and correspondingly the only path exempt from the
 * `activeRecipes()` / `no-raw-recipes-select` read-path rule (data-model.md §Hard purge). See
 * {@link eraseRecipeRows} for why that exemption is load-bearing rather than a convenience.
 *
 * **What "done" means here.** A right-to-erasure request is a legal statement, so the failure this
 * worker is designed against is not a crash — it is a *false success*. Every ordering choice below
 * exists so a `completed` job row can only ever mean the data is really gone, and so any interruption
 * leaves work still owed rather than work falsely reported:
 *
 *   1. Claim the job (`queued`/`running` → `running`) BEFORE any destructive work, so an attempt that
 *      dies mid-erasure is still counted. The claim reads back the durable election + the previously
 *      captured removed-recipe id set (see below).
 *   2. Delete the DB rows in ONE transaction — the reachable copy of the personal data goes first — after
 *      flipping donated recipes to public+published, so what remains owner-only is exactly what to remove.
 *   3. Sweep the removed recipes' media, per removed recipe, in the media bucket then the archive bucket —
 *      NOT the whole owner prefix, which would delete a surviving public recipe's photos. ALL real data
 *      deletion, across both systems the owner's PII lives in, completes before anything CDN-related runs.
 *   4. Only THEN purge the CloudFront edge cache (best-effort hygiene, never a deletion step — see the
 *      ordering note on the `cdn.invalidate` call in {@link processRecord}).
 *   5. Only then mark the job `completed`.
 *
 * **Crash-convergence with a SCOPED sweep.** The old sweep was driven by the owner *prefix*, independent
 * of any row, so a crash between the row delete (2) and the object sweep (3) still converged. A scoped,
 * per-removed-recipe sweep loses that: the recipe ids come from `recipes`, and after (2) those rows are
 * gone, so a replay could no longer learn which recipes' objects to sweep. So the removed-recipe id set
 * is CAPTURED durably — written to `account_erasure_jobs.removed_recipe_ids` inside the very transaction
 * that deletes the rows (2), write-once. A redelivery re-claims the still-`running` job, reads the
 * captured ids back off the row, and finishes the sweep — convergence restored, rows-first preserved.
 * (data-model.md's original S3-first order was forced by exactly this row-enumerated-keys constraint; we
 * keep rows-first by persisting the ids instead of inverting the order.)
 *
 * **Failure is never terminal here.** See {@link recordErasureJobError} — the single most consequential
 * decision in this file.
 */

/**
 * The message contract — re-exported from `@kitchensink/recipe-core` rather than declared here, and kept
 * exported because this module's tests and callers already address it here.
 *
 * It moved out for the same reason {@link ownerMediaPrefix} did: it now has a PRODUCER in another package
 * (`recipe-service`'s `ErasureService` enqueues on `POST /api/v1/account/erasure`) as well as this consumer,
 * and a wire contract that each side declares its own copy of is a contract that drifts. One definition,
 * imported by both.
 *
 * It carries no `jobId`, deliberately: `idx_erasure_jobs_active_owner` makes "the active job for this
 * owner" unique in the database, so {@link claimErasureJob} can resolve it from `ownerId` alone.
 */
export type { AccountErasureMessage };

// ⛔ Both refusals live in `accountErasureWorker.errors.ts` and are RE-EXPORTED here, so every existing
// importer keeps working. They moved because adding `MisroutedErasureMessageError` made this file export two
// classes, which `oneFileOneThing` refuses (`CODING_STANDARDS` §1) — the handler is the one thing this file
// does. Re-exported rather than relocated silently: the guards are part of this module's public contract.
export {
    InvalidErasureMessageError,
    MisroutedErasureMessageError,
    isInvalidErasureMessageError,
    isMisroutedErasureMessageError,
} from './accountErasureWorker.errors.js';

// ⚠️ IMPORTED as well as re-exported, and the two are not interchangeable: a re-export makes a symbol
// available to this module's IMPORTERS, not to this module's own body, which throws both of these.
import { InvalidErasureMessageError, MisroutedErasureMessageError } from './accountErasureWorker.errors.js';

/**
 * The claimed `account_erasure_jobs` row this invocation is accountable for.
 *
 * A `type` rather than an `interface` so it carries the implicit index signature Drizzle's
 * `execute<T>` requires of a row shape — the same reason `version-archive-worker` declares its row
 * types this way.
 */
export type ErasureJobClaim = {
    readonly id: string;
    /**
     * The DONATE election read back off the claimed row (CR-002 / U3b) — the recipe ids the owner elected
     * to publish. The DURABLE row is the source of truth for the election, NOT the SQS message, so the
     * worker flips exactly these regardless of what the (derived, possibly-stale) message carried. `null`
     * on a pre-election row ⇒ donate nothing.
     */
    readonly publishRecipeIds: string[] | null;
    /**
     * The removed-recipe id set captured on a PRIOR attempt (CR-002 / U3a) — `null` until the first
     * attempt's erase transaction writes it. On a redelivery after the rows were already deleted, this is
     * the ONLY way to recover which recipes' S3 objects still need sweeping (the rows are gone), so the
     * scoped sweep converges. Write-once, so a replay reads a stable set.
     */
    readonly removedRecipeIds: string[] | null;
};

/** Max characters persisted to `account_erasure_jobs.last_error` (the column is unbounded TEXT). */
const MAX_LAST_ERROR_LENGTH = 1000;

const s3 = new S3Client({});

/**
 * Presence guard used INSIDE the sweep ({@link eraseRecipeObjects}) as a last-ditch check: a non-blank
 * string keeps `ownerMediaPrefix` from collapsing to the bucket-wide `recipes/`. Its callers pass ids that
 * were already ULID-validated at the message boundary ({@link isAppUserUlid} in {@link parseErasureMessage})
 * or read straight from the DB, so this is the interior belt to the boundary's braces.
 */
const isValidOwnerId = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Strict owner-id guard for the untrusted MESSAGE boundary: the id must be a valid ULID — the exact format
 * identity mints (via `ulidx`). Because this id feeds both the S3 prefix and the SQL predicate on the most
 * destructive path in the system, the boundary refuses anything malformed (path fragments, slugs, wrong
 * length, non-Crockford chars) before it can reach the sweep. Library-first: reuses `ulidx`'s own validator
 * rather than a hand-rolled regex, so it stays in lockstep with how the ids are generated.
 */
const isAppUserUlid = (value: unknown): value is string => typeof value === 'string' && isValidUlid(value);

/**
 * Parse and shape an SQS record body into a typed erasure message.
 *
 * `ownerId` is validated rather than cast, because a blank or missing owner is this worker's worst
 * input: it is not a crash, it is a SILENT FALSE ERASURE. `ownerMediaPrefix('')` is `recipes//`, which
 * prefix-matches no real key, and `DELETE … WHERE owner_id = ''` matches no row — so an unvalidated
 * blank owner would sweep nothing, delete nothing, and mark the job `completed`, leaving the row
 * asserting that a user's data was erased when nothing was touched. Rejecting here keeps `completed`
 * honest. (The blast radius is contained either way: the trailing slash in `ownerMediaPrefix` stops a
 * blank owner from widening into a bucket-wide prefix.)
 *
 * `requestedAt` is deliberately NOT validated: it is observational — logged, never acted on — so a guard
 * would buy no safety while rejecting messages this worker could otherwise honour.
 *
 * The DONATE election (`publishRecipeIds`, CR-002 / U3b) is parsed TOLERANTLY — a valid string array is
 * carried through, anything else (absent, null, non-array, wrong element types) collapses to `undefined`
 * rather than throwing. This is deliberate on two counts: the rollout is consumer-tolerant (a message
 * that predates the field must be honoured), and the field is not safety-critical HERE because the worker
 * reads the authoritative election from the durable job ROW it claims, not from the message. So a
 * malformed election on the wire degrades to "no message election" and the row still governs.
 *
 * @param record - The raw SQS record.
 * @returns The typed message.
 * @throws {SyntaxError} When the body is not JSON — a poison message must surface, not be acked.
 * @throws {InvalidErasureMessageError} When `ownerId` is absent, blank, or not a string.
 */
export const parseErasureMessage = (record: SQSRecord): AccountErasureMessage => {
    const body = JSON.parse(record.body) as Partial<AccountErasureMessage>;

    if (!isAppUserUlid(body.ownerId)) {
        throw new InvalidErasureMessageError(`ownerId must be a valid ULID, received ${JSON.stringify(body.ownerId)}`);
    }

    const publishRecipeIds = Array.isArray(body.publishRecipeIds)
        ? body.publishRecipeIds.filter((id): id is string => typeof id === 'string')
        : undefined;

    return {
        ownerId: body.ownerId,
        requestedAt: String(body.requestedAt),
        ...(publishRecipeIds !== undefined ? { publishRecipeIds } : {}),
    };
};

/**
 * S3 key prefix under which all of an owner's recipe media lives — re-exported from the shared
 * `recipeObjectKeys` scheme (ARCH-BE-3) rather than rebuilt here, and kept exported because this
 * module's tests and callers already address it here.
 *
 * This worker's sweep is only complete if every writer puts its objects under this exact prefix, so the
 * prefix and the keys written against it must come from ONE definition. `verticals-8` is what happens
 * when they don't: an owner-less key escaped the sweep and survived a right-to-erasure request. The
 * containment invariant is tested in `@kitchensink/recipe-core`.
 */
export { ownerMediaPrefix };

/**
 * Claim the owner's outstanding erasure job, marking it `running` and counting the attempt.
 *
 * Resolved by `owner_id` rather than by a job id carried on the message, because the database already
 * guarantees the answer is unique: `idx_erasure_jobs_active_owner` is a UNIQUE partial index over
 * `owner_id WHERE status IN ('queued','running')`, so "the active job for this owner" matches at most
 * one row. That is why {@link AccountErasureMessage} needs no `jobId`, and why the message's `ownerId`
 * and the job row can never disagree — the row is found BY that owner id.
 *
 * Claiming `running` as well as `queued` is what lets an SQS redelivery *resume* a job instead of
 * finding it unclaimable and no-oping. `attempts` increments on the claim, not on success, because the
 * attempt worth counting is precisely the one that dies before it can report anything.
 *
 * @param db - The recipe database handle.
 * @param ownerId - The owner being erased.
 * @returns The claimed job, or `undefined` when the owner has no active job — the already-`completed`
 *   replay. Callers must treat that as a clean no-op, not an error (SQS is at-least-once).
 * @sideEffect Updates `account_erasure_jobs`.
 */
export const claimErasureJob = async (
    db: NodePgDatabase<Record<string, never>>,
    ownerId: string,
): Promise<ErasureJobClaim | undefined> => {
    const result = await db.execute<ErasureJobClaim>(sql`
        UPDATE account_erasure_jobs
        SET status = 'running', attempts = attempts + 1, updated_at = now()
        WHERE owner_id = ${ownerId} AND status IN ('queued', 'running')
        RETURNING id,
                  publish_recipe_ids AS "publishRecipeIds",
                  removed_recipe_ids AS "removedRecipeIds"
    `);

    return result.rows[0];
};

/**
 * Does THIS database hold any `account_erasure_jobs` row for the owner, in any status?
 *
 * The bookkeeping interlock that gates {@link processRecord}'s destructive work. A {@link claimErasureJob}
 * returning nothing is ambiguous: it means either a completed/failed **replay** (a row exists, just not in
 * a claimable status) or a **misrouted** message (no row at all — e.g. a sandbox erasure drained by a
 * `pr-{N}` worker, which the per-stage queue topology is supposed to prevent but must not be the SOLE
 * guard). Only the misrouted case must skip erasure — and FAIL the delivery, see
 * `MisroutedErasureMessageError`; the replay must still run its idempotent no-op. This existence check
 * is what tells them apart, so a message can only ever destroy data the local DB has a record authorizing.
 *
 * @param db - The recipe database handle.
 * @param ownerId - The owner the message wants erased.
 * @returns True when a row for the owner exists in this database.
 * @sideEffect Reads `account_erasure_jobs`.
 */
export const erasureJobExistsForOwner = async (
    db: NodePgDatabase<Record<string, never>>,
    ownerId: string,
): Promise<boolean> => {
    const result = await db.execute(sql`
        SELECT 1 FROM account_erasure_jobs WHERE owner_id = ${ownerId} LIMIT 1
    `);

    return result.rows.length > 0;
};

/**
 * Mark a claimed job `completed` — the terminal, legally-meaningful state.
 *
 * Clears `last_error` so a job that failed once and then succeeded does not carry the old attempt's
 * error on a `completed` row, implying a failure that did not happen.
 *
 * @param db - The recipe database handle.
 * @param jobId - The claimed job's id.
 * @sideEffect Updates `account_erasure_jobs`.
 */
export const markErasureJobCompleted = async (
    db: NodePgDatabase<Record<string, never>>,
    jobId: string,
): Promise<void> => {
    await db.execute(sql`
        UPDATE account_erasure_jobs
        SET status = 'completed', last_error = NULL, updated_at = now()
        WHERE id = ${jobId}
    `);
};

/**
 * Annotate a job with the reason its latest attempt failed — WITHOUT making it terminal.
 *
 * **This is the crux of the worker, so the reasoning is recorded in full.** The obvious design is
 * "catch the error and set `status = 'failed'`". It is wrong twice over:
 *
 *   1. *It abandons a legal request.* T136b's cron sweeper re-drains jobs stuck in `queued`/`running`.
 *      A job marked `failed` drops out of that set, so nothing retries it — the erasure silently stalls
 *      until the user happens to ask again. Erasure has to converge on its own.
 *   2. *It can crash the retry.* `failed` frees `idx_erasure_jobs_active_owner`, so a re-POST inserts a
 *      second, `queued` job for the owner. When SQS then redelivers the original message, flipping the
 *      old row back to `running` violates that unique index. Reproduced against Postgres 16:
 *      `duplicate key value violates unique constraint "idx_erasure_jobs_active_owner"`.
 *
 * The apparent conflict — "mark `failed`" vs "throw so SQS retries" — dissolves once *recording* an
 * error and *ending* a job are treated as the separate things they are. The row stays `running` because
 * that is the truth: the message is still queued for redelivery, so the erasure IS still in flight.
 * `attempts` + `last_error` carry the diagnosis, SQS and its DLQ carry the retry, and the sweeper
 * carries the recovery. Deciding to GIVE UP is a different decision, owned by whatever drains the DLQ
 * (T136b) — not by one failed attempt. A `running` job is also why a concurrent re-POST correctly gets
 * `202` with this same job id rather than a second one: the request has not failed, it is still running.
 *
 * @param db - The recipe database handle.
 * @param jobId - The claimed job's id.
 * @param error - The thrown value; non-`Error` throws are stringified rather than dropped.
 * @sideEffect Updates `account_erasure_jobs.last_error`.
 */
export const recordErasureJobError = async (
    db: NodePgDatabase<Record<string, never>>,
    jobId: string,
    error: unknown,
): Promise<void> => {
    const message = error instanceof Error ? error.message : String(error);

    await db.execute(sql`
        UPDATE account_erasure_jobs
        SET last_error = ${message.slice(0, MAX_LAST_ERROR_LENGTH)}, updated_at = now()
        WHERE id = ${jobId}
    `);
};

/** The scoped erasure's DB effect: which recipe ids were removed (their objects still need sweeping). */
export interface EraseRecipeRowsResult {
    /**
     * The recipe ids removed by THIS transaction — the owner's owner-only, non-donated recipes. Drives
     * the per-removed-recipe S3 sweep. Empty on a replay after the rows were already deleted (the caller
     * then falls back to the captured {@link ErasureJobClaim.removedRecipeIds}).
     */
    readonly removedRecipeIds: string[];
}

/**
 * Perform the SCOPED (CR-002 / U3a+b+c) database side of erasure, atomically: donate the elected recipes,
 * remove the owner's owner-only content + collections + cross-recipe ratings, and pseudonymize what is
 * KEPT. Returns the removed-recipe id set for the caller's scoped S3 sweep.
 *
 * The statements run in ONE transaction, in this order — the order is load-bearing:
 *
 *  1. **Donate-flip (U3b), FIRST.** Elected recipes are set BOTH `visibility='public'` AND
 *     `status='published'` — a visibility-only flip would leave a donated *draft* owner-only (still
 *     removed). Scoped `AND owner_id = ownerId`, so an election id the owner does not own is a harmless
 *     no-op, never a way to publish someone else's recipe. Running first means what remains owner-only
 *     afterwards is exactly the to-be-removed set.
 *  2. **Compute the removed set.** `owner_id = ownerId AND NOT (visibility='public' AND status='published')`
 *     — owner-only = private OR draft (both a security boundary; a public *draft* is still owner-only).
 *     Captured as concrete ids because (a) the scoped S3 sweep needs them and (b) after the delete they
 *     are unrecoverable — see step 3.
 *  3. **Capture the removed ids on the job row (crash-convergence), write-once.** Persisted in THIS
 *     transaction, atomic with the delete, so a redelivery after a crash reads them back off the still-
 *     `running` row and finishes the sweep. `WHERE … removed_recipe_ids IS NULL` makes it write-once, so
 *     a replay (whose freshly-computed set is empty — the rows are gone) never clobbers the real set.
 *  4. **Ratings root (CR-001 / FR-013b), before the recipe delete.** The owner's ratings on OTHER users'
 *     (surviving) recipes: `DELETE FROM recipe_ratings WHERE user_id = ownerId`. `recipe_id` CASCADEs so
 *     ratings on the owner's OWN recipes go with those recipes, but their ratings on everyone else's would
 *     otherwise survive. This bulk delete fires the STATEMENT-LEVEL aggregate trigger ONCE, re-deriving
 *     every affected survivor's `average_rating`/`rating_count` — NEVER written by hand (trigger-only). The
 *     erased user's stars leave the public average: anonymized, not merely detached.
 *  5. **Scoped clone-detach, before the delete.** `recipes.cloned_from_id → recipes.id` is `NO ACTION`
 *     and not deferrable (live `pg_constraint`), so any SURVIVING recipe pointing at a removed recipe makes
 *     the delete throw `recipes_cloned_from_id_fkey`. So every survivor whose `cloned_from_id` is in the
 *     removed set is detached first: `cloned_from_id = ANY(removed) AND id <> ALL(removed)`. Scoped to the
 *     removed set (NOT owner-wide) so a surviving public recipe's clone pointer is NOT corrupted; and the
 *     survivor guard is `id NOT IN removed`, **not** `owner_id <> ownerId` — because the donate-flip and
 *     self-clone make the owner's OWN kept recipe able to point at their OWN removed recipe (donate a clone
 *     P of a private source Q → P kept, Q removed, P→Q dangles), which `owner_id <> ownerId` would miss and
 *     the delete would then FK-fail. Rows in the removed set are NOT detached: they are deleted by the same
 *     statement as their source, and the NO ACTION check at end-of-statement sees both already gone.
 *  6. **Scoped recipe delete.** `DELETE FROM recipes WHERE id = ANY(removed)` — NOT `WHERE owner_id`, so
 *     truly-public + donated recipes survive. No `deleted_at` filter: a tombstoned owner-only recipe is
 *     erased too (retention is not reachability). Cascades to `recipe_steps`, `recipe_ingredients`,
 *     `recipe_photos`, `recipe_versions`, `recipe_collections`, `recipe_version_pending_archives`, and the
 *     ratings on the removed recipes — the schema owns that graph; re-deleting by hand would be dead SQL
 *     that rots when a cascade changes. `ingredients` (shared, owner-less) is deliberately untouched.
 *  7. **Clone-provenance handle (owner ruling 2026-08-25), BEFORE the collection delete.** See the
 *     "ONE RULE FOR HANDLES" note below — this is the one statement in the transaction that de-identifies a
 *     row belonging to SOMEBODY ELSE, and its ordering is load-bearing.
 *  8. **Collections (U3c).** `DELETE FROM collections WHERE owner_id = ownerId` — ALL of them, public and
 *     private, cascading to their memberships. Other users' cloned collections have `source_collection_id`
 *     SET NULL by the FK (clones survive; the "pull from source" path degrades to `COLLECTION_NOT_CLONED`).
 *  9. **Author-handle residue (U3b), AFTER the delete.** By now only KEPT rows remain for the owner, and
 *     each still carries a denormalized cleartext `recipes.author_handle`. Scrub every non-null one to the
 *     ULID-derived {@link pseudonymizedAuthorHandle}, so a kept recipe renders a consistent PSEUDONYMOUS
 *     author and no cleartext handle survives. (A row that had no handle keeps none — we do not fabricate
 *     authorship.)
 * 10. **Editor-handle residue (owner ruling 2026-08-25).** `recipe_versions.editor_handle` is the same
 *     denormalized display name one table over. A KEPT recipe's version rows are NOT reached by the cascade
 *     in step 6, so they survived carrying the cleartext. Scrubbed to the same pseudonym, keyed on
 *     `created_by` — the predicate `handleSyncWorker` itself uses to write this column.
 * 11. **`author_handles` read-model root (W8-a.2 / .10).** `DELETE FROM author_handles WHERE user_id =
 *     ownerId` — user-keyed, no FK, nothing cascades it. Deleting it removes the cleartext read-model row
 *     entirely; kept recipes no longer need it because their author renders from the scrubbed denormalized
 *     column (verified: no read path joins `author_handles`).
 *
 * ## ONE RULE FOR HANDLES — steps 7 and 10, and what step 7 deliberately costs
 *
 * A user's DISPLAY HANDLE is denormalized into three columns, and until this ruling only one of them was
 * pseudonymized. `collections.source_owner_handle` (migration 0016) is the clone-provenance freeze, and it is
 * the awkward one: **it lives on somebody else's row.** When B clones A's collection, B's row records A's
 * handle, so step 8's owner-keyed `DELETE` could never reach it — the same datum was destroyed in `recipes`
 * and left standing in `collections`, behind a green suite. Step 7 closes that, and step 10 closes the same
 * hole in `recipe_versions`. All three write the SAME {@link pseudonymizedAuthorHandle}, so a kept recipe and
 * a clone of that person's collection name the same stranger rather than two.
 *
 * ⚠️ **Accepted cost (owner, 2026-08-25): clone provenance degrades to "cloned from a deleted account".** B's
 * clone keeps its `source_collection_name` and renders a pseudonymous source owner. That is exactly what
 * `recipes.author_handle` already accepted for a kept public recipe, and it is the correct trade: the WHO is
 * identity and goes, the WHAT is authored content and stays.
 *
 * ⛔ **`source_collection_name` is NOT swept, deliberately.** A collection name is authored CONTENT, of the
 * same kind as the title of a truly-public recipe this erasure keeps by design — sweeping it would destroy
 * the clone's record of what it was cloned from while erasing nothing that identifies a person. The counter-
 * argument is real and stated rather than hidden: a name can embed a person ("Alice's Favourites"), exactly
 * as a recipe title can, and the system already accepts that for every kept public recipe. Consistency with
 * that standing decision wins; revisiting it is a ruling about recipe titles too, not about this column.
 *
 * ⛔ **Keyed on `source_collection_id`, NEVER on the handle STRING.** `author_handles.display_name` is
 * identity's `profiles.displayName` — no uniqueness constraint anywhere — so `WHERE source_owner_handle =
 * <the erased user's name>` would rewrite a bystander's provenance for an unrelated owner who happens to
 * share a display name, asserting a clone came from someone it did not. A repair that manufactures a false
 * record is worse than the residue it removes.
 *
 * ⚠️ **Stated residual: an ALREADY-ORPHANED clone is unreachable.** `source_collection_id` is `ON DELETE SET
 * NULL`, so a clone whose source collection was deleted through the ORDINARY delete path — before its owner
 * ever requested erasure — carries the frozen handle with no pointer left to key on, and nothing here can
 * find it without falling back to the unsound value match above. Closing it structurally means denormalizing
 * the source owner's ULID beside the handle (a `collections.source_owner_id`, mirroring how `recipes` carries
 * `owner_id` beside `author_handle`), which is a persisted-schema decision for the owner to take, not one to
 * take silently inside a sweep.
 * ⛔ **THREE STEPS STOOD HERE AND WERE REMOVED — owner ruling 2026-08-25, ADR-0027. Do not restore them.**
 *
 * They de-identified `ingredient_resolution_mappings` (step 10, plan U10 → U14), `ingredient_resolution_memos`
 * (step 11, migration 0026) and `ingredient_parse_corrections` (step 12, plan U21), each nulling a person
 * column and the ingredient phrase beside it. The owner ruled that **an ingredient phrase — the original a
 * cook typed, or a corrected one — is NOT private data**: it does not need to be erasable, and no sweep here
 * targets it.
 *
 * ⚠️ The person column SURVIVES on the two correction tiers, spelled `user_id` since migration 0033, and it
 * is deliberately NOT swept. It is there to count how many DISTINCT people made the same correction — the
 * corroboration signal that promotes a correction from personal to global — and it is also two of the three
 * `WHERE` clauses that ARE the authorization on those tables. Sweeping it would silently un-authorize a cook
 * from their own corrections and dissolve the count. The memo tier lost its column outright, because a memo
 * is the MODEL's conclusion and there is no correction there to count.
 *
 * ⛔ The retention posture and its residual risk are argued in ADR-0027, not here. Do not re-add a sweep for
 * these three tables on the strength of `erasureSweepCoverage.test.ts` going red — that gate now records them
 * in `RETAINED_BY_RULING`, and an entry there is the decision, not an oversight.
 *
 * `recipe_versions.created_by` is not swept independently — only the `editor_handle` beside it is (step 10).
 * The id is the pseudonymous ULID that `recipes.owner_id` legitimately survives as, and it is what step 10
 * KEYS ON; clearing it would leave the handle unreachable on the next run. For a REMOVED recipe the cascade
 * takes the whole row anyway: mutations are owner-only and `created_by` cannot diverge from its recipe's
 * `owner_id`. A "defensive" delete on top of that would destroy the version history of a user who never
 * asked to be erased, if that invariant ever broke.
 *
 * @param db - The recipe database handle.
 * @param ownerId - The owner being erased.
 * @param publishRecipeIds - The recipe ids the owner elected to publish (donate); empty ⇒ donate nothing.
 * @returns The removed-recipe id set for the scoped S3 sweep.
 * @sideEffect Deletes/updates rows in RDS (cascading), and captures the removed set on the job row.
 */
export const eraseRecipeRows = async (
    db: NodePgDatabase<Record<string, never>>,
    ownerId: string,
    publishRecipeIds: readonly string[],
): Promise<EraseRecipeRowsResult> => {
    const pseudonym = pseudonymizedAuthorHandle(ownerId);
    // The election is bound as a single jsonb parameter (NOT `= ANY($1::uuid[])` over a JS array, which
    // drizzle list-EXPANDS into `ANY($1, $2, …)` — invalid for ANY). `jsonb_array_elements_text` turns the
    // one bound json string back into a set of ids the flip matches with `id IN (…)`; an empty election
    // yields no rows, so the flip safely matches nothing. Parameterized throughout — no SQL built from the
    // (client-originated) ids.
    const publishElectionJson = JSON.stringify([...publishRecipeIds]);

    // The owner-only (removed) predicate — the exact negation of "truly public". Named once so the removed-set
    // SELECT, the clone-detach subqueries, and the DELETE all key on the IDENTICAL two-axis rule; a drift
    // between any two of them would sweep a different set than it deleted.
    const ownerOnly = sql`owner_id = ${ownerId} AND NOT (visibility = 'public' AND status = 'published')`;

    return db.transaction(async (tx) => {
        // 1. Donate-flip (U3b): elected recipes → community-visible. BOTH columns; scoped to the owner.
        await tx.execute(sql`
            UPDATE recipes
            SET visibility = 'public', status = 'published', updated_at = now()
            WHERE id IN (SELECT jsonb_array_elements_text(${publishElectionJson}::jsonb)::uuid)
              AND owner_id = ${ownerId}
        `);

        // 2. The removed set = the owner's rows that are NOT truly-public (owner-only, non-donated). Captured
        //    as concrete ids for the scoped S3 sweep (and persisted below); the DELETE re-uses the identical
        //    predicate rather than binding this array back, so the two can never disagree.
        const removed = await tx.execute<{ id: string }>(sql`SELECT id FROM recipes WHERE ${ownerOnly}`);
        const removedRecipeIds = removed.rows.map((row) => row.id);

        // 3. Capture the removed ids on the job row, atomic with the delete, WRITE-ONCE (crash-convergence).
        await tx.execute(sql`
            UPDATE account_erasure_jobs
            SET removed_recipe_ids = ${JSON.stringify(removedRecipeIds)}::jsonb, updated_at = now()
            WHERE owner_id = ${ownerId}
              AND status IN ('queued', 'running')
              AND removed_recipe_ids IS NULL
        `);

        // 4. Ratings root (CR-001) — before the recipe delete; the statement trigger re-derives survivors.
        await tx.execute(sql`DELETE FROM recipe_ratings WHERE user_id = ${ownerId}`);

        // 5. Scoped clone-detach — every SURVIVOR (`id NOT IN removed`) pointing at a removed recipe
        //    (`cloned_from_id IN removed`). NOT `owner_id <> ownerId` (which would miss a donated/self-clone
        //    the owner KEEPS that points at their own removed recipe, then FK-fail the delete), and NOT
        //    owner-wide (which would null a pointer to a SURVIVING public recipe — provenance corruption).
        await tx.execute(sql`
            UPDATE recipes
            SET cloned_from_id = NULL, updated_at = now()
            WHERE cloned_from_id IN (SELECT id FROM recipes WHERE ${ownerOnly})
              AND id NOT IN (SELECT id FROM recipes WHERE ${ownerOnly})
        `);

        // 6. Scoped recipe delete — the removed set (owner-only, post-flip), NOT owner-wide, so truly-public +
        //    donated survive. No `deleted_at` filter: a tombstoned owner-only recipe is erased too.
        await tx.execute(sql`DELETE FROM recipes WHERE ${ownerOnly}`);

        // 7. Clone-provenance handle residue (owner ruling 2026-08-25) — BEFORE the collection delete, which
        //    is what nulls the pointer this keys on. Keyed on `source_collection_id`, NEVER on the handle
        //    STRING: a display name is not unique, so a value match would rewrite a bystander's provenance
        //    for an unrelated owner who happens to share one.
        await tx.execute(sql`
            UPDATE collections
            SET source_owner_handle = ${pseudonym}, updated_at = now()
            WHERE source_owner_handle IS NOT NULL
              AND source_collection_id IN (SELECT id FROM collections WHERE owner_id = ${ownerId})
        `);

        // 8. Collections (U3c) — all of the owner's, cascading to memberships. Clones survive (SET NULL FK).
        await tx.execute(sql`DELETE FROM collections WHERE owner_id = ${ownerId}`);

        // 9. Author-handle residue (U3b) — scrub the cleartext handle on KEPT rows to the pseudonym. Only
        //    kept rows remain now, so this scopes by owner_id + a non-null handle.
        await tx.execute(sql`
            UPDATE recipes
            SET author_handle = ${pseudonym}, updated_at = now()
            WHERE owner_id = ${ownerId} AND author_handle IS NOT NULL
        `);

        // 10. Editor-handle residue (owner ruling 2026-08-25) — the SAME datum one table over, on the KEPT
        //     recipes' surviving version rows. Keyed on `created_by`, exactly as `handleSyncWorker` keys the
        //     rename fan-out that writes this column.
        await tx.execute(sql`
            UPDATE recipe_versions
            SET editor_handle = ${pseudonym}
            WHERE created_by = ${ownerId} AND editor_handle IS NOT NULL
        `);

        // 11. author_handles read-model root (W8-a.10) — user-keyed, no cascade; delete removes the cleartext.
        await tx.execute(sql`DELETE FROM author_handles WHERE user_id = ${ownerId}`);

        // 12. Parse jobs (plan U8/U9, 0039) — user-keyed rows carrying the cook's PASTED TEXT verbatim
        //     (`recipe_parse_job_lines.source_line` cascades from the job). Deleted outright: proposals
        //     bind nothing (R19), so nothing downstream references a job row and the whole record is the
        //     user's content. ⚠️ This is USER TEXT, not an ingredient phrase — ADR-0027's ruling above does
        //     not cover it, which is why this step exists while 10-12's old sweeps stay removed.
        await tx.execute(sql`DELETE FROM recipe_parse_jobs WHERE owner_id = ${ownerId}`);

        // 13. Private-food catalog rows (plan U11/R20, 0040). The shared `ingredients` catalog carries
        //     `food_owner_id` for the dead author's PRIVATE authored foods; those rows exist only so the
        //     author could bind them. Unreferenced ones are DELETED (nothing needs the name any more);
        //     ones a KEPT public recipe still lines against are RETAINED — the pseudonymous ULID beside a
        //     food NAME is the recipes/owner_id posture, and the search filter hides the row from every
        //     living caller regardless. The DELETE runs AFTER the recipe deletes above, so references from
        //     the erased recipes are already gone.
        await tx.execute(sql`
            DELETE FROM ingredients i
             WHERE i.food_owner_id = ${ownerId}
               AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id)
        `);

        // ⛔ STEPS 10-12 (curated mappings, resolution memos, parse corrections) STOOD HERE AND WERE
        //    REMOVED — owner ruling 2026-08-25, ADR-0027. An ingredient phrase is not private data, so no
        //    statement here targets one, and the `user_id` those two correction tiers still carry is a
        //    DISTINCT-USER COUNTER and an authorization predicate rather than an erasure predicate. See the
        //    function docstring above before adding a fourth sweep to this transaction.

        // 14. Analytics events (analytics plan U2, migration 0043) — ANONYMIZED, never deleted (origin
        //     KD4/AE4). The rows and every folded lifetime count in `recipe_impact_signals` survive; the
        //     person is removed by nulling the actor id AND blanking the typed query text — deliberately
        //     STRICTER than ADR-0027's keep-the-phrase ruling, by decision: the search query is the
        //     user's own words, not a recipe's ingredient phrase. 0043's pair CHECK
        //     (`query_text IS NULL OR user_id IS NOT NULL`) makes that pairing structural, and 0043
        //     ships NO UPDATE trigger, so this statement provably moves no counts (KD6 — counts never
        //     decrement; the recipe-service integration suite is the tripwire). ⛔ Do NOT "fix" this
        //     into a DELETE: it would erase the history SC2 promises 015 and look correct in any test
        //     that only checks for a remaining user id.
        await tx.execute(sql`
            UPDATE analytics_events
            SET user_id = NULL, query_text = NULL
            WHERE user_id = ${ownerId}
        `);

        return { removedRecipeIds };
    });
};

/**
 * Delete every object of ONE removed recipe from one bucket (CR-002 / U3a). Idempotent — an empty prefix
 * yields nothing to delete, which is exactly what a replay over an already-swept recipe should cost.
 *
 * **Scoped per recipe, NOT per owner.** The sweep prefix is {@link recipeMediaPrefix}
 * (`recipes/{ownerId}/{recipeId}/`), not {@link ownerMediaPrefix} — because erasure now KEEPS the owner's
 * truly-public + donated recipes, and sweeping the whole owner prefix would delete a surviving recipe's
 * photos and version archives. The caller invokes this once per removed recipe, per bucket (media, then
 * version-archive), because both buckets key that recipe's objects under the same per-recipe prefix
 * (ARCH-BE-3), by design, so one per-recipe prefix scan reaches everything the recipe owns in that bucket.
 *
 * The `recipeId` guard is safety-critical: a blank `recipeId` would collapse the prefix toward the
 * owner-wide `recipes/{ownerId}/` and sweep KEPT recipes' media, so a blank owner OR recipe is refused.
 *
 * A page is always a safe batch: `ListObjectsV2` returns at most 1000 keys and `DeleteObjects` accepts
 * at most 1000, so the batch can never overflow the API limit.
 *
 * @param client - The S3 client.
 * @param bucket - The bucket to sweep.
 * @param ownerId - The owner whose (removed) recipe is swept.
 * @param recipeId - The removed recipe whose object subtree is swept.
 * @returns The number of objects deleted.
 * @throws {InvalidErasureMessageError} When `ownerId` or `recipeId` is blank — defence in depth. This
 *   function is what actually issues the deletes, so it enforces its own precondition, and a blank
 *   `recipeId` must never widen the sweep into a kept recipe's (or the whole owner's) media.
 * @throws When S3 reports a per-key delete failure — see the `Errors` check below.
 * @sideEffect Deletes objects from S3.
 */
export const eraseRecipeObjects = async (
    client: S3Client,
    bucket: string,
    ownerId: string,
    recipeId: string,
): Promise<number> => {
    if (!isValidOwnerId(ownerId)) {
        throw new InvalidErasureMessageError(`ownerId must be a non-empty string to sweep ${bucket}`);
    }

    if (!isValidOwnerId(recipeId)) {
        throw new InvalidErasureMessageError(`recipeId must be a non-empty string to sweep ${bucket}`);
    }

    const prefix = recipeMediaPrefix(ownerId, recipeId);
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
        const listed = await client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
        );
        const objects = (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [{ Key: entry.Key }] : []));

        if (objects.length > 0) {
            const result = await client.send(
                new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }),
            );

            // `DeleteObjects` is a BATCH api: S3 answers 200 and reports per-key failures in `Errors`
            // rather than raising, so the SDK does not throw. Taking "no exception" for "deleted" would
            // count an object still sitting in the bucket as erased and let the job be marked
            // `completed` — a false erasure with no signal anywhere. The throw sends the record back to
            // SQS, where a transient failure retries and a persistent one (e.g. an object-lock or a
            // policy denial) surfaces in the DLQ instead of being papered over.
            if (result.Errors && result.Errors.length > 0) {
                const [first] = result.Errors;

                throw new Error(
                    `account-erasure-worker: S3 failed to delete ${result.Errors.length} of ${objects.length} object(s) ` +
                        `from ${bucket} under ${prefix} — first failure: ${first?.Key} (${first?.Code}: ${first?.Message})`,
                );
            }

            deleted += objects.length;
        }

        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
};

/** The two buckets an owner's objects live in — both keyed under the same owner prefix (ARCH-BE-3). */
interface ErasureBuckets {
    readonly media: string;
    readonly archive: string;
}

const processRecord = async (record: SQSRecord, buckets: ErasureBuckets, cdn: CdnInvalidationPort): Promise<void> => {
    const { ownerId } = parseErasureMessage(record);
    const db = getRecipeDb();

    const job = await claimErasureJob(db, ownerId);

    // Interlock (defense in depth behind the per-stage queue topology): the destructive work requires that
    // THIS database hold a bookkeeping row for the owner. A claim (active row) authorizes it directly; a
    // claim that returned nothing is authorized ONLY if a row still exists in another status (a
    // completed/failed replay). Zero rows means the message was MISROUTED to the wrong database — refuse to
    // delete a non-requesting user's data. This preserves idempotent completed-replay (which finds its row)
    // while removing queue topology as the sole thing standing between a stray message and irreversible
    // deletion.
    //
    // ⛔ REFUSE AND FAIL, never refuse and acknowledge. A `return` here was a false success on the GDPR path:
    // SQS treats it as done, so the request is neither retried nor surfaced. See
    // `MisroutedErasureMessageError` for why the throw is the whole point.
    if (!job && !(await erasureJobExistsForOwner(db, ownerId))) {
        logger.warn('account-erasure-worker: no erasure job for owner in this database — refusing to erase', {
            ownerId,
        });

        throw new MisroutedErasureMessageError(ownerId);
    }

    try {
        // The data work past this interlock is deliberately NOT gated on having CLAIMED a job (only on a row
        // existing): erasure is owner-scoped and idempotent, so a completed replay costs only a few zero-row
        // statements and (now) an empty removed-set with nothing to sweep — and it guarantees no anomaly in
        // the bookkeeping can let an authorized message be acked without the erasure having been attempted.
        //
        // The DONATE election comes from the durable ROW the claim read back (U3b), never the SQS message:
        // the row is the source of truth, so a stale/forged/empty message can neither delete a donated
        // recipe nor donate one the owner did not elect. A completed replay has no active row to claim, and
        // by then the flip is moot (donated recipes are already public+published), so [] is correct there.
        const election = job?.publishRecipeIds ?? [];

        const { removedRecipeIds } = await eraseRecipeRows(db, ownerId, election);

        // Crash-convergence (U3a): on a FRESH attempt the erase transaction returned the real removed set;
        // on a REDELIVERY after the rows were already deleted it returns empty, so fall back to the set
        // captured on the still-`running` row by the first attempt. Either way this is the exact set of
        // recipes whose media must be swept — never the owner-wide prefix, which would delete kept media.
        const sweepRecipeIds = removedRecipeIds.length > 0 ? removedRecipeIds : (job?.removedRecipeIds ?? []);

        // Scoped, per-removed-recipe sweep (U3a): both buckets, per recipe, so truly-public + donated media
        // survive. Both buckets resolved up-front (see handler), so a per-recipe media sweep never runs
        // without knowing the archive bucket it must also sweep.
        let deletedMedia = 0;
        let deletedArchives = 0;

        for (const recipeId of sweepRecipeIds) {
            deletedMedia += await eraseRecipeObjects(s3, buckets.media, ownerId, recipeId);
            deletedArchives += await eraseRecipeObjects(s3, buckets.archive, ownerId, recipeId);
        }

        // HAZ-051/067/039: purge the CloudFront edge cache for the owner's media prefix so a stale edge
        // object cannot keep serving a REMOVED recipe's photos after the S3 origin copies are gone — photos
        // are served UNSIGNED/public via CDN (photos.module.ts), so without this a removed recipe's media
        // stays reachable until the cached object's TTL expires. ONE owner-prefix wildcard path, not one per
        // removed recipe: it costs the same single path regardless of how many recipes were removed, and
        // over-purging a KEPT recipe's edge cache is harmless — the object still lives at the S3 origin, so
        // the next request simply re-fetches and re-caches it (no data loss, no exposure). The archive
        // bucket is NOT invalidated — version snapshots are never served via CDN.
        //
        // Issued LAST, strictly AFTER both S3 sweeps — a CDN purge is a best-effort edge-cache hygiene
        // step, not data deletion, and it must never GATE data deletion. The archive bucket holds full
        // recipe-version snapshots (complete user PII) and has to be swept unconditionally. Putting the
        // invalidation between the two sweeps — the prior, incorrect order — meant a misconfigured or
        // cross-account distribution id (an `AccessDenied` that fails identically on every retry) would
        // throw before the archive sweep ever ran, permanently orphaning that bucket's PII on every
        // attempt up to the DLQ: a CDN misconfiguration turning into a GDPR-erasure failure. Ordering it
        // last means a CDN failure leaves only the bounded, self-healing edge-cache residual (the object's
        // TTL) — every real copy of the user's data is already gone by the time this call is reached.
        //
        // Issued on EVERY attempt, not gated on `deletedMedia > 0`: a retry (SQS redelivery after an
        // earlier attempt died before this call) must still submit the invalidation even though the media
        // sweep now finds nothing left to delete — the sweep is idempotent over an empty prefix, and a
        // wildcard invalidation costs the same ONE path regardless of retry count, so gating it here would
        // silently let a genuinely-failed-and-retried invalidation never get resent.
        //
        // A failure here still throws — exactly like a failed `eraseRecipeObjects` call — and is caught
        // below, recorded as a non-terminal error, and rethrown for SQS to redeliver. The job can never be
        // marked `completed` while the CDN purge REQUEST has not been successfully submitted, but — unlike
        // before this fix — that requirement no longer holds the ACTUAL data deletion hostage: both S3
        // sweeps have already run by the time this can fail. This stops short of confirming the
        // invalidation has PROPAGATED to every edge location (CreateInvalidation is asynchronous and can
        // take minutes; polling it to completion inside a single Lambda invocation is not how any other
        // step here works either) — see hazard-analysis.md's HAZ-051/067 mitigation text for the honest
        // residual this leaves.
        await cdn.invalidate([cdnOwnerPrefixInvalidationPath(ownerId)]);

        if (job) {
            await markErasureJobCompleted(db, job.id);
        }

        logger.info('recipe account data erased', {
            ownerId,
            jobId: job?.id ?? null,
            deletedMedia,
            deletedArchives,
        });
    } catch (error) {
        if (job) {
            try {
                await recordErasureJobError(db, job.id, error);
            } catch (annotationError) {
                // Best-effort telemetry: masking the real cause with the annotation's own failure would
                // send whoever is paged chasing the wrong error.
                logger.error('account-erasure-worker: could not record job error', {
                    ownerId,
                    jobId: job.id,
                    error: annotationError instanceof Error ? annotationError.message : String(annotationError),
                });
            }
        }

        throw error;
    }
};

export const handler: SQSHandler = async (event) => {
    // Both resolved up-front: discovering a missing archive bucket only at the second sweep would leave
    // the rows and the media already gone, with the version archives both unreachable and unswept.
    const buckets: ErasureBuckets = {
        media: requireEnv('RECIPE_MEDIA_BUCKET'),
        archive: requireEnv('RECIPE_ARCHIVE_BUCKET'),
    };
    // Built per invocation (not module-level like `s3`, which needs no dynamic config): the distribution
    // id is genuinely optional and stage-specific, and reading it lazily here — rather than once at
    // module import — keeps the env read ordinary and testable instead of tangled in ESM import-hoisting
    // timing. See `common/cdnInvalidation.ts` for the unset-id no-op contract.
    const cdn = createCloudFrontInvalidation({ distributionId: process.env['CLOUDFRONT_DISTRIBUTION_ID'] });

    logger.info('account-erasure-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record, buckets, cdn);
    }
};
