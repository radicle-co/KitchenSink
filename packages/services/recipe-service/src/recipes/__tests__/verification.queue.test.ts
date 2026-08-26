/**
 * THE SQS ADAPTER'S OWN RULES (plan U11 / ADR-0024) — the three a fake port cannot exercise and the
 * integration tier cannot induce.
 *
 * The adapter began as a thin `client.send`, and a thin adapter deserves only an integration test. It is not
 * thin any more, and each rule below exists because its absence is a real failure:
 *
 *  1. **A message the CONSUMER's schema would refuse is never sent.** Producer and consumer are different
 *     packages that deploy separately, and three fields are bounded more tightly here than by the wire or
 *     the column feeding them: `unit` is unbounded `text` on the wire, `candidateFoodName` is food-service's
 *     `text`, and `sourceLine`'s cap counts CODE POINTS. An unparsed message is POISON — redelivered 20
 *     times under `maxReceiveCount`, then resident three days in a DLQ holding a cook's recipe text, while
 *     the API reports success. ⛔ LocalStack accepts poison happily, so ONLY this tier can prove it is
 *     refused.
 *  2. **One bad batch never abandons the others.** A mid-loop `throw` would drop the other ninety messages
 *     of a hundred-line recipe — and `RecipesService` swallows the error, so nothing would ever say so.
 *     LocalStack will not manufacture a partial-batch failure on request; only an injected transport can.
 *  3. **A `2xx` carrying a populated `Failed` array is a FAILURE.** SQS reports partial batch failures in the
 *     body, not the status, so an unchecked call reports success having delivered nothing.
 *
 * The transport is injected exactly as `@kitchensink/bedrock-client` injects `ConverseTransport`, and for the
 * same reason: everything worth testing here is the logic AROUND the SDK call.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SendMessageBatchCommandInput, SendMessageBatchCommandOutput } from '@aws-sdk/client-sqs';
import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import {
    createSqsVerificationTransport,
    createVerificationQueue,
    sqsClientConfig,
    type VerificationBatchSend,
} from '../verification.queue.js';

const QUEUE_URL = 'http://localhost:4566/000000000000/recipe-verification';
const SOURCE_LINE = '2 cups all-purpose flour, sifted';

const makeMessage = (overrides: Partial<VerifyIngredientLineMessage> = {}): VerifyIngredientLineMessage => ({
    recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    sourceLine: SOURCE_LINE,
    foodId: '01JFOOD000000000000000000',
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'unattributed',
    shortlist: [],
    requestedAt: '2026-08-22T10:00:00.000Z',
    ...overrides,
});

/** A transport that records every batch it was handed and answers with a clean `SendMessageBatch` result. */
function recordingSend(): {
    readonly send: VerificationBatchSend;
    readonly calls: SendMessageBatchCommandInput[];
} {
    const calls: SendMessageBatchCommandInput[] = [];

    return {
        calls,
        send: async (input): Promise<SendMessageBatchCommandOutput> => {
            calls.push(input);

            return { $metadata: {}, Successful: [], Failed: [] };
        },
    };
}

describe('createVerificationQueue — nothing unsendable leaves the process', () => {
    it('sends a well-formed message to the configured queue', async () => {
        const { send, calls } = recordingSend();

        await createVerificationQueue(send, QUEUE_URL).enqueue([makeMessage()]);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.QueueUrl).toBe(QUEUE_URL);
        expect(calls[0]?.Entries).toHaveLength(1);
    });

    /**
     * ⛔ THE REGRESSION THIS FILE EXISTED TO CATCH AND DID NOT.
     *
     * `ownerId` shipped as `z.ulid()`. `z.object` refuses the WHOLE message when one field fails, and the
     * partition above drops a refused message by design — so a recipe whose owner id merely failed a format
     * check had every one of its lines silently dropped, and the gate verified nothing for it. Four
     * integration cases caught it (`expected [] to have a length of 1`) only because their owner fixture
     * happened to read like a ULID without being one; nothing at THIS layer, where the drop happens, said a
     * word.
     *
     * ⚠️ REWRITTEN for the 2026-08-25 owner ruling (ADR-0027), which REMOVED `ownerId` from the contract:
     * it existed only so a memo's phrase could be erased, and migration 0033 removed the memo's person column
     * and the sweep, leaving it with no consumer at all. The regression above is the reason this assertion
     * survives in a stronger form rather than being deleted with the field.
     *
     * ⛔ What it pins NOW is the property that makes removing a field SAFE IN BOTH DEPLOY DIRECTIONS: the
     * queue holds messages from the previous producer that still carry `ownerId`, and `z.object` STRIPS an
     * unknown key rather than refusing the message. If that ever became `z.strict()`, every in-flight message
     * would be dropped by the very partition this suite covers — the same silent, whole-recipe drop the
     * `z.ulid()` defect caused, arriving by a different route.
     */
    it('sends a message still carrying the REMOVED ownerId — an unknown key is stripped, never a veto', async () => {
        const send = vi.fn().mockResolvedValue({ failedIds: [] });

        await createVerificationQueue(send, QUEUE_URL).enqueue([
            makeMessage({ ownerId: 'not-a-ulid' } as Record<string, unknown>),
        ]);

        expect(send).toHaveBeenCalledTimes(1);
    });

    it('issues NO call at all for an empty list', async () => {
        // An empty `Entries` list is not merely wasteful — SQS refuses it outright with
        // `AWS.SimpleQueueService.EmptyBatchRequest` (verified against LocalStack in this tree), so an
        // unguarded call would turn every hand-authored recipe save into a logged error.
        const { send, calls } = recordingSend();

        await createVerificationQueue(send, QUEUE_URL).enqueue([]);

        expect(calls).toHaveLength(0);
    });

    it('⛔ refuses a message the CONSUMER would reject, and still sends the good one', async () => {
        // `unit` has NO maximum on the wire and its column is `text`, so a client really can store a value
        // this contract refuses. The valid line must still reach the gate.
        const { send, calls } = recordingSend();
        const queue = createVerificationQueue(send, QUEUE_URL);

        await expect(queue.enqueue([makeMessage({ unit: 'x'.repeat(65) }), makeMessage()])).rejects.toThrow(
            /refused by the contract/u,
        );

        expect(calls[0]?.Entries).toHaveLength(1);
    });

    it('⛔ refuses an over-cap source line measured in CODE POINTS, matching the policy that admitted it', async () => {
        const { send, calls } = recordingSend();
        const queue = createVerificationQueue(send, QUEUE_URL);
        const over = '\u{1F355}'.repeat(401);

        await expect(queue.enqueue([makeMessage({ sourceLine: over })])).rejects.toThrow(/sourceLine/u);
        expect(calls).toHaveLength(0);
    });

    it('⛔ does NOT put the cook’s source line in the error it throws', async () => {
        // Refusing the message exists partly to keep recipe text out of places it does not belong. An error
        // string that quoted the line would put it straight into a log group instead — the same leak by a
        // different door.
        const { send } = recordingSend();
        const queue = createVerificationQueue(send, QUEUE_URL);

        const error = await queue.enqueue([makeMessage({ unit: 'x'.repeat(65) })]).catch((caught: unknown) => caught);

        expect(String(error)).not.toContain(SOURCE_LINE);
        expect(String(error)).toContain('unit');
    });
});

describe('createVerificationQueue — a partial failure is a failure, and never abandons the rest', () => {
    it('⛔ reports a 2xx that carried a populated Failed array', async () => {
        // SQS reports partial batch failures in the BODY, not the status.
        const send: VerificationBatchSend = async () => ({
            $metadata: {},
            Successful: [],
            Failed: [{ Id: '0', Code: 'InternalError', SenderFault: false, Message: 'boom' }],
        });

        await expect(createVerificationQueue(send, QUEUE_URL).enqueue([makeMessage()])).rejects.toThrow(
            /entry 0 rejected: InternalError/u,
        );
    });

    it('⛔ still sends every OTHER batch when one of them throws', async () => {
        // ⛔ THE MUTATION THIS CATCHES: a `throw` inside the send loop. With 11 messages (two batches) a
        // failing first batch would silently drop the second — and the caller swallows the error, so nothing
        // anywhere would say so.
        const seen: number[] = [];
        let call = 0;

        const send: VerificationBatchSend = async (input) => {
            call += 1;
            seen.push(input.Entries?.length ?? 0);

            if (call === 1) {
                throw new Error('throttled');
            }

            return { $metadata: {}, Successful: [], Failed: [] };
        };

        await expect(
            createVerificationQueue(send, QUEUE_URL).enqueue(Array.from({ length: 11 }, () => makeMessage())),
        ).rejects.toThrow(/throttled/u);

        expect(seen).toHaveLength(2);
    });

    it('reports EVERY failing batch, not just the first', async () => {
        const send: VerificationBatchSend = async () => {
            throw new Error('unreachable');
        };

        const error = await createVerificationQueue(send, QUEUE_URL)
            .enqueue(Array.from({ length: 21 }, () => makeMessage()))
            .catch((caught: unknown) => caught);

        expect(String(error)).toContain('3 of 21 messages');
    });

    it('chunks at SQS’s limit of ten entries per call', async () => {
        const { send, calls } = recordingSend();

        await createVerificationQueue(send, QUEUE_URL).enqueue(Array.from({ length: 25 }, () => makeMessage()));

        expect(calls.map((input) => input.Entries?.length)).toEqual([10, 10, 5]);
    });

    it('gives every entry of ONE call a distinct Id — which is what a Failed entry names', async () => {
        const { send, calls } = recordingSend();

        await createVerificationQueue(send, QUEUE_URL).enqueue(Array.from({ length: 12 }, () => makeMessage()));

        for (const input of calls) {
            const ids = (input.Entries ?? []).map((entry) => entry.Id);

            expect(new Set(ids).size).toBe(ids.length);
        }
    });
});

describe('createSqsVerificationTransport — the client is BOUNDED, because this runs on a user’s save', () => {
    it('⛔ pins both timeouts and a retry budget — the SDK sets NEITHER timeout by default', async () => {
        // ⛔ Verified against `@smithy/node-http-handler` in this tree: `setConnectionTimeout(request, reject,
        // timeoutInMs = 0)` and `setRequestTimeout(req, reject, timeoutInMs = 0)` BOTH return `-1` when the
        // value is falsy. Without these, a blackholed endpoint hangs `POST /api/v1/recipes` until the ALB's
        // idle timeout and hands the cook a 504 on a recipe that WAS created — the exact availability
        // regression `requestVerification`'s try/catch is supposed to prevent, arriving through the one door
        // a try/catch does not cover.
        // ⚠️ Asserted against the PURE config rather than the constructed client on purpose: `NodeHttpHandler`
        // resolves its own settings lazily, and `client.config.requestHandler.httpHandlerConfigs()` answers
        // `{}` until a request has actually run — so a guard that read the built client would read empty and
        // pass whatever the code said. Measured in this tree; that is why the config is a function.
        const built = sqsClientConfig({ queueUrl: QUEUE_URL, region: 'us-east-1' });
        const handler = built.requestHandler as { connectionTimeout: number; requestTimeout: number };

        expect(handler.connectionTimeout).toBeGreaterThan(0);
        expect(handler.requestTimeout).toBeGreaterThan(0);
        expect(built.maxAttempts).toBeLessThanOrEqual(2);

        // And the constructed client really does carry it, so the pure value is not asserted in a vacuum.
        const { client } = createSqsVerificationTransport({ queueUrl: QUEUE_URL, region: 'us-east-1' });

        expect(await client.config.maxAttempts()).toBe(built.maxAttempts);
        client.destroy();
    });

    it('sends through a real SendMessageBatchCommand carrying the caller’s queue URL', async () => {
        // The transport is the ONE place the command object is constructed; everything else takes a plain
        // input. A spy here proves the composition without reaching the network.
        const transport = createSqsVerificationTransport({ queueUrl: QUEUE_URL, region: 'us-east-1' });
        const spy = vi.spyOn(transport.client, 'send').mockResolvedValue(undefined as never);

        await transport.send({ QueueUrl: QUEUE_URL, Entries: [{ Id: '0', MessageBody: '{}' }] });

        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        transport.client.destroy();
    });
});
