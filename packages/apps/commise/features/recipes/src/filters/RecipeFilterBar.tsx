/**
 * @module @commise/features-recipes — web recipe filter bar (FR-006 / W4 S2).
 *
 * Controlled, presentational, facet-driven filter bar built per W9-f **P9**: the facets are DATA — an ordered
 * list of {@link FacetDescriptor}s (`kind: 'multiChip' | 'singleChip' | 'timeBucket'`) — dispatched through a
 * `kind → renderer` map, so a new facet is a descriptor entry, not a new JSX branch. It renders Dietary +
 * Tags (multi-select chips), Cuisine (single-select, since the search API filters by ONE cuisine), and the
 * Prep-time + Total-time bucket ladders (there is no cook-time filter, so none is offered). It fetches
 * nothing and owns no state: the container passes the latest `facets` + `filters` and receives every change
 * upward. A group with no buckets and no active selection is omitted (never offer an empty filter).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { filterMessages, type FilterMessages } from './messages.js';
import {
    TIME_BUCKETS_MINUTES,
    buildFacetChips,
    countActiveFilters,
    formatFacetChipName,
    hasActiveFilters,
    type FacetDimension,
    type RecipeFacetChip,
    type RecipeFilterBarProps,
} from './model.js';

const CHIP_BASE =
    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-body-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light';
const CHIP_SELECTED = 'border-seafoam bg-seafoam text-white';
const CHIP_UNSELECTED = 'border-border bg-card text-charcoal hover:border-seafoam-light';

/** The kinds of facet the render map knows how to draw. */
type FacetKind = 'multiChip' | 'singleChip' | 'timeBucket';

/** One facet, expressed as DATA (P9). The render map dispatches on {@link kind}. */
interface FacetDescriptor {
    readonly id: string;
    readonly kind: FacetKind;
    readonly labelKey: keyof FilterMessages;
    /** For `multiChip` — the multi-select dimension it toggles. */
    readonly dimension?: FacetDimension;
    /** For `timeBucket` — the single-value time bound it sets. */
    readonly timeField?: 'maxPrepTime' | 'maxTotalTime';
}

/** The facets the bar offers, in display order. Adding a facet is a new entry here, never new JSX. */
const FACET_DESCRIPTORS: readonly FacetDescriptor[] = [
    { id: 'dietaryFlags', kind: 'multiChip', dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
    { id: 'cuisine', kind: 'singleChip', labelKey: 'cuisineLabel' },
    { id: 'tags', kind: 'multiChip', dimension: 'tags', labelKey: 'tagsLabel' },
    { id: 'maxPrepTime', kind: 'timeBucket', timeField: 'maxPrepTime', labelKey: 'maxPrepTimeLabel' },
    { id: 'maxTotalTime', kind: 'timeBucket', timeField: 'maxTotalTime', labelKey: 'maxTotalTimeLabel' },
];

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({
    facets,
    filters,
    onToggleFacet,
    onSetCuisine,
    onSetMaxPrepTime,
    onSetMaxTotalTime,
    onClearAll,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();
    const countLabels = { one: m.chipCountOne, other: m.chipCountOther };

    const chipButton = (chip: RecipeFacetChip, onSelect: () => void): ReactElement => (
        <button
            key={chip.value}
            type="button"
            aria-pressed={chip.selected}
            aria-label={formatFacetChipName(chip, countLabels, locale)}
            onClick={onSelect}
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

    const group = (label: string, children: readonly ReactElement[]): ReactElement => (
        <div role="group" aria-label={label} className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-slate">{label}</span>
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    );

    // The kind → renderer map: every facet is drawn by dispatching on its descriptor's `kind` (P9).
    const renderers: Record<FacetKind, (descriptor: FacetDescriptor) => ReactElement | null> = {
        multiChip: ({ dimension, labelKey }) => {
            const chips = buildFacetChips(facets[dimension as 'dietaryFlags' | 'tags'], filters[dimension!] ?? []);

            if (chips.length === 0) {
                return null;
            }

            return group(
                m[labelKey],
                chips.map((chip) => chipButton(chip, () => onToggleFacet(dimension!, chip.value))),
            );
        },
        singleChip: ({ labelKey }) => {
            const chips = buildFacetChips(facets.cuisine, filters.cuisine !== undefined ? [filters.cuisine] : []);

            if (chips.length === 0) {
                return null;
            }

            return group(
                m[labelKey],
                chips.map((chip) => chipButton(chip, () => onSetCuisine(chip.value))),
            );
        },
        timeBucket: ({ timeField, labelKey }) => {
            const set = timeField === 'maxPrepTime' ? onSetMaxPrepTime : onSetMaxTotalTime;

            return group(
                m[labelKey],
                TIME_BUCKETS_MINUTES.map((minutes) => {
                    const active = filters[timeField!] === minutes;

                    return (
                        <button
                            key={minutes}
                            type="button"
                            aria-pressed={active}
                            onClick={() => set(active ? undefined : minutes)}
                            className={`${CHIP_BASE} ${active ? CHIP_SELECTED : CHIP_UNSELECTED}`}
                        >
                            {fillTemplate(m.timeBucket, { minutes })}
                        </button>
                    );
                }),
            );
        },
    };

    return (
        <div role="group" aria-label={m.barLabel} className="flex flex-col gap-3">
            {FACET_DESCRIPTORS.map((descriptor) => (
                <div key={descriptor.id}>{renderers[descriptor.kind](descriptor)}</div>
            ))}

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
