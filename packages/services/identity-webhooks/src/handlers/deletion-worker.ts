import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { UserDAO } from '@kitchensink/identity-db';

import { withDb, type DbContext } from '../common/handler-pipeline.js';
import { banUser, unbanUser } from '../common/identityClient.js';
import { logger, withObservability } from '../common/observability.js';

/**
 * The deletion-queue message. Legacy messages (the `user.deleted` webhook — KTD-2 erasure-via-webhook) carry
 * only `{ identityId }` and route to the identity-DB purge. CR-002 lifecycle messages additionally carry an
 * `event` that routes the Clerk-side mutation this Lambda alone can perform (it holds the Clerk secret).
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
type IdpDeletionMessage = {
    identityId: string;
    userId?: string;
    event?: 'closure' | 'reactivation' | 'erasure';
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
const parseMessage = (record: SQSRecord): IdpDeletionMessage => {
    return JSON.parse(record.body) as IdpDeletionMessage;
};

/**
 * Legacy purge path (no `event`): the `user.deleted` webhook enqueues `{ identityId }`. Purge the user's
 * private data (delete account + profile, clear avatar) but retain the soft-deleted attribution tombstone.
 * Idempotent on a missing/already-purged user. (Wiring this into the full cross-service erasure fan-out is
 * U4b — out of scope for the tombstoning slice.)
 */
const purgeLegacy = async (identityId: string, userDao: UserDAO): Promise<void> => {
    const purged = await userDao.purgePrivateDataByIdentityId(identityId);

    if (!purged) {
        logger.warn('deletion-worker: user not found, skipping (idempotent)', { identityId });

        return;
    }

    logger.info('deletion-worker: user private data purged (legacy user.deleted path)', {
        identityId,
        userId: purged.id,
    });
};

/**
 * Route one deletion-queue record. The DB state change for closure/reactivation is applied synchronously by
 * the identity service / admin endpoint BEFORE enqueue; this Lambda performs only the Clerk-side mutation
 * (the public-ALB service holds no Clerk secret). Idempotent per event.
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
const processRecord = async (record: SQSRecord, userDao: UserDAO): Promise<void> => {
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
            // SEAM (U3/U4 — UNBUILT). The identity-side scrub + Clerk `deleteUser` are performed by the
            // tombstone-sweep BEFORE this message is enqueued. What remains — fanning the erasure out to
            // recipe-service (U3: recipe/collection/rating removal) and food-service (U4/R11: fetch_requesters
            // erasure via `eraseUser`) — is a separate follow-up unit. Until then this is an idempotent no-op
            // so the message drains cleanly rather than DLQ-ing; U4b wires the fan-out here.
            logger.warn('deletion-worker: erasure fan-out not yet implemented (U3/U4 seam)', {
                identityId: message.identityId,
                userId: message.userId,
            });

            return;
        }

        default: {
            await purgeLegacy(message.identityId, userDao);
        }
    }
};

/**
 * The variant business logic — the invariant env-guard + `getDb` + `new UserDAO` prologue is `withDb` (S-I6),
 * which resolves the typed config (S-I5) and hands the db/DAO context here.
 *
 * @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017
 */
const innerHandler = async (event: SQSEvent, _context: Context, { userDao }: DbContext): Promise<void> => {
    for (const record of event.Records) {
        await processRecord(record, userDao);
    }
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
export const handler = withObservability(withDb(innerHandler));
