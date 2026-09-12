/**
 * A COOK'S CORRECTION, PROMOTED TO THE CANONICAL PARSE (plan U22, phase 4).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | ADR-0026 — a correction is a source, never an engine | "attributes every fact to the PERSON" |
 * | KTD-15 — a corrected line wants no further review | "wants no further review" |
 * | HAZ-041 — `raw` is the source line byte-identical | "raw is THIS caller's line" |
 * | KTD-11b — a lexicon does not overrule a cook | "does not re-file the cook's words" |
 *
 * ⚠️ The `reviewReasons` suite is the one that matters, and it is written against the case an
 * engine-shaped implementation would get wrong: a corrected line whose measure phrase no parser can read.
 * `rehydrateEngineParse` raises `no_quantity` there and is right to; doing the same here would flag a fact
 * a human deliberately asserted.
 */
import { describe, it, expect } from 'vitest';

import { promoteCorrection } from '../promoteCorrection.js';
import { rehydrateEngineParse } from '../storedParseFacts.js';
import type { ParsedFacts } from '../../parsedLine.js';

/** One cook's corrected facts. */
function makeFacts(overrides: Partial<ParsedFacts> = {}): ParsedFacts {
    return {
        statedMeasure: 'one heaping cup',
        quantity: { kind: 'exact', value: 1 },
        unit: 'cup',
        foods: [{ name: 'dark brown sugar', prep: null }],
        ...overrides,
    };
}

describe('promoteCorrection', () => {
    it('attributes every fact to the PERSON, never to an engine', () => {
        expect(promoteCorrection(makeFacts(), 'one cup of brown sugar').provenance).toEqual({
            statedMeasure: 'correction',
            quantity: 'correction',
            unit: 'correction',
            foods: 'correction',
        });
    });

    it('raw is THIS caller`s line, not anything rebuilt from the correction', () => {
        // The correction row stores the line the CORRECTING cook saw; the line being parsed is this
        // caller's, and the two are only equal up to the normalized key that matched them.
        expect(promoteCorrection(makeFacts(), '  ONE CUP OF BROWN SUGAR  ').raw).toBe('  ONE CUP OF BROWN SUGAR  ');
    });

    it('carries the cook`s facts through unchanged', () => {
        const facts = makeFacts({ quantity: { kind: 'range', low: 2, high: 3 }, unit: 'tablespoon' });
        const promoted = promoteCorrection(facts, 'two or three spoonfuls');

        expect(promoted.statedMeasure).toBe('one heaping cup');
        expect(promoted.quantity).toEqual({ kind: 'range', low: 2, high: 3 });
        expect(promoted.unit).toBe('tablespoon');
        expect(promoted.foods).toEqual([{ name: 'dark brown sugar', prep: null }]);
    });

    describe('wants no further review', () => {
        it('raises nothing for an ordinary correction', () => {
            expect(promoteCorrection(makeFacts(), 'x').reviewReasons).toEqual([]);
        });

        it('raises nothing for a measure phrase NO PARSER CAN READ — the case that separates the two adapters', () => {
            // ⛔ THE MUTANT: an implementation that reused `rehydrateEngineParse`'s derivation would raise
            // `no_quantity` here, against an amount the cook stated on purpose. The sibling assertion below
            // proves this test is not vacuous — the engine path really does flag this phrase.
            const facts = makeFacts({ statedMeasure: 'the size of an egg' });

            expect(promoteCorrection(facts, 'butter the size of an egg').reviewReasons).toEqual([]);
            expect(rehydrateEngineParse(facts, 'butter the size of an egg', 'crf').reviewReasons).toEqual([
                'no_quantity',
            ]);
        });

        it('raises nothing even when the cook deliberately asserts NO amount', () => {
            const facts = makeFacts({ statedMeasure: null, quantity: { kind: 'absent' }, unit: null });

            expect(promoteCorrection(facts, 'salt').reviewReasons).toEqual([]);
            expect(rehydrateEngineParse(facts, 'salt', 'llm').reviewReasons).toEqual(['no_quantity']);
        });
    });

    it('does not re-file the cook`s words through the modifier lexicon', () => {
        // `chopped` is a past participle, which KTD-11b files as preparation — and the comparator would move
        // it. A cook who put it in the identity said so; this adapter is not the place to argue.
        const facts = makeFacts({ foods: [{ name: 'chopped raisins', prep: null }] });

        expect(promoteCorrection(facts, 'one cup of raisins chopped').foods).toEqual([
            { name: 'chopped raisins', prep: null },
        ]);
    });

    it('promotes a correction naming no food at all', () => {
        const promoted = promoteCorrection(makeFacts({ foods: [] }), 'For the sauce:');

        expect(promoted.foods).toEqual([]);
        expect(promoted.reviewReasons).toEqual([]);
    });
});
