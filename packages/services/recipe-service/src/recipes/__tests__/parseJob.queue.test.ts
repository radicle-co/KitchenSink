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

import { createParseJobQueue, fairQueuesSupported, PARSE_JOB_QUEUE } from '../parseJob.queue.js';

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

    /**
     * ⛔ U8/R3 — THE SUBMITTER IS THE TENANT. A bulk import IS a parse job: one paste becomes up to 200
     * messages from one cook, enqueued at once. Without a tenant label the queue hands a second cook's
     * single line to a poller that is two hundred messages deep in the first cook's import, which is the
     * starvation R3 names.
     *
     * ⚠️ On a STANDARD queue `MessageGroupId` is a tenant label and nothing else — it does not order
     * messages, and AWS applies fairness to any standard queue carrying it with no attribute to enable.
     */
    it("⛔ labels each message with its SUBMITTER, so one cook's import cannot starve another", async () => {
        const send = vi.fn(async (_input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> => ({
            $metadata: {},
            Successful: [],
            Failed: [],
        }));
        const queue = createParseJobQueue(send, QUEUE_URL);

        await queue.enqueue([
            makeMessage({ userId: 'user_bulk_importer', lineIndex: 0 }),
            makeMessage({ userId: 'user_one_liner', lineIndex: 1 }),
        ]);

        const entries = send.mock.calls[0]?.[0]?.Entries ?? [];
        expect(entries.map((entry) => entry.MessageGroupId)).toEqual(['user_bulk_importer', 'user_one_liner']);
    });

    /**
     * ⚠️ `userId` is optional on this contract — "absent means unattended" — and an unattended line is
     * correctly left UNLABELLED rather than pooled under a shared placeholder. AWS treats every un-grouped
     * message as its own tenant, so background work competes as itself; a literal `''` would instead make
     * all of it one very noisy tenant named for nobody.
     */
    it('⛔ omits the label entirely for unattended work — never an empty group', async () => {
        const send = vi.fn(async (_input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> => ({
            $metadata: {},
            Successful: [],
            Failed: [],
        }));
        const queue = createParseJobQueue(send, QUEUE_URL);

        await queue.enqueue([makeMessage()]);

        expect(send.mock.calls[0]?.[0]?.Entries?.[0]).not.toHaveProperty('MessageGroupId');
    });

    /**
     * ⛔ THE LABEL IS DROPPED AGAINST AN EMULATOR, AND ONLY AGAINST ONE. This is the single place where the
     * integration tier and production deliberately send different bytes, so it is asserted in BOTH
     * directions rather than left to a comment.
     *
     * AWS fair queues accept `MessageGroupId` on a STANDARD queue; LocalStack does not implement that for
     * `SendMessageBatch`. Measured on the community images this repo pins: a single `SendMessage` carrying
     * the label succeeds, and the SAME label inside a batch entry is rejected with
     * `InvalidParameterValueException` ("not valid for this queue type"). Every parse-job batch therefore
     * failed and `enqueueOrMark` converted the job's lines to `failed_retryable` — which is how four
     * integration suites went red while the production code was correct.
     *
     * ⚠️ This test is what covers the resulting gap: the integration tier proves DELIVERY without the label,
     * and this proves the LABEL at the client boundary, where no emulator is involved. Neither tier can
     * prove both, and saying so is better than a suite that appears to.
     */
    it('⛔ labels the tenant for real AWS and omits it for an emulator — the one deliberate divergence', async () => {
        const sends = [0, 1].map(() =>
            vi.fn(async (_input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> => ({
                $metadata: {},
                Successful: [],
                Failed: [],
            })),
        );

        const message = makeMessage({ userId: 'user_one_liner' });

        await createParseJobQueue(sends[0] as NonNullable<(typeof sends)[0]>, QUEUE_URL, true).enqueue([message]);
        await createParseJobQueue(sends[1] as NonNullable<(typeof sends)[1]>, QUEUE_URL, false).enqueue([message]);

        expect(sends[0]?.mock.calls[0]?.[0]?.Entries?.[0]).toHaveProperty('MessageGroupId');
        expect(sends[1]?.mock.calls[0]?.[0]?.Entries?.[0]).not.toHaveProperty('MessageGroupId');
        // ⚠️ The body is IDENTICAL either way — only the label differs, so the emulator path still proves
        // the contract the consumer parses.
        expect(sends[1]?.mock.calls[0]?.[0]?.Entries?.[0]?.MessageBody).toBe(
            sends[0]?.mock.calls[0]?.[0]?.Entries?.[0]?.MessageBody,
        );
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

    /**
     * ⛔ THE PREDICATE, NOT THE PARAMETER. The divergence test above drives `labelTenants` directly, so it
     * proves what each VALUE does and nothing about which value production picks — invert the expression
     * inside `createSqsParseJobQueue` and every one of those assertions still passes. The one caller that
     * chooses is `recipes.module.ts`, which needs an SDK client to construct, so the choice was unreachable
     * from a test until it became a named function.
     *
     * ⚠️ It is a CAPABILITY question, not a test question: fair queues are an AWS-only capability, and a
     * configured `endpoint` means the transport is not AWS SQS. The blast radius of getting it wrong is
     * bounded by `sqsBatchClientConfig`, which pins static `test` credentials off the SAME predicate — an
     * `endpoint` set in a deployed stage fails at the first send, long before a missing fairness label
     * could matter.
     */
    it('⛔ answers the CAPABILITY question — real AWS supports fair queues, an emulator endpoint does not', () => {
        expect(fairQueuesSupported({})).toBe(true);
        expect(fairQueuesSupported({ endpoint: 'http://localhost:4566' })).toBe(false);
    });

    it('exports a DI token distinct from the verification queue token', () => {
        expect(PARSE_JOB_QUEUE).toBe('PARSE_JOB_QUEUE');
    });
});
