/**
 * The identity-side producer for the handle-sync fan-out (W8-a.2 / decision 6). When a byline changes — a
 * `PATCH /api/v1/users/me` rename, or a Clerk `user.updated` that moved the name or the username — identity publishes
 * the byline snapshot `{ userId, displayName, username, sourceTimestamp }` to the global handle-sync SNS topic; the
 * recipe-workers consumer fans it out to the denormalized recipe/version copies.
 *
 * A port so the service depends on an interface, not the SNS SDK: production uses the SNS impl; local dev /
 * tests use the no-op (no topic configured), so a rename simply doesn't publish rather than failing.
 *
 * @module
 */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
    buildHandleSyncMessage,
    HANDLE_SYNC_PUBLISH_FAILED,
    handleSyncMessageSchema,
    type BylineSnapshot,
    type HandleSyncMessage,
} from '@kitchensink/identity-core';
import type { UserId } from '@kitchensink/identity-db';

/** DI token for the {@link HandleSyncPublisher}. */
export const HANDLE_SYNC_PUBLISHER = 'HANDLE_SYNC_PUBLISHER';

/** Publishes a display-name rename to the handle-sync topic. */
export interface HandleSyncPublisher {
    publish(message: HandleSyncMessage): Promise<void>;
}

/** A publisher that does nothing — used when no topic is configured (local dev / tests). */
export const noopHandleSyncPublisher: HandleSyncPublisher = {
    publish: async () => {},
};

/** Config for {@link createSnsHandleSyncPublisher}. */
export interface SnsHandleSyncConfig {
    /** The handle-sync SNS topic ARN. */
    readonly topicArn: string;
    /** AWS region. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
}

/**
 * Build an SNS-backed {@link HandleSyncPublisher}. The message is published as JSON; the recipe-workers
 * consumer unwraps the SNS envelope. A publish failure PROPAGATES so the caller decides whether a failed
 * fan-out should fail the user's rename (identity swallows it — the rename itself succeeded and the
 * reconciliation/backfill backstops a missed event).
 */
export function createSnsHandleSyncPublisher(config: SnsHandleSyncConfig): HandleSyncPublisher {
    const client = new SNSClient({
        region: config.region,
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    });

    return {
        async publish(message: HandleSyncMessage): Promise<void> {
            // ⛔ Validated against the CONSUMER's schema before it reaches the topic. `displayName` is the
            // field that needs it: it is written to `author_handles.display_name` and denormalized into two
            // more unbounded `text` columns, and the consumer trims and bounds it at
            // MAX_DISPLAY_NAME_LENGTH. A name past that bound used to be published happily and refused at the
            // far end, where the only trace was a dropped message — the rename silently never propagated.
            const validated = handleSyncMessageSchema.safeParse(message);

            if (!validated.success) {
                throw new Error('handle-sync message does not satisfy the consumer contract; not published');
            }

            await client.send(new PublishCommand({ TopicArn: config.topicArn, Message: JSON.stringify(message) }));
        },
    };
}

/** Settle the debt a byline write recorded — `UserDAO.settleHandleSync`'s shape. */
export type SettleHandleSync = (userId: UserId, owedAt: Date, failureCode: string | null) => Promise<void>;

/** What {@link publishOwedByline} did. Never a throw: the byline write it follows has already committed. */
export type OwedBylineOutcome =
    | { readonly outcome: 'published' }
    | { readonly outcome: 'owed'; readonly error: unknown; readonly settleError: unknown };

/**
 * Publish a committed byline snapshot, then settle the debt its write recorded (U9/R21; plan 2026-10-15-010 D6c).
 *
 * The ONE copy of this step. Every producer route — `PATCH /users/me`, the webhook's `user.updated`, and the create
 * paths — wrote the profile and `handle_sync_owed_at` in one statement and calls this after the commit:
 *
 *   - published → settle with `null`, which clears the debt ONLY if it still carries this write's stamp (a newer
 *     write's debt survives a slower, older publish);
 *   - failed → settle with {@link HANDLE_SYNC_PUBLISH_FAILED}, a CODE rather than the error text, which can carry the
 *     display name. The debt stays for the backstop.
 *
 * ⚠️ Best-effort by design: a failed fan-out must not fail the write it follows. It therefore never throws, and
 * reports what went wrong for the caller's own logger (the service and the Lambda log through different SDKs).
 *
 * @param publisher - The handle-sync port.
 * @param settle - Settles the debt, conditionally on the stamp.
 * @param userId - The app-user ULID.
 * @param byline - The snapshot, with the stamp its write returned.
 * @returns What happened.
 * @sideEffect Publishes to the handle-sync topic; updates `profiles` through `settle`.
 */
export async function publishOwedByline(
    publisher: HandleSyncPublisher,
    settle: SettleHandleSync,
    userId: UserId,
    byline: BylineSnapshot & { readonly stampedAt: Date },
): Promise<OwedBylineOutcome> {
    try {
        await publisher.publish(buildHandleSyncMessage(userId, byline, byline.stampedAt.toISOString()));
        await settle(userId, byline.stampedAt, null);

        return { outcome: 'published' };
    } catch (error) {
        try {
            await settle(userId, byline.stampedAt, HANDLE_SYNC_PUBLISH_FAILED);

            return { outcome: 'owed', error, settleError: undefined };
        } catch (settleError) {
            return { outcome: 'owed', error, settleError };
        }
    }
}
