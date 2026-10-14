/**
 * The ids a row carries so the page can find it (`docs/design/uiOverhaul/ingredientArrival.md`): the row's list item is
 * the top of the span web scrolls into view, and no other id of the same line may spell it.
 */
import { describe, expect, it } from 'vitest';

import { ingredientEditorFieldId, ingredientNameFieldId, ingredientRowId } from '../fieldIds.js';

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
