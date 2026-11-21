/**
 * @module @commise/ui/radio-list — the content of one native `RadioList` row: the circle and the words, as one group.
 *
 * Its own file because it is styled with Tamagui (ADR-0080), and a file that imports Tamagui holds no React Native styling:
 * `RadioList.native.tsx` keeps its `StyleSheet` entries and does not import it. The row centres this group in its box, and
 * the group top-aligns its two children, so a label of one line (a row with no hint) keeps the circle on that line.
 *
 * Presentational: a layout, with no state of its own.
 *
 * @pattern Decorator — the layout wrapped around a row's circle and words
 */
import { styled, XStack } from 'tamagui';

/** The circle and the words of one row, top-aligned, taking the row's width so the words can wrap. */
export const RadioRowContent = styled(XStack, {
    name: 'RadioRowContent',
    alignItems: 'flex-start',
    gap: '$3',
    flex: 1,
});
