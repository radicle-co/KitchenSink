/**
 * The dictionary's tag lookup (KTD-23): which INFOODS tag `NUTRIENT_DEFINITIONS` gives a `(name, unit)` pair.
 *
 * The three answers are distinct and the DAO branches on all three: a tag fills in or contradicts a stated one, `null`
 * is a mapped definition with no tag (a stated tag then contradicts it), and `undefined` is a pair the mapping does not
 * know (a stated tag is stored as stated).
 */
import { describe, expect, it } from 'vitest';

import { NUTRIENT_DEFINITIONS } from '../../nutrition/nutrientIdentity.js';
import { isNutrientDefinitionMismatchError } from '../dao.errors.js';
import { heldRowFor, mappedTagOf, wantedOf } from '../nutrient.dao.js';

describe('mappedTagOf', () => {
    it.each(Object.entries(NUTRIENT_DEFINITIONS))('gives the %s definition its own tag', (_key, definition) => {
        expect([mappedTagOf(definition.name, definition.unit)]).toStrictEqual([definition.tag]);
    });

    const cases: readonly (readonly [string, string, string, string | null | undefined])[] = [
        ['a tagged pair', 'Protein', 'g', 'PROCNT'],
        ['one name under another unit, as its own definition', 'Energy', 'kj', 'ENERC_KJ'],
        ['a mapped pair with no tag', 'Energy (atwater general factors)', 'kcal', null],
        ['an unmapped pair', 'Vitamin C, total ascorbic acid', 'mg', undefined],
        ['a mapped name under an unmapped unit', 'Protein', 'mg', undefined],
        ['a mapped name in another spelling', 'protein', 'g', undefined],
    ];

    it.each(cases)('answers %s', (_case, name, unit, expected) => {
        expect([mappedTagOf(name, unit)]).toStrictEqual([expected]);
    });
});

/** The batch path settles every tag before a statement, then picks held rows the way the one-at-a-time path did. */
describe('wantedOf', () => {
    it('keeps a stated tag, fills a mapped one, and leaves an unmapped pair untagged', () => {
        expect([
            wantedOf({ name: 'Protein', unit: 'g', infoodsTag: 'PROCNT' }).infoodsTag,
            wantedOf({ name: 'Protein', unit: 'g' }).infoodsTag,
            wantedOf({ name: 'Vitamin C, total ascorbic acid', unit: 'mg', infoodsTag: null }).infoodsTag,
            wantedOf({ name: 'Brand-new compound', unit: 'mg', infoodsTag: 'NEWCMP' }).infoodsTag,
        ]).toStrictEqual(['PROCNT', 'PROCNT', null, 'NEWCMP']);
    });

    it('refuses a stated tag the mapping contradicts', () => {
        const refused = (() => {
            try {
                return wantedOf({ name: 'Protein', unit: 'g', infoodsTag: 'FAT' });
            } catch (error) {
                return error;
            }
        })();

        expect(isNutrientDefinitionMismatchError(refused)).toBe(true);
    });
});

describe('heldRowFor', () => {
    const tagged = { id: 'n-tag', name: 'Energy', unit: 'kcal', infoodsTag: 'ENERC_KCAL' };
    const pairOnly = { id: 'n-pair', name: 'Energy (renamed)', unit: 'kcal', infoodsTag: null };

    it('prefers the row carrying the tag over a row matching only the pair', () => {
        const rows = [{ ...pairOnly, name: 'Energy' }, tagged];

        expect(heldRowFor(rows, { name: 'Energy', unit: 'kcal', infoodsTag: 'ENERC_KCAL' })?.id).toBe('n-tag');
    });

    it('falls back to the pair when no row carries the tag', () => {
        expect(heldRowFor([pairOnly], { name: 'Energy (renamed)', unit: 'kcal', infoodsTag: 'ENERC_KCAL' })?.id).toBe(
            'n-pair',
        );
    });

    it('matches an untagged definition by pair only, never by another row with a null tag', () => {
        expect(heldRowFor([pairOnly], { name: 'Something else', unit: 'kcal', infoodsTag: null })).toBeUndefined();
    });
});
