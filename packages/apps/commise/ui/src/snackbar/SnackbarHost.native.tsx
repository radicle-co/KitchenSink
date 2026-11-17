/**
 * @module @commise/ui/snackbar — the native {@link SnackbarHost}: mounted once per app (at the native root), it gives
 * screens `useSnackbar` and draws the one snackbar on screen.
 *
 * The snackbar sits in a pass-through overlay over the app, 16 pt above the bottom chrome (read from the page's
 * `PopupInsetsContext` reader as each one shows), in a polite `status` region that is always mounted. ⚠️ Native has
 * no hover, and React Native cannot see where the screen-reader cursor is, so SC 2.2.1's pause is the stronger rule:
 * while a screen reader runs, the snackbar does not time out at all, and when it stops the snackbar runs out its own
 * remaining time.
 *
 * With the keyboard up the snackbar rides 16 pt above it, whenever it opened (a Remove that focuses a field opens it
 * at once), for every snackbar.
 *
 * It also publishes the showing snackbar's measured height (`SnackbarClearanceContext`), so the floating create button
 * rises above the bar instead of sitting under it.
 *
 * @pattern Mediator — the host stands between the screens that ask and the one snackbar that shows; the queue's rules
 *     are the pure reducer's (State + Command)
 */
import { useContext, useEffect, useState, type FC } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { keyboardOverlap } from '../keyboardAvoider/keyboardOverlap.js';
import { useKeyboardFrame } from '../keyboardAvoider/useKeyboardFrame.native.js';
import { PopupInsetsContext } from '../popupInsets/popupInsetsContext.js';
import { nativeTokens } from '../tokens/native.js';
import { SNACKBAR_GAP, type SnackbarHostProps } from './props.js';
import { SnackbarClearanceContext } from './snackbarClearanceContext.js';
import { SnackbarContext } from './snackbarContext.js';
import { UndoSnackbar } from './UndoSnackbar.native.js';
import { useSnackbarQueue } from './useSnackbarQueue.js';

/** The native snackbar host. */
export const SnackbarHost: FC<SnackbarHostProps> = ({ children }) => {
    const queue = useSnackbarQueue();
    const readInsets = useContext(PopupInsetsContext);
    const [foot, setFoot] = useState(SNACKBAR_GAP);
    const { current } = queue;
    // The keyboard is read only while a snackbar shows, so the shared listeners are released the rest of the time.
    const keyboard = useKeyboardFrame(current !== null);
    const navigationBar = useSafeAreaInsets().bottom;
    // The overlay fills the window, so its foot is the window's, which follows rotation and split screen. The keyboard's top
    // is in display coordinates, and an edge-to-edge window starts at the display's top, so the two agree with nothing added.
    // The keyboard covers what the one lift rule says (`KeyboardLift`): its height plus the navigation bar at most, because
    // Android's height leaves that bar out.
    const lift = keyboardOverlap(
        useWindowDimensions().height,
        keyboard?.top ?? null,
        (keyboard?.height ?? 0) + navigationBar,
    );
    const bottom = keyboard === null ? foot : Math.max(foot, lift + SNACKBAR_GAP);
    const [screenReader, setScreenReader] = useState(false);
    const [regionHeight, setRegionHeight] = useState(0);
    const action = current?.input.action;
    const currentId = current?.id;

    // Whether a screen reader is running, now and as it changes.
    useEffect(() => {
        let mounted = true;

        void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
            if (mounted) {
                setScreenReader(on);
            }
        });
        const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);

        return () => {
            mounted = false;
            subscription.remove();
        };
    }, []);

    // The snackbar does not time out while a screen reader runs.
    const { pause, resume } = queue;

    useEffect(() => {
        if (currentId === undefined) {
            return;
        }

        if (screenReader) {
            pause(currentId);
        } else {
            resume(currentId);
        }
    }, [screenReader, currentId, pause, resume]);

    return (
        <SnackbarContext
            value={{
                show: (input) => {
                    setFoot(readInsets().bottom + SNACKBAR_GAP);
                    queue.show(input);
                },
            }}
        >
            {/* The measured height, or 0 when nothing shows, so the floating create button can rise above the bar. */}
            <SnackbarClearanceContext value={current === null ? 0 : regionHeight}>{children}</SnackbarClearanceContext>
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                <View
                    collapsable={false}
                    role="status"
                    aria-live="polite"
                    pointerEvents="box-none"
                    onLayout={(event) => setRegionHeight(event.nativeEvent.layout.height)}
                    style={[styles.region, { bottom }]}
                >
                    {current === null ? null : (
                        <UndoSnackbar
                            key={current.id}
                            message={current.input.message}
                            {...(action === undefined
                                ? {}
                                : { action: { label: action.label, onAction: () => queue.act(current.id, action) } })}
                            onPause={() => queue.pause(current.id)}
                            onResume={() => queue.resume(current.id)}
                        />
                    )}
                </View>
            </View>
        </SnackbarContext>
    );
};

const styles = StyleSheet.create({
    region: {
        position: 'absolute',
        left: nativeTokens.spacing[4],
        right: nativeTokens.spacing[4],
        alignItems: 'center',
    },
});
