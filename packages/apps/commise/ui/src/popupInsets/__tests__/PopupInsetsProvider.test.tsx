import { cleanup, render } from '@testing-library/react';
import { useContext, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSnackbarPlacement } from '../../snackbar/snackbarPlacement.js';
import { PopupInsetsContext } from '../popupInsetsContext.js';
import { PopupInsetsProvider } from '../PopupInsetsProvider.js';
import { PopupInsetsRegistryContext, type PopupInsetsEntry, type PopupInsetsRegistry } from '../popupInsetsRegistry.js';

/**
 * `PopupInsetsProvider`: the page's chrome reader goes DOWN to the popups through `PopupInsetsContext`, and UP to the
 * snackbar host through the registry, as an entry with a token, the provider's depth and the reader. A provider inside
 * another is one deeper, and it withdraws its entry when it unmounts. With no registry above it, it only provides.
 */
afterEach(cleanup);

function fakeRegistry(): { readonly registry: PopupInsetsRegistry; readonly live: PopupInsetsEntry[] } {
    const live: PopupInsetsEntry[] = [];
    const registry: PopupInsetsRegistry = {
        register: vi.fn((entry: PopupInsetsEntry) => {
            live.push(entry);

            return () => {
                live.splice(live.indexOf(entry), 1);
            };
        }),
    };

    return { registry, live };
}

const reader = (bottom: number) => () => ({ top: 0, bottom });

const ReadsInsets: FC<{ readonly seen: (bottom: number) => void }> = ({ seen }) => {
    seen(useContext(PopupInsetsContext)().bottom);

    return null;
};

describe('PopupInsetsProvider', () => {
    it('provides its reader to the popups below it, as the context did', () => {
        const seen = vi.fn();

        render(
            <PopupInsetsProvider reader={reader(64)}>
                <ReadsInsets seen={seen} />
            </PopupInsetsProvider>,
        );

        expect(seen).toHaveBeenCalledWith(64);
    });

    it('registers one entry upward, with a token, depth 1 and the reader, and withdraws it on unmount', () => {
        const { registry, live } = fakeRegistry();
        const read = reader(64);
        const { unmount } = render(
            <PopupInsetsRegistryContext value={registry}>
                <PopupInsetsProvider reader={read}>
                    <span />
                </PopupInsetsProvider>
            </PopupInsetsRegistryContext>,
        );

        expect(live).toHaveLength(1);
        expect(live[0]?.depth).toBe(1);
        expect(live[0]?.read).toBe(read);
        expect(live[0]?.token).not.toBe('');

        unmount();

        expect(live).toHaveLength(0);
    });

    it('is one deeper inside another provider, with its own token', () => {
        const { registry, live } = fakeRegistry();

        render(
            <PopupInsetsRegistryContext value={registry}>
                <PopupInsetsProvider reader={reader(64)}>
                    <PopupInsetsProvider reader={reader(8)}>
                        <span />
                    </PopupInsetsProvider>
                </PopupInsetsProvider>
            </PopupInsetsRegistryContext>,
        );

        const entries = [...live].sort((a, b) => a.depth - b.depth);

        expect(entries.map((entry) => entry.depth)).toEqual([1, 2]);
        expect(new Set(entries.map((entry) => entry.token)).size).toBe(2);
    });

    it('with no registry above it, only provides', () => {
        const seen = vi.fn();

        expect(() =>
            render(
                <PopupInsetsProvider reader={reader(12)}>
                    <ReadsInsets seen={seen} />
                </PopupInsetsProvider>,
            ),
        ).not.toThrow();
        expect(seen).toHaveBeenCalledWith(12);
    });

    it('passes the watch upward in its entry, and re-registers when the watch changes', () => {
        const { registry, live } = fakeRegistry();
        const first = vi.fn(() => vi.fn());
        const second = vi.fn(() => vi.fn());
        const page = (watch: () => () => void) => (
            <PopupInsetsRegistryContext value={registry}>
                <PopupInsetsProvider reader={reader(64)} watch={watch}>
                    <span />
                </PopupInsetsProvider>
            </PopupInsetsRegistryContext>
        );
        const { rerender } = render(page(first));

        // Kills: a provider that drops the watch on the way up, so the store never hears of a resize.
        expect(live[0]?.watch).toBe(first);

        rerender(page(second));

        expect(live).toHaveLength(1);
        expect(live[0]?.watch).toBe(second);
        expect(registry.register).toHaveBeenCalledTimes(2);
    });

    it('stops the old watch once on a new watch, and the last on unmount, through the real store', () => {
        const placement = createSnackbarPlacement();
        const stopFirst = vi.fn();
        const stopSecond = vi.fn();
        const first = vi.fn(() => stopFirst);
        const second = vi.fn(() => stopSecond);
        const page = (watch: () => () => void) => (
            <PopupInsetsRegistryContext value={placement}>
                <PopupInsetsProvider reader={reader(64)} watch={watch}>
                    <span />
                </PopupInsetsProvider>
            </PopupInsetsRegistryContext>
        );
        const { rerender, unmount } = render(page(first));

        rerender(page(second));

        // Kills: a withdrawal that skips the cleanup, so a replaced watch keeps listening.
        expect(stopFirst).toHaveBeenCalledOnce();
        expect(stopSecond).not.toHaveBeenCalled();

        unmount();

        expect(stopSecond).toHaveBeenCalledOnce();
    });
});
