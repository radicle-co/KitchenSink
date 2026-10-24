// @vitest-environment jsdom
/**
 * The web container class of `<main>` (`docs/design/uiOverhaul/buildSpec.md` §1.2): what `cardVariantOf` and the
 * library's default view read. It answers `narrow` on the server and before `<main>` exists, follows the element's
 * content box, and stops observing on unmount.
 *
 * ⚠️ REWRITTEN (2026-10-24) to prove two new rules, both from a measured failure. Discover's filter panel stayed a
 * Filters button at 1440 px in about 1 run in 40 (`search.spec.ts`, "narrows public recipes to a selected dietary
 * facet"). A probe in the hook showed TWO `<main>` elements at subscribe time: the first inside a `hidden` container,
 * 0 px wide, and the shell's own, 1184 px. `document.querySelector('main')` took the hidden one, cached its 0 px in a
 * module value, and its observer never fired again once that element was removed. So:
 *
 * 1. Inside the shell, the hook watches the `<main>` the shell provides (`MainElementContext`), never the document's
 *    first. Without a shell (a canvas board, a test), it keeps the document's `<main>`.
 * 2. The class is read from the element's LIVE width on every snapshot, never from a cached number, so a render after a
 *    missed resize still answers right. The old tests drove widths through observer events alone; jsdom has no layout,
 *    so these set each element's width and use the observer only as the change signal.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainElementContext } from '@commise/ui/main-element';

import { useMainContainerClass } from '../useMainContainerClass.js';

/** A ResizeObserver the test drives. */
class FakeObserver {
    static instances: FakeObserver[] = [];
    readonly observed: Element[] = [];
    disconnected = false;

    constructor(readonly callback: ResizeObserverCallback) {
        FakeObserver.instances.push(this);
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    disconnect(): void {
        this.disconnected = true;
    }

    /** Tell the hook its element changed size; the hook reads the size itself. */
    fire(): void {
        this.callback([], this as unknown as ResizeObserver);
    }
}

/** Give an element a layout width jsdom cannot compute (its padding is 0 here, so this is its content box). */
function setWidth(element: HTMLElement, px: number): void {
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => px });
}

/** A `<main>` appended to the document at a width. */
function mainOf(px: number): HTMLElement {
    const element = document.createElement('main');

    setWidth(element, px);
    document.body.append(element);

    return element;
}

/** A wrapper that provides a shell's `<main>` (or the shell's "not mounted yet" `null`). */
function shell(element: HTMLElement | null): (props: { children: ReactNode }) => ReactNode {
    return ({ children }) => createElement(MainElementContext, { value: element }, children);
}

beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
});

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe('useMainContainerClass — without a shell (a canvas board, a test)', () => {
    it('reports the document <main> class as it resizes, inclusive at each threshold', () => {
        const main = mainOf(0);
        const { result } = renderHook(() => useMainContainerClass());
        const observer = FakeObserver.instances[0]!;

        expect(observer.observed).toEqual([main]);

        for (const [width, expected] of [
            [599, 'narrow'],
            [600, 'regular'],
            [959, 'regular'],
            [960, 'wide'],
        ] as const) {
            setWidth(main, width);
            act(() => observer.fire());

            expect(result.current).toBe(expected);
        }
    });

    it('stops observing on unmount', () => {
        mainOf(1200);
        const { unmount } = renderHook(() => useMainContainerClass());

        unmount();

        expect(FakeObserver.instances.length).toBeGreaterThan(0);
        expect(FakeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    });

    it('answers narrow when the page has no <main>', () => {
        expect(renderHook(() => useMainContainerClass()).result.current).toBe('narrow');
    });
});

describe('useMainContainerClass — inside the shell', () => {
    it('watches the <main> the shell provides, not a hidden <main> earlier in the document', () => {
        mainOf(0);
        const own = mainOf(1184);
        const { result } = renderHook(() => useMainContainerClass(), { wrapper: shell(own) });

        expect(FakeObserver.instances.flatMap((observer) => observer.observed)).toEqual([own]);
        expect(result.current).toBe('wide');
    });

    it('reads the width live, so a render after a missed resize still answers right', () => {
        const own = mainOf(500);
        const { result, rerender } = renderHook(() => useMainContainerClass(), { wrapper: shell(own) });

        expect(result.current).toBe('narrow');

        // No observer event: the element simply is wider by the next render.
        setWidth(own, 1200);
        rerender();

        expect(result.current).toBe('wide');
    });

    it('follows the provided <main> when the observer reports a change', () => {
        const own = mainOf(1200);
        const { result } = renderHook(() => useMainContainerClass(), { wrapper: shell(own) });

        setWidth(own, 700);
        act(() => FakeObserver.instances[0]!.fire());

        expect(result.current).toBe('regular');
    });

    it('answers narrow and observes nothing while the shell has not mounted its <main>', () => {
        mainOf(1200);
        const { result } = renderHook(() => useMainContainerClass(), { wrapper: shell(null) });

        expect(result.current).toBe('narrow');
        expect(FakeObserver.instances.flatMap((observer) => observer.observed)).toEqual([]);
    });
});
