/**
 * The validator loop as an ENGINE-PORT DECORATOR (plan U7, KTD-D / origin D5, D6) — invisible to the CRF
 * and to the pipeline, bounded at 3 retries, and honest about absence.
 */
import { describe, expect, it, vi } from 'vitest';

import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';

import type { EngineAnswer } from '../parseComparator.js';
import type { ParsedLine } from '../../parsedLine.js';
import { MAX_PARSE_ATTEMPTS, createValidatedLlmEngine } from '../validatedEngine.js';

const line = (foods: readonly string[], overrides: Partial<ParsedLine> = {}): ParsedLine => ({
    raw: '1 cup whatever',
    statedMeasure: '1 cup',
    quantity: { kind: 'exact', value: 1 },
    unit: 'cup',
    foods: foods.map((name) => ({ name, prep: null })),
    reviewReasons: [],
    provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
    ...overrides,
});

const judged = (isFood: boolean, taxonomy: string) => ({ kind: 'judged' as const, isFood, taxonomy });
const CANT = { kind: 'could-not-judge' as const, reason: 'no-json' as const };

function build(overrides: {
    firstAnswers?: readonly EngineAnswer[];
    retryAnswers?: readonly EngineAnswer[];
    foodness?: ReturnType<typeof vi.fn>;
    measurement?: ReturnType<typeof vi.fn>;
}) {
    const inner = {
        engine: 'llm' as const,
        engineVersion: 'model:test/v1',
        parse: vi.fn().mockResolvedValue(overrides.firstAnswers ?? [line(['flour'])]),
    };
    const retryQueue = [...(overrides.retryAnswers ?? [])];
    const retry = { parse: vi.fn().mockImplementation(() => Promise.resolve(retryQueue.shift() ?? line(['flour']))) };
    const foodness = overrides.foodness ?? vi.fn().mockResolvedValue(judged(true, 'staple'));
    const measurement = overrides.measurement ?? vi.fn().mockResolvedValue('pass');
    const engine = createValidatedLlmEngine({
        inner,
        retry,
        foodness: { judge: foodness as never },
        measurement: { judge: measurement as never },
    });

    return { engine, inner, retry, foodness, measurement };
}

describe('the pass-through path', () => {
    it('a validated first attempt rides through with llmAttempts = 1', async () => {
        const { engine, retry } = build({});

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 1 });
        expect(retry.parse).not.toHaveBeenCalled();
    });

    it("keeps the inner port identity — engine and version are the wrapped engine's", () => {
        const { engine, inner } = build({});

        expect(engine.engine).toBe('llm');
        expect(engine.engineVersion).toBe(inner.engineVersion);
    });

    it('an UNAVAILABLE first answer passes through untouched — absence is not validated', async () => {
        const { engine, foodness } = build({ firstAnswers: [{ unavailable: true }] });

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toEqual({ unavailable: true });
        expect(foodness).not.toHaveBeenCalled();
    });
});

describe('the retry loop (origin D5: max 3 retries, failure context feeds the parser)', () => {
    it('a not-a-food verdict retries WITH the category context and succeeds on attempt 2', async () => {
        const foodness = vi
            .fn()
            .mockResolvedValueOnce(judged(false, 'equipment'))
            .mockResolvedValue(judged(true, 'staple'));
        const { engine, retry } = build({
            firstAnswers: [line(['mixing bowl whip'])],
            retryAnswers: [line(['eggs'])],
            foodness,
        });

        const [answer] = await engine.parse(['In a large mixing bowl whip two eggs']);

        expect(answer).toMatchObject({ foods: [{ name: 'eggs' }], llmAttempts: 2 });
        expect(retry.parse).toHaveBeenCalledWith('In a large mixing bowl whip two eggs', [
            { kind: 'not-a-food', name: 'mixing bowl whip', taxonomy: 'equipment' },
        ]);
    });

    it('a measurement failure retries with the measurement context', async () => {
        const measurement = vi.fn().mockResolvedValueOnce('fail').mockResolvedValue('pass');
        const { engine, retry } = build({ measurement, retryAnswers: [line(['flour'])] });

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toMatchObject({ llmAttempts: 2 });
        expect(retry.parse).toHaveBeenCalledWith('1 cup flour', [{ kind: 'measurement', statedByModel: '1 cup' }]);
    });

    it('⛔ exhaustion is the recorded terminal state: foods EMPTY, not_a_food reason, nothing bound (R6)', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [line(['a bowl']), line(['a bowl']), line(['a bowl'])],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
        expect(answer).toMatchObject({
            raw: 'a bowl',
            foods: [],
            quantity: ABSENT_QUANTITY,
            reviewReasons: ['not_a_food'],
            llmAttempts: MAX_PARSE_ATTEMPTS,
        });
    });

    it('⛔ could-not-judge does NOT retry and does not count an attempt — absence, never a verdict (R25)', async () => {
        const foodness = vi.fn().mockResolvedValue(CANT);
        const { engine, retry } = build({ firstAnswers: [line(['blorvik'])], foodness });

        const [answer] = await engine.parse(['1 cup blorvik']);

        expect(retry.parse).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ foods: [{ name: 'blorvik' }], llmAttempts: 1 });
    });

    it('an UNAVAILABLE retry yields absence — a known-bad parse must never publish, a transient must retry upstream', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [{ unavailable: true }],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect(answer).toEqual({ unavailable: true });
    });
});

describe('batch discipline', () => {
    it('answers one per line in order, validating each independently', async () => {
        const foodness = vi
            .fn()
            .mockImplementation((name: string) =>
                Promise.resolve(name === 'a bowl' ? judged(false, 'equipment') : judged(true, 'staple')),
            );
        const { engine } = build({
            firstAnswers: [line(['flour']), line(['a bowl'])],
            retryAnswers: [line(['eggs'])],
            foodness,
        });

        const answers = await engine.parse(['1 cup flour', 'a bowl of eggs']);

        expect(answers).toHaveLength(2);
        expect(answers[0]).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 1 });
        expect(answers[1]).toMatchObject({ foods: [{ name: 'eggs' }], llmAttempts: 2 });
    });
});
