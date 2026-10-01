'use client';

/**
 * Container for the recipe-list route (orchestration): the shared recipe-list FRAME around a suspense read of the
 * caller's library.
 *
 * The frame (title band, source switcher, search field) sits outside the read boundary, so a pending or failed read
 * swaps only what is under the search field — never the field a cook is typing in. `Suspense` renders
 * `RecipeListLoading`, the error boundary renders `RecipeListLoadError` (its retry refetches, and it keeps the create
 * dial), and once settled the RESULTS render the facet chips, the rows narrowed by the search term and chips, and a
 * notice for a failed refresh of them. TanStack Query is the source of truth; the visible rows are derived from it.
 *
 * The container owns the search term and the active chips, because both outlive the boundary: typing while the library
 * loads, or pressing Try again, must not reset them. `/recipes` is server-prefetched, so the boundary is
 * `ClientQueryBoundary` with the prefetched key — a successful prefetch ships the rows in the server HTML, a failed one
 * ships the loading state and the browser reads after hydration (B19). A retry from the refresh notice that succeeds
 * moves focus to the frame's heading; the notice is inside the boundary and the heading outside it, so the recovery
 * crosses as a `useRecoverySignal` counter.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    QUICK_TIME_FACET,
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    isListNarrowed,
    isQuickRecipe,
    matchesListFacet,
    toRecipeListItem,
} from '@commise/features-recipes';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';

import { recipeSourceHrefs } from './sourceTabHref';

/** Props for {@link RecipeListContainer}. */
export interface RecipeListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** The library read the page prefetches and the results render. */
type RecipeListRead = ReturnType<ReturnType<typeof recipeQueries>['list']>;

/**
 * The live recipe-list container.
 *
 * @param props - The active locale.
 * @returns The frame around the read boundary.
 */
export const RecipeListContainer: FC<RecipeListContainerProps> = ({ locale }) => {
    const router = useRouter();
    const client = useRecipeServiceClient();
    const [searchValue, setSearchValue] = useState('');
    const [activeFacets, setActiveFacets] = useState<readonly string[]>([]);
    const recovery = useRecoverySignal();
    // Built ONCE and handed to both sides, so the key the boundary checks for a prefetch and the read it gates can never
    // drift apart.
    const read = recipeQueries(client).list();
    const onCreateRecipe = () => router.push(`/${locale}/recipes/new` as Route);
    // Plan U9's entry point. The dial was built to disclose a LIST of creation destinations precisely so a second one
    // costs this line rather than a redesign.
    const onPasteIngredients = () => router.push(`/${locale}/recipes/parse` as Route);

    return (
        <RecipeListFrame
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            // L5: "My Recipes" IS this list; "Community" is the discover surface. Both destinations are handed over as
            // routes, so the shared switcher renders real links, and `/discover` mounts the same switcher with
            // `active: 'community'` — the pair is symmetric by construction.
            tab={{ active: 'mine', href: recipeSourceHrefs(locale) }}
            headingFocusSignal={recovery.signal}
        >
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                loading={<RecipeListLoading />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError
                        onRetry={resetErrorBoundary}
                        onCreateRecipe={onCreateRecipe}
                        onPasteIngredients={onPasteIngredients}
                    />
                )}
            >
                <SettledRecipeList
                    read={read}
                    searchValue={searchValue}
                    activeFacets={activeFacets}
                    onActiveFacetsChange={setActiveFacets}
                    onSelectRecipe={(id) => router.push(`/${locale}/recipes/${id}` as Route)}
                    onCreateRecipe={onCreateRecipe}
                    onPasteIngredients={onPasteIngredients}
                    onRecovered={recovery.onRecovered}
                />
            </ClientQueryBoundary>
        </RecipeListFrame>
    );
};

/** Props for {@link SettledRecipeList}. */
interface SettledRecipeListProps {
    /** The library read the boundary gates — the same options object whose key it checked. */
    readonly read: RecipeListRead;
    /** The frame's search term, which narrows the loaded rows by title. */
    readonly searchValue: string;
    /** The pressed quick-filter chips, each of which a row must satisfy. */
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: (update: (current: readonly string[]) => readonly string[]) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients: () => void;
    /** Reports a retry from the refresh notice that succeeded, for the frame's heading. */
    readonly onRecovered: () => void;
}

/**
 * The library once it has settled: the chips derived from it, the rows the viewer's narrowing leaves, and one calorie
 * batch for the page.
 *
 * @param props - The read, the viewer's narrowing, and the intents to forward.
 * @returns The results over the loaded page.
 */
const SettledRecipeList: FC<SettledRecipeListProps> = ({
    read,
    searchValue,
    activeFacets,
    onActiveFacetsChange,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    onRecovered,
}) => {
    const query = useSuspenseQuery(read);
    // A failed refresh of the rows on screen is the notice's; a suspense read throws into the boundary only when it has
    // no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const rawRecipes = query.data.data;

    // Quick-filter facets (L4): the sorted union of the library's REAL filter dimensions — dietary flags + cuisine (the
    // same dimensions `/discover` facets on) — PLUS the fixed "Quick (<30m)" time-bucket chip (#4) when at least one
    // loaded recipe qualifies (`QUICK_TIME_FACET` leads, since it is a fixed dimension whose position must not shuffle
    // as data-driven facets come and go). The mockup's Favorites / AI-Generated chips are deliberately omitted: the
    // product has no favorites feature and no AI-generated source. Derived from the FULL set so a chip never vanishes
    // when its own filter empties the rows.
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

    // Narrow by the search term (client-side — the library list takes no query param) AND by every active facet chip.
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

    // The deferred calorie lookup (ADR-0021), started from the page the QUERY loaded — NOT the filtered rows. Batching
    // the visible rows would re-key the read on every keystroke and chip, blinking every figure back to its skeleton and
    // re-fetching the same recipes under a new key. ONE page ⇒ ONE request; each card gets a slot over that one promise.
    const recipeIds = useMemo(() => rawRecipes.map((recipe) => recipe.id), [rawRecipes]);
    const renderNutrition = useHydratedNutrition([recipeIds]);

    return (
        <RecipeListResults
            recipes={recipes}
            narrowed={isListNarrowed(searchValue, activeFacets)}
            onSelectRecipe={onSelectRecipe}
            onCreateRecipe={onCreateRecipe}
            onPasteIngredients={onPasteIngredients}
            refreshNotice={refreshNotice}
            renderNutrition={renderNutrition}
            filters={{
                available: availableFacets,
                active: activeFacets,
                onToggle: (facet) =>
                    onActiveFacetsChange((current) =>
                        current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet],
                    ),
                onClear: () => onActiveFacetsChange(() => []),
            }}
        />
    );
};
