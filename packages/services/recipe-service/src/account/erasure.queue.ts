/**
 * T134 — the real SQS adapter behind {@link ErasureQueuePort}.
 *
 * Wraps an `@aws-sdk/client-sqs` `SQSClient` into the narrow port `ErasureService` depends on.
 * Isolating the SDK here keeps the service unit-testable against a mock port (no network, no SDK
 * module-mocking), mirroring `photos.storage.ts` / `createS3PhotoStorage`. The adapter itself is
 * exercised against LocalStack by the integration tier (T137).
 */
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { AccountErasureMessage } from '@kitchensink/recipe-core';

/** DI token for the erasure queue port — provided by `AccountModule` via `useFactory` over the env config. */
export const ERASURE_QUEUE = 'ERASURE_QUEUE';

/** The queue the service enqueues erasure work on. Implemented for real by {@link createSqsErasureQueue}. */
export interface ErasureQueuePort {
    /**
     * Send one erasure message.
     *
     * @param message - The owner-scoped unit of work.
     * @sideEffect Issues an SQS `SendMessage` request.
     */
    enqueue(message: AccountErasureMessage): Promise<void>;
}

/** Config the SQS adapter needs (sourced from the service's env config). */
export interface SqsErasureQueueConfig {
    /** The `account-erasure` queue URL (`ACCOUNT_ERASURE_QUEUE_URL`). */
    readonly queueUrl: string;
    /** AWS region for the client. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
}

/**
 * Build an {@link ErasureQueuePort} over a real `SQSClient`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 *
 * @param config - Queue URL + client settings.
 * @returns The port the service depends on.
 */
export function createSqsErasureQueue(config: SqsErasureQueueConfig): ErasureQueuePort {
    const client = new SQSClient({
        region: config.region,
        // A custom endpoint means LocalStack (per the storage config's convention). Pin static test
        // credentials so the integration tier is self-contained rather than depending on ambient host/CI
        // AWS config. Real AWS keeps the default credential chain (the ECS task role).
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    });

    return {
        async enqueue(message: AccountErasureMessage): Promise<void> {
            await client.send(
                new SendMessageCommand({ QueueUrl: config.queueUrl, MessageBody: JSON.stringify(message) }),
            );
        },
    };
}
