/**
 * @module CookingFrame — the native cooking surface: the screen's main landmark, busy while the recipe loads.
 * One centred column at most 680 wide holds the top bar pinned at the top, the foot pinned at the bottom (the Next preview
 * above the actions), and only the body between them scrolling, so a focus line taller than the screen at the largest text
 * never pushes the place, Back or Next away. The frame owns the foot's layout, so the spacing between the preview and the
 * actions lives here, once. The body swipe's responder wraps the whole scrolling area, not the body's content, so the
 * empty space below a short step takes a swipe too, while the top bar and the foot stay outside it.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';
import { View, type ViewProps } from 'react-native';
import { ScrollView, styled, YStack } from 'tamagui';

import type { CookingFrameProps } from './cookingViewProps.js';
import { COOKING_COLUMN } from './cookingLayout.js';

// Tamagui's own stacks take no responder handlers, so the swipe area is React Native's View, laid out by Tamagui.
const SwipeArea = styled(View, { name: 'CookingSwipeArea', flex: 1 });

/** Native's frame props: the shared ones, plus the responder handlers of the step swipe over the body area. */
export type NativeCookingFrameProps = CookingFrameProps & {
    readonly bodySwipe?: Pick<ViewProps, 'onMoveShouldSetResponder' | 'onResponderRelease'>;
};

/** The native cooking surface. */
export const CookingFrame: FC<NativeCookingFrameProps> = ({ topBar, body, foot, busy, bodySwipe }) => (
    <YStack role="main" aria-busy={busy ? true : undefined} collapsable={false} flex={1} backgroundColor="$canvas">
        <YStack testID="cooking-column" flex={1} width="100%" maxWidth={COOKING_COLUMN.maxPx} alignSelf="center">
            {topBar}
            <SwipeArea collapsable={false} {...bodySwipe}>
                <ScrollView testID="cooking-scroll" flex={1} keyboardShouldPersistTaps="handled">
                    {body}
                </ScrollView>
            </SwipeArea>
            {foot === undefined ? null : (
                <YStack testID="cooking-foot" gap="$2">
                    {foot.preview}
                    {foot.actions}
                </YStack>
            )}
        </YStack>
    </YStack>
);
