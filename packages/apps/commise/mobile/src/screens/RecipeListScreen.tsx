/**
 * Recipe-list screen (mobile, orchestration). The shared native recipe-list FRAME (title band + search field) around a suspense read
 * of the caller's library: `Suspense` renders `RecipeListLoading`, the error boundary renders `RecipeListLoadError`
 * (its retry refetches, and it keeps the create button), and once settled the RESULTS render the facet chips, the rows
 * narrowed by the search term and chips with pull-to-refresh, and a notice for a failed refresh of them.
 *
 * The screen owns the search term and the active chips, because both outlive the boundary: typing while the library
 * loads, or pressing Try again, must not reset them. A retry from the refresh notice that succeeds moves the
 * screen-reader cursor to the heading; the notice is inside the boundary and the heading outside it, so the recovery
 * crosses as a `useRecoverySignal` counter. Community switching is the shell's Discover tab on mobile, so the frame
 * mounts no source switcher (L5 parity).
 *
 * Slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.3): the screen reads the WHOLE library in
 * chunks of up to 500 (`recipeQueries(client).library`), so the chips, their counts and the no-match states are right
 * past the first page (blueprint A11); forwards the sort to the server; keeps the list/grid choice per device; and
 * decides the card variant from the container class. The My recipes · Collections segments are the host's to pass
 * (`segments`), with the large title's avatar (`headerAction`).
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    RecipeNutritionSlot,
    cardVariantOf,
    libraryFacetsOf,
    libraryStateOf,
    narrowLibrary,
    recipeMessages,
    toRecipeListItem,
    useMainContainerClass,
    viewModeOf,
    type CardVariant,
    type ListViewMode,
    type RecipesSegmentControl,
} from '@commise/features-recipes';
import { useLibraryEmpty, useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { ChipRowOverflow } from '@commise/ui/chip';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { recipeQueries, type RecipeListSortBy } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useDeferredValue, useMemo, useState } from 'react';

import { useStoredViewMode } from '../hooks/useStoredViewMode.js';

/** Props for {@link RecipeListScreen}. */
export interface RecipeListScreenProps {
    /** Invoked with the recipe id when a row is activated (the composing screen navigates to detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked when the create-recipe action is activated. */
    readonly onCreateRecipe?: () => void;
    /**
     * The first run's Paste ingredients: the new editor at Ingredients with its paste sheet open (build spec §7.5.4).
     *
     * ⛔ Forwarded UNDEFAULTED, unlike `onCreateRecipe`'s `?? noop`: the first run removes the button when this is
     * absent, and defaulting it to a no-op would render a button that silently does nothing instead.
     */
    readonly onPasteIngredients?: () => void;
    /** The My recipes · Collections segments, when the host shows them on this screen. */
    readonly segments?: RecipesSegmentControl;
    /** The large title's action: the avatar, which pushes Profile (slice 3). The route supplies it. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
}

const noop = (): void => undefined;

/**
 * The recipe-list screen.
 *
 * @param props - Selection and create callbacks the composing screen wires to navigation.
 * @returns The frame around the read boundary.
 */
export function RecipeListScreen({
    onSelectRecipe,
    onCreateRecipe = noop,
    onPasteIngredients,
    segments,
    headerAction,
    scrollBind,
}: RecipeListScreenProps): JSX.Element {
    const client = useRecipeServiceClient();
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const [sort, setSort] = useState<RecipeListSortBy>('updatedAt');
    const [viewChoice, setViewChoice] = useStoredViewMode();
    const recovery = useRecoverySignal();
    const container = useMainContainerClass();
    const viewMode = viewModeOf(viewChoice, container);
    const variant = cardVariantOf(container, viewMode, 'library');
    const deferredSort = useDeferredValue(sort);
    // Memoized: a new options object per render would hand the boundary a new read on every cache event.
    const read = useMemo(() => recipeQueries(client).library({ sortBy: deferredSort }), [client, deferredSort]);
    // A cache-only read of the same key (it never fetches): the frame hides the search on a settled empty library.
    const libraryEmpty = useLibraryEmpty(read.queryKey);

    return (
        <RecipeListFrame
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            searchVisible={!libraryEmpty || searchValue.length > 0}
            {...(segments === undefined ? {} : { segments })}
            {...(headerAction === undefined ? {} : { headerAction })}
            headingFocusSignal={recovery.signal}
        >
            <QueryBoundary
                loading={<RecipeListLoading variant={variant} />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError onRetry={resetErrorBoundary} onCreateRecipe={onCreateRecipe} />
                )}
            >
                <SettledRecipeList
                    read={read}
                    searchValue={searchValue}
                    onClearSearch={() => setSearchValue('')}
                    activeFacets={activeFacets}
                    onActiveFacetsChange={setActiveFacets}
                    sort={sort}
                    onSortChange={setSort}
                    viewMode={viewMode}
                    onViewModeChange={setViewChoice}
                    variant={variant}
                    chipOverflow={container === 'narrow' ? 'scroll' : 'wrap'}
                    onSelectRecipe={onSelectRecipe}
                    onCreateRecipe={onCreateRecipe}
                    onPasteIngredients={onPasteIngredients}
                    onRecovered={recovery.onRecovered}
                    scrollBind={scrollBind}
                />
            </QueryBoundary>
        </RecipeListFrame>
    );
}

/** Props for {@link SettledRecipeList}. */
interface SettledRecipeListProps {
    readonly read: ReturnType<ReturnType<typeof recipeQueries>['library']>;
    readonly searchValue: string;
    readonly onClearSearch: () => void;
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: (update: (current: readonly string[]) => readonly string[]) => void;
    readonly sort: RecipeListSortBy;
    readonly onSortChange: (sort: RecipeListSortBy) => void;
    readonly viewMode: ListViewMode;
    readonly onViewModeChange: (mode: ListViewMode) => void;
    readonly variant: CardVariant;
    readonly chipOverflow: ChipRowOverflow;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients?: () => void;
    readonly onRecovered: () => void;
    readonly scrollBind: ScrollBind | undefined;
}

/**
 * The library once it has settled: the facets and their counts over the whole library, the rows the narrowing leaves,
 * their state, and one calorie batch per chunk.
 *
 * @param props - The read, the viewer's narrowing and presentation, and the intents to forward.
 * @returns The results.
 */
function SettledRecipeList({
    read,
    searchValue,
    onClearSearch,
    activeFacets,
    onActiveFacetsChange,
    sort,
    onSortChange,
    viewMode,
    onViewModeChange,
    variant,
    chipOverflow,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    onRecovered,
    scrollBind,
}: SettledRecipeListProps): JSX.Element {
    const { list } = useMessages(recipeMessages);
    const query = useSuspenseInfiniteQuery(read);
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const library = useMemo(() => query.data.pages.flatMap((chunk) => chunk.data), [query.data.pages]);
    const facets = useMemo(
        () => libraryFacetsOf(library, searchValue, activeFacets, list.filterQuick),
        [library, searchValue, activeFacets, list.filterQuick],
    );
    const recipes = useMemo(
        () => narrowLibrary(library, searchValue, activeFacets).map(toRecipeListItem),
        [library, searchValue, activeFacets],
    );
    // ⛔ THE LOADED CHUNKS, never the narrowed rows: narrowing runs on every keystroke, and narrowed ids would change the
    // batch's key per character while every figure on screen fell back to its skeleton. One batch per chunk (≤ 500).
    const nutritionFor = useRecipeNutritionBatches(
        query.data.pages.map((chunk) => chunk.data.map((recipe) => recipe.id)),
    );

    return (
        <RecipeListResults
            {...(scrollBind === undefined ? {} : { scrollBind })}
            recipes={recipes}
            state={libraryStateOf({ visibleCount: recipes.length, searchValue, activeFacets })}
            searchValue={searchValue}
            onClearSearch={onClearSearch}
            onClearFilters={() => onActiveFacetsChange(() => [])}
            onSelectRecipe={onSelectRecipe}
            variant={variant}
            chipOverflow={chipOverflow}
            facets={{
                facets,
                onToggle: (facet) =>
                    onActiveFacetsChange((current) =>
                        current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet],
                    ),
                onClear: () => onActiveFacetsChange(() => []),
            }}
            view={{ mode: viewMode, onChange: onViewModeChange }}
            sort={{ value: sort, onChange: onSortChange }}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                failed: query.isFetchNextPageError,
                onLoadMore: () => void query.fetchNextPage(),
            }}
            onCreateRecipe={onCreateRecipe}
            onPasteIngredients={onPasteIngredients}
            // ONE promise, N slots: `null` means no batch covers this recipe — render nothing.
            renderNutrition={(recipeId) => {
                const batch = nutritionFor(recipeId);

                return batch === null ? null : (
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                );
            }}
            // Pull-to-refresh (L8): the spinner tracks the in-flight refetch; pulling re-runs the read.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            refreshNotice={refreshNotice}
        />
    );
}
