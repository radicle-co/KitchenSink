/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (native): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill. It is ONE accessibility element, so a screen reader reads the label and the value together in a
 * single swipe. The value takes the room the label leaves and wraps, so a long email never runs off the screen.
 *
 * The value sits at the END of the line, as the web's `text-end` does (designer ruling 2026-11-01,
 * `nativeBoards/designAnswers.md`). React Native's `textAlign: 'right'` is that end: React Native 0.86 swaps 'right' and
 * 'left' when the text's layout direction is right to left (iOS `RCTAttributedTextUtils.mm`, Android
 * `TextLayoutManager.getTextAlignment`), and the row's own direction flips with the layout, so in a right-to-left
 * language the value sits on the left. At large text (`factRowStacksAt`) the value stacks under its label, at the start
 * of the line: 'left' is the start by the same swap.
 *
 * Presentational: props → JSX. It reads the window's font scale, as the design system's `Text` does.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { useWindowDimensions } from 'react-native';
import { View } from 'tamagui';

import { factRowStacksAt } from './model.js';
import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => {
    const stacked = factRowStacksAt(useWindowDimensions().fontScale);

    return (
        <View
            accessible
            minHeight={56}
            flexDirection={stacked ? 'column' : 'row'}
            alignItems={stacked ? 'flex-start' : 'center'}
            justifyContent={stacked ? 'center' : 'space-between'}
            gap="$3"
            paddingHorizontal="$4"
            paddingVertical="$2"
        >
            <Text typeRole="body" color="$ink">
                {label}
            </Text>
            <Text typeRole="body" color="$inkMuted" flexShrink={1} textAlign={stacked ? 'left' : 'right'}>
                {value}
            </Text>
        </View>
    );
};
