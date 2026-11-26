'use client';

/**
 * @module @commise/ui/snackbar — the web {@link SnackbarOutlet}: the place an open sheet offers the snackbar host.
 *
 * While a modal Radix dialog is open, Radix keeps Tab inside its content, hides everything outside it from screen
 * readers, and closes it on a press outside, so a snackbar drawn at the page's foot cannot be reached. `Sheet` mounts
 * one outlet inside its content. While mounted, the outlet registers with the host and keeps a polite `status` region
 * in place, empty until the host hands it the snackbar, so the change is announced. Only the outlet on top draws, and
 * the host draws in its own place only while no outlet is registered, so the snackbar is in one place at a time.
 *
 * It sits 16 above the sheet's own foot and 16 in from its sides: the viewport's foot below `sm`, where the sheet fills
 * it, and the dialog's foot from `sm`, where the sheet is a centred dialog.
 *
 * A sheet with a pinned footer sets `--sheet-footer-inset` to the footer's height on the panel around the outlet, so
 * the snackbar sits 16 above the footer and the footer's actions stay clear. With no footer, or once the footer scrolls
 * with the content, the variable is unset and the offset is the 16 above.
 *
 * @pattern Mediator — a drawing slot the snackbar host's Mediator fills; the queue, the timer and the pause stay in the
 *     host
 */
import { useContext, useEffect, useId, type FC } from 'react';

import { SnackbarOutletContext } from './snackbarOutletContext.js';

/** Props for {@link SnackbarOutlet}. */
export interface SnackbarOutletProps {
    /** How many windows deep this sheet is: 1 when opened from the page, 2 inside another sheet, and so on. */
    readonly depth: number;
}

/**
 * The snackbar's place in one open sheet.
 *
 * @param props - How deep the sheet is nested.
 * @returns The sheet's status region, holding the snackbar when this outlet is on top; nothing outside a host.
 * @sideEffect Registers the outlet with the host while it is mounted.
 */
export const SnackbarOutlet: FC<SnackbarOutletProps> = ({ depth }) => {
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
        <div
            role="status"
            className="pointer-events-none absolute inset-x-4 bottom-[calc(var(--sheet-footer-inset,0px)+1rem)] z-10 flex justify-center"
        >
            {outlets.top === token ? outlets.snackbar : null}
        </div>
    );
};
