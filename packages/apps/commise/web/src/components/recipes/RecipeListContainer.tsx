'use client';

/**
 * Container for the recipe-list route: binds the shared, presentational `RecipeList` building block to
 * live data. It reads the caller's recipes via `useRecipes`, projects the query state onto
 * `RecipeListViewProps` (loading / error / ready), owns the search-box state (filtering the loaded page
 * client-side by title), and wires navigation + retry. It holds no server data of its own — TanStack
 * Query is the source of truth for the remote list; the visible rows are derived from it.
 */
import { RecipeList, toRecipeListItem } from '@commise/features-recipes';
import type { RecipeListItem, RecipeListStatus } from '@commise/features-recipes';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { FC } from 'react';

/** Props for {@link RecipeListContainer}. */
export interface RecipeListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** Map a TanStack Query state onto the list view's three top-level states. */
function toListStatus(isLoading: boolean, isError: boolean): RecipeListStatus {
    if (isLoading) {
        return 'loading';
    }

    if (isError) {
        return 'error';
    }

    return 'ready';
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

    const status = toListStatus(query.isLoading, query.isError);

    // The raw loaded rows from the query cache (never copied into local state). Filtering runs on these
    // because the quick-filter facets read `dietaryFlags` + `cuisine`, which live on the DTO but not the card
    // view-model — no need to bloat the card model just to filter.
    const rawRecipes = useMemo(() => query.data?.data ?? [], [query.data]);

    // Quick-filter facets (L4): the sorted union of the library's REAL filter dimensions — dietary flags +
    // cuisine (the same dimensions `/discover` facets on). The mockup's Favorites / AI-Generated chips are
    // deliberately omitted: the product has no favorites feature and no AI-generated source, so they would be
    // dead controls. Derived from the FULL set so a chip never vanishes when its own filter empties the rows.
    const availableFacets = useMemo(() => {
        const facets = new Set<string>();

        for (const recipe of rawRecipes) {
            recipe.dietaryFlags.forEach((flag) => facets.add(flag));

            if (recipe.cuisine !== undefined) {
                facets.add(recipe.cuisine);
            }
        }

        return [...facets].sort((a, b) => a.localeCompare(b));
    }, [rawRecipes]);

    // Narrow by the search term (client-side — `useRecipes` has no server query param) AND by every active
    // facet chip (a row must satisfy ALL selected facets, matching a dietary flag OR the cuisine).
    const recipes = useMemo<readonly RecipeListItem[]>(() => {
        const term = searchValue.trim().toLowerCase();

        return rawRecipes
            .filter(
                (recipe) =>
                    (term.length === 0 || recipe.title.toLowerCase().includes(term)) &&
                    activeFacets.every((facet) => recipe.dietaryFlags.includes(facet) || recipe.cuisine === facet),
            )
            .map(toRecipeListItem);
    }, [rawRecipes, searchValue, activeFacets]);

    return (
        <RecipeList
            status={status}
            recipes={recipes}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
            onRetry={() => void query.refetch()}
            // L5: "My Recipes" is this list; "Community" browses public recipes on the discover surface (the
            // same model the mobile shell uses — functional parity, not identical chrome).
            tab={{
                active: 'mine',
                onChange: (next) => {
                    if (next === 'community') {
                        router.push(`/${locale}/discover` as Route);
                    }
                },
            }}
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
