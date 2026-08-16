'use client';

/**
 * Container for the recipe-list route: binds the shared, presentational `RecipeList` building block to
 * live data. It reads the caller's recipes via `useRecipes`, projects the query state onto
 * `RecipeListViewProps` (loading / error / ready), owns the search-box state (filtering the loaded page
 * client-side by title), and wires navigation + retry. It holds no server data of its own — TanStack
 * Query is the source of truth for the remote list; the visible rows are derived from it.
 */
import {
    QUICK_TIME_FACET,
    RecipeList,
    RecipeNutritionSlot,
    isQuickRecipe,
    matchesListFacet,
    toRecipeListItem,
} from '@commise/features-recipes';
import type { RecipeListItem } from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { toQueryStatus } from '@commise/features-core';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import type { FC } from 'react';

import { recipeSourceHrefs } from './sourceTabHref';

/** Props for {@link RecipeListContainer}. */
export interface RecipeListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live recipe-list container.
 *
 * @param props - The active locale.
 * @returns The wired {@link RecipeList}.
 */
export const RecipeListContainer: FC<RecipeListContainerProps> = ({ locale }) => {
    const router = useRouter();
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const query = useRecipes();

    const status = toQueryStatus(query.isLoading, query.isError);

    // The raw loaded rows from the query cache (never copied into local state). Filtering runs on these
    // because the quick-filter facets read `dietaryFlags` + `cuisine`, which live on the DTO but not the card
    // view-model — no need to bloat the card model just to filter.
    const rawRecipes = useMemo(() => query.data?.data ?? [], [query.data]);

    // Quick-filter facets (L4): the sorted union of the library's REAL filter dimensions — dietary flags +
    // cuisine (the same dimensions `/discover` facets on) — PLUS the fixed "Quick (<30m)" time-bucket chip
    // (#4) when at least one loaded recipe qualifies (`QUICK_TIME_FACET` leads the list since it is a fixed
    // dimension, not data-driven, so its position never shuffles as data-driven facets come and go). The
    // mockup's Favorites / AI-Generated chips are deliberately omitted: the product has no favorites feature
    // and no AI-generated source, so they would be dead controls. Derived from the FULL set so a chip never
    // vanishes when its own filter empties the rows.
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

    // Narrow by the search term (client-side — `useRecipes` has no server query param) AND by every active
    // facet chip (a row must satisfy ALL selected facets — a dietary flag, the cuisine, or the Quick bucket).
    const recipes = useMemo<readonly RecipeListItem[]>(() => {
        const term = searchValue.trim().toLowerCase();

        return rawRecipes
            .filter(
                (recipe) =>
                    (term.length === 0 || recipe.title.toLowerCase().includes(term)) &&
                    activeFacets.every((facet) => matchesListFacet(recipe, facet)),
            )
            .map(toRecipeListItem);
    }, [rawRecipes, searchValue, activeFacets]);

    // The deferred calorie lookup (ADR-0021), started from the page the QUERY loaded — `rawRecipes`, NOT the
    // filtered `recipes` below. Filtering is a view concern over an already-loaded page: batching the visible
    // rows would re-key the read on every keystroke and every facet chip, so every chip on screen would blink
    // back to its skeleton as the viewer types, and the same recipes would be re-fetched under a new key.
    // ONE page ⇒ ONE request; each card gets a slot over that one promise.
    const recipeIds = useMemo(() => rawRecipes.map((recipe) => recipe.id), [rawRecipes]);
    const nutritionFor = useRecipeNutritionBatches([recipeIds]);
    const renderNutrition = useCallback(
        (recipeId: string) => {
            const batch = nutritionFor(recipeId);

            // `null` means no page on screen carries this recipe — we never asked, so the card says nothing
            // rather than mounting a boundary with no promise to settle (a skeleton that renders forever).
            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [nutritionFor],
    );

    return (
        <RecipeList
            status={status}
            recipes={recipes}
            renderNutrition={renderNutrition}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
            onRetry={() => void query.refetch()}
            // L5: "My Recipes" IS this list; "Community" is the discover surface. Both destinations are handed
            // over as routes, so the shared switcher renders real links — the strip used to push `/discover`
            // from a `<button>` with `active` hardcoded to `'mine'`, which is why the far side had no way
            // back. `/discover` now mounts the same switcher with `active: 'community'`, and the pair is
            // symmetric by construction.
            tab={{ active: 'mine', href: recipeSourceHrefs(locale) }}
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
};
