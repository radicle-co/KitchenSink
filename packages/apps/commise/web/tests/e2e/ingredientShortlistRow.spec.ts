import { expect, test, type Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { mockFoodApi, ownFoodLedger } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { ingredientOpen, openRecipeEditor } from './utils/recipeEditor';

/**
 * Row 7 (`docs/design/ingredientStatusExplanation.md` SPECIFY.1 row 7), through the real web app with the recipe
 * contract and food's progressive search intercepted: an `AMBIGUOUS` line's glyph opens a shortlist re-derived from the
 * food search over the line's own words, and one pick binds THAT line alone (owner ruling 2026-10-02). On a saved line
 * the pick is ONE rebind command at the line's stored position (`docs/design/rowEditorBlueprint.md` decision 7), and
 * no correction is written. None of these starts Change food. Selectors are role, label and text only.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-00000000002e';
const CANNED = { id: 'food_applesauce_canned', name: 'Applesauce, canned', score: 0.9 } as const;
const MINE = { id: 'food_my_applesauce', name: 'apple sauce, homemade', score: 0.7 } as const;

const ambiguousLine = (ingredientId: string, unit: string) =>
    ({
        ingredientId,
        name: 'apple sauce',
        quantity: { kind: 'exact', value: 1 },
        unit,
        isUserEntered: false,
        resolutionStatus: 'AMBIGUOUS',
    }) as const;

const savedRecipe = (viewerId: string): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Apple sauce cake',
        status: 'draft',
        currentVersion: 1,
        ingredients: [
            ambiguousLine('88888888-8888-4888-8888-888888888881', 'cup'),
            ambiguousLine('88888888-8888-4888-8888-888888888882', 'tbsp'),
        ],
    });

/** Sign in, stub both services, and open the saved recipe's ingredients. */
async function openIngredients(page: Page) {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId)] });
    const searches = await mockFoodApi(page, { catalog: () => [CANNED], authored: ownFoodLedger([MINE]) });
    const rebinds = await mockRebind(page, store, { foodNames: { [CANNED.id]: CANNED.name } });
    const corrections: unknown[] = [];

    page.on('request', (request) => {
        if (request.url().endsWith('/api/v1/ingredients/corrections') && request.method() === 'POST') {
            corrections.push(request.postDataJSON());
        }
    });
    await openRecipeEditor(page, RECIPE_ID);

    return { store, searches, rebinds, corrections, ingredients: page.getByRole('region', { name: 'Ingredients' }) };
}

test.describe('row 7: an AMBIGUOUS line picks from its own re-derived shortlist', () => {
    test('one pick is ONE rebind of that line at its stored position; its sibling is untouched; nothing is corrected', async ({
        page,
    }) => {
        const { store, searches, rebinds, corrections, ingredients } = await openIngredients(page);

        await ingredients.getByRole('button', { name: 'Choose a match: apple sauce' }).first().click();
        const list = page.getByRole('list', { name: 'Which “apple sauce” did you mean?' });

        await expect(
            page.getByText('Two or more foods match closely and their nutrition differs, so we’d rather you chose.'),
        ).toBeVisible();
        await expect(list.getByRole('button')).toHaveText([MINE.name, CANNED.name]);
        await list.getByRole('button', { name: CANNED.name }).click();

        // One pick binds one line: the first row names the food picked; its sibling still asks for a choice.
        await expect(ingredientOpen(ingredients, CANNED.name)).toBeVisible();
        await expect(ingredients.getByRole('button', { name: 'Choose a match: apple sauce' })).toHaveCount(1);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/0/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: CANNED.id } },
            ],
        ]);
        expect(store.get(RECIPE_ID)?.ingredients[1]?.resolutionStatus).toBe('AMBIGUOUS');
        expect(searches).toContainEqual({ route: 'progressive', query: 'apple sauce' });
        expect(corrections).toEqual([]);
    });

    test('None of these starts Change food on that line, and writes nothing', async ({ page }) => {
        const { rebinds, corrections, ingredients } = await openIngredients(page);

        await ingredients.getByRole('button', { name: 'Choose a match: apple sauce' }).first().click();
        await page.getByRole('button', { name: 'None of these — search for a different food' }).click();

        await expect(ingredients.getByRole('combobox', { name: 'Ingredient 1 name' })).toBeFocused();
        expect(rebinds).toEqual([]);
        expect(corrections).toEqual([]);
    });
});
