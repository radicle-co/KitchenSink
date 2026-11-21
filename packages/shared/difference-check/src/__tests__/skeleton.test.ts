/**
 * Stage 4 of v1: the UTS #39 skeleton (section 4: NFD, map, NFD), then lower case again, because the map's targets
 * include capitals (KTD-2).
 */
import { describe, expect, it } from 'vitest';

import { skeletonTokens } from '../normalise/skeleton.js';
import { skeletonOf } from '../normalise/skeletonOf.js';
import { NUMBER_TOKEN, UNIT_TOKEN } from '../normalise/foldQuantities.js';

describe('skeletonOf', () => {
    it('folds Cyrillic look-alikes onto the Latin word (Covers AE5)', () => {
        // о = Cyrillic o, с = Cyrillic c, а = Cyrillic a, е = Cyrillic e, р = Cyrillic r
        expect(skeletonOf('\u0441\u043e\u043ek')).toBe(skeletonOf('cook'));
        expect(skeletonOf('bаkе')).toBe(skeletonOf('bake'));
    });

    it('folds a digit inside a word onto its look-alike, so 0nion is onion', () => {
        expect(skeletonOf('0nion')).toBe(skeletonOf('onion'));
    });

    it('lower cases what the map leaves in capitals', () => {
        expect(skeletonOf('stir')).toBe(skeletonOf('stir').toLowerCase());
        expect(skeletonOf('І')).toBe(skeletonOf('І').toLowerCase());
    });

    it('is the identity on a word the map does not touch', () => {
        expect(skeletonOf('bdfh')).toBe('bdfh');
    });

    it('reads m as rn, which is why the skeleton must come after the unit fold', () => {
        expect(skeletonOf('milk')).toBe('rnilk');
    });
});

describe('skeletonTokens', () => {
    it('leaves the number and unit tokens alone and folds the words', () => {
        expect(skeletonTokens([NUMBER_TOKEN, UNIT_TOKEN, '0nion'])).toEqual([
            NUMBER_TOKEN,
            UNIT_TOKEN,
            skeletonOf('onion'),
        ]);
    });
});
