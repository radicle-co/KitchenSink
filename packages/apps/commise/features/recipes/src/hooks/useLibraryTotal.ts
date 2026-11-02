'use client';

/**
 * @module @commise/features-recipes/hooks — how many items a library's latest settled read says there are ({@link libraryTotalOf}),
 * read from the query cache for a frame that sits outside the read's boundary (the Collections pinned search shows from six).
 * It never fetches; `useLibraryState.ts` says why.
 *
 * @pattern Observer — a `useSyncExternalStore` read of the query cache
 */
import type { QueryKey } from '@tanstack/react-query';

import { libraryTotalOf } from './libraryState.js';
import { useCacheJudgement, type LibraryFamilyMember } from './useCacheJudgement.js';

/**
 * How many items a library's latest settled read says there are, from the cache.
 *
 * @param family - Every read of the library.
 * @param ownKey - The screen's own read.
 * @returns The total, `0` while nothing has settled (and on the server).
 */
export function useLibraryTotal(family: readonly LibraryFamilyMember[], ownKey: QueryKey): number {
    return useCacheJudgement(family, ownKey, libraryTotalOf, 0);
}
