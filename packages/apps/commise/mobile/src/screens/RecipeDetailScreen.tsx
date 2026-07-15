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
    RecipeVisibilityToggle,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useRecipe,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { RecipeVisibility, type RecipeVisibility as RecipeVisibilityType } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
    const [deleteOpen, setDeleteOpen] = useState(false);

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

    return (
        <View style={styles.container}>
            {back}
            <RecipeDetailView recipe={recipe} />

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
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.sand },
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
