/**
 * Recipe-list screen (mobile, orchestration). The shared native recipe-list FRAME (title band + search field) around a suspense read
 * of the caller's library: `Suspense` renders `RecipeListLoading`, the error boundary renders `RecipeListLoadError`
 * (its retry refetches, and it keeps the create button), and once settled the RESULTS render the facet chips, the rows
 * narrowed by the search term and chips with pull-to-refresh, and a notice for a failed refresh of them.
 *
 * The screen owns the search term and the active chips, because both outlive the boundary: typing while the library
 * loads, or pressing Try again, must not reset them. A retry from the refresh notice that succeeds moves the
 * screen-reader cursor to the heading; the notice is inside the boundary and the heading outside it, so the recovery
 * crosses as a `useRecoverySignal` counter. Community switching is the shell's Discover tab on mobile, so the frame
 * mounts no source switcher (L5 parity).
 *
 * Slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.3): the screen reads the WHOLE library in
 * chunks of up to 500 (`recipeQueries(client).library`), so the chips, their counts and the no-match states are right
 * past the first page (blueprint A11); forwards the sort to the server; keeps the list/grid choice per device; and
 * decides the card variant from the container class. The My recipes · Collections segments are the host's to pass
 * (`segments`), with the large title's avatar (`headerAction`).
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    nutritionSlotRenderer,
    type ListViewMode,
    type RecipesSegmentControl,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import {
    useRecipeLibraryControls,
    useRecipeListPresentation,
    useSettledRecipeList,
    type RecipeLibraryControls,
    type RecipeListPresentation,
} from '@commise/features-recipes/list';
import { useLocale } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import { useStoredViewMode } from '../hooks/useStoredViewMode.js';

/** Props for {@link RecipeListScreen}. */
export interface RecipeListScreenProps {
    /** Invoked with the recipe id when a row is activated (the composing screen navigates to detail). */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked when the create-recipe action is activated. Required, as on web: an optional handler leaves a dead button. */
    readonly onCreateRecipe: () => void;
    /**
     * The first run's Paste ingredients: the new editor at Ingredients with its paste sheet open (build spec §7.5.4).
     *
     * ⛔ Forwarded UNDEFAULTED: the first run removes the button when this is absent, and defaulting it to a no-op
     * would render a button that silently does nothing instead.
     */
    readonly onPasteIngredients?: () => void;
    /** The My recipes · Collections segments, when the host shows them on this screen. */
    readonly segments?: RecipesSegmentControl;
    /** The large title's action: the avatar, which pushes Profile (slice 3). The route supplies it. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
}

/**
 * The recipe-list screen.
 *
 * @param props - Selection and create callbacks the composing screen wires to navigation.
 * @returns The frame around the read boundary.
 */
export function RecipeListScreen({
    onSelectRecipe,
    onCreateRecipe,
    onPasteIngredients,
    segments,
    headerAction,
    scrollBind,
}: RecipeListScreenProps): JSX.Element {
    const controls = useRecipeLibraryControls();
    const [viewChoice, setViewChoice] = useStoredViewMode();
    const recovery = useRecoverySignal();
    const presentation = useRecipeListPresentation(viewChoice);

    return (
        <RecipeListFrame
            searchValue={controls.searchValue}
            onSearchChange={controls.onSearchChange}
            searchVisible={controls.searchVisible}
            {...(segments === undefined ? {} : { segments })}
            {...(headerAction === undefined ? {} : { headerAction })}
            headingFocusSignal={recovery.signal}
        >
            <QueryBoundary
                loading={<RecipeListLoading variant={presentation.variant} />}
                renderError={({ resetErrorBoundary }) => (
                    <RecipeListLoadError onRetry={resetErrorBoundary} onCreateRecipe={onCreateRecipe} />
                )}
            >
                <SettledRecipeList
                    controls={controls}
                    presentation={presentation}
                    onViewModeChange={setViewChoice}
                    onSelectRecipe={onSelectRecipe}
                    onCreateRecipe={onCreateRecipe}
                    onPasteIngredients={onPasteIngredients}
                    onRecovered={recovery.onRecovered}
                    scrollBind={scrollBind}
                />
            </QueryBoundary>
        </RecipeListFrame>
    );
}

/** Props for {@link SettledRecipeList}. */
interface SettledRecipeListProps {
    readonly controls: RecipeLibraryControls;
    readonly presentation: RecipeListPresentation;
    readonly onViewModeChange: (mode: ListViewMode) => void;
    readonly onSelectRecipe: (id: string) => void;
    readonly onCreateRecipe: () => void;
    readonly onPasteIngredients?: () => void;
    readonly onRecovered: () => void;
    readonly scrollBind: ScrollBind | undefined;
}

/**
 * The library once it has settled: the shared results props over the whole library, plus the native-only pieces — the
 * failed-refresh notice, pull-to-refresh, the scroll bind and one calorie batch per chunk.
 *
 * @param props - The viewer's narrowing and presentation, and the intents to forward.
 * @returns The results.
 */
function SettledRecipeList({
    controls,
    onRecovered,
    scrollBind,
    onPasteIngredients,
    ...rest
}: SettledRecipeListProps): JSX.Element {
    const viewerLocale = useLocale();
    const query = useSuspenseInfiniteQuery(controls.read);
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const { results, chunkIds } = useSettledRecipeList({
        query,
        locale: viewerLocale,
        controls,
        refreshNotice,
        onPasteIngredients,
        ...rest,
    });
    // ⛔ THE LOADED CHUNKS (`chunkIds`), never the narrowed rows: one batch per chunk (≤ 500).
    const nutritionFor = useRecipeNutritionBatches(chunkIds);

    return (
        <RecipeListResults
            {...(scrollBind === undefined ? {} : { scrollBind })}
            {...results}
            // ONE promise, N slots: `null` means no batch covers this recipe — render nothing.
            renderNutrition={nutritionSlotRenderer(nutritionFor)}
            // Pull-to-refresh (L8): the spinner tracks the in-flight refetch; pulling re-runs the read.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
        />
    );
}
