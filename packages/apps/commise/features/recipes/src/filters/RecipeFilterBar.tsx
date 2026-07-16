/**
 * @module @commise/features-recipes — web recipe filter bar (FR-006 building block).
 *
 * Controlled, presentational, facet-driven filter bar for the search surface. It renders one labeled group
 * per facet dimension the server returned (dietary, tags) — each chip a real keyboard-operable toggle button
 * carrying its `aria-pressed` state and its value+count accessible name — plus a fixed "max total time"
 * bucket ladder and, when anything is active, a clear-all with a live count. It fetches nothing and owns no
 * state: the composing container passes the latest `facets` + `filters` and receives every change upward.
 *
 * A dimension with no facet buckets and no active selection is omitted entirely (never offer an empty
 * filter); a selected value the sampled facets omit is still rendered, so an active filter is always
 * clearable.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { filterMessages } from './messages.js';
import {
    buildFacetChips,
    countActiveFilters,
    formatFacetChipName,
    hasActiveFilters,
    TOTAL_TIME_BUCKETS_MINUTES,
    type FacetDimension,
    type RecipeFacetChip,
    type RecipeFilterBarProps,
} from './model.js';

const CHIP_BASE =
    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-body-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light';
const CHIP_SELECTED = 'border-seafoam bg-seafoam text-white';
const CHIP_UNSELECTED = 'border-border bg-card text-charcoal hover:border-seafoam-light';

/** The facet dimensions the bar renders, in display order, with their group-label message keys. */
const FACET_GROUPS: readonly { readonly dimension: FacetDimension; readonly labelKey: 'dietaryLabel' | 'tagsLabel' }[] =
    [
        { dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
        { dimension: 'tags', labelKey: 'tagsLabel' },
    ];

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({
    facets,
    filters,
    onToggleFacet,
    onSetMaxTotalTime,
    onClearAll,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();
    const countLabels = { one: m.chipCountOne, other: m.chipCountOther };

    const renderChip = (chip: RecipeFacetChip, dimension: FacetDimension) => {
        const name = formatFacetChipName(chip, countLabels, locale);

        return (
            <button
                key={chip.value}
                type="button"
                aria-pressed={chip.selected}
                aria-label={name}
                onClick={() => onToggleFacet(dimension, chip.value)}
                className={`${CHIP_BASE} ${chip.selected ? CHIP_SELECTED : CHIP_UNSELECTED}`}
            >
                <span aria-hidden="true">{chip.value}</span>
                {chip.count !== undefined && (
                    <span aria-hidden="true" className="text-caption opacity-70">
                        {chip.count}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div role="group" aria-label={m.barLabel} className="flex flex-col gap-3">
            {FACET_GROUPS.map(({ dimension, labelKey }) => {
                const chips = buildFacetChips(facets[dimension], filters[dimension] ?? []);

                if (chips.length === 0) {
                    return null;
                }

                return (
                    <div key={dimension} role="group" aria-label={m[labelKey]} className="flex flex-col gap-1.5">
                        <span className="text-caption font-semibold uppercase tracking-wide text-slate">
                            {m[labelKey]}
                        </span>
                        <div className="flex flex-wrap gap-2">{chips.map((chip) => renderChip(chip, dimension))}</div>
                    </div>
                );
            })}

            <div role="group" aria-label={m.maxTotalTimeLabel} className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold uppercase tracking-wide text-slate">
                    {m.maxTotalTimeLabel}
                </span>
                <div className="flex flex-wrap gap-2">
                    {TOTAL_TIME_BUCKETS_MINUTES.map((minutes) => {
                        const active = filters.maxTotalTime === minutes;

                        return (
                            <button
                                key={minutes}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onSetMaxTotalTime(active ? undefined : minutes)}
                                className={`${CHIP_BASE} ${active ? CHIP_SELECTED : CHIP_UNSELECTED}`}
                            >
                                {fillTemplate(m.timeBucket, { minutes })}
                            </button>
                        );
                    })}
                </div>
            </div>

            {hasActiveFilters(filters) && (
                <div>
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="rounded-full px-3.5 py-1.5 text-body-sm font-semibold text-seafoam underline-offset-2 transition-colors motion-reduce:transition-none hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light"
                    >
                        {formatRecipeCount(
                            countActiveFilters(filters),
                            { one: m.clearOne, other: m.clearOther },
                            locale,
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};
