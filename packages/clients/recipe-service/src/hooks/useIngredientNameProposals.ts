import { useQuery } from '@tanstack/react-query';

import { ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/ingredients/by-name/proposals` — the foods the add-by-name field SUGGESTS for what the cook typed
 * (disabled for a blank name).
 *
 * A read that binds nothing. The caller shows the proposals as the first options of the field's list, captioned, and
 * never preselects one; the cook binds a proposal by picking it. Debouncing the typed text is the caller's job, as it is
 * for the field's own search.
 */
export function useIngredientNameProposals(name: string, options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...ingredientQueries(client).nameProposals(name),
        enabled: (options.enabled ?? true) && name.trim().length > 0,
    });
}
