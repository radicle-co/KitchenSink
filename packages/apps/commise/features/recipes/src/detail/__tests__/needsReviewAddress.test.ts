/**
 * `needsReviewAddressOf` — the address the owner's "Needs review" control carries into the editor.
 *
 * What these prove: the address names the line by its position in the STORED `recipe.ingredients` order (never an index
 * the page invented), at the detail's own `currentVersion`; and a line that does not need review, or a position the recipe
 * does not hold, has none — so the control cannot be drawn for a line the editor would not show as needing review.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { needsReviewAddressOf, reviewControlAddressOf } from '../model.js';

const recipe = makeRecipeDetail({
    currentVersion: 7,
    ingredients: [
        makeIngredientView({ ingredientId: 'a', name: 'salt' }),
        makeIngredientView({ ingredientId: 'b', name: 'flour', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
        makeIngredientView({ ingredientId: 'c', name: 'sugar', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
    ],
});

describe('needsReviewAddressOf', () => {
    it('is the stored position and the detail’s version, for each line that needs review', () => {
        expect(needsReviewAddressOf(recipe, 1)).toEqual({ version: 7, position: 1 });
        expect(needsReviewAddressOf(recipe, 2)).toEqual({ version: 7, position: 2 });
    });

    it('is nothing for a line that does not need review', () => {
        expect(needsReviewAddressOf(recipe, 0)).toBeUndefined();
    });

    it.each([-1, 3, 1.5, Number.NaN])('is nothing for the position %s', (position) => {
        expect(needsReviewAddressOf(recipe, position)).toBeUndefined();
    });
});

describe('reviewControlAddressOf', () => {
    const open = { owner: true, canOpenEditor: true };

    it('is the SECOND line’s address, not the first row’s, when only the second needs review', () => {
        const twoLines = makeRecipeDetail({
            currentVersion: 3,
            ingredients: [
                makeIngredientView({ ingredientId: 'a', name: 'salt' }),
                makeIngredientView({
                    ingredientId: 'b',
                    name: 'Smoked Paprika',
                    resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
                }),
            ],
        });

        expect(reviewControlAddressOf(twoLines, 0, open)).toBeUndefined();
        expect(reviewControlAddressOf(twoLines, 1, open)).toEqual({ version: 3, position: 1 });
    });

    it('is the line’s address for the owner when the editor can be opened', () => {
        expect(reviewControlAddressOf(recipe, 2, open)).toEqual({ version: 7, position: 2 });
    });

    it('is nothing for a viewer who does not own the recipe', () => {
        expect(reviewControlAddressOf(recipe, 1, { owner: false, canOpenEditor: true })).toBeUndefined();
    });

    it('is nothing when the surface has no way to open the editor', () => {
        expect(reviewControlAddressOf(recipe, 1, { owner: true, canOpenEditor: false })).toBeUndefined();
    });

    it('is nothing for a line that does not need review, even for the owner', () => {
        expect(reviewControlAddressOf(recipe, 0, open)).toBeUndefined();
    });
});
