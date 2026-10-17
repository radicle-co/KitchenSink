/**
 * The ONE producer of an `erasure` deletion-queue message from this package (P1 #5).
 *
 * Two callers need it - the tombstone sweep (after it scrubs a row) and erasure reconciliation (when a scrubbed row's
 * Clerk deletion is still unconfirmed) - and the deletion worker REJECTS a message that does not match
 * `idpDeletionMessageSchema` into the DLQ. So the shape is validated here, at the producer, where the bug is, rather
 * than minutes later in a queue.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqsSend } = vi.hoisted(() => ({ sqsSend: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof sqsSend }) {
        this.send = sqsSend;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { idpDeletionMessageSchema } from '@kitchensink/identity-core';

import { enqueueErasure } from '../erasureEnqueue.js';

const QUEUE = 'https://sqs.local/queue/deletion';

beforeEach(() => {
    vi.clearAllMocks();
    sqsSend.mockResolvedValue({});
});

describe('enqueueErasure', () => {
    it('sends ONE message to the given queue that the deletion worker accepts as an erasure', async () => {
        await enqueueErasure(QUEUE, { identityId: 'user_a', userId: '01USER0000000000000000000A' });

        expect(sqsSend).toHaveBeenCalledTimes(1);
        const input = vi.mocked(SendMessageCommand).mock.calls[0]![0]!;
        expect(input.QueueUrl).toBe(QUEUE);

        const parsed = idpDeletionMessageSchema.parse(JSON.parse(input.MessageBody as string));
        expect(parsed).toMatchObject({
            event: 'erasure',
            identityId: 'user_a',
            userId: '01USER0000000000000000000A',
        });
        expect(parsed.enqueuedAt).toEqual(expect.any(String));
    });

    it('⛔ validates at the PRODUCER: a message the worker would reject is never sent', async () => {
        await expect(enqueueErasure(QUEUE, { identityId: '', userId: '01USER0000000000000000000A' })).rejects.toThrow();
        await expect(enqueueErasure(QUEUE, { identityId: 'user_a', userId: '' })).rejects.toThrow();

        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('lets a send failure reach the caller (each caller decides what a lost enqueue means)', async () => {
        sqsSend.mockRejectedValueOnce(new Error('sqs down'));

        await expect(enqueueErasure(QUEUE, { identityId: 'user_a', userId: 'u1' })).rejects.toThrow('sqs down');
    });
});
