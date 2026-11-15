/**
 * @module CookingLineRow — one line of a cooking step on native: the whole row is ONE checkbox, named by the
 * line's own text, at least the platform touch floor tall, with the box drawn by the design system's glyph in a slot as
 * tall as the line, so the box sits on the first line however the text wraps.
 *
 * The press is the house `PressScale` with the checkbox role and its checked state, so a held row shrinks like every other
 * house control and a screen reader says "checked" or "not checked". The row is not given a name: its text is the name,
 * so stating it again would be a second stop saying the same thing.
 *
 * The focus line is set in the role named by `FOCUS_LINE_TYPE`, the one seam both platforms read, and every other line in
 * `readingBody`.
 *
 * Presentational: props → JSX.
 */
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { touchFloor } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import type { CookingLineRowProps } from './cookingViewProps.js';
import { FOCUS_LINE_TYPE } from './focusLineType.js';

const ROLE = { focus: FOCUS_LINE_TYPE.nativeTypeRole, other: 'readingBody' } as const;
interface Leading {
    readonly lineHeight: number;
}

/**
 * A role's leading. A role with one style per container class (largeTitle) is read at its regular class, which a phone
 * column uses. Taking both shapes as a parameter keeps the read compiling whichever role the seam names. Pure.
 */
function leadingOf(style: Leading | { readonly regular: Leading }): number {
    return 'regular' in style ? style.regular.lineHeight : style.lineHeight;
}

const LINE_HEIGHT = {
    focus: leadingOf(nativeTokens.type[ROLE.focus]),
    other: nativeTokens.type.readingBody.lineHeight,
} as const;

/** The native cooking line row. */
export const CookingLineRow: FC<CookingLineRowProps> = ({ line: { text, checked, onToggle }, emphasis }) => (
    <PressScale accessibilityRole="checkbox" checked={checked} width="fill" onPress={onToggle}>
        <XStack minHeight={touchFloor()} gap="$3" alignItems="flex-start" paddingVertical="$2">
            {/* The slot holds only the glyph, never text, so its least height is the line's and it never grows. */}
            <YStack minHeight={LINE_HEIGHT[emphasis]} justifyContent="center">
                <CheckBoxGlyph checked={checked} />
            </YStack>
            <Text typeRole={ROLE[emphasis]} color={checked ? '$inkMuted' : '$ink'} flex={1}>
                {text}
            </Text>
        </XStack>
    </PressScale>
);
