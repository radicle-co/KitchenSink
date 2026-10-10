/**
 * The library read (`docs/architecture/uiOverhaulBlueprint.md` A11): My recipes filters, counts and searches the cook's
 * WHOLE library on the device, so it must hold the whole library, not the first page of 20. It reads the library in
 * chunks of up to {@link LIBRARY_CHUNK_SIZE} recipes, each assembled from server pages of the largest size the endpoint
 * accepts, in the server's sort order; past one chunk, "Load more" reads the next.
 *
 * Pinned: the pages each chunk asks for (and never a page past the total), the server's order kept, the chunk's
 * `hasMore`, the next chunk's first page, the sort forwarded, and the key living under the `recipeLists` prefix so every
 * broad recipe-list invalidation reaches it.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeRecipe } from '../__fixtures__/recipes.js';
import type { Recipe } from '@kitchensink/recipe-core';

import type { RecipeServiceClient } from '../client.js';
import { LIBRARY_CHUNK_SIZE, LIBRARY_PAGE_SIZE, fetchLibraryChunk } from '../libraryChunk.js';
import { recipeQueries, recipeServiceKeys } from '../queries.js';

/** A fake `listRecipes` over `total` recipes, honouring `page` and `pageSize` like the server. */
function libraryOf(total: number) {
    const recipes: Recipe[] = Array.from({ length: total }, (_unused, index) =>
        makeRecipe({ id: `rec_${String(index).padStart(4, '0')}` }),
    );
    const listRecipes = vi.fn(
        async ({ page = 1, pageSize = 20 }: { page?: number; pageSize?: number; sortBy?: string }) => {
            const start = (page - 1) * pageSize;
            const data = recipes.slice(start, start + pageSize);

            return { data, total, page, pageSize, hasMore: start + data.length < total };
        },
    );

    return { recipes, listRecipes, client: { listRecipes } as unknown as RecipeServiceClient };
}

/** The pages the fake was asked for, in call order. */
function pagesAsked(listRecipes: ReturnType<typeof libraryOf>['listRecipes']): number[] {
    return listRecipes.mock.calls.map(([params]) => params.page ?? 1);
}

describe('fetchLibraryChunk', () => {
    it('asks for the largest page the endpoint accepts', async () => {
        const { client, listRecipes } = libraryOf(3);

        await fetchLibraryChunk(client, { firstPage: 1 });

        expect(LIBRARY_PAGE_SIZE).toBe(100);
        expect(listRecipes.mock.calls.every(([params]) => params.pageSize === LIBRARY_PAGE_SIZE)).toBe(true);
    });

    it.each<[number, number[], boolean]>([
        [0, [1], false],
        [1, [1], false],
        [100, [1], false],
        [101, [1, 2], false],
        [230, [1, 2, 3], false],
        [500, [1, 2, 3, 4, 5], false],
        [612, [1, 2, 3, 4, 5], true],
    ])('a library of %i asks for pages %j and reports hasMore %s', async (total, pages, hasMore) => {
        const { client, listRecipes, recipes } = libraryOf(total);

        const chunk = await fetchLibraryChunk(client, { firstPage: 1 });

        expect(pagesAsked(listRecipes).sort((a, b) => a - b)).toEqual(pages);
        expect(chunk.data.map((recipe) => recipe.id)).toEqual(recipes.slice(0, LIBRARY_CHUNK_SIZE).map((r) => r.id));
        expect(chunk.total).toBe(total);
        expect(chunk.hasMore).toBe(hasMore);
    });

    it('reads the next chunk from the page after the last one it read', async () => {
        const { client, listRecipes, recipes } = libraryOf(612);

        const first = await fetchLibraryChunk(client, { firstPage: 1 });
        listRecipes.mockClear();
        const second = await fetchLibraryChunk(client, { firstPage: first.nextFirstPage });

        expect(first.nextFirstPage).toBe(6);
        expect(pagesAsked(listRecipes).sort((a, b) => a - b)).toEqual([6, 7]);
        expect(second.data.map((r) => r.id)).toEqual(recipes.slice(500).map((r) => r.id));
        expect(second.hasMore).toBe(false);
    });

    it('forwards the sort to every page', async () => {
        const { client, listRecipes } = libraryOf(150);

        await fetchLibraryChunk(client, { firstPage: 1, sortBy: 'title' });

        expect(listRecipes.mock.calls.every(([params]) => params.sortBy === 'title')).toBe(true);
    });

    it('fails the whole chunk when any page fails, so the cook never sees a library with a hole in it', async () => {
        const { client, listRecipes } = libraryOf(250);
        listRecipes
            .mockImplementationOnce(listRecipes.getMockImplementation()!)
            .mockRejectedValueOnce(new Error('boom'));

        await expect(fetchLibraryChunk(client, { firstPage: 1 })).rejects.toThrow('boom');
    });
});

describe('recipeQueries(client).library', () => {
    it('keys each sort under the recipe-list prefix, so a recipe write invalidates it', () => {
        const { client } = libraryOf(0);
        const options = recipeQueries(client).library({ sortBy: 'createdAt' });

        expect(options.queryKey).toEqual(recipeServiceKeys.recipeLibrary({ sortBy: 'createdAt' }));
        expect(options.queryKey.slice(0, recipeServiceKeys.recipeLists.length)).toEqual([
            ...recipeServiceKeys.recipeLists,
        ]);
        expect(options.queryKey).not.toEqual(recipeServiceKeys.recipeListInfinite({ sortBy: 'createdAt' }));
    });

    it('starts at page 1 and reads the next chunk only while one remains', () => {
        const { client } = libraryOf(0);
        const options = recipeQueries(client).library();

        expect(options.initialPageParam).toBe(1);
        expect(options.getNextPageParam({ data: [], total: 600, hasMore: true, nextFirstPage: 6 }, [], 1, [1])).toBe(6);
        expect(
            options.getNextPageParam({ data: [], total: 10, hasMore: false, nextFirstPage: 2 }, [], 1, [1]),
        ).toBeUndefined();
    });
});
