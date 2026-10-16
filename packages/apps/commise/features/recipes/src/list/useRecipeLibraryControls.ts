'use client';

/**
 * @module @commise/features-recipes/list — the controls My recipes keeps ABOVE its suspense boundary, on both platforms:
 * the search term, the pressed chips, the sort, and the library read they key.
 *
 * They outlive the boundary on purpose: typing while the library loads, or pressing Try again, must not reset them
 * (`docs/design/uiOverhaul/buildSpec.md` §4.3). The sort is the server's (`sortBy`), so a new sort is a new key; it is
 * read under `useDeferredValue` so the cards on screen stay until the new order lands. The read is built ONCE and
 * handed to both sides of the boundary, so the key the boundary checks for a prefetch and the read it gates agree.
 *
 * @pattern Headless hook — the state both platforms' containers duplicated, with the render left to each platform
 */
import { recipeQueries, type RecipeListSortBy } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useDeferredValue, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { useLibraryEmpty } from '../hooks/useLibraryEmpty.js';

/** The library read the boundary gates and the settled list renders. */
export type LibraryRead = ReturnType<ReturnType<typeof recipeQueries>['library']>;

/** What {@link useRecipeLibraryControls} hands the container. */
export interface RecipeLibraryControls {
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    readonly onClearSearch: () => void;
    /** Whether the frame shows the search: hidden only on a settled empty library with nothing typed. */
    readonly searchVisible: boolean;
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: Dispatch<SetStateAction<readonly string[]>>;
    readonly sort: RecipeListSortBy;
    readonly onSortChange: (sort: RecipeListSortBy) => void;
    /** The whole-library read under the DEFERRED sort. */
    readonly read: LibraryRead;
}

/**
 * The library's search, chips and sort, and the read they key.
 *
 * @sideEffect Reads the query cache (never fetches) for the empty-library verdict.
 * @returns The controls and the read.
 */
export function useRecipeLibraryControls(): RecipeLibraryControls {
    const client = useRecipeServiceClient();
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const [sort, setSort] = useState<RecipeListSortBy>('updatedAt');
    const deferredSort = useDeferredValue(sort);
    // Memoized: the boundary keys on this read, so a new options object per render would reset it on every cache event.
    const read = useMemo(() => recipeQueries(client).library({ sortBy: deferredSort }), [client, deferredSort]);
    // A cache-only read of the same key (it never fetches): the frame hides the search on a settled empty library.
    const libraryEmpty = useLibraryEmpty(read.queryKey);

    return {
        searchValue,
        onSearchChange: setSearchValue,
        onClearSearch: () => setSearchValue(''),
        searchVisible: !libraryEmpty || searchValue.length > 0,
        activeFacets,
        onActiveFacetsChange: setActiveFacets,
        sort,
        onSortChange: setSort,
        read,
    };
}
