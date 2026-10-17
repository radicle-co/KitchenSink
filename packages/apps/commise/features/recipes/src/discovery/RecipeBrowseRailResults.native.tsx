/**
 * @module @commise/features-recipes — native browse-rail RESULTS (presentational, U7; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeBrowseRailResults`: a horizontal strip of full grid cards, each `clamp(240, 78% of the
 * track, 256)` wide so the next card peeks at the edge — the swipe cue — and snaps to the start; or the rail's empty note.
 * The strip is a `region` named "{rail} recipes", drawn by the design-system `HorizontalScroller`: it keeps the platform's
 * scroll indicator and hints at the cards beyond with a chevron while it rests at its start.
 */
import { useMessages } from '@commise/i18n/react';
import { contentWidthOf } from '@commise/ui/container-class';
import { HorizontalScroller } from '@commise/ui/horizontal-scroller';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useContext, type FC } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
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
        <HorizontalScroller
            snap={{ kind: 'card', interval: cardWidth + RAIL_GAP_PX }}
            {...(rail === undefined ? {} : { regionLabel: fillTemplate(discovery.railRegion, { rail: rail.title }) })}
        >
            <View style={styles.strip}>
                {results.map((entry) => (
                    <View key={entry.recipe.id} style={{ width: cardWidth }}>
                        <RecipeDiscoveryCard
                            recipe={toRecipeCardModel(entry.recipe)}
                            variant="grid"
                            headingLevel={3}
                            authorUsername={entry.recipe.authorUsername}
                            authorDisplayName={entry.recipe.authorDisplayName}
                            sourceAttribution={entry.recipe.sourceAttribution}
                            saveCopy={saveCopy.stateOf(entry.recipe.id)}
                            onSelect={onSelectRecipe}
                            onSave={saveCopy.save}
                            nutrition={renderNutrition?.(entry.recipe.id)}
                        />
                    </View>
                ))}
            </View>
        </HorizontalScroller>
    );
};

const styles = StyleSheet.create({
    strip: { flexDirection: 'row', gap: RAIL_GAP_PX, paddingBottom: nativeTokens.spacing[2] },
    note: { ...nativeTokens.type.meta },
});
