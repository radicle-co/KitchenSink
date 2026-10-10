/**
 * `BottomChromeFrame` and `useBottomEdge` (native): who owns a screen's bottom edge, and how far up from the window's
 * foot the screen's own content starts (M1, `docs/design/uiOverhaul/specShellAndLists.md` §S.3).
 *
 * The bottom tab bar now sits under the recipe list, whose create menu opens in a modal window and positions itself
 * from the window's foot. It assumed only the safe-area inset was below the list, so with a bar there the menu would
 * open ON the bar. The rule: whatever is bottom-most owns the inset. With no footer the frame pads the inset and
 * reports it; with a footer (which pads the inset itself) the frame adds nothing and reports the footer's MEASURED
 * height, because the bar's height depends on the text size.
 *
 * react-native-web reports layout through one `ResizeObserver` and each node's `offsetHeight`, neither of which jsdom
 * has, so the test records the observer and reports a height through it (the `PhotoCarousel.native.test.tsx` method).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STUB_INSETS } from '../../testing/safeAreaContext.native.js';
import { BottomChromeFrame, useBottomEdge } from '../BottomChromeFrame.native.js';

/** The insets this file serves: the shared stub's, unless a test turns the phone sideways. */
const insets = vi.hoisted(() => ({ left: 0, right: 0 }));

vi.mock('react-native-safe-area-context', async () => {
    const stub = await import('../../testing/safeAreaContext.native.js');

    return { ...stub, useSafeAreaInsets: () => ({ ...stub.STUB_INSETS, ...insets }) };
});

const observer = vi.hoisted(() => {
    const recorded = { callback: undefined as ResizeObserverCallback | undefined, observed: new Set<Element>() };

    globalThis.ResizeObserver = class {
        public constructor(callback: ResizeObserverCallback) {
            recorded.callback = callback;
        }

        public observe(target: Element): void {
            recorded.observed.add(target);
        }

        public unobserve(target: Element): void {
            recorded.observed.delete(target);
        }

        public disconnect(): void {
            recorded.observed.clear();
        }
    } as unknown as typeof ResizeObserver;

    return recorded;
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    insets.left = 0;
    insets.right = 0;
});

/** Reads the bottom edge the way the create menu does, and shows it. */
const EdgeProbe: FC = () => <Text>{`edge ${String(useBottomEdge())}`}</Text>;

/** Lay the footer out at `height`: the footer's box is the parent of the labelled bar. */
function layOutFooter(height: number): void {
    const box = screen.getByLabelText('Tab bar').parentElement;

    if (box === null) {
        throw new Error('no footer box');
    }

    Object.defineProperty(box, 'offsetHeight', { value: height, configurable: true });
    act(() => {
        observer.callback?.(
            [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
    });
    act(() => {
        vi.runOnlyPendingTimers();
    });
}

describe('BottomChromeFrame (native)', () => {
    it('with no footer, pads the safe-area inset and reports it as the bottom edge', () => {
        render(
            <BottomChromeFrame>
                <EdgeProbe />
            </BottomChromeFrame>,
        );

        expect(screen.getByText(`edge ${String(STUB_INSETS.bottom)}`)).toBeTruthy();
        expect(screen.getByText(/^edge/u).parentElement?.style.paddingBottom).toBe(`${String(STUB_INSETS.bottom)}px`);
    });

    it('with a footer, adds no padding of its own and reports the footer’s measured height', () => {
        render(
            <BottomChromeFrame footer={<View accessibilityLabel="Tab bar" />}>
                <EdgeProbe />
            </BottomChromeFrame>,
        );

        layOutFooter(72);

        expect(screen.getByText('edge 72')).toBeTruthy();
        expect(screen.getByText(/^edge/u).parentElement?.style.paddingBottom).toBe('0px');
    });

    it('keeps the footer clear of a side cutout or navigation bar on a phone held sideways', () => {
        insets.left = 59;
        insets.right = 48;
        render(
            <BottomChromeFrame footer={<View accessibilityLabel="Tab bar" />}>
                <EdgeProbe />
            </BottomChromeFrame>,
        );
        const box = screen.getByLabelText('Tab bar').parentElement;

        expect(box?.style.paddingLeft).toBe('59px');
        expect(box?.style.paddingRight).toBe('48px');
    });

    it('keeps the content the same node when the footer comes and goes', () => {
        const { rerender } = render(
            <BottomChromeFrame footer={<View accessibilityLabel="Tab bar" />}>
                <EdgeProbe />
            </BottomChromeFrame>,
        );
        const before = screen.getByText(/^edge/u);

        rerender(
            <BottomChromeFrame>
                <EdgeProbe />
            </BottomChromeFrame>,
        );

        expect(screen.getByText(/^edge/u)).toBe(before);
    });
});

describe('useBottomEdge (native)', () => {
    it('reports the safe-area inset when no frame is above it, so existing screens are unchanged', () => {
        render(<EdgeProbe />);

        expect(screen.getByText(`edge ${String(STUB_INSETS.bottom)}`)).toBeTruthy();
    });
});
