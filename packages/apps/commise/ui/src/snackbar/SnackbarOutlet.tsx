'use client';

/**
 * @module @commise/ui/snackbar — the web {@link SnackbarOutlet}: the place an open sheet offers the snackbar host.
 *
 * While a modal Radix dialog is open, Radix keeps Tab inside its content, hides everything outside it from screen
 * readers, and closes it on a press outside, so a snackbar drawn at the page's foot cannot be reached. `Sheet` mounts
 * one outlet inside its content; so does every other web window, through `WindowScope`. While mounted, the outlet
 * registers with the host and keeps a polite `status` region in place, empty until the host hands it the snackbar, so
 * the change is announced. Just before that region it keeps an announcement slot, which speaks what a notice on the
 * page below cannot say while the window hides the page (`WindowAnnouncementSlot`). Only the outlet on top draws, and
 * the host draws in its own place only while no outlet is registered, so the snackbar is in one place at a time.
 *
 * It sits 16 above the sheet's own foot and 16 in from its sides: the viewport's foot below `sm`, where the sheet fills
 * it, and the dialog's foot from `sm`, where the sheet is a centred dialog.
 *
 * A window with a pinned foot passes its height as `footHeight`, so the snackbar sits 16 above the foot and the foot's
 * actions stay clear. With no foot, or once the foot scrolls with the content, it is unset and the offset is the 16.
 *
 * @pattern Mediator — a drawing slot the snackbar host's Mediator fills; the queue, the timer and the pause stay in the
 *     host
 */
import { useContext, useEffect, useId, type FC } from 'react';

import { SnackbarOutletContext } from './snackbarOutletContext.js';
import { WindowAnnouncementSlot } from './WindowAnnouncementSlot.js';

/** Props for {@link SnackbarOutlet}. */
export interface SnackbarOutletProps {
    /** How many windows deep this sheet is: 1 when opened from the page, 2 inside another sheet, and so on. */
    readonly depth: number;
    /**
     * How tall the window's pinned foot is in px; the snackbar sits 16 above it. Unset: 16 above the window's foot.
     * Not a dependency of the registration: a foot that re-measures must not make this outlet the latest one at
     * its own depth.
     */
    readonly footHeight?: number;
}

/**
 * The snackbar's place in one open sheet.
 *
 * @param props - How deep the window is nested, and how tall its pinned foot is.
 * @returns The announcement slot, then the sheet's status region holding the snackbar when this outlet is on top;
 *     nothing outside a host.
 * @sideEffect Registers the outlet with the host while it is mounted.
 */
export const SnackbarOutlet: FC<SnackbarOutletProps> = ({ depth, footHeight }) => {
    const outlets = useContext(SnackbarOutletContext);
    const token = useId();
    const register = outlets?.register;

    // Registration is a subscription to the host's outlet stack, held while the sheet's content is mounted.
    useEffect(() => {
        if (register === undefined) {
            return undefined;
        }

        return register({ token, depth });
    }, [register, token, depth]);

    if (outlets === null) {
        return null;
    }

    return (
        <>
            <WindowAnnouncementSlot isTop={outlets.top === token} />
            <div
                role="status"
                className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center"
                style={footHeight === undefined ? undefined : { bottom: `calc(${String(footHeight)}px + 1rem)` }}
            >
                {outlets.top === token ? outlets.snackbar : null}
            </div>
        </>
    );
};
