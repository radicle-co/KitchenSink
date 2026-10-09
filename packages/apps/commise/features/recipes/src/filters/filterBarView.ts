/**
 * @module @commise/features-recipes/filters — Discover's filter groups as data (W9-f P9) and the view they read into,
 * shared by the web and native leaves of the panel and the sheet (`docs/design/uiOverhaul/buildSpec.md` §4.4).
 *
 * The groups are an ordered list of descriptors, so a new facet is a descriptor entry, not new JSX. `filterBarViewOf`
 * reads each one against the search's facets and the active filter, and the leaves draw the one result: Total time as a
 * choice with an "Any", prep and cook time behind one disclosure, the chip groups with their counts, the ingredient
 * typeahead, and the applied-filter chips that stand in for the panel where there is none. A chip group with nothing to
 * offer is absent, so no empty filter is offered; the ingredient slot is always present, because it holds the search box
 * or the note that replaces it.
 *
 * Pure: it builds the actions a press dispatches and dispatches none of them.
 *
 * @pattern Interpreter — `filterBarViewOf` reads each facet descriptor into the view its leaf draws (P9)
 */
import { fillTemplate } from '../list/model.js';
import type { FilterMessages } from './messages.js';
import {
    TIME_BUCKETS_MINUTES,
    buildFacetChips,
    countActiveFilters,
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

/** A chip group shows this many chips before "Show all"; a chosen chip is always shown. */
export const FACET_CHIP_LIMIT = 12;

/** The value of the choice that clears a time bound. */
const ANY_TIME = 'any';

/** One chip group, expressed as DATA (P9). */
type ChipDescriptor = { readonly id: string; readonly labelKey: keyof FilterMessages } & (
    | { readonly kind: 'multiChip'; readonly dimension: FacetDimension; readonly byCount?: true }
    | { readonly kind: 'singleChip' }
);

/** One time ladder, as DATA. */
interface TimeDescriptor {
    readonly id: TimeBoundField;
    readonly labelKey: keyof FilterMessages;
}

/** The top-level time ladder; prep and cook sit behind the disclosure. */
const TOTAL_TIME: TimeDescriptor = { id: 'maxTotalTime', labelKey: 'maxTotalTimeLabel' };
const MORE_TIME: readonly TimeDescriptor[] = [
    { id: 'maxPrepTime', labelKey: 'maxPrepTimeLabel' },
    { id: 'maxCookTime', labelKey: 'maxCookTimeLabel' },
];

/** The chip groups, in the order the spec draws them after the time ladders. */
const CHIP_GROUPS: readonly ChipDescriptor[] = [
    { id: 'dietaryFlags', kind: 'multiChip', dimension: 'dietaryFlags', labelKey: 'dietaryLabel' },
    { id: 'cuisine', kind: 'singleChip', labelKey: 'cuisineLabel' },
    { id: 'tags', kind: 'multiChip', dimension: 'tags', labelKey: 'tagsLabel', byCount: true },
];

/** One facet chip: its value and state, and what pressing it asks for. */
export interface FacetChipView {
    readonly chip: RecipeFacetChip;
    readonly action: FilterAction;
}

/** One option of a time ladder: a bound, or "Any". */
export interface TimeChoiceView {
    /** `'any'` or the bound in minutes, as the choice row reports it. */
    readonly value: string;
    readonly label: string;
    readonly action: FilterAction;
}

/** What one group draws. */
export type FacetGroupView =
    | { readonly kind: 'chips'; readonly label: string; readonly chips: readonly FacetChipView[] }
    | {
          readonly kind: 'timeChoices';
          readonly label: string;
          readonly options: readonly TimeChoiceView[];
          /** The chosen option's value. */
          readonly value: string;
      }
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

/** One place in the groups: a group, or the disclosure that holds several. */
export type FacetSlot =
    | { readonly kind: 'group'; readonly id: string; readonly group: FacetGroupView | undefined }
    | {
          readonly kind: 'disclosure';
          readonly id: string;
          readonly label: string;
          /** Open when a bound inside it is in force, so an active filter is never hidden. */
          readonly open: boolean;
          readonly groups: readonly { readonly id: string; readonly group: FacetGroupView }[];
      };

/** One filter in force, as a removable chip. */
export interface AppliedFilterView {
    readonly key: string;
    readonly label: string;
    /** The remove action's accessible name: "Remove {label} filter". */
    readonly removeLabel: string;
    readonly action: FilterAction;
}

/** What the view is read from: the search's facets, the active filter, and the typeahead's view state. */
export interface FilterBarViewInput {
    readonly facets: RecipeFacets;
    readonly filters: RecipeFilterState;
    readonly viewState: IngredientFilterSearchViewState;
}

/** What the panel, the sheet and the toolbar draw. */
export interface FilterBarView {
    readonly slots: readonly FacetSlot[];
    readonly activeCount: number;
    readonly hasActive: boolean;
    /** The Filters button's accessible name, which carries the active count. */
    readonly triggerLabel: string;
    /** The Filters button's visible text while filters are active ("Filters · 2"), absent when none are. */
    readonly triggerBadge: string | undefined;
    /** Every filter in force as a removable chip, in the order the groups are drawn. */
    readonly applied: readonly AppliedFilterView[];
}

/**
 * A chip group, or nothing when it has no chip to offer. Pure.
 *
 * @param label - The group's name.
 * @param chips - Its chips.
 * @param actionOf - What pressing a chip asks for.
 * @returns The group, or `undefined`.
 */
const chipGroup = (
    label: string,
    chips: readonly RecipeFacetChip[],
    actionOf: (chip: RecipeFacetChip) => FilterAction,
): FacetGroupView | undefined =>
    chips.length === 0
        ? undefined
        : { kind: 'chips', label, chips: chips.map((chip) => ({ chip, action: actionOf(chip) })) };

/**
 * The chip groups' chips, most used first when the descriptor asks. A chip with no count (a chosen value the search
 * returned no bucket for) sorts last. Stable. Pure.
 *
 * @param chips - The chips in the server's order.
 * @param byCount - Whether to order by count.
 * @returns The chips to draw.
 */
const orderedChips = (chips: readonly RecipeFacetChip[], byCount: boolean): readonly RecipeFacetChip[] =>
    byCount ? [...chips].sort((left, right) => (right.count ?? -1) - (left.count ?? -1)) : chips;

/**
 * One chip group's view. Pure.
 *
 * @param descriptor - The group.
 * @param facets - The search's facets.
 * @param filters - The active filter.
 * @param copy - The copy.
 * @returns The group, or `undefined` when it has nothing to offer.
 */
const chipGroupOf = (
    descriptor: ChipDescriptor,
    facets: RecipeFacets,
    filters: RecipeFilterState,
    copy: FilterMessages,
): FacetGroupView | undefined => {
    const label = copy[descriptor.labelKey];

    if (descriptor.kind === 'singleChip') {
        return chipGroup(
            label,
            buildFacetChips(facets.cuisine, filters.cuisine !== undefined ? [filters.cuisine] : []),
            (chip) => ({ kind: 'setCuisine', cuisine: chip.value }),
        );
    }

    const { dimension } = descriptor;

    return chipGroup(
        label,
        orderedChips(buildFacetChips(facets[dimension], filters[dimension] ?? []), descriptor.byCount === true),
        (chip) => ({ kind: 'toggleFacet', dimension, value: chip.value }),
    );
};

/**
 * One time ladder as a choice with an "Any". Pure.
 *
 * @param descriptor - The ladder.
 * @param filters - The active filter.
 * @param copy - The copy.
 * @returns The group.
 */
const timeGroupOf = (descriptor: TimeDescriptor, filters: RecipeFilterState, copy: FilterMessages): FacetGroupView => {
    const field = descriptor.id;
    const bound = filters[field];

    return {
        kind: 'timeChoices',
        label: copy[descriptor.labelKey],
        value: bound === undefined ? ANY_TIME : String(bound),
        options: [
            {
                value: ANY_TIME,
                label: copy.anyTime,
                action: { kind: 'setTimeBound', field, minutes: undefined },
            },
            ...TIME_BUCKETS_MINUTES.map((minutes) => ({
                value: String(minutes),
                label: fillTemplate(copy.timeBucket, { minutes }),
                action: { kind: 'setTimeBound', field, minutes } as const,
            })),
        ],
    };
};

/**
 * The ingredient typeahead's group. Pure.
 *
 * @param filters - The active filter.
 * @param viewState - The typeahead's view state.
 * @param copy - The copy.
 * @returns The group.
 */
const ingredientGroupOf = (
    filters: RecipeFilterState,
    viewState: IngredientFilterSearchViewState,
    copy: FilterMessages,
): FacetGroupView => {
    const selected = filters.ingredients ?? [];
    const selectedIds = new Set(selected.map((entry) => entry.foodId));
    const results = viewState.kind === 'results' ? viewState.results : [];

    return {
        kind: 'ingredients',
        label: copy.ingredientsLabel,
        search: viewState,
        results: results
            .filter((ingredient) => !selectedIds.has(ingredient.foodId))
            .map((ingredient) => ({
                ingredient,
                action: { kind: 'addIngredient', ingredient: { foodId: ingredient.foodId, name: ingredient.name } },
            })),
        selected: selected.map((entry) => ({ entry, action: { kind: 'removeIngredient', foodId: entry.foodId } })),
    };
};

/**
 * Every filter in force as a removable chip, in the order the groups are drawn. Pure.
 *
 * @param filters - The active filter.
 * @param copy - The copy.
 * @returns One chip per active filter.
 */
const appliedOf = (filters: RecipeFilterState, copy: FilterMessages): readonly AppliedFilterView[] => {
    const applied = (key: string, label: string, action: FilterAction): AppliedFilterView => ({
        key,
        label,
        removeLabel: fillTemplate(copy.removeFilter, { filter: label }),
        action,
    });
    const timeLabels: Readonly<Record<TimeBoundField, string>> = {
        maxTotalTime: copy.timeBucket,
        maxPrepTime: copy.appliedPrep,
        maxCookTime: copy.appliedCook,
    };
    const times = (['maxTotalTime', 'maxPrepTime', 'maxCookTime'] as const).flatMap((field) => {
        const minutes = filters[field];

        return minutes === undefined
            ? []
            : [
                  applied(field, fillTemplate(timeLabels[field], { minutes }), {
                      kind: 'setTimeBound',
                      field,
                      minutes: undefined,
                  }),
              ];
    });

    return [
        ...times,
        ...(filters.dietaryFlags ?? []).map((value) =>
            applied(`dietaryFlags:${value}`, value, { kind: 'toggleFacet', dimension: 'dietaryFlags', value }),
        ),
        ...(filters.cuisine === undefined
            ? []
            : [applied('cuisine', filters.cuisine, { kind: 'setCuisine', cuisine: undefined })]),
        ...(filters.tags ?? []).map((value) =>
            applied(`tags:${value}`, value, { kind: 'toggleFacet', dimension: 'tags', value }),
        ),
        ...(filters.ingredients ?? []).map((entry) =>
            applied(`ingredient:${entry.foodId}`, entry.name, { kind: 'removeIngredient', foodId: entry.foodId }),
        ),
    ];
};

/**
 * The chips a group draws with its cap applied. A chosen chip is always shown, so "Show all" never hides a filter that
 * is in force. Pure.
 *
 * @param chips - The group's chips.
 * @param expanded - Whether the cook opened the whole group.
 * @returns The chips to draw, and how many are behind "Show all".
 */
export function visibleChipsOf(
    chips: readonly FacetChipView[],
    expanded: boolean,
): { readonly shown: readonly FacetChipView[]; readonly hiddenCount: number } {
    if (expanded || chips.length <= FACET_CHIP_LIMIT) {
        return { shown: chips, hiddenCount: 0 };
    }

    const shown = chips.filter((entry, index) => index < FACET_CHIP_LIMIT || entry.chip.selected);

    return { shown, hiddenCount: chips.length - shown.length };
}

/**
 * The filter groups' view. Pure.
 *
 * @param input - The search's facets, the active filter and the typeahead's view state.
 * @param copy - The filters' copy.
 * @returns What each leaf draws.
 */
export function filterBarViewOf(input: FilterBarViewInput, copy: FilterMessages): FilterBarView {
    const { facets, filters, viewState } = input;
    const activeCount = countActiveFilters(filters);

    return {
        slots: [
            { kind: 'group', id: TOTAL_TIME.id, group: timeGroupOf(TOTAL_TIME, filters, copy) },
            {
                kind: 'disclosure',
                id: 'moreTime',
                label: copy.moreTimeLabel,
                open: MORE_TIME.some((descriptor) => filters[descriptor.id] !== undefined),
                groups: MORE_TIME.map((descriptor) => ({
                    id: descriptor.id,
                    group: timeGroupOf(descriptor, filters, copy),
                })),
            },
            ...CHIP_GROUPS.map((descriptor) => ({
                kind: 'group' as const,
                id: descriptor.id,
                group: chipGroupOf(descriptor, facets, filters, copy),
            })),
            { kind: 'group', id: 'ingredients', group: ingredientGroupOf(filters, viewState, copy) },
        ],
        activeCount,
        hasActive: hasActiveFilters(filters),
        triggerLabel:
            activeCount > 0 ? fillTemplate(copy.filtersButtonActive, { count: activeCount }) : copy.filtersButton,
        triggerBadge: activeCount > 0 ? fillTemplate(copy.filtersBadge, { count: activeCount }) : undefined,
        applied: appliedOf(filters, copy),
    };
}
