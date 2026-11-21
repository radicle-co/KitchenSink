/**
 * @module @commise/ui/radio-list — the content of one native `RadioList` row: the mark and the words, as one group.
 *
 * Styled with Tamagui (ADR-0080), so this file holds no React Native styling. The row centres the group in its box,
 * and the group top-aligns its two children, so a label of one line (a row with no hint) keeps the mark on that line.
 *
 * The mark is a fixed 18 dp circle in a slot one scaled `cardTitle` line tall, so it stays beside the first line at
 * every text size; unlike `CheckBoxGlyph`, its box does not grow with the text.
 *
 * Presentational: layout and a mark, with no state of its own.
 *
 * @pattern Decorator — the layout wrapped around a row's mark and words
 * @pattern Glyph — a fixed 18 dp mark placed (not sized) by its row's `cardTitle` line
 */
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { scaledTypeSize } from '../text/scaledType.js';
import { TextScaleContext } from '../text/textScaleContext.native.js';

/** The radio circle's size, dp (`ingredientMatching.md`: 18 px radios). */
const RADIO_SIZE = 18;

/**
 * The circle and the words of one row, top-aligned, taking the row's width so the words can wrap. The three longhands are
 * what React Native's Yoga resolves `flex: 1` to (grow 1, shrink 0, basis 0), written out so a test can read them.
 */
export const RadioRowContent = styled(XStack, {
    name: 'RadioRowContent',
    alignItems: 'flex-start',
    gap: '$3',
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 0,
});

/** The slot one line of the label tall, with the circle centred in it: the circle stays beside the FIRST line. */
const RadioMarkSlot = styled(XStack, {
    name: 'RadioMarkSlot',
    flexShrink: 0,
    alignItems: 'center',
});

/** The circle: a 2 dp `lineControl` ring at rest, a 5 dp `action` ring when checked. */
const RadioMarkFrame = styled(XStack, {
    name: 'RadioMarkFrame',
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: '$full',

    variants: {
        checked: {
            true: { borderWidth: 5, borderColor: '$action' },
            false: { borderWidth: 2, borderColor: '$lineControl' },
        },
    } as const,
});

/** The row's radio circle. Hidden from assistive technology: the row is the radio. */
export const RadioMark: FC<{ readonly checked: boolean }> = ({ checked }) => {
    const { textScale } = TextScaleContext.useStyledContext();

    return (
        <RadioMarkSlot height={scaledTypeSize('cardTitle', textScale).lineHeight}>
            <RadioMarkFrame aria-hidden importantForAccessibility="no-hide-descendants" checked={checked} />
        </RadioMarkSlot>
    );
};
