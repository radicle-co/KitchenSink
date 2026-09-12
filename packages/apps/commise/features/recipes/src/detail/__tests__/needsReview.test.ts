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
import {
    ambiguityReviewLines,
    ambiguousNotice,
    clonePrivateFoodsBannerText,
    isLineAmbiguous,
    isLineNeedsReview,
    needsReviewCount,
    needsReviewNotice,
    reviewRowsGone,
} from '../model.js';
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

/** One ingredient view with the given line status and name — the U13 suite's fixture. */
function line(status: string | undefined, name = 'probe'): ReturnType<typeof makeIngredientView> {
    return makeIngredientView({
        name,
        ...(status === undefined ? {} : { resolutionStatus: status as never }),
    });
}

describe('the U13 ambiguity surface model (D7/R9)', () => {
    const notices = {
        ambiguousNoticeOne: 'ONE could match more.',
        ambiguousNoticeMany: '{count} could match more.',
    };

    it('isLineAmbiguous keys ONLY off AMBIGUOUS — needs-review and pending stay their own affordances', () => {
        expect(isLineAmbiguous(line('AMBIGUOUS'))).toBe(true);
        expect(isLineAmbiguous(line('NEEDS_REVIEW'))).toBe(false);
        expect(isLineAmbiguous(line('PENDING_VERIFICATION'))).toBe(false);
        expect(isLineAmbiguous(line(undefined))).toBe(false);
    });

    /**
     * Owner ruling 2026-10-02 ("Fix one line at a time"): one pick fixes ONE line, so the review lists LINES. This
     * replaces the gap-18 fold, which grouped same-named lines under one pick that bound them all.
     */
    it('ambiguityReviewLines: one row per AMBIGUOUS line, same-named lines included, each at its STORED position', () => {
        const lines = [
            line('RESOLVED', 'flour'),
            line('AMBIGUOUS', 'apple sauce'),
            line('AMBIGUOUS', 'Apple Sauce'),
            line('NEEDS_REVIEW', 'butter'),
            line('AMBIGUOUS', 'apple sauce'),
        ];

        expect(ambiguityReviewLines(lines)).toStrictEqual([
            { position: 1, name: 'apple sauce', line: lines[1] },
            { position: 2, name: 'Apple Sauce', line: lines[2] },
            { position: 4, name: 'apple sauce', line: lines[4] },
        ]);
    });

    it('ambiguityReviewLines: a line with NO name has nothing to search, so it forms no row (plan 002 R9)', () => {
        const { name: _none, ...nameless } = line('AMBIGUOUS', 'unused');
        const brandy = line('AMBIGUOUS', 'brandy');

        // The nameless line still holds position 0, so brandy's rebind goes to position 1.
        expect(ambiguityReviewLines([nameless, brandy])).toStrictEqual([{ position: 1, name: 'brandy', line: brandy }]);
    });

    /**
     * The focus signal for a row that went: a taken pick's row leaves only when the detail read shows its line resolved,
     * which can land after the pick reports success. It must not advance before then, or focus is moved while the
     * pressed candidate still holds it and is then dropped when the row goes.
     */
    it.each([
        { what: 'before any pick', saves: 0, takenAt: undefined, listed: [1, 2], gone: 0 },
        { what: 'a pick taken, its row still listed', saves: 1, takenAt: 2, listed: [1, 2], gone: 0 },
        { what: 'a pick taken, its row gone', saves: 1, takenAt: 2, listed: [1], gone: 1 },
        { what: 'the next pick in flight', saves: 1, takenAt: undefined, listed: [1], gone: 1 },
        { what: 'the next pick taken, its row still listed', saves: 2, takenAt: 1, listed: [1], gone: 1 },
        { what: 'the next pick taken, its row gone', saves: 2, takenAt: 1, listed: [], gone: 2 },
    ])('reviewRowsGone: $what → $gone', ({ saves, takenAt, listed, gone }) => {
        const lines = listed.map((position) => ({ position, name: 'apple sauce', line: line('AMBIGUOUS') }));

        expect(reviewRowsGone(saves, takenAt, lines)).toBe(gone);
    });

    it('ambiguousNotice: absent at zero, singular at one, counted template above', () => {
        expect(ambiguousNotice([line('RESOLVED')], notices)).toBeUndefined();
        expect(ambiguousNotice([line('AMBIGUOUS')], notices)).toBe('ONE could match more.');
        expect(ambiguousNotice([line('AMBIGUOUS', 'a'), line('AMBIGUOUS', 'b')], notices)).toBe('2 could match more.');
    });

    it('clonePrivateFoodsBannerText: only when the clone kept private-food lines, singular for one', () => {
        const banner = {
            clonePrivateFoodsBannerOne: 'One is private.',
            clonePrivateFoodsBannerMany: '{count} are private.',
        };

        expect(clonePrivateFoodsBannerText(undefined, banner)).toBeUndefined();
        expect(clonePrivateFoodsBannerText(0, banner)).toBeUndefined();
        expect(clonePrivateFoodsBannerText(1, banner)).toBe('One is private.');
        expect(clonePrivateFoodsBannerText(3, banner)).toBe('3 are private.');
    });
});
