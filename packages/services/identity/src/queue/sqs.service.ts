import { Inject, Injectable } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { createServiceLogger } from '../observability/sentry-logging.js';

export const SQS_CLIENT = 'SQS_CLIENT';

/**
 * The lifecycle event a deletion-queue message routes (CR-002):
 * - `closure` — the deletion-worker BANS the Clerk identity (recoverable tombstone).
 * - `reactivation` — the worker UNBANS the Clerk identity (admin-mediated recovery).
 * - `erasure` — the worker fans out the recipe/food erasure legs (U3/U4 — currently a seam).
 */
export type DeletionEvent = 'closure' | 'reactivation' | 'erasure';

/** The deletion-queue message contract (extends the legacy `{ identityId, userId, enqueuedAt }` with `event`). */
export interface DeletionQueueMessage {
    /** The Clerk identity id (`sub`) the worker mutates via the Clerk admin SDK. */
    readonly identityId: string;
    /** The app ULID (for correlation/logging). */
    readonly userId: string;
    /** The lifecycle transition this message routes. */
    readonly event: DeletionEvent;
    readonly enqueuedAt: string;
    readonly failureReason?: string;
}

@Injectable()
export class SqsService {
    private readonly logger = createServiceLogger(SqsService.name);

    constructor(@Inject(SQS_CLIENT) private readonly sqs: SQSClient) {}

    /**
     * Enqueue a lifecycle message for the deletion-worker Lambda (the only holder of the Clerk secret — the
     * public-ALB service must never call Clerk). The DB state change is applied synchronously by the caller;
     * this hands the Clerk-side mutation (ban/unban/fan-out) to the worker.
     *
     * @sideEffect sends a message to the SQS deletion queue.
     */
    async enqueueDeletion(input: {
        identityId: string;
        userId: string;
        event: DeletionEvent;
        failureReason?: string;
    }): Promise<void> {
        const queueUrl = process.env['DELETION_QUEUE_URL'];

        if (!queueUrl) {
            this.logger.warn('DELETION_QUEUE_URL not configured, skipping enqueue');

            return;
        }

        const message: DeletionQueueMessage = {
            identityId: input.identityId,
            userId: input.userId,
            event: input.event,
            enqueuedAt: new Date().toISOString(),
            ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
        };

        await this.sqs.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
            }),
        );

        this.logger.log(
            'enqueued deletion message',
            JSON.stringify({ identityId: input.identityId, userId: input.userId, event: input.event }),
        );
    }
}
