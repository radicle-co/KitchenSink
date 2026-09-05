import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createSqsBatchEnqueue } from '../sqsBatchQueue.js';

/**
 * The count in the thrown message is what an operator reads during an outage, so it must be a count of
 * MESSAGES.
 *
 * ⛔ THE BUG THIS PINS WAS OBSERVED IN PRODUCTION-SHAPED CI, NOT IMAGINED. The Maestro run of 2026-09-04
 * logged, verbatim:
 *
 *     enqueue failed, marking 2 line(s) failed_retryable — parse-job enqueue:
 *     1 of 2 messages were not delivered — batch 0 failed: AggregateError [ECONNREFUSED]
 *
 * Two lines were lost and the operator-facing half of the same sentence said one. `problems` accumulates one
 * entry per REFUSED MESSAGE, one per FAILED ENTRY — and one per REJECTED BATCH, which is up to
 * `SQS_BATCH_LIMIT` messages. Only the batch arm is wrong, and it is the arm that fires when the queue is
 * unreachable, i.e. exactly when the number matters most and is least likely to be double-checked.
 */
describe('createSqsBatchEnqueue — the undelivered count is MESSAGES, not problems', () => {
    const schema = z.object({ id: z.string() });

    it('counts every message in a rejected batch, not the batch as one', async () => {
        const send = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const enqueue = createSqsBatchEnqueue(schema, send, 'https://sqs.example/q', 'parse-job enqueue');

        const thrown = await enqueue([{ id: 'a' }, { id: 'b' }]).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('2 of 2 messages were not delivered');
    });

    it('still counts a contract refusal as the one message it is', async () => {
        const send = vi.fn().mockResolvedValue({ Failed: [] });
        const enqueue = createSqsBatchEnqueue(schema, send, 'https://sqs.example/q', 'parse-job enqueue');

        const thrown = await enqueue([{ id: 'a' }, { nope: true } as unknown as { id: string }]).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect((thrown as Error).message).toContain('1 of 2 messages were not delivered');
    });

    it('counts a per-entry rejection inside an otherwise successful batch as one message', async () => {
        const send = vi.fn().mockResolvedValue({ Failed: [{ Id: '0', Code: 'InternalError' }] });
        const enqueue = createSqsBatchEnqueue(schema, send, 'https://sqs.example/q', 'parse-job enqueue');

        const thrown = await enqueue([{ id: 'a' }, { id: 'b' }]).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect((thrown as Error).message).toContain('1 of 2 messages were not delivered');
    });

    it('does not throw when everything lands', async () => {
        const send = vi.fn().mockResolvedValue({ Failed: [] });
        const enqueue = createSqsBatchEnqueue(schema, send, 'https://sqs.example/q', 'parse-job enqueue');

        await expect(enqueue([{ id: 'a' }, { id: 'b' }])).resolves.toBeUndefined();
    });
});
