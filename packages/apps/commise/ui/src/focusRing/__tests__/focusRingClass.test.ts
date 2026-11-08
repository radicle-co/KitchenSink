/**
 * The ONE focus-ring recipe (`componentFixes.md` §10). The gap between a control and its ring is the colour of the
 * surface the control sits on, read from the inherited `--cm-surface` with the canvas as the fallback; a floating
 * control (no single surface) takes a two-tone ring instead (§10a, WCAG 2.4.11 and 2.4.13).
 *
 * Mutation lens: restore `ring-offset-canvas` in `offset`, or drop the fallback, and a test below fails.
 */
import { describe, expect, it } from 'vitest';

import { kebab } from '../../tokens/emit.js';
import { SURFACE_TONES, SURFACE_VAR } from '../../surfaceTone/surfaceTone.js';
import { FOCUS_RING_CLASS } from '../focusRingClass.js';

const tokens = (classes: string): readonly string[] => classes.split(/\s+/u);

describe('FOCUS_RING_CLASS', () => {
    it('has the five recipes and no more', () => {
        expect(Object.keys(FOCUS_RING_CLASS).sort()).toEqual(['floating', 'inset', 'inverse', 'offset', 'within']);
    });

    it('offset: a 2 px ring, 2 px off, the gap read from --cm-surface and falling back to the canvas', () => {
        expect(tokens(FOCUS_RING_CLASS.offset)).toEqual(
            expect.arrayContaining([
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-focus-ring',
                'focus-visible:ring-offset-2',
                `focus-visible:ring-offset-(${SURFACE_VAR},var(--color-${kebab(SURFACE_TONES.canvas.fill)}))`,
            ]),
        );
    });

    it('within: the same ring behind has-[:focus-visible]', () => {
        expect(tokens(FOCUS_RING_CLASS.within)).toEqual(
            expect.arrayContaining([
                'has-[:focus-visible]:ring-2',
                'has-[:focus-visible]:ring-focus-ring',
                'has-[:focus-visible]:ring-offset-2',
                `has-[:focus-visible]:ring-offset-(${SURFACE_VAR},var(--color-${kebab(SURFACE_TONES.canvas.fill)}))`,
            ]),
        );
    });

    it('inset: an inside ring with no offset, so it needs no surface', () => {
        expect(FOCUS_RING_CLASS.inset).toContain('focus-visible:ring-inset');
        expect(FOCUS_RING_CLASS.inset).not.toContain('ring-offset');
    });

    it('floating: a 2 px paperOverlay inner band, then a 2 px focusRing outer ring, whatever is behind', () => {
        expect(tokens(FOCUS_RING_CLASS.floating)).toEqual(
            expect.arrayContaining([
                'focus-visible:ring-2',
                'focus-visible:ring-focus-ring',
                'focus-visible:ring-offset-2',
                `focus-visible:ring-offset-${kebab('paperOverlay')}`,
            ]),
        );
        expect(FOCUS_RING_CLASS.floating).not.toContain(SURFACE_VAR);
    });

    it('inverse: the inverse-action ring on an inverse surface (a snackbar), with no gap to colour', () => {
        expect(tokens(FOCUS_RING_CLASS.inverse)).toEqual(
            expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-inverse-action']),
        );
        expect(FOCUS_RING_CLASS.inverse).not.toContain('ring-offset');
    });

    it('never names the canvas as a fixed offset colour', () => {
        for (const classes of Object.values(FOCUS_RING_CLASS)) {
            expect(classes).not.toContain('ring-offset-canvas');
        }
    });
});
