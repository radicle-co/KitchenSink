/**
 * @module @commise/ui/snackbar — the native {@link SnackbarOutlet}: the place an open window offers the snackbar host.
 *
 * A React Native `Modal` is a window of its own, so a snackbar the host draws at the app root sits under an open sheet
 * or dialog, where its Undo cannot be reached. `OverlayHost` mounts one outlet in every window it opens. While the
 * window presents, the outlet registers with the host and keeps a polite `status` region mounted, empty until the host
 * hands it the snackbar. The region exists before any snackbar arrives, which is what lets the change be announced.
 * Only the outlet on top draws, and the host draws in its own place only while no outlet is registered, so the snackbar
 * is in one place at a time and is read out once.
 *
 * It is an orchestration component: it owns the registration with the host and draws a styled region.
 *
 * It sits `SNACKBAR_GAP` above the window's own bottom safe area, not above the page's bottom chrome: inside a window
 * the page's tab bar is not on screen. Over a footer at the window's foot it sits `SNACKBAR_GAP` above the footer's
 * top (designer D78). Its layer is above the sheet engine's frame (`WINDOW_LAYERS`).
 *
 * shortcut: the offset counts from the window's foot, so with the keyboard open (`KeyboardLift` lifts the panel and its
 * footer) the snackbar can sit under the keyboard; lift it by the keyboard height when a sheet with an input shows one.
 *
 * @pattern Mediator — a drawing slot the snackbar host's Mediator fills; the queue, the timer and the pause stay in the
 *     host
 */
import { useContext, useEffect, useId, type FC } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { styled, View } from 'tamagui';

import { WINDOW_LAYERS } from '../overlay/windowLayers.js';
import { SNACKBAR_GAP } from './props.js';
import { SnackbarOutletContext } from './snackbarOutletContext.js';
import { WindowAnnouncementSlot } from './WindowAnnouncementSlot.native.js';

/** Presentational: the region across the window's foot that the snackbar centres in. It takes no touches itself. */
const OutletRegion = styled(View, {
    name: 'SnackbarOutletRegion',
    // The status region must keep its own native node, or a screen reader cannot find it to announce into.
    collapsable: false,
    position: 'absolute',
    left: '$4',
    right: '$4',
    alignItems: 'center',
    // Above the sheet engine's frame: a `zIndex` beats sibling order.
    zIndex: WINDOW_LAYERS.snackbar,
    pointerEvents: 'box-none',
});

/** Props for {@link SnackbarOutlet}. */
export interface SnackbarOutletProps {
    /** Whether the window is open for the cook now: `false` while it is held or its exit plays. */
    readonly presenting: boolean;
    /** How many windows deep this window is: 1 when opened from the app, 2 inside another window, and so on. */
    readonly depth: number;
    /**
     * The height of a footer at the window's foot, bottom inset included, or 0 when none is (designer D78). The
     * snackbar then sits one gap above the footer's top and never covers it.
     */
    readonly footHeight?: number;
}

/**
 * The snackbar's place in one open window.
 *
 * @param props - Whether the window presents, how deep it is nested, and the height of its pinned footer.
 * @returns The window's status region, holding the snackbar when this outlet is on top; nothing outside a host or
 *     while the window does not present.
 * @sideEffect Registers the outlet with the host while the window presents.
 */
export const SnackbarOutlet: FC<SnackbarOutletProps> = ({ presenting, depth, footHeight = 0 }) => {
    const outlets = useContext(SnackbarOutletContext);
    const token = useId();
    const insets = useSafeAreaInsets();
    const register = outlets?.register;

    // Registration is a subscription to the host's outlet stack, held for as long as the window presents.
    useEffect(() => {
        if (!presenting || register === undefined) {
            return undefined;
        }

        return register({ token, depth });
    }, [presenting, register, token, depth]);

    if (outlets === null || !presenting) {
        return null;
    }

    return (
        <>
            <WindowAnnouncementSlot isTop={outlets.top === token} />
            <OutletRegion
                collapsable={false}
                role="status"
                aria-live="polite"
                bottom={(footHeight > 0 ? footHeight : insets.bottom) + SNACKBAR_GAP}
            >
                {outlets.top === token ? outlets.snackbar : null}
            </OutletRegion>
        </>
    );
};
