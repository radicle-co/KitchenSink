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
 * Ownership and tier come from `useUserProfile` (the viewer's app id + subscription tier); every mutation is
 * owned here and reported upward so the navigator can route (back to the list after delete, to the new
 * recipe after clone). Remote state stays in the query cache — this screen derives its view state from it.
 */
import {
    RecipeCloneAction,
    RecipeDeleteDialog,
    RecipeDetailView,
    RecipeRatingControl,
    RecipeVisibilityToggle,
    ratingModeFor,
    resolveSelectedStars,
    type RatingSelectionOverride,
    type RecipeRatingError,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useRecipe,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { RecipeVisibility, type RecipeVisibility as RecipeVisibilityType } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
}: RecipeDetailScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const query = useRecipe(recipeId);
    const profile = useUserProfile();
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    const [deleteOpen, setDeleteOpen] = useState(false);
    // The viewer's OPTIMISTIC rating action this session, or undefined to defer to the server. The detail's
    // `viewerRating` (the viewer's own prior rating) is the source of truth and pre-selects on load; this only
    // bridges the write→refetch gap so the stars don't flicker back before the refetch lands. See
    // `resolveSelectedStars`. Reset below when the screen switches recipes so it can't leak across recipes.
    const [ratingOverride, setRatingOverride] = useState<RatingSelectionOverride>(undefined);
    const [ratingRecipeId, setRatingRecipeId] = useState(recipeId);

    if (ratingRecipeId !== recipeId) {
        // A fresh push mounts a new screen, but a `replace`/deep-link reuses THIS screen instance with a new
        // `recipeId` param — so on an id change we must scrub every scrap of the previous recipe's rating
        // state. Resetting the mutations (not just the optimistic override) clears their `error` and
        // `isPending` too — otherwise the previous recipe's failed/in-flight rating write leaks onto the new
        // one, which shares the same `useMutation` instance, falsely showing a stale error or busy state. The
        // render-phase `setRatingRecipeId` forces an immediate re-render, by which point the observers are idle.
        setRatingRecipeId(recipeId);
        setRatingOverride(undefined);
        setRating.reset();
        deleteRating.reset();
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

    if (query.isLoading) {
        return (
            <View accessibilityLabel={t.detailLoading} style={styles.center}>
                <ActivityIndicator />
            </View>
        );
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
    const isOwner = viewerId !== undefined && recipe.ownerId === viewerId;
    const canGoPrivate = profile.data?.account.subscriptionTier === 'premium';
    const isPublic = recipe.visibility === RecipeVisibility.PUBLIC;
    const changeVisibility = (next: RecipeVisibilityType): void =>
        setVisibility.mutate({ id: recipeId, visibility: next });

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
    // The stars the input pre-selects: the server's `viewerRating` once loaded, bridged by the optimistic
    // override during a write so it never flickers. The community `averageRating` stays the displayed score.
    const selectedStars = resolveSelectedStars(ratingOverride, recipe.viewerRating);

    return (
        // ScrollView, not View: the detail (recipe body + rating + owner actions incl. the inline delete
        // dialog, or the clone action) exceeds the viewport, so those foot-of-screen controls are otherwise
        // unreachable on a device.
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            {back}
            <RecipeDetailView recipe={recipe} />

            <RecipeRatingControl
                mode={ratingMode}
                {...(recipe.averageRating === undefined ? {} : { average: recipe.averageRating })}
                ratingCount={recipe.ratingCount}
                {...(selectedStars === undefined ? {} : { selectedStars })}
                pending={setRating.isPending || deleteRating.isPending}
                {...(ratingErrorKind === undefined ? {} : { error: ratingErrorKind })}
                onRate={(stars) =>
                    setRating.mutate(
                        { id: recipeId, input: { stars } },
                        { onSuccess: () => setRatingOverride({ stars }) },
                    )
                }
                onRemove={() =>
                    deleteRating.mutate(recipeId, { onSuccess: () => setRatingOverride({ stars: undefined }) })
                }
            />

            {isOwner && (
                <View style={styles.ownerActions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.editAction}
                        onPress={() => onEdit?.(recipeId)}
                        style={styles.primaryAction}
                    >
                        <Text style={styles.primaryActionLabel}>{t.editAction}</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.versionsAction}
                        onPress={() => onViewVersions?.(recipeId)}
                        style={styles.secondaryAction}
                    >
                        <Text style={styles.secondaryActionLabel}>{t.versionsAction}</Text>
                    </Pressable>
                    <RecipeVisibilityToggle
                        visibility={recipe.visibility}
                        canGoPrivate={canGoPrivate}
                        disabledReason={canGoPrivate ? undefined : t.visibilityUpgradeReason}
                        onChange={changeVisibility}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.deleteAction}
                        onPress={() => setDeleteOpen(true)}
                        style={styles.deleteAction}
                    >
                        <Text style={styles.deleteActionLabel}>{t.deleteAction}</Text>
                    </Pressable>
                    <RecipeDeleteDialog
                        recipeTitle={recipe.title}
                        open={deleteOpen}
                        deleting={deleteRecipe.isPending}
                        onConfirm={() => deleteRecipe.mutate(recipeId, { onSuccess: () => onDeleted?.() })}
                        onCancel={() => setDeleteOpen(false)}
                    />
                </View>
            )}

            {isPublic && !isOwner && (
                <RecipeCloneAction
                    canClone
                    {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
                    cloning={cloneRecipe.isPending}
                    onClone={() => cloneRecipe.mutate(recipeId, { onSuccess: (created) => onCloned?.(created.id) })}
                />
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
    primaryAction: {
        alignSelf: 'flex-start',
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 12,
        paddingHorizontal: 24,
    },
    primaryActionLabel: { color: palette.white, fontWeight: '600', fontSize: 15 },
    secondaryAction: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.seafoam,
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    secondaryActionLabel: { color: palette.seafoam, fontWeight: '600', fontSize: 14 },
    deleteAction: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 8 },
    deleteActionLabel: { color: palette.error, fontWeight: '600', fontSize: 14 },
});
