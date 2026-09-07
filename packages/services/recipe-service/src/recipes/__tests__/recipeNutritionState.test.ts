/**
 * ⛔ THE ACCEPTANCE CRITERION for the deferred-nutrition wire union — the shape that makes a permanent
 * skeleton, and a fabricated `0`, unrepresentable rather than merely discouraged.
 *
 * ## Three states, and only two of them may cross the wire
 *
 * A card can be in three conditions: nutrition is **pending** (the request is in flight), **known**, or
 * **unaccounted** (we asked and there is no answer). The wire carries exactly TWO — `known` and
 * `unaccounted` — and that omission is the enforcement mechanism, not an oversight:
 *
 *   - **`pending` exists only on the client**, as the Suspense fallback while the promise is unsettled.
 *     The moment a server can emit `pending`, a skeleton can become permanent — a spinner that renders
 *     forever because a backend said so, with nothing to retry and nothing to time out.
 *   - **`unaccounted` is terminal.** It is the answer, not the absence of one, so it can never render a
 *     spinner.
 *
 * ## Why a discriminated union rather than optional fields
 *
 * The field this replaces, `hasPartialNutrition`, was a two-valued encoding of a three-valued fact, and it
 * was pinned `true` at three call sites to mean "not looked up" — a meaning its own docstring does not
 * carry ("some line could not be accounted for"). One field, two meanings, no discriminant. A reader
 * cannot distinguish "this recipe's nutrition is genuinely partial" from "nobody asked", and the UI
 * consequently could not decide whether to show a figure, a caveat, or nothing.
 *
 * ## The invariant KTD-3b exists for
 *
 * `calories: 0` is a factual claim that a dish contains no energy. An outage is not evidence for it. So
 * `known` REQUIRES a number — a zero there is a real measured zero — and every failure path lands in
 * `unaccounted`, which carries no figure at all.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { recipeNutritionResponseSchema, recipeNutritionStateSchema } from '../recipes.schema.js';

/** A well-formed `known` payload, so each test can vary one thing. */
const known = {
    state: 'known',
    caloriesPerServing: 437.5,
    proteinG: 15,
    carbsG: 87.5,
    fatG: 2.5,
    isComplete: true,
    freshness: 'fresh',
} as const;

describe('recipeNutritionStateSchema', () => {
    it('accepts a known reading, carrying its freshness', () => {
        expect(recipeNutritionStateSchema.parse(known)).toStrictEqual(known);
    });

    it('⛔ carries FRESHNESS on the wire — KTD-3b is "serve stale, MARKED"', () => {
        // The gateway has computed `freshness` since U10 and no consumer ever read it, so a reader served a
        // cached number during a food outage was never told. Serving stale silently is the half of KTD-3b
        // that makes it dishonest.
        expect(recipeNutritionStateSchema.parse({ ...known, freshness: 'stale' })).toMatchObject({
            freshness: 'stale',
        });
        expect(recipeNutritionStateSchema.safeParse({ ...known, freshness: 'absent' }).success).toBe(false);
        const { freshness: _dropped, ...withoutFreshness } = known;

        expect(recipeNutritionStateSchema.safeParse(withoutFreshness).success).toBe(false);
    });

    it('accepts every unaccounted reason', () => {
        for (const reason of [
            'no_resolved_ingredients',
            'no_nutrient_data',
            'food_unavailable',
            'verification_disagreement',
        ] as const) {
            expect(recipeNutritionStateSchema.parse({ state: 'unaccounted', reason })).toStrictEqual({
                state: 'unaccounted',
                reason,
            });
        }
    });

    it('⛔ keeps `verification_disagreement` DISTINCT from `food_unavailable` (U14)', () => {
        // The conflation this reason exists to prevent. A withheld line means the gate read the cook's own
        // source text and disagreed with our parse — the food service was reachable and answered. Reporting
        // it as an outage would tell a cook to "try again shortly" about an answer that will never change.
        const withheld = recipeNutritionStateSchema.parse({
            state: 'unaccounted',
            reason: 'verification_disagreement',
        });

        expect(withheld).not.toStrictEqual({ state: 'unaccounted', reason: 'food_unavailable' });
    });

    it('⛔ a client built before the fourth reason FAILS CLOSED on it, never mis-reads it as another', () => {
        // The wire-compatibility decision, asserted rather than asserted-in-prose. The `unaccounted` member is
        // `.strict()`, so it is closed to ANY additive change — a new sibling field would break an older
        // reader exactly as a new enum member does. What matters is the DIRECTION of the break: a stale
        // schema REFUSES the value outright, so an old client can never render a withheld figure as an
        // outage, a zero, or a number. It shows nothing, which is the only safe answer it can give.
        const priorGenerationReason = z.enum(['no_resolved_ingredients', 'no_nutrient_data', 'food_unavailable']);

        expect(priorGenerationReason.safeParse('verification_disagreement').success).toBe(false);
    });

    it('⛔ has NO `pending` member — a server must not be able to make a skeleton permanent', () => {
        // The single most important assertion in this file. `pending` is a client-side fallback with a
        // finite deadline; if it were a wire state, an origin could pin a spinner forever.
        expect(recipeNutritionStateSchema.safeParse({ state: 'pending' }).success).toBe(false);
        expect(recipeNutritionStateSchema.safeParse({ state: 'loading' }).success).toBe(false);
        expect(recipeNutritionStateSchema.safeParse({ state: 'unknown' }).success).toBe(false);
    });

    it('⛔ refuses an unaccounted reading that smuggles a figure', () => {
        // The exact shape of "0 calories because the lookup failed". `unaccounted` carries no number, so
        // there is nothing for a client to accidentally render.
        const smuggled = { state: 'unaccounted', reason: 'food_unavailable', caloriesPerServing: 0 };

        expect(recipeNutritionStateSchema.safeParse(smuggled).success).toBe(false);
    });

    it('⛔ refuses a known reading with NO figure — the other way to fabricate absence', () => {
        const { caloriesPerServing: _dropped, ...missing } = known;

        expect(recipeNutritionStateSchema.safeParse(missing).success).toBe(false);
        expect(recipeNutritionStateSchema.safeParse({ ...known, caloriesPerServing: null }).success).toBe(false);
    });

    it('accepts a REAL measured zero as known — an outage is not the only way to reach 0', () => {
        // Water, black coffee, a zero-calorie sweetener. This must stay renderable as "0 cal", which is
        // exactly why the invariant is enforced by the STATE rather than by treating 0 as absent.
        expect(recipeNutritionStateSchema.parse({ ...known, caloriesPerServing: 0 })).toMatchObject({
            state: 'known',
            caloriesPerServing: 0,
        });
    });

    it('⛔ refuses a negative figure', () => {
        expect(recipeNutritionStateSchema.safeParse({ ...known, caloriesPerServing: -1 }).success).toBe(false);
        expect(recipeNutritionStateSchema.safeParse({ ...known, proteinG: -1 }).success).toBe(false);
    });

    it('discriminates on `state`, so a mixed shape cannot satisfy both members', () => {
        expect(recipeNutritionStateSchema.safeParse({ ...known, reason: 'food_unavailable' }).success).toBe(false);
        expect(recipeNutritionStateSchema.safeParse({ state: 'unaccounted' }).success).toBe(false);
    });
});

describe('recipeNutritionResponseSchema', () => {
    it('maps recipe id to state — the shape the owner asked for', () => {
        const parsed = recipeNutritionResponseSchema.parse({
            nutrition: { '01JRECIPEA': known, '01JRECIPEB': { state: 'unaccounted', reason: 'no_nutrient_data' } },
        });

        expect(Object.keys(parsed.nutrition)).toStrictEqual(['01JRECIPEA', '01JRECIPEB']);
    });

    it('⛔ omits a recipe the caller may not read, rather than inventing a state for it', () => {
        // Visibility is enforced by ABSENCE from the map. Emitting `unaccounted` for another owner's
        // recipe would confirm the id exists, and emitting `known` would leak the figure itself.
        expect(recipeNutritionResponseSchema.parse({ nutrition: {} }).nutrition).toStrictEqual({});
    });
});
