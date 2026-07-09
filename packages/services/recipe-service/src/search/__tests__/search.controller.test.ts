/**
 * T043-test — unit tests for {@link SearchController} over a fake {@link SearchService}.
 *
 * Asserts the thin controller's only responsibilities: it reads the owner key from
 * `req.principal.userId`, delegates the validated query to the service, returns the service's result
 * verbatim, and rejects (401) when no principal is present.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { SearchController } from '../search.controller.js';
import type { SearchService } from '../search.service.js';
import type { RecipeSearchResponse } from '../dto/search-response.dto.js';
import type { SearchRecipesQueryDto } from '../dto/search-recipes.query.dto.js';
import type { AuthenticatedRequest } from '../../auth/principal.js';

const OWNER = '01J000000000000000000FREE0';

function reqWith(userId?: string): AuthenticatedRequest {
    return { principal: userId ? { userId } : undefined } as unknown as AuthenticatedRequest;
}

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

        const result = await controller.searchRecipes(reqWith(OWNER), query);

        expect(searchRecipes).toHaveBeenCalledWith(OWNER, query);
        expect(result).toBe(RESPONSE);
    });

    it('rejects with 401 when no principal is present', async () => {
        const searchRecipes = vi.fn();
        const controller = new SearchController(fakeService({ searchRecipes }));

        await expect(controller.searchRecipes(reqWith(undefined), {} as SearchRecipesQueryDto)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(searchRecipes).not.toHaveBeenCalled();
    });
});
