import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { IngredientFoodNutritionRequest } from '@kitchensink/schema-recipe';

import { ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/food-nutrition` — per-100 g nutrition for a batch of food refs (plan 002 U9).
 *
 * ⛔ Match entries to foods by `ref`, never by position: the read sends the refs deduplicated and sorted, so the
 * entries are in that order, not the caller's.
 *
 * Narrow each entry on `outcome`: `found` carries the figures (a missing one stays missing, never 0), `absent`
 * means there is nothing the viewer may read, and `unavailable` means food could not be asked. An `isError` result
 * means the same to a caller as `unavailable` for every ref.
 *
 * @param refs - The food refs, root or variant. The query is idle for an empty list.
 * @param options.enabled - Gate the read.
 * @param options.keepPreviousData - Keep the previous answer on screen (`isPlaceholderData`) while a changed ref list
 *   is read, so a caller reading one batch for many lines does not blank every figure when a line is added.
 */
export function useIngredientFoodNutrition(
    refs: IngredientFoodNutritionRequest['refs'],
    options: QueryEnableOptions & { readonly keepPreviousData?: boolean } = {},
) {
    const client = useRecipeServiceClient();
    const query = ingredientQueries(client).foodNutrition(refs);

    return useQuery({
        ...query,
        // AND-ed with the factory's own empty-list gate, so a caller cannot fire a request the service rejects.
        enabled: (options.enabled ?? true) && query.enabled,
        ...(options.keepPreviousData === true ? { placeholderData: keepPreviousData } : {}),
    });
}
