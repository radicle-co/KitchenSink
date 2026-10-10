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
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000010',
                    ownerId: viewerId,
                    title: 'Weeknight Pasta',
                }),
            ],
        });

        // Reload Home so the recent-recipes widget fetches against the mock (the first landing fired before
        // interception was installed).
        await page.goto(route('/'));

        // The Home widget surface and its region render.
        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();

        // The chrome renders: no top bar since slice 3, and the one displayed primary nav landmark.
        await expect(page.getByRole('banner')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })).toHaveCount(1);

        // The time-of-day greeting renders. Anchored to the four buckets EXACTLY (this used to be a bare
        // `/Chef/u`, which a truncated greeting or a leaked `home.greetings.morning` dictionary key would still
        // satisfy), plus the long-date subtitle beneath it, which was asserted nowhere. This spec runs on the
        // real wall clock, so WHICH bucket is the clock's business — the guarantee that the VIEWER's clock is
        // the one consulted (#144) is gated in `visualRegression.spec.ts`, where the browser clock is pinned to
        // an instant the Next server cannot know.
        // Since slice 3 it IS the page's H1, naming the cook when there is a name (`buildSpec.md` §4.2).
        await expect(
            page.getByRole('heading', {
                level: 1,
                name: /^(Good (morning|afternoon|evening)(, .+)?|Still up(, .+)?\?)$/u,
            }),
        ).toBeVisible();
        await expect(page.getByText(/^\w+day, \w+ \d{1,2}, \d{4}$/u)).toBeVisible();

        // The recipe (recent-recipes) widget renders with its heading and the viewer's recent recipe.
        await expect(page.getByRole('heading', { name: 'Recent recipes' })).toBeVisible();
        await expect(page.getByText('Weeknight Pasta')).toBeVisible();

        // The unshipped 005–009 widgets render as SKELETON PLACEHOLDERS — present (not absent), grouped AFTER the
        // recent recipes under one "Coming soon" heading (owner ruling, buildSpec §4.2), each a labelled region with
        // a visible "Soon".
        const comingSoon = page.getByRole('region', { name: 'Coming soon' });
        await expect(comingSoon.getByRole('heading', { level: 2, name: 'Coming soon' })).toBeVisible();
        for (const title of ['Today’s nutrition', 'Resume cooking', 'This week’s meals']) {
            const placeholder = comingSoon.getByRole('region', { name: title });
            await expect(placeholder).toBeVisible();
            await expect(placeholder.getByText('Soon', { exact: true })).toBeVisible();
        }

        // The CR-001 red line: a placeholder must NEVER show fabricated data. The nutrition placeholder shows
        // no calorie figures, percentage, or "cal" the mockup renders from real data.
        const nutrition = page.getByRole('region', { name: 'Today’s nutrition' });
        await expect(nutrition.getByText(/\d/u)).toHaveCount(0);
        await expect(nutrition.getByText(/cal/iu)).toHaveCount(0);

        // Tapping the recipe widget's entry point navigates to the recipes surface.
        await page.getByRole('link', { name: 'See all recipes' }).click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        // …and the document title names the new page (slice 3 deleted the top bar that used to).
        await expect(page).toHaveTitle('Recipes · Commise');
    });
});
