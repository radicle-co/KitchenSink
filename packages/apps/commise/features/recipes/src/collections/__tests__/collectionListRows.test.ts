/**
 * `collectionListRowsOf` — what the settled collection list renders from its infinite read: the pages flattened, the
 * rows the search leaves, the total of everything loaded (the first-run and "no matches" states read it) and the
 * server-paged load-more flags. Written FIRST: web's `SettledCollectionList` and mobile's `SettledCollections` each
 * carried this projection, and neither pinned it apart from the container around it.
 */
import { describe, expect, it, vi } from 'vitest';

import { collectionListRowsOf, type CollectionListQuery } from '../collectionListRows.js';

const collection = (id: string, name: string) => ({ id, name });

const queryOf = (overrides: Partial<CollectionListQuery<ReturnType<typeof collection>>> = {}) => ({
    data: {
        pages: [
            { data: [collection('c1', 'Dinners'), collection('c2', 'Baking')] },
            { data: [collection('c3', 'Dinner party')] },
        ],
    },
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
});

describe('collectionListRowsOf', () => {
    it('flattens every loaded page, in order, when nothing is searched', () => {
        const rows = collectionListRowsOf(queryOf(), '');

        expect(rows.collections.map((row) => row.id)).toEqual(['c1', 'c2', 'c3']);
        expect(rows.total).toBe(3);
    });

    it('narrows by name across ALL loaded pages but keeps the total of everything loaded', () => {
        const rows = collectionListRowsOf(queryOf(), 'dinner');

        expect(rows.collections.map((row) => row.id)).toEqual(['c1', 'c3']);
        expect(rows.total).toBe(3);
    });

    it('reports the load-more flags from the query, and asks for the next page', () => {
        const query = queryOf({ isFetchingNextPage: true, isFetchNextPageError: true });
        const { loadMore } = collectionListRowsOf(query, '');

        expect(loadMore).toMatchObject({ hasMore: true, loading: true, failed: true });

        loadMore.onLoadMore();

        expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
    });
});
