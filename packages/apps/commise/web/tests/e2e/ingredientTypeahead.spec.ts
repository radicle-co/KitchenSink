import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Ingredient-typeahead trigger threshold (REQ-057) and the partial-nutrition disclosure gate (REQ-034),
 * driven through the real create wizard (Next dev server + Clerk session + client hooks + routing) with the
 * recipe-service HTTP contract intercepted (`utils/recipeApi`). REQ-057: the search box MUST NOT surface a
 * suggestion below 2 characters, even though the mocked search endpoint would return a match for any query.
 * REQ-034: the recipe-detail "nutrition includes USDA database items" notice renders ONLY when the recipe
 * carries at least one user-entered (freeform) ingredient — the all-catalog negative case is covered by
 * `recipeCrud.spec.ts`. Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('ingredient typeahead trigger + partial-nutrition disclosure (REQ-057 / REQ-034)', () => {
    test('gates suggestions below 2 characters; a freeform ingredient triggers the disclosure notice', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Herb Blend');
        await page.getByLabel('Description').fill('A pantry-forward herb blend.');
        await page.getByLabel('Cuisine').selectOption('French');
        await page.getByLabel('Servings').fill('4');
        await page.getByLabel('Prep time (minutes)').fill('5');
        await page.getByLabel('Cook time (minutes)').fill('0');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients).
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        const search = page.getByRole('searchbox', { name: 'Search ingredients' });

        // 003-FR-010a (plan U37) — below the three-character minimum no suggestion is ever offered, even
        // though the mocked search endpoint would return the catalog "Salt" fixture for any non-empty
        // query, AND the picker says why instead of rendering an empty panel. Asserted at BOTH one and two
        // characters: the old floor was two, so a case at one character alone would pass on a revert.
        await search.fill('s');
        await expect(
            page.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Salt', exact: true })).toHaveCount(0);

        await search.fill('sa');
        await expect(
            page.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Salt', exact: true })).toHaveCount(0);
        // ⛔ And the query-keyed affordances stay suppressed: "Find nutrition for “sa”" would fire the very
        // search the minimum gates, and the freeform control would mint a shared catalog row named "sa".
        await expect(page.getByRole('button', { name: /^Find nutrition for/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /custom ingredient$/ })).toHaveCount(0);

        // At three characters the (debounced) search settles and the catalog match appears.
        await search.fill('sal');
        await page.getByRole('button', { name: 'Salt', exact: true }).click();

        // Add a second, freeform ingredient (REQ-032a/b — not backed by the food database) — this is what
        // gates the REQ-034 disclosure notice on.
        await search.fill('dried thyme blend');
        await page.getByRole('button', { name: 'Add “dried thyme blend” as a custom ingredient' }).click();

        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Combine and store airtight.');

        await page.getByRole('button', { name: 'Next: Review' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Herb Blend' })).toBeVisible();
        // REQ-034 — the recipe now has a user-entered ingredient (the freeform blend), so the notice shows.
        await expect(
            page.getByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeVisible();
    });
});
