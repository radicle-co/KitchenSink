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
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps, type JSX } from 'react';
import { Text, type ScrollView as ScrollViewType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';

/** The one `ResizeObserver` react-native-web creates, recorded so a test can report layout through it. */
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
/** The title row: the row that holds the title's box and Close. */
const titleRow = (): HTMLElement => screen.getByRole('button', { name: 'Close filters' }).parentElement as HTMLElement;
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

    it('still hides an unpinned footer while the toolbar is collapsed', () => {
        state.keyboardShown = true;
        renderSheet({ toolbar: { heading: <Text>Search 40 options</Text>, controls: <Text>Search</Text> } });

        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });
});
