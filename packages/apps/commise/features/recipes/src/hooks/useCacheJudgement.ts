'use client';

/**
 * @module @commise/features-recipes/hooks — the one hook that judges a library from the query cache, for `useLibraryState` and
 * `useLibraryTotal`. The screens' frames sit outside the read's suspense boundary, so they read the CACHE through
 * `useSyncExternalStore` over the query cache's own subscription; `useLibraryState.ts` says why it never fetches and how it hears the
 * cache.
 *
 * @pattern Observer — a `useSyncExternalStore` read of the query cache
 */
import { notifyManager, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import type { ReadSnapshot } from './libraryState.js';

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
 * A value judged from the cache. The snapshot is a primitive, so it is stable by value.
 *
 * @param family - Every read of the library.
 * @param ownKey - The screen's own read.
 * @param judge - The pure judgement over the snapshots.
 * @param serverValue - The server render's answer: the cache there is not the browser's.
 * @returns The judgement.
 */
export function useCacheJudgement<T extends string | number>(
    family: readonly LibraryFamilyMember[],
    ownKey: QueryKey,
    judge: (family: readonly ReadSnapshot[], own: ReadSnapshot | undefined) => T,
    serverValue: T,
): T {
    const client = useQueryClient();
    const read = (): T =>
        judge(
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

    return useSyncExternalStore(subscribe, read, () => serverValue);
}
