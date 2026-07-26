/**
 * @module @commise/features-recipes — native curated browse-rails block (U7, net-new).
 *
 * The React Native leaf of {@link import('./RecipeBrowseRails.js').RecipeBrowseRails}: the same three
 * fixed-sort rails (Trending/New/Quick) as horizontal-scroll strips of {@link RecipeDiscoveryCard}s with a
 * per-rail "see all", plus cuisine shortcuts — rendered with RN primitives and `nativeTokens`. Controlled +
 * presentational; same contract as the web leaf so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';

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
}> = ({ rail, cloningId, onSelectRecipe, onClone }) => {
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
                        />
                    </View>
                ))}
            </ScrollView>
        );
    }

    return (
        <View style={styles.rail}>
            <View style={styles.railHeader}>
                <Text accessibilityRole="header" style={styles.railTitle}>
                    {title}
                </Text>
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
}) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <View aria-label={discovery.browseLabel} style={styles.container}>
            {rails.map((rail) => (
                <Rail
                    key={rail.id}
                    rail={rail}
                    cloningId={cloningId}
                    onSelectRecipe={onSelectRecipe}
                    onClone={onClone}
                />
            ))}
            {cuisines.length > 0 && (
                <View style={styles.rail}>
                    <Text accessibilityRole="header" style={styles.railTitle}>
                        {discovery.cuisinesTitle}
                    </Text>
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
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[7] },
    rail: { gap: nativeTokens.spacing[3] },
    railHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    railTitle: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    seeAllText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.seafoam },
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
