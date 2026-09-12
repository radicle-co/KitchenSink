/**
 * @module @commise/ui/dialog-frame — the design-system centred dialog frame (`docs/design/compactHeightLayout.md` §9).
 *
 * The fixed chrome every centred dialog needs, owned once: a modal window in every orientation, a dimmed scrim padded
 * into the safe area, the keyboard kept off the card, a card capped by what the keyboard leaves, its content scrolling
 * inside it, and the title first. The host supplies the body and the actions. Three dialogs hand-rolled this
 * (`ConfirmDialog`, `RecipeDeleteDialog`, `AccountEraseDialog`) and had drifted on width, height cap, radius, padding
 * and scrim; none avoided the keyboard and none cleared the safe area.
 *
 * - The title takes screen-reader focus each time the window SHOWS (`onShow`), the Sheet's rule: a mount effect runs
 *   before the window is on screen. Focus back to the opener stays the host's.
 * - Taps persist through the keyboard (`keyboardShouldPersistTaps="handled"`): with the keyboard up, the first tap on
 *   an action must press it, not only close the keyboard.
 * - It renders nothing while closed, the house `Modal` shape.
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state; its one state is the
 * count of shows that moves the reading cursor.
 *
 * @pattern Template Method — the fixed chrome (window, scrim, insets, keyboard, card, scroll, title), with the host's
 *     body and actions as the step
 */
import { useState, type FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Modal } from '../modal/Modal.native.js';
import { KeyboardAvoider } from '../keyboardAvoider/KeyboardAvoider.native.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { palette, tint } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import { displayFontFace } from '../tokens/scale.js';
import { DIALOG_CARD_MAX_WIDTH_DP, dialogScrimPadding } from './dialogFrameLayout.js';
import type { DialogFrameProps } from './props.js';

/** The centred dialog frame. */
export const DialogFrame: FC<DialogFrameProps> = ({ open, onRequestClose, title, role, children }) => {
    const insets = useSafeAreaInsets();
    const [shown, setShown] = useState(0);
    const titleRef = useScreenReaderFocusOnSignal<Text>(shown);

    if (!open) {
        return null;
    }

    return (
        <Modal
            visible
            transparent
            animationType="fade"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onRequestClose}
            onShow={() => setShown((count) => count + 1)}
        >
            <View
                style={[
                    styles.scrim,
                    {
                        paddingTop: dialogScrimPadding(insets.top),
                        paddingRight: dialogScrimPadding(insets.right),
                        paddingBottom: dialogScrimPadding(insets.bottom),
                        paddingLeft: dialogScrimPadding(insets.left),
                    },
                ]}
            >
                <KeyboardAvoider style={styles.avoider}>
                    <View role={role} aria-modal accessibilityViewIsModal style={styles.card}>
                        <ScrollView
                            keyboardShouldPersistTaps="handled"
                            style={styles.scroller}
                            contentContainerStyle={styles.content}
                        >
                            <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
                                {title}
                            </Text>
                            {children}
                        </ScrollView>
                    </View>
                </KeyboardAvoider>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(palette.charcoal, 0.4) },
    avoider: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
    card: {
        width: '100%',
        maxWidth: DIALOG_CARD_MAX_WIDTH_DP,
        maxHeight: '100%',
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        overflow: 'hidden',
    },
    // `flexGrow: 0`: the card is as tall as its content until the avoided box caps it, and then the content scrolls.
    scroller: { flexGrow: 0 },
    content: { padding: nativeTokens.spacing[5], gap: nativeTokens.spacing[3] },
    // The Sheet's title face (`displayFontFace.semibold`), so the design system's dialog primitives share one.
    title: { fontFamily: displayFontFace.semibold, fontSize: nativeTokens.fontSize.headingMd, color: palette.charcoal },
});
