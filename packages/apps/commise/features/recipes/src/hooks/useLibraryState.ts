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
import type { QueryKey } from '@tanstack/react-query';

import { libraryStateOf, type LibraryCacheState } from './libraryState.js';
import { useCacheJudgement, type LibraryFamilyMember } from './useCacheJudgement.js';

/**
 * The state of a library, from the cache.
 *
 * @param family - Every read of the library (the recipe library's is `useRecipeLibraryState`'s family).
 * @param ownKey - The screen's own read, which decides loading vs unreachable while nothing has settled.
 * @returns The library's state. On the server it is `loading`.
 */
export function useLibraryState(family: readonly LibraryFamilyMember[], ownKey: QueryKey): LibraryCacheState {
    return useCacheJudgement(family, ownKey, libraryStateOf, 'loading');
}
