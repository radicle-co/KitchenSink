import { expect, test, type Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockFoodApi, type RemoteFoodDouble } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { E2E_CATALOG_FOOD, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { addStep, ingredientOpen, openNewRecipe, openRecipeEditor } from './utils/recipeEditor';

/**
 * Remote foods, in every place a cook picks a food (owner ruling 2026-10-02: "The users should see the remote foods and
 * the database foods flow in in All places users can pick foods"), through the real web app with the recipe contract
 * and food's progressive search and remote pick intercepted (`utils/foodApi.ts`). Replaces the U29 "Search USDA"
 * spec: there is no button, and a source's foods arrive in the same list as the database's (ADR-0055 point 9).
 *
 * Each story picks a food only a source has, so the pick is the remote one (ADR-0055 point 10): food's adopt answers
 * the root the remote food became, and the line takes that root as ONE client command: the trailing add row admits it
 * through recipe's `by-food`, and a stored line rebinds to it at its stored position (`rowEditorBlueprint.md`
 * decision 7). One pick binds one line.
 *
 * What only this tier proves: the stream, the adopt and the line's write hold together through the live clients, the
 * live query cache and the real editor and detail page. How the list fills in frame by frame is the component tier's
 * (`foodSuggestions.model.test.ts`, `entryCombobox.test.ts`). Selectors are role, label and text only.
 */

/** Black pepper as USDA streams it; its adopt answers the catalog root the recipe double admits. */
const USDA_PEPPER: RemoteFoodDouble = {
    name: E2E_CATALOG_FOOD.name,
    reference: 'sealed.usda.pepper',
    rootId: E2E_CATALOG_FOOD.foodId,
};

/** Black garlic, which only USDA has. */
const USDA_BLACK_GARLIC: RemoteFoodDouble = {
    name: 'Garlic, black',
    reference: 'sealed.usda.black.garlic',
    rootId: 'food_black_garlic',
};

/** Apple sauce as USDA has it, which no catalog food in these stories is. */
const USDA_APPLESAUCE: RemoteFoodDouble = {
    name: 'Applesauce, unsweetened',
    reference: 'sealed.usda.applesauce',
    rootId: 'food_applesauce_unsweetened',
};

/** USDA answering `foods`, whatever the text, and nothing in the database: the only foods are the source's. */
const onlyUsda = (...foods: readonly RemoteFoodDouble[]) => ({
    catalog: () => [],
    sources: () => [{ source: 'usda', outcome: 'answered', foods } as const],
});

const garlicLine = {
    ingredientId: '77777777-7777-4777-8777-777777777771',
    foodId: 'food_garlic',
    name: 'Garlic',
    quantity: { kind: 'exact', value: 2 },
    unit: 'clove',
    preparation: 'minced',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

const ambiguousLine = (ingredientId: string, quantity: number, unit: string) =>
    ({
        ingredientId,
        name: 'apple sauce',
        quantity: { kind: 'exact', value: quantity },
        unit,
        isUserEntered: false,
        resolutionStatus: 'AMBIGUOUS',
    }) as const;

/** A saved recipe holding `ingredients`, owned by the viewer. */
const savedRecipe = (viewerId: string, id: string, ingredients: RecipeDetail['ingredients']): RecipeDetail =>
    makeRecipeDetail({ id, ownerId: viewerId, title: 'Remote probe', status: 'draft', currentVersion: 1, ingredients });

/** Open a saved recipe's editor and return its Ingredients section. */
async function openIngredients(page: Page, recipeId: string) {
    await openRecipeEditor(page, recipeId);

    return page.getByRole('region', { name: 'Ingredients' });
}

test.describe('remote foods flow into every food list (ADR-0055)', () => {
    test('creating a recipe: a USDA food arrives in the add row’s list, and picking it puts it on the recipe', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        const searches = await mockFoodApi(page, onlyUsda(USDA_PEPPER));

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Remote Pepper Broth');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('pepper');

        // No button asks for it: the source's food is in the list, under its source's name.
        const list = page.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });
        const admit = page.waitForRequest(
            (request) => request.url().endsWith('/api/v1/ingredients/by-food') && request.method() === 'POST',
        );

        await list
            .getByRole('group', { name: 'From USDA' })
            .getByRole('option', { name: `${USDA_PEPPER.name}, from USDA` })
            .click();

        // The pick adopted the remote food, then admitted the root it became: one command, one line.
        expect((await admit).postDataJSON()).toEqual({ foodId: USDA_PEPPER.rootId });
        expect(searches.filter((each) => each.route === 'adopt')).toEqual([
            { route: 'adopt', reference: USDA_PEPPER.reference },
        ]);
        await expect(ingredientOpen(page, E2E_CATALOG_FOOD.name)).toBeVisible();

        // The line names a real root, so the recipe publishes with it: the falsifiable end of the story.
        await addStep(page, 'Simmer, then season generously.');
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Remote Pepper Broth' })).toBeVisible();
    });

    test('Change food: a USDA food picked inline rebinds that line once, keeping its amount', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = savedRecipe(viewerId, 'ec000000-0000-4000-8000-000000000020', [garlicLine]);
        const store = await mockRecipeApi(page, { viewerId, recipes: [recipe] });
        const searches = await mockFoodApi(page, onlyUsda(USDA_BLACK_GARLIC));
        const rebinds = await mockRebind(page, store, {
            foodNames: { [USDA_BLACK_GARLIC.rootId]: USDA_BLACK_GARLIC.name },
        });
        const ingredients = await openIngredients(page, recipe.id);

        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 1 name' }).fill('black garlic');
        await page.getByRole('option', { name: `${USDA_BLACK_GARLIC.name}, from USDA` }).click();

        // The pick moved the binding, not the cook's words.
        await expect(ingredientOpen(ingredients, USDA_BLACK_GARLIC.name)).toHaveText(
            new RegExp(`^2 .*${USDA_BLACK_GARLIC.name} · minced$`, 'u'),
        );
        await expect(page.getByText(`${USDA_BLACK_GARLIC.name} is matched. Its nutrition now counts.`)).toBeVisible();
        expect(searches.filter((each) => each.route === 'adopt')).toEqual([
            { route: 'adopt', reference: USDA_BLACK_GARLIC.reference },
        ]);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: USDA_BLACK_GARLIC.rootId } },
            ],
        ]);
    });

    test('row 7: an AMBIGUOUS line’s list carries USDA’s foods, and one pick rebinds that line alone', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = savedRecipe(viewerId, 'ec000000-0000-4000-8000-000000000023', [
            ambiguousLine('77777777-7777-4777-8777-777777777772', 1, 'cup'),
            ambiguousLine('77777777-7777-4777-8777-777777777773', 2, 'tbsp'),
        ]);
        const store = await mockRecipeApi(page, { viewerId, recipes: [recipe] });
        const searches = await mockFoodApi(page, onlyUsda(USDA_APPLESAUCE));
        const rebinds = await mockRebind(page, store, {
            foodNames: { [USDA_APPLESAUCE.rootId]: USDA_APPLESAUCE.name },
        });
        const ingredients = await openIngredients(page, recipe.id);

        await ingredients.getByRole('button', { name: 'Choose a match: apple sauce' }).first().click();
        await page
            .getByRole('list', { name: 'From USDA' })
            .getByRole('button', { name: `${USDA_APPLESAUCE.name}, from USDA` })
            .click();

        await expect(ingredientOpen(ingredients, USDA_APPLESAUCE.name)).toBeVisible();
        await expect(ingredients.getByRole('button', { name: 'Choose a match: apple sauce' })).toHaveCount(1);
        expect(searches).toEqual([
            { route: 'progressive', query: 'apple sauce' },
            { route: 'adopt', reference: USDA_APPLESAUCE.reference },
        ]);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: USDA_APPLESAUCE.rootId } },
            ],
        ]);
        expect(store.get(recipe.id)?.ingredients[1]?.resolutionStatus).toBe('AMBIGUOUS');
    });

    test('the recipe page’s review: a USDA food re-points the line it was picked on, and only that line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000021',
            ownerId: viewerId,
            title: 'Remote Review Probe',
            currentVersion: 3,
            ingredients: [
                ambiguousLine('77777777-7777-4777-8777-777777777774', 1, 'cup'),
                ambiguousLine('77777777-7777-4777-8777-777777777775', 2, 'tbsp'),
            ],
        });
        const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [recipe] });
        const searches = await mockFoodApi(page, onlyUsda(USDA_APPLESAUCE));
        const rebinds = await mockRebind(page, store, {
            foodNames: { [USDA_APPLESAUCE.rootId]: USDA_APPLESAUCE.name },
        });

        await page.goto(route(`/recipes/${recipe.id}`));
        await page.getByRole('button', { name: 'Review ingredient matches' }).click();
        const spoonRow = page.getByRole('group', { name: '2 tbsp apple sauce' });

        await spoonRow
            .getByRole('list', { name: 'From USDA' })
            .getByRole('button', { name: `${USDA_APPLESAUCE.name}, from USDA` })
            .click();

        await expect(page.getByText('Saved — future recipes will use this match.')).toBeVisible();
        await expect(page.getByRole('checkbox', { name: `2 tbsp ${USDA_APPLESAUCE.name}` })).toBeVisible();
        await expect(page.getByRole('group', { name: '1 cup apple sauce' })).toBeVisible();
        expect(searches.filter((each) => each.route === 'adopt')).toEqual([
            { route: 'adopt', reference: USDA_APPLESAUCE.reference },
        ]);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${recipe.id}/ingredients/1/rebind`,
                { expectedVersion: 3, target: { kind: 'catalogFood', foodId: USDA_APPLESAUCE.rootId } },
            ],
        ]);
    });

    test('the recipe page’s review: while the USDA food is adopted, its row says it is adding from USDA (V3-9)', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const recipe = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-000000000022',
            ownerId: viewerId,
            title: 'Remote Review Adding Probe',
            currentVersion: 3,
            ingredients: [
                ambiguousLine('77777777-7777-4777-8777-777777777776', 1, 'cup'),
                ambiguousLine('77777777-7777-4777-8777-777777777777', 2, 'tbsp'),
            ],
        });
        const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [recipe] });

        await mockFoodApi(page, onlyUsda(USDA_APPLESAUCE));
        await mockRebind(page, store, { foodNames: { [USDA_APPLESAUCE.rootId]: USDA_APPLESAUCE.name } });
        // The adopt waits until the caption has been read; the double registered before this route then answers.
        let releaseAdopt: () => void = () => undefined;
        const adoptHeld = new Promise<void>((resolve) => {
            releaseAdopt = resolve;
        });

        await page.route('**/api/v1/foods/remote/adopt', async (intercepted) => {
            await adoptHeld;
            await intercepted.fallback();
        });

        await page.goto(route(`/recipes/${recipe.id}`));
        await page.getByRole('button', { name: 'Review ingredient matches' }).click();
        const spoonRow = page.getByRole('group', { name: '2 tbsp apple sauce' });
        const cupRow = page.getByRole('group', { name: '1 cup apple sauce' });

        await spoonRow
            .getByRole('list', { name: 'From USDA' })
            .getByRole('button', { name: `${USDA_APPLESAUCE.name}, from USDA` })
            .click();

        // On the row the pick was made on, and on no other.
        await expect(spoonRow.getByText('Adding from USDA')).toBeVisible();
        await expect(cupRow.getByText('Adding from USDA')).toHaveCount(0);

        releaseAdopt();
        await expect(page.getByText('Saved — future recipes will use this match.')).toBeVisible();
        await expect(page.getByText('Adding from USDA')).toHaveCount(0);
    });

    /**
     * E2 (`docs/design/rowEditorOpenDecisions.md`): a pick that fails while the cook is elsewhere. The cook picks a
     * USDA food, jumps to Details while it is adopted, and food refuses it there. The row shows its failure line, which
     * describes the field, with no alert, and the cook is left where they went: it is a state by then, not an event.
     *
     * REWRITTEN for slice 7: there is no hidden step any more, so "on return" is gone. What the one page must still not
     * do is announce the refusal as an alert or pull the cook back to the row; the section index's marking of
     * Ingredients is not asserted here (its wording is the section-status model's, pinned by its unit tests).
     */
    test('a pick refused while the cook is in another section: no alert, no jump back, and the row says why', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page, onlyUsda(USDA_PEPPER));
        // The adopt waits until the cook is in Details, then food refuses it: the food is gone from its source.
        let refuse: () => void = () => undefined;
        const adoptHeld = new Promise<void>((resolve) => {
            refuse = resolve;
        });

        await page.route('**/api/v1/foods/remote/adopt', async (intercepted) => {
            await adoptHeld;
            await intercepted.fulfill({
                status: 409,
                json: { code: 'REMOTE_FOOD_GONE', message: 'This remote food can no longer be picked' },
            });
        });

        await openNewRecipe(page);
        await page.getByLabel('Title').fill('E2E Away Refusal');
        await page.getByRole('radio', { name: 'Easy' }).click();
        const field = page.getByRole('combobox', { name: 'Add an ingredient' });

        await field.fill('pepper');
        await page
            .getByRole('listbox', { name: 'Food suggestions for ingredient 1' })
            .getByRole('group', { name: 'From USDA' })
            .getByRole('option', { name: `${USDA_PEPPER.name}, from USDA` })
            .click();

        // While the adopt runs, the cook jumps to Details through the section index.
        await page.getByRole('navigation', { name: 'Recipe sections' }).getByRole('link', { name: 'Details' }).click();
        const details = page.getByRole('heading', { level: 2, name: 'Details' });
        await expect(details).toBeFocused();
        refuse();

        const sentence = `${USDA_PEPPER.name} isn’t available any more. Choose another food.`;

        await expect(page.getByText(sentence)).toBeAttached();
        // The refusal does not take the cook back to the row.
        await expect(details).toBeFocused();
        await expect(field).toHaveValue('pepper');
        await expect(field).toHaveAccessibleDescription(/isn’t available any more\. Choose another food\./u);
        await expect(page.getByRole('alert').filter({ hasText: sentence })).toHaveCount(0);
    });
});
