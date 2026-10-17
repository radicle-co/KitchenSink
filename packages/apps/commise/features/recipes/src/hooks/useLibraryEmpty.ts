'use client';

/**
 * @module @commise/features-recipes/hooks — whether a cached recipe or collection read has settled empty: what My recipes'
 * frame reads to hide its search on the first run (`docs/design/uiOverhaul/buildSpec.md` §4.3), and what Home and
 * Collections read to hide the floating create button while their first run shows its own start buttons (§3.4).
 *
 * Both envelopes the reads cache are the one paginated wire envelope, whose `total` counts everything there is: the
 * library and the collection list cache it as chunks (`pages[0].total`), Home's recent recipes as one page (`total`).
 *
 * The frame sits outside the read's suspense boundary, so it cannot read the result; it reads the CACHE instead, through
 * `useSyncExternalStore` over the query cache's own subscription. It never fetches and registers no observer: a disabled
 * `useInfiniteQuery` of the same key did both, and refetched on every boundary reset.
 *
 * The cache calls its listeners synchronously, and a suspense read writes the cache while its component RENDERS, so a
 * listener that re-rendered the host there was a setState inside another component's render (React's "Cannot update a
 * component while rendering a different component", measured on the Collections screen). The listener therefore hears
 * the cache on TanStack's own notify schedule (`notifyManager.schedule`), the one its observers use, after the write.
 *
 * @pattern Observer — a `useSyncExternalStore` read of the query cache
 */
import { notifyManager, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

/** What a read caches: chunks or pages, the first of which says how many there are, or one page that says so. */
type CachedRead = { readonly pages: readonly { readonly total: number }[] } | { readonly total: number };

/**
 * Whether a cached read is settled and empty. Pure.
 *
 * @param data - The cache entry, if any.
 * @returns `true` only for a settled read of nothing; an absent entry is unknown, not empty.
 */
function isEmptyRead(data: CachedRead | undefined): boolean {
    if (data === undefined) {
        return false;
    }

    return ('pages' in data ? (data.pages[0]?.total ?? 0) : data.total) === 0;
}

/**
 * Whether the read cached under `queryKey` has settled empty.
 *
 * @param queryKey - The read's key.
 * @returns `true` for a settled empty read.
 */
export function useLibraryEmpty(queryKey: QueryKey): boolean {
    const client = useQueryClient();
    const read = (): boolean => isEmptyRead(client.getQueryData<CachedRead>(queryKey));
    const subscribe = useCallback(
        (notify: () => void) => client.getQueryCache().subscribe(() => notifyManager.schedule(notify)),
        [client],
    );

    return useSyncExternalStore(subscribe, read, read);
}
