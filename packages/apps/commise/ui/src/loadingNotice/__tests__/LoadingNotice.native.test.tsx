/**
 * Component tests for the native `LoadingNotice` (react-native-web under jsdom): the contract mobile's `LoadingState`
 * held — ONE named progressbar, a visible caption, a hidden spinner — plus the busy state and the 400 ms hold.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo, Animated } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { role } from '../../tokens/colors.js';
import { LoadingNotice } from '../LoadingNotice.native.js';

/** `#RRGGBB` as the `rgb(r, g, b)` string a resolved computed style reports. */
const rgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
};

beforeEach(() => {
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(undefined as never);
    vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('LoadingNotice (native)', () => {
    it('exposes ONE progressbar named by the contextual label', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        expect(screen.getAllByRole('progressbar')).toHaveLength(1);
        expect(screen.getByRole('progressbar', { name: 'Loading recipe…' })).toBeTruthy();
    });

    it('shows the label as a visible caption in inkMuted', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        expect(getComputedStyle(screen.getByText('Loading recipe…')).color).toBe(rgb(role.inkMuted));
    });

    it('hides the decorative spinner from assistive tech so the state is announced once', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        const spinners = screen.getAllByRole('progressbar', { hidden: true });

        expect(spinners.length).toBeGreaterThan(1);
        expect(spinners.some((node) => node.closest('[aria-hidden="true"]') !== null)).toBe(true);
    });

    it('states that it is busy', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        expect(screen.getByRole('progressbar', { name: 'Loading recipe…' }).getAttribute('aria-busy')).toBe('true');
    });

    it('⛔ is not a live region: a loading state is not a must-hear message', () => {
        const { container } = render(<LoadingNotice label="Loading recipe…" />);

        expect(container.querySelector('[aria-live]')).toBeNull();
    });

    it('shows at once under reduced motion, with no delay and no rise', async () => {
        render(<LoadingNotice label="Loading recipe…" />);

        await act(async () => {
            await Promise.resolve();
        });

        const entering = screen.getByRole('progressbar', { name: 'Loading recipe…' }).parentElement as HTMLElement;

        expect(entering.style.opacity).toBe('1');
    });

    // react-native-web completes a JS-driven `Animated` within one jsdom frame, so the hold is asserted on the timing
    // CONFIG the leaf builds (the same reason `EnterTransition`'s own stagger test does).
    it('holds 400 ms before it enters when motion is allowed', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const timing = vi.spyOn(Animated, 'timing');
        render(<LoadingNotice label="Loading recipe…" />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(timing).toHaveBeenCalledTimes(1);
        expect(timing.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ delay: 400 }));
    });

    it('creates no animation at all under reduced motion', async () => {
        const timing = vi.spyOn(Animated, 'timing');
        render(<LoadingNotice label="Loading recipe…" />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(timing).not.toHaveBeenCalled();
    });
});
