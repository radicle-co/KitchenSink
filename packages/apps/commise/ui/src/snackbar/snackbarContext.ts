/**
 * @module @commise/ui/snackbar — the context a `SnackbarHost` provides, and the error a screen gets without one.
 *
 * @pattern Dependency Injection through a React context — the host provides `show`, a screen consumes it, and neither
 *     imports the other
 */
import { createContext } from 'react';

import type { SnackbarApi } from './props.js';

/** The host's API, or `null` outside a host. */
export const SnackbarContext = createContext<SnackbarApi | null>(null);

/** Raised when a screen asks for a snackbar with no `SnackbarHost` above it: a wiring defect, never a runtime state. */
export class SnackbarHostMissingError extends Error {
    public constructor() {
        super('useSnackbar() needs a SnackbarHost above it; the app mounts one at its root.');
        this.name = 'SnackbarHostMissingError';
        Object.setPrototypeOf(this, SnackbarHostMissingError.prototype);
    }
}

/**
 * Whether a value is a {@link SnackbarHostMissingError}. Pure.
 *
 * @param error - Anything thrown.
 * @returns `true` for the missing-host error.
 */
export function isSnackbarHostMissingError(error: unknown): error is SnackbarHostMissingError {
    return error instanceof SnackbarHostMissingError;
}
