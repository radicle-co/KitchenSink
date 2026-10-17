/**
 * @module @commise/features-recipes/filters — the props the Discover filter components share, for both platforms
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4).
 *
 * The container reads the facets, the filter and the typeahead into one {@link FilterBarView} (`filterBarViewOf`) and
 * hands it to whichever of the panel and the sheet the presentation names. The components draw it and report every
 * change as a `FilterAction` — one intent channel, so the leaf says WHAT was asked and the reducer owns what it does.
 */
import type { ChipRowOverflow } from '@commise/ui/chip';

import type { FilterBarView } from './filterBarView.js';
import type { FilterAction, RecipeIngredientSearchState } from './model.js';

/** What every component that draws the groups takes. */
export interface FilterGroupsProps {
    readonly view: FilterBarView;
    /** Whether a chip row scrolls inside itself or wraps: scroll below a 600 container, wrap above. */
    readonly chipOverflow: ChipRowOverflow;
    /** The ingredient typeahead's live query and view state (FR-006 gap #3). */
    readonly ingredientSearch: RecipeIngredientSearchState;
    readonly onFilterAction: (action: FilterAction) => void;
}

/** The sticky panel at a 960 container: the groups with Clear all at the top. */
export type FilterPanelProps = Omit<FilterGroupsProps, 'chipOverflow'>;

/** The sheet below 960 (or in a short window): the groups, Clear all and "Show {count} recipes". */
export interface FilterSheetProps extends FilterGroupsProps {
    readonly open: boolean;
    /** Every close route calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
    /** How many recipes the filters leave, live. Absent while no search has settled. */
    readonly resultCount: number | undefined;
}

/** The Filters button, with its count while filters are active. */
export interface FilterTriggerProps {
    readonly view: FilterBarView;
    readonly onPress: () => void;
}

/** The applied filters as removable chips, then Clear all when two or more apply. */
export interface AppliedFiltersProps {
    readonly view: FilterBarView;
    readonly chipOverflow: ChipRowOverflow;
    readonly onFilterAction: (action: FilterAction) => void;
}
