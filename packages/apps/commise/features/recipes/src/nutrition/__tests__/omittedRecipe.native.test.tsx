// @vitest-environment jsdom
/**
 * ⛔ THE OMITTED RECIPE on NATIVE — the same tests as `omittedRecipe.test.tsx`, against the native leaf.
 *
 * The cross-platform rule is not satisfied by the model test alone: `selectRecipeCalorieState` is shared, but
 * the RENDER decision it drives is made by a different component tree on each platform, and "renders nothing,
 * and above all no skeleton" is a claim about that tree. A web-only assertion would leave the permanent-
 * skeleton failure mode unproven on the platform where a spinner is hardest to notice.
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
 *   2. skip creating the promise and leave the boundary mounted with nothing to settle — **a skeleton that
 *      renders forever**, which is precisely the failure the three-state design exists to make
 *      unrepresentable, arriving through the one case nobody enumerated, or
 *   3. substitute `NUTRITION_FOOD_UNAVAILABLE`, which is the lie above.
 *
 * {@link selectRecipeCalorieState} exists to remove all three by making the absence a value the type system
 * forces a host to branch on: it returns `null`, which is NOT assignable to the boundary's promise, so a host
 * that ignores it does not compile.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeNutritionBoundary } from '../RecipeNutritionBoundary.native.js';
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

/**
 * The HOST decision, written exactly as a real surface must write it: select, then branch. The `null` arm is
 * what the type system forces, and this helper exists so both arms are exercised by the same code path — a
 * "renders nothing" assertion against a helper that only ever renders nothing would prove nothing.
 */
const HostSlot = ({ recipeId }: { readonly recipeId: string }): ReactElement => {
    const state = selectRecipeCalorieState(RESPONSE, recipeId);

    return (
        <>
            <span>sentinel</span>
            {state === null ? null : <RecipeNutritionBoundary nutritionPromise={Promise.resolve(state)} />}
        </>
    );
};

const renderSlot = async (recipeId: string) =>
    act(async () => {
        render(withLocale(<HostSlot recipeId={recipeId} />));
    });

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
    it('⛔ renders NOTHING — no chip, and above all NO skeleton left running', async () => {
        // The load-bearing assertion of this file. A skeleton here would outlive a request that was never
        // made and could never settle: a spinner forever, on a card, for a recipe the viewer cannot see.
        await renderSlot(OMITTED);

        expect(screen.getByText('sentinel')).toBeDefined();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText(/cal/u)).toBeNull();
    });

    it('renders the chip for a recipe the response DID carry, so the assertion above is not vacuous', async () => {
        await renderSlot(PRESENT);

        expect(screen.getByRole('img', { name: /420/u })).toBeDefined();
    });
});
