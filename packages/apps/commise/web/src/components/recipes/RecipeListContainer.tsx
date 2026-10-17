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
 * decides the presentation: the container class of `<main>`, the cook's view (an account setting the page's server render
 * put in the cache, so the first render is the cook's choice) and so the card variant (`cardVariantOf`). The frame sits outside the boundary,
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
    ViewSaveFailedNotice,
    type ListViewMode,
} from '@commise/features-recipes';
import {
    useRecipeLibraryControls,
    useRecipeListPresentation,
    useSettledRecipeList,
    type RecipeLibraryControls,
    type RecipeListPresentation,
} from '@commise/features-recipes/list';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC, ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { pasteIngredientsHref } from '@/components/recipes/pasteIngredientsHref';
import { useHydratedNutrition } from '@/hooks/useHydratedNutrition';
import { useRecipeViewSetting } from '@/hooks/useRecipeViewSetting';

/** Props for {@link RecipeListContainer}. */
export interface RecipeListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /**
     * The large title's avatar (slice 3): the page hands in the app's `ProfileAvatarEntry`, so the profile read stays
     * where data enters the chrome and this container does not depend on the auth session.
     */
    readonly avatar?: ReactNode;
}

/**
 * The live My recipes container.
 *
 * @param props - The active locale and the large title's avatar.
 * @returns The frame around the read boundary.
 */
export const RecipeListContainer: FC<RecipeListContainerProps> = ({ locale, avatar }) => {
    const router = useRouter();
    const controls = useRecipeLibraryControls();
    // The cook's grid/list choice is an account setting (ADR-0059); the page's server render put it in the cache.
    const { viewChoice, chooseView, saveFailed } = useRecipeViewSetting();
    const recovery = useRecoverySignal();
    const presentation = useRecipeListPresentation(viewChoice);
    const onCreateRecipe = () => router.push(`/${locale}/recipes/new` as Route);
    // Paste lives in the editor's Ingredients section (slice 8): the new editor opens there with its sheet up.
    const onPasteIngredients = () => router.push(pasteIngredientsHref(locale) as Route);

    return (
        <RecipeListFrame
            {...(avatar === undefined ? {} : { headerAction: { kind: 'avatar', avatar } })}
            searchValue={controls.searchValue}
            onSearchChange={controls.onSearchChange}
            searchVisible={controls.searchVisible}
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
            {saveFailed ? <ViewSaveFailedNotice /> : null}
            <ClientQueryBoundary
                prefetchedKeys={[controls.read.queryKey]}
                loading={<RecipeListLoading variant={presentation.variant} />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError onRetry={resetErrorBoundary} onCreateRecipe={onCreateRecipe} />
                )}
            >
                <SettledRecipeList
                    locale={locale}
                    controls={controls}
                    presentation={presentation}
                    onViewModeChange={chooseView}
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
    readonly locale: string;
    readonly controls: RecipeLibraryControls;
    readonly presentation: RecipeListPresentation;
    readonly onViewModeChange: (mode: ListViewMode) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients: () => void;
    readonly onRecovered: () => void;
}

/**
 * The library once it has settled: the shared results props over the whole library, plus the web-only pieces — the
 * failed-refresh notice, the cards' links and one calorie batch per chunk.
 *
 * @param props - The viewer's narrowing and presentation, and the intents to forward.
 * @returns The results.
 */
const SettledRecipeList: FC<SettledRecipeListProps> = ({ locale, controls, onRecovered, ...rest }) => {
    const query = useSuspenseInfiniteQuery(controls.read);
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const { results, chunkIds } = useSettledRecipeList({ query, locale, controls, refreshNotice, ...rest });
    // One calorie batch per CHUNK, keyed by the loaded chunks (see `chunkIds`) so a keystroke never re-keys the read.
    const renderNutrition = useHydratedNutrition(chunkIds);

    return (
        <RecipeListResults {...results} hrefOf={(id) => `/${locale}/recipes/${id}`} renderNutrition={renderNutrition} />
    );
};
