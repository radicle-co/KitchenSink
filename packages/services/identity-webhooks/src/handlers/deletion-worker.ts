import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import type { UserDAO } from '@kitchensink/identity-service/database/dao';

import { withDb, type DbContext } from '../common/handler-pipeline.js';
import { logger, withObservability } from '../common/observability.js';

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
type IdpDeletionMessage = {
    identityId: string;
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
const parseMessage = (record: SQSRecord): IdpDeletionMessage => {
    return JSON.parse(record.body) as IdpDeletionMessage;
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
const processRecord = async (record: SQSRecord, userDao: UserDAO): Promise<void> => {
    const { identityId } = parseMessage(record);

    // Purge the user's private data on deletion: delete the account + profile rows and clear the
    // avatar, but retain the soft-deleted user row's id/email/name for public recipe attribution.
    // Returns undefined when there's no such user — idempotent on a missing/already-deleted user.
    const purged = await userDao.purgePrivateDataByIdentityId(identityId);

    if (!purged) {
        logger.warn('deletion-worker: user not found, skipping (idempotent)', { identityId });

        return;
    }

    logger.info('user private data purged (account + profile deleted, avatar cleared; id/email/name retained)', {
        identityId,
        userId: purged.id,
    });
};

/**
 * The variant business logic — the invariant env-guard + `getDb` + `new UserDAO` prologue is now
 * `withDb` (S-I6), which resolves the typed config (S-I5) and hands the db/DAO context here.
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
