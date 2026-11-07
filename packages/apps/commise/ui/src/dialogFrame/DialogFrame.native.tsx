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
 * - It fades in only when reduce motion is known to be off, the Sheet's rule (`dialogAnimationType`).
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state; its one state is the
 * count of shows that moves the reading cursor.
 *
 * @pattern Template Method — the fixed chrome (window, scrim, insets, keyboard, card, scroll, title), with the host's
 *     body and actions as the step
 */
import { useState, type FC } from 'react';
import { StyleSheet } from 'react-native';
import type { TamaguiTextElement } from 'tamagui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayHost } from '../overlay/OverlayHost.native.js';
import { OverlayView } from '../overlay/OverlayView.native.js';
import { KeyboardAvoider } from '../keyboardAvoider/KeyboardAvoider.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Text } from '../text/Text.native.js';
import { ToneScope } from '../surfaceTone/ToneScope.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { DialogEngine } from './DialogEngine.native.js';
import { dialogAnimationType, dialogScrimPadding } from './dialogFrameLayout.js';
import type { DialogFrameProps } from './props.js';

/** The centred dialog frame. */
export const DialogFrame: FC<DialogFrameProps> = ({ open, onRequestClose, title, role, children }) => {
    const insets = useSafeAreaInsets();
    const [shown, setShown] = useState(0);
    const titleRef = useScreenReaderFocusOnSignal<TamaguiTextElement>(shown);
    const { colors } = useTheme();
    const reduceMotion = useReduceMotion();

    if (!open) {
        return null;
    }

    return (
        <OverlayHost
            visible
            transparent
            animationType={dialogAnimationType(reduceMotion)}
            statusBarTranslucent
            navigationBarTranslucent
            onDismissRequest={() => onRequestClose()}
            onShow={() => setShown((count) => count + 1)}
        >
            <OverlayView
                style={[
                    styles.scrim,
                    {
                        backgroundColor: colors.scrim,
                        paddingTop: dialogScrimPadding(insets.top),
                        paddingRight: dialogScrimPadding(insets.right),
                        paddingBottom: dialogScrimPadding(insets.bottom),
                        paddingLeft: dialogScrimPadding(insets.left),
                    },
                ]}
            >
                <KeyboardAvoider style={styles.avoider}>
                    <ToneScope tone="paperOverlay">
                        <DialogEngine
                            role={role}
                            onEngineClose={onRequestClose}
                            heading={
                                <Text ref={titleRef} role="heading" typeRole="sectionTitle">
                                    {title}
                                </Text>
                            }
                        >
                            {children}
                        </DialogEngine>
                    </ToneScope>
                </KeyboardAvoider>
            </OverlayView>
        </OverlayHost>
    );
};

const styles = StyleSheet.create({
    scrim: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    avoider: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
});
