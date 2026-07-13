/**
 * @module @commise/features-recipes — native recipe-list view (T065 building block).
 *
 * The React Native leaf of {@link import('./RecipeList.js').RecipeList} — same controlled, presentational
 * contract and the same four states (loading, error, empty, populated), rendered with RN primitives.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
            <View>
                <Text>{count}</Text>
                {recipes.map((recipe) => (
                    <RecipeListCard key={recipe.id} recipe={recipe} onSelect={onSelectRecipe} />
                ))}
            </View>
        );
    }

    return (
        <View accessibilityLabel={list.heading}>
            <Text accessibilityRole="header">{list.heading}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={list.createCta} onPress={onCreateRecipe}>
                <Text>{list.createCta}</Text>
            </Pressable>
            <TextInput
                accessibilityLabel={list.searchLabel}
                placeholder={list.searchPlaceholder}
                value={searchValue}
                onChangeText={onSearchChange}
            />
            {body}
        </View>
    );
};
