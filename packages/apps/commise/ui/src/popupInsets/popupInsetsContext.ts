/**
 * @module @commise/ui/popup-insets — how much of the viewport a page's own fixed or sticky chrome covers, for the
 * design system's web popups to keep clear of (`docs/design/rowEditorOpenDecisions.md` V3-1).
 *
 * A popup cannot see the page around it, and the page cannot see the popups inside it, so the page publishes a
 * READER: a function the popup calls each time it places itself. A reader rather than a value, because the chrome's
 * extent is layout, read at the moment of placement (on each scroll and resize), never at render.
 *
 * @pattern Dependency Injection through a React context — the page provides the reader, the popup consumes it, and
 *     neither imports the other
 */
import { createContext } from 'react';

/** The CSS px of the viewport the page's own chrome covers: a band along the top, a bar along the foot. */
export interface PopupInsets {
    readonly top: number;
    readonly bottom: number;
}

/** Reads the chrome's extent now. Called during placement, never during render. */
export type PopupInsetsReader = () => PopupInsets;

/** No chrome: what a popup reads on a page that provides no reader. */
const NO_CHROME: PopupInsets = { top: 0, bottom: 0 };

/** The page's reader. The default reports no chrome. */
export const PopupInsetsContext = createContext<PopupInsetsReader>(() => NO_CHROME);
