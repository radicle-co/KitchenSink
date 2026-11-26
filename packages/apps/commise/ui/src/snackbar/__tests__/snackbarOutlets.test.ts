import { describe, expect, it } from 'vitest';

import { NO_OUTLETS, registerOutlet, topEntry, topOutlet, unregisterOutlet } from '../snackbarOutlets.js';

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

/**
 * One rule for two stacks: the page's chrome entries carry a reader beside the token and depth, and the same rule picks
 * the top of them. The rule returns the whole entry, so the reader comes with it.
 */
describe('the top rule over entries that carry more than a token and a depth', () => {
    const read = (bottom: number) => () => ({ top: 0, bottom });
    const page = { token: 'page', depth: 1, read: read(64) };
    const editor = { token: 'editor', depth: 2, read: read(8) };

    it('returns the whole top entry, so its reader comes with it', () => {
        expect(topEntry([page, editor])).toBe(editor);
    });

    it('puts the deeper entry on top even when it registered first', () => {
        expect(topEntry([editor, page])).toBe(editor);
    });

    it('has no top while the stack is empty', () => {
        expect(topEntry(NO_OUTLETS)).toBeUndefined();
    });

    it('keeps the entry type through register and unregister', () => {
        const stack = registerOutlet(registerOutlet([], page), editor);

        expect(unregisterOutlet(stack, 'editor')).toEqual([page]);
        expect(topEntry(registerOutlet([], page))?.read().bottom).toBe(64);
    });
});
