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
    type RecipesSegmentControl,
} from '@commise/features-recipes';
import { collectionListRowsOf, useCollectionsList, type CollectionsList } from '@commise/features-recipes/collections';
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

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
    const list = useCollectionsList({ onCreated: onSelect });

    return (
        <CollectionListFrame
            onCreate={list.sheet.onOpen}
            createEntryYields={list.createEntryYields}
            headingFocusSignal={recovery.signal}
            {...(segments === undefined ? {} : { segments })}
            {...(headerAction === undefined ? {} : { headerAction })}
        >
            <QueryBoundary
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollections
                    read={list.read}
                    searchValue={list.search.value}
                    onSearchChange={list.search.onChange}
                    firstRun={{ hasRecipes: list.hasRecipes, onCreate: list.sheet.onOpen, onAddRecipe: onCreateRecipe }}
                    onSelect={onSelect}
                    onRecovered={recovery.onRecovered}
                    scrollBind={scrollBind}
                />
            </QueryBoundary>
            <CollectionSheet
                open={list.sheet.open}
                onOpenChange={list.sheet.onOpenChange}
                submitting={list.sheet.submitting}
                failed={list.sheet.failed}
                onCreate={list.sheet.onCreate}
                onDismissed={list.sheet.onDismissed}
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
    read,
    searchValue,
    onSearchChange,
    firstRun,
    onSelect,
    onRecovered,
    scrollBind,
}: {
    /** The collections read the frame's session built. */
    readonly read: CollectionsList['read'];
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
    const query = useSuspenseInfiniteQuery(read);
    // A failed pull or background refresh is the notice's, and a failed NEXT page is the load-more control's; a suspense
    // read throws into the boundary only when it has no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const rows = collectionListRowsOf(query, searchValue);

    return (
        <CollectionListResults
            {...(scrollBind === undefined ? {} : { scrollBind })}
            collections={rows.collections}
            total={rows.total}
            search={{ value: searchValue, onChange: onSearchChange }}
            firstRun={firstRun}
            onSelect={onSelect}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the query.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            refreshNotice={refreshNotice}
            loadMore={rows.loadMore}
        />
    );
}
