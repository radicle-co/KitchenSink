/**
 * Collection-detail screen (mobile, W5 Task 12 — the native mirror of `CollectionDetailContainer`). Loads the
 * collection with its members via `useCollection` and composes the shared native collection building blocks:
 * the {@link CollectionHeader} (name, visibility badge, count, source attribution, last-pulled, Back +
 * rename/delete — C4/C6), the {@link CollectionActions} sidebar (add-recipes, pull-updates, clone, and the
 * premium-gated visibility toggle — C1/FR-009/FR-010/FR-011), the {@link CloneInfoPanel} (only for a cloned
 * collection — C5), the member list ({@link CollectionDetail}), and the {@link PullUpdatesDialog} (C2).
 * Localized loading/error states render until the collection resolves.
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
    collectionMessages,
    type CollectionDetailError,
} from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import { canGoPrivate, makeViewer, type RecipeVisibility } from '@kitchensink/recipe-core';
import { isPullDriftError, type PullDiff } from '@kitchensink/recipe-service-client';
import {
    useCloneCollection,
    useCollection,
    useDeleteCollection,
    usePreviewPull,
    usePullCollectionFromSource,
    useRemoveRecipeFromCollection,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
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
 * The collection-detail screen.
 *
 * @param props - The collection id and the navigation/lifecycle callbacks the navigator wires.
 * @returns The loading, error, or composed collection-detail view.
 */
export function CollectionDetailScreen({
    collectionId,
    onSelectRecipe,
    onAddRecipe,
    onRename,
    onDeleted,
    onCloned,
    onViewSource,
    onBack,
}: CollectionDetailScreenProps): JSX.Element {
    const { collections: t } = useMessages(mobileMessages);
    const { actions: collectionActions } = useMessages(collectionMessages);
    const locale = useLocale();
    const profile = useUserProfile();
    const query = useCollection(collectionId);
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
    const [stateCollectionId, setStateCollectionId] = useState(collectionId);

    if (stateCollectionId !== collectionId) {
        // A `replace`/deep-link can reuse THIS screen instance with a new `collectionId`, so scrub the previous
        // collection's local + mutation state (pending visibility, pull dialog, in-flight/failed writes) — they
        // share the same `useState`/`useMutation` instances. (Member-window reveal resets via the keyed
        // `CollectionDetail` below.)
        setStateCollectionId(collectionId);
        setPendingVisibility(undefined);
        setPullOpen(false);
        setPullDiff(undefined);
        setPullError(undefined);
        removeRecipe.reset();
        deleteCollection.reset();
        updateCollection.reset();
        cloneCollection.reset();
        previewPull.reset();
        commitPull.reset();
    }

    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack} style={styles.backButton}>
            <Text style={styles.backLabel}>{t.back}</Text>
        </Pressable>
    );

    if (query.isLoading) {
        return <LoadingState label={t.detailLoading} />;
    }

    if (query.isError || query.data === undefined) {
        return (
            <View style={styles.center}>
                {back}
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    const collection = query.data;
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
                recipeCount={collection.recipeCount ?? collection.recipes?.length ?? 0}
                sourceCollectionName={collection.sourceCollectionName}
                sourceOwnerHandle={collection.sourceOwnerHandle}
                lastPulledAt={collection.lastPulledAt}
                onBack={onBack}
                onEdit={() => onRename(collection.name)}
                onDelete={() => deleteCollection.mutate(collectionId, { onSuccess: onDeleted })}
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

            {/* Reveal-reset (Task 11): key the member-list subtree on the collection id so the reveal count
                resets when navigating between collections. */}
            <CollectionDetail
                key={collection.id}
                collection={collection}
                error={mutationError}
                onSelectRecipe={onSelectRecipe}
                onRemoveRecipe={(recipeId) => removeRecipe.mutate({ id: collectionId, recipeId })}
                onAddRecipe={onAddRecipe}
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
});
