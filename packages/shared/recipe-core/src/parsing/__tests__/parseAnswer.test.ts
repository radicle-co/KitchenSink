/**
 * THE MODEL'S ANSWER SHAPE — the boundary where 503 of Nova Micro's 508 "non-compliant" answers stop being
 * failures, and where U16's documented `null`-never-`''` invariant is finally ENFORCED.
 *
 * ⛔ THE ONE MEASUREMENT THIS FILE IS BUILT AROUND. The prompt declares `{"measure":string,...}`, and the
 * models answer `"measure": null` where the line states no measure — 503 of Micro's 508 schema misses and
 * 267 of Pro's 268. That is the model answering CORRECTLY in a shape we did not specify. Refusing it would
 * discard ~1% of good answers and would mis-attribute a schema decision as a model failure, so the zod admits
 * BOTH forms.
 *
 * ⛔ AND ADMITTING BOTH IS ONLY HALF THE JOB. `null` and `""` must collapse to ONE absent-measure value, or
 * U20's parse cache partitions on a distinction that carries no meaning — two keys, two Bedrock calls, one
 * fact. `parsedLine.ts` documents that invariant ("`null` is the one representation of 'no measure stated'.
 * An empty string is NOT a second one") and cannot enforce it, because it is a plain interface with no smart
 * constructor. THIS is the boundary where it becomes true.
 *
 * ⚠️ The same argument applies to `prep`, which the prompt already declares as `string|null`: a model that
 * answers `""` for "the line says nothing to do" is saying the same thing as `null`, and two representations
 * of one fact would make the comparator report a preparation disagreement between two engines that agree.
 */
import { describe, expect, it } from 'vitest';

import { modelParseAnswerSchema, normalizeParseAnswer } from '../parseAnswer.js';

/** Read a value the schema must accept, or fail loudly rather than silently skipping the assertion. */
function accept(value: unknown): ReturnType<typeof normalizeParseAnswer> {
    const parsed = modelParseAnswerSchema.safeParse(value);

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
        throw new Error('unreachable: the schema was asserted to accept this value');
    }

    return normalizeParseAnswer(parsed.data);
}

describe('modelParseAnswerSchema — what the model is allowed to have said', () => {
    it('accepts the declared shape', () => {
        expect(
            modelParseAnswerSchema.safeParse({ measure: '1 cup', foods: [{ name: 'flour', prep: 'sifted' }] }).success,
        ).toBe(true);
    });

    it('accepts a null measure — the 503-of-508 case', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: null, foods: [] }).success).toBe(true);
    });

    it('accepts an empty-string measure — the shape the prompt actually asked for', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: '', foods: [] }).success).toBe(true);
    });

    it('accepts a null prep', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: '', foods: [{ name: 'salt', prep: null }] }).success).toBe(
            true,
        );
    });

    it('refuses an unexpected key — the prompt named the WHOLE document', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: '', foods: [], note: 'hello' }).success).toBe(false);
    });

    it('refuses a missing foods array', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: '1 cup' }).success).toBe(false);
    });

    it('refuses a food without a name', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: '', foods: [{ prep: null }] }).success).toBe(false);
    });

    it('refuses a bare array, a bare string and null', () => {
        expect(modelParseAnswerSchema.safeParse([]).success).toBe(false);
        expect(modelParseAnswerSchema.safeParse('flour').success).toBe(false);
        expect(modelParseAnswerSchema.safeParse(null).success).toBe(false);
    });

    it('refuses a numeric measure — a number is a reading, and this field is the source WORDS', () => {
        expect(modelParseAnswerSchema.safeParse({ measure: 1, foods: [] }).success).toBe(false);
    });
});

describe('normalizeParseAnswer — one representation of "the line stated nothing"', () => {
    it('collapses a null measure and an empty measure to the SAME value', () => {
        const fromNull = accept({ measure: null, foods: [{ name: 'eggs', prep: null }] });
        const fromEmpty = accept({ measure: '', foods: [{ name: 'eggs', prep: null }] });

        // ⛔ Deep equality of the WHOLE value, not just the measure field: what U20 keys on is this object,
        // so a difference anywhere is a cache partition.
        expect(fromNull).toEqual(fromEmpty);
        expect(fromNull.statedMeasure).toBeNull();
    });

    it('collapses a whitespace-only measure too', () => {
        expect(accept({ measure: '   ', foods: [] }).statedMeasure).toBeNull();
    });

    it('keeps a stated measure in the source own words, trimmed', () => {
        expect(accept({ measure: '  the size of an egg ', foods: [] }).statedMeasure).toBe('the size of an egg');
    });

    it('collapses a null prep and an empty prep to the SAME value', () => {
        const fromNull = accept({ measure: '1 cup', foods: [{ name: 'flour', prep: null }] });
        const fromEmpty = accept({ measure: '1 cup', foods: [{ name: 'flour', prep: '' }] });

        expect(fromNull).toEqual(fromEmpty);
        expect(fromNull.foods[0]?.prep).toBeNull();
    });

    it('keeps a stated preparation, trimmed', () => {
        expect(accept({ measure: '', foods: [{ name: 'onion', prep: ' finely chopped ' }] }).foods[0]?.prep).toBe(
            'finely chopped',
        );
    });

    it('keeps every food the line named, in order', () => {
        const parse = accept({
            measure: '',
            foods: [
                { name: 'onion', prep: 'chopped' },
                { name: 'celery', prep: null },
                { name: 'carrot', prep: 'chopped' },
            ],
        });

        expect(parse.foods.map((food) => food.name)).toEqual(['onion', 'celery', 'carrot']);
    });

    it('drops a food with no name — a nameless food carries no identity to resolve', () => {
        const parse = accept({
            measure: '',
            foods: [
                { name: '  ', prep: 'chopped' },
                { name: 'carrot', prep: null },
            ],
        });

        expect(parse.foods).toEqual([{ name: 'carrot', prep: null }]);
    });

    it('yields an empty food list rather than a phantom food when the model named none', () => {
        expect(accept({ measure: null, foods: [] }).foods).toEqual([]);
    });
});
