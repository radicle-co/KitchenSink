import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { addStep, openRecipeEditor, setServings } from './utils/recipeEditor';

/**
 * Ranged and absent ingredient quantities, end to end (U9 / R40, R42; acceptance AE20 + AE21).
 *
 * This is the INTEGRATION tier for the quantity model: the component suites prove each leaf renders each
 * member, and only a run through the real editor + router + client hooks proves the value object survives
 * being typed, submitted, re-read and re-seeded. Two round trips are exercised, because they fail
 * differently:
 *
 *   1. A RANGE — `2 to 3 cups`. The failure it guards is silent NARROWING: an editor that renders only the
 *      lower bound saves `2 cups` and every assertion about "the recipe was saved" still passes.
 *   2. An ABSENT quantity — a line stating no amount. The failure it guards is a form that can READ such a
 *      recipe and cannot SAVE it (the state U8 shipped: the draft holds `NaN`, and validation refused it),
 *      plus the opposite error of fabricating a `0`.
 *
 * The recipe-service HTTP contract is intercepted (`utils/recipeApi`), which round-trips the wire's
 * `exact | range | absent` union through the same zod schema the service publishes — so a body this editor
 * could not really have produced fails loudly in the double rather than passing quietly. Selectors are
 * role/label only (repo policy). Serial (Clerk-authed).
 */
test.describe('ranged + absent ingredient quantity (U9)', () => {
    test('states a range, renders it, and re-opens the editor with BOTH bounds', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        // Details.
        await page.getByLabel('Title').fill('E2E Range Loaf');
        await setServings(page, 4);

        // Ingredients — resolve a catalog line, then state a RANGE across the two bounds that share
        // the line's one unit field.
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        await page.getByLabel('Ingredient 1 quantity').fill('2');
        await page.getByLabel('Ingredient 1 maximum quantity').fill('3');
        await page.getByLabel('Ingredient 1 unit').fill('cups');

        await addStep(page, 'Mix and bake.');
        await page.getByRole('button', { name: 'Publish' }).click();

        // VIEW — the detail renders the SPAN, not its lower bound. The checkbox's accessible name is composed
        // from the same formatted quantity the sighted row shows, so asserting on it covers both.
        await expect(page.getByRole('heading', { name: 'E2E Range Loaf' })).toBeVisible();
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0];
        expect(createdId).toBeTruthy();
        await expect(page.getByRole('checkbox', { name: '2–3 cups Salt' })).toBeVisible();
        // The narrowing failure, stated as its own assertion so a regression names itself.
        await expect(page.getByRole('checkbox', { name: '2 cups Salt' })).toHaveCount(0);

        // EDIT — re-open and confirm the seed carries BOTH bounds, then widen the upper one and save.
        await openRecipeEditor(page, createdId ?? '');
        await expect(page.getByLabel('Ingredient 1 quantity')).toHaveValue('2');
        await expect(page.getByLabel('Ingredient 1 maximum quantity')).toHaveValue('3');

        await page.getByLabel('Ingredient 1 maximum quantity').fill('4');
        // Published now, so its one write is Save changes (slice 7, D1).
        await page.getByRole('button', { name: 'Save changes' }).click();

        await expect(page.getByRole('checkbox', { name: '2–4 cups Salt' })).toBeVisible();
    });

    test('states NO quantity, and the recipe stays editable and saveable (R40)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await page.goto(route('/recipes'));
        await page.getByRole('button', { name: 'New recipe' }).click();

        await page.getByLabel('Title').fill('E2E Grandmother Butter');

        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        // Clearing the amount is how an author states that the source gave none. The unit still carries the
        // prose the source DID give.
        await page.getByLabel('Ingredient 1 quantity').fill('');
        await page.getByLabel('Ingredient 1 unit').fill('the size of an egg');

        await addStep(page, 'Rub it in.');
        // ⛔ THE ASSERTION THIS SPEC EXISTS FOR: Publish must SUCCEED. Before U9 the draft held `NaN`, the
        // validator refused it, and this click left the author in the editor with no way forward.
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Grandmother Butter' })).toBeVisible();
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0];
        // No number is printed in front of a cook that their recipe never contained.
        await expect(page.getByRole('checkbox', { name: 'the size of an egg Salt' })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: '0 the size of an egg Salt' })).toHaveCount(0);

        // Re-opening the editor shows an EMPTY field, not a zero — and saving again keeps the amount absent.
        await openRecipeEditor(page, createdId ?? '');
        await expect(page.getByLabel('Ingredient 1 quantity')).toHaveValue('');
        await expect(page.getByLabel('Ingredient 1 maximum quantity')).toHaveValue('');

        // Save changes needs a change to save (slice 7): one that leaves the line alone, so the line round-trips.
        await page.getByLabel('Description').fill('Rubbed in by hand.');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('checkbox', { name: 'the size of an egg Salt' })).toBeVisible();
    });
});
