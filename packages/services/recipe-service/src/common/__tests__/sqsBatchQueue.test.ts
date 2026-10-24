import { describe, expect, it, vi } from 'vitest';
import type { SendMessageBatchCommandInput, SendMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import { z } from 'zod';

import { isBatchEnqueueError } from '../batchEnqueueError.js';
import { createSqsBatchEnqueue, type SqsBatchSend } from '../sqsBatchQueue.js';

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

/**
 * ⛔ WHICH messages were lost, not just how many.
 *
 * The count above is what an operator reads; these indexes are what a CALLER acts on. `ParseJobsService`
 * converts a failed send into `failed_retryable` line rows, and without per-message attribution it had to
 * convert every message it tried to send — so one rejected entry re-drove the work that had already landed,
 * paying for a second parse of every other line in the paste.
 *
 * ⛔ ATTRIBUTION IS BY THE `Id` WE SENT, NEVER BY POSITION IN `Failed`. SQS does not promise `Failed` is
 * ordered or complete, and entry ids re-base to `'0'` at every chunk — so a positional read of a
 * second-chunk failure names a message from the first chunk, which is a line the cook would watch be
 * re-parsed while the one that actually failed sat `pending` forever.
 */
describe('createSqsBatchEnqueue — the throw names WHICH messages were lost', () => {
    const schema = z.object({ id: z.string() });
    const QUEUE_URL = 'https://sqs.example/q';

    /** `count` admissible messages, each carrying its own position so a fake `send` can tell the chunks apart. */
    function messages(count: number): readonly { readonly id: string }[] {
        return Array.from({ length: count }, (_value, index) => ({ id: `m${String(index)}` }));
    }

    /** Everything landed. `Successful` is required by the SDK's own output type, and nothing reads it. */
    const allLanded: SendMessageBatchCommandOutput = { $metadata: {}, Successful: [], Failed: [] };

    /** One rejected entry, in the shape SQS answers it. */
    function rejected(id: string | undefined): SendMessageBatchCommandOutput {
        return {
            $metadata: {},
            Successful: [],
            Failed: [{ Id: id, Code: 'InternalError', SenderFault: false }],
        };
    }

    /** A `send` that rejects `entryId` in the batch headed by `firstEntryId`, and lands every other batch. */
    function sendRejecting(firstEntryId: string, entryId: string | undefined): SqsBatchSend {
        return async (input: SendMessageBatchCommandInput) => {
            const head = input.Entries?.[0]?.MessageBody ?? '';

            return head.includes(`"id":"${firstEntryId}"`) ? rejected(entryId) : allLanded;
        };
    }

    /**
     * Enqueue and answer the positions the failure reported.
     *
     * @throws When the enqueue succeeded, or failed as something other than a `BatchEnqueueError` —
     *   either would make the assertion below vacuous.
     */
    async function lostPositions(
        enqueue: (sent: readonly { readonly id: string }[]) => Promise<void>,
        sent: readonly { readonly id: string }[],
    ): Promise<readonly number[]> {
        const thrown: unknown = await enqueue(sent).then(
            () => undefined,
            (error: unknown) => error,
        );

        if (!isBatchEnqueueError(thrown)) {
            throw new Error(`expected a BatchEnqueueError, got ${String(thrown)}`);
        }

        return thrown.undeliveredIndexes;
    }

    it('attributes a per-entry rejection to the entry SQS named, and to no other', async () => {
        const second = createSqsBatchEnqueue(schema, sendRejecting('m0', '1'), QUEUE_URL, 'parse-job enqueue');
        // The positive control for the assertion above: the SAME predicate over a response naming entry 0
        // must answer 0, or "not 0" proves only that the reader is broken in one direction.
        const first = createSqsBatchEnqueue(schema, sendRejecting('m0', '0'), QUEUE_URL, 'parse-job enqueue');

        expect(await lostPositions(second, messages(2))).toEqual([1]);
        expect(await lostPositions(first, messages(2))).toEqual([0]);
    });

    it('⛔ re-bases entry ids per batch — a second-chunk failure never names a first-chunk message', async () => {
        // 12 messages chunk as 0-9 and 10-11, and BOTH chunks carry an entry whose `Id` is '1'.
        const secondChunk = createSqsBatchEnqueue(schema, sendRejecting('m10', '1'), QUEUE_URL, 'parse-job enqueue');
        const firstChunk = createSqsBatchEnqueue(schema, sendRejecting('m0', '1'), QUEUE_URL, 'parse-job enqueue');

        expect(await lostPositions(secondChunk, messages(12))).toEqual([11]);
        expect(await lostPositions(firstChunk, messages(12))).toEqual([1]);
    });

    it('⛔ loses the WHOLE batch when a failure names no entry we sent — absent id and unknown id alike', async () => {
        const noId = createSqsBatchEnqueue(schema, sendRejecting('m0', undefined), QUEUE_URL, 'parse-job enqueue');
        const strangeId = createSqsBatchEnqueue(schema, sendRejecting('m0', '7'), QUEUE_URL, 'parse-job enqueue');

        expect(await lostPositions(noId, messages(2))).toEqual([0, 1]);
        expect(await lostPositions(strangeId, messages(2))).toEqual([0, 1]);
    });

    it('names every message of a REJECTED batch, and only that batch', async () => {
        const send: SqsBatchSend = async (input: SendMessageBatchCommandInput) => {
            if ((input.Entries?.[0]?.MessageBody ?? '').includes('"id":"m10"')) {
                throw new Error('ECONNREFUSED');
            }

            return allLanded;
        };

        const enqueue = createSqsBatchEnqueue(schema, send, QUEUE_URL, 'parse-job enqueue');

        expect(await lostPositions(enqueue, messages(12))).toEqual([10, 11]);
    });

    it("names a contract refusal by its position in the CALLER's list, not among the sendable", async () => {
        // The refusal is a RUNTIME one — the schema is narrower than the type, so an inadmissible message
        // needs no cast to construct. Position 1 is refused and never reaches `send`; the two that do land
        // must not be reported, or a caller would re-drive lines the queue already holds.
        const shaped = z.object({ id: z.string().regex(/^m\d+$/u) });
        const send = vi.fn<SqsBatchSend>(async () => allLanded);
        const enqueue = createSqsBatchEnqueue(shaped, send, QUEUE_URL, 'parse-job enqueue');

        expect(await lostPositions(enqueue, [{ id: 'm0' }, { id: 'bad' }, { id: 'm2' }])).toEqual([1]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]?.[0].Entries).toHaveLength(2);
    });
});
