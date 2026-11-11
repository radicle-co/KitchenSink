/**
 * Recipe-list screen (mobile, orchestration). The shared native recipe-list FRAME (title band + search field) around a suspense read
 * of the caller's library: `Suspense` renders `RecipeListLoading`, the error boundary renders `RecipeListLoadError`
 * (its retry refetches; the frame keeps the create button), and once settled the RESULTS render the facet chips, the rows
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
 * past the first page (blueprint A11); forwards the sort to the server; reads and saves the list/grid choice as an account setting; and
 * decides the card variant from the container class. The My recipes · Collections segments are the host's to pass
 * (`segments`).
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the viewer's narrowing and the
 *     recovery counter lifted to the frame's side
 */
import {
    RecipeListFrame,
    RecipeListLoadError,
    RecipeListLoading,
    RecipeListResults,
    type RecipeListReading,
    nutritionSlotRenderer,
    ViewSaveFailedNotice,
    type ListViewMode,
    type RecipesSegmentControl,
} from '@commise/features-recipes';
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import {
    useLibraryReading,
    useRecipeLibraryControls,
    useRecipeListPresentation,
    useSettledRecipeList,
    type RecipeLibraryControls,
    type RecipeListPresentation,
} from '@commise/features-recipes/list';
import { useLocale } from '@commise/i18n/react';
import { PendingSlot } from '@commise/query/pending-slot';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { JSX } from 'react';

import { useRecipeViewSetting } from '../hooks/useRecipeViewSetting.js';
import { useScreenTrace } from '../screenTrace/useScreenTrace.js';

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
    scrollBind,
}: RecipeListScreenProps): JSX.Element {
    useScreenTrace('RecipeListScreen');
    const controls = useRecipeLibraryControls();
    // The grid/list choice is an account setting (ADR-0059), shared with the web app and the collection screen.
    const { viewChoice, chooseView, saveFailed } = useRecipeViewSetting();
    const recovery = useRecoverySignal();
    const presentation = useRecipeListPresentation(viewChoice);

    return (
        <RecipeListFrame
            searchValue={controls.searchValue}
            onSearchChange={controls.onSearchChange}
            searchVisible={controls.searchVisible}
            onCreateRecipe={onCreateRecipe}
            createEntryYields={controls.createEntryYields}
            {...(segments === undefined ? {} : { segments })}
            headingFocusSignal={recovery.signal}
        >
            {saveFailed ? <ViewSaveFailedNotice /> : null}
            <LibraryBody
                controls={controls}
                presentation={presentation}
                onViewModeChange={chooseView}
                onSelectRecipe={onSelectRecipe}
                onCreateRecipe={onCreateRecipe}
                onPasteIngredients={onPasteIngredients}
                onRecovered={recovery.onRecovered}
                scrollBind={scrollBind}
            />
        </RecipeListFrame>
    );
}

/** Props for {@link LibraryBody}. */
interface LibraryBodyProps {
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
 * The Recipes list for whatever the library read is doing, as a STATE rather than a Suspense boundary. ONE list is drawn
 * in every state, so the header the frame hands it (title, segments, search) never unmounts: a pending read draws the
 * loading skeleton (the offline copy when it is parked offline) in the list's empty body, a failed one the load error
 * with a Try again, and a settled one the results. Every hook runs in every state, over an empty library until data
 * arrives.
 *
 * Try again and a pull to refresh both refetch; a failed query goes back to pending while it does, so the same loading
 * shows for both (designer, 2026-11-02).
 *
 * @param props - The viewer's narrowing and presentation, and the intents to forward.
 * @returns The list under the frame's header.
 */
function LibraryBody({
    controls,
    onRecovered,
    scrollBind,
    onPasteIngredients,
    ...rest
}: LibraryBodyProps): JSX.Element {
    const viewerLocale = useLocale();
    const { reading, query } = useLibraryReading(controls.read);
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const { results, chunkIds } = useSettledRecipeList({
        query: {
            data: reading.kind === 'settled' ? reading.data : undefined,
            hasNextPage: query.hasNextPage,
            isFetchingNextPage: query.isFetchingNextPage,
            isFetchNextPageError: query.isFetchNextPageError,
            fetchNextPage: query.fetchNextPage,
        },
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
            reading={readingBodyOf(reading.kind, rest.presentation.variant, () => void query.refetch())}
            // ONE batch per chunk, N slots: `null` means no batch covers this recipe — render nothing.
            renderNutrition={nutritionSlotRenderer(nutritionFor)}
            // Pull to refresh in EVERY state, so a pull from the failed state is a retry.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
        />
    );
}

/**
 * What the list draws for a read that has not settled.
 *
 * @param kind - The reading's state.
 * @param variant - The card variant the loading skeleton mirrors.
 * @param onRetry - Refetch the library.
 * @returns The list's reading. Pure.
 */
function readingBodyOf(
    kind: 'pending' | 'failed' | 'settled',
    variant: RecipeListPresentation['variant'],
    onRetry: () => void,
): RecipeListReading {
    switch (kind) {
        case 'pending':
            return {
                kind,
                body: (
                    <PendingSlot>
                        <RecipeListLoading variant={variant} />
                    </PendingSlot>
                ),
            };
        case 'failed':
            return { kind, body: <RecipeListLoadError onRetry={onRetry} /> };
        case 'settled':
            return { kind };
    }
}
