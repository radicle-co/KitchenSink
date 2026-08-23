/**
 * U14 — the pure half of the withheld-line surface: which lines the verification gate doubted, and the one
 * sentence a recipe shows when its figure was withheld because of them.
 *
 * ⛔ THE DISTINCTION THIS EXISTS TO PROTECT. A line the gate contradicted is NOT a line with no nutrition
 * data: the food service answered, the catalog had the figure, and we declined to publish it. Telling a cook
 * "no nutrition data" — or worse, "try again shortly" — about an answer that will never change is the
 * conflation plan U14 forbids, so the badge and the notice are their own copy and their own predicate.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { needsReviewCount, needsReviewNotice, isLineNeedsReview } from '../model.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;

describe('isLineNeedsReview', () => {
    it('is true for a line the gate CONTRADICTED', () => {
        expect(isLineNeedsReview(makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }))).toBe(
            true,
        );
    });

    it('⛔ is false for every other status — only an explicit contradiction is a doubt', () => {
        for (const status of ['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED'] as const) {
            expect(isLineNeedsReview(makeIngredientView({ resolutionStatus: status }))).toBe(false);
        }
    });

    it('⛔ is false for a line with NO status — absence of a verdict means publish (0023)', () => {
        expect(isLineNeedsReview(makeIngredientView())).toBe(false);
    });
});

describe('needsReviewCount', () => {
    it('counts only the doubted lines', () => {
        expect(
            needsReviewCount([
                makeIngredientView({ ingredientId: 'a', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
                makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.RESOLVED }),
                makeIngredientView({ ingredientId: 'c', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
            ]),
        ).toBe(2);
    });

    it('is 0 for an empty recipe', () => {
        expect(needsReviewCount([])).toBe(0);
    });
});

describe('needsReviewNotice', () => {
    it('says nothing when no line is doubted', () => {
        expect(needsReviewNotice([makeIngredientView()], en)).toBeUndefined();
    });

    it('names the SINGULAR case with its own sentence', () => {
        const notice = needsReviewNotice(
            [makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW })],
            en,
        );

        expect(notice).toBe(en.needsReviewNoticeOne);
    });

    it('fills the count into the PLURAL template — never a concatenated number', () => {
        const notice = needsReviewNotice(
            [
                makeIngredientView({ ingredientId: 'a', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
                makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
            ],
            en,
        );

        expect(notice).toContain('2');
        expect(notice).not.toContain('{count}');
    });

    it('⛔ reads DIFFERENTLY from the partial-nutrition caveat — the two are not the same fact', () => {
        // "Some items aren't counted yet" means the catalog had nothing. This means the catalog HAD it and we
        // withheld it. A cook who cannot tell those apart cannot act on either.
        expect(en.needsReviewNoticeOne).not.toBe(en.nutritionPartial);
        expect(en.needsReviewBadge).not.toBe(en.userEnteredBadge);
    });
});
