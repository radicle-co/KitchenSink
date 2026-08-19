import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Two recipe-detail user stories, driven through the real web UI with the recipe/identity HTTP contract
 * intercepted (`utils/recipeApi`):
 *
 *  1. **"I want to see the original source of the recipe, should there be one."** The claim this tier
 *     uniquely settles is that provenance reaches the recipe's OWN OWNER. Every earlier attempt rendered
 *     attribution inside the clone control, which the container mounts only for a viewer who can clone — a
 *     component test of that control passes happily while the owner's screen shows nothing. Here the signed-in
 *     viewer IS the owner, so the assertion cannot be satisfied by the old wiring. It also asserts the
 *     outbound-link safety attributes as the BROWSER sees them.
 *
 *  2. **"I want to scale the measurements and timing based on configurable serving sizes, defaulting to the
 *     serving size the user created it with."** Only a real browser proves the default, the recomputation and
 *     the disclosure happen together on the live page, over the real fetch — and that COOK TIME does not move
 *     while prep does.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** UUID-shaped ids: the recipe client parses outbound ids, so a slug is rejected before any request. */
const RECIPE_ID = {
    imported: 'dddddddd-4444-4444-8444-444444444444',
    own: 'eeeeeeee-5555-4555-8555-555555555555',
    scalable: 'ffffffff-6666-4666-8666-666666666666',
} as const;

test.describe('recipe detail — original source', () => {
    test('shows the source link to the recipe’s OWN OWNER, safely', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                makeRecipeDetail({
                    id: RECIPE_ID.imported,
                    // The viewer OWNS it — the state in which provenance used to be invisible.
                    ownerId: viewerId,
                    title: 'Imported Lamb',
                    sourceUrl: 'https://www.seriouseats.com/recipes/lamb',
                    sourceAttribution: 'Serious Eats',
                }),
            ],
        });

        await page.goto(route(`/recipes/${RECIPE_ID.imported}`));
        await expect(page.getByRole('heading', { level: 1, name: 'Imported Lamb' })).toBeVisible();

        // The link is named by the VERIFIED host, so the clickable label is where it actually goes; the
        // author's claim sits beside it as text.
        const link = page.getByRole('link', { name: 'www.seriouseats.com', exact: true });
        await expect(link).toBeVisible();
        await expect(page.getByText('Serious Eats')).toBeVisible();

        // Outbound safety as the browser sees it: no `window.opener` handle, no referrer, no link equity.
        await expect(link).toHaveAttribute('href', 'https://www.seriouseats.com/recipes/lamb');
        await expect(link).toHaveAttribute('target', '_blank');
        const rel = (await link.getAttribute('rel')) ?? '';
        expect(rel).toContain('noopener');
        expect(rel).toContain('noreferrer');
        expect(rel).toContain('nofollow');
    });

    test('shows no source affordance at all for a recipe that has none', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [makeRecipeDetail({ id: RECIPE_ID.own, ownerId: viewerId, title: 'My Own Pasta' })],
        });

        await page.goto(route(`/recipes/${RECIPE_ID.own}`));
        await expect(page.getByRole('heading', { level: 1, name: 'My Own Pasta' })).toBeVisible();

        // Absent source renders NOTHING — not an empty "Source" row.
        await expect(page.getByText('Source', { exact: true })).toHaveCount(0);
    });
});

test.describe('recipe detail — configurable serving size', () => {
    /** 4 servings, 15 min prep, 25 min cook, 45 min total (5 of them inactive), 2 tbsp of oil. */
    const scalable = (viewerId: string) =>
        makeRecipeDetail({
            id: RECIPE_ID.scalable,
            ownerId: viewerId,
            title: 'Scalable Stew',
            servings: 4,
            prepTimeMinutes: 15,
            cookTimeMinutes: 25,
            totalTimeMinutes: 45,
            steps: [{ stepNumber: 1, instruction: 'Simmer gently.', timerSeconds: 600 }],
        });

    test('opens at the author’s serving count and rescales the page from the control', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [scalable(viewerId)] });

        await page.goto(route(`/recipes/${RECIPE_ID.scalable}`));
        await expect(page.getByRole('heading', { level: 1, name: 'Scalable Stew' })).toBeVisible();

        const servings = page.getByLabel('Servings');
        // DEFAULT: the count the recipe was created with, and nothing announced as adjusted.
        await expect(servings).toHaveValue('4');
        await expect(page.getByText(/Adjusted from/)).toHaveCount(0);
        await expect(page.getByText('1 tsp')).toBeVisible();

        // Double it, one serving at a time through the real control.
        for (let i = 0; i < 4; i += 1) {
            await page.getByRole('button', { name: 'More servings' }).click();
        }

        await expect(servings).toHaveValue('8');
        await expect(page.getByText('2 tsp')).toBeVisible();
        await expect(page.getByText(/Adjusted from 4 servings/)).toBeVisible();
    });

    test('scales prep and total but NOT cook time, and says so', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [scalable(viewerId)] });

        await page.goto(route(`/recipes/${RECIPE_ID.scalable}`));
        await expect(page.getByRole('heading', { level: 1, name: 'Scalable Stew' })).toBeVisible();

        for (let i = 0; i < 4; i += 1) {
            await page.getByRole('button', { name: 'More servings' }).click();
        }

        // Prep 15 → 30, total 45 → 60 (the prep delta only, so the 5 inactive minutes survive) …
        await expect(page.getByText('30 min')).toBeVisible();
        await expect(page.getByText('60 min')).toBeVisible();
        // … and cook time is STILL 25. This is the assertion that fails if anyone "finishes the job" by
        // scaling every timing: a doubled batch does not bake twice as long, and saying it does is a
        // food-safety error, not a rounding difference.
        await expect(page.getByText('25 min')).toBeVisible();
        await expect(page.getByText('50 min')).toHaveCount(0);
        // The step timer is likewise untouched.
        await expect(page.getByText('600s timer')).toBeVisible();
        await expect(page.getByText(/Cook times and step timers are shown unchanged/)).toBeVisible();
    });

    test('scales back down to the count the recipe was created with', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [scalable(viewerId)] });

        await page.goto(route(`/recipes/${RECIPE_ID.scalable}`));
        const servings = page.getByLabel('Servings');
        await expect(servings).toHaveValue('4');

        await page.getByRole('button', { name: 'More servings' }).click();
        await expect(page.getByText(/Adjusted from 4 servings/)).toBeVisible();

        await page.getByRole('button', { name: 'Fewer servings' }).click();

        // Back at the author's yield the disclosure disappears — the page is the recipe as written again.
        await expect(servings).toHaveValue('4');
        await expect(page.getByText(/Adjusted from/)).toHaveCount(0);
        await expect(page.getByText('1 tsp')).toBeVisible();
    });
});
