/**
 * SqsService unit tests (CR-002): the deletion-queue message now carries the lifecycle `event` so the
 * deletion-worker can route closure (ban) vs. reactivation (unban) vs. erasure legs — extending the old
 * `{ identityId, userId, enqueuedAt, failureReason }` shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

import { SqsService } from '../sqs.service.js';
import { DeletionEnqueueError, isDeletionEnqueueError } from '../deletionEnqueue.error.js';

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

describe('SqsService.enqueueDeletion', () => {
    const send = vi.fn();
    const client = { send } as unknown as ConstructorParameters<typeof SqsService>[0];
    let service: SqsService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env['DELETION_QUEUE_URL'] = 'https://sqs.local/queue/deletion';
        service = new SqsService(client);
    });

    it('sends a message carrying the lifecycle event, identity id, and user id', async () => {
        await service.enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' });

        expect(send).toHaveBeenCalledTimes(1);
        const body = JSON.parse(vi.mocked(SendMessageCommand).mock.calls[0]![0]!.MessageBody as string);
        expect(body).toMatchObject({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' });
        expect(typeof body.enqueuedAt).toBe('string');
    });

    it('carries a reactivation event for the admin unban path', async () => {
        await service.enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'reactivation' });

        const body = JSON.parse(vi.mocked(SendMessageCommand).mock.calls[0]![0]!.MessageBody as string);
        expect(body.event).toBe('reactivation');
    });

    // ⛔ THIS TEST USED TO ASSERT THE OPPOSITE — "skips the send (no throw)". A silent skip is the second
    // invisible path to the same divergence: the account is tombstoned in the database, no ban is queued, and
    // the caller is told everything worked. It also cannot happen legitimately: `env.schema.ts` requires
    // `DELETION_QUEUE_URL` unconditionally, so an unset value at this point is a misconfiguration, and a
    // misconfiguration that announces itself with a `warn` and a `return` is one nobody finds.
    it('THROWS when the queue URL is not configured — a silent skip is a lost ban', async () => {
        delete process.env['DELETION_QUEUE_URL'];

        await expect(
            service.enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }),
        ).rejects.toThrow(DeletionEnqueueError);
        expect(send).not.toHaveBeenCalled();
    });

    // An `AccessDenied` is what actually happened in the deployed sandbox: the task role held no
    // `sqs:SendMessage` grant, so EVERY enqueue failed. It is not transient, so the SDK's retries cannot help —
    // the caller has to learn about it.
    it('wraps a send failure in DeletionEnqueueError, preserving the AWS error as the cause', async () => {
        const awsError = new Error('AccessDenied');
        send.mockRejectedValueOnce(awsError);

        const thrown = await service
            .enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' })
            .then(
                () => undefined,
                (error: unknown) => error,
            );

        expect(isDeletionEnqueueError(thrown)).toBe(true);
        expect((thrown as DeletionEnqueueError).cause).toBe(awsError);
    });

    it('does not report success — the confirmation log only follows a real send', async () => {
        send.mockRejectedValueOnce(new Error('AccessDenied'));

        await expect(
            service.enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }),
        ).rejects.toThrow();
    });
});
