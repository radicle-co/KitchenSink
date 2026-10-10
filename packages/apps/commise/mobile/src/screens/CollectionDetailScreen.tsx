/**
 * Collection-detail screen (mobile, orchestration; slice 5 of the UI overhaul, `docs/design/uiOverhaul/buildSpec.md` §5.2, §5.3 — the native
 * mirror of `CollectionDetailContainer`). Reads the collection with its members and composes the shared native blocks: the
 * {@link CollectionHeader} (back, name, meta, description, Add recipes and the ⋯ menu), the {@link CollectionMembers} list,
 * and the sheets the header opens — rename ({@link CollectionSheet}), delete ({@link CollectionDeleteDialog}), Premium
 * ({@link CollectionUpsellSheet}), the add-recipes picker and the pull-updates dialog. Rename and Add recipes are sheets on
 * this screen, not routes.
 *
 * The read is a suspense read under a `QueryBoundary`, which owns the localized loading state and the failure: not-found (no
 * retry) or the load error with a retry that refetches, each with Back — the same choice the web container makes, from the
 * client's `isNotFoundError`. A background refetch that fails while the collection is on screen does not throw, so the cook
 * keeps reading it, and the header's refresh notice says so and offers a retry. The settled {@link CollectionDetailView} is
 * KEYED on the id: a `replace` or deep link can reuse this screen with another collection, and the remount clears the
 * previous collection's pending removal, sheets and pull state.
 *
 * Remote state stays in TanStack Query. The hooks own the work: `useMemberRemoval` (a removal hides the row and commits when
 * its Undo snackbar times out), `useCollectionVisibility` (changes at once, with a compensating Undo and the Premium sheet),
 * `useCollectionPull` (the preview, commit and drift machine) and `useMemberToggle` (the picker's per-row mutations). The
 * only local state is which sheet is open, the picker's search and the list/grid choice.
 *
 * Premium gate (C1): a single `Viewer` (P4) is built from `useUserProfile` (app-user id + subscription tier) and the shared
 * `canGoPrivate` predicate — the SAME predicate the web container evaluates; it fails safe (gated OFF) while the profile
 * loads or is absent.
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
    PullUpdatesDialog,
    RecipeNutritionSlot,
    cardVariantOf,
    collectionMessages,
    doneSummaryOf,
    fillTemplate,
    narrowByTitle,
    useMainContainerClass,
    viewModeOf,
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
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { canGoPrivate, makeViewer, type Recipe } from '@kitchensink/recipe-core';
import { collectionQueries, isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useCloneCollection,
    useDeleteCollection,
    useRecipeServiceClient,
    useUpdateCollection,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FC, type JSX } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { LoadingState } from '../components/LoadingState.js';
import { useStoredViewMode } from '../hooks/useStoredViewMode.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { mobileMessages } from '../i18n/messages.js';

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
 * A fallback body of the read boundary: Back, a message, and the one action that applies.
 *
 * @param props - Back, the message, and the optional retry.
 * @returns The centred fallback.
 */
const DetailFallback: FC<{
    readonly message: string;
    readonly backLabel: string;
    readonly onBack: () => void;
    readonly retry?: { readonly label: string; readonly onRetry: () => void };
}> = ({ message, backLabel, onBack, retry }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.center}>
            <Button variant="ghost" icon="chevronLeft" onPress={onBack}>
                {backLabel}
            </Button>
            <Text role="alert" style={{ color: colors.ink }}>
                {message}
            </Text>
            {retry === undefined ? null : (
                <Button variant="primary" icon="refreshCw" onPress={retry.onRetry}>
                    {retry.label}
                </Button>
            )}
        </View>
    );
};

/**
 * The collection-detail screen: its read boundary around {@link CollectionDetailView}.
 *
 * @param props - The collection id and the navigation/lifecycle callbacks the navigator wires.
 * @returns The boundary: loading, not-found or a retrying error, and the composed detail view once the read settles.
 */
export function CollectionDetailScreen(props: CollectionDetailScreenProps): JSX.Element {
    const { collectionId, onBack } = props;
    const { collections: t } = useMessages(mobileMessages);

    return (
        <QueryBoundary
            loading={<LoadingState label={t.detailLoading} />}
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? (
                    <DetailFallback message={t.detailNotFound} backLabel={t.back} onBack={onBack} />
                ) : (
                    <DetailFallback
                        message={t.detailError}
                        backLabel={t.back}
                        onBack={onBack}
                        retry={{ label: t.detailRetry, onRetry: resetErrorBoundary }}
                    />
                )
            }
            resetKeys={[collectionId]}
        >
            <CollectionDetailView key={collectionId} {...props} />
        </QueryBoundary>
    );
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
 * The picker's settled body: the whole library, narrowed by the search, with each row's membership read off the collection,
 * which the toggles rewrite at once.
 *
 * @param props - The collection, the search, and the empty states' actions.
 * @returns The rows, or the reason there are none.
 */
const PickerBody: FC<{
    readonly collectionId: string;
    readonly query: string;
    readonly onClearSearch: () => void;
    readonly onCreateRecipe: () => void;
}> = ({ collectionId, query, onClearSearch, onCreateRecipe }) => {
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

    const { member: copy, picker } = useMessages(collectionMessages);
    const profile = useUserProfile();
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(collectionQueries(client).detail(collectionId));
    const collection = query.data;
    // A failed refresh of the collection on screen does not throw into the boundary: it keeps the collection and is
    // reported by the header's refresh notice.
    const refreshNotice = useRefreshNotice(query);
    const deleteCollection = useDeleteCollection();
    const updateCollection = useUpdateCollection();
    const cloneCollection = useCloneCollection();
    const pull = useCollectionPull(collectionId);

    // P4: ONE Viewer, built from the profile's app-user id + subscription tier, feeds the visibility gate through the shared
    // `canGoPrivate` predicate — the SAME predicate the web container evaluates (C1). Fails safe (OFF) while the profile
    // loads or is absent.
    const viewer = makeViewer({ id: profile.data?.user.id, subscriptionTier: profile.data?.account.subscriptionTier });
    const visibility = useCollectionVisibility({ id: collectionId, canGoPrivate: canGoPrivate(viewer) });
    const removal = useMemberRemoval({ id: collectionId, name: collection.name });
    const announcement = usePickerAnnouncement(collectionId);

    const container = useMainContainerClass();
    const [viewChoice, setViewChoice] = useStoredViewMode();
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
    // The deferred calorie lookup (ADR-0021 §6), fed from EVERY member, not the revealed window: the window grows on tap,
    // and batching it would re-batch on every "load more" and blink the figures already on screen back to skeletons.
    // The compact card draws no figure, so a batch for it would have nobody to read the promise (a rejection would go unhandled).
    const nutritionFor = useRecipeNutritionBatches(variant === 'compact' ? [] : [memberIds]);
    const renderNutrition = useCallback(
        (recipeId: string) => {
            const batch = nutritionFor(recipeId);

            return batch === null ? null : <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;
        },
        [nutritionFor],
    );

    const openPicker = (): void => {
        setMembersAtOpen(memberIds);
        setPickerQuery('');
        setPickerOpen(true);
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <CollectionHeader
                name={collection.name}
                {...(collection.description === undefined ? {} : { description: collection.description })}
                visibility={collection.visibility}
                recipeCount={members.length}
                {...(collection.sourceCollectionName === undefined
                    ? {}
                    : { sourceCollectionName: collection.sourceCollectionName })}
                {...(collection.sourceOwnerHandle === undefined
                    ? {}
                    : { sourceOwnerHandle: collection.sourceOwnerHandle })}
                {...(collection.sourceCollectionId === undefined
                    ? {}
                    : { sourceCollectionId: collection.sourceCollectionId })}
                {...(collection.lastPulledAt === undefined ? {} : { lastPulledAt: collection.lastPulledAt })}
                actionsPlacement={container === 'narrow' ? 'below' : 'title'}
                headingId="collection-title"
                headingFocusSignal={0}
                onBack={onBack}
                onAddRecipes={openPicker}
                onViewSource={onViewSource}
                refreshNotice={refreshNotice}
                onRename={() => {
                    updateCollection.reset();
                    setRenameOpen(true);
                }}
                onToggleVisibility={() => visibility.change(collection.visibility === 'public' ? 'private' : 'public')}
                onSaveCopy={() =>
                    cloneCollection.mutate({ id: collectionId }, { onSuccess: (created) => onCloned(created.id) })
                }
                onPullUpdates={pull.start}
                onDelete={() => {
                    deleteCollection.reset();
                    setDeleteOpen(true);
                }}
            />

            <AlertLine shown={visibility.failed} text={copy.visibilityFailed} />
            <AlertLine shown={cloneCollection.isError} text={copy.saveCopyFailed} />

            <CollectionMembers
                members={members}
                viewMode={viewMode}
                onViewModeChange={setViewChoice}
                variant={variant}
                onSelectRecipe={onSelectRecipe}
                onRemoveRecipe={removal.remove}
                onAddRecipes={openPicker}
                {...(removal.failedTitle === undefined ? {} : { removeFailedTitle: removal.failedTitle })}
                renderNutrition={renderNutrition}
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
                    updateCollection.mutate({ id: collectionId, request }, { onSuccess: () => setRenameOpen(false) })
                }
            />

            <CollectionDeleteDialog
                open={deleteOpen}
                name={collection.name}
                recipeCount={members.length}
                busy={deleteCollection.isPending}
                failed={deleteCollection.isError}
                onKeep={() => setDeleteOpen(false)}
                onConfirm={() => deleteCollection.mutate(collectionId, { onSuccess: onDeleted })}
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
                <QueryBoundary
                    loading={<CollectionRecipePickerLoading />}
                    renderError={({ resetErrorBoundary }) => (
                        <CollectionRecipePickerLoadError onRetry={resetErrorBoundary} />
                    )}
                    resetKeys={[collectionId]}
                >
                    <PickerBody
                        collectionId={collectionId}
                        query={pickerQuery}
                        onClearSearch={() => setPickerQuery('')}
                        onCreateRecipe={() => {
                            setPickerOpen(false);
                            onCreateRecipe();
                        }}
                    />
                </QueryBoundary>
            </CollectionRecipePicker>

            {collection.sourceCollectionId !== undefined && (
                <PullUpdatesDialog
                    open={pull.open}
                    diff={pull.diff}
                    isLoadingPreview={pull.isLoadingPreview}
                    isCommitting={pull.isCommitting}
                    error={pull.error}
                    sourceOwnerHandle={collection.sourceOwnerHandle}
                    sourceCollectionName={collection.sourceCollectionName}
                    onCancel={pull.cancel}
                    onConfirm={pull.confirm}
                />
            )}
        </ScrollView>
    );
}

/**
 * A line the screen says when an action failed.
 *
 * @param props - Whether to say it, and what.
 * @returns The alert, or nothing.
 */
const AlertLine: FC<{ readonly shown: boolean; readonly text: string }> = ({ shown, text }) => {
    const { colors } = useTheme();

    return shown ? (
        <Text role="alert" style={[styles.alert, { color: colors.dangerText }]}>
            {text}
        </Text>
    ) : null;
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    // The screen gutter the Collections list keeps (`CollectionListFrame`), so the title and its row do not start at
    // the screen's edge.
    content: { paddingHorizontal: nativeTokens.spacing[4], paddingBottom: 120 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    alert: { paddingHorizontal: 16, paddingVertical: 8 },
});
