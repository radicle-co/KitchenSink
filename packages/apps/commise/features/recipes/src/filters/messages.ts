/**
 * @module @commise/features-recipes/filters/messages — user-facing copy for the recipe filter bar (FR-006).
 *
 * Shared, platform-neutral strings for the filter bar as a {@link LocalizedMessages} dictionary, consumed by
 * BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on
 * copy. The `en` set is required; adding a locale is just another key. Scoped to filters so it can grow
 * independently of the shared recipe-feature copy in `../messages.ts` (per the per-area message-file pattern).
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe filter bar (FR-006), rendered by both the web and native bars. */
export interface FilterMessages {
    /** The panel's name, and the sheet's title. */
    readonly panelLabel: string;
    /** The applied-filter chips' group name. */
    readonly appliedLabel: string;
    /** The total-time choice that clears the bound. */
    readonly anyTime: string;
    /** The disclosure that holds the prep and cook ladders. */
    readonly moreTimeLabel: string;
    /** Opens a chip group past its cap (contains `{n}`: how many there are in all). */
    readonly showAll: string;
    /** Folds a group back to its cap. */
    readonly showFewer: string;
    /** An applied prep-time chip (contains `{minutes}`). */
    readonly appliedPrep: string;
    /** An applied cook-time chip (contains `{minutes}`). */
    readonly appliedCook: string;
    /** The accessible name of an applied chip's remove action (contains `{filter}`). */
    readonly removeFilter: string;
    /** The Filters button's visible text while filters are active (contains `{count}`). */
    readonly filtersBadge: string;
    /** Clears every filter. */
    readonly clearAll: string;
    /** The sheet's primary: the live count (contains `{count}`), singular. */
    readonly showResultsOne: string;
    /** The sheet's primary: the live count (contains `{count}`), plural. */
    readonly showResultsOther: string;
    /** The sheet's primary while no search has settled, so there is no count to state. */
    readonly showResultsUnknown: string;
    /** Group label for the dietary-flag facet. */
    readonly dietaryLabel: string;
    /** Group label for the tag facet. */
    readonly tagsLabel: string;
    /** Group label for the single-select Cuisine facet (S2). */
    readonly cuisineLabel: string;
    /** Group label for the max-prep-time bound (S2). */
    readonly maxPrepTimeLabel: string;
    /** Group label for the max-cook-time bound (REQ-030f). */
    readonly maxCookTimeLabel: string;
    /** Group label for the max-total-time bound. */
    readonly maxTotalTimeLabel: string;
    /** Time-bucket button template (contains `{minutes}`). */
    readonly timeBucket: string;
    /** Group label for the ingredient typeahead filter (FR-006 gap #3). */
    readonly ingredientsLabel: string;
    /** Accessible name for the ingredient search box. */
    readonly ingredientSearchLabel: string;
    /** Accessible name of the ingredient search box's clear control. */
    readonly ingredientSearchClear: string;
    /** Placeholder text for the ingredient search box: an example, never a label. */
    readonly ingredientSearchPlaceholder: string;
    /** Loading status announced while an ingredient search is in flight. */
    readonly ingredientSearching: string;
    /** Shown when an ingredient search settles with zero matches. */
    readonly ingredientNoMatches: string;
    /** Shown when an ingredient search fails. */
    readonly ingredientSearchError: string;
    /**
     * Accessible-name template for a typeahead RESULT that adds an ingredient filter (contains `{name}`).
     *
     * States the ACTION, not just the ingredient: the option sits next to a search box that already holds the
     * very name the user typed, so a bare `{name}` makes the two indistinguishable to anything that addresses
     * a control BY NAME — voice control, a switch-access menu, the Maestro flow — and such an activation
     * resolves to the field (earlier in the tree) instead of the option, silently dropping the selection. The
     * visible row still reads just the ingredient name, which this template contains (WCAG 2.5.3).
     */
    readonly addIngredientFilter: string;
    /** Accessible-name template for a chip that removes a selected ingredient (contains `{name}`). */
    readonly removeIngredientFilter: string;
    /**
     * Shown in place of the ingredient search once the filter holds as many ingredients as one search allows
     * (contains `{max}`). It says what to do, because the search box it replaces is gone.
     */
    readonly ingredientFilterFull: string;
    /** Visible label of the button that opens the filter bottom sheet (native, U7). */
    readonly filtersButton: string;
    /** Accessible-name template for the filters button while filters are active (contains `{count}`). */
    readonly filtersButtonActive: string;
    /** Accessible name of the sheet's icon-only close control (house form "Close {thing}", §S8.1a). */
    readonly filtersClose: string;
}

export const filterMessages: LocalizedMessages<FilterMessages> = {
    en: {
        panelLabel: 'Filters',
        appliedLabel: 'Applied filters',
        anyTime: 'Any',
        moreTimeLabel: 'More time filters',
        showAll: 'Show all ({n})',
        showFewer: 'Show fewer',
        appliedPrep: 'Prep: under {minutes} min',
        appliedCook: 'Cook: under {minutes} min',
        removeFilter: 'Remove {filter} filter',
        filtersBadge: 'Filters · {count}',
        clearAll: 'Clear all',
        showResultsOne: 'Show {count} recipe',
        showResultsOther: 'Show {count} recipes',
        showResultsUnknown: 'Show recipes',
        dietaryLabel: 'Dietary',
        tagsLabel: 'Tags',
        cuisineLabel: 'Cuisine',
        maxPrepTimeLabel: 'Prep time',
        maxCookTimeLabel: 'Cook time',
        maxTotalTimeLabel: 'Total time',
        timeBucket: 'Under {minutes} min',
        filtersButton: 'Filters',
        filtersButtonActive: 'Filters, {count} active',
        filtersClose: 'Close filters',
        ingredientsLabel: 'Has ingredient',
        ingredientSearchLabel: 'Has ingredient',
        ingredientSearchClear: 'Clear ingredient search',
        ingredientSearchPlaceholder: 'chicken',
        ingredientSearching: 'Searching ingredients…',
        ingredientNoMatches: 'No matching ingredients',
        ingredientSearchError: 'We couldn’t search ingredients. Try again.',
        addIngredientFilter: 'Filter by {name}',
        removeIngredientFilter: 'Remove {name}',
        ingredientFilterFull: 'You can filter by up to {max} ingredients. Remove one to add another.',
    },
};
