/**
 * Recipe-list screen (mobile). The container that drives the shared, presentational native `RecipeList`
 * building block from the typed `useRecipes` query: it maps the query's loading/error/ready state to the
 * view's `status`, owns the search field, derives the (client-side) filtered rows from the loaded page,
 * and forwards selection / create / retry intents upward. It performs no rendering of its own — the view
 * lives in `@commise/features-recipes`, shared with web.
 */
import {
    QUICK_TIME_FACET,
    RecipeList,
    RecipeNutritionSlot,
    isQuickRecipe,
    matchesListFacet,
    toRecipeListItem,
    type RecipeListStatus,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

/** Props for {@link RecipeListScreen}. */
export interface RecipeListScreenProps {
    /** Invoked with the recipe id when a row is activated (the composing screen navigates to detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked when the create-recipe action is activated. */
    readonly onCreateRecipe?: () => void;
}

const noop = (): void => undefined;

/**
 * The recipe-list screen.
 *
 * @param props - Selection + create callbacks the composing screen wires to navigation.
 * @returns The rendered list view.
 */
export function RecipeListScreen({ onSelectRecipe, onCreateRecipe }: RecipeListScreenProps): JSX.Element {
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const query = useRecipes();

    const status: RecipeListStatus = query.isError ? 'error' : query.isLoading ? 'loading' : 'ready';

    // The raw loaded rows (never copy server data into local state). Facets read `dietaryFlags` + `cuisine`
    // from the DTO, so filtering runs on the raw rows before projecting to card view-models.
    const rawRecipes = useMemo(() => (query.data ? query.data.data : []), [query.data]);

    // Quick-filter facets (L4): the sorted union of the library's REAL dimensions — dietary flags + cuisine
    // (parity with the web container) — PLUS the fixed "Quick (<30m)" time-bucket chip (#4) when at least one
    // loaded recipe qualifies (`QUICK_TIME_FACET` leads the list — a fixed dimension, not data-driven).
    // Favorites / AI-Generated from the mockup are omitted (no backing data).
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

    // The deferred calorie lookup (ADR-0021 §6): fire it the moment the page's ids are known — during render,
    // so the cards paint with their skeletons already waiting on an IN-FLIGHT request rather than starting one
    // after the first paint.
    //
    // ⛔ THE RAW PAGE, not the filtered rows below. Filtering is client-side and runs on every keystroke, so
    // filtered ids would change the query key (and the promise, and the request) per character typed, while
    // every figure already on screen fell back to its skeleton. The loaded page changes only when the query
    // does.
    const nutritionFor = useRecipeNutritionBatches([rawRecipes.map((recipe) => recipe.id)]);

    // Filter by the title term AND every active facet chip (a row must satisfy ALL — dietary flag, cuisine,
    // or the Quick bucket).
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
        <RecipeList
            status={status}
            recipes={recipes}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe ?? noop}
            onRetry={() => void query.refetch()}
            // ONE promise, N slots: every card reads its own answer out of the SAME batch, so the page costs
            // one request and the figures land together. `null` means no batch covers this recipe — render
            // nothing rather than mounting a boundary with nothing to settle.
            renderNutrition={(recipeId) => {
                const batch = nutritionFor(recipeId);

                return batch === null ? null : (
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                );
            }}
            // Pull-to-refresh (L8): the spinner tracks the in-flight refetch; pulling re-runs the query.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            // Community switching is the shell's Discover tab on mobile, so no in-list tab here (L5 parity).
            filters={{
                available: availableFacets,
                active: activeFacets,
                onToggle: (facet) =>
                    setActiveFacets((current) =>
                        current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet],
                    ),
                onClear: () => setActiveFacets([]),
            }}
        />
    );
}
