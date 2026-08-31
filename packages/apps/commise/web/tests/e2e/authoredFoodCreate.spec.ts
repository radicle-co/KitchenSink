import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U16 — the create-your-own-food story, driven through the real create wizard (Next dev server + Clerk
 * session + client hooks + routing) with the recipe-service HTTP contract intercepted.
 *
 * Playwright IS this feature's UI integration test (repo testing policy): what it proves beyond the
 * component tier is that the whole `POST /api/v1/ingredients/authored-food` → admitted-line → recipe
 * publish round-trip holds through the live client and the real wizard — the cook authors a food and
 * uses it in a recipe WITHOUT LEAVING THE PICKER FLOW (the unit's verification line), and the
 * per-author duplicate arm's reuse affordance attaches the existing food the same way.
 *
 * Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('create your own food from the ingredient picker (U16)', () => {
    test('authors a food inline, attaches it to the line, and the recipe publishes with it', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Grandma Blend Bowl');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2: nothing in the catalog matches — the create affordance is the door.
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('grandma blend zq');
        await page.getByRole('button', { name: 'Create your own food' }).click();

        // The form opens with the typed query prefilled, and the only-you promise on screen.
        const form = page.getByRole('form', { name: /Create .grandma blend zq./u });
        await expect(form).toBeVisible();
        await expect(form.getByLabel('Food name')).toHaveValue('grandma blend zq');
        await expect(page.getByText('Only you can see foods you create.')).toBeVisible();

        await form.getByLabel('Calories (kcal)').fill('100');
        await form.getByLabel('Protein (g)').fill('10');
        await form.getByLabel('Carbs (g)').fill('20');
        await form.getByLabel('Fat (g)').fill('5');
        await form.getByRole('button', { name: 'Create and add' }).click();

        // Create-and-attach: the line landed in ONE flow, named by the created food, Resolved.
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('grandma blend zq');
        await expect(page.getByLabel('Ingredient 1 status')).toHaveText('Resolved');

        // …and the id is real enough to publish with (the falsifiable end of the story).
        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Blend, then chill.');
        await page.getByRole('button', { name: 'Next: Review' }).click();
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByRole('heading', { name: 'E2E Grandma Blend Bowl' })).toBeVisible();
    });

    test('the per-author duplicate offers the EXISTING food, and the reuse affordance attaches it', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Duplicate Blend');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        /** Open the create form for `query` and submit a valid macro profile. */
        const createOnce = async (query: string): Promise<void> => {
            await page.getByRole('searchbox', { name: 'Search ingredients' }).fill(query);
            await page.getByRole('button', { name: 'Create your own food' }).click();
            const form = page.getByRole('form', { name: /Create /u });
            await form.getByLabel('Calories (kcal)').fill('100');
            await form.getByLabel('Protein (g)').fill('10');
            await form.getByLabel('Carbs (g)').fill('20');
            await form.getByLabel('Fat (g)').fill('5');
            await form.getByRole('button', { name: 'Create and add' }).click();
        };

        // First create lands as line 1.
        await createOnce('repeated blend zq');
        await expect(page.getByLabel('Ingredient 1 name')).toHaveValue('repeated blend zq');

        // The SAME name again: the duplicate arm renders its own sentence — not validation copy — with
        // the reuse affordance, and reusing attaches the EXISTING food as line 2.
        await createOnce('repeated blend zq');
        await expect(page.getByText('You already have a food named “repeated blend zq”.')).toBeVisible();
        await expect(page.getByText('Outside the allowed range')).toHaveCount(0);
        await page.getByRole('button', { name: 'Use that one' }).click();
        await expect(page.getByLabel('Ingredient 2 name')).toHaveValue('repeated blend zq');
    });

    test('inline validation renders per field and blocks the submit', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Invalid Blend');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('empty blend zq');
        await page.getByRole('button', { name: 'Create your own food' }).click();

        const form = page.getByRole('form', { name: /Create /u });
        await form.getByLabel('Carbs (g)').fill('150');
        await form.getByRole('button', { name: 'Create and add' }).click();

        // Three empty macros say Required; the out-of-bounds one names its own failure. No line landed.
        await expect(form.getByText('Required')).toHaveCount(3);
        await expect(form.getByText('Outside the allowed range')).toBeVisible();
        await expect(page.getByLabel('Ingredient 1 name')).toHaveCount(0);
    });
});
