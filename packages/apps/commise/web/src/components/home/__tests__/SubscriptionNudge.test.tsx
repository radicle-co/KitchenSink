// @vitest-environment jsdom
/**
 * Component tests for the subscription upgrade nudge (web; FR-046), converted to Radix `Dialog` per
 * B6/CR-003 — mirrors the W5 `PullUpdatesDialog` pattern, INCLUDING its explicit focus-capture/restore: the
 * nudge is triggered from a premium-gated widget's own control (a sibling elsewhere in the tree, reached
 * through `useHomeNudge()`, never an owned `Dialog.Trigger`), so Radix's own default `onCloseAutoFocus`
 * would restore focus nowhere (see `PullUpdatesDialog`'s module doc). Covers: closed (nothing rendered),
 * open (accessible dialog named by the title), dismiss/upgrade both fire `onDismiss`, Escape closes AND
 * fires `onDismiss` AND returns focus to the sibling opener, and focus is trapped while open.
 *
 * Plus `useOncePerSessionNudge`'s own lifecycle, which is where "at most once per session" actually lives.
 * `HomeWidgetSurface.test` drives the seam end-to-end through a gated widget; the block at the foot of this
 * file pins each of the hook's three states and the transition out of it, including the two the end-to-end
 * case cannot reach — a repeat trigger while the nudge is already showing, and a dismiss that arrives before
 * anything triggered. The mobile mirror is `mobile/tests/components/home/SubscriptionNudge.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { SubscriptionNudge, useOncePerSessionNudge } from '../SubscriptionNudge.js';

afterEach(cleanup);

describe('SubscriptionNudge (web) — closed', () => {
    it('renders nothing while closed', () => {
        render(<SubscriptionNudge open={false} onDismiss={() => undefined} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('SubscriptionNudge (web) — open', () => {
    it('renders an accessible dialog named by the nudge title, with its body copy', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(screen.getByRole('dialog', { name: 'Unlock Commise Pro' })).toBeTruthy();
        expect(screen.getByText('Upgrade to Commise Pro to use this feature.')).toBeTruthy();
    });

    it('the dismiss action fires onDismiss', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        await user.click(screen.getByRole('button', { name: 'Maybe later' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('the upgrade action fires onDismiss (010 not yet shipped — wired as a distinct action already)', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        await user.click(screen.getByRole('button', { name: 'See plans' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('reserves the device safe-area inset below the bottom-sheet content, preserving its base padding (U5)', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        // This sheet is pinned to the bottom edge, so its foot must clear the device home indicator. The
        // bottom padding is `2rem` (the sheet's `p-8` foot) PLUS the safe-area inset, so with `env(...)` = 0
        // the base padding equals the foot and only real devices see the extra inset. The two must stay in
        // lockstep — the literal `2rem` here and the `p-8` utility are the same length spelled two ways.
        const dialog = screen.getByRole('dialog', { name: 'Unlock Commise Pro' });
        expect(dialog.className).toContain('pb-[calc(2rem+env(safe-area-inset-bottom))]');
    });
});

describe('SubscriptionNudge (web) — Radix a11y machinery (B6/CR-003)', () => {
    it('Escape fires onDismiss and returns focus to the sibling trigger that opened it', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Gated feature
                    </button>
                    <SubscriptionNudge
                        open={open}
                        onDismiss={() => {
                            onDismiss();
                            setOpen(false);
                        }}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Gated feature' }));

        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();

        // Radix's FocusScope restores focus via an unmount-cleanup `setTimeout(0)` — a real macrotask.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Gated feature' }));
    });

    it('traps focus inside the dialog while open (Tab cannot reach a sibling control)', async () => {
        const user = userEvent.setup();

        render(
            <>
                <SubscriptionNudge open onDismiss={() => undefined} />
                <button type="button">Outside sibling</button>
            </>,
        );

        // Radix marks everything outside the dialog `aria-hidden` while trapped, so the sibling is
        // intentionally unreachable through `getByRole` — look it up by text instead.
        const outside = screen.getByText('Outside sibling');

        for (let index = 0; index < 6; index += 1) {
            await user.tab();
            expect(document.activeElement).not.toBe(outside);
        }
    });
});

/**
 * `useOncePerSessionNudge` — every state of the FR-046 lifecycle, one at a time. `HomeWidgetSurface.test`
 * already drives the whole seam end-to-end through a gated widget; this pins the three states the hook can
 * be in and the transition out of each, INCLUDING the two the end-to-end case cannot reach: a repeat trigger
 * while the nudge is already showing, and a dismiss that arrives before anything ever triggered.
 */
describe('useOncePerSessionNudge (web)', () => {
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
