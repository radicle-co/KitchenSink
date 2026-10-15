'use client';

/**
 * Container for the collection-detail route (orchestration; W5 Task 12; slice 5 of the UI overhaul, `docs/design/uiOverhaul/buildSpec.md`
 * §5.2, §5.3). It reads a single collection (with its member recipes) and composes the shared building blocks around it:
 * the {@link CollectionHeader} (back, name, meta, description, Add recipes and the ⋯ menu), the {@link CollectionMembers}
 * list, the rename sheet, the delete confirmation, the Premium sheet, the add-recipes picker and the pull-updates dialog.
 * The fetch-state affordances (loading, generic error with retry, distinct not-found) belong to the app, not the blocks.
 *
 * The read is a suspense read under a `ClientQueryBoundary` — hydration-gated, because this route is not
 * server-prefetched. A background refetch that fails while the collection is on screen does not throw, so the cook keeps
 * reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is KEYED
 * on the id: the App Router keeps this container mounted across `/collections/A` → `/collections/B`, and the remount is what
 * clears A's pending removal, sheets and pull state before B renders.
 *
 * Remote state stays in TanStack Query: the view is derived from the query, never copied into local state. The hooks own
 * the work — `useMemberRemoval` (a removal hides the row and commits when its Undo snackbar times out),
 * `useCollectionVisibility` (changes at once, with a compensating Undo and the Premium sheet), `useCollectionPull` (the
 * preview → commit → drift machine) — and the only local state is which sheet is open and the picker's search.
 *
 * Paid-feature gate (plan 2026-10-14-009 D14): the viewer's `paidFeatureStateOf` the profile — the SAME signal the recipe
 * detail container and the mobile screen read — decides whether the ⋯ menu offers the visibility item and what choosing
 * private does. While the profile loads, or if it failed, nothing private is offered.
 *
 * @pattern Facade — one screen over the removal, visibility, pull and picker hooks and the sheets they drive
 */
import {
    CollectionDeleteDialog,
    CollectionHeader,
    CollectionMembers,
    CollectionPickerRow,
    CollectionRecipePicker,
    CollectionRecipePickerCandidates,
    CollectionRecipePickerLoadError,
    CollectionRecipePickerLoading,
    CollectionSheet,
    CollectionUpsellSheet,
    offersPrivate,
    PullUpdatesDialog,
    RecipeNutritionSlot,
    cardVariantOf,
    collectionMessages,
    doneSummaryOf,
    fillTemplate,
    narrowByTitle,
    useMainContainerClass,
    viewModeCookieFor,
    viewModeOf,
    type ListViewMode,
} from '@commise/features-recipes';
import {
    useCollectionPull,
    useCollectionVisibility,
    useMemberRemoval,
    useMemberToggle,
    usePickerAnnouncement,
    useRecipeNutritionBatches,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { paidFeatureStateOf } from '@commise/features-account';
import type { Recipe } from '@kitchensink/recipe-core';
import { collectionQueries, isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useCloneCollection,
    useDeleteCollection,
    useRecipeServiceClient,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { CollectionLoadError } from '@/components/recipes/CollectionLoadError';
import { CollectionNotFound } from '@/components/recipes/CollectionNotFound';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

/** The id of the page's H1, which takes focus when the last row is removed. */
const COLLECTION_TITLE_ID = 'collection-title';

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
    const { collections } = useMessages(webMessages);

    return (
        <ClientQueryBoundary
            loading={
                <p role="status" aria-label={collections.detail.loadingLabel} className="py-8 text-body text-ink-muted">
                    {collections.detail.loadingLabel}
                </p>
            }
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? (
                    <CollectionNotFound locale={locale} />
                ) : (
                    <CollectionLoadError onRetry={resetErrorBoundary} />
                )
            }
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

/** Props for the add-recipes picker's rows. */
interface PickerBodyProps {
    readonly collectionId: string;
    readonly query: string;
    readonly onClearSearch: () => void;
    readonly onCreateRecipe: () => void;
}

/** One picker row, with its own toggle (`useMemberToggle`: a per-row mutation, serialized per pair). */
const PickerRow: FC<{
    readonly collectionId: string;
    readonly recipe: Recipe;
    readonly checked: boolean;
}> = ({ collectionId, recipe, checked }) => {
    const toggle = useMemberToggle(collectionId, recipe);

    return (
        <CollectionPickerRow
            recipe={recipe}
            checked={checked}
            {...(toggle.failed ? { failed: toggle.failedMember ? ('add' as const) : ('remove' as const) } : {})}
            onToggle={toggle.press}
        />
    );
};

/**
 * The picker's settled body: the whole library (the same read My recipes narrows on the device), narrowed by the search,
 * with each row's membership read off the collection — which the toggles rewrite at once.
 *
 * @param props - The collection, the search, and the empty states' actions.
 * @returns The rows, or the reason there are none.
 */
const PickerBody: FC<PickerBodyProps> = ({ collectionId, query, onClearSearch, onCreateRecipe }) => {
    const client = useRecipeServiceClient();
    const library = useSuspenseInfiniteQuery(recipeQueries(client).library({ sortBy: 'updatedAt' }));
    const collection = useSuspenseQuery(collectionQueries(client).detail(collectionId));
    const members = useMemo(
        () => new Set(collection.data.recipes.map((recipe) => recipe.id)),
        [collection.data.recipes],
    );
    const recipes = useMemo(
        () =>
            narrowByTitle(
                library.data.pages.flatMap((chunk) => chunk.data),
                query,
            ),
        [library.data.pages, query],
    );

    return (
        <CollectionRecipePickerCandidates
            recipes={recipes}
            query={query}
            onClearSearch={onClearSearch}
            onCreateRecipe={onCreateRecipe}
            renderRow={(recipe) => (
                <PickerRow collectionId={collectionId} recipe={recipe} checked={members.has(recipe.id)} />
            )}
        />
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
    const { member: copy, picker } = useMessages(collectionMessages);
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(id));
    const collection = query.data;
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    const deleteCollection = useDeleteCollection();
    const updateCollection = useUpdateCollection();
    const cloneCollection = useCloneCollection();
    const pull = useCollectionPull(id);

    // Plan 2026-10-14-009 D14: private from the viewer's paid features alone (owner ruling 2026-10-13).
    const paidFeatures = paidFeatureStateOf(profile);
    const visibility = useCollectionVisibility({ id, paidFeatures });
    const removal = useMemberRemoval({ id, name: collection.name });
    const announcement = usePickerAnnouncement(id);

    const container = useMainContainerClass();
    const [viewChoice, setViewChoice] = useState<ListViewMode | undefined>(storedViewMode);
    const viewMode = viewModeOf(viewChoice, container);
    const variant = cardVariantOf(container, viewMode, 'library');

    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    // The members when the picker opened: Done's "2 added, 1 removed" is the difference from this, not a count of presses.
    const [membersAtOpen, setMembersAtOpen] = useState<readonly string[]>([]);

    const memberIds = useMemo(() => collection.recipes.map((recipe) => recipe.id), [collection.recipes]);
    const members = useMemo(
        () => collection.recipes.filter((recipe) => !removal.hiddenIds.includes(recipe.id)),
        [collection.recipes, removal.hiddenIds],
    );
    // The compact card draws no figure, so a batch for it would have nobody to read the promise (a rejection would go unhandled).
    const nutritionFor = useRecipeNutritionBatches(variant === 'compact' ? [] : [memberIds]);
    const renderNutrition = useCallback(
        (recipeId: string) => {
            const batch = nutritionFor(recipeId);

            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [nutritionFor],
    );

    const listHref = `/${locale}/collections`;

    const openPicker = (): void => {
        setMembersAtOpen(memberIds);
        setPickerQuery('');
        setPickerOpen(true);
    };

    return (
        <section aria-label={collection.name} className="mx-auto flex w-full max-w-page flex-col gap-6">
            <CollectionHeader
                name={collection.name}
                {...(collection.description === undefined ? {} : { description: collection.description })}
                visibility={collection.visibility}
                recipeCount={members.length}
                {...(collection.sourceCollectionName === undefined
                    ? {}
                    : { sourceCollectionName: collection.sourceCollectionName })}
                {...(collection.sourceOwnerDisplayName === undefined
                    ? {}
                    : { sourceOwnerDisplayName: collection.sourceOwnerDisplayName })}
                {...(collection.sourceOwnerUsername === undefined
                    ? {}
                    : { sourceOwnerUsername: collection.sourceOwnerUsername })}
                {...(collection.sourceCollectionId === undefined
                    ? {}
                    : { sourceCollectionId: collection.sourceCollectionId })}
                {...(collection.lastPulledAt === undefined ? {} : { lastPulledAt: collection.lastPulledAt })}
                actionsPlacement={container === 'narrow' ? 'below' : 'title'}
                headingId={COLLECTION_TITLE_ID}
                headingFocusSignal={0}
                onBack={() => router.push(listHref as Route)}
                backHref={listHref}
                onAddRecipes={openPicker}
                onViewSource={(sourceId) => router.push(`/${locale}/collections/${sourceId}` as Route)}
                refreshNotice={refreshNotice}
                onRename={() => {
                    updateCollection.reset();
                    setRenameOpen(true);
                }}
                {...(offersPrivate(paidFeatures, collection.visibility)
                    ? {
                          onToggleVisibility: () =>
                              visibility.change(collection.visibility === 'public' ? 'private' : 'public'),
                      }
                    : {})}
                onSaveCopy={() =>
                    cloneCollection.mutate(
                        { id },
                        { onSuccess: (created) => router.push(`/${locale}/collections/${created.id}` as Route) },
                    )
                }
                onPullUpdates={pull.start}
                onDelete={() => {
                    deleteCollection.reset();
                    setDeleteOpen(true);
                }}
            />

            {visibility.failed ? (
                <p role="alert" className="text-body text-danger-text">
                    {copy.visibilityFailed}
                </p>
            ) : null}
            {cloneCollection.isError ? (
                <p role="alert" className="text-body text-danger-text">
                    {copy.saveCopyFailed}
                </p>
            ) : null}

            <CollectionMembers
                members={members}
                viewMode={viewMode}
                onViewModeChange={(mode) => {
                    setViewChoice(mode);
                    document.cookie = viewModeCookieFor(mode);
                }}
                variant={variant}
                hrefOf={(recipeId) => `/${locale}/recipes/${recipeId}`}
                onSelectRecipe={(recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route)}
                onRemoveRecipe={removal.remove}
                onAddRecipes={openPicker}
                {...(removal.failedTitle === undefined ? {} : { removeFailedTitle: removal.failedTitle })}
                renderNutrition={renderNutrition}
                headingId={COLLECTION_TITLE_ID}
            />

            <CollectionSheet
                open={renameOpen}
                onOpenChange={setRenameOpen}
                intent="rename"
                initial={{
                    name: collection.name,
                    ...(collection.description === undefined ? {} : { description: collection.description }),
                }}
                submitting={updateCollection.isPending}
                failed={updateCollection.isError}
                onRename={(request) =>
                    updateCollection.mutate({ id, request }, { onSuccess: () => setRenameOpen(false) })
                }
            />

            <CollectionDeleteDialog
                open={deleteOpen}
                name={collection.name}
                recipeCount={members.length}
                busy={deleteCollection.isPending}
                failed={deleteCollection.isError}
                onKeep={() => setDeleteOpen(false)}
                onConfirm={() => deleteCollection.mutate(id, { onSuccess: () => router.push(listHref as Route) })}
            />

            <CollectionUpsellSheet
                open={visibility.upsellOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        visibility.closeUpsell();
                    }
                }}
                onSeePremium={visibility.closeUpsell}
            />

            <CollectionRecipePicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                collectionName={collection.name}
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                summary={doneSummaryOf(membersAtOpen, memberIds)}
                {...(announcement === undefined
                    ? {}
                    : {
                          announcement: {
                              text: fillTemplate(
                                  announcement.member ? picker.addedAnnouncement : picker.removedAnnouncement,
                                  { title: announcement.title },
                              ),
                              occurrence: announcement.at,
                          },
                      })}
            >
                <ClientQueryBoundary
                    loading={<CollectionRecipePickerLoading />}
                    renderError={({ resetErrorBoundary }) => (
                        <CollectionRecipePickerLoadError onRetry={resetErrorBoundary} />
                    )}
                    resetKeys={[id]}
                >
                    <PickerBody
                        collectionId={id}
                        query={pickerQuery}
                        onClearSearch={() => setPickerQuery('')}
                        onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
                    />
                </ClientQueryBoundary>
            </CollectionRecipePicker>

            {collection.sourceCollectionId !== undefined && (
                <PullUpdatesDialog
                    open={pull.open}
                    diff={pull.diff}
                    isLoadingPreview={pull.isLoadingPreview}
                    isCommitting={pull.isCommitting}
                    error={pull.error}
                    sourceOwnerDisplayName={collection.sourceOwnerDisplayName}
                    sourceOwnerUsername={collection.sourceOwnerUsername}
                    sourceCollectionName={collection.sourceCollectionName}
                    onCancel={pull.cancel}
                    onConfirm={pull.confirm}
                />
            )}
        </section>
    );
};
