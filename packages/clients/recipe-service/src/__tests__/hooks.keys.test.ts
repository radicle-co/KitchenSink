/**
 * Query-key contract for `recipeServiceKeys` (T064 / FR-001, FR-002, FR-004, FR-005, FR-011, FR-013).
 *
 * The key factory is a **public contract**, not an implementation detail: consumers invalidate through its
 * prefixes, and the cache's identity/sharing semantics are decided entirely by the emitted arrays. Every
 * expectation here is a **literal** array rather than a re-derivation from `recipeServiceKeys`, so a change
 * to a key fails this file (an assertion written as `expect(keys.recipe('r')).toEqual(keys.recipe('r'))`
 * would mirror the implementation and stay green through any rename).
 *
 * | Requirement | Behavior pinned                                                                   |
 * | ----------- | --------------------------------------------------------------------------------- |
 * | T064        | every factory member emits its documented literal key                              |
 * | T064        | keys are namespaced under `recipe-service`, so `all` invalidates the whole package |
 * | T064        | every recipe key nests under the `recipes` prefix (prefix invalidation works)      |
 * | T064        | every collection key nests under the `collections` prefix                          |
 * | T064        | list/search keys vary by params; detail keys vary by id (no cross-entry collisions) |
 */
import { describe, expect, it } from 'vitest';

import { recipeServiceKeys } from '../hooks.js';

describe('recipeServiceKeys — literal key contract', () => {
    it('roots every key namespace under "recipe-service"', () => {
        expect(recipeServiceKeys.all).toEqual(['recipe-service']);
        expect(recipeServiceKeys.recipes).toEqual(['recipe-service', 'recipes']);
        expect(recipeServiceKeys.collections).toEqual(['recipe-service', 'collections']);
    });

    it('emits the two params-family prefixes mutations invalidate through', () => {
        expect(recipeServiceKeys.recipeLists).toEqual(['recipe-service', 'recipes', 'list']);
        expect(recipeServiceKeys.recipeSearches).toEqual(['recipe-service', 'search', 'recipes']);
    });

    it('keys a recipe list by its list params', () => {
        expect(recipeServiceKeys.recipeList({ page: 2, pageSize: 50, sortBy: 'title' })).toEqual([
            'recipe-service',
            'recipes',
            'list',
            { page: 2, pageSize: 50, sortBy: 'title' },
        ]);
    });

    it('keys an unparameterized recipe list with an empty params object', () => {
        expect(recipeServiceKeys.recipeList()).toEqual(['recipe-service', 'recipes', 'list', {}]);
    });

    it('keys a recipe detail by id', () => {
        expect(recipeServiceKeys.recipe('rec_1')).toEqual(['recipe-service', 'recipes', 'detail', 'rec_1']);
    });

    it("keys a recipe's version list beneath that recipe's detail key", () => {
        expect(recipeServiceKeys.recipeVersions('rec_1')).toEqual([
            'recipe-service',
            'recipes',
            'detail',
            'rec_1',
            'versions',
        ]);
    });

    it('keys a single version snapshot by recipe id and version number', () => {
        expect(recipeServiceKeys.recipeVersion('rec_1', 3)).toEqual([
            'recipe-service',
            'recipes',
            'detail',
            'rec_1',
            'versions',
            3,
        ]);
    });

    it("keys a recipe's photos beneath that recipe's detail key", () => {
        expect(recipeServiceKeys.recipePhotos('rec_1')).toEqual([
            'recipe-service',
            'recipes',
            'detail',
            'rec_1',
            'photos',
        ]);
    });

    it('keys a collection list by its list params', () => {
        expect(recipeServiceKeys.collectionList({ page: 3, pageSize: 10 })).toEqual([
            'recipe-service',
            'collections',
            'list',
            { page: 3, pageSize: 10 },
        ]);
    });

    it('keys an unparameterized collection list with an empty params object', () => {
        expect(recipeServiceKeys.collectionList()).toEqual(['recipe-service', 'collections', 'list', {}]);
    });

    it('keys a collection detail by id', () => {
        expect(recipeServiceKeys.collection('col_1')).toEqual(['recipe-service', 'collections', 'detail', 'col_1']);
    });

    it('keys a recipe search by its full search params', () => {
        expect(recipeServiceKeys.recipeSearch({ query: 'pie', cuisine: 'british' })).toEqual([
            'recipe-service',
            'search',
            'recipes',
            { query: 'pie', cuisine: 'british' },
        ]);
    });

    it('keys an unparameterized recipe search with an empty params object (browse mode)', () => {
        expect(recipeServiceKeys.recipeSearch()).toEqual(['recipe-service', 'search', 'recipes', {}]);
    });

    it('keys an ingredient search by query and limit', () => {
        expect(recipeServiceKeys.ingredientSearch('tom', 5)).toEqual([
            'recipe-service',
            'search',
            'ingredients',
            'tom',
            5,
        ]);
    });

    it('normalizes an absent ingredient-search limit to null, so it stays a stable cache key', () => {
        // `undefined` is not a structurally-stable key segment; the factory pins it to `null` instead.
        expect(recipeServiceKeys.ingredientSearch('tom')).toEqual([
            'recipe-service',
            'search',
            'ingredients',
            'tom',
            null,
        ]);
    });
});

describe('recipeServiceKeys — prefix nesting (what makes prefix invalidation work)', () => {
    it('nests every recipe-entity key under the "recipes" prefix', () => {
        const recipeKeys: readonly (readonly unknown[])[] = [
            recipeServiceKeys.recipeList(),
            recipeServiceKeys.recipeList({ page: 2 }),
            recipeServiceKeys.recipe('rec_1'),
            recipeServiceKeys.recipeVersions('rec_1'),
            recipeServiceKeys.recipeVersion('rec_1', 3),
            recipeServiceKeys.recipePhotos('rec_1'),
        ];

        for (const key of recipeKeys) {
            expect(key.slice(0, 2)).toEqual(['recipe-service', 'recipes']);
        }
    });

    it('nests every collection-entity key under the "collections" prefix', () => {
        const collectionKeys: readonly (readonly unknown[])[] = [
            recipeServiceKeys.collectionList(),
            recipeServiceKeys.collectionList({ page: 3 }),
            recipeServiceKeys.collection('col_1'),
        ];

        for (const key of collectionKeys) {
            expect(key.slice(0, 2)).toEqual(['recipe-service', 'collections']);
        }
    });

    it("nests a recipe's versions and photos under that recipe's detail key, so invalidating the detail catches both", () => {
        const detail = recipeServiceKeys.recipe('rec_1');

        expect(recipeServiceKeys.recipeVersions('rec_1').slice(0, detail.length)).toEqual([...detail]);
        expect(recipeServiceKeys.recipePhotos('rec_1').slice(0, detail.length)).toEqual([...detail]);
        expect(recipeServiceKeys.recipeVersion('rec_1', 3).slice(0, detail.length)).toEqual([...detail]);
    });

    it('places search keys OUTSIDE the recipes/collections prefixes (search is its own namespace)', () => {
        // `recipeSearch` is ['recipe-service','search','recipes',…], NOT under the `recipes` prefix — so
        // invalidating `recipes` can never reach search. This is exactly why every recipe mutation makes a
        // SECOND, explicit `recipeSearches` call; if this nesting ever changes, that pairing is redundant.
        expect(recipeServiceKeys.recipeSearch().slice(0, 2)).toEqual(['recipe-service', 'search']);
        expect(recipeServiceKeys.ingredientSearch('tom').slice(0, 2)).toEqual(['recipe-service', 'search']);
        expect(recipeServiceKeys.recipeSearch().slice(0, 2)).not.toEqual([...recipeServiceKeys.recipes]);
    });

    it('nests every recipe list under the "recipeLists" prefix, whatever its params', () => {
        const prefix = recipeServiceKeys.recipeLists;
        const listKeys: readonly (readonly unknown[])[] = [
            recipeServiceKeys.recipeList(),
            recipeServiceKeys.recipeList({ page: 2 }),
            recipeServiceKeys.recipeList({ page: 7, pageSize: 50, sortBy: 'title' }),
        ];

        for (const key of listKeys) {
            expect(key.slice(0, prefix.length)).toEqual([...prefix]);
        }
    });

    it('nests every recipe search under the "recipeSearches" prefix, whatever its params', () => {
        const prefix = recipeServiceKeys.recipeSearches;
        const searchKeys: readonly (readonly unknown[])[] = [
            recipeServiceKeys.recipeSearch(),
            recipeServiceKeys.recipeSearch({ query: 'pie' }),
            recipeServiceKeys.recipeSearch({ query: 'pie', cuisine: 'british' }),
        ];

        for (const key of searchKeys) {
            expect(key.slice(0, prefix.length)).toEqual([...prefix]);
        }
    });

    it('keeps "recipeSearches" clear of the ingredient typeahead, so a recipe write cannot stale it', () => {
        const prefix = recipeServiceKeys.recipeSearches;

        expect(recipeServiceKeys.ingredientSearch('tom').slice(0, prefix.length)).not.toEqual([...prefix]);
    });

    it('keeps "recipeLists" clear of recipe details, so a list refresh cannot stale an open detail', () => {
        const prefix = recipeServiceKeys.recipeLists;

        expect(recipeServiceKeys.recipe('rec_1').slice(0, prefix.length)).not.toEqual([...prefix]);
        expect(recipeServiceKeys.recipePhotos('rec_1').slice(0, prefix.length)).not.toEqual([...prefix]);
    });
});

describe('recipeServiceKeys — key distinctness (no accidental cache sharing)', () => {
    it('gives two different recipes distinct detail keys', () => {
        expect(recipeServiceKeys.recipe('rec_1')).not.toEqual([...recipeServiceKeys.recipe('rec_2')]);
    });

    it('gives two different list params distinct list keys', () => {
        expect(recipeServiceKeys.recipeList({ page: 1 })).not.toEqual([...recipeServiceKeys.recipeList({ page: 2 })]);
    });

    it('gives two different version numbers of one recipe distinct keys', () => {
        expect(recipeServiceKeys.recipeVersion('rec_1', 1)).not.toEqual([
            ...recipeServiceKeys.recipeVersion('rec_1', 2),
        ]);
    });

    it('gives the same ingredient query at different limits distinct keys', () => {
        expect(recipeServiceKeys.ingredientSearch('tom', 5)).not.toEqual([
            ...recipeServiceKeys.ingredientSearch('tom', 10),
        ]);
    });

    it("does not collide a recipe's versions key with its photos key", () => {
        expect(recipeServiceKeys.recipeVersions('rec_1')).not.toEqual([...recipeServiceKeys.recipePhotos('rec_1')]);
    });
});
