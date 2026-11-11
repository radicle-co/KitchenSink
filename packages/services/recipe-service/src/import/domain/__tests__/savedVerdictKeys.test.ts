/**
 * `savedVerdictKeysOf` — which saved lines get a verdict key stored beside their snapshot line (ADR-0072 §4).
 *
 * The key is what the flagged list and the view's `version` read verdicts under, in SQL. A line that gets none is invisible to
 * both, so each rule below is a line that must (or must not) appear in the flagged list.
 */
import { describe, expect, it } from 'vitest';

import { savedVerdictKeysOf, type SavedLineFacts } from '../savedVerdictKeys.js';

const BOUND = 'lookup-bound';
const WRITTEN = 'lookup-written';

/** A saved line with sensible defaults: bound by the importer to the root food `F-flour`. */
function makeSavedLine(overrides: Partial<SavedLineFacts> = {}): SavedLineFacts {
    return {
        importLineId: 'line-1',
        boundBy: 'autoBest',
        foodLookupId: BOUND,
        quantity: '2',
        quantityHigh: null,
        unit: 'cup',
        sourceLine: '2 cups flour',
        statedUnit: null,
        statedQuantity: null,
        statedQuantityHigh: null,
        ...overrides,
    };
}

/** The fixture's food lookups: one bound to a root food, one kept as written (no food behind it). */
function foodIdOf(lookupId: string): string | undefined {
    return lookupId === BOUND ? 'F-flour' : undefined;
}

/** The keys of some saved lines. */
function keysOf(ingredients: readonly SavedLineFacts[]) {
    return savedVerdictKeysOf(ingredients, foodIdOf);
}

describe('savedVerdictKeysOf', () => {
    it('gives a bound line from the import one key, under its snapshot line id', () => {
        const keys = keysOf([makeSavedLine()]);

        expect(keys).toHaveLength(1);
        expect(keys[0]?.id).toBe('line-1');
        expect(keys[0]?.key).toMatch(/\S/u);
    });

    it('gives a line the importer kept as written (no origin) none, however it is bound', () => {
        expect(keysOf([makeSavedLine({ boundBy: null })])).toEqual([]);
    });

    it('gives a line that came from no snapshot line none (an editor-added line has no row to key)', () => {
        expect(keysOf([makeSavedLine({ importLineId: null })])).toEqual([]);
    });

    it('gives a line whose binding names no food none: there is nothing for a verdict to judge', () => {
        expect(keysOf([makeSavedLine({ foodLookupId: WRITTEN })])).toEqual([]);
    });

    it('gives a line whose source text is empty none: there is no text to check our parse against', () => {
        expect(keysOf([makeSavedLine({ sourceLine: '' })])).toEqual([]);
    });

    it('keys the measure, so a different quantity or unit is a different key', () => {
        const [base] = keysOf([makeSavedLine()]);
        const [moreFlour] = keysOf([makeSavedLine({ quantity: '3' })]);
        const [otherUnit] = keysOf([makeSavedLine({ unit: 'g' })]);

        expect(moreFlour?.key).not.toBe(base?.key);
        expect(otherUnit?.key).not.toBe(base?.key);
    });

    it('keys the same line the same way twice, and keeps the order of the lines', () => {
        const lines = [
            makeSavedLine({ importLineId: 'line-a', sourceLine: '1 cup sugar' }),
            makeSavedLine({ importLineId: 'line-b' }),
        ];
        const first = keysOf(lines);
        const second = keysOf(lines);

        expect(first.map((entry) => entry.id)).toEqual(['line-a', 'line-b']);
        expect(second).toEqual(first);
    });
});
