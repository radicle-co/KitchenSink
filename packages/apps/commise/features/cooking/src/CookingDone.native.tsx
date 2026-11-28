/**
 * @module CookingDone — the native Done body: the title as the screen's heading in the large-title role, the
 * recipe line, and "The screen can turn off again" only where the screen was kept on. Its two actions are not here: they
 * are pinned in the foot by `CookingDoneActions`, where Back and Next sit on a step. When it opens, screen-reader focus
 * moves to the title, once per mount, never on a re-render; a Cancel or Stop on Done remounts the title (`titleSignal`), so it
 * lands there again after the button it was on is gone.
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

/** The native Done body's props: the shared ones, plus the counter that moves the cursor back to the title. */
export type NativeCookingDoneProps = CookingDoneProps & {
    /** Advances when a Cancel or Stop takes a row off Done; the title remounts, so the cursor lands on it again. */
    readonly titleSignal: number;
};

/** The title as the screen's heading. Mounting it moves the cursor onto it, so a new `key` moves the cursor again. */
const DoneHeading: FC<Pick<CookingDoneProps, 'title'>> = ({ title }) => {
    const heading = useScreenReaderFocusOnMount<View>();

    return (
        // The heading is an unstyled host View: the mount hook takes a host node, which a Tamagui Text's ref is not
        // typed as. The View is one accessible node, so the cursor lands on the title and reads it once.
        <View ref={heading} accessible role="heading" aria-level={1}>
            <Text typeRole="largeTitle" color="$ink">
                {title}
            </Text>
        </View>
    );
};

/** The native Done body. */
export const CookingDone: FC<NativeCookingDoneProps> = ({ title, enjoy, screenNote, titleSignal }) => (
    <YStack gap="$3" paddingHorizontal="$4" paddingVertical="$5">
        <DoneHeading key={titleSignal} title={title} />
        <Text typeRole="body" color="$ink">
            {enjoy}
        </Text>
        {screenNote === undefined ? null : (
            <Text typeRole="meta" color="$inkMuted">
                {screenNote}
            </Text>
        )}
    </YStack>
);
