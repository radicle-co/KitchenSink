// @vitest-environment jsdom
/**
 * ⛔ THE OMITTED RECIPE — the fourth case, which is not a state. (WEB; the native twin is
 * `omittedRecipe.native.test.tsx`, and the two are deliberately the same tests.)
 *
 * The wire contract is explicit that a recipe the caller may not read is ABSENT from the response map, and
 * that a client must treat a missing key as "not for you" rather than as an error. OWNER RULING (2026-08-16):
 * an omitted recipe renders the skeleton while the lookup is in flight and then renders **nothing** where the
 * figure would be. It is NOT `unaccounted{food_unavailable}` — food was fine, and saying otherwise would
 * become a visible lie the moment the detail disclosure ships ("Nutrition is unavailable right now. Try again
 * shortly." about a recipe the viewer is simply not permitted to read). This closes the OPEN question
 * recorded at `NUTRITION_FOOD_UNAVAILABLE`.
 *
 * ## Why this needs a test at all, when "renders nothing" is what happens by default
 *
 * Because the DEFAULT is not "nothing" — it is `undefined`, and `undefined` falls through. `RecipeNutritionResponse.nutrition`
 * is a `Record<string, RecipeNutritionState>`, and this repo does not enable `noUncheckedIndexedAccess`, so
 * `response.nutrition[missingId]` types as a `RecipeNutritionState` while being `undefined` at runtime. A host
 * that indexes it directly therefore gets NO compile error and three bad options at runtime, all of which look
 * plausible in review:
 *
 *   1. hand `undefined` to the chip's exhaustive `switch` (falls off the end — renders nothing today, throws
 *      the moment the switch gains a `default` that reports),
 *   2. keep the slot on its skeleton for want of an entry — **a skeleton that renders forever**, which is
 *      precisely the failure the three-state design exists to make unrepresentable, arriving through the one
 *      case nobody enumerated, or
 *   3. substitute `NUTRITION_FOOD_UNAVAILABLE`, which is the lie above.
 *
 * {@link selectRecipeCalorieState} exists to remove all three by making the absence a value the type system
 * forces a host to branch on: it returns `null`, which is NOT assignable to the chip's `nutrition`, so a host
 * that ignores it does not compile.
 *
 * REWRITTEN for ADR-0079: the host under test is the real one, `RecipeNutritionSlot` over a SETTLED batch reading,
 * where it used to be a hand-written host over the deleted `RecipeNutritionBoundary`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { RecipeNutritionSlot } from '../RecipeNutritionSlot.js';
import { NUTRITION_FOOD_UNAVAILABLE, selectRecipeCalorieState } from '../model.js';

afterEach(cleanup);

const PRESENT = '00000000-0000-4000-8000-00000000000a';
const OMITTED = '00000000-0000-4000-8000-00000000000b';

/** A response carrying one recipe and deliberately omitting another the caller asked about. */
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
    },
};

const withLocale = (ui: ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

/** The real host path: the page's batch has SETTLED with {@link RESPONSE}, and this card reads its own entry. */
const renderSlot = (recipeId: string) =>
    render(
        withLocale(
            <div>
                <span>sentinel</span>
                <RecipeNutritionSlot reading={{ status: 'settled', response: RESPONSE }} recipeId={recipeId} />
            </div>,
        ),
    );

describe('selectRecipeCalorieState', () => {
    it('returns the settled state for a recipe the response CARRIES', () => {
        expect(selectRecipeCalorieState(RESPONSE, PRESENT)).toMatchObject({ state: 'known', caloriesPerServing: 420 });
    });

    it('⛔ returns `null` — an explicit terminal decision — for a recipe the response OMITTED', () => {
        // `null`, never `undefined`: the whole point is that the absence is a VALUE a host must handle, not a
        // hole that flows onward and surfaces three components later.
        expect(selectRecipeCalorieState(RESPONSE, OMITTED)).toBeNull();
    });

    it('⛔ does NOT substitute `unaccounted` — food was fine; this recipe is simply not the viewer’s', () => {
        // The tempting near-miss. Today both render nothing on a card, so choosing wrong is invisible; the
        // detail disclosure turns it into a sentence about an outage that never happened.
        expect(selectRecipeCalorieState(RESPONSE, OMITTED)).not.toStrictEqual(NUTRITION_FOOD_UNAVAILABLE);
        expect(selectRecipeCalorieState(RESPONSE, OMITTED)).not.toMatchObject({ state: 'unaccounted' });
    });

    it('treats an entirely empty map the same way — every id is simply absent', () => {
        expect(selectRecipeCalorieState({ nutrition: {} }, PRESENT)).toBeNull();
    });

    it('⛔ is not fooled by an inherited property name — `toString` is not a nutrition reading', () => {
        // A `Record` index reaches the prototype chain, so a recipe id that happens to collide with an
        // `Object.prototype` member would otherwise return a FUNCTION where a state belongs.
        expect(selectRecipeCalorieState(RESPONSE, 'toString')).toBeNull();
        expect(selectRecipeCalorieState(RESPONSE, 'constructor')).toBeNull();
    });
});

describe('a host rendering an omitted recipe', () => {
    it('⛔ renders NOTHING — no chip, and above all NO skeleton left running', () => {
        // The load-bearing assertion of this file. A skeleton here would outlive a request that was never
        // made and could never settle: a spinner forever, on a card, for a recipe the viewer cannot see.
        renderSlot(OMITTED);

        expect(screen.getByText('sentinel')).toBeDefined();
        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
    });

    it('renders the chip for a recipe the response DID carry, so the assertion above is not vacuous', () => {
        renderSlot(PRESENT);

        expect(screen.getByRole('img', { name: /420/u })).toBeDefined();
    });
});
