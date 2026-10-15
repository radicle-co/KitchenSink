import { describe, expect, it } from 'vitest';

import { BUTTON_DIMMED_OPACITY } from '../props.js';

describe('BUTTON_DIMMED_OPACITY', () => {
    // The design system's "40%" for a locked or unavailable control (§1.10). Every native control that dims reads it,
    // so a change here moves them all together; this pin is what makes that change a decision.
    it('is 40%', () => {
        expect(BUTTON_DIMMED_OPACITY).toBe(0.4);
    });
});
