'use client';

/**
 * Container for the collection-detail route (orchestration; W5 Task 12; slice 5 of the UI overhaul, `docs/design/uiOverhaul/buildSpec.md`
 * §5.2, §5.3). It reads a single collection (with its member recipes) and composes the shared building blocks around it:
 * the collection header (back, name, meta, description, Add recipes and the ⋯ menu), the members list, the rename sheet,
 * the delete confirmation, the Premium sheet, the add-recipes picker and the pull-updates dialog.
 * The fetch-state affordances (loading, generic error with retry, distinct not-found) belong to the app, not the blocks.
 *
 * The read is a suspense read under a `ClientQueryBoundary` — hydration-gated, because this route is not
 * server-prefetched. A background refetch that fails while the collection is on screen does not throw, so the cook keeps
 * reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is KEYED
 * on the id: the App Router keeps this container mounted across `/collections/A` → `/collections/B`, and the remount is what
 * clears A's pending removal, sheets and pull state before B renders.
 *
 * Remote state stays in TanStack Query: the view is derived from the query, never copied into local state. The work —
 * removal, visibility, pull, rename, delete, Save a copy and the picker — is `useCollectionDetail`'s, shared with the mobile
 * screen, and the settled body is `CollectionDetailBody`'s. What stays here is what is web's: the page frame, the
 * hydration-gated read boundary, the router, the stored view choice (a cookie) and the links that make a card an anchor.
 *
 * Paid-feature gate (plan 2026-10-14-009 D14): the viewer's `paidFeatureStateOf` the profile — the SAME signal the recipe
 * detail container and the mobile screen read — decides whether the ⋯ menu offers the visibility item and what choosing
 * private does. While the profile loads, or if it failed, nothing private is offered.
 *
 * @pattern Facade — one route over the shared collection-detail session and body
 * @pattern Port — the router, as the session's navigation
 */
import { collectionMessages, viewModeCookieFor, type ListViewMode } from '@commise/features-recipes';
import {
    CollectionDetailBody,
    CollectionLoadError,
    useCollectionDetail,
    type CollectionDetailNav,
} from '@commise/features-recipes/collections';
import { useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { paidFeatureStateOf } from '@commise/features-account';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useUserProfile } from '@/hooks/useUserProfile';

/** Props for {@link CollectionDetailContainer}. */
export interface CollectionDetailContainerProps {
    /** The collection id from the `[id]` route segment. */
    readonly id: string;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The cook's stored list/grid choice (the cookie the page read), so the server renders it. */
    readonly storedViewMode?: ListViewMode;
}

/**
 * The live collection-detail container: the route's read boundary around {@link CollectionDetailView}.
 *
 * @param props - The collection id to load and the active locale.
 * @returns The boundary: loading, not-found or a retrying error, and the composed detail view once the read settles.
 */
export const CollectionDetailContainer: FC<CollectionDetailContainerProps> = ({ id, locale, storedViewMode }) => {
    const { detail, list } = useMessages(collectionMessages);
    const router = useRouter();
    const collectionsHref = `/${locale}/collections`;

    return (
        <ClientQueryBoundary
            loading={<LoadingNotice label={detail.loadingLabel} />}
            renderError={({ error, resetErrorBoundary }) => (
                <CollectionLoadError
                    error={error}
                    onRetry={resetErrorBoundary}
                    back={{
                        label: detail.backTo.replace('{parent}', list.heading),
                        icon: 'chevronLeft',
                        href: collectionsHref,
                        onPress: () => router.push(collectionsHref as Route),
                    }}
                />
            )}
            resetKeys={[id]}
        >
            <CollectionDetailView
                key={id}
                id={id}
                locale={locale}
                {...(storedViewMode === undefined ? {} : { storedViewMode })}
            />
        </ClientQueryBoundary>
    );
};

/**
 * The settled collection detail: the collection has resolved by the time this renders.
 *
 * @param props - The collection id and the active locale.
 * @returns The composed detail view.
 * @throws {Error} For an empty collection id — a read that cannot be made fails into the boundary, as the generic
 *   failure, rather than issuing a request for `''` (B21).
 */
const CollectionDetailView: FC<CollectionDetailContainerProps> = ({ id, locale, storedViewMode }) => {
    if (id.length === 0) {
        throw new Error('A collection detail needs a collection id.');
    }

    const router = useRouter();
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(id));
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    const [viewChoice, setViewChoice] = useState<ListViewMode | undefined>(storedViewMode);

    const listHref = `/${locale}/collections`;
    const nav: CollectionDetailNav = {
        onDeleted: () => router.push(listHref as Route),
        onCloned: (created) => router.push(`/${locale}/collections/${created}` as Route),
        onCreateRecipe: () => router.push(`/${locale}/recipes/new` as Route),
    };
    const detail = useCollectionDetail({
        collection: query.data,
        refreshNotice,
        // Plan 2026-10-14-009 D14: private from the viewer's paid features alone (owner ruling 2026-10-13).
        paidFeatures: paidFeatureStateOf(profile),
        viewChoice,
        onViewChoice: (mode) => {
            setViewChoice(mode);
            document.cookie = viewModeCookieFor(mode);
        },
        nav,
    });

    return (
        <section aria-label={query.data.name} className="mx-auto flex w-full max-w-page flex-col gap-6">
            <CollectionDetailBody
                detail={detail}
                onBack={() => router.push(listHref as Route)}
                onSelectRecipe={(recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route)}
                onViewSource={(sourceId) => router.push(`/${locale}/collections/${sourceId}` as Route)}
                links={{ back: listHref, recipeOf: (recipeId) => `/${locale}/recipes/${recipeId}` }}
                PickerBoundary={ClientQueryBoundary}
            />
        </section>
    );
};
