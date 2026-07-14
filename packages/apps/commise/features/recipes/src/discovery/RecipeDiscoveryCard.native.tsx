/**
 * @module @commise/features-recipes — native public-discovery card (T076 building block).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryCard.js').RecipeDiscoveryCard} — same contract,
 * RN primitives. Accessible button named by the recipe title, the source attribution when present, and a
 * Clone action that busies (accessibilityState busy/disabled) while this row's clone is in flight.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe row on React Native.
 *
 * @param props - The discovery view-model, the per-row clone-busy flag, and the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({ recipe, isCloning, onSelect, onClone }) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        <View>
            <Pressable accessibilityRole="button" accessibilityLabel={recipe.title} onPress={() => onSelect(recipe.id)}>
                <Text>{recipe.title}</Text>
            </Pressable>
            {recipe.sourceAttribution !== undefined ? (
                <Text>{fillTemplate(discovery.attribution, { source: recipe.sourceAttribution })}</Text>
            ) : null}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={cloneLabel}
                accessibilityState={{ busy: isCloning, disabled: isCloning }}
                disabled={isCloning}
                onPress={() => onClone(recipe.id)}
            >
                <Text>{isCloning ? discovery.cloning : discovery.clone}</Text>
            </Pressable>
        </View>
    );
};
