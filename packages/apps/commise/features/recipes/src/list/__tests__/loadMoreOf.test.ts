/**
 * `loadMoreOf` is the ONE projection of an infinite query's paging flags onto the load-more control, so the three lists
 * that page (recipes, collections, discovery) cannot disagree about which flag means which. Each field is driven by a
 * different flag, so a swap of any two fails here.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadMoreOf, type PagedQuery } from '../loadMoreOf.js';

const pager = (over: Partial<PagedQuery> = {}): PagedQuery => ({
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: () => Promise.resolve(undefined),
    ...over,
});

describe('loadMoreOf', () => {
    it.each([
        ['hasMore follows hasNextPage', { hasNextPage: true }, { hasMore: true, loading: false, failed: false }],
        [
            'loading follows isFetchingNextPage',
            { isFetchingNextPage: true },
            { hasMore: false, loading: true, failed: false },
        ],
        [
            'failed follows isFetchNextPageError',
            { isFetchNextPageError: true },
            { hasMore: false, loading: false, failed: true },
        ],
        ['an idle last page offers nothing', {}, { hasMore: false, loading: false, failed: false }],
    ])('%s', (_name, flags, expected) => {
        expect(loadMoreOf(pager(flags))).toMatchObject(expected);
    });

    it('onLoadMore fetches the next page, returns nothing, and does not fetch until pressed', () => {
        const fetchNextPage = vi.fn(() => Promise.resolve(undefined));
        const control = loadMoreOf(pager({ fetchNextPage }));

        expect(fetchNextPage).not.toHaveBeenCalled();
        expect(control.onLoadMore()).toBeUndefined();
        expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });
});
