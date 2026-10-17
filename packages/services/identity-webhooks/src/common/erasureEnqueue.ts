import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { idpDeletionMessageSchema } from '@kitchensink/identity-core';

const sqsClient = new SQSClient({});

/** Who an erasure message is about: the Clerk identity to delete and the app user whose data the fan-out erases. */
export interface ErasureSubject {
    /** The Clerk `sub` the deletion worker deletes. */
    readonly identityId: string;
    /** The durable app-user ULID (`users.id`) that recipe and food key their erasure on. */
    readonly userId: string;
}

/**
 * Enqueue an `erasure` message on the deletion queue.
 *
 * The ONE place this package builds that message, so the tombstone sweep (after it scrubs a row) and erasure
 * reconciliation (when a scrubbed row's Clerk deletion is unconfirmed) cannot disagree about its shape. The body
 * is parsed with `idpDeletionMessageSchema` before it is sent: the deletion worker rejects an invalid message into
 * the DLQ, so a malformed one is caught here, at the producer, instead of surfacing later as a DLQ alarm.
 *
 * The deletion worker is the only principal that mutates Clerk. Everything that discovers a missing deletion
 * enqueues this message and leaves the deletion to it.
 *
 * @param queueUrl - The deletion queue URL.
 * @param subject - The identity and user to erase.
 * @throws {ZodError} When the message would not be accepted by the worker; nothing is sent.
 * @throws When the send fails; each caller decides what a lost enqueue means for it.
 * @sideEffect Sends one SQS message.
 */
export async function enqueueErasure(queueUrl: string, subject: ErasureSubject): Promise<void> {
    const message = idpDeletionMessageSchema.parse({
        identityId: subject.identityId,
        userId: subject.userId,
        event: 'erasure',
        enqueuedAt: new Date().toISOString(),
    });

    await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
}
