/**
 * `chromeInsetsOf` — how much of the viewport the wizard's own chrome covers, for its popups to keep clear of
 * (`docs/design/rowEditorOpenDecisions.md` V3-1): the band's bottom edge, or 0 for a band out of view; the viewport's
 * height less the bar's top edge, or 0 for a bar that is not fixed to the viewport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chromeInsetsOf, readChromeInsets } from '../chromeInsets.js';

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
