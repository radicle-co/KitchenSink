/**
 * Native component tests for the recipe Home widget — its prop-driven states on React Native (rendered
 * via react-native-web under jsdom): the loading skeleton, the populated recent-recipes list, the
 * MAX_RECENT_RECIPES cap, and the empty state. Mirrors the web widget's coverage for the `.native` tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Recipe } from '@kitchensink/recipe-core';

// Explicit `.native.js` — both tsc and the native config's resolver map this to RecipeHomeWidget.native.tsx,
// so the test typechecks against the NATIVE prop contract (recipes/isLoading), not the web (recipesPromise).
import RecipeHomeWidget from '../RecipeHomeWidget.native.js';

afterEach(cleanup);

const makeRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: 'rec_1',
    ownerId: 'usr_1',
    title: 'Weeknight Pasta',
    description: 'A quick dinner',
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 2,
    visibility: 'private',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: ['dinner'],
    hasPartialNutrition: false,
    currentVersion: 1,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

describe('RecipeHomeWidget (native)', () => {
    it('shows the loading skeleton (not the empty or list state) when isLoading', () => {
        render(<RecipeHomeWidget isLoading />);

        expect(screen.getByText('Recent recipes')).toBeTruthy(); // the card header
        expect(screen.queryByText(/No recipes yet/i)).toBeNull(); // not the empty state
        expect(screen.queryByText('Weeknight Pasta')).toBeNull(); // no recipe rows
    });

    it('renders the recent recipes when populated', () => {
        render(
            <RecipeHomeWidget
                recipes={[
                    makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
                    makeRecipe({ id: 'r2', title: 'Chana Masala' }),
                ]}
            />,
        );

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Chana Masala')).toBeTruthy();
    });

    it('caps the list at MAX_RECENT_RECIPES', () => {
        const many = Array.from({ length: 8 }, (_unused, index) =>
            makeRecipe({ id: `r${index}`, title: `Recipe ${index}` }),
        );

        render(<RecipeHomeWidget recipes={many} />);

        expect(screen.getAllByText(/^Recipe \d$/)).toHaveLength(4); // MAX_RECENT_RECIPES
    });

    it('renders the empty state when the viewer has no recipes', () => {
        render(<RecipeHomeWidget recipes={[]} />);

        expect(screen.getByText(/No recipes yet/i)).toBeTruthy();
    });
});
