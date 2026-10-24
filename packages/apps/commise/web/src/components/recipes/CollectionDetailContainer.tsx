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
 * hydration-gated read boundary, the router, the grid/list choice (an account setting) and the links that make a card an anchor.
 *
 * Paid-feature gate (plan 2026-10-14-009 D14): the viewer's `paidFeatureStateOf` the profile — the SAME signal the recipe
 * detail container and the mobile screen read — decides whether the ⋯ menu offers the visibility item and what choosing
 * private does. While the profile loads, or if it failed, nothing private is offered.
 *
 * The loading and settled states each sit in the design system's `PushedPageFrame`: below 840 Back is pinned in a bar
 * that follows the scroll, and from 840 the header's own eyebrow carries it (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md`
 * §5, §6). The bar cannot sit outside the read boundary, because its title and the page's name exist only once the read
 * settles, so each state mounts its own frame with the same Back in the same place; the bar remounts when loading settles,
 * which is the accepted cost. The failed state sits in the frame too (it has no header, so below 840 the bar is its Back and from
 * 840 the eyebrow, drawn above the notice, is; the notice keeps its own only for a missing collection). The ⋯ menu stays in the header at every width.
 *
 * @pattern Facade — one route over the shared collection-detail session and body
 * @pattern Port — the router, as the session's navigation
 */
import { collectionMessages, ViewSaveFailedNotice } from '@commise/features-recipes';
import {
    COLLECTION_TITLE_ID,
    CollectionDetailBody,
    CollectionLoadError,
    collectionsBackOf,
    useCollectionDetail,
    type CollectionDetailNav,
} from '@commise/features-recipes/collections';
import { useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { HeaderEyebrowBack, type HeaderBack } from '@commise/ui/large-title-header';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { paidFeatureStateOf } from '@commise/features-account';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { useRecipeViewSetting } from '@/hooks/useRecipeViewSetting';
import { useUserProfile } from '@/hooks/useUserProfile';

/** Props for {@link CollectionDetailContainer}. */
export interface CollectionDetailContainerProps {
    /** The collection id from the `[id]` route segment. */
    readonly id: string;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * Back to the collections list, as the bar, the header's eyebrow and the not-found notice all draw it.
 *
 * @param locale - The active route locale.
 * @returns The Back control's value.
 */
function useCollectionsBack(locale: string): HeaderBack {
    const messages = useMessages(collectionMessages);
    const router = useRouter();
    const href = `/${locale}/collections`;

    return collectionsBackOf(messages, () => router.push(href as Route), href);
}

/**
 * The live collection-detail container: the route's read boundary around {@link CollectionDetailView}.
 *
 * @param props - The collection id to load and the active locale.
 * @returns The boundary: loading, not-found or a retrying error, and the composed detail view once the read settles.
 */
export const CollectionDetailContainer: FC<CollectionDetailContainerProps> = ({ id, locale }) => {
    const { detail } = useMessages(collectionMessages);
    const back = useCollectionsBack(locale);
    const headingId = useId();

    // Every state sits in the frame, with the same Back at the same place. Loading and failed have no header, so from 840,
    // where the bar is gone, they draw the header's eyebrow above their content (`display: none` below 840, where the bar's
    // Back is the only one). `CollectionLoadError` keeps a Back of its own for a missing collection only: the only allowed
    // second element with that name.
    return (
        <ClientQueryBoundary
            loading={
                <PushedPageFrame back={back} headingId={headingId}>
                    {() => (
                        <>
                            <HeaderEyebrowBack back={back} />
                            <LoadingNotice label={detail.loadingLabel} />
                        </>
                    )}
                </PushedPageFrame>
            }
            renderError={({ error, resetErrorBoundary }) => (
                <PushedPageFrame back={back} headingId={headingId}>
                    {() => (
                        <>
                            <HeaderEyebrowBack back={back} />
                            <CollectionLoadError error={error} onRetry={resetErrorBoundary} back={back} />
                        </>
                    )}
                </PushedPageFrame>
            )}
            resetKeys={[id]}
        >
            <CollectionDetailView key={id} id={id} locale={locale} />
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
const CollectionDetailView: FC<CollectionDetailContainerProps> = ({ id, locale }) => {
    if (id.length === 0) {
        throw new Error('A collection detail needs a collection id.');
    }

    const router = useRouter();
    const back = useCollectionsBack(locale);
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(id));
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    // The grid/list choice is an account setting shared with My recipes (ADR-0059); the page's server render put it in the cache.
    const { viewChoice, chooseView, saveFailed } = useRecipeViewSetting();

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
        onViewChoice: chooseView,
        nav,
    });

    return (
        <PushedPageFrame back={back} headingId={COLLECTION_TITLE_ID} title={query.data.name}>
            {() => (
                <section aria-label={query.data.name} className="mx-auto flex w-full max-w-page flex-col gap-6">
                    <CollectionDetailBody
                        detail={detail}
                        afterHeader={saveFailed ? <ViewSaveFailedNotice /> : null}
                        onBack={() => router.push(listHref as Route)}
                        onSelectRecipe={(recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route)}
                        onViewSource={(sourceId) => router.push(`/${locale}/collections/${sourceId}` as Route)}
                        links={{ back: listHref, recipeOf: (recipeId) => `/${locale}/recipes/${recipeId}` }}
                        PickerBoundary={ClientQueryBoundary}
                    />
                </section>
            )}
        </PushedPageFrame>
    );
};
