import type { Context, ScheduledEvent } from 'aws-lambda';
import { and, eq, lte } from 'drizzle-orm';

import { users } from '@kitchensink/identity-db';

import { getErasureFanoutConfig } from '../config/env.js';
import { withDb, type DbContext } from '../common/handler-pipeline.js';
import { runErasureFanout, type ErasureFanoutResult } from '../common/erasure-fanout.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';

/**
 * The **erasure completion contract** reconciliation sweep (CR-002 / U4b / R7). DISTINCT from the
 * provisioning `reconciliation.ts` (Clerk↔DB drift): this sweep is the detective + corrective control for
 * the three-leg erasure. An identity that reached `status='erased'` must have its recipe + food legs
 * jointly complete; a lost/stuck leg must NEVER leave a silently half-erased account.
 *
 * For each erased identity (correlation key = the owner ULID, the SAME `users.id` recipe/food key by), it
 * RE-DRIVES the idempotent recipe + food internal-erasure legs via {@link runErasureFanout}. The re-drive
 * is authoritative-idempotent — recipe returns `completed` (or re-creates a lost job), food deletes any
 * residual `fetch_requesters` rows (or 0) — so this sweep both HEALS an incomplete erasure and detects it:
 * a leg that is non-terminal, reports residual work, errored, or is unreachable is counted into the
 * `ErasureIncomplete` metric the CloudWatch alarm watches.
 *
 * A grace window ({@link RECONCILE_GRACE_MS}) excludes freshly-erased rows whose legs are legitimately
 * still draining, so a normal in-flight erasure is not false-flagged.
 *
 * @implements CR-002 R7
 */

/** Don't reconcile an erasure younger than this — its async legs may legitimately still be in flight. */
export const RECONCILE_GRACE_MS = 60 * 60 * 1000; // 1 hour

/** An erased identity to reconcile — the durable ULID (recipe/food key) + its Clerk `sub` (correlation). */
interface ErasedIdentity {
    id: string;
    identityId: string;
}

/** The reconciliation result — how many erased identities were scanned and how many were incomplete. */
interface ReconcileResult {
    scanned: number;
    incomplete: number;
}

/**
 * Whether a fan-out result shows the erasure jointly complete: recipe terminal (`completed`) AND food clean
 * (0 residual rows). Any other shape (non-terminal recipe, residual food rows, an unreachable leg) means the
 * erasure was NOT complete at scan time. Pure.
 *
 * @param result - The re-drive's per-leg result.
 * @returns True when both legs are complete/clean.
 */
export function isErasureComplete(result: ErasureFanoutResult): boolean {
    const recipeComplete = result.recipe.ok && result.recipe.jobStatus === 'completed';
    const foodComplete = result.food.ok && (result.food.deletedRequesterRows ?? 0) === 0;

    return recipeComplete && foodComplete;
}

/**
 * The scheduled erasure-completion reconciliation. Selects `erased` identities past the grace window and
 * re-drives each one's legs, counting the incomplete. One user's failure never aborts the batch — it is
 * itself an incompleteness signal and the rest are still reconciled.
 *
 * @implements CR-002 R7
 */
const innerHandler = async (
    _event: ScheduledEvent,
    _context: Context,
    { db }: DbContext,
): Promise<ReconcileResult> => {
    const config = getErasureFanoutConfig();
    const cutoff = new Date(Date.now() - RECONCILE_GRACE_MS);

    const erased = (await db
        .select({ id: users.id, identityId: users.identityId })
        .from(users)
        .where(and(eq(users.status, 'erased'), lte(users.updatedAt, cutoff)))) as ErasedIdentity[];

    let incomplete = 0;

    for (const identity of erased) {
        try {
            const result = await runErasureFanout(
                { userId: identity.id, eventId: `reconcile:${identity.id}`, actor: 'erasure-reconciliation' },
                config,
            );

            if (!isErasureComplete(result)) {
                incomplete += 1;
                emitMetric('ErasureIncompleteOwner', 1, { userId: identity.id });
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
            emitMetric('ErasureIncompleteOwner', 1, { userId: identity.id });
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
