/**
 * Sheet (native) and the snackbar's foot (designer D78, P60): inside a sheet with a footer the snackbar sits one
 * gap above the footer's top, so it never covers Done or Clear ticks, whether the footer is pinned or has scrolled into
 * the content. With no footer it keeps the window foot (the bottom inset and the gap). A centred dialog's footer is not at the window
 * foot, so it keeps the window foot too.
 *
 * The footer's height comes from the footer's own `onLayout`, which react-native-web reports through a
 * `ResizeObserver` that jsdom lacks, so this file serves the heights itself (as `SheetFooterPinning.native.test.tsx`
 * does). It proves the WIRING: which height the outlet's offset is built from. Where it paints is a device frame.
 */
import { resizeObserver as observer } from '../../testing/resizeObserver.js';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { SnackbarHost } from '../../snackbar/SnackbarHost.native.js';
import { SNACKBAR_GAP } from '../../snackbar/props.js';
import { useSnackbar } from '../../snackbar/useSnackbar.js';
import { render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';

const INSET = 16;

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: INSET, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
    cleanup();
    observer.observed.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function Shower(): JSX.Element {
    const { show } = useSnackbar();

    return (
        <Pressable accessibilityRole="button" onPress={() => show({ message: 'Ticks cleared' })}>
            <Text>show</Text>
        </Pressable>
    );
}

function renderSheet(overrides: Partial<SheetProps> = {}): void {
    render(
        <SnackbarHost>
            <Sheet
                open
                onOpenChange={vi.fn()}
                title="Ingredients"
                closeLabel="Close ingredients"
                size="content"
                footer={<Text accessibilityRole="button">Clear ticks</Text>}
                {...overrides}
            >
                <Shower />
            </Sheet>
        </SnackbarHost>,
    );
}

const dialog = (): HTMLElement =>
    screen.getByRole('heading', { name: 'Ingredients' }).closest('[role="dialog"]') as HTMLElement;
const topBlock = (): HTMLElement =>
    screen.getByRole('button', { name: 'Close ingredients' }).parentElement?.parentElement
        ?.parentElement as HTMLElement;
const footerOf = (): HTMLElement => screen.getByRole('button', { name: 'Clear ticks' }).parentElement as HTMLElement;

function layOut(heights: { readonly sheet: number; readonly topBlock: number; readonly footer: number }): void {
    for (const [node, height] of [
        [dialog(), heights.sheet],
        [topBlock(), heights.topBlock],
        [footerOf(), heights.footer],
    ] as const) {
        Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
    }

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

/** The snackbar's region, shown by the button, and its distance from the window's foot. */
function regionBottom(): string {
    fireEvent.click(screen.getByRole('button', { name: 'show' }));

    const region = screen
        .getAllByRole('status')
        .find((candidate) => candidate.textContent?.includes('Ticks cleared') === true);

    return resolvedStyle(region as HTMLElement, 'bottom');
}

describe('Sheet (native): where the snackbar sits inside it', () => {
    it('sits one gap above a pinned footer, never over it', () => {
        renderSheet();
        layOut({ sheet: 600, topBlock: 56, footer: 92 });

        expect(regionBottom()).toBe(`${92 + SNACKBAR_GAP}px`);
    });

    it('keeps the window foot when the sheet has no footer', () => {
        renderSheet({ footer: undefined });

        expect(regionBottom()).toBe(`${INSET + SNACKBAR_GAP}px`);
    });

    // A footer with little content above it is "unpinned" (it scrolls with the content), and on a content-sized sheet it
    // still stands at the window's foot: it is the footer, not the pin, that the snackbar must not cover (seen on an
    // iPhone run of #221: the snackbar hid Clear ticks).
    it('sits one gap above the footer when the footer has scrolled into the content', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });
        // The footer moved into the scroll region, a new view, and reports its height again from there.
        layOut({ sheet: 300, topBlock: 64, footer: 92 });

        expect(regionBottom()).toBe(`${92 + SNACKBAR_GAP}px`);
    });

    // The footer's own report can arrive before the frame's in one pass, so the decision it was made under may be old.
    // The offset is read from the one decision and the one measured height, never from an event's order.
    it('sits above the footer once the sheet grows back and the footer pins again', () => {
        renderSheet();
        layOut({ sheet: 300, topBlock: 64, footer: 92 });
        layOut({ sheet: 700, topBlock: 64, footer: 92 });

        expect(regionBottom()).toBe(`${92 + SNACKBAR_GAP}px`);
    });
});
