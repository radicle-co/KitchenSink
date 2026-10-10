/**
 * @module dataSources/useDataSourcesView — the Data sources page's read and the state it shows, shared by the web and
 * native screens (curated U25; `docs/design/ingredientSpecialization.md` §S16 "States").
 *
 * @pattern Headless hook — it reads the sources and derives the page's state (`dataSourcesViewOf`), which each screen
 *     draws
 */
import { useDataSources } from '@kitchensink/food-service-client/hooks';
import { useState } from 'react';

import { useAppFocused } from '../hooks/useAppFocused.js';
import { type DataSourcesPageView, dataSourcesViewOf } from './dataSourcesView.js';

/** What a screen draws, and its one action. */
export interface DataSourcesViewModel {
    readonly view: DataSourcesPageView;
    /** Reads that have failed (TanStack's `errorUpdateCount`): each one is announced. */
    readonly failures: number;
    /** Times the failure has left the page, taking Try again with it: the page's `headingFocusSignal`. */
    readonly recoveries: number;
    /** Reads the sources again. */
    readonly onRetry: () => void;
}

/**
 * The Data sources page's state, and Try again.
 *
 * Whether the page shows the failure is kept from the previous render (React's "store information from previous
 * renders" pattern), so a read that starts under a failure on screen is a retry, and a page that has shown none is
 * loading. The same comparison counts each time the failure leaves the page.
 *
 * @returns The state, the failure and recovery counts, and Try again.
 * @sideEffect Reads `GET /api/v1/foods/sources` from food-service.
 */
export function useDataSourcesView(): DataSourcesViewModel {
    const query = useDataSources();
    const appIsFocused = useAppFocused();
    const [failureShown, setFailureShown] = useState(false);
    const [recoveries, setRecoveries] = useState(0);
    const view = dataSourcesViewOf(appIsFocused, query, failureShown);
    const showsFailure = view.kind === 'error';

    if (showsFailure !== failureShown) {
        setFailureShown(showsFailure);

        if (!showsFailure) {
            setRecoveries((count) => count + 1);
        }
    }

    return { view, failures: query.errorUpdateCount, recoveries, onRetry: () => void query.refetch() };
}
