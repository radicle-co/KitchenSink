/**
 * T043 — the response envelope for `GET /v1/search/recipes`.
 *
 * Wraps the ranked {@link RecipeSearchResult} hits (from `@kitchensink/recipe-core`) with the facet
 * aggregations the DAL computes ({@link RecipeSearchFacets}) and the pagination metadata the client uses
 * to page through results. Mirrors the paginated envelope shape used by the other verticals, plus a
 * `facets` block.
 */
import type { RecipeSearchResult } from '@kitchensink/recipe-core';

import type { RecipeSearchFacets } from '../dal/search.dal.js';

/** The `GET /v1/search/recipes` response body. */
export interface RecipeSearchResponse {
    /** The ranked page of hits. */
    results: RecipeSearchResult[];
    /** Facet counts (by dietary flag and tag) over the ranked match sample. */
    facets: RecipeSearchFacets;
    /** Total number of matching recipes (unpaged). */
    total: number;
    /** 1-based page number echoed back. */
    page: number;
    /** Page size echoed back. */
    pageSize: number;
    /** Whether more pages remain after this one. */
    hasMore: boolean;
}
