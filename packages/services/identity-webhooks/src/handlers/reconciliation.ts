import type { Context, ScheduledEvent } from 'aws-lambda';
import { provisionCompleteUser } from '@kitchensink/identity-utils';

import { withDb, type DbContext } from '../common/handlerPipeline.js';
import { buildProvisionDeps } from '../common/provisioning.js';
import { listUsers } from '../common/identityClient.js';
import { captureProvisioningFailure, emitMetric, logger, withObservability } from '../common/observability.js';

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
type ReconciliationResult = {
    inserted: number;
    updated: number;
    failed: number;
    skipped: number;
    total: number;
};

/**
 * The variant business logic — the invariant env-guard + `getDb` + `new UserDAO` prologue is now
 * `withDb` (S-I6), which resolves the typed config (S-I5) and hands the db/DAO context here.
 *
 * @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012
 */
const innerHandler = async (
    _event: ScheduledEvent,
    _context: Context,
    { db, userDao }: DbContext,
): Promise<ReconciliationResult> => {
    const idpUsers = await listUsers();

    let inserted = 0;
    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const idpUser of idpUsers) {
        const primaryEmail = idpUser.emailAddresses.find((e) => e.id === idpUser.primaryEmailAddressId)?.emailAddress;

        if (!primaryEmail) {
            continue;
        }

        const existing = await userDao.findByIdentityId(idpUser.id);

        // R10 (anti-resurrection): a closed/erased account must NOT be re-provisioned by the nightly sweep. A
        // tombstoned user is still present in Clerk (banned, not deleted) and so appears in listUsers(); skip
        // it so provisionCompleteUser never clears its deletedAt or rebuilds its scrubbed companion rows. (An
        // erased user is deleted from Clerk and won't appear, but we guard both defensively.)
        if (existing && (existing.status === 'tombstoned' || existing.status === 'erased')) {
            skipped += 1;
            continue;
        }

        // Full provisioning through the shared routine — reconciliation is the LAST-RESORT backstop for
        // users the webhook missed who may never log in (no read-through to heal them), so a collided
        // email must still produce a complete placeholder-emailed user (`placeholder`), never be skipped.
        try {
            await provisionCompleteUser(
                buildProvisionDeps(db),
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

    logger.info('reconciliation complete', { inserted, updated, failed, skipped, total });
    emitMetric('ReconciliationDrift', inserted);

    return { inserted, updated, failed, skipped, total };
};

/** @implements REQ-017 REQ-IF-010 FR-017 ARCH-012 MOD-012 */
export const handler = withObservability(withDb(innerHandler));
