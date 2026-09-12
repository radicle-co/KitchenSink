// @vitest-environment jsdom
/**
 * Component tests for the NATIVE per-card nutrition slot — the twin of `RecipeNutritionSlot.test.tsx`, run
 * against the `.native.tsx` leaf through react-native-web.
 *
 * The §14 argument is the one `omittedRecipe.native.test.tsx` already makes: the selection model is shared,
 * but the tree that renders it is a different component per platform, and "no skeleton outlives its request"
 * is a claim about that tree. It matters more here, not less — these cards live in a virtualized list, where
 * a lingering placeholder scrolls out of view before anyone reads it.
 *
 * Two native specifics, each a platform fact rather than a drift from the web twin:
 *   - the skeleton has no live region, so it is found by its accessibility NAME (`getByLabelText`), and
 *   - the chip announces through `accessibilityRole="image"`, which react-native-web projects to `role="img"`
 *     — the same role the web leaf sets, so both files assert the same query.
 *
 * ⚠️ SUSPENSE TEST CONVENTION: resolve a Suspense with `await act(...)`, NEVER `findBy`/`waitFor` — the
 * latter wedges in a Vitest worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeNutritionSlot } from '../RecipeNutritionSlot.native.js';

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

/** Render beside a sentinel, so "renders nothing" can be told apart from "the tree crashed". */
const renderSlot = async (nutritionBatchPromise: Promise<RecipeNutritionResponse>, recipeId: string) =>
    act(async () => {
        render(
            withLocale(
                <>
                    <span>sentinel</span>
                    <RecipeNutritionSlot nutritionBatchPromise={nutritionBatchPromise} recipeId={recipeId} />
                </>,
            ),
        );
    });

describe('RecipeNutritionSlot (native)', () => {
    it('renders the skeleton while the BATCH is still in flight', async () => {
        await renderSlot(new Promise<RecipeNutritionResponse>(() => undefined), PRESENT);

        expect(screen.getByLabelText('Loading calories')).toBeTruthy();
        expect(screen.queryByText(/cal$/u)).toBeNull();
    });

    it('replaces the skeleton with THIS recipe’s chip once the batch resolves', async () => {
        await renderSlot(Promise.resolve(RESPONSE), PRESENT);

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('selects by recipe id — a sibling’s figure is never rendered in this slot', async () => {
        // Guards the mutation "index the map by the first key" / "ignore `recipeId`": both would still show a
        // plausible figure, and both would be wrong on every card but one.
        await renderSlot(Promise.resolve(RESPONSE), OTHER);

        expect(screen.getByRole('img', { name: '615 cal' })).toBeTruthy();
        expect(screen.queryByText('420 cal')).toBeNull();
    });

    // ⛔ THE OWNER RULING (2026-08-16). A recipe the response OMITTED is neither `known` nor `unaccounted`.
    it('renders NOTHING for a recipe the batch OMITTED — no chip, and no surviving skeleton', async () => {
        await renderSlot(Promise.resolve(RESPONSE), OMITTED);

        expect(screen.queryByLabelText('Loading calories'), 'the skeleton must not outlive a settled batch').toBeNull();
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

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE INVARIANT: a rejected batch is a terminal answer, so the fallback must be GONE.
    it('never leaves a terminal skeleton: a REJECTED batch resolves to an answer, not a spinner', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        await renderSlot(failed as Promise<RecipeNutritionResponse>, PRESENT);

        expect(
            screen.queryByLabelText('Loading calories'),
            'the skeleton must not outlive the failed batch',
        ).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE OTHER HALF: an error state that outlives its request is the same defect wearing the other mask.
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
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    // ⛔ THE POINT OF THE BATCH. `use()` memoizes per promise identity, so N slots over ONE promise are ONE
    // read: they suspend together and fill together, including the omitted one.
    it('fills N slots from ONE promise — all three suspend together and settle together', async () => {
        let resolveBatch: ((value: RecipeNutritionResponse) => void) | undefined;
        const batch = new Promise<RecipeNutritionResponse>((resolve) => {
            resolveBatch = resolve;
        });

        await act(async () => {
            render(
                withLocale(
                    <>
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={PRESENT} />
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={OTHER} />
                        <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={OMITTED} />
                    </>,
                ),
            );
        });

        expect(
            screen.getAllByLabelText('Loading calories'),
            'one skeleton per card while the batch is in flight',
        ).toHaveLength(3);

        await act(async () => {
            resolveBatch?.(RESPONSE);
        });

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.getByRole('img', { name: '615 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories'), 'every slot settles together').toBeNull();
    });

    // ⛔ THE DERIVED-PROMISE TRAP, which every test above would pass. A slot that built its own promise from
    // the batch (`use(batch.then(select))`) gets a NEW identity on every render, so `use()` re-suspends and
    // the settled chip flips back to a skeleton on any parent re-render. On native that parent re-render is
    // routine — a keystroke in the list's search field, a filter chip, a FlashList cell recycling.
    it('does NOT re-suspend on a parent re-render — the settled chip stays settled', async () => {
        let view: RenderResult | undefined;
        const batch = Promise.resolve(RESPONSE);

        const tree = (marker: string): ReactElement =>
            withLocale(
                <>
                    <span>{marker}</span>
                    <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={PRESENT} />
                </>,
            );

        await act(async () => {
            view = render(tree('first'));
        });
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();

        // Rendered synchronously on purpose: `act(async …)` would flush a re-suspend away, and it is the
        // flash itself this pins down.
        act(() => {
            view?.rerender(tree('second'));
        });

        expect(screen.getByText('second')).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories'), 'a re-render must not re-suspend the slot').toBeNull();
        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
    });
});
