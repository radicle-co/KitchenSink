/**
 * `chromeInsetsOf` — how much of the viewport the wizard's own chrome covers, for its popups to keep clear of
 * (`docs/design/rowEditorOpenDecisions.md` V3-1): the band's bottom edge, or 0 for a band out of view; the viewport's
 * height less the bar's top edge, or 0 for a bar that is not fixed to the viewport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    chromeInsetsOf,
    focusHiddenByChrome,
    focusHiddenByGrownChrome,
    FOCUS_CLEARANCE_PX,
    readChromeInsets,
    scrollPaddingOf,
    topChromeClearanceOf,
} from '../chromeInsets.js';

describe('chromeInsetsOf', () => {
    it.each([
        {
            name: 'a band stuck to the top and a bar fixed to the foot (below `lg`)',
            edges: { bandBottom: 64, barTop: 782, viewportHeight: 844 },
            insets: { top: 64, bottom: 62 },
        },
        {
            name: 'a band lower in the page, not yet stuck',
            edges: { bandBottom: 185, barTop: 782, viewportHeight: 844 },
            insets: { top: 185, bottom: 62 },
        },
        {
            name: 'a band scrolled out of view above the viewport',
            edges: { bandBottom: -40, barTop: 782, viewportHeight: 844 },
            insets: { top: 0, bottom: 62 },
        },
        {
            name: 'a bar that is not fixed (at `lg`, inside the band)',
            edges: { bandBottom: 116, barTop: undefined, viewportHeight: 800 },
            insets: { top: 116, bottom: 0 },
        },
        {
            name: 'a bar below the visible viewport (a phone keyboard over it)',
            edges: { bandBottom: 64, barTop: 900, viewportHeight: 844 },
            insets: { top: 64, bottom: 0 },
        },
        {
            name: 'no band and no bar mounted yet',
            edges: { bandBottom: undefined, barTop: undefined, viewportHeight: 844 },
            insets: { top: 0, bottom: 0 },
        },
    ] as const)('$name', ({ edges, insets }) => {
        expect(chromeInsetsOf(edges)).toEqual(insets);
    });
});

/**
 * The top chrome is more than the header: below 960 px the section index's bar or strip sticks under it. A popup that
 * keeps clear of the header alone slides under that bar. The inset is the LOWEST bottom edge of every sticky top box;
 * a box the current width hides measures 0 and takes no part.
 */
describe('readChromeInsets', () => {
    const place = (id: string, rect: DOMRect): void => {
        const node = document.createElement('div');
        node.id = id;
        node.getBoundingClientRect = () => rect;
        document.body.append(node);
    };

    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it('keeps popups clear of the section bar stuck under the header', () => {
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(844);
        place('header', new DOMRect(0, 0, 390, 56));
        place('index-bar', new DOMRect(0, 56, 390, 44));
        // The strip, hidden at this width.
        place('index-strip', new DOMRect(0, 0, 0, 0));
        place('bar', new DOMRect(0, 772, 390, 72));

        expect(readChromeInsets(['header', 'index-bar', 'index-strip'], 'bar')).toEqual({ top: 100, bottom: 72 });
    });

    it('reads the header alone when no index box is mounted', () => {
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
        place('header', new DOMRect(0, 0, 1280, 56));

        expect(readChromeInsets(['header', 'index-bar', 'index-strip'], 'bar')).toEqual({ top: 56, bottom: 0 });
    });
});

/**
 * E4 (WCAG 2.2 SC 2.4.11; build spec §7.10): the browser scrolls a focused control into view, and the sticky header,
 * the section bar and the action bar are drawn over the page, so the scroll must stop short of them.
 */
describe('scrollPaddingOf', () => {
    it('clears the top chrome, and a pinned bar plus the clearance', () => {
        expect(scrollPaddingOf({ topClearance: 100, barPinned: true, barHeight: 72 })).toEqual({
            top: 100,
            bottom: 72 + FOCUS_CLEARANCE_PX,
        });
    });

    it('asks nothing for a bar that scrolls with the page: it is in the flow, not over it', () => {
        expect(scrollPaddingOf({ topClearance: 100, barPinned: false, barHeight: 72 })).toEqual({
            top: 100,
            bottom: 0,
        });
    });

    it('asks nothing before the chrome is measured', () => {
        expect(scrollPaddingOf({ topClearance: 0, barPinned: true, barHeight: 0 })).toEqual({ top: 0, bottom: 0 });
    });

    it('never asks for a negative top (a band scrolled out of view)', () => {
        expect(scrollPaddingOf({ topClearance: -40, barPinned: true, barHeight: 72 }).top).toBe(0);
    });
});

/**
 * The clearance the document's scroll padding asks of the top: the HEIGHT of every box stuck at the top, summed, so it is
 * the same at every scroll position (a box's bottom edge is not, before it has stuck).
 */
describe('topChromeClearanceOf', () => {
    it.each([
        { name: 'the header alone', heights: [56], clearance: 56 },
        { name: 'the header and the section bar', heights: [56, 44], clearance: 100 },
        { name: 'a box the width hides (height 0) takes no part', heights: [56, 0, 44], clearance: 100 },
        { name: 'nothing mounted yet', heights: [], clearance: 0 },
        { name: 'a negative height is no clearance', heights: [56, -10], clearance: 56 },
    ])('$name', ({ heights, clearance }) => {
        expect(topChromeClearanceOf(heights)).toBe(clearance);
    });
});

/**
 * A sticky header can GROW after a focus scroll has cleared it (the save status wraps at 200% text), and the document's new
 * scroll padding applies only to the NEXT scroll. The control focused under the old chrome is then under the new, and must be
 * brought back: only when the clearance grew and the control's top is now above the new chrome's bottom.
 */
describe('focusHiddenByGrownChrome', () => {
    it.each([
        { name: 'grew, and the control now sits under it', previous: 208, next: 257, focusTop: 208, hidden: true },
        { name: 'grew, and the control is still clear of it', previous: 208, next: 257, focusTop: 346, hidden: false },
        {
            name: 'grew, and the control sits exactly at the new edge',
            previous: 208,
            next: 257,
            focusTop: 257,
            hidden: false,
        },
        { name: 'shrank: nothing is newly covered', previous: 257, next: 208, focusTop: 100, hidden: false },
        { name: 'unchanged: the browser already honoured it', previous: 208, next: 208, focusTop: 100, hidden: false },
        {
            name: 'the first reading (nothing applied yet) never re-reveals',
            previous: 0,
            next: 208,
            focusTop: 100,
            hidden: false,
        },
    ])('$name', ({ previous, next, focusTop, hidden }) => {
        expect(focusHiddenByGrownChrome({ previous, next, focusTop })).toBe(hidden);
    });
});

/**
 * A control that takes focus under the sticky chrome (the header grew while a sheet was open, so the focus the sheet gives
 * back lands at the old edge): the browser does not scroll a partly covered element on focus, so it must be brought back.
 */
describe('focusHiddenByChrome', () => {
    it.each([
        { name: 'the control sits under the chrome', clearance: 257, focusTop: 208, hidden: true },
        { name: 'the control is clear of the chrome', clearance: 257, focusTop: 346, hidden: false },
        { name: 'the control sits exactly at the edge', clearance: 257, focusTop: 257, hidden: false },
        { name: 'no chrome is measured yet', clearance: 0, focusTop: -20, hidden: false },
    ])('$name', ({ clearance, focusTop, hidden }) => {
        expect(focusHiddenByChrome({ clearance, focusTop })).toBe(hidden);
    });
});
