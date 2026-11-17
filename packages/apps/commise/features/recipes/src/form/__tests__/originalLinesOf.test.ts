/**
 * `originalLinesOf` — the cook's own line, by draft line key, for display in a needs-review row editor.
 *
 * What these prove: it reads `RecipeIngredientView.sourceLine` (the server decides who gets it) and keys it by the line at
 * the same STORED position, through the one alignment rule (`lineKeyAt`: the version must match); a line with no source line has no entry; and when the keys cannot be lined up with the read
 * (a different version) it answers NOTHING rather than risk showing one line's words on another. It never touches the form
 * value `sourceLine`, which is create-only write provenance.
 */
import { describe, expect, it } from 'vitest';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { lineKeyAt, seedLineKey } from '../lineKey.js';
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
// The editor's own door (`useRecipeEditor.lineKeyAt`): keys seeded at version 3.
const keyAtVersion3 = (address: { readonly version: number; readonly position: number }) => lineKeyAt(keys, 3, address);

describe('originalLinesOf', () => {
    it('keys each source line by the line at the same stored position', () => {
        expect(originalLinesOf(detail, keyAtVersion3)).toEqual(
            new Map([
                [keys[1], '1 1/2 cups sifted flour, or so'],
                [keys[2], 'sugar to taste'],
            ]),
        );
    });

    it('has no entry for a line with no source line', () => {
        expect(originalLinesOf(detail, keyAtVersion3).has(keys[0]!)).toBe(false);
    });

    it('answers nothing when the read is at a different version than the keys were seeded at', () => {
        // Same line count, but version 4 may have reordered the lines: one line's words could land on another row.
        expect(originalLinesOf({ ...detail, currentVersion: 4 }, keyAtVersion3).size).toBe(0);
    });

    it('answers nothing when the editor holds no such stored line', () => {
        expect(originalLinesOf(detail, () => undefined).size).toBe(0);
    });

    it('is display only: the form values keep their create-only sourceLine untouched', () => {
        const values = toRecipeFormValues(detail);

        expect(values.ingredients.every((line) => line.sourceLine === undefined)).toBe(true);
    });
});
