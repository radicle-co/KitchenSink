/**
 * @module @commise/features-recipes — web recipe filter bar (FR-006 / W4 S2).
 *
 * Controlled, presentational, facet-driven filter bar built per W9-f **P9**: the facets are DATA — an ordered
 * list of {@link FacetDescriptor}s (`kind: 'multiChip' | 'singleChip' | 'timeBucket' | 'ingredientTypeahead'`)
 * — dispatched through a `kind → renderer` map, so a new facet is a descriptor entry, not a new JSX branch.
 * It renders Dietary + Tags (multi-select chips), Cuisine (single-select, since the search API filters by
 * ONE cuisine), the Prep-time + Cook-time (REQ-030f) + Total-time bucket ladders, and the Ingredients
 * typeahead (FR-006 gap #3). It fetches nothing and owns no state — not even for the ingredient typeahead:
 * the container owns `useIngredientFilterSearch` (`hooks/useIngredientFilterSearch.ts`) and passes its live
 * query + view state down as `ingredientSearch`, exactly like `facets`/`filters` are passed down, so this
 * component stays a pure `props -> JSX` renderer end to end. A group with no buckets/results and no active
 * selection is omitted (never offer an empty filter) — except the ingredient search box itself, which is
 * always offered (there is no facet count to gate it on).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Ingredient } from '@kitchensink/recipe-core';
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
type FacetKind = 'multiChip' | 'singleChip' | 'timeBucket' | 'ingredientTypeahead';

/** One facet, expressed as DATA (P9). The render map dispatches on {@link kind}. */
interface FacetDescriptor {
    readonly id: string;
    readonly kind: FacetKind;
    readonly labelKey: keyof FilterMessages;
    /** For `multiChip` — the multi-select dimension it toggles. */
    readonly dimension?: FacetDimension;
    /** For `timeBucket` — the single-value time bound it sets. */
    readonly timeField?: 'maxPrepTime' | 'maxCookTime' | 'maxTotalTime';
}

/** The facets the bar offers, in display order. Adding a facet is a new entry here, never new JSX. */
const FACET_DESCRIPTORS: readonly FacetDescriptor[] = [
    { id: 'dietaryFlags', kind: 'multiChip', dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
    { id: 'cuisine', kind: 'singleChip', labelKey: 'cuisineLabel' },
    { id: 'tags', kind: 'multiChip', dimension: 'tags', labelKey: 'tagsLabel' },
    { id: 'maxPrepTime', kind: 'timeBucket', timeField: 'maxPrepTime', labelKey: 'maxPrepTimeLabel' },
    { id: 'maxCookTime', kind: 'timeBucket', timeField: 'maxCookTime', labelKey: 'maxCookTimeLabel' },
    { id: 'maxTotalTime', kind: 'timeBucket', timeField: 'maxTotalTime', labelKey: 'maxTotalTimeLabel' },
    { id: 'ingredients', kind: 'ingredientTypeahead', labelKey: 'ingredientsLabel' },
];

/** The `timeField` → setter map the `timeBucket` renderer dispatches on. */
function timeSetterFor(
    timeField: 'maxPrepTime' | 'maxCookTime' | 'maxTotalTime',
    setters: {
        onSetMaxPrepTime: (minutes: number | undefined) => void;
        onSetMaxCookTime: (minutes: number | undefined) => void;
        onSetMaxTotalTime: (minutes: number | undefined) => void;
    },
): (minutes: number | undefined) => void {
    if (timeField === 'maxPrepTime') {
        return setters.onSetMaxPrepTime;
    }

    if (timeField === 'maxCookTime') {
        return setters.onSetMaxCookTime;
    }

    return setters.onSetMaxTotalTime;
}

export const RecipeFilterBar: FC<RecipeFilterBarProps> = ({
    facets,
    filters,
    onToggleFacet,
    onSetCuisine,
    onSetMaxPrepTime,
    onSetMaxCookTime,
    onSetMaxTotalTime,
    ingredientSearch,
    onAddIngredientFilter,
    onRemoveIngredientFilter,
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
            const set = timeSetterFor(timeField!, { onSetMaxPrepTime, onSetMaxCookTime, onSetMaxTotalTime });

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
        ingredientTypeahead: ({ labelKey }) => {
            const selected = filters.ingredients ?? [];
            const selectedIds = new Set(selected.map((entry) => entry.id));
            const { viewState } = ingredientSearch;
            const visibleResults: readonly Ingredient[] =
                viewState.kind === 'results'
                    ? viewState.results.filter((ingredient) => !selectedIds.has(ingredient.id))
                    : [];

            return group(m[labelKey], [
                <div key="typeahead" className="flex flex-col gap-2">
                    <input
                        type="search"
                        aria-label={m.ingredientSearchLabel}
                        placeholder={m.ingredientSearchPlaceholder}
                        value={ingredientSearch.query}
                        onChange={(event) => ingredientSearch.onQueryChange(event.target.value)}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
                    />

                    {/* The label is the region's CONTENT, not only its `aria-label`: an empty `role="status"`
                        node is zero-height (invisible to a sighted viewer) and silent (a live region
                        announces content CHANGES, and there is none). Same doctrine as `RecipePhotoManager`
                        and the mobile `LoadingState` — the contextual label doubles as the visible caption. */}
                    {viewState.kind === 'searching' && (
                        <p role="status" aria-label={m.ingredientSearching} className="text-body-sm text-slate">
                            {m.ingredientSearching}
                        </p>
                    )}

                    {viewState.kind === 'results' && viewState.isError && (
                        <p role="alert" className="text-body-sm text-error">
                            {m.ingredientSearchError}
                        </p>
                    )}

                    {viewState.kind === 'results' && !viewState.isError && visibleResults.length === 0 && (
                        <p className="text-body-sm text-slate">{m.ingredientNoMatches}</p>
                    )}

                    {visibleResults.length > 0 && (
                        <ul className="flex flex-col">
                            {visibleResults.map((ingredient) => (
                                <li key={ingredient.id}>
                                    {/* Named by its ACTION ("Filter by Flour"), not the bare ingredient name:
                                        the sibling search box already carries that exact string as its value,
                                        so a bare name is not uniquely addressable — see the
                                        `addIngredientFilter` message's doc for the failure that closes. */}
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(m.addIngredientFilter, { name: ingredient.name })}
                                        onClick={() =>
                                            onAddIngredientFilter({ id: ingredient.id, name: ingredient.name })
                                        }
                                        className="w-full rounded-lg px-3 py-2 text-left text-body-md text-charcoal transition hover:bg-pearl"
                                    >
                                        {ingredient.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {selected.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {selected.map((entry) => (
                                <button
                                    key={entry.id}
                                    type="button"
                                    aria-label={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                    onClick={() => onRemoveIngredientFilter(entry.id)}
                                    className={`${CHIP_BASE} ${CHIP_SELECTED}`}
                                >
                                    <span aria-hidden="true">{entry.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>,
            ]);
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
                        // The LABEL is `ocean-dark` while the FOCUS RING stays seafoam — that split is the
                        // palette rule (see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`), not drift.
                        className="rounded-full px-3.5 py-1.5 text-body-sm font-semibold text-ocean-dark underline-offset-2 transition-colors motion-reduce:transition-none hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light"
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
