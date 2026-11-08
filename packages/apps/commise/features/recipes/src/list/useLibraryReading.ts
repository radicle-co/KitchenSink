'use client';

/**
 * @module @commise/features-recipes/list — reads the Recipes library WITHOUT suspending, and says which of the three
 * states the screen is in. The query is returned too: the screen's refresh notice, pull-to-refresh and calorie batches
 * read the same query.
 *
 * `keepPreviousData` is load-bearing: a new sort is a new query key, and without it the list would fall back to
 * `pending` (taking the header with it) on every sort change. The search text and the chips narrow the loaded library
 * on the client, so they are not part of the key and never reach this.
 */
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { libraryReadingOf } from './libraryReading.js';
import type { LibraryRead } from './useRecipeLibraryControls.js';

/**
 * @param read - The library read from `useRecipeLibraryControls`.
 * @returns The reading, and the query it came from.
 * @sideEffect Subscribes to, and fetches, the library query.
 */
export function useLibraryReading(read: LibraryRead) {
    const query = useInfiniteQuery({ ...read, placeholderData: keepPreviousData });

    return { reading: libraryReadingOf(query), query };
}
