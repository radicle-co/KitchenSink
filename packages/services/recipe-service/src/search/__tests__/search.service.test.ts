/**
 * T043-test — unit tests for {@link SearchService} over a fake {@link SearchDal}.
 *
 * Pins the thin orchestration the DAL delegates upward: default page/pageSize/sortBy, forwarding the
 * owner key + structured filters to the DAL, and computing the `hasMore` envelope from the DAL's
 * unpaged total. No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { RecipeSearchParams } from '@kitchensink/recipe-core';

import { SearchService } from '../search.service.js';
import type { SearchDal, RecipeSearchDalResult } from '../dal/search.dal.js';
import { makeSearchResult } from '../__fixtures__/search.fixtures.js';

const OWNER = '01J000000000000000000FREE0';

function dalResult(overrides: Partial<RecipeSearchDalResult> = {}): RecipeSearchDalResult {
    return {
        results: [makeSearchResult()],
        facets: { dietaryFlags: [{ value: 'vegetarian', count: 1 }], tags: [], cuisine: [], totalTime: [] },
        total: 1,
        ...overrides,
    };
}

function fakeDal(result: RecipeSearchDalResult): { dal: SearchDal; search: ReturnType<typeof vi.fn> } {
    const search = vi.fn().mockResolvedValue(result);
    const dal = { search } as unknown as SearchDal;

    return { dal, search };
}

describe('SearchService.searchRecipes', () => {
    it('forwards the owner key and filters, defaulting page/pageSize/sortBy', async () => {
        const { dal, search } = fakeDal(dalResult());
        const params: RecipeSearchParams = { query: 'pasta', cuisine: 'italian', dietaryFlags: ['vegetarian'] };

        await new SearchService(dal).searchRecipes(OWNER, params);

        expect(search).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: OWNER,
                query: 'pasta',
                cuisine: 'italian',
                dietaryFlags: ['vegetarian'],
                page: 1,
                pageSize: 20,
                sortBy: RecipeSearchSortBy.RELEVANCE,
            }),
        );
    });

    it('honors explicit pagination + sort', async () => {
        const { dal, search } = fakeDal(dalResult());
        const params: RecipeSearchParams = { page: 3, pageSize: 10, sortBy: RecipeSearchSortBy.TITLE };

        await new SearchService(dal).searchRecipes(OWNER, params);

        expect(search).toHaveBeenCalledWith(
            expect.objectContaining({ page: 3, pageSize: 10, sortBy: RecipeSearchSortBy.TITLE }),
        );
    });

    it('returns the DAL results + facets and computes hasMore from the total', async () => {
        const { dal } = fakeDal(dalResult({ total: 25 }));

        const response = await new SearchService(dal).searchRecipes(OWNER, { query: 'pasta', page: 1, pageSize: 20 });

        expect(response.total).toBe(25);
        expect(response.page).toBe(1);
        expect(response.pageSize).toBe(20);
        expect(response.hasMore).toBe(true); // 1*20 < 25
        expect(response.results).toHaveLength(1);
        expect(response.facets.dietaryFlags).toEqual([{ value: 'vegetarian', count: 1 }]);
    });

    it('reports hasMore=false on a SHORT final page (fewer results than pageSize, nothing left)', async () => {
        // S-R8 correctness fix: `total: 15` here was internally inconsistent with the fixture's 1-result
        // default under the OLD `page * pageSize < total` formula, which ignored the actual result count
        // — it happened to pass regardless of whether the DAL truly returned every remaining match. The
        // shared `toPageEnvelope` formula trusts the ACTUAL result count, so the fixture must be
        // realistic: pageSize=20 but only 1 result exists in total, so the DAL genuinely returns a short
        // (1-result) page.
        const { dal } = fakeDal(dalResult({ total: 1 }));

        const response = await new SearchService(dal).searchRecipes(OWNER, { page: 1, pageSize: 20 });

        expect(response.hasMore).toBe(false);
    });
});
