/**
 * The in-loop validator ADAPTERS (plan U7, D6) — verdict mapping and the cost discipline, driven from a
 * scripted transport with no network and no spend.
 */
import { createBedrockConverseClient } from '@kitchensink/bedrock-client';
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import type { ParsedLine } from '@kitchensink/recipe-import-core';
import { describe, expect, it } from 'vitest';

import { createFoodnessValidator, createMeasurementValidator } from '../validators.js';

/** One `Converse` response body, in the SDK's own shape. */
function answer(text: string, stopReason = 'end_turn'): Record<string, unknown> {
    return {
        output: { message: { content: [{ text }] } },
        stopReason,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    };
}

function makeClient(script: (input: unknown, call: number) => unknown) {
    const seen: { messages?: { role: string; content: { text: string }[] }[] }[] = [];
    let calls = 0;

    return {
        seen,
        client: createBedrockConverseClient(async (input) => {
            seen.push(input as never);
            calls += 1;

            return script(input, calls);
        }),
    };
}

const PARSE: ParsedLine = {
    raw: '2 cups flour',
    statedMeasure: '2 cups',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    foods: [{ name: 'flour', prep: null }],
    reviewReasons: [],
    provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
};

describe('createFoodnessValidator', () => {
    it('sends the pinned few-shot TURNS and reads a judged verdict', async () => {
        const { seen, client } = makeClient(() => answer('{"isFood": false, "taxonomy": "equipment"}'));
        const validator = createFoodnessValidator(client);

        const reading = await validator.judge('springform pan');

        expect(reading).toEqual({ kind: 'judged', isFood: false, taxonomy: 'equipment' });
        // The three measured turns precede the judged name — 7 messages in all.
        expect(seen[0]?.messages).toHaveLength(7);
        expect(seen[0]?.messages?.at(-1)?.content[0]?.text).toBe('springform pan');
        expect(validator.spentMicros()).toBeGreaterThan(0);
    });

    it('an over-cap name is could-not-judge, and NOTHING is called', async () => {
        const { seen, client } = makeClient(() => answer('{}'));
        const validator = createFoodnessValidator(client);

        const reading = await validator.judge('🍎'.repeat(300));

        expect(reading.kind).toBe('could-not-judge');
        expect(seen).toHaveLength(0);
        expect(validator.spentMicros()).toBe(0);
    });

    it('a transport failure is could-not-judge — absence, never a verdict', async () => {
        const { client } = makeClient(() => {
            throw Object.assign(new Error('boom'), { name: 'InternalServerException' });
        });

        const reading = await createFoodnessValidator(client).judge('flour');

        expect(reading.kind).toBe('could-not-judge');
    });
});

describe('createMeasurementValidator — the gate machinery as a library (R7)', () => {
    const verdict = (verdictValue: string) =>
        JSON.stringify({ verdict: verdictValue, certainty: 'high', reason: 'checked' });

    it('maps agree → pass', async () => {
        const { client } = makeClient(() => answer(verdict('agree')));

        await expect(
            createMeasurementValidator(client, 'amazon.nova-micro-v1:0').judge('2 cups flour', PARSE),
        ).resolves.toBe('pass');
    });

    it('maps disagree → fail', async () => {
        const { client } = makeClient(() => answer(verdict('disagree')));

        await expect(
            createMeasurementValidator(client, 'amazon.nova-micro-v1:0').judge('2 cups flour', PARSE),
        ).resolves.toBe('fail');
    });

    it('maps abstain AND unreadable → could-not-judge', async () => {
        const { client: abstainer } = makeClient(() => answer(verdict('abstain')));
        const { client: babbler } = makeClient(() => answer('no json here'));

        await expect(
            createMeasurementValidator(abstainer, 'amazon.nova-micro-v1:0').judge('2 cups flour', PARSE),
        ).resolves.toBe('could-not-judge');
        await expect(
            createMeasurementValidator(babbler, 'amazon.nova-micro-v1:0').judge('2 cups flour', PARSE),
        ).resolves.toBe('could-not-judge');
    });

    it('a parse with an ABSENT quantity still asks — absence of a number is a claim the gate can judge', async () => {
        const { seen, client } = makeClient(() => answer(verdict('agree')));

        await createMeasurementValidator(client, 'amazon.nova-micro-v1:0').judge('flour to taste', {
            ...PARSE,
            quantity: ABSENT_QUANTITY,
            unit: null,
            statedMeasure: null,
        });

        expect(seen).toHaveLength(1);
    });
});
