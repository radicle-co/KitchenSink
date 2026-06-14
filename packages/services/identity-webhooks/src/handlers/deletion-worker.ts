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

    const user = await userDao.findByIdentityId(identityId);

    if (!user) {
        logger.warn('deletion-worker: user not found, skipping (idempotent)', { identityId });

        return;
    }

    await userDao.softDeleteByIdentityId(identityId);

    logger.info('user deleted', { identityId, userId: user.id });
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
