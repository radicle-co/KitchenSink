/**
 * Component tests for the mobile subscription upgrade nudge (FR-046) and the once-per-session lifecycle hook
 * behind it. Rendered via react-native-web under jsdom (see `vitest.native.config.ts`).
 *
 * The web nudge has carried a component suite since it shipped; the native mirror had only the end-to-end
 * pass inside `HomeWidgetSurface.native.test.tsx`, so the leaf's own states — closed, open, and each of its
 * two dismissal paths — were never asserted on this platform. Covered here, alongside every state of
 * `useOncePerSessionNudge`: armed, showing (including a repeat trigger that must not advance it), and spent.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionNudge, useOncePerSessionNudge } from '../../../src/components/home/SubscriptionNudge.js';

afterEach(cleanup);

describe('SubscriptionNudge (mobile) — closed', () => {
    it('renders none of the nudge copy while closed', () => {
        render(<SubscriptionNudge open={false} onDismiss={() => undefined} />);

        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

describe('SubscriptionNudge (mobile) — open', () => {
    it('renders the sheet with its heading and body copy', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(screen.getByText('Unlock Commise Pro')).toBeTruthy();
        expect(screen.getByText('Upgrade to Commise Pro to use this feature.')).toBeTruthy();
    });

    it('the dismiss action fires onDismiss', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByText('Maybe later'));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('the upgrade action also fires onDismiss (010 owns the real destination)', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByText('See plans'));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

/**
 * `useOncePerSessionNudge` — every state of the FR-046 lifecycle, one at a time, mirroring the web suite
 * exactly. The two platforms' hooks are verbatim twins, so a divergence here IS the drift.
 */
describe('useOncePerSessionNudge (mobile)', () => {
    it('starts armed and invisible', () => {
        const { result } = renderHook(() => useOncePerSessionNudge());

        expect(result.current.visible).toBe(false);
    });

    it('the first trigger shows it', () => {
        const { result } = renderHook(() => useOncePerSessionNudge());

        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);
    });

    it('a repeat trigger while it is already showing keeps it showing and does not spend it', () => {
        const { result } = renderHook(() => useOncePerSessionNudge());

        act(() => result.current.trigger());
        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);

        // Still exactly ONE dismissal away from spent — the repeat did not advance the lifecycle.
        act(() => result.current.dismiss());
        expect(result.current.visible).toBe(false);
    });

    it('dismissing hides it WITHOUT re-arming: every later trigger is a no-op for the session', () => {
        const { result } = renderHook(() => useOncePerSessionNudge());

        act(() => result.current.trigger());
        act(() => result.current.dismiss());
        expect(result.current.visible).toBe(false);

        act(() => result.current.trigger());
        expect(result.current.visible).toBe(false);
    });

    it('a dismiss before anything triggered does not spend the nudge', () => {
        const { result } = renderHook(() => useOncePerSessionNudge());

        act(() => result.current.dismiss());
        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);
    });
});
