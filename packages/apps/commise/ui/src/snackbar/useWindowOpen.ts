/**
 * @module @commise/ui/snackbar — whether a window is open over the page.
 */
import { useContext } from 'react';

import { SnackbarOutletContext } from './snackbarOutletContext.js';

/**
 * Whether any window is open over the page: a host has an outlet on top.
 *
 * @returns `true` while a window is open; `false` with none, and outside a host.
 */
export function useWindowOpen(): boolean {
    return useContext(SnackbarOutletContext)?.top !== undefined;
}
