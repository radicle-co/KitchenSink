import { describe, expect, it } from 'vitest';

import { NO_OUTLETS, registerOutlet, topOutlet, unregisterOutlet } from '../snackbarOutlets.js';

/**
 * The snackbar outlet stack — the open windows that offer the host a place to draw. The host draws in the top one:
 * the deepest window, and among equally deep windows the one that registered last. It draws in its own place when none
 * is open.
 */
const sheet = { token: 'sheet', depth: 1 };
const dialog = { token: 'dialog', depth: 1 };
const inner = { token: 'inner', depth: 2 };

describe('snackbar outlet stack', () => {
    it('has no top while no window offers an outlet', () => {
        expect(topOutlet(NO_OUTLETS)).toBeUndefined();
    });

    it('puts the window that registered last on top, among windows equally deep', () => {
        expect(topOutlet(registerOutlet(registerOutlet(NO_OUTLETS, sheet), dialog))).toBe('dialog');
    });

    it('puts a window opened inside another on top, even when it registered first', () => {
        // React runs a child's effects before its parent's, so a window nested in a sheet that opens in the same render
        // registers before the sheet does.
        expect(topOutlet(registerOutlet(registerOutlet(NO_OUTLETS, inner), sheet))).toBe('inner');
    });

    it('keeps one entry for a window that registers twice', () => {
        const once = registerOutlet(NO_OUTLETS, sheet);

        expect(registerOutlet(once, sheet)).toBe(once);
    });

    it('removes a window below the top, and keeps the top', () => {
        const stack = registerOutlet(registerOutlet(NO_OUTLETS, sheet), dialog);
        const without = unregisterOutlet(stack, 'sheet');

        expect(topOutlet(without)).toBe('dialog');
        expect(topOutlet(unregisterOutlet(without, 'dialog'))).toBeUndefined();
    });

    it('hands the top back to the window below when the top closes', () => {
        const stack = registerOutlet(registerOutlet(NO_OUTLETS, sheet), inner);

        expect(topOutlet(unregisterOutlet(stack, 'inner'))).toBe('sheet');
    });

    it('changes nothing when a window that never registered unregisters', () => {
        const stack = registerOutlet(NO_OUTLETS, sheet);

        expect(unregisterOutlet(stack, 'dialog')).toBe(stack);
    });
});
