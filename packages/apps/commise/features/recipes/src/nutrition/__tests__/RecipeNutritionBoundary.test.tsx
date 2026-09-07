// @vitest-environment jsdom
/**
 * Component tests for the web nutrition boundary — the ONE place `pending` exists.
 *
 * ⚠️ SUSPENSE TEST CONVENTION (see `@commise/web`'s `RecipeWidgetSlot.test.tsx`): resolve a Suspense with
 * `await act(...)`, NEVER with `findBy`/`waitFor`. The second and later such renders in a Vitest worker wedge
 * under polling — the Suspense retry never flushes and the assertion waits out the whole timeout.
 *
 * The load-bearing test in this file is the LAST one: **the skeleton is never terminal.** A permanent spinner
 * is the failure the whole three-state design exists to make unrepresentable, so a promise that never settles
 * keeps the fallback (correct — the request is genuinely in flight) while a promise that REJECTS must leave a
 * rendered answer behind, not a spinner that outlives the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeNutritionBoundary } from '../RecipeNutritionBoundary.js';
import type { RecipeCalorieState } from '../model.js';

afterEach(cleanup);

/** React logs a caught render error; silence it so a PASSING run stays readable, and restore after. */
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const KNOWN: RecipeCalorieState = { state: 'known', caloriesPerServing: 420, isComplete: true, freshness: 'fresh' };

const withLocale = (ui: ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

/** Render inside a sentinel, so "renders nothing" can be told apart from "the tree crashed". */
const renderBoundary = async (nutritionPromise: Promise<RecipeCalorieState>) =>
    act(async () => {
        render(
            withLocale(
                <div>
                    <span>sentinel</span>
                    <RecipeNutritionBoundary nutritionPromise={nutritionPromise} />
                </div>,
            ),
        );
    });

/**
 * ⚠️ The skeleton is located by its visually-hidden TEXT, not by `getByRole('status')`. It stopped being a
 * live region deliberately: a grid renders one per card, so `role="status"` announced "loading calories"
 * once per card on entry while the figure ARRIVING was never announced at all. The grid-level skeleton
 * keeps the single "recipes are loading" region. See `RecipeCalorieSkeleton`.
 */
describe('RecipeNutritionBoundary (web)', () => {
    it('renders the skeleton while the lookup is still in flight', async () => {
        await renderBoundary(new Promise<RecipeCalorieState>(() => undefined));

        expect(screen.getByText('Loading calories')).toBeTruthy();
        expect(screen.queryByText(/cal$/)).toBeNull();
    });

    it('replaces the skeleton with the chip once the reading resolves', async () => {
        await renderBoundary(Promise.resolve(KNOWN));

        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    it('renders a resolved UNACCOUNTED reading as nothing at all — the card’s absent-value rule', async () => {
        await renderBoundary(Promise.resolve<RecipeCalorieState>({ state: 'unaccounted', reason: 'no_nutrient_data' }));

        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal/)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE INVARIANT. A rejected lookup is `unaccounted{food_unavailable}` — a terminal answer — so the
    // fallback must be GONE. A skeleton that survives its own request is a spinner rendering forever.
    it('never leaves a terminal skeleton: a REJECTED lookup resolves to an answer, not a spinner', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        // Mark handled so the rejection is not reported as unhandled; `use()` still sees the rejection.
        failed.catch(() => undefined);

        await renderBoundary(failed as Promise<RecipeCalorieState>);

        expect(screen.queryByText('Loading calories'), 'the skeleton must not outlive the failed request').toBeNull();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        // The answer for a failed lookup is "no figure", and on a card that renders as nothing — but the
        // surrounding tree must still be alive, which is what tells a rendered answer from a crash.
        expect(screen.getByText('sentinel')).toBeTruthy();
        expect(screen.queryByText(/cal/)).toBeNull();
    });

    // ⛔ THE OTHER HALF OF THE INVARIANT. An error state that outlives its own request is the same defect as
    // a skeleton that does — it is simply invisible, because a failed lookup renders as nothing. Without
    // `resetKeys` react-error-boundary NEVER leaves its error state, so the figure would stay blank for this
    // card's whole lifetime, surviving every refetch.
    it('RECOVERS when a new lookup arrives: the error state is not a latch', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        let view: RenderResult | undefined;
        await act(async () => {
            view = render(
                withLocale(<RecipeNutritionBoundary nutritionPromise={failed as Promise<RecipeCalorieState>} />),
            );
        });
        expect(screen.queryByText(/cal/), 'the failed lookup renders no figure').toBeNull();

        // A refetch hands the boundary a NEW promise — the identity change is the retry signal.
        await act(async () => {
            view?.rerender(withLocale(<RecipeNutritionBoundary nutritionPromise={Promise.resolve(KNOWN)} />));
        });

        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    // A deadline is enforced by the data layer as a REJECTION; the presentation contract is the same.
    it('treats a deadline-exceeded rejection the same way — an answer, never a permanent skeleton', async () => {
        const timedOut = Promise.reject(new Error('deadline exceeded'));
        timedOut.catch(() => undefined);

        await renderBoundary(timedOut as Promise<RecipeCalorieState>);

        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });
});
