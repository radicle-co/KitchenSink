/**
 * Headless-hook seam (CP-6/P2 sibling) — the recipe-SEARCH ingredient filter's typeahead (FR-006 gap #3).
 *
 * Composes the SAME shared, unit-tested search primitives {@link import('./useIngredientResolver.js').useIngredientResolver}
 * is built from — `useSearchIngredients` (the catalog typeahead query), `rankIngredientResults`,
 * `meetsIngredientSearchThreshold`, `INGREDIENT_SEARCH_DEBOUNCE_MS`, and `useDebouncedValue` — rather than
 * the full resolver state machine. Reusing `useIngredientResolver` itself outright would be WRONG here, not
 * just heavier: that hook's `selectMatch`/`resolveLine` branch an `UNRESOLVED` catalog hit into
 * food-resolution disambiguation, and its `addByName`/`addFreeform` actions MUTATE the catalog (create a new
 * ingredient row). Filtering never needs any of that — a search result's `id` is already a valid
 * `ingredientIds` filter value regardless of its food-resolution status, and creating a brand-new
 * (zero-recipe) ingredient just to filter by it would be a wasted, confusing mutation with no matching
 * recipes. So this hook is READ-ONLY: search, rank, and hand back matches — the filter bar adds a picked
 * match's `id` + `name` straight to filter state (`filters/model.ts`'s `addIngredientFilter`).
 *
 * Platform-agnostic: no DOM/React Native imports.
 */
import { useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

import { deriveIngredientFilterSearchViewState } from '../filters/model.js';
import type { IngredientFilterSearchViewState } from '../filters/model.js';

import {
    INGREDIENT_SEARCH_DEBOUNCE_MS,
    meetsIngredientSearchThreshold,
    rankIngredientResults,
} from './ingredientResolver.model.js';
import { useDebouncedValue } from './useDebouncedValue.js';

/** The state + actions {@link useIngredientFilterSearch} exposes to the filter bar's container. */
export interface UseIngredientFilterSearchResult {
    /** The controlled search-box text (raw, untrimmed). */
    readonly query: string;
    /** Update the search-box text. */
    readonly setQuery: (query: string) => void;
    /** The current picker view. See {@link IngredientFilterSearchViewState} for the exact kinds. */
    readonly viewState: IngredientFilterSearchViewState;
}

/**
 * The read-only ingredient-filter typeahead's search state.
 *
 * @returns The search-box text + setter and the derived view state.
 */
export function useIngredientFilterSearch(): UseIngredientFilterSearchResult {
    const [query, setQuery] = useState('');
    const trimmed = query.trim();
    // REQ-057's debounce/threshold discipline, reused verbatim (see module doc): never search below the
    // 2-character trigger, and debounce ~300ms behind keystrokes.
    const debouncedTrimmed = useDebouncedValue(trimmed, INGREDIENT_SEARCH_DEBOUNCE_MS);

    const search = useSearchIngredients(debouncedTrimmed, undefined, {
        enabled: meetsIngredientSearchThreshold(debouncedTrimmed),
    });

    const results = rankIngredientResults(search.data ?? [], trimmed);

    const viewState = deriveIngredientFilterSearchViewState({
        trimmed,
        debouncedTrimmed,
        results,
        isLoading: search.isLoading,
        isError: search.isError,
    });

    return { query, setQuery, viewState };
}
