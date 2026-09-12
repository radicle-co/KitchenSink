/**
 * The pure half of the WITHDRAWN-FOOD surface (owner rulings 3 + 4, 2026-09-07): which lines lost their
 * food, and the one sentence the recipe shows about it.
 *
 * ## ⛔ The distinction this exists to protect
 *
 * `FOOD_REMOVED` sits between two neighbours it must never be confused with, and the whole vocabulary is
 * built to keep them apart:
 *
 * - **`RESOLVED_UNAVAILABLE`** — the food EXISTS and is not served to THIS viewer. A privacy answer;
 *   nothing is wrong, and for a different viewer the same line is fine.
 * - **`NOT_FOUND`** — no wired source ever had it. A food we never obtained.
 * - **`FOOD_REMOVED`** — we HAD it, and its author took it away. Permanent, true for everyone, and the
 *   line still knows its own name because the name belongs to the RECIPE.
 *
 * ## ⛔ Three separate strings, never one template with a number
 *
 * English pluralization is not a substitution, and the ALL case is not the plural case with a bigger count:
 * the plural copy points at the badges in the list, and those are SUPPRESSED when every line is removed
 * (a badge on every row is wallpaper, not signal), so reusing it would point a cook at nothing.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { allLinesFoodRemoved, foodRemovedCount, isLineFoodRemoved, removedFoodNotice } from '../model.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;

const removed = (id: string, name = 'Gran’s pie filling') =>
    makeIngredientView({ ingredientId: id, name, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED });

describe('isLineFoodRemoved', () => {
    it('is true for a line whose food was withdrawn', () => {
        expect(isLineFoodRemoved(removed('a'))).toBe(true);
    });

    it('⛔ is false for every other status, INCLUDING the two it is easiest to conflate', () => {
        for (const status of [
            FoodResolutionStatus.RESOLVED_UNAVAILABLE,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.FAILED,
            FoodResolutionStatus.NEEDS_REVIEW,
            FoodResolutionStatus.AMBIGUOUS,
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.RESOLVED,
        ]) {
            expect(isLineFoodRemoved(makeIngredientView({ resolutionStatus: status })), status).toBe(false);
        }
    });

    it('is false for a line with NO status at all', () => {
        expect(isLineFoodRemoved(makeIngredientView())).toBe(false);
    });
});

describe('foodRemovedCount', () => {
    it('counts only the removed lines', () => {
        expect(
            foodRemovedCount([
                removed('a'),
                makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.RESOLVED }),
                removed('c'),
            ]),
        ).toBe(2);
    });

    it('is 0 for a recipe with none', () => {
        expect(foodRemovedCount([makeIngredientView({ ingredientId: 'a' })])).toBe(0);
    });
});

describe('allLinesFoodRemoved', () => {
    it('is true when every line lost its food', () => {
        expect(allLinesFoodRemoved([removed('a'), removed('b')])).toBe(true);
    });

    it('is false when even one line survives', () => {
        expect(
            allLinesFoodRemoved([
                removed('a'),
                makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.RESOLVED }),
            ]),
        ).toBe(false);
    });

    it('⛔ is FALSE for an empty list — vacuous truth would claim a removal that never happened', () => {
        // `[].every(…)` is `true`, so the naive implementation announces "every ingredient here was removed"
        // on a recipe that has no ingredients at all. The tile would be a lie about an empty list.
        expect(allLinesFoodRemoved([])).toBe(false);
    });
});

describe('removedFoodNotice', () => {
    it('renders nothing when no line lost its food', () => {
        expect(removedFoodNotice([makeIngredientView({ ingredientId: 'a' })], en)).toBeUndefined();
    });

    it('⛔ NAMES the ingredient when exactly one was removed — a complete answer, no scanning', () => {
        const notice = removedFoodNotice(
            [removed('a', 'Gran’s pie filling'), makeIngredientView({ ingredientId: 'b' })],
            en,
        );

        expect(notice).toContain('Gran’s pie filling');
    });

    it('⛔ names the RECIPE`S LINE, which is the only name a viewer is entitled to', () => {
        // `RecipeIngredientView.name` belongs to the recipe, not the catalog row. A public recipe can be
        // read by someone with no entitlement to the food record — which is exactly what
        // `RESOLVED_UNAVAILABLE` exists to protect — so the tile must never reach for the food's name.
        const notice = removedFoodNotice([removed('a', 'my own secret blend')], en);

        expect(notice).toContain('my own secret blend');
    });

    it('COUNTS and points at the badges when two or more were removed', () => {
        const notice = removedFoodNotice([removed('a'), removed('b'), makeIngredientView({ ingredientId: 'c' })], en);

        expect(notice).toContain('2');
        // It must not name one of them and imply that is the whole story.
        expect(notice).not.toContain('Gran’s pie filling');
    });

    it('⛔ uses its OWN string when EVERY line was removed — the plural copy points at badges that are suppressed', () => {
        const notice = removedFoodNotice([removed('a'), removed('b')], en);

        expect(notice).toBe(en.removedFoodNoticeAll);
    });

    it('⛔ the singular case does NOT use the all-lines copy, even on a one-line recipe', () => {
        // A one-ingredient recipe whose only line was removed IS "all lines removed" arithmetically. The
        // singular string is still the better answer: it NAMES the ingredient, which the all-lines string
        // cannot, and the badge-suppression reason for the all-lines copy does not apply to a single row.
        const notice = removedFoodNotice([removed('a', 'Gran’s pie filling')], en);

        expect(notice).toContain('Gran’s pie filling');
        expect(notice).not.toBe(en.removedFoodNoticeAll);
    });

    it('⛔ every variant carries the reassurance — the answer to "is my recipe broken?"', () => {
        // The load-bearing half of this copy. A cook seeing a warning inside their own recipe fears the
        // recipe itself is damaged; saying in the same breath that the name and amount are unchanged is
        // what turns an alarm into information. If a translator drops it, this fails.
        const one = removedFoodNotice([removed('a')], en);
        const many = removedFoodNotice([removed('a'), removed('b'), makeIngredientView({ ingredientId: 'c' })], en);
        const all = removedFoodNotice([removed('a'), removed('b')], en);

        for (const notice of [one, many, all]) {
            expect(notice).toMatch(/unchanged/i);
        }
    });
});
