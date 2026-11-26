import { describe, expect, it, vi } from 'vitest';

import { createSnackbarPlacement } from '../snackbarPlacement.js';

/**
 * The snackbar's placement store: where the host draws the snackbar, as the CURRENT page's chrome says. The base is the
 * 16 px gap. The top entry is the deepest provider, the latest among equals, and the store re-places on register, on
 * unregister and on `place()` (called as a snackbar shows). It reads a reader only when it re-places, never in
 * `getBottom`, because a reader measures the page.
 */
const entry = (token: string, depth: number, bottom: number) => ({
    token,
    depth,
    read: vi.fn(() => ({ top: 0, bottom })),
});

describe('snackbar placement', () => {
    it('sits at the 16 px base when no page provides chrome', () => {
        expect(createSnackbarPlacement().getBottom()).toBe(16);
    });

    it('sits the gap above the page chrome that registers', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('page', 1, 64));

        expect(placement.getBottom()).toBe(80);
    });

    it('goes back to the base when the chrome unmounts', () => {
        const placement = createSnackbarPlacement();
        const withdraw = placement.register(entry('page', 1, 64));

        withdraw();

        expect(placement.getBottom()).toBe(16);
    });

    it('follows the deeper provider even though it registered first', () => {
        const placement = createSnackbarPlacement();

        placement.register(entry('inner', 2, 8));
        placement.register(entry('outer', 1, 64));

        expect(placement.getBottom()).toBe(24);
    });

    it('keeps the new page offset when the new page mounts before the old one unmounts', () => {
        const placement = createSnackbarPlacement();
        const oldPage = placement.register(entry('old', 1, 64));

        placement.register(entry('new', 1, 0));
        oldPage();

        expect(placement.getBottom()).toBe(16);
    });

    it('does not call a reader in getBottom, only when it re-places', () => {
        const placement = createSnackbarPlacement();
        const page = entry('page', 1, 64);

        placement.register(page);
        const callsAfterRegister = page.read.mock.calls.length;
        placement.getBottom();
        placement.getBottom();

        expect(page.read.mock.calls).toHaveLength(callsAfterRegister);

        placement.place();

        expect(page.read.mock.calls).toHaveLength(callsAfterRegister + 1);
    });

    it('re-reads the top reader on place(), so chrome that moved is followed when a snackbar shows', () => {
        const placement = createSnackbarPlacement();
        let bottom = 64;

        placement.register({ token: 'page', depth: 1, read: () => ({ top: 0, bottom }) });
        bottom = 120;
        placement.place();

        expect(placement.getBottom()).toBe(136);
    });

    it('tells subscribers only when the offset changes', () => {
        const placement = createSnackbarPlacement();
        const listener = vi.fn();

        placement.subscribe(listener);
        placement.register(entry('a', 1, 64));
        placement.register(entry('b', 1, 64));
        placement.place();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops telling a subscriber that unsubscribed', () => {
        const placement = createSnackbarPlacement();
        const listener = vi.fn();

        placement.subscribe(listener)();
        placement.register(entry('a', 1, 64));

        expect(listener).not.toHaveBeenCalled();
    });
});
