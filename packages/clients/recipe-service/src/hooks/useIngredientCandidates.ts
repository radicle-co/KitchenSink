import { useQuery } from '@tanstack/react-query';

import { ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED` ingredient.
 * Gate it (`enabled`) on a line actually being `UNRESOLVED` so it never fetches for a resolved/freeform line.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate.
 */
export function useIngredientCandidates(id: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).candidates(id),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}
