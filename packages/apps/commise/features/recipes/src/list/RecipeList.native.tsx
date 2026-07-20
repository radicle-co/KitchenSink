/**
 * @module @commise/features-recipes — native recipe-list view (T065 building block).
 *
 * The React Native leaf of {@link import('./RecipeList.js').RecipeList} — same controlled, presentational
 * contract and the same four states (loading, error, empty, populated), rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.native.js';
import { formatRecipeCount, type RecipeListViewProps } from './model.js';

export const RecipeList: FC<RecipeListViewProps> = ({
    status,
    recipes,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onCreateRecipe,
    onRetry,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={list.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{list.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                    <Text>{list.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (recipes.length === 0) {
        // Empty ≠ no-match: an active search that filtered every row out is NOT "no recipes yet" (the caller
        // has recipes) — it's a no-match. Distinguishing them keeps the empty-state copy honest.
        const searching = searchValue.trim().length > 0;
        body = (
            <View style={styles.emptyBody}>
                <Text>{searching ? list.noMatchTitle : list.emptyTitle}</Text>
                <Text>{searching ? list.noMatchBody : list.emptyBody}</Text>
                {!searching && (
                    // Empty-state CTA — the SOLE create control here; the floating FAB is suppressed on empty.
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={list.emptyCreateCta}
                        onPress={onCreateRecipe}
                        style={styles.createButton}
                    >
                        <Text style={styles.createLabel}>{list.emptyCreateCta}</Text>
                    </Pressable>
                )}
            </View>
        );
    } else {
        const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
        // ScrollView, not View: the full-bleed 4:3 cover cards mean only ~1 card fits the viewport, so without
        // scrolling every recipe past the first is unreachable. The header + search stay pinned above it.
        body = (
            <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cards}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.count}>{count}</Text>
                {recipes.map((recipe) => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSelect={onSelectRecipe} />
                ))}
            </ScrollView>
        );
    }

    // FAB is the persistent create control (L1), pinned OUTSIDE the header, present across loading / error /
    // populated; suppressed only in the true empty state where the empty CTA is the single create affordance.
    const isEmpty = status === 'ready' && recipes.length === 0 && searchValue.trim().length === 0;

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
            </View>
            <TextInput
                accessibilityLabel={list.searchLabel}
                placeholder={list.searchPlaceholder}
                placeholderTextColor={palette.mist}
                value={searchValue}
                onChangeText={onSearchChange}
                style={styles.search}
            />
            {body}

            {!isEmpty && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={list.createCta}
                    onPress={onCreateRecipe}
                    style={styles.fab}
                >
                    <Text style={styles.fabLabel}>+</Text>
                </Pressable>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, gap: 16, paddingHorizontal: 16, paddingTop: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    createButton: {
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 18,
    },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    emptyBody: { gap: 12, alignItems: 'flex-start' },
    fab: {
        position: 'absolute',
        right: 16,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 999,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: palette.charcoal,
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    fabLabel: { color: palette.white, fontSize: 28, fontWeight: '700', lineHeight: 32 },
    search: {
        backgroundColor: palette.white,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        fontSize: 16,
        color: palette.charcoal,
    },
    count: { fontSize: 13, fontWeight: '500', color: palette.slate },
    cardsScroll: { flex: 1 },
    cards: { gap: 12, paddingBottom: 24 },
});
