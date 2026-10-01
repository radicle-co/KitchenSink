import { useQuery } from '@tanstack/react-query';

import { ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/ingredients/suggest` — the BLENDED ingredient typeahead (search Stage 2): the bound foods plus
 * the rest of food's catalog, deduped and sectioned by provenance. This is the ingredient PICKER's read;
 * `useSearchIngredients` stays the bound-foods read the recipe-search filter needs.
 *
 * Disabled for an empty query. The endpoint answers an empty list rather than failing when the food catalog
 * is slow/down, so `isError` here means recipe-service itself failed — a degraded catalog arrives as a
 * successful result whose `catalogAvailability` is `'unavailable'`.
 *
 * @param query - The (already debounced) name query.
 * @param limit - Max results per section.
 * @param options - Enable gate.
 */
export function useSuggestIngredients(query: string, limit?: number, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).suggest(query, limit),
        enabled: (options.enabled ?? true) && query.length > 0,
    });
}
