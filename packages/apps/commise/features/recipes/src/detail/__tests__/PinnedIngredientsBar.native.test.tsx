/**
 * The pinned ingredients bar on the native recipe page (owner ruling R1, `docs/plans/2026-11-08-pinnedIngredientsBar.md`):
 * ONE button pinned at the top of the screen once the ingredients card has scrolled away; it opens the list in a panel under
 * it, over a scrim, with the servings stepper first. The native twin of `PinnedIngredientsBar.test.tsx`.
 *
 * The page's wiring from a real scroll (`useIngredientsCardScrollWatch`) is tested as a hook below; the end-to-end scroll
 * is Maestro's (`recipes/pinnedIngredients.yaml`), because jsdom lays nothing out. The panel test renders the pure body with
 * the same state the shell binds (`useServingScale`, `useCookMarks`), so a tick or a step in the panel is the card's.
 */
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { nativeTokens } from '@commise/ui/native';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { guardedFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { useState, type FC, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookMarksTestProvider, idleDetailBodyState } from '../../__fixtures__/cookMarks.js';
import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailBody } from '../RecipeDetailBody.native.js';
import { useCookMarks } from '../useCookMarks.js';
import { useIngredientsCardScrollWatch } from '../useIngredientsCardScrollWatch.native.js';
import { useServingScale } from '../useServingScale.js';

const { detail } = recipeMessages.en;

/** The scale of an iOS device at its largest accessibility setting. */
const SCALE = 3.1;

// react-native-web drops `accessibilityHint`, so the pressables are wrapped to record the accessibility props a screen reader is given.
const seen = vi.hoisted(() => ({ pressables: [] as { accessibilityLabel?: string; accessibilityHint?: string }[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Pressable: (props: import('react-native').PressableProps) => {
            seen.pressables.push({
                ...(props.accessibilityLabel === undefined ? {} : { accessibilityLabel: props.accessibilityLabel }),
                ...(props.accessibilityHint === undefined ? {} : { accessibilityHint: props.accessibilityHint }),
            });

            return createElement(actual.Pressable, props);
        },
        useWindowDimensions: () => ({ ...actual.Dimensions.get('window'), width: 390, height: 844, fontScale: 1 }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

let back: HardwareBackHandle;

beforeEach(() => {
    resetServingScale();
    back = installHardwareBackHandler();
});
afterEach(() => {
    back.restore();
    cleanup();
});

const Scope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>
                    <BackInterceptProvider onUnhandled={() => false}>{children}</BackInterceptProvider>
                </CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

const ingredients = Array.from({ length: 13 }, (_, index) =>
    makeIngredientView({
        ingredientId: `i${String(index)}`,
        name: `ingredient ${String(index + 1)}`,
        unit: 'g',
        groupLabel: index < 6 ? 'Chicken' : 'Vegetables',
    }),
);

/** The pure body with the state its shell binds, and the bar held shown: the scroll is the hook's, tested below. */
const Page: FC<{ readonly lines?: typeof ingredients; readonly startOpen?: boolean; readonly shown?: boolean }> = ({
    lines = ingredients,
    startOpen = false,
    shown = true,
}) => {
    const page = makeRecipeDetail({ servings: 4, ingredients: lines });
    const scale = useServingScale(page.id, page.servings);
    const marks = useCookMarks(page.id);
    const [open, setOpen] = useState(startOpen);

    return (
        <RecipeDetailBody
            {...idleDetailBodyState}
            unreachableRetry={idleUnreachableRetry}
            recipe={page}
            servings={scale.servings}
            onServingsChange={scale.setServings}
            marks={marks}
            layout={{ columns: 'one', bodyWidth: 358, textScale: 1 }}
            onOpenDataSources={vi.fn()}
            dataSourcesReturnFocusSignal={0}
            pinnedIngredients={{ shown: shown && lines.length > 0, open: open && shown, onOpenChange: setOpen }}
        />
    );
};

const render = (ui: ReactElement, scale = 1) => renderWithTamagui(<Scope>{ui}</Scope>, 'light', scale);

const bar = (tail: 'Show' | 'Hide'): HTMLElement =>
    screen.getByRole('button', { name: new RegExp(`^Ingredients for 4, [^.]*\\. ${tail} list\\.$`, 'u') });

describe('the pinned ingredients bar (native)', () => {
    it('is not drawn while the card is in view', () => {
        render(<Page shown={false} />);

        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('is drawn when the card has scrolled away: ONE button naming the servings and the item count', () => {
        render(<Page />);

        expect(bar('Show').getAttribute('aria-label')).toBe('Ingredients for 4, 13 items. Show list.');
        expect(bar('Show').getAttribute('aria-expanded')).toBe('false');
        expect(within(bar('Show')).getByText('13 items')).toBeTruthy();
        expect(within(bar('Show')).getByText('Show')).toBeTruthy();
    });

    it('carries no servings stepper: a mistap must never change the servings', () => {
        render(<Page />);

        expect(within(bar('Show')).queryByRole('button')).toBeNull();
    });

    it('draws no bar for a recipe with no ingredients', () => {
        render(<Page lines={[]} />);

        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('opens a dialog named for the servings, the bar now reading Hide, with the stepper first and every row', () => {
        render(<Page />);
        fireEvent.click(bar('Show'));

        const panel = screen.getByRole('dialog', { name: 'Ingredients for 4' });
        const stepper = within(panel).getByRole('group', { name: detail.servingsAdjustLabel });
        const rows = within(panel).getAllByRole('checkbox');

        expect(bar('Hide').getAttribute('aria-expanded')).toBe('true');
        expect(within(bar('Hide')).getByText('Hide')).toBeTruthy();
        expect(rows).toHaveLength(13);
        expect(stepper.compareDocumentPosition(rows[0] as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(within(panel).getByText('Chicken')).toBeTruthy();
        expect(within(panel).getByText('Vegetables')).toBeTruthy();
    });

    it('closes by the bar, and by the scrim', () => {
        render(<Page startOpen />);

        fireEvent.click(bar('Hide'));

        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(bar('Show'));
        fireEvent.click(screen.getByRole('button', { name: detail.pinnedScrimClose }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on the Android back button, and lets back go on once it is closed', () => {
        render(<Page startOpen />);

        expect(back.press()).toBe(true);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(back.press()).toBe(false);
    });

    it('shares the servings with the card: a step in the panel scales both', () => {
        render(<Page startOpen />);

        const panel = screen.getByRole('dialog', { name: 'Ingredients for 4' });

        fireEvent.click(within(panel).getByRole('button', { name: detail.servingsIncrease }));

        expect(screen.getByRole('dialog', { name: 'Ingredients for 5' })).toBeTruthy();
        expect(screen.getAllByText('for 5').length).toBeGreaterThan(0);
    });

    it('shares the ticks with the card: a tick in the panel counts in the bar and ticks the card row', () => {
        render(<Page startOpen />);

        const panel = screen.getByRole('dialog', { name: 'Ingredients for 4' });

        fireEvent.click(within(panel).getByRole('checkbox', { name: /ingredient 2/u }));

        expect(bar('Hide').getAttribute('aria-label')).toBe('Ingredients for 4, 13 items, 1 ticked. Hide list.');
        expect(
            screen.getAllByRole('checkbox', { name: /ingredient 2/u }).map((row) => row.getAttribute('aria-checked')),
        ).toEqual(['true', 'true']);
    });

    it('moves the screen-reader cursor into the list on open, and back to the bar on close', () => {
        render(<Page />);

        const send = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);

        send.mockClear();
        fireEvent.click(bar('Show'));

        const panel = screen.getByRole('dialog', { name: 'Ingredients for 4' });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenLastCalledWith(expect.anything(), 'focus');
        // The first thing in the list, "Servings", takes the cursor.
        const target: unknown = send.mock.calls[0]?.[0];

        expect(target instanceof Node && panel.contains(target)).toBe(true);

        send.mockClear();
        fireEvent.click(bar('Hide'));

        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]?.[0]).toBe(bar('Show'));
    });

    it('holds a screen reader inside the list while it is open (a modal overlay), and not before', () => {
        render(<Page />);

        expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);

        fireEvent.click(bar('Show'));

        expect(document.querySelectorAll('[aria-modal="true"]').length).toBeGreaterThan(0);

        fireEvent.click(bar('Hide'));

        expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
    });

    it('lets the list enter with the shared enter transition (instant under reduced motion)', () => {
        render(<Page startOpen />);

        const panel = screen.getByRole('dialog', { name: 'Ingredients for 4' });

        expect(panel.querySelector('[style*="opacity"]')).not.toBeNull();
    });

    it('gives the bar a hint saying what it does, and flips it when the list is open (React Native has no aria-haspopup)', () => {
        render(<Page />);

        const hintOf = (label: RegExp): string | undefined =>
            [...seen.pressables].reverse().find((press) => label.test(press.accessibilityLabel ?? ''))
                ?.accessibilityHint;

        expect(hintOf(/Show list\.$/u)).toBe(detail.pinnedHintShow);

        fireEvent.click(bar('Show'));

        expect(hintOf(/Hide list\.$/u)).toBe(detail.pinnedHintHide);
    });

    it('caps the bar text at 1.5x at a system text scale of 3.1: chrome never draws larger than the page title', () => {
        render(<Page />, SCALE);

        const cap = (size: number): string => `${String(size * 1.5)}px`;
        const barText = within(bar('Show'));

        expect(resolvedStyle(barText.getByText('Ingredients'), 'fontSize')).toBe(cap(nativeTokens.type.label.fontSize));
        expect(resolvedStyle(barText.getByText('13 items'), 'fontSize')).toBe(cap(nativeTokens.type.meta.fontSize));
        expect(resolvedStyle(barText.getByText('Show'), 'fontSize')).toBe(cap(nativeTokens.type.label.fontSize));
    });
});

describe('the bar text grows with the system text size, up to the chrome cap of 1.5x', () => {
    // The sizes come from the tokens (label and meta are both 14 px), so a type-scale change moves the test with it.
    it.each([1.25, 2])(
        'at a system scale of %s the label and the meta line draw at 14 px times the scale, capped at 1.5',
        (scale) => {
            render(<Page />, scale);

            const barText = within(bar('Show'));
            const grown = (size: number): string => `${String(size * Math.min(scale, 1.5))}px`;

            expect(resolvedStyle(barText.getByText('Ingredients'), 'fontSize')).toBe(
                grown(nativeTokens.type.label.fontSize),
            );
            expect(resolvedStyle(barText.getByText('13 items'), 'fontSize')).toBe(
                grown(nativeTokens.type.meta.fontSize),
            );
            expect(resolvedStyle(barText.getByText('Show'), 'fontSize')).toBe(grown(nativeTokens.type.label.fontSize));
        },
    );
});

/** A scroll and a layout event, with only the fields the hook reads. */
const layoutOf = (y: number, height: number) => ({ nativeEvent: { layout: { y, height } } });
const scrollTo = (y: number) => ({ nativeEvent: { contentOffset: { y } } });

describe('useIngredientsCardScrollWatch (the page scroll, as the bar reads it)', () => {
    const TOP_INSET = 47;

    it('has not scrolled past before the card has been laid out', () => {
        const { result } = renderHook(() => useIngredientsCardScrollWatch(TOP_INSET));

        act(() => result.current.onScroll(scrollTo(5000)));

        expect(result.current.scrolledPast).toBe(false);
    });

    it('has scrolled past once the card’s bottom edge is above the top inset, and not before', () => {
        const { result } = renderHook(() => useIngredientsCardScrollWatch(TOP_INSET));

        act(() => result.current.onCardLayout(layoutOf(700, 600)));
        act(() => result.current.onScroll(scrollTo(0)));

        expect(result.current.scrolledPast).toBe(false);

        // The card's bottom is at 1300. With the 47 inset, the edge is at the inset from 1253 on.
        act(() => result.current.onScroll(scrollTo(1253)));

        expect(result.current.scrolledPast).toBe(true);

        act(() => result.current.onScroll(scrollTo(1252)));

        expect(result.current.scrolledPast).toBe(false);
    });

    it('comes back when the cook scrolls up to the card', () => {
        const { result } = renderHook(() => useIngredientsCardScrollWatch(TOP_INSET));

        act(() => result.current.onCardLayout(layoutOf(700, 600)));
        act(() => result.current.onScroll(scrollTo(2000)));

        expect(result.current.scrolledPast).toBe(true);

        act(() => result.current.onScroll(scrollTo(900)));

        expect(result.current.scrolledPast).toBe(false);
    });

    it('re-reads the card at once when its height changes with no scroll: the bar never shows over the card', () => {
        const { result } = renderHook(() => useIngredientsCardScrollWatch(TOP_INSET));

        act(() => result.current.onCardLayout(layoutOf(700, 600)));
        act(() => result.current.onScroll(scrollTo(1300)));

        expect(result.current.scrolledPast).toBe(true);

        // A rotation, a text-size change or a refresh makes the card taller; the page does not scroll.
        act(() => result.current.onCardLayout(layoutOf(700, 900)));

        expect(result.current.scrolledPast).toBe(false);

        // And back: a card that shrinks under the cook's position is past again.
        act(() => result.current.onCardLayout(layoutOf(700, 600)));

        expect(result.current.scrolledPast).toBe(true);
    });
});
