/**
 * @module components/auth/AuthScreenFrame — the shell every signed-out screen (sign-in, sign-up, the social finish
 * step) stands in: the safe area, keyboard avoidance so the keyboard never occludes an input, a scroll that keeps a
 * tap on a control working while the keyboard is up, and the FOOTER (the error line and the primary) that the keyboard
 * must never hide (`docs/design/uiOverhaul/buildSpec.md` §8.1).
 *
 * The footer has two fixed slots, never one ternary that moves the `ScrollView`'s index. With the keyboard down it is
 * in the flow straight after the fields (fields → error → primary → trailing link, the order web reads in). With the
 * keyboard up it is pinned under the scroll, just above the keyboard, unless it is taller than half the frame
 * (`isFooterUnpinned`, measured by `usePinnedFooter`; the screen has no pinned top row, so `pinnedTop` stays 0), when it
 * goes back into the flow so a large text size or a long error cannot squeeze the fields out. Moving the footer
 * remounts it; that happens only when the keyboard opens or closes, and then focus is in a text field.
 *
 * ⛔ Do not set `automaticallyAdjustKeyboardInsets` on the scroll: it measures against the keyboard while
 * `KeyboardAvoider` already pads for it, so the keyboard is counted twice.
 *
 * The root is TRANSPARENT so the root `AppCanvas` beach-glow gradient shows through (issue #145); an opaque fill here
 * occludes the whole canvas and restores the flat page the wireframes never had.
 *
 * Presentational: it holds no domain state. The only state is the measurement that decides the slot.
 *
 * @pattern Template Method — the fixed chrome, with host-supplied steps (children, footer, trailing)
 * @pattern Specification — `isFooterUnpinned`, shared with the Sheet and the recipe wizard, decides the footer's slot
 */
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { usePinnedFooter, useKeyboardShown } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import type { JSX, ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Props for {@link AuthScreenFrame}. */
export interface AuthScreenFrameProps {
    /** The screen's sections down to the fields, in reading order; the frame spaces them. */
    readonly children: ReactNode;
    /** The error line and the primary. The frame places it in the flow or pins it above the keyboard. */
    readonly footer: ReactElement;
    /** What follows the footer in the flow and always scrolls: the switch link, the code actions, "Start over". */
    readonly trailing?: ReactNode;
}

/**
 * The frame a signed-out screen stands in.
 *
 * @param props - The content, the footer and what trails it.
 * @returns The content inside the safe area, keyboard avoidance and scroll, with the footer in its slot.
 * @sideEffect Listens for the keyboard and for layout events while mounted.
 */
export function AuthScreenFrame({ children, footer, trailing }: AuthScreenFrameProps): JSX.Element {
    const keyboardShown = useKeyboardShown();
    const pinning = usePinnedFooter();
    const pinned = keyboardShown && !pinning.unpinned;
    // ONE footer style in both slots: the rule measures the footer, and a footer taller in one slot than the other can
    // flip back and forth near the limit.
    const footerView = (
        <View style={styles.footer} onLayout={pinning.onFooterLayout}>
            {footer}
        </View>
    );

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoider style={styles.flex}>
                <View style={styles.flex} onLayout={pinning.onFrameLayout}>
                    <ScrollView
                        contentContainerStyle={styles.container}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                    >
                        {children}
                        {pinned ? null : footerView}
                        {trailing}
                    </ScrollView>
                    {pinned ? <View style={styles.pinnedSlot}>{footerView}</View> : null}
                </View>
            </KeyboardAvoider>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[5],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    // Vertical padding only: in the flow the content's own side padding applies, and the pinned slot adds the same sides.
    footer: { gap: nativeTokens.spacing[2], paddingVertical: nativeTokens.spacing[3] },
    pinnedSlot: { paddingHorizontal: nativeTokens.spacing[5] },
});
