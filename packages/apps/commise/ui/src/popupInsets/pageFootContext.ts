/**
 * @module @commise/ui/popup-insets — how tall the page's bottom chrome is on a native screen, in pt.
 *
 * The native snackbar host draws above this height. It is a VALUE, not a reader: native has no scroll or resize event
 * to place a popup on, so the host computes its position while it renders, and React re-renders it when the value
 * changes. Web popups read `PopupInsetsContext` instead.
 *
 * @pattern Dependency Injection through a React context — the navigator provides the height, the host consumes it,
 *     and neither imports the other
 */
import { createContext } from 'react';

/** The pt of the screen's foot the page's own chrome covers: the tab bar on a tab, the home indicator on a task. */
export const PageFootContext = createContext<number>(0);
