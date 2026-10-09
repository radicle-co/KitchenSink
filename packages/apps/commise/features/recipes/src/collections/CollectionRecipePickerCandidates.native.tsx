/**
 * @module @commise/features-recipes/collections — the native add-recipes picker's settled body, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §5.3): the caller's recipes as the host's rows in a list, or the reason there are
 * none — "You have no recipes yet." with **Add a recipe**, or "No recipes match your search" with **Clear search**. It
 * draws no row itself. Colour is read from the theme at render (D15).
 *
 * Presentational: it draws the rows the host gives it, or the reason there are none.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CollectionRecipePickerCandidatesProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionRecipePickerCandidates: FC<CollectionRecipePickerCandidatesProps> = ({
    recipes,
    query,
    onClearSearch,
    onCreateRecipe,
    renderRow,
}) => {
    const { picker } = useMessages(collectionMessages);
    const { colors } = useTheme();

    if (recipes.length === 0) {
        return query.trim().length > 0 ? (
            <View style={styles.empty}>
                <Text style={[styles.title, { color: colors.ink }]}>{picker.noMatchesTitle}</Text>
                <Button variant="secondary" icon="x" onPress={onClearSearch}>
                    {picker.clearSearch}
                </Button>
            </View>
        ) : (
            <View style={styles.empty}>
                <Text style={[styles.title, { color: colors.ink }]}>{picker.noRecipesTitle}</Text>
                <Button icon="plus" onPress={onCreateRecipe}>
                    {picker.createRecipe}
                </Button>
            </View>
        );
    }

    return (
        <View collapsable={false} role="list">
            {recipes.map((recipe) => (
                <View key={recipe.id} collapsable={false} role="listitem">
                    {renderRow(recipe)}
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    empty: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingVertical: nativeTokens.spacing[6] },
    title: { ...nativeTokens.type.sectionTitle },
});
