/**
 * @module @commise/ui/popup-insets — how much of the viewport a page's own fixed or sticky chrome covers, for the
 * design system's web popups to keep clear of (`docs/design/rowEditorOpenDecisions.md` V3-1).
 *
 * A popup cannot see the page around it, and the page cannot see the popups inside it, so the page publishes a
 * READER: a function the popup calls to learn the chrome's extent. A reader rather than a value, because the extent is
 * layout. A web popup reads it at the moment of placement (on each scroll and resize), never at render.
 *
 * A native consumer has no scroll or resize event to place itself on, so it reads the reader while it renders. It
 * re-renders on the context value, so a native reader's IDENTITY must change whenever its answer changes. A reader that
 * stays the same function while its answer changes leaves that consumer at the old foot.
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

/** Reads the chrome's extent now. A web popup calls it in placement; a native consumer may call it in render. */
export type PopupInsetsReader = () => PopupInsets;

/** No chrome: what a popup reads on a page that provides no reader. */
const NO_CHROME: PopupInsets = { top: 0, bottom: 0 };

/** The page's reader. The default reports no chrome. */
export const PopupInsetsContext = createContext<PopupInsetsReader>(() => NO_CHROME);
