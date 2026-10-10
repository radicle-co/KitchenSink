/**
 * WHAT A STORED PARSE HOLDS, AND THE TWO DIRECTIONS BETWEEN IT AND A `ParsedLine` (plan U22, phase 4).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | KTD-14 — the digest is the ONLY representation of the cook's line in that table | "the payload is the FACTS" |
 * | U22 — the payload is PARSED, never cast | the `readStoredParse` suite |
 * | KTD-13 — a rehydrated row is attributed wholly to the engine that produced it | "rehydrating" |
 * | HAZ-041 — `raw` is the source line byte-identical | "raw is the SOURCE line" |
 * | U22 — nothing DERIVABLE is stored, and everything judged IS | "the round trip" |
 *
 * ⚠️ `reviewReasons` is the one member a re-reading cannot recover, so the suites below assert it from both
 * ends: that a projection records what an engine judged, and that a payload written without the member —
 * every row a prior generation left behind — still reads and still comes back with the reasons its measure
 * supports.
 */
import { describe, it, expect } from 'vitest';

import { storedParseOf, readStoredParse, rehydrateEngineParse, type StoredParse } from '../storedParseFacts.js';
import { promoteCrfReading, type CrfReading } from '../promoteCrfReading.js';
import { promoteLlmParse } from '../promoteLlmParse.js';
import { readStatedMeasure } from '../readStatedMeasure.js';
import type { ParsedLine } from '../../parsedLine.js';

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
        reviewReasons: [],
        ...overrides,
    };
}

/** The same payload with the judgement MISSING — every row written before the member was required. */
function makePayloadWithoutReasons(): Record<string, unknown> {
    const { reviewReasons: _omitted, ...rest } = makeFactsPayload();

    return rest;
}

describe('storedParseOf', () => {
    it('keeps the payload to the facts and the judgement — the cook`s line never reaches the row', () => {
        const facts = storedParseOf(makeParsedLine());

        // ⛔ KEY EQUALITY, not a spot check. `ingredient_parse_cache.line_digest` is documented as "the ONLY
        // representation of the cook's line that is stored anywhere in this table", and `ParsedLine.raw` IS
        // that line byte-identical. A projection that spread the whole line would pass every field-by-field
        // assertion and quietly break the erasure argument KTD-14 rests on.
        expect(Object.keys(facts).sort()).toEqual(['foods', 'quantity', 'reviewReasons', 'statedMeasure', 'unit']);
        expect(facts).not.toHaveProperty('raw');
        expect(facts).not.toHaveProperty('provenance');
    });

    it('records what a VALIDATOR judged, which no re-reading of the measure could recover', () => {
        // `not_a_food` and `measurement_unverified` are raised by `validatedEngine.ts`'s `exhaust`, never by
        // a measure reading — the positive control below pins that, so the assertion is about storage rather
        // than about a reason the rehydration would have produced anyway.
        const judged = storedParseOf(makeParsedLine({ reviewReasons: ['not_a_food', 'measurement_unverified'] }));

        expect(judged.reviewReasons).toEqual(['not_a_food', 'measurement_unverified']);
        expect(rehydrateEngineParse(storedParseOf(makeParsedLine()), 'x', 'crf').reviewReasons).toEqual([]);
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

        expect(storedParseOf(line)).toEqual({
            statedMeasure: 'a handful',
            quantity: { kind: 'absent' },
            unit: null,
            foods: [
                { name: 'parsley', prep: 'chopped' },
                { name: 'chives', prep: null },
            ],
            reviewReasons: [],
        });
    });
});

describe('readStoredParse', () => {
    it('reads a well-formed payload', () => {
        expect(readStoredParse(makeFactsPayload())).toEqual({
            reviewReasons: [],
            statedMeasure: '1 tablespoon',
            quantity: { kind: 'exact', value: 1 },
            unit: 'tablespoon',
            foods: [{ name: 'butter', prep: 'melted' }],
        });
    });

    it('reads a range and an absence, because both are things an engine legitimately reads', () => {
        expect(readStoredParse(makeFactsPayload({ quantity: { kind: 'range', low: 2, high: 3 } }))).toMatchObject({
            quantity: { kind: 'range', low: 2, high: 3 },
        });
        expect(
            readStoredParse(makeFactsPayload({ quantity: { kind: 'absent' }, statedMeasure: null, unit: null })),
        ).toMatchObject({ quantity: { kind: 'absent' }, statedMeasure: null, unit: null });
    });

    it('⛔ REFUSES a row that records no reasons, because a judgement cannot be inferred later', () => {
        // Positive control: the same payload WITH the member reads, so the refusal below is about the
        // missing member and not about the fixture.
        expect(readStoredParse(makeFactsPayload({ reviewReasons: ['not_a_food'] }))?.reviewReasons).toEqual([
            'not_a_food',
        ]);

        // ⛔ A row written before the member existed is UNREADABLE, not patched. `readStoredParse`
        // answering `undefined` is what the pipeline reports as an unreadable payload and re-earns by
        // asking the engines — the honest outcome, because no re-reading of the measure can recover what a
        // validator judged. Serving such a row with a derived list would publish a flag nobody raised.
        expect(readStoredParse(makePayloadWithoutReasons())).toBeUndefined();
    });

    it('REFUSES a reason outside the taxonomy, and a reason list that is not a list', () => {
        // The control: the same payload with a REAL reason reads, so the two refusals below are about the
        // value rather than about the member being rejected wholesale.
        expect(readStoredParse(makeFactsPayload({ reviewReasons: ['no_quantity'] }))).toBeDefined();
        expect(readStoredParse(makeFactsPayload({ reviewReasons: ['not_a_reason'] }))).toBeUndefined();
        expect(readStoredParse(makeFactsPayload({ reviewReasons: 'not_a_food' }))).toBeUndefined();
    });

    it('REFUSES a payload carrying the cook`s line, however well formed the rest of it is', () => {
        // The mutation lens on KTD-14: a writer that stored the whole `ParsedLine` would produce exactly
        // this row, and a non-strict reader would serve it happily for the rest of the generation.
        expect(readStoredParse(makeFactsPayload({ raw: '1 tablespoon butter, melted' }))).toBeUndefined();
    });

    it('REFUSES an old-generation payload whose quantity is a bare number', () => {
        // R40's pre-U8 shape. It survives a cast, and every line it touched would report a fabricated
        // amount of `undefined` downstream.
        expect(readStoredParse(makeFactsPayload({ quantity: 2 }))).toBeUndefined();
    });

    it('REFUSES a payload missing a fact entirely', () => {
        const { quantity: _dropped, ...withoutQuantity } = makeFactsPayload();

        expect(readStoredParse(withoutQuantity)).toBeUndefined();
    });

    it('REFUSES a food that is not a name and a preparation', () => {
        expect(readStoredParse(makeFactsPayload({ foods: [{ name: 'butter' }] }))).toBeUndefined();
        expect(readStoredParse(makeFactsPayload({ foods: ['butter'] }))).toBeUndefined();
    });

    it('REFUSES anything that is not an object at all', () => {
        for (const payload of [null, undefined, 'facts', 7, [], true]) {
            expect(readStoredParse(payload)).toBeUndefined();
        }
    });
});

describe('rehydrateEngineParse', () => {
    const facts: StoredParse = {
        statedMeasure: '1 tablespoon',
        quantity: { kind: 'exact', value: 1 },
        unit: 'tablespoon',
        foods: [{ name: 'butter', prep: 'melted' }],
        reviewReasons: [],
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

    it('serves the recorded reasons VERBATIM, never a reading of the measure beside them', () => {
        // ⛔ THE `unParseable` SHAPE (`validatedEngine.ts`): every name disputed, so the measure is blanked
        // and the only reason is the verdict. The control on the next line shows that reading THIS measure
        // yields `no_quantity` — so a rehydration that derived, or that merged a derivation in, would hand a
        // cook "No amount given" about a line whose amount nobody questioned.
        const blanked: StoredParse = {
            ...facts,
            statedMeasure: null,
            quantity: { kind: 'absent' },
            reviewReasons: ['not_a_food'],
        };

        // The control: reading THIS measure yields `no_quantity`, so a rehydration that derived — or that
        // merged a derivation in — would hand a cook "No amount given" about a line nobody questioned.
        expect(readStatedMeasure(null).reviewReasons).toEqual(['no_quantity']);
        expect(rehydrateEngineParse(blanked, 'x', 'llm').reviewReasons).toEqual(['not_a_food']);
    });

    it('serves an EMPTY list as empty — a row that judged nothing is not a row that judged unknown', () => {
        // ⛔ There is no measure-derived fallback to assert: the member is required, so a row either
        // records what was judged or never reaches here (see the refusal case above). A blanked measure
        // beside an empty list therefore stays empty rather than gaining `no_quantity`.
        const blankedMeasure: StoredParse = {
            ...facts,
            statedMeasure: null,
            quantity: { kind: 'absent' },
            reviewReasons: [],
        };

        expect(rehydrateEngineParse(blankedMeasure, 'x', 'crf').reviewReasons).toEqual([]);
        expect(rehydrateEngineParse(facts, 'x', 'crf').reviewReasons).toEqual([]);
    });
});

describe('the round trip — nothing derivable is stored, and nothing judged is lost', () => {
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

            expect(rehydrateEngineParse(storedParseOf(promoted), promoted.raw, 'crf')).toEqual(promoted);
        },
    );

    it('a promoted model reading survives the cache byte for byte', () => {
        for (const statedMeasure of ['1 tablespoon', null, 'one gill', 'the size of an egg', '2 to 3']) {
            const promoted = promoteLlmParse(
                { statedMeasure, foods: [{ name: 'butter', prep: 'melted' }] },
                'the source line',
            );

            expect(rehydrateEngineParse(storedParseOf(promoted), promoted.raw, 'llm')).toEqual(promoted);
        }
    });

    it('a line a validator flagged survives the cache with its verdict', () => {
        const promoted = promoteLlmParse(
            { statedMeasure: '1 tablespoon', foods: [{ name: 'butter', prep: 'melted' }] },
            'the source line',
        );
        const judged: ParsedLine = { ...promoted, reviewReasons: ['not_a_food', 'measurement_unverified'] };

        expect(rehydrateEngineParse(storedParseOf(judged), judged.raw, 'llm')).toEqual(judged);
    });

    it('survives a JSON round trip, which is what the column actually does to it', () => {
        const promoted = promoteCrfReading(crfRows[3] as CrfReading, 'two large eggs, beaten');
        const judged: ParsedLine = { ...promoted, reviewReasons: [...promoted.reviewReasons, 'not_a_food'] };
        const throughJson: unknown = JSON.parse(JSON.stringify(storedParseOf(judged)));
        const read = readStoredParse(throughJson);

        if (read === undefined) {
            throw new Error('a payload this module just projected must read back');
        }

        expect(rehydrateEngineParse(read, judged.raw, 'crf')).toEqual(judged);
    });
});
