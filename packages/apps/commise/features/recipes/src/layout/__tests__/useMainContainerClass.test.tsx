// @vitest-environment jsdom
/**
 * The web container class of `<main>` (`docs/design/uiOverhaul/buildSpec.md` §1.2): what `cardVariantOf` and the
 * library's default view read. It follows the element's content box through a `ResizeObserver`, answers `narrow` on the
 * server and before `<main>` exists, and stops observing on unmount.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    /** Report a new content width. */
    resize(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
}

let main: HTMLElement;

beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
    main = document.createElement('main');
    document.body.append(main);
});

afterEach(() => {
    cleanup();
    main.remove();
    vi.unstubAllGlobals();
});

describe('useMainContainerClass', () => {
    it('observes <main> and reports its class as it resizes, inclusive at each threshold', () => {
        const { result } = renderHook(() => useMainContainerClass());
        const observer = FakeObserver.instances[0]!;

        expect(observer.observed).toEqual([main]);

        for (const [width, expected] of [
            [599, 'narrow'],
            [600, 'regular'],
            [959, 'regular'],
            [960, 'wide'],
        ] as const) {
            act(() => observer.resize(width));

            expect(result.current).toBe(expected);
        }
    });

    it('stops observing on unmount', () => {
        const { unmount } = renderHook(() => useMainContainerClass());

        unmount();

        expect(FakeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    });

    it('answers narrow when the page has no <main>', () => {
        main.remove();

        expect(renderHook(() => useMainContainerClass()).result.current).toBe('narrow');
    });
});
