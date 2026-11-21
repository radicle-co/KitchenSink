import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

const RECIPE_ID = 'ec000000-0000-4000-8000-0000000000c6';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const WEB_PAGE_LINE = 'This recipe stays private because it’s from a web page.';

/**
 * AE1 of board P6 (plan makePublicRefusalNotice), driven through the real web UI against the stateful recipe-service
 * contract mock (`utils/recipeApi`, which refuses a Make public with STATEMENT_REQUIRED and stores the answer as the service
 * does). A private recipe that owes a statement: the owner opens Make public, answers "From a web page", the recipe stays
 * private, the page says why in one standing line, and the menu no longer offers Make public. Role and label selectors
 * only. The real service's own rule is covered by its integration and e2e suites.
 */
test.describe('why a recipe cannot be public (P6)', () => {
    test('Make public, answered "From a web page": the page says why, once, and stops offering Make public', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const owed = makeRecipeDetail({
            id: RECIPE_ID,
            ownerId: viewerId,
            title: 'Pasted Soup',
            visibility: 'private',
        });
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [owed],
            statementOwedFor: [RECIPE_ID],
        });

        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await expect(page.getByRole('heading', { name: 'Pasted Soup' })).toBeVisible();
        // Nothing is wrong yet, so the page says nothing about why.
        await expect(page.getByText(WEB_PAGE_LINE)).toHaveCount(0);

        await page.getByRole('button', { name: /^More actions for /u }).click();
        await page.getByRole('menuitem', { name: 'Make public' }).click();
        await page
            .getByRole('alertdialog', { name: 'Make this recipe public?' })
            .getByRole('button', { name: 'Make public' })
            .click();

        const sheet = page.getByRole('dialog', { name: 'Where is this recipe from?' });

        await sheet.getByRole('radio', { name: 'From a web page' }).click();
        await sheet.getByRole('textbox', { name: 'Link to the page' }).fill(LINK);
        await sheet.getByRole('button', { name: 'Make public' }).click();

        // The one standing line is plain text, not an alert; a screen reader hears it once, from the polite status region.
        await expect(page.getByText(WEB_PAGE_LINE).filter({ visible: true })).toHaveCount(1);
        await expect(page.getByRole('status').filter({ hasText: WEB_PAGE_LINE })).toHaveCount(1);
        await expect(page.getByRole('alert').filter({ hasText: WEB_PAGE_LINE })).toHaveCount(0);

        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Make public' })).toHaveCount(0);
    });
});
