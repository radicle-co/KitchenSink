/**
 * Native component tests for the nutrition boundary (react-native-web under jsdom).
 *
 * ⛔ THE PREMISE THIS FILE CORRECTS. The recipe Home widget's docblock claimed "React Native has no
 * Suspense-for-data streaming". That is true of SERVER streaming (RSC) and FALSE of the mechanism: React 19's
 * `use(promise)` + `<Suspense>` are client-side React and behave identically under React Native. So the
 * native leaf is promise-driven exactly like the web one and differs only in styling primitives — these tests
 * are the evidence, and they are deliberately the same tests as the web file's.
 *
 * ⚠️ Same Suspense convention: resolve with `await act(...)`, never `findBy`/`waitFor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeNutritionBoundary } from '../RecipeNutritionBoundary.native.js';
import type { RecipeCalorieState } from '../model.js';

afterEach(cleanup);

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const KNOWN: RecipeCalorieState = { state: 'known', caloriesPerServing: 420, isComplete: true, freshness: 'fresh' };

const withLocale = (ui: ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

const renderBoundary = async (nutritionPromise: Promise<RecipeCalorieState>) =>
    act(async () => {
        render(
            withLocale(
                <>
                    <span>sentinel</span>
                    <RecipeNutritionBoundary nutritionPromise={nutritionPromise} />
                </>,
            ),
        );
    });

describe('RecipeNutritionBoundary (native)', () => {
    it('renders the skeleton while the lookup is still in flight', async () => {
        await renderBoundary(new Promise<RecipeCalorieState>(() => undefined));

        expect(screen.getByLabelText('Loading calories')).toBeTruthy();
        expect(screen.queryByText(/cal$/)).toBeNull();
    });

    it('replaces the skeleton with the chip once the reading resolves', async () => {
        await renderBoundary(Promise.resolve(KNOWN));

        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('renders a resolved UNACCOUNTED reading as nothing at all', async () => {
        await renderBoundary(
            Promise.resolve<RecipeCalorieState>({ state: 'unaccounted', reason: 'no_resolved_ingredients' }),
        );

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal/)).toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
    });

    // ⛔ THE OTHER HALF — identical to the web leaf's. An error state that outlives its own request is a
    // latch, and on a card it latches INVISIBLY, because a failed lookup renders as nothing.
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

        await act(async () => {
            view?.rerender(withLocale(<RecipeNutritionBoundary nutritionPromise={Promise.resolve(KNOWN)} />));
        });

        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    // ⛔ THE INVARIANT — identical to the web leaf's, because the guarantee is the model's, not the platform's.
    it('never leaves a terminal skeleton: a REJECTED lookup resolves to an answer, not a spinner', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        await renderBoundary(failed as Promise<RecipeCalorieState>);

        expect(screen.queryByLabelText('Loading calories'), 'the skeleton must not outlive the request').toBeNull();
        expect(screen.getByText('sentinel')).toBeTruthy();
        expect(screen.queryByText(/cal/)).toBeNull();
    });
});
