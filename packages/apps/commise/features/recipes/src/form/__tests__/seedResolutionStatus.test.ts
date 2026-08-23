/**
 * U14 — the editor seed carries a line's REAL resolution status, so a cook who opens a recipe to fix a
 * doubted line can see which one it is.
 *
 * ⛔ THE BUG THIS CLOSES. `toRecipeFormValues` hard-coded `resolutionStatus: 'RESOLVED'` for every persisted
 * line, on the reasoning that "a saved recipe's lines are, by definition, resolved". That was true while the
 * status only ever mirrored food-service's lifecycle. It stopped being true the moment the detail read began
 * publishing the verification gate's own verdict: a line the gate CONTRADICTED would open in the editor
 * badged "Resolved" — the exact opposite of what the recipe screen had just told the cook, on the one surface
 * where they can actually re-pick the food.
 *
 * The `?? 'RESOLVED'` fallback KEEPS the original reasoning for the case it was written for: a line the
 * server said nothing about is still a saved, resolved line, and it still shows the badge rather than none.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import { toRecipeFormValues } from '../model.js';

describe('toRecipeFormValues — the line resolution status (U14)', () => {
    const seed = (resolutionStatus?: (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus]) =>
        toRecipeFormValues(
            makeRecipeDetail({
                ingredients: [makeIngredientView(resolutionStatus === undefined ? {} : { resolutionStatus })],
                steps: [makeStepView()],
            }),
        );

    it('carries NEEDS_REVIEW through to the editor', () => {
        expect(seed(FoodResolutionStatus.NEEDS_REVIEW).ingredients[0]?.resolutionStatus).toBe(
            FoodResolutionStatus.NEEDS_REVIEW,
        );
    });

    it('carries a mirror status through unchanged', () => {
        expect(seed(FoodResolutionStatus.PENDING).ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.PENDING);
    });

    it('⛔ still defaults a status-less line to RESOLVED — a saved line shows a badge, not none', () => {
        expect(seed().ingredients[0]?.resolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
    });
});
