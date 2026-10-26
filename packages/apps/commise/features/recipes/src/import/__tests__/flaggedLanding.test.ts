/**
 * Unit tests for `flaggedLanding.ts`: where focus lands on a flagged row when its Try again is pressed (WCAG 2.4.3).
 * The row's Use is the control the retry made busy; a row the check offered no food for has no Use, so focus lands on
 * Choose another, which always exists.
 */
import { describe, expect, it } from 'vitest';

import { flaggedLandingOf } from '../flaggedLanding.js';

describe('flaggedLandingOf', () => {
    it('lands on Use when the check offered a food', () => {
        expect(flaggedLandingOf({ suggestion: { foodId: 'f-whole', name: 'Whole milk' } })).toBe('use');
    });

    it('lands on Choose another when the row has no Use', () => {
        expect(flaggedLandingOf({})).toBe('chooseAnother');
    });
});
