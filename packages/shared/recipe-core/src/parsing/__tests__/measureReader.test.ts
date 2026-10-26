/**
 * The measure reader's stated-measure half (`readCooksMeasure`), moved here from `@commise/features-recipes`'
 * `leadingMeasure.ts` so the editor and recipe-service read a pasted line's measure with ONE reader (ADR-0071).
 *
 * What these cases guard: the cook's own words are kept (`tbsp`, `T`, `large`), never `normalizeUnit`'s spelling. A
 * reader that canonicalised here would make the matcher key `tablespoon` while the editor saves `tbsp`, and every kept
 * pasted line would be judged twice. The amount rules (`numeric-quantity`, ranges, a glued unit) are the add field's.
 */
import { describe, expect, it } from 'vitest';

import { readCooksMeasure } from '../measureReader.js';

describe('readCooksMeasure — the amount at the start of a stated measure, and the cook’s words after it', () => {
    it.each([
        ['2 tbsp', { kind: 'exact', value: 2 }, 'tbsp'],
        ['1 T', { kind: 'exact', value: 1 }, 'T'],
        ['1 t', { kind: 'exact', value: 1 }, 't'],
        ['1 large', { kind: 'exact', value: 1 }, 'large'],
        ['1 1/2 cups of', { kind: 'exact', value: 1.5 }, 'cups'],
        ['2-3 cups', { kind: 'range', low: 2, high: 3 }, 'cups'],
        ['3 to 2 cups', { kind: 'range', low: 2, high: 3 }, 'cups'],
        ['200g', { kind: 'exact', value: 200 }, 'g'],
        ['½ cup', { kind: 'exact', value: 0.5 }, 'cup'],
    ])('reads %j as its amount and the words after it', (phrase, quantity, words) => {
        expect(readCooksMeasure(phrase)).toStrictEqual({ quantity, words });
    });

    it.each([
        ['a handful', 'a handful'],
        ['one gill', 'one gill'],
        ['II cups', 'II cups'],
    ])('keeps %j whole when it states no amount this reader reads', (phrase, words) => {
        expect(readCooksMeasure(phrase)).toStrictEqual({ quantity: { kind: 'absent' }, words });
    });
});
