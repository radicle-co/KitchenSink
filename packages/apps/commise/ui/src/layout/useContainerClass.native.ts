/**
 * @module @commise/ui/layout — the container class of the width content gets on native, now
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2).
 *
 * Native never shows a sidebar, so content gets the WINDOW's width less a gutter on each side; the classes and the
 * gutters are the same numbers web reads from `theme.css` (`tokens/layout.ts`). Re-renders on a rotation.
 *
 * @pattern Adapter over React Native's window dimensions — the `containerClassOf` Policy, kept current.
 */
import { useWindowDimensions } from 'react-native';

import { containerClassOf, contentWidthOf, type ContainerClass } from './containerClass.js';

/**
 * The container class content takes at the current window width.
 *
 * @returns `narrow`, `regular` or `wide`.
 */
export function useContainerClass(): ContainerClass {
    return containerClassOf(contentWidthOf(useWindowDimensions().width));
}
