/**
 * Headless-hook seam — the deferral between the discovery criteria a viewer sets and the criteria the results read.
 *
 * Both discovery containers suspend their results on the criteria this returns as `settled`. When the viewer changes
 * a criterion, React first re-renders with the PREVIOUS settled criteria (so the results already on screen stay, with
 * `stale` set) and resolves the new ones in the background, committing them once their read has settled. That is what
 * keeps a typed search from swapping the results for a skeleton on every debounced term. Debounce and deferral do
 * different jobs and neither replaces the other: the debounce limits how many searches are sent, the deferral keeps
 * the previous results visible while one is pending.
 *
 * ⛔ `useDeferredValue` compares with `Object.is`, and both containers build a fresh criteria object on every render.
 * So the criteria are memoized on PRIMITIVES — a `hashKey` of the filters (TanStack's own stable, key-sorted JSON), the
 * term, the sort and the browse flag — and the filters are read back from that key. The key is LOSSLESS by construction:
 * whatever filter state the viewer set comes back unchanged. (Reading them back through the URL parser, as this once
 * did, sanitised them — an off-ladder time bound or a repeated ingredient silently changed the search.)
 *
 * Platform-agnostic: no DOM or React Native imports.
 */
import { hashKey } from '@tanstack/react-query';
import { useDeferredValue, useMemo } from 'react';

import type { RecipeDiscoveryCriteria } from '../discovery/model.js';
import type { RecipeFilterState } from '../filters/model.js';

/** The criteria the results render, and whether newer criteria are pending behind them. */
export interface DeferredDiscoveryCriteria {
    /** The criteria whose results are on screen — the same object for as long as the criteria are unchanged. */
    readonly settled: RecipeDiscoveryCriteria;
    /** Whether the viewer has set newer criteria whose results have not settled yet. */
    readonly stale: boolean;
}

/**
 * Defer the discovery criteria.
 *
 * @param criteria - The criteria as the viewer has set them, freshly built each render.
 * @returns The settled criteria and whether newer ones are pending.
 */
export function useDeferredDiscoveryCriteria({
    filters,
    query,
    sortBy,
    browseDismissed,
}: RecipeDiscoveryCriteria): DeferredDiscoveryCriteria {
    const filtersKey = hashKey([filters]);
    const current = useMemo<RecipeDiscoveryCriteria>(
        () => ({ filters: (JSON.parse(filtersKey) as [RecipeFilterState])[0], query, sortBy, browseDismissed }),
        [filtersKey, query, sortBy, browseDismissed],
    );
    const settled = useDeferredValue(current);

    return { settled, stale: settled !== current };
}
