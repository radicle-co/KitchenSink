/**
 * The scroller host's side of the field reveal (`docs/design/rowEditorOpenDecisions.md` E1): it checks the fit when a
 * request arrives and on each change of the visible area while armed, lays out the space that gives a scroll room, and
 * scrolls once per opening. The Adapter (`measureField.native.ts`) is the seam: react-native-web has no native layout,
 * so the field's measured place is scripted here, and the scroll is recorded.
 */
import { act, renderHook } from '@testing-library/react';
import type { LayoutChangeEvent } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevealRequest, RevealTarget } from '../fieldRevealContext.js';
import type { FieldMeasure, RevealScroller } from '../measureField.native.js';

const seam = vi.hoisted(() => ({
    measures: [] as (FieldMeasure | null)[],
    measured: 0,
    scrolls: [] as { readonly y: number; readonly animated: boolean }[],
    reduceMotion: false as boolean | undefined,
}));

vi.mock('../measureField.native.js', () => ({
    measureField: (): Promise<FieldMeasure | null> => {
        seam.measured += 1;

        return Promise.resolve(seam.measures.shift() ?? null);
    },
    scrollContentTo: (_scroller: RevealScroller, y: number, animated: boolean): void => {
        seam.scrolls.push({ y, animated });
    },
}));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => seam.reduceMotion }));

import { useFieldRevealHost } from '../useFieldRevealHost.native.js';

/** Three option rows and the list's margin and padding: the Combobox leaf's budget. */
const BELOW = 152;
/** E1's observed editor: about 295 dp of scroller between the header and the pinned bar, keyboard up. */
const VIEWPORT = 295;

const layout = (y: number, height: number): LayoutChangeEvent =>
    ({ nativeEvent: { layout: { x: 0, y, width: 360, height } } }) as LayoutChangeEvent;

const field: RevealTarget = { measureLayout: () => undefined };
const scroller: RevealScroller = { getNativeScrollRef: () => null, scrollTo: () => undefined };

/** The host, with its visible area laid out at `viewport`. */
function host(viewport = VIEWPORT) {
    const rendered = renderHook(() => useFieldRevealHost({ current: scroller }));

    act(() => {
        rendered.result.current.onViewportLayout(layout(0, viewport));
    });

    return rendered;
}

/** Send a request and let its measurement answer. */
async function request(rendered: ReturnType<typeof host>): Promise<() => void> {
    let release: () => void = () => undefined;
    const ask: RevealRequest = { field, below: BELOW };

    await act(async () => {
        release = rendered.result.current.revealer(ask);
        await Promise.resolve();
    });

    return release;
}

/** Report the space's layout to the host. */
function layOutSpace(rendered: ReturnType<typeof host>, y: number): void {
    act(() => {
        rendered.result.current.spacer?.onLayout(layout(y, rendered.result.current.spacer.height));
    });
}

beforeEach(() => {
    seam.measures = [];
    seam.measured = 0;
    seam.scrolls = [];
    seam.reduceMotion = false;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useFieldRevealHost', () => {
    it('leaves a field that fits where it is: no space, no scroll', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 20, height: 48, offset: 0 }];

        await request(rendered);

        expect(seam.measured).toBe(1);
        expect(rendered.result.current.spacer).toBeNull();
        expect(seam.scrolls).toEqual([]);
    });

    it('makes room with the space, then scrolls ONCE to put the field at the top, 8 dp under it', async () => {
        const rendered = host();
        // The field near the end of the content: its top 240 dp down the visible area, 500 dp scrolled.
        seam.measures = [{ top: 240, height: 48, offset: 500 }];

        await request(rendered);
        // First frame: the space is laid out with nothing in it, so the host learns where it starts.
        expect(rendered.result.current.spacer?.height).toBe(0);
        layOutSpace(rendered, 900);
        expect(seam.scrolls).toEqual([]);

        // Then it is as tall as the scroll needs: the target, 732, plus the visible area, less where it starts.
        expect(rendered.result.current.spacer?.height).toBe(732 + VIEWPORT - 900);
        layOutSpace(rendered, 900);
        layOutSpace(rendered, 900);

        expect(seam.scrolls).toEqual([{ y: 732, animated: true }]);
    });

    it('shrinks the space by what the rows add above it, so the content end and the scroll stay put', async () => {
        const rendered = host();
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await request(rendered);
        layOutSpace(rendered, 900);
        layOutSpace(rendered, 900);

        // A list frame adds 50 dp of rows above the space.
        layOutSpace(rendered, 950);

        expect(rendered.result.current.spacer?.height).toBe(732 + VIEWPORT - 950);
        expect(seam.scrolls).toHaveLength(1);
    });

    it('scrolls at once when the content below the field is already long enough', async () => {
        const rendered = host();
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await request(rendered);

        layOutSpace(rendered, 2000);

        expect(rendered.result.current.spacer?.height).toBe(0);
        expect(seam.scrolls).toEqual([{ y: 732, animated: true }]);
    });

    it('on R7’s path, checks again when the keyboard shrinks the visible area, and scrolls once', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await request(rendered);
        expect(rendered.result.current.spacer).toBeNull();

        // The keyboard rises after the request; the avoider shrinks the scroller.
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, VIEWPORT));
            await Promise.resolve();
        });
        layOutSpace(rendered, 900);
        layOutSpace(rendered, 900);

        expect(seam.measured).toBe(2);
        expect(seam.scrolls).toEqual([{ y: 732, animated: true }]);
    });

    it('never checks again once revealed, whatever the visible area does (P2)', async () => {
        const rendered = host();
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await request(rendered);
        layOutSpace(rendered, 900);
        layOutSpace(rendered, 900);

        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, 400));
            await Promise.resolve();
        });

        expect(seam.measured).toBe(1);
        expect(seam.scrolls).toHaveLength(1);
    });

    it('does not check before the visible area is laid out', async () => {
        const rendered = renderHook(() => useFieldRevealHost({ current: scroller }));

        await act(async () => {
            rendered.result.current.revealer({ field, below: BELOW });
            await Promise.resolve();
        });

        expect(seam.measured).toBe(0);
    });

    it('removes the space when the list closes', async () => {
        const rendered = host();
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        const release = await request(rendered);
        expect(rendered.result.current.spacer).not.toBeNull();

        act(() => {
            release();
        });

        expect(rendered.result.current.spacer).toBeNull();
    });

    it.each([
        [true, false],
        [undefined, false],
    ] as const)('scrolls without animation while reduce motion is %s', async (reduceMotion, animated) => {
        seam.reduceMotion = reduceMotion;
        const rendered = host();
        seam.measures = [{ top: 240, height: 48, offset: 500 }];
        await request(rendered);

        layOutSpace(rendered, 2000);

        expect(seam.scrolls).toEqual([{ y: 732, animated }]);
    });

    it('hands every request the same revealer, so a field’s effect does not re-run on a host render', () => {
        const rendered = host();
        const first = rendered.result.current.revealer;

        rendered.rerender();

        expect(rendered.result.current.revealer).toBe(first);
    });
});
