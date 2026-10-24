/**
 * @module nutritionSlotRenderer — the one host closure that turns a batch lookup into a card's `renderNutrition` prop.
 *
 * Platform-agnostic on purpose: {@link RecipeNutritionSlot} is a single component both apps render (its leaves, the
 * chip and the skeleton, are the platform pair), so there is no `.native` twin to write. The lookup is a parameter
 * because `useRecipeNutritionBatches` is query-owned and this package must not import `@commise/query`.
 *
 * @pattern Factory Method — builds the per-card render prop from a lookup the host supplies
 */
import type { ReactNode } from 'react';

import type { RecipeNutritionLookup } from '../hooks/useRecipeNutritionBatches.js';
import { RecipeNutritionSlot } from './RecipeNutritionSlot.js';
import type { RenderRecipeNutrition } from './model.js';

/**
 * One slot per card, all reading the SAME batch promise.
 *
 * `null` from the lookup means no batch covers this recipe (we never asked), which renders nothing: never a boundary
 * with no promise to settle, which would be a skeleton for the life of the page.
 *
 * @param nutritionFor - Resolves the batch promise covering one recipe (`useRecipeNutritionBatches`' answer).
 * @returns The `renderNutrition` render prop the presentational views call once per card.
 */
export function nutritionSlotRenderer(nutritionFor: RecipeNutritionLookup): RenderRecipeNutrition {
    return (recipeId: string): ReactNode => {
        const batch = nutritionFor(recipeId);

        return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
    };
}
