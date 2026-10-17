/**
 * `recipeVisibilityVariablesOf` is the one reader of a cached visibility write's variables: the mutation cache types
 * them `unknown`, so it parses the shape `useSetRecipeVisibility` files rather than claiming it.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { recipeVisibilityVariablesOf } from '../hooks/useSetRecipeVisibility.js';

describe('recipeVisibilityVariablesOf', () => {
    it('accepts the real variables shape and returns it', () => {
        const variables = { id: 'rec_1', visibility: RecipeVisibility.PRIVATE };

        expect(recipeVisibilityVariablesOf(variables)).toEqual(variables);
    });

    it.each([
        ['undefined', undefined],
        ['a foreign mutation shape', { id: 'rec_1', rating: 5 }],
        ['an unknown visibility', { id: 'rec_1', visibility: 'friends' }],
        ['a non-string id', { id: 7, visibility: RecipeVisibility.PUBLIC }],
        ['a bare string', 'rec_1'],
    ])('refuses %s', (_name, variables) => {
        expect(recipeVisibilityVariablesOf(variables)).toBeUndefined();
    });
});
