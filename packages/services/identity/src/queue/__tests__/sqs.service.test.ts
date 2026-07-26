/**
 * SqsService unit tests (CR-002): the deletion-queue message now carries the lifecycle `event` so the
 * deletion-worker can route closure (ban) vs. reactivation (unban) vs. erasure legs — extending the old
 * `{ identityId, userId, enqueuedAt, failureReason }` shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

import { SqsService } from '../sqs.service.js';

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

    it('skips the send (no throw) when the queue URL is not configured', async () => {
        delete process.env['DELETION_QUEUE_URL'];

        await expect(
            service.enqueueDeletion({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }),
        ).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });
});
