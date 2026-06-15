import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import { UserDAO, recordOnce, releaseWebhookEvent } from '@kitchensink/identity-service/database/dao';
import { accounts, profiles, users } from '@kitchensink/identity-service/database/schema';

import { setExternalId } from '../common/identityClient.js';
import { requireEnv } from '../common/config.js';
import { getDb } from '../common/db.js';
import { resolveRequestId } from '../common/error-envelope.js';
import { emitMetric, logger, withObservability } from '../common/observability.js';
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

const sqsClient = new SQSClient({});

const enqueueDeletion = async (userId: string): Promise<void> => {
    const queueUrl = requireEnv('DELETION_QUEUE_URL');
    await sqsClient.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ userId }),
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

    const userDao = new UserDAO(db);
    const user = await userDao.upsertByIdentityId({
        identityId: data.id,
        email,
        name: buildDisplayName(data),
        picture: data.image_url ?? undefined,
    });

    await setExternalId(data.id, user.id);

    // mark sync timestamp
    await db.update(users).set({ externalIdSyncedAt: new Date() }).where(eq(users.identityId, data.id));

    // upsert profile
    await db
        .insert(profiles)
        .values({
            userId: user.id,
            displayName: buildDisplayName(data),
            avatarUrl: data.image_url ?? null,
        })
        .onConflictDoUpdate({
            target: profiles.userId,
            set: {
                displayName: buildDisplayName(data),
                avatarUrl: data.image_url ?? null,
                updatedAt: new Date(),
            },
        });

    // Backstop the account row so a webhook-first user (one who never makes a read-through request)
    // is still complete — getUserMe requires an account. Idempotent: a no-op once read-through or a
    // prior webhook created it.
    await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();

    emitMetric('UserCreatedWebhook', 1, { identityId: data.id });
    logger.info('identity-webhook: user.created processed', { requestId, identityId: data.id, userId: user.id });
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
const handleUserUpdated = async (
    data: IdentityUserData,
    db: PostgresJsDatabase<Record<string, never>>,
    requestId: string,
): Promise<void> => {
    const userDao = new UserDAO(db);
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

    // if name/picture changed -> update profiles
    const newPicture = data.image_url ?? null;

    if (displayName !== existing.name || newPicture !== existing.picture) {
        await db
            .update(profiles)
            .set({
                displayName,
                avatarUrl: newPicture,
                updatedAt: now,
            })
            .where(eq(profiles.userId, existing.id));
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

    const isFirst = await recordOnce(db, svixId);

    if (!isFirst) {
        logger.info('identity-webhook: duplicate svix-id, returning 200', { requestId, svixId });

        return { statusCode: 200, body: JSON.stringify({ ok: true, dedup: true }) };
    }

    try {
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
    } catch (err) {
        // The dedup claim (recordOnce) is taken BEFORE processing to serialize concurrent deliveries.
        // If the handler fails (transient DB error, etc.), release the claim so svix's retry
        // re-processes — otherwise the retry short-circuits to "dedup" and the event is lost. This
        // matters most for user.deleted, where a dropped retry leaves a Clerk-deleted user present.
        await releaseWebhookEvent(db, svixId).catch((releaseErr) =>
            logger.error('identity-webhook: failed to release dedup claim after handler error', {
                requestId,
                svixId,
                error: String(releaseErr),
            }),
        );

        throw err;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-018 REQ-019 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 FR-018 FR-019 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
export const handler = withObservability(idpWebhookHandlerCore);
