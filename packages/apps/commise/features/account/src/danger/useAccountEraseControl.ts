/**
 * @module @commise/features-account/danger/useAccountEraseControl — the erase row's surface state, once for both apps:
 * whether the dialog is open, and whether the erasure was ACCEPTED while only leaving failed.
 *
 * When the exit fails the dead dialog is dismissed (it would otherwise hold the viewer inside a flow whose account no
 * longer exists, and on web Radix would trap focus inside it, away from the message) and the surface shows its alert and
 * the sign-out recovery instead. The copy is `erase.signOutFailed`, deliberately not the dialog's submit error: the
 * erasure has already succeeded server-side, so inviting a retry would be a lie.
 *
 * @pattern State — closed, open and exit-failed as one headless hook
 */
import { useState } from 'react';

/** The erase row's surface state and its transitions. */
export interface AccountEraseControl {
    /** Whether the erasure dialog is shown. */
    readonly open: boolean;
    /** The erasure was accepted but ending the session failed. */
    readonly exitFailed: boolean;
    readonly openDialog: () => void;
    readonly closeDialog: () => void;
    /** Pass to the flow's `onExitFailed`. */
    readonly onExitFailed: () => void;
}

/**
 * @returns The erase row's state and transitions.
 */
export function useAccountEraseControl(): AccountEraseControl {
    const [open, setOpen] = useState(false);
    const [exitFailed, setExitFailed] = useState(false);

    return {
        open,
        exitFailed,
        openDialog: () => setOpen(true),
        closeDialog: () => setOpen(false),
        onExitFailed: () => {
            setOpen(false);
            setExitFailed(true);
        },
    };
}
