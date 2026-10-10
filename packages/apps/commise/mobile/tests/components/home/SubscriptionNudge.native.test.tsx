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
import { dialogTitled } from '@commise/test-utils';

import { SubscriptionNudge } from '../../../src/components/home/SubscriptionNudge.js';
import { useOncePerSessionNudge } from '../../../src/components/home/useOncePerSessionNudge.js';

afterEach(cleanup);

describe('SubscriptionNudge (mobile) — closed', () => {
    it('renders none of the nudge copy while closed', () => {
        render(<SubscriptionNudge open={false} onDismiss={() => undefined} />);

        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

describe('SubscriptionNudge (mobile) — open', () => {
    // `docs/design/compactHeightLayout.md` §10 (A9): the nudge is the design system's `Sheet`, so it gains the width
    // cap, the insets, the scroll and every close route a phone held sideways needs. It was a hand-rolled bottom panel
    // that spanned the whole width under the side navigation bar.
    it('is the design-system sheet: a modal dialog named by its title', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(dialogTitled('Unlock Commise Pro').getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Unlock Commise Pro' })).toBeTruthy();
    });

    it('closes through its × control, named “Close upgrade offer”, exactly once', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByRole('button', { name: 'Close upgrade offer' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('closes through the platform back route (Escape under react-native-web), exactly once', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.keyUp(document, { key: 'Escape' });

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('offers both choices as full design-system buttons, the primary last', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        const later = screen.getByRole('button', { name: 'Maybe later' });
        const plans = screen.getByRole('button', { name: 'See plans' });

        expect(later.compareDocumentPosition(plans) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

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
