import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';

import { scrollViewSizes, stubBoundingRects } from '../../testing/boundingRects.js';
import { render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { role } from '../../tokens/colors.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { HorizontalScroller } from '../HorizontalScroller.native.js';
import type { HorizontalScrollerProps } from '../props.js';
import type { ScrollExtent } from '../scrollHint.js';

/**
 * The native `HorizontalScroller` (`docs/design/uiOverhaul/horizontalScrollHint.md` §3-§4), rendered through
 * react-native-web: the native indicator is left to the platform, a chevron shows only while the content overflows and
 * the scroller rests at its start, and a gradient to the surface colour shows while more lies ahead.
 *
 * The scroller is a Tamagui `ScrollView`, whose web build reports a view's size once, at mount, from
 * `getBoundingClientRect`: a test states the three sizes with `stubBoundingRects` before it renders (the box around the
 * scroller and the chevron's column, the scroller, its content). A size cannot change after mount, so a test that needs
 * another size renders again. The chevron's opacity is read from its computed style: the OS reduce-motion preference is
 * still unknown during these tests, which the design defines as an instant change.
 */

const FADE = '[data-commise-stub="linear-gradient"]';

beforeEach(() => {
    // A click makes the scroll view report a scroll 100 ms later, on a timer. Faked, it is flushed in afterEach, so it
    // cannot fire after the environment is gone.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    // The OS preference is read asynchronously; a promise that never settles keeps it unknown, which is instant motion.
    vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(undefined as never);
});

afterEach(() => {
    act(() => {
        vi.runOnlyPendingTimers();
    });
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

let restoreRects: (() => void) | undefined;

afterEach(() => {
    restoreRects?.();
    restoreRects = undefined;
});

function mount(
    props: Partial<HorizontalScrollerProps> = {},
    sizes: readonly [number, number] | null = [300, 640],
    // The box around the scroller and the chevron's column; by default as wide as the scroller, i.e. no column yet.
    outer: number | undefined = undefined,
) {
    if (sizes !== null) {
        restoreRects = stubBoundingRects(
            scrollViewSizes({ scroller: sizes[0], content: sizes[1], box: outer ?? sizes[0] }),
        );
    }

    const result = render(
        <HorizontalScroller {...props}>
            <View>
                <Text>One</Text>
            </View>
        </HorizontalScroller>,
    );

    return { ...result, scroller: result.container.querySelector<HTMLElement>('[style*="overflow-x"]') as HTMLElement };
}

/** Scroll the native scroller to `x`, past the emit throttle of the one before. */
function scrollTo(scroller: HTMLElement, x: number): void {
    vi.setSystemTime(Date.now() + 100);
    scroller.scrollLeft = x;
    fireEvent.scroll(scroller);
}

/** The chevron: the opacity-driven view around the right-pointing glyph. */
function chevronOf(container: HTMLElement): HTMLElement | undefined {
    const glyph = container.querySelector('[data-commise-stub="icon"][data-icon-name="chevron-right"]');

    return glyph?.closest<HTMLElement>('[style*="opacity"]') ?? undefined;
}

/** The Tamagui frame around the chevron: it owns the 24 dp column, and the opacity view inside it owns the fade. */
const columnOf = (container: HTMLElement): HTMLElement => chevronOf(container)?.parentElement as HTMLElement;

const chevronOpacity = (container: HTMLElement): string => {
    const chevron = chevronOf(container);

    if (chevron === undefined) {
        throw new Error('no chevron rendered');
    }

    return getComputedStyle(chevron).opacity;
};

describe('HorizontalScroller (native) — the chevron and the fade', () => {
    it('shows nothing before it knows the content is wider than the box', () => {
        const { container } = mount({}, null);

        expect(chevronOpacity(container)).toBe('0');
        expect(container.querySelector(FADE)).toBeNull();
    });

    it('shows nothing when everything fits', () => {
        const { container } = mount({}, [400, 240]);

        expect(chevronOpacity(container)).toBe('0');
        expect(container.querySelector(FADE)).toBeNull();
    });

    it('shows the chevron at the start of a scroller that overflows, over the same 16 dp fade the scroller always has', () => {
        const { container } = mount();
        const fade = container.querySelector<HTMLElement>(FADE);

        expect(chevronOpacity(container)).toBe('1');
        expect(resolvedStyle(fade?.parentElement as HTMLElement, 'width')).toBe('16px');
    });

    // The chevron sits in a column of its own beside the scroller (`horizontalScrollHint.md` §3.6): drawn over the
    // scroller on a solid 24 dp band it hid the last characters of the chip at the edge.
    it('puts the chevron in a 24 dp column beside the scroller, not over it, while the content overflows', () => {
        const { container } = mount({}, [276, 640], 300);
        const column = columnOf(container);

        expect(resolvedStyle(column, 'position')).not.toBe('absolute');
        expect(resolvedStyle(column, 'display')).not.toBe('none');
        expect(resolvedStyle(column, 'width')).toBe('24px');
    });

    it('keeps the column through a scroll, so nothing reflows when the chevron fades', () => {
        const { container, scroller } = mount({}, [276, 640], 300);

        scrollTo(scroller, 5);

        expect(chevronOpacity(container)).toBe('0');
        expect(resolvedStyle(columnOf(container), 'display')).not.toBe('none');
        expect(resolvedStyle(container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement, 'width')).toBe(
            '16px',
        );
    });

    it('takes no room while the content fits, though the scroller is as narrow as a column would leave it', () => {
        // 280 fits the 300 box; read against the 276 scroller it would overflow and the column would flip on and off.
        const { container } = mount({}, [276, 280], 300);

        expect(resolvedStyle(columnOf(container), 'display')).toBe('none');
        expect(chevronOpacity(container)).toBe('0');
        expect(container.querySelector(FADE)).toBeNull();
    });

    it('shows neither at the end, and both again back at the start', () => {
        const { container, scroller } = mount();

        scrollTo(scroller, 340);
        expect(chevronOpacity(container)).toBe('0');
        expect(container.querySelector(FADE)).toBeNull();

        scrollTo(scroller, 0);
        expect(chevronOpacity(container)).toBe('1');
        expect(container.querySelector(FADE)).not.toBeNull();
    });

    it('treats an iOS bounce past the start as still being at the start', () => {
        const { container, scroller } = mount();

        scrollTo(scroller, -30);

        expect(chevronOpacity(container)).toBe('1');
    });

    it('is decorative and takes no touch', () => {
        const { container } = mount();
        const chevron = chevronOf(container) as HTMLElement;
        const fadeBox = container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement;

        for (const node of [chevron, fadeBox]) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
            expect(resolvedStyle(node.closest('[aria-hidden="true"]') as HTMLElement, 'pointerEvents')).toBe('none');
        }
    });

    it.each([
        ['canvas', undefined, role.canvas],
        ['overlay', 'overlay', role.paperOverlay],
        ['bar', 'bar', role.paper],
    ] as const)('fades into the %s surface behind it', (_name, surface, colour) => {
        const { container } = mount(surface === undefined ? {} : { surface });

        expect(container.querySelector<HTMLElement>(FADE)?.dataset['colors']?.endsWith(`|${colour}`)).toBe(true);
    });
});

describe('HorizontalScroller (native) — position and the platform’s own indicator', () => {
    it('reports its extent when measured and again only when a boundary flips', () => {
        const onPosition = vi.fn<(extent: ScrollExtent) => void>();
        const { scroller } = mount({ onPosition });

        expect(onPosition).toHaveBeenLastCalledWith({ measured: true, overflows: true, atStart: true, atEnd: false });
        const calls = onPosition.mock.calls.length;

        scrollTo(scroller, 50);
        expect(onPosition).toHaveBeenCalledTimes(calls + 1);

        scrollTo(scroller, 150);
        scrollTo(scroller, 200);
        expect(onPosition).toHaveBeenCalledTimes(calls + 1);

        scrollTo(scroller, 340);
        expect(onPosition).toHaveBeenLastCalledWith({ measured: true, overflows: true, atStart: false, atEnd: true });
    });

    it('does not hide the platform’s scroll indicator', () => {
        const { scroller } = mount();

        // react-native-web marks a ScrollView whose indicator is switched off with a `scrollbarWidth` class.
        expect(scroller.className).not.toMatch(/scrollbarWidth/u);
    });

    it('is a named region only when it is given a name', () => {
        mount({ regionLabel: 'Trending recipes' });

        expect(screen.getByRole('region', { name: 'Trending recipes' })).toBeTruthy();
    });
});

/** The chevron fades over 150 ms, and not at all while the OS asks for reduced motion. */
describe('HorizontalScroller (native) — motion', () => {
    const settle = async (): Promise<void> => {
        await act(async () => {
            await Promise.resolve();
        });
    };

    it('animates the chevron over 150 ms when motion is allowed', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const timing = vi.spyOn(Animated, 'timing');
        mount();
        await settle();

        expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 150 }));
    });

    it('starts no animation under reduced motion, and the chevron is simply there', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const timing = vi.spyOn(Animated, 'timing');
        const { container } = mount();
        await settle();

        expect(timing).not.toHaveBeenCalled();
        expect(chevronOpacity(container)).toBe('1');
    });
});
