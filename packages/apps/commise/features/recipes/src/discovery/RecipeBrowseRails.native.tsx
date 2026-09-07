/**
 * @module @commise/features-recipes — native curated browse-rails block (U7, net-new).
 *
 * The React Native leaf of `RecipeBrowseRails`: the same three
 * fixed-sort rails (Trending/New/Quick) as horizontal-scroll strips of {@link RecipeDiscoveryCard}s with a
 * per-rail "see all", plus cuisine shortcuts — rendered with RN primitives and `nativeTokens`. Controlled +
 * presentational; same contract as the web leaf so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { EnterTransition } from '@commise/ui/motion';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';

/**
 * A browse section heading: the display title over a short brand-gradient accent bar (U8). The accent is a
 * decorative, unlabelled {@link GradientSurface} (no accessibilityLabel ⇒ not in the accessibility tree).
 */
const SectionHeading: FC<{ readonly title: string }> = ({ title }) => (
    <View style={styles.headingGroup}>
        <Text accessibilityRole="header" style={styles.railTitle}>
            {title}
        </Text>
        <GradientSurface gradient="brand" style={styles.railAccent} />
    </View>
);

/**
 * Milliseconds each successive browse section is held back, so the surface assembles itself rather than
 * flashing four sections in at once (U8 motion pass). Applied by {@link EnterTransition}, which owns the
 * reduce-motion gate. Single-sourced with the web leaf's identical constant.
 */
const SECTION_STAGGER_MS = 80;

/** Visible title for each rail (S). */
const railTitle = (id: RecipeBrowseRailId, m: DiscoveryMessages): string => {
    switch (id) {
        case 'trending':
            return m.railTrending;
        case 'new':
            return m.railNew;
        case 'quick':
            return m.railQuick;
    }
};

/** One curated rail: header (title + see-all) over its own loading/error/empty/populated body. */
const Rail: FC<{
    readonly rail: RecipeBrowseRailView;
    readonly cloningId?: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
    readonly renderNutrition?: RenderRecipeNutrition;
}> = ({ rail, cloningId, onSelectRecipe, onClone, renderNutrition }) => {
    const discovery = useMessages(discoveryMessages);
    const title = railTitle(rail.id, discovery);

    let body: ReactElement;

    if (rail.status === 'loading') {
        body = <View role="status" aria-label={discovery.loadingLabel} style={styles.railSkeleton} />;
    } else if (rail.status === 'error') {
        body = <Text style={styles.railNote}>{discovery.railError}</Text>;
    } else if (rail.results.length === 0) {
        body = <Text style={styles.railNote}>{discovery.railEmpty}</Text>;
    } else {
        body = (
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railStrip}
                keyboardShouldPersistTaps="handled"
            >
                {rail.results.map((entry) => (
                    <View key={entry.recipe.id} style={styles.railCard}>
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
    }

    return (
        <View style={styles.rail}>
            <View style={styles.railHeader}>
                <SectionHeading title={title} />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onPress={rail.onSeeAll}
                    style={styles.seeAll}
                >
                    <Text style={styles.seeAllText}>{discovery.seeAll}</Text>
                </Pressable>
            </View>
            {body}
        </View>
    );
};

/**
 * The curated browse rails + cuisine shortcuts (native).
 *
 * @param props - The projected rails, the cuisine shortcuts, and the selection/clone callbacks.
 */
export const RecipeBrowseRails: FC<RecipeBrowseRailsProps> = ({
    rails,
    cuisines,
    cloningId,
    onSelectRecipe,
    onClone,
    renderNutrition,
}) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <View aria-label={discovery.browseLabel} style={styles.container}>
            {/* U8 motion pass: each section rises + fades in, staggered, via the DS `EnterTransition` — which
                owns the reduce-motion gate, so a reduce-motion viewer simply gets the settled surface. */}
            {rails.map((rail, index) => (
                <EnterTransition key={rail.id} delayMs={index * SECTION_STAGGER_MS}>
                    <Rail
                        rail={rail}
                        cloningId={cloningId}
                        onSelectRecipe={onSelectRecipe}
                        onClone={onClone}
                        renderNutrition={renderNutrition}
                    />
                </EnterTransition>
            ))}
            {cuisines.length > 0 && (
                <EnterTransition delayMs={rails.length * SECTION_STAGGER_MS}>
                    <View style={styles.rail}>
                        <SectionHeading title={discovery.cuisinesTitle} />
                        <View style={styles.cuisineRow}>
                            {cuisines.map((cuisine) => (
                                <Pressable
                                    key={cuisine.value}
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(discovery.cuisineShortcutLabel, {
                                        cuisine: cuisine.value,
                                    })}
                                    onPress={cuisine.onSelect}
                                    style={styles.cuisineChip}
                                >
                                    <Text style={styles.cuisineText}>{cuisine.value}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                </EnterTransition>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[7] },
    rail: { gap: nativeTokens.spacing[3] },
    railHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // U8: the section title stacked over its short brand-gradient accent bar.
    headingGroup: { gap: 6 },
    railTitle: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    railAccent: { height: 4, width: 40, borderRadius: nativeTokens.radius.full },
    seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    seeAllText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    railStrip: { gap: nativeTokens.spacing[3], paddingRight: nativeTokens.spacing[4] },
    railCard: { width: 260 },
    railSkeleton: {
        height: 200,
        borderRadius: nativeTokens.radius.lg,
        backgroundColor: nativeTokens.borderSubtle,
    },
    railNote: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    cuisineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    cuisineChip: {
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.pearl,
        paddingHorizontal: nativeTokens.spacing[4],
    },
    cuisineText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.charcoal },
});
