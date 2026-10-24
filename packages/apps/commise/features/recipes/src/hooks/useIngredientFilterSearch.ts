/**
 * Headless-hook seam (CP-6/P2 sibling) — the recipe-SEARCH ingredient filter's typeahead (FR-006 gap #3).
 *
 * Composes the SAME shared, unit-tested search primitives the editor's entry uses — `meetsSearchMinimum`,
 * `INGREDIENT_SEARCH_DEBOUNCE_MS` and `useDebouncedValue` — over `useSearchIngredients` (recipe's
 * `/ingredients/search`, ADR-0046 D1). Reusing the editor's entry would be WRONG here, not just heavier: its picks
 * commit lines, and its Find nutrition and Use as written MUTATE the catalog (create a new ingredient row). Filtering never needs any of that — a search result's `foodId` is already a valid
 * `foodIds` filter value, and creating a brand-new (zero-recipe) ingredient just to filter by it would be a
 * wasted, confusing mutation with no matching recipes. So this hook is READ-ONLY: search and hand back the
 * server's ranked matches — the filter bar adds a picked match's `foodId` + `name` straight to filter state
 * (`filters/model.ts`'s `addIngredientFilter`).
 *
 * Platform-agnostic: no DOM/React Native imports.
 */
import { useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

import { deriveIngredientFilterSearchViewState, isIngredientFilterFullAt } from '../filters/model.js';
import type { IngredientFilterSearchViewState } from '../filters/model.js';

import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from './ingredientSearchDebounce.js';
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
 * @param selectedCount - How many ingredients the filter already holds. A full filter offers no search, so nothing is
 *   asked even when a query was typed before the last add.
 * @returns The search-box text + setter and the derived view state.
 */
export function useIngredientFilterSearch(selectedCount: number): UseIngredientFilterSearchResult {
    const [query, setQuery] = useState('');
    const trimmed = query.trim();
    // REQ-057's debounce/threshold discipline, reused verbatim (see module doc): never search below the
    // 2-character trigger, and debounce ~300ms behind keystrokes.
    const debouncedTrimmed = useDebouncedValue(trimmed, INGREDIENT_SEARCH_DEBOUNCE_MS);

    const full = isIngredientFilterFullAt(selectedCount);
    const search = useSearchIngredients(debouncedTrimmed, undefined, {
        enabled: !full && meetsSearchMinimum(debouncedTrimmed),
    });

    // ⛔ The SERVER's order, unmodified (plan U5): the client re-rank `rankIngredientResults` is retired, and the server
    // now owns the order.
    const results = search.data ?? [];

    const viewState = deriveIngredientFilterSearchViewState({
        trimmed,
        debouncedTrimmed,
        results,
        isLoading: search.isLoading,
        isError: search.isError,
        selectedCount,
    });

    return { query, setQuery, viewState };
}
