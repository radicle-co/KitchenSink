/**
 * @module dataSources/dataSourcesView — what the Data sources page shows for its read (curated U25;
 * `docs/design/ingredientSpecialization.md` §S16 "States"). Shared by the web and native screens.
 *
 * @pattern State — the page's state is derived from the read on every render, never copied into state
 */
import type { DataSourceView, DataSourcesResponse } from '@kitchensink/food-service-client';

import { queryReadState } from '../hooks/queryReadState.js';

/**
 * The page's state. An empty `sources` is the empty state, which the list draws. `retrying`: a failed read is reading
 * again, so the failure and its Try again stay in place (§S16 "States": focus stays where it is).
 */
export type DataSourcesPageView =
    | { readonly kind: 'loading' }
    | { readonly kind: 'offline' }
    | { readonly kind: 'error'; readonly retrying: boolean }
    | { readonly kind: 'loaded'; readonly sources: readonly DataSourceView[] };

/** The query fields the state depends on. */
export interface DataSourcesQueryView {
    readonly data: DataSourcesResponse | undefined;
    readonly isError: boolean;
    readonly fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * The page's state for the read. Pure.
 *
 * @param appIsFocused - Whether the app has focus (`useAppFocused`): a read parked in the background is not offline.
 * @param query - The `useDataSources` query.
 * @param failureShown - Whether the page shows the failure now (its previous view). A new fetch with no data resets
 *   TanStack's `status` to `pending`, so the read itself cannot tell a retry from a first load; the page can.
 * @returns The state.
 */
export function dataSourcesViewOf(
    appIsFocused: boolean,
    query: DataSourcesQueryView,
    failureShown: boolean,
): DataSourcesPageView {
    const state = queryReadState(
        { value: query.data?.sources, failed: query.isError, fetchStatus: query.fetchStatus },
        appIsFocused,
    );

    switch (state.kind) {
        case 'settled':
            return { kind: 'loaded', sources: state.value };
        case 'offline':
            return { kind: 'offline' };
        case 'failed':
            return { kind: 'error', retrying: false };
        case 'loading':
            // A read under a failure on screen is a retry: unmounting Try again would drop the focus and the reading
            // cursor that pressed it (WCAG 2.2 SC 2.4.3). A page that has shown no failure is loading.
            return failureShown ? { kind: 'error', retrying: true } : { kind: 'loading' };
    }
}
