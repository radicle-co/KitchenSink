/**
 * The ids a row carries so the page can find it (`docs/design/uiOverhaul/ingredientArrival.md`): the row's list item is
 * the top of the span web scrolls into view, and no other id of the same line may spell it.
 */
import { describe, expect, it } from 'vitest';

import {
    entryFieldIdOf,
    ingredientAddFieldId,
    ingredientEditorFieldId,
    ingredientNameFieldId,
    ingredientRowId,
} from '../fieldIds.js';
import { seedLineKey } from '../lineKey.js';

describe('ingredientRowId', () => {
    it('is stable for a key and differs between keys', () => {
        expect(ingredientRowId('line-1')).toBe(ingredientRowId('line-1'));
        expect(ingredientRowId('line-1')).not.toBe(ingredientRowId('line-2'));
    });

    it('never spells another id of the same line: the row is not a field', () => {
        const others = [
            ...(['amount', 'amountHigh', 'unit', 'prep'] as const).map((field) =>
                ingredientEditorFieldId('line-1', field),
            ),
            ingredientNameFieldId('line-1'),
        ];

        expect(others).not.toContain(ingredientRowId('line-1'));
    });
});

describe('entryFieldIdOf', () => {
    it('names the field an entry target types into: a row`s name field, or the trailing add field', () => {
        const key = seedLineKey(1, 0);

        expect(entryFieldIdOf({ kind: 'line', key })).toBe(ingredientNameFieldId(key));
        expect(entryFieldIdOf({ kind: 'newLine' })).toBe(ingredientAddFieldId);
    });
});
