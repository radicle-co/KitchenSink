import { Inject, Injectable } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { idpDeletionMessageSchema } from '@kitchensink/identity-core';

import { createServiceLogger } from '@kitchensink/service-logging';
import type { DeletionEvent, DeletionQueueMessage } from '../types/deletion.js';
import { DeletionEnqueueError } from './deletionEnqueue.error.js';

export const SQS_CLIENT = 'SQS_CLIENT';

@Injectable()
export class SqsService {
    private readonly logger = createServiceLogger(SqsService.name);

    constructor(@Inject(SQS_CLIENT) private readonly sqs: SQSClient) {}

    /**
     * Enqueue a lifecycle message for the deletion-worker Lambda (the only holder of the Clerk secret — the
     * public-ALB service must never call Clerk). The DB state change is applied synchronously by the caller;
     * this hands the Clerk-side mutation (ban/unban/fan-out) to the worker.
     *
     * ⚠️ IT THROWS, AND CALLERS MUST NOT SWALLOW IT. A message that is not queued means the Clerk-side mutation
     * never happens: a closed account whose sessions stay alive, or a recovered account that stays banned. See
     * {@link DeletionEnqueueError} for why that is the security control failing rather than a best-effort miss.
     *
     * @sideEffect sends a message to the SQS deletion queue.
     * @throws {DeletionEnqueueError} When the queue is unconfigured or the send fails.
     */
    async enqueueDeletion(input: {
        identityId: string;
        userId: string;
        event: DeletionEvent;
        failureReason?: string;
    }): Promise<void> {
        const queueUrl = process.env['DELETION_QUEUE_URL'];

        if (!queueUrl) {
            // NOT a `warn` + `return`. `env.schema.ts` requires `DELETION_QUEUE_URL` unconditionally, so an
            // unset value here is a misconfiguration that cannot arise from a legitimate deployment — and the
            // old silent skip made it indistinguishable from a successful enqueue at every call site.
            throw new DeletionEnqueueError(`DELETION_QUEUE_URL is not configured; ${input.event} was not queued`);
        }

        const message: DeletionQueueMessage = {
            identityId: input.identityId,
            userId: input.userId,
            event: input.event,
            enqueuedAt: new Date().toISOString(),
            ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
        };

        // ⛔ VALIDATED AGAINST THE CONSUMER'S OWN SCHEMA BEFORE IT IS SENT, never a copy of it. The contract
        // moved to `@kitchensink/identity-core` for exactly this: the producer used to build the body from a
        // local interface while the worker parsed it with a zod schema it owned alone, so the two could drift
        // and the first sign would be a message dead-lettering after five deliveries. A body this refuses
        // could never have been acted on, so failing here — where the caller still has the request — beats
        // discovering it on a queue.
        const validated = idpDeletionMessageSchema.safeParse(message);

        if (!validated.success) {
            throw new DeletionEnqueueError(
                `${input.event} was not queued: the message does not satisfy the deletion-queue contract`,
            );
        }

        try {
            await this.sqs.send(
                new SendMessageCommand({
                    QueueUrl: queueUrl,
                    MessageBody: JSON.stringify(message),
                }),
            );
        } catch (err) {
            // Wrapped, not re-thrown bare, so every caller can recognise "the lifecycle mutation is missing"
            // without matching on AWS error shapes. The original — an `AccessDenied` when the task role lacks
            // `sqs:SendMessage`, which is what really happened — survives as `cause`.
            throw new DeletionEnqueueError(`failed to enqueue the ${input.event} message`, { cause: err });
        }

        this.logger.log(
            'enqueued deletion message',
            JSON.stringify({ identityId: input.identityId, userId: input.userId, event: input.event }),
        );
    }
}
