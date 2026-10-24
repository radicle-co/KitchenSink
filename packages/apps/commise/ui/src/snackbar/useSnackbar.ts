/**
 * @module @commise/ui/snackbar — `useSnackbar`: how a screen shows a snackbar through the app's one `SnackbarHost`.
 */
import { useContext } from 'react';

import type { SnackbarApi } from './props.js';
import { SnackbarContext, SnackbarHostMissingError } from './snackbarContext.js';

/**
 * The app's snackbar.
 *
 * @returns `show`, which displays a snackbar and commits the one it replaces.
 * @throws SnackbarHostMissingError when no `SnackbarHost` is mounted above the caller.
 */
export function useSnackbar(): SnackbarApi {
    const api = useContext(SnackbarContext);

    if (api === null) {
        throw new SnackbarHostMissingError();
    }

    return api;
}
