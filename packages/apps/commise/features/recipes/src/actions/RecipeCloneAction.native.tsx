/**
 * @module @commise/features-recipes — native recipe clone action (T075 building block).
 *
 * The React Native leaf of {@link import('./RecipeCloneAction.js').RecipeCloneAction} — same controlled
 * contract: a clone button disabled when cloning is not allowed (`!canClone`) or in flight (`cloning`) and
 * marked busy while cloning, plus a source-attribution line rendered only when `sourceAttribution` is set.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeCloneActionProps } from './model.js';

export const RecipeCloneAction: FC<RecipeCloneActionProps> = ({
    canClone,
    sourceAttribution,
    cloning = false,
    onClone,
}) => {
    const { clone } = useMessages(recipeActionMessages);

    return (
        <View>
            {sourceAttribution !== undefined && sourceAttribution.length > 0 && (
                <Text>{fillTemplate(clone.attribution, { source: sourceAttribution })}</Text>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={clone.clone}
                aria-busy={cloning || undefined}
                disabled={cloning || !canClone}
                onPress={onClone}
            >
                <Text>{clone.clone}</Text>
            </Pressable>
            {cloning && <Text>{clone.cloningLabel}</Text>}
        </View>
    );
};
