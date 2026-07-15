/**
 * @module @commise/features-recipes — native collection-detail view (T072 building block).
 *
 * The React Native leaf of {@link import('./CollectionDetail.js').CollectionDetail} — same presentational
 * contract: header (name, description, rename + delete) and member recipe rows (each selectable, each with a
 * per-row remove control), with an empty state when the collection has no members. Rendered with RN
 * primitives.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionDetailViewProps } from './model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onRename,
    onDelete,
}) => {
    const { detail } = useMessages(collectionMessages);
    const recipes = collection.recipes ?? [];

    return (
        <View accessibilityLabel={collection.name} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {collection.name}
            </Text>
            {collection.description !== undefined && collection.description.length > 0 && (
                <Text style={styles.description}>{collection.description}</Text>
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

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.membersHeading}
            </Text>
            {recipes.length === 0 ? (
                <View style={styles.card}>
                    <Text style={styles.emptyTitle}>{detail.emptyTitle}</Text>
                    <Text style={styles.description}>{detail.emptyBody}</Text>
                </View>
            ) : (
                recipes.map((recipe) => {
                    const removeLabel = fillTemplate(detail.removeRecipe, { title: recipe.title });

                    return (
                        <View key={recipe.id} style={styles.memberRow}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={recipe.title}
                                onPress={() => onSelectRecipe(recipe.id)}
                                style={styles.memberTitleButton}
                            >
                                <Text style={styles.memberTitle}>{recipe.title}</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={removeLabel}
                                onPress={() => onRemoveRecipe(recipe.id)}
                                style={styles.textButton}
                            >
                                <Text style={styles.deleteLabel}>{removeLabel}</Text>
                            </Pressable>
                        </View>
                    );
                })
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
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal, marginTop: 8 },
    textButton: { paddingVertical: 6, paddingHorizontal: 10 },
    renameLabel: { color: palette.seafoam, fontWeight: '500', fontSize: 14 },
    deleteLabel: { color: palette.error, fontWeight: '500', fontSize: 14 },
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 4,
    },
    emptyTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    memberRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 14,
    },
    memberTitleButton: { flexShrink: 1 },
    memberTitle: { fontSize: 16, fontWeight: '600', color: palette.charcoal },
});
