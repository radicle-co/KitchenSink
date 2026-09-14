'use client';

/**
 * Container for the collection-detail route (W5 Task 12 — the collection-view integration linchpin). It
 * reads a single collection (with its member recipes) and composes the shared,
 * presentational collection building blocks around it: the {@link CollectionHeader} (name, visibility badge,
 * recipe count, source attribution, last-pulled, Back + rename/delete — C4/C6), the {@link CollectionActions}
 * sidebar (add-recipes, pull-updates, clone, and the premium-gated visibility toggle — C1/FR-009/FR-010/
 * FR-011), the {@link CloneInfoPanel} (only for a cloned collection — C5), the member list
 * ({@link CollectionDetail}), and the {@link PullUpdatesDialog} (C2). The fetch-state affordances (loading,
 * generic error with retry, distinct not-found) belong to the app, not the blocks, and are localized through
 * the web dictionary (`useMessages`).
 *
 * The read is a suspense read under a `ClientQueryBoundary` — hydration-gated, because this route is not
 * server-prefetched. The boundary owns loading and failure, choosing not-found or the retrying error from the
 * client's `isNotFoundError`; a background refetch that fails while the collection is on screen does not throw, so
 * the cook keeps reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is KEYED on the id: the App Router keeps this
 * container mounted across `/collections/A` → `/collections/B`, and the remount is what clears A's pending
 * visibility, pull dialog and mutation state before B renders.
 *
 * Remote state stays in TanStack Query — the view is derived from the query, never copied into local state;
 * the only local state is view state the server does not own: the pending (unsaved) visibility selection and
 * the pull preview→commit→drift dialog state machine.
 *
 * Premium gate (C1): a single `Viewer` (P4, `@kitchensink/recipe-core`) is built once per render from Clerk's
 * `external_id` session claim + `useUserProfile`'s subscription tier — the SAME signals and the SAME
 * `canGoPrivate` predicate the recipe detail container and the mobile screen evaluate, so the two platforms
 * and the two surfaces can never diverge on the gate. It fails safe (gated OFF) while the profile loads/absent.
 *
 * Pull-updates state machine (C2/FR-011): opening Pull runs `previewPull` (imperative `mutateAsync`) and shows
 * its {@link PullDiff} in the dialog; confirming commits with `pullCollectionFromSource({ previewedDiff })`; a
 * `PullDriftError` (409 — the source drifted since the preview) is caught, RE-PREVIEWED for the fresh diff, and
 * surfaced as the dialog's `'drift'` state (never a blind retry, never an infinite spinner). A successful
 * commit invalidates via the hook, then closes + clears the dialog.
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
import { useRecipeNutritionBatches } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { useAuth } from '@clerk/nextjs';
import { canGoPrivate, makeViewer, type RecipeVisibility } from '@kitchensink/recipe-core';
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
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { CollectionLoadError } from '@/components/recipes/CollectionLoadError';
import { CollectionNotFound } from '@/components/recipes/CollectionNotFound';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

/** Props for {@link CollectionDetailContainer}. */
export interface CollectionDetailContainerProps {
    /** The collection id from the `[id]` route segment. */
    readonly id: string;
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * Read the viewer's app-user ULID from Clerk's session claims (the `external_id` claim — the recipe
 * service's owner key). Returns `undefined` when the claim is absent so the premium gate stays deniably off.
 *
 * @param sessionClaims - Clerk's session claims (untyped for the custom `external_id` claim).
 * @returns The viewer's app-user ULID, or `undefined` when it is not present.
 */
function readViewerId(sessionClaims: unknown): string | undefined {
    const claims = sessionClaims as Record<string, unknown> | null;
    const externalId = claims?.['external_id'];

    return typeof externalId === 'string' ? externalId : undefined;
}

/**
 * The live collection-detail container: the route's read boundary around {@link CollectionDetailView}.
 *
 * @param props - The collection id to load and the active locale.
 * @returns The boundary: loading, not-found or a retrying error, and the composed detail view once the read settles.
 */
export const CollectionDetailContainer: FC<CollectionDetailContainerProps> = ({ id, locale }) => {
    const { collections } = useMessages(webMessages);

    return (
        <ClientQueryBoundary
            loading={
                <p
                    role="status"
                    aria-label={collections.detail.loadingLabel}
                    className="px-4 py-8 text-body-md text-slate"
                >
                    {collections.detail.loadingLabel}
                </p>
            }
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? <CollectionNotFound /> : <CollectionLoadError onRetry={resetErrorBoundary} />
            }
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
    const activeLocale = useLocale();
    const { actions: collectionActions } = useMessages(collectionMessages);
    const { sessionClaims } = useAuth();
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(id));
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

    // View state the server does not own: the pending (unsaved) visibility selection and the pull dialog's
    // preview→commit→drift machine. `pendingVisibility` is undefined until the viewer changes it, so the saved
    // value is the source of truth until then.
    const [pendingVisibility, setPendingVisibility] = useState<RecipeVisibility | undefined>(undefined);
    const [isPullOpen, setPullOpen] = useState(false);
    const [pullDiff, setPullDiff] = useState<PullDiff | undefined>(undefined);
    const [pullError, setPullError] = useState<'drift' | 'generic' | undefined>(undefined);

    const memberIds = useMemo(() => collection.recipes.map((recipe) => recipe.id), [collection]);
    const nutritionFor = useRecipeNutritionBatches([memberIds]);
    const renderNutrition = useCallback(
        (recipeId: string) => {
            const batch = nutritionFor(recipeId);

            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [nutritionFor],
    );

    const isCloned = collection.sourceCollectionId !== undefined;
    const savedVisibility = collection.visibility;
    const effectivePending = pendingVisibility ?? savedVisibility;

    // P4: ONE Viewer value object, built from this platform's identity signals (Clerk's `external_id` claim +
    // the profile's subscription tier), feeds the visibility gate through the shared `canGoPrivate` predicate —
    // the SAME predicate the recipe detail container and the mobile screen evaluate (C1). Fails safe (OFF)
    // while the profile loads or is absent (`makeViewer` maps an absent/unrecognized tier to `'free'`).
    const viewer = makeViewer({
        id: readViewerId(sessionClaims),
        subscriptionTier: profile.data?.account.subscriptionTier,
    });
    const viewerCanGoPrivate = canGoPrivate(viewer);

    // B17 — a failed delete/remove must never look frozen. Surface an honest code for whichever mutation
    // errored; delete takes precedence over remove (it is the more consequential, whole-collection action).
    const mutationError: CollectionDetailError | undefined =
        deleteCollection.error !== null && deleteCollection.error !== undefined
            ? 'delete'
            : removeRecipe.error !== null && removeRecipe.error !== undefined
              ? 'remove'
              : undefined;

    /** Fetch a fresh preview and show it in the dialog; a failed preview surfaces the generic error state. */
    const runPreview = async (): Promise<void> => {
        try {
            const diff = await previewPull.mutateAsync(id);
            setPullDiff(diff);
            setPullError(undefined);
        } catch {
            setPullError('generic');
        }
    };

    /** Open the pull dialog and kick off the initial preview (C2). */
    const openPull = (): void => {
        setPullDiff(undefined);
        setPullError(undefined);
        setPullOpen(true);
        void runPreview();
    };

    /** Cancel/dismiss the pull dialog and reset its whole state machine. */
    const cancelPull = (): void => {
        setPullOpen(false);
        setPullDiff(undefined);
        setPullError(undefined);
        previewPull.reset();
        commitPull.reset();
    };

    /**
     * Commit the previewed pull. On a `PullDriftError` (409 — the source drifted since the preview), re-run
     * the preview for the FRESH diff and surface the dialog's `'drift'` state, keeping it open so the viewer
     * re-decides against current data (never a blind retry, never an infinite spinner). Any other failure is
     * generic; a successful commit invalidates (via the hook), then closes + clears the dialog.
     */
    const confirmPull = async (): Promise<void> => {
        // Defense in depth (belt-and-braces alongside the dialog only rendering Confirm once a diff has
        // loaded): never commit a pull without a previewed diff to defend against — a blind pull would skip
        // the server's drift guard entirely (it only runs when `previewedDiff` is present).
        if (pullDiff === undefined) {
            return;
        }

        try {
            await commitPull.mutateAsync({ id, previewedDiff: pullDiff });
            setPullOpen(false);
            setPullDiff(undefined);
            setPullError(undefined);
        } catch (error) {
            if (isPullDriftError(error)) {
                try {
                    const fresh = await previewPull.mutateAsync(id);
                    setPullDiff(fresh);
                    setPullError('drift');
                } catch {
                    // Even the re-preview failed — fall back to the generic error rather than a stuck spinner.
                    setPullError('generic');
                }
            } else {
                setPullError('generic');
            }
        }
    };

    return (
        <section aria-label={collection.name} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
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
                onBack={() => router.push(`/${locale}/collections` as Route)}
                onEdit={() => router.push(`/${locale}/collections/${id}/rename` as Route)}
                refreshNotice={refreshNotice}
                onDelete={() =>
                    deleteCollection.mutate(id, {
                        onSuccess: () => router.push(`/${locale}/collections` as Route),
                    })
                }
            />

            <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
                <aside className="flex flex-col gap-6 lg:w-80 lg:shrink-0">
                    <CollectionActions
                        isCloned={isCloned}
                        visibility={savedVisibility}
                        pendingVisibility={effectivePending}
                        canGoPrivate={viewerCanGoPrivate}
                        disabledReason={collectionActions.privatePremiumGated}
                        isCloning={cloneCollection.isPending}
                        isPulling={previewPull.isPending || commitPull.isPending}
                        onAddRecipes={() => router.push(`/${locale}/collections/${id}/add` as Route)}
                        onPullUpdates={openPull}
                        onClone={() =>
                            cloneCollection.mutate(
                                { id },
                                {
                                    onSuccess: (created) =>
                                        router.push(`/${locale}/collections/${created.id}` as Route),
                                },
                            )
                        }
                        onVisibilityChange={setPendingVisibility}
                        onSaveVisibility={() =>
                            updateCollection.mutate({ id, request: { visibility: effectivePending } })
                        }
                    />
                    {isCloned && collection.sourceCollectionId !== undefined && (
                        <CloneInfoPanel
                            sourceOwnerHandle={collection.sourceOwnerHandle}
                            sourceCollectionName={collection.sourceCollectionName}
                            sourceCollectionId={collection.sourceCollectionId}
                            clonedAt={collection.createdAt}
                            locale={activeLocale}
                            onViewSource={(sourceId) => router.push(`/${locale}/collections/${sourceId}` as Route)}
                        />
                    )}
                </aside>

                <div className="min-w-0 flex-1">
                    <CollectionDetail
                        collection={collection}
                        error={mutationError}
                        onSelectRecipe={(recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route)}
                        onRemoveRecipe={(recipeId) => removeRecipe.mutate({ id, recipeId })}
                        onAddRecipe={() => router.push(`/${locale}/collections/${id}/add` as Route)}
                        renderNutrition={renderNutrition}
                    />
                </div>
            </div>

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
        </section>
    );
};
