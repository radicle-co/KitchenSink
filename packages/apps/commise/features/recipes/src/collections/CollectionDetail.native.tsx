/**
 * @module @commise/features-recipes — native collection-detail view (T072 building block).
 *
 * The React Native leaf of {@link import('./CollectionDetail.js').CollectionDetail} — same presentational
 * contract: header (name, description, rename + delete) and member recipe rows — each a
 * {@link CollectionMemberRow} (W5 Task 9, C3), which composes the shared `RecipeCard` with its
 * source-indicator and remove control — with an empty state when the collection has no members. Rendered
 * with RN primitives.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionMemberRow } from './CollectionMemberRow.native.js';
import { collectionMessages } from './messages.js';
import type { CollectionDetailViewProps } from './model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onAddRecipe,
    onRename,
    onDelete,
    error,
}) => {
    const { detail } = useMessages(collectionMessages);
    const recipes = collection.recipes ?? [];
    // B17 — a failed delete/remove is a mandated UI state, never a frozen no-op. Resolve the container's error
    // code to localized copy here so the block stays self-contained on its own copy.
    const errorMessage = error === undefined ? undefined : error === 'delete' ? detail.deleteError : detail.removeError;

    return (
        <View accessibilityLabel={collection.name} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {collection.name}
            </Text>
            {collection.description !== undefined && collection.description.length > 0 && (
                <Text style={styles.description}>{collection.description}</Text>
            )}
            {errorMessage !== undefined && (
                <Text accessibilityRole="alert" style={styles.errorBanner}>
                    {errorMessage}
                </Text>
            )}
            <View style={styles.headerActions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={detail.renameCta}
                    onPress={onRename}
                    style={styles.textButton}
                >
                    <Text style={styles.renameLabel}>{detail.renameCta}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={detail.deleteCta}
                    onPress={onDelete}
                    style={styles.textButton}
                >
                    <Text style={styles.deleteLabel}>{detail.deleteCta}</Text>
                </Pressable>
            </View>

            <View style={styles.membersHeader}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {detail.membersHeading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={detail.addRecipeCta}
                    onPress={onAddRecipe}
                    style={styles.addButton}
                >
                    <Text style={styles.addLabel}>{detail.addRecipeCta}</Text>
                </Pressable>
            </View>
            {recipes.length === 0 ? (
                <View style={styles.card}>
                    <Text style={styles.emptyTitle}>{detail.emptyTitle}</Text>
                    <Text style={styles.description}>{detail.emptyBody}</Text>
                </View>
            ) : (
                recipes.map((recipe) => (
                    <CollectionMemberRow
                        key={recipe.id}
                        member={recipe}
                        onSelect={onSelectRecipe}
                        onRemove={onRemoveRecipe}
                    />
                ))
            )}
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    description: { fontSize: 15, color: palette.slate },
    headerActions: { flexDirection: 'row', gap: 8 },
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    addButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    addLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    textButton: { paddingVertical: 6, paddingHorizontal: 10 },
    renameLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 14 },
    deleteLabel: { color: palette.error, fontWeight: '500', fontSize: 14 },
    errorBanner: { fontSize: 13, color: palette.error },
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 4,
    },
    emptyTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
});
