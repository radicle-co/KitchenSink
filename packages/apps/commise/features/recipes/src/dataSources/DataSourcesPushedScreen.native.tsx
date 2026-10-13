/**
 * @module dataSources/DataSourcesPushedScreen — the Data sources PAGE on its read, native, as a stack pushes it (A-026;
 * `docs/design/uiOverhaul/buildSpec.md` §9.2: "back to Profile, H1 Data sources"). It replaces, on Profile, the
 * full-screen sheet with its Close ×: a page keeps the tab bar and gets the navigator's back and focus restore.
 *
 * The orchestration component: the read (`useDataSourcesView`) and its states (`DataSourcesStates`) are the sheet's,
 * unchanged; only the frame differs. The host owns the route and what "Back to Profile" does.
 *
 * @pattern Template — the sheet and the pushed page share the read and its states and differ only in the frame
 */
import type { FC } from 'react';

import { DataSourcesPushedPage } from './DataSourcesPushedPage.native.js';
import { DataSourcesStates } from './DataSourcesStates.native.js';
import type { DataSourcesPushedScreenProps } from './model.js';
import { useDataSourcesView } from './useDataSourcesView.js';

export const DataSourcesPushedScreen: FC<DataSourcesPushedScreenProps> = ({ back }) => {
    const { view, failures, recoveries, onRetry } = useDataSourcesView();

    return (
        <DataSourcesPushedPage back={back} headingFocusSignal={recoveries}>
            <DataSourcesStates view={view} failures={failures} onRetry={onRetry} />
        </DataSourcesPushedPage>
    );
};
