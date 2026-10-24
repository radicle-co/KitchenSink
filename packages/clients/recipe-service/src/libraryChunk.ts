/**
 * @module @kitchensink/recipe-service-client — the library read: the cook's recipes in chunks large enough to hold a
 * whole library at once (`docs/architecture/uiOverhaulBlueprint.md` A11).
 *
 * My recipes searches, filters and counts on the device, because `GET /api/v1/recipes` takes no filter. A page of 20
 * made every chip, count and "No recipes match" wrong past the first page. So the library is read as chunks of up to
 * {@link LIBRARY_CHUNK_SIZE} recipes — 500, the size past which the build spec puts a "Load more" (§4.3) — each
 * assembled from server pages of the largest size the endpoint accepts. The first page of a chunk is read alone,
 * because only it says how many recipes there are; the rest of the chunk is read in parallel.
 *
 * A chunk is all or nothing: a page that fails fails the chunk, so the cook never sees a library with a hole in it
 * that the counts would then misreport.
 *
 * The order is the server's (`sortBy`), which is correct across pages because the server sorts before paging.
 */
import { MAX_RECIPE_LIST_PAGE_SIZE, type Recipe } from '@kitchensink/recipe-core';

import type { RecipeServiceClient } from './client.js';
import type { RecipeListSortBy } from './types.js';

/** The page size each request asks for: the most the endpoint accepts. */
export const LIBRARY_PAGE_SIZE = MAX_RECIPE_LIST_PAGE_SIZE;

/** How many recipes one chunk holds before "Load more" (`docs/design/uiOverhaul/buildSpec.md` §4.3, "500+ recipes"). */
export const LIBRARY_CHUNK_SIZE = 500;

/** How many server pages one chunk spans. */
const PAGES_PER_CHUNK = LIBRARY_CHUNK_SIZE / LIBRARY_PAGE_SIZE;

/**
 * One chunk of the library.
 *
 * @notWireShape The client's own assembly of several `GET /api/v1/recipes` pages; the service never sends it.
 */
export interface LibraryChunk {
    /** The chunk's recipes, in the server's order. */
    readonly data: readonly Recipe[];
    /** How many recipes the library holds. */
    readonly total: number;
    /** Whether recipes remain past this chunk. */
    readonly hasMore: boolean;
    /** The server page the next chunk starts at. */
    readonly nextFirstPage: number;
}

/**
 * What one chunk is asked for.
 *
 * @notWireShape The client's own request to itself; the wire request is each page's `ListRecipesParams`.
 */
export interface LibraryChunkRequest {
    /** The server page the chunk starts at. */
    readonly firstPage: number;
    /** The server's sort, forwarded to every page. */
    readonly sortBy?: RecipeListSortBy;
}

/**
 * Read one chunk of the library.
 *
 * @param client - The configured client.
 * @param request - Where the chunk starts, and the sort.
 * @returns The chunk.
 * @throws whatever a page's request throws: a chunk is all or nothing.
 * @sideEffect Performs up to {@link PAGES_PER_CHUNK} authenticated HTTP requests.
 */
export async function fetchLibraryChunk(
    client: Pick<RecipeServiceClient, 'listRecipes'>,
    { firstPage, sortBy }: LibraryChunkRequest,
): Promise<LibraryChunk> {
    const read = (page: number) =>
        client.listRecipes({ page, pageSize: LIBRARY_PAGE_SIZE, ...(sortBy === undefined ? {} : { sortBy }) });
    const first = await read(firstPage);
    const pagesInLibrary = Math.ceil(first.total / LIBRARY_PAGE_SIZE);
    const lastPage = Math.min(firstPage + PAGES_PER_CHUNK - 1, pagesInLibrary);
    const rest = await Promise.all(
        Array.from({ length: Math.max(0, lastPage - firstPage) }, (_unused, index) => read(firstPage + 1 + index)),
    );
    const pages = [first, ...rest];
    const last = pages[pages.length - 1] ?? first;

    return {
        data: pages.flatMap((page) => page.data),
        total: first.total,
        hasMore: last.hasMore,
        nextFirstPage: firstPage + pages.length,
    };
}
