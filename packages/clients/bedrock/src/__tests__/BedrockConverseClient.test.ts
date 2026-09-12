/**
 * The Bedrock boundary (plan U11, ADR-0024).
 *
 * ⛔ WHAT THIS FILE IS PROVING, and why it is not "the client calls the SDK":
 *
 *  1. **The refund rule is encoded in the TYPE, not in a comment.** ADR-0024: "any outcome with no billed
 *     response refunds in full". So a request that never produced a billed response THROWS (and every thrown
 *     error carries `settlement: 'refund-full'`), while a response that arrived RETURNS (carrying the `usage`
 *     the settlement is costed from). The settle path therefore cannot get the refund wrong by forgetting a
 *     case — it has only two shapes to handle.
 *  2. **An UNRECOGNISED failure KEEPS ITS RESERVATION.** Refunding something that was billed under-counts,
 *     and ADR-0024 spends its whole design budget on never under-counting. Over-counting is the accepted
 *     bias. Only the failures AWS documents as pre-inference refusals refund.
 *  3. **`maxTokens` is REQUIRED by the type.** Layer 1 of the six is "explicit `maxTokens` + input-token cap",
 *     and without it the reservation is a lie. A caller that forgets it does not compile.
 *  4. **SDK retries are OFF.** The reservation covers ONE call; the SDK's default three attempts would spend
 *     three times what was reserved, inside one reservation, with no counter entry for the extra two.
 *
 * ⛔ The response bodies come from AWS's published `Converse` reference (see `../__fixtures__/`), and the
 * errors are the SDK's OWN exception classes — never hand-written objects shaped to match this parser.
 */
import { AccessDeniedException, ThrottlingException } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockRuntimeClient, ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';

import { NOVA_TEXT_RESPONSE, converseResponseWith } from '../__fixtures__/converseResponse.js';
import {
    createBedrockConverseClient,
    createBedrockTransport,
    DEFAULT_REQUEST_TIMEOUT_MS,
    type BedrockTransport,
} from '../BedrockConverseClient.js';
import {
    isBedrockAccessDeniedError,
    isBedrockClientError,
    isBedrockInvalidRequestError,
    isBedrockThrottledError,
    isBedrockTimeoutError,
    isBedrockUnavailableError,
} from '../errors.js';

/** A transport that answers with `body` and records what it was asked. */
function transportReturning(body: unknown): {
    readonly send: (input: ConverseCommandInput) => Promise<unknown>;
    readonly calls: ConverseCommandInput[];
} {
    const calls: ConverseCommandInput[] = [];

    return {
        calls,
        send: (input) => {
            calls.push(input);

            return Promise.resolve(body);
        },
    };
}

/** A transport that fails with `error`. */
const transportThrowing = (error: unknown) => (): Promise<unknown> => Promise.reject(error);

const REQUEST = {
    invocationId: 'amazon.nova-micro-v1:0',
    systemPrompt: 'You verify ingredient lines.',
    userMessage: '<line>2 cups flour</line>',
    maxOutputTokens: 200,
} as const;

/** Claude Haiku 4.5's cross-region inference profile — an invocation id that is NOT a model id. */
const HAIKU_PROFILE_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Capture what the real SDK client is asked to dispatch, and stop before anything leaves the process.
 *
 * The `initialize` step runs before serialization, signing and transport, so this needs no credentials and
 * makes no call — and what it records is the `ConverseCommand`'s OWN input, not a value handed to it here.
 *
 * @param client - The SDK client to instrument.
 * @returns The array the dispatched inputs accumulate into.
 * @sideEffect Mutates the client's middleware stack; the client is single-use afterwards.
 */
function interceptDispatch(client: BedrockRuntimeClient): { readonly inputs: unknown[] } {
    const inputs: unknown[] = [];

    client.middlewareStack.add(
        () =>
            (args): Promise<never> => {
                inputs.push(args.input);

                return Promise.reject(new Error('intercepted before dispatch'));
            },
        { step: 'initialize', name: 'captureDispatchedInput' },
    );

    return { inputs };
}

/** An SDK service exception, constructed by the SDK itself so the shape is real. */
function sdkException(name: string, httpStatusCode: number): Error {
    const error = new Error(`${name} from Bedrock`);
    error.name = name;
    Object.assign(error, { $metadata: { httpStatusCode } });

    return error;
}

describe('the request the client builds', () => {
    it('sets an explicit inferenceConfig.maxTokens — layer 1 of the six', () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        return createBedrockConverseClient(transport.send)
            .converse(REQUEST)
            .then(() => {
                // ⛔ Without this the worst case is unbounded and the reservation means nothing. Bedrock
                // applies no default output cap that we may rely on.
                expect(transport.calls[0]?.inferenceConfig?.maxTokens).toBe(200);
            });
    });

    it('puts the caller’s invocationId on the SDK’s modelId, never a default', () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        return createBedrockConverseClient(transport.send)
            .converse(REQUEST)
            .then(() => {
                // The live id is resolved at cold start (ADR-0024 §3). A default here would silently outlive a
                // parameter change and bill a model nobody selected.
                expect(transport.calls[0]?.modelId).toBe('amazon.nova-micro-v1:0');
            });
    });

    it('passes an INFERENCE PROFILE id through unaltered', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        await createBedrockConverseClient(transport.send).converse({ ...REQUEST, invocationId: HAIKU_PROFILE_ID });

        // ⛔ THE REASON THE FIELD IS NOT CALLED `modelId`. Claude Haiku 4.5 reports
        // `inferenceTypesSupported: ["INFERENCE_PROFILE"]` and refuses its own bare id with
        // `ValidationException: Invocation of model ID … with on-demand throughput isn't supported`. The rate
        // table and the recorded verdict key on the BARE id, so a client that "normalised" what it was handed
        // — stripping the `us.` prefix, or resolving a model id of its own — would fail every Haiku call.
        expect(transport.calls[0]?.modelId).toBe(HAIKU_PROFILE_ID);
    });

    it('carries the system prompt separately from the user turn', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);
        await createBedrockConverseClient(transport.send).converse(REQUEST);

        const input = transport.calls[0];

        // The untrusted source line rides in the USER turn; the instructions ride in `system`. Collapsing
        // them into one string is what makes an embedded directive indistinguishable from an instruction.
        expect(input?.system).toEqual([{ text: 'You verify ingredient lines.' }]);
        expect(input?.messages).toEqual([{ role: 'user', content: [{ text: '<line>2 cups flour</line>' }] }]);
    });
});

describe('a response that arrived', () => {
    it('parses AWS’s published Converse body into text, stopReason and usage', async () => {
        const outcome = await createBedrockConverseClient(transportReturning(NOVA_TEXT_RESPONSE).send).converse(
            REQUEST,
        );

        expect(outcome).toEqual({
            kind: 'answered',
            text: '<text generated by the model>',
            stopReason: 'end_turn',
            usage: { inputTokens: 30, outputTokens: 628, totalTokens: 658 },
        });
    });

    it('leaves both cache fields ABSENT when the wire omits them', async () => {
        const outcome = await createBedrockConverseClient(transportReturning(NOVA_TEXT_RESPONSE).send).converse(
            REQUEST,
        );

        // `Required: No` on `TokenUsage`, and unreachable at this prompt size (ADR-0024 §5). Reading them as
        // `0` here would be indistinguishable from a real zero, which is what the alert depends on telling
        // apart.
        expect(outcome.kind === 'answered' && outcome.usage.cacheReadInputTokens).toBeUndefined();
        expect(outcome.kind === 'answered' && outcome.usage.cacheWriteInputTokens).toBeUndefined();
    });

    it('reads cache token counts when the wire DOES carry them', async () => {
        const body = converseResponseWith('{}', {
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                cacheReadInputTokens: 4_096,
                cacheWriteInputTokens: 0,
            },
        });
        const outcome = await createBedrockConverseClient(transportReturning(body).send).converse(REQUEST);

        expect(outcome.kind === 'answered' && outcome.usage.cacheReadInputTokens).toBe(4_096);
    });

    it.each([
        ['max_tokens'],
        ['content_filtered'],
        ['guardrail_intervened'],
        ['stop_sequence'],
        ['model_context_window_exceeded'],
    ])('passes %s through rather than judging it here', async (stopReason) => {
        const outcome = await createBedrockConverseClient(
            transportReturning(converseResponseWith('{"verdict":"agree"}', { stopReason })).send,
        ).converse(REQUEST);

        // The client's job is the BOUNDARY, not the domain rule. "Only `end_turn` may be trusted" is the
        // verifier's judgement and lives with the verdict parser; a client that silently rewrote these into
        // an error would hide from that rule the very reasons it exists for.
        expect(outcome.kind === 'answered' && outcome.stopReason).toBe(stopReason);
    });

    it.each([['malformed_model_output'], ['malformed_tool_use']])(
        'still reports %s as an arrived, BILLED response',
        async (stopReason) => {
            const outcome = await createBedrockConverseClient(
                transportReturning(converseResponseWith('{{{ not json', { stopReason })).send,
            ).converse(REQUEST);

            // ⛔ It is BILLED — the model generated those tokens. Treating a structured-output failure as an
            // unbilled failure would refund money that actually left, which is the silent under-count
            // reserve-then-settle exists to prevent.
            expect(outcome.kind).toBe('answered');
            expect(outcome.kind === 'answered' && outcome.usage.outputTokens).toBe(42);
        },
    );
});

describe('a response whose ENVELOPE cannot be read', () => {
    it.each([
        ['an empty content array', { output: { message: { role: 'assistant', content: [] } }, stopReason: 'end_turn' }],
        ['no output at all', { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }],
        [
            'a content block with no text',
            {
                output: { message: { role: 'assistant', content: [{ toolUse: { name: 'x' } }] } },
                stopReason: 'tool_use',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
        ],
        ['a completely foreign body', { hello: 'world' }],
        ['null', null],
    ])('reports %s as unusable rather than as an empty answer', async (_label, body) => {
        const outcome = await createBedrockConverseClient(transportReturning(body).send).converse(REQUEST);

        // ⛔ NEVER an empty-string `answered`. An empty answer flows into the verdict parser, which would have
        // to decide what "" means — and the only safe meaning is the one the gate exists to withhold.
        expect(outcome.kind).toBe('unusable');
    });

    it('carries the usage through an unusable envelope, because that response was still billed', async () => {
        const outcome = await createBedrockConverseClient(
            transportReturning({
                output: { message: { role: 'assistant', content: [] } },
                stopReason: 'end_turn',
                usage: { inputTokens: 660, outputTokens: 3, totalTokens: 663 },
            }).send,
        ).converse(REQUEST);

        expect(outcome.kind === 'unusable' && outcome.usage).toEqual({
            inputTokens: 660,
            outputTokens: 3,
            totalTokens: 663,
        });
    });

    it('reports an UNREADABLE usage as undefined rather than as zero', async () => {
        const outcome = await createBedrockConverseClient(
            transportReturning({
                output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
                stopReason: 'end_turn',
                usage: { inputTokens: 'lots' },
            }).send,
        ).converse(REQUEST);

        // ⛔ `undefined` and `0` mean opposite things to the settlement. Zero means "this call was free, refund
        // everything"; undefined means "we cannot know what this cost, so keep the worst case charged". A
        // parser that coerced the first into the second would refund a call that really spent money.
        expect(outcome.kind).toBe('unusable');
        expect(outcome.kind === 'unusable' && outcome.usage).toBeUndefined();
    });
});

describe('a call that produced no billed response', () => {
    it.each([
        [
            'ThrottlingException',
            new ThrottlingException({ message: 'slow down', $metadata: {} }),
            isBedrockThrottledError,
        ],
        [
            'AccessDeniedException',
            new AccessDeniedException({ message: 'no', $metadata: { httpStatusCode: 403 } }),
            isBedrockAccessDeniedError,
        ],
        ['ServiceUnavailableException', sdkException('ServiceUnavailableException', 503), isBedrockUnavailableError],
        ['InternalServerException', sdkException('InternalServerException', 500), isBedrockUnavailableError],
        ['ModelNotReadyException', sdkException('ModelNotReadyException', 429), isBedrockUnavailableError],
        ['ValidationException', sdkException('ValidationException', 400), isBedrockInvalidRequestError],
        ['ModelTimeoutException', sdkException('ModelTimeoutException', 408), isBedrockTimeoutError],
        ['TimeoutError', sdkException('TimeoutError', 0), isBedrockTimeoutError],
        ['AbortError', sdkException('AbortError', 0), isBedrockTimeoutError],
    ])('maps %s to a typed, UNBILLED error', async (_label, thrown, guard) => {
        const client = createBedrockConverseClient(transportThrowing(thrown));
        const error = await client.converse(REQUEST).catch((caught: unknown) => caught);

        expect(guard(error)).toBe(true);
        // ⛔ THE REFUND FLAG. ADR-0024: without a full refund on these, one throttling episode consumes the
        // ceiling at ZERO actual spend and then closes the gate for the rest of the month.
        expect(isBedrockClientError(error) && error.settlement).toBe('refund-full');
    });

    it.each([
        ['an error nobody enumerated', sdkException('SomeFutureException', 500)],
        ['a plain Error', new Error('socket hang up')],
        ['a thrown string', 'boom'],
    ])('assumes %s WAS billed, so nothing is refunded on a guess', async (_label, thrown) => {
        const client = createBedrockConverseClient(transportThrowing(thrown));
        const error = await client.converse(REQUEST).catch((caught: unknown) => caught);

        // ⛔ THE DIRECTION OF THE UNKNOWN. Refunding a call that WAS billed under-counts, and a counter that
        // under-reports during a runaway is worse than no counter because it reports green. Over-counting is
        // ADR-0024's accepted bias, so an unrecognised failure keeps its reservation.
        expect(isBedrockClientError(error)).toBe(true);
        expect(isBedrockClientError(error) && error.settlement).toBe('keep-reservation');
    });

    it('never carries the provider’s own message forward, even for an error nobody enumerated', async () => {
        // ⛔ THE FALLBACK IS THE LEAKY ONE. A modelled exception is replaced by a fixed sentence, so it cannot
        // leak; the unrecognised branch is the one that would be tempted to wrap `String(thrown)` — and an
        // upstream error can quote the request, which contains a user's recipe line.
        const secret = 'Malformed input request: 2 cups of Aunt Mary’s brandy';
        const client = createBedrockConverseClient(transportThrowing(sdkException(`SomeFutureException`, 500)));
        const withSecret = createBedrockConverseClient(transportThrowing(new Error(secret)));

        const modelled = await client.converse(REQUEST).catch((caught: unknown) => caught);
        const unknown = await withSecret.converse(REQUEST).catch((caught: unknown) => caught);

        expect((modelled as Error).message).toContain('bedrock:');
        expect((unknown as Error).message).not.toContain('brandy');
        expect((unknown as Error).message).toContain('bedrock:');
    });
});

describe('createBedrockTransport', () => {
    it('pins maxAttempts to 1, so one reservation buys exactly one call', async () => {
        const transport = createBedrockTransport({ region: 'us-east-1' });

        // The SDK's default is three attempts with backoff. Inside a reserve-then-settle gate that is three
        // billed calls charged against ONE worst-case reservation, with the extra two invisible to the
        // counter — the ceiling would be quietly 3x what the owner set.
        expect(await transport.client.config.maxAttempts()).toBe(1);
    });

    it('addresses the region it was given', async () => {
        const transport = createBedrockTransport({ region: 'eu-west-1' });

        expect(await transport.client.config.region()).toBe('eu-west-1');
    });

    it('lands invocationId on the ConverseCommand the SDK actually dispatches', async () => {
        const transport = createBedrockTransport({ region: 'us-east-1' });
        const dispatched = interceptDispatch(transport.client);

        await createBedrockConverseClient(transport.send)
            .converse({ ...REQUEST, invocationId: HAIKU_PROFILE_ID })
            .catch(() => undefined);

        // ⛔ THE ONE MAPPING THE PORT'S NAME NO LONGER STATES. `ConverseRequest.invocationId` and
        // `ConverseCommandInput.modelId` are deliberately different words, so nothing but this assertion says
        // the first reaches the second. Every other test in this file stops at the transport port, which is a
        // seam the tests supply — this one runs through `createBedrockTransport`'s real `new ConverseCommand`
        // and reads the input the SDK was about to serialise.
        expect(dispatched.inputs[0]).toMatchObject({ modelId: HAIKU_PROFILE_ID });
    });

    /**
     * Reads the handler options the SDK resolved for the transport's request handler. `configProvider` is
     * the promise the smithy handler resolves its options from when a plain config object is supplied —
     * internal, but the only observable seam short of a live socket, and a rename fails these tests loudly
     * rather than silently.
     */
    async function resolvedHandlerConfig(transport: BedrockTransport): Promise<Record<string, unknown>> {
        const handler = transport.client.config.requestHandler as unknown as {
            configProvider: Promise<Record<string, unknown>>;
        };

        return await handler.configProvider;
    }

    it('bounds every request with a finite deadline BY DEFAULT, so one dead socket cannot hang a caller forever', async () => {
        // ⛔ Observed live (2026-08-31): the SDK ships NO request timeout, and with `maxAttempts: 1` a single
        // silently-dropped HTTPS flow parked the full-corpus import on `epoll_wait` for 49 minutes — one
        // request sent, a partial response received, then nothing, forever. `BedrockTimeoutError` and its
        // refund-full settle path exist for exactly this outcome but can never fire on an unbounded
        // transport. The config docstring states the deadline's job — "bounds how long one reservation stays
        // outstanding" — so an UNDEFINED default contradicts the contract it sits in.
        const config = await resolvedHandlerConfig(createBedrockTransport({ region: 'us-east-1' }));

        // Pinned as a literal, not the exported constant: asserting `toBe(DEFAULT_REQUEST_TIMEOUT_MS)`
        // passes vacuously while the constant does not exist (an unresolved import is `undefined`, and so is
        // the absent config key). The export equality is asserted alongside so the two cannot drift.
        expect(config['requestTimeout']).toBe(60_000);
        expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(60_000);
    });

    it('lets a caller override the deadline without losing the bound', async () => {
        const config = await resolvedHandlerConfig(
            createBedrockTransport({ region: 'us-east-1', requestTimeoutMs: 5_000 }),
        );

        expect(config['requestTimeout']).toBe(5_000);
    });

    it('preserves disableConcurrentStreams, the SDK default a bare handler-config object silently drops', async () => {
        // ⚠️ Passing ANY plain `requestHandler` object replaces the SDK's own resolved handler options
        // wholesale. Bedrock Runtime's default handler resolves `{ disableConcurrentStreams: true }` (one
        // HTTP/2 stream per session), and losing it changes connection behaviour as a side effect of setting
        // a timeout — so the transport carries it explicitly.
        const config = await resolvedHandlerConfig(createBedrockTransport({ region: 'us-east-1' }));

        expect(config['disableConcurrentStreams']).toBe(true);
    });

    it('is pinned to bedrock-runtime, not bedrock-mantle', () => {
        // ⚠️ Bedrock exposes two endpoints tracked against SEPARATE quota allocations (plan U11). Both bake-off
        // candidates run against `bedrock-runtime`, which is also the surface layer 5's Bedrock-filtered CUR
        // line measures. A future SDK default that flipped the endpoint would silently change both the quota
        // pool and the audit, so the service is asserted rather than assumed from the import.
        expect(createBedrockTransport({ region: 'us-east-1' }).client.config.serviceId).toBe('Bedrock Runtime');
    });
});

describe('cachePoint and serviceTier — the two levers the shipped parse call needs', () => {
    /**
     * ⛔ THE 19,777-CHARACTER SYSTEM PROMPT IS 99% OF THE BILL. Measured on Nova 2 Lite: 5,025 prompt tokens
     * against 13 tokens of line and 37 of answer. Without a cache checkpoint every call pays all 5,025 as
     * fresh input; with one they are cache READS at 25% of that rate, and Nova bills cache WRITES at zero.
     */
    it('places the cachePoint AFTER the system text, so the whole prompt is the cached prefix', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        await createBedrockConverseClient(transport.send).converse({ ...REQUEST, cachePrompt: true });

        expect(transport.calls[0]?.system).toEqual([
            { text: REQUEST.systemPrompt },
            { cachePoint: { type: 'default' } },
        ]);
    });

    it('omits the cachePoint entirely when it was not asked for', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        await createBedrockConverseClient(transport.send).converse(REQUEST);

        expect(transport.calls[0]?.system).toEqual([{ text: REQUEST.systemPrompt }]);
    });

    /**
     * ⛔ `flex` IS HALF PRICE AND KEEPS THE CACHE — the distinction that rules batch out. AWS documents prompt
     * caching as supported "only for on-demand inference endpoints… not with the batch inference API", so the
     * batch tier's 50% would be bought by surrendering the 75% cache discount and would cost MORE per line.
     * Verified live 2026-08-27: flex is accepted, echoed back, and reports the same `cacheReadInputTokens`.
     */
    it('passes the service tier through when one is named', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        await createBedrockConverseClient(transport.send).converse({ ...REQUEST, serviceTier: 'flex' });

        expect(transport.calls[0]?.serviceTier).toEqual({ type: 'flex' });
    });

    it('omits the tier entirely when none is named, leaving the account default', async () => {
        const transport = transportReturning(NOVA_TEXT_RESPONSE);

        await createBedrockConverseClient(transport.send).converse(REQUEST);

        expect(transport.calls[0]).not.toHaveProperty('serviceTier');
    });
});

describe("fewShotTurns — the foodness validator's measured message turns (plan U6, KTD-E)", () => {
    const BODY = {
        output: { message: { role: 'assistant', content: [{ text: '{}' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    it('assembles the turns BEFORE the real user message, role-tagged, in order', async () => {
        const transport = transportReturning(BODY);
        const client = createBedrockConverseClient(transport.send);

        await client.converse({
            invocationId: 'amazon.nova-micro-v1:0',
            systemPrompt: 'judge foodness',
            userMessage: 'lady fingers',
            maxOutputTokens: 100,
            fewShotTurns: [
                { user: 'blorvik', assistant: '{"isFood": false, "taxonomy": "unknown word"}' },
                { user: 'springform pan', assistant: '{"isFood": false, "taxonomy": "equipment"}' },
            ],
        });

        const messages = transport.calls[0]?.messages ?? [];

        expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
        expect(messages[0]?.content?.[0]).toEqual({ text: 'blorvik' });
        expect(messages[1]?.content?.[0]).toEqual({ text: '{"isFood": false, "taxonomy": "unknown word"}' });
        expect(messages.at(-1)?.content?.[0]).toEqual({ text: 'lady fingers' });
    });

    it('⛔ absent leaves the message array byte-identical — the gate and parse legs are untouched', async () => {
        const transport = transportReturning(BODY);
        const client = createBedrockConverseClient(transport.send);

        await client.converse({
            invocationId: 'amazon.nova-micro-v1:0',
            systemPrompt: 'sys',
            userMessage: 'line',
            maxOutputTokens: 100,
        });

        expect(transport.calls[0]?.messages).toEqual([{ role: 'user', content: [{ text: 'line' }] }]);
    });
});
