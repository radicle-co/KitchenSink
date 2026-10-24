'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's scroll padding (E4; WCAG 2.2 SC 2.4.11, build spec
 * §7.10). The header, the section bar and the action bar are drawn over the page, so the browser scrolled a focused
 * control (Tab, Shift+Tab) right under them. The document's `scroll-padding` keeps it clear.
 *
 * The shell's own bottom padding is keyed on the tab bar, which a focused task drops, so the editor sets both edges
 * itself and puts the document back when it goes. The top reads the chrome as it is laid out (the section bar sits under
 * the header only below 960 px, and a width that hides it measures 0); the foot reads the action bar's measured height,
 * which grows with the fix line and a parked-write notice.
 *
 * @pattern Adapter over the document element's `scroll-padding` — a layout effect that applies and restores it
 */
import { useLayoutEffect } from 'react';

import { readChromeInsets, scrollPaddingOf } from './chromeInsets.js';
import { EDITOR_ACTION_BAR_ID, EDITOR_TOP_CHROME_IDS } from './frameProps.js';

/**
 * Keep the document's scroll padding on the editor's sticky chrome while the editor is mounted.
 *
 * @param bar - Whether the action bar holds the viewport's foot, and its last measured height.
 * @sideEffect Sets `scroll-padding-top` and `scroll-padding-bottom` on the document element, re-reads them when the
 *     window resizes, and clears both on unmount.
 */
export function useEditorScrollPadding(bar: { readonly pinned: boolean; readonly height: number }): void {
    const { pinned, height } = bar;

    useLayoutEffect(() => {
        const root = document.documentElement;

        const apply = (): void => {
            const { top } = readChromeInsets(EDITOR_TOP_CHROME_IDS, EDITOR_ACTION_BAR_ID);
            const padding = scrollPaddingOf({ topBottom: top, barPinned: pinned, barHeight: height });

            root.style.scrollPaddingTop = padding.top > 0 ? `${String(padding.top)}px` : '';
            root.style.scrollPaddingBottom = padding.bottom > 0 ? `${String(padding.bottom)}px` : '';
        };

        apply();
        window.addEventListener('resize', apply);

        return () => {
            window.removeEventListener('resize', apply);
            root.style.scrollPaddingTop = '';
            root.style.scrollPaddingBottom = '';
        };
    }, [pinned, height]);
}
