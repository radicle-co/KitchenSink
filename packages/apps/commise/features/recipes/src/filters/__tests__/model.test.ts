/**
 * Unit tests for the pure, platform-agnostic recipe-filter model (FR-006). This module is the SINGLE
 * source of filter-state truth shared by the web and native bars and by both apps' persistence edges
 * (web = URL query params, mobile = component state), so these tests pin the semantics both platforms
 * inherit: facet-chip construction (including the selected-but-absent case), AND-narrowing toggles, the
 * active-filter count, clear-all, and round-tripping through a query string.
 *
 * Every assertion is written to FAIL if the logic is subtly wrong (mutation lens): toggles assert
 * immutability of the input, chip construction asserts ordering and the zero-count/absent branches, and
 * the query-string round-trip asserts the exact wire keys the service's `SearchRecipesQueryDto` accepts.
 */
import { describe, expect, it } from 'vitest';
import type { RecipeFacetCount } from '@kitchensink/recipe-core';

import {
    EMPTY_RECIPE_FILTERS,
    TOTAL_TIME_BUCKETS_MINUTES,
    buildFacetChips,
    clearRecipeFilters,
    countActiveFilters,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    hasActiveFilters,
    setMaxTotalTime,
    toggleFacetValue,
} from '../model.js';
import type { RecipeFilterState } from '../model.js';

const bucket = (value: string, count: number): RecipeFacetCount => ({ value, count });

describe('buildFacetChips', () => {
    it('preserves the server ordering and marks selection', () => {
        const chips = buildFacetChips([bucket('vegan', 4), bucket('gluten-free', 2)], ['gluten-free']);

        expect(chips).toEqual([
            { value: 'vegan', count: 4, selected: false },
            { value: 'gluten-free', count: 2, selected: true },
        ]);
    });

    it('hides an unselected zero-count bucket (never offer a filter that returns nothing)', () => {
        const chips = buildFacetChips([bucket('vegan', 3), bucket('keto', 0)], []);

        expect(chips.map((chip) => chip.value)).toEqual(['vegan']);
    });

    it('keeps a selected bucket even when its count is zero, so it stays un-selectable', () => {
        const chips = buildFacetChips([bucket('keto', 0)], ['keto']);

        expect(chips).toEqual([{ value: 'keto', count: 0, selected: true }]);
    });

    it('appends a selected value that the facet response omits, with no count', () => {
        // The server samples only the top FACET_SAMPLE_SIZE matches, so an active filter's value can be
        // absent from `facets`. It MUST still render, or the user cannot clear the filter they applied.
        const chips = buildFacetChips([bucket('vegan', 4)], ['paleo']);

        expect(chips).toEqual([
            { value: 'vegan', count: 4, selected: false },
            { value: 'paleo', selected: true },
        ]);
    });

    it('renders selected values when the facet dimension is absent entirely', () => {
        const chips = buildFacetChips(undefined, ['vegan']);

        expect(chips).toEqual([{ value: 'vegan', selected: true }]);
    });

    it('returns no chips when the dimension is absent and nothing is selected', () => {
        expect(buildFacetChips(undefined, [])).toEqual([]);
    });

    it('does not duplicate a selected value that is present in the buckets', () => {
        const chips = buildFacetChips([bucket('vegan', 4)], ['vegan']);

        expect(chips).toEqual([{ value: 'vegan', count: 4, selected: true }]);
    });
});

describe('toggleFacetValue', () => {
    it('adds an unselected value', () => {
        expect(toggleFacetValue(EMPTY_RECIPE_FILTERS, 'dietaryFlags', 'vegan').dietaryFlags).toEqual(['vegan']);
    });

    it('removes an already-selected value', () => {
        const state: RecipeFilterState = { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan', 'keto'] };

        expect(toggleFacetValue(state, 'dietaryFlags', 'vegan').dietaryFlags).toEqual(['keto']);
    });

    it('toggles tags independently of dietary flags', () => {
        const state = toggleFacetValue({ ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] }, 'tags', 'quick');

        expect(state).toEqual({ dietaryFlags: ['vegan'], tags: ['quick'] });
    });

    it('does not mutate the input state', () => {
        const state: RecipeFilterState = { ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan'] };
        toggleFacetValue(state, 'dietaryFlags', 'keto');

        expect(state.dietaryFlags).toEqual(['vegan']);
    });
});

describe('setMaxTotalTime', () => {
    it('sets the bound', () => {
        expect(setMaxTotalTime(EMPTY_RECIPE_FILTERS, 30).maxTotalTime).toBe(30);
    });

    it('omits the key entirely when cleared, so it never reaches the wire as undefined', () => {
        const state = setMaxTotalTime({ ...EMPTY_RECIPE_FILTERS, maxTotalTime: 30 }, undefined);

        expect('maxTotalTime' in state).toBe(false);
    });

    it('exposes the documented bucket ladder', () => {
        expect(TOTAL_TIME_BUCKETS_MINUTES).toEqual([15, 30, 60]);
    });
});

describe('countActiveFilters / hasActiveFilters', () => {
    it('counts nothing for the empty state', () => {
        expect(countActiveFilters(EMPTY_RECIPE_FILTERS)).toBe(0);
        expect(hasActiveFilters(EMPTY_RECIPE_FILTERS)).toBe(false);
    });

    it('counts each selected value across every dimension, plus the time bound as one', () => {
        const state: RecipeFilterState = { dietaryFlags: ['vegan', 'keto'], tags: ['quick'], maxTotalTime: 30 };

        expect(countActiveFilters(state)).toBe(4);
        expect(hasActiveFilters(state)).toBe(true);
    });

    it('treats a time bound alone as active', () => {
        expect(hasActiveFilters({ ...EMPTY_RECIPE_FILTERS, maxTotalTime: 15 })).toBe(true);
    });
});

describe('clearRecipeFilters', () => {
    it('returns the empty state', () => {
        expect(clearRecipeFilters()).toEqual(EMPTY_RECIPE_FILTERS);
        expect(hasActiveFilters(clearRecipeFilters())).toBe(false);
    });
});

describe('filtersToSearchParams', () => {
    it('omits every empty dimension so the request stays a pure subset', () => {
        expect(filtersToSearchParams(EMPTY_RECIPE_FILTERS, '')).toEqual({});
    });

    it('includes a trimmed query only when non-blank', () => {
        expect(filtersToSearchParams(EMPTY_RECIPE_FILTERS, '  risotto  ')).toEqual({ query: 'risotto' });
        expect(filtersToSearchParams(EMPTY_RECIPE_FILTERS, '   ')).toEqual({});
    });

    it('forwards every active dimension', () => {
        const state: RecipeFilterState = { dietaryFlags: ['vegan'], tags: ['quick'], maxTotalTime: 30 };

        expect(filtersToSearchParams(state, 'lamb')).toEqual({
            query: 'lamb',
            dietaryFlags: ['vegan'],
            tags: ['quick'],
            maxTotalTime: 30,
        });
    });
});

describe('filtersToQueryString / filtersFromQueryString', () => {
    it('round-trips a fully-populated state', () => {
        const state: RecipeFilterState = { dietaryFlags: ['vegan', 'keto'], tags: ['quick'], maxTotalTime: 30 };
        const parsed = filtersFromQueryString(filtersToQueryString(state, 'lamb'));

        expect(parsed).toEqual({ filters: state, query: 'lamb' });
    });

    it('round-trips the empty state to an empty query string', () => {
        expect(filtersToQueryString(EMPTY_RECIPE_FILTERS, '')).toBe('');
        expect(filtersFromQueryString('')).toEqual({ filters: EMPTY_RECIPE_FILTERS, query: '' });
    });

    it('emits repeated params for array dimensions (the shape the service DTO accepts)', () => {
        const qs = filtersToQueryString({ ...EMPTY_RECIPE_FILTERS, dietaryFlags: ['vegan', 'keto'] }, '');

        expect(qs).toBe('dietaryFlags=vegan&dietaryFlags=keto');
    });

    it('percent-encodes values rather than hand-rolling the query string', () => {
        const qs = filtersToQueryString({ ...EMPTY_RECIPE_FILTERS, tags: ['30 minute & under'] }, '');

        expect(qs).toBe('tags=30+minute+%26+under');
        expect(filtersFromQueryString(qs).filters.tags).toEqual(['30 minute & under']);
    });

    it('ignores a non-numeric maxTotalTime instead of forwarding NaN', () => {
        expect(filtersFromQueryString('maxTotalTime=soon').filters).toEqual(EMPTY_RECIPE_FILTERS);
    });

    it('ignores a maxTotalTime outside the bucket ladder (a hand-edited URL cannot inject arbitrary bounds)', () => {
        expect(filtersFromQueryString('maxTotalTime=999').filters).toEqual(EMPTY_RECIPE_FILTERS);
    });

    it('drops blank array entries from a hand-edited URL', () => {
        expect(filtersFromQueryString('tags=&tags=quick').filters.tags).toEqual(['quick']);
    });
});
