import { expect, test, type Page } from '@playwright/test';
import type { CatalogSearchResultView } from '@kitchensink/food-service-client';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockFoodApi } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Curated AE3 (`docs/brainstorms/2026-09-26-curated-food-catalog-requirements.md`; `docs/design/ingredientSpecialization.md`
 * §S2), through the real web app with the recipe contract and food's progressive search intercepted: words that name
 * exactly one variant of a root find that root carrying the variant, and picking it binds the variant, so the line
 * shows the root's name with the dotted line under it. Words that name several variants, or none, find the root alone, and
 * picking it binds the root.
 *
 * Here the search is a saved line's Change food, so each pick is ONE rebind command at the line's stored position
 * (`docs/design/rowEditorBlueprint.md` decision 7). The root is a KTD-16 seed root. The per-state rules are pinned by
 * the component tests (`RecipeIngredientsFields.rowEditor.test.tsx`). Selectors are role, label and text only.
 */
const RECIPE_ID = 'rec_variant_search';
const ROOT_ID = 'food_chicken_breasts';
const ROOT_NAME = 'boneless skinless chicken breasts';
const FRIED = { id: 'fdc:171078', parts: [{ attribute: 'cookingMethod', text: 'fried' }] } as const;

const thighLine = {
    ingredientId: '66666666-6666-4666-8666-666666666661',
    foodId: 'food_chicken_thighs',
    name: 'chicken thighs',
    quantity: { kind: 'exact', value: 2 },
    unit: 'lb',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;
const saltLine = {
    ingredientId: '66666666-6666-4666-8666-666666666662',
    foodId: 'food_salt',
    name: 'Salt',
    quantity: { kind: 'exact', value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

const savedRecipe = (viewerId: string): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Fried chicken supper',
        status: 'draft',
        currentVersion: 1,
        ingredients: [saltLine, thighLine],
    });

/**
 * The catalog as AE3's seed has it: "fried" names exactly one variant of the root, and "grilled" names two
 * (`grilled` and `with added solution · grilled`), so it finds the root alone.
 */
const catalog = (query: string): readonly CatalogSearchResultView[] =>
    query.includes('fried')
        ? [{ id: ROOT_ID, name: ROOT_NAME, score: 0.93, variant: { ...FRIED, parts: [...FRIED.parts] } }]
        : [{ id: ROOT_ID, name: ROOT_NAME, score: 0.9 }];

/** Open the saved recipe's ingredients and put the second line in Change food. */
async function changeTheThighs(page: Page) {
    await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
    await page.getByRole('button', { name: /Ingredients:/ }).click();
    const ingredients = page.getByRole('region', { name: 'Ingredients' });

    await ingredients.getByRole('button', { name: 'Actions for chicken thighs' }).click();
    await page.getByRole('menuitem', { name: 'Change food' }).click();

    return { ingredients, field: ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }) };
}

test.describe('a search that names one variant (curated AE3)', () => {
    test('the result carries the variant, and the pick binds it: the line shows the root with its dotted line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId)] });
        const searches = await mockFoodApi(page, { catalog });
        const rebinds = await mockRebind(page, store, {
            variantParts: { [FRIED.id]: FRIED.parts },
            variantRoots: { [FRIED.id]: { foodId: ROOT_ID, name: ROOT_NAME } },
        });
        const { ingredients, field } = await changeTheThighs(page);

        await field.fill('fried boneless skinless chicken breasts');
        const result = page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: `${ROOT_NAME}, fried` });

        // §S2: one result, the root's name, with the variant's parts on a line of their own.
        await expect(result).toBeVisible();
        await expect(result).toContainText('fried');
        await result.click();

        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText(ROOT_NAME);
        await expect(ingredients.getByRole('listitem').nth(1)).toContainText('fried');
        await expect(page.getByText(`Matched: ${ROOT_NAME}, fried. Nutrition is counted now.`)).toBeVisible();
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogVariant', foodVariantId: FRIED.id } },
            ],
        ]);
        expect(searches).toContainEqual({ route: 'progressive', query: 'fried boneless skinless chicken breasts' });
    });

    test('words that name several variants find the root alone, and the pick binds the root', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId)] });
        await mockFoodApi(page, { catalog });
        const rebinds = await mockRebind(page, store, { foodNames: { [ROOT_ID]: ROOT_NAME } });
        const { ingredients, field } = await changeTheThighs(page);

        await field.fill('grilled boneless skinless chicken breasts');
        await page.getByRole('group', { name: 'Food catalog' }).getByRole('option', { name: ROOT_NAME }).click();

        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText(ROOT_NAME);
        expect(rebinds.map((each) => each.body.target)).toEqual([{ kind: 'catalogFood', foodId: ROOT_ID }]);
        expect(store.get(RECIPE_ID)?.ingredients[1]?.variant).toBeUndefined();
    });
});
