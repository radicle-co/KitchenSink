/**
 * The native ScrollHost (A7): ONE scroller takes `bind`; `scrollToTop` moves it (animated, or instant under Reduce
 * Motion) whichever kind it is; `condensed` flips once the heading's bottom scrolls past the top; the direction and the
 * top follow the scroll; `handle` is the same scroller React Navigation's `useScrollToTop` reads; and reading the host
 * outside one is a loud wiring error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Text } from 'react-native';

const motion = vi.hoisted(() => ({ reduce: false }));

vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => motion.reduce }));

import type { ScrollBind, ScrollHostApi, ScrollReport } from '../props.js';
import { ScrollHost } from '../ScrollHost.native.js';
import { useScrollHost } from '../scrollHostContext.js';

afterEach(() => {
    cleanup();
    motion.reduce = false;
});

const report = (y: number, viewport = 800, content = 4000): ScrollReport => ({
    nativeEvent: {
        contentOffset: { y },
        layoutMeasurement: { height: viewport },
        contentSize: { height: content },
    },
});

/** Render a host whose child captures `bind` and the API. */
function renderHost(sections?: readonly string[]): { bind: () => ScrollBind; api: () => ScrollHostApi } {
    const seen: { bind?: ScrollBind; api?: ScrollHostApi } = {};

    const Probe = (): null => {
        seen.api = useScrollHost();

        return null;
    };

    render(
        <ScrollHost {...(sections === undefined ? {} : { sections })}>
            {(bind) => {
                seen.bind = bind;

                return <Probe />;
            }}
        </ScrollHost>,
    );

    return {
        bind: () => {
            if (seen.bind === undefined) {
                throw new Error('no bind');
            }

            return seen.bind;
        },
        api: () => {
            if (seen.api === undefined) {
                throw new Error('no api');
            }

            return seen.api;
        },
    };
}

describe('ScrollHost (native)', () => {
    it('hands the scroller one bind: a ref, a scroll handler, and a 16 ms throttle', () => {
        const { bind } = renderHost();

        expect(bind().scrollEventThrottle).toBe(16);
        expect(typeof bind().ref).toBe('function');
        expect(typeof bind().onScroll).toBe('function');
    });

    it('scrolls a ScrollView to the top, animated', () => {
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        api().scrollToTop();

        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    });

    it('scrolls a FlatList or FlashList to the top through scrollToOffset', () => {
        const { bind, api } = renderHost();
        const list = { scrollToOffset: vi.fn() };
        act(() => bind().ref(list));

        api().scrollToTop();

        expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    });

    it('jumps instantly under Reduce Motion', () => {
        motion.reduce = true;
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        api().scrollToTop();

        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    });

    it('exposes the SAME scroller as the handle, so the one scroller has one handle', () => {
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        expect(api().handle.current).toBe(scrollView);
    });

    it('condenses once the heading’s bottom scrolls past the top, and not before', () => {
        const { bind, api } = renderHost();

        act(() => api().headingLayout({ nativeEvent: { layout: { y: 44, height: 40 } } }));
        act(() => bind().onScroll(report(83)));
        expect(api().condensed).toBe(false);

        act(() => bind().onScroll(report(84)));
        expect(api().condensed).toBe(true);
    });

    it('follows the direction and the top', () => {
        const { bind, api } = renderHost();

        expect(api().atTop).toBe(true);
        act(() => bind().onScroll(report(300)));
        expect(api().scrollingDown).toBe(true);
        expect(api().atTop).toBe(false);

        act(() => bind().onScroll(report(100)));
        expect(api().scrollingDown).toBe(false);
    });

    it('reports the current section from each section’s layout, and scrolls a section to the line', () => {
        const { bind, api } = renderHost(['details', 'ingredients']);
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => bind().onScroll(report(600)));

        expect(api().current).toBe('ingredients');

        api().scrollToSection('ingredients');
        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 500, animated: true });
    });

    // A jump holds the section it named until the cook drags again, even when the page is too short for that section
    // to reach the line; the jump's own `scrollTo` reports scrolls but never a drag.
    it('holds a jumped-to section through the jump’s own scroll, and a drag of the cook’s releases it', () => {
        const { bind, api } = renderHost(['details', 'ingredients', 'steps']);
        act(() => bind().ref({ scrollTo: vi.fn() }));
        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => api().sectionLayout('steps')({ nativeEvent: { layout: { y: 1400, height: 200 } } }));
        act(() => bind().onScroll(report(600)));
        expect(api().current).toBe('ingredients');

        act(() => api().scrollToSection('steps'));
        expect(api().current).toBe('steps');

        // The page is too short for steps to reach the line: the jump stops at 700, where the spy alone names
        // ingredients.
        act(() => bind().onScroll(report(700, 800, 1600)));
        expect(api().current).toBe('steps');

        act(() => bind().onScrollBeginDrag());
        act(() => bind().onScroll(report(600, 800, 1600)));
        expect(api().current).toBe('ingredients');
    });

    // A deep link jumps on mount, before any section has reported its layout (Home's Paste ingredients opens the
    // editor at Ingredients): the jump waits for that section's layout, then lands once.
    it('a jump asked for before its section is laid out lands when the section reports its layout', () => {
        const { bind, api } = renderHost(['details', 'ingredients']);
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        act(() => api().scrollToSection('ingredients'));
        expect(scrollView.scrollTo).not.toHaveBeenCalled();
        expect(api().current).toBe('ingredients');

        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        expect(scrollView.scrollTo).not.toHaveBeenCalled();
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        expect(scrollView.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 500, animated: true });

        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 520, height: 900 } } }));
        expect(scrollView.scrollTo).toHaveBeenCalledTimes(1);
    });

    it('throws when read outside a host: a floating button with no scroller is a wiring defect', () => {
        const Orphan = (): null => {
            useScrollHost();

            return null;
        };

        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<Orphan />)).toThrow(/ScrollHost/);
        spy.mockRestore();
    });

    it('renders plain children too', () => {
        const { getByText } = render(
            <ScrollHost>
                <Text>plain</Text>
            </ScrollHost>,
        );

        expect(getByText('plain')).toBeTruthy();
    });
});
