/**
 * Collections list screen (mobile, T071, orchestration). The shared native collection-list FRAME (heading + create) around a suspense
 * read of the viewer's collections: `Suspense` renders `CollectionListLoading`, the error boundary renders
 * `CollectionListLoadError` (its retry refetches), and once settled the RESULTS render the flattened pages with
 * pull-to-refresh, a notice for a failed refresh of them, and the server-paged load-more control (W5/C7).
 *
 * The frame sits outside the boundary, so a pending or failed read never unmounts the heading or the create action. A
 * retry from the refresh notice that succeeds moves the screen-reader cursor to the heading; the notice is inside the
 * boundary and the heading outside it, so the recovery crosses as a `useRecoverySignal` counter.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the recovery counter lifted to the
 *     frame's side
 */
import {
    CollectionListFrame,
    CollectionListLoadError,
    CollectionListLoading,
    CollectionListResults,
    CollectionSheet,
    narrowCollections,
    type RecipesSegmentControl,
} from '@commise/features-recipes';
import { useLibraryEmpty } from '@commise/features-recipes/hooks';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import { useCreateCollection, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link CollectionsScreen}. */
export interface CollectionsScreenProps {
    /** Invoked with a collection id when a card is activated — and with the new collection's id once one is created. */
    readonly onSelect: (collectionId: string) => void;
    /** The first run's Add a recipe, when the cook has no recipes to group yet: opens the editor. */
    readonly onCreateRecipe: () => void;
    /** The My recipes · Collections segments (slice 3: the Recipes tab's one root switches them). */
    readonly segments?: RecipesSegmentControl;
    /** The large title's action: the avatar, which pushes Profile. The route supplies it. */
    readonly headerAction?: HeaderAction;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
}

/**
 * The collections list screen (`docs/design/uiOverhaul/buildSpec.md` §5.1): the frame, the read boundary and the
 * new-collection sheet, which replaces the deleted `collectionCreate` screen. A created collection closes the sheet and
 * opens its detail.
 *
 * @param props - The navigation intents.
 * @returns The frame around the read boundary, and the sheet.
 */
export function CollectionsScreen({
    onSelect,
    onCreateRecipe,
    segments,
    headerAction,
    scrollBind,
}: CollectionsScreenProps): JSX.Element {
    const recovery = useRecoverySignal();
    const client = useRecipeServiceClient();
    const [searchValue, setSearchValue] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);
    const createCollection = useCreateCollection();
    // Whether the cook has a recipe to group; while unknown the first run offers New collection, the common case.
    const anyRecipe = useQuery(recipeQueries(client).list({ pageSize: 1 }));
    const hasRecipes = (anyRecipe.data?.total ?? 1) > 0;
    // The first run (no collection at all) draws its own start buttons in place of the floating one (§3.4). A cache-only
    // read of the list's own key: it fetches nothing, and is false until the read has settled empty.
    const firstRun = useLibraryEmpty(collectionQueries(client).listInfinite().queryKey);

    const openSheet = (): void => {
        createCollection.reset();
        setSheetOpen(true);
    };

    return (
        <CollectionListFrame
            onCreate={openSheet}
            firstRun={firstRun}
            headingFocusSignal={recovery.signal}
            {...(segments === undefined ? {} : { segments })}
            {...(headerAction === undefined ? {} : { headerAction })}
        >
            <QueryBoundary
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollections
                    searchValue={searchValue}
                    onSearchChange={setSearchValue}
                    firstRun={{ hasRecipes, onCreate: openSheet, onAddRecipe: onCreateRecipe }}
                    onSelect={onSelect}
                    onRecovered={recovery.onRecovered}
                    scrollBind={scrollBind}
                />
            </QueryBoundary>
            <CollectionSheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                submitting={createCollection.isPending}
                failed={createCollection.isError}
                onCreate={(request) =>
                    createCollection.mutate(request, {
                        onSuccess: (created) => {
                            setSheetOpen(false);
                            onSelect(created.id);
                        },
                    })
                }
            />
        </CollectionListFrame>
    );
}

/**
 * The collections once the first page has settled.
 *
 * @param props - The search, the first run, the selection handler and the recovery report.
 * @returns The results over the loaded pages.
 */
function SettledCollections({
    searchValue,
    onSearchChange,
    firstRun,
    onSelect,
    onRecovered,
    scrollBind,
}: {
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    readonly firstRun: {
        readonly hasRecipes: boolean;
        readonly onCreate: () => void;
        readonly onAddRecipe: () => void;
    };
    readonly onSelect: (collectionId: string) => void;
    readonly onRecovered: () => void;
    readonly scrollBind: ScrollBind | undefined;
}): JSX.Element {
    const client = useRecipeServiceClient();
    const query = useSuspenseInfiniteQuery(collectionQueries(client).listInfinite());
    // A failed pull or background refresh is the notice's, and a failed NEXT page is the load-more control's; a suspense
    // read throws into the boundary only when it has no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const loaded = query.data.pages.flatMap((page) => page.data);

    return (
        <CollectionListResults
            {...(scrollBind === undefined ? {} : { scrollBind })}
            collections={narrowCollections(loaded, searchValue)}
            total={loaded.length}
            search={{ value: searchValue, onChange: onSearchChange }}
            firstRun={firstRun}
            onSelect={onSelect}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the query.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            refreshNotice={refreshNotice}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                failed: query.isFetchNextPageError,
                onLoadMore: () => void query.fetchNextPage(),
            }}
        />
    );
}
