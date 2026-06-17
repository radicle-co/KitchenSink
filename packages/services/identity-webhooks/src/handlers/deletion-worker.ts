import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { UserDAO } from '@kitchensink/identity-service/database/dao';

import { getDb } from '../common/db.js';
import { buildErrorEnvelope, resolveRequestId } from '../common/error-envelope.js';
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
const processRecord = async (record: SQSRecord, dbSecretArn: string): Promise<void> => {
    const { identityId } = parseMessage(record);

    const db = await getDb(dbSecretArn);
    const userDao = new UserDAO(db as unknown as PostgresJsDatabase<Record<string, never>>);

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

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
const innerHandler = async (event: SQSEvent, context: Context): Promise<void> => {
    const requestId = resolveRequestId(context);
    const dbSecretArn = process.env.DB_SECRET_ARN;

    if (!dbSecretArn) {
        const envelope = buildErrorEnvelope('DELETION_WORKER_MISSING_ENV', 'Missing DB_SECRET_ARN', requestId);
        logger.error('deletion-worker invalid config', { ...envelope });
        throw new Error(JSON.stringify(envelope));
    }

    for (const record of event.Records) {
        await processRecord(record, dbSecretArn);
    }
};

/** @implements REQ-025 REQ-026 REQ-IF-005 REQ-CN-001 FR-025 FR-026 ARCH-017 MOD-017 */
export const handler = withObservability(innerHandler);
