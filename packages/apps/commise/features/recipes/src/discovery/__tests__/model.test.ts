/**
 * Unit tests for the discovery model's pure rules — the one place both platforms' discovery containers and leaves
 * learn what a search's key is, whether the viewer is searching or browsing, what a rail reads, and what the results
 * header says. Each rule is asserted from both directions, so a rule that answers the same for every input fails.
 */
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { makeRecipe } from '@kitchensink/recipe-core/testing';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { hashKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { EMPTY_RECIPE_FILTERS } from '../../filters/model.js';
import { discoveryMessages } from '../messages.js';
import {
    RECIPE_BROWSE_RAILS,
    RECIPE_BROWSE_RAIL_PAGE_SIZE,
    DISCOVERY_SORTS,
    browseRailSearchParams,
    discoverySearchParams,
    discoverySortLabel,
    formatDiscoveryResultsSummary,
    isDiscoveryBrowsing,
    isDiscoverySearching,
    recipeIdPagesOf,
    type RecipeDiscoveryCriteria,
} from '../model.js';

const messages = discoveryMessages.en;

/** Criteria with nothing narrowed and browse not dismissed — the default state of Discover. */
function criteria(overrides: Partial<RecipeDiscoveryCriteria> = {}): RecipeDiscoveryCriteria {
    return {
        filters: EMPTY_RECIPE_FILTERS,
        query: '',
        sortBy: RecipeSearchSortBy.RELEVANCE,
        browseDismissed: false,
        ...overrides,
    };
}

/** A fetched search page holding one hit per id, in order. */
function page(...ids: readonly string[]): {
    readonly results: readonly { readonly recipe: ReturnType<typeof makeRecipe> }[];
} {
    return { results: ids.map((id) => ({ recipe: makeRecipe({ id }) })) };
}

describe('recipeIdPagesOf', () => {
    it('projects each fetched page onto its recipe ids, keeping page boundaries and order', () => {
        expect(recipeIdPagesOf([page('r1', 'r2'), page('r3')])).toEqual([['r1', 'r2'], ['r3']]);
    });

    it('keeps an EMPTY page as an empty page rather than dropping it, and keeps an id a later page repeats', () => {
        // The nutrition hook skips an empty page and lets the first page win a repeated id; neither is this
        // projection's decision to make, so it must hand both through untouched.
        expect(recipeIdPagesOf([page('r1'), page(), page('r1', 'r2')])).toEqual([['r1'], [], ['r1', 'r2']]);
    });

    it('answers no pages for no pages', () => {
        expect(recipeIdPagesOf([])).toEqual([]);
    });
});

describe('discoverySearchParams', () => {
    it('sends the sort with no query and no filter dimension when nothing is narrowed', () => {
        expect(discoverySearchParams(criteria())).toEqual({ sortBy: RecipeSearchSortBy.RELEVANCE });
    });

    it('sends the trimmed query, every active filter and the sort', () => {
        expect(
            discoverySearchParams(
                criteria({
                    filters: { tags: ['quick'], cuisine: 'Thai' },
                    query: '  pad thai ',
                    sortBy: RecipeSearchSortBy.QUICKEST,
                }),
            ),
        ).toEqual({ query: 'pad thai', tags: ['quick'], cuisine: 'Thai', sortBy: RecipeSearchSortBy.QUICKEST });
    });

    it('ignores whether browse was dismissed — leaving browse changes what renders, not what is fetched', () => {
        expect(discoverySearchParams(criteria({ browseDismissed: true }))).toEqual(
            discoverySearchParams(criteria({ browseDismissed: false })),
        );
    });
});

describe('isDiscoverySearching', () => {
    it('is false with a blank (or whitespace) query and no filter', () => {
        expect(isDiscoverySearching(criteria())).toBe(false);
        expect(isDiscoverySearching(criteria({ query: '   ' }))).toBe(false);
    });

    it('is true for a typed query alone', () => {
        expect(isDiscoverySearching(criteria({ query: 'lamb' }))).toBe(true);
    });

    it('is true for an active filter alone, with a blank query', () => {
        expect(isDiscoverySearching(criteria({ filters: { dietaryFlags: ['vegan'] } }))).toBe(true);
    });
});

describe('isDiscoveryBrowsing', () => {
    it('browses by default: nothing searched and browse not dismissed', () => {
        expect(isDiscoveryBrowsing(criteria())).toBe(true);
    });

    it('stops browsing once a rail’s "see all" dismissed browse', () => {
        expect(isDiscoveryBrowsing(criteria({ browseDismissed: true }))).toBe(false);
    });

    it('stops browsing while a query or a filter is active', () => {
        expect(isDiscoveryBrowsing(criteria({ query: 'lamb' }))).toBe(false);
        expect(isDiscoveryBrowsing(criteria({ filters: { tags: ['quick'] } }))).toBe(false);
    });
});

describe('browseRailSearchParams', () => {
    it('reads each rail at its own sort, capped to the teaser page', () => {
        expect(RECIPE_BROWSE_RAILS.map(browseRailSearchParams)).toEqual([
            { sortBy: RecipeSearchSortBy.MOST_CLONED, pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE },
            { sortBy: RecipeSearchSortBy.RECENT, pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE },
            { sortBy: RecipeSearchSortBy.QUICKEST, pageSize: RECIPE_BROWSE_RAIL_PAGE_SIZE },
        ]);
    });

    it('gives every rail its own cache key, none of them the main search’s', () => {
        const queries = recipeQueries(createFakeRecipeServiceClient());
        const railKeys = RECIPE_BROWSE_RAILS.map((rail) =>
            hashKey(queries.searchInfinite(browseRailSearchParams(rail)).queryKey),
        );
        const mainKey = hashKey(queries.searchInfinite(discoverySearchParams(criteria())).queryKey);

        expect(new Set(railKeys).size).toBe(RECIPE_BROWSE_RAILS.length);
        expect(railKeys).not.toContain(mainKey);
    });
});

describe('formatDiscoveryResultsSummary', () => {
    it('counts the results alone when no query is typed', () => {
        expect(formatDiscoveryResultsSummary({ count: 3, query: '', searching: false }, messages, 'en')).toBe(
            '3 recipes',
        );
        expect(formatDiscoveryResultsSummary({ count: 1, query: '', searching: true }, messages, 'en')).toBe(
            '1 recipe',
        );
    });

    it('names the (trimmed) query the results belong to', () => {
        expect(formatDiscoveryResultsSummary({ count: 12, query: ' past ', searching: true }, messages, 'en')).toBe(
            'Showing 12 recipes for “past”',
        );
    });

    it('says nothing matched when a search or filter found nothing', () => {
        expect(formatDiscoveryResultsSummary({ count: 0, query: 'tiramisu', searching: true }, messages, 'en')).toBe(
            'No matching recipes',
        );
    });

    it('says there are no recipes, not that nothing matched, when nothing was searched', () => {
        expect(formatDiscoveryResultsSummary({ count: 0, query: '', searching: false }, messages, 'en')).toBe(
            'No recipes found',
        );
    });
});

describe('discoverySortLabel', () => {
    it('labels every offered sort with its own copy, in display order', () => {
        expect(DISCOVERY_SORTS.map((sort) => discoverySortLabel(sort, messages))).toEqual([
            'Relevance',
            'Newest',
            'Most cloned',
            'Quickest',
        ]);
    });
});
