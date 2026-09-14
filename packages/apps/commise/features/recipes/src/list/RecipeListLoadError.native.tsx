/**
 * @module @commise/features-recipes — native recipe-list LOAD-ERROR fallback (presentational): what the list's error
 * boundary renders when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 *
 * It keeps the create dial, because this body has no create CTA to replace it (see `shouldShowCreateDial`).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeCreateDial } from './RecipeCreateDial.native.js';
import type { RecipeListLoadErrorProps } from './model.js';

export const RecipeListLoadError: FC<RecipeListLoadErrorProps> = ({ onRetry, onCreateRecipe, onPasteIngredients }) => {
    const { list } = useMessages(recipeMessages);

    return (
        <>
            <View accessibilityRole="alert">
                <Text>{list.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={list.retry} onPress={onRetry}>
                    <Text>{list.retry}</Text>
                </Pressable>
            </View>
            <RecipeCreateDial onCreateRecipe={onCreateRecipe} onPasteIngredients={onPasteIngredients} />
        </>
    );
};
