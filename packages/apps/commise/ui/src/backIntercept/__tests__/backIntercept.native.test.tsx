/**
 * Component tests for the hardware-back seam's React half — {@link BackInterceptProvider} (the ONE platform
 * subscription) and {@link useBackIntercept} (one link in the chain).
 *
 * `react-native` is aliased to `react-native-web` here, whose `BackHandler.addEventListener` is an inert stub
 * that logs and returns a no-op subscription. So the subscription is spied and driven directly: the suite
 * models RN's real semantics — subscriptions invoked last-registered-first, the first `true` consuming the
 * event — and asserts what the provider does with them.
 *
 * ⛔ THE TEST THAT MATTERS MOST is "the registered handler sees the LATEST closure". The naive fix for this
 * whole defect registers the interceptor once at mount, capturing `isDirty === false` forever — a guard that
 * is green on every clean form and silently discards every dirty one. Nothing else in this file would catch
 * that.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState, type FC, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { installHardwareBackHandler, type HardwareBackHandle } from '../../testing/hardwareBack.native.js';
import { BackInterceptProvider } from '../BackInterceptProvider.native.js';
import { useBackIntercept } from '../useBackIntercept.native.js';

/** Installed per test; restored here because the helper replaces the method rather than spying. */
let back: HardwareBackHandle;

afterEach(() => {
    cleanup();
    back.restore();
    vi.restoreAllMocks();
});

const Host: FC<{ readonly onUnhandled: () => boolean; readonly children?: ReactNode }> = ({
    onUnhandled,
    children,
}) => <BackInterceptProvider onUnhandled={onUnhandled}>{children}</BackInterceptProvider>;

describe('BackInterceptProvider — the single platform subscription', () => {
    it('registers exactly ONE hardwareBackPress subscription', () => {
        back = installHardwareBackHandler();

        render(<Host onUnhandled={() => false} />);

        expect(back.subscriberCount()).toBe(1);
    });

    it('does NOT re-subscribe when its onUnhandled prop identity changes across renders', () => {
        // The ordering invariant. A provider that re-registered on every render would land AFTER the
        // surfaces it hosts in RN's LIFO list and answer their presses for them — the defect, restored.
        back = installHardwareBackHandler();
        const { rerender } = render(<Host onUnhandled={() => false} />);

        rerender(<Host onUnhandled={() => false} />);
        rerender(<Host onUnhandled={() => false} />);

        expect(back.subscriberCount()).toBe(1);
        expect(back.subscribeCount()).toBe(1);
    });

    it('calls the LATEST onUnhandled, not the one captured at mount', () => {
        back = installHardwareBackHandler();
        const atMount = vi.fn(() => false);
        const latest = vi.fn(() => true);
        const { rerender } = render(<Host onUnhandled={atMount} />);

        rerender(<Host onUnhandled={latest} />);

        expect(back.press()).toBe(true);
        expect(latest).toHaveBeenCalledTimes(1);
        expect(atMount).not.toHaveBeenCalled();
    });

    it('removes its subscription on unmount', () => {
        back = installHardwareBackHandler();
        const { unmount } = render(<Host onUnhandled={() => false} />);

        unmount();

        expect(back.subscriberCount()).toBe(0);
    });

    it('declines the press when nothing intercepted it and onUnhandled declines too', () => {
        // The listener's `false` is what lets RN apply its own default (leave the app) at the root.
        back = installHardwareBackHandler();
        render(<Host onUnhandled={() => false} />);

        expect(back.press()).toBe(false);
    });

    it('survives a StrictMode mount/cleanup/mount with exactly one subscription', () => {
        back = installHardwareBackHandler();

        render(
            <StrictMode>
                <Host onUnhandled={() => false} />
            </StrictMode>,
        );

        expect(back.subscriberCount()).toBe(1);
    });
});

describe('useBackIntercept — one link in the chain', () => {
    const Surface: FC<{ readonly handler: () => boolean }> = ({ handler }) => {
        useBackIntercept(handler);

        return <Text>surface</Text>;
    };

    it('⛔ throws when used outside a provider — a data-loss guard must never be silently absent', () => {
        // Rendering it into a Null Object default would mean the NEXT screen that composes the editor
        // somewhere new silently reintroduces the very defect this seam exists to fix.
        expect(() => render(<Surface handler={() => true} />)).toThrow(/BackInterceptProvider/);
    });

    it('is offered the press BEFORE the host default, and suppresses it when it consumes', () => {
        back = installHardwareBackHandler();
        const onUnhandled = vi.fn(() => true);
        render(
            <Host onUnhandled={onUnhandled}>
                <Surface handler={() => true} />
            </Host>,
        );

        expect(back.press()).toBe(true);
        expect(onUnhandled).not.toHaveBeenCalled();
    });

    it('falls through to the host default when it declines', () => {
        back = installHardwareBackHandler();
        const onUnhandled = vi.fn(() => true);
        render(
            <Host onUnhandled={onUnhandled}>
                <Surface handler={() => false} />
            </Host>,
        );

        expect(back.press()).toBe(true);
        expect(onUnhandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ the registered handler sees the LATEST render closure, not the one captured at mount', () => {
        // THE STALE-CLOSURE GUARD. `requestCancel` closes over `isDirty`; a handler frozen at mount reports
        // "clean" forever and discards the cook's work behind a green suite that only pressed back on a
        // clean form. The counter below stands in for that state.
        back = installHardwareBackHandler();
        const seen: number[] = [];

        const Counting: FC = () => {
            const [count, setCount] = useState(0);
            useBackIntercept(() => {
                seen.push(count);

                return true;
            });

            return (
                <Pressable accessibilityRole="button" accessibilityLabel="bump" onPress={() => setCount(count + 1)}>
                    <Text>{count}</Text>
                </Pressable>
            );
        };

        render(
            <Host onUnhandled={() => false}>
                <Counting />
            </Host>,
        );

        fireEvent.click(screen.getByLabelText('bump'));
        fireEvent.click(screen.getByLabelText('bump'));
        back.press();

        expect(seen).toEqual([2]);
    });

    it('unregisters on ITS unmount while the provider subscription survives', () => {
        back = installHardwareBackHandler();
        const onUnhandled = vi.fn(() => true);
        const intercept = vi.fn(() => true);

        const { rerender } = render(
            <Host onUnhandled={onUnhandled}>
                <Surface handler={intercept} />
            </Host>,
        );

        rerender(<Host onUnhandled={onUnhandled} />);

        expect(back.subscriberCount()).toBe(1);
        expect(back.press()).toBe(true);
        expect(intercept).not.toHaveBeenCalled();
        expect(onUnhandled).toHaveBeenCalledTimes(1);
    });

    it('offers the press to the most recently mounted surface first', () => {
        back = installHardwareBackHandler();
        const asked: string[] = [];

        render(
            <Host onUnhandled={() => false}>
                <Surface
                    handler={() => {
                        asked.push('outer');

                        return true;
                    }}
                />
                <Surface
                    handler={() => {
                        asked.push('inner');

                        return true;
                    }}
                />
            </Host>,
        );

        back.press();

        expect(asked).toEqual(['inner']);
    });
});
