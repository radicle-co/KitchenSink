/**
 * @module @commise/features-account/danger — `ErasePrivateFoodsNotice` (native): the "These will be deleted" block of the
 * erasure dialog (private foods spec section 8): owner-only recipes that use a food only the owner can see, which the
 * erasure deletes whatever is elected. Plain text, nothing focusable, stated before the phrase is typed. Its own file
 * and Tamagui only, because `AccountEraseDialog.native.tsx` is still React Native `StyleSheet` styling that only falls.
 *
 * Presentational: `props → JSX`. Draws nothing for an empty list.
 */
import { useMessages } from '@commise/i18n/react';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { accountDangerMessages } from './messages.js';
import type { DonatableRecipe } from './model.js';

/** The block. */
export const ErasePrivateFoodsNotice: FC<{ readonly recipes: readonly DonatableRecipe[] }> = ({ recipes }) => {
    const { erase } = useMessages(accountDangerMessages);

    if (recipes.length === 0) {
        return null;
    }

    return (
        <YStack gap="$1">
            <Text role="header" typeRole="label" color="$ink">
                {erase.privateFoodsHeading}
            </Text>
            <Text typeRole="meta" color="$inkMuted">
                {erase.privateFoodsHelp}
            </Text>
            {recipes.map((recipe) => (
                <Text key={recipe.id} typeRole="meta" color="$ink">
                    {recipe.title}
                </Text>
            ))}
        </YStack>
    );
};
