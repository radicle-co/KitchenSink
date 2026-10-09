'use client';

/**
 * @module @commise/ui/create-fab — the floating create control's presentation on web: `createFabPolicy` over the
 * page's scroll, the keyboard, the window and the control's own state. The interim create dial reads it too, so the
 * rules live once.
 */
import { viewportClassOf } from '../layout/containerClass.js';
import { useContext } from 'react';

import { ScrollHostContext } from '../scrollHost/scrollHostContext.js';
import { useKeyboardOpen } from '../screenEnvironment/useKeyboardOpen.js';
import { useWindowWidth } from '../screenEnvironment/useWindowWidth.js';
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
    const viewportClass = viewportClassOf(windowWidthPx);

    return fabPresentationOf({
        viewportClass,
        // From 840 the sidebar holds "New recipe": the control's `nav:hidden` removes it there in CSS, before the width
        // is known and identically on the server, so the policy is not asked for the sidebar case on web.
        chrome: 'tabBar',
        scrollingDown,
        atTop,
        focused: self.focused,
        keyboardOpen,
        firstRun: self.firstRun,
        // An unmeasured label (0) or an unknown window (0, before hydration) keeps the label, as the server drew it.
        labelWidthPx: windowWidthPx === 0 ? 0 : self.labelWidthPx,
        windowWidthPx,
    });
}
