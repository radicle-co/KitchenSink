/**
 * @module dataSources/DataSourcesStates — the Data sources read's states, native (curated U25;
 * `docs/design/ingredientSpecialization.md` §S16): the failure's live region, then the one leaf the read's state picks.
 * Both native frames render it — the sheet the recipe detail opens and the page Profile pushes — so what the cook is
 * told about the read cannot differ between them.
 *
 * @pattern State — the read's state, a discriminated union (`dataSourcesViewOf`), selects the one leaf that draws it
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet } from 'react-native';

import { openExternalUrl } from '../detail/openExternalUrl.native.js';
import { DataSourcesList } from './DataSourcesList.native.js';
import { DataSourcesLoadError } from './DataSourcesLoadError.native.js';
import { DataSourcesSkeleton } from './DataSourcesSkeleton.native.js';
import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPageView } from './dataSourcesView.js';

/** Props for {@link DataSourcesStates}. */
export interface DataSourcesStatesProps {
    /** The read's state. */
    readonly view: DataSourcesPageView;
    /** Failed reads so far: each moves the failure's words to the other live region, so a second one is spoken. */
    readonly failures: number;
    /** Reads again. */
    readonly onRetry: () => void;
}

/**
 * The read's states under a frame's intro.
 *
 * @param props - The read's state, its failure count and the retry.
 * @returns The live region and the state's leaf.
 */
export const DataSourcesStates: FC<DataSourcesStatesProps> = ({ view, failures, onRetry }) => {
    const { readOffline } = useMessages(offlineNoticeMessages);
    const { loadFailed } = useMessages(dataSourcesMessages);
    const { colors } = useTheme();

    return (
        <>
            {/* The failure's words, mounted from the first render, empty until a read fails: Android speaks a change
                to a region it already holds. Each failure moves the words to the other region (`occurrence`), so a
                second failure is spoken too, while the reading cursor stays on Try again (§S16 "States"). */}
            <LiveRegion politeness="assertive" occurrence={failures} style={[styles.failure, { color: colors.ink }]}>
                {view.kind === 'error' ? loadFailed : ''}
            </LiveRegion>
            {view.kind === 'loading' && <DataSourcesSkeleton />}
            {view.kind === 'offline' && <OfflineReadSlot message={readOffline} />}
            {view.kind === 'error' && <DataSourcesLoadError onRetry={onRetry} retrying={view.retrying} />}
            {view.kind === 'loaded' && <DataSourcesList sources={view.sources} onOpen={openExternalUrl} />}
        </>
    );
};

const styles = StyleSheet.create({
    failure: { fontSize: nativeTokens.fontSize.bodyMd },
});
