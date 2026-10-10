'use client';

/**
 * @module @commise/features-recipes/filters — the web applied-filter chips (`docs/design/uiOverhaul/buildSpec.md` §4.4):
 * each filter in force as a removable input chip named "Remove {filter} filter", in a scrolling row, then Clear all
 * (ghost) once two or more apply. It stands in for the panel below 960, so a cook sees and drops what narrows the
 * results without opening the sheet. With nothing applied it draws nothing.
 *
 * Presentational: it draws the applied-filter chips and reports removals.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import type { FC } from 'react';

import type { AppliedFiltersProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

/** From this many applied filters, Clear all earns its place. */
const CLEAR_ALL_FROM = 2;

export const AppliedFilters: FC<AppliedFiltersProps> = ({ view, chipOverflow, onFilterAction }) => {
    const m = useMessages(filterMessages);

    if (view.applied.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-x-2">
            <ChipRow mode="input" label={m.appliedLabel} overflow={chipOverflow}>
                {view.applied.map((entry) => (
                    <Chip
                        key={entry.key}
                        kind="input"
                        label={entry.label}
                        removeLabel={entry.removeLabel}
                        onRemove={() => onFilterAction(entry.action)}
                    />
                ))}
            </ChipRow>
            {view.applied.length >= CLEAR_ALL_FROM ? (
                <Button variant="ghost" size="sm" onPress={() => onFilterAction({ kind: 'clearAll' })}>
                    {m.clearAll}
                </Button>
            ) : null}
        </div>
    );
};
