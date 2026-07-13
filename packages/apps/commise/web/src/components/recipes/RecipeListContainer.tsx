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
    const query = useRecipes();

    const status = toListStatus(query.isLoading, query.isError);

    // Derive the visible rows from the query cache (never copied into local state) and narrow them by the
    // search term. `useRecipes` has no server-side query param, so search filters the loaded page here;
    // full-text search across the whole library is a follow-up via `useSearchRecipes` (see notes).
    const recipes = useMemo<readonly RecipeListItem[]>(() => {
        const items = (query.data?.data ?? []).map(toRecipeListItem);
        const term = searchValue.trim().toLowerCase();

        if (term.length === 0) {
            return items;
        }

        return items.filter((item) => item.title.toLowerCase().includes(term));
    }, [query.data, searchValue]);

    return (
        <RecipeList
            status={status}
            recipes={recipes}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
            onRetry={() => void query.refetch()}
        />
    );
};
