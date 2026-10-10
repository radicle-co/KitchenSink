/**
 * @module @commise/ui/layout — whether a screen frame puts its chrome away for the keyboard, now
 * (`docs/design/compactHeightLayout.md` §2 and §5).
 *
 * Only a window compact in height with a keyboard open collapses: held upright, the keyboard leaves room, and hiding
 * chrome there would cost the cook their navigation and buy nothing.
 *
 * @pattern Adapter over the window and keyboard readings — the `isFrameCollapsed` Specification, kept current.
 */
import { isFrameCollapsed } from './compactHeight.js';
import { useCompactHeight } from './useCompactHeight.native.js';
import { useKeyboardShown } from './useKeyboardShown.native.js';

/**
 * Whether the screen frames put their chrome away for the keyboard.
 *
 * @returns `true` while the window is compact in height AND an on-screen keyboard is open.
 */
export function useFrameCollapsed(): boolean {
    return isFrameCollapsed(useCompactHeight(), useKeyboardShown());
}
