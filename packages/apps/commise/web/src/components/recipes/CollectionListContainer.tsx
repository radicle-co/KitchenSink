'use client';

/**
 * Container for the collection-list route (orchestration): the shared collection-list FRAME around a suspense read of
 * the viewer's collections.
 *
 * The frame (heading + create) sits outside the read boundary, so a pending or failed read swaps only what is under
 * the header. `Suspense` renders `CollectionListLoading`, the error boundary renders `CollectionListLoadError` (its
 * retry refetches), and once settled the RESULTS render the rows, a notice for a failed refresh of them, and the
 * server-paged load-more control. TanStack Query is the source of truth; the visible rows are derived from its pages.
 *
 * `/collections` is server-prefetched, so the boundary is `ClientQueryBoundary` with the prefetched key: a successful
 * prefetch ships the rows in the server HTML, a failed one ships the loading state and the browser reads after
 * hydration (B19). A retry from the refresh notice that succeeds moves focus to the frame's heading; the notice is
 * inside the boundary and the heading outside it, so the recovery crosses as a `useRecoverySignal` counter.
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
} from '@commise/features-recipes';
import { useLibraryEmpty } from '@commise/features-recipes/hooks';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { collectionQueries, recipeQueries } from '@kitchensink/recipe-service-client';
import { useCreateCollection, useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FC, type ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';

/** Props for {@link CollectionListContainer}. */
export interface CollectionListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /**
     * The large title's avatar (slice 3): the page hands in the app's `ProfileAvatarEntry`, so the profile read stays
     * where data enters the chrome and this container does not depend on the auth session.
     */
    readonly avatar?: ReactNode;
}

/** The collections read the page prefetches and the results render. */
type CollectionListRead = ReturnType<ReturnType<typeof collectionQueries>['listInfinite']>;

/**
 * The live collection-list container.
 *
 * @param props - The active locale.
 * @returns The frame around the read boundary.
 */
export const CollectionListContainer: FC<CollectionListContainerProps> = ({ locale, avatar }) => {
    const router = useRouter();
    const client = useRecipeServiceClient();
    // Built ONCE and handed to both sides, so the key the boundary checks for a prefetch and the read it gates can never
    // drift apart.
    const read = collectionQueries(client).listInfinite();
    const recovery = useRecoverySignal();
    const [searchValue, setSearchValue] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);
    const createCollection = useCreateCollection();
    // Whether the cook has any recipe to group (§5.1 first run). One recipe is enough to know; while it is unknown the
    // first run offers New collection, the common case.
    const anyRecipe = useQuery(recipeQueries(client).list({ pageSize: 1 }));
    const hasRecipes = (anyRecipe.data?.total ?? 1) > 0;
    // The first run (no collection at all) draws its own start buttons in place of the floating one (§3.4). A cache-only
    // read of the list's own key: it fetches nothing, and is false until the read has settled empty.
    const firstRun = useLibraryEmpty(read.queryKey);

    const openSheet = () => {
        createCollection.reset();
        setSheetOpen(true);
    };

    return (
        <CollectionListFrame
            {...(avatar === undefined ? {} : { headerAction: { kind: 'avatar', avatar } })}
            onCreate={openSheet}
            firstRun={firstRun}
            segments={{
                current: 'collections',
                href: { mine: `/${locale}/recipes`, collections: `/${locale}/collections` },
                onSelect: (segment) => {
                    if (segment === 'mine') {
                        router.push(`/${locale}/recipes` as Route);
                    }
                },
            }}
            headingFocusSignal={recovery.signal}
        >
            {/* The new-collection sheet replaces the deleted `/collections/new` page (§5.1). A created collection
                closes the sheet and opens its detail, whose empty state offers Add recipes. */}
            <CollectionSheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                submitting={createCollection.isPending}
                failed={createCollection.isError}
                onCreate={(request) =>
                    createCollection.mutate(request, {
                        onSuccess: (created) => {
                            setSheetOpen(false);
                            router.push(`/${locale}/collections/${created.id}` as Route);
                        },
                    })
                }
            />
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollectionList
                    read={read}
                    locale={locale}
                    searchValue={searchValue}
                    onSearchChange={setSearchValue}
                    hasRecipes={hasRecipes}
                    onCreate={openSheet}
                    onAddRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
                    onSelect={(id) => router.push(`/${locale}/collections/${id}` as Route)}
                    onRecovered={recovery.onRecovered}
                />
            </ClientQueryBoundary>
        </CollectionListFrame>
    );
};

/** Props for {@link SettledCollectionList}. */
interface SettledCollectionListProps {
    /** The collections read the boundary gates — the same options object whose key it checked. */
    readonly read: CollectionListRead;
    readonly locale: string;
    readonly searchValue: string;
    readonly onSearchChange: (value: string) => void;
    readonly hasRecipes: boolean;
    readonly onCreate: () => void;
    readonly onAddRecipe: () => void;
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (id: string) => void;
    /** Reports a retry from the refresh notice that succeeded, for the frame's heading. */
    readonly onRecovered: () => void;
}

/**
 * The list once its first page has settled.
 *
 * @param props - The read, the selection handler and the recovery report.
 * @returns The results over the loaded pages.
 */
const SettledCollectionList: FC<SettledCollectionListProps> = ({
    read,
    locale,
    searchValue,
    onSearchChange,
    hasRecipes,
    onCreate,
    onAddRecipe,
    onSelect,
    onRecovered,
}) => {
    const query = useSuspenseInfiniteQuery(read);
    // A failed refresh of the rows on screen is the notice's, and a failed NEXT page is the load-more control's; a
    // suspense read throws into the boundary only when it has no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });
    const loaded = query.data.pages.flatMap((page) => page.data);

    return (
        <CollectionListResults
            // Each fetched page appends to `data.pages`, so flatten them; the search narrows what is loaded.
            collections={narrowCollections(loaded, searchValue)}
            total={loaded.length}
            search={{ value: searchValue, onChange: onSearchChange }}
            firstRun={{ hasRecipes, onCreate, onAddRecipe }}
            hrefOf={(id) => `/${locale}/collections/${id}`}
            onSelect={onSelect}
            refreshNotice={refreshNotice}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                failed: query.isFetchNextPageError,
                onLoadMore: () => void query.fetchNextPage(),
            }}
        />
    );
};
