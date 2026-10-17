/**
 * @module @commise/features-recipes/hooks — the editor's ONE background nutrition read (plan 002 U9 batch), shared by
 * every row's panel and the running total (blueprint Decision 3). Nutrition never enters the draft.
 *
 * The previous answer stays on screen while a changed ref list is read (`keepPreviousData`), so adding a line does not
 * blank every figure; refs the placeholder does not answer read as loading (`nutritionLookupFrom`).
 *
 * @pattern Adapter — the TanStack query adapted to the pure `IngredientNutrition` the leaves take
 */
import { useIngredientFoodNutrition } from '@kitchensink/recipe-service-client/hooks';

import {
    ingredientNutritionFrom,
    nutritionReadFrom,
    refsOf,
    type IngredientNutrition,
} from '../form/nutritionLookup.js';
import type { RecipeFormValues } from '../form/values.js';

/**
 * The editor's nutrition for its current draft.
 *
 * @param values - The editor's draft.
 * @returns The lookup, the read's state and its retry.
 * @sideEffect Reads `POST /api/v1/ingredients/food-nutrition` in the background (no write).
 */
export function useLineNutrition(values: RecipeFormValues): IngredientNutrition {
    const refs = refsOf(values);
    const query = useIngredientFoodNutrition(refs, { keepPreviousData: true });

    return ingredientNutritionFrom(
        nutritionReadFrom(refs.length, {
            data: query.data,
            isPlaceholderData: query.isPlaceholderData,
            isError: query.isError,
        }),
        () => {
            void query.refetch();
        },
    );
}
