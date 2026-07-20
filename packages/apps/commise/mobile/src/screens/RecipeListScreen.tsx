/**
 * Recipe-list screen (mobile). The container that drives the shared, presentational native `RecipeList`
 * building block from the typed `useRecipes` query: it maps the query's loading/error/ready state to the
 * view's `status`, owns the search field, derives the (client-side) filtered rows from the loaded page,
 * and forwards selection / create / retry intents upward. It performs no rendering of its own — the view
 * lives in `@commise/features-recipes`, shared with web.
 */
import { RecipeList, toRecipeListItem, type RecipeListStatus } from '@commise/features-recipes';
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
    const [activeTags, setActiveTags] = useState<readonly string[]>([]);
    const query = useRecipes();

    const status: RecipeListStatus = query.isError ? 'error' : query.isLoading ? 'loading' : 'ready';

    // Derive the rows from the query cache (never copy server data into local state).
    const allItems = useMemo(() => (query.data ? query.data.data.map(toRecipeListItem) : []), [query.data]);

    // Quick-filter facets (L4): the sorted union of the loaded library's tags (parity with the web container).
    const availableTags = useMemo(
        () => [...new Set(allItems.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)),
        [allItems],
    );

    // Filter the loaded page by the title term AND every active tag chip (a row must carry ALL selected tags).
    const recipes = useMemo(() => {
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
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe ?? noop}
            onRetry={() => void query.refetch()}
            // Community switching is the shell's Discover tab on mobile, so no in-list tab here (L5 parity).
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
}
