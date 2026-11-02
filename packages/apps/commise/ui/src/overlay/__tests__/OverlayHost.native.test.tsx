/**
 * OverlayHost (native) — the one door every dismiss route of a window overlay goes through.
 *
 * ⚠️ The real Modal is wrapped to record its props, because react-native-web's Modal does not raise
 * `onRequestClose` from a test (spike S3): the recorded prop is what the device calls on Android Back. The
 * on-device order is `.maestro/shell/overlayBackOrder.yaml` and `overlaySwipeDismiss.yaml`.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, useEffect, type ComponentProps, type FC } from 'react';
import { Pressable, Text, type Modal as ModalType, type NativeSyntheticEvent } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackInterceptProvider } from '../../backIntercept/BackInterceptProvider.native.js';
import { useBackIntercept } from '../../backIntercept/useBackIntercept.native.js';
import { installHardwareBackHandler } from '../../testing/hardwareBack.native.js';
import { DISMISS_ROUTES, type DismissRoute } from '../dismissRoute.js';
import { OverlayHost } from '../OverlayHost.native.js';
import { useOverlayDismiss } from '../overlayDismissContext.native.js';

const state = vi.hoisted(() => ({ modals: [] as ComponentProps<typeof ModalType>[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modals.push(props);

            return createElement(actual.Modal, props);
        },
    };
});

afterEach(() => {
    cleanup();
    state.modals = [];
});

/** The event React Native hands `onRequestClose`; the host ignores its content. */
// Lacks only `target` and `currentTarget` (native element handles no test can make); the host reads neither.
const CLOSE_EVENT = {
    nativeEvent: undefined,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: true,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    persist: () => undefined,
    timeStamp: 0,
    type: 'requestClose',
} as NativeSyntheticEvent<unknown>;

/** The `onRequestClose` of the last-rendered Modal (what Android Back calls; the innermost when nested). */
function hostBack(): void {
    const latest = state.modals.at(-1);

    act(() => latest?.onRequestClose?.(CLOSE_EVENT));
}

/** A child that fires one dismiss route from inside the window. */
const Dismisser: FC<{ readonly route: DismissRoute }> = ({ route }) => {
    const dismiss = useOverlayDismiss();

    return (
        <Pressable onPress={() => dismiss(route)}>
            <Text>{route}</Text>
        </Pressable>
    );
};

/** A child that vetoes Back through the window's scope. */
const Veto: FC<{ readonly handler: () => boolean }> = ({ handler }) => {
    useBackIntercept(handler);

    return null;
};

describe('OverlayHost (native)', () => {
    it('turns Android Back into one back request when nothing intercepts', () => {
        const onDismissRequest = vi.fn();
        render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Text>Body</Text>
            </OverlayHost>,
        );

        hostBack();

        expect(onDismissRequest).toHaveBeenCalledTimes(1);
        expect(onDismissRequest).toHaveBeenCalledWith('back');
    });

    it('passes the other Modal props through and renders its children', () => {
        render(
            <OverlayHost visible transparent animationType="slide" onDismissRequest={vi.fn()}>
                <Text>Body</Text>
            </OverlayHost>,
        );

        expect(screen.getByText('Body')).toBeTruthy();
        expect(state.modals[0]?.transparent).toBe(true);
        expect(state.modals[0]?.animationType).toBe('slide');
    });

    it('routes every dismiss route a child raises to the same sink with its own label', () => {
        const onDismissRequest = vi.fn();
        render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                {DISMISS_ROUTES.map((route) => (
                    <Dismisser key={route} route={route} />
                ))}
            </OverlayHost>,
        );

        for (const route of DISMISS_ROUTES) {
            act(() => screen.getByText(route).click());
        }

        expect(onDismissRequest.mock.calls.map(([route]) => route)).toEqual([...DISMISS_ROUTES]);
    });

    it('lets an interceptor registered inside the window answer Back before the host', () => {
        const onDismissRequest = vi.fn();
        const handler = vi.fn(() => true);
        render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Veto handler={handler} />
            </OverlayHost>,
        );

        hostBack();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(onDismissRequest).not.toHaveBeenCalled();
    });

    it('requests the dismissal when the in-window interceptor declines', () => {
        const onDismissRequest = vi.fn();
        render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Veto handler={() => false} />
            </OverlayHost>,
        );

        hostBack();

        expect(onDismissRequest).toHaveBeenCalledWith('back');
    });

    it('adds no BackHandler subscription and leaves the ancestor provider untouched', () => {
        const hardware = installHardwareBackHandler();
        const onUnhandled = vi.fn(() => true);
        const handler = vi.fn(() => true);

        try {
            render(
                <BackInterceptProvider onUnhandled={onUnhandled}>
                    <OverlayHost visible onDismissRequest={vi.fn()}>
                        <Veto handler={handler} />
                    </OverlayHost>
                </BackInterceptProvider>,
            );

            expect(hardware.subscribeCount()).toBe(1);
            expect(hardware.subscriberCount()).toBe(1);

            // A hardware press (the page behind the window) never reaches the window's interceptor.
            hardware.press();

            expect(handler).not.toHaveBeenCalled();
            expect(onUnhandled).toHaveBeenCalledTimes(1);
        } finally {
            hardware.restore();
        }
    });

    it('keeps the content rendered when the host vetoes the request by leaving open', () => {
        const onDismissRequest = vi.fn(); // ignores the request: a veto
        render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Text>Body</Text>
            </OverlayHost>,
        );

        hostBack();

        expect(onDismissRequest).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Body')).toBeTruthy();
    });

    it('answers Back with the LATEST onDismissRequest, not the first render’s', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(
            <OverlayHost visible onDismissRequest={first}>
                <Text>Body</Text>
            </OverlayHost>,
        );

        rerender(
            <OverlayHost visible onDismissRequest={second}>
                <Text>Body</Text>
            </OverlayHost>,
        );
        hostBack();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('scopes nested hosts: the inner Back reaches only the inner request', () => {
        const outer = vi.fn();
        const inner = vi.fn();
        render(
            <OverlayHost visible onDismissRequest={outer}>
                <OverlayHost visible onDismissRequest={inner}>
                    <Text>Inner</Text>
                </OverlayHost>
            </OverlayHost>,
        );

        // The innermost Modal renders last.
        hostBack();

        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
    });

    it('throws a loud error when useOverlayDismiss is used outside a host', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<Dismisser route="close" />)).toThrow(/OverlayHost/);

        spy.mockRestore();
    });

    it('drops an in-window interceptor with the host, leaking nothing', () => {
        const handler = vi.fn(() => true);

        const Probe: FC = () => {
            useEffect(() => undefined, []);

            return <Veto handler={handler} />;
        };

        const onDismissRequest = vi.fn();
        const { rerender } = render(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Probe />
            </OverlayHost>,
        );

        rerender(
            <OverlayHost visible onDismissRequest={onDismissRequest}>
                <Text>Body</Text>
            </OverlayHost>,
        );
        hostBack();

        expect(handler).not.toHaveBeenCalled();
        expect(onDismissRequest).toHaveBeenCalledWith('back');
    });
});
