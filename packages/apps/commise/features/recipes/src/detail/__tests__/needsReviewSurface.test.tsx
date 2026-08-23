// @vitest-environment jsdom
/**
 * U14 — the WEB half of the withheld-line surface: what a cook actually sees when the verification gate
 * contradicted one of their recipe's lines.
 *
 * ⛔ EVERY STATE, not the happy path. A badge that renders is worth nothing without the cases proving it does
 * NOT render — on a healthy line, on a line the gate agreed with, on a line with no verdict at all, and on
 * the terminal food-link statuses that mean something else entirely. The absence cases are where a
 * "helpfully" widened predicate would put a scary badge on every recipe in the library.
 *
 * The native mirror is `needsReviewSurface.native.test.tsx`; the two files assert the same set so the
 * platforms cannot drift on what a doubted line looks like (§14).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { utilityContrast } from '@commise/test-utils';

import { makeIngredientView, makeNutrition, makeRecipeDetail } from '../../__fixtures__/index.js';
import { RecipeDetailView } from '../RecipeDetailView.js';
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

describe('RecipeDetailView (web) — a line the verification gate contradicted', () => {
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
        // `@commise/ui`'s palette JSDoc is explicit that #F5B041 is a light FILL that takes a charcoal label:
        // as a foreground on near-white it is far under 4.5:1. Measured off the RENDERED class list rather
        // than a re-spelled one, so a later "tidy" of the utilities is caught here.
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        const badge = screen.getByText(en.needsReviewBadge);

        expect(utilityContrast(badge.className)).toBeGreaterThanOrEqual(4.5);
        expect(utilityContrast(screen.getByRole('note').className)).toBeGreaterThanOrEqual(4.5);
    });

    it('announces the disclosure as a NOTE, so it reaches a screen reader as a remark rather than prose', () => {
        render(<RecipeDetailView recipe={withheldRecipe()} />);

        // ⚠️ Queried by ROLE and then read, not `getByRole(..., { name })`: `note` does not take its
        // accessible name from content, so a name query would pass only if someone added an `aria-label`
        // that duplicates the sentence — which is exactly the redundancy this avoids.
        expect(screen.getByRole('note').textContent).toBe(en.needsReviewNoticeOne);
    });
});
