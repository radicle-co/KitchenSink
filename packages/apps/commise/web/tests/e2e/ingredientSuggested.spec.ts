import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { E2E_CATALOG_FOOD, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { ingredientOpen, openRecipeEditor } from './utils/recipeEditor';

/**
 * Suggested foods in the editor's add-ingredient field (owner ruling 2026-11-03; designer answer N2 in
 * `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`: the remembered food leads the list tagged "Suggested",
 * "never the active option when the list opens, so Enter alone does not pick it"; ADR-0070: the UI never auto-selects),
 * through the real web app with the recipe contract, food's progressive search and the name-proposals read intercepted.
 *
 * ⚠️ NOT YET RUN: written against `ingredientRowEditor.spec.ts`'s doubles without a browser session. The Maestro flow
 * `ingredientSuggested.yaml` is its mobile mirror. The per-state rules are pinned by the component tests
 * (`RecipeIngredientsFields.suggested.test.tsx`). Selectors are role, label and text only.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000031';
const PEPPER = E2E_CATALOG_FOOD;
const SUGGESTED_NAME = `${PEPPER.name}, suggested`;

async function openWithOneProposal(page: Page) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Suggested supper',
                status: 'draft',
                ingredients: [],
            }),
        ],
    });
    await mockFoodApi(page);
    // Registered after the doubles above: Playwright asks the newest route first.
    const asked: string[] = [];

    await page.route('**/api/v1/ingredients/by-name/proposals*', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('name') ?? '');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                phrase: 'pepper',
                proposals: [{ kind: 'root', id: PEPPER.foodId, name: PEPPER.name, source: 'ownCorrection' }],
            }),
        });
    });

    await openRecipeEditor(page, RECIPE_ID);
    const ingredients = page.getByRole('region', { name: 'Ingredients' });
    const field = ingredients.getByRole('combobox', { name: 'Add an ingredient' });

    await field.fill('pepper');
    await expect(page.getByRole('option', { name: SUGGESTED_NAME, exact: true })).toBeVisible();

    return { ingredients, field, asked };
}

test.describe('Suggested foods in the add-ingredient field', () => {
    test('the remembered food leads the list, tagged, and Enter alone picks nothing', async ({ page }) => {
        const { ingredients, field, asked } = await openWithOneProposal(page);

        expect(asked).toContain('pepper');
        // First in the list, with the tag drawn after the food.
        await expect(page.getByRole('option').first()).toHaveAccessibleName(SUGGESTED_NAME);
        await expect(page.getByRole('option').first()).toContainText('Suggested');
        // Nothing is active, so Enter chooses nothing: the list stays open and no line was added.
        await expect(field).not.toHaveAttribute('aria-activedescendant', /./);
        await field.press('Enter');
        await expect(page.getByRole('option', { name: SUGGESTED_NAME, exact: true })).toBeVisible();
        await expect(ingredientOpen(ingredients, PEPPER.name)).toHaveCount(0);
    });

    test('ArrowDown then Enter picks the Suggested food and the line is bound', async ({ page }) => {
        const { ingredients, field } = await openWithOneProposal(page);

        await field.press('ArrowDown');
        await expect(field).toHaveAttribute('aria-activedescendant', /./);
        await field.press('Enter');

        await expect(ingredientOpen(ingredients, PEPPER.name)).toBeVisible();
        await expect(page.getByRole('option', { name: SUGGESTED_NAME, exact: true })).toHaveCount(0);
    });

    test('a press on the Suggested option picks it', async ({ page }) => {
        const { ingredients } = await openWithOneProposal(page);

        await page.getByRole('option', { name: SUGGESTED_NAME, exact: true }).click();

        await expect(ingredientOpen(ingredients, PEPPER.name)).toBeVisible();
    });
});
