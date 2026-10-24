/**
 * The web ScrollHost (A7): the document scrolls and the host holds no ref. `condensed` follows an IntersectionObserver
 * on the heading; the direction and the top follow ONE passive, frame-throttled scroll listener; jumps are smooth, or
 * instant under reduced motion; a section jump records its hash with `replaceState` (no history entry).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { ScrollHostApi } from '../props.js';
import { ScrollHost } from '../ScrollHost.js';
import { useScrollHost } from '../scrollHostContext.js';

type ObserverCallback = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;

const observers: { callback: ObserverCallback; options?: IntersectionObserverInit; target?: Element }[] = [];
let reducedMotion = false;

beforeEach(() => {
    observers.length = 0;
    reducedMotion = false;
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            private readonly record: {
                callback: ObserverCallback;
                options?: IntersectionObserverInit;
                target?: Element;
            };

            constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
                this.record = { callback, ...(options === undefined ? {} : { options }) };
                observers.push(this.record);
            }

            observe(target: Element): void {
                this.record.target = target;
            }

            disconnect(): void {}
        },
    );
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion && query.includes('reduce') }));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

function renderHost(topInset?: number): () => ScrollHostApi {
    const seen: { api?: ScrollHostApi } = {};

    const Probe = (): null => {
        seen.api = useScrollHost();

        return null;
    };

    render(
        <ScrollHost headingId="page-title" sections={['a', 'b']} {...(topInset === undefined ? {} : { topInset })}>
            <h1 id="page-title">Recipes</h1>
            <section id="a" />
            <section id="b" tabIndex={-1} />
            <Probe />
        </ScrollHost>,
    );

    return () => {
        if (seen.api === undefined) {
            throw new Error('no api');
        }

        return seen.api;
    };
}

const scrollTo = (y: number): void => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    window.dispatchEvent(new Event('scroll'));
};

describe('ScrollHost (web)', () => {
    it('watches the page heading and condenses once it leaves the top of the viewport', () => {
        const api = renderHost();
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        expect(watch).toBeDefined();
        act(() => watch?.callback([{ isIntersecting: false, boundingClientRect: { top: -40 } as DOMRectReadOnly }]));
        expect(api().condensed).toBe(true);

        act(() => watch?.callback([{ isIntersecting: true, boundingClientRect: { top: 10 } as DOMRectReadOnly }]));
        expect(api().condensed).toBe(false);
    });

    // Pinned back bar, blueprint step 7 (the web half of step 1): a fixed 56 px bar covers the top of the viewport, so the
    // heading is "gone" when it is under the BAR, not under the viewport's top; without it the web has the dead band.
    it('with a top inset, watches from under the pinned bar: the margin and the line both move by the inset', () => {
        const api = renderHost(56);
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        expect(watch?.options?.rootMargin).toBe('-56px 0px 0px 0px');
        act(() => watch?.callback([{ isIntersecting: false, boundingClientRect: { top: 20 } as DOMRectReadOnly }]));
        expect(api().condensed).toBe(true);
    });

    it('with no inset, watches from the viewport top and a heading at y 20 outside it is not above it', () => {
        const api = renderHost();
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        expect(watch?.options?.rootMargin).toBe('0px 0px 0px 0px');
        act(() => watch?.callback([{ isIntersecting: false, boundingClientRect: { top: 20 } as DOMRectReadOnly }]));
        expect(api().condensed).toBe(false);
    });

    it('does not condense when the heading is merely below the viewport', () => {
        const api = renderHost();
        const watch = observers.find((observer) => observer.target?.id === 'page-title');

        act(() => watch?.callback([{ isIntersecting: false, boundingClientRect: { top: 2000 } as DOMRectReadOnly }]));
        expect(api().condensed).toBe(false);
    });

    it('follows the direction and the top through the document scroll', async () => {
        const api = renderHost();

        act(() => scrollTo(500));
        await waitFor(() => expect(api().scrollingDown).toBe(true));
        expect(api().atTop).toBe(false);

        act(() => scrollTo(200));
        await waitFor(() => expect(api().scrollingDown).toBe(false));
    });

    it('scrolls to the top smoothly, and instantly under reduced motion', () => {
        const api = renderHost();

        api().scrollToTop();
        expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });

        reducedMotion = true;
        api().scrollToTop();
        expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
    });

    it('jumps to a section and records its hash without a history entry', () => {
        const api = renderHost();
        const section = document.getElementById('b');
        const intoView = vi.fn();

        if (section === null) {
            throw new Error('no section');
        }

        section.scrollIntoView = intoView;
        const length = window.history.length;

        api().scrollToSection('b');

        expect(intoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(window.location.hash).toBe('#b');
        expect(window.history.length).toBe(length);
    });

    /**
     * ⛔ Through Next's own shallow-update path (code-reviewer High 4, 2026-10-09). Passing `history.state` carries Next's
     * `__NA` flag, so Next skips its router sync, never learns the hash, and its next commit rewrites the URL without it.
     */
    it('⛔ records the hash with a null state, so Next syncs its router to it', () => {
        window.history.replaceState({ __NA: true }, '', '/en/recipes/new');
        const api = renderHost();
        const section = document.getElementById('b');

        if (section === null) {
            throw new Error('no section');
        }

        section.scrollIntoView = vi.fn();
        const replaceState = vi.spyOn(window.history, 'replaceState');

        api().scrollToSection('b');

        expect(replaceState).toHaveBeenLastCalledWith(null, '', '#b');
        replaceState.mockRestore();
    });

    // The one section jump (A7): `SectionSwitch` calls this rather than keeping its own. A jump that leaves focus
    // behind leaves a keyboard or screen-reader user reading where they were (WCAG 2.4.3).
    it('moves focus to the section it jumps to, without a second scroll', () => {
        const api = renderHost();
        const section = document.getElementById('b');

        if (section === null) {
            throw new Error('no section');
        }

        section.scrollIntoView = vi.fn();
        const focus = vi.spyOn(section, 'focus');

        api().scrollToSection('b');

        expect(document.activeElement).toBe(section);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('ignores an id with no element: no scroll, no hash', () => {
        const api = renderHost();
        window.history.replaceState(null, '', '#a');

        api().scrollToSection('missing');

        expect(window.location.hash).toBe('#a');
    });

    /**
     * E7 (build spec §7.8): a refused Publish takes the cook to the first invalid FIELD, not just its section. The field
     * is centred (the sticky chrome sits at both edges) and takes focus.
     */
    it('scrolls a field into view and focuses it; answers whether it found one', () => {
        const api = renderHost();
        const field = document.createElement('input');
        field.id = 'recipe-title';
        document.body.append(field);
        field.scrollIntoView = vi.fn();

        const found = api().scrollToField('recipe-title');

        expect(found).toBe(true);
        expect(field.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(document.activeElement).toBe(field);
        expect(api().scrollToField('no-such-field')).toBe(false);
        field.remove();
    });

    it('does not record a hash for a field: only a section is addressable', () => {
        const api = renderHost();
        window.history.replaceState(null, '', '/page');
        const field = document.createElement('input');
        field.id = 'recipe-title';
        document.body.append(field);
        field.scrollIntoView = vi.fn();

        api().scrollToField('recipe-title');

        expect(window.location.hash).toBe('');
        field.remove();
    });

    it('holds no scroller handle on web', () => {
        expect(renderHost()().handle.current).toBeNull();
    });
});

/**
 * The arrival reveal (`docs/design/uiOverhaul/ingredientArrival.md`): `revealSpan` shows a new row and the field under it
 * together, with the smallest scroll, inside what the document's `scroll-padding` leaves of the window. It never moves
 * focus: the cook is typing in the field.
 */
describe('ScrollHost (web) — revealSpan', () => {
    const WINDOW_PX = 600;
    let style: HTMLStyleElement | undefined;

    /** The row's and the field's tops in the window, set before the call. */
    function place(row: { top: number; bottom: number }, field: { top: number; bottom: number }): void {
        for (const [id, rect] of [
            ['row', row],
            ['field', field],
        ] as const) {
            const node = document.getElementById(id);

            if (node === null) {
                throw new Error(`no ${id}`);
            }

            node.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.bottom }) as DOMRect;
        }
    }

    function renderSpanHost(): () => ScrollHostApi {
        const api = renderHost();
        const row = document.createElement('li');
        const field = document.createElement('input');
        row.id = 'row';
        field.id = 'field';
        document.body.append(row, field);
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW_PX });
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });

        return api;
    }

    afterEach(() => {
        document.getElementById('row')?.remove();
        document.getElementById('field')?.remove();
        style?.remove();
        style = undefined;
    });

    it('scrolls nothing when the row and the field already show', () => {
        const api = renderSpanHost();
        place({ top: 200, bottom: 260 }, { top: 270, bottom: 320 });

        expect(api().revealSpan('row', 'field')).toBe(true);

        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('scrolls the row one gap under the top when it is above the window', () => {
        const api = renderSpanHost();
        place({ top: -40, bottom: 20 }, { top: 30, bottom: 80 });

        api().revealSpan('row', 'field');

        // The 8 px gap above the row: 1000 - 40 - 8.
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 952, behavior: 'smooth' });
    });

    it('scrolls the field one gap above the bottom when it is below the window', () => {
        const api = renderSpanHost();
        place({ top: 500, bottom: 560 }, { top: 570, bottom: 640 });

        api().revealSpan('row', 'field');

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 1048, behavior: 'smooth' });
    });

    it('keeps the span clear of the document’s scroll-padding (the sticky header and the action bar)', () => {
        style = document.createElement('style');
        style.textContent = 'html { scroll-padding-top: 72px; scroll-padding-bottom: 100px; }';
        document.head.append(style);
        const api = renderSpanHost();
        // Inside the window, but under the 100 px bar: the free area is 72..500.
        place({ top: 300, bottom: 360 }, { top: 370, bottom: 520 });

        api().revealSpan('row', 'field');

        // The field's bottom (520) plus the gap must end at 500: 28 px down.
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 1028, behavior: 'smooth' });
    });

    it('scrolls instantly under reduced motion', () => {
        reducedMotion = true;
        const api = renderSpanHost();
        place({ top: -40, bottom: 20 }, { top: 30, bottom: 80 });

        api().revealSpan('row', 'field');

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 952, behavior: 'auto' });
    });

    it('never moves focus', () => {
        const api = renderSpanHost();
        const field = document.getElementById('field');
        field?.focus();
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        place({ top: -40, bottom: 20 }, { top: 30, bottom: 80 });

        api().revealSpan('row', 'field');

        expect(focus).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(field);
    });

    it('answers false and scrolls nothing when either element is missing', () => {
        const api = renderSpanHost();
        place({ top: -40, bottom: 20 }, { top: 30, bottom: 80 });

        expect(api().revealSpan('row', 'no-such-field')).toBe(false);
        expect(api().revealSpan('no-such-row', 'field')).toBe(false);
        expect(window.scrollTo).not.toHaveBeenCalled();
    });
});

/**
 * After an explicit jump the index shows the section jumped to until the cook scrolls again, even when the page is too
 * short for that section to reach the top (the scroll spy alone would still name the section above it). The jump's own
 * scroll, smooth or instant, never releases it; the cook's own input does (a wheel, a touch, a scroll key), and so does
 * any scroll once the jump's scroll has ended (a scrollbar drag).
 */
describe('ScrollHost (web) — a jump holds the current section until the cook scrolls again', () => {
    /** Section a at 0 and b at 900 in the document; the page ends before b can reach the top. */
    function layOut(): void {
        for (const [id, top] of [
            ['a', 0],
            ['b', 900],
        ] as const) {
            const node = document.getElementById(id);

            if (node === null) {
                throw new Error(`no section ${id}`);
            }

            node.getBoundingClientRect = () => ({ top: top - window.scrollY }) as DOMRect;
            node.scrollIntoView = vi.fn();
        }

        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3000 });
    }

    async function jumped(): Promise<() => ScrollHostApi> {
        const api = renderHost();
        layOut();
        act(() => scrollTo(100));
        await waitFor(() => expect(api().current).toBe('a'));

        act(() => api().scrollToSection('b'));

        return api;
    }

    it('names the section jumped to at once, and the jump’s own scroll does not release it', async () => {
        const api = await jumped();

        expect(api().current).toBe('b');

        // The jump's own scroll: it stops at 400, short of b, because the page ends.
        act(() => scrollTo(400));
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(api().current).toBe('b');
    });

    it.each([
        { why: 'a wheel', input: () => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 })) },
        { why: 'a touch', input: () => window.dispatchEvent(new Event('touchstart')) },
        {
            why: 'a scroll key',
            input: () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })),
        },
        {
            why: 'any scroll once the jump’s scroll has ended (a scrollbar drag)',
            input: () => window.dispatchEvent(new Event('scrollend')),
        },
    ])('the cook’s own scroll releases it: $why', async ({ input }) => {
        const api = await jumped();

        act(() => {
            input();
        });
        act(() => scrollTo(150));

        await waitFor(() => expect(api().current).toBe('a'));
    });

    it('scrollToTop releases it: the cook asked to leave the section', async () => {
        const api = await jumped();

        act(() => api().scrollToTop());
        act(() => scrollTo(150));

        await waitFor(() => expect(api().current).toBe('a'));
    });

    it('typing in a field is not scrolling: it keeps the jump', async () => {
        const api = await jumped();
        const field = document.createElement('input');
        document.body.append(field);

        act(() => {
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        });
        act(() => scrollTo(150));
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(api().current).toBe('b');
        field.remove();
    });
});

/**
 * A section change is an EVENT, fired from the scroll listener (staff-code-quality REACT-04): a consumer that must act
 * on it (the editor's section-change checkpoint) subscribes, rather than relaying `current` through state and an effect.
 * It reports the scroll spy's section and the one before it.
 */
describe('ScrollHost (web) — section-change events', () => {
    function layOut(): void {
        for (const [id, top] of [
            ['a', 0],
            ['b', 900],
        ] as const) {
            const node = document.getElementById(id);

            if (node === null) {
                throw new Error(`no section ${id}`);
            }

            node.getBoundingClientRect = () => ({ top: top - window.scrollY }) as DOMRect;
        }

        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3000 });
    }

    const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));

    it('reports each change of the spy’s section to a subscriber, once per change, until it unsubscribes', async () => {
        const api = renderHost();
        layOut();
        const changes: (readonly [string | undefined, string | undefined])[] = [];
        let unsubscribe: () => void = () => undefined;
        act(() => {
            unsubscribe = api().onCurrentChange((current, previous) => changes.push([current, previous]));
        });

        for (const y of [10, 20, 1000, 1100]) {
            act(() => scrollTo(y));
            await act(frame);
        }

        expect(changes).toEqual([
            ['a', undefined],
            ['b', 'a'],
        ]);

        unsubscribe();
        act(() => scrollTo(10));
        await act(frame);
        expect(changes).toHaveLength(2);
    });

    it('keeps one subscription function across renders', async () => {
        const api = renderHost();
        layOut();
        const first = api().onCurrentChange;
        expect(typeof first).toBe('function');

        act(() => scrollTo(1000));
        await waitFor(() => expect(api().current).toBe('b'));

        expect(api().onCurrentChange).toBe(first);
    });
});
