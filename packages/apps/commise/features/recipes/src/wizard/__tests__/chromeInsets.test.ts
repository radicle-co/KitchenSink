/**
 * `chromeInsetsOf` — how much of the viewport the wizard's own chrome covers, for its popups to keep clear of
 * (`docs/design/rowEditorOpenDecisions.md` V3-1): the band's bottom edge, or 0 for a band out of view; the viewport's
 * height less the bar's top edge, or 0 for a bar that is not fixed to the viewport.
 */
import { describe, expect, it } from 'vitest';

import { chromeInsetsOf } from '../chromeInsets.js';

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
