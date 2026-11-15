/**
 * @module CookingDone — the native Done body: the title as the screen's heading in the large-title role, the
 * recipe line, and "The screen can turn off again" only where the screen was kept on. Its two actions are not here: they
 * are pinned in the foot by `CookingDoneActions`, where Back and Next sit on a step. When it opens, screen-reader focus
 * moves to the title, once per mount, never on a re-render.
 *
 * Presentational: props → JSX, apart from that one focus move.
 *
 * @pattern Adapter — the heading's ref wraps the platform's screen-reader focus event (`useScreenReaderFocusOnMount`),
 *     an external system with no declarative form; it holds nothing the render reads
 */
import { useScreenReaderFocusOnMount } from '@commise/ui/screen-reader-focus';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { View } from 'react-native';
import { YStack } from 'tamagui';

import type { CookingDoneProps } from './cookingViewProps.js';

/** The native Done body. */
export const CookingDone: FC<CookingDoneProps> = ({ title, enjoy, screenOff }) => {
    const heading = useScreenReaderFocusOnMount<View>();

    return (
        <YStack gap="$2" paddingHorizontal="$4" paddingVertical="$5">
            {/* The heading is an unstyled host View: the mount hook takes a host node, which a Tamagui Text's ref is not
                typed as. The View is one accessible node, so the cursor lands on the title and reads it once. */}
            <View ref={heading} accessible role="heading" aria-level={1}>
                <Text typeRole="largeTitle" color="$ink">
                    {title}
                </Text>
            </View>
            <Text typeRole="body" color="$ink">
                {enjoy}
            </Text>
            {screenOff === undefined ? null : (
                <Text typeRole="meta" color="$inkMuted">
                    {screenOff}
                </Text>
            )}
        </YStack>
    );
};
