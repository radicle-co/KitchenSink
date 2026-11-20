import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TWO_COLUMN } from '../cookingLayout.js';
import { useIsTwoColumn } from '../useIsTwoColumn.js';

/** A `matchMedia` that answers one width and lets a test change it, as a resize does. */
function stubMatchMedia(widthEm: number) {
    let width = widthEm;
    const listeners = new Set<() => void>();
    const matchMedia = vi.fn((query: string) => ({
        get matches() {
            return query === TWO_COLUMN.webQuery && width >= TWO_COLUMN.minEm;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));

    vi.stubGlobal('matchMedia', matchMedia);

    return {
        matchMedia,
        resizeTo: (next: number) => {
            width = next;
            listeners.forEach((listener) => listener());
        },
        listenerCount: () => listeners.size,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/** The wide-screen band on web: asked of the browser in em, followed live, and narrow on the server. */
describe('useIsTwoColumn', () => {
    it('asks the browser the 50 em query and reports its answer', () => {
        const media = stubMatchMedia(50);
        const { result } = renderHook(() => useIsTwoColumn());

        expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 50em)');
        expect(result.current).toBe(true);
    });

    it('is false under 50 em', () => {
        stubMatchMedia(49.9);

        expect(renderHook(() => useIsTwoColumn()).result.current).toBe(false);
    });

    it('follows a resize across the band both ways', () => {
        const media = stubMatchMedia(30);
        const { result } = renderHook(() => useIsTwoColumn());

        act(() => media.resizeTo(60));
        expect(result.current).toBe(true);
        act(() => media.resizeTo(30));
        expect(result.current).toBe(false);
    });

    it('stops listening when it unmounts', () => {
        const media = stubMatchMedia(30);
        const { unmount } = renderHook(() => useIsTwoColumn());

        expect(media.listenerCount()).toBe(1);
        unmount();
        expect(media.listenerCount()).toBe(0);
    });

    it('reads narrow on the server render even where the window is wide', () => {
        stubMatchMedia(80);
        const Probe = () => <p>{useIsTwoColumn() ? 'wide' : 'narrow'}</p>;

        expect(renderToString(<Probe />)).toContain('narrow');
    });

    it('is false where there is no matchMedia', () => {
        vi.stubGlobal('matchMedia', undefined);

        expect(renderHook(() => useIsTwoColumn()).result.current).toBe(false);
    });
});
