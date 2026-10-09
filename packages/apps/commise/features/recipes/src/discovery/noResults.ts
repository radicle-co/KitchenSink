/**
 * @module @commise/features-recipes/discovery — Discover's no-result and browse-threshold rules
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4 and §4.6).
 *
 * Pure. Which of the three no-result states applies, which tags the "Try one of these" row offers, and whether the
 * browse view has enough cuisines behind it to be worth a row.
 *
 * @pattern Specification — each rule is a pure predicate or projection over what the search returned
 */
import { hasActiveFilters, type RecipeFilterState } from '../filters/model.js';
import { fillTemplate } from '../list/model.js';
import type { DiscoveryMessages } from './messages.js';

/** What a no-result state was caused by. */
export type NoResultKind = 'query' | 'filters' | 'both';

/** One facet bucket: a value and how many recipes hold it. */
interface FacetBucket {
    readonly value: string;
    readonly count: number;
}

/** How many tags "Try one of these" offers, and the fewest it will offer (fewer than this hides the row). */
export const TRY_THESE_TAG_COUNT = 3;

/** The browse view's cuisine row needs this many cuisines, each with at least this many recipes. */
export const CUISINE_SHORTCUT_MIN_CUISINES = 3;
export const CUISINE_SHORTCUT_MIN_RECIPES = 3;

/**
 * Which no-result state applies to a search that found nothing.
 *
 * @param search - The term and the filters the search ran on.
 * @returns `'query'` for a term alone, `'filters'` for filters alone, `'both'` for both, and `undefined` when nothing
 *   narrowed the search (an empty catalogue, which is a different state).
 */
export function noResultKindOf({
    query,
    filters,
}: {
    readonly query: string;
    readonly filters: RecipeFilterState;
}): NoResultKind | undefined {
    const hasQuery = query.trim().length > 0;
    const hasFilters = hasActiveFilters(filters);

    if (hasQuery && hasFilters) {
        return 'both';
    }

    if (hasQuery) {
        return 'query';
    }

    return hasFilters ? 'filters' : undefined;
}

/**
 * The tags "Try one of these" offers: the most-used, most used first, leaving out any already applied.
 *
 * @param tags - The tag facet, or `undefined` when the search returned none.
 * @param applied - The tags already filtered on.
 * @returns Exactly {@link TRY_THESE_TAG_COUNT} tag values, or none when fewer than that remain.
 */
export function tryTheseTagsOf(
    tags: readonly FacetBucket[] | undefined,
    applied: readonly string[],
): readonly string[] {
    const offered = (tags ?? [])
        .filter((tag) => tag.count > 0 && !applied.includes(tag.value))
        .sort((left, right) => right.count - left.count)
        .slice(0, TRY_THESE_TAG_COUNT)
        .map((tag) => tag.value);

    return offered.length < TRY_THESE_TAG_COUNT ? [] : offered;
}

/**
 * Whether the browse view shows its "Browse by cuisine" row: at least three cuisines each hold three or more recipes.
 *
 * @param cuisines - The cuisine facet, or `undefined` when the search returned none.
 * @returns `true` once the row has enough behind it.
 */
export function showsCuisineShortcuts(cuisines: readonly FacetBucket[] | undefined): boolean {
    return (
        (cuisines ?? []).filter((cuisine) => cuisine.count >= CUISINE_SHORTCUT_MIN_RECIPES).length >=
        CUISINE_SHORTCUT_MIN_CUISINES
    );
}

/**
 * The heading of a no-result state, which is also what is announced when a search settles on nothing.
 *
 * @param kind - What narrowed the search, or `undefined` for an empty catalogue.
 * @param query - The term the search ran on.
 * @param copy - The discovery copy.
 * @returns The heading.
 */
export function noResultTitleOf(
    kind: NoResultKind | undefined,
    query: string,
    copy: Pick<DiscoveryMessages, 'noMatchQueryTitle' | 'noMatchTitle' | 'noMatchBothTitle' | 'emptyTitle'>,
): string {
    const term = query.trim();

    switch (kind) {
        case 'query':
            return fillTemplate(copy.noMatchQueryTitle, { query: term });
        case 'filters':
            return copy.noMatchTitle;
        case 'both':
            return fillTemplate(copy.noMatchBothTitle, { query: term });
        case undefined:
            return copy.emptyTitle;
    }
}
