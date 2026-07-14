/**
 * Public-recipe discovery screen (mobile, T076 / US2). Drives the shared native `RecipeDiscoveryList`
 * building block from `useSearchRecipes`, owning the search field and mapping the query's loading/error/ready
 * state to the view's status. Each row's Clone action runs `useCloneRecipe`; the mutation's in-flight
 * `variables` (the recipe id) drive the per-row busy state so exactly the row being cloned shows progress.
 * Remote state stays in the query cache — the screen derives its view state and never copies it.
 */
import { RecipeDiscoveryList, type RecipeDiscoveryStatus } from '@commise/features-recipes';
import { useSearchRecipes, useCloneRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeSearchParams } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link RecipeDiscoveryScreen}. */
export interface RecipeDiscoveryScreenProps {
    /** Invoked with a recipe id when a discovery row is activated (the navigator opens its detail). */
    readonly onSelectRecipe: (id: string) => void;
}

/**
 * The public-discovery screen.
 *
 * @param props - The selection callback the navigator wires to detail navigation.
 * @returns The discovery browse/search view with per-row clone.
 */
export function RecipeDiscoveryScreen({ onSelectRecipe }: RecipeDiscoveryScreenProps): JSX.Element {
    const [searchValue, setSearchValue] = useState('');
    const trimmed = searchValue.trim();
    const params: RecipeSearchParams = trimmed.length > 0 ? { query: trimmed } : {};

    const search = useSearchRecipes(params);
    const clone = useCloneRecipe();

    const status: RecipeDiscoveryStatus = search.isError ? 'error' : search.isLoading ? 'loading' : 'ready';
    const cloningId = clone.isPending ? (clone.variables ?? null) : null;

    return (
        <RecipeDiscoveryList
            status={status}
            results={search.data?.results ?? []}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSelectRecipe={onSelectRecipe}
            onClone={(id) => clone.mutate(id)}
            onRetry={() => void search.refetch()}
            cloningId={cloningId}
        />
    );
}
