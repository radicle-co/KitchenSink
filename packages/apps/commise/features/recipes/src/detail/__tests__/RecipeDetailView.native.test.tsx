/**
 * Native component tests for the recipe-detail view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across every content branch — header, meta, ingredients (incl. user-entered), instructions,
 * nutrition (complete vs partial), and photos (present vs absent) — so the two platform renders can't drift.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { makeIngredientView, makeNutrition, makePhoto, makeRecipeDetail } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';

afterEach(cleanup);

describe('RecipeDetailView (native)', () => {
    it('renders the title as a heading', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        expect(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('renders the description and badges', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ description: 'Tender and herby.', cuisine: 'Mediterranean' })}
            />,
        );

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
        expect(screen.getByText('Mediterranean')).toBeTruthy();
    });

    it('renders meta times and servings', () => {
        render(
            <RecipeDetailView recipe={makeRecipeDetail({ prepTimeMinutes: 15, totalTimeMinutes: 45, servings: 4 })} />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb leg', quantity: 1.5, unit: 'lbs' })],
                })}
            />,
        );

        expect(screen.getByText('Lamb leg')).toBeTruthy();
        expect(screen.getByText('1.5 lbs')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('renders a step instruction', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [{ stepNumber: 1, instruction: 'Rub the lamb.' }] })}
            />,
        );

        expect(screen.getByText('Rub the lamb.')).toBeTruthy();
    });

    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ calories: 520, proteinG: 32 }) })}
            />,
        );

        expect(screen.getByText('520')).toBeTruthy();
        expect(screen.getByText('32 g')).toBeTruthy();
    });

    it('shows the estimated indicator only when nutrition is incomplete', () => {
        const { unmount } = render(
            <RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })} />,
        );
        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })} />);
        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });

    it('renders the photo gallery only when the recipe has photos', () => {
        const { unmount } = render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [makePhoto()] })} />);
        expect(screen.getByLabelText('Recipe photos')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [] })} />);
        expect(screen.queryByLabelText('Recipe photos')).toBeNull();
    });
});
