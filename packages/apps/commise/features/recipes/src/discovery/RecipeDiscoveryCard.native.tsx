/**
 * @module @commise/features-recipes — native public-discovery card (T076 building block).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryCard.js').RecipeDiscoveryCard} — same contract,
 * RN primitives. Accessible button named by the recipe title, the source attribution when present, and a
 * Clone action that busies (accessibilityState busy/disabled) while this row's clone is in flight.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe row on React Native, styled to the Commise design language: a white rounded card
 * with a display title, muted source attribution, and a coral Clone action.
 *
 * @param props - The discovery view-model, the per-row clone-busy flag, and the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({ recipe, isCloning, onSelect, onClone }) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        <View style={styles.card}>
            <Pressable accessibilityRole="button" accessibilityLabel={recipe.title} onPress={() => onSelect(recipe.id)}>
                <Text style={styles.title}>{recipe.title}</Text>
            </Pressable>
            {recipe.sourceAttribution !== undefined ? (
                <Text style={styles.attribution}>
                    {fillTemplate(discovery.attribution, { source: recipe.sourceAttribution })}
                </Text>
            ) : null}
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
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 18,
        gap: 10,
    },
    title: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    attribution: { fontSize: 13, color: palette.slate },
    cloneButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.coral,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    cloneButtonBusy: { opacity: 0.6 },
    cloneLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
