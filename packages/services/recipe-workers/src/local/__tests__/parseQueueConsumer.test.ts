/**
 * The local consumer loop — the thing `RecipeWorkersStack`'s `SqsEventSource` does in a deploy and nothing
 * does locally (`up.ts` creates queues, buckets, tables and parameters; it deploys no Lambda, so the parse
 * queue filled and nothing drained it).
 *
 * ⛔ WHAT IS ASSERTED IS THE SQS CONTRACT, not the polling. A message is deleted ONLY after its handler
 * returned, because that acknowledgement IS the retry semantics `parseLine.ts` is written against: it throws
 * on a transient failure precisely so the message redelivers. A loop that deleted first would turn every
 * transient failure into a lost line locally while the deployed path retried — the exact divergence a local
 * sandbox must not have.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    drainParseQueue,
    sqsParseQueuePort,
    type ParseQueueMessage,
    type ParseQueuePort,
} from '../parseQueueConsumer.js';

/** An in-memory queue that hands out each batch once and remembers what was deleted. */
function queueOf(batches: readonly (readonly ParseQueueMessage[])[]): ParseQueuePort & { deleted: string[] } {
    const remaining = [...batches];
    const deleted: string[] = [];

    return {
        deleted,
        receive: async () => remaining.shift() ?? [],
        delete: async (receiptHandle: string) => {
            deleted.push(receiptHandle);
        },
    };
}

/** Stop after `polls` receive calls, so the loop is finite in a test without a timer. */
function stopAfter(polls: number): () => boolean {
    let seen = 0;

    return () => {
        seen += 1;

        return seen <= polls;
    };
}

describe('the local parse-queue consumer', () => {
    it('hands each message body to the handler and acknowledges it', async () => {
        const queue = queueOf([
            [
                { body: 'first', receiptHandle: 'r1' },
                { body: 'second', receiptHandle: 'r2' },
            ],
        ]);
        const handle = vi.fn(async (_body: string) => undefined);

        const summary = await drainParseQueue({
            queue,
            handle,
            onError: () => undefined,
            shouldContinue: stopAfter(2),
        });

        expect(handle.mock.calls.map(([body]) => body)).toEqual(['first', 'second']);
        expect(queue.deleted).toEqual(['r1', 'r2']);
        expect(summary).toEqual({ processed: 2, failed: 0 });
    });

    it('⛔ does NOT delete a message whose handler threw — the redelivery is the retry', async () => {
        const queue = queueOf([[{ body: 'transient', receiptHandle: 'r1' }]]);
        const failures: unknown[] = [];

        const summary = await drainParseQueue({
            queue,
            handle: async () => {
                throw new Error('parse-leg ceiling reached');
            },
            onError: (error) => failures.push(error),
            shouldContinue: stopAfter(1),
        });

        expect(queue.deleted, 'a failed line must stay on the queue, as it would in a deploy').toEqual([]);
        expect(summary).toEqual({ processed: 0, failed: 1 });
        expect(failures).toHaveLength(1);
    });

    it('⛔ keeps going after one message fails — one bad line must not stop the worker', async () => {
        const queue = queueOf([[{ body: 'bad', receiptHandle: 'r1' }], [{ body: 'good', receiptHandle: 'r2' }]]);
        const handle = vi.fn(async (body: string) => {
            if (body === 'bad') {
                throw new Error('poison');
            }
        });

        const summary = await drainParseQueue({
            queue,
            handle,
            onError: () => undefined,
            shouldContinue: stopAfter(2),
        });

        expect(queue.deleted).toEqual(['r2']);
        expect(summary).toEqual({ processed: 1, failed: 1 });
    });

    it('stops when it is told to, even with messages still arriving', async () => {
        const queue = queueOf([
            [{ body: 'a', receiptHandle: 'r1' }],
            [{ body: 'b', receiptHandle: 'r2' }],
            [{ body: 'c', receiptHandle: 'r3' }],
        ]);

        const summary = await drainParseQueue({
            queue,
            handle: async () => undefined,
            onError: () => undefined,
            shouldContinue: stopAfter(2),
        });

        expect(summary.processed).toBe(2);
        expect(queue.deleted).toEqual(['r1', 'r2']);
    });

    it('reports a receive failure and keeps polling — LocalStack restarting is not fatal', async () => {
        let call = 0;
        const deleted: string[] = [];
        const queue: ParseQueuePort = {
            receive: async () => {
                call += 1;

                if (call === 1) {
                    throw new Error('ECONNREFUSED 127.0.0.1:4566');
                }

                return [{ body: 'later', receiptHandle: 'r1' }];
            },
            delete: async (handle) => {
                deleted.push(handle);
            },
        };
        const failures: unknown[] = [];

        const summary = await drainParseQueue({
            queue,
            handle: async () => undefined,
            onError: (error) => failures.push(error),
            shouldContinue: stopAfter(2),
        });

        expect(failures).toHaveLength(1);
        expect(deleted).toEqual(['r1']);
        expect(summary.processed).toBe(1);
    });
});

/**
 * ⛔ THE SHUTDOWN PATH, which is a real defect and not an ergonomic nicety. Measured before the abort
 * signal existed: `SIGINT` flipped `shouldContinue` and the process then sat inside its 20-second long poll,
 * because the predicate is only consulted between polls. Under `turbo run dev` — which signals every service
 * at once — that reads as a worker that has hung.
 */
describe('the SQS adapter', () => {
    /** A client that records what it was asked and answers with nothing. */
    const recordingClient = () => {
        const sends: unknown[] = [];

        return {
            sends,
            send: async (command: unknown, options?: unknown) => {
                sends.push({ command, options });

                return { Messages: [] };
            },
        };
    };

    it('long-polls, takes ONE message, and passes the shutdown signal to the SDK', async () => {
        const client = recordingClient();
        const controller = new AbortController();

        await sqsParseQueuePort({
            client: client as never,
            queueUrl: 'http://localhost:4566/000000000000/q',
            waitTimeSeconds: 20,
            abortSignal: controller.signal,
        }).receive();

        const [call] = client.sends as { command: { input: Record<string, unknown> }; options: unknown }[];

        expect(call?.command.input).toMatchObject({ MaxNumberOfMessages: 1, WaitTimeSeconds: 20 });
        // Without this the SDK waits out the full poll and the signal reaches nothing.
        expect(call?.options).toEqual({ abortSignal: controller.signal });
    });

    it('⛔ an ABORTED poll is an empty batch, not a failure — the loop then exits on its own predicate', async () => {
        const controller = new AbortController();
        controller.abort();

        const port = sqsParseQueuePort({
            client: {
                send: async () => {
                    throw new Error('AbortError');
                },
            } as never,
            queueUrl: 'http://localhost:4566/000000000000/q',
            abortSignal: controller.signal,
        });

        expect(await port.receive()).toEqual([]);
    });

    it('⛔ a real transport failure still THROWS when nothing asked us to stop', async () => {
        // The other half of the rule above: absorbing every rejection would report a broker that is failing
        // as a broker that is idle, and the loop would spin silently forever.
        const port = sqsParseQueuePort({
            client: {
                send: async () => {
                    throw new Error('ECONNREFUSED');
                },
            } as never,
            queueUrl: 'http://localhost:4566/000000000000/q',
            abortSignal: new AbortController().signal,
        });

        await expect(port.receive()).rejects.toThrow('ECONNREFUSED');
    });
});
