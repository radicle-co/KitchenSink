import { useQuery } from '@tanstack/react-query';

import { DEFAULT_INGREDIENT_POLL_INTERVAL_MS, ingredientQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** Options for {@link useIngredientStatus}. */
export interface IngredientStatusOptions extends QueryEnableOptions {
    /** Poll cadence (ms) while the food is `PENDING`. Defaults to {@link DEFAULT_INGREDIENT_POLL_INTERVAL_MS}. */
    readonly pollIntervalMs?: number;
}

/**
 * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
 *
 * The poll is SELF-LIMITING: `refetchInterval` (from {@link ingredientQueries}`.status`) returns a cadence
 * ONLY while the last-seen status is `PENDING`, and `false` for every other state — `RESOLVED`,
 * `UNRESOLVED` (needs user disambiguation, not more polling), the `NOT_FOUND`/`FAILED` terminals, and a
 * freeform ingredient (no status). So it stops the instant nutrition arrives or a terminal/disambiguation
 * state is reached, never spinning on a food that will not change by polling. TanStack keeps a single
 * in-flight refetch per tick, and background refetching is left off, so it cannot storm the endpoint.
 *
 * @param id - The ingredient id (the query is disabled for an empty id).
 * @param options - Enable gate + poll cadence.
 */
export function useIngredientStatus(id: string, options: IngredientStatusOptions = {}) {
    const client = useRecipeServiceClient();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_INGREDIENT_POLL_INTERVAL_MS;

    return useQuery({
        ...ingredientQueries(client).status(id, pollIntervalMs),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}
