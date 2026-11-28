/**
 * @module dockHeightContext — how the timer dock tells the screen that mounts it how tall its foot is, so the app's one
 * snackbar host draws above it. The cooking feature knows no navigator: the route adapter provides this callback and
 * adds the route's own key before it reports on.
 *
 * @pattern Observer — the foot reports each change of its height; the route adapter subscribes by providing the callback
 */
import { createContext } from 'react';

/** Called with the pt from the screen's bottom edge to the top of the dock, or 0 when no dock draws. */
export type ReportDockHeight = (height: number) => void;

/** Without a route adapter (a test of one screen) a report goes nowhere. */
export const DockHeightContext = createContext<ReportDockHeight>(() => undefined);
