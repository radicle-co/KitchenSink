/**
 * Reading Matvaretabellen's `foods.json` into a mirror pull (plan U28, KTD-26). Each food is keyed by its `foodId`,
 * which equals the xlsx `Matvare ID` the committed extract is keyed by, and keeps its published object as the
 * payload. The 2026-10-01 file holds 13 names with stray whitespace and one id, `'01.332 '`, with a trailing space,
 * so keys and names are trimmed as the xlsx extractor trims them; a key that repeats after trimming is refused.
 */
import { describe, expect, it } from 'vitest';

import { itemVersion } from '../../mirror/itemVersion.js';
import { isMirrorFeedFormatError } from '../../mirror/mirrorFeed.errors.js';
import { matvaretabellenDocument, makeMatvaretabellenFood } from '../__fixtures__/matvaretabellenFood.fixtures.js';
import { parseMatvaretabellenFoods } from '../matvaretabellenFoods.js';

describe('parseMatvaretabellenFoods', () => {
    it('keys each food by its id and keeps the published food, unchanged, as its payload', () => {
        const beans = makeMatvaretabellenFood();

        const pull = parseMatvaretabellenFoods(matvaretabellenDocument([beans]));

        expect(pull.items).toEqual([
            { externalKey: '06.178', name: 'Adzuki beans, uncooked', itemVersion: itemVersion(beans), payload: beans },
        ]);
    });

    it('trims the key and the name, and keeps the published untrimmed text in the payload', () => {
        const quark = makeMatvaretabellenFood({ foodId: '01.332 ', foodName: ' Quark, 1 % fat ' });

        const [item] = parseMatvaretabellenFoods(matvaretabellenDocument([quark])).items;

        expect(item?.externalKey).toBe('01.332');
        expect(item?.name).toBe('Quark, 1 % fat');
        expect(item?.payload['foodId']).toBe('01.332 ');
    });

    it('lists every food in the document', () => {
        const foods = ['01.036', '01.089', '06.178'].map((foodId) => makeMatvaretabellenFood({ foodId }));

        expect(parseMatvaretabellenFoods(matvaretabellenDocument(foods)).items.map((item) => item.externalKey)).toEqual(
            ['01.036', '01.089', '06.178'],
        );
    });

    it.each([
        ['text that is not JSON', '{"foods": ['],
        ['a document in another locale', matvaretabellenDocument([makeMatvaretabellenFood()], 'nb')],
        ['a document with no foods list', JSON.stringify({ locale: 'en' })],
        ['a food with no id', matvaretabellenDocument([{ ...makeMatvaretabellenFood(), foodId: undefined }])],
        ['a food whose id is a number', matvaretabellenDocument([{ ...makeMatvaretabellenFood(), foodId: 6.178 }])],
        ['a food with no name', matvaretabellenDocument([{ ...makeMatvaretabellenFood(), foodName: undefined }])],
        ['a food with a blank name', matvaretabellenDocument([makeMatvaretabellenFood({ foodName: ' ' })])],
        [
            'an id that repeats once trimmed',
            matvaretabellenDocument([
                makeMatvaretabellenFood({ foodId: '01.332' }),
                makeMatvaretabellenFood({ foodId: '01.332 ' }),
            ]),
        ],
        ['a food that is not an object', matvaretabellenDocument(['06.178'])],
    ])('refuses %s', (_, text) => {
        let thrown: unknown;

        try {
            parseMatvaretabellenFoods(text);
        } catch (error) {
            thrown = error;
        }

        expect(isMirrorFeedFormatError(thrown)).toBe(true);
    });
});
