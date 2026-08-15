import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';

import { idpDeletionMessageSchema, type IdpDeletionMessage } from '../common/deletionQueue.schema.js';
import { withDb, type DbContext } from '../common/handlerPipeline.js';
import { eraseIdentityRow } from '../common/eraseIdentity.js';
import { runErasureFanout, type ErasureFanoutResult, type ErasureFanoutTarget } from '../common/erasureFanout.js';
import { banUser, unbanUser } from '../common/identityClient.js';
import { getErasureFanoutConfig } from '../config/env.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';

/**
 * The deletion-queue message. Two producers, one queue:
 *
 *  - The `user.deleted` **webhook** enqueues the LEGACY `{ identityId }` (no `event`). Under KTD-2 this is a
 *    full ERASURE (an admin/dashboard delete or the echo of our own erasure) — the default branch below
 *    resolves the app ULID, erases the identity to `{id}` (R10-covering `status='erased'`), and fans out.
 *  - The identity service / admin endpoint / tombstone-sweep enqueue a CR-002 lifecycle message with an
 *    `event`: `closure` → ban, `reactivation` → unban, `erasure` → fan out the recipe + food legs.
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
/**
 * Parse and VALIDATE an SQS record into a deletion message.
 *
 * Was `JSON.parse(record.body) as IdpDeletionMessage`. A cast cannot narrow a string, so `message.event` was
 * unchecked at runtime and ANY value that was not exactly one of the three literals fell through the `switch`
 * `default` below — which performs a full GDPR erasure and a cross-service fan-out. See
 * `../common/deletionQueue.schema.ts` for the full reasoning.
 *
 * @param record - The raw SQS record.
 * @returns The validated message.
 * @throws {SyntaxError} When the body is not JSON.
 * @throws {ZodError} When the body is JSON but not a valid deletion message. Throwing is correct HERE (unlike
 *   the Clerk webhook, which acknowledges): every producer of this queue is our own code, so an invalid message
 *   is our bug — it must reach the DLQ and its alarm, not be quietly acknowledged.
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
const parseMessage = (record: SQSRecord): IdpDeletionMessage => {
    return idpDeletionMessageSchema.parse(JSON.parse(record.body));
};

/**
 * Fan the erasure out to recipe (first) then food, and THROW if either leg failed so SQS redelivers (both
 * legs are idempotent, and the erasure-reconciliation sweep is the standing backstop). A partial failure is
 * a retry, never a silent half-erased account (R7).
 *
 * @sideEffect Two verified service-principal HTTP POSTs; emits a completion metric; may throw to force retry.
 */
const fanOutOrThrow = async (target: ErasureFanoutTarget): Promise<void> => {
    const config = getErasureFanoutConfig();
    const result: ErasureFanoutResult = await runErasureFanout(target, config);
    const legs = [result.recipe, result.food];
    const failed = legs.filter((leg) => !leg.ok);

    if (failed.length > 0) {
        // Dimensionless: a per-owner dimension is one separately billed custom metric per user
        // (`packages/infra/global/__tests__/emfIdentifierDimensionRepoGate.test.ts`). The owner id moves to the structured log
        // below — which it was NOT on before: it existed only inside the thrown message, and `scrubText`
        // pseudonymizes an embedded Clerk `sub` but deliberately leaves a bare ULID to the structured-attribute
        // path. So this log line is both the diagnostic and the scrubbed home for the id.
        emitMetric('ErasureFanoutLegFailed', failed.length);
        logger.error('deletion-worker: erasure fan-out leg failed; throwing to force SQS redelivery', {
            userId: target.userId,
            failedLegs: failed.map((leg) => leg.service).join(','),
            recipeOk: result.recipe.ok,
            foodOk: result.food.ok,
        });

        // Throw so the SQS record is retried; a persistent failure DLQs and the erasure-reconciliation
        // surfaces it. The successful leg's re-run on retry is an idempotent no-op.
        throw new Error(
            `erasure fan-out incomplete for owner ${target.userId}: ` +
                failed.map((leg) => `${leg.service}(${leg.httpStatus ?? 'ERR'}: ${leg.detail ?? ''})`).join('; '),
        );
    }

    logger.info('deletion-worker: erasure fan-out complete (recipe + food)', {
        userId: target.userId,
        recipeStatus: result.recipe.jobStatus,
        foodRowsDeleted: result.food.deletedRequesterRows,
    });
};

/**
 * The KTD-2 `user.deleted` webhook path = full ERASURE. The Clerk identity is ALREADY gone (that is what
 * fired the webhook), so there is no Clerk call here: resolve the app ULID, erase the identity row to `{id}`
 * (only when not already erased — an echo must not append a second audit row, R9), then fan out to recipe +
 * food. Idempotent throughout: a missing/already-erased user is a clean no-op on the identity side, and the
 * fan-out dedups server-side.
 *
 * @sideEffect Erases the identity row (once) and fans the erasure out; may throw to force an SQS retry.
 */
const eraseFromWebhook = async (identityId: string, { db, userDao }: DbContext): Promise<void> => {
    const user = await userDao.findByIdentityId(identityId);

    if (!user) {
        // Rows are never hard-deleted (R1), so this only happens for an unknown identity — an idempotent
        // no-op (e.g. a webhook for a user we never provisioned).
        logger.warn('deletion-worker: user.deleted for unknown identity, skipping (idempotent)', { identityId });

        return;
    }

    if (user.status !== 'erased') {
        // KTD-2 full erasure: scrub to {id} + R8 audit. Setting status='erased' is what brings this
        // webhook-erased user under the R10 anti-resurrection guard (else it stays `active`+soft-deleted).
        await eraseIdentityRow(
            db,
            { userId: user.id, triggerSource: 'admin', actor: 'clerk-user-deleted-webhook' },
            new Date(),
        );
        // Dimensionless — the id is on the log line below (see the cardinality gate).
        emitMetric('UserDeletedWebhookErased', 1);
        logger.info('deletion-worker: user.deleted — identity erased (KTD-2)', { identityId, userId: user.id });
    } else {
        logger.info('deletion-worker: user.deleted echo for already-erased identity (no re-scrub)', {
            identityId,
            userId: user.id,
        });
    }

    await fanOutOrThrow({
        userId: user.id,
        eventId: `user.deleted:${identityId}`,
        actor: 'clerk-user-deleted-webhook',
    });
};

/**
 * Route one deletion-queue record. Closure/reactivation apply the Clerk-side mutation this Lambda alone can
 * perform (the public-ALB service holds no Clerk secret); erasure fans out to recipe + food; the legacy
 * (no-`event`) path is the KTD-2 `user.deleted` webhook full erasure. Idempotent per event.
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
const processRecord = async (record: SQSRecord, dbCtx: DbContext): Promise<void> => {
    const message = parseMessage(record);

    switch (message.event) {
        case 'closure': {
            // Durable, reversible ban (NOT delete) — the tombstone is recoverable via admin unban.
            await banUser(message.identityId);
            logger.info('deletion-worker: closure — Clerk identity banned', {
                identityId: message.identityId,
                userId: message.userId,
            });

            return;
        }

        case 'reactivation': {
            await unbanUser(message.identityId);
            logger.info('deletion-worker: reactivation — Clerk identity unbanned', {
                identityId: message.identityId,
                userId: message.userId,
            });

            return;
        }

        case 'erasure': {
            // The identity scrub + Clerk deleteUser were done by the enqueuer (the tombstone-sweep) BEFORE
            // this message; this branch drives the cross-service legs (recipe FIRST for R9, then food/R11).
            if (message.userId === undefined || message.userId === '') {
                logger.warn('deletion-worker: erasure message missing userId; cannot fan out', {
                    identityId: message.identityId,
                });

                return;
            }

            await fanOutOrThrow({
                userId: message.userId,
                eventId: message.enqueuedAt ?? `erasure:${message.userId}`,
                actor: 'identity-tombstone-sweep',
            });

            return;
        }

        default: {
            // `event` is ABSENT: the `user.deleted` webhook (KTD-2 full erasure).
            //
            // This arm is reachable ONLY for an absent `event`, and that is now guaranteed by
            // `idpDeletionMessageSchema` rather than hoped for: `event` is `z.enum(DELETION_EVENTS).optional()`,
            // so an unrecognised value is a rejected message and never arrives here. Before that schema existed
            // this `default` also caught every typo, case difference and version skew — making the most
            // destructive operation in the system the fallback for unrecognised input.
            await eraseFromWebhook(message.identityId, dbCtx);
        }
    }
};

/**
 * The variant business logic — the invariant env-guard + `getDb` + `new UserDAO` prologue is `withDb` (S-I6),
 * which resolves the typed config (S-I5) and hands the db/DAO context here.
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
const innerHandler = async (event: SQSEvent, _context: Context, dbCtx: DbContext): Promise<void> => {
    for (const record of event.Records) {
        await processRecord(record, dbCtx);
    }
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
export const handler = withObservability(withDb(innerHandler));
