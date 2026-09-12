'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources LIST (presentational; plan R55, design §S16).
 *
 * The settled read: one card per source, or the empty copy. ⛔ It renders the service's order — the register's
 * dataset order, USDA first — and never sorts it again.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { DataSourceCard } from './DataSourceCard.js';
import { dataSourcesMessages } from './messages.js';
import type { DataSourcesListProps } from './model.js';

/**
 * The settled read: one card per cited source, in the service's order, or the empty copy.
 *
 * @param props - The cited sources.
 * @returns The cards, or the empty state.
 */
export const DataSourcesList: FC<DataSourcesListProps> = ({ sources }) => {
    const messages = useMessages(dataSourcesMessages);

    if (sources.length === 0) {
        return <p className="text-body-md text-slate">{messages.empty}</p>;
    }

    return (
        <div className="flex flex-col gap-3">
            {sources.map((source) => (
                <DataSourceCard key={source.id} source={source} />
            ))}
        </div>
    );
};
