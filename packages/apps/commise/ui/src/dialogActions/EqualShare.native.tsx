/**
 * @module @commise/ui/dialog-actions — the native share of one action in a `DialogActions` row with `shares="equal"`.
 *
 * Its own file because it is styled with Tamagui (ADR-0080), and a file that imports Tamagui holds no React Native
 * styling: `DialogActions.native.tsx` keeps its two StyleSheet entries (the ratchet only falls) and does not import it.
 * A presentational component. It is always mounted around an action, and only its style changes with the form, so a flip never remounts a button.
 * `minWidth 0` lets a long label wrap inside its share instead of widening the row; stacked, it adds nothing.
 *
 * @pattern Decorator — wraps one action with the share it takes in a row
 */
import { styled, YStack } from 'tamagui';

export const EqualShare = styled(YStack, {
    name: 'DialogActionsEqualShare',
    minWidth: 0,
    variants: {
        inRow: { true: { flexGrow: 1, flexShrink: 1, flexBasis: 0 } },
    } as const,
});
