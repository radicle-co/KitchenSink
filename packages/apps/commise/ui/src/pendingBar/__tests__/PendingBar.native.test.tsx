import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PENDING_BAR_DELAY_MS } from '../pendingDelay.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PendingBar } from '../PendingBar.native.js';

/**
 * PendingBar (native) — rendered via react-native-web under jsdom. React Native has no CSS delay, so the leaf owns a
 * timer; the assertions are on what is rendered at each moment of it, with fake timers.
 */
beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** The bar element, or `null` when nothing is rendered. */
const bar = (container: HTMLElement): Element | null => container.firstElementChild;

describe('PendingBar (native)', () => {
    it('renders nothing while nothing is pending', () => {
        const { container } = render(<PendingBar pending={false} />);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS * 2);
        });

        expect(bar(container)).toBeNull();
    });

    it('renders nothing before the delay, and the bar once it has passed', () => {
        const { container } = render(<PendingBar pending />);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS - 1);
        });
        expect(bar(container)).toBeNull();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(bar(container)).not.toBeNull();
    });

    it('⛔ takes the bar down when the pending work settles, and restarts the full delay for the next one', () => {
        const { container, rerender } = render(<PendingBar pending />);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS);
        });
        expect(bar(container)).not.toBeNull();

        rerender(<PendingBar pending={false} />);
        expect(bar(container)).toBeNull();

        // A second pending search is a new wait: a bar left "already shown" would flash on every fast search.
        rerender(<PendingBar pending />);
        expect(bar(container)).toBeNull();

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS);
        });
        expect(bar(container)).not.toBeNull();
    });

    it('never shows a bar for pending work that settled inside the delay', () => {
        const { container, rerender } = render(<PendingBar pending />);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS - 100);
        });
        rerender(<PendingBar pending={false} />);
        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS);
        });

        expect(bar(container)).toBeNull();
    });

    it('is hidden from assistive tech on both device platforms and on the web build', () => {
        const { container } = render(<PendingBar pending />);

        act(() => {
            vi.advanceTimersByTime(PENDING_BAR_DELAY_MS);
        });

        expect(bar(container)?.getAttribute('aria-hidden')).toBe('true');
    });
});
