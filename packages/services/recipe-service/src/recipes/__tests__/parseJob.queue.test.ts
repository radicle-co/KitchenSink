/**
 * Tests for `parseJob.queue.ts` (plan U9) — the parse-job producer port over the shared batch core.
 *
 * The chunking/partial-failure/timeout mechanics are proven by `verification.queue.test.ts` against the
 * SAME `createSqsBatchEnqueue` core; re-asserting them here would be coverage theater. What THIS port owns
 * — and what these tests prove — is its parametrization: the parse-job consumer's schema does the
 * refusing, refusals name field paths and never the cook's text, and the thrown label says which queue.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SendMessageBatchCommandInput, SendMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import type { ParseLineJobMessage } from '@kitchensink/recipe-core/parsing/parse-job-message';

import { createParseJobQueue, PARSE_JOB_QUEUE } from '../parseJob.queue.js';

const QUEUE_URL = 'http://localhost:4566/000000000000/recipe-parse-line';
const SECRET_LINE = 'my grandmother-secret 2 cups flour';

const makeMessage = (overrides: Partial<ParseLineJobMessage> = {}): ParseLineJobMessage => ({
    jobId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    lineIndex: 0,
    sourceLine: SECRET_LINE,
    lineDigest: `v1:${'b'.repeat(64)}`,
    requestedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
});

const okSend = async (): Promise<SendMessageBatchCommandOutput> => ({ $metadata: {}, Successful: [], Failed: [] });

describe('createParseJobQueue', () => {
    it('sends a valid message to the parse queue', async () => {
        const send = vi.fn(async (_input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> => ({
            $metadata: {},
            Successful: [],
            Failed: [],
        }));
        const queue = createParseJobQueue(send, QUEUE_URL);

        await queue.enqueue([makeMessage()]);

        expect(send).toHaveBeenCalledTimes(1);
        const input = send.mock.calls[0]?.[0];
        expect(input?.QueueUrl).toBe(QUEUE_URL);
        expect(JSON.parse(input?.Entries?.[0]?.MessageBody ?? '')).toEqual(makeMessage());
    });

    it('refuses a message the CONSUMER schema rejects, naming the queue and field — never the text', async () => {
        const queue = createParseJobQueue(okSend, QUEUE_URL);
        const poison = makeMessage({ lineDigest: 'not-a-digest' });

        await expect(queue.enqueue([poison])).rejects.toThrow(/parse-job enqueue: .*lineDigest/);
        await expect(queue.enqueue([poison])).rejects.toThrow(
            expect.not.objectContaining({ message: expect.stringContaining(SECRET_LINE) }),
        );
    });

    it('an empty list is a no-op and issues no call', async () => {
        const send = vi.fn(async (_input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> => ({
            $metadata: {},
            Successful: [],
            Failed: [],
        }));

        await createParseJobQueue(send, QUEUE_URL).enqueue([]);

        expect(send).not.toHaveBeenCalled();
    });

    it('exports a DI token distinct from the verification queue token', () => {
        expect(PARSE_JOB_QUEUE).toBe('PARSE_JOB_QUEUE');
    });
});
