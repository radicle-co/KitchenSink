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
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const query = useRecipes();

    const status: RecipeListStatus = query.isError ? 'error' : query.isLoading ? 'loading' : 'ready';

    // The raw loaded rows (never copy server data into local state). Facets read `dietaryFlags` + `cuisine`
    // from the DTO, so filtering runs on the raw rows before projecting to card view-models.
    const rawRecipes = useMemo(() => (query.data ? query.data.data : []), [query.data]);

    // Quick-filter facets (L4): the sorted union of the library's REAL dimensions — dietary flags + cuisine
    // (parity with the web container). Favorites / AI-Generated from the mockup are omitted (no backing data).
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

    // Filter by the title term AND every active facet chip (a row must satisfy ALL — dietary flag OR cuisine).
    const recipes = useMemo(() => {
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
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe ?? noop}
            onRetry={() => void query.refetch()}
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
