/**
 * @module @commise/ui/create-fab — the floating create control's presentation on native: `createFabPolicy` over the
 * screen's `ScrollHost`, the keyboard, the window and the control's own state. Native never shows a sidebar (D5, D6), so
 * the chrome is always the tab bar and a tablet keeps the label.
 */
import { viewportClassOf } from '../layout/containerClass.js';
import { useContext } from 'react';

import { ScrollHostContext } from '../scrollHost/scrollHostContext.js';
import { useKeyboardOpen } from '../screenEnvironment/useKeyboardOpen.native.js';
import { useWindowWidth } from '../screenEnvironment/useWindowWidth.native.js';
import { fabPresentationOf, type FabPresentation } from './createFabPolicy.js';
import type { FabSelf } from './props.js';

/**
 * @param self - Whether the screen is in first run, whether the control has focus, and its label's width.
 * @returns The presentation.
 */
export function useFabPresentation(self: FabSelf): FabPresentation {
    // Read without throwing: a control outside a scroll host (a test, a screen not yet wrapped) stays as at the top.
    const host = useContext(ScrollHostContext);
    const scrollingDown = host?.scrollingDown ?? false;
    const atTop = host?.atTop ?? true;
    const keyboardOpen = useKeyboardOpen();
    const windowWidthPx = useWindowWidth();

    return fabPresentationOf({
        viewportClass: viewportClassOf(windowWidthPx),
        chrome: 'tabBar',
        scrollingDown,
        atTop,
        focused: self.focused,
        keyboardOpen,
        firstRun: self.firstRun,
        labelWidthPx: self.labelWidthPx,
        windowWidthPx,
    });
}
