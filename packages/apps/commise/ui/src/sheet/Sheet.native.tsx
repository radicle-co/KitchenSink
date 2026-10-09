/**
 * @module @commise/ui/sheet — the native design-system `Sheet` (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * A bottom-anchored React Native `Modal` over a dimmed scrim, drawn edge to edge so the sheet can clear the status
 * and navigation bars by their insets. Every close route calls `onOpenChange(false)`: Close, a tap on the scrim, a
 * swipe down, and Android back, which an open `Modal` delivers to `onRequestClose` itself (so
 * `@commise/ui/back-intercept` never sees it).
 *
 * - The title takes screen-reader focus when the Modal SHOWS, every time. A mount effect runs before the Modal is on
 *   screen, and a parent's effect after its children's, so `onShow` is the moment that works.
 * - Focus back to the opener belongs to the host: React Native cannot read where the reading cursor was.
 * - The keyboard: `KeyboardAvoider`, shared with the centred dialog frame, lifts the sheet above it.
 * - It slides in only when reduce motion is known to be off. The answer is read even while closed, so it is ready
 *   before the first open.
 * - The `Modal` stays mounted with `visible={open}`, because React Native plays the iOS slide-out only for a Modal
 *   still mounted with `visible={false}` and reports `onDismiss` only then, on iOS only (React Native 0.86
 *   `Modal.js`). So `onDismissed` comes from that `onDismiss` on iOS, and from an effect after the close elsewhere,
 *   where the Modal leaves at once (`docs/design/rowEditorBlueprint.md` decision 5). ⚠️ The iOS slide-out is owed a
 *   device check (`docs/design/rowEditorOpenDecisions.md` item 8).
 * - The panel is keyed on the opening, so each open starts it fresh, a reopen during an iOS slide-out included.
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state.
 *
 * @pattern Adapter over the design-system `Modal`, React Native's `Modal` in every orientation — the skeleton and the
 *     collapse are `BottomSheetPanel`'s Template Method.
 */
import { useEffect, useEffectEvent, useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Modal } from '../modal/Modal.native.js';
import { KeyboardAvoider } from '../keyboardAvoider/KeyboardAvoider.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { SheetProps } from './props.js';
import { BottomSheetPanel } from './BottomSheetPanel.native.js';
import { sheetAnimationType } from './sheetPresentation.js';
import { useOpenEdges } from './useOpenEdges.js';

export const Sheet: FC<SheetProps> = ({
    open,
    onOpenChange,
    onDismissed,
    title,
    closeLabel,
    size,
    toolbar,
    children,
    footer,
}) => {
    const reduceMotion = useReduceMotion();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [shown, setShown] = useState(0);
    const { opens, closes } = useOpenEdges(open);
    // iOS: the close whose `onDismiss` has arrived. A repeated report of one close sets the same value, so it is not a
    // second dismissal.
    const [dismissedClose, setDismissedClose] = useState(0);
    const reportsDismissal = Platform.OS === 'ios';
    const dismissed = reportsDismissal ? dismissedClose : closes;
    // The host's latest callback, read when the dismissal is reported; a new callback re-reports nothing.
    const reportDismissed = useEffectEvent(() => onDismissed?.());

    useEffect(() => {
        if (dismissed > 0) {
            reportDismissed();
        }
    }, [dismissed]);

    const close = (): void => onOpenChange(false);

    return (
        <Modal
            visible={open}
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            animationType={sheetAnimationType(reduceMotion)}
            onRequestClose={close}
            onShow={() => setShown((count) => count + 1)}
            // A dismissal that lands after the sheet opened again belongs to a close the reopen overtook.
            onDismiss={
                reportsDismissal
                    ? () => {
                          if (!open) {
                              setDismissedClose(closes);
                          }
                      }
                    : undefined
            }
        >
            <View style={[styles.backdrop, { paddingTop: insets.top, backgroundColor: colors.scrim }]}>
                <Pressable aria-hidden accessible={false} style={StyleSheet.absoluteFill} onPress={close} />
                <KeyboardAvoider style={styles.avoider}>
                    <BottomSheetPanel
                        key={opens}
                        title={title}
                        closeLabel={closeLabel}
                        size={size}
                        toolbar={toolbar}
                        footer={footer}
                        focusSignal={shown}
                        reduceMotion={reduceMotion}
                        onClose={close}
                    >
                        {children}
                    </BottomSheetPanel>
                </KeyboardAvoider>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end' },
    // `box-none`: a tap outside the sheet passes through this layer to the scrim beneath it.
    avoider: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'box-none' },
});
