/**
 * @module @commise/ui/overlay — how many windows deep a subtree is: 0 in the app, 1 inside a sheet or dialog, 2 inside a
 * window opened from one, and so on. `OverlayHost` reads it and gives its children one more. The snackbar outlet
 * uses it to put a nested window above the window around it.
 */
import { createContext } from 'react';

/** The window depth of the subtree; 0 outside every window. */
export const OverlayDepthContext = createContext(0);
