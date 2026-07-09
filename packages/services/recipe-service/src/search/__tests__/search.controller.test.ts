/**
 * T043-test — unit tests for {@link SearchController} over a fake {@link SearchService}.
 *
 * Asserts the thin controller's only responsibilities: it receives the owner key already resolved by
 * the `@OwnerId()` decorator, delegates the validated query to the service, and returns the service's
 * result verbatim. The "missing principal → 401" path lives on the decorator and is covered by
 * `auth/__tests__/current-principal.decorator.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';

import { SearchController } from '../search.controller.js';
import type { SearchService } from '../search.service.js';
import type { RecipeSearchResponse } from '../dto/search-response.dto.js';
import type { SearchRecipesQueryDto } from '../dto/search-recipes.query.dto.js';

const OWNER = '01J000000000000000000FREE0';

function fakeService(overrides: Partial<SearchService> = {}): SearchService {
    return { searchRecipes: vi.fn(), ...overrides } as unknown as SearchService;
}

const RESPONSE = {
    results: [],
    facets: { dietaryFlags: [], tags: [] },
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
} as RecipeSearchResponse;

describe('SearchController.searchRecipes', () => {
    it('delegates the owner key + query and returns the service result', async () => {
        const searchRecipes = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new SearchController(fakeService({ searchRecipes }));
        const query = { query: 'pasta', page: 1, pageSize: 20 } as SearchRecipesQueryDto;

        const result = await controller.searchRecipes(OWNER, query);

        expect(searchRecipes).toHaveBeenCalledWith(OWNER, query);
        expect(result).toBe(RESPONSE);
    });
});
