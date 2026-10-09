/**
 * @module @commise/features-recipes — native browse-rail RESULTS (presentational, U7; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeBrowseRailResults`: a horizontal strip of full grid cards, each `clamp(240, 78% of the
 * track, 256)` wide so the next card peeks at the edge — the swipe cue — and snaps to the start; or the rail's empty note.
 * The strip is a `region` named "{rail} recipes".
 */
import { useMessages } from '@commise/i18n/react';
import { contentWidthOf } from '@commise/ui/container-class';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useContext, type FC } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import type { RecipeBrowseRailResultsProps } from './model.js';
import { RailContext } from './railContext.js';
import { RAIL_GAP_PX, railCardWidthOf } from './railScroll.js';

export const RecipeBrowseRailResults: FC<RecipeBrowseRailResultsProps> = ({
    results,
    saveCopy,
    onSelectRecipe,
    renderNutrition,
}) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const rail = useContext(RailContext);
    const { width } = useWindowDimensions();
    const cardWidth = railCardWidthOf(contentWidthOf(width));

    if (results.length === 0) {
        return <Text style={[styles.note, { color: colors.inkMuted }]}>{discovery.railEmpty}</Text>;
    }

    return (
        <ScrollView
            horizontal
            {...(rail === undefined
                ? {}
                : { role: 'region' as const, 'aria-label': fillTemplate(discovery.railRegion, { rail: rail.title }) })}
            // One `scrollsToTop` per screen: Discover's own scroller keeps the iOS status-bar tap.
            scrollsToTop={false}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + RAIL_GAP_PX}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={styles.strip}
            keyboardShouldPersistTaps="handled"
        >
            {results.map((entry) => (
                <View key={entry.recipe.id} style={{ width: cardWidth }}>
                    <RecipeDiscoveryCard
                        recipe={toRecipeCardModel(entry.recipe)}
                        variant="grid"
                        authorHandle={entry.recipe.authorHandle}
                        sourceAttribution={entry.recipe.sourceAttribution}
                        saveCopy={saveCopy.stateOf(entry.recipe.id)}
                        onSelect={onSelectRecipe}
                        onSave={saveCopy.save}
                        nutrition={renderNutrition?.(entry.recipe.id)}
                    />
                </View>
            ))}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    strip: { gap: RAIL_GAP_PX, paddingBottom: nativeTokens.spacing[2] },
    note: { ...nativeTokens.type.meta },
});
