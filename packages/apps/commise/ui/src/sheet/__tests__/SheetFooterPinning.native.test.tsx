/**
 * Sheet (native) — the footer unpins past a limit (`docs/design/ingredientSpecialization.md` §S8.1, finding I7; owner
 * ruling, option B). When the pinned title row and the footer together take more than half the sheet's height, the
 * footer (`Done`) scrolls with the content; Close stays pinned in the title row.
 *
 * The rule needs real heights, which the panel takes from `onLayout`. react-native-web implements `onLayout` with a
 * `ResizeObserver` and reads each node's `offsetHeight`, neither of which jsdom lays out, so this file installs a
 * recording `ResizeObserver` and serves the heights itself. That keeps the WIRING under test (which node reports which
 * height), not only the pure rule (`layout/__tests__/pinnedFooter.test.ts`).
 *
 * ⚠️ The on-device proof is the Maestro landscape flow, which types into the filter sheet with the keyboard up.
 */
import { resizeObserver as observer } from '../../testing/resizeObserver.js';
import { act, cleanup, screen } from '@testing-library/react';
import { createElement, type ComponentProps, type JSX } from 'react';
import { Text, type ScrollView as ScrollViewType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { touchFloor } from '../../layout/touchFloor.native.js';
import { render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';

const state = vi.hoisted(() => ({ keyboardShown: false }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        // The real ScrollView, its element marked, so "the footer scrolls with the content" is "the footer sits
        // inside the scroll region".
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement('div', { 'data-scroll-region': true }, createElement(actual.ScrollView, props)),
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => state.keyboardShown }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));

beforeEach(() => {
    vi.useFakeTimers();
    state.keyboardShown = false;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function renderSheet(overrides: Partial<SheetProps> = {}): void {
    render(
        <Sheet
            open
            onOpenChange={vi.fn()}
            title="Filter recipes"
            closeLabel="Close filters"
            size="content"
            footer={<Text accessibilityRole="button">Done</Text>}
            {...overrides}
        >
            <Text>Dietary</Text>
        </Sheet>,
    );
}

/**
 * The value react-native-web applied for a CSS property: `StyleSheet.create` styles compile to atomic `r-*` classes
 * (walked back to their rules, since jsdom's `getComputedStyle` does not resolve them), and per-render styles land
 * inline.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    let resolved: string | undefined;

    for (const className of element.className.split(' ').filter((name) => name.startsWith('r-'))) {
        for (const sheet of Array.from(document.styleSheets)) {
            for (const rule of Array.from(sheet.cssRules)) {
                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    resolved = rule.style.getPropertyValue(property) || resolved;
                }
            }
        }
    }

    return resolved;
}

/** The sheet: the dialog nearest around its title header, which names it (`docs/design/nativeContainerNames.md` N1). */
const dialog = (): HTMLElement =>
    screen.getByRole('heading', { name: 'Filter recipes' }).closest('[role="dialog"]') as HTMLElement;
/**
 * The top block the footer decision measures: the swipe zone, which holds the grab handle AND the title row that holds
 * the title's box and Close (Close's grandparent). REWRITTEN for parity item 7: it used to be the title row alone; the
 * handle joined the zone, and the measure must count it or the footer unpins about 17 pt late.
 */
const titleRow = (): HTMLElement =>
    screen.getByRole('button', { name: 'Close filters' }).parentElement?.parentElement as HTMLElement;
/** The footer: the view that holds Done. */
const footer = (): HTMLElement => screen.getByRole('button', { name: 'Done' }).parentElement as HTMLElement;
const scrollRegion = (): Element => dialog().querySelector('[data-scroll-region]') as Element;

/**
 * Report layout: give each node its height, fire the observer for every node it watches, and let react-native-web's
 * deferred measurement run.
 */
function layOut(heights: { readonly sheet: number; readonly titleRow: number; readonly footer: number }): void {
    for (const [node, height] of [
        [dialog(), heights.sheet],
        [titleRow(), heights.titleRow],
        [footer(), heights.footer],
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

describe('Sheet (native) — the footer unpins past a limit', () => {
    it('is pinned before anything is measured', () => {
        renderSheet();

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('stays pinned while the title row and footer take half the sheet or less', () => {
        renderSheet();
        layOut({ sheet: 600, titleRow: 56, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('scrolls the footer with the content once they take more than half; Close stays pinned', () => {
        renderSheet();
        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Close filters' }))).toBe(false);
        // The footer is the last thing in the region, after the content.
        const done = screen.getByRole('button', { name: 'Done' });

        expect(screen.getByText('Dietary').compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('does not flip back when the moved footer reports the same height from its new place', () => {
        renderSheet();
        layOut({ sheet: 300, titleRow: 64, footer: 92 });
        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    it('pins it again when the sheet grows back: the keyboard closes, or the phone turns upright', () => {
        renderSheet();
        layOut({ sheet: 300, titleRow: 64, footer: 92 });
        layOut({ sheet: 700, titleRow: 64, footer: 92 });

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
    });

    it('keeps the hairline above an unpinned footer, which now ends the list', () => {
        renderSheet();
        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        expect(appliedStyle(footer(), 'border-top-width')).toMatch(/^0?\.?\d+(\.\d+)?px$/u);
        expect(appliedStyle(footer(), 'border-top-width')).not.toBe('0px');
    });

    // ⛔ The footer's last height is KEPT while the collapse unmounts it: reset to 0, it would come back pinned and only
    // unpin a frame later, a visible jump under the cook's thumb.
    it('keeps the footer’s measured height through a collapse, so it comes back where it was', () => {
        const toolbar = { heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> };
        // A fresh element each render: the keyboard double is a plain read, so an identical element would let React
        // skip the render that reads it.
        const sheet = (): JSX.Element => (
            <Sheet
                open
                onOpenChange={vi.fn()}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
                toolbar={toolbar}
                footer={<Text accessibilityRole="button">Done</Text>}
            >
                <Text>Dietary</Text>
            </Sheet>
        );
        const { rerender } = render(sheet());

        layOut({ sheet: 300, titleRow: 64, footer: 92 });
        state.keyboardShown = true;
        act(() => rerender(sheet()));
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

        state.keyboardShown = false;
        act(() => rerender(sheet()));

        expect(scrollRegion().contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    // Issue #192. The keyboard shrinks the sheet a layout pass before this rule unpins the footer, so for one frame the
    // pinned title row and footer can take the whole sheet. A scroll region laid out at zero height there cost the field
    // being typed in its focus on an Android phone held sideways (measured: blur in that frame; with a floor, none).
    // jsdom lays nothing out, so this pins the frame's STYLE: a floor of one control, and the bare `ScrollView`'s grow
    // and shrink, so a `full` sheet's region still fills it and a `content` sheet's still fits. The layout itself is
    // proved on a device by the Maestro landscape flow.
    it('frames the scroll region with a one-control floor and the scroll view’s own grow and shrink', () => {
        renderSheet();

        // The frame the scroll region sits in: the element around the marked `ScrollView`.
        const frame = scrollRegion().parentElement;

        if (frame === null) {
            throw new Error('the scroll region has no frame around it');
        }

        expect(resolvedStyle(frame, 'minHeight')).toBe(`${touchFloor()}px`);
        expect(resolvedStyle(frame, 'flexGrow')).toBe('1');
        expect(resolvedStyle(frame, 'flexShrink')).toBe('1');
    });

    it('still hides an unpinned footer while the toolbar is collapsed', () => {
        state.keyboardShown = true;
        renderSheet({ toolbar: { heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> } });

        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
});
