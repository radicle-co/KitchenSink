// @vitest-environment jsdom
/**
 * Component tests for the web recipe Home widget — its Suspense-driven states: the skeleton fallback
 * while the recipes promise is pending, the recent-recipes list once it resolves, and the empty state
 * when the viewer has none. (Loading is a `<Suspense>` boundary, not an `isLoading` flag.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import type { Recipe } from '@kitchensink/recipe-core';

import RecipeHomeWidget from '../RecipeHomeWidget.js';

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

describe('RecipeHomeWidget (web)', () => {
    it('shows the skeleton fallback while the recipes promise is pending', () => {
        // A promise that never settles keeps the widget suspended → the fallback is rendered.
        const { container } = render(<RecipeHomeWidget recipesPromise={new Promise<readonly Recipe[]>(() => {})} />);

        expect(screen.getByText('Recent recipes')).toBeTruthy(); // the card title
        expect(container.querySelector('[role="presentation"]')).not.toBeNull(); // the skeleton
        expect(screen.queryByRole('article')).toBeNull(); // no recipe rows yet
        expect(screen.queryByText(/No recipes yet/i)).toBeNull(); // and NOT the empty state
    });

    it('renders the recent recipes once the promise resolves', async () => {
        const recipes = [
            makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'r2', title: 'Chana Masala' }),
        ];

        // act flushes the promise resolution + Suspense retry so the content replaces the fallback.
        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve(recipes)} />);
        });

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Chana Masala')).toBeTruthy();
        expect(screen.queryByRole('presentation')).toBeNull(); // skeleton gone
    });

    it('caps the list at MAX_RECENT_RECIPES', async () => {
        const many = Array.from({ length: 8 }, (_unused, index) =>
            makeRecipe({ id: `r${index}`, title: `Recipe ${index}` }),
        );

        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve(many)} />);
        });

        expect(screen.getAllByRole('article')).toHaveLength(4); // MAX_RECENT_RECIPES
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        await act(async () => {
            render(<RecipeHomeWidget recipesPromise={Promise.resolve<readonly Recipe[]>([])} />);
        });

        expect(screen.getByText(/No recipes yet/i)).toBeTruthy();
        expect(screen.queryByRole('article')).toBeNull();
    });
});
