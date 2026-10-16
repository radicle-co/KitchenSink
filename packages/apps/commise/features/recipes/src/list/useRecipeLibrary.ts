'use client';

/**
 * @module @commise/features-recipes/list — the SETTLED library's view-model, shared by web's `RecipeListContainer` and
 * mobile's `RecipeListScreen`: the rows the loaded chunks flatten to, the chips and their counts over the WHOLE library,
 * the rows the narrowing leaves and the state they put the results in, the Clear-filters counter, and the load-more
 * flags (`docs/architecture/uiOverhaulBlueprint.md` A11).
 *
 * The host passes the infinite query in: this package does not depend on `@commise/query`, so the failed-refresh
 * notice (`useRefreshNotice`), the pull-to-refresh and the calorie batches — each differs by platform — stay with the
 * host, which reads them from the same query and from {@link RecipeLibraryModel.chunkIds}.
 *
 * @pattern Headless hook — a projection of one infinite query plus the viewer's narrowing; each platform renders it
 */
import type { Recipe } from '@kitchensink/recipe-core';
import { useMemo, useState } from 'react';

import { useMessages } from '@commise/i18n/react';

import { recipeMessages } from '../messages.js';
import { libraryFacetsOf, libraryStateOf, narrowLibrary } from './library.js';
import type { LibraryFacet, LibraryState } from './libraryTypes.js';
import { toRecipeListItem, type RecipeListItem } from './model.js';

/** The part of the library's infinite query this hook reads; the real query result satisfies it. */
export interface LibraryQuery {
    readonly data: { readonly pages: readonly { readonly data: readonly Recipe[] }[] };
    readonly hasNextPage: boolean;
    readonly isFetchingNextPage: boolean;
    readonly isFetchNextPageError: boolean;
    readonly fetchNextPage: () => Promise<unknown>;
}

/** What {@link useRecipeLibrary} reads. */
export interface RecipeLibraryInput {
    readonly query: LibraryQuery;
    /** The viewer's locale, whose case rules set the chips' labels. */
    readonly locale: string;
    readonly searchValue: string;
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: (update: (current: readonly string[]) => readonly string[]) => void;
}

/** What the results render, minus the platform's own presentation. */
export interface RecipeLibraryModel {
    readonly recipes: readonly RecipeListItem[];
    readonly state: LibraryState;
    readonly facets: {
        readonly facets: readonly LibraryFacet[];
        readonly onToggle: (facet: string) => void;
        readonly onClear: () => void;
    };
    /** How many times Clear filters was pressed; a change is the signal to move focus. */
    readonly clearCount: number;
    readonly onClearFilters: () => void;
    readonly loadMore: {
        readonly hasMore: boolean;
        readonly loading: boolean;
        readonly failed: boolean;
        readonly onLoadMore: () => void;
    };
    /**
     * The loaded chunks' recipe ids, one list per chunk (each at most 500, the calorie batch's cap). ⛔ Key the batches
     * by THESE, never the narrowed rows: narrowing runs on every keystroke, and narrowed ids would re-key the read per
     * character while every figure on screen fell back to its skeleton.
     */
    readonly chunkIds: readonly (readonly string[])[];
}

/**
 * The settled library's view-model.
 *
 * @param input - The query, the locale and the viewer's narrowing.
 * @returns The rows, chips, state, clear counter and load-more flags.
 */
export function useRecipeLibrary({
    query,
    locale,
    searchValue,
    activeFacets,
    onActiveFacetsChange,
}: RecipeLibraryInput): RecipeLibraryModel {
    const { list } = useMessages(recipeMessages);
    const [clearCount, setClearCount] = useState(0);
    const pages = query.data.pages;
    const library = useMemo(() => pages.flatMap((chunk) => chunk.data), [pages]);
    const facets = useMemo(
        () => libraryFacetsOf(library, searchValue, activeFacets, list.filterQuick, locale),
        [library, searchValue, activeFacets, list.filterQuick, locale],
    );
    const recipes = useMemo(
        () => narrowLibrary(library, searchValue, activeFacets).map(toRecipeListItem),
        [library, searchValue, activeFacets],
    );
    const chunkIds = useMemo(() => pages.map((chunk) => chunk.data.map((recipe) => recipe.id)), [pages]);

    return {
        recipes,
        state: libraryStateOf({ visibleCount: recipes.length, searchValue, activeFacets }),
        facets: {
            facets,
            onToggle: (facet) =>
                onActiveFacetsChange((current) =>
                    current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet],
                ),
            onClear: () => onActiveFacetsChange(() => []),
        },
        clearCount,
        onClearFilters: () => {
            setClearCount((count) => count + 1);
            onActiveFacetsChange(() => []);
        },
        loadMore: {
            hasMore: query.hasNextPage,
            loading: query.isFetchingNextPage,
            failed: query.isFetchNextPageError,
            onLoadMore: () => void query.fetchNextPage(),
        },
        chunkIds,
    };
}
