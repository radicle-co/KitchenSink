import { expect, test } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi, ownFoodLedger } from './utils/foodApi';
import { addStep, ingredientOpen, openNewRecipe } from './utils/recipeEditor';

/**
 * U16 — the create-your-own-food story, driven through the real one-page editor (Next dev server + Clerk
 * session + client hooks + routing) with the recipe-service HTTP contract intercepted.
 *
 * Playwright IS this feature's UI integration test (repo testing policy): what it proves beyond the
 * component tier is that the whole food `POST /api/v1/foods/authored` → recipe `POST /api/v1/ingredients/by-food` →
 * line → recipe publish round-trip holds through the live clients and the real editor (plan 002 S5.5) — the cook
 * authors a food and uses it in a recipe WITHOUT LEAVING THE ADD ROW (the unit's verification line), and food's
 * per-author duplicate offers the existing food, which Use that one admits the same way.
 *
 * Since plan 002 V1 B8 the door is the LAST option of the trailing "Add an ingredient" list (O3 ruling,
 * `docs/design/rowEditorOpenDecisions.md` item 1), and the form is the authored-food Sheet, a dialog.
 *
 * Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('create your own food from the trailing add row (U16, B8)', () => {
    test('authors a food inline, attaches it to the line, and the recipe publishes with it', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownFoods = ownFoodLedger();
        await mockRecipeApi(page, { viewerId, tier: 'premium', ownFoods });
        await mockFoodApi(page, { authored: ownFoods });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Grandma Blend Bowl');
        await page.getByRole('radio', { name: 'Easy' }).click();

        // Ingredients: the food is not listed, so the create option is the door, and it is the list's LAST option (O3).
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('grandma blend zq');
        const list = page.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });
        await expect(list.getByRole('option').last()).toHaveText('Create my own food');
        await list.getByRole('option', { name: 'Create my own food' }).click();

        // The form opens with the typed text prefilled, and the only-you promise on screen.
        const form = page.getByRole('dialog', { name: 'Create “grandma blend zq”' });
        await expect(form).toBeVisible();
        await expect(form.getByLabel('Food name')).toHaveValue('grandma blend zq');
        await expect(page.getByText('Only you can see foods you create.')).toBeVisible();

        await form.getByLabel('Calories (kcal)').fill('100');
        await form.getByLabel('Protein (g)').fill('10');
        await form.getByLabel('Carbs (g)').fill('20');
        await form.getByLabel('Fat (g)').fill('5');
        const created = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/foods/authored') && request.method() === 'POST',
        );
        const admitted = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/by-food') && request.method() === 'POST',
        );
        await form.getByRole('button', { name: 'Create and add' }).click();

        // Food made the food, and recipe admitted the id food answered (S5.5).
        expect((await created).postDataJSON()).toEqual({
            name: 'grandma blend zq',
            macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
        });
        expect((await admitted).postDataJSON()).toEqual({ foodId: ownFoods.foods[0]?.id });

        // The line landed in ONE flow, named by the created food, matched.
        // REWRITTEN for the read rows (build spec §7.5.1): a matched row is quiet, its open control named for its food,
        // with no attention line.
        await expect(ingredientOpen(page, 'grandma blend zq')).toBeVisible();
        await expect(page.getByRole('button', { name: /: grandma blend zq$/u })).toHaveCount(0);

        // …and the id is real enough to publish with (the falsifiable end of the story).
        await addStep(page, 'Blend, then chill.');
        await page.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByRole('heading', { name: 'E2E Grandma Blend Bowl' })).toBeVisible();
    });

    test('the per-author duplicate offers the EXISTING food, and the reuse affordance attaches it', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownFoods = ownFoodLedger();
        await mockRecipeApi(page, { viewerId, tier: 'premium', ownFoods });
        await mockFoodApi(page, { authored: ownFoods });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Duplicate Blend');
        await page.getByRole('radio', { name: 'Easy' }).click();

        /** Open the create form for `query` and submit a valid macro profile. */
        const createOnce = async (query: string): Promise<void> => {
            await page.getByRole('combobox', { name: 'Add an ingredient' }).fill(query);
            await page.getByRole('option', { name: 'Create my own food' }).click();
            const form = page.getByRole('dialog', { name: /^Create /u });
            await form.getByLabel('Calories (kcal)').fill('100');
            await form.getByLabel('Protein (g)').fill('10');
            await form.getByLabel('Carbs (g)').fill('20');
            await form.getByLabel('Fat (g)').fill('5');
            await form.getByRole('button', { name: 'Create and add' }).click();
        };

        // First create lands as line 1.
        await createOnce('repeated blend zq');
        await expect(ingredientOpen(page, 'repeated blend zq')).toHaveCount(1);

        // The SAME name again: the duplicate arm renders its own sentence — not validation copy — with
        // the reuse affordance, and reusing attaches the EXISTING food as line 2.
        await createOnce('repeated blend zq');
        await expect(page.getByText('You already have a food named “repeated blend zq”.')).toBeVisible();
        await expect(page.getByText('Outside the allowed range')).toHaveCount(0);
        await page.getByRole('button', { name: 'Use that one' }).click();
        await expect(ingredientOpen(page, 'repeated blend zq')).toHaveCount(2);
    });

    test('inline validation renders per field and blocks the submit', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ownFoods = ownFoodLedger();
        await mockRecipeApi(page, { viewerId, tier: 'premium', ownFoods });
        await mockFoodApi(page, { authored: ownFoods });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Invalid Blend');
        await page.getByRole('radio', { name: 'Easy' }).click();

        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('empty blend zq');
        await page.getByRole('option', { name: 'Create my own food' }).click();

        const form = page.getByRole('dialog', { name: /^Create /u });
        await form.getByLabel('Carbs (g)').fill('150');
        await form.getByRole('button', { name: 'Create and add' }).click();

        // Three empty macros say Required; the out-of-bounds one names its own failure. No line landed.
        await expect(form.getByText('Required')).toHaveCount(3);
        await expect(form.getByText('Outside the allowed range')).toBeVisible();
        await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    });
});
