/**
 * @module dataSources/DataSourcesScreen — the Data sources SHEET on its read, native (curated U25;
 * `docs/design/ingredientSpecialization.md` §S16). The recipe detail opens it, because that screen has no stack of its
 * own to push a page onto; Profile pushes `DataSourcesPushedScreen` instead (A-026).
 *
 * The orchestration component: it reads `GET /api/v1/foods/sources` straight from food-service (plan 002 S5) through
 * `useDataSourcesView`, and draws the read's states (`DataSourcesStates`) inside the full-screen sheet. Links open
 * through `openExternalUrl`, which checks the address first.
 *
 * @pattern Template — the sheet and the pushed page share the read and its states and differ only in the frame
 */
import type { FC } from 'react';

import { DataSourcesPage } from './DataSourcesPage.native.js';
import { DataSourcesStates } from './DataSourcesStates.native.js';
import type { DataSourcesScreenNativeProps } from './model.js';
import { useDataSourcesView } from './useDataSourcesView.js';

export const DataSourcesScreen: FC<DataSourcesScreenNativeProps> = ({ onRequestClose }) => {
    const { view, failures, recoveries, onRetry } = useDataSourcesView();

    return (
        <DataSourcesPage onRequestClose={onRequestClose} headingFocusSignal={recoveries}>
            <DataSourcesStates view={view} failures={failures} onRetry={onRetry} />
        </DataSourcesPage>
    );
};
