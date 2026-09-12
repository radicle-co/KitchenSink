// @vitest-environment jsdom
/**
 * Component tests for the web per-card nutrition SLOT — the host-side half of the deferred calorie lookup.
 *
 * `RecipeNutritionBoundary` renders ONE recipe's promise. A card grid does not have one promise per card: it
 * has ONE batch promise for the whole page, and the answer for any single card is a SELECTION out of it that
 * cannot be made until the batch settles. That selection has a fourth outcome the per-recipe boundary
 * deliberately cannot express — the recipe the response OMITTED (`selectRecipeCalorieState` → `null`, "not
 * for you") — which is why this is its own component rather than a prop on that one.
 *
 * ⚠️ SUSPENSE TEST CONVENTION (see `@commise/web`'s `RecipeWidgetSlot.test.tsx:11-22`): resolve a Suspense
 * with `await act(...)`, NEVER with `findBy`/`waitFor`. The second and later such renders in a Vitest worker
 * wedge under polling — the Suspense retry never flushes and the assertion waits out the whole timeout.
 *
 * The two load-bearing tests here are the OMITTED case (skeleton, then nothing — never a spinner that
 * outlives a request, and never the `food_unavailable` lie) and the N-slots-ONE-promise case (the whole point
 * of the batch: `use()` memoizes per promise, so N boundaries over one promise fill together).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { RecipeNutritionSlot } from '../RecipeNutritionSlot.js';

afterEach(cleanup);

/** React logs a caught render error; silence it so a PASSING run stays readable, and restore after. */
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const PRESENT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000c';
const OMITTED = '00000000-0000-4000-8000-00000000000b';

const RESPONSE: RecipeNutritionResponse = {
    nutrition: {
        [PRESENT]: {
            state: 'known',
            caloriesPerServing: 420,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        },
        [OTHER]: {
            state: 'known',
            caloriesPerServing: 615,
            proteinG: 30,
            carbsG: 40,
            fatG: 20,
            isComplete: true,
            freshness: 'fresh',
        },
    },
};

const withLocale = (ui: ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

/** Render inside a sentinel, so "renders nothing" can be told apart from "the tree crashed". */
const renderSlot = async (nutritionBatchPromise: Promise<RecipeNutritionResponse>, recipeId: string) =>
    act(async () => {
        render(
            withLocale(
                <div>
                    <span>sentinel</span>
                    <RecipeNutritionSlot nutritionBatchPromise={nutritionBatchPromise} recipeId={recipeId} />
                </div>,
            ),
        );
    });

describe('RecipeNutritionSlot (web)', () => {
    it('renders the skeleton while the BATCH is still in flight', async () => {
        await renderSlot(new Promise<RecipeNutritionResponse>(() => undefined), PRESENT);

        expect(screen.getByText('Loading calories')).toBeTruthy();
        expect(screen.queryByText(/cal$/u)).toBeNull();
    });

    it('replaces the skeleton with THIS recipe’s chip once the batch resolves', async () => {
        await renderSlot(Promise.resolve(RESPONSE), PRESENT);

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    it('selects by recipe id — a sibling’s figure is never rendered in this slot', async () => {
        // Guards the mutation "index the map by the first key" / "ignore `recipeId`": both would still show a
        // plausible figure, and both would be wrong on every card but one.
        await renderSlot(Promise.resolve(RESPONSE), OTHER);

        expect(screen.getByRole('img', { name: '615 cal' })).toBeTruthy();
        expect(screen.queryByText('420 cal')).toBeNull();
    });

    // ⛔ THE OWNER RULING (2026-08-16). A recipe the response OMITTED is neither `known` nor `unaccounted`:
    // the batch says nothing about it, so the slot renders NOTHING — and above all not a skeleton that
    // outlives a request that already came back.
    it('renders NOTHING for a recipe the batch OMITTED — no chip, and no surviving skeleton', async () => {
        await renderSlot(Promise.resolve(RESPONSE), OMITTED);

        expect(screen.queryByText('Loading calories'), 'the skeleton must not outlive a settled batch').toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    it('renders an UNACCOUNTED entry as nothing at all — the card’s absent-value rule', async () => {
        await renderSlot(
            Promise.resolve<RecipeNutritionResponse>({
                nutrition: { [PRESENT]: { state: 'unaccounted', reason: 'no_nutrient_data' } },
            }),
            PRESENT,
        );

        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE INVARIANT. A rejected batch is a terminal answer, so the fallback must be GONE — a skeleton that
    // survives its own request is a spinner rendering forever, on every card of the page at once.
    it('never leaves a terminal skeleton: a REJECTED batch resolves to an answer, not a spinner', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        await renderSlot(failed as Promise<RecipeNutritionResponse>, PRESENT);

        expect(screen.queryByText('Loading calories'), 'the skeleton must not outlive the failed batch').toBeNull();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE OTHER HALF. An error state that outlives its request is the same defect wearing the other mask —
    // invisible, because a failed lookup renders as nothing. `resetKeys` is what makes a refetch recoverable.
    it('RECOVERS when a new batch arrives: the error state is not a latch', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        let view: RenderResult | undefined;
        await act(async () => {
            view = render(
                withLocale(
                    <RecipeNutritionSlot
                        nutritionBatchPromise={failed as Promise<RecipeNutritionResponse>}
                        recipeId={PRESENT}
                    />,
                ),
            );
        });
        expect(screen.queryByText(/cal/u), 'the failed batch renders no figure').toBeNull();

        await act(async () => {
            view?.rerender(
                withLocale(
                    <RecipeNutritionSlot nutritionBatchPromise={Promise.resolve(RESPONSE)} recipeId={PRESENT} />,
                ),
            );
        });

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    // ⛔ THE POINT OF THE BATCH. `use()` memoizes per promise identity, so N slots over ONE promise are ONE
    // read: they suspend together and fill together, including the omitted one — whose skeleton disappears
    // with the rest rather than lingering. (That the batch is ONE HTTP request is proved where the request is
    // made — `RecipeListContainer.nutrition.test.tsx` counts calls on the client.)
    it('fills N slots from ONE promise — all three suspend together and settle together', async () => {
        let resolveBatch: ((value: RecipeNutritionResponse) => void) | undefined;
        const batch = new Promise<RecipeNutritionResponse>((resolve) => {
            resolveBatch = resolve;
        });

        await act(async () => {
            render(
                withLocale(
                    <div>
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={PRESENT} />
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={OTHER} />
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={OMITTED} />
                    </div>,
                ),
            );
        });

        expect(
            screen.getAllByText('Loading calories'),
            'one skeleton per card while the batch is in flight',
        ).toHaveLength(3);

        await act(async () => {
            resolveBatch?.(RESPONSE);
        });

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.getByRole('img', { name: '615 cal' })).toBeTruthy();
        expect(screen.queryByText('Loading calories'), 'every slot settles together').toBeNull();
    });

    // ⛔ THE DERIVED-PROMISE TRAP, which every test above would pass. A slot that built its own promise from
    // the batch (`use(batch.then(select))`) gets a NEW identity on every render, so `use()` re-suspends and
    // the settled chip flips back to a skeleton on any parent re-render — a grid that flickers whenever
    // anything else on the page changes, and never converges while the page is interactive.
    it('does NOT re-suspend on a parent re-render — the settled chip stays settled', async () => {
        let view: RenderResult | undefined;
        const batch = Promise.resolve(RESPONSE);

        const tree = (marker: string): ReactElement =>
            withLocale(
                <div>
                    <span>{marker}</span>
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={PRESENT} />
                </div>,
            );

        await act(async () => {
            view = render(tree('first'));
        });
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();

        // A re-render of the HOST with the SAME promise — the ordinary case (a keystroke in the list's search
        // box, a filter chip, a router update). Rendered synchronously on purpose: `act(async …)` would flush
        // a re-suspend away, and it is the flash itself this pins down.
        act(() => {
            view?.rerender(tree('second'));
        });

        expect(screen.getByText('second')).toBeTruthy();
        expect(screen.queryByText('Loading calories'), 'a re-render must not re-suspend the slot').toBeNull();
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
    });
});
