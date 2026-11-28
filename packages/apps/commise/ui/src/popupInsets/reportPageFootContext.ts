/**
 * @module @commise/ui/popup-insets — how a task screen's own bottom bar (the cooking dock) tells the navigator how tall
 * it is, so the one snackbar host draws above it.
 *
 * The host sits above every screen and reads `PageFootContext`, so a screen cannot change it by providing a nested
 * value. The navigator provides this REPORTER instead. A report names the route it comes from, and the navigator uses
 * it only while that route is the focused one, so the order of reports and focus changes never matters. Native only:
 * web popups read the registry in `popupInsetsRegistry`.
 *
 * @pattern Observer — the screen reports each change of its foot height; the navigator subscribes by providing the
 *     callback
 */
import { createContext } from 'react';

/** A screen's bottom bar: the route key it sits on, and the pt from the screen's bottom edge to the bar's top. */
export interface PageFootReport {
    readonly routeKey: string;
    readonly height: number;
}

/** What a screen calls with its report: its own route key (`useRoute().key`) and height, or 0 for none. */
export type ReportPageFoot = (report: PageFootReport) => void;

/** The navigator's callback. Without a navigator (a test of one screen) a report goes nowhere. */
export const ReportPageFootContext = createContext<ReportPageFoot>(() => undefined);
