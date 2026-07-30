import { describe, expect, it } from 'vitest';

import { RecipeVisibility, usesPremiumCapability } from '../../index.js';
import { makeRecipe } from '../fixtures.js';

describe('makeRecipe (T1 shared Object Mother)', () => {
    it('derives usesPremiumCapability from the recipe, never a hard-coded literal', () => {
        const priv = makeRecipe({ visibility: RecipeVisibility.PRIVATE });
        expect(priv.usesPremiumCapability).toBe(usesPremiumCapability(priv));
    });

    it('keeps averageRating absent exactly when ratingCount is 0 (no domain-illegal state)', () => {
        expect(makeRecipe({ ratingCount: 0 }).averageRating).toBeUndefined();
        expect(makeRecipe({ ratingCount: 3, averageRating: 4.5 }).averageRating).toBe(4.5);
    });
});
