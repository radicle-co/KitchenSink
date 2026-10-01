/**
 * THE MODEL'S ANSWER SHAPE — the boundary where the relational document v5 declares becomes the one value
 * the system may hold, and where the `null`-never-`''` invariant is ENFORCED.
 *
 * ⛔ REWRITTEN WITH THE PROMPT SWAP, and the old contract is recorded rather than erased. v1 declared a FLAT
 * `{"measure":string,"foods":[{name,prep}]}` and this file existed to admit `measure: null` — 503 of Nova
 * Micro's 508 "schema misses" were the model answering correctly in a shape we had not specified. v5 declares
 * a ROOT ARRAY of relational records instead, so the absent-measure case is now `measurement: null` and the
 * admitting is structural rather than a widening.
 *
 * ⛔ WHAT DID NOT CHANGE IS THE COLLAPSE. `null` and `""` must reach ONE absent value, or U20's parse cache
 * partitions on a distinction carrying no meaning — two keys, two Bedrock calls, one fact. `parsedLine.ts`
 * documents that invariant and cannot enforce it, being a plain interface with no smart constructor. THIS is
 * still the boundary where it becomes true, for the measure phrase and for `prep` alike.
 */
import { describe, expect, it } from 'vitest';

import { modelParseAnswerSchema, normalizeParseAnswer } from '../parseAnswer.js';
import type { ModelParseAnswer } from '../parseAnswer.js';

describe('modelParseAnswerSchema — the relational document v5 asks for', () => {
    const record = (over: Record<string, unknown> = {}): unknown => ({
        food_items: ['flour'],
        measurement: { quantity: '2', unit: 'cups', unit_type: 'VOLUME' },
        preparations: null,
        equipment: null,
        ...over,
    });

    it('accepts the declared shape — a ROOT ARRAY of records', () => {
        expect(modelParseAnswerSchema.safeParse([record()]).success).toBe(true);
    });

    /**
     * ⛔ REVERSED DELIBERATELY. The old assertion read "refuses a bare array"; under v1's flat document an
     * array was malformed. v5's declared document IS an array, so the same assertion inverted rather than
     * being deleted — a bare OBJECT is now the malformed shape.
     */
    it('refuses a bare object, a bare string and null — the document is the array', () => {
        expect(modelParseAnswerSchema.safeParse(record()).success).toBe(false);
        expect(modelParseAnswerSchema.safeParse('[]').success).toBe(false);
        expect(modelParseAnswerSchema.safeParse(null).success).toBe(false);
    });

    it('accepts the EMPTY array — "no culinary content" is an answer the prompt names', () => {
        expect(modelParseAnswerSchema.safeParse([]).success).toBe(true);
    });

    it('accepts null in every nullable slot the schema declares', () => {
        expect(
            modelParseAnswerSchema.safeParse([
                { food_items: null, measurement: null, preparations: null, equipment: null },
            ]).success,
        ).toBe(true);
    });

    it('refuses an unexpected key — the prompt named the WHOLE document', () => {
        expect(modelParseAnswerSchema.safeParse([record({ notes: 'hi' })]).success).toBe(false);
    });

    it('refuses a record missing a declared key', () => {
        expect(modelParseAnswerSchema.safeParse([{ food_items: ['flour'] }]).success).toBe(false);
    });

    it('refuses a NUMERIC quantity — a number is a reading, this field is the source WORDS', () => {
        expect(
            modelParseAnswerSchema.safeParse([
                record({ measurement: { quantity: 2, unit: 'cups', unit_type: 'VOLUME' } }),
            ]).success,
        ).toBe(false);
    });

    /**
     * ⚠️ `unit_type` is admitted as any string rather than as the prompt's six-value enum, and that is a
     * DECISION. The projection DISCARDS it, so enum-validating would turn a usable parse into a contract
     * failure over a value nothing reads. The `strictObject` rule exists to refuse EXTRA keys — an injected
     * instruction's echo riding in a field nothing reads — not to narrow a discarded one.
     */
    it('admits an unrecognised unit_type rather than failing a parse over a value it discards', () => {
        expect(
            modelParseAnswerSchema.safeParse([
                record({ measurement: { quantity: '2', unit: 'c', unit_type: 'LENGTH' } }),
            ]).success,
        ).toBe(true);
    });
});

describe('normalizeParseAnswer — projecting the relational document', () => {
    const one = (over: Record<string, unknown> = {}): ModelParseAnswer =>
        modelParseAnswerSchema.parse([
            { food_items: ['flour'], measurement: null, preparations: null, equipment: null, ...over },
        ]);

    it('rejoins the model own quantity and unit into ONE phrase for the shared measure reader', () => {
        // ⛔ Rejoined rather than threaded through as two fields: `promoteCrfReading` and `promoteLlmParse`
        // must call the SAME `readStatedMeasure`, so that a fact read by one engine and a fact read by the
        // other "differ only in WHAT was read, never in HOW it was turned into a value".
        const parse = normalizeParseAnswer(
            one({ measurement: { quantity: '1 2/3', unit: 'cups', unit_type: 'VOLUME' } }),
        );

        expect(parse.statedMeasure).toBe('1 2/3 cups');
    });

    it('keeps a stated amount with NO unit, and a stated unit with no amount', () => {
        expect(
            normalizeParseAnswer(one({ measurement: { quantity: '7', unit: null, unit_type: 'COUNT' } })).statedMeasure,
        ).toBe('7');
        expect(
            normalizeParseAnswer(one({ measurement: { quantity: null, unit: 'pinch', unit_type: 'UNKNOWN' } }))
                .statedMeasure,
        ).toBe('pinch');
    });

    it('collapses a null measurement and an all-null measurement to the SAME value', () => {
        expect(normalizeParseAnswer(one({ measurement: null })).statedMeasure).toBeNull();
        expect(
            normalizeParseAnswer(one({ measurement: { quantity: null, unit: null, unit_type: null } })).statedMeasure,
        ).toBeNull();
    });

    it('carries each record OWN preparations onto that record foods, not the first record', () => {
        const answer = modelParseAnswerSchema.parse([
            { food_items: ['sugar'], measurement: null, preparations: null, equipment: null },
            { food_items: ['butter'], measurement: null, preparations: ['melted'], equipment: null },
        ]);

        expect(normalizeParseAnswer(answer).foods).toEqual([
            { name: 'sugar', prep: null },
            { name: 'butter', prep: 'melted' },
        ]);
    });

    it('joins several preparations on one record', () => {
        expect(normalizeParseAnswer(one({ preparations: ['peeled', 'minced'] })).foods).toEqual([
            { name: 'flour', prep: 'peeled, minced' },
        ]);
    });

    it('drops a food with no name — a nameless food carries no identity to resolve', () => {
        expect(normalizeParseAnswer(one({ food_items: ['flour', '  ', ''] })).foods).toEqual([
            { name: 'flour', prep: null },
        ]);
    });

    it('yields an empty food list for a null food_items and for the empty document', () => {
        expect(normalizeParseAnswer(one({ food_items: null })).foods).toEqual([]);
        expect(normalizeParseAnswer(modelParseAnswerSchema.parse([])).foods).toEqual([]);
        expect(normalizeParseAnswer(modelParseAnswerSchema.parse([])).statedMeasure).toBeNull();
    });

    it('DISCARDS equipment, as every arm of the comparison did', () => {
        const parse = normalizeParseAnswer(one({ equipment: ['skillet'] }));

        expect(JSON.stringify(parse)).not.toContain('skillet');
    });
});

describe('the model own quantity and unit are kept SEPARATE — owner ruling 2026-08-27', () => {
    const one = (measurement: unknown): ModelParseAnswer =>
        modelParseAnswerSchema.parse([{ food_items: ['x'], measurement, preparations: null, equipment: null }]);

    /**
     * ⛔ MEASURED LOSS, not a preference. Rejoining the model's split into a phrase and re-parsing it with
     * `parseIngredientLine` DROPPED the unit on 67 of 205 measured records (32.7%) on the held-out gold set —
     * `"16 slices"`, `"2 handfuls"`, `"1 heaped tbsp"`, `"2 firmly packed tablespoons"` all came back with a
     * null unit. The model had already split them correctly; the phrase parser is built for raw lines and
     * loses what it does not recognise as a leading quantity.
     *
     * ⚠️ `handfuls` IS a unit (owner ruling). `normalizeUnit` is TOTAL and already agrees — it de-pluralises
     * an unrecognised word rather than rejecting it, and `classifyUnit`'s own docstring says a cook "may
     * write anything in the unit field… and the wire stores it unchanged". An unconvertible unit still fails
     * SAFE to null grams downstream, exactly as `small`/`large` already do under ADR-0026 §8.
     */
    it('carries the model own unit words through, informal ones included', () => {
        expect(normalizeParseAnswer(one({ quantity: '2', unit: 'handfuls', unit_type: 'UNKNOWN' })).statedUnit).toBe(
            'handfuls',
        );
        expect(normalizeParseAnswer(one({ quantity: '16', unit: 'slices', unit_type: 'COUNT' })).statedUnit).toBe(
            'slices',
        );
    });

    it('carries the model own amount words through, separately from the unit', () => {
        const parse = normalizeParseAnswer(one({ quantity: '1 2/3', unit: 'cups', unit_type: 'VOLUME' }));

        expect(parse.statedQuantity).toBe('1 2/3');
        expect(parse.statedUnit).toBe('cups');
    });

    it('still assembles the phrase, because the STATED pair is what the comparator compares', () => {
        expect(normalizeParseAnswer(one({ quantity: '1 2/3', unit: 'cups', unit_type: 'VOLUME' })).statedMeasure).toBe(
            '1 2/3 cups',
        );
    });

    it('collapses an unstated half to null rather than to an empty string', () => {
        const noUnit = normalizeParseAnswer(one({ quantity: '7', unit: null, unit_type: 'COUNT' }));
        const noAmount = normalizeParseAnswer(one({ quantity: null, unit: 'pinch', unit_type: 'UNKNOWN' }));

        expect(noUnit.statedUnit).toBeNull();
        expect(noUnit.statedQuantity).toBe('7');
        expect(noAmount.statedQuantity).toBeNull();
        expect(noAmount.statedUnit).toBe('pinch');
    });

    it('is null on both halves when no measurement was stated at all', () => {
        const parse = normalizeParseAnswer(one(null));

        expect(parse.statedQuantity).toBeNull();
        expect(parse.statedUnit).toBeNull();
        expect(parse.statedMeasure).toBeNull();
    });
});
