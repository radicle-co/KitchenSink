/**
 * Unit tests for `foodChoiceName.ts`: the ONE rule for a food option's accessible name, shared by the matching lists and
 * the "Add an ingredient" picker (owner rulings 2026-10-25): its name, then its variant's parts (`suggestionWithDetails`,
 * the picker's existing words), then the Default tag on the default food only — the order the eye reads them
 * (WCAG 2.5.3).
 *
 * Rewritten when the module moved from `form/` to the neutral `ingredientMatching/` module (review finding m2): the
 * tag's word now comes from the ONE `defaultTag` key through `{tag}`, so the visible tag and the name can never say two
 * different words. The new case with a non-English tag pins that.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { foodChoiceNameOf } from '../foodChoiceName.js';
import { matchLineMessages } from '../messages.js';

const copy = {
    suggestionWithDetails: recipeMessages.en.ingredientDetails.suggestionWithDetails,
    defaultOptionName: matchLineMessages.en.defaultOptionName,
    defaultTag: matchLineMessages.en.defaultTag,
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

    it('⛔ the name says the tag’s own word, from the one tag key', () => {
        expect(
            foodChoiceNameOf(
                { name: 'Lait entier', detailParts: undefined, isDefault: true },
                { ...copy, defaultTag: 'Par défaut' },
            ),
        ).toBe('Lait entier, Par défaut');
    });
});
