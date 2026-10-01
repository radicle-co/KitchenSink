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
 * - The keyboard: on iOS a `KeyboardAvoidingView` lifts the sheet; on Android the Modal's own window resizes, so
 *   nothing is added there or the keyboard would be counted twice.
 * - It slides in only when reduce motion is known to be off. The answer is read even while closed, so it is ready
 *   before the first open.
 * - It renders nothing while closed, the house `Modal` shape, so each open starts the panel fresh.
 *   ⚠️ On iOS that probably skips the Modal's slide-out, which React Native plays only for a Modal still mounted
 *   with `visible={false}`. Hiding it instead would also move the host's focus return to after `onDismiss`. A
 *   device check decides first (§S8.1, "Owed on a device").
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state.
 *
 * @pattern Adapter over React Native's `Modal` — the skeleton and the collapse are `BottomSheetPanel`'s Template
 *     Method.
 */
import { useState, type FC } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { palette, tint } from '../tokens/colors.js';
import type { SheetProps } from './props.js';
import { BottomSheetPanel } from './BottomSheetPanel.native.js';
import { sheetAnimationType } from './sheetPresentation.js';

export const Sheet: FC<SheetProps> = ({ open, onOpenChange, title, closeLabel, size, toolbar, children, footer }) => {
    const reduceMotion = useReduceMotion();
    const insets = useSafeAreaInsets();
    const [shown, setShown] = useState(0);

    if (!open) {
        return null;
    }

    const close = (): void => onOpenChange(false);

    return (
        <Modal
            visible
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            animationType={sheetAnimationType(reduceMotion)}
            onRequestClose={close}
            onShow={() => setShown((count) => count + 1)}
        >
            <View style={[styles.backdrop, { paddingTop: insets.top }]}>
                <Pressable aria-hidden accessible={false} style={StyleSheet.absoluteFill} onPress={close} />
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
                    <BottomSheetPanel
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
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: tint(palette.charcoal, 0.4) },
    // `box-none`: a tap outside the sheet passes through this layer to the scrim beneath it.
    avoider: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'box-none' },
});
