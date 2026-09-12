/**
 * The dictionary's tag lookup (KTD-23): which INFOODS tag `NUTRIENT_DEFINITIONS` gives a `(name, unit)` pair.
 *
 * The three answers are distinct and the DAO branches on all three: a tag fills in or contradicts a stated one, `null`
 * is a mapped definition with no tag (a stated tag then contradicts it), and `undefined` is a pair the mapping does not
 * know (a stated tag is stored as stated).
 */
import { describe, expect, it } from 'vitest';

import { NUTRIENT_DEFINITIONS } from '../../nutrition/nutrientIdentity.js';
import { mappedTagOf } from '../nutrient.dao.js';

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
