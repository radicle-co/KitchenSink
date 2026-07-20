import type { SQSHandler, SQSRecord } from 'aws-lambda';

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ownerMediaPrefix, type AccountErasureMessage } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import { isValid as isValidUlid } from 'ulidx';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/**
 * SQS-triggered account-erasure worker (GDPR right-to-erasure, C-007 / D7). Hard-deletes every row a
 * user owns from the shared RDS `kitchensink_recipes` database and every object they own from BOTH S3
 * buckets, then marks their `account_erasure_jobs` row `completed`. VPC-attached DB consumer.
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
 *      dies mid-erasure is still counted.
 *   2. Delete the DB rows in ONE transaction — the reachable copy of the personal data goes first.
 *   3. Sweep the owner's prefix in the media bucket, then the archive bucket.
 *   4. Only then mark the job `completed`.
 *
 * Crash between (2) and (3) and the objects are briefly orphaned, but nothing is lost and nothing is
 * falsely reported: the job is still `running`, SQS redelivers, and the sweep converges because it is
 * driven by the owner's S3 *prefix*, never by `recipe_photos.s3_key` rows. That prefix-independence is
 * what frees the rows to go first. (data-model.md prescribes the opposite order, but that text predates
 * the ARCH-BE-3 key scheme: when keys were `photos/{recipe_id}/` they had to be enumerated FROM the
 * rows, which forced S3 first. Owner-prefixed keys removed the constraint.)
 *
 * **Failure is never terminal here.** See {@link recordErasureJobError} — the single most consequential
 * decision in this file.
 */

/**
 * The message contract — re-exported from `@kitchensink/recipe-core` rather than declared here, and kept
 * exported because this module's tests and callers already address it here.
 *
 * It moved out for the same reason {@link ownerMediaPrefix} did: it now has a PRODUCER in another package
 * (`recipe-service`'s `ErasureService` enqueues on `POST /v1/account/erasure`) as well as this consumer,
 * and a wire contract that each side declares its own copy of is a contract that drifts. One definition,
 * imported by both.
 *
 * It carries no `jobId`, deliberately: `idx_erasure_jobs_active_owner` makes "the active job for this
 * owner" unique in the database, so {@link claimErasureJob} can resolve it from `ownerId` alone.
 */
export type { AccountErasureMessage };

/**
 * Raised when an SQS body is not a usable erasure instruction. Matching guard:
 * {@link isInvalidErasureMessageError}.
 */
export class InvalidErasureMessageError extends Error {
    constructor(reason: string) {
        super(`account-erasure-worker: invalid erasure message — ${reason}`);
        this.name = 'InvalidErasureMessageError';
        Object.setPrototypeOf(this, InvalidErasureMessageError.prototype);
    }
}

/** Type guard for {@link InvalidErasureMessageError}. */
export const isInvalidErasureMessageError = (error: unknown): error is InvalidErasureMessageError =>
    error instanceof InvalidErasureMessageError;

/**
 * The claimed `account_erasure_jobs` row this invocation is accountable for.
 *
 * A `type` rather than an `interface` so it carries the implicit index signature Drizzle's
 * `execute<T>` requires of a row shape — the same reason `version-archive-worker` declares its row
 * types this way.
 */
export type ErasureJobClaim = {
    readonly id: string;
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

    return { ownerId: body.ownerId, requestedAt: String(body.requestedAt) };
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
        RETURNING id
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
 * guard). Only the misrouted case must skip erasure; the replay must still run its idempotent no-op. This
 * existence check is what tells them apart, so a message can only ever destroy data the local DB has a
 * record authorizing.
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

/**
 * Hard-delete every `kitchensink_recipes` row the owner owns, atomically.
 *
 * **No `deleted_at` filter, deliberately.** Tombstoned recipes are erased too: retention is not
 * reachability, and a soft-deleted recipe still holds the user's data. Adding the read path's habitual
 * `deleted_at IS NULL` here would silently leave every tombstoned recipe — and, by cascade, its
 * versions, photos, steps and ingredients — behind on a right-to-erasure request, while reporting
 * success. This function is the explicit exemption data-model.md carves out of the read-path rule.
 *
 * **Why the clone detach comes first.** `recipes.cloned_from_id → recipes.id` has no `ON DELETE` clause,
 * so it is `NO ACTION` and not deferrable (confirmed against the live `pg_constraint` catalog). Another
 * user's clone pointing at this owner's recipe therefore makes the delete throw
 * `recipes_cloned_from_id_fkey` — erasure would fail in production the first time anyone had cloned the
 * user's recipe. So other owners' pointers are NULLed first: their recipes survive, their provenance
 * link does not (data-model.md §Hard purge — descendants unaffected, without leaking the source).
 * `idx_recipes_cloned_from` exists to make that scan cheap.
 *
 * The detach is scoped `owner_id <> ownerId` so it touches ONLY other users' rows. This owner's own
 * clones of their own recipes need no detach: they are removed by the same statement that removes their
 * source, and a non-deferrable NO ACTION check runs at end-of-statement, by which point the referencing
 * row is already gone. (Verified against Postgres 16: one delete covering an active recipe, a tombstone,
 * and a self-referencing clone succeeds.)
 *
 * **The ratings root is swept explicitly — the schema CANNOT cover it (CR-001 / FR-013b).** A rating is
 * authored by its RATER, so `recipe_ratings.user_id` is a third owner-scoped erasure root, and the only
 * one that routinely lives on OTHER users' (surviving) recipes. `recipe_id` CASCADEs, so the ratings on
 * the erased owner's OWN recipes go with those recipes — but the owner's ratings on everyone ELSE's
 * recipes cascade from nothing and would silently survive a right-to-erasure request. So this sweeps them
 * explicitly, `DELETE FROM recipe_ratings WHERE user_id = ownerId` (using `idx_recipe_ratings_user_id`),
 * FIRST in the transaction. That bulk delete fires the STATEMENT-LEVEL aggregate trigger exactly ONCE,
 * which re-derives `average_rating` / `rating_count` on every affected surviving recipe. The trigger MUST
 * NOT be disabled for speed: doing so would leave other users' recipes holding permanently wrong
 * aggregates with nothing to repair them — and it is not needed, since one firing covers the whole delete.
 *
 * **Everything else is the schema's job.** `recipe_steps`, `recipe_ingredients`, `recipe_photos`,
 * `recipe_versions`, `recipe_collections`, `recipe_version_pending_archives`, and the ratings on the
 * owner's OWN recipes all cascade from `recipes.id`; `recipe_collections` also cascades from
 * `collections.id`; and other users' cloned collections have their `source_collection_id` SET NULL by the
 * FK itself. Re-deleting any of those by hand would be dead SQL duplicating the cascade graph, and would
 * rot the day the schema changed — the schema is the one authority for it. The table deliberately left
 * untouched is `ingredients`: a shared global dedup table with no owner column, referenced by every other
 * user's recipes.
 *
 * `recipe_versions.created_by` is likewise not swept independently. Mutations are owner-only
 * (`VersionsService` rejects a non-owner) and `createdBy` is always the authenticated caller, so
 * `created_by` cannot diverge from its recipe's `owner_id`, and the cascade already covers it. A
 * "defensive" `DELETE FROM recipe_versions WHERE created_by = $1` would not be defensive: if that
 * invariant ever DID break, it would destroy version history belonging to a user who never asked to be
 * erased. Leaving a row is recoverable; deleting someone else's is not.
 *
 * One transaction, because a detach that committed without its delete would strip a non-requesting
 * user's provenance permanently, for nothing.
 *
 * @param db - The recipe database handle.
 * @param ownerId - The owner being erased.
 * @sideEffect Deletes rows from RDS, cascading to every child table above.
 */
export const eraseRecipeRows = async (db: NodePgDatabase<Record<string, never>>, ownerId: string): Promise<void> => {
    await db.transaction(async (tx) => {
        // The third owner-scoped root (CR-001 / FR-013b): the owner's ratings on OTHER users' recipes,
        // which survive. FIRST, so the statement-level aggregate trigger re-derives every affected
        // survivor's average/count in one firing while those recipes still exist. Ratings on the owner's
        // OWN recipes are handled by the recipes cascade below (their recipe ceases to exist).
        await tx.execute(sql`DELETE FROM recipe_ratings WHERE user_id = ${ownerId}`);

        await tx.execute(sql`
            UPDATE recipes
            SET cloned_from_id = NULL, updated_at = now()
            WHERE cloned_from_id IN (SELECT id FROM recipes WHERE owner_id = ${ownerId})
              AND owner_id <> ${ownerId}
        `);

        await tx.execute(sql`DELETE FROM recipes WHERE owner_id = ${ownerId}`);

        await tx.execute(sql`DELETE FROM collections WHERE owner_id = ${ownerId}`);

        // The FOURTH owner-scoped root (W8-a.2 / W8-a.10): the author_handles read model is keyed by
        // user_id and has NO FK to recipes/collections, so nothing cascades it — it must be swept
        // explicitly, or an erased user's display name would survive right-to-erasure in this table.
        await tx.execute(sql`DELETE FROM author_handles WHERE user_id = ${ownerId}`);
    });
};

/**
 * Delete every object under the owner's prefix from one bucket. Idempotent — an empty prefix yields
 * nothing to delete, which is exactly what a replay over an already-erased owner should cost.
 *
 * Called once per bucket (media, then version-archive) rather than being made bucket-aware, because the
 * sweep IS the same operation: both buckets key an owner's objects under the same
 * {@link ownerMediaPrefix} (ARCH-BE-3), by design, precisely so one prefix scan reaches everything.
 *
 * A page is always a safe batch: `ListObjectsV2` returns at most 1000 keys and `DeleteObjects` accepts
 * at most 1000, so the batch can never overflow the API limit.
 *
 * @param client - The S3 client.
 * @param bucket - The bucket to sweep.
 * @param ownerId - The owner whose prefix is swept.
 * @returns The number of objects deleted.
 * @throws {InvalidErasureMessageError} When `ownerId` is blank — defence in depth behind
 *   {@link parseErasureMessage}. This function is what actually issues the deletes, so it enforces its
 *   own precondition rather than trusting every future caller to have parsed first.
 * @throws When S3 reports a per-key delete failure — see the `Errors` check below.
 * @sideEffect Deletes objects from S3.
 */
export const eraseRecipeObjects = async (client: S3Client, bucket: string, ownerId: string): Promise<number> => {
    if (!isValidOwnerId(ownerId)) {
        throw new InvalidErasureMessageError(`ownerId must be a non-empty string to sweep ${bucket}`);
    }

    const prefix = ownerMediaPrefix(ownerId);
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

const processRecord = async (record: SQSRecord, buckets: ErasureBuckets): Promise<void> => {
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
    if (!job && !(await erasureJobExistsForOwner(db, ownerId))) {
        logger.warn('account-erasure-worker: no erasure job for owner in this database — refusing to erase', {
            ownerId,
        });

        return;
    }

    try {
        // The data work past this interlock is deliberately NOT gated on having CLAIMED a job (only on a row
        // existing): erasure is owner-scoped and idempotent, so a completed replay costs only a few zero-row
        // statements and two empty prefix listings — and it guarantees no anomaly in the bookkeeping can let
        // an authorized message be acked without the erasure having been attempted.
        await eraseRecipeRows(db, ownerId);

        const deletedMedia = await eraseRecipeObjects(s3, buckets.media, ownerId);
        const deletedArchives = await eraseRecipeObjects(s3, buckets.archive, ownerId);

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

    logger.info('account-erasure-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record, buckets);
    }
};
