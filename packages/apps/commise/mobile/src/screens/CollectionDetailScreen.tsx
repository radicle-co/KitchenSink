/**
 * Collection-detail screen (mobile, W5 Task 12 — the native mirror of `CollectionDetailContainer`). Reads the
 * collection with its members and composes the shared native collection building blocks:
 * the {@link CollectionHeader} (name, visibility badge, count, source attribution, last-pulled, Back +
 * rename/delete — C4/C6), the {@link CollectionActions} sidebar (add-recipes, pull-updates, clone, and the
 * premium-gated visibility toggle — C1/FR-009/FR-010/FR-011), the {@link CloneInfoPanel} (only for a cloned
 * collection — C5), the member list ({@link CollectionDetail}), and the {@link PullUpdatesDialog} (C2).
 * The read is a suspense read under a `QueryBoundary`, which owns the localized loading state and the failure:
 * not-found (no retry) or the load error with a retry that refetches, each with Back — the same choice the web
 * container makes, from the client's `isNotFoundError`. A background refetch that fails while the collection is on
 * screen does not throw, so the cook keeps reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is KEYED on the id:
 * a `replace` or deep link can reuse this screen with another collection, and the remount clears the previous
 * collection's pending visibility, pull dialog and mutation state.
 *
 * Premium gate (C1): a single `Viewer` (P4) is built from `useUserProfile` (app-user id + subscription tier)
 * and the shared `canGoPrivate` predicate — the SAME predicate the web container and the recipe screens
 * evaluate, so the platforms can never diverge; it fails safe (gated OFF) while the profile loads/absent.
 *
 * Pull-updates state machine (C2/FR-011): opening Pull runs `previewPull` and shows its {@link PullDiff};
 * confirming commits with `pullCollectionFromSource({ previewedDiff })`; a `PullDriftError` (409) is caught,
 * RE-PREVIEWED for the fresh diff, and surfaced as the dialog's `'drift'` state (never a blind retry, never an
 * infinite spinner). Navigation (member select, add-recipes, rename, view-source, post-clone, post-delete) is
 * forwarded upward so the navigator can route.
 */
import {
    CloneInfoPanel,
    CollectionActions,
    CollectionDetail,
    CollectionHeader,
    PullUpdatesDialog,
    RecipeNutritionSlot,
    collectionMessages,
    type CollectionDetailError,
} from '@commise/features-recipes';
import { toRecipeNutritionPages, useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { canGoPrivate, makeViewer, type RecipeVisibility } from '@kitchensink/recipe-core';
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import {
    collectionQueries,
    isNotFoundError,
    isPullDriftError,
    type PullDiff,
} from '@kitchensink/recipe-service-client';
import {
    useCloneCollection,
    useDeleteCollection,
    usePreviewPull,
    usePullCollectionFromSource,
    useRecipeServiceClient,
    useRemoveRecipeFromCollection,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LoadingState } from '../components/LoadingState.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link CollectionDetailScreen}. */
export interface CollectionDetailScreenProps {
    /** The id of the collection to display. */
    readonly collectionId: string;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (recipeId: string) => void;
    /** Invoked when the add-a-recipe action is activated (opens the recipe picker). */
    readonly onAddRecipe: () => void;
    /** Invoked with the collection's current name when the rename action is activated. */
    readonly onRename: (currentName: string) => void;
    /** Invoked after the collection is successfully deleted. */
    readonly onDeleted: () => void;
    /** Invoked with the new collection's id after a successful clone. */
    readonly onCloned: (collectionId: string) => void;
    /** Invoked with the source collection's id when View Source (clone info) is activated. */
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
    const { collections: t } = useMessages(mobileMessages);

    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack} style={styles.backButton}>
            <Text style={styles.backLabel}>{t.back}</Text>
        </Pressable>
    );

    return (
        <QueryBoundary
            loading={<LoadingState label={t.detailLoading} />}
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailNotFound}</Text>
                    </View>
                ) : (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailError}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t.detailRetry}
                            onPress={resetErrorBoundary}
                            style={styles.retryButton}
                        >
                            <Text style={styles.retryLabel}>{t.detailRetry}</Text>
                        </Pressable>
                    </View>
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
    onAddRecipe,
    onRename,
    onDeleted,
    onCloned,
    onViewSource,
    onBack,
}: CollectionDetailScreenProps): JSX.Element {
    if (collectionId.length === 0) {
        throw new Error('A collection detail needs a collection id.');
    }

    const { actions: collectionActions } = useMessages(collectionMessages);
    const locale = useLocale();
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(collectionId));
    const collection = query.data;
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    const removeRecipe = useRemoveRecipeFromCollection();
    const deleteCollection = useDeleteCollection();
    const updateCollection = useUpdateCollection();
    const cloneCollection = useCloneCollection();
    const previewPull = usePreviewPull();
    const commitPull = usePullCollectionFromSource();

    const [pendingVisibility, setPendingVisibility] = useState<RecipeVisibility | undefined>(undefined);
    const [isPullOpen, setPullOpen] = useState(false);
    const [pullDiff, setPullDiff] = useState<PullDiff | undefined>(undefined);
    const [pullError, setPullError] = useState<'drift' | 'generic' | undefined>(undefined);

    // The deferred calorie lookup (ADR-0021 §6), fed from the loaded members, so the rows paint over an in-flight
    // request.
    //
    // ⛔ EVERY member, not the revealed window `CollectionDetail` renders: the window grows on tap, and
    // batching it would re-batch on every "show more" and blink the figures already on screen back to
    // skeletons. Chunked at the published cap, so a collection longer than the cap loses the tail's figures
    // rather than the whole list's (`toRecipeNutritionPages`).
    const nutritionFor = useRecipeNutritionBatches(
        toRecipeNutritionPages(collection.recipes.map((member) => member.id)),
    );

    const isCloned = collection.sourceCollectionId !== undefined;
    const savedVisibility = collection.visibility;
    const effectivePending = pendingVisibility ?? savedVisibility;

    // P4: ONE Viewer, built from the profile's app-user id + subscription tier, feeds the visibility gate
    // through the shared `canGoPrivate` predicate — the SAME predicate the web container evaluates (C1). Fails
    // safe (OFF) while the profile loads or is absent.
    const viewer = makeViewer({ id: profile.data?.user.id, subscriptionTier: profile.data?.account.subscriptionTier });
    const viewerCanGoPrivate = canGoPrivate(viewer);

    // B17 — a failed delete/remove must never look frozen. Delete takes precedence over remove.
    const mutationError: CollectionDetailError | undefined =
        deleteCollection.error !== null && deleteCollection.error !== undefined
            ? 'delete'
            : removeRecipe.error !== null && removeRecipe.error !== undefined
              ? 'remove'
              : undefined;

    const runPreview = async (): Promise<void> => {
        try {
            const diff = await previewPull.mutateAsync(collectionId);
            setPullDiff(diff);
            setPullError(undefined);
        } catch {
            setPullError('generic');
        }
    };

    const openPull = (): void => {
        setPullDiff(undefined);
        setPullError(undefined);
        setPullOpen(true);
        void runPreview();
    };

    const cancelPull = (): void => {
        setPullOpen(false);
        setPullDiff(undefined);
        setPullError(undefined);
        previewPull.reset();
        commitPull.reset();
    };

    const confirmPull = async (): Promise<void> => {
        // Defense in depth (belt-and-braces alongside the dialog only rendering Confirm once a diff has
        // loaded): never commit a pull without a previewed diff to defend against — a blind pull would skip
        // the server's drift guard entirely (it only runs when `previewedDiff` is present).
        if (pullDiff === undefined) {
            return;
        }

        try {
            await commitPull.mutateAsync({ id: collectionId, previewedDiff: pullDiff });
            setPullOpen(false);
            setPullDiff(undefined);
            setPullError(undefined);
        } catch (error) {
            if (isPullDriftError(error)) {
                try {
                    const fresh = await previewPull.mutateAsync(collectionId);
                    setPullDiff(fresh);
                    setPullError('drift');
                } catch {
                    setPullError('generic');
                }
            } else {
                setPullError('generic');
            }
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <CollectionHeader
                name={collection.name}
                description={collection.description}
                visibility={savedVisibility}
                recipeCount={
                    // `recipeCount ??` STAYS — the contract genuinely marks it optional (absent on list reads). The
                    // `recipes?.` chain does not: `recipes` is required on `CollectionWithRecipesResponse`.
                    collection.recipeCount ?? collection.recipes.length
                }
                sourceCollectionName={collection.sourceCollectionName}
                sourceOwnerHandle={collection.sourceOwnerHandle}
                lastPulledAt={collection.lastPulledAt}
                onBack={onBack}
                onEdit={() => onRename(collection.name)}
                onDelete={() => deleteCollection.mutate(collectionId, { onSuccess: onDeleted })}
                refreshNotice={refreshNotice}
            />

            <CollectionActions
                isCloned={isCloned}
                visibility={savedVisibility}
                pendingVisibility={effectivePending}
                canGoPrivate={viewerCanGoPrivate}
                disabledReason={collectionActions.privatePremiumGated}
                isCloning={cloneCollection.isPending}
                isPulling={previewPull.isPending || commitPull.isPending}
                onAddRecipes={onAddRecipe}
                onPullUpdates={openPull}
                onClone={() =>
                    cloneCollection.mutate({ id: collectionId }, { onSuccess: (created) => onCloned(created.id) })
                }
                onVisibilityChange={setPendingVisibility}
                onSaveVisibility={() =>
                    updateCollection.mutate({ id: collectionId, request: { visibility: effectivePending } })
                }
            />

            {isCloned && collection.sourceCollectionId !== undefined && (
                <CloneInfoPanel
                    sourceOwnerHandle={collection.sourceOwnerHandle}
                    sourceCollectionName={collection.sourceCollectionName}
                    sourceCollectionId={collection.sourceCollectionId}
                    clonedAt={collection.createdAt}
                    locale={locale}
                    onViewSource={onViewSource}
                />
            )}

            <CollectionDetail
                collection={collection}
                error={mutationError}
                onSelectRecipe={onSelectRecipe}
                onRemoveRecipe={(recipeId) => removeRecipe.mutate({ id: collectionId, recipeId })}
                onAddRecipe={onAddRecipe}
                // ONE promise, N slots. `null` ⇒ no batch covers this member: render nothing rather than a
                // boundary with nothing to settle.
                renderNutrition={(recipeId) => {
                    const batch = nutritionFor(recipeId);

                    return batch === null ? null : (
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />
                    );
                }}
            />

            {isCloned && (
                <PullUpdatesDialog
                    open={isPullOpen}
                    diff={pullDiff}
                    isLoadingPreview={previewPull.isPending}
                    isCommitting={commitPull.isPending}
                    error={pullError}
                    sourceOwnerHandle={collection.sourceOwnerHandle}
                    sourceCollectionName={collection.sourceCollectionName}
                    onCancel={cancelPull}
                    onConfirm={() => void confirmPull()}
                />
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingBottom: 120 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    backButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16 },
    backLabel: { fontWeight: '500', fontSize: 15 },
    // 44px touch floor (10 + 10 padding around a ~24px line box), matching the other screens' retry controls.
    retryButton: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22, backgroundColor: palette.seafoam },
    retryLabel: { color: palette.white, fontWeight: '600', fontSize: 15 },
});
