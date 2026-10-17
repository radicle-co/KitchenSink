import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resizeObserver } from '../../testing/resizeObserver.js';
import { HorizontalScroller } from '../HorizontalScroller.js';
import type { HorizontalScrollerProps } from '../props.js';
import type { ScrollExtent } from '../scrollHint.js';

/**
 * The web `HorizontalScroller` (`docs/design/uiOverhaul/horizontalScrollHint.md` §3.2-§4): one scroller whose
 * scrollbar stays hidden until the reader scrolls and whose chevron shows only while the content overflows and the
 * scroller rests at its start.
 *
 * jsdom lays nothing out, so each test reports a geometry for the scroller it is given: the properties are defined
 * from the `onScroller` callback, which React runs before the hook's first measure. The chevron's opacity is asserted
 * from its INLINE style, because a class cannot be computed here; the real computed value is asserted in Playwright.
 */

afterEach(() => {
    cleanup();
    resizeObserver.observed.clear();
    vi.useRealTimers();
});

interface Geometry {
    scrollWidth: number;
    clientWidth: number;
    scrollLeft: number;
}

/** Report `geometry` for any element handed to `onScroller`, reading it live so a test can move it. */
function reporting(geometry: Geometry, onScroller?: (el: HTMLElement | null) => void) {
    return (el: HTMLElement | null): void => {
        if (el !== null) {
            Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => geometry.scrollWidth });
            Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => geometry.clientWidth });
            Object.defineProperty(el, 'scrollLeft', {
                configurable: true,
                get: () => geometry.scrollLeft,
                set: (value: number) => {
                    geometry.scrollLeft = value;
                },
            });
        }

        onScroller?.(el);
    };
}

function mount(geometry: Geometry, props: Partial<HorizontalScrollerProps> = {}) {
    let scroller: HTMLElement | null = null;
    const result = render(
        <HorizontalScroller
            {...props}
            onScroller={reporting(geometry, (el) => {
                scroller = el ?? scroller;
            })}
        >
            <ul>
                <li>One</li>
                <li>Two</li>
            </ul>
        </HorizontalScroller>,
    );

    return { ...result, scroller: scroller as unknown as HTMLElement };
}

/** The decorative chevron: the scroller's next sibling. */
const chevronOf = (scroller: HTMLElement): HTMLElement => scroller.nextElementSibling as HTMLElement;

const opacityOf = (scroller: HTMLElement): string => chevronOf(scroller).style.opacity;

/** Scroll the element to `left`, as a reader does. */
function scrollTo(scroller: HTMLElement, left: number): void {
    scroller.scrollLeft = left;
    fireEvent.scroll(scroller);
}

/** Tell the observer the box or the content changed size. */
function resized(): void {
    act(() => resizeObserver.callback?.([], {} as ResizeObserver));
}

describe('HorizontalScroller (web) — the chevron', () => {
    it('shows nothing before it is measured', () => {
        const { scroller } = mount({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 });

        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBeUndefined();
    });

    it('shows nothing when the content fits', () => {
        const { scroller } = mount({ scrollWidth: 240, clientWidth: 400, scrollLeft: 0 });

        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBeUndefined();
    });

    it('shows the chevron at the start of a scroller that overflows, and widens the fade to its band', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(opacityOf(scroller)).toBe('1');
        expect(scroller.dataset['hint']).toBe('start');
    });

    it('hides the chevron on the first scroll, keeps the narrower fade while more lies ahead, and brings it back at the start', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        scrollTo(scroller, 2);
        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBe('more');

        scrollTo(scroller, 150);
        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBe('more');

        scrollTo(scroller, 0);
        expect(opacityOf(scroller)).toBe('1');
        expect(scroller.dataset['hint']).toBe('start');
    });

    it('shows neither the chevron nor the fade at the end', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        scrollTo(scroller, 340);

        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBeUndefined();
    });

    it('measures again when the box or the content changes size', () => {
        const geometry = { scrollWidth: 240, clientWidth: 400, scrollLeft: 0 };
        const { scroller } = mount(geometry);

        expect(opacityOf(scroller)).toBe('0');

        geometry.scrollWidth = 640;
        resized();
        expect(opacityOf(scroller)).toBe('1');

        geometry.clientWidth = 800;
        resized();
        expect(opacityOf(scroller)).toBe('0');
    });

    it('watches both the scroller and its content box for a change of size', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(resizeObserver.observed.has(scroller)).toBe(true);
        expect(resizeObserver.observed.size).toBe(2);
    });

    it('reads a right-to-left scroller, whose scrollLeft runs negative, from its start edge', () => {
        const geometry = { scrollWidth: 640, clientWidth: 300, scrollLeft: 0 };
        let element: HTMLElement | null = null;

        render(
            <div dir="rtl" style={{ direction: 'rtl' }}>
                <HorizontalScroller
                    onScroller={reporting(geometry, (el) => {
                        element = el ?? element;
                    })}
                >
                    <ul />
                </HorizontalScroller>
            </div>,
        );
        const scroller = element as unknown as HTMLElement;

        expect(opacityOf(scroller)).toBe('1');

        scrollTo(scroller, -150);
        expect(opacityOf(scroller)).toBe('0');
        expect(scroller.dataset['hint']).toBe('more');

        scrollTo(scroller, -340);
        expect(scroller.dataset['hint']).toBeUndefined();
    });

    it('is decorative: hidden from assistive technology and never takes a touch or a click', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });
        const chevron = chevronOf(scroller);

        expect(chevron.getAttribute('aria-hidden')).toBe('true');
        expect(chevron.className.split(' ')).toContain('pointer-events-none');
        expect(chevron.querySelector('[tabindex]')).toBeNull();
        expect(chevron.className).toContain('motion-safe:transition-opacity');
    });
});

describe('HorizontalScroller (web) — the scrollbar', () => {
    beforeEach(() => vi.useFakeTimers());

    it('marks the scroller as scrolling on a scroll, and clears the mark on scrollend', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(scroller.hasAttribute('data-scrolling')).toBe(false);

        scrollTo(scroller, 50);
        expect(scroller.hasAttribute('data-scrolling')).toBe(true);

        fireEvent(scroller, new Event('scrollend'));
        expect(scroller.hasAttribute('data-scrolling')).toBe(false);
    });

    it('clears the mark 500 ms after the last scroll when no scrollend arrives', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        scrollTo(scroller, 50);
        vi.advanceTimersByTime(400);
        scrollTo(scroller, 80);
        vi.advanceTimersByTime(400);
        expect(scroller.hasAttribute('data-scrolling')).toBe(true);

        vi.advanceTimersByTime(100);
        expect(scroller.hasAttribute('data-scrolling')).toBe(false);
    });

    it('keeps a thin scrollbar always (so it never shifts the layout), transparent at rest once scripts run', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });
        const classes = scroller.className.split(' ');

        expect(classes).toContain('[scrollbar-width:thin]');
        expect(classes).toContain('[@media(scripting:enabled)]:[scrollbar-color:transparent_transparent]');
        expect(classes.some((name) => name.startsWith('data-[scrolling]:'))).toBe(true);
        expect(classes.some((name) => name.includes('pointer:fine') && name.includes('hover:'))).toBe(true);
    });
});

describe('HorizontalScroller (web) — its box in the page', () => {
    // The scroller's content is `w-max`. A flex or grid item cannot shrink below its content unless its minimum width
    // is 0, so without `min-w-0` on the outer box the whole strip widened its row, and at 320 px the PAGE scrolled
    // sideways (search.spec.ts, "at six ingredients on a phone"). jsdom computes no layout, so this pins the class the
    // browser needs; the Playwright spec proves the page does not scroll.
    it('lets a flex or grid parent shrink it, so its content never widens the page', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(scroller.parentElement?.className.split(' ')).toContain('min-w-0');
    });
});

describe('HorizontalScroller (web) — position and ref', () => {
    it('reports its extent on mount, and again only when a boundary flips', () => {
        const onPosition = vi.fn<(extent: ScrollExtent) => void>();
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 }, { onPosition });

        expect(onPosition).toHaveBeenLastCalledWith({ measured: true, overflows: true, atStart: true, atEnd: false });
        const afterMount = onPosition.mock.calls.length;

        scrollTo(scroller, 50);
        expect(onPosition).toHaveBeenCalledTimes(afterMount + 1);
        expect(onPosition).toHaveBeenLastCalledWith({ measured: true, overflows: true, atStart: false, atEnd: false });

        // Moving within the middle flips nothing.
        scrollTo(scroller, 120);
        scrollTo(scroller, 200);
        expect(onPosition).toHaveBeenCalledTimes(afterMount + 1);

        scrollTo(scroller, 340);
        expect(onPosition).toHaveBeenLastCalledWith({ measured: true, overflows: true, atStart: false, atEnd: true });
    });

    it('hands the owner its element, and null when it goes', () => {
        const onScroller = vi.fn();
        const { unmount } = render(
            <HorizontalScroller onScroller={onScroller}>
                <ul />
            </HorizontalScroller>,
        );

        expect(onScroller).toHaveBeenCalledWith(expect.any(HTMLElement));
        unmount();
        expect(onScroller).toHaveBeenLastCalledWith(null);
    });

    it('does not detach and re-attach the owner’s callback on a re-render', () => {
        const onScroller = vi.fn();
        const { rerender } = render(
            <HorizontalScroller onScroller={onScroller}>
                <ul />
            </HorizontalScroller>,
        );
        const calls = onScroller.mock.calls.length;

        rerender(
            <HorizontalScroller onScroller={onScroller}>
                <ul />
            </HorizontalScroller>,
        );

        expect(onScroller).toHaveBeenCalledTimes(calls);
    });
});

describe('HorizontalScroller (web) — a named region', () => {
    const items = (
        <ul>
            <li>One</li>
            <li>Two</li>
        </ul>
    );

    it('is a plain scroller with no role and no tab stop unless it is given a name', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(scroller.getAttribute('role')).toBeNull();
        expect(scroller.getAttribute('tabindex')).toBeNull();
    });

    it('is a focusable region with that name, whose focus ring is drawn inside the mask', () => {
        render(<HorizontalScroller regionLabel="Trending recipes">{items}</HorizontalScroller>);

        const region = screen.getByRole('region', { name: 'Trending recipes' });

        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.className.split(' ')).toContain('focus-visible:ring-inset');
    });

    it('steps by one item on an arrow key, in the key’s own direction', () => {
        render(<HorizontalScroller regionLabel="Trending recipes">{items}</HorizontalScroller>);
        const region = screen.getByRole('region', { name: 'Trending recipes' });
        const [first, second] = [...region.querySelectorAll('li')];
        const rect = (left: number, width: number): DOMRect => ({ left, width }) as DOMRect;

        vi.spyOn(first as HTMLElement, 'getBoundingClientRect').mockReturnValue(rect(0, 256));
        vi.spyOn(second as HTMLElement, 'getBoundingClientRect').mockReturnValue(rect(272, 256));
        const scrollBy = vi.fn();
        region.scrollBy = scrollBy;

        fireEvent.keyDown(region, { key: 'ArrowRight' });
        expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 272 }));

        fireEvent.keyDown(region, { key: 'ArrowLeft' });
        expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -272 }));

        scrollBy.mockClear();
        fireEvent.keyDown(region, { key: 'ArrowDown' });
        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('leaves an arrow key alone when it comes from an item inside, not from the region', () => {
        render(
            <HorizontalScroller regionLabel="Trending recipes">
                <ul>
                    <li>
                        <button type="button">Open</button>
                    </li>
                </ul>
            </HorizontalScroller>,
        );
        const region = screen.getByRole('region', { name: 'Trending recipes' });
        region.scrollBy = vi.fn();

        fireEvent.keyDown(screen.getByRole('button', { name: 'Open' }), { key: 'ArrowRight' });

        expect(region.scrollBy).not.toHaveBeenCalled();
    });

    it('has no key handler at all without a name, so a chip row keeps its own arrow keys', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });
        scroller.scrollBy = vi.fn();

        fireEvent.keyDown(scroller, { key: 'ArrowRight' });

        expect(scroller.scrollBy).not.toHaveBeenCalled();
    });
});

describe('HorizontalScroller (web) — focus', () => {
    it('brings a focused child whole into view, and leaves the scroller’s own focus alone', () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        render(
            <HorizontalScroller regionLabel="Sections">
                <a href="#one">One</a>
            </HorizontalScroller>,
        );

        screen.getByRole('link', { name: 'One' }).focus();
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'One' }));

        scrollIntoView.mockClear();
        screen.getByRole('region', { name: 'Sections' }).focus();
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('keeps the end of the scroll box clear of the hint band', () => {
        const { scroller } = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });

        expect(scroller.className.split(' ')).toContain('scroll-pe-10');
    });
});

describe('HorizontalScroller (web) — layout props', () => {
    it('snaps to proximity for items and mandatory with start padding for cards', () => {
        const item = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 }, { snap: { kind: 'item' } });
        expect(item.scroller.className.split(' ')).toEqual(expect.arrayContaining(['snap-x', 'snap-proximity']));
        cleanup();

        const card = mount(
            { scrollWidth: 640, clientWidth: 300, scrollLeft: 0 },
            { snap: { kind: 'card', interval: 272 } },
        );
        expect(card.scroller.className.split(' ')).toEqual(
            expect.arrayContaining(['snap-x', 'snap-mandatory', 'scroll-ps-4']),
        );
        cleanup();

        const none = mount({ scrollWidth: 640, clientWidth: 300, scrollLeft: 0 });
        expect(none.scroller.className).not.toContain('snap-');
    });
});
