import { useQuery } from '@tanstack/react-query';

import { recipeQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/recipes/nutrition-batch` — per-serving nutrition for a page of recipes, fetched AFTER the
 * cards render (the deferred calorie lookup).
 *
 * ⛔ HOW TO READ THE RESULT. `data.nutrition` is keyed by recipe id, and a recipe the viewer may not read is
 * simply ABSENT — a missing key means "not for you", never an error and never "no data". A present entry is
 * a discriminated union: narrow on `state`, render the figure for `known` (a `0` there is a real measured
 * zero), and render nothing/a caveat for `unaccounted`. There is no `pending` on the wire; the pending state
 * is this hook's own `isPending`, and it is bounded by a real deadline, so a skeleton cannot become
 * permanent. An `isError` result means the same thing to a card as `unaccounted`: show it without a figure.
 *
 * @param recipeIds - The recipes on screen. Bounded by the published cap; the query is idle for an empty list.
 * @param options.enabled - Gate the read (e.g. until the card list itself has loaded).
 */
export function useRecipeNutrition(recipeIds: readonly string[], options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();
    const query = recipeQueries(client).nutritionBatch(recipeIds);

    return useQuery({
        ...query,
        // AND-ed with the factory's own empty-list gate rather than replacing it: a caller passing
        // `enabled: true` must not be able to fire a request the service is guaranteed to reject.
        enabled: (options.enabled ?? true) && query.enabled,
    });
}
