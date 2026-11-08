import { useQuery } from '@tanstack/react-query';

import { recipeQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/recipes/private-slots` - the caller's private-slot standing (ADR-0073): `limited` with the count and the
 * server-stated limit, or `unlimited` for Premium.
 *
 * A DISPLAY read. Never withhold a private write on it: it may be a moment stale, and the server decides every write
 * under its own lock.
 *
 * @param options - `enabled: false` asks nothing (a surface that hides paid features shows no count).
 */
export function usePrivateSlots(options: QueryEnableOptions = {}) {
    const client = useRecipeServiceClient();

    return useQuery({
        ...recipeQueries(client).privateSlots(),
        enabled: options.enabled ?? true,
    });
}
