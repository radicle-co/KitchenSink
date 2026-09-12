/**
 * @module @commise/features-recipes — native browse-rail RESULTS (presentational, U7).
 *
 * The React Native twin of `RecipeBrowseRailResults`: a horizontal strip of discovery cards, or the rail's empty note.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import type { RecipeBrowseRailResultsProps } from './model.js';

export const RecipeBrowseRailResults: FC<RecipeBrowseRailResultsProps> = ({
    results,
    cloningId,
    onSelectRecipe,
    onClone,
    renderNutrition,
}) => {
    const discovery = useMessages(discoveryMessages);

    if (results.length === 0) {
        return <Text style={styles.note}>{discovery.railEmpty}</Text>;
    }

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            keyboardShouldPersistTaps="handled"
        >
            {results.map((entry) => (
                <View key={entry.recipe.id} style={styles.card}>
                    <RecipeDiscoveryCard
                        recipe={toRecipeCardModel(entry.recipe)}
                        authorHandle={entry.recipe.authorHandle}
                        sourceAttribution={entry.recipe.sourceAttribution}
                        isCloning={cloningId === entry.recipe.id}
                        onSelect={onSelectRecipe}
                        onClone={onClone}
                        nutrition={renderNutrition?.(entry.recipe.id)}
                    />
                </View>
            ))}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    strip: { gap: nativeTokens.spacing[3], paddingRight: nativeTokens.spacing[4] },
    card: { width: 260 },
    note: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
