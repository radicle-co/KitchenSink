/**
 * Unit tests for `foodChoiceName.ts`: the ONE rule for a food option's accessible name, shared by the paste list and
 * the picker (owner rulings 2026-10-25): its name, then its variant's parts (`suggestionWithDetails`, the picker's
 * existing words), then the Default tag on the default food only — the order the eye reads them (WCAG 2.5.3).
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { foodChoiceNameOf } from '../foodChoiceName.js';
import { recipeFormMessages } from '../messages.js';

const copy = {
    suggestionWithDetails: recipeMessages.en.ingredientDetails.suggestionWithDetails,
    defaultOptionName: recipeFormMessages.en.foodSearch.defaultOptionName,
};

describe('foodChoiceNameOf', () => {
    it('a plain food is its name', () => {
        expect(foodChoiceNameOf({ name: 'Skim milk', detailParts: undefined, isDefault: false }, copy)).toBe(
            'Skim milk',
        );
    });

    it('a food with parts names them after it', () => {
        expect(
            foodChoiceNameOf({ name: 'Beef brisket', detailParts: ['flat half', 'select'], isDefault: false }, copy),
        ).toBe('Beef brisket, flat half, select');
    });

    it('the default food says Default after its name', () => {
        expect(foodChoiceNameOf({ name: 'Whole milk', detailParts: undefined, isDefault: true }, copy)).toBe(
            'Whole milk, Default',
        );
    });

    it('a default with parts says its parts, then Default', () => {
        expect(foodChoiceNameOf({ name: 'Oat milk', detailParts: ['unsweetened'], isDefault: true }, copy)).toBe(
            'Oat milk, unsweetened, Default',
        );
    });
});
