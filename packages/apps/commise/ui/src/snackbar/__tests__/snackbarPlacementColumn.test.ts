import { describe, expect, it, vi } from 'vitest';

import { createSnackbarPlacement } from '../snackbarPlacement.js';

/**
 * Where the snackbar sits ACROSS the viewport (issue 508): over the page's content column, which the registered
 * entries may state through an optional `column` reader, apart from the vertical chrome pick. The horizontal pick reuses
 * the outlets' ranking (deepest, latest among equals) over the entries that HAVE a column reader, so a nested provider
 * with none (the editor inside the shell) keeps the shell's column. A column change alone still notifies. Written before
 * the change.
 */
const entry = (token: string, depth: number, bottom: number, column?: { left: number; right: number }) => ({
    token,
    depth,
    read: vi.fn(() => ({ top: 0, bottom })),
    ...(column === undefined ? {} : { column: vi.fn(() => column) }),
});

describe('snackbar placement, across the viewport', () => {
    it('spans the whole viewport when no entry states a column', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('page', 1, 64));

        expect(placement.getLeft()).toBe(0);
        expect(placement.getRight()).toBe(0);
    });

    it('sits in the column an entry states', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('shell', 1, 0, { left: 256, right: 0 }));

        expect(placement.getLeft()).toBe(256);
        expect(placement.getRight()).toBe(0);
    });

    it('keeps the shell column when a deeper provider states none, and takes its bottom chrome', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('shell', 1, 0, { left: 256, right: 0 }));
        placement.register(entry('editor', 2, 72));

        expect(placement.getLeft()).toBe(256);
        expect(placement.getBottom()).toBe(88);
    });

    it('follows the deepest entry that states a column, the latest among equals', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('shell', 1, 0, { left: 256, right: 0 }));
        placement.register(entry('panel', 2, 0, { left: 256, right: 320 }));

        expect(placement.getRight()).toBe(320);
    });

    it('goes back to the whole viewport when the column unmounts', () => {
        const placement = createSnackbarPlacement();
        const withdraw = placement.register(entry('shell', 1, 0, { left: 256, right: 0 }));

        withdraw();

        expect(placement.getLeft()).toBe(0);
    });

    it('notifies when only the column changes, as a sidebar collapse does with the bottom unchanged', () => {
        const placement = createSnackbarPlacement();
        let column = { left: 256, right: 0 };
        let tell: () => void = () => undefined;
        const listener = vi.fn();

        placement.register({
            token: 'shell',
            depth: 1,
            read: () => ({ top: 0, bottom: 0 }),
            column: () => column,
            watch: (onChange) => {
                tell = onChange;

                return () => undefined;
            },
        });
        placement.subscribe(listener);
        column = { left: 72, right: 0 };
        tell();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(placement.getLeft()).toBe(72);
    });

    it('reads the column only when it re-places, never in getLeft or getRight', () => {
        const placement = createSnackbarPlacement();
        const shell = entry('shell', 1, 0, { left: 256, right: 0 });

        placement.register(shell);
        shell.column?.mockClear();
        placement.getLeft();
        placement.getRight();

        expect(shell.column).not.toHaveBeenCalled();
    });
});
