/**
 * The once-per-session nudge latch, once for both apps. It was byte-identical in `web/src/components/home` and
 * `mobile/src/components/home`, with the same seven cases pinned in `SubscriptionNudge.test.tsx` and
 * `SubscriptionNudge.native.test.tsx`; those blocks moved here (the sheet-rendering cases stay in each app).
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useOncePerSessionNudge } from '../useOncePerSessionNudge.js';

describe('useOncePerSessionNudge', () => {
    it('starts armed and invisible', () => {
        const { result } = renderHook(() => useOncePerSessionNudge(true));

        expect(result.current.visible).toBe(false);
    });

    it('the first trigger shows it', () => {
        const { result } = renderHook(() => useOncePerSessionNudge(true));

        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);
    });

    it('a repeat trigger while it is already showing keeps it showing and does not spend it', () => {
        const { result } = renderHook(() => useOncePerSessionNudge(true));

        act(() => result.current.trigger());
        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);

        // Still exactly ONE dismissal away from spent — the repeat did not advance the lifecycle.
        act(() => result.current.dismiss());
        expect(result.current.visible).toBe(false);
    });

    it('dismissing hides it WITHOUT re-arming: every later trigger is a no-op for the session', () => {
        const { result } = renderHook(() => useOncePerSessionNudge(true));

        act(() => result.current.trigger());
        act(() => result.current.dismiss());
        expect(result.current.visible).toBe(false);

        act(() => result.current.trigger());
        expect(result.current.visible).toBe(false);
    });

    // Plan 2026-10-14-009 D14: the nudge is an upsell, behind the paid-features gate.
    it('⛔ is never shown while not offered (granted or hidden), and a trigger then does not spend it', () => {
        const { result, rerender } = renderHook(({ offered }) => useOncePerSessionNudge(offered), {
            initialProps: { offered: false },
        });

        act(() => result.current.trigger());
        expect(result.current.visible).toBe(false);

        rerender({ offered: true });
        act(() => result.current.trigger());
        expect(result.current.visible).toBe(true);
    });

    it('hides a showing nudge the moment it stops being offered', () => {
        const { result, rerender } = renderHook(({ offered }) => useOncePerSessionNudge(offered), {
            initialProps: { offered: true },
        });

        act(() => result.current.trigger());
        rerender({ offered: false });

        expect(result.current.visible).toBe(false);
    });

    it('a dismiss before anything triggered does not spend the nudge', () => {
        const { result } = renderHook(() => useOncePerSessionNudge(true));

        act(() => result.current.dismiss());
        act(() => result.current.trigger());

        expect(result.current.visible).toBe(true);
    });
});
