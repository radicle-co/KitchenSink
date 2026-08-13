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

import { toPageEnvelope } from '../common/pagination.js';
import { SearchDal, DEFAULT_SEARCH_PAGE_SIZE } from './dal/search.dal.js';
// The service's input type is THIS SERVICE'S OWN authored wire contract. It used to be `recipe-core`'s
// hand-written `RecipeSearchParams` — a second, looser declaration of the same knowledge (no bounds, no
// coercion, MUTABLE arrays) which widened the parsed query back to a shape the boundary had already refused.
// That interface has since been DELETED, along with its never-called zod twin; the published
// `RecipeSearchQuery` is the only representation left, and it is what the pipe actually produces.
import type { RecipeSearchQuery, RecipeSearchResponse } from './search.schema.js';

/** DI token for the search DAL — provided by `SearchModule` via `useFactory` over the Drizzle client. */
export const SEARCH_DAL = 'SEARCH_DAL';

@Injectable()
export class SearchService {
    public constructor(@Inject(SEARCH_DAL) private readonly dal: SearchDal) {}

    /**
     * Run a ranked, faceted, paginated recipe search visible to `ownerId` (public recipes + their own).
     *
     * @param ownerId - The caller's app-user ULID (widens visibility beyond `public`).
     * @param params - The parsed search query, exactly as `recipeSearchQuerySchema` produced it.
     * @returns The ranked results, facet counts, and pagination envelope.
     */
    public async searchRecipes(ownerId: string, params: RecipeSearchQuery): Promise<RecipeSearchResponse> {
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
            maxCookTime: params.maxCookTime,
            maxTotalTime: params.maxTotalTime,
            ingredientIds: params.ingredientIds,
            page,
            pageSize,
            sortBy,
        });

        return {
            results,
            facets,
            ...toPageEnvelope({ total, page, pageSize, rowCount: results.length }),
        };
    }
}
