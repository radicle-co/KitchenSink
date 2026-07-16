import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe CRUD happy path (T079): create → view → edit → delete, driven through the real web UI (Next dev
 * server + Clerk session + client hooks + routing) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`). The real backend is covered separately by the recipe-service's own e2e + k6. Owner
 * actions (edit/delete) gate on the Clerk `external_id` claim, so the mock seeds recipes owned by the live
 * viewer (see `readViewerAppId`). Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('recipe CRUD (T079)', () => {
    test('create → view → edit → delete a recipe', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        // The list surface renders with its chrome.
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        // CREATE — fill the form, resolve an ingredient via the typeahead, add a step, submit.
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        await page.getByLabel('Title').fill('E2E Ratatouille');
        await page.getByLabel('Servings').fill('4');
        await page.getByLabel('Prep time (minutes)').fill('15');
        await page.getByLabel('Cook time (minutes)').fill('30');
        // State a difficulty (FR-001b) — the picker is a radiogroup; select Hard.
        await page.getByRole('radio', { name: 'Hard' }).click();

        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');
        // Wait for the search RESULT button (exact 'Salt'), not the freeform "Add 'salt' as a custom
        // ingredient" fallback (which a substring match on 'Salt' would also hit); clicking it resolves the
        // ingredient line synchronously.
        await page.getByRole('button', { name: 'Salt', exact: true }).click();

        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Roast the vegetables.');

        await page.getByRole('button', { name: 'Create recipe' }).click();

        // VIEW — landed on the new recipe's detail.
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille' })).toBeVisible();
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0];
        expect(createdId).toBeTruthy();

        // EDIT — the edit form seeds from the recipe (already valid). The difficulty stated at create must have
        // round-tripped, so Hard is pre-selected. Change the title and CLEAR the difficulty ("Not stated"),
        // then save — the three-state update sends an explicit clear, not an omit.
        await page.goto(route(`/recipes/${createdId}/edit`));
        await expect(page.getByRole('radio', { name: 'Hard' })).toBeChecked();
        await page.getByLabel('Title').fill('E2E Ratatouille (edited)');
        await page.getByRole('radio', { name: 'Not stated' }).click();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toBeVisible();

        // The clear persisted: re-opening the editor shows Not stated selected, never the stale Hard.
        await page.goto(route(`/recipes/${createdId}/edit`));
        await expect(page.getByRole('radio', { name: 'Not stated' })).toBeChecked();
        await expect(page.getByRole('radio', { name: 'Hard' })).not.toBeChecked();

        // DELETE — confirm the destructive dialog, then land back on the list without the recipe.
        await page.getByRole('button', { name: 'Delete recipe' }).click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toHaveCount(0);
    });
});
