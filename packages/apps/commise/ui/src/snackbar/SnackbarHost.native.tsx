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
 * @pattern Mediator — the host stands between the screens that ask and the one snackbar that shows; the queue's rules
 *     are the pure reducer's (State + Command)
 */
import { useContext, useEffect, useState, type FC } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { PopupInsetsContext } from '../popupInsets/popupInsetsContext.js';
import { nativeTokens } from '../tokens/native.js';
import { SNACKBAR_GAP, type SnackbarHostProps } from './props.js';
import { SnackbarContext } from './snackbarContext.js';
import { UndoSnackbar } from './UndoSnackbar.native.js';
import { useSnackbarQueue } from './useSnackbarQueue.js';

/** The native snackbar host. */
export const SnackbarHost: FC<SnackbarHostProps> = ({ children }) => {
    const queue = useSnackbarQueue();
    const readInsets = useContext(PopupInsetsContext);
    const [bottom, setBottom] = useState(SNACKBAR_GAP);
    const [screenReader, setScreenReader] = useState(false);
    const { current } = queue;
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
                    setBottom(readInsets().bottom + SNACKBAR_GAP);
                    queue.show(input);
                },
            }}
        >
            {children}
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                <View
                    collapsable={false}
                    role="status"
                    aria-live="polite"
                    pointerEvents="box-none"
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
