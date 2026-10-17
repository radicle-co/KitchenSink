import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';

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
 * react-native-web reports layout through the view's layout handler and emits `scroll` on a 32 ms throttle, so a test
 * lays the views out by calling the handler and moves the clock between two scrolls. The chevron's opacity is read
 * from its computed style: the OS reduce-motion preference is still unknown during these tests, which the design
 * defines as an instant change.
 */

const FADE = '[data-commise-stub="linear-gradient"]';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The OS preference is read asynchronously; a promise that never settles keeps it unknown, which is instant motion.
    vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(undefined as never);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

/** Report a laid-out size to a view, the way react-native-web's ResizeObserver does. */
function layOut(element: Element, width: number): void {
    const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

    if (handler === undefined) {
        throw new Error('the view has no layout handler');
    }

    act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } }));
}

/** The views of a rendered scroller that report their size: the scroller, then the content inside it. */
function measured(container: HTMLElement): readonly Element[] {
    return [...container.querySelectorAll('*')].filter(
        (node) => (node as Element & { __reactLayoutHandler?: unknown }).__reactLayoutHandler !== undefined,
    );
}

function mount(props: Partial<HorizontalScrollerProps> = {}, sizes: readonly [number, number] | null = [300, 640]) {
    const result = render(
        <HorizontalScroller {...props}>
            <View>
                <Text>One</Text>
            </View>
        </HorizontalScroller>,
    );
    const [scroller, content] = measured(result.container);

    if (sizes !== null) {
        layOut(scroller as Element, sizes[0]);
        layOut(content as Element, sizes[1]);
    }

    return { ...result, scroller: scroller as HTMLElement };
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

    it('shows the chevron on a 40 dp band at the start of a scroller that overflows', () => {
        const { container } = mount();
        const fade = container.querySelector<HTMLElement>(FADE);

        expect(chevronOpacity(container)).toBe('1');
        expect(getComputedStyle(fade?.parentElement as HTMLElement).width).toBe('40px');
    });

    it('hides the chevron on the first scroll and narrows the fade to 24 dp while more lies ahead', () => {
        const { container, scroller } = mount();

        scrollTo(scroller, 5);

        expect(chevronOpacity(container)).toBe('0');
        expect(getComputedStyle(container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement).width).toBe(
            '24px',
        );
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

    it('measures again when the content grows', () => {
        const { container, scroller } = mount({}, [400, 240]);
        const content = measured(container)[1] as Element;

        expect(chevronOpacity(container)).toBe('0');
        expect(scroller).toBeTruthy();

        layOut(content, 900);

        expect(chevronOpacity(container)).toBe('1');
    });

    it('is decorative and takes no touch', () => {
        const { container } = mount();
        const chevron = chevronOf(container) as HTMLElement;
        const fadeBox = container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement;

        for (const node of [chevron, fadeBox]) {
            expect(node.getAttribute('aria-hidden')).toBe('true');
            expect(getComputedStyle(node).pointerEvents).toBe('none');
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
