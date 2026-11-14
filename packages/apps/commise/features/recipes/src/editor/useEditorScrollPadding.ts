'use client';

/**
 * @module @commise/features-recipes/editor — the web editor's scroll padding (E4; WCAG 2.2 SC 2.4.11, build spec
 * §7.10). The header, the section bar and the action bar are drawn over the page, so the browser scrolled a focused
 * control (Tab, Shift+Tab) right under them. The document's `scroll-padding` keeps it clear.
 *
 * The shell's own bottom padding is keyed on the tab bar, which a focused task drops, so the editor sets both edges
 * itself and puts the document back when it goes. Both edges read the chrome as it is laid out (the section bar sits under
 * the header only below 960 px, and a width that hides it measures 0; the foot is the window less the action bar's top
 * while the bar holds it). They are read from the page when the hook applies, never from the bar's height as a LATER
 * commit measured it: a deep link's jump runs in the commit the editor mounts, and a foot that waited for that
 * measurement was `auto` while the jump read it, which put Done and Cancel under the bar. The bar's measured height
 * (which grows with the fix line and a parked-write notice) and the header's (which grows when it wraps) only say WHEN
 * to read again.
 *
 * The top edge is the HEIGHTS of the sticky top boxes, summed, not where their bottom edges sit: before the section bar
 * has stuck its bottom edge includes the gutter above it, and a header scrolled up is somewhere else, so a position read
 * made a jump's clearance depend on the scroll it began from.
 *
 * @pattern Adapter over the document element's `scroll-padding` — a layout effect that applies and restores it
 */
import { useLayoutEffect } from 'react';

import { readChromeInsets, scrollPaddingOf, topChromeClearanceOf } from './chromeInsets.js';
import { EDITOR_ACTION_BAR_ID, EDITOR_TOP_CHROME_IDS } from './frameProps.js';

/**
 * The height of each sticky top box that is mounted, as laid out now; a box the width hides is 0.
 *
 * @returns The heights, in CSS px, the header first.
 * @sideEffect Reads layout: one bounding rect per box.
 */
const topChromeHeights = (): number[] =>
    EDITOR_TOP_CHROME_IDS.flatMap((id) => {
        const node = document.getElementById(id);

        return node === null ? [] : [node.getBoundingClientRect().height];
    });

/**
 * Keep the document's scroll padding on the editor's sticky chrome while the editor is mounted.
 *
 * @param measured - Whether the action bar holds the viewport's foot, its last measured height, and the header's: a change
 *     of any reads the page again. The padding itself comes from the layout.
 * @sideEffect Sets `scroll-padding-top` and `scroll-padding-bottom` on the document element, re-reads them when the
 *     window resizes, and clears both on unmount.
 */
export function useEditorScrollPadding(measured: {
    readonly pinned: boolean;
    readonly height: number;
    readonly topHeight: number;
}): void {
    const { pinned, height, topHeight } = measured;

    useLayoutEffect(() => {
        const root = document.documentElement;

        const apply = (): void => {
            const insets = readChromeInsets(EDITOR_TOP_CHROME_IDS, EDITOR_ACTION_BAR_ID);
            const padding = scrollPaddingOf({
                topClearance: topChromeClearanceOf(topChromeHeights()),
                barPinned: insets.bottom > 0,
                barHeight: insets.bottom,
            });

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
    }, [pinned, height, topHeight]);
}
