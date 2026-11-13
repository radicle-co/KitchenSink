/**
 * @module @commise/features-account/profile/LabelValuePair — a label with its value (native): beside it, the value at the
 * END of the line, or under it at the start when the column has too little room for the text size (designer rulings
 * 2026-11-01, `nativeBoards/designAnswers.md`). `ProfileFactRow` and `ProfileRow` draw their label and value through it.
 *
 * The room is `labelValueStacksAt(contentWidthOf(width), cappedFontScale(fontScale))`, read from the window here and
 * nowhere else in the Profile rows: the content width is the house's (`contentWidthOf`, as the recipe page and the list
 * results read it), and the scale is the one the text is drawn at (`cappedFontScale`).
 *
 * Beside the value the label does not shrink, so it never breaks inside a word, and the value takes what is left and
 * wraps; it never truncates. Stacked, the two sit `$1` apart, one group. React Native's `textAlign: 'right'` is the
 * line's end: React Native 0.86 swaps 'right' and 'left' when the text's layout direction is right to left (iOS
 * `RCTAttributedTextUtils.mm`, Android `TextLayoutManager.getTextAlignment`), so 'left' is the start by the same swap.
 *
 * Presentational: props → JSX, with the window's size read as the design system's `Text` reads it.
 */
import { contentWidthOf } from '@commise/ui/container-class';
import { cappedFontScale } from '@commise/ui/font-scale-cap';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { useWindowDimensions } from 'react-native';
import { View } from 'tamagui';

import { labelValueStacksAt } from './model.js';
import type { LabelValuePairProps } from './props.js';

/** The label and its value. */
export const LabelValuePair: FC<LabelValuePairProps> = ({ label, value }) => {
    const { width, fontScale } = useWindowDimensions();
    const stacked = labelValueStacksAt(contentWidthOf(width), cappedFontScale(fontScale));

    return (
        <View
            flexGrow={1}
            flexShrink={1}
            flexDirection={stacked ? 'column' : 'row'}
            alignItems={stacked ? 'flex-start' : 'center'}
            justifyContent={stacked ? 'center' : 'space-between'}
            gap={stacked ? '$1' : '$3'}
        >
            <View flexShrink={stacked ? 1 : 0}>{label}</View>
            {/* minWidth 0: on the web a flex item cannot shrink below its longest word, and an email has no spaces. */}
            <Text typeRole="body" color="$inkMuted" flexShrink={1} minWidth={0} textAlign={stacked ? 'left' : 'right'}>
                {value}
            </Text>
        </View>
    );
};
