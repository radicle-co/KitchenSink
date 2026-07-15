import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Home widget-surface happy path (T104-e2e-web, US-000 / FR-046), driven through the real web UI (Next dev
 * server + Clerk session + the client hooks + routing) with the recipe-service + identity HTTP contract
 * intercepted (`utils/recipeApi`). It proves the three things the Home surface promises in v1: the recipe
 * (recent-recipes) widget renders from the viewer's recipes, the gated widgets (005–009) are ABSENT — not
 * empty tiles — and the widget's entry point navigates into the recipes surface. Selectors are role/label
 * only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
test.describe('Home widget surface (T104)', () => {
    test('renders the recipe widget, hides gated widgets, and its entry navigates to recipes', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'free',
            recipes: [makeRecipeDetail({ id: 'rec_home', ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        // Reload Home so the recent-recipes widget fetches against the mock (the first landing fired before
        // interception was installed).
        await page.goto(route('/'));

        // The Home widget surface and its region render.
        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();

        // The recipe (recent-recipes) widget renders with its heading and the viewer's recent recipe.
        await expect(page.getByRole('heading', { name: 'Recent recipes' })).toBeVisible();
        await expect(page.getByText('Weeknight Pasta')).toBeVisible();

        // Gated widgets (meal plan, nutrition, … backed by 005–009) are ABSENT in Home v1 — their feature
        // packages don't exist, so they are never registered, never rendered (not present-with-empty-state).
        await expect(page.getByRole('heading', { name: 'Meal plan' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Nutrition' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Resume cooking' })).toHaveCount(0);

        // Tapping the recipe widget's entry point navigates to the recipes surface.
        await page.getByRole('link', { name: 'See all recipes' }).click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
    });
});
