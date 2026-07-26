/**
 * Recipe-detail screen (mobile). Drives the shared, presentational native `RecipeDetailView` building block
 * from the typed `useRecipe` query, rendering localized loading and error states until the recipe resolves.
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
 * Recipe-detail wireframe parity (C3/C4): Edit stays the sole primary, always-visible owner control; version
 * history, the visibility toggle, and the delete trigger are grouped behind a `MoreActionsMenu` (C4,
 * `[Edit] [More]`). The clone action is passed into `RecipeDetailView`'s `footerActions` slot so it renders
 * alongside the version + visibility badges in ONE grouped footer row (C3), instead of as a separate block.
 */
import {
    MoreActionsMenu,
    RecipeCloneAction,
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingDisplay,
    RecipeRatingInput,
    RecipeVisibilityToggle,
    ratingModeFor,
    useCookingProgress,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipe,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { canClone, canGoPrivate, isOwner, makeViewer, type RecipeVisibility } from '@kitchensink/recipe-core';
import { Feather } from '@expo/vector-icons';
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
    /** Invoked with the new recipe's id after a successful clone. */
    readonly onCloned?: (recipeId: string) => void;
    /** Invoked with a tag when the viewer taps a tag chip to filter search (D6). */
    readonly onFilterByTag?: (tag: string) => void;
}

/**
 * The recipe-detail screen.
 *
 * @param props - The recipe id plus optional navigation and lifecycle callbacks.
 * @returns The loading, error, or populated detail view with its actions.
 */
export function RecipeDetailScreen({
    recipeId,
    onBack,
    onEdit,
    onViewVersions,
    onDeleted,
    onCloned,
    onFilterByTag,
}: RecipeDetailScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const query = useRecipe(recipeId);
    // D4/D5: session-scoped cooking progress (survives navigate-away-and-back) lives in the orchestration
    // layer; the presentational view receives the checked sets + toggles as props.
    const cooking = useCookingProgress(recipeId);
    const profile = useUserProfile();
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [ratingRecipeId, setRatingRecipeId] = useState(recipeId);

    if (ratingRecipeId !== recipeId) {
        // A fresh push mounts a new screen, but a `replace`/deep-link reuses THIS screen instance with a new
        // `recipeId` param — so on an id change we must scrub every scrap of the previous recipe's mutation
        // state. Resetting the mutations clears their `error` and `isPending` — otherwise the previous
        // recipe's failed/in-flight write leaks onto the new one, which shares the same `useMutation`
        // instance, falsely showing a stale error or busy state. This covers the rating writes AND (B17) the
        // visibility toggle + delete, whose errors now render. The render-phase `setRatingRecipeId` forces an
        // immediate re-render, by which point the observers are idle.
        setRatingRecipeId(recipeId);
        setRating.reset();
        deleteRating.reset();
        setVisibility.reset();
        deleteRecipe.reset();
    }

    const back =
        onBack !== undefined ? (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.back}
                onPress={onBack}
                style={styles.backButton}
            >
                <Text style={styles.backLabel}>{t.back}</Text>
            </Pressable>
        ) : null;

    // Wait for BOTH the recipe AND the viewer profile before rendering the detail. Owner-gated UI
    // (edit/delete/visibility actions) and the rating mode are derived from `profile` (the viewer id +
    // tier); if we rendered as soon as the recipe resolved, the profile would still be in flight, the
    // owner actions would be absent, and then POP IN when it lands — shifting the layout mid-interaction.
    // Gating on `profile.isLoading` too makes the owner-gated surface deterministic on first paint (no
    // flicker). A signed-out viewer's profile query is disabled, so its `isLoading` is false and this
    // never hangs for a guest reading a public recipe.
    if (query.isLoading || profile.isLoading) {
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
    const changeVisibility = (next: RecipeVisibility): void => setVisibility.mutate({ id: recipeId, visibility: next });

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
    // The stars the input pre-selects: the server's `viewerRating` (DA4 — `useSetRecipeRating` /
    // `useDeleteRecipeRating` patch this optimistically in the cache on `onMutate`, so it never flickers back
    // to the pre-write value before the refetch lands). The community `averageRating` stays the displayed score.
    const selectedStars = recipe.viewerRating;

    return (
        // ScrollView, not View: the detail (recipe body + rating + owner actions incl. the inline delete
        // dialog, or the clone action) exceeds the viewport, so those foot-of-screen controls are otherwise
        // unreachable on a device.
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            {back}
            <RecipeDetailView
                recipe={recipe}
                checkedIngredients={cooking.checkedIngredients}
                onToggleIngredient={cooking.toggleIngredient}
                checkedSteps={cooking.checkedSteps}
                onToggleStep={cooking.toggleStep}
                onFilterByTag={onFilterByTag}
                // C3 wireframe parity: the clone action lives IN the detail's grouped footer row, alongside
                // the version + visibility badges, rather than as a loose block below every other control.
                // D7: `canClone` (P4) already combines "public" + "not the owner" — the SAME predicate the
                // web container evaluates, so the two platforms can no longer disagree on this gate.
                footerActions={
                    viewerCanClone && (
                        <RecipeCloneAction
                            canClone={viewerCanClone}
                            {...(recipe.sourceAttribution === undefined
                                ? {}
                                : { sourceAttribution: recipe.sourceAttribution })}
                            cloning={cloneRecipe.isPending}
                            onClone={() =>
                                cloneRecipe.mutate(recipeId, { onSuccess: (created) => onCloned?.(created.id) })
                            }
                        />
                    )
                }
            />

            {/* Orchestration picks the render component (B15): the owner sees the read-only aggregate (Sc8);
                everyone else gets the interactive input. The own-recipe gate lives HERE, not in a mode prop. */}
            {ratingMode === 'own' ? (
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
            )}

            {viewerIsOwner && (
                <View style={styles.ownerActions}>
                    {/* C4 wireframe parity (`[Edit] [More]`): Edit stays the sole primary, always-visible
                        owner control; Version history, visibility, and the delete trigger — the SECONDARY
                        actions — move behind the "More" overflow menu. The delete CONFIRMATION dialog stays a
                        sibling, not menu content, so it survives independently of the menu's open state. */}
                    <View style={styles.headerActionsRow}>
                        {/* U8: the three owner controls are DS `Button`s — Edit takes the gradient `primary`
                            tier, Version history the flat `secondary`, and Delete the error-toned
                            `destructive`. The primitive owns the 44pt target, the press-scale, and the
                            accessible name, so this screen no longer hand-rolls a parallel pill. */}
                        <Button
                            variant="primary"
                            icon={<Feather name="edit-2" size={16} color={palette.white} />}
                            onPress={() => onEdit?.(recipeId)}
                        >
                            {t.editAction}
                        </Button>
                        <MoreActionsMenu>
                            <Button
                                variant="secondary"
                                icon={<Feather name="clock" size={16} color={palette.charcoal} />}
                                onPress={() => onViewVersions?.(recipeId)}
                            >
                                {t.versionsAction}
                            </Button>
                            <RecipeVisibilityToggle
                                visibility={recipe.visibility}
                                canGoPrivate={viewerCanGoPrivate}
                                disabledReason={viewerCanGoPrivate ? undefined : t.visibilityUpgradeReason}
                                // B17 — a failed toggle snaps back to the query's value; surface an honest
                                // reason so the change doesn't fail silently. Cleared on the next attempt (and
                                // on recipe switch).
                                error={setVisibility.error !== null && setVisibility.error !== undefined}
                                onChange={changeVisibility}
                            />
                            <Button
                                variant="destructive"
                                icon={<Feather name="trash-2" size={16} color={palette.error} />}
                                onPress={() => setDeleteOpen(true)}
                            >
                                {t.deleteAction}
                            </Button>
                        </MoreActionsMenu>
                    </View>
                    <RecipeDeleteDialog
                        recipeTitle={recipe.title}
                        open={deleteOpen}
                        deleting={deleteRecipe.isPending}
                        // B17 — a failed delete left the dialog open with no explanation; surface an honest
                        // reason inside it. Cleared on the next attempt (and on recipe switch).
                        error={deleteRecipe.error !== null && deleteRecipe.error !== undefined}
                        onConfirm={() => deleteRecipe.mutate(recipeId, { onSuccess: () => onDeleted?.() })}
                        onCancel={() => setDeleteOpen(false)}
                    />
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.sand },
    // Generous bottom padding so the foot-of-screen controls — including the inline delete dialog's confirm
    // button when it opens — clear the device's navigation bar and can be fully scrolled into view.
    content: { paddingBottom: 120 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    backButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16 },
    backLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 15 },
    ownerActions: { gap: 12, paddingHorizontal: 16, paddingBottom: 24 },
    // `[Edit] [More]` (C4 wireframe parity): Edit and the More trigger sit side by side as the header's
    // primary + overflow controls. The action surfaces themselves belong to the DS `Button` (U8) — this row
    // only positions them.
    headerActionsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
