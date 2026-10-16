'use client';

/**
 * @module useUrlCriteriaStore — the web adapter for the discovery screen's criteria port: the URL
 * (`?query=…&tags=…`) is the single source of truth, so a filtered view is shareable and survives reload.
 *
 * Writes go through `window.history.replaceState`, which Next integrates with `useSearchParams()` without a server
 * round-trip, so a keystroke never costs a navigation.
 *
 * @pattern Adapter — the criteria port over the URL
 */
import { filtersFromQueryString, filtersToQueryString } from '@commise/features-recipes';
import type { DiscoveryCriteriaState, DiscoveryCriteriaStore } from '@commise/features-recipes/discovery';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * The discovery criteria as the URL holds them.
 *
 * @returns The store: the criteria parsed from the URL, and a `commit` that writes them back.
 * @sideEffect `commit` replaces the current history entry.
 */
export function useUrlCriteriaStore(): DiscoveryCriteriaStore {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { filters, query } = filtersFromQueryString(searchParams.toString());

    const commit = useCallback(
        (next: DiscoveryCriteriaState): void => {
            const qs = filtersToQueryString(next.filters, next.query);
            window.history.replaceState(null, '', qs.length > 0 ? `${pathname}?${qs}` : pathname);
        },
        [pathname],
    );

    return { filters, query, commit };
}
