// @vitest-environment jsdom
/**
 * `useColorScheme` follows the browser's setting, live. It exists for Clerk, whose `variables` cannot read a CSS custom
 * property, so what matters is that it reports dark when the system is dark AND changes when the system changes.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useColorScheme } from '@/hooks/useColorScheme';

const realMatchMedia = window.matchMedia;

afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true, writable: true });
});

/** A controllable `matchMedia`. */
function controllable(initial: boolean) {
    let matches = initial;
    const listeners = new Set<() => void>();

    window.matchMedia = ((query: string) => ({
        get matches() {
            return matches;
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia;

    return {
        set: (next: boolean) => {
            matches = next;
            listeners.forEach((listener) => listener());
        },
        listeners,
    };
}

describe('useColorScheme', () => {
    it('is light when the system is light', () => {
        controllable(false);

        expect(renderHook(() => useColorScheme()).result.current).toBe('light');
    });

    it('is dark when the system is dark', () => {
        controllable(true);

        expect(renderHook(() => useColorScheme()).result.current).toBe('dark');
    });

    it('follows the system while mounted', () => {
        const media = controllable(false);
        const { result } = renderHook(() => useColorScheme());

        act(() => media.set(true));
        expect(result.current).toBe('dark');

        act(() => media.set(false));
        expect(result.current).toBe('light');
    });

    it('stops listening on unmount', () => {
        const media = controllable(false);
        const { unmount } = renderHook(() => useColorScheme());

        expect(media.listeners.size).toBe(1);

        unmount();

        expect(media.listeners.size).toBe(0);
    });

    it('is light where there is no matchMedia', () => {
        // An embedded view with no `matchMedia`.
        Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true });

        expect(renderHook(() => useColorScheme()).result.current).toBe('light');
    });
});
