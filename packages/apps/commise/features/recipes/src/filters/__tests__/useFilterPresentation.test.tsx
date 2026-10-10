// @vitest-environment jsdom
/**
 * Which place Discover's facets take on web (`docs/architecture/uiOverhaulBlueprint.md` Part C, slice 5): the panel when
 * `<main>` is at least 960 wide AND the window is not short, otherwise the sheet. It reads the container class of `<main>`
 * and the window's height, follows both as they change, and answers the sheet while it cannot measure (the server, the
 * first render), so a server render and its hydration agree.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFilterPresentation } from '../useFilterPresentation.js';

/** A ResizeObserver the test drives. */
class FakeObserver {
    static instances: FakeObserver[] = [];

    constructor(readonly callback: ResizeObserverCallback) {
        FakeObserver.instances.push(this);
    }

    observe(): void {}

    disconnect(): void {}

    resize(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
}

let main: HTMLElement;

const setHeight = (height: number): void => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
};

beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
    main = document.createElement('main');
    document.body.append(main);
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
});

afterEach(() => {
    cleanup();
    main.remove();
    vi.unstubAllGlobals();
});

describe('useFilterPresentation (web)', () => {
    it('is the sheet until <main> is measured', () => {
        const { result } = renderHook(() => useFilterPresentation());

        expect(result.current).toBe('sheet');
    });

    it('is the panel once <main> is 960 wide in a tall window, and the sheet below that', () => {
        const { result } = renderHook(() => useFilterPresentation());

        act(() => FakeObserver.instances[0]?.resize(960));
        expect(result.current).toBe('panel');

        act(() => FakeObserver.instances[0]?.resize(959));
        expect(result.current).toBe('sheet');
    });

    it('is the sheet when the window is short, however wide <main> is, and follows a window that grows tall', () => {
        setHeight(479);
        const { result } = renderHook(() => useFilterPresentation());
        act(() => FakeObserver.instances[0]?.resize(1200));

        expect(result.current).toBe('sheet');

        setHeight(480);

        expect(result.current).toBe('panel');
    });
});
