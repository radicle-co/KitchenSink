/**
 * WHAT A STORED PARSE HOLDS, AND THE TWO DIRECTIONS BETWEEN IT AND A `ParsedLine` (plan U22, phase 4).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | KTD-14 — the digest is the ONLY representation of the cook's line in that table | "the payload is the FACTS" |
 * | U22 — the payload is PARSED, never cast | the `readStoredParseFacts` suite |
 * | KTD-13 — a rehydrated row is attributed wholly to the engine that produced it | "rehydrating" |
 * | HAZ-041 — `raw` is the source line byte-identical | "raw is the SOURCE line" |
 * | U22 — nothing derivable is stored | "the round trip" |
 *
 * ⚠️ The round-trip suite is the one that fails if a future promotion adapter starts raising a review
 * reason that is NOT a function of `statedMeasure`. That is deliberate: rehydration re-derives the reasons
 * rather than storing them, and the day that stops being lossless somebody has to decide what to do about
 * it rather than discovering it from a corpus that quietly lost its flags.
 */
import { describe, it, expect } from 'vitest';

import { storedFactsOf, readStoredParseFacts, rehydrateEngineParse } from '../storedParseFacts.js';
import { promoteCrfReading, type CrfReading } from '../promoteCrfReading.js';
import { promoteLlmParse } from '../promoteLlmParse.js';
import type { ParsedFacts, ParsedLine } from '../../parsedLine.js';

/** A fully-populated parse, so a projection that forgets a field is visible. */
function makeParsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
    return {
        raw: '1 tablespoon butter, melted',
        statedMeasure: '1 tablespoon',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: 'melted' }],
        reviewReasons: [],
        provenance: { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'crf' },
        ...overrides,
    };
}

/** The four facts, as a well-formed row's `jsonb` holds them. */
function makeFactsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        statedMeasure: '1 tablespoon',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: 'melted' }],
        ...overrides,
    };
}

describe('storedFactsOf', () => {
    it('keeps the payload to the FACTS — the cook`s line never reaches the row', () => {
        const facts = storedFactsOf(makeParsedLine());

        // ⛔ KEY EQUALITY, not a spot check. `ingredient_parse_cache.line_digest` is documented as "the ONLY
        // representation of the cook's line that is stored anywhere in this table", and `ParsedLine.raw` IS
        // that line byte-identical. A projection that spread the whole line would pass every field-by-field
        // assertion and quietly break the erasure argument KTD-14 rests on.
        expect(Object.keys(facts).sort()).toEqual(['foods', 'quantity', 'statedMeasure', 'unit']);
        expect(facts).not.toHaveProperty('raw');
        expect(facts).not.toHaveProperty('provenance');
        expect(facts).not.toHaveProperty('reviewReasons');
    });

    it('carries every fact through unchanged', () => {
        const line = makeParsedLine({
            statedMeasure: 'a handful',
            quantity: { kind: 'absent' },
            unit: null,
            foods: [
                { name: 'parsley', prep: 'chopped' },
                { name: 'chives', prep: null },
            ],
        });

        expect(storedFactsOf(line)).toEqual({
            statedMeasure: 'a handful',
            quantity: { kind: 'absent' },
            unit: null,
            foods: [
                { name: 'parsley', prep: 'chopped' },
                { name: 'chives', prep: null },
            ],
        });
    });
});

describe('readStoredParseFacts', () => {
    it('reads a well-formed payload', () => {
        expect(readStoredParseFacts(makeFactsPayload())).toEqual({
            statedMeasure: '1 tablespoon',
            quantity: { kind: 'exact', value: 1 },
            unit: 'tablespoon',
            foods: [{ name: 'butter', prep: 'melted' }],
        });
    });

    it('reads a range and an absence, because both are things an engine legitimately reads', () => {
        expect(readStoredParseFacts(makeFactsPayload({ quantity: { kind: 'range', low: 2, high: 3 } }))).toMatchObject({
            quantity: { kind: 'range', low: 2, high: 3 },
        });
        expect(
            readStoredParseFacts(makeFactsPayload({ quantity: { kind: 'absent' }, statedMeasure: null, unit: null })),
        ).toMatchObject({ quantity: { kind: 'absent' }, statedMeasure: null, unit: null });
    });

    it('REFUSES a payload carrying the cook`s line, however well formed the rest of it is', () => {
        // The mutation lens on KTD-14: a writer that stored the whole `ParsedLine` would produce exactly
        // this row, and a non-strict reader would serve it happily for the rest of the generation.
        expect(readStoredParseFacts(makeFactsPayload({ raw: '1 tablespoon butter, melted' }))).toBeUndefined();
    });

    it('REFUSES an old-generation payload whose quantity is a bare number', () => {
        // R40's pre-U8 shape. It survives a cast, and every line it touched would report a fabricated
        // amount of `undefined` downstream.
        expect(readStoredParseFacts(makeFactsPayload({ quantity: 2 }))).toBeUndefined();
    });

    it('REFUSES a payload missing a fact entirely', () => {
        const { quantity: _dropped, ...withoutQuantity } = makeFactsPayload();

        expect(readStoredParseFacts(withoutQuantity)).toBeUndefined();
    });

    it('REFUSES a food that is not a name and a preparation', () => {
        expect(readStoredParseFacts(makeFactsPayload({ foods: [{ name: 'butter' }] }))).toBeUndefined();
        expect(readStoredParseFacts(makeFactsPayload({ foods: ['butter'] }))).toBeUndefined();
    });

    it('REFUSES anything that is not an object at all', () => {
        for (const payload of [null, undefined, 'facts', 7, [], true]) {
            expect(readStoredParseFacts(payload)).toBeUndefined();
        }
    });
});

describe('rehydrateEngineParse', () => {
    const facts: ParsedFacts = {
        statedMeasure: '1 tablespoon',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: 'melted' }],
    };

    it('raw is the SOURCE line byte-identical, never anything rebuilt from the facts', () => {
        const line = rehydrateEngineParse(facts, '  One  tablespoon of butter, melted  ', 'crf');

        expect(line.raw).toBe('  One  tablespoon of butter, melted  ');
    });

    it('attributes every fact to the engine whose row it was', () => {
        expect(rehydrateEngineParse(facts, 'x', 'llm').provenance).toEqual({
            statedMeasure: 'llm',
            quantity: 'llm',
            unit: 'llm',
            foods: 'llm',
        });
        expect(rehydrateEngineParse(facts, 'x', 'crf').provenance).toEqual({
            statedMeasure: 'crf',
            quantity: 'crf',
            unit: 'crf',
            foods: 'crf',
        });
    });

    it('re-derives the review reasons from the stated measure rather than serving an empty list', () => {
        // A cached row for a line whose measure no number can hold must come back still flagged. An
        // implementation that hard-coded `[]` passes every other test in this file.
        const noNumber = rehydrateEngineParse(
            { ...facts, statedMeasure: null, quantity: { kind: 'absent' } },
            'x',
            'crf',
        );

        expect(noNumber.reviewReasons).toEqual(['no_quantity']);
        expect(rehydrateEngineParse(facts, 'x', 'crf').reviewReasons).toEqual([]);
    });
});

describe('the round trip — nothing derivable is stored, and nothing stored is lost', () => {
    /** The CRF rows the corpus actually produces, including the awkward ones. */
    const crfRows: readonly CrfReading[] = [
        { sentence: '', measure: '1 tablespoon', names: ['butter'], size: null, preparation: 'melted', comment: null },
        { sentence: '', measure: '', names: ['salt'], size: null, preparation: null, comment: null },
        { sentence: '', measure: 'one gill', names: ['gill of milk'], size: null, preparation: null, comment: null },
        { sentence: '', measure: '2 to 3', names: ['eggs'], size: 'large', preparation: 'beaten', comment: 'if liked' },
        { sentence: '', measure: 'a handful', names: [], size: null, preparation: null, comment: null },
        {
            sentence: '',
            measure: '2 cups and 1 tablespoon',
            names: ['flour'],
            size: null,
            preparation: 'sifted',
            comment: null,
        },
    ];

    it.each(crfRows.map((row, index) => [index, row] as const))(
        'a promoted CRF reading survives the cache byte for byte (row %i)',
        (_index, row) => {
            const promoted = promoteCrfReading(row, 'the source line');

            expect(rehydrateEngineParse(storedFactsOf(promoted), promoted.raw, 'crf')).toEqual(promoted);
        },
    );

    it('a promoted model reading survives the cache byte for byte', () => {
        for (const statedMeasure of ['1 tablespoon', null, 'one gill', 'the size of an egg', '2 to 3']) {
            const promoted = promoteLlmParse(
                { statedMeasure, foods: [{ name: 'butter', prep: 'melted' }] },
                'the source line',
            );

            expect(rehydrateEngineParse(storedFactsOf(promoted), promoted.raw, 'llm')).toEqual(promoted);
        }
    });

    it('survives a JSON round trip, which is what the column actually does to it', () => {
        const promoted = promoteCrfReading(crfRows[3] as CrfReading, 'two large eggs, beaten');
        const throughJson: unknown = JSON.parse(JSON.stringify(storedFactsOf(promoted)));
        const read = readStoredParseFacts(throughJson);

        expect(read).toBeDefined();
        expect(rehydrateEngineParse(read as ParsedFacts, promoted.raw, 'crf')).toEqual(promoted);
    });
});
