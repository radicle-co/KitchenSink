/**
 * Android crashed on every open of the Recipes tab with "Maximum update depth exceeded", in the COMMIT phase of a
 * synchronous render: something sets state on every commit. The frame, the list and the host each hold state fed by
 * layout reports, so this mounts the whole Recipes list as the screen composes it, under a real `ScrollHost`, and hands
 * EVERY layout-aware node a report. A report that repeats what the node already said must cost no commit at all, and
 * so must one that differs only by sub-pixel noise, however often the platform sends it (Android does both).
 *
 * jsdom has no Fabric and no native driver, so this pins the JS side of the loop: state that changes without a new
 * fact. Whether the Animated attach also loops on a device is for the device pass.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { ScrollHost } from '@commise/ui/scroll-host';
import { render } from '@commise/ui/testing/tamagui';
import { act, cleanup } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import type { RecipeListResultsProps } from '../model.js';
import { RecipeListFrame } from '../RecipeListFrame.native.js';
import { RecipeListResults } from '../RecipeListResults.native.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: 390, height: 800 }) };
});

afterEach(cleanup);

const noop = () => undefined;

const results: RecipeListResultsProps = {
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
    facets: {
        facets: [{ value: 'quick', label: 'Under 30 min', count: 1, selected: false }],
        onToggle: noop,
        onClear: noop,
    },
    view: { mode: 'list', onChange: noop },
    sort: { value: 'updatedAt', onChange: noop },
};

type LaidOut = HTMLElement & { __reactLayoutHandler?: (event: unknown) => void };

/** Every node in the document that took a layout handler (react-native-web keeps it as `__reactLayoutHandler`). */
function laidOutNodes(): LaidOut[] {
    return [...document.querySelectorAll<HTMLElement>('*')].filter(
        (node): node is LaidOut => '__reactLayoutHandler' in node,
    );
}

/** Tell every layout-aware node its box, as the platform does; `wobble` is sub-pixel noise on the numbers. */
function reportAll(wobble = 0): void {
    act(() => {
        laidOutNodes().forEach((node, index) =>
            node.__reactLayoutHandler?.({
                nativeEvent: { layout: { x: 16 + wobble, y: index * 24 + wobble, width: 358 + wobble, height: 48 } },
            }),
        );
    });
}

function mount(onRender: () => void, withChips = false) {
    return render(
        <LocaleProvider locale="en">
            <Profiler id="recipes" onRender={onRender}>
                <ScrollHost>
                    {(bind) => (
                        <RecipeListFrame
                            searchValue=""
                            onSearchChange={noop}
                            searchVisible
                            onCreateRecipe={noop}
                            createEntryYields={false}
                            headingFocusSignal={0}
                            segments={{
                                current: 'mine',
                                href: { mine: '/en/recipes', collections: '/en/collections' },
                                onSelect: noop,
                            }}
                        >
                            <RecipeListResults
                                {...results}
                                facets={withChips ? results.facets : { ...results.facets, facets: [] }}
                                scrollBind={bind}
                            />
                        </RecipeListFrame>
                    )}
                </ScrollHost>
            </Profiler>
        </LocaleProvider>,
    );
}

describe('the Recipes list (native) — layout reports that say nothing new cost no commit', () => {
    it('settles after the first reports, then ignores the same reports however often they repeat', () => {
        const onRender = vi.fn();
        mount(onRender);

        // The first reports are news: they may cascade a few commits (the field's height sizes the spacer, and so on).
        for (let pass = 0; pass < 4; pass += 1) {
            reportAll();
        }

        const settled = onRender.mock.calls.length;

        for (let again = 0; again < 25; again += 1) {
            reportAll();
        }

        expect(onRender.mock.calls.length).toBe(settled);
    });

    it('ignores sub-pixel wobble in repeated reports too (frame, host, list)', () => {
        const onRender = vi.fn();
        mount(onRender);

        for (let pass = 0; pass < 4; pass += 1) {
            reportAll();
        }

        const settled = onRender.mock.calls.length;

        for (const wobble of [0.0004, -0.0003, 0.0002, -0.0004, 0.0001]) {
            reportAll(wobble);
        }

        expect(onRender.mock.calls.length).toBe(settled);
    });

    it('ignores sub-pixel wobble in the chip row too', () => {
        const onRender = vi.fn();
        mount(onRender, true);

        for (let pass = 0; pass < 4; pass += 1) {
            reportAll();
        }

        const settled = onRender.mock.calls.length;

        for (const wobble of [0.0004, -0.0003, 0.0002, -0.0004, 0.0001]) {
            reportAll(wobble);
        }

        expect(onRender.mock.calls.length).toBe(settled);
    });

    it('settles within a small bounded number of commits from mount, never growing with the reports', () => {
        const onRender = vi.fn();
        mount(onRender);

        for (let pass = 0; pass < 10; pass += 1) {
            reportAll();
        }

        expect(onRender.mock.calls.length).toBeLessThan(40);
    });
});
