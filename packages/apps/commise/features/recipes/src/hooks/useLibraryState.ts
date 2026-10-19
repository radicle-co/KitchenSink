'use client';

/**
 * @module @commise/features-recipes/hooks — a library's state ({@link libraryStateOf}) read from the query cache: what
 * Home, My recipes and Collections read to decide whether the floating create button shows (`docs/design/uiOverhaul/buildSpec.md`
 * §3.4), and what My recipes' frame reads to hide its search on the first run (§4.3).
 *
 * The screens' frames sit outside the read's suspense boundary, so they cannot read the result; they read the CACHE
 * instead, through `useSyncExternalStore` over the query cache's own subscription. It never fetches and registers no
 * observer: a disabled `useInfiniteQuery` of the same key did both, and refetched on every boundary reset. The snapshot
 * is a string, so it is stable by value.
 *
 * The cache calls its listeners synchronously, and a suspense read writes the cache while its component RENDERS, so a
 * listener that re-rendered the host there was a setState inside another component's render (React's "Cannot update a
 * component while rendering a different component", measured on the Collections screen). The listener therefore hears
 * the cache on TanStack's own notify schedule (`notifyManager.schedule`), the one its observers use, after the write.
 *
 * The server snapshot is `loading`, not a read of the cache: the server's cache is not the browser's, so a read there
 * could disagree with the HTML. Hydration therefore agrees, and the client's real state arrives on the next commit.
 *
 * @pattern Observer — a `useSyncExternalStore` read of the query cache
 */
import { notifyManager, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { libraryStateOf, type LibraryCacheState, type ReadSnapshot } from './libraryState.js';

/** One member of a library's family of reads: a key, matched as a prefix unless `exact`. */
export interface LibraryFamilyMember {
    readonly queryKey: QueryKey;
    readonly exact?: boolean;
}

/**
 * The snapshot of one cached read.
 *
 * @param client - The query client.
 * @param queryKey - The read's key, matched exactly.
 * @returns Its snapshot, or `undefined` while it has no cache entry.
 */
function snapshotOf(client: QueryClient, queryKey: QueryKey): ReadSnapshot | undefined {
    const state = client.getQueryCache().find({ queryKey, exact: true })?.state;

    return state === undefined ? undefined : snapshotOfState(state);
}

/**
 * Narrows a query's state to the parts the classifier judges. The cache holds data the wire schemas produced, which
 * always carry `total`; the classifier reads only that.
 */
function snapshotOfState(state: {
    readonly data: unknown;
    readonly dataUpdatedAt: number;
    readonly status: ReadSnapshot['status'];
    readonly fetchStatus: ReadSnapshot['fetchStatus'];
}): ReadSnapshot {
    const { data, dataUpdatedAt, status, fetchStatus } = state;

    return { data: data as ReadSnapshot['data'], dataUpdatedAt, status, fetchStatus };
}

/**
 * The state of a library, from the cache.
 *
 * @param family - Every read of the library (the recipe library's is `useRecipeLibraryState`'s family).
 * @param ownKey - The screen's own read, which decides loading vs unreachable while nothing has settled.
 * @returns The library's state.
 */
export function useLibraryState(family: readonly LibraryFamilyMember[], ownKey: QueryKey): LibraryCacheState {
    const client = useQueryClient();
    const read = (): LibraryCacheState =>
        libraryStateOf(
            family.flatMap((member) =>
                client
                    .getQueryCache()
                    .findAll({ queryKey: member.queryKey, exact: member.exact ?? false })
                    .map((query) => snapshotOfState(query.state)),
            ),
            snapshotOf(client, ownKey),
        );
    const subscribe = useCallback(
        (notify: () => void) => client.getQueryCache().subscribe(() => notifyManager.schedule(notify)),
        [client],
    );

    return useSyncExternalStore(subscribe, read, serverState);
}

/**
 * The server render's answer: the cache there is not the browser's.
 *
 * @returns Always `loading`. Pure.
 */
function serverState(): LibraryCacheState {
    return 'loading';
}
