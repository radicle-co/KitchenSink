/**
 * @module @commise/ui/popup-insets — how a task screen's own bottom bar (the cooking dock) tells the navigator how tall
 * it is, so the one snackbar host draws above it.
 *
 * The host sits above every screen and reads `PageFootContext`, so a screen cannot change it by providing a nested
 * value. The navigator provides this REPORTER instead, and the screen calls it from an event (its layout) and with 0
 * when it goes. Native only: web popups read the registry in `popupInsetsRegistry`.
 *
 * @pattern Observer — the screen reports each change of its foot height; the navigator subscribes by providing the
 *     callback
 */
import { createContext } from 'react';

/** What a screen calls with the pt from the screen's bottom edge to its own bottom bar's top, or 0 for none. */
export type ReportPageFoot = (height: number) => void;

/** The navigator's callback. Without a navigator (a test of one screen) a report goes nowhere. */
export const ReportPageFootContext = createContext<ReportPageFoot>(() => undefined);
