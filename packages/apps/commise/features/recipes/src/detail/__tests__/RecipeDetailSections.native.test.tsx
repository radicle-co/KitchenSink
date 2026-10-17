/**
 * Native recipe page: the section switch, the structure it needs, and what the strip and the hint do at a phone's
 * width (A-013, A-024, A-028 d, D1, D6, D8). react-native-web under jsdom.
 *
 * jsdom has no scroll layout, so what is asserted is the CONTRACT React Native's sticky header relies on, not the
 * pixels: `stickyHeaderIndices` names a DIRECT child of the scroller's content (a header wrapped in a `View` with the
 * rest of the page cannot stick), and each section is a direct child too, because `onLayout` y is relative to the
 * parent and the scroll spy reads it (`ui/src/scrollHost/props.ts`).
 */
import { createElement, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render as renderUnscoped, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const { detail } = recipeMessages.en;

/** The window the page measures, and every props bag the page's scroller was rendered with. */
const device = vi.hoisted(() => ({ width: 390, fontScale: 1 }));
const scrollers = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({
            ...actual.Dimensions.get('window'),
            width: device.width,
            fontScale: device.fontScale,
        }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        // A marker around every ScrollView, so a test can find the page's scroller and read the props it was given.
        ScrollView: (props: Record<string, unknown>) => {
            scrollers.props.push(props);

            return createElement('div', { 'data-scroll-root': '' }, createElement(actual.ScrollView, props as never));
        },
    };
});

const render = (ui: ReactElement) => renderUnscoped(ui, { wrapper: CookMarksTestProvider });

beforeEach(() => {
    device.width = 390;
    device.fontScale = 1;
    scrollers.props.length = 0;
    resetServingScale();
});

afterEach(cleanup);

/** The page's scroller: the first ScrollView rendered, the outermost. */
function pageScroller(): { readonly content: HTMLElement; readonly props: Record<string, unknown> } {
    const root = document.querySelector('[data-scroll-root]') as HTMLElement;
    const scrollView = root.firstElementChild as HTMLElement;

    return { content: scrollView.firstElementChild as HTMLElement, props: scrollers.props[0] as never };
}

/** The index of the content's direct child that holds `node`. */
function childIndexHolding(content: HTMLElement, node: HTMLElement): number {
    return Array.from(content.children).findIndex((child) => child.contains(node));
}

const view = (recipe = makeRecipeDetail()): ReactElement => (
    <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={recipe} />
);

describe('RecipeDetailView (native) — below a 720 pt body (A-013, D1)', () => {
    it('draws the section switch, naming the three sections', () => {
        render(view());

        const nav = screen.getByRole('navigation', { name: detail.sectionsLabel });

        for (const label of [detail.ingredientsHeading, detail.instructionsHeading, detail.nutritionLink]) {
            expect(within(nav).getByRole('link', { name: label })).toBeTruthy();
        }
    });

    it('makes the switch a DIRECT child of the scroller content, and the one sticky header', () => {
        render(view());

        const { content, props } = pageScroller();
        const nav = screen.getByRole('navigation', { name: detail.sectionsLabel });
        const holding = childIndexHolding(content, nav);

        expect(holding).toBeGreaterThan(0);
        expect(props['stickyHeaderIndices']).toEqual([holding]);
    });

    it('puts each of the three sections in its own direct child, in page order, after the switch', () => {
        render(view());

        const { content } = pageScroller();
        const at = (name: string): number => childIndexHolding(content, screen.getByRole('heading', { name }));
        const nav = childIndexHolding(content, screen.getByRole('navigation', { name: detail.sectionsLabel }));
        const ingredients = at(detail.ingredientsHeading);
        const steps = at(detail.instructionsHeading);
        const nutrition = at(detail.nutritionHeading);

        expect(nav).toBeLessThan(ingredients);
        expect(ingredients).toBeLessThan(steps);
        expect(steps).toBeLessThan(nutrition);
    });

    it('reports each section’s layout to the scroll host (the scroll spy reads the direct children)', () => {
        render(view());

        const content = pageScroller().props['children'];
        const reporting = (Array.isArray(content) ? content.flat(Infinity) : [content]).filter(
            (child): child is ReactElement<{ onLayout?: unknown }> =>
                typeof child === 'object' &&
                child !== null &&
                'props' in child &&
                typeof child.props.onLayout === 'function',
        );

        expect(reporting).toHaveLength(3);
    });

    it('moves Screen on into the switch as ONE icon-only control, named in full', () => {
        render(view());

        const toggles = screen.getAllByRole('switch', { name: detail.screenOn });
        const nav = screen.getByRole('navigation', { name: detail.sectionsLabel });

        expect(toggles).toHaveLength(1);
        expect((nav.parentElement as HTMLElement).contains(toggles[0] as HTMLElement)).toBe(true);
        expect(within(toggles[0] as HTMLElement).queryByText(detail.screenOn)).toBeNull();
    });

    it('marks the section the cook jumped to', () => {
        render(view());

        fireEvent.click(screen.getByRole('link', { name: detail.nutritionLink }));

        expect(screen.getByRole('link', { name: detail.nutritionLink }).getAttribute('aria-current')).toBe('location');
        expect(screen.getByRole('link', { name: detail.ingredientsHeading }).getAttribute('aria-current')).toBeNull();
    });
});

describe('RecipeDetailView (native) — from a 720 pt body', () => {
    beforeEach(() => {
        device.width = 1024;
    });

    it('draws no section switch and no sticky header: both columns are on screen', () => {
        render(view());

        expect(screen.queryByRole('navigation', { name: detail.sectionsLabel })).toBeNull();
        expect(pageScroller().props['stickyHeaderIndices']).toBeUndefined();
    });

    it('keeps Screen on, labelled, in the action row — and once', () => {
        render(view());

        const toggles = screen.getAllByRole('switch', { name: detail.screenOn });

        expect(toggles).toHaveLength(1);
        expect(within(toggles[0] as HTMLElement).getByText(detail.screenOn)).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — one gutter (A-024)', () => {
    /** The widest horizontal padding found on `node` and every ancestor up to (not including) `stop`. */
    const gutterBetween = (node: HTMLElement, stop: HTMLElement): number => {
        let total = 0;

        for (let el: HTMLElement | null = node; el !== null && el !== stop; el = el.parentElement) {
            total += Number.parseFloat(window.getComputedStyle(el).paddingLeft) || 0;
        }

        return total;
    };

    it.each([detail.instructionsHeading, detail.nutritionHeading])(
        'insets the %s section by 16, once — not by 32 from two nested gutters',
        (heading) => {
            render(view());

            const { content } = pageScroller();

            expect(gutterBetween(screen.getByRole('heading', { name: heading }), content)).toBe(16);
        },
    );
});

describe('RecipeDetailView (native) — the stat strip (D8, A-028 d)', () => {
    const threeStats = (): ReturnType<typeof makeRecipeDetail> =>
        makeRecipeDetail({ prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30, difficulty: undefined });

    /** The flex-basis of the strip cell labelled `label`. */
    const basisOf = (label: string): string => {
        const caption = screen.getByText(label);

        return (caption.parentElement as HTMLElement).style.flexBasis;
    };

    it('lets the last cell of an odd count span the row when two fit a row, instead of leaving a hole', () => {
        device.width = 330;
        render(view(threeStats()));

        expect(basisOf(detail.totalLabel)).toBe('50%');
        expect(basisOf(detail.prepLabel)).toBe('50%');
        expect(basisOf(detail.cookLabel)).toBe('100%');
    });

    it('draws three cells in one row when four fit a row', () => {
        device.width = 500;
        render(view(threeStats()));

        for (const label of [detail.totalLabel, detail.prepLabel, detail.cookLabel]) {
            expect(Number.parseFloat(basisOf(label))).toBeCloseTo(100 / 3, 1);
        }
    });

    it('falls back to two to a row when a large font leaves a cell too little room', () => {
        device.width = 500;
        device.fontScale = 2;
        render(view());

        expect(basisOf(detail.totalLabel)).toBe('50%');
    });
});

describe('RecipeDetailView (native) — the Screen on hint (D6)', () => {
    it('shows the hint once, under the section switch', () => {
        render(view());

        const hint = screen.getByText(detail.screenOnHint);
        const nav = screen.getByRole('navigation', { name: detail.sectionsLabel });

        expect(nav.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows the hint under the action-row toggle from a 720 pt body', () => {
        device.width = 1024;
        render(view());

        expect(screen.getByText(detail.screenOnHint)).toBeTruthy();
    });

    it('is gone after the cook uses the toggle', () => {
        render(view());

        fireEvent.click(screen.getByRole('switch', { name: detail.screenOn }));

        expect(screen.queryByText(detail.screenOnHint)).toBeNull();
    });

    it('is gone after the first scroll', () => {
        render(view());

        act(() => {
            (pageScroller().props['onScroll'] as (event: unknown) => void)({
                nativeEvent: {
                    contentOffset: { y: 120 },
                    layoutMeasurement: { height: 800 },
                    contentSize: { height: 3000 },
                },
            });
        });

        expect(screen.queryByText(detail.screenOnHint)).toBeNull();
    });

    it('stays hidden once dismissed, even when the cook scrolls back to the top', () => {
        render(view());
        fireEvent.click(screen.getByRole('switch', { name: detail.screenOn }));
        fireEvent.click(screen.getByRole('switch', { name: detail.screenOn }));

        expect(screen.queryByText(detail.screenOnHint)).toBeNull();
    });
});

describe('RecipeDetailView (native) — ingredients stay checkable inside the flattened page', () => {
    it('still draws a recipe’s ingredient rows', () => {
        render(view(makeRecipeDetail({ ingredients: [makeIngredientView({ ingredientId: 'a', name: 'Flour' })] })));

        expect(screen.getAllByText(/Flour/u).length).toBeGreaterThan(0);
    });
});
