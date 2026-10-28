/**
 * @module @commise/ui/snackbar — how tall the snackbar on screen is, published by the `SnackbarHost` so the floating
 * `CreateFab` can rise above it (bug sweep P7). The host sits at the app's root and the button inside a screen, so
 * context is the only seam between them that adds no import from one to the other.
 *
 * @pattern Dependency Injection through a React context — the host provides a measured height, the button consumes it
 */
import { createContext } from 'react';

/** The height (dp on native, px on web) of the snackbar now showing; `0` when none shows, and outside a host. */
export const SnackbarClearanceContext = createContext(0);
