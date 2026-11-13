/**
 * @module @commise/ui/snackbar — the context a `SnackbarHost` gives the open windows, so the one snackbar can draw in
 * the window on top. Absent outside a host, where an outlet draws nothing.
 */
import { createContext, type ReactNode } from 'react';

import type { SnackbarOutletEntry } from './snackbarOutlets.js';

/** What the host shares with the windows' outlets. */
export interface SnackbarOutlets {
    /** Add a window's outlet to the stack. The returned function removes it, wherever it sits by then. */
    readonly register: (entry: SnackbarOutletEntry) => () => void;
    /** The outlet the snackbar draws in, or `undefined` while no window offers one and the host draws it itself. */
    readonly top: string | undefined;
    /** The snackbar to draw, or `null` while none shows. */
    readonly snackbar: ReactNode;
}

/** The host's outlets, or `null` outside a host. */
export const SnackbarOutletContext = createContext<SnackbarOutlets | null>(null);
