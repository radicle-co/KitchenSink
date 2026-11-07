import { describe, expect, it } from 'vitest';

import { FAB_SNACKBAR_GAP, fabLiftOver } from '../fabLift.js';

describe('fabLiftOver', () => {
    it('does not lift the button when no snackbar shows', () => {
        expect(fabLiftOver(0)).toBe(0);
    });

    it('lifts it by the snackbar height plus the 8 dp gap while one shows', () => {
        expect(FAB_SNACKBAR_GAP).toBe(8);
        expect(fabLiftOver(56)).toBe(64);
    });
});
