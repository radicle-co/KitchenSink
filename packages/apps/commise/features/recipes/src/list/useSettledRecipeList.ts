'use client';

/**
 * @module @commise/features-recipes/list — the props the SETTLED library hands `RecipeListResults`, shared by web's
 * `RecipeListContainer` and mobile's `RecipeListScreen`.
 *
 * Both hosts read the same infinite query, project it with {@link useRecipeLibrary}, and spread the same dozen props
 * onto the results. The host keeps what differs by platform and so cannot be in here: the read boundary, where the
 * view choice is kept, the failed-refresh notice (`@commise/query`, which this package may not import — the host reads
 * it from the same query and passes it in), the calorie renderer, `hrefOf` (web), and pull-to-refresh and the scroll
 * bind (native).
 *
 * @pattern Headless hook — assembles the results' props from the library projection, the viewer's controls and the
 *     host's presentation and intents
 */
import type { RecipeListResultsProps } from './model.js';
import type { RecipeListPresentation } from './useRecipeListPresentation.js';
import { useRecipeLibrary, type LibraryQuery, type RecipeLibraryModel } from './useRecipeLibrary.js';
import type { RecipeLibraryControls } from './useRecipeLibraryControls.js';

/** What {@link useSettledRecipeList} reads. */
export interface SettledRecipeListInput {
    /** The library's infinite query (`useSuspenseInfiniteQuery(read)`). */
    readonly query: LibraryQuery;
    /** The viewer's locale, whose case rules set the chips' labels. */
    readonly locale: string;
    /** The viewer's narrowing and sort, from {@link RecipeLibraryControls}. */
    readonly controls: Pick<
        RecipeLibraryControls,
        'searchValue' | 'onClearSearch' | 'activeFacets' | 'onActiveFacetsChange' | 'sort' | 'onSortChange'
    >;
    /** How the results present, from `useRecipeListPresentation`. */
    readonly presentation: RecipeListPresentation;
    /** Stores the cook's list/grid choice (a cookie on web, device storage on mobile). */
    readonly onViewModeChange: (mode: RecipeListPresentation['viewMode']) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    /** Forwarded UNDEFAULTED: the first run removes the button when this is absent. */
    readonly onPasteIngredients: (() => void) | undefined;
    /** The failed-refresh notice the host read from the same query, or `undefined`. */
    readonly refreshNotice: RecipeListResultsProps['refreshNotice'];
}

/** The results' props the platforms share, and the chunk ids the host's calorie batches key on. */
export interface SettledRecipeList {
    readonly results: Omit<RecipeListResultsProps, 'hrefOf' | 'renderNutrition' | 'refresh' | 'scrollBind'>;
    /** See {@link RecipeLibraryModel.chunkIds}: key the batches by THESE, never the narrowed rows. */
    readonly chunkIds: RecipeLibraryModel['chunkIds'];
}

/**
 * Assemble the settled library's results props.
 *
 * @param input - The query, the viewer's controls, the presentation and the host's intents.
 * @returns The shared results props and the loaded chunk ids.
 */
export function useSettledRecipeList({
    query,
    locale,
    controls,
    presentation,
    onViewModeChange,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    refreshNotice,
}: SettledRecipeListInput): SettledRecipeList {
    const { searchValue, onClearSearch, activeFacets, onActiveFacetsChange, sort, onSortChange } = controls;
    const library = useRecipeLibrary({ query, locale, searchValue, activeFacets, onActiveFacetsChange });

    return {
        chunkIds: library.chunkIds,
        results: {
            recipes: library.recipes,
            state: library.state,
            searchValue,
            onClearSearch,
            clearCount: library.clearCount,
            onClearFilters: library.onClearFilters,
            onSelectRecipe,
            variant: presentation.variant,
            chipOverflow: presentation.chipOverflow,
            facets: library.facets,
            view: { mode: presentation.viewMode, onChange: onViewModeChange },
            sort: { value: sort, onChange: onSortChange },
            loadMore: library.loadMore,
            onCreateRecipe,
            onPasteIngredients,
            refreshNotice,
        },
    };
}
