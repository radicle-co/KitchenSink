/**
 * The Recipes list reads the host's scroll offset with a native-driven event, WITHOUT an Animated wrapper around FlashList.
 *
 * `Animated.createAnimatedComponent(FlashList)` (`AnimatedFlashList`) threw "Maximum update depth exceeded" on both
 * platforms, the stack starting `at FlashList ... at Animated(Anonymous)`: the wrapper re-renders FlashList on its forced
 * updates and FlashList answers each with a layout-phase state update. FlashList already renders its scroller through
 * `Animated.createAnimatedComponent`, and lets a screen supply it with `renderScrollComponent`, so the list stays a plain
 * `FlashList`, keeps its own `onScroll` handler, and gives it an Animated scroll view whose event is attached natively:
 * the host's `scrollY` is fed by `Animated.event(..., { useNativeDriver: true, listener })`, with FlashList's own handler
 * as the listener, so recycling and the host's JS handler (`bind.onScroll`, called by FlashList) run exactly as before.
 *
 * jsdom has no native driver or Fabric, so this pins the wiring (which component, which handlers, which identities). The
 * native attach and the absence of the loop are for the device pass.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import { fireScrollAndSettle, render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import type { Animated as AnimatedType } from 'react-native';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({ plain: [] as Record<string, unknown>[], animated: 0 }));

vi.mock('@shopify/flash-list', () => ({
    FlashList: (props: Record<string, unknown>) => {
        rendered.plain.push(props);

        return null;
    },
    AnimatedFlashList: () => {
        rendered.animated += 1;

        return null;
    },
}));

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { HostAnimatedScroll } from '../HostAnimatedScroll.native.js';
import type { RecipeListResultsProps } from '../model.js';
import { RecipeListResults } from '../RecipeListResults.native.js';

afterEach(() => {
    cleanup();
    rendered.plain = [];
    rendered.animated = 0;
});

const noop = () => undefined;

const props: RecipeListResultsProps = {
    recipes: [makeRecipeListItem({ id: 'rec_1', title: 'Gourmet Garden Salad' })],
    state: 'results',
    searchValue: '',
    onClearSearch: noop,
    onClearFilters: noop,
    clearCount: 0,
    onSelectRecipe: noop,
    onCreateRecipe: noop,
    variant: 'row',
    chipOverflow: 'scroll',
    facets: { facets: [], onToggle: noop, onClear: noop },
    view: { mode: 'list', onChange: noop },
    sort: { value: 'updatedAt', onChange: noop },
};

const bind: ScrollBind = {
    ref: noop,
    onScroll: vi.fn(),
    onScrollBeginDrag: noop,
    onMomentumScrollEnd: noop,
    scrollEventThrottle: 16,
};

describe('RecipeListResults (native) — a plain FlashList over an Animated scroll view', () => {
    function draw(): void {
        render(
            <LocaleProvider locale="en">
                <RecipeListResults {...props} scrollBind={bind} />
            </LocaleProvider>,
        );
    }

    it('draws the plain FlashList, never the Animated wrapper', () => {
        draw();

        expect(rendered.plain.length).toBeGreaterThan(0);
        expect(rendered.animated).toBe(0);
    });

    it('gives FlashList the host’s PLAIN handler, which it calls itself, and the host’s other handlers', () => {
        draw();
        const list = rendered.plain.at(-1);

        expect(list?.['onScroll']).toBe(bind.onScroll);
        expect(list?.['onScrollBeginDrag']).toBe(bind.onScrollBeginDrag);
        expect(list?.['onMomentumScrollEnd']).toBe(bind.onMomentumScrollEnd);
    });

    it('supplies the scroller through renderScrollComponent, with the SAME function on every render', () => {
        draw();
        const first = rendered.plain.at(-1)?.['renderScrollComponent'];
        cleanup();
        draw();

        expect(first).toBe(HostAnimatedScroll);
        expect(rendered.plain.at(-1)?.['renderScrollComponent']).toBe(first);
    });
});

describe('HostAnimatedScroll — the scroller FlashList renders, with the host’s offset attached', () => {
    function underHost(
        onScroll: (event: unknown) => void,
        onHost: (scrollY: AnimatedType.Value) => void,
    ): ReactElement {
        function Probe(): null {
            const scrollY = useScrollHost().scrollY;

            if (scrollY !== undefined) {
                onHost(scrollY);
            }

            return null;
        }

        return (
            <ScrollHost>
                {() => (
                    <>
                        <Probe />
                        <HostAnimatedScroll onScroll={onScroll} accessibilityLabel="list" />
                    </>
                )}
            </ScrollHost>
        );
    }

    it('feeds the host’s scrollY from the scroll event, and still calls the handler FlashList gave it', () => {
        const flashListHandler = vi.fn();
        const seen: { scrollY?: AnimatedType.Value } = {};

        render(
            underHost(flashListHandler, (scrollY) => {
                seen.scrollY = scrollY;
            }),
        );
        const scroller = screen.getByLabelText('list');
        const values: number[] = [];

        seen.scrollY?.addListener(({ value }) => values.push(value));
        fireScrollAndSettle(scroller, { target: { scrollTop: 120 } });

        expect(flashListHandler).toHaveBeenCalled();
        expect(values.at(-1)).toBe(120);
    });

    it('is just a scroll view, passing the handler through, when no ScrollHost is above', () => {
        const flashListHandler = vi.fn();

        render(<HostAnimatedScroll onScroll={flashListHandler} accessibilityLabel="list" />);
        fireScrollAndSettle(screen.getByLabelText('list'), { target: { scrollTop: 40 } });

        expect(flashListHandler).toHaveBeenCalled();
    });
});
