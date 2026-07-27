import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Home widget-surface happy path (T104-e2e-web, US-000 / FR-046 / CR-001), driven through the real web UI
 * (Next dev server + Clerk session + the client hooks + routing) with the recipe-service + identity HTTP
 * contract intercepted (`utils/recipeApi`). It proves what the Home surface promises in v1: the chrome and
 * the time-of-day greeting render; the recipe (recent-recipes) widget renders from the viewer's recipes; the
 * unshipped 005–009 cohort renders as SKELETON PLACEHOLDERS ("coming soon", never fabricated data — CR-001)
 * rather than being absent; and the widget's entry point navigates into the recipes surface. Selectors are
 * role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
test.describe('Home widget surface (T104)', () => {
    test('renders the chrome, recipe widget, roadmap placeholders, and navigates to recipes', async ({ page }) => {
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

        // The chrome renders: the sticky top bar (which NAMES this surface) and the primary nav landmark.
        // The bar's title is plain banner text, not a heading — the page's own sr-only <h1> is the document's
        // single level-1 heading, and a chrome heading duplicating a page title would be ambiguous.
        await expect(page.getByRole('banner').getByText('Home')).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();

        // The time-of-day greeting renders (any of the four buckets — the clock decides which).
        await expect(page.getByRole('heading', { name: /Chef/u })).toBeVisible();

        // The recipe (recent-recipes) widget renders with its heading and the viewer's recent recipe.
        await expect(page.getByRole('heading', { name: 'Recent recipes' })).toBeVisible();
        await expect(page.getByText('Weeknight Pasta')).toBeVisible();

        // The unshipped 005–009 widgets render as SKELETON PLACEHOLDERS — present (not absent), each a
        // labelled region announcing what is coming, with a visible "Coming soon".
        for (const title of ["Today's Nutrition", 'Resume cooking', "This Week's Meals"]) {
            const placeholder = page.getByRole('region', { name: title });
            await expect(placeholder).toBeVisible();
            await expect(placeholder.getByText('Coming soon')).toBeVisible();
        }

        // The CR-001 red line: a placeholder must NEVER show fabricated data. The nutrition placeholder shows
        // no calorie figures, percentage, or "cal" the mockup renders from real data.
        const nutrition = page.getByRole('region', { name: "Today's Nutrition" });
        await expect(nutrition.getByText(/\d/u)).toHaveCount(0);
        await expect(nutrition.getByText(/cal/iu)).toHaveCount(0);

        // Tapping the recipe widget's entry point navigates to the recipes surface.
        await page.getByRole('link', { name: 'See all recipes' }).click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        // …and the shell's top bar re-titles itself for the new surface (it used to say 'Home' everywhere).
        await expect(page.getByRole('banner').getByText('Recipes')).toBeVisible();
    });
});
