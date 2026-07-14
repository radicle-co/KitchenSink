'use client';

/**
 * Container for the public-discovery route: binds the shared, presentational `RecipeDiscoveryList` building
 * block to live data. It owns the search-box state, projects `useSearchRecipes({ query })` onto the block's
 * three top-level states (loading / error / ready) and its result rows, and wires the per-row clone and
 * recipe-selection actions. Cloning a public recipe runs `useCloneRecipe` and, on success, navigates to the
 * caller's freshly-cloned copy; the row whose clone is in flight is busied via `cloningId`. It holds no
 * server data of its own — TanStack Query is the source of truth for the remote search results.
 */
import { RecipeDiscoveryList } from '@commise/features-recipes';
import type { RecipeDiscoveryStatus } from '@commise/features-recipes';
import type { RecipeSearchParams } from '@kitchensink/recipe-core';
import { useCloneRecipe, useSearchRecipes } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { FC } from 'react';

/** Props for {@link RecipeDiscoveryContainer}. */
export interface RecipeDiscoveryContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** Map a TanStack Query state onto the discovery view's three top-level states. */
function toDiscoveryStatus(isLoading: boolean, isError: boolean): RecipeDiscoveryStatus {
    if (isLoading) {
        return 'loading';
    }

    if (isError) {
        return 'error';
    }

    return 'ready';
}

/**
 * The live public-discovery container.
 *
 * @param props - The active locale.
 * @returns The wired {@link RecipeDiscoveryList}.
 */
export const RecipeDiscoveryContainer: FC<RecipeDiscoveryContainerProps> = ({ locale }) => {
    const router = useRouter();
    const [searchValue, setSearchValue] = useState('');

    // Only send a `query` param once the user has typed something meaningful, so the initial load browses
    // all public recipes (an empty/whitespace term is "no filter", not a search for the empty string).
    const params = useMemo<RecipeSearchParams>(() => {
        const term = searchValue.trim();

        return term.length === 0 ? {} : { query: searchValue };
    }, [searchValue]);

    const query = useSearchRecipes(params);
    const clone = useCloneRecipe();

    const status = toDiscoveryStatus(query.isLoading, query.isError);
    const results = query.data?.results ?? [];
    const cloningId = clone.isPending ? clone.variables : null;

    return (
        <RecipeDiscoveryList
            status={status}
            results={results}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
            onClone={(id) =>
                clone.mutate(id, {
                    onSuccess: (recipe) => router.push(`/${locale}/recipes/${recipe.id}` as Route),
                })
            }
            onRetry={() => void query.refetch()}
            cloningId={cloningId}
        />
    );
};
