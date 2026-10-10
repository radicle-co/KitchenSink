'use client';

/**
 * @module @commise/features-recipes/filters — the web Discover filter sheet (`docs/design/uiOverhaul/buildSpec.md`
 * §4.4), over the design-system `Sheet`: the title "Filters" with a close ×, the groups in a scrolling body, and a
 * pinned footer with Clear all (secondary) and "Show {count} recipes" (primary). Below a 600 window the two stack full
 * width with the primary on top.
 *
 * Filters apply live underneath, so the primary only closes the sheet; its count is the live number of recipes the
 * filters leave. The sheet hands focus back to the Filters button on close (the `Sheet`'s own focus return).
 *
 * Presentational: it draws the facet groups in a sheet and reports every change.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { FilterGroups } from './FilterGroups.js';
import { showResultsLabel } from './filterCopy.js';
import type { FilterSheetProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

export const FilterSheet: FC<FilterSheetProps> = ({
    open,
    onOpenChange,
    view,
    chipOverflow,
    ingredientSearch,
    onFilterAction,
    resultCount,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={m.panelLabel}
            closeLabel={m.filtersClose}
            size="content"
            footer={
                <div className="flex flex-col-reverse gap-3 medium:flex-row medium:justify-end">
                    {view.hasActive ? (
                        <Button
                            variant="secondary"
                            icon="x"
                            width="fill"
                            onPress={() => onFilterAction({ kind: 'clearAll' })}
                        >
                            {m.clearAll}
                        </Button>
                    ) : null}
                    <Button icon="check" size="lg" width="fill" onPress={() => onOpenChange(false)}>
                        {showResultsLabel(resultCount, m, locale)}
                    </Button>
                </div>
            }
        >
            <FilterGroups
                view={view}
                chipOverflow={chipOverflow}
                ingredientSearch={ingredientSearch}
                onFilterAction={onFilterAction}
            />
        </Sheet>
    );
};
