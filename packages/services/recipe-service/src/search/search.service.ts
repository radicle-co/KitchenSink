/**
 * T043 — recipe-search orchestration.
 *
 * Sits between the controller (which supplies the authenticated owner key — `principal.userId`) and the
 * {@link SearchDal}. It owns only the thin concerns the DAL delegates upward: filling in the default
 * page/pageSize/sortBy, forwarding the owner key + structured filters, and shaping the paginated
 * envelope (`hasMore` from the DAL's unpaged total). Visibility scoping and ranking live in the DAL.
 */
import { Inject, Injectable } from '@nestjs/common';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { RecipeSearchParams } from '@kitchensink/recipe-core';

import { SearchDal, DEFAULT_SEARCH_PAGE_SIZE } from './dal/search.dal.js';
import type { RecipeSearchResponse } from './dto/search-response.dto.js';

/** DI token for the search DAL — provided by `SearchModule` via `useFactory` over the Drizzle client. */
export const SEARCH_DAL = 'SEARCH_DAL';

@Injectable()
export class SearchService {
    public constructor(@Inject(SEARCH_DAL) private readonly dal: SearchDal) {}

    /**
     * Run a ranked, faceted, paginated recipe search visible to `ownerId` (public recipes + their own).
     *
     * @param ownerId - The caller's app-user ULID (widens visibility beyond `public`).
     * @param params - The validated search parameters (a subset of `RecipeSearchParams`).
     * @returns The ranked results, facet counts, and pagination envelope.
     */
    public async searchRecipes(ownerId: string, params: RecipeSearchParams): Promise<RecipeSearchResponse> {
        const page = params.page ?? 1;
        const pageSize = params.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
        const sortBy = params.sortBy ?? RecipeSearchSortBy.RELEVANCE;

        const { results, facets, total } = await this.dal.search({
            ownerId,
            query: params.query,
            cuisine: params.cuisine,
            dietaryFlags: params.dietaryFlags,
            tags: params.tags,
            maxPrepTime: params.maxPrepTime,
            maxTotalTime: params.maxTotalTime,
            ingredientIds: params.ingredientIds,
            page,
            pageSize,
            sortBy,
        });

        return {
            results,
            facets,
            total,
            page,
            pageSize,
            hasMore: page * pageSize < total,
        };
    }
}
