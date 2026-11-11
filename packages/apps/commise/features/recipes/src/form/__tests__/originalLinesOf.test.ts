/**
 * `originalLinesOf` — the cook's own line, by draft line key, for display in a needs-review row editor.
 *
 * What these prove: it reads `RecipeIngredientView.sourceLine` (the server decides who gets it) and keys it by the line at
 * the same STORED position; a line with no source line has no entry; and when the keys cannot be lined up with the read
 * (different counts) it answers NOTHING rather than risk showing one line's words on another. It never touches the form
 * value `sourceLine`, which is create-only write provenance.
 */
import { describe, expect, it } from 'vitest';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { seedLineKey } from '../lineKey.js';
import { originalLinesOf, toRecipeFormValues } from '../wire.js';

const detail = makeRecipeDetail({
    currentVersion: 3,
    ingredients: [
        makeIngredientView({ ingredientId: 'a', name: 'salt' }),
        { ...makeIngredientView({ ingredientId: 'b', name: 'flour' }), sourceLine: '1 1/2 cups sifted flour, or so' },
        { ...makeIngredientView({ ingredientId: 'c', name: 'sugar' }), sourceLine: 'sugar to taste' },
    ],
});
const keys = [seedLineKey(3, 0), seedLineKey(3, 1), seedLineKey(3, 2)];

describe('originalLinesOf', () => {
    it('keys each source line by the line at the same stored position', () => {
        expect(originalLinesOf(detail, keys)).toEqual(
            new Map([
                [keys[1], '1 1/2 cups sifted flour, or so'],
                [keys[2], 'sugar to taste'],
            ]),
        );
    });

    it('has no entry for a line with no source line', () => {
        expect(originalLinesOf(detail, keys).has(keys[0]!)).toBe(false);
    });

    it('answers nothing when the keys do not line up with the read', () => {
        expect(originalLinesOf(detail, keys.slice(0, 2)).size).toBe(0);
        expect(originalLinesOf(detail, []).size).toBe(0);
    });

    it('is display only: the form values keep their create-only sourceLine untouched', () => {
        const values = toRecipeFormValues(detail);

        expect(values.ingredients.every((line) => line.sourceLine === undefined)).toBe(true);
    });
});
