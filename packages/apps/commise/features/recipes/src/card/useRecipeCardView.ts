/**
 * @module @commise/features-recipes/card — the hook that derives a card's view for its Root to provide.
 *
 * Its own file because a file declares one hook (`oneHookPerFile.test.ts`); the context and its parts stay in
 * `recipeCardContext.ts`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';

import { recipeMessages } from '../messages.js';
import type { RecipeCardModel } from './model.js';
import { recipeCardViewOf, type RecipeCardView } from './recipeCardView.js';

/**
 * The card's view for the Root to provide: the recipe's view in the active locale's copy, as of now. Shared by both
 * leaves so the derivation has one call site.
 *
 * @param recipe - The card's model.
 * @returns The view.
 * @sideEffect Reads the clock, so `recipeCardViewOf` itself stays pure.
 */
export function useRecipeCardView(recipe: RecipeCardModel): RecipeCardView {
    const copy = useMessages(recipeMessages);
    const locale = useLocale();

    return recipeCardViewOf(recipe, copy, locale, new Date().toISOString());
}
