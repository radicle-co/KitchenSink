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
} from '@commise/features-recipes';
import { collectionListRowsOf, useCollectionsList, type CollectionsList } from '@commise/features-recipes/collections';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC, ReactNode } from 'react';

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
type CollectionListRead = CollectionsList['read'];

/**
 * The live collection-list container.
 *
 * @param props - The active locale.
 * @returns The frame around the read boundary.
 */
export const CollectionListContainer: FC<CollectionListContainerProps> = ({ locale, avatar }) => {
    const router = useRouter();
    const recovery = useRecoverySignal();
    // The frame's session is shared with the mobile screen. Its `read` is built ONCE and handed to both sides, so the key
    // the boundary checks for a prefetch and the read it gates can never drift apart.
    const list = useCollectionsList({
        onCreated: (id) => router.push(`/${locale}/collections/${id}` as Route),
    });

    return (
        <CollectionListFrame
            {...(avatar === undefined ? {} : { headerAction: { kind: 'avatar', avatar } })}
            onCreate={list.sheet.onOpen}
            createEntryYields={list.createEntryYields}
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
                open={list.sheet.open}
                onOpenChange={list.sheet.onOpenChange}
                submitting={list.sheet.submitting}
                failed={list.sheet.failed}
                onCreate={list.sheet.onCreate}
                onDismissed={list.sheet.onDismissed}
            />
            <ClientQueryBoundary
                prefetchedKeys={[list.read.queryKey]}
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollectionList
                    read={list.read}
                    locale={locale}
                    searchValue={list.search.value}
                    onSearchChange={list.search.onChange}
                    hasRecipes={list.hasRecipes}
                    onCreate={list.sheet.onOpen}
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
    const rows = collectionListRowsOf(query, searchValue);

    return (
        <CollectionListResults
            collections={rows.collections}
            total={rows.total}
            search={{ value: searchValue, onChange: onSearchChange }}
            firstRun={{ hasRecipes, onCreate, onAddRecipe }}
            hrefOf={(id) => `/${locale}/collections/${id}`}
            onSelect={onSelect}
            refreshNotice={refreshNotice}
            loadMore={rows.loadMore}
        />
    );
};
