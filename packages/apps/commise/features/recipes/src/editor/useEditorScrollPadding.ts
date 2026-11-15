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
 * A header that GROWS after the focus scroll placed a control at its old edge (the save status wraps after Done at 200% text)
 * would cover that control, because the new padding applies to the next scroll only; so when the clearance grows and the
 * focused control is now under it, and when a control takes focus under the chrome, the control is scrolled `nearest`, by the
 * padding in force.
 *
 * @pattern Adapter over the document element's `scroll-padding` — a layout effect that applies and restores it
 */
import { useLayoutEffect } from 'react';

import {
    focusHiddenByChrome,
    focusHiddenByGrownChrome,
    readChromeInsets,
    scrollPaddingOf,
    topChromeClearanceOf,
} from './chromeInsets.js';
import { EDITOR_ACTION_BAR_ID, EDITOR_HEADER_ID, EDITOR_TOP_CHROME_IDS } from './frameProps.js';

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
 * Whether a node is a control in the editor's body: inside the editor's `main`, and not in the sticky top chrome itself (a
 * sticky box is never scrolled under itself).
 *
 * @param node - The focused node, or any event target.
 * @returns `true` for an element in the body.
 */
function inEditorBody(node: EventTarget | Element | null): node is HTMLElement {
    return (
        node instanceof HTMLElement &&
        document.getElementById(EDITOR_HEADER_ID)?.closest('main')?.contains(node) === true &&
        !EDITOR_TOP_CHROME_IDS.some((id) => document.getElementById(id)?.contains(node) === true)
    );
}

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

            // The padding the last application set: what the browser's own focus scroll honoured.
            const previousTop = Number.parseFloat(root.style.scrollPaddingTop) || 0;

            root.style.scrollPaddingTop = padding.top > 0 ? `${String(padding.top)}px` : '';
            root.style.scrollPaddingBottom = padding.bottom > 0 ? `${String(padding.bottom)}px` : '';

            // A header that grew can cover the control the focus scroll placed at its old edge; bring that control back, by the
            // padding just set. Only a control inside the editor, and only when it is now under the chrome.
            const focused = document.activeElement;

            if (
                inEditorBody(focused) &&
                focusHiddenByGrownChrome({
                    previous: previousTop,
                    next: padding.top,
                    focusTop: focused.getBoundingClientRect().top,
                })
            ) {
                focused.scrollIntoView({ block: 'nearest' });
            }
        };

        // A control that takes focus under the chrome is brought back too: the sheet that closes hands focus to a row at the
        // chrome's old edge, and the browser does not scroll a partly covered element on focus.
        const onFocusIn = (event: FocusEvent): void => {
            const target = event.target;

            // One frame later: the sheet that handed focus back also puts the page's scroll position back as it closes, and that
            // would undo a scroll made now.
            window.requestAnimationFrame(() => {
                if (
                    inEditorBody(target) &&
                    document.activeElement === target &&
                    focusHiddenByChrome({
                        clearance: Number.parseFloat(root.style.scrollPaddingTop) || 0,
                        focusTop: target.getBoundingClientRect().top,
                    })
                ) {
                    target.scrollIntoView({ block: 'nearest' });
                }
            });
        };

        apply();
        window.addEventListener('resize', apply);
        document.addEventListener('focusin', onFocusIn);

        return () => {
            window.removeEventListener('resize', apply);
            document.removeEventListener('focusin', onFocusIn);
        };
    }, [pinned, height, topHeight]);

    // The document goes back only when the editor goes, not between two readings: the padding the last reading set is what
    // the next one compares with (a header that grew).
    useLayoutEffect(
        () => () => {
            document.documentElement.style.scrollPaddingTop = '';
            document.documentElement.style.scrollPaddingBottom = '';
        },
        [],
    );
}
