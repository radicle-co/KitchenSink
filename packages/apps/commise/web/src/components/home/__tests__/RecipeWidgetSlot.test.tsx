// @vitest-environment jsdom
/**
 * Component tests for the web recipe Home-widget slot (T104-web). The slot code-splits the real widget
 * through the descriptor loader (`next/dynamic`) and feeds it the viewer's recent recipes as a promise from
 * the injected recipe client, so these exercise the widget's three data states end-to-end: the skeleton
 * fallback while pending, the recent list when populated, and the empty state when the viewer has none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';

import { RecipeWidgetSlot } from '../RecipeWidgetSlot';

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

/** A minimal recipe client whose `listRecipes` returns the supplied page promise. */
const clientReturning = (page: () => Promise<{ data: readonly Recipe[] }>): RecipeServiceClient =>
    ({ listRecipes: () => page() }) as unknown as RecipeServiceClient;

const renderSlot = (client: RecipeServiceClient): void => {
    render(
        <LocaleProvider locale="en">
            <RecipeServiceProvider client={client}>
                <RecipeWidgetSlot />
            </RecipeServiceProvider>
        </LocaleProvider>,
    );
};

describe('RecipeWidgetSlot (web)', () => {
    it('shows the skeleton card (widget title, no recipes) while the recipes promise is pending', async () => {
        renderSlot(clientReturning(() => new Promise<{ data: readonly Recipe[] }>(() => {})));

        // The dynamic chunk resolves to the widget, which suspends on the never-settling promise → fallback.
        expect(await screen.findByText('Recent recipes', undefined, { timeout: 4000 })).toBeTruthy();
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();
    });

    it('renders the recent recipes once the promise resolves', async () => {
        renderSlot(
            clientReturning(() => Promise.resolve({ data: [makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })] })),
        );

        expect(await screen.findByText('Weeknight Pasta', undefined, { timeout: 4000 })).toBeTruthy();
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        renderSlot(clientReturning(() => Promise.resolve({ data: [] })));

        expect(
            await screen.findByText('No recipes yet. Create your first recipe to see it here.', undefined, {
                timeout: 4000,
            }),
        ).toBeTruthy();
    });

    it('renders a "see all recipes" entry point into the recipes surface', async () => {
        renderSlot(clientReturning(() => Promise.resolve({ data: [] })));

        const link = await screen.findByRole('link', { name: 'See all recipes' }, { timeout: 4000 });
        expect(link.getAttribute('href')).toContain('/recipes');
    });
});
