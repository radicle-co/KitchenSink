'use client';

/**
 * @module @commise/features-recipes/filters — the web Discover filter panel (`docs/design/uiOverhaul/buildSpec.md`
 * §4.4): a sticky 256 px `aside` named "Filters" at the start side of the results, scrolling inside itself, with Clear
 * all at its top. It is drawn only at a 960 container in a window that is not short (`filterPresentationOf`); below
 * that the same groups live in the sheet, and never both.
 *
 * Colour is read from roles, so the panel follows the browser's scheme (D15).
 *
 * Presentational: it draws the facet groups in a panel and reports every change.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { FilterGroups } from './FilterGroups.js';
import type { FilterPanelProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

export const FilterPanel: FC<FilterPanelProps> = ({ view, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);

    return (
        <aside
            aria-label={m.panelLabel}
            className="sticky top-4 flex max-h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col gap-4 self-start overflow-y-auto rounded-md border border-line-divider bg-paper p-4"
        >
            {view.hasActive ? (
                <Button variant="ghost" size="sm" width="fill" onPress={() => onFilterAction({ kind: 'clearAll' })}>
                    {m.clearAll}
                </Button>
            ) : null}
            <FilterGroups
                view={view}
                chipOverflow="wrap"
                ingredientSearch={ingredientSearch}
                onFilterAction={onFilterAction}
            />
        </aside>
    );
};
