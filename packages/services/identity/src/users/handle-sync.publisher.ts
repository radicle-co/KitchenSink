/**
 * The identity-side producer for the handle-sync fan-out (W8-a.2 / decision 6). When a user renames via
 * `PATCH /api/v1/users/me`, identity publishes `{ userId, displayName, sourceTimestamp }` to the global
 * handle-sync SNS topic; the recipe-workers consumer fans it out to the denormalized recipe/version handles.
 *
 * A port so the service depends on an interface, not the SNS SDK: production uses the SNS impl; local dev /
 * tests use the no-op (no topic configured), so a rename simply doesn't publish rather than failing.
 *
 * @module
 */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { HandleSyncMessage } from '@kitchensink/identity-core';

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
            await client.send(new PublishCommand({ TopicArn: config.topicArn, Message: JSON.stringify(message) }));
        },
    };
}
