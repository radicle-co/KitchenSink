'use client';

/**
 * Container for the My recipes route (orchestration, `docs/design/uiOverhaul/buildSpec.md` §4.3): the shared list
 * FRAME around a suspense read of the cook's whole library.
 *
 * The library is read with `recipeQueries(client).library` — chunks of up to 500 recipes — because the search and the
 * chips narrow it on the device: over one server page of 20 they misreported every count past the first page
 * (`docs/architecture/uiOverhaulBlueprint.md` A11). The sort is the server's (`sortBy`), so it is correct across chunks;
 * a new sort is a new key, read under `useDeferredValue` so the cards on screen stay until the new order lands.
 *
 * The container owns what outlives the boundary — the search term, the chips, the sort and the list/grid choice — and
 * decides the presentation: the container class of `<main>`, the stored view (a cookie the page reads on the server, so
 * the first render is the cook's choice) and so the card variant (`cardVariantOf`). The frame sits outside the boundary,
 * so a pending or failed read never unmounts the field a cook is typing in; it hides the field on a settled empty
 * library, read through a cache-only observer of the same key.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    cardVariantOf,
    useMainContainerClass,
    viewModeCookieFor,
    viewModeOf,
    type CardVariant,
    type ListViewMode,
} from '@commise/features-recipes';
import { useRecipeLibrary, useRecipeLibraryControls, type LibraryRead } from '@commise/features-recipes/list';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { ChipRowOverflow } from '@commise/ui/chip';
import type { RecipeListSortBy } from '@kitchensink/recipe-service-client';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FC, ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { pasteIngredientsHref } from '@/components/recipes/pasteIngredientsHref';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';

/** Props for {@link RecipeListContainer}. */
export interface RecipeListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The cook's list/grid choice, read from its cookie on the server. Absent → the width's default. */
    readonly storedViewMode?: ListViewMode;
    /**
     * The large title's avatar (slice 3): the page hands in the app's `ProfileAvatarEntry`, so the profile read stays
     * where data enters the chrome and this container does not depend on the auth session.
     */
    readonly avatar?: ReactNode;
}

/**
 * The live My recipes container.
 *
 * @param props - The active locale and the stored view.
 * @returns The frame around the read boundary.
 */
export const RecipeListContainer: FC<RecipeListContainerProps> = ({ locale, storedViewMode, avatar }) => {
    const router = useRouter();
    const {
        searchValue,
        onSearchChange,
        onClearSearch,
        searchVisible,
        activeFacets,
        onActiveFacetsChange,
        sort,
        onSortChange,
        read,
    } = useRecipeLibraryControls();
    const [viewChoice, setViewChoice] = useState<ListViewMode | undefined>(storedViewMode);
    const recovery = useRecoverySignal();
    const container = useMainContainerClass();
    const viewMode = viewModeOf(viewChoice, container);
    const variant = cardVariantOf(container, viewMode, 'library');
    const onCreateRecipe = () => router.push(`/${locale}/recipes/new` as Route);
    // Paste lives in the editor's Ingredients section (slice 8): the new editor opens there with its sheet up.
    const onPasteIngredients = () => router.push(pasteIngredientsHref(locale) as Route);

    return (
        <RecipeListFrame
            {...(avatar === undefined ? {} : { headerAction: { kind: 'avatar', avatar } })}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            searchVisible={searchVisible}
            segments={{
                current: 'mine',
                href: { mine: `/${locale}/recipes`, collections: `/${locale}/collections` },
                onSelect: (segment) => {
                    if (segment === 'collections') {
                        router.push(`/${locale}/collections` as Route);
                    }
                },
            }}
            headingFocusSignal={recovery.signal}
        >
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                loading={<RecipeListLoading variant={variant} />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError onRetry={resetErrorBoundary} onCreateRecipe={onCreateRecipe} />
                )}
            >
                <SettledRecipeList
                    read={read}
                    locale={locale}
                    searchValue={searchValue}
                    onClearSearch={onClearSearch}
                    activeFacets={activeFacets}
                    onActiveFacetsChange={onActiveFacetsChange}
                    sort={sort}
                    onSortChange={onSortChange}
                    viewMode={viewMode}
                    onViewModeChange={(mode) => {
                        setViewChoice(mode);
                        // The cookie the page reads on the server, so the next visit renders this view first.
                        document.cookie = viewModeCookieFor(mode);
                    }}
                    variant={variant}
                    chipOverflow={container === 'narrow' ? 'scroll' : 'wrap'}
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
    readonly read: LibraryRead;
    readonly locale: string;
    readonly searchValue: string;
    readonly onClearSearch: () => void;
    readonly activeFacets: readonly string[];
    readonly onActiveFacetsChange: (update: (current: readonly string[]) => readonly string[]) => void;
    readonly sort: RecipeListSortBy;
    readonly onSortChange: (sort: RecipeListSortBy) => void;
    readonly viewMode: ListViewMode;
    readonly onViewModeChange: (mode: ListViewMode) => void;
    readonly variant: CardVariant;
    readonly chipOverflow: ChipRowOverflow;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients: () => void;
    readonly onRecovered: () => void;
}

/**
 * The library once it has settled: the facets and their counts over the whole library, the rows the narrowing leaves,
 * the state they put the results in, and one calorie batch per chunk.
 *
 * @param props - The read, the viewer's narrowing and presentation, and the intents to forward.
 * @returns The results.
 */
const SettledRecipeList: FC<SettledRecipeListProps> = ({
    read,
    locale,
    searchValue,
    onClearSearch,
    activeFacets,
    onActiveFacetsChange,
    sort,
    onSortChange,
    viewMode,
    onViewModeChange,
    variant,
    chipOverflow,
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    onRecovered,
}) => {
    const query = useSuspenseInfiniteQuery(read);
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const library = useRecipeLibrary({ query, locale, searchValue, activeFacets, onActiveFacetsChange });
    // One calorie batch per CHUNK, keyed by the loaded chunks (see `chunkIds`) so a keystroke never re-keys the read.
    const renderNutrition = useHydratedNutrition(library.chunkIds);

    return (
        <RecipeListResults
            recipes={library.recipes}
            state={library.state}
            searchValue={searchValue}
            onClearSearch={onClearSearch}
            clearCount={library.clearCount}
            onClearFilters={library.onClearFilters}
            onSelectRecipe={onSelectRecipe}
            hrefOf={(id) => `/${locale}/recipes/${id}`}
            variant={variant}
            chipOverflow={chipOverflow}
            facets={library.facets}
            view={{ mode: viewMode, onChange: onViewModeChange }}
            sort={{ value: sort, onChange: onSortChange }}
            loadMore={library.loadMore}
            onCreateRecipe={onCreateRecipe}
            onPasteIngredients={onPasteIngredients}
            refreshNotice={refreshNotice}
            renderNutrition={renderNutrition}
        />
    );
};
