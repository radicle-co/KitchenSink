/**
 * The library's narrowing, facets and states (`docs/design/uiOverhaul/buildSpec.md` §4.3,
 * `docs/architecture/uiOverhaulBlueprint.md` A11), which both platforms' containers share. These are computed over the
 * WHOLE loaded library — never one server page — which is the fix for the defect A11 recorded: chips, counts and "No
 * recipes match these filters" used to be wrong past the first 20 recipes.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import {
    LIBRARY_SORTS,
    availableFacetsOf,
    libraryFacetsOf,
    libraryStateOf,
    narrowLibrary,
    sortLabelOf,
} from '../library.js';
import { QUICK_TIME_FACET } from '../model.js';

const list = recipeMessages.en.list;

const library = [
    makeRecipe({
        id: 'a',
        title: 'Lamb Tagine',
        cuisine: 'Moroccan',
        dietaryFlags: ['gluten-free'],
        totalTimeMinutes: 200,
    }),
    makeRecipe({ id: 'b', title: 'Lemon Pasta', cuisine: 'Italian', dietaryFlags: [], totalTimeMinutes: 20 }),
    makeRecipe({
        id: 'c',
        title: 'Lamb Kofta',
        cuisine: 'Moroccan',
        dietaryFlags: ['dairy-free'],
        totalTimeMinutes: 25,
    }),
    makeRecipe({
        id: 'd',
        title: 'Green Salad',
        cuisine: undefined,
        dietaryFlags: ['gluten-free', 'dairy-free'],
        totalTimeMinutes: 10,
        visibility: RecipeVisibility.PRIVATE,
    }),
];

describe('availableFacetsOf', () => {
    it('leads with the quick bucket, then every cuisine and dietary flag in the library, sorted', () => {
        expect(availableFacetsOf(library)).toEqual([
            QUICK_TIME_FACET,
            'dairy-free',
            'gluten-free',
            'Italian',
            'Moroccan',
        ]);
    });

    it('offers no quick bucket when no recipe is under 30 minutes', () => {
        expect(availableFacetsOf([library[0]!])).toEqual(['gluten-free', 'Moroccan']);
    });

    it('offers nothing for an empty library', () => {
        expect(availableFacetsOf([])).toEqual([]);
    });
});

describe('narrowLibrary', () => {
    it('matches the title case-insensitively, trimming the term', () => {
        expect(narrowLibrary(library, '  LAMB ', []).map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('requires every active facet', () => {
        expect(narrowLibrary(library, '', ['Moroccan', QUICK_TIME_FACET]).map((r) => r.id)).toEqual(['c']);
    });

    it('keeps the library’s own order', () => {
        expect(narrowLibrary(library, '', []).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    });
});

describe('libraryFacetsOf — counts over the whole library', () => {
    it('counts each facet as the rows it would leave, beside the search and the other chips', () => {
        const facets = libraryFacetsOf(library, '', ['Moroccan'], list.filterQuick);

        expect(facets).toEqual([
            { value: QUICK_TIME_FACET, label: 'Under 30 min', count: 1, selected: false },
            { value: 'dairy-free', label: 'dairy-free', count: 1, selected: false },
            { value: 'gluten-free', label: 'gluten-free', count: 1, selected: false },
            { value: 'Italian', label: 'Italian', count: 0, selected: false },
            { value: 'Moroccan', label: 'Moroccan', count: 2, selected: true },
        ]);
    });

    it('narrows the counts by the search term too', () => {
        const facets = libraryFacetsOf(library, 'salad', [], list.filterQuick);

        expect(facets.find((facet) => facet.value === 'gluten-free')?.count).toBe(1);
        expect(facets.find((facet) => facet.value === 'Moroccan')?.count).toBe(0);
    });

    // A11's defect, as a test: with only the first page loaded, a chip's count was the count of ONE page. Fed the whole
    // library, a facet held by recipes 21 and later still counts them.
    it('counts a facet held only past the first twenty recipes', () => {
        const big = [
            ...Array.from({ length: 20 }, (_unused, index) => makeRecipe({ id: `p${index}`, cuisine: 'Thai' })),
            makeRecipe({ id: 'late1', cuisine: 'Peruvian' }),
            makeRecipe({ id: 'late2', cuisine: 'Peruvian' }),
        ];

        expect(libraryFacetsOf(big, '', [], list.filterQuick).find((f) => f.value === 'Peruvian')?.count).toBe(2);
    });
});

describe('libraryStateOf', () => {
    it.each<[string, Parameters<typeof libraryStateOf>[0], ReturnType<typeof libraryStateOf>]>([
        [
            'an empty library, not narrowed, is the first run',
            { visibleCount: 0, searchValue: '', activeFacets: [] },
            'firstRun',
        ],
        ['rows on screen are results', { visibleCount: 2, searchValue: 'l', activeFacets: [] }, 'results'],
        ['zero rows from a search alone', { visibleCount: 0, searchValue: 'zzz', activeFacets: [] }, 'noMatchQuery'],
        ['zero rows from chips alone', { visibleCount: 0, searchValue: ' ', activeFacets: ['x'] }, 'noMatchFilters'],
        ['zero rows from both', { visibleCount: 0, searchValue: 'z', activeFacets: ['x'] }, 'noMatchBoth'],
        // A search typed into an empty library is still a no-match, so the cook can clear it.
        [
            'an empty library with a search is a no-match',
            { visibleCount: 0, searchValue: 'z', activeFacets: [] },
            'noMatchQuery',
        ],
    ])('%s', (_case, input, state) => {
        expect(libraryStateOf(input)).toBe(state);
    });
});

describe('the library sort', () => {
    it('offers the three keys the list endpoint accepts, recently edited first (its default)', () => {
        expect(LIBRARY_SORTS).toEqual(['updatedAt', 'createdAt', 'title']);
    });

    it.each<[(typeof LIBRARY_SORTS)[number], string]>([
        ['updatedAt', 'Recently edited'],
        ['createdAt', 'Newest'],
        ['title', 'A–Z'],
    ])('names %s “%s”', (sort, label) => {
        expect(sortLabelOf(sort, list)).toBe(label);
    });
});
