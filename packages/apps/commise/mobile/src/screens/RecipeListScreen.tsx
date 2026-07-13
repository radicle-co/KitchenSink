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
    const query = useRecipes();

    const status: RecipeListStatus = query.isError ? 'error' : query.isLoading ? 'loading' : 'ready';

    // Derive the rows from the query cache (never copy server data into local state) and filter the loaded
    // page by title client-side. Server-side text search (`useSearchRecipes`) is the follow-up when search
    // needs to reach beyond the current page.
    const recipes = useMemo(() => {
        const items = query.data ? query.data.data.map(toRecipeListItem) : [];
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
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe ?? noop}
            onRetry={() => void query.refetch()}
        />
    );
}
