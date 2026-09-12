import { expect, test, type Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockFoodApi } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { E2E_CATALOG_FOOD, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The ingredient row editor's stories on a saved recipe (plan 002 V1 B7), through the real web app with the recipe
 * contract and food's progressive search (ADR-0055 point 9) intercepted:
 *
 * - US7, Change food: the cook reopens a matched line's food and picks another, keeping the amount, unit, preparation
 *   and section. Before B7 the rebind command existed and no editor control called it (plan 002 status, R17/US3).
 * - Row 1's Find a food: a line in the cook's own wording gets a food from its own field.
 * - `docs/design/rowEditorOpenDecisions.md` R7: text a Change food row holds refuses Save Draft; the refusal lands on
 *   step 2 with focus in that field, which says why, and choosing "Use … as written" lets the save go ahead.
 * - Row 6 (`docs/design/ingredientStatusExplanation.md` SPECIFY.1; `docs/design/rowEditorOpenDecisions.md` S7 list
 *   contract P12): an `UNRESOLVED` line's glyph opens a list searched from the line's own words, as row 7's is. A pick
 *   of a remote food adopts it and rebinds THAT line (ADR-0055 point 10), and None of these returns the line to its
 *   field and writes nothing.
 *
 * What only this tier proves: each pick reaches the wire through the route `docs/design/rowEditorBlueprint.md`
 * decision 7 gives it — ONE rebind command at the line's STORED position for a food pick, the draft for a declaration —
 * and the refusal moves a real browser's focus. The per-state rules are pinned by the component tests
 * (`RecipeIngredientsFields.rowEditor.test.tsx`). Selectors are role, label and text only.
 */
const RECIPE_ID = 'rec_row_editor';
const SALT_ID = '99999999-9999-4999-8999-999999999991';
const GARLIC_ID = '99999999-9999-4999-8999-999999999992';
const MIX_ID = '99999999-9999-4999-8999-999999999993';
const KALE_ID = '99999999-9999-4999-8999-999999999994';
/** The one catalog food the doubles find and admit (`utils/foodApi.ts`, `utils/recipeApi.ts`). */
const PEPPER = E2E_CATALOG_FOOD;

const saltLine = {
    ingredientId: SALT_ID,
    foodId: 'food_salt',
    name: 'Salt',
    quantity: { kind: 'exact', value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

/** A saved recipe whose SECOND stored line is the one each story works on, so the position is not the default 0. */
const savedRecipe = (viewerId: string, second: RecipeDetail['ingredients'][number]): RecipeDetail =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Garlic supper',
        status: 'draft',
        currentVersion: 1,
        ingredients: [saltLine, second],
    });

const garlicLine = {
    ingredientId: GARLIC_ID,
    foodId: 'food_garlic',
    name: 'Garlic',
    quantity: { kind: 'exact', value: 2 },
    unit: 'clove',
    preparation: 'minced',
    groupLabel: 'For the sauce',
    isUserEntered: false,
    resolutionStatus: 'RESOLVED',
} as const;

const kaleLine = {
    ingredientId: KALE_ID,
    name: 'Kale',
    quantity: { kind: 'exact', value: 1 },
    unit: 'bunch',
    isUserEntered: false,
    resolutionStatus: 'UNRESOLVED',
} as const;
/** Kale as USDA streams it: no catalog food matches the line, so the list's only food is this remote one. */
const KALE_RAW = { name: 'Kale, raw', reference: 'sealed.kale.raw', rootId: 'food_kale' } as const;

async function openIngredientsStep(page: Page): Promise<void> {
    await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
    await page.getByRole('button', { name: /Ingredients:/ }).click();
    await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 2 of 4');
}

test.describe('the ingredient row editor on a saved recipe (plan 002 V1 B7)', () => {
    test('US7 Change food: one rebind at the stored position, and the amount, unit, preparation and section stay', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        const field = ingredients.getByRole('combobox', { name: 'Ingredient 2 name' });

        // §2d: Change food puts the cook in the field, on the food's current name.
        await expect(field).toBeFocused();
        await field.fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText(PEPPER.name);
        // The pick moved the binding, not the cook's words.
        await expect(ingredients.getByLabel('Ingredient 2 quantity')).toHaveValue('2');
        await expect(ingredients.getByLabel('Ingredient 2 unit')).toHaveValue('clove');
        await expect(ingredients.getByLabel('Ingredient 2 preparation')).toHaveValue('minced');
        await expect(ingredients.getByLabel('Ingredient 2 section')).toHaveValue('For the sauce');
        // §2d: a committed pick hands focus to the row's glyph, and says so politely.
        await expect(ingredients.getByRole('button', { name: `About ${PEPPER.name}` })).toBeFocused();
        await expect(page.getByText(`${PEPPER.name} is matched. Its nutrition now counts.`)).toBeVisible();
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: PEPPER.foodId } },
            ],
        ]);
        expect(store.get(RECIPE_ID)?.ingredients[1]).toMatchObject({
            foodId: PEPPER.foodId,
            preparation: 'minced',
            groupLabel: 'For the sauce',
        });
        expect(store.get(RECIPE_ID)?.ingredients[0]?.ingredientId).toBe(SALT_ID);
    });

    test('row 1 Find a food: a line in the cook’s own wording gets a food from its own field', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const mixLine = {
            ingredientId: MIX_ID,
            name: 'my spice mix',
            quantity: { kind: 'exact', value: 1 },
            unit: 'tbsp',
            isUserEntered: true,
        } as const;
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, mixLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for my spice mix' }).click();
        await page.getByRole('menuitem', { name: 'Find a food for this' }).click();
        const field = ingredients.getByRole('combobox', { name: 'Ingredient 2 name' });

        await expect(field).toBeFocused();
        await field.fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect(ingredients.getByRole('group', { name: 'Ingredient 2 name' })).toHaveText(PEPPER.name);
        expect(rebinds.map((each) => each.body)).toEqual([
            { expectedVersion: 1, target: { kind: 'catalogFood', foodId: PEPPER.foodId } },
        ]);
    });

    test('R7: text a Change food row holds refuses Save Draft from step 3, lands in that field, and “as written” lets it save', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, {});

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('smoked garlic');
        // The rail is ungated (R6), so the cook can be on another step when the save is refused.
        await page.getByRole('button', { name: /Instructions:/ }).click();
        await page.getByRole('button', { name: 'Save Draft' }).click();

        // The refusal lands on step 2, in the field, which says why; nothing was written.
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 2 of 4');
        const field = page
            .getByRole('region', { name: 'Ingredients' })
            .getByRole('combobox', { name: 'Ingredient 2 name' });

        await expect(field).toBeFocused();
        await expect(field).toHaveAccessibleDescription(
            /“smoked garlic” isn’t in the recipe yet\. Choose a food for it, or press Cancel to keep Garlic\./,
        );
        await expect(
            page.getByText(
                'An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.',
            ),
        ).toBeVisible();
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);

        // The list opened with the focus (R7 item 3), so the cook keeps the words without editing them.
        await expect(field).toHaveAttribute('aria-expanded', 'true');
        await page.getByRole('option', { name: 'Use “smoked garlic” as written, without nutrition' }).click();
        await page.getByRole('button', { name: 'Save Draft' }).click();

        await expect(page.getByRole('heading', { name: 'Garlic supper' })).toBeVisible();
        expect(store.get(RECIPE_ID)?.ingredients[1]).toMatchObject({
            name: 'smoked garlic',
            isUserEntered: true,
            preparation: 'minced',
        });
        // A declaration has no food to rebind to, so it went through the draft, not the command (decision 7).
        expect(rebinds).toEqual([]);
    });

    test('a rebind to the food the line already uses writes nothing, and the next one still names version 1 (ADR-0045)', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const pepperLine = {
            ingredientId: GARLIC_ID,
            foodId: PEPPER.foodId,
            name: PEPPER.name,
            quantity: { kind: 'exact', value: 1 },
            unit: 'tsp',
            isUserEntered: false,
            resolutionStatus: 'RESOLVED',
        } as const;
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, pepperLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: `Actions for ${PEPPER.name}` }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect.poll(() => rebinds.length).toBe(1);
        expect(rebinds[0]?.body).toEqual({
            expectedVersion: 1,
            target: { kind: 'catalogFood', foodId: PEPPER.foodId },
        });
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);

        // A real change on the other line: the editor adopted the unchanged version, so it still sends 1.
        await ingredients.getByRole('button', { name: 'Actions for Salt' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 1 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect.poll(() => rebinds.length).toBe(2);
        expect(rebinds[1]?.body.expectedVersion).toBe(1);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(2);
    });

    test('a rebind against a version another writer moved on opens the conflict view and writes nothing', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, garlicLine)] });
        await mockFoodApi(page);
        const rebinds = await mockRebind(page, store, { foodNames: { [PEPPER.foodId]: PEPPER.name } });

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });
        const loaded = store.get(RECIPE_ID);

        if (loaded === undefined) {
            throw new Error('the seeded recipe is not in the store');
        }

        // Another writer saved version 2 while the cook had the editor open.
        store.set(RECIPE_ID, { ...loaded, currentVersion: 2, title: 'Garlic supper, theirs' });
        await ingredients.getByRole('button', { name: 'Actions for Garlic' }).click();
        await page.getByRole('menuitem', { name: 'Change food' }).click();
        await ingredients.getByRole('combobox', { name: 'Ingredient 2 name' }).fill('pepper');
        await page.getByRole('option', { name: PEPPER.name }).click();

        await expect(page.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeVisible();
        expect(rebinds.map((each) => each.body.expectedVersion)).toEqual([1]);
        expect(store.get(RECIPE_ID)?.ingredients[1]?.foodId).toBe('food_garlic');
    });

    test('row 6: the glyph opens a list searched from the line’s own words, and a remote pick rebinds the line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, kaleLine)] });
        const searches = await mockFoodApi(page, {
            catalog: () => [],
            sources: () => [{ source: 'usda', outcome: 'answered', foods: [KALE_RAW] }],
        });
        const rebinds = await mockRebind(page, store, { foodNames: { [KALE_RAW.rootId]: KALE_RAW.name } });

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        // The panel never opens by itself, and nothing is searched until the cook asks.
        await expect(ingredients.getByText('Not resolved')).toBeVisible();
        expect(searches).toEqual([]);

        await ingredients.getByRole('button', { name: 'About Kale' }).click();
        const fromUsda = page.getByRole('list', { name: 'From USDA' });

        await fromUsda.getByRole('button', { name: `${KALE_RAW.name}, from USDA` }).click();

        await expect(fromUsda).toBeHidden();
        await expect(ingredients.getByRole('button', { name: `About ${KALE_RAW.name}` })).toBeFocused();
        await expect(page.getByText(`${KALE_RAW.name} is matched. Its nutrition now counts.`)).toBeVisible();
        await expect(ingredients.getByText('Not resolved')).toHaveCount(0);
        // One pick: the line's own words searched (sent as food's canonical term), the remote food adopted, then ONE
        // rebind of THAT line to its root.
        expect(searches).toEqual([
            { route: 'progressive', query: 'kale' },
            { route: 'adopt', reference: KALE_RAW.reference },
        ]);
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                `/api/v1/recipes/${RECIPE_ID}/ingredients/1/rebind`,
                { expectedVersion: 1, target: { kind: 'catalogFood', foodId: KALE_RAW.rootId } },
            ],
        ]);
    });

    test('row 6: None of these returns the line to its field with its amount kept, and writes nothing', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const store = await mockRecipeApi(page, { viewerId, recipes: [savedRecipe(viewerId, kaleLine)] });
        const searches = await mockFoodApi(page, {
            catalog: () => [],
            sources: () => [{ source: 'usda', outcome: 'answered', foods: [KALE_RAW] }],
        });
        const rebinds = await mockRebind(page, store, {});

        await openIngredientsStep(page);
        const ingredients = page.getByRole('region', { name: 'Ingredients' });

        await ingredients.getByRole('button', { name: 'About Kale' }).click();
        await page.getByRole('button', { name: 'None of these — search for a different food' }).click();

        await expect(ingredients.getByRole('combobox', { name: 'Ingredient 2 name' })).toBeFocused();
        await expect(ingredients.getByLabel('Ingredient 2 quantity')).toHaveValue('1');
        await expect(ingredients.getByLabel('Ingredient 2 unit')).toHaveValue('bunch');
        // Declining every food is not a binding: no adopt, no rebind, no new version.
        expect(searches.filter((each) => each.route === 'adopt')).toEqual([]);
        expect(rebinds).toEqual([]);
        expect(store.get(RECIPE_ID)?.currentVersion).toBe(1);
    });
});
