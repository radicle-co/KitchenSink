import type { Context, ScheduledEvent } from 'aws-lambda';
import { and, eq, isNull, lte } from 'drizzle-orm';

import { providerDeletionIsOwed } from '@kitchensink/identity-core';
import { users, type UserId } from '@kitchensink/identity-db';

import { getConfig, getErasureFanoutConfig } from '../config/env.js';
import { withDb, type DbContext } from '../common/handlerPipeline.js';
import { enqueueErasure } from '../common/erasureEnqueue.js';
import { runErasureFanout, type ErasureFanoutResult } from '../common/erasureFanout.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';

/**
 * The **erasure completion contract** reconciliation sweep (CR-002 / U4b / R7). DISTINCT from the
 * provisioning `reconciliation.ts` (Clerk↔DB drift): this sweep is the detective + corrective control for
 * the three-leg erasure. An identity that reached `status='erased'` must have its recipe + food legs
 * jointly complete; a lost/stuck leg must NEVER leave a silently half-erased account.
 *
 * An erasure has THREE legs, not two: the identity provider's account (Clerk), recipe, and food. The recipe and food
 * legs are checked by re-driving them; the Clerk leg is checked by the durable fact `users.provider_deleted_at`
 * ("Clerk confirmed this account no longer exists"), which the deletion worker, the `user.deleted` webhook and the
 * tombstone sweep write. A self-service erasure scrubs the row first and the worker deletes the account afterwards,
 * so a lost or dead-lettered message used to leave a LIVE Clerk account behind a row reported as erased. A row with
 * no confirmation is therefore an incomplete leg: this sweep RE-ENQUEUES an `erasure` message (the deletion worker
 * stays the ONLY Clerk mutator, so the Clerk secret stays out of this Lambda), counts it into `ErasureIncomplete`,
 * and neither fans out nor stamps `reconciled_at` until the worker has confirmed. A CHECK on the table makes
 * "reconciled while the provider account may be alive" unstorable.
 *
 * For each erased identity whose provider deletion is confirmed (correlation key = the owner ULID, the SAME
 * `users.id` recipe/food key by), it RE-DRIVES the idempotent recipe + food internal-erasure legs via
 * {@link runErasureFanout}. The re-drive
 * is authoritative-idempotent — recipe returns `completed` (or re-creates a lost job), food deletes any
 * residual `fetch_requesters` rows (or 0) — so this sweep both HEALS an incomplete erasure and detects it:
 * a leg that is non-terminal, reports residual work, errored, or is unreachable is counted into the
 * `ErasureIncomplete` metric the CloudWatch alarm watches.
 *
 * A grace window ({@link RECONCILE_GRACE_MS}) excludes freshly-erased rows whose legs are legitimately
 * still draining, so a normal in-flight erasure is not false-flagged.
 *
 * **Bounding the sweep (the working set, not the whole population).** The grace window only trims the
 * *front* of the queue; without a completion marker the sweep would re-drive EVERY `erased` identity every
 * night forever, so the nightly cost grows without bound as the erased population accumulates. The bound is
 * a durable **`users.reconciled_at`** stamp, written the first night BOTH legs verify jointly complete
 * ({@link isErasureComplete}); the scan then filters `reconciled_at IS NULL`, so a fully-reconciled identity
 * is swept exactly once and dropped thereafter. This is deliberately NOT a time window on the erasure
 * timestamp: a window would stop re-driving a genuinely STUCK leg once it aged out — silently dropping it
 * from the `ErasureIncomplete` signal, the exact half-erased-forever failure this control exists to catch.
 * A stuck identity is never stamped, so it stays in the scan every night and keeps feeding the alarm; only
 * a proven-complete one leaves. The bound shrinks the sweep to the still-pending working set WITHOUT hiding
 * an incomplete erasure.
 *
 * @implements CR-002 R7
 */

/** Don't reconcile an erasure younger than this — its async legs may legitimately still be in flight. */
export const RECONCILE_GRACE_MS = 60 * 60 * 1000; // 1 hour

/**
 * An erased identity to reconcile - the durable ULID (recipe/food key), its Clerk `sub`, and whether Clerk has
 * confirmed the account gone.
 */
interface ErasedIdentity {
    id: UserId;
    identityId: string;
    providerDeletedAt: Date | null;
}

/** The reconciliation result — how many erased identities were scanned and how many were incomplete. */
interface ReconcileResult {
    scanned: number;
    incomplete: number;
}

/**
 * Whether the erasure is complete at scan time: the provider account confirmed deleted, recipe terminal
 * (`completed`) AND food clean (0 residual rows). Any other shape (an unconfirmed provider deletion, non-terminal
 * recipe, residual food rows, an unreachable leg) means the erasure was NOT complete. Pure.
 *
 * @param result - The re-drive's per-leg result.
 * @param providerDeletedAt - When Clerk confirmed the account gone, or `null` if it has not.
 * @returns True when every leg is complete/clean.
 */
export function isErasureComplete(result: ErasureFanoutResult, providerDeletedAt: Date | null): boolean {
    const recipeComplete = result.recipe.ok && result.recipe.jobStatus === 'completed';
    const foodComplete = result.food.ok && (result.food.deletedRequesterRows ?? 0) === 0;

    return providerDeletedAt !== null && recipeComplete && foodComplete;
}

/**
 * The erased identities this sweep must still reconcile: past the grace window and not yet proven complete
 * (`reconciled_at IS NULL`). Each carries `providerDeletedAt` so the caller can tell a row waiting on Clerk from
 * one waiting on recipe/food.
 *
 * @param db - The identity db handle.
 * @param cutoff - Rows erased after this instant are still in their grace window and are excluded.
 * @returns The pending erased identities.
 * @sideEffect Reads `users`.
 */
export async function selectPendingErasures(db: DbContext['db'], cutoff: Date): Promise<ErasedIdentity[]> {
    return (await db
        .select({ id: users.id, identityId: users.identityId, providerDeletedAt: users.providerDeletedAt })
        .from(users)
        .where(
            and(eq(users.status, 'erased'), lte(users.updatedAt, cutoff), isNull(users.reconciledAt)),
        )) satisfies ErasedIdentity[];
}

/**
 * Stamp `users.reconciled_at` for a jointly-complete erasure so it drops out of the nightly scan. Guarded
 * on `reconciled_at IS NULL` (idempotent — a concurrent run can never double-stamp or clobber an earlier
 * reconcile time). A stamp-write failure is logged and SWALLOWED, never re-thrown: the erasure genuinely
 * completed, so a bookkeeping failure must not masquerade as a stuck leg (it self-heals — the next run
 * re-drives idempotently and re-stamps).
 *
 * @param db - The identity db handle.
 * @param userId - The erased identity's durable ULID.
 * @sideEffect Writes `users.reconciled_at`; catches and logs its own errors.
 */
async function stampReconciled(db: DbContext['db'], userId: UserId): Promise<void> {
    try {
        await db
            .update(users)
            .set({ reconciledAt: new Date() })
            .where(and(eq(users.id, userId), isNull(users.reconciledAt)));
    } catch (err) {
        logger.warn('erasure-reconciliation: reconciled_at stamp failed (legs complete; will re-stamp next run)', {
            userId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Re-enqueue the erasure message for an identity whose Clerk account is not yet confirmed deleted, so the deletion
 * worker finishes the job. Never throws: a lost enqueue is already counted by the caller as an incomplete erasure
 * and is retried by tomorrow's sweep, and one user's failure must not stop the batch.
 *
 * @param identity - The erased identity owing a provider deletion.
 * @param queueUrl - The deletion queue URL, or `undefined` when the stage has none configured.
 * @sideEffect Sends an SQS message; emits a metric; logs.
 */
async function requestProviderDeletion(identity: ErasedIdentity, queueUrl: string | undefined): Promise<void> {
    // Dimensionless - the owner id is on the log lines below (see the cardinality gate).
    emitMetric('ErasureIncompleteOwner', 1);

    if (queueUrl === undefined) {
        logger.error(
            'erasure-reconciliation: provider deletion owed but DELETION_QUEUE_URL is unset; cannot re-enqueue',
            {
                userId: identity.id,
            },
        );

        return;
    }

    try {
        await enqueueErasure(queueUrl, { identityId: identity.identityId, userId: identity.id });
        emitMetric('ErasureProviderDeleteReEnqueued', 1);
        logger.warn('erasure-reconciliation: Clerk deletion unconfirmed for erased identity; re-enqueued erasure', {
            userId: identity.id,
        });
    } catch (err) {
        logger.error('erasure-reconciliation: re-enqueueing the provider deletion failed; counting as incomplete', {
            userId: identity.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * The scheduled erasure-completion reconciliation. Selects `erased` identities past the grace window and
 * re-drives each one's legs, counting the incomplete. One user's failure never aborts the batch — it is
 * itself an incompleteness signal and the rest are still reconciled.
 *
 * @implements CR-002 R7
 */
const innerHandler = async (_event: ScheduledEvent, _context: Context, { db }: DbContext): Promise<ReconcileResult> => {
    const config = getErasureFanoutConfig();
    const { DELETION_QUEUE_URL } = getConfig();
    const cutoff = new Date(Date.now() - RECONCILE_GRACE_MS);

    // The BOUND: only erased identities not yet proven jointly complete (`reconciled_at IS NULL`) and past
    // the grace window. A fully-reconciled identity has been stamped and is excluded - the sweep scans the
    // still-pending working set, not the entire (ever-growing) erased population.
    const erased = await selectPendingErasures(db, cutoff);

    let incomplete = 0;

    for (const identity of erased) {
        try {
            if (providerDeletionIsOwed({ status: 'erased', providerDeletedAt: identity.providerDeletedAt })) {
                // ⛔ The Clerk leg is incomplete, and fanning out to recipe and food now would only destroy data
                // behind an account that may still sign in. Ask the deletion worker - the only Clerk mutator - to
                // finish; this row stays unstamped and in tomorrow's scan until it has.
                incomplete += 1;
                await requestProviderDeletion(identity, DELETION_QUEUE_URL);

                continue;
            }

            const result = await runErasureFanout(
                { userId: identity.id, eventId: `reconcile:${identity.id}`, actor: 'erasure-reconciliation' },
                config,
            );

            if (isErasureComplete(result, identity.providerDeletedAt)) {
                // Both legs verified complete — stamp reconciled_at so this identity leaves the nightly scan.
                await stampReconciled(db, identity.id);
            } else {
                incomplete += 1;
                // Dimensionless — the owner id is on the log line below (see the cardinality gate). The
                // ALARM watches the aggregate `ErasureIncomplete` count, never a per-owner series.
                emitMetric('ErasureIncompleteOwner', 1);
                logger.warn('erasure-reconciliation: erasure incomplete for erased identity', {
                    userId: identity.id,
                    recipeOk: result.recipe.ok,
                    recipeStatus: result.recipe.jobStatus,
                    foodOk: result.food.ok,
                    foodRowsDeleted: result.food.deletedRequesterRows,
                });
            }
        } catch (err) {
            // An unreachable service (or any throw) is itself an incompleteness signal; keep going so one
            // bad user never blocks reconciling the rest.
            incomplete += 1;
            // Dimensionless — the owner id is on the log line below (see the cardinality gate).
            emitMetric('ErasureIncompleteOwner', 1);
            logger.error('erasure-reconciliation: re-drive threw; counting as incomplete', {
                userId: identity.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // The aggregate the alarm watches — emitted every run (including 0) so a stuck alarm on stale data
    // clears once the backlog drains.
    emitMetric('ErasureIncomplete', incomplete);
    logger.info('erasure-reconciliation complete', { scanned: erased.length, incomplete });

    return { scanned: erased.length, incomplete };
};

/** @implements CR-002 R7 */
export const handler = withObservability(withDb(innerHandler));
