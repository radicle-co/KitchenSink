/**
 * Recipe-detail screen (mobile). Drives the shared, presentational native `RecipeDetailView` building block from a
 * suspense read under `QueryBoundary`, which owns the localized loading state and the failure: a distinct not-found
 * message with no retry, or the generic error with a retry that refetches — the same three outcomes as the web
 * container. The settled view is keyed on `recipeId`, so a `replace`/deep-link that reuses this screen with a new id
 * remounts it: every mutation and the delete dialog start fresh, and nothing of the previous recipe can leak.
 * On top of the read view it composes the owner and viewer action blocks (T068 delete, T074 visibility,
 * T075 clone) plus edit (T067) and version-history (T069) entry points, gated by ownership and tier:
 *
 * - Owner actions (edit, version history, delete, visibility) render only for the recipe's owner. The
 *   private-visibility option is tier-gated (C-004): free-tier owners see it disabled with an upgrade reason.
 * - The clone action renders for a PUBLIC recipe the viewer does not own (US2), copying it into their recipes.
 *
 * A single `Viewer` (P4, `@kitchensink/recipe-core`) is built once per render from `useUserProfile` (the
 * viewer's app-user id + subscription tier); every ownership/clone/tier gate above reads from that ONE
 * `Viewer` through the shared `isOwner`/`canClone`/`canGoPrivate` policy predicates — the SAME predicates
 * the web detail container evaluates, so the two platforms can never diverge on a gate (this closes D7,
 * where the clone gate previously disagreed: web ignored ownership while mobile checked it). Every mutation
 * is owned here and reported upward so the navigator can route (back to the list after delete, to the new
 * recipe after clone). Remote state stays in the query cache — this screen derives its view state from it.
 *
 * The recipe page (build spec §6): the action row's primary — Edit recipe for the owner, Save a copy for another
 * cook who may clone — beside the ⋯ menu, whose entries come from the shared `detailMenuOf` (Version history, Make
 * private/public, Clear checks, then Delete); the rating block goes in the view's `rating` slot, under the nutrition.
 * The cook's marks, the serving scale and Screen on are bound by the view itself; this screen reads the marks only to
 * offer Clear checks.
 */
import {
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    detailMenuOf,
    isUnreachableRecovery,
    ratingModeFor,
    recipeActionMessages,
    useCookMarks,
    type DetailMenuItem,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { useTheme } from '@commise/ui/theme';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipeServiceClient,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { RecipeVisibility, canClone, canGoPrivate, isOwner, makeViewer } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LoadingState } from '../components/LoadingState.js';
import { mobileMessages } from '../i18n/messages.js';
import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link RecipeDetailScreen}. */
export interface RecipeDetailScreenProps {
    /** The id of the recipe to display. */
    readonly recipeId: string;
    /** Invoked when the back affordance is activated; the affordance is hidden when omitted. */
    readonly onBack?: () => void;
    /** Invoked with the recipe id when the owner opens the editor. */
    readonly onEdit?: (recipeId: string) => void;
    /** Invoked with the recipe id when the owner opens the version history. */
    readonly onViewVersions?: (recipeId: string) => void;
    /** Invoked after the recipe is successfully deleted. */
    readonly onDeleted?: () => void;
    /** Invoked with the copy's id after Save a copy; the navigator opens it in the editor (FR-005b). */
    readonly onCloned?: (recipeId: string) => void;
}

/**
 * The recipe-detail screen: the read boundary around the settled detail.
 *
 * @param props - The recipe id plus optional navigation and lifecycle callbacks.
 * @returns The loading state, a not-found or retrying error, or the populated detail view with its actions.
 */
export function RecipeDetailScreen(props: RecipeDetailScreenProps): JSX.Element {
    const { recipeId, onBack } = props;
    const { recipes: t } = useMessages(mobileMessages);
    const back = <BackAffordance label={t.back} onBack={onBack} />;

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
                        <Button variant="secondary" icon="refreshCw" onPress={resetErrorBoundary}>
                            {t.detailRetry}
                        </Button>
                    </View>
                )
            }
            resetKeys={[recipeId]}
        >
            <SettledRecipeDetail key={recipeId} {...props} />
        </QueryBoundary>
    );
}

/** The back control, rendered only when the navigator wires a back action. */
function BackAffordance({
    label,
    onBack,
}: {
    readonly label: string;
    readonly onBack?: () => void;
}): JSX.Element | null {
    const { colors } = useTheme();

    if (onBack === undefined) {
        return null;
    }

    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onBack} style={styles.backButton}>
            {/* `chevron-left` beside the word (`buildSpec.md` §3.5, F22). */}
            <Icon name="chevronLeft" size={20} tone="actionText" />
            <Text style={[styles.backLabel, { color: colors.actionText }]}>{label}</Text>
        </Pressable>
    );
}

/**
 * The detail once its read has settled: the shared view plus every action wired to its mutation.
 *
 * @param props - The recipe id plus optional navigation and lifecycle callbacks.
 * @returns The populated detail view with its actions, or the loading state while the viewer profile resolves.
 * @throws {Error} For an empty recipe id — a read that cannot be made fails into the boundary, as the generic failure.
 */
function SettledRecipeDetail({
    recipeId,
    onBack,
    onEdit,
    onViewVersions,
    onDeleted,
    onCloned,
}: RecipeDetailScreenProps): JSX.Element {
    if (recipeId.length === 0) {
        throw new Error('A recipe detail needs a recipe id.');
    }

    const { recipes: t } = useMessages(mobileMessages);
    const client = useRecipeServiceClient();
    const query = useSuspenseQuery(recipeQueries(client).detail(recipeId));
    // A failed refresh of the recipe on screen keeps it (a suspense read throws only when it has no data) and is
    // reported by the notice, never the load error.
    const refreshNotice = useRefreshNotice(query);
    // Plan 002 R2 — the retry behind the notice for lines food could not name: a SECOND notice state over the same
    // query, counting only retries that loaded every name, so its recoveries move the screen-reader cursor to the
    // Ingredients heading (not the title) and only when the button the cook pressed is gone.
    const unreachableRetry = useRefreshNotice(query, { recovered: isUnreachableRecovery });
    // The view binds the cook's marks itself; the ⋯ menu reads the same marks to offer Clear checks.
    const marks = useCookMarks(recipeId);
    const { detailActions, moreMenu, visibility: visibilityCopy } = useMessages(recipeActionMessages);
    const theme = useTheme();
    const profile = useUserProfile();
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const back = <BackAffordance label={t.back} onBack={onBack} />;

    // Wait for the viewer profile too before rendering the detail. Owner-gated UI (edit/delete/visibility actions)
    // and the rating mode are derived from `profile` (the viewer id + tier); rendering before it lands would paint
    // the detail WITHOUT the owner actions and then pop them in — shifting the layout mid-interaction. A signed-out
    // viewer's profile query is disabled, so its `isLoading` is false and this never hangs for a guest.
    if (profile.isLoading) {
        return <LoadingState label={t.detailLoading} />;
    }

    const recipe = query.data;
    const viewerId = profile.data?.user.id;
    // P4: ONE Viewer value object, built from this platform's identity signals (the profile's app-user id +
    // subscription tier), feeds every gate below through the shared policy predicates — the SAME predicates
    // the web detail container evaluates (D7).
    const viewer = makeViewer({ id: viewerId, subscriptionTier: profile.data?.account.subscriptionTier });
    const viewerIsOwner = isOwner(recipe, viewer);
    // D7: a viewer may clone a PUBLIC recipe they do not own — the SAME `canClone` predicate web now
    // evaluates, closing the drift where web ignored ownership and mobile checked it.
    const viewerCanClone = canClone(recipe, viewer);
    // C-004: making a recipe private is a premium capability, gated on the viewer's subscription tier — the
    // same signal the web detail container uses. Fails safe (OFF) while the profile loads or is absent
    // (`makeViewer` maps an absent/unrecognized tier to `'free'`).
    const viewerCanGoPrivate = canGoPrivate(viewer);

    // FR-013 ratings: the viewer may rate a recipe they can read and do NOT own (Sc8) — ownership is the only
    // client-side gate; the backend enforces the rest (Sc8 403, Sc9 not-found). A write's error maps to the
    // honest surface: a not-found (the client's 404 shape) is "not available" (Sc9), never "forbidden".
    const ratingMode = ratingModeFor({ viewerId, ownerId: recipe.ownerId });
    const ratingError = setRating.error ?? deleteRating.error;
    const ratingErrorKind: RecipeRatingError | undefined =
        ratingError === null || ratingError === undefined
            ? undefined
            : isNotFoundError(ratingError)
              ? 'notAvailable'
              : 'generic';
    // §6.1/§6.4: the action row is the primary — Edit recipe for the owner, Save a copy for another cook — and the ⋯
    // menu, whose entries are decided once for both platforms (`detailMenuOf`).
    //
    // ⛔ The delete CONFIRMATION DIALOG does NOT live in the menu: it stays a sibling below, so it survives the menu
    // closing while the dialog is open.
    const menu = detailMenuOf({
        owner: viewerIsOwner,
        isPublic: recipe.visibility === RecipeVisibility.PUBLIC,
        canGoPrivate: viewerCanGoPrivate,
        hasMarks: marks.hasMarks,
    });

    const menuItem = (item: DetailMenuItem): ActionMenuItem => {
        switch (item) {
            case 'versions':
                return {
                    id: item,
                    label: detailActions.versionHistory,
                    icon: 'clock',
                    onSelect: () => onViewVersions?.(recipeId),
                };
            case 'makePrivate':
                return {
                    id: item,
                    label: detailActions.makePrivate,
                    icon: 'lock',
                    onSelect: () => setVisibility.mutate({ id: recipeId, visibility: RecipeVisibility.PRIVATE }),
                };
            case 'makePublic':
                return {
                    id: item,
                    label: detailActions.makePublic,
                    icon: 'globe',
                    onSelect: () => setVisibility.mutate({ id: recipeId, visibility: RecipeVisibility.PUBLIC }),
                };
            case 'clearChecks':
                return { id: item, label: detailActions.clearChecks, icon: 'rotateCcw', onSelect: marks.clear };
        }
    };

    const moreActions =
        menu.items.length > 0 || menu.destructive !== undefined ? (
            <ActionMenu
                triggerLabel={moreMenu.triggerFor.replace('{title}', recipe.title)}
                title={moreMenu.title}
                closeLabel={moreMenu.close}
                items={menu.items.map(menuItem)}
                {...(menu.destructive === undefined
                    ? {}
                    : {
                          destructiveItem: {
                              id: 'delete',
                              label: detailActions.deleteRecipe,
                              icon: 'trash',
                              onSelect: () => setDeleteOpen(true),
                          },
                      })}
            />
        ) : null;
    const primary = viewerIsOwner ? (
        <Button variant="primary" icon="pencilLine" onPress={() => onEdit?.(recipeId)}>
            {detailActions.editRecipe}
        </Button>
    ) : viewerCanClone ? (
        <Button
            variant="primary"
            icon="copyPlus"
            busy={cloneRecipe.isPending}
            onPress={() => cloneRecipe.mutate(recipeId, { onSuccess: (created) => onCloned?.(created.id) })}
        >
            {detailActions.saveCopy}
        </Button>
    ) : null;
    const headerActions =
        primary === null && moreActions === null ? undefined : (
            <>
                {primary}
                {moreActions}
            </>
        );

    // The stars the input pre-selects: the server's `viewerRating` (DA4 — `useSetRecipeRating` /
    // `useDeleteRecipeRating` patch this optimistically in the cache on `onMutate`, so it never flickers back
    // to the pre-write value before the refetch lands). The community `averageRating` stays the displayed score.
    const selectedStars = recipe.viewerRating;

    return (
        // ScrollView, not View: the recipe body exceeds the viewport on any real recipe.
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            {back}
            <RecipeDetailView
                recipe={recipe}
                viewerIsOwner={viewerIsOwner}
                refreshNotice={refreshNotice}
                unreachableRetry={unreachableRetry}
                headerActions={headerActions}
                onEditSection={() => onEdit?.(recipeId)}
                {...(viewerIsOwner ? { onViewVersions: () => onViewVersions?.(recipeId) } : {})}
                rating={
                    // Orchestration picks the render component (B15): the owner sees the read-only aggregate (Sc8);
                    // everyone else gets the interactive input. The own-recipe gate lives HERE, not in a mode prop.
                    ratingMode === 'own' ? (
                        <RecipeRatingDisplay
                            {...(recipe.averageRating === undefined ? {} : { average: recipe.averageRating })}
                            ratingCount={recipe.ratingCount}
                        />
                    ) : (
                        <RecipeRatingInput
                            {...(recipe.averageRating === undefined ? {} : { average: recipe.averageRating })}
                            ratingCount={recipe.ratingCount}
                            {...(selectedStars === undefined ? {} : { selectedStars })}
                            pending={setRating.isPending || deleteRating.isPending}
                            {...(ratingErrorKind === undefined ? {} : { error: ratingErrorKind })}
                            onRate={(stars) => setRating.mutate({ id: recipeId, input: { stars } })}
                            onRemove={() => deleteRating.mutate(recipeId)}
                        />
                    )
                }
            />

            {/* B17 — a failed visibility change snaps back to the query's value; say so rather than fail silently. */}
            {setVisibility.error !== null && (
                <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.dangerText }]}>
                    {visibilityCopy.error}
                </Text>
            )}

            {viewerIsOwner && (
                <RecipeDeleteDialog
                    recipeTitle={recipe.title}
                    open={deleteOpen}
                    deleting={deleteRecipe.isPending}
                    // B17 — a failed delete left the dialog open with no explanation; surface an honest
                    // reason inside it. Cleared on the next attempt (and on recipe switch).
                    error={deleteRecipe.error !== null}
                    onConfirm={() => deleteRecipe.mutate(recipeId, { onSuccess: () => onDeleted?.() })}
                    onCancel={() => setDeleteOpen(false)}
                />
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    container: { flex: 1, backgroundColor: 'transparent' },
    // Generous bottom padding so the foot-of-screen controls — including the inline delete dialog's confirm
    // button when it opens — clear the device's navigation bar and can be fully scrolled into view.
    content: { paddingBottom: 120 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    backButton: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 16,
    },
    backLabel: { fontWeight: '500', fontSize: 15 },
    error: { paddingHorizontal: 16 },
});
