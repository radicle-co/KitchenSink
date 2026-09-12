/**
 * Recipe-list screen (mobile, orchestration). The shared native recipe-list FRAME (title band + search field) around a suspense read
 * of the caller's library: `Suspense` renders `RecipeListLoading`, the error boundary renders `RecipeListLoadError`
 * (its retry refetches, and it keeps the create dial), and once settled the RESULTS render the facet chips, the rows
 * narrowed by the search term and chips with pull-to-refresh, and a notice for a failed refresh of them.
 *
 * The screen owns the search term and the active chips, because both outlive the boundary: typing while the library
 * loads, or pressing Try again, must not reset them. A retry from the refresh notice that succeeds moves the
 * screen-reader cursor to the heading; the notice is inside the boundary and the heading outside it, so the recovery
 * crosses as a `useRecoverySignal` counter. Community switching is the shell's Discover tab on mobile, so the frame
 * mounts no source switcher (L5 parity).
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    QUICK_TIME_FACET,
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    RecipeNutritionSlot,
    isListNarrowed,
    isQuickRecipe,
    matchesListFacet,
    toRecipeListItem,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

/** Props for {@link RecipeListScreen}. */
export interface RecipeListScreenProps {
    /** Invoked with the recipe id when a row is activated (the composing screen navigates to detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked when the create-recipe action is activated. */
    readonly onCreateRecipe?: () => void;
    /**
     * Invoked when the paste-ingredients destination is activated (plan U9).
     *
     * ⛔ Forwarded UNDEFAULTED, unlike `onCreateRecipe`'s `?? noop`: the shared dial removes the entry when this is
     * absent, and defaulting it to a no-op would render a destination that silently does nothing instead.
     */
    readonly onPasteIngredients?: () => void;
}

const noop = (): void => undefined;

/**
 * The recipe-list screen.
 *
 * @param props - Selection + create callbacks the composing screen wires to navigation.
 * @returns The frame around the read boundary.
 */
export function RecipeListScreen({
    onSelectRecipe,
    onCreateRecipe = noop,
    onPasteIngredients,
}: RecipeListScreenProps): JSX.Element {
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const recovery = useRecoverySignal();

    return (
        <RecipeListFrame searchValue={searchValue} onSearchChange={setSearchValue} headingFocusSignal={recovery.signal}>
            <QueryBoundary
                loading={<RecipeListLoading />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError
                        onRetry={resetErrorBoundary}
                        onCreateRecipe={onCreateRecipe}
                        onPasteIngredients={onPasteIngredients}
                    />
                )}
            >
                <SettledRecipeList
                    searchValue={searchValue}
                    activeFacets={activeFacets}
                    onActiveFacetsChange={setActiveFacets}
                    onSelectRecipe={onSelectRecipe}
                    onCreateRecipe={onCreateRecipe}
                    onPasteIngredients={onPasteIngredients}
                    onRecovered={recovery.onRecovered}
                />
            </QueryBoundary>
        </RecipeListFrame>
    );
}

/** Props for {@link SettledRecipeList}. */
interface SettledRecipeListProps {
    /** The frame's search term, which narrows the loaded rows by title. */
    readonly searchValue: string;
    /** The pressed quick-filter chips, each of which a row must satisfy. */
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: (update: (current: readonly string[]) => readonly string[]) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients?: () => void;
    /** Reports a retry from the refresh notice that succeeded, for the frame's heading. */
    readonly onRecovered: () => void;
}

/**
 * The library once it has settled: the chips derived from it, the rows the viewer's narrowing leaves, and one calorie
 * batch for the page.
 *
 * @param props - The viewer's narrowing and the intents to forward.
 * @returns The results over the loaded page.
 */
function SettledRecipeList({
    searchValue,
    activeFacets,
    onActiveFacetsChange,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    onRecovered,
}: SettledRecipeListProps): JSX.Element {
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(recipeQueries(client).list());
    // A failed pull or background refresh is the notice's; a suspense read throws into the boundary only when it has no
    // data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const rawRecipes = query.data.data;

    // Quick-filter facets (L4): the sorted union of the library's REAL dimensions — dietary flags + cuisine (parity with
    // the web container) — PLUS the fixed "Quick (<30m)" time-bucket chip (#4) when at least one loaded recipe qualifies
    // (`QUICK_TIME_FACET` leads — a fixed dimension, not data-driven). Favorites / AI-Generated from the mockup are
    // omitted (no backing data).
    const availableFacets = useMemo(() => {
        const facets = new Set<string>();
        let hasQuickRecipe = false;

        for (const recipe of rawRecipes) {
            recipe.dietaryFlags.forEach((flag) => facets.add(flag));

            if (recipe.cuisine !== undefined) {
                facets.add(recipe.cuisine);
            }

            if (isQuickRecipe(recipe.totalTimeMinutes)) {
                hasQuickRecipe = true;
            }
        }

        const sorted = [...facets].sort((a, b) => a.localeCompare(b));

        return hasQuickRecipe ? [QUICK_TIME_FACET, ...sorted] : sorted;
    }, [rawRecipes]);

    // The deferred calorie lookup (ADR-0021 §6): fire it the moment the page's ids are known — during render, so the
    // cards paint with their skeletons already waiting on an IN-FLIGHT request.
    //
    // ⛔ THE RAW PAGE, not the filtered rows below. Filtering is client-side and runs on every keystroke, so filtered ids
    // would change the query key (and the promise, and the request) per character typed, while every figure already on
    // screen fell back to its skeleton. The loaded page changes only when the query does.
    const nutritionFor = useRecipeNutritionBatches([rawRecipes.map((recipe) => recipe.id)]);

    // Filter by the title term AND every active facet chip (a row must satisfy ALL — dietary flag, cuisine, or the Quick
    // bucket).
    const recipes = useMemo(() => {
        const term = searchValue.trim().toLowerCase();

        return rawRecipes
            .filter(
                (recipe) =>
                    (term.length === 0 || recipe.title.toLowerCase().includes(term)) &&
                    activeFacets.every((facet) => matchesListFacet(recipe, facet)),
            )
            .map(toRecipeListItem);
    }, [rawRecipes, searchValue, activeFacets]);

    return (
        <RecipeListResults
            recipes={recipes}
            narrowed={isListNarrowed(searchValue, activeFacets)}
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe}
            onPasteIngredients={onPasteIngredients}
            // ONE promise, N slots: every card reads its own answer out of the SAME batch, so the page costs one
            // request and the figures land together. `null` means no batch covers this recipe — render nothing rather
            // than mounting a boundary with nothing to settle.
            renderNutrition={(recipeId) => {
                const batch = nutritionFor(recipeId);

                return batch === null ? null : (
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                );
            }}
            // Pull-to-refresh (L8): the spinner tracks the in-flight refetch; pulling re-runs the query.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            refreshNotice={refreshNotice}
            filters={{
                available: availableFacets,
                active: activeFacets,
                onToggle: (facet) =>
                    onActiveFacetsChange((current) =>
                        current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet],
                    ),
                onClear: () => onActiveFacetsChange(() => []),
            }}
        />
    );
}
