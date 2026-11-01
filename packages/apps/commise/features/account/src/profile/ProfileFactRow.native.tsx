/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (native): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill. It is ONE accessibility element, so a screen reader reads the label and the value together in a
 * single swipe. The value takes the room the label leaves and wraps, so a long email never runs off the screen.
 *
 * The label and the value are a `LabelValuePair`: the value at the END of the line, as the web's `text-end` does, or
 * under the label when the row has too little room for the text size (designer rulings 2026-11-01,
 * `nativeBoards/designAnswers.md`). The pair owns that rule and its right-to-left reading.
 *
 * Presentational: props → JSX.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { View } from 'tamagui';

import { LabelValuePair } from './LabelValuePair.native.js';
import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => (
    <View accessible minHeight={56} flexDirection="row" alignItems="center" paddingHorizontal="$4" paddingVertical="$2">
        <LabelValuePair
            label={
                <Text typeRole="body" color="$ink">
                    {label}
                </Text>
            }
            value={value}
        />
    </View>
);
