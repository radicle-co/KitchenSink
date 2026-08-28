/**
 * THE BEDROCK PARSE LEG, AS A PORT (plan U22, phase 5).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22 — one answer per line, IN ORDER | "one answer per line" |
 * | KTD-12 — a call that failed is ABSENCE, never a `ParsedLine` with empty fields | "a line it could not read" |
 * | ADR-0026 §1 — the model is shown the LINE and nothing else | "the model sees the line and nothing else" |
 * | ADR-0024 — a run that under-reports its own spend is the one shape a report must not have | the cost suite |
 * | ADR-0024 §4b — membership of the rate table IS authorization | "an unpriced model is never called" |
 *
 * Every outcome here is driven from a fake `ConverseTransport`: no network, no spend.
 */
import { createBedrockConverseClient } from '@kitchensink/bedrock-client';
import {
    BEDROCK_MODEL_REGISTRY,
    NOVA_2_LITE_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { describe, it, expect } from 'vitest';

import { createLlmEngine } from '../llmEngine.js';

/** One `Converse` response body, in the SDK's own shape. */
function answer(text: string, stopReason = 'end_turn'): Record<string, unknown> {
    return {
        output: { message: { content: [{ text }] } },
        stopReason,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

/**
 * A compliant parse document, in the shape the SHIPPED PROMPT DECLARES.
 *
 * ⛔ REWRITTEN. This emitted v1's `{ measure, foods: [...] }`, and kept emitting it after the shipped prompt
 * became v5-static — a root ARRAY of `{ food_items, measurement, preparations, equipment }`. The engine
 * therefore passed every test while returning `{ unavailable: true }` for every real response: the call was
 * made, the model answered correctly, the money was spent, and the answer was discarded as unreadable. A
 * fixture that states a shape the prompt no longer asks for cannot fail when the reader is wrong.
 */
function document(name: string, measure: string | null = '1 tablespoon'): string {
    const [quantity, ...rest] = (measure ?? '').split(' ');

    return JSON.stringify([
        {
            food_items: [name],
            measurement:
                measure === null
                    ? null
                    : { quantity: quantity ?? null, unit: rest.join(' ') || null, unit_type: 'VOLUME' },
            preparations: null,
            equipment: null,
        },
    ]);
}

/**
 * An SDK-shaped failure.
 *
 * ⚠️ The NAME is what carries the settlement, not the class: `classify` reads `error.name` against its
 * `UNBILLED_FAILURES` table, exactly as the AWS SDK labels its own exceptions. Throwing a
 * `BedrockClientError` here instead would be testing a shape the SDK never produces — and would silently
 * take the "assumed BILLED" branch, which is what makes the refund assertion below meaningful.
 */
function sdkFailure(name: string): Error {
    const error = new Error(`bedrock: ${name}`);

    error.name = name;

    return error;
}

/** An engine over a scripted transport, plus the requests that transport saw. */
function makeEngine(script: (input: unknown, call: number) => unknown) {
    const seen: unknown[] = [];
    let calls = 0;
    const client = createBedrockConverseClient(async (input) => {
        seen.push(input);
        calls += 1;

        return script(input, calls);
    });

    return { seen, engine: createLlmEngine({ client, modelId: NOVA_MICRO_MODEL_ID, concurrency: 2 }) };
}

describe('createLlmEngine', () => {
    it('an unpriced model is never called at all', () => {
        // ⛔ Thrown BEFORE any call: `BEDROCK_MODEL_REGISTRY`'s own docstring says membership is
        // authorization, so an unpriced id must not be spent on and then reported with an invented cost.
        expect(() =>
            createLlmEngine({
                client: {
                    converse: async () => ({ kind: 'unusable', reason: 'x', stopReason: undefined, usage: undefined }),
                },
                modelId: 'not.a.model-v1:0',
            }),
        ).toThrow(/BEDROCK_MODEL_REGISTRY/u);
    });

    it('names itself by the model AND the prompt version, because both re-partition the cache', () => {
        const { engine } = makeEngine(() => answer(document('butter')));

        expect(engine.engine).toBe('llm');
        expect(engine.engineVersion).toMatch(new RegExp(`^${NOVA_MICRO_MODEL_ID}@`, 'u'));
    });

    it('returns one answer per line, in the order the lines were given', async () => {
        // ⛔ DISCRIMINATE ON THE USER TURN, never on the serialized whole request. This fake keyed on
        // `JSON.stringify(input).includes('sugar')`, which was unambiguous only while the system prompt was
        // 511 bytes. The shipped prompt is now 19,777 characters carrying 35 worked examples — and one of
        // them says "sugar" — so every call matched and both lines came back as sugar. The engine was fine;
        // the fixture was reading a keyword out of OUR OWN instructions.
        const { engine } = makeEngine((input) => {
            const userTurn = JSON.stringify((input as { messages?: unknown }).messages ?? '');

            return answer(document(userTurn.includes('sugar') ? 'sugar' : 'butter'));
        });
        const answers = await engine.parse(['1 tablespoon butter', '2 cups sugar']);

        expect(answers).toHaveLength(2);
        expect(answers.map((one) => ('unavailable' in one ? null : one.foods[0]?.name))).toEqual(['butter', 'sugar']);
        expect(answers.map((one) => ('unavailable' in one ? null : one.raw))).toEqual([
            '1 tablespoon butter',
            '2 cups sugar',
        ]);
    });

    it('the model sees the LINE and nothing else — no rival engine`s answer can ride along', async () => {
        // ⛔ ADR-0026 §1. The owner's constraint, verbatim: "we have to be careful not to send the failed
        // result from the CRF Lambda or any context of it so we don't poison it." `buildParsePrompt` takes
        // the line and nothing else, and this adapter must not smuggle anything in beside it.
        const { seen, engine } = makeEngine(() => answer(document('butter')));

        await engine.parse(['1 tablespoon butter']);

        expect(JSON.stringify(seen)).toContain('1 tablespoon butter');
        expect(JSON.stringify(seen)).not.toContain('crf');
    });

    describe('a line it could not read is ABSENCE, never an empty parse', () => {
        it('a call that never arrived', async () => {
            const { engine } = makeEngine(() => {
                throw sdkFailure('ThrottlingException');
            });

            expect(await engine.parse(['1 tablespoon butter'])).toEqual([{ unavailable: true }]);
        });

        it('a response whose envelope could not be read', async () => {
            const { engine } = makeEngine(() => ({ output: {} }));

            expect(await engine.parse(['1 tablespoon butter'])).toEqual([{ unavailable: true }]);
        });

        it('a response that is not the document that was asked for', async () => {
            const { engine } = makeEngine(() => answer('I am afraid I cannot help with that.'));

            expect(await engine.parse(['1 tablespoon butter'])).toEqual([{ unavailable: true }]);
        });

        it('and it does NOT take the rest of the batch with it', async () => {
            const { engine } = makeEngine((_input, call) =>
                call === 1 ? answer('nonsense') : answer(document('sugar')),
            );
            const answers = await engine.parse(['bad line', 'good line']);

            expect(answers[0]).toEqual({ unavailable: true });
            expect(answers[1]).not.toHaveProperty('unavailable');
        });
    });

    it('reads a parse out of a fenced response, because the reader can', async () => {
        // ⚠️ `recoverableParse` is consulted for a NON-compliant response only. Its own warning — "nothing
        // extracted from prose is ever … put back into a prompt" — holds: nothing here reaches a prompt.
        const { engine } = makeEngine(() => answer(`\`\`\`json\n${document('butter')}\n\`\`\``));
        const [one] = await engine.parse(['1 tablespoon butter']);

        expect(one).not.toHaveProperty('unavailable');
        expect(one !== undefined && !('unavailable' in one) ? one.foods[0]?.name : null).toBe('butter');
    });

    it('promotes the model`s measure through the SHARED reading, not an arithmetic of its own', async () => {
        // `FACT_COMPARATORS.quantity` compares READINGS, so two adapters with two arithmetics would report
        // the engines disagreeing about numbers on lines where they agree about the words.
        const { engine } = makeEngine(() => answer(document('butter', '2 cups')));
        const [one] = await engine.parse(['2 cups butter']);

        expect(one !== undefined && !('unavailable' in one) ? one.quantity : null).toEqual({ kind: 'exact', value: 2 });
        expect(one !== undefined && !('unavailable' in one) ? one.unit : null).toBe('cup');
    });

    describe('what it says it spent', () => {
        it('costs a billed answer from its own usage', async () => {
            const { engine } = makeEngine(() => answer(document('butter')));

            expect(engine.spentMicros()).toBe(0);
            await engine.parse(['1 tablespoon butter']);
            expect(engine.spentMicros()).toBeGreaterThan(0);
        });

        it('charges the WORST CASE for a response that arrived without usable token counts', async () => {
            // ⛔ Not zero. The response ARRIVED, so it was billed; absent `usage` means "cost unknown, keep
            // the reservation" and never "this call was free".
            const { engine } = makeEngine(() => ({ output: {} }));

            await engine.parse(['1 tablespoon butter']);
            expect(engine.spentMicros()).toBeGreaterThan(0);
        });

        it('charges NOTHING for a refusal AWS documents as happening before inference', async () => {
            const { engine } = makeEngine(() => {
                throw sdkFailure('AccessDeniedException');
            });

            await engine.parse(['1 tablespoon butter']);
            expect(engine.spentMicros()).toBe(0);
        });

        it('charges the worst case for a failure the client cannot recognise, because it is ASSUMED billed', async () => {
            // ⛔ The direction matters more than the number. `classify`'s own comment: "refunding a call that
            // was billed under-counts, and a counter that under-reports during a runaway reports green
            // precisely when it matters."
            const { engine } = makeEngine(() => {
                throw sdkFailure('SomeExceptionNobodyHasSeenBefore');
            });

            await engine.parse(['1 tablespoon butter']);
            expect(engine.spentMicros()).toBeGreaterThan(0);
        });
    });
});

describe('the call it makes', () => {
    /**
     * ⛔ FLEX, and it is a COST decision with a correctness constraint attached. ADR-0026 records the shipped
     * leg as "the 19,777-character v5-static prompt against Nova 2 Lite on the `flex` tier"; the client's own
     * note records why flex and not batch — "is flex, not batch. Verified live 2026-08-27 against Nova 2
     * Lite" — because batch loses prompt caching, and a 19,777-character system prompt re-billed as fresh
     * input on every line is the whole cost of this leg.
     *
     * `recipe-workers/src/parsing/llmParse.ts` already sends it. Two consumers of one decision that disagree
     * would bill differently for the same prompt with nothing pointing at why.
     */
    it('asks for the flex service tier', async () => {
        const seen: { serviceTier?: string }[] = [];

        const engine = createLlmEngine({
            client: {
                converse: async (request) => {
                    seen.push(request);

                    return { kind: 'unusable', reason: 'x', stopReason: undefined, usage: undefined };
                },
            },
            modelId: NOVA_2_LITE_MODEL_ID,
        });

        await engine.parse(['one pound of butter']);

        expect(seen[0]?.serviceTier).toBe('flex');
    });

    it('addresses the model by its INVOCATION id, which for Nova 2 Lite is a profile', () => {
        // ⛔ `us.amazon.nova-2-lite-v1:0`, not the bare model id: the registry records
        // `inferenceTypesSupported = ["INFERENCE_PROFILE"]`, so the bare id is refused at call time.
        expect(BEDROCK_MODEL_REGISTRY[NOVA_2_LITE_MODEL_ID]?.invocation.invocationId).toBe(
            'us.amazon.nova-2-lite-v1:0',
        );
    });
});
