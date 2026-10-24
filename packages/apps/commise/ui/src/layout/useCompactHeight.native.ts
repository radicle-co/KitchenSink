/**
 * @module @commise/ui/layout — whether the window is compact in height, now (`docs/design/compactHeightLayout.md` §2).
 *
 * Reads the WINDOW's height (`useWindowDimensions`), never the height left above the keyboard, so the keyboard alone
 * never changes a layout keyed on it. ⚠️ That Android's window height does not change when the keyboard opens is a
 * device check the spec records as owed.
 *
 * @pattern Adapter over React Native's window dimensions — the `isCompactHeight` Specification, kept current.
 */
import { useWindowDimensions } from 'react-native';

import { isCompactHeight } from './compactHeight.js';

/**
 * Whether the window is compact in height.
 *
 * @returns `true` while the window is under 480 dp tall; re-renders on a rotation.
 */
export function useCompactHeight(): boolean {
    return isCompactHeight(useWindowDimensions().height);
}
