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
import { cleanup, screen, within } from '@testing-library/react';
// The detail leaves draw through the design system's Tamagui components (ADR-0080), so the tree renders in its provider.
import { nativeTokens } from '@commise/ui/native';
import { render as renderInDesignSystem, resolvedStyle } from '@commise/ui/testing/tamagui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { DetailSection, DetailStack } from '../detailFrames.native.js';
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

const render = (ui: ReactElement) => renderInDesignSystem(ui, { wrapper: CookMarksTestProvider });

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

// REWRITTEN IN SLICE 1 (`nativeBoards/buildLists.md`: no `SectionSwitch` tab strip on phones). The page is one flat scroll:
// the tests that proved the switch, its sticky header, its Screen on icon and the scroll spy's layout reports are gone
// with the switch (Screen on as a page row is proved in `RecipeDetailTop.native.test.tsx`), and these prove what is left:
// no sticky header, and each section still a DIRECT child of the content, in page order.
describe('RecipeDetailView (native) — below a 720 pt body, one flat page', () => {
    it('sticks nothing: there is no section switch to stick', () => {
        render(view());

        expect(pageScroller().props['stickyHeaderIndices']).toBeUndefined();
    });

    it('puts each of the three sections in its own direct child, in page order', () => {
        render(view());

        const { content } = pageScroller();
        const at = (name: string): number => childIndexHolding(content, screen.getByRole('heading', { name }));
        const ingredients = at(detail.ingredientsHeading);
        const steps = at(detail.instructionsHeading);
        const nutrition = at(detail.nutritionHeading);

        expect(ingredients).toBeGreaterThan(0);
        expect(ingredients).toBeLessThan(steps);
        expect(steps).toBeLessThan(nutrition);
    });
});

describe('RecipeDetailView (native) — from a 720 pt body', () => {
    beforeEach(() => {
        device.width = 1024;
    });

    it('draws no section switch and no sticky header: both columns are on screen', () => {
        render(view());

        expect(screen.queryByRole('navigation', { name: 'Recipe sections' })).toBeNull();
        expect(pageScroller().props['stickyHeaderIndices']).toBeUndefined();
    });

    it('keeps Screen on, labelled, in the action row — and once', () => {
        render(view());

        const toggles = screen.getAllByRole('switch', { name: detail.screenOn });

        expect(toggles).toHaveLength(1);
        expect(within(toggles[0] as HTMLElement).getByText(detail.screenOn)).toBeTruthy();
    });
});

/**
 * How the sections share the page (build spec §6.1): from a 720 pt body the ingredients take five parts of twelve and
 * the steps column seven, and the blocks of a column, or of the closing run, sit space-6 (32) apart: the section
 * gap, 32 on web and native in one column and two (designer ruling, `nativeBoards/designAnswers.md`). It was 64.
 * The two columns sit 32 apart too; that gap was 64.
 *
 * The column share is a variant of the page's frames (`detailFrames.native.ts`). Tamagui's web build writes it as the
 * shorthand `flex: 5 0 0`, which jsdom drops as it parses, so no computed style can show it (ADR-0080 §6: a style
 * jsdom cannot hold is asserted on the variant table, in `detailFrames.native.test.tsx`). What this suite proves is
 * that the page USES that variant: a column renders with exactly the classes of a reference frame given the variant,
 * and a section below 720 pt with those of a frame given none.
 */
describe('RecipeDetailView (native) — the columns and the stacks (§6.1)', () => {
    const px = (step: keyof typeof nativeTokens.spacing): string => `${String(nativeTokens.spacing[step])}px`;
    /** The section frame that holds a heading: the heading sits in its heading row, the row in the section. */
    const sectionOf = (name: string): HTMLElement =>
        (screen.getByRole('heading', { name }).parentElement as HTMLElement).parentElement as HTMLElement;
    // REWRITTEN IN SLICE 2: the ingredients heading sits in its heading row, the row in the paper card, the card in the
    // section, so it is one level deeper than the other sections.
    const ingredientsSection = (): HTMLElement => sectionOf(detail.ingredientsHeading).parentElement as HTMLElement;

    /** The classes a reference frame renders with, so a page element can be compared with it. */
    const classesOf = (frame: ReactElement): string => {
        const { container, unmount } = renderInDesignSystem(frame);
        const classes = (container.querySelector('[name]') as HTMLElement).className;
        unmount();

        return classes;
    };

    it('gives the ingredients five parts of the row and the steps column seven, from a 720 pt body', () => {
        const ingredientsColumn = classesOf(<DetailSection column="ingredients" />);
        const stepsColumn = classesOf(<DetailStack column="steps" />);

        device.width = 1024;
        render(view());

        expect(ingredientsSection().className).toBe(ingredientsColumn);
        expect((sectionOf(detail.instructionsHeading).parentElement as HTMLElement).className).toBe(stepsColumn);
    });

    it('gives a section no share of a row below a 720 pt body, where it is the only thing in it', () => {
        const plainSection = classesOf(<DetailSection />);
        render(view());

        expect(ingredientsSection().className).toBe(plainSection);
    });

    it('puts the two columns space-6 (32) apart, from a 720 pt body', () => {
        device.width = 1024;
        render(view());
        const columns = ingredientsSection().parentElement as HTMLElement;

        expect(columns.contains(screen.getByRole('heading', { name: detail.instructionsHeading }))).toBe(true);
        expect(resolvedStyle(columns, 'gap')).toBe(px(6));
    });

    it('stacks the steps column’s blocks space-6 (32) apart, from a 720 pt body', () => {
        device.width = 1024;
        render(view());
        const stepsColumn = sectionOf(detail.instructionsHeading).parentElement as HTMLElement;

        expect(resolvedStyle(stepsColumn, 'gap')).toBe(px(6));
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

// REWRITTEN IN SLICE 1 (designer, iosBatch1): "Screen on" has no caption, so there is no hint to show, dismiss or remember.
describe('RecipeDetailView (native) — Screen on has no caption', () => {
    it.each([390, 1024])('draws no hint under the toggle, at a %s pt width', (width) => {
        device.width = width;
        render(view());

        expect(screen.queryByText('Keeps the screen awake while you cook.')).toBeNull();
    });
});

describe('RecipeDetailView (native) — ingredients stay checkable inside the flattened page', () => {
    it('still draws a recipe’s ingredient rows', () => {
        render(view(makeRecipeDetail({ ingredients: [makeIngredientView({ ingredientId: 'a', name: 'Flour' })] })));

        expect(screen.getAllByText(/Flour/u).length).toBeGreaterThan(0);
    });
});
