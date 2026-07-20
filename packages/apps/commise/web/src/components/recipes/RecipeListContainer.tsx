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
    const [activeTags, setActiveTags] = useState<readonly string[]>([]);
    const query = useRecipes();

    const status = toListStatus(query.isLoading, query.isError);

    // All loaded rows, projected from the query cache (never copied into local state).
    const allItems = useMemo<readonly RecipeListItem[]>(
        () => (query.data?.data ?? []).map(toRecipeListItem),
        [query.data],
    );

    // The quick-filter facets (L4): the sorted union of tags across the loaded library, so the chip row
    // reflects what the caller actually has. Derived from the FULL set so a chip doesn't vanish when its own
    // filter empties the visible rows.
    const availableTags = useMemo(
        () => [...new Set(allItems.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)),
        [allItems],
    );

    // Narrow by the search term (client-side — `useRecipes` has no server query param) AND by every active
    // tag chip (a row must carry ALL selected tags).
    const recipes = useMemo<readonly RecipeListItem[]>(() => {
        const term = searchValue.trim().toLowerCase();

        return allItems.filter(
            (item) =>
                (term.length === 0 || item.title.toLowerCase().includes(term)) &&
                activeTags.every((tag) => item.tags.includes(tag)),
        );
    }, [allItems, searchValue, activeTags]);

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
                available: availableTags,
                active: activeTags,
                onToggle: (tag) =>
                    setActiveTags((current) =>
                        current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag],
                    ),
            }}
        />
    );
};
