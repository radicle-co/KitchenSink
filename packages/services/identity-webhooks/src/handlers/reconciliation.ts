import type { Context, ScheduledEvent } from 'aws-lambda';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { UserDAO } from '@kitchensink/identity-service/database/dao';

import { getDb } from '../common/db.js';
import { listUsers } from '../common/identityClient.js';
import { buildErrorEnvelope, resolveRequestId } from '../common/error-envelope.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
type ReconciliationResult = {
    inserted: number;
    updated: number;
    total: number;
};

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
const innerHandler = async (event: ScheduledEvent, context: Context): Promise<ReconciliationResult> => {
    const requestId = resolveRequestId(context, event.id);
    const dbSecretArn = process.env.DB_SECRET_ARN;
    const idpSecretKeyOrArn = process.env.IDP_SECRET_KEY ?? process.env.AUTH_SECRET_ARN;

    if (!dbSecretArn || !idpSecretKeyOrArn) {
        const envelope = buildErrorEnvelope(
            'RECONCILIATION_MISSING_ENV',
            'Missing DB_SECRET_ARN or IDP_SECRET_KEY/AUTH_SECRET_ARN',
            requestId,
        );
        logger.error('reconciliation invalid config', { ...envelope });
        throw new Error(JSON.stringify(envelope));
    }

    const idpUsers = await listUsers();
    const db = await getDb(dbSecretArn);
    const userDao = new UserDAO(db as unknown as PostgresJsDatabase<Record<string, never>>);

    let inserted = 0;
    let updated = 0;

    for (const idpUser of idpUsers) {
        const primaryEmail = idpUser.emailAddresses.find((e) => e.id === idpUser.primaryEmailAddressId)?.emailAddress;

        if (!primaryEmail) {
            continue;
        }

        const existing = await userDao.findByIdentityId(idpUser.id);

        await userDao.upsertByIdentityId({
            identityId: idpUser.id,
            email: primaryEmail,
            name: idpUser.fullName ?? undefined,
            picture: idpUser.imageUrl ?? undefined,
        });

        if (existing) {
            updated += 1;
        } else {
            inserted += 1;
        }
    }

    const total = inserted + updated;

    logger.info('reconciliation complete', { inserted, updated, total });
    emitMetric('ReconciliationDrift', inserted);

    return { inserted, updated, total };
};

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
export const handler = withObservability(innerHandler);
