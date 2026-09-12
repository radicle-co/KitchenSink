import { useMutation } from '@tanstack/react-query';

import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `GET /api/v1/ingredients/search/live?q=` — the ON-DEMAND live source search (plan U29).
 *
 * ⛔ **A MUTATION, not a query, and that is the point of the whole hook.** A `useQuery` keyed on the search
 * text would REFETCH whenever the key changed — which is exactly a per-keystroke live search, the one shape
 * the quota arithmetic forbids: the source allows 1,000 requests/hour PER IP, FR-019 reserves the top 10%
 * for user-facing work, and at 50 concurrent cooks a per-settled-query autocomplete would want roughly three
 * times the entire key. Modelling it as a Command that runs ONLY when `mutate()` is called makes "never
 * fires on a keystroke" a property of the type rather than of every caller's discipline.
 *
 * ⚠️ It is also the SLOW path — a multi-second wait is the expected experience, not a defect, and it sits
 * deliberately outside the 500ms budget that governs the local `useSuggestIngredients`.
 *
 * ⚠️ **No retry.** TanStack retries mutations never by default, and that default must not be changed here:
 * a retry would double the quota cost of exactly the failure (`SourceBusyError`) that means the quota is
 * already spent.
 *
 * Three outcomes a caller must keep apart: an EMPTY `hits` array (the source has nothing — stop looking),
 * `SourceBusyError` (the rate budget refused — retry, `retryAfterSeconds` when known) and
 * `SourceUnavailableError` (the source did not answer — retry, no known window).
 *
 * ⚠️ Nothing is invalidated on success: a live search READS an upstream source and writes nothing here, so
 * no cached query became stale. The catalog only changes when a hit is actually picked, and the admit
 * mutations own that invalidation.
 */
export function useSearchIngredientsLive() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (query: string) => client.searchIngredientsLive(query),
    });
}
