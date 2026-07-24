import type { Context, ScheduledEvent } from 'aws-lambda';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import { provisionCompleteUser } from '@kitchensink/identity-utils';

import { getDb } from '../common/db.js';
import { buildProvisionDeps } from '../common/provisioning.js';
import { listUsers } from '../common/identityClient.js';
import { getConfig } from '../config/env.js';
import { captureProvisioningFailure, emitMetric, logger, withObservability } from '../common/observability.js';

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
type ReconciliationResult = {
    inserted: number;
    updated: number;
    failed: number;
    total: number;
};

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
const innerHandler = async (_event: ScheduledEvent, _context: Context): Promise<ReconciliationResult> => {
    // Resolved (and cached) via the typed config at the top of the handler — S-I5: a missing DB_SECRET_ARN
    // or IDP_SECRET_KEY/AUTH_SECRET_ARN now fails fast on the first invocation of a cold container,
    // rather than being hand-rolled per handler as a truthiness check + ad hoc error envelope.
    const { DB_SECRET_ARN } = getConfig();

    const idpUsers = await listUsers();
    const db = await getDb(DB_SECRET_ARN);
    const typedDb = db as unknown as PostgresJsDatabase<Record<string, never>>;
    const userDao = new UserDAO(typedDb);

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const idpUser of idpUsers) {
        const primaryEmail = idpUser.emailAddresses.find((e) => e.id === idpUser.primaryEmailAddressId)?.emailAddress;

        if (!primaryEmail) {
            continue;
        }

        const existing = await userDao.findByIdentityId(idpUser.id);

        // Full provisioning through the shared routine — reconciliation is the LAST-RESORT backstop for
        // users the webhook missed who may never log in (no read-through to heal them), so a collided
        // email must still produce a complete placeholder-emailed user (`placeholder`), never be skipped.
        try {
            await provisionCompleteUser(
                buildProvisionDeps(typedDb),
                {
                    identityId: idpUser.id,
                    email: primaryEmail,
                    name: idpUser.fullName ?? undefined,
                    displayName: idpUser.fullName ?? undefined,
                    picture: idpUser.imageUrl ?? undefined,
                    avatarUrl: idpUser.imageUrl ?? null,
                },
                { onEmailCollision: 'placeholder', emailIsReal: true },
            );
        } catch (err) {
            // One user's genuine failure must not abort the whole nightly run: emit the distinct paging
            // signal (R5) and continue so the remaining users still get repaired.
            captureProvisioningFailure(err, idpUser.id);
            logger.error('reconciliation: failed to provision user', { identityId: idpUser.id });
            failed += 1;
            continue;
        }

        if (existing) {
            updated += 1;
        } else {
            inserted += 1;
        }
    }

    const total = inserted + updated;

    logger.info('reconciliation complete', { inserted, updated, failed, total });
    emitMetric('ReconciliationDrift', inserted);

    return { inserted, updated, failed, total };
};

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
export const handler = withObservability(innerHandler);
