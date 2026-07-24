/**
 * @module @commise/features-recipes — native collection-detail view (T072 building block).
 *
 * The React Native leaf of {@link import('./CollectionDetail.js').CollectionDetail} — same presentational
 * contract: the MEMBER LIST ("Recipes" section, add control, member recipe rows — each a
 * {@link CollectionMemberRow} (W5 Task 9, C3), which composes the shared `RecipeCard` with its
 * source-indicator and remove control) plus an empty state and the B17 error banner. Rendered with RN
 * primitives. The header zone (name/rename/delete/provenance/back) is owned by the sibling
 * {@link import('./CollectionHeader.native.js').CollectionHeader} (W5 Task 6), composed above this block by
 * the screen (W5 Task 12) — this view holds no header of its own, so the surface renders exactly ONE header.
 *
 * Member-list windowing (W5/C7): the detail embed returns EVERY member in one round trip (no
 * member-pagination endpoint — out of scope), so this view reveals them client-side in
 * {@link MEMBER_WINDOW_SIZE}-row windows behind a `[Load more (K more)]` control, tracked as local
 * `useState` reveal-count VIEW state (not server data) — the reveal count is otherwise a pure function of
 * `collection.recipes.length`. If a caller reuses this component across DIFFERENT collections without
 * remounting it, key it by `collection.id` so the reveal count resets for the new collection's member list.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollectionMemberRow } from './CollectionMemberRow.native.js';
import { collectionMessages } from './messages.js';
import { MEMBER_WINDOW_SIZE, type CollectionDetailViewProps } from './model.js';
import { fillTemplate } from '../list/model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onAddRecipe,
    error,
}) => {
    const { detail } = useMessages(collectionMessages);
    const [revealCount, setRevealCount] = useState(MEMBER_WINDOW_SIZE);
    const recipes = collection.recipes ?? [];
    const visibleRecipes = recipes.slice(0, revealCount);
    const remainingCount = recipes.length - visibleRecipes.length;
    // B17 — a failed delete/remove is a mandated UI state, never a frozen no-op. Resolve the container's error
    // code to localized copy here so the block stays self-contained on its own copy.
    const errorMessage = error === undefined ? undefined : error === 'delete' ? detail.deleteError : detail.removeError;

    return (
        <View accessibilityLabel={detail.membersHeading} style={styles.container}>
            {errorMessage !== undefined && (
                <Text accessibilityRole="alert" style={styles.errorBanner}>
                    {errorMessage}
                </Text>
            )}
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
                <>
                    {visibleRecipes.map((recipe) => (
                        <CollectionMemberRow
                            key={recipe.id}
                            member={recipe}
                            onSelect={onSelectRecipe}
                            onRemove={onRemoveRecipe}
                        />
                    ))}
                    {remainingCount > 0 && (
                        // W5/C7 — client-side member-list windowing (no member-pagination endpoint).
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(detail.loadMore, { count: remainingCount })}
                            onPress={() =>
                                setRevealCount((count) => Math.min(recipes.length, count + MEMBER_WINDOW_SIZE))
                            }
                            style={styles.loadMore}
                        >
                            <Text style={styles.loadMoreLabel}>
                                {fillTemplate(detail.loadMore, { count: remainingCount })}
                            </Text>
                        </Pressable>
                    )}
                </>
            )}
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
    description: { fontSize: 15, color: palette.slate },
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    addButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    addLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
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
    loadMore: {
        alignSelf: 'center',
        backgroundColor: palette.pearl,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 24,
        marginTop: 8,
    },
    loadMoreLabel: { fontSize: 14, fontWeight: '600', color: palette.charcoal },
});
