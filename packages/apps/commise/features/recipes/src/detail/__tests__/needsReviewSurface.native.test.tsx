/**
 * U14 — the NATIVE half of the withheld-line surface (rendered via react-native-web under jsdom): what a cook
 * actually sees when the verification gate contradicted one of their recipe's lines.
 *
 * ⛔ EVERY STATE, not the happy path. A badge that renders is worth nothing without the cases proving it does
 * NOT render — on a healthy line, on a line the gate agreed with, on a line with no verdict at all, and on
 * the terminal food-link statuses that mean something else entirely. The absence cases are where a
 * "helpfully" widened predicate would put a scary badge on every recipe in the library.
 *
 * ⛔ A DELIBERATE MIRROR of `needsReviewSurface.test.tsx`, case for case. The cross-platform rule (§14) is
 * that a user-facing feature ships to BOTH platforms in the same release, and the only thing that actually
 * enforces it is two suites asserting the same behaviour — a shared model does not render anything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { computedContrast } from '@commise/test-utils';

import { makeIngredientView, makeNutrition, makeRecipeDetail } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;

afterEach(() => {
    cleanup();
    resetServingScale();
});

/** A recipe whose ONE line the gate contradicted. */
const withheldRecipe = () =>
    makeRecipeDetail({
        ingredients: [
            makeIngredientView({
                ingredientId: 'doubted',
                name: 'Plain flour',
                resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
            }),
        ],
    });

describe('RecipeDetailView (native) — a line the verification gate contradicted', () => {
    it('badges the doubted LINE, so a cook sees WHICH ingredient to fix', () => {
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        expect(screen.getByText(en.needsReviewBadge)).toBeTruthy();
    });

    it('discloses the withholding once for the whole recipe, in its own sentence', () => {
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        expect(screen.getByText(en.needsReviewNoticeOne)).toBeTruthy();
    });

    it('counts the doubted lines in the plural disclosure', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'a', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
                        makeIngredientView({ ingredientId: 'b', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
                        makeIngredientView({ ingredientId: 'c', name: 'Salt' }),
                    ],
                })}
            />,
        );

        expect(screen.getByText(/2 ingredients/u)).toBeTruthy();
        expect(screen.getAllByText(en.needsReviewBadge)).toHaveLength(2);
    });

    it('⛔ says NOTHING when the gate has judged nothing — absence of a verdict means publish', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [makeIngredientView()] })} />);

        expect(screen.queryByText(en.needsReviewBadge)).toBeNull();
        expect(screen.queryByText(en.needsReviewNoticeOne)).toBeNull();
    });

    it('⛔ says NOTHING when the gate AGREED', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ resolutionStatus: FoodResolutionStatus.RESOLVED })],
                })}
            />,
        );

        expect(screen.queryByText(en.needsReviewBadge)).toBeNull();
    });

    it('⛔ says NOTHING for a terminal FOOD-LINK status — that is a different fact with a different fix', () => {
        for (const status of [FoodResolutionStatus.NOT_FOUND, FoodResolutionStatus.FAILED] as const) {
            cleanup();
            render(
                <RecipeDetailView
                    recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ resolutionStatus: status })] })}
                />,
            );

            expect(screen.queryByText(en.needsReviewBadge)).toBeNull();
        }
    });

    it('⛔ says NOTHING for a line still resolving — PENDING is a wait, not a doubt', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ resolutionStatus: FoodResolutionStatus.PENDING })],
                })}
            />,
        );

        expect(screen.queryByText(en.needsReviewBadge)).toBeNull();
    });

    it('renders for an EMPTY recipe without claiming a doubt', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [] })} />);

        expect(screen.queryByText(en.needsReviewBadge)).toBeNull();
        expect(screen.queryByText(en.needsReviewNoticeOne)).toBeNull();
    });

    it('⛔ is DISTINGUISHABLE from the partial-nutrition caveat when BOTH apply', () => {
        // The conflation this surface exists to prevent, rendered. "Some items aren’t counted yet" says the
        // catalog had nothing; the review notice says the catalog HAD it and we held it back. A cook seeing
        // only one of the two cannot tell which of the two fixes applies.
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: false }),
                    ingredients: [
                        makeIngredientView({ ingredientId: 'a', resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }),
                    ],
                })}
            />,
        );

        expect(screen.getByText(en.nutritionPartial)).toBeTruthy();
        expect(screen.getByText(en.needsReviewNoticeOne)).toBeTruthy();
    });

    it('⛔ clears the AA body-text floor — a warning TINT under a charcoal label, never warning as text', () => {
        // The native mirror of the web contrast case. `@commise/ui`'s palette JSDoc is explicit that #F5B041
        // is a light FILL taking a charcoal label; as a foreground on near-white it is far under 4.5:1.
        // `computedContrast` reads the colour react-native-web actually compiled, not the style object.
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        expect(computedContrast(screen.getByText(en.needsReviewBadge)), 'needs-review badge').toBeGreaterThanOrEqual(
            4.5,
        );
        expect(computedContrast(screen.getByRole('note')), 'needs-review notice').toBeGreaterThanOrEqual(4.5);
    });

    it('announces the disclosure as a NOTE, so it reaches a screen reader as a remark rather than prose', () => {
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        // `role="note"` on the native leaf (RN's older `accessibilityRole` union has no `note` member), which
        // react-native-web renders as `role="note"` — the same guarantee the web leaf gives, same query.
        expect(screen.getByRole('note').textContent).toBe(en.needsReviewNoticeOne);
    });
});
