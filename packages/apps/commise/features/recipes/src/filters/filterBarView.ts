/**
 * @module @commise/features-recipes/filters — the filter bar's facets as data (W9-f P9) and the view they read into,
 * shared by the web and native `RecipeFilterBar` leaves (FR-006 / W4 S2).
 *
 * The facets are an ordered list of descriptors, so a new facet is a descriptor entry, not new JSX. `filterBarViewOf`
 * reads each one against the search's facets and the active filter, and both leaves draw the one result: which chips a
 * group offers and what pressing each asks for, which time bucket is active and what pressing it asks for, and which
 * typeahead results are not already filtered on. A chip group with nothing to offer is absent, so no empty filter is
 * offered; the ingredient slot is always present, because it holds the search box or the note that replaces it.
 *
 * Pure: it builds the actions a press dispatches and dispatches none of them.
 *
 * @pattern Interpreter — `filterBarViewOf` reads each facet descriptor into the view its leaf draws (P9)
 */
import type { Locale } from '@commise/i18n';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import type { FilterMessages } from './messages.js';
import {
    TIME_BUCKETS_MINUTES,
    buildFacetChips,
    countActiveFilters,
    formatFacetChipName,
    hasActiveFilters,
    type FacetDimension,
    type FilterAction,
    type FoodIngredient,
    type IngredientFilterSearchViewState,
    type RecipeFacetChip,
    type RecipeFacets,
    type RecipeFilterState,
    type RecipeIngredientFilter,
    type TimeBoundField,
} from './model.js';

/** One facet, expressed as DATA (P9): what it reads, and which of its group's copy names it. */
type FacetDescriptor = { readonly id: string; readonly labelKey: keyof FilterMessages } & (
    | { readonly kind: 'multiChip'; readonly dimension: FacetDimension }
    | { readonly kind: 'singleChip' }
    | { readonly kind: 'timeBucket'; readonly timeField: TimeBoundField }
    | { readonly kind: 'ingredientTypeahead' }
);

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

/** One facet chip: its value and state, its accessible name, and what pressing it asks for. */
export interface FacetChipView {
    readonly chip: RecipeFacetChip;
    readonly name: string;
    readonly action: FilterAction;
}

/** One "under N minutes" bucket: its bound, its label, whether it is the active bound, and what pressing it asks for. */
export interface TimeBucketView {
    readonly minutes: number;
    readonly label: string;
    readonly active: boolean;
    readonly action: FilterAction;
}

/** What one facet's group draws. */
export type FacetGroupView =
    | { readonly kind: 'chips'; readonly label: string; readonly chips: readonly FacetChipView[] }
    | { readonly kind: 'timeBuckets'; readonly label: string; readonly buckets: readonly TimeBucketView[] }
    | {
          readonly kind: 'ingredients';
          readonly label: string;
          /** The typeahead's view state, which decides what the search slot holds. */
          readonly search: IngredientFilterSearchViewState;
          /** The search's results not already filtered on, each with the add it asks for. */
          readonly results: readonly { readonly ingredient: FoodIngredient; readonly action: FilterAction }[];
          /** The ingredients filtered on, each with the removal it asks for. */
          readonly selected: readonly { readonly entry: RecipeIngredientFilter; readonly action: FilterAction }[];
      };

/** One facet's place in the bar, and its group, absent when it has nothing to offer. */
export interface FacetSlot {
    readonly id: string;
    readonly group: FacetGroupView | undefined;
}

/** What the view is read from: the search's facets, the active filter, and the typeahead's view state. */
export interface FilterBarViewInput {
    readonly facets: RecipeFacets;
    readonly filters: RecipeFilterState;
    readonly viewState: IngredientFilterSearchViewState;
}

/** What a `RecipeFilterBar` leaf draws. */
export interface FilterBarView {
    readonly slots: readonly FacetSlot[];
    readonly activeCount: number;
    /** The trigger's accessible name, which carries the active count. */
    readonly triggerLabel: string;
    /** The clear-all control's label, absent when nothing is filtered. */
    readonly clearAllLabel: string | undefined;
}

/**
 * A chip group, or nothing when it has no chip to offer. Pure.
 *
 * @param label - The group's name.
 * @param chips - Its chips.
 * @param actionOf - What pressing a chip asks for.
 * @param copy - The bar's copy, for each chip's count.
 * @param locale - The active locale.
 * @returns The group, or `undefined`.
 */
const chipGroup = (
    label: string,
    chips: readonly RecipeFacetChip[],
    actionOf: (chip: RecipeFacetChip) => FilterAction,
    copy: FilterMessages,
    locale: Locale,
): FacetGroupView | undefined =>
    chips.length === 0
        ? undefined
        : {
              kind: 'chips',
              label,
              chips: chips.map((chip) => ({
                  chip,
                  name: formatFacetChipName(chip, { one: copy.chipCountOne, other: copy.chipCountOther }, locale),
                  action: actionOf(chip),
              })),
          };

/**
 * Read one facet descriptor into its group. Pure.
 *
 * @param descriptor - The facet.
 * @param input - The facets, the filter and the typeahead's view state.
 * @param copy - The bar's copy.
 * @param locale - The active locale.
 * @returns The facet's group, or `undefined` when it has nothing to offer.
 */
const groupOf = (
    descriptor: FacetDescriptor,
    { facets, filters, viewState }: FilterBarViewInput,
    copy: FilterMessages,
    locale: Locale,
): FacetGroupView | undefined => {
    const label = copy[descriptor.labelKey];

    switch (descriptor.kind) {
        case 'multiChip': {
            const { dimension } = descriptor;

            return chipGroup(
                label,
                buildFacetChips(facets[dimension], filters[dimension] ?? []),
                (chip) => ({ kind: 'toggleFacet', dimension, value: chip.value }),
                copy,
                locale,
            );
        }

        case 'singleChip':
            return chipGroup(
                label,
                buildFacetChips(facets.cuisine, filters.cuisine !== undefined ? [filters.cuisine] : []),
                (chip) => ({ kind: 'setCuisine', cuisine: chip.value }),
                copy,
                locale,
            );

        case 'timeBucket': {
            const field = descriptor.timeField;

            return {
                kind: 'timeBuckets',
                label,
                buckets: TIME_BUCKETS_MINUTES.map((minutes) => {
                    const active = filters[field] === minutes;

                    return {
                        minutes,
                        label: fillTemplate(copy.timeBucket, { minutes }),
                        active,
                        action: { kind: 'setTimeBound', field, minutes: active ? undefined : minutes },
                    };
                }),
            };
        }

        case 'ingredientTypeahead': {
            const selected = filters.ingredients ?? [];
            const selectedIds = new Set(selected.map((entry) => entry.foodId));
            const results = viewState.kind === 'results' ? viewState.results : [];

            return {
                kind: 'ingredients',
                label,
                search: viewState,
                results: results
                    .filter((ingredient) => !selectedIds.has(ingredient.foodId))
                    .map((ingredient) => ({
                        ingredient,
                        action: {
                            kind: 'addIngredient',
                            ingredient: { foodId: ingredient.foodId, name: ingredient.name },
                        },
                    })),
                selected: selected.map((entry) => ({
                    entry,
                    action: { kind: 'removeIngredient', foodId: entry.foodId },
                })),
            };
        }
    }
};

/**
 * The filter bar's view: every facet's group in display order, and the trigger's and clear-all's copy. Pure.
 *
 * @param input - The search's facets, the active filter and the typeahead's view state.
 * @param copy - The bar's copy.
 * @param locale - The active locale, for counts.
 * @returns What each leaf draws.
 */
export function filterBarViewOf(input: FilterBarViewInput, copy: FilterMessages, locale: Locale): FilterBarView {
    const activeCount = countActiveFilters(input.filters);

    return {
        slots: FACET_DESCRIPTORS.map((descriptor) => ({
            id: descriptor.id,
            group: groupOf(descriptor, input, copy, locale),
        })),
        activeCount,
        triggerLabel:
            activeCount > 0 ? fillTemplate(copy.filtersButtonActive, { count: activeCount }) : copy.filtersButton,
        clearAllLabel: hasActiveFilters(input.filters)
            ? formatRecipeCount(activeCount, { one: copy.clearOne, other: copy.clearOther }, locale)
            : undefined,
    };
}
