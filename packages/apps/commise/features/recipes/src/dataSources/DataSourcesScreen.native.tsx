/**
 * @module dataSources/DataSourcesScreen — the Data sources sheet on its read, native (curated U25;
 * `docs/design/ingredientSpecialization.md` §S16).
 *
 * The orchestration component: it reads `GET /api/v1/foods/sources` straight from food-service (plan 002 S5) through
 * `useDataSourcesView`, and picks the leaf for the read's state, inside the full-screen sheet. Links open through
 * `openExternalUrl`, which checks the address first.
 *
 * @pattern State — the read's state, a discriminated union (`dataSourcesViewOf`), selects the one leaf that draws it
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import type { FC } from 'react';
import { StyleSheet } from 'react-native';

import { openExternalUrl } from '../detail/openExternalUrl.native.js';
import { DataSourcesList } from './DataSourcesList.native.js';
import { DataSourcesLoadError } from './DataSourcesLoadError.native.js';
import { DataSourcesPage } from './DataSourcesPage.native.js';
import { DataSourcesSkeleton } from './DataSourcesSkeleton.native.js';
import { dataSourcesMessages } from './messages.js';
import type { DataSourcesScreenNativeProps } from './model.js';
import { useDataSourcesView } from './useDataSourcesView.js';

export const DataSourcesScreen: FC<DataSourcesScreenNativeProps> = ({ onRequestClose }) => {
    const { view, failures, recoveries, onRetry } = useDataSourcesView();
    const { readOffline } = useMessages(offlineNoticeMessages);
    const { loadFailed } = useMessages(dataSourcesMessages);

    return (
        <DataSourcesPage onRequestClose={onRequestClose} headingFocusSignal={recoveries}>
            {/* The failure's words, mounted from the first render, empty until a read fails: Android speaks a change
                to a region it already holds. Each failure moves the words to the other region (`occurrence`), so a
                second failure is spoken too, while the reading cursor stays on Try again (§S16 "States"). */}
            <LiveRegion politeness="assertive" occurrence={failures} style={styles.failure}>
                {view.kind === 'error' ? loadFailed : ''}
            </LiveRegion>
            {view.kind === 'loading' && <DataSourcesSkeleton />}
            {view.kind === 'offline' && <OfflineReadSlot message={readOffline} />}
            {view.kind === 'error' && <DataSourcesLoadError onRetry={onRetry} retrying={view.retrying} />}
            {view.kind === 'loaded' && <DataSourcesList sources={view.sources} onOpen={openExternalUrl} />}
        </DataSourcesPage>
    );
};

const styles = StyleSheet.create({
    failure: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
});
