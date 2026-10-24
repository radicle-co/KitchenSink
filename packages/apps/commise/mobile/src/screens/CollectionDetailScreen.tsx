/**
 * Collection-detail screen (mobile, orchestration; slice 5 of the UI overhaul, `docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3 — the native
 * mirror of `CollectionDetailContainer`). Reads the collection with its members and composes the shared native blocks: the
 * `CollectionHeader` (back, name, meta, description, Add recipes and the ⋯ menu), the `CollectionMembers` list,
 * and the sheets the header opens — rename (`CollectionSheet`), delete (`CollectionDeleteDialog`), Premium
 * (`CollectionUpsellSheet`), the add-recipes picker and the pull-updates dialog. Rename and Add recipes are sheets on
 * this screen, not routes.
 *
 * The read is a suspense read under a `QueryBoundary`, which owns the localized loading state and the failure: not-found (no
 * retry) or the load error with a retry that refetches, each with Back — the same choice the web container makes, from the
 * client's `isNotFoundError`. A background refetch that fails while the collection is on screen does not throw, so the cook
 * keeps reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is
 * KEYED on the id: a `replace` or deep link can reuse this screen with another collection, and the remount clears the
 * previous collection's pending removal, sheets and pull state.
 *
 * Remote state stays in TanStack Query. The work — removal, visibility, pull, rename, delete, Save a copy and the picker —
 * is `useCollectionDetail`'s, shared with the web container, and the settled body is `CollectionDetailBody`'s. What stays
 * here is what is mobile's: the `ScrollView` frame, the read boundary and its fallbacks, the navigator callbacks and the
 * stored list/grid choice.
 *
 * Paid-feature gate (plan 2026-10-14-009 D14): the viewer's `paidFeatureStateOf` the profile — the SAME signal the web
 * container reads — decides whether the ⋯ menu offers the visibility item and what choosing private does. While the
 * profile loads, or if it failed, nothing private is offered.
 *
 * @pattern Facade — one screen over the shared collection-detail session and body
 * @pattern Port — the navigator callbacks, as the session's navigation
 */
import { collectionMessages, ViewSaveFailedNotice } from '@commise/features-recipes';
import {
    CollectionDetailBody,
    CollectionLoadError,
    CollectionMoreMenu,
    collectionMenuPropsOf,
    collectionsBackOf,
    useCollectionDetail,
} from '@commise/features-recipes/collections';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { nativeTokens } from '@commise/ui/native';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { paidFeatureStateOf } from '@commise/features-account';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useId, type JSX, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useRecipeViewSetting } from '../hooks/useRecipeViewSetting.js';
import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link CollectionDetailScreen}. */
export interface CollectionDetailScreenProps {
    /** The id of the collection to display. */
    readonly collectionId: string;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (recipeId: string) => void;
    /** Invoked when the picker's empty state asks to create a recipe. */
    readonly onCreateRecipe: () => void;
    /** Invoked after the collection is successfully deleted. */
    readonly onDeleted: () => void;
    /** Invoked with the new collection's id after a successful Save a copy. */
    readonly onCloned: (collectionId: string) => void;
    /** Invoked with the source collection's id when "Copied from …" is activated. */
    readonly onViewSource: (sourceCollectionId: string) => void;
    /** Invoked when the back affordance is activated. */
    readonly onBack: () => void;
}

/**
 * The collection-detail screen: its read boundary around {@link CollectionDetailView}.
 *
 * @param props - The collection id and the navigation/lifecycle callbacks the navigator wires.
 * @returns The boundary: loading, not-found or a retrying error, and the composed detail view once the read settles.
 */
export function CollectionDetailScreen(props: CollectionDetailScreenProps): JSX.Element {
    const { collectionId, onBack } = props;
    const messages = useMessages(collectionMessages);
    const headingId = useId();
    const back = collectionsBackOf(messages, onBack);
    // A branch with no scroller of its own (loading, failed) sits under the bar, in the room the frame hands it.
    const beneathBar = (content: ReactNode): JSX.Element => (
        <PushedPageFrame back={back} headingId={headingId}>
            {(_bind, inset) => <View style={[styles.beneathBar, inset]}>{content}</View>}
        </PushedPageFrame>
    );

    return (
        <QueryBoundary
            loading={beneathBar(<LoadingNotice label={messages.detail.loadingLabel} />)}
            renderError={({ error, resetErrorBoundary }) =>
                beneathBar(
                    // The bar owns Back; the notice draws its own only for a missing collection, the only allowed
                    // second element with that name.
                    <CollectionLoadError error={error} onRetry={resetErrorBoundary} back={back} />,
                )
            }
            resetKeys={[collectionId]}
        >
            <CollectionDetailView key={collectionId} {...props} />
        </QueryBoundary>
    );
}

/**
 * The settled collection detail: the collection has resolved by the time this renders.
 *
 * @param props - The collection id and the navigation/lifecycle callbacks the navigator wires.
 * @returns The composed collection-detail view.
 * @throws {Error} For an empty collection id — a read that cannot be made fails into the boundary, as the generic
 *   failure, rather than issuing a request for `''`.
 */
function CollectionDetailView({
    collectionId,
    onSelectRecipe,
    onCreateRecipe,
    onDeleted,
    onCloned,
    onViewSource,
    onBack,
}: CollectionDetailScreenProps): JSX.Element {
    if (collectionId.length === 0) {
        throw new Error('A collection detail needs a collection id.');
    }

    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(collectionId));
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    // The grid/list choice is an account setting shared with My recipes and the web app (ADR-0059).
    const { viewChoice, chooseView, saveFailed } = useRecipeViewSetting();
    const detail = useCollectionDetail({
        collection: query.data,
        refreshNotice,
        // Plan 2026-10-14-009 D14: private from the viewer's paid features alone (owner ruling 2026-10-13).
        paidFeatures: paidFeatureStateOf(profile),
        viewChoice,
        onViewChoice: chooseView,
        nav: { onDeleted, onCloned, onCreateRecipe },
    });

    const messages = useMessages(collectionMessages);
    const headingId = useId();
    const back = collectionsBackOf(messages, onBack);

    return (
        <PushedPageFrame
            back={back}
            headingId={headingId}
            title={detail.collection.name}
            menu={<CollectionMoreMenu {...collectionMenuPropsOf(detail)} />}
        >
            {(bind, inset) => (
                <ScrollView
                    {...bind}
                    keyboardShouldPersistTaps="handled"
                    style={styles.container}
                    contentContainerStyle={[styles.content, inset]}
                >
                    <CollectionDetailBody
                        detail={detail}
                        onBack={onBack}
                        onSelectRecipe={onSelectRecipe}
                        onViewSource={onViewSource}
                        PickerBoundary={QueryBoundary}
                        afterHeader={saveFailed ? <ViewSaveFailedNotice /> : null}
                    />
                </ScrollView>
            )}
        </PushedPageFrame>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    // The screen gutter the Collections list keeps (`CollectionListFrame`), so the title and its row do not start at
    // the screen's edge.
    // The room under the pinned bar is the frame's: it hands each branch its `inset`, which is merged in beside these.
    content: { paddingHorizontal: nativeTokens.spacing[4], paddingBottom: 120 },
    beneathBar: { flex: 1 },
});
