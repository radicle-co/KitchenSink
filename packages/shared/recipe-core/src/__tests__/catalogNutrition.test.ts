/**
 * The two catalog-figure predicates both apps share (curated U15 §S15, plan 002 V1): which lines' catalog figures are
 * withheld, and whether a recipe counts any catalog figure at all. They live beside `hasUserEnteredIngredients`, the
 * other has-nutrition predicate, so the read view and the editor cannot disagree about one line.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY } from '../ingredientQuantity.js';
import { FoodResolutionStatus } from '../foodResolutionStatus.js';
import { hasCatalogNutrition, isCatalogWithheld } from '../nutrition.js';
import type { RecipeIngredientView } from '../recipe.types.js';

/** A stored line with no binding, overridden per case. */
function line(over: Partial<RecipeIngredientView>): RecipeIngredientView {
    return { ingredientId: 'ing_1', quantity: ABSENT_QUANTITY, isUserEntered: false, ...over };
}

describe('isCatalogWithheld', () => {
    it.each([
        [FoodResolutionStatus.NEEDS_REVIEW, true],
        [FoodResolutionStatus.PENDING_VERIFICATION, true],
        [FoodResolutionStatus.RESOLVED, false],
        [FoodResolutionStatus.AMBIGUOUS, false],
        [FoodResolutionStatus.FOOD_UNREACHABLE, false],
        [undefined, false],
    ])('%s → %s', (resolutionStatus, expected) => {
        expect(isCatalogWithheld({ resolutionStatus })).toBe(expected);
    });
});

describe('hasCatalogNutrition (curated U15, §S15)', () => {
    it.each([
        ['a line bound to a named food', true, line({ foodId: 'food_salt' })],
        [
            'a variant-bound line',
            true,
            line({ foodId: 'food_brisket', variant: { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat' }] } }),
        ],
        [
            'an AMBIGUOUS line, whose figure still counts (R23)',
            true,
            line({ foodId: 'food_salt', resolutionStatus: FoodResolutionStatus.AMBIGUOUS }),
        ],
        [
            'a line food could not be asked about (KTD-3b)',
            true,
            line({ resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE }),
        ],
        [
            'a line the gate contradicted',
            false,
            line({ foodId: 'food_salt', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
        ],
        [
            'a line the gate has not judged',
            false,
            line({ foodId: 'food_salt', resolutionStatus: FoodResolutionStatus.PENDING_VERIFICATION }),
        ],
        ['a user-entered line', false, line({ isUserEntered: true })],
        ['an unresolved line', false, line({ resolutionStatus: FoodResolutionStatus.UNRESOLVED })],
    ])('%s → %s', (_label, expected, ingredient) => {
        expect(hasCatalogNutrition([ingredient])).toBe(expected);
    });

    it('is false for a recipe with no lines', () => {
        expect(hasCatalogNutrition([])).toBe(false);
    });

    it('is true when any one line counts', () => {
        expect(hasCatalogNutrition([line({ isUserEntered: true }), line({ foodId: 'food_salt' })])).toBe(true);
    });
});
