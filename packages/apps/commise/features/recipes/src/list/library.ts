/**
 * @module @commise/features-recipes/list — what My recipes shows, decided once for both platforms
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3).
 *
 * The library list endpoint takes no filter, so the search and the chips narrow the library on the device. That is
 * correct only over the WHOLE library, which is why the containers read it with the library read (chunks of up to 500,
 * `@kitchensink/recipe-service-client`'s `library`) rather than one page of 20: a chip's count, the chips on offer and
 * "No recipes match these filters" were wrong past the first page (`docs/architecture/uiOverhaulBlueprint.md` A11).
 *
 * The sort is the server's (`sortBy`), so it is correct across pages; the narrowing here keeps its order.
 *
 * Pure.
 *
 * @pattern Specification — `matchesListFacet` composed over the active facets, and the search term, as one predicate
 * @pattern Policy — `libraryStateOf` owns which body the results draw
 */
import type { RecipeListSortBy } from '@kitchensink/recipe-service-client';

import type { RecipeListMessages } from '../messages.js';
import { QUICK_TIME_FACET, filterChipLabel, isQuickRecipe, matchesListFacet, type RecipeFacetSource } from './model.js';

/** What the library narrowing reads of a recipe. */
export interface LibraryRecipe extends RecipeFacetSource {
    readonly title: string;
}

/** One chip of the library's facets. */
export interface LibraryFacet {
    /** The facet value (a cuisine, a dietary flag, or {@link QUICK_TIME_FACET}). */
    readonly value: string;
    /** What the chip says. User data is its own label; the quick bucket is localized. */
    readonly label: string;
    /** How many recipes the chip would leave, beside the search and the other chips. */
    readonly count: number;
    readonly selected: boolean;
}

/** Which body the results draw. */
export type LibraryState = 'firstRun' | 'results' | 'noMatchQuery' | 'noMatchFilters' | 'noMatchBoth';

/** The sort keys the list endpoint accepts, in the order the sort menu offers them; the first is its default. */
export const LIBRARY_SORTS: readonly RecipeListSortBy[] = ['updatedAt', 'createdAt', 'title'];

/**
 * The facets a library offers: the quick bucket when any recipe qualifies (first, a fixed dimension), then every
 * dietary flag and cuisine present, sorted. Derived from the whole library, so a chip never vanishes when its own filter
 * empties the rows.
 *
 * @param recipes - The whole loaded library.
 * @returns The facet values.
 */
export function availableFacetsOf(recipes: readonly RecipeFacetSource[]): readonly string[] {
    const facets = new Set<string>();
    let hasQuickRecipe = false;

    for (const recipe of recipes) {
        recipe.dietaryFlags.forEach((flag) => facets.add(flag));

        if (recipe.cuisine !== undefined) {
            facets.add(recipe.cuisine);
        }

        if (isQuickRecipe(recipe.totalTimeMinutes)) {
            hasQuickRecipe = true;
        }
    }

    const sorted = [...facets].sort((a, b) => a.localeCompare(b));

    return hasQuickRecipe ? [QUICK_TIME_FACET, ...sorted] : sorted;
}

/**
 * Whether a recipe's title holds the search term.
 *
 * @param recipe - The recipe.
 * @param term - The trimmed, lower-cased term.
 * @returns `true` when there is no term or the title holds it.
 */
function matchesTerm(recipe: LibraryRecipe, term: string): boolean {
    return term.length === 0 || recipe.title.toLowerCase().includes(term);
}

/**
 * The recipes the search term and every active facet leave, in the library's order.
 *
 * @param recipes - The whole loaded library.
 * @param searchValue - The raw search-field value.
 * @param activeFacets - The pressed chips; a recipe must satisfy every one.
 * @returns The visible recipes.
 */
export function narrowLibrary<T extends LibraryRecipe>(
    recipes: readonly T[],
    searchValue: string,
    activeFacets: readonly string[],
): readonly T[] {
    const term = searchValue.trim().toLowerCase();

    return recipes.filter(
        (recipe) => matchesTerm(recipe, term) && activeFacets.every((facet) => matchesListFacet(recipe, facet)),
    );
}

/**
 * The chips, each with the number of recipes it would leave: the search term, the OTHER active chips and this one.
 * For a pressed chip that is the number on screen.
 *
 * @param recipes - The whole loaded library.
 * @param searchValue - The raw search-field value.
 * @param activeFacets - The pressed chips.
 * @param quickLabel - The localized label of the quick bucket.
 * @returns One facet per chip, in the order {@link availableFacetsOf} gives.
 */
export function libraryFacetsOf(
    recipes: readonly LibraryRecipe[],
    searchValue: string,
    activeFacets: readonly string[],
    quickLabel: string,
): readonly LibraryFacet[] {
    const term = searchValue.trim().toLowerCase();
    const searched = recipes.filter((recipe) => matchesTerm(recipe, term));

    return availableFacetsOf(recipes).map((value) => {
        const others = activeFacets.filter((facet) => facet !== value);
        const count = searched.filter(
            (recipe) => matchesListFacet(recipe, value) && others.every((facet) => matchesListFacet(recipe, facet)),
        ).length;

        return { value, label: filterChipLabel(value, quickLabel), count, selected: activeFacets.includes(value) };
    });
}

/** What {@link libraryStateOf} decides from. */
export interface LibraryStateInput {
    /** How many recipes the narrowing leaves. */
    readonly visibleCount: number;
    readonly searchValue: string;
    readonly activeFacets: readonly string[];
}

/**
 * Which body the results draw (§4.3 states). Zero rows while narrowing is a no-match, named by what narrowed it, so the
 * cook gets the matching "Clear" action; zero rows with nothing narrowing is the first run.
 *
 * @param input - The counts and the narrowing.
 * @returns The state.
 */
export function libraryStateOf({ visibleCount, searchValue, activeFacets }: LibraryStateInput): LibraryState {
    if (visibleCount > 0) {
        return 'results';
    }

    const searched = searchValue.trim().length > 0;
    const filtered = activeFacets.length > 0;

    if (searched && filtered) {
        return 'noMatchBoth';
    }

    if (searched) {
        return 'noMatchQuery';
    }

    return filtered ? 'noMatchFilters' : 'firstRun';
}

/**
 * The visible name of a sort key.
 *
 * @param sort - The key.
 * @param list - The list copy.
 * @returns Its name.
 */
export function sortLabelOf(
    sort: RecipeListSortBy,
    list: Pick<RecipeListMessages, 'sortRecent' | 'sortNewest' | 'sortTitle'>,
): string {
    switch (sort) {
        case 'updatedAt':
            return list.sortRecent;
        case 'createdAt':
            return list.sortNewest;
        case 'title':
            return list.sortTitle;
    }
}
