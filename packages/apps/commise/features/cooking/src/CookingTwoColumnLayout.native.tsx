/**
 * @module CookingTwoColumnLayout — the native two-column layout at L2 and L3: the ingredients column in a 300 wide slot
 * on the left that scrolls on its own, and the step column in the rest, at most 680 wide and centred in it. The slot is
 * on the canvas with no divider, and its content is inset 16 on every side inside the scroll, as the house sheet's
 * edge is, so the scroll bar stays at the slot edge. It holds no state and reads no band: the screen picks it by
 * `layoutBand`.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';
import { ScrollView, XStack, YStack } from 'tamagui';

import { COOKING_COLUMN, INGREDIENTS_COLUMN } from './cookingLayout.js';
import type { CookingTwoColumnLayoutProps } from './cookingTwoColumnLayoutProps.js';

/** The native two-column layout. */
export const CookingTwoColumnLayout: FC<CookingTwoColumnLayoutProps> = ({ column, children }) => (
    <XStack testID="cooking-columns" flex={1}>
        <YStack testID="cooking-ingredients-slot" width={INGREDIENTS_COLUMN.px} backgroundColor="$canvas">
            <ScrollView testID="cooking-ingredients-scroll" flex={1} keyboardShouldPersistTaps="handled">
                <YStack testID="cooking-ingredients-inset" paddingVertical="$4" paddingHorizontal="$4">
                    {column}
                </YStack>
            </ScrollView>
        </YStack>
        <YStack testID="cooking-step-area" flex={1} alignItems="center">
            <YStack testID="cooking-step-slot" flex={1} width="100%" maxWidth={COOKING_COLUMN.maxPx}>
                {children}
            </YStack>
        </YStack>
    </XStack>
);
