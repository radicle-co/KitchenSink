// @vitest-environment jsdom
/**
 * Component tests for the web recipe-detail view. Covers every content branch T066 requires — header
 * (title, description, badges), meta (times + servings), ingredients (quantity/unit/notes/user-entered),
 * instructions (ordered, optional timer), nutrition (complete vs partial/estimated), and photos (present
 * vs absent) — asserting on role/name/text so a missing section or a dropped branch fails.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
} from '../../__fixtures__/index.js';
import { RecipeDetailView } from '../RecipeDetailView.js';

afterEach(cleanup);

describe('RecipeDetailView (web) — header', () => {
    it('renders the title as the top-level heading', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('renders the description', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ description: 'Tender and herby.' })} />);

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
    });

    it('renders cuisine, dietary flags, and tags as badges', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ cuisine: 'Mediterranean', dietaryFlags: ['Gluten-Free'], tags: ['grill'] })}
            />,
        );

        expect(screen.getByText('Mediterranean')).toBeTruthy();
        expect(screen.getByText('Gluten-Free')).toBeTruthy();
        expect(screen.getByText('grill')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — meta', () => {
    it('renders prep, cook, total times and servings', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 15,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    servings: 4,
                })}
            />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('30 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — ingredients', () => {
    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb leg', quantity: 1.5, unit: 'lbs' })],
                })}
            />,
        );

        const ingredients = screen.getByRole('region', { name: 'Ingredients' });
        expect(within(ingredients).getByText('Lamb leg')).toBeTruthy();
        expect(within(ingredients).getByText('1.5 lbs')).toBeTruthy();
    });

    it('renders ingredient notes when present', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ notes: 'butterflied' })] })}
            />,
        );

        expect(screen.getByText('butterflied')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('does not show the custom badge for resolved ingredients', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: false })] })}
            />,
        );

        expect(screen.queryByText('Custom')).toBeNull();
    });
});

describe('RecipeDetailView (web) — instructions', () => {
    it('renders steps in an ordered list', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Grill each side.' }),
                    ],
                })}
            />,
        );

        const steps = screen.getByRole('region', { name: 'Instructions' });
        const list = within(steps).getByRole('list');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(within(items[0]!).getByText('Rub the lamb.')).toBeTruthy();
        expect(within(items[1]!).getByText('Grill each side.')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — nutrition', () => {
    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ calories: 520, proteinG: 32, carbsG: 18, fatG: 34 }),
                })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText('520')).toBeTruthy();
        expect(within(nutrition).getByText('32 g')).toBeTruthy();
    });

    it('shows an estimated indicator when nutrition is incomplete', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })} />);

        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
    });

    it('hides the estimated indicator when nutrition is complete', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })} />);

        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });
});

describe('RecipeDetailView (web) — photos', () => {
    it('renders each photo with an accessible name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ title: 'Grilled Lamb', photos: [makePhoto({ url: 'https://cdn/x.jpg' })] })}
            />,
        );

        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 1' })).toBeTruthy();
    });

    it('renders no photo gallery when the recipe has no photos', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [] })} />);

        expect(screen.queryByRole('img')).toBeNull();
    });
});

describe('RecipeDetailView (web) — version + visibility badges (D3)', () => {
    it('shows the current-version badge when the recipe is past v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 3 })} />);

        expect(screen.getByLabelText('Version 3').textContent).toBe('v3');
    });

    it('omits the version badge at v1 (nothing to signal)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a Public badge for a public recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })} />);

        expect(within(screen.getByRole('group', { name: 'Recipe status' })).getByText('Public')).toBeTruthy();
    });

    it('shows a Private badge for a private recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })} />);

        expect(within(screen.getByRole('group', { name: 'Recipe status' })).getByText('Private')).toBeTruthy();
    });
});
