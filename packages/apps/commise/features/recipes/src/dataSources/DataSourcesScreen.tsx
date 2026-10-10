'use client';

/**
 * @module dataSources/DataSourcesScreen — the Data sources page on its read, web (curated U25;
 * `docs/design/ingredientSpecialization.md` §S16).
 *
 * The orchestration component: it reads `GET /api/v1/foods/sources` straight from food-service (plan 002 S5) through
 * `useDataSourcesView`, and picks the leaf for the read's state. The heading and the intro show at once, whatever the
 * read is doing.
 *
 * @pattern State — the read's state, a discriminated union (`dataSourcesViewOf`), selects the one leaf that draws it
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import type { FC } from 'react';

import { DataSourcesList } from './DataSourcesList.js';
import { DataSourcesLoadError } from './DataSourcesLoadError.js';
import { DataSourcesPage } from './DataSourcesPage.js';
import { DataSourcesSkeleton } from './DataSourcesSkeleton.js';
import type { DataSourcesScreenProps } from './model.js';
import { useDataSourcesView } from './useDataSourcesView.js';

export const DataSourcesScreen: FC<DataSourcesScreenProps> = ({ back }) => {
    const { view, failures, recoveries, onRetry } = useDataSourcesView();
    const { readOffline } = useMessages(offlineNoticeMessages);

    return (
        <DataSourcesPage headingFocusSignal={recoveries} {...(back === undefined ? {} : { back })}>
            {view.kind === 'loading' && <DataSourcesSkeleton />}
            {view.kind === 'offline' && <OfflineReadSlot message={readOffline} />}
            {view.kind === 'error' && (
                <DataSourcesLoadError onRetry={onRetry} retrying={view.retrying} failures={failures} />
            )}
            {view.kind === 'loaded' && <DataSourcesList sources={view.sources} />}
        </DataSourcesPage>
    );
};
