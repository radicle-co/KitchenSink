import { describe, expect, it } from 'vitest';

import { crfParseSchema, readCrfParseLine } from '../crfParse.js';

/** A row exactly as `scripts/crfParse.py` prints it, copied from a real run. */
const ROW =
    '{"sentence": "one-half cup of butter", "measure": "1/2 cups", "names": ["butter"], "size": null, "preparation": null, "comment": null}';

describe('crfParseSchema', () => {
    it('accepts a row the parser really emits', () => {
        expect(crfParseSchema.safeParse(JSON.parse(ROW)).success).toBe(true);
    });

    it('accepts a row with every optional field populated', () => {
        const parsed = crfParseSchema.safeParse({
            sentence: '3 cloves garlic, minced',
            measure: '3 cloves',
            names: ['garlic'],
            size: 'large',
            preparation: 'minced',
            comment: 'to taste',
        });

        expect(parsed.success).toBe(true);
    });

    it('accepts a line the parser found no amount in — that is an answer, not a failure', () => {
        const parsed = crfParseSchema.safeParse({
            sentence: 'salt',
            measure: '',
            names: ['salt'],
            size: null,
            preparation: null,
            comment: null,
        });

        expect(parsed.success).toBe(true);
    });

    it('accepts a line the parser found no name in', () => {
        const parsed = crfParseSchema.safeParse({
            sentence: 'two hours',
            measure: '2 hours',
            names: [],
            size: null,
            preparation: null,
            comment: null,
        });

        expect(parsed.success).toBe(true);
    });

    it('rejects a missing field rather than defaulting it — an upstream change must be loud', () => {
        expect(crfParseSchema.safeParse({ sentence: 'x', measure: '', names: [] }).success).toBe(false);
    });

    it('rejects a names array holding anything but strings', () => {
        expect(
            crfParseSchema.safeParse({
                sentence: 'x',
                measure: '',
                names: [{ text: 'butter' }],
                size: null,
                preparation: null,
                comment: null,
            }).success,
        ).toBe(false);
    });

    it('rejects an unexpected extra field, so a shape drift is caught at the boundary', () => {
        expect(
            crfParseSchema.safeParse({
                sentence: 'x',
                measure: '',
                names: [],
                size: null,
                preparation: null,
                comment: null,
                purpose: 'for the sauce',
            }).success,
        ).toBe(false);
    });
});

describe('readCrfParseLine', () => {
    it('reads one JSONL row', () => {
        expect(readCrfParseLine(ROW).sentence).toBe('one-half cup of butter');
    });

    it('throws on a row that is not JSON at all, naming the offending text', () => {
        expect(() => readCrfParseLine('Traceback (most recent call last):')).toThrow(/Traceback/);
    });

    it("throws on JSON that is not the parser's shape", () => {
        expect(() => readCrfParseLine('{"sentence":"x"}')).toThrow();
    });
});
