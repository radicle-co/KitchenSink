/**
 * @module @commise/features-recipes/discovery/useStateCriteriaStore — the {@link DiscoveryCriteriaStore} for a host with
 * no URL to keep the criteria in: component state (mobile). Web's twin is URL-backed and lives in the web app, because
 * the router is the app's.
 *
 * @pattern Adapter — the criteria port over `useState`
 */
import { useState } from 'react';

import { EMPTY_RECIPE_FILTERS, type RecipeFilterState } from '../filters/model.js';
import type { DiscoveryCriteriaState, DiscoveryCriteriaStore } from './discoveryScreenModel.js';

/**
 * Criteria held in component state.
 *
 * @param initialFilters - Filters to pre-apply on first mount (a tag deep-link). Read once; later changes are ignored,
 *     like any `useState` seed.
 * @returns The store: the committed criteria and the `commit` that replaces them.
 * @sideEffect `commit` updates component state.
 */
export function useStateCriteriaStore(initialFilters?: RecipeFilterState): DiscoveryCriteriaStore {
    const [criteria, setCriteria] = useState<DiscoveryCriteriaState>({
        filters: initialFilters ?? EMPTY_RECIPE_FILTERS,
        query: '',
    });

    return { ...criteria, commit: setCriteria };
}
