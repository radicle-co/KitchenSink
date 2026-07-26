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
import { makeIngredient } from '@kitchensink/recipe-core/testing';

import {
    EMPTY_RECIPE_FILTERS,
    TOTAL_TIME_BUCKETS_MINUTES,
    addIngredientFilter,
    buildFacetChips,
    clearRecipeFilters,
    countActiveFilters,
    deriveIngredientFilterSearchViewState,
    filtersFromQueryString,
    filtersToQueryString,
    filtersToSearchParams,
    hasActiveFilters,
    removeIngredientFilter,
    setCuisine,
    setMaxCookTime,
    setMaxPrepTime,
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

describe('setMaxPrepTime (S2)', () => {
    it('sets and clears the prep bound', () => {
        expect(setMaxPrepTime(EMPTY_RECIPE_FILTERS, 15).maxPrepTime).toBe(15);
        expect('maxPrepTime' in setMaxPrepTime({ maxPrepTime: 15 }, undefined)).toBe(false);
    });
});

describe('setMaxCookTime (REQ-030f)', () => {
    it('sets and clears the cook bound', () => {
        expect(setMaxCookTime(EMPTY_RECIPE_FILTERS, 15).maxCookTime).toBe(15);
        expect('maxCookTime' in setMaxCookTime({ maxCookTime: 15 }, undefined)).toBe(false);
    });

    it('omits the key entirely when cleared, so it never reaches the wire as undefined', () => {
        const state = setMaxCookTime({ ...EMPTY_RECIPE_FILTERS, maxCookTime: 30 }, undefined);

        expect('maxCookTime' in state).toBe(false);
    });

    it('does not mutate the input state', () => {
        const state: RecipeFilterState = { ...EMPTY_RECIPE_FILTERS, maxCookTime: 15 };
        setMaxCookTime(state, 30);

        expect(state.maxCookTime).toBe(15);
    });
});

describe('setCuisine (S2)', () => {
    it('sets a single cuisine', () => {
        expect(setCuisine(EMPTY_RECIPE_FILTERS, 'Thai').cuisine).toBe('Thai');
    });

    it('toggles off when the same cuisine is set again (single-select with an off state)', () => {
        expect('cuisine' in setCuisine({ cuisine: 'Thai' }, 'Thai')).toBe(false);
    });

    it('replaces the cuisine when a different one is set (single, not multi)', () => {
        expect(setCuisine({ cuisine: 'Thai' }, 'Italian').cuisine).toBe('Italian');
    });

    it('clears with undefined', () => {
        expect('cuisine' in setCuisine({ cuisine: 'Thai' }, undefined)).toBe(false);
    });
});

describe('addIngredientFilter / removeIngredientFilter (FR-006 gap #3)', () => {
    it('adds an ingredient filter', () => {
        const state = addIngredientFilter(EMPTY_RECIPE_FILTERS, { id: 'ing_1', name: 'Chicken' });

        expect(state.ingredients).toEqual([{ id: 'ing_1', name: 'Chicken' }]);
    });

    it('appends a second ingredient alongside the first', () => {
        const state = addIngredientFilter(
            { ingredients: [{ id: 'ing_1', name: 'Chicken' }] },
            { id: 'ing_2', name: 'Garlic' },
        );

        expect(state.ingredients).toEqual([
            { id: 'ing_1', name: 'Chicken' },
            { id: 'ing_2', name: 'Garlic' },
        ]);
    });

    it('is idempotent — re-adding an already-selected id is a no-op (matched by id, not name)', () => {
        const state: RecipeFilterState = { ingredients: [{ id: 'ing_1', name: 'Chicken' }] };
        const next = addIngredientFilter(state, { id: 'ing_1', name: 'Chicken breast' });

        expect(next).toBe(state);
        expect(next.ingredients).toEqual([{ id: 'ing_1', name: 'Chicken' }]);
    });

    it('does not mutate the input state', () => {
        const state: RecipeFilterState = { ingredients: [{ id: 'ing_1', name: 'Chicken' }] };
        addIngredientFilter(state, { id: 'ing_2', name: 'Garlic' });

        expect(state.ingredients).toEqual([{ id: 'ing_1', name: 'Chicken' }]);
    });

    it('removes a selected ingredient by id', () => {
        const state: RecipeFilterState = {
            ingredients: [
                { id: 'ing_1', name: 'Chicken' },
                { id: 'ing_2', name: 'Garlic' },
            ],
        };

        expect(removeIngredientFilter(state, 'ing_1').ingredients).toEqual([{ id: 'ing_2', name: 'Garlic' }]);
    });

    it('omits the ingredients key entirely once the last one is removed', () => {
        const state: RecipeFilterState = { ingredients: [{ id: 'ing_1', name: 'Chicken' }] };

        expect('ingredients' in removeIngredientFilter(state, 'ing_1')).toBe(false);
    });

    it('is a no-op when the id is not selected', () => {
        const state: RecipeFilterState = { ingredients: [{ id: 'ing_1', name: 'Chicken' }] };

        expect(removeIngredientFilter(state, 'ing_missing')).toBe(state);
    });

    it('does not mutate the input state', () => {
        const state: RecipeFilterState = {
            ingredients: [
                { id: 'ing_1', name: 'Chicken' },
                { id: 'ing_2', name: 'Garlic' },
            ],
        };
        removeIngredientFilter(state, 'ing_1');

        expect(state.ingredients).toHaveLength(2);
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

    it('counts each selected ingredient as one (FR-006 gap #3)', () => {
        const state: RecipeFilterState = {
            ingredients: [
                { id: 'ing_1', name: 'Chicken' },
                { id: 'ing_2', name: 'Garlic' },
            ],
        };

        expect(countActiveFilters(state)).toBe(2);
        expect(hasActiveFilters(state)).toBe(true);
    });

    it('counts cuisine + prep + total each as one (S2)', () => {
        expect(countActiveFilters({ cuisine: 'Thai', maxPrepTime: 15, maxTotalTime: 30 })).toBe(3);
    });

    it('counts a cook-time bound as one (REQ-030f)', () => {
        expect(countActiveFilters({ maxCookTime: 20 })).toBe(1);
        expect(countActiveFilters({ cuisine: 'Thai', maxPrepTime: 15, maxCookTime: 20, maxTotalTime: 30 })).toBe(4);
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

    it('forwards cuisine + prep bound (S2)', () => {
        expect(filtersToSearchParams({ cuisine: 'Thai', maxPrepTime: 15 }, '')).toEqual({
            cuisine: 'Thai',
            maxPrepTime: 15,
        });
    });

    it('forwards a cook-time bound (REQ-030f)', () => {
        expect(filtersToSearchParams({ maxCookTime: 20 }, '')).toEqual({ maxCookTime: 20 });
    });

    it('forwards ingredient ids only — never the display names (FR-006 gap #3)', () => {
        const state: RecipeFilterState = {
            ingredients: [
                { id: 'ing_1', name: 'Chicken' },
                { id: 'ing_2', name: 'Garlic' },
            ],
        };

        expect(filtersToSearchParams(state, '')).toEqual({ ingredientIds: ['ing_1', 'ing_2'] });
    });

    it('omits ingredientIds when no ingredient is selected', () => {
        expect(filtersToSearchParams(EMPTY_RECIPE_FILTERS, '')).not.toHaveProperty('ingredientIds');
    });
});

describe('filtersToQueryString / filtersFromQueryString', () => {
    it('round-trips a fully-populated state', () => {
        const state: RecipeFilterState = { dietaryFlags: ['vegan', 'keto'], tags: ['quick'], maxTotalTime: 30 };
        const parsed = filtersFromQueryString(filtersToQueryString(state, 'lamb'));

        expect(parsed).toEqual({ filters: state, query: 'lamb' });
    });

    it('round-trips cuisine + prep + total (S2)', () => {
        const state: RecipeFilterState = { cuisine: 'Thai', maxPrepTime: 15, maxTotalTime: 60 };
        const parsed = filtersFromQueryString(filtersToQueryString(state, ''));

        expect(parsed).toEqual({ filters: state, query: '' });
    });

    it('round-trips a cook-time bound (REQ-030f)', () => {
        const state: RecipeFilterState = { maxCookTime: 30 };
        const parsed = filtersFromQueryString(filtersToQueryString(state, ''));

        expect(parsed).toEqual({ filters: state, query: '' });
    });

    it('rejects an off-ladder prep bound from a hand-edited URL (S2)', () => {
        expect(filtersFromQueryString('maxPrepTime=17').filters).toEqual(EMPTY_RECIPE_FILTERS);
    });

    it('rejects an off-ladder cook bound from a hand-edited URL (REQ-030f)', () => {
        expect(filtersFromQueryString('maxCookTime=17').filters).toEqual(EMPTY_RECIPE_FILTERS);
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

    it('round-trips ingredient filters — id AND display name (FR-006 gap #3)', () => {
        const state: RecipeFilterState = {
            ingredients: [
                { id: 'ing_1', name: 'Chicken' },
                { id: 'ing_2', name: 'Garlic' },
            ],
        };
        const parsed = filtersFromQueryString(filtersToQueryString(state, 'stir fry'));

        expect(parsed).toEqual({ filters: state, query: 'stir fry' });
    });

    it('emits paired repeated params for ingredients (the id/name are positionally paired)', () => {
        const qs = filtersToQueryString({ ingredients: [{ id: 'ing_1', name: 'Chicken' }] }, '');

        expect(qs).toBe('ingredientId=ing_1&ingredientName=Chicken');
    });

    it('percent-encodes ingredient names', () => {
        const qs = filtersToQueryString({ ingredients: [{ id: 'ing_1', name: 'Salt & pepper' }] }, '');

        expect(qs).toBe('ingredientId=ing_1&ingredientName=Salt+%26+pepper');
        expect(filtersFromQueryString(qs).filters.ingredients).toEqual([{ id: 'ing_1', name: 'Salt & pepper' }]);
    });

    it('omits the ingredients key when none is selected, so the empty state stays canonical', () => {
        expect('ingredients' in filtersFromQueryString('').filters).toBe(false);
    });

    it('drops an ingredientId with no paired ingredientName from a hand-edited URL', () => {
        expect(filtersFromQueryString('ingredientId=ing_1').filters).toEqual(EMPTY_RECIPE_FILTERS);
    });

    it('drops a blank ingredientId/ingredientName pair from a hand-edited URL', () => {
        const parsed = filtersFromQueryString('ingredientId=&ingredientName=&ingredientId=ing_2&ingredientName=Garlic');

        expect(parsed.filters.ingredients).toEqual([{ id: 'ing_2', name: 'Garlic' }]);
    });

    it('dedupes a repeated ingredientId from a hand-edited URL, keeping the first occurrence', () => {
        const parsed = filtersFromQueryString(
            'ingredientId=ing_1&ingredientName=Chicken&ingredientId=ing_1&ingredientName=Chicken+thigh',
        );

        expect(parsed.filters.ingredients).toEqual([{ id: 'ing_1', name: 'Chicken' }]);
    });
});

describe('deriveIngredientFilterSearchViewState (FR-006 gap #3)', () => {
    const chicken = makeIngredient({ id: 'ing_1', name: 'Chicken' });

    it('is idle below the search threshold', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'c',
                debouncedTrimmed: 'c',
                results: [],
                isLoading: false,
                isError: false,
            }),
        ).toEqual({ kind: 'idle' });
    });

    it('is idle for a blank query', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: '',
                debouncedTrimmed: '',
                results: [],
                isLoading: false,
                isError: false,
            }),
        ).toEqual({ kind: 'idle' });
    });

    it('is searching while the fetch is in flight', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'chic',
                debouncedTrimmed: 'chic',
                results: [],
                isLoading: true,
                isError: false,
            }),
        ).toEqual({ kind: 'searching' });
    });

    it('is searching while the debounced query has not caught up to the typed query yet', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'chic',
                debouncedTrimmed: 'ch',
                results: [],
                isLoading: false,
                isError: false,
            }),
        ).toEqual({ kind: 'searching' });
    });

    it('reports settled results', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'chic',
                debouncedTrimmed: 'chic',
                results: [chicken],
                isLoading: false,
                isError: false,
            }),
        ).toEqual({ kind: 'results', results: [chicken], isError: false });
    });

    it('reports an empty settled result set (no matches)', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'zzz',
                debouncedTrimmed: 'zzz',
                results: [],
                isLoading: false,
                isError: false,
            }),
        ).toEqual({ kind: 'results', results: [], isError: false });
    });

    it('reports a settled search error', () => {
        expect(
            deriveIngredientFilterSearchViewState({
                trimmed: 'chic',
                debouncedTrimmed: 'chic',
                results: [],
                isLoading: false,
                isError: true,
            }),
        ).toEqual({ kind: 'results', results: [], isError: true });
    });
});
