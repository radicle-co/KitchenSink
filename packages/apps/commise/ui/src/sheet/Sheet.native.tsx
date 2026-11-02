/**
 * @module @commise/ui/sheet — the native design-system `Sheet` (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * A bottom-anchored React Native `Modal` over a dimmed scrim, drawn edge to edge so the sheet can clear the status
 * and navigation bars by their insets. Every close route calls `onOpenChange(false)`: Close, a tap on the scrim, a
 * swipe down, and Android back, which an open `Modal` delivers to `onRequestClose` itself (so
 * `@commise/ui/back-intercept` never sees it): `OverlayHost` turns it into the same close request.
 *
 * - The title takes screen-reader focus when the Modal SHOWS, every time. A mount effect runs before the Modal is on
 *   screen, and a parent's effect after its children's, so `onShow` is the moment that works.
 * - Focus back to the opener belongs to the host: React Native cannot read where the reading cursor was.
 * - The keyboard: `KeyboardAvoider`, shared with the centred dialog frame, lifts the sheet above it. A tap in the sheet
 *   with the keyboard up also needs every scroller AROUND it, the host screen's included, to persist taps: React
 *   Native gives a touch to the outermost scroller that captures it, across the Modal's window
 *   (`packages/tools/repoGuards/__tests__/nativeScrollerTapPersistence.test.ts`).
 * - It slides in only when reduce motion is known to be off. The answer is read even while closed, so it is ready
 *   before the first open.
 * - The `Modal` stays mounted with `visible={open}`, because React Native plays the iOS slide-out only for a Modal
 *   still mounted with `visible={false}` and reports `onDismiss` only then, on iOS only (React Native 0.86
 *   `Modal.js`). So `onDismissed` comes from that `onDismiss` on iOS, and from an effect after the close elsewhere,
 *   where the Modal leaves at once (`docs/design/rowEditorBlueprint.md` decision 5). A report that lands while the
 *   sheet is open makes the next close unreported on iOS too, so the sheet reports that close itself. ⚠️ The iOS
 *   slide-out is owed a device check (`docs/design/rowEditorOpenDecisions.md` item 8).
 * - The panel is keyed on the opening, so each open starts it fresh, a reopen during an iOS slide-out included.
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state.
 *
 * @pattern Adapter over the design-system `OverlayHost`, the `Modal` in every orientation — the skeleton and the
 *     collapse are `BottomSheetPanel`'s Template Method.
 */
import { useEffect, useEffectEvent, useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayHost } from '../overlay/OverlayHost.native.js';
import { KeyboardAvoider } from '../keyboardAvoider/KeyboardAvoider.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { SheetProps } from './props.js';
import { BottomSheetPanel } from './BottomSheetPanel.native.js';
import { sheetAnimationType, sheetIsCentred } from './sheetPresentation.js';
import { useOpenEdges } from './useOpenEdges.js';

export const Sheet: FC<SheetProps> = ({
    open,
    onOpenChange,
    onDismissed,
    title,
    closeLabel,
    size,
    presentation = 'sheet',
    toolbar,
    children,
    footer,
}) => {
    const reduceMotion = useReduceMotion();
    const { width } = useWindowDimensions();
    // Only a `content` sheet is a dialog; the other sizes keep their own geometry.
    const shape = size === 'content' ? presentation : 'sheet';
    const centred = sheetIsCentred(shape, width);
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [shown, setShown] = useState(0);
    const { opens, closes } = useOpenEdges(open);
    // iOS: the close whose `onDismiss` has arrived. A repeated report of one close sets the same value, so it is not a
    // second dismissal.
    const [dismissedClose, setDismissedClose] = useState(0);
    // iOS: the opening that a dismissal report reached while it was open. React Native's `Modal.js` sets `isRendered`
    // false on every report and back to true only when `visible` turns true, so that opening's close unmounts the
    // Modal at once and is never reported. The sheet reports it itself, as on Android, in the render that sees it.
    const [strandedOpening, setStrandedOpening] = useState<number | undefined>(undefined);
    const reportsDismissal = Platform.OS === 'ios';

    if (reportsDismissal && !open && strandedOpening === opens && dismissedClose !== closes) {
        setDismissedClose(closes);
    }

    const dismissed = reportsDismissal ? dismissedClose : closes;
    // The host's latest callback, read when the dismissal is reported; a new callback re-reports nothing.
    const reportDismissed = useEffectEvent(() => onDismissed?.());

    useEffect(() => {
        if (dismissed > 0) {
            reportDismissed();
        }
    }, [dismissed]);

    // The one sink: every route (Back, scrim, Close, swipe) asks the host to close, and `open` is the host's to change.
    const close = (): void => onOpenChange(false);

    return (
        <OverlayHost
            visible={open}
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            animationType={sheetAnimationType(reduceMotion)}
            onDismissRequest={close}
            onShow={() => setShown((count) => count + 1)}
            // A dismissal that lands while the sheet is open belongs to an earlier close, and strands this opening.
            onDismiss={
                reportsDismissal
                    ? () => {
                          if (open) {
                              setStrandedOpening(opens);
                          } else {
                              setDismissedClose(closes);
                          }
                      }
                    : undefined
            }
        >
            <View
                style={[
                    styles.backdrop,
                    { paddingTop: insets.top, backgroundColor: colors.scrim },
                    centred ? styles.centred : null,
                ]}
            >
                <Pressable aria-hidden accessible={false} style={StyleSheet.absoluteFill} onPress={close} />
                <KeyboardAvoider style={[styles.avoider, centred ? styles.centred : null]}>
                    <BottomSheetPanel
                        key={opens}
                        title={title}
                        closeLabel={closeLabel}
                        size={size}
                        presentation={shape}
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
        </OverlayHost>
    );
};

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end' },
    // A centred dialog (`sheetIsCentred`): the card sits mid-screen instead of on the foot.
    centred: { justifyContent: 'center' },
    // `box-none`: a tap outside the sheet passes through this layer to the scrim beneath it.
    avoider: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'box-none' },
});
