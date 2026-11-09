// @vitest-environment jsdom
/**
 * The pinned ingredients bar on the web recipe page (owner ruling R1, `docs/plans/2026-11-08-pinnedIngredientsBar.md`):
 * once the ingredients card has scrolled above the top chrome, ONE button pins under it; it opens the list over the
 * content, servings stepper first. The web twin of `PinnedIngredientsBar.native.test.tsx`.
 *
 * jsdom lays nothing out, so a stand-in `IntersectionObserver` plays the browser: the test says where the card is, and
 * the bar must answer. The real scroll is Playwright's (`recipeDetailPinnedIngredients.spec.ts`).
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { renderWithRecipeClient } from '@commise/test-utils';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { DetailTestScope } from '../../__fixtures__/detailScope.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.js';

const { detail } = recipeMessages.en;

/** Where the card is: in view, wholly above the window's top edge, or still below the window. */
type CardPlace = 'inView' | 'above' | 'below';

/** A stand-in browser observer: it keeps what it was given, and the test reports where the card is. */
class StandInObserver implements IntersectionObserver {
    static readonly all: StandInObserver[] = [];
    readonly root = null;
    readonly rootMargin: string;
    readonly scrollMargin = '0px';
    readonly thresholds = [0];
    readonly observed: Element[] = [];
    disconnected = false;

    constructor(
        private readonly callback: IntersectionObserverCallback,
        init?: IntersectionObserverInit,
    ) {
        this.rootMargin = init?.rootMargin ?? '0px';
        StandInObserver.all.push(this);
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    unobserve(): void {}

    disconnect(): void {
        this.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    /** Tell the callback where the card is now. The root is everything above the window's top edge, so only 'above' intersects it. */
    report(place: CardPlace): void {
        const rootBounds = new DOMRect(0, 56, 390, 700);
        const boundingClientRect =
            place === 'above'
                ? new DOMRect(0, -600, 390, 500)
                : place === 'below'
                  ? new DOMRect(0, 900, 390, 500)
                  : new DOMRect(0, 100, 390, 500);

        this.callback(
            this.observed.map((target) => ({
                target,
                isIntersecting: place === 'above',
                intersectionRatio: place === 'above' ? 1 : 0,
                boundingClientRect,
                intersectionRect: new DOMRect(),
                rootBounds,
                time: 0,
            })),
            this,
        );
    }
}

const live = (): StandInObserver => {
    const observer = StandInObserver.all.find((candidate) => !candidate.disconnected && candidate.observed.length > 0);

    if (observer === undefined) {
        throw new Error('The page never asked a browser observer to watch the ingredients card.');
    }

    return observer;
};

const moveCard = (place: CardPlace): void => {
    act(() => {
        live().report(place);
    });
};

beforeEach(() => {
    resetServingScale();
    StandInObserver.all.length = 0;
    vi.stubGlobal('IntersectionObserver', StandInObserver);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const render = (ui: ReactElement): ReturnType<typeof renderWithRecipeClient> =>
    renderWithRecipeClient(
        <FoodServiceProvider
            client={
                new FoodServiceClient({
                    baseUrl: 'https://food.test',
                    fetch: () => Promise.reject(new Error('offline')),
                })
            }
            subject="user_test"
        >
            <DetailTestScope>{ui}</DetailTestScope>
        </FoodServiceProvider>,
        createFakeRecipeServiceClient(),
    );

const ingredients = Array.from({ length: 13 }, (_, index) =>
    makeIngredientView({
        ingredientId: `i${String(index)}`,
        name: `ingredient ${String(index + 1)}`,
        unit: 'g',
        ...(index < 6 ? { groupLabel: 'Chicken' } : { groupLabel: 'Vegetables' }),
    }),
);

const recipe = makeRecipeDetail({ servings: 4, ingredients });

const view = (over: { readonly lines?: typeof ingredients } = {}): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={over.lines === undefined ? recipe : makeRecipeDetail({ servings: 4, ingredients: over.lines })}
    />
);

const barName = (tail: string): RegExp => new RegExp(`^Ingredients for 4, [^.]*\\. ${tail} list\\.$`, 'u');
const showBar = (): HTMLElement => screen.getByRole('button', { name: barName('Show') });

describe('the pinned ingredients bar (web)', () => {
    it('asks the browser to watch a marker at the END of the ingredients card, with a root that reaches up past the window', () => {
        render(view());

        const observer = live();
        const card = screen.getByRole('region', { name: detail.ingredientsHeading });

        expect(observer.observed).toEqual([card.lastElementChild]);
        expect(observer.observed[0]?.getAttribute('aria-hidden')).toBe('true');
        expect(observer.rootMargin).toBe('1000000px 0px -100% 0px');
    });

    it('is not drawn while the card is in view', () => {
        render(view());
        moveCard('inView');

        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('is not drawn while the card is still below the window: the cook has not reached it yet', () => {
        render(view());
        moveCard('below');

        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('is drawn once the card has scrolled above the chrome, and goes again when the card returns', () => {
        render(view());
        moveCard('above');

        expect(showBar()).toBeTruthy();

        moveCard('inView');

        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('is ONE button, named for the servings and the item count, that says what it does', () => {
        render(view());
        moveCard('above');

        const bar = showBar();

        expect(bar.getAttribute('aria-label')).toBe('Ingredients for 4, 13 items. Show list.');
        expect(bar.getAttribute('aria-expanded')).toBe('false');
        expect(bar.getAttribute('aria-haspopup')).toBe('dialog');
        // The visible words are drawn, and the name already says them (SC 2.5.3).
        expect(within(bar).getByText('Ingredients')).toBeTruthy();
        expect(within(bar).getByText('for 4')).toBeTruthy();
        expect(within(bar).getByText('13 items')).toBeTruthy();
        expect(within(bar).getByText('Show')).toBeTruthy();
    });

    it('carries no servings stepper: a mistap must never change the servings', () => {
        render(view());
        moveCard('above');

        expect(within(showBar()).queryByRole('button')).toBeNull();
        expect(within(showBar()).queryByRole('group')).toBeNull();
    });

    it('draws no bar for a recipe with no ingredients', () => {
        render(view({ lines: [] }));

        expect(StandInObserver.all.filter((candidate) => candidate.observed.length > 0)).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /list\.$/u })).toBeNull();
    });

    it('counts a tick from the card in the bar, and leaves the clause out at zero', () => {
        render(view());
        moveCard('above');

        expect(within(showBar()).queryByText(/ticked/u)).toBeNull();

        fireEvent.click(screen.getByRole('checkbox', { name: /ingredient 3/u }));

        expect(screen.getByRole('button', { name: 'Ingredients for 4, 13 items, 1 ticked. Show list.' })).toBeTruthy();
        expect(within(showBar()).getByText('13 items · 1 ticked')).toBeTruthy();
    });

    describe('the list it opens', () => {
        const open = (): HTMLElement => {
            render(view());
            moveCard('above');
            fireEvent.click(showBar());

            return screen.getByRole('dialog', { name: 'Ingredients for 4' });
        };

        it('opens as a dialog named for the servings, the bar now reading Hide', () => {
            open();

            const bar = screen.getByRole('button', { name: barName('Hide') });

            expect(bar.getAttribute('aria-expanded')).toBe('true');
            expect(within(bar).getByText('Hide')).toBeTruthy();
        });

        it('leads with the Servings label and the stepper, then every row, grouped as on the card', () => {
            const panel = open();

            const [label] = within(panel).getAllByText('Servings');
            const stepper = within(panel).getByRole('group', { name: detail.servingsAdjustLabel });

            expect(label?.compareDocumentPosition(stepper)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            // The label and the stepper come before every row.
            expect(stepper.compareDocumentPosition(within(panel).getAllByRole('checkbox')[0] as HTMLElement)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(within(panel).getAllByRole('checkbox')).toHaveLength(13);
            expect(within(panel).getByRole('heading', { name: 'Chicken' })).toBeTruthy();
            expect(within(panel).getByRole('heading', { name: 'Vegetables' })).toBeTruthy();
        });

        it('moves focus into the list on open, and back to the bar on close', () => {
            const panel = open();

            expect(panel.contains(document.activeElement)).toBe(true);

            fireEvent.click(screen.getByRole('button', { name: barName('Hide') }));

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(document.activeElement).toBe(showBar());
        });

        it('closes on Escape, with focus back on the bar', () => {
            open();
            fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(document.activeElement).toBe(showBar());
        });

        it('closes when the scrim is pressed', () => {
            open();
            fireEvent.click(screen.getByRole('button', { name: detail.pinnedScrimClose, hidden: true }));

            expect(screen.queryByRole('dialog')).toBeNull();
        });

        it('blocks the page behind the scrim from scrolling while it is open, and frees it on close', () => {
            open();

            expect(document.documentElement.style.overflow).toBe('hidden');

            fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

            expect(document.documentElement.style.overflow).toBe('');
        });

        it('keeps the cook in the list: Tab from the last control wraps to the bar and on to the first', () => {
            const panel = open();
            const boxes = within(panel).getAllByRole('checkbox');
            const last = boxes[boxes.length - 1] as HTMLElement;

            last.focus();
            fireEvent.keyDown(last, { key: 'Tab' });

            expect(document.activeElement).toBe(screen.getByRole('button', { name: barName('Hide') }));
        });

        it('shares the servings with the card: a step in the list scales both', () => {
            const panel = open();

            fireEvent.click(within(panel).getByRole('button', { name: detail.servingsIncrease }));

            const card = screen.getByRole('region', { name: detail.ingredientsHeading });

            expect(within(card).getByText('for 5')).toBeTruthy();
            expect(screen.getByRole('dialog', { name: 'Ingredients for 5' })).toBeTruthy();
        });

        it('shares the ticks with the card: a tick in the list ticks the card row and counts in the bar', () => {
            const panel = open();

            fireEvent.click(within(panel).getByRole('checkbox', { name: /ingredient 2/u }));

            const card = screen.getByRole('region', { name: detail.ingredientsHeading });
            const row = within(card).getByRole('checkbox', { name: /ingredient 2/u });

            expect(row.getAttribute('aria-checked')).toBe('true');
            expect(screen.getByRole('button', { name: barName('Hide') }).getAttribute('aria-label')).toContain(
                '1 ticked',
            );
        });
    });
});
