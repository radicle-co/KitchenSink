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
    order: [] as string[],
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
        seam.order.push('scroll');
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
    const ask: RevealRequest = { field, below: BELOW, kind: 'list' };

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
    seam.order = [];
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
            rendered.result.current.revealer({ field, below: BELOW, kind: 'list' });
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

describe('useFieldRevealHost — an arrival (docs/design/uiOverhaul/ingredientArrival.md)', () => {
    /** The new row's top is this far over the field's top: a 60 dp row and a 28 dp label. */
    const ARRIVAL_ABOVE = 88;

    /** Send an arrival request and let its measurement answer. */
    async function arrive(rendered: ReturnType<typeof host>): Promise<() => void> {
        let release: () => void = () => undefined;

        await act(async () => {
            release = rendered.result.current.revealer({ field, kind: 'arrival', above: ARRIVAL_ABOVE });
            await Promise.resolve();
        });

        return release;
    }

    it('scrolls ONCE so the row and the field show together, and never lays out the blank space', async () => {
        const rendered = host();
        // The field's top is 250 dp down the visible area: the row's top is at 162 and the field's bottom at 298.
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await arrive(rendered);

        // 298 dp and its 8 dp gap end 11 dp past the 295 dp bottom edge.
        expect(seam.scrolls).toEqual([{ y: 511, animated: true }]);
        expect(rendered.result.current.spacer).toBeNull();
    });

    it('scrolls nothing when the row and the field already show', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await arrive(rendered);

        expect(seam.measured).toBe(1);
        expect(seam.scrolls).toEqual([]);
        expect(rendered.result.current.spacer).toBeNull();
    });

    it('a host render with a new scroller wrapper checks nothing: the cook scrolling away is not dragged back', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await arrive(rendered);

        // The cook scrolls on, so the row and the field no longer show; scrolling re-renders the host's owner, which
        // hands it a fresh `{ current }` object each time.
        seam.measures = [{ top: 900, height: 48, offset: 1150 }];
        await act(async () => {
            rendered.rerender();
            await Promise.resolve();
        });

        expect(seam.measured).toBe(1);
        expect(seam.scrolls).toEqual([]);
    });

    it('checks again when the keyboard shrinks the visible area, and scrolls once', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await arrive(rendered);
        expect(seam.scrolls).toEqual([]);

        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, VIEWPORT));
            await Promise.resolve();
        });

        expect(seam.measured).toBe(2);
        expect(seam.scrolls).toEqual([{ y: 511, animated: true }]);
    });

    it('never checks again once it has scrolled, whatever the visible area does', async () => {
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await arrive(rendered);

        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, 200));
            await Promise.resolve();
        });

        expect(seam.measured).toBe(1);
        expect(seam.scrolls).toHaveLength(1);
    });

    it('does not check before the visible area is laid out', async () => {
        const rendered = renderHook(() => useFieldRevealHost({ current: scroller }));

        await act(async () => {
            rendered.result.current.revealer({ field, kind: 'arrival', above: ARRIVAL_ABOVE });
            await Promise.resolve();
        });

        expect(seam.measured).toBe(0);
    });

    it('scrolls nothing for an arrival released before its measurement answers', async () => {
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await act(async () => {
            const release = rendered.result.current.revealer({
                field,
                kind: 'arrival',
                above: ARRIVAL_ABOVE,
            });

            release();
            await Promise.resolve();
        });

        expect(seam.scrolls).toEqual([]);
    });

    it.each([
        [false, true],
        [true, false],
        [undefined, false],
    ] as const)('with reduce motion %s, animates: %s', async (reduceMotion, animated) => {
        seam.reduceMotion = reduceMotion;
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await arrive(rendered);

        expect(seam.scrolls).toEqual([{ y: 511, animated }]);
    });

    it('does not disturb a list opening on the same host', async () => {
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await arrive(rendered);
        seam.measures = [{ top: 240, height: 48, offset: 511 }];

        await request(rendered);

        expect(rendered.result.current.spacer).not.toBeNull();
    });
});

describe('useFieldRevealHost — a focus (specSharedSystem.md §16.3)', () => {
    /** Send a focus request and let its measurement answer. */
    async function focusOn(rendered: ReturnType<typeof host>): Promise<() => void> {
        let release: () => void = () => undefined;

        await act(async () => {
            release = rendered.result.current.revealer({ kind: 'focus', field });
            await Promise.resolve();
        });

        return release;
    }

    /** Resize the visible area and let the re-check answer. */
    async function resize(rendered: ReturnType<typeof host>, height: number): Promise<void> {
        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, height));
            await Promise.resolve();
        });
    }

    it('a field that does not fit takes the smallest scroll that shows it, and lays out no space', async () => {
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await focusOn(rendered);

        // 298 dp and the 8 dp gap end 11 dp past the 295 dp bottom edge.
        expect(seam.scrolls).toEqual([{ y: 511, animated: true }]);
        expect(rendered.result.current.spacer).toBeNull();
    });

    it('a field that fits scrolls nothing', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await focusOn(rendered);

        expect(seam.measured).toBe(1);
        expect(seam.scrolls).toEqual([]);
    });

    it('stays armed: each shorter visible area (the keyboard, then the pinned footer) is checked, and the field ends inside the last', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        await focusOn(rendered);

        // The keyboard rises: 356 dp still fits in 400.
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        await resize(rendered, 400);
        expect(seam.scrolls).toEqual([]);

        // The footer pins: 356 dp does not fit in 324, so it scrolls the 32 dp it needs.
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        await resize(rendered, 324);

        expect(seam.measured).toBe(3);
        expect(seam.scrolls).toEqual([{ y: 132, animated: true }]);
    });

    it('scrolls again on a later shorter visible area, not just once', async () => {
        const rendered = host(350);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        await focusOn(rendered);
        seam.measures = [{ top: 280, height: 48, offset: 106 }];

        await resize(rendered, 324);

        expect(seam.scrolls).toEqual([
            { y: 106, animated: true },
            { y: 118, animated: true },
        ]);
    });

    it('does not check when the visible area gets taller', async () => {
        const rendered = host(324);
        seam.measures = [{ top: 100, height: 48, offset: 0 }];
        await focusOn(rendered);

        await resize(rendered, 600);

        expect(seam.measured).toBe(1);
    });

    it('does not check on a re-render, which is all a change of the content leaves the host', async () => {
        const rendered = host(324);
        seam.measures = [{ top: 100, height: 48, offset: 0 }];
        await focusOn(rendered);

        await act(async () => {
            rendered.rerender();
            await Promise.resolve();
        });

        expect(seam.measured).toBe(1);
    });

    it('is dropped while an arrival is pending', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await act(async () => {
            rendered.result.current.revealer({ kind: 'arrival', field, above: 88 });
            await Promise.resolve();
        });
        expect(seam.measured).toBe(1);

        await focusOn(rendered);

        expect(seam.measured).toBe(1);
    });

    it('is replaced by an arrival, which scrolls once and leaves nothing holding the field', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await focusOn(rendered);
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await act(async () => {
            rendered.result.current.revealer({ kind: 'arrival', field, above: 88 });
            await Promise.resolve();
        });
        expect(seam.measured).toBe(2);

        seam.measures = [{ top: 250, height: 48, offset: 500 }];
        await resize(rendered, VIEWPORT);

        // The arrival's check at the shorter area scrolls, and then nothing holds the field any more.
        expect(seam.scrolls).toEqual([{ y: 511, animated: true }]);
        expect(seam.measured).toBe(3);
        await resize(rendered, 200);
        expect(seam.measured).toBe(3);
    });

    it('is skipped while a list is armed, and checked once the list closes', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 20, height: 48, offset: 0 }];
        const releaseList = await request(rendered);
        expect(seam.measured).toBe(1);

        await focusOn(rendered);
        expect(seam.measured).toBe(1);

        seam.measures = [{ top: 20, height: 48, offset: 0 }];
        await act(async () => {
            releaseList();
            await Promise.resolve();
        });

        expect(seam.measured).toBe(2);
    });

    it('a release cancels a check still measuring', async () => {
        const rendered = host();
        seam.measures = [{ top: 250, height: 48, offset: 500 }];

        await act(async () => {
            const release = rendered.result.current.revealer({ kind: 'focus', field });

            release();
            await Promise.resolve();
        });

        expect(seam.scrolls).toEqual([]);
    });

    it('checks nothing once released, whatever the visible area does', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 100, height: 48, offset: 0 }];
        const release = await focusOn(rendered);

        act(() => {
            release();
        });
        await resize(rendered, 324);

        expect(seam.measured).toBe(1);
    });

    it('does not check before the visible area is laid out', async () => {
        const rendered = renderHook(() => useFieldRevealHost({ current: scroller }));

        await act(async () => {
            rendered.result.current.revealer({ kind: 'focus', field });
            await Promise.resolve();
        });

        expect(seam.measured).toBe(0);
    });
});

describe('useFieldRevealHost — a target (specSharedSystem.md §16.3)', () => {
    /** Send a target request, recording `onShown` in the order of the scrolls. */
    async function aim(rendered: Pick<ReturnType<typeof host>, 'result'>): Promise<() => void> {
        let release: () => void = () => undefined;

        await act(async () => {
            release = rendered.result.current.revealer({
                kind: 'target',
                field,
                onShown: () => {
                    seam.order.push('shown');
                },
            });
            await Promise.resolve();
        });

        return release;
    }

    it('scrolls the field to the middle of the visible area, then tells it it was shown', async () => {
        const rendered = host(400);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];

        await aim(rendered);

        expect(seam.scrolls).toEqual([{ y: 224, animated: true }]);
        expect(seam.order).toEqual(['scroll', 'shown']);
        expect(rendered.result.current.spacer).toBeNull();
    });

    it.each([
        [false, true],
        [true, false],
        [undefined, false],
    ] as const)('with reduce motion %s, animates: %s', async (reduceMotion, animated) => {
        seam.reduceMotion = reduceMotion;
        const rendered = host(400);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];

        await aim(rendered);

        expect(seam.scrolls).toEqual([{ y: 224, animated }]);
    });

    it('tells the field it was shown even when nothing needs to scroll', async () => {
        const rendered = host(400);
        seam.measures = [{ top: 176, height: 48, offset: 100 }];

        await aim(rendered);

        expect(seam.scrolls).toEqual([]);
        expect(seam.order).toEqual(['shown']);
    });

    it('tells the field it was shown even when its place cannot be measured', async () => {
        const rendered = host(400);
        seam.measures = [null];

        await aim(rendered);

        expect(seam.scrolls).toEqual([]);
        expect(seam.order).toEqual(['shown']);
    });

    it('shows it once: a later change of the visible area measures nothing', async () => {
        const rendered = host(400);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        await aim(rendered);

        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, 300));
            await Promise.resolve();
        });

        expect(seam.measured).toBe(1);
        expect(seam.order).toEqual(['scroll', 'shown']);
    });

    it('waits for the visible area to be laid out', async () => {
        const rendered = renderHook(() => useFieldRevealHost({ current: scroller }));
        seam.measures = [{ top: 300, height: 48, offset: 100 }];

        await aim(rendered);
        expect(seam.measured).toBe(0);
        expect(seam.order).toEqual([]);

        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, 400));
            await Promise.resolve();
        });

        expect(seam.order).toEqual(['scroll', 'shown']);
    });

    it('a newer target replaces an older one, which is never shown', async () => {
        const rendered = host(400);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        const first = vi.fn();
        const second = vi.fn();

        await act(async () => {
            rendered.result.current.revealer({ kind: 'target', field, onShown: first });
            rendered.result.current.revealer({ kind: 'target', field, onShown: second });
            await Promise.resolve();
        });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
    });

    it('a release cancels a target still measuring', async () => {
        const rendered = host(400);
        seam.measures = [{ top: 300, height: 48, offset: 100 }];
        const onShown = vi.fn();

        await act(async () => {
            const release = rendered.result.current.revealer({ kind: 'target', field, onShown });

            release();
            await Promise.resolve();
        });

        expect(onShown).not.toHaveBeenCalled();
        expect(seam.scrolls).toEqual([]);
    });

    it('clears a held focus, so the focus check does not undo the centring', async () => {
        const rendered = host(600);
        seam.measures = [{ top: 100, height: 48, offset: 0 }];
        await act(async () => {
            rendered.result.current.revealer({ kind: 'focus', field });
            await Promise.resolve();
        });
        seam.measures = [{ top: 300, height: 48, offset: 0 }];
        await aim(rendered);
        const measured = seam.measured;

        await act(async () => {
            rendered.result.current.onViewportLayout(layout(0, 324));
            await Promise.resolve();
        });

        expect(seam.measured).toBe(measured);
    });
});
