import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AccountErasureMessage } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';
import { emitMetric } from '../common/metrics.js';

/**
 * Scheduled account-erasure sweeper (T136b / C-007 / D7) — the durability backstop behind
 * `POST /v1/account/erasure`, and the owner of the decision to give up. VPC-attached DB consumer.
 *
 * **It is not the archive sweeper with the nouns swapped.** The archive sweeper is its path's ONLY
 * trigger, so it dispatches every due row on sight, every minute. Erasure inverts that: `ErasureService`
 * sends eagerly on the request, so a healthy job is claimed and completed within seconds and this sweeper
 * never sees it. What this sweeper exists for is the job the eager send never reached — an SQS outage at
 * request time, a message lost, a worker that died between claim and completion. That makes it a
 * backstop, and a backstop that re-fires on sight is a stampede: the worker runs up to five minutes, so
 * re-dispatching every in-flight job each tick would put a second worker on an owner the first is still
 * erasing. Idempotent, but pure lock contention on `DELETE FROM recipes` plus a duplicate S3 prefix sweep.
 * Hence {@link STALE_AFTER} — a job is only re-dispatched once it has stopped making progress.
 *
 * **The archive sweeper's `next_attempt_at` has no counterpart here.** `recipe_version_pending_archives`
 * carries an explicit backoff column; `account_erasure_jobs` does not, so the backoff is synthesized from
 * `updated_at` — which every step of the worker touches (claim, error-record, completion). A job making
 * progress therefore looks fresh and is skipped, for free, with no extra column.
 *
 * **The give-up decision lives here** — see {@link abandonExhaustedJob}. The worker deliberately never
 * writes `failed`; it records the error and rethrows, leaving retry to SQS and recovery to this sweeper.
 */

/** The `account_erasure_jobs` columns one re-drain needs (raw — this Lambda has no Drizzle schema). */
export type StaleErasureJobRow = {
    readonly id: string;
    /** The app-user ULID being erased — the entire message contract. */
    readonly owner_id: string;
    /**
     * The DONATE election (CR-002 / U3b) persisted on the row — the recipe ids the owner elected to
     * publish. Re-drained INTO the reconstructed message so a job recovered from the durable row (after
     * its eager message was lost) still carries the election. `null` on a pre-election row ⇒ donate none.
     */
    readonly publish_recipe_ids: string[] | null;
    /** Claims so far. The worker increments this on every claim, including the ones that then died. */
    readonly attempts: number;
    /**
     * Seconds since THIS job row was created. Per-job and immune to cross-generation counter inflation, so
     * it is the give-up age floor (see {@link ERASURE_GIVE_UP_ATTEMPTS}): a fresh job re-POSTed after a
     * failure has its own `created_at`, so its age reflects only its own time stuck.
     */
    readonly age_seconds: number;
};

const sqs = new SQSClient({});

/** How many jobs one tick handles. Bounds the Lambda's runtime; the next tick takes the rest. */
const SWEEP_BATCH_SIZE = 100;

/**
 * How long a job must sit without progress before this sweeper re-dispatches it.
 *
 * Sized off the queue, not off a feeling: the erasure queue's visibility timeout is 6 minutes, so SQS's
 * own retry gets **two full attempts** inside this window before the sweeper adds a message of its own.
 * That is the correct relationship for a backstop — it covers for SQS having lost the message, it does
 * not race SQS's redelivery. Shrinking it below ~12 minutes re-introduces the duplicate-worker stampede
 * the eager-send design does not need.
 */
const STALE_AFTER = '15 minutes';

/**
 * Claims after which a job is abandoned to `failed` rather than re-dispatched forever.
 *
 * **This constant is the give-up policy, so the arithmetic behind it matters.** The queue's
 * `maxReceiveCount` is 5 and its visibility timeout is 6 minutes, so ONE message yields at most 5 claims
 * over ~30 minutes before SQS routes it to the DLQ — which fires the DLQ alarm. 10 therefore means two
 * complete DLQ cycles: roughly an hour of real retrying, across two independently-dispatched messages,
 * with a human already paged from the first. A job that has burned that is not failing transiently.
 *
 * The property worth keeping if this is ever retuned: **it must exceed `maxReceiveCount`**, so that a
 * `failed` job always has a DLQ message (and therefore an alarm) behind it. `failed` is never the first
 * anyone hears of a broken erasure.
 */
export const ERASURE_GIVE_UP_ATTEMPTS = 10;

/**
 * The give-up AGE floor (seconds): a job is abandoned only once it is BOTH attempts-exhausted AND this old.
 *
 * `attempts` alone is not a safe give-up trigger, because it is not per-job. The message carries only
 * `ownerId` (by design — {@link toErasureMessage}), so `claimErasureJob` increments the counter on whatever
 * row is active for the owner. After a job fails and the user re-POSTs, a FRESH row is created; the old
 * cycle's still-in-flight messages then redeliver and claim the fresh row, inflating ITS `attempts` for work
 * that has nothing to do with it. On `attempts` alone, that fresh job could cross {@link
 * ERASURE_GIVE_UP_ATTEMPTS} after only a few of its OWN real attempts and be abandoned prematurely.
 *
 * The fix is a floor on the job's OWN age (`created_at`), which no cross-generation message can move: a job
 * is abandoned only after both signals agree. 1 hour matches the wall-clock the attempts arithmetic was
 * meant to represent (two full DLQ cycles), and — crucially — comfortably exceeds one `maxReceiveCount`
 * DLQ cycle (~30 min), so the "a `failed` job always has a DLQ message + alarm behind it" invariant holds:
 * a job this old with exhausted attempts has genuinely burned its retries.
 */
export const ERASURE_GIVE_UP_AGE_SECONDS = 3600;

/** Alarm threshold's unit: the age metric is seconds, emitted every tick (0 when idle). */
const ERASURE_METRIC_NAMESPACE = 'Commise/RecipeErasure';

/**
 * Shape a job row into the worker's message contract.
 *
 * @param row - The stale job to re-dispatch.
 * @param requestedAt - ISO 8601 dispatch time.
 * @returns The message body. Pure.
 */
export function toErasureMessage(row: StaleErasureJobRow, requestedAt: string): AccountErasureMessage {
    // Owner-scoped, no `jobId` — `idx_erasure_jobs_active_owner` makes the active job for an owner unique,
    // so the worker resolves the job FROM the owner id. A jobId on the wire would let a redelivered
    // message name a job that is no longer the active one.
    //
    // The DONATE election is reconstructed from the durable row (CR-002 / U3b): the eager message this
    // sweeper is BACKSTOPPING was lost, so its election would be lost too if we re-sent an empty one —
    // silently converting the owner's "publish these" into "delete everything". The row is the source of
    // truth, so it is carried back onto the wire. (The worker also reads the election from the row it
    // claims, so this is belt-and-braces; but a message that lies about the election must never exist.)
    return { ownerId: row.owner_id, requestedAt, publishRecipeIds: row.publish_recipe_ids ?? [] };
}

/**
 * Read the in-flight jobs that have stopped making progress.
 *
 * Scoped to exactly the set `idx_erasure_jobs_status` covers (`status IN ('queued','running')`), further
 * narrowed to jobs untouched for {@link STALE_AFTER}. Ordered oldest-first so the longest-waiting
 * right-to-erasure request is served before a fresher one when the batch is capped.
 *
 * @param db - The recipe database handle.
 * @returns The stale in-flight jobs, oldest first.
 * @sideEffect Reads `account_erasure_jobs`.
 */
export async function claimStaleErasureJobs(db: NodePgDatabase<Record<string, never>>): Promise<StaleErasureJobRow[]> {
    const result = await db.execute<StaleErasureJobRow>(sql`
        SELECT id, owner_id, publish_recipe_ids, attempts,
               EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds
        FROM account_erasure_jobs
        WHERE status IN ('queued', 'running')
          AND updated_at <= now() - interval '${sql.raw(STALE_AFTER)}'
        ORDER BY created_at ASC
        LIMIT ${SWEEP_BATCH_SIZE}
    `);

    return [...result.rows];
}

/**
 * The age, in seconds, of the OLDEST outstanding erasure job — 0 when none is outstanding.
 *
 * Counted separately from {@link claimStaleErasureJobs}, and the separation is load-bearing twice over:
 *
 *  1. That read is capped at {@link SWEEP_BATCH_SIZE} and filtered to stale jobs. Deriving the signal
 *     from it would both cap the metric and hide the 59-minute job that is still being retried normally —
 *     precisely the job about to breach. This query is unbounded and unfiltered by staleness.
 *  2. **Age, not count, is the right metric for erasure.** The archive path alarms on a backlog over 100
 *     because 100 un-archived versions is a meaningful backlog. There will never be 100 concurrent
 *     erasure jobs, so a count threshold would sit unfirable forever — the same never-fires bug as a
 *     batch-capped backlog, in different clothes. ONE erasure stuck for an hour IS the incident.
 *
 * @param db - The recipe database handle.
 * @returns Seconds since the oldest in-flight job was created, or 0.
 * @sideEffect Reads `account_erasure_jobs`.
 */
export async function oldestActiveJobAgeSeconds(db: NodePgDatabase<Record<string, never>>): Promise<number> {
    const result = await db.execute<{ age_seconds: number }>(sql`
        SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at))), 0)::int AS age_seconds
        FROM account_erasure_jobs
        WHERE status IN ('queued', 'running')
    `);

    return result.rows[0]?.age_seconds ?? 0;
}

/**
 * Publish the oldest-job age as a CloudWatch metric via the embedded metric format.
 *
 * Emitted because the age is a database fact, invisible to CloudWatch otherwise — without it the alarm
 * would have no data and sit permanently in INSUFFICIENT_DATA. The EMF envelope itself lives once in
 * {@link emitMetric}; this only supplies the erasure-specific namespace, name, and unit.
 *
 * @param stage - The deploy stage (the metric's only dimension).
 * @param ageSeconds - Age of the oldest in-flight job, or 0.
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitOldestJobAgeMetric(stage: string, ageSeconds: number): void {
    emitMetric({
        namespace: ERASURE_METRIC_NAMESPACE,
        name: 'OldestErasureJobAgeSeconds',
        unit: 'Seconds',
        stage,
        value: ageSeconds,
    });
}

/**
 * Mark a job `failed` — the transition NOTHING else in the system performs.
 *
 * **This is the resolution of the question the worker escalated, so the reasoning is recorded in full.**
 * `account-erasure-worker.recordErasureJobError` deliberately never writes `failed`: one attempt failing
 * is not the job failing, and a worker that marked `failed` in its catch would drop the job out of the
 * `queued`/`running` set this sweeper re-drains — abandoning a legal request after a single blip. That
 * reasoning is right, and it makes `failed` *someone else's* decision rather than nobody's. It is this
 * sweeper's, for three reasons:
 *
 *  1. **The row is the authority, not the message.** Every other decision in this path is driven by the
 *     durable row (the archive outbox, the eager-send-is-optional design, the give-up evidence in
 *     `attempts`). A DLQ-subscribed Lambda would invert that, letting a dead *message* decide the fate of
 *     a *row* — and it is the alternative that looks most obvious, which is why it is worth naming.
 *  2. **A DLQ Lambda cannot reliably identify the job it is about.** The message carries only `ownerId`
 *     (correctly — see {@link toErasureMessage}). Duplicate dispatch is expected by design, so two
 *     messages for one owner can both exhaust their retries; the second DLQ arrival would find, and
 *     wrongly fail, the FRESH job the user queued after the first one failed. This sweeper reads jobs,
 *     not messages: it sees `(id, attempts)` and updates BY id, so no such ambiguity exists.
 *  3. **It makes a documented path live.** data-model.md's C-007 contract says a fresh POST after a
 *     `failed` job returns 202 and enqueues a retry. If nothing ever writes `failed`, that branch is dead
 *     code and a permanently-broken erasure answers 202 forever with a job id that will never finish —
 *     the user cannot re-ask, and only an operator can unstick it. Writing `failed` frees
 *     `idx_erasure_jobs_active_owner` and hands the user back their agency.
 *
 * The `status IN ('queued','running')` guard closes the read→update window: the worker can complete the
 * job between {@link claimStaleErasureJobs} and this update, and flipping a `completed` erasure to
 * `failed` would turn a lawful 410 into a 202 that re-runs an erasure for a user whose data is already
 * gone — corrupting the compliance record to boot.
 *
 * @param db - The recipe database handle.
 * @param job - The exhausted job.
 * @sideEffect Updates `account_erasure_jobs`.
 */
export async function abandonExhaustedJob(
    db: NodePgDatabase<Record<string, never>>,
    job: StaleErasureJobRow,
): Promise<void> {
    await db.execute(sql`
        UPDATE account_erasure_jobs
        SET status = 'failed',
            last_error = ${`Abandoned by the erasure sweeper after ${job.attempts} attempts; see the account-erasure DLQ.`},
            updated_at = now()
        WHERE id = ${job.id} AND status IN ('queued', 'running')
    `);
}

/**
 * Re-drain every stuck erasure job, and abandon the ones that have exhausted their attempts.
 *
 * @throws {MissingConfigError} When `ACCOUNT_ERASURE_QUEUE_URL` is unset — sweeping into the void would
 *   report success while every recovered job went nowhere.
 * @sideEffect Reads/updates `account_erasure_jobs`, sends SQS messages, emits one EMF line.
 */
export const handler = async (): Promise<void> => {
    const queueUrl = requireEnv('ACCOUNT_ERASURE_QUEUE_URL');
    const db = getRecipeDb();

    // Emitted every tick, including when idle — a metric that only appears while broken cannot be alarmed
    // on reliably (the alarm flaps into INSUFFICIENT_DATA the moment things recover).
    const ageSeconds = await oldestActiveJobAgeSeconds(db);
    emitOldestJobAgeMetric(process.env['STAGE'] ?? 'unknown', ageSeconds);

    const jobs = await claimStaleErasureJobs(db);

    if (jobs.length === 0) {
        return;
    }

    const requestedAt = new Date().toISOString();
    let redispatched = 0;
    let abandoned = 0;

    for (const job of jobs) {
        // Per-job try/catch, never per-batch: one owner's throttled send or deadlocked update must not
        // strand another owner's right-to-erasure request. A job that errors here keeps its row and the
        // next tick picks it up again — the row-as-truth design is what makes that safe.
        try {
            // Give up only when BOTH signals agree: the counter is exhausted AND the job's OWN age is past
            // the floor. `attempts` alone is not per-job (see ERASURE_GIVE_UP_AGE_SECONDS), so a fresh
            // re-POSTed job whose counter was inflated by a prior cycle's stale messages is re-dispatched to
            // earn its own retries rather than abandoned prematurely.
            if (job.attempts >= ERASURE_GIVE_UP_ATTEMPTS && job.age_seconds >= ERASURE_GIVE_UP_AGE_SECONDS) {
                await abandonExhaustedJob(db, job);
                abandoned += 1;
                logger.error('erasure-sweeper: abandoned an erasure job after exhausting its attempts', {
                    jobId: job.id,
                    ownerId: job.owner_id,
                    attempts: job.attempts,
                });
                continue;
            }

            await sqs.send(
                new SendMessageCommand({
                    QueueUrl: queueUrl,
                    MessageBody: JSON.stringify(toErasureMessage(job, requestedAt)),
                }),
            );
            redispatched += 1;
        } catch (error) {
            logger.error('erasure-sweeper: could not process a stuck erasure job', {
                jobId: job.id,
                ownerId: job.owner_id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    logger.info('erasure-sweeper swept', { stale: jobs.length, redispatched, abandoned, oldestAgeSeconds: ageSeconds });
};
