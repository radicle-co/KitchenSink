/**
 * Native component tests for the curated browse-rails block (U7), rendered via react-native-web under jsdom. Mirrors the
 * web leaf: the three fixed-sort rails with per-rail "see all", each rail's body, the cuisine shortcuts, the enter motion
 * and the ONE refresh notice — so the two platform renders of the browse surface cannot drift.
 *
 * REWRITTEN for the per-rail read boundaries: each rail's body is a slot, so "rail states" moved to
 * `RecipeBrowseRailLoading.native.test.tsx`, `RecipeBrowseRailLoadError.native.test.tsx` and
 * `RecipeBrowseRailResults.native.test.tsx`; the bodies here are the real results leaf.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { AccessibilityInfo, Animated } from 'react-native';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';
import { createElement, type ReactNode } from 'react';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { makeRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.native.js';
import { RecipeBrowseRails } from '../RecipeBrowseRails.native.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from '../model.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    // `RefreshControl` is inert under jsdom; react-native-web clones it AROUND the scroll view, so a stand-in that renders
    // a "pull" button over its children lets a test perform the gesture's effect.
    const RefreshControl = ({ onRefresh, children }: { onRefresh?: () => void; children?: ReactNode }) =>
        createElement(
            'div',
            null,
            createElement('button', { type: 'button', onClick: onRefresh }, 'Pull to refresh'),
            children,
        );

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        RefreshControl,
    };
});

afterEach(cleanup);

const noop = () => undefined;

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

/** A rail whose body is the settled results leaf over `results`. */
function rail(
    id: RecipeBrowseRailId,
    results: readonly RecipeSearchResult[],
    overrides: Partial<RecipeBrowseRailView> & { readonly onSelectRecipe?: (id: string) => void } = {},
): RecipeBrowseRailView {
    const { onSelectRecipe = noop, ...view } = overrides;

    return {
        id,
        onSeeAll: noop,
        headingFocusSignal: 0,
        body: <RecipeBrowseRailResults results={results} onSelectRecipe={onSelectRecipe} onClone={noop} />,
        ...view,
    };
}

function threeRails(onSelectRecipe: (id: string) => void = noop): readonly RecipeBrowseRailView[] {
    return [
        rail('trending', [result({ id: 'rec_t', title: 'Viral Pad Thai' })], { onSelectRecipe }),
        rail('new', [result({ id: 'rec_n', title: 'Fresh Ceviche' })], { onSelectRecipe }),
        rail('quick', [result({ id: 'rec_q', title: 'Ten-Minute Omelette' })], { onSelectRecipe }),
    ];
}

function renderRails(overrides: Partial<RecipeBrowseRailsProps> = {}) {
    const props: RecipeBrowseRailsProps = { rails: threeRails(), cuisines: [], ...overrides };
    const view = render(<RecipeBrowseRails {...props} />);

    return { ...props, container: view.container };
}

describe('RecipeBrowseRails (native) — rails', () => {
    it('renders the three curated rails with their titles', () => {
        renderRails();

        expect(screen.getByRole('heading', { name: 'Trending' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Quick' })).toBeTruthy();
    });

    it('renders each rail’s recipe cards', () => {
        renderRails();

        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fresh Ceviche' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ten-Minute Omelette' })).toBeTruthy();
    });

    it('reports a "see all" for the rail that was activated', () => {
        const onSeeAll = vi.fn();
        renderRails({ rails: [rail('trending', [result({ id: 'rec_t', title: 'Viral Pad Thai' })], { onSeeAll })] });

        fireEvent.click(screen.getByRole('button', { name: 'See all Trending' }));

        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('reports a selected recipe upward', () => {
        const onSelectRecipe = vi.fn();
        renderRails({ rails: threeRails(onSelectRecipe) });

        fireEvent.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
    });
});

describe('RecipeBrowseRails (native) — U8 rail header accent', () => {
    it('paints a brand gradient accent on each rail section header', () => {
        const { container } = render(<RecipeBrowseRails rails={threeRails()} cuisines={[]} />);

        // Each rail header carries a decorative GradientSurface accent (expo-linear-gradient stub); three
        // rails ⇒ at least three gradient markers.
        const accents = container.querySelectorAll('[data-commise-stub="linear-gradient"]');
        expect(accents.length).toBeGreaterThanOrEqual(3);
    });
});

describe('RecipeBrowseRails (native) — a rail’s own Try again', () => {
    it('⛔ moves the screen-reader cursor to THAT rail’s heading when its retry signal changes', () => {
        const { rerender } = render(<RecipeBrowseRails rails={threeRails()} cuisines={[]} />);
        const [trending, fresh, quick] = threeRails();

        rerender(
            <RecipeBrowseRails
                rails={[
                    trending as RecipeBrowseRailView,
                    { ...(fresh as RecipeBrowseRailView), headingFocusSignal: 1 },
                    quick as RecipeBrowseRailView,
                ]}
                cuisines={[]}
            />,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'New' }),
            'focus',
        );
    });
});

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic `r-*` classes
 * back to their compiled rules — `getComputedStyle` does not resolve these. Mirrors `RecipeHero.native.test.tsx`.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return resolved;
}

/** Whether `element` or any ancestor is a scroll container react-native-web actually made scrollable. */
function hasScrollableAncestor(element: Element): boolean {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const overflowY = appliedStyle(node, 'overflow-y');

        if (overflowY === 'auto' || overflowY === 'scroll') {
            return true;
        }
    }

    return false;
}

/**
 * Moved from `RecipeDiscoveryResults.native.test.tsx` (review D1). Regression (Maestro `discoverBrowse` /
 * `searchNavigation`): browse — the DEFAULT state of Discover — is three rails plus cuisine shortcuts, far taller than a
 * phone. Rendered bare inside the screen's `flex: 1` container NOTHING scrolled: Maestro swiped up 13 times without the
 * surface moving. The rails block owns its scroll container, and the pull on it refreshes THE RAILS — it used to be the
 * results leaf's, bound to the main search, which is not what is on screen while browsing.
 */
describe('RecipeBrowseRails (native) — scrolling and pull-to-refresh', () => {
    it('puts the rails in a scrollable container so the third rail and the cuisines are reachable', () => {
        renderRails({ cuisines: [{ value: 'Thai', onSelect: noop }] });

        expect(hasScrollableAncestor(screen.getByRole('button', { name: 'Browse Thai recipes' }))).toBe(true);
    });

    it('refreshes the rails from a pull, and offers no pull when no refresh is wired', () => {
        const onRefresh = vi.fn();
        const { rerender } = render(<RecipeBrowseRails rails={threeRails()} cuisines={[]} />);

        expect(screen.queryByRole('button', { name: 'Pull to refresh' })).toBeNull();

        rerender(<RecipeBrowseRails rails={threeRails()} cuisines={[]} refresh={{ refreshing: false, onRefresh }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pull to refresh' }));

        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(hasScrollableAncestor(screen.getByRole('heading', { name: 'Quick' }))).toBe(true);
    });
});

describe('RecipeBrowseRails (native) — cuisine shortcuts', () => {
    it('renders cuisine shortcuts and reports a selection', () => {
        const onSelect = vi.fn();
        renderRails({ cuisines: [{ value: 'Thai', onSelect }] });

        fireEvent.click(screen.getByRole('button', { name: 'Browse Thai recipes' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('omits the cuisine section when there are no shortcuts', () => {
        renderRails({ cuisines: [] });

        expect(screen.queryByRole('heading', { name: 'Browse by cuisine' })).toBeNull();
    });
});

describe('RecipeBrowseRails (native) — section enter motion (U8 motion pass)', () => {
    beforeEach(() => {
        // react-native-web's shim returns no subscription object; keep that shape.
        vi.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(undefined as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Flush the pending `isReduceMotionEnabled()` promise so the resolved preference reaches state. */
    const settlePreference = async (): Promise<void> => {
        await act(async () => {
            await Promise.resolve();
        });
    };

    /** The nodes an `EnterTransition` drives — the ones carrying an animated opacity + translateY. */
    const enterWrappers = (container: HTMLElement): readonly HTMLElement[] =>
        [...container.querySelectorAll<HTMLElement>('*')].filter((node) =>
            node.style.transform.startsWith('translateY'),
        );

    it('composes each section inside the design-system enter transition, staggered', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const timing = vi.spyOn(Animated, 'timing');

        renderRails({ cuisines: [{ value: 'Thai', onSelect: noop }] });
        await settlePreference();

        // Three rails + the cuisine section, each with its OWN timing, and each held a little longer.
        expect(timing).toHaveBeenCalledTimes(4);
        const delays = timing.mock.calls.map((call) => (call[1] as { delay?: number }).delay);
        expect(delays[0]).toBe(0);
        expect(new Set(delays).size).toBe(4);
    });

    it('suppresses the enter motion entirely under reduce-motion', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const timing = vi.spyOn(Animated, 'timing');

        const { container } = renderRails({ cuisines: [{ value: 'Thai', onSelect: noop }] });
        await settlePreference();

        // No animation is created at all, and the sections are settled (fully opaque, no offset).
        expect(timing).not.toHaveBeenCalled();
        const wrappers = enterWrappers(container);
        expect(wrappers.length).toBeGreaterThan(0);

        for (const wrapper of wrappers) {
            expect(wrapper.style.opacity).toBe('1');
            expect(wrapper.style.transform).toBe('translateY(0px)');
        }
    });

    it('keeps the rail content reachable regardless of the motion wrapper', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

        renderRails();
        await settlePreference();

        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
    });
});

describe('RecipeBrowseRails (native) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the per-rail "see all" label legible on the screen background', () => {
        renderRails();

        // Mirrors the web leaf: "See all" is TEXT, so it owes the 4.5:1 SC 1.4.3 floor, and `seafoam` is
        // 3.73:1 on the `sand` screen background this rail header sits on. See the palette JSDoc in
        // `@commise/ui`'s `tokens/colors.ts`. The ratio (not a token equality) is asserted, so a re-theme of
        // the token cannot silently satisfy it; the leaf paints no tint, so the surface is the screen's own.
        const label = within(screen.getByRole('button', { name: 'See all Trending' })).getByText('See all');
        expect(
            computedContrast(label, { surface: palette.sand }),
            'see-all label on the sand screen background',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeBrowseRails (native) — a failed refresh of the rails on screen', () => {
    const notice = (overrides: Partial<NonNullable<RecipeBrowseRailsProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: noop,
        recoveries: 0,
        ...overrides,
    });

    it('shows no notice while nothing has failed', () => {
        renderRails({ refreshNotice: notice() });

        expect(screen.queryByText('We couldn’t refresh these recipes.')).toBeNull();
    });

    it('⛔ keeps every rail’s rows and shows ONE notice for the block, with a Try again that retries', () => {
        const onRetry = vi.fn();
        renderRails({ refreshNotice: notice({ failed: true, onRetry }) });

        expect(screen.getByText('Viral Pad Thai')).toBeTruthy();
        expect(screen.getByText('Ten-Minute Omelette')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves focus to the first rail’s heading when a retry from the notice succeeds', () => {
        const props = renderRails({ refreshNotice: notice({ failed: true }) });
        cleanup();
        const { rerender } = render(<RecipeBrowseRails {...props} refreshNotice={notice({ failed: true })} />);

        rerender(<RecipeBrowseRails {...props} refreshNotice={notice({ recoveries: 1 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Trending' }),
            'focus',
        );
    });
});
