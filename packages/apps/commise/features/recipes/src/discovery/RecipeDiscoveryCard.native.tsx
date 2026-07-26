/**
 * @module @commise/features-recipes — native public-discovery result card (T076 / W4 S1).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryCard.js').RecipeDiscoveryCard}: the same P7
 * composition of the shared {@link RecipeCard} compound parts — tappable cover + title, `by @handle` author
 * attribution (and imported source when present), cuisine/time/calorie meta, visibility badge, rating,
 * tags — plus the Clone action. Same contract as the web leaf so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipeCard } from '../card/index.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe search result on React Native.
 *
 * @param props - The card view-model, author handle / source attribution, the per-row clone-busy flag, and
 *   the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({
    recipe,
    authorHandle,
    sourceAttribution,
    isCloning,
    onSelect,
    onClone,
}) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        <RecipeCard recipe={recipe}>
            <Pressable accessibilityRole="button" accessibilityLabel={recipe.title} onPress={() => onSelect(recipe.id)}>
                <RecipeCard.Cover />
                <View style={styles.titleWrap}>
                    <RecipeCard.Title />
                </View>
            </Pressable>
            <View style={styles.body}>
                {authorHandle !== undefined && (
                    <Text style={styles.attribution}>{fillTemplate(discovery.byAuthor, { handle: authorHandle })}</Text>
                )}
                {sourceAttribution !== undefined && (
                    <Text style={styles.attribution}>
                        {fillTemplate(discovery.attribution, { source: sourceAttribution })}
                    </Text>
                )}
                <RecipeCard.Meta />
                <RecipeCard.Badges />
                <RecipeCard.Rating />
                <RecipeCard.Tags />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={cloneLabel}
                    accessibilityState={{ busy: isCloning, disabled: isCloning }}
                    disabled={isCloning}
                    onPress={() => onClone(recipe.id)}
                    style={[styles.cloneButton, isCloning && styles.cloneButtonBusy]}
                >
                    <Text style={styles.cloneLabel}>{isCloning ? discovery.cloning : discovery.clone}</Text>
                </Pressable>
            </View>
        </RecipeCard>
    );
};

const styles = StyleSheet.create({
    titleWrap: { paddingHorizontal: 16, paddingTop: 16 },
    body: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, gap: 8 },
    attribution: { fontSize: 13, color: palette.slate },
    // Demoted to a ghost/outline (U7): the card should read "tap to open" first, so Clone is a quiet
    // secondary action (coral outline) rather than a filled-coral CTA competing with the cover/title.
    cloneButton: {
        alignSelf: 'flex-start',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: palette.coral,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 16,
        marginTop: 4,
    },
    cloneButtonBusy: { opacity: 0.6 },
    cloneLabel: { color: palette.coral, fontWeight: '600', fontSize: 14 },
});
