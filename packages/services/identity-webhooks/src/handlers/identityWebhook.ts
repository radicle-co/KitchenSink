import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import { UserDAO, recordOnce, hasProcessedWebhookEvent } from '@kitchensink/identity-service/database/dao';
import { users } from '@kitchensink/identity-service/database/schema';
import type { UserRow } from '@kitchensink/identity-service/database/schema';
import type { UserId } from '@kitchensink/identity-service/types';
import { provisionCompleteUser, type ProvisionResult } from '@kitchensink/identity-utils';
import { buildHandleSyncMessage } from '@kitchensink/identity-core';
import {
    createSnsHandleSyncPublisher,
    noopHandleSyncPublisher,
} from '@kitchensink/identity-service/users/handle-sync-publisher';

import { setExternalId } from '../common/identityClient.js';
import { buildProvisionDeps } from '../common/provisioning.js';
import { requireEnv } from '../common/config.js';
import { getDb } from '../common/db.js';
import { resolveRequestId } from '../common/error-envelope.js';
import { captureProvisioningFailure, emitMetric, logger, withObservability } from '../common/observability.js';
import { traceAuth } from '../common/auth-trace.js';
import { verifyWebhook } from '../common/svix.js';

interface IdentityUserData {
    id: string;
    email_addresses: Array<{ id: string; email_address: string }>;
    first_name: string;
    last_name: string;
    image_url: string;
}

const getPrimaryEmail = (data: IdentityUserData): string | undefined => data.email_addresses?.[0]?.email_address;

const buildDisplayName = (data: IdentityUserData): string => `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim();

/**
 * The handle-sync producer for this Lambda (W8-a.2) — SNS-backed when `HANDLE_SYNC_TOPIC_ARN` is set, else
 * a no-op. Created once at module scope (reused across warm invocations), sharing the recipe/identity
 * publisher impl so all three routes agree on the wire shape.
 */
const handleSyncPublisher = ((): ReturnType<typeof createSnsHandleSyncPublisher> => {
    const topicArn = process.env['HANDLE_SYNC_TOPIC_ARN'];

    if (topicArn === undefined || topicArn === '') {
        return noopHandleSyncPublisher;
    }

    return createSnsHandleSyncPublisher({
        topicArn,
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        ...(process.env['SNS_ENDPOINT'] !== undefined ? { endpoint: process.env['SNS_ENDPOINT'] } : {}),
    });
})();

const sqsClient = new SQSClient({});

const enqueueDeletion = async (identityId: string): Promise<void> => {
    const queueUrl = requireEnv('DELETION_QUEUE_URL');
    // The deletion-worker's parseMessage reads `identityId`; the message body must carry that field.
    // Sending `{ userId }` silently no-ops every webhook-driven deletion once the worker actually
    // consumes the queue (findByIdentityId(undefined) → not found → skip).
    await sqsClient.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ identityId }),
        }),
    );
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
const handleUserCreated = async (
    data: IdentityUserData,
    db: PostgresJsDatabase<Record<string, never>>,
    requestId: string,
): Promise<void> => {
    const email = getPrimaryEmail(data);

    if (!email) {
        logger.warn('identity-webhook: user.created missing primary email', { requestId, identityId: data.id });

        return;
    }

    // Provision the COMPLETE local unit (user + account + profile) through the shared routine, before
    // the external Clerk call below. `signal-incomplete`: if the email already belongs to a DIFFERENT
    // active identity, don't 502/retry-storm — return and let the read-through path provision this user
    // (with its placeholder-email fallback) on first authenticated request.
    let result: ProvisionResult<UserRow>;

    try {
        result = await provisionCompleteUser<UserRow>(
            buildProvisionDeps(db),
            {
                identityId: data.id,
                email,
                name: buildDisplayName(data),
                displayName: buildDisplayName(data),
                picture: data.image_url ?? undefined,
                avatarUrl: data.image_url ?? null,
            },
            { onEmailCollision: 'signal-incomplete', emailIsReal: true },
        );
    } catch (err) {
        // Genuine provisioning failure (a DB/constraint error left the user incomplete): emit the
        // distinct paging signal, then rethrow so svix retries. The expected email-collision case
        // returns `incomplete` below (never throws), so it does NOT page.
        captureProvisioningFailure(err, data.id);

        throw err;
    }

    if (result.kind === 'incomplete') {
        logger.warn('identity-webhook: user.created email in use by another active identity; skipping', {
            requestId,
            identityId: data.id,
        });

        return;
    }

    const { user } = result;

    // Best-effort: backfill Clerk's external_id (the app user id) so the IdP→app link is bidirectional.
    // A failure here (Clerk API down, key rotated/again-missing, rate limit) must NOT abort provisioning
    // — the user/account/profile are already complete. Only stamp externalIdSyncedAt on success, so the
    // nightly reconciliation retries the ones that didn't land.
    try {
        await setExternalId(data.id, user.id);
        await db.update(users).set({ externalIdSyncedAt: new Date() }).where(eq(users.identityId, data.id));
    } catch (err) {
        logger.warn('identity-webhook: setExternalId failed; user is complete, leaving for reconciliation', {
            requestId,
            identityId: data.id,
            error: err instanceof Error ? err.message : String(err),
        });
        traceAuth('webhook.set_external_id_failed', { identityId: data.id });
    }

    emitMetric('UserCreatedWebhook', 1, { identityId: data.id });
    logger.info('identity-webhook: user.created processed', { requestId, identityId: data.id, userId: user.id });
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
const handleUserUpdated = async (
    data: IdentityUserData,
    db: PostgresJsDatabase<Record<string, never>>,
    requestId: string,
): Promise<void> => {
    const userDao = new UserDAO(db, logger);
    const existing = await userDao.findByIdentityId(data.id);

    if (!existing) {
        logger.warn('identity-webhook: user.updated user not found', { requestId, identityId: data.id });

        return;
    }

    const email = getPrimaryEmail(data);
    const displayName = buildDisplayName(data);
    const now = new Date();

    // if email changed -> update users.email + updated_at
    if (email && email !== existing.email) {
        await db.update(users).set({ email, updatedAt: now }).where(eq(users.id, existing.id));
    }

    // Coherent users/profiles sync (S-I3): gate on `users.name`/`users.picture` as the Clerk MIRROR,
    // moving the mirror on every genuine Clerk-side change. This fires the `profiles` write only when
    // Clerk's incoming value actually differs from the mirror (so an A->B->A rename still round-trips,
    // since the mirror always tracks Clerk's last-seen value) while leaving `profiles` untouched on a
    // non-name event (avatar-only change, redelivery), which preserves any self-service `PATCH /me`
    // override. One transaction, both tables. Returns whether displayName actually changed, so the
    // handle-sync publish below fires on every genuine transition, including a revert back to a prior
    // value.
    const newPicture = data.image_url ?? null;
    const { displayNameChanged } = await userDao.syncNameAndPicture(existing.id as UserId, {
        name: displayName,
        picture: newPicture,
        now,
    });

    // Handle-sync (W8-a.2): the SECOND producer route. When the display NAME actually changed, publish to
    // the global topic so the recipe service corrects its denormalized author/editor handles.
    // sourceTimestamp is the SAME `now` written in the coherent sync above — the SAME single monotonic
    // clock the PATCH route uses, so the consumer's guard orders webhook and PATCH renames coherently.
    // Best-effort: a failed publish is logged, never fails the webhook (the reconciliation/backfill
    // backstops a missed event).
    if (displayNameChanged) {
        try {
            await handleSyncPublisher.publish(buildHandleSyncMessage(existing.id, displayName, now.toISOString()));
        } catch (error) {
            logger.error('identity-webhook: handle-sync publish failed (user.updated still processed)', {
                requestId,
                userId: existing.id,
                error,
            });
        }
    }

    emitMetric('UserUpdatedWebhook', 1, { identityId: data.id });
    logger.info('identity-webhook: user.updated processed', { requestId, identityId: data.id, userId: existing.id });
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
const handleUserDeleted = async (data: { id: string }, requestId: string): Promise<void> => {
    await enqueueDeletion(data.id);
    emitMetric('UserDeletedWebhook', 1, { identityId: data.id });
    logger.info('identity-webhook: user.deleted enqueued', { requestId, identityId: data.id });
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
const idpWebhookHandlerCore = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const requestId = resolveRequestId(context, event.requestContext?.requestId);

    let payload: ReturnType<typeof verifyWebhook>;

    try {
        const secret = requireEnv('IDP_WEBHOOK_SECRET');
        const rawBody = event.body ?? '';
        payload = verifyWebhook(event.headers as Record<string, string>, rawBody, secret);
    } catch (err) {
        logger.warn('identity-webhook: signature verification failed', { requestId, error: (err as Error).message });

        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' }),
        };
    }

    const dbSecretArn = requireEnv('DB_SECRET_ARN');
    const db = (await getDb(dbSecretArn)) as unknown as PostgresJsDatabase<Record<string, never>>;
    const svixId = event.headers?.['svix-id'] ?? '';

    const identityId = (payload.data as { id?: string }).id ?? 'unknown';
    traceAuth('webhook.received', { sub: identityId, type: payload.type, svixId });

    // Confirm-after-process dedup: the svix-id is recorded only AFTER its handler succeeds (below),
    // so a delivery already present is a duplicate of a prior success and is short-circuited here.
    if (await hasProcessedWebhookEvent(db, svixId)) {
        logger.info('identity-webhook: duplicate svix-id, returning 200', { requestId, svixId });
        traceAuth('webhook.dedup_skip', { sub: identityId, svixId });

        return { statusCode: 200, body: JSON.stringify({ ok: true, dedup: true }) };
    }

    // No pre-claim: if a handler below throws, it propagates and the svix-id is NOT recorded, so
    // svix's (finite) retry schedule re-processes the event — handlers are idempotent (atomic upsert
    // on users.identity_id; idempotent soft-delete), so a retry overlapping an in-flight delivery is
    // safe. A permanently-failing payload retries until svix exhausts, surfacing the failure each
    // time rather than being silently dropped (the original A2 event-loss mode).
    switch (payload.type) {
        case 'user.created': {
            await handleUserCreated(payload.data as unknown as IdentityUserData, db, requestId);
            break;
        }

        case 'user.updated': {
            await handleUserUpdated(payload.data as unknown as IdentityUserData, db, requestId);
            break;
        }

        case 'user.deleted': {
            await handleUserDeleted(payload.data as unknown as { id: string }, requestId);
            break;
        }

        default: {
            logger.warn('identity-webhook: unhandled event type', {
                requestId,
                type: (payload as { type: string }).type,
            });
        }
    }

    // Record only on success, keyed on the svix-id PK (migration 0008). Idempotent under concurrent
    // duplicates via onConflictDoNothing.
    await recordOnce(db, svixId, identityId, payload.type);
    traceAuth('webhook.done', { sub: identityId, type: payload.type, svixId });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
export const handler = withObservability(idpWebhookHandlerCore);
