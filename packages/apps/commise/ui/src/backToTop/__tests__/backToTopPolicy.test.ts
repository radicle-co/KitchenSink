/**
 * When web's "Back to top" shows (buildSpec §3.6, NN/g 2017): a page taller than 4 viewports, the reader more than 4
 * viewports down, and the last scroll upward; never with the keyboard open.
 */
import { describe, expect, it } from 'vitest';

import { BACK_TO_TOP_VIEWPORTS, showsBackToTop, type BackToTopInputs } from '../backToTopPolicy.js';

const BASE: BackToTopInputs = { pageViewports: 10, viewportsDown: 5, scrollingUp: true, keyboardOpen: false };

describe('showsBackToTop', () => {
    const cases: readonly (readonly [string, Partial<BackToTopInputs>, boolean])[] = [
        ['a long page, far down, scrolling up', {}, true],
        ['scrolling down hides it', { scrollingUp: false }, false],
        ['exactly four screens down is not yet past four', { viewportsDown: 4 }, false],
        ['a quarter past four screens shows it', { viewportsDown: 4.25 }, true],
        ['a page of exactly four screens never shows it', { pageViewports: 4, viewportsDown: 4.25 }, false],
        ['the keyboard hides it', { keyboardOpen: true }, false],
    ];

    it.each(cases)('%s', (_name, inputs, expected) => {
        expect(showsBackToTop({ ...BASE, ...inputs })).toBe(expected);
    });

    it('waits for four viewports (NN/g)', () => {
        expect(BACK_TO_TOP_VIEWPORTS).toBe(4);
    });
});
