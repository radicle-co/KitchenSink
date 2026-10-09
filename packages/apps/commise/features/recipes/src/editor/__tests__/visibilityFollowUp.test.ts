/**
 * Visibility is its own endpoint (C-004), so after a publish or Save changes the editor sends it only when the cook's
 * choice differs from what the SERVER holds — read from the write's own answer, never from the editor's seed.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { visibilityFollowUp } from '../visibilityFollowUp.js';

describe('visibilityFollowUp', () => {
    it('asks for the cook`s choice when the server holds the other one', () => {
        const stored = makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC });

        expect(visibilityFollowUp(RecipeVisibility.PRIVATE, stored)).toBe(RecipeVisibility.PRIVATE);
        expect(
            visibilityFollowUp(RecipeVisibility.PUBLIC, makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })),
        ).toBe(RecipeVisibility.PUBLIC);
    });

    it('asks for nothing when the server already holds it', () => {
        expect(
            visibilityFollowUp(RecipeVisibility.PRIVATE, makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })),
        ).toBeUndefined();
    });
});
