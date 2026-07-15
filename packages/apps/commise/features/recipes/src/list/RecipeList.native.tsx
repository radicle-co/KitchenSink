/**
 * @module @commise/features-recipes — native recipe-list view (T065 building block).
 *
 * The React Native leaf of {@link import('./RecipeList.js').RecipeList} — same controlled, presentational
 * contract and the same four states (loading, error, empty, populated), rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
        body = (
            <View>
                <Text>{list.emptyTitle}</Text>
                <Text>{list.emptyBody}</Text>
            </View>
        );
    } else {
        const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
        body = (
            <View style={styles.cards}>
                <Text style={styles.count}>{count}</Text>
                {recipes.map((recipe) => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSelect={onSelectRecipe} />
                ))}
            </View>
        );
    }

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={list.createCta}
                    onPress={onCreateRecipe}
                    style={styles.createButton}
                >
                    <Text style={styles.createLabel}>{list.createCta}</Text>
                </Pressable>
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
    cards: { gap: 12 },
});
