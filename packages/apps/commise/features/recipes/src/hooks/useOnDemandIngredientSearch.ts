/**
 * Headless-hook seam (CP-6/P2) — the ON-DEMAND live source search (plan U29): the behaviour behind the
 * picker's "Search USDA for '…'" control, shared by the web and mobile leaves so neither can drift on when
 * a source call is made.
 *
 * ⛔ **The search runs ONLY when {@link UseOnDemandIngredientSearchResult.search} is called.** It is a
 * TanStack MUTATION (`useSearchIngredientsLive`), not a query — a query keyed on the search text would
 * refetch whenever the key changed, which is a per-keystroke live search. The upstream source allows 1,000
 * requests/hour PER IP, shared by every cook, and 003's FR-019 reserves only the top 10% for user-facing
 * work; at 50 concurrent cooks even a perfect one-call-per-settled-query autocomplete would want roughly
 * three times the entire key. So this must stay a deliberate, occasional action a cook chooses.
 * ⛔ Do not wire `search` to an effect, a debounce, or a "local results look thin" threshold. All three are
 * the same mistake, and the last one is the most tempting because it fires on exactly the queries a cook is
 * least likely to abandon.
 *
 * It composes INSIDE {@link useIngredientResolver} rather than being called by each leaf, so a leaf gets one
 * hook and one view model, and the two platforms cannot disagree about the trigger.
 *
 * @implements FR-010a
 */
import { useSearchIngredientsLive } from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

import { canRunLiveSearch, deriveLiveSearchState } from './liveIngredientSearch.model.js';
import type { LiveSearchViewState } from './liveIngredientSearch.model.js';

/** The state + actions the on-demand search exposes to a leaf (through the resolver). */
export interface UseOnDemandIngredientSearchResult {
    /** The panel's current view. See {@link LiveSearchViewState} for the kinds and what each means. */
    readonly state: LiveSearchViewState;
    /**
     * Whether the affordance may be pressed — false below the 003-FR-010a minimum and while a search is
     * already running. A leaf renders it `disabled`, so a press that could only be refused never happens.
     */
    readonly canSearch: boolean;
    /**
     * Run the search for the current query. **The ONLY thing that causes a source call.** A no-op when
     * {@link canSearch} is false, so a leaf that forgets the `disabled` attribute still cannot spend the
     * lane on a query the server would refuse.
     */
    readonly search: () => void;
    /** Clear a settled result or failure and return the panel to idle, without searching again. */
    readonly dismiss: () => void;
}

/**
 * The shared on-demand live-search machine.
 *
 * @param trimmed - The picker's current trimmed query. Read at press time, never subscribed to.
 * @returns The panel state, the press gate, and the two actions a leaf wires.
 */
export function useOnDemandIngredientSearch(trimmed: string): UseOnDemandIngredientSearchResult {
    // The query the last search was issued FOR. Held separately from `trimmed` so a settled result can be
    // recognised as belonging to a phrase the cook has since edited — see the model's derivation.
    const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
    const liveSearch = useSearchIngredientsLive();

    const canSearch = canRunLiveSearch(trimmed, liveSearch.isPending);

    return {
        state: deriveLiveSearchState({
            searchedQuery,
            trimmed,
            isPending: liveSearch.isPending,
            data: liveSearch.data,
            error: liveSearch.error,
        }),
        canSearch,
        search: (): void => {
            if (!canSearch) {
                return;
            }

            // ⛔ Reset BEFORE issuing, so a retry after a failure does not spend its first render showing the
            // previous attempt's error under a request that is already in flight.
            liveSearch.reset();
            setSearchedQuery(trimmed);
            liveSearch.mutate(trimmed);
        },
        dismiss: (): void => {
            setSearchedQuery(null);
            liveSearch.reset();
        },
    };
}
