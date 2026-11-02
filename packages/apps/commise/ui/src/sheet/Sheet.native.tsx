/**
 * @module @commise/ui/sheet — the native design-system `Sheet` (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * A bottom-anchored sheet on Tamagui's own `Sheet` (`SheetEngine`), inside the window `OverlayHost` opens, over a dimmed
 * scrim, drawn edge to edge so the sheet can clear the status and navigation bars by their insets. Every close route asks
 * the host once and the host answers by changing `open`: Close, the overlay, a drag to the bottom, and Android back, which
 * an open `Modal` delivers to `onRequestClose` itself (so `@commise/ui/back-intercept` never sees it).
 *
 * - The title takes screen-reader focus when the Modal SHOWS, every time. A mount effect runs before the Modal is on
 *   screen, and a parent's effect after its children's, so `onShow` is the moment that works.
 * - Focus back to the opener belongs to the host: React Native cannot read where the reading cursor was.
 * - The keyboard: `KeyboardAvoider`, shared with the centred dialog frame, owns it. Tamagui's own keyboard movement is
 *   off. ⚠️ The engine places the sheet from the window, not from the avoided box, so whether `KeyboardAvoider` lifts it is
 *   owed a device check (a field in the collection sheet, and the Unit combobox).
 * - The window stays up until the engine has finished the exit (`isFinishedClose`), with no animation of its own, so
 *   the slide-out shows on both platforms; a fallback timer lets go if the engine never reports the end. An engine that has
 *   reported no transition at all is not animating, so there is no exit to wait for. A Back during the exit
 *   asks nothing: `open` is already false.
 * - While the exit plays the sheet is hidden from the screen reader, so reading and focus can return to the opener at
 *   once rather than when the animation ends. With reduce motion on or unknown there is no exit: the window leaves at
 *   once, which also leaves no chance of an invisible window catching touches.
 * - Every route has a caller: Back (the host), the scrim of a centred dialog, Close, the engine's own close, and the
 *   screen-reader escape (`OverlayView`).
 * - A centred dialog (`presentation="dialog"` from the tablet width) has no bottom to drag to, so it keeps the window's own
 *   fade, with no engine. It slides in only when reduce motion is known to be off.
 * - The Modal stays mounted with `visible` false after the exit, because React Native plays the iOS slide-out only for a
 *   Modal still mounted with `visible={false}` and reports `onDismiss` only then, on iOS only (React Native 0.86
 *   `Modal.js`). So `onDismissed` comes from that `onDismiss` on iOS, and from an effect after the window leaves elsewhere
 *   (`docs/design/rowEditorBlueprint.md` decision 5). A report that lands while the window is up makes the next close
 *   unreported on iOS too, so the sheet reports that close itself. ⚠️ The iOS slide-out is owed a device check
 *   (`docs/design/rowEditorOpenDecisions.md` item 8).
 * - The panel is keyed on the sheet's opening, so each opening starts it fresh.
 *
 * A presentational component: controlled by `open`, it fetches nothing and holds no domain state.
 *
 * @pattern Adapter over the design-system `OverlayHost` and Tamagui's `Sheet` — the skeleton and the collapse are
 *     `BottomSheetPanel`'s Template Method.
 */
import { useEffect, useEffectEvent, useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoider } from '../keyboardAvoider/KeyboardAvoider.native.js';
import { KeyboardLift } from '../keyboardAvoider/KeyboardLift.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import type { DismissRequest } from '../overlay/dismissRoute.js';
import { OverlayHost } from '../overlay/OverlayHost.native.js';
import { OverlayView } from '../overlay/OverlayView.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { SheetProps } from './props.js';
import { BottomSheetPanel } from './BottomSheetPanel.native.js';
import { isFinishedClose, SHEET_EXIT_FALLBACK_MS } from './sheetEngineLifecycle.js';
import { sheetAnimationType, sheetIsCentred } from './sheetPresentation.js';
import { SheetEngine } from './SheetEngine.native.js';
import { useOpenEdges } from './useOpenEdges.js';
import { useSheetExit } from './useSheetExit.js';

export const Sheet: FC<SheetProps> = ({
    open,
    held = false,
    onOpenChange,
    onDismissed,
    onShown,
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
    // Whether the engine has reported a transition: only an engine that is animating has an exit to wait for. One that
    // never reports (no layout yet, or a lane with no frames) leaves the window at once, as it did before the engine.
    const [engineLive, setEngineLive] = useState(false);
    // A held sheet's window is down while `open` stays true: nothing is closed, so nothing is reported and nothing starts fresh.
    const windowOpen = open && !held;
    const { exiting, finishExit } = useSheetExit(windowOpen, !centred && engineLive && reduceMotion === false && !held);
    const visible = windowOpen || exiting;
    const { opens, closes } = useOpenEdges(visible || held);
    // The panel starts fresh at each opening of the SHEET, even one that comes while the last exit still plays.
    const panelKey = useOpenEdges(open).opens;
    // Where the cook last left the panel's scroll, for the opening it belongs to: a hold puts it back, a fresh opening does not.
    const [scrolled, setScrolled] = useState({ opening: 0, y: 0 });
    // iOS: the close whose `onDismiss` has arrived. A repeated report of one close sets the same value, so it is not a
    // second dismissal.
    const [dismissedClose, setDismissedClose] = useState(0);
    // iOS: the showing that a dismissal report reached while it was up. React Native's `Modal.js` sets `isRendered`
    // false on every report and back to true only when `visible` turns true, so that showing's close unmounts the Modal
    // at once and is never reported. The sheet reports it itself, as on Android, in the render that sees it.
    const [strandedOpening, setStrandedOpening] = useState<number | undefined>(undefined);
    const reportsDismissal = Platform.OS === 'ios';

    if (reportsDismissal && !visible && strandedOpening === opens && dismissedClose !== closes) {
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

    // @sideEffect Arms the fallback while an exit plays: a lost completion report must not leave a transparent window
    // blocking every touch behind it.
    useEffect(() => {
        if (!exiting) {
            return undefined;
        }

        const timer = setTimeout(finishExit, SHEET_EXIT_FALLBACK_MS);

        return () => clearTimeout(timer);
    }, [exiting, finishExit]);

    // The one sink. Idempotent by the guard: Back during an exit finds `open` already false and asks nothing.
    const request: DismissRequest = () => {
        if (open) {
            onOpenChange(false);
        }
    };

    // The scrim catcher stands behind the panel and fills what the panel leaves: a press on the screen above the sheet asks
    // the host to close. A bottom sheet's engine frame is as tall as the window, so the engine's own overlay is never
    // pressed; this is the scrim's press, for both shapes.
    const content = (
        <>
            <Pressable
                aria-hidden
                accessible={false}
                style={StyleSheet.absoluteFill}
                onPress={() => request('scrim')}
            />
            <BottomSheetPanel
                key={panelKey}
                title={title}
                closeLabel={closeLabel}
                size={size}
                presentation={shape}
                toolbar={toolbar}
                footer={footer}
                focusSignal={shown}
                reduceMotion={reduceMotion}
                restoreScrollY={scrolled.opening === panelKey ? scrolled.y : 0}
                onScrollSettled={(y) => setScrolled({ opening: panelKey, y })}
                onClose={() => request('close')}
                onSwipeDismiss={() => request('swipe')}
            >
                {children}
            </BottomSheetPanel>
        </>
    );

    // The lift stands around the panel, INSIDE the engine's frame: the engine places the frame from the window with a
    // transform, so an avoider outside it would pad a box nothing sits in, and `KeyboardAvoidingView`'s parent-relative
    // arithmetic fell short on a device, leaving the panel's action behind the keyboard. `KeyboardLift` measures the box's
    // bottom edge against the keyboard's top. A centred dialog has no engine and keeps the avoider.
    const avoided = centred ? (
        <KeyboardAvoider style={[styles.avoider, styles.centred]}>{content}</KeyboardAvoider>
    ) : (
        <KeyboardLift topInset={insets.top} bottomInset={insets.bottom}>
            {content}
        </KeyboardLift>
    );

    return (
        <OverlayHost
            visible={visible}
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            animationType={centred ? sheetAnimationType(reduceMotion) : 'none'}
            onDismissRequest={request}
            onShow={() => {
                setShown((count) => count + 1);
                onShown?.();
            }}
            // A dismissal that lands while the window is up belongs to an earlier close, and strands this showing.
            onDismiss={
                reportsDismissal
                    ? () => {
                          if (visible) {
                              setStrandedOpening(opens);
                          } else {
                              setDismissedClose(closes);
                          }
                      }
                    : undefined
            }
        >
            <OverlayView
                aria-hidden={exiting}
                importantForAccessibility={exiting ? 'no-hide-descendants' : 'auto'}
                style={[
                    styles.backdrop,
                    centred ? styles.centred : null,
                    // A bottom sheet's scrim is the engine's overlay; a centred dialog dims here.
                    // The engine's frame is as tall as the window, so the backdrop does not pad it down by the status bar: that put the
                    // frame's foot below the screen. The lift takes the status bar's room inside the frame (`topInset`).
                    centred ? { paddingTop: insets.top, backgroundColor: colors.scrim } : null,
                ]}
            >
                {centred ? (
                    avoided
                ) : (
                    <SheetEngine
                        open={windowOpen}
                        onTransition={(event) => {
                            setEngineLive(true);

                            if (isFinishedClose(event)) {
                                finishExit();
                            }
                        }}
                        reduceMotion={reduceMotion}
                    >
                        {avoided}
                    </SheetEngine>
                )}
            </OverlayView>
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
