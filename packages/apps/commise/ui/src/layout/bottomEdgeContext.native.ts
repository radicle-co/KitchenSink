/**
 * @module @commise/ui/layout — the bottom edge a screen's frame publishes, for popups opened in a modal window (which
 * inherits no insets) to clear: a `BottomChromeFrame`'s measured footer, or the navigator's tab bar through
 * `BottomEdgeProvider`. `null` when nothing publishes one, and `useBottomEdge` then falls back to the safe-area inset.
 */
import { createContext } from 'react';

/** The bottom edge a frame publishes; `null` when no frame is above. */
export const BottomEdgeContext = createContext<number | null>(null);
