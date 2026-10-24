/**
 * `AuthScreenFrame` — the shell the three signed-out screens (sign-in, sign-up, the social finish step) share: safe
 * area, keyboard avoidance, a scroll that keeps a tap on a control working while the keyboard is up, and the footer
 * (the error line and the primary) that the keyboard must never hide (`docs/design/uiOverhaul/buildSpec.md` §8.1).
 *
 * What is pinned, and why each is a real failure rather than taste:
 *
 * - The children render INSIDE the shell, so a screen that forgot the frame would lose all of this at once.
 * - The content padding is the design system's own spacing, because the beach-glow canvas behind it shows through and
 *   the three screens must hold the same margins.
 * - The root is TRANSPARENT: an opaque fill occludes the root `AppCanvas` gradient (issue #145).
 * - The footer has TWO fixed slots (§8.1): in the flow, straight after the fields, while the keyboard is down; pinned
 *   under the scroll, above the keyboard, while it is up, unless the footer is taller than half the frame, when it goes
 *   back into the flow. The decision reads the footer's and the frame's real heights, which react-native-web reports
 *   through a `ResizeObserver` jsdom does not have: this file serves the heights itself, so the WIRING (which node
 *   reports which height) is under test, not only the pure rule (`ui/src/layout/__tests__/pinnedFooter.test.ts`).
 * - One footer style in both slots, or a footer taller in one slot than the other flips back and forth near the limit.
 *
 * ⚠️ The on-device proof is the Maestro sign-in flow, which taps Sign in with the keyboard up.
 */
import { resizeObserver as observer } from '@commise/ui/testing/resize-observer';
import { nativeTokens } from '@commise/ui/native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps, type JSX } from 'react';
import { Text, type ScrollView as ScrollViewType } from 'react-native';
import { Input } from '@commise/ui/input';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthScreenFrame } from '../../src/components/auth/AuthScreenFrame.js';

const state = vi.hoisted(() => ({
    keyboardShown: false,
    // What the frame's reveal host was asked, and the host itself, recorded from its latest render.
    requests: [] as { readonly kind: string; readonly field: unknown }[],
    // A space the host is made to ask for, to see where the frame puts it.
    spacer: false,
}));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useKeyboardShown: () => state.keyboardShown,
}));
vi.mock('@commise/ui/field-reveal', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/field-reveal')>();

    return {
        ...actual,
        useFieldRevealHost: (scroller: Parameters<typeof actual.useFieldRevealHost>[0]) => {
            const host = actual.useFieldRevealHost(scroller);

            return {
                ...host,
                revealer: (request: Parameters<typeof host.revealer>[0]) => {
                    state.requests.push(request);

                    return host.revealer(request);
                },
                spacer: state.spacer ? { height: 10, onLayout: () => undefined } : host.spacer,
            };
        },
    };
});
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        // The real ScrollView, its element marked, so "scrolls with the content" is "sits inside the scroll region".
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement(
                'div',
                { 'data-scroll-region': true, 'data-dismiss-mode': props.keyboardDismissMode },
                createElement(actual.ScrollView, props),
            ),
    };
});

beforeEach(() => {
    vi.useFakeTimers();
    state.keyboardShown = false;
    state.requests = [];
    state.spacer = false;
    observer.observed.clear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const GO = { name: 'Go' } as const;

function frame(extra: { readonly footer?: JSX.Element } = {}): JSX.Element {
    return (
        <AuthScreenFrame
            footer={extra.footer ?? <Text accessibilityRole="button">Go</Text>}
            trailing={<Text>Switch</Text>}
        >
            <Text>Fields</Text>
        </AuthScreenFrame>
    );
}

const scrollRegion = (): Element => document.querySelector('[data-scroll-region]') as Element;
/** The view that holds the footer, which reports the footer's height. */
const footerView = (): HTMLElement => screen.getByRole('button', GO).parentElement as HTMLElement;
/** The view that holds the scroll region and the pinned footer, which reports the frame's height. */
const frameView = (): HTMLElement => scrollRegion().parentElement as HTMLElement;
const inScroll = (node: HTMLElement): boolean => scrollRegion().contains(node);

/** Report layout: give the frame and the footer their heights, then fire the observer for every node it watches. */
function layOut(heights: { readonly frame: number; readonly footer: number }): void {
    for (const [node, height] of [
        [frameView(), heights.frame],
        [footerView(), heights.footer],
    ] as const) {
        Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
    }

    act(() => {
        observer.callback?.(
            [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
    });
    // react-native-web measures the node in a deferred task.
    act(() => {
        vi.runOnlyPendingTimers();
    });
}

describe('AuthScreenFrame — the shell', () => {
    it('renders its children inside the shell', () => {
        render(frame());

        expect(screen.getByText('Fields')).toBeTruthy();
    });

    it('pads the content with the design system spacing', () => {
        render(frame());

        const content = window.getComputedStyle(screen.getByText('Fields').parentElement as HTMLElement);

        expect(content.paddingLeft).toBe(`${nativeTokens.spacing[5]}px`);
        expect(content.paddingTop).toBe(`${nativeTokens.spacing[6]}px`);
    });

    it('is transparent, so the AppCanvas gradient behind it shows through', () => {
        const { container } = render(frame());

        const root = container.firstElementChild as HTMLElement;

        expect(window.getComputedStyle(root).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/u);
    });

    it('closes the keyboard when the scroll is dragged, and keeps a control tap working', () => {
        render(frame());

        expect(scrollRegion().getAttribute('data-dismiss-mode')).toBe('on-drag');
    });
});

describe('AuthScreenFrame — the footer, keyboard down', () => {
    it('sits in the flow straight after the fields and before the trailing link', () => {
        render(frame());

        const go = screen.getByRole('button', GO);

        expect(inScroll(go)).toBe(true);
        expect(screen.getByText('Fields').compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(go.compareDocumentPosition(screen.getByText('Switch')) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('stays in the flow however small it measures against the frame', () => {
        render(frame());
        layOut({ frame: 800, footer: 76 });

        expect(inScroll(screen.getByRole('button', GO))).toBe(true);
    });
});

describe('AuthScreenFrame — the footer, keyboard up', () => {
    beforeEach(() => {
        state.keyboardShown = true;
    });

    // The rule answers "pinned" for an unmeasured footer (as the Sheet's does); the footer is measured from wherever it
    // is placed, so the first layout report then judges it.
    it('is pinned before anything is measured, and judged once it reports', () => {
        render(frame());
        expect(inScroll(screen.getByRole('button', GO))).toBe(false);

        layOut({ frame: 288, footer: 200 });

        expect(inScroll(screen.getByRole('button', GO))).toBe(true);
    });

    it('is pinned under the scroll while it takes half the frame or less', () => {
        render(frame());
        layOut({ frame: 288, footer: 144 });

        const go = screen.getByRole('button', GO);

        expect(inScroll(go)).toBe(false);
        expect(scrollRegion().compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('goes back into the flow once the footer is taller than half the frame', () => {
        render(frame());
        layOut({ frame: 288, footer: 145 });

        expect(inScroll(screen.getByRole('button', GO))).toBe(true);
    });

    it('keeps the trailing link in the scroll, out of the footer', () => {
        render(frame());
        layOut({ frame: 288, footer: 76 });

        expect(inScroll(screen.getByText('Switch'))).toBe(true);
        expect(inScroll(screen.getByRole('button', GO))).toBe(false);
    });

    it('pins it again when a taller frame reports the same footer', () => {
        render(frame());
        layOut({ frame: 288, footer: 200 });
        expect(inScroll(screen.getByRole('button', GO))).toBe(true);

        layOut({ frame: 600, footer: 200 });

        expect(inScroll(screen.getByRole('button', GO))).toBe(false);
    });

    it('gives the footer the same padding in either slot', () => {
        render(frame());
        const inFlow = window.getComputedStyle(footerView());
        const flow = { top: inFlow.paddingTop, bottom: inFlow.paddingBottom };

        layOut({ frame: 288, footer: 76 });
        const pinned = window.getComputedStyle(footerView());

        expect(flow.top).toBe(`${nativeTokens.spacing[3]}px`);
        expect({ top: pinned.paddingTop, bottom: pinned.paddingBottom }).toEqual(flow);
    });
});

describe('AuthScreenFrame — the keyboard closes', () => {
    it('moves a pinned footer back into the flow', () => {
        state.keyboardShown = true;
        const { rerender } = render(frame());
        layOut({ frame: 288, footer: 76 });
        expect(inScroll(screen.getByRole('button', GO))).toBe(false);

        state.keyboardShown = false;
        act(() => rerender(frame()));

        expect(inScroll(screen.getByRole('button', GO))).toBe(true);
    });
});

// §16.3 and build spec §8.1: a field in the frame holds its place above the keyboard and the pinned footer, because the
// frame owns a scroll host and the reveal host over its one scroller. The ScrollView ends where the pinned footer
// begins, so the footer is outside the visible area by construction and the host never has to know about it.
describe('AuthScreenFrame — the field reveal', () => {
    const withField = (): JSX.Element => (
        <AuthScreenFrame footer={<Text accessibilityRole="button">Go</Text>} trailing={<Text>Switch</Text>}>
            <Input id="password" label="Password" value="" onChangeText={vi.fn()} />
        </AuthScreenFrame>
    );

    const kinds = (): string[] => state.requests.map((request) => request.kind);

    it('hands a focused field to a real reveal host, not the Null Object', () => {
        render(withField());

        fireEvent.focus(screen.getByLabelText('Password'));

        expect(kinds()).toEqual(['focus']);
        expect(state.requests[0]?.field).toBe(screen.getByLabelText('Password'));
    });

    it('lays the reveal space out as the scroll`s last child, after the trailing link', () => {
        state.spacer = true;
        render(withField());

        const content = screen.getByText('Switch').parentElement as HTMLElement;
        const spacer = content.lastElementChild as HTMLElement;

        expect(spacer.getAttribute('aria-hidden')).toBe('true');
        expect(window.getComputedStyle(spacer).height).toBe('10px');
        expect(screen.getByText('Switch').compareDocumentPosition(spacer) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('measures against the scroll, which ends where the pinned footer begins: the footer is never counted', async () => {
        state.keyboardShown = true;
        render(withField());
        layOut({ frame: 600, footer: 76 });

        // The scroll is 300 dp tall (the frame less the pinned footer and the rest of the chrome); its scroll offset is
        // recorded, because the reveal's scroll is a write to it.
        const scroll = scrollRegion().firstElementChild as HTMLElement;
        const written: number[] = [];
        Object.defineProperty(scroll, 'offsetHeight', { value: 300, configurable: true });
        Object.defineProperty(scroll, 'scrollTop', { configurable: true, get: () => 0 });
        // react-native-web scrolls through `scroll({ top })`.
        Object.defineProperty(scroll, 'scroll', {
            configurable: true,
            value: ({ top }: { readonly top: number }) => {
                written.push(top);
            },
        });
        act(() => {
            observer.callback?.([{ target: scroll } as unknown as ResizeObserverEntry], {} as ResizeObserver);
        });
        act(() => {
            vi.runOnlyPendingTimers();
        });

        // The field's bottom is 328 dp down the scroll: below its 300 dp, and 8 dp more is kept under it.
        const field = screen.getByLabelText('Password') as HTMLElement & { measureLayout?: unknown };

        field.measureLayout = (_to: unknown, onSuccess: (x: number, y: number, w: number, h: number) => void) => {
            onSuccess(0, 280, 300, 48);
        };

        await act(async () => {
            fireEvent.focus(field);
            await Promise.resolve();
        });

        expect(written).toEqual([36]);
    });
});
